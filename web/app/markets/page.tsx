"use client";

import { useEffect, useState } from "react";
import { motion } from "framer-motion";
import { Camera, ExternalLink } from "lucide-react";
import { BaoNav } from "@/components/bao-nav";
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

const STATUS_COLOR: Record<string, string> = {
  open: "var(--green)",
  review: "var(--amber)",
  scoring: "var(--accent-bright)",
  paid: "var(--text-muted)",
  expired: "var(--text-muted)",
  cancelled: "var(--red)",
};

function ProbBar({ p }: { p: number }) {
  return (
    <div className="w-full h-1.5 bg-[var(--bg)] rounded overflow-hidden">
      <div
        className="h-full bar-fill"
        style={{ width: `${p * 100}%`, background: "linear-gradient(90deg, var(--accent), var(--accent-bright))" }}
      />
    </div>
  );
}

function TaskCard({ task, index }: { task: BaoTask; index: number }) {
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
    <motion.div
      initial={{ opacity: 0, y: 10 }}
      whileInView={{ opacity: 1, y: 0 }}
      viewport={{ once: true }}
      transition={{ delay: index * 0.06 }}
      className="border border-[var(--border)] bg-[var(--bg-card)] p-5 hover-glow rounded-sm flex flex-col gap-3"
    >
      <div className="flex items-center gap-2 flex-wrap">
        <span className="mono text-[10px] tracking-widest px-2 py-0.5 border border-[var(--accent)] text-[var(--accent-bright)] rounded-sm">
          {KIND_LABEL[task.kind] ?? task.kind.toUpperCase()}
        </span>
        <span className="mono text-[10px] tracking-widest" style={{ color: STATUS_COLOR[task.status] ?? "var(--text-muted)" }}>
          ● {task.status.toUpperCase()}
        </span>
        <span className="flex-1" />
        <span className="mono text-sm text-[var(--green)]">${Number(task.poolUsdc).toFixed(2)} USDC</span>
      </div>

      <div className="mono text-[13px] leading-snug text-[var(--text)]">
        {m?.title ?? task.marketSlug}
      </div>

      {m && (
        <div className="flex items-center gap-3">
          <div className="flex-1"><ProbBar p={m.midYes} /></div>
          <span className="mono text-[11px] text-[var(--accent-bright)] shrink-0">
            book {(m.midYes * 100).toFixed(1)}%
          </span>
        </div>
      )}

      <p className="text-[11px] leading-relaxed text-[var(--text-secondary)]">{task.brief}</p>

      <div className="flex flex-wrap gap-x-4 gap-y-1 text-[10px] mono text-[var(--text-muted)]">
        <span>submit by {new Date(task.submitBy).toISOString().slice(0, 10)}</span>
        <span>max accepted {task.maxAccepted}</span>
        <span>reviewer pool ${Number(task.reviewerPoolUsdc).toFixed(2)}</span>
        <span>{task.sponsor}</span>
      </div>

      {snap ? (
        <div className="border border-[var(--border)] bg-[var(--bg)] p-3 rounded-sm hash-in">
          <div className="mono text-[10px] tracking-widest text-[var(--text-muted)] mb-1">
            SNAPSHOT @ {snap.capturedAt}
          </div>
          <div className="mono text-[10px] text-[var(--accent-bright)] break-all">{snap.snapshotHash}</div>
          <div className="mono text-[10px] text-[var(--text-secondary)] mt-1">
            midYes {snap.midYes.toFixed(6)} — bind your frame to this hash. Evidence dated after this
            timestamp is a FUTURE_EVIDENCE reject.
          </div>
        </div>
      ) : (
        <div className="flex gap-2">
          <button
            onClick={capture}
            disabled={capturing}
            className="mono text-[10px] tracking-widest px-3 py-2 border border-[var(--accent)] text-[var(--accent-bright)] hover:bg-[var(--accent-dim)] transition-colors flex items-center gap-2 rounded-sm disabled:opacity-50"
          >
            <Camera size={12} /> {capturing ? "FREEZING…" : "CAPTURE SNAPSHOT"}
          </button>
          {task.market?.rulesUrl && (
            <a
              href={task.market.rulesUrl}
              target="_blank"
              rel="noreferrer"
              className="mono text-[10px] tracking-widest px-3 py-2 border border-[var(--border)] text-[var(--text-secondary)] hover:border-[var(--accent)] transition-colors flex items-center gap-2 rounded-sm"
            >
              RULES <ExternalLink size={11} />
            </a>
          )}
        </div>
      )}
    </motion.div>
  );
}

