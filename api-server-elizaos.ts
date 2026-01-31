import "dotenv/config";
import { Hono } from "hono";
import { cors } from "hono/cors";
import { serve } from "@hono/node-server";
import { ethers } from "ethers";
import { ClobClient, OrderType } from "@polymarket/clob-client";
import * as fs from "fs";

const PORT = process.env.PORT || 3001;
const GAMMA_API_URL = "https://gamma-api.polymarket.com";
const XTRACKER_API_URL = "https://xtracker.polymarket.com/api";
const ANTHROPIC_KEY = process.env.ANTHROPIC_API_KEY || "";
const PRIVATE_KEY = process.env.EVM_PRIVATE_KEY || "";
const WALLET_ADDRESS = process.env.WALLET_ADDRESS || "";
const CLOB_API_KEY = process.env.CLOB_API_KEY || "";
const CLOB_API_SECRET = process.env.CLOB_API_SECRET || "";
const CLOB_API_PASSPHRASE = process.env.CLOB_API_PASSPHRASE || "";
const PROXY_WALLET = "0xd11f3CfeDBf91aF200a4d5f62d1DE692E0730Fe8";
const POSITIONS_FILE = "./positions.json";

let autonomyEnabled = false;
let autonomyIntervalMs = 120000;
let autoTradeEnabled = false;
const MAX_HISTORY = 50;

// TRADE SIZES (minimum $2 to ensure 5+ shares for TP orders)
const REGULAR_TRADE_SIZE = 2;    // $2 for regular markets (ensures 5+ shares)
const ELON_TRADE_SIZE = 20;      // $20 for Elon tweet markets

// POSITION LIMITS
const MAX_POSITIONS = 20;        // Total max positions
const MAX_ELON_POSITIONS = 3;    // Max Elon tweet positions

let takeProfitPercent = 20;
let stopLossPercent = 15;

// ============================================================
// v4.0 NEW FEATURES: LIQUIDITY REWARDS + HOLDING REWARDS
// ============================================================

// LIQUIDITY MINING CONFIG
const LIQUIDITY_MINING_ENABLED = true;
const LIQUIDITY_MIN_SHARES = 5;            // Min shares per side (reduced for $50 test)
const LIQUIDITY_SPREAD = 0.02;             // 2¢ from midpoint
const LIQUIDITY_BUDGET = 25;               // $25 for liquidity mining (TEST MODE)
const LIQUIDITY_REBALANCE_THRESHOLD = 0.05; // Rebalance if price moves 5%

// HOLDING REWARDS CONFIG (4% APY)
const HOLDING_REWARDS_ENABLED = true;
const HOLDING_BUDGET = 10;                 // $10 for holding rewards (TEST MODE)
const HOLDING_ELIGIBLE_SLUGS = [
  'presidential-election-winner-2028',
  'republican-presidential-nominee-2028',
  'democratic-presidential-nominee-2028',
  'which-party-wins-2028-us-presidential-election',
  'balance-of-power-2026-midterms',
  'which-party-will-win-the-senate-in-2026',
  'which-party-will-win-the-house-in-2026',
  'russia-x-ukraine-ceasefire-before-2027'
];

// MAKER REBATES CONFIG (15-min crypto)
const MAKER_REBATES_ENABLED = true;
const MAKER_REBATES_BUDGET = 15;           // $15 for maker rebates (TEST MODE)

// ELON EDGE THRESHOLDS (probability edge over market price)
const ELON_EDGE_ENABLED = true;            // Enable edge filtering for Elon trades
const ELON_MEDIUM_EDGE = 0.10;             // 10% edge = MEDIUM confidence
const ELON_HIGH_EDGE = 0.20;               // 20% edge = HIGH confidence
const ELON_MIN_EDGE = 0.05;                // Minimum 5% edge required to trade

// Track liquidity orders and holding positions
interface LiquidityOrder {
  marketId: string;
  question: string;
  buyOrderId: string;
  sellOrderId: string;
  buyPrice: number;
  sellPrice: number;
  shares: number;
  placedAt: string;
  midPrice: number;
}

interface HoldingPosition {
  marketId: string;
  question: string;
  slug: string;
  shares: number;
  entryPrice: number;
  currentValue: number;
  estimatedDailyReward: number;
  acquiredAt: string;
}

let liquidityOrders: LiquidityOrder[] = [];
let holdingPositions: HoldingPosition[] = [];
let totalLiquidityRewards = 0;
let totalHoldingRewards = 0;

// ============================================================
// ELON TWEET HISTORICAL DATA (81 weeks)
// ElizaBAO Prediction Engine - Powered by ShawMakesMagic
// ============================================================
const ELON_HISTORICAL_DATA = {
  averageRate: 2.5,
  historicalPeriods: [
    { start: '2026-01-13', end: '2026-01-20', total: 530, rate: 3.15 },
    { start: '2026-01-06', end: '2026-01-13', total: 550, rate: 3.27 },
    { start: '2025-12-30', end: '2026-01-06', total: 530, rate: 3.15 },
    { start: '2025-12-23', end: '2025-12-30', total: 430, rate: 2.56 },
    { start: '2025-12-16', end: '2025-12-23', total: 350, rate: 2.08 },
    { start: '2025-12-09', end: '2025-12-16', total: 270, rate: 1.61 },
    { start: '2025-12-02', end: '2025-12-09', total: 430, rate: 2.56 },
    { start: '2025-11-25', end: '2025-12-02', total: 270, rate: 1.61 },
    { start: '2025-11-18', end: '2025-11-25', total: 210, rate: 1.25 },
    { start: '2025-11-11', end: '2025-11-18', total: 270, rate: 1.61 },
    { start: '2025-11-04', end: '2025-11-11', total: 150, rate: 0.89 },
    { start: '2025-10-28', end: '2025-11-04', total: 210, rate: 1.25 },
    { start: '2025-10-24', end: '2025-10-31', total: 210, rate: 1.25 },
    { start: '2025-10-17', end: '2025-10-24', total: 290, rate: 1.73 },
    { start: '2025-10-10', end: '2025-10-17', total: 190, rate: 1.13 },
    { start: '2025-10-03', end: '2025-10-10', total: 290, rate: 1.73 },
    { start: '2025-09-26', end: '2025-10-03', total: 250, rate: 1.49 },
    { start: '2025-09-19', end: '2025-09-26', total: 130, rate: 0.77 },
    { start: '2025-09-16', end: '2025-09-23', total: 190, rate: 1.13 },
    { start: '2025-09-12', end: '2025-09-19', total: 250, rate: 1.49 },
    { start: '2025-09-05', end: '2025-09-12', total: 230, rate: 1.37 },
    { start: '2025-08-29', end: '2025-09-05', total: 465, rate: 2.77 },
    { start: '2025-08-22', end: '2025-08-29', total: 202, rate: 1.20 },
    { start: '2025-08-15', end: '2025-08-22', total: 230, rate: 1.37 },
    { start: '2025-08-08', end: '2025-08-15', total: 490, rate: 2.92 },
    { start: '2025-08-01', end: '2025-08-08', total: 270, rate: 1.61 },
    { start: '2025-07-25', end: '2025-08-01', total: 157, rate: 0.93 },
    { start: '2025-07-18', end: '2025-07-25', total: 202, rate: 1.20 },
    { start: '2025-07-11', end: '2025-07-18', total: 187, rate: 1.11 },
    { start: '2025-07-04', end: '2025-07-11', total: 157, rate: 0.93 },
    { start: '2025-06-27', end: '2025-07-04', total: 172, rate: 1.02 },
    { start: '2025-06-20', end: '2025-06-27', total: 137, rate: 0.82 },
    { start: '2025-06-13', end: '2025-06-20', total: 152, rate: 0.90 },
    { start: '2025-06-06', end: '2025-06-13', total: 187, rate: 1.11 },
    { start: '2025-05-30', end: '2025-06-06', total: 240, rate: 1.43 },
    { start: '2025-05-23', end: '2025-05-30', total: 137, rate: 0.82 },
    { start: '2025-05-16', end: '2025-05-23', total: 162, rate: 0.96 },
    { start: '2025-05-09', end: '2025-05-16', total: 262, rate: 1.56 },
    { start: '2025-05-02', end: '2025-05-09', total: 237, rate: 1.41 },
    { start: '2025-04-25', end: '2025-05-02', total: 162, rate: 0.96 },
    { start: '2025-04-18', end: '2025-04-25', total: 212, rate: 1.26 },
    { start: '2025-04-11', end: '2025-04-18', total: 162, rate: 0.96 },
    { start: '2025-04-04', end: '2025-04-11', total: 230, rate: 1.37 },
    { start: '2025-03-28', end: '2025-04-04', total: 337, rate: 2.01 },
    { start: '2025-03-21', end: '2025-03-28', total: 487, rate: 2.90 },
    { start: '2025-03-14', end: '2025-03-21', total: 437, rate: 2.60 },
    { start: '2025-03-07', end: '2025-03-14', total: 512, rate: 3.05 },
    { start: '2025-02-28', end: '2025-03-07', total: 575, rate: 3.42 },
    { start: '2025-02-21', end: '2025-02-28', total: 775, rate: 4.61 },
    { start: '2025-02-14', end: '2025-02-21', total: 625, rate: 3.72 },
    { start: '2025-02-07', end: '2025-02-14', total: 820, rate: 4.88 },
    { start: '2025-01-31', end: '2025-02-07', total: 470, rate: 2.80 },
    { start: '2025-01-24', end: '2025-01-31', total: 287, rate: 1.71 },
    { start: '2025-01-17', end: '2025-01-24', total: 337, rate: 2.01 },
    { start: '2025-01-10', end: '2025-01-17', total: 425, rate: 2.53 },
    { start: '2025-01-03', end: '2025-01-10', total: 520, rate: 3.10 },
    { start: '2024-12-27', end: '2025-01-03', total: 413, rate: 2.46 },
    { start: '2024-12-20', end: '2024-12-27', total: 312, rate: 1.86 },
    { start: '2024-12-13', end: '2024-12-20', total: 412, rate: 2.45 },
    { start: '2024-12-06', end: '2024-12-13', total: 412, rate: 2.45 },
    { start: '2024-11-29', end: '2024-12-06', total: 280, rate: 1.67 },
    { start: '2024-11-22', end: '2024-11-29', total: 487, rate: 2.90 },
    { start: '2024-11-15', end: '2024-11-22', total: 470, rate: 2.80 },
    { start: '2024-11-08', end: '2024-11-15', total: 387, rate: 2.30 },
    { start: '2024-11-01', end: '2024-11-08', total: 387, rate: 2.30 },
    { start: '2024-10-25', end: '2024-11-01', total: 420, rate: 2.50 },
    { start: '2024-10-18', end: '2024-10-25', total: 320, rate: 1.90 },
    { start: '2024-10-11', end: '2024-10-18', total: 212, rate: 1.26 },
    { start: '2024-10-04', end: '2024-10-11', total: 187, rate: 1.11 },
    { start: '2024-09-27', end: '2024-10-04', total: 320, rate: 1.90 },
    { start: '2024-09-20', end: '2024-09-27', total: 212, rate: 1.26 },
  ],
  seasonalFactors: {
    1: 1.56, 2: 2.45, 3: 1.55, 4: 0.67, 5: 0.65, 6: 0.39,
    7: 0.49, 8: 0.84, 9: 0.80, 10: 0.91, 11: 1.14, 12: 1.38
  }
};

// ============================================================
// POSITION MANAGEMENT
// ============================================================
interface Position {
  id: string;
  marketId: string;
  question: string;
  slug: string;
  side: "BUY" | "SELL";
  entryPrice: number;
  size: number;
  amount: number;
  tokenId: string;
  openedAt: string;
  status: "open" | "closed";
  closedAt?: string;
  exitPrice?: number;
  pnl?: number;
  closeReason?: string;
  category?: string;
  tpOrderId?: string;
  tpPrice?: number;
}

