import "dotenv/config";
import { Hono } from "hono";
import { cors } from "hono/cors";
import { serve } from "@hono/node-server";
import { ethers } from "ethers";
import { ClobClient } from "@polymarket/clob-client";

const PORT = process.env.PORT || 3001;
const GAMMA_API_URL = "https://gamma-api.polymarket.com";
const ANTHROPIC_KEY = process.env.ANTHROPIC_API_KEY || "";
const PRIVATE_KEY = process.env.EVM_PRIVATE_KEY || "";
const WALLET_ADDRESS = process.env.WALLET_ADDRESS || "";
const CLOB_API_KEY = process.env.CLOB_API_KEY || "";
const CLOB_API_SECRET = process.env.CLOB_API_SECRET || "";
const CLOB_API_PASSPHRASE = process.env.CLOB_API_PASSPHRASE || "";

// Autonomy settings
let autonomyEnabled = false;
let autonomyIntervalMs = 60000;
let autoTradeEnabled = false;
const MAX_HISTORY = 50;
const MAX_TRADE_SIZE = 5;

// Memory storage
const tradeHistory: any[] = [];
const scanHistory: any[] = [];
let lastDecision: any = null;
let autonomyRunning = false;
let totalScans = 0;
let totalTrades = 0;

// Initialize CLOB client
let clobClient: ClobClient | null = null;

async function initClobClient() {
  if (clobClient) return clobClient;
  if (!PRIVATE_KEY || !CLOB_API_KEY) {
    console.log("⚠️ CLOB credentials not configured - trading disabled");
    return null;
  }
  const provider = new ethers.providers.JsonRpcProvider("https://polygon-rpc.com");
  const wallet = new ethers.Wallet(PRIVATE_KEY, provider);
  clobClient = new ClobClient(
    "https://clob.polymarket.com",
    137,
    wallet,
    { key: CLOB_API_KEY, secret: CLOB_API_SECRET, passphrase: CLOB_API_PASSPHRASE }
  );
  console.log("CLOB client initialized for wallet:", wallet.address);
  return clobClient;
}

async function fetchMarkets(limit = 50) {
  const url = `${GAMMA_API_URL}/markets?limit=${limit}&active=true&closed=false&order=volume24hr&ascending=false`;
  const res = await fetch(url);
  return res.json();
}

async function scanMarkets() {
  const markets = await fetchMarkets(100);
  const opps = [];
  for (const m of markets.slice(0, 50)) {
    let yesPrice = 0.5;
    try { yesPrice = parseFloat(JSON.parse(m.outcomePrices)[0]); } catch {}
    if (m.liquidityNum < 100 || yesPrice < 0.05 || yesPrice > 0.95) continue;
    const score = (1 - Math.abs(yesPrice - 0.5) * 2) * 0.5 + Math.min(1, m.volume24hr / 500000) * 0.5;
    opps.push({ 
      id: m.id, 
      question: m.question, 
      slug: m.slug,
      yesPrice, 
      volume24h: m.volume24hr || 0, 
      liquidity: m.liquidityNum || 0, 
      score,
      clobTokenIds: m.clobTokenIds
    });
  }
  opps.sort((a, b) => b.score - a.score);
  return opps.slice(0, 10);
}

async function callClaude(prompt: string): Promise<string> {
  if (!ANTHROPIC_KEY) throw new Error("ANTHROPIC_API_KEY not configured");
  const response = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": ANTHROPIC_KEY,
      "anthropic-version": "2023-06-01",
    },
    body: JSON.stringify({
      model: "claude-sonnet-4-20250514",
      max_tokens: 500,
      messages: [{ role: "user", content: prompt }],
    }),
  });
  if (!response.ok) throw new Error(`Claude API error: ${response.status}`);
  const data = await response.json();
  return data.content?.[0]?.text || "";
}

async function executeTrade(market: any, side: "BUY" | "SELL", amount: number) {
  if (!autoTradeEnabled) {
    console.log(`⚠️ Auto-trade disabled. Would ${side} $${amount} on "${market.question}"`);
    return { success: false, reason: "Auto-trade disabled", simulated: true };
  }
  
  try {
    const client = await initClobClient();
    if (!client) throw new Error("CLOB client not initialized");
    const tokenId = market.clobTokenIds?.[0];
    if (!tokenId) throw new Error("No token ID found");
    
    const price = side === "BUY" ? market.yesPrice + 0.01 : market.yesPrice - 0.01;
    const size = amount / price;
    
    console.log(`🔄 Executing ${side}: $${amount} on "${market.question}" at ${price}`);
    
    const order = await client.createOrder({
      tokenID: tokenId,
      price: price,
      size: size,
      side: side,
    });
    
    const result = await client.postOrder(order);
    console.log(`✅ Trade executed:`, result);
    
    totalTrades++;
    return { success: true, order: result };
  } catch (e: any) {
    console.error(`❌ Trade failed:`, e.message);
    return { success: false, error: e.message };
  }
}

