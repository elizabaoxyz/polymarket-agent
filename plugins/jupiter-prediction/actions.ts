import type { Action, ActionExample } from "@elizaos/core";
import { JupiterPredictionService, JUPITER_SERVICE_TYPE } from "./service";
import { scanAndScore, formatOpportunitySummary } from "./scanner";
import { microUsdToDollars, dollarsToMicroUsd, USDC_MINT, type Market } from "./types";

const SERVICE_KEY = JUPITER_SERVICE_TYPE;

function getService(runtime: { getService: (name: string) => unknown }): JupiterPredictionService {
  const svc = runtime.getService(SERVICE_KEY) as JupiterPredictionService | undefined;
  if (!svc) throw new Error("JupiterPredictionService not initialized.");
  return svc;
}

export const scanJupiterMarkets: Action = {
  name: "SCAN_JUPITER_MARKETS",
  description: "Scan Jupiter Prediction Markets for trading opportunities. Fetches live events, filters by liquidity and spread, and scores the best opportunities.",
  similes: ["scan jupiter", "find jupiter markets", "search predictions", "look for jupiter bets"],
  examples: [
    [
      { name: "user", content: { text: "Scan jupiter prediction markets" } },
      { name: "assistant", content: { text: "Scanning Jupiter Prediction Markets..." } },
    ],
  ] as ActionExample[][],
  validate: async (runtime) => {
    const svc = runtime.getService(SERVICE_KEY);
    return svc !== undefined;
  },
  handler: async (runtime, message, state, options, callback) => {
    const svc = getService(runtime);
    try {
      const events = await svc.client.getEvents({ status: "live" });

      // Pre-filter using pricing data (no orderbook fetch needed)
      // Pick markets with tight spreads and midpoints near 0.50
      const candidates: Array<{ market: Market; event: typeof events[0] }> = [];
      for (const event of events) {
        for (const market of event.markets) {
          const yes = market.pricing.buyYesPriceUsd / 1_000_000;
          const no = market.pricing.buyNoPriceUsd / 1_000_000;
          const spread = Math.abs(no - yes);
          if (spread <= 0.15 && market.status === "open") {
            candidates.push({ market, event });
          }
        }
      }

      // Sort by spread (tightest first), take top 10 for orderbook fetch
      candidates.sort((a, b) => {
        const sa = Math.abs(a.market.pricing.buyNoPriceUsd - a.market.pricing.buyYesPriceUsd);
        const sb = Math.abs(b.market.pricing.buyNoPriceUsd - b.market.pricing.buyYesPriceUsd);
        return sa - sb;
      });
      const top = candidates.slice(0, 10);

      // Fetch orderbooks with 1s delay between requests (free plan: 1 RPS)
      const entries = [];
      for (const { market, event } of top) {
        try {
          const orderbook = await svc.client.getOrderbook(market.marketId);
          entries.push({ market, orderbook, event });
        } catch {
          // Skip on error
        }
        if (entries.length < top.length) {
          await new Promise((r) => setTimeout(r, 1100));
        }
      }

      const opportunities = scanAndScore(entries, 5);
      const summary = formatOpportunitySummary(opportunities);
      if (callback) callback({ text: summary });
      return true;
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      if (callback) callback({ text: `Failed to scan markets: ${msg}` });
      return false;
    }
  },
};

