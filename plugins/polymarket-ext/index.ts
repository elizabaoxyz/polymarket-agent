import type { Plugin } from "@elizaos/core";
import {
  cancelPolymarketOrder,
  cancelAllPolymarketOrders,
  getPolymarketOpenOrders,
  sellPolymarketPosition,
  getPolymarketPositions,
  getPolymarketTrades,
  getPolymarketPnl,
  placePolymarketOrder,
} from "./actions";
import { PolymarketExtService } from "./service";

export const polymarketExtPlugin: Plugin = {
  name: "polymarket-ext",
  description: "Extended Polymarket operations — cancel orders, positions, trades, PnL, and heartbeat",
  actions: [
    cancelPolymarketOrder,
    cancelAllPolymarketOrders,
    getPolymarketOpenOrders,
    sellPolymarketPosition,
    getPolymarketPositions,
    getPolymarketTrades,
    getPolymarketPnl,
    placePolymarketOrder,
  ],
  providers: [],
  services: [PolymarketExtService as unknown as Plugin["services"] extends (infer T)[] ? T : never],
};

export default polymarketExtPlugin;
