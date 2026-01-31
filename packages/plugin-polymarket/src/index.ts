/**
 * ElizaBAO Polymarket Plugin
 * 
 * An ElizaOS v2.0.0 plugin for autonomous prediction market trading on Polymarket.
 * 
 * Features:
 * - Market scanning and opportunity detection
 * - AI-powered trading decisions
 * - Position management with TP/SL
 * - Elon tweet prediction engine
 * - Liquidity mining support
 * 
 * @author ElizaBAO
 * @version 2.0.0-alpha.1
 */

import type { Plugin } from "@elizaos/core";

// Actions
import { scanMarketsAction } from "./actions/scan-markets.js";
import { buyAction, sellAction } from "./actions/trade.js";
import { analyzeAction } from "./actions/analyze.js";

// Providers
import { portfolioProvider } from "./providers/portfolio-provider.js";
import { marketProvider } from "./providers/market-provider.js";

// Services
import { PolymarketService } from "./services/polymarket-service.js";

// Types
export * from "./types.js";
export { PolymarketService };

/**
 * Polymarket Plugin for ElizaOS v2.0.0
 */
export const polymarketPlugin: Plugin = {
  name: "@elizabao/plugin-polymarket",
  description: "Polymarket prediction market trading plugin for ElizaOS",
  version: "2.0.0-alpha.1",

  // Actions the agent can perform
  actions: [
    scanMarketsAction,
    buyAction,
    sellAction,
    analyzeAction,
  ],

  // Providers for context injection
  providers: [
    portfolioProvider,
    marketProvider,
  ],

  // Evaluators for decision making
  evaluators: [],

  // Services
  services: [],

  // Plugin initialization
  init: async (runtime) => {
    console.log("🚀 Initializing Polymarket Plugin v2.0.0");

    // Check for required settings
    const privateKey = runtime.getSetting("EVM_PRIVATE_KEY");
    const clobApiKey = runtime.getSetting("CLOB_API_KEY");

    if (!privateKey) {
      console.warn("⚠️ EVM_PRIVATE_KEY not set - trading disabled");
    }

    if (!clobApiKey) {
      console.warn("⚠️ CLOB_API_KEY not set - order placement disabled");
    }

    // Create and register the Polymarket service
    const service = new PolymarketService({
      privateKey: privateKey || "",
      walletAddress: runtime.getSetting("WALLET_ADDRESS") || "",
      clobApiKey: clobApiKey,
      clobApiSecret: runtime.getSetting("CLOB_API_SECRET"),
      clobApiPassphrase: runtime.getSetting("CLOB_API_PASSPHRASE"),
      proxyWallet: runtime.getSetting("PROXY_WALLET"),
    });

    await service.initialize();

    // Register service with runtime
    runtime.registerService("polymarket", service);

    console.log("✅ Polymarket Plugin initialized");
  },
};

// Default export for ESM
export default polymarketPlugin;
