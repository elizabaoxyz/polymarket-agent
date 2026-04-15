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

export const MAX_SHARES_PER_ORDER = envInt("MAX_SHARES_PER_ORDER", 500);
export const MAX_POSITIONS = envInt("MAX_POSITIONS", 10);
export const MIN_BET_SIZE_USD = envFloat("MIN_BET_SIZE_USD", 2);

/** Minimum bet size in USD for Jupiter — $3 flat */
export const MIN_BET_SIZE_JUP = envFloat("MIN_BET_SIZE_JUP", 3);
export const MAX_BET_SIZE_USD = envFloat("MAX_BET_SIZE_USD", 5);

// --- Sell thresholds ---

export const SELL_LOSS_THRESHOLD_NORMAL = envFloat("SELL_LOSS_THRESHOLD_NORMAL", -15);
export const SELL_LOSS_THRESHOLD_AGGRESSIVE = envFloat("SELL_LOSS_THRESHOLD_AGGRESSIVE", -8);
export const SELL_PROFIT_THRESHOLD_NORMAL = envFloat("SELL_PROFIT_THRESHOLD_NORMAL", 15);
export const SELL_PROFIT_THRESHOLD_AGGRESSIVE = envFloat("SELL_PROFIT_THRESHOLD_AGGRESSIVE", 8);
export const LOW_BALANCE_THRESHOLD = envFloat("LOW_BALANCE_THRESHOLD", 3);

// --- Timing ---

export const AUTONOMY_INTERVAL_MS = envInt("AUTONOMY_INTERVAL_MS", 60_000);
export const HEARTBEAT_INTERVAL_MS = envInt("HEARTBEAT_INTERVAL_MS", 10_000);
export const FAILED_SELL_COOLDOWN_MS = envInt("FAILED_SELL_COOLDOWN_MS", 1_800_000);
export const FAILED_BUY_COOLDOWN_MS = envInt("FAILED_BUY_COOLDOWN_MS", 1_800_000);
export const SAME_MARKET_COOLDOWN_MS = envInt("SAME_MARKET_COOLDOWN_MS", 604_800_000);
export const MAX_TRADE_HISTORY = envInt("MAX_TRADE_HISTORY", 100);

// --- Market scoring weights ---

export const SCORE_SPREAD_WEIGHT = envFloat("SCORE_SPREAD_WEIGHT", 0.25);
export const SCORE_MIDPOINT_WEIGHT = envFloat("SCORE_MIDPOINT_WEIGHT", 0.15);
export const SCORE_TIME_WEIGHT = envFloat("SCORE_TIME_WEIGHT", 0.2);
export const SCORE_VOLUME_WEIGHT = envFloat("SCORE_VOLUME_WEIGHT", 0.2);

/** Markets resolving within this many days get a quick-flip bonus */
export const QUICK_FLIP_MAX_DAYS = envFloat("QUICK_FLIP_MAX_DAYS", 7);

/** Score bonus for quick-flip markets */
export const QUICK_FLIP_BONUS = envFloat("QUICK_FLIP_BONUS", 0.35);

/** Maximum days — filter removes junk, scoring + LLM handle time preference */
export const MARKET_MAX_DAYS = envFloat("MARKET_MAX_DAYS", 30);

export const SCORE_PRICE_SWEET_SPOT_WEIGHT = envFloat("SCORE_PRICE_SWEET_SPOT_WEIGHT", 0.15);
export const SCORE_MOMENTUM_WEIGHT = envFloat("SCORE_MOMENTUM_WEIGHT", 0.1);
export const SCORE_DEPTH_WEIGHT = envFloat("SCORE_DEPTH_WEIGHT", 0.1);
export const RAG_SIMILARITY_WEIGHT = envFloat("RAG_SIMILARITY_WEIGHT", 0.1);

/** Bonus for markets in categories where LLMs have real knowledge (crypto, major sports, US politics, tech) */
export const LLM_KNOWLEDGE_BONUS = envFloat("LLM_KNOWLEDGE_BONUS", 0.35);

