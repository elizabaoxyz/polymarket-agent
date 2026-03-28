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
      asset: "token1", conditionId: "0xcond1", size: 65, avgPrice: 0.016,
      initialValue: 1.04, currentValue: 1.04, cashPnl: 0, percentPnl: 0,
      curPrice: 0.016, realizedPnl: 0, title: "Will Ro Khanna win?",
      slug: "ro-khanna", outcome: "Yes",
    });
    expect(result.size).toBe(65);
    expect(result.curPrice).toBe(0.016);
  });

  test("TradeSchema parses trade object", () => {
    const result = TradeSchema.parse({
      conditionId: "0xcond1", type: "TRADE", size: 5, usdcSize: 2.60,
      price: 0.52, side: "BUY", outcome: "Yes", title: "China/Taiwan",
      transactionHash: "0xdeadbeef", timestamp: 1774643521,
    });
    expect(result.side).toBe("BUY");
    expect(result.usdcSize).toBe(2.60);
  });

  test("PnlSummarySchema parses value response", () => {
    const result = PnlSummarySchema.parse({
      user: "0xwallet", value: 6.97,
    });
    expect(result.value).toBe(6.97);
  });
});
