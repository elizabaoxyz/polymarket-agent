/**
 * Market scanning and scoring for Polymarket and Jupiter.
 * Extracted from autonomy.ts for maintainability.
 */

import { withRetry } from "./retry";
import {
  SCORE_SPREAD_WEIGHT,
  SCORE_MIDPOINT_WEIGHT,
  SCORE_TIME_WEIGHT,
  SCORE_VOLUME_WEIGHT,
  SCORE_MOMENTUM_WEIGHT,
  SCORE_DEPTH_WEIGHT,
  SCORE_PRICE_SWEET_SPOT_WEIGHT,
  PRICE_SWEET_SPOT_MIN,
  PRICE_SWEET_SPOT_MAX,
  JUP_PRICE_MIN,
  JUP_PRICE_MAX,
  MIN_DEPTH_USD,
  CONTRARIAN_BONUS,
  MIN_POLY_VOLUME,
  MIN_JUP_VOLUME,
  POLY_PRICE_MIN,
  POLY_PRICE_MAX,
  QUICK_FLIP_MAX_DAYS,
  QUICK_FLIP_BONUS,
  MARKET_MAX_DAYS,
} from "./config";
import type { AutonomyState, AutonomyCallbacks } from "./autonomy-state";
import { isRecentlyTraded, isFailCooledDown } from "./autonomy-state";
import { FAILED_BUY_COOLDOWN_MS } from "./config";
import {
  type MarketIntel,
  gatherPolyIntel,
  gatherJupIntel,
} from "./market-intel";

// --- Scored market types ---

export type ScoredMarket = {
  question: string;
  yesPrice: number;
  score: number;
  volume: number;
  daysLeft: number;
  tokenId: string;
  conditionId: string | undefined;
  intel: MarketIntel | null;
};

export type JupMarket = {
  question: string;
  marketId: string;
  yesPrice: number;
  score: number;
  volume: number;
  intel: MarketIntel | null;
};

// --- Polymarket scanner ---

