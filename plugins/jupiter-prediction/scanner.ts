import type { Market, Orderbook, ScoredOpportunity } from "./types";
import { microUsdToDollars } from "./types";

const MIN_DEPTH = 3;
const MAX_SPREAD = 0.15;
const MIN_TIME_REMAINING_MS = 60 * 60 * 1000;

const SPREAD_WEIGHT = 0.50;
const MIDPOINT_WEIGHT = 0.30;
const DEPTH_WEIGHT = 0.20;

type MarketWithBook = {
  readonly market: Market;
  readonly orderbook: Orderbook;
};

function getSpread(market: Market): number {
  const yes = microUsdToDollars(market.yesPrice);
  const no = microUsdToDollars(market.noPrice);
  return Math.abs(no - yes);
}

function getMidpoint(market: Market): number {
  const yes = microUsdToDollars(market.yesPrice);
  const no = microUsdToDollars(market.noPrice);
  return (yes + no) / 2;
}

function isExpiringSoon(market: Market): boolean {
  const expiresAt = new Date(market.expiresAt).getTime();
  return expiresAt - Date.now() < MIN_TIME_REMAINING_MS;
}

function hasMinDepth(orderbook: Orderbook): boolean {
  return orderbook.bids.length >= MIN_DEPTH && orderbook.asks.length >= MIN_DEPTH;
}

export function filterMarkets(entries: MarketWithBook[]): MarketWithBook[] {
  return entries.filter(({ market, orderbook }) => {
    if (!hasMinDepth(orderbook)) return false;
    if (getSpread(market) > MAX_SPREAD) return false;
    if (isExpiringSoon(market)) return false;
    return true;
  });
}

export function scoreOpportunity(market: Market, orderbook: Orderbook): ScoredOpportunity {
  const spread = getSpread(market);
  const midpoint = getMidpoint(market);
  const totalDepth = orderbook.bids.length + orderbook.asks.length;

  const spreadScore = Math.max(0, 1 - spread / MAX_SPREAD);
  const midpointScore = 1 - Math.abs(midpoint - 0.5) * 2;
  const depthScore = Math.min(1, totalDepth / 20);

  const totalScore =
    spreadScore * SPREAD_WEIGHT +
    midpointScore * MIDPOINT_WEIGHT +
    depthScore * DEPTH_WEIGHT;

  return {
    event: { id: "", title: "", category: "", status: "", markets: [] },
    market,
    orderbook,
    spread,
    midpoint,
    depthScore,
    totalScore,
  };
}

export function scanAndScore(entries: MarketWithBook[], topN: number = 5): ScoredOpportunity[] {
  const filtered = filterMarkets(entries);
  const scored = filtered.map(({ market, orderbook }) => scoreOpportunity(market, orderbook));
  scored.sort((a, b) => b.totalScore - a.totalScore);
  return scored.slice(0, topN);
}

export function formatOpportunity(opp: ScoredOpportunity): string {
  const yes = microUsdToDollars(opp.market.yesPrice).toFixed(2);
  const no = microUsdToDollars(opp.market.noPrice).toFixed(2);
  return [
    `Market: ${opp.market.question}`,
    `  YES: $${yes} | NO: $${no} | Spread: ${(opp.spread * 100).toFixed(1)}%`,
    `  Midpoint: ${opp.midpoint.toFixed(3)} | Depth: ${opp.orderbook.bids.length}/${opp.orderbook.asks.length}`,
    `  Score: ${opp.totalScore.toFixed(3)}`,
  ].join("\n");
}

export function formatOpportunitySummary(opportunities: ScoredOpportunity[]): string {
  if (opportunities.length === 0) return "No opportunities found matching criteria.";
  const header = `Found ${opportunities.length} opportunities:\n`;
  return header + opportunities.map((opp, i) => `${i + 1}. ${formatOpportunity(opp)}`).join("\n\n");
}
