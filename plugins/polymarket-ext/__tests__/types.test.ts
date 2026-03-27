import { describe, expect, test } from "bun:test";
import {
  POLYMARKET_EXT_SERVICE_TYPE,
  PolymarketApiError,
  PolymarketAuthError,
  PolymarketRateLimitError,
  CancelResponseSchema,
  CancelAllResponseSchema,
  OpenOrderSchema,
  OrderBookSchema,
  PositionSchema,
  TradeSchema,
  PnlSummarySchema,
} from "../types";

describe("service type constant", () => {
  test("POLYMARKET_EXT_SERVICE_TYPE is correct string", () => {
    expect(POLYMARKET_EXT_SERVICE_TYPE).toBe("POLYMARKET_EXT");
  });
});

describe("error classes", () => {
  test("PolymarketApiError has statusCode, responseBody, endpoint", () => {
    const err = new PolymarketApiError(500, "server error", "/order");
    expect(err.name).toBe("PolymarketApiError");
    expect(err.statusCode).toBe(500);
    expect(err.responseBody).toBe("server error");
    expect(err.endpoint).toBe("/order");
    expect(err.message).toContain("500");
    expect(err.message).toContain("/order");
  });

  test("PolymarketAuthError extends PolymarketApiError for 401", () => {
    const err = new PolymarketAuthError(401, "unauthorized", "/cancel-all");
    expect(err).toBeInstanceOf(PolymarketApiError);
    expect(err.name).toBe("PolymarketAuthError");
    expect(err.message).toContain("credentials");
  });

  test("PolymarketRateLimitError extends PolymarketApiError for 429", () => {
    const err = new PolymarketRateLimitError(429, "too many", "/order");
    expect(err).toBeInstanceOf(PolymarketApiError);
    expect(err.name).toBe("PolymarketRateLimitError");
    expect(err.message).toContain("Rate limited");
  });
});

describe("CLOB API schemas", () => {
  test("CancelResponseSchema parses valid response", () => {
    const result = CancelResponseSchema.parse({ canceled: "order-123" });
    expect(result.canceled).toBe("order-123");
  });

  test("CancelAllResponseSchema parses array of IDs", () => {
    const result = CancelAllResponseSchema.parse({ canceled: ["a", "b", "c"] });
    expect(result.canceled).toHaveLength(3);
  });

  test("OpenOrderSchema parses order object", () => {
    const result = OpenOrderSchema.parse({
      id: "order-1", market: "0xabc", asset_id: "token-1", side: "BUY",
      price: "0.55", original_size: "100", size_matched: "50", status: "live",
      created_at: "1711500000", order_type: "GTC",
    });
    expect(result.id).toBe("order-1");
    expect(result.side).toBe("BUY");
  });

  test("OpenOrderSchema accepts optional expiration", () => {
    const result = OpenOrderSchema.parse({
      id: "order-1", market: "0xabc", asset_id: "token-1", side: "SELL",
      price: "0.45", original_size: "50", size_matched: "0", status: "live",
      created_at: "1711500000", order_type: "GTC", expiration: "1711600000",
    });
    expect(result.expiration).toBe("1711600000");
  });

  test("OpenOrderSchema tolerates extra fields with passthrough", () => {
    const input = {
      id: "order-1", market: "0xabc", asset_id: "token-1", side: "BUY",
      price: "0.55", original_size: "100", size_matched: "50", status: "live",
      created_at: "1711500000", order_type: "GTC", unknown_field: true,
    };
    expect(() => OpenOrderSchema.parse(input)).not.toThrow();
  });

  test("OrderBookSchema parses bids and asks", () => {
    const result = OrderBookSchema.parse({
      bids: [{ price: "0.55", size: "100" }],
      asks: [{ price: "0.56", size: "200" }],
    });
    expect(result.bids).toHaveLength(1);
    expect(result.asks[0]!.price).toBe("0.56");
  });
});

describe("Data API schemas", () => {
  test("PositionSchema parses position object", () => {
    const result = PositionSchema.parse({
      market_slug: "will-it-rain", title: "Will it rain?", outcome: "Yes",
      size: 100, avg_price: 0.55, cur_price: 0.62, realized_pnl: 0,
      condition_id: "0xcond1", asset_id: "0xasset1",
    });
    expect(result.size).toBe(100);
    expect(result.cur_price).toBe(0.62);
  });

  test("TradeSchema parses trade object", () => {
    const result = TradeSchema.parse({
      id: "trade-1", market_slug: "will-it-rain", title: "Will it rain?",
      side: "BUY", outcome: "Yes", price: 0.55, size: 50,
      timestamp: "2026-03-27T12:00:00Z", transaction_hash: "0xdeadbeef",
    });
    expect(result.side).toBe("BUY");
    expect(result.price).toBe(0.55);
  });

  test("PnlSummarySchema parses with optional fields", () => {
    const result = PnlSummarySchema.parse({
      total_realized: 150.50, total_unrealized: -20.00, total_volume: 5000,
    });
    expect(result.total_realized).toBe(150.50);
    expect(result.positions_won).toBeUndefined();
  });

  test("PnlSummarySchema parses with all fields", () => {
    const result = PnlSummarySchema.parse({
      total_realized: 150.50, total_unrealized: -20.00, total_volume: 5000,
      positions_won: 8, positions_lost: 3,
    });
    expect(result.positions_won).toBe(8);
    expect(result.positions_lost).toBe(3);
  });
});
