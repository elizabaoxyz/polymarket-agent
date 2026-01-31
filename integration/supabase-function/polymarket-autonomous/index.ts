// Polymarket Autonomous Trading Agent - Supabase Edge Function
// Add this to your elizabao project: supabase/functions/polymarket-autonomous/index.ts

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const CLOB_API_URL = "https://clob.polymarket.com";
const GAMMA_API_URL = "https://gamma-api.polymarket.com";

// =============================================================================
// Types
// =============================================================================

interface MarketOpportunity {
  id: string;
  conditionId: string;
  question: string;
  tokenId: string;
  outcome: string;
  bestBid: number;
  bestAsk: number;
  spread: number;
  spreadPercent: number;
  midpoint: number;
  volume24h: number;
  score: number;
  reasoning?: string;
}

interface AutonomousConfig {
  enabled: boolean;
  maxOrderSize: number;      // Max USDC per trade
  maxDailyTrades: number;    // Max trades per day
  minSpread: number;         // Minimum spread % to consider
  maxSpread: number;         // Maximum spread % (avoid illiquid)
  riskLevel: "conservative" | "moderate" | "aggressive";
  allowedMarketTypes: string[]; // e.g., ["politics", "crypto", "sports"]
}

interface TradeDecision {
  shouldTrade: boolean;
  action: "BUY" | "SELL" | "HOLD";
  market: MarketOpportunity | null;
  price: number;
  size: number;
  reasoning: string;
  confidence: number; // 0-100
}

interface ScanResult {
  timestamp: string;
  marketsScanned: number;
  opportunitiesFound: number;
  topOpportunities: MarketOpportunity[];
  aiDecision: TradeDecision | null;
  executedTrade: any | null;
}

// =============================================================================
// Market Scanning & Scoring
// =============================================================================

async function fetchActiveMarkets(limit = 50): Promise<any[]> {
  const url = new URL(`${GAMMA_API_URL}/markets`);
  url.searchParams.set("limit", String(limit));
  url.searchParams.set("active", "true");
  url.searchParams.set("closed", "false");
  url.searchParams.set("order", "volume24hr");
  url.searchParams.set("ascending", "false");

  const response = await fetch(url.toString(), {
    headers: { "Accept": "application/json" },
  });

  if (!response.ok) {
    throw new Error(`Failed to fetch markets: ${response.status}`);
  }

  return await response.json();
}

async function getOrderBook(tokenId: string): Promise<{
  bestBid: number | null;
  bestAsk: number | null;
  bidDepth: number;
  askDepth: number;
}> {
  const url = new URL(`${CLOB_API_URL}/book`);
  url.searchParams.set("token_id", tokenId);

  const response = await fetch(url.toString(), {
    headers: { "Accept": "application/json" },
  });

  if (!response.ok) {
    return { bestBid: null, bestAsk: null, bidDepth: 0, askDepth: 0 };
  }

  const book = await response.json();
  const bids = book.bids || [];
  const asks = book.asks || [];

  return {
    bestBid: bids.length > 0 ? parseFloat(bids[0].price) : null,
    bestAsk: asks.length > 0 ? parseFloat(asks[0].price) : null,
    bidDepth: bids.length,
    askDepth: asks.length,
  };
}

function scoreOpportunity(
  spread: number,
  spreadPercent: number,
  midpoint: number,
  volume24h: number,
  bidDepth: number,
  askDepth: number
): number {
  // Scoring weights (matching polymarket-agent logic)
  const SPREAD_WEIGHT = 0.55;
  const MIDPOINT_WEIGHT = 0.30;
  const DEPTH_WEIGHT = 0.15;

  // Spread score: tighter is better (0.01-0.10 range)
  const spreadScore = Math.max(0, 1 - (spreadPercent / 10));

  // Midpoint score: closer to 0.5 means more uncertainty (tradeable)
  const midpointScore = 1 - Math.abs(midpoint - 0.5) * 2;

  // Depth score: more orders = better liquidity
  const minDepth = Math.min(bidDepth, askDepth);
  const depthScore = Math.min(1, minDepth / 10);

  // Volume bonus (high volume = more reliable)
  const volumeBonus = Math.min(0.1, volume24h / 1000000);

  return (
    spreadScore * SPREAD_WEIGHT +
    midpointScore * MIDPOINT_WEIGHT +
    depthScore * DEPTH_WEIGHT +
    volumeBonus
  );
}

