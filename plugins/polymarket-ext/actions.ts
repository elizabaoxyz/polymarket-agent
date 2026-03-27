import type { Action, ActionExample } from "@elizaos/core";
import { PolymarketExtService } from "./service";
import { POLYMARKET_EXT_SERVICE_TYPE, type OpenOrder, type ClobMarket, type ClobToken } from "./types";

function getService(runtime: { getService: (name: string) => unknown }): PolymarketExtService {
  const svc = runtime.getService(POLYMARKET_EXT_SERVICE_TYPE) as PolymarketExtService | undefined;
  if (!svc) throw new Error("PolymarketExtService not initialized.");
  return svc;
}

function getMessageText(message: { content: string | { text?: string } }): string {
  return typeof message.content === "string" ? message.content : message.content?.text ?? "";
}

function requireClob(svc: PolymarketExtService, callback?: (r: { text: string }) => void): boolean {
  if (svc.isFullyActive()) return true;
  if (callback) callback({ text: "CLOB credentials not configured. Run settings to add API keys." });
  return false;
}

function shortenId(id: string): string {
  if (id.length <= 12) return id;
  return `${id.slice(0, 6)}...${id.slice(-4)}`;
}

function formatOrder(order: OpenOrder): string {
  const filled = `${order.size_matched}/${order.original_size}`;
  return `${shortenId(order.id)} | ${order.side} @ ${order.price} | ${filled} filled | ${order.order_type}`;
}

// --- P0: Cancel Order ---

export const cancelPolymarketOrder: Action = {
  name: "CANCEL_POLYMARKET_ORDER",
  description: "Cancel a specific open Polymarket order by ID.",
  similes: ["cancel order", "remove order", "withdraw order"],
  examples: [
    [
      { name: "user", content: { text: "Cancel order abc-123-def" } },
      { name: "assistant", content: { text: "Cancelling order abc-123-def..." } },
    ],
  ] as ActionExample[][],
  validate: async (runtime) => runtime.getService(POLYMARKET_EXT_SERVICE_TYPE) !== undefined,
  handler: async (runtime, message, _state, _options, callback) => {
    const svc = getService(runtime);
    if (!requireClob(svc, callback)) return false;

    const text = getMessageText(message);
    const match = /([a-fA-F0-9-]{8,})/.exec(text);
    if (!match) {
      if (callback) callback({ text: "Missing order ID. Specify: cancel order <id>" });
      return false;
    }

    const orderId = match[1]!;
    try {
      const result = await svc.clob!.cancelOrder(orderId);
      if (callback) callback({ text: `Cancelled order ${result.canceled}` });
      return true;
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      if (callback) callback({ text: `Failed to cancel order: ${msg}` });
      return false;
    }
  },
};

// --- P0: Cancel All Orders ---

export const cancelAllPolymarketOrders: Action = {
  name: "CANCEL_ALL_POLYMARKET_ORDERS",
  description: "Cancel all open Polymarket orders, or all orders for a specific market.",
  similes: ["cancel all orders", "cancel everything", "clear all orders"],
  examples: [
    [
      { name: "user", content: { text: "Cancel all my orders" } },
      { name: "assistant", content: { text: "Cancelling all open orders..." } },
    ],
  ] as ActionExample[][],
  validate: async (runtime) => runtime.getService(POLYMARKET_EXT_SERVICE_TYPE) !== undefined,
  handler: async (runtime, message, _state, _options, callback) => {
    const svc = getService(runtime);
    if (!requireClob(svc, callback)) return false;

    try {
      const result = await svc.clob!.cancelAll();
      const count = result.canceled.length;
      if (count === 0) {
        if (callback) callback({ text: "No open orders to cancel." });
      } else {
        if (callback) callback({ text: `Cancelled ${count} orders: ${result.canceled.map(shortenId).join(", ")}` });
      }
      return true;
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      if (callback) callback({ text: `Failed to cancel orders: ${msg}` });
      return false;
    }
  },
};

// --- P0: Get Open Orders ---

