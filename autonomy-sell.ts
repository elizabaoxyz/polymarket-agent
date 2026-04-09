/**
 * Sell phases and position review for Polymarket and Jupiter.
 * Extracted from autonomy.ts for maintainability.
 */

import { JupiterPredictionService, JUPITER_SERVICE_TYPE } from "./plugins/jupiter-prediction/service";
import type { AutonomyDeps, AutonomyCallbacks, AutonomyState } from "./autonomy-state";
import { isFailCooledDown, recordTrade } from "./autonomy-state";
import {
  LOW_BALANCE_THRESHOLD,
  SELL_LOSS_THRESHOLD_AGGRESSIVE,
  SELL_PROFIT_THRESHOLD_AGGRESSIVE,
  POSITION_MIN_AGE_MS,
  FAILED_SELL_COOLDOWN_MS,
} from "./config";
import { withRetry } from "./retry";
import { getSolanaKeypair } from "./solana-wallet";
import { directPolymarketSell } from "./autonomy-trade";
import { directLlmCall } from "./autonomy-llm";
import { fetchPolyPriceHistory, computePriceTrend, formatIntelForPrompt } from "./market-intel";
import type { PriceTrend, MarketIntel } from "./market-intel";

// --- Position collection types ---

export type PolySellTarget = { token: string; shares: number; title: string; pnl: number; curPrice: number };
export type JupSellTarget = { marketId: string; pubkey: string; title: string; pnl: number };
export type JupClaimTarget = { pubkey: string; title: string; payout: number };
export type JupPositionInfo = { marketId: string; pubkey: string; title: string; pnl: number; isYes: boolean; contracts: string };

// --- Collect positions from both platforms ---

