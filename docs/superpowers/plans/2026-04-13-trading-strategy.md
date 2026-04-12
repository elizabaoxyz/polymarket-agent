# Trading Strategy Improvements Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Improve autonomous trading agent profitability through smarter profit-taking, better execution, resolution awareness, conservative sizing, and order monitoring.

**Architecture:** Five independent improvements to config defaults, sell rules, buy execution, position sizing, and order lifecycle. Each task produces a working commit. Changes are backward-compatible via env var overrides.

**Tech Stack:** TypeScript, Bun, @polymarket/clob-client (FOK/FAK order types), Jupiter Prediction API

---

### Task 1: Tighten config defaults for profit-taking and sizing

**Files:**
- Modify: `config.ts`

- [ ] **Step 1: Update profit-taking thresholds**

In `config.ts`, change these default values:

```ts
// Line 165: was 0.85
export const PRICE_CEILING_SELL = envFloat("PRICE_CEILING_SELL", 0.78);

// Line 168: was 0.70
export const HIGH_PRICE_SELL = envFloat("HIGH_PRICE_SELL", 0.68);

// Line 180: was 8
export const TRAILING_STOP_DROP_PCT = envFloat("TRAILING_STOP_DROP_PCT", 6);
```

- [ ] **Step 2: Update Kelly sizing defaults**

```ts
// Line 135: was 0.10
export const KELLY_MAX_FRACTION = envFloat("KELLY_MAX_FRACTION", 0.08);

// Line 138: was 0.5
export const KELLY_FRACTION_MULTIPLIER = envFloat("KELLY_FRACTION_MULTIPLIER", 0.25);

// Line 28: was 7
export const MAX_BET_SIZE_USD = envFloat("MAX_BET_SIZE_USD", 5);
```

- [ ] **Step 3: Add new config constants**

Add after `CAPITAL_PRESSURE_MAX_POSITIONS` (line 186):

```ts
/** Minimum days to resolution for buy-side — skip same-day markets */
export const MIN_DAYS_LEFT = envFloat("MIN_DAYS_LEFT", 1);

/** Time-decay auto-sell: sell positions in no-man's land when resolution < this many days */
export const TIME_DECAY_SELL_DAYS = envFloat("TIME_DECAY_SELL_DAYS", 2);

/** Partial profit: sell half of position when price >= this (Polymarket only, needs > 10 shares) */
export const PARTIAL_PROFIT_PRICE = envFloat("PARTIAL_PROFIT_PRICE", 0.65);
```

- [ ] **Step 4: Update comments to match new values**

```ts
// Line 165 comment: was "terrible risk/reward"
/** Auto-sell when position price exceeds this (~70% of theoretical max captured) */

// Line 168 comment: was "Sell if price > this AND position age > 2 days"
/** Sell if price > this AND position age > 1 day (R/R turns unfavorable) */

// Line 135 comment
/** Maximum fraction of balance to risk on a single trade — 8% bankroll cap */

// Line 138 comment
/** Kelly multiplier: 0.25 = quarter-Kelly for small bankrolls (56% growth rate, ~60% less drawdown) */
```

- [ ] **Step 5: Update stale position rule**

In `autonomy-sell.ts`, find the stale position rule (Rule 7, around line 384):

```ts
// Before:
else if (age > 3 && price >= 0.30 && price <= 0.70 && Math.abs(pnl) < 5) {
  reason = `stale-position (${age.toFixed(1)}d old, ${pnl >= 0 ? "+" : ""}${pnl.toFixed(0)}% PnL, price $${price.toFixed(2)} — capital trapped)`;
}
// After:
else if (age > 2 && price >= 0.35 && price <= 0.65 && Math.abs(pnl) < 5) {
  reason = `stale-position (${age.toFixed(1)}d old, ${pnl >= 0 ? "+" : ""}${pnl.toFixed(0)}% PnL, price $${price.toFixed(2)} — capital trapped)`;
}
```

Also update Rule 2 (HIGH_PRICE_SELL age check) from `age > 2` to `age > 1`:

```ts
// Before:
else if (price >= HIGH_PRICE_SELL && age > 2) {
// After:
else if (price >= HIGH_PRICE_SELL && age > 1) {
```

