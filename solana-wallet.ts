/**
 * Centralized Solana wallet and balance utilities.
 * Eliminates duplicate key decoding and RPC calls scattered across the codebase.
 */
import { log } from "./log";

import { Connection, Keypair, PublicKey } from "@solana/web3.js";
import bs58 from "bs58";

const USDC_MINT = new PublicKey("EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v");
const JUPUSD_MINT = new PublicKey("JuprjznTrTSp2UFa3ZBUFgwdAmtZCq4MQCwysN55USD");
const DEFAULT_RPC = "https://api.mainnet-beta.solana.com";

let _cachedKeypair: Keypair | null = null;
let _cachedPrivateKey: string | null = null;

/**
 * Resolve the Solana keypair from environment.
 * Caches the result so the key is only decoded once per process.
 * Returns null if SOLANA_PRIVATE_KEY is not set.
 */
export function getSolanaKeypair(): Keypair | null {
  const solKey = process.env.SOLANA_PRIVATE_KEY?.trim();
  if (!solKey) return null;

  // Return cached if key hasn't changed
  if (_cachedKeypair && _cachedPrivateKey === solKey) return _cachedKeypair;

  try {
    _cachedKeypair = Keypair.fromSecretKey(bs58.decode(solKey));
    _cachedPrivateKey = solKey;
    return _cachedKeypair;
  } catch {
    log.warn("solana-wallet", "failed to decode SOLANA_PRIVATE_KEY");
    return null;
  }
}

/**
 * Get the Solana public key string from environment.
 * Returns null if SOLANA_PRIVATE_KEY is not set.
 */
export function getSolanaPublicKey(): string | null {
  const kp = getSolanaKeypair();
  return kp ? kp.publicKey.toBase58() : null;
}

/**
 * Create a Solana Connection using the configured RPC URL.
 */
export function getSolanaConnection(): Connection {
  const rpcUrl = process.env.SOLANA_RPC_URL?.trim() || DEFAULT_RPC;
  return new Connection(rpcUrl, "confirmed");
}

// --- Balance cache ---

export type SolanaBalanceBreakdown = {
  total: number;
  usdc: number;
  jupUsd: number;
};

let _balanceCache: SolanaBalanceBreakdown & { fetchedAt: number } = { total: 0, usdc: 0, jupUsd: 0, fetchedAt: 0 };
const BALANCE_CACHE_TTL = 60_000; // 60 seconds

/**
 * Get the USDC + JupUSD balance breakdown for the configured Solana wallet.
 * Cached for 60 seconds to avoid RPC rate limits.
 */
export async function getCachedSolanaBalanceBreakdown(): Promise<SolanaBalanceBreakdown> {
  if (Date.now() - _balanceCache.fetchedAt < BALANCE_CACHE_TTL) {
    return { total: _balanceCache.total, usdc: _balanceCache.usdc, jupUsd: _balanceCache.jupUsd };
  }

  const kp = getSolanaKeypair();
  if (!kp) return { total: 0, usdc: 0, jupUsd: 0 };

  try {
    const conn = getSolanaConnection();
    let usdc = 0;
    let jupUsd = 0;

    // Check USDC balance
    const usdcAccounts = await conn.getTokenAccountsByOwner(kp.publicKey, { mint: USDC_MINT });
    if (usdcAccounts.value.length > 0 && usdcAccounts.value[0]) {
      const info = await conn.getTokenAccountBalance(usdcAccounts.value[0].pubkey);
      usdc = Number(info.value.uiAmount ?? 0);
    }

    // Check JupUSD balance (Jupiter's stablecoin — returned when selling positions)
    const jupAccounts = await conn.getTokenAccountsByOwner(kp.publicKey, { mint: JUPUSD_MINT });
    if (jupAccounts.value.length > 0 && jupAccounts.value[0]) {
      const info = await conn.getTokenAccountBalance(jupAccounts.value[0].pubkey);
      jupUsd = Number(info.value.uiAmount ?? 0);
    }

    const total = usdc + jupUsd;
    _balanceCache = { total, usdc, jupUsd, fetchedAt: Date.now() };
    return { total, usdc, jupUsd };
  } catch {
    return { total: _balanceCache.total, usdc: _balanceCache.usdc, jupUsd: _balanceCache.jupUsd };
  }
}

/**
 * Get the combined USDC + JupUSD balance (backwards-compatible wrapper).
 */
export async function getCachedSolanaBalance(): Promise<number> {
  const { total } = await getCachedSolanaBalanceBreakdown();
  return total;
}

/**
 * Invalidate the balance cache (e.g. after a trade).
 */
export function invalidateBalanceCache(): void {
  _balanceCache.fetchedAt = 0;
}
