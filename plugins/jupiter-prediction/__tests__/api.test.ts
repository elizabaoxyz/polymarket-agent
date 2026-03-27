import { describe, expect, test, beforeEach } from "bun:test";
import { JupiterPredictionClient } from "../api";

let mockResponses: Map<string, { status: number; body: unknown }>;
let capturedRequests: Array<{ url: string; method: string; headers: Record<string, string> }>;

beforeEach(() => {
  mockResponses = new Map();
  capturedRequests = [];

  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === "string" ? input : input.toString();
    const method = init?.method ?? "GET";
    const headers: Record<string, string> = {};
    if (init?.headers) {
      const h = init.headers as Record<string, string>;
      for (const [k, v] of Object.entries(h)) {
        headers[k] = v;
      }
    }
    capturedRequests.push({ url, method, headers });

    for (const [pattern, resp] of mockResponses.entries()) {
      if (url.includes(pattern)) {
        return new Response(JSON.stringify(resp.body), {
          status: resp.status,
          headers: { "content-type": "application/json" },
        });
      }
    }
    return new Response("Not Found", { status: 404 });
  }) as typeof fetch;
});

function setMock(urlPattern: string, body: unknown, status = 200): void {
  mockResponses.set(urlPattern, { status, body });
}

const sampleMarket = {
  marketId: "POLY-123",
  status: "open",
  closeTime: 1857168000,
  metadata: { title: "Will it rain?" },
  pricing: {
    buyYesPriceUsd: 600_000,
    sellYesPriceUsd: 598_000,
    sellNoPriceUsd: 398_000,
    buyNoPriceUsd: 400_000,
  },
};

describe("JupiterPredictionClient", () => {
  const client = new JupiterPredictionClient("test-api-key");

  test("sends x-api-key header on every request", async () => {
    setMock("/trading-status", { operational: true });
    await client.getTradingStatus();
    expect(capturedRequests[0]!.headers["x-api-key"]).toBe("test-api-key");
  });

  test("getTradingStatus returns parsed response", async () => {
    setMock("/trading-status", { operational: true });
    const result = await client.getTradingStatus();
    expect(result.operational).toBe(true);
  });

  test("getEvents unwraps data array", async () => {
    setMock("/events", {
      data: [
        {
          eventId: "E1",
          isActive: true,
          isLive: true,
          category: "crypto",
          metadata: { title: "Test Event" },
          markets: [],
        },
      ],
    });
    const events = await client.getEvents({ status: "live" });
    expect(events).toHaveLength(1);
    expect(events[0]!.metadata.title).toBe("Test Event");
    expect(capturedRequests[0]!.url).toContain("status=live");
  });

  test("getMarket fetches single market", async () => {
    setMock("/markets/m1", sampleMarket);
    const market = await client.getMarket("m1");
    expect(market.metadata.title).toBe("Will it rain?");
  });

  test("getOrderbook fetches yes/no arrays", async () => {
    setMock("/orderbook/m1", { yes: [[24, 100]], no: [[76, 200]] });
    const book = await client.getOrderbook("m1");
    expect(book.yes).toHaveLength(1);
    expect(book.no[0]![1]).toBe(200);
  });

  test("placeOrder sends POST with body", async () => {
    setMock("/orders", { transaction: "dHhkYXRh", orderPubkey: "order123" });
    const result = await client.placeOrder({
      ownerPubkey: "wallet1", marketId: "m1", isYes: true, isBuy: true,
      depositAmount: 5_000_000, depositMint: "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v",
    });
    expect(result.transaction).toBe("dHhkYXRh");
    expect(capturedRequests[0]!.method).toBe("POST");
  });

  test("getPositions fetches with ownerPubkey query", async () => {
    setMock("/positions", {
      data: [
        { positionPubkey: "pos1", marketId: "m1", isYes: true, quantity: 5,
          averagePrice: 400_000, currentPrice: 600_000, status: "open" },
      ],
    });
    const positions = await client.getPositions("wallet1");
    expect(positions).toHaveLength(1);
    expect(positions[0]!.positionPubkey).toBe("pos1");
    expect(capturedRequests[0]!.url).toContain("ownerPubkey=wallet1");
  });

  test("getOrderStatus returns status", async () => {
    setMock("/orders/status/order1", { status: "filled", orderPubkey: "order1" });
    const status = await client.getOrderStatus("order1");
    expect(status.status).toBe("filled");
  });

  test("throws on 401 with helpful message", async () => {
    setMock("/trading-status", { error: "unauthorized" }, 401);
    await expect(client.getTradingStatus()).rejects.toThrow(/API key/);
  });
});
