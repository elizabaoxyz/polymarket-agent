/**
 * Polymarket Agent API Server
 * 
 * This wraps the elizaOS polymarket-agent as an HTTP API
 * that can be called from your elizabao website.
 * 
 * Deploy to: Railway, Render, Fly.io, or any Node.js host
 */

import { Hono } from "hono";
import { cors } from "hono/cors";
import { serve } from "@hono/node-server";
import {
  AgentRuntime,
  ChannelType,
  createCharacter,
  stringToUuid,
  type Character,
  type UUID,
} from "@elizaos/core";
import { openaiPlugin } from "@elizaos/plugin-openai";
import polymarketPlugin from "@elizaos/plugin-polymarket";
import sqlPlugin from "@elizaos/plugin-sql";
import { ClobClient } from "@polymarket/clob-client";
import { Wallet } from "@ethersproject/wallet";
import dotenv from "dotenv";

dotenv.config();

// =============================================================================
// Configuration
// =============================================================================

const PORT = parseInt(process.env.PORT || "3001", 10);
const CLOB_API_URL = process.env.CLOB_API_URL || "https://clob.polymarket.com";
const GAMMA_API_URL = process.env.GAMMA_API_URL || "https://gamma-api.polymarket.com";
const POLYGON_CHAIN_ID = 137;

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
// elizaOS Runtime Setup
// =============================================================================

let runtime: AgentRuntime | null = null;
let isInitialized = false;

const DEFAULT_ROOM_ID = stringToUuid("polymarket-api-room");
const DEFAULT_WORLD_ID = stringToUuid("polymarket-api-world");
const DEFAULT_USER_ID = stringToUuid("polymarket-api-user");

function buildCharacter(): Character {
  return createCharacter({
    name: "Poly",
    username: "poly_trader",
    bio: [
      "An autonomous AI agent that analyzes Polymarket prediction markets.",
      "Uses advanced planning and memory to make strategic trading decisions.",
    ],
    adjectives: ["analytical", "strategic", "disciplined"],
    style: {
      all: [
        "Analyze markets objectively",
        "Consider risk/reward ratios",
        "Explain reasoning clearly",
      ],
      chat: ["Be concise", "Focus on actionable insights"],
    },
    settings: {
      chains: {
        evm: ["polygon"],
      },
    },
    secrets: {
      EVM_PRIVATE_KEY: process.env.EVM_PRIVATE_KEY || "",
      POLYMARKET_PRIVATE_KEY: process.env.EVM_PRIVATE_KEY || "",
      CLOB_API_URL: CLOB_API_URL,
      ...(process.env.CLOB_API_KEY && {
        CLOB_API_KEY: process.env.CLOB_API_KEY,
        CLOB_API_SECRET: process.env.CLOB_API_SECRET,
        CLOB_API_PASSPHRASE: process.env.CLOB_API_PASSPHRASE,
      }),
    },
  });
}

