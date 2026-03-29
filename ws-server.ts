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
          const BET_SIZE = 3; // $3 per position

          const runAutonomyCycle = async () => {
            try { ws.send(JSON.stringify({ type: "thinking", active: true })); } catch {}

            try {
              log("[AUTONOMY] Scanning markets — sports, crypto, politics, finance...");

              // ===== STEP 1: Score Polymarket opportunities by category =====
              type ScoredMarket = { platform: string; question: string; keyword: string; marketId: string; yesPrice: number; spread: number; score: number; category: string };
              const scored: ScoredMarket[] = [];

              // Scan by categories like the old agent
              const CATEGORIES = ["sports", "crypto", "politics", "finance", "entertainment", "weather"];

              try {
                const res = await fetch("https://clob.polymarket.com/sampling-markets");
                const data = await res.json();
                const markets = (data.data ?? []).filter((m: Record<string, unknown>) => m.active && !m.closed && m.accepting_orders);

                for (const m of markets) {
                  const tokens = m.tokens ?? [];
                  const yes = tokens.find((t: Record<string, unknown>) => t.outcome === "Yes");
                  const no = tokens.find((t: Record<string, unknown>) => t.outcome === "No");
                  if (!yes) continue;
                  const yesPrice = Number(yes.price);
                  const noPrice = no ? Number(no.price) : 1 - yesPrice;
                  if (yesPrice < 0.10 || yesPrice > 0.90) continue;
                  const spread = Math.abs(noPrice - yesPrice);
                  const midScore = 1 - Math.abs((yesPrice + noPrice) / 2 - 0.5) * 2;
                  const spreadScore = Math.max(0, 1 - spread / 0.15);
                  const score = spreadScore * 0.6 + midScore * 0.4;
                  const question = String(m.question ?? "").toLowerCase();

                  // Categorize
                  let category = "other";
                  if (/nba|nfl|nhl|epl|f1|soccer|football|baseball|champion|playoff|win.*game|beat/i.test(question)) category = "sports";
                  else if (/bitcoin|btc|eth|crypto|solana|token|defi|nft/i.test(question)) category = "crypto";
                  else if (/president|elect|senate|congress|democrat|republican|trump|biden|vote|governor/i.test(question)) category = "politics";
                  else if (/fed|rate|gdp|inflation|stock|market|s&p|nasdaq|economy|recession/i.test(question)) category = "finance";
                  else if (/elon|musk|tweet|movie|oscar|grammy|spotify/i.test(question)) category = "entertainment";
                  else if (/weather|temperature|rain|snow|hurricane/i.test(question)) category = "weather";

                  const words = String(m.question ?? "").split(/\s+/).filter((w: string) => w.length > 4);
                  scored.push({ platform: "POLYMARKET", question: String(m.question ?? ""), keyword: words[0] ?? "market", marketId: "", yesPrice, spread, score, category });
                }
              } catch {}

              // ===== STEP 2: Score Jupiter opportunities =====
              try {
                const jupApiKey = process.env.JUPITER_API_KEY?.trim();
                if (jupApiKey) {
                  const res = await fetch("https://api.jup.ag/prediction/v1/events?status=live", { headers: { "x-api-key": jupApiKey } });
                  const evData = await res.json();
                  for (const event of (evData.data ?? []).slice(0, 10)) {
                    for (const m of (event.markets ?? []).filter((x: Record<string, unknown>) => x.status === "open")) {
                      const yp = Number(m.pricing?.buyYesPriceUsd ?? 0) / 1_000_000;
                      if (yp < 0.10 || yp > 0.90) continue;
                      const np = Number(m.pricing?.buyNoPriceUsd ?? 0) / 1_000_000;
                      const spread = Math.abs(np - yp);
                      const mid = (yp + (np || (1 - yp))) / 2;
                      const score = Math.max(0, 1 - spread / 0.15) * 0.6 + (1 - Math.abs(mid - 0.5) * 2) * 0.4;
                      scored.push({ platform: "JUPITER", question: `${event.metadata?.title} — ${m.metadata?.title}`, keyword: "", marketId: m.marketId, yesPrice: yp, spread, score });
                    }
                  }
                }
              } catch {}

              // Sort by score
              scored.sort((a, b) => b.score - a.score);

              // ===== STEP 3: Check positions — collect owned markets + sell targets =====
              const ownedTitles = new Set<string>();
              const sellTargets: Array<{ token: string; shares: number; title: string; pnl: number }> = [];
              try {
                const funder = process.env.POLYMARKET_FUNDER_ADDRESS?.trim();
                if (funder) {
                  const posRes = await fetch(`https://data-api.polymarket.com/positions?user=${funder}`);
                  if (posRes.ok) {
                    for (const pos of await posRes.json()) {
                      // Track all owned markets (even dead ones)
                      if (pos.title) ownedTitles.add(pos.title.toLowerCase());

                      const pnl = pos.percentPnl ?? 0;
                      const price = pos.curPrice ?? 0;
                      if (price < 0.02 || pos.redeemable) continue;
                      if (pnl < -30 || pnl > 50) {
                        sellTargets.push({ token: pos.asset, shares: pos.size, title: pos.title, pnl });
                      }
                    }
                  }
                }
              } catch {}
              // Also track Jupiter positions
              try {
                const jupApiKey = process.env.JUPITER_API_KEY?.trim();
                const solKey = process.env.SOLANA_PRIVATE_KEY?.trim();
                if (jupApiKey && solKey) {
                  const { Keypair } = await import("@solana/web3.js");
                  const bs58 = await import("bs58");
                  const kp = Keypair.fromSecretKey(bs58.default.decode(solKey));
                  const posRes = await fetch(`https://api.jup.ag/prediction/v1/positions?ownerPubkey=${kp.publicKey.toBase58()}`, { headers: { "x-api-key": jupApiKey } });
                  if (posRes.ok) {
                    const posData = await posRes.json();
                    for (const pos of (posData.data ?? [])) {
                      const title = pos.eventMetadata?.title ?? pos.marketId ?? "";
                      if (title) ownedTitles.add(title.toLowerCase());
                    }
                  }
                }
              } catch {}

              // x402 status
              let x402Payments = 0;
              try {
                const x402Svc = (await runtime.getServiceLoadPromise(X402_SERVICE_TYPE)) as X402SolanaService | null;
                if (x402Svc?.isActive()) x402Payments = x402Svc.getPaymentStats().count;
              } catch {}

              log(`[AUTONOMY] ${scored.length} markets scored | ${sellTargets.length} sell targets | x402: ${x402Payments} payments`);

              // ===== STEP 4: SELL losers first =====
              for (const sell of sellTargets) {
                const action = sell.pnl < -30 ? "cutting loss" : "taking profit";
                log(`[SELL] "${sell.title}" ${sell.pnl.toFixed(0)}% — ${action}, ${sell.shares} shares`);
                await sendPrompt(`sell ${sell.shares} shares of token ${sell.token}`);
              }

              // ===== STEP 5: BUY best opportunity (that we DON'T already own) =====
              // Filter out markets we already have positions in
              const newOpportunities = scored.filter(m => {
                const q = m.question.toLowerCase();
                for (const owned of ownedTitles) {
                  // Check if any owned title overlaps with this market
                  if (q.includes(owned.slice(0, 20)) || owned.includes(q.slice(0, 20))) return false;
                }
                return true;
              });

              // Count categories for logging
              const catCounts: Record<string, number> = {};
              for (const m of scored) catCounts[m.category] = (catCounts[m.category] ?? 0) + 1;
              const catSummary = Object.entries(catCounts).map(([k, v]) => `${k}:${v}`).join(" ");
              log(`[AUTONOMY] ${newOpportunities.length} NEW markets (${scored.length - newOpportunities.length} owned) | ${catSummary}`);

              // Check if we're at max positions
              if (ownedTitles.size >= MAX_POSITIONS) {
                log(`[AUTONOMY] ${ownedTitles.size}/${MAX_POSITIONS} positions — portfolio full, sell first`);
              } else if (newOpportunities.length > 0) {
                const topN = newOpportunities.slice(0, Math.min(5, newOpportunities.length));
                const pick = topN[Math.floor(Math.random() * topN.length)]!;

                if (pick.score >= 0.4) {
                  log(`[BUY] ${pick.platform} — "${pick.question}" (YES:$${pick.yesPrice.toFixed(2)}, score:${pick.score.toFixed(2)})`);

                  if (pick.platform === "JUPITER" && pick.marketId) {
                    // Jupiter trades go through x402-wrapped fetch on Solana
                    const x402ApiUrl = process.env.X402_API_URL;
                    if (x402ApiUrl) {
                      try {
                        log("[x402] Fetching paid analysis before Jupiter trade...");
                        const x402Res = await fetch(`${x402ApiUrl}/prediction`);
                        if (x402Res.status === 200) {
                          const x402Data = await x402Res.json();
                          log(`[x402:PAID] $${x402Data.payment?.amount ?? "0.01"} USDC — ${x402Data.data?.prediction ?? "analysis received"}`);
                        } else if (x402Res.status === 402) {
                          log("[x402:402] Payment required — x402 auto-paying with Solana USDC...");
                        }
                      } catch {}
                    }
                    await sendPrompt(`bet $3 YES on jupiter market ${pick.marketId}`);
                  } else {
                    // Polymarket trades on Polygon — no x402 needed
                    await sendPrompt(`buy $3 YES on "${pick.question}" on polymarket`);
                  }
                } else {
                  log(`[AUTONOMY] Best score ${pick.score.toFixed(2)} < 0.4 — no good opportunities`);
                }
              } else if (scored.length > 0 && newOpportunities.length === 0) {
                log("[AUTONOMY] All top markets already owned — holding cash");
              } else {
                log("[AUTONOMY] No tradeable markets found");
              }

              // x402 payments only happen with Jupiter/Solana trades (moved to STEP 5)

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
