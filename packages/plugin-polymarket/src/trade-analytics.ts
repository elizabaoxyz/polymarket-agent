/**
 * Trade Analytics & Learning Module
 * 
 * Learns from past trades to improve future decisions:
 * - Win rate by market type
 * - Best entry price ranges
 * - Optimal hold duration
 * - Edge accuracy vs actual outcomes
 * 
 * @author ElizaBAO
 */

import * as fs from "fs";
import * as path from "path";

// ============================================================
// TYPES
// ============================================================

export interface TradeRecord {
  id: string;
  marketId: string;
  question: string;
  marketType: "elon" | "crypto" | "politics" | "sports" | "other";
  entryPrice: number;
  exitPrice: number | null;
  entryTime: number;
  exitTime: number | null;
  side: "YES" | "NO";
  size: number;
  predictedEdge: number;
  actualOutcome: "win" | "loss" | "pending";
  pnlPercent: number | null;
  pnlUsd: number | null;
  exitReason: "tp" | "sl" | "manual" | "expired" | null;
}

export interface MarketTypeStats {
  totalTrades: number;
  wins: number;
  losses: number;
  pending: number;
  winRate: number;
  avgPnlPercent: number;
  avgHoldHours: number;
  avgEntryPrice: number;
  avgEdge: number;
  edgeAccuracy: number; // How accurate our edge predictions are
  bestEntryRange: { min: number; max: number };
}

export interface TradingInsights {
  overallWinRate: number;
  totalPnlUsd: number;
  bestMarketType: string;
  worstMarketType: string;
  avgHoldHours: number;
  recommendations: string[];
  byMarketType: Record<string, MarketTypeStats>;
}

// ============================================================
// CONFIGURATION
// ============================================================

const ANALYTICS_FILE = "./trade-analytics.json";
const MIN_TRADES_FOR_STATS = 3;

// ============================================================
// STORAGE
// ============================================================

let tradeRecords: TradeRecord[] = [];

export function loadTradeAnalytics(): void {
  try {
    if (fs.existsSync(ANALYTICS_FILE)) {
      const data = fs.readFileSync(ANALYTICS_FILE, "utf-8");
      tradeRecords = JSON.parse(data);
      console.log(`📊 Loaded ${tradeRecords.length} trade records for analytics`);
    }
  } catch (err: any) {
    console.error(`Failed to load trade analytics: ${err.message}`);
    tradeRecords = [];
  }
}

export function saveTradeAnalytics(): void {
  try {
    fs.writeFileSync(ANALYTICS_FILE, JSON.stringify(tradeRecords, null, 2));
  } catch (err: any) {
    console.error(`Failed to save trade analytics: ${err.message}`);
  }
}

// ============================================================
// MARKET TYPE DETECTION
// ============================================================

export function detectMarketType(question: string): TradeRecord["marketType"] {
  const q = question.toLowerCase();
  
  if (q.includes("elon") || q.includes("musk") || q.includes("tweet")) {
    return "elon";
  }
  if (q.includes("bitcoin") || q.includes("ethereum") || q.includes("btc") || 
      q.includes("eth") || q.includes("crypto") || q.includes("solana") ||
      q.includes("price") && (q.includes("$") || q.includes("usd"))) {
    return "crypto";
  }
  if (q.includes("trump") || q.includes("biden") || q.includes("election") ||
      q.includes("president") || q.includes("congress") || q.includes("vote") ||
      q.includes("senate") || q.includes("governor")) {
    return "politics";
  }
  if (q.includes("super bowl") || q.includes("nfl") || q.includes("nba") ||
      q.includes("world cup") || q.includes("championship") || q.includes("playoffs")) {
    return "sports";
  }
  
  return "other";
}

// ============================================================
// TRADE RECORDING
// ============================================================

export function recordTradeEntry(
  id: string,
  marketId: string,
  question: string,
  entryPrice: number,
  side: "YES" | "NO",
  size: number,
  predictedEdge: number
): void {
  const record: TradeRecord = {
    id,
    marketId,
    question,
    marketType: detectMarketType(question),
    entryPrice,
    exitPrice: null,
    entryTime: Date.now(),
    exitTime: null,
    side,
    size,
    predictedEdge,
    actualOutcome: "pending",
    pnlPercent: null,
    pnlUsd: null,
    exitReason: null,
  };
  
  tradeRecords.push(record);
  saveTradeAnalytics();
  console.log(`📊 Recorded trade entry: ${question.slice(0, 40)}... (${record.marketType})`);
}