export async function collectPositions(
  state: AutonomyState,
  sellLossThreshold: number,
  sellProfitThreshold: number,
): Promise<{
  ownedTitles: Set<string>;
  polySellTargets: PolySellTarget[];
  polyAllSellable: PolySellTarget[];
  jupSellTargets: JupSellTarget[];
  jupAllPositions: JupPositionInfo[];
  jupClaimable: JupClaimTarget[];
}> {
  const ownedTitles = new Set<string>();
  const polySellTargets: PolySellTarget[] = [];
  const polyAllSellable: PolySellTarget[] = [];
  const jupSellTargets: JupSellTarget[] = [];
  const jupAllPositions: JupPositionInfo[] = [];
  const jupClaimable: JupClaimTarget[] = [];

  // Polymarket positions
  try {
    const funder = process.env.POLYMARKET_FUNDER_ADDRESS?.trim();
    if (funder) {
      const posRes = await withRetry(
        () => fetch(`https://data-api.polymarket.com/positions?user=${funder}`),
        { label: "poly-positions" },
      );
      if (posRes.ok) {
        type PolyPosApi = {
          title?: string; asset: string; size: number; percentPnl: number;
          curPrice: number; redeemable?: boolean;
        };
        for (const pos of (await posRes.json()) as PolyPosApi[]) {
          if (pos.title) ownedTitles.add(pos.title.toLowerCase());
          const pnl = pos.percentPnl ?? 0;
          const price = pos.curPrice ?? 0;
          if (price < 0.02 || pos.redeemable) continue;
          const isNew = state.tradeHistory.some(
            (h) => h.question.toLowerCase() === (pos.title ?? "").toLowerCase() && Date.now() - h.time < POSITION_MIN_AGE_MS,
          );
          if (isNew) continue;
          if (pnl <= -95) continue;
          if (price < 0.05) continue;
          if (!isFailCooledDown(state.failedSells, pos.asset, FAILED_SELL_COOLDOWN_MS)) continue;
          if ((pos.size ?? 0) < 5) continue;
          polyAllSellable.push({ token: pos.asset, shares: pos.size, title: pos.title ?? "", pnl, curPrice: price });
          if (pnl < sellLossThreshold || pnl > sellProfitThreshold) {
            polySellTargets.push({ token: pos.asset, shares: pos.size, title: pos.title ?? "", pnl, curPrice: price });
          }
        }
      }
    }
  } catch {}

  // Jupiter positions
  try {
    const jupApiKey = process.env.JUPITER_API_KEY?.trim();
    const kp = getSolanaKeypair();
    if (jupApiKey && kp) {
      const posRes = await withRetry(
        () =>
          fetch(
            `https://api.jup.ag/prediction/v1/positions?ownerPubkey=${kp.publicKey.toBase58()}`,
            { headers: { "x-api-key": jupApiKey } },
          ),
        { label: "jup-positions" },
      );
      if (posRes.ok) {
        type JupPosApi = {
          marketId: string; pubkey: string; isYes: boolean; contracts: string;
          pnlUsdPercent: number; eventMetadata?: { title?: string };
          marketMetadata?: { title?: string }; claimable?: boolean; claimed?: boolean;
          payoutUsd?: number;
        };
        for (const pos of ((await posRes.json()) as { data?: JupPosApi[] }).data ?? []) {
          const title = pos.eventMetadata?.title ?? pos.marketId ?? "";
          if (title) ownedTitles.add(title.toLowerCase());
          if (pos.claimable === true && pos.claimed !== true && pos.pubkey) {
            const payout = Number(pos.payoutUsd ?? 0) / 1_000_000;
            jupClaimable.push({
              pubkey: pos.pubkey,
              title: pos.marketMetadata?.title ?? pos.marketId,
              payout,
            });
            continue;
          }
          const pnl = pos.pnlUsdPercent ?? 0;
          const isNewJup = state.tradeHistory.some(
            (h) => h.question.toLowerCase().includes(title.toLowerCase()) && Date.now() - h.time < POSITION_MIN_AGE_MS,
          );
          if (isNewJup) continue;
          if (pos.pubkey) {
            jupAllPositions.push({
              marketId: pos.marketId,
              pubkey: pos.pubkey,
              title: pos.marketMetadata?.title ?? pos.marketId,
              pnl,
              isYes: pos.isYes ?? true,
              contracts: pos.contracts ?? "0",
            });
          }
          if (
            (pnl < sellLossThreshold || pnl > sellProfitThreshold) &&
            pos.pubkey &&
            pnl > -95 &&
            !state.recentlySold.has(pos.pubkey) &&
            isFailCooledDown(state.failedSells, pos.pubkey, FAILED_SELL_COOLDOWN_MS)
          ) {
            jupSellTargets.push({
              marketId: pos.marketId,
              pubkey: pos.pubkey,
              title: pos.marketMetadata?.title ?? pos.marketId,
              pnl,
            });
          }
        }
      }
    }
  } catch {}

  return { ownedTitles, polySellTargets, polyAllSellable, jupSellTargets, jupAllPositions, jupClaimable };
}

// --- Polymarket sell phase ---

