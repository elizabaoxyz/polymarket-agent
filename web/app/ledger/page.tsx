"use client";

import { useEffect, useState } from "react";
import { Masthead } from "@/components/masthead";
import { fetchLedger, type LedgerRow } from "@/lib/bao-api";

const KINDS = ["all", "accept", "reject", "score", "payout", "refund", "task_open", "genesis"] as const;

const KIND_STAMP: Record<string, { label: string; cls: string }> = {
  genesis: { label: "GENESIS", cls: "stamp-ink" },
  task_open: { label: "TASK OPEN", cls: "stamp-blue" },
  accept: { label: "ACCEPTED", cls: "stamp-blue" },
  reject: { label: "REJECTED", cls: "stamp-red" },
  score: { label: "SCORED", cls: "stamp-blue" },
  payout: { label: "PAID", cls: "stamp-blue" },
  refund: { label: "REFUND", cls: "stamp-ink" },
};

export default function LedgerPage() {
  const [rows, setRows] = useState<LedgerRow[]>([]);
  const [filter, setFilter] = useState<string>("all");
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    fetchLedger().then((r) => {
      setRows(r);
      setLoaded(true);
    });
  }, []);

  const shown = rows.filter((r) => filter === "all" || r.kind === filter);
  const accepted = rows.filter((r) => r.kind === "accept").length;
  const paid = rows
    .filter((r) => r.kind === "payout")
    .reduce((s, r) => s + Number(r.usdc ?? 0), 0);

  return (
    <div className="paper min-h-screen">
      <Masthead dense />
      <main className="px-4 md:px-8 max-w-6xl mx-auto pb-16">
        <section className="pt-10 pb-6">
          <h1 className="font-display text-5xl md:text-7xl uppercase tracking-tight leading-[0.9] misprint-blue">
            The ledger
          </h1>
          <div className="halftone-fade-r h-8 mt-4 max-w-md opacity-50" />
          <p className="font-serif text-lg md:text-xl mt-4 max-w-2xl leading-snug">
            Append-only. Annotation id, market, excess vs book, payout hash.{" "}
            <em className="text-[var(--blue-deep)]">
              If we cannot show that row, we should not talk about performance.
            </em>
          </p>

          <div className="grid sm:grid-cols-3 gap-x-12 max-w-2xl mt-6">
            {[
              ["Rows", String(rows.length)],
              ["Accepted annotations", String(accepted)],
              ["USDC paid out", `$${paid.toFixed(2)}`],
            ].map(([l, v]) => (
              <div key={l} className="flex items-baseline py-1.5 text-sm">
                <span className="text-[var(--ink-soft)]">{l}</span>
                <span className="leader" />
                <span className="font-display text-xl text-[var(--blue-deep)]">{v}</span>
              </div>
            ))}
          </div>
        </section>

        {/* filter row */}
        <div className="flex flex-wrap gap-2 pb-3">
          {KINDS.map((k) => (
            <button
              key={k}
              onClick={() => setFilter(k)}
              className={`text-[10px] tracking-[0.2em] px-3 py-1.5 border-2 transition-colors ${
                filter === k
                  ? "border-[var(--blue)] bg-[var(--blue)] text-white"
                  : "border-[var(--rule)] text-[var(--ink-soft)] hover:border-[var(--rule-strong)]"
              }`}
            >
              {k.toUpperCase()}
            </button>
          ))}
        </div>

        <div className="rule-double" />

        {shown.map((r, i) => {
          const stamp = KIND_STAMP[r.kind] ?? { label: r.kind.toUpperCase(), cls: "stamp-ink" };
          return (
            <div
              key={`${r.refId}-${i}`}
              className="ledger-row grid grid-cols-12 gap-x-4 py-4 items-baseline ink-in"
              style={{ animationDelay: `${Math.min(i * 50, 500)}ms` }}
            >
              <span className="col-span-2 md:col-span-1 text-[11px] text-[var(--ink-faint)]">
                {String(rows.length - rows.indexOf(r)).padStart(4, "0")}
              </span>
              <span className="col-span-4 md:col-span-2">
                <span className={`stamp ${stamp.cls} text-[11px]`}>{stamp.label}</span>
              </span>
              <span className="col-span-6 md:col-span-2 text-[11px] text-[var(--ink-soft)]">
                {r.at?.slice(0, 10)}
              </span>
              <span className="col-span-8 md:col-span-5 text-[12px] leading-relaxed pt-2 md:pt-0">
                {r.publicNote ?? r.refId}
                {r.marketId && (
                  <span className="block text-[10px] text-[var(--ink-faint)] mt-0.5 break-all">
                    {r.marketId} · ref {r.refId}
                  </span>
                )}
              </span>
              <span className="col-span-4 md:col-span-2 text-right font-display text-sm text-[var(--blue-deep)]">
                {r.usdc ? `$${Number(r.usdc).toFixed(2)}` : "—"}
              </span>
            </div>
          );
        })}

        {loaded && shown.length === 0 && (
          <p className="text-[11px] text-[var(--ink-faint)] py-6">no rows under this filter</p>
        )}

        {loaded && accepted === 0 && (
          <div className="mt-10 border-[2.5px] border-[var(--rule-strong)] bg-[var(--paper-2)] p-6 max-w-3xl">
            <span className="stamp stamp-ink text-sm">HONESTY NOTE</span>
            <p className="font-serif text-lg leading-snug mt-3">
              Zero accepted annotations so far. Old copy is retired — we will only talk about excess vs
              book on accepted rows after resolution.{" "}
              <em className="text-[var(--blue-deep)]">If the ledger is empty, we have no number.</em>
            </p>
          </div>
        )}
      </main>
    </div>
  );
}
