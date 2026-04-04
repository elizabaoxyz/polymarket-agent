import { ChromaClient } from "./chroma-client";
import { EmbeddingClient } from "./embeddings";
import {
  RAG_SERVICE_TYPE,
  COLLECTIONS,
  DEFAULT_RAG_CONFIG,
  type RAGConfig,
  type MarketDocument,
  type NewsDocument,
  type SearchDocument,
  type SimilarityResult,
  type EnrichedContext,
} from "./types";

type Runtime = { getSetting: (key: string) => string | undefined };

/**
 * RAG Service — elizaOS service that manages ChromaDB-based retrieval-augmented generation.
 *
 * Provides:
 * - Market indexing (Polymarket + Jupiter markets → ChromaDB vectors)
 * - News article indexing
 * - Search result caching
 * - Similarity search (ChromaDB cosine similarity)
 * - Context enrichment for LLM analysis
 * - Similarity scoring for market quality assessment
 */
export class RAGService {
  static serviceType = RAG_SERVICE_TYPE;
  serviceType = RAG_SERVICE_TYPE;

  readonly chroma: ChromaClient;
  readonly embedding: EmbeddingClient;
  readonly config: RAGConfig;
  private _initialized = false;

  private constructor(config: RAGConfig) {
    this.config = config;
    this.chroma = new ChromaClient({ chromaUrl: config.chromaUrl });
    this.embedding = new EmbeddingClient({
      apiKey: config.openaiApiKey,
      model: config.embeddingModel,
    });
  }


  static async start(runtime: Runtime): Promise<RAGService> {
    const openaiApiKey =
      runtime.getSetting("OPENAI_API_KEY") ??
      process.env.OPENAI_API_KEY?.trim();

    const chromaUrl =
      runtime.getSetting("CHROMA_URL") ??
      process.env.CHROMA_URL?.trim() ??
      DEFAULT_RAG_CONFIG.chromaUrl;

    if (!openaiApiKey) {
      console.log("rag: disabled (OPENAI_API_KEY not set)");
      // Return a stub service that's not initialized
      const stub = Object.create(RAGService.prototype) as RAGService;
      (stub as { config: RAGConfig }).config = { ...DEFAULT_RAG_CONFIG, chromaUrl, openaiApiKey: "" };
      (stub as unknown as { _initialized: boolean })._initialized = false;
      (stub as { chroma: ChromaClient }).chroma = new ChromaClient({ chromaUrl });
      (stub as { embedding: EmbeddingClient }).embedding = new EmbeddingClient({ apiKey: "" });
      return stub;
    }

    const config: RAGConfig = {
      chromaUrl,
      openaiApiKey,
      embeddingModel: DEFAULT_RAG_CONFIG.embeddingModel,
      maxResults: DEFAULT_RAG_CONFIG.maxResults,
      similarityThreshold: DEFAULT_RAG_CONFIG.similarityThreshold,
    };

    const svc = new RAGService(config);
    svc._initialized = true;

    // Ensure collections exist
    try {
      await svc.chroma.getOrCreateCollection(COLLECTIONS.POLYMARKET_MARKETS);
      await svc.chroma.getOrCreateCollection(COLLECTIONS.JUPITER_MARKETS);
      await svc.chroma.getOrCreateCollection(COLLECTIONS.NEWS_ARTICLES);
      await svc.chroma.getOrCreateCollection(COLLECTIONS.SEARCH_RESULTS);
      console.log(`rag: active | chroma: ${chromaUrl} | model: ${config.embeddingModel}`);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.warn(`rag: ChromaDB connection failed (${msg}) — similarity search disabled`);
      svc._initialized = false;
    }

    return svc;
  }

  isActive(): boolean {
    return this._initialized;
  }

  // ========== Indexing ==========

  /**
   * Index Polymarket markets into ChromaDB for similarity search.
   */
  async indexPolymarketMarkets(markets: readonly MarketDocument[]): Promise<number> {
    if (!this._initialized || markets.length === 0) return 0;
    // Let errors bubble up — caller handles graceful degradation
    const texts = markets.map((m) =>
      `${m.question}. ${m.description}. Outcomes: ${m.outcomes}. Prices: ${m.outcomePrices}. Volume: ${m.volume}.`
    );
    const embeddings = await this.embedding.embedBatch(texts);
    const docs = markets.map((m, i) => ({
      id: m.id,
      content: texts[i]!,
      embedding: embeddings[i]!,
      metadata: {
        platform: m.platform,
        question: m.question,
        volume: m.volume,
        outcomes: m.outcomes,
        ...m.metadata,
      },
    }));
    await this.chroma.upsertDocuments(COLLECTIONS.POLYMARKET_MARKETS, docs);
    return docs.length;
  }

  /**
   * Index Jupiter markets into ChromaDB for similarity search.
   */
  async indexJupiterMarkets(markets: readonly MarketDocument[]): Promise<number> {
    if (!this._initialized || markets.length === 0) return 0;
    const texts = markets.map((m) =>
      `${m.question}. ${m.description}. Outcomes: ${m.outcomes}. Prices: ${m.outcomePrices}. Volume: ${m.volume}.`
    );
    const embeddings = await this.embedding.embedBatch(texts);
    const docs = markets.map((m, i) => ({
      id: m.id,
      content: texts[i]!,
      embedding: embeddings[i]!,
      metadata: {
        platform: m.platform,
        question: m.question,
        volume: m.volume,
        ...m.metadata,
      },
    }));
    await this.chroma.upsertDocuments(COLLECTIONS.JUPITER_MARKETS, docs);
    return docs.length;
  }

