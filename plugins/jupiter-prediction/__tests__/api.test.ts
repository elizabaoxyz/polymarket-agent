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

  test("getEvents fetches live events", async () => {
    setMock("/events", [
      { id: "e1", title: "Test Event", category: "crypto", status: "live", markets: [] },
    ]);
    const events = await client.getEvents({ status: "live" });
    expect(events).toHaveLength(1);
    expect(events[0]!.title).toBe("Test Event");
    expect(capturedRequests[0]!.url).toContain("status=live");
  });

  test("getMarket fetches single market", async () => {
    setMock("/markets/m1", {
      id: "m1", question: "Will it rain?", yesPrice: 600_000, noPrice: 400_000,
      status: "active", expiresAt: "2026-12-31T00:00:00Z",
    });
    const market = await client.getMarket("m1");
    expect(market.question).toBe("Will it rain?");
  });

  test("getOrderbook fetches bid/ask arrays", async () => {
    setMock("/orderbook/m1", { bids: [[0.45, 100]], asks: [[0.55, 200]] });
    const book = await client.getOrderbook("m1");
    expect(book.bids).toHaveLength(1);
    expect(book.asks[0]![1]).toBe(200);
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
    setMock("/positions", [
      { positionPubkey: "pos1", marketId: "m1", isYes: true, quantity: 5,
        averagePrice: 400_000, currentPrice: 600_000, status: "open" },
    ]);
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
