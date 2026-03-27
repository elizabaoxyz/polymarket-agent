# polymarket-ext Plugin Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add 8 new elizaOS actions for order cancellation, position management, trade history, and PnL tracking — plus a background heartbeat service — to fill the gaps in `@elizaos/plugin-polymarket`.

**Architecture:** New plugin at `plugins/polymarket-ext/` with two API clients (CLOB authenticated + Data public), one service (heartbeat loop + client lifecycle), and 8 actions. Runs alongside the existing `@elizaos/plugin-polymarket` without modifying it.

**Tech Stack:** TypeScript, Zod (validation), ethers (wallet address derivation), bun:test (testing), `@polymarket/clob-client` (sell order signing)

**Spec:** `docs/superpowers/specs/2026-03-27-polymarket-ext-plugin-design.md`

---

## File Map

| File | Responsibility |
|------|---------------|
| `plugins/polymarket-ext/types.ts` | Zod schemas, error classes, service type constant |
| `plugins/polymarket-ext/clob-client.ts` | Authenticated CLOB API client (HMAC L2 auth) |
| `plugins/polymarket-ext/data-client.ts` | Public Data API client (no auth) |
| `plugins/polymarket-ext/service.ts` | PolymarketExtService (lifecycle, heartbeat, client factory) |
| `plugins/polymarket-ext/actions.ts` | 8 elizaOS actions |
| `plugins/polymarket-ext/index.ts` | Plugin export |
| `plugins/polymarket-ext/__tests__/types.test.ts` | Schema + error class tests |
| `plugins/polymarket-ext/__tests__/clob-client.test.ts` | CLOB client tests (mock fetch) |
| `plugins/polymarket-ext/__tests__/data-client.test.ts` | Data client tests (mock fetch) |
| `plugins/polymarket-ext/__tests__/service.test.ts` | Service lifecycle tests |
| `plugins/polymarket-ext/__tests__/actions.test.ts` | Action handler tests |
| `runner.ts` | Add polymarketExtPlugin to runtime plugins |

---

### Task 1: Types and Error Classes

**Files:**
- Create: `plugins/polymarket-ext/types.ts`
- Create: `plugins/polymarket-ext/__tests__/types.test.ts`

- [ ] **Step 1: Write the failing tests**

Create `plugins/polymarket-ext/__tests__/types.test.ts`:

```typescript
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
      id: "order-1",
      market: "0xabc",
      asset_id: "token-1",
      side: "BUY",
      price: "0.55",
      original_size: "100",
      size_matched: "50",
      status: "live",
      created_at: "1711500000",
      order_type: "GTC",
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
      market_slug: "will-it-rain",
      title: "Will it rain tomorrow?",
      outcome: "Yes",
      size: 100,
      avg_price: 0.55,
      cur_price: 0.62,
      realized_pnl: 0,
      condition_id: "0xcond1",
      asset_id: "0xasset1",
    });
    expect(result.size).toBe(100);
    expect(result.cur_price).toBe(0.62);
  });

  test("TradeSchema parses trade object", () => {
    const result = TradeSchema.parse({
      id: "trade-1",
      market_slug: "will-it-rain",
      title: "Will it rain?",
      side: "BUY",
      outcome: "Yes",
      price: 0.55,
      size: 50,
      timestamp: "2026-03-27T12:00:00Z",
      transaction_hash: "0xdeadbeef",
    });
    expect(result.side).toBe("BUY");
    expect(result.price).toBe(0.55);
  });

  test("PnlSummarySchema parses with optional fields", () => {
    const result = PnlSummarySchema.parse({
      total_realized: 150.50,
      total_unrealized: -20.00,
      total_volume: 5000,
    });
    expect(result.total_realized).toBe(150.50);
    expect(result.positions_won).toBeUndefined();
  });

  test("PnlSummarySchema parses with all fields", () => {
    const result = PnlSummarySchema.parse({
      total_realized: 150.50,
      total_unrealized: -20.00,
      total_volume: 5000,
      positions_won: 8,
      positions_lost: 3,
    });
    expect(result.positions_won).toBe(8);
    expect(result.positions_lost).toBe(3);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `bun test plugins/polymarket-ext/__tests__/types.test.ts`
Expected: FAIL — module `../types` does not exist

- [ ] **Step 3: Write the implementation**

Create `plugins/polymarket-ext/types.ts`:

```typescript
import { z } from "zod";

// --- Service type constant ---

export const POLYMARKET_EXT_SERVICE_TYPE = "POLYMARKET_EXT";

// --- Error classes ---

export class PolymarketApiError extends Error {
  readonly statusCode: number;
  readonly responseBody: string;
  readonly endpoint: string;

  constructor(statusCode: number, responseBody: string, endpoint: string) {
    super(`Polymarket API error ${statusCode} on ${endpoint}: ${responseBody}`);
    this.name = "PolymarketApiError";
    this.statusCode = statusCode;
    this.responseBody = responseBody;
    this.endpoint = endpoint;
  }
}

export class PolymarketAuthError extends PolymarketApiError {
  constructor(statusCode: number, responseBody: string, endpoint: string) {
    super(statusCode, responseBody, endpoint);
    this.name = "PolymarketAuthError";
    this.message = `CLOB credentials invalid or expired (${statusCode} on ${endpoint}). Run settings to reconfigure.`;
  }
}

export class PolymarketRateLimitError extends PolymarketApiError {
  constructor(statusCode: number, responseBody: string, endpoint: string) {
    super(statusCode, responseBody, endpoint);
    this.name = "PolymarketRateLimitError";
    this.message = `Rate limited (${statusCode} on ${endpoint}). Try again in a few seconds.`;
  }
}

// --- CLOB API schemas ---

export const CancelResponseSchema = z.object({
  canceled: z.string(),
}).passthrough();
export type CancelResponse = z.infer<typeof CancelResponseSchema>;

export const CancelAllResponseSchema = z.object({
  canceled: z.array(z.string()),
}).passthrough();
export type CancelAllResponse = z.infer<typeof CancelAllResponseSchema>;

