import { z } from "zod";

const MICRO_USD_FACTOR = 1_000_000;

export function microUsdToDollars(microUsd: number): number {
  return microUsd / MICRO_USD_FACTOR;
}

export function dollarsToMicroUsd(dollars: number): number {
  return Math.round(dollars * MICRO_USD_FACTOR);
}

export const USDC_MINT = "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v";
export const JUPUSD_MINT = "JuprjznTrTSp2UFa3ZBUFgwdAmtZCq4MQCwysN55USD";

export const MarketSchema = z.object({
  id: z.string(),
  question: z.string(),
  yesPrice: z.number(),
  noPrice: z.number(),
  status: z.string(),
  expiresAt: z.string(),
});
export type Market = z.infer<typeof MarketSchema>;

export const EventSchema = z.object({
  id: z.string(),
  title: z.string(),
  category: z.string(),
  status: z.string(),
  markets: z.array(MarketSchema),
});
export type Event = z.infer<typeof EventSchema>;

export const OrderbookEntrySchema = z.tuple([z.number(), z.number()]);

export const OrderbookSchema = z.object({
  bids: z.array(OrderbookEntrySchema),
  asks: z.array(OrderbookEntrySchema),
});
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
  operational: z.boolean(),
});
export type TradingStatus = z.infer<typeof TradingStatusSchema>;

export type PlaceOrderParams = {
  readonly ownerPubkey: string;
  readonly marketId: string;
  readonly isYes: boolean;
  readonly isBuy: boolean;
  readonly depositAmount: number;
  readonly depositMint: string;
};

export type ScoredOpportunity = {
  readonly event: Event;
  readonly market: Market;
  readonly orderbook: Orderbook;
  readonly spread: number;
  readonly midpoint: number;
  readonly depthScore: number;
  readonly totalScore: number;
};
