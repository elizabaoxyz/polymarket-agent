// src/services/polymarket-service.ts
import { ethers } from "ethers";
import { ClobClient, OrderType } from "@polymarket/clob-client";
var DEFAULT_GAMMA_API_URL = "https://gamma-api.polymarket.com";
var DEFAULT_CLOB_API_URL = "https://clob.polymarket.com";
var DEFAULT_XTRACKER_API_URL = "https://xtracker.polymarket.com/api";
var PolymarketService = class {
  config;
  clobClient = null;
  positions = [];
  tradedMarkets = /* @__PURE__ */ new Set();
  constructor(config) {
    this.config = {
      ...config,
      gammaApiUrl: config.gammaApiUrl || DEFAULT_GAMMA_API_URL,
      clobApiUrl: config.clobApiUrl || DEFAULT_CLOB_API_URL,
      xtrackerApiUrl: config.xtrackerApiUrl || DEFAULT_XTRACKER_API_URL
    };
  }
  async initialize() {
    if (this.config.privateKey && this.config.clobApiKey) {
      await this.initClobClient();
    }
  }
  async initClobClient() {
    if (this.clobClient) return this.clobClient;
    if (!this.config.privateKey || !this.config.clobApiKey) {
      console.log("\u26A0\uFE0F CLOB credentials not configured");
      return null;
    }
    const provider = new ethers.providers.JsonRpcProvider(
      "https://polygon.llamarpc.com"
    );
    const wallet = new ethers.Wallet(this.config.privateKey, provider);
    this.clobClient = new ClobClient(
      this.config.clobApiUrl,
      137,
      wallet,
      {
        key: this.config.clobApiKey,
        secret: this.config.clobApiSecret,
        passphrase: this.config.clobApiPassphrase
      },
      2,
      this.config.proxyWallet
    );
    console.log("\u2705 CLOB client initialized");
    return this.clobClient;
  }
  /**
   * Fetch active markets from Polymarket
   */
  async fetchMarkets(limit = 100) {
    const url = `${this.config.gammaApiUrl}/markets?limit=${limit}&active=true&closed=false&order=volume24hr&ascending=false`;
    const res = await fetch(url);
    const data = await res.json();
    return data.map((m) => ({
      id: m.id,
      question: m.question,
      slug: m.slug,
      description: m.description,
      outcomes: m.outcomes ? JSON.parse(m.outcomes) : [],
      outcomePrices: m.outcomePrices ? JSON.parse(m.outcomePrices) : [],
      volume24hr: parseFloat(m.volume24hr || "0"),
      liquidity: parseFloat(m.liquidity || "0"),
      endDate: m.endDate,
      active: m.active,
      closed: m.closed,
      tokens: m.tokens
    }));
  }
  /**
   * Search markets by query
   */
  async searchMarkets(query, limit = 20) {
    const markets = await this.fetchMarkets(limit * 2);
    return markets.filter(
      (m) => m.question?.toLowerCase().includes(query.toLowerCase()) || m.slug?.toLowerCase().includes(query.toLowerCase())
    );
  }
  /**
   * Get order book for a market
   */
  async getOrderBook(tokenId) {
    try {
      const url = `${this.config.clobApiUrl}/book?token_id=${tokenId}`;
      const res = await fetch(url);
      if (!res.ok) return null;
      return await res.json();
    } catch {
      return null;
    }
  }
  /**
   * Scan markets and find trading opportunities
   */
  async scanOpportunities(limit = 50, minScore = 0.5) {
    const markets = await this.fetchMarkets(limit);
    const opportunities = [];
    for (const market of markets) {
      if (!market.tokens?.length) continue;
      if (this.tradedMarkets.has(market.id)) continue;
      const tokenId = market.tokens[0].token_id;
      const orderBook = await this.getOrderBook(tokenId);
      if (!orderBook) continue;
      const bestBid = orderBook.bids[0]?.price || 0;
      const bestAsk = orderBook.asks[0]?.price || 1;
      const spread = bestAsk - bestBid;
      const midpoint = (bestBid + bestAsk) / 2;
      const spreadScore = Math.max(0, 1 - spread * 10);
      const midpointScore = 1 - Math.abs(midpoint - 0.5) * 2;
      const depthScore = Math.min(1, (orderBook.bids.length + orderBook.asks.length) / 20);
      const score = spreadScore * 0.55 + midpointScore * 0.3 + depthScore * 0.15;
      if (score >= minScore) {
        let category = "general";
        const q = market.question.toLowerCase();
        if (q.includes("elon") || q.includes("musk") || q.includes("tweet")) {
          category = "elon";
        } else if (q.includes("bitcoin") || q.includes("btc") || q.includes("crypto") || q.includes("eth")) {
          category = "crypto";
        } else if (q.includes("trump") || q.includes("biden") || q.includes("election") || q.includes("president")) {
          category = "politics";
        }
        opportunities.push({
          market,
          orderBook,
          spread,
          midpoint,
          score,
          category,
          tokenId
        });
      }
    }
    return opportunities.sort((a, b) => b.score - a.score);
  }
  /**
   * Place a buy order
   */
  async placeBuyOrder(tokenId, price, size) {
    const client = await this.initClobClient();
    if (!client) {
      return { success: false, error: "CLOB client not initialized" };
    }
    try {
      const order = await client.createAndPostOrder({
        tokenID: tokenId,
        price,
        side: "BUY",
        size,
        orderType: OrderType.GTC
      });
      return { success: true, orderId: order.id };
    } catch (error) {
      return { success: false, error: error.message };
    }
  }
  /**
   * Place a sell order
   */
  async placeSellOrder(tokenId, price, size) {
    const client = await this.initClobClient();
    if (!client) {
      return { success: false, error: "CLOB client not initialized" };
    }
    try {
      const order = await client.createAndPostOrder({
        tokenID: tokenId,
        price,
        side: "SELL",
        size,
        orderType: OrderType.GTC
      });
      return { success: true, orderId: order.id };
    } catch (error) {
      return { success: false, error: error.message };
    }
  }
  /**
   * Cancel an order
   */
  async cancelOrder(orderId) {
    const client = await this.initClobClient();
    if (!client) return false;
    try {
      await client.cancelOrder(orderId);
      return true;
    } catch {
      return false;
    }
  }
  /**
   * Get open orders
   */
  async getOpenOrders() {
    const client = await this.initClobClient();
    if (!client) return [];
    try {
      return await client.getOpenOrders();
    } catch {
      return [];
    }
  }
  /**
   * Get positions
   */
  getPositions() {
    return this.positions;
  }
  /**
   * Get open positions
   */
  getOpenPositions() {
    return this.positions.filter((p) => p.status === "open");
  }
  /**
   * Add a position
   */
  addPosition(position) {
    this.positions.push(position);
    this.tradedMarkets.add(position.marketId);
  }
  /**
   * Close a position
   */
  closePosition(positionId, exitPrice, reason) {
    const position = this.positions.find((p) => p.id === positionId);
    if (!position) return null;
    position.status = "closed";
    position.closedAt = (/* @__PURE__ */ new Date()).toISOString();
    position.exitPrice = exitPrice;
    position.pnl = (exitPrice - position.entryPrice) * position.size;
    position.closeReason = reason;
    return position;
  }
  /**
   * Check if a market has been traded
   */
  hasTraded(marketId) {
    return this.tradedMarkets.has(marketId);
  }
};

