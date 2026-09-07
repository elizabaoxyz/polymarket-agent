"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import Image from "next/image";
import { motion } from "framer-motion";
import { ArrowRight, FileCheck2, Scale, ShieldCheck } from "lucide-react";
import { BaoNav } from "@/components/bao-nav";
import { fetchMarkets, fetchTasks, fetchLedger, type BaoMarket, type BaoTask, type LedgerRow } from "@/lib/bao-api";

function StatBlock({ label, value, live }: { label: string; value: string; live?: boolean }) {
  return (
    <div className="border border-[var(--border)] bg-[var(--bg-card)] p-4 hover-glow rounded-sm">
      <div className="flex items-center gap-2 text-[10px] mono tracking-widest text-[var(--text-muted)] mb-2">
        {live && <span className="live-dot" />}
        {label}
      </div>
      <div className="mono text-xl text-[var(--text)]">{value}</div>
    </div>
  );
}

export default function Home() {
  const [markets, setMarkets] = useState<BaoMarket[]>([]);
  const [tasks, setTasks] = useState<BaoTask[]>([]);
  const [ledger, setLedger] = useState<LedgerRow[]>([]);

  useEffect(() => {
    fetchMarkets(16).then(setMarkets);
    fetchTasks().then(setTasks);
    fetchLedger().then(setLedger);
    const iv = setInterval(() => fetchMarkets(16).then(setMarkets), 30000);
    return () => clearInterval(iv);
  }, []);

  const openTasks = tasks.filter((t) => t.status === "open");
  const poolTotal = openTasks.reduce((s, t) => s + Number(t.poolUsdc || 0), 0);
  const acceptedCount = ledger.filter((r) => r.kind === "accept").length;

  return (
    <div className="min-h-screen bg-[var(--bg)]">
      <BaoNav />
      <div className="scanline" />

      <main className="pt-12 max-w-5xl mx-auto px-4">
        {/* Hero */}
        <section className="py-16 md:py-24">
          <motion.div
            initial={{ opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.6 }}
            className="flex flex-col items-start gap-6"
          >
            <div className="flex items-center gap-4">
              <Image src="/bao-logo.png" alt="" width={56} height={56} className="logo-breathe rounded" />
              <h1 className="mono text-3xl md:text-5xl font-bold tracking-tight">
                Accepted prediction data,
                <br />
                <span className="text-[var(--accent)]">paid in USDC.</span>
              </h1>
            </div>
            <p className="text-sm md:text-base text-[var(--text-secondary)] max-w-2xl leading-relaxed">
              elizaBAO is not a chatbot with a price ticker. It is an acceptance layer for prediction
              markets. You submit a label bound to a snapshot at time T. Gates check the evidence dates.
              Another identity reviews you. After resolution, USDC goes only to labels that beat the book.
            </p>
            <p className="mono text-xs text-[var(--text-muted)]">
              Eliza reads the accepted set. Nothing else.
            </p>
            <div className="flex flex-wrap gap-3 mt-2">
              <Link
                href="/markets"
                className="mono text-xs tracking-widest px-5 py-3 bg-[var(--accent)] text-black font-bold hover:bg-[var(--accent-bright)] transition-colors flex items-center gap-2 rounded-sm"
              >
                OPEN TASKS <ArrowRight size={14} />
              </Link>
              <Link
                href="/skills"
                className="mono text-xs tracking-widest px-5 py-3 border border-[var(--border)] hover:border-[var(--accent)] transition-colors hover-glow rounded-sm"
              >
                INSTALL SKILLS
              </Link>
            </div>
          </motion.div>
        </section>

        {/* Live stats */}
        <section className="grid grid-cols-2 md:grid-cols-4 gap-3 pb-12">
          <StatBlock label="LIVE MARKETS ON BOARD" value={markets.length ? String(markets.length) : "—"} live />
          <StatBlock label="OPEN TASKS" value={String(openTasks.length)} live />
          <StatBlock label="LOCKED POOLS (USDC)" value={poolTotal ? `$${poolTotal.toFixed(2)}` : "—"} />
          <StatBlock label="ACCEPTED ROWS" value={String(acceptedCount)} />
        </section>

        {/* Live market stream */}
        {markets.length > 0 && (
          <section className="pb-16 overflow-hidden border-y border-[var(--border)] py-3">
            <div className="flex gap-8 stream w-max">
              {[...markets, ...markets].map((m, i) => (
                <span key={`${m.slug}-${i}`} className="mono text-[11px] whitespace-nowrap text-[var(--text-secondary)]">
                  <span className="text-[var(--text-muted)]">{m.title.slice(0, 48)}</span>{" "}
                  <span className="text-[var(--accent-bright)]">{(m.midYes * 100).toFixed(1)}%</span>
                </span>
              ))}
            </div>
          </section>
        )}

        {/* How a label is born */}
        <section className="pb-16">
          <h2 className="mono text-xs tracking-[0.3em] text-[var(--text-muted)] mb-6">HOW A LABEL IS BORN</h2>
          <div className="grid md:grid-cols-3 gap-3">
            {[
              {
                icon: <FileCheck2 size={18} />,
                title: "SNAPSHOT + SUBMIT",
                body: "At time T we freeze mid, depth, and the raw venue payload behind a sha256 hash. Your frame binds to that hash — fair probability, dated drivers, and what would invalidate the view. Later prices cannot rewrite it.",
              },
              {
                icon: <ShieldCheck size={18} />,
                title: "GATE + REVIEW",
                body: "Schema, book drift, future evidence, dead links, duplicates. Failures are free to fix — they do not pay. Then a different identity attacks the package. Finding a dated-after-T source is paid work.",
              },
              {
                icon: <Scale size={18} />,
                title: "RESOLVE + PAY",
                body: "Payout weight is max(0, book Brier − your Brier). Beat the book, share the pool. Tie or lose, the unused pool returns to the sponsor. Copying the mid into a paragraph scores zero. That is the point.",
              },
            ].map((c, i) => (
              <motion.div
                key={c.title}
                initial={{ opacity: 0, y: 10 }}
                whileInView={{ opacity: 1, y: 0 }}
                viewport={{ once: true }}
                transition={{ delay: i * 0.12 }}
                className="border border-[var(--border)] bg-[var(--bg-card)] p-5 hover-glow rounded-sm"
              >
                <div className="text-[var(--accent)] mb-3">{c.icon}</div>
                <div className="mono text-xs tracking-widest mb-2 text-[var(--text)]">{c.title}</div>
                <p className="text-[12px] leading-relaxed text-[var(--text-secondary)]">{c.body}</p>
              </motion.div>
            ))}
          </div>
        </section>

        {/* Honest ledger note */}
        <section className="pb-20">
          <div className="border border-[var(--border)] bg-[var(--bg-panel)] p-6 rounded-sm shimmer-border">
            <p className="mono text-[12px] leading-relaxed text-[var(--text-secondary)]">
              <span className="text-[var(--accent)]">$</span> We only publish labels that were locked to a
              hash at time T and scored after resolution. If the{" "}
              <Link href="/ledger" className="text-[var(--accent-bright)] underline underline-offset-4">
                ledger
              </Link>{" "}
              is empty, we have no number — and we will not quote one.
            </p>
          </div>
        </section>

        <footer className="pb-10 flex flex-wrap items-center gap-4 text-[10px] mono text-[var(--text-muted)] border-t border-[var(--border)] pt-6">
          <span>elizaBAO — acceptance layer for prediction markets</span>
          <span>USDC only · Base</span>
          <a
            className="hover:text-[var(--accent-bright)]"
            href="https://github.com/elizabaoxyz/polymarket-agent/blob/main/ACCEPTANCE.md"
            target="_blank"
            rel="noreferrer"
          >
            ACCEPTANCE.md
          </a>
          <Link className="hover:text-[var(--accent-bright)]" href="/console">
            operator console
          </Link>
        </footer>
      </main>
    </div>
  );
}
