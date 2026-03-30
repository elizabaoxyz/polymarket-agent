/**
 * Bun WebSocket server for the Polymarket trading agent.
 * Single-instance mode: reads API keys from environment variables.
 *
 * Usage: bun run ws-server.ts
 * Set API keys via environment variables (Railway, .env, etc.)
 */

process.env.LOG_LEVEL = process.env.LOG_LEVEL || "fatal";

import path from "node:path";
import { fileURLToPath } from "node:url";
import dotenv from "dotenv";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.join(__dirname, ".env") });

import {
  AgentRuntime,
  ChannelType,
  createCharacter,
  createMessageMemory,
  stringToUuid,
  type Content,
} from "@elizaos/core";
import polymarketPlugin from "@elizaos/plugin-polymarket";
import sqlPlugin from "@elizaos/plugin-sql";
import { v4 as uuidv4 } from "uuid";

import {
  buildLlmPlugins,
  buildLlmRuntimeSettings,
  loadEnvConfig,
  parseArgs,
  resolveLlmProviderFromEnv,
} from "./lib";
import { polymarketExtPlugin } from "./plugins/polymarket-ext/index";
import { PolymarketExtService } from "./plugins/polymarket-ext/service";
import { POLYMARKET_EXT_SERVICE_TYPE } from "./plugins/polymarket-ext/types";
import { jupiterPredictionPlugin } from "./plugins/jupiter-prediction/index";
import { JupiterPredictionService, JUPITER_SERVICE_TYPE } from "./plugins/jupiter-prediction/service";
import { x402SolanaPlugin } from "./plugins/x402-solana/index";
import { X402SolanaService } from "./plugins/x402-solana/service";
import { X402_SERVICE_TYPE } from "./plugins/x402-solana/types";

const WS_PORT = Number(process.env.PORT ?? process.env.WS_PORT ?? 3001);
const DEFAULT_ROOM_ID = stringToUuid("web-chat-room");
const DEFAULT_WORLD_ID = stringToUuid("web-chat-world");
const DEFAULT_USER_ID = stringToUuid("web-chat-user");

const BROKEN_POLYMARKET_ACTIONS = [
  "POLYMARKET_PLACE_ORDER",
  "POLYMARKET_GET_MARKETS",
  "POLYMARKET_GET_TOKEN_INFO",
  "POLYMARKET_GET_ORDER_BOOK_DEPTH",
];

function buildCharacter() {
  return createCharacter({
    name: "Eliza",
    username: "eliza",
    bio: [
      "Eliza v2 — autonomous trading agent for Polymarket and Jupiter Prediction Markets.",
      "Executes trades via actions. Authorized to trade.",
    ],
    adjectives: ["action-oriented", "decisive", "direct"],
    style: { all: ["Keep responses short and operational"], chat: ["Be concise"] },
    messageExamples: [
      [
        { user: "{{user1}}", content: { text: "buy $3 YES on Will Gavin Newsom win the Democratic nomination" } },
        { user: "Eliza", content: { text: "Placing $3 YES on Gavin Newsom.", action: "POLYMARKET_PLACE_ORDER" } },
      ],
      [
        { user: "{{user1}}", content: { text: "place a $5 bet on something interesting" } },
        { user: "Eliza", content: { text: "Placing $5 bet.", action: "POLYMARKET_PLACE_ORDER" } },
      ],
      [
        { user: "{{user1}}", content: { text: "show my positions" } },
        { user: "Eliza", content: { text: "Fetching positions.", action: "POLYMARKET_GET_POSITIONS" } },
      ],
      [
        { user: "{{user1}}", content: { text: "cancel all my orders" } },
        { user: "Eliza", content: { text: "Cancelling all orders.", action: "POLYMARKET_CANCEL_ALL" } },
      ],
      [
        { user: "{{user1}}", content: { text: "show my PnL" } },
        { user: "Eliza", content: { text: "Fetching PnL.", action: "POLYMARKET_GET_PNL" } },
      ],
    ],
    templates: {
      messageHandlerTemplate: `<task>Generate dialog and actions for {{agentName}}.</task>
<providers>{{providers}}</providers>
<instructions>
{{agentName}} is a trading agent. When the user asks to place a bet, buy, sell, cancel, check positions, trades, or PnL, you MUST select the appropriate action. Do NOT just reply with text describing what you would do — actually select the action.

ACTION SELECTION IS MANDATORY for trading requests. Always include TWO separate action elements:
1. First action: REPLY (to acknowledge)
2. Second action: the trading action

If the user wants to trade but hasn't specified YES/NO or a market, pick one yourself — you are authorized.

ROUTING RULES — Polymarket vs Jupiter:
- DEFAULT: Use POLYMARKET_PLACE_ORDER for all bets unless user says "jupiter" or "solana"
- If user says "jupiter" or "solana" → use PLACE_JUPITER_BET, SCAN_JUPITER_MARKETS, etc.
- If user says "polymarket" or just "bet/buy/trade" → use POLYMARKET_PLACE_ORDER
- Polymarket = Polygon chain, Jupiter = Solana chain

RESPONSE FORMAT — each action is a SEPARATE element:
<example_response>
  <thought>User wants to bet.</thought>
  <actions>
    <action><name>REPLY</name></action>
    <action><name>POLYMARKET_PLACE_ORDER</name></action>
  </actions>
  <providers></providers>
  <text>Placing bet now.</text>
</example_response>
</instructions>
{{actionsWithDescriptions}}
{{messageExamples}}
{{recentMessages}}`,
    },
  });
}

