import { describe, expect, test } from "bun:test";
import {
  EventSchema,
  EventsResponseSchema,
  MarketSchema,
  OrderbookSchema,
  PlaceOrderResponseSchema,
  OrderStatusSchema,
  PositionSchema,
  TradingStatusSchema,
  microUsdToDollars,
  dollarsToMicroUsd,
} from "../types";

describe("microUsdToDollars", () => {
  test("converts 1_000_000 to 1.00", () => {
    expect(microUsdToDollars(1_000_000)).toBe(1.0);
  });
  test("converts 500_000 to 0.50", () => {
    expect(microUsdToDollars(500_000)).toBe(0.5);
  });
  test("converts 0 to 0", () => {
    expect(microUsdToDollars(0)).toBe(0);
  });
});

describe("dollarsToMicroUsd", () => {
  test("converts 5.00 to 5_000_000", () => {
    expect(dollarsToMicroUsd(5.0)).toBe(5_000_000);
  });
  test("converts 0.01 to 10_000", () => {
    expect(dollarsToMicroUsd(0.01)).toBe(10_000);
  });
});

describe("EventSchema", () => {
  test("parses a valid event", () => {
    const raw = {
      eventId: "POLY-123",
      isActive: true,
      isLive: true,
      category: "crypto",
      metadata: { title: "Will BTC reach $200k?" },
      markets: [
        {
          marketId: "POLY-456",
          status: "open",
          closeTime: 1857168000,
          metadata: { title: "BTC above $200k by Dec 2026" },
          pricing: {
            buyYesPriceUsd: 350_000,
            sellYesPriceUsd: 348_000,
            sellNoPriceUsd: 648_000,
            buyNoPriceUsd: 650_000,
          },
        },
      ],
    };
    const parsed = EventSchema.parse(raw);
    expect(parsed.eventId).toBe("POLY-123");
    expect(parsed.markets[0]!.pricing.buyYesPriceUsd).toBe(350_000);
  });
  test("rejects event with missing metadata", () => {
    expect(() =>
      EventSchema.parse({ eventId: "x", isActive: true, isLive: true, category: "crypto", markets: [] })
    ).toThrow();
  });
});

describe("EventsResponseSchema", () => {
  test("parses wrapped response with data array", () => {
    const raw = {
      data: [
        {
          eventId: "E1",
          isActive: true,
          isLive: true,
          category: "crypto",
          metadata: { title: "Test" },
          markets: [],
        },
      ],
      pagination: {},
    };
    const parsed = EventsResponseSchema.parse(raw);
    expect(parsed.data).toHaveLength(1);
    expect(parsed.data[0]!.eventId).toBe("E1");
  });
});

describe("MarketSchema", () => {
  test("parses a valid market", () => {
    const raw = {
      marketId: "POLY-456",
      status: "open",
      closeTime: 1857168000,
      metadata: { title: "BTC above $200k" },
      pricing: {
        buyYesPriceUsd: 350_000,
        sellYesPriceUsd: 348_000,
        sellNoPriceUsd: 648_000,
        buyNoPriceUsd: 650_000,
      },
    };
    const parsed = MarketSchema.parse(raw);
    expect(parsed.status).toBe("open");
    expect(parsed.pricing.buyYesPriceUsd).toBe(350_000);
  });
});

describe("OrderbookSchema", () => {
  test("parses yes/no arrays", () => {
    const raw = {
      yes: [[24, 100], [23, 200]],
      no: [[76, 150], [77, 250]],
    };
    const parsed = OrderbookSchema.parse(raw);
    expect(parsed.yes).toHaveLength(2);
    expect(parsed.no[0]![0]).toBe(76);
  });
});

describe("PlaceOrderResponseSchema", () => {
  test("parses unsigned transaction response", () => {
    const raw = { transaction: "base64encodedtx==", orderPubkey: "order123pubkey" };
    const parsed = PlaceOrderResponseSchema.parse(raw);
    expect(parsed.transaction).toBe("base64encodedtx==");
    expect(parsed.orderPubkey).toBe("order123pubkey");
  });
});

describe("OrderStatusSchema", () => {
  test("parses filled status", () => {
    const raw = { status: "filled", orderPubkey: "abc" };
    const parsed = OrderStatusSchema.parse(raw);
    expect(parsed.status).toBe("filled");
  });
  test("accepts pending, filled, failed", () => {
    expect(OrderStatusSchema.parse({ status: "pending", orderPubkey: "a" }).status).toBe("pending");
    expect(OrderStatusSchema.parse({ status: "failed", orderPubkey: "b" }).status).toBe("failed");
  });
});

describe("PositionSchema", () => {
  test("parses position with P&L", () => {
    const raw = {
      positionPubkey: "pos123",
      marketId: "market-abc",
      isYes: true,
      quantity: 10,
      averagePrice: 450_000,
      currentPrice: 600_000,
      status: "open",
    };
    const parsed = PositionSchema.parse(raw);
    expect(parsed.isYes).toBe(true);
    expect(parsed.quantity).toBe(10);
  });
});

describe("TradingStatusSchema", () => {
  test("parses operational status", () => {
    const raw = { operational: true };
    const parsed = TradingStatusSchema.parse(raw);
    expect(parsed.operational).toBe(true);
  });
});
