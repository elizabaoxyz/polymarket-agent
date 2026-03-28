export type Position = {
  market_slug: string;
  title: string;
  outcome: string;
  size: number;
  avg_price: number;
  cur_price: number;
  realized_pnl: number;
  condition_id: string;
  asset_id: string;
};

export type Trade = {
  id: string;
  market_slug: string;
  title: string;
  side: "BUY" | "SELL";
  outcome: string;
  price: number;
  size: number;
  timestamp: string;
  transaction_hash: string;
};

export type PortfolioData = {
  balance: number;
  positions: Position[];
  trades: Trade[];
};

// Server -> Client messages
export type ServerMessage =
  | { type: "reply"; text: string }
  | { type: "action_result"; text: string }
  | { type: "thinking"; active: boolean }
  | { type: "status"; balance: number; positions: Position[]; trades: Trade[] }
  | { type: "error"; text: string };

// Client -> Server messages
export type ClientMessage =
  | { type: "message"; text: string }
  | { type: "get_status" };

export type ChatMessage = {
  id: string;
  role: "user" | "agent" | "action";
  text: string;
  timestamp: number;
};