export const placeJupiterBet: Action = {
  name: "PLACE_JUPITER_BET",
  description: "Place a prediction bet on a Jupiter market. Requires market ID, YES/NO direction, and amount in dollars.",
  similes: ["bet on jupiter", "place jupiter order", "buy prediction", "trade jupiter"],
  examples: [
    [
      { name: "user", content: { text: "Bet $5 YES on market abc123" } },
      { name: "assistant", content: { text: "Placing $5 YES bet on market abc123..." } },
    ],
  ] as ActionExample[][],
  validate: async (runtime) => {
    const svc = runtime.getService(SERVICE_KEY);
    return svc !== undefined;
  },
  handler: async (runtime, message, state, options, callback) => {
    const svc = getService(runtime);
    const text = typeof message.content === "string" ? message.content : message.content?.text ?? "";
    const marketIdMatch = /market[:\s]+([a-zA-Z0-9_-]+)/i.exec(text);
    const amountMatch = /\$(\d+(?:\.\d+)?)/i.exec(text);
    const isYes = /\byes\b/i.test(text);
    const isNo = /\bno\b/i.test(text);

    if (!marketIdMatch) {
      if (callback) callback({ text: "Missing market ID. Specify: bet $5 YES on market <id>" });
      return false;
    }
    if (!amountMatch) {
      if (callback) callback({ text: "Missing amount. Specify: bet $5 YES on market <id>" });
      return false;
    }
    if (!isYes && !isNo) {
      if (callback) callback({ text: "Specify YES or NO direction." });
      return false;
    }

    const marketId = marketIdMatch[1]!;
    const dollars = parseFloat(amountMatch[1]!);
    const depositAmount = dollarsToMicroUsd(dollars);

    try {
      if (callback) callback({ text: `Placing $${dollars.toFixed(2)} ${isYes ? "YES" : "NO"} bet on market ${marketId}...` });
      const { orderPubkey, signature } = await svc.placeOrderAndSign({
        ownerPubkey: svc.ownerPubkey,
        marketId,
        isYes,
        isBuy: true,
        depositAmount,
        depositMint: USDC_MINT,
      });
      const status = await svc.waitForFill(orderPubkey);
      const result = status.status === "filled"
        ? `Order filled! Signature: ${signature}`
        : `Order ${status.status}. Pubkey: ${orderPubkey}`;
      if (callback) callback({ text: result });
      return status.status === "filled";
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      if (callback) callback({ text: `Failed to place bet: ${msg}` });
      return false;
    }
  },
};

export const checkJupiterPositions: Action = {
  name: "CHECK_JUPITER_POSITIONS",
  description: "Check current Jupiter Prediction Market positions and P&L.",
  similes: ["my jupiter positions", "jupiter portfolio", "check predictions", "show positions"],
  examples: [
    [
      { name: "user", content: { text: "Show my Jupiter positions" } },
      { name: "assistant", content: { text: "Fetching your Jupiter positions..." } },
    ],
  ] as ActionExample[][],
  validate: async (runtime) => {
    const svc = runtime.getService(SERVICE_KEY);
    return svc !== undefined;
  },
  handler: async (runtime, message, state, options, callback) => {
    const svc = getService(runtime);
    try {
      const positions = await svc.client.getPositions(svc.ownerPubkey);
      if (positions.length === 0) {
        if (callback) callback({ text: "No open positions." });
        return true;
      }
      const lines = positions.map((pos) => {
        const avg = microUsdToDollars(pos.averagePrice).toFixed(2);
        const cur = microUsdToDollars(pos.currentPrice).toFixed(2);
        const direction = pos.isYes ? "YES" : "NO";
        return `${pos.marketId}: ${pos.quantity}x ${direction} @ $${avg} (now $${cur}) [${pos.status}]`;
      });
      if (callback) callback({ text: `Positions:\n${lines.join("\n")}` });
      return true;
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      if (callback) callback({ text: `Failed to fetch positions: ${msg}` });
      return false;
    }
  },
};

export const claimJupiterWinnings: Action = {
  name: "CLAIM_JUPITER_WINNINGS",
  description: "Claim winnings from settled Jupiter Prediction Markets.",
  similes: ["claim jupiter winnings", "collect predictions", "claim payouts"],
  examples: [
    [
      { name: "user", content: { text: "Claim my Jupiter winnings" } },
      { name: "assistant", content: { text: "Claiming settled positions..." } },
    ],
  ] as ActionExample[][],
  validate: async (runtime) => {
    const svc = runtime.getService(SERVICE_KEY);
    return svc !== undefined;
  },
  handler: async (runtime, message, state, options, callback) => {
    const svc = getService(runtime);
    try {
      const positions = await svc.client.getPositions(svc.ownerPubkey);
      const claimable = positions.filter((p) => p.status === "won" || p.status === "claimable");
      if (claimable.length === 0) {
        if (callback) callback({ text: "No claimable positions found." });
        return true;
      }
      const results: string[] = [];
      for (const pos of claimable) {
        try {
          const { transaction } = await svc.client.claimPosition(pos.positionPubkey);
          const signature = await svc.signAndSubmit(transaction);
          results.push(`Claimed ${pos.positionPubkey}: ${signature}`);
        } catch (error) {
          const msg = error instanceof Error ? error.message : String(error);
          results.push(`Failed ${pos.positionPubkey}: ${msg}`);
        }
      }
      if (callback) callback({ text: results.join("\n") });
      return true;
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      if (callback) callback({ text: `Failed to claim: ${msg}` });
      return false;
    }
  },
};
