/**
 * Polymarket Whale Tracker
 * 
 * Track and follow smart money on Polymarket:
 * - Monitor large trades
 * - Track top trader wallets
 * - Copy trading signals
 * 
 * @author ElizaBAO
 */

// ============================================================
// TYPES
// ============================================================

export interface WhaleTrade {
  wallet: string;
  marketId: string;
  marketQuestion: string;
  side: "YES" | "NO";
  amount: number;
  price: number;
  timestamp: string;
  isKnownWhale: boolean;
  whaleName?: string;
}

export interface WhaleProfile {
  address: string;
  name: string;
  totalVolume: number;
  winRate: number;
  avgTradeSize: number;
  lastActive: string;
  topMarkets: string[];
}

export interface WhaleIntelligence {
  marketId: string;
  marketQuestion: string;
  whaleBuys: number;
  whaleSells: number;
  netFlow: number; // Positive = bullish, negative = bearish
  largestTrade: WhaleTrade | null;
  sentiment: "bullish" | "bearish" | "neutral";
  confidence: number;
  recentTrades: WhaleTrade[];
}

// ============================================================
// KNOWN WHALES (Public Polymarket traders)
// ============================================================

export const KNOWN_WHALES: WhaleProfile[] = [
  {
    address: "0x1234...abcd", // Placeholder - real addresses would go here
    name: "Whale1",
    totalVolume: 5000000,
    winRate: 0.68,
    avgTradeSize: 10000,
    lastActive: "",
    topMarkets: ["politics", "crypto"],
  },
  {
    address: "0x5678...efgh",
    name: "Whale2", 
    totalVolume: 3000000,
    winRate: 0.72,
    avgTradeSize: 5000,
    lastActive: "",
    topMarkets: ["crypto"],
  },
  // Note: In production, you'd populate this with real whale addresses
  // from Polymarket leaderboards
];

// Minimum trade size to be considered "whale activity" (in USDC)
const WHALE_THRESHOLD_USD = 1000;

// ============================================================
// CACHE
// ============================================================

const whaleCache: Map<string, { data: WhaleIntelligence; expires: number }> = new Map();
const CACHE_TTL_MS = 2 * 60 * 1000; // 2 minutes

// ============================================================
// POLYMARKET API ENDPOINTS
// ============================================================

const CLOB_API = "https://clob.polymarket.com";
const GAMMA_API = "https://gamma-api.polymarket.com";

// ============================================================
// FETCH RECENT TRADES FOR MARKET
// ============================================================

async function fetchMarketTrades(tokenId: string, limit: number = 50): Promise<WhaleTrade[]> {
  const trades: WhaleTrade[] = [];
  
  try {
    // Polymarket CLOB trades endpoint
    const url = `${CLOB_API}/trades?asset_id=${tokenId}&limit=${limit}`;
    
    const response = await fetch(url, {
      headers: {
        "User-Agent": "ElizaBAO/2.1 Whale Tracker",
      },
    });
    
    if (!response.ok) {
      console.log(`Trade fetch error: ${response.status}`);
      return trades;
    }
    
    const data = await response.json();
    
    for (const trade of data || []) {
      const amount = parseFloat(trade.size || "0") * parseFloat(trade.price || "0");
      
      // Only track larger trades
      if (amount >= WHALE_THRESHOLD_USD) {
        const walletAddress = trade.maker || trade.taker || "";
        const knownWhale = KNOWN_WHALES.find(w => 
          w.address.toLowerCase() === walletAddress.toLowerCase()
        );
        
        trades.push({
          wallet: walletAddress.slice(0, 10) + "...",
          marketId: trade.market || "",
          marketQuestion: "",
          side: trade.side === "BUY" ? "YES" : "NO",
          amount,
          price: parseFloat(trade.price || "0"),
          timestamp: trade.created_at || new Date().toISOString(),
          isKnownWhale: !!knownWhale,
          whaleName: knownWhale?.name,
        });
      }
    }
    
  } catch (err: any) {
    console.error(`Trade fetch error: ${err.message}`);
  }
  
  return trades;
}

// ============================================================
// FETCH ORDER BOOK DEPTH
// ============================================================

interface OrderBookDepth {
  bidVolume: number;
  askVolume: number;
  midPrice: number;
  spread: number;
  imbalance: number; // Positive = more bids, negative = more asks
}

