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

    const walletAddress = ethers.computeAddress(privateKey);
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
      address: walletAddress,
    });

    const svc = new PolymarketExtService(clob, data, walletAddress, privateKey);

    svc.heartbeatTimer = setInterval(() => {
      clob.heartbeat().catch((err) => {
        const msg = err instanceof Error ? err.message : String(err);
        console.warn(`polymarket-ext: heartbeat failed: ${msg}`);
      });
    }, HEARTBEAT_INTERVAL_MS);

    console.log(`polymarket-ext: active | wallet: ${walletAddress}`);
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

  async sellOrder(params: { tokenId: string; price: number; size: number }): Promise<{
    orderID: string;
    status: string;
    transactionsHashes: string[];
  }> {
    if (!this.clob) throw new Error("CLOB client not initialized.");
    if (!this._privateKey) throw new Error("Private key not available for order signing.");

    const { ClobClient } = await import("@polymarket/clob-client");
    const { Wallet } = await import("@ethersproject/wallet");

    const signer = new Wallet(this._privateKey);
    const chainId = 137; // Polygon
    const client = new ClobClient(this.clob.config.baseUrl, chainId, signer, {
      key: this.clob.config.apiKey,
      secret: this.clob.config.secret,
      passphrase: this.clob.config.passphrase,
    });

    const order = await (client as any).createAndPostOrder({
      tokenID: params.tokenId,
      price: params.price,
      side: "SELL",
      size: params.size,
      feeRateBps: 0,
      nonce: 0,
    });

    return {
      orderID: order.orderID ?? order.id ?? "unknown",
      status: order.status ?? "submitted",
      transactionsHashes: order.transactionsHashes ?? [],
    };
  }
}
