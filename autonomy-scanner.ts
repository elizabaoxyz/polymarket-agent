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
  LLM_KNOWLEDGE_BONUS,
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
  noTokenId: string;
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

/**
 * Score how well an LLM can analyze this market.
 * Markets about crypto prices, major US politics, big sports, and tech
 * get a bonus because LLMs have real knowledge there.
 * Foreign elections and niche politics get penalized.
 */
function llmKnowledgeBonus(question: string): number {
  const q = question.toLowerCase();

  // Penalize foreign elections FIRST (before the "presidential" match catches them)
  if (/\b(peru|peruvian|hungary|hungarian|eurovision|bolivia|ecuador|colombia|paraguay|chile|brazil|mexico|kenya|nigeria|philippines|indonesia)\b/.test(q)) return -0.5;

  // Crypto: LLMs can check current prices vs targets
  if (/\b(btc|bitcoin|eth|ethereum|sol|solana|crypto|token|defi|stablecoin)\b/.test(q)) return 1.0;

  // Tech / AI / major companies
  if (/\b(apple|google|meta|microsoft|openai|nvidia|tesla|spacex|ai |artificial intelligence|iphone|android)\b/.test(q)) return 0.9;

  // Major sports with available data
  if (/\b(nba|nfl|mlb|nhl|premier league|champions league|world cup|super bowl|stanley cup|world series|formula 1|f1 |ufc |boxing)\b/.test(q)) return 0.8;

  // US presidential / major US federal politics only
  if (/\b(us |u\.s\.|united states|american).*(president|congress|senate)/.test(q)) return 0.7;
  if (/\b(trump|biden|desantis|newsom|harris|democrat|republican).*(president|election|2028|2026)/.test(q)) return 0.7;

  // Major global events with clear data
  if (/\b(war|nato|ceasefire|israel|iran|ukraine|russia|tariff|trade war)\b/.test(q)) return 0.5;

  // Niche: state primaries, foreign elections, obscure nominations → penalize
  if (/\b(primary|nominee|nomination|gubernatorial|governor)\b/.test(q)) return -0.3;
  if (/\b(prime minister|parliament|coalition)\b/.test(q)) return -0.3;

  return 0;
}

// --- Polymarket scanner ---

