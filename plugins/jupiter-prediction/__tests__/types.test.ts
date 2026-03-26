import { describe, expect, test } from "bun:test";
import {
  EventSchema,
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
      id: "event-123",
      title: "Will BTC reach $200k?",
      category: "crypto",
      status: "live",
      markets: [
        {
          id: "market-abc",
          question: "BTC above $200k by Dec 2026",
          yesPrice: 350_000,
          noPrice: 650_000,
          status: "active",
          expiresAt: "2026-12-31T00:00:00Z",
        },
      ],
    };
    const parsed = EventSchema.parse(raw);
    expect(parsed.id).toBe("event-123");
    expect(parsed.markets[0]!.yesPrice).toBe(350_000);
  });
  test("rejects event with missing title", () => {
    expect(() =>
      EventSchema.parse({ id: "x", category: "crypto", status: "live", markets: [] })
    ).toThrow();
  });
});

describe("MarketSchema", () => {
  test("parses a valid market", () => {
    const raw = {
      id: "market-abc",
      question: "BTC above $200k by Dec 2026",
      yesPrice: 350_000,
      noPrice: 650_000,
      status: "active",
      expiresAt: "2026-12-31T00:00:00Z",
    };
    const parsed = MarketSchema.parse(raw);
    expect(parsed.status).toBe("active");
  });
});

describe("OrderbookSchema", () => {
  test("parses bid/ask arrays", () => {
    const raw = {
      bids: [[0.45, 100], [0.44, 200]],
      asks: [[0.55, 150], [0.56, 250]],
    };
    const parsed = OrderbookSchema.parse(raw);
    expect(parsed.bids).toHaveLength(2);
    expect(parsed.asks[0]![0]).toBe(0.55);
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
