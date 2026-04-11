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
export const MAX_POSITIONS = envInt("MAX_POSITIONS", 50);
export const MIN_BET_SIZE_USD = envFloat("MIN_BET_SIZE_USD", 3);

/** Minimum bet size in USD for Jupiter (lower — Jupiter has split USDC/JupUSD balances) */
export const MIN_BET_SIZE_JUP = envFloat("MIN_BET_SIZE_JUP", 1.5);
export const MAX_BET_SIZE_USD = envFloat("MAX_BET_SIZE_USD", 20);
export const BASE_BET_SIZE_USD = envFloat("BASE_BET_SIZE_USD", 3);

// --- Sell thresholds ---

export const SELL_LOSS_THRESHOLD_NORMAL = envFloat("SELL_LOSS_THRESHOLD_NORMAL", -15);
export const SELL_LOSS_THRESHOLD_AGGRESSIVE = envFloat("SELL_LOSS_THRESHOLD_AGGRESSIVE", -8);
export const SELL_PROFIT_THRESHOLD_NORMAL = envFloat("SELL_PROFIT_THRESHOLD_NORMAL", 30);
export const SELL_PROFIT_THRESHOLD_AGGRESSIVE = envFloat("SELL_PROFIT_THRESHOLD_AGGRESSIVE", 12);
export const LOW_BALANCE_THRESHOLD = envFloat("LOW_BALANCE_THRESHOLD", 3);

// --- Timing ---

export const AUTONOMY_INTERVAL_MS = envInt("AUTONOMY_INTERVAL_MS", 300_000);
export const HEARTBEAT_INTERVAL_MS = envInt("HEARTBEAT_INTERVAL_MS", 10_000);
export const FAILED_SELL_COOLDOWN_MS = envInt("FAILED_SELL_COOLDOWN_MS", 1_800_000);
export const FAILED_BUY_COOLDOWN_MS = envInt("FAILED_BUY_COOLDOWN_MS", 1_800_000);
export const POSITION_MIN_AGE_MS = envInt("POSITION_MIN_AGE_MS", 14_400_000);
export const SAME_MARKET_COOLDOWN_MS = envInt("SAME_MARKET_COOLDOWN_MS", 86_400_000);
export const MAX_TRADE_HISTORY = envInt("MAX_TRADE_HISTORY", 100);

// --- Market scoring weights ---

export const SCORE_SPREAD_WEIGHT = envFloat("SCORE_SPREAD_WEIGHT", 0.25);
export const SCORE_MIDPOINT_WEIGHT = envFloat("SCORE_MIDPOINT_WEIGHT", 0.15);
export const SCORE_TIME_WEIGHT = envFloat("SCORE_TIME_WEIGHT", 0.20);
export const SCORE_VOLUME_WEIGHT = envFloat("SCORE_VOLUME_WEIGHT", 0.20);

/** Markets resolving within this many days get a quick-flip bonus */
export const QUICK_FLIP_MAX_DAYS = envFloat("QUICK_FLIP_MAX_DAYS", 7);

/** Score bonus for quick-flip markets */
export const QUICK_FLIP_BONUS = envFloat("QUICK_FLIP_BONUS", 0.25);

/** Maximum days until market resolution to consider */
export const MARKET_MAX_DAYS = envFloat("MARKET_MAX_DAYS", 90);

export const SCORE_PRICE_SWEET_SPOT_WEIGHT = envFloat("SCORE_PRICE_SWEET_SPOT_WEIGHT", 0.15);
export const SCORE_MOMENTUM_WEIGHT = envFloat("SCORE_MOMENTUM_WEIGHT", 0.10);
export const SCORE_DEPTH_WEIGHT = envFloat("SCORE_DEPTH_WEIGHT", 0.10);
export const RAG_SIMILARITY_WEIGHT = envFloat("RAG_SIMILARITY_WEIGHT", 0.10);

// --- Edge thresholds ---

/** Minimum LLM-reported edge (0-1) to enter a trade. Below this = skip. */
export const MIN_EDGE_THRESHOLD = envFloat("MIN_EDGE_THRESHOLD", 0.10);

/** Minimum LLM confidence (0-1) to enter a trade. */
export const MIN_CONFIDENCE_THRESHOLD = envFloat("MIN_CONFIDENCE_THRESHOLD", 0.6);

