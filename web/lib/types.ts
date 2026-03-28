export type Position = {
  asset: string;
  conditionId: string;
  size: number;
  avgPrice: number;
  initialValue: number;
  currentValue: number;
  cashPnl: number;
  percentPnl: number;
  curPrice: number;
  realizedPnl: number;
  title: string;
  slug: string;
  outcome: string;
  endDate?: string;
};

export type Trade = {
  conditionId: string;
  type: string;
  size: number;
  usdcSize: number;
  price: number;
  side: string;
  outcome: string;
  title: string;
  transactionHash: string;
  timestamp: number;
};

export type JupiterPosition = {
  marketId: string;
  isYes: boolean;
  contracts: string;
  sizeUsd: string;
  valueUsd: string;
  avgPriceUsd: string;
  markPriceUsd: string;
  pnlUsd: string;
  pnlUsdPercent: number;
  eventTitle: string;
  marketTitle: string;
};

export type PortfolioData = {
  balance: number;
  solanaBalance: number;
  positions: Position[];
  trades: Trade[];
  jupiterPositions: JupiterPosition[];
};

export type UserKeys = Record<string, string>;

// Server -> Client messages
export type ServerMessage =
  | { type: "reply"; text: string }
  | { type: "action_result"; text: string }
  | { type: "thinking"; active: boolean }
  | { type: "status"; balance: number; solanaBalance?: number; positions: Position[]; trades: Trade[]; jupiterPositions?: JupiterPosition[] }
  | { type: "auth_ok" }
  | { type: "auth_error"; text: string }
  | { type: "error"; text: string };

// Client -> Server messages
export type ClientMessage =
  | { type: "message"; text: string }
  | { type: "get_status" }
  | { type: "auth"; keys: Record<string, string> };

export type ChatMessage = {
  id: string;
  role: "user" | "agent" | "action";
  text: string;
  timestamp: number;
};

// --- Whale / Dashboard types ---

export type GlobalTrade = {
  proxyWallet: string;
  side: string;
  asset: string;
  conditionId: string;
  size: number;
  usdcSize: number;
  price: number;
  timestamp: number;
  title: string;
  slug: string;
  outcome: string;
  name: string;
  pseudonym: string;
};

export type WhaleWallet = {
  address: string;
  name: string;
  pseudonym: string;
  totalVolume: number;
  tradeCount: number;
  buyVolume: number;
  sellVolume: number;
};

export type DashboardStats = {
  volume24h: number;
  transactions: number;
  whaleCount: number;
  avgTradeSize: number;
  buyVolume: number;
  sellVolume: number;
  yesVolume: number;
  noVolume: number;
  largestBuy: number;
  largestSell: number;
  whales: WhaleWallet[];
};
