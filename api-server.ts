/**
 * Polymarket Agent API Server (Lightweight Version)
 * 
 * Uses OpenAI directly for AI decisions without full elizaOS runtime.
 * This is more reliable for cloud deployment.
 */

import { Hono } from "hono";
import { cors } from "hono/cors";
import { serve } from "@hono/node-server";

const PORT = parseInt(process.env.PORT || "3001", 10);
const CLOB_API_URL = process.env.CLOB_API_URL || "https://clob.polymarket.com";
const GAMMA_API_URL = process.env.GAMMA_API_URL || "https://gamma-api.polymarket.com";
const OPENAI_API_KEY = process.env.OPENAI_API_KEY;

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
}

interface TradeDecision {
  shouldTrade: boolean;
  action: "BUY" | "SELL" | "HOLD";
  market: MarketOpportunity | null;
  price: number;
  size: number;
  reasoning: string;
  confidence: number;
}

interface AutonomousConfig {
  enabled: boolean;
  maxOrderSize: number;
  maxDailyTrades: number;
  minSpread: number;
  maxSpread: number;
  riskLevel: "conservative" | "moderate" | "aggressive";
}

// =============================================================================
// Market Scanning
// =============================================================================

async function fetchActiveMarkets(limit = 100): Promise<any[]> {
  const url = new URL(`${GAMMA_API_URL}/markets`);
  url.searchParams.set("limit", String(limit));
  url.searchParams.set("active", "true");
  url.searchParams.set("closed", "false");
  url.searchParams.set("order", "volume24hr");
  url.searchParams.set("ascending", "false");

  const response = await fetch(url.toString(), {
    headers: { Accept: "application/json" },
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
  try {
    const url = new URL(`${CLOB_API_URL}/book`);
    url.searchParams.set("token_id", tokenId);

    const response = await fetch(url.toString(), {
      headers: { Accept: "application/json" },
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
  } catch {
    return { bestBid: null, bestAsk: null, bidDepth: 0, askDepth: 0 };
  }
}

function scoreOpportunity(
  spreadPercent: number,
  midpoint: number,
  bidDepth: number,
  askDepth: number,
  volume24h: number
): number {
  const SPREAD_WEIGHT = 0.55;
  const MIDPOINT_WEIGHT = 0.30;
  const DEPTH_WEIGHT = 0.15;

  const spreadScore = Math.max(0, 1 - spreadPercent / 10);
  const midpointScore = 1 - Math.abs(midpoint - 0.5) * 2;
  const minDepth = Math.min(bidDepth, askDepth);
  const depthScore = Math.min(1, minDepth / 10);
  const volumeBonus = Math.min(0.1, volume24h / 1000000);

  return (
    spreadScore * SPREAD_WEIGHT +
    midpointScore * MIDPOINT_WEIGHT +
    depthScore * DEPTH_WEIGHT +
    volumeBonus
  );
}

async function scanAndScoreMarkets(
  config: AutonomousConfig
): Promise<MarketOpportunity[]> {
  console.log("📊 Scanning markets...");

  const markets = await fetchActiveMarkets(100);
  const opportunities: MarketOpportunity[] = [];

  // Process more markets to find good ones
  for (const market of markets.slice(0, 50)) {
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

    // Check both YES and NO tokens for better opportunities
    for (let i = 0; i < Math.min(tokenIds.length, 2); i++) {
      const tokenId = tokenIds[i];
      const outcome = i === 0 ? "YES" : "NO";
      const orderBook = await getOrderBook(tokenId);

      if (!orderBook.bestBid || !orderBook.bestAsk) continue;
      
      // Skip if prices are too extreme (not tradeable)
      if (orderBook.bestBid < 0.05 || orderBook.bestAsk > 0.95) continue;

      const spread = orderBook.bestAsk - orderBook.bestBid;
      const midpoint = (orderBook.bestBid + orderBook.bestAsk) / 2;
      const spreadPercent = (spread / midpoint) * 100;
      const volume24h = market.volume24hr || 0;

      // More relaxed filtering - include all markets with reasonable spreads
      if (spreadPercent > 50) continue; // Skip very illiquid markets

      const score = scoreOpportunity(
        spreadPercent,
        midpoint,
        orderBook.bidDepth,
        orderBook.askDepth,
        volume24h
      );

      opportunities.push({
        id: market.id,
        conditionId: market.conditionId || market.condition_id || market.id,
        question: market.question,
        tokenId,
        outcome,
        bestBid: orderBook.bestBid,
        bestAsk: orderBook.bestAsk,
        spread,
        spreadPercent,
        midpoint,
        volume24h,
        score,
      });
    }
  }

  // Sort by score (best first)
  opportunities.sort((a, b) => b.score - a.score);
  console.log(`📊 Found ${opportunities.length} opportunities`);

  return opportunities.slice(0, 10);
}

// =============================================================================
// AI Decision Making (Direct OpenAI)
// =============================================================================

async function getAIDecision(
  opportunities: MarketOpportunity[],
  config: AutonomousConfig
): Promise<TradeDecision> {
  if (!OPENAI_API_KEY) {
    return {
      shouldTrade: false,
      action: "HOLD",
      market: null,
      price: 0,
      size: 0,
      reasoning: "OpenAI API key not configured",
      confidence: 0,
    };
  }

  if (opportunities.length === 0) {
    return {
      shouldTrade: false,
      action: "HOLD",
      market: null,
      price: 0,
      size: 0,
      reasoning: "No suitable opportunities found",
      confidence: 0,
    };
  }

  const topOpportunities = opportunities.slice(0, 5);

  const marketSummary = topOpportunities
    .map(
      (o, i) =>
        `${i + 1}. "${o.question}" - Bid: ${(o.bestBid * 100).toFixed(1)}%, Ask: ${(o.bestAsk * 100).toFixed(1)}%, Spread: ${o.spreadPercent.toFixed(2)}%, Volume: $${o.volume24h.toFixed(0)}, Score: ${(o.score * 100).toFixed(0)}/100`
    )
    .join("\n");

  const systemPrompt = `You are Poly, an AI trading agent for Polymarket prediction markets. 
You analyze markets and make strategic trading decisions.
You are ${config.riskLevel} in your approach.
Max order size: $${config.maxOrderSize}

Respond in JSON format:
{
  "shouldTrade": boolean,
  "action": "BUY" | "SELL" | "HOLD",
  "marketIndex": number (1-5, which market),
  "confidence": number (0-100),
  "reasoning": "string explaining your decision"
}`;

  const userPrompt = `Analyze these Polymarket opportunities and decide whether to trade:

${marketSummary}

Consider:
- Tighter spreads = better liquidity
- Prices near 50% = more uncertainty (trading opportunity)
- Higher volume = more reliable pricing
- ${config.riskLevel} risk tolerance

Should we trade? If yes, which market and why?`;

  try {
    const response = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${OPENAI_API_KEY}`,
      },
      body: JSON.stringify({
        model: "gpt-4o-mini",
        messages: [
          { role: "system", content: systemPrompt },
          { role: "user", content: userPrompt },
        ],
        temperature: 0.7,
        max_tokens: 500,
      }),
    });

    if (!response.ok) {
      throw new Error(`OpenAI API error: ${response.status}`);
    }

    const data = await response.json();
    const content = data.choices?.[0]?.message?.content || "";

    // Parse JSON response
    const jsonMatch = content.match(/\{[\s\S]*\}/);
    if (jsonMatch) {
      const parsed = JSON.parse(jsonMatch[0]);
      const marketIndex = (parsed.marketIndex || 1) - 1;
      const selectedMarket = parsed.shouldTrade && marketIndex >= 0 && marketIndex < topOpportunities.length
        ? topOpportunities[marketIndex]
        : null;

      return {
        shouldTrade: parsed.shouldTrade && selectedMarket !== null,
        action: parsed.action || "HOLD",
        market: selectedMarket,
        price: selectedMarket?.midpoint || 0,
        size: Math.floor(config.maxOrderSize * (parsed.confidence / 100)),
        reasoning: parsed.reasoning || content,
        confidence: parsed.confidence || 50,
      };
    }

    // Fallback parsing
    return {
      shouldTrade: false,
      action: "HOLD",
      market: null,
      price: 0,
      size: 0,
      reasoning: content.slice(0, 500),
      confidence: 0,
    };
  } catch (error) {
    console.error("AI decision error:", error);
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
// API Server
// =============================================================================

const app = new Hono();

// CORS
app.use(
  "*",
  cors({
    origin: "*",
    allowMethods: ["GET", "POST", "OPTIONS"],
    allowHeaders: ["Content-Type", "Authorization"],
  })
);

// Health check
app.get("/", (c) => {
  return c.json({
    status: "ok",
    service: "polymarket-agent-api",
    version: "2.0",
    openaiConfigured: !!OPENAI_API_KEY,
  });
});

// Status endpoint
app.get("/api/status", async (c) => {
  return c.json({
    success: true,
    data: {
      initialized: true,
      openaiConfigured: !!OPENAI_API_KEY,
      walletConfigured: !!process.env.EVM_PRIVATE_KEY,
      clobConfigured: !!process.env.CLOB_API_KEY,
    },
  });
});

// Scan markets
app.post("/api/scan", async (c) => {
  try {
    const body = await c.req.json().catch(() => ({}));
    const config: AutonomousConfig = {
      enabled: true,
      maxOrderSize: body.maxOrderSize || 10,
      maxDailyTrades: body.maxDailyTrades || 5,
      minSpread: body.minSpread || 0.5,
      maxSpread: body.maxSpread || 15,
      riskLevel: body.riskLevel || "moderate",
    };

    const opportunities = await scanAndScoreMarkets(config);

    return c.json({
      success: true,
      data: {
        timestamp: new Date().toISOString(),
        marketsScanned: 50,
        opportunities,
      },
    });
  } catch (error) {
    console.error("Scan error:", error);
    return c.json(
      { success: false, error: error instanceof Error ? error.message : "Unknown error" },
      500
    );
  }
});

// Analyze with AI
app.post("/api/analyze", async (c) => {
  try {
    const body = await c.req.json().catch(() => ({}));
    const config: AutonomousConfig = {
      enabled: true,
      maxOrderSize: body.maxOrderSize || 10,
      maxDailyTrades: body.maxDailyTrades || 5,
      minSpread: body.minSpread || 0.5,
      maxSpread: body.maxSpread || 15,
      riskLevel: body.riskLevel || "moderate",
    };

    const opportunities = await scanAndScoreMarkets(config);
    const decision = await getAIDecision(opportunities, config);

    return c.json({
      success: true,
      data: {
        timestamp: new Date().toISOString(),
        marketsScanned: 50,
        opportunitiesFound: opportunities.length,
        topOpportunities: opportunities.slice(0, 5),
        aiDecision: decision,
      },
    });
  } catch (error) {
    console.error("Analyze error:", error);
    return c.json(
      { success: false, error: error instanceof Error ? error.message : "Unknown error" },
      500
    );
  }
});

// Execute trade
app.post("/api/execute", async (c) => {
  try {
    const body = await c.req.json().catch(() => ({}));
    const config: AutonomousConfig = {
      enabled: body.enabled ?? false,
      maxOrderSize: body.maxOrderSize || 10,
      maxDailyTrades: body.maxDailyTrades || 5,
      minSpread: body.minSpread || 0.5,
      maxSpread: body.maxSpread || 15,
      riskLevel: body.riskLevel || "moderate",
    };

    const opportunities = await scanAndScoreMarkets(config);
    const decision = await getAIDecision(opportunities, config);

    // Note: Actual trade execution requires wallet integration
    // For now, return the decision without executing
    return c.json({
      success: true,
      data: {
        timestamp: new Date().toISOString(),
        marketsScanned: 50,
        opportunitiesFound: opportunities.length,
        topOpportunities: opportunities.slice(0, 5),
        aiDecision: decision,
        executedTrade: config.enabled ? { 
          success: false, 
          error: "Trade execution requires additional setup" 
        } : null,
      },
    });
  } catch (error) {
    console.error("Execute error:", error);
    return c.json(
      { success: false, error: error instanceof Error ? error.message : "Unknown error" },
      500
    );
  }
});

// Search markets by query
app.post("/api/search", async (c) => {
  try {
    const body = await c.req.json();
    const query = body.query || body.q || "";

    if (!query) {
      return c.json({ success: false, error: "Query required" }, 400);
    }

    // Search Polymarket Gamma API
    const url = new URL(`${GAMMA_API_URL}/markets`);
    url.searchParams.set("limit", "20");
    url.searchParams.set("active", "true");
    url.searchParams.set("closed", "false");

    const response = await fetch(url.toString(), {
      headers: { Accept: "application/json" },
    });

    if (!response.ok) {
      throw new Error(`Search failed: ${response.status}`);
    }

    const allMarkets = await response.json();
    
    // Filter by query (case insensitive)
    const queryLower = query.toLowerCase();
    const filtered = allMarkets.filter((m: any) => 
      m.question?.toLowerCase().includes(queryLower) ||
      m.description?.toLowerCase().includes(queryLower)
    );

    // Get order book data for top results
    const results = [];
    for (const market of filtered.slice(0, 10)) {
      let tokenIds: string[] = [];
      try {
        if (market.clobTokenIds) {
          tokenIds = JSON.parse(market.clobTokenIds);
        }
      } catch {}

      let orderBook = null;
      if (tokenIds.length > 0) {
        orderBook = await getOrderBook(tokenIds[0]);
      }

      // Parse outcome prices
      let yesPrice = null;
      let noPrice = null;
      try {
        const prices = JSON.parse(market.outcomePrices || "[]");
        yesPrice = parseFloat(prices[0]) || null;
        noPrice = parseFloat(prices[1]) || null;
      } catch {}

      results.push({
        id: market.id,
        question: market.question,
        yesPrice,
        noPrice,
        volume24h: market.volume24hr || 0,
        liquidity: market.liquidityNum || 0,
        endDate: market.endDate,
        bestBid: orderBook?.bestBid,
        bestAsk: orderBook?.bestAsk,
        spread: orderBook?.bestBid && orderBook?.bestAsk 
          ? ((orderBook.bestAsk - orderBook.bestBid) * 100).toFixed(1) + "%" 
          : null,
      });
    }

    return c.json({
      success: true,
      data: {
        query,
        resultsCount: results.length,
        markets: results,
      },
    });
  } catch (error) {
    console.error("Search error:", error);
    return c.json(
      { success: false, error: error instanceof Error ? error.message : "Unknown error" },
      500
    );
  }
});

// Chat endpoint
app.post("/api/chat", async (c) => {
  try {
    const body = await c.req.json();
    const message = body.message;

    if (!message) {
      return c.json({ success: false, error: "Message required" }, 400);
    }

    if (!OPENAI_API_KEY) {
      return c.json({ success: false, error: "OpenAI not configured" }, 500);
    }

    const response = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${OPENAI_API_KEY}`,
      },
      body: JSON.stringify({
        model: "gpt-4o-mini",
        messages: [
          { 
            role: "system", 
            content: "You are Poly, an AI trading agent for Polymarket prediction markets. You help users understand markets and make trading decisions. Be concise and helpful." 
          },
          { role: "user", content: message },
        ],
        temperature: 0.7,
        max_tokens: 500,
      }),
    });

    const data = await response.json();
    const reply = data.choices?.[0]?.message?.content || "No response";

    return c.json({
      success: true,
      data: { reply },
    });
  } catch (error) {
    console.error("Chat error:", error);
    return c.json(
      { success: false, error: error instanceof Error ? error.message : "Unknown error" },
      500
    );
  }
});

// =============================================================================
// Start Server
// =============================================================================

console.log(`
╔════════════════════════════════════════════════════════════════════╗
║              POLYMARKET AGENT API SERVER                           ║
╠════════════════════════════════════════════════════════════════════╣
║  AI-powered trading agent for Polymarket                          ║
╚════════════════════════════════════════════════════════════════════╝
`);

serve({
  fetch: app.fetch,
  port: PORT,
  hostname: "0.0.0.0",
});

console.log(`🌐 Server running at http://0.0.0.0:${PORT}`);
console.log(`📡 OpenAI: ${OPENAI_API_KEY ? "configured" : "NOT configured"}`);
console.log(`📡 API Endpoints:`);
console.log(`   GET  /            - Health check`);
console.log(`   GET  /api/status  - Agent status`);
console.log(`   POST /api/scan    - Scan markets`);
console.log(`   POST /api/analyze - Scan + AI analysis`);
console.log(`   POST /api/execute - Full autonomous cycle`);
console.log(`   POST /api/chat    - Chat with agent`);
