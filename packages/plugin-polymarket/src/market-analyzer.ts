/**
 * Polymarket Market Analyzer
 * 
 * Real-time comprehensive analysis:
 * - Order book depth (YES/NO)
 * - Trade volume analysis
 * - Buy vs Sell pressure
 * - Limit order tracking
 * - Price momentum
 * - Whale detection
 * 
 * @author ElizaBAO
 */

// ============================================================
// TYPES
// ============================================================

export interface OrderBookLevel {
  price: number;
  size: number;
  totalValue: number;
}

export interface OrderBook {
  bids: OrderBookLevel[]; // Buyers (YES)
  asks: OrderBookLevel[]; // Sellers (YES)
  bestBid: number;
  bestAsk: number;
  midPrice: number;
  spread: number;
  spreadPercent: number;
  totalBidVolume: number;
  totalAskVolume: number;
  imbalance: number; // -1 to 1 (positive = more buyers)
}

export interface TradeRecord {
  id: string;
  price: number;
  size: number;
  side: "BUY" | "SELL";
  timestamp: string;
  valueUsd: number;
  isWhale: boolean;
}

export interface VolumeAnalysis {
  volume24h: number;
  volumeYes: number;
  volumeNo: number;
  buyVolume: number;
  sellVolume: number;
  netFlow: number;
  avgTradeSize: number;
  tradeCount: number;
  largestTrade: number;
  whaleTrades: number;
}

export interface PriceMomentum {
  currentPrice: number;
  price1hAgo: number;
  price24hAgo: number;
  change1h: number;
  change24h: number;
  trend: "up" | "down" | "sideways";
  strength: number; // 0 to 1
}

export interface MarketAnalysis {
  marketId: string;
  tokenId: string;
  question: string;
  timestamp: string;
  orderBook: OrderBook;
  volume: VolumeAnalysis;
  momentum: PriceMomentum;
  signal: {
    direction: "buy" | "sell" | "hold";
    strength: number;
    confidence: number;
    reasons: string[];
  };
}

// ============================================================
// CONSTANTS
// ============================================================

const CLOB_API = "https://clob.polymarket.com";
const WHALE_THRESHOLD_USD = 1000;
const CACHE_TTL_MS = 30 * 1000; // 30 seconds for real-time data

// ============================================================
// CACHE
// ============================================================

const analysisCache: Map<string, { data: MarketAnalysis; expires: number }> = new Map();

// ============================================================
// FETCH ORDER BOOK
// ============================================================

async function fetchOrderBook(tokenId: string): Promise<OrderBook | null> {
  try {
    const url = `${CLOB_API}/book?token_id=${tokenId}`;
    
    const response = await fetch(url, {
      headers: { "User-Agent": "ElizaBAO/2.2 Market Analyzer" },
    });
    
    if (!response.ok) {
      console.log(`Order book fetch error: ${response.status}`);
      return null;
    }
    
    const data = await response.json();
    
    // Process bids (buyers)
    const bids: OrderBookLevel[] = [];
    let totalBidVolume = 0;
    let bestBid = 0;
    
    for (const bid of (data.bids || []).slice(0, 20)) {
      const price = parseFloat(bid.price || "0");
      const size = parseFloat(bid.size || "0");
      const totalValue = price * size;
      
      bids.push({ price, size, totalValue });
      totalBidVolume += totalValue;
      
      if (price > bestBid) bestBid = price;
    }
    
    // Process asks (sellers)
    const asks: OrderBookLevel[] = [];
    let totalAskVolume = 0;
    let bestAsk = 1;
    
    for (const ask of (data.asks || []).slice(0, 20)) {
      const price = parseFloat(ask.price || "0");
      const size = parseFloat(ask.size || "0");
      const totalValue = price * size;
      
      asks.push({ price, size, totalValue });
      totalAskVolume += totalValue;
      
      if (price < bestAsk) bestAsk = price;
    }
    
    const midPrice = (bestBid + bestAsk) / 2;
    const spread = bestAsk - bestBid;
    const spreadPercent = midPrice > 0 ? (spread / midPrice) * 100 : 0;
    
    const total = totalBidVolume + totalAskVolume;
    const imbalance = total > 0 ? (totalBidVolume - totalAskVolume) / total : 0;
    
    return {
      bids,
      asks,
      bestBid,
      bestAsk,
      midPrice,
      spread,
      spreadPercent,
      totalBidVolume,
      totalAskVolume,
      imbalance,
    };
  } catch (err: any) {
    console.error(`Order book error: ${err.message}`);
    return null;
  }
}

