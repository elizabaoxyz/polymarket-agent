/**
 * Polymarket Service
 * 
 * Handles all Polymarket API interactions with full feature support:
 * - Market scanning and opportunity detection
 * - Order placement with postOnly fix for TP orders
 * - Position management with TP/SL
 * - Position persistence to JSON file
 * 
 * @author ElizaBAO
 */

import { ethers } from "ethers";
import { ClobClient, OrderType } from "@polymarket/clob-client";
import * as fs from "fs";
import * as path from "path";
import type {
  PolymarketConfig,
  Market,
  OrderBook,
  MarketOpportunity,
  Position,
} from "../types.js";

const DEFAULT_GAMMA_API_URL = "https://gamma-api.polymarket.com";
const DEFAULT_CLOB_API_URL = "https://clob.polymarket.com";
const DEFAULT_XTRACKER_API_URL = "https://xtracker.polymarket.com/api";
const POSITIONS_FILE = "positions.json";

export class PolymarketService {
  private config: PolymarketConfig;
  private clobClient: ClobClient | null = null;
  private positions: Position[] = [];
  private tradedMarkets: Set<string> = new Set();
  private totalPnl: number = 0;

  constructor(config: PolymarketConfig) {
    this.config = {
      ...config,
      gammaApiUrl: config.gammaApiUrl || DEFAULT_GAMMA_API_URL,
      clobApiUrl: config.clobApiUrl || DEFAULT_CLOB_API_URL,
      xtrackerApiUrl: config.xtrackerApiUrl || DEFAULT_XTRACKER_API_URL,
    };
  }

  async initialize(): Promise<void> {
    // Load positions from file
    this.loadPositions();
    
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
    if (this.config.proxyWallet) {
      console.log(`🏦 Proxy wallet: ${this.config.proxyWallet}`);
    }
    return this.clobClient;
  }

  // ============================================================
  // POSITION PERSISTENCE
  // ============================================================

  private loadPositions(): void {
    try {
      if (fs.existsSync(POSITIONS_FILE)) {
        const data = JSON.parse(fs.readFileSync(POSITIONS_FILE, "utf-8"));
        this.positions = data.positions || [];
        this.totalPnl = data.totalPnl || 0;
        
        // Rebuild traded markets set
        for (const pos of this.positions) {
          this.tradedMarkets.add(pos.marketId);
        }
        
        const openCount = this.positions.filter(p => p.status === "open").length;
        console.log(`📂 Loaded ${this.positions.length} positions (${openCount} open)`);
        console.log(`📂 tradedMarkets: ${this.tradedMarkets.size} unique markets`);
      }
    } catch (e) {
      console.log("📂 No existing positions file, starting fresh");
      this.positions = [];
    }
  }

  private savePositions(): void {
    try {
      const data = {
        positions: this.positions,
        totalPnl: this.totalPnl,
        lastSaved: new Date().toISOString(),
      };
      fs.writeFileSync(POSITIONS_FILE, JSON.stringify(data, null, 2));
    } catch (e) {
      console.error("Failed to save positions:", e);
    }
  }

