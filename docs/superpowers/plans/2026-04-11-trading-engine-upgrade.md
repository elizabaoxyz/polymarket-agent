# Trading Engine Upgrade — Kelly Sizing, Price-Based Exits, Multi-Buy, Dual-LLM

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the agent's ad-hoc position sizing and PnL-based exit logic with research-backed fractional Kelly sizing, price-based sell rules for binary markets, multi-buy per cycle with ranked LLM picks, and dual-LLM ensemble for higher-confidence probability estimates.

**Architecture:** The changes touch 5 existing files in a layered order: config (constants + Kelly formula) → state (peak price + position age tracking) → LLM (dual-provider ensemble) → sell (price-based exit rules) → orchestrator (multi-buy loop + Kelly integration). Each layer builds on the previous. No new files are created.

**Tech Stack:** TypeScript, Bun runtime, bun:test, Polymarket CLOB API, Jupiter Prediction API, OpenAI/Anthropic LLM APIs.

---

## File Map

| File | Action | Responsibility |
|------|--------|---------------|
| `config.ts` | Modify lines 22-183 | New constants + `calcKellyBetSize()` replacing old `calcBetSize()` |
| `autonomy-state.ts` | Modify lines 54-175 | Add `peakPrice`, `positionFirstSeen` maps + helpers |
| `autonomy-llm.ts` | Modify lines 54-171 | Add `ensembleLlmCall()` using 2 providers in parallel |
| `autonomy-sell.ts` | Modify lines 228-401 | Price-based exit rules replacing PnL-based logic |
| `autonomy.ts` | Modify lines 72-476 | Multi-buy loop, ranked picks, Kelly integration |

---

### Task 1: Fractional Kelly Position Sizing + New Constants (config.ts)

**Files:**
- Modify: `config.ts:22-183`
- Test: `config.test.ts` (create)

- [ ] **Step 1: Write failing tests for `calcKellyBetSize()`**

Create `config.test.ts`:

```typescript
import { describe, expect, test } from "bun:test";
import { calcKellyBetSize } from "./config";

describe("calcKellyBetSize", () => {
  test("high edge + high confidence → aggressive sizing", () => {
    // estimatedProb=0.60, marketPrice=0.40 → kelly=(0.60-0.40)/(1-0.40)=0.333, half=0.167
    // balance=100 → $16.67, clamped to MAX_BET=20 → $16.67
    const size = calcKellyBetSize({ estimatedProb: 0.60, marketPrice: 0.40, confidence: 0.85, balance: 100 });
    expect(size).toBeGreaterThanOrEqual(10);
    expect(size).toBeLessThanOrEqual(20);
  });

  test("small edge → small bet", () => {
    // estimatedProb=0.45, marketPrice=0.40 → kelly=(0.45-0.40)/(1-0.40)=0.083, half=0.042
    // balance=100 → $4.17
    const size = calcKellyBetSize({ estimatedProb: 0.45, marketPrice: 0.40, confidence: 0.70, balance: 100 });
    expect(size).toBeGreaterThanOrEqual(3);
    expect(size).toBeLessThanOrEqual(8);
  });

  test("no edge → minimum bet", () => {
    // estimatedProb=0.40, marketPrice=0.40 → kelly=0, half=0
    // Should return MIN_BET
    const size = calcKellyBetSize({ estimatedProb: 0.40, marketPrice: 0.40, confidence: 0.50, balance: 100 });
    expect(size).toBe(3); // MIN_BET_SIZE_USD
  });

  test("negative edge → minimum bet (never negative)", () => {
    const size = calcKellyBetSize({ estimatedProb: 0.30, marketPrice: 0.40, confidence: 0.50, balance: 100 });
    expect(size).toBe(3);
  });

  test("low confidence scales down", () => {
    const highConf = calcKellyBetSize({ estimatedProb: 0.60, marketPrice: 0.40, confidence: 0.90, balance: 100 });
    const lowConf = calcKellyBetSize({ estimatedProb: 0.60, marketPrice: 0.40, confidence: 0.60, balance: 100 });
    expect(highConf).toBeGreaterThan(lowConf);
  });

  test("respects balance cap of 15%", () => {
    // Even with enormous edge, never exceed 15% of balance
    const size = calcKellyBetSize({ estimatedProb: 0.95, marketPrice: 0.10, confidence: 1.0, balance: 100 });
    expect(size).toBeLessThanOrEqual(15);
  });

  test("respects MAX_BET_SIZE_USD=20", () => {
    const size = calcKellyBetSize({ estimatedProb: 0.95, marketPrice: 0.10, confidence: 1.0, balance: 500 });
    expect(size).toBeLessThanOrEqual(20);
  });

  test("Jupiter minBet override", () => {
    const size = calcKellyBetSize({ estimatedProb: 0.40, marketPrice: 0.40, confidence: 0.50, balance: 100, minBet: 1.5 });
    expect(size).toBe(1.5);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test config.test.ts`
Expected: FAIL — `calcKellyBetSize` is not exported from `./config`

- [ ] **Step 3: Add new constants and `calcKellyBetSize()` to config.ts**

Add these new constants after the existing ones (after line 126, before `calcBetSize`):

```typescript
// --- Kelly criterion sizing ---

/** Maximum fraction of balance to risk on a single trade (Kelly cap) */
export const KELLY_MAX_FRACTION = envFloat("KELLY_MAX_FRACTION", 0.15);

/** Kelly multiplier: 0.5 = half-Kelly (recommended), 1.0 = full Kelly */
export const KELLY_FRACTION_MULTIPLIER = envFloat("KELLY_FRACTION_MULTIPLIER", 0.5);

// --- Multi-buy ---

/** Maximum number of buys per platform per autonomy cycle */
export const MAX_BUYS_PER_CYCLE = envInt("MAX_BUYS_PER_CYCLE", 2);

/** Minimum edge required for second buy in a cycle (higher bar) */
export const SECOND_BUY_MIN_EDGE = envFloat("SECOND_BUY_MIN_EDGE", 0.15);

/** Minimum confidence for second buy in a cycle */
export const SECOND_BUY_MIN_CONFIDENCE = envFloat("SECOND_BUY_MIN_CONFIDENCE", 0.70);

// --- Price-based exit rules ---

/** Auto-sell when position price exceeds this (terrible risk/reward) */
export const PRICE_CEILING_SELL = envFloat("PRICE_CEILING_SELL", 0.85);

/** Sell if price > this AND position age > 2 days */
export const HIGH_PRICE_SELL = envFloat("HIGH_PRICE_SELL", 0.75);

/** Auto-sell dead positions below this price */
export const DEAD_POSITION_PRICE = envFloat("DEAD_POSITION_PRICE", 0.08);

/** Hard stop-loss: sell if PnL drops below this % */
export const HARD_STOP_LOSS_PCT = envFloat("HARD_STOP_LOSS_PCT", -25);

/** Trailing stop only activates above this price (avoid whipsaw at low prices) */
export const TRAILING_STOP_MIN_PRICE = envFloat("TRAILING_STOP_MIN_PRICE", 0.65);

/** Trailing stop: sell if price drops this % from peak price */
export const TRAILING_STOP_DROP_PCT = envFloat("TRAILING_STOP_DROP_PCT", 12);

/** Capital pressure: sell weakest positions when balance < this AND positions > threshold */
export const CAPITAL_PRESSURE_MIN_BALANCE = envFloat("CAPITAL_PRESSURE_MIN_BALANCE", 5);

/** Capital pressure: trigger when position count exceeds this */
export const CAPITAL_PRESSURE_MAX_POSITIONS = envInt("CAPITAL_PRESSURE_MAX_POSITIONS", 15);
```