async function scanAndScoreMarkets(config: AutonomousConfig): Promise<MarketOpportunity[]> {
  console.log("[scanAndScoreMarkets] Starting market scan...");
  
  const markets = await fetchActiveMarkets(100);
  const opportunities: MarketOpportunity[] = [];

  for (const market of markets) {
    // Parse token IDs from market
    let tokenIds: string[] = [];
    try {
      if (market.clobTokenIds) {
        tokenIds = JSON.parse(market.clobTokenIds);
      } else if (market.tokens) {
        tokenIds = market.tokens.map((t: any) => t.token_id);
      }
    } catch {
      continue;
    }

    if (tokenIds.length === 0) continue;

    // Get order book for YES token (first token)
    const tokenId = tokenIds[0];
    const orderBook = await getOrderBook(tokenId);

    if (!orderBook.bestBid || !orderBook.bestAsk) continue;

    const spread = orderBook.bestAsk - orderBook.bestBid;
    const midpoint = (orderBook.bestBid + orderBook.bestAsk) / 2;
    const spreadPercent = (spread / midpoint) * 100;
    const volume24h = market.volume24hr || 0;

    // Filter by config
    if (spreadPercent < config.minSpread || spreadPercent > config.maxSpread) {
      continue;
    }

    const score = scoreOpportunity(
      spread,
      spreadPercent,
      midpoint,
      volume24h,
      orderBook.bidDepth,
      orderBook.askDepth
    );

    opportunities.push({
      id: market.id,
      conditionId: market.conditionId || market.condition_id || market.id,
      question: market.question,
      tokenId,
      outcome: "YES",
      bestBid: orderBook.bestBid,
      bestAsk: orderBook.bestAsk,
      spread,
      spreadPercent,
      midpoint,
      volume24h,
      score,
    });
  }

  // Sort by score descending
  opportunities.sort((a, b) => b.score - a.score);

  console.log(`[scanAndScoreMarkets] Found ${opportunities.length} opportunities`);
  return opportunities.slice(0, 10); // Top 10
}

// =============================================================================
// AI Decision Making
// =============================================================================

async function getAIDecision(
  opportunities: MarketOpportunity[],
  config: AutonomousConfig
): Promise<TradeDecision> {
  const openaiKey = Deno.env.get("OPENAI_API_KEY");
  
  if (!openaiKey || opportunities.length === 0) {
    return {
      shouldTrade: false,
      action: "HOLD",
      market: null,
      price: 0,
      size: 0,
      reasoning: openaiKey ? "No suitable opportunities found" : "OpenAI API key not configured",
      confidence: 0,
    };
  }

  const topOpportunities = opportunities.slice(0, 5);
  
  const prompt = `You are an AI trading agent analyzing Polymarket prediction markets.

## Your Configuration
- Risk Level: ${config.riskLevel}
- Max Order Size: $${config.maxOrderSize}
- Strategy: Find opportunities with good risk/reward based on market inefficiencies

## Top Market Opportunities (sorted by score)
${topOpportunities.map((o, i) => `
${i + 1}. "${o.question}"
   - Current Price: YES @ ${(o.midpoint * 100).toFixed(1)}%
   - Spread: ${o.spreadPercent.toFixed(2)}% (Bid: ${o.bestBid.toFixed(3)}, Ask: ${o.bestAsk.toFixed(3)})
   - 24h Volume: $${o.volume24h.toLocaleString()}
   - Opportunity Score: ${(o.score * 100).toFixed(1)}/100
   - Token ID: ${o.tokenId.slice(0, 20)}...
`).join("\n")}

## Decision Guidelines
- CONSERVATIVE: Only trade if spread < 3% and confidence > 80%
- MODERATE: Trade if spread < 5% and score > 0.7
- AGGRESSIVE: Trade opportunities with score > 0.6

## Your Task
Analyze these markets and decide:
1. Should we trade? (YES/NO)
2. If YES, which market and why?
3. BUY or SELL? At what price?
4. Confidence level (0-100)?

Respond in JSON format:
{
  "shouldTrade": boolean,
  "action": "BUY" | "SELL" | "HOLD",
  "marketIndex": number (0-4, which market from the list),
  "price": number (limit price 0-1),
  "sizePercent": number (percentage of maxOrderSize to use, 10-100),
  "reasoning": "string explaining your decision",
  "confidence": number (0-100)
}`;

  try {
    const response = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${openaiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "gpt-4o-mini",
        messages: [
          { role: "system", content: "You are a quantitative trading analyst specializing in prediction markets. Always respond with valid JSON." },
          { role: "user", content: prompt },
        ],
        temperature: 0.3,
        max_tokens: 500,
      }),
    });

    if (!response.ok) {
      throw new Error(`OpenAI API error: ${response.status}`);
    }

    const data = await response.json();
    const content = data.choices?.[0]?.message?.content || "";
    
    // Parse JSON from response
    const jsonMatch = content.match(/\{[\s\S]*\}/);
    if (!jsonMatch) {
      throw new Error("No JSON found in AI response");
    }

    const decision = JSON.parse(jsonMatch[0]);
    
    const selectedMarket = decision.shouldTrade && decision.marketIndex >= 0
      ? topOpportunities[decision.marketIndex]
      : null;

    return {
      shouldTrade: decision.shouldTrade,
      action: decision.action || "HOLD",
      market: selectedMarket,
      price: decision.price || (selectedMarket?.midpoint || 0),
      size: Math.floor((decision.sizePercent || 50) / 100 * config.maxOrderSize),
      reasoning: decision.reasoning || "No reasoning provided",
      confidence: decision.confidence || 0,
    };
  } catch (error) {
    console.error("[getAIDecision] Error:", error);
    return {
      shouldTrade: false,
      action: "HOLD",
      market: null,
      price: 0,
      size: 0,
      reasoning: `AI analysis failed: ${error instanceof Error ? error.message : "Unknown error"}`,
      confidence: 0,
    };
  }
}

