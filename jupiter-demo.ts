/**
 * Jupiter Prediction Market Trading Agent
 *
 * Entry point for the AI-powered Jupiter prediction trading agent on Solana.
 * Uses elizaOS with plugin-solana and plugin-jupiter-prediction.
 *
 * Usage:
 *   JUPITER_API_KEY=key SOLANA_PRIVATE_KEY=key bun run jupiter-demo.ts chat
 */

// Suppress verbose logging
process.env.LOG_LEVEL = process.env.LOG_LEVEL || "fatal";

import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

import dotenv from "dotenv";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
dotenv.config({ path: path.join(__dirname, ".env") });

import { log } from "./log";
import { parseArgs } from "./lib";
import { jupiterChat, jupiterVerify } from "./jupiter-runner";

type Command = "help" | "verify" | "chat";

function usage(): void {
  const text = [
    "Jupiter Prediction Market Trading Agent",
    "",
    "An AI agent that trades on Jupiter Prediction Markets on Solana.",
    "",
    "Commands:",
    "  chat                   Start a chat session (default)",
    "  verify                 Validate API key and wallet",
    "",
    "Required Environment:",
    "  JUPITER_API_KEY        API key from portal.jup.ag",
    "  SOLANA_PRIVATE_KEY     Base58 Solana wallet private key",
    "  OPENAI_API_KEY         For AI decision making (or another LLM provider)",
    "",
    "Optional Environment:",
    "  SOLANA_RPC_URL         Solana RPC endpoint (default: mainnet)",
    "  PGLITE_DATA_DIR        Persistent database path (default: memory://)",
    "",
    "Flags:",
    "  --execute              Place real orders",
    "",
    "Examples:",
    "  bun run jupiter-demo.ts chat",
    "  bun run jupiter-demo.ts verify",
    "  bun run jupiter-demo.ts chat --execute",
  ].join("\n");
  log.info("jupiter", text);
}

async function main(): Promise<void> {
  const { command, options } = parseArgs(process.argv.slice(2));

  switch (command as Command) {
    case "help":
      usage();
      break;
    case "chat":
      await jupiterChat(options);
      break;
    case "verify":
      await jupiterVerify(options);
      break;
    default:
      usage();
  }
}

if (import.meta.main) {
  main().catch((err) => {
    const message = err instanceof Error ? err.message : String(err);
    const stack = err instanceof Error ? err.stack : undefined;

    if (process.stdout.isTTY) {
      process.stdout.write("\x1b[?1000l\x1b[?1006l\x1b[?1015l\x1b[?1007l\n");
    }

    log.error("jupiter", "\n" + "=".repeat(60));
    log.error("jupiter", "FATAL ERROR");
    log.error("jupiter", "=".repeat(60));
    log.error("jupiter", message);
    if (stack) {
      log.error("jupiter", "\nStack trace:");
      log.error("jupiter", stack);
    }
    log.error("jupiter", "=".repeat(60));
    process.exit(1);
  });
}