let positions: Position[] = [];
const tradeHistory: any[] = [];
let lastDecision: any = null;
let autonomyRunning = false;
let totalScans = 0;
let totalTrades = 0;
let totalPnl = 0;
const tradedMarkets: Set<string> = new Set();

function loadPositions() {
  try {
    if (fs.existsSync(POSITIONS_FILE)) {
      const data = fs.readFileSync(POSITIONS_FILE, 'utf8');
      const saved = JSON.parse(data);
      positions = saved.positions || [];
      totalTrades = saved.totalTrades || 0;
      totalPnl = saved.totalPnl || 0;
      
      // Add ALL positions to tradedMarkets (including closed) to prevent re-buying
      positions.forEach(p => tradedMarkets.add(p.marketId));
      
      const openCount = positions.filter(p => p.status === "open").length;
      console.log(`📂 Loaded ${positions.length} positions (${openCount} open)`);
      console.log(`📂 tradedMarkets: ${tradedMarkets.size} unique markets (will NOT re-buy)`);
    }
  } catch (e) {
    console.log("📂 No saved positions found, starting fresh");
  }
}

function savePositions() {
  try {
    const data = JSON.stringify({ positions, totalTrades, totalPnl }, null, 2);
    fs.writeFileSync(POSITIONS_FILE, data);
  } catch (e) {
    console.error("Failed to save positions:", e);
  }
}

// Count open Elon positions
function getOpenElonPositions(): number {
  return positions.filter(p => p.status === "open" && p.category === "elon").length;
}

// ============================================================
// CLOB CLIENT
// ============================================================
let clobClient: ClobClient | null = null;

async function initClobClient() {
  if (clobClient) return clobClient;
  if (!PRIVATE_KEY || !CLOB_API_KEY) {
    console.log("⚠️ CLOB credentials not configured");
    return null;
  }
  
  const provider = new ethers.providers.JsonRpcProvider("https://polygon.llamarpc.com");
  const wallet = new ethers.Wallet(PRIVATE_KEY, provider);
  
  clobClient = new ClobClient(
    "https://clob.polymarket.com",
    137,
    wallet,
    { key: CLOB_API_KEY, secret: CLOB_API_SECRET, passphrase: CLOB_API_PASSPHRASE },
    2,
    PROXY_WALLET
  );
  console.log("CLOB client initialized with proxy wallet:", PROXY_WALLET);
  return clobClient;
}

// ============================================================
// MARKET DATA FETCHING
// ============================================================
async function fetchMarkets(limit = 100) {
  const url = `${GAMMA_API_URL}/markets?limit=${limit}&active=true&closed=false&order=volume24hr&ascending=false`;
  const res = await fetch(url);
  return res.json();
}

async function searchMarkets(query: string, limit = 20) {
  try {
    const url = `${GAMMA_API_URL}/markets?limit=${limit}&active=true&closed=false`;
    const res = await fetch(url);
    const markets = await res.json();
    return markets.filter((m: any) => 
      m.question?.toLowerCase().includes(query.toLowerCase()) ||
      m.slug?.toLowerCase().includes(query.toLowerCase())
    );
  } catch (e) {
    return [];
  }
}

async function getMarketPrice(marketId: string): Promise<number> {
  try {
    const markets = await fetchMarkets(100);
    const market = markets.find((m: any) => m.id === marketId);
    if (market) return parseFloat(JSON.parse(market.outcomePrices)[0]);
  } catch {}
  return 0;
}

// ============================================================
// ELON TWEET PREDICTION (ElizaBAO Bayesian Engine)
// ============================================================
interface ElonTracking {
  id: string;
  title: string;
  startDate: Date;
  endDate: Date;
  count: number;
}

// Cache for Elon posts to avoid fetching every scan
let cachedElonPosts: any[] = [];
let lastPostsFetch = 0;
const POSTS_CACHE_MS = 300000; // 5 minutes

// Get ALL active Elon tweet trackings (multiple date ranges)
async function getAllElonTrackings(): Promise<ElonTracking[]> {
  try {
    const trackingsUrl = `${XTRACKER_API_URL}/users/elonmusk/trackings?activeOnly=true&platform=X`;
    console.log("🐦 Fetching Elon trackings from XTracker...");
    
    const trackingsRes = await fetch(trackingsUrl, { 
      headers: { 'Accept': 'application/json' }
    });
    
    if (!trackingsRes.ok) {
      console.log(`🐦 XTracker returned status ${trackingsRes.status}`);
      return [];
    }
    
    const trackingsData = await trackingsRes.json();
    const trackings = trackingsData.data || trackingsData;
    
    if (!trackings || trackings.length === 0) {
      console.log("🐦 No trackings found in response");
      return [];
    }
    
    console.log(`🐦 Found ${trackings.length} tracking period(s)`);
    
    // Fetch all posts (with caching)
    const now = Date.now();
    if (now - lastPostsFetch > POSTS_CACHE_MS || cachedElonPosts.length === 0) {
      console.log("🐦 Fetching all Elon posts (cache expired)...");
      try {
        const postsUrl = `${XTRACKER_API_URL}/users/elonmusk/posts?limit=10000`;
        const postsRes = await fetch(postsUrl, { headers: { 'Accept': 'application/json' } });
        if (postsRes.ok) {
          const postsData = await postsRes.json();
          cachedElonPosts = postsData.data || [];
          lastPostsFetch = now;
          console.log(`🐦 Cached ${cachedElonPosts.length} total Elon posts`);
        }
      } catch (e: any) {
        console.log(`🐦 Posts fetch error: ${e.message}`);
      }
    } else {
      console.log(`🐦 Using cached posts (${cachedElonPosts.length} posts)`);
    }
    
    const results: ElonTracking[] = [];
    
    for (const tracking of trackings) {
      console.log(`🐦 Processing: ${tracking.title}`);
      
      const startDate = new Date(tracking.startDate);
      const endDate = new Date(tracking.endDate);
      
      // Count posts within this tracking's date range
      const postsInRange = cachedElonPosts.filter((post: any) => {
        const postDate = new Date(post.createdAt);
        return postDate >= startDate && postDate <= endDate;
      });
      
      const count = postsInRange.length;
      console.log(`🐦 ${tracking.title}: ${count} tweets (filtered from ${cachedElonPosts.length} total)`);
      
      results.push({
        id: tracking.id,
        title: tracking.title,
        startDate,
        endDate,
        count
      });
    }
    
    return results;
  } catch (e: any) {
    console.error("🐦 XTracker error:", e.message);
    return [];
  }
}

// Legacy function for API endpoint
async function getElonTweetCount(): Promise<{count: number, startDate: Date, endDate: Date} | null> {
  const trackings = await getAllElonTrackings();
  if (trackings.length === 0) return null;
  const t = trackings[0];
  return { count: t.count, startDate: t.startDate, endDate: t.endDate };
}

function predictElonTweets(currentCount: number, elapsedHours: number, totalHours: number = 168): {
  predicted: number;
  lowerBound: number;
  upperBound: number;
  confidence: number;
} {
  const rates = ELON_HISTORICAL_DATA.historicalPeriods.map(p => p.rate);
  const simpleAvg = rates.reduce((a, b) => a + b, 0) / rates.length;
  
  // Use MEDIAN for more accurate predictions
  const sortedRates = [...rates].sort((a, b) => a - b);
  const medianRate = sortedRates[Math.floor(sortedRates.length / 2)];
  
  const remainingHours = totalHours - elapsedHours;
  let predicted: number;
  
  if (elapsedHours < 12 || currentCount < 10) {
    // FUTURE MARKET: Use median rate, NO seasonal factor
    predicted = Math.round(currentCount + medianRate * remainingHours);
    console.log(`🐦 Prediction (future market): median rate ${medianRate.toFixed(2)}/h × ${remainingHours.toFixed(0)}h = ${predicted}`);
  } else {
    // ACTIVE MARKET: Use Bayesian update with observed rate
    const currentRate = currentCount / elapsedHours;
    const priorWeight = 0.3;
    const observedWeight = 0.7;
    const posteriorRate = (priorWeight * simpleAvg) + (observedWeight * currentRate);
    
    // Only apply seasonal factor for active markets with enough data
    const month = new Date().getMonth() + 1;
    const seasonalFactor = ELON_HISTORICAL_DATA.seasonalFactors[month as keyof typeof ELON_HISTORICAL_DATA.seasonalFactors] || 1.0;
    const adjustedRate = posteriorRate * seasonalFactor;
    
    predicted = Math.round(currentCount + adjustedRate * remainingHours);
    console.log(`🐦 Prediction (active market): ${currentCount} + ${adjustedRate.toFixed(2)}/h × ${remainingHours.toFixed(0)}h = ${predicted}`);
  }
  
  const variance = rates.reduce((sum, r) => sum + Math.pow(r - simpleAvg, 2), 0) / rates.length;
  const stdDev = Math.sqrt(variance) * totalHours;
  const marginOfError = 1.96 * stdDev;
  
  const lowerBound = Math.max(currentCount, Math.round(predicted - marginOfError));
  const upperBound = Math.round(predicted + marginOfError);
  const confidence = Math.min(0.70 + (elapsedHours / totalHours) * 0.25, 0.95);
  
  return { predicted, lowerBound, upperBound, confidence };
}

// Calculate probability that Elon tweets fall in a specific range
function calculateBucketProbability(
  lowerRange: number, 
  upperRange: number, 
  predicted: number, 
  stdDev: number
): number {
  // Using normal distribution approximation
  const mean = predicted;
  const sigma = stdDev / 1.96; // Convert margin of error back to stdDev
  
  // Z-scores for bucket boundaries
  const zLower = (lowerRange - mean) / sigma;
  const zUpper = (upperRange - mean) / sigma;
  
  // Approximate CDF using error function approximation
  const erf = (x: number) => {
    const t = 1 / (1 + 0.5 * Math.abs(x));
    const tau = t * Math.exp(-x * x - 1.26551223 +
      t * (1.00002368 + t * (0.37409196 + t * (0.09678418 + 
      t * (-0.18628806 + t * (0.27886807 + t * (-1.13520398 + 
      t * (1.48851587 + t * (-0.82215223 + t * 0.17087277)))))))));
    return x >= 0 ? 1 - tau : tau - 1;
  };
  
  const cdf = (z: number) => 0.5 * (1 + erf(z / Math.sqrt(2)));
  
  return Math.max(0, cdf(zUpper) - cdf(zLower));
}

// Find the best Elon tweet bucket to bet on
// Extract date range from market question
function extractDateRange(question: string): {startMonth: string, startDay: number, endMonth: string, endDay: number} | null {
  // Match patterns like "January 27 to February 3" or "from January 27 to February 3"
  const dateRegex = /(\w+)\s+(\d+)\s*(?:to|-)\s*(\w+)\s+(\d+)/i;
  const match = question.match(dateRegex);
  if (!match) return null;
  return {
    startMonth: match[1].toLowerCase(),
    startDay: parseInt(match[2]),
    endMonth: match[3].toLowerCase(),
    endDay: parseInt(match[4])
  };
}

// Check if tracking dates match market dates
function datesMatch(tracking: ElonTracking, marketDates: {startMonth: string, startDay: number, endMonth: string, endDay: number}): boolean {
  const months = ['january', 'february', 'march', 'april', 'may', 'june', 'july', 'august', 'september', 'october', 'november', 'december'];
  
  const trackingStartMonth = months[tracking.startDate.getMonth()];
  const trackingStartDay = tracking.startDate.getDate();
  const trackingEndMonth = months[tracking.endDate.getMonth()];
  const trackingEndDay = tracking.endDate.getDate();
  
  return trackingStartMonth === marketDates.startMonth && 
         trackingStartDay === marketDates.startDay &&
         trackingEndMonth === marketDates.endMonth &&
         trackingEndDay === marketDates.endDay;
}

