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
  type Content,
  createCharacter,
  createMessageMemory,
  stringToUuid,
} from "@elizaos/core";
import polymarketPlugin from "@elizaos/plugin-polymarket";
import sqlPlugin from "@elizaos/plugin-sql";
import { v4 as uuidv4 } from "uuid";
import { type AutonomyHandle, type AutonomyPlatform, startAutonomy } from "./autonomy-loop";
import { AUTONOMY_PLATFORM, WS_AUTH_TOKEN } from "./config";
import {
  buildLlmPlugins,
  buildLlmRuntimeSettings,
  loadEnvConfig,
  parseArgs,
  resolveLlmProviderFromEnv,
} from "./lib";
import { log } from "./log";
import { AsyncMutex } from "./mutex";
import { connectorsPlugin } from "./plugins/connectors/index";
import type { ConnectorsService } from "./plugins/connectors/service";
import { CONNECTORS_SERVICE_TYPE } from "./plugins/connectors/types";
import { jupiterPredictionPlugin } from "./plugins/jupiter-prediction/index";
import { polymarketExtPlugin } from "./plugins/polymarket-ext/index";
import { ragPlugin } from "./plugins/rag/index";
import type { RAGService } from "./plugins/rag/service";
import { RAG_SERVICE_TYPE } from "./plugins/rag/types";
import { x402SolanaPlugin } from "./plugins/x402-solana/index";
import type { X402SolanaService } from "./plugins/x402-solana/service";
import { X402_SERVICE_TYPE } from "./plugins/x402-solana/types";
import { getPortfolioStatus } from "./portfolio";

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
        {
          user: "{{user1}}",
          content: { text: "buy $3 YES on Will Gavin Newsom win the Democratic nomination" },
        },
        {
          user: "Eliza",
          content: { text: "Placing $3 YES on Gavin Newsom.", action: "POLYMARKET_PLACE_ORDER" },
        },
      ],
      [
        { user: "{{user1}}", content: { text: "place a $5 bet on something interesting" } },
        { user: "Eliza", content: { text: "Placing $5 bet.", action: "POLYMARKET_PLACE_ORDER" } },
      ],
      [
        { user: "{{user1}}", content: { text: "show my positions" } },
        {
          user: "Eliza",
          content: { text: "Fetching positions.", action: "POLYMARKET_GET_POSITIONS" },
        },
      ],
      [
        { user: "{{user1}}", content: { text: "cancel all my orders" } },
        {
          user: "Eliza",
          content: { text: "Cancelling all orders.", action: "POLYMARKET_CANCEL_ALL" },
        },
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
      ragPlugin,
      connectorsPlugin,
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
    const x402Svc = (await runtime.getServiceLoadPromise(
      X402_SERVICE_TYPE,
    )) as unknown as X402SolanaService | null;
    if (x402Svc && x402Svc.isActive()) {
      globalThis.fetch = x402Svc.getWrappedFetch();
    }
  } catch {}

  // Initialize RAG + Connectors services
  let ragSvc: RAGService | null = null;
  try {
    ragSvc = (await runtime.getServiceLoadPromise(
      RAG_SERVICE_TYPE,
    )) as unknown as RAGService | null;
    if (ragSvc?.isActive()) {
      log.info("ws-server", "RAG active — ChromaDB connected");
    }
  } catch {}

  let connectorsSvc: ConnectorsService | null = null;
  try {
    connectorsSvc = (await runtime.getServiceLoadPromise(
      CONNECTORS_SERVICE_TYPE,
    )) as unknown as ConnectorsService | null;
    if (connectorsSvc?.isActive()) {
      log.info("ws-server", "Connectors active — news + search available");
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

  return { runtime, ragSvc, connectorsSvc };
}

async function main() {
  log.info("ws-server", "initializing runtime...");
  const { runtime, ragSvc, connectorsSvc } = await createRuntime();
  const messageService = runtime.messageService;
  if (!messageService) {
    throw new Error("Message service not initialized");
  }

  log.info("ws-server", "runtime ready");

  // Shared mutex for serializing runtime message handling
  const runtimeMutex = new AsyncMutex();

  // Track autonomy state
  let autonomyHandle: AutonomyHandle | null = null;

  // Track authenticated WebSocket clients (only used when WS_AUTH_TOKEN is set)
  const authenticatedClients = new WeakSet<object>();

  function isAuthenticated(ws: object): boolean {
    if (!WS_AUTH_TOKEN) return true; // No auth required
    return authenticatedClients.has(ws);
  }

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
        log.info("ws-server", "client connected");
        if (WS_AUTH_TOKEN) {
          ws.send(JSON.stringify({ type: "auth_required" }));
        }
      },
      close(ws) {
        log.info("ws-server", "client disconnected");
        // Autonomy keeps running — only stops when user explicitly clicks AUTONOMY OFF
      },
      async message(ws, raw) {
        let msg: { type: string; text?: string; token?: string };
        try {
          msg = JSON.parse(String(raw));
        } catch {
          ws.send(JSON.stringify({ type: "error", text: "Invalid JSON" }));
          return;
        }

        // --- Authentication gate ---
        if (msg.type === "auth") {
          if (!WS_AUTH_TOKEN) {
            ws.send(JSON.stringify({ type: "auth_result", success: true }));
            return;
          }
          if (msg.token === WS_AUTH_TOKEN) {
            authenticatedClients.add(ws);
            ws.send(JSON.stringify({ type: "auth_result", success: true }));
            log.info("ws-server", "client authenticated");
          } else {
            ws.send(JSON.stringify({ type: "auth_result", success: false, text: "Invalid token" }));
            log.warn("ws-server", "client auth failed");
          }
          return;
        }

        if (!isAuthenticated(ws)) {
          ws.send(
            JSON.stringify({
              type: "error",
              text: "Not authenticated. Send { type: 'auth', token: '...' } first.",
            }),
          );
          return;
        }

        // --- Status ---
        if (msg.type === "get_status") {
          const status = await getPortfolioStatus(runtime);
          ws.send(JSON.stringify({ type: "status", ...status }));
          return;
        }

        // --- Chat message ---
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
            await runtimeMutex.runExclusive(async () => {
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
            });
          } catch (err) {
            const errMsg = err instanceof Error ? err.message : String(err);
            ws.send(JSON.stringify({ type: "error", text: errMsg }));
          }

          try {
            ws.send(JSON.stringify({ type: "thinking", active: false }));
          } catch {}
          return;
        }

        // --- Start autonomy (supports platform-specific modes) ---
        if (
          msg.type === "start_autonomy" ||
          msg.type === "start_autonomy_polymarket" ||
          msg.type === "start_autonomy_jupiter"
        ) {
          const platform: AutonomyPlatform =
            msg.type === "start_autonomy_polymarket"
              ? "polymarket"
              : msg.type === "start_autonomy_jupiter"
                ? "jupiter"
                : AUTONOMY_PLATFORM;

          if (autonomyHandle?.isRunning) {
            // If same platform, just confirm. If different, stop and restart.
            if (autonomyHandle.platform === platform) {
              ws.send(JSON.stringify({ type: "autonomy_status", active: true, platform }));
              return;
            }
            // Stop current autonomy to switch platform
            autonomyHandle.stop();
            autonomyHandle = null;
            log.info(
              "ws-server",
              `switching autonomy from ${autonomyHandle?.platform ?? "?"} to ${platform}`,
            );
          }

          const label =
            platform === "both"
              ? "both platforms"
              : platform === "polymarket"
                ? "Polymarket only"
                : "Jupiter + x402 only";
          log.info("ws-server", `autonomy started (${label})`);
          ws.send(JSON.stringify({ type: "autonomy_status", active: true, platform }));

          autonomyHandle = startAutonomy(
            {
              runtime,
              messageService: messageService as {
                handleMessage: (...args: unknown[]) => Promise<unknown>;
              },
              roomId: DEFAULT_ROOM_ID,
              userId: DEFAULT_USER_ID,
              ragSvc,
              connectorsSvc,
              runtimeMutex,
            },
            {
              send: (data) => {
                try {
                  ws.send(JSON.stringify(data));
                } catch {
                  /* client disconnected, autonomy continues */
                }
              },
              log: (text) => {
                try {
                  ws.send(JSON.stringify({ type: "action_result", text }));
                } catch {
                  /* client disconnected */
                }
                log.info("ws-server", text);
              },
            },
            platform,
          );
          return;
        }

        // --- Stop autonomy ---
        if (msg.type === "stop_autonomy") {
          if (autonomyHandle) {
            const wasPlatform = autonomyHandle.platform;
            autonomyHandle.stop();
            autonomyHandle = null;
            const stopMsg =
              wasPlatform === "jupiter"
                ? "[AUTONOMY] Stopped (Jupiter)"
                : "[AUTONOMY] Stopped — heartbeat ended, GTC orders will auto-cancel";
            ws.send(JSON.stringify({ type: "action_result", text: stopMsg }));
            log.info("ws-server", "autonomy stopped");
          }
          ws.send(JSON.stringify({ type: "autonomy_status", active: false, platform: null }));
          return;
        }

        ws.send(JSON.stringify({ type: "error", text: `Unknown message type: ${msg.type}` }));
      },
    },
  });

  log.info("ws-server", `listening on ws://localhost:${server.port}`);
  if (WS_AUTH_TOKEN) {
    log.info("ws-server", "authentication ENABLED — clients must send auth token");
  } else {
    log.info("ws-server", "authentication DISABLED — set WS_AUTH_TOKEN to enable");
  }
}

main().catch((err) => {
  log.error("ws-server", `fatal: ${err instanceof Error ? err.message : String(err)}`);
  process.exit(1);
});