export const OpenOrderSchema = z.object({
  id: z.string(),
  market: z.string(),
  asset_id: z.string(),
  side: z.enum(["BUY", "SELL"]),
  price: z.string(),
  original_size: z.string(),
  size_matched: z.string(),
  status: z.string(),
  created_at: z.string(),
  expiration: z.string().optional(),
  order_type: z.string(),
}).passthrough();
export type OpenOrder = z.infer<typeof OpenOrderSchema>;

export const OpenOrdersResponseSchema = z.array(OpenOrderSchema);

export const OrderBookEntrySchema = z.object({
  price: z.string(),
  size: z.string(),
}).passthrough();

export const OrderBookSchema = z.object({
  bids: z.array(OrderBookEntrySchema),
  asks: z.array(OrderBookEntrySchema),
}).passthrough();
export type OrderBook = z.infer<typeof OrderBookSchema>;

// --- Data API schemas ---

export const PositionSchema = z.object({
  market_slug: z.string(),
  title: z.string(),
  outcome: z.string(),
  size: z.number(),
  avg_price: z.number(),
  cur_price: z.number(),
  realized_pnl: z.number(),
  condition_id: z.string(),
  asset_id: z.string(),
}).passthrough();
export type Position = z.infer<typeof PositionSchema>;

export const TradeSchema = z.object({
  id: z.string(),
  market_slug: z.string(),
  title: z.string(),
  side: z.enum(["BUY", "SELL"]),
  outcome: z.string(),
  price: z.number(),
  size: z.number(),
  timestamp: z.string(),
  transaction_hash: z.string(),
}).passthrough();
export type Trade = z.infer<typeof TradeSchema>;

export const PnlSummarySchema = z.object({
  total_realized: z.number(),
  total_unrealized: z.number(),
  total_volume: z.number(),
  positions_won: z.number().optional(),
  positions_lost: z.number().optional(),
}).passthrough();
export type PnlSummary = z.infer<typeof PnlSummarySchema>;
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `bun test plugins/polymarket-ext/__tests__/types.test.ts`
Expected: All 13 tests PASS

- [ ] **Step 5: Commit**

```bash
git add plugins/polymarket-ext/types.ts plugins/polymarket-ext/__tests__/types.test.ts
git commit -m "feat(polymarket-ext): add Zod schemas and error classes"
```

---

### Task 2: CLOB API Client

**Files:**
- Create: `plugins/polymarket-ext/clob-client.ts`
- Create: `plugins/polymarket-ext/__tests__/clob-client.test.ts`

- [ ] **Step 1: Write the failing tests**

Create `plugins/polymarket-ext/__tests__/clob-client.test.ts`:

```typescript
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
  secret: "dGVzdC1zZWNyZXQ=", // base64 "test-secret"
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
    setMock("/heartbeat", { status: "ok" });
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
    setMock("/heartbeat", { status: "ok" });
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
    setMock("/data/orders", [
      { id: "o1", market: "0xabc", asset_id: "t1", side: "BUY", price: "0.55",
        original_size: "100", size_matched: "50", status: "live",
        created_at: "1711500000", order_type: "GTC" },
    ]);
    const client = new ClobApiClient(TEST_CONFIG);
    const orders = await client.getOpenOrders();
    expect(capturedRequests[0]!.method).toBe("GET");
    expect(capturedRequests[0]!.url).toContain("state=open");
    expect(orders).toHaveLength(1);
    expect(orders[0]!.id).toBe("o1");
  });

  test("passes optional market filter as query param", async () => {
    setMock("/data/orders", []);
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
  test("sends GET to /heartbeat", async () => {
    setMock("/heartbeat", { status: "ok" });
    const client = new ClobApiClient(TEST_CONFIG);
    await client.heartbeat();
    expect(capturedRequests[0]!.method).toBe("GET");
    expect(capturedRequests[0]!.url).toContain("/heartbeat");
  });
});

describe("ClobApiClient error handling", () => {
  test("throws PolymarketAuthError on 401", async () => {
    setMock("/heartbeat", { error: "unauthorized" }, 401);
    const client = new ClobApiClient(TEST_CONFIG);
    try {
      await client.heartbeat();
      expect(true).toBe(false); // should not reach here
    } catch (err) {
      expect(err).toBeInstanceOf(PolymarketAuthError);
    }
  });

  test("throws PolymarketAuthError on 403", async () => {
    setMock("/heartbeat", { error: "forbidden" }, 403);
    const client = new ClobApiClient(TEST_CONFIG);
    try {
      await client.heartbeat();
      expect(true).toBe(false);
    } catch (err) {
      expect(err).toBeInstanceOf(PolymarketAuthError);
    }
  });

  test("throws PolymarketRateLimitError on 429", async () => {
    setMock("/heartbeat", { error: "rate limited" }, 429);
    const client = new ClobApiClient(TEST_CONFIG);
    try {
      await client.heartbeat();
      expect(true).toBe(false);
    } catch (err) {
      expect(err).toBeInstanceOf(PolymarketRateLimitError);
    }
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `bun test plugins/polymarket-ext/__tests__/clob-client.test.ts`
Expected: FAIL — module `../clob-client` does not exist

- [ ] **Step 3: Write the implementation**

Create `plugins/polymarket-ext/clob-client.ts`:

```typescript
import { createHmac } from "node:crypto";
import {
  PolymarketApiError,
  PolymarketAuthError,
  PolymarketRateLimitError,
  CancelResponseSchema,
  CancelAllResponseSchema,
  OpenOrdersResponseSchema,
  OrderBookSchema,
  type CancelResponse,
  type CancelAllResponse,
  type OpenOrder,
  type OrderBook,
} from "./types";

export type ClobClientConfig = {
  readonly baseUrl: string;
  readonly apiKey: string;
  readonly secret: string;
  readonly passphrase: string;
  readonly address: string;
};

export class ClobApiClient {
  private readonly config: ClobClientConfig;

  constructor(config: ClobClientConfig) {
    this.config = config;
  }

  private buildHeaders(method: string, path: string, body?: string): Record<string, string> {
    const timestamp = String(Math.floor(Date.now() / 1000));
    const message = timestamp + method + path + (body ?? "");
    const signature = createHmac("sha256", Buffer.from(this.config.secret, "base64"))
      .update(message)
      .digest("base64");

    return {
      "POLY_ADDRESS": this.config.address,
      "POLY_API_KEY": this.config.apiKey,
      "POLY_PASSPHRASE": this.config.passphrase,
      "POLY_TIMESTAMP": timestamp,
      "POLY_SIGNATURE": signature,
      "content-type": "application/json",
    };
  }

