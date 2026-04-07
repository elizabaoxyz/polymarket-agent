import fs from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

import anthropicPlugin from "@elizaos/plugin-anthropic";
import googleGenAIPlugin from "@elizaos/plugin-google-genai";
import groqPlugin from "@elizaos/plugin-groq";
import { openaiPlugin } from "@elizaos/plugin-openai";
import XAIPlugin from "@elizaos/plugin-xai";
import { z } from "zod";

export type Command = "help" | "verify" | "chat" | "settings" | "input-test";

export type CliOptions = {
  readonly execute: boolean;
  readonly intervalMs: number;
  readonly iterations: number;
  readonly orderSize: number;
  readonly maxPages: number;
  readonly chain: string;
  readonly rpcUrl: string | null;
  readonly privateKey: string | null;
  readonly clobApiUrl: string | null;
};

export type EnvConfig = {
  readonly privateKey: string;
  readonly clobApiUrl: string;
  readonly creds:
    | {
        readonly key: string;
        readonly secret: string;
        readonly passphrase: string;
      }
    | null;
  readonly signatureType?: number;
  readonly funderAddress?: string;
};

export type LlmProvider = "openai" | "anthropic" | "gemini" | "groq" | "grok" | "glm";

type EnvLine =
  | {
      readonly type: "blank";
      readonly raw: string;
    }
  | {
      readonly type: "comment";
      readonly raw: string;
    }
  | {
      readonly type: "entry";
      readonly key: string;
      readonly value: string;
      readonly raw: string;
    };

export type EnvFile = {
  readonly exists: boolean;
  readonly lines: EnvLine[];
  readonly values: Record<string, string>;
};

const LLM_PROVIDER_ORDER = ["openai", "anthropic", "gemini", "groq", "grok", "glm"] as const;

const LLM_PROVIDER_KEYS: Record<LlmProvider, readonly string[]> = {
  openai: ["OPENAI_API_KEY"],
  anthropic: ["ANTHROPIC_API_KEY"],
  gemini: ["GOOGLE_GENERATIVE_AI_API_KEY"],
  groq: ["GROQ_API_KEY"],
  grok: ["XAI_API_KEY"],
  glm: ["GLM_API_KEY"],
};

const LLM_MODEL_KEYS: Record<LlmProvider, readonly string[]> = {
  openai: ["OPENAI_LARGE_MODEL", "LARGE_MODEL"],
  anthropic: ["ANTHROPIC_LARGE_MODEL", "LARGE_MODEL"],
  gemini: ["GOOGLE_LARGE_MODEL", "LARGE_MODEL"],
  groq: ["GROQ_LARGE_MODEL", "LARGE_MODEL"],
  grok: ["XAI_MODEL", "XAI_LARGE_MODEL", "LARGE_MODEL"],
  glm: ["GLM_LARGE_MODEL", "LARGE_MODEL"],
};

export const PrivateKeySchema = z
  .string()
  .transform((v) => (v.startsWith("0x") ? v : `0x${v}`))
  .pipe(z.string().regex(/^0x[0-9a-fA-F]{64}$/));

function normalizeEnvValue(value: string | undefined): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  if (trimmed.length === 0) return null;
  if (trimmed.toLowerCase() === "null" || trimmed.toLowerCase() === "undefined") {
    return null;
  }
  return trimmed;
}