export async function scanPolymarketMarkets(
  ownedTitles: Set<string>,
  state: AutonomyState,
  callbacks: AutonomyCallbacks,
): Promise<ScoredMarket[]> {
  const scored: ScoredMarket[] = [];

  // Fetch from both sampling-markets (random 1000) and gamma-api (top by volume)
  // Fetch from 3 sources in parallel: sampling (random), gamma by volume, gamma by soonest end
  const [samplingRes, gammaVolRes, gammaEndRes] = await Promise.allSettled([
    withRetry(() => fetch("https://clob.polymarket.com/sampling-markets"), { label: "poly-sampling" }),
    withRetry(
      () => fetch("https://gamma-api.polymarket.com/markets?closed=false&active=true&order=volume24hr&ascending=false&limit=300"),
      { label: "poly-gamma-vol" },
    ),
    withRetry(
      () => fetch("https://gamma-api.polymarket.com/markets?closed=false&active=true&order=end_date&ascending=true&limit=300"),
      { label: "poly-gamma-end" },
    ),
  ]);

  const allMarkets: Record<string, unknown>[] = [];
  const seenQuestions = new Set<string>();

  // Parse sampling-markets
  if (samplingRes.status === "fulfilled") {
    const data = await samplingRes.value.json();
    for (const m of (data.data ?? []).filter(
      (x: Record<string, unknown>) => x.active && !x.closed && x.accepting_orders,
    )) {
      const q = String(m.question ?? "");
      if (!seenQuestions.has(q)) { allMarkets.push(m); seenQuestions.add(q); }
    }
  }

  // Parse gamma-api markets (both volume-sorted and end-date-sorted)
  const gammaSources = [gammaVolRes, gammaEndRes];
  for (const gammaRes of gammaSources) {
    if (gammaRes.status !== "fulfilled") continue;
    const gammaData = await gammaRes.value.json();
    for (const g of Array.isArray(gammaData) ? gammaData : []) {
      const q = String(g.question ?? "");
      if (seenQuestions.has(q)) continue;
      // Gamma API returns outcomes/prices/tokenIds as JSON-encoded string arrays like '["Yes","No"]'
      let outcomes: string[] = [];
      let prices: string[] = [];
      let ids: string[] = [];
      try {
        outcomes = JSON.parse(String(g.outcomes ?? "[]"));
      } catch { outcomes = String(g.outcomes ?? "").split(","); }
      try {
        prices = JSON.parse(String(g.outcomePrices ?? "[]"));
      } catch { prices = String(g.outcomePrices ?? "").split(","); }
      try {
        ids = JSON.parse(String(g.clobTokenIds ?? g.clob_token_ids ?? "[]"));
      } catch { ids = String(g.clobTokenIds ?? g.clob_token_ids ?? "").split(","); }

      const tokens: Array<{ outcome: string; price: string; token_id: string }> = [];
      for (let i = 0; i < outcomes.length; i++) {
        tokens.push({
          outcome: String(outcomes[i]!).trim(),
          price: String(prices[i] ?? "0.5").trim(),
          token_id: String(ids[i] ?? "").trim(),
        });
      }
      if (tokens.length === 0) continue;
      allMarkets.push({
        question: q,
        tokens,
        active: g.active ?? true,
        closed: g.closed ?? false,
        accepting_orders: g.accepting_orders ?? true,
        end_date_iso: g.endDate ?? g.end_date_iso,
        volume: g.volume ?? g.volume24hr ?? 0,
        condition_id: g.conditionId ?? g.condition_id,
      });
      seenQuestions.add(q);
    }
  }

  const rawMarkets = allMarkets;
  callbacks.log(`[INTEL:POLY] Fetched ${rawMarkets.length} markets (sampling+gamma)`);
  let skipOwned = 0, skipRecent = 0, skipSold = 0, skipPending = 0, skipPrice = 0, skipDays = 0, skipVolume = 0, skipNoYes = 0, skipAnalyzed = 0;
  for (const m of rawMarkets) {
    const tokens = (m.tokens ?? []) as Array<{ outcome: string; price: string; token_id: string }>;
    const yes = tokens.find((t) => t.outcome === "Yes");
    const no = tokens.find((t) => t.outcome === "No");
    if (!yes) { skipNoYes++; continue; }
    const yp = Number(yes.price);
    const np = no ? Number(no.price) : 1 - yp;
    if (yp < POLY_PRICE_MIN || yp > POLY_PRICE_MAX) { skipPrice++; continue; }
    const q = String(m.question ?? "");
    if (ownedTitles.has(q.toLowerCase())) { skipOwned++; continue; }
    if (isRecentlyTraded(state, q)) { skipRecent++; continue; }
    if (state.recentlySoldQuestions.has(q.toLowerCase())) { skipSold++; continue; }
    if (state.pendingBuys.has(q.toLowerCase())) { skipPending++; continue; }
    if (state.recentlyAnalyzed.has(q.toLowerCase())) { skipAnalyzed++; continue; }
    if (state.skippedMarkets.has(q.toLowerCase())) continue;

    const spread = Math.abs(np - yp);
    const midpoint = (yp + np) / 2;
    const spreadScore = Math.max(0, 1 - spread / 0.15);
    const midScore = 1 - Math.abs(midpoint - 0.5) * 2;

    const endDate = m.end_date_iso ?? m.endDate;
    let daysLeft = 365;
    if (endDate) {
      daysLeft = Math.max(0, (new Date(endDate as string).getTime() - Date.now()) / 86400000);
      if (daysLeft > MARKET_MAX_DAYS) { skipDays++; continue; }
      if (daysLeft < 0.5) { skipDays++; continue; } // already expired or resolving
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
    const volume = Number(m.volume ?? 0);
    if (volume < MIN_POLY_VOLUME) { skipVolume++; continue; }
    const volumeScore = Math.min(1, volume / 5000);

    const tokenId = String(yes.token_id ?? "");
    const noTokenId = no ? String(no.token_id ?? "") : "";
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
    // LLM knowledge bonus: boost markets in categories where LLMs have real edge
    const knowledgeBonus = llmKnowledgeBonus(q) * LLM_KNOWLEDGE_BONUS;
    const adjustedScore = score + priceSweetSpot * SCORE_PRICE_SWEET_SPOT_WEIGHT + quickFlipBonus + knowledgeBonus;

    scored.push({ question: q, yesPrice: yp, score: adjustedScore, volume, daysLeft, tokenId, noTokenId, conditionId, intel: null });
  }
  scored.sort((a, b) => b.score - a.score);
  if (scored.length === 0) {
    callbacks.log(`[INTEL:POLY] 0 markets passed (total: ${rawMarkets.length}, noYes: ${skipNoYes}, owned: ${skipOwned}, recent: ${skipRecent}, sold: ${skipSold}, pending: ${skipPending}, analyzed: ${skipAnalyzed}, price: ${skipPrice}, days: ${skipDays}, volume: ${skipVolume})`);
  }

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
      // Quick flip scoring: AGGRESSIVE — time-to-resolution is the #1 factor
      let jupTimeScore: number;
      if (jupDaysLeft <= 3) {
        jupTimeScore = 1.0; // 1-3 days: maximum score
      } else if (jupDaysLeft <= QUICK_FLIP_MAX_DAYS) {
        jupTimeScore = Math.max(0.7, 1 - (jupDaysLeft - 3) / 5); // 3-5 days: still great
      } else if (jupDaysLeft <= 14) {
        jupTimeScore = Math.max(0.2, 0.7 - (jupDaysLeft - QUICK_FLIP_MAX_DAYS) / 14);
      } else {
        jupTimeScore = 0; // >14 days: skip entirely
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
      // Quick flip bonus: aggressive — 1-3 days get huge bonus
      const quickFlipBonus = jupDaysLeft <= 3 ? 0.40 : jupDaysLeft <= QUICK_FLIP_MAX_DAYS ? 0.25 : 0;
      const q = `${event.metadata?.title} — ${m.metadata?.title}`;
      // LLM knowledge bonus
      const knowledgeBonus = llmKnowledgeBonus(q) * LLM_KNOWLEDGE_BONUS;
      const adjustedScore = score + priceSweetSpot * SCORE_PRICE_SWEET_SPOT_WEIGHT + quickFlipBonus + knowledgeBonus;
      const marketTitle = (m.metadata?.title ?? "").toLowerCase();
      const eventTitle = (event.metadata?.title ?? "").toLowerCase();
      if (ownedTitles.has(marketTitle) || ownedTitles.has(`${eventTitle} — ${marketTitle}`)) { _jupDbgOwned++; continue; }
      // Same-event dedup: if we own ANY market in this event, skip all others
      if (eventTitle && [...ownedTitles].some(t => t.includes(eventTitle) || eventTitle.includes(t))) { _jupDbgOwned++; continue; }
      if (isRecentlyTraded(state, q)) continue;
      // Also check if any market in same event was recently traded
      if (eventTitle && state.tradeHistory.some(h => h.question.toLowerCase().includes(eventTitle) && Date.now() - h.time < 86_400_000)) continue;
      if (state.recentlySoldQuestions.has(q.toLowerCase())) continue;
      if (state.pendingBuys.has(q.toLowerCase())) continue;
      // Check if any market in same event is pending buy
      if (eventTitle && [...state.pendingBuys].some(p => p.includes(eventTitle))) continue;
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
