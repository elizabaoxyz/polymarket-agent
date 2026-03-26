# Jupiter Prediction Plugin Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build an elizaOS plugin that enables autonomous trading on Jupiter Prediction Markets (Solana), with full TUI integration via a new `jupiter-demo.ts` entry point.

**Architecture:** Local plugin at `plugins/jupiter-prediction/` wraps the Jupiter Prediction REST API (`api.jup.ag/prediction/v1`). Uses `@elizaos/plugin-solana` for wallet/signing. A new `jupiter-demo.ts` entry point mirrors `polymarket-demo.ts` but loads the Jupiter plugin instead. The existing TUI in `tui.tsx` is minimally refactored to accept a `venue` field for branding.

**Tech Stack:** TypeScript, elizaOS v2 (`@elizaos/core@2.0.0-alpha.108`), `@elizaos/plugin-solana`, `@solana/web3.js`, Bun runtime, Ink/React TUI, Zod validation.

**Spec:** `docs/superpowers/specs/2026-03-27-jupiter-prediction-plugin-design.md`

---

## File Map

### New Files

| File | Responsibility |
|------|---------------|
| `plugins/jupiter-prediction/types.ts` | Zod schemas and TypeScript types for Jupiter API responses |
| `plugins/jupiter-prediction/api.ts` | Typed HTTP client wrapping `api.jup.ag/prediction/v1` |
| `plugins/jupiter-prediction/scanner.ts` | Pure functions: filter markets by liquidity/spread, score opportunities |
| `plugins/jupiter-prediction/service.ts` | `JupiterPredictionService` — holds API client, wallet pubkey, RPC connection |
| `plugins/jupiter-prediction/actions.ts` | elizaOS actions: scan, bet, positions, claim |
| `plugins/jupiter-prediction/index.ts` | Plugin export: wires service + actions into elizaOS |
| `plugins/jupiter-prediction/__tests__/types.test.ts` | Zod schema validation tests |
| `plugins/jupiter-prediction/__tests__/api.test.ts` | API client tests with mocked HTTP |
| `plugins/jupiter-prediction/__tests__/scanner.test.ts` | Scanner filtering and scoring tests |
| `jupiter-runner.ts` | Jupiter runtime session, character, verify/chat exports |
| `jupiter-demo.ts` | Entry point: dotenv, CLI, dispatches to jupiter-runner |
| `jupiter.test.ts` | Integration smoke test for module exports |

### Modified Files

| File | Change |
|------|--------|
| `tui.tsx:97` | Add `venue` field to `TuiSession` type |
| `tui.tsx:1929` | Status bar branding based on `venue` |
| `tui.tsx:1984` | Rename export + add `runTradingTui` alias |
| `package.json` | Add deps (`@elizaos/plugin-solana@alpha`) and `"jupiter"` script |

---

## Task 1: Install dependencies and add script

**Files:**
- Modify: `package.json`

- [ ] **Step 1: Install @elizaos/plugin-solana**

```bash
bun add @elizaos/plugin-solana@alpha
```

Expected: `@elizaos/plugin-solana@2.0.0-alpha.5` installed. This brings `@solana/web3.js@^1.98.4` as a transitive dependency.

- [ ] **Step 2: Add jupiter script to package.json**

In `package.json`, add to `"scripts"`:

```json
"jupiter": "bun run jupiter-demo.ts"
```

- [ ] **Step 3: Verify install**

```bash
bun install
```

Expected: Clean install, no errors.

- [ ] **Step 4: Commit**

```bash
git add package.json bun.lock
git commit -m "feat: add plugin-solana dep and jupiter script"
```

---

## Task 2: Types — Zod schemas for Jupiter Prediction API

**Files:**
- Create: `plugins/jupiter-prediction/types.ts`
- Test: `plugins/jupiter-prediction/__tests__/types.test.ts`

- [ ] **Step 1: Write the failing test**

Create `plugins/jupiter-prediction/__tests__/types.test.ts`:

```typescript
import { describe, expect, test } from "bun:test";
import {
  EventSchema,
  MarketSchema,
  OrderbookSchema,
  PlaceOrderResponseSchema,
  OrderStatusSchema,
  PositionSchema,
  TradingStatusSchema,
  microUsdToDollars,
  dollarsToMicroUsd,
} from "../types";

describe("microUsdToDollars", () => {
  test("converts 1_000_000 to 1.00", () => {
    expect(microUsdToDollars(1_000_000)).toBe(1.0);
  });

  test("converts 500_000 to 0.50", () => {
    expect(microUsdToDollars(500_000)).toBe(0.5);
  });

  test("converts 0 to 0", () => {
    expect(microUsdToDollars(0)).toBe(0);
  });
});

describe("dollarsToMicroUsd", () => {
  test("converts 5.00 to 5_000_000", () => {
    expect(dollarsToMicroUsd(5.0)).toBe(5_000_000);
  });

  test("converts 0.01 to 10_000", () => {
    expect(dollarsToMicroUsd(0.01)).toBe(10_000);
  });
});

describe("EventSchema", () => {
  test("parses a valid event", () => {
    const raw = {
      id: "event-123",
      title: "Will BTC reach $200k?",
      category: "crypto",
      status: "live",
      markets: [
        {
          id: "market-abc",
          question: "BTC above $200k by Dec 2026",
          yesPrice: 350_000,
          noPrice: 650_000,
          status: "active",
          expiresAt: "2026-12-31T00:00:00Z",
        },
      ],
    };
    const parsed = EventSchema.parse(raw);
    expect(parsed.id).toBe("event-123");
    expect(parsed.markets[0]!.yesPrice).toBe(350_000);
  });

  test("rejects event with missing title", () => {
    expect(() =>
      EventSchema.parse({ id: "x", category: "crypto", status: "live", markets: [] })
    ).toThrow();
  });
});

describe("MarketSchema", () => {
  test("parses a valid market", () => {
    const raw = {
      id: "market-abc",
      question: "BTC above $200k by Dec 2026",
      yesPrice: 350_000,
      noPrice: 650_000,
      status: "active",
      expiresAt: "2026-12-31T00:00:00Z",
    };
    const parsed = MarketSchema.parse(raw);
    expect(parsed.status).toBe("active");
  });
});

describe("OrderbookSchema", () => {
  test("parses bid/ask arrays", () => {
    const raw = {
      bids: [[0.45, 100], [0.44, 200]],
      asks: [[0.55, 150], [0.56, 250]],
    };
    const parsed = OrderbookSchema.parse(raw);
    expect(parsed.bids).toHaveLength(2);
    expect(parsed.asks[0]![0]).toBe(0.55);
  });
});

describe("PlaceOrderResponseSchema", () => {
  test("parses unsigned transaction response", () => {
    const raw = {
      transaction: "base64encodedtx==",
      orderPubkey: "order123pubkey",
    };
    const parsed = PlaceOrderResponseSchema.parse(raw);
    expect(parsed.transaction).toBe("base64encodedtx==");
    expect(parsed.orderPubkey).toBe("order123pubkey");
  });
});

describe("OrderStatusSchema", () => {
  test("parses filled status", () => {
    const raw = { status: "filled", orderPubkey: "abc" };
    const parsed = OrderStatusSchema.parse(raw);
    expect(parsed.status).toBe("filled");
  });

  test("accepts pending, filled, failed", () => {
    expect(OrderStatusSchema.parse({ status: "pending", orderPubkey: "a" }).status).toBe("pending");
    expect(OrderStatusSchema.parse({ status: "failed", orderPubkey: "b" }).status).toBe("failed");
  });
});

describe("PositionSchema", () => {
  test("parses position with P&L", () => {
    const raw = {
      positionPubkey: "pos123",
      marketId: "market-abc",
      isYes: true,
      quantity: 10,
      averagePrice: 450_000,
      currentPrice: 600_000,
      status: "open",
    };
    const parsed = PositionSchema.parse(raw);
    expect(parsed.isYes).toBe(true);
    expect(parsed.quantity).toBe(10);
  });
});

describe("TradingStatusSchema", () => {
  test("parses operational status", () => {
    const raw = { operational: true };
    const parsed = TradingStatusSchema.parse(raw);
    expect(parsed.operational).toBe(true);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
bun test plugins/jupiter-prediction/__tests__/types.test.ts
```

