# UI Redesign Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the current clean-light ChatGPT-style UI with an ElizaBao-inspired 3-panel layout (green/black theme) featuring live Polymarket whale analytics dashboard.

**Architecture:** 3-panel layout (left sidebar, center chat, right sidebar) + bottom whale analytics dashboard. New `polymarket-api.ts` client fetches public Polymarket data (global trades, markets) client-side. Dashboard polls every 30s. Whale cards open modals with trade history. Quick action buttons inject prompts into chat. Uses `lucide-react` for icons.

**Tech Stack:** Next.js 15, Tailwind CSS, lucide-react, Polymarket Data API + Gamma API

**Spec:** `docs/superpowers/specs/2026-03-29-ui-redesign-design.md`

---

## File Map

| File | Action | Responsibility |
|------|--------|---------------|
| `web/app/globals.css` | Rewrite | Green/black CSS variables, dark theme, animations |
| `web/app/layout.tsx` | Modify | Add JetBrains Mono font, dark body |
| `web/app/page.tsx` | Rewrite | 3-panel layout + dashboard orchestrator |
| `web/lib/types.ts` | Modify | Add whale/dashboard types |
| `web/lib/polymarket-api.ts` | Create | Client-side Polymarket API calls |
| `web/components/header.tsx` | Rewrite | Green/black header with wallet + icons |
| `web/components/left-sidebar.tsx` | Create | Agent info + portfolio + live feed |
| `web/components/center-chat.tsx` | Create | Dark-themed chat (replaces chat.tsx) |
| `web/components/message.tsx` | Rewrite | Dark-themed message bubbles |
| `web/components/right-sidebar.tsx` | Create | Plugins list + quick actions |
| `web/components/dashboard.tsx` | Create | Stats + pressure bars + whale grid |
| `web/components/whale-card.tsx` | Create | Single whale card |
| `web/components/whale-modal.tsx` | Create | Whale detail popup |
| `web/components/chat.tsx` | Delete | Replaced by center-chat.tsx |
| `web/components/portfolio-panel.tsx` | Delete | Replaced by left-sidebar + dashboard |

---

### Task 1: Install lucide-react + Rewrite Theme

**Files:**
- Modify: `web/package.json`
- Rewrite: `web/app/globals.css`
- Modify: `web/app/layout.tsx`

- [ ] **Step 1: Install lucide-react**

```bash
cd web && npm install lucide-react
```

- [ ] **Step 2: Rewrite globals.css with green/black theme**

Replace the entire `web/app/globals.css` with:

```css
@import "tailwindcss";

:root {
  --bg: #0a0a0a;
  --bg-panel: #111111;
  --bg-card: #1a1a1a;
  --bg-agent: #0a2a1a;
  --border: #222222;
  --accent: #00d4aa;
  --accent-hover: #00b894;
  --text: #e0e0e0;
  --text-secondary: #666666;
  --text-muted: #444444;
  --green: #00d4aa;
  --red: #ff4757;
}

body {
  font-family: var(--font-sans), system-ui, sans-serif;
  color: var(--text);
  background: var(--bg);
}

.mono {
  font-family: var(--font-mono), 'SF Mono', 'Fira Code', monospace;
}

/* Scrollbar */
::-webkit-scrollbar { width: 6px; }
::-webkit-scrollbar-track { background: var(--bg); }
::-webkit-scrollbar-thumb { background: var(--border); border-radius: 3px; }
::-webkit-scrollbar-thumb:hover { background: #333; }

/* Thinking animation */
@keyframes dot-pulse {
  0%, 80%, 100% { opacity: 0.3; }
  40% { opacity: 1; }
}
.thinking-dot {
  animation: dot-pulse 1.4s infinite ease-in-out;
}
.thinking-dot:nth-child(2) { animation-delay: 0.2s; }
.thinking-dot:nth-child(3) { animation-delay: 0.4s; }

/* Pressure bar gradient */
.pressure-bar-buy-sell {
  background: linear-gradient(90deg, var(--green) var(--buy-pct), var(--red) var(--buy-pct));
}
.pressure-bar-yes-no {
  background: linear-gradient(90deg, var(--green) var(--yes-pct), var(--red) var(--yes-pct));
}
```

