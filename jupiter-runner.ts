import {
  AgentRuntime,
  ChannelType,
  createCharacter,
  stringToUuid,
  type Character,
  type UUID,
} from "@elizaos/core";
import sqlPlugin from "@elizaos/plugin-sql";
import process from "node:process";
import {
  applyEnvValues,
  buildLlmPlugins,
  buildLlmRuntimeSettings,
  readEnvFile,
  resolveEnvPath,
  resolveLlmProviderFromEnv,
  writeEnvFile,
  type CliOptions,
} from "./lib";
import { runTradingTui, runSettingsWizard, type SettingsField } from "./tui";
import { jupiterPredictionPlugin } from "./plugins/jupiter-prediction/index";
import { JupiterPredictionService } from "./plugins/jupiter-prediction/service";

const DEFAULT_ROOM_ID = stringToUuid("jupiter-prediction-room");
const DEFAULT_WORLD_ID = stringToUuid("jupiter-prediction-world");
const DEFAULT_USER_ID = stringToUuid("jupiter-operator");

type JupiterSession = {
  readonly runtime: AgentRuntime;
  readonly roomId: UUID;
  readonly worldId: UUID;
  readonly userId: UUID;
  readonly agentId: UUID;
  readonly options: CliOptions;
  readonly jupiterService: JupiterPredictionService;
};

function buildJupiterCharacter(secrets: Record<string, string>): Character {
  return createCharacter({
    name: "Jupiter",
    username: "jupiter",
    bio: [
      "Jupiter v2 (elizaOS 2.0) — an autonomous agent that trades on Jupiter Prediction Markets on Solana.",
      "Uses available tools to scan prediction markets, analyze opportunities, and place bets responsibly.",
    ],
    adjectives: ["focused", "pragmatic", "direct"],
    style: {
      all: [
        "Use available tools to inspect markets before acting",
        "Keep responses short and operational",
      ],
      chat: ["Be concise", "Log actions clearly"],
    },
    settings: {},
    secrets,
  });
}

function getRequiredEnv(key: string): string {
  const value = process.env[key];
  if (!value || value.trim().length === 0) {
    throw new Error(`Missing required environment variable: ${key}`);
  }
  return value.trim();
}

async function ensureJupiterEnvConfig(options: CliOptions, force: boolean): Promise<void> {
  const envPath = resolveEnvPath();
  const envFile = await readEnvFile(envPath);
  const provider = resolveLlmProviderFromEnv() ?? "openai";

  const fields: SettingsField[] = [
    {
      key: "JUPITER_API_KEY",
      label: "Jupiter API Key (portal.jup.ag)",
      value: process.env.JUPITER_API_KEY ?? "",
      secret: true,
      required: true,
    },
    {
      key: "SOLANA_PRIVATE_KEY",
      label: "Solana Wallet Private Key (base58)",
      value: process.env.SOLANA_PRIVATE_KEY ?? "",
      secret: true,
      required: true,
    },
    {
      key: "SOLANA_RPC_URL",
      label: "Solana RPC URL",
      value: process.env.SOLANA_RPC_URL ?? "https://api.mainnet-beta.solana.com",
    },
  ];

  const providerKeyMap: Record<string, { key: string; label: string }> = {
    openai: { key: "OPENAI_API_KEY", label: "OpenAI API Key" },
    anthropic: { key: "ANTHROPIC_API_KEY", label: "Anthropic API Key" },
    gemini: { key: "GOOGLE_GENERATIVE_AI_API_KEY", label: "Gemini API Key" },
    groq: { key: "GROQ_API_KEY", label: "Groq API Key" },
    grok: { key: "XAI_API_KEY", label: "Grok API Key" },
  };
  const llmField = providerKeyMap[provider];
  if (llmField) {
    fields.push({
      key: llmField.key,
      label: llmField.label,
      value: process.env[llmField.key] ?? "",
      secret: true,
      required: true,
    });
  }

  const missingRequired = fields
    .filter((f) => f.required)
    .filter((f) => !f.value || f.value.trim().length === 0)
    .map((f) => f.label);

  if (!force && missingRequired.length === 0) return;

  const result = await runSettingsWizard({
    title: "Jupiter Prediction Setup",
    subtitle: missingRequired.length > 0
      ? `Missing required: ${missingRequired.join(", ")}`
      : "Enter required secrets to continue.",
    fields,
  });

  if (result.status !== "saved") {
    throw new Error("Setup cancelled.");
  }

  const updates: Record<string, string> = {};
  for (const [key, value] of Object.entries(result.values)) {
    if (value.trim().length > 0) updates[key] = value.trim();
  }
  await writeEnvFile(envPath, envFile.lines, updates);
  applyEnvValues(updates);
}

