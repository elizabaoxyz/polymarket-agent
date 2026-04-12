/**
 * Approve USDC spending for Polymarket on Polygon.
 *
 * Usage: bun run approve-usdc.ts [amount]
 *   amount: USDC amount to approve (default: unlimited)
 *   Example: bun run approve-usdc.ts 100
 */

import path from "node:path";
import { fileURLToPath } from "node:url";
import dotenv from "dotenv";
import { ethers } from "ethers";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.join(__dirname, ".env") });

// Polygon USDC (bridged) — used by Polymarket
const USDC_ADDRESS = "0x2791Bca1f2de4661ED88A30C99A7a9449Aa84174";
// Polymarket CTF Exchange contract
const CTF_EXCHANGE = "0x4bFb41d5B3570DeFd03C39a9A4D8dE6Bd8B8982E";
// Polymarket Neg Risk CTF Exchange
const NEG_RISK_EXCHANGE = "0xC5d563A36AE78145C45a50134d48A1215220f80a";

const ERC20_ABI = [
  "function approve(address spender, uint256 amount) returns (bool)",
  "function allowance(address owner, address spender) view returns (uint256)",
  "function balanceOf(address owner) view returns (uint256)",
  "function decimals() view returns (uint8)",
];

const UNLIMITED = ethers.MaxUint256;

async function main() {
  const privateKey = process.env.EVM_PRIVATE_KEY ?? process.env.POLYMARKET_PRIVATE_KEY;
  if (!privateKey) {
    console.error("Missing EVM_PRIVATE_KEY in .env");
    process.exit(1);
  }

  const rpcUrl = process.env.POLYGON_RPC_URL ?? "https://polygon-bor-rpc.publicnode.com";
  const provider = new ethers.JsonRpcProvider(rpcUrl);
  const wallet = new ethers.Wallet(privateKey, provider);
  const usdc = new ethers.Contract(USDC_ADDRESS, ERC20_ABI, wallet);

  const decimals = await usdc.decimals();
  const balance = await usdc.balanceOf(wallet.address);
  const currentAllowanceCTF = await usdc.allowance(wallet.address, CTF_EXCHANGE);
  const currentAllowanceNeg = await usdc.allowance(wallet.address, NEG_RISK_EXCHANGE);

  console.log(`Wallet: ${wallet.address}`);
  console.log(`USDC Balance: ${ethers.formatUnits(balance, decimals)} USDC`);
  console.log(
    `Current Allowance (CTF Exchange): ${ethers.formatUnits(currentAllowanceCTF, decimals)} USDC`,
  );
  console.log(
    `Current Allowance (Neg Risk Exchange): ${ethers.formatUnits(currentAllowanceNeg, decimals)} USDC`,
  );

  const amountArg = process.argv[2];
  const approveAmount = amountArg ? ethers.parseUnits(amountArg, decimals) : UNLIMITED;
  const label = amountArg ? `${amountArg} USDC` : "unlimited";

  console.log(`\nApproving ${label} for CTF Exchange (${CTF_EXCHANGE})...`);
  const tx1 = await usdc.approve(CTF_EXCHANGE, approveAmount);
  console.log(`TX sent: ${tx1.hash}`);
  await tx1.wait();
  console.log("Confirmed.");

  console.log(`\nApproving ${label} for Neg Risk Exchange (${NEG_RISK_EXCHANGE})...`);
  const tx2 = await usdc.approve(NEG_RISK_EXCHANGE, approveAmount);
  console.log(`TX sent: ${tx2.hash}`);
  await tx2.wait();
  console.log("Confirmed.");

  const newAllowanceCTF = await usdc.allowance(wallet.address, CTF_EXCHANGE);
  const newAllowanceNeg = await usdc.allowance(wallet.address, NEG_RISK_EXCHANGE);
  console.log(
    `\nNew Allowance (CTF Exchange): ${ethers.formatUnits(newAllowanceCTF, decimals)} USDC`,
  );
  console.log(
    `New Allowance (Neg Risk Exchange): ${ethers.formatUnits(newAllowanceNeg, decimals)} USDC`,
  );
  console.log("\nDone! You can now trade on Polymarket.");
}

main().catch((err) => {
  console.error("Error:", err.message);
  process.exit(1);
});