export async function polymarketSellPhase(
  deps: AutonomyDeps,
  callbacks: AutonomyCallbacks,
  state: AutonomyState,
  sellTargets: PolySellTarget[],
  allSellable: PolySellTarget[],
  polyBalance: number,
  lowBalance: boolean,
  sellLossThreshold: number,
): Promise<void> {
  if (sellTargets.length > 0) {
    const sellList = sellTargets
      .map((s, i) => `${i + 1}. "${s.title}" — PnL: ${s.pnl.toFixed(0)}%, shares: ${s.shares}`)
      .join("\n");
    if (lowBalance) {
      callbacks.log(
        `[SELL MODE] Balance low ($${polyBalance.toFixed(2)}) — aggressive sell thresholds: -${Math.abs(sellLossThreshold)}% / +${SELL_PROFIT_THRESHOLD_AGGRESSIVE}%`,
      );
    }
    callbacks.log(`[SELL ANALYSIS] Analyzing ${sellTargets.length} positions...`);
    const sellText = await directLlmCall(
      deps,
      callbacks,
      `You are a portfolio manager reviewing positions. Today is ${new Date().toISOString().split("T")[0]}.${lowBalance ? ` Balance is critically low ($${polyBalance.toFixed(2)}). Be aggressive — sell anything profitable.` : ""} For each position, decide SELL or HOLD.\n\n${sellList}\n\nRespond with one line per position:\n<number>: SELL or HOLD — <reason>`,
    );

    for (let i = 0; i < sellTargets.length; i++) {
      const sell = sellTargets[i]!;
      if (state.failedSells.has(sell.token) || state.recentlySold.has(sell.token)) continue;
      const holdPattern = new RegExp(`${i + 1}[:\\s]*HOLD`, "i");
      if (holdPattern.test(sellText)) {
        callbacks.log(`[HOLD:POLYMARKET] "${sell.title}" ${sell.pnl.toFixed(0)}% — LLM says hold`);
        continue;
      }
      const action = sell.pnl < 0 ? "cutting loss" : "taking profit";
      callbacks.log(`[SELL:POLYMARKET] "${sell.title}" ${sell.pnl.toFixed(0)}% — ${action}`);
      await directPolymarketSell(deps, callbacks, state, sell.token, sell.shares, sell.title, sell.curPrice);
    }
  }

  // Recovery mode — if balance is critically low and no threshold sells triggered
  if (polyBalance < LOW_BALANCE_THRESHOLD && sellTargets.length === 0 && allSellable.length > 0) {
    const positionList = allSellable
      .sort((a, b) => a.pnl - b.pnl)
      .slice(0, 10)
      .map((p, i) => `${i + 1}. "${p.title}" — PnL: ${p.pnl.toFixed(0)}%, shares: ${p.shares}`)
      .join("\n");
    callbacks.log(`[RECOVERY MODE] Balance $${polyBalance.toFixed(2)} — asking LLM which positions to sell...`);
    const recoveryText = await directLlmCall(
      deps,
      callbacks,
      `You are a portfolio manager. Balance is critically low ($${polyBalance.toFixed(2)}). Today is ${new Date().toISOString().split("T")[0]}.\n\nPositions (worst first):\n${positionList}\n\nPick 1-3 to sell. Respond with:\n<number>: SELL — <reason>`,
    );
    const sorted = allSellable.sort((a, b) => a.pnl - b.pnl);
    for (let i = 0; i < Math.min(10, sorted.length); i++) {
      const sellPattern = new RegExp(`${i + 1}[:\\s]*SELL`, "i");
      if (sellPattern.test(recoveryText)) {
        const pos = sorted[i]!;
        if (state.failedSells.has(pos.token) || state.recentlySold.has(pos.token)) continue;
        callbacks.log(`[RECOVERY SELL] "${pos.title}" ${pos.pnl.toFixed(0)}% — LLM recommended`);
        await directPolymarketSell(deps, callbacks, state, pos.token, pos.shares, pos.title, pos.curPrice);
      }
    }
  }
}

// --- Review all positions (auto-sell hard rules + LLM review) ---

type ReviewablePosition = {
  token?: string;
  pubkey?: string;
  title: string;
  pnl: number;
  shares?: number;
  curPrice?: number;
  isYes?: boolean;
  contracts?: string;
};

