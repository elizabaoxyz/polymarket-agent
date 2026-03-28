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
  asset: "token123", conditionId: "0xcond1", size: 100, avgPrice: 0.55,
  initialValue: 55, currentValue: 62, cashPnl: 7, percentPnl: 12.7,
  curPrice: 0.62, realizedPnl: 0, title: "Will it rain?", slug: "will-it-rain",
  outcome: "Yes",
};

const sampleTrade = {
  conditionId: "0xcond1", type: "TRADE", size: 50, usdcSize: 2.50,
  price: 0.55, side: "BUY", outcome: "Yes", title: "Will it rain?",
  transactionHash: "0xdeadbeef", timestamp: 1774700000,
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

describe("DataApiClient.getTrades", () => {
  test("sends GET to /activity with user and limit", async () => {
    setMock("/activity", [sampleTrade]);
    const client = new DataApiClient("https://data-api.polymarket.com");
    const trades = await client.getTrades("0xwallet");
    expect(capturedRequests[0]!.url).toContain("/activity");
    expect(capturedRequests[0]!.url).toContain("user=0xwallet");
    expect(capturedRequests[0]!.url).toContain("limit=20");
    expect(trades).toHaveLength(1);
    expect(trades[0]!.side).toBe("BUY");
  });
});

describe("DataApiClient.getPnl", () => {
  test("sends GET to /value with user param", async () => {
    setMock("/value", [{ user: "0xwallet", value: 6.97 }]);
    const client = new DataApiClient("https://data-api.polymarket.com");
    const pnl = await client.getPnl("0xwallet");
    expect(capturedRequests[0]!.url).toContain("/value");
    expect(capturedRequests[0]!.url).toContain("user=0xwallet");
    expect(pnl.value).toBe(6.97);
  });

  test("returns zero when empty array", async () => {
    setMock("/value", []);
    const client = new DataApiClient("https://data-api.polymarket.com");
    const pnl = await client.getPnl("0xwallet");
    expect(pnl.value).toBe(0);
  });
});

describe("DataApiClient error handling", () => {
  test("throws on non-200 response", async () => {
    setMock("/positions", { error: "bad request" }, 400);
    const client = new DataApiClient("https://data-api.polymarket.com");
    await expect(client.getPositions("0xwallet")).rejects.toThrow(/400/);
  });
});