// src/actions/scan-markets.ts
var scanMarketsAction = {
  name: "SCAN_MARKETS",
  description: "Scan Polymarket for trading opportunities based on spread, liquidity, and price patterns",
  similes: [
    "scan markets",
    "find opportunities",
    "look for trades",
    "analyze markets",
    "search polymarket",
    "check markets"
  ],
  examples: [
    [
      {
        name: "user",
        content: { text: "Scan for trading opportunities" }
      },
      {
        name: "assistant",
        content: {
          text: "I'll scan Polymarket for the best trading opportunities based on spread, liquidity, and market uncertainty.",
          action: "SCAN_MARKETS"
        }
      }
    ],
    [
      {
        name: "user",
        content: { text: "Find me some good markets to trade" }
      },
      {
        name: "assistant",
        content: {
          text: "Scanning Polymarket now to find markets with tight spreads and good liquidity.",
          action: "SCAN_MARKETS"
        }
      }
    ]
  ],
  validate: async (runtime) => {
    const privateKey = runtime.getSetting("EVM_PRIVATE_KEY");
    return !!privateKey;
  },
  handler: async (params) => {
    const { runtime, message } = params;
    try {
      let service = runtime.getService("polymarket");
      if (!service) {
        service = new PolymarketService({
          privateKey: runtime.getSetting("EVM_PRIVATE_KEY") || "",
          walletAddress: runtime.getSetting("WALLET_ADDRESS") || "",
          clobApiKey: runtime.getSetting("CLOB_API_KEY"),
          clobApiSecret: runtime.getSetting("CLOB_API_SECRET"),
          clobApiPassphrase: runtime.getSetting("CLOB_API_PASSPHRASE"),
          proxyWallet: runtime.getSetting("PROXY_WALLET")
        });
        await service.initialize();
      }
      const opportunities = await service.scanOpportunities(50, 0.5);
      if (opportunities.length === 0) {
        return {
          success: true,
          data: { opportunities: [], count: 0 },
          message: "No trading opportunities found at this time. Markets may have wide spreads or low liquidity."
        };
      }
      const topOpps = opportunities.slice(0, 5).map((opp, i) => ({
        rank: i + 1,
        question: opp.market.question,
        spread: `${(opp.spread * 100).toFixed(1)}%`,
        midpoint: opp.midpoint.toFixed(2),
        score: opp.score.toFixed(2),
        category: opp.category,
        tokenId: opp.tokenId
      }));
      return {
        success: true,
        data: {
          opportunities: topOpps,
          count: opportunities.length,
          allOpportunities: opportunities
        },
        message: `Found ${opportunities.length} trading opportunities. Top 5:
${topOpps.map(
          (o) => `${o.rank}. ${o.question.slice(0, 60)}... (Score: ${o.score}, Spread: ${o.spread})`
        ).join("\n")}`
      };
    } catch (error) {
      return {
        success: false,
        error: error.message,
        message: `Failed to scan markets: ${error.message}`
      };
    }
  }
};

