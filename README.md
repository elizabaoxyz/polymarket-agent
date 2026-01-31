# ElizaBAO - Polymarket Trading Agent

An **AI-powered autonomous trading agent** for Polymarket prediction markets, built on **ElizaOS v2.0.0**.

> Combining ElizaOS + Claude + Polymarket for autonomous prediction market trading.

## What's New in v2.0.0

- **ElizaOS v2.0.0 Integration** - Full plugin architecture with actions, providers, and evaluators
- **Modular Plugin System** - `@elizabao/plugin-polymarket` as a standalone npm package
- **Character-based AI** - Configurable agent personality and trading style
- **Multi-platform Support** - Telegram, Discord, and direct API access
- **Moltbot-style Messaging** - Chat with your agent via messaging platforms

## Features

This agent showcases ElizaOS v2.0.0 capabilities:

- **AgentRuntime** with multiple plugins (SQL, OpenAI, EVM, Polymarket)
- **Message Service Pipeline** for AI decision making via `handleMessage()`
- **Memory Persistence** for trading history via `createMemory()`
- **Character-based AI** with trading personality and strategy
- **Advanced Planning** (`advancedPlanning: true`) for multi-step trading strategies
- **Advanced Memory** (`advancedMemory: true`) for remembering past trades and patterns
- **Autonomy Service** (`runtime.enableAutonomy`) for continuous autonomous trading

## How It Works

1. **Scanning Phase**: Agent scans Polymarket for active markets with order books
2. **Analysis Phase**: Scores opportunities based on spread, liquidity, and midpoint
3. **Decision Phase**: AI agent analyzes top opportunities and decides whether to trade
4. **Execution Phase**: Uses Polymarket plugin actions to place orders

The AI agent ("Poly the Trader") receives market data as messages and responds with trading decisions, using the same pattern as the text-adventure example.

## Quick Start

### 1. Clone and Install

```bash
git clone https://github.com/yourusername/polymarket-agent.git
cd polymarket-agent
bun install
```

### 2. Configure Environment

```bash
cp .env.example .env
# Edit .env with your API keys
```

Required environment variables:

```bash
# AI Provider
ANTHROPIC_API_KEY=sk-ant-...         # Claude API key

# Polymarket Wallet
EVM_PRIVATE_KEY=0x...                # Your Polygon wallet
WALLET_ADDRESS=0x...

# Trading (required for live orders)
CLOB_API_KEY=...
CLOB_API_SECRET=...
CLOB_API_PASSPHRASE=...
```

### 3. Run the Agent

```bash
# Start the ElizaOS agent
bun run start

# Or run the API server
bun run start:elizaos

# Or use a custom character
bun run start -- --character characters/elizabao.json
```

## Project Structure

```
polymarket-agent/
├── packages/
│   └── plugin-polymarket/        # ElizaOS v2.0.0 plugin
│       ├── src/
│       │   ├── actions/          # Trading actions
│       │   ├── providers/        # Data providers
│       │   ├── services/         # Polymarket service
│       │   └── index.ts          # Plugin entry
│       └── package.json
├── characters/
│   └── elizabao.json             # Agent character config
├── src/
│   └── agent.ts                  # Agent entry point
├── api-server-elizaos.ts         # API server (legacy)
└── package.json
```

## Usage (ElizaOS v2.0.0)

```bash
# Build the plugin
bun run build:plugin

# Start the agent
bun run start

# Start with API server
bun run start:elizaos
```

## CLI Flags

| Flag | Description | Default |
|------|-------------|---------|
| `--network` | Enable API calls (required for trading) | false |
| `--execute` | Place real orders (requires CLOB creds) | false |
| `--max-pages <n>` | Pages of markets to scan | 1 |
| `--order-size <n>` | Order size in shares | 1 |
| `--iterations <n>` | Loop count for `run` command | 10 |
| `--interval-ms <n>` | Delay between iterations | 30000 |
| `--chain <name>` | EVM chain name | polygon |
| `--rpc-url <url>` | Custom RPC URL | — |
| `--private-key <hex>` | Override wallet key | — |