  // ============================================================
  // MARKET DATA
  // ============================================================

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
      liquidityNum: parseFloat(m.liquidityNum || m.liquidity || "0"),
      endDate: m.endDate,
      active: m.active,
      closed: m.closed,
      tokens: m.tokens,
      clobTokenIds: m.clobTokenIds,
      eventSlug: m.eventSlug,
      eventTitle: m.groupItemTitle,
    }));
  }

  async searchMarkets(query: string, limit = 20): Promise<Market[]> {
    try {
      const url = `${this.config.gammaApiUrl}/markets?limit=${limit}&active=true&closed=false&_q=${encodeURIComponent(query)}`;
      const res = await fetch(url);
      const data = await res.json();
      return data.map((m: any) => ({
        id: m.id,
        question: m.question,
        slug: m.slug,
        outcomePrices: m.outcomePrices ? JSON.parse(m.outcomePrices) : [],
        volume24hr: parseFloat(m.volume24hr || "0"),
        liquidity: parseFloat(m.liquidity || "0"),
        liquidityNum: parseFloat(m.liquidityNum || m.liquidity || "0"),
        tokens: m.tokens,
        clobTokenIds: m.clobTokenIds,
        eventSlug: m.eventSlug,
        eventTitle: m.groupItemTitle,
      }));
    } catch {
      return [];
    }
  }

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

  async getMarketPrice(marketId: string): Promise<number | null> {
    try {
      const url = `${this.config.gammaApiUrl}/markets/${marketId}`;
      const res = await fetch(url);
      if (!res.ok) return null;
      const data = await res.json();
      return parseFloat(JSON.parse(data.outcomePrices)[0]);
    } catch {
      return null;
    }
  }

  // ============================================================
  // OPPORTUNITY SCANNING
  // ============================================================

  async scanOpportunities(limit = 50, minScore = 0.5): Promise<MarketOpportunity[]> {
    const markets = await this.fetchMarkets(limit);
    const cryptoMarkets = await this.searchMarkets("bitcoin", 20);
    const elonMarkets = await this.searchMarkets("elon", 20);
    
    const allMarkets = [...markets, ...cryptoMarkets, ...elonMarkets];
    const seen = new Set<string>();
    const opportunities: MarketOpportunity[] = [];

    for (const market of allMarkets) {
      if (seen.has(market.id)) continue;
      seen.add(market.id);
      
      if (this.tradedMarkets.has(market.id)) continue;
      if (!market.clobTokenIds && !market.tokens?.length) continue;

      let yesPrice = 0.5;
      try {
        yesPrice = market.outcomePrices[0] || parseFloat(JSON.parse(String(market.outcomePrices))[0]);
      } catch {}

      // Price filter
      if (yesPrice < 0.08 || yesPrice > 0.85) continue;
      if ((market.liquidityNum || market.liquidity || 0) < 100) continue;

      // Get token ID
      let tokenId = "";
      if (market.clobTokenIds) {
        try {
          const ids = typeof market.clobTokenIds === "string" 
            ? JSON.parse(market.clobTokenIds) 
            : market.clobTokenIds;
          tokenId = Array.isArray(ids) ? ids[0] : ids;
        } catch {}
      } else if (market.tokens?.length) {
        tokenId = market.tokens[0].token_id;
      }
      if (!tokenId) continue;

      // Determine category
      let category = "other";
      const q = (market.question || "").toLowerCase();
      if (q.includes("bitcoin") || q.includes("crypto") || q.includes("ethereum")) {
        category = "crypto";
      } else if (q.includes("elon") || q.includes("musk") || q.includes("tweet")) {
        category = "elon";
      } else if (q.includes("trump") || q.includes("biden") || q.includes("election")) {
        category = "politics";
      } else if (q.includes("nba") || q.includes("nfl") || q.includes("soccer")) {
        category = "sports";
      }

      // Score calculation
      const score = (1 - Math.abs(yesPrice - 0.5) * 2) * 0.5 + 
                   Math.min(1, (market.volume24hr || 0) / 500000) * 0.5;

      if (score >= minScore) {
        opportunities.push({
          market,
          orderBook: null,
          spread: 0,
          midpoint: yesPrice,
          score,
          category,
          tokenId,
        });
      }
    }

    return opportunities.sort((a, b) => b.score - a.score);
  }

  // ============================================================
  // ORDER PLACEMENT (with postOnly fix)
  // ============================================================

  /**
   * Place a buy order with optional TP limit order
   */
  async placeBuyOrder(
    tokenId: string,
    price: number,
    size: number,
    options?: {
      placeTPOrder?: boolean;
      tpPrice?: number;
      postOnly?: boolean;
    }
  ): Promise<{ success: boolean; orderId?: string; tpOrderId?: string; error?: string }> {
    const client = await this.initClobClient();
    if (!client) {
      return { success: false, error: "CLOB client not initialized" };
    }

    try {
      // Create and post buy order
      const order = await client.createOrder({
        tokenID: tokenId,
        price,
        size,
        side: "BUY",
      });

      // Use correct postOrder signature: (order, orderType, deferExec, postOnly)
      const result = await client.postOrder(order, OrderType.GTC);

      if (result.error || result.success === false) {
        return { success: false, error: result.error || "Order failed" };
      }

      const orderId = result.orderID || result.id || "";
      let tpOrderId = "";

      // Place TP limit order if requested
      if (options?.placeTPOrder && options?.tpPrice && size >= 5) {
        console.log(`📈 Placing TP SELL limit @ ${options.tpPrice}...`);
        
        // Wait for shares to be credited
        await new Promise(r => setTimeout(r, 45000));

        const tpOrder = await client.createOrder({
          tokenID: tokenId,
          price: options.tpPrice,
          size: Math.floor(size), // Integer shares for sell
          side: "SELL",
        });

        // CRITICAL: postOnly is 4th parameter!
        // postOrder(order, orderType, deferExec, postOnly)
        const tpResult = await client.postOrder(tpOrder, OrderType.GTC, false, true);

        if (!tpResult.error && tpResult.success !== false) {
          tpOrderId = tpResult.orderID || tpResult.id || "";
          console.log(`✅ TP order placed: ${tpOrderId}`);
        } else {
          console.log(`⚠️ TP order failed: ${tpResult.error}`);
        }
      }

      return { success: true, orderId, tpOrderId };
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
    size: number,
    postOnly: boolean = false
  ): Promise<{ success: boolean; orderId?: string; error?: string }> {
    const client = await this.initClobClient();
    if (!client) {
      return { success: false, error: "CLOB client not initialized" };
    }

    try {
      const order = await client.createOrder({
        tokenID: tokenId,
        price,
        size,
        side: "SELL",
      });

      // postOrder(order, orderType, deferExec, postOnly)
      const result = await client.postOrder(order, OrderType.GTC, false, postOnly);

      if (result.error || result.success === false) {
        return { success: false, error: result.error || "Order failed" };
      }

      return { success: true, orderId: result.orderID || result.id };
    } catch (error: any) {
      return { success: false, error: error.message };
    }
  }

  async cancelOrder(orderId: string): Promise<boolean> {
    const client = await this.initClobClient();
    if (!client) return false;

    try {
      await client.cancelOrder({ orderID: orderId });
      return true;
    } catch {
      return false;
    }
  }

  async getOpenOrders(): Promise<any[]> {
    const client = await this.initClobClient();
    if (!client) return [];

    try {
      return await client.getOpenOrders();
    } catch {
      return [];
    }
  }

  // ============================================================
  // POSITION MANAGEMENT
  // ============================================================

  getPositions(): Position[] {
    return this.positions;
  }

  getOpenPositions(): Position[] {
    return this.positions.filter((p) => p.status === "open");
  }

  getClosedPositions(): Position[] {
    return this.positions.filter((p) => p.status === "closed");
  }

  getOpenElonPositions(): number {
    return this.positions.filter(p => p.status === "open" && p.category === "elon").length;
  }

  getTotalPnl(): number {
    return this.totalPnl;
  }

  getTradedMarkets(): string[] {
    return Array.from(this.tradedMarkets);
  }

  addPosition(position: Position): void {
    this.positions.push(position);
    this.tradedMarkets.add(position.marketId);
    this.savePositions();
  }

  updatePosition(positionId: string, updates: Partial<Position>): Position | null {
    const position = this.positions.find((p) => p.id === positionId);
    if (!position) return null;

    Object.assign(position, updates);
    this.savePositions();
    return position;
  }

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

    this.totalPnl += position.pnl;
    this.savePositions();

    return position;
  }

  hasTraded(marketId: string): boolean {
    return this.tradedMarkets.has(marketId);
  }

  // ============================================================
  // CONFIG ACCESS
  // ============================================================

  getConfig(): PolymarketConfig {
    return this.config;
  }

  getProxyWallet(): string | undefined {
    return this.config.proxyWallet;
  }

  getWalletAddress(): string {
    return this.config.walletAddress;
  }
}