Expected: FAIL — module `../types` does not exist.

- [ ] **Step 3: Write the types module**

Create `plugins/jupiter-prediction/types.ts`:

```typescript
import { z } from "zod";

// --- Monetary conversion ---

const MICRO_USD_FACTOR = 1_000_000;

export function microUsdToDollars(microUsd: number): number {
  return microUsd / MICRO_USD_FACTOR;
}

export function dollarsToMicroUsd(dollars: number): number {
  return Math.round(dollars * MICRO_USD_FACTOR);
}

// --- USDC / JupUSD mint addresses ---

export const USDC_MINT = "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v";
export const JUPUSD_MINT = "JuprjznTrTSp2UFa3ZBUFgwdAmtZCq4MQCwysN55USD";

// --- API response schemas ---

export const MarketSchema = z.object({
  id: z.string(),
  question: z.string(),
  yesPrice: z.number(),
  noPrice: z.number(),
  status: z.string(),
  expiresAt: z.string(),
});
export type Market = z.infer<typeof MarketSchema>;

export const EventSchema = z.object({
  id: z.string(),
  title: z.string(),
  category: z.string(),
  status: z.string(),
  markets: z.array(MarketSchema),
});
export type Event = z.infer<typeof EventSchema>;

export const OrderbookEntrySchema = z.tuple([z.number(), z.number()]);

export const OrderbookSchema = z.object({
  bids: z.array(OrderbookEntrySchema),
  asks: z.array(OrderbookEntrySchema),
});
export type Orderbook = z.infer<typeof OrderbookSchema>;

export const PlaceOrderResponseSchema = z.object({
  transaction: z.string(),
  orderPubkey: z.string(),
});
export type PlaceOrderResponse = z.infer<typeof PlaceOrderResponseSchema>;

export const OrderStatusSchema = z.object({
  status: z.enum(["pending", "filled", "failed"]),
  orderPubkey: z.string(),
});
export type OrderStatus = z.infer<typeof OrderStatusSchema>;

export const PositionSchema = z.object({
  positionPubkey: z.string(),
  marketId: z.string(),
  isYes: z.boolean(),
  quantity: z.number(),
  averagePrice: z.number(),
  currentPrice: z.number(),
  status: z.string(),
});
export type Position = z.infer<typeof PositionSchema>;

export const TradingStatusSchema = z.object({
  operational: z.boolean(),
});
export type TradingStatus = z.infer<typeof TradingStatusSchema>;

// --- Place order request ---

export type PlaceOrderParams = {
  readonly ownerPubkey: string;
  readonly marketId: string;
  readonly isYes: boolean;
  readonly isBuy: boolean;
  readonly depositAmount: number; // micro-USD
  readonly depositMint: string;   // USDC or JupUSD mint address
};

// --- Scored opportunity (scanner output) ---

export type ScoredOpportunity = {
  readonly event: Event;
  readonly market: Market;
  readonly orderbook: Orderbook;
  readonly spread: number;
  readonly midpoint: number;
  readonly depthScore: number;
  readonly totalScore: number;
};
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
bun test plugins/jupiter-prediction/__tests__/types.test.ts
```

Expected: All tests PASS.

- [ ] **Step 5: Commit**

```bash
git add plugins/jupiter-prediction/types.ts plugins/jupiter-prediction/__tests__/types.test.ts
git commit -m "feat(jupiter): add Zod schemas and types for Jupiter Prediction API"
```

---

## Task 3: API Client — typed HTTP wrapper

**Files:**
- Create: `plugins/jupiter-prediction/api.ts`
- Test: `plugins/jupiter-prediction/__tests__/api.test.ts`

- [ ] **Step 1: Write the failing test**

Create `plugins/jupiter-prediction/__tests__/api.test.ts`:

```typescript
import { describe, expect, test, mock, beforeEach } from "bun:test";
import { JupiterPredictionClient } from "../api";

// Mock fetch globally for each test
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

    const key = `${method} ${url}`;
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
      {
        id: "e1",
        title: "Test Event",
        category: "crypto",
        status: "live",
        markets: [],
      },
    ]);
    const events = await client.getEvents({ status: "live" });
    expect(events).toHaveLength(1);
    expect(events[0]!.title).toBe("Test Event");
    expect(capturedRequests[0]!.url).toContain("status=live");
  });

  test("getMarket fetches single market", async () => {
    setMock("/markets/m1", {
      id: "m1",
      question: "Will it rain?",
      yesPrice: 600_000,
      noPrice: 400_000,
      status: "active",
      expiresAt: "2026-12-31T00:00:00Z",
    });
    const market = await client.getMarket("m1");
    expect(market.question).toBe("Will it rain?");
  });

  test("getOrderbook fetches bid/ask arrays", async () => {
    setMock("/orderbook/m1", {
      bids: [[0.45, 100]],
      asks: [[0.55, 200]],
    });
    const book = await client.getOrderbook("m1");
    expect(book.bids).toHaveLength(1);
    expect(book.asks[0]![1]).toBe(200);
  });

  test("placeOrder sends POST with body", async () => {
    setMock("/orders", {
      transaction: "dHhkYXRh",
      orderPubkey: "order123",
    });
    const result = await client.placeOrder({
      ownerPubkey: "wallet1",
      marketId: "m1",
      isYes: true,
      isBuy: true,
      depositAmount: 5_000_000,
      depositMint: "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v",
    });
    expect(result.transaction).toBe("dHhkYXRh");
    expect(capturedRequests[0]!.method).toBe("POST");
  });

  test("getPositions fetches with ownerPubkey query", async () => {
    setMock("/positions", [
      {
        positionPubkey: "pos1",
        marketId: "m1",
        isYes: true,
        quantity: 5,
        averagePrice: 400_000,
        currentPrice: 600_000,
        status: "open",
      },
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
```

- [ ] **Step 2: Run test to verify it fails**

```bash
bun test plugins/jupiter-prediction/__tests__/api.test.ts
```

Expected: FAIL — module `../api` does not exist.

- [ ] **Step 3: Write the API client**

Create `plugins/jupiter-prediction/api.ts`:

```typescript
import { z } from "zod";
import {
  EventSchema,
  MarketSchema,
  OrderbookSchema,
  PlaceOrderResponseSchema,
  OrderStatusSchema,
  PositionSchema,
  TradingStatusSchema,
  type Event,
  type Market,
  type Orderbook,
  type PlaceOrderResponse,
  type OrderStatus,
  type Position,
  type TradingStatus,
  type PlaceOrderParams,
} from "./types";

const BASE_URL = "https://api.jup.ag/prediction/v1";

export class JupiterPredictionClient {
  private readonly apiKey: string;
  private readonly baseUrl: string;

  constructor(apiKey: string, baseUrl: string = BASE_URL) {
    this.apiKey = apiKey;
    this.baseUrl = baseUrl;
  }

  private async request<T>(
    path: string,
    schema: z.ZodType<T>,
    options: { method?: string; body?: unknown; query?: Record<string, string> } = {}
  ): Promise<T> {
    const url = new URL(`${this.baseUrl}${path}`);
    if (options.query) {
      for (const [key, value] of Object.entries(options.query)) {
        url.searchParams.set(key, value);
      }
    }

    const headers: Record<string, string> = {
      "x-api-key": this.apiKey,
      "content-type": "application/json",
    };

    const response = await fetch(url.toString(), {
      method: options.method ?? "GET",
      headers,
      ...(options.body ? { body: JSON.stringify(options.body) } : {}),
    });

    if (response.status === 401 || response.status === 403) {
      throw new Error(
        `Jupiter API key error (${response.status}). Verify your JUPITER_API_KEY from portal.jup.ag.`
      );
    }

    if (!response.ok) {
      const text = await response.text().catch(() => "");
      throw new Error(`Jupiter API error ${response.status}: ${text}`);
    }

    const data = await response.json();
    return schema.parse(data);
  }

  async getTradingStatus(): Promise<TradingStatus> {
    return this.request("/trading-status", TradingStatusSchema);
  }

  async getEvents(
    filters: { category?: string; status?: string } = {}
  ): Promise<Event[]> {
    const query: Record<string, string> = {};
    if (filters.category) query.category = filters.category;
    if (filters.status) query.status = filters.status;
    return this.request("/events", z.array(EventSchema), { query });
  }

  async searchEvents(query: string): Promise<Event[]> {
    return this.request("/events/search", z.array(EventSchema), {
      query: { query },
    });
  }

  async getMarket(marketId: string): Promise<Market> {
    return this.request(`/markets/${marketId}`, MarketSchema);
  }

  async getOrderbook(marketId: string): Promise<Orderbook> {
    return this.request(`/orderbook/${marketId}`, OrderbookSchema);
  }

  async placeOrder(params: PlaceOrderParams): Promise<PlaceOrderResponse> {
    return this.request("/orders", PlaceOrderResponseSchema, {
      method: "POST",
      body: params,
    });
  }

  async getOrders(ownerPubkey: string): Promise<unknown[]> {
    return this.request("/orders", z.array(z.unknown()), {
      query: { ownerPubkey },
    });
  }

  async getOrderStatus(orderPubkey: string): Promise<OrderStatus> {
    return this.request(`/orders/status/${orderPubkey}`, OrderStatusSchema);
  }

  async getPositions(ownerPubkey: string): Promise<Position[]> {
    return this.request("/positions", z.array(PositionSchema), {
      query: { ownerPubkey },
    });
  }

  async closePosition(positionPubkey: string): Promise<PlaceOrderResponse> {
    return this.request(`/positions/${positionPubkey}`, PlaceOrderResponseSchema, {
      method: "DELETE",
    });
  }

  async claimPosition(positionPubkey: string): Promise<PlaceOrderResponse> {
    return this.request(`/positions/${positionPubkey}/claim`, PlaceOrderResponseSchema, {
      method: "POST",
    });
  }
}
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
bun test plugins/jupiter-prediction/__tests__/api.test.ts
```

Expected: All tests PASS.

- [ ] **Step 5: Commit**

```bash
git add plugins/jupiter-prediction/api.ts plugins/jupiter-prediction/__tests__/api.test.ts
git commit -m "feat(jupiter): add typed Jupiter Prediction API client"
```

---

## Task 4: Scanner — filter and score opportunities

**Files:**
- Create: `plugins/jupiter-prediction/scanner.ts`
- Test: `plugins/jupiter-prediction/__tests__/scanner.test.ts`

- [ ] **Step 1: Write the failing test**

Create `plugins/jupiter-prediction/__tests__/scanner.test.ts`:

```typescript
import { describe, expect, test } from "bun:test";
import { filterMarkets, scoreOpportunity, scanAndScore } from "../scanner";
import type { Event, Market, Orderbook } from "../types";

function makeMarket(overrides: Partial<Market> = {}): Market {
  return {
    id: "m1",
    question: "Will BTC reach $200k?",
    yesPrice: 450_000,
    noPrice: 550_000,
    status: "active",
    expiresAt: new Date(Date.now() + 86_400_000).toISOString(), // +24h
    ...overrides,
  };
}

function makeOrderbook(bids: number, asks: number): Orderbook {
  return {
    bids: Array.from({ length: bids }, (_, i) => [0.45 - i * 0.01, 100] as [number, number]),
    asks: Array.from({ length: asks }, (_, i) => [0.55 + i * 0.01, 100] as [number, number]),
  };
}

function makeEvent(markets: Market[]): Event {
  return {
    id: "e1",
    title: "Test Event",
    category: "crypto",
    status: "live",
    markets,
  };
}

describe("filterMarkets", () => {
  test("excludes markets with thin bids (< 3)", () => {
    const market = makeMarket();
    const book = makeOrderbook(2, 5); // only 2 bids
    const result = filterMarkets([{ market, orderbook: book }]);
    expect(result).toHaveLength(0);
  });

  test("excludes markets with thin asks (< 3)", () => {
    const market = makeMarket();
    const book = makeOrderbook(5, 1); // only 1 ask
    const result = filterMarkets([{ market, orderbook: book }]);
    expect(result).toHaveLength(0);
  });

  test("excludes markets with spread > 15%", () => {
    const market = makeMarket({ yesPrice: 200_000, noPrice: 900_000 }); // 70% spread
    const book = makeOrderbook(5, 5);
    const result = filterMarkets([{ market, orderbook: book }]);
    expect(result).toHaveLength(0);
  });

  test("excludes markets expiring within 1 hour", () => {
    const market = makeMarket({
      expiresAt: new Date(Date.now() + 30 * 60_000).toISOString(), // +30 min
    });
    const book = makeOrderbook(5, 5);
    const result = filterMarkets([{ market, orderbook: book }]);
    expect(result).toHaveLength(0);
  });

  test("keeps valid markets", () => {
    const market = makeMarket(); // 10% spread, +24h expiry
    const book = makeOrderbook(5, 5);
    const result = filterMarkets([{ market, orderbook: book }]);
    expect(result).toHaveLength(1);
  });
});

describe("scoreOpportunity", () => {
  test("scores higher for tighter spreads", () => {
    const tight = scoreOpportunity(
      makeMarket({ yesPrice: 480_000, noPrice: 520_000 }), // 4% spread
      makeOrderbook(5, 5)
    );
    const wide = scoreOpportunity(
      makeMarket({ yesPrice: 400_000, noPrice: 600_000 }), // 20% spread
      makeOrderbook(5, 5)
    );
    expect(tight.totalScore).toBeGreaterThan(wide.totalScore);
  });

  test("scores higher for midpoints near 0.50", () => {
    const uncertain = scoreOpportunity(
      makeMarket({ yesPrice: 480_000, noPrice: 520_000 }), // midpoint 0.50
      makeOrderbook(5, 5)
    );
    const lopsided = scoreOpportunity(
      makeMarket({ yesPrice: 100_000, noPrice: 900_000 }), // midpoint 0.50 but huge spread
      makeOrderbook(5, 5)
    );
    // Both have midpoint near 0.50, but uncertain has tighter spread
    expect(uncertain.totalScore).toBeGreaterThan(lopsided.totalScore);
  });

  test("scores higher for deeper orderbooks", () => {
    const deep = scoreOpportunity(makeMarket(), makeOrderbook(10, 10));
    const shallow = scoreOpportunity(makeMarket(), makeOrderbook(3, 3));
    expect(deep.depthScore).toBeGreaterThan(shallow.depthScore);
  });
});

describe("scanAndScore", () => {
  test("returns top N opportunities sorted by score", () => {
    const markets = [
      { market: makeMarket({ id: "tight", yesPrice: 490_000, noPrice: 510_000 }), orderbook: makeOrderbook(5, 5) },
      { market: makeMarket({ id: "wide", yesPrice: 300_000, noPrice: 700_000 }), orderbook: makeOrderbook(5, 5) },
      { market: makeMarket({ id: "medium", yesPrice: 450_000, noPrice: 550_000 }), orderbook: makeOrderbook(5, 5) },
    ];
    const results = scanAndScore(markets, 2);
    expect(results).toHaveLength(2);
    expect(results[0]!.totalScore).toBeGreaterThanOrEqual(results[1]!.totalScore);
    expect(results[0]!.market.id).toBe("tight");
  });

  test("filters out invalid markets before scoring", () => {
    const markets = [
      { market: makeMarket({ id: "valid" }), orderbook: makeOrderbook(5, 5) },
      { market: makeMarket({ id: "thin" }), orderbook: makeOrderbook(1, 1) }, // filtered out
    ];
    const results = scanAndScore(markets, 5);
    expect(results).toHaveLength(1);
    expect(results[0]!.market.id).toBe("valid");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
bun test plugins/jupiter-prediction/__tests__/scanner.test.ts
```

