/**
 * Crypto Price Prediction Module
 * 
 * Statistical prediction for crypto price markets:
 * - Historical volatility calculation
 * - Price target probability
 * - Time-based decay
 * 
 * Similar to Elon formula but for crypto markets
 * 
 * @author ElizaBAO
 */

// ============================================================
// TYPES
// ============================================================

export interface CryptoPrice {
  symbol: string;
  price: number;
  change24h: number;
  volume24h: number;
  high24h: number;
  low24h: number;
  timestamp: number;
}

export interface CryptoPrediction {
  symbol: string;
  currentPrice: number;
  targetPrice: number;
  probabilityAbove: number;  // Probability price will be above target
  probabilityBelow: number;  // Probability price will be below target
  timeHorizonHours: number;
  volatility: number;        // Daily volatility
  confidence: "low" | "medium" | "high";
}

export interface CryptoEdgeResult {
  edge: number;
  probability: number;
  marketPrice: number;
  recommendation: "strong_buy" | "buy" | "hold" | "sell" | "strong_sell";
  reason: string;
}

// ============================================================
// CONFIGURATION
// ============================================================

export const CRYPTO_CONFIG = {
  // Free API (CoinGecko public API - no key needed)
  apiUrl: "https://api.coingecko.com/api/v3",
  
  // Historical volatility (annualized, approximate)
  defaultVolatility: {
    bitcoin: 0.60,    // 60% annual volatility
    ethereum: 0.75,   // 75%
    solana: 1.00,     // 100%
    xrp: 0.80,        // 80%
    dogecoin: 1.20,   // 120%
    default: 0.80,    // 80% for unknown
  },
  
  // Edge thresholds
  minEdge: 0.05,      // 5%
  mediumEdge: 0.10,   // 10%
  highEdge: 0.20,     // 20%
};

// Cache for prices
const priceCache: Map<string, { data: CryptoPrice; expires: number }> = new Map();
const CACHE_TTL_MS = 60 * 1000; // 1 minute

// ============================================================
// PRICE FETCHING
// ============================================================

const SYMBOL_TO_ID: Record<string, string> = {
  btc: "bitcoin",
  bitcoin: "bitcoin",
  eth: "ethereum",
  ethereum: "ethereum",
  sol: "solana",
  solana: "solana",
  xrp: "ripple",
  ripple: "ripple",
  doge: "dogecoin",
  dogecoin: "dogecoin",
  bnb: "binancecoin",
  ada: "cardano",
  avax: "avalanche-2",
  matic: "matic-network",
  dot: "polkadot",
  link: "chainlink",
};

export async function getCryptoPrice(symbol: string): Promise<CryptoPrice | null> {
  const symbolLower = symbol.toLowerCase();
  const coinId = SYMBOL_TO_ID[symbolLower] || symbolLower;
  
  // Check cache
  const cached = priceCache.get(coinId);
  if (cached && cached.expires > Date.now()) {
    return cached.data;
  }
  
  try {
    const url = `${CRYPTO_CONFIG.apiUrl}/simple/price?ids=${coinId}&vs_currencies=usd&include_24hr_change=true&include_24hr_vol=true`;
    
    const response = await fetch(url, {
      headers: {
        "User-Agent": "ElizaBAO/2.0 Crypto Predictor",
      },
    });
    
    if (!response.ok) {
      console.log(`CoinGecko API error: ${response.status}`);
      return null;
    }
    
    const data = await response.json();
    const coinData = data[coinId];
    
    if (!coinData) {
      console.log(`Coin not found: ${coinId}`);
      return null;
    }
    
    const price: CryptoPrice = {
      symbol: symbolLower,
      price: coinData.usd || 0,
      change24h: coinData.usd_24h_change || 0,
      volume24h: coinData.usd_24h_vol || 0,
      high24h: coinData.usd * (1 + Math.abs(coinData.usd_24h_change || 0) / 100),
      low24h: coinData.usd * (1 - Math.abs(coinData.usd_24h_change || 0) / 100),
      timestamp: Date.now(),
    };
    
    // Cache the result
    priceCache.set(coinId, { data: price, expires: Date.now() + CACHE_TTL_MS });
    
    return price;
  } catch (err: any) {
    console.error(`Failed to fetch crypto price: ${err.message}`);
    return null;
  }
}

// ============================================================
// VOLATILITY CALCULATION
// ============================================================

function getAnnualVolatility(symbol: string): number {
  const symbolLower = symbol.toLowerCase();
  const coinId = SYMBOL_TO_ID[symbolLower] || symbolLower;
  
  return (CRYPTO_CONFIG.defaultVolatility as Record<string, number>)[coinId] 
    || CRYPTO_CONFIG.defaultVolatility.default;
}