// Get all Elon tweet markets from Polymarket (via EVENTS API - markets are restricted)
async function getAllElonTweetMarkets(): Promise<any[]> {
  try {
    console.log("🐦 Fetching Elon tweet events from Gamma API...");
    
    const allBucketMarkets: any[] = [];
    
    // METHOD 1: Search by known slug patterns (most reliable for restricted markets)
    const knownSlugs = [
      'elon-musk-of-tweets-january-30-february-6',
      'elon-musk-of-tweets-january-27-february-3',
      'elon-musk-of-tweets-january-23-january-30',
      'elon-musk-of-tweets-february-6-february-13',
      'elon-musk-tweets-january-30-february-6',
    ];
    
    for (const slug of knownSlugs) {
      try {
        const eventDetailUrl = `${GAMMA_API_URL}/events?slug=${slug}`;
        const detailRes = await fetch(eventDetailUrl);
        const detailData = await detailRes.json();
        
        if (detailData && detailData[0] && detailData[0].markets && detailData[0].active) {
          const event = detailData[0];
          console.log(`🐦 ✅ Found event: "${event.title}" (${event.markets.length} markets)`);
          
          for (const m of event.markets) {
            allBucketMarkets.push({
              ...m,
              eventTitle: event.title,
              eventSlug: event.slug
            });
          }
        }
      } catch (e) {
        // Slug not found, skip silently
      }
    }
    
    // METHOD 2: Also try general events search
    if (allBucketMarkets.length === 0) {
      console.log("🐦 Trying general events search...");
      try {
        const eventsUrl = `${GAMMA_API_URL}/events?limit=100&active=true&closed=false`;
        const eventsRes = await fetch(eventsUrl);
        const allEvents = await eventsRes.json();
        
        const elonEvents = allEvents.filter((e: any) => {
          const title = (e.title || '').toLowerCase();
          const slug = (e.slug || '').toLowerCase();
          return (title.includes('elon') && (title.includes('tweet') || title.includes('#'))) || 
                 (slug.includes('elon') && slug.includes('tweet'));
        });
        
        console.log(`🐦 Found ${elonEvents.length} Elon events in general search`);
        
        for (const event of elonEvents) {
          try {
            const eventDetailUrl = `${GAMMA_API_URL}/events?slug=${event.slug}`;
            const detailRes = await fetch(eventDetailUrl);
            const detailData = await detailRes.json();
            
            if (detailData && detailData[0] && detailData[0].markets) {
              console.log(`🐦 Event: "${event.title}" (${detailData[0].markets.length} markets)`);
              
              for (const m of detailData[0].markets) {
                allBucketMarkets.push({
                  ...m,
                  eventTitle: event.title,
                  eventSlug: event.slug
                });
              }
            }
          } catch (e) {}
        }
      } catch (e) {}
    }
    
    console.log(`🐦 Total: ${allBucketMarkets.length} Elon tweet bucket markets`);
    
    if (allBucketMarkets.length > 0) {
      allBucketMarkets.slice(0, 3).forEach((m: any) => {
        console.log(`🐦 Bucket: "${m.question?.slice(0, 60)}..."`);
      });
    } else {
      console.log("🐦 ⚠️ No Elon tweet markets found - check Polymarket for active events");
    }
    
    return allBucketMarkets;
  } catch (e: any) {
    console.error("🐦 Failed to fetch Elon markets:", e.message);
    return [];
  }
}

// Auto-buy Elon markets using ElizaBAO prediction (handles ALL date ranges - current and future)
async function autoTradeElonMarket(): Promise<boolean> {
  try {
    const openElonPos = getOpenElonPositions();
    if (openElonPos >= MAX_ELON_POSITIONS) {
      console.log(`🐦 Max Elon positions reached (${openElonPos}/${MAX_ELON_POSITIONS})`);
      return false;
    }
    
    // Get all Elon tweet markets from Polymarket FIRST
    const allMarkets = await getAllElonTweetMarkets();
    console.log(`🐦 Found ${allMarkets.length} Elon tweet markets on Polymarket`);
    
    if (allMarkets.length === 0) {
      console.log("🐦 No Elon tweet markets found");
      return false;
    }
    
    const bucketRegex = /(\d+)-(\d+)\s*tweets?/i;
    
    // For EACH Polymarket event, calculate prediction and find matching bucket
    // Group markets by event
    const eventGroups: {[key: string]: any[]} = {};
    for (const m of allMarkets) {
      const eventSlug = m.eventSlug || 'unknown';
      if (!eventGroups[eventSlug]) eventGroups[eventSlug] = [];
      eventGroups[eventSlug].push(m);
    }
    
    for (const [eventSlug, markets] of Object.entries(eventGroups)) {
      const firstMarket = markets[0];
      const eventTitle = firstMarket.eventTitle || firstMarket.question || '';
      
      console.log(`\n🐦 === ${eventTitle} ===`);
      
      // Extract date range from market question to calculate prediction
      const marketDates = extractDateRange(firstMarket.question || '');
      if (!marketDates) {
        console.log(`🐦 Could not extract dates from: ${firstMarket.question}`);
        continue;
      }
      
      // Build start/end dates from market question
      const months: {[key: string]: number} = {
        'january': 0, 'february': 1, 'march': 2, 'april': 3, 'may': 4, 'june': 5,
        'july': 6, 'august': 7, 'september': 8, 'october': 9, 'november': 10, 'december': 11
      };
      
      const year = 2026; // Adjust as needed
      const startDate = new Date(year, months[marketDates.startMonth], marketDates.startDay, 12, 0, 0);
      const endDate = new Date(year, months[marketDates.endMonth], marketDates.endDay, 12, 0, 0);
      
      // If endDate is before startDate, it's next year
      if (endDate < startDate) {
        endDate.setFullYear(year + 1);
      }
      
      console.log(`🐦 Market dates: ${startDate.toDateString()} → ${endDate.toDateString()}`);
      
      // Calculate elapsed time and prediction
      const now = Date.now();
      const elapsedHours = Math.max(0, (now - startDate.getTime()) / (1000 * 60 * 60));
      const totalHours = (endDate.getTime() - startDate.getTime()) / (1000 * 60 * 60);
      
      // IMPORTANT: If market hasn't started yet, use 0 as current count (FUTURE MARKET)
      let currentCount = 0;
      const marketHasStarted = now > startDate.getTime();
      
      if (!marketHasStarted) {
        console.log(`🐦 FUTURE MARKET: hasn't started yet, using currentCount = 0`);
        currentCount = 0;
      } else {
        // Market has started - try to get current tweet count from XTracker
        try {
          const trackings = await getAllElonTrackings();
          // Find tracking that matches THIS market's date range
          for (const t of trackings) {
            // Check if tracking matches market dates closely
            const trackingStart = t.startDate.getTime();
            const trackingEnd = t.endDate.getTime();
            const marketStart = startDate.getTime();
            const marketEnd = endDate.getTime();
            
            // Match if tracking period is close to market period (within 3 days)
            const startDiff = Math.abs(trackingStart - marketStart) / (1000 * 60 * 60 * 24);
            const endDiff = Math.abs(trackingEnd - marketEnd) / (1000 * 60 * 60 * 24);
            
            if (startDiff < 3 && endDiff < 3) {
              currentCount = t.count;
              console.log(`🐦 Using XTracker count: ${currentCount} tweets from "${t.title}"`);
              break;
            }
          }
        } catch (e) {
          console.log(`🐦 Could not fetch XTracker count, using 0`);
        }
      }
      
      const prediction = predictElonTweets(currentCount, elapsedHours, totalHours);
      console.log(`🐦 ElizaBAO Prediction: ${prediction.predicted} tweets (${currentCount} current + remaining)`);
      console.log(`🐦 Elapsed: ${elapsedHours.toFixed(1)}h / ${totalHours.toFixed(0)}h`);
      
      // Find matching bucket for this prediction
      for (const market of markets) {
        const bucketMatch = market.question?.match(bucketRegex);
        if (!bucketMatch) continue;
        
        const lowerRange = parseInt(bucketMatch[1]);
        const upperRange = parseInt(bucketMatch[2]);
        
        // Skip if already traded this market
        if (tradedMarkets.has(market.id)) {
          continue;
        }
        
        // Check if prediction falls in this bucket OR is within 20 tweets (nearby bucket)
        const isExactMatch = prediction.predicted >= lowerRange && prediction.predicted <= upperRange;
        const isNearbyMatch = Math.abs(prediction.predicted - lowerRange) <= 20 || Math.abs(prediction.predicted - upperRange) <= 20;
        
        if (isExactMatch || isNearbyMatch) {
          const matchType = isExactMatch ? "EXACT" : "NEARBY";
          console.log(`🐦 ✅ ${matchType} MATCH! Prediction ${prediction.predicted} → Bucket ${lowerRange}-${upperRange}`);
          
          // Get market price
          let yesPrice = 0.5;
          try { yesPrice = parseFloat(JSON.parse(market.outcomePrices)[0]); } catch {}
          
          // Skip very low liquidity (allow lower for restricted markets)
          const liquidity = market.liquidityNum || market.liquidity || 0;
          if (liquidity < 20) {
            console.log(`🐦 Bucket ${lowerRange}-${upperRange}: liquidity too low (${liquidity})`);
            continue;
          }
          
          // ============================================================
          // EDGE CALCULATION: Calculate probability and compare to market
          // ============================================================
          // Calculate standard deviation from historical data
          const rates = ELON_HISTORICAL_DATA.historicalPeriods.map(p => p.rate);
          const avgRate = rates.reduce((a, b) => a + b, 0) / rates.length;
          const variance = rates.reduce((sum, r) => sum + Math.pow(r - avgRate, 2), 0) / rates.length;
          const stdDev = Math.sqrt(variance) * totalHours;
          
          // Calculate probability this bucket wins
          const bucketProbability = calculateBucketProbability(lowerRange, upperRange, prediction.predicted, stdDev);
          const edge = bucketProbability - yesPrice;
          
          // Determine edge level
          let edgeLevel = "LOW";
          if (edge >= ELON_HIGH_EDGE) edgeLevel = "HIGH";
          else if (edge >= ELON_MEDIUM_EDGE) edgeLevel = "MEDIUM";
          else if (edge >= ELON_MIN_EDGE) edgeLevel = "LOW";
          
          console.log(`🐦 Market price: ${(yesPrice*100).toFixed(1)}%`);
          console.log(`🐦 Our probability: ${(bucketProbability*100).toFixed(1)}%`);
          console.log(`🐦 Edge: ${(edge*100).toFixed(1)}% [${edgeLevel}]`);
          
          // Skip if edge is below minimum threshold
          if (ELON_EDGE_ENABLED && edge < ELON_MIN_EDGE) {
            console.log(`🐦 ⚠️ SKIP: Edge ${(edge*100).toFixed(1)}% < ${(ELON_MIN_EDGE*100).toFixed(0)}% minimum`);
            continue;
          }
          
          console.log(`🐦 🎯 BUYING bucket ${lowerRange}-${upperRange} for $${ELON_TRADE_SIZE}! [${edgeLevel} EDGE]`);
          
          let tokenIds = market.clobTokenIds;
          try { if (typeof tokenIds === 'string') tokenIds = JSON.parse(tokenIds); } catch {}
          
          const marketToBuy = {
            ...market,
            yesPrice,
            clobTokenIds: tokenIds,
            category: 'elon'
          };
          
          const pos = await executeBuy(marketToBuy, ELON_TRADE_SIZE);
          if (pos) {
            console.log(`🐦 ✅ BOUGHT! ${eventTitle}`);
            console.log(`🐦 Prediction: ${prediction.predicted} → Bucket: ${lowerRange}-${upperRange}`);
            console.log(`🐦 Edge: ${(edge*100).toFixed(1)}% [${edgeLevel}] | Prob: ${(bucketProbability*100).toFixed(1)}% vs Price: ${(yesPrice*100).toFixed(1)}%`);
            return true;
          }
        }
      }
      
      console.log(`🐦 No matching bucket for prediction ${prediction.predicted} in this event`);
    }
    
    console.log(`🐦 No matching bucket found for any prediction`);
    return false;
  } catch (e: any) {
    console.error("🐦 Auto-trade Elon error:", e.message);
    return false;
  }
}