Expected: FAIL — module `../scanner` does not exist.

- [ ] **Step 3: Write the scanner**

Create `plugins/jupiter-prediction/scanner.ts`:

```typescript
import type { Market, Orderbook, ScoredOpportunity, Event } from "./types";
import { microUsdToDollars } from "./types";

const MIN_DEPTH = 3;
const MAX_SPREAD = 0.15;
const MIN_TIME_REMAINING_MS = 60 * 60 * 1000; // 1 hour

const SPREAD_WEIGHT = 0.50;
const MIDPOINT_WEIGHT = 0.30;
const DEPTH_WEIGHT = 0.20;

type MarketWithBook = {
  readonly market: Market;
  readonly orderbook: Orderbook;
};

function getSpread(market: Market): number {
  const yes = microUsdToDollars(market.yesPrice);
  const no = microUsdToDollars(market.noPrice);
  return Math.abs(no - yes);
}

function getMidpoint(market: Market): number {
  const yes = microUsdToDollars(market.yesPrice);
  const no = microUsdToDollars(market.noPrice);
  return (yes + no) / 2;
}

function isExpiringSoon(market: Market): boolean {
  const expiresAt = new Date(market.expiresAt).getTime();
  return expiresAt - Date.now() < MIN_TIME_REMAINING_MS;
}

function hasMinDepth(orderbook: Orderbook): boolean {
  return orderbook.bids.length >= MIN_DEPTH && orderbook.asks.length >= MIN_DEPTH;
}

export function filterMarkets(entries: MarketWithBook[]): MarketWithBook[] {
  return entries.filter(({ market, orderbook }) => {
    if (!hasMinDepth(orderbook)) return false;
    if (getSpread(market) > MAX_SPREAD) return false;
    if (isExpiringSoon(market)) return false;
    return true;
  });
}

export function scoreOpportunity(market: Market, orderbook: Orderbook): ScoredOpportunity {
  const spread = getSpread(market);
  const midpoint = getMidpoint(market);
  const totalDepth = orderbook.bids.length + orderbook.asks.length;

  // Spread score: 0 at 15% spread, 1 at 0% spread
  const spreadScore = Math.max(0, 1 - spread / MAX_SPREAD);

  // Midpoint score: 1 at 0.50, 0 at 0.0 or 1.0
  const midpointScore = 1 - Math.abs(midpoint - 0.5) * 2;

  // Depth score: normalize to 0-1, cap at 20 total orders
  const depthScore = Math.min(1, totalDepth / 20);

  const totalScore =
    spreadScore * SPREAD_WEIGHT +
    midpointScore * MIDPOINT_WEIGHT +
    depthScore * DEPTH_WEIGHT;

  return {
    event: { id: "", title: "", category: "", status: "", markets: [] },
    market,
    orderbook,
    spread,
    midpoint,
    depthScore,
    totalScore,
  };
}

export function scanAndScore(
  entries: MarketWithBook[],
  topN: number = 5
): ScoredOpportunity[] {
  const filtered = filterMarkets(entries);
  const scored = filtered.map(({ market, orderbook }) =>
    scoreOpportunity(market, orderbook)
  );
  scored.sort((a, b) => b.totalScore - a.totalScore);
  return scored.slice(0, topN);
}

export function formatOpportunity(opp: ScoredOpportunity): string {
  const yes = microUsdToDollars(opp.market.yesPrice).toFixed(2);
  const no = microUsdToDollars(opp.market.noPrice).toFixed(2);
  return [
    `Market: ${opp.market.question}`,
    `  YES: $${yes} | NO: $${no} | Spread: ${(opp.spread * 100).toFixed(1)}%`,
    `  Midpoint: ${opp.midpoint.toFixed(3)} | Depth: ${opp.orderbook.bids.length}/${opp.orderbook.asks.length}`,
    `  Score: ${opp.totalScore.toFixed(3)}`,
  ].join("\n");
}

export function formatOpportunitySummary(opportunities: ScoredOpportunity[]): string {
  if (opportunities.length === 0) return "No opportunities found matching criteria.";
  const header = `Found ${opportunities.length} opportunities:\n`;
  return header + opportunities.map((opp, i) => `${i + 1}. ${formatOpportunity(opp)}`).join("\n\n");
}
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
bun test plugins/jupiter-prediction/__tests__/scanner.test.ts
```

Expected: All tests PASS.

- [ ] **Step 5: Commit**

```bash
git add plugins/jupiter-prediction/scanner.ts plugins/jupiter-prediction/__tests__/scanner.test.ts
git commit -m "feat(jupiter): add market scanner with filtering and scoring"
```

---

## Task 5: Service — JupiterPredictionService

**Files:**
- Create: `plugins/jupiter-prediction/service.ts`

- [ ] **Step 1: Write the service**

Create `plugins/jupiter-prediction/service.ts`:

```typescript
import { Connection, VersionedTransaction, Keypair } from "@solana/web3.js";
import bs58 from "bs58";
import { JupiterPredictionClient } from "./api";
import type { PlaceOrderResponse, OrderStatus } from "./types";

const DEFAULT_RPC_URL = "https://api.mainnet-beta.solana.com";
const ORDER_POLL_INTERVAL_MS = 2000;
const ORDER_POLL_MAX_ATTEMPTS = 30;

export type JupiterServiceConfig = {
  readonly apiKey: string;
  readonly solanaPrivateKey: string;
  readonly rpcUrl?: string;
};

export class JupiterPredictionService {
  readonly client: JupiterPredictionClient;
  readonly connection: Connection;
  readonly keypair: Keypair;
  readonly ownerPubkey: string;

  constructor(config: JupiterServiceConfig) {
    this.client = new JupiterPredictionClient(config.apiKey);
    this.connection = new Connection(config.rpcUrl ?? DEFAULT_RPC_URL, "confirmed");
    const secretKey = bs58.decode(config.solanaPrivateKey);
    this.keypair = Keypair.fromSecretKey(secretKey);
    this.ownerPubkey = this.keypair.publicKey.toBase58();
  }

  async isReady(): Promise<boolean> {
    try {
      const status = await this.client.getTradingStatus();
      return status.operational;
    } catch {
      return false;
    }
  }

  async signAndSubmit(unsignedTxBase64: string): Promise<string> {
    const txBuffer = Buffer.from(unsignedTxBase64, "base64");
    const tx = VersionedTransaction.deserialize(txBuffer);
    tx.sign([this.keypair]);
    const rawTx = tx.serialize();
    const signature = await this.connection.sendRawTransaction(rawTx, {
      skipPreflight: false,
      preflightCommitment: "confirmed",
    });
    await this.connection.confirmTransaction(signature, "confirmed");
    return signature;
  }

  async placeOrderAndSign(params: Parameters<JupiterPredictionClient["placeOrder"]>[0]): Promise<{
    orderPubkey: string;
    signature: string;
  }> {
    const response = await this.client.placeOrder(params);
    const signature = await this.signAndSubmit(response.transaction);
    return { orderPubkey: response.orderPubkey, signature };
  }

  async waitForFill(orderPubkey: string): Promise<OrderStatus> {
    for (let i = 0; i < ORDER_POLL_MAX_ATTEMPTS; i++) {
      const status = await this.client.getOrderStatus(orderPubkey);
      if (status.status === "filled" || status.status === "failed") {
        return status;
      }
      await new Promise((resolve) => setTimeout(resolve, ORDER_POLL_INTERVAL_MS));
    }
    return { status: "pending", orderPubkey };
  }
}
```