export default function MarketsPage() {
  const [tasks, setTasks] = useState<BaoTask[]>([]);
  const [board, setBoard] = useState<BaoMarket[]>([]);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    Promise.all([fetchTasks(), fetchMarkets(24)]).then(([t, m]) => {
      setTasks(t);
      setBoard(m);
      setLoaded(true);
    });
    const iv = setInterval(() => fetchMarkets(24).then(setBoard), 30000);
    return () => clearInterval(iv);
  }, []);

  return (
    <div className="min-h-screen bg-[var(--bg)]">
      <BaoNav />
      <div className="scanline" />
      <main className="pt-20 max-w-5xl mx-auto px-4 pb-16">
        <div className="flex items-center gap-3 mb-2">
          <h1 className="mono text-lg tracking-widest">MARKETS</h1>
          <span className="live-dot" />
        </div>
        <p className="text-[12px] text-[var(--text-secondary)] mb-8 max-w-2xl">
          Sponsor locks USDC on a market + a written policy. You submit against the snapshot. A reviewer
          who is not you takes a pass. Market resolves. We score. Read{" "}
          <a
            className="text-[var(--accent-bright)] underline underline-offset-4"
            href="https://github.com/elizabaoxyz/polymarket-agent/blob/main/ACCEPTANCE.md"
            target="_blank"
            rel="noreferrer"
          >
            ACCEPTANCE.md
          </a>{" "}
          before the cutoff.
        </p>

        <h2 className="mono text-xs tracking-[0.3em] text-[var(--text-muted)] mb-4">OPEN TASKS — LOCKED POOLS</h2>
        {!loaded && <p className="mono text-[11px] text-[var(--text-muted)]">loading tasks…</p>}
        <div className="grid md:grid-cols-2 gap-4 mb-14">
          {tasks.map((t, i) => (
            <TaskCard key={t.id} task={t} index={i} />
          ))}
        </div>

        <h2 className="mono text-xs tracking-[0.3em] text-[var(--text-muted)] mb-4">
          LIVE BOARD — LIQUID, ANNOTATABLE MARKETS (VENUE DATA, 30s REFRESH)
        </h2>
        <div className="border border-[var(--border)] rounded-sm overflow-hidden">
          <div className="grid grid-cols-[1fr_90px_90px_90px] mono text-[10px] tracking-widest text-[var(--text-muted)] px-4 py-2 border-b border-[var(--border)] bg-[var(--bg-panel)]">
            <span>MARKET</span>
            <span className="text-right">BOOK</span>
            <span className="text-right">LIQ</span>
            <span className="text-right">CLOSES</span>
          </div>
          {board.map((m, i) => (
            <a
              key={m.slug}
              href={m.rulesUrl}
              target="_blank"
              rel="noreferrer"
              className="grid grid-cols-[1fr_90px_90px_90px] items-center px-4 py-2.5 border-b border-[var(--border)] last:border-b-0 hover:bg-[var(--accent-dim)] transition-colors row-in"
              style={{ animationDelay: `${Math.min(i * 40, 600)}ms` }}
            >
              <span className="mono text-[11px] text-[var(--text)] truncate pr-3">{m.title}</span>
              <span className="mono text-[11px] text-[var(--accent-bright)] text-right">
                {(m.midYes * 100).toFixed(1)}%
              </span>
              <span className="mono text-[11px] text-[var(--text-secondary)] text-right">
                ${(m.liquidityUsd / 1000).toFixed(0)}k
              </span>
              <span className="mono text-[10px] text-[var(--text-muted)] text-right">
                {m.closeAt ? m.closeAt.slice(0, 10) : "—"}
              </span>
            </a>
          ))}
          {loaded && board.length === 0 && (
            <p className="mono text-[11px] text-[var(--text-muted)] p-4">
              venue feed unavailable — the board will repopulate when the API is reachable
            </p>
          )}
        </div>
      </main>
    </div>
  );
}