// ============================================================
// FETCH TRADES
// ============================================================

async function fetchRecentTrades(tokenId: string, limit: number = 100): Promise<TradeRecord[]> {
  const trades: TradeRecord[] = [];
  
  try {
    const url = `${CLOB_API}/trades?asset_id=${tokenId}&limit=${limit}`;
    
    const response = await fetch(url, {
      headers: { "User-Agent": "ElizaBAO/2.2 Market Analyzer" },
    });
    
    if (!response.ok) {
      console.log(`Trades fetch error: ${response.status}`);
      return trades;
    }
    
    const data = await response.json();
    
    for (const trade of data || []) {
      const price = parseFloat(trade.price || "0");
      const size = parseFloat(trade.size || "0");
      const valueUsd = price * size;
      
      trades.push({
        id: trade.id || "",
        price,
        size,
        side: trade.side === "BUY" ? "BUY" : "SELL",
        timestamp: trade.created_at || new Date().toISOString(),
        valueUsd,
        isWhale: valueUsd >= WHALE_THRESHOLD_USD,
      });
    }
  } catch (err: any) {
    console.error(`Trades fetch error: ${err.message}`);
  }
  
  return trades;
}

// ============================================================
// ANALYZE VOLUME
// ============================================================

function analyzeVolume(trades: TradeRecord[]): VolumeAnalysis {
  const now = Date.now();
  const oneDayAgo = now - 24 * 60 * 60 * 1000;
  
  // Filter to last 24h
  const recentTrades = trades.filter(t => 
    new Date(t.timestamp).getTime() > oneDayAgo
  );
  
  let buyVolume = 0;
  let sellVolume = 0;
  let largestTrade = 0;
  let whaleTrades = 0;
  
  for (const trade of recentTrades) {
    if (trade.side === "BUY") {
      buyVolume += trade.valueUsd;
    } else {
      sellVolume += trade.valueUsd;
    }
    
    if (trade.valueUsd > largestTrade) {
      largestTrade = trade.valueUsd;
    }
    
    if (trade.isWhale) {
      whaleTrades++;
    }
  }
  
  const volume24h = buyVolume + sellVolume;
  const avgTradeSize = recentTrades.length > 0 ? volume24h / recentTrades.length : 0;
  
  return {
    volume24h,
    volumeYes: buyVolume, // Buying YES
    volumeNo: sellVolume,  // Selling YES (buying NO equivalent)
    buyVolume,
    sellVolume,
    netFlow: buyVolume - sellVolume,
    avgTradeSize,
    tradeCount: recentTrades.length,
    largestTrade,
    whaleTrades,
  };
}

// ============================================================
// ANALYZE PRICE MOMENTUM
// ============================================================

