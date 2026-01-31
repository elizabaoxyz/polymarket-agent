/**
 * ElizaBAO Autonomy Service v2.0
 * 
 * Full-featured autonomous trading with:
 * - Elon tweet prediction engine with edge calculation
 * - Claude AI for non-Elon market analysis
 * - XTracker live tweet counting
 * - TP limit orders with postOnly
 * - Position persistence
 * - Liquidity Mining (earn rewards)
 * - Holding Rewards (4% APY)
 * - Maker Rebates (15-min crypto)
 * 
 * @author ElizaBAO
 */

import "dotenv/config";

// HTTP Proxy configuration - MUST configure BEFORE any other imports!
import { configureHttpProxy, testProxyConnection, getProxyInfo } from "./proxy-config.js";
configureHttpProxy(); // Configure immediately at module load

// Plugin imports
import { PolymarketService, setPolymarketService } from "../packages/plugin-polymarket/src/index.js";
import type { PolymarketConfig, Position } from "../packages/plugin-polymarket/src/types.js";
import {
  predictElonTweets,
  calculateEdge,
  extractDateRange,
  parseBucketRange,
  ELON_EDGE_CONFIG,
  ELON_HISTORICAL_DATA,
} from "../packages/plugin-polymarket/src/elon-prediction.js";
import {
  getAllElonTrackings,
  getElonTweetCount,
  findMatchingTracking,
} from "../packages/plugin-polymarket/src/xtracker.js";
import {
  analyzeWithAI,
  type AnalysisContext,
} from "../packages/plugin-polymarket/src/claude-ai.js";

// Strategies
import {
  runLiquidityMiningStrategy,
  getLiquidityOrders,
  LIQUIDITY_CONFIG,
} from "../packages/plugin-polymarket/src/strategies/liquidity-mining.js";
import {
  runHoldingRewardsStrategy,
  getHoldingPositions,
  getEstimatedDailyRewards,
  HOLDING_CONFIG,
} from "../packages/plugin-polymarket/src/strategies/holding-rewards.js";
import {
  runMakerRebatesStrategy,
  getMakerOrders,
  MAKER_REBATES_CONFIG,
} from "../packages/plugin-polymarket/src/strategies/maker-rebates.js";

// NEW: Smart Trading Modules
import {
  loadTradeAnalytics,
  recordTradeEntry,
  recordTradeExit,
  getTradingInsights,
  getTradeRecommendation,
  detectMarketType,
} from "../packages/plugin-polymarket/src/trade-analytics.js";
import {
  getNewsSignal,
  getNewsForMarket,
} from "../packages/plugin-polymarket/src/news-feed.js";
import {
  getNewsIntelligence,
  getNewsTradingSignal,
  getNewsAPIStatus,
} from "../packages/plugin-polymarket/src/news-intelligence.js";
import {
  getSocialIntelligence,
  getSocialTradingSignal,
  INFLUENCERS,
} from "../packages/plugin-polymarket/src/social-tracker.js";
import {
  getWhaleIntelligence,
  getWhaleTradingSignal,
  getCopyTradeRecommendation,
} from "../packages/plugin-polymarket/src/whale-tracker.js";
import {
  getEventIntelligence,
  getEventTradingSignal,
  getEventsForMarket,
  formatEventCalendar,
} from "../packages/plugin-polymarket/src/event-calendar.js";
import {
  analyzeMarket,
  quickMarketCheck,
  formatAnalysisReport,
  type MarketAnalysis,
} from "../packages/plugin-polymarket/src/market-analyzer.js";
import {
  fetchForexFactoryCalendar,
  getTodayEvents,
  getUpcomingHighImpact,
  getForexTradingSignal,
  formatDailyCalendar,
  formatWeeklyOverview,
  getRelevantEvents,
  type EconomicEvent,
} from "../packages/plugin-polymarket/src/forex-factory.js";
import {
  predictCryptoMarket,
  calculateCryptoEdge,
  shouldTradeCryptoMarket,
  parseCryptoMarket,
  CRYPTO_CONFIG,
} from "../packages/plugin-polymarket/src/crypto-prediction.js";
import {
  getDynamicTPSL,
  TPSL_CONFIG,
} from "../packages/plugin-polymarket/src/dynamic-tpsl.js";

// ============================================================
// CONFIGURATION
// ============================================================
const AUTONOMY_INTERVAL_MS = parseInt(process.env.AUTONOMY_INTERVAL_MS || "120000");
const MAX_POSITIONS = parseInt(process.env.MAX_POSITIONS || "20");
const MAX_ELON_POSITIONS = parseInt(process.env.MAX_ELON_POSITIONS || "3");
const TAKE_PROFIT_PERCENT = parseInt(process.env.TAKE_PROFIT_PERCENT || "20");
const STOP_LOSS_PERCENT = parseInt(process.env.STOP_LOSS_PERCENT || "15");
const ELON_TRADE_SIZE = parseFloat(process.env.ELON_TRADE_SIZE || "20");
const REGULAR_TRADE_SIZE = parseFloat(process.env.REGULAR_TRADE_SIZE || "2");
const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY || "";

