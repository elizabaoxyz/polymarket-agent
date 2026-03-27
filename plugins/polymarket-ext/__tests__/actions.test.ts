import { describe, expect, test } from "bun:test";
import {
  cancelPolymarketOrder,
  cancelAllPolymarketOrders,
  getPolymarketOpenOrders,
  sellPolymarketPosition,
  getPolymarketPositions,
  getPolymarketTrades,
  getPolymarketPnl,
  placePolymarketOrder,
} from "../actions";
import { POLYMARKET_EXT_SERVICE_TYPE } from "../types";

function mockRuntime(svc: unknown) {
  return {
    getService: (name: string) => (name === POLYMARKET_EXT_SERVICE_TYPE ? svc : undefined),
  } as any;
}

function mockMessage(text: string) {
  return { content: { text } } as any;
}

function collectCallback(): { calls: string[]; fn: (response: { text: string }) => void } {
  const calls: string[] = [];
  return { calls, fn: (response: { text: string }) => calls.push(response.text) };
}

// --- P0: Cancel Order ---

describe("POLYMARKET_CANCEL_ORDER", () => {
  test("cancels order by ID from message text", async () => {
    const cb = collectCallback();
    const svc = {
      clob: { cancelOrder: async (id: string) => ({ canceled: id }) },
      isFullyActive: () => true,
    };
    await cancelPolymarketOrder.handler(
      mockRuntime(svc), mockMessage("cancel order abc-123-def"), undefined, undefined, cb.fn,
    );
    expect(cb.calls.length).toBeGreaterThan(0);
    expect(cb.calls[0]).toContain("abc-123-def");
  });

  test("returns error when no order ID found", async () => {
    const cb = collectCallback();
    const svc = { clob: {}, isFullyActive: () => true };
    await cancelPolymarketOrder.handler(
      mockRuntime(svc), mockMessage("cancel my order please"), undefined, undefined, cb.fn,
    );
    expect(cb.calls[0]).toContain("order ID");
  });

  test("returns error when CLOB not active", async () => {
    const cb = collectCallback();
    const svc = { clob: null, isFullyActive: () => false };
    await cancelPolymarketOrder.handler(
      mockRuntime(svc), mockMessage("cancel order abc"), undefined, undefined, cb.fn,
    );
    expect(cb.calls[0]).toContain("credentials");
  });
});

// --- P0: Cancel All ---

describe("POLYMARKET_CANCEL_ALL", () => {
  test("cancels all orders when no market specified", async () => {
    const cb = collectCallback();
    const svc = {
      clob: { cancelAll: async () => ({ canceled: ["a", "b", "c"] }) },
      isFullyActive: () => true,
    };
    await cancelAllPolymarketOrders.handler(
      mockRuntime(svc), mockMessage("cancel all orders"), undefined, undefined, cb.fn,
    );
    expect(cb.calls[0]).toContain("3");
  });

  test("returns error when CLOB not active", async () => {
    const cb = collectCallback();
    const svc = { clob: null, isFullyActive: () => false };
    await cancelAllPolymarketOrders.handler(
      mockRuntime(svc), mockMessage("cancel everything"), undefined, undefined, cb.fn,
    );
    expect(cb.calls[0]).toContain("credentials");
  });
});

// --- P0: Open Orders ---

describe("POLYMARKET_GET_ORDERS", () => {
  test("lists open orders", async () => {
    const cb = collectCallback();
    const svc = {
      clob: {
        getOpenOrders: async () => [
          { id: "order-1", market: "0xabc", asset_id: "t1", side: "BUY", price: "0.55",
            original_size: "100", size_matched: "50", status: "live",
            created_at: "1711500000", order_type: "GTC" },
        ],
      },
      isFullyActive: () => true,
    };
    await getPolymarketOpenOrders.handler(
      mockRuntime(svc), mockMessage("show my open orders"), undefined, undefined, cb.fn,
    );
    expect(cb.calls[0]).toContain("order-1");
    expect(cb.calls[0]).toContain("BUY");
  });

  test("handles empty order list", async () => {
    const cb = collectCallback();
    const svc = {
      clob: { getOpenOrders: async () => [] },
      isFullyActive: () => true,
    };
    await getPolymarketOpenOrders.handler(
      mockRuntime(svc), mockMessage("show orders"), undefined, undefined, cb.fn,
    );
    expect(cb.calls[0]).toContain("No open orders");
  });
});

