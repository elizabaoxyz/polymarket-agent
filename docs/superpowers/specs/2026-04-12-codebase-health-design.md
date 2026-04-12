# Codebase Health: Logger, Autonomy Decomposition, Security

**Date:** 2026-04-12
**Status:** Approved

Three improvements to operational visibility, code maintainability, and security.

---

## 1. Structured Logger (`log.ts`)

### Problem

79 `console.log/warn/error` calls across 15 files. No timestamps, no levels, no consistent prefix format. The autonomy core has `callbacks.log()` which is well-designed, but startup code, servers, and plugins dump raw strings to stdout. On Railway, there's no way to filter errors from info messages.

### Design

A single `log.ts` module exporting a `log` object with level methods. Zero dependencies — uses `console.*` underneath.

```ts
// log.ts
export const log = {
  info(prefix: string, msg: string): void { ... },
  warn(prefix: string, msg: string): void { ... },
  error(prefix: string, msg: string): void { ... },
};
```

**Output format:**
```
2026-04-12T22:15:03.123Z [INFO] [ws-server] client connected
2026-04-12T22:15:03.456Z [WARN] [x402] failed to initialize (timeout), payments disabled
2026-04-12T22:15:03.789Z [ERROR] [runner] Fatal: CLOB API unreachable
```

### Migration rules

| Current pattern | Replacement |
|---|---|
| `console.log("ws-server: msg")` | `log.info("ws-server", "msg")` |
| `console.warn("x402: msg")` | `log.warn("x402", "msg")` |
| `console.error("runner: msg")` | `log.error("runner", "msg")` |
| `console.log("✅ runtime initialized")` | `log.info("runner", "runtime initialized")` |
| `console.log(\`x402: payment #${n}\`)` | `log.info("x402", \`payment #${n}\`)` |

### What NOT to change

- **`callbacks.log()`** — 126 calls in the autonomy core. Already structured, routes to WebSocket/TUI. Leave untouched.
- **Test files** (`*.test.ts`) — `console.log` in tests is diagnostic output shown during `bun test`. Leave as-is.
- **`approve-usdc.ts`** — Standalone CLI script, not part of the running agent. Leave as-is.

### Files to modify

| File | console calls | Notes |
|---|---|---|
| `ws-server.ts` | 14 | Server lifecycle + client events |
| `runner.ts` | 6 | Startup + fatal error handler |
| `jupiter-runner.ts` | 7 | Startup messages |
| `polymarket-demo.ts` | 1 + fatal handler | Demo script |
| `jupiter-demo.ts` | 1 + fatal handler | Demo script |
| `retry.ts` | 1 | `console.warn` on retry |
| `autonomy.ts` | 1 | Single `console.warn` for heartbeat |
| `plugins/x402-solana/service.ts` | 4 | Init + payment logging |
| `plugins/jupiter-prediction/service.ts` | 2 | Init messages |
| `plugins/connectors/service.ts` | 2 info + 3 warn | Init + error fallbacks |
| `plugins/rag/service.ts` | 3 info + 4 warn | Init + error fallbacks |
| `plugins/rag/chroma-client.ts` | 1 info + 1 warn | Upsert logging |

Total: ~46 calls to migrate (excluding tests, approve-usdc).

---

## 2. Autonomy Decomposition

### Problem

`autonomy.ts` is 834 lines despite header claiming it's a "slim orchestrator." It contains three distinct responsibilities and significant duplication between the Polymarket and Jupiter buy phases.

### Extraction plan

#### 2a. Move `analyzeCandidates()` → `autonomy-llm.ts`

The function (lines 81-229) builds an LLM prompt, calls `ensembleLlmCall`, and parses the structured response. This is LLM logic — it belongs with `directLlmCall` and `ensembleLlmCall` in `autonomy-llm.ts`.

- Move `AnalysisResult` type and `analyzeCandidates()` function
- Export from `autonomy-llm.ts`, import in `autonomy.ts`
- ~150 lines removed from `autonomy.ts`

