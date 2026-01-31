/**
 * Social Media Tracker
 * 
 * Track influencers and topics on social media:
 * - Twitter/X (via Nitter mirrors - no API key needed)
 * - Key influencer monitoring
 * - Topic sentiment analysis
 * 
 * @author ElizaBAO
 */

// ============================================================
// TYPES
// ============================================================

export interface SocialPost {
  author: string;
  authorHandle: string;
  content: string;
  timestamp: string;
  likes: number;
  retweets: number;
  sentiment: "positive" | "negative" | "neutral";
  relevanceScore: number;
  url: string;
}

export interface InfluencerProfile {
  handle: string;
  name: string;
  category: "crypto" | "politics" | "finance" | "tech" | "general";
  followers: number;
  influence: "high" | "medium" | "low";
}

export interface SocialIntelligence {
  topic: string;
  postCount: number;
  sentiment: "bullish" | "bearish" | "neutral";
  sentimentScore: number;
  trending: boolean;
  topPosts: SocialPost[];
  activeInfluencers: string[];
  lastUpdated: string;
}

// ============================================================
// KEY INFLUENCERS TO TRACK
// ============================================================

export const INFLUENCERS: InfluencerProfile[] = [
  // Crypto
  { handle: "elonmusk", name: "Elon Musk", category: "crypto", followers: 170000000, influence: "high" },
  { handle: "VitalikButerin", name: "Vitalik Buterin", category: "crypto", followers: 5000000, influence: "high" },
  { handle: "caborek", name: "Michael Saylor", category: "crypto", followers: 3000000, influence: "high" },
  { handle: "CryptoHayes", name: "Arthur Hayes", category: "crypto", followers: 500000, influence: "medium" },
  { handle: "100trillionUSD", name: "PlanB", category: "crypto", followers: 2000000, influence: "high" },
  { handle: "APompliano", name: "Anthony Pompliano", category: "crypto", followers: 1500000, influence: "medium" },
  
  // Politics
  { handle: "realDonaldTrump", name: "Donald Trump", category: "politics", followers: 90000000, influence: "high" },
  { handle: "JoeBiden", name: "Joe Biden", category: "politics", followers: 40000000, influence: "high" },
  { handle: "AOC", name: "Alexandria Ocasio-Cortez", category: "politics", followers: 13000000, influence: "medium" },
  { handle: "SpeakerJohnson", name: "Mike Johnson", category: "politics", followers: 1000000, influence: "medium" },
  
  // Finance
  { handle: "jimcramer", name: "Jim Cramer", category: "finance", followers: 2000000, influence: "medium" },
  { handle: "elaborleve", name: "Cathie Wood", category: "finance", followers: 1500000, influence: "medium" },
  { handle: "zaborek", name: "Zerohedge", category: "finance", followers: 1200000, influence: "medium" },
  
  // Tech
  { handle: "satlouer", name: "Sam Altman", category: "tech", followers: 3000000, influence: "high" },
  { handle: "JeffBezos", name: "Jeff Bezos", category: "tech", followers: 5000000, influence: "high" },
];

// ============================================================
// NITTER MIRRORS (Twitter without API)
// ============================================================

const NITTER_INSTANCES = [
  "https://nitter.net",
  "https://nitter.privacydev.net",
  "https://nitter.poast.org",
  "https://nitter.1d4.us",
];

let currentNitterIndex = 0;

function getNitterUrl(): string {
  return NITTER_INSTANCES[currentNitterIndex];
}

function rotateNitter(): void {
  currentNitterIndex = (currentNitterIndex + 1) % NITTER_INSTANCES.length;
}

// ============================================================
// SENTIMENT ANALYSIS
// ============================================================

const POSITIVE_WORDS = [
  "bullish", "moon", "pump", "surge", "breakout", "ath", "win", "victory",
  "approved", "passed", "success", "great", "amazing", "best", "up", "higher",
  "buy", "long", "support", "strong", "growth", "profit", "gains",
];

const NEGATIVE_WORDS = [
  "bearish", "dump", "crash", "plunge", "decline", "fail", "reject", "loss",
  "sell", "short", "weak", "down", "lower", "concern", "warning", "risk",
  "scam", "fraud", "collapse", "crisis", "fear", "panic",
];

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
  if (total === 0) return { sentiment: "neutral", score: 0 };
  
  const score = (positiveCount - negativeCount) / total;
  
  if (score > 0.2) return { sentiment: "positive", score };
  if (score < -0.2) return { sentiment: "negative", score };
  return { sentiment: "neutral", score };
}

// ============================================================
// CACHE
// ============================================================

const socialCache: Map<string, { data: SocialIntelligence; expires: number }> = new Map();
const CACHE_TTL_MS = 3 * 60 * 1000; // 3 minutes (social is fast-moving)

// ============================================================
// FETCH USER TWEETS (via Nitter)
// ============================================================