export function recordTradeExit(
  id: string,
  exitPrice: number,
  exitReason: TradeRecord["exitReason"]
): void {
  const record = tradeRecords.find(r => r.id === id);
  if (!record) {
    console.log(`📊 Trade record not found: ${id}`);
    return;
  }
  
  record.exitPrice = exitPrice;
  record.exitTime = Date.now();
  record.exitReason = exitReason;
  
  // Calculate PnL
  const priceDiff = record.side === "YES" 
    ? exitPrice - record.entryPrice 
    : record.entryPrice - exitPrice;
  
  record.pnlPercent = (priceDiff / record.entryPrice) * 100;
  record.pnlUsd = priceDiff * record.size;
  record.actualOutcome = record.pnlPercent >= 0 ? "win" : "loss";
  
  saveTradeAnalytics();
  console.log(`📊 Recorded trade exit: ${record.pnlPercent >= 0 ? "WIN" : "LOSS"} ${record.pnlPercent.toFixed(1)}%`);
}

// ============================================================
// ANALYTICS CALCULATION
// ============================================================

export function calculateMarketTypeStats(marketType: string): MarketTypeStats | null {
  const trades = tradeRecords.filter(r => r.marketType === marketType && r.actualOutcome !== "pending");
  
  if (trades.length < MIN_TRADES_FOR_STATS) {
    return null;
  }
  
  const wins = trades.filter(r => r.actualOutcome === "win").length;
  const losses = trades.filter(r => r.actualOutcome === "loss").length;
  const pending = tradeRecords.filter(r => r.marketType === marketType && r.actualOutcome === "pending").length;
  
  const completedTrades = trades.filter(r => r.pnlPercent !== null);
  const avgPnl = completedTrades.reduce((sum, r) => sum + (r.pnlPercent || 0), 0) / completedTrades.length;
  
  const tradesWithHold = trades.filter(r => r.exitTime && r.entryTime);
  const avgHoldMs = tradesWithHold.reduce((sum, r) => sum + ((r.exitTime || 0) - r.entryTime), 0) / tradesWithHold.length;
  const avgHoldHours = avgHoldMs / (1000 * 60 * 60);
  
  const avgEntry = trades.reduce((sum, r) => sum + r.entryPrice, 0) / trades.length;
  const avgEdge = trades.reduce((sum, r) => sum + r.predictedEdge, 0) / trades.length;
  
  // Edge accuracy: how often our edge prediction was correct
  const correctEdgePredictions = trades.filter(r => 
    (r.predictedEdge > 0 && r.actualOutcome === "win") ||
    (r.predictedEdge < 0 && r.actualOutcome === "loss")
  ).length;
  const edgeAccuracy = correctEdgePredictions / trades.length;
  
  // Best entry price range (from winning trades)
  const winningTrades = trades.filter(r => r.actualOutcome === "win");
  const entryPrices = winningTrades.map(r => r.entryPrice).sort((a, b) => a - b);
  const bestEntryRange = entryPrices.length >= 2
    ? { min: entryPrices[Math.floor(entryPrices.length * 0.25)], max: entryPrices[Math.floor(entryPrices.length * 0.75)] }
    : { min: 0.1, max: 0.9 };
  
  return {
    totalTrades: trades.length,
    wins,
    losses,
    pending,
    winRate: wins / trades.length,
    avgPnlPercent: avgPnl,
    avgHoldHours,
    avgEntryPrice: avgEntry,
    avgEdge,
    edgeAccuracy,
    bestEntryRange,
  };
}

