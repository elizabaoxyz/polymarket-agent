# Codebase Health Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add structured logging, decompose autonomy.ts, tighten .env security, and add CONTRIBUTING.md.

**Architecture:** Zero-dep `log.ts` wrapper replaces raw console calls. `autonomy.ts` (834 lines) splits into: `autonomy-llm.ts` gains `analyzeCandidates`, new `autonomy-loop.ts` gets lifecycle/heartbeat, and a shared `platformBuyPhase()` deduplicates poly/jup buy pipelines. Only `ws-server.ts` needs import path updates.

**Tech Stack:** TypeScript, Bun, Biome

---

### Task 1: Create `log.ts` — structured logger module

**Files:**
- Create: `log.ts`

- [ ] **Step 1: Create `log.ts`**

```ts
/**
 * Structured logger — zero-dep wrapper over console with timestamps and levels.
 * Use for startup, server, and plugin logging. The autonomy core uses callbacks.log() instead.
 */

function fmt(level: string, prefix: string, msg: string): string {
  return `${new Date().toISOString()} [${level}] [${prefix}] ${msg}`;
}

export const log = {
  info(prefix: string, msg: string): void {
    console.log(fmt("INFO", prefix, msg));
  },
  warn(prefix: string, msg: string): void {
    console.warn(fmt("WARN", prefix, msg));
  },
  error(prefix: string, msg: string): void {
    console.error(fmt("ERROR", prefix, msg));
  },
};
```

- [ ] **Step 2: Verify it compiles**

Run: `bunx tsc --noEmit --skipLibCheck log.ts`
Expected: no errors

- [ ] **Step 3: Commit**

```bash
git add log.ts
git commit -m "feat: add structured logger module (log.ts)"
```

---

### Task 2: Migrate `ws-server.ts` to structured logger

**Files:**
- Modify: `ws-server.ts`

- [ ] **Step 1: Add import**

Add at the top of `ws-server.ts` imports:

```ts
import { log } from "./log";
```

- [ ] **Step 2: Replace all 14 console calls**

Replace each `console.log`/`console.warn`/`console.error` in `ws-server.ts`:

| Line | Before | After |
|---|---|---|
| 191 | `console.log("ws-server: RAG active — ChromaDB connected")` | `log.info("ws-server", "RAG active — ChromaDB connected")` |
| 199 | `console.log("ws-server: Connectors active — news + search available")` | `log.info("ws-server", "Connectors active — news + search available")` |
| 218 | `console.log("ws-server: initializing runtime...")` | `log.info("ws-server", "initializing runtime...")` |
| 225 | `console.log("ws-server: runtime ready")` | `log.info("ws-server", "runtime ready")` |
| 262 | `console.log("ws-server: client connected")` | `log.info("ws-server", "client connected")` |
| 268 | `console.log("ws-server: client disconnected")` | `log.info("ws-server", "client disconnected")` |
| 289 | `console.log("ws-server: client authenticated")` | `log.info("ws-server", "client authenticated")` |
| 292 | `console.warn("ws-server: client auth failed")` | `log.warn("ws-server", "client auth failed")` |
| 364 | `console.log(\`ws-server: switching autonomy...\`)` | `log.info("ws-server", \`switching autonomy from ${...} to ${platform}\`)` |
| 368 | `console.log(\`ws-server: autonomy started (${label})\`)` | `log.info("ws-server", \`autonomy started (${label})\`)` |
| 395 | `console.log(text)` | `log.info("ws-server", text)` |
| 413 | `console.log("ws-server: autonomy stopped")` | `log.info("ws-server", "autonomy stopped")` |
| 424-428 | `console.log(\`ws-server: listening...\`)` and auth messages | `log.info("ws-server", ...)` |
| 433 | `console.error("ws-server fatal:", err)` | `log.error("ws-server", \`fatal: ${err instanceof Error ? err.message : String(err)}\`)` |

- [ ] **Step 3: Verify**

Run: `bun run typecheck && bun test`
Expected: 0 errors, 153 tests pass

- [ ] **Step 4: Commit**

```bash
git add ws-server.ts
git commit -m "refactor: migrate ws-server.ts to structured logger"
```

---

### Task 3: Migrate `runner.ts` and `jupiter-runner.ts` to structured logger

**Files:**
- Modify: `runner.ts`
- Modify: `jupiter-runner.ts`

- [ ] **Step 1: Add import to both files**

```ts
import { log } from "./log";
```

- [ ] **Step 2: Replace runner.ts console calls**

The fatal error handler (lines 115-125) uses `console.error` deliberately for crash output — replace with `log.error`:

```ts
// Lines 115-125: replace console.error calls
log.error("runner", "=".repeat(60));
log.error("runner", `FATAL ERROR${context ? ` [${context}]` : ""}`);
log.error("runner", "=".repeat(60));
log.error("runner", errorMessage);
if (stack) {
  log.error("runner", "Stack trace:");
  log.error("runner", stack);
}
log.error("runner", "=".repeat(60));
log.error("runner", `Error log saved to: ${ERROR_LOG_PATH}`);
```

Replace startup messages (lines 711-794):
- `console.warn(...)` → `log.warn("runner", ...)`
- `console.log("✅ runtime initialized")` → `log.info("runner", "runtime initialized")`
- `console.log(\`🔧 chain: ${options.chain}\`)` → `log.info("runner", \`chain: ${options.chain}\`)`
- `console.log(\`🔧 execute: ...\`)` → `log.info("runner", \`execute: ${options.execute ? "enabled" : "disabled"}\`)`
- `console.log("✅ clob api url:", ...)` → `log.info("runner", \`clob api url: ${session.config.clobApiUrl}\`)`
- `console.log("✅ creds present:", ...)` → `log.info("runner", \`creds present: ${String(session.config.creds !== null)}\`)`
- `console.log("✅ settings saved to .env")` → `log.info("runner", "settings saved to .env")`

- [ ] **Step 3: Replace jupiter-runner.ts console calls**

Lines 200-204 and 221-223:

```ts
log.info("jupiter", "runtime initialized");
log.info("jupiter", `wallet: ${session.jupiterService.ownerPubkey}`);
log.info("jupiter", `jupiter exchange: ${ready ? "operational" : "unavailable"}`);
log.info("jupiter", `execute: ${options.execute ? "enabled" : "disabled"}`);
```

- [ ] **Step 4: Verify**

Run: `bun run typecheck && bun test`
Expected: 0 errors, 153 tests pass

- [ ] **Step 5: Commit**

```bash
git add runner.ts jupiter-runner.ts
git commit -m "refactor: migrate runner + jupiter-runner to structured logger"
```

---

### Task 4: Migrate demo scripts and `retry.ts` to structured logger

**Files:**
- Modify: `polymarket-demo.ts`
- Modify: `jupiter-demo.ts`
- Modify: `retry.ts`

- [ ] **Step 1: Add import to all three files**

```ts
import { log } from "./log";
```

- [ ] **Step 2: Replace polymarket-demo.ts**

Line 73 callback: `console.log(text)` → `log.info("polymarket", text)`

Fatal handler (lines 107-117): same pattern as runner.ts:
```ts
log.error("polymarket", "=".repeat(60));
log.error("polymarket", "FATAL ERROR");
// ... same structure
```

- [ ] **Step 3: Replace jupiter-demo.ts**

Line 56 callback: `console.log(text)` → `log.info("jupiter", text)`

Fatal handler (lines 86-94): same pattern.

- [ ] **Step 4: Replace retry.ts**

Line 68-70:
```ts
log.warn("retry", `${label} attempt ${attempt + 1}/${maxRetries} failed: ${msg} — retrying in ${Math.round(delay)}ms`);
```

- [ ] **Step 5: Verify**

Run: `bun run typecheck && bun test`
Expected: 0 errors, 153 tests pass

- [ ] **Step 6: Commit**

```bash
git add polymarket-demo.ts jupiter-demo.ts retry.ts
git commit -m "refactor: migrate demo scripts + retry to structured logger"
```

---

### Task 5: Migrate plugins to structured logger

**Files:**
- Modify: `plugins/x402-solana/service.ts`
- Modify: `plugins/jupiter-prediction/service.ts`
- Modify: `plugins/connectors/service.ts`
- Modify: `plugins/connectors/search-client.ts`
- Modify: `plugins/rag/service.ts`
- Modify: `plugins/rag/chroma-client.ts`

- [ ] **Step 1: Add import to each file**

```ts
import { log } from "../../log";
```

For `search-client.ts` and `chroma-client.ts` the relative path is the same: `../../log`.

- [ ] **Step 2: Replace x402-solana/service.ts (4 calls)**

