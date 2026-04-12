# Trading Strategy Improvements: Profit-Taking, Execution, Sizing

**Date:** 2026-04-13
**Status:** Approved

Five improvements to trading decisions, execution quality, and risk management.

---

## 1. Smarter Profit-Taking

### Problem

Fixed thresholds leave money on the table. Research shows optimal prediction market profit-taking at 60-70% of theoretical max, not fixed PnL %. The agent holds winners too long (price ceiling at $0.85 = 18% upside / 85% downside) and lets capital sit trapped in stale positions for 3 days.

### Changes

**config.ts constants:**

| Constant | Old | New | Rationale |
|---|---|---|---|
| `PRICE_CEILING_SELL` | 0.85 | 0.78 | Take profit at ~70% of max (28% upside vs 78% down) |
| `HIGH_PRICE_SELL` | 0.70 | 0.68 | At $0.68: 47% up / 68% down. Tighter exit. |
| `TRAILING_STOP_DROP_PCT` | 8 | 6 | 8% drop from peak in binary = significant reversal |
| Stale: 3d, 0.30-0.70 | - | 2d, 0.35-0.65 | Faster capital recycling at small bankroll |

**autonomy-sell.ts — new rules:**

**Rule: Time-decay exit.** Sell if position price is 0.40-0.70 AND market resolves within 2 days. The final 48h of a binary market brings extreme volatility — the 0.40-0.70 range is no-man's land. Requires `daysLeft` data from scanner (Polymarket `end_date_iso`, Jupiter event metadata).

**Rule: Partial profit-taking (Polymarket only).** When price >= $0.65 AND shares > 10, sell 50% of shares. Lock half the profit, let the rest ride. Skip on Jupiter since `closePosition` is all-or-nothing.

### What NOT to change

- Hard stop-loss at -15% PnL — already correct
- Dead position at < $0.10 — already correct
- Capital pressure rules — already correct
- Low balance recovery — already correct

---

## 2. Better Buy Execution: FOK/FAK Orders

### Problem

All Polymarket buys use default GTC limit orders at mid-price. If the order doesn't fill immediately, it sits on the book indefinitely. The agent doesn't track these pending orders — it may think it bought when the order is just resting. Capital is locked in unfilled orders.

### Changes

**autonomy-trade.ts `directPolymarketBuy`:**

Use Fill-Or-Kill (FOK) as the default order type. FOK fills immediately and entirely, or cancels — no hanging orders.

```ts
// In placeOrder call, add orderType:
const result = await extSvc.placeOrder({
  tokenId, side: "BUY", price, size,
  orderType: "FOK",
});
```

If FOK fails (returned as `unmatched`), retry once with a slightly better price (bestAsk instead of mid):

```ts
if (result.status === "unmatched") {
  // Retry at best ask (immediate fill)
  const retryResult = await extSvc.placeOrder({
    tokenId, side: "BUY", price: bestAsk, size,
    orderType: "FOK",
  });
}
```

**plugins/polymarket-ext/service.ts `placeOrder`:**

Add optional `orderType` parameter that maps to `@polymarket/clob-client` order type. Default remains GTC for backward compatibility with elizaOS actions, but autonomy buys pass FOK.

**Sell orders stay GTC.** Sell orders at best bid are fine as GTC — they typically fill immediately, and if they don't, resting on the book is acceptable (we want to exit).

**Jupiter unchanged.** Jupiter orders go through a keeper network — the API doesn't support order types. The current flow is correct.

---

## 3. Resolution-Aware Trading

### Problem

The agent treats all markets the same regardless of how close they are to resolution. A market resolving in 2 hours gets the same logic as one resolving in 30 days.

### Changes

**autonomy-sell.ts — time-decay exit rule:**

Add resolution awareness to `unifiedPortfolioReview`. This requires passing `daysLeft` into positions. For Polymarket, fetch from the data API (already available in scanner). For Jupiter, use event metadata.

New auto-sell rule in `unifiedPortfolioReview`:
```
if daysLeft !== undefined AND daysLeft < 2:
  if price >= 0.40 AND price <= 0.70: SELL (no-man's land near resolution)
  if price < 0.25: SELL (thesis wrong, salvage)
  // price > 0.75: HOLD (likely resolves favorably)
```

