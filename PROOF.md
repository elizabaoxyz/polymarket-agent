# ElizaBAO — Technical Proof of Implementation

Evidence of **x402 payment gating**, **Solana wallet authentication**, and **on-chain accounting** in the live ElizaBAO autonomous trading agent.

**Live Application**: [elizabao.ai](https://elizabao.ai)  
**GitHub**: [github.com/elizabaoxyz/polymarket-agent](https://github.com/elizabaoxyz/polymarket-agent)  
**Twitter**: [@elizabao_ai](https://x.com/elizabao_ai)

---

## 1. x402 Payment Gating

### What It Does

ElizaBAO implements the [x402 payment protocol](https://www.x402.org/) on Solana. When the autonomous agent calls an API that returns `HTTP 402 Payment Required`, x402 automatically:
1. Parses the payment requirements from the `Payment-Required` header
2. Signs a Solana USDC transaction using the agent's keypair
3. Sends the payment proof in the `x-payment` header
4. Retries the request — server verifies on-chain payment and returns data

### Code Evidence

#### x402 Service — Wraps `globalThis.fetch`

**File**: [`plugins/x402-solana/service.ts`](https://github.com/elizabaoxyz/polymarket-agent/blob/main/plugins/x402-solana/service.ts)

```typescript
// Lines 1-3: x402 SDK imports
import { wrapFetchWithPayment, x402Client } from "@x402/fetch";
import { ExactSvmScheme } from "@x402/svm";
import { createKeyPairSignerFromBytes } from "@solana/kit";

// Lines 68-82: Register Solana mainnet + devnet payment schemes
const svmSchemeMainnet = new ExactSvmScheme(signer, rpcUrl ? { rpcUrl } : undefined);
const svmSchemeDevnet = new ExactSvmScheme(signer, { rpcUrl: "https://api.devnet.solana.com" });
const client = new x402Client()
  .register(SOLANA_MAINNET, svmSchemeMainnet)
  .register(SOLANA_DEVNET, svmSchemeDevnet)
  .onBeforePaymentCreation(async (...args) => {
    // Validate payment cap ($0.10 default)
    if (usdAmount > maxPaymentUsd) {
      throw new X402PaymentCapExceeded(usdAmount, maxPaymentUsd);
    }
    // Track payment
    svc._paymentCount++;
    svc._totalPaidUsd += usdAmount;
  });

// Line 113: Wrap fetch globally — ALL HTTP calls now auto-pay 402s
const wrappedFetch = wrapFetchWithPayment(globalThis.fetch, client);
```

#### x402 Activation in Runtime

**File**: [`ws-server.ts`](https://github.com/elizabaoxyz/polymarket-agent/blob/main/ws-server.ts) — Lines 180-183

```typescript
const x402Svc = await runtime.getServiceLoadPromise(X402_SERVICE_TYPE);
if (x402Svc && x402Svc.isActive()) {
  globalThis.fetch = x402Svc.getWrappedFetch(); // ALL fetch() calls now x402-enabled
}
```

#### x402 Payment-Gated API Server

**File**: [`x402-test-server.ts`](https://github.com/elizabaoxyz/polymarket-agent/blob/main/x402-test-server.ts)

Deployed on Railway. Returns `HTTP 402` with Solana USDC payment requirements:

```typescript
// Lines 75-88: Returns 402 with payment requirements
return new Response("{}", {
  status: 402,
  headers: {
    "Payment-Required": makePaymentRequirements(url, desc, amount),
  },
});

// Payment requirements specify:
// - network: "solana:5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp" (mainnet)
// - asset: USDC mint address
// - amount: 10000 ($0.01) or 20000 ($0.02) micro-USDC
// - payTo: Solana wallet address
```

#### x402 in Autonomy Loop

**File**: [`autonomy.ts`](https://github.com/elizabaoxyz/polymarket-agent/blob/main/autonomy.ts) — Lines 900-906

Every Jupiter cycle, the agent pays for market analysis:
```typescript
const x402ApiUrl = process.env.X402_API_URL;
if (x402ApiUrl && jupScored.length > 0) {
  callbacks.log("[x402] Paying for market analysis on Solana...");
  await fetch(`${x402ApiUrl}/prediction`); // Auto-pays via x402
}
```

#### x402 Dashboard Widget

**File**: [`web/components/x402-modal.tsx`](https://github.com/elizabaoxyz/polymarket-agent/blob/main/web/components/x402-modal.tsx)

Shows live payment count and total USDC spent on the web dashboard.

#### x402 Dependencies

**File**: [`package.json`](https://github.com/elizabaoxyz/polymarket-agent/blob/main/package.json)

```json
"@x402/core": "^2.8.0",
"@x402/express": "^2.8.0",
"@x402/fetch": "^2.8.0",
"@x402/svm": "^2.8.0"
```

### x402 Architecture

```
Agent (Bun)                x402 API (Railway)           Solana Mainnet
───────────                ──────────────────           ──────────────
                                                        
GET /prediction ──────────▶ 402 Payment Required        
                            Payment-Required: {         
                              network: solana-mainnet   
                              amount: 10000 ($0.01)     
                              asset: USDC               
                              payTo: 5k363A...          
                            }                           
                                                        
x402Client detects 402                                  
ExactSvmScheme signs tx ──────────────────────────────▶ USDC Transfer
                                                        $0.01 to payTo
GET /prediction ──────────▶                             
x-payment: <signed proof>   Verify on-chain ◀──────────┘
                            ✅ 200 OK                   
                            { prediction: "..." }       
◀─────────────────────────                              
```

---

## 2. Solana Wallet Authentication

### What It Does

The agent authenticates on Solana using an Ed25519 keypair derived from the `SOLANA_PRIVATE_KEY` environment variable (Base58). This keypair is used for:
1. **Signing prediction market orders** (Jupiter API requires `ownerPubkey`)
2. **Signing x402 USDC payment transactions** (Solana on-chain transfers)
3. **Querying positions** (positions are tied to the wallet's public key)

### Code Evidence

#### Centralized Wallet Management

**File**: [`solana-wallet.ts`](https://github.com/elizabaoxyz/polymarket-agent/blob/main/solana-wallet.ts)

```typescript
import { Connection, Keypair, PublicKey } from "@solana/web3.js";
import bs58 from "bs58";

// Decode Base58 private key → Ed25519 Keypair (cached per process)
export function getSolanaKeypair(): Keypair | null {
  const solKey = process.env.SOLANA_PRIVATE_KEY?.trim();
  if (!solKey) return null;
  _cachedKeypair = Keypair.fromSecretKey(bs58.decode(solKey));
  return _cachedKeypair;
}
```

#### Jupiter Order Signing (Solana Transaction)

**File**: [`plugins/jupiter-prediction/service.ts`](https://github.com/elizabaoxyz/polymarket-agent/blob/main/plugins/jupiter-prediction/service.ts) — Lines 62-79

```typescript
// Sign Solana VersionedTransaction with the agent's keypair
async signAndSubmit(unsignedTxBase64: string): Promise<string> {
  const txBuffer = Buffer.from(unsignedTxBase64, "base64");
  const tx = VersionedTransaction.deserialize(txBuffer);
  tx.sign([this.keypair]); // Ed25519 signature
  const rawTx = tx.serialize();
  const signature = await this.connection.sendRawTransaction(rawTx);
  await this.connection.confirmTransaction(signature, "confirmed");
  return signature;
}
```

#### x402 Payment Signing (Solana USDC Transfer)

**File**: [`plugins/x402-solana/service.ts`](https://github.com/elizabaoxyz/polymarket-agent/blob/main/plugins/x402-solana/service.ts) — Lines 61-67

```typescript
// Create Ed25519 signer from private key for x402 payments
const secretKey = bs58.decode(solanaPrivateKey);
const signer = await createKeyPairSignerFromBytes(secretKey);

// Register with x402 — signs USDC transfer transactions on 402 responses
const svmSchemeMainnet = new ExactSvmScheme(signer, rpcUrl ? { rpcUrl } : undefined);
```

#### Jupiter API Authentication

**File**: [`plugins/jupiter-prediction/api.ts`](https://github.com/elizabaoxyz/polymarket-agent/blob/main/plugins/jupiter-prediction/api.ts) — Lines 36-40

```typescript
// Every Jupiter API call includes the API key
const headers: Record<string, string> = {
  "x-api-key": this.apiKey,      // Jupiter API key (from portal.jup.ag)
  "content-type": "application/json",
};
```

### Solana Auth Flow

```
Environment Variable                  Jupiter Prediction API
────────────────────                  ──────────────────────

SOLANA_PRIVATE_KEY (Base58)           
        │                             
        ▼                             
bs58.decode() → Keypair              
        │                             
        ├──▶ ownerPubkey ────────────▶ GET /positions?ownerPubkey=...
        │                             POST /orders { ownerPubkey, ... }
        │                             DELETE /positions/{pubkey}
        │                             
        └──▶ tx.sign([keypair]) ────▶ Signed VersionedTransaction
                                      sendRawTransaction() → Solana RPC
                                      confirmTransaction()
```

### Polymarket Wallet Authentication (EVM/Polygon)

**File**: [`plugins/polymarket-ext/clob-client.ts`](https://github.com/elizabaoxyz/polymarket-agent/blob/main/plugins/polymarket-ext/clob-client.ts) — Lines 30-44

```typescript
// HMAC-SHA256 L2 authentication for every CLOB API call
private buildHeaders(method: string, path: string, body?: string): Record<string, string> {
  const timestamp = String(Math.floor(Date.now() / 1000));
  const message = timestamp + method + path + (body ?? "");
  const sig = createHmac("sha256", Buffer.from(this.config.secret, "base64"))
    .update(message)
    .digest("base64")
    .replace(/\+/g, "-").replace(/\//g, "_"); // URL-safe base64

  return {
    "POLY_ADDRESS": this.config.address,     // EOA address
    "POLY_API_KEY": this.config.apiKey,       // CLOB API key
    "POLY_PASSPHRASE": this.config.passphrase,
    "POLY_TIMESTAMP": timestamp,
    "POLY_SIGNATURE": sig,                    // HMAC signature
  };
}
```

---

## 3. On-Chain Accounting

### What It Does

ElizaBAO tracks all financial activity across two chains:

| Chain | Asset | Tracked |
|-------|-------|---------|
| **Polygon** | USDC | Balance, positions, trades, PnL, order fills |
| **Solana** | USDC + JupUSD | Balance, positions, PnL, x402 payments |

### Code Evidence

#### Portfolio Status (Cross-Chain)

**File**: [`portfolio.ts`](https://github.com/elizabaoxyz/polymarket-agent/blob/main/portfolio.ts)

Fetches balance/positions from both chains every status request:

```typescript
export async function getPortfolioStatus(runtime: AgentRuntime): Promise<PortfolioStatus> {
  const [positions, trades, balance, jupiterPositions, solanaBalance] = await Promise.all([
    svc.data.getPositions(svc.walletAddress),          // Polymarket Data API
    svc.data.getTrades(svc.walletAddress, { limit: 20 }), // Polymarket trades
    fetchPolymarketBalance(svc),                        // CLOB API /balance-allowance
    fetchJupiterPositions(),                             // Jupiter API /positions
    getCachedSolanaBalance(),                            // Solana RPC (USDC + JupUSD)
  ]);
  // + x402 payment tracking
}
```

#### Polymarket Balance (On-Chain via CLOB)

**File**: [`portfolio.ts`](https://github.com/elizabaoxyz/polymarket-agent/blob/main/portfolio.ts) — Lines 54-73

```typescript
// Authenticated balance check via CLOB API
async function fetchPolymarketBalance(svc: PolymarketExtService): Promise<number> {
  const res = await fetch(
    `${svc.clob.config.baseUrl}/balance-allowance?asset_type=COLLATERAL&signature_type=${sigType}`,
    { headers: { POLY_ADDRESS, POLY_API_KEY, POLY_PASSPHRASE, POLY_TIMESTAMP, POLY_SIGNATURE } },
  );
  const data = await res.json();
  return Number(data.balance ?? 0) / 1_000_000; // micro-USDC → USD
}
```

#### Solana Balance (On-Chain via RPC)

**File**: [`solana-wallet.ts`](https://github.com/elizabaoxyz/polymarket-agent/blob/main/solana-wallet.ts) — Lines 66-92

```typescript
// Direct Solana RPC calls for USDC + JupUSD token balances
export async function getCachedSolanaBalance(): Promise<number> {
  const conn = getSolanaConnection();
  // USDC: EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v
  const usdcAccounts = await conn.getTokenAccountsByOwner(kp.publicKey, { mint: USDC_MINT });
  total += Number(info.value.uiAmount ?? 0);
  // JupUSD: JuprjznTrTSp2UFa3ZBUFgwdAmtZCq4MQCwysN55USD
  const jupAccounts = await conn.getTokenAccountsByOwner(kp.publicKey, { mint: JUPUSD_MINT });
  total += Number(info.value.uiAmount ?? 0);
}
```

#### Position Tracking with PnL

**File**: [`plugins/polymarket-ext/data-client.ts`](https://github.com/elizabaoxyz/polymarket-agent/blob/main/plugins/polymarket-ext/data-client.ts)

```typescript
// Polymarket positions with full PnL accounting
async getPositions(address: string): Promise<Position[]>
// Each position includes: avgPrice, currentValue, cashPnl, percentPnl, realizedPnl

// Trade history with on-chain tx hashes
async getTrades(address: string): Promise<Trade[]>
// Each trade includes: transactionHash, usdcSize, price, side, timestamp
```

#### x402 Payment Accounting

**File**: [`plugins/x402-solana/service.ts`](https://github.com/elizabaoxyz/polymarket-agent/blob/main/plugins/x402-solana/service.ts) — Lines 125-130

```typescript
getPaymentStats(): { count: number; totalUsd: number; log: Array<{ timestamp: number; amountUsd: number; url: string }> } {
  return { count: this._paymentCount, totalUsd: this._totalPaidUsd, log: [...this._paymentLog] };
}
```

#### Autonomy Loop Accounting

**File**: [`autonomy.ts`](https://github.com/elizabaoxyz/polymarket-agent/blob/main/autonomy.ts)

Every 60-second cycle logs:
```
[BALANCE] Polygon: $2.55 | Solana: $92.17 (USDC+JupUSD)
[SELL:POLYMARKET] ✅ FILLED: "Will X happen?" — 10 shares @ $0.45 ($4.50)
[BUY:POLYMARKET] "Market Y" (YES:$0.49, score:0.80, $3.00, 218d left)
[AUTONOMY] x402: 5 payments | positions: 12/50
```

### Accounting Architecture

```
┌──────────────────────────────────────────────────────────┐
│                  ON-CHAIN DATA SOURCES                    │
│                                                          │
│  POLYGON                        SOLANA                    │
│  ────────                       ──────                    │
│  Polymarket CLOB API            Solana RPC (mainnet)      │
│  ├─ /balance-allowance          ├─ getTokenAccountsByOwner│
│  │  (USDC balance)              │  (USDC balance)         │
│  ├─ /data/orders                │  (JupUSD balance)       │
│  │  (open orders)               │                         │
│  └─ order fills → tx hashes     Jupiter Prediction API    │
│                                 ├─ /positions             │
│  Polymarket Data API            │  (PnL per position)     │
│  ├─ /positions                  └─ /orders                │
│  │  (PnL, unrealized)             (signed transactions)   │
│  ├─ /activity                                             │
│  │  (trade history + tx)        x402 Payment Log          │
│  └─ /value                      ├─ payment count          │
│     (portfolio value)           ├─ total USD spent        │
│                                 └─ timestamped entries    │
└──────────────────────────────────────────────────────────┘
                          │
                          ▼
┌──────────────────────────────────────────────────────────┐
│                   WEB DASHBOARD                           │
│                                                          │
│  Left Sidebar          Center Chat        Header          │
│  ├─ Polygon USDC       ├─ Trade logs      ├─ [ALL] toggle│
│  ├─ Solana USDC        ├─ Sell confirms   ├─ [POLY]      │
│  ├─ Position count     ├─ Buy confirms    ├─ [JUP+x402]  │
│  └─ Live feed          └─ PnL updates     └─ x402 badge  │
└──────────────────────────────────────────────────────────┘
```

---

## 4. Git History (198 commits)

Key commits showing progressive implementation:

| Commit | Description |
|--------|-------------|
| `30bdaed` | `docs: add x402 Solana payment integration design spec` |
| `390ef6a` | `feat: add x402 payment protocol dependencies` |
| `a3e49bb` | `feat: add RAG pipeline (ChromaDB), News/Search connectors` |
| `d984a92` | `feat: wire RAG + Connectors into autonomy loop` |
| `a6dd282` | `refactor: break up God file, add auth/retry/mutex/config` |
| `713244c` | `fix: bypass LLM for Polymarket sells, use direct CLOB API` |
| `e0b39ed` | `fix: Polymarket sells use position curPrice fallback` |
| `6c80409` | `feat: run both platforms every cycle` |
| `ada64d5` | `fix: run Polymarket + Jupiter in parallel, prevent cycle overlap` |
| `96ddc75` | `feat: major autonomy upgrades — direct buys, P&L, spend limits` |
| `75dfaf0` | `feat: per-platform autonomy toggles — ALL, POLY, JUP+x402` |
| `5ee1cbb` | `feat: Jupiter position review when 0 new markets` |

Full history: `git log --oneline` (198 commits from `f0553d4 init new repo` to present)

---

## 5. Deployed Services

| Service | URL | Purpose |
|---------|-----|---------|
| **Web Dashboard** | [elizabao.ai](https://elizabao.ai) | Next.js frontend with live portfolio |
| **WS Server** | Railway (internal) | Bun WebSocket + elizaOS runtime |
| **x402 API** | Railway (internal) | Payment-gated prediction endpoints |

All three deployed from the same GitHub repo via Railway auto-deploy.

---

## 6. Dependencies Proving Integration

From [`package.json`](https://github.com/elizabaoxyz/polymarket-agent/blob/main/package.json):

```json
{
  "@x402/core": "^2.8.0",           // x402 protocol core
  "@x402/express": "^2.8.0",        // x402 Express middleware
  "@x402/fetch": "^2.8.0",          // x402 fetch wrapper (auto-pay 402s)
  "@x402/svm": "^2.8.0",            // x402 Solana payment scheme
  "@solana/kit": "^6.5.0",          // Solana key management
  "@elizaos/plugin-solana": "^2.0.0-alpha.5",  // Solana plugin
  "@polymarket/clob-client": "^5.2.0",          // Polymarket CLOB
  "ethers": "^6.16.0"               // EVM/Polygon wallet
}
```