// ============================================================
// STATE
// ============================================================
let autonomyEnabled = false;
let autonomyRunning = false;
let totalScans = 0;
let totalTrades = 0;
let service: PolymarketService | null = null;

// ============================================================
// INITIALIZATION
// ============================================================

export async function initializeService(): Promise<PolymarketService> {
  console.log("🔧 Initializing Polymarket Service (ElizaOS v2.0.0)...");

  // Load trade analytics for learning
  loadTradeAnalytics();

  const config: PolymarketConfig = {
    privateKey: process.env.EVM_PRIVATE_KEY || "",
    walletAddress: process.env.WALLET_ADDRESS || "",
    clobApiKey: process.env.CLOB_API_KEY,
    clobApiSecret: process.env.CLOB_API_SECRET,
    clobApiPassphrase: process.env.CLOB_API_PASSPHRASE,
    proxyWallet: process.env.PROXY_WALLET,
  };

  service = new PolymarketService(config);
  await service.initialize();
  setPolymarketService(service);

  console.log("✅ Polymarket Service initialized");
  console.log(`🤖 Agent: ElizaBAO`);
  console.log(`📦 Plugin: @elizabao/plugin-polymarket`);
  console.log(`📈 Smart: Trade Analytics, News Feed, Crypto Prediction, Dynamic TP/SL`);

  return service;
}

// ============================================================
// ELON AUTO-TRADE (with edge calculation)
// ============================================================

async function autoTradeElonMarket(): Promise<boolean> {
  if (!service) return false;

  const openElonPos = service.getOpenElonPositions();
  if (openElonPos >= MAX_ELON_POSITIONS) {
    console.log(`🐦 Max Elon positions reached (${openElonPos}/${MAX_ELON_POSITIONS})`);
    return false;
  }

  try {
    // Search for Elon tweet markets
    const markets = await service.searchMarkets("elon tweets", 30);
    const tweetMarkets = markets.filter(m => 
      m.question?.toLowerCase().includes("tweet") &&
      m.question?.toLowerCase().includes("elon")
    );

    console.log(`🐦 Found ${tweetMarkets.length} Elon tweet markets`);

    // Group by event
    const eventGroups: { [key: string]: any[] } = {};
    for (const m of tweetMarkets) {
      const eventSlug = m.eventSlug || "unknown";
      if (!eventGroups[eventSlug]) eventGroups[eventSlug] = [];
      eventGroups[eventSlug].push(m);
    }

    for (const [eventSlug, eventMarkets] of Object.entries(eventGroups)) {
      const firstMarket = eventMarkets[0];
      const marketDates = extractDateRange(firstMarket.question || "");
      if (!marketDates) continue;

      console.log(`\n🐦 === ${firstMarket.eventTitle || eventSlug} ===`);

      // Build dates
      const months: { [key: string]: number } = {
        january: 0, february: 1, march: 2, april: 3, may: 4, june: 5,
        july: 6, august: 7, september: 8, october: 9, november: 10, december: 11,
      };

      const year = 2026;
      const startDate = new Date(year, months[marketDates.startMonth], marketDates.startDay, 12, 0, 0);
      const endDate = new Date(year, months[marketDates.endMonth], marketDates.endDay, 12, 0, 0);
      if (endDate < startDate) endDate.setFullYear(year + 1);

      console.log(`🐦 Market dates: ${startDate.toDateString()} → ${endDate.toDateString()}`);

      const now = Date.now();
      const elapsedHours = Math.max(0, (now - startDate.getTime()) / (1000 * 60 * 60));
      const totalHours = (endDate.getTime() - startDate.getTime()) / (1000 * 60 * 60);

      // Get current tweet count
      let currentCount = 0;
      if (now > startDate.getTime()) {
        const tracking = await findMatchingTracking(startDate, endDate);
        if (tracking) {
          currentCount = tracking.count;
          console.log(`🐦 XTracker count: ${currentCount} tweets`);
        }
      }

      // Get prediction
      const prediction = predictElonTweets(currentCount, elapsedHours, totalHours);
      console.log(`🐦 Prediction: ${prediction.predicted} tweets`);

      // Calculate stdDev for edge calculation
      const rates = ELON_HISTORICAL_DATA.historicalPeriods.map(p => p.rate);
      const avgRate = rates.reduce((a, b) => a + b, 0) / rates.length;
      const variance = rates.reduce((sum, r) => sum + Math.pow(r - avgRate, 2), 0) / rates.length;
      const stdDev = Math.sqrt(variance) * totalHours;

      // Find best bucket to trade
      for (const market of eventMarkets) {
        if (service.hasTraded(market.id)) continue;

        const bucket = parseBucketRange(market.question || "");
        if (!bucket) continue;

        // Check if prediction matches bucket
        const isMatch = prediction.predicted >= bucket.lower && prediction.predicted <= bucket.upper;
        const isNearby = Math.abs(prediction.predicted - bucket.lower) <= 20 || 
                         Math.abs(prediction.predicted - bucket.upper) <= 20;

        if (!isMatch && !isNearby) continue;

        // Get market price
        let yesPrice = 0.5;
        try {
          yesPrice = parseFloat(market.outcomePrices[0]) || 0.5;
        } catch {}

        // Calculate edge
        const edgeResult = calculateEdge(bucket.lower, bucket.upper, prediction.predicted, stdDev, yesPrice);

        console.log(`🐦 Bucket ${bucket.lower}-${bucket.upper}:`);
        console.log(`   Market: ${(yesPrice * 100).toFixed(1)}% | Ours: ${(edgeResult.probability * 100).toFixed(1)}%`);
        console.log(`   Edge: ${(edgeResult.edge * 100).toFixed(1)}% [${edgeResult.level}]`);

        // Check edge threshold
        if (ELON_EDGE_CONFIG.enabled && edgeResult.edge < ELON_EDGE_CONFIG.minEdge) {
          console.log(`🐦 ⚠️ SKIP: Edge ${(edgeResult.edge * 100).toFixed(1)}% < ${(ELON_EDGE_CONFIG.minEdge * 100).toFixed(0)}% min`);
          continue;
        }

        // Get token ID
        let tokenId = "";
        try {
          const ids = typeof market.clobTokenIds === "string" 
            ? JSON.parse(market.clobTokenIds) 
            : market.clobTokenIds;
          tokenId = Array.isArray(ids) ? ids[0] : ids;
        } catch {}

        if (!tokenId) continue;

        // Calculate trade size and TP price
        const size = ELON_TRADE_SIZE / yesPrice;
        const tpPrice = Math.min(0.99, Math.round((yesPrice * (1 + TAKE_PROFIT_PERCENT / 100)) * 100) / 100);

        console.log(`🐦 🎯 BUYING bucket ${bucket.lower}-${bucket.upper} for $${ELON_TRADE_SIZE}! [${edgeResult.level} EDGE]`);

        // Execute buy with TP order
        const result = await service.placeBuyOrder(tokenId, yesPrice + 0.02, size, {
          placeTPOrder: true,
          tpPrice,
        });

        if (result.success) {
          totalTrades++;
          
          // Add position
          service.addPosition({
            id: `pos_${Date.now()}`,
            marketId: market.id,
            question: market.question || "",
            slug: market.slug || "",
            side: "BUY",
            entryPrice: yesPrice,
            size,
            amount: ELON_TRADE_SIZE,
            tokenId,
            openedAt: new Date().toISOString(),
            status: "open",
            category: "elon",
            tpOrderId: result.tpOrderId,
            tpPrice,
          });

          console.log(`🐦 ✅ BOUGHT! Edge: ${(edgeResult.edge * 100).toFixed(1)}% [${edgeResult.level}]`);
          return true;
        }
      }
    }

    console.log(`🐦 No matching bucket with sufficient edge`);
    return false;
  } catch (e: any) {
    console.error("🐦 Elon auto-trade error:", e.message);
    return false;
  }
}

