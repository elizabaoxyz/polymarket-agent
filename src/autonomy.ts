/**
 * ElizaBAO Autonomy Service
 * 
 * ElizaOS v2.0.0 compatible autonomous trading loop
 * Uses the plugin architecture for market scanning and trading
 */

import "dotenv/config";
import { 
  AgentRuntime,
  createAgentRuntime,
  loadCharacter,
  type Character,
  type Memory,
} from "@elizaos/core";

import { polymarketPlugin, PolymarketService } from "@elizabao/plugin-polymarket";

// Configuration
const AUTONOMY_INTERVAL_MS = parseInt(process.env.AUTONOMY_INTERVAL_MS || "120000");
const MAX_POSITIONS = parseInt(process.env.MAX_POSITIONS || "20");
const MAX_ELON_POSITIONS = parseInt(process.env.MAX_ELON_POSITIONS || "3");
const TAKE_PROFIT_PERCENT = parseInt(process.env.TAKE_PROFIT_PERCENT || "20");
const STOP_LOSS_PERCENT = parseInt(process.env.STOP_LOSS_PERCENT || "15");

// State
let autonomyEnabled = false;
let autonomyRunning = false;
let totalScans = 0;
let totalTrades = 0;
let runtime: AgentRuntime | null = null;

/**
 * Initialize the ElizaOS runtime with Polymarket plugin
 */
export async function initializeRuntime(characterPath = "./characters/elizabao.json"): Promise<AgentRuntime> {
  console.log("🔧 Initializing ElizaOS v2.0.0 Runtime...");
  
  const character = await loadCharacter(characterPath);
  
  runtime = await createAgentRuntime({
    character,
    plugins: [polymarketPlugin],
    settings: {
      ANTHROPIC_API_KEY: process.env.ANTHROPIC_API_KEY,
      EVM_PRIVATE_KEY: process.env.EVM_PRIVATE_KEY,
      WALLET_ADDRESS: process.env.WALLET_ADDRESS,
      CLOB_API_KEY: process.env.CLOB_API_KEY,
      CLOB_API_SECRET: process.env.CLOB_API_SECRET,
      CLOB_API_PASSPHRASE: process.env.CLOB_API_PASSPHRASE,
      PROXY_WALLET: process.env.PROXY_WALLET,
    },
  });

  console.log("✅ ElizaOS Runtime initialized");
  console.log(`🤖 Agent: ${character.name}`);
  console.log(`📦 Plugins: ${runtime.plugins?.map(p => p.name).join(", ")}`);
  
  return runtime;
}

/**
 * Execute a single autonomy cycle using ElizaOS actions
 */
async function executeAutonomyCycle(): Promise<void> {
  if (!runtime) {
    console.error("❌ Runtime not initialized");
    return;
  }

  totalScans++;
  console.log(`\n🔄 === AUTONOMY CYCLE #${totalScans} ===`);
  console.log(`📅 ${new Date().toISOString()}`);

  try {
    // Get the Polymarket service from runtime
    const service = runtime.getService("polymarket") as PolymarketService;
    if (!service) {
      console.error("❌ Polymarket service not found");
      return;
    }

    // Check current positions
    const openPositions = service.getOpenPositions();
    console.log(`📊 Open positions: ${openPositions.length}/${MAX_POSITIONS}`);

    // Check TP/SL for existing positions
    await checkPositionsTPSL(service);

    // If we have room for more positions, scan for opportunities
    if (openPositions.length < MAX_POSITIONS) {
      console.log("\n🔍 Scanning for opportunities...");
      
      const opportunities = await service.scanOpportunities(50, 0.6);
      console.log(`📈 Found ${opportunities.length} opportunities`);

      if (opportunities.length > 0) {
        // Use ElizaOS message pipeline for AI decision
        const decision = await makeTradeDecision(opportunities[0]);
        
        if (decision.shouldTrade && decision.action === "BUY") {
          console.log(`\n🎯 AI Decision: BUY`);
          console.log(`   Market: ${decision.market?.question?.slice(0, 50)}...`);
          console.log(`   Confidence: ${decision.confidence}%`);
          console.log(`   Reasoning: ${decision.reasoning}`);

          // Execute trade
          const result = await service.placeBuyOrder(
            decision.tokenId!,
            decision.price!,
            decision.size!
          );

          if (result.success) {
            totalTrades++;
            console.log(`✅ Trade executed: ${result.orderId}`);
            
            // Track position
            service.addPosition({
              id: crypto.randomUUID(),
              marketId: decision.market?.id || "",
              question: decision.market?.question || "",
              slug: decision.market?.slug || "",
              side: "BUY",
              entryPrice: decision.price!,
              size: decision.size!,
              amount: decision.price! * decision.size!,
              tokenId: decision.tokenId!,
              openedAt: new Date().toISOString(),
              status: "open",
              category: opportunities[0].category,
            });
          } else {
            console.log(`❌ Trade failed: ${result.error}`);
          }
        } else {
          console.log(`\n🤖 AI Decision: HOLD`);
          console.log(`   Reasoning: ${decision.reasoning}`);
        }
      }
    } else {
      console.log("⚠️ Max positions reached, skipping scan");
    }

    // Summary
    console.log(`\n📊 Cycle Summary:`);
    console.log(`   Scans: ${totalScans} | Trades: ${totalTrades}`);
    console.log(`   Positions: ${service.getOpenPositions().length}/${MAX_POSITIONS}`);

  } catch (error: any) {
    console.error(`❌ Cycle error: ${error.message}`);
  }
}

/**
 * Make a trade decision using ElizaOS AI
 */
