# polymarket-ext Plugin Design Spec

> Extends the installed `@elizaos/plugin-polymarket` with missing order lifecycle, position visibility, and PnL tracking capabilities.

## Problem

The `@elizaos/plugin-polymarket` package provides market discovery and order placement but lacks:
- Order cancellation (single, bulk, per-market)
- Open order visibility as an agent action
- Heartbeat to keep orders alive
- Sell/exit position flow
- Accurate positions from Data API (current plugin calculates from last 100 trades)
- Trade history
- PnL tracking

A trading agent that can place orders but cannot cancel them or see its positions accurately is operationally dangerous.

## Architecture

```
plugins/polymarket-ext/
  types.ts              Zod schemas for CLOB + Data API responses
  clob-client.ts        Authenticated CLOB API client (cancel, orders, heartbeat)
  data-client.ts        Public Data API client (positions, trades, PnL)
  service.ts            PolymarketExtService (lifecycle, heartbeat loop, client factory)
  actions.ts            8 new elizaOS actions
  index.ts              Plugin export
  __tests__/
    clob-client.test.ts
    data-client.test.ts
    service.test.ts
    actions.test.ts
```

Follows the existing pattern: `plugins/jupiter-prediction/`, `plugins/x402-solana/`.

### Design Decisions

- **Two API clients** mirror Polymarket's own split: CLOB (authenticated trading) and Data (public reads).
- **Service owns the heartbeat loop** — starts automatically, no agent interaction needed.
- **Credentials sourced from runtime** — reads CLOB_API_KEY/SECRET/PASSPHRASE already set by `runner.ts`'s `buildCharacterSettings()`. No re-derivation.
- **Does not wrap or modify the existing plugin** — runs alongside it. The existing plugin handles market discovery and order placement; this plugin handles everything else.
- **Direct REST calls instead of reusing `@polymarket/clob-client`** — the existing plugin's client instance is private/inaccessible. We call the CLOB REST API directly with L2 HMAC auth.

## API Clients

### ClobApiClient (clob-client.ts)

Base URL: `https://clob.polymarket.com` (configurable via `CLOB_API_URL`).

All requests include 5 L2 auth headers:

| Header | Value |
|--------|-------|
| POLY_ADDRESS | Wallet address |
| POLY_API_KEY | API key |
| POLY_PASSPHRASE | Passphrase |
| POLY_TIMESTAMP | Current UNIX timestamp (seconds) |
| POLY_SIGNATURE | HMAC-SHA256(secret, timestamp + method + path + body) |

Methods:

| Method | HTTP | Path | Params |
|--------|------|------|--------|
| `cancelOrder(orderId)` | DELETE | `/order` | `{ id: orderId }` body |
| `cancelAll()` | DELETE | `/cancel-all` | none |
| `cancelMarketOrders(assetIds)` | DELETE | `/cancel-market-orders` | `{ asset_ids: assetIds }` body |
| `getOpenOrders(params?)` | GET | `/data/orders` | query: `?state=open` + optional market filter |
| `getOrderBook(tokenId)` | GET | `/book` | query: `?token_id=tokenId` |
| `heartbeat()` | GET | `/heartbeat` | none |

### DataApiClient (data-client.ts)

Base URL: `https://data-api.polymarket.com`. No authentication required.

| Method | HTTP | Path | Params |
|--------|------|------|--------|
| `getPositions(address)` | GET | `/positions` | query: `?user=address` |
| `getClosedPositions(address)` | GET | `/closed-positions` | query: `?user=address` |
| `getTrades(address, params?)` | GET | `/trades` | query: `?user=address&limit=N` + optional market |
| `getPnl(address)` | GET | `/pnl` | query: `?user=address` |

## Service

### PolymarketExtService (service.ts)

```
static serviceType = "POLYMARKET_EXT"
```

**Lifecycle:**