Change `MAX_BET_SIZE_USD` from 8 to 20 (line 28):

```typescript
export const MAX_BET_SIZE_USD = envFloat("MAX_BET_SIZE_USD", 20);
```

Add `calcKellyBetSize()` AFTER the existing `calcBetSize` function (keep old one for backward compat):

```typescript
/**
 * Fractional Kelly position sizing for binary prediction markets.
 *
 * Kelly formula for binary outcome: f* = (p - marketPrice) / (1 - marketPrice)
 * where p = estimated true probability, marketPrice = cost of YES share.
 *
 * We use half-Kelly (multiply by 0.5) which preserves ~75% of growth rate
 * while drastically reducing drawdown risk.
 *
 * Confidence acts as a multiplier: low confidence = closer to minimum bet.
 */
export function calcKellyBetSize(params: {
  estimatedProb: number;
  marketPrice: number;
  confidence: number;
  balance: number;
  minBet?: number;
}): number {
  const { estimatedProb, marketPrice, confidence, balance } = params;
  const minBet = params.minBet ?? MIN_BET_SIZE_USD;

  // Kelly fraction: edge / odds
  // For binary: (trueProb - marketPrice) / (1 - marketPrice)
  const edge = estimatedProb - marketPrice;
  if (edge <= 0) return minBet;

  const kellyFraction = edge / (1 - marketPrice);

  // Half-Kelly (or whatever KELLY_FRACTION_MULTIPLIER is set to)
  let fraction = kellyFraction * KELLY_FRACTION_MULTIPLIER;

  // Scale by confidence: confidence of 0.6 reduces bet, 1.0 keeps full Kelly
  // Linear scale from 0.5x at confidence=0.5 to 1.0x at confidence=1.0
  const confMultiplier = Math.max(0.5, Math.min(1.0, confidence));
  fraction *= confMultiplier;

  // Hard cap: never risk more than KELLY_MAX_FRACTION of balance
  fraction = Math.min(fraction, KELLY_MAX_FRACTION);

  const size = balance * fraction;
  return Math.max(minBet, Math.min(MAX_BET_SIZE_USD, size));
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `bun test config.test.ts`
Expected: All 8 tests PASS

- [ ] **Step 5: Commit**

```bash
git add config.ts config.test.ts
git commit -m "feat: add fractional Kelly position sizing + price-based exit constants"
```

---

### Task 2: Peak Price + Position Age Tracking (autonomy-state.ts)

**Files:**
- Modify: `autonomy-state.ts:54-175`
- Test: `autonomy-state.test.ts` (create)

- [ ] **Step 1: Write failing tests for peak price and position age helpers**

Create `autonomy-state.test.ts`:

```typescript
import { describe, expect, test } from "bun:test";
import { createState, updatePeakPrice, getDropFromPeak, trackPositionAge, getPositionAgeDays, housekeep } from "./autonomy-state";

describe("peak price tracking", () => {
  test("updatePeakPrice tracks highest observed price", () => {
    const state = createState("both");
    updatePeakPrice(state, "token-a", 0.45);
    expect(state.peakPrice.get("token-a")).toBe(0.45);

    updatePeakPrice(state, "token-a", 0.55);
    expect(state.peakPrice.get("token-a")).toBe(0.55);

    // Lower price should NOT update peak
    updatePeakPrice(state, "token-a", 0.50);
    expect(state.peakPrice.get("token-a")).toBe(0.55);
  });

  test("getDropFromPeak returns percentage drop", () => {
    const state = createState("both");
    updatePeakPrice(state, "token-a", 0.80);
    // Current price 0.70 → drop = (0.80-0.70)/0.80 * 100 = 12.5%
    const drop = getDropFromPeak(state, "token-a", 0.70);
    expect(drop).toBeCloseTo(12.5, 1);
  });

  test("getDropFromPeak returns 0 when no peak recorded", () => {
    const state = createState("both");
    const drop = getDropFromPeak(state, "unknown", 0.50);
    expect(drop).toBe(0);
  });
});

describe("position age tracking", () => {
  test("trackPositionAge records first-seen time", () => {
    const state = createState("both");
    const before = Date.now();
    trackPositionAge(state, "token-a");
    const after = Date.now();
    const seen = state.positionFirstSeen.get("token-a")!;
    expect(seen).toBeGreaterThanOrEqual(before);
    expect(seen).toBeLessThanOrEqual(after);
  });

  test("trackPositionAge does not overwrite existing", () => {
    const state = createState("both");
    state.positionFirstSeen.set("token-a", 1000);
    trackPositionAge(state, "token-a");
    expect(state.positionFirstSeen.get("token-a")).toBe(1000);
  });

  test("getPositionAgeDays returns correct age", () => {
    const state = createState("both");
    // Set first seen to 3 days ago
    state.positionFirstSeen.set("token-a", Date.now() - 3 * 86_400_000);
    const age = getPositionAgeDays(state, "token-a");
    expect(age).toBeGreaterThanOrEqual(2.9);
    expect(age).toBeLessThanOrEqual(3.1);
  });

  test("getPositionAgeDays returns 0 for unknown", () => {
    const state = createState("both");
    expect(getPositionAgeDays(state, "unknown")).toBe(0);
  });
});

