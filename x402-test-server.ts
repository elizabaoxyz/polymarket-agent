/**
 * x402 Payment-Gated API Server
 *
 * Real Solana mainnet USDC payments via x402 protocol.
 * Uses @x402/express for on-chain payment verification.
 *
 * Usage: bun run x402-test-server.ts
 *
 * Endpoints:
 *   GET /              → API info
 *   GET /health        → Server status + payment stats
 *   GET /prediction    → 402 Payment Required (0.01 USDC)
 *   GET /analysis      → 402 Payment Required (0.02 USDC)
 */

import { x402HTTPResourceServer } from "@x402/express";

const PORT = Number(process.env.PORT ?? process.env.X402_TEST_PORT ?? 4020);

// Your Solana wallet that receives payments
const PAY_TO = process.env.X402_PAY_TO ?? "5k363AzjJQZ7H2oRdX5q6E64F1Bc8SQt1nJXNyyUhoq";
const SOLANA_MAINNET = "solana:5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp";
const USDC_MAINNET = "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v";

let paymentCount = 0;

// Create x402 resource server
const server = x402HTTPResourceServer({
  port: PORT,
  payTo: PAY_TO,
  network: SOLANA_MAINNET,
  asset: USDC_MAINNET,
  routes: [
    {
      path: "/prediction",
      price: "$0.01",
      handler: (_req, res) => {
        paymentCount++;
        console.log(`x402: payment #${paymentCount} for /prediction — $0.01 USDC`);
        res.json({
          message: "x402 payment verified on Solana mainnet!",
          data: {
            prediction: "Bitcoin will reach $120k by end of 2026",
            confidence: 0.73,
            markets: ["BTC/USD", "ETH/USD", "SOL/USD"],
            timestamp: new Date().toISOString(),
          },
          payment: {
            id: `pay-${paymentCount}`,
            amount: "$0.01",
            network: "solana-mainnet",
            asset: "USDC",
          },
        });
      },
    },
    {
      path: "/analysis",
      price: "$0.02",
      handler: (_req, res) => {
        paymentCount++;
        console.log(`x402: payment #${paymentCount} for /analysis — $0.02 USDC`);
        res.json({
          message: "x402 payment verified on Solana mainnet!",
          data: {
            analysis: "Polymarket shows bullish sentiment on crypto markets",
            topMarkets: [
              { market: "Bitcoin above $100k", probability: 0.85 },
              { market: "ETH above $5k", probability: 0.42 },
              { market: "SOL above $300", probability: 0.31 },
            ],
            recommendation: "BUY YES on Bitcoin markets",
            timestamp: new Date().toISOString(),
          },
          payment: {
            id: `pay-${paymentCount}`,
            amount: "$0.02",
            network: "solana-mainnet",
            asset: "USDC",
          },
        });
      },
    },
  ],
});

// Add non-gated routes
server.app.get("/", (_req: unknown, res: { json: (data: unknown) => void }) => {
  res.json({
    name: "ElizaBAO x402 API",
    description: "Payment-gated prediction market analysis via x402 protocol",
    network: "Solana Mainnet",
    asset: "USDC",
    payTo: PAY_TO,
    endpoints: {
      "/prediction": "$0.01 USDC — get a market prediction",
      "/analysis": "$0.02 USDC — get full market analysis",
      "/health": "free — server status",
    },
    totalPayments: paymentCount,
  });
});

server.app.get("/health", (_req: unknown, res: { json: (data: unknown) => void }) => {
  res.json({
    status: "ok",
    payments: paymentCount,
    network: "solana-mainnet",
    payTo: PAY_TO,
  });
});

server.start();
console.log(`x402 API server: listening on http://localhost:${PORT}`);
console.log(`x402 API server: /prediction → $0.01 USDC | /analysis → $0.02 USDC`);
console.log(`x402 API server: payments go to ${PAY_TO} on Solana mainnet`);