export async function scanPolymarketMarkets(
  ownedTitles: Set<string>,
  state: AutonomyState,
  callbacks: AutonomyCallbacks,
): Promise<ScoredMarket[]> {
  const scored: ScoredMarket[] = [];
  const res = await withRetry(
    () => fetch("https://clob.polymarket.com/sampling-markets"),
    { label: "polymarket-scan" },
  );
  const data = await res.json();
  for (const m of (data.data ?? []).filter(
    (x: Record<string, unknown>) => x.active && !x.closed && x.accepting_orders,
  )) {
    const yes = (m.tokens ?? []).find((t: Record<string, unknown>) => t.outcome === "Yes");
    const no = (m.tokens ?? []).find((t: Record<string, unknown>) => t.outcome === "No");
    if (!yes) continue;
    const yp = Number(yes.price);
    const np = no ? Number(no.price) : 1 - yp;
    if (yp < POLY_PRICE_MIN || yp > POLY_PRICE_MAX) continue;
    const q = String(m.question ?? "");
    if (ownedTitles.has(q.toLowerCase())) continue;
    if (isRecentlyTraded(state, q)) continue;
    if (state.recentlySoldQuestions.has(q.toLowerCase())) continue;
    if (state.pendingBuys.has(q.toLowerCase())) continue;

    const spread = Math.abs(np - yp);
    const midpoint = (yp + np) / 2;
    const spreadScore = Math.max(0, 1 - spread / 0.15);
    const midScore = 1 - Math.abs(midpoint - 0.5) * 2;

    const endDate = m.end_date_iso ?? m.endDate;
    let daysLeft = 365;
    if (endDate) {
      daysLeft = Math.max(0, (new Date(endDate as string).getTime() - Date.now()) / 86400000);
      if (daysLeft > MARKET_MAX_DAYS) continue;
    }
    // Quick flip: score SHORT duration higher — faster resolution = faster compounding
    // Peak score at 3 days, decays as market gets longer
    // Anything > 14 days gets minimal time score
    let timeScore: number;
    if (daysLeft <= QUICK_FLIP_MAX_DAYS) {
      // Sweet spot: 1-7 days — these resolve fast for quick profit
      const distFrom3 = Math.abs(daysLeft - 3);
      timeScore = Math.max(0.6, 1 - distFrom3 / 5);
    } else if (daysLeft <= 14) {
      // Acceptable: 7-14 days
      timeScore = Math.max(0.2, 0.6 - (daysLeft - QUICK_FLIP_MAX_DAYS) / 14);
    } else {
      // Too slow: 14+ days — low priority
      timeScore = Math.max(0, 0.2 - (daysLeft - 14) / 76);
    }
    const volume = Number(m.volume ?? m.rewards?.dailyRate ?? 0);
    if (volume < MIN_POLY_VOLUME) continue;
    const volumeScore = Math.min(1, volume / 5000);

    const tokenId = String(yes.token_id ?? "");
    const conditionId = m.condition_id ? String(m.condition_id) : undefined;

    const score =
      spreadScore * SCORE_SPREAD_WEIGHT +
      midScore * SCORE_MIDPOINT_WEIGHT +
      timeScore * SCORE_TIME_WEIGHT +
      volumeScore * SCORE_VOLUME_WEIGHT;

    // Price sweet spot bonus: markets priced 25–55¢ have the best risk/reward
    // Buying YES at 40¢ gives 1.5:1 ratio vs buying at 70¢ which gives 0.43:1
    let priceSweetSpot = 0;
    if (yp >= PRICE_SWEET_SPOT_MIN && yp <= PRICE_SWEET_SPOT_MAX) {
      // Peak bonus at 0.40, tapering toward edges
      const distFrom40 = Math.abs(yp - 0.40);
      priceSweetSpot = Math.max(0, 1 - distFrom40 / 0.20);
    }
    // Quick flip bonus: short-duration markets get extra score
    const quickFlipBonus = daysLeft <= QUICK_FLIP_MAX_DAYS ? QUICK_FLIP_BONUS : 0;
    const adjustedScore = score + priceSweetSpot * SCORE_PRICE_SWEET_SPOT_WEIGHT + quickFlipBonus;

    scored.push({ question: q, yesPrice: yp, score: adjustedScore, volume, daysLeft, tokenId, conditionId, intel: null });
  }
  scored.sort((a, b) => b.score - a.score);

  // Gather market intelligence for top candidates (parallel, capped at 5)
  const topN = scored.slice(0, 5);
  if (topN.length > 0) {
    callbacks.log(`[INTEL:POLY] Gathering price history + depth for top ${topN.length} markets...`);
    const intelResults = await Promise.allSettled(
      topN.map((m) => gatherPolyIntel(m.tokenId, m.conditionId, m.yesPrice, m.question)),
    );
    for (let i = 0; i < topN.length; i++) {
      const result = intelResults[i]!;
      if (result.status === "fulfilled") {
        const intel = result.value;
        topN[i]!.intel = intel;

        if (intel.trend) {
          const momentumScore = (intel.trend.momentum + 1) / 2;
          topN[i]!.score += (momentumScore - 0.5) * SCORE_MOMENTUM_WEIGHT * 2;
        }

        if (intel.depth) {
          const depthScore = Math.min(1, intel.depth.totalDepthUsd / (MIN_DEPTH_USD * 5));
          topN[i]!.score += depthScore * SCORE_DEPTH_WEIGHT;
          if (intel.depth.imbalance > 0.3) {
            topN[i]!.score += 0.03;
          }
        }

        if (intel.isContrarian) {
          topN[i]!.score += CONTRARIAN_BONUS;
          callbacks.log(`[INTEL:POLY] ⚠️ "${topN[i]!.question.slice(0, 50)}" — contrarian signal: ${intel.contrarian24hMove!.toFixed(0)}% 24h move`);
        }

        if (intel.depth && !intel.depth.isLiquid) {
          callbacks.log(`[INTEL:POLY] ❌ "${topN[i]!.question.slice(0, 50)}" — illiquid ($${intel.depth.totalDepthUsd.toFixed(0)} depth), deprioritized`);
          topN[i]!.score *= 0.3;
        }
      }
    }
    scored.sort((a, b) => b.score - a.score);
  }

  return scored;
}

// --- Jupiter scanner ---