// ============================================================
// CRYPTO AUTO-TRADE (statistical prediction)
// ============================================================

async function autoTradeCryptoMarket(): Promise<boolean> {
  if (!service) return false;

  try {
    // Search for crypto price markets
    const cryptoSearches = ["bitcoin price", "ethereum price", "crypto"];
    let cryptoMarkets: any[] = [];
    
    for (const query of cryptoSearches) {
      const markets = await service.searchMarkets(query, 20);
      cryptoMarkets.push(...markets.filter(m => {
        const q = (m.question || "").toLowerCase();
        return (q.includes("price") || q.includes("$")) && 
               (q.includes("bitcoin") || q.includes("btc") || 
                q.includes("ethereum") || q.includes("eth") ||
                q.includes("solana") || q.includes("sol"));
      }));
    }

    // Remove duplicates
    cryptoMarkets = cryptoMarkets.filter((m, i, arr) => 
      arr.findIndex(x => x.id === m.id) === i
    );

    console.log(`💎 Found ${cryptoMarkets.length} crypto price markets`);

    if (cryptoMarkets.length === 0) {
      console.log(`💎 No crypto markets found`);
      return false;
    }

    for (const market of cryptoMarkets) {
      if (service.hasTraded(market.id)) continue;

      const question = market.question || "";
      const parsed = parseCryptoMarket(question);
      if (!parsed) continue;

      // Get YES price
      let yesPrice = 0.5;
      try {
        yesPrice = parseFloat(market.outcomePrices[0]) || 0.5;
      } catch {}

      // Skip if price too extreme
      if (yesPrice < 0.1 || yesPrice > 0.9) continue;

      // Calculate hours to expiry (default 48h if unknown)
      let hoursToExpiry = 48;
      if (market.endDate) {
        hoursToExpiry = Math.max(1, (new Date(market.endDate).getTime() - Date.now()) / (1000 * 60 * 60));
      }

      // Get crypto edge
      const tradeSignal = await shouldTradeCryptoMarket(question, yesPrice, hoursToExpiry);

      console.log(`💎 ${parsed.symbol.toUpperCase()} → $${parsed.targetPrice.toLocaleString()}:`);
      console.log(`   Market: ${(yesPrice * 100).toFixed(1)}% | Edge: ${(tradeSignal.edge * 100).toFixed(1)}%`);
      console.log(`   Signal: ${tradeSignal.shouldBuy ? "BUY" : "SKIP"} | ${tradeSignal.reason.slice(0, 60)}`);

      if (!tradeSignal.shouldBuy || tradeSignal.edge < CRYPTO_CONFIG.minEdge) {
        continue;
      }

      // NEW: Full market analysis (order book, volume, trades)
      let tokenId = "";
      try {
        const ids = typeof market.clobTokenIds === "string" 
          ? JSON.parse(market.clobTokenIds) 
          : market.clobTokenIds;
        tokenId = Array.isArray(ids) ? ids[0] : ids;
      } catch {}

      if (tokenId) {
        const marketAnalysis = await analyzeMarket(market.id, tokenId, question);
        console.log(`📊 Order Book: Bid $${marketAnalysis.orderBook.totalBidVolume.toFixed(0)} | Ask $${marketAnalysis.orderBook.totalAskVolume.toFixed(0)} | Imbalance: ${(marketAnalysis.orderBook.imbalance * 100).toFixed(0)}%`);
        console.log(`📊 Volume 24h: $${marketAnalysis.volume.volume24h.toFixed(0)} | Buy: ${((marketAnalysis.volume.buyVolume / marketAnalysis.volume.volume24h) * 100).toFixed(0)}% | Whales: ${marketAnalysis.volume.whaleTrades}`);
        
        // Check market analysis signal
        if (marketAnalysis.signal.direction === "sell" && marketAnalysis.signal.confidence > 0.4) {
          console.log(`💎 ⚠️ SKIP: Market analysis bearish (${marketAnalysis.signal.reasons.join(", ")})`);
          continue;
        }

        // Boost size if market analysis agrees
        if (marketAnalysis.signal.direction === "buy" && marketAnalysis.signal.confidence > 0.5) {
          recommendation.suggestedSize *= 1.15;
          console.log(`💎 Boosting size: Market analysis bullish`);
        }
      }

      // Forex Factory: Check for high-impact economic events
      const forexSignal = getForexTradingSignal(question);
      if (forexSignal.hasHighImpact && forexSignal.riskLevel === "high") {
        console.log(`💎 ⚠️ SKIP: High-impact economic event (${forexSignal.recommendation})`);
        continue;
      }
      if (forexSignal.nextHighImpact) {
        console.log(`📅 Next event: ${forexSignal.nextHighImpact.currency} ${forexSignal.nextHighImpact.event}`);
      }

      // Get recommendation from trade analytics (learning)
      const recommendation = getTradeRecommendation(
        question,
        yesPrice,
        tradeSignal.edge,
        REGULAR_TRADE_SIZE * 2
      );

      console.log(`📊 Learning: ${recommendation.confidence} confidence - ${recommendation.reason}`);

      if (!recommendation.shouldTrade) {
        console.log(`💎 ⚠️ SKIP: Learning says no (${recommendation.reason})`);
        continue;
      }

      // NEW: Get whale trading signal (tokenId already set above)
      if (tokenId) {
        const whaleSignal = await getWhaleTradingSignal(market.id, tokenId, question);
        console.log(`🐋 Whales: ${whaleSignal.direction} (${(whaleSignal.confidence * 100).toFixed(0)}% confidence)`);
        if (whaleSignal.reason) console.log(`   ${whaleSignal.reason}`);

        // Boost or reduce size based on whale activity
        if (whaleSignal.direction === "buy" && whaleSignal.confidence > 0.5) {
          recommendation.suggestedSize *= 1.2; // Boost 20% if whales agree
          console.log(`💎 Boosting size: Whales are bullish`);
        } else if (whaleSignal.direction === "sell" && whaleSignal.confidence > 0.5) {
          console.log(`💎 ⚠️ SKIP: Whales are bearish`);
          continue;
        }
      }

      // Update tokenId for correct side (YES or NO)
      try {
        const ids = typeof market.clobTokenIds === "string" 
          ? JSON.parse(market.clobTokenIds) 
          : market.clobTokenIds;
        tokenId = Array.isArray(ids) ? (tradeSignal.side === "YES" ? ids[0] : ids[1]) : ids;
      } catch {}

      if (!tokenId) continue;

      // Calculate dynamic TP/SL
      const dynamicTPSL = getDynamicTPSL(yesPrice, question, tradeSignal.edge, hoursToExpiry);
      const tradeSize = (REGULAR_TRADE_SIZE * 2) * recommendation.suggestedSize;
      const size = tradeSize / yesPrice;

      console.log(`💎 🎯 BUYING ${parsed.symbol.toUpperCase()} ${tradeSignal.side} for $${tradeSize.toFixed(2)}!`);
      console.log(`   ${dynamicTPSL.reason}`);

      // Execute buy with dynamic TP
      const result = await service.placeBuyOrder(tokenId, yesPrice + 0.02, size, {
        placeTPOrder: true,
        tpPrice: dynamicTPSL.takeProfitPrice,
      });

      if (result.success) {
        totalTrades++;
        
        const posId = `pos_${Date.now()}`;
        
        // Record trade for learning
        recordTradeEntry(
          posId,
          market.id,
          question,
          yesPrice,
          tradeSignal.side,
          size,
          tradeSignal.edge
        );
        
        service.addPosition({
          id: posId,
          marketId: market.id,
          question: question,
          slug: market.slug || "",
          side: "BUY",
          entryPrice: yesPrice,
          size,
          amount: tradeSize,
          tokenId,
          openedAt: new Date().toISOString(),
          status: "open",
          category: "crypto",
          tpOrderId: result.tpOrderId,
          tpPrice: dynamicTPSL.takeProfitPrice,
        });

        console.log(`💎 ✅ BOUGHT! Edge: ${(tradeSignal.edge * 100).toFixed(1)}% | TP: ${(dynamicTPSL.takeProfitPercent * 100).toFixed(0)}%`);
        return true;
      }
    }

    console.log(`💎 No crypto opportunity with sufficient edge`);
    return false;
  } catch (e: any) {
    console.error("💎 Crypto auto-trade error:", e.message);
    return false;
  }
}