- [ ] **Step 3: Update layout.tsx with monospace font + dark body**

```tsx
import type { Metadata } from "next";
import { Inter, JetBrains_Mono } from "next/font/google";
import "./globals.css";

const inter = Inter({ subsets: ["latin"], variable: "--font-sans" });
const jetbrains = JetBrains_Mono({ subsets: ["latin"], variable: "--font-mono" });

export const metadata: Metadata = {
  title: "Polyagent",
  description: "AI-powered Polymarket trading agent",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className="dark">
      <body className={`${inter.variable} ${jetbrains.variable} antialiased bg-[var(--bg)] text-[var(--text)]`}>
        {children}
      </body>
    </html>
  );
}
```

- [ ] **Step 4: Verify build**

```bash
cd web && npx next build
```

- [ ] **Step 5: Commit**

```bash
git add web/
git commit -m "feat(web): green/black theme with lucide-react icons"
```

---

### Task 2: Types + Polymarket API Client

**Files:**
- Modify: `web/lib/types.ts`
- Create: `web/lib/polymarket-api.ts`

- [ ] **Step 1: Add whale/dashboard types to types.ts**

Add to the end of `web/lib/types.ts`:

```typescript
// --- Whale / Dashboard types ---

export type GlobalTrade = {
  proxyWallet: string;
  side: string;
  asset: string;
  conditionId: string;
  size: number;
  usdcSize: number;
  price: number;
  timestamp: number;
  title: string;
  slug: string;
  outcome: string;
  name: string;
  pseudonym: string;
};

export type WhaleWallet = {
  address: string;
  name: string;
  pseudonym: string;
  totalVolume: number;
  tradeCount: number;
  buyVolume: number;
  sellVolume: number;
};

export type DashboardStats = {
  volume24h: number;
  transactions: number;
  whaleCount: number;
  avgTradeSize: number;
  buyVolume: number;
  sellVolume: number;
  yesVolume: number;
  noVolume: number;
  largestBuy: number;
  largestSell: number;
  whales: WhaleWallet[];
};
```

- [ ] **Step 2: Create polymarket-api.ts**

Create `web/lib/polymarket-api.ts`:

```typescript
import type { GlobalTrade, DashboardStats, WhaleWallet } from "./types";

const DATA_API = "https://data-api.polymarket.com";
const GAMMA_API = "https://gamma-api.polymarket.com";

export async function getGlobalTrades(limit = 200): Promise<GlobalTrade[]> {
  const res = await fetch(`${DATA_API}/trades?limit=${limit}`);
  if (!res.ok) return [];
  return res.json();
}

export async function getWalletTrades(wallet: string, limit = 50): Promise<GlobalTrade[]> {
  const res = await fetch(`${DATA_API}/activity?user=${wallet}&limit=${limit}`);
  if (!res.ok) return [];
  return res.json();
}

export function computeDashboardStats(trades: GlobalTrade[]): DashboardStats {
  let buyVolume = 0, sellVolume = 0, yesVolume = 0, noVolume = 0;
  let largestBuy = 0, largestSell = 0;
  const walletMap = new Map<string, WhaleWallet>();

  for (const t of trades) {
    const vol = t.usdcSize ?? t.size * t.price;
    if (t.side === "BUY") {
      buyVolume += vol;
      if (vol > largestBuy) largestBuy = vol;
    } else {
      sellVolume += vol;
      if (vol > largestSell) largestSell = vol;
    }
    if (t.outcome === "Yes") yesVolume += vol;
    else noVolume += vol;

    const existing = walletMap.get(t.proxyWallet);
    if (existing) {
      existing.totalVolume += vol;
      existing.tradeCount += 1;
      if (t.side === "BUY") existing.buyVolume += vol;
      else existing.sellVolume += vol;
    } else {
      walletMap.set(t.proxyWallet, {
        address: t.proxyWallet,
        name: t.name || t.proxyWallet.slice(0, 8),
        pseudonym: t.pseudonym || "",
        totalVolume: vol,
        tradeCount: 1,
        buyVolume: t.side === "BUY" ? vol : 0,
        sellVolume: t.side === "SELL" ? vol : 0,
      });
    }
  }

  const whales = Array.from(walletMap.values())
    .filter((w) => w.totalVolume > 1000)
    .sort((a, b) => b.totalVolume - a.totalVolume)
    .slice(0, 15);

  const totalVolume = buyVolume + sellVolume;
  return {
    volume24h: totalVolume,
    transactions: trades.length,
    whaleCount: whales.length,
    avgTradeSize: trades.length > 0 ? totalVolume / trades.length : 0,
    buyVolume,
    sellVolume,
    yesVolume,
    noVolume,
    largestBuy,
    largestSell,
    whales,
  };
}
```

