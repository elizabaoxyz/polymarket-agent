export type X402Config = {
  readonly solanaPrivateKey: string;
  readonly maxPaymentUsd: number;
  readonly enabled: boolean;
  readonly rpcUrl?: string;
};

export const X402_SERVICE_TYPE = "X402_SOLANA";

export const DEFAULT_MAX_PAYMENT_USD = 0.10;

export class X402PaymentCapExceeded extends Error {
  readonly requestedUsd: number;
  readonly capUsd: number;

  constructor(requestedUsd: number, capUsd: number) {
    super(
      `x402: payment of $${requestedUsd.toFixed(4)} exceeds cap of $${capUsd.toFixed(2)}. ` +
      `Increase X402_MAX_PAYMENT_USD or disable the cap.`
    );
    this.name = "X402PaymentCapExceeded";
    this.requestedUsd = requestedUsd;
    this.capUsd = capUsd;
  }
}