export const getPolymarketOpenOrders: Action = {
  name: "GET_POLYMARKET_OPEN_ORDERS",
  description: "List all open Polymarket orders with status details.",
  similes: ["show orders", "my open orders", "list orders", "pending orders"],
  examples: [
    [
      { name: "user", content: { text: "Show my open orders" } },
      { name: "assistant", content: { text: "Fetching open orders..." } },
    ],
  ] as ActionExample[][],
  validate: async (runtime) => runtime.getService(POLYMARKET_EXT_SERVICE_TYPE) !== undefined,
  handler: async (runtime, message, _state, _options, callback) => {
    const svc = getService(runtime);
    if (!requireClob(svc, callback)) return false;

    try {
      const orders = await svc.clob!.getOpenOrders();
      if (orders.length === 0) {
        if (callback) callback({ text: "No open orders." });
        return true;
      }
      const lines = orders.map(formatOrder);
      if (callback) callback({ text: `Open orders (${orders.length}):\n${lines.join("\n")}` });
      return true;
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      if (callback) callback({ text: `Failed to fetch orders: ${msg}` });
      return false;
    }
  },
};

// --- P1: Sell Position ---

export const sellPolymarketPosition: Action = {
  name: "SELL_POLYMARKET_POSITION",
  description: "Sell shares to exit a Polymarket position. Specify token ID and number of shares. Uses best bid price if no price given.",
  similes: ["sell position", "exit position", "close position", "sell shares"],
  examples: [
    [
      { name: "user", content: { text: "Sell 50 shares of token token-abc at $0.60" } },
      { name: "assistant", content: { text: "Selling 50 shares..." } },
    ],
  ] as ActionExample[][],
  validate: async (runtime) => runtime.getService(POLYMARKET_EXT_SERVICE_TYPE) !== undefined,
  handler: async (runtime, message, _state, _options, callback) => {
    const svc = getService(runtime);
    if (!requireClob(svc, callback)) return false;

    const text = getMessageText(message);

    const tokenMatch = /token[:\s]+([a-zA-Z0-9_-]+)/i.exec(text);
    if (!tokenMatch) {
      if (callback) callback({ text: "Missing token ID. Specify: sell <N> shares of token <tokenId>" });
      return false;
    }
    const tokenId = tokenMatch[1]!;

    const sharesMatch = /(\d+(?:\.\d+)?)\s*shares/i.exec(text);
    if (!sharesMatch) {
      if (callback) callback({ text: "Missing share count. Specify: sell <N> shares of token <tokenId>" });
      return false;
    }
    const shares = parseFloat(sharesMatch[1]!);

    const priceMatch = /\$(\d+(?:\.\d+)?)/i.exec(text);
    let price: number;

    if (priceMatch) {
      price = parseFloat(priceMatch[1]!);
    } else {
      try {
        const book = await svc.clob!.getOrderBook(tokenId);
        if (book.bids.length === 0) {
          if (callback) callback({ text: "No bids in order book. Cannot determine sell price." });
          return false;
        }
        price = parseFloat(book.bids[0]!.price);
      } catch (error) {
        const msg = error instanceof Error ? error.message : String(error);
        if (callback) callback({ text: `Failed to fetch order book: ${msg}` });
        return false;
      }
    }

    try {
      const result = await svc.sellOrder({ tokenId, price, size: shares });
      const txInfo = result.transactionsHashes.length > 0
        ? ` | tx: ${shortenId(result.transactionsHashes[0]!)}`
        : "";
      if (callback) callback({ text: `SELL ${shares} shares of ${shortenId(tokenId)} @ $${price.toFixed(2)}\nOrder: ${shortenId(result.orderID)} — ${result.status}${txInfo}` });
      return true;
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      if (callback) callback({ text: `Failed to sell: ${msg}` });
      return false;
    }
  },
};

// --- P2: Get Positions ---

export const getPolymarketPositions: Action = {
  name: "GET_POLYMARKET_POSITIONS",
  description: "Show current Polymarket portfolio positions with live pricing and unrealized PnL.",
  similes: ["my positions", "portfolio", "show holdings", "what do I own"],
  examples: [
    [
      { name: "user", content: { text: "Show my Polymarket positions" } },
      { name: "assistant", content: { text: "Fetching positions..." } },
    ],
  ] as ActionExample[][],
  validate: async (runtime) => runtime.getService(POLYMARKET_EXT_SERVICE_TYPE) !== undefined,
  handler: async (runtime, _message, _state, _options, callback) => {
    const svc = getService(runtime);
    if (!svc.walletAddress) {
      if (callback) callback({ text: "No wallet configured. Set EVM_PRIVATE_KEY." });
      return false;
    }

    try {
      const positions = await svc.data.getPositions(svc.walletAddress);
      if (positions.length === 0) {
        if (callback) callback({ text: "No open positions." });
        return true;
      }
      const lines = positions.map((pos) => {
        const unrealized = (pos.cur_price - pos.avg_price) * pos.size;
        const pnlPct = pos.avg_price > 0 ? ((pos.cur_price - pos.avg_price) / pos.avg_price * 100).toFixed(1) : "0.0";
        const sign = unrealized >= 0 ? "+" : "";
        return `${pos.title} | ${pos.outcome} | ${pos.size} shares @ $${pos.avg_price.toFixed(2)} → $${pos.cur_price.toFixed(2)} | ${sign}$${unrealized.toFixed(2)} (${sign}${pnlPct}%)`;
      });
      if (callback) callback({ text: `Positions (${positions.length}):\n${lines.join("\n")}` });
      return true;
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      if (callback) callback({ text: `Failed to fetch positions: ${msg}` });
      return false;
    }
  },
};