// ============================================================
// CLAUDE AI TRADING (for non-Elon markets)
// ============================================================

async function aiTradeNonElon(): Promise<boolean> {
  if (!service || !ANTHROPIC_API_KEY) return false;

  try {
    const opportunities = await service.scanOpportunities(50, 0.6);
    const nonElonOpps = opportunities.filter(o => o.category !== "elon");

    if (nonElonOpps.length === 0) {
      console.log("🤖 No non-Elon opportunities found");
      return false;
    }

    // Get Elon prediction for context
    let elonPrediction = undefined;
    try {
      const elonData = await getElonTweetCount();
      if (elonData) {
        const elapsedHours = (Date.now() - elonData.startDate.getTime()) / (1000 * 60 * 60);
        const totalHours = (elonData.endDate.getTime() - elonData.startDate.getTime()) / (1000 * 60 * 60);
        const pred = predictElonTweets(elonData.count, elapsedHours, totalHours);
        elonPrediction = {
          predicted: pred.predicted,
          currentCount: elonData.count,
          confidence: pred.confidence * 100,
        };
      }
    } catch {}

    // Prepare context for Claude
    const context: AnalysisContext = {
      opportunities: nonElonOpps.slice(0, 10).map(o => ({
        id: o.market.id,
        question: o.market.question,
        yesPrice: o.midpoint,
        volume24h: o.market.volume24hr,
        score: o.score,
        category: o.category,
      })),
      elonPrediction,
      openPositions: service.getOpenPositions().length,
      maxPositions: MAX_POSITIONS,
      openElonPositions: service.getOpenElonPositions(),
      maxElonPositions: MAX_ELON_POSITIONS,
      totalScans,
      totalTrades,
      totalPnl: service.getTotalPnl(),
      tradedMarkets: service.getTradedMarkets().slice(-10),
    };

    console.log("🤖 Asking Claude for analysis...");
    const decision = await analyzeWithAI(context, ANTHROPIC_API_KEY);

    console.log(`🤖 Decision: ${decision.action} | Confidence: ${decision.confidence}%`);
    console.log(`   Reasoning: ${decision.reasoning}`);

    if (decision.shouldTrade && decision.confidence >= 70 && decision.market) {
      const opp = nonElonOpps.find(o => o.market.id === decision.market.id);
      if (!opp) return false;

      // NEW: Get enhanced news intelligence (multi-source)
      const newsSignal = await getNewsTradingSignal(opp.market.question || "");
      console.log(`📰 News: ${newsSignal.direction} (${(newsSignal.strength * 100).toFixed(0)}% strength, ${(newsSignal.confidence * 100).toFixed(0)}% confidence)`);
      console.log(`   Sources: ${newsSignal.sources.join(", ") || "none"} - ${newsSignal.reason.slice(0, 60)}`);

      // NEW: Get social media sentiment
      const socialSignal = await getSocialTradingSignal(opp.market.question || "");
      console.log(`🐦 Social: ${socialSignal.direction} (${(socialSignal.strength * 100).toFixed(0)}%) ${socialSignal.influencerAlert ? "⚠️ INFLUENCER ALERT" : ""}`);
      if (socialSignal.reason) console.log(`   ${socialSignal.reason.slice(0, 70)}`);

      // NEW: Check event calendar
      const eventSignal = getEventTradingSignal(opp.market.question || "");
      if (eventSignal.hasRelevantEvent) {
        console.log(`📅 Event: ${eventSignal.eventName} in ${eventSignal.daysUntilEvent}d [${eventSignal.riskLevel} risk]`);
        console.log(`   ${eventSignal.recommendation.slice(0, 60)}`);
      }

      // Check if signals contradict AI decision
      const bearishSignals = [
        newsSignal.direction === "sell" && newsSignal.confidence > 0.4,
        socialSignal.direction === "sell" && socialSignal.confidence > 0.4,
      ].filter(Boolean).length;

      if (bearishSignals >= 2) {
        console.log(`🤖 ⚠️ SKIP: Multiple bearish signals (news + social), overriding AI decision`);
        return false;
      }

      // Be cautious near major events
      if (eventSignal.hasRelevantEvent && eventSignal.riskLevel === "high" && eventSignal.marketImpact === "volatile") {
        console.log(`🤖 ⚠️ SKIP: High-risk event imminent (${eventSignal.eventName})`);
        return false;
      }

      // NEW: Full market analysis (order book, volume, trades)
      if (opp.tokenId) {
        const marketAnalysis = await analyzeMarket(opp.market.id, opp.tokenId, opp.market.question || "");
        console.log(`📊 Order Book: Imbalance ${(marketAnalysis.orderBook.imbalance * 100).toFixed(0)}% | Volume 24h: $${marketAnalysis.volume.volume24h.toFixed(0)}`);
        console.log(`📊 Buy: ${((marketAnalysis.volume.buyVolume / (marketAnalysis.volume.volume24h || 1)) * 100).toFixed(0)}% | Whales: ${marketAnalysis.volume.whaleTrades} | Trend: ${marketAnalysis.momentum.trend}`);
        
        // Check market analysis signal
        if (marketAnalysis.signal.direction === "sell" && marketAnalysis.signal.confidence > 0.5) {
          console.log(`🤖 ⚠️ SKIP: Market analysis bearish`);
          return false;
        }
      }

      // Forex Factory: Check for high-impact economic events
      const forexSignal = getForexTradingSignal(opp.market.question || "");
      if (forexSignal.hasHighImpact) {
        console.log(`📅 Forex Factory: ${forexSignal.eventsToday} events today (Risk: ${forexSignal.riskLevel})`);
        if (forexSignal.riskLevel === "high") {
          console.log(`🤖 ⚠️ SKIP: ${forexSignal.recommendation}`);
          return false;
        }
        if (forexSignal.nextHighImpact) {
          console.log(`📅 Next: ${forexSignal.nextHighImpact.currency} ${forexSignal.nextHighImpact.event} @ ${forexSignal.nextHighImpact.time}`);
        }
      }

      // NEW: Get learning recommendation
      const edge = (decision.confidence - 50) / 100; // Convert confidence to edge-like value
      const recommendation = getTradeRecommendation(
        opp.market.question || "",
        opp.midpoint,
        edge,
        REGULAR_TRADE_SIZE
      );

      console.log(`📊 Learning: ${recommendation.confidence} confidence - ${recommendation.reason}`);

      // NEW: Calculate dynamic TP/SL
      const dynamicTPSL = getDynamicTPSL(opp.midpoint, opp.market.question || "", edge, 48);
      const adjustedSize = REGULAR_TRADE_SIZE * recommendation.suggestedSize;
      const size = adjustedSize / opp.midpoint;

      console.log(`🤖 🎯 BUYING "${opp.market.question?.slice(0, 40)}..." for $${adjustedSize.toFixed(2)}`);
      console.log(`   ${dynamicTPSL.reason}`);

      const result = await service.placeBuyOrder(opp.tokenId, opp.midpoint + 0.02, size, {
        placeTPOrder: size >= 5,
        tpPrice: dynamicTPSL.takeProfitPrice,
      });

      if (result.success) {
        totalTrades++;
        
        const posId = `pos_${Date.now()}`;
        
        // Record trade for learning
        recordTradeEntry(
          posId,
          opp.market.id,
          opp.market.question || "",
          opp.midpoint,
          "YES",
          size,
          edge
        );
        
        service.addPosition({
          id: posId,
          marketId: opp.market.id,
          question: opp.market.question || "",
          slug: opp.market.slug || "",
          side: "BUY",
          entryPrice: opp.midpoint,
          size,
          amount: adjustedSize,
          tokenId: opp.tokenId,
          openedAt: new Date().toISOString(),
          status: "open",
          category: opp.category,
          tpOrderId: result.tpOrderId,
          tpPrice: dynamicTPSL.takeProfitPrice,
        });

        console.log(`✅ Trade executed!`);
        return true;
      }
    }

    return false;
  } catch (e: any) {
    console.error("🤖 AI trade error:", e.message);
    return false;
  }
}