// --- P1: Sell Position ---

describe("POLYMARKET_SELL", () => {
  test("sells shares with explicit price", async () => {
    const cb = collectCallback();
    const svc = {
      clob: {
        getOrderBook: async () => ({
          bids: [{ price: "0.55", size: "200" }],
          asks: [{ price: "0.56", size: "100" }],
        }),
      },
      walletAddress: "0xwallet",
      sellOrder: async (_params: { tokenId: string; price: number; size: number }) => ({
        orderID: "sell-order-1",
        status: "matched",
        transactionsHashes: ["0xtx1"],
      }),
      isFullyActive: () => true,
    };
    await sellPolymarketPosition.handler(
      mockRuntime(svc),
      mockMessage("sell 50 shares of token token-abc at $0.60"),
      undefined, undefined, cb.fn,
    );
    expect(cb.calls.length).toBeGreaterThan(0);
    expect(cb.calls[cb.calls.length - 1]).toContain("sell-order-1");
  });

  test("uses best bid when no price specified", async () => {
    const cb = collectCallback();
    let capturedPrice: number | undefined;
    const svc = {
      clob: {
        getOrderBook: async () => ({
          bids: [{ price: "0.55", size: "200" }],
          asks: [{ price: "0.56", size: "100" }],
        }),
      },
      walletAddress: "0xwallet",
      sellOrder: async (params: { tokenId: string; price: number; size: number }) => {
        capturedPrice = params.price;
        return { orderID: "sell-2", status: "matched", transactionsHashes: [] };
      },
      isFullyActive: () => true,
    };
    await sellPolymarketPosition.handler(
      mockRuntime(svc),
      mockMessage("sell 10 shares of token token-xyz"),
      undefined, undefined, cb.fn,
    );
    expect(capturedPrice).toBe(0.55);
  });

  test("returns error when no token ID found", async () => {
    const cb = collectCallback();
    const svc = { clob: {}, isFullyActive: () => true };
    await sellPolymarketPosition.handler(
      mockRuntime(svc), mockMessage("sell something"), undefined, undefined, cb.fn,
    );
    expect(cb.calls[0]).toContain("token ID");
  });

  test("returns error when no share count found", async () => {
    const cb = collectCallback();
    const svc = { clob: {}, isFullyActive: () => true };
    await sellPolymarketPosition.handler(
      mockRuntime(svc), mockMessage("sell token token-abc"), undefined, undefined, cb.fn,
    );
    expect(cb.calls[0]).toContain("share");
  });
});

// --- P2: Positions ---

describe("POLYMARKET_GET_POSITIONS", () => {
  test("lists positions with PnL", async () => {
    const cb = collectCallback();
    const svc = {
      data: {
        getPositions: async () => [
          { market_slug: "rain", title: "Will it rain?", outcome: "Yes",
            size: 100, avg_price: 0.55, cur_price: 0.62, realized_pnl: 0,
            condition_id: "0xc", asset_id: "0xa" },
        ],
      },
      walletAddress: "0xwallet",
      isFullyActive: () => true,
    };
    await getPolymarketPositions.handler(
      mockRuntime(svc), mockMessage("show my positions"), undefined, undefined, cb.fn,
    );
    expect(cb.calls[0]).toContain("Will it rain?");
    expect(cb.calls[0]).toContain("Yes");
  });

  test("handles empty positions", async () => {
    const cb = collectCallback();
    const svc = {
      data: { getPositions: async () => [] },
      walletAddress: "0xwallet",
      isFullyActive: () => true,
    };
    await getPolymarketPositions.handler(
      mockRuntime(svc), mockMessage("my positions"), undefined, undefined, cb.fn,
    );
    expect(cb.calls[0]).toContain("No open positions");
  });
});

// --- P2: Trades ---

describe("POLYMARKET_GET_TRADES", () => {
  test("lists recent trades", async () => {
    const cb = collectCallback();
    const svc = {
      data: {
        getTrades: async () => [
          { id: "t1", market_slug: "rain", title: "Rain?", side: "BUY",
            outcome: "Yes", price: 0.55, size: 50,
            timestamp: "2026-03-27T12:00:00Z", transaction_hash: "0xdeadbeef1234567890" },
        ],
      },
      walletAddress: "0xwallet",
      isFullyActive: () => true,
    };
    await getPolymarketTrades.handler(
      mockRuntime(svc), mockMessage("show my trades"), undefined, undefined, cb.fn,
    );
    expect(cb.calls[0]).toContain("BUY");
    expect(cb.calls[0]).toContain("Rain?");
  });

  test("handles empty trades", async () => {
    const cb = collectCallback();
    const svc = {
      data: { getTrades: async () => [] },
      walletAddress: "0xwallet",
      isFullyActive: () => true,
    };
    await getPolymarketTrades.handler(
      mockRuntime(svc), mockMessage("trade history"), undefined, undefined, cb.fn,
    );
    expect(cb.calls[0]).toContain("No trades");
  });
});