- [ ] **Step 2: Commit**

```bash
git add plugins/jupiter-prediction/service.ts
git commit -m "feat(jupiter): add JupiterPredictionService with tx signing"
```

---

## Task 6: Actions — elizaOS action definitions

**Files:**
- Create: `plugins/jupiter-prediction/actions.ts`

- [ ] **Step 1: Write the actions**

Create `plugins/jupiter-prediction/actions.ts`:

```typescript
import type { Action, ActionExample } from "@elizaos/core";
import { JupiterPredictionService } from "./service";
import { scanAndScore, formatOpportunitySummary } from "./scanner";
import { microUsdToDollars, dollarsToMicroUsd, USDC_MINT } from "./types";
import type { ScoredOpportunity } from "./types";

const SERVICE_KEY = "JUPITER_PREDICTION";

function getService(runtime: { getService: (name: string) => unknown }): JupiterPredictionService {
  const svc = runtime.getService(SERVICE_KEY) as JupiterPredictionService | undefined;
  if (!svc) throw new Error("JupiterPredictionService not initialized.");
  return svc;
}

export const scanJupiterMarkets: Action = {
  name: "SCAN_JUPITER_MARKETS",
  description: "Scan Jupiter Prediction Markets for trading opportunities. Fetches live events, filters by liquidity and spread, and scores the best opportunities.",
  similes: ["scan jupiter", "find jupiter markets", "search predictions", "look for jupiter bets"],
  examples: [
    [
      { name: "user", content: { text: "Scan jupiter prediction markets" } },
      { name: "assistant", content: { text: "Scanning Jupiter Prediction Markets..." } },
    ],
  ] as ActionExample[][],
  validate: async (runtime) => {
    const svc = runtime.getService(SERVICE_KEY);
    return svc !== undefined;
  },
  handler: async (runtime, message, state, options, callback) => {
    const svc = getService(runtime);
    try {
      const events = await svc.client.getEvents({ status: "live" });
      const entries = [];
      for (const event of events) {
        for (const market of event.markets) {
          try {
            const orderbook = await svc.client.getOrderbook(market.id);
            entries.push({ market: { ...market }, orderbook });
          } catch {
            // Skip markets where orderbook fetch fails
          }
        }
      }
      const opportunities = scanAndScore(entries, 5);
      const summary = formatOpportunitySummary(opportunities);
      if (callback) {
        callback({ text: summary });
      }
      return true;
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      if (callback) callback({ text: `Failed to scan markets: ${msg}` });
      return false;
    }
  },
};

export const placeJupiterBet: Action = {
  name: "PLACE_JUPITER_BET",
  description: "Place a prediction bet on a Jupiter market. Requires market ID, YES/NO direction, and amount in dollars.",
  similes: ["bet on jupiter", "place jupiter order", "buy prediction", "trade jupiter"],
  examples: [
    [
      { name: "user", content: { text: "Bet $5 YES on market abc123" } },
      { name: "assistant", content: { text: "Placing $5 YES bet on market abc123..." } },
    ],
  ] as ActionExample[][],
  validate: async (runtime) => {
    const svc = runtime.getService(SERVICE_KEY);
    return svc !== undefined;
  },
  handler: async (runtime, message, state, options, callback) => {
    const svc = getService(runtime);
    const text = typeof message.content === "string" ? message.content : message.content?.text ?? "";

    // Extract parameters from AI-structured content or message text
    const marketIdMatch = /market[:\s]+([a-zA-Z0-9]+)/i.exec(text);
    const amountMatch = /\$(\d+(?:\.\d+)?)/i.exec(text);
    const isYes = /\byes\b/i.test(text);
    const isNo = /\bno\b/i.test(text);

    if (!marketIdMatch) {
      if (callback) callback({ text: "Missing market ID. Specify: bet $5 YES on market <id>" });
      return false;
    }
    if (!amountMatch) {
      if (callback) callback({ text: "Missing amount. Specify: bet $5 YES on market <id>" });
      return false;
    }
    if (!isYes && !isNo) {
      if (callback) callback({ text: "Specify YES or NO direction." });
      return false;
    }

    const marketId = marketIdMatch[1]!;
    const dollars = parseFloat(amountMatch[1]!);
    const depositAmount = dollarsToMicroUsd(dollars);

    try {
      if (callback) callback({ text: `Placing $${dollars.toFixed(2)} ${isYes ? "YES" : "NO"} bet on market ${marketId}...` });

      const { orderPubkey, signature } = await svc.placeOrderAndSign({
        ownerPubkey: svc.ownerPubkey,
        marketId,
        isYes,
        isBuy: true,
        depositAmount,
        depositMint: USDC_MINT,
      });

      const status = await svc.waitForFill(orderPubkey);
      const result = status.status === "filled"
        ? `Order filled! Signature: ${signature}`
        : `Order ${status.status}. Pubkey: ${orderPubkey}`;

      if (callback) callback({ text: result });
      return status.status === "filled";
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      if (callback) callback({ text: `Failed to place bet: ${msg}` });
      return false;
    }
  },
};

export const checkJupiterPositions: Action = {
  name: "CHECK_JUPITER_POSITIONS",
  description: "Check current Jupiter Prediction Market positions and P&L.",
  similes: ["my jupiter positions", "jupiter portfolio", "check predictions", "show positions"],
  examples: [
    [
      { name: "user", content: { text: "Show my Jupiter positions" } },
      { name: "assistant", content: { text: "Fetching your Jupiter positions..." } },
    ],
  ] as ActionExample[][],
  validate: async (runtime) => {
    const svc = runtime.getService(SERVICE_KEY);
    return svc !== undefined;
  },
  handler: async (runtime, message, state, options, callback) => {
    const svc = getService(runtime);
    try {
      const positions = await svc.client.getPositions(svc.ownerPubkey);
      if (positions.length === 0) {
        if (callback) callback({ text: "No open positions." });
        return true;
      }
      const lines = positions.map((pos) => {
        const avg = microUsdToDollars(pos.averagePrice).toFixed(2);
        const cur = microUsdToDollars(pos.currentPrice).toFixed(2);
        const direction = pos.isYes ? "YES" : "NO";
        return `${pos.marketId}: ${pos.quantity}x ${direction} @ $${avg} (now $${cur}) [${pos.status}]`;
      });
      if (callback) callback({ text: `Positions:\n${lines.join("\n")}` });
      return true;
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      if (callback) callback({ text: `Failed to fetch positions: ${msg}` });
      return false;
    }
  },
};

export const claimJupiterWinnings: Action = {
  name: "CLAIM_JUPITER_WINNINGS",
  description: "Claim winnings from settled Jupiter Prediction Markets.",
  similes: ["claim jupiter winnings", "collect predictions", "claim payouts"],
  examples: [
    [
      { name: "user", content: { text: "Claim my Jupiter winnings" } },
      { name: "assistant", content: { text: "Claiming settled positions..." } },
    ],
  ] as ActionExample[][],
  validate: async (runtime) => {
    const svc = runtime.getService(SERVICE_KEY);
    return svc !== undefined;
  },
  handler: async (runtime, message, state, options, callback) => {
    const svc = getService(runtime);
    try {
      const positions = await svc.client.getPositions(svc.ownerPubkey);
      const claimable = positions.filter((p) => p.status === "won" || p.status === "claimable");
      if (claimable.length === 0) {
        if (callback) callback({ text: "No claimable positions found." });
        return true;
      }
      const results: string[] = [];
      for (const pos of claimable) {
        try {
          const { transaction } = await svc.client.claimPosition(pos.positionPubkey);
          const signature = await svc.signAndSubmit(transaction);
          results.push(`Claimed ${pos.positionPubkey}: ${signature}`);
        } catch (error) {
          const msg = error instanceof Error ? error.message : String(error);
          results.push(`Failed ${pos.positionPubkey}: ${msg}`);
        }
      }
      if (callback) callback({ text: results.join("\n") });
      return true;
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      if (callback) callback({ text: `Failed to claim: ${msg}` });
      return false;
    }
  },
};
```