- [ ] **Step 3: Commit**

```bash
git add web/lib/
git commit -m "feat(web): add polymarket API client and dashboard types"
```

---

### Task 3: Header Component

**Files:**
- Rewrite: `web/components/header.tsx`

- [ ] **Step 1: Rewrite header.tsx with green/black theme + lucide icons**

Full rewrite of `web/components/header.tsx`. Use `Settings`, `ExternalLink`, `LogIn` from `lucide-react`. Green monospace POLYAGENT logo, shortened wallet address with copy icon, connection status dot. Same props as before but dark-themed.

Key elements:
- Background: `bg-[var(--bg)]` with `border-b border-[var(--border)]`
- Logo: `text-[var(--accent)] font-mono font-bold tracking-widest`
- Wallet: `text-[var(--text-muted)] font-mono text-xs` with `Copy` icon button
- Status dot: green (`bg-[var(--green)]`) or red (`bg-[var(--red)]`)

- [ ] **Step 2: Commit**

```bash
git add web/components/header.tsx
git commit -m "feat(web): dark header with lucide icons"
```

---

### Task 4: Message Component (Dark Theme)

**Files:**
- Rewrite: `web/components/message.tsx`

- [ ] **Step 1: Rewrite message.tsx for dark theme**

Three message types:
- **User**: right-aligned, `bg-[var(--accent)]` background, dark text (`text-[#0a0a0a]`), rounded `12px 12px 4px 12px`
- **Agent**: left-aligned, `bg-[var(--bg-card)]` background with `border border-[var(--border)]`, rounded `12px 12px 12px 4px`
- **Action**: left-aligned, `bg-[var(--bg-panel)]` background with `border-l-2 border-[var(--accent)]`, monospace green text

Timestamps use `Clock` icon from lucide-react in `text-[var(--text-muted)]`.

ThinkingIndicator: green pulsing dots on dark background.

- [ ] **Step 2: Commit**

```bash
git add web/components/message.tsx
git commit -m "feat(web): dark-themed message bubbles"
```

---

### Task 5: Left Sidebar

**Files:**
- Create: `web/components/left-sidebar.tsx`

- [ ] **Step 1: Create left-sidebar.tsx**

Three sections with `section-title` pattern (green square dot + monospace label):

**Agent Deploy section**: Bot icon avatar with green border, info rows (Name, Plugins, Balance, Positions, Realtime status). Balance in green monospace. "ANALYZE" button (green, full-width). "FULL DASHBOARD" link with Grid icon.

**Live Feed section**: Title "WHALE_LIVE" with Heart icon + SYNC button with RefreshCw icon. Feed items: each has shortened address (green monospace), truncated market name, USD amount, BUY/SELL badge. New items fed from `liveFeed` prop (populated from WebSocket action_results in page.tsx).

Props:
```typescript
type LeftSidebarProps = {
  balance: number | null;
  positionCount: number;
  isConnected: boolean;
  liveFeed: Array<{ address: string; market: string; amount: number; side: "BUY" | "SELL" }>;
  onAnalyze: () => void;
};
```

- [ ] **Step 2: Commit**

```bash
git add web/components/left-sidebar.tsx
git commit -m "feat(web): left sidebar with agent info and live feed"
```

---

### Task 6: Right Sidebar

**Files:**
- Create: `web/components/right-sidebar.tsx`

- [ ] **Step 1: Create right-sidebar.tsx**

