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

export type PortfolioData = {
  balance: number;
  positions: Position[];
  trades: Trade[];
};

export type UserKeys = Record<string, string>;

// Server -> Client messages
export type ServerMessage =
  | { type: "reply"; text: string }
  | { type: "action_result"; text: string }
  | { type: "thinking"; active: boolean }
  | { type: "status"; balance: number; positions: Position[]; trades: Trade[] }
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