**autonomy-scanner.ts — minimum days filter:**

Add `MIN_DAYS_LEFT = 1` to config. Skip markets resolving within 24h on the buy side — same-day resolution is a coin flip, no edge.

**Data flow:** The scanner already computes `daysLeft` for scored markets. We need to propagate it through to positions for sell decisions. Add optional `daysLeft` to `ReviewablePosition` and populate it from the data API during `collectPositions`.

---

## 4. Quarter-Kelly Position Sizing

### Problem

Half-Kelly (0.5) with 10% cap on a $22-42 bankroll. Research recommends quarter-Kelly for small bankrolls — the Kelly formula assumes infinite repetitions, which small bankrolls can't support. A bad streak of 3-4 losses at half-Kelly devastates a $22 account.

### Changes

**config.ts:**

| Constant | Old | New | Rationale |
|---|---|---|---|
| `KELLY_FRACTION_MULTIPLIER` | 0.50 | 0.25 | Quarter-Kelly: 56% growth rate, ~60% less drawdown |
| `KELLY_MAX_FRACTION` | 0.10 | 0.08 | Tighter cap per trade |
| `MAX_BET_SIZE_USD` | 7 | 5 | Smaller max at small bankroll |

**Position-count scaling in `calcKellyBetSize`:**

Scale the multiplier down as positions increase:
```ts
const positionPenalty = 1 - (filledPositions / MAX_POSITIONS * 0.3);
fraction *= positionPenalty;
```

At 0/3 positions: full quarter-Kelly (0.25)
At 1/3 positions: 0.25 * 0.9 = 0.225
At 2/3 positions: 0.25 * 0.8 = 0.20

This requires passing `filledPositions` count into `calcKellyBetSize`. The count is available in `runAutonomyCycle` as `polyActive` / `jupActive`.

---

## 5. Post-Buy Order Monitoring

### Problem

GTC orders that don't fill immediately are fire-and-forget. The agent assumes the buy worked but doesn't verify. Capital can be locked in unfilled orders with no tracking.

Note: With improvement #2 (FOK orders), most buys will fill immediately or fail. This improvement handles the edge cases and provides observability.

### Changes

**autonomy-state.ts:**

Add to state:
```ts
pendingOrders: Map<string, { orderID: string; platform: string; question: string; amount: number; placedAt: number }>;
```

**autonomy-trade.ts:**

After placing a Polymarket order that returns `status !== "matched"`, store it in `state.pendingOrders`.

**autonomy.ts `runAutonomyCycle`:**

At the start of each cycle, check pending orders:
```ts
for (const [key, order] of state.pendingOrders) {
  if (Date.now() - order.placedAt > 2 * AUTONOMY_INTERVAL_MS) {
    // Order has been pending for 2+ cycles — cancel it
    try {
      await extSvc.clob.cancelOrder(order.orderID);
      callbacks.log(`[ORDER] Cancelled stale order ${order.orderID} for "${order.question}"`);
    } catch {}
    state.pendingOrders.delete(key);
  } else {
    // Check if it filled
    try {
      const status = await extSvc.clob.getOrder(order.orderID);
      if (status === "matched" || status === "filled") {
        recordSpend(state, order.amount);
        callbacks.log(`[ORDER] Confirmed fill: ${order.orderID} for "${order.question}" — $${order.amount.toFixed(2)}`);
        state.pendingOrders.delete(key);
      }
    } catch {}
  }
}
```

**Jupiter:** After placing a Jupiter order, store `orderPubkey` in `pendingOrders`. Check with `GET /orders/status/{orderPubkey}` on next cycle. Jupiter orders fill through a keeper network and may take a few seconds.

---

## Testing Strategy

- All existing 152 tests must continue passing
- Config changes are backward-compatible (env vars override defaults)
- New sell rules are additive — existing rules unchanged
- FOK order type is a parameter addition — existing GTC path still works
- Position-count scaling is transparent to callers (just changes the output)
- Pending order monitoring is a new phase at cycle start — doesn't affect existing flow
