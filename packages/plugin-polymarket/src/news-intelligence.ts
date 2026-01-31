/**
 * News Intelligence Module
 * 
 * Multi-source news aggregation for market intelligence:
 * - NewsAPI.org (politics, general)
 * - Brave Search (any topic)
 * - CryptoCompare (crypto news)
 * - DuckDuckGo (backup, no API key)
 * - Alpha Vantage (finance/stocks)
 * - RSS feeds (fallback)
 * 
 * @author ElizaBAO
 */

// ============================================================
// TYPES
// ============================================================

export interface NewsArticle {
  title: string;
  description: string;
  source: string;
  url: string;
  publishedAt: string;
  sentiment: "positive" | "negative" | "neutral";
  relevanceScore: number;
  provider: string;
}

export interface NewsIntelligence {
  topic: string;
  articleCount: number;
  sentiment: "bullish" | "bearish" | "neutral";
  sentimentScore: number; // -1 to 1
  confidence: number; // 0 to 1
  topArticles: NewsArticle[];
  sources: string[];
  lastUpdated: string;
}

export interface TradingSignal {
  direction: "buy" | "sell" | "hold";
  strength: number; // 0 to 1
  confidence: number; // 0 to 1
  reason: string;
  sources: string[];
}

// ============================================================
// API KEYS (from environment)
// ============================================================

const NEWSAPI_KEY = process.env.NEWSAPI_KEY || "";
const BRAVE_API_KEY = process.env.BRAVE_API_KEY || "";
const CRYPTOCOMPARE_KEY = process.env.CRYPTOCOMPARE_KEY || "";
const ALPHAVANTAGE_KEY = process.env.ALPHAVANTAGE_KEY || "";

// ============================================================
// CACHE
// ============================================================

const newsCache: Map<string, { data: NewsIntelligence; expires: number }> = new Map();
const CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutes

// ============================================================
// SENTIMENT ANALYSIS
// ============================================================

const POSITIVE_WORDS = [
  "surge", "soar", "rally", "gain", "jump", "rise", "boom", "bullish",
  "win", "victory", "success", "breakthrough", "approve", "pass", "agree",
  "support", "positive", "strong", "growth", "up", "higher", "best",
  "record", "all-time high", "ath", "moon", "pump", "breakout",
];

const NEGATIVE_WORDS = [
  "crash", "plunge", "drop", "fall", "decline", "slump", "bearish",
  "lose", "defeat", "fail", "reject", "block", "oppose", "negative",
  "weak", "down", "lower", "worst", "crisis", "collapse", "concern",
  "dump", "sell-off", "fear", "panic", "warning", "risk",
];

function analyzeSentiment(text: string): { sentiment: "positive" | "negative" | "neutral"; score: number } {
  const lowerText = text.toLowerCase();
  
  let positiveCount = 0;
  let negativeCount = 0;
  
  for (const word of POSITIVE_WORDS) {
    const regex = new RegExp(`\\b${word}\\b`, "gi");
    const matches = lowerText.match(regex);
    if (matches) positiveCount += matches.length;
  }
  
  for (const word of NEGATIVE_WORDS) {
    const regex = new RegExp(`\\b${word}\\b`, "gi");
    const matches = lowerText.match(regex);
    if (matches) negativeCount += matches.length;
  }
  
  const total = positiveCount + negativeCount;
  if (total === 0) {
    return { sentiment: "neutral", score: 0 };
  }
  
  const score = (positiveCount - negativeCount) / total;
  
  if (score > 0.2) return { sentiment: "positive", score };
  if (score < -0.2) return { sentiment: "negative", score };
  return { sentiment: "neutral", score };
}

// ============================================================
// NEWSAPI.ORG (Politics, General News)
// ============================================================

