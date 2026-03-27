# x402 Solana Payment Integration Design

**Date:** 2026-03-27
**Status:** Approved
**Scope:** Transparent x402 HTTP payment layer using Solana/USDC for the trading agent

## Overview

Add a local plugin `plugins/x402-solana/` that wraps the global `fetch` with x402 payment handling. When the agent hits a 402 Payment Required response from any API, it automatically signs a USDC payment on Solana and retries the request. No action changes needed — all existing HTTP calls (Jupiter, Polymarket, external APIs) benefit transparently.

## Architecture

### Payment Flow

1. Agent makes an HTTP request via `fetch()`
2. If server returns 200, pass through normally
3. If server returns 402 with `PAYMENT-REQUIRED` header:
   a. Parse payment requirements (amount, token, destination)
   b. Check amount against per-request cap (`X402_MAX_PAYMENT_USD`, default $0.10)
   c. If over cap, throw error — do not pay
   d. Sign USDC payment using `ExactSvmScheme` from `@x402/svm`
   e. Retry request with `PAYMENT-SIGNATURE` header
   f. Log payment: `x402: paid $X USDC to <address> for <url>`
4. Return the response

### Plugin Structure

```
plugins/x402-solana/
  index.ts      — plugin export, registers service
  service.ts    — X402SolanaService: creates wrapped fetch, exposes on runtime
  types.ts      — config type, payment log type
```

### Dependencies

- `@x402/fetch` — wraps native fetch for automatic 402 handling
- `@x402/svm` — Solana payment scheme (ExactSvmScheme)
- `@x402/core` — x402Client, protocol types

### Environment Variables

| Variable | Required | Default | Description |
|----------|----------|---------|-------------|
| `SOLANA_PRIVATE_KEY` | Yes | — | Reuses existing Jupiter wallet (base58) |
| `X402_MAX_PAYMENT_USD` | No | `0.10` | Per-request payment cap in USD |
| `X402_ENABLED` | No | `true` | Set to `false` to disable x402 payments |

## Service (`service.ts`)

`X402SolanaService` implements the elizaOS ServiceClass interface:

- **`static start(runtime)`** — reads `SOLANA_PRIVATE_KEY` from runtime settings, creates `ExactSvmScheme` signer, creates `x402Client`, registers Solana scheme, wraps fetch via `wrapFetchWithPayment`, returns service instance
- **`getWrappedFetch()`** — returns the x402-aware fetch function
- **Per-request cap** — before signing any payment, checks amount against `X402_MAX_PAYMENT_USD`. If exceeded, throws `X402PaymentCapExceeded` error
- **Logging** — logs each payment: amount, destination, URL

## Integration (`runner.ts`)

After runtime initialization, if the x402 service started successfully, replace `globalThis.fetch` with the wrapped version. One line:

```typescript
globalThis.fetch = x402Service.getWrappedFetch();
```

This makes all HTTP calls (from any plugin, any action) x402-aware transparently.

## Plugin Index (`index.ts`)

Registers `X402SolanaService` in the plugin's `services` array. Graceful degradation: if `SOLANA_PRIVATE_KEY` is not set, the service returns a stub and fetch remains unwrapped.

## Testing

### Unit Tests (`plugins/x402-solana/__tests__/service.test.ts`)

- 402 response with payment headers → wrapped fetch retries with signed payment
- Per-request cap exceeded → throws, does not pay
- Normal 200 response → passes through unchanged
- Missing SOLANA_PRIVATE_KEY → service returns stub, fetch not wrapped

### Live Test (`x402-live.test.ts`)

- Uses x402 testnet facilitator at `https://x402.org/facilitator`
- Verifies end-to-end payment flow on Solana devnet
- Gated by `X402_LIVE_TESTS=1`

### Integration Test

- Plugin exports correct service
- Module imports resolve

## Constraints

- USDC is the only supported payment token (Solana mainnet mint: `EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v`)
- Requires USDC balance in the Solana wallet
- Per-request cap is a safety measure, not a budget — no session-level tracking
- x402 settlement has ~400ms latency on Solana (near-instant)