- [ ] **Step 6: Verify**

Run: `bun run typecheck && bun test`
Expected: 0 new errors, 152+ tests pass

- [ ] **Step 7: Commit**

```bash
git add config.ts autonomy-sell.ts
git commit -m "feat: tighten profit-taking thresholds and quarter-Kelly sizing

- PRICE_CEILING_SELL: 0.85 → 0.78 (take profit at ~70% of max)
- HIGH_PRICE_SELL: 0.70 → 0.68, age 2d → 1d
- TRAILING_STOP_DROP_PCT: 8 → 6
- KELLY_FRACTION_MULTIPLIER: 0.5 → 0.25 (quarter-Kelly)
- KELLY_MAX_FRACTION: 0.10 → 0.08
- MAX_BET_SIZE_USD: 7 → 5
- Stale position: 3d → 2d, range 0.30-0.70 → 0.35-0.65
- Add MIN_DAYS_LEFT, TIME_DECAY_SELL_DAYS, PARTIAL_PROFIT_PRICE"
```

---

### Task 2: Add time-decay and partial-profit sell rules

**Files:**
- Modify: `autonomy-sell.ts`
- Modify: `autonomy-sell.ts` (ReviewablePosition type)

- [ ] **Step 1: Add `daysLeft` to ReviewablePosition**

In `autonomy-sell.ts`, update the `ReviewablePosition` type (around line 41):

```ts
export type ReviewablePosition = {
  token?: string;
  pubkey?: string;
  title: string;
  pnl: number;
  shares?: number;
  curPrice?: number;
  isYes?: boolean;
  contracts?: string;
  daysLeft?: number;  // days until market resolution
};
```

- [ ] **Step 2: Add time-decay rule to auto-sell section**

In `unifiedPortfolioReview`, after Rule 7 (stale position, around line 387) and before the `if (reason)` check, add a new rule:

```ts
    // Rule 8: Time-decay — sell positions in no-man's land near resolution
    else if (p.daysLeft !== undefined && p.daysLeft < TIME_DECAY_SELL_DAYS) {
      if (price >= 0.40 && price <= 0.70) {
        reason = `time-decay (${p.daysLeft.toFixed(1)}d to resolve, price $${price.toFixed(2)} in no-man's land)`;
      } else if (price < 0.25 && price > 0) {
        reason = `time-decay-loser (${p.daysLeft.toFixed(1)}d to resolve, price $${price.toFixed(2)} — thesis wrong)`;
      }
    }
```

Add the import at the top of `autonomy-sell.ts`:

```ts
import {
  PRICE_CEILING_SELL,
  HIGH_PRICE_SELL,
  DEAD_POSITION_PRICE,
  HARD_STOP_LOSS_PCT,
  TRAILING_STOP_MIN_PRICE,
  TRAILING_STOP_DROP_PCT,
  CAPITAL_PRESSURE_MIN_BALANCE,
  CAPITAL_PRESSURE_MAX_POSITIONS,
  TIME_DECAY_SELL_DAYS,
  PARTIAL_PROFIT_PRICE,
} from "./config";
```

- [ ] **Step 3: Add partial-profit rule**

After the auto-sell loop (after the `for (const p of reviewable)` loop ends, around line 392), add a new section before capital pressure:

```ts
  // === Partial profit: sell 50% of position at high price (Polymarket only) ===
  if (platform === "POLYMARKET") {
    for (const p of reviewable) {
      if (autoSellSet.has(p)) continue;
      const price = p.curPrice ?? 0;
      const shares = p.shares ?? 0;
      if (price >= PARTIAL_PROFIT_PRICE && shares > 10) {
        const halfShares = Math.floor(shares / 2);
        if (halfShares >= 5) { // CLOB minimum
          const key = p.token ?? "";
          if (state.recentlySold.has(key) || state.failedSells.has(key)) continue;
          // Create a partial-sell position with halved shares
          const partialPos = { ...p, shares: halfShares };
          callbacks.log(`[SELL:POLYMARKET] Partial profit: "${p.title}" $${price.toFixed(2)} — selling ${halfShares}/${shares} shares`);
          await executeSell(deps, callbacks, state, partialPos, platform, `partial-profit ($${price.toFixed(2)}, ${halfShares}/${shares} shares)`);
        }
      }
    }
  }
