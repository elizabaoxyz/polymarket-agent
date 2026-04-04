import type { Plugin } from "@elizaos/core";
import { ConnectorsService } from "./service";

export const connectorsPlugin: Plugin = {
  name: "connectors",
  description: "News + Search connectors — NewsAPI articles, Tavily web search, context enrichment for LLM market analysis",
  actions: [],
  providers: [],
  services: [ConnectorsService as unknown as Plugin["services"] extends (infer T)[] ? T : never],
};

export default connectorsPlugin;