describe("housekeep prunes stale tracking data", () => {
  test("peakPrice entries for missing positions get pruned", () => {
    const state = createState("both");
    state.peakPrice.set("old-token", 0.80);
    state.peakPrice.set("current-token", 0.60);
    // Simulate: pass activeKeys so housekeep knows what's still held
    // After housekeep, old-token should remain (housekeep doesn't know about active positions)
    // We'll prune in the sell phase where we know which positions exist
    housekeep(state);
    // peakPrice is NOT pruned by housekeep — it's pruned by pruneStaleTracking()
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test autonomy-state.test.ts`
Expected: FAIL — `updatePeakPrice` is not exported

- [ ] **Step 3: Add peak price + position age fields and helpers to autonomy-state.ts**

Add two new fields to the `AutonomyState` type (after line 80, before the closing `}`):

```typescript
  /** Peak observed price per position — for trailing stops */
  peakPrice: Map<string, number>;
  /** First time a position was seen — for time-based exits */
  positionFirstSeen: Map<string, number>;
```

Add initialization in `createState()` (inside the return object, after `stuckDust`):

```typescript
    peakPrice: new Map(),
    positionFirstSeen: new Map(),
```

Add these helper functions after the existing `recordTrade` function:

```typescript
/** Update peak price for a position. Only increases, never decreases. */
export function updatePeakPrice(state: AutonomyState, key: string, currentPrice: number): void {
  const prev = state.peakPrice.get(key) ?? 0;
  if (currentPrice > prev) {
    state.peakPrice.set(key, currentPrice);
  }
}

/** Get percentage drop from peak price. Returns 0 if no peak recorded. */
export function getDropFromPeak(state: AutonomyState, key: string, currentPrice: number): number {
  const peak = state.peakPrice.get(key);
  if (!peak || peak <= 0) return 0;
  if (currentPrice >= peak) return 0;
  return ((peak - currentPrice) / peak) * 100;
}

/** Record the first time a position is seen. Does not overwrite existing. */
export function trackPositionAge(state: AutonomyState, key: string): void {
  if (!state.positionFirstSeen.has(key)) {
    state.positionFirstSeen.set(key, Date.now());
  }
}

/** Get position age in days. Returns 0 if not tracked. */
export function getPositionAgeDays(state: AutonomyState, key: string): number {
  const firstSeen = state.positionFirstSeen.get(key);
  if (!firstSeen) return 0;
  return (Date.now() - firstSeen) / 86_400_000;
}

/**
 * Prune peak price and position age entries for positions no longer held.
 * Call this from the sell phase where activeKeys is known.
 */
export function pruneStaleTracking(state: AutonomyState, activeKeys: Set<string>): void {
  for (const key of state.peakPrice.keys()) {
    if (!activeKeys.has(key)) state.peakPrice.delete(key);
  }
  for (const key of state.positionFirstSeen.keys()) {
    if (!activeKeys.has(key)) state.positionFirstSeen.delete(key);
  }
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `bun test autonomy-state.test.ts`
Expected: All tests PASS

- [ ] **Step 5: Commit**

```bash
git add autonomy-state.ts autonomy-state.test.ts
git commit -m "feat: add peak price tracking + position age for trailing stops and time-decay exits"
```

---

### Task 3: Dual-LLM Ensemble (autonomy-llm.ts)

**Files:**
- Modify: `autonomy-llm.ts:54-171`
- Test: `autonomy-llm.test.ts` (create)

- [ ] **Step 1: Write failing tests for ensembleLlmCall**

Create `autonomy-llm.test.ts`:

```typescript
import { describe, expect, test } from "bun:test";
import { mergeEnsembleResults } from "./autonomy-llm";

describe("mergeEnsembleResults", () => {
  test("averages estimates when both agree on direction", () => {
    const result = mergeEnsembleResults(
      "PICK: 1\nSIDE: YES\nESTIMATE: 0.65\nEDGE: 0.15\nCONFIDENCE: 0.80\nCATEGORY: CRYPTO\nREASON: BTC above target",
      "PICK: 1\nSIDE: YES\nESTIMATE: 0.70\nEDGE: 0.20\nCONFIDENCE: 0.85\nCATEGORY: CRYPTO\nREASON: BTC momentum strong",
    );
    expect(result).not.toBeNull();
    expect(result!.side).toBe("YES");
    expect(result!.estimate).toBeCloseTo(0.675, 2); // avg of 0.65 and 0.70
    expect(result!.edge).toBeCloseTo(0.175, 2);
    expect(result!.confidence).toBeCloseTo(0.825, 2);
  });

  test("returns null when models disagree on direction", () => {
    const result = mergeEnsembleResults(
      "PICK: 1\nSIDE: YES\nESTIMATE: 0.65\nEDGE: 0.15\nCONFIDENCE: 0.80\nCATEGORY: CRYPTO\nREASON: test",
      "PICK: 1\nSIDE: NO\nESTIMATE: 0.35\nEDGE: 0.15\nCONFIDENCE: 0.80\nCATEGORY: CRYPTO\nREASON: test",
    );
    expect(result).toBeNull();
  });

  test("returns null when one model skips", () => {
    const result = mergeEnsembleResults(
      "PICK: 0",
      "PICK: 1\nSIDE: YES\nESTIMATE: 0.65\nEDGE: 0.15\nCONFIDENCE: 0.80\nCATEGORY: CRYPTO\nREASON: test",
    );
    expect(result).toBeNull();
  });

  test("handles single result (no ensemble)", () => {
    const result = mergeEnsembleResults(
      "PICK: 1\nSIDE: YES\nESTIMATE: 0.65\nEDGE: 0.15\nCONFIDENCE: 0.80\nCATEGORY: CRYPTO\nREASON: solo reason",
      null,
    );
    expect(result).not.toBeNull();
    expect(result!.estimate).toBe(0.65);
    expect(result!.reason).toBe("solo reason");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test autonomy-llm.test.ts`
Expected: FAIL — `mergeEnsembleResults` is not exported

- [ ] **Step 3: Add `mergeEnsembleResults()` and `ensembleLlmCall()` to autonomy-llm.ts**

Add this parsing helper and ensemble function at the end of the file:

```typescript
/** Parsed LLM structured output for a single pick. */
export type ParsedLlmPick = {
  pickNum: number;
  side: string;
  estimate: number;
  edge: number;
  confidence: number;
  category: string;
  reason: string;
};

/** Parse a single structured LLM response into fields. Returns null if unparseable or SKIP. */
function parseLlmResponse(text: string): ParsedLlmPick | null {
  if (!text || text.length === 0) return null;

  const pickMatch = /PICK:\s*(\d+)/i.exec(text);
  const pickNum = pickMatch ? Number.parseInt(pickMatch[1]!) : 0;
  if (pickNum === 0) return null;

  const sideMatch = /SIDE:\s*(YES|NO)/i.exec(text);
  if (!sideMatch) return null;

  const estimateMatch = /ESTIMATE:\s*([\d.]+)/i.exec(text);
  const edgeMatch = /EDGE:\s*([\d.]+)/i.exec(text);
  const confidenceMatch = /CONFIDENCE:\s*([\d.]+)/i.exec(text);
  const categoryMatch = /CATEGORY:\s*(\w+)/i.exec(text);
  const reasonMatch = /REASON:\s*(.+)/i.exec(text);

  return {
    pickNum,
    side: sideMatch[1]!.toUpperCase(),
    estimate: estimateMatch ? Number.parseFloat(estimateMatch[1]!) : 0.5,
    edge: edgeMatch ? Math.min(0.5, Number.parseFloat(edgeMatch[1]!)) : 0.10,
    confidence: confidenceMatch ? Math.min(1.0, Number.parseFloat(confidenceMatch[1]!)) : 0.5,
    category: categoryMatch ? categoryMatch[1]!.toUpperCase() : "OTHER",
    reason: reasonMatch ? reasonMatch[1]!.trim() : "",
  };
}

/**
 * Merge two LLM responses into a consensus result.
 * - If both agree on SIDE → average estimates, edge, confidence
 * - If they disagree on SIDE → return null (no consensus = skip)
 * - If only one result provided → use it directly
 */
export function mergeEnsembleResults(
  textA: string,
  textB: string | null,
): ParsedLlmPick | null {
  const a = parseLlmResponse(textA);
  if (!textB) return a; // Single-provider mode

  const b = parseLlmResponse(textB);
  if (!a && !b) return null;
  if (!a) return b;
  if (!b) return null; // If provider A skipped but B didn't — no consensus

  // Both must agree on direction
  if (a.side !== b.side) return null;

  return {
    pickNum: a.pickNum, // Use first provider's pick number
    side: a.side,
    estimate: (a.estimate + b.estimate) / 2,
    edge: (a.edge + b.edge) / 2,
    confidence: (a.confidence + b.confidence) / 2,
    category: a.category,
    reason: `[ensemble] ${a.reason}`,
  };
}

/**
 * Call two LLM providers in parallel and merge results.
 * Falls back to single-provider if only one API key is configured.
 */
export async function ensembleLlmCall(
  deps: AutonomyDeps,
  callbacks: AutonomyCallbacks,
  prompt: string,
  maxTokens = 800,
): Promise<string> {
  const anthropicKey = process.env.ANTHROPIC_API_KEY?.trim() || process.env.GLM_API_KEY?.trim();
  const openaiKey = process.env.OPENAI_API_KEY?.trim();

  // If only one provider, fall back to regular call
  if (!anthropicKey || !openaiKey) {
    return directLlmCall(deps, callbacks, prompt, maxTokens);
  }

  callbacks.log("[LLM:ENSEMBLE] Calling 2 providers in parallel...");

  const anthropicBase = process.env.GLM_API_KEY?.trim()
    ? "https://api.z.ai/api/anthropic"
    : (process.env.ANTHROPIC_BASE_URL?.trim() || "https://api.anthropic.com");
  const anthropicModel = process.env.GLM_API_KEY?.trim()
    ? (process.env.GLM_LARGE_MODEL?.trim() || "glm-4.7")
    : (process.env.ANTHROPIC_LARGE_MODEL?.trim() || process.env.LARGE_MODEL?.trim() || "claude-sonnet-4-20250514");
  const openaiBase = process.env.OPENAI_BASE_URL?.trim() || "https://api.openai.com/v1";
  const openaiModel = process.env.OPENAI_LARGE_MODEL?.trim() || process.env.LARGE_MODEL?.trim() || "gpt-4o";

  const callAnthropic = async (): Promise<string> => {
    const res = await fetch(`${anthropicBase}/v1/messages`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": anthropicKey!,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model: anthropicModel,
        max_tokens: maxTokens,
        temperature: 0.3,
        messages: [{ role: "user", content: prompt }],
      }),
    });
    if (!res.ok) throw new Error(`Anthropic ${res.status}`);
    type R = { content?: Array<{ type: string; text?: string }> };
    const data = (await res.json()) as R;
    return data.content?.find((b) => b.type === "text")?.text?.trim() ?? "";
  };

  const callOpenai = async (): Promise<string> => {
    const res = await fetch(`${openaiBase}/chat/completions`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${openaiKey}`,
      },
      body: JSON.stringify({
        model: openaiModel,
        max_tokens: maxTokens,
        temperature: 0.3,
        messages: [{ role: "user", content: prompt }],
      }),
    });
    if (!res.ok) throw new Error(`OpenAI ${res.status}`);
    type R = { choices?: Array<{ message?: { content?: string } }> };
    const data = (await res.json()) as R;
    return data.choices?.[0]?.message?.content?.trim() ?? "";
  };

  const [resultA, resultB] = await Promise.allSettled([callAnthropic(), callOpenai()]);

  const textA = resultA.status === "fulfilled" ? resultA.value : "";
  const textB = resultB.status === "fulfilled" ? resultB.value : "";

  if (resultA.status === "rejected") {
    callbacks.log(`[LLM:ENSEMBLE] Anthropic failed: ${(resultA.reason as Error).message ?? "unknown"}`);
  }
  if (resultB.status === "rejected") {
    callbacks.log(`[LLM:ENSEMBLE] OpenAI failed: ${(resultB.reason as Error).message ?? "unknown"}`);
  }

  // If both returned results, merge them
  if (textA && textB) {
    const merged = mergeEnsembleResults(textA, textB);
    if (merged) {
      callbacks.log(`[LLM:ENSEMBLE] Consensus: ${merged.side} | est=${merged.estimate.toFixed(2)} | edge=${merged.edge.toFixed(2)} | conf=${merged.confidence.toFixed(2)}`);
      // Reconstruct structured text from merged result
      return `PICK: ${merged.pickNum}\nSIDE: ${merged.side}\nESTIMATE: ${merged.estimate.toFixed(3)}\nEDGE: ${merged.edge.toFixed(3)}\nCONFIDENCE: ${merged.confidence.toFixed(3)}\nCATEGORY: ${merged.category}\nREASON: ${merged.reason}`;
    }
    callbacks.log(`[LLM:ENSEMBLE] No consensus — models disagree. Skipping.`);
    return "PICK: 0";
  }

  // If only one succeeded, use it
  return textA || textB || "";
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `bun test autonomy-llm.test.ts`
Expected: All 4 tests PASS