```ts
// Line 46
log.info("x402", "disabled (SOLANA_PRIVATE_KEY not set or X402_ENABLED=false)");
// Line 85
log.info("x402", `onBeforePaymentCreation args: ${JSON.stringify(args).slice(0, 500)}`);
// Line 126
log.info("x402", `payment #${svc._paymentCount} — $${usdAmount.toFixed(4)} (total: $${svc._totalPaidUsd.toFixed(4)})`);
// Line 131
log.info("x402", `active | cap: $${maxPaymentUsd.toFixed(2)}/request | networks: solana mainnet + devnet`);
// Line 136
log.warn("x402", `failed to initialize (${msg}), payments disabled`);
```

- [ ] **Step 3: Replace jupiter-prediction/service.ts (2 calls)**

```ts
// Line 43
log.info("jupiter", "JUPITER_API_KEY or SOLANA_PRIVATE_KEY not set — Jupiter actions disabled.");
// Line 57
log.info("jupiter", `initialized, wallet ${service.ownerPubkey}`);
```

- [ ] **Step 4: Replace connectors/service.ts (5 calls)**

```ts
// Line 49
log.info("connectors", "disabled (set NEWSAPI_API_KEY and/or TAVILY_API_KEY)");
// Line 54
log.info("connectors", `active [${parts.join(", ")}]`);
// Line 75
log.warn("connectors", `failed to fetch news: ${msg}`);
// Line 91
log.warn("connectors", `failed to fetch market news: ${msg}`);
// Line 107
log.warn("connectors", `web search failed: ${msg}`);
```

- [ ] **Step 5: Replace connectors/search-client.ts (1 call)**

```ts
// Line 98
log.warn("connectors", `tavily search failed for "${query}": ${msg}`);
```

- [ ] **Step 6: Replace rag/service.ts (7 calls)**

```ts
// Line 58
log.info("rag", "disabled (OPENAI_API_KEY not set)");
// Line 85
log.info("rag", `active | chroma: ${chromaUrl} | model: ${config.embeddingModel}`);
// Line 88
log.warn("rag", `ChromaDB connection failed (${msg}) — similarity search disabled`);
// Line 188
log.info("rag", `indexed ${docs.length} search results`);
// Line 192
log.warn("rag", `failed to index search results: ${msg}`);
// Line 235
log.warn("rag", `similarity search failed: ${msg}`);
// Line 257
log.warn("rag", `news search failed: ${msg}`);
// Line 279
log.warn("rag", `search retrieval failed: ${msg}`);
```

- [ ] **Step 7: Replace rag/chroma-client.ts (2 calls)**

```ts
// Line 86
log.warn("chroma", `upsert failed for collection "${collectionName}" (id=${collection.id}): ${upsertRes.status} ${text.slice(0, 200)}`);
// Line 89
log.info("chroma", `upserted ${documents.length} docs into "${collectionName}" (id=${collection.id})`);
```

- [ ] **Step 8: Verify**

Run: `bun run typecheck && bun test`
Expected: 0 errors, 153 tests pass

- [ ] **Step 9: Commit**

```bash
git add plugins/x402-solana/service.ts plugins/jupiter-prediction/service.ts plugins/connectors/service.ts plugins/connectors/search-client.ts plugins/rag/service.ts plugins/rag/chroma-client.ts
git commit -m "refactor: migrate all plugins to structured logger"
```

---

### Task 6: Migrate `autonomy.ts` heartbeat console.warn

**Files:**
- Modify: `autonomy.ts`

- [ ] **Step 1: Add import**

```ts
import { log } from "./log";
```

- [ ] **Step 2: Replace the single console.warn**

Line 764:
```ts
// Before:
console.warn(`autonomy: heartbeat failed (${consecutiveFailures}x): ${errMsg}`);
// After:
log.warn("autonomy", `heartbeat failed (${consecutiveFailures}x): ${errMsg}`);
```

- [ ] **Step 3: Verify**

Run: `bun run typecheck && bun test`
Expected: 0 errors, 153 tests pass

- [ ] **Step 4: Commit**

```bash
git add autonomy.ts
git commit -m "refactor: migrate autonomy.ts heartbeat warning to structured logger"
```

---

### Task 7: Move `analyzeCandidates` to `autonomy-llm.ts`

**Files:**
- Modify: `autonomy.ts` (remove lines 81-229)
- Modify: `autonomy-llm.ts` (add `analyzeCandidates` + `AnalysisResult` type)

- [ ] **Step 1: Add `AnalysisResult` type and `analyzeCandidates` to `autonomy-llm.ts`**

At the end of `autonomy-llm.ts`, add:

```ts
import { TAKER_FEE_RATE, MIN_EDGE_THRESHOLD, MIN_CONFIDENCE_THRESHOLD } from "./config";

export type AnalysisResult = {
  pick: { question: string; yesPrice: number; score: number; volume?: number; daysLeft?: number; intel?: import("./market-intel").MarketIntel | null };
  side: string;
  reason: string;
  edge: number;
  confidence: number;
  category: string;
  estimatedProb: number;
};