async function analyzeWithAI(opps: any[], risk: string) {
  if (opps.length === 0) return { shouldTrade: false, action: "HOLD", market: null, reasoning: "No opportunities", confidence: 0 };
  
  const recentDecisions = tradeHistory.slice(-5).map(t => 
    `- ${t.action} on "${t.market?.question?.slice(0,40) || 'N/A'}" (${t.timestamp})`
  ).join("\n");
  
  const summary = opps.slice(0, 5).map((o, i) => 
    `${i + 1}. "${o.question}" - Price: ${(o.yesPrice * 100).toFixed(1)}%, Volume: $${(o.volume24h/1000).toFixed(0)}K`
  ).join("\n");
  
  const prompt = `You are Poly, an AI trading agent for Polymarket prediction markets.

Risk Level: ${risk}
Total Scans: ${totalScans} | Total Trades: ${totalTrades}
Wallet: ${WALLET_ADDRESS}
Auto-Trade: ${autoTradeEnabled ? "ENABLED" : "DISABLED (simulation only)"}

MEMORY - Recent Decisions:
${recentDecisions || "No previous decisions"}

CURRENT OPPORTUNITIES:
${summary}

TASK: Analyze these markets and decide if we should trade.
- Consider prices near 50% as uncertain (good opportunity)
- Higher volume = more reliable
- Use memory to avoid repeating bad trades

Respond in this format:
ACTION: [BUY/HOLD]
MARKET: [number 1-5 or NONE]
CONFIDENCE: [0-100]
REASONING: [brief explanation]`;

  try {
    const response = await callClaude(prompt);
    const actionMatch = response.match(/ACTION:\s*(BUY|HOLD|SELL)/i);
    const marketMatch = response.match(/MARKET:\s*(\d|NONE)/i);
    const confidenceMatch = response.match(/CONFIDENCE:\s*(\d+)/i);
    const reasoningMatch = response.match(/REASONING:\s*(.+)/is);
    
    const action = actionMatch?.[1]?.toUpperCase() || "HOLD";
    const shouldTrade = action === "BUY" || action === "SELL";
    const marketIdx = marketMatch?.[1] === "NONE" ? -1 : parseInt(marketMatch?.[1] || "0") - 1;
    const confidence = parseInt(confidenceMatch?.[1] || "50");
    const reasoning = reasoningMatch?.[1]?.trim().slice(0, 400) || response.slice(0, 400);
    const market = shouldTrade && marketIdx >= 0 && marketIdx < opps.length ? opps[marketIdx] : null;
    
    return { shouldTrade: shouldTrade && market !== null, action, market, reasoning, confidence };
  } catch (e) {
    console.error("Claude error:", e);
    return { shouldTrade: false, action: "HOLD", market: null, reasoning: String(e), confidence: 0 };
  }
}

async function autonomyLoop() {
  if (autonomyRunning) return;
  autonomyRunning = true;
  console.log("🤖 Autonomy loop started!");
  
  while (autonomyEnabled) {
    try {
      console.log(`\n🔄 [${new Date().toISOString()}] Autonomous scan #${totalScans + 1}...`);
      const opps = await scanMarkets();
      totalScans++;
      
      scanHistory.push({ timestamp: new Date().toISOString(), opportunities: opps.length, top: opps[0]?.question?.slice(0, 50) });
      if (scanHistory.length > MAX_HISTORY) scanHistory.shift();
      
      const decision = await analyzeWithAI(opps, "moderate");
      lastDecision = { ...decision, timestamp: new Date().toISOString(), scanNumber: totalScans };
      
      tradeHistory.push(lastDecision);
      if (tradeHistory.length > MAX_HISTORY) tradeHistory.shift();
      
      if (decision.shouldTrade && decision.confidence >= 70) {
        const tradeResult = await executeTrade(decision.market, decision.action as "BUY" | "SELL", MAX_TRADE_SIZE);
        lastDecision.tradeResult = tradeResult;
        console.log(`✅ Trade signal: ${decision.action} on "${decision.market?.question?.slice(0, 40)}..."`);
        console.log(`   Confidence: ${decision.confidence}% | Result: ${tradeResult.success ? "Executed" : "Simulated"}`);
      } else {
        console.log(`⏸️ Hold - ${decision.reasoning?.slice(0, 80)}...`);
      }
      console.log(`📊 Stats: ${totalScans} scans, ${totalTrades} trades`);
    } catch (error) {
      console.error("Autonomy error:", error);
    }
    await new Promise(r => setTimeout(r, autonomyIntervalMs));
  }
  autonomyRunning = false;
  console.log("🛑 Autonomy loop stopped.");
}

