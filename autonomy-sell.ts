/**
 * Sell phases and position review for Polymarket and Jupiter.
 * Single unified pipeline: auto-sell → LLM review → recovery mode.
 */

import { JupiterPredictionService, JUPITER_SERVICE_TYPE } from "./plugins/jupiter-prediction/service";
import type { AutonomyDeps, AutonomyCallbacks, AutonomyState } from "./autonomy-state";
import { recordTrade } from "./autonomy-state";
import {
  SELL_LOSS_THRESHOLD_AGGRESSIVE,
  SELL_PROFIT_THRESHOLD_AGGRESSIVE,
  TRAILING_STOP_ACTIVATE_PCT,
  TRAILING_STOP_DRAWDOWN_PCT,
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
export type JupPositionInfo = { marketId: string; pubkey: string; title: string; pnl: number; isYes: boolean; contracts: string; curPrice?: number };

// --- Unified position type for review ---

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
          // Skip only truly dead/empty positions — keep everything else for review
          if (pos.redeemable) continue;
          if (price < 0.01) continue;
          if ((pos.size ?? 0) < 1) continue;
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
            !state.recentlySold.has(pos.pubkey)
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

// --- Execute a sell on either platform ---

async function executeSell(
  deps: AutonomyDeps,
  callbacks: AutonomyCallbacks,
  state: AutonomyState,
  pos: ReviewablePosition,
  platform: "POLYMARKET" | "JUPITER",
  reason: string,
): Promise<boolean> {
  const key = pos.token ?? pos.pubkey ?? "";
  if (state.recentlySold.has(key) || state.failedSells.has(key)) return false;
  const sign = pos.pnl >= 0 ? "+" : "";

  if (platform === "POLYMARKET" && pos.token) {
    callbacks.log(`[SELL:POLYMARKET] "${pos.title}" ${sign}${pos.pnl.toFixed(0)}% — ${reason}`);
    await directPolymarketSell(deps, callbacks, state, pos.token, pos.shares ?? 0, pos.title, pos.curPrice);
    return true;
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
        return true;
      } catch (err) {
        const errMsg = err instanceof Error ? err.message : String(err);
        callbacks.log(`[SELL:JUPITER] ❌ Failed: ${errMsg}`);
        state.failedSells.set(pos.pubkey, Date.now());
      }
    }
  }
  return false;
}

// --- Claim settled Jupiter positions ---