export async function analyzeCandidates(
  deps: AutonomyDeps,
  callbacks: AutonomyCallbacks,
  candidates: Array<{ question: string; yesPrice: number; score: number; volume?: number; daysLeft?: number; intel?: import("./market-intel").MarketIntel | null }>,
  ragContext: string,
): Promise<AnalysisResult[]> {
  // ... (move the entire function body from autonomy.ts lines 91-229)
}
```

Copy the complete function body from `autonomy.ts` lines 91-229 as-is. The function already uses `ensembleLlmCall` which is defined in the same file.

The dynamic imports inside the function (`await import("./market-intel")` and `await import("./config")`) should be converted to static imports at the top of the file since `autonomy-llm.ts` can import them directly:

```ts
import { formatIntelForPrompt } from "./market-intel";
```

Replace the two dynamic imports in the function body:
- `const { formatIntelForPrompt } = await import("./market-intel");` → remove (already imported at top)
- `const { MIN_EDGE_THRESHOLD, MIN_CONFIDENCE_THRESHOLD } = await import("./config");` → remove (already imported at top)

- [ ] **Step 2: Update `autonomy.ts` imports**

Remove the `AnalysisResult` type definition and `analyzeCandidates` function from `autonomy.ts`.

Add import:
```ts
import { analyzeCandidates, type AnalysisResult } from "./autonomy-llm";
```

Remove the now-unused imports:
```ts
// Remove: import { directLlmCall, ensembleLlmCall } from "./autonomy-llm";
// Replace with:
import { analyzeCandidates, type AnalysisResult } from "./autonomy-llm";
```

Keep `ensembleLlmCall` only if it's still used elsewhere in `autonomy.ts`. Check: it is NOT used elsewhere — `analyzeCandidates` was the only caller. So remove `ensembleLlmCall` from the import.

Also remove `directLlmCall` — check if used: it is NOT used in `autonomy.ts`. Remove it.

Remove `TAKER_FEE_RATE` from the import on line 77 since it's no longer used in `autonomy.ts` after removing `analyzeCandidates`. Check: `TAKER_FEE_RATE` is only referenced inside `analyzeCandidates` in `autonomy.ts`. Remove it from the import.

- [ ] **Step 3: Verify**

Run: `bun run typecheck && bun test`
Expected: 0 errors, 153 tests pass

- [ ] **Step 4: Commit**

```bash
git add autonomy.ts autonomy-llm.ts
git commit -m "refactor: move analyzeCandidates to autonomy-llm.ts"
```

---

### Task 8: Deduplicate buy phases with `platformBuyPhase()`

**Files:**
- Modify: `autonomy.ts`

- [ ] **Step 1: Define the `PlatformBuyConfig` type and `platformBuyPhase` function**

Add before `runAutonomyCycle` in `autonomy.ts`:

```ts
type PlatformBuyConfig = {
  label: "POLYMARKET" | "JUPITER";
  balance: number;
  lowBalance: boolean;
  isFull: boolean;
  activeCount: number;
  minBet: number;
  breakerActive: boolean;
  reviewPositions: Array<{ token?: string; pubkey?: string; title: string; pnl: number; shares?: number; curPrice?: number; isYes?: boolean; contracts?: number }>;
  scan: () => Promise<Array<ScoredMarket | JupMarket>>;
  executeBuy: (analysis: AnalysisResult, betSize: number, remainingBalance: number) => Promise<boolean>;
  recordFailedBuy: (analysis: AnalysisResult) => void;
  beforeBuy?: () => Promise<boolean>; // return false to skip buy phase
  afterScan?: (scored: Array<ScoredMarket | JupMarket>) => Promise<void>;
};

