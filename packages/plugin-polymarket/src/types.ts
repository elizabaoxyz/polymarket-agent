/**
 * ElizaBAO Polymarket Plugin Types
 * Compatible with ElizaOS v2.0.0
 */

export interface PolymarketConfig {
  privateKey: string;
  walletAddress: string;
  clobApiKey?: string;
  clobApiSecret?: string;
  clobApiPassphrase?: string;
  proxyWallet?: string;
  gammaApiUrl?: string;
  clobApiUrl?: string;
  xtrackerApiUrl?: string;
}

export interface Market {
  id: string;
  question: string;
  slug: string;
  description?: string;
  outcomes: string[];
  outcomePrices: number[];
  volume24hr?: number;
  liquidity?: number;
  endDate?: string;
  active: boolean;
  closed: boolean;
  tokens?: MarketToken[];
}

export interface MarketToken {
  token_id: string;
  outcome: string;
  price: number;
  winner?: boolean;
}

export interface OrderBookEntry {
  price: number;
  size: number;
}

export interface OrderBook {
  bids: OrderBookEntry[];
  asks: OrderBookEntry[];
  market: string;
  asset_id: string;
  timestamp: number;
}

export interface MarketOpportunity {
  market: Market;
  orderBook: OrderBook;
  spread: number;
  midpoint: number;
  score: number;
  category?: string;
  tokenId: string;
}

export interface Position {
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

export interface TradeDecision {
  shouldTrade: boolean;
  action: "BUY" | "SELL" | "HOLD";
  market: Market | null;
  tokenId?: string;
  price?: number;
  size?: number;
  reasoning: string;
  confidence: number;
}

export interface ElonPrediction {
  predicted: number;
  lowerBound: number;
  upperBound: number;
  confidence: number;
  currentCount: number;
  elapsedHours: number;
  remainingHours: number;
}

export interface PortfolioStats {
  totalPositions: number;
  openPositions: number;
  totalTrades: number;
  totalPnl: number;
  winRate: number;
  avgReturn: number;
}

export interface LiquidityOrder {
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

export interface HoldingPosition {
  marketId: string;
  question: string;
  slug: string;
  shares: number;
  entryPrice: number;
  currentValue: number;
  estimatedDailyReward: number;
  acquiredAt: string;
}