// --- P2: Get Trades ---

export const getPolymarketTrades: Action = {
  name: "GET_POLYMARKET_TRADES",
  description: "Show recent Polymarket trade history.",
  similes: ["trade history", "recent trades", "my trades", "show fills"],
  examples: [
    [
      { name: "user", content: { text: "Show my recent trades" } },
      { name: "assistant", content: { text: "Fetching trade history..." } },
    ],
  ] as ActionExample[][],
  validate: async (runtime) => runtime.getService(POLYMARKET_EXT_SERVICE_TYPE) !== undefined,
  handler: async (runtime, message, _state, _options, callback) => {
    const svc = getService(runtime);
    if (!svc.walletAddress) {
      if (callback) callback({ text: "No wallet configured. Set EVM_PRIVATE_KEY." });
      return false;
    }

    const text = getMessageText(message);
    const limitMatch = /(\d+)\s*trades/i.exec(text);
    const limit = limitMatch ? parseInt(limitMatch[1]!, 10) : 20;

    try {
      const trades = await svc.data.getTrades(svc.walletAddress, { limit });
      if (trades.length === 0) {
        if (callback) callback({ text: "No trades found." });
        return true;
      }
      const lines = trades.map((t) => {
        return `${t.side} ${t.outcome} | ${t.title} | ${t.size} @ $${t.price.toFixed(2)} | ${t.timestamp} | tx: ${shortenId(t.transaction_hash)}`;
      });
      if (callback) callback({ text: `Recent trades (${trades.length}):\n${lines.join("\n")}` });
      return true;
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      if (callback) callback({ text: `Failed to fetch trades: ${msg}` });
      return false;
    }
  },
};

// --- P3: Get PnL ---

export const getPolymarketPnl: Action = {
  name: "GET_POLYMARKET_PNL",
  description: "Show Polymarket profit/loss summary including realized PnL, unrealized PnL, and volume.",
  similes: ["my pnl", "profit and loss", "how am I doing", "performance", "earnings"],
  examples: [
    [
      { name: "user", content: { text: "Show my PnL" } },
      { name: "assistant", content: { text: "Fetching PnL summary..." } },
    ],
  ] as ActionExample[][],
  validate: async (runtime) => runtime.getService(POLYMARKET_EXT_SERVICE_TYPE) !== undefined,
  handler: async (runtime, _message, _state, _options, callback) => {
    const svc = getService(runtime);
    if (!svc.walletAddress) {
      if (callback) callback({ text: "No wallet configured. Set EVM_PRIVATE_KEY." });
      return false;
    }

    try {
      const pnl = await svc.data.getPnl(svc.walletAddress);
      const lines = [
        `Realized PnL:   $${pnl.total_realized.toFixed(2)}`,
        `Unrealized PnL: $${pnl.total_unrealized.toFixed(2)}`,
        `Total Volume:   $${pnl.total_volume.toFixed(2)}`,
      ];
      if (pnl.positions_won !== undefined && pnl.positions_lost !== undefined) {
        lines.push(`Win/Loss:       ${pnl.positions_won}W / ${pnl.positions_lost}L`);
      }
      if (callback) callback({ text: lines.join("\n") });
      return true;
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      if (callback) callback({ text: `Failed to fetch PnL: ${msg}` });
      return false;
    }
  },
};

// --- Place Order (with correct token resolution) ---

function resolveToken(market: ClobMarket, outcome: string): ClobToken | null {
  const normalized = outcome.toLowerCase();
  return market.tokens.find((t) => t.outcome.toLowerCase() === normalized) ?? null;
}