async function fetchUserTweets(handle: string, limit: number = 5): Promise<SocialPost[]> {
  const posts: SocialPost[] = [];
  
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const url = `${getNitterUrl()}/${handle}`;
      const response = await fetch(url, {
        headers: {
          "User-Agent": "Mozilla/5.0 (compatible; ElizaBAO/2.1)",
        },
      });
      
      if (!response.ok) {
        rotateNitter();
        continue;
      }
      
      const html = await response.text();
      
      // Parse tweets from HTML (Nitter format)
      const tweetMatches = html.match(/<div class="tweet-content[^"]*">([\s\S]*?)<\/div>/gi) || [];
      
      for (const match of tweetMatches.slice(0, limit)) {
        const content = match.replace(/<[^>]*>/g, "").trim();
        if (content.length > 10) {
          const { sentiment, score } = analyzeSentiment(content);
          
          posts.push({
            author: handle,
            authorHandle: `@${handle}`,
            content: content.slice(0, 280),
            timestamp: new Date().toISOString(),
            likes: 0,
            retweets: 0,
            sentiment,
            relevanceScore: 0.8,
            url: `https://twitter.com/${handle}`,
          });
        }
      }
      
      if (posts.length > 0) break;
      rotateNitter();
      
    } catch (err: any) {
      console.log(`Nitter error for @${handle}: ${err.message}`);
      rotateNitter();
    }
  }
  
  return posts;
}

// ============================================================
// SEARCH TOPIC (via Nitter)
// ============================================================

async function searchTopic(query: string, limit: number = 10): Promise<SocialPost[]> {
  const posts: SocialPost[] = [];
  
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const url = `${getNitterUrl()}/search?f=tweets&q=${encodeURIComponent(query)}`;
      const response = await fetch(url, {
        headers: {
          "User-Agent": "Mozilla/5.0 (compatible; ElizaBAO/2.1)",
        },
      });
      
      if (!response.ok) {
        rotateNitter();
        continue;
      }
      
      const html = await response.text();
      
      // Parse tweets from search results
      const tweetMatches = html.match(/<div class="tweet-content[^"]*">([\s\S]*?)<\/div>/gi) || [];
      const authorMatches = html.match(/<a class="username"[^>]*>@(\w+)<\/a>/gi) || [];
      
      for (let i = 0; i < Math.min(tweetMatches.length, limit); i++) {
        const content = tweetMatches[i].replace(/<[^>]*>/g, "").trim();
        const authorMatch = authorMatches[i]?.match(/@(\w+)/);
        const author = authorMatch ? authorMatch[1] : "unknown";
        
        if (content.length > 10) {
          const { sentiment, score } = analyzeSentiment(content);
          
          // Check if author is known influencer
          const influencer = INFLUENCERS.find(i => i.handle.toLowerCase() === author.toLowerCase());
          const relevanceScore = influencer ? (influencer.influence === "high" ? 1.0 : 0.8) : 0.5;
          
          posts.push({
            author,
            authorHandle: `@${author}`,
            content: content.slice(0, 280),
            timestamp: new Date().toISOString(),
            likes: 0,
            retweets: 0,
            sentiment,
            relevanceScore,
            url: `https://twitter.com/${author}`,
          });
        }
      }
      
      if (posts.length > 0) break;
      rotateNitter();
      
    } catch (err: any) {
      console.log(`Nitter search error: ${err.message}`);
      rotateNitter();
    }
  }
  
  return posts;
}

// ============================================================
// GET INFLUENCER POSTS FOR CATEGORY
// ============================================================

async function getInfluencerPosts(category: "crypto" | "politics" | "finance" | "tech" | "general"): Promise<SocialPost[]> {
  const categoryInfluencers = INFLUENCERS.filter(i => i.category === category || category === "general");
  const allPosts: SocialPost[] = [];
  
  // Fetch from top 3 influencers in parallel
  const topInfluencers = categoryInfluencers.slice(0, 3);
  const promises = topInfluencers.map(i => fetchUserTweets(i.handle, 3));
  
  const results = await Promise.allSettled(promises);
  
  for (const result of results) {
    if (result.status === "fulfilled") {
      allPosts.push(...result.value);
    }
  }
  
  return allPosts;
}

// ============================================================
// MAIN INTELLIGENCE FUNCTION
// ============================================================