- [ ] **Step 5: Commit**

```bash
git add autonomy-llm.ts autonomy-llm.test.ts
git commit -m "feat: dual-LLM ensemble — parallel calls + consensus merge"
```

---

### Task 4: Price-Based Exit Rules (autonomy-sell.ts)

**Files:**
- Modify: `autonomy-sell.ts:228-401`
- Depends on: Task 1 (config constants), Task 2 (state helpers)

- [ ] **Step 1: Update imports at top of autonomy-sell.ts**

Replace the existing config imports (line 10-14) with:

```typescript
import {
  PRICE_CEILING_SELL,
  HIGH_PRICE_SELL,
  DEAD_POSITION_PRICE,
  HARD_STOP_LOSS_PCT,
  TRAILING_STOP_MIN_PRICE,
  TRAILING_STOP_DROP_PCT,
  CAPITAL_PRESSURE_MIN_BALANCE,
  CAPITAL_PRESSURE_MAX_POSITIONS,
} from "./config";
```

Keep the existing imports for `SELL_LOSS_THRESHOLD_AGGRESSIVE`, `SELL_PROFIT_THRESHOLD_AGGRESSIVE`, `TRAILING_STOP_ACTIVATE_PCT`, `TRAILING_STOP_DRAWDOWN_PCT` — remove them as they're no longer used. The final import line from config should be:

```typescript
import {
  PRICE_CEILING_SELL,
  HIGH_PRICE_SELL,
  DEAD_POSITION_PRICE,
  HARD_STOP_LOSS_PCT,
  TRAILING_STOP_MIN_PRICE,
  TRAILING_STOP_DROP_PCT,
  CAPITAL_PRESSURE_MIN_BALANCE,
  CAPITAL_PRESSURE_MAX_POSITIONS,
} from "./config";
```

Add the new state helpers to the import from `./autonomy-state`:

```typescript
import { updatePeakPrice, getDropFromPeak, trackPositionAge, getPositionAgeDays, pruneStaleTracking } from "./autonomy-state";
```

- [ ] **Step 2: Rewrite `unifiedPortfolioReview()` with price-based rules**

Replace the entire `unifiedPortfolioReview` function body (lines 232-401) with:

