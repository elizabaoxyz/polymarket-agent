# ElizaBAO — Autonomous Prediction Market Trading Agent

An **AI-powered autonomous trading agent** that scans, analyzes, buys, and sells across **Polymarket** (Polygon) and **Jupiter Prediction Markets** (Solana), with **x402** payment protocol for accessing paid APIs.

Built on [elizaOS](https://github.com/elizaos/eliza) with a custom web dashboard.

**Twitter**: [elizabao_ai](https://x.com/elizabao_ai)
**Live Demo**: [elizabao.ai](https://elizabao.ai)

---

## What It Does

ElizaBAO is a fully autonomous prediction market trader that:

1. **Scans** 500+ markets across Polymarket and Jupiter every 60 seconds
2. **Scores** each market by spread, midpoint proximity, volume, and time to expiry
3. **Analyzes** top candidates with LLM (picks market + YES/NO side with reasoning)
4. **Buys** with smart position sizing ($3–$6 based on conviction) via direct CLOB API
5. **Sells** losers and takes profit via direct API calls (bypasses LLM for reliability)
6. **Reviews** existing positions when no new markets found — LLM recommends exits
7. **Pays** for premium market data via x402 protocol on Solana
8. **Runs both platforms in parallel** every cycle, or individually via dashboard toggles
9. **Tracks P&L** per cycle with daily spend limits and position age protection
10. **Protects** open orders with Polymarket heartbeat (alerts after 5 consecutive failures)
11. **Never repeats** — tracks owned positions, trade cooldowns, and failed attempt history
12. **Runs 24/7** — persists even when browser disconnects; auto-retries on transient errors

---

## Architecture

```
┌──────────────────────────────────────────────────────────────┐
│                    NEXT.JS WEB APP (port 3000)                │
│  ┌──────────┬──────────────────────────┬──────────────────┐  │
│  │  Left    │     Center Chat           │   Right          │  │
│  │  Sidebar │  (agent messages,         │   Sidebar        │  │
│  │          │   trade results,          │  (plugins,       │  │
│  │ Agent    │   autonomy logs,          │   quick actions) │  │
│  │ Portfolio│   P&L tracking)           │                  │  │
│  │ Live Feed│                           │                  │  │
│  └──────────┴──────────────────────────┴──────────────────┘  │
│  ┌──────────────────────────────────────────────────────┐    │
│  │            WHALE ANALYTICS DASHBOARD                  │    │
│  │  Volume | Trades | Whales | Buy/Sell Pressure         │    │
│  └──────────────────────────────────────────────────────┘    │
│                                                              │
│  Header: [ALL] [POLY] [JUP+x402] toggles · x402 badge       │
└──────────────────────────┬───────────────────────────────────┘
                           │ WebSocket (auth optional)
┌──────────────────────────▼───────────────────────────────────┐
│                  BUN WEBSOCKET SERVER (port 3001)              │
│                                                               │
│  ┌──────────────┐  ┌──────────────────┐  ┌────────────────┐  │
│  │ elizaOS      │  │ Autonomy Engine  │  │ Heartbeat      │  │
│  │ Runtime      │  │ (autonomy.ts)    │  │ Loop (10s)     │  │
│  │              │  │                  │  │                │  │
│  │ - 6 Plugins  │  │ Both platforms   │  │ HMAC-signed    │  │
│  │ - 18 Actions │  │ run in parallel  │  │ POST to CLOB   │  │
│  │ - 6 Services │  │ via Promise.all  │  │ Alerts on fail │  │
│  └──────────────┘  └──────────────────┘  └────────────────┘  │
│                                                               │
│  ┌──────────────────────────────────────────────────────────┐ │
│  │                      PLUGINS                              │ │
│  │ ┌──────────────┐ ┌──────────────┐ ┌────────────────────┐ │ │
│  │ │ polymarket-  │ │ jupiter-     │ │ x402-solana        │ │ │
│  │ │ ext (8 acts) │ │ prediction   │ │ (auto-pay)         │ │ │
│  │ │              │ │ (5 acts)     │ │                    │ │ │
│  │ │ Direct CLOB  │ │ Direct API   │ │ Wraps fetch()      │ │ │
│  │ │ buy + sell   │ │ buy + sell   │ │ Pays 402 via USDC  │ │ │
│  │ └──────────────┘ └──────────────┘ └────────────────────┘ │ │
│  │ ┌──────────────┐ ┌──────────────┐ ┌────────────────────┐ │ │
│  │ │ rag-chromadb │ │ connectors   │ │ plugin-polymarket  │ │ │
│  │ │ (similarity) │ │ (news+search)│ │ (upstream, filtered│ │ │
│  │ └──────────────┘ └──────────────┘ └────────────────────┘ │ │
│  └──────────────────────────────────────────────────────────┘ │
│                                                               │
│  ┌──────────────────────────────────────────────────────────┐ │
│  │                  SHARED MODULES                           │ │
│  │  config.ts   retry.ts   mutex.ts   portfolio.ts           │ │
│  │  solana-wallet.ts   autonomy.ts                           │ │
│  └──────────────────────────────────────────────────────────┘ │
└───────────────────────────────────────────────────────────────┘
```

---

## Plugins

### Polymarket Extended (8 actions)

| Action | Description |
|--------|-------------|
| `POLYMARKET_PLACE_ORDER` | Buy with smart market search and token resolution |
| `POLYMARKET_CANCEL_ORDER` | Cancel a specific order by ID |
| `POLYMARKET_CANCEL_ALL` | Cancel all open orders |
| `POLYMARKET_GET_ORDERS` | List open orders |
| `POLYMARKET_SELL` | Sell shares at best bid (fallback to curPrice) |
| `POLYMARKET_GET_POSITIONS` | Show portfolio positions with PnL |
| `POLYMARKET_GET_TRADES` | Show recent trade history |
| `POLYMARKET_GET_PNL` | Show profit/loss summary |

**Chain**: Polygon | **Auth**: CLOB API keys + EVM wallet | **Signature Type**: POLY_PROXY (type 1)

**Autonomy sells bypass the LLM** — `directPolymarketSell()` calls the CLOB API directly for reliable execution. If the order book best bid is < $0.03, falls back to position `curPrice × 0.95`.

**Autonomy buys also bypass the LLM** — `directPolymarketBuy()` searches markets, resolves tokens, fetches best ask from order book, and places the order via CLOB API.

### Jupiter Prediction (5 actions)

| Action | Description |
|--------|-------------|
| `SCAN_JUPITER_MARKETS` | Scan live Solana prediction markets |
| `PLACE_JUPITER_BET` | Place a bet on a Jupiter market |
| `CHECK_JUPITER_POSITIONS` | Check positions and PnL |
| `SELL_JUPITER_POSITION` | Sell/close a position by market ID or pubkey |
| `CLAIM_JUPITER_WINNINGS` | Claim settled positions |

**Chain**: Solana | **Auth**: Jupiter API key + Solana wallet (Ed25519 keypair)

**Jupiter sells are always direct** — `DELETE /positions/{pubkey}` via the Jupiter API client. No partial sells — full position closure only.

### x402 Solana (auto-pay protocol)

| Feature | Description |
|---------|-------------|
| `wrapFetchWithPayment()` | Wraps all HTTP calls to detect 402 responses |
| `ExactSvmScheme` | Signs Solana USDC payment transactions |
| `onBeforePaymentCreation` | Validates payment cap, tracks spending |
| Payment tracking | Count, total USD, timestamped log |

**Chain**: Solana mainnet + devnet | **Asset**: USDC | **Cap**: configurable (default $0.10/request)

### RAG Pipeline (ChromaDB)

| Feature | Description |
|---------|-------------|
| Market indexing | Top 20 Polymarket + Jupiter markets → ChromaDB vectors each cycle |
| Similarity scoring | Adjusts market scores by ±10% based on ChromaDB similarity |
| News indexing | NewsAPI articles cached in ChromaDB for future retrieval |
| Context enrichment | Combines news + search + similar markets for LLM analysis |

### Connectors (News + Search)

| Feature | Description |
|---------|-------------|
| NewsAPI | Fetches market-relevant articles by extracted keywords |
| Tavily | Web search for broader context on market topics |
| Combined context | Formatted for injection into LLM analysis prompts |

---

## Autonomous Trading

### Dashboard Controls

The web dashboard header provides three autonomy toggles:

| Button | Platforms | Heartbeat | x402 |
|--------|-----------|-----------|------|
| **ALL** | Polymarket + Jupiter in parallel | ✅ | ✅ |
| **POLY** | Polymarket only | ✅ | ❌ |
| **JUP+x402** | Jupiter only | ❌ | ✅ |

Clicking an active button stops autonomy. Clicking a different button auto-switches (stops current, starts new).

### How It Works

The autonomy engine (`autonomy.ts`) runs an infinite loop. Each cycle runs both platforms **in parallel** via `Promise.allSettled()`, with `setTimeout` chaining to prevent cycle overlap.

```
┌──────────────────────────────────────────────────────────┐
│                 AUTONOMY CYCLE (every 60s)                 │
│                                                           │
│  1. Housekeep — prune expired state (failedSells, etc.)   │
│  2. Fetch balances — Polygon + Solana                     │
│  3. Log P&L delta since last cycle                        │
│  4. Collect positions — both platforms                     │
│                                                           │
│  ┌─────────────────────┐  ┌──────────────────────────┐   │
│  │ POLYMARKET (parallel)│  │ JUPITER (parallel)        │   │
│  │                     │  │                          │   │
│  │ Sell phase:         │  │ Sell/claim phase:        │   │
│  │  LLM → SELL/HOLD    │  │  LLM → SELL/HOLD         │   │
│  │  Direct CLOB sell   │  │  Direct API close         │   │
│  │                     │  │                          │   │
│  │ Buy phase:          │  │ Buy phase:               │   │
│  │  Scan 500+ markets  │  │  Scan 200+ markets       │   │
│  │  RAG enrich + score │  │  RAG enrich + score      │   │
│  │  LLM pick+side      │  │  LLM pick+side           │   │
│  │  Direct CLOB buy    │  │  sendPrompt → action      │   │
│  │                     │  │                          │   │
│  │ If 0 markets:       │  │ If 0 markets:            │   │
│  │  (no action)        │  │  Review all positions     │   │
│  │                     │  │  LLM recommends exits     │   │
│  └─────────────────────┘  └──────────────────────────┘   │
│                                                           │
│  5. Status summary — x402, positions, balances, timing    │
└──────────────────────────────────────────────────────────┘
```

### Sell Phase

Sells run every cycle for each platform. Positions hitting thresholds are sent to the LLM for SELL/HOLD decisions, then executed via direct API calls.

| Threshold | Normal | Low Balance (< $3) |
|-----------|--------|-------------------|
| Loss cutoff | -15% | -5% |
| Profit taking | +25% | +5% |

**Polymarket sells**: `directPolymarketSell()` → order book best bid → CLOB SELL order. Falls back to `curPrice × 0.95` when order book bid is < $0.03.

**Jupiter sells**: `jupSvc.client.closePosition()` → signed `VersionedTransaction` → Solana RPC. Full position closure (no partial sells).

**Position protection**: Positions younger than 10 minutes (`POSITION_MIN_AGE_MS`) are never sold.

**Recovery mode**: When Polymarket balance < $3 and no threshold sells trigger, the LLM reviews all positions and picks 1–3 to sell.

**Jupiter position review**: When Jupiter scan finds 0 new markets, the LLM reviews all existing positions and recommends exits for dead money.

### Buy Phase

Buys only execute when platform balance ≥ $3 and daily spend limit not reached.

**Polymarket buys**: `directPolymarketBuy()` → search market → resolve YES/NO token → order book best ask → CLOB BUY order. Bypasses LLM action routing for reliability.

**Jupiter buys**: `sendPrompt("bet $3 YES on jupiter market {id}")` → elizaOS action `PLACE_JUPITER_BET` → signed Solana transaction.

### Scoring Algorithm

Each market is scored 0–1 using weighted factors:

**Polymarket**: `Spread(35%) + Midpoint(30%) + Time(20%) + Volume(15%)`  
**Jupiter**: `Spread(35%) + Midpoint(30%) + Volume(35%)`

| Factor | Formula | Purpose |
|--------|---------|---------|
| **Spread** | `max(0, 1 - spread / 0.15)` | Tighter = less slippage |
| **Midpoint** | `1 - abs(midpoint - 0.5) × 2` | Near 50/50 = most opportunity |
| **Time** | `min(1, daysLeft / 30)` | 30+ days to play out |
| **Volume** | `min(1, volume / threshold)` | Higher = reliable pricing |

RAG similarity scoring adds ±10% adjustment based on ChromaDB market similarity.

### Position Sizing

| Score | Bet Size | Balance Cap |
|-------|----------|-------------|
| > 0.9 | $6 | 10% of balance |
| > 0.7 | $4.50 | 8% of balance |
| ≤ 0.7 | $3 | 5% of balance |

Minimum $3 both platforms. Configurable via `MIN_BET_SIZE_USD`, `MAX_BET_SIZE_USD`, `BASE_BET_SIZE_USD`.

### Smart Features

| Feature | Description |
|---------|-------------|
| **Parallel execution** | Polymarket + Jupiter via `Promise.allSettled` — neither blocks the other |
| **No cycle overlap** | `setTimeout` chaining — next cycle starts only after previous finishes |
| **Direct API buys/sells** | Polymarket buys and sells bypass LLM for reliable execution |
| **P&L tracking** | `[P&L] +$2.50 since last cycle (poly: +$1.50, sol: +$1.00)` |
| **Cycle timing** | `[AUTONOMY] Cycle #3 complete in 32.5s` |
| **Daily spend limit** | Configurable `DAILY_SPEND_LIMIT_USD` (default: unlimited) |
| **State housekeeping** | Auto-prunes `failedSells`, `failedBuys`, `recentlySold` every cycle |
| **Position age protection** | Won't sell positions < 10 min old |
| **Jupiter position review** | When 0 new markets, LLM reviews all positions for sell opportunities |
| **Scan diagnostics** | `[JUPITER:SCAN] 270 scanned, filtered: price=40, volume=8, owned=5, passed=12` |
| **Heartbeat alerting** | After 5 consecutive failures: `⚠️ GTC orders at risk!` |
| **Enrichment caching** | Duplicate NewsAPI/Tavily calls deduplicated per cycle |
| **Retry with backoff** | All API calls retry 3× with exponential backoff on transient errors |
| **WebSocket auth** | Optional `WS_AUTH_TOKEN` gates all client commands |
| **Per-platform toggles** | Run ALL, POLY only, or JUP+x402 only from dashboard |

---

## Heartbeat Protocol

Polymarket GTC orders require a **heartbeat signal every 10 seconds**. If it stops, all orders auto-cancel.

```
Agent (autonomy.ts)         Polymarket CLOB
─────────────────           ───────────────
heartbeat_id: null ────────▶ { heartbeat_id: "abc" }
{ heartbeat_id: "abc" } ──▶ Session alive ✓  (every 10s)
[5 failures] ──────────────▶ ⚠️ Alert to dashboard
[crash/stop] ──────────────▶ No heartbeat → cancel all orders
```

**Implementation**: `plugins/polymarket-ext/clob-client.ts` — HMAC-SHA256 signed POST to `/v1/heartbeats`. Heartbeat only runs for Polymarket/ALL modes (not Jupiter-only).

---

## Web Dashboard

Three-panel layout with green/black terminal theme:

- **Header**: `[ALL]` `[POLY]` `[JUP+x402]` autonomy toggles, x402 payment badge, social links
- **Left sidebar**: Agent info, portfolio (Polygon + Solana balances), live whale feed
- **Center chat**: Talk to agent, autonomy logs, trade results, P&L updates
- **Right sidebar**: Plugin status (6 plugins), quick action buttons
- **Bottom**: Whale analytics — 24h volume, trades, buy/sell pressure
- **Modals**: Plugin details, whale profiles, x402 payment stats

---

## Configuration

All trading constants are configurable via environment variables with sensible defaults:

### Required

```bash
# LLM (at least one)
OPENAI_API_KEY=sk-...

# Polymarket (Polygon)
EVM_PRIVATE_KEY=0x...
CLOB_API_KEY=...
CLOB_API_SECRET=...
CLOB_API_PASSPHRASE=...
POLYMARKET_SIGNATURE_TYPE=1
POLYMARKET_FUNDER_ADDRESS=0x...

# Jupiter (Solana)
JUPITER_API_KEY=...
SOLANA_PRIVATE_KEY=...               # Base58
SOLANA_RPC_URL=https://api.mainnet-beta.solana.com
```

### Optional

```bash
# x402 Payment Protocol
X402_ENABLED=true
X402_MAX_PAYMENT_USD=0.10
X402_API_URL=https://your-x402-server.railway.app

# Server
WS_PORT=3001
WS_AUTH_TOKEN=your-secret-token      # Optional WebSocket auth

# Database
POSTGRES_URL=postgresql://...
PGLITE_DATA_DIR=memory://

# RAG Pipeline
CHROMA_URL=http://localhost:8000
NEWSAPI_API_KEY=...
TAVILY_API_KEY=...

# Trading Tuning (all optional — sensible defaults)
MAX_SHARES_PER_ORDER=500
MAX_POSITIONS=50
MIN_BET_SIZE_USD=3
MAX_BET_SIZE_USD=6
BASE_BET_SIZE_USD=3
SELL_LOSS_THRESHOLD_NORMAL=-15
SELL_LOSS_THRESHOLD_AGGRESSIVE=-5
SELL_PROFIT_THRESHOLD_NORMAL=25
SELL_PROFIT_THRESHOLD_AGGRESSIVE=5
LOW_BALANCE_THRESHOLD=3
AUTONOMY_INTERVAL_MS=60000
HEARTBEAT_INTERVAL_MS=10000
DAILY_SPEND_LIMIT_USD=50
MAX_RETRIES=3
RETRY_BASE_DELAY_MS=1000
```

---

## Local Development

```bash
# Terminal 1: WebSocket server
bun run ws-server.ts

# Terminal 2: Next.js web app
cd web && npm install && npm run dev

# Open http://localhost:3000
```

## Railway Deployment

Three services from the same repo:

| Service | Dockerfile | Port | Purpose |
|---------|-----------|------|---------|
| WS Server | `Dockerfile.ws` | 8080 | Agent runtime + WebSocket |
| Web App | `web/Dockerfile` | 3000 | Next.js frontend |
| x402 API | `Dockerfile.x402` | 8080 | Payment-gated test API |

Set `NEXT_PUBLIC_WS_URL=wss://your-ws-server.railway.app` on the web app service.

---

## Tech Stack

| Component | Technology |
|-----------|-----------|
| Runtime | [elizaOS](https://github.com/elizaos/eliza) 2.0 |
| Language | TypeScript |
| Server | Bun |
| Frontend | Next.js 15, React 19, Tailwind CSS 4, Framer Motion |
| Polymarket | `@polymarket/clob-client`, CLOB REST API, Data API |
| Jupiter | Jupiter Prediction API (`api.jup.ag/prediction/v1`) |
| x402 | `@x402/fetch`, `@x402/svm`, `@x402/core` |
| RAG | ChromaDB + OpenAI embeddings |
| News/Search | NewsAPI + Tavily |
| Wallet | ethers.js (Polygon), @solana/web3.js (Solana) |
| Validation | Zod |
| Testing | bun:test (131 tests) |

---

## Project Structure

```
polymarket-agent/
├── ws-server.ts                  # Bun WebSocket server + runtime init
├── autonomy.ts                   # Autonomy engine — parallel cycles, direct trades
├── config.ts                     # All configurable constants with env overrides
├── portfolio.ts                  # Cross-chain portfolio status fetching
├── solana-wallet.ts              # Centralized Solana keypair + balance caching
├── retry.ts                      # Exponential backoff retry utility
├── mutex.ts                      # Async mutex for runtime serialization
├── runner.ts                     # CLI TUI runner (local mode)
├── lib.ts                        # Shared utilities (LLM, env, config)
├── x402-test-server.ts           # x402 payment-gated API server
├── PROOF.md                      # Technical proof for hackathon reviewers
├── plugins/
│   ├── polymarket-ext/           # 8 Polymarket actions + CLOB/Data clients
│   │   ├── types.ts              # Zod schemas, error classes
│   │   ├── clob-client.ts        # HMAC-authenticated CLOB API + heartbeat
│   │   ├── data-client.ts        # Public Data API (positions, trades, PnL)
│   │   ├── service.ts            # Order signing, proxy wallet management
│   │   ├── actions.ts            # 8 elizaOS actions
│   │   └── index.ts              # Plugin export
│   ├── jupiter-prediction/       # 5 Jupiter actions + scanner
│   │   ├── types.ts              # Market/order schemas, micro-USD helpers
│   │   ├── api.ts                # Jupiter REST client with retry
│   │   ├── scanner.ts            # Market scoring (spread, midpoint, depth)
│   │   ├── service.ts            # Solana transaction signing
│   │   ├── actions.ts            # 5 elizaOS actions
│   │   └── index.ts              # Plugin export
│   ├── x402-solana/              # x402 payment protocol
│   │   ├── types.ts              # Config, cap exceeded error
│   │   ├── service.ts            # Fetch wrapper, payment tracking
│   │   └── index.ts              # Plugin export
│   ├── rag/                      # RAG pipeline with ChromaDB
│   │   ├── types.ts              # Document types, config, schemas
│   │   ├── chroma-client.ts      # ChromaDB REST client
│   │   ├── embeddings.ts         # OpenAI embedding client
│   │   ├── service.ts            # Indexing, similarity search, enrichment
│   │   └── index.ts              # Plugin export
│   └── connectors/               # News + Search data enrichment
│       ├── types.ts              # NewsAPI, Tavily schemas
│       ├── news-client.ts        # NewsAPI client
│       ├── search-client.ts      # Tavily search client
│       ├── service.ts            # Combined context provider
│       └── index.ts              # Plugin export
├── web/                          # Next.js frontend
│   ├── app/
│   │   ├── globals.css           # Green/black terminal theme
│   │   ├── layout.tsx            # Kode Mono font, metadata
│   │   ├── page.tsx              # 3-panel layout + dashboard orchestrator
│   │   └── docs/page.tsx         # Documentation page
│   ├── components/
│   │   ├── header.tsx            # [ALL] [POLY] [JUP+x402] toggles + x402 badge
│   │   ├── left-sidebar.tsx      # Agent/Portfolio/Activity tabs
│   │   ├── center-chat.tsx       # Chat messages + input
│   │   ├── right-sidebar.tsx     # Plugins + quick actions
│   │   ├── message.tsx           # User/agent/action message bubbles
│   │   ├── dashboard.tsx         # Whale analytics dashboard
│   │   ├── whale-card.tsx        # Whale wallet card
│   │   ├── whale-modal.tsx       # Whale detail popup
│   │   ├── plugin-modal.tsx      # Plugin detail popup
│   │   ├── x402-modal.tsx        # x402 payment details popup
│   │   └── animated.tsx          # Framer Motion wrappers
│   └── lib/
│       ├── types.ts              # Shared TypeScript types
│       ├── ws-client.ts          # WebSocket React hook (per-platform autonomy)
│       ├── keys.ts               # localStorage key management
│       └── polymarket-api.ts     # Client-side Polymarket API
├── Dockerfile.ws                 # WS server container
├── Dockerfile.x402               # x402 API container
└── web/Dockerfile                # Next.js container
```

---

## License

MIT