// --- Price sweet spot ---

/** Markets with YES price in this range get a scoring bonus (best risk/reward) */
export const PRICE_SWEET_SPOT_MIN = envFloat("PRICE_SWEET_SPOT_MIN", 0.25);
export const PRICE_SWEET_SPOT_MAX = envFloat("PRICE_SWEET_SPOT_MAX", 0.55);

// --- WebSocket auth ---

export const WS_AUTH_TOKEN = process.env.WS_AUTH_TOKEN?.trim() || null;

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
export const MIN_REWARD_RATIO = envFloat("MIN_REWARD_RATIO", 1.0);

/** Price range for Polymarket markets to be considered */
export const POLY_PRICE_MIN = envFloat("POLY_PRICE_MIN", 0.15);
export const POLY_PRICE_MAX = envFloat("POLY_PRICE_MAX", 0.80);

/** Price range for Jupiter — wider because Jupiter markets have more extreme odds */
export const JUP_PRICE_MIN = envFloat("JUP_PRICE_MIN", 0.10);
export const JUP_PRICE_MAX = envFloat("JUP_PRICE_MAX", 0.90);

/** Cooldown in ms before re-analyzing a market the LLM already skipped */
export const SKIPPED_MARKET_COOLDOWN_MS = envInt("SKIPPED_MARKET_COOLDOWN_MS", 3_600_000);
export const MIN_POLY_VOLUME = envFloat("MIN_POLY_VOLUME", 50);
export const MIN_JUP_VOLUME = envFloat("MIN_JUP_VOLUME", 1);

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

// --- Smart position sizing ---

/**
 * Calculate bet size using edge-weighted conviction sizing.
 *
 * The key insight: a prediction market at $0.40 that you believe is worth $0.60
 * has a HUGE edge ($0.20). You should bet more on that than a market at $0.49
 * that you think is worth $0.51 (tiny $0.02 edge).
 *
 * Sizing model:
 * - Base: tiered by market quality score (liquidity, spread, volume)
 * - Edge multiplier: scales bet 0.5×–2.0× based on LLM-reported edge
 * - Confidence multiplier: scales bet by how sure the LLM is
 * - Price sweet spot: 1.3× bonus for prices in the 25–55¢ range
 * - Balance cap: never risk more than 8% on a single trade
 */
export function calcBetSize(
  score: number,
  balance: number,
  minBet = MIN_BET_SIZE_USD,
  marketPrice?: number,
  edge?: number,
  confidence?: number,
): number {
  // Base fraction from market quality
  let fraction: number;
  if (score > 0.8) fraction = 0.08;
  else if (score > 0.6) fraction = 0.05;
  else if (score > 0.4) fraction = 0.03;
  else fraction = 0.02;

  // Edge multiplier: big edge = bigger bet (0.5× to 2.0×)
  // Edge of 0.10 = 1.0×, edge of 0.20 = 1.5×, edge of 0.05 = 0.5×
  if (edge !== undefined && edge > 0) {
    const edgeMultiplier = Math.min(2.0, Math.max(0.5, edge / 0.10));
    fraction *= edgeMultiplier;
  }

  // Confidence multiplier: high confidence = bigger bet (0.7× to 1.3×)
  if (confidence !== undefined && confidence > 0) {
    const confMultiplier = 0.7 + (Math.min(1.0, confidence) * 0.6);
    fraction *= confMultiplier;
  }

  // Price sweet spot: 30% bonus for prices in the 25–55¢ range
  const price = marketPrice ?? 0.50;
  if (price >= PRICE_SWEET_SPOT_MIN && price <= PRICE_SWEET_SPOT_MAX) {
    fraction *= 1.3;
  }

  // Cap at 8% of balance
  fraction = Math.min(fraction, 0.08);

  const size = balance * fraction;
  return Math.max(minBet, Math.min(MAX_BET_SIZE_USD, size));
}

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
  const confMultiplier = Math.max(0.5, Math.min(1.0, confidence));
  fraction *= confMultiplier;

  // Hard cap: never risk more than KELLY_MAX_FRACTION of balance
  fraction = Math.min(fraction, KELLY_MAX_FRACTION);

  const size = balance * fraction;
  return Math.max(minBet, Math.min(MAX_BET_SIZE_USD, size));
}
