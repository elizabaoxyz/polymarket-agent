/**
 * ElizaBAO Autonomy API Server
 * 
 * REST API for controlling the autonomous trading system.
 * 
 * @author ElizaBAO
 */

import "dotenv/config";
import { Hono } from "hono";
import { cors } from "hono/cors";
import { serve } from "@hono/node-server";

import {
  initializeService,
  startAutonomy,
  stopAutonomy,
  getAutonomyStatus,
} from "./autonomy.js";

import { getPolymarketService } from "../packages/plugin-polymarket/src/index.js";
import {
  predictElonTweets,
  calculateEdge,
  ELON_EDGE_CONFIG,
  ELON_HISTORICAL_DATA,
  extractDateRange,
  parseBucketRange,
} from "../packages/plugin-polymarket/src/elon-prediction.js";
import {
  getElonTweetCount,
  getAllElonTrackings,
} from "../packages/plugin-polymarket/src/xtracker.js";

const PORT = parseInt(process.env.PORT || "3002");
const app = new Hono();

// Middleware
app.use("/*", cors());

// Health check
app.get("/", (c) => c.json({
  name: "ElizaBAO Autonomy API",
  version: "2.0.0",
  status: "running",
  features: [
    "Elon Prediction Engine",
    "Edge Calculation",
    "XTracker Integration",
    "Claude AI",
    "TP Limit Orders",
    "Position Persistence",
  ],
}));

// ============================================================
// AUTONOMY CONTROL
// ============================================================

app.get("/api/v2/autonomy/status", (c) => {
  return c.json({ success: true, data: getAutonomyStatus() });
});

app.post("/api/v2/autonomy/start", async (c) => {
  const service = getPolymarketService();
  if (!service) {
    await initializeService();
  }
  
  startAutonomy().catch(console.error);
  return c.json({
    success: true,
    message: "Autonomy started",
    data: getAutonomyStatus(),
  });
});

app.post("/api/v2/autonomy/stop", (c) => {
  stopAutonomy();
  return c.json({
    success: true,
    message: "Autonomy stopped",
    data: getAutonomyStatus(),
  });
});

// ============================================================
// POSITIONS
// ============================================================

app.get("/api/v2/positions", (c) => {
  const service = getPolymarketService();
  if (!service) {
    return c.json({ success: false, error: "Service not initialized" }, 503);
  }

  return c.json({
    success: true,
    data: {
      open: service.getOpenPositions(),
      closed: service.getClosedPositions().slice(-20),
      totalPnl: service.getTotalPnl(),
      tradedMarkets: service.getTradedMarkets(),
      openElonPositions: service.getOpenElonPositions(),
    },
  });
});

// ============================================================
// ELON PREDICTION
// ============================================================

app.get("/api/v2/elon/prediction", async (c) => {
  try {
    const elonData = await getElonTweetCount();
    if (!elonData) {
      return c.json({ success: false, error: "Could not fetch Elon data" });
    }

    const elapsedHours = (Date.now() - elonData.startDate.getTime()) / (1000 * 60 * 60);
    const totalHours = (elonData.endDate.getTime() - elonData.startDate.getTime()) / (1000 * 60 * 60);
    const prediction = predictElonTweets(elonData.count, elapsedHours, totalHours);

    return c.json({
      success: true,
      data: {
        currentCount: elonData.count,
        startDate: elonData.startDate,
        endDate: elonData.endDate,
        elapsedHours: Math.round(elapsedHours),
        remainingHours: Math.round(totalHours - elapsedHours),
        ...prediction,
        historicalPeriodsUsed: ELON_HISTORICAL_DATA.historicalPeriods.length,
      },
    });
  } catch (e: any) {
    return c.json({ success: false, error: e.message });
  }
});