function analyzeMomentum(trades: TradeRecord[], currentPrice: number): PriceMomentum {
  const now = Date.now();
  const oneHourAgo = now - 60 * 60 * 1000;
  const oneDayAgo = now - 24 * 60 * 60 * 1000;
  
  // Find prices at different times
  let price1hAgo = currentPrice;
  let price24hAgo = currentPrice;
  
  for (const trade of trades) {
    const tradeTime = new Date(trade.timestamp).getTime();
    
    if (tradeTime <= oneHourAgo && trade.price !== price1hAgo) {
      price1hAgo = trade.price;
      break;
    }
  }
  
  for (const trade of trades) {
    const tradeTime = new Date(trade.timestamp).getTime();
    
    if (tradeTime <= oneDayAgo && trade.price !== price24hAgo) {
      price24hAgo = trade.price;
      break;
    }
  }
  
  const change1h = currentPrice - price1hAgo;
  const change24h = currentPrice - price24hAgo;
  
  // Determine trend
  let trend: "up" | "down" | "sideways" = "sideways";
  if (change1h > 0.02 && change24h > 0.03) {
    trend = "up";
  } else if (change1h < -0.02 && change24h < -0.03) {
    trend = "down";
  }
  
  // Calculate strength (0 to 1)
  const strength = Math.min(1, Math.abs(change24h) * 5);
  
  return {
    currentPrice,
    price1hAgo,
    price24hAgo,
    change1h,
    change24h,
    trend,
    strength,
  };
}

// ============================================================
// GENERATE TRADING SIGNAL
// ============================================================

function generateSignal(
  orderBook: OrderBook | null,
  volume: VolumeAnalysis,
  momentum: PriceMomentum
): MarketAnalysis["signal"] {
  const reasons: string[] = [];
  let buyScore = 0;
  let sellScore = 0;
  
  // Order book analysis
  if (orderBook) {
    if (orderBook.imbalance > 0.3) {
      buyScore += 2;
      reasons.push(`Strong buy pressure (${(orderBook.imbalance * 100).toFixed(0)}% imbalance)`);
    } else if (orderBook.imbalance < -0.3) {
      sellScore += 2;
      reasons.push(`Strong sell pressure (${(Math.abs(orderBook.imbalance) * 100).toFixed(0)}% imbalance)`);
    }
    
    if (orderBook.spreadPercent < 1) {
      reasons.push(`Tight spread (${orderBook.spreadPercent.toFixed(2)}%)`);
    } else if (orderBook.spreadPercent > 5) {
      reasons.push(`Wide spread warning (${orderBook.spreadPercent.toFixed(1)}%)`);
    }
  }
  
  // Volume analysis
  if (volume.netFlow > 1000) {
    buyScore += 2;
    reasons.push(`Net inflow +$${volume.netFlow.toFixed(0)}`);
  } else if (volume.netFlow < -1000) {
    sellScore += 2;
    reasons.push(`Net outflow -$${Math.abs(volume.netFlow).toFixed(0)}`);
  }
  
  if (volume.whaleTrades > 3) {
    reasons.push(`${volume.whaleTrades} whale trades detected`);
    if (volume.buyVolume > volume.sellVolume) {
      buyScore += 1;
    } else {
      sellScore += 1;
    }
  }
  
  // Momentum analysis
  if (momentum.trend === "up" && momentum.strength > 0.3) {
    buyScore += 2;
    reasons.push(`Upward momentum (+${(momentum.change24h * 100).toFixed(1)}% 24h)`);
  } else if (momentum.trend === "down" && momentum.strength > 0.3) {
    sellScore += 2;
    reasons.push(`Downward momentum (${(momentum.change24h * 100).toFixed(1)}% 24h)`);
  }
  
  // Determine direction
  let direction: "buy" | "sell" | "hold" = "hold";
  const totalScore = buyScore + sellScore;
  
  if (buyScore > sellScore + 2) {
    direction = "buy";
  } else if (sellScore > buyScore + 2) {
    direction = "sell";
  }
  
  const strength = totalScore > 0 ? Math.abs(buyScore - sellScore) / totalScore : 0;
  const confidence = Math.min(1, totalScore / 10);
  
  return {
    direction,
    strength,
    confidence,
    reasons,
  };
}

// ============================================================
// MAIN ANALYSIS FUNCTION
// ============================================================

