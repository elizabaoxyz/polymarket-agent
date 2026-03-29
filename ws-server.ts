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
  ModelType,
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

              // ===== Collect owned positions =====
              const ownedTitles = new Set<string>();
              const polySellTargets: Array<{ token: string; shares: number; title: string; pnl: number }> = [];
              const jupSellTargets: Array<{ marketId: string; pubkey: string; title: string; pnl: number }> = [];

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
                      // Don't sell at garbage prices — best bid must be > $0.05
                      if (price < 0.05) continue;
                      if (pnl < -15 || pnl > 25) {
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
                      const pnl = pos.pnlUsdPercent ?? 0;
                      // Don't sell freshly bought positions (< 10 min old)
                      const recentJup = tradeHistory.some(
                        h => h.question.toLowerCase().includes((title).toLowerCase()) && Date.now() - h.time < 600_000
                      );
                      if (recentJup) continue;
                      if ((pnl < -15 || pnl > 25) && pos.pubkey) {
                        jupSellTargets.push({ marketId: pos.marketId, pubkey: pos.pubkey, title: pos.marketMetadata?.title ?? pos.marketId, pnl });
                      }
                    }
                  }
                }
              } catch {}

              // Get balance for smart sizing
              const portfolioStatus = await getPortfolioStatus(runtime);
              const polyBalance = portfolioStatus.balance;
              const solBalance = portfolioStatus.solanaBalance;

              if (isPolymarketCycle) {
                // ========== POLYMARKET CYCLE ==========
                // SMART SELL — dynamic thresholds based on how long we've held
                for (const sell of polySellTargets) {
                  const action = sell.pnl < -15 ? "cutting loss" : "taking profit";
                  log(`[SELL:POLYMARKET] "${sell.title}" ${sell.pnl.toFixed(0)}% — ${action}`);
                  await sendPrompt(`sell ${sell.shares} shares of token ${sell.token}`);
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
                  log("[AUTONOMY:POLYMARKET] Balance too low ($" + polyBalance.toFixed(2) + ") — waiting for sells");
                } else if (scored.length > 0) {
                  // Pick top 5 candidates for LLM analysis
                  const candidates = scored.slice(0, 5);
                  const candidateList = candidates.map((c, i) =>
                    `${i + 1}. "${c.question}" — YES: $${c.yesPrice.toFixed(2)}, NO: $${(1 - c.yesPrice).toFixed(2)}, score: ${c.score.toFixed(2)}, ${c.daysLeft.toFixed(0)} days left`
                  ).join("\n");

                  // Call LLM directly (bypasses elizaOS action routing)
                  log(`[ANALYSIS] Analyzing top ${candidates.length} markets...`);
                  let analysisText = "";
                  try {
                    analysisText = await runtime.useModel(ModelType.TEXT_LARGE, {
                      prompt: `You are an autonomous prediction market trader. Today is ${new Date().toISOString().split("T")[0]}. Analyze these markets and pick the BEST one to bet on. Consider current events, probability, and expected value.\n\n${candidateList}\n\nRespond in this EXACT format (one line each):\nPICK: <number 1-${candidates.length}>\nSIDE: <YES or NO>\nREASON: <one sentence why this side will win>`,
                      temperature: 0.3,
                      maxTokens: 200,
                    } as { prompt: string; temperature?: number; maxTokens?: number });
                  } catch (err) {
                    log(`[ANALYSIS] LLM call failed: ${err instanceof Error ? err.message : String(err)}`);
                  }

                  // Parse LLM response
                  if (analysisText) {
                    console.log("[ANALYSIS:RAW]", analysisText.slice(0, 500));
                  } else {
                    console.log("[ANALYSIS:RAW] empty response");
                  }
                  const pickMatch = /PICK:\s*(\d+)/i.exec(analysisText);
                  const sideMatch = /SIDE:\s*(YES|NO)/i.exec(analysisText);
                  const reasonMatch = /REASON:\s*(.+?)(?:\n|$)/i.exec(analysisText);

                  const pickIdx = pickMatch ? Math.min(parseInt(pickMatch[1]!) - 1, candidates.length - 1) : 0;
                  const pick = candidates[Math.max(0, pickIdx)]!;
                  const side = sideMatch ? sideMatch[1]!.toUpperCase() : (pick.yesPrice < 0.50 ? "YES" : "NO");
                  const reason = reasonMatch ? reasonMatch[1]!.trim() : "price-based fallback";

                  const betSize = calcBetSize(pick.score, polyBalance);
                  log(`[ANALYSIS] ${reason}`);
                  log(`[BUY:POLYMARKET] "${pick.question}" (${side}:$${pick.yesPrice.toFixed(2)}, score:${pick.score.toFixed(2)}, $${betSize.toFixed(2)}, ${pick.daysLeft.toFixed(0)}d left)`);
                  await sendPrompt(`buy $${betSize.toFixed(0)} ${side} on "${pick.question}" on polymarket`);
                  tradeHistory.push({ question: pick.question, platform: "POLYMARKET", time: Date.now(), price: pick.yesPrice });
                  while (tradeHistory.length > 100) tradeHistory.shift();
                } else {
                  log("[AUTONOMY:POLYMARKET] No new markets to buy");
                }

              } else {
                // ========== JUPITER CYCLE + x402 ==========
                // x402 payment for market analysis
                const x402ApiUrl = process.env.X402_API_URL;
                if (x402ApiUrl) {
                  try {
                    log("[x402] Paying for market analysis on Solana...");
                    const x402Res = await fetch(`${x402ApiUrl}/prediction`);
                    if (x402Res.status === 200) {
                      const x402Data = await x402Res.json();
                      log(`[x402:PAID] $${x402Data.payment?.amount ?? "0.01"} USDC — ${x402Data.data?.prediction ?? "analysis received"}`);
                    } else if (x402Res.status === 402) {
                      log("[x402:402] Payment required — x402 auto-paying with Solana USDC...");
                    }
                  } catch {}
                }

                // SELL Jupiter losers/winners via direct API call (bypasses LLM routing)
                if (jupSellTargets.length > 0) {
                  let jupSvc: JupiterPredictionService | null = null;
                  try {
                    jupSvc = (await runtime.getServiceLoadPromise(JUPITER_SERVICE_TYPE)) as JupiterPredictionService | null;
                  } catch {}
                  for (const sell of jupSellTargets) {
                    const action = sell.pnl < -15 ? "cutting loss" : "taking profit";
                    log(`[SELL:JUPITER] "${sell.title}" ${sell.pnl.toFixed(0)}% — ${action}`);
                    if (jupSvc) {
                      try {
                        const { transaction } = await jupSvc.client.closePosition(sell.pubkey, jupSvc.ownerPubkey);
                        const signature = await jupSvc.signAndSubmit(transaction);
                        log(`[SELL:JUPITER] Closed! Signature: ${signature}`);
                      } catch (err) {
                        const errMsg = err instanceof Error ? err.message : String(err);
                        log(`[SELL:JUPITER] Failed to close: ${errMsg}`);
                      }
                    }
                  }
                }

                // SMART SCAN + BUY Jupiter
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
                        // Both sides must have reasonable prices (liquidity check)
                        if (yp < 0.05 || yp > 0.95) continue;
                        if (np < 0.05 || np > 0.95) continue;
                        const spread = Math.abs(np - yp);
                        const mid = (yp + (np || (1 - yp))) / 2;
                        const spreadScore = Math.max(0, 1 - spread / 0.15);
                        const midScore = 1 - Math.abs(mid - 0.5) * 2;
                        const volume = Number(m.pricing?.volume ?? 0) / 1_000_000;
                        if (volume < 0.5) continue; // Skip completely dead markets
                        const volumeScore = Math.min(1, volume / 10000);
                        const score = spreadScore * 0.35 + midScore * 0.30 + volumeScore * 0.35;
                        const q = `${event.metadata?.title} — ${m.metadata?.title}`;
                        if (ownedTitles.has((event.metadata?.title ?? "").toLowerCase())) continue;
                        if (tradeHistory.some(h => h.question === q && Date.now() - h.time < 300_000)) continue;
                        jupScored.push({ question: q, marketId: m.marketId, yesPrice: yp, score, volume });
                      }
                    }
                  }
                } catch {}
                jupScored.sort((a, b) => b.score - a.score);
                log(`[AUTONOMY:JUPITER] ${jupScored.length} new markets | SOL balance: $${solBalance.toFixed(2)}`);

                if (solBalance < 3) {
                  log("[AUTONOMY:JUPITER] Solana balance too low ($" + solBalance.toFixed(2) + ") — skipping buy");
                } else if (jupScored.length > 0) {
                  // Pick top candidates for LLM analysis
                  const jupCandidates = jupScored.slice(0, 5);
                  const jupCandidateList = jupCandidates.map((c, i) =>
                    `${i + 1}. "${c.question}" — YES: $${c.yesPrice.toFixed(2)}, NO: $${(1 - c.yesPrice).toFixed(2)}, vol: $${c.volume.toFixed(0)}`
                  ).join("\n");

                  // Call LLM directly (bypasses elizaOS action routing)
                  log(`[ANALYSIS] Analyzing top ${jupCandidates.length} Jupiter markets...`);
                  let jupText = "";
                  try {
                    jupText = await runtime.useModel(ModelType.TEXT_LARGE, {
                      prompt: `You are an autonomous prediction market trader on Solana. Today is ${new Date().toISOString().split("T")[0]}. Analyze these Jupiter markets and pick the BEST one to bet on. Consider current events, probability, and value.\n\n${jupCandidateList}\n\nRespond in this EXACT format (one line each):\nPICK: <number 1-${jupCandidates.length}>\nSIDE: <YES or NO>\nREASON: <one sentence why this side will win>`,
                      temperature: 0.3,
                      maxTokens: 200,
                    } as { prompt: string; temperature?: number; maxTokens?: number });
                  } catch (err) {
                    log(`[ANALYSIS] LLM call failed: ${err instanceof Error ? err.message : String(err)}`);
                  }

                  const jupPickMatch = /PICK:\s*(\d+)/i.exec(jupText);
                  const jupSideMatch = /SIDE:\s*(YES|NO)/i.exec(jupText);
                  const jupReasonMatch = /REASON:\s*(.+?)(?:\n|$)/i.exec(jupText);

                  const jupPickIdx = jupPickMatch ? Math.min(parseInt(jupPickMatch[1]!) - 1, jupCandidates.length - 1) : 0;
                  const pick = jupCandidates[Math.max(0, jupPickIdx)]!;
                  const side = jupSideMatch ? jupSideMatch[1]!.toUpperCase() : (pick.yesPrice < 0.50 ? "YES" : "NO");
                  const reason = jupReasonMatch ? jupReasonMatch[1]!.trim() : "price-based fallback";

                  const betSize = calcBetSize(pick.score, solBalance);
                  log(`[ANALYSIS] ${reason}`);
                  log(`[BUY:JUPITER] "${pick.question}" (${side}:$${pick.yesPrice.toFixed(2)}, score:${pick.score.toFixed(2)}, $${betSize.toFixed(2)}, vol:$${pick.volume.toFixed(0)})`);
                  await sendPrompt(`bet $${betSize.toFixed(0)} ${side} on jupiter market ${pick.marketId}`);
                  tradeHistory.push({ question: pick.question, platform: "JUPITER", time: Date.now(), price: pick.yesPrice });
                  while (tradeHistory.length > 100) tradeHistory.shift();
                } else {
                  log("[AUTONOMY:JUPITER] No new markets to buy");
                }
              }

              // x402 status
              let x402Payments = 0;
              try {
                const x402Svc = (await runtime.getServiceLoadPromise(X402_SERVICE_TYPE)) as X402SolanaService | null;
                if (x402Svc?.isActive()) x402Payments = x402Svc.getPaymentStats().count;
              } catch {}
              log(`[AUTONOMY] x402: ${x402Payments} payments | positions: ${ownedTitles.size}/${MAX_POSITIONS}`);

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
