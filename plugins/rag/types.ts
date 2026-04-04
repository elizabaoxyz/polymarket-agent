import { z } from "zod";

// --- Service type constant ---

export const RAG_SERVICE_TYPE = "RAG_CHROMA";

// --- ChromaDB collection names ---

export const COLLECTIONS = {
  POLYMARKET_MARKETS: "polymarket_markets",
  JUPITER_MARKETS: "jupiter_markets",
  NEWS_ARTICLES: "news_articles",
  SEARCH_RESULTS: "search_results",
} as const;

// --- Market document for indexing ---

export type MarketDocument = {
  readonly id: string;
  readonly question: string;
  readonly description: string;
  readonly outcomes: string;
  readonly outcomePrices: string;
  readonly volume: number;
  readonly platform: "polymarket" | "jupiter";
  readonly metadata: Record<string, unknown>;
};

// --- News article document ---

export type NewsDocument = {
  readonly id: string;
  readonly title: string;
  readonly content: string;
  readonly source: string;
  readonly url: string;
  readonly publishedAt: string;
  readonly keywords: string;
};

// --- Search result document ---

export type SearchDocument = {
  readonly id: string;
  readonly title: string;
  readonly content: string;
  readonly url: string;
  readonly query: string;
};

// --- Similarity search result ---

export type SimilarityResult = {
  readonly id: string;
  readonly content: string;
  readonly score: number;
  readonly metadata: Record<string, unknown>;
};

// --- RAG enriched context ---

export type EnrichedContext = {
  readonly similarMarkets: SimilarityResult[];
  readonly relevantNews: SimilarityResult[];
  readonly searchContext: string;
};

// --- Embedding response (OpenAI) ---

export const EmbeddingResponseSchema = z.object({
  object: z.string(),
  data: z.array(z.object({
    object: z.string(),
    index: z.number(),
    embedding: z.array(z.number()),
  })),
  model: z.string(),
  usage: z.object({
    prompt_tokens: z.number(),
    total_tokens: z.number(),
  }),
});
export type EmbeddingResponse = z.infer<typeof EmbeddingResponseSchema>;

// --- ChromaDB API schemas ---

export const ChromaCollectionSchema = z.object({
  id: z.string(),
  name: z.string(),
  metadata: z.record(z.unknown()).nullable().optional(),
}).passthrough();
export type ChromaCollection = z.infer<typeof ChromaCollectionSchema>;

export const ChromaQueryResponseSchema = z.object({
  ids: z.array(z.array(z.string())),
  documents: z.array(z.array(z.string())),
  distances: z.array(z.array(z.number())),
  metadatas: z.array(z.array(z.record(z.unknown()).nullable())),
}).passthrough();
export type ChromaQueryResponse = z.infer<typeof ChromaQueryResponseSchema>;

// --- RAG config ---

export type RAGConfig = {
  readonly chromaUrl: string;
  readonly openaiApiKey: string;
  readonly embeddingModel: string;
  readonly maxResults: number;
  readonly similarityThreshold: number;
};

export const DEFAULT_RAG_CONFIG: Omit<RAGConfig, "openaiApiKey"> = {
  chromaUrl: "http://localhost:8000",
  embeddingModel: "text-embedding-3-small",
  maxResults: 10,
  similarityThreshold: 0.7,
};
