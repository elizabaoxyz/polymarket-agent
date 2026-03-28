import { Connection, VersionedTransaction, Keypair } from "@solana/web3.js";
import bs58 from "bs58";
import { JupiterPredictionClient } from "./api";
import type { OrderStatus } from "./types";

const DEFAULT_RPC_URL = "https://api.mainnet-beta.solana.com";
const ORDER_POLL_INTERVAL_MS = 2000;
const ORDER_POLL_MAX_ATTEMPTS = 30;

export const JUPITER_SERVICE_TYPE = "JUPITER_PREDICTION";

export type JupiterServiceConfig = {
  readonly apiKey: string;
  readonly solanaPrivateKey: string;
  readonly rpcUrl?: string;
};

export class JupiterPredictionService {
  readonly client: JupiterPredictionClient;
  readonly connection: Connection;
  readonly keypair: Keypair;
  readonly ownerPubkey: string;

  // elizaOS Service interface
  static serviceType = JUPITER_SERVICE_TYPE;
  serviceType = JUPITER_SERVICE_TYPE;

  constructor(config: JupiterServiceConfig) {
    this.client = new JupiterPredictionClient(config.apiKey);
    this.connection = new Connection(config.rpcUrl ?? DEFAULT_RPC_URL, "confirmed");
    const secretKey = bs58.decode(config.solanaPrivateKey);
    this.keypair = Keypair.fromSecretKey(secretKey);
    this.ownerPubkey = this.keypair.publicKey.toBase58();
  }

  // elizaOS ServiceClass factory — reads config from runtime settings/env
  static async start(runtime: { getSetting: (key: string) => string | undefined }): Promise<JupiterPredictionService> {
    const apiKey = runtime.getSetting("JUPITER_API_KEY") ?? process.env.JUPITER_API_KEY?.trim();
    const solanaPrivateKey = runtime.getSetting("SOLANA_PRIVATE_KEY") ?? process.env.SOLANA_PRIVATE_KEY?.trim();
    const rpcUrl = runtime.getSetting("SOLANA_RPC_URL") ?? process.env.SOLANA_RPC_URL?.trim();

    if (!apiKey || !solanaPrivateKey) {
      console.log("Jupiter Prediction: JUPITER_API_KEY or SOLANA_PRIVATE_KEY not set — Jupiter actions disabled.");
      // Return a stub that reports not ready
      const stub = Object.create(JupiterPredictionService.prototype) as JupiterPredictionService;
      Object.defineProperty(stub, "serviceType", { value: JUPITER_SERVICE_TYPE });
      Object.defineProperty(stub, "ownerPubkey", { value: "" });
      stub.isReady = async () => false;
      return stub;
    }

    const service = new JupiterPredictionService({
      apiKey,
      solanaPrivateKey,
      rpcUrl: rpcUrl ?? undefined,
    });
    console.log(`Jupiter Prediction: initialized, wallet ${service.ownerPubkey}`);
    return service;
  }

  async isReady(): Promise<boolean> {
    try {
      const status = await this.client.getTradingStatus();
      return status.trading_active;
    } catch {
      return false;
    }
  }

  async signAndSubmit(unsignedTxBase64: string): Promise<string> {
    const txBuffer = Buffer.from(unsignedTxBase64, "base64");
    const tx = VersionedTransaction.deserialize(txBuffer);
    tx.sign([this.keypair]);
    const rawTx = tx.serialize();
    const signature = await this.connection.sendRawTransaction(rawTx, {
      skipPreflight: false,
      preflightCommitment: "confirmed",
    });
    await this.connection.confirmTransaction(signature, "confirmed");
    return signature;
  }

  async placeOrderAndSign(params: Parameters<JupiterPredictionClient["placeOrder"]>[0]): Promise<{
    orderId: string;
    signature: string;
  }> {
    const response = await this.client.placeOrder(params);
    const signature = await this.signAndSubmit(response.transaction);
    return { orderId: response.externalOrderId ?? "unknown", signature };
  }

  async waitForFill(orderPubkey: string): Promise<OrderStatus> {
    for (let i = 0; i < ORDER_POLL_MAX_ATTEMPTS; i++) {
      const status = await this.client.getOrderStatus(orderPubkey);
      if (status.status === "filled" || status.status === "failed") {
        return status;
      }
      await new Promise((resolve) => setTimeout(resolve, ORDER_POLL_INTERVAL_MS));
    }
    return { status: "pending", orderPubkey };
  }
}