  private async request<T>(
    method: string,
    path: string,
    options: { body?: unknown; query?: Record<string, string>; schema: import("zod").ZodType<T> }
  ): Promise<T> {
    const url = new URL(`${this.config.baseUrl}${path}`);
    if (options.query) {
      for (const [key, value] of Object.entries(options.query)) {
        url.searchParams.set(key, value);
      }
    }

    const bodyStr = options.body ? JSON.stringify(options.body) : undefined;
    const headers = this.buildHeaders(method, path, bodyStr);

    const response = await fetch(url.toString(), {
      method,
      headers,
      ...(bodyStr ? { body: bodyStr } : {}),
    });

    if (response.status === 401 || response.status === 403) {
      const text = await response.text().catch(() => "");
      throw new PolymarketAuthError(response.status, text, path);
    }

    if (response.status === 429) {
      const text = await response.text().catch(() => "");
      throw new PolymarketRateLimitError(response.status, text, path);
    }

    if (!response.ok) {
      const text = await response.text().catch(() => "");
      throw new PolymarketApiError(response.status, text, path);
    }

    const data = await response.json();
    return options.schema.parse(data);
  }

  async cancelOrder(orderId: string): Promise<CancelResponse> {
    return this.request("DELETE", "/order", {
      body: { id: orderId },
      schema: CancelResponseSchema,
    });
  }

  async cancelAll(): Promise<CancelAllResponse> {
    return this.request("DELETE", "/cancel-all", {
      schema: CancelAllResponseSchema,
    });
  }

  async cancelMarketOrders(assetIds: string[]): Promise<CancelAllResponse> {
    return this.request("DELETE", "/cancel-market-orders", {
      body: { asset_ids: assetIds },
      schema: CancelAllResponseSchema,
    });
  }

  async getOpenOrders(params?: { market?: string }): Promise<OpenOrder[]> {
    const query: Record<string, string> = { state: "open" };
    if (params?.market) query.market = params.market;
    return this.request("GET", "/data/orders", {
      query,
      schema: OpenOrdersResponseSchema,
    });
  }

  async getOrderBook(tokenId: string): Promise<OrderBook> {
    return this.request("GET", "/book", {
      query: { token_id: tokenId },
      schema: OrderBookSchema,
    });
  }

  async heartbeat(): Promise<void> {
    await this.request("GET", "/heartbeat", {
      schema: import("zod").then((z) => z.z.unknown()),
    });
  }
}
```

**Wait** — the `heartbeat` method has an async import which is wrong. Fix it:

Replace the `heartbeat` method with:

```typescript
  async heartbeat(): Promise<void> {
    const url = new URL(`${this.config.baseUrl}/heartbeat`);
    const headers = this.buildHeaders("GET", "/heartbeat");
    const response = await fetch(url.toString(), { method: "GET", headers });

    if (response.status === 401 || response.status === 403) {
      const text = await response.text().catch(() => "");
      throw new PolymarketAuthError(response.status, text, "/heartbeat");
    }
    if (response.status === 429) {
      const text = await response.text().catch(() => "");
      throw new PolymarketRateLimitError(response.status, text, "/heartbeat");
    }
    if (!response.ok) {
      const text = await response.text().catch(() => "");
      throw new PolymarketApiError(response.status, text, "/heartbeat");
    }
  }
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `bun test plugins/polymarket-ext/__tests__/clob-client.test.ts`
Expected: All 12 tests PASS

- [ ] **Step 5: Commit**

```bash
git add plugins/polymarket-ext/clob-client.ts plugins/polymarket-ext/__tests__/clob-client.test.ts
git commit -m "feat(polymarket-ext): add authenticated CLOB API client"
```

---

### Task 3: Data API Client

**Files:**
- Create: `plugins/polymarket-ext/data-client.ts`
- Create: `plugins/polymarket-ext/__tests__/data-client.test.ts`

- [ ] **Step 1: Write the failing tests**

Create `plugins/polymarket-ext/__tests__/data-client.test.ts`:

```typescript
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
  market_slug: "will-it-rain",
  title: "Will it rain?",
  outcome: "Yes",
  size: 100,
  avg_price: 0.55,
  cur_price: 0.62,
  realized_pnl: 0,
  condition_id: "0xcond1",
  asset_id: "0xasset1",
};

const sampleTrade = {
  id: "trade-1",
  market_slug: "will-it-rain",
  title: "Will it rain?",
  side: "BUY",
  outcome: "Yes",
  price: 0.55,
  size: 50,
  timestamp: "2026-03-27T12:00:00Z",
  transaction_hash: "0xdeadbeef",
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
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `bun test plugins/polymarket-ext/__tests__/data-client.test.ts`
Expected: FAIL — module `../data-client` does not exist

- [ ] **Step 3: Write the implementation**

Create `plugins/polymarket-ext/data-client.ts`:

```typescript
import { z } from "zod";
import {
  PositionSchema,
  TradeSchema,
  PnlSummarySchema,
  type Position,
  type Trade,
  type PnlSummary,
} from "./types";

export class DataApiClient {
  private readonly baseUrl: string;

  constructor(baseUrl: string) {
    this.baseUrl = baseUrl;
  }

  private async request<T>(path: string, schema: z.ZodType<T>, query: Record<string, string>): Promise<T> {
    const url = new URL(`${this.baseUrl}${path}`);
    for (const [key, value] of Object.entries(query)) {
      url.searchParams.set(key, value);
    }

    const response = await fetch(url.toString());

    if (!response.ok) {
      const text = await response.text().catch(() => "");
      throw new Error(`Data API error ${response.status} on ${path}: ${text}`);
    }

    const data = await response.json();
    return schema.parse(data);
  }

  async getPositions(address: string): Promise<Position[]> {
    return this.request("/positions", z.array(PositionSchema), { user: address });
  }

  async getClosedPositions(address: string): Promise<Position[]> {
    return this.request("/closed-positions", z.array(PositionSchema), { user: address });
  }

