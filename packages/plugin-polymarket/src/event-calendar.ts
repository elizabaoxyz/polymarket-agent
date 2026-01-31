/**
 * Event Calendar Module
 * 
 * Track important events for market prediction:
 * - Political events (elections, debates, votes)
 * - Crypto events (halvings, upgrades, launches)
 * - Financial events (FOMC, earnings, reports)
 * - Sports events (championships, playoffs)
 * 
 * @author ElizaBAO
 */

// ============================================================
// TYPES
// ============================================================

export interface CalendarEvent {
  id: string;
  title: string;
  date: Date;
  category: "politics" | "crypto" | "finance" | "sports" | "tech" | "other";
  importance: "high" | "medium" | "low";
  description: string;
  marketImpact: "bullish" | "bearish" | "neutral" | "volatile";
  relatedMarkets?: string[]; // Keywords to match markets
}

export interface EventIntelligence {
  upcomingEvents: CalendarEvent[];
  todayEvents: CalendarEvent[];
  thisWeekEvents: CalendarEvent[];
  nextMajorEvent: CalendarEvent | null;
  marketRelevance: Map<string, CalendarEvent[]>;
}

// ============================================================
// STATIC EVENT CALENDAR 2026
// ============================================================

export const EVENTS_2026: CalendarEvent[] = [
  // ==================== POLITICS ====================
  // US Elections
  {
    id: "us-midterms-2026",
    title: "US Midterm Elections 2026",
    date: new Date("2026-11-03"),
    category: "politics",
    importance: "high",
    description: "US House and Senate midterm elections",
    marketImpact: "volatile",
    relatedMarkets: ["election", "congress", "senate", "house", "republican", "democrat"],
  },
  {
    id: "state-of-union-2026",
    title: "State of the Union Address",
    date: new Date("2026-02-03"),
    category: "politics",
    importance: "medium",
    description: "Annual presidential address to Congress",
    marketImpact: "volatile",
    relatedMarkets: ["trump", "biden", "president", "congress"],
  },
  
  // Supreme Court
  {
    id: "scotus-term-end-2026",
    title: "Supreme Court Term Ends",
    date: new Date("2026-06-30"),
    category: "politics",
    importance: "high",
    description: "Major SCOTUS decisions typically released",
    marketImpact: "volatile",
    relatedMarkets: ["supreme court", "scotus", "ruling", "decision"],
  },

  // ==================== CRYPTO ====================
  // Bitcoin
  {
    id: "btc-halving-2028-countdown",
    title: "Bitcoin Halving (2028 countdown)",
    date: new Date("2028-04-15"),
    category: "crypto",
    importance: "high",
    description: "Next Bitcoin block reward halving",
    marketImpact: "bullish",
    relatedMarkets: ["bitcoin", "btc", "halving"],
  },
  
  // Ethereum
  {
    id: "eth-shanghai-anniversary",
    title: "Ethereum Shanghai Anniversary",
    date: new Date("2026-04-12"),
    category: "crypto",
    importance: "medium",
    description: "One year since ETH staking withdrawals enabled",
    marketImpact: "neutral",
    relatedMarkets: ["ethereum", "eth", "staking"],
  },
  
  // ==================== FINANCE ====================
  // Fed Meetings 2026 (typical schedule)
  {
    id: "fomc-jan-2026",
    title: "FOMC Meeting",
    date: new Date("2026-01-28"),
    category: "finance",
    importance: "high",
    description: "Federal Reserve interest rate decision",
    marketImpact: "volatile",
    relatedMarkets: ["fed", "interest rate", "fomc", "powell"],
  },
  {
    id: "fomc-mar-2026",
    title: "FOMC Meeting",
    date: new Date("2026-03-18"),
    category: "finance",
    importance: "high",
    description: "Federal Reserve interest rate decision",
    marketImpact: "volatile",
    relatedMarkets: ["fed", "interest rate", "fomc", "powell"],
  },
  {
    id: "fomc-may-2026",
    title: "FOMC Meeting",
    date: new Date("2026-05-06"),
    category: "finance",
    importance: "high",
    description: "Federal Reserve interest rate decision",
    marketImpact: "volatile",
    relatedMarkets: ["fed", "interest rate", "fomc", "powell"],
  },
  {
    id: "fomc-jun-2026",
    title: "FOMC Meeting",
    date: new Date("2026-06-17"),
    category: "finance",
    importance: "high",
    description: "Federal Reserve interest rate decision",
    marketImpact: "volatile",
    relatedMarkets: ["fed", "interest rate", "fomc", "powell"],
  },
  {
    id: "fomc-jul-2026",
    title: "FOMC Meeting",
    date: new Date("2026-07-29"),
    category: "finance",
    importance: "high",
    description: "Federal Reserve interest rate decision",
    marketImpact: "volatile",
    relatedMarkets: ["fed", "interest rate", "fomc", "powell"],
  },
  {
    id: "fomc-sep-2026",
    title: "FOMC Meeting",
    date: new Date("2026-09-16"),
    category: "finance",
    importance: "high",
    description: "Federal Reserve interest rate decision",
    marketImpact: "volatile",
    relatedMarkets: ["fed", "interest rate", "fomc", "powell"],
  },
  {
    id: "fomc-nov-2026",
    title: "FOMC Meeting",
    date: new Date("2026-11-04"),
    category: "finance",
    importance: "high",
    description: "Federal Reserve interest rate decision",
    marketImpact: "volatile",
    relatedMarkets: ["fed", "interest rate", "fomc", "powell"],
  },
  {
    id: "fomc-dec-2026",
    title: "FOMC Meeting",
    date: new Date("2026-12-16"),
    category: "finance",
    importance: "high",
    description: "Federal Reserve interest rate decision",
    marketImpact: "volatile",
    relatedMarkets: ["fed", "interest rate", "fomc", "powell"],
  },

  // Jobs Reports (First Friday of each month)
  {
    id: "jobs-feb-2026",
    title: "US Jobs Report",
    date: new Date("2026-02-06"),
    category: "finance",
    importance: "medium",
    description: "Monthly US employment statistics",
    marketImpact: "volatile",
    relatedMarkets: ["jobs", "employment", "unemployment", "economy"],
  },
  {
    id: "jobs-mar-2026",
    title: "US Jobs Report",
    date: new Date("2026-03-06"),
    category: "finance",
    importance: "medium",
    description: "Monthly US employment statistics",
    marketImpact: "volatile",
    relatedMarkets: ["jobs", "employment", "unemployment", "economy"],
  },

  // CPI Reports (Monthly)
  {
    id: "cpi-feb-2026",
    title: "CPI Report",
    date: new Date("2026-02-12"),
    category: "finance",
    importance: "high",
    description: "Consumer Price Index - inflation data",
    marketImpact: "volatile",
    relatedMarkets: ["inflation", "cpi", "prices", "economy"],
  },
  {
    id: "cpi-mar-2026",
    title: "CPI Report",
    date: new Date("2026-03-12"),
    category: "finance",
    importance: "high",
    description: "Consumer Price Index - inflation data",
    marketImpact: "volatile",
    relatedMarkets: ["inflation", "cpi", "prices", "economy"],
  },
  {
    id: "cpi-apr-2026",
    title: "CPI Report",
    date: new Date("2026-04-10"),
    category: "finance",
    importance: "high",
    description: "Consumer Price Index - inflation data",
    marketImpact: "volatile",
    relatedMarkets: ["inflation", "cpi", "prices", "economy"],
  },

  // GDP Reports
  {
    id: "gdp-q1-2026",
    title: "US GDP Q1 2026",
    date: new Date("2026-04-30"),
    category: "finance",
    importance: "high",
    description: "Q1 2026 GDP first estimate",
    marketImpact: "volatile",
    relatedMarkets: ["gdp", "economy", "growth", "recession"],
  },
  {
    id: "gdp-q2-2026",
    title: "US GDP Q2 2026",
    date: new Date("2026-07-30"),
    category: "finance",
    importance: "high",
    description: "Q2 2026 GDP first estimate",
    marketImpact: "volatile",
    relatedMarkets: ["gdp", "economy", "growth", "recession"],
  },

  // Gold/Silver/Commodities Events
  {
    id: "gold-delivery-feb-2026",
    title: "COMEX Gold Delivery",
    date: new Date("2026-02-27"),
    category: "finance",
    importance: "medium",
    description: "COMEX Gold futures delivery deadline",
    marketImpact: "volatile",
    relatedMarkets: ["gold", "xau", "precious metals", "comex"],
  },
  {
    id: "gold-delivery-apr-2026",
    title: "COMEX Gold Delivery",
    date: new Date("2026-04-29"),
    category: "finance",
    importance: "medium",
    description: "COMEX Gold futures delivery deadline",
    marketImpact: "volatile",
    relatedMarkets: ["gold", "xau", "precious metals", "comex"],
  },
  {
    id: "opec-mar-2026",
    title: "OPEC+ Meeting",
    date: new Date("2026-03-05"),
    category: "finance",
    importance: "high",
    description: "OPEC+ oil production decision",
    marketImpact: "volatile",
    relatedMarkets: ["oil", "opec", "crude", "energy", "gasoline"],
  },
  {
    id: "opec-jun-2026",
    title: "OPEC+ Meeting",
    date: new Date("2026-06-04"),
    category: "finance",
    importance: "high",
    description: "OPEC+ oil production decision",
    marketImpact: "volatile",
    relatedMarkets: ["oil", "opec", "crude", "energy", "gasoline"],
  },

  // Central Bank Meetings (Non-US)
  {
    id: "ecb-jan-2026",
    title: "ECB Rate Decision",
    date: new Date("2026-01-30"),
    category: "finance",
    importance: "high",
    description: "European Central Bank interest rate decision",
    marketImpact: "volatile",
    relatedMarkets: ["ecb", "euro", "europe", "rate", "eu"],
  },
  {
    id: "ecb-mar-2026",
    title: "ECB Rate Decision",
    date: new Date("2026-03-12"),
    category: "finance",
    importance: "high",
    description: "European Central Bank interest rate decision",
    marketImpact: "volatile",
    relatedMarkets: ["ecb", "euro", "europe", "rate", "eu"],
  },
  {
    id: "boe-feb-2026",
    title: "Bank of England Rate Decision",
    date: new Date("2026-02-05"),
    category: "finance",
    importance: "high",
    description: "Bank of England interest rate decision",
    marketImpact: "volatile",
    relatedMarkets: ["boe", "pound", "uk", "rate", "england"],
  },
  {
    id: "boe-mar-2026",
    title: "Bank of England Rate Decision",
    date: new Date("2026-03-19"),
    category: "finance",
    importance: "high",
    description: "Bank of England interest rate decision",
    marketImpact: "volatile",
    relatedMarkets: ["boe", "pound", "uk", "rate", "england"],
  },
  {
    id: "boj-jan-2026",
    title: "Bank of Japan Rate Decision",
    date: new Date("2026-01-24"),
    category: "finance",
    importance: "high",
    description: "Bank of Japan interest rate decision",
    marketImpact: "volatile",
    relatedMarkets: ["boj", "yen", "japan", "rate"],
  },
  {
    id: "boj-mar-2026",
    title: "Bank of Japan Rate Decision",
    date: new Date("2026-03-19"),
    category: "finance",
    importance: "high",
    description: "Bank of Japan interest rate decision",
    marketImpact: "volatile",
    relatedMarkets: ["boj", "yen", "japan", "rate"],
  },

  // Earnings Seasons
  {
    id: "earnings-q4-2025",
    title: "Q4 2025 Earnings Season Start",
    date: new Date("2026-01-14"),
    category: "finance",
    importance: "high",
    description: "Major companies begin Q4 2025 earnings reports",
    marketImpact: "volatile",
    relatedMarkets: ["earnings", "stock", "nasdaq", "s&p", "dow"],
  },
  {
    id: "earnings-q1-2026",
    title: "Q1 2026 Earnings Season Start",
    date: new Date("2026-04-14"),
    category: "finance",
    importance: "high",
    description: "Major companies begin Q1 2026 earnings reports",
    marketImpact: "volatile",
    relatedMarkets: ["earnings", "stock", "nasdaq", "s&p", "dow"],
  },

  // Tax Deadlines
  {
    id: "us-tax-2026",
    title: "US Tax Deadline",
    date: new Date("2026-04-15"),
    category: "finance",
    importance: "medium",
    description: "US federal tax filing deadline",
    marketImpact: "neutral",
    relatedMarkets: ["tax", "irs", "deadline"],
  },

  // ==================== SPORTS ====================
  {
    id: "super-bowl-2026",
    title: "Super Bowl LX",
    date: new Date("2026-02-08"),
    category: "sports",
    importance: "high",
    description: "NFL Championship Game",
    marketImpact: "neutral",
    relatedMarkets: ["super bowl", "nfl", "football", "chiefs", "49ers"],
  },
  {
    id: "nba-finals-2026",
    title: "NBA Finals Start",
    date: new Date("2026-06-04"),
    category: "sports",
    importance: "high",
    description: "NBA Championship Series begins",
    marketImpact: "neutral",
    relatedMarkets: ["nba", "basketball", "finals", "championship"],
  },
  {
    id: "world-cup-2026",
    title: "FIFA World Cup 2026",
    date: new Date("2026-06-11"),
    category: "sports",
    importance: "high",
    description: "FIFA World Cup hosted by USA, Canada, Mexico",
    marketImpact: "neutral",
    relatedMarkets: ["world cup", "fifa", "soccer", "football"],
  },
  {
    id: "march-madness-2026",
    title: "March Madness Final Four",
    date: new Date("2026-04-04"),
    category: "sports",
    importance: "medium",
    description: "NCAA Basketball Tournament Final Four",
    marketImpact: "neutral",
    relatedMarkets: ["march madness", "ncaa", "basketball", "final four"],
  },

  // ==================== TECH ====================
  {
    id: "apple-wwdc-2026",
    title: "Apple WWDC 2026",
    date: new Date("2026-06-08"),
    category: "tech",
    importance: "medium",
    description: "Apple Worldwide Developers Conference",
    marketImpact: "neutral",
    relatedMarkets: ["apple", "iphone", "ios", "wwdc"],
  },
  {
    id: "google-io-2026",
    title: "Google I/O 2026",
    date: new Date("2026-05-12"),
    category: "tech",
    importance: "medium",
    description: "Google Developer Conference",
    marketImpact: "neutral",
    relatedMarkets: ["google", "android", "ai", "gemini"],
  },
];

