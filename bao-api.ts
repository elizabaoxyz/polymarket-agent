/**
 * elizaBAO acceptance-layer API (Phase 0).
 *
 * Implements the read path of the BAO spec:
 *  - live market list (proxied from Polymarket gamma, server-side)
 *  - immutable market snapshots (canonical JSON, sha256-addressed)
 *  - task list (manual JSON seed per Phase 0, enriched with live snapshots)
 *  - public ledger (append-only JSON)
 *
 * No token logic. USDC-only pools. See /ACCEPTANCE.md.
 */

import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const GAMMA_API = "https://gamma-api.polymarket.com";

// ---------------------------------------------------------------------------
// Types (mirrors /schemas/*.schema.json)
// ---------------------------------------------------------------------------

export interface MarketSnapshot {
  snapshotHash: string;
  marketId: string;
  capturedAt: string;
  midYes: number;
  bidYes?: number;
  askYes?: number;
  liquidityUsd?: number;
  volumeUsd?: number;
  rawRef: string;
}

export interface BaoMarket {
  id: string;
  venue: "polymarket";
  slug: string;
  title: string;
  rulesUrl: string;
  closeAt: string;
  status: "open" | "closed" | "resolved";
  midYes: number;
  liquidityUsd: number;
  volumeUsd: number;
}

export interface BaoTask {
  id: string;
  kind: "frame" | "evidence" | "rules_ambiguity" | "postmortem" | "flow_label" | "rwa_map";
  marketSlug: string;
  policyUrl: string;
  poolUsdc: string;
  reviewerPoolUsdc: string;
  payoutAsset: "USDC";
  chain: "base";
  sponsor: string;
  opensAt: string;
  submitBy: string;
  maxAccepted: number;
  status: "draft" | "open" | "review" | "scoring" | "paid" | "expired" | "cancelled";
  brief: string;
}

export interface LedgerRow {
  at: string;
  kind: "accept" | "reject" | "score" | "payout" | "refund" | "genesis" | "task_open";
  refId: string;
  marketId?: string;
  usdc?: string;
  tx?: string;
  publicNote?: string;
}

// ---------------------------------------------------------------------------
// Canonicalization + hashing (spec 3.2)
// ---------------------------------------------------------------------------

/** Fixed 6-decimal precision, sorted keys, no extra fields. */
export function canonicalize(obj: Record<string, unknown>): string {
  const keys = Object.keys(obj).sort();
  const parts: string[] = [];
  for (const k of keys) {
    const v = obj[k];
    if (v === undefined || v === null) continue;
    if (typeof v === "number") {
      parts.push(`"${k}":${v.toFixed(6)}`);
    } else {
      parts.push(`"${k}":${JSON.stringify(v)}`);
    }
  }
  return `{${parts.join(",")}}`;
}

export function sha256Hex(input: string): string {
  return createHash("sha256").update(input, "utf8").digest("hex");
}

// ---------------------------------------------------------------------------
// Gamma fetch helpers
// ---------------------------------------------------------------------------

type GammaMarket = {
  id: string;
  slug: string;
  question?: string;
  title?: string;
  endDate?: string;
  closed?: boolean;
  lastTradePrice?: number;
  bestBid?: number;
  bestAsk?: number;
  liquidityNum?: number;
  volumeNum?: number;
};

async function gammaFetch(pathAndQuery: string): Promise<unknown> {
  const res = await fetch(`${GAMMA_API}${pathAndQuery}`, {
    headers: { accept: "application/json" },
  });
  if (!res.ok) throw new Error(`gamma ${res.status}`);
  return res.json();
}

function toBaoMarket(m: GammaMarket): BaoMarket {
  return {
    id: `polymarket:${m.id}`,
    venue: "polymarket",
    slug: m.slug,
    title: m.question ?? m.title ?? m.slug,
    rulesUrl: `https://polymarket.com/market/${m.slug}`,
    closeAt: m.endDate ?? "",
    status: m.closed ? "closed" : "open",
    midYes: typeof m.bestBid === "number" && typeof m.bestAsk === "number" && m.bestAsk > 0
      ? Number(((m.bestBid + m.bestAsk) / 2).toFixed(6))
      : Number((m.lastTradePrice ?? 0).toFixed(6)),
    liquidityUsd: Math.round(m.liquidityNum ?? 0),
    volumeUsd: Math.round(m.volumeNum ?? 0),
  };
}

// Simple in-memory caches so we do not hammer gamma
const cache = new Map<string, { at: number; data: unknown }>();
async function cached<T>(key: string, ttlMs: number, fn: () => Promise<T>): Promise<T> {
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < ttlMs) return hit.data as T;
  const data = await fn();
  cache.set(key, { at: Date.now(), data });
  return data;
}

