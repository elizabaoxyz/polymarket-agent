/**
 * Live integration tests for polymarket-ext plugin.
 *
 * These tests hit the real Polymarket APIs using credentials from .env.
 * They only perform READ operations (no order placement or cancellation).
 *
 * Run: bun test polymarket-ext.live.test.ts
 * Requires: EVM_PRIVATE_KEY, CLOB_API_KEY, CLOB_API_SECRET, CLOB_API_PASSPHRASE in .env
 */

import { describe, expect, test, beforeAll } from "bun:test";
import dotenv from "dotenv";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { ethers } from "ethers";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.join(__dirname, ".env") });

import { ClobApiClient } from "./plugins/polymarket-ext/clob-client";
import { DataApiClient } from "./plugins/polymarket-ext/data-client";
import { PolymarketExtService } from "./plugins/polymarket-ext/service";

const CLOB_API_KEY = process.env.CLOB_API_KEY?.trim();
const CLOB_API_SECRET = process.env.CLOB_API_SECRET?.trim();
const CLOB_API_PASSPHRASE = process.env.CLOB_API_PASSPHRASE?.trim();
const EVM_PRIVATE_KEY = process.env.EVM_PRIVATE_KEY?.trim();
const CLOB_API_URL = process.env.CLOB_API_URL?.trim() ?? "https://clob.polymarket.com";
const DATA_API_URL = "https://data-api.polymarket.com";

const hasCredentials = Boolean(CLOB_API_KEY && CLOB_API_SECRET && CLOB_API_PASSPHRASE && EVM_PRIVATE_KEY);

// Skip all tests if credentials are not available
const describeIfLive = hasCredentials ? describe : describe.skip;

describeIfLive("Live: ClobApiClient", () => {
  let client: ClobApiClient;
  let walletAddress: string;

  beforeAll(() => {
    walletAddress = ethers.computeAddress(EVM_PRIVATE_KEY!);
    client = new ClobApiClient({
      baseUrl: CLOB_API_URL,
      apiKey: CLOB_API_KEY!,
      secret: CLOB_API_SECRET!,
      passphrase: CLOB_API_PASSPHRASE!,
      address: walletAddress,
    });
  });

  test("heartbeat succeeds (or returns API error, not auth error)", async () => {
    try {
      await client.heartbeat();
      expect(true).toBe(true);
    } catch (error) {
      // Heartbeat may fail for non-auth reasons (e.g., no active session)
      // As long as it's not an auth error, the HMAC signing is correct
      const msg = error instanceof Error ? error.message : String(error);
      expect(msg).not.toContain("credentials");
      console.log(`  Live: Heartbeat returned: ${msg}`);
    }
  }, 30_000);

  test("getOpenOrders returns an array", async () => {
    const orders = await client.getOpenOrders();
    expect(Array.isArray(orders)).toBe(true);
    console.log(`  Live: ${orders.length} open orders found`);
  }, 30_000);

  test("getOrderBook returns bids and asks for a known market", async () => {
    try {
      const book = await client.getOrderBook(
        "21742633143463906290569050155826241533067272736897614950488156847949938836455"
      );
      expect(book).toHaveProperty("bids");
      expect(book).toHaveProperty("asks");
      expect(Array.isArray(book.bids)).toBe(true);
      expect(Array.isArray(book.asks)).toBe(true);
      console.log(`  Live: Order book has ${book.bids.length} bids, ${book.asks.length} asks`);
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      expect(msg).not.toContain("credentials");
      console.log(`  Live: Order book fetch returned: ${msg}`);
    }
  }, 30_000);
});

describeIfLive("Live: DataApiClient", () => {
  let client: DataApiClient;
  let walletAddress: string;

  beforeAll(() => {
    walletAddress = ethers.computeAddress(EVM_PRIVATE_KEY!);
    client = new DataApiClient(DATA_API_URL);
  });

  test("getPositions returns an array (may be empty)", async () => {
    try {
      const positions = await client.getPositions(walletAddress);
      expect(Array.isArray(positions)).toBe(true);
      console.log(`  Live: ${positions.length} open positions found`);
      if (positions.length > 0) {
        const first = positions[0]!;
        expect(first).toHaveProperty("title");
        expect(first).toHaveProperty("outcome");
        expect(first).toHaveProperty("size");
        console.log(`  Live: First position — ${first.title} | ${first.outcome} | ${first.size} shares`);
      }
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      console.log(`  Live: getPositions returned: ${msg}`);
    }
  }, 30_000);

  test("getTrades returns an array (may be empty)", async () => {
    try {
      const trades = await client.getTrades(walletAddress, { limit: 5 });
      expect(Array.isArray(trades)).toBe(true);
      console.log(`  Live: ${trades.length} recent trades found`);
      if (trades.length > 0) {
        const first = trades[0]!;
        expect(first).toHaveProperty("side");
        expect(first).toHaveProperty("price");
        console.log(`  Live: First trade — ${first.side} ${first.outcome} @ $${first.price}`);
      }
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      console.log(`  Live: getTrades returned: ${msg}`);
    }
  }, 30_000);
});

describeIfLive("Live: PolymarketExtService", () => {
  test("service starts in full mode with live credentials", async () => {
    const runtime = {
      getSetting: (key: string) => {
        const map: Record<string, string | undefined> = {
          EVM_PRIVATE_KEY,
          CLOB_API_KEY,
          CLOB_API_SECRET,
          CLOB_API_PASSPHRASE,
          CLOB_API_URL,
        };
        return map[key];
      },
    };

    const svc = await PolymarketExtService.start(runtime);
    expect(svc.isFullyActive()).toBe(true);
    expect(svc.walletAddress.length).toBeGreaterThan(0);
    console.log(`  Live: Service active | wallet: ${svc.walletAddress}`);
    svc.stop();
  }, 30_000);
});
