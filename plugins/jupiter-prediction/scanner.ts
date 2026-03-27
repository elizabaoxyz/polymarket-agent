import type { Market, Orderbook, ScoredOpportunity, Event } from "./types";
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
  readonly event?: Event;
};

function getSpread(market: Market): number {
  // pricing values are in micro-USD
  const yes = microUsdToDollars(market.pricing.buyYesPriceUsd);
  const no = microUsdToDollars(market.pricing.buyNoPriceUsd);
  return Math.abs(no - yes);
}

function getMidpoint(market: Market): number {
  const yes = microUsdToDollars(market.pricing.buyYesPriceUsd);
  const no = microUsdToDollars(market.pricing.buyNoPriceUsd);
  return (yes + no) / 2;
}

function isExpiringSoon(market: Market): boolean {
  // closeTime is unix timestamp in seconds
  const expiresAtMs = market.closeTime * 1000;
  return expiresAtMs - Date.now() < MIN_TIME_REMAINING_MS;
}

function hasMinDepth(orderbook: Orderbook): boolean {
  return orderbook.yes.length >= MIN_DEPTH && orderbook.no.length >= MIN_DEPTH;
}

export function filterMarkets(entries: MarketWithBook[]): MarketWithBook[] {
  return entries.filter(({ market, orderbook }) => {
    if (!hasMinDepth(orderbook)) return false;
    if (getSpread(market) > MAX_SPREAD) return false;
    if (isExpiringSoon(market)) return false;
    return true;
  });
}

export function scoreOpportunity(market: Market, orderbook: Orderbook, event?: Event): ScoredOpportunity {
  const spread = getSpread(market);
  const midpoint = getMidpoint(market);
  const totalDepth = orderbook.yes.length + orderbook.no.length;

  const spreadScore = Math.max(0, 1 - spread / MAX_SPREAD);
  const midpointScore = 1 - Math.abs(midpoint - 0.5) * 2;
  const depthScore = Math.min(1, totalDepth / 20);

  const totalScore =
    spreadScore * SPREAD_WEIGHT +
    midpointScore * MIDPOINT_WEIGHT +
    depthScore * DEPTH_WEIGHT;

  const stubEvent: Event = event ?? {
    eventId: "", isActive: false, isLive: false, category: "",
    metadata: { title: "" }, markets: [],
  };

  return {
    event: stubEvent,
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
  const scored = filtered.map(({ market, orderbook, event }) =>
    scoreOpportunity(market, orderbook, event)
  );
  scored.sort((a, b) => b.totalScore - a.totalScore);
  return scored.slice(0, topN);
}

export function formatOpportunity(opp: ScoredOpportunity): string {
  const yes = microUsdToDollars(opp.market.pricing.buyYesPriceUsd).toFixed(2);
  const no = microUsdToDollars(opp.market.pricing.buyNoPriceUsd).toFixed(2);
  const title = opp.market.metadata.title;
  const eventTitle = opp.event.metadata.title;
  return [
    `Market: ${eventTitle} — ${title}`,
    `  YES: $${yes} | NO: $${no} | Spread: ${(opp.spread * 100).toFixed(1)}%`,
    `  Midpoint: ${opp.midpoint.toFixed(3)} | Depth: ${opp.orderbook.yes.length}/${opp.orderbook.no.length}`,
    `  Score: ${opp.totalScore.toFixed(3)} | ID: ${opp.market.marketId}`,
  ].join("\n");
}

export function formatOpportunitySummary(opportunities: ScoredOpportunity[]): string {
  if (opportunities.length === 0) return "No opportunities found matching criteria.";
  const header = `Found ${opportunities.length} opportunities:\n`;
  return header + opportunities.map((opp, i) => `${i + 1}. ${formatOpportunity(opp)}`).join("\n\n");
}
