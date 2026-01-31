/**
 * Holding Rewards Strategy
 * 
 * Earn 4% APY by holding positions in long-term eligible markets.
 * Targets markets like presidential elections that pay holding rewards.
 * 
 * @author ElizaBAO
 */

import type { PolymarketService } from "../services/polymarket-service.js";

// Configuration
export const HOLDING_CONFIG = {
  enabled: true,
  budget: 10,             // $10 for holding rewards
  runEveryNScans: 10,     // Run every 10 scans (~20 minutes)
  eligibleSlugs: [
    'presidential-election-winner-2028',
    'republican-presidential-nominee-2028',
    'democratic-presidential-nominee-2028',
    'which-party-wins-2028-us-presidential-election',
    'balance-of-power-2026-midterms',
    'which-party-will-win-the-senate-in-2026',
    'which-party-will-win-the-house-in-2026',
    'russia-x-ukraine-ceasefire-before-2027',
  ],
};

export interface HoldingPosition {
  marketId: string;
  question: string;
  slug: string;
  tokenId: string;
  shares: number;
  entryPrice: number;
  amount: number;
  startedAt: string;
  estimatedDailyReward: number;
}

// Active holding positions
let holdingPositions: HoldingPosition[] = [];
let totalHoldingRewards = 0;

/**
 * Get active holding positions
 */
export function getHoldingPositions(): HoldingPosition[] {
  return holdingPositions;
}

/**
 * Get total rewards earned
 */
export function getTotalHoldingRewards(): number {
  return totalHoldingRewards;
}

/**
 * Get estimated daily rewards
 */
export function getEstimatedDailyRewards(): number {
  return holdingPositions.reduce((sum, p) => sum + p.estimatedDailyReward, 0);
}

/**
 * Fetch eligible markets for holding rewards
 */
export async function fetchEligibleMarkets(service: PolymarketService): Promise<any[]> {
  const eligible: any[] = [];
  
  for (const slug of HOLDING_CONFIG.eligibleSlugs) {
    try {
      const markets = await service.searchMarkets(slug, 5);
      const match = markets.find(m => m.slug === slug || m.slug?.includes(slug));
      if (match) {
        eligible.push(match);
      }
    } catch {}
  }
  
  return eligible;
}

/**
 * Buy a holding position
 */
export async function buyHoldingPosition(
  service: PolymarketService,
  market: any
): Promise<HoldingPosition | null> {
  if (!HOLDING_CONFIG.enabled) return null;

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

    // Skip if price is too extreme
    if (yesPrice < 0.10 || yesPrice > 0.90) {
      console.log(`📈 Skip ${market.question?.slice(0, 30)}... - price too extreme`);
      return null;
    }

    // Calculate position size
    const amount = HOLDING_CONFIG.budget / HOLDING_CONFIG.eligibleSlugs.length;
    const shares = Math.floor(amount / yesPrice);

    if (shares < 5) {
      console.log(`📈 Skip ${market.question?.slice(0, 30)}... - insufficient shares`);
      return null;
    }

    console.log(`📈 HOLDING: "${market.question?.slice(0, 50)}..."`);
    console.log(`📈 Price: ${(yesPrice * 100).toFixed(1)}% | Shares: ${shares} | Cost: $${(shares * yesPrice).toFixed(2)}`);

    // Place buy order
    const buyPrice = Math.min(0.99, yesPrice + 0.02);
    const result = await service.placeBuyOrder(tokenId, buyPrice, shares);

    if (!result.success) {
      console.log(`📈 BUY failed:`, result.error);
      return null;
    }

    // Calculate estimated daily reward (4% APY)
    const positionValue = shares * yesPrice;
    const dailyRate = 0.04 / 365;
    const estimatedDailyReward = positionValue * dailyRate;

    const position: HoldingPosition = {
      marketId: market.id,
      question: market.question || "",
      slug: market.slug || "",
      tokenId,
      shares,
      entryPrice: yesPrice,
      amount: positionValue,
      startedAt: new Date().toISOString(),
      estimatedDailyReward,
    };

    holdingPositions.push(position);
    console.log(`📈 ✅ Holding position opened (est. $${estimatedDailyReward.toFixed(4)}/day)`);

    return position;
  } catch (e: any) {
    console.log(`📈 Error buying holding position:`, e.message);
    return null;
  }
}

/**
 * Run holding rewards strategy
 */
export async function runHoldingRewardsStrategy(service: PolymarketService): Promise<void> {
  if (!HOLDING_CONFIG.enabled) return;

  console.log(`\n📈 === HOLDING REWARDS (4% APY) ===`);

  // Get eligible markets
  const eligibleMarkets = await fetchEligibleMarkets(service);
  console.log(`📈 Found ${eligibleMarkets.length} eligible markets`);

  // Buy positions in markets we don't have yet
  for (const market of eligibleMarkets) {
    // Skip if already have position
    if (holdingPositions.some(p => p.marketId === market.id)) continue;
    if (service.hasTraded(market.id)) continue;

    await buyHoldingPosition(service, market);
  }

  const dailyRewards = getEstimatedDailyRewards();
  console.log(`📈 Holding positions: ${holdingPositions.length} (~$${dailyRewards.toFixed(3)}/day)`);
}
