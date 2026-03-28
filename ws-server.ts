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

    return { balance, positions, trades, jupiterPositions };
  } catch {
    return { balance: 0, positions: [], trades: [], jupiterPositions: [] };
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
