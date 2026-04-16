import { describe, expect, test } from "bun:test";
import { type AutonomyCallbacks, type AutonomyDeps, createState } from "./autonomy-state";
import { type BuyExecutionResult, directJupiterBuy, directPolymarketBuy } from "./autonomy-trade";

function createDeps(service: unknown): AutonomyDeps {
  return {
    runtime: {
      getServiceLoadPromise: async () => service,
    } as never,
    messageService: {
      handleMessage: async () => undefined,
    },
    roomId: "room" as never,
    userId: "user" as never,
    ragSvc: null,
    connectorsSvc: null,
    runtimeMutex: {
      runExclusive: async <T>(fn: () => Promise<T>) => fn(),
    } as never,
  };
}

function createCallbacks(logs: string[]): AutonomyCallbacks {
  return {
    send: () => {},
    log: (text) => {
      logs.push(text);
    },
  };
}

describe("directPolymarketBuy", () => {
  test("returns pending and tracks the full question when GTC remains open", async () => {
    const state = createState("both");
    const logs: string[] = [];
    const service = {
      isFullyActive: () => true,
      clob: {
        getOrderBook: async () => ({
          asks: [{ price: "0.42" }],
          bids: [{ price: "0.40" }],
        }),
      },
      placeMarketOrder: async () => ({
        orderID: "fok-1",
        status: "unfilled",
        transactionsHashes: [],
      }),
      placeOrder: async () => ({
        orderID: "gtc-1",
        status: "live",
        transactionsHashes: [],
      }),
    };

    const result = await directPolymarketBuy(
      createDeps(service),
      createCallbacks(logs),
      state,
      "Will BTC hit $150k by December 31?",
      "YES",
      5,
      10,
      "token-yes",
      0.41,
    );

    expect(result.status).toBe("pending");
    expect((result as Extract<BuyExecutionResult, { status: "pending" }>).amountUsd).toBeCloseTo(
      4.92,
      2,
    );
    expect(state.pendingOrders.get("gtc-1")?.question).toBe("Will BTC hit $150k by December 31?");
    expect(state.dailySpend).toBe(0);
  });

  test("returns filled when FOK matches immediately", async () => {
    const state = createState("both");
    const logs: string[] = [];
    const service = {
      isFullyActive: () => true,
      clob: {
        getOrderBook: async () => ({
          asks: [{ price: "0.42" }],
          bids: [{ price: "0.40" }],
        }),
      },
      placeMarketOrder: async () => ({
        orderID: "fok-2",
        status: "matched",
        transactionsHashes: ["0xtx"],
      }),
      placeOrder: async () => {
        throw new Error("should not place GTC when FOK fills");
      },
    };

    const result = await directPolymarketBuy(
      createDeps(service),
      createCallbacks(logs),
      state,
      "Will ETH hit $10k by December 31?",
      "YES",
      5,
      10,
      "token-yes",
      0.41,
    );

    expect(result).toEqual({ status: "filled", amountUsd: 5 });
    expect(state.pendingOrders.size).toBe(0);
    expect(state.dailySpend).toBe(5);
  });
});

describe("directJupiterBuy", () => {
  test("fails before order submission when no single mint can cover the full bet", async () => {
    const state = createState("both");
    const logs: string[] = [];
    let placeOrderCalls = 0;
    const service = {
      ownerPubkey: "owner-1",
      placeOrderAndSign: async () => {
        placeOrderCalls++;
        return { orderId: "jup-1", signature: "sig-1" };
      },
    };

    const result = await directJupiterBuy(
      createDeps(service),
      createCallbacks(logs),
      state,
      "market-1",
      "YES",
      3,
      "BTC market",
      4,
      2.1,
      1.4,
    );

    expect(result).toEqual({ status: "failed" });
    expect(placeOrderCalls).toBe(0);
    expect(state.jupBuyPausedUntil).toBeGreaterThan(Date.now());
    expect(logs.some((line) => line.includes("requires one mint"))).toBe(true);
  });

  test("uses JupUSD when it fully covers the bet", async () => {
    const state = createState("both");
    const logs: string[] = [];
    type PlacedOrder = {
      ownerPubkey: string;
      marketId: string;
      isYes: boolean;
      isBuy: boolean;
      depositAmount: number;
      depositMint: string;
    };
    let placedOrder: PlacedOrder | undefined;
    const service = {
      ownerPubkey: "owner-2",
      placeOrderAndSign: async (params: PlacedOrder) => {
        placedOrder = params;
        return { orderId: "jup-2", signature: "sig-2" };
      },
    };

    const result = await directJupiterBuy(
      createDeps(service),
      createCallbacks(logs),
      state,
      "market-2",
      "NO",
      3,
      "ETH market",
      5,
      1,
      4,
    );

    expect(result).toEqual({ status: "filled", amountUsd: 3 });
    expect(placedOrder?.depositMint.startsWith("Jupr")).toBe(true);
    expect(placedOrder?.isYes).toBe(false);
    expect(state.dailySpend).toBe(3);
  });
});