```

- [ ] **Step 4: Verify**

Run: `bun run typecheck && bun test`
Expected: 0 new errors, 152+ tests pass

- [ ] **Step 5: Commit**

```bash
git add autonomy-sell.ts
git commit -m "feat: add time-decay and partial-profit sell rules

- Time-decay: auto-sell positions in 0.40-0.70 range when < 2d to resolve
- Time-decay-loser: auto-sell < $0.25 positions when < 2d to resolve
- Partial profit: sell 50% of Polymarket positions when price >= $0.65 and > 10 shares
- Add daysLeft to ReviewablePosition for resolution awareness"
```

---

### Task 3: Propagate `daysLeft` to positions for sell decisions

**Files:**
- Modify: `autonomy-sell.ts` (collectPositions)
- Modify: `autonomy.ts` (pass daysLeft through reviewPositions)

- [ ] **Step 1: Add daysLeft lookup in collectPositions for Polymarket**

In `collectPositions` in `autonomy-sell.ts`, the Polymarket position fetch (around line 85-106) already has access to the data API. Add `end_date_iso` to the API type and compute `daysLeft`:

```ts
type PolyPosApi = {
  title?: string; asset: string; size: number; percentPnl: number;
  curPrice: number; redeemable?: boolean;
  end_date_iso?: string; endDate?: string;  // add these
};
```

Then inside the for loop (after line 101 where `polyAllSellable.push` is), compute daysLeft:

```ts
let daysLeft: number | undefined;
const endDateStr = pos.end_date_iso ?? (pos as Record<string, unknown>).endDate as string | undefined;
if (endDateStr) {
  daysLeft = Math.max(0, (new Date(endDateStr).getTime() - Date.now()) / 86400000);
}
polyAllSellable.push({ token: pos.asset, shares: pos.size, title: pos.title ?? "", pnl, curPrice: price, daysLeft });
if (pnl < sellLossThreshold || pnl > sellProfitThreshold) {
  polySellTargets.push({ token: pos.asset, shares: pos.size, title: pos.title ?? "", pnl, curPrice: price });
}
```

Update `PolySellTarget` type to include `daysLeft`:

```ts
export type PolySellTarget = { token: string; shares: number; title: string; pnl: number; curPrice: number; daysLeft?: number };
```

- [ ] **Step 2: Pass daysLeft through to reviewPositions in autonomy.ts**

In `autonomy.ts`, find where `polyReviewable` is mapped for `platformBuyPhase` (inside the `polyPhase` closure). Update the `reviewPositions` mapping to include `daysLeft`:

```ts
reviewPositions: polyReviewable.map((p) => ({ token: p.token, title: p.title, pnl: p.pnl, shares: p.shares, curPrice: p.curPrice, daysLeft: p.daysLeft })),
```

- [ ] **Step 3: Verify**

Run: `bun run typecheck && bun test`
Expected: 0 new errors, 152+ tests pass

- [ ] **Step 4: Commit**

```bash
git add autonomy-sell.ts autonomy.ts
git commit -m "feat: propagate daysLeft to positions for resolution-aware sell rules

Polymarket positions now include daysLeft from end_date_iso API field,
enabling time-decay sell rules added in previous commit."
```

---

### Task 4: Add FOK market orders for Polymarket buys

> **Dependency:** Task 5 (pending order state) must run first since this task stores into `state.pendingOrders`. Execute Task 5 before Task 4.

**Files:**
- Modify: `plugins/polymarket-ext/service.ts`
- Modify: `autonomy-trade.ts`

- [ ] **Step 1: Add `placeMarketOrder` method to PolymarketExtService**

In `plugins/polymarket-ext/service.ts`, after the `sellOrder` method (line ~165), add:

```ts
  async placeMarketOrder(params: {
    tokenId: string;
    side: "BUY" | "SELL";
    amount: number; // USD amount for BUY, shares for SELL
  }): Promise<{
    orderID: string;
    status: string;
    transactionsHashes: string[];
  }> {
    if (params.amount <= 0) {
      throw new Error(`Invalid amount ${params.amount}`);
    }
    const client = await this.getClobClient();
    const { OrderType } = await import("@polymarket/clob-client");
    const order = await client.createAndPostMarketOrder(
      {
        tokenID: params.tokenId,
        amount: params.amount,
        side: params.side,
        feeRateBps: 1000,
        nonce: 0,
      },
      undefined, // options
      OrderType.FOK,
    );

    if (order.error || (typeof order.status === "number" && order.status >= 400)) {
      throw new Error(order.error ?? order.errorMsg ?? `Market order failed with status ${order.status}`);
    }

    return {
      orderID: order.orderID ?? order.id ?? "unknown",
      status: String(order.status ?? "submitted"),
      transactionsHashes: order.transactionsHashes ?? [],
    };
  }