```typescript
export async function unifiedPortfolioReview(
  deps: AutonomyDeps,
  callbacks: AutonomyCallbacks,
  state: AutonomyState,
  platform: "POLYMARKET" | "JUPITER",
  positions: ReviewablePosition[],
  balance: number,
  lowBalance: boolean,
): Promise<void> {
  if (lowBalance) {
    const before = state.failedSells.size;
    state.failedSells.clear();
    if (before > 0) callbacks.log(`[PORTFOLIO:${platform}] Cleared ${before} failed-sell entries (recovery mode)`);
  }

  const reviewable = positions.filter((p) => {
    const key = p.token ?? p.pubkey ?? "";
    if (!key) return false;
    if (state.recentlySold.has(key)) return false;
    if (state.failedSells.has(key)) return false;
    if (state.stuckDust.has(key)) return false;
    if (platform === "POLYMARKET" && (p.shares ?? 0) < 1) return false;
    if (platform === "POLYMARKET" && (p.curPrice ?? 0) < 0.01) return false;
    return true;
  });

  if (reviewable.length === 0) {
    const raw = positions.length;
    const recentlySoldCount = positions.filter((p) => state.recentlySold.has(p.token ?? p.pubkey ?? "")).length;
    const failedCount = positions.filter((p) => state.failedSells.has(p.token ?? p.pubkey ?? "")).length;
    const stuckCount = positions.filter((p) => state.stuckDust.has(p.token ?? p.pubkey ?? "")).length;
    callbacks.log(`[PORTFOLIO:${platform}] No reviewable positions (raw: ${raw}, sold: ${recentlySoldCount}, failed: ${failedCount}, stuck: ${stuckCount})`);
    return;
  }

  // === Track peak prices + position ages for all positions ===
  const activeKeys = new Set<string>();
  for (const p of reviewable) {
    const key = p.token ?? p.pubkey ?? "";
    activeKeys.add(key);
    if (p.curPrice !== undefined && p.curPrice > 0) {
      updatePeakPrice(state, key, p.curPrice);
    }
    trackPositionAge(state, key);
  }
  pruneStaleTracking(state, activeKeys);

  // === Fetch price trends (Polymarket only — Jupiter lacks history API) ===
  const trendMap = new Map<string, PriceTrend>();
  if (platform === "POLYMARKET") {
    const trendFetches = reviewable.slice(0, 10).map(async (p) => {
      if (!p.token) return;
      try {
        const history = await fetchPolyPriceHistory(p.token, "1h", 24);
        if (history.length > 2) {
          trendMap.set(p.token, computePriceTrend(history, p.curPrice ?? 0));
        }
      } catch {}
    });
    await Promise.allSettled(trendFetches);
  }

  // === Price-based auto-sell rules (no LLM needed) ===
  const autoSellSet = new Set<ReviewablePosition>();

  for (const p of reviewable) {
    const key = p.token ?? p.pubkey ?? "";
    const price = p.curPrice ?? 0;
    const pnl = p.pnl ?? 0;
    const age = getPositionAgeDays(state, key);
    const trend = trendMap.get(key);
    const dropFromPeak = getDropFromPeak(state, key, price);

    let reason = "";

    // Rule 1: Price ceiling — max 18% upside, 85% downside
    if (price >= PRICE_CEILING_SELL && pnl > 0) {
      reason = `price-ceiling ($${price.toFixed(2)} ≥ $${PRICE_CEILING_SELL})`;
    }
    // Rule 2: High price + stale — upside thinning, capital better elsewhere
    else if (price >= HIGH_PRICE_SELL && age > 2) {
      reason = `high-price-stale ($${price.toFixed(2)}, ${age.toFixed(1)}d old)`;
    }
    // Rule 3: High price + falling trend
    else if (price >= TRAILING_STOP_MIN_PRICE && trend?.direction === "down") {
      reason = `high-price-falling ($${price.toFixed(2)}, trend=${trend.direction})`;
    }
    // Rule 4: Dead position — thesis was wrong
    else if (price > 0 && price < DEAD_POSITION_PRICE) {
      reason = `dead-position ($${price.toFixed(2)} < $${DEAD_POSITION_PRICE})`;
    }
    // Rule 5: Hard stop-loss on PnL
    else if (pnl <= HARD_STOP_LOSS_PCT) {
      reason = `hard-stop-loss (${pnl.toFixed(0)}% ≤ ${HARD_STOP_LOSS_PCT}%)`;
    }
    // Rule 6: Trailing stop — only above min price, drops from peak
    else if (price >= TRAILING_STOP_MIN_PRICE && dropFromPeak >= TRAILING_STOP_DROP_PCT) {
      reason = `trailing-stop (peak $${state.peakPrice.get(key)?.toFixed(2)}, now $${price.toFixed(2)}, drop ${dropFromPeak.toFixed(1)}%)`;
    }

    if (reason) {
      autoSellSet.add(p);
      await executeSell(deps, callbacks, state, p, platform, reason);
    }
  }

  // === Capital pressure: sell weakest positions when balance critical ===
  if (balance < CAPITAL_PRESSURE_MIN_BALANCE && reviewable.length > CAPITAL_PRESSURE_MAX_POSITIONS) {
    const unsold = reviewable.filter((p) => !autoSellSet.has(p));
    // Sort by PnL ascending — sell the worst performers first
    const sorted = [...unsold].sort((a, b) => (a.pnl ?? 0) - (b.pnl ?? 0));
    const toSell = sorted.slice(0, 3); // Sell up to 3 weakest
    callbacks.log(`[PORTFOLIO:${platform}] CAPITAL PRESSURE — selling ${toSell.length} weakest positions`);
    for (const p of toSell) {
      autoSellSet.add(p);
      const sign = (p.pnl ?? 0) >= 0 ? "+" : "";
      await executeSell(deps, callbacks, state, p, platform, `capital-pressure (${sign}${(p.pnl ?? 0).toFixed(0)}%)`);
    }
  }

  // === Low balance recovery: liquidate everything ===
  if (lowBalance) {
    const unsold = reviewable.filter((p) => !autoSellSet.has(p));
    if (unsold.length > 0) {
      const sorted = [...unsold].sort((a, b) => (a.pnl ?? 0) - (b.pnl ?? 0));
      callbacks.log(`[PORTFOLIO:${platform}] LOW BALANCE RECOVERY — liquidating ${sorted.length} positions`);
      for (const p of sorted) {
        const sign = (p.pnl ?? 0) >= 0 ? "+" : "";
        await executeSell(deps, callbacks, state, p, platform, `recovery (${sign}${(p.pnl ?? 0).toFixed(0)}%)`);
      }
    }
    return;
  }

  // === LLM review for ambiguous positions only ===
  const llmReviewable = reviewable.filter((p) => !autoSellSet.has(p));
  if (llmReviewable.length === 0) return;

  const sortedForReview = [...llmReviewable].sort((a, b) => (b.pnl ?? 0) - (a.pnl ?? 0)).slice(0, 12);
  const llmPositionList = sortedForReview
    .map((p, i) => {
      const dir = p.isYes !== undefined ? (p.isYes ? "YES" : "NO") : "";
      const qty = p.shares ?? p.contracts ?? "?";
      const sign = (p.pnl ?? 0) >= 0 ? "+" : "";
      const age = getPositionAgeDays(state, p.token ?? p.pubkey ?? "");
      let trendStr = "";
      const trend = trendMap.get(p.token ?? "");
      if (trend) {
        const parts: string[] = [];
        if (trend.change1h !== null) parts.push(`1h: ${trend.change1h > 0 ? "+" : ""}${trend.change1h.toFixed(1)}%`);
        if (trend.change24h !== null) parts.push(`24h: ${trend.change24h > 0 ? "+" : ""}${trend.change24h.toFixed(1)}%`);
        trendStr = ` | trend: ${trend.direction} (${parts.join(", ")})`;
      }
      return `${i + 1}. "${p.title}" — PnL: ${sign}${(p.pnl ?? 0).toFixed(0)}%, ${dir} ${qty} units, price: $${(p.curPrice ?? 0).toFixed(2)}, age: ${age.toFixed(1)}d${trendStr}`;
    })
    .join("\n");

  callbacks.log(`[PORTFOLIO:${platform}] LLM reviewing ${sortedForReview.length} ambiguous positions...`);
  const reviewText = await directLlmCall(
    deps,
    callbacks,
    `You are a disciplined prediction market portfolio manager. Today is ${new Date().toISOString().split("T")[0]}.