// ---------------------------------------------------------------------------
// Public API surface
// ---------------------------------------------------------------------------

/** Live tradeable board: liquid, mid-probability markets worth annotating. */
export async function listMarkets(limit = 24): Promise<BaoMarket[]> {
  return cached(`markets:${limit}`, 60_000, async () => {
    const raw = (await gammaFetch(
      `/markets?closed=false&order=volume24hr&ascending=false&limit=100`,
    )) as GammaMarket[];
    const board = raw
      .map(toBaoMarket)
      .filter((m) => m.midYes >= 0.03 && m.midYes <= 0.97 && m.liquidityUsd > 5_000);
    return board.slice(0, limit);
  });
}

export async function getMarketBySlug(slug: string): Promise<BaoMarket | null> {
  return cached(`market:${slug}`, 30_000, async () => {
    const raw = (await gammaFetch(`/markets?slug=${encodeURIComponent(slug)}`)) as GammaMarket[];
    if (!raw?.length) return null;
    return toBaoMarket(raw[0]);
  });
}

/**
 * Capture a snapshot for a market at time T (now).
 * The hash is computed over the canonical JSON of the frame fields —
 * annotations bind to this hash, never to a live ticker.
 */
export async function captureSnapshot(slug: string): Promise<MarketSnapshot | null> {
  const m = await getMarketBySlug(slug);
  if (!m) return null;
  const capturedAt = new Date().toISOString();
  const core = {
    marketId: m.id,
    capturedAt,
    midYes: m.midYes,
    liquidityUsd: m.liquidityUsd,
    volumeUsd: m.volumeUsd,
  };
  const canonical = canonicalize(core);
  const snapshotHash = sha256Hex(canonical);
  return {
    snapshotHash,
    marketId: m.id,
    capturedAt,
    midYes: m.midYes,
    liquidityUsd: m.liquidityUsd,
    volumeUsd: m.volumeUsd,
    rawRef: `gamma:/markets?slug=${slug}@${capturedAt}`,
  };
}

function readJsonFile<T>(rel: string): T {
  return JSON.parse(readFileSync(path.join(__dirname, rel), "utf8")) as T;
}

/** Tasks: Phase 0 manual seed, enriched with live market data. */
export async function listTasks(): Promise<Array<BaoTask & { market?: BaoMarket | null }>> {
  const seed = readJsonFile<BaoTask[]>("data/bao/tasks.json");
  const now = Date.now();
  const enriched = await Promise.all(
    seed.map(async (t) => {
      let status = t.status;
      if (status === "open" && now > Date.parse(t.submitBy)) status = "review";
      let market: BaoMarket | null = null;
      try {
        market = await getMarketBySlug(t.marketSlug);
      } catch {
        market = null;
      }
      return { ...t, status, market };
    }),
  );
  return enriched;
}

export function listLedger(): LedgerRow[] {
  try {
    return readJsonFile<LedgerRow[]>("data/bao/ledger.json");
  } catch {
    return [];
  }
}

// ---------------------------------------------------------------------------
// HTTP handler — mounted by ws-server under /v1/*
// ---------------------------------------------------------------------------

function json(data: unknown, status = 200): Response {
  return Response.json(data, {
    status,
    headers: { "Access-Control-Allow-Origin": "*", "Cache-Control": "no-store" },
  });
}

export async function handleBaoRequest(url: URL): Promise<Response | null> {
  try {
    if (url.pathname === "/v1/markets") {
      const limit = Math.min(Number(url.searchParams.get("limit") ?? 24), 60);
      return json(await listMarkets(limit));
    }
    const marketMatch = url.pathname.match(/^\/v1\/markets\/([\w-]+)$/);
    if (marketMatch) {
      const m = await getMarketBySlug(marketMatch[1]);
      return m ? json(m) : json({ error: "market not found" }, 404);
    }
    const snapMatch = url.pathname.match(/^\/v1\/snapshots\/([\w-]+)$/);
    if (snapMatch) {
      const s = await captureSnapshot(snapMatch[1]);
      return s ? json(s) : json({ error: "market not found" }, 404);
    }
    if (url.pathname === "/v1/tasks") {
      return json(await listTasks());
    }
    if (url.pathname === "/v1/ledger") {
      return json(listLedger());
    }
    if (url.pathname === "/v1/leaderboard") {
      // Honest empty state: no accepted rows yet, so no numbers.
      return json({ window: "90d", rows: [], note: "No accepted annotations scored yet. The ledger is the only source of performance claims." });
    }
    return null;
  } catch (err) {
    return json({ error: err instanceof Error ? err.message : String(err) }, 502);
  }
}
