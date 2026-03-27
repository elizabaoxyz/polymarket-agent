import type { Plugin } from "@elizaos/core";
import { X402SolanaService } from "./service";

export const x402SolanaPlugin: Plugin = {
  name: "x402-solana",
  description: "x402 HTTP payment protocol — automatic USDC payments on Solana for 402-gated APIs",
  actions: [],
  providers: [],
  services: [X402SolanaService as unknown as Plugin["services"] extends (infer T)[] ? T : never],
};

export default x402SolanaPlugin;
