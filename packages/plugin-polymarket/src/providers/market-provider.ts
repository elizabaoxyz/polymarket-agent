/**
 * Market Provider
 * Provides market data and opportunities to the agent
 */

import type { Provider, IAgentRuntime, Memory, State } from "@elizaos/core";
import { PolymarketService } from "../services/polymarket-service.js";

export const marketProvider: Provider = {
  name: "MARKET_DATA",
  description: "Provides current Polymarket data and trading opportunities",

  get: async (
    runtime: IAgentRuntime,
    message: Memory,
    state?: State
  ): Promise<string> => {
    try {
      let service = runtime.getService("polymarket") as PolymarketService;
      
      if (!service) {
        // Create a temporary service for read-only operations
        service = new PolymarketService({
          privateKey: runtime.getSetting("EVM_PRIVATE_KEY") || "",
          walletAddress: runtime.getSetting("WALLET_ADDRESS") || "",
        });
      }

      // Fetch top markets
      const markets = await service.fetchMarkets(20);

      const lines = [
        `📈 Polymarket Overview`,
        `━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`,
        `Active Markets: ${markets.length}+`,
        ``,
        `🔥 Top Markets by Volume:`,
      ];

      markets.slice(0, 5).forEach((m, i) => {
        const price = m.outcomePrices[0] || 0;
        lines.push(
          `${i + 1}. ${m.question.slice(0, 50)}...`,
          `   Price: ${(price * 100).toFixed(0)}% YES | Vol: $${((m.volume24hr || 0) / 1000).toFixed(0)}K`
        );
      });

      // Add categories breakdown
      const categories = {
        politics: markets.filter((m) =>
          m.question.toLowerCase().match(/trump|biden|election|president|senate|congress/)
        ).length,
        crypto: markets.filter((m) =>
          m.question.toLowerCase().match(/bitcoin|btc|eth|crypto/)
        ).length,
        elon: markets.filter((m) =>
          m.question.toLowerCase().match(/elon|musk|tweet/)
        ).length,
      };

      lines.push(
        ``,
        `📊 Categories:`,
        `   Politics: ${categories.politics} markets`,
        `   Crypto: ${categories.crypto} markets`,
        `   Elon: ${categories.elon} markets`
      );

      return lines.join("\n");
    } catch (error: any) {
      return `Market data unavailable: ${error.message}`;
    }
  },
};