// ============================================================
// HELPER FUNCTIONS
// ============================================================

function isToday(date: Date): boolean {
  const today = new Date();
  return date.toDateString() === today.toDateString();
}

function isThisWeek(date: Date): boolean {
  const today = new Date();
  const weekFromNow = new Date(today.getTime() + 7 * 24 * 60 * 60 * 1000);
  return date >= today && date <= weekFromNow;
}

function daysUntil(date: Date): number {
  const today = new Date();
  const diff = date.getTime() - today.getTime();
  return Math.ceil(diff / (1000 * 60 * 60 * 24));
}

// ============================================================
// MAIN CALENDAR FUNCTIONS
// ============================================================

export function getUpcomingEvents(limit: number = 10): CalendarEvent[] {
  const now = new Date();
  
  return EVENTS_2026
    .filter(e => e.date >= now)
    .sort((a, b) => a.date.getTime() - b.date.getTime())
    .slice(0, limit);
}

export function getTodayEvents(): CalendarEvent[] {
  return EVENTS_2026.filter(e => isToday(e.date));
}

export function getThisWeekEvents(): CalendarEvent[] {
  return EVENTS_2026
    .filter(e => isThisWeek(e.date))
    .sort((a, b) => a.date.getTime() - b.date.getTime());
}

export function getEventsByCategory(category: CalendarEvent["category"]): CalendarEvent[] {
  const now = new Date();
  return EVENTS_2026
    .filter(e => e.category === category && e.date >= now)
    .sort((a, b) => a.date.getTime() - b.date.getTime());
}

