import { wrapFetchWithPayment, x402Client } from "@x402/fetch";
import { ExactSvmScheme } from "@x402/svm";
import { createKeyPairSignerFromBytes } from "@solana/kit";
import bs58 from "bs58";
import {
  X402_SERVICE_TYPE,
  DEFAULT_MAX_PAYMENT_USD,
  X402PaymentCapExceeded,
  type X402Config,
} from "./types";

const SOLANA_MAINNET = "solana:5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp";
const SOLANA_DEVNET = "solana:EtWTRABZaYq6iMfeYKouRu166VU2xqa1";

export class X402SolanaService {
  static serviceType = X402_SERVICE_TYPE;
  serviceType = X402_SERVICE_TYPE;

  private wrappedFetch: typeof globalThis.fetch;
  private readonly config: X402Config | null;
  private _paymentCount = 0;
  private _totalPaidUsd = 0;
  private _paymentLog: Array<{ timestamp: number; amountUsd: number; url: string }> = [];

  private constructor(
    wrappedFetch: typeof globalThis.fetch,
    config: X402Config | null,
  ) {
    this.wrappedFetch = wrappedFetch;
    this.config = config;
  }

  static async start(
    runtime: { getSetting: (key: string) => string | undefined },
  ): Promise<X402SolanaService> {
    const solanaPrivateKey =
      runtime.getSetting("SOLANA_PRIVATE_KEY") ??
      process.env.SOLANA_PRIVATE_KEY?.trim();

    const enabledRaw =
      runtime.getSetting("X402_ENABLED") ??
      process.env.X402_ENABLED?.trim();
    const enabled = enabledRaw !== "false";

    if (!solanaPrivateKey || !enabled) {
      console.log("x402: disabled (SOLANA_PRIVATE_KEY not set or X402_ENABLED=false)");
      return new X402SolanaService(globalThis.fetch, null);
    }

    const maxPaymentRaw =
      runtime.getSetting("X402_MAX_PAYMENT_USD") ??
      process.env.X402_MAX_PAYMENT_USD?.trim();
    const maxPaymentUsd = maxPaymentRaw
      ? parseFloat(maxPaymentRaw)
      : DEFAULT_MAX_PAYMENT_USD;

    const rpcUrl =
      runtime.getSetting("SOLANA_RPC_URL") ??
      process.env.SOLANA_RPC_URL?.trim();

    const config: X402Config = {
      solanaPrivateKey,
      maxPaymentUsd,
      enabled: true,
      rpcUrl,
    };

    try {
      const secretKey = bs58.decode(solanaPrivateKey);
      const signer = await createKeyPairSignerFromBytes(secretKey);

      const svmSchemeMainnet = new ExactSvmScheme(signer, rpcUrl ? { rpcUrl } : undefined);
      const svmSchemeDevnet = new ExactSvmScheme(signer, { rpcUrl: "https://api.devnet.solana.com" });

      const svc = new X402SolanaService(globalThis.fetch, config);

      const client = new x402Client()
        .register(SOLANA_MAINNET, svmSchemeMainnet)
        .register(SOLANA_DEVNET, svmSchemeDevnet)
        .onBeforePaymentCreation(async (...args: unknown[]) => {
          // x402 v2 passes different arg structures depending on version
          // Try to extract the amount from whatever we get
          let usdAmount = 0;
          try {
            const req = args[1] ?? args[0];
            const reqObj = req as Record<string, unknown> | undefined;
            const amount = reqObj?.maxAmountRequired ?? reqObj?.amount ?? reqObj?.maxAmount;
            if (typeof amount === "string" || typeof amount === "number") {
              const amountNum = typeof amount === "string" ? parseFloat(amount) : amount;
              usdAmount = amountNum / 1_000_000;
            }
          } catch {}

          if (usdAmount > maxPaymentUsd) {
            throw new X402PaymentCapExceeded(usdAmount, maxPaymentUsd);
          }

          // Track payment
          svc._paymentCount++;
          svc._totalPaidUsd += usdAmount;
          svc._paymentLog.push({ timestamp: Date.now(), amountUsd: usdAmount, url: "402-gated" });
          console.log(`x402: payment #${svc._paymentCount} — $${usdAmount.toFixed(4)} (total: $${svc._totalPaidUsd.toFixed(4)})`);
        });

      const wrappedFetch = wrapFetchWithPayment(globalThis.fetch, client);
      svc.wrappedFetch = wrappedFetch;
      console.log(`x402: active | cap: $${maxPaymentUsd.toFixed(2)}/request | networks: solana mainnet + devnet`);
      return svc;
    } catch (error) {
      if (error instanceof X402PaymentCapExceeded) throw error;
      const msg = error instanceof Error ? error.message : String(error);
      console.warn(`x402: failed to initialize (${msg}), payments disabled`);
      return new X402SolanaService(globalThis.fetch, null);
    }
  }

  getWrappedFetch(): typeof globalThis.fetch {
    return this.wrappedFetch;
  }

  isActive(): boolean {
    return this.config !== null && this.config.enabled;
  }

  getMaxPaymentUsd(): number {
    return this.config?.maxPaymentUsd ?? DEFAULT_MAX_PAYMENT_USD;
  }

  getPaymentStats(): { count: number; totalUsd: number; log: Array<{ timestamp: number; amountUsd: number; url: string }> } {
    return { count: this._paymentCount, totalUsd: this._totalPaidUsd, log: [...this._paymentLog] };
  }
}
