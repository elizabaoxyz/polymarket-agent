/**
 * Analyze Action
 * AI-powered market analysis and trading decisions
 */

import type { Action, ActionParams, ActionResult, IAgentRuntime } from "@elizaos/core";
import { PolymarketService } from "../services/polymarket-service.js";
import type { MarketOpportunity, TradeDecision } from "../types.js";

export const analyzeAction: Action = {
  name: "ANALYZE_OPPORTUNITY",
  description: "Analyze a market opportunity and decide whether to trade",
  similes: [
    "analyze",
    "evaluate",
    "should I trade",
    "what do you think",
    "give me advice",
    "trading decision",
  ],
  examples: [
    [
      {
        name: "user",
        content: { text: "Analyze the top opportunity and tell me if I should trade" },
      },
      {
        name: "assistant",
        content: {
          text: "I'll analyze the market conditions and provide a trading recommendation.",
          action: "ANALYZE_OPPORTUNITY",
        },
      },
    ],
  ],

  validate: async (runtime: IAgentRuntime): Promise<boolean> => {
    return true; // Analysis can work without trading credentials
  },

  handler: async (params: ActionParams): Promise<ActionResult> => {
    const { runtime, message } = params;

    try {
      let service = runtime.getService("polymarket") as PolymarketService;
      
      if (!service) {
        service = new PolymarketService({
          privateKey: runtime.getSetting("EVM_PRIVATE_KEY") || "",
          walletAddress: runtime.getSetting("WALLET_ADDRESS") || "",
        });
        await service.initialize();
      }

      // Get opportunities to analyze
      const opportunities = await service.scanOpportunities(50, 0.5);
      
      if (opportunities.length === 0) {
        return {
          success: true,
          data: {
            decision: {
              shouldTrade: false,
              action: "HOLD",
              market: null,
              reasoning: "No suitable opportunities found",
              confidence: 0,
            } as TradeDecision,
          },
          message: "No trading opportunities available at this time. Recommendation: HOLD",
        };
      }

      // Get current positions
      const openPositions = service.getOpenPositions();
      const MAX_POSITIONS = 20;

      if (openPositions.length >= MAX_POSITIONS) {
        return {
          success: true,
          data: {
            decision: {
              shouldTrade: false,
              action: "HOLD",
              market: null,
              reasoning: `Maximum positions reached (${openPositions.length}/${MAX_POSITIONS})`,
              confidence: 100,
            } as TradeDecision,
          },
          message: `Position limit reached. Currently holding ${openPositions.length} positions. Recommendation: HOLD`,
        };
      }

      // Analyze top opportunity
      const topOpp = opportunities[0];
      const decision = analyzeOpportunity(topOpp, openPositions.length);

      return {
        success: true,
        data: {
          decision,
          opportunity: topOpp,
          openPositions: openPositions.length,
        },
        message: formatDecision(decision, topOpp),
      };
    } catch (error: any) {
      return {
        success: false,
        error: error.message,
        message: `Analysis failed: ${error.message}`,
      };
    }
  },
};

/**
 * Analyze a single opportunity and return a trading decision
 */
function analyzeOpportunity(
  opp: MarketOpportunity,
  currentPositions: number
): TradeDecision {
  const { market, spread, midpoint, score, category } = opp;

  // Decision logic based on score and spread
  let shouldTrade = false;
  let confidence = 0;
  let reasoning = "";

  if (score >= 0.8 && spread <= 0.03) {
    // Excellent opportunity
    shouldTrade = true;
    confidence = 85;
    reasoning = `Excellent opportunity with tight ${(spread * 100).toFixed(1)}% spread and high score of ${score.toFixed(2)}. Market shows strong liquidity.`;
  } else if (score >= 0.7 && spread <= 0.05) {
    // Good opportunity
    shouldTrade = true;
    confidence = 70;
    reasoning = `Good opportunity with ${(spread * 100).toFixed(1)}% spread. Score of ${score.toFixed(2)} indicates favorable conditions.`;
  } else if (score >= 0.6 && spread <= 0.08) {
    // Moderate opportunity
    shouldTrade = currentPositions < 10;
    confidence = 55;
    reasoning = `Moderate opportunity. ${(spread * 100).toFixed(1)}% spread is acceptable. Consider if portfolio has room.`;
  } else {
    // Not recommended
    shouldTrade = false;
    confidence = 40;
    reasoning = `Spread of ${(spread * 100).toFixed(1)}% is too wide or score of ${score.toFixed(2)} is too low. Better to wait.`;
  }

  // Category-specific adjustments
  if (category === "elon") {
    reasoning += " [Elon tweet market - consider historical patterns]";
  } else if (category === "crypto") {
    reasoning += " [Crypto market - higher volatility expected]";
  } else if (category === "politics") {
    reasoning += " [Political market - longer time horizon]";
  }

  return {
    shouldTrade,
    action: shouldTrade ? "BUY" : "HOLD",
    market: market,
    tokenId: opp.tokenId,
    price: midpoint,
    size: 2 / midpoint, // $2 position
    reasoning,
    confidence,
  };
}

/**
 * Format decision for display
 */
function formatDecision(decision: TradeDecision, opp: MarketOpportunity): string {
  const lines = [
    `📊 Market Analysis`,
    `━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`,
    `Market: ${opp.market.question.slice(0, 60)}...`,
    `Category: ${opp.category?.toUpperCase() || "GENERAL"}`,
    `Spread: ${(opp.spread * 100).toFixed(1)}%`,
    `Midpoint: ${opp.midpoint.toFixed(2)}`,
    `Score: ${opp.score.toFixed(2)}`,
    ``,
    `🤖 AI Decision: ${decision.action}`,
    `Confidence: ${decision.confidence}%`,
    ``,
    `💡 Reasoning:`,
    decision.reasoning,
  ];

  if (decision.shouldTrade) {
    lines.push(
      ``,
      `📈 Recommended Trade:`,
      `  Side: BUY`,
      `  Price: $${decision.price?.toFixed(2)}`,
      `  Size: ${decision.size?.toFixed(2)} shares (~$2)`
    );
  }

  return lines.join("\n");
}
