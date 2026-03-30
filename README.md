# ElizaBAO — Autonomous Prediction Market Trading Agent

An **AI-powered autonomous trading agent** that scans, analyzes, buys, and sells across **Polymarket** (Polygon) and **Jupiter Prediction Markets** (Solana), with **x402** payment protocol for accessing paid APIs.

Built on [elizaOS](https://github.com/elizaos/eliza) with a custom web dashboard.

**Live Demo**: [elizabao.ai](https://elizabao.ai)

---

## What It Does

ElizaBAO is a fully autonomous prediction market trader that:

1. **Scans** 500+ markets across Polymarket and Jupiter every 60 seconds
2. **Scores** each market by spread tightness, midpoint proximity, volume, and time to expiry
3. **Buys** the best opportunities with smart position sizing ($3-$6 based on conviction)
4. **Sells** losers (down >30%) and takes profit on winners (up >50%)
5. **Pays** for premium market data via x402 protocol on Solana
6. **Alternates** between Polymarket (Polygon) and Jupiter (Solana) each cycle
7. **Protects** open orders with Polymarket heartbeat (auto-cancels if agent crashes)
8. **Never repeats** — tracks owned positions and diversifies into new markets
9. **Runs 24/7** — autonomy persists even when browser disconnects

---

## Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                     NEXT.JS WEB APP (port 3000)              │
│  ┌──────────┬─────────────────────────┬──────────────────┐  │
│  │  Left    │     Center Chat          │   Right          │  │
│  │  Sidebar │  (agent messages,        │   Sidebar        │  │
│  │          │   trade results,         │  (plugins,       │  │
│  │ Agent    │   autonomy logs)         │   quick actions) │  │
│  │ Portfolio│                          │                  │  │
│  │ Live Feed│                          │                  │  │
│  └──────────┴─────────────────────────┴──────────────────┘  │
│  ┌──────────────────────────────────────────────────────┐    │
│  │            WHALE ANALYTICS DASHBOARD                  │    │
│  │  Volume | Trades | Whales | Buy/Sell Pressure         │    │
│  └──────────────────────────────────────────────────────┘    │
└──────────────────────────┬──────────────────────────────────┘
                           │ WebSocket
┌──────────────────────────▼──────────────────────────────────┐
│                  BUN WEBSOCKET SERVER (port 3001)             │
│                                                              │
│  ┌─────────────┐  ┌──────────────┐  ┌────────────────────┐  │
│  │ elizaOS     │  │ Autonomy     │  │ Heartbeat          │  │
│  │ Runtime     │  │ Loop (60s)   │  │ Loop (10s)         │  │
│  │             │  │              │  │                    │  │
│  │ - Plugins   │  │ Cycle 1:     │  │ POST /v1/heartbeats│  │
│  │ - Actions   │  │  Polymarket  │  │ (keeps GTC orders  │  │
│  │ - Services  │  │ Cycle 2:     │  │  alive)            │  │
│  │             │  │  Jupiter+x402│  │                    │  │
│  └─────────────┘  └──────────────┘  └────────────────────┘  │
│                                                              │
│  ┌─────────────────────────────────────────────────────────┐ │
│  │                    PLUGINS                               │ │
│  │  ┌──────────────┐ ┌──────────────┐ ┌─────────────────┐ │ │
│  │  │ polymarket-  │ │ jupiter-     │ │ x402-solana     │ │ │
│  │  │ ext (8 tools)│ │ prediction   │ │ (auto-pay)      │ │ │
│  │  │              │ │ (5 tools)    │ │                 │ │ │
│  │  │ Buy, Sell,   │ │ Scan, Bet,   │ │ Wraps fetch()   │ │ │
│  │  │ Cancel, PnL  │ │ Sell, Claim, │ │ Pays 402 APIs   │ │ │
│  │  │ Positions,   │ │ Positions    │ │ via Solana USDC  │ │ │
│  │  │ Trades,      │ │              │ │                 │ │ │
│  │  │ Open Orders  │ │              │ │ Cap: $0.10/req   │ │ │
│  │  └──────────────┘ └──────────────┘ └─────────────────┘ │ │
│  └─────────────────────────────────────────────────────────┘ │
└──────────────────────────────────────────────────────────────┘
```

---

## Plugins

### Polymarket Extended (8 actions)

| Action | Description |
|--------|-------------|
| `POLYMARKET_PLACE_ORDER` | Buy/sell with smart market search and token resolution |
| `POLYMARKET_CANCEL_ORDER` | Cancel a specific order by ID |
| `POLYMARKET_CANCEL_ALL` | Cancel all open orders |
| `POLYMARKET_GET_ORDERS` | List open orders |
| `POLYMARKET_SELL` | Sell shares at best bid price |
| `POLYMARKET_GET_POSITIONS` | Show portfolio positions with PnL |
| `POLYMARKET_GET_TRADES` | Show recent trade history |
| `POLYMARKET_GET_PNL` | Show profit/loss summary |

**Chain**: Polygon | **Auth**: CLOB API keys + EVM wallet | **Signature Type**: POLY_PROXY (type 1)

### Jupiter Prediction (5 actions)

| Action | Description |
|--------|-------------|
| `SCAN_JUPITER_MARKETS` | Scan live Solana prediction markets |
| `PLACE_JUPITER_BET` | Place a bet on a Jupiter market |
| `CHECK_JUPITER_POSITIONS` | Check positions and PnL |
| `SELL_JUPITER_POSITION` | Sell/close a position by market ID or position pubkey |
| `CLAIM_JUPITER_WINNINGS` | Claim settled positions |

**Chain**: Solana | **Auth**: Jupiter API key (`x-api-key` header) + Solana wallet

**Jupiter Prediction API endpoints** (base: `https://api.jup.ag/prediction/v1`):

| Method | Endpoint | Description |
|--------|----------|-------------|
| `GET` | `/events?status=live` | List live prediction events with markets |
| `GET` | `/orderbook/{marketId}` | Get order book for a market |
| `POST` | `/orders` | Place a buy order (`isBuy: true` always) |
| `GET` | `/positions?ownerPubkey={pk}` | Get open positions with PnL |
| `DELETE` | `/positions/{positionPubkey}` | Close/sell entire position (requires `ownerPubkey` in body) |
| `DELETE` | `/positions` | Close all positions (requires `ownerPubkey` in body) |
| `POST` | `/positions/{positionPubkey}/claim` | Claim payout after settlement (requires `ownerPubkey` in body) |

> **Note:** Selling on Jupiter is done via `DELETE /positions`, not `isBuy=false`. There are no partial sells — only full position closure. Winning positions auto-claim after 24h if unclaimed.

### x402 Solana (auto-pay protocol)

| Feature | Description |
|---------|-------------|
| `wrapFetchWithPayment()` | Wraps all HTTP calls to detect 402 responses |
| `ExactSvmScheme` | Signs Solana USDC payment transactions |
| `onBeforePaymentCreation` | Validates payment cap, tracks spending |
| Payment tracking | Count, total USD, timestamped log |

**Chain**: Solana mainnet + devnet | **Asset**: USDC | **Cap**: $0.10/request

---

## Autonomous Trading

### How It Works

The autonomy engine (`ws-server.ts`) runs an infinite loop with a **60-second interval**, alternating between Polymarket (Polygon) and Jupiter (Solana) every cycle. The user toggles it ON/OFF from the web dashboard header — once started, it **persists even when the browser disconnects** (the WebSocket close handler does not stop the timer). Only an explicit "AUTONOMY OFF" click stops it.

```
┌──────────────────────────────────────────────────────┐
│                   AUTONOMY LOOP                       │
│                                                      │
│  ┌─────────┐     ┌─────────────┐     ┌────────────┐ │
│  │ Toggle   │────▶│  Cycle #1   │────▶│  Cycle #2  │ │
│  │ ON       │     │ POLYMARKET  │     │  JUPITER   │ │
│  │ (user)   │     │ (Polygon)   │     │ (Solana)   │ │
│  └─────────┘     └──────┬──────┘     └──────┬─────┘ │
│                         │  60s               │  60s   │
│                         └────────────────────┘        │
│                         repeats forever               │
└──────────────────────────────────────────────────────┘
```

When autonomy starts, three things happen simultaneously:
1. **x402 payment protocol** is activated — wraps `globalThis.fetch` so any 402 response from Jupiter/Solana APIs auto-pays with USDC
2. **Heartbeat loop** starts (10-second interval) — keeps Polymarket GTC orders alive
3. **First autonomy cycle** runs immediately, then every 60 seconds

### Cycle 1 — Polymarket (Polygon)

```
SELL PHASE → SCAN PHASE → FILTER PHASE → LLM ANALYSIS → BUY PHASE
```

**Step 1 — Collect & Sell:**
- Fetch all positions from Polymarket Data API (`/positions?user={proxyWallet}`)
- Build an `ownedTitles` set (lowercase market titles) for deduplication
- Identify sell targets: positions **down >15%** (cut loss) or **up >25%** (take profit)
- Skip dead markets (price < $0.02 or already redeemable)
- Execute sells via elizaOS action `POLYMARKET_SELL` — sells at best bid price from order book

**Step 2 — Smart Scan:**
- Fetch all active markets from Polymarket CLOB (`/sampling-markets`)
- Filter: must be `active`, not `closed`, `accepting_orders`
- Filter: YES price must be between $0.10–$0.90 (skip near-certain outcomes)
- Filter: remove any market already in `ownedTitles`
- Filter: remove any market traded in the last 5 minutes (cooldown)
- Filter: remove markets expiring within 24 hours
- Score each remaining market (see Scoring Algorithm below)

**Step 3 — LLM Market Analysis:**
- Take top 5 scored candidates
- Send all 5 to the LLM with prices, scores, and days left
- LLM analyzes each market question considering **current events, probability, and value**
- LLM responds with: `PICK: <number>`, `SIDE: <YES/NO>`, `REASON: <why this side will win>`
- Falls back to price-based heuristic if LLM parsing fails

Example LLM analysis flow:
```
[ANALYSIS] Analyzing top 5 markets...
  1. "Will bitcoin hit $1m before GTA VI?" — YES: $0.49, NO: $0.51, score: 0.80, 123 days left
  2. "2026 Balance of Power: D Senate, D House" — YES: $0.49, NO: $0.51, score: 0.80, 218 days left
  ...
[ANALYSIS] Bitcoin is unlikely to reach $1m in 4 months given current market conditions.
[BUY:POLYMARKET] "2026 Balance of Power: D Senate, D House" (YES:$0.49, $3.00, 218d left)
```

**Step 4 — Buy:**
- Calculate bet size: `$3–$6` based on score and balance (see Position Sizing)
- Use the LLM's chosen side (YES/NO) instead of price-based heuristic
- Execute via elizaOS action `POLYMARKET_PLACE_ORDER`
- Record in `tradeHistory` for cooldown tracking

### Cycle 2 — Jupiter (Solana + x402)

Same structure as Polymarket but on Solana:

**Step 1 — x402 Payment:**
- If `X402_API_URL` is set, calls the payment-gated `/prediction` endpoint
- x402 protocol auto-detects the 402 response, signs a Solana USDC transaction, and retries
- Cost: $0.01 per prediction, $0.02 per analysis

**Step 2 — Collect & Sell:**
- Fetch positions from Jupiter API (`GET /positions?ownerPubkey={wallet}`)
- Each position includes `pnlUsdPercent` — the agent knows if it's winning or losing
- Identify sell targets: positions **down >15%** (cut loss) or **up >25%** (take profit)
- Sells directly via API: `DELETE /positions/{positionPubkey}` with `ownerPubkey` (bypasses LLM routing)
- Jupiter closes the entire position (no partial sells) — contracts are sold back and USDC returned

**Step 3 — Smart Scan:**
- Fetch live events from Jupiter (`/events?status=live`)
- Score each market's spread, midpoint, and volume
- Jupiter uses higher volume threshold ($10,000) and heavier volume weight (35% vs 15%)

**Step 4 — LLM Market Analysis:**
- Same as Polymarket: top 5 candidates sent to LLM for analysis
- LLM picks the best market and side (YES/NO) with reasoning
- Falls back to price-based heuristic if parsing fails

**Step 5 — Buy:**
- Minimum bet: $3 on both platforms
- Execute via elizaOS action `PLACE_JUPITER_BET`

### Scoring Algorithm

Each market is scored 0–1 using weighted factors. The weights differ slightly between platforms:

**Polymarket scoring (spread-focused):**
```
Score = Spread(35%) + Midpoint(30%) + Time(20%) + Volume(15%)
```

**Jupiter scoring (volume-focused):**
```
Score = Spread(35%) + Midpoint(30%) + Volume(35%)
```

| Factor | Formula | Why |
|--------|---------|-----|
| **Spread** | `max(0, 1 - spread / 0.15)` | Tighter spread = less slippage, better liquidity |
| **Midpoint** | `1 - abs(midpoint - 0.5) × 2` | 50/50 markets = maximum uncertainty = most opportunity |
| **Time** | `min(1, daysLeft / 30)` | Markets with 30+ days give time to play out |
| **Volume** | `min(1, volume / threshold)` | Higher volume = reliable pricing, easier exits |

Markets scoring below **0.6** are skipped entirely — only high-quality opportunities get bets.

### Position Sizing

Bet size scales with conviction (score) and available balance:

```
Score > 0.9  →  $6  or 10% of balance (whichever is lower)
Score > 0.7  →  $4.50 or 8% of balance
Score ≤ 0.7  →  $3  or 5% of balance
```

The balance cap prevents blowing up on a single trade. Minimum bet is $3 on both platforms. If balance drops below $3, the agent stops buying and waits for sells to replenish.

### Smart Features

| Feature | How It Works |
|---------|-------------|
| **Alternating platforms** | Odd cycles = Polymarket (Polygon), even cycles = Jupiter (Solana) |
| **Sell before buy** | Always evaluates exits first — frees up capital for new bets |
| **Aggressive sell thresholds** | Cut loss at -15%, take profit at +25% — locks in gains and exits losers fast |
| **LLM market analysis** | Top 5 candidates analyzed by LLM — picks market AND side with reasoning |
| **Dynamic sizing** | $3–$6 based on score × balance cap (minimum $3 both platforms) |
| **No repeats** | Tracks `ownedTitles` set, deduplicates across both platforms |
| **Trade cooldown** | 5-minute cooldown per market to avoid churning |
| **Max 50 positions** | Stops buying when position count hits cap |
| **Direct Jupiter sells** | Calls `DELETE /positions/{pubkey}` directly — bypasses LLM routing for reliability |
| **Persistence** | Timer survives browser disconnect — only stops on explicit OFF |
| **Trade history** | Rolling log of last 100 trades for cooldown + analytics |

---

## Heartbeat Protocol

### Why Heartbeats Exist

Polymarket uses **GTC (Good-Til-Cancelled) limit orders** that live on their CLOB (Central Limit Order Book). To prevent orphaned orders from agents that crash, Polymarket requires a **heartbeat signal every 10 seconds**. If the heartbeat stops, all open orders are **automatically cancelled** — protecting the user from stale orders sitting on the book.

### How It Works

```
┌──────────────┐        ┌───────────────────────┐
│  Agent        │  10s   │  Polymarket CLOB       │
│  (ws-server)  │───────▶│  POST /v1/heartbeats   │
│               │        │                       │
│  heartbeat_id │◀───────│  { heartbeat_id: "x" } │
│  = "x"        │        │                       │
│               │  10s   │                       │
│  { heartbeat_ │───────▶│  Session alive ✓       │
│    id: "x" }  │        │                       │
│               │        │                       │
│  [crash/stop] │   ✗    │  No heartbeat for 10s  │
│               │        │  → Cancel all orders   │
└──────────────┘        └───────────────────────┘
```

**Session lifecycle:**

1. **Start** — When autonomy turns ON, `clob.resetHeartbeat()` clears any stale session ID, then sends the first heartbeat with `heartbeat_id: null`
2. **Create** — Polymarket responds with a new `heartbeat_id` string (e.g., `"abc123"`)
3. **Chain** — Every subsequent heartbeat sends back the **same** `heartbeat_id` to keep the session alive
4. **Stale recovery** — If Polymarket rejects a heartbeat ID (session expired), the client automatically resets to `null` and creates a new session
5. **Stop** — When autonomy turns OFF, the heartbeat timer is cleared. Polymarket detects the missing heartbeat and cancels all GTC orders

### Implementation Details

The heartbeat is implemented in `plugins/polymarket-ext/clob-client.ts`:

```typescript
// Authenticated POST to /v1/heartbeats
// Uses HMAC-SHA256 L2 auth with URL-safe base64
async heartbeat(): Promise<void> {
  const body = { heartbeat_id: this.heartbeatId }; // null on first call
  const response = await this.post("/v1/heartbeats", body);

  // Save the returned ID for subsequent calls
  if (data.heartbeat_id) {
    this.heartbeatId = data.heartbeat_id;
  }
}
```

**Authentication:** Each heartbeat is signed with HMAC-SHA256 using the CLOB API secret, with URL-safe base64 encoding (`+`→`-`, `/`→`_`). The signature covers: `timestamp + "POST" + "/v1/heartbeats" + body`.

**Timer management in ws-server.ts:**
- `autonomyHeartbeatTimer = setInterval(() => heartbeat(), 10_000)` — runs every 10 seconds
- On autonomy stop: `clearInterval(autonomyHeartbeatTimer)` — stops heartbeat, orders auto-cancel
- On error: logs warning but doesn't crash — next interval retries

---

## Web Dashboard

ElizaBAO-style 3-panel layout with green/black theme:

- **Left sidebar**: Agent info, portfolio (Polymarket + Jupiter balances), live whale feed
- **Center chat**: Talk to the agent, see autonomy logs and trade results
- **Right sidebar**: Plugin status (3 plugins, tool counts), quick action buttons
- **Bottom dashboard**: Whale analytics — 24h volume, trade count, buy/sell pressure, whale wallets
- **Header**: Autonomy ON/OFF toggle, x402 payment badge (click for details)
- **Animations**: Dot grid background, scanline effect, green glow, hover effects

### Modals

- **Plugin modal**: Click any plugin → shows version, tools, MCP endpoint, config
- **Whale modal**: Click any whale card → shows trade history, volume, Polymarket profile link
- **x402 modal**: Click x402 badge → shows payment count, total spent, how it works

---

## Setup

### Environment Variables

```bash
# LLM (at least one required)
OPENAI_API_KEY=sk-...

# Polymarket (Polygon)
EVM_PRIVATE_KEY=0x...
CLOB_API_KEY=...
CLOB_API_SECRET=...
CLOB_API_PASSPHRASE=...
POLYMARKET_FUNDER_ADDRESS=0x...     # Proxy wallet address
POLYMARKET_SIGNATURE_TYPE=1          # 1 = POLY_PROXY

# Jupiter (Solana)
JUPITER_API_KEY=...
SOLANA_PRIVATE_KEY=...               # Base58
SOLANA_RPC_URL=https://api.mainnet-beta.solana.com

# x402
X402_ENABLED=true
X402_MAX_PAYMENT_USD=0.10
X402_API_URL=https://your-x402-server.railway.app  # Optional

# Server
WS_PORT=3001
```

### Local Development

```bash
# Terminal 1: WebSocket server
bun run ws-server.ts

# Terminal 2: Next.js web app
cd web && npm install && npm run dev

# Open http://localhost:3000
```

### Railway Deployment

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
| Frontend | Next.js 15, Tailwind CSS, Framer Motion |
| Icons | Lucide React |
| Font | Kode Mono |
| Polymarket | `@polymarket/clob-client`, CLOB REST API, Data API |
| Jupiter | Jupiter Prediction API (`api.jup.ag/prediction/v1`) |
| x402 | `@x402/fetch`, `@x402/svm`, `@x402/core` |
| Wallet | ethers.js (Polygon), @solana/web3.js (Solana) |
| Validation | Zod |
| Testing | bun:test (130+ tests) |

---

## Project Structure

```
polymarket-agent/
├── ws-server.ts                  # Bun WebSocket server (autonomy + heartbeat)
├── runner.ts                     # CLI TUI runner
├── lib.ts                        # Shared utilities (LLM, env, config)
├── x402-test-server.ts           # x402 payment-gated API
├── plugins/
│   ├── polymarket-ext/           # 8 Polymarket actions + CLOB/Data clients
│   │   ├── types.ts              # Zod schemas, error classes
│   │   ├── clob-client.ts        # Authenticated CLOB API (HMAC L2)
│   │   ├── data-client.ts        # Public Data API
│   │   ├── service.ts            # Heartbeat, order signing, wallet
│   │   ├── actions.ts            # 8 elizaOS actions
│   │   └── index.ts              # Plugin export
│   ├── jupiter-prediction/       # 5 Jupiter actions
│   │   ├── types.ts              # Market/order schemas
│   │   ├── api.ts                # Jupiter REST client
│   │   ├── scanner.ts            # Market scoring
│   │   ├── service.ts            # Solana signing
│   │   ├── actions.ts            # 4 elizaOS actions
│   │   └── index.ts              # Plugin export
│   └── x402-solana/              # x402 payment protocol
│       ├── types.ts              # Config, cap error
│       ├── service.ts            # Fetch wrapper, payment tracking
│       └── index.ts              # Plugin export
├── web/                          # Next.js frontend
│   ├── app/
│   │   ├── globals.css           # Green/black theme
│   │   ├── layout.tsx            # Kode Mono font
│   │   └── page.tsx              # 3-panel layout orchestrator
│   ├── components/
│   │   ├── header.tsx            # Autonomy toggle, x402 badge
│   │   ├── left-sidebar.tsx      # Agent/Portfolio/Activity tabs
│   │   ├── center-chat.tsx       # Chat messages + input
│   │   ├── right-sidebar.tsx     # Plugins + quick actions
│   │   ├── message.tsx           # User/agent/action bubbles
│   │   ├── dashboard.tsx         # Whale analytics
│   │   ├── whale-card.tsx        # Whale wallet card
│   │   ├── whale-modal.tsx       # Whale detail popup
│   │   ├── plugin-modal.tsx      # Plugin detail popup
│   │   ├── x402-modal.tsx        # x402 payment details
│   │   └── animated.tsx          # Framer Motion wrappers
│   └── lib/
│       ├── types.ts              # Shared TypeScript types
│       ├── ws-client.ts          # WebSocket React hook
│       ├── keys.ts               # localStorage key management
│       └── polymarket-api.ts     # Client-side Polymarket API
├── Dockerfile.ws                 # WS server container
├── Dockerfile.x402               # x402 API container
└── web/Dockerfile                # Next.js container
```

---

## License

MIT
