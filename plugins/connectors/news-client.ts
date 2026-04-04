import { z } from "zod";
import { NewsArticleSchema, type NewsArticle } from "./types";

/**
 * NewsAPI client — fetches breaking news articles relevant to prediction markets.
 * Uses newsapi.org v2 API.
 *
 * Categories: business, entertainment, general, health, science, sports, technology
 */
export class NewsApiClient {
  private readonly apiKey: string;
  private readonly baseUrl: string;

  constructor(config: { readonly apiKey: string; readonly baseUrl?: string }) {
    this.apiKey = config.apiKey;
    this.baseUrl = config.baseUrl ?? "https://newsapi.org/v2";
  }

  /**
   * Fetch top headlines by keyword.
   */
  async getTopHeadlines(params: {
    readonly query?: string;
    readonly category?: string;
    readonly country?: string;
    readonly pageSize?: number;
  }): Promise<NewsArticle[]> {
    const url = new URL(`${this.baseUrl}/top-headlines`);
    if (params.query) url.searchParams.set("q", params.query);
    if (params.category) url.searchParams.set("category", params.category);
    url.searchParams.set("country", params.country ?? "us");
    url.searchParams.set("pageSize", String(params.pageSize ?? 20));
    url.searchParams.set("apiKey", this.apiKey);

    const res = await fetch(url.toString());
    if (!res.ok) {
      const text = await res.text().catch(() => "");
      throw new Error(`NewsAPI error ${res.status}: ${text}`);
    }

    const data = await res.json();
    if (!data.articles || !Array.isArray(data.articles)) return [];

    return data.articles
      .filter((a: Record<string, unknown>) => a.title && a.title !== "[Removed]")
      .map((a: Record<string, unknown>) => NewsArticleSchema.parse({
        source: typeof a.source === "object" && a.source ? (a.source as Record<string, string>).name ?? "" : String(a.source ?? ""),
        title: String(a.title ?? ""),
        description: String(a.description ?? ""),
        url: String(a.url ?? ""),
        publishedAt: String(a.publishedAt ?? ""),
        content: String(a.content ?? a.description ?? ""),
      }));
  }

  /**
   * Search all articles by keyword with date range.
   */
  async searchArticles(params: {
    readonly query: string;
    readonly from?: string; // ISO date
    readonly to?: string;   // ISO date
    readonly pageSize?: number;
    readonly sortBy?: "relevancy" | "popularity" | "publishedAt";
  }): Promise<NewsArticle[]> {
    const url = new URL(`${this.baseUrl}/everything`);
    url.searchParams.set("q", params.query);
    url.searchParams.set("language", "en");
    url.searchParams.set("sortBy", params.sortBy ?? "publishedAt");
    url.searchParams.set("pageSize", String(params.pageSize ?? 20));
    url.searchParams.set("apiKey", this.apiKey);
    if (params.from) url.searchParams.set("from", params.from);
    if (params.to) url.searchParams.set("to", params.to);

    const res = await fetch(url.toString());
    if (!res.ok) {
      const text = await res.text().catch(() => "");
      throw new Error(`NewsAPI search error ${res.status}: ${text}`);
    }

    const data = await res.json();
    if (!data.articles || !Array.isArray(data.articles)) return [];

    return data.articles
      .filter((a: Record<string, unknown>) => a.title && a.title !== "[Removed]")
      .map((a: Record<string, unknown>) => NewsArticleSchema.parse({
        source: typeof a.source === "object" && a.source ? (a.source as Record<string, string>).name ?? "" : String(a.source ?? ""),
        title: String(a.title ?? ""),
        description: String(a.description ?? ""),
        url: String(a.url ?? ""),
        publishedAt: String(a.publishedAt ?? ""),
        content: String(a.content ?? a.description ?? ""),
      }));
  }

  /**
   * Fetch articles relevant to multiple prediction market keywords.
   * Returns combined, deduplicated results.
   */
  async fetchMarketNews(keywords: readonly string[], maxArticles: number = 20): Promise<NewsArticle[]> {
    const allArticles: NewsArticle[] = [];
    const seenTitles = new Set<string>();

    for (const keyword of keywords) {
      try {
        const articles = await this.searchArticles({
          query: keyword,
          pageSize: 10,
          sortBy: "publishedAt",
        });

        for (const article of articles) {
          const normalizedTitle = article.title.toLowerCase();
          if (!seenTitles.has(normalizedTitle)) {
            seenTitles.add(normalizedTitle);
            allArticles.push(article);
          }
        }

        if (allArticles.length >= maxArticles) break;
        // Rate limit: 100ms between requests
        await new Promise((r) => setTimeout(r, 100));
      } catch {
        // Continue on error for individual keywords
      }
    }

    // Sort by publication date (newest first)
    allArticles.sort((a, b) =>
      new Date(b.publishedAt).getTime() - new Date(a.publishedAt).getTime()
    );

    return allArticles.slice(0, maxArticles);
  }
}
