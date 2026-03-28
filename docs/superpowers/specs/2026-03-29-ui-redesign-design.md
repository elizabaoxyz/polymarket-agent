# UI Redesign — ElizaBao-Style 3-Panel Layout (Green/Black)

> Complete UI overhaul: 3-panel layout with live Polymarket data, whale analytics dashboard, and green/black theme inspired by elizabao.xyz.

## Layout

```
┌─────────────────────────────────────────────────────────────────────┐
│ HEADER BAR — logo, agent name, wallet address, connection status    │
├──────────────┬──────────────────────────────┬───────────────────────┤
│ LEFT SIDEBAR │       CENTER CHAT             │ RIGHT SIDEBAR         │
│  (240px)     │      (flex grow)              │   (260px)             │
│              │                               │                       │
│ AGENT INFO   │  Avatar + Agent Name          │ PLUGINS ENABLED (3)   │
│ - Name       │                               │ - Polymarket  ● active│
│ - Wallet     │  Chat bubbles                 │ - Jupiter     ● active│
│ - Chains     │  (green agent / dark user)    │ - x402        ● active│
│ - Status     │                               │                       │
│              │                               │ QUICK ACTIONS          │
│ PORTFOLIO    │                               │ [Scan Markets]         │
│ - Balance    │                               │ [Show Positions]       │
│ - # Positions│                               │ [Place $3 Bet]         │
│ - PnL        │                               │ [Show PnL]             │
│              │                               │ [Scan Jupiter]         │
│ LIVE FEED    │  Message input bar            │ [Show Trades]          │
│ - BUY 5 YES  │                               │                       │
│ - SELL 3 NO  │                               │                       │
│ - BUY 10 YES │                               │                       │
└──────────────┴──────────────────────────────┴───────────────────────┘
┌─────────────────────────────────────────────────────────────────────┐
│                     WHALE ANALYTICS DASHBOARD                        │
│                                                                      │
│  $ 24H_VOLUME  │  ↔ TXS    │  🐋 WHALES  │  📊 AVG                 │
│  $5.87M        │  400      │  257         │  $14.7K                  │
│                                                                      │
│  → BUY_PRESSURE ████████████████░░░░  SELL_PRESSURE ←                │
│    $4.44M (76%)                        $1.43M (24%)                  │
│                                                                      │
│  → YES_OUTCOME ████████████████░░░░░  NO_OUTCOME ←                   │
│    $3.2M (55%)                         $2.6M (45%)                   │
│                                                                      │
│  → LARGEST_BUY              │  → LARGEST_SELL                        │
│    $233.8K                  │    $55.0K                              │
│                                                                      │
│  🐋 WHALE_WALLETS (15)                                               │
│  ┌─────────────┐ ┌─────────────┐ ┌─────────────┐                    │
│  │ @luFei1231  │ │ @gfuead     │ │ @0x358...    │                    │
│  │ Wrong-Bala  │ │ High-Level  │ │ Oblang-Salt  │                    │
│  │ VOL: $4.11M │ │ VOL: $3.90M │ │ VOL: $3.79M │                    │
│  │ 0xe1d6...   │ │ 0x3ef4...   │ │ 0x3585...   │                    │
│  │[View on PM] │ │[View on PM] │ │[View on PM] │                    │
│  └─────────────┘ └─────────────┘ └─────────────┘                    │
│  (click any whale card → popup with full details)                    │
└─────────────────────────────────────────────────────────────────────┘
```

## Color Scheme

| Element | Color | CSS Variable |
|---------|-------|-------------|
| Background (page) | `#0a0a0a` | `--bg` |
| Background (panels) | `#111111` | `--bg-panel` |
| Background (cards) | `#1a1a1a` | `--bg-card` |
| Borders | `#222222` | `--border` |
| Primary accent (green) | `#00d4aa` | `--accent` |
| Accent hover | `#00b894` | `--accent-hover` |
| Text primary | `#e0e0e0` | `--text` |
| Text secondary | `#666666` | `--text-secondary` |
| Text muted | `#444444` | `--text-muted` |
| Success / Buy / YES | `#00d4aa` | `--green` |
| Error / Sell / NO | `#ff4757` | `--red` |
| User bubble bg | `#1a1a1a` | `--bg-card` |
| Agent bubble bg | `#0a2a1a` (dark green tint) | `--bg-agent` |
| Input bg | `#111111` | `--bg-panel` |
| Monospace font | JetBrains Mono / monospace | — |

## File Structure

```
web/
  app/
    globals.css               — Green/black theme, all CSS variables
    layout.tsx                — Root layout (dark bg, fonts)
    page.tsx                  — 3-panel layout + dashboard orchestrator
  components/
    header.tsx                — Top bar (green accent, wallet, status)
    left-sidebar.tsx          — Agent info + portfolio + live feed
    center-chat.tsx           — Chat messages + input (dark theme)
    message.tsx               — Dark-themed message bubbles
    right-sidebar.tsx         — Plugins list + quick action buttons
    dashboard.tsx             — Stats bar + pressure bars + whale grid
    whale-card.tsx            — Single whale card in the grid
    whale-modal.tsx           — Popup with whale details + trade history
  lib/
    types.ts                  — All types (existing + whale/market types)
    ws-client.ts              — WebSocket hook (existing)
    keys.ts                   — Key management (existing)
    polymarket-api.ts         — Direct Polymarket API calls for dashboard data
```

## Components

### header.tsx
- Full-width black bar, green accent
- Left: Green dot + "POLYAGENT" in monospace caps + contract/wallet address (shortened)
- Right: Connection status dot, Settings gear icon (if needed)

