/**
 * Autonomy state types, factory, and housekeeping helpers.
 */

import type { AgentRuntime, stringToUuid } from "@elizaos/core";
import {
  CIRCUIT_BREAKER_LOSS_PCT,
  DAILY_SPEND_LIMIT_USD,
  FAILED_BUY_COOLDOWN_MS,
  FAILED_SELL_COOLDOWN_MS,
  MAX_TRADE_HISTORY,
  SAME_MARKET_COOLDOWN_MS,
  SKIPPED_MARKET_COOLDOWN_MS,
  STUCK_DUST_REEVAL_MS,
} from "./config";
import type { AsyncMutex } from "./mutex";
import type { ConnectorsService } from "./plugins/connectors/service";
import type { RAGService } from "./plugins/rag/service";

// --- Public types ---

export type AutonomyDeps = {
  runtime: AgentRuntime;
  messageService: { handleMessage: (...args: unknown[]) => Promise<unknown> };
  roomId: ReturnType<typeof stringToUuid>;
  userId: ReturnType<typeof stringToUuid>;
  ragSvc: RAGService | null;
  connectorsSvc: ConnectorsService | null;
  runtimeMutex: AsyncMutex;
};

export type AutonomyCallbacks = {
  send: (msg: Record<string, unknown>) => void;
  log: (text: string) => void;
};

export type AutonomyPlatform = "both" | "polymarket" | "jupiter";

export type AutonomyHandle = {
  stop: () => void;
  readonly isRunning: boolean;
  readonly platform: AutonomyPlatform;
};

// --- Internal types ---

export type TradeHistoryEntry = {
  question: string;
  platform: string;
  time: number;
  price: number;
  amount: number;
};

export type AutonomyState = {
  platform: AutonomyPlatform;
  cycleCount: number;
  tradeHistory: TradeHistoryEntry[];
  failedSells: Map<string, number>;
  failedBuys: Map<string, number>;
  recentlySold: Map<string, number>; // token/pubkey → timestamp (auto-expires)
  dailySpend: number; // USD spent today
  dailySpendResetAt: number; // timestamp of next daily reset
  prevPolyBalance: number; // for P&L tracking
  prevSolBalance: number;
  /** Cache enrichment context per cycle to avoid duplicate API calls */
  cycleEnrichCache: Map<string, string>;
  /** Timestamp until which Jupiter buys should be paused (insufficient funds cooldown) */
  jupBuyPausedUntil: number;
  /** Questions recently sold — don't re-buy (auto-expires) */
  recentlySoldQuestions: Map<string, number>;
  /** Consecutive idle cycles (both platforms in sell-only with nothing to sell) */
  idleCycles: number;
  /** Whether deposit-needed notification was sent this idle streak */
  depositNotified: boolean;
  /** Questions currently being bought (parallel dedup within a cycle) */
  pendingBuys: Set<string>;
  /** Markets the LLM skipped — don't re-analyze for SKIPPED_MARKET_COOLDOWN_MS */
  skippedMarkets: Map<string, number>;
  /** Markets recently sent to LLM for analysis — force rotation to new candidates */
  recentlyAnalyzed: Map<string, number>;
  /** Tokens permanently stuck (< 5 shares, illiquid, or dead markets) — excluded from position count */
  stuckDust: Set<string>;
  /** Peak observed price per position — for trailing stops */
  peakPrice: Map<string, number>;
  /** First time a position was seen — for time-based exits */
  positionFirstSeen: Map<string, number>;
  /** Starting balance snapshot — for circuit breaker loss detection */
  startingBalance: { poly: number; sol: number; recorded: boolean };
  /** Circuit breaker tripped — all trading paused */
  circuitBreakerTripped: boolean;
  /** Last time stuck dust was re-evaluated */
  lastStuckDustReeval: number;
  /** Jupiter price history: pubkey → array of {time, price} for trend computation */
  jupPriceHistory: Map<string, Array<{ time: number; price: number }>>;
  /** Pending unfilled orders — monitored each cycle, cancelled if stale */
  pendingOrders: Map<
    string,
    { orderID: string; platform: string; question: string; amount: number; placedAt: number }
  >;
};

// --- State factory ---

