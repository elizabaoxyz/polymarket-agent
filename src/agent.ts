/**
 * ElizaBAO Agent Entry Point
 * 
 * This is the main entry point for running the ElizaBAO trading agent
 * using ElizaOS v2.0.0 runtime.
 * 
 * Usage:
 *   bun run src/agent.ts
 *   bun run src/agent.ts --character characters/elizabao.json
 */

import "dotenv/config";
import { 
  AgentRuntime,
  createAgentRuntime,
  loadCharacter,
  startAgents,
  type Character,
} from "@elizaos/core";

import { polymarketPlugin } from "@elizabao/plugin-polymarket";

// Default character if none specified
const DEFAULT_CHARACTER = "./characters/elizabao.json";

async function main() {
  console.log(`
╔════════════════════════════════════════════════════════════════════╗
║                         ElizaBAO v2.0.0                            ║
║              Polymarket Trading Agent on ElizaOS                   ║
╠════════════════════════════════════════════════════════════════════╣
║  Combining ElizaOS + Claude + Polymarket                           ║
║  Autonomous prediction market trading                              ║
╚════════════════════════════════════════════════════════════════════╝
  `);

  // Parse command line arguments
  const args = process.argv.slice(2);
  const characterPath = args.includes("--character") 
    ? args[args.indexOf("--character") + 1] 
    : DEFAULT_CHARACTER;

  // Load character configuration
  console.log(`📂 Loading character from: ${characterPath}`);
  let character: Character;
  
  try {
    character = await loadCharacter(characterPath);
    console.log(`✅ Loaded character: ${character.name}`);
  } catch (error) {
    console.error(`❌ Failed to load character: ${error}`);
    process.exit(1);
  }

  // Validate environment variables
  const requiredEnvVars = [
    "ANTHROPIC_API_KEY",
    "EVM_PRIVATE_KEY",
  ];

  const missingVars = requiredEnvVars.filter(v => !process.env[v]);
  if (missingVars.length > 0) {
    console.warn(`⚠️ Missing environment variables: ${missingVars.join(", ")}`);
  }

  // Create runtime with plugins
  console.log("🔧 Creating ElizaOS runtime...");
  
  const runtime = await createAgentRuntime({
    character,
    plugins: [
      polymarketPlugin,
    ],
    settings: {
      // Core settings
      ANTHROPIC_API_KEY: process.env.ANTHROPIC_API_KEY,
      
      // Polymarket settings
      EVM_PRIVATE_KEY: process.env.EVM_PRIVATE_KEY,
      WALLET_ADDRESS: process.env.WALLET_ADDRESS,
      CLOB_API_KEY: process.env.CLOB_API_KEY,
      CLOB_API_SECRET: process.env.CLOB_API_SECRET,
      CLOB_API_PASSPHRASE: process.env.CLOB_API_PASSPHRASE,
      PROXY_WALLET: process.env.PROXY_WALLET,
      
      // Optional settings
      GAMMA_API_URL: process.env.GAMMA_API_URL || "https://gamma-api.polymarket.com",
      CLOB_API_URL: process.env.CLOB_API_URL || "https://clob.polymarket.com",
    },
  });

  console.log("✅ Runtime created successfully");
  console.log(`🤖 Agent: ${character.name}`);
  console.log(`📦 Plugins: ${runtime.plugins?.map(p => p.name).join(", ")}`);

  // Start the agent
  console.log("🚀 Starting agent...");
  
  try {
    await startAgents([runtime]);
    console.log("✅ Agent is running!");
    console.log("");
    console.log("Available commands:");
    console.log("  - scan     : Scan markets for opportunities");
    console.log("  - analyze  : Analyze top opportunity");
    console.log("  - portfolio: View current positions");
    console.log("  - buy      : Buy shares in a market");
    console.log("  - sell     : Sell shares in a market");
    console.log("");
  } catch (error) {
    console.error("❌ Failed to start agent:", error);
    process.exit(1);
  }
}

// Handle graceful shutdown
process.on("SIGINT", () => {
  console.log("\n👋 Shutting down ElizaBAO...");
  process.exit(0);
});

process.on("SIGTERM", () => {
  console.log("\n👋 Shutting down ElizaBAO...");
  process.exit(0);
});

// Run the agent
main().catch((error) => {
  console.error("Fatal error:", error);
  process.exit(1);
});