export async function analyzeMarket(
  marketId: string,
  tokenId: string,
  question: string
): Promise<MarketAnalysis> {
  // Check cache
  const cacheKey = tokenId;
  const cached = analysisCache.get(cacheKey);
  if (cached && cached.expires > Date.now()) {
    return cached.data;
  }

  console.log(`📊 Analyzing market: "${question.slice(0, 40)}..."`);

  // Fetch data in parallel
  const [orderBook, trades] = await Promise.all([
    fetchOrderBook(tokenId),
    fetchRecentTrades(tokenId, 200),
  ]);

  const currentPrice = orderBook?.midPrice || 0.5;
  const volume = analyzeVolume(trades);
  const momentum = analyzeMomentum(trades, currentPrice);
  const signal = generateSignal(orderBook, volume, momentum);

  const analysis: MarketAnalysis = {
    marketId,
    tokenId,
    question,
    timestamp: new Date().toISOString(),
    orderBook: orderBook || {
      bids: [],
      asks: [],
      bestBid: 0,
      bestAsk: 1,
      midPrice: 0.5,
      spread: 1,
      spreadPercent: 100,
      totalBidVolume: 0,
      totalAskVolume: 0,
      imbalance: 0,
    },
    volume,
    momentum,
    signal,
  };

  // Cache result
  analysisCache.set(cacheKey, { data: analysis, expires: Date.now() + CACHE_TTL_MS });

  // Log summary
  console.log(`📊 Analysis complete:`);
  console.log(`   Price: ${(currentPrice * 100).toFixed(1)}% | Trend: ${momentum.trend} | Imbalance: ${orderBook ? (orderBook.imbalance * 100).toFixed(0) : 0}%`);
  console.log(`   Volume 24h: $${volume.volume24h.toFixed(0)} | Buy: $${volume.buyVolume.toFixed(0)} | Sell: $${volume.sellVolume.toFixed(0)}`);
  console.log(`   Signal: ${signal.direction.toUpperCase()} (${(signal.confidence * 100).toFixed(0)}% confidence)`);

  return analysis;
}

// ============================================================
// QUICK MARKET CHECK
// ============================================================

export interface QuickMarketCheck {
  price: number;
  volume24h: number;
  buyPercent: number;
  sellPercent: number;
  trend: "up" | "down" | "sideways";
  signal: "buy" | "sell" | "hold";
  whaleActivity: boolean;
}

export async function quickMarketCheck(tokenId: string): Promise<QuickMarketCheck | null> {
  try {
    const [orderBook, trades] = await Promise.all([
      fetchOrderBook(tokenId),
      fetchRecentTrades(tokenId, 50),
    ]);

    if (!orderBook) return null;

    const volume = analyzeVolume(trades);
    const momentum = analyzeMomentum(trades, orderBook.midPrice);

    const totalVolume = volume.buyVolume + volume.sellVolume;
    const buyPercent = totalVolume > 0 ? (volume.buyVolume / totalVolume) * 100 : 50;
    const sellPercent = 100 - buyPercent;

    let signal: "buy" | "sell" | "hold" = "hold";
    if (orderBook.imbalance > 0.3 && buyPercent > 60) {
      signal = "buy";
    } else if (orderBook.imbalance < -0.3 && sellPercent > 60) {
      signal = "sell";
    }

    return {
      price: orderBook.midPrice,
      volume24h: volume.volume24h,
      buyPercent,
      sellPercent,
      trend: momentum.trend,
      signal,
      whaleActivity: volume.whaleTrades > 0,
    };
  } catch {
    return null;
  }
}

// ============================================================
// BATCH ANALYZE MARKETS
// ============================================================

export async function batchAnalyzeMarkets(
  markets: Array<{ marketId: string; tokenId: string; question: string }>
): Promise<MarketAnalysis[]> {
  const analyses: MarketAnalysis[] = [];
  
  // Process in batches of 5 to avoid rate limiting
  for (let i = 0; i < markets.length; i += 5) {
    const batch = markets.slice(i, i + 5);
    
    const batchPromises = batch.map(m => 
      analyzeMarket(m.marketId, m.tokenId, m.question)
        .catch(err => null)
    );
    
    const results = await Promise.all(batchPromises);
    
    for (const result of results) {
      if (result) {
        analyses.push(result);
      }
    }
    
    // Small delay between batches
    if (i + 5 < markets.length) {
      await new Promise(r => setTimeout(r, 500));
    }
  }
  
  return analyses;
}