// ../../node_modules/.bun/uuid@10.0.0/node_modules/uuid/dist/esm-node/stringify.js
var byteToHex = [];
for (let i = 0; i < 256; ++i) {
  byteToHex.push((i + 256).toString(16).slice(1));
}
function unsafeStringify(arr, offset = 0) {
  return (byteToHex[arr[offset + 0]] + byteToHex[arr[offset + 1]] + byteToHex[arr[offset + 2]] + byteToHex[arr[offset + 3]] + "-" + byteToHex[arr[offset + 4]] + byteToHex[arr[offset + 5]] + "-" + byteToHex[arr[offset + 6]] + byteToHex[arr[offset + 7]] + "-" + byteToHex[arr[offset + 8]] + byteToHex[arr[offset + 9]] + "-" + byteToHex[arr[offset + 10]] + byteToHex[arr[offset + 11]] + byteToHex[arr[offset + 12]] + byteToHex[arr[offset + 13]] + byteToHex[arr[offset + 14]] + byteToHex[arr[offset + 15]]).toLowerCase();
}

// ../../node_modules/.bun/uuid@10.0.0/node_modules/uuid/dist/esm-node/rng.js
import crypto from "crypto";
var rnds8Pool = new Uint8Array(256);
var poolPtr = rnds8Pool.length;
function rng() {
  if (poolPtr > rnds8Pool.length - 16) {
    crypto.randomFillSync(rnds8Pool);
    poolPtr = 0;
  }
  return rnds8Pool.slice(poolPtr, poolPtr += 16);
}

// ../../node_modules/.bun/uuid@10.0.0/node_modules/uuid/dist/esm-node/native.js
import crypto2 from "crypto";
var native_default = {
  randomUUID: crypto2.randomUUID
};

