# Jupiter Prediction Plugin Design

**Date:** 2026-03-27
**Status:** Approved
**Scope:** elizaOS plugin for autonomous trading on Jupiter Prediction Markets (Solana)

## Overview

Build `plugin-jupiter-prediction`, a local elizaOS plugin that enables the autonomous agent to scan, analyze, and trade on Jupiter Prediction Markets via the Jupiter REST API on Solana. Includes a new `jupiter-demo.ts` entry point with full TUI integration, reusing the existing Ink-based terminal UI.

## Architecture

### Plugin Structure

```
plugins/jupiter-prediction/
  index.ts          — plugin export (actions, providers, services)
  api.ts            — Jupiter Prediction REST API client
  types.ts          — API response types (Event, Market, Orderbook, Order, Position)
  scanner.ts        — Market scanner: fetch, filter, score opportunities
  actions.ts        — elizaOS actions for trading flow
  service.ts        — JupiterPredictionService (holds API client + config)
```

### Dependencies

- `@elizaos/plugin-solana@alpha` — Solana keypair management and transaction signing
- `@solana/web3.js` — VersionedTransaction deserialization, signing, and RPC submission
- No additional npm packages required

### Environment Variables

| Variable | Required | Description |
|----------|----------|-------------|
| `JUPITER_API_KEY` | Yes | API key from portal.jup.ag |
| `SOLANA_PRIVATE_KEY` | Yes | Base58-encoded Solana wallet private key (plugin-solana convention) |
| `SOLANA_RPC_URL` | No | Solana RPC endpoint (defaults to mainnet) |

## API Client (`api.ts`)

Typed wrapper around `https://api.jup.ag/prediction/v1`. All requests include `x-api-key` header.

### Methods

| Method | Endpoint | Returns |
|--------|----------|---------|
| `getEvents(category?, status?)` | `GET /events` | Filterable event list |
| `searchEvents(query)` | `GET /events/search?query=` | Keyword search |
| `getMarket(marketId)` | `GET /markets/{marketId}` | Pricing, status, implied probability |
| `getOrderbook(marketId)` | `GET /orderbook/{marketId}` | Bid/ask depth arrays |
| `placeOrder(params)` | `POST /orders` | Unsigned VersionedTransaction (base64) |
| `getOrders(ownerPubkey)` | `GET /orders?ownerPubkey=` | Open orders list |
| `getOrderStatus(orderPubkey)` | `GET /orders/status/{orderPubkey}` | pending/filled/failed |
| `getPositions(ownerPubkey)` | `GET /positions?ownerPubkey=` | Positions with P&L |
| `closePosition(positionPubkey)` | `DELETE /positions/{positionPubkey}` | Close/sell position tx |
| `claimPosition(positionPubkey)` | `POST /positions/{positionPubkey}/claim` | Claim winnings tx |
| `getTradingStatus()` | `GET /trading-status` | Exchange operational status |

### Monetary Values

All Jupiter API values use micro-USD (1,000,000 = $1.00). The client normalizes to human-readable dollars in the typed responses.

### Transaction Signing Flow

1. `placeOrder()` returns base64-encoded unsigned `VersionedTransaction`
2. Deserialize with `@solana/web3.js`
3. Sign with Solana keypair from `plugin-solana`
4. Submit to Solana RPC via `sendRawTransaction`
5. Poll `getOrderStatus()` until filled or failed

## Market Scanner (`scanner.ts`)

Pure functions with no elizaOS dependency. Called by the `SCAN_JUPITER_MARKETS` action.

### Pre-filter Stage (Programmatic)

Fetch live events, then for each market's orderbook, exclude:
- Markets with < 3 bids or < 3 asks (thin liquidity)
- Spread > 15% (too wide for favorable entry)
- Markets expiring within 1 hour

### Scoring

| Factor | Weight | Logic |
|--------|--------|-------|
| Spread | 50% | Tighter spread = higher score |
| Midpoint | 30% | Prices near 0.50 (max uncertainty) = higher score |
| Depth | 20% | More orders on both sides = higher score |

