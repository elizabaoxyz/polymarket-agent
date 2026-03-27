import { z } from "zod";

// --- Service type constant ---

export const POLYMARKET_EXT_SERVICE_TYPE = "POLYMARKET_EXT";

// --- Error classes ---

export class PolymarketApiError extends Error {
  readonly statusCode: number;
  readonly responseBody: string;
  readonly endpoint: string;

  constructor(statusCode: number, responseBody: string, endpoint: string) {
    super(`Polymarket API error ${statusCode} on ${endpoint}: ${responseBody}`);
    this.name = "PolymarketApiError";
    this.statusCode = statusCode;
    this.responseBody = responseBody;
    this.endpoint = endpoint;
  }
}

export class PolymarketAuthError extends PolymarketApiError {
  constructor(statusCode: number, responseBody: string, endpoint: string) {
    super(statusCode, responseBody, endpoint);
    this.name = "PolymarketAuthError";
    this.message = `CLOB credentials invalid or expired (${statusCode} on ${endpoint}). Run settings to reconfigure.`;
  }
}

export class PolymarketRateLimitError extends PolymarketApiError {
  constructor(statusCode: number, responseBody: string, endpoint: string) {
    super(statusCode, responseBody, endpoint);
    this.name = "PolymarketRateLimitError";
    this.message = `Rate limited (${statusCode} on ${endpoint}). Try again in a few seconds.`;
  }
}

// --- CLOB API schemas ---

export const CancelResponseSchema = z.object({
  canceled: z.string(),
}).passthrough();
export type CancelResponse = z.infer<typeof CancelResponseSchema>;

export const CancelAllResponseSchema = z.object({
  canceled: z.array(z.string()),
}).passthrough();
export type CancelAllResponse = z.infer<typeof CancelAllResponseSchema>;

export const OpenOrderSchema = z.object({
  id: z.string(),
  market: z.string(),
  asset_id: z.string(),
  side: z.enum(["BUY", "SELL"]),
  price: z.string(),
  original_size: z.string(),
  size_matched: z.string(),
  status: z.string(),
  created_at: z.string(),
  expiration: z.string().optional(),
  order_type: z.string(),
}).passthrough();
export type OpenOrder = z.infer<typeof OpenOrderSchema>;

export const OpenOrdersResponseSchema = z.array(OpenOrderSchema);

export const OrderBookEntrySchema = z.object({
  price: z.string(),
  size: z.string(),
}).passthrough();

export const OrderBookSchema = z.object({
  bids: z.array(OrderBookEntrySchema),
  asks: z.array(OrderBookEntrySchema),
}).passthrough();
export type OrderBook = z.infer<typeof OrderBookSchema>;

// --- Data API schemas ---

export const PositionSchema = z.object({
  market_slug: z.string(),
  title: z.string(),
  outcome: z.string(),
  size: z.number(),
  avg_price: z.number(),
  cur_price: z.number(),
  realized_pnl: z.number(),
  condition_id: z.string(),
  asset_id: z.string(),
}).passthrough();
export type Position = z.infer<typeof PositionSchema>;

export const TradeSchema = z.object({
  id: z.string(),
  market_slug: z.string(),
  title: z.string(),
  side: z.enum(["BUY", "SELL"]),
  outcome: z.string(),
  price: z.number(),
  size: z.number(),
  timestamp: z.string(),
  transaction_hash: z.string(),
}).passthrough();
export type Trade = z.infer<typeof TradeSchema>;

export const PnlSummarySchema = z.object({
  total_realized: z.number(),
  total_unrealized: z.number(),
  total_volume: z.number(),
  positions_won: z.number().optional(),
  positions_lost: z.number().optional(),
}).passthrough();
export type PnlSummary = z.infer<typeof PnlSummarySchema>;
