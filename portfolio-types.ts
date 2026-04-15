/**
 * Shared portfolio types for positions, trades, and PnL data
 * used across the autonomy engine and web dashboard.
 */

import type { Position, Trade } from "./plugins/polymarket-ext/types";

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
  positions: Position[];
  trades: Trade[];
  jupiterPositions: JupiterPositionEntry[];
  x402: X402Status;
};
