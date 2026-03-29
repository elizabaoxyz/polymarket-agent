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
        if (autonomyTimer) {
          clearInterval(autonomyTimer);
          autonomyTimer = null;
          cleanupHeartbeat();
          console.log("ws-server: autonomy + heartbeat stopped (client disconnected)");
        }
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

          ws.send(JSON.stringify({ type: "thinking", active: false }));
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
              ws.send(JSON.stringify({ type: "action_result", text: `[ERROR] ${errMsg}` }));
            }
            return results;
          };

          const log = (text: string) => ws.send(JSON.stringify({ type: "action_result", text }));

          const runAutonomyCycle = async () => {
            ws.send(JSON.stringify({ type: "thinking", active: true }));

            try {
              // ===== STEP 1: Gather all data for the LLM to decide =====
              log("[AUTONOMY] Gathering market data + positions...");

              // Fetch top Polymarket markets
              const polyMarkets: string[] = [];
              try {
                const res = await fetch("https://clob.polymarket.com/sampling-markets");
                const data = await res.json();
                const markets = (data.data ?? []).filter((m: Record<string, unknown>) => m.active && !m.closed && m.accepting_orders);
                for (const m of markets.slice(0, 50)) {
                  const tokens = m.tokens ?? [];
                  const yes = tokens.find((t: Record<string, unknown>) => t.outcome === "Yes");
                  const no = tokens.find((t: Record<string, unknown>) => t.outcome === "No");
                  if (!yes) continue;
                  const yesPrice = Number(yes.price);
                  // Only show tradeable markets — YES price between $0.10 and $0.90
                  if (yesPrice < 0.10 || yesPrice > 0.90) continue;
                  polyMarkets.push(`"${m.question}" YES:$${yesPrice.toFixed(2)} NO:$${no ? Number(no.price).toFixed(2) : "?"}`);
                  if (polyMarkets.length >= 10) break;
                }
              } catch {}

              // Fetch Jupiter markets
              const jupMarkets: string[] = [];
              try {
                const jupApiKey = process.env.JUPITER_API_KEY?.trim();
                if (jupApiKey) {
                  const res = await fetch("https://api.jup.ag/prediction/v1/events?status=live", { headers: { "x-api-key": jupApiKey } });
                  const data = await res.json();
                  for (const event of (data.data ?? []).slice(0, 5)) {
                    for (const m of (event.markets ?? []).filter((x: Record<string, unknown>) => x.status === "open").slice(0, 2)) {
                      const yp = Number(m.pricing?.buyYesPriceUsd ?? 0) / 1_000_000;
                      jupMarkets.push(`"${event.metadata?.title} — ${m.metadata?.title}" ID:${m.marketId} YES:$${yp.toFixed(2)}`);
                    }
                  }
                }
              } catch {}

              // Fetch current positions
              const posLines: string[] = [];
              try {
                const funder = process.env.POLYMARKET_FUNDER_ADDRESS?.trim();
                if (funder) {
                  const posRes = await fetch(`https://data-api.polymarket.com/positions?user=${funder}`);
                  if (posRes.ok) {
                    const positions = await posRes.json();
                    for (const pos of positions) {
                      const curPrice = pos.curPrice ?? 0;
                      // Skip dead/illiquid markets — price below $0.02 means no real order book
                      if (curPrice < 0.02 || pos.redeemable) continue;
                      posLines.push(`[POLYMARKET] "${pos.title}" ${pos.outcome} ${pos.size} shares avg:$${(pos.avgPrice ?? 0).toFixed(2)} now:$${curPrice.toFixed(2)} pnl:${(pos.percentPnl ?? 0).toFixed(0)}% token:${pos.asset}`);
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
                    const posData = await posRes.json();
                    for (const pos of (posData.data ?? [])) {
                      const title = pos.marketMetadata?.title ?? pos.marketId;
                      posLines.push(`[JUPITER] "${pos.eventMetadata?.title} — ${title}" ${pos.isYes ? "YES" : "NO"} ${pos.contracts} contracts pnl:${pos.pnlUsdPercent}% id:${pos.marketId}`);
                    }
                  }
                }
              } catch {}

              // ===== STEP 2: Let the LLM decide what to do =====
              // Get x402 payment stats
              let x402Status = "x402: disabled";
              try {
                const x402Svc = (await runtime.getServiceLoadPromise(X402_SERVICE_TYPE)) as X402SolanaService | null;
                if (x402Svc && x402Svc.isActive()) {
                  const stats = x402Svc.getPaymentStats();
                  x402Status = `x402: active | ${stats.count} payments | $${stats.totalUsd.toFixed(4)} total spent | cap: $${x402Svc.getMaxPaymentUsd().toFixed(2)}/req`;
                }
              } catch {}

              const portfolioStatus = await getPortfolioStatus(runtime);

              const briefing = [
                "You are an autonomous trading agent. Analyze the data below and make ONE decision.",
                "",
                "RULES:",
                "- You MUST pick one action: BUY or SELL. Only say HOLD if you truly have no cash left.",
                "- You are a trader — TRADE. Pick a market and BUY it. Be decisive.",
                "- Do NOT buy a market you already own — pick something new each cycle",
                "- BUY markets near 50/50 odds — those have the best value",
                "- SELL positions down >30% or up >50%",
                "- Pick a DIFFERENT market each time — diversify",
                "",
                `BALANCES: Polymarket $${portfolioStatus.balance.toFixed(2)} | Solana $${portfolioStatus.solanaBalance.toFixed(2)}`,
                `${x402Status}`,
                "",
                "TOP POLYMARKET MARKETS (pick one to buy):",
                ...polyMarkets.map((m, i) => `  ${i + 1}. ${m}`),
                "",
                "TOP JUPITER MARKETS (pick one to buy):",
                ...(jupMarkets.length > 0 ? jupMarkets.map((m, i) => `  ${i + 1}. ${m}`) : ["  (none)"]),
                "",
                posLines.length > 0 ? "YOUR SELLABLE POSITIONS (only these can be sold):" : "NO SELLABLE POSITIONS",
                ...posLines,
                "",
                "DECIDE: BUY (specify market name), SELL (specify token ID from above), or HOLD. One action only.",
              ].join("\n");

              log(`[AUTONOMY] ${polyMarkets.length} Polymarket + ${jupMarkets.length} Jupiter markets | ${posLines.length} positions | ${x402Status}`);
              const llmResponse = await sendPrompt(briefing);
              const decision = llmResponse.join(" ").toLowerCase();

              // ===== Parse LLM decision and EXECUTE directly =====
              if (decision.includes("buy") && !decision.includes("hold")) {
                // Extract what to buy from LLM response
                // Try to find a market name from the response
                const quotedMatch = /[""]([^""]+)[""]/.exec(llmResponse.join(" "));
                const keyword = quotedMatch?.[1]
                  ?? llmResponse.join(" ").match(/buy[:\s—-]+(.{5,?}?)(?:\s*[-—(at@$]|\.|$)/i)?.[1]?.trim()
                  ?? "";

                if (keyword && keyword.length > 3) {
                  log(`[AUTONOMY:EXECUTE] LLM chose BUY — executing: buy $2 YES on "${keyword}"`);
                  await sendPrompt(`buy $2 YES on "${keyword}" on polymarket`);
                } else {
                  // Check if it mentioned a Jupiter market ID
                  const jupIdMatch = /POLY-\d+/i.exec(llmResponse.join(" "));
                  if (jupIdMatch) {
                    log(`[AUTONOMY:EXECUTE] LLM chose BUY Jupiter — executing: bet $2 YES on jupiter market ${jupIdMatch[0]}`);
                    await sendPrompt(`bet $2 YES on jupiter market ${jupIdMatch[0]}`);
                  } else {
                    log("[AUTONOMY] LLM said BUY but couldn't extract market — skipping");
                  }
                }
              } else if (decision.includes("sell") && !decision.includes("hold")) {
                // Extract token ID from LLM response
                const tokenMatch = /token[:\s]+(\d{10,})/i.exec(llmResponse.join(" "));
                const sharesMatch = /(\d+(?:\.\d+)?)\s*shares/i.exec(llmResponse.join(" "));
                if (tokenMatch && sharesMatch) {
                  log(`[AUTONOMY:EXECUTE] LLM chose SELL — executing: sell ${sharesMatch[1]} shares of token ${tokenMatch[1]}`);
                  await sendPrompt(`sell ${sharesMatch[1]} shares of token ${tokenMatch[1]}`);
                } else {
                  log("[AUTONOMY] LLM said SELL but couldn't extract token/shares — skipping");
                }
              } else {
                log("[AUTONOMY] LLM chose HOLD — no action this cycle");
              }

              // ===== x402 payment — call 402-gated API =====
              const x402ApiUrl = process.env.X402_API_URL;
              if (x402ApiUrl) {
                try {
                  log("[x402] Calling payment-gated API...");
                  const x402Res = await fetch(`${x402ApiUrl}/prediction`);
                  if (x402Res.status === 200) {
                    const x402Data = await x402Res.json();
                    log(`[x402:PAID] $0.01 USDC — ${JSON.stringify(x402Data.data ?? x402Data).slice(0, 200)}`);
                  } else if (x402Res.status === 402) {
                    log("[x402:402] Payment required — x402 attempting auto-pay with Solana USDC...");
                  } else {
                    log(`[x402:INFO] API returned ${x402Res.status}`);
                  }
                } catch (err) {
                  const errMsg = err instanceof Error ? err.message : String(err);
                  log(`[x402:ERROR] ${errMsg}`);
                }
              }

              log("[AUTONOMY] Cycle complete.");

            } catch (err) {
              const errMsg = err instanceof Error ? err.message : String(err);
              log(`[AUTONOMY] Fatal error: ${errMsg}`);
            }

            ws.send(JSON.stringify({ type: "thinking", active: false }));
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
