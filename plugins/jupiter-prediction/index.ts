import type { Plugin } from "@elizaos/core";
import {
  scanJupiterMarkets,
  placeJupiterBet,
  checkJupiterPositions,
  sellJupiterPosition,
  claimJupiterWinnings,
} from "./actions";
import { JupiterPredictionService } from "./service";

export const jupiterPredictionPlugin: Plugin = {
  name: "jupiter-prediction",
  description: "Jupiter Prediction Markets — scan, trade, and manage positions on Solana",
  actions: [
    scanJupiterMarkets,
    placeJupiterBet,
    checkJupiterPositions,
    sellJupiterPosition,
    claimJupiterWinnings,
  ],
  providers: [],
  services: [JupiterPredictionService as unknown as Plugin["services"] extends (infer T)[] ? T : never],
};

export default jupiterPredictionPlugin;
