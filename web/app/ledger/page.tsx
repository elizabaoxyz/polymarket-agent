"use client";

import { useEffect, useState } from "react";
import { BaoNav } from "@/components/bao-nav";
import { fetchLedger, type LedgerRow } from "@/lib/bao-api";

const KIND_COLOR: Record<string, string> = {
  accept: "var(--green)",
  reject: "var(--red)",
  score: "var(--accent-bright)",
  payout: "var(--green)",
  refund: "var(--amber)",
  genesis: "var(--text-muted)",
  task_open: "var(--accent)",
};

export default function LedgerPage() {
  const [rows, setRows] = useState<LedgerRow[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [filter, setFilter] = useState<string>("all");

  useEffect(() => {
    fetchLedger().then((r) => {
      setRows(r);
      setLoaded(true);
    });
  }, []);

  const kinds = ["all", ...Array.from(new Set(rows.map((r) => r.kind)))];
  const visible = filter === "all" ? rows : rows.filter((r) => r.kind === filter);
  const accepted = rows.filter((r) => r.kind === "accept").length;

  return (
    <div className="min-h-screen bg-[var(--bg)]">
      <BaoNav />
      <div className="scanline" />
      <main className="pt-20 max-w-4xl mx-auto px-4 pb-16">
        <div className="flex items-center gap-3 mb-2">
          <h1 className="mono text-lg tracking-widest">LEDGER</h1>
          <span className="live-dot" />
        </div>
        <p className="text-[12px] text-[var(--text-secondary)] mb-8 max-w-2xl">
          Append-only. Annotation id, market, excess vs book, payout hash. If we cannot show that row, we
          should not talk about performance.
        </p>

        {/* Honest empty state for performance */}
        {loaded && accepted === 0 && (
          <div className="border border-[var(--border)] bg-[var(--bg-panel)] p-5 mb-8 rounded-sm">
            <p className="mono text-[12px] leading-relaxed text-[var(--text-secondary)]">
              <span className="text-[var(--amber)]">▲</span> No accepted annotations have been scored yet.
              The first batch pays after its markets resolve. Until then this page shows locked pools and
              lifecycle events — and we quote no win rate.
            </p>
          </div>
        )}

        <div className="flex gap-2 mb-4 flex-wrap">
          {kinds.map((k) => (
            <button
              key={k}
              onClick={() => setFilter(k)}
              className={`mono text-[10px] tracking-widest px-3 py-1.5 border rounded-sm transition-colors ${
                filter === k
                  ? "border-[var(--accent)] text-[var(--accent-bright)] bg-[var(--accent-dim)]"
                  : "border-[var(--border)] text-[var(--text-muted)] hover:border-[var(--accent)]"
              }`}
            >
              {k.toUpperCase()}
            </button>
          ))}
        </div>

        <div className="border border-[var(--border)] rounded-sm overflow-hidden">
          {visible.map((r, i) => (
            <div
              key={`${r.refId}-${i}`}
              className="px-4 py-3 border-b border-[var(--border)] last:border-b-0 row-in"
              style={{ animationDelay: `${Math.min(i * 60, 500)}ms` }}
            >
              <div className="flex items-center gap-3 flex-wrap">
                <span className="mono text-[10px] text-[var(--text-muted)]">{r.at}</span>
                <span
                  className="mono text-[10px] tracking-widest"
                  style={{ color: KIND_COLOR[r.kind] ?? "var(--text-secondary)" }}
                >
                  {r.kind.toUpperCase()}
                </span>
                <span className="mono text-[10px] text-[var(--text-secondary)]">{r.refId}</span>
                {r.marketId && <span className="mono text-[10px] text-[var(--text-muted)]">{r.marketId}</span>}
                {r.usdc && <span className="mono text-[10px] text-[var(--green)]">${r.usdc}</span>}
                {r.tx && (
                  <a
                    href={`https://basescan.org/tx/${r.tx}`}
                    target="_blank"
                    rel="noreferrer"
                    className="mono text-[10px] text-[var(--accent-bright)] underline underline-offset-2"
                  >
                    tx
                  </a>
                )}
              </div>
              {r.publicNote && (
                <p className="text-[11px] text-[var(--text-secondary)] mt-1 leading-relaxed">{r.publicNote}</p>
              )}
            </div>
          ))}
          {loaded && visible.length === 0 && (
            <p className="mono text-[11px] text-[var(--text-muted)] p-4">no rows</p>
          )}
        </div>
      </main>
    </div>
  );
}
