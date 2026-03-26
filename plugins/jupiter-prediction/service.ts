import { Connection, VersionedTransaction, Keypair } from "@solana/web3.js";
import bs58 from "bs58";
import { JupiterPredictionClient } from "./api";
import type { OrderStatus } from "./types";

const DEFAULT_RPC_URL = "https://api.mainnet-beta.solana.com";
const ORDER_POLL_INTERVAL_MS = 2000;
const ORDER_POLL_MAX_ATTEMPTS = 30;

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

  constructor(config: JupiterServiceConfig) {
    this.client = new JupiterPredictionClient(config.apiKey);
    this.connection = new Connection(config.rpcUrl ?? DEFAULT_RPC_URL, "confirmed");
    const secretKey = bs58.decode(config.solanaPrivateKey);
    this.keypair = Keypair.fromSecretKey(secretKey);
    this.ownerPubkey = this.keypair.publicKey.toBase58();
  }

  async isReady(): Promise<boolean> {
    try {
      const status = await this.client.getTradingStatus();
      return status.operational;
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
    orderPubkey: string;
    signature: string;
  }> {
    const response = await this.client.placeOrder(params);
    const signature = await this.signAndSubmit(response.transaction);
    return { orderPubkey: response.orderPubkey, signature };
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