**Plugins section**: 3 plugin items, each with icon (BarChart3 for Polymarket, Globe for Jupiter, CreditCard for x402), name, and tool count in green.

**Quick Actions section**: 6 buttons with lucide icons:
- Zap → "Scan Markets" → `onQuickAction("place a $3 YES bet on polymarket on something interesting")`
- BarChart3 → "Show Positions" → `onQuickAction("show my positions")`
- DollarSign → "Place $3 Bet" → `onQuickAction("buy $3 YES on something interesting")`
- Activity → "Show PnL" → `onQuickAction("show me my pnl on polymarket")`
- Search → "Scan Jupiter" → `onQuickAction("scan jupiter prediction markets on solana")`
- FileText → "Show Trades" → `onQuickAction("show my recent trades")`

**Builder card**: Grid icon + "Polymarket Builder" + API badge.

**Coming Soon**: Smartphone icons for iOS/Android.

Props:
```typescript
type RightSidebarProps = {
  onQuickAction: (prompt: string) => void;
};
```

- [ ] **Step 2: Commit**

```bash
git add web/components/right-sidebar.tsx
git commit -m "feat(web): right sidebar with plugins and quick actions"
```

---

### Task 7: Center Chat + Dashboard + Whale Components

**Files:**
- Create: `web/components/center-chat.tsx`
- Create: `web/components/dashboard.tsx`
- Create: `web/components/whale-card.tsx`
- Create: `web/components/whale-modal.tsx`

- [ ] **Step 1: Create center-chat.tsx**

Similar to current `chat.tsx` but dark-themed:
- Chat header: Bot avatar (green border) + "POLYAGENT" + "POWERED BY ELIZAOS"
- Messages area: dark background, auto-scroll
- Empty state: Bot icon + "Polyagent" + suggestion text
- Input bar: dark bg, Smile icon, Mic icon, green send button with ArrowUp icon
- Uses `Message` and `ThinkingIndicator` from message.tsx

Same props as current chat.tsx:
```typescript
type CenterChatProps = {
  messages: ChatMessage[];
  isThinking: boolean;
  isConnected: boolean;
  onSend: (text: string) => void;
};
```

- [ ] **Step 2: Create dashboard.tsx**

Takes `DashboardStats` as prop. Four sections:

1. **Stats row**: 4-col grid of stat cards (DollarSign, ArrowLeftRight, Users, Activity icons)
2. **Pressure bars**: 2-col grid. Each has header labels, gradient bar (CSS custom property for percentage), value labels
3. **Largest trades**: 2-col grid (TrendingUp green, TrendingDown red)
4. **Whale grid**: 3-col grid of WhaleCard components

Props:
```typescript
type DashboardProps = {
  stats: DashboardStats | null;
  onWhaleClick: (address: string) => void;
};
```

- [ ] **Step 3: Create whale-card.tsx**

Single whale card. Shows name (green monospace), pseudonym, volume, shortened address, "View on Polymarket" button. Click card → `onWhaleClick`. Copy icon on name. Uses `Copy`, `Search` from lucide.

Props:
```typescript
type WhaleCardProps = {
  whale: WhaleWallet;
  onClick: () => void;
};
```

- [ ] **Step 4: Create whale-modal.tsx**

Full-screen dark modal overlay. Header with name, pseudonym, wallet (full + copy). Stats row: volume, trades, buy/sell ratio. Trade history table fetched via `getWalletTrades()`. "View on Polymarket" external link. Close button (X icon).

Props:
```typescript
type WhaleModalProps = {
  address: string;
  name: string;
  pseudonym: string;
  totalVolume: number;
  onClose: () => void;
};
```

Internally fetches trades on mount via `useEffect` + `getWalletTrades(address)`.

- [ ] **Step 5: Commit**

```bash
git add web/components/center-chat.tsx web/components/dashboard.tsx web/components/whale-card.tsx web/components/whale-modal.tsx
git commit -m "feat(web): center chat, dashboard, whale card and modal"
```

---

### Task 8: Wire Everything in page.tsx + Cleanup

**Files:**
- Rewrite: `web/app/page.tsx`
- Delete: `web/components/chat.tsx`
- Delete: `web/components/portfolio-panel.tsx`

