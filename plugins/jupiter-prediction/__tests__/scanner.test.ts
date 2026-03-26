import { describe, expect, test } from "bun:test";
import { filterMarkets, scoreOpportunity, scanAndScore } from "../scanner";
import type { Market, Orderbook } from "../types";

function makeMarket(overrides: Partial<Market> = {}): Market {
  return {
    id: "m1",
    question: "Will BTC reach $200k?",
    yesPrice: 450_000,
    noPrice: 550_000,
    status: "active",
    expiresAt: new Date(Date.now() + 86_400_000).toISOString(),
    ...overrides,
  };
}

function makeOrderbook(bids: number, asks: number): Orderbook {
  return {
    bids: Array.from({ length: bids }, (_, i) => [0.45 - i * 0.01, 100] as [number, number]),
    asks: Array.from({ length: asks }, (_, i) => [0.55 + i * 0.01, 100] as [number, number]),
  };
}

describe("filterMarkets", () => {
  test("excludes markets with thin bids (< 3)", () => {
    const market = makeMarket();
    const book = makeOrderbook(2, 5);
    const result = filterMarkets([{ market, orderbook: book }]);
    expect(result).toHaveLength(0);
  });

  test("excludes markets with thin asks (< 3)", () => {
    const market = makeMarket();
    const book = makeOrderbook(5, 1);
    const result = filterMarkets([{ market, orderbook: book }]);
    expect(result).toHaveLength(0);
  });

  test("excludes markets with spread > 15%", () => {
    const market = makeMarket({ yesPrice: 200_000, noPrice: 900_000 });
    const book = makeOrderbook(5, 5);
    const result = filterMarkets([{ market, orderbook: book }]);
    expect(result).toHaveLength(0);
  });

  test("excludes markets expiring within 1 hour", () => {
    const market = makeMarket({
      expiresAt: new Date(Date.now() + 30 * 60_000).toISOString(),
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
      makeMarket({ yesPrice: 480_000, noPrice: 520_000 }),
      makeOrderbook(5, 5)
    );
    const wide = scoreOpportunity(
      makeMarket({ yesPrice: 400_000, noPrice: 600_000 }),
      makeOrderbook(5, 5)
    );
    expect(tight.totalScore).toBeGreaterThan(wide.totalScore);
  });

  test("scores higher for midpoints near 0.50", () => {
    const uncertain = scoreOpportunity(
      makeMarket({ yesPrice: 480_000, noPrice: 520_000 }),
      makeOrderbook(5, 5)
    );
    const lopsided = scoreOpportunity(
      makeMarket({ yesPrice: 100_000, noPrice: 900_000 }),
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
      { market: makeMarket({ id: "tight", yesPrice: 490_000, noPrice: 510_000 }), orderbook: makeOrderbook(5, 5) },
      { market: makeMarket({ id: "wide", yesPrice: 300_000, noPrice: 700_000 }), orderbook: makeOrderbook(5, 5) },
      { market: makeMarket({ id: "medium", yesPrice: 450_000, noPrice: 550_000 }), orderbook: makeOrderbook(5, 5) },
    ];
    const results = scanAndScore(markets, 2);
    expect(results).toHaveLength(2);
    expect(results[0]!.totalScore).toBeGreaterThanOrEqual(results[1]!.totalScore);
    expect(results[0]!.market.id).toBe("tight");
  });

  test("filters out invalid markets before scoring", () => {
    const markets = [
      { market: makeMarket({ id: "valid" }), orderbook: makeOrderbook(5, 5) },
      { market: makeMarket({ id: "thin" }), orderbook: makeOrderbook(1, 1) },
    ];
    const results = scanAndScore(markets, 5);
    expect(results).toHaveLength(1);
    expect(results[0]!.market.id).toBe("valid");
  });
});
