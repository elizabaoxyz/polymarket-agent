import { createHmac } from "node:crypto";
import {
  PolymarketApiError,
  PolymarketAuthError,
  PolymarketRateLimitError,
  CancelResponseSchema,
  CancelAllResponseSchema,
  OpenOrdersResponseSchema,
  OrderBookSchema,
  type CancelResponse,
  type CancelAllResponse,
  type OpenOrder,
  type OrderBook,
} from "./types";
import { z } from "zod";

export type ClobClientConfig = {
  readonly baseUrl: string;
  readonly apiKey: string;
  readonly secret: string;
  readonly passphrase: string;
  readonly address: string;
};

export class ClobApiClient {
  readonly config: ClobClientConfig;

  constructor(config: ClobClientConfig) {
    this.config = config;
  }

  private buildHeaders(method: string, path: string, body?: string): Record<string, string> {
    const timestamp = String(Math.floor(Date.now() / 1000));
    const message = timestamp + method + path + (body ?? "");
    const signature = createHmac("sha256", Buffer.from(this.config.secret, "base64"))
      .update(message)
      .digest("base64");

    return {
      "POLY_ADDRESS": this.config.address,
      "POLY_API_KEY": this.config.apiKey,
      "POLY_PASSPHRASE": this.config.passphrase,
      "POLY_TIMESTAMP": timestamp,
      "POLY_SIGNATURE": signature,
      "content-type": "application/json",
    };
  }

  private async request<T>(
    method: string,
    path: string,
    options: { body?: unknown; query?: Record<string, string>; schema: z.ZodType<T> },
  ): Promise<T> {
    const url = new URL(`${this.config.baseUrl}${path}`);
    if (options.query) {
      for (const [key, value] of Object.entries(options.query)) {
        url.searchParams.set(key, value);
      }
    }

    const bodyStr = options.body ? JSON.stringify(options.body) : undefined;
    const headers = this.buildHeaders(method, path, bodyStr);

    const response = await fetch(url.toString(), {
      method,
      headers,
      ...(bodyStr ? { body: bodyStr } : {}),
    });

    if (response.status === 401 || response.status === 403) {
      const text = await response.text().catch(() => "");
      throw new PolymarketAuthError(response.status, text, path);
    }

    if (response.status === 429) {
      const text = await response.text().catch(() => "");
      throw new PolymarketRateLimitError(response.status, text, path);
    }

    if (!response.ok) {
      const text = await response.text().catch(() => "");
      throw new PolymarketApiError(response.status, text, path);
    }

    const data = await response.json();
    return options.schema.parse(data);
  }

  async cancelOrder(orderId: string): Promise<CancelResponse> {
    return this.request("DELETE", "/order", {
      body: { id: orderId },
      schema: CancelResponseSchema,
    });
  }

  async cancelAll(): Promise<CancelAllResponse> {
    return this.request("DELETE", "/cancel-all", {
      schema: CancelAllResponseSchema,
    });
  }

  async cancelMarketOrders(assetIds: string[]): Promise<CancelAllResponse> {
    return this.request("DELETE", "/cancel-market-orders", {
      body: { asset_ids: assetIds },
      schema: CancelAllResponseSchema,
    });
  }

  async getOpenOrders(params?: { market?: string }): Promise<OpenOrder[]> {
    const query: Record<string, string> = { state: "open" };
    if (params?.market) query.market = params.market;
    return this.request("GET", "/data/orders", {
      query,
      schema: OpenOrdersResponseSchema,
    });
  }

  async getOrderBook(tokenId: string): Promise<OrderBook> {
    return this.request("GET", "/book", {
      query: { token_id: tokenId },
      schema: OrderBookSchema,
    });
  }

  async heartbeat(): Promise<void> {
    const url = new URL(`${this.config.baseUrl}/heartbeat`);
    const headers = this.buildHeaders("GET", "/heartbeat");
    const response = await fetch(url.toString(), { method: "GET", headers });

    if (response.status === 401 || response.status === 403) {
      const text = await response.text().catch(() => "");
      throw new PolymarketAuthError(response.status, text, "/heartbeat");
    }
    if (response.status === 429) {
      const text = await response.text().catch(() => "");
      throw new PolymarketRateLimitError(response.status, text, "/heartbeat");
    }
    if (!response.ok) {
      const text = await response.text().catch(() => "");
      throw new PolymarketApiError(response.status, text, "/heartbeat");
    }
  }
}