```

- [ ] **Step 2: Update directPolymarketBuy to use FOK**

In `autonomy-trade.ts`, replace the buy execution section in `directPolymarketBuy`. Find the line (around line 217):

```ts
    const result = await extSvc.placeOrder({ tokenId, side: "BUY", price, size });
```

Replace the entire buy execution block (lines ~202-231) with:

```ts
    const size = Math.max(5, Math.floor(betSize / price));
    let totalCost = size * price;
    const balance = availableBalance ?? betSize * 2;
    if (totalCost > balance) {
      const affordableSize = Math.max(5, Math.floor(balance / price));
      if (affordableSize < 5) {
        callbacks.log(`[BUY:POLYMARKET] ❌ Not enough balance: $${balance.toFixed(2)} — can't afford 5 shares at $${price.toFixed(2)}`);
        return false;
      }
    }

    // Try FOK (Fill-Or-Kill) first for immediate execution
    let result: { orderID: string; status: string; transactionsHashes: string[] };
    try {
      result = await extSvc.placeMarketOrder({ tokenId, side: "BUY", amount: betSize });
      if (result.status === "matched") {
        const txInfo = result.transactionsHashes.length > 0
          ? ` | tx: ${result.transactionsHashes[0]!.slice(0, 10)}...`
          : "";
        callbacks.log(
          `[BUY:POLYMARKET] ✅ FOK FILLED: $${betSize.toFixed(2)} for "${question.slice(0, 60)}"${txInfo}`,
        );
        recordSpend(state, betSize);
        return true;
      }
      // FOK didn't fill — fall through to GTC limit
      callbacks.log(`[BUY:POLYMARKET] FOK didn't fill (${result.status}), trying GTC limit at $${price.toFixed(2)}...`);
    } catch (fokErr) {
      const fokMsg = fokErr instanceof Error ? fokErr.message : String(fokErr);
      callbacks.log(`[BUY:POLYMARKET] FOK failed (${fokMsg}), trying GTC limit...`);
    }

    // Fallback: GTC limit order at mid-price
    result = await extSvc.placeOrder({ tokenId, side: "BUY", price, size });
    const total = (size * price).toFixed(2);
    const statusIcon = result.status === "matched" ? "FILLED" : String(result.status).toUpperCase();
    const txInfo = result.transactionsHashes.length > 0
      ? ` | tx: ${result.transactionsHashes[0]!.slice(0, 10)}...`
      : "";
    callbacks.log(
      `[BUY:POLYMARKET] ✅ ${statusIcon}: ${size} shares @ $${price.toFixed(2)} ($${total}) for "${question.slice(0, 60)}"${txInfo}`,
    );
    if (result.status === "matched") {
      recordSpend(state, Number(total));
    } else {
      // Store pending order for monitoring (Task 5)
      state.pendingOrders.set(result.orderID, {
        orderID: result.orderID,
        platform: "POLYMARKET",
        question: question.slice(0, 80),
        amount: Number(total),
        placedAt: Date.now(),
      });
      callbacks.log(`[BUY:POLYMARKET] ⏳ GTC order ${result.orderID} pending — will monitor next cycle`);
    }
    return true;
```

- [ ] **Step 3: Verify**

Run: `bun run typecheck && bun test`
Expected: 0 new errors, 152+ tests pass

- [ ] **Step 4: Commit**

```bash
git add plugins/polymarket-ext/service.ts autonomy-trade.ts
git commit -m "feat: use FOK market orders for Polymarket buys

