/**
 * Portfolio status fetching — extracted from ws-server.ts.
 * Centralizes balance, position, and trade data retrieval across Polymarket and Jupiter.
 */

import type { AgentRuntime } from "@elizaos/core";
import { PolymarketExtService } from "./plugins/polymarket-ext/service";
import { POLYMARKET_EXT_SERVICE_TYPE } from "./plugins/polymarket-ext/types";
import { X402SolanaService } from "./plugins/x402-solana/service";
import { X402_SERVICE_TYPE } from "./plugins/x402-solana/types";
import { getCachedSolanaBalance, getSolanaKeypair } from "./solana-wallet";
import { withRetry } from "./retry";

export type JupiterPosition = {
  marketId: string;
  isYes: boolean;
  contracts: string;
  sizeUsd: string;
  valueUsd: string;
  avgPriceUsd: string;
  markPriceUsd: string;
  pnlUsd: string;
  pnlUsdPercent: number;
  eventTitle: string;
  marketTitle: string;
};

export type X402Status = {
  active: boolean;
  payments: number;
  totalUsd: number;
};

export type PortfolioStatus = {
  balance: number;
  solanaBalance: number;
  positions: unknown[];
  trades: unknown[];
  jupiterPositions: JupiterPosition[];
  x402: X402Status;
};

/**
 * Fetch the Polymarket USDC balance via CLOB API.
 */
async function fetchPolymarketBalance(svc: PolymarketExtService): Promise<number> {
  if (!svc.clob) return 0;
  const { createHmac } = await import("node:crypto");
  const address = svc.clob.config.address;
  const secret = svc.clob.config.secret;
  const ts = String(Math.floor(Date.now() / 1000));
  const sig = createHmac("sha256", Buffer.from(secret, "base64"))
    .update(`${ts}GET/balance-allowance`)
    .digest("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_");
  const sigType = process.env.POLYMARKET_SIGNATURE_TYPE ?? "1";
  const res = await fetch(
    `${svc.clob.config.baseUrl}/balance-allowance?asset_type=COLLATERAL&signature_type=${sigType}`,
    {
      headers: {
        POLY_ADDRESS: address,
        POLY_API_KEY: svc.clob.config.apiKey,
        POLY_PASSPHRASE: svc.clob.config.passphrase,
        POLY_TIMESTAMP: ts,
        POLY_SIGNATURE: sig,
      },
    },
  );
  const data = await res.json();
  return Number(data.balance ?? 0) / 1_000_000;
}

/**
 * Fetch Jupiter prediction market positions via API.
 */
async function fetchJupiterPositions(): Promise<JupiterPosition[]> {
  const jupApiKey = process.env.JUPITER_API_KEY?.trim();
  const kp = getSolanaKeypair();
  if (!jupApiKey || !kp) return [];

  const posRes = await fetch(
    `https://api.jup.ag/prediction/v1/positions?ownerPubkey=${kp.publicKey.toBase58()}`,
    { headers: { "x-api-key": jupApiKey } },
  );
  if (!posRes.ok) return [];

  const jupData = await posRes.json();
  return (jupData.data ?? []).map((p: Record<string, unknown>) => ({
    marketId: p.marketId,
    isYes: p.isYes,
    contracts: p.contracts,
    sizeUsd: p.sizeUsd,
    valueUsd: p.valueUsd,
    avgPriceUsd: p.avgPriceUsd,
    markPriceUsd: p.markPriceUsd,
    pnlUsd: p.pnlUsd,
    pnlUsdPercent: p.pnlUsdPercent,
    eventTitle: (p.eventMetadata as Record<string, string>)?.title ?? "",
    marketTitle: (p.marketMetadata as Record<string, string>)?.title ?? "",
  }));
}

/**
 * Get the full portfolio status across all platforms.
 * Uses retry logic for transient API failures.
 */
export async function getPortfolioStatus(runtime: AgentRuntime): Promise<PortfolioStatus> {
  const empty: PortfolioStatus = {
    balance: 0,
    solanaBalance: 0,
    positions: [],
    trades: [],
    jupiterPositions: [],
    x402: { active: false, payments: 0, totalUsd: 0 },
  };

  try {
    const svc = (await runtime.getServiceLoadPromise(
      POLYMARKET_EXT_SERVICE_TYPE,
    )) as unknown as PolymarketExtService;
    if (!svc || !svc.walletAddress) return empty;

    // Fetch all data concurrently with retry
    const [positions, trades, balance, jupiterPositions, solanaBalance] = await Promise.all([
      withRetry(() => svc.data.getPositions(svc.walletAddress), { label: "positions" }).catch(
        () => [],
      ),
      withRetry(() => svc.data.getTrades(svc.walletAddress, { limit: 20 }), {
        label: "trades",
      }).catch(() => []),
      svc.clob
        ? withRetry(() => fetchPolymarketBalance(svc), { label: "poly-balance" }).catch(() => 0)
        : Promise.resolve(0),
      withRetry(fetchJupiterPositions, { label: "jupiter-positions" }).catch(() => []),
      getCachedSolanaBalance(),
    ]);

    // x402 payment stats
    let x402: X402Status = { active: false, payments: 0, totalUsd: 0 };
    try {
      const x402Svc = (await runtime.getServiceLoadPromise(X402_SERVICE_TYPE)) as unknown as X402SolanaService | null;
      if (x402Svc) {
        const stats = x402Svc.getPaymentStats();
        x402 = { active: x402Svc.isActive(), payments: stats.count, totalUsd: stats.totalUsd };
      }
    } catch {}

    return { balance, solanaBalance, positions, trades, jupiterPositions, x402 };
  } catch {
    return empty;
  }
}