async function fetchNewsAPI(query: string, category?: string): Promise<NewsArticle[]> {
  if (!NEWSAPI_KEY) {
    console.log("⚠️ NEWSAPI_KEY not set");
    return [];
  }

  try {
    let url = `https://newsapi.org/v2/everything?q=${encodeURIComponent(query)}&sortBy=publishedAt&pageSize=10&apiKey=${NEWSAPI_KEY}`;
    
    if (category) {
      url = `https://newsapi.org/v2/top-headlines?category=${category}&pageSize=10&apiKey=${NEWSAPI_KEY}`;
    }

    const response = await fetch(url);
    if (!response.ok) {
      console.log(`NewsAPI error: ${response.status}`);
      return [];
    }

    const data = await response.json();
    const articles: NewsArticle[] = [];

    for (const article of data.articles || []) {
      const fullText = `${article.title} ${article.description || ""}`;
      const { sentiment, score } = analyzeSentiment(fullText);

      articles.push({
        title: article.title || "",
        description: article.description || "",
        source: article.source?.name || "NewsAPI",
        url: article.url || "",
        publishedAt: article.publishedAt || "",
        sentiment,
        relevanceScore: 0.8,
        provider: "newsapi",
      });
    }

    return articles;
  } catch (err: any) {
    console.error(`NewsAPI error: ${err.message}`);
    return [];
  }
}

// ============================================================
// BRAVE SEARCH (Any Topic)
// ============================================================

async function fetchBraveSearch(query: string): Promise<NewsArticle[]> {
  if (!BRAVE_API_KEY) {
    console.log("⚠️ BRAVE_API_KEY not set");
    return [];
  }

  try {
    const url = `https://api.search.brave.com/res/v1/news/search?q=${encodeURIComponent(query)}&count=10`;
    
    const response = await fetch(url, {
      headers: {
        "X-Subscription-Token": BRAVE_API_KEY,
        "Accept": "application/json",
      },
    });

    if (!response.ok) {
      console.log(`Brave Search error: ${response.status}`);
      return [];
    }

    const data = await response.json();
    const articles: NewsArticle[] = [];

    for (const result of data.results || []) {
      const fullText = `${result.title} ${result.description || ""}`;
      const { sentiment, score } = analyzeSentiment(fullText);

      articles.push({
        title: result.title || "",
        description: result.description || "",
        source: result.meta_url?.hostname || "Brave",
        url: result.url || "",
        publishedAt: result.age || "",
        sentiment,
        relevanceScore: 0.9,
        provider: "brave",
      });
    }

    return articles;
  } catch (err: any) {
    console.error(`Brave Search error: ${err.message}`);
    return [];
  }
}

// ============================================================
// CRYPTOCOMPARE (Crypto News)
// ============================================================

async function fetchCryptoCompare(symbols: string[] = ["BTC", "ETH"]): Promise<NewsArticle[]> {
  try {
    const categories = symbols.join(",");
    let url = `https://min-api.cryptocompare.com/data/v2/news/?categories=${categories}&excludeCategories=Sponsored`;
    
    if (CRYPTOCOMPARE_KEY) {
      url += `&api_key=${CRYPTOCOMPARE_KEY}`;
    }

    const response = await fetch(url);
    if (!response.ok) {
      console.log(`CryptoCompare error: ${response.status}`);
      return [];
    }

    const data = await response.json();
    const articles: NewsArticle[] = [];

    for (const article of (data.Data || []).slice(0, 10)) {
      const fullText = `${article.title} ${article.body || ""}`;
      const { sentiment, score } = analyzeSentiment(fullText);

      articles.push({
        title: article.title || "",
        description: (article.body || "").slice(0, 200),
        source: article.source_info?.name || "CryptoCompare",
        url: article.url || "",
        publishedAt: new Date(article.published_on * 1000).toISOString(),
        sentiment,
        relevanceScore: 0.85,
        provider: "cryptocompare",
      });
    }

    return articles;
  } catch (err: any) {
    console.error(`CryptoCompare error: ${err.message}`);
    return [];
  }
}

// ============================================================
// DUCKDUCKGO (Backup, No API Key)
// ============================================================