// ../../node_modules/.bun/uuid@10.0.0/node_modules/uuid/dist/esm-node/v4.js
function v4(options, buf, offset) {
  if (native_default.randomUUID && !buf && !options) {
    return native_default.randomUUID();
  }
  options = options || {};
  const rnds = options.random || (options.rng || rng)();
  rnds[6] = rnds[6] & 15 | 64;
  rnds[8] = rnds[8] & 63 | 128;
  if (buf) {
    offset = offset || 0;
    for (let i = 0; i < 16; ++i) {
      buf[offset + i] = rnds[i];
    }
    return buf;
  }
  return unsafeStringify(rnds);
}
var v4_default = v4;

// src/actions/trade.ts
var buyAction = {
  name: "BUY_MARKET",
  description: "Buy shares in a Polymarket prediction market",
  similes: [
    "buy",
    "purchase",
    "go long",
    "bet yes",
    "buy shares",
    "place buy order"
  ],
  examples: [
    [
      {
        name: "user",
        content: { text: "Buy $5 of the top opportunity" }
      },
      {
        name: "assistant",
        content: {
          text: "I'll place a buy order for $5 on the best opportunity I found.",
          action: "BUY_MARKET"
        }
      }
    ]
  ],
  validate: async (runtime) => {
    const privateKey = runtime.getSetting("EVM_PRIVATE_KEY");
    const clobApiKey = runtime.getSetting("CLOB_API_KEY");
    return !!privateKey && !!clobApiKey;
  },
  handler: async (params) => {
    const { runtime, message } = params;
    try {
      let service = runtime.getService("polymarket");
      if (!service) {
        service = new PolymarketService({
          privateKey: runtime.getSetting("EVM_PRIVATE_KEY") || "",
          walletAddress: runtime.getSetting("WALLET_ADDRESS") || "",
          clobApiKey: runtime.getSetting("CLOB_API_KEY"),
          clobApiSecret: runtime.getSetting("CLOB_API_SECRET"),
          clobApiPassphrase: runtime.getSetting("CLOB_API_PASSPHRASE"),
          proxyWallet: runtime.getSetting("PROXY_WALLET")
        });
        await service.initialize();
      }
      const context = message.content;
      const tokenId = context.tokenId;
      const price = context.price || 0.5;
      const amount = context.amount || 2;
      const size = amount / price;
      if (!tokenId) {
        return {
          success: false,
          error: "No token ID specified",
          message: "Please specify which market to buy. Run SCAN_MARKETS first to find opportunities."
        };
      }
      const result = await service.placeBuyOrder(tokenId, price, size);
      if (!result.success) {
        return {
          success: false,
          error: result.error,
          message: `Failed to place buy order: ${result.error}`
        };
      }
      const position = {
        id: v4_default(),
        marketId: context.marketId || tokenId,
        question: context.question || "Unknown market",
        slug: context.slug || "",
        side: "BUY",
        entryPrice: price,
        size,
        amount,
        tokenId,
        openedAt: (/* @__PURE__ */ new Date()).toISOString(),
        status: "open",
        category: context.category
      };
      service.addPosition(position);
      return {
        success: true,
        data: {
          orderId: result.orderId,
          position
        },
        message: `Successfully placed BUY order for ${size.toFixed(2)} shares at $${price.toFixed(2)} (Order ID: ${result.orderId})`
      };
    } catch (error) {
      return {
        success: false,
        error: error.message,
        message: `Trade failed: ${error.message}`
      };
    }
  }
};
var sellAction = {
  name: "SELL_MARKET",
  description: "Sell shares in a Polymarket prediction market",
  similes: [
    "sell",
    "close position",
    "exit",
    "take profit",
    "stop loss",
    "sell shares"
  ],
  examples: [
    [
      {
        name: "user",
        content: { text: "Sell my position in the BTC market" }
      },
      {
        name: "assistant",
        content: {
          text: "I'll close your position in the BTC market.",
          action: "SELL_MARKET"
        }
      }
    ]
  ],
  validate: async (runtime) => {
    const privateKey = runtime.getSetting("EVM_PRIVATE_KEY");
    const clobApiKey = runtime.getSetting("CLOB_API_KEY");
    return !!privateKey && !!clobApiKey;
  },
  handler: async (params) => {
    const { runtime, message } = params;
    try {
      let service = runtime.getService("polymarket");
      if (!service) {
        return {
          success: false,
          error: "Polymarket service not initialized",
          message: "Please initialize the trading agent first."
        };
      }
      const context = message.content;
      const positionId = context.positionId;
      const tokenId = context.tokenId;
      const price = context.price;
      const size = context.size;
      if (!tokenId || !price || !size) {
        return {
          success: false,
          error: "Missing trade parameters",
          message: "Please specify tokenId, price, and size for the sell order."
        };
      }
      const result = await service.placeSellOrder(tokenId, price, size);
      if (!result.success) {
        return {
          success: false,
          error: result.error,
          message: `Failed to place sell order: ${result.error}`
        };
      }
      if (positionId) {
        service.closePosition(positionId, price, context.reason || "Manual sell");
      }
      return {
        success: true,
        data: {
          orderId: result.orderId
        },
        message: `Successfully placed SELL order for ${size.toFixed(2)} shares at $${price.toFixed(2)} (Order ID: ${result.orderId})`
      };
    } catch (error) {
      return {
        success: false,
        error: error.message,
        message: `Trade failed: ${error.message}`
      };
    }
  }
};