  /**
   * Index news articles into ChromaDB for context retrieval.
   */
  async indexNewsArticles(articles: readonly NewsDocument[]): Promise<number> {
    if (!this._initialized || articles.length === 0) return 0;
    const texts = articles.map((a) => `${a.title}. ${a.content}`);
    const embeddings = await this.embedding.embedBatch(texts);
    const docs = articles.map((a, i) => ({
      id: a.id,
      content: texts[i]!,
      embedding: embeddings[i]!,
      metadata: {
        source: a.source,
        url: a.url,
        publishedAt: a.publishedAt,
        keywords: a.keywords,
      },
    }));
    await this.chroma.upsertDocuments(COLLECTIONS.NEWS_ARTICLES, docs);
    return docs.length;
  }

  /**
   * Index web search results into ChromaDB.
   */
  async indexSearchResults(results: readonly SearchDocument[]): Promise<number> {
    if (!this._initialized || results.length === 0) return 0;
    try {
      const texts = results.map((r) => `${r.title}. ${r.content}`);
      const embeddings = await this.embedding.embedBatch(texts);
      const docs = results.map((r, i) => ({
        id: r.id,
        content: texts[i]!,
        embedding: embeddings[i]!,
        metadata: { url: r.url, query: r.query },
      }));
      await this.chroma.upsertDocuments(COLLECTIONS.SEARCH_RESULTS, docs);
      console.log(`rag: indexed ${docs.length} search results`);
      return docs.length;
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.warn(`rag: failed to index search results: ${msg}`);
      return 0;
    }
  }

  // ========== Similarity Search ==========

  /**
   * Find similar markets in ChromaDB by question text.
   * Returns results sorted by similarity score (highest first).
   */
  async findSimilarMarkets(
    query: string,
    platform: "polymarket" | "jupiter" | "all" = "all",
    maxResults?: number,
  ): Promise<SimilarityResult[]> {
    if (!this._initialized) return [];
    try {
      const queryEmbedding = await this.embedding.embedSingle(query);
      const limit = maxResults ?? this.config.maxResults;
      const collections =
        platform === "all"
          ? [COLLECTIONS.POLYMARKET_MARKETS, COLLECTIONS.JUPITER_MARKETS]
          : platform === "polymarket"
            ? [COLLECTIONS.POLYMARKET_MARKETS]
            : [COLLECTIONS.JUPITER_MARKETS];

      const allResults: SimilarityResult[] = [];
      for (const collection of collections) {
        const results = await this.chroma.query(collection, queryEmbedding, limit);
        allResults.push(...results);
      }

      // Sort by similarity score (highest first), deduplicate by id
      allResults.sort((a, b) => b.score - a.score);
      const seen = new Set<string>();
      return allResults.filter((r) => {
        if (seen.has(r.id)) return false;
        seen.add(r.id);
        return r.score >= this.config.similarityThreshold;
      }).slice(0, limit);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.warn(`rag: similarity search failed: ${msg}`);
      return [];
    }
  }

  /**
   * Find relevant news articles by query text.
   */
  async findRelevantNews(
    query: string,
    maxResults?: number,
  ): Promise<SimilarityResult[]> {
    if (!this._initialized) return [];
    try {
      const queryEmbedding = await this.embedding.embedSingle(query);
      return await this.chroma.query(
        COLLECTIONS.NEWS_ARTICLES,
        queryEmbedding,
        maxResults ?? this.config.maxResults,
      );
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.warn(`rag: news search failed: ${msg}`);
      return [];
    }
  }

  /**
   * Find relevant cached search results by query text.
   */
  async findRelevantSearch(
    query: string,
    maxResults?: number,
  ): Promise<SimilarityResult[]> {
    if (!this._initialized) return [];
    try {
      const queryEmbedding = await this.embedding.embedSingle(query);
      return await this.chroma.query(
        COLLECTIONS.SEARCH_RESULTS,
        queryEmbedding,
        maxResults ?? 5,
      );
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.warn(`rag: search retrieval failed: ${msg}`);
      return [];
    }
  }

  // ========== Full Enrichment for LLM Analysis ==========

  /**
   * Enrich a market analysis query with RAG context:
   * - Similar markets from ChromaDB
   * - Relevant news articles
   * - Cached web search results
   */
  async enrichContext(query: string): Promise<EnrichedContext> {
    if (!this._initialized) {
      return { similarMarkets: [], relevantNews: [], searchContext: "" };
    }

    const [similarMarkets, relevantNews, searchResults] = await Promise.all([
      this.findSimilarMarkets(query, "all", 5),
      this.findRelevantNews(query, 5),
      this.findRelevantSearch(query, 3),
    ]);

    const searchContext = searchResults
      .map((r) => r.content)
      .join("\n\n");

    return { similarMarkets, relevantNews, searchContext };
  }

  // ========== Scoring Integration ==========

  /**
   * Compute a similarity score (0–1) for a market question.
   * Markets with many close analogs in the DB score higher — indicating
   * the market is in an active, well-traded domain.
   *
   * Used as an additional factor in the autonomy scoring algorithm.
   */
  async computeSimilarityScore(marketQuestion: string): Promise<number> {
    if (!this._initialized) return 0;
    const similar = await this.findSimilarMarkets(marketQuestion, "all", 5);
    if (similar.length === 0) return 0;
    const avgScore = similar.reduce((sum, r) => sum + r.score, 0) / similar.length;
    return avgScore;
  }

  // ========== Stats ==========

  async getStats(): Promise<Record<string, number>> {
    if (!this._initialized) return {};
    const stats: Record<string, number> = {};
    for (const [key, name] of Object.entries(COLLECTIONS)) {
      try {
        stats[key] = await this.chroma.countDocuments(name);
      } catch {
        stats[key] = 0;
      }
    }
    return stats;
  }
}