async function fetchDuckDuckGo(query: string): Promise<NewsArticle[]> {
  try {
    // DuckDuckGo instant answer API (limited but free)
    const url = `https://api.duckduckgo.com/?q=${encodeURIComponent(query)}&format=json&no_html=1`;
    
    const response = await fetch(url);
    if (!response.ok) {
      return [];
    }

    const data = await response.json();
    const articles: NewsArticle[] = [];

    // DuckDuckGo returns related topics
    for (const topic of (data.RelatedTopics || []).slice(0, 5)) {
      if (topic.Text) {
        const { sentiment, score } = analyzeSentiment(topic.Text);
        
        articles.push({
          title: topic.Text.split(" - ")[0] || topic.Text.slice(0, 100),
          description: topic.Text,
          source: "DuckDuckGo",
          url: topic.FirstURL || "",
          publishedAt: new Date().toISOString(),
          sentiment,
          relevanceScore: 0.6,
          provider: "duckduckgo",
        });
      }
    }

    return articles;
  } catch (err: any) {
    console.error(`DuckDuckGo error: ${err.message}`);
    return [];
  }
}

// ============================================================
// ALPHA VANTAGE (Finance/Stocks)
// ============================================================

async function fetchAlphaVantage(symbol: string): Promise<NewsArticle[]> {
  if (!ALPHAVANTAGE_KEY) {
    console.log("⚠️ ALPHAVANTAGE_KEY not set");
    return [];
  }

  try {
    const url = `https://www.alphavantage.co/query?function=NEWS_SENTIMENT&tickers=${symbol}&apikey=${ALPHAVANTAGE_KEY}`;
    
    const response = await fetch(url);
    if (!response.ok) {
      console.log(`Alpha Vantage error: ${response.status}`);
      return [];
    }

    const data = await response.json();
    const articles: NewsArticle[] = [];

    for (const item of (data.feed || []).slice(0, 10)) {
      // Alpha Vantage provides sentiment scores
      const avSentiment = parseFloat(item.overall_sentiment_score || "0");
      let sentiment: "positive" | "negative" | "neutral" = "neutral";
      if (avSentiment > 0.15) sentiment = "positive";
      else if (avSentiment < -0.15) sentiment = "negative";

      articles.push({
        title: item.title || "",
        description: item.summary || "",
        source: item.source || "Alpha Vantage",
        url: item.url || "",
        publishedAt: item.time_published || "",
        sentiment,
        relevanceScore: 0.85,
        provider: "alphavantage",
      });
    }

    return articles;
  } catch (err: any) {
    console.error(`Alpha Vantage error: ${err.message}`);
    return [];
  }
}

// ============================================================
// RSS FEEDS (Fallback)
// ============================================================

async function fetchRSSFeed(url: string): Promise<NewsArticle[]> {
  try {
    const response = await fetch(url, {
      headers: { "User-Agent": "ElizaBAO/2.1 News Aggregator" },
    });
    
    if (!response.ok) return [];
    
    const xml = await response.text();
    const articles: NewsArticle[] = [];
    
    const itemMatches = xml.match(/<item>([\s\S]*?)<\/item>/gi) || [];
    
    for (const itemXml of itemMatches.slice(0, 5)) {
      const title = itemXml.match(/<title>([\s\S]*?)<\/title>/i)?.[1]?.replace(/<!\[CDATA\[(.*?)\]\]>/g, "$1") || "";
      const description = itemXml.match(/<description>([\s\S]*?)<\/description>/i)?.[1]?.replace(/<!\[CDATA\[(.*?)\]\]>/g, "$1") || "";
      const link = itemXml.match(/<link>([\s\S]*?)<\/link>/i)?.[1] || "";
      const pubDate = itemXml.match(/<pubDate>([\s\S]*?)<\/pubDate>/i)?.[1] || "";
      
      if (title) {
        const cleanTitle = title.replace(/<[^>]*>/g, "").trim();
        const cleanDesc = description.replace(/<[^>]*>/g, "").slice(0, 200).trim();
        const { sentiment } = analyzeSentiment(`${cleanTitle} ${cleanDesc}`);
        
        articles.push({
          title: cleanTitle,
          description: cleanDesc,
          source: "RSS",
          url: link.trim(),
          publishedAt: pubDate,
          sentiment,
          relevanceScore: 0.5,
          provider: "rss",
        });
      }
    }
    
    return articles;
  } catch {
    return [];
  }
}

// ============================================================
// CATEGORY-BASED FETCHING
// ============================================================

type MarketCategory = "crypto" | "politics" | "sports" | "finance" | "elon" | "other";

