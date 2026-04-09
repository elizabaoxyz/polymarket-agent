/**
 * Autonomy state types and helpers.
 * Extracted from autonomy.ts for maintainability.
 */

import { stringToUuid } from "@elizaos/core";
import type { AsyncMutex } from "./mutex";
import type { RAGService } from "./plugins/rag/service";
import type { ConnectorsService } from "./plugins/connectors/service";
import {
  FAILED_SELL_COOLDOWN_MS,
  FAILED_BUY_COOLDOWN_MS,
  MAX_TRADE_HISTORY,
  DAILY_SPEND_LIMIT_USD,
} from "./config";
import type { AgentRuntime } from "@elizaos/core";

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
  recentlySold: Map<string, number>;  // token/pubkey → timestamp (auto-expires)
  dailySpend: number;                 // USD spent today
  dailySpendResetAt: number;          // timestamp of next daily reset
  prevPolyBalance: number;            // for P&L tracking
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
    idleCycles: 0,
    depositNotified: false,
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
    (h) => h.question.toLowerCase() === q && Date.now() - h.time < 86_400_000, // SAME_MARKET_COOLDOWN_MS
  );
}

export function isFailCooledDown(failMap: Map<string, number>, key: string, cooldownMs: number): boolean {
  const failTime = failMap.get(key);
  return !failTime || Date.now() - failTime >= cooldownMs;
}

export function recordTrade(state: AutonomyState, entry: TradeHistoryEntry): void {
  state.tradeHistory.push(entry);
  while (state.tradeHistory.length > MAX_TRADE_HISTORY) state.tradeHistory.shift();
}