// ============================================================
// MARKET SCANNING (Multiple Categories)
// ============================================================
async function scanMarkets() {
  const markets = await fetchMarkets(100);
  const opps: any[] = [];
  
  const cryptoMarkets = await searchMarkets("bitcoin", 20);
  const elonMarkets = await searchMarkets("elon", 20);
  const tweetMarkets = await searchMarkets("tweet", 20);
  
  const allMarkets = [...markets, ...cryptoMarkets, ...elonMarkets, ...tweetMarkets];
  const seen = new Set<string>();
  
  for (const m of allMarkets) {
    if (seen.has(m.id)) continue;
    seen.add(m.id);
    
    let yesPrice = 0.5;
    try { yesPrice = parseFloat(JSON.parse(m.outcomePrices)[0]); } catch {}
    if (m.liquidityNum < 100 || yesPrice < 0.05 || yesPrice > 0.95) continue;
    
    // Skip if already traded this market
    if (tradedMarkets.has(m.id)) continue;
    
    const score = (1 - Math.abs(yesPrice - 0.5) * 2) * 0.5 + Math.min(1, m.volume24hr / 500000) * 0.5;
    let tokenIds = m.clobTokenIds;
    try { if (typeof tokenIds === 'string') tokenIds = JSON.parse(tokenIds); } catch {}
    
    let category = 'other';
    const q = (m.question || '').toLowerCase();
    if (q.includes('bitcoin') || q.includes('crypto') || q.includes('ethereum')) category = 'crypto';
    else if (q.includes('elon') || q.includes('musk') || q.includes('tweet')) category = 'elon';
    else if (q.includes('trump') || q.includes('biden') || q.includes('election')) category = 'politics';
    else if (q.includes('nba') || q.includes('nfl') || q.includes('soccer')) category = 'sports';
    
    opps.push({
      id: m.id,
      question: m.question,
      slug: m.slug,
      yesPrice,
      volume24h: m.volume24hr || 0,
      liquidity: m.liquidityNum || 0,
      score,
      clobTokenIds: tokenIds,
      category
    });
  }
  
  opps.sort((a, b) => b.score - a.score);
  return opps.slice(0, 15);
}

// ============================================================
// LIQUIDITY REWARDS BOT - Earn by providing two-sided quotes
// ============================================================
async function fetchRewardMarkets(): Promise<any[]> {
  try {
    // Fetch markets with active liquidity rewards
    const url = `${GAMMA_API_URL}/markets?limit=50&active=true&closed=false&order=volume24hr&ascending=false`;
    const res = await fetch(url);
    const markets = await res.json();
    
    // Filter for markets likely to have rewards (high liquidity, active)
    return markets.filter((m: any) => {
      const liquidity = m.liquidityNum || 0;
      const volume = m.volume24hr || 0;
      return liquidity > 5000 && volume > 10000;
    }).slice(0, 10);
  } catch (e) {
    console.log("⚠️ Could not fetch reward markets");
    return [];
  }
}

async function placeLiquidityOrders(market: any): Promise<LiquidityOrder | null> {
  if (!LIQUIDITY_MINING_ENABLED || !autoTradeEnabled) return null;
  
  try {
    const client = await initClobClient();
    if (!client) return null;
    
    let tokenIds = market.clobTokenIds;
    if (typeof tokenIds === 'string') try { tokenIds = JSON.parse(tokenIds); } catch {}
    const tokenId = Array.isArray(tokenIds) ? tokenIds[0] : null;
    if (!tokenId) return null;
    
    let yesPrice = 0.5;
    try { yesPrice = parseFloat(JSON.parse(market.outcomePrices)[0]); } catch {}
    
    // Calculate two-sided quotes around midpoint
    const midPrice = yesPrice;
    const buyPrice = Math.max(0.01, Math.round((midPrice - LIQUIDITY_SPREAD) * 100) / 100);
    const sellPrice = Math.min(0.99, Math.round((midPrice + LIQUIDITY_SPREAD) * 100) / 100);
    
    // Skip if spread is too tight or too wide
    if (sellPrice - buyPrice < 0.02 || sellPrice - buyPrice > 0.10) {
      console.log(`💧 Skip ${market.question?.slice(0, 30)}... - spread not optimal`);
      return null;
    }
    
    const shares = LIQUIDITY_MIN_SHARES;
    const costPerSide = shares * midPrice;
    
    if (costPerSide * 2 > LIQUIDITY_BUDGET) {
      console.log(`💧 Skip - cost $${(costPerSide * 2).toFixed(2)} exceeds budget`);
      return null;
    }
    
    console.log(`💧 LIQUIDITY: "${market.question?.slice(0, 40)}..."`);
    console.log(`💧 Midpoint: ${(midPrice*100).toFixed(1)}% | BUY @${buyPrice} | SELL @${sellPrice}`);
    console.log(`💧 Shares: ${shares} per side | Cost: ~$${(costPerSide * 2).toFixed(2)}`);
    
    // Place BUY limit order
    const buyOrder = await client.createOrder({ tokenID: tokenId, price: buyPrice, size: shares, side: "BUY" });
    // FIXED: postOrder(order, orderType, deferExec, postOnly) - postOnly is 4th param!
    const buyResult = await client.postOrder(buyOrder, OrderType.GTC, false, true); // deferExec=false, postOnly=true
    
    if (buyResult.error) {
      console.log(`💧 BUY order failed:`, buyResult.error);
      return null;
    }
    
    console.log(`💧 ✅ BUY limit placed @ ${buyPrice}`);
    
    // Place SELL limit order (using USDC collateral, not shares)
    // For liquidity mining, we place both sides to earn rewards
    const sellOrder = await client.createOrder({ tokenID: tokenId, price: sellPrice, size: shares, side: "SELL" });
    // FIXED: postOnly is 4th param, not 3rd!
    const sellResult = await client.postOrder(sellOrder, OrderType.GTC, false, true); // deferExec=false, postOnly=true
    
    let sellOrderId = "";
    if (!sellResult.error) {
      sellOrderId = sellResult.orderID || "";
      console.log(`💧 ✅ SELL limit placed @ ${sellPrice}`);
    } else {
      console.log(`💧 ⚠️ SELL order failed (may need shares first):`, sellResult.error);
    }
    
    const liquidityOrder: LiquidityOrder = {
      marketId: market.id,
      question: market.question,
      buyOrderId: buyResult.orderID || "",
      sellOrderId,
      buyPrice,
      sellPrice,
      shares,
      placedAt: new Date().toISOString(),
      midPrice
    };
    
    liquidityOrders.push(liquidityOrder);
    console.log(`💧 Liquidity order saved | Total: ${liquidityOrders.length}`);
    
    return liquidityOrder;
  } catch (e: any) {
    console.log(`💧 Liquidity order error:`, e.message);
    return null;
  }
}

async function rebalanceLiquidityOrders() {
  if (!LIQUIDITY_MINING_ENABLED || liquidityOrders.length === 0) return;
  
  console.log(`\n💧 === REBALANCING ${liquidityOrders.length} LIQUIDITY ORDERS ===`);
  
  const client = await initClobClient();
  if (!client) return;
  
  for (const order of liquidityOrders) {
    try {
      // Get current price
      const currentPrice = await getMarketPrice(order.marketId);
      if (!currentPrice) continue;
      
      const priceDrift = Math.abs(currentPrice - order.midPrice) / order.midPrice;
      
      if (priceDrift > LIQUIDITY_REBALANCE_THRESHOLD) {
        console.log(`💧 ${order.question?.slice(0, 30)}... drifted ${(priceDrift * 100).toFixed(1)}% - rebalancing`);
        
        // Cancel old orders
        try {
          if (order.buyOrderId) await client.cancelOrder({ orderID: order.buyOrderId });
          if (order.sellOrderId) await client.cancelOrder({ orderID: order.sellOrderId });
        } catch (e) {}
        
        // Remove from tracking
        liquidityOrders = liquidityOrders.filter(o => o.marketId !== order.marketId);
        
        // Note: Could re-place orders here, but for now just clean up
        console.log(`💧 Cancelled stale orders for ${order.question?.slice(0, 30)}...`);
      }
    } catch (e: any) {
      console.log(`💧 Rebalance error:`, e.message);
    }
  }
}

// ============================================================
// HOLDING REWARDS BOT - Earn 4% APY on eligible markets
// ============================================================
async function fetchHoldingRewardMarkets(): Promise<any[]> {
  try {
    const eligibleMarkets: any[] = [];
    
    for (const slug of HOLDING_ELIGIBLE_SLUGS) {
      try {
        const url = `${GAMMA_API_URL}/events?slug=${slug}`;
        const res = await fetch(url);
        const data = await res.json();
        
        if (data && data[0] && data[0].markets) {
          for (const m of data[0].markets) {
            eligibleMarkets.push({
              ...m,
              eventSlug: slug,
              eventTitle: data[0].title
            });
          }
        }
      } catch (e) {}
    }
    
    console.log(`📈 Found ${eligibleMarkets.length} holding reward eligible markets`);
    return eligibleMarkets;
  } catch (e) {
    return [];
  }
}

async function buyHoldingRewardPosition(market: any): Promise<HoldingPosition | null> {
  if (!HOLDING_REWARDS_ENABLED || !autoTradeEnabled) return null;
  
  // Check if we already hold this
  if (holdingPositions.find(p => p.marketId === market.id)) {
    return null;
  }
  
  try {
    const client = await initClobClient();
    if (!client) return null;
    
    let tokenIds = market.clobTokenIds;
    if (typeof tokenIds === 'string') try { tokenIds = JSON.parse(tokenIds); } catch {}
    const tokenId = Array.isArray(tokenIds) ? tokenIds[0] : null;
    if (!tokenId) return null;
    
    let yesPrice = 0.5;
    try { yesPrice = parseFloat(JSON.parse(market.outcomePrices)[0]); } catch {}
    
    // Allocate budget evenly across eligible markets
    const budgetPerMarket = HOLDING_BUDGET / Math.min(5, HOLDING_ELIGIBLE_SLUGS.length);
    const shares = Math.floor(budgetPerMarket / yesPrice);
    
    if (shares < 5) {
      console.log(`📈 Skip ${market.question?.slice(0, 30)}... - too few shares`);
      return null;
    }
    
    console.log(`📈 HOLDING: "${market.question?.slice(0, 50)}..."`);
    console.log(`📈 Price: ${(yesPrice*100).toFixed(1)}% | Shares: ${shares} | Cost: $${(shares * yesPrice).toFixed(2)}`);
    
    const buyPrice = Math.min(0.99, yesPrice + 0.02);
    const order = await client.createOrder({ tokenID: tokenId, price: buyPrice, size: shares, side: "BUY" });
    const result = await client.postOrder(order, OrderType.GTC);
    
    if (result.error) {
      console.log(`📈 BUY failed:`, result.error);
      return null;
    }
    
    const positionValue = shares * yesPrice;
    const dailyReward = positionValue * 0.04 / 365; // 4% APY
    
    const holdingPos: HoldingPosition = {
      marketId: market.id,
      question: market.question,
      slug: market.slug || "",
      shares,
      entryPrice: yesPrice,
      currentValue: positionValue,
      estimatedDailyReward: dailyReward,
      acquiredAt: new Date().toISOString()
    };
    
    holdingPositions.push(holdingPos);
    console.log(`📈 ✅ Bought for holding rewards | Daily: ~$${dailyReward.toFixed(4)}`);
    
    return holdingPos;
  } catch (e: any) {
    console.log(`📈 Holding buy error:`, e.message);
    return null;
  }
}