async function makeTradeDecision(opportunity: any): Promise<any> {
  if (!runtime) {
    return { shouldTrade: false, action: "HOLD", reasoning: "Runtime not initialized", confidence: 0 };
  }

  const { market, spread, midpoint, score, category, tokenId } = opportunity;

  // Simple scoring logic (can be enhanced with LLM call)
  let shouldTrade = false;
  let confidence = 0;
  let reasoning = "";

  if (score >= 0.8 && spread <= 0.03) {
    shouldTrade = true;
    confidence = 85;
    reasoning = `Excellent opportunity: ${(spread * 100).toFixed(1)}% spread, score ${score.toFixed(2)}`;
  } else if (score >= 0.7 && spread <= 0.05) {
    shouldTrade = true;
    confidence = 70;
    reasoning = `Good opportunity: ${(spread * 100).toFixed(1)}% spread, score ${score.toFixed(2)}`;
  } else if (score >= 0.6 && spread <= 0.08) {
    const openCount = (runtime.getService("polymarket") as PolymarketService).getOpenPositions().length;
    shouldTrade = openCount < 10;
    confidence = 55;
    reasoning = `Moderate opportunity, portfolio has room`;
  } else {
    shouldTrade = false;
    confidence = 40;
    reasoning = `Spread too wide (${(spread * 100).toFixed(1)}%) or score too low (${score.toFixed(2)})`;
  }

  // Calculate trade size
  const tradeAmount = category === "elon" ? 20 : 2; // $20 for Elon, $2 for others
  const size = tradeAmount / midpoint;

  return {
    shouldTrade,
    action: shouldTrade ? "BUY" : "HOLD",
    market,
    tokenId,
    price: midpoint,
    size,
    reasoning,
    confidence,
  };
}

/**
 * Check positions for TP/SL
 */
async function checkPositionsTPSL(service: PolymarketService): Promise<void> {
  const positions = service.getOpenPositions();
  
  for (const position of positions) {
    try {
      // Get current price (simplified - would need actual price fetch)
      const currentPrice = position.entryPrice; // TODO: fetch actual price
      
      const pnlPercent = ((currentPrice - position.entryPrice) / position.entryPrice) * 100;
      
      if (pnlPercent >= TAKE_PROFIT_PERCENT) {
        console.log(`📈 TP hit for ${position.question.slice(0, 30)}... (+${pnlPercent.toFixed(1)}%)`);
        // Place sell order
        await service.placeSellOrder(position.tokenId, currentPrice, position.size);
        service.closePosition(position.id, currentPrice, "Take Profit");
      } else if (pnlPercent <= -STOP_LOSS_PERCENT) {
        console.log(`📉 SL hit for ${position.question.slice(0, 30)}... (${pnlPercent.toFixed(1)}%)`);
        await service.placeSellOrder(position.tokenId, currentPrice, position.size);
        service.closePosition(position.id, currentPrice, "Stop Loss");
      }
    } catch (error: any) {
      console.error(`Error checking position ${position.id}: ${error.message}`);
    }
  }
}

/**
 * Start the autonomy loop
 */
export async function startAutonomy(): Promise<void> {
  if (autonomyRunning) {
    console.log("⚠️ Autonomy already running");
    return;
  }

  if (!runtime) {
    await initializeRuntime();
  }

  autonomyEnabled = true;
  autonomyRunning = true;

  console.log(`
╔════════════════════════════════════════════════════════════════════════╗
║                    ElizaBAO AUTONOMY v2.0.0                            ║
╠════════════════════════════════════════════════════════════════════════╣
║  🤖 ElizaOS Runtime: Active                                            ║
║  📦 Plugin: @elizabao/plugin-polymarket                                ║
║  ⏰ Interval: ${(AUTONOMY_INTERVAL_MS / 1000).toString().padEnd(4)}s                                                     ║
║  🎯 TP: +${TAKE_PROFIT_PERCENT}% | SL: -${STOP_LOSS_PERCENT}%                                                ║
║  📊 Max Positions: ${MAX_POSITIONS} | Max Elon: ${MAX_ELON_POSITIONS}                                       ║
╚════════════════════════════════════════════════════════════════════════╝
`);

  while (autonomyEnabled) {
    await executeAutonomyCycle();
    
    if (autonomyEnabled) {
      console.log(`\n⏳ Next cycle in ${AUTONOMY_INTERVAL_MS / 1000}s...`);
      await new Promise(r => setTimeout(r, AUTONOMY_INTERVAL_MS));
    }
  }

  autonomyRunning = false;
  console.log("🛑 Autonomy stopped");
}

/**
 * Stop the autonomy loop
 */
export function stopAutonomy(): void {
  autonomyEnabled = false;
  console.log("🛑 Stopping autonomy...");
}

/**
 * Get autonomy status
 */
export function getAutonomyStatus() {
  return {
    enabled: autonomyEnabled,
    running: autonomyRunning,
    totalScans,
    totalTrades,
    intervalMs: AUTONOMY_INTERVAL_MS,
    maxPositions: MAX_POSITIONS,
    takeProfitPercent: TAKE_PROFIT_PERCENT,
    stopLossPercent: STOP_LOSS_PERCENT,
  };
}

// CLI entry point
if (import.meta.main) {
  console.log("Starting ElizaBAO Autonomy v2.0.0...");
  startAutonomy().catch(console.error);

  // Handle shutdown
  process.on("SIGINT", () => {
    console.log("\n👋 Shutting down...");
    stopAutonomy();
    setTimeout(() => process.exit(0), 1000);
  });
}