- Add placeMarketOrder() using createAndPostMarketOrder with FOK
- directPolymarketBuy tries FOK first for instant fill
- Falls back to GTC limit if FOK doesn't fill
- Pending GTC orders stored in state for monitoring"
```

---

### Task 5: Add pending order state and monitoring

**Files:**
- Modify: `autonomy-state.ts`
- Modify: `autonomy.ts`

- [ ] **Step 1: Add pendingOrders to state**

In `autonomy-state.ts`, add to `AutonomyState` type (after `jupPriceHistory`, around line 97):

```ts
  /** Pending unfilled orders — monitored each cycle, cancelled if stale */
  pendingOrders: Map<string, { orderID: string; platform: string; question: string; amount: number; placedAt: number }>;
```

In `createState` (around line 130), add:

```ts
    pendingOrders: new Map(),
```

- [ ] **Step 2: Add pending order monitoring to runAutonomyCycle**

In `autonomy.ts`, at the start of `runAutonomyCycle`, after `housekeep(state)` (around line 88), add:

```ts
  // Monitor pending orders from previous cycles
  if (state.pendingOrders.size > 0) {
    const { POLYMARKET_EXT_SERVICE_TYPE } = await import("./plugins/polymarket-ext/types");
    const { PolymarketExtService } = await import("./plugins/polymarket-ext/service");
    let extSvc: PolymarketExtService | null = null;
    try {
      extSvc = (await deps.runtime.getServiceLoadPromise(POLYMARKET_EXT_SERVICE_TYPE)) as unknown as PolymarketExtService;
    } catch {}

    for (const [key, order] of state.pendingOrders) {
      const ageMs = Date.now() - order.placedAt;
      if (ageMs > 2 * 60_000) {
        // Stale after 2 minutes — cancel
        if (extSvc?.clob) {
          try {
            await extSvc.clob.cancelOrder(order.orderID);
            callbacks.log(`[ORDER] Cancelled stale ${order.platform} order ${order.orderID.slice(0, 12)}... for "${order.question}"`);
          } catch {}
        }
        state.pendingOrders.delete(key);
      }
      // Note: checking fill status requires getOrder which returns order details.
      // For simplicity, we just cancel stale orders — FOK handles the fast path.
    }
  }
```

- [ ] **Step 3: Add pendingOrders cleanup to housekeep**

In `autonomy-state.ts`, find the `housekeep` function. Add after the existing cleanup logic:

```ts
  // Clean up very old pending orders (safety net)
  for (const [key, order] of state.pendingOrders) {
    if (Date.now() - order.placedAt > 10 * 60_000) {
      state.pendingOrders.delete(key);
    }
  }
```

- [ ] **Step 4: Verify**

Run: `bun run typecheck && bun test`
Expected: 0 new errors, 152+ tests pass

- [ ] **Step 5: Commit**

```bash
git add autonomy-state.ts autonomy.ts
git commit -m "feat: monitor and cancel stale pending orders

- Add pendingOrders to AutonomyState for tracking unfilled GTC orders
- Cancel orders older than 2 minutes at cycle start
- Safety cleanup for orders older than 10 minutes in housekeep"
```

---

### Task 6: Position-count scaling for Kelly sizing

**Files:**
- Modify: `config.ts`
- Modify: `autonomy.ts`

- [ ] **Step 1: Add `filledPositions` parameter to calcKellyBetSize**

In `config.ts`, update `calcKellyBetSize` signature and body:

```ts
export function calcKellyBetSize(params: {
  estimatedProb: number;
  marketPrice: number;
  confidence: number;
  balance: number;
  minBet?: number;
  filledPositions?: number;
}): number {
  const { estimatedProb, marketPrice, confidence, balance } = params;
  const minBet = params.minBet ?? MIN_BET_SIZE_USD;
  const filledPositions = params.filledPositions ?? 0;

  const edge = estimatedProb - marketPrice;
  if (edge <= 0) return minBet;

  const kellyFraction = edge / (1 - marketPrice);

  // Quarter-Kelly with position-count scaling:
  // More open positions = more conservative sizing
  const positionPenalty = 1 - (filledPositions / MAX_POSITIONS * 0.3);
  let fraction = kellyFraction * KELLY_FRACTION_MULTIPLIER * positionPenalty;

  const confMultiplier = Math.max(0.5, Math.min(1.0, confidence));
  fraction *= confMultiplier;

  fraction = Math.min(fraction, KELLY_MAX_FRACTION);

  const size = balance * fraction;
  return Math.max(minBet, Math.min(MAX_BET_SIZE_USD, size));
}
```

- [ ] **Step 2: Pass filledPositions through platformBuyPhase**

In `autonomy.ts`, update the `PlatformBuyConfig` type to include `filledPositions`:

```ts
type PlatformBuyConfig = {
  // ... existing fields ...
  filledPositions: number;
  // ... rest ...
};
```

In `platformBuyPhase`, pass `filledPositions` to `calcKellyBetSize`. Find where it's called (the `const betSize = calcKellyBetSize({...})` call) and add the field:

```ts
      const betSize = calcKellyBetSize({
        estimatedProb: kellyProb,
        marketPrice,
        confidence: analysis.confidence,
        balance: remainingBalance,
        minBet,
        filledPositions: config.filledPositions,
      });