async function runHoldingRewardsStrategy() {
  if (!HOLDING_REWARDS_ENABLED) return;
  
  console.log(`\n📈 === HOLDING REWARDS STRATEGY ===`);
  console.log(`📈 Current positions: ${holdingPositions.length}`);
  
  if (holdingPositions.length >= 3) {
    console.log(`📈 Already have ${holdingPositions.length} holding positions`);
    return;
  }
  
  const eligibleMarkets = await fetchHoldingRewardMarkets();
  
  for (const market of eligibleMarkets.slice(0, 3)) {
    if (holdingPositions.length >= 3) break;
    await buyHoldingRewardPosition(market);
  }
  
  // Calculate total estimated daily reward
  const totalDaily = holdingPositions.reduce((sum, p) => sum + p.estimatedDailyReward, 0);
  console.log(`📈 Total holding positions: ${holdingPositions.length} | Est. daily: $${totalDaily.toFixed(4)}`);
}

async function runLiquidityMiningStrategy() {
  if (!LIQUIDITY_MINING_ENABLED) return;
  
  console.log(`\n💧 === LIQUIDITY MINING STRATEGY ===`);
  console.log(`💧 Current orders: ${liquidityOrders.length}`);
  
  // Rebalance existing orders first
  await rebalanceLiquidityOrders();
  
  // Add new liquidity if we have capacity
  if (liquidityOrders.length >= 3) {
    console.log(`💧 Already have ${liquidityOrders.length} liquidity positions`);
    return;
  }
  
  const rewardMarkets = await fetchRewardMarkets();
  console.log(`💧 Found ${rewardMarkets.length} potential reward markets`);
  
  for (const market of rewardMarkets.slice(0, 3)) {
    if (liquidityOrders.length >= 3) break;
    
    // Skip if already have liquidity in this market
    if (liquidityOrders.find(o => o.marketId === market.id)) continue;
    
    await placeLiquidityOrders(market);
  }
}

// ============================================================
// AI ANALYSIS
// ============================================================
async function callClaude(prompt: string): Promise<string> {
  if (!ANTHROPIC_KEY) throw new Error("ANTHROPIC_API_KEY not configured");
  const response = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: { "Content-Type": "application/json", "x-api-key": ANTHROPIC_KEY, "anthropic-version": "2023-06-01" },
    body: JSON.stringify({ model: "claude-sonnet-4-20250514", max_tokens: 500, messages: [{ role: "user", content: prompt }] }),
  });
  if (!response.ok) throw new Error(`Claude error: ${response.status}`);
  const data = await response.json();
  return data.content?.[0]?.text || "";
}

async function analyzeWithAI(opps: any[], elonPrediction: any) {
  if (!opps.length) return { shouldTrade: false, action: "HOLD", market: null, reasoning: "No opportunities", confidence: 0 };
  
  const openPos = positions.filter(p => p.status === "open");
  const openElonPos = getOpenElonPositions();
  
  const byCategory: {[key: string]: any[]} = {};
  opps.forEach(o => {
    if (!byCategory[o.category]) byCategory[o.category] = [];
    byCategory[o.category].push(o);
  });
  
  const diverseOpps: any[] = [];
  ['elon', 'crypto', 'politics', 'sports', 'other'].forEach(cat => {
    if (byCategory[cat]) diverseOpps.push(...byCategory[cat].slice(0, 2));
  });
  
  const summary = diverseOpps.slice(0, 7).map((o, i) => 
    `${i + 1}. [${o.category.toUpperCase()}] "${o.question}" - ${(o.yesPrice * 100).toFixed(1)}%`
  ).join("\n");
  
  let elonInfo = "";
  if (elonPrediction) {
    elonInfo = `\nELON TWEET PREDICTION: Current ${elonPrediction.currentCount} tweets, Predicted ${elonPrediction.predicted} (${elonPrediction.lowerBound}-${elonPrediction.upperBound})`;
    elonInfo += `\nElon positions: ${openElonPos}/${MAX_ELON_POSITIONS} (max)`;
  }
  
  const prompt = `You are Poly, AI trader for Polymarket.
Stats: ${totalScans} scans | ${totalTrades} trades | PnL: $${totalPnl.toFixed(2)}
Open: ${openPos.length}/${MAX_POSITIONS} total | Elon: ${openElonPos}/${MAX_ELON_POSITIONS}
Already traded: ${Array.from(tradedMarkets).slice(-5).join(', ')}
${elonInfo}

OPPORTUNITIES (diverse categories):
${summary}

Trade sizes: Elon=$${ELON_TRADE_SIZE}, Others=$${REGULAR_TRADE_SIZE}

Rules:
- NEVER buy same market twice (check "Already traded")
- Elon tweets max ${MAX_ELON_POSITIONS} positions
- For Elon tweet markets, use the prediction data above
- Prefer markets with edge

Respond:
ACTION: [BUY/HOLD]
MARKET: [1-7 or NONE]
CONFIDENCE: [0-100]
REASONING: [brief]`;

  try {
    const resp = await callClaude(prompt);
    const action = resp.match(/ACTION:\s*(BUY|HOLD)/i)?.[1]?.toUpperCase() || "HOLD";
    const marketIdx = resp.match(/MARKET:\s*(\d|NONE)/i)?.[1] === "NONE" ? -1 : parseInt(resp.match(/MARKET:\s*(\d)/)?.[1] || "0") - 1;
    const confidence = parseInt(resp.match(/CONFIDENCE:\s*(\d+)/)?.[1] || "50");
    const reasoning = resp.match(/REASONING:\s*(.+)/is)?.[1]?.trim().slice(0, 300) || "";
    const market = action === "BUY" && marketIdx >= 0 ? diverseOpps[marketIdx] : null;
    
    // Check if already traded
    if (market && tradedMarkets.has(market.id)) {
      return { shouldTrade: false, action: "HOLD", market: null, reasoning: "Already traded this market", confidence: 0 };
    }
    
    // Check max positions
    if (action === "BUY" && openPos.length >= MAX_POSITIONS) {
      return { shouldTrade: false, action: "HOLD", market: null, reasoning: "Max total positions reached", confidence: 0 };
    }
    
    // Check max Elon positions
    if (action === "BUY" && market?.category === "elon" && openElonPos >= MAX_ELON_POSITIONS) {
      return { shouldTrade: false, action: "HOLD", market: null, reasoning: `Max Elon positions (${MAX_ELON_POSITIONS}) reached`, confidence: 0 };
    }
    
    return { shouldTrade: action === "BUY" && market, action, market, reasoning, confidence };
  } catch (e) {
    return { shouldTrade: false, action: "HOLD", market: null, reasoning: String(e), confidence: 0 };
  }
}