// ============================================================
// POSITION MONITORING (TP/SL)
// ============================================================

async function checkPositionsTPSL(): Promise<void> {
  if (!service) return;

  const positions = service.getOpenPositions();

  for (const pos of positions) {
    try {
      const currentPrice = await service.getMarketPrice(pos.marketId);
      if (!currentPrice) continue;

      const pnlPercent = ((currentPrice - pos.entryPrice) / pos.entryPrice) * 100;
      const tpInfo = pos.tpOrderId 
        ? `[TP: ${pos.tpPrice} ✅]` 
        : `[TP: ${pos.tpPrice} (monitoring)]`;

      console.log(`📊 ${pos.id}: ${pos.entryPrice.toFixed(3)}→${currentPrice.toFixed(3)} (${pnlPercent >= 0 ? "+" : ""}${pnlPercent.toFixed(1)}%) ${tpInfo}`);

      // Stop Loss
      if (pnlPercent <= -STOP_LOSS_PERCENT) {
        console.log(`📉 SL triggered for ${pos.question?.slice(0, 30)}...`);
        
        // Cancel TP order if exists
        if (pos.tpOrderId) {
          await service.cancelOrder(pos.tpOrderId);
        }

        // Add delay to avoid Cloudflare rate limiting
        await new Promise(r => setTimeout(r, 3000));

        // Place sell order
        const sellResult = await service.placeSellOrder(pos.tokenId, currentPrice - 0.01, pos.size);
        if (sellResult.success) {
          // Record exit for learning
          recordTradeExit(pos.id, currentPrice, "sl");
          service.closePosition(pos.id, currentPrice, `SL ${pnlPercent.toFixed(1)}%`);
        } else {
          console.log(`⚠️ SL sell failed: ${sellResult.error}`);
        }
      }

      // Take Profit (if no TP order placed)
      if (!pos.tpOrderId && pos.tpPrice && currentPrice >= pos.tpPrice) {
        console.log(`📈 TP triggered for ${pos.question?.slice(0, 30)}...`);
        
        // Add delay to avoid Cloudflare rate limiting
        await new Promise(r => setTimeout(r, 3000));
        
        const sellResult = await service.placeSellOrder(pos.tokenId, currentPrice, pos.size);
        if (sellResult.success) {
          // Record exit for learning
          recordTradeExit(pos.id, currentPrice, "tp");
          service.closePosition(pos.id, currentPrice, `TP +${pnlPercent.toFixed(1)}%`);
        } else {
          console.log(`⚠️ TP sell failed: ${sellResult.error}`);
        }
      }
    } catch (e: any) {
      console.error(`Error checking ${pos.id}: ${e.message}`);
    }
  }
}