export function createState(platform: AutonomyPlatform): AutonomyState {
  const now = new Date();
  const tomorrow = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1);
  return {
    platform,
    cycleCount: 0,
    tradeHistory: [],
    failedSells: new Map(),
    failedBuys: new Map(),
    recentlySold: new Map(),
    dailySpend: 0,
    dailySpendResetAt: tomorrow.getTime(),
    prevPolyBalance: -1,
    prevSolBalance: -1,
    cycleEnrichCache: new Map(),
    jupBuyPausedUntil: 0,
    recentlySoldQuestions: new Map(),
    pendingBuys: new Set(),
    skippedMarkets: new Map(),
    recentlyAnalyzed: new Map(),
    stuckDust: new Set<string>(),
    peakPrice: new Map(),
    positionFirstSeen: new Map(),
    idleCycles: 0,
    depositNotified: false,
    startingBalance: { poly: -1, sol: -1, recorded: false },
    circuitBreakerTripped: false,
    lastStuckDustReeval: 0,
    jupPriceHistory: new Map(),
    pendingOrders: new Map(),
  };
}

// --- State helpers ---

/**
 * Housekeeping — clean up expired entries from maps/sets.
 * Called at the start of each cycle to prevent unbounded growth.
 */
export function housekeep(state: AutonomyState): void {
  const now = Date.now();

  for (const [key, ts] of state.recentlySold) {
    if (now - ts >= FAILED_SELL_COOLDOWN_MS) state.recentlySold.delete(key);
  }

  for (const [key, ts] of state.recentlySoldQuestions) {
    if (now - ts >= 86_400_000) state.recentlySoldQuestions.delete(key);
  }

  for (const [key, ts] of state.failedSells) {
    if (now - ts >= FAILED_SELL_COOLDOWN_MS * 2) state.failedSells.delete(key);
  }

  for (const [key, ts] of state.failedBuys) {
    if (now - ts >= FAILED_BUY_COOLDOWN_MS * 2) state.failedBuys.delete(key);
  }

  if (now >= state.dailySpendResetAt) {
    state.dailySpend = 0;
    const tomorrow = new Date();
    tomorrow.setHours(24, 0, 0, 0);
    state.dailySpendResetAt = tomorrow.getTime();
  }

  state.cycleEnrichCache.clear();
  state.pendingBuys.clear();

  for (const [key, ts] of state.skippedMarkets) {
    if (now - ts >= SKIPPED_MARKET_COOLDOWN_MS) state.skippedMarkets.delete(key);
  }

  // Recently analyzed markets: 10-minute cooldown forces rotation to new candidates
  for (const [key, ts] of state.recentlyAnalyzed) {
    if (now - ts >= 10 * 60_000) state.recentlyAnalyzed.delete(key);
  }

  // Clean up very old pending orders (safety net)
  for (const [key, order] of state.pendingOrders) {
    if (Date.now() - order.placedAt > 10 * 60_000) {
      state.pendingOrders.delete(key);
    }
  }
}

export function canSpend(state: AutonomyState, amount: number): boolean {
  if (DAILY_SPEND_LIMIT_USD <= 0) return true;
  return state.dailySpend + amount <= DAILY_SPEND_LIMIT_USD;
}

export function recordSpend(state: AutonomyState, amount: number): void {
  state.dailySpend += amount;
}

export function isRecentlyTraded(state: AutonomyState, question: string): boolean {
  const q = question.toLowerCase();
  return state.tradeHistory.some(
    (h) => h.question.toLowerCase() === q && Date.now() - h.time < SAME_MARKET_COOLDOWN_MS,
  );
}

export function isFailCooledDown(
  failMap: Map<string, number>,
  key: string,
  cooldownMs: number,
): boolean {
  const failTime = failMap.get(key);
  return !failTime || Date.now() - failTime >= cooldownMs;
}

export function recordTrade(state: AutonomyState, entry: TradeHistoryEntry): void {
  state.tradeHistory.push(entry);
  while (state.tradeHistory.length > MAX_TRADE_HISTORY) state.tradeHistory.shift();
}

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

/**
 * Seed state from Polymarket trade history on startup.
 * Fetches recent trades from the Data API so the agent doesn't re-buy
 * markets it recently sold, even after a redeploy clears in-memory state.
 */