export async function reviewAllPositions(
  deps: AutonomyDeps,
  callbacks: AutonomyCallbacks,
  state: AutonomyState,
  platform: "POLYMARKET" | "JUPITER",
  positions: ReviewablePosition[],
): Promise<void> {
  const reviewable = positions.filter((p) => {
    const key = p.token ?? p.pubkey ?? "";
    if (!key) return false;
    if (state.recentlySold.has(key)) return false;
    if (state.failedSells.has(key)) return false;
    if (platform === "POLYMARKET" && (p.shares ?? 0) < 5) return false;
    if ((p.curPrice ?? 0) < 0.01) return false;
    return true;
  });

  if (reviewable.length === 0) {
    callbacks.log(`[PORTFOLIO:${platform}] No reviewable positions`);
    return;
  }

  // === HARD RULES: auto-sell without asking the LLM ===
  const autoSellTargets = reviewable.filter((p) => {
    if (p.pnl >= 25) return true;
    if (p.pnl <= -18) return true;
    return false;
  });

  for (const pos of autoSellTargets) {
    const key = pos.token ?? pos.pubkey ?? "";
    if (state.recentlySold.has(key) || state.failedSells.has(key)) continue;
    const sign = pos.pnl >= 0 ? "+" : "";
    const reason = pos.pnl >= 10 ? "auto-profit-lock" : "auto-stop-loss";

    if (platform === "POLYMARKET" && pos.token) {
      callbacks.log(`[SELL:POLYMARKET] "${pos.title}" ${sign}${pos.pnl.toFixed(0)}% — ${reason}`);
      await directPolymarketSell(deps, callbacks, state, pos.token, pos.shares ?? 0, pos.title, pos.curPrice);
    } else if (platform === "JUPITER" && pos.pubkey) {
      callbacks.log(`[SELL:JUPITER] "${pos.title}" ${sign}${pos.pnl.toFixed(0)}% — ${reason}`);
      let jupSvc: JupiterPredictionService | null = null;
      try {
        jupSvc = (await deps.runtime.getServiceLoadPromise(JUPITER_SERVICE_TYPE)) as unknown as JupiterPredictionService | null;
      } catch {}
      if (jupSvc) {
        try {
          const { transaction } = await jupSvc.client.closePosition(pos.pubkey, jupSvc.ownerPubkey);
          const signature = await jupSvc.signAndSubmit(transaction);
          callbacks.log(`[SELL:JUPITER] ✅ Closed! Signature: ${signature}`);
          state.recentlySold.set(pos.pubkey, Date.now());
          state.recentlySoldQuestions.set(pos.title.toLowerCase(), Date.now());
        } catch (err) {
          const errMsg = err instanceof Error ? err.message : String(err);
          callbacks.log(`[SELL:JUPITER] ❌ Failed: ${errMsg}`);
          state.failedSells.set(pos.pubkey, Date.now());
        }
      }
    }
  }

  // Filter out auto-sold positions from LLM review
  const autoSoldKeys = new Set(autoSellTargets.map((p) => p.token ?? p.pubkey ?? ""));
  const llmReviewable = reviewable.filter((p) => !autoSoldKeys.has(p.token ?? p.pubkey ?? ""));

  if (llmReviewable.length === 0) return;

  // Fetch price trends for top positions
  const sortedForReview = llmReviewable.sort((a, b) => b.pnl - a.pnl).slice(0, 12);
  const trendMap = new Map<string, PriceTrend>();
  if (platform === "POLYMARKET") {
    const trendFetches = sortedForReview.slice(0, 8).map(async (p) => {
      if (!p.token) return;
      try {
        const history = await fetchPolyPriceHistory(p.token, "1h", 24);
        if (history.length > 2) {
          trendMap.set(p.token, computePriceTrend(history, p.curPrice ?? 0));
        }
      } catch {}
    });
    await Promise.allSettled(trendFetches);
  }

  // Build position list for LLM with trend context
  const llmPositionList = sortedForReview
    .map((p, i) => {
      const dir = p.isYes !== undefined ? (p.isYes ? "YES" : "NO") : "";
      const qty = p.shares ?? p.contracts ?? "?";
      const sign = p.pnl >= 0 ? "+" : "";
      let trendStr = "";
      const trend = trendMap.get(p.token ?? "");
      if (trend) {
        const parts: string[] = [];
        if (trend.change1h !== null) parts.push(`1h: ${trend.change1h > 0 ? "+" : ""}${trend.change1h.toFixed(1)}%`);
        if (trend.change24h !== null) parts.push(`24h: ${trend.change24h > 0 ? "+" : ""}${trend.change24h.toFixed(1)}%`);
        trendStr = ` | trend: ${trend.direction} (${parts.join(", ")})`;
      }
      return `${i + 1}. "${p.title}" — PnL: ${sign}${p.pnl.toFixed(0)}%, ${dir} ${qty} units, price: $${(p.curPrice ?? 0).toFixed(2)}${trendStr}`;
    })
    .join("\n");

  callbacks.log(`[PORTFOLIO:${platform}] LLM reviewing ${llmReviewable.length} remaining positions with trend data...`);
  const reviewText = await directLlmCall(
    deps,
    callbacks,
    `You are a disciplined prediction market portfolio manager. Today is ${new Date().toISOString().split("T")[0]}.

RULES — follow these strictly:
- Positions with PnL > +20%: SELL — lock in significant profit.
- Positions with PnL +5% to +20%: check trend data:
  - If price is trending DOWN or flat: SELL — take profit before it fades.
  - If price is trending UP: HOLD — let the winner run.
- Positions with PnL 0% to +5%: HOLD — too small to justify selling (spread costs eat the profit).
- Positions with PnL -15% to 0%: check trend data:
  - If price is trending DOWN (negative 1h/24h change): SELL — cut before it gets worse.
  - If price is trending UP or flat: HOLD — give it time to recover.
- Positions with PnL < -15%: SELL — cut the loss.
- Sports/event markets resolving within 2 DAYS: SELL if profitable — take guaranteed money.
- 20%+ price drop in 24h with no recovery: SELL — momentum collapse.

IMPORTANT: Do NOT sell small winners (<5% profit). The bid-ask spread costs 3-5% on each round trip. Selling at +2% and re-buying costs more than holding.

Positions:
${llmPositionList}

Respond with one line per position:
<number>: SELL or HOLD — <reason citing specific data>`,
  );

  if (reviewText.length === 0) return;
  callbacks.log(`[PORTFOLIO:${platform}] ${reviewText.slice(0, 300)}`);

  const sorted = llmReviewable.sort((a, b) => b.pnl - a.pnl).slice(0, 12);
  for (let i = 0; i < sorted.length; i++) {
    const sellPattern = new RegExp(`${i + 1}[:\\s]*SELL`, "i");
    if (!sellPattern.test(reviewText)) continue;
    const pos = sorted[i]!;
    const key = pos.token ?? pos.pubkey ?? "";
    if (state.recentlySold.has(key) || state.failedSells.has(key)) continue;
    const sign = pos.pnl >= 0 ? "+" : "";

    if (platform === "POLYMARKET" && pos.token) {
      callbacks.log(`[SELL:POLYMARKET] "${pos.title}" ${sign}${pos.pnl.toFixed(0)}% — portfolio review`);
      await directPolymarketSell(deps, callbacks, state, pos.token, pos.shares ?? 0, pos.title, pos.curPrice);
    } else if (platform === "JUPITER" && pos.pubkey) {
      callbacks.log(`[SELL:JUPITER] "${pos.title}" ${sign}${pos.pnl.toFixed(0)}% — portfolio review`);
      let jupSvc: JupiterPredictionService | null = null;
      try {
        jupSvc = (await deps.runtime.getServiceLoadPromise(JUPITER_SERVICE_TYPE)) as unknown as JupiterPredictionService | null;
      } catch {}
      if (jupSvc) {
        try {
          const { transaction } = await jupSvc.client.closePosition(pos.pubkey, jupSvc.ownerPubkey);
          const signature = await jupSvc.signAndSubmit(transaction);
          callbacks.log(`[SELL:JUPITER] ✅ Closed! Signature: ${signature}`);
          state.recentlySold.set(pos.pubkey, Date.now());
          state.recentlySoldQuestions.set(pos.title.toLowerCase(), Date.now());
        } catch (err) {
          const errMsg = err instanceof Error ? err.message : String(err);
          callbacks.log(`[SELL:JUPITER] ❌ Failed: ${errMsg}`);
          state.failedSells.set(pos.pubkey, Date.now());
        }
      }
    }
  }
}