// ============================================================
// AUTONOMY LOOP
// ============================================================

async function executeAutonomyCycle(): Promise<void> {
  if (!service) return;

  totalScans++;
  console.log(`\n🔄 === AUTONOMY CYCLE #${totalScans} ===`);
  console.log(`📅 ${new Date().toISOString()}`);

  const openCount = service.getOpenPositions().length;
  const openElonCount = service.getOpenElonPositions();

  try {
    // STEP 1: Check positions for TP/SL
    await checkPositionsTPSL();

    // STEP 2: Elon Auto-Trade (with edge)
    if (openCount < MAX_POSITIONS && openElonCount < MAX_ELON_POSITIONS) {
      console.log(`\n🐦 === ELON AUTO-TRADE ===`);
      await autoTradeElonMarket();
    } else if (openElonCount >= MAX_ELON_POSITIONS) {
      console.log(`🐦 Elon positions maxed (${openElonCount}/${MAX_ELON_POSITIONS})`);
    }

    // STEP 3: Crypto Auto-Trade (new!)
    if (openCount < MAX_POSITIONS) {
      console.log(`\n💎 === CRYPTO AUTO-TRADE ===`);
      await autoTradeCryptoMarket();
    }

    // STEP 4: Claude AI for other markets (with news)
    if (ANTHROPIC_API_KEY && openCount < MAX_POSITIONS) {
      console.log(`\n🤖 === AI MARKET ANALYSIS ===`);
      await aiTradeNonElon();
    }

    // STEP 4: Liquidity Mining (every 5 scans)
    if (LIQUIDITY_CONFIG.enabled && totalScans % LIQUIDITY_CONFIG.runEveryNScans === 0) {
      await runLiquidityMiningStrategy(service);
    }

    // STEP 5: Holding Rewards (every 10 scans)
    if (HOLDING_CONFIG.enabled && totalScans % HOLDING_CONFIG.runEveryNScans === 0) {
      await runHoldingRewardsStrategy(service);
    }

    // STEP 6: Maker Rebates (every scan for short-term markets)
    if (MAKER_REBATES_CONFIG.enabled && totalScans % 3 === 0) {
      await runMakerRebatesStrategy(service);
    }

    // Summary
    const finalOpenCount = service.getOpenPositions().length;
    const finalElonCount = service.getOpenElonPositions();
    const dailyRewards = getEstimatedDailyRewards();
    
    console.log(`\n📊 ${totalScans} scans | ${totalTrades} trades | ${finalOpenCount} open (${finalElonCount} elon) | $${service.getTotalPnl().toFixed(2)}`);
    console.log(`💧 Liquidity: ${getLiquidityOrders().length} | 📈 Holding: ${getHoldingPositions().length} (~$${dailyRewards.toFixed(3)}/day) | 🎲 Maker: ${getMakerOrders().length}`);

  } catch (e: any) {
    console.error("Cycle error:", e.message);
  }
}

