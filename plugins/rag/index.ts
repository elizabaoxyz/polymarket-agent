import type { Plugin } from "@elizaos/core";
import { RAGService } from "./service";

export const ragPlugin: Plugin = {
  name: "rag-chromadb",
  description: "RAG pipeline with ChromaDB — market indexing, news/search integration, and similarity scoring for LLM enrichment",
  actions: [],
  providers: [],
  services: [RAGService as unknown as Plugin["services"] extends (infer T)[] ? T : never],
};

export default ragPlugin;