export async function getSocialIntelligence(topic: string): Promise<SocialIntelligence> {
  // Check cache
  const cacheKey = topic.toLowerCase().slice(0, 50);
  const cached = socialCache.get(cacheKey);
  if (cached && cached.expires > Date.now()) {
    return cached.data;
  }

  console.log(`🐦 Fetching social intelligence for: "${topic.slice(0, 40)}..."`);

  // Detect category
  const topicLower = topic.toLowerCase();
  let category: "crypto" | "politics" | "finance" | "tech" | "general" = "general";
  
  if (topicLower.includes("bitcoin") || topicLower.includes("crypto") || topicLower.includes("eth")) {
    category = "crypto";
  } else if (topicLower.includes("trump") || topicLower.includes("election") || topicLower.includes("vote")) {
    category = "politics";
  } else if (topicLower.includes("stock") || topicLower.includes("fed") || topicLower.includes("rate")) {
    category = "finance";
  } else if (topicLower.includes("ai") || topicLower.includes("openai") || topicLower.includes("tech")) {
    category = "tech";
  }

  // Fetch posts from multiple sources
  const [searchPosts, influencerPosts] = await Promise.all([
    searchTopic(topic, 10),
    getInfluencerPosts(category),
  ]);

  const allPosts = [...searchPosts, ...influencerPosts];
  
  // Remove duplicates by content similarity
  const uniquePosts = allPosts.filter((post, index, arr) => {
    const contentStart = post.content.slice(0, 50).toLowerCase();
    return arr.findIndex(p => p.content.slice(0, 50).toLowerCase() === contentStart) === index;
  });

  // Sort by relevance
  uniquePosts.sort((a, b) => b.relevanceScore - a.relevanceScore);

  // Calculate sentiment
  let sentimentSum = 0;
  for (const post of uniquePosts) {
    if (post.sentiment === "positive") sentimentSum += post.relevanceScore;
    else if (post.sentiment === "negative") sentimentSum -= post.relevanceScore;
  }
  
  const avgSentiment = uniquePosts.length > 0 ? sentimentSum / uniquePosts.length : 0;
  const overallSentiment: "bullish" | "bearish" | "neutral" = 
    avgSentiment > 0.15 ? "bullish" : avgSentiment < -0.15 ? "bearish" : "neutral";

  // Check if trending (many posts in short time)
  const trending = uniquePosts.length >= 8;

  // Get active influencers
  const activeInfluencers = [...new Set(
    uniquePosts
      .filter(p => INFLUENCERS.some(i => i.handle.toLowerCase() === p.author.toLowerCase()))
      .map(p => p.authorHandle)
  )];

  const intelligence: SocialIntelligence = {
    topic,
    postCount: uniquePosts.length,
    sentiment: overallSentiment,
    sentimentScore: avgSentiment,
    trending,
    topPosts: uniquePosts.slice(0, 5),
    activeInfluencers,
    lastUpdated: new Date().toISOString(),
  };

  // Cache result
  socialCache.set(cacheKey, { data: intelligence, expires: Date.now() + CACHE_TTL_MS });

  console.log(`🐦 Found ${uniquePosts.length} posts | Sentiment: ${overallSentiment} | Trending: ${trending ? "YES" : "no"} | Influencers: ${activeInfluencers.length}`);

  return intelligence;
}

// ============================================================
// TRADING SIGNAL FROM SOCIAL
// ============================================================

export interface SocialTradingSignal {
  direction: "buy" | "sell" | "hold";
  strength: number;
  confidence: number;
  reason: string;
  influencerAlert: boolean;
}

export async function getSocialTradingSignal(marketQuestion: string): Promise<SocialTradingSignal> {
  try {
    const intelligence = await getSocialIntelligence(marketQuestion);

    if (intelligence.postCount === 0) {
      return {
        direction: "hold",
        strength: 0,
        confidence: 0,
        reason: "No social posts found",
        influencerAlert: false,
      };
    }

    // Determine direction
    let direction: "buy" | "sell" | "hold" = "hold";
    const isPositiveOutcome = !marketQuestion.toLowerCase().includes("not") &&
                              !marketQuestion.toLowerCase().includes("fail");

    if (intelligence.sentiment === "bullish" && isPositiveOutcome) {
      direction = Math.abs(intelligence.sentimentScore) > 0.3 ? "buy" : "hold";
    } else if (intelligence.sentiment === "bearish" && isPositiveOutcome) {
      direction = Math.abs(intelligence.sentimentScore) > 0.3 ? "sell" : "hold";
    }

    // Boost confidence if influencers are active
    const influencerBoost = intelligence.activeInfluencers.length > 0 ? 0.2 : 0;
    const trendingBoost = intelligence.trending ? 0.1 : 0;
    const confidence = Math.min(1, (intelligence.postCount / 15) + influencerBoost + trendingBoost);

    const topPost = intelligence.topPosts[0]?.content.slice(0, 50) || "No posts";
    const influencerNames = intelligence.activeInfluencers.slice(0, 2).join(", ") || "none";

    return {
      direction,
      strength: Math.abs(intelligence.sentimentScore),
      confidence,
      reason: `${intelligence.sentiment.toUpperCase()} (${intelligence.postCount} posts): "${topPost}..." | Influencers: ${influencerNames}`,
      influencerAlert: intelligence.activeInfluencers.length > 0,
    };
  } catch (err: any) {
    return {
      direction: "hold",
      strength: 0,
      confidence: 0,
      reason: `Error: ${err.message}`,
      influencerAlert: false,
    };
  }
}

// ============================================================
// SPECIFIC INFLUENCER CHECK
// ============================================================

export async function checkInfluencerActivity(handle: string): Promise<SocialPost[]> {
  return fetchUserTweets(handle, 5);
}

export function getInfluencersByCategory(category: string): InfluencerProfile[] {
  return INFLUENCERS.filter(i => i.category === category);
}

// ============================================================
// CLEAR CACHE
// ============================================================

export function clearSocialCache(): void {
  socialCache.clear();
}
