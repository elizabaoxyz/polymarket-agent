/**
 * Shared portfolio types — replaces `unknown[]` in portfolio.ts and
 * provides typed interfaces for positions, trades, and PnL data
 * used across the autonomy engine and web dashboard.
 */

import type { Position, Trade, PnlSummary } from "./plugins/polymarket-ext/types";

// Re-export for convenience
export type PolymarketPosition = Position;
export type PolymarketTrade = Trade;
export type PolymarketPnlSummary = PnlSummary;

// Jupiter position as returned by the API (includes nested metadata)
export type JupiterPositionEntry = {
  marketId: string;
  isYes: boolean;
  contracts: string;
  sizeUsd: string;
  valueUsd: string;
  avgPriceUsd: string;
  markPriceUsd: string;
  pnlUsd: string;
  pnlUsdPercent: number;
  eventMetadata?: { title?: string };
  marketMetadata?: { title?: string };
  pubkey?: string;
  claimable?: boolean;
  claimed?: boolean;
  payoutUsd?: number;
};

// --- Portfolio status (returned by getPortfolioStatus) ---

export type X402Status = {
  active: boolean;
  payments: number;
  totalUsd: number;
};

export type PortfolioStatus = {
  balance: number;
  solanaBalance: number;
  positions: PolymarketPosition[];
  trades: PolymarketTrade[];
  jupiterPositions: JupiterPositionEntry[];
  x402: X402Status;
};