// src/actions/analyze.ts
var analyzeAction = {
  name: "ANALYZE_OPPORTUNITY",
  description: "Analyze a market opportunity and decide whether to trade",
  similes: [
    "analyze",
    "evaluate",
    "should I trade",
    "what do you think",
    "give me advice",
    "trading decision"
  ],
  examples: [
    [
      {
        name: "user",
        content: { text: "Analyze the top opportunity and tell me if I should trade" }
      },
      {
        name: "assistant",
        content: {
          text: "I'll analyze the market conditions and provide a trading recommendation.",
          action: "ANALYZE_OPPORTUNITY"
        }
      }
    ]
  ],
  validate: async (runtime) => {
    return true;
  },
  handler: async (params) => {
    const { runtime, message } = params;
    try {
      let service = runtime.getService("polymarket");
      if (!service) {
        service = new PolymarketService({
          privateKey: runtime.getSetting("EVM_PRIVATE_KEY") || "",
          walletAddress: runtime.getSetting("WALLET_ADDRESS") || ""
        });
        await service.initialize();
      }
      const opportunities = await service.scanOpportunities(50, 0.5);
      if (opportunities.length === 0) {
        return {
          success: true,
          data: {
            decision: {
              shouldTrade: false,
              action: "HOLD",
              market: null,
              reasoning: "No suitable opportunities found",
              confidence: 0
            }
          },
          message: "No trading opportunities available at this time. Recommendation: HOLD"
        };
      }
      const openPositions = service.getOpenPositions();
      const MAX_POSITIONS = 20;
      if (openPositions.length >= MAX_POSITIONS) {
        return {
          success: true,
          data: {
            decision: {
              shouldTrade: false,
              action: "HOLD",
              market: null,
              reasoning: `Maximum positions reached (${openPositions.length}/${MAX_POSITIONS})`,
              confidence: 100
            }
          },
          message: `Position limit reached. Currently holding ${openPositions.length} positions. Recommendation: HOLD`
        };
      }
      const topOpp = opportunities[0];
      const decision = analyzeOpportunity(topOpp, openPositions.length);
      return {
        success: true,
        data: {
          decision,
          opportunity: topOpp,
          openPositions: openPositions.length
        },
        message: formatDecision(decision, topOpp)
      };
    } catch (error) {
      return {
        success: false,
        error: error.message,
        message: `Analysis failed: ${error.message}`
      };
    }
  }
};
function analyzeOpportunity(opp, currentPositions) {
  const { market, spread, midpoint, score, category } = opp;
  let shouldTrade = false;
  let confidence = 0;
  let reasoning = "";
  if (score >= 0.8 && spread <= 0.03) {
    shouldTrade = true;
    confidence = 85;
    reasoning = `Excellent opportunity with tight ${(spread * 100).toFixed(1)}% spread and high score of ${score.toFixed(2)}. Market shows strong liquidity.`;
  } else if (score >= 0.7 && spread <= 0.05) {
    shouldTrade = true;
    confidence = 70;
    reasoning = `Good opportunity with ${(spread * 100).toFixed(1)}% spread. Score of ${score.toFixed(2)} indicates favorable conditions.`;
  } else if (score >= 0.6 && spread <= 0.08) {
    shouldTrade = currentPositions < 10;
    confidence = 55;
    reasoning = `Moderate opportunity. ${(spread * 100).toFixed(1)}% spread is acceptable. Consider if portfolio has room.`;
  } else {
    shouldTrade = false;
    confidence = 40;
    reasoning = `Spread of ${(spread * 100).toFixed(1)}% is too wide or score of ${score.toFixed(2)} is too low. Better to wait.`;
  }
  if (category === "elon") {
    reasoning += " [Elon tweet market - consider historical patterns]";
  } else if (category === "crypto") {
    reasoning += " [Crypto market - higher volatility expected]";
  } else if (category === "politics") {
    reasoning += " [Political market - longer time horizon]";
  }
  return {
    shouldTrade,
    action: shouldTrade ? "BUY" : "HOLD",
    market,
    tokenId: opp.tokenId,
    price: midpoint,
    size: 2 / midpoint,
    // $2 position
    reasoning,
    confidence
  };
}
function formatDecision(decision, opp) {
  const lines = [
    `\u{1F4CA} Market Analysis`,
    `\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501`,
    `Market: ${opp.market.question.slice(0, 60)}...`,
    `Category: ${opp.category?.toUpperCase() || "GENERAL"}`,
    `Spread: ${(opp.spread * 100).toFixed(1)}%`,
    `Midpoint: ${opp.midpoint.toFixed(2)}`,
    `Score: ${opp.score.toFixed(2)}`,
    ``,
    `\u{1F916} AI Decision: ${decision.action}`,
    `Confidence: ${decision.confidence}%`,
    ``,
    `\u{1F4A1} Reasoning:`,
    decision.reasoning
  ];
  if (decision.shouldTrade) {
    lines.push(
      ``,
      `\u{1F4C8} Recommended Trade:`,
      `  Side: BUY`,
      `  Price: $${decision.price?.toFixed(2)}`,
      `  Size: ${decision.size?.toFixed(2)} shares (~$2)`
    );
  }
  return lines.join("\n");
}

