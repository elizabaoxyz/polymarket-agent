/**
 * Scan Markets Action
 * Scans Polymarket for trading opportunities
 */

import type { Action, ActionParams, ActionResult, IAgentRuntime } from "@elizaos/core";
import { PolymarketService } from "../services/polymarket-service.js";

export const scanMarketsAction: Action = {
  name: "SCAN_MARKETS",
  description: "Scan Polymarket for trading opportunities based on spread, liquidity, and price patterns",
  similes: [
    "scan markets",
    "find opportunities",
    "look for trades",
    "analyze markets",
    "search polymarket",
    "check markets",
  ],
  examples: [
    [
      {
        name: "user",
        content: { text: "Scan for trading opportunities" },
      },
      {
        name: "assistant",
        content: {
          text: "I'll scan Polymarket for the best trading opportunities based on spread, liquidity, and market uncertainty.",
          action: "SCAN_MARKETS",
        },
      },
    ],
    [
      {
        name: "user",
        content: { text: "Find me some good markets to trade" },
      },
      {
        name: "assistant",
        content: {
          text: "Scanning Polymarket now to find markets with tight spreads and good liquidity.",
          action: "SCAN_MARKETS",
        },
      },
    ],
  ],

  validate: async (runtime: IAgentRuntime): Promise<boolean> => {
    // Check if Polymarket service is configured
    const privateKey = runtime.getSetting("EVM_PRIVATE_KEY");
    return !!privateKey;
  },

  handler: async (params: ActionParams): Promise<ActionResult> => {
    const { runtime, message } = params;

    try {
      // Get or create Polymarket service
      let service = runtime.getService("polymarket") as PolymarketService;
      
      if (!service) {
        service = new PolymarketService({
          privateKey: runtime.getSetting("EVM_PRIVATE_KEY") || "",
          walletAddress: runtime.getSetting("WALLET_ADDRESS") || "",
          clobApiKey: runtime.getSetting("CLOB_API_KEY"),
          clobApiSecret: runtime.getSetting("CLOB_API_SECRET"),
          clobApiPassphrase: runtime.getSetting("CLOB_API_PASSPHRASE"),
          proxyWallet: runtime.getSetting("PROXY_WALLET"),
        });
        await service.initialize();
      }

      // Scan for opportunities
      const opportunities = await service.scanOpportunities(50, 0.5);

      if (opportunities.length === 0) {
        return {
          success: true,
          data: { opportunities: [], count: 0 },
          message: "No trading opportunities found at this time. Markets may have wide spreads or low liquidity.",
        };
      }

      // Format top opportunities for response
      const topOpps = opportunities.slice(0, 5).map((opp, i) => ({
        rank: i + 1,
        question: opp.market.question,
        spread: `${(opp.spread * 100).toFixed(1)}%`,
        midpoint: opp.midpoint.toFixed(2),
        score: opp.score.toFixed(2),
        category: opp.category,
        tokenId: opp.tokenId,
      }));

      return {
        success: true,
        data: {
          opportunities: topOpps,
          count: opportunities.length,
          allOpportunities: opportunities,
        },
        message: `Found ${opportunities.length} trading opportunities. Top 5:\n${topOpps
          .map(
            (o) =>
              `${o.rank}. ${o.question.slice(0, 60)}... (Score: ${o.score}, Spread: ${o.spread})`
          )
          .join("\n")}`,
      };
    } catch (error: any) {
      return {
        success: false,
        error: error.message,
        message: `Failed to scan markets: ${error.message}`,
      };
    }
  },
};