// ============================================================
// TRADE EXECUTION WITH AUTO TP LIMIT ORDER
// ============================================================
async function executeBuy(market: any, amount: number): Promise<Position | null> {
  if (!autoTradeEnabled) {
    console.log(`⚠️ Would BUY $${amount} on "${market.question}"`);
    return null;
  }
  
  // CRITICAL: Double-check we haven't already traded this market
  if (tradedMarkets.has(market.id)) {
    console.log(`⚠️ SKIP: Already traded market ${market.id} - "${market.question?.slice(0, 40)}..."`);
    return null;
  }
  
  // PRICE FILTER: Don't buy extreme prices (no room for profit)
  // Above 85% = max TP is 99%, only 14% upside
  // Below 10% = likely to lose
  const price = market.yesPrice || 0.5;
  if (price > 0.85) {
    console.log(`⚠️ SKIP: Price too high (${(price*100).toFixed(0)}%) - no room for +20% TP`);
    return null;
  }
  if (price < 0.08) {
    console.log(`⚠️ SKIP: Price too low (${(price*100).toFixed(0)}%) - high risk of loss`);
    return null;
  }
  
  try {
    const client = await initClobClient();
    if (!client) throw new Error("CLOB not initialized");
    
    let tokenIds = market.clobTokenIds;
    if (typeof tokenIds === 'string') try { tokenIds = JSON.parse(tokenIds); } catch {}
    const tokenId = Array.isArray(tokenIds) ? tokenIds[0] : null;
    if (!tokenId) throw new Error("No token ID");
    
    // Use higher price to ensure IMMEDIATE fill (market order behavior)
    const buyPrice = Math.min(0.99, Math.round((market.yesPrice + 0.05) * 100) / 100);
    
    // Calculate size based on requested amount
    // Polymarket requires MINIMUM 5 shares per order
    const MIN_SHARES = 5;
    const rawSize = amount / buyPrice;
    const size = Math.max(MIN_SHARES, Math.ceil(rawSize * 100) / 100);
    
    const isElon = market.category === "elon";
    console.log(`🔄 BUY: $${(size * buyPrice).toFixed(2)} (${size} shares) on "${market.question?.slice(0, 50)}..." @ ${buyPrice} [${isElon ? 'ELON $' + ELON_TRADE_SIZE : 'Regular $' + REGULAR_TRADE_SIZE}]`);
    
    const order = await client.createOrder({ tokenID: tokenId, price: buyPrice, size, side: "BUY" });
    const result = await client.postOrder(order, OrderType.GTC);
    
    if (result.success === false || result.error) {
      throw new Error(result.error || "Order failed");
    }
    
    console.log(`✅ BUY order placed:`, result);
    
    // Check if order was filled immediately or is still live
    const orderStatus = result.status || 'unknown';
    const orderId = result.orderID || '';
    let actualSize = size;
    let actualPrice = buyPrice;
    let orderFilled = false;
    
    if (orderStatus === 'matched' || orderStatus === 'filled') {
      orderFilled = true;
      actualSize = parseFloat(result.takingAmount || size);
      console.log(`✅ BUY FILLED immediately! ${actualSize} shares`);
    } else if (orderStatus === 'live') {
      console.log(`⏳ BUY order is LIVE (pending). Waiting for fill...`);
      
      // Poll for order status for up to 60 seconds
      for (let i = 0; i < 12; i++) {
        await new Promise(r => setTimeout(r, 5000));
        try {
          const orders = await client.getOpenOrders();
          const ourOrder = orders.find((o: any) => o.id === orderId || o.orderID === orderId);
          if (!ourOrder) {
            console.log(`✅ BUY order filled after ${(i+1)*5}s!`);
            orderFilled = true;
            break;
          } else {
            console.log(`⏳ Still waiting... (${(i+1)*5}s)`);
          }
        } catch (e) {
          console.log(`⚠️ Could not check order status`);
        }
      }
      if (!orderFilled) {
        console.log(`⚠️ BUY order still pending after 60s - will place TP anyway`);
        orderFilled = true;
      }
    } else {
      orderFilled = true;
    }
    
    // Calculate Take Profit price (+20% from ENTRY price)
    const tpPrice = Math.min(0.99, Math.round((actualPrice * (1 + takeProfitPercent / 100)) * 100) / 100);
    
    // ============================================================
    // CRITICAL: Wait 45 seconds for shares to be FULLY CREDITED
    // This is the key fix - Polymarket needs time to credit shares
    // ============================================================
    console.log(`⏳ Waiting 45s for shares to be credited to wallet...`);
    await new Promise(r => setTimeout(r, 45000));
    
    // After 45s wait, shares should be credited - proceed with TP order
    
    // Place Take Profit SELL limit order
    let tpOrderId = "";
    let tpPlaced = false;
    let tpVerified = false;
    
    // Round size to integer for SELL orders
    // Polymarket requires MINIMUM 5 shares per order (same as buy)
    const sellSize = Math.floor(actualSize);
    const MIN_SELL_SHARES = 5;
    
    if (sellSize < MIN_SELL_SHARES) {
      console.log(`⚠️ Cannot place TP order: size ${actualSize} rounds to ${sellSize} (Polymarket minimum: ${MIN_SELL_SHARES})`);
    } else {
      // ============================================================
      // CHECK TOKEN BALANCE before placing SELL order
      // ============================================================
      console.log(`🔍 Checking token balance before TP order...`);
      try {
        const balanceUrl = `https://clob.polymarket.com/positions?user=${PROXY_WALLET}`;
        const balanceRes = await fetch(balanceUrl);
        const balanceText = await balanceRes.text();
        console.log(`🔍 Positions API (${balanceRes.status}): ${balanceText.slice(0, 800)}`);
        
        if (balanceRes.ok && balanceText) {
          try {
            const positions = JSON.parse(balanceText);
            if (Array.isArray(positions)) {
              const ourPosition = positions.find((p: any) => p.asset === tokenId || p.token_id === tokenId);
              if (ourPosition) {
                console.log(`✅ Found position: ${JSON.stringify(ourPosition).slice(0, 300)}`);
                const balance = parseFloat(ourPosition.size || ourPosition.balance || ourPosition.amount || '0');
                console.log(`💰 Token balance: ${balance} shares (need ${sellSize} for TP)`);
                if (balance < sellSize) {
                  console.log(`⚠️ INSUFFICIENT BALANCE: Have ${balance}, need ${sellSize}`);
                }
              } else {
                console.log(`⚠️ Token ${tokenId.slice(0, 20)}... NOT found in positions!`);
                console.log(`⚠️ Available positions: ${positions.length}`);
              }
            }
          } catch (parseErr) {
            console.log(`⚠️ Could not parse positions response`);
          }
        }
      } catch (balErr: any) {
        console.log(`⚠️ Balance check error: ${balErr.message}`);
      }
      
      // Try up to 3 times with LONGER delays between attempts
      for (let attempt = 1; attempt <= 3; attempt++) {
        try {
          console.log(`📈 === TP SELL LIMIT ORDER (Attempt ${attempt}/3) ===`);
          console.log(`📈 Token ID: ${tokenId}`);
          console.log(`📈 Price: ${tpPrice} (entry ${actualPrice} + ${takeProfitPercent}%)`);
          console.log(`📈 Size: ${sellSize} shares`);
          console.log(`📈 Side: SELL`);
          
          const tpOrder = await client.createOrder({ 
            tokenID: tokenId, 
            price: tpPrice, 
            size: sellSize, 
            side: "SELL" 
          });
          
          console.log(`📈 TP order signed:`, JSON.stringify(tpOrder).slice(0, 300));
          
          // ============================================================
          // FIXED: Use client.postOrder with correct parameter order!
          // postOrder(order, orderType, deferExec, postOnly)
          // postOnly is the 4TH parameter, not 3rd!
          // ============================================================
          console.log(`📈 Posting TP with postOnly=true via client library...`);
          
          // deferExec=false (execute immediately), postOnly=true (rest on book, don't match)
          const tpResult = await client.postOrder(tpOrder, OrderType.GTC, false, true);
          
          console.log(`📈 TP post result:`, JSON.stringify(tpResult));
          
          if (tpResult.success !== false && !tpResult.error && !tpResult.errorMsg) {
            tpOrderId = tpResult.orderID || tpResult.id || "";
            console.log(`✅ TP SELL order placed!`);
            console.log(`✅ Order ID: ${tpOrderId}`);
            console.log(`✅ Status: ${tpResult.status}`);
            tpPlaced = true;
            
            // CRITICAL: Wait 15 seconds before verification
            console.log(`⏳ Waiting 15s before verification...`);
            await new Promise(r => setTimeout(r, 15000));
            
            // ============================================================
            // DIRECT API CALL to verify (not client library)
            // ============================================================
            try {
              console.log(`🔍 Verifying via DIRECT API call...`);
              
              // Method 1: Check specific order by ID
              const orderCheckUrl = `https://clob.polymarket.com/order/${tpOrderId}`;
              console.log(`🔍 Checking: ${orderCheckUrl}`);
              
              const orderRes = await fetch(orderCheckUrl);
              const orderText = await orderRes.text();
              console.log(`🔍 Order API response (${orderRes.status}): ${orderText.slice(0, 500)}`);
              
              if (orderRes.ok && orderText && !orderText.includes('not found')) {
                try {
                  const orderData = JSON.parse(orderText);
                  if (orderData && (orderData.status === 'live' || orderData.status === 'open')) {
                    console.log(`✅ VERIFIED via API: Order is LIVE on CLOB!`);
                    tpVerified = true;
                    break;
                  } else {
                    console.log(`⚠️ Order status: ${orderData.status || 'unknown'}`);
                  }
                } catch (parseErr) {
                  console.log(`⚠️ Could not parse order response`);
                }
              }
              
              // Method 2: Check all orders for this maker
              const allOrdersUrl = `https://clob.polymarket.com/orders?maker=${PROXY_WALLET}`;
              console.log(`🔍 Checking all orders: ${allOrdersUrl}`);
              
              const allOrdersRes = await fetch(allOrdersUrl);
              const allOrdersText = await allOrdersRes.text();
              console.log(`🔍 All orders API response (${allOrdersRes.status}): ${allOrdersText.slice(0, 500)}`);
              
              if (allOrdersRes.ok && allOrdersText) {
                try {
                  const allOrders = JSON.parse(allOrdersText);
                  if (Array.isArray(allOrders) && allOrders.length > 0) {
                    console.log(`🔍 Found ${allOrders.length} orders via direct API`);
                    const found = allOrders.find((o: any) => o.id === tpOrderId || o.order_id === tpOrderId);
                    if (found) {
                      console.log(`✅ VERIFIED: Found our order in maker's orders!`);
                      tpVerified = true;
                      break;
                    }
                  } else {
                    console.log(`⚠️ No orders found for maker ${PROXY_WALLET}`);
                  }
                } catch (parseErr) {
                  console.log(`⚠️ Could not parse all orders response`);
                }
              }
              
              // Also try client library for comparison
              const openOrders = await client.getOpenOrders();
              console.log(`🔍 client.getOpenOrders() returned ${openOrders.length} orders`);
              
              if (!tpVerified && attempt < 3) {
                console.log(`⚠️ Order NOT found on CLOB - will retry`);
                console.log(`⏳ Waiting 30s before retry...`);
                await new Promise(r => setTimeout(r, 30000));
              }
            } catch (verifyErr: any) {
              console.log(`⚠️ Verification error:`, verifyErr.message);
            }
          } else {
            console.log(`⚠️ TP attempt ${attempt} rejected:`, tpResult.error || tpResult.errorMsg);
            if (attempt < 3) {
              console.log(`⏳ Waiting 20s before retry...`);
              await new Promise(r => setTimeout(r, 20000));
            }
          }
        } catch (tpErr: any) {
          console.log(`⚠️ TP attempt ${attempt} error:`, tpErr.message);
          if (attempt < 3) {
            console.log(`⏳ Waiting 20s before retry...`);
            await new Promise(r => setTimeout(r, 20000));
          }
        }
      }
    }
    
    if (!tpPlaced) {
      console.log(`❌ Failed to place TP order after 3 attempts`);
    } else if (!tpVerified) {
      console.log(`⚠️ TP order placed but NOT verified on CLOB - may have been cancelled`);
      console.log(`⚠️ Position will be monitored for manual TP at ${tpPrice}`);
    }
    
    const position: Position = {
      id: `pos_${Date.now()}`,
      marketId: market.id,
      question: market.question,
      slug: market.slug || "",
      side: "BUY",
      entryPrice: actualPrice,
      size: actualSize,
      amount: actualSize * actualPrice,
      tokenId,
      openedAt: new Date().toISOString(),
      status: "open",
      category: market.category,
      tpOrderId: tpVerified ? tpOrderId : "", // Only save if verified
      tpPrice
    };
    
    positions.push(position);
    tradedMarkets.add(market.id);
    totalTrades++;
    savePositions();
    
    console.log(`📈 Position: ${position.id} | Entry: ${actualPrice} | TP: ${tpPrice} | Size: ${actualSize} | TP Order: ${tpVerified ? 'VERIFIED ✅' : 'NOT VERIFIED ⚠️'}`);
    return position;
  } catch (e: any) {
    console.error(`❌ BUY failed:`, e.message);
    return null;
  }
}

async function executeSell(position: Position, currentPrice: number, reason: string): Promise<boolean> {
  if (!autoTradeEnabled) return false;
  
  try {
    const client = await initClobClient();
    if (!client) throw new Error("CLOB not initialized");
    
    if (position.size < 5) {
      console.log(`⚠️ Cannot sell ${position.id}: only ${position.size} shares (min 5)`);
      return false;
    }
    
    // Cancel existing TP order if exists
    if (position.tpOrderId) {
      try {
        await client.cancelOrder({ orderID: position.tpOrderId });
        console.log(`🗑️ Cancelled TP order: ${position.tpOrderId}`);
      } catch (e) {
        console.log(`⚠️ Could not cancel TP order`);
      }
    }
    
    console.log(`🔄 SELL: ${position.id} (${position.size} shares) @ ${currentPrice} (${reason})`);
    
    const order = await client.createOrder({ tokenID: position.tokenId, price: currentPrice - 0.01, size: position.size, side: "SELL" });
    const result = await client.postOrder(order, OrderType.GTC);
    
    if (result.success === false || result.error) throw new Error(result.error || "Order failed");
    
    position.status = "closed";
    position.closedAt = new Date().toISOString();
    position.exitPrice = currentPrice;
    position.pnl = (currentPrice - position.entryPrice) * position.size;
    position.closeReason = reason;
    totalPnl += position.pnl;
    savePositions();
    
    console.log(`📉 Closed: ${position.id} | PnL: $${position.pnl.toFixed(2)}`);
    return true;
  } catch (e: any) {
    console.error(`❌ SELL failed:`, e.message);
    return false;
  }
}

async function checkPositions() {
  for (const pos of positions.filter(p => p.status === "open")) {
    const price = await getMarketPrice(pos.marketId);
    if (!price) continue;
    const pnl = ((price - pos.entryPrice) / pos.entryPrice) * 100;
    const tpInfo = pos.tpOrderId ? ` [TP: ${pos.tpPrice} ✅]` : ` [TP: ${pos.tpPrice} (monitoring)]`;
    console.log(`📊 ${pos.id}: ${pos.entryPrice.toFixed(3)}→${price.toFixed(3)} (${pnl >= 0 ? '+' : ''}${pnl.toFixed(1)}%) [${pos.size} shares]${tpInfo}`);
    
    // Check stop loss
    if (pnl <= -stopLossPercent) {
      await executeSell(pos, price, `SL ${pnl.toFixed(1)}%`);
      continue;
    }
    
    // Check take profit
    if (pos.tpPrice && price >= pos.tpPrice) {
      if (pos.tpOrderId) {
        // TP limit order exists - assume it was filled
        pos.status = "closed";
        pos.closedAt = new Date().toISOString();
        pos.exitPrice = pos.tpPrice;
        pos.pnl = (pos.tpPrice - pos.entryPrice) * pos.size;
        pos.closeReason = `TP +${takeProfitPercent}% (limit order)`;
        totalPnl += pos.pnl;
        savePositions();
        console.log(`🎯 TP LIMIT FILLED: ${pos.id} | PnL: $${pos.pnl.toFixed(2)}`);
      } else {
        // NO TP limit order - bot must sell actively
        console.log(`🎯 TP PRICE HIT! Selling actively (no limit order)...`);
        const sold = await executeSell(pos, price, `TP +${pnl.toFixed(1)}% (active)`);
        if (sold) {
          console.log(`🎯 TP ACTIVE SELL: ${pos.id} | PnL: $${pos.pnl?.toFixed(2)}`);
        }
      }
    }
  }
}