function getDailyVolatility(annualVol: number): number {
  // Convert annual volatility to daily using sqrt(252 trading days)
  return annualVol / Math.sqrt(252);
}

function getHourlyVolatility(annualVol: number): number {
  // Convert annual volatility to hourly
  return annualVol / Math.sqrt(252 * 24);
}

// ============================================================
// PROBABILITY CALCULATION
// ============================================================

/**
 * Calculate probability of price reaching target using log-normal distribution
 * Based on Black-Scholes style probability calculation
 */
export function calculatePriceProbability(
  currentPrice: number,
  targetPrice: number,
  hoursToExpiry: number,
  annualVolatility: number
): { above: number; below: number } {
  if (hoursToExpiry <= 0 || currentPrice <= 0) {
    return { above: currentPrice >= targetPrice ? 1 : 0, below: currentPrice < targetPrice ? 1 : 0 };
  }
  
  // Convert hours to years
  const T = hoursToExpiry / (24 * 365);
  
  // Calculate d2 (simplified Black-Scholes without drift)
  const sigma = annualVolatility;
  const logRatio = Math.log(targetPrice / currentPrice);
  const d2 = -logRatio / (sigma * Math.sqrt(T));
  
  // Cumulative normal distribution approximation
  const above = normalCDF(d2);
  const below = 1 - above;
  
  return { above, below };
}

/**
 * Standard normal cumulative distribution function
 */
function normalCDF(x: number): number {
  const a1 = 0.254829592;
  const a2 = -0.284496736;
  const a3 = 1.421413741;
  const a4 = -1.453152027;
  const a5 = 1.061405429;
  const p = 0.3275911;
  
  const sign = x < 0 ? -1 : 1;
  x = Math.abs(x);
  
  const t = 1 / (1 + p * x);
  const y = 1 - (((((a5 * t + a4) * t) + a3) * t + a2) * t + a1) * t * Math.exp(-x * x / 2);
  
  return 0.5 * (1 + sign * y);
}

// ============================================================
// MARKET PARSING
// ============================================================

export interface ParsedCryptoMarket {
  symbol: string;
  targetPrice: number;
  direction: "above" | "below" | "between";
  lowerBound?: number;
  upperBound?: number;
  expiryDate?: Date;
}

export function parseCryptoMarket(question: string): ParsedCryptoMarket | null {
  const q = question.toLowerCase();
  
  // Find crypto symbol
  let symbol = "";
  for (const [sym, id] of Object.entries(SYMBOL_TO_ID)) {
    if (q.includes(sym)) {
      symbol = sym;
      break;
    }
  }
  
  if (!symbol) {
    // Check for "price of X"
    const priceMatch = q.match(/price of (\w+)/i);
    if (priceMatch) {
      symbol = priceMatch[1].toLowerCase();
    }
  }
  
  if (!symbol) return null;
  
  // Find target price
  const pricePatterns = [
    /\$?([\d,]+(?:\.\d+)?)/,
    /(\d+(?:,\d+)*(?:\.\d+)?)\s*(?:usd|dollars)/i,
    /(?:above|below|reach|hit)\s*\$?([\d,]+(?:\.\d+)?)/i,
  ];
  
  let targetPrice = 0;
  for (const pattern of pricePatterns) {
    const match = q.match(pattern);
    if (match) {
      targetPrice = parseFloat(match[1].replace(/,/g, ""));
      if (targetPrice > 0) break;
    }
  }
  
  if (targetPrice === 0) return null;
  
  // Determine direction
  let direction: "above" | "below" | "between" = "above";
  if (q.includes("below") || q.includes("under") || q.includes("less than")) {
    direction = "below";
  } else if (q.includes("between") || q.includes("range")) {
    direction = "between";
  }
  
  // Try to find expiry date
  let expiryDate: Date | undefined;
  const datePatterns = [
    /(?:by|before|on|end of)\s+(\w+\s+\d{1,2}(?:st|nd|rd|th)?(?:,?\s*\d{4})?)/i,
    /(\w+\s+\d{4})/i,
    /(\d{1,2}\/\d{1,2}\/\d{2,4})/,
  ];
  
  for (const pattern of datePatterns) {
    const match = q.match(pattern);
    if (match) {
      try {
        const parsed = new Date(match[1]);
        if (!isNaN(parsed.getTime()) && parsed > new Date()) {
          expiryDate = parsed;
          break;
        }
      } catch {}
    }
  }
  
  return {
    symbol,
    targetPrice,
    direction,
    expiryDate,
  };
}