// src/providers/portfolio-provider.ts
var portfolioProvider = {
  name: "PORTFOLIO",
  description: "Provides current portfolio positions and trading statistics",
  get: async (runtime, message, state) => {
    try {
      const service = runtime.getService("polymarket");
      if (!service) {
        return "Portfolio not available - Polymarket service not initialized.";
      }
      const positions = service.getPositions();
      const openPositions = positions.filter((p) => p.status === "open");
      const closedPositions = positions.filter((p) => p.status === "closed");
      const totalPnl = closedPositions.reduce((sum, p) => sum + (p.pnl || 0), 0);
      const wins = closedPositions.filter((p) => (p.pnl || 0) > 0).length;
      const winRate = closedPositions.length > 0 ? wins / closedPositions.length * 100 : 0;
      const stats = {
        totalPositions: positions.length,
        openPositions: openPositions.length,
        totalTrades: closedPositions.length,
        totalPnl,
        winRate,
        avgReturn: closedPositions.length > 0 ? totalPnl / closedPositions.length : 0
      };
      const lines = [
        `\u{1F4CA} Portfolio Summary`,
        `\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501`,
        `Open Positions: ${stats.openPositions}`,
        `Total Trades: ${stats.totalTrades}`,
        `Total P&L: $${stats.totalPnl.toFixed(2)}`,
        `Win Rate: ${stats.winRate.toFixed(1)}%`,
        `Avg Return: $${stats.avgReturn.toFixed(2)}`
      ];
      if (openPositions.length > 0) {
        lines.push(``, `\u{1F4C8} Open Positions:`);
        openPositions.slice(0, 5).forEach((p, i) => {
          lines.push(
            `${i + 1}. ${p.question.slice(0, 40)}...`,
            `   Entry: $${p.entryPrice.toFixed(2)} | Size: ${p.size.toFixed(2)} | Category: ${p.category || "general"}`
          );
        });
        if (openPositions.length > 5) {
          lines.push(`   ... and ${openPositions.length - 5} more`);
        }
      }
      return lines.join("\n");
    } catch (error) {
      return `Portfolio error: ${error.message}`;
    }
  }
};

