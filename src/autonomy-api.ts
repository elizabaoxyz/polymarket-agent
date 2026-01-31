/**
 * ElizaBAO Autonomy API Server
 * 
 * REST API wrapper for the ElizaOS v2.0.0 autonomy service
 */

import "dotenv/config";
import { Hono } from "hono";
import { cors } from "hono/cors";
import { serve } from "@hono/node-server";

import {
  initializeRuntime,
  startAutonomy,
  stopAutonomy,
  getAutonomyStatus,
} from "./autonomy.js";

const PORT = process.env.PORT || 3002;
const app = new Hono();

// CORS
app.use("/*", cors({ origin: "*" }));

// Health check
app.get("/health", (c) => c.json({ status: "ok", version: "2.0.0", runtime: "elizaos" }));

// Initialize runtime on startup
let runtimeReady = false;
initializeRuntime()
  .then(() => {
    runtimeReady = true;
    console.log("✅ Runtime ready");
  })
  .catch((err) => {
    console.error("❌ Failed to initialize runtime:", err);
  });

// ============================================================
// AUTONOMY ENDPOINTS
// ============================================================

app.post("/api/v2/autonomy/start", async (c) => {
  if (!runtimeReady) {
    return c.json({ success: false, error: "Runtime not ready" }, 503);
  }
  
  // Start in background
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
    message: "Autonomy stopping",
    data: getAutonomyStatus(),
  });
});

app.get("/api/v2/autonomy/status", (c) => {
  return c.json({
    success: true,
    data: {
      ...getAutonomyStatus(),
      runtimeReady,
      version: "2.0.0",
    },
  });
});

// ============================================================
// LEGACY COMPATIBILITY
// ============================================================

// Forward legacy endpoints to v2
app.post("/api/autonomy/start", async (c) => {
  const response = await app.fetch(new Request("http://localhost/api/v2/autonomy/start", { method: "POST" }), c.env);
  return response;
});

app.post("/api/autonomy/stop", (c) => {
  stopAutonomy();
  return c.json({ success: true });
});

app.get("/api/autonomy/status", (c) => {
  const status = getAutonomyStatus();
  return c.json({
    success: true,
    data: {
      enabled: status.enabled,
      running: status.running,
      autoTradeEnabled: true, // Legacy field
      totalScans: status.totalScans,
      totalTrades: status.totalTrades,
    },
  });
});

// ============================================================
// START SERVER
// ============================================================

console.log(`
╔════════════════════════════════════════════════════════════════════════╗
║                 ElizaBAO AUTONOMY API v2.0.0                           ║
╠════════════════════════════════════════════════════════════════════════╣
║  🌐 Server: http://localhost:${PORT}                                      ║
║  🤖 Runtime: ElizaOS v2.0.0                                            ║
║  📦 Plugin: @elizabao/plugin-polymarket                                ║
╠════════════════════════════════════════════════════════════════════════╣
║  Endpoints:                                                            ║
║  POST /api/v2/autonomy/start  - Start autonomous trading               ║
║  POST /api/v2/autonomy/stop   - Stop autonomous trading                ║
║  GET  /api/v2/autonomy/status - Get current status                     ║
╚════════════════════════════════════════════════════════════════════════╝
`);

serve({ fetch: app.fetch, port: Number(PORT) }, (info) => {
  console.log(`🚀 Server running on http://localhost:${info.port}`);
});
