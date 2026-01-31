/**
 * Dynamic Take Profit / Stop Loss Module
 * 
 * Adjusts TP/SL based on:
 * - Market volatility
 * - Time to expiry
 * - Position edge
 * - Historical performance
 * 
 * @author ElizaBAO
 */

import { getTradingInsights } from "./trade-analytics.js";

// ============================================================
// TYPES
// ============================================================

export interface DynamicTPSL {
  takeProfitPercent: number;
  stopLossPercent: number;
  takeProfitPrice: number;
  stopLossPrice: number;
  trailingStop: boolean;
  trailingPercent: number;
  reason: string;
}

export interface MarketConditions {
  volatility: "low" | "medium" | "high";
  timeToExpiry: "short" | "medium" | "long"; // <24h, 24h-7d, >7d
  edge: "low" | "medium" | "high";
  marketType: "elon" | "crypto" | "politics" | "sports" | "other";
}

// ============================================================
// CONFIGURATION
// ============================================================

export const TPSL_CONFIG = {
  // Base values
  baseTakeProfit: 0.20,  // 20%
  baseStopLoss: 0.15,    // 15%
  
  // Volatility adjustments
  volatilityMultipliers: {
    low: { tp: 0.8, sl: 0.7 },      // Tighter TP/SL for low vol
    medium: { tp: 1.0, sl: 1.0 },   // Normal
    high: { tp: 1.4, sl: 1.3 },     // Wider TP/SL for high vol
  },
  
  // Time adjustments
  timeMultipliers: {
    short: { tp: 0.7, sl: 0.8 },    // Tighter for short-term
    medium: { tp: 1.0, sl: 1.0 },   // Normal
    long: { tp: 1.3, sl: 1.2 },     // Wider for long-term
  },
  
  // Edge adjustments
  edgeMultipliers: {
    low: { tp: 0.8, sl: 1.2 },      // Lower TP, wider SL (protect capital)
    medium: { tp: 1.0, sl: 1.0 },   // Normal
    high: { tp: 1.3, sl: 0.8 },     // Higher TP, tighter SL (maximize edge)
  },
  
  // Market type adjustments
  marketTypeMultipliers: {
    elon: { tp: 1.0, sl: 1.0 },     // Normal (we have good data)
    crypto: { tp: 1.2, sl: 1.3 },   // Wider (high volatility)
    politics: { tp: 0.9, sl: 0.9 }, // Tighter (tends to be binary)
    sports: { tp: 0.8, sl: 0.8 },   // Tighter (quick resolution)
    other: { tp: 1.0, sl: 1.0 },    // Normal
  },
  
  // Absolute limits
  minTakeProfit: 0.10,   // 10% minimum
  maxTakeProfit: 0.50,   // 50% maximum
  minStopLoss: 0.08,     // 8% minimum
  maxStopLoss: 0.30,     // 30% maximum
  
  // Trailing stop settings
  enableTrailingStop: true,
  trailingStopThreshold: 0.10, // Activate after 10% profit
  trailingStopPercent: 0.05,   // Trail by 5%
};

// ============================================================
// VOLATILITY DETECTION
// ============================================================

export function detectVolatility(
  priceHistory: number[],
  marketType: string
): "low" | "medium" | "high" {
  // If we have price history, calculate realized volatility
  if (priceHistory.length >= 5) {
    const returns: number[] = [];
    for (let i = 1; i < priceHistory.length; i++) {
      returns.push((priceHistory[i] - priceHistory[i-1]) / priceHistory[i-1]);
    }
    
    const avgReturn = returns.reduce((a, b) => a + b, 0) / returns.length;
    const variance = returns.reduce((sum, r) => sum + Math.pow(r - avgReturn, 2), 0) / returns.length;
    const stdDev = Math.sqrt(variance);
    
    if (stdDev < 0.05) return "low";
    if (stdDev > 0.15) return "high";
    return "medium";
  }
  
  // Fallback: estimate from market type
  if (marketType === "crypto") return "high";
  if (marketType === "sports") return "low";
  if (marketType === "elon") return "medium";
  
  return "medium";
}

export function detectTimeToExpiry(hoursToExpiry: number): "short" | "medium" | "long" {
  if (hoursToExpiry < 24) return "short";
  if (hoursToExpiry > 168) return "long"; // > 7 days
  return "medium";
}

export function detectEdgeLevel(edge: number): "low" | "medium" | "high" {
  if (edge >= 0.20) return "high";
  if (edge >= 0.10) return "medium";
  return "low";
}

// ============================================================
// DYNAMIC CALCULATION
// ============================================================