### left-sidebar.tsx
- **Agent Info section**: Agent name, wallet (shortened + copy), chains (Polygon ● / Solana ●), realtime status
- **Portfolio section**: USDC balance (green monospace), position count, PnL
- **Live Feed section**: Scrolling list of recent trades from WebSocket action_results. Each entry: shortened wallet + BUY/SELL + amount. Green for BUY, red for SELL. New entries slide in from top.

### center-chat.tsx
- Dark background (`#0a0a0a`)
- Agent messages: dark green tint background (`#0a2a1a`), green label "POLYAGENT"
- User messages: dark card background (`#1a1a1a`), aligned right
- Action results: bordered with green left-accent, monospace text
- Input bar: dark background, green send button, monospace placeholder
- Thinking indicator: green pulsing dots

### message.tsx
- User: right-aligned, `#1a1a1a` bg, light text
- Agent: left-aligned, `#0a2a1a` bg with subtle green border, green "POLYAGENT" label
- Action: left-aligned, `#111111` bg with green left border, monospace green text
- Timestamps in `#444444`

### right-sidebar.tsx
- **Plugins section**: List of 3 plugins with green active dot and tool count
  - Polymarket ● active — N tools
  - Jupiter ● active — N tools
  - x402 ● active — N tools
- **Quick Actions section**: Green-bordered buttons that inject prompts into chat
  - "Scan Markets" → "place a $3 YES bet on polymarket on something interesting"
  - "Show Positions" → "show my positions"
  - "Place $3 Bet" → "buy $3 YES on something interesting"
  - "Show PnL" → "show me my pnl on polymarket"
  - "Scan Jupiter" → "scan jupiter prediction markets on solana"
  - "Show Trades" → "show my recent trades"

### dashboard.tsx
Fetches data from Polymarket APIs on mount + every 30 seconds.

**Stats row**: 4 cards
- 24H Volume: sum of `usdcSize` from global trades
- Transactions: count of trades
- Whales: unique wallets with volume > $1000
- Avg Trade: average `usdcSize`

**Pressure bars**: 2 horizontal bars
- Buy/Sell: green portion = buy volume, red portion = sell volume, percentages
- YES/NO: green portion = YES outcome volume, red portion = NO outcome volume

**Largest trades**: 2 cards
- Largest Buy: biggest single BUY trade amount
- Largest Sell: biggest single SELL trade amount

**Whale Wallets grid**: 3-column grid of whale cards
- Fetched from `GET https://data-api.polymarket.com/trades?limit=200`
- Grouped by `proxyWallet`, summed by `usdcSize`
- Sorted by total volume descending
- Top 15 displayed

### whale-card.tsx
Each card shows:
- Name (from trade data `name` field) + copy icon
- Pseudonym (from `pseudonym` field)
- Volume: total USD traded (green monospace)
- Wallet: shortened proxy address
- "View on Polymarket" green button → opens `polymarket.com/profile/WALLET`
- **Click card → opens whale-modal.tsx**

### whale-modal.tsx
Full-screen dark modal overlay:
- **Header**: Name, pseudonym, wallet (full, copyable)
- **Stats**: Total volume, trade count, buy/sell ratio
- **Trade History table**: market title, side (BUY green / SELL red), size, price, outcome, time ago
- **"View on Polymarket" button** → external link
- Close button (X)

## Data Sources

### polymarket-api.ts
New utility for fetching public Polymarket data (no auth needed):

```typescript
// Global trades (for dashboard stats + whale detection)
async function getGlobalTrades(limit: number): Promise<Trade[]>
// GET https://data-api.polymarket.com/trades?limit=N

// Top markets by volume
async function getTopMarkets(limit: number): Promise<Market[]>
// GET https://gamma-api.polymarket.com/markets?order=volume&active=true&closed=false&limit=N

// Trades for a specific wallet (for whale modal)
async function getWalletTrades(wallet: string, limit: number): Promise<Trade[]>
// GET https://data-api.polymarket.com/activity?user=WALLET&limit=N
```

All client-side fetches (from the Next.js app in the browser). No server needed for public data.

### WebSocket (existing)
- Agent chat messages
- Portfolio status (balance, positions, trades) via `get_status`
- Action results feed the left sidebar live feed

## Data Flow

1. **Page loads** → fetch global trades + top markets from Polymarket APIs (client-side)
2. **WebSocket connects** → sends auth (if multi-user) or connects directly
3. **Every 30s** → refresh global trades for dashboard stats
4. **User sends message** → WebSocket → agent → action_result → appears in chat + live feed
5. **User clicks Positions/Trades** → WebSocket `get_status` → updates left sidebar
6. **User clicks whale card** → fetch wallet trades from Data API → show in modal
7. **Quick action clicked** → inject prompt text into chat input, auto-send

## Responsive Behavior

- **Desktop (>1200px)**: Full 3-panel + dashboard
- **Tablet (768-1200px)**: Sidebars collapse to icons, expand on click
- **Mobile (<768px)**: Single column, chat only, bottom nav for sidebars/dashboard

## Scope

**In scope:**
- Complete 3-panel layout with green/black theme
- Live Polymarket global trades for dashboard
- Whale detection from trade data (volume > $1000)
- Whale popup with trade history
- Quick action buttons
- Plugin status display
- Live feed in left sidebar
- Stats bars (buy/sell pressure, YES/NO)

**Out of scope:**
- WebSocket for real-time trade streaming (polling every 30s instead)
- Historical charting
- Market-specific deep dive pages
- Mobile-first design (desktop primary)