// ============================================================
// PREDICTION ENGINE
// ============================================================

export async function predictCryptoMarket(
  question: string,
  hoursToExpiry: number = 24
): Promise<CryptoPrediction | null> {
  const parsed = parseCryptoMarket(question);
  if (!parsed) {
    console.log("Could not parse crypto market question");
    return null;
  }
  
  const price = await getCryptoPrice(parsed.symbol);
  if (!price) {
    console.log(`Could not fetch price for ${parsed.symbol}`);
    return null;
  }
  
  const annualVol = getAnnualVolatility(parsed.symbol);
  const { above, below } = calculatePriceProbability(
    price.price,
    parsed.targetPrice,
    hoursToExpiry,
    annualVol
  );
  
  // Determine confidence based on time horizon and volatility
  let confidence: "low" | "medium" | "high" = "medium";
  if (hoursToExpiry < 24 && annualVol < 0.8) {
    confidence = "high";
  } else if (hoursToExpiry > 168 || annualVol > 1.0) {
    confidence = "low";
  }
  
  return {
    symbol: parsed.symbol,
    currentPrice: price.price,
    targetPrice: parsed.targetPrice,
    probabilityAbove: above,
    probabilityBelow: below,
    timeHorizonHours: hoursToExpiry,
    volatility: annualVol,
    confidence,
  };
}

// ============================================================
// EDGE CALCULATION
// ============================================================

export async function calculateCryptoEdge(
  question: string,
  marketYesPrice: number,
  hoursToExpiry: number = 24
): Promise<CryptoEdgeResult | null> {
  const prediction = await predictCryptoMarket(question, hoursToExpiry);
  if (!prediction) return null;
  
  const parsed = parseCryptoMarket(question);
  if (!parsed) return null;
  
  // Determine which probability to use
  const ourProbability = parsed.direction === "above" 
    ? prediction.probabilityAbove 
    : prediction.probabilityBelow;
  
  const edge = ourProbability - marketYesPrice;
  
  // Determine recommendation
  let recommendation: CryptoEdgeResult["recommendation"] = "hold";
  
  if (edge >= CRYPTO_CONFIG.highEdge) {
    recommendation = "strong_buy";
  } else if (edge >= CRYPTO_CONFIG.mediumEdge) {
    recommendation = "buy";
  } else if (edge >= CRYPTO_CONFIG.minEdge) {
    recommendation = "buy";
  } else if (edge <= -CRYPTO_CONFIG.highEdge) {
    recommendation = "strong_sell";
  } else if (edge <= -CRYPTO_CONFIG.mediumEdge) {
    recommendation = "sell";
  }
  
  const priceDiff = parsed.direction === "above"
    ? parsed.targetPrice - prediction.currentPrice
    : prediction.currentPrice - parsed.targetPrice;
  const priceDiffPercent = (priceDiff / prediction.currentPrice) * 100;
  
  return {
    edge,
    probability: ourProbability,
    marketPrice: marketYesPrice,
    recommendation,
    reason: `${parsed.symbol.toUpperCase()} @ $${prediction.currentPrice.toLocaleString()} → $${parsed.targetPrice.toLocaleString()} (${priceDiffPercent >= 0 ? "+" : ""}${priceDiffPercent.toFixed(1)}%, Vol: ${(prediction.volatility * 100).toFixed(0)}%)`,
  };
}

// ============================================================
// AUTO-TRADE HELPER
// ============================================================

export async function shouldTradeCryptoMarket(
  question: string,
  marketYesPrice: number,
  hoursToExpiry: number = 24
): Promise<{ shouldBuy: boolean; side: "YES" | "NO"; edge: number; reason: string }> {
  const result = await calculateCryptoEdge(question, marketYesPrice, hoursToExpiry);
  
  if (!result) {
    return { shouldBuy: false, side: "YES", edge: 0, reason: "Could not analyze crypto market" };
  }
  
  const shouldBuy = result.recommendation === "strong_buy" || result.recommendation === "buy";
  const side = result.edge >= 0 ? "YES" : "NO";
  
  return {
    shouldBuy,
    side,
    edge: Math.abs(result.edge),
    reason: `${result.recommendation.toUpperCase()}: ${result.reason} (Edge: ${(result.edge * 100).toFixed(1)}%)`,
  };
}

// ============================================================
// EXPORTS
// ============================================================

export function clearPriceCache(): void {
  priceCache.clear();
}
