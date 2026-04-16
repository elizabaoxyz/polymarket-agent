import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import type { Content } from "@elizaos/core";
import {
  directLlmCall,
  resolveAutonomyLlmProvider,
  shouldUseAutonomyEnsemble,
} from "./autonomy-llm";
import type { AutonomyCallbacks, AutonomyDeps } from "./autonomy-state";

const ENV_KEYS = [
  "ELIZA_LLM_PROVIDER",
  "LLM_PROVIDER",
  "AUTONOMY_LLM_ENSEMBLE",
  "OPENAI_EMBEDDINGS_ONLY",
  "OPENAI_API_KEY",
  "OPENAI_BASE_URL",
  "OPENAI_LARGE_MODEL",
  "ANTHROPIC_API_KEY",
  "ANTHROPIC_BASE_URL",
  "ANTHROPIC_LARGE_MODEL",
  "GLM_API_KEY",
  "GLM_LARGE_MODEL",
  "GOOGLE_GENERATIVE_AI_API_KEY",
  "GROQ_API_KEY",
  "XAI_API_KEY",
  "LARGE_MODEL",
] as const;

let savedEnv: Partial<Record<(typeof ENV_KEYS)[number], string | undefined>>;
let originalFetch: typeof fetch;

function createDeps(handleMessage: AutonomyDeps["messageService"]["handleMessage"]): AutonomyDeps {
  return {
    runtime: {} as never,
    messageService: { handleMessage },
    roomId: "room" as never,
    userId: "user" as never,
    ragSvc: null,
    connectorsSvc: null,
    runtimeMutex: {
      runExclusive: async <T>(fn: () => Promise<T>) => fn(),
    } as never,
  };
}

function createCallbacks(logs: string[]): AutonomyCallbacks {
  return {
    send: () => {},
    log: (text) => {
      logs.push(text);
    },
  };
}

beforeEach(() => {
  savedEnv = {};
  for (const key of ENV_KEYS) {
    savedEnv[key] = process.env[key];
    delete process.env[key];
  }
  originalFetch = globalThis.fetch;
});

afterEach(() => {
  for (const key of ENV_KEYS) {
    const value = savedEnv[key];
    if (value === undefined) {
      delete process.env[key];
    } else {
      process.env[key] = value;
    }
  }
  globalThis.fetch = originalFetch;
});

describe("autonomy LLM provider selection", () => {
  test("honors explicit provider selection over other available API keys", () => {
    process.env.ELIZA_LLM_PROVIDER = "gemini";
    process.env.OPENAI_API_KEY = "openai-key";
    process.env.ANTHROPIC_API_KEY = "anthropic-key";
    process.env.GOOGLE_GENERATIVE_AI_API_KEY = "gemini-key";

    expect(resolveAutonomyLlmProvider()).toBe("gemini");
  });

  test("ensemble is opt-in and disabled when OpenAI is embeddings-only", () => {
    process.env.OPENAI_API_KEY = "openai-key";
    process.env.ANTHROPIC_API_KEY = "anthropic-key";

    expect(shouldUseAutonomyEnsemble()).toBe(false);

    process.env.AUTONOMY_LLM_ENSEMBLE = "true";
    expect(shouldUseAutonomyEnsemble()).toBe(true);

    process.env.OPENAI_EMBEDDINGS_ONLY = "true";
    expect(shouldUseAutonomyEnsemble()).toBe(false);
  });
});

describe("directLlmCall", () => {
  test("uses the configured OpenAI provider even when Anthropic credentials exist", async () => {
    process.env.ELIZA_LLM_PROVIDER = "openai";
    process.env.OPENAI_API_KEY = "openai-key";
    process.env.ANTHROPIC_API_KEY = "anthropic-key";

    const fetchUrls: string[] = [];
    globalThis.fetch = (async (input: RequestInfo | URL) => {
      const url = typeof input === "string" ? input : input.toString();
      fetchUrls.push(url);
      return new Response(
        JSON.stringify({
          choices: [
            {
              message: {
                content:
                  "PICK: 1\nSIDE: YES\nESTIMATE: 0.61\nEDGE: 0.11\nCONFIDENCE: 0.70\nCATEGORY: CRYPTO\nREASON: test",
              },
            },
          ],
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      );
    }) as typeof fetch;

    const result = await directLlmCall(
      createDeps(async () => undefined),
      createCallbacks([]),
      "hello",
      50,
    );

    expect(fetchUrls).toHaveLength(1);
    expect(fetchUrls[0]).toContain("/chat/completions");
    expect(result).toContain("PICK: 1");
  });

  test("falls back to the runtime message handler for unsupported direct providers", async () => {
    process.env.ELIZA_LLM_PROVIDER = "gemini";
    process.env.GOOGLE_GENERATIVE_AI_API_KEY = "gemini-key";
    process.env.OPENAI_API_KEY = "openai-key";
    process.env.ANTHROPIC_API_KEY = "anthropic-key";

    let fetchCalls = 0;
    globalThis.fetch = (async () => {
      fetchCalls++;
      return new Response("unexpected", { status: 500 });
    }) as typeof fetch;

    const logs: string[] = [];
    const result = await directLlmCall(
      createDeps(async (_runtime, _memory, callback) => {
        await callback({ text: "fallback response" } as Content);
        return undefined;
      }),
      createCallbacks(logs),
      "hello",
      50,
    );

    expect(fetchCalls).toBe(0);
    expect(result).toBe("fallback response");
    expect(logs.some((line) => line.includes('configured provider "gemini"'))).toBe(true);
  });
});
