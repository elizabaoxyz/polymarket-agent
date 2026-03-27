import { createHmac } from "node:crypto";
import {
  PolymarketApiError,
  PolymarketAuthError,
  PolymarketRateLimitError,
  CancelResponseSchema,
  CancelAllResponseSchema,
  OpenOrdersResponseSchema,
  OrderBookSchema,
  ClobMarketsResponseSchema,
  type CancelResponse,
  type CancelAllResponse,
  type OpenOrder,
  type OrderBook,
  type ClobMarket,
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
    // HMAC-SHA256 with URL-safe base64 encoding (matching @polymarket/clob-client)
    const sig = createHmac("sha256", Buffer.from(this.config.secret, "base64"))
      .update(message)
      .digest("base64");
    const signature = sig.replace(/\+/g, "-").replace(/\//g, "_");

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
    const response = await this.request("GET", "/data/orders", {
      query,
      schema: OpenOrdersResponseSchema,
    });
    return response.data;
  }

  async getOrderBook(tokenId: string): Promise<OrderBook> {
    return this.request("GET", "/book", {
      query: { token_id: tokenId },
      schema: OrderBookSchema,
    });
  }

  async searchMarkets(query: string): Promise<ClobMarket[]> {
    // Fetch sampling-markets (public, no auth) and filter by query
    const url = new URL(`${this.config.baseUrl}/sampling-markets`);
    const response = await fetch(url.toString());
    if (!response.ok) {
      const text = await response.text().catch(() => "");
      throw new PolymarketApiError(response.status, text, "/sampling-markets");
    }
    const data = await response.json();
    const parsed = ClobMarketsResponseSchema.parse(data);
    const active = parsed.data.filter((m) =>
      m.active === true &&
      m.closed !== true &&
      m.accepting_orders === true
    );
    if (!query || query.trim().length === 0) {
      // No query — return top markets (they come pre-sorted by relevance/volume)
      return active.slice(0, 20);
    }
    const q = query.toLowerCase();
    return active.filter((m) => m.question?.toLowerCase().includes(q));
  }

  async getMarket(conditionId: string): Promise<ClobMarket | null> {
    const url = new URL(`${this.config.baseUrl}/markets/${conditionId}`);
    const response = await fetch(url.toString());
    if (response.status === 404) return null;
    if (!response.ok) {
      const text = await response.text().catch(() => "");
      throw new PolymarketApiError(response.status, text, `/markets/${conditionId}`);
    }
    const data = await response.json();
    return ClobMarketsResponseSchema.shape.data.element.parse(data);
  }

  private heartbeatId: string | null = null;

  async heartbeat(): Promise<void> {
    const path = "/v1/heartbeats";
    const bodyObj = { heartbeat_id: this.heartbeatId };
    const bodyStr = JSON.stringify(bodyObj);
    const url = new URL(`${this.config.baseUrl}${path}`);
    const headers = this.buildHeaders("POST", path, bodyStr);

    const response = await fetch(url.toString(), {
      method: "POST",
      headers,
      body: bodyStr,
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

    try {
      const data = await response.json();
      if (data && typeof data.heartbeat_id === "string") {
        this.heartbeatId = data.heartbeat_id;
      }
    } catch {
      // Non-JSON response is fine, heartbeat still succeeded
    }
  }
}