export async function claimJupiterPositions(
  deps: AutonomyDeps,
  callbacks: AutonomyCallbacks,
  state: AutonomyState,
  jupClaimable: JupClaimTarget[],
): Promise<void> {
  if (jupClaimable.length === 0) return;

  let jupSvc: JupiterPredictionService | null = null;
  try {
    jupSvc = (await deps.runtime.getServiceLoadPromise(JUPITER_SERVICE_TYPE)) as unknown as JupiterPredictionService | null;
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

// --- Unified portfolio review: auto-sell + LLM review + recovery ---
// This replaces the old polymarketSellPhase + reviewAllPositions + jupiterSellClaimPhase
// with a single clean pipeline per platform.

export async function unifiedPortfolioReview(
  deps: AutonomyDeps,
  callbacks: AutonomyCallbacks,
  state: AutonomyState,
  platform: "POLYMARKET" | "JUPITER",
  positions: ReviewablePosition[],
  balance: number,
  lowBalance: boolean,
): Promise<void> {
  // In low-balance (sell-only) mode: clear failedSells cache so we retry everything
  if (lowBalance) {
    const before = state.failedSells.size;
    state.failedSells.clear();
    if (before > 0) callbacks.log(`[PORTFOLIO:${platform}] Cleared ${before} failed-sell entries (recovery mode)`);
  }

  // Filter to reviewable positions
  const reviewable = positions.filter((p) => {
    const key = p.token ?? p.pubkey ?? "";
    if (!key) return false;
    if (state.recentlySold.has(key)) return false;
    if (state.failedSells.has(key)) return false;
    if (state.stuckDust.has(key)) return false;
    if (platform === "POLYMARKET" && (p.shares ?? 0) < 1) return false;
    // Dust check only for Polymarket (has curPrice). Jupiter positions don't carry price.
    if (platform === "POLYMARKET" && (p.curPrice ?? 0) < 0.01) return false;
    return true;
  });

  if (reviewable.length === 0) {
    // Extra diagnostic: why nothing reviewable?
    const raw = positions.length;
    const recentlySoldCount = positions.filter((p) => state.recentlySold.has(p.token ?? p.pubkey ?? "")).length;
    const failedCount = positions.filter((p) => state.failedSells.has(p.token ?? p.pubkey ?? "")).length;
    const stuckCount = positions.filter((p) => state.stuckDust.has(p.token ?? p.pubkey ?? "")).length;
    const smallShares = positions.filter((p) => platform === "POLYMARKET" && (p.shares ?? 0) < 1).length;
    const dust = positions.filter((p) => platform === "POLYMARKET" && (p.curPrice ?? 0) < 0.01).length;
    callbacks.log(`[PORTFOLIO:${platform}] No reviewable positions (raw: ${raw}, recentlySold: ${recentlySoldCount}, failedSells: ${failedCount}, stuckDust: ${stuckCount}, tinyShares: ${smallShares}, dust: ${dust})`);
    return;
  }

  // === Step 1: Fetch price trends (needed for auto-sell + LLM review) ===
  const trendMap = new Map<string, PriceTrend>();
  if (platform === "POLYMARKET") {
    const trendFetches = reviewable.slice(0, 10).map(async (p) => {
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
  // TODO: Add Jupiter price trend fetch when API supports it

  // === Step 2: Auto-sell hard rules (no LLM needed) ===

  // Hard stop-loss: -20% → sell immediately
  const stopLossTargets = reviewable.filter((p) => p.pnl <= -20);

  // Trailing stop: position > +15% AND 24h trend dropping > 3% → lock in profits
  const trailingStopTargets = reviewable.filter((p) => {
    if (p.pnl >= TRAILING_STOP_ACTIVATE_PCT) {
      const trend = trendMap.get(p.token ?? "");
      if (trend && trend.direction === "down" && trend.change24h !== null && trend.change24h < -3) {
        return true;
      }
    }
    return false;
  });

  // Near-expiry: if price > 0.85, the market is almost resolved → take guaranteed profit
  const nearExpiryTargets = reviewable.filter((p) => {
    const price = p.curPrice ?? 0;
    return price >= 0.85 && p.pnl > 5;
  });

  const allAutoSell = new Set([...stopLossTargets, ...trailingStopTargets, ...nearExpiryTargets]);

  for (const pos of allAutoSell) {
    const key = pos.token ?? pos.pubkey ?? "";
    if (state.recentlySold.has(key) || state.failedSells.has(key)) continue;
    let reason: string;
    if (pos.pnl <= -20) reason = "auto-stop-loss";
    else if ((pos.curPrice ?? 0) >= 0.85 && pos.pnl > 5) reason = "near-expiry-take-profit";
    else reason = "trailing-stop-lock";
    await executeSell(deps, callbacks, state, pos, platform, reason);
  }

  // === Step 3: LLM review of remaining positions ===
  const autoSoldKeys = new Set([...allAutoSell].map((p) => p.token ?? p.pubkey ?? ""));
  const llmReviewable = reviewable.filter((p) => !autoSoldKeys.has(p.token ?? p.pubkey ?? ""));

  if (llmReviewable.length === 0) return;

  // If balance is critically low, LIQUIDATE EVERYTHING — sell all positions to recover capital
  if (lowBalance) {
    const sorted = [...llmReviewable].sort((a, b) => a.pnl - b.pnl);
    callbacks.log(`[PORTFOLIO:${platform}] LOW BALANCE RECOVERY — liquidating all ${sorted.length} positions`);
    for (const pos of sorted) {
      const sign = pos.pnl >= 0 ? "+" : "";
      const reason = pos.pnl < 0 ? `recovery-cut-loss (${sign}${pos.pnl.toFixed(0)}%)` : `recovery-take-profit (${sign}${pos.pnl.toFixed(0)}%)`;
      await executeSell(deps, callbacks, state, pos, platform, reason);
    }
    return;
  }

  // Build position list for LLM with trend context
  const sortedForReview = [...llmReviewable].sort((a, b) => b.pnl - a.pnl).slice(0, 12);
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

  callbacks.log(`[PORTFOLIO:${platform}] LLM reviewing ${llmReviewable.length} positions with trend data...`);
  const reviewText = await directLlmCall(
    deps,
    callbacks,
    `You are a disciplined prediction market portfolio manager. Today is ${new Date().toISOString().split("T")[0]}.

Your #1 goal: PROTECT CAPITAL and MAXIMIZE PROFITS. Every round-trip trade costs 3-5% in spread.

SELL RULES (follow strictly):
- PnL < -15%: SELL — the thesis is broken, cut losses.
- PnL -15% to -5% with DOWNWARD trend: SELL — getting worse, cut now.
- PnL -5% to 0%: HOLD — within normal noise, spread costs make selling unprofitable.
- PnL 0% to +10%: HOLD — gains are too small to justify selling after spread costs.
- PnL +10% to +30% with DOWNWARD trend: SELL — lock in profits before they evaporate.
- PnL +10% to +30% with UPWARD trend: HOLD — let winners run.
- PnL > +30%: SELL — take the money. No prediction market position gains forever.

CRITICAL RULES:
- Do NOT sell anything with PnL between -5% and +10%. The spread eats your profit.
- Do NOT hold losers hoping for a miracle. If it's -15% and falling, SELL.
- If a market resolves within 48 hours and is profitable, SELL — take guaranteed money.
- Trend data is your most important signal. DOWN trend on a winner = SELL.

Positions:
${llmPositionList}

Respond with one line per position:
<number>: SELL or HOLD — <reason citing PnL and trend data>`,
  );

  if (reviewText.length === 0) return;
  callbacks.log(`[PORTFOLIO:${platform}] ${reviewText.slice(0, 300)}`);

  for (let i = 0; i < sortedForReview.length; i++) {
    const sellPattern = new RegExp(`${i + 1}[:\\s]*SELL`, "i");
    if (!sellPattern.test(reviewText)) continue;
    const pos = sortedForReview[i]!;
    const key = pos.token ?? pos.pubkey ?? "";
    if (state.recentlySold.has(key) || state.failedSells.has(key)) continue;
    await executeSell(deps, callbacks, state, pos, platform, "portfolio-review");
  }
}

// --- Legacy exports for backward compat with autonomy.ts ---
// These just delegate to the unified pipeline.

export async function polymarketSellPhase(
  deps: AutonomyDeps,
  callbacks: AutonomyCallbacks,
  state: AutonomyState,
  _sellTargets: PolySellTarget[],
  _allSellable: PolySellTarget[],
  polyBalance: number,
  lowBalance: boolean,
  _sellLossThreshold: number,
): Promise<void> {
  // No-op: unifiedPortfolioReview handles everything now
  // This is kept as a placeholder since autonomy.ts still calls it
  void _sellTargets; void _allSellable; void polyBalance; void lowBalance; void _sellLossThreshold;
  void deps; void callbacks; void state;
}

export async function reviewAllPositions(
  deps: AutonomyDeps,
  callbacks: AutonomyCallbacks,
  state: AutonomyState,
  platform: "POLYMARKET" | "JUPITER",
  positions: ReviewablePosition[],
): Promise<void> {
  // No-op: unifiedPortfolioReview handles everything now
  void deps; void callbacks; void state; void platform; void positions;
}

export async function jupiterSellClaimPhase(
  deps: AutonomyDeps,
  callbacks: AutonomyCallbacks,
  state: AutonomyState,
  _jupSellTargets: JupSellTarget[],
  _jupClaimable: JupClaimTarget[],
  solBalance: number,
  lowSolBalance: boolean,
  _sellLossThreshold: number,
): Promise<void> {
  // Only handle claims here — the unified pipeline handles sells
  await claimJupiterPositions(deps, callbacks, state, _jupClaimable);
  void _jupSellTargets; void solBalance; void lowSolBalance; void _sellLossThreshold;
}
