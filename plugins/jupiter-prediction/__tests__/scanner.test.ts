import { describe, expect, test } from "bun:test";
import { filterMarkets, scoreOpportunity, scanAndScore } from "../scanner";
import type { Market, Orderbook } from "../types";

function makeMarket(overrides: Partial<Market> = {}): Market {
  return {
    marketId: "m1",
    status: "open",
    closeTime: Math.floor(Date.now() / 1000) + 86_400, // +24h in seconds
    metadata: { title: "Will BTC reach $200k?" },
    pricing: {
      buyYesPriceUsd: 450_000,
      sellYesPriceUsd: 448_000,
      sellNoPriceUsd: 548_000,
      buyNoPriceUsd: 550_000,
    },
    ...overrides,
  };
}

function makeMarketWithPrices(marketId: string, yesPrice: number, noPrice: number): Market {
  return makeMarket({
    marketId,
    pricing: {
      buyYesPriceUsd: yesPrice,
      sellYesPriceUsd: yesPrice - 2000,
      sellNoPriceUsd: noPrice - 2000,
      buyNoPriceUsd: noPrice,
    },
  });
}

function makeOrderbook(yesDepth: number, noDepth: number): Orderbook {
  return {
    yes: Array.from({ length: yesDepth }, (_, i) => [24 - i, 100] as [number, number]),
    no: Array.from({ length: noDepth }, (_, i) => [76 + i, 100] as [number, number]),
  };
}

describe("filterMarkets", () => {
  test("excludes markets with thin yes depth (< 3)", () => {
    const market = makeMarket();
    const book = makeOrderbook(2, 5);
    const result = filterMarkets([{ market, orderbook: book }]);
    expect(result).toHaveLength(0);
  });

  test("excludes markets with thin no depth (< 3)", () => {
    const market = makeMarket();
    const book = makeOrderbook(5, 1);
    const result = filterMarkets([{ market, orderbook: book }]);
    expect(result).toHaveLength(0);
  });

  test("excludes markets with spread > 15%", () => {
    const market = makeMarketWithPrices("wide", 200_000, 900_000);
    const book = makeOrderbook(5, 5);
    const result = filterMarkets([{ market, orderbook: book }]);
    expect(result).toHaveLength(0);
  });

  test("excludes markets expiring within 1 hour", () => {
    const market = makeMarket({
      closeTime: Math.floor(Date.now() / 1000) + 30 * 60, // +30 min
    });
    const book = makeOrderbook(5, 5);
    const result = filterMarkets([{ market, orderbook: book }]);
    expect(result).toHaveLength(0);
  });

  test("keeps valid markets", () => {
    const market = makeMarket();
    const book = makeOrderbook(5, 5);
    const result = filterMarkets([{ market, orderbook: book }]);
    expect(result).toHaveLength(1);
  });
});

describe("scoreOpportunity", () => {
  test("scores higher for tighter spreads", () => {
    const tight = scoreOpportunity(
      makeMarketWithPrices("tight", 480_000, 520_000),
      makeOrderbook(5, 5)
    );
    const wide = scoreOpportunity(
      makeMarketWithPrices("wide", 400_000, 600_000),
      makeOrderbook(5, 5)
    );
    expect(tight.totalScore).toBeGreaterThan(wide.totalScore);
  });

  test("scores higher for midpoints near 0.50", () => {
    const uncertain = scoreOpportunity(
      makeMarketWithPrices("uncertain", 480_000, 520_000),
      makeOrderbook(5, 5)
    );
    const lopsided = scoreOpportunity(
      makeMarketWithPrices("lopsided", 100_000, 900_000),
      makeOrderbook(5, 5)
    );
    expect(uncertain.totalScore).toBeGreaterThan(lopsided.totalScore);
  });

  test("scores higher for deeper orderbooks", () => {
    const deep = scoreOpportunity(makeMarket(), makeOrderbook(10, 10));
    const shallow = scoreOpportunity(makeMarket(), makeOrderbook(3, 3));
    expect(deep.depthScore).toBeGreaterThan(shallow.depthScore);
  });
});

describe("scanAndScore", () => {
  test("returns top N opportunities sorted by score", () => {
    const markets = [
      { market: makeMarketWithPrices("tight", 490_000, 510_000), orderbook: makeOrderbook(5, 5) },
      { market: makeMarketWithPrices("wide", 300_000, 700_000), orderbook: makeOrderbook(5, 5) },
      { market: makeMarketWithPrices("medium", 450_000, 550_000), orderbook: makeOrderbook(5, 5) },
    ];
    const results = scanAndScore(markets, 2);
    expect(results).toHaveLength(2);
    expect(results[0]!.totalScore).toBeGreaterThanOrEqual(results[1]!.totalScore);
    expect(results[0]!.market.marketId).toBe("tight");
  });

  test("filters out invalid markets before scoring", () => {
    const markets = [
      { market: makeMarket({ marketId: "valid" }), orderbook: makeOrderbook(5, 5) },
      { market: makeMarket({ marketId: "thin" }), orderbook: makeOrderbook(1, 1) },
    ];
    const results = scanAndScore(markets, 5);
    expect(results).toHaveLength(1);
    expect(results[0]!.market.marketId).toBe("valid");
  });
});
