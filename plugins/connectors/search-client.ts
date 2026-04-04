import { z } from "zod";
import type { TavilySearchResult, TavilyResponse } from "./types";

/**
 * Tavily Search client — AI-optimized web search for market research.
 * Uses the Tavily extract and search API for context-rich results.
 *
 * Docs: https://docs.tavily.com
 */
export class TavilySearchClient {
  private readonly apiKey: string;
  private readonly baseUrl = "https://api.tavily.com";

  constructor(config: { readonly apiKey: string }) {
    this.apiKey = config.apiKey;
  }

  /**
   * Search the web for context-rich results relevant to a market question.
   * Returns up to `maxResults` results with extracted content.
   */
  async search(params: {
    readonly query: string;
    readonly maxResults?: number;
    readonly searchDepth?: "basic" | "advanced";
    readonly includeRawContent?: boolean;
  }): Promise<TavilySearchResult[]> {
    const res = await fetch(`${this.baseUrl}/search`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        api_key: this.apiKey,
        query: params.query,
        max_results: params.maxResults ?? 5,
        search_depth: params.searchDepth ?? "basic",
        include_answer: true,
        include_raw_content: params.includeRawContent ?? false,
      }),
    });

    if (!res.ok) {
      const text = await res.text().catch(() => "");
      throw new Error(`Tavily search error ${res.status}: ${text}`);
    }

    const data = await res.json() as TavilyResponse;
    return data.results ?? [];
  }

  /**
   * Extract content from specific URLs.
   * Useful for reading articles found via search.
   */
  async extract(urls: readonly string[]): Promise<Array<{
    readonly url: string;
    readonly rawContent: string;
  }>> {
    const res = await fetch(`${this.baseUrl}/extract`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        api_key: this.apiKey,
        urls,
      }),
    });

    if (!res.ok) {
      const text = await res.text().catch(() => "");
      throw new Error(`Tavily extract error ${res.status}: ${text}`);
    }

    const data = await res.json() as { responses?: Array<{ url: string; rawContent: string }> };
    return data.responses ?? [];
  }

  /**
   * Get search context for a market question — returns a concise summary string.
   */
  async getSearchContext(query: string, maxResults: number = 5): Promise<string> {
    try {
      const results = await this.search({
        query,
        maxResults,
        searchDepth: "basic",
      });

      const contexts = results.map((r) =>
        `[${r.title}](${r.url}) (score: ${r.score.toFixed(2)}): ${r.content}`
      );

      return contexts.join("\n\n");
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.warn(`connectors: tavily search failed for "${query}": ${msg}`);
      return "";
    }
  }
}