- [ ] **Step 2: Commit**

```bash
git add plugins/jupiter-prediction/actions.ts
git commit -m "feat(jupiter): add elizaOS actions (scan, bet, positions, claim)"
```

---

## Task 7: Plugin index — wire it all together

**Files:**
- Create: `plugins/jupiter-prediction/index.ts`
- Test: `jupiter.test.ts` (repo root)

- [ ] **Step 1: Write the failing test**

Create `jupiter.test.ts` at repo root:

```typescript
import { describe, expect, test } from "bun:test";

describe("jupiter-prediction plugin", () => {
  test("exports a valid elizaOS plugin", async () => {
    const mod = await import("./plugins/jupiter-prediction/index");
    const plugin = mod.default ?? mod.jupiterPredictionPlugin;
    expect(plugin).toBeDefined();
    expect(plugin.name).toBe("jupiter-prediction");
    expect(Array.isArray(plugin.actions)).toBe(true);
    expect(plugin.actions.length).toBeGreaterThanOrEqual(4);
  });

  test("exports all expected actions", async () => {
    const mod = await import("./plugins/jupiter-prediction/index");
    const plugin = mod.default ?? mod.jupiterPredictionPlugin;
    const names = plugin.actions.map((a: { name: string }) => a.name);
    expect(names).toContain("SCAN_JUPITER_MARKETS");
    expect(names).toContain("PLACE_JUPITER_BET");
    expect(names).toContain("CHECK_JUPITER_POSITIONS");
    expect(names).toContain("CLAIM_JUPITER_WINNINGS");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
bun test jupiter.test.ts
```

Expected: FAIL — module `./plugins/jupiter-prediction/index` does not exist.

- [ ] **Step 3: Write the plugin index**

Create `plugins/jupiter-prediction/index.ts`:

```typescript
import type { Plugin } from "@elizaos/core";
import {
  scanJupiterMarkets,
  placeJupiterBet,
  checkJupiterPositions,
  claimJupiterWinnings,
} from "./actions";

export const jupiterPredictionPlugin: Plugin = {
  name: "jupiter-prediction",
  description: "Jupiter Prediction Markets — scan, trade, and manage positions on Solana",
  actions: [
    scanJupiterMarkets,
    placeJupiterBet,
    checkJupiterPositions,
    claimJupiterWinnings,
  ],
  providers: [],
  services: [],
};

export default jupiterPredictionPlugin;
```

Note: The `JupiterPredictionService` is initialized and registered in `jupiter-runner.ts` (Task 9) rather than in the plugin index. This keeps the plugin dependency-free for testing and allows the runner to control service lifecycle with the correct env config.

- [ ] **Step 4: Run tests to verify they pass**

```bash
bun test jupiter.test.ts
```

Expected: All tests PASS.

- [ ] **Step 5: Commit**

```bash
git add plugins/jupiter-prediction/index.ts jupiter.test.ts
git commit -m "feat(jupiter): add plugin index with action wiring"
```

---

## Task 8: TUI refactoring — venue-aware branding

**Files:**
- Modify: `tui.tsx:97` (TuiSession type)
- Modify: `tui.tsx:1929` (status bar)
- Modify: `tui.tsx:1984` (export name)

- [ ] **Step 1: Add venue field to TuiSession**

In `tui.tsx`, find the `TuiSession` type at line 97 and add `venue`:

```typescript
type TuiSession = {
  readonly runtime: AgentRuntime;
  readonly roomId: UUID;
  readonly worldId: UUID;
  readonly userId: UUID;
  readonly messageService: IMessageService;
  readonly venue?: "polymarket" | "jupiter";
};
```

- [ ] **Step 2: Update status bar branding**

In `tui.tsx`, find the status text at line 1929. Change:

```typescript
return `Eliza Polymarket | ${balanceText} | ${autonomyIndicator} | ${processingIndicator} | Tab: Focus | /autonomy true|false`;
```

to:

```typescript
const venueName = venue === "jupiter" ? "Jupiter Prediction" : "Eliza Polymarket";
return `${venueName} | ${balanceText} | ${autonomyIndicator} | ${processingIndicator} | Tab: Focus | /autonomy true|false`;
```

This requires threading the `venue` prop from the session through to the component. Find where `PolymarketTuiApp` receives props and add `venue`:

In the component (around line 1800-1810, find the props destructuring), ensure `venue` is read from session props:

```typescript
const venue = props.venue ?? "polymarket";
```

- [ ] **Step 3: Add runTradingTui export alias**

At line 1984 in `tui.tsx`, after the existing `runPolymarketTui` function, add:

```typescript
export const runTradingTui = runPolymarketTui;
```

- [ ] **Step 4: Verify existing tests still pass**

```bash
bun test
```

Expected: All existing tests PASS (no regressions).

- [ ] **Step 5: Commit**

```bash
git add tui.tsx
git commit -m "refactor(tui): add venue field for multi-venue branding support"
```

---

## Task 9: Jupiter runner — runtime session and commands

**Files:**
- Create: `jupiter-runner.ts`

- [ ] **Step 1: Write the jupiter runner**

Create `jupiter-runner.ts`:

```typescript
import {
  AgentRuntime,
  ChannelType,
  createCharacter,
  stringToUuid,
  type Character,
  type UUID,
} from "@elizaos/core";
import anthropicPlugin from "@elizaos/plugin-anthropic";
import googleGenAIPlugin from "@elizaos/plugin-google-genai";
import groqPlugin from "@elizaos/plugin-groq";
import { openaiPlugin } from "@elizaos/plugin-openai";
import sqlPlugin from "@elizaos/plugin-sql";
import XAIPlugin from "@elizaos/plugin-xai";
import process from "node:process";
import {
  applyEnvValues,
  readEnvFile,
  resolveEnvPath,
  resolveLlmModel,
  resolveLlmProvider,
  writeEnvFile,
  type CliOptions,
  type LlmProvider,
} from "./lib";
import { runTradingTui, runSettingsWizard, setFatalError, type SettingsField } from "./tui";
import { jupiterPredictionPlugin } from "./plugins/jupiter-prediction/index";
import { JupiterPredictionService } from "./plugins/jupiter-prediction/service";

const DEFAULT_ROOM_ID = stringToUuid("jupiter-prediction-room");
const DEFAULT_WORLD_ID = stringToUuid("jupiter-prediction-world");
const DEFAULT_USER_ID = stringToUuid("jupiter-operator");

const PROVIDER_OPTIONS = ["openai", "anthropic", "gemini", "groq", "grok"] as const;
const DEFAULT_LLM_MODELS: Record<LlmProvider, string> = {
  openai: "gpt-5",
  anthropic: "claude-sonnet-4-20250514",
  gemini: "gemini-2.5-pro-preview-03-25",
  groq: "llama-3.3-70b-versatile",
  grok: "grok-3",
};

type JupiterSession = {
  readonly runtime: AgentRuntime;
  readonly roomId: UUID;
  readonly worldId: UUID;
  readonly userId: UUID;
  readonly agentId: UUID;
  readonly options: CliOptions;
  readonly jupiterService: JupiterPredictionService;
};

function buildJupiterCharacter(secrets: Record<string, string>): Character {
  return createCharacter({
    name: "Jupiter",
    username: "jupiter",
    bio: [
      "Jupiter v2 (elizaOS 2.0) — an autonomous agent that trades on Jupiter Prediction Markets on Solana.",
      "Uses available tools to scan prediction markets, analyze opportunities, and place bets responsibly.",
    ],
    adjectives: ["focused", "pragmatic", "direct"],
    style: {
      all: [
        "Use available tools to inspect markets before acting",
        "Keep responses short and operational",
      ],
      chat: ["Be concise", "Log actions clearly"],
    },
    settings: {},
    secrets,
  });
}

function resolveLlmProviderFromEnv(): LlmProvider | null {
  return resolveLlmProvider((key) => {
    const value = process.env[key];
    return typeof value === "string" ? value : undefined;
  });
}

function resolveLlmModelFromEnv(provider: LlmProvider | null): string | null {
  return resolveLlmModel(provider, (key) => {
    const value = process.env[key];
    return typeof value === "string" ? value : undefined;
  });
}

function buildLlmPlugins(provider: LlmProvider | null): Array<typeof openaiPlugin> {
  if (!provider) return [openaiPlugin];
  switch (provider) {
    case "anthropic": return [anthropicPlugin];
    case "gemini": return [googleGenAIPlugin];
    case "groq": return [groqPlugin];
    case "grok": return [XAIPlugin];
    case "openai":
    default: return [openaiPlugin];
  }
}

function buildRuntimeSettings(provider: LlmProvider | null): Record<string, string | undefined> {
  const model = resolveLlmModelFromEnv(provider);
  const smallModel = process.env.ELIZA_LLM_SMALL_MODEL ?? process.env.LLM_SMALL_MODEL ?? model ?? undefined;
  const settings: Record<string, string | undefined> = {
    OPENAI_API_KEY: process.env.OPENAI_API_KEY,
    ANTHROPIC_API_KEY: process.env.ANTHROPIC_API_KEY,
    GOOGLE_GENERATIVE_AI_API_KEY: process.env.GOOGLE_GENERATIVE_AI_API_KEY,
    GROQ_API_KEY: process.env.GROQ_API_KEY,
    XAI_API_KEY: process.env.XAI_API_KEY,
    LARGE_MODEL: model ?? undefined,
    SMALL_MODEL: smallModel,
    POSTGRES_URL: process.env.POSTGRES_URL || undefined,
    PGLITE_DATA_DIR: process.env.PGLITE_DATA_DIR || "memory://",
  };
  if (model) {
    if (provider === "openai") settings.OPENAI_LARGE_MODEL = model;
    if (provider === "anthropic") settings.ANTHROPIC_LARGE_MODEL = model;
    if (provider === "gemini") settings.GOOGLE_LARGE_MODEL = model;
    if (provider === "groq") settings.GROQ_LARGE_MODEL = model;
    if (provider === "grok") settings.XAI_LARGE_MODEL = model;
  }
  return settings;
}

function getRequiredEnv(key: string): string {
  const value = process.env[key];
  if (!value || value.trim().length === 0) {
    throw new Error(`Missing required environment variable: ${key}`);
  }
  return value.trim();
}

async function ensureJupiterEnvConfig(options: CliOptions, force: boolean): Promise<void> {
  const envPath = resolveEnvPath();
  const envFile = await readEnvFile(envPath);
  const provider = resolveLlmProviderFromEnv() ?? "openai";

  const fields: SettingsField[] = [
    {
      key: "JUPITER_API_KEY",
      label: "Jupiter API Key (portal.jup.ag)",
      value: process.env.JUPITER_API_KEY ?? "",
      secret: true,
      required: true,
    },
    {
      key: "SOLANA_PRIVATE_KEY",
      label: "Solana Wallet Private Key (base58)",
      value: process.env.SOLANA_PRIVATE_KEY ?? "",
      secret: true,
      required: true,
    },
    {
      key: "SOLANA_RPC_URL",
      label: "Solana RPC URL",
      value: process.env.SOLANA_RPC_URL ?? "https://api.mainnet-beta.solana.com",
    },
  ];

  // Add LLM key field for the active provider
  const providerKeyMap: Record<string, { key: string; label: string }> = {
    openai: { key: "OPENAI_API_KEY", label: "OpenAI API Key" },
    anthropic: { key: "ANTHROPIC_API_KEY", label: "Anthropic API Key" },
    gemini: { key: "GOOGLE_GENERATIVE_AI_API_KEY", label: "Gemini API Key" },
    groq: { key: "GROQ_API_KEY", label: "Groq API Key" },
    grok: { key: "XAI_API_KEY", label: "Grok API Key" },
  };
  const llmField = providerKeyMap[provider];
  if (llmField) {
    fields.push({
      key: llmField.key,
      label: llmField.label,
      value: process.env[llmField.key] ?? "",
      secret: true,
      required: true,
    });
  }

  const missingRequired = fields
    .filter((f) => f.required)
    .filter((f) => !f.value || f.value.trim().length === 0)
    .map((f) => f.label);

  if (!force && missingRequired.length === 0) return;

  const result = await runSettingsWizard({
    title: "Jupiter Prediction Setup",
    subtitle: missingRequired.length > 0
      ? `Missing required: ${missingRequired.join(", ")}`
      : "Enter required secrets to continue.",
    fields,
  });

  if (result.status !== "saved") {
    throw new Error("Setup cancelled.");
  }

  const updates: Record<string, string> = {};
  for (const [key, value] of Object.entries(result.values)) {
    if (value.trim().length > 0) updates[key] = value.trim();
  }
  await writeEnvFile(envPath, envFile.lines, updates);
  applyEnvValues(updates);
}

async function createJupiterSession(options: CliOptions): Promise<JupiterSession> {
  const jupiterApiKey = getRequiredEnv("JUPITER_API_KEY");
  const solanaPrivateKey = getRequiredEnv("SOLANA_PRIVATE_KEY");
  const rpcUrl = process.env.SOLANA_RPC_URL ?? undefined;

  const jupiterService = new JupiterPredictionService({
    apiKey: jupiterApiKey,
    solanaPrivateKey,
    rpcUrl,
  });

  const secrets: Record<string, string> = {
    SOLANA_PRIVATE_KEY: solanaPrivateKey,
    JUPITER_API_KEY: jupiterApiKey,
  };

  const character = buildJupiterCharacter(secrets);
  const agentId = stringToUuid(character.name ?? "jupiter");
  const llmProvider = resolveLlmProviderFromEnv();
  const llmPlugins = buildLlmPlugins(llmProvider);

  const runtime = new AgentRuntime({
    character,
    plugins: [sqlPlugin, jupiterPredictionPlugin, ...llmPlugins],
    settings: buildRuntimeSettings(llmProvider),
    logLevel: "error",
    enableAutonomy: true,
    actionPlanning: true,
    checkShouldRespond: false,
  });

  // Register the Jupiter service on the runtime so actions can access it
  runtime.registerService(jupiterService as unknown as Parameters<typeof runtime.registerService>[0]);

  await runtime.initialize();

  await runtime.ensureConnection({
    entityId: DEFAULT_USER_ID,
    roomId: DEFAULT_ROOM_ID,
    worldId: DEFAULT_WORLD_ID,
    userName: "Operator",
    source: "jupiter-prediction",
    channelId: "jupiter",
    serverId: "jupiter-server",
    type: ChannelType.DM,
  } as Parameters<typeof runtime.ensureConnection>[0]);

  return {
    runtime,
    roomId: DEFAULT_ROOM_ID,
    worldId: DEFAULT_WORLD_ID,
    userId: DEFAULT_USER_ID,
    agentId,
    options,
    jupiterService,
  };
}

export async function jupiterVerify(options: CliOptions): Promise<void> {
  await ensureJupiterEnvConfig(options, false);
  const session = await createJupiterSession(options);
  try {
    console.log("✅ runtime initialized");
    console.log(`🔑 wallet: ${session.jupiterService.ownerPubkey}`);
    const ready = await session.jupiterService.isReady();
    console.log(`📡 jupiter exchange: ${ready ? "operational" : "unavailable"}`);
    console.log(`🔧 execute: ${options.execute ? "enabled" : "disabled"}`);
  } finally {
    await session.runtime.stop();
  }
}

export async function jupiterChat(options: CliOptions): Promise<void> {
  await ensureJupiterEnvConfig(options, false);
  const session = await createJupiterSession(options);
  let exiting = false;
  const onSigint = () => {
    if (exiting) return;
    exiting = true;
    void session.runtime.stop().finally(() => process.exit(0));
  };
  process.once("SIGINT", onSigint);

  console.log("✅ runtime initialized");
  console.log(`🔑 wallet: ${session.jupiterService.ownerPubkey}`);
  console.log(`🔧 execute: ${options.execute ? "enabled" : "disabled"}`);

  try {
    const { runtime, roomId, worldId, userId } = session;
    runtime.setSetting("AUTONOMY_TARGET_ROOM_ID", String(roomId));
    runtime.setSetting("AUTONOMY_MODE", "task");

    await runtime.ensureConnection({
      entityId: userId,
      roomId,
      worldId,
      userName: "Operator",
      source: "jupiter-prediction",
      channelId: "jupiter-chat",
      serverId: "jupiter-server",
      type: ChannelType.DM,
    } as Parameters<typeof runtime.ensureConnection>[0]);

    const messageService = runtime.messageService;
    if (!messageService) {
      throw new Error("Message service not initialized — ensure an LLM plugin is loaded.");
    }

    await runTradingTui({
      runtime,
      roomId,
      worldId,
      userId,
      messageService,
      venue: "jupiter",
    });
  } finally {
    process.off("SIGINT", onSigint);
    await session.runtime.stop();
  }
}
```