export async function startAutonomy(): Promise<void> {
  if (autonomyRunning) {
    console.log("⚠️ Autonomy already running");
    return;
  }

  if (!service) {
    await initializeService();
  }

  autonomyEnabled = true;
  autonomyRunning = true;

  const openCount = service!.getOpenPositions().length;
  const elonCount = service!.getOpenElonPositions();

  // Get trading insights for display
  const insights = getTradingInsights();

  console.log(`
╔════════════════════════════════════════════════════════════════════════╗
║             ElizaBAO AUTONOMY v2.1.0 - SMART TRADING SUITE             ║
╠════════════════════════════════════════════════════════════════════════╣
║  🤖 ElizaOS Runtime: Active                                            ║
║  📦 Plugin: @elizabao/plugin-polymarket                                ║
╠════════════════════════════════════════════════════════════════════════╣
║  STRATEGIES:                                                           ║
║  🐦 Elon Tweet: Bayesian AI Prediction + Edge Calculation              ║
║  💎 Crypto: Statistical Price Prediction (BTC, ETH, SOL)               ║
║  💧 Liquidity Mining: ${LIQUIDITY_CONFIG.enabled ? "ENABLED" : "DISABLED"} ($${LIQUIDITY_CONFIG.budget} budget)                             ║
║  📈 Holding Rewards: ${HOLDING_CONFIG.enabled ? "ENABLED" : "DISABLED"} ($${HOLDING_CONFIG.budget} budget, 4% APY)                        ║
║  🎲 Maker Rebates: ${MAKER_REBATES_CONFIG.enabled ? "ENABLED" : "DISABLED"} ($${MAKER_REBATES_CONFIG.budget} budget)                              ║
╠════════════════════════════════════════════════════════════════════════╣
║  SMART FEATURES:                                                       ║
║  📊 Trade Analytics: Learning from ${insights.overallWinRate > 0 ? `${(insights.overallWinRate * 100).toFixed(0)}% win rate` : "building data"}               ║
║  📰 News Intelligence: ${Object.entries(getNewsAPIStatus()).filter(([k, v]) => v).length} sources active                    ║
║  🐦 Social Tracker: ${INFLUENCERS.length} influencers (world leaders, finance, crypto)     ║
║  🐋 Whale Tracker: Smart money following                               ║
║  📅 Event Calendar: ${getEventIntelligence().thisWeekEvents.length} events this week                             ║
║  📊 Forex Factory: ${getUpcomingHighImpact(7).length} high-impact events (all countries)         ║
║  📈 Market Analyzer: Order book + Volume tracking                      ║
║  🎯 Dynamic TP/SL: Volatility-adjusted (${(TPSL_CONFIG.baseTakeProfit * 100).toFixed(0)}%/${(TPSL_CONFIG.baseStopLoss * 100).toFixed(0)}% base)                ║
╠════════════════════════════════════════════════════════════════════════╣
║  CONFIG:                                                               ║
║  ⏰ Interval: ${(AUTONOMY_INTERVAL_MS / 1000).toString().padEnd(4)}s | 🌐 Proxy: ${getProxyInfo().configured ? "Active" : "None"}                          ║
║  📊 Max: ${MAX_POSITIONS} positions | ${MAX_ELON_POSITIONS} Elon | Edge: ${(ELON_EDGE_CONFIG.minEdge * 100).toFixed(0)}%/${(ELON_EDGE_CONFIG.mediumEdge * 100).toFixed(0)}%/${(ELON_EDGE_CONFIG.highEdge * 100).toFixed(0)}%                  ║
║  💰 Trade: Elon $${ELON_TRADE_SIZE} | Regular $${REGULAR_TRADE_SIZE} | Crypto $${REGULAR_TRADE_SIZE * 2}                            ║
║  🧠 Claude AI: ${ANTHROPIC_API_KEY ? "Enabled" : "Disabled"}                                                  ║
║  💾 Loaded: ${openCount} positions | Elon: ${elonCount}/${MAX_ELON_POSITIONS}                                ║
╚════════════════════════════════════════════════════════════════════════╝
`);

  while (autonomyEnabled) {
    await executeAutonomyCycle();

    if (autonomyEnabled) {
      console.log(`\n⏳ Next cycle in ${AUTONOMY_INTERVAL_MS / 1000}s...`);
      await new Promise((r) => setTimeout(r, AUTONOMY_INTERVAL_MS));
    }
  }

  autonomyRunning = false;
  console.log("🛑 Autonomy stopped");
}

