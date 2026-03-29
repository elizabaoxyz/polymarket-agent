/**
 * x402 Test Server — returns 402 Payment Required for /protected
 * Accepts Solana mainnet USDC payments via x402 protocol.
 *
 * Usage: bun run x402-test-server.ts
 * Test:  curl http://localhost:4020/protected → 402
 *        Agent fetch with x402 → pays → 200
 */

const PORT = Number(process.env.X402_TEST_PORT ?? 4020);

// Your wallet that receives payments
const PAY_TO = "5k363AzjJQZ7H2oRdX5q6E64F1Bc8SQt1nJXNyyUhoq";
const USDC_MAINNET = "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v";
const SOLANA_MAINNET = "solana:5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp";

// Payment requirements — 0.01 USDC per request
const paymentRequirements = {
  x402Version: 2,
  error: "Payment required",
  resource: {
    url: `http://localhost:${PORT}/protected`,
    description: "x402-gated prediction market data",
    mimeType: "application/json",
  },
  accepts: [
    {
      scheme: "exact",
      network: SOLANA_MAINNET,
      amount: "10000", // 0.01 USDC (6 decimals)
      asset: USDC_MAINNET,
      payTo: PAY_TO,
      maxTimeoutSeconds: 300,
      extra: {
        name: "USDC",
        version: "1",
      },
    },
  ],
};

const paymentHeader = Buffer.from(JSON.stringify(paymentRequirements)).toString("base64");

let totalPayments = 0;
let totalRevenue = 0;

const server = Bun.serve({
  port: PORT,
  fetch(req) {
    const url = new URL(req.url);

    if (url.pathname === "/health") {
      return Response.json({ status: "ok", totalPayments, totalRevenue: `$${totalRevenue.toFixed(4)}` });
    }

    if (url.pathname === "/protected") {
      // Check for x402 payment header
      const paymentProof = req.headers.get("x-payment") || req.headers.get("x-payment-response");

      if (!paymentProof) {
        // Return 402 with payment requirements
        return new Response("{}", {
          status: 402,
          headers: {
            "content-type": "application/json",
            "payment-required": paymentHeader,
          },
        });
      }

      // Payment received — in production you'd verify the on-chain transaction
      // For demo purposes, accept any payment proof
      totalPayments++;
      totalRevenue += 0.01;
      console.log(`x402-test: payment #${totalPayments} received — total: $${totalRevenue.toFixed(4)}`);

      return Response.json({
        message: "Access granted via x402 payment!",
        data: {
          prediction: "Bitcoin will reach $120k by end of 2026",
          confidence: 0.73,
          source: "x402-gated analysis engine",
          paymentId: `pay-${totalPayments}`,
        },
      });
    }

    return Response.json({ endpoints: ["/protected", "/health"] });
  },
});

console.log(`x402-test-server: listening on http://localhost:${server.port}`);
console.log(`x402-test-server: GET /protected → 402 (requires x402 payment)`);
console.log(`x402-test-server: payment: 0.01 USDC on Solana mainnet to ${PAY_TO}`);
