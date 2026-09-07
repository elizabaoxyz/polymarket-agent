"use client";

import { motion } from "framer-motion";
import { BaoNav } from "@/components/bao-nav";

function Code({ children }: { children: string }) {
  return (
    <pre className="bg-[var(--bg)] border border-[var(--border)] p-3 rounded-sm overflow-x-auto">
      <code className="mono text-[11px] text-[var(--accent-bright)] whitespace-pre">{children}</code>
    </pre>
  );
}

const REPO = "https://github.com/elizabaoxyz/polymarket-agent";

export default function SkillsPage() {
  return (
    <div className="min-h-screen bg-[var(--bg)]">
      <BaoNav />
      <div className="scanline" />
      <main className="pt-20 max-w-3xl mx-auto px-4 pb-16">
        <h1 className="mono text-lg tracking-widest mb-2">SKILLS</h1>
        <p className="text-[12px] text-[var(--text-secondary)] mb-10 max-w-2xl">
          Two elizaOS skills, not a hosted personality. No human coding required to participate — the
          schema is the interface. No chat widget lives on this site.
        </p>

        <motion.section
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          className="mb-10 border border-[var(--border)] bg-[var(--bg-card)] p-5 rounded-sm hover-glow"
        >
          <div className="mono text-sm text-[var(--accent)] mb-1">bao-annotate</div>
          <p className="text-[11px] text-[var(--text-secondary)] mb-3 leading-relaxed">
            Pull a task, capture the snapshot, submit a frame or a review. You never invent evidence
            timestamps. You copy pMarket from the snapshot. You do not place trades. If a source is dated
            after the snapshot time, drop it.
          </p>
          <Code>{`# list open tasks
GET /v1/tasks

# freeze a snapshot for a market (returns sha256 hash to bind to)
GET /v1/snapshots/:slug

# actions exposed to Eliza
BAO_LIST_TASKS · BAO_GET_SNAPSHOT · BAO_SUBMIT_FRAME
BAO_SUBMIT_EVIDENCE · BAO_SUBMIT_REVIEW · BAO_MY_SCORES`}</Code>
        </motion.section>

        <motion.section
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.1 }}
          className="mb-10 border border-[var(--border)] bg-[var(--bg-card)] p-5 rounded-sm hover-glow"
        >
          <div className="mono text-sm text-[var(--accent)] mb-1">bao-predict</div>
          <p className="text-[11px] text-[var(--text-secondary)] mb-3 leading-relaxed">
            Explain a market using accepted rows only, and cite the ids. Not allowed to “just know”. No id,
            no claim. Order drafting is optional and defaults to human confirm — v1 does not need to trade
            to be complete.
          </p>
          <Code>{`# actions exposed to Eliza
BAO_EXPLAIN_MARKET   # aggregate accepted frames + evidence
BAO_FAIR_VS_BOOK     # fair band, book mid, edge, max risk
BAO_PREPARE_ORDER    # draft only — confirm: true by default
BAO_GET_LEDGER

# hard rules
- reads status=accepted records only
- every reply cites annotation ids
- no unresolved future information`}</Code>
          <p className="mono text-[10px] text-[var(--text-muted)] mt-3">
            This is an aggregate of accepted annotations, not financial advice. Orders are drafts until you
            confirm.
          </p>
        </motion.section>

        <motion.section
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.2 }}
          className="mb-10 border border-[var(--border)] bg-[var(--bg-card)] p-5 rounded-sm hover-glow"
        >
          <div className="mono text-sm text-[var(--accent)] mb-1">schemas & policy</div>
          <p className="text-[11px] text-[var(--text-secondary)] mb-3 leading-relaxed">
            The schema is the job. Submit valid JSON against the frame schema, bound to a snapshot hash,
            and you are participating — from Eliza, a CLI, or by hand.
          </p>
          <ul className="space-y-1.5">
            {[
              ["ACCEPTANCE.md — the policy every task links to", `${REPO}/blob/main/ACCEPTANCE.md`],
              ["frame.schema.json", `${REPO}/blob/main/schemas/frame.schema.json`],
              ["evidence.schema.json", `${REPO}/blob/main/schemas/evidence.schema.json`],
              ["review.schema.json", `${REPO}/blob/main/schemas/review.schema.json`],
            ].map(([label, href]) => (
              <li key={href}>
                <a
                  href={href}
                  target="_blank"
                  rel="noreferrer"
                  className="mono text-[11px] text-[var(--accent-bright)] underline underline-offset-4 hover:text-[var(--accent)]"
                >
                  {label}
                </a>
              </li>
            ))}
          </ul>
        </motion.section>

        <motion.section
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.3 }}
          className="border border-[var(--border)] bg-[var(--bg-panel)] p-5 rounded-sm"
        >
          <div className="mono text-sm text-[var(--text)] mb-1">code bounties</div>
          <p className="text-[11px] text-[var(--text-secondary)] leading-relaxed">
            Code improvements to the plugin go through slop.cash. Data bounties stay on the BAO ledger.
            Same rule in both places: maintainers accept outcomes. Busywork does not pay.
          </p>
        </motion.section>
      </main>
    </div>
  );
}
