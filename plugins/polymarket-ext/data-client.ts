import { z } from "zod";
import {
  PositionSchema,
  TradeSchema,
  PnlSummarySchema,
  type Position,
  type Trade,
  type PnlSummary,
} from "./types";

export class DataApiClient {
  private readonly baseUrl: string;

  constructor(baseUrl: string) {
    this.baseUrl = baseUrl;
  }

  private async request<T>(path: string, schema: z.ZodType<T>, query: Record<string, string>): Promise<T> {
    const url = new URL(`${this.baseUrl}${path}`);
    for (const [key, value] of Object.entries(query)) {
      url.searchParams.set(key, value);
    }

    const response = await fetch(url.toString());

    if (!response.ok) {
      const text = await response.text().catch(() => "");
      throw new Error(`Data API error ${response.status} on ${path}: ${text}`);
    }

    const data = await response.json();
    return schema.parse(data);
  }

  async getPositions(address: string): Promise<Position[]> {
    return this.request("/positions", z.array(PositionSchema), { user: address });
  }

  async getClosedPositions(address: string): Promise<Position[]> {
    return this.request("/closed-positions", z.array(PositionSchema), { user: address });
  }

  async getTrades(address: string, params?: { limit?: number }): Promise<Trade[]> {
    const query: Record<string, string> = {
      user: address,
      limit: String(params?.limit ?? 20),
    };
    return this.request("/activity", z.array(TradeSchema), query);
  }

  async getPnl(address: string): Promise<PnlSummary> {
    const results = await this.request("/value", z.array(PnlSummarySchema), { user: address });
    if (results.length === 0) return { user: address, value: 0 };
    return results[0]!;
  }
}