async function initializeRuntime(): Promise<AgentRuntime> {
  if (runtime && isInitialized) {
    return runtime;
  }

  console.log("🚀 Initializing elizaOS runtime...");

  const character = buildCharacter();

  runtime = new AgentRuntime({
    character,
    plugins: [sqlPlugin, openaiPlugin, polymarketPlugin],
    settings: {
      OPENAI_API_KEY: process.env.OPENAI_API_KEY,
      PGLITE_DATA_DIR: process.env.PGLITE_DATA_DIR || "memory://",
    },
    logLevel: "info",
    enableAutonomy: true,
    actionPlanning: true,
    checkShouldRespond: false,
  });

  await runtime.initialize();

  await runtime.ensureConnection({
    entityId: DEFAULT_USER_ID,
    roomId: DEFAULT_ROOM_ID,
    worldId: DEFAULT_WORLD_ID,
    userName: "API",
    source: "polymarket-api",
    channelId: "polymarket-api",
    serverId: "polymarket-api-server",
    type: ChannelType.DM,
  } as any);

  isInitialized = true;
  console.log("✅ elizaOS runtime initialized");
  console.log("🤖 Advanced Planning: enabled");
  console.log("🧠 Advanced Memory: enabled");
  console.log("🔄 Autonomy: enabled");

  return runtime;
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

  for (const market of markets) {
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

    const tokenId = tokenIds[0];
    const orderBook = await getOrderBook(tokenId);

    if (!orderBook.bestBid || !orderBook.bestAsk) continue;

    const spread = orderBook.bestAsk - orderBook.bestBid;
    const midpoint = (orderBook.bestBid + orderBook.bestAsk) / 2;
    const spreadPercent = (spread / midpoint) * 100;
    const volume24h = market.volume24hr || 0;

    if (spreadPercent < config.minSpread || spreadPercent > config.maxSpread) {
      continue;
    }

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

  opportunities.sort((a, b) => b.score - a.score);
  console.log(`📊 Found ${opportunities.length} opportunities`);

  return opportunities.slice(0, 10);
}

// =============================================================================
// AI Decision Making (using elizaOS)
// =============================================================================

async function getAIDecision(
  opportunities: MarketOpportunity[],
  config: AutonomousConfig
): Promise<TradeDecision> {
  const rt = await initializeRuntime();

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

  // Create a message for the agent
  const marketSummary = topOpportunities
    .map(
      (o, i) =>
        `${i + 1}. "${o.question}" - Price: ${(o.midpoint * 100).toFixed(1)}%, Spread: ${o.spreadPercent.toFixed(2)}%, Score: ${(o.score * 100).toFixed(0)}/100`
    )
    .join("\n");

  const userMessage = `
You are analyzing Polymarket trading opportunities.

Risk Level: ${config.riskLevel}
Max Order Size: $${config.maxOrderSize}

Top Markets:
${marketSummary}

Based on the risk level and market conditions:
1. Should we trade? (Consider spread, liquidity, uncertainty)
2. If yes, which market (1-5) and why?
3. BUY or SELL?
4. What price and confidence level (0-100)?

Respond with your trading decision and reasoning.
`;

  try {
    // Use elizaOS message service for AI decision
    const messageService = rt.messageService;
    if (!messageService) {
      throw new Error("Message service not available");
    }

    const response = await messageService.handleMessage({
      entityId: DEFAULT_USER_ID,
      roomId: DEFAULT_ROOM_ID,
      content: { text: userMessage },
      source: "polymarket-api",
    } as any);

    // Parse the response to extract decision
    const responseText = typeof response === "string" 
      ? response 
      : response?.text || response?.content?.text || "";

    // Simple parsing of response
    const shouldTrade = /should trade|recommend|buy|sell/i.test(responseText) && 
                        !/should not|don't|shouldn't|hold/i.test(responseText);
    
    const buyMatch = /buy/i.test(responseText);
    const sellMatch = /sell/i.test(responseText);
    const action = buyMatch ? "BUY" : sellMatch ? "SELL" : "HOLD";
    
    const confidenceMatch = responseText.match(/(\d{1,3})%?\s*(confidence|confident)/i);
    const confidence = confidenceMatch ? parseInt(confidenceMatch[1]) : 50;

    const marketIndexMatch = responseText.match(/market\s*#?(\d)|option\s*#?(\d)|(\d)\./i);
    const marketIndex = marketIndexMatch 
      ? parseInt(marketIndexMatch[1] || marketIndexMatch[2] || marketIndexMatch[3]) - 1 
      : 0;

    const selectedMarket = shouldTrade && marketIndex >= 0 && marketIndex < topOpportunities.length
      ? topOpportunities[marketIndex]
      : null;

    return {
      shouldTrade: shouldTrade && selectedMarket !== null,
      action,
      market: selectedMarket,
      price: selectedMarket?.midpoint || 0,
      size: Math.floor(config.maxOrderSize * (confidence / 100)),
      reasoning: responseText.slice(0, 500),
      confidence,
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

// CORS for elizabao.xyz
app.use(
  "*",
  cors({
    origin: ["https://elizabao.xyz", "http://localhost:5173", "http://localhost:3000"],
    allowMethods: ["GET", "POST", "OPTIONS"],
    allowHeaders: ["Content-Type", "Authorization"],
  })
);

// Health check
app.get("/", (c) => {
  return c.json({
    status: "ok",
    service: "polymarket-agent-api",
    elizaos: isInitialized,
    features: {
      advancedPlanning: true,
      advancedMemory: true,
      autonomy: true,
    },
  });
});

// Status endpoint
app.get("/api/status", async (c) => {
  return c.json({
    success: true,
    data: {
      initialized: isInitialized,
      openaiConfigured: !!process.env.OPENAI_API_KEY,
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
      maxSpread: body.maxSpread || 10,
      riskLevel: body.riskLevel || "moderate",
    };

    const opportunities = await scanAndScoreMarkets(config);

    return c.json({
      success: true,
      data: {
        timestamp: new Date().toISOString(),
        marketsScanned: 100,
        opportunities,
      },
    });
  } catch (error) {
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
      maxSpread: body.maxSpread || 10,
      riskLevel: body.riskLevel || "moderate",
    };

    const opportunities = await scanAndScoreMarkets(config);
    const decision = await getAIDecision(opportunities, config);

    return c.json({
      success: true,
      data: {
        timestamp: new Date().toISOString(),
        marketsScanned: 100,
        opportunitiesFound: opportunities.length,
        topOpportunities: opportunities.slice(0, 5),
        aiDecision: decision,
      },
    });
  } catch (error) {
    return c.json(
      { success: false, error: error instanceof Error ? error.message : "Unknown error" },
      500
    );
  }
});

// Execute trade (full autonomous cycle)
app.post("/api/execute", async (c) => {
  try {
    const body = await c.req.json().catch(() => ({}));
    const config: AutonomousConfig = {
      enabled: body.enabled ?? false,
      maxOrderSize: body.maxOrderSize || 10,
      maxDailyTrades: body.maxDailyTrades || 5,
      minSpread: body.minSpread || 0.5,
      maxSpread: body.maxSpread || 10,
      riskLevel: body.riskLevel || "moderate",
    };

    const opportunities = await scanAndScoreMarkets(config);
    const decision = await getAIDecision(opportunities, config);

    let executedTrade = null;

    if (decision.shouldTrade && config.enabled && decision.market) {
      // Use elizaOS polymarket plugin to execute trade
      const rt = await initializeRuntime();
      
      // Find the trade action in polymarket plugin
      const tradeAction = rt.actions?.find(
        (a) => a.name === "PLACE_ORDER" || a.name === "polymarket_trade"
      );

      if (tradeAction) {
        try {
          const result = await tradeAction.handler(rt, {
            tokenId: decision.market.tokenId,
            side: decision.action,
            price: decision.price,
            size: decision.size,
          } as any);
          
          executedTrade = {
            success: true,
            result,
          };
        } catch (tradeError) {
          executedTrade = {
            success: false,
            error: tradeError instanceof Error ? tradeError.message : "Trade failed",
          };
        }
      } else {
        executedTrade = {
          success: false,
          error: "Trade action not available",
        };
      }
    }

    return c.json({
      success: true,
      data: {
        timestamp: new Date().toISOString(),
        marketsScanned: 100,
        opportunitiesFound: opportunities.length,
        topOpportunities: opportunities.slice(0, 5),
        aiDecision: decision,
        executedTrade,
      },
    });
  } catch (error) {
    return c.json(
      { success: false, error: error instanceof Error ? error.message : "Unknown error" },
      500
    );
  }
});

// Chat with agent
app.post("/api/chat", async (c) => {
  try {
    const body = await c.req.json();
    const message = body.message;

    if (!message) {
      return c.json({ success: false, error: "Message required" }, 400);
    }

    const rt = await initializeRuntime();
    const messageService = rt.messageService;

    if (!messageService) {
      return c.json({ success: false, error: "Message service not available" }, 500);
    }

    const response = await messageService.handleMessage({
      entityId: DEFAULT_USER_ID,
      roomId: DEFAULT_ROOM_ID,
      content: { text: message },
      source: "polymarket-api",
    } as any);

    const responseText = typeof response === "string"
      ? response
      : response?.text || response?.content?.text || "No response";

    return c.json({
      success: true,
      data: {
        reply: responseText,
      },
    });
  } catch (error) {
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
║  Full elizaOS-powered trading agent as an HTTP API                 ║
╚════════════════════════════════════════════════════════════════════╝
`);

// Start server first (so healthcheck passes)
serve({
  fetch: app.fetch,
  port: PORT,
  hostname: "0.0.0.0", // Bind to all interfaces for Railway/Docker
});

console.log(`🌐 Server running at http://0.0.0.0:${PORT}`);

// Pre-initialize runtime in background (non-blocking)
initializeRuntime().catch((err) => {
  console.error("Failed to initialize elizaOS runtime:", err);
  // Don't crash - server still works for basic endpoints
});
console.log(`📡 API Endpoints:`);
console.log(`   GET  /           - Health check`);
console.log(`   GET  /api/status - Agent status`);
console.log(`   POST /api/scan   - Scan markets`);
console.log(`   POST /api/analyze - Scan + AI analysis`);
console.log(`   POST /api/execute - Full autonomous cycle`);
console.log(`   POST /api/chat   - Chat with agent`);