- [ ] **Step 2: Commit**

```bash
git add jupiter-runner.ts
git commit -m "feat(jupiter): add jupiter-runner with runtime session and commands"
```

---

## Task 10: Entry point — jupiter-demo.ts

**Files:**
- Create: `jupiter-demo.ts`

- [ ] **Step 1: Write the entry point**

Create `jupiter-demo.ts`:

```typescript
/**
 * Jupiter Prediction Market Trading Agent
 *
 * Entry point for the AI-powered Jupiter prediction trading agent on Solana.
 * Uses elizaOS with plugin-solana and plugin-jupiter-prediction.
 *
 * Usage:
 *   JUPITER_API_KEY=key SOLANA_PRIVATE_KEY=key bun run jupiter-demo.ts chat
 */

// Suppress verbose logging
process.env.LOG_LEVEL = process.env.LOG_LEVEL || "fatal";

import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

import dotenv from "dotenv";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
dotenv.config({ path: path.join(__dirname, ".env") });

import { parseArgs } from "./lib";
import { jupiterChat, jupiterVerify } from "./jupiter-runner";

type Command = "help" | "verify" | "chat";

function usage(): void {
  const text = [
    "Jupiter Prediction Market Trading Agent",
    "",
    "An AI agent that trades on Jupiter Prediction Markets on Solana.",
    "",
    "Commands:",
    "  chat                   Start a chat session (default)",
    "  verify                 Validate API key and wallet",
    "",
    "Required Environment:",
    "  JUPITER_API_KEY        API key from portal.jup.ag",
    "  SOLANA_PRIVATE_KEY     Base58 Solana wallet private key",
    "  OPENAI_API_KEY         For AI decision making (or another LLM provider)",
    "",
    "Optional Environment:",
    "  SOLANA_RPC_URL         Solana RPC endpoint (default: mainnet)",
    "  PGLITE_DATA_DIR        Persistent database path (default: memory://)",
    "",
    "Flags:",
    "  --execute              Place real orders",
    "",
    "Examples:",
    "  bun run jupiter-demo.ts chat",
    "  bun run jupiter-demo.ts verify",
    "  bun run jupiter-demo.ts chat --execute",
  ].join("\n");
  console.log(text);
}

async function main(): Promise<void> {
  const { command, options } = parseArgs(process.argv.slice(2));

  switch (command as Command) {
    case "help":
      usage();
      break;
    case "chat":
      await jupiterChat(options);
      break;
    case "verify":
      await jupiterVerify(options);
      break;
    default:
      usage();
  }
}

if (import.meta.main) {
  main().catch((err) => {
    const message = err instanceof Error ? err.message : String(err);
    const stack = err instanceof Error ? err.stack : undefined;

    if (process.stdout.isTTY) {
      process.stdout.write("\x1b[?1000l\x1b[?1006l\x1b[?1015l\x1b[?1007l\n");
    }

    console.error("\n" + "=".repeat(60));
    console.error("❌ FATAL ERROR");
    console.error("=".repeat(60));
    console.error(message);
    if (stack) {
      console.error("\nStack trace:");
      console.error(stack);
    }
    console.error("=".repeat(60));
    process.exit(1);
  });
}
```

- [ ] **Step 2: Verify it parses**

```bash
bun build --no-bundle jupiter-demo.ts > /dev/null 2>&1 && echo "OK" || echo "FAIL"
```

Expected: `OK`

- [ ] **Step 3: Commit**

```bash
git add jupiter-demo.ts
git commit -m "feat(jupiter): add jupiter-demo.ts entry point"
```

---

## Task 11: Integration smoke test

**Files:**
- Modify: `jupiter.test.ts` (already created in Task 7)

- [ ] **Step 1: Add runner export test**

Append to `jupiter.test.ts`:

```typescript
describe("jupiter-runner module", () => {
  test("exports jupiterVerify and jupiterChat", async () => {
    const runner = await import("./jupiter-runner");
    expect(typeof runner.jupiterVerify).toBe("function");
    expect(typeof runner.jupiterChat).toBe("function");
  });

  test("exports are async functions", async () => {
    const runner = await import("./jupiter-runner");
    expect(runner.jupiterVerify.constructor.name).toBe("AsyncFunction");
    expect(runner.jupiterChat.constructor.name).toBe("AsyncFunction");
  });
});
```

- [ ] **Step 2: Run all tests**

```bash
bun test
```

Expected: All tests PASS across all test files (existing Polymarket tests + new Jupiter tests).

- [ ] **Step 3: Commit**

```bash
git add jupiter.test.ts
git commit -m "test(jupiter): add integration smoke tests for runner exports"
```

---

## Task 12: Package.json updates and final verification

**Files:**
- Modify: `package.json`

- [ ] **Step 1: Add jupiter script**

In `package.json`, change `"scripts"` to:

```json
"scripts": {
  "start": "bun run polymarket-demo.ts",
  "jupiter": "bun run jupiter-demo.ts",
  "test": "bun test"
}
```

- [ ] **Step 2: Run all tests**

```bash
bun test
```

Expected: All tests PASS.

- [ ] **Step 3: Verify jupiter help output**

```bash
bun run jupiter help
```

Expected: Prints Jupiter usage text with commands, env vars, and flags.

- [ ] **Step 4: Commit**

```bash
git add package.json
git commit -m "feat(jupiter): add jupiter script to package.json"
```
