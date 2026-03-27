import { describe, expect, test, beforeEach, afterEach } from "bun:test";
import { PolymarketExtService } from "../service";
import { POLYMARKET_EXT_SERVICE_TYPE } from "../types";

const originalLog = console.log;
const originalWarn = console.warn;

// Save env vars that the service reads via process.env fallback
const ENV_KEYS = ["EVM_PRIVATE_KEY", "POLYMARKET_PRIVATE_KEY", "CLOB_API_KEY", "CLOB_API_SECRET", "CLOB_API_PASSPHRASE", "CLOB_API_URL"];
let savedEnv: Record<string, string | undefined> = {};

beforeEach(() => {
  console.log = () => {};
  console.warn = () => {};
  // Save and clear env vars so service relies only on runtime.getSetting
  savedEnv = {};
  for (const key of ENV_KEYS) {
    savedEnv[key] = process.env[key];
    delete process.env[key];
  }
});
afterEach(() => {
  console.log = originalLog;
  console.warn = originalWarn;
  // Restore env vars
  for (const key of ENV_KEYS) {
    if (savedEnv[key] !== undefined) {
      process.env[key] = savedEnv[key];
    }
  }
});

describe("PolymarketExtService", () => {
  test("serviceType matches constant", () => {
    expect(PolymarketExtService.serviceType).toBe(POLYMARKET_EXT_SERVICE_TYPE);
  });

  test("starts in full mode with all credentials", async () => {
    globalThis.fetch = (async () => new Response("{}")) as typeof fetch;

    const runtime = {
      getSetting: (key: string) => {
        const map: Record<string, string> = {
          CLOB_API_KEY: "test-key",
          CLOB_API_SECRET: "dGVzdC1zZWNyZXQ=",
          CLOB_API_PASSPHRASE: "test-pass",
          CLOB_API_URL: "https://clob.polymarket.com",
          EVM_PRIVATE_KEY: "0x0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef",
        };
        return map[key];
      },
    };

    const svc = await PolymarketExtService.start(runtime);
    expect(svc.isFullyActive()).toBe(true);
    expect(svc.clob).not.toBeNull();
    expect(svc.data).toBeDefined();
    expect(svc.walletAddress).toBeDefined();
    expect(svc.walletAddress.length).toBeGreaterThan(0);
    svc.stop();
  });

  test("starts in degraded mode without CLOB credentials", async () => {
    const runtime = {
      getSetting: (key: string) => {
        const map: Record<string, string> = {
          EVM_PRIVATE_KEY: "0x0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef",
        };
        return map[key];
      },
    };

    const svc = await PolymarketExtService.start(runtime);
    expect(svc.isFullyActive()).toBe(false);
    expect(svc.clob).toBeNull();
    expect(svc.data).toBeDefined();
    expect(svc.walletAddress.length).toBeGreaterThan(0);
    svc.stop();
  });

  test("starts in disabled mode without EVM_PRIVATE_KEY", async () => {
    const runtime = { getSetting: (_key: string) => undefined };

    const svc = await PolymarketExtService.start(runtime);
    expect(svc.isFullyActive()).toBe(false);
    expect(svc.walletAddress).toBe("");
    svc.stop();
  });

  test("stop() clears heartbeat interval and is safe to call twice", async () => {
    globalThis.fetch = (async () => new Response("{}")) as typeof fetch;

    const runtime = {
      getSetting: (key: string) => {
        const map: Record<string, string> = {
          CLOB_API_KEY: "test-key",
          CLOB_API_SECRET: "dGVzdC1zZWNyZXQ=",
          CLOB_API_PASSPHRASE: "test-pass",
          EVM_PRIVATE_KEY: "0x0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef",
        };
        return map[key];
      },
    };

    const svc = await PolymarketExtService.start(runtime);
    expect(svc.isFullyActive()).toBe(true);
    svc.stop();
    svc.stop(); // should not throw
  });
});