```

Update both `polyPhase` and `jupPhase` config objects to pass `filledPositions`:

```ts
// In polyPhase config:
filledPositions: polyActive,

// In jupPhase config:
filledPositions: jupActive,
```

- [ ] **Step 3: Verify**

Run: `bun run typecheck && bun test`
Expected: 0 new errors, 152+ tests pass. Existing `config.test.ts` tests should still pass since `filledPositions` is optional with default 0.

- [ ] **Step 4: Commit**

```bash
git add config.ts autonomy.ts
git commit -m "feat: position-count scaling for Kelly sizing

Quarter-Kelly multiplier scales down with more open positions:
0/3 → full 0.25, 1/3 → 0.225, 2/3 → 0.20.
More exposed = more conservative."
```

---

### Task 7: Add minimum days filter to scanner

**Files:**
- Modify: `autonomy-scanner.ts`

- [ ] **Step 1: Add MIN_DAYS_LEFT filter**

In `autonomy-scanner.ts`, import `MIN_DAYS_LEFT` from config. Add to the existing config import:

```ts
import {
  // ... existing imports ...
  MIN_DAYS_LEFT,
} from "./config";
```

In `scanPolymarketMarkets`, find the `daysLeft` filter (around line 207-208):

```ts
      if (daysLeft > MARKET_MAX_DAYS) { skipDays++; continue; }
      if (daysLeft < 0.5) { skipDays++; continue; } // already expired or resolving
```

Change the second line:

```ts
      if (daysLeft > MARKET_MAX_DAYS) { skipDays++; continue; }
      if (daysLeft < MIN_DAYS_LEFT) { skipDays++; continue; } // too close to resolution
```

For Jupiter scanner, find a similar filter (if it exists) or add one where markets are filtered.

- [ ] **Step 2: Verify**

Run: `bun run typecheck && bun test`
Expected: 0 new errors, 152+ tests pass

- [ ] **Step 3: Commit**

```bash
git add autonomy-scanner.ts
git commit -m "feat: skip markets resolving within MIN_DAYS_LEFT (default 1 day)

Same-day resolution markets are coin flips — no LLM edge. The
MIN_DAYS_LEFT config (default 1) filters them from the buy pipeline."
```

---

### Task 8: Final verification and Dockerfile update

**Files:**
- Verify all

- [ ] **Step 1: Run full test suite**

Run: `bun test`
Expected: 152+ tests pass

- [ ] **Step 2: Run typecheck**

Run: `bun run typecheck`
Expected: 0 new errors (pre-existing only)

- [ ] **Step 3: Run linter**

Run: `bun run lint`
Expected: 0 new errors

- [ ] **Step 4: Verify Dockerfile includes all files**

Check `Dockerfile.ws` — all modified files should already be included (config.ts, autonomy.ts, autonomy-sell.ts, autonomy-trade.ts, autonomy-state.ts, autonomy-scanner.ts are all in existing COPY lines). No new files created.

- [ ] **Step 5: Verify config changes are env-overridable**

All new constants use `envFloat`/`envInt`, so production can override via Railway env vars without code changes. Existing env vars still work.