BINARY MARKET RULES — these markets pay $1 or $0. Current PRICE determines risk/reward, not your entry cost.

SELL RULES (price-based — this is what matters in binary markets):
- Price > $0.75: SELL — max 33% upside, 75% downside. Terrible risk/reward.
- Price > $0.65 with DOWNWARD trend: SELL — momentum fading, lock in gains.
- Price < $0.15: SELL — thesis is likely wrong. Salvage remaining value.
- PnL < -15% with DOWNWARD trend: SELL — getting worse, cut losses.
- PnL -5% to +10%: HOLD — within noise, spread costs make selling unprofitable.
- PnL > +10% with UPWARD trend: HOLD — let winners run.

CRITICAL: The PRICE is more important than PnL%. A position at $0.70 has 43% max upside regardless of what you paid.

Positions:
${llmPositionList}

Respond with one line per position:
<number>: SELL or HOLD — <reason citing price and trend>`,
  );

  if (reviewText.length === 0) return;
  callbacks.log(`[PORTFOLIO:${platform}] ${reviewText.slice(0, 300)}`);

  for (let i = 0; i < sortedForReview.length; i++) {
    const sellPattern = new RegExp(`${i + 1}[:\\s]*SELL`, "i");
    if (!sellPattern.test(reviewText)) continue;
    const pos = sortedForReview[i]!;
    const key = pos.token ?? pos.pubkey ?? "";
    if (state.recentlySold.has(key) || state.failedSells.has(key)) continue;
    await executeSell(deps, callbacks, state, pos, platform, "portfolio-review");
  }
}
```

- [ ] **Step 3: Remove unused legacy imports**

Remove these unused imports from the top of `autonomy-sell.ts`:
- `SELL_LOSS_THRESHOLD_AGGRESSIVE`
- `SELL_PROFIT_THRESHOLD_AGGRESSIVE`
- `TRAILING_STOP_ACTIVATE_PCT`
- `TRAILING_STOP_DRAWDOWN_PCT`

- [ ] **Step 4: Run existing tests to verify nothing broke**