async function fetchOrderBookDepth(tokenId: string): Promise<OrderBookDepth | null> {
  try {
    const url = `${CLOB_API}/book?token_id=${tokenId}`;
    
    const response = await fetch(url, {
      headers: {
        "User-Agent": "ElizaBAO/2.1 Whale Tracker",
      },
    });
    
    if (!response.ok) return null;
    
    const data = await response.json();
    
    let bidVolume = 0;
    let askVolume = 0;
    let bestBid = 0;
    let bestAsk = 1;
    
    for (const bid of data.bids || []) {
      bidVolume += parseFloat(bid.size || "0") * parseFloat(bid.price || "0");
      if (parseFloat(bid.price) > bestBid) bestBid = parseFloat(bid.price);
    }
    
    for (const ask of data.asks || []) {
      askVolume += parseFloat(ask.size || "0") * parseFloat(ask.price || "0");
      if (parseFloat(ask.price) < bestAsk) bestAsk = parseFloat(ask.price);
    }
    
    const total = bidVolume + askVolume;
    const imbalance = total > 0 ? (bidVolume - askVolume) / total : 0;
    
    return {
      bidVolume,
      askVolume,
      midPrice: (bestBid + bestAsk) / 2,
      spread: bestAsk - bestBid,
      imbalance,
    };
  } catch (err: any) {
    console.error(`Order book error: ${err.message}`);
    return null;
  }
}

// ============================================================
// FETCH TOP TRADERS FOR MARKET
// ============================================================

interface TopTrader {
  address: string;
  position: number;
  side: "YES" | "NO";
  avgPrice: number;
}

async function fetchTopTraders(conditionId: string): Promise<TopTrader[]> {
  const traders: TopTrader[] = [];
  
  try {
    // This endpoint may vary - using the positions endpoint
    const url = `${GAMMA_API}/markets/${conditionId}`;
    
    const response = await fetch(url);
    if (!response.ok) return traders;
    
    const data = await response.json();
    
    // Note: Actual top traders data would need the right endpoint
    // This is a placeholder structure
    
  } catch (err: any) {
    console.error(`Top traders error: ${err.message}`);
  }
  
  return traders;
}

// ============================================================
// MAIN WHALE INTELLIGENCE
// ============================================================

export async function getWhaleIntelligence(
  marketId: string,
  tokenId: string,
  marketQuestion: string
): Promise<WhaleIntelligence> {
  // Check cache
  const cacheKey = marketId;
  const cached = whaleCache.get(cacheKey);
  if (cached && cached.expires > Date.now()) {
    return cached.data;
  }

  console.log(`🐋 Tracking whale activity for: "${marketQuestion.slice(0, 40)}..."`);

  // Fetch data in parallel
  const [trades, orderBook] = await Promise.all([
    fetchMarketTrades(tokenId, 100),
    fetchOrderBookDepth(tokenId),
  ]);

  // Analyze trades
  let whaleBuys = 0;
  let whaleSells = 0;
  let totalBuyVolume = 0;
  let totalSellVolume = 0;
  let largestTrade: WhaleTrade | null = null;

  for (const trade of trades) {
    trade.marketQuestion = marketQuestion;
    
    if (trade.side === "YES") {
      whaleBuys++;
      totalBuyVolume += trade.amount;
    } else {
      whaleSells++;
      totalSellVolume += trade.amount;
    }
    
    if (!largestTrade || trade.amount > largestTrade.amount) {
      largestTrade = trade;
    }
  }

  // Calculate net flow
  const netFlow = totalBuyVolume - totalSellVolume;
  
  // Combine with order book imbalance
  const orderBookSignal = orderBook?.imbalance || 0;
  const tradeSignal = trades.length > 0 ? (whaleBuys - whaleSells) / trades.length : 0;
  
  // Combined sentiment (trade flow + order book)
  const combinedSignal = (tradeSignal * 0.7) + (orderBookSignal * 0.3);
  
  let sentiment: "bullish" | "bearish" | "neutral" = "neutral";
  if (combinedSignal > 0.2) sentiment = "bullish";
  else if (combinedSignal < -0.2) sentiment = "bearish";
  
  // Confidence based on volume and trade count
  const volumeScore = Math.min(1, (totalBuyVolume + totalSellVolume) / 50000);
  const countScore = Math.min(1, trades.length / 20);
  const confidence = (volumeScore + countScore) / 2;

  const intelligence: WhaleIntelligence = {
    marketId,
    marketQuestion,
    whaleBuys,
    whaleSells,
    netFlow,
    largestTrade,
    sentiment,
    confidence,
    recentTrades: trades.slice(0, 10),
  };

  // Cache result
  whaleCache.set(cacheKey, { data: intelligence, expires: Date.now() + CACHE_TTL_MS });

  console.log(`🐋 Found ${trades.length} whale trades | Buys: ${whaleBuys} | Sells: ${whaleSells} | Sentiment: ${sentiment}`);

  return intelligence;
}

