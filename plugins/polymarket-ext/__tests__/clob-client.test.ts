import { describe, expect, test, beforeEach } from "bun:test";
import { ClobApiClient, type ClobClientConfig } from "../clob-client";
import { PolymarketAuthError, PolymarketRateLimitError } from "../types";

let mockResponses: Map<string, { status: number; body: unknown }>;
let capturedRequests: Array<{
  url: string;
  method: string;
  headers: Record<string, string>;
  body?: string;
}>;

const TEST_CONFIG: ClobClientConfig = {
  baseUrl: "https://clob.polymarket.com",
  apiKey: "test-api-key",
  secret: "dGVzdC1zZWNyZXQ=",
  passphrase: "test-pass",
  address: "0x1234567890abcdef1234567890abcdef12345678",
};

beforeEach(() => {
  mockResponses = new Map();
  capturedRequests = [];

  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === "string" ? input : input.toString();
    const method = init?.method ?? "GET";
    const headers: Record<string, string> = {};
    if (init?.headers) {
      for (const [k, v] of Object.entries(init.headers as Record<string, string>)) {
        headers[k] = v;
      }
    }
    capturedRequests.push({ url, method, headers, body: init?.body as string | undefined });

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

describe("ClobApiClient auth headers", () => {
  test("sends all 5 POLY_* headers on every request", async () => {
    setMock("/v1/heartbeats", { heartbeat_id: "hb-test" });
    const client = new ClobApiClient(TEST_CONFIG);
    await client.heartbeat();
    const req = capturedRequests[0]!;
    expect(req.headers["POLY_ADDRESS"]).toBe(TEST_CONFIG.address);
    expect(req.headers["POLY_API_KEY"]).toBe(TEST_CONFIG.apiKey);
    expect(req.headers["POLY_PASSPHRASE"]).toBe(TEST_CONFIG.passphrase);
    expect(req.headers["POLY_TIMESTAMP"]).toBeDefined();
    expect(req.headers["POLY_SIGNATURE"]).toBeDefined();
  });

  test("POLY_TIMESTAMP is a recent unix timestamp in seconds", async () => {
    setMock("/heartbeat", { status: "ok" });
    const client = new ClobApiClient(TEST_CONFIG);
    const before = Math.floor(Date.now() / 1000);
    await client.heartbeat();
    const after = Math.floor(Date.now() / 1000);
    const ts = Number(capturedRequests[0]!.headers["POLY_TIMESTAMP"]);
    expect(ts).toBeGreaterThanOrEqual(before);
    expect(ts).toBeLessThanOrEqual(after);
  });

  test("POLY_SIGNATURE is non-empty string", async () => {
    setMock("/v1/heartbeats", { heartbeat_id: "hb-test" });
    const client = new ClobApiClient(TEST_CONFIG);
    await client.heartbeat();
    const sig = capturedRequests[0]!.headers["POLY_SIGNATURE"]!;
    expect(sig.length).toBeGreaterThan(0);
  });
});

describe("ClobApiClient.cancelOrder", () => {
  test("sends DELETE to /order with id in body", async () => {
    setMock("/order", { canceled: "order-abc" });
    const client = new ClobApiClient(TEST_CONFIG);
    const result = await client.cancelOrder("order-abc");
    expect(capturedRequests[0]!.method).toBe("DELETE");
    expect(capturedRequests[0]!.url).toContain("/order");
    expect(result.canceled).toBe("order-abc");
    const body = JSON.parse(capturedRequests[0]!.body!);
    expect(body.id).toBe("order-abc");
  });
});

describe("ClobApiClient.cancelAll", () => {
  test("sends DELETE to /cancel-all", async () => {
    setMock("/cancel-all", { canceled: ["a", "b"] });
    const client = new ClobApiClient(TEST_CONFIG);
    const result = await client.cancelAll();
    expect(capturedRequests[0]!.method).toBe("DELETE");
    expect(capturedRequests[0]!.url).toContain("/cancel-all");
    expect(result.canceled).toEqual(["a", "b"]);
  });
});

describe("ClobApiClient.cancelMarketOrders", () => {
  test("sends DELETE to /cancel-market-orders with asset_ids", async () => {
    setMock("/cancel-market-orders", { canceled: ["c"] });
    const client = new ClobApiClient(TEST_CONFIG);
    const result = await client.cancelMarketOrders(["asset-1", "asset-2"]);
    expect(capturedRequests[0]!.method).toBe("DELETE");
    const body = JSON.parse(capturedRequests[0]!.body!);
    expect(body.asset_ids).toEqual(["asset-1", "asset-2"]);
    expect(result.canceled).toEqual(["c"]);
  });
});

describe("ClobApiClient.getOpenOrders", () => {
  test("sends GET to /data/orders with state=open", async () => {
    setMock("/data/orders", {
      data: [
        { id: "o1", market: "0xabc", asset_id: "t1", side: "BUY", price: "0.55",
          original_size: "100", size_matched: "50", status: "live",
          created_at: "1711500000", order_type: "GTC" },
      ],
      next_cursor: "LTE=",
    });
    const client = new ClobApiClient(TEST_CONFIG);
    const orders = await client.getOpenOrders();
    expect(capturedRequests[0]!.method).toBe("GET");
    expect(capturedRequests[0]!.url).toContain("state=open");
    expect(orders).toHaveLength(1);
    expect(orders[0]!.id).toBe("o1");
  });

  test("passes optional market filter as query param", async () => {
    setMock("/data/orders", { data: [], next_cursor: "LTE=" });
    const client = new ClobApiClient(TEST_CONFIG);
    await client.getOpenOrders({ market: "0xabc" });
    expect(capturedRequests[0]!.url).toContain("market=0xabc");
  });
});

describe("ClobApiClient.getOrderBook", () => {
  test("sends GET to /book with token_id", async () => {
    setMock("/book", { bids: [{ price: "0.50", size: "100" }], asks: [{ price: "0.51", size: "200" }] });
    const client = new ClobApiClient(TEST_CONFIG);
    const book = await client.getOrderBook("token-123");
    expect(capturedRequests[0]!.url).toContain("token_id=token-123");
    expect(book.bids).toHaveLength(1);
    expect(book.asks[0]!.size).toBe("200");
  });
});

describe("ClobApiClient.heartbeat", () => {
  test("sends POST to /v1/heartbeats", async () => {
    setMock("/v1/heartbeats", { heartbeat_id: "hb-123" });
    const client = new ClobApiClient(TEST_CONFIG);
    await client.heartbeat();
    expect(capturedRequests[0]!.method).toBe("POST");
    expect(capturedRequests[0]!.url).toContain("/v1/heartbeats");
  });

  test("chains heartbeat_id from previous response", async () => {
    setMock("/v1/heartbeats", { heartbeat_id: "hb-456" });
    const client = new ClobApiClient(TEST_CONFIG);
    await client.heartbeat();
    // Second call should send the heartbeat_id from first response
    capturedRequests = [];
    setMock("/v1/heartbeats", { heartbeat_id: "hb-789" });
    await client.heartbeat();
    const body = JSON.parse(capturedRequests[0]!.body!);
    expect(body.heartbeat_id).toBe("hb-456");
  });
});

describe("ClobApiClient error handling", () => {
  test("throws PolymarketAuthError on 401", async () => {
    setMock("/v1/heartbeats", { error: "unauthorized" }, 401);
    const client = new ClobApiClient(TEST_CONFIG);
    try {
      await client.heartbeat();
      expect(true).toBe(false);
    } catch (err) {
      expect(err).toBeInstanceOf(PolymarketAuthError);
    }
  });

  test("throws PolymarketAuthError on 403", async () => {
    setMock("/v1/heartbeats", { error: "forbidden" }, 403);
    const client = new ClobApiClient(TEST_CONFIG);
    try {
      await client.heartbeat();
      expect(true).toBe(false);
    } catch (err) {
      expect(err).toBeInstanceOf(PolymarketAuthError);
    }
  });

  test("throws PolymarketRateLimitError on 429", async () => {
    setMock("/v1/heartbeats", { error: "rate limited" }, 429);
    const client = new ClobApiClient(TEST_CONFIG);
    try {
      await client.heartbeat();
      expect(true).toBe(false);
    } catch (err) {
      expect(err).toBeInstanceOf(PolymarketRateLimitError);
    }
  });
});