async function createRuntime() {
  const { options } = parseArgs(["chat", "--execute"]);
  const config = loadEnvConfig(options);
  const character = buildCharacter();
  const llmProvider = resolveLlmProviderFromEnv();
  const llmPlugins = buildLlmPlugins(llmProvider);

  const runtime = new AgentRuntime({
    character,
    plugins: [
      sqlPlugin,
      {
        ...polymarketPlugin,
        actions: (polymarketPlugin.actions ?? []).filter(
          (a: { name?: string }) => !BROKEN_POLYMARKET_ACTIONS.includes(a.name ?? ""),
        ),
      },
      polymarketExtPlugin,
      jupiterPredictionPlugin,
      x402SolanaPlugin,
      ...llmPlugins,
    ],
    settings: {
      ...buildLlmRuntimeSettings(llmProvider),
      EVM_PRIVATE_KEY: config.privateKey,
      POLYMARKET_PRIVATE_KEY: config.privateKey,
      CLOB_API_URL: config.clobApiUrl,
      ...(config.creds
        ? {
            CLOB_API_KEY: config.creds.key,
            CLOB_API_SECRET: config.creds.secret,
            CLOB_API_PASSPHRASE: config.creds.passphrase,
          }
        : {}),
    },
    logLevel: "error",
    enableAutonomy: true,
    actionPlanning: true,
    checkShouldRespond: false,
  });

  await runtime.initialize();

  try {
    const x402Svc = (await runtime.getServiceLoadPromise(X402_SERVICE_TYPE)) as X402SolanaService | null;
    if (x402Svc && x402Svc.isActive()) {
      globalThis.fetch = x402Svc.getWrappedFetch();
    }
  } catch {}

  await runtime.ensureConnection({
    entityId: DEFAULT_USER_ID,
    roomId: DEFAULT_ROOM_ID,
    worldId: DEFAULT_WORLD_ID,
    userName: "WebUser",
    source: "web-chat",
    channelId: "web",
    serverId: "web-server",
    type: ChannelType.DM,
  } as Parameters<typeof runtime.ensureConnection>[0]);

  return runtime;
}

// Cache Solana balance to avoid RPC 429s
let _solanaBalanceCache = { value: 0, fetchedAt: 0 };
const SOLANA_CACHE_TTL = 60_000; // 60 seconds

async function getCachedSolanaBalance(): Promise<number> {
  if (Date.now() - _solanaBalanceCache.fetchedAt < SOLANA_CACHE_TTL) {
    return _solanaBalanceCache.value;
  }
  try {
    const solKey = process.env.SOLANA_PRIVATE_KEY?.trim();
    if (!solKey) return 0;
    const { Keypair, Connection, PublicKey } = await import("@solana/web3.js");
    const bs58 = await import("bs58");
    const kp = Keypair.fromSecretKey(bs58.default.decode(solKey));
    const conn = new Connection(process.env.SOLANA_RPC_URL ?? "https://api.mainnet-beta.solana.com", "confirmed");
    const USDC_MINT = new PublicKey("EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v");
    const accounts = await conn.getTokenAccountsByOwner(kp.publicKey, { mint: USDC_MINT });
    if (accounts.value.length > 0) {
      const info = await conn.getTokenAccountBalance(accounts.value[0].pubkey);
      _solanaBalanceCache = { value: Number(info.value.uiAmount ?? 0), fetchedAt: Date.now() };
      return _solanaBalanceCache.value;
    }
  } catch {}
  return _solanaBalanceCache.value;
}