// --- Edge thresholds ---

/** Minimum LLM-reported edge (0-1) to enter a trade. */
export const MIN_EDGE_THRESHOLD = envFloat("MIN_EDGE_THRESHOLD", 0.05);

/** Minimum LLM confidence (0-1) to enter a trade. 0.55 = need a real lean, not a coin flip. */
export const MIN_CONFIDENCE_THRESHOLD = envFloat("MIN_CONFIDENCE_THRESHOLD", 0.55);

/** Estimated taker fee rate per trade (Polymarket ~2%, Jupiter ~1%, gas ~0.5%).
 *  Edge is reduced by this amount before comparing to MIN_EDGE_THRESHOLD. */
export const TAKER_FEE_RATE = envFloat("TAKER_FEE_RATE", 0.03);

// --- Price sweet spot ---

/** Markets with YES price in this range get a scoring bonus (best risk/reward) */
export const PRICE_SWEET_SPOT_MIN = envFloat("PRICE_SWEET_SPOT_MIN", 0.25);
export const PRICE_SWEET_SPOT_MAX = envFloat("PRICE_SWEET_SPOT_MAX", 0.55);

// --- WebSocket auth ---

export const WS_AUTH_TOKEN = process.env.WS_AUTH_TOKEN?.trim() || null;

// --- LLM settings ---

/** Temperature for trading decision LLM calls. Lower = more consistent estimates. */
export const LLM_TEMPERATURE = envFloat("LLM_TEMPERATURE", 0.1);

// --- Retry settings ---

export const MAX_RETRIES = envInt("MAX_RETRIES", 3);
export const RETRY_BASE_DELAY_MS = envInt("RETRY_BASE_DELAY_MS", 1000);

// --- Spending limits ---

export const DAILY_SPEND_LIMIT_USD = envFloat("DAILY_SPEND_LIMIT_USD", 0);

// --- Heartbeat ---

export const HEARTBEAT_MAX_FAILURES = envInt("HEARTBEAT_MAX_FAILURES", 5);

// --- Market intelligence scoring weights ---

export const MIN_DEPTH_USD = envFloat("MIN_DEPTH_USD", 200);
export const CONTRARIAN_BONUS = envFloat("CONTRARIAN_BONUS", 0.15);
export const MIN_REWARD_RATIO = envFloat("MIN_REWARD_RATIO", 0.5);

/** Price range for Polymarket markets to be considered */
export const POLY_PRICE_MIN = envFloat("POLY_PRICE_MIN", 0.15);
export const POLY_PRICE_MAX = envFloat("POLY_PRICE_MAX", 0.8);

/** Cooldown in ms before re-analyzing a market the LLM already skipped */
export const SKIPPED_MARKET_COOLDOWN_MS = envInt("SKIPPED_MARKET_COOLDOWN_MS", 3_600_000);
export const MIN_POLY_VOLUME = envFloat("MIN_POLY_VOLUME", 1500);
export const MIN_JUP_VOLUME = envFloat("MIN_JUP_VOLUME", 5);

// --- Kelly criterion sizing ---

/** Maximum fraction of balance to risk on a single trade — 8% bankroll cap */
export const KELLY_MAX_FRACTION = envFloat("KELLY_MAX_FRACTION", 0.08);

/** Kelly multiplier: 0.25 = quarter-Kelly for small bankrolls (56% growth rate, ~60% less drawdown) */
export const KELLY_FRACTION_MULTIPLIER = envFloat("KELLY_FRACTION_MULTIPLIER", 0.25);

// --- Multi-buy ---

/** Maximum number of buys per platform per autonomy cycle — one careful pick */
export const MAX_BUYS_PER_CYCLE = envInt("MAX_BUYS_PER_CYCLE", 1);

