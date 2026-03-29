# ElizaBAO — Autonomous Prediction Market Trading Agent

An **AI-powered autonomous trading agent** that scans, analyzes, buys, and sells across **Polymarket** (Polygon) and **Jupiter Prediction Markets** (Solana), with **x402** payment protocol for accessing paid APIs.

Built on [elizaOS](https://github.com/elizaos/eliza) with a custom web dashboard.

**Live Demo**: [elizabao.xyz](https://elizabao.xyz)

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
│  │  │              │ │ (4 tools)    │ │                 │ │ │
│  │  │ Buy, Sell,   │ │ Scan, Bet,   │ │ Wraps fetch()   │ │ │
│  │  │ Cancel, PnL  │ │ Positions,   │ │ Pays 402 APIs   │ │ │
│  │  │ Positions,   │ │ Claim        │ │ via Solana USDC  │ │ │
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

### Jupiter Prediction (4 actions)

| Action | Description |
|--------|-------------|
| `SCAN_JUPITER_MARKETS` | Scan live Solana prediction markets |
| `PLACE_JUPITER_BET` | Place a bet on a Jupiter market |
| `CHECK_JUPITER_POSITIONS` | Check positions and PnL |
| `CLAIM_JUPITER_WINNINGS` | Claim settled positions |

**Chain**: Solana | **Auth**: Jupiter API key + Solana wallet

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

The autonomy engine runs a cycle every 60 seconds, alternating between platforms:

**Cycle 1 — Polymarket (Polygon):**
1. Check positions → sell losers (>30% down) and take profit (>50% up)
2. Scan 500+ markets → score by spread, midpoint, volume, time to expiry
3. Filter out owned markets → pick from top 5 new opportunities
4. Calculate bet size based on conviction score and balance
5. Place order on Polymarket

**Cycle 2 — Jupiter (Solana + x402):**
1. Pay for market analysis via x402 ($0.01 USDC on Solana)
2. Check Jupiter positions → flag losers
3. Scan 30+ Jupiter events → score by spread, midpoint, volume
4. Pick best new market → place bet via Solana
5. Report x402 payment status

### Smart Features

| Feature | How It Works |
|---------|-------------|
| **Dynamic sizing** | $3-$6 per bet based on score (high conviction = bigger bet) |
| **Balance-aware** | Never bets more than 10% of available balance |
| **Time filtering** | Skips markets expiring within 24 hours |
| **No repeats** | Tracks all owned positions, never buys same market twice |
| **Trade cooldown** | Won't re-trade same market within 5 minutes |
| **Max positions** | Caps at 50 open positions |
| **Heartbeat** | Sends signal every 10s — orders auto-cancel on crash |
| **Persistence** | Keeps running when browser disconnects |

### Scoring Algorithm

Each market is scored 0-1 using 4 weighted factors:

```
Score = Spread(35%) + Midpoint(30%) + Time(20%) + Volume(15%)

Spread:   1 - (spread / 0.15)         → tighter spread = better
Midpoint: 1 - |midpoint - 0.5| × 2    → closer to 50/50 = more opportunity
Time:     min(1, daysLeft / 30)        → prefer 30+ days to expiry
Volume:   min(1, volume / threshold)   → prefer liquid markets
```

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
│   ├── jupiter-prediction/       # 4 Jupiter actions
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
