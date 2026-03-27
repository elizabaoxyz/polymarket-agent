/**
 * Live integration tests for Jupiter Prediction API.
 * Uses real API keys from .env — not mocked.
 *
 * Run: JUPITER_LIVE_TESTS=1 bun test jupiter-live.test.ts
 */
import { describe, expect, test } from "bun:test";
import { JupiterPredictionClient } from "./plugins/jupiter-prediction/api";
import { scanAndScore } from "./plugins/jupiter-prediction/scanner";
import { JupiterPredictionService } from "./plugins/jupiter-prediction/service";

const SKIP = process.env.JUPITER_LIVE_TESTS !== "1";
const apiKey = process.env.JUPITER_API_KEY ?? "";
const solanaKey = process.env.SOLANA_PRIVATE_KEY ?? "";

describe("Jupiter Prediction — live API", () => {
  test("getTradingStatus returns operational", async () => {
    if (SKIP) return;
    const client = new JupiterPredictionClient(apiKey);
    const status = await client.getTradingStatus();
    expect(status.trading_active).toBe(true);
  });

  test("getEvents returns live events with markets", async () => {
    if (SKIP) return;
    const client = new JupiterPredictionClient(apiKey);
    const events = await client.getEvents({ status: "live" });
    expect(Array.isArray(events)).toBe(true);
    expect(events.length).toBeGreaterThan(0);
    const first = events[0]!;
    expect(typeof first.eventId).toBe("string");
    expect(typeof first.metadata.title).toBe("string");
    expect(Array.isArray(first.markets)).toBe(true);
  });

  test("getOrderbook returns yes/no depth", async () => {
    if (SKIP) return;
    const client = new JupiterPredictionClient(apiKey);
    const events = await client.getEvents({ status: "live" });
    const market = events[0]?.markets[0];
    expect(market).toBeDefined();
    const book = await client.getOrderbook(market!.marketId);
    expect(Array.isArray(book.yes)).toBe(true);
    expect(Array.isArray(book.no)).toBe(true);
  });

  test("getPositions returns array (may be empty)", async () => {
    if (SKIP) return;
    const client = new JupiterPredictionClient(apiKey);
    const svc = new JupiterPredictionService({ apiKey, solanaPrivateKey: solanaKey });
    const positions = await client.getPositions(svc.ownerPubkey);
    expect(Array.isArray(positions)).toBe(true);
  });

  test("scanAndScore finds opportunities from live data", async () => {
    if (SKIP) return;
    const client = new JupiterPredictionClient(apiKey);
    const events = await client.getEvents({ status: "live" });

    // Grab first 3 markets with orderbooks
    const entries = [];
    for (const event of events.slice(0, 3)) {
      for (const market of event.markets.slice(0, 2)) {
        try {
          const orderbook = await client.getOrderbook(market.marketId);
          entries.push({ market, orderbook, event });
        } catch {
          // skip
        }
        await new Promise((r) => setTimeout(r, 1100)); // rate limit
      }
    }

    const results = scanAndScore(entries, 5);
    expect(Array.isArray(results)).toBe(true);
    // May be 0 if all filtered out, that's fine
    for (const opp of results) {
      expect(opp.totalScore).toBeGreaterThan(0);
      expect(typeof opp.market.marketId).toBe("string");
    }
  }, 30_000); // 30s timeout for rate-limited fetches

  test("JupiterPredictionService.isReady works", async () => {
    if (SKIP) return;
    const svc = new JupiterPredictionService({ apiKey, solanaPrivateKey: solanaKey });
    expect(typeof svc.ownerPubkey).toBe("string");
    expect(svc.ownerPubkey.length).toBeGreaterThan(0);
    const ready = await svc.isReady();
    expect(typeof ready).toBe("boolean");
  });
});
