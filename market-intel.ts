/**
 * Market Intelligence — fetches enriched data from Polymarket and Jupiter APIs
 * that the scoring algorithm and LLM prompts use for better analysis.
 */

import { withRetry } from "./retry";

// --- Types ---

export type PricePoint = { time: number; price: number };

export type PriceTrend = {
  current: number;
  change1h: number | null;  // % change
  change6h: number | null;
  change24h: number | null;
  direction: "up" | "down" | "flat";
  momentum: number; // -1 to 1 (strong down to strong up)
};

export type DepthInfo = {
  bidDepthUsd: number;   // total USD within 10% of mid
  askDepthUsd: number;
  totalDepthUsd: number;
  imbalance: number;     // -1 (all asks) to 1 (all bids) — buy pressure indicator
  isLiquid: boolean;     // depth > threshold
};

export type MarketIntel = {
  question: string;
  trend: PriceTrend | null;
  depth: DepthInfo | null;
  openInterest: number | null;
  recentVolume: number | null;
  isContrarian: boolean;     // 20%+ move in 24h → mean reversion opportunity
  contrarian24hMove: number | null;
};

// --- Polymarket Intelligence ---

/**
 * Fetch price history for a Polymarket token.
 * Uses the CLOB timeseries endpoint.
 */
export async function fetchPolyPriceHistory(
  tokenId: string,
  interval: "1m" | "5m" | "1h" | "1d" = "1h",
  fidelity = 60,
): Promise<PricePoint[]> {
  try {
    const startTs = Math.floor((Date.now() - 86_400_000) / 1000); // 24h ago
    const url = `https://clob.polymarket.com/prices-history?market=${tokenId}&interval=${interval}&fidelity=${fidelity}&startTs=${startTs}`;
    const res = await withRetry(
      () => fetch(url),
      { label: "poly-price-history" },
    );
    if (!res.ok) return [];
    const data = await res.json() as { history?: Array<{ t: number; p: number }> };
    return (data.history ?? []).map((h) => ({ time: h.t, price: h.p }));
  } catch {
    return [];
  }
}

/**
 * Compute price trend from historical data.
 */
export function computePriceTrend(history: PricePoint[], currentPrice: number): PriceTrend {
  const now = Date.now() / 1000;
  const findPriceAt = (secondsAgo: number): number | null => {
    const target = now - secondsAgo;
    let closest: PricePoint | null = null;
    let minDiff = Infinity;
    for (const p of history) {
      const diff = Math.abs(p.time - target);
      if (diff < minDiff) { minDiff = diff; closest = p; }
    }
    // Only accept if within 20% of the target window
    return closest && minDiff < secondsAgo * 0.2 ? closest.price : null;
  };

  const price1h = findPriceAt(3600);
  const price6h = findPriceAt(21600);
  const price24h = findPriceAt(86400);

  const pctChange = (old: number | null): number | null =>
    old !== null && old > 0 ? ((currentPrice - old) / old) * 100 : null;

  const change1h = pctChange(price1h);
  const change6h = pctChange(price6h);
  const change24h = pctChange(price24h);

  // Momentum: weighted average of available changes (-1 to 1)
  let momentumSum = 0;
  let momentumWeight = 0;
  if (change1h !== null) { momentumSum += Math.tanh(change1h / 10) * 3; momentumWeight += 3; }
  if (change6h !== null) { momentumSum += Math.tanh(change6h / 15) * 2; momentumWeight += 2; }
  if (change24h !== null) { momentumSum += Math.tanh(change24h / 20) * 1; momentumWeight += 1; }
  const momentum = momentumWeight > 0 ? momentumSum / momentumWeight : 0;

  const direction = momentum > 0.15 ? "up" : momentum < -0.15 ? "down" : "flat";

  return { current: currentPrice, change1h, change6h, change24h, direction, momentum };
}

/**
 * Analyze order book depth for a Polymarket token.
 * Returns liquidity within 10% of mid-price on both sides.
 */
export async function fetchPolyDepth(
  tokenId: string,
  midPrice: number,
  minDepthUsd = 200,
): Promise<DepthInfo> {
  const empty: DepthInfo = { bidDepthUsd: 0, askDepthUsd: 0, totalDepthUsd: 0, imbalance: 0, isLiquid: false };
  try {
    const res = await withRetry(
      () => fetch(`https://clob.polymarket.com/book?token_id=${tokenId}`),
      { label: "poly-depth" },
    );
    if (!res.ok) return empty;
    const book = await res.json() as {
      bids?: Array<{ price: string; size: string }>;
      asks?: Array<{ price: string; size: string }>;
    };

    const range = midPrice * 0.10; // 10% of mid
    let bidDepth = 0;
    let askDepth = 0;

    for (const bid of book.bids ?? []) {
      const price = parseFloat(bid.price);
      if (price >= midPrice - range) {
        bidDepth += parseFloat(bid.size) * price;
      }
    }
    for (const ask of book.asks ?? []) {
      const price = parseFloat(ask.price);
      if (price <= midPrice + range) {
        askDepth += parseFloat(ask.size) * price;
      }
    }

    const total = bidDepth + askDepth;
    const imbalance = total > 0 ? (bidDepth - askDepth) / total : 0;

    return {
      bidDepthUsd: bidDepth,
      askDepthUsd: askDepth,
      totalDepthUsd: total,
      imbalance,
      isLiquid: total >= minDepthUsd,
    };
  } catch {
    return empty;
  }
}