export function stopAutonomy(): void {
  autonomyEnabled = false;
  console.log("🛑 Stopping autonomy...");
}

export function getAutonomyStatus() {
  return {
    enabled: autonomyEnabled,
    running: autonomyRunning,
    totalScans,
    totalTrades,
    intervalMs: AUTONOMY_INTERVAL_MS,
    maxPositions: MAX_POSITIONS,
    maxElonPositions: MAX_ELON_POSITIONS,
    takeProfitPercent: TAKE_PROFIT_PERCENT,
    stopLossPercent: STOP_LOSS_PERCENT,
    elonTradeSize: ELON_TRADE_SIZE,
    regularTradeSize: REGULAR_TRADE_SIZE,
    claudeEnabled: !!ANTHROPIC_API_KEY,
    edgeConfig: ELON_EDGE_CONFIG,
  };
}

// CLI entry point
if (import.meta.main) {
  console.log("Starting ElizaBAO Autonomy v2.0.0...");
  
  // Configure HTTP proxy FIRST before any Polymarket API calls
  const proxyConfigured = configureHttpProxy();
  if (proxyConfigured) {
    // Test proxy connection
    await testProxyConnection();
  }
  
  startAutonomy().catch(console.error);

  process.on("SIGINT", () => {
    console.log("\n👋 Shutting down...");
    stopAutonomy();
    setTimeout(() => process.exit(0), 1000);
  });
}