export function parseArgs(argv: readonly string[]): { command: Command; options: CliOptions } {
  const [rawCommand, ...rest] = argv;
  const command = (rawCommand ?? "chat") as Command;

  const defaults: CliOptions = {
    execute: false,
    intervalMs: 30_000,
    iterations: 10,
    orderSize: 1,
    maxPages: 1,
    chain: "polygon",
    rpcUrl: null,
    privateKey: null,
    clobApiUrl: null,
  };

  const mutable: {
    execute: boolean;
    intervalMs: number;
    iterations: number;
    orderSize: number;
    maxPages: number;
    chain: string;
    rpcUrl: string | null;
    privateKey: string | null;
    clobApiUrl: string | null;
  } = { ...defaults };

  for (let i = 0; i < rest.length; i += 1) {
    const a = rest[i];
    if (a === "--execute") {
      mutable.execute = true;
      continue;
    }
    if (a === "--interval-ms") {
      const v = rest[i + 1];
      if (typeof v === "string") {
        const parsed = Number(v);
        if (Number.isFinite(parsed) && parsed > 0) mutable.intervalMs = parsed;
        i += 1;
      }
      continue;
    }
    if (a === "--iterations") {
      const v = rest[i + 1];
      if (typeof v === "string") {
        const parsed = Number(v);
        if (Number.isFinite(parsed) && parsed > 0) mutable.iterations = Math.floor(parsed);
        i += 1;
      }
      continue;
    }
    if (a === "--order-size") {
      const v = rest[i + 1];
      if (typeof v === "string") {
        const parsed = Number(v);
        if (Number.isFinite(parsed) && parsed > 0) mutable.orderSize = parsed;
        i += 1;
      }
      continue;
    }
    if (a === "--max-pages") {
      const v = rest[i + 1];
      if (typeof v === "string") {
        const parsed = Number(v);
        if (Number.isFinite(parsed) && parsed > 0) mutable.maxPages = Math.floor(parsed);
        i += 1;
      }
      continue;
    }
    if (a === "--chain") {
      const v = rest[i + 1];
      if (typeof v === "string" && v.trim().length > 0) {
        mutable.chain = v.trim();
        i += 1;
      }
      continue;
    }
    if (a === "--rpc-url") {
      const v = rest[i + 1];
      if (typeof v === "string" && v.trim().length > 0) {
        mutable.rpcUrl = v.trim();
        i += 1;
      }
      continue;
    }
    if (a === "--private-key") {
      const v = rest[i + 1];
      if (typeof v === "string" && v.trim().length > 0) {
        mutable.privateKey = v.trim();
        i += 1;
      }
      continue;
    }
    if (a === "--clob-api-url") {
      const v = rest[i + 1];
      if (typeof v === "string" && v.trim().length > 0) {
        mutable.clobApiUrl = v.trim();
        i += 1;
      }
      continue;
    }
  }

  if (!["help", "verify", "chat", "settings", "input-test"].includes(command)) {
    return { command: "help", options: defaults };
  }
  return { command, options: mutable };
}

export function loadEnvConfig(options: CliOptions): EnvConfig {
  const privateKeyRaw =
    options.privateKey ??
    process.env.EVM_PRIVATE_KEY ??
    process.env.POLYMARKET_PRIVATE_KEY ??
    process.env.WALLET_PRIVATE_KEY ??
    process.env.PRIVATE_KEY;

  if (typeof privateKeyRaw !== "string") {
    throw new Error(
      "Missing private key. Set EVM_PRIVATE_KEY (recommended) or POLYMARKET_PRIVATE_KEY."
    );
  }

  const privateKey = PrivateKeySchema.parse(privateKeyRaw);

  const clobApiUrlRaw =
    options.clobApiUrl ?? process.env.CLOB_API_URL ?? "https://clob.polymarket.com";
  const clobApiUrl = z.string().url().parse(clobApiUrlRaw);

  const signatureTypeRaw = normalizeEnvValue(
    process.env.POLYMARKET_SIGNATURE_TYPE ?? process.env.CLOB_SIGNATURE_TYPE
  );
  const signatureType =
    signatureTypeRaw !== null
      ? (() => {
          const parsed = Number.parseInt(signatureTypeRaw, 10);
          if (!Number.isFinite(parsed)) {
            throw new Error("POLYMARKET_SIGNATURE_TYPE must be a number.");
          }
          return parsed;
        })()
      : undefined;

  const funderAddress =
    normalizeEnvValue(
      process.env.POLYMARKET_FUNDER_ADDRESS ??
        process.env.POLYMARKET_FUNDER ??
        process.env.CLOB_FUNDER_ADDRESS
    ) ?? undefined;

  const key = normalizeEnvValue(process.env.CLOB_API_KEY);
  const secret = normalizeEnvValue(process.env.CLOB_API_SECRET ?? process.env.CLOB_SECRET);
  const passphrase = normalizeEnvValue(
    process.env.CLOB_API_PASSPHRASE ?? process.env.CLOB_PASS_PHRASE
  );

  const creds =
    typeof key === "string" && typeof secret === "string" && typeof passphrase === "string"
      ? {
          key: z.string().min(1).parse(key),
          secret: z.string().min(1).parse(secret),
          passphrase: z.string().min(1).parse(passphrase),
        }
      : null;

  if (options.execute && key === null) {
    throw new Error("CLOB_API_KEY is missing or empty.");
  }

  if (options.execute && creds === null) {
    throw new Error(
      "Missing CLOB API credentials for --execute. Set CLOB_API_KEY, CLOB_API_SECRET, CLOB_API_PASSPHRASE."
    );
  }

  return {
    privateKey,
    clobApiUrl,
    creds,
    ...(typeof signatureType === "number" ? { signatureType } : {}),
    ...(typeof funderAddress === "string" ? { funderAddress } : {}),
  };
}