1. `start(runtime)`:
   - Read credentials from runtime: `CLOB_API_KEY`, `CLOB_API_SECRET`, `CLOB_API_PASSPHRASE`, `CLOB_API_URL`
   - Derive wallet address from `EVM_PRIVATE_KEY` (ethers `computeAddress`)
   - Initialize `ClobApiClient` (if credentials present) and `DataApiClient` (always)
   - Start heartbeat interval: every 60 seconds, call `clob.heartbeat()`. Silent on success, `console.warn` on failure.
   - One-time log: service status (active with CLOB, or data-only mode)

2. `stop()`:
   - Clear heartbeat interval

**Degraded mode:** If CLOB credentials are missing, the service starts without `ClobApiClient`. Actions that require CLOB (cancel, open orders, sell) return an error message. Data-only actions (positions, trades, PnL) still work.

**Exposed to actions:**
- `clob: ClobApiClient | null`
- `data: DataApiClient`
- `walletAddress: string`
- `isFullyActive(): boolean` — true if CLOB client initialized

## Actions

### P0 — Safety-Critical

#### 1. CANCEL_POLYMARKET_ORDER
- **Description**: Cancel a specific open order by ID.
- **Input**: `orderId` extracted from message text (pattern: hex or UUID string)
- **Calls**: `service.clob.cancelOrder(orderId)`
- **Output**: "Cancelled order {id}" or error message
- **Similes**: "cancel order", "remove order", "withdraw order"

#### 2. CANCEL_ALL_POLYMARKET_ORDERS
- **Description**: Cancel all open orders, or all orders for a specific market.
- **Input**: Optional `marketId` or market name from message text
- **Logic**:
  - No market specified: `service.clob.cancelAll()`
  - Market specified: look up asset IDs from market, call `service.clob.cancelMarketOrders(assetIds)`
- **Output**: "Cancelled {N} orders" + list of IDs, or error
- **Similes**: "cancel all orders", "cancel everything", "clear all orders", "cancel orders for {market}"

#### 3. GET_POLYMARKET_OPEN_ORDERS
- **Description**: List all open orders with status details.
- **Input**: Optional `marketId` filter
- **Calls**: `service.clob.getOpenOrders(params)`
- **Output**: Formatted list: order ID (shortened), market, side, price, size, filled/remaining, age
- **Similes**: "show orders", "my open orders", "list orders", "pending orders"

### P1 — Order Lifecycle

#### 4. SELL_POLYMARKET_POSITION
- **Description**: Sell shares to exit a position. Constructs a sell order.
- **Input**: `tokenId` or `marketName`, `outcome` (yes/no), `shares` or `dollarAmount`, optional `price`
- **Logic**:
  1. If no price given, fetch order book via `service.clob.getOrderBook(tokenId)`, use best bid
  2. Construct sell order params: `{ tokenId, outcome, side: "sell", price, shares }`
  3. The actual order placement delegates to the existing `POLYMARKET_PLACE_ORDER` action pattern (signs via wallet, posts to `POST /order`)
- **Output**: Order ID, status, tx hash
- **Similes**: "sell position", "exit position", "close position", "sell shares"
- **Note**: This action signs the order using the `@polymarket/clob-client` package (already a dependency). We instantiate a new `ClobClient` with the wallet's private key and call `createAndPostOrder()` with side=SELL. This avoids reimplementing EIP-712 order signing.

#### 5. Heartbeat (background service, not an action)
- 60-second interval calling `GET /heartbeat`
- Keeps GTC orders alive on the exchange
- Managed entirely by service lifecycle

### P2 — Visibility

#### 6. GET_POLYMARKET_POSITIONS
- **Description**: Show current portfolio positions with live pricing.
- **Input**: None (uses service wallet address)
- **Calls**: `service.data.getPositions(address)`
- **Output**: Per-position: market title, outcome (YES/NO), size, avg entry, current price, unrealized PnL, PnL %
- **Similes**: "my positions", "portfolio", "show holdings", "what do I own"

#### 7. GET_POLYMARKET_TRADES
- **Description**: Show recent trade history.
- **Input**: Optional `limit` (default 20), optional `marketId`
- **Calls**: `service.data.getTrades(address, params)`
- **Output**: Per-trade: market, side (BUY/SELL), outcome, price, size, time ago, tx hash (shortened)
- **Similes**: "trade history", "recent trades", "my trades", "show fills"