const app = new Hono();

app.use("*", cors({ origin: "*", allowMethods: ["GET", "POST", "OPTIONS"], allowHeaders: ["Content-Type", "Authorization"] }));
app.options("*", (c) => c.text("", 204, { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Methods": "GET, POST, OPTIONS", "Access-Control-Allow-Headers": "Content-Type, Authorization" }));

app.get("/", (c) => c.json({ 
  status: "ok", 
  llm: "claude-sonnet-4", 
  wallet: WALLET_ADDRESS,
  clobConfigured: !!CLOB_API_KEY,
  autoTradeEnabled,
  autonomy: { enabled: autonomyEnabled, running: autonomyRunning, intervalMs: autonomyIntervalMs },
  stats: { totalScans, totalTrades },
  features: { advancedMemory: true, autonomy: true, liveTrading: true } 
}));

app.get("/api/status", (c) => c.json({ 
  success: true, 
  data: { 
    llm: "claude-sonnet-4",
    wallet: WALLET_ADDRESS,
    clobConfigured: !!CLOB_API_KEY,
    autoTradeEnabled,
    autonomy: { enabled: autonomyEnabled, running: autonomyRunning, intervalMs: autonomyIntervalMs },
    totalScans, totalTrades,
    lastDecision: lastDecision?.timestamp,
  } 
}));

app.get("/api/wallet", async (c) => {
  try {
    const provider = new ethers.providers.JsonRpcProvider("https://polygon-rpc.com");
    
    // Get POL balance
    const polBalance = await provider.getBalance(WALLET_ADDRESS);
    const polFormatted = ethers.utils.formatEther(polBalance);
    
    // Get USDC balance (Polygon USDC contract)
    const usdcContract = new ethers.Contract(
      "0x3c499c542cEF5E3811e1192ce70d8cC03d5c3359",
      ["function balanceOf(address) view returns (uint256)"],
      provider
    );
    const usdcBalance = await usdcContract.balanceOf(WALLET_ADDRESS);
    const usdcFormatted = ethers.utils.formatUnits(usdcBalance, 6);
    
    return c.json({
      success: true,
      data: {
        address: WALLET_ADDRESS,
        pol: { balance: polFormatted, symbol: "POL" },
        usdc: { balance: usdcFormatted, symbol: "USDC" },
      }
    });
  } catch (e: any) {
    return c.json({ success: false, error: e.message }, 500);
  }
});

app.post("/api/autonomy/start", async (c) => {
  const body = await c.req.json().catch(() => ({}));
  if (body.intervalMs) autonomyIntervalMs = Math.max(30000, body.intervalMs);
  if (body.autoTrade !== undefined) autoTradeEnabled = body.autoTrade;
  if (autonomyEnabled) return c.json({ success: true, message: "Already running", data: { enabled: true, running: autonomyRunning } });
  autonomyEnabled = true;
  autonomyLoop();
  console.log("🟢 Autonomy STARTED");
  return c.json({ success: true, message: "Autonomy started", data: { enabled: true, intervalMs: autonomyIntervalMs, autoTradeEnabled } });
});

app.post("/api/autonomy/stop", async (c) => {
  autonomyEnabled = false;
  console.log("🔴 Autonomy STOPPED");
  return c.json({ success: true, message: "Autonomy stopping...", data: { enabled: false } });
});

app.get("/api/autonomy/status", (c) => c.json({
  success: true,
  data: { enabled: autonomyEnabled, running: autonomyRunning, intervalMs: autonomyIntervalMs, autoTradeEnabled, totalScans, totalTrades, lastDecision }
}));

app.post("/api/trade/enable", async (c) => {
  autoTradeEnabled = true;
  console.log("💰 Auto-trade ENABLED");
  return c.json({ success: true, message: "Auto-trade enabled", data: { autoTradeEnabled } });
});

app.post("/api/trade/disable", async (c) => {
  autoTradeEnabled = false;
  console.log("🔒 Auto-trade DISABLED");
  return c.json({ success: true, message: "Auto-trade disabled", data: { autoTradeEnabled } });
});

app.post("/api/trade/execute", async (c) => {
  const body = await c.req.json();
  if (!body.marketId || !body.side || !body.amount) {
    return c.json({ success: false, error: "marketId, side, and amount required" }, 400);
  }
  const markets = await fetchMarkets(100);
  const market = markets.find((m: any) => m.id === body.marketId);
  if (!market) return c.json({ success: false, error: "Market not found" }, 404);
  
  let yesPrice = 0.5;
  try { yesPrice = parseFloat(JSON.parse(market.outcomePrices)[0]); } catch {}
  
  const result = await executeTrade(
    { ...market, yesPrice, clobTokenIds: market.clobTokenIds },
    body.side.toUpperCase(),
    Math.min(body.amount, MAX_TRADE_SIZE)
  );
  return c.json({ success: true, data: result });
});

app.get("/api/history", (c) => c.json({
  success: true,
  data: { trades: tradeHistory.slice(-20), scans: scanHistory.slice(-20), totalScans, totalTrades }
}));

app.get("/api/latest", (c) => c.json({ success: true, data: { lastDecision, totalScans, totalTrades } }));

app.post("/api/scan", async (c) => {
  const opps = await scanMarkets();
  return c.json({ success: true, data: { opportunities: opps } });
});

app.post("/api/analyze", async (c) => {
  const body = await c.req.json().catch(() => ({}));
  const opps = await scanMarkets();
  const decision = await analyzeWithAI(opps, body.riskLevel || "moderate");
  return c.json({ success: true, data: { llm: "claude-sonnet-4", wallet: WALLET_ADDRESS, autoTradeEnabled, autonomy: { enabled: autonomyEnabled, running: autonomyRunning }, topOpportunities: opps.slice(0, 5), aiDecision: decision, stats: { totalScans, totalTrades } } });
});

app.post("/api/search", async (c) => {
  const body = await c.req.json();
  const q = (body.query || "").toLowerCase();
  if (!q) return c.json({ success: false, error: "Query required" }, 400);
  const markets = await fetchMarkets(100);
  const filtered = markets.filter((m: any) => m.question?.toLowerCase().includes(q)).slice(0, 10).map((m: any) => {
    let yesPrice = 0.5; try { yesPrice = parseFloat(JSON.parse(m.outcomePrices)[0]); } catch {}
    return { id: m.id, question: m.question, slug: m.slug, yesPrice, volume24h: m.volume24hr || 0, clobTokenIds: m.clobTokenIds };
  });
  return c.json({ success: true, data: { query: q, markets: filtered } });
});

app.post("/api/chat", async (c) => {
  const body = await c.req.json();
  if (!body.message) return c.json({ success: false, error: "Message required" }, 400);
  try {
    const reply = await callClaude(body.message);
    return c.json({ success: true, data: { reply } });
  } catch (e) {
    return c.json({ success: false, error: String(e) }, 500);
  }
});

// Initialize CLOB on startup
initClobClient().then(() => console.log("CLOB ready")).catch(console.error);

console.log(`
╔════════════════════════════════════════════════════════════════════╗
║          POLYMARKET AGENT - LIVE TRADING ENABLED                   ║
╠════════════════════════════════════════════════════════════════════╣
║  🧠 Claude Sonnet 4: ${ANTHROPIC_KEY ? "configured" : "NOT CONFIGURED"}                              ║
║  💰 Wallet: ${WALLET_ADDRESS || "NOT CONFIGURED"}            ║
║  📊 CLOB API: ${CLOB_API_KEY ? "configured" : "NOT CONFIGURED"}                                      ║
║  🔄 Autonomy: controllable via API                                 ║
║  ⚠️  Auto-trade: ${autoTradeEnabled ? "ENABLED" : "DISABLED (call /api/trade/enable)"}                         ║
╚════════════════════════════════════════════════════════════════════╝
`);

serve({ fetch: app.fetch, port: Number(PORT), hostname: "0.0.0.0" });
console.log(`Server running on http://0.0.0.0:${PORT}`);