export function getHighImportanceEvents(days: number = 30): CalendarEvent[] {
  const now = new Date();
  const cutoff = new Date(now.getTime() + days * 24 * 60 * 60 * 1000);
  
  return EVENTS_2026
    .filter(e => e.importance === "high" && e.date >= now && e.date <= cutoff)
    .sort((a, b) => a.date.getTime() - b.date.getTime());
}

// ============================================================
// MARKET RELEVANCE
// ============================================================

export function getEventsForMarket(marketQuestion: string): CalendarEvent[] {
  const questionLower = marketQuestion.toLowerCase();
  const now = new Date();
  
  return EVENTS_2026.filter(event => {
    if (event.date < now) return false;
    
    // Check if any related market keywords match
    for (const keyword of event.relatedMarkets || []) {
      if (questionLower.includes(keyword.toLowerCase())) {
        return true;
      }
    }
    
    // Also check title and description
    if (questionLower.includes(event.title.toLowerCase())) return true;
    if (event.description && questionLower.includes(event.description.toLowerCase())) return true;
    
    return false;
  }).sort((a, b) => a.date.getTime() - b.date.getTime());
}

export function getNextRelevantEvent(marketQuestion: string): CalendarEvent | null {
  const events = getEventsForMarket(marketQuestion);
  return events.length > 0 ? events[0] : null;
}