// ============================================================
// WHALE TRADING SIGNAL
// ============================================================

export interface WhaleTradingSignal {
  direction: "buy" | "sell" | "hold";
  strength: number;
  confidence: number;
  reason: string;
  largestWhale?: string;
}

export async function getWhaleTradingSignal(
  marketId: string,
  tokenId: string,
  marketQuestion: string
): Promise<WhaleTradingSignal> {
  try {
    const intelligence = await getWhaleIntelligence(marketId, tokenId, marketQuestion);

    if (intelligence.recentTrades.length === 0) {
      return {
        direction: "hold",
        strength: 0,
        confidence: 0,
        reason: "No whale activity detected",
      };
    }

    // Determine direction
    let direction: "buy" | "sell" | "hold" = "hold";
    
    if (intelligence.sentiment === "bullish" && intelligence.confidence > 0.3) {
      direction = "buy";
    } else if (intelligence.sentiment === "bearish" && intelligence.confidence > 0.3) {
      direction = "sell";
    }

    const netFlowStr = intelligence.netFlow >= 0 
      ? `+$${intelligence.netFlow.toFixed(0)}` 
      : `-$${Math.abs(intelligence.netFlow).toFixed(0)}`;

    const largestWhale = intelligence.largestTrade?.isKnownWhale 
      ? intelligence.largestTrade.whaleName 
      : undefined;

    return {
      direction,
      strength: Math.abs(intelligence.netFlow) / 10000, // Normalize to 0-1
      confidence: intelligence.confidence,
      reason: `${intelligence.sentiment.toUpperCase()}: ${intelligence.whaleBuys} buys, ${intelligence.whaleSells} sells (${netFlowStr} flow)`,
      largestWhale,
    };
  } catch (err: any) {
    return {
      direction: "hold",
      strength: 0,
      confidence: 0,
      reason: `Error: ${err.message}`,
    };
  }
}

// ============================================================
// COPY TRADE RECOMMENDATION
// ============================================================

export interface CopyTradeRecommendation {
  shouldCopy: boolean;
  side: "YES" | "NO";
  suggestedSize: number; // Multiplier
  reason: string;
}

export function getCopyTradeRecommendation(
  intelligence: WhaleIntelligence,
  baseSize: number
): CopyTradeRecommendation {
  // Don't copy if not enough data
  if (intelligence.recentTrades.length < 3) {
    return {
      shouldCopy: false,
      side: "YES",
      suggestedSize: 1,
      reason: "Not enough whale activity to copy",
    };
  }

  // Check if whales are strongly directional
  const total = intelligence.whaleBuys + intelligence.whaleSells;
  const buyRatio = intelligence.whaleBuys / total;
  
  if (buyRatio > 0.7) {
    // Strong buy signal
    return {
      shouldCopy: true,
      side: "YES",
      suggestedSize: 1 + (intelligence.confidence * 0.5), // Up to 1.5x
      reason: `Whales strongly bullish (${(buyRatio * 100).toFixed(0)}% buying)`,
    };
  } else if (buyRatio < 0.3) {
    // Strong sell signal (buy NO)
    return {
      shouldCopy: true,
      side: "NO",
      suggestedSize: 1 + (intelligence.confidence * 0.5),
      reason: `Whales strongly bearish (${((1 - buyRatio) * 100).toFixed(0)}% selling)`,
    };
  }

  return {
    shouldCopy: false,
    side: "YES",
    suggestedSize: 1,
    reason: `Mixed whale signals (${(buyRatio * 100).toFixed(0)}% buying)`,
  };
}

// ============================================================
// CLEAR CACHE
// ============================================================

export function clearWhaleCache(): void {
  whaleCache.clear();
}