- [ ] **Step 1: Rewrite page.tsx with 3-panel layout**

```tsx
"use client";

import { useCallback, useEffect, useState } from "react";
import { useWebSocket } from "@/lib/ws-client";
import { getGlobalTrades, computeDashboardStats } from "@/lib/polymarket-api";
import type { DashboardStats } from "@/lib/types";
import { Header } from "@/components/header";
import { LeftSidebar } from "@/components/left-sidebar";
import { CenterChat } from "@/components/center-chat";
import { RightSidebar } from "@/components/right-sidebar";
import { Dashboard } from "@/components/dashboard";
import { WhaleModal } from "@/components/whale-modal";

export default function Home() {
  const { messages, sendMessage, isConnected, isThinking, portfolio, requestStatus } = useWebSocket();
  const [dashboardStats, setDashboardStats] = useState<DashboardStats | null>(null);
  const [selectedWhale, setSelectedWhale] = useState<{ address: string; name: string; pseudonym: string; volume: number } | null>(null);
  const [liveFeed, setLiveFeed] = useState<Array<{ address: string; market: string; amount: number; side: "BUY" | "SELL" }>>([]);

  // Fetch dashboard data on mount + every 30s
  const fetchDashboard = useCallback(async () => {
    try {
      const trades = await getGlobalTrades(200);
      const stats = computeDashboardStats(trades);
      setDashboardStats(stats);
      // Update live feed from global trades
      setLiveFeed(
        trades.slice(0, 10).map((t) => ({
          address: t.proxyWallet,
          market: t.title,
          amount: t.usdcSize ?? t.size * t.price,
          side: t.side as "BUY" | "SELL",
        }))
      );
    } catch {}
  }, []);

  useEffect(() => {
    fetchDashboard();
    const interval = setInterval(fetchDashboard, 30000);
    return () => clearInterval(interval);
  }, [fetchDashboard]);

  // Request portfolio status on connect
  useEffect(() => {
    if (isConnected) requestStatus();
  }, [isConnected, requestStatus]);

  const handleQuickAction = (prompt: string) => {
    sendMessage(prompt);
  };

  const handleWhaleClick = (address: string) => {
    const whale = dashboardStats?.whales.find((w) => w.address === address);
    if (whale) {
      setSelectedWhale({ address, name: whale.name, pseudonym: whale.pseudonym, volume: whale.totalVolume });
    }
  };

  return (
    <div className="h-screen flex flex-col bg-[var(--bg)]">
      <Header
        balance={portfolio?.balance ?? null}
        isConnected={isConnected}
      />

      <div className="flex flex-1 overflow-hidden">
        <LeftSidebar
          balance={portfolio?.balance ?? null}
          positionCount={portfolio?.positions?.length ?? 0}
          isConnected={isConnected}
          liveFeed={liveFeed}
          onAnalyze={() => sendMessage("analyze polymarket markets and place a bet")}
        />

        <CenterChat
          messages={messages}
          isThinking={isThinking}
          isConnected={isConnected}
          onSend={sendMessage}
        />

        <RightSidebar onQuickAction={handleQuickAction} />
      </div>

      <Dashboard stats={dashboardStats} onWhaleClick={handleWhaleClick} />

      {selectedWhale && (
        <WhaleModal
          address={selectedWhale.address}
          name={selectedWhale.name}
          pseudonym={selectedWhale.pseudonym}
          totalVolume={selectedWhale.volume}
          onClose={() => setSelectedWhale(null)}
        />
      )}
    </div>
  );
}
```

- [ ] **Step 2: Delete old components**

```bash
rm web/components/chat.tsx web/components/portfolio-panel.tsx web/components/settings-modal.tsx
```

- [ ] **Step 3: Verify build**

```bash
cd web && npx next build
```

- [ ] **Step 4: Verify existing tests still pass**

```bash
cd /path/to/polymarket-agent && bun test plugins/ lib.test.ts
```

- [ ] **Step 5: Commit**

```bash
git add web/
git commit -m "feat(web): complete ElizaBao-style 3-panel UI with whale dashboard"
```
