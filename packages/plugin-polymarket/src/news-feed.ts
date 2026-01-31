/**
 * News Feed Integration Module
 * 
 * Fetches real-time news for market event analysis:
 * - Breaking news API (free tier)
 * - Google News RSS
 * - Crypto news aggregator
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
}

export interface NewsSummary {
  topic: string;
  articleCount: number;
  overallSentiment: "bullish" | "bearish" | "neutral";
  sentimentScore: number; // -1 to 1
  topArticles: NewsArticle[];
  lastUpdated: string;
}

// ============================================================
// CONFIGURATION
// ============================================================

// Using free RSS feeds (no API key needed)
const NEWS_SOURCES = {
  crypto: [
    "https://cointelegraph.com/rss",
    "https://www.coindesk.com/arc/outboundfeeds/rss/",
  ],
  politics: [
    "https://feeds.npr.org/1001/rss.xml",
    "https://rss.politico.com/politics-news.xml",
  ],
  general: [
    "https://news.google.com/rss/search?q=",
  ],
};

// Sentiment keywords
const POSITIVE_WORDS = [
  "surge", "soar", "rally", "gain", "jump", "rise", "boom", "bullish",
  "win", "victory", "success", "breakthrough", "approve", "pass", "agree",
  "support", "positive", "strong", "growth", "up", "higher", "best",
];

const NEGATIVE_WORDS = [
  "crash", "plunge", "drop", "fall", "decline", "slump", "bearish",
  "lose", "defeat", "fail", "reject", "block", "oppose", "negative",
  "weak", "down", "lower", "worst", "crisis", "collapse", "concern",
];

// Cache for news
const newsCache: Map<string, { data: NewsSummary; expires: number }> = new Map();
const CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutes

// ============================================================
// SENTIMENT ANALYSIS
// ============================================================

function analyzeSentiment(text: string): { sentiment: "positive" | "negative" | "neutral"; score: number } {
  const lowerText = text.toLowerCase();
  
  let positiveCount = 0;
  let negativeCount = 0;
  
  for (const word of POSITIVE_WORDS) {
    if (lowerText.includes(word)) positiveCount++;
  }
  
  for (const word of NEGATIVE_WORDS) {
    if (lowerText.includes(word)) negativeCount++;
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

function calculateRelevance(text: string, keywords: string[]): number {
  const lowerText = text.toLowerCase();
  let matches = 0;
  
  for (const keyword of keywords) {
    if (lowerText.includes(keyword.toLowerCase())) {
      matches++;
    }
  }
  
  return Math.min(1, matches / Math.max(1, keywords.length));
}

// ============================================================
// RSS PARSING
// ============================================================

interface RSSItem {
  title: string;
  description: string;
  link: string;
  pubDate: string;
}

async function fetchRSSFeed(url: string): Promise<RSSItem[]> {
  try {
    const response = await fetch(url, {
      headers: {
        "User-Agent": "ElizaBAO/2.0 News Aggregator",
      },
    });
    
    if (!response.ok) {
      console.log(`RSS fetch failed: ${url} (${response.status})`);
      return [];
    }
    
    const xml = await response.text();
    const items: RSSItem[] = [];
    
    // Simple XML parsing for RSS items
    const itemMatches = xml.match(/<item>([\s\S]*?)<\/item>/gi) || [];
    
    for (const itemXml of itemMatches.slice(0, 10)) { // Limit to 10 items
      const title = itemXml.match(/<title>([\s\S]*?)<\/title>/i)?.[1]?.replace(/<!\[CDATA\[(.*?)\]\]>/g, "$1") || "";
      const description = itemXml.match(/<description>([\s\S]*?)<\/description>/i)?.[1]?.replace(/<!\[CDATA\[(.*?)\]\]>/g, "$1") || "";
      const link = itemXml.match(/<link>([\s\S]*?)<\/link>/i)?.[1] || "";
      const pubDate = itemXml.match(/<pubDate>([\s\S]*?)<\/pubDate>/i)?.[1] || "";
      
      if (title) {
        items.push({
          title: title.replace(/<[^>]*>/g, "").trim(),
          description: description.replace(/<[^>]*>/g, "").slice(0, 200).trim(),
          link: link.trim(),
          pubDate,
        });
      }
    }
    
    return items;
  } catch (err: any) {
    console.log(`RSS error: ${err.message}`);
    return [];
  }
}

// ============================================================
// NEWS FETCHING
// ============================================================

export async function fetchNewsForTopic(
  topic: string,
  keywords: string[] = []
): Promise<NewsSummary> {
  // Check cache
  const cacheKey = `${topic}:${keywords.join(",")}`;
  const cached = newsCache.get(cacheKey);
  if (cached && cached.expires > Date.now()) {
    return cached.data;
  }
  
  const allKeywords = [topic, ...keywords];
  const articles: NewsArticle[] = [];
  
  // Determine which feeds to use
  let feeds: string[] = [];
  const topicLower = topic.toLowerCase();
  
  if (topicLower.includes("bitcoin") || topicLower.includes("crypto") || 
      topicLower.includes("ethereum") || topicLower.includes("btc")) {
    feeds = NEWS_SOURCES.crypto;
  } else if (topicLower.includes("trump") || topicLower.includes("biden") ||
             topicLower.includes("election") || topicLower.includes("politic")) {
    feeds = NEWS_SOURCES.politics;
  } else {
    // Use Google News search
    feeds = [NEWS_SOURCES.general[0] + encodeURIComponent(topic)];
  }
  
  // Fetch from all feeds in parallel
  const feedPromises = feeds.map(url => fetchRSSFeed(url));
  const feedResults = await Promise.all(feedPromises);
  
  for (const items of feedResults) {
    for (const item of items) {
      const fullText = `${item.title} ${item.description}`;
      const { sentiment, score } = analyzeSentiment(fullText);
      const relevance = calculateRelevance(fullText, allKeywords);
      
      // Only include relevant articles
      if (relevance > 0.1) {
        articles.push({
          title: item.title,
          description: item.description,
          source: new URL(item.link || "https://unknown.com").hostname,
          url: item.link,
          publishedAt: item.pubDate,
          sentiment,
          relevanceScore: relevance,
        });
      }
    }
  }
  
  // Sort by relevance
  articles.sort((a, b) => b.relevanceScore - a.relevanceScore);
  
  // Calculate overall sentiment
  const avgSentiment = articles.length > 0
    ? articles.reduce((sum, a) => {
        if (a.sentiment === "positive") return sum + 1;
        if (a.sentiment === "negative") return sum - 1;
        return sum;
      }, 0) / articles.length
    : 0;
  
  const overallSentiment: "bullish" | "bearish" | "neutral" = 
    avgSentiment > 0.2 ? "bullish" : avgSentiment < -0.2 ? "bearish" : "neutral";
  
  const summary: NewsSummary = {
    topic,
    articleCount: articles.length,
    overallSentiment,
    sentimentScore: avgSentiment,
    topArticles: articles.slice(0, 5),
    lastUpdated: new Date().toISOString(),
  };
  
  // Cache the result
  newsCache.set(cacheKey, { data: summary, expires: Date.now() + CACHE_TTL_MS });
  
  return summary;
}

// ============================================================
// MARKET-SPECIFIC NEWS
// ============================================================

export async function getNewsForMarket(question: string): Promise<NewsSummary> {
  // Extract key entities from the market question
  const keywords: string[] = [];
  
  // Common patterns
  const patterns = [
    /will ([\w\s]+) (announce|release|launch|win|lose|reach|hit|pass|approve)/i,
    /price of ([\w\s]+) (be|reach|hit)/i,
    /([\w\s]+) (election|vote|poll)/i,
    /(bitcoin|ethereum|btc|eth|solana|xrp)/i,
    /(trump|biden|harris|desantis|musk|elon)/i,
  ];
  
  for (const pattern of patterns) {
    const match = question.match(pattern);
    if (match) {
      keywords.push(match[1].trim());
      if (match[2]) keywords.push(match[2].trim());
    }
  }
  
  // Add the full question as fallback
  if (keywords.length === 0) {
    keywords.push(...question.split(" ").filter(w => w.length > 4).slice(0, 3));
  }
  
  const topic = keywords[0] || "market news";
  return fetchNewsForTopic(topic, keywords.slice(1));
}

// ============================================================
// CRYPTO NEWS SPECIFIC
// ============================================================

export async function getCryptoNews(symbol: string = "bitcoin"): Promise<NewsSummary> {
  return fetchNewsForTopic(symbol, ["price", "crypto", "market"]);
}

export async function getPoliticsNews(topic: string = "politics"): Promise<NewsSummary> {
  return fetchNewsForTopic(topic, ["election", "vote", "congress"]);
}

// ============================================================
// NEWS-BASED TRADING SIGNAL
// ============================================================

export interface NewsSignal {
  direction: "buy" | "sell" | "hold";
  strength: number; // 0 to 1
  reason: string;
}

export async function getNewsSignal(question: string): Promise<NewsSignal> {
  try {
    const news = await getNewsForMarket(question);
    
    if (news.articleCount === 0) {
      return {
        direction: "hold",
        strength: 0,
        reason: "No recent news found",
      };
    }
    
    const sentiment = news.overallSentiment;
    const strength = Math.abs(news.sentimentScore);
    
    // Determine direction based on market type
    const isYesPositive = !question.toLowerCase().includes("not") && 
                          !question.toLowerCase().includes("fail") &&
                          !question.toLowerCase().includes("decline");
    
    let direction: "buy" | "sell" | "hold" = "hold";
    
    if (sentiment === "bullish" && isYesPositive) {
      direction = strength > 0.3 ? "buy" : "hold";
    } else if (sentiment === "bearish" && isYesPositive) {
      direction = strength > 0.3 ? "sell" : "hold";
    } else if (sentiment === "bullish" && !isYesPositive) {
      direction = strength > 0.3 ? "sell" : "hold";
    } else if (sentiment === "bearish" && !isYesPositive) {
      direction = strength > 0.3 ? "buy" : "hold";
    }
    
    const topHeadline = news.topArticles[0]?.title || "General market sentiment";
    
    return {
      direction,
      strength: Math.min(1, strength),
      reason: `${sentiment.toUpperCase()} news (${news.articleCount} articles): "${topHeadline.slice(0, 50)}..."`,
    };
  } catch (err: any) {
    return {
      direction: "hold",
      strength: 0,
      reason: `News fetch error: ${err.message}`,
    };
  }
}

// ============================================================
// EXPORTS
// ============================================================

export function clearNewsCache(): void {
  newsCache.clear();
}