// ============================================================
// GET TOP OPPORTUNITIES
// ============================================================

export function rankOpportunities(analyses: MarketAnalysis[]): MarketAnalysis[] {
  return analyses
    .filter(a => a.signal.direction !== "hold" && a.signal.confidence > 0.3)
    .sort((a, b) => {
      // Sort by confidence * strength
      const scoreA = a.signal.confidence * a.signal.strength;
      const scoreB = b.signal.confidence * b.signal.strength;
      return scoreB - scoreA;
    });
}

// ============================================================
// FORMAT ANALYSIS REPORT
// ============================================================

export function formatAnalysisReport(analysis: MarketAnalysis): string {
  let report = `\n📊 MARKET ANALYSIS: ${analysis.question.slice(0, 50)}...\n`;
  report += "=".repeat(60) + "\n\n";
  
  // Price & Order Book
  report += "📈 PRICE & ORDER BOOK:\n";
  report += `   Current: ${(analysis.orderBook.midPrice * 100).toFixed(1)}%\n`;
  report += `   Bid: ${(analysis.orderBook.bestBid * 100).toFixed(1)}% | Ask: ${(analysis.orderBook.bestAsk * 100).toFixed(1)}%\n`;
  report += `   Spread: ${analysis.orderBook.spreadPercent.toFixed(2)}%\n`;
  report += `   Imbalance: ${(analysis.orderBook.imbalance * 100).toFixed(0)}% (${analysis.orderBook.imbalance > 0 ? "buyers" : "sellers"})\n\n`;
  
  // Volume
  report += "💰 VOLUME (24h):\n";
  report += `   Total: $${analysis.volume.volume24h.toFixed(0)}\n`;
  report += `   Buy: $${analysis.volume.buyVolume.toFixed(0)} (${((analysis.volume.buyVolume / analysis.volume.volume24h) * 100).toFixed(0)}%)\n`;
  report += `   Sell: $${analysis.volume.sellVolume.toFixed(0)} (${((analysis.volume.sellVolume / analysis.volume.volume24h) * 100).toFixed(0)}%)\n`;
  report += `   Net Flow: ${analysis.volume.netFlow >= 0 ? "+" : ""}$${analysis.volume.netFlow.toFixed(0)}\n`;
  report += `   Trades: ${analysis.volume.tradeCount} | Whales: ${analysis.volume.whaleTrades}\n\n`;
  
  // Momentum
  report += "📊 MOMENTUM:\n";
  report += `   Trend: ${analysis.momentum.trend.toUpperCase()} (strength: ${(analysis.momentum.strength * 100).toFixed(0)}%)\n`;
  report += `   1h: ${analysis.momentum.change1h >= 0 ? "+" : ""}${(analysis.momentum.change1h * 100).toFixed(1)}%\n`;
  report += `   24h: ${analysis.momentum.change24h >= 0 ? "+" : ""}${(analysis.momentum.change24h * 100).toFixed(1)}%\n\n`;
  
  // Signal
  report += "🎯 SIGNAL:\n";
  report += `   Direction: ${analysis.signal.direction.toUpperCase()}\n`;
  report += `   Confidence: ${(analysis.signal.confidence * 100).toFixed(0)}%\n`;
  report += `   Reasons:\n`;
  for (const reason of analysis.signal.reasons) {
    report += `   • ${reason}\n`;
  }
  
  return report;
}

// ============================================================
// CLEAR CACHE
// ============================================================

export function clearAnalysisCache(): void {
  analysisCache.clear();
}
