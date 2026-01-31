/**
 * Portfolio Provider
 * Provides portfolio and position data to the agent
 */

import type { Provider, IAgentRuntime, Memory, State } from "@elizaos/core";
import { PolymarketService } from "../services/polymarket-service.js";
import type { PortfolioStats } from "../types.js";

export const portfolioProvider: Provider = {
  name: "PORTFOLIO",
  description: "Provides current portfolio positions and trading statistics",

  get: async (
    runtime: IAgentRuntime,
    message: Memory,
    state?: State
  ): Promise<string> => {
    try {
      const service = runtime.getService("polymarket") as PolymarketService;
      
      if (!service) {
        return "Portfolio not available - Polymarket service not initialized.";
      }

      const positions = service.getPositions();
      const openPositions = positions.filter((p) => p.status === "open");
      const closedPositions = positions.filter((p) => p.status === "closed");

      // Calculate stats
      const totalPnl = closedPositions.reduce((sum, p) => sum + (p.pnl || 0), 0);
      const wins = closedPositions.filter((p) => (p.pnl || 0) > 0).length;
      const winRate = closedPositions.length > 0 
        ? (wins / closedPositions.length) * 100 
        : 0;

      const stats: PortfolioStats = {
        totalPositions: positions.length,
        openPositions: openPositions.length,
        totalTrades: closedPositions.length,
        totalPnl,
        winRate,
        avgReturn: closedPositions.length > 0 
          ? totalPnl / closedPositions.length 
          : 0,
      };

      // Format for agent context
      const lines = [
        `📊 Portfolio Summary`,
        `━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`,
        `Open Positions: ${stats.openPositions}`,
        `Total Trades: ${stats.totalTrades}`,
        `Total P&L: $${stats.totalPnl.toFixed(2)}`,
        `Win Rate: ${stats.winRate.toFixed(1)}%`,
        `Avg Return: $${stats.avgReturn.toFixed(2)}`,
      ];

      if (openPositions.length > 0) {
        lines.push(``, `📈 Open Positions:`);
        openPositions.slice(0, 5).forEach((p, i) => {
          lines.push(
            `${i + 1}. ${p.question.slice(0, 40)}...`,
            `   Entry: $${p.entryPrice.toFixed(2)} | Size: ${p.size.toFixed(2)} | Category: ${p.category || "general"}`
          );
        });
        if (openPositions.length > 5) {
          lines.push(`   ... and ${openPositions.length - 5} more`);
        }
      }

      return lines.join("\n");
    } catch (error: any) {
      return `Portfolio error: ${error.message}`;
    }
  },
};