async function getPortfolioStatus(runtime: AgentRuntime) {
  try {
    const svc = (await runtime.getServiceLoadPromise(POLYMARKET_EXT_SERVICE_TYPE)) as PolymarketExtService;
    if (!svc || !svc.walletAddress) return { balance: 0, positions: [], trades: [] };
    const [positions, trades] = await Promise.all([
      svc.data.getPositions(svc.walletAddress).catch(() => []),
      svc.data.getTrades(svc.walletAddress, { limit: 20 }).catch(() => []),
    ]);
    let balance = 0;
    if (svc.clob) {
      try {
        const { createHmac } = await import("node:crypto");
        const address = svc.clob.config.address;
        const secret = svc.clob.config.secret;
        const ts = String(Math.floor(Date.now() / 1000));
        const sig = createHmac("sha256", Buffer.from(secret, "base64"))
          .update(ts + "GET" + "/balance-allowance")
          .digest("base64")
          .replace(/\+/g, "-")
          .replace(/\//g, "_");
        const sigType = process.env.POLYMARKET_SIGNATURE_TYPE ?? "1";
        const res = await fetch(
          `${svc.clob.config.baseUrl}/balance-allowance?asset_type=COLLATERAL&signature_type=${sigType}`,
          {
            headers: {
              POLY_ADDRESS: address,
              POLY_API_KEY: svc.clob.config.apiKey,
              POLY_PASSPHRASE: svc.clob.config.passphrase,
              POLY_TIMESTAMP: ts,
              POLY_SIGNATURE: sig,
            },
          },
        );
        const data = await res.json();
        balance = Number(data.balance ?? 0) / 1_000_000;
      } catch {}
    }
    // Fetch Jupiter positions
    let jupiterPositions: Array<{
      marketId: string; isYes: boolean; contracts: string;
      sizeUsd: string; valueUsd: string; avgPriceUsd: string; markPriceUsd: string;
      pnlUsd: string; pnlUsdPercent: number; eventTitle: string; marketTitle: string;
    }> = [];
    try {
      const jupApiKey = process.env.JUPITER_API_KEY?.trim();
      const solKey = process.env.SOLANA_PRIVATE_KEY?.trim();
      if (jupApiKey && solKey) {
        const { Keypair } = await import("@solana/web3.js");
        const bs58 = await import("bs58");
        const kp = Keypair.fromSecretKey(bs58.default.decode(solKey));
        const jupRes = await fetch(
          `https://api.jup.ag/prediction/v1/positions?ownerPubkey=${kp.publicKey.toBase58()}`,
          { headers: { "x-api-key": jupApiKey } },
        );
        if (jupRes.ok) {
          const jupData = await jupRes.json();
          jupiterPositions = (jupData.data ?? []).map((p: Record<string, unknown>) => ({
            marketId: p.marketId,
            isYes: p.isYes,
            contracts: p.contracts,
            sizeUsd: p.sizeUsd,
            valueUsd: p.valueUsd,
            avgPriceUsd: p.avgPriceUsd,
            markPriceUsd: p.markPriceUsd,
            pnlUsd: p.pnlUsd,
            pnlUsdPercent: p.pnlUsdPercent,
            eventTitle: (p.eventMetadata as Record<string, string>)?.title ?? "",
            marketTitle: (p.marketMetadata as Record<string, string>)?.title ?? "",
          }));
        }
      }
    } catch {}

    // Fetch Solana USDC balance (cached for 60s to avoid RPC rate limits)
    const solanaBalance = await getCachedSolanaBalance();

    // x402 payment stats
    let x402 = { active: false, payments: 0, totalUsd: 0 };
    try {
      const x402Svc = (await runtime.getServiceLoadPromise(X402_SERVICE_TYPE)) as X402SolanaService | null;
      if (x402Svc) {
        const stats = x402Svc.getPaymentStats();
        x402 = { active: x402Svc.isActive(), payments: stats.count, totalUsd: stats.totalUsd };
      }
    } catch {}

    return { balance, solanaBalance, positions, trades, jupiterPositions, x402 };
  } catch {
    return { balance: 0, solanaBalance: 0, positions: [], trades: [], jupiterPositions: [], x402: { active: false, payments: 0, totalUsd: 0 } };
  }
}

async function main() {
  console.log("ws-server: initializing runtime...");
  const runtime = await createRuntime();
  const messageService = runtime.messageService;
  if (!messageService) {
    throw new Error("Message service not initialized");
  }
  console.log("ws-server: runtime ready");

  let autonomyTimer: ReturnType<typeof setInterval> | null = null;
  let autonomyHeartbeatTimer: ReturnType<typeof setInterval> | null = null;

  const cleanupHeartbeat = () => {
    if (autonomyHeartbeatTimer) {
      clearInterval(autonomyHeartbeatTimer);
      autonomyHeartbeatTimer = null;
    }
  };

  const server = Bun.serve({
    port: WS_PORT,
    fetch(req, server) {
      const url = new URL(req.url);
      if (req.method === "OPTIONS") {
        return new Response(null, {
          headers: {
            "Access-Control-Allow-Origin": "*",
            "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
            "Access-Control-Allow-Headers": "*",
          },
        });
      }
      if (url.pathname === "/health") {
        return Response.json({ status: "ok" });
      }
      if (server.upgrade(req)) return undefined;
      return new Response("Not Found", { status: 404 });
    },
    websocket: {
      open(ws) {
        console.log("ws-server: client connected");
      },
      close(ws) {
        console.log("ws-server: client disconnected");
        // Autonomy keeps running — only stops when user explicitly clicks AUTONOMY OFF
        // Heartbeat also keeps running to protect GTC orders
      },
      async message(ws, raw) {
        let msg: { type: string; text?: string };
        try {
          msg = JSON.parse(String(raw));
        } catch {
          ws.send(JSON.stringify({ type: "error", text: "Invalid JSON" }));
          return;
        }

        if (msg.type === "get_status") {
          const status = await getPortfolioStatus(runtime);
          ws.send(JSON.stringify({ type: "status", ...status }));
          return;
        }

        if (msg.type === "message" && typeof msg.text === "string") {
          ws.send(JSON.stringify({ type: "thinking", active: true }));

          const memory = createMessageMemory({
            id: uuidv4() as ReturnType<typeof stringToUuid>,
            entityId: DEFAULT_USER_ID,
            roomId: DEFAULT_ROOM_ID,
            content: {
              text: msg.text,
              source: "web-chat",
              channelType: ChannelType.DM,
            },
          });

          try {
            await messageService.handleMessage(
              runtime,
              memory,
              async (content: Content) => {
                if (typeof content.text === "string" && content.text.trim()) {
                  ws.send(JSON.stringify({ type: "action_result", text: content.text.trim() }));
                }
                return [];
              },
              {} as never,
            );
          } catch (err) {
            const errMsg = err instanceof Error ? err.message : String(err);
            ws.send(JSON.stringify({ type: "error", text: errMsg }));
          }

          try { ws.send(JSON.stringify({ type: "thinking", active: false })); } catch {}
          return;
        }

        // Autonomy toggle
        if (msg.type === "start_autonomy") {
          if (autonomyTimer) {
            ws.send(JSON.stringify({ type: "autonomy_status", active: true }));
            return;
          }
          console.log("ws-server: autonomy started");
          ws.send(JSON.stringify({ type: "autonomy_status", active: true }));

          // Ensure x402 payment protocol is active for Jupiter/Solana API calls
          try {
            const x402Svc = (await runtime.getServiceLoadPromise(X402_SERVICE_TYPE)) as X402SolanaService | null;
            if (x402Svc && x402Svc.isActive()) {
              globalThis.fetch = x402Svc.getWrappedFetch();
              ws.send(JSON.stringify({ type: "action_result", text: `[AUTONOMY] x402 payments active — cap: $${x402Svc.getMaxPaymentUsd().toFixed(2)}/request | Jupiter + Solana APIs covered` }));
            } else {
              ws.send(JSON.stringify({ type: "action_result", text: "[AUTONOMY] x402 payments disabled — set SOLANA_PRIVATE_KEY + X402_ENABLED=true to enable" }));
            }
          } catch {}

          // Start heartbeat — keeps GTC limit orders alive while autonomous
          try {
            const extSvc = (await runtime.getServiceLoadPromise(POLYMARKET_EXT_SERVICE_TYPE)) as PolymarketExtService;
            if (extSvc?.clob) {
              extSvc.clob.resetHeartbeat();
              extSvc.clob.heartbeat().catch(() => {});
              autonomyHeartbeatTimer = setInterval(() => {
                extSvc.clob!.heartbeat().catch((err) => {
                  const errMsg = err instanceof Error ? err.message : String(err);
                  console.warn(`ws-server: heartbeat failed: ${errMsg}`);
                });
              }, 10_000); // Every 10s — Polymarket cancels orders if no heartbeat within 10s
              ws.send(JSON.stringify({ type: "action_result", text: "[AUTONOMY] Heartbeat started — GTC orders protected" }));
            }
          } catch {}

          // Helper to send a prompt and collect the action results
          const sendPrompt = async (prompt: string): Promise<string[]> => {
            const results: string[] = [];
            const mem = createMessageMemory({
              id: uuidv4() as ReturnType<typeof stringToUuid>,
              entityId: DEFAULT_USER_ID,
              roomId: DEFAULT_ROOM_ID,
              content: { text: prompt, source: "web-chat", channelType: ChannelType.DM },
            });
            try {
              await messageService.handleMessage(runtime, mem, async (content: Content) => {
                if (typeof content.text === "string" && content.text.trim()) {
                  results.push(content.text.trim());
                  ws.send(JSON.stringify({ type: "action_result", text: content.text.trim() }));
                }
                return [];
              }, {} as never);
            } catch (err) {
              const errMsg = err instanceof Error ? err.message : String(err);
              try { ws.send(JSON.stringify({ type: "action_result", text: `[ERROR] ${errMsg}` })); } catch {}
            }
            return results;
          };

          const log = (text: string) => {
            try { ws.send(JSON.stringify({ type: "action_result", text })); } catch { /* client disconnected, autonomy continues */ }
            console.log(text); // Always log to server console
          };

          const MAX_POSITIONS = 50;
          let cycleCount = 0;
          const tradeHistory: Array<{ question: string; platform: string; time: number; price: number }> = [];
          // Skip lists — avoid retrying failed operations every cycle
          const failedSells = new Map<string, number>(); // pubkey/token → timestamp of failure
          const failedBuys = new Map<string, number>();  // marketId → timestamp of failure
          const recentlySold = new Set<string>(); // pubkeys successfully sold (API may lag)

          // Smart position sizing — bet more on high-conviction, less on risky
          // Enforces platform minimums: $3 Polymarket, $3 Jupiter
          const calcBetSize = (score: number, balance: number, minBet = 3): number => {
            const base = 3;
            let size: number;
            if (score > 0.9) size = Math.min(base * 2, balance * 0.1);
            else if (score > 0.7) size = Math.min(base * 1.5, balance * 0.08);
            else size = Math.min(base, balance * 0.05);
            return Math.max(minBet, size);
          };

          const runAutonomyCycle = async () => {
            cycleCount++;
            try { ws.send(JSON.stringify({ type: "thinking", active: true })); } catch {}
            const isPolymarketCycle = cycleCount % 2 === 1;
            const platform = isPolymarketCycle ? "POLYMARKET" : "JUPITER";

            try {
              log(`[AUTONOMY:${platform}] Cycle #${cycleCount} — ${isPolymarketCycle ? "Polygon" : "Solana + x402"}`);

              // Get balance first — determines sell aggressiveness
              const portfolioStatus = await getPortfolioStatus(runtime);
              const polyBalance = portfolioStatus.balance;
              const solBalance = portfolioStatus.solanaBalance;
              const lowPolyBalance = polyBalance < 3;
              const lowSolBalance = solBalance < 3;

              // Dynamic sell thresholds — more aggressive when balance is low
              const sellLossThreshold = (lowPolyBalance || lowSolBalance) ? -5 : -15;   // Cut at -5% when low, -15% normal
              const sellProfitThreshold = (lowPolyBalance || lowSolBalance) ? 5 : 25;    // Take at +5% when low, +25% normal

              // ===== Collect owned positions =====
              const ownedTitles = new Set<string>();
              const polySellTargets: Array<{ token: string; shares: number; title: string; pnl: number }> = [];
              const polyAllSellable: Array<{ token: string; shares: number; title: string; pnl: number }> = []; // All positions that CAN be sold
              const jupSellTargets: Array<{ marketId: string; pubkey: string; title: string; pnl: number }> = [];
              const jupClaimable: Array<{ pubkey: string; title: string; payout: number }> = [];

              try {
                const funder = process.env.POLYMARKET_FUNDER_ADDRESS?.trim();
                if (funder) {
                  const posRes = await fetch(`https://data-api.polymarket.com/positions?user=${funder}`);
                  if (posRes.ok) {
                    for (const pos of await posRes.json()) {
                      if (pos.title) ownedTitles.add(pos.title.toLowerCase());
                      const pnl = pos.percentPnl ?? 0;
                      const price = pos.curPrice ?? 0;
                      if (price < 0.02 || pos.redeemable) continue;
                      // Don't sell freshly bought positions (< 10 min old)
                      const recentlyBought = tradeHistory.some(
                        h => h.question.toLowerCase() === (pos.title ?? "").toLowerCase() && Date.now() - h.time < 600_000
                      );
                      if (recentlyBought) continue;
                      // Skip dead positions — no buyers at -95% or worse
                      if (pnl <= -95) continue;
                      // Don't sell at garbage prices — best bid must be > $0.05
                      if (price < 0.05) continue;
                      // Skip if sell failed recently (retry after 30 min)
                      const failTime = failedSells.get(pos.asset);
                      if (failTime && Date.now() - failTime < 1_800_000) continue;
                      // Track all sellable positions for force-sell when stuck
                      polyAllSellable.push({ token: pos.asset, shares: pos.size, title: pos.title, pnl });
                      if (pnl < sellLossThreshold || pnl > sellProfitThreshold) {
                        polySellTargets.push({ token: pos.asset, shares: pos.size, title: pos.title, pnl });
                      }
                    }
                  }
                }
              } catch {}

              try {
                const jupApiKey = process.env.JUPITER_API_KEY?.trim();
                const solKey = process.env.SOLANA_PRIVATE_KEY?.trim();
                if (jupApiKey && solKey) {
                  const { Keypair } = await import("@solana/web3.js");
                  const bs58 = await import("bs58");
                  const kp = Keypair.fromSecretKey(bs58.default.decode(solKey));
                  const posRes = await fetch(`https://api.jup.ag/prediction/v1/positions?ownerPubkey=${kp.publicKey.toBase58()}`, { headers: { "x-api-key": jupApiKey } });
                  if (posRes.ok) {
                    for (const pos of ((await posRes.json()).data ?? [])) {
                      const title = pos.eventMetadata?.title ?? pos.marketId ?? "";
                      if (title) ownedTitles.add(title.toLowerCase());
                      // Check if position is claimable (market settled in our favor)
                      if (pos.claimable === true && pos.claimed !== true && pos.pubkey) {
                        const payout = Number(pos.payoutUsd ?? 0) / 1_000_000;
                        jupClaimable.push({ pubkey: pos.pubkey, title: pos.marketMetadata?.title ?? pos.marketId, payout });
                        continue; // Don't also try to sell claimable positions
                      }
                      const pnl = pos.pnlUsdPercent ?? 0;
                      // Don't sell freshly bought positions (< 10 min old)
                      const recentJup = tradeHistory.some(
                        h => h.question.toLowerCase().includes((title).toLowerCase()) && Date.now() - h.time < 600_000
                      );
                      if (recentJup) continue;
                      if ((pnl < sellLossThreshold || pnl > sellProfitThreshold) && pos.pubkey) {
                        // Skip dead positions — no buyers at -95% or worse
                        if (pnl <= -95) continue;
                        // Skip if already sold (API lag) or failed recently (retry after 30 min)
                        if (recentlySold.has(pos.pubkey)) continue;
                        const jupFailTime = failedSells.get(pos.pubkey);
                        if (jupFailTime && Date.now() - jupFailTime < 1_800_000) continue;
                        jupSellTargets.push({ marketId: pos.marketId, pubkey: pos.pubkey, title: pos.marketMetadata?.title ?? pos.marketId, pnl });
                      }
                    }
                  }
                }
              } catch {}

              // ===== SELL PHASE — runs every cycle when balance is low =====
              if (isPolymarketCycle || lowPolyBalance) {
                // POLYMARKET SELL
                if (polySellTargets.length > 0) {
                  const sellList = polySellTargets.map((s, i) =>
                    `${i + 1}. "${s.title}" — PnL: ${s.pnl.toFixed(0)}%, shares: ${s.shares}`
                  ).join("\n");
                  if (lowPolyBalance) log(`[SELL MODE] Balance low ($${polyBalance.toFixed(2)}) — aggressive sell thresholds: -${Math.abs(sellLossThreshold)}% / +${sellProfitThreshold}%`);
                  log(`[SELL ANALYSIS] Analyzing ${polySellTargets.length} positions...`);
                  const sellAnalysis = await sendPrompt(
                    `DO NOT place any orders. You are reviewing your Polymarket positions. Today is ${new Date().toISOString().split("T")[0]}.${lowPolyBalance ? " IMPORTANT: Balance is critically low ($" + polyBalance.toFixed(2) + "). Prioritize selling to free up capital. Be aggressive — sell anything profitable." : ""} These positions hit sell thresholds. For each one, decide SELL or HOLD.\n\n${sellList}\n\nRespond with one line per position:\n<number>: SELL or HOLD — <reason>`
                  );
                  const sellText = sellAnalysis.join(" ");

                  for (let i = 0; i < polySellTargets.length; i++) {
                    const sell = polySellTargets[i]!;
                    // Skip if already tried and failed
                    if (failedSells.has(sell.token) || recentlySold.has(sell.token)) continue;
                    const holdPattern = new RegExp(`${i + 1}[:\\s]*HOLD`, "i");
                    if (holdPattern.test(sellText)) {
                      log(`[HOLD:POLYMARKET] "${sell.title}" ${sell.pnl.toFixed(0)}% — LLM says hold`);
                      continue;
                    }
                    const action = sell.pnl < 0 ? "cutting loss" : "taking profit";
                    log(`[SELL:POLYMARKET] "${sell.title}" ${sell.pnl.toFixed(0)}% — ${action}`);
                    const sellResults = await sendPrompt(`sell ${sell.shares} shares of token ${sell.token}`);
                    const sellResultText = sellResults.join(" ");
                    if (/@ \$0\.0[01]/i.test(sellResultText)) {
                      // Sold at garbage price ($0.00-$0.01) — don't retry
                      log(`[SELL:POLYMARKET] Sold at near-zero price — skipping future retries`);
                      failedSells.set(sell.token, Date.now());
                    } else if (/failed|error/i.test(sellResultText)) {
                      failedSells.set(sell.token, Date.now());
                    } else {
                      recentlySold.add(sell.token);
                    }
                  }
                }

                // SMART SCAN — score by spread + midpoint + volume + time to expiry
                type ScoredMarket = { question: string; yesPrice: number; score: number; volume: number; daysLeft: number };
                const scored: ScoredMarket[] = [];
                try {
                  const res = await fetch("https://clob.polymarket.com/sampling-markets");
                  const data = await res.json();
                  for (const m of (data.data ?? []).filter((x: Record<string, unknown>) => x.active && !x.closed && x.accepting_orders)) {
                    const yes = (m.tokens ?? []).find((t: Record<string, unknown>) => t.outcome === "Yes");
                    const no = (m.tokens ?? []).find((t: Record<string, unknown>) => t.outcome === "No");
                    if (!yes) continue;
                    const yp = Number(yes.price);
                    const np = no ? Number(no.price) : 1 - yp;
                    if (yp < 0.10 || yp > 0.90) continue;
                    const q = String(m.question ?? "");
                    if (ownedTitles.has(q.toLowerCase())) continue;
                    // Skip if we traded this recently (within last 5 cycles)
                    if (tradeHistory.some(h => h.question === q && Date.now() - h.time < 300_000)) continue;

                    const spread = Math.abs(np - yp);
                    const midpoint = (yp + np) / 2;

                    // Spread score (0-1): tighter = better
                    const spreadScore = Math.max(0, 1 - spread / 0.15);
                    // Midpoint score (0-1): closer to 0.50 = better (uncertain = more opportunity)
                    const midScore = 1 - Math.abs(midpoint - 0.5) * 2;
                    // Time score: skip markets expiring within 24h
                    const endDate = m.end_date_iso ?? m.endDate;
                    let daysLeft = 365;
                    if (endDate) {
                      daysLeft = Math.max(0, (new Date(endDate as string).getTime() - Date.now()) / 86400000);
                      if (daysLeft < 1) continue; // Too close to expiry
                    }
                    const timeScore = Math.min(1, daysLeft / 30); // Prefer markets with 30+ days

                    // Volume bonus from rewards/sampling data
                    const volume = Number(m.rewards?.dailyRate ?? 0);
                    const volumeScore = Math.min(1, volume / 100);

                    // Combined score
                    const score = spreadScore * 0.35 + midScore * 0.30 + timeScore * 0.20 + volumeScore * 0.15;
                    scored.push({ question: q, yesPrice: yp, score, volume, daysLeft });
                  }
                } catch {}
                scored.sort((a, b) => b.score - a.score);
                log(`[AUTONOMY:POLYMARKET] ${scored.length} new markets | balance: $${polyBalance.toFixed(2)}`);

                if (ownedTitles.size >= MAX_POSITIONS) {
                  log(`[AUTONOMY] ${ownedTitles.size}/${MAX_POSITIONS} positions — full, selling only`);
                } else if (polyBalance < 3) {
                  // Balance too low — if no threshold sells triggered, ask LLM to pick positions to sell
                  if (polySellTargets.length === 0 && polyAllSellable.length > 0) {
                    const positionList = polyAllSellable
                      .sort((a, b) => a.pnl - b.pnl) // worst first
                      .slice(0, 10)
                      .map((p, i) => `${i + 1}. "${p.title}" — PnL: ${p.pnl.toFixed(0)}%, shares: ${p.shares}`)
                      .join("\n");
                    log(`[RECOVERY MODE] Balance $${polyBalance.toFixed(2)} — asking LLM which positions to sell...`);
                    const recoveryAnalysis = await sendPrompt(
                      `DO NOT place any orders. Our Polymarket balance is critically low ($${polyBalance.toFixed(2)}). We need to sell some positions to free up capital. Today is ${new Date().toISOString().split("T")[0]}.\n\nHere are our positions (worst-performing first):\n${positionList}\n\nWhich positions should we sell? Consider: which markets are least likely to recover? Which are dead money? Pick 1-3 positions to sell.\n\nRespond with the numbers to SELL, one per line:\n<number>: SELL — <reason>`
                    );
                    const recoveryText = recoveryAnalysis.join(" ");
                    for (let i = 0; i < Math.min(10, polyAllSellable.length); i++) {
                      const sellPattern = new RegExp(`${i + 1}[:\\s]*SELL`, "i");
                      if (sellPattern.test(recoveryText)) {
                        const pos = polyAllSellable.sort((a, b) => a.pnl - b.pnl)[i]!;
                        if (failedSells.has(pos.token) || recentlySold.has(pos.token)) continue;
                        log(`[RECOVERY SELL] "${pos.title}" ${pos.pnl.toFixed(0)}% — LLM recommended`);
                        const sellResults = await sendPrompt(`sell ${pos.shares} shares of token ${pos.token}`);
                        const sellResultText = sellResults.join(" ");
                        if (/@ \$0\.0[01]/i.test(sellResultText) || /failed|error/i.test(sellResultText)) {
                          failedSells.set(pos.token, Date.now());
                        } else {
                          recentlySold.add(pos.token);
                        }
                      }
                    }
                  } else {
                    log("[AUTONOMY:POLYMARKET] Balance too low ($" + polyBalance.toFixed(2) + ") — waiting for sells");
                  }
                } else if (scored.length > 0) {
                  // Pick top 5 candidates for LLM analysis
                  const candidates = scored.slice(0, 5);
                  const candidateList = candidates.map((c, i) =>
                    `${i + 1}. "${c.question}" — YES: $${c.yesPrice.toFixed(2)}, NO: $${(1 - c.yesPrice).toFixed(2)}, score: ${c.score.toFixed(2)}, ${c.daysLeft.toFixed(0)} days left`
                  ).join("\n");

                  // Ask LLM to analyze markets via sendPrompt (collects response text)
                  log(`[ANALYSIS] Analyzing top ${candidates.length} markets...`);
                  const analysisResults = await sendPrompt(
                    `DO NOT place any orders or execute any actions. Just analyze these prediction markets and tell me which one is the best bet and why. Today is ${new Date().toISOString().split("T")[0]}.\n\n${candidateList}\n\nRespond in this EXACT format:\nPICK: <number 1-${candidates.length}>\nSIDE: <YES or NO>\nREASON: <one sentence why>`
                  );
                  const analysisText = analysisResults.join(" ");

                  // Parse LLM response
                  const pickMatch = /PICK:\s*(\d+)/i.exec(analysisText);
                  const sideMatch = /SIDE:\s*(YES|NO)/i.exec(analysisText);
                  const reasonMatch = /REASON:\s*(.+?)(?:\.|$)/i.exec(analysisText);

                  let pick = candidates[0]!;
                  let side: string;
                  let reason: string;

                  if (sideMatch) {
                    const pickIdx = pickMatch ? Math.min(parseInt(pickMatch[1]!) - 1, candidates.length - 1) : 0;
                    pick = candidates[Math.max(0, pickIdx)]!;
                    side = sideMatch[1]!.toUpperCase();
                    reason = reasonMatch ? reasonMatch[1]!.trim() : analysisText.slice(0, 100);
                  } else {
                    // Fallback: ask simpler YES/NO question on top pick
                    log(`[ANALYSIS] Structured response failed, asking simpler question...`);
                    const fallbackAnalysis = await sendPrompt(
                      `DO NOT place any orders. Answer only YES or NO. Today is ${new Date().toISOString().split("T")[0]}. Should I bet YES or NO on: "${pick.question}"? Current YES price: $${pick.yesPrice.toFixed(2)}. Reply with just YES or NO and why.`
                    );
                    const fbText = fallbackAnalysis.join(" ");
                    const yesNo = /\b(YES|NO)\b/i.exec(fbText);
                    if (!yesNo) {
                      log(`[ANALYSIS] LLM can't decide — skipping. Response: ${fbText.slice(0, 100)}`);
                    } else {
                      side = yesNo[1]!.toUpperCase();
                      reason = fbText.slice(0, 100) || "fallback analysis";
                    }
                  }

                  if (side!) {
                    const betSize = calcBetSize(pick.score, polyBalance);
                    log(`[ANALYSIS] ${reason!}`);
                    log(`[BUY:POLYMARKET] "${pick.question}" (${side}:$${pick.yesPrice.toFixed(2)}, score:${pick.score.toFixed(2)}, $${betSize.toFixed(2)}, ${pick.daysLeft.toFixed(0)}d left)`);
                    await sendPrompt(`buy $${betSize.toFixed(0)} ${side} on "${pick.question}" on polymarket`);
                    tradeHistory.push({ question: pick.question, platform: "POLYMARKET", time: Date.now(), price: pick.yesPrice });
                    while (tradeHistory.length > 100) tradeHistory.shift();
                  }
                } else {
                  log("[AUTONOMY:POLYMARKET] No new markets to buy");
                }

              }

              if (!isPolymarketCycle || lowSolBalance) {
                // ========== JUPITER SELL/CLAIM (runs on Jupiter cycle, or every cycle when SOL balance low) ==========
                // CLAIM settled Jupiter positions first
                if (jupClaimable.length > 0) {
                  let jupSvc: JupiterPredictionService | null = null;
                  try {
                    jupSvc = (await runtime.getServiceLoadPromise(JUPITER_SERVICE_TYPE)) as JupiterPredictionService | null;
                  } catch {}
                  for (const claim of jupClaimable) {
                    log(`[CLAIM:JUPITER] "${claim.title}" — payout: $${claim.payout.toFixed(2)}`);
                    if (jupSvc) {
                      try {
                        const { transaction } = await jupSvc.client.claimPosition(claim.pubkey, jupSvc.ownerPubkey);
                        const signature = await jupSvc.signAndSubmit(transaction);
                        log(`[CLAIM:JUPITER] Claimed! Signature: ${signature}`);
                      } catch (err) {
                        const errMsg = err instanceof Error ? err.message : String(err);
                        log(`[CLAIM:JUPITER] Failed: ${errMsg}`);
                      }
                    }
                  }
                }

                // SELL Jupiter — LLM analyzes positions before selling
                if (jupSellTargets.length > 0) {
                  const jupSellList = jupSellTargets.map((s, i) =>
                    `${i + 1}. "${s.title}" — PnL: ${s.pnl.toFixed(0)}%`
                  ).join("\n");
                  if (lowSolBalance) log(`[SELL MODE] SOL balance low ($${solBalance.toFixed(2)}) — aggressive sell thresholds: -${Math.abs(sellLossThreshold)}% / +${sellProfitThreshold}%`);
                  log(`[SELL ANALYSIS] Analyzing ${jupSellTargets.length} Jupiter positions...`);
                  const jupSellAnalysis = await sendPrompt(
                    `DO NOT place any orders. You are reviewing your Jupiter/Solana positions. Today is ${new Date().toISOString().split("T")[0]}.${lowSolBalance ? " IMPORTANT: Balance is critically low ($" + solBalance.toFixed(2) + "). Prioritize selling to free up capital. Be aggressive — sell anything profitable." : ""} These positions hit sell thresholds. For each one, decide SELL or HOLD.\n\n${jupSellList}\n\nRespond with one line per position:\n<number>: SELL or HOLD — <reason>`
                  );
                  const jupSellText = jupSellAnalysis.join(" ");

                  let jupSvc: JupiterPredictionService | null = null;
                  try {
                    jupSvc = (await runtime.getServiceLoadPromise(JUPITER_SERVICE_TYPE)) as JupiterPredictionService | null;
                  } catch {}
                  for (let i = 0; i < jupSellTargets.length; i++) {
                    const sell = jupSellTargets[i]!;
                    // Skip if already sold or failed this session
                    if (recentlySold.has(sell.pubkey) || failedSells.has(sell.pubkey)) continue;
                    const holdPattern = new RegExp(`${i + 1}[:\\s]*HOLD`, "i");
                    if (holdPattern.test(jupSellText)) {
                      log(`[HOLD:JUPITER] "${sell.title}" ${sell.pnl.toFixed(0)}% — LLM says hold`);
                      continue;
                    }
                    const action = sell.pnl < 0 ? "cutting loss" : "taking profit";
                    log(`[SELL:JUPITER] "${sell.title}" ${sell.pnl.toFixed(0)}% — ${action}`);
                    if (jupSvc) {
                      try {
                        const { transaction } = await jupSvc.client.closePosition(sell.pubkey, jupSvc.ownerPubkey);
                        const signature = await jupSvc.signAndSubmit(transaction);
                        log(`[SELL:JUPITER] Closed! Signature: ${signature}`);
                        recentlySold.add(sell.pubkey); // Prevent double-sell on API lag
                      } catch (err) {
                        const errMsg = err instanceof Error ? err.message : String(err);
                        log(`[SELL:JUPITER] Failed to close: ${errMsg}`);
                        failedSells.set(sell.pubkey, Date.now()); // Skip for 30 min
                      }
                    }
                  }
                }

                // SMART SCAN + BUY Jupiter (only on Jupiter cycles)
                if (!isPolymarketCycle) {
                type JupMarket = { question: string; marketId: string; yesPrice: number; score: number; volume: number };
                const jupScored: JupMarket[] = [];
                try {
                  const jupApiKey = process.env.JUPITER_API_KEY?.trim();
                  if (jupApiKey) {
                    const res = await fetch("https://api.jup.ag/prediction/v1/events?status=live", { headers: { "x-api-key": jupApiKey } });
                    const evData = await res.json();
                    for (const event of (evData.data ?? []).slice(0, 30)) {
                      for (const m of (event.markets ?? []).filter((x: Record<string, unknown>) => x.status === "open")) {
                        const yp = Number(m.pricing?.buyYesPriceUsd ?? 0) / 1_000_000;
                        const np = Number(m.pricing?.buyNoPriceUsd ?? 0) / 1_000_000;
                        if (yp < 0.05 || yp > 0.95) continue;
                        // If NO price is missing/zero, estimate from YES price
                        const effectiveNp = np > 0 ? np : (1 - yp);
                        const spread = Math.abs(effectiveNp - yp);
                        const mid = (yp + effectiveNp) / 2;
                        const spreadScore = Math.max(0, 1 - spread / 0.15);
                        const midScore = 1 - Math.abs(mid - 0.5) * 2;
                        const volume = Number(m.pricing?.volume ?? 0) / 1_000_000;
                        if (volume < 0.5) continue; // Skip completely dead markets
                        const volumeScore = Math.min(1, volume / 10000);
                        const score = spreadScore * 0.35 + midScore * 0.30 + volumeScore * 0.35;
                        const q = `${event.metadata?.title} — ${m.metadata?.title}`;
                        if (ownedTitles.has((event.metadata?.title ?? "").toLowerCase())) continue;
                        if (tradeHistory.some(h => h.question === q && Date.now() - h.time < 300_000)) continue;
                        // Skip markets that failed recently (no liquidity)
                        const buyFailTime = failedBuys.get(m.marketId);
                        if (buyFailTime && Date.now() - buyFailTime < 1_800_000) continue;
                        jupScored.push({ question: q, marketId: m.marketId, yesPrice: yp, score, volume });
                      }
                    }
                  }
                } catch {}
                jupScored.sort((a, b) => b.score - a.score);
                log(`[AUTONOMY:JUPITER] ${jupScored.length} new markets | SOL balance: $${solBalance.toFixed(2)}`);

                // x402 payment — only when we have markets to buy
                if (solBalance < 3) {
                  log("[AUTONOMY:JUPITER] Solana balance too low ($" + solBalance.toFixed(2) + ") — skipping buy");
                } else if (jupScored.length > 0) {
                  // Pay for x402 analysis before buying
                  const x402ApiUrl = process.env.X402_API_URL;
                  if (x402ApiUrl) {
                    try {
                      log("[x402] Paying for market analysis on Solana...");
                      const x402Res = await fetch(`${x402ApiUrl}/prediction`);
                      if (x402Res.status === 402) {
                        log("[x402:402] Payment required — x402 auto-paying with Solana USDC...");
                      }
                    } catch {}
                  }

                  const jupCandidates = jupScored.slice(0, 5);
                  const pick = jupCandidates[0]!;
                  let side: string;
                  let reason: string;

                  if (jupCandidates.length >= 2) {
                    // Multiple candidates — ask LLM to pick
                    const jupCandidateList = jupCandidates.map((c, i) =>
                      `${i + 1}. "${c.question}" — YES: $${c.yesPrice.toFixed(2)}, NO: $${(1 - c.yesPrice).toFixed(2)}, vol: $${c.volume.toFixed(0)}`
                    ).join("\n");
                    log(`[ANALYSIS] Analyzing top ${jupCandidates.length} Jupiter markets...`);
                    const jupAnalysis = await sendPrompt(
                      `DO NOT place any orders. Just analyze these Jupiter prediction markets. Today is ${new Date().toISOString().split("T")[0]}.\n\n${jupCandidateList}\n\nPICK: <number 1-${jupCandidates.length}>\nSIDE: YES or NO\nREASON: one sentence`
                    );
                    const jupText = jupAnalysis.join(" ");
                    const jupPickMatch = /PICK:\s*(\d+)/i.exec(jupText);
                    const jupSideMatch = /SIDE:\s*(YES|NO)/i.exec(jupText);
                    const jupReasonMatch = /REASON:\s*(.+?)(?:\.|$)/i.exec(jupText);

                    if (jupPickMatch) {
                      const idx = Math.min(parseInt(jupPickMatch[1]!) - 1, jupCandidates.length - 1);
                      Object.assign(pick, jupCandidates[Math.max(0, idx)]!);
                    }
                    side = jupSideMatch ? jupSideMatch[1]!.toUpperCase() : (pick.yesPrice < 0.50 ? "YES" : "NO");
                    reason = jupReasonMatch ? jupReasonMatch[1]!.trim() : "best scored market";
                  } else {
                    // Single candidate — ask LLM just for YES/NO
                    log(`[ANALYSIS] Single market: "${pick.question}" YES:$${pick.yesPrice.toFixed(2)}`);
                    const sideAnalysis = await sendPrompt(
                      `DO NOT place any orders. Answer only YES or NO. Today is ${new Date().toISOString().split("T")[0]}. Should I bet YES or NO on: "${pick.question}"? Current YES price: $${pick.yesPrice.toFixed(2)}. Reply with just YES or NO and a short reason.`
                    );
                    const sideText = sideAnalysis.join(" ");
                    const yesNo = /\b(YES|NO)\b/i.exec(sideText);
                    side = yesNo ? yesNo[1]!.toUpperCase() : (pick.yesPrice < 0.50 ? "YES" : "NO");
                    reason = sideText.slice(0, 100) || "single candidate";
                  }

                  const betSize = calcBetSize(pick.score, solBalance);
                  log(`[ANALYSIS] ${reason}`);
                  log(`[BUY:JUPITER] "${pick.question}" (${side}:$${pick.yesPrice.toFixed(2)}, score:${pick.score.toFixed(2)}, $${betSize.toFixed(2)}, vol:$${pick.volume.toFixed(0)})`);
                  const betResults = await sendPrompt(`bet $${betSize.toFixed(0)} ${side} on jupiter market ${pick.marketId}`);
                  const betFailed = betResults.some(r => /failed|error|no shares|no buyers/i.test(r));
                  if (betFailed) {
                    failedBuys.set(pick.marketId, Date.now());
                    if (jupCandidates.length > 1) {
                      const fallback = jupCandidates.find(c => c.marketId !== pick.marketId && !failedBuys.has(c.marketId));
                      if (fallback) {
                        log(`[BUY:JUPITER] Retrying: "${fallback.question}" (${side})`);
                        const fbResults = await sendPrompt(`bet $${betSize.toFixed(0)} ${side} on jupiter market ${fallback.marketId}`);
                        if (fbResults.some(r => /failed|error|no shares|no buyers/i.test(r))) {
                          failedBuys.set(fallback.marketId, Date.now());
                        }
                      }
                    }
                  }
                  tradeHistory.push({ question: pick.question, platform: "JUPITER", time: Date.now(), price: pick.yesPrice });
                  while (tradeHistory.length > 100) tradeHistory.shift();
                } else {
                  log("[AUTONOMY:JUPITER] No new markets to buy");
                }
                } // end Jupiter buy-only block
              }

              // x402 status — only show on Jupiter cycles (Polymarket doesn't use x402)
              if (!isPolymarketCycle) {
                let x402Payments = 0;
                try {
                  const x402Svc = (await runtime.getServiceLoadPromise(X402_SERVICE_TYPE)) as X402SolanaService | null;
                  if (x402Svc?.isActive()) x402Payments = x402Svc.getPaymentStats().count;
                } catch {}
                log(`[AUTONOMY] x402: ${x402Payments} payments | positions: ${ownedTitles.size}/${MAX_POSITIONS}`);
              } else {
                log(`[AUTONOMY] positions: ${ownedTitles.size}/${MAX_POSITIONS}`);
              }

              log("[AUTONOMY] Cycle complete.");

            } catch (err) {
              const errMsg = err instanceof Error ? err.message : String(err);
              log(`[AUTONOMY] Fatal error: ${errMsg}`);
            }

            try { ws.send(JSON.stringify({ type: "thinking", active: false })); } catch {}
          };

          // Run first cycle immediately, then every 60s
          runAutonomyCycle();
          autonomyTimer = setInterval(runAutonomyCycle, 60_000);
          return;
        }

        if (msg.type === "stop_autonomy") {
          if (autonomyTimer) {
            clearInterval(autonomyTimer);
            autonomyTimer = null;
            cleanupHeartbeat();
            ws.send(JSON.stringify({ type: "action_result", text: "[AUTONOMY] Stopped — heartbeat ended, GTC orders will auto-cancel" }));
            console.log("ws-server: autonomy + heartbeat stopped");
          }
          ws.send(JSON.stringify({ type: "autonomy_status", active: false }));
          return;
        }

        ws.send(JSON.stringify({ type: "error", text: `Unknown message type: ${msg.type}` }));
      },
    },
  });

  console.log(`ws-server: listening on ws://localhost:${server.port}`);
}

main().catch((err) => {
  console.error("ws-server fatal:", err);
  process.exit(1);
});