export const placePolymarketOrder: Action = {
  name: "PLACE_POLYMARKET_EXT_ORDER",
  description:
    "Place a buy or sell order on Polymarket with correct token resolution. " +
    "Searches for the market by name, resolves the exact token ID, and places the order. " +
    "Specify: market name, YES/NO outcome, dollar amount, and optionally a price (defaults to best available).",
  similes: [
    "buy on polymarket", "bet on polymarket", "place polymarket order",
    "polymarket buy", "polymarket bet", "place bet", "buy yes", "buy no",
  ],
  examples: [
    [
      { name: "user", content: { text: "Buy $5 YES on 'Will Jon Ossoff win the 2028 Democratic presidential nomination?'" } },
      { name: "assistant", content: { text: "Searching for the market and placing a $5 YES buy..." } },
    ],
  ] as ActionExample[][],
  validate: async (runtime) => runtime.getService(POLYMARKET_EXT_SERVICE_TYPE) !== undefined,
  handler: async (runtime, message, _state, _options, callback) => {
    const svc = getService(runtime);
    if (!requireClob(svc, callback)) return false;

    const text = getMessageText(message);

    // Parse outcome (YES/NO)
    const isYes = /\byes\b/i.test(text);
    const isNo = /\bno\b/i.test(text);
    if (!isYes && !isNo) {
      if (callback) callback({ text: "Specify YES or NO outcome. Example: buy $5 YES on 'market name'" });
      return false;
    }
    const outcome = isYes ? "Yes" : "No";

    // Parse dollar amount
    const amountMatch = /\$(\d+(?:\.\d+)?)/.exec(text);
    if (!amountMatch) {
      if (callback) callback({ text: "Specify a dollar amount. Example: buy $5 YES on 'market name'" });
      return false;
    }
    const dollars = parseFloat(amountMatch[1]!);

    // Parse side (BUY default, SELL if explicit)
    const side: "BUY" | "SELL" = /\bsell\b/i.test(text) ? "SELL" : "BUY";

    // Extract market name from quotes or after "on"
    let marketQuery: string | null = null;
    const quotedMatch = /['"\u201C\u201D]([^'"\u201C\u201D]{5,})['"\u201C\u201D]/u.exec(text);
    if (quotedMatch) {
      marketQuery = quotedMatch[1]!;
    } else {
      const onMatch = /\bon\s+(.{5,})$/i.exec(text);
      if (onMatch) marketQuery = onMatch[1]!.trim();
    }

    if (!marketQuery) {
      if (callback) callback({ text: "Specify the market. Example: buy $5 YES on 'Will X happen?'" });
      return false;
    }

    let markets: ClobMarket[];
    try {
      markets = await svc.clob!.searchMarkets(marketQuery);
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      if (callback) callback({ text: `Failed to search markets: ${msg}` });
      return false;
    }

    if (markets.length === 0) {
      if (callback) callback({ text: `No active markets found matching "${marketQuery}".` });
      return false;
    }

    // Pick best match (first result after filtering)
    const market = markets[0]!;
    const token = resolveToken(market, outcome);
    if (!token) {
      if (callback) callback({ text: `No ${outcome} token found for market: ${market.question}` });
      return false;
    }

    // Determine price: use best available from order book, or token's current price
    let price = token.price;
    try {
      const book = await svc.clob!.getOrderBook(token.token_id);
      if (side === "BUY" && book.asks.length > 0) {
        price = parseFloat(book.asks[0]!.price);
      } else if (side === "SELL" && book.bids.length > 0) {
        price = parseFloat(book.bids[0]!.price);
      }
    } catch {
      // Fall back to token.price
    }

    // Explicit price override from message
    const priceMatch = /(?:at|@|price)\s*\$?(\d+\.\d+)/i.exec(text);
    if (priceMatch) {
      price = parseFloat(priceMatch[1]!);
    }

    const size = Math.floor(dollars / price);
    if (size < 1) {
      if (callback) callback({ text: `$${dollars} at $${price.toFixed(2)}/share = ${(dollars / price).toFixed(1)} shares — minimum is 1.` });
      return false;
    }

    try {
      const result = await svc.placeOrder({
        tokenId: token.token_id,
        side,
        price,
        size,
      });
      const txInfo = result.transactionsHashes.length > 0
        ? ` | tx: ${shortenId(result.transactionsHashes[0]!)}`
        : "";
      const total = (size * price).toFixed(2);
      if (callback) callback({
        text: `${side} ${size} ${outcome} shares of "${market.question}" @ $${price.toFixed(2)} ($${total})\nOrder: ${shortenId(result.orderID)} — ${result.status}${txInfo}`,
      });
      return true;
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      if (callback) callback({ text: `Order failed on "${market.question}": ${msg}` });
      return false;
    }
  },
};
