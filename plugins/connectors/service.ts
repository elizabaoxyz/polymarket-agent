import { NewsApiClient } from "./news-client";
import { TavilySearchClient } from "./search-client";
import {
  CONNECTORS_SERVICE_TYPE,
  type NewsArticle,
  type SearchContext,
} from "./types";

type Runtime = { getSetting: (key: string) => string | undefined };

/**
 * Connectors Service — elizaOS service that provides News + Search data enrichment.
 *
 * Provides:
 * - News article fetching (NewsAPI)
 * - Web search (Tavily)
 * - Combined search context for LLM analysis
 */
export class ConnectorsService {
  static serviceType = CONNECTORS_SERVICE_TYPE;
  serviceType = CONNECTORS_SERVICE_TYPE;

  readonly news: NewsApiClient | null;
  readonly search: TavilySearchClient | null;
  private _initialized = false;

  private constructor(
    news: NewsApiClient | null,
    search: TavilySearchClient | null,
  ) {
    this.news = news;
    this.search = search;
    this._initialized = news !== null || search !== null;
  }

  static async start(runtime: Runtime): Promise<ConnectorsService> {
    const newsApiKey =
      runtime.getSetting("NEWSAPI_API_KEY") ??
      process.env.NEWSAPI_API_KEY?.trim();

    const tavilyApiKey =
      runtime.getSetting("TAVILY_API_KEY") ??
      process.env.TAVILY_API_KEY?.trim();

    const news = newsApiKey ? new NewsApiClient({ apiKey: newsApiKey }) : null;
    const search = tavilyApiKey ? new TavilySearchClient({ apiKey: tavilyApiKey }) : null;

    if (!news && !search) {
      console.log("connectors: disabled (set NEWSAPI_API_KEY and/or TAVILY_API_KEY)");
    } else {
      const parts: string[] = [];
      if (news) parts.push("news");
      if (search) parts.push("search");
      console.log(`connectors: active [${parts.join(", ")}]`);
    }

    return new ConnectorsService(news, search);
  }

  isActive(): boolean {
    return this._initialized;
  }

  // ========== News ==========

  /**
   * Fetch news articles relevant to a set of keywords.
   */
  async fetchNews(keywords: readonly string[], maxArticles: number = 20): Promise<NewsArticle[]> {
    if (!this.news) return [];
    try {
      return await this.news.fetchMarketNews(keywords, maxArticles);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.warn(`connectors: failed to fetch news: ${msg}`);
      return [];
    }
  }

  /**
   * Fetch news articles relevant to a specific market question.
   */
  async fetchMarketNews(question: string, maxArticles: number = 10): Promise<NewsArticle[]> {
    if (!this.news) return [];
    try {
      // Extract key terms from the market question
      const keywords = extractKeywords(question);
      return await this.news.fetchMarketNews(keywords, maxArticles);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.warn(`connectors: failed to fetch market news: ${msg}`);
      return [];
    }
  }

  // ========== Search ==========

  /**
   * Search the web for context relevant to a market question.
   */
  async searchWeb(query: string, maxResults: number = 5): Promise<string> {
    if (!this.search) return "";
    try {
      return await this.search.getSearchContext(query, maxResults);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.warn(`connectors: web search failed: ${msg}`);
      return "";
    }
  }

  // ========== Combined Context ==========

  /**
   * Get a comprehensive search context combining news and web search.
   * Returns a formatted string ready for LLM prompt injection.
   */
  async getSearchContext(query: string): Promise<SearchContext> {
    const [articles, searchResults] = await Promise.all([
      this.fetchMarketNews(query, 5),
      this.searchWeb(query, 5),
    ]);

    const articleContext = articles.length > 0
      ? articles
          .map((a) => `[${a.publishedAt}] ${a.source}: ${a.title}\n${a.description}`)
          .join("\n\n")
      : "";

    const contextSummary = [articleContext, searchResults]
      .filter((s) => s.length > 0)
      .join("\n\n---\n\n");

    return {
      articles,
      searchResults: searchResults ? [{ title: "web", url: "", content: searchResults, score: 0, raw_content: null }] : [],
      contextSummary,
    };
  }
}

/**
 * Extract meaningful keywords from a prediction market question.
 * Filters out common stop words and short words.
 */
function extractKeywords(question: string): string[] {
  const stopWords = new Set([
    "a", "an", "the", "is", "are", "was", "were", "be", "been", "being",
    "have", "has", "had", "do", "does", "did", "will", "would", "could",
    "should", "may", "might", "can", "shall", "must", "need", "dare",
    "ought", "used", "to", "of", "in", "for", "on", "with", "at", "by",
    "from", "as", "into", "through", "during", "before", "after", "above",
    "below", "between", "out", "off", "over", "under", "again", "further",
    "then", "once", "here", "there", "when", "where", "why", "how", "all",
    "each", "every", "both", "few", "more", "most", "other", "some", "such",
    "no", "not", "only", "own", "same", "so", "than", "too", "very",
    "just", "because", "but", "and", "or", "if", "while", "about", "against",
    "between", "through", "during", "before", "after",
  ]);

  const words = question
    .replace(/[^a-zA-Z0-9\s]/g, " ")
    .split(/\s+/)
    .filter((w) => w.length >= 3 && !stopWords.has(w.toLowerCase()));

  // Deduplicate and take top 5 unique keywords
  const unique = [...new Set(words)];
  return unique.slice(0, 5);
}