  async getTrades(address: string, params?: { limit?: number; market?: string }): Promise<Trade[]> {
    const query: Record<string, string> = {
      user: address,
      limit: String(params?.limit ?? 20),
    };
    if (params?.market) query.market = params.market;
    return this.request("/trades", z.array(TradeSchema), query);
  }

  async getPnl(address: string): Promise<PnlSummary> {
    return this.request("/pnl", PnlSummarySchema, { user: address });
  }
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `bun test plugins/polymarket-ext/__tests__/data-client.test.ts`
Expected: All 6 tests PASS

- [ ] **Step 5: Commit**

```bash
git add plugins/polymarket-ext/data-client.ts plugins/polymarket-ext/__tests__/data-client.test.ts
git commit -m "feat(polymarket-ext): add public Data API client"
```

---

### Task 4: Service (Lifecycle + Heartbeat)

**Files:**
- Create: `plugins/polymarket-ext/service.ts`
- Create: `plugins/polymarket-ext/__tests__/service.test.ts`

- [ ] **Step 1: Write the failing tests**

Create `plugins/polymarket-ext/__tests__/service.test.ts`:

```typescript
import { describe, expect, test, beforeEach, afterEach } from "bun:test";
import { PolymarketExtService } from "../service";
import { POLYMARKET_EXT_SERVICE_TYPE } from "../types";

// Suppress console.log/warn during tests
const originalLog = console.log;
const originalWarn = console.warn;
beforeEach(() => {
  console.log = () => {};
  console.warn = () => {};
});
afterEach(() => {
  console.log = originalLog;
  console.warn = originalWarn;
});

describe("PolymarketExtService", () => {
  test("serviceType matches constant", () => {
    expect(PolymarketExtService.serviceType).toBe(POLYMARKET_EXT_SERVICE_TYPE);
  });

  test("starts in full mode with all credentials", async () => {
    // Mock fetch for heartbeat
    globalThis.fetch = (async () => new Response("{}")) as typeof fetch;

    const runtime = {
      getSetting: (key: string) => {
        const map: Record<string, string> = {
          CLOB_API_KEY: "test-key",
          CLOB_API_SECRET: "dGVzdC1zZWNyZXQ=",
          CLOB_API_PASSPHRASE: "test-pass",
          CLOB_API_URL: "https://clob.polymarket.com",
          EVM_PRIVATE_KEY: "0x0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef",
        };
        return map[key];
      },
    };

    const svc = await PolymarketExtService.start(runtime);
    expect(svc.isFullyActive()).toBe(true);
    expect(svc.clob).not.toBeNull();
    expect(svc.data).toBeDefined();
    expect(svc.walletAddress).toBeDefined();
    expect(svc.walletAddress.length).toBeGreaterThan(0);
    svc.stop();
  });

  test("starts in degraded mode without CLOB credentials", async () => {
    const runtime = {
      getSetting: (key: string) => {
        const map: Record<string, string> = {
          EVM_PRIVATE_KEY: "0x0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef",
        };
        return map[key];
      },
    };

    const svc = await PolymarketExtService.start(runtime);
    expect(svc.isFullyActive()).toBe(false);
    expect(svc.clob).toBeNull();
    expect(svc.data).toBeDefined();
    expect(svc.walletAddress.length).toBeGreaterThan(0);
    svc.stop();
  });

  test("starts in disabled mode without EVM_PRIVATE_KEY", async () => {
    const runtime = {
      getSetting: (_key: string) => undefined,
    };

    const svc = await PolymarketExtService.start(runtime);
    expect(svc.isFullyActive()).toBe(false);
    expect(svc.walletAddress).toBe("");
    svc.stop();
  });

  test("stop() clears heartbeat interval", async () => {
    globalThis.fetch = (async () => new Response("{}")) as typeof fetch;

    const runtime = {
      getSetting: (key: string) => {
        const map: Record<string, string> = {
          CLOB_API_KEY: "test-key",
          CLOB_API_SECRET: "dGVzdC1zZWNyZXQ=",
          CLOB_API_PASSPHRASE: "test-pass",
          EVM_PRIVATE_KEY: "0x0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef",
        };
        return map[key];
      },
    };

    const svc = await PolymarketExtService.start(runtime);
    expect(svc.isFullyActive()).toBe(true);
    svc.stop();
    // After stop, calling stop again should be safe (no-op)
    svc.stop();
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `bun test plugins/polymarket-ext/__tests__/service.test.ts`
Expected: FAIL — module `../service` does not exist

- [ ] **Step 3: Write the implementation**

Create `plugins/polymarket-ext/service.ts`:

```typescript
import { ethers } from "ethers";
import { ClobApiClient } from "./clob-client";
import { DataApiClient } from "./data-client";
import { POLYMARKET_EXT_SERVICE_TYPE } from "./types";

const DEFAULT_CLOB_URL = "https://clob.polymarket.com";
const DEFAULT_DATA_URL = "https://data-api.polymarket.com";
const HEARTBEAT_INTERVAL_MS = 60_000;

type Runtime = { getSetting: (key: string) => string | undefined };

export class PolymarketExtService {
  static serviceType = POLYMARKET_EXT_SERVICE_TYPE;
  serviceType = POLYMARKET_EXT_SERVICE_TYPE;

  readonly clob: ClobApiClient | null;
  readonly data: DataApiClient;
  readonly walletAddress: string;
  private heartbeatTimer: ReturnType<typeof setInterval> | null = null;

  private constructor(
    clob: ClobApiClient | null,
    data: DataApiClient,
    walletAddress: string,
  ) {
    this.clob = clob;
    this.data = data;
    this.walletAddress = walletAddress;
  }

