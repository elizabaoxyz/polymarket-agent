# Web Chat Interface Design Spec

> ChatGPT-style web UI for the Polymarket trading agent, for demo/showcase purposes.

## Architecture

Two processes:
1. **Bun WebSocket server** (`ws-server.ts`, port 3001) — wraps the elizaOS runtime, handles agent messages
2. **Next.js app** (`web/`, port 3000) — chat UI, connects to Bun WS server

### File Structure

```
polymarket-agent/
  ws-server.ts                  Bun WebSocket server wrapping elizaOS runtime
  web/                          Next.js app
    app/
      layout.tsx                Root layout, Inter font, metadata
      page.tsx                  Chat page (single page app)
    components/
      chat.tsx                  Chat container (messages list + input)
      message.tsx               Single message bubble (user or agent)
      header.tsx                Top bar (logo, balance, nav tabs)
      portfolio-panel.tsx       Slide-out panel (positions, trades, PnL)
    lib/
      ws-client.ts              WebSocket client React hook
      types.ts                  Shared message types
    package.json                Next.js dependencies
    tailwind.config.ts          Tailwind config
    tsconfig.json               TypeScript config
```

## WebSocket Server (`ws-server.ts`)

Bun-native WebSocket server on port 3001. Initializes the elizaOS runtime (same setup as `runner.ts` but without the TUI) and bridges WebSocket messages to `messageService.handleMessage`.

### Startup

1. Load `.env` (dotenv)
2. Initialize elizaOS runtime (same plugin set as runner.ts)
3. Start Bun WebSocket server on port 3001
4. Log: `ws-server: listening on ws://localhost:3001`

### WebSocket Protocol

Client-to-server messages:

```typescript
// Send a chat message to the agent
{ type: "message", text: string }

// Request current portfolio status
{ type: "get_status" }
```

Server-to-client messages:

```typescript
// Agent's text reply
{ type: "reply", text: string }

// Action execution result (from callback)
{ type: "action_result", text: string }

// Portfolio status
{ type: "status", balance: number, positions: Position[], trades: Trade[] }

// Agent is processing (thinking indicator)
{ type: "thinking", active: boolean }
```

### Message Handling

When a `message` arrives:
1. Send `{ type: "thinking", active: true }`
2. Create memory, call `messageService.handleMessage(runtime, memory, callback)`
3. In callback: send `{ type: "action_result", text }` for each callback invocation
4. After handleMessage returns: send the response as `{ type: "reply", text }` and `{ type: "thinking", active: false }`

When a `get_status` arrives:
1. Read balance from CLOB API via `PolymarketExtService`
2. Read positions and trades from Data API
3. Send `{ type: "status", balance, positions, trades }`

## Next.js App (`web/`)

### Tech Stack

- Next.js 15 (App Router)
- Tailwind CSS
- TypeScript
- No additional UI library (custom components)

### Pages

Single page: `app/page.tsx` — the chat interface.

### Components

#### `header.tsx`
- Fixed top bar, white background, bottom border
- Left: Logo icon (indigo square with "P") + "Polyagent" text
- Right: USDC balance (indigo, updates via WebSocket), "Positions" tab, "Trades" tab
- Tabs toggle the portfolio panel open/closed

#### `chat.tsx`
- Centered container, max-width 720px
- Scrollable message list with auto-scroll to bottom
- Fixed input bar at bottom
- Shows "thinking" indicator (three dots animation) when agent is processing
- Messages array in React state, appended as WebSocket messages arrive

#### `message.tsx`
- User messages: right-aligned, white background, gray border, rounded corners
- Agent messages: left-aligned, indigo background (#6366f1), white text, rounded corners
- Action results: left-aligned, light indigo background (#eef2ff), indigo text, smaller font
- Timestamps in small gray text below each message

#### `portfolio-panel.tsx`
- Slide-out panel from right side, 380px wide
- Two tabs: "Positions" and "Trades"
- Positions tab: market name, outcome (YES/NO badge), shares, avg price, current price, PnL with color (green/red)
- Trades tab: side (BUY/SELL badge), market, size, price, time ago
- Fetches data via WebSocket `get_status` when opened
- Close button (X) in top right

#### `lib/ws-client.ts`
React hook: `useWebSocket(url)`
- Returns: `{ messages, sendMessage, status, isConnected, portfolioData }`
- Auto-reconnects on disconnect (exponential backoff)
- Parses incoming JSON, dispatches by message type
- Manages message history in state

#### `lib/types.ts`
Shared TypeScript types for WebSocket messages, positions, trades.

### Visual Style

- **Background**: White (#ffffff) main area, light gray (#fafafa) chat area
- **Borders**: #e5e7eb
- **Accent**: Indigo (#6366f1) for agent messages, buttons, balance
- **Text**: #111827 (near black), #6b7280 (gray secondary)
- **Font**: Inter (via next/font)
- **User bubbles**: White background, 1px #e5e7eb border
- **Agent bubbles**: #6366f1 background, white text
- **Input**: Rounded pill (#f4f4f5 background), indigo send button (circle with arrow)
- **Spacing**: 16px message gaps, 12px padding in bubbles

### Responsive

- Desktop: centered 720px chat, full header
- Mobile (< 768px): full-width chat, hamburger menu for portfolio

## Integration

### New npm scripts in root `package.json`

```json
{
  "scripts": {
    "web": "bun run ws-server.ts & cd web && npm run dev",
    "ws": "bun run ws-server.ts"
  }
}
```

### Runtime Initialization in ws-server.ts

Reuses the same initialization pattern as `runner.ts`:
- Loads env, resolves API credentials
- Creates runtime with same plugin set (including polymarketExtPlugin)
- Same character config with messageHandlerTemplate
- No TUI, no streaming — just callback-based message handling

### No New Dependencies in Root

The Bun WS server uses Bun's built-in WebSocket support (no npm package needed). The Next.js app has its own `package.json` in `web/`.

## Scope Boundaries

**In scope:**
- Single-page chat with real-time WebSocket
- Balance display
- Positions and trades in slide-out panel
- Thinking indicator while agent processes
- Action results displayed inline

**Out of scope:**
- Authentication / multi-user
- Persistent chat history (messages clear on refresh)
- Mobile-first design (responsive but desktop-primary)
- Deployment / Docker / hosting
