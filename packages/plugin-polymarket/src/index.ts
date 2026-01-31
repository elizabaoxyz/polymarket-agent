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
 */

import type { Plugin, IAgentRuntime } from "@elizaos/core";

// Services
import { PolymarketService } from "./services/polymarket-service.js";

// Types
export * from "./types.js";
export { PolymarketService };

// Store service instance globally for access
let polymarketServiceInstance: PolymarketService | null = null;

export function getPolymarketService(): PolymarketService | null {
  return polymarketServiceInstance;
}

/**
 * Polymarket Plugin for ElizaOS v2.0.0
 */
export const polymarketPlugin: Plugin = {
  name: "@elizabao/plugin-polymarket",
  description: "Polymarket prediction market trading plugin for ElizaOS",

  // Actions - defined inline to avoid import issues
  actions: [],

  // Providers - defined inline to avoid import issues
  providers: [],

  // Evaluators for decision making
  evaluators: [],

  // Services
  services: [],

  // Plugin initialization
  init: async (config: Record<string, string>, runtime: IAgentRuntime) => {
    console.log("🚀 Initializing Polymarket Plugin v2.0.0");

    // Get settings from config or runtime
    const privateKey = config.EVM_PRIVATE_KEY || String(runtime.getSetting("EVM_PRIVATE_KEY") || "");
    const clobApiKey = config.CLOB_API_KEY || String(runtime.getSetting("CLOB_API_KEY") || "");
    const walletAddress = config.WALLET_ADDRESS || String(runtime.getSetting("WALLET_ADDRESS") || "");
    const clobApiSecret = config.CLOB_API_SECRET || String(runtime.getSetting("CLOB_API_SECRET") || "");
    const clobApiPassphrase = config.CLOB_API_PASSPHRASE || String(runtime.getSetting("CLOB_API_PASSPHRASE") || "");
    const proxyWallet = config.PROXY_WALLET || String(runtime.getSetting("PROXY_WALLET") || "");

    if (!privateKey) {
      console.warn("⚠️ EVM_PRIVATE_KEY not set - trading disabled");
    }

    if (!clobApiKey) {
      console.warn("⚠️ CLOB_API_KEY not set - order placement disabled");
    }

    // Create the Polymarket service
    const service = new PolymarketService({
      privateKey,
      walletAddress,
      clobApiKey: clobApiKey || undefined,
      clobApiSecret: clobApiSecret || undefined,
      clobApiPassphrase: clobApiPassphrase || undefined,
      proxyWallet: proxyWallet || undefined,
    });

    await service.initialize();

    // Store globally for access
    polymarketServiceInstance = service;

    console.log("✅ Polymarket Plugin initialized");
  },
};

// Default export for ESM
export default polymarketPlugin;
