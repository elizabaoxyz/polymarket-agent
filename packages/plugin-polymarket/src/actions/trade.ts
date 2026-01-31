/**
 * Trade Actions
 * Buy and Sell actions for Polymarket
 */

import type { Action, ActionParams, ActionResult, IAgentRuntime } from "@elizaos/core";
import { PolymarketService } from "../services/polymarket-service.js";
import { v4 as uuidv4 } from "uuid";

/**
 * Buy Action
 */
export const buyAction: Action = {
  name: "BUY_MARKET",
  description: "Buy shares in a Polymarket prediction market",
  similes: [
    "buy",
    "purchase",
    "go long",
    "bet yes",
    "buy shares",
    "place buy order",
  ],
  examples: [
    [
      {
        name: "user",
        content: { text: "Buy $5 of the top opportunity" },
      },
      {
        name: "assistant",
        content: {
          text: "I'll place a buy order for $5 on the best opportunity I found.",
          action: "BUY_MARKET",
        },
      },
    ],
  ],

  validate: async (runtime: IAgentRuntime): Promise<boolean> => {
    const privateKey = runtime.getSetting("EVM_PRIVATE_KEY");
    const clobApiKey = runtime.getSetting("CLOB_API_KEY");
    return !!privateKey && !!clobApiKey;
  },

  handler: async (params: ActionParams): Promise<ActionResult> => {
    const { runtime, message } = params;

    try {
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

      // Extract trade parameters from message context
      const context = message.content as any;
      const tokenId = context.tokenId;
      const price = context.price || 0.5;
      const amount = context.amount || 2; // Default $2
      const size = amount / price;

      if (!tokenId) {
        return {
          success: false,
          error: "No token ID specified",
          message: "Please specify which market to buy. Run SCAN_MARKETS first to find opportunities.",
        };
      }

      // Place the order
      const result = await service.placeBuyOrder(tokenId, price, size);

      if (!result.success) {
        return {
          success: false,
          error: result.error,
          message: `Failed to place buy order: ${result.error}`,
        };
      }

      // Track the position
      const position = {
        id: uuidv4(),
        marketId: context.marketId || tokenId,
        question: context.question || "Unknown market",
        slug: context.slug || "",
        side: "BUY" as const,
        entryPrice: price,
        size,
        amount,
        tokenId,
        openedAt: new Date().toISOString(),
        status: "open" as const,
        category: context.category,
      };

      service.addPosition(position);

      return {
        success: true,
        data: {
          orderId: result.orderId,
          position,
        },
        message: `Successfully placed BUY order for ${size.toFixed(2)} shares at $${price.toFixed(2)} (Order ID: ${result.orderId})`,
      };
    } catch (error: any) {
      return {
        success: false,
        error: error.message,
        message: `Trade failed: ${error.message}`,
      };
    }
  },
};

/**
 * Sell Action
 */
export const sellAction: Action = {
  name: "SELL_MARKET",
  description: "Sell shares in a Polymarket prediction market",
  similes: [
    "sell",
    "close position",
    "exit",
    "take profit",
    "stop loss",
    "sell shares",
  ],
  examples: [
    [
      {
        name: "user",
        content: { text: "Sell my position in the BTC market" },
      },
      {
        name: "assistant",
        content: {
          text: "I'll close your position in the BTC market.",
          action: "SELL_MARKET",
        },
      },
    ],
  ],

  validate: async (runtime: IAgentRuntime): Promise<boolean> => {
    const privateKey = runtime.getSetting("EVM_PRIVATE_KEY");
    const clobApiKey = runtime.getSetting("CLOB_API_KEY");
    return !!privateKey && !!clobApiKey;
  },

  handler: async (params: ActionParams): Promise<ActionResult> => {
    const { runtime, message } = params;

    try {
      let service = runtime.getService("polymarket") as PolymarketService;
      
      if (!service) {
        return {
          success: false,
          error: "Polymarket service not initialized",
          message: "Please initialize the trading agent first.",
        };
      }

      const context = message.content as any;
      const positionId = context.positionId;
      const tokenId = context.tokenId;
      const price = context.price;
      const size = context.size;

      if (!tokenId || !price || !size) {
        return {
          success: false,
          error: "Missing trade parameters",
          message: "Please specify tokenId, price, and size for the sell order.",
        };
      }

      const result = await service.placeSellOrder(tokenId, price, size);

      if (!result.success) {
        return {
          success: false,
          error: result.error,
          message: `Failed to place sell order: ${result.error}`,
        };
      }

      // Close the position if we have a position ID
      if (positionId) {
        service.closePosition(positionId, price, context.reason || "Manual sell");
      }

      return {
        success: true,
        data: {
          orderId: result.orderId,
        },
        message: `Successfully placed SELL order for ${size.toFixed(2)} shares at $${price.toFixed(2)} (Order ID: ${result.orderId})`,
      };
    } catch (error: any) {
      return {
        success: false,
        error: error.message,
        message: `Trade failed: ${error.message}`,
      };
    }
  },
};