app.get("/api/v2/elon/edge", async (c) => {
  try {
    const service = getPolymarketService();
    if (!service) {
      return c.json({ success: false, error: "Service not initialized" }, 503);
    }

    const markets = await service.searchMarkets("elon tweets", 50);
    const tweetMarkets = markets.filter(m =>
      m.question?.toLowerCase().includes("tweet") &&
      m.question?.toLowerCase().includes("elon")
    );

    const results: any[] = [];

    // Group by event
    const eventGroups: { [key: string]: any[] } = {};
    for (const m of tweetMarkets) {
      const eventSlug = m.eventSlug || "unknown";
      if (!eventGroups[eventSlug]) eventGroups[eventSlug] = [];
      eventGroups[eventSlug].push(m);
    }

    for (const [eventSlug, eventMarkets] of Object.entries(eventGroups)) {
      const firstMarket = eventMarkets[0];
      const marketDates = extractDateRange(firstMarket.question || "");
      if (!marketDates) continue;

      const months: { [key: string]: number } = {
        january: 0, february: 1, march: 2, april: 3, may: 4, june: 5,
        july: 6, august: 7, september: 8, october: 9, november: 10, december: 11,
      };

      const year = 2026;
      const startDate = new Date(year, months[marketDates.startMonth], marketDates.startDay, 12, 0, 0);
      const endDate = new Date(year, months[marketDates.endMonth], marketDates.endDay, 12, 0, 0);
      if (endDate < startDate) endDate.setFullYear(year + 1);

      const now = Date.now();
      const elapsedHours = Math.max(0, (now - startDate.getTime()) / (1000 * 60 * 60));
      const totalHours = (endDate.getTime() - startDate.getTime()) / (1000 * 60 * 60);

      let currentCount = 0;
      if (now > startDate.getTime()) {
        try {
          const trackings = await getAllElonTrackings();
          for (const t of trackings) {
            const startDiff = Math.abs(t.startDate.getTime() - startDate.getTime()) / (1000 * 60 * 60 * 24);
            const endDiff = Math.abs(t.endDate.getTime() - endDate.getTime()) / (1000 * 60 * 60 * 24);
            if (startDiff < 3 && endDiff < 3) {
              currentCount = t.count;
              break;
            }
          }
        } catch {}
      }

      const prediction = predictElonTweets(currentCount, elapsedHours, totalHours);
      const rates = ELON_HISTORICAL_DATA.historicalPeriods.map(p => p.rate);
      const avgRate = rates.reduce((a, b) => a + b, 0) / rates.length;
      const variance = rates.reduce((sum, r) => sum + Math.pow(r - avgRate, 2), 0) / rates.length;
      const stdDev = Math.sqrt(variance) * totalHours;

      const eventResult = {
        event: firstMarket.eventTitle || eventSlug,
        prediction: prediction.predicted,
        currentCount,
        elapsedHours: Math.round(elapsedHours),
        totalHours: Math.round(totalHours),
        buckets: [] as any[],
      };

      for (const market of eventMarkets) {
        const bucket = parseBucketRange(market.question || "");
        if (!bucket) continue;

        let yesPrice = 0.5;
        try {
          yesPrice = parseFloat(market.outcomePrices[0]) || 0.5;
        } catch {}

        const edgeResult = calculateEdge(bucket.lower, bucket.upper, prediction.predicted, stdDev, yesPrice);
        const alreadyTraded = service.hasTraded(market.id);

        eventResult.buckets.push({
          range: `${bucket.lower}-${bucket.upper}`,
          marketPrice: Math.round(yesPrice * 100) + "%",
          ourProbability: Math.round(edgeResult.probability * 100) + "%",
          edge: Math.round(edgeResult.edge * 100) + "%",
          edgeLevel: edgeResult.level,
          shouldTrade: edgeResult.edge >= ELON_EDGE_CONFIG.minEdge && !alreadyTraded,
          alreadyTraded,
          marketId: market.id,
        });
      }

      eventResult.buckets.sort((a, b) => parseFloat(b.edge) - parseFloat(a.edge));
      results.push(eventResult);
    }

    return c.json({
      success: true,
      data: {
        edgeConfig: {
          minEdge: ELON_EDGE_CONFIG.minEdge * 100,
          mediumEdge: ELON_EDGE_CONFIG.mediumEdge * 100,
          highEdge: ELON_EDGE_CONFIG.highEdge * 100,
        },
        events: results,
      },
    });
  } catch (e: any) {
    return c.json({ success: false, error: e.message });
  }
});

// ============================================================
// LEGACY COMPATIBILITY (v1 endpoints)
// ============================================================

app.get("/api/autonomy/status", (c) => c.redirect("/api/v2/autonomy/status"));
app.post("/api/autonomy/start", (c) => c.redirect("/api/v2/autonomy/start", 307));
app.post("/api/autonomy/stop", (c) => c.redirect("/api/v2/autonomy/stop", 307));
app.get("/api/positions", (c) => c.redirect("/api/v2/positions"));
app.get("/api/elon-prediction", (c) => c.redirect("/api/v2/elon/prediction"));
app.get("/api/elon-edge", (c) => c.redirect("/api/v2/elon/edge"));

// ============================================================
// SERVER STARTUP
// ============================================================

let serviceReady = false;

initializeService()
  .then(() => {
    serviceReady = true;
    console.log("✅ Service ready");
  })
  .catch((e) => {
    console.error("Failed to initialize service:", e);
  });

console.log(`
╔════════════════════════════════════════════════════════════════════════╗
║                  ElizaBAO AUTONOMY API v2.0.0                          ║
╠════════════════════════════════════════════════════════════════════════╣
║  📡 REST API for autonomous trading control                            ║
║  🔌 Port: ${PORT.toString().padEnd(4)}                                                         ║
╠════════════════════════════════════════════════════════════════════════╣
║  Endpoints:                                                            ║
║  GET  /api/v2/autonomy/status  - Get status                            ║
║  POST /api/v2/autonomy/start   - Start autonomy                        ║
║  POST /api/v2/autonomy/stop    - Stop autonomy                         ║
║  GET  /api/v2/positions        - Get positions                         ║
║  GET  /api/v2/elon/prediction  - Elon prediction                       ║
║  GET  /api/v2/elon/edge        - Edge analysis                         ║
╚════════════════════════════════════════════════════════════════════════╝
`);

serve({ fetch: app.fetch, port: PORT }, (info) => {
  console.log(`Server running on http://0.0.0.0:${info.port}`);
});