export async function scanJupiterMarkets(
  ownedTitles: Set<string>,
  state: AutonomyState,
  callbacks: AutonomyCallbacks,
): Promise<JupMarket[]> {
  const jupApiKey = process.env.JUPITER_API_KEY?.trim();
  if (!jupApiKey) return [];

  const jupScored: JupMarket[] = [];
  const res = await withRetry(
    () =>
      fetch("https://api.jup.ag/prediction/v1/events?status=live", {
        headers: { "x-api-key": jupApiKey },
      }),
    { label: "jupiter-scan" },
  );
  const evData = await res.json();
  let _jupDbgTotal = 0, _jupDbgPrice = 0, _jupDbgVol = 0, _jupDbgOwned = 0;
  for (const event of (evData.data ?? [])) {
    for (const m of (event.markets ?? []).filter(
      (x: Record<string, unknown>) => x.status === "open",
    )) {
      _jupDbgTotal++;
      const yp = Number(m.pricing?.buyYesPriceUsd ?? 0) / 1_000_000;
      const np = Number(m.pricing?.buyNoPriceUsd ?? 0) / 1_000_000;
      if (yp < JUP_PRICE_MIN || yp > JUP_PRICE_MAX) { _jupDbgPrice++; continue; }

      const closeTime = Number(m.closeTime ?? 0);
      let jupDaysLeft = 365;
      if (closeTime > 0) {
        jupDaysLeft = (closeTime * 1000 - Date.now()) / 86_400_000;
        if (jupDaysLeft > MARKET_MAX_DAYS) continue;
      }
      // Quick flip scoring: same logic as Polymarket
      let jupTimeScore: number;
      if (jupDaysLeft <= QUICK_FLIP_MAX_DAYS) {
        const distFrom3 = Math.abs(jupDaysLeft - 3);
        jupTimeScore = Math.max(0.6, 1 - distFrom3 / 5);
      } else if (jupDaysLeft <= 14) {
        jupTimeScore = Math.max(0.2, 0.6 - (jupDaysLeft - QUICK_FLIP_MAX_DAYS) / 14);
      } else {
        jupTimeScore = Math.max(0, 0.2 - (jupDaysLeft - 14) / 76);
      }

      const effectiveNp = np > 0 ? np : 1 - yp;
      const spread = Math.abs(effectiveNp - yp);
      const mid = (yp + effectiveNp) / 2;
      const spreadScore = Math.max(0, 1 - spread / 0.15);
      const midScore = 1 - Math.abs(mid - 0.5) * 2;
      const volume = Number(m.pricing?.volume ?? 0) / 1_000_000;
      if (volume < MIN_JUP_VOLUME) { _jupDbgVol++; continue; }
      const volumeScore = Math.min(1, volume / 10000);
      const score = spreadScore * SCORE_SPREAD_WEIGHT + midScore * SCORE_MIDPOINT_WEIGHT + volumeScore * SCORE_VOLUME_WEIGHT + jupTimeScore * SCORE_TIME_WEIGHT;

      // Price sweet spot bonus
      let priceSweetSpot = 0;
      if (yp >= PRICE_SWEET_SPOT_MIN && yp <= PRICE_SWEET_SPOT_MAX) {
        const distFrom40 = Math.abs(yp - 0.40);
        priceSweetSpot = Math.max(0, 1 - distFrom40 / 0.20);
      }
      // Quick flip bonus
      const quickFlipBonus = jupDaysLeft <= QUICK_FLIP_MAX_DAYS ? QUICK_FLIP_BONUS : 0;
      const adjustedScore = score + priceSweetSpot * SCORE_PRICE_SWEET_SPOT_WEIGHT + quickFlipBonus;

      const q = `${event.metadata?.title} — ${m.metadata?.title}`;
      const marketTitle = (m.metadata?.title ?? "").toLowerCase();
      const eventTitle = (event.metadata?.title ?? "").toLowerCase();
      if (ownedTitles.has(marketTitle) || ownedTitles.has(`${eventTitle} — ${marketTitle}`)) { _jupDbgOwned++; continue; }
      if (isRecentlyTraded(state, q)) continue;
      if (state.recentlySoldQuestions.has(q.toLowerCase())) continue;
      if (state.pendingBuys.has(q.toLowerCase())) continue;
      if (!isFailCooledDown(state.failedBuys, m.marketId, FAILED_BUY_COOLDOWN_MS)) continue;
      if (state.skippedMarkets.has(q.toLowerCase())) continue;
      jupScored.push({ question: q, marketId: m.marketId, yesPrice: yp, score: adjustedScore, volume, intel: null });
    }
  }
  jupScored.sort((a, b) => b.score - a.score);

  // Gather market intelligence for top Jupiter candidates
  const topN = jupScored.slice(0, 5);
  if (topN.length > 0 && jupApiKey) {
    callbacks.log(`[INTEL:JUP] Gathering depth for top ${topN.length} markets...`);
    const intelResults = await Promise.allSettled(
      topN.map((m) => gatherJupIntel(m.marketId, m.yesPrice, m.question, jupApiKey)),
    );
    for (let i = 0; i < topN.length; i++) {
      const result = intelResults[i]!;
      if (result.status === "fulfilled") {
        const intel = result.value;
        topN[i]!.intel = intel;

        if (intel.depth) {
          const depthScore = Math.min(1, intel.depth.totalDepthUsd / (MIN_DEPTH_USD * 3));
          topN[i]!.score += depthScore * SCORE_DEPTH_WEIGHT;
          if (intel.depth.imbalance > 0.3) topN[i]!.score += 0.03;
        }

        if (intel.depth && !intel.depth.isLiquid) {
          callbacks.log(`[INTEL:JUP] ❌ "${topN[i]!.question.slice(0, 50)}" — illiquid ($${intel.depth.totalDepthUsd.toFixed(0)} depth), deprioritized`);
          topN[i]!.score *= 0.3;
        }
      }
    }
    jupScored.sort((a, b) => b.score - a.score);
  }

  // Attach debug info as non-enumerable property
  (jupScored as unknown as { _debug?: string })._debug =
    `${_jupDbgTotal} scanned, filtered: price=${_jupDbgPrice}, volume=${_jupDbgVol}, owned=${_jupDbgOwned}, passed=${jupScored.length}`;
  return jupScored;
}