// ============================================================
// AUTONOMY LOOP
// ============================================================
async function autonomyLoop() {
  if (autonomyRunning) return;
  autonomyRunning = true;
  console.log("🤖 Autonomy started!");
  
  while (autonomyEnabled) {
    try {
      console.log(`\n🔄 Scan #${totalScans + 1}...`);
      await checkPositions();
      totalScans++;
      
      const openCount = positions.filter(p => p.status === "open").length;
      const openElonCount = getOpenElonPositions();
      
      // STEP 1: Auto-trade Elon markets using CryptoMaid formula (NO Claude needed)
      if (openCount < MAX_POSITIONS && openElonCount < MAX_ELON_POSITIONS) {
        console.log(`\n🐦 === ELON AUTO-TRADE (ElizaBAO Prediction) ===`);
        const elonTraded = await autoTradeElonMarket();
        if (elonTraded) {
          console.log(`🐦 Elon trade executed automatically!`);
        }
      } else if (openElonCount >= MAX_ELON_POSITIONS) {
        console.log(`🐦 Elon positions maxed out (${openElonCount}/${MAX_ELON_POSITIONS})`);
      }
      
      // STEP 2: Use Claude AI for other markets (crypto, politics, sports)
      let elonPrediction = null;
      try {
        const elonData = await getElonTweetCount();
        if (elonData) {
          const elapsedHours = (Date.now() - elonData.startDate.getTime()) / (1000 * 60 * 60);
          const totalHours = (elonData.endDate.getTime() - elonData.startDate.getTime()) / (1000 * 60 * 60);
          const prediction = predictElonTweets(elonData.count, elapsedHours, totalHours);
          elonPrediction = { ...prediction, currentCount: elonData.count };
        }
      } catch (e) {}
      
      const updatedOpenCount = positions.filter(p => p.status === "open").length;
      if (updatedOpenCount < MAX_POSITIONS) {
        console.log(`\n🤖 === AI MARKET ANALYSIS ===`);
        const opps = await scanMarkets();
        
        // Filter out Elon markets - let auto-trade handle those
        const nonElonOpps = opps.filter((o: any) => o.category !== 'elon');
        
        const decision = await analyzeWithAI(nonElonOpps, elonPrediction);
        lastDecision = { ...decision, timestamp: new Date().toISOString(), elonPrediction };
        tradeHistory.push(lastDecision);
        if (tradeHistory.length > MAX_HISTORY) tradeHistory.shift();
        
        if (decision.shouldTrade && decision.confidence >= 70) {
          const tradeSize = REGULAR_TRADE_SIZE; // Non-Elon markets use $1
          const pos = await executeBuy(decision.market, tradeSize);
          console.log(`✅ BUY: "${decision.market?.question?.slice(0, 40)}..." | $${tradeSize} | ${decision.confidence}% | ${decision.market?.category}`);
        } else {
          console.log(`⏸️ HOLD - ${decision.reasoning?.slice(0, 60)}`);
        }
      }
      
      // STEP 3: v4.0 - LIQUIDITY MINING (earn rewards by providing quotes)
      if (LIQUIDITY_MINING_ENABLED && totalScans % 5 === 0) {
        // Run every 5 scans (~10 minutes)
        await runLiquidityMiningStrategy();
      }
      
      // STEP 4: v4.0 - HOLDING REWARDS (earn 4% APY on long-term markets)
      if (HOLDING_REWARDS_ENABLED && totalScans % 10 === 0) {
        // Run every 10 scans (~20 minutes)
        await runHoldingRewardsStrategy();
      }
      
      const finalOpenCount = positions.filter(p => p.status === "open").length;
      const finalElonCount = getOpenElonPositions();
      const dailyRewardEst = holdingPositions.reduce((sum, p) => sum + p.estimatedDailyReward, 0);
      
      console.log(`\n📊 ${totalScans} scans | ${totalTrades} trades | ${finalOpenCount} open (${finalElonCount} elon) | $${totalPnl.toFixed(2)}`);
      console.log(`💧 Liquidity orders: ${liquidityOrders.length} | 📈 Holding: ${holdingPositions.length} (~$${dailyRewardEst.toFixed(3)}/day)`);
    } catch (e) { console.error("Error:", e); }
    await new Promise(r => setTimeout(r, autonomyIntervalMs));
  }
  autonomyRunning = false;
}

// ============================================================
// API ROUTES
// ============================================================
const app = new Hono();
app.use("*", cors({ origin: "*" }));

app.get("/", (c) => c.json({
  status: "ok",
  version: "ElizaBAO v4.0 - Full Suite (Liquidity + Holding + Trading)",
  wallet: WALLET_ADDRESS,
  proxyWallet: PROXY_WALLET,
  autoTradeEnabled,
  stats: { 
    totalScans, 
    totalTrades, 
    totalPnl, 
    openPositions: positions.filter(p => p.status === "open").length,
    openElonPositions: getOpenElonPositions(),
    liquidityOrders: liquidityOrders.length,
    holdingPositions: holdingPositions.length,
    estimatedDailyRewards: holdingPositions.reduce((sum, p) => sum + p.estimatedDailyReward, 0).toFixed(4)
  }
}));

app.get("/api/status", (c) => c.json({
  success: true,
  data: {
    wallet: WALLET_ADDRESS,
    proxyWallet: PROXY_WALLET,
    autoTradeEnabled,
    totalScans,
    totalTrades,
    totalPnl,
    openPositions: positions.filter(p => p.status === "open").length,
    openElonPositions: getOpenElonPositions(),
    maxElonPositions: MAX_ELON_POSITIONS,
    tradedMarkets: tradedMarkets.size,
    elonTradeSize: ELON_TRADE_SIZE,
    regularTradeSize: REGULAR_TRADE_SIZE
  }
}));

app.get("/api/wallet", async (c) => {
  try {
    const provider = new ethers.providers.JsonRpcProvider("https://polygon.llamarpc.com");
    const pol = ethers.utils.formatEther(await provider.getBalance(WALLET_ADDRESS));
    const usdc = new ethers.Contract("0x3c499c542cEF5E3811e1192ce70d8cC03d5c3359", ["function balanceOf(address) view returns (uint256)"], provider);
    const usdcBal = ethers.utils.formatUnits(await usdc.balanceOf(WALLET_ADDRESS), 6);
    return c.json({ success: true, data: { address: WALLET_ADDRESS, proxyWallet: PROXY_WALLET, pol: { balance: pol }, usdc: { balance: usdcBal } } });
  } catch (e: any) {
    return c.json({ success: true, data: { address: WALLET_ADDRESS, proxyWallet: PROXY_WALLET, pol: { balance: "0" }, usdc: { balance: "0" }, error: e.message } });
  }
});

app.get("/api/elon-prediction", async (c) => {
  try {
    const elonData = await getElonTweetCount();
    if (!elonData) return c.json({ success: false, error: "Could not fetch Elon data" });
    
    const elapsedHours = (Date.now() - elonData.startDate.getTime()) / (1000 * 60 * 60);
    const totalHours = (elonData.endDate.getTime() - elonData.startDate.getTime()) / (1000 * 60 * 60);
    const prediction = predictElonTweets(elonData.count, elapsedHours, totalHours);
    
    return c.json({
      success: true,
      data: {
        currentCount: elonData.count,
        startDate: elonData.startDate,
        endDate: elonData.endDate,
        elapsedHours: Math.round(elapsedHours),
        remainingHours: Math.round(totalHours - elapsedHours),
        ...prediction,
        historicalPeriodsUsed: ELON_HISTORICAL_DATA.historicalPeriods.length
      }
    });
  } catch (e: any) {
    return c.json({ success: false, error: e.message });
  }
});

// Elon Edge Analysis - Shows all buckets with edge calculations
app.get("/api/elon-edge", async (c) => {
  try {
    const allMarkets = await getAllElonTweetMarkets();
    const bucketRegex = /(\d+)-(\d+)\s*tweets?/i;
    const results: any[] = [];
    
    // Group by event
    const eventGroups: {[key: string]: any[]} = {};
    for (const m of allMarkets) {
      const eventSlug = m.eventSlug || 'unknown';
      if (!eventGroups[eventSlug]) eventGroups[eventSlug] = [];
      eventGroups[eventSlug].push(m);
    }
    
    for (const [eventSlug, markets] of Object.entries(eventGroups)) {
      const firstMarket = markets[0];
      const marketDates = extractDateRange(firstMarket.question || '');
      if (!marketDates) continue;
      
      const months: {[key: string]: number} = {
        'january': 0, 'february': 1, 'march': 2, 'april': 3, 'may': 4, 'june': 5,
        'july': 6, 'august': 7, 'september': 8, 'october': 9, 'november': 10, 'december': 11
      };
      
      const year = 2026;
      const startDate = new Date(year, months[marketDates.startMonth], marketDates.startDay, 12, 0, 0);
      const endDate = new Date(year, months[marketDates.endMonth], marketDates.endDay, 12, 0, 0);
      if (endDate < startDate) endDate.setFullYear(year + 1);
      
      const now = Date.now();
      const elapsedHours = Math.max(0, (now - startDate.getTime()) / (1000 * 60 * 60));
      const totalHours = (endDate.getTime() - startDate.getTime()) / (1000 * 60 * 60);
      
      let currentCount = 0;
      if (now > startDate.getTime()) {
        try {
          const trackings = await getAllElonTrackings();
          for (const t of trackings) {
            const startDiff = Math.abs(t.startDate.getTime() - startDate.getTime()) / (1000 * 60 * 60 * 24);
            const endDiff = Math.abs(t.endDate.getTime() - endDate.getTime()) / (1000 * 60 * 60 * 24);
            if (startDiff < 3 && endDiff < 3) { currentCount = t.count; break; }
          }
        } catch {}
      }
      
      const prediction = predictElonTweets(currentCount, elapsedHours, totalHours);
      const rates = ELON_HISTORICAL_DATA.historicalPeriods.map(p => p.rate);
      const avgRate = rates.reduce((a, b) => a + b, 0) / rates.length;
      const variance = rates.reduce((sum, r) => sum + Math.pow(r - avgRate, 2), 0) / rates.length;
      const stdDev = Math.sqrt(variance) * totalHours;
      
      const eventResult = {
        event: firstMarket.eventTitle || eventSlug,
        prediction: prediction.predicted,
        currentCount,
        elapsedHours: Math.round(elapsedHours),
        totalHours: Math.round(totalHours),
        buckets: [] as any[]
      };
      
      for (const market of markets) {
        const bucketMatch = market.question?.match(bucketRegex);
        if (!bucketMatch) continue;
        
        const lowerRange = parseInt(bucketMatch[1]);
        const upperRange = parseInt(bucketMatch[2]);
        
        let yesPrice = 0.5;
        try { yesPrice = parseFloat(JSON.parse(market.outcomePrices)[0]); } catch {}
        
        const bucketProb = calculateBucketProbability(lowerRange, upperRange, prediction.predicted, stdDev);
        const edge = bucketProb - yesPrice;
        
        let edgeLevel = "LOW";
        if (edge >= ELON_HIGH_EDGE) edgeLevel = "HIGH";
        else if (edge >= ELON_MEDIUM_EDGE) edgeLevel = "MEDIUM";
        else if (edge >= ELON_MIN_EDGE) edgeLevel = "LOW";
        else edgeLevel = "NONE";
        
        const alreadyTraded = tradedMarkets.has(market.id);
        
        eventResult.buckets.push({
          range: `${lowerRange}-${upperRange}`,
          marketPrice: Math.round(yesPrice * 100) + "%",
          ourProbability: Math.round(bucketProb * 100) + "%",
          edge: Math.round(edge * 100) + "%",
          edgeLevel,
          shouldTrade: edge >= ELON_MIN_EDGE && !alreadyTraded,
          alreadyTraded,
          marketId: market.id
        });
      }
      
      // Sort by edge descending
      eventResult.buckets.sort((a, b) => parseFloat(b.edge) - parseFloat(a.edge));
      results.push(eventResult);
    }
    
    return c.json({
      success: true,
      data: {
        edgeConfig: { minEdge: ELON_MIN_EDGE * 100, mediumEdge: ELON_MEDIUM_EDGE * 100, highEdge: ELON_HIGH_EDGE * 100 },
        events: results
      }
    });
  } catch (e: any) {
    return c.json({ success: false, error: e.message });
  }
});