function detectCategory(query: string): MarketCategory {
  const q = query.toLowerCase();
  
  if (q.includes("bitcoin") || q.includes("btc") || q.includes("ethereum") || 
      q.includes("eth") || q.includes("crypto") || q.includes("solana")) {
    return "crypto";
  }
  if (q.includes("trump") || q.includes("biden") || q.includes("election") ||
      q.includes("congress") || q.includes("senate") || q.includes("vote")) {
    return "politics";
  }
  if (q.includes("super bowl") || q.includes("nfl") || q.includes("nba") ||
      q.includes("world cup") || q.includes("championship")) {
    return "sports";
  }
  if (q.includes("stock") || q.includes("earnings") || q.includes("fed") ||
      q.includes("interest rate") || q.includes("nasdaq") || q.includes("s&p")) {
    return "finance";
  }
  if (q.includes("elon") || q.includes("musk") || q.includes("tweet")) {
    return "elon";
  }
  
  return "other";
}

// ============================================================
// MAIN INTELLIGENCE FUNCTION
// ============================================================

export async function getNewsIntelligence(query: string): Promise<NewsIntelligence> {
  // Check cache
  const cacheKey = query.toLowerCase().slice(0, 50);
  const cached = newsCache.get(cacheKey);
  if (cached && cached.expires > Date.now()) {
    return cached.data;
  }

  const category = detectCategory(query);
  const allArticles: NewsArticle[] = [];
  const sources: string[] = [];

  console.log(`📰 Fetching news for: "${query.slice(0, 40)}..." (${category})`);

  // Fetch from multiple sources based on category
  const fetchPromises: Promise<NewsArticle[]>[] = [];

  // Always try Brave Search if available
  if (BRAVE_API_KEY) {
    fetchPromises.push(fetchBraveSearch(query));
    sources.push("brave");
  }

  // Category-specific sources
  switch (category) {
    case "crypto":
      fetchPromises.push(fetchCryptoCompare(["BTC", "ETH", "SOL"]));
      sources.push("cryptocompare");
      if (NEWSAPI_KEY) {
        fetchPromises.push(fetchNewsAPI(query));
        sources.push("newsapi");
      }
      break;

    case "politics":
      if (NEWSAPI_KEY) {
        fetchPromises.push(fetchNewsAPI(query, "politics"));
        sources.push("newsapi");
      }
      fetchPromises.push(fetchRSSFeed("https://rss.politico.com/politics-news.xml"));
      sources.push("rss");
      break;

    case "finance":
      if (ALPHAVANTAGE_KEY) {
        // Try to extract stock symbol
        const symbolMatch = query.match(/\b([A-Z]{1,5})\b/);
        if (symbolMatch) {
          fetchPromises.push(fetchAlphaVantage(symbolMatch[1]));
          sources.push("alphavantage");
        }
      }
      if (NEWSAPI_KEY) {
        fetchPromises.push(fetchNewsAPI(query, "business"));
        sources.push("newsapi");
      }
      break;

    case "elon":
      if (NEWSAPI_KEY) {
        fetchPromises.push(fetchNewsAPI("elon musk twitter"));
        sources.push("newsapi");
      }
      fetchPromises.push(fetchCryptoCompare(["DOGE"])); // Elon loves DOGE
      break;

    default:
      if (NEWSAPI_KEY) {
        fetchPromises.push(fetchNewsAPI(query));
        sources.push("newsapi");
      }
      fetchPromises.push(fetchDuckDuckGo(query));
      sources.push("duckduckgo");
  }

  // Fetch all in parallel
  const results = await Promise.allSettled(fetchPromises);
  
  for (const result of results) {
    if (result.status === "fulfilled") {
      allArticles.push(...result.value);
    }
  }

  // Remove duplicates by title similarity
  const uniqueArticles = allArticles.filter((article, index, arr) => {
    const titleLower = article.title.toLowerCase();
    return arr.findIndex(a => 
      a.title.toLowerCase().includes(titleLower.slice(0, 30)) ||
      titleLower.includes(a.title.toLowerCase().slice(0, 30))
    ) === index;
  });

  // Sort by relevance
  uniqueArticles.sort((a, b) => b.relevanceScore - a.relevanceScore);

  // Calculate overall sentiment
  let sentimentSum = 0;
  for (const article of uniqueArticles) {
    if (article.sentiment === "positive") sentimentSum += article.relevanceScore;
    else if (article.sentiment === "negative") sentimentSum -= article.relevanceScore;
  }
  
  const avgSentiment = uniqueArticles.length > 0 
    ? sentimentSum / uniqueArticles.length 
    : 0;

  const overallSentiment: "bullish" | "bearish" | "neutral" = 
    avgSentiment > 0.15 ? "bullish" : avgSentiment < -0.15 ? "bearish" : "neutral";

  // Calculate confidence based on number of sources agreeing
  const positiveCount = uniqueArticles.filter(a => a.sentiment === "positive").length;
  const negativeCount = uniqueArticles.filter(a => a.sentiment === "negative").length;
  const total = positiveCount + negativeCount;
  const agreement = total > 0 ? Math.abs(positiveCount - negativeCount) / total : 0;
  const confidence = Math.min(1, (uniqueArticles.length / 10) * agreement);

  const intelligence: NewsIntelligence = {
    topic: query,
    articleCount: uniqueArticles.length,
    sentiment: overallSentiment,
    sentimentScore: avgSentiment,
    confidence,
    topArticles: uniqueArticles.slice(0, 5),
    sources,
    lastUpdated: new Date().toISOString(),
  };

  // Cache result
  newsCache.set(cacheKey, { data: intelligence, expires: Date.now() + CACHE_TTL_MS });

  console.log(`📰 Found ${uniqueArticles.length} articles | Sentiment: ${overallSentiment} (${(avgSentiment * 100).toFixed(0)}%) | Sources: ${sources.join(", ")}`);

  return intelligence;
}

