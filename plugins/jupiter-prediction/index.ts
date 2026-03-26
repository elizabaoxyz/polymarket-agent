import type { Plugin } from "@elizaos/core";
import {
  scanJupiterMarkets,
  placeJupiterBet,
  checkJupiterPositions,
  claimJupiterWinnings,
} from "./actions";

export const jupiterPredictionPlugin: Plugin = {
  name: "jupiter-prediction",
  description: "Jupiter Prediction Markets — scan, trade, and manage positions on Solana",
  actions: [
    scanJupiterMarkets,
    placeJupiterBet,
    checkJupiterPositions,
    claimJupiterWinnings,
  ],
  providers: [],
  services: [],
};

export default jupiterPredictionPlugin;