export function calculateDynamicTPSL(
  entryPrice: number,
  conditions: MarketConditions
): DynamicTPSL {
  // Start with base values
  let tpPercent = TPSL_CONFIG.baseTakeProfit;
  let slPercent = TPSL_CONFIG.baseStopLoss;
  
  // Apply volatility multiplier
  const volMult = TPSL_CONFIG.volatilityMultipliers[conditions.volatility];
  tpPercent *= volMult.tp;
  slPercent *= volMult.sl;
  
  // Apply time multiplier
  const timeMult = TPSL_CONFIG.timeMultipliers[conditions.timeToExpiry];
  tpPercent *= timeMult.tp;
  slPercent *= timeMult.sl;
  
  // Apply edge multiplier
  const edgeMult = TPSL_CONFIG.edgeMultipliers[conditions.edge];
  tpPercent *= edgeMult.tp;
  slPercent *= edgeMult.sl;
  
  // Apply market type multiplier
  const typeMult = TPSL_CONFIG.marketTypeMultipliers[conditions.marketType];
  tpPercent *= typeMult.tp;
  slPercent *= typeMult.sl;
  
  // Apply historical performance adjustment
  try {
    const insights = getTradingInsights();
    const typeStats = insights.byMarketType[conditions.marketType];
    
    if (typeStats) {
      // If we're winning a lot in this market type, be more aggressive
      if (typeStats.winRate > 0.65) {
        tpPercent *= 1.2;
        slPercent *= 0.9;
      }
      // If we're losing, be more defensive
      else if (typeStats.winRate < 0.4) {
        tpPercent *= 0.8;
        slPercent *= 1.1;
      }
    }
  } catch {
    // No historical data, use defaults
  }
  
  // Clamp to limits
  tpPercent = Math.max(TPSL_CONFIG.minTakeProfit, Math.min(TPSL_CONFIG.maxTakeProfit, tpPercent));
  slPercent = Math.max(TPSL_CONFIG.minStopLoss, Math.min(TPSL_CONFIG.maxStopLoss, slPercent));
  
  // Calculate actual prices
  const tpPrice = Math.min(0.99, entryPrice * (1 + tpPercent));
  const slPrice = Math.max(0.01, entryPrice * (1 - slPercent));
  
  // Determine if trailing stop should be used
  const useTrailingStop = TPSL_CONFIG.enableTrailingStop && 
    conditions.timeToExpiry !== "short" &&
    conditions.volatility !== "low";
  
  // Build reason string
  const reasons: string[] = [];
  if (conditions.volatility !== "medium") reasons.push(`${conditions.volatility} vol`);
  if (conditions.timeToExpiry !== "medium") reasons.push(`${conditions.timeToExpiry} term`);
  if (conditions.edge !== "medium") reasons.push(`${conditions.edge} edge`);
  reasons.push(conditions.marketType);
  
  return {
    takeProfitPercent: tpPercent,
    stopLossPercent: slPercent,
    takeProfitPrice: Number(tpPrice.toFixed(3)),
    stopLossPrice: Number(slPrice.toFixed(3)),
    trailingStop: useTrailingStop,
    trailingPercent: TPSL_CONFIG.trailingStopPercent,
    reason: `TP: +${(tpPercent * 100).toFixed(0)}%, SL: -${(slPercent * 100).toFixed(0)}% (${reasons.join(", ")})`,
  };
}

// ============================================================
// SIMPLE INTERFACE
// ============================================================

export function getDynamicTPSL(
  entryPrice: number,
  question: string,
  edge: number,
  hoursToExpiry: number = 48,
  priceHistory: number[] = []
): DynamicTPSL {
  // Detect market type from question
  const q = question.toLowerCase();
  let marketType: MarketConditions["marketType"] = "other";
  
  if (q.includes("elon") || q.includes("musk") || q.includes("tweet")) {
    marketType = "elon";
  } else if (q.includes("bitcoin") || q.includes("crypto") || q.includes("eth") || q.includes("price")) {
    marketType = "crypto";
  } else if (q.includes("trump") || q.includes("election") || q.includes("vote")) {
    marketType = "politics";
  } else if (q.includes("super bowl") || q.includes("nfl") || q.includes("game")) {
    marketType = "sports";
  }
  
  const conditions: MarketConditions = {
    volatility: detectVolatility(priceHistory, marketType),
    timeToExpiry: detectTimeToExpiry(hoursToExpiry),
    edge: detectEdgeLevel(edge),
    marketType,
  };
  
  return calculateDynamicTPSL(entryPrice, conditions);
}

// ============================================================
// TRAILING STOP LOGIC
// ============================================================

export interface TrailingStopState {
  activated: boolean;
  highWaterMark: number;
  currentStopPrice: number;
}

export function updateTrailingStop(
  state: TrailingStopState,
  currentPrice: number,
  entryPrice: number,
  trailingPercent: number
): TrailingStopState {
  const profitPercent = (currentPrice - entryPrice) / entryPrice;
  
  // Activate trailing stop if profit threshold reached
  if (!state.activated && profitPercent >= TPSL_CONFIG.trailingStopThreshold) {
    return {
      activated: true,
      highWaterMark: currentPrice,
      currentStopPrice: currentPrice * (1 - trailingPercent),
    };
  }
  
  // Update high water mark if price went higher
  if (state.activated && currentPrice > state.highWaterMark) {
    return {
      ...state,
      highWaterMark: currentPrice,
      currentStopPrice: currentPrice * (1 - trailingPercent),
    };
  }
  
  return state;
}

export function checkTrailingStopHit(
  state: TrailingStopState,
  currentPrice: number
): boolean {
  return state.activated && currentPrice <= state.currentStopPrice;
}

// ============================================================
// POSITION SIZE ADJUSTMENT
// ============================================================

export function adjustPositionSize(
  baseSize: number,
  conditions: MarketConditions,
  accountRiskPercent: number = 0.02 // 2% of account per trade
): number {
  let sizeMultiplier = 1.0;
  
  // Reduce size for high volatility
  if (conditions.volatility === "high") {
    sizeMultiplier *= 0.7;
  } else if (conditions.volatility === "low") {
    sizeMultiplier *= 1.2;
  }
  
  // Increase size for high edge
  if (conditions.edge === "high") {
    sizeMultiplier *= 1.3;
  } else if (conditions.edge === "low") {
    sizeMultiplier *= 0.7;
  }
  
  // Reduce size for long-term (more uncertainty)
  if (conditions.timeToExpiry === "long") {
    sizeMultiplier *= 0.8;
  }
  
  return Math.max(1, baseSize * sizeMultiplier);
}