app.get("/api/positions", (c) => c.json({
  success: true,
  data: {
    open: positions.filter(p => p.status === "open"),
    closed: positions.filter(p => p.status === "closed").slice(-20),
    totalPnl,
    tradedMarkets: Array.from(tradedMarkets),
    openElonPositions: getOpenElonPositions()
  }
}));

app.post("/api/positions/settings", async (c) => {
  const { takeProfit, stopLoss } = await c.req.json();
  if (takeProfit) takeProfitPercent = takeProfit;
  if (stopLoss) stopLossPercent = stopLoss;
  console.log(`⚙️ Settings: TP=${takeProfitPercent}% SL=${stopLossPercent}%`);
  return c.json({ success: true, data: { takeProfitPercent, stopLossPercent } });
});

app.post("/api/autonomy/start", async (c) => { 
  autonomyEnabled = true; 
  autonomyLoop(); 
  return c.json({ success: true, data: { enabled: autonomyEnabled, autoTradeEnabled } }); 
});

app.post("/api/autonomy/stop", (c) => { 
  autonomyEnabled = false; 
  return c.json({ success: true }); 
});

app.get("/api/autonomy/status", (c) => c.json({
  success: true,
  data: { enabled: autonomyEnabled, running: autonomyRunning, autoTradeEnabled, totalScans, totalTrades, lastDecision }
}));

app.post("/api/trade/enable", (c) => { 
  autoTradeEnabled = true; 
  console.log("💰 Auto-trade ENABLED"); 
  return c.json({ success: true, data: { autoTradeEnabled: true } }); 
});

app.post("/api/trade/disable", (c) => { 
  autoTradeEnabled = false; 
  console.log("⏸️ Auto-trade DISABLED");
  return c.json({ success: true, data: { autoTradeEnabled: false } }); 
});

app.get("/api/history", (c) => c.json({
  success: true,
  data: { trades: tradeHistory.slice(-20), totalScans, totalTrades, totalPnl }
}));

app.post("/api/scan", async (c) => c.json({ success: true, data: { opportunities: await scanMarkets() } }));

app.post("/api/analyze", async (c) => { 
  const opps = await scanMarkets();
  let elonPrediction = null;
  try {
    const elonData = await getElonTweetCount();
    if (elonData) {
      const elapsedHours = (Date.now() - elonData.startDate.getTime()) / (1000 * 60 * 60);
      const totalHours = (elonData.endDate.getTime() - elonData.startDate.getTime()) / (1000 * 60 * 60);
      elonPrediction = { ...predictElonTweets(elonData.count, elapsedHours, totalHours), currentCount: elonData.count };
    }
  } catch {}
  return c.json({ success: true, data: { aiDecision: await analyzeWithAI(opps, elonPrediction), topOpportunities: opps.slice(0, 10), elonPrediction } }); 
});

app.post("/api/search", async (c) => { 
  const { query } = await c.req.json(); 
  const mkts = await searchMarkets(query, 20);
  return c.json({ success: true, data: { markets: mkts } }); 
});

app.post("/api/chat", async (c) => { 
  const { message } = await c.req.json(); 
  return c.json({ success: true, data: { reply: await callClaude(message) } }); 
});

// ============================================================
// v4.0 NEW API ENDPOINTS
// ============================================================

// Liquidity Mining Status
app.get("/api/liquidity", (c) => c.json({
  success: true,
  data: {
    enabled: LIQUIDITY_MINING_ENABLED,
    budget: LIQUIDITY_BUDGET,
    activeOrders: liquidityOrders.length,
    orders: liquidityOrders,
    totalRewardsEarned: totalLiquidityRewards,
    config: {
      minShares: LIQUIDITY_MIN_SHARES,
      spread: LIQUIDITY_SPREAD,
      rebalanceThreshold: LIQUIDITY_REBALANCE_THRESHOLD
    }
  }
}));

// Holding Rewards Status
app.get("/api/holding", (c) => {
  const totalValue = holdingPositions.reduce((sum, p) => sum + p.currentValue, 0);
  const dailyReward = holdingPositions.reduce((sum, p) => sum + p.estimatedDailyReward, 0);
  const yearlyReward = dailyReward * 365;
  
  return c.json({
    success: true,
    data: {
      enabled: HOLDING_REWARDS_ENABLED,
      budget: HOLDING_BUDGET,
      positions: holdingPositions,
      stats: {
        totalPositions: holdingPositions.length,
        totalValue: totalValue.toFixed(2),
        estimatedDailyReward: dailyReward.toFixed(4),
        estimatedYearlyReward: yearlyReward.toFixed(2),
        apy: "4%"
      },
      eligibleMarkets: HOLDING_ELIGIBLE_SLUGS
    }
  });
});

// Force run strategies manually
app.post("/api/liquidity/run", async (c) => {
  await runLiquidityMiningStrategy();
  return c.json({
    success: true,
    data: {
      message: "Liquidity mining strategy executed",
      activeOrders: liquidityOrders.length
    }
  });
});

app.post("/api/holding/run", async (c) => {
  await runHoldingRewardsStrategy();
  return c.json({
    success: true,
    data: {
      message: "Holding rewards strategy executed",
      positions: holdingPositions.length
    }
  });
});

// Strategy dashboard summary
app.get("/api/strategies", (c) => {
  const dailyReward = holdingPositions.reduce((sum, p) => sum + p.estimatedDailyReward, 0);
  
  return c.json({
    success: true,
    data: {
      activeTrading: {
        enabled: autoTradeEnabled,
        openPositions: positions.filter(p => p.status === "open").length,
        totalTrades,
        pnl: totalPnl.toFixed(2),
        regularTradeSize: REGULAR_TRADE_SIZE,
        elonTradeSize: ELON_TRADE_SIZE
      },
      liquidityMining: {
        enabled: LIQUIDITY_MINING_ENABLED,
        activeOrders: liquidityOrders.length,
        budget: LIQUIDITY_BUDGET,
        rewardsEarned: totalLiquidityRewards.toFixed(4)
      },
      holdingRewards: {
        enabled: HOLDING_REWARDS_ENABLED,
        positions: holdingPositions.length,
        budget: HOLDING_BUDGET,
        estimatedDaily: dailyReward.toFixed(4),
        apy: "4%"
      },
      summary: {
        totalStrategies: 3,
        totalBudget: LIQUIDITY_BUDGET + HOLDING_BUDGET + MAKER_REBATES_BUDGET,  // $50 TEST MODE
        estimatedDailyPassive: dailyReward.toFixed(4)
      }
    }
  });
});

// DEBUG: Check CLOB orders directly
app.get("/api/debug/orders", async (c) => {
  try {
    const results: any = { proxyWallet: PROXY_WALLET, checks: [] };
    
    // Check 1: All orders for maker
    try {
      const ordersUrl = `https://clob.polymarket.com/orders?maker=${PROXY_WALLET}`;
      const ordersRes = await fetch(ordersUrl);
      const ordersText = await ordersRes.text();
      results.checks.push({
        name: "CLOB Orders API",
        url: ordersUrl,
        status: ordersRes.status,
        response: ordersText.slice(0, 1000)
      });
    } catch (e: any) {
      results.checks.push({ name: "CLOB Orders API", error: e.message });
    }
    
    // Check 2: Positions for user
    try {
      const posUrl = `https://clob.polymarket.com/positions?user=${PROXY_WALLET}`;
      const posRes = await fetch(posUrl);
      const posText = await posRes.text();
      results.checks.push({
        name: "CLOB Positions API",
        url: posUrl,
        status: posRes.status,
        response: posText.slice(0, 1000)
      });
    } catch (e: any) {
      results.checks.push({ name: "CLOB Positions API", error: e.message });
    }
    
    // Check 3: Client library getOpenOrders
    try {
      const client = await initClobClient();
      if (client) {
        const openOrders = await client.getOpenOrders();
        results.checks.push({
          name: "client.getOpenOrders()",
          count: openOrders.length,
          orders: openOrders.slice(0, 5).map((o: any) => ({
            id: o.id || o.orderID,
            side: o.side,
            price: o.price,
            size: o.size
          }))
        });
      }
    } catch (e: any) {
      results.checks.push({ name: "client.getOpenOrders()", error: e.message });
    }
    
    // Check 4: Our saved positions with TP orders
    const positionsWithTP = positions.filter(p => p.status === "open" && p.tpOrderId);
    results.savedTPOrders = positionsWithTP.map(p => ({
      id: p.id,
      tpOrderId: p.tpOrderId,
      tpPrice: p.tpPrice,
      question: p.question?.slice(0, 50)
    }));
    
    return c.json({ success: true, data: results });
  } catch (e: any) {
    return c.json({ success: false, error: e.message });
  }
});

// ============================================================
// STARTUP
// ============================================================
loadPositions();
initClobClient();

console.log(`
╔════════════════════════════════════════════════════════════════════════╗
║  🤖 ElizaBAO POLYMARKET AGENT v4.0 - FULL SUITE                        ║
║  ⚡ Powered by ShawMakesMagic & ElizaOS                                ║
║  🧪 TEST MODE: $50 BUDGET (Scale to $100+ after validation)            ║
╠════════════════════════════════════════════════════════════════════════╣
║  STRATEGIES:                                                           ║
║  🐦 Elon Tweet: Bayesian AI Prediction                                 ║
║  💧 Liquidity Mining: ${LIQUIDITY_MINING_ENABLED ? 'ENABLED' : 'DISABLED'} ($${LIQUIDITY_BUDGET} budget)                               ║
║  📈 Holding Rewards: ${HOLDING_REWARDS_ENABLED ? 'ENABLED' : 'DISABLED'} ($${HOLDING_BUDGET} budget, 4% APY)                       ║
║  🎲 Maker Rebates: ${MAKER_REBATES_ENABLED ? 'ENABLED' : 'DISABLED'} ($${MAKER_REBATES_BUDGET} budget)                                ║
╠════════════════════════════════════════════════════════════════════════╣
║  WALLETS:                                                              ║
║  💰 Signer: ${WALLET_ADDRESS}                      ║
║  🏦 Proxy: ${PROXY_WALLET}                         ║
╠════════════════════════════════════════════════════════════════════════╣
║  CONFIG:                                                               ║
║  🎯 TP: +${takeProfitPercent}% | SL: -${stopLossPercent}% | Price Filter: 8-85%                           ║
║  📊 Max: ${MAX_POSITIONS} positions | ${MAX_ELON_POSITIONS} Elon | Scan: ${autonomyIntervalMs / 1000}s                              ║
║  💾 Loaded: ${positions.length} positions | Elon: ${getOpenElonPositions()}/${MAX_ELON_POSITIONS}                                 ║
╚════════════════════════════════════════════════════════════════════════╝
`);

serve({ fetch: app.fetch, port: Number(PORT), hostname: "0.0.0.0" });
console.log(`Server running on http://0.0.0.0:${PORT}`);
console.log("CLOB ready");