// src/providers/market-provider.ts
var marketProvider = {
  name: "MARKET_DATA",
  description: "Provides current Polymarket data and trading opportunities",
  get: async (runtime, message, state) => {
    try {
      let service = runtime.getService("polymarket");
      if (!service) {
        service = new PolymarketService({
          privateKey: runtime.getSetting("EVM_PRIVATE_KEY") || "",
          walletAddress: runtime.getSetting("WALLET_ADDRESS") || ""
        });
      }
      const markets = await service.fetchMarkets(20);
      const lines = [
        `\u{1F4C8} Polymarket Overview`,
        `\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501`,
        `Active Markets: ${markets.length}+`,
        ``,
        `\u{1F525} Top Markets by Volume:`
      ];
      markets.slice(0, 5).forEach((m, i) => {
        const price = m.outcomePrices[0] || 0;
        lines.push(
          `${i + 1}. ${m.question.slice(0, 50)}...`,
          `   Price: ${(price * 100).toFixed(0)}% YES | Vol: $${((m.volume24hr || 0) / 1e3).toFixed(0)}K`
        );
      });
      const categories = {
        politics: markets.filter(
          (m) => m.question.toLowerCase().match(/trump|biden|election|president|senate|congress/)
        ).length,
        crypto: markets.filter(
          (m) => m.question.toLowerCase().match(/bitcoin|btc|eth|crypto/)
        ).length,
        elon: markets.filter(
          (m) => m.question.toLowerCase().match(/elon|musk|tweet/)
        ).length
      };
      lines.push(
        ``,
        `\u{1F4CA} Categories:`,
        `   Politics: ${categories.politics} markets`,
        `   Crypto: ${categories.crypto} markets`,
        `   Elon: ${categories.elon} markets`
      );
      return lines.join("\n");
    } catch (error) {
      return `Market data unavailable: ${error.message}`;
    }
  }
};

// src/index.ts
var polymarketPlugin = {
  name: "@elizabao/plugin-polymarket",
  description: "Polymarket prediction market trading plugin for ElizaOS",
  version: "2.0.0-alpha.1",
  // Actions the agent can perform
  actions: [
    scanMarketsAction,
    buyAction,
    sellAction,
    analyzeAction
  ],
  // Providers for context injection
  providers: [
    portfolioProvider,
    marketProvider
  ],
  // Evaluators for decision making
  evaluators: [],
  // Services
  services: [],
  // Plugin initialization
  init: async (runtime) => {
    console.log("\u{1F680} Initializing Polymarket Plugin v2.0.0");
    const privateKey = runtime.getSetting("EVM_PRIVATE_KEY");
    const clobApiKey = runtime.getSetting("CLOB_API_KEY");
    if (!privateKey) {
      console.warn("\u26A0\uFE0F EVM_PRIVATE_KEY not set - trading disabled");
    }
    if (!clobApiKey) {
      console.warn("\u26A0\uFE0F CLOB_API_KEY not set - order placement disabled");
    }
    const service = new PolymarketService({
      privateKey: privateKey || "",
      walletAddress: runtime.getSetting("WALLET_ADDRESS") || "",
      clobApiKey,
      clobApiSecret: runtime.getSetting("CLOB_API_SECRET"),
      clobApiPassphrase: runtime.getSetting("CLOB_API_PASSPHRASE"),
      proxyWallet: runtime.getSetting("PROXY_WALLET")
    });
    await service.initialize();
    runtime.registerService("polymarket", service);
    console.log("\u2705 Polymarket Plugin initialized");
  }
};
var index_default = polymarketPlugin;
export {
  PolymarketService,
  index_default as default,
  polymarketPlugin
};
