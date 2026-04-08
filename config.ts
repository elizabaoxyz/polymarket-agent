/**
 * Centralized configuration for the trading agent.
 * All hardcoded constants are extracted here and can be overridden via environment variables.
 */

function envInt(key: string, fallback: number): number {
  const raw = process.env[key]?.trim();
  if (!raw) return fallback;
  const parsed = Number.parseInt(raw, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function envFloat(key: string, fallback: number): number {
  const raw = process.env[key]?.trim();
  if (!raw) return fallback;
  const parsed = Number.parseFloat(raw);
  return Number.isFinite(parsed) ? parsed : fallback;
}

// --- Trading limits ---

/** Maximum shares per single Polymarket order */
export const MAX_SHARES_PER_ORDER = envInt("MAX_SHARES_PER_ORDER", 500);

/** Maximum open positions across all platforms */
export const MAX_POSITIONS = envInt("MAX_POSITIONS", 50);

/** Minimum bet size in USD (Polymarket) */
export const MIN_BET_SIZE_USD = envFloat("MIN_BET_SIZE_USD", 3);

/** Maximum bet size in USD */
export const MAX_BET_SIZE_USD = envFloat("MAX_BET_SIZE_USD", 6);

/** Base bet size in USD */
export const BASE_BET_SIZE_USD = envFloat("BASE_BET_SIZE_USD", 3);

// --- Sell thresholds ---

/** Normal loss threshold (%) — sell when position drops below this */
export const SELL_LOSS_THRESHOLD_NORMAL = envFloat("SELL_LOSS_THRESHOLD_NORMAL", -15);

/** Aggressive loss threshold (%) — used when balance is low */
export const SELL_LOSS_THRESHOLD_AGGRESSIVE = envFloat("SELL_LOSS_THRESHOLD_AGGRESSIVE", -5);

/** Normal profit threshold (%) — take profit above this */
export const SELL_PROFIT_THRESHOLD_NORMAL = envFloat("SELL_PROFIT_THRESHOLD_NORMAL", 10);

/** Aggressive profit threshold (%) — used when balance is low */
export const SELL_PROFIT_THRESHOLD_AGGRESSIVE = envFloat("SELL_PROFIT_THRESHOLD_AGGRESSIVE", 5);

/** Low balance threshold in USD — triggers aggressive mode */
export const LOW_BALANCE_THRESHOLD = envFloat("LOW_BALANCE_THRESHOLD", 3);

// --- Timing ---

/** Autonomy loop interval in milliseconds */
export const AUTONOMY_INTERVAL_MS = envInt("AUTONOMY_INTERVAL_MS", 60_000);

/** Heartbeat interval in milliseconds */
export const HEARTBEAT_INTERVAL_MS = envInt("HEARTBEAT_INTERVAL_MS", 10_000);

/** Cooldown before retrying a failed sell (ms) */
export const FAILED_SELL_COOLDOWN_MS = envInt("FAILED_SELL_COOLDOWN_MS", 1_800_000);

/** Cooldown before retrying a failed buy (ms) */
export const FAILED_BUY_COOLDOWN_MS = envInt("FAILED_BUY_COOLDOWN_MS", 1_800_000);

/** Minimum age before a position can be sold (ms) */
export const POSITION_MIN_AGE_MS = envInt("POSITION_MIN_AGE_MS", 600_000);

/** Cooldown between trading the same market (ms) */
export const SAME_MARKET_COOLDOWN_MS = envInt("SAME_MARKET_COOLDOWN_MS", 86_400_000);

/** Maximum trade history entries to keep */
export const MAX_TRADE_HISTORY = envInt("MAX_TRADE_HISTORY", 100);

// --- Market scoring weights ---

export const SCORE_SPREAD_WEIGHT = envFloat("SCORE_SPREAD_WEIGHT", 0.35);
export const SCORE_MIDPOINT_WEIGHT = envFloat("SCORE_MIDPOINT_WEIGHT", 0.30);
export const SCORE_TIME_WEIGHT = envFloat("SCORE_TIME_WEIGHT", 0.20);
export const SCORE_VOLUME_WEIGHT = envFloat("SCORE_VOLUME_WEIGHT", 0.15);

/** RAG similarity weight when adjusting market scores */
export const RAG_SIMILARITY_WEIGHT = envFloat("RAG_SIMILARITY_WEIGHT", 0.10);

// --- WebSocket auth ---

/** Optional WS auth token — if set, clients must send { type: "auth", token: "..." } first */
export const WS_AUTH_TOKEN = process.env.WS_AUTH_TOKEN?.trim() || null;

// --- Retry settings ---

/** Maximum retries for transient API failures */
export const MAX_RETRIES = envInt("MAX_RETRIES", 3);

/** Base delay for exponential backoff (ms) */
export const RETRY_BASE_DELAY_MS = envInt("RETRY_BASE_DELAY_MS", 1000);

// --- Spending limits ---

/** Maximum USD to spend per day across all platforms (0 = unlimited) */
export const DAILY_SPEND_LIMIT_USD = envFloat("DAILY_SPEND_LIMIT_USD", 0);

// --- Heartbeat ---

/** Max consecutive heartbeat failures before alerting user */
export const HEARTBEAT_MAX_FAILURES = envInt("HEARTBEAT_MAX_FAILURES", 5);

// --- Smart position sizing ---

/**
 * Calculate bet size based on conviction score and available balance.
 * Returns a value between MIN_BET_SIZE_USD and MAX_BET_SIZE_USD.
 */
export function calcBetSize(score: number, balance: number, minBet = MIN_BET_SIZE_USD): number {
  let size: number;
  if (score > 0.9) size = Math.min(BASE_BET_SIZE_USD * 2, balance * 0.1);
  else if (score > 0.7) size = Math.min(BASE_BET_SIZE_USD * 1.5, balance * 0.08);
  else size = Math.min(BASE_BET_SIZE_USD, balance * 0.05);
  return Math.max(minBet, Math.min(MAX_BET_SIZE_USD, size));
}
