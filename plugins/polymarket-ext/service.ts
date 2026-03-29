import { ethers } from "ethers";
import { ClobApiClient } from "./clob-client";
import { DataApiClient } from "./data-client";
import { POLYMARKET_EXT_SERVICE_TYPE } from "./types";

const DEFAULT_CLOB_URL = "https://clob.polymarket.com";
const DEFAULT_DATA_URL = "https://data-api.polymarket.com";
const HEARTBEAT_INTERVAL_MS = 60_000;

type Runtime = { getSetting: (key: string) => string | undefined };

export class PolymarketExtService {
  static serviceType = POLYMARKET_EXT_SERVICE_TYPE;
  serviceType = POLYMARKET_EXT_SERVICE_TYPE;

  readonly clob: ClobApiClient | null;
  readonly data: DataApiClient;
  readonly walletAddress: string;
  private readonly _privateKey: string | null;
  private heartbeatTimer: ReturnType<typeof setInterval> | null = null;

  private constructor(
    clob: ClobApiClient | null,
    data: DataApiClient,
    walletAddress: string,
    privateKey: string | null,
  ) {
    this.clob = clob;
    this.data = data;
    this.walletAddress = walletAddress;
    this._privateKey = privateKey;
  }

  static async start(runtime: Runtime): Promise<PolymarketExtService> {
    const privateKey = runtime.getSetting("EVM_PRIVATE_KEY")
      ?? runtime.getSetting("POLYMARKET_PRIVATE_KEY")
      ?? process.env.EVM_PRIVATE_KEY?.trim();

    if (!privateKey) {
      console.log("polymarket-ext: disabled (no EVM_PRIVATE_KEY)");
      const data = new DataApiClient(DEFAULT_DATA_URL);
      return new PolymarketExtService(null, data, "", null);
    }

    const eoaAddress = ethers.computeAddress(privateKey);
    // Use proxy/funder address for Data API (positions, trades live there)
    // Fall back to EOA if no funder is set
    const funderAddress = runtime.getSetting("POLYMARKET_FUNDER_ADDRESS")
      ?? process.env.POLYMARKET_FUNDER_ADDRESS?.trim();
    const walletAddress = funderAddress || eoaAddress;
    const data = new DataApiClient(DEFAULT_DATA_URL);

    const apiKey = runtime.getSetting("CLOB_API_KEY") ?? process.env.CLOB_API_KEY?.trim();
    const secret = runtime.getSetting("CLOB_API_SECRET") ?? process.env.CLOB_API_SECRET?.trim();
    const passphrase = runtime.getSetting("CLOB_API_PASSPHRASE") ?? process.env.CLOB_API_PASSPHRASE?.trim();
    const clobUrl = runtime.getSetting("CLOB_API_URL") ?? process.env.CLOB_API_URL?.trim() ?? DEFAULT_CLOB_URL;

    if (!apiKey || !secret || !passphrase) {
      console.log(`polymarket-ext: data-only mode (CLOB credentials missing) | wallet: ${walletAddress}`);
      return new PolymarketExtService(null, data, walletAddress, privateKey);
    }

    const clob = new ClobApiClient({
      baseUrl: clobUrl,
      apiKey,
      secret,
      passphrase,
      address: eoaAddress, // HMAC auth uses the EOA/signer address
    });

    const svc = new PolymarketExtService(clob, data, walletAddress, privateKey);

    // Heartbeat managed by autonomy toggle in ws-server.ts
    // Starts when autonomy ON, stops when autonomy OFF or disconnect

    console.log(`polymarket-ext: active | wallet: ${walletAddress}${funderAddress ? " (proxy)" : " (EOA)"}`);
    return svc;
  }

  isFullyActive(): boolean {
    return this.clob !== null;
  }

  stop(): void {
    if (this.heartbeatTimer !== null) {
      clearInterval(this.heartbeatTimer);
      this.heartbeatTimer = null;
    }
  }

  private async getClobClient(): Promise<any> {
    if (!this.clob) throw new Error("CLOB client not initialized.");
    if (!this._privateKey) throw new Error("Private key not available for order signing.");

    const { ClobClient } = await import("@polymarket/clob-client");
    const { Wallet } = await import("@ethersproject/wallet");

    const signer = new Wallet(this._privateKey);
    const chainId = 137; // Polygon

    const sigType = process.env.POLYMARKET_SIGNATURE_TYPE?.trim();
    const funder = process.env.POLYMARKET_FUNDER_ADDRESS?.trim();

    return new ClobClient(
      this.clob.config.baseUrl,
      chainId,
      signer,
      {
        key: this.clob.config.apiKey,
        secret: this.clob.config.secret,
        passphrase: this.clob.config.passphrase,
      },
      sigType ? Number(sigType) : undefined,
      funder,
      undefined, // geoBlockToken
      true, // useServerTime — prevents timestamp drift rejections
    );
  }

  async placeOrder(params: {
    tokenId: string;
    side: "BUY" | "SELL";
    price: number;
    size: number;
  }): Promise<{
    orderID: string;
    status: string;
    transactionsHashes: string[];
  }> {
    // Guard: reject invalid prices — Polymarket range is 0.01 to 0.99
    if (params.price < 0.01 || params.price > 0.99) {
      throw new Error(`Invalid price $${params.price} — must be between $0.01 and $0.99. Market may be closed.`);
    }
    if (!params.size || params.size <= 0) {
      throw new Error(`Invalid size ${params.size}`);
    }
    const client = await this.getClobClient();
    const order = await client.createAndPostOrder({
      tokenID: params.tokenId,
      price: params.price,
      side: params.side,
      size: params.size,
      feeRateBps: 0,
      nonce: 0,
    });

    // Handle error responses (status might be a number like 400)
    if (order.error || (typeof order.status === "number" && order.status >= 400)) {
      throw new Error(order.error ?? order.errorMsg ?? `Order failed with status ${order.status}`);
    }

    return {
      orderID: order.orderID ?? order.id ?? "unknown",
      status: String(order.status ?? "submitted"),
      transactionsHashes: order.transactionsHashes ?? [],
    };
  }

  async sellOrder(params: { tokenId: string; price: number; size: number }): Promise<{
    orderID: string;
    status: string;
    transactionsHashes: string[];
  }> {
    return this.placeOrder({ ...params, side: "SELL" });
  }
}