export function getTradingInsights(): TradingInsights {
  const marketTypes = ["elon", "crypto", "politics", "sports", "other"];
  const byMarketType: Record<string, MarketTypeStats> = {};
  
  for (const type of marketTypes) {
    const stats = calculateMarketTypeStats(type);
    if (stats) {
      byMarketType[type] = stats;
    }
  }
  
  const allCompleted = tradeRecords.filter(r => r.actualOutcome !== "pending");
  const allWins = allCompleted.filter(r => r.actualOutcome === "win").length;
  const overallWinRate = allCompleted.length > 0 ? allWins / allCompleted.length : 0;
  
  const totalPnlUsd = allCompleted.reduce((sum, r) => sum + (r.pnlUsd || 0), 0);
  
  // Find best/worst market types
  let bestMarketType = "none";
  let worstMarketType = "none";
  let bestWinRate = -1;
  let worstWinRate = 2;
  
  for (const [type, stats] of Object.entries(byMarketType)) {
    if (stats.winRate > bestWinRate) {
      bestWinRate = stats.winRate;
      bestMarketType = type;
    }
    if (stats.winRate < worstWinRate) {
      worstWinRate = stats.winRate;
      worstMarketType = type;
    }
  }
  
  // Calculate average hold time
  const tradesWithHold = allCompleted.filter(r => r.exitTime && r.entryTime);
  const avgHoldMs = tradesWithHold.length > 0
    ? tradesWithHold.reduce((sum, r) => sum + ((r.exitTime || 0) - r.entryTime), 0) / tradesWithHold.length
    : 0;
  const avgHoldHours = avgHoldMs / (1000 * 60 * 60);
  
  // Generate recommendations
  const recommendations: string[] = [];
  
  if (bestMarketType !== "none" && byMarketType[bestMarketType]?.winRate > 0.6) {
    recommendations.push(`Focus on ${bestMarketType} markets (${(byMarketType[bestMarketType].winRate * 100).toFixed(0)}% win rate)`);
  }
  
  if (worstMarketType !== "none" && byMarketType[worstMarketType]?.winRate < 0.4) {
    recommendations.push(`Avoid ${worstMarketType} markets (${(byMarketType[worstMarketType].winRate * 100).toFixed(0)}% win rate)`);
  }
  
  for (const [type, stats] of Object.entries(byMarketType)) {
    if (stats.edgeAccuracy < 0.5) {
      recommendations.push(`Improve edge calculation for ${type} (${(stats.edgeAccuracy * 100).toFixed(0)}% accuracy)`);
    }
    if (stats.avgHoldHours > 48 && stats.winRate < 0.5) {
      recommendations.push(`Reduce hold time for ${type} markets (avg ${stats.avgHoldHours.toFixed(0)}h)`);
    }
  }
  
  if (recommendations.length === 0) {
    recommendations.push("Keep trading! Need more data for insights.");
  }
  
  return {
    overallWinRate,
    totalPnlUsd,
    bestMarketType,
    worstMarketType,
    avgHoldHours,
    recommendations,
    byMarketType,
  };
}

// ============================================================
// LEARNING-BASED RECOMMENDATIONS
// ============================================================

export interface TradeRecommendation {
  shouldTrade: boolean;
  confidence: "low" | "medium" | "high";
  reason: string;
  suggestedSize: number; // Multiplier (0.5 = half size, 2.0 = double size)
}

export function getTradeRecommendation(
  question: string,
  entryPrice: number,
  predictedEdge: number,
  baseSize: number
): TradeRecommendation {
  const marketType = detectMarketType(question);
  const stats = calculateMarketTypeStats(marketType);
  
  // Default recommendation (no data)
  if (!stats) {
    return {
      shouldTrade: predictedEdge > 0.05,
      confidence: "low",
      reason: `No historical data for ${marketType} markets`,
      suggestedSize: 1.0,
    };
  }
  
  // Check if entry price is in winning range
  const inBestRange = entryPrice >= stats.bestEntryRange.min && entryPrice <= stats.bestEntryRange.max;
  
  // Calculate confidence based on historical performance
  let confidence: "low" | "medium" | "high" = "low";
  let sizeMultiplier = 1.0;
  
  if (stats.winRate >= 0.65 && stats.edgeAccuracy >= 0.6) {
    confidence = "high";
    sizeMultiplier = 1.5;
  } else if (stats.winRate >= 0.5 && stats.edgeAccuracy >= 0.5) {
    confidence = "medium";
    sizeMultiplier = 1.0;
  } else {
    confidence = "low";
    sizeMultiplier = 0.5;
  }
  
  // Adjust based on entry price range
  if (inBestRange) {
    sizeMultiplier *= 1.2;
  } else {
    sizeMultiplier *= 0.8;
  }
  
  // Determine if we should trade
  const minEdge = stats.avgEdge > 0 ? stats.avgEdge * 0.8 : 0.05;
  const shouldTrade = predictedEdge >= minEdge && stats.winRate >= 0.4;
  
  const reason = shouldTrade
    ? `${marketType}: ${(stats.winRate * 100).toFixed(0)}% win rate, edge ${(predictedEdge * 100).toFixed(1)}% vs avg ${(stats.avgEdge * 100).toFixed(1)}%`
    : `${marketType}: Low confidence (${(stats.winRate * 100).toFixed(0)}% win rate, edge ${(predictedEdge * 100).toFixed(1)}%)`;
  
  return {
    shouldTrade,
    confidence,
    reason,
    suggestedSize: Math.max(0.5, Math.min(2.0, sizeMultiplier)),
  };
}

// ============================================================
// EXPORTS
// ============================================================

export function getTradeRecords(): TradeRecord[] {
  return [...tradeRecords];
}

export function getCompletedTradesCount(): number {
  return tradeRecords.filter(r => r.actualOutcome !== "pending").length;
}

export function getPendingTradesCount(): number {
  return tradeRecords.filter(r => r.actualOutcome === "pending").length;
}