export function resolveEnvPath(): string {
  const __filename = fileURLToPath(import.meta.url);
  const __dirname = path.dirname(__filename);
  return path.join(__dirname, ".env");
}

function parseEnvValue(raw: string): string {
  const trimmed = raw.trim();
  if (trimmed.length === 0) return "";
  if (trimmed.startsWith('"') && trimmed.endsWith('"')) {
    const inner = trimmed.slice(1, -1);
    return inner.replace(/\\n/g, "\n").replace(/\\"/g, '"').replace(/\\\\/g, "\\");
  }
  if (trimmed.startsWith("'") && trimmed.endsWith("'")) {
    return trimmed.slice(1, -1);
  }
  return trimmed;
}

function formatEnvValue(value: string): string {
  if (!/[\s#"'\\]/.test(value)) return value;
  const escaped = value.replace(/\\/g, "\\\\").replace(/"/g, '\\"').replace(/\n/g, "\\n");
  return `"${escaped}"`;
}

function parseEnvLine(line: string): EnvLine {
  const trimmed = line.trim();
  if (trimmed.length === 0) {
    return { type: "blank", raw: line };
  }
  if (trimmed.startsWith("#")) {
    return { type: "comment", raw: line };
  }
  const match = /^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)\s*$/.exec(line);
  if (!match) {
    return { type: "comment", raw: line };
  }
  const key = match[1] ?? "";
  const rawValue = match[2] ?? "";
  return { type: "entry", key, value: parseEnvValue(rawValue), raw: line };
}

function serializeEnvLines(lines: readonly EnvLine[]): string {
  return lines
    .map((line) => {
      if (line.type === "entry") {
        return `${line.key}=${formatEnvValue(line.value)}`;
      }
      return line.raw;
    })
    .join("\n")
    .trimEnd()
    .concat("\n");
}

export async function readEnvFile(envPath: string): Promise<EnvFile> {
  try {
    const contents = await fs.readFile(envPath, "utf8");
    const rawLines = contents.split(/\r?\n/);
    const lines = rawLines.map((line) => parseEnvLine(line));
    const values: Record<string, string> = {};
    for (const line of lines) {
      if (line.type === "entry") {
        values[line.key] = line.value;
      }
    }
    return { exists: true, lines, values };
  } catch (error) {
    if (error instanceof Error && "code" in error) {
      const code = (error as { code?: string }).code;
      if (code === "ENOENT") {
        return { exists: false, lines: [], values: {} };
      }
    }
    throw error;
  }
}

export async function writeEnvFile(
  envPath: string,
  existingLines: readonly EnvLine[],
  updates: Record<string, string>
): Promise<void> {
  const pending = new Map(Object.entries(updates));
  const nextLines: EnvLine[] = existingLines.map((line) => {
    if (line.type !== "entry") return line;
    if (!pending.has(line.key)) return line;
    const value = pending.get(line.key) ?? "";
    pending.delete(line.key);
    return {
      type: "entry",
      key: line.key,
      value,
      raw: `${line.key}=${formatEnvValue(value)}`,
    };
  });
  for (const [key, value] of pending.entries()) {
    nextLines.push({
      type: "entry",
      key,
      value,
      raw: `${key}=${formatEnvValue(value)}`,
    });
  }
  const serialized = serializeEnvLines(nextLines);
  await fs.writeFile(envPath, serialized, "utf8");
}

export function applyEnvValues(values: Record<string, string>): void {
  for (const [key, value] of Object.entries(values)) {
    process.env[key] = value;
  }
}

export function resolveLlmProvider(
  getValue: (key: string) => string | undefined
): LlmProvider | null {
  const explicit = normalizeEnvValue(
    getValue("ELIZA_LLM_PROVIDER") ?? getValue("LLM_PROVIDER")
  );
  if (explicit) {
    if (LLM_PROVIDER_ORDER.includes(explicit as LlmProvider)) {
      return explicit as LlmProvider;
    }
  }
  for (const provider of LLM_PROVIDER_ORDER) {
    const keys = LLM_PROVIDER_KEYS[provider];
    for (const key of keys) {
      if (normalizeEnvValue(getValue(key))) {
        return provider;
      }
    }
  }
  return null;
}

export function resolveLlmModel(
  provider: LlmProvider | null,
  getValue: (key: string) => string | undefined
): string | null {
  const explicit = normalizeEnvValue(getValue("ELIZA_LLM_MODEL") ?? getValue("LLM_MODEL"));
  if (explicit) return explicit;
  if (!provider) return null;
  for (const key of LLM_MODEL_KEYS[provider]) {
    const value = normalizeEnvValue(getValue(key));
    if (value) return value;
  }
  return null;
}

// --- Shared LLM runtime helpers (used by both runner.ts and jupiter-runner.ts) ---

export const DEFAULT_LLM_MODELS: Record<LlmProvider, string> = {
  openai: "gpt-5",
  anthropic: "claude-sonnet-4-20250514",
  gemini: "gemini-2.5-pro-preview-03-25",
  groq: "llama-3.3-70b-versatile",
  grok: "grok-3",
  glm: "glm-5",
};

export function resolveLlmProviderFromEnv(): LlmProvider | null {
  return resolveLlmProvider((key) => {
    const value = process.env[key];
    return typeof value === "string" ? value : undefined;
  });
}

export function resolveLlmModelFromEnv(provider: LlmProvider | null): string | null {
  return resolveLlmModel(provider, (key) => {
    const value = process.env[key];
    return typeof value === "string" ? value : undefined;
  });
}

export function buildLlmPlugins(provider: LlmProvider | null): Array<typeof openaiPlugin> {
  if (!provider) return [openaiPlugin];
  switch (provider) {
    case "anthropic":
      return [anthropicPlugin];
    case "gemini":
      return [googleGenAIPlugin];
    case "groq":
      return [groqPlugin];
    case "grok":
      return [XAIPlugin];
    case "glm":
      // GLM Coding Plan uses Anthropic-compatible API at api.z.ai/api/anthropic
      return [anthropicPlugin];
    case "openai":
    default:
      return [openaiPlugin];
  }
}

export function buildLlmRuntimeSettings(provider: LlmProvider | null): Record<string, string | undefined> {
  const model = resolveLlmModelFromEnv(provider);
  const smallModel =
    process.env.ELIZA_LLM_SMALL_MODEL ?? process.env.LLM_SMALL_MODEL ?? model ?? undefined;
  const settings: Record<string, string | undefined> = {
    OPENAI_API_KEY: process.env.OPENAI_API_KEY,
    ANTHROPIC_API_KEY: process.env.ANTHROPIC_API_KEY ?? (provider === "glm" ? process.env.GLM_API_KEY : undefined),
    GOOGLE_GENERATIVE_AI_API_KEY: process.env.GOOGLE_GENERATIVE_AI_API_KEY,
    GROQ_API_KEY: process.env.GROQ_API_KEY,
    XAI_API_KEY: process.env.XAI_API_KEY,
    OPENAI_BASE_URL: process.env.OPENAI_BASE_URL,
    GROQ_BASE_URL: process.env.GROQ_BASE_URL,
    XAI_BASE_URL: process.env.XAI_BASE_URL,
    ANTHROPIC_BASE_URL: process.env.ANTHROPIC_BASE_URL ?? (provider === "glm" ? "https://api.z.ai/api/anthropic" : undefined),
    GOOGLE_API_BASE_URL: process.env.GOOGLE_API_BASE_URL,
    LARGE_MODEL: model ?? undefined,
    SMALL_MODEL: smallModel,
    POSTGRES_URL: process.env.POSTGRES_URL || undefined,
    PGLITE_DATA_DIR: process.env.PGLITE_DATA_DIR || "memory://",
    JUPITER_API_KEY: process.env.JUPITER_API_KEY || undefined,
    SOLANA_PRIVATE_KEY: process.env.SOLANA_PRIVATE_KEY || undefined,
    SOLANA_RPC_URL: process.env.SOLANA_RPC_URL || undefined,
    X402_ENABLED: process.env.X402_ENABLED || undefined,
    X402_MAX_PAYMENT_USD: process.env.X402_MAX_PAYMENT_USD || undefined,
  };
  if (model) {
    if (provider === "openai") settings.OPENAI_LARGE_MODEL = model;
    if (provider === "anthropic" || provider === "glm") settings.ANTHROPIC_LARGE_MODEL = model;
    if (provider === "gemini") settings.GOOGLE_LARGE_MODEL = model;
    if (provider === "groq") settings.GROQ_LARGE_MODEL = model;
    if (provider === "grok") settings.XAI_LARGE_MODEL = model;
  }
  if (smallModel) {
    if (provider === "openai") settings.OPENAI_SMALL_MODEL = smallModel;
    if (provider === "anthropic" || provider === "glm") settings.ANTHROPIC_SMALL_MODEL = smallModel;
    if (provider === "gemini") settings.GOOGLE_SMALL_MODEL = smallModel;
    if (provider === "groq") settings.GROQ_SMALL_MODEL = smallModel;
    if (provider === "grok") settings.XAI_SMALL_MODEL = smallModel;
  }
  return settings;
}