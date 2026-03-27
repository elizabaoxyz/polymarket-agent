import { z } from "zod";
import {
  EventsResponseSchema,
  EventSchema,
  MarketSchema,
  OrderbookSchema,
  PlaceOrderResponseSchema,
  OrderStatusSchema,
  PositionSchema,
  TradingStatusSchema,
  type Event,
  type Market,
  type Orderbook,
  type PlaceOrderResponse,
  type OrderStatus,
  type Position,
  type TradingStatus,
  type PlaceOrderParams,
} from "./types";

const BASE_URL = "https://api.jup.ag/prediction/v1";

export class JupiterPredictionClient {
  private readonly apiKey: string;
  private readonly baseUrl: string;

  constructor(apiKey: string, baseUrl: string = BASE_URL) {
    this.apiKey = apiKey;
    this.baseUrl = baseUrl;
  }

  private async request<T>(
    path: string,
    schema: z.ZodType<T>,
    options: { method?: string; body?: unknown; query?: Record<string, string> } = {}
  ): Promise<T> {
    const url = new URL(`${this.baseUrl}${path}`);
    if (options.query) {
      for (const [key, value] of Object.entries(options.query)) {
        url.searchParams.set(key, value);
      }
    }

    const headers: Record<string, string> = {
      "x-api-key": this.apiKey,
      "content-type": "application/json",
    };

    const response = await fetch(url.toString(), {
      method: options.method ?? "GET",
      headers,
      ...(options.body ? { body: JSON.stringify(options.body) } : {}),
    });

    if (response.status === 401 || response.status === 403) {
      throw new Error(
        `Jupiter API key error (${response.status}). Verify your JUPITER_API_KEY from portal.jup.ag.`
      );
    }

    if (!response.ok) {
      const text = await response.text().catch(() => "");
      throw new Error(`Jupiter API error ${response.status}: ${text}`);
    }

    const data = await response.json();
    return schema.parse(data);
  }

  async getTradingStatus(): Promise<TradingStatus> {
    return this.request("/trading-status", TradingStatusSchema);
  }

  async getEvents(filters: { category?: string; status?: string } = {}): Promise<Event[]> {
    const query: Record<string, string> = {};
    if (filters.category) query.category = filters.category;
    if (filters.status) query.status = filters.status;
    const response = await this.request("/events", EventsResponseSchema, { query });
    return response.data;
  }

  async searchEvents(query: string): Promise<Event[]> {
    const response = await this.request("/events/search", EventsResponseSchema, { query: { query } });
    return response.data;
  }

  async getMarket(marketId: string): Promise<Market> {
    return this.request(`/markets/${marketId}`, MarketSchema);
  }

  async getOrderbook(marketId: string): Promise<Orderbook> {
    return this.request(`/orderbook/${marketId}`, OrderbookSchema);
  }

  async placeOrder(params: PlaceOrderParams): Promise<PlaceOrderResponse> {
    return this.request("/orders", PlaceOrderResponseSchema, { method: "POST", body: params });
  }

  async getOrders(ownerPubkey: string): Promise<unknown[]> {
    const response = await this.request("/orders", z.object({ data: z.array(z.unknown()) }).passthrough(), { query: { ownerPubkey } });
    return response.data;
  }

  async getOrderStatus(orderPubkey: string): Promise<OrderStatus> {
    return this.request(`/orders/status/${orderPubkey}`, OrderStatusSchema);
  }

  async getPositions(ownerPubkey: string): Promise<Position[]> {
    const response = await this.request("/positions", z.object({ data: z.array(PositionSchema) }).passthrough(), { query: { ownerPubkey } });
    return response.data;
  }

  async closePosition(positionPubkey: string): Promise<PlaceOrderResponse> {
    return this.request(`/positions/${positionPubkey}`, PlaceOrderResponseSchema, { method: "DELETE" });
  }

  async claimPosition(positionPubkey: string): Promise<PlaceOrderResponse> {
    return this.request(`/positions/${positionPubkey}/claim`, PlaceOrderResponseSchema, { method: "POST" });
  }
}