/** Minimum edge required for second buy in a cycle (higher bar) */
export const SECOND_BUY_MIN_EDGE = envFloat("SECOND_BUY_MIN_EDGE", 0.15);

/** Minimum confidence for second buy in a cycle */
export const SECOND_BUY_MIN_CONFIDENCE = envFloat("SECOND_BUY_MIN_CONFIDENCE", 0.7);

// --- Circuit breaker ---

/** Hard loss circuit breaker: pause all trading if cumulative P&L drops below this % of starting balance.
 *  Set to 0 to disable. */
export const CIRCUIT_BREAKER_LOSS_PCT = envFloat("CIRCUIT_BREAKER_LOSS_PCT", -30);

// --- Stuck dust re-evaluation ---

/** Re-check stuck dust positions every 24h to see if they've recovered. */
export const STUCK_DUST_REEVAL_MS = envInt("STUCK_DUST_REEVAL_MS", 86_400_000);

// --- Price-based exit rules ---

/** Auto-sell when position price exceeds this (near-resolution territory) */
export const PRICE_CEILING_SELL = envFloat("PRICE_CEILING_SELL", 0.92);

/** Sell if price > this AND position age > 1 day (R/R turns unfavorable) */
export const HIGH_PRICE_SELL = envFloat("HIGH_PRICE_SELL", 0.88);

/** Auto-sell dead positions below this price */
export const DEAD_POSITION_PRICE = envFloat("DEAD_POSITION_PRICE", 0.1);

/** Hard stop-loss: sell if PnL drops below this % */
export const HARD_STOP_LOSS_PCT = envFloat("HARD_STOP_LOSS_PCT", -15);

/** Trailing stop only activates above this price (avoid whipsaw at low prices) */
export const TRAILING_STOP_MIN_PRICE = envFloat("TRAILING_STOP_MIN_PRICE", 0.88);

/** Trailing stop: sell if price drops this % from peak price */
export const TRAILING_STOP_DROP_PCT = envFloat("TRAILING_STOP_DROP_PCT", 6);

/** Capital pressure: sell weakest positions when balance < this AND positions > threshold */
export const CAPITAL_PRESSURE_MIN_BALANCE = envFloat("CAPITAL_PRESSURE_MIN_BALANCE", 5);

/** Capital pressure: trigger when position count exceeds this */
export const CAPITAL_PRESSURE_MAX_POSITIONS = envInt("CAPITAL_PRESSURE_MAX_POSITIONS", 2);

/** Minimum days to resolution for buy-side — skip same-day markets */
export const MIN_DAYS_LEFT = envFloat("MIN_DAYS_LEFT", 1);

/** Time-decay auto-sell: sell positions in no-man's land when resolution < this many days */
export const TIME_DECAY_SELL_DAYS = envFloat("TIME_DECAY_SELL_DAYS", 2);

/** Partial profit: sell half of position when price >= this (Polymarket only, needs > 10 shares) */
export const PARTIAL_PROFIT_PRICE = envFloat("PARTIAL_PROFIT_PRICE", 0.65);

// --- Kelly criterion sizing ---

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
  // At 0/3: full multiplier, at 2/3: 0.7x multiplier
  const positionPenalty = 1 - (filledPositions / MAX_POSITIONS) * 0.3;
  let fraction = kellyFraction * KELLY_FRACTION_MULTIPLIER * positionPenalty;

  const confMultiplier = Math.max(0.5, Math.min(1.0, confidence));
  fraction *= confMultiplier;

  fraction = Math.min(fraction, KELLY_MAX_FRACTION);

  const size = balance * fraction;
  return Math.max(minBet, Math.min(MAX_BET_SIZE_USD, size));
}

// --- Platform selection ---

/** Default autonomy platform — set via AUTONOMY_PLATFORM env (both | polymarket | jupiter) */
export const AUTONOMY_PLATFORM = (process.env.AUTONOMY_PLATFORM?.trim() || "both") as
  | "both"
  | "polymarket"
  | "jupiter";