// ============================================================
// TRADING SIGNAL
// ============================================================

export async function getNewsTradingSignal(marketQuestion: string): Promise<TradingSignal> {
  try {
    const intelligence = await getNewsIntelligence(marketQuestion);

    if (intelligence.articleCount === 0) {
      return {
        direction: "hold",
        strength: 0,
        confidence: 0,
        reason: "No news found",
        sources: [],
      };
    }

    // Determine trade direction
    let direction: "buy" | "sell" | "hold" = "hold";
    const isPositiveOutcome = !marketQuestion.toLowerCase().includes("not") &&
                              !marketQuestion.toLowerCase().includes("fail") &&
                              !marketQuestion.toLowerCase().includes("decline");

    if (intelligence.sentiment === "bullish" && isPositiveOutcome) {
      direction = intelligence.confidence > 0.3 ? "buy" : "hold";
    } else if (intelligence.sentiment === "bearish" && isPositiveOutcome) {
      direction = intelligence.confidence > 0.3 ? "sell" : "hold";
    } else if (intelligence.sentiment === "bullish" && !isPositiveOutcome) {
      direction = intelligence.confidence > 0.3 ? "sell" : "hold";
    } else if (intelligence.sentiment === "bearish" && !isPositiveOutcome) {
      direction = intelligence.confidence > 0.3 ? "buy" : "hold";
    }

    const topHeadline = intelligence.topArticles[0]?.title || "No headline";

    return {
      direction,
      strength: Math.abs(intelligence.sentimentScore),
      confidence: intelligence.confidence,
      reason: `${intelligence.sentiment.toUpperCase()}: "${topHeadline.slice(0, 50)}..." (${intelligence.articleCount} articles)`,
      sources: intelligence.sources,
    };
  } catch (err: any) {
    return {
      direction: "hold",
      strength: 0,
      confidence: 0,
      reason: `Error: ${err.message}`,
      sources: [],
    };
  }
}

// ============================================================
// API STATUS CHECK
// ============================================================

export function getNewsAPIStatus(): Record<string, boolean> {
  return {
    newsapi: !!NEWSAPI_KEY,
    brave: !!BRAVE_API_KEY,
    cryptocompare: true, // Works without key
    alphavantage: !!ALPHAVANTAGE_KEY,
    duckduckgo: true, // No key needed
    rss: true, // No key needed
  };
}

// ============================================================
// CLEAR CACHE
// ============================================================

export function clearNewsCache(): void {
  newsCache.clear();
}