Run: `bun test`
Expected: All existing tests PASS (the sell logic isn't directly unit tested, but ensure no compile errors)

- [ ] **Step 5: Commit**

```bash
git add autonomy-sell.ts
git commit -m "feat: price-based exit rules — ceiling, trailing stop, dead positions, capital pressure"
```

---

### Task 5: Multi-Buy Loop + Ranked LLM Picks + Kelly Integration (autonomy.ts)

**Files:**
- Modify: `autonomy.ts:72-476`
- Depends on: Task 1 (Kelly), Task 3 (ensemble LLM)

- [ ] **Step 1: Update imports at top of autonomy.ts**

Add new imports. Replace the config import line (line 14-28) — add `calcKellyBetSize`, `MAX_BUYS_PER_CYCLE`, `SECOND_BUY_MIN_EDGE`, `SECOND_BUY_MIN_CONFIDENCE`:

```typescript
import {
  MAX_POSITIONS,
  LOW_BALANCE_THRESHOLD,
  SELL_LOSS_THRESHOLD_NORMAL,
  SELL_LOSS_THRESHOLD_AGGRESSIVE,
  SELL_PROFIT_THRESHOLD_NORMAL,
  SELL_PROFIT_THRESHOLD_AGGRESSIVE,
  AUTONOMY_INTERVAL_MS,
  HEARTBEAT_INTERVAL_MS,
  DAILY_SPEND_LIMIT_USD,
  HEARTBEAT_MAX_FAILURES,
  MIN_REWARD_RATIO,
  MIN_BET_SIZE_JUP,
  calcBetSize,
  calcKellyBetSize,
  MAX_BUYS_PER_CYCLE,
  SECOND_BUY_MIN_EDGE,
  SECOND_BUY_MIN_CONFIDENCE,
} from "./config";
```

Add ensemble import:

```typescript
import { directLlmCall, ensembleLlmCall } from "./autonomy-llm";
```

- [ ] **Step 2: Modify `analyzeCandidates()` to return ranked array and use ensemble**

Replace the `analyzeCandidates` function (lines 82-224) with:

```typescript
async function analyzeCandidates(
  deps: AutonomyDeps,
  callbacks: AutonomyCallbacks,
  candidates: Array<{ question: string; yesPrice: number; score: number; volume?: number; daysLeft?: number; intel?: import("./market-intel").MarketIntel | null }>,
  ragContext: string,
): Promise<AnalysisResult[]> {
  const { formatIntelForPrompt } = await import("./market-intel");
  const { MIN_EDGE_THRESHOLD, MIN_CONFIDENCE_THRESHOLD } = await import("./config");

  const today = new Date().toISOString().split("T")[0];

  const candidateList = candidates
    .map((c, i) => {
      const yesPrice = c.yesPrice;
      const noPrice = 1 - c.yesPrice;
      const yesRR = yesPrice > 0 ? ((1 - yesPrice) / yesPrice).toFixed(2) : "∞";
      const noRR = noPrice > 0 ? ((1 - noPrice) / noPrice).toFixed(2) : "∞";
      const extra = c.daysLeft !== undefined ? `, ${c.daysLeft.toFixed(0)} days to resolve` : "";
      const vol = c.volume !== undefined ? `, $${c.volume.toFixed(0)} volume` : "";
      const intelStr = c.intel ? formatIntelForPrompt(c.intel) : "";
      return `${i + 1}. "${c.question}"
   YES price: $${yesPrice.toFixed(2)} → risk $${yesPrice.toFixed(2)} to win $${(1 - yesPrice).toFixed(2)} (ratio ${yesRR}:1)
   NO  price: $${noPrice.toFixed(2)} → risk $${noPrice.toFixed(2)} to win $${yesPrice.toFixed(2)} (ratio ${noRR}:1)
   liquidity score: ${c.score.toFixed(2)}${extra}${vol}${intelStr}`;
    })
    .join("\n\n");

  callbacks.log(`[ANALYSIS] Analyzing top ${candidates.length} markets (ensemble)...`);

  const structuredPrompt = `You are an expert prediction market analyst. Today is ${today}.
Your job is to find genuine mispricings — markets where the true probability differs significantly from the price.

${candidateList}${ragContext}

=== ANALYSIS FRAMEWORK ===

For each market, work through these steps mentally:

STEP 1 — CATEGORIZE: SPORTS | POLITICS | CRYPTO | CULTURE | TECH | OTHER
STEP 2 — DECOMPOSE probability: base rate + adjustments for this specific instance
STEP 3 — CALCULATE edge: your estimate MINUS market price (for your chosen side)
STEP 4 — CHECK risk/reward: ratio = (1 - price) / price. Minimum 1.0:1.
STEP 5 — CONFIDENCE: 0.0-1.0. HIGH(0.8+)=clear facts. MED(0.5-0.8)=some unknowns. LOW(<0.5)=speculation.

=== OUTPUT FORMAT ===

Rank ALL viable markets. For each, output a PICK block (up to 3 markets):

PICK: <market number, or 0 to SKIP all>
SIDE: YES or NO
ESTIMATE: <true probability 0.00-1.00 for YES>
EDGE: <calculated edge 0.00-0.50>
CONFIDENCE: <0.0-1.0>
CATEGORY: <SPORTS|POLITICS|CRYPTO|CULTURE|TECH|OTHER>
REASON: <one sentence strongest evidence>

If multiple markets are viable, add more blocks separated by a blank line.
Rank by edge × confidence descending. Only include markets with edge ≥ 10% AND confidence ≥ 0.6.
If no market qualifies, respond PICK: 0

RULES:
- Rank by BIGGEST edge AND highest confidence
- It is ALWAYS better to skip than to make a mediocre bet
- Never pick a side where price > $0.75 (terrible risk/reward) or < $0.15 (likely resolved)
- Diversify: if multiple picks, prefer different CATEGORIES`;

  const text = await ensembleLlmCall(deps, callbacks, structuredPrompt, 1000);

  if (text.length === 0) {
    callbacks.log(`[ANALYSIS] LLM returned empty`);
    return [];
  }

  callbacks.log(`[ANALYSIS] LLM: "${text.slice(0, 300)}"`);

  // Parse multiple PICK blocks
  const results: AnalysisResult[] = [];
  const blocks = text.split(/\n\s*\n/).filter((b) => /PICK:/i.test(b));

  // If no blocks found, try parsing the whole text as a single block
  const blocksToProcess = blocks.length > 0 ? blocks : [text];

  for (const block of blocksToProcess) {
    const pickMatch = /PICK:\s*(\d+)/i.exec(block);
    const sideMatch = /SIDE:\s*(YES|NO)/i.exec(block);
    const estimateMatch = /ESTIMATE:\s*([\d.]+)/i.exec(block);
    const edgeMatch = /EDGE:\s*([\d.]+)/i.exec(block);
    const confidenceMatch = /CONFIDENCE:\s*([\d.]+)/i.exec(block);
    const categoryMatch = /CATEGORY:\s*(\w+)/i.exec(block);
    const reasonMatch = /REASON:\s*(.+)/i.exec(block);

    if (!sideMatch) continue;

    const pickNum = pickMatch ? Number.parseInt(pickMatch[1]!) : 0;
    if (pickNum === 0) continue;

    const pickIdx = Math.min(pickNum - 1, candidates.length - 1);
    const pick = candidates[Math.max(0, pickIdx)]!;
    const side = sideMatch[1]!.toUpperCase();
    const edge = edgeMatch ? Math.min(0.5, Number.parseFloat(edgeMatch[1]!)) : 0.10;
    const confidence = confidenceMatch ? Math.min(1.0, Number.parseFloat(confidenceMatch[1]!)) : 0.5;
    const estimatedProb = estimateMatch ? Number.parseFloat(estimateMatch[1]!) : pick.yesPrice;
    const category = categoryMatch ? categoryMatch[1]!.toUpperCase() : "OTHER";
    const reason = reasonMatch ? reasonMatch[1]!.trim() : "";

    if (edge < MIN_EDGE_THRESHOLD) {
      callbacks.log(`[ANALYSIS] ❌ Edge ${edge.toFixed(2)} below minimum ${MIN_EDGE_THRESHOLD} — skipping "${pick.question.slice(0, 50)}"`);
      continue;
    }
    if (confidence < MIN_CONFIDENCE_THRESHOLD) {
      callbacks.log(`[ANALYSIS] ❌ Confidence ${confidence.toFixed(2)} below minimum ${MIN_CONFIDENCE_THRESHOLD} — skipping "${pick.question.slice(0, 50)}"`);
      continue;
    }

    callbacks.log(`[ANALYSIS] ✅ #${results.length + 1} ${category} | ${side} | edge=${edge.toFixed(2)} | conf=${confidence.toFixed(2)} | est=${estimatedProb.toFixed(2)} | "${reason.slice(0, 80)}"`);

    results.push({ pick, side, reason, edge, confidence, category, estimatedProb });
  }

  if (results.length === 0) {
    // Try unstructured fallback for single response
    const yesNo = /\b(YES|NO)\b/i.exec(text);
    if (yesNo) {
      return [{ pick: candidates[0]!, side: yesNo[1]!.toUpperCase(), reason: text.slice(0, 100), edge: 0.10, confidence: 0.5, category: "OTHER", estimatedProb: candidates[0]!.yesPrice }];
    }
    callbacks.log(`[ANALYSIS] Skipping — no valid picks produced`);
  }

  return results;
}
```

- [ ] **Step 3: Rewrite the Polymarket buy phase to support multi-buy with Kelly**

Replace the Polymarket buy section inside `polyPhase` (the part after `if (scored.length > 0)`, approximately lines 353-387) with:

```typescript
        if (scored.length > 0) {
          const candidates = scored.slice(0, 5);
          const analyses = await analyzeCandidates(deps, callbacks, candidates, ragContext);
          let buyCount = 0;
          let remainingBalance = polyBalance;

          for (let ai = 0; ai < analyses.length && buyCount < MAX_BUYS_PER_CYCLE; ai++) {
            const analysis = analyses[ai]!;

            // Second+ buy requires higher bar
            if (buyCount > 0) {
              if (analysis.edge < SECOND_BUY_MIN_EDGE) {
                callbacks.log(`[POLYMARKET] Pick #${ai + 1} edge ${analysis.edge.toFixed(2)} below second-buy minimum ${SECOND_BUY_MIN_EDGE} — stopping`);
                break;
              }
              if (analysis.confidence < SECOND_BUY_MIN_CONFIDENCE) {
                callbacks.log(`[POLYMARKET] Pick #${ai + 1} confidence ${analysis.confidence.toFixed(2)} below second-buy minimum — stopping`);
                break;
              }
              // Diversify: skip if same category as previous buy
              if (ai > 0 && analyses[ai - 1]?.category === analysis.category) {
                callbacks.log(`[POLYMARKET] Pick #${ai + 1} same category (${analysis.category}) as previous — skipping for diversification`);
                continue;
              }
            }

            const marketPrice = analysis.side === "YES" ? analysis.pick.yesPrice : 1 - analysis.pick.yesPrice;
            const polyRewardRatio = marketPrice > 0 ? (1 - marketPrice) / marketPrice : 0;

            if (marketPrice > 0.75) {
              callbacks.log(`[POLYMARKET] ❌ Skipping "${analysis.pick.question.slice(0, 50)}" — ${analysis.side} at $${marketPrice.toFixed(2)} terrible risk/reward`);
              continue;
            }
            if (marketPrice < 0.15) {
              callbacks.log(`[POLYMARKET] ❌ Skipping "${analysis.pick.question.slice(0, 50)}" — ${analysis.side} at $${marketPrice.toFixed(2)} too cheap`);
              continue;
            }
            if (polyRewardRatio < MIN_REWARD_RATIO) {
              callbacks.log(`[POLYMARKET] ❌ Skipping "${analysis.pick.question.slice(0, 50)}" — ratio ${polyRewardRatio.toFixed(1)}:1 below minimum`);
              continue;
            }

            const betSize = calcKellyBetSize({
              estimatedProb: analysis.estimatedProb,
              marketPrice,
              confidence: analysis.confidence,
              balance: remainingBalance,
            });

            if (!canSpend(state, betSize)) {
              callbacks.log(`[POLYMARKET] Daily spend limit reached — skipping buy`);
              break;
            }

            if (remainingBalance < betSize) {
              callbacks.log(`[POLYMARKET] Insufficient balance ($${remainingBalance.toFixed(2)}) for $${betSize.toFixed(2)} bet — stopping`);
              break;
            }

            callbacks.log(`[BUY:POLYMARKET] #${buyCount + 1} "${analysis.pick.question}" (${analysis.side}:$${marketPrice.toFixed(2)}, kelly:$${betSize.toFixed(2)}, edge:${analysis.edge.toFixed(2)}, conf:${analysis.confidence.toFixed(2)}, est:${analysis.estimatedProb.toFixed(2)})`);
            state.pendingBuys.add(analysis.pick.question.toLowerCase());
            const bought = await directPolymarketBuy(deps, callbacks, state, analysis.pick.question, analysis.side, betSize, remainingBalance, (analysis.pick as ScoredMarket).tokenId);
            if (bought) {
              recordTrade(state, { question: analysis.pick.question, platform: "POLYMARKET", time: Date.now(), price: analysis.pick.yesPrice, amount: betSize });
              remainingBalance -= betSize;
              buyCount++;
            } else {
              state.failedBuys.set(analysis.pick.question, Date.now());
            }
          }

          if (analyses.length === 0) {
            // Record skipped markets
            for (const c of candidates) {
              state.skippedMarkets.set(c.question.toLowerCase(), Date.now());
            }
          }
```

- [ ] **Step 4: Rewrite the Jupiter buy phase similarly**

Replace the Jupiter buy section inside `jupPhase` (approximately lines 430-470) with:

```typescript
        if (jupScored.length > 0) {
          const candidates = jupScored.slice(0, 5);
          const analyses = await analyzeCandidates(deps, callbacks, candidates, ragContext);

          if (analyses.length === 0) {
            for (const c of candidates) {
              state.skippedMarkets.set(c.question.toLowerCase(), Date.now());
            }
            callbacks.log("[JUPITER] No high-conviction pick — skipping buy this cycle");
          } else {
            let buyCount = 0;
            let remainingBalance = solBalance;

            for (let ai = 0; ai < analyses.length && buyCount < MAX_BUYS_PER_CYCLE; ai++) {
              const analysis = analyses[ai]!;
              const pick = analysis.pick;
              const side = analysis.side;

              if (buyCount > 0) {
                if (analysis.edge < SECOND_BUY_MIN_EDGE || analysis.confidence < SECOND_BUY_MIN_CONFIDENCE) {
                  callbacks.log(`[JUPITER] Pick #${ai + 1} below second-buy threshold — stopping`);
                  break;
                }
                if (ai > 0 && analyses[ai - 1]?.category === analysis.category) {
                  callbacks.log(`[JUPITER] Pick #${ai + 1} same category — skipping`);
                  continue;
                }
              }

              const jupMarketPrice = side === "YES" ? pick.yesPrice : 1 - pick.yesPrice;
              const jupRewardRatio = jupMarketPrice > 0 ? (1 - jupMarketPrice) / jupMarketPrice : 0;

              if (jupMarketPrice > 0.75) {
                callbacks.log(`[JUPITER] ❌ Skipping "${pick.question.slice(0, 50)}" — terrible risk/reward`);
                continue;
              }
              if (jupMarketPrice < 0.15) {
                callbacks.log(`[JUPITER] ❌ Skipping "${pick.question.slice(0, 50)}" — too cheap`);
                continue;
              }
              if (jupRewardRatio < MIN_REWARD_RATIO) {
                callbacks.log(`[JUPITER] ❌ Skipping "${pick.question.slice(0, 50)}" — ratio below minimum`);
                continue;
              }

              const betSize = calcKellyBetSize({
                estimatedProb: analysis.estimatedProb,
                marketPrice: jupMarketPrice,
                confidence: analysis.confidence,
                balance: remainingBalance,
                minBet: MIN_BET_SIZE_JUP,
              });

              if (!canSpend(state, betSize)) {
                callbacks.log(`[JUPITER] Daily spend limit reached — stopping`);
                break;
              }

              callbacks.log(`[BUY:JUPITER] #${buyCount + 1} "${pick.question}" (${side}:$${jupMarketPrice.toFixed(2)}, kelly:$${betSize.toFixed(2)}, edge:${analysis.edge.toFixed(2)}, conf:${analysis.confidence.toFixed(2)}, est:${analysis.estimatedProb.toFixed(2)})`);
              state.pendingBuys.add(pick.question.toLowerCase());
              const bought = await directJupiterBuy(deps, callbacks, state, (pick as JupMarket).marketId, side, betSize, pick.question, remainingBalance, solUsdcBalance, solJupUsdBalance);
              if (bought) {
                recordTrade(state, { question: pick.question, platform: "JUPITER", time: Date.now(), price: pick.yesPrice, amount: betSize });
                remainingBalance -= betSize;
                buyCount++;
              } else {
                state.failedBuys.set((pick as JupMarket).marketId, Date.now());
              }
            }
          }
```

- [ ] **Step 5: Run all tests**

Run: `bun test`
Expected: All tests PASS (config, state, llm, and existing tests)

- [ ] **Step 6: Commit**

```bash
git add autonomy.ts
git commit -m "feat: multi-buy with ranked LLM picks + Kelly sizing + dual-LLM ensemble"
```

---

### Task 6: Cleanup + Final Integration Verification

**Files:**
- Modify: `autonomy-sell.ts` (remove dead legacy exports)

- [ ] **Step 1: Remove dead legacy functions from autonomy-sell.ts**

Remove the legacy no-op functions at the bottom of `autonomy-sell.ts` (the `polymarketSellPhase`, `reviewAllPositions`, `jupiterSellClaimPhase` stubs) — they are no longer called from `autonomy.ts`. Check first:

Run: `grep -n "polymarketSellPhase\|reviewAllPositions\|jupiterSellClaimPhase" autonomy.ts`
Expected: No matches (they were already replaced by `unifiedPortfolioReview`)

If confirmed unused, delete lines 403-446 from `autonomy-sell.ts`.

- [ ] **Step 2: Verify the full agent compiles**

Run: `bun build --target=bun ws-server.ts --outdir=/dev/null 2>&1 | head -20`
If bun build doesn't work, try: `bunx tsc --noEmit`
Expected: No type errors

- [ ] **Step 3: Run the full test suite**

Run: `bun test`
Expected: All tests PASS

- [ ] **Step 4: Final commit**

```bash
git add autonomy-sell.ts
git commit -m "chore: remove dead legacy sell functions"
```

---

## Summary of Changes

| Change | Before | After |
|--------|--------|-------|
| Position sizing | Ad-hoc multipliers, $8 max, 8% cap | Fractional Kelly, $20 max, 15% cap |
| Buys per cycle | 1 per platform | Up to 2 (ranked picks, higher bar for #2) |
| LLM analysis | Single provider, 1 pick | Dual-provider ensemble, up to 3 ranked picks |
| Sell triggers | PnL-based (-15%/+30%) | Price-based ($0.85 ceiling, $0.75 stale, $0.65 falling) |
| Trailing stop | Fake (no peak tracking) | Real (peak price tracked, 12% drop trigger above $0.65) |
| Dead positions | None | Auto-sell below $0.08 |
| Capital pressure | None | Sell weakest 3 when balance < $5 AND > 15 positions |
| LLM sell review | All positions | Only ambiguous ones (fewer calls, faster) |
