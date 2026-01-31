/**
 * XTracker Integration
 * 
 * Fetches live Elon Musk tweet counts from XTracker API.
 * Used for real-time prediction updates.
 * 
 * @author ElizaBAO
 */

const DEFAULT_XTRACKER_URL = "https://xtracker.polymarket.com/api";

export interface ElonTracking {
  id: string;
  title: string;
  count: number;
  startDate: Date;
  endDate: Date;
}

/**
 * Get all active Elon tweet trackings from XTracker
 */
export async function getAllElonTrackings(
  apiUrl: string = DEFAULT_XTRACKER_URL
): Promise<ElonTracking[]> {
  try {
    const res = await fetch(`${apiUrl}/tweets/elon/trackings`);
    if (!res.ok) return [];
    
    const data = await res.json();
    if (!data || !Array.isArray(data.trackings)) return [];

    return data.trackings.map((t: any) => ({
      id: t.id || "",
      title: t.title || "",
      count: parseInt(t.count || "0"),
      startDate: new Date(t.startDate),
      endDate: new Date(t.endDate),
    }));
  } catch (e) {
    console.error("XTracker fetch error:", e);
    return [];
  }
}

/**
 * Get the current active Elon tweet count (first tracking)
 */
export async function getElonTweetCount(
  apiUrl: string = DEFAULT_XTRACKER_URL
): Promise<{ count: number; startDate: Date; endDate: Date } | null> {
  const trackings = await getAllElonTrackings(apiUrl);
  if (trackings.length === 0) return null;

  const t = trackings[0];
  return {
    count: t.count,
    startDate: t.startDate,
    endDate: t.endDate,
  };
}

/**
 * Find tracking that matches a market's date range
 */
export async function findMatchingTracking(
  marketStartDate: Date,
  marketEndDate: Date,
  apiUrl: string = DEFAULT_XTRACKER_URL
): Promise<ElonTracking | null> {
  const trackings = await getAllElonTrackings(apiUrl);

  for (const t of trackings) {
    // Check if tracking period is close to market period (within 3 days)
    const startDiff = Math.abs(t.startDate.getTime() - marketStartDate.getTime()) / (1000 * 60 * 60 * 24);
    const endDiff = Math.abs(t.endDate.getTime() - marketEndDate.getTime()) / (1000 * 60 * 60 * 24);

    if (startDiff < 3 && endDiff < 3) {
      return t;
    }
  }

  return null;
}

/**
 * Cache for Elon posts to avoid fetching every scan
 */
let cachedElonPosts: any[] = [];
let lastPostsFetch = 0;
const POSTS_CACHE_MS = 300000; // 5 minutes

/**
 * Get all Elon posts (cached)
 */
export async function getElonPosts(
  apiUrl: string = DEFAULT_XTRACKER_URL
): Promise<any[]> {
  const now = Date.now();
  
  if (cachedElonPosts.length > 0 && (now - lastPostsFetch) < POSTS_CACHE_MS) {
    return cachedElonPosts;
  }

  try {
    console.log("🐦 Fetching all Elon posts (cache expired)...");
    const res = await fetch(`${apiUrl}/tweets/elon/posts?limit=5000`);
    if (!res.ok) return cachedElonPosts;

    const data = await res.json();
    if (data && Array.isArray(data.posts)) {
      cachedElonPosts = data.posts;
      lastPostsFetch = now;
      console.log(`🐦 Cached ${cachedElonPosts.length} total Elon posts`);
    }
  } catch (e) {
    console.error("Error fetching Elon posts:", e);
  }

  return cachedElonPosts;
}

/**
 * Count Elon tweets in a specific date range
 */
export async function countTweetsInRange(
  startDate: Date,
  endDate: Date,
  apiUrl: string = DEFAULT_XTRACKER_URL
): Promise<number> {
  const posts = await getElonPosts(apiUrl);
  
  const startMs = startDate.getTime();
  const endMs = endDate.getTime();

  const filteredPosts = posts.filter((p: any) => {
    const postTime = new Date(p.createdAt || p.created_at).getTime();
    return postTime >= startMs && postTime <= endMs;
  });

  return filteredPosts.length;
}