  static async start(runtime: Runtime): Promise<PolymarketExtService> {
    const privateKey = runtime.getSetting("EVM_PRIVATE_KEY")
      ?? runtime.getSetting("POLYMARKET_PRIVATE_KEY")
      ?? process.env.EVM_PRIVATE_KEY?.trim();

    if (!privateKey) {
      console.log("polymarket-ext: disabled (no EVM_PRIVATE_KEY)");
      const data = new DataApiClient(DEFAULT_DATA_URL);
      return new PolymarketExtService(null, data, "");
    }

    const walletAddress = ethers.computeAddress(privateKey);
    const data = new DataApiClient(DEFAULT_DATA_URL);

    const apiKey = runtime.getSetting("CLOB_API_KEY") ?? process.env.CLOB_API_KEY?.trim();
    const secret = runtime.getSetting("CLOB_API_SECRET") ?? process.env.CLOB_API_SECRET?.trim();
    const passphrase = runtime.getSetting("CLOB_API_PASSPHRASE") ?? process.env.CLOB_API_PASSPHRASE?.trim();
    const clobUrl = runtime.getSetting("CLOB_API_URL") ?? process.env.CLOB_API_URL?.trim() ?? DEFAULT_CLOB_URL;

    if (!apiKey || !secret || !passphrase) {
      console.log(`polymarket-ext: data-only mode (CLOB credentials missing) | wallet: ${walletAddress}`);
      return new PolymarketExtService(null, data, walletAddress);
    }

    const clob = new ClobApiClient({
      baseUrl: clobUrl,
      apiKey,
      secret,
      passphrase,
      address: walletAddress,
    });

    const svc = new PolymarketExtService(clob, data, walletAddress);

    svc.heartbeatTimer = setInterval(() => {
      clob.heartbeat().catch((err) => {
        const msg = err instanceof Error ? err.message : String(err);
        console.warn(`polymarket-ext: heartbeat failed: ${msg}`);
      });
    }, HEARTBEAT_INTERVAL_MS);

    console.log(`polymarket-ext: active | wallet: ${walletAddress}`);
    return svc;
  }

  isFullyActive(): boolean {
    return this.clob !== null;
  }

