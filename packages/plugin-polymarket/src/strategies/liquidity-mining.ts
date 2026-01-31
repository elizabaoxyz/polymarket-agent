/**
 * Liquidity Mining Strategy
 * 
 * Earn rewards by providing two-sided quotes (bid/ask) on markets.
 * Places both BUY and SELL limit orders around the midpoint.
 * 
 * @author ElizaBAO
 */

import type { PolymarketService } from "../services/polymarket-service.js";

// Configuration
export const LIQUIDITY_CONFIG = {
  enabled: true,
  minShares: 5,           // Min shares per side
  spread: 0.02,           // 2¢ from midpoint
  budget: 25,             // $25 budget
  rebalanceThreshold: 0.05, // Rebalance if price moves 5%
  runEveryNScans: 5,      // Run every 5 scans (~10 minutes)
};

export interface LiquidityOrder {
  marketId: string;
  question: string;
  tokenId: string;
  buyOrderId: string;
  sellOrderId: string;
  buyPrice: number;
  sellPrice: number;
  shares: number;
  placedAt: string;
  lastChecked: string;
}

// Active liquidity orders
let liquidityOrders: LiquidityOrder[] = [];
let totalLiquidityRewards = 0;

/**
 * Get active liquidity orders
 */
export function getLiquidityOrders(): LiquidityOrder[] {
  return liquidityOrders;
}

/**
 * Get total rewards earned
 */
export function getTotalLiquidityRewards(): number {
  return totalLiquidityRewards;
}

/**
 * Fetch markets with active liquidity rewards
 */
export async function fetchRewardMarkets(service: PolymarketService): Promise<any[]> {
  try {
    const markets = await service.fetchMarkets(50);
    
    // Filter for markets likely to have rewards (high liquidity, active)
    return markets.filter((m: any) => {
      const liquidity = m.liquidityNum || m.liquidity || 0;
      const volume = m.volume24hr || 0;
      return liquidity > 5000 && volume > 10000;
    }).slice(0, 10);
  } catch (e) {
    console.log("⚠️ Could not fetch reward markets");
    return [];
  }
}

/**
 * Place two-sided liquidity orders on a market
 */
export async function placeLiquidityOrders(
  service: PolymarketService,
  market: any
): Promise<LiquidityOrder | null> {
  if (!LIQUIDITY_CONFIG.enabled) return null;

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

    // Calculate two-sided quotes around midpoint
    const midPrice = yesPrice;
    const buyPrice = Math.max(0.01, Math.round((midPrice - LIQUIDITY_CONFIG.spread) * 100) / 100);
    const sellPrice = Math.min(0.99, Math.round((midPrice + LIQUIDITY_CONFIG.spread) * 100) / 100);

    // Skip if spread is too tight or too wide
    if (sellPrice - buyPrice < 0.02 || sellPrice - buyPrice > 0.10) {
      console.log(`💧 Skip ${market.question?.slice(0, 30)}... - spread not optimal`);
      return null;
    }

    // Calculate shares
    const costPerSide = LIQUIDITY_CONFIG.budget / 4; // Split budget across 2 markets × 2 sides
    const shares = Math.max(LIQUIDITY_CONFIG.minShares, Math.floor(costPerSide / buyPrice));

    console.log(`💧 Placing liquidity on: "${market.question?.slice(0, 40)}..."`);
    console.log(`💧 Midpoint: ${(midPrice * 100).toFixed(1)}% | BUY @${buyPrice} | SELL @${sellPrice}`);
    console.log(`💧 Shares: ${shares} per side | Cost: ~$${(costPerSide * 2).toFixed(2)}`);

    // Place BUY limit order (postOnly=true for rewards)
    const buyResult = await service.placeSellOrder(tokenId, buyPrice, shares, true);
    if (!buyResult.success) {
      console.log(`💧 BUY order failed:`, buyResult.error);
      return null;
    }
    console.log(`💧 ✅ BUY limit placed @ ${buyPrice}`);

    // Place SELL limit order (postOnly=true for rewards)
    const sellResult = await service.placeSellOrder(tokenId, sellPrice, shares, true);
    let sellOrderId = "";
    if (sellResult.success) {
      sellOrderId = sellResult.orderId || "";
      console.log(`💧 ✅ SELL limit placed @ ${sellPrice}`);
    } else {
      console.log(`💧 ⚠️ SELL order failed:`, sellResult.error);
    }

    const order: LiquidityOrder = {
      marketId: market.id,
      question: market.question || "",
      tokenId,
      buyOrderId: buyResult.orderId || "",
      sellOrderId,
      buyPrice,
      sellPrice,
      shares,
      placedAt: new Date().toISOString(),
      lastChecked: new Date().toISOString(),
    };

    liquidityOrders.push(order);
    return order;
  } catch (e: any) {
    console.log(`💧 Error placing liquidity:`, e.message);
    return null;
  }
}

/**
 * Check and rebalance existing liquidity orders
 */
export async function rebalanceLiquidityOrders(service: PolymarketService): Promise<void> {
  for (const order of liquidityOrders) {
    try {
      const currentPrice = await service.getMarketPrice(order.marketId);
      if (!currentPrice) continue;

      const midPrice = (order.buyPrice + order.sellPrice) / 2;
      const drift = Math.abs(currentPrice - midPrice);

      if (drift > LIQUIDITY_CONFIG.rebalanceThreshold) {
        console.log(`💧 Rebalancing ${order.question?.slice(0, 30)}... (drift: ${(drift * 100).toFixed(1)}%)`);

        // Cancel old orders
        if (order.buyOrderId) await service.cancelOrder(order.buyOrderId);
        if (order.sellOrderId) await service.cancelOrder(order.sellOrderId);

        // Place new orders at current price
        const newBuyPrice = Math.max(0.01, Math.round((currentPrice - LIQUIDITY_CONFIG.spread) * 100) / 100);
        const newSellPrice = Math.min(0.99, Math.round((currentPrice + LIQUIDITY_CONFIG.spread) * 100) / 100);

        const buyResult = await service.placeSellOrder(order.tokenId, newBuyPrice, order.shares, true);
        const sellResult = await service.placeSellOrder(order.tokenId, newSellPrice, order.shares, true);

        order.buyOrderId = buyResult.orderId || "";
        order.sellOrderId = sellResult.orderId || "";
        order.buyPrice = newBuyPrice;
        order.sellPrice = newSellPrice;
        order.lastChecked = new Date().toISOString();

        console.log(`💧 Rebalanced: BUY @${newBuyPrice} | SELL @${newSellPrice}`);
      }
    } catch (e: any) {
      console.log(`💧 Rebalance error:`, e.message);
    }
  }
}

/**
 * Run liquidity mining strategy
 */
export async function runLiquidityMiningStrategy(service: PolymarketService): Promise<void> {
  if (!LIQUIDITY_CONFIG.enabled) return;

  console.log(`\n💧 === LIQUIDITY MINING ===`);

  // Check existing orders
  await rebalanceLiquidityOrders(service);

  // If we have room, add more markets
  if (liquidityOrders.length < 2) {
    const markets = await fetchRewardMarkets(service);
    
    for (const market of markets.slice(0, 2 - liquidityOrders.length)) {
      // Skip if already providing liquidity
      if (liquidityOrders.some(o => o.marketId === market.id)) continue;
      
      await placeLiquidityOrders(service, market);
    }
  }

  console.log(`💧 Active orders: ${liquidityOrders.length}`);
}
