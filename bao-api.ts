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
 *
 * Every issued snapshot is retained so a later submission can bind to it.
 */
const snapshotStore = new Map<string, MarketSnapshot>();
const SNAPSHOT_STORE_MAX = 5000;

export function rememberSnapshot(s: MarketSnapshot): void {
  if (snapshotStore.size >= SNAPSHOT_STORE_MAX) {
    const oldest = snapshotStore.keys().next().value;
    if (oldest) snapshotStore.delete(oldest);
  }
  snapshotStore.set(s.snapshotHash, s);
}

export function getSnapshotByHash(hash: string): MarketSnapshot | undefined {
  return snapshotStore.get(hash);
}

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
  const snap: MarketSnapshot = {
    snapshotHash,
    marketId: m.id,
    capturedAt,
    midYes: m.midYes,
    liquidityUsd: m.liquidityUsd,
    volumeUsd: m.volumeUsd,
    rawRef: `gamma:/markets?slug=${slug}@${capturedAt}`,
  };
  rememberSnapshot(snap);
  return snap;
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
// Gate engine + submissions (spec 3.4 / 4)
// ---------------------------------------------------------------------------

export interface Driver {
  claim: string;
  url: string;
  quote: string;
  publishedAt: string;
  kind: "primary" | "data" | "market" | "other";
}

export interface FrameSubmission {
  snapshotHash: string;
  contributorId: string;
  pFair: number;
  pMarket: number;
  horizon: "to_resolution" | "to_next_event";
  confidence: 1 | 2 | 3 | 4 | 5;
  drivers: Driver[];
  invalidation: string;
  notes?: string;
}

export interface GateResult {
  gate: string;
  pass: boolean;
  detail?: string;
}

export interface StoredAnnotation {
  id: string;
  taskId: string;
  marketId: string;
  snapshotHash: string;
  contributorId: string;
  submittedAt: string;
  status: "pending_review";
  frame: FrameSubmission;
  gateTrace: GateResult[];
}

const annotationStore = new Map<string, StoredAnnotation>();
const acceptedFrameHashes = new Set<string>();

function isIsoDate(s: unknown): s is string {
  return typeof s === "string" && !Number.isNaN(Date.parse(s));
}

/**
 * Run the automatic gates in spec order. First failure returns a typed
 * reject. Failures are free to fix — nothing is charged, nothing is stored.
 */