// ============================================================
// EVENT INTELLIGENCE
// ============================================================

export function getEventIntelligence(): EventIntelligence {
  const upcoming = getUpcomingEvents(20);
  const today = getTodayEvents();
  const thisWeek = getThisWeekEvents();
  const highImportance = getHighImportanceEvents(7);
  const nextMajor = highImportance.length > 0 ? highImportance[0] : null;

  // Build market relevance map
  const marketRelevance = new Map<string, CalendarEvent[]>();
  const categories = ["politics", "crypto", "finance", "sports", "tech"];
  
  for (const cat of categories) {
    const events = getEventsByCategory(cat as CalendarEvent["category"]);
    if (events.length > 0) {
      marketRelevance.set(cat, events.slice(0, 5));
    }
  }

  return {
    upcomingEvents: upcoming,
    todayEvents: today,
    thisWeekEvents: thisWeek,
    nextMajorEvent: nextMajor,
    marketRelevance,
  };
}

// ============================================================
// EVENT-BASED TRADING SIGNAL
// ============================================================

export interface EventTradingSignal {
  hasRelevantEvent: boolean;
  eventName: string;
  daysUntilEvent: number;
  marketImpact: "bullish" | "bearish" | "neutral" | "volatile";
  recommendation: string;
  riskLevel: "high" | "medium" | "low";
}