export async function seedStateFromTradeHistory(state: AutonomyState): Promise<void> {
  const funder = process.env.POLYMARKET_FUNDER_ADDRESS?.trim();
  if (!funder) return;

  try {
    const res = await fetch(`https://data-api.polymarket.com/trades?user=${funder}&limit=50`);
    if (!res.ok) return;
    type TradeApi = {
      title?: string;
      side?: string;
      type?: string;
      timestamp?: number;
      price?: number;
      amount?: number;
    };
    const trades = (await res.json()) as TradeApi[];

    const now = Date.now();
    for (const t of trades) {
      const title = t.title?.toLowerCase();
      if (!title) continue;
      const ts = (t.timestamp ?? 0) * 1000;
      // Only care about trades in the last 24h
      if (now - ts > 86_400_000) continue;

      if (t.type === "sell" || t.side === "SELL") {
        state.recentlySoldQuestions.set(title, ts);
      }
      state.tradeHistory.push({
        question: t.title ?? "",
        platform: "POLYMARKET",
        time: ts,
        price: t.price ?? 0,
        amount: t.amount ?? 0,
      });
    }
  } catch {}
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

/**
 * Record starting balances for circuit breaker.
 * Only records on first call — subsequent calls are no-ops.
 */
export function recordStartingBalances(state: AutonomyState, poly: number, sol: number): void {
  if (state.startingBalance.recorded) return;
  state.startingBalance = { poly, sol, recorded: true };
}

/**
 * Check if the circuit breaker should trip.
 * Compares current balances against starting balances.
 * Returns true if cumulative loss exceeds CIRCUIT_BREAKER_LOSS_PCT.
 */
export function checkCircuitBreaker(state: AutonomyState, poly: number, sol: number): boolean {
  if (CIRCUIT_BREAKER_LOSS_PCT >= 0) return false; // disabled
  if (!state.startingBalance.recorded) return false;

  const startTotal = state.startingBalance.poly + state.startingBalance.sol;
  if (startTotal <= 0) return false;

  const currentTotal = poly + sol;
  const lossPct = ((currentTotal - startTotal) / startTotal) * 100;

  if (lossPct <= CIRCUIT_BREAKER_LOSS_PCT && !state.circuitBreakerTripped) {
    state.circuitBreakerTripped = true;
    return true;
  }

  // Auto-reset: if balance recovers above threshold, clear the breaker
  if (lossPct > CIRCUIT_BREAKER_LOSS_PCT + 5 && state.circuitBreakerTripped) {
    state.circuitBreakerTripped = false;
  }

  return state.circuitBreakerTripped;
}

/**
 * Re-evaluate stuck dust positions — clear them periodically so they get re-priced.
 * Returns the number of entries cleared.
 */
export function reevaluateStuckDust(state: AutonomyState): number {
  if (Date.now() - state.lastStuckDustReeval < STUCK_DUST_REEVAL_MS) return 0;
  if (state.stuckDust.size === 0) return 0;

  const cleared = state.stuckDust.size;
  state.stuckDust.clear();
  state.lastStuckDustReeval = Date.now();
  return cleared;
}

/**
 * Record a Jupiter position price snapshot for trend tracking.
 * Keeps at most 24 data points per position (24 hours at 1 cycle/minute).
 */
export function recordJupPriceSnapshot(state: AutonomyState, pubkey: string, price: number): void {
  let history = state.jupPriceHistory.get(pubkey);
  if (!history) {
    history = [];
    state.jupPriceHistory.set(pubkey, history);
  }
  history.push({ time: Date.now(), price });
  // Keep last 24 data points
  while (history.length > 24) history.shift();
}

/**
 * Compute a simple price trend from Jupiter position price history.
 * Returns null if not enough data.
 */
export function computeJupTrend(
  state: AutonomyState,
  pubkey: string,
): { direction: "up" | "down" | "flat"; changePct: number } | null {
  const history = state.jupPriceHistory.get(pubkey);
  if (!history || history.length < 3) return null;

  const oldest = history[0]!.price;
  const newest = history[history.length - 1]!.price;
  if (oldest <= 0) return null;

  const changePct = ((newest - oldest) / oldest) * 100;
  const direction = changePct > 3 ? "up" : changePct < -3 ? "down" : "flat";
  return { direction, changePct };
}

/**
 * Prune Jupiter price history for positions no longer held.
 */
export function pruneStaleJupHistory(state: AutonomyState, activePubkeys: Set<string>): void {
  for (const key of state.jupPriceHistory.keys()) {
    if (!activePubkeys.has(key)) state.jupPriceHistory.delete(key);
  }
}
