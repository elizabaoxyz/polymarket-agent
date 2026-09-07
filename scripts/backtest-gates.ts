/**
 * Backtest of the elizaBAO gate engine (spec section 4).
 * Runs every reject code plus the happy path against a fixed snapshot.
 * Usage: bun scripts/backtest-gates.ts
 */
import { runGates, rememberSnapshot, type BaoTask, type MarketSnapshot, type FrameSubmission } from "../bao-api";

const snapshot: MarketSnapshot = {
  snapshotHash: "a".repeat(64),
  marketId: "polymarket:test-1",
  capturedAt: "2026-09-07T12:00:00.000Z",
  midYes: 0.42,
  liquidityUsd: 100000,
  volumeUsd: 50000,
  rawRef: "test",
};
rememberSnapshot(snapshot);

const task: BaoTask = {
  id: "task-test",
  kind: "frame",
  marketSlug: "test-market",
  policyUrl: "https://example.com/policy",
  poolUsdc: "100.00",
  reviewerPoolUsdc: "15.00",
  payoutAsset: "USDC",
  chain: "base",
  sponsor: "test",
  opensAt: "2026-09-01T00:00:00.000Z",
  submitBy: "2026-12-31T00:00:00.000Z",
  maxAccepted: 5,
  status: "open",
  brief: "test",
};

const NOW = Date.parse("2026-09-08T00:00:00.000Z");

const good: FrameSubmission = {
  snapshotHash: snapshot.snapshotHash,
  contributorId: "tester-01",
  pFair: 0.3,
  pMarket: 0.42,
  horizon: "to_resolution",
  confidence: 3,
  drivers: [
    {
      claim: "A dated primary source exists",
      url: "https://example.com/article",
      quote: "an excerpt present at the url",
      publishedAt: "2026-09-06T00:00:00.000Z",
      kind: "primary",
    },
  ],
  invalidation: "A ceasefire announcement would flip this view.",
};

let failures = 0;
function expect(name: string, expectedCode: string | null, body: Partial<FrameSubmission>, when = NOW) {
  const { rejected } = runGates(body, task, body.snapshotHash === snapshot.snapshotHash ? snapshot : undefined, when);
  const got = rejected?.code ?? null;
  const ok = got === expectedCode;
  if (!ok) failures++;
  console.log(`${ok ? "PASS" : "FAIL"}  ${name.padEnd(28)} expected=${expectedCode ?? "accept"} got=${got ?? "accept"}${rejected ? ` — ${rejected.detail.slice(0, 90)}` : ""}`);
}

// reject paths (order matters: run before the happy path registers DUP_HASH)
expect("SCHEMA: missing fields", "SCHEMA", { contributorId: "x" });
expect("SCHEMA: pFair out of range", "SCHEMA", { ...good, pFair: 1.5 });
expect("SCHEMA: 0 drivers", "SCHEMA", { ...good, drivers: [] });
expect("SCHEMA: 6 drivers", "SCHEMA", { ...good, drivers: Array(6).fill(good.drivers[0]) });
expect("SCHEMA: bad driver url", "SCHEMA", { ...good, drivers: [{ ...good.drivers[0], url: "ftp://x" }] });
expect("SNAPSHOT_MISSING", "SNAPSHOT_MISSING", { ...good, snapshotHash: "b".repeat(64) });
expect("BOOK_DRIFT: pMarket off mid", "BOOK_DRIFT", { ...good, pMarket: 0.5 });
expect("FUTURE_EVIDENCE: post-T source", "FUTURE_EVIDENCE", {
  ...good,
  drivers: [{ ...good.drivers[0], publishedAt: "2026-09-07T13:00:00.000Z" }],
});
expect("AFTER_CUTOFF", "AFTER_CUTOFF", good, Date.parse("2027-01-01T00:00:00.000Z"));
expect("CONFIDENCE_EMPTY: no invalidation", "CONFIDENCE_EMPTY", { ...good, invalidation: "  " });

// happy path
expect("ACCEPT: valid frame", null, good);
// duplicate of the accepted frame
expect("DUP_HASH: exact resubmit", "DUP_HASH", good);

console.log(failures === 0 ? "\nALL GATES BEHAVE PER SPEC" : `\n${failures} FAILURES`);
process.exit(failures === 0 ? 0 : 1);
