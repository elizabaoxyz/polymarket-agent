import { describe, expect, test, beforeEach } from "bun:test";
import { DataApiClient } from "../data-client";

let mockResponses: Map<string, { status: number; body: unknown }>;
let capturedRequests: Array<{ url: string; method: string }>;

beforeEach(() => {
  mockResponses = new Map();
  capturedRequests = [];

  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === "string" ? input : input.toString();
    capturedRequests.push({ url, method: init?.method ?? "GET" });

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

const samplePosition = {
  market_slug: "will-it-rain", title: "Will it rain?", outcome: "Yes",
  size: 100, avg_price: 0.55, cur_price: 0.62, realized_pnl: 0,
  condition_id: "0xcond1", asset_id: "0xasset1",
};

const sampleTrade = {
  id: "trade-1", market_slug: "will-it-rain", title: "Will it rain?",
  side: "BUY", outcome: "Yes", price: 0.55, size: 50,
  timestamp: "2026-03-27T12:00:00Z", transaction_hash: "0xdeadbeef",
};

describe("DataApiClient.getPositions", () => {
  test("sends GET with user query param", async () => {
    setMock("/positions", [samplePosition]);
    const client = new DataApiClient("https://data-api.polymarket.com");
    const positions = await client.getPositions("0xwallet");
    expect(capturedRequests[0]!.url).toContain("user=0xwallet");
    expect(positions).toHaveLength(1);
    expect(positions[0]!.title).toBe("Will it rain?");
  });
});

describe("DataApiClient.getClosedPositions", () => {
  test("sends GET to /closed-positions", async () => {
    setMock("/closed-positions", [samplePosition]);
    const client = new DataApiClient("https://data-api.polymarket.com");
    const positions = await client.getClosedPositions("0xwallet");
    expect(capturedRequests[0]!.url).toContain("/closed-positions");
    expect(capturedRequests[0]!.url).toContain("user=0xwallet");
    expect(positions).toHaveLength(1);
  });
});

describe("DataApiClient.getTrades", () => {
  test("sends GET with user and default limit", async () => {
    setMock("/trades", [sampleTrade]);
    const client = new DataApiClient("https://data-api.polymarket.com");
    const trades = await client.getTrades("0xwallet");
    expect(capturedRequests[0]!.url).toContain("user=0xwallet");
    expect(capturedRequests[0]!.url).toContain("limit=20");
    expect(trades).toHaveLength(1);
    expect(trades[0]!.side).toBe("BUY");
  });

  test("passes custom limit and market filter", async () => {
    setMock("/trades", []);
    const client = new DataApiClient("https://data-api.polymarket.com");
    await client.getTrades("0xwallet", { limit: 5, market: "rain-market" });
    expect(capturedRequests[0]!.url).toContain("limit=5");
    expect(capturedRequests[0]!.url).toContain("market=rain-market");
  });
});

describe("DataApiClient.getPnl", () => {
  test("sends GET to /pnl with user param", async () => {
    setMock("/pnl", { total_realized: 100, total_unrealized: -10, total_volume: 5000 });
    const client = new DataApiClient("https://data-api.polymarket.com");
    const pnl = await client.getPnl("0xwallet");
    expect(capturedRequests[0]!.url).toContain("/pnl");
    expect(capturedRequests[0]!.url).toContain("user=0xwallet");
    expect(pnl.total_realized).toBe(100);
    expect(pnl.total_volume).toBe(5000);
  });
});

describe("DataApiClient error handling", () => {
  test("throws on non-200 response", async () => {
    setMock("/positions", { error: "bad request" }, 400);
    const client = new DataApiClient("https://data-api.polymarket.com");
    await expect(client.getPositions("0xwallet")).rejects.toThrow(/400/);
  });
});