## Example Output

```
╔════════════════════════════════════════════════════════════════════╗
║                 POLYMARKET TRADING AGENT                           ║
╠════════════════════════════════════════════════════════════════════╣
║  Watch as Poly the AI Trader analyzes prediction markets!          ║
╚════════════════════════════════════════════════════════════════════╝

✅ Autonomous trading agent ready!
🤖 Advanced Planning: enabled
🧠 Advanced Memory: enabled
🔄 Autonomy: enabled

🔄 PHASE 1: SCANNING MARKETS
────────────────────────────────────────────────────────────────
📊 Scan Results: Source: clob | Markets: 50 | Opportunities: 12

🔄 PHASE 2: AI ANALYSIS
────────────────────────────────────────────────────────────────
🎯 Recommended Market: Will BTC reach $100k by March 2026?
📈 Bid: 0.4500 | Ask: 0.4800
📏 Spread: 0.0300 | Midpoint: 0.4650

────────────────────────────────────────────────────────────────
🤖 Agent Decision: BUY
   Price: 0.4600
   Size: 1 shares
   Reasoning: Tight 3% spread with good liquidity. Bidding below midpoint for favorable entry.
```

## Opportunity Scoring

The agent evaluates markets using:

- **Spread Score** (55%): Tighter spreads indicate better liquidity
- **Midpoint Score** (30%): Prices near 0.5 suggest market uncertainty (good for trading)
- **Depth Score** (15%): More orders on both sides = more reliable pricing

## Architecture (ElizaOS v2.0.0)

```
src/agent.ts                         → ElizaOS agent entry point
packages/plugin-polymarket/          → Polymarket plugin
├── src/actions/                     → Trading actions (scan, buy, sell, analyze)
├── src/providers/                   → Context providers (portfolio, market data)
├── src/services/                    → Polymarket API service
└── src/index.ts                     → Plugin registration

characters/elizabao.json             → Agent character configuration

Key ElizaOS v2.0.0 patterns:
- Plugin-based architecture with hot-swappable modules
- Actions with arguments for tool-like invocation
- Providers for context injection
- Character-based personality and behavior
```

## Plugin Development

Create your own plugin:

```typescript
import type { Plugin, Action } from "@elizaos/core";

export const myPlugin: Plugin = {
  name: "my-plugin",
  actions: [myAction],
  providers: [myProvider],
  init: async (runtime) => {
    // Initialize your plugin
  },
};
```

## Advanced elizaOS Features

### Advanced Planning (`advancedPlanning: true`)

When enabled on the character, the runtime auto-loads the planning service which allows the agent to:
- Plan multi-step trading strategies
- Break down complex decisions into actionable steps
- Maintain planning context across turns

### Advanced Memory (`advancedMemory: true`)

When enabled on the character, the runtime auto-loads advanced memory capabilities:
- Remember past trading decisions and outcomes
- Learn from successful and unsuccessful trades
- Build contextual awareness of market patterns

### Autonomy Service (`runtime.enableAutonomy: true`)

For continuous trading mode (`run` command), autonomy is enabled:
- Creates an "Autonomous Thoughts" room for agent reflection
- Runs periodic thinking loops between trading cycles
- Maintains persistent state across iterations

## Tests

```bash
bun test
```

## Credits

- **ElizaOS** - AI agent framework by [@ai16zdao](https://twitter.com/ai16zdao)
- **Anthropic Claude** - AI reasoning engine
- **Polymarket** - Prediction market platform
- **Moltbot/OpenClaw** - Inspiration for messaging-first agents

## License

MIT License - see [LICENSE](LICENSE)

## Links

- Twitter: [@elizabaoxyz](https://twitter.com/elizabaoxyz)
- GitHub: [elizabaoxyz/polymarket-agent](https://github.com/elizabaoxyz/polymarket-agent)
- ElizaOS: [elizaOS/eliza](https://github.com/elizaOS/eliza)