async function platformBuyPhase(
  deps: AutonomyDeps,
  callbacks: AutonomyCallbacks,
  state: AutonomyState,
  config: PlatformBuyConfig,
): Promise<void> {
  const { label, balance, lowBalance, isFull, breakerActive, minBet } = config;

  callbacks.log(`[${label}] ${lowBalance ? "SELL-ONLY (low balance)" : "SELL + BUY"}`);

  // Portfolio review
  await unifiedPortfolioReview(
    deps, callbacks, state, label,
    config.reviewPositions,
    balance, lowBalance,
  );

  // Early exit conditions
  if (isFull || lowBalance || breakerActive) {
    if (isFull) callbacks.log(`[${label}] ${config.activeCount}/${MAX_POSITIONS} positions — sell-only`);
    if (lowBalance) callbacks.log(`[${label}] Balance $${balance.toFixed(2)} — sell-only mode`);
    if (breakerActive) callbacks.log(`[${label}] Circuit breaker active — sell-only mode`);
    if (config.afterScan) await config.afterScan([]);
    return;
  }

  // Pre-buy hook (e.g. Jupiter pause check)
  if (config.beforeBuy) {
    const proceed = await config.beforeBuy();
    if (!proceed) return;
  }

  try {
    // Scan with cooldown retry
    let scored = await config.scan();

    if (scored.length === 0) {
      const beforeAnalyzed = state.recentlyAnalyzed.size;
      const beforeSkipped = state.skippedMarkets.size;
      for (const [key] of state.recentlyAnalyzed) state.recentlyAnalyzed.delete(key);
      for (const [key] of state.skippedMarkets) state.skippedMarkets.delete(key);
      if (beforeAnalyzed > 0 || beforeSkipped > 0) {
        callbacks.log(`[${label}:SCAN] 0 candidates — retrying without cooldowns (cleared ${beforeAnalyzed} analyzed, ${beforeSkipped} skipped)`);
        scored = await config.scan();
      }
    }

    // RAG enrich
    const ragContext = scored.length > 0
      ? await indexAndEnrich(deps, callbacks, state, scored, label.toLowerCase() as "polymarket" | "jupiter", scored[0]!.question)
      : "";
    callbacks.log(`[${label}] ${scored.length} new markets | balance: $${balance.toFixed(2)}`);

    if (config.afterScan) await config.afterScan(scored);

    if (scored.length === 0) {
      callbacks.log(`[${label}] No new markets to buy`);
      return;
    }

    const candidates = scored.slice(0, 5);
    const analyses = await analyzeCandidates(deps, callbacks, candidates, ragContext);

    // Mark unpicked candidates
    const pickedQuestions = new Set(analyses.map((a) => a.pick.question.toLowerCase()));
    for (const c of candidates) {
      if (!pickedQuestions.has(c.question.toLowerCase())) {
        state.recentlyAnalyzed.set(c.question.toLowerCase(), Date.now());
      }
    }

    if (analyses.length === 0) {
      for (const c of candidates) {
        state.skippedMarkets.set(c.question.toLowerCase(), Date.now());
      }
      callbacks.log(`[${label}] No high-conviction pick — skipping buy this cycle`);
      return;
    }

    // Execute buys
    let buyCount = 0;
    let remainingBalance = balance;

    for (let ai = 0; ai < analyses.length && buyCount < MAX_BUYS_PER_CYCLE; ai++) {
      const analysis = analyses[ai]!;

      // Second+ buy bar
      if (buyCount > 0) {
        if (analysis.edge < SECOND_BUY_MIN_EDGE) {
          callbacks.log(`[${label}] Pick #${ai + 1} edge ${analysis.edge.toFixed(2)} below second-buy minimum ${SECOND_BUY_MIN_EDGE} — stopping`);
          break;
        }
        if (analysis.confidence < SECOND_BUY_MIN_CONFIDENCE) {
          callbacks.log(`[${label}] Pick #${ai + 1} confidence ${analysis.confidence.toFixed(2)} below second-buy minimum — stopping`);
          break;
        }
        if (ai > 0 && analyses[ai - 1]?.category === analysis.category) {
          callbacks.log(`[${label}] Pick #${ai + 1} same category (${analysis.category}) as previous — skipping for diversification`);
          continue;
        }
      }

      const marketPrice = analysis.side === "YES" ? analysis.pick.yesPrice : 1 - analysis.pick.yesPrice;
      const rewardRatio = marketPrice > 0 ? (1 - marketPrice) / marketPrice : 0;

      if (marketPrice > 0.90) {
        callbacks.log(`[${label}] ❌ Skipping "${analysis.pick.question.slice(0, 50)}" — ${analysis.side} at $${marketPrice.toFixed(2)} terrible risk/reward`);
        state.skippedMarkets.set(analysis.pick.question.toLowerCase(), Date.now());
        continue;
      }
      if (marketPrice < 0.10) {
        callbacks.log(`[${label}] ❌ Skipping "${analysis.pick.question.slice(0, 50)}" — ${analysis.side} at $${marketPrice.toFixed(2)} too cheap`);
        state.skippedMarkets.set(analysis.pick.question.toLowerCase(), Date.now());
        continue;
      }
      const effectiveMinRatio = analysis.confidence >= 0.85 ? 0.25
        : analysis.confidence >= 0.70 ? 0.40
        : MIN_REWARD_RATIO;
      if (rewardRatio < effectiveMinRatio) {
        callbacks.log(`[${label}] ❌ Skipping "${analysis.pick.question.slice(0, 50)}" — ratio ${rewardRatio.toFixed(2)}:1 below ${effectiveMinRatio.toFixed(2)} (conf=${analysis.confidence.toFixed(2)})`);
        state.skippedMarkets.set(analysis.pick.question.toLowerCase(), Date.now());
        continue;
      }

      const kellyProb = analysis.side === "YES" ? analysis.estimatedProb : 1 - analysis.estimatedProb;
      const betSize = calcKellyBetSize({
        estimatedProb: kellyProb,
        marketPrice,
        confidence: analysis.confidence,
        balance: remainingBalance,
        minBet,
      });

      if (!canSpend(state, betSize)) {
        callbacks.log(`[${label}] Daily spend limit reached — stopping`);
        break;
      }

      if (remainingBalance < betSize) {
        callbacks.log(`[${label}] Insufficient balance ($${remainingBalance.toFixed(2)}) for $${betSize.toFixed(2)} bet — stopping`);
        break;
      }

      callbacks.log(`[BUY:${label}] #${buyCount + 1} "${analysis.pick.question}" (${analysis.side}:$${marketPrice.toFixed(2)}, kelly:$${betSize.toFixed(2)}, edge:${analysis.edge.toFixed(2)}, conf:${analysis.confidence.toFixed(2)}, est:${analysis.estimatedProb.toFixed(2)})`);
      state.pendingBuys.add(analysis.pick.question.toLowerCase());
      const bought = await config.executeBuy(analysis, betSize, remainingBalance);
      if (bought) {
        recordTrade(state, { question: analysis.pick.question, platform: label, time: Date.now(), price: analysis.pick.yesPrice, amount: betSize });
        remainingBalance -= betSize;
        buyCount++;
      } else {
        config.recordFailedBuy(analysis);
      }
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    callbacks.log(`[${label}] Scan failed: ${msg}`);
  }
}
```

- [ ] **Step 2: Replace `polyPhase` closure in `runAutonomyCycle`**

Replace the entire `const polyPhase = async () => { ... }` (lines 374-514) with:

```ts
const polyPhase = async () => {
  if (!runPoly) return;
  const polyReviewable = polyAllSellable.filter(p => !untradeableKeys.has(p.token));
  await platformBuyPhase(deps, callbacks, state, {
    label: "POLYMARKET",
    balance: polyBalance,
    lowBalance: lowPolyBalance,
    isFull: polyFull,
    activeCount: polyActive,
    minBet: MIN_BET_SIZE_USD,
    breakerActive,
    reviewPositions: polyReviewable.map((p) => ({ token: p.token, title: p.title, pnl: p.pnl, shares: p.shares, curPrice: p.curPrice })),
    scan: () => scanPolymarketMarkets(ownedTitles, state, callbacks),
    executeBuy: async (analysis, betSize, remaining) => {
      const marketPrice = analysis.side === "YES" ? analysis.pick.yesPrice : 1 - analysis.pick.yesPrice;
      return directPolymarketBuy(deps, callbacks, state, analysis.pick.question, analysis.side, betSize, remaining, (analysis.pick as ScoredMarket).tokenId, marketPrice, (analysis.pick as ScoredMarket).noTokenId);
    },
    recordFailedBuy: (analysis) => { state.failedBuys.set(analysis.pick.question, Date.now()); },
  });
};
```

- [ ] **Step 3: Replace `jupPhase` closure in `runAutonomyCycle`**

Replace the entire `const jupPhase = async () => { ... }` (lines 516-681) with:

```ts
const jupPhase = async () => {
  if (!runJup) return;
  // Claim settled Jupiter positions first
  await claimJupiterPositions(deps, callbacks, state, jupClaimable);
  const jupReviewable = jupAllPositions.filter(p => !p.pubkey || !untradeableKeys.has(p.pubkey));
  await platformBuyPhase(deps, callbacks, state, {
    label: "JUPITER",
    balance: solBalance,
    lowBalance: lowSolBalance,
    isFull: jupFull,
    activeCount: jupActive,
    minBet: MIN_BET_SIZE_JUP,
    breakerActive,
    reviewPositions: jupReviewable.map((p) => ({ pubkey: p.pubkey, title: p.title, pnl: p.pnl, isYes: p.isYes, contracts: p.contracts, ...(p.curPrice != null ? { curPrice: p.curPrice } : {}) })),
    scan: () => scanJupiterMarkets(ownedTitles, state, callbacks),
    executeBuy: async (analysis, betSize, remaining) => {
      const pick = analysis.pick as JupMarket;
      return directJupiterBuy(deps, callbacks, state, pick.marketId, analysis.side, betSize, pick.question, remaining, solUsdcBalance, solJupUsdBalance);
    },
    recordFailedBuy: (analysis) => { state.failedBuys.set((analysis.pick as JupMarket).marketId, Date.now()); },
    beforeBuy: async () => {
      if (Date.now() < state.jupBuyPausedUntil) {
        const remaining = Math.ceil((state.jupBuyPausedUntil - Date.now()) / 60_000);
        callbacks.log(`[JUPITER] Skipping buy — insufficient funds cooldown (${remaining}m remaining)`);
        return false;
      }
      return true;
    },
    afterScan: async (scored) => {
      // x402 payment on scan
      const x402ApiUrl = process.env.X402_API_URL;
      if (x402ApiUrl && scored.length > 0) {
        try {
          callbacks.log("[x402] Paying for market analysis on Solana...");
          await fetch(`${x402ApiUrl}/prediction`);
        } catch {}
      }
      // Record price snapshots for sell-only path
      if (jupFull || lowSolBalance || breakerActive) {
        for (const p of jupAllPositions) {
          if (p.pubkey && p.curPrice && p.curPrice > 0) {
            recordJupPriceSnapshot(state, p.pubkey, p.curPrice);
          }
        }
        const jupActiveKeys = new Set(jupAllPositions.map(p => p.pubkey).filter(Boolean) as string[]);
        pruneStaleJupHistory(state, jupActiveKeys);
      }
    },
  });
};
```

- [ ] **Step 4: Clean up unused imports**

After deduplication, verify which imports are still needed. The `MIN_BET_SIZE_USD` import should already exist; `MIN_BET_SIZE_JUP` may need to be added to the config import if not already present.

- [ ] **Step 5: Verify**

Run: `bun run typecheck && bun test`
Expected: 0 errors, 153 tests pass

- [ ] **Step 6: Commit**

```bash
git add autonomy.ts
git commit -m "refactor: deduplicate poly/jup buy phases with platformBuyPhase()"
```

---

### Task 9: Extract `startAutonomy` to `autonomy-loop.ts`

**Files:**
- Create: `autonomy-loop.ts`
- Modify: `autonomy.ts`
- Modify: `ws-server.ts`

- [ ] **Step 1: Export `runAutonomyCycle` from `autonomy.ts`**

Change the function signature in `autonomy.ts`:

```ts
// Before:
async function runAutonomyCycle(
// After:
export async function runAutonomyCycle(
```

Also remove the `startAutonomy` function and the re-exports of public types from `autonomy.ts`. Remove the type re-exports at the top:

```ts
// Remove these lines from autonomy.ts:
export type {
  AutonomyDeps,
  AutonomyCallbacks,
  AutonomyPlatform,
  AutonomyHandle,
} from "./autonomy-state";
```

Remove the imports that were only used by `startAutonomy`:

```ts
// Remove if no longer used in autonomy.ts:
import { PolymarketExtService } from "./plugins/polymarket-ext/service";
import { POLYMARKET_EXT_SERVICE_TYPE } from "./plugins/polymarket-ext/types";
import { X402SolanaService } from "./plugins/x402-solana/service";
import { X402_SERVICE_TYPE } from "./plugins/x402-solana/types";
import { HEARTBEAT_INTERVAL_MS, HEARTBEAT_MAX_FAILURES, AUTONOMY_INTERVAL_MS } from "./config";
```

Check: `X402SolanaService` and `X402_SERVICE_TYPE` are also used in `runAutonomyCycle` (for the status summary around line 706). Keep those. `PolymarketExtService` and `POLYMARKET_EXT_SERVICE_TYPE` are only used in `startAutonomy` for the heartbeat — those move to `autonomy-loop.ts`. `HEARTBEAT_INTERVAL_MS` and `HEARTBEAT_MAX_FAILURES` are only used in `startAutonomy` — move. `AUTONOMY_INTERVAL_MS` is only used in `startAutonomy` — move.

- [ ] **Step 2: Create `autonomy-loop.ts`**

```ts
/**
 * Autonomy lifecycle — public API, heartbeat management, timer scheduling.
 * Delegates cycle orchestration to autonomy.ts.
 */

import { log } from "./log";
import { AUTONOMY_INTERVAL_MS, HEARTBEAT_INTERVAL_MS, HEARTBEAT_MAX_FAILURES } from "./config";
import { PolymarketExtService } from "./plugins/polymarket-ext/service";
import { POLYMARKET_EXT_SERVICE_TYPE } from "./plugins/polymarket-ext/types";
import { X402SolanaService } from "./plugins/x402-solana/service";
import { X402_SERVICE_TYPE } from "./plugins/x402-solana/types";

import {
  type AutonomyDeps,
  type AutonomyCallbacks,
  type AutonomyPlatform,
  type AutonomyHandle,
  createState,
} from "./autonomy-state";

import { runAutonomyCycle } from "./autonomy";

// Re-export public types for consumers
export type { AutonomyDeps, AutonomyCallbacks, AutonomyPlatform, AutonomyHandle };

/**
 * Start the autonomy loop. Returns a handle to stop it.
 */
export function startAutonomy(
  deps: AutonomyDeps,
  callbacks: AutonomyCallbacks,
  platform: AutonomyPlatform = "both",
): AutonomyHandle {
  // ... (move the entire function body from autonomy.ts lines 733-834)
  // Replace the single console.warn with log.warn (already done in Task 6):
  //   log.warn("autonomy", `heartbeat failed (${consecutiveFailures}x): ${errMsg}`);
}
```

Copy the complete `startAutonomy` function body from `autonomy.ts`.

- [ ] **Step 3: Update `ws-server.ts` import**

```ts
// Before:
import { startAutonomy, type AutonomyHandle, type AutonomyPlatform } from "./autonomy";
// After:
import { startAutonomy, type AutonomyHandle, type AutonomyPlatform } from "./autonomy-loop";
```

- [ ] **Step 4: Verify**

Run: `bun run typecheck && bun test`
Expected: 0 errors, 153 tests pass

- [ ] **Step 5: Commit**

```bash
git add autonomy.ts autonomy-loop.ts ws-server.ts
git commit -m "refactor: extract startAutonomy to autonomy-loop.ts"
```

---

### Task 10: Security and housekeeping

**Files:**
- Modify: `.env` (permissions only)
- Create: `CONTRIBUTING.md`

- [ ] **Step 1: Tighten .env permissions**

```bash
chmod 600 .env
```

Verify: `ls -la .env` should show `-rw-------`.

- [ ] **Step 2: Create `CONTRIBUTING.md`**

```md
# Contributing

## Prerequisites

- [Bun](https://bun.sh/) (latest)
- Node.js >= 18

## Setup

```bash
bun install
cp .env.example .env
# Fill in your API keys in .env
```

## Running

```bash
# Polymarket demo (TUI)
bun run start

# Jupiter demo (TUI)
bun run jupiter

# WebSocket server + web dashboard
bun run web
```

## Testing

```bash
bun test
```

## Linting & Formatting

[Biome](https://biomejs.dev/) enforces code style — strict TypeScript, 2-space indent, double quotes, semicolons.

```bash
bun run lint          # check
bun run lint:fix      # auto-fix
bun run format        # format
bun run typecheck     # tsc --noEmit
```

## Pull Requests

CI runs lint + typecheck + test on every PR. All three must pass before merge.
```

- [ ] **Step 3: Commit**

```bash
chmod 600 .env
git add CONTRIBUTING.md
git commit -m "chore: add CONTRIBUTING.md, tighten .env permissions"
```

Note: `.env` is in `.gitignore` so the permission change won't be tracked by git, but it's applied locally.

---

### Task 11: Final verification

**Files:** none (verification only)

- [ ] **Step 1: Run full test suite**

Run: `bun test`
Expected: 153 tests pass, 0 fail

- [ ] **Step 2: Run typecheck**

Run: `bun run typecheck`
Expected: 0 errors

- [ ] **Step 3: Run linter**

Run: `bun run lint`
Expected: 0 errors (warnings for unused vars are OK)

- [ ] **Step 4: Verify no remaining console.log in migrated files**

Run: `grep -rn 'console\.\(log\|warn\|error\)' --include='*.ts' --include='*.tsx' | grep -v node_modules | grep -v '.test.ts' | grep -v 'approve-usdc.ts' | grep -v 'ink-input-test' | grep -v 'x402-test-server'`

Expected: 0 matches (all migrated files clean; test files, approve-usdc, ink-input-test, and x402-test-server are excluded from migration).

- [ ] **Step 5: Verify file sizes improved**

Run: `wc -l autonomy.ts autonomy-llm.ts autonomy-loop.ts`
Expected: autonomy.ts ~400, autonomy-llm.ts ~530, autonomy-loop.ts ~120