  stop(): void {
    if (this.heartbeatTimer !== null) {
      clearInterval(this.heartbeatTimer);
      this.heartbeatTimer = null;
    }
  }
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `bun test plugins/polymarket-ext/__tests__/service.test.ts`
Expected: All 5 tests PASS

- [ ] **Step 5: Commit**

```bash
git add plugins/polymarket-ext/service.ts plugins/polymarket-ext/__tests__/service.test.ts
git commit -m "feat(polymarket-ext): add service with heartbeat loop"
```

---

### Task 5: Actions (P0 — Cancel Order, Cancel All, Open Orders)

**Files:**
- Create: `plugins/polymarket-ext/actions.ts`
- Create: `plugins/polymarket-ext/__tests__/actions.test.ts`

- [ ] **Step 1: Write the failing tests for P0 actions**

Create `plugins/polymarket-ext/__tests__/actions.test.ts`:

```typescript
import { describe, expect, test } from "bun:test";
import {
  cancelPolymarketOrder,
  cancelAllPolymarketOrders,
  getPolymarketOpenOrders,
} from "../actions";
import { POLYMARKET_EXT_SERVICE_TYPE } from "../types";

function mockRuntime(svc: unknown) {
  return {
    getService: (name: string) => (name === POLYMARKET_EXT_SERVICE_TYPE ? svc : undefined),
  } as Parameters<typeof cancelPolymarketOrder.handler>[0];
}

function mockMessage(text: string) {
  return { content: { text } } as Parameters<typeof cancelPolymarketOrder.handler>[1];
}

function collectCallback(): { calls: string[]; fn: (response: { text: string }) => void } {
  const calls: string[] = [];
  return { calls, fn: (response: { text: string }) => calls.push(response.text) };
}

describe("CANCEL_POLYMARKET_ORDER", () => {
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

describe("CANCEL_ALL_POLYMARKET_ORDERS", () => {
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

describe("GET_POLYMARKET_OPEN_ORDERS", () => {
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
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `bun test plugins/polymarket-ext/__tests__/actions.test.ts`
Expected: FAIL — module `../actions` does not exist

- [ ] **Step 3: Write the P0 actions implementation**

Create `plugins/polymarket-ext/actions.ts`:

```typescript
import type { Action, ActionExample } from "@elizaos/core";
import { PolymarketExtService } from "./service";
import { POLYMARKET_EXT_SERVICE_TYPE, type OpenOrder } from "./types";

function getService(runtime: { getService: (name: string) => unknown }): PolymarketExtService {
  const svc = runtime.getService(POLYMARKET_EXT_SERVICE_TYPE) as PolymarketExtService | undefined;
  if (!svc) throw new Error("PolymarketExtService not initialized.");
  return svc;
}

function getMessageText(message: { content: string | { text?: string } }): string {
  return typeof message.content === "string" ? message.content : message.content?.text ?? "";
}

function requireClob(svc: PolymarketExtService, callback?: (r: { text: string }) => void): boolean {
  if (svc.isFullyActive()) return true;
  if (callback) callback({ text: "CLOB credentials not configured. Run settings to add API keys." });
  return false;
}

function shortenId(id: string): string {
  if (id.length <= 12) return id;
  return `${id.slice(0, 6)}...${id.slice(-4)}`;
}

function formatOrder(order: OpenOrder): string {
  const filled = `${order.size_matched}/${order.original_size}`;
  return `${shortenId(order.id)} | ${order.side} @ ${order.price} | ${filled} filled | ${order.order_type}`;
}

// --- P0: Cancel Order ---

export const cancelPolymarketOrder: Action = {
  name: "CANCEL_POLYMARKET_ORDER",
  description: "Cancel a specific open Polymarket order by ID.",
  similes: ["cancel order", "remove order", "withdraw order"],
  examples: [
    [
      { name: "user", content: { text: "Cancel order abc-123-def" } },
      { name: "assistant", content: { text: "Cancelling order abc-123-def..." } },
    ],
  ] as ActionExample[][],
  validate: async (runtime) => runtime.getService(POLYMARKET_EXT_SERVICE_TYPE) !== undefined,
  handler: async (runtime, message, _state, _options, callback) => {
    const svc = getService(runtime);
    if (!requireClob(svc, callback)) return false;

    const text = getMessageText(message);
    const match = /([a-fA-F0-9-]{8,})/.exec(text);
    if (!match) {
      if (callback) callback({ text: "Missing order ID. Specify: cancel order <id>" });
      return false;
    }

    const orderId = match[1]!;
    try {
      const result = await svc.clob!.cancelOrder(orderId);
      if (callback) callback({ text: `Cancelled order ${result.canceled}` });
      return true;
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      if (callback) callback({ text: `Failed to cancel order: ${msg}` });
      return false;
    }
  },
};

// --- P0: Cancel All Orders ---

export const cancelAllPolymarketOrders: Action = {
  name: "CANCEL_ALL_POLYMARKET_ORDERS",
  description: "Cancel all open Polymarket orders, or all orders for a specific market.",
  similes: ["cancel all orders", "cancel everything", "clear all orders"],
  examples: [
    [
      { name: "user", content: { text: "Cancel all my orders" } },
      { name: "assistant", content: { text: "Cancelling all open orders..." } },
    ],
  ] as ActionExample[][],
  validate: async (runtime) => runtime.getService(POLYMARKET_EXT_SERVICE_TYPE) !== undefined,
  handler: async (runtime, message, _state, _options, callback) => {
    const svc = getService(runtime);
    if (!requireClob(svc, callback)) return false;

    try {
      const result = await svc.clob!.cancelAll();
      const count = result.canceled.length;
      if (count === 0) {
        if (callback) callback({ text: "No open orders to cancel." });
      } else {
        if (callback) callback({ text: `Cancelled ${count} orders: ${result.canceled.map(shortenId).join(", ")}` });
      }
      return true;
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      if (callback) callback({ text: `Failed to cancel orders: ${msg}` });
      return false;
    }
  },
};

// --- P0: Get Open Orders ---

export const getPolymarketOpenOrders: Action = {
  name: "GET_POLYMARKET_OPEN_ORDERS",
  description: "List all open Polymarket orders with status details.",
  similes: ["show orders", "my open orders", "list orders", "pending orders"],
  examples: [
    [
      { name: "user", content: { text: "Show my open orders" } },
      { name: "assistant", content: { text: "Fetching open orders..." } },
    ],
  ] as ActionExample[][],
  validate: async (runtime) => runtime.getService(POLYMARKET_EXT_SERVICE_TYPE) !== undefined,
  handler: async (runtime, message, _state, _options, callback) => {
    const svc = getService(runtime);
    if (!requireClob(svc, callback)) return false;

    try {
      const orders = await svc.clob!.getOpenOrders();
      if (orders.length === 0) {
        if (callback) callback({ text: "No open orders." });
        return true;
      }
      const lines = orders.map(formatOrder);
      if (callback) callback({ text: `Open orders (${orders.length}):\n${lines.join("\n")}` });
      return true;
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      if (callback) callback({ text: `Failed to fetch orders: ${msg}` });
      return false;
    }
  },
};
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `bun test plugins/polymarket-ext/__tests__/actions.test.ts`
Expected: All 7 tests PASS

- [ ] **Step 5: Commit**

```bash
git add plugins/polymarket-ext/actions.ts plugins/polymarket-ext/__tests__/actions.test.ts
git commit -m "feat(polymarket-ext): add P0 actions — cancel order, cancel all, open orders"
```

---

### Task 6: Actions (P1 — Sell Position)

**Files:**
- Modify: `plugins/polymarket-ext/actions.ts`
- Modify: `plugins/polymarket-ext/__tests__/actions.test.ts`

- [ ] **Step 1: Add failing tests for sell action**

Append to `plugins/polymarket-ext/__tests__/actions.test.ts`:

```typescript
import { sellPolymarketPosition } from "../actions";

describe("SELL_POLYMARKET_POSITION", () => {
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
      sellOrder: async (params: { tokenId: string; price: number; size: number }) => ({
        orderID: "sell-order-1",
        status: "matched",
        transactionsHashes: ["0xtx1"],
      }),
      isFullyActive: () => true,
    };
    await sellPolymarketPosition.handler(
      mockRuntime(svc),
      mockMessage("sell 50 YES shares of token token-abc at $0.60"),
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
```

- [ ] **Step 2: Run tests to verify the new tests fail**

Run: `bun test plugins/polymarket-ext/__tests__/actions.test.ts`
Expected: Import `sellPolymarketPosition` fails — not yet exported

- [ ] **Step 3: Add sell action to actions.ts**

Append to `plugins/polymarket-ext/actions.ts`:

```typescript
// --- P1: Sell Position ---

export const sellPolymarketPosition: Action = {
  name: "SELL_POLYMARKET_POSITION",
  description: "Sell shares to exit a Polymarket position. Specify token ID and number of shares. Uses best bid price if no price given.",
  similes: ["sell position", "exit position", "close position", "sell shares"],
  examples: [
    [
      { name: "user", content: { text: "Sell 50 shares of token token-abc at $0.60" } },
      { name: "assistant", content: { text: "Selling 50 shares..." } },
    ],
  ] as ActionExample[][],
  validate: async (runtime) => runtime.getService(POLYMARKET_EXT_SERVICE_TYPE) !== undefined,
  handler: async (runtime, message, _state, _options, callback) => {
    const svc = getService(runtime);
    if (!requireClob(svc, callback)) return false;

    const text = getMessageText(message);

    const tokenMatch = /token[:\s]+([a-zA-Z0-9_-]+)/i.exec(text);
    if (!tokenMatch) {
      if (callback) callback({ text: "Missing token ID. Specify: sell <N> shares of token <tokenId>" });
      return false;
    }
    const tokenId = tokenMatch[1]!;

    const sharesMatch = /(\d+(?:\.\d+)?)\s*shares/i.exec(text);
    if (!sharesMatch) {
      if (callback) callback({ text: "Missing share count. Specify: sell <N> shares of token <tokenId>" });
      return false;
    }
    const shares = parseFloat(sharesMatch[1]!);

    const priceMatch = /\$(\d+(?:\.\d+)?)/i.exec(text);
    let price: number;

    if (priceMatch) {
      price = parseFloat(priceMatch[1]!);
    } else {
      try {
        const book = await svc.clob!.getOrderBook(tokenId);
        if (book.bids.length === 0) {
          if (callback) callback({ text: "No bids in order book. Cannot determine sell price." });
          return false;
        }
        price = parseFloat(book.bids[0]!.price);
      } catch (error) {
        const msg = error instanceof Error ? error.message : String(error);
        if (callback) callback({ text: `Failed to fetch order book: ${msg}` });
        return false;
      }
    }

    try {
      if (callback) callback({ text: `Selling ${shares} shares of ${shortenId(tokenId)} at $${price.toFixed(2)}...` });
      const result = await svc.sellOrder({ tokenId, price, size: shares });
      const txInfo = result.transactionsHashes.length > 0
        ? ` | tx: ${shortenId(result.transactionsHashes[0]!)}`
        : "";
      if (callback) callback({ text: `Sell order ${result.orderID} — ${result.status}${txInfo}` });
      return true;
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      if (callback) callback({ text: `Failed to sell: ${msg}` });
      return false;
    }
  },
};
```

**Also add the `sellOrder` method to the service** — append to `plugins/polymarket-ext/service.ts`:

```typescript
  async sellOrder(params: { tokenId: string; price: number; size: number }): Promise<{
    orderID: string;
    status: string;
    transactionsHashes: string[];
  }> {
    if (!this.clob) throw new Error("CLOB client not initialized.");

    // Use @polymarket/clob-client for order signing
    const { ClobClient } = await import("@polymarket/clob-client");
    const { Wallet } = await import("@ethersproject/wallet");

    const privateKey = this._privateKey;
    if (!privateKey) throw new Error("Private key not available for order signing.");

    const signer = new Wallet(privateKey);
    const chainId = 137; // Polygon
    const client = new ClobClient(this.clob["config"].baseUrl, chainId, signer, {
      key: this.clob["config"].apiKey,
      secret: this.clob["config"].secret,
      passphrase: this.clob["config"].passphrase,
    });

    const order = await client.createAndPostOrder({
      tokenID: params.tokenId,
      price: params.price,
      side: "SELL" as any,
      size: params.size,
      feeRateBps: 0,
      nonce: 0,
    });

    return {
      orderID: order.orderID ?? order.id ?? "unknown",
      status: order.status ?? "submitted",
      transactionsHashes: order.transactionsHashes ?? [],
    };
  }
```

**Important:** Store `_privateKey` in the service constructor. Update the constructor and `start()` in service.ts:

Add `private readonly _privateKey: string | null;` to the class, and pass it through constructor and `start()`.

- [ ] **Step 4: Run tests to verify they pass**

Run: `bun test plugins/polymarket-ext/__tests__/actions.test.ts`
Expected: All 11 tests PASS (7 from Task 5 + 4 new)

- [ ] **Step 5: Commit**

```bash
git add plugins/polymarket-ext/actions.ts plugins/polymarket-ext/service.ts plugins/polymarket-ext/__tests__/actions.test.ts
git commit -m "feat(polymarket-ext): add P1 sell position action"
```

---

### Task 7: Actions (P2 — Positions, Trades + P3 — PnL)

**Files:**
- Modify: `plugins/polymarket-ext/actions.ts`
- Modify: `plugins/polymarket-ext/__tests__/actions.test.ts`

- [ ] **Step 1: Add failing tests for P2+P3 actions**

Append to `plugins/polymarket-ext/__tests__/actions.test.ts`:

```typescript
import {
  getPolymarketPositions,
  getPolymarketTrades,
  getPolymarketPnl,
} from "../actions";

describe("GET_POLYMARKET_POSITIONS", () => {
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

describe("GET_POLYMARKET_TRADES", () => {
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

describe("GET_POLYMARKET_PNL", () => {
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
```

- [ ] **Step 2: Run tests to verify the new tests fail**

Run: `bun test plugins/polymarket-ext/__tests__/actions.test.ts`
Expected: Import errors for new action names

- [ ] **Step 3: Add P2+P3 actions to actions.ts**

Append to `plugins/polymarket-ext/actions.ts`:

```typescript
// --- P2: Get Positions ---

export const getPolymarketPositions: Action = {
  name: "GET_POLYMARKET_POSITIONS",
  description: "Show current Polymarket portfolio positions with live pricing and unrealized PnL.",
  similes: ["my positions", "portfolio", "show holdings", "what do I own"],
  examples: [
    [
      { name: "user", content: { text: "Show my Polymarket positions" } },
      { name: "assistant", content: { text: "Fetching positions..." } },
    ],
  ] as ActionExample[][],
  validate: async (runtime) => runtime.getService(POLYMARKET_EXT_SERVICE_TYPE) !== undefined,
  handler: async (runtime, _message, _state, _options, callback) => {
    const svc = getService(runtime);
    if (!svc.walletAddress) {
      if (callback) callback({ text: "No wallet configured. Set EVM_PRIVATE_KEY." });
      return false;
    }

    try {
      const positions = await svc.data.getPositions(svc.walletAddress);
      if (positions.length === 0) {
        if (callback) callback({ text: "No open positions." });
        return true;
      }
      const lines = positions.map((pos) => {
        const unrealized = (pos.cur_price - pos.avg_price) * pos.size;
        const pnlPct = pos.avg_price > 0 ? ((pos.cur_price - pos.avg_price) / pos.avg_price * 100).toFixed(1) : "0.0";
        const sign = unrealized >= 0 ? "+" : "";
        return `${pos.title} | ${pos.outcome} | ${pos.size} shares @ $${pos.avg_price.toFixed(2)} → $${pos.cur_price.toFixed(2)} | ${sign}$${unrealized.toFixed(2)} (${sign}${pnlPct}%)`;
      });
      if (callback) callback({ text: `Positions (${positions.length}):\n${lines.join("\n")}` });
      return true;
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      if (callback) callback({ text: `Failed to fetch positions: ${msg}` });
      return false;
    }
  },
};

// --- P2: Get Trades ---

export const getPolymarketTrades: Action = {
  name: "GET_POLYMARKET_TRADES",
  description: "Show recent Polymarket trade history.",
  similes: ["trade history", "recent trades", "my trades", "show fills"],
  examples: [
    [
      { name: "user", content: { text: "Show my recent trades" } },
      { name: "assistant", content: { text: "Fetching trade history..." } },
    ],
  ] as ActionExample[][],
  validate: async (runtime) => runtime.getService(POLYMARKET_EXT_SERVICE_TYPE) !== undefined,
  handler: async (runtime, message, _state, _options, callback) => {
    const svc = getService(runtime);
    if (!svc.walletAddress) {
      if (callback) callback({ text: "No wallet configured. Set EVM_PRIVATE_KEY." });
      return false;
    }

    const text = getMessageText(message);
    const limitMatch = /(\d+)\s*trades/i.exec(text);
    const limit = limitMatch ? parseInt(limitMatch[1]!, 10) : 20;

    try {
      const trades = await svc.data.getTrades(svc.walletAddress, { limit });
      if (trades.length === 0) {
        if (callback) callback({ text: "No trades found." });
        return true;
      }
      const lines = trades.map((t) => {
        return `${t.side} ${t.outcome} | ${t.title} | ${t.size} @ $${t.price.toFixed(2)} | ${t.timestamp} | tx: ${shortenId(t.transaction_hash)}`;
      });
      if (callback) callback({ text: `Recent trades (${trades.length}):\n${lines.join("\n")}` });
      return true;
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      if (callback) callback({ text: `Failed to fetch trades: ${msg}` });
      return false;
    }
  },
};

// --- P3: Get PnL ---

export const getPolymarketPnl: Action = {
  name: "GET_POLYMARKET_PNL",
  description: "Show Polymarket profit/loss summary including realized PnL, unrealized PnL, and volume.",
  similes: ["my pnl", "profit and loss", "how am I doing", "performance", "earnings"],
  examples: [
    [
      { name: "user", content: { text: "Show my PnL" } },
      { name: "assistant", content: { text: "Fetching PnL summary..." } },
    ],
  ] as ActionExample[][],
  validate: async (runtime) => runtime.getService(POLYMARKET_EXT_SERVICE_TYPE) !== undefined,
  handler: async (runtime, _message, _state, _options, callback) => {
    const svc = getService(runtime);
    if (!svc.walletAddress) {
      if (callback) callback({ text: "No wallet configured. Set EVM_PRIVATE_KEY." });
      return false;
    }

    try {
      const pnl = await svc.data.getPnl(svc.walletAddress);
      const lines = [
        `Realized PnL:   $${pnl.total_realized.toFixed(2)}`,
        `Unrealized PnL: $${pnl.total_unrealized.toFixed(2)}`,
        `Total Volume:   $${pnl.total_volume.toFixed(2)}`,
      ];
      if (pnl.positions_won !== undefined && pnl.positions_lost !== undefined) {
        lines.push(`Win/Loss:       ${pnl.positions_won}W / ${pnl.positions_lost}L`);
      }
      if (callback) callback({ text: lines.join("\n") });
      return true;
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      if (callback) callback({ text: `Failed to fetch PnL: ${msg}` });
      return false;
    }
  },
};
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `bun test plugins/polymarket-ext/__tests__/actions.test.ts`
Expected: All 17 tests PASS (7 + 4 + 6 new)

- [ ] **Step 5: Commit**

```bash
git add plugins/polymarket-ext/actions.ts plugins/polymarket-ext/__tests__/actions.test.ts
git commit -m "feat(polymarket-ext): add P2 positions/trades + P3 PnL actions"
```

---

### Task 8: Plugin Export + Runner Integration

**Files:**
- Create: `plugins/polymarket-ext/index.ts`
- Modify: `runner.ts` (line ~489)

- [ ] **Step 1: Create plugin index**

Create `plugins/polymarket-ext/index.ts`:

```typescript
import type { Plugin } from "@elizaos/core";
import {
  cancelPolymarketOrder,
  cancelAllPolymarketOrders,
  getPolymarketOpenOrders,
  sellPolymarketPosition,
  getPolymarketPositions,
  getPolymarketTrades,
  getPolymarketPnl,
} from "./actions";
import { PolymarketExtService } from "./service";

export const polymarketExtPlugin: Plugin = {
  name: "polymarket-ext",
  description: "Extended Polymarket operations — cancel orders, positions, trades, PnL, and heartbeat",
  actions: [
    cancelPolymarketOrder,
    cancelAllPolymarketOrders,
    getPolymarketOpenOrders,
    sellPolymarketPosition,
    getPolymarketPositions,
    getPolymarketTrades,
    getPolymarketPnl,
  ],
  providers: [],
  services: [PolymarketExtService as unknown as Plugin["services"] extends (infer T)[] ? T : never],
};

export default polymarketExtPlugin;
```

- [ ] **Step 2: Add import and plugin to runner.ts**

Add import at top of `runner.ts` (after the x402 import):

```typescript
import { polymarketExtPlugin } from "./plugins/polymarket-ext/index";
```

Update the plugins array in `createRuntimeSession()` (around line 489):

```typescript
plugins: [sqlPlugin, polymarketPlugin, polymarketExtPlugin, jupiterPredictionPlugin, x402SolanaPlugin, ...llmPlugins],
```

- [ ] **Step 3: Run all tests to verify nothing breaks**

Run: `bun test`
Expected: All existing tests still PASS, plus all new polymarket-ext tests PASS

- [ ] **Step 4: Commit**

```bash
git add plugins/polymarket-ext/index.ts runner.ts
git commit -m "feat(polymarket-ext): wire plugin into runtime"
```

---

### Task 9: Final Verification

- [ ] **Step 1: Run the full test suite**

Run: `bun test`
Expected: All tests PASS (existing 65 + new polymarket-ext tests)

- [ ] **Step 2: Type check**

Run: `bunx tsc --noEmit --skipLibCheck`
Expected: No new errors introduced (pre-existing errors are acceptable)

- [ ] **Step 3: Verify file structure**

Run: `find plugins/polymarket-ext -type f | sort`
Expected:
```
plugins/polymarket-ext/__tests__/actions.test.ts
plugins/polymarket-ext/__tests__/clob-client.test.ts
plugins/polymarket-ext/__tests__/data-client.test.ts
plugins/polymarket-ext/__tests__/service.test.ts
plugins/polymarket-ext/__tests__/types.test.ts
plugins/polymarket-ext/actions.ts
plugins/polymarket-ext/clob-client.ts
plugins/polymarket-ext/data-client.ts
plugins/polymarket-ext/index.ts
plugins/polymarket-ext/service.ts
plugins/polymarket-ext/types.ts
```

- [ ] **Step 4: Final commit if any fixes were needed**

```bash
git add -A plugins/polymarket-ext/
git commit -m "chore(polymarket-ext): final cleanup and verification"
```