### Output

Top N scored opportunities (default 5) as structured data: event title, market question, YES/NO prices, spread, depth summary, implied probability, category.

### AI Decision Phase

The LLM receives the shortlist and decides:
- Which market(s) to trade (if any)
- YES or NO position
- Size (bounded by configurable max, default $5 USDC)
- Reasoning for the trade

## elizaOS Actions (`actions.ts`)

| Action | Description |
|--------|-------------|
| `SCAN_JUPITER_MARKETS` | Run scanner, return scored opportunities to chat |
| `PLACE_JUPITER_BET` | Place a prediction bet (builds tx, signs, submits) |
| `CHECK_JUPITER_POSITIONS` | Fetch and display current positions with P&L |
| `CLAIM_JUPITER_WINNINGS` | Claim payouts from settled winning positions |

## Service (`service.ts`)

`JupiterPredictionService` registers on the elizaOS runtime:
- Holds the API client instance and configuration
- Provides wallet pubkey from plugin-solana
- Manages connection to Solana RPC
- Exposes `isReady()` for health checks

## Entry Point (`jupiter-demo.ts`)

Mirrors `polymarket-demo.ts`:
- Loads dotenv, parses CLI args
- Commands: `chat` (default), `verify`, `help`
- Creates elizaOS runtime with plugins: `sqlPlugin`, `jupiterPredictionPlugin`, `pluginSolana`, + LLM plugin
- Character: "Jupiter" — autonomous Solana prediction market trader
- Launches the shared TUI

### CLI

```bash
bun run jupiter chat              # Interactive TUI (default)
bun run jupiter verify            # Validate API key + wallet
bun run jupiter chat --execute    # Enable real order placement
```

## TUI Integration (`tui.tsx`)

Minimal refactoring to support multiple venues:

- Rename `runPolymarketTui` to `runTradingTui` (export both for backward compat)
- Add optional `venue` field to `TuiSession`: `"polymarket" | "jupiter"` (defaults to `"polymarket"`)
- Status bar branding changes based on venue: "Eliza Polymarket" vs "Jupiter Prediction"
- Sidebar content is venue-agnostic — it renders whatever the agent's actions produce

### Settings Wizard

Add `JUPITER_API_KEY` and `SOLANA_PRIVATE_KEY` to the wizard fields when venue is Jupiter.

### package.json Changes

- Add script: `"jupiter": "bun run jupiter-demo.ts"`
- Add deps: `@elizaos/plugin-solana@alpha`, `@solana/web3.js@^1.98.0`

## Testing

### Unit Tests (`plugins/jupiter-prediction/__tests__/`)

- `api.test.ts` — Mock HTTP responses, verify typed parsing, micro-USD normalization, error handling (401, 403, rate limits)
- `scanner.test.ts` — Canned market data, verify filtering logic (thin liquidity excluded, wide spreads excluded), verify scoring math
- `types.test.ts` — Zod schema validation for API response shapes

### Integration Test (`jupiter.test.ts` at repo root)

- Plugin exports correct actions and services
- Module imports resolve correctly

### Manual Testing

1. `bun run jupiter verify` — validates API key, wallet, exchange status
2. `bun run jupiter chat` — TUI with `/markets` showing live Jupiter predictions
3. Chat: "scan jupiter markets" triggers scanner, presents opportunities
4. Agent trades in dry-run by default; `--execute` for real orders

No live API calls in CI. All unit tests use mocked HTTP responses.

## Constraints

- Jupiter Prediction Markets are geo-restricted (US and South Korea IPs blocked)
- Deposits are in USDC (`EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v`) or JupUSD (`JuprjznTrTSp2UFa3ZBUFgwdAmtZCq4MQCwysN55USD`)
- The Jupiter Prediction API is in beta
- Winning claims pay $1.00 per contract with no fees; fees are on trade execution only