export function runGates(
  body: Partial<FrameSubmission>,
  task: BaoTask,
  snapshot: MarketSnapshot | undefined,
  now = Date.now(),
): { rejected?: { code: string; detail: string }; trace: GateResult[] } {
  const trace: GateResult[] = [];
  const fail = (code: string, detail: string) => {
    trace.push({ gate: code, pass: false, detail });
    return { rejected: { code, detail }, trace };
  };
  const pass = (code: string, detail?: string) => trace.push({ gate: code, pass: true, detail });

  // SCHEMA
  const schemaErrors: string[] = [];
  if (typeof body.snapshotHash !== "string" || body.snapshotHash.length !== 64)
    schemaErrors.push("snapshotHash: 64-char sha256 hex required");
  if (typeof body.contributorId !== "string" || body.contributorId.length < 3)
    schemaErrors.push("contributorId: string >= 3 chars required");
  if (typeof body.pFair !== "number" || body.pFair < 0.01 || body.pFair > 0.99)
    schemaErrors.push("pFair: number in [0.01, 0.99] required");
  if (typeof body.pMarket !== "number" || body.pMarket < 0.01 || body.pMarket > 0.99)
    schemaErrors.push("pMarket: number in [0.01, 0.99] required");
  if (body.horizon !== "to_resolution" && body.horizon !== "to_next_event")
    schemaErrors.push("horizon: 'to_resolution' | 'to_next_event' required");
  if (!Array.isArray(body.drivers) || body.drivers.length < 1 || body.drivers.length > 5)
    schemaErrors.push("drivers: array of 1-5 required");
  else
    for (const [i, d] of body.drivers.entries()) {
      if (!d || typeof d.claim !== "string" || !d.claim.trim())
        schemaErrors.push(`drivers[${i}].claim required`);
      if (!d || typeof d.url !== "string" || !/^https?:\/\//.test(d.url))
        schemaErrors.push(`drivers[${i}].url must be http(s)`);
      if (!d || typeof d.quote !== "string" || !d.quote.trim())
        schemaErrors.push(`drivers[${i}].quote required`);
      if (!d || !isIsoDate(d.publishedAt)) schemaErrors.push(`drivers[${i}].publishedAt must be ISO date`);
    }
  if (schemaErrors.length) return fail("SCHEMA", schemaErrors.join("; "));
  pass("SCHEMA");

  // SNAPSHOT_MISSING
  if (!snapshot)
    return fail(
      "SNAPSHOT_MISSING",
      `snapshotHash ${body.snapshotHash} unknown — capture one via GET /v1/snapshots/${task.marketSlug} first`,
    );
  pass("SNAPSHOT_MISSING");

  // BOOK_DRIFT — pMarket must copy the snapshot mid within 1 tick
  const drift = Math.abs((body.pMarket as number) - snapshot.midYes);
  if (drift > 0.01)
    return fail(
      "BOOK_DRIFT",
      `pMarket ${body.pMarket} is ${drift.toFixed(4)} off snapshot midYes ${snapshot.midYes} (max 0.01)`,
    );
  pass("BOOK_DRIFT");

  // FUTURE_EVIDENCE — every driver must predate the snapshot
  for (const d of body.drivers as Driver[]) {
    if (Date.parse(d.publishedAt) > Date.parse(snapshot.capturedAt))
      return fail(
        "FUTURE_EVIDENCE",
        `driver "${d.claim.slice(0, 60)}" published ${d.publishedAt} > snapshot ${snapshot.capturedAt}`,
      );
  }
  pass("FUTURE_EVIDENCE");

  // DEAD_SOURCE — deferred to adversarial review in Phase 0 (documented, not silent)
  pass("DEAD_SOURCE", "URL liveness + quote match verified at review stage in Phase 0");

  // DUP_HASH — exact canonical duplicate already submitted
  const canonical = canonicalize({
    snapshotHash: body.snapshotHash as string,
    pFair: body.pFair as number,
    drivers: JSON.stringify(body.drivers),
  });
  const dupHash = sha256Hex(canonical);
  if (acceptedFrameHashes.has(dupHash))
    return fail("DUP_HASH", "an identical frame against this snapshot was already submitted");
  pass("DUP_HASH");

  // AFTER_CUTOFF
  if (now > Date.parse(task.submitBy))
    return fail("AFTER_CUTOFF", `submitted after task cutoff ${task.submitBy}`);
  pass("AFTER_CUTOFF");

  // CONFIDENCE_EMPTY
  if (
    typeof body.confidence !== "number" ||
    body.confidence < 1 ||
    body.confidence > 5 ||
    typeof body.invalidation !== "string" ||
    !body.invalidation.trim()
  )
    return fail("CONFIDENCE_EMPTY", "confidence (1-5) and a non-empty invalidation are required");
  pass("CONFIDENCE_EMPTY");

  acceptedFrameHashes.add(dupHash);
  return { trace };
}

export async function submitAnnotation(taskId: string, body: unknown): Promise<Response> {
  const tasks = await listTasks();
  const task = tasks.find((t) => t.id === taskId);
  if (!task) return json({ error: `task ${taskId} not found` }, 404);
  if (task.status !== "open")
    return json({ error: `task ${taskId} is ${task.status}, not open` }, 409);
  if (task.kind !== "frame")
    return json(
      {
        error: `task ${taskId} is a '${task.kind}' task. This endpoint accepts frame.schema.json only in Phase 0 — ${task.kind} submissions open with the review loop.`,
      },
      409,
    );

  const frame = (body ?? {}) as Partial<FrameSubmission>;
  const snapshot =
    typeof frame.snapshotHash === "string" ? getSnapshotByHash(frame.snapshotHash) : undefined;

  const { rejected, trace } = runGates(frame, task, snapshot);
  if (rejected) {
    return json(
      {
        status: "rejected",
        reject: rejected,
        gateTrace: trace,
        note: "Gate failures are free to fix and resubmit. They do not pay.",
      },
      422,
    );
  }

  const submittedAt = new Date().toISOString();
  const id = `ann-${sha256Hex(`${taskId}:${frame.contributorId}:${submittedAt}`).slice(0, 12)}`;
  const stored: StoredAnnotation = {
    id,
    taskId,
    marketId: snapshot!.marketId,
    snapshotHash: frame.snapshotHash as string,
    contributorId: frame.contributorId as string,
    submittedAt,
    status: "pending_review",
    frame: frame as FrameSubmission,
    gateTrace: trace,
  };
  annotationStore.set(id, stored);

  return json(
    {
      status: "pending_review",
      annotationId: id,
      gateTrace: trace,
      next: "An opposing reviewer is assigned before resolution. Scoring happens after the market resolves; payout weight is max(0, brierBook - brierYours).",
    },
    201,
  );
}

export function getAnnotation(id: string): StoredAnnotation | undefined {
  return annotationStore.get(id);
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

export async function handleBaoRequest(url: URL, req?: Request): Promise<Response | null> {
  try {
    // POST /v1/tasks/:id/annotations — the real submit path
    const submitMatch = url.pathname.match(/^\/v1\/tasks\/([\w-]+)\/annotations$/);
    if (submitMatch) {
      if (req?.method !== "POST")
        return json({ error: "POST a frame JSON body (see /schemas/frame.schema.json)" }, 405);
      let body: unknown;
      try {
        body = await req.json();
      } catch {
        return json({ status: "rejected", reject: { code: "SCHEMA", detail: "body is not valid JSON" } }, 422);
      }
      return submitAnnotation(submitMatch[1], body);
    }
    const annMatch = url.pathname.match(/^\/v1\/annotations\/([\w-]+)$/);
    if (annMatch) {
      const a = getAnnotation(annMatch[1]);
      return a ? json(a) : json({ error: "annotation not found (submissions are in-memory in Phase 0)" }, 404);
    }
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