export function getEventTradingSignal(marketQuestion: string): EventTradingSignal {
  const event = getNextRelevantEvent(marketQuestion);
  
  if (!event) {
    return {
      hasRelevantEvent: false,
      eventName: "",
      daysUntilEvent: -1,
      marketImpact: "neutral",
      recommendation: "No relevant events found",
      riskLevel: "low",
    };
  }

  const days = daysUntil(event.date);
  
  // Determine risk level based on time to event
  let riskLevel: "high" | "medium" | "low" = "low";
  if (days <= 1) riskLevel = "high";
  else if (days <= 7) riskLevel = "medium";
  
  // Generate recommendation
  let recommendation = "";
  
  if (event.marketImpact === "volatile") {
    if (days <= 1) {
      recommendation = `CAUTION: ${event.title} is imminent. Expect high volatility.`;
    } else if (days <= 7) {
      recommendation = `Monitor closely: ${event.title} in ${days} days may cause significant moves.`;
    } else {
      recommendation = `Upcoming: ${event.title} in ${days} days. Plan accordingly.`;
    }
  } else if (event.marketImpact === "bullish") {
    recommendation = `Potentially bullish: ${event.title} in ${days} days.`;
  } else if (event.marketImpact === "bearish") {
    recommendation = `Potentially bearish: ${event.title} in ${days} days.`;
  } else {
    recommendation = `Event: ${event.title} in ${days} days.`;
  }

  return {
    hasRelevantEvent: true,
    eventName: event.title,
    daysUntilEvent: days,
    marketImpact: event.marketImpact,
    recommendation,
    riskLevel,
  };
}

// ============================================================
// FORMATTED OUTPUT
// ============================================================

export function formatEventCalendar(): string {
  const intelligence = getEventIntelligence();
  let output = "📅 EVENT CALENDAR\n";
  output += "=".repeat(50) + "\n\n";

  if (intelligence.todayEvents.length > 0) {
    output += "🔴 TODAY:\n";
    for (const event of intelligence.todayEvents) {
      output += `  • ${event.title} [${event.importance.toUpperCase()}]\n`;
    }
    output += "\n";
  }

  if (intelligence.thisWeekEvents.length > 0) {
    output += "📆 THIS WEEK:\n";
    for (const event of intelligence.thisWeekEvents) {
      const days = daysUntil(event.date);
      output += `  • ${event.title} (${days}d) [${event.category}]\n`;
    }
    output += "\n";
  }

  if (intelligence.nextMajorEvent) {
    const days = daysUntil(intelligence.nextMajorEvent.date);
    output += `⭐ NEXT MAJOR: ${intelligence.nextMajorEvent.title} in ${days} days\n`;
  }

  return output;
}

// ============================================================
// ADD CUSTOM EVENT
// ============================================================

export function addCustomEvent(event: CalendarEvent): void {
  EVENTS_2026.push(event);
}

export function getEventCount(): number {
  return EVENTS_2026.length;
}