async function createJupiterSession(options: CliOptions): Promise<JupiterSession> {
  const jupiterApiKey = getRequiredEnv("JUPITER_API_KEY");
  const solanaPrivateKey = getRequiredEnv("SOLANA_PRIVATE_KEY");
  const rpcUrl = process.env.SOLANA_RPC_URL ?? undefined;

  const jupiterService = new JupiterPredictionService({
    apiKey: jupiterApiKey,
    solanaPrivateKey,
    rpcUrl,
  });

  const secrets: Record<string, string> = {
    SOLANA_PRIVATE_KEY: solanaPrivateKey,
    JUPITER_API_KEY: jupiterApiKey,
  };

  const character = buildJupiterCharacter(secrets);
  const agentId = stringToUuid(character.name ?? "jupiter");
  const llmProvider = resolveLlmProviderFromEnv();
  const llmPlugins = buildLlmPlugins(llmProvider);

  const runtime = new AgentRuntime({
    character,
    plugins: [sqlPlugin, jupiterPredictionPlugin, ...llmPlugins],
    settings: buildLlmRuntimeSettings(llmProvider),
    logLevel: "error",
    enableAutonomy: true,
    actionPlanning: true,
    checkShouldRespond: false,
  });

  await runtime.initialize();

  await runtime.ensureConnection({
    entityId: DEFAULT_USER_ID,
    roomId: DEFAULT_ROOM_ID,
    worldId: DEFAULT_WORLD_ID,
    userName: "Operator",
    source: "jupiter-prediction",
    channelId: "jupiter",
    serverId: "jupiter-server",
    type: ChannelType.DM,
  } as Parameters<typeof runtime.ensureConnection>[0]);

  return {
    runtime,
    roomId: DEFAULT_ROOM_ID,
    worldId: DEFAULT_WORLD_ID,
    userId: DEFAULT_USER_ID,
    agentId,
    options,
    jupiterService,
  };
}

export async function jupiterVerify(options: CliOptions): Promise<void> {
  await ensureJupiterEnvConfig(options, false);
  const session = await createJupiterSession(options);
  try {
    console.log("✅ runtime initialized");
    console.log(`🔑 wallet: ${session.jupiterService.ownerPubkey}`);
    const ready = await session.jupiterService.isReady();
    console.log(`📡 jupiter exchange: ${ready ? "operational" : "unavailable"}`);
    console.log(`🔧 execute: ${options.execute ? "enabled" : "disabled"}`);
  } finally {
    await session.runtime.stop();
  }
}

export async function jupiterChat(options: CliOptions): Promise<void> {
  await ensureJupiterEnvConfig(options, false);
  const session = await createJupiterSession(options);
  let exiting = false;
  const onSigint = () => {
    if (exiting) return;
    exiting = true;
    void session.runtime.stop().finally(() => process.exit(0));
  };
  process.once("SIGINT", onSigint);

  console.log("✅ runtime initialized");
  console.log(`🔑 wallet: ${session.jupiterService.ownerPubkey}`);
  console.log(`🔧 execute: ${options.execute ? "enabled" : "disabled"}`);

  try {
    const { runtime, roomId, worldId, userId } = session;
    runtime.setSetting("AUTONOMY_TARGET_ROOM_ID", String(roomId));
    runtime.setSetting("AUTONOMY_MODE", "task");

    await runtime.ensureConnection({
      entityId: userId,
      roomId,
      worldId,
      userName: "Operator",
      source: "jupiter-prediction",
      channelId: "jupiter-chat",
      serverId: "jupiter-server",
      type: ChannelType.DM,
    } as Parameters<typeof runtime.ensureConnection>[0]);

    const messageService = runtime.messageService;
    if (!messageService) {
      throw new Error("Message service not initialized — ensure an LLM plugin is loaded.");
    }

    await runTradingTui({
      runtime,
      roomId,
      worldId,
      userId,
      messageService,
      venue: "jupiter",
    });
  } finally {
    process.off("SIGINT", onSigint);
    await session.runtime.stop();
  }
}