/**
 * Fetch open interest for a Polymarket market (condition ID).
 */
export async function fetchPolyOpenInterest(conditionId: string): Promise<number | null> {
  try {
    const res = await withRetry(
      () => fetch(`https://clob.polymarket.com/get-open-interest?condition_id=${conditionId}`),
      { label: "poly-oi" },
    );
    if (!res.ok) return null;
    const data = await res.json() as { open_interest?: number };
    return data.open_interest ?? null;
  } catch {
    return null;
  }
}

/**
 * Fetch live volume for a Polymarket event.
 */
export async function fetchPolyLiveVolume(conditionId: string): Promise<number | null> {
  try {
    const res = await withRetry(
      () => fetch(`https://clob.polymarket.com/get-live-volume-for-an-event?condition_id=${conditionId}`),
      { label: "poly-volume" },
    );
    if (!res.ok) return null;
    const data = await res.json() as { volume?: number };
    return data.volume ?? null;
  } catch {
    return null;
  }
}

/**
 * Fetch spreads for multiple Polymarket tokens in one call.
 */
export async function fetchPolySpreads(tokenIds: string[]): Promise<Map<string, number>> {
  const result = new Map<string, number>();
  if (tokenIds.length === 0) return result;
  try {
    const res = await withRetry(
      () => fetch(`https://clob.polymarket.com/spreads`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(tokenIds),
      }),
      { label: "poly-spreads" },
    );
    if (!res.ok) return result;
    const data = await res.json() as Record<string, { spread?: number }>;
    for (const [tokenId, info] of Object.entries(data)) {
      if (info.spread !== undefined) result.set(tokenId, info.spread);
    }
  } catch {}
  return result;
}

// --- Jupiter Intelligence ---

/**
 * Fetch order book depth from Jupiter prediction market.
 */
export async function fetchJupDepth(
  marketId: string,
  midPrice: number,
  apiKey: string,
  minDepthUsd = 100,
): Promise<DepthInfo> {
  const empty: DepthInfo = { bidDepthUsd: 0, askDepthUsd: 0, totalDepthUsd: 0, imbalance: 0, isLiquid: false };
  try {
    const res = await withRetry(
      () => fetch(`https://api.jup.ag/prediction/v1/orderbook/${marketId}`, {
        headers: { "x-api-key": apiKey },
      }),
      { label: "jup-depth" },
    );
    if (!res.ok) return empty;
    const data = await res.json() as {
      yes?: Array<[number, number]>; // [price_cents, qty]
      no?: Array<[number, number]>;
    };

    const range = midPrice * 0.10;
    let bidDepth = 0;
    let askDepth = 0;

    // YES bids are buy orders (support), YES asks are sell orders
    for (const [priceCents, qty] of data.yes ?? []) {
      const price = priceCents / 100;
      const usd = (qty / 1_000_000) * price;
      if (price <= midPrice) bidDepth += usd;
      else if (price <= midPrice + range) askDepth += usd;
    }

    const total = bidDepth + askDepth;
    const imbalance = total > 0 ? (bidDepth - askDepth) / total : 0;

    return {
      bidDepthUsd: bidDepth,
      askDepthUsd: askDepth,
      totalDepthUsd: total,
      imbalance,
      isLiquid: total >= minDepthUsd,
    };
  } catch {
    return empty;
  }
}

/**
 * Fetch recent global trades from Jupiter to detect volume flow.
 */
export async function fetchJupRecentTrades(
  apiKey: string,
  limit = 50,
): Promise<Array<{ marketId: string; side: string; amount: number; time: number }>> {
  try {
    const res = await withRetry(
      () => fetch(`https://api.jup.ag/prediction/v1/trades?limit=${limit}`, {
        headers: { "x-api-key": apiKey },
      }),
      { label: "jup-trades" },
    );
    if (!res.ok) return [];
    const data = await res.json() as { data?: Array<Record<string, unknown>> };
    return (data.data ?? []).map((t) => ({
      marketId: String(t.marketId ?? ""),
      side: String(t.isYes ? "YES" : "NO"),
      amount: Number(t.filledAmountUsd ?? t.depositAmount ?? 0) / 1_000_000,
      time: Number(t.createdAt ?? Date.now()),
    }));
  } catch {
    return [];
  }
}

/**
 * Fetch Jupiter leaderboard to identify smart money direction.
 */
