"use client";

import { useEffect, useState } from "react";
import { motion } from "framer-motion";
import { Masthead } from "@/components/masthead";
import {
  fetchMarkets,
  fetchTasks,
  fetchSnapshot,
  type BaoMarket,
  type BaoTask,
  type MarketSnapshot,
} from "@/lib/bao-api";

const KIND_LABEL: Record<string, string> = {
  frame: "FRAME",
  evidence: "EVIDENCE",
  rules_ambiguity: "RULES",
  postmortem: "POSTMORTEM",
  flow_label: "FLOW",
  rwa_map: "RWA MAP",
};

function TaskEntry({ task, index }: { task: BaoTask; index: number }) {
  const [snap, setSnap] = useState<MarketSnapshot | null>(null);
  const [capturing, setCapturing] = useState(false);

  const capture = async () => {
    setCapturing(true);
    const s = await fetchSnapshot(task.marketSlug);
    setSnap(s);
    setCapturing(false);
  };

  const m = task.market;
  return (
    <motion.article
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay: Math.min(index * 0.08, 0.5) }}
      className="border-b border-[var(--rule)] py-7 grid md:grid-cols-12 gap-x-8 gap-y-4"
    >
      {/* left: numbering + kind stamp */}
      <div className="md:col-span-2 flex md:flex-col items-start gap-3">
        <div className="font-display text-4xl text-transparent leading-none" style={{ WebkitTextStroke: "1.5px var(--blue)" }}>
          {String(index + 1).padStart(2, "0")}
        </div>
        <span className="stamp stamp-blue text-sm">{KIND_LABEL[task.kind] ?? task.kind}</span>
        <span className={`text-[10px] tracking-[0.2em] ${task.status === "open" ? "text-[var(--blue-deep)]" : "text-[var(--ink-faint)]"}`}>
          ● {task.status.toUpperCase()}
        </span>
      </div>

      {/* middle: the market + brief */}
      <div className="md:col-span-7">
        <h3 className="font-serif text-2xl md:text-[1.7rem] leading-tight mb-2">
          {m?.title ?? task.marketSlug}
        </h3>
        {m && (
          <div className="flex items-center gap-3 mb-3 max-w-md">
            <div className="prob-track flex-1">
              <div className="prob-fill" style={{ width: `${m.midYes * 100}%` }} />
            </div>
            <span className="font-display text-sm text-[var(--blue-deep)] shrink-0">
              book {(m.midYes * 100).toFixed(1)}¢
            </span>
          </div>
        )}
        <p className="text-[12px] leading-relaxed text-[var(--ink-soft)] max-w-xl">{task.brief}</p>

        {snap && (
          <div className="mt-4 border-l-[3px] border-[var(--blue)] pl-4 stamp-in">
            <div className="text-[10px] tracking-[0.2em] text-[var(--ink-faint)]">
              SNAPSHOT FROZEN @ {snap.capturedAt}
            </div>
            <div className="text-[11px] font-bold text-[var(--blue-deep)] break-all mt-1">
              sha256:{snap.snapshotHash}
            </div>
            <div className="text-[11px] text-[var(--ink-soft)] mt-1">
              midYes {snap.midYes.toFixed(6)} — bind your frame to this hash. Evidence dated after this
              timestamp is a FUTURE_EVIDENCE reject.
            </div>
          </div>
        )}
      </div>

      {/* right: money + actions */}
      <div className="md:col-span-3 flex flex-col items-start md:items-end gap-2">
        <div className="font-display text-3xl text-[var(--blue-deep)] leading-none">
          ${Number(task.poolUsdc).toFixed(0)}
        </div>
        <div className="text-[10px] tracking-[0.15em] text-[var(--ink-faint)] md:text-right leading-relaxed">
          USDC POOL · REVIEWERS ${Number(task.reviewerPoolUsdc).toFixed(0)}
          <br />
          SUBMIT BY {new Date(task.submitBy).toISOString().slice(0, 10)}
          <br />
          MAX ACCEPTED {task.maxAccepted} · {task.sponsor.toUpperCase()}
        </div>
        <div className="flex md:flex-col gap-2 mt-2 md:items-end">
          {!snap && (
            <button
              onClick={capture}
              disabled={capturing}
              className="font-display uppercase text-[11px] tracking-widest px-4 py-2.5 bg-[var(--ink)] text-[var(--paper)] hover:bg-[var(--blue-deep)] transition-colors disabled:opacity-50 active:scale-95"
            >
              {capturing ? "Freezing…" : "Capture snapshot"}
            </button>
          )}
          {m?.rulesUrl && (
            <a
              href={m.rulesUrl}
              target="_blank"
              rel="noreferrer"
              className="text-[11px] tracking-[0.15em] text-[var(--blue-deep)] underline decoration-dotted underline-offset-4"
            >
              MARKET RULES →
            </a>
          )}
        </div>
      </div>
    </motion.article>
  );
}

