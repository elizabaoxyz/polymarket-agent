/**
 * Polymarket Service
 * Handles all Polymarket API interactions
 */

import { ethers } from "ethers";
import { ClobClient, OrderType } from "@polymarket/clob-client";
import type {
  PolymarketConfig,
  Market,
  OrderBook,
  MarketOpportunity,
  Position,
  TradeDecision,
} from "../types.js";

const DEFAULT_GAMMA_API_URL = "https://gamma-api.polymarket.com";
const DEFAULT_CLOB_API_URL = "https://clob.polymarket.com";
const DEFAULT_XTRACKER_API_URL = "https://xtracker.polymarket.com/api";

export class PolymarketService {
  private config: PolymarketConfig;
  private clobClient: ClobClient | null = null;
  private positions: Position[] = [];
  private tradedMarkets: Set<string> = new Set();

  constructor(config: PolymarketConfig) {
    this.config = {
      ...config,
      gammaApiUrl: config.gammaApiUrl || DEFAULT_GAMMA_API_URL,
      clobApiUrl: config.clobApiUrl || DEFAULT_CLOB_API_URL,
      xtrackerApiUrl: config.xtrackerApiUrl || DEFAULT_XTRACKER_API_URL,
    };
  }

  async initialize(): Promise<void> {
    if (this.config.privateKey && this.config.clobApiKey) {
      await this.initClobClient();
    }
  }

  private async initClobClient(): Promise<ClobClient | null> {
    if (this.clobClient) return this.clobClient;
    if (!this.config.privateKey || !this.config.clobApiKey) {
      console.log("⚠️ CLOB credentials not configured");
      return null;
    }

    const provider = new ethers.providers.JsonRpcProvider(
      "https://polygon.llamarpc.com"
    );
    const wallet = new ethers.Wallet(this.config.privateKey, provider);

    this.clobClient = new ClobClient(
      this.config.clobApiUrl!,
      137,
      wallet,
      {
        key: this.config.clobApiKey,
        secret: this.config.clobApiSecret!,
        passphrase: this.config.clobApiPassphrase!,
      },
      2,
      this.config.proxyWallet
    );

    console.log("✅ CLOB client initialized");
    return this.clobClient;
  }

  /**
   * Fetch active markets from Polymarket
   */
  async fetchMarkets(limit = 100): Promise<Market[]> {
    const url = `${this.config.gammaApiUrl}/markets?limit=${limit}&active=true&closed=false&order=volume24hr&ascending=false`;
    const res = await fetch(url);
    const data = await res.json();

    return data.map((m: any) => ({
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
      tokens: m.tokens,
    }));
  }

  /**
   * Search markets by query
   */
  async searchMarkets(query: string, limit = 20): Promise<Market[]> {
    const markets = await this.fetchMarkets(limit * 2);
    return markets.filter(
      (m) =>
        m.question?.toLowerCase().includes(query.toLowerCase()) ||
        m.slug?.toLowerCase().includes(query.toLowerCase())
    );
  }

  /**
   * Get order book for a market
   */
  async getOrderBook(tokenId: string): Promise<OrderBook | null> {
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
  async scanOpportunities(
    limit = 50,
    minScore = 0.5
  ): Promise<MarketOpportunity[]> {
    const markets = await this.fetchMarkets(limit);
    const opportunities: MarketOpportunity[] = [];

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

      // Score based on spread, midpoint, and depth
      const spreadScore = Math.max(0, 1 - spread * 10); // 0-10% spread
      const midpointScore = 1 - Math.abs(midpoint - 0.5) * 2; // Closer to 50% is better
      const depthScore = Math.min(1, (orderBook.bids.length + orderBook.asks.length) / 20);

      const score = spreadScore * 0.55 + midpointScore * 0.30 + depthScore * 0.15;

      if (score >= minScore) {
        // Determine category
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
          tokenId,
        });
      }
    }

    return opportunities.sort((a, b) => b.score - a.score);
  }

  /**
   * Place a buy order
   */
  async placeBuyOrder(
    tokenId: string,
    price: number,
    size: number
  ): Promise<{ success: boolean; orderId?: string; error?: string }> {
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
        orderType: OrderType.GTC,
      });

      return { success: true, orderId: order.id };
    } catch (error: any) {
      return { success: false, error: error.message };
    }
  }

  /**
   * Place a sell order
   */
  async placeSellOrder(
    tokenId: string,
    price: number,
    size: number
  ): Promise<{ success: boolean; orderId?: string; error?: string }> {
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
        orderType: OrderType.GTC,
      });

      return { success: true, orderId: order.id };
    } catch (error: any) {
      return { success: false, error: error.message };
    }
  }

  /**
   * Cancel an order
   */
  async cancelOrder(orderId: string): Promise<boolean> {
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
  async getOpenOrders(): Promise<any[]> {
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
  getPositions(): Position[] {
    return this.positions;
  }

  /**
   * Get open positions
   */
  getOpenPositions(): Position[] {
    return this.positions.filter((p) => p.status === "open");
  }

  /**
   * Add a position
   */
  addPosition(position: Position): void {
    this.positions.push(position);
    this.tradedMarkets.add(position.marketId);
  }

  /**
   * Close a position
   */
  closePosition(
    positionId: string,
    exitPrice: number,
    reason: string
  ): Position | null {
    const position = this.positions.find((p) => p.id === positionId);
    if (!position) return null;

    position.status = "closed";
    position.closedAt = new Date().toISOString();
    position.exitPrice = exitPrice;
    position.pnl = (exitPrice - position.entryPrice) * position.size;
    position.closeReason = reason;

    return position;
  }

  /**
   * Check if a market has been traded
   */
  hasTraded(marketId: string): boolean {
    return this.tradedMarkets.has(marketId);
  }
}