// =============================================================================
// Trade Execution (calls existing polymarket-actions function)
// =============================================================================

async function executeTrade(
  decision: TradeDecision,
  supabaseUrl: string,
  supabaseKey: string
): Promise<any> {
  if (!decision.shouldTrade || !decision.market) {
    return null;
  }

  try {
    // Call the existing polymarket-actions function
    const response = await fetch(`${supabaseUrl}/functions/v1/polymarket-actions`, {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${supabaseKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        action: decision.action.toLowerCase(),
        params: {
          tokenId: decision.market.tokenId,
          amount: decision.size,
          price: decision.price,
        },
      }),
    });

    const result = await response.json();
    return result;
  } catch (error) {
    console.error("[executeTrade] Error:", error);
    return {
      success: false,
      error: error instanceof Error ? error.message : "Unknown error",
    };
  }
}

// =============================================================================
// Main Handler
// =============================================================================

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const { action, config } = await req.json();
    console.log(`[polymarket-autonomous] Action: ${action}`);

    const defaultConfig: AutonomousConfig = {
      enabled: true,
      maxOrderSize: 10,
      maxDailyTrades: 5,
      minSpread: 0.5,
      maxSpread: 10,
      riskLevel: "moderate",
      allowedMarketTypes: [],
    };

    const mergedConfig = { ...defaultConfig, ...config };

    switch (action) {
      case "scan": {
        // Just scan and score markets (no trading)
        const opportunities = await scanAndScoreMarkets(mergedConfig);
        return new Response(
          JSON.stringify({
            success: true,
            data: {
              timestamp: new Date().toISOString(),
              marketsScanned: 100,
              opportunities,
            },
          }),
          { headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }

      case "analyze": {
        // Scan + AI analysis (no execution)
        const opportunities = await scanAndScoreMarkets(mergedConfig);
        const decision = await getAIDecision(opportunities, mergedConfig);
        
        return new Response(
          JSON.stringify({
            success: true,
            data: {
              timestamp: new Date().toISOString(),
              marketsScanned: 100,
              opportunitiesFound: opportunities.length,
              topOpportunities: opportunities.slice(0, 5),
              aiDecision: decision,
            },
          }),
          { headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }

      case "execute": {
        // Full autonomous cycle: scan + analyze + execute
        const opportunities = await scanAndScoreMarkets(mergedConfig);
        const decision = await getAIDecision(opportunities, mergedConfig);
        
        let executedTrade = null;
        if (decision.shouldTrade && mergedConfig.enabled) {
          const supabaseUrl = Deno.env.get("SUPABASE_URL") || "";
          const supabaseKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";
          executedTrade = await executeTrade(decision, supabaseUrl, supabaseKey);
        }

        const result: ScanResult = {
          timestamp: new Date().toISOString(),
          marketsScanned: 100,
          opportunitiesFound: opportunities.length,
          topOpportunities: opportunities.slice(0, 5),
          aiDecision: decision,
          executedTrade,
        };

        return new Response(
          JSON.stringify({ success: true, data: result }),
          { headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }

      case "status": {
        // Return agent status
        return new Response(
          JSON.stringify({
            success: true,
            data: {
              enabled: mergedConfig.enabled,
              config: mergedConfig,
              openaiConfigured: !!Deno.env.get("OPENAI_API_KEY"),
              walletConfigured: !!Deno.env.get("WALLET_PRIVATE_KEY"),
            },
          }),
          { headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }

      default:
        throw new Error(`Unknown action: ${action}`);
    }
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : "Unknown error";
    console.error("[polymarket-autonomous] Error:", errorMessage);
    return new Response(
      JSON.stringify({ success: false, error: errorMessage }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
