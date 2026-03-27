import { z } from "zod";

// --- Monetary conversion ---

const MICRO_USD_FACTOR = 1_000_000;

export function microUsdToDollars(microUsd: number): number {
  return microUsd / MICRO_USD_FACTOR;
}

export function dollarsToMicroUsd(dollars: number): number {
  return Math.round(dollars * MICRO_USD_FACTOR);
}

// --- USDC / JupUSD mint addresses ---

export const USDC_MINT = "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v";
export const JUPUSD_MINT = "JuprjznTrTSp2UFa3ZBUFgwdAmtZCq4MQCwysN55USD";

// --- API response schemas (matching actual Jupiter Prediction API) ---

export const MarketPricingSchema = z.object({
  buyYesPriceUsd: z.number(),
  sellYesPriceUsd: z.number(),
  sellNoPriceUsd: z.number(),
  buyNoPriceUsd: z.number(),
  volume: z.number().optional(),
});

export const MarketMetadataSchema = z.object({
  title: z.string(),
  closeTime: z.number().optional(),
  openTime: z.number().optional(),
}).passthrough();

export const MarketSchema = z.object({
  marketId: z.string(),
  status: z.string(),
  closeTime: z.number(),
  metadata: MarketMetadataSchema,
  pricing: MarketPricingSchema,
}).passthrough();
export type Market = z.infer<typeof MarketSchema>;

export const EventMetadataSchema = z.object({
  title: z.string(),
}).passthrough();

export const EventSchema = z.object({
  eventId: z.string(),
  isActive: z.boolean(),
  isLive: z.boolean(),
  category: z.string(),
  metadata: EventMetadataSchema,
  markets: z.array(MarketSchema),
}).passthrough();
export type Event = z.infer<typeof EventSchema>;

export const EventsResponseSchema = z.object({
  data: z.array(EventSchema),
}).passthrough();

// Orderbook: { yes: [[price_cents, qty], ...], no: [[price_cents, qty], ...] }
export const OrderbookEntrySchema = z.tuple([z.number(), z.number()]);

export const OrderbookSchema = z.object({
  yes: z.array(OrderbookEntrySchema),
  no: z.array(OrderbookEntrySchema),
}).passthrough();
export type Orderbook = z.infer<typeof OrderbookSchema>;

export const PlaceOrderResponseSchema = z.object({
  transaction: z.string(),
  orderPubkey: z.string(),
});
export type PlaceOrderResponse = z.infer<typeof PlaceOrderResponseSchema>;

export const OrderStatusSchema = z.object({
  status: z.enum(["pending", "filled", "failed"]),
  orderPubkey: z.string(),
});
export type OrderStatus = z.infer<typeof OrderStatusSchema>;

export const PositionSchema = z.object({
  positionPubkey: z.string(),
  marketId: z.string(),
  isYes: z.boolean(),
  quantity: z.number(),
  averagePrice: z.number(),
  currentPrice: z.number(),
  status: z.string(),
});
export type Position = z.infer<typeof PositionSchema>;

export const TradingStatusSchema = z.object({
  trading_active: z.boolean(),
});
export type TradingStatus = z.infer<typeof TradingStatusSchema>;

// --- Place order request ---

export type PlaceOrderParams = {
  readonly ownerPubkey: string;
  readonly marketId: string;
  readonly isYes: boolean;
  readonly isBuy: boolean;
  readonly depositAmount: number;
  readonly depositMint: string;
};

// --- Scored opportunity (scanner output) ---

export type ScoredOpportunity = {
  readonly event: Event;
  readonly market: Market;
  readonly orderbook: Orderbook;
  readonly spread: number;
  readonly midpoint: number;
  readonly depthScore: number;
  readonly totalScore: number;
};