// --- Jupiter sell/claim phase ---

export async function jupiterSellClaimPhase(
  deps: AutonomyDeps,
  callbacks: AutonomyCallbacks,
  state: AutonomyState,
  jupSellTargets: JupSellTarget[],
  jupClaimable: JupClaimTarget[],
  solBalance: number,
  lowSolBalance: boolean,
  sellLossThreshold: number,
): Promise<void> {
  if (jupClaimable.length === 0 && jupSellTargets.length === 0) {
    callbacks.log(`[JUPITER] No threshold sells or claims this cycle`);
  }

  // Claim settled positions first
  if (jupClaimable.length > 0) {
    let jupSvc: JupiterPredictionService | null = null;
    try {
      jupSvc = (await deps.runtime.getServiceLoadPromise(
        JUPITER_SERVICE_TYPE,
      )) as unknown as JupiterPredictionService | null;
    } catch {}
    for (const claim of jupClaimable) {
      callbacks.log(`[CLAIM:JUPITER] "${claim.title}" — payout: $${claim.payout.toFixed(2)}`);
      if (jupSvc) {
        try {
          const { transaction } = await jupSvc.client.claimPosition(claim.pubkey, jupSvc.ownerPubkey);
          const signature = await jupSvc.signAndSubmit(transaction);
          callbacks.log(`[CLAIM:JUPITER] Claimed! Signature: ${signature}`);
        } catch (err) {
          const errMsg = err instanceof Error ? err.message : String(err);
          callbacks.log(`[CLAIM:JUPITER] Failed: ${errMsg}`);
        }
      }
    }
  }

  // Sell phase
  if (jupSellTargets.length > 0) {
    const jupSellList = jupSellTargets
      .map((s, i) => `${i + 1}. "${s.title}" — PnL: ${s.pnl.toFixed(0)}%`)
      .join("\n");
    if (lowSolBalance) {
      callbacks.log(
        `[SELL MODE] SOL balance low ($${solBalance.toFixed(2)}) — aggressive sell thresholds: -${Math.abs(sellLossThreshold)}%`,
      );
    }
    callbacks.log(`[SELL ANALYSIS] Analyzing ${jupSellTargets.length} Jupiter positions...`);
    const jupSellText = await directLlmCall(
      deps,
      callbacks,
      `You are a portfolio manager reviewing Jupiter/Solana positions. Today is ${new Date().toISOString().split("T")[0]}.${lowSolBalance ? ` Balance is critically low ($${solBalance.toFixed(2)}). Be aggressive.` : ""} For each position, decide SELL or HOLD.\n\n${jupSellList}\n\nRespond with one line per position:\n<number>: SELL or HOLD — <reason>`,
    );

    let jupSvc: JupiterPredictionService | null = null;
    try {
      jupSvc = (await deps.runtime.getServiceLoadPromise(
        JUPITER_SERVICE_TYPE,
      )) as unknown as JupiterPredictionService | null;
    } catch {}

    for (let i = 0; i < jupSellTargets.length; i++) {
      const sell = jupSellTargets[i]!;
      if (state.recentlySold.has(sell.pubkey) || state.failedSells.has(sell.pubkey)) continue;
      const holdPattern = new RegExp(`${i + 1}[:\\s]*HOLD`, "i");
      if (holdPattern.test(jupSellText)) {
        callbacks.log(`[HOLD:JUPITER] "${sell.title}" ${sell.pnl.toFixed(0)}% — LLM says hold`);
        continue;
      }
      const action = sell.pnl < 0 ? "cutting loss" : "taking profit";
      callbacks.log(`[SELL:JUPITER] "${sell.title}" ${sell.pnl.toFixed(0)}% — ${action}`);
      if (jupSvc) {
        try {
          const { transaction } = await jupSvc.client.closePosition(sell.pubkey, jupSvc.ownerPubkey);
          const signature = await jupSvc.signAndSubmit(transaction);
          callbacks.log(`[SELL:JUPITER] ✅ Closed! Signature: ${signature}`);
          state.recentlySold.set(sell.pubkey, Date.now());
          state.recentlySoldQuestions.set(sell.title.toLowerCase(), Date.now());
        } catch (err) {
          const errMsg = err instanceof Error ? err.message : String(err);
          callbacks.log(`[SELL:JUPITER] ❌ Failed to close: ${errMsg}`);
          state.failedSells.set(sell.pubkey, Date.now());
        }
      } else {
        callbacks.log(`[SELL:JUPITER] ❌ Jupiter service not available`);
        state.failedSells.set(sell.pubkey, Date.now());
      }
    }
  }
}
