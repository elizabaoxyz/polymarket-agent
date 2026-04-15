/**
 * Sell phases and position review for Polymarket and Jupiter.
 * Single unified pipeline: auto-sell → LLM review → recovery mode.
 */

import { directLlmCall } from "./autonomy-llm";
import type { AutonomyCallbacks, AutonomyDeps, AutonomyState } from "./autonomy-state";
import {
  computeJupTrend,
  getDropFromPeak,
  getPositionAgeDays,
  pruneStaleJupHistory,
  pruneStaleTracking,
  recordJupPriceSnapshot,
  trackPositionAge,
  updatePeakPrice,
} from "./autonomy-state";
import { directPolymarketSell } from "./autonomy-trade";
import {
  CAPITAL_PRESSURE_MAX_POSITIONS,
  CAPITAL_PRESSURE_MIN_BALANCE,
  DEAD_POSITION_PRICE,
  HARD_STOP_LOSS_PCT,
  HIGH_PRICE_SELL,
  PARTIAL_PROFIT_PRICE,
  PRICE_CEILING_SELL,
  TIME_DECAY_SELL_DAYS,
  TRAILING_STOP_DROP_PCT,
  TRAILING_STOP_MIN_PRICE,
} from "./config";
import { log } from "./log";
import type { PriceTrend } from "./market-intel";
import { computePriceTrend, fetchPolyPriceHistory } from "./market-intel";
import {
  JUPITER_SERVICE_TYPE,
  type JupiterPredictionService,
} from "./plugins/jupiter-prediction/service";
import { withRetry } from "./retry";
import { getSolanaKeypair } from "./solana-wallet";

// --- Position collection types ---

export type PolySellTarget = {
  token: string;
  shares: number;
  title: string;
  pnl: number;
  curPrice: number;
  daysLeft?: number;
};
export type JupSellTarget = { marketId: string; pubkey: string; title: string; pnl: number };
export type JupClaimTarget = { pubkey: string; title: string; payout: number };
export type JupPositionInfo = {
  marketId: string;
  pubkey: string;
  title: string;
  pnl: number;
  isYes: boolean;
  contracts: string;
  curPrice?: number;
};

/** Minimum shares for Polymarket CLOB position tracking.
 * CLOB enforces a server-side minimum of 5 shares per order, but we keep this
 * at 1 so small positions flow through to the sell function where the CLOB
 * rejection is caught and the position is correctly marked as stuckDust. */
const MIN_CLOB_SHARES = 1;

/** Price below which a position is effectively dead (can't sell, won't recover). */
const DEAD_PRICE_THRESHOLD = 0.03;

// --- Unified position type for review ---