### P3 — Intelligence

#### 8. GET_POLYMARKET_PNL
- **Description**: Show profit/loss summary.
- **Input**: None
- **Calls**: `service.data.getPnl(address)`, optionally enriched with `getPositions` for unrealized PnL
- **Output**: Total realized PnL, unrealized PnL, total volume, win/loss count
- **Similes**: "my pnl", "profit and loss", "how am I doing", "performance", "earnings"

## Types (types.ts)

All API responses validated with Zod at the boundary.

### CLOB API Schemas

```typescript
CancelResponseSchema        = z.object({ canceled: z.string() })
CancelAllResponseSchema     = z.object({ canceled: z.array(z.string()) })
OpenOrderSchema             = z.object({
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
})
OrderBookSchema             = z.object({
  bids: z.array(z.object({ price: z.string(), size: z.string() })),
  asks: z.array(z.object({ price: z.string(), size: z.string() })),
})
```

### Data API Schemas

```typescript
PositionSchema              = z.object({
  market_slug: z.string(),
  title: z.string(),
  outcome: z.string(),
  size: z.number(),
  avg_price: z.number(),
  cur_price: z.number(),
  realized_pnl: z.number(),
  condition_id: z.string(),
  asset_id: z.string(),
})
TradeSchema                 = z.object({
  id: z.string(),
  market_slug: z.string(),
  title: z.string(),
  side: z.enum(["BUY", "SELL"]),
  outcome: z.string(),
  price: z.number(),
  size: z.number(),
  timestamp: z.string(),
  transaction_hash: z.string(),
})
PnlSummarySchema            = z.object({
  total_realized: z.number(),
  total_unrealized: z.number(),
  total_volume: z.number(),
  positions_won: z.number().optional(),
  positions_lost: z.number().optional(),
})
```

Note: Schemas will be refined against actual API responses during implementation. The `.passthrough()` modifier will be used initially to tolerate extra fields.

## Error Handling

Three error types:

- **PolymarketApiError** — Base. Contains: statusCode, responseBody, endpoint.
- **PolymarketAuthError** extends above — 401/403. Message: "CLOB credentials invalid or expired. Run settings to reconfigure."
- **PolymarketRateLimitError** extends above — 429. Message: "Rate limited. Try again in a few seconds."

All actions catch these and return human-readable messages via the elizaOS callback. No throws that would crash the agent.

## Integration with runner.ts

Add `polymarketExtPlugin` to the runtime's plugin list in `createRuntimeSession()`:

```typescript
plugins: [sqlPlugin, polymarketPlugin, polymarketExtPlugin, jupiterPredictionPlugin, x402SolanaPlugin, ...llmPlugins]
```

The service reads credentials from the same runtime secrets already configured by `buildCharacterSettings()`. No new environment variables required.

## Testing

### Unit Tests

- **clob-client.test.ts**: Mock `globalThis.fetch`. Verify HMAC header construction (timestamp, signature format). Verify each endpoint sends correct method/path/body. Verify Zod parsing of responses.
- **data-client.test.ts**: Mock fetch. Verify query param construction. Verify Zod parsing with fixture data.
- **service.test.ts**: Verify heartbeat interval starts on init, stops on teardown. Verify degraded mode (no CLOB credentials = data-only). Verify `isFullyActive()` logic.
- **actions.test.ts**: Mock service. Verify each action calls correct method, formats output text, handles errors with readable messages.

### Live Test (optional)

Root-level `polymarket-ext.live.test.ts`, requires `.env` credentials, skipped in CI. Tests read-only operations: get open orders, get positions, get trades.

## Rate Limit Awareness

Key limits to respect:
- `DELETE /order`: 3,500/10s burst, 30,000/10min sustained
- `DELETE /cancel-all`: 250/10s burst, 6,000/10min sustained
- `GET /data/orders`: 500/10s
- Data API general: 1,000/10s
- Heartbeat: 1 call/60s (well within any limit)

No special rate limiting logic needed at our call volumes. If we hit 429, the error handler surfaces it to the agent.
