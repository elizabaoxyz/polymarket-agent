import { z } from "zod";

// --- Service type constant ---

export const CONNECTORS_SERVICE_TYPE = "CONNECTORS";

// --- News API types ---

export const NewsApiConfigSchema = z.object({
  apiKey: z.string().min(1),
  baseUrl: z.string().url().default("https://newsapi.org/v2"),
});
export type NewsApiConfig = z.infer<typeof NewsApiConfigSchema>;

export const NewsArticleSchema = z.object({
  source: z.object({ id: z.string().nullable(), name: z.string().nullable() }).passthrough(),
  author: z.string().nullable(),
  title: z.string(),
  description: z.string().nullable(),
  url: z.string().nullable(),
  urlToImage: z.string().nullable(),
  publishedAt: z.string().nullable(),
  content: z.string().nullable(),
});
export type NewsArticle = z.infer<typeof NewsArticleSchema>;

export const NewsResponseSchema = z.object({
  status: z.string(),
  totalResults: z.number(),
  articles: z.array(NewsArticleSchema),
});
export type NewsResponse = z.infer<typeof NewsResponseSchema>;

// --- Tavily Search types ---

export const TavilyConfigSchema = z.object({
  apiKey: z.string().min(1),
  baseUrl: z.string().url().default("https://api.tavily.com"),
});
export type TavilyConfig = z.infer<typeof TavilyConfigSchema>;

export const TavilySearchResultSchema = z.object({
  title: z.string(),
  url: z.string(),
  content: z.string(),
  score: z.number(),
  raw_content: z.string().nullable(),
});
export type TavilySearchResult = z.infer<typeof TavilySearchResultSchema>;

export const TavilyResponseSchema = z.object({
  query: z.string(),
  answer: z.string().nullable(),
  results: z.array(TavilySearchResultSchema),
});
export type TavilyResponse = z.infer<typeof TavilyResponseSchema>;

// --- Search context (combined result) ---

export type SearchContext = {
  readonly articles: NewsArticle[];
  readonly searchResults: TavilySearchResult[];
  readonly contextSummary: string;
};