export async function fetchJupLeaderboard(
  apiKey: string,
  metric: "pnl" | "volume" | "win_rate" = "pnl",
  limit = 10,
): Promise<Array<{ pubkey: string; pnl: number; winRate: number; volume: number }>> {
  try {
    const res = await withRetry(
      () => fetch(`https://api.jup.ag/prediction/v1/leaderboards?metric=${metric}&limit=${limit}`, {
        headers: { "x-api-key": apiKey },
      }),
      { label: "jup-leaderboard" },
    );
    if (!res.ok) return [];
    const data = await res.json() as { data?: Array<Record<string, unknown>> };
    return (data.data ?? []).map((e) => ({
      pubkey: String(e.pubkey ?? e.wallet ?? ""),
      pnl: Number(e.pnl ?? e.pnlUsd ?? 0) / 1_000_000,
      winRate: Number(e.winRate ?? e.win_rate ?? 0),
      volume: Number(e.volume ?? e.totalVolume ?? 0) / 1_000_000,
    }));
  } catch {
    return [];
  }
}

// --- Cross-platform helpers ---

/**
 * Detect contrarian opportunity: 20%+ price move in 24h signals potential mean reversion.
 */
export function detectContrarian(trend: PriceTrend | null): { isContrarian: boolean; move24h: number | null } {
  if (!trend || trend.change24h === null) return { isContrarian: false, move24h: null };
  const absMove = Math.abs(trend.change24h);
  return { isContrarian: absMove >= 20, move24h: trend.change24h };
}

/**
 * Build a concise market intelligence summary string for the LLM prompt.
 */
export function formatIntelForPrompt(intel: MarketIntel): string {
  const parts: string[] = [];

  if (intel.trend) {
    const t = intel.trend;
    const changes: string[] = [];
    if (t.change1h !== null) changes.push(`1h: ${t.change1h > 0 ? "+" : ""}${t.change1h.toFixed(1)}%`);
    if (t.change6h !== null) changes.push(`6h: ${t.change6h > 0 ? "+" : ""}${t.change6h.toFixed(1)}%`);
    if (t.change24h !== null) changes.push(`24h: ${t.change24h > 0 ? "+" : ""}${t.change24h.toFixed(1)}%`);
    if (changes.length > 0) parts.push(`Trend: ${t.direction} (${changes.join(", ")})`);
  }

  if (intel.depth) {
    const d = intel.depth;
    const pressure = d.imbalance > 0.2 ? "buy pressure" : d.imbalance < -0.2 ? "sell pressure" : "balanced";
    parts.push(`Depth: $${d.totalDepthUsd.toFixed(0)} (${pressure}${d.isLiquid ? "" : ", ILLIQUID"})`);
  }

  if (intel.openInterest !== null) {
    parts.push(`OI: $${intel.openInterest.toFixed(0)}`);
  }

  if (intel.isContrarian && intel.contrarian24hMove !== null) {
    const dir = intel.contrarian24hMove > 0 ? "surged" : "crashed";
    parts.push(`⚠️ CONTRARIAN: price ${dir} ${Math.abs(intel.contrarian24hMove).toFixed(0)}% in 24h — possible mean reversion`);
  }

  return parts.length > 0 ? ` [${parts.join(" | ")}]` : "";
}

/**
 * Gather full market intel for a Polymarket candidate.
 * Parallel fetches for speed.
 */
export async function gatherPolyIntel(
  tokenId: string,
  conditionId: string | undefined,
  currentPrice: number,
  question: string,
): Promise<MarketIntel> {
  const [history, depth, oi] = await Promise.allSettled([
    fetchPolyPriceHistory(tokenId),
    fetchPolyDepth(tokenId, currentPrice),
    conditionId ? fetchPolyOpenInterest(conditionId) : Promise.resolve(null),
  ]);

  const priceHistory = history.status === "fulfilled" ? history.value : [];
  const trend = priceHistory.length > 2 ? computePriceTrend(priceHistory, currentPrice) : null;
  const depthInfo = depth.status === "fulfilled" ? depth.value : null;
  const openInterest = oi.status === "fulfilled" ? oi.value : null;
  const { isContrarian, move24h } = detectContrarian(trend);

  return {
    question,
    trend,
    depth: depthInfo,
    openInterest,
    recentVolume: null,
    isContrarian,
    contrarian24hMove: move24h,
  };
}

/**
 * Gather full market intel for a Jupiter candidate.
 */
export async function gatherJupIntel(
  marketId: string,
  currentPrice: number,
  question: string,
  apiKey: string,
): Promise<MarketIntel> {
  const [depth] = await Promise.allSettled([
    fetchJupDepth(marketId, currentPrice, apiKey),
  ]);

  const depthInfo = depth.status === "fulfilled" ? depth.value : null;

  // Jupiter doesn't have a price history endpoint like Polymarket,
  // so trend is null for now (could be computed from trade history)
  return {
    question,
    trend: null,
    depth: depthInfo,
    openInterest: null,
    recentVolume: null,
    isContrarian: false,
    contrarian24hMove: null,
  };
}