export type ReviewablePosition = {
  token?: string;
  pubkey?: string;
  title: string;
  pnl: number;
  shares?: number;
  curPrice?: number;
  isYes?: boolean;
  contracts?: string;
  daysLeft?: number; // days until market resolution
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
  /** Positions that can't be sold (below CLOB min shares or dead price) — don't count toward limit */
  untradeableKeys: Set<string>;
}> {
  const ownedTitles = new Set<string>();
  const untradeableKeys = new Set<string>();
  const polySellTargets: PolySellTarget[] = [];
  const polyAllSellable: PolySellTarget[] = [];
  const jupSellTargets: JupSellTarget[] = [];
  const jupAllPositions: JupPositionInfo[] = [];
  const jupClaimable: JupClaimTarget[] = [];

  // Polymarket positions
  try {
    const funder = process.env.POLYMARKET_FUNDER_ADDRESS?.trim();
    if (!funder) {
      log.warn("sell", "POLYMARKET_FUNDER_ADDRESS not set — cannot fetch positions");
    }
    if (funder) {
      const posRes = await withRetry(
        () => fetch(`https://data-api.polymarket.com/positions?user=${funder}`),
        { label: "poly-positions" },
      );
      if (!posRes.ok) {
        log.warn("sell", `Polymarket positions API returned ${posRes.status} for ${funder.slice(0, 6)}...${funder.slice(-4)}`);
      }
      if (posRes.ok) {
        type PolyPosApi = {
          title?: string;
          asset: string;
          size: number;
          percentPnl: number;
          curPrice: number;
          redeemable?: boolean;
          end_date_iso?: string;
          endDate?: string;
        };
        const rawPositions = (await posRes.json()) as PolyPosApi[];
        let skippedRedeemable = 0;
        let skippedPrice = 0;
        let skippedSize = 0;
        if (rawPositions.length === 0) {
          log.warn("sell", `Polymarket Data API returned 0 positions for ${funder.slice(0, 6)}...${funder.slice(-4)} — verify this is the proxy wallet address (not EOA)`);
        } else {
          log.info("sell", `Polymarket Data API returned ${rawPositions.length} raw positions`);
        }
        for (const pos of rawPositions) {
          const pnl = pos.percentPnl ?? 0;
          const price = pos.curPrice ?? 0;
          // Skip truly dead/empty positions — don't count them toward position limit
          if (pos.redeemable) { skippedRedeemable++; continue; }
          if (price < 0.01) { skippedPrice++; continue; }
          if ((pos.size ?? 0) < 1) { skippedSize++; continue; }
          // Track positions that can't be sold — don't count toward position limit
          if (pos.size < MIN_CLOB_SHARES || price < DEAD_PRICE_THRESHOLD) {
            untradeableKeys.add(pos.asset);
            // Don't add untradeable positions to ownedTitles — they shouldn't block
            // buying new positions in the same event (especially on Jupiter where the
            // market pool is tiny and event-level dedup would block everything)
          } else if (pos.title) {
            ownedTitles.add(pos.title.toLowerCase());
          }
          let daysLeft: number | undefined;
          const endDateStr =
            pos.end_date_iso ?? ((pos as Record<string, unknown>).endDate as string | undefined);
          if (endDateStr) {
            daysLeft = Math.max(0, (new Date(endDateStr).getTime() - Date.now()) / 86400000);
          }
          polyAllSellable.push({
            token: pos.asset,
            shares: pos.size,
            title: pos.title ?? "",
            pnl,
            curPrice: price,
            ...(daysLeft !== undefined ? { daysLeft } : {}),
          });
          if (pnl < sellLossThreshold || pnl > sellProfitThreshold) {
            polySellTargets.push({
              token: pos.asset,
              shares: pos.size,
              title: pos.title ?? "",
              pnl,
              curPrice: price,
              ...(daysLeft !== undefined ? { daysLeft } : {}),
            });
          }
        }
        if (skippedRedeemable > 0 || skippedPrice > 0 || skippedSize > 0) {
          log.info("sell", `Polymarket positions filtered: ${skippedRedeemable} redeemable, ${skippedPrice} dead-price, ${skippedSize} tiny-size → ${polyAllSellable.length} tradeable`);
        }
      }
    }
  } catch (err) {
    log.warn(
      "sell",
      `Polymarket position fetch failed: ${err instanceof Error ? err.message : String(err)}`,
    );
  }

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
          marketId: string;
          pubkey: string;
          isYes: boolean;
          contracts: string;
          pnlUsdPercent: number;
          eventMetadata?: { title?: string };
          marketMetadata?: { title?: string };
          claimable?: boolean;
          claimed?: boolean;
          payoutUsd?: number;
          markPriceUsd?: string;
        };
        for (const pos of ((await posRes.json()) as { data?: JupPosApi[] }).data ?? []) {
          const title = pos.eventMetadata?.title ?? pos.marketId ?? "";
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
          const markPrice = Number(pos.markPriceUsd ?? "0") / 1_000_000;
          // Check untradeable BEFORE adding to ownedTitles — dead positions
          // shouldn't block buying new positions in the same event
          const isUntradeable = pos.pubkey && markPrice < DEAD_PRICE_THRESHOLD;
          if (!isUntradeable && title) {
            ownedTitles.add(title.toLowerCase());
          }
          if (pos.pubkey) {
            jupAllPositions.push({
              marketId: pos.marketId,
              pubkey: pos.pubkey,
              title: pos.marketMetadata?.title ?? pos.marketId,
              pnl,
              isYes: pos.isYes ?? true,
              contracts: pos.contracts ?? "0",
              curPrice: markPrice,
            });
          }
          // Track Jupiter positions with dead prices as untradeable
          if (isUntradeable) {
            untradeableKeys.add(pos.pubkey!);
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
  } catch (err) {
    log.warn(
      "sell",
      `Jupiter position fetch failed: ${err instanceof Error ? err.message : String(err)}`,
    );
  }

  return {
    ownedTitles,
    polySellTargets,
    polyAllSellable,
    jupSellTargets,
    jupAllPositions,
    jupClaimable,
    untradeableKeys,
  };
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
    await directPolymarketSell(
      deps,
      callbacks,
      state,
      pos.token,
      pos.shares ?? 0,
      pos.title,
      pos.curPrice,
    );
    return true;
  } else if (platform === "JUPITER" && pos.pubkey) {
    callbacks.log(`[SELL:JUPITER] "${pos.title}" ${sign}${pos.pnl.toFixed(0)}% — ${reason}`);
    let jupSvc: JupiterPredictionService | null = null;
    try {
      jupSvc = (await deps.runtime.getServiceLoadPromise(
        JUPITER_SERVICE_TYPE,
      )) as unknown as JupiterPredictionService | null;
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

// --- Unified portfolio review: auto-sell + LLM review + recovery ---

export async function unifiedPortfolioReview(
  deps: AutonomyDeps,
  callbacks: AutonomyCallbacks,
  state: AutonomyState,
  platform: "POLYMARKET" | "JUPITER",
  positions: ReviewablePosition[],
  balance: number,
  lowBalance: boolean,
): Promise<void> {
  if (lowBalance) {
    const before = state.failedSells.size;
    state.failedSells.clear();
    if (before > 0)
      callbacks.log(
        `[PORTFOLIO:${platform}] Cleared ${before} failed-sell entries (recovery mode)`,
      );
  }

  const reviewable = positions.filter((p) => {
    const key = p.token ?? p.pubkey ?? "";
    if (!key) return false;
    if (state.recentlySold.has(key)) return false;
    if (state.failedSells.has(key)) return false;
    if (state.stuckDust.has(key)) return false;
    if (platform === "POLYMARKET" && (p.shares ?? 0) < 1) return false;
    if (platform === "POLYMARKET" && (p.curPrice ?? 0) < 0.01) return false;
    // Jupiter positions with no price data ($0.00) can't be evaluated — skip LLM review
    if (platform === "JUPITER" && (p.curPrice === undefined || p.curPrice === 0)) return false;
    return true;
  });

  if (reviewable.length === 0) {
    const raw = positions.length;
    const recentlySoldCount = positions.filter((p) =>
      state.recentlySold.has(p.token ?? p.pubkey ?? ""),
    ).length;
    const failedCount = positions.filter((p) =>
      state.failedSells.has(p.token ?? p.pubkey ?? ""),
    ).length;
    const stuckCount = positions.filter((p) =>
      state.stuckDust.has(p.token ?? p.pubkey ?? ""),
    ).length;
    callbacks.log(
      `[PORTFOLIO:${platform}] No reviewable positions (raw: ${raw}, sold: ${recentlySoldCount}, failed: ${failedCount}, stuck: ${stuckCount})`,
    );
    return;
  }

  // === Track peak prices + position ages for all positions ===
  const activeKeys = new Set<string>();
  const jupActiveKeys = new Set<string>();
  for (const p of reviewable) {
    const key = p.token ?? p.pubkey ?? "";
    activeKeys.add(key);
    if (p.curPrice !== undefined && p.curPrice > 0) {
      updatePeakPrice(state, key, p.curPrice);
    }
    trackPositionAge(state, key);
    // Track Jupiter price snapshots for trend computation
    if (platform === "JUPITER" && p.pubkey && p.curPrice && p.curPrice > 0) {
      jupActiveKeys.add(p.pubkey);
      recordJupPriceSnapshot(state, p.pubkey, p.curPrice);
    }
  }
  pruneStaleTracking(state, activeKeys);
  if (platform === "JUPITER") {
    pruneStaleJupHistory(state, jupActiveKeys);
  }

  // === Fetch price trends (Polymarket: from API, Jupiter: from in-memory snapshots) ===
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
  // For Jupiter: use in-memory price snapshots for trend detection
  if (platform === "JUPITER") {
    for (const p of reviewable) {
      if (!p.pubkey) continue;
      const jupTrend = computeJupTrend(state, p.pubkey);
      if (jupTrend) {
        // Convert to PriceTrend format for uniform processing
        trendMap.set(p.pubkey, {
          current: p.curPrice ?? 0,
          change1h: null,
          change6h: null,
          change24h: jupTrend.changePct,
          direction: jupTrend.direction,
          momentum: jupTrend.direction === "up" ? 0.5 : jupTrend.direction === "down" ? -0.5 : 0,
        });
      }
    }
  }

  // === Price-based auto-sell rules (no LLM needed) ===
  const autoSellSet = new Set<ReviewablePosition>();

  for (const p of reviewable) {
    const key = p.token ?? p.pubkey ?? "";
    const price = p.curPrice ?? 0;
    const pnl = p.pnl;
    const age = getPositionAgeDays(state, key);
    const trend = trendMap.get(key);
    const dropFromPeak = getDropFromPeak(state, key, price);

    let reason = "";

    // Rule 1: Price ceiling — max 18% upside, 85% downside
    if (price >= PRICE_CEILING_SELL) {
      reason = `price-ceiling ($${price.toFixed(2)} >= $${PRICE_CEILING_SELL})`;
    }
    // Rule 2: High price + stale — upside thinning, capital better elsewhere
    else if (price >= HIGH_PRICE_SELL && age > 1) {
      reason = `high-price-stale ($${price.toFixed(2)}, ${age.toFixed(1)}d old)`;
    }
    // Rule 3: High price + falling trend
    else if (price >= TRAILING_STOP_MIN_PRICE && trend?.direction === "down") {
      reason = `high-price-falling ($${price.toFixed(2)}, trend=${trend.direction})`;
    }
    // Rule 4: Dead position — thesis was wrong
    else if (price > 0 && price < DEAD_POSITION_PRICE) {
      reason = `dead-position ($${price.toFixed(2)} < $${DEAD_POSITION_PRICE})`;
    }
    // Rule 5: Hard stop-loss on PnL
    else if (pnl <= HARD_STOP_LOSS_PCT) {
      reason = `hard-stop-loss (${pnl.toFixed(0)}% <= ${HARD_STOP_LOSS_PCT}%)`;
    }
    // Rule 6: Trailing stop — only above min price, drops from peak
    else if (price >= TRAILING_STOP_MIN_PRICE && dropFromPeak >= TRAILING_STOP_DROP_PCT) {
      reason = `trailing-stop (peak $${state.peakPrice.get(key)?.toFixed(2)}, now $${price.toFixed(2)}, drop ${dropFromPeak.toFixed(1)}%)`;
    }
    // Rule 7: Stale position — no significant movement for 3+ days, capital is trapped
    else if (age > 2 && price >= 0.35 && price <= 0.65 && Math.abs(pnl) < 5) {
      reason = `stale-position (${age.toFixed(1)}d old, ${pnl >= 0 ? "+" : ""}${pnl.toFixed(0)}% PnL, price $${price.toFixed(2)} — capital trapped)`;
    }
    // Rule 8: Time-decay — sell positions in no-man's land near resolution
    else if (p.daysLeft !== undefined && p.daysLeft < TIME_DECAY_SELL_DAYS) {
      if (price >= 0.4 && price <= 0.7) {
        reason = `time-decay (${p.daysLeft.toFixed(1)}d to resolve, price $${price.toFixed(2)} in no-man's land)`;
      } else if (price < 0.25 && price > 0) {
        reason = `time-decay-loser (${p.daysLeft.toFixed(1)}d to resolve, price $${price.toFixed(2)} — thesis wrong)`;
      }
    }

    if (reason) {
      autoSellSet.add(p);
      await executeSell(deps, callbacks, state, p, platform, reason);
    }
  }

  // === Partial profit: sell 50% of position at high price (Polymarket only) ===
  if (platform === "POLYMARKET") {
    for (const p of reviewable) {
      if (autoSellSet.has(p)) continue;
      const price = p.curPrice ?? 0;
      const shares = p.shares ?? 0;
      if (price >= PARTIAL_PROFIT_PRICE && shares > 10) {
        const halfShares = Math.floor(shares / 2);
        if (halfShares >= 5) {
          // CLOB minimum
          const key = p.token ?? "";
          if (state.recentlySold.has(key) || state.failedSells.has(key)) continue;
          const partialPos = { ...p, shares: halfShares };
          callbacks.log(
            `[SELL:POLYMARKET] Partial profit: "${p.title}" $${price.toFixed(2)} — selling ${halfShares}/${shares} shares`,
          );
          await executeSell(
            deps,
            callbacks,
            state,
            partialPos,
            platform,
            `partial-profit ($${price.toFixed(2)}, ${halfShares}/${shares} shares)`,
          );
        }
      }
    }
  }

  // === Capital pressure: sell weakest positions when balance critical ===
  if (
    balance < CAPITAL_PRESSURE_MIN_BALANCE &&
    reviewable.length > CAPITAL_PRESSURE_MAX_POSITIONS
  ) {
    const unsold = reviewable.filter((p) => !autoSellSet.has(p));
    const sorted = [...unsold].sort((a, b) => a.pnl - b.pnl);
    const toSell = sorted.slice(0, 3);
    callbacks.log(
      `[PORTFOLIO:${platform}] CAPITAL PRESSURE — selling ${toSell.length} weakest positions`,
    );
    for (const p of toSell) {
      autoSellSet.add(p);
      const sign = p.pnl >= 0 ? "+" : "";
      await executeSell(
        deps,
        callbacks,
        state,
        p,
        platform,
        `capital-pressure (${sign}${p.pnl.toFixed(0)}%)`,
      );
    }
  }

  // === Low balance recovery: liquidate everything ===
  if (lowBalance) {
    const unsold = reviewable.filter((p) => !autoSellSet.has(p));
    if (unsold.length > 0) {
      const sorted = [...unsold].sort((a, b) => a.pnl - b.pnl);
      callbacks.log(
        `[PORTFOLIO:${platform}] LOW BALANCE RECOVERY — liquidating ${sorted.length} positions`,
      );
      for (const p of sorted) {
        const sign = p.pnl >= 0 ? "+" : "";
        await executeSell(
          deps,
          callbacks,
          state,
          p,
          platform,
          `recovery (${sign}${p.pnl.toFixed(0)}%)`,
        );
      }
    }
    return;
  }

  // === LLM review for ambiguous positions only ===
  const llmReviewable = reviewable.filter((p) => !autoSellSet.has(p));
  if (llmReviewable.length === 0) return;

  const sortedForReview = [...llmReviewable]
    .sort((a, b) => b.pnl - a.pnl)
    .slice(0, 12);
  const llmPositionList = sortedForReview
    .map((p, i) => {
      const dir = p.isYes !== undefined ? (p.isYes ? "YES" : "NO") : "";
      const qty = p.shares ?? p.contracts ?? "?";
      const sign = p.pnl >= 0 ? "+" : "";
      const age = getPositionAgeDays(state, p.token ?? p.pubkey ?? "");
      let trendStr = "";
      const trend = trendMap.get(p.token ?? p.pubkey ?? "");
      if (trend) {
        const parts: string[] = [];
        if (trend.change1h !== null)
          parts.push(`1h: ${trend.change1h > 0 ? "+" : ""}${trend.change1h.toFixed(1)}%`);
        if (trend.change24h !== null)
          parts.push(`24h: ${trend.change24h > 0 ? "+" : ""}${trend.change24h.toFixed(1)}%`);
        trendStr = ` | trend: ${trend.direction} (${parts.join(", ")})`;
      }
      return `${i + 1}. "${p.title}" — PnL: ${sign}${p.pnl.toFixed(0)}%, ${dir} ${qty} units, price: $${(p.curPrice ?? 0).toFixed(2)}, age: ${age.toFixed(1)}d${trendStr}`;
    })
    .join("\n");

  callbacks.log(
    `[PORTFOLIO:${platform}] LLM reviewing ${sortedForReview.length} ambiguous positions...`,
  );
  const reviewText = await directLlmCall(
    deps,
    callbacks,
    `You are a disciplined prediction market portfolio manager. Today is ${new Date().toISOString().split("T")[0]}.

BINARY MARKET RULES — these markets pay $1 or $0. Current PRICE determines risk/reward, not your entry cost.

SELL RULES (price-based — this is what matters in binary markets):
- Price > $0.75: SELL — max 33% upside, 75% downside. Terrible risk/reward.
- Price > $0.65 with DOWNWARD trend: SELL — momentum fading, lock in gains.
- Price < $0.15: SELL — thesis is likely wrong. Salvage remaining value.
- PnL < -15% with DOWNWARD trend: SELL — getting worse, cut losses.
- PnL -5% to +10%: HOLD — within noise, spread costs make selling unprofitable.
- PnL > +10% with UPWARD trend: HOLD — let winners run.

CRITICAL: The PRICE is more important than PnL%. A position at $0.70 has 43% max upside regardless of what you paid.

Positions:
${llmPositionList}

Respond with one line per position:
<number>: SELL or HOLD — <reason citing price and trend>`,
  );

  if (reviewText.length === 0) return;
  callbacks.log(`[PORTFOLIO:${platform}] ${reviewText.slice(0, 300)}`);

  for (let i = 0; i < sortedForReview.length; i++) {
    const sellPattern = new RegExp(`(?:^|\\n)${i + 1}[:\\s]*SELL`, "im");
    if (!sellPattern.test(reviewText)) continue;
    const pos = sortedForReview[i]!;
    const key = pos.token ?? pos.pubkey ?? "";
    if (state.recentlySold.has(key) || state.failedSells.has(key)) continue;
    await executeSell(deps, callbacks, state, pos, platform, "portfolio-review");
  }
}
