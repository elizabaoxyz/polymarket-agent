/**
 * Maker Rebates Strategy
 * 
 * Earn rebates by placing limit orders on short-term crypto markets.
 * Targets 15-minute crypto markets with tight spreads.
 * 
 * @author ElizaBAO
 */

import type { PolymarketService } from "../services/polymarket-service.js";

// Configuration
export const MAKER_REBATES_CONFIG = {
  enabled: true,
  budget: 15,             // $15 budget for maker rebates
  minShares: 5,           // Minimum shares per order
  spreadFromMid: 0.01,    // 1¢ from midpoint
};

export interface MakerOrder {
  marketId: string;
  question: string;
  tokenId: string;
  orderId: string;
  side: "BUY" | "SELL";
  price: number;
  shares: number;
  placedAt: string;
  expiresAt?: string;
}

// Active maker orders
let makerOrders: MakerOrder[] = [];
let totalMakerRebates = 0;

/**
 * Get active maker orders
 */
export function getMakerOrders(): MakerOrder[] {
  return makerOrders;
}

/**
 * Get total rebates earned
 */
export function getTotalMakerRebates(): number {
  return totalMakerRebates;
}

/**
 * Fetch short-term crypto markets (15-min, hourly)
 */
export async function fetchCryptoMarkets(service: PolymarketService): Promise<any[]> {
  try {
    // Search for Bitcoin short-term markets
    const btcMarkets = await service.searchMarkets("bitcoin up or down", 20);
    const ethMarkets = await service.searchMarkets("ethereum up or down", 10);
    
    const allMarkets = [...btcMarkets, ...ethMarkets];
    
    // Filter for short-term (look for time indicators)
    return allMarkets.filter(m => {
      const q = (m.question || "").toLowerCase();
      return (
        (q.includes("15") || q.includes("hour") || q.includes("minute") || q.includes("pm") || q.includes("am")) &&
        (q.includes("bitcoin") || q.includes("ethereum") || q.includes("btc") || q.includes("eth"))
      );
    }).slice(0, 5);
  } catch (e) {
    console.log("⚠️ Could not fetch crypto markets");
    return [];
  }
}

/**
 * Place maker orders on a market
 */
export async function placeMakerOrder(
  service: PolymarketService,
  market: any,
  side: "BUY" | "SELL"
): Promise<MakerOrder | null> {
  if (!MAKER_REBATES_CONFIG.enabled) return null;

  try {
    // Get token ID
    let tokenId = "";
    if (market.clobTokenIds) {
      try {
        const ids = typeof market.clobTokenIds === "string"
          ? JSON.parse(market.clobTokenIds)
          : market.clobTokenIds;
        tokenId = Array.isArray(ids) ? ids[0] : ids;
      } catch {}
    }
    if (!tokenId) return null;

    // Get market price
    let yesPrice = 0.5;
    try {
      yesPrice = parseFloat(market.outcomePrices[0]) || 0.5;
    } catch {}

    // Calculate order price (slightly away from midpoint)
    const price = side === "BUY"
      ? Math.max(0.01, Math.round((yesPrice - MAKER_REBATES_CONFIG.spreadFromMid) * 100) / 100)
      : Math.min(0.99, Math.round((yesPrice + MAKER_REBATES_CONFIG.spreadFromMid) * 100) / 100);

    // Calculate shares
    const amount = MAKER_REBATES_CONFIG.budget / 6; // Split across multiple orders
    const shares = Math.max(MAKER_REBATES_CONFIG.minShares, Math.floor(amount / price));

    console.log(`🎲 ${side} limit on "${market.question?.slice(0, 40)}..." @ ${price}`);

    // Place order with postOnly=true for maker rebates
    const result = await service.placeSellOrder(tokenId, price, shares, true);

    if (!result.success) {
      console.log(`🎲 Order failed:`, result.error);
      return null;
    }

    const order: MakerOrder = {
      marketId: market.id,
      question: market.question || "",
      tokenId,
      orderId: result.orderId || "",
      side,
      price,
      shares,
      placedAt: new Date().toISOString(),
    };

    makerOrders.push(order);
    console.log(`🎲 ✅ ${side} order placed`);

    return order;
  } catch (e: any) {
    console.log(`🎲 Error placing maker order:`, e.message);
    return null;
  }
}

/**
 * Clean up expired or filled orders
 */
export async function cleanupMakerOrders(service: PolymarketService): Promise<void> {
  const openOrders = await service.getOpenOrders();
  const openOrderIds = new Set(openOrders.map((o: any) => o.id || o.order_id));

  // Remove orders that are no longer open
  const before = makerOrders.length;
  makerOrders = makerOrders.filter(o => openOrderIds.has(o.orderId));
  const removed = before - makerOrders.length;

  if (removed > 0) {
    console.log(`🎲 Cleaned up ${removed} filled/expired orders`);
  }
}

/**
 * Run maker rebates strategy
 */
export async function runMakerRebatesStrategy(service: PolymarketService): Promise<void> {
  if (!MAKER_REBATES_CONFIG.enabled) return;

  console.log(`\n🎲 === MAKER REBATES (15-min Crypto) ===`);

  // Cleanup old orders
  await cleanupMakerOrders(service);

  // Get crypto markets
  const cryptoMarkets = await fetchCryptoMarkets(service);
  console.log(`🎲 Found ${cryptoMarkets.length} short-term crypto markets`);

  // Place orders on markets we don't have yet
  for (const market of cryptoMarkets.slice(0, 3)) {
    // Skip if already have order on this market
    if (makerOrders.some(o => o.marketId === market.id)) continue;

    // Place BUY and SELL orders
    await placeMakerOrder(service, market, "BUY");
    await placeMakerOrder(service, market, "SELL");
  }

  console.log(`🎲 Active maker orders: ${makerOrders.length}`);
}