#### 2b. Deduplicate buy phases → shared `platformBuyPhase()`

`polyPhase()` (lines 374-514) and `jupPhase()` (lines 516-681) follow the same pipeline:

1. Log mode (sell-only vs sell+buy)
2. Run portfolio review
3. Check if full/low-balance/breaker → return early
4. Scan markets (with cooldown retry)
5. RAG enrich
6. Analyze candidates
7. Validate picks (price bounds, reward ratio, spend limits)
8. Execute buys with Kelly sizing

Extract a `platformBuyPhase()` function parameterized by:

```ts
type PlatformBuyConfig = {
  label: "POLYMARKET" | "JUPITER";
  balance: number;
  lowBalance: boolean;
  isFull: boolean;
  activeCount: number;
  minBet: number;
  scan: () => Promise<Array<ScoredMarket | JupMarket>>;
  executeBuy: (analysis: AnalysisResult, betSize: number, balance: number) => Promise<boolean>;
  reviewPositions: SellablePosition[];
  // platform-specific pre/post hooks
  beforeBuy?: () => Promise<void>;
  afterScan?: (scored: ScoredMarket[]) => Promise<void>;
};
```

This collapses ~300 lines of near-duplicate code into ~130 lines + two config objects (~20 lines each).

#### 2c. Extract `startAutonomy()` → `autonomy-loop.ts`

The public API (lines 728-834) handles:
- Timer scheduling with idle backoff
- Heartbeat management (Polymarket GTC order protection)
- x402 payment initialization
- Stop handle

This is lifecycle management, not cycle orchestration. Extract to `autonomy-loop.ts`:

- `startAutonomy()` function
- Re-export `AutonomyHandle`, `AutonomyPlatform`, etc.
- Import `runAutonomyCycle` from `autonomy.ts`

### Result

| File | Before | After |
|---|---|---|
| `autonomy.ts` | 834 lines | ~400 lines (pure cycle orchestration) |
| `autonomy-llm.ts` | 375 lines | ~530 lines (+analyzeCandidates + AnalysisResult) |
| `autonomy-loop.ts` | new | ~120 lines (lifecycle + public API) |

### Import chain

```
autonomy-loop.ts (public API: startAutonomy)
  └── autonomy.ts (runAutonomyCycle, platformBuyPhase)
        ├── autonomy-llm.ts (analyzeCandidates, ensembleLlmCall)
        ├── autonomy-scanner.ts (scanPolymarketMarkets, scanJupiterMarkets)
        ├── autonomy-sell.ts (collectPositions, unifiedPortfolioReview)
        ├── autonomy-trade.ts (directPolymarketBuy, directJupiterBuy)
        ├── autonomy-rag.ts (indexAndEnrich)
        └── autonomy-state.ts (state management)
```

### Re-export compatibility

`autonomy-loop.ts` re-exports everything that `autonomy.ts` currently exports. Consumers (ws-server.ts, runner.ts) update their imports from `./autonomy` to `./autonomy-loop`. No other files need changes.

---

## 3. Security + Housekeeping

### 3a. Tighten `.env` permissions

```bash
chmod 600 .env
```

The file contains `EVM_PRIVATE_KEY` and `SOLANA_PRIVATE_KEY`. Currently 644 (world-readable). Change to 600 (owner-only).

### 3b. Add `CONTRIBUTING.md`

Lightweight contributor guide covering:
- Prerequisites (Bun, Node 18+)
- Setup (`bun install`, `.env.example` → `.env`)
- Running (`bun run start`, `bun run ws`, `bun run web`)
- Testing (`bun test`)
- Linting (`bun run lint`, `bun run lint:fix`)
- Code style (Biome enforced, strict TypeScript)
- PR process (CI must pass: lint + typecheck + test)

---

## Testing strategy

- All existing 153 tests must continue passing after each change
- Run `bun run typecheck` after each extraction to catch import errors
- Run `bun run lint` to verify Biome is happy
- No new test files needed — these are structural refactors, not behavior changes