// --- P3: PnL ---

describe("POLYMARKET_GET_PNL", () => {
  test("shows PnL summary", async () => {
    const cb = collectCallback();
    const svc = {
      data: {
        getPnl: async () => ({
          total_realized: 150.50,
          total_unrealized: -20.00,
          total_volume: 5000,
          positions_won: 8,
          positions_lost: 3,
        }),
      },
      walletAddress: "0xwallet",
      isFullyActive: () => true,
    };
    await getPolymarketPnl.handler(
      mockRuntime(svc), mockMessage("show my pnl"), undefined, undefined, cb.fn,
    );
    expect(cb.calls[0]).toContain("150.50");
    expect(cb.calls[0]).toContain("-20.00");
    expect(cb.calls[0]).toContain("5000");
  });

  test("returns error when no wallet", async () => {
    const cb = collectCallback();
    const svc = { data: {}, walletAddress: "", isFullyActive: () => false };
    await getPolymarketPnl.handler(
      mockRuntime(svc), mockMessage("my pnl"), undefined, undefined, cb.fn,
    );
    expect(cb.calls[0]).toContain("wallet");
  });
});

// --- Place Order (with token resolution) ---

describe("POLYMARKET_PLACE_ORDER", () => {
  test("searches market, resolves token, and places order", async () => {
    const cb = collectCallback();
    let capturedOrder: any;
    const svc = {
      clob: {
        searchMarkets: async () => [{
          condition_id: "0xcond1",
          question: "Will it rain tomorrow?",
          tokens: [
            { token_id: "token-yes-123", outcome: "Yes", price: 0.55 },
            { token_id: "token-no-456", outcome: "No", price: 0.45 },
          ],
          active: true,
          closed: false,
          accepting_orders: true,
        }],
        getOrderBook: async () => ({
          bids: [{ price: "0.53", size: "100" }],
          asks: [{ price: "0.56", size: "200" }],
        }),
      },
      placeOrder: async (params: any) => {
        capturedOrder = params;
        return { orderID: "placed-1", status: "matched", transactionsHashes: ["0xtx1"] };
      },
      isFullyActive: () => true,
    };
    await placePolymarketOrder.handler(
      mockRuntime(svc),
      mockMessage("buy $5 YES on 'Will it rain tomorrow?'"),
      undefined, undefined, cb.fn,
    );
    expect(cb.calls.length).toBe(1);
    expect(cb.calls[0]).toContain("placed-1");
    expect(cb.calls[0]).toContain("BUY");
    expect(capturedOrder.tokenId).toBe("token-yes-123");
    expect(capturedOrder.side).toBe("BUY");
  });

  test("returns error when no market found", async () => {
    const cb = collectCallback();
    const svc = {
      clob: { searchMarkets: async () => [] },
      isFullyActive: () => true,
    };
    await placePolymarketOrder.handler(
      mockRuntime(svc),
      mockMessage("buy $5 YES on 'nonexistent market xyz'"),
      undefined, undefined, cb.fn,
    );
    expect(cb.calls[0]).toContain("No active markets");
  });

  test("returns error when no outcome specified", async () => {
    const cb = collectCallback();
    const svc = { clob: {}, isFullyActive: () => true };
    await placePolymarketOrder.handler(
      mockRuntime(svc),
      mockMessage("buy $5 on 'something'"),
      undefined, undefined, cb.fn,
    );
    expect(cb.calls[0]).toContain("YES or NO");
  });

  test("returns error when no amount specified", async () => {
    const cb = collectCallback();
    const svc = { clob: {}, isFullyActive: () => true };
    await placePolymarketOrder.handler(
      mockRuntime(svc),
      mockMessage("buy YES on 'something'"),
      undefined, undefined, cb.fn,
    );
    expect(cb.calls[0]).toContain("dollar amount");
  });
});