export default function MarketsPage() {
  const [tasks, setTasks] = useState<BaoTask[]>([]);
  const [board, setBoard] = useState<BaoMarket[]>([]);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    Promise.all([fetchTasks(), fetchMarkets(30)]).then(([t, m]) => {
      setTasks(t);
      setBoard(m);
      setLoaded(true);
    });
    const iv = setInterval(() => fetchMarkets(30).then(setBoard), 30000);
    return () => clearInterval(iv);
  }, []);

  const pool = tasks.filter((t) => t.status === "open").reduce((s, t) => s + Number(t.poolUsdc), 0);

  return (
    <div className="paper min-h-screen">
      <Masthead dense />
      <main className="px-4 md:px-8 max-w-6xl mx-auto pb-16">
        <section className="pt-10 pb-6">
          <h1 className="font-display text-5xl md:text-7xl uppercase tracking-tight leading-[0.9]">
            Open <span className="misprint-blue">tasks</span>
          </h1>
          <div className="halftone-fade-r h-8 mt-4 max-w-md opacity-50" />
          <p className="font-serif text-lg md:text-xl mt-4 max-w-2xl leading-snug">
            Sponsor locks USDC on a market and a written policy. You submit against the snapshot. A
            reviewer who is not you takes a pass. Market resolves. We score.{" "}
            <a
              className="italic text-[var(--blue-deep)] underline decoration-dotted underline-offset-4"
              href="https://github.com/elizabaoxyz/polymarket-agent/blob/main/ACCEPTANCE.md"
              target="_blank"
              rel="noreferrer"
            >
              Read ACCEPTANCE.md before the cutoff.
            </a>
          </p>
          <div className="flex items-baseline gap-3 mt-5 text-sm">
            <span className="text-[var(--ink-soft)]">Locked across open tasks</span>
            <span className="leader max-w-24" />
            <span className="font-display text-2xl text-[var(--blue-deep)]">${pool.toFixed(2)}</span>
            <span className="text-[10px] tracking-[0.2em] text-[var(--ink-faint)]">USDC · BASE</span>
          </div>
        </section>

        <div className="rule-double" />
        {!loaded && <p className="text-[11px] text-[var(--ink-faint)] py-6">pulling the task book…</p>}
        {tasks.map((t, i) => (
          <TaskEntry key={t.id} task={t} index={i} />
        ))}

        {/* live board */}
        <section className="pt-14">
          <div className="flex items-baseline gap-4 mb-1">
            <h2 className="font-display text-3xl md:text-5xl uppercase tracking-tight">The board</h2>
            <span className="flex items-center gap-2 text-[10px] tracking-[0.25em] text-[var(--ink-faint)]">
              <span className="ink-dot" /> VENUE DATA · 30s REFRESH
            </span>
          </div>
          <p className="text-[11px] text-[var(--ink-soft)] mb-5 max-w-2xl">
            Liquid, annotatable markets. If you are going to run an agent against Polymarket this week,
            point it at an open BAO task first — at least the output will have a snapshot hash.
          </p>
          <div className="rule-double" />
          {board.map((m, i) => (
            <a
              key={m.slug}
              href={m.rulesUrl}
              target="_blank"
              rel="noreferrer"
              className="ledger-row flex items-baseline py-2.5 text-[13px] ink-in"
              style={{ animationDelay: `${Math.min(i * 40, 600)}ms` }}
            >
              <span className="text-[var(--ink-faint)] w-10 shrink-0 text-[11px]">
                {String(i + 1).padStart(2, "0")}
              </span>
              <span className="truncate pr-2">{m.title}</span>
              <span className="leader" />
              <span className="hidden sm:inline text-[11px] text-[var(--ink-faint)] shrink-0 mr-6">
                liq ${(m.liquidityUsd / 1000).toFixed(0)}k · closes {m.closeAt ? m.closeAt.slice(0, 10) : "—"}
              </span>
              <span className="font-display text-[var(--blue-deep)] shrink-0">
                {(m.midYes * 100).toFixed(1)}¢
              </span>
            </a>
          ))}
          {loaded && board.length === 0 && (
            <p className="text-[11px] text-[var(--ink-faint)] py-4">
              venue feed unavailable — the board repopulates when the API is reachable
            </p>
          )}
        </section>
      </main>
    </div>
  );
}
