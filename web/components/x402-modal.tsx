"use client";

import { X, CreditCard, CheckCircle, AlertCircle, ArrowUpRight } from "lucide-react";
import type { X402Status } from "@/lib/types";

type X402ModalProps = {
  status: X402Status;
  onClose: () => void;
};

export default function X402Modal({ status, onClose }: X402ModalProps) {
  return (
    <>
      <div className="fixed inset-0 bg-black/60 z-[100]" onClick={onClose} />
      <div className="fixed inset-0 z-[101] flex items-center justify-center p-4">
        <div className="bg-[var(--bg-panel)] border border-[var(--border)] rounded-xl max-w-md w-full max-h-[85vh] overflow-y-auto">
          {/* Header */}
          <div className="flex items-start justify-between p-5 border-b border-[var(--border)]">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-lg bg-[var(--bg-card)] border border-[var(--accent)] flex items-center justify-center">
                <CreditCard size={20} className="text-[var(--accent)]" />
              </div>
              <div>
                <h2 className="text-lg font-bold text-[var(--text)]">x402 Payments</h2>
                <p className="mono text-xs text-[var(--text-secondary)]">Solana USDC · Auto-Pay Protocol</p>
              </div>
            </div>
            <button onClick={onClose} className="text-[var(--text-secondary)] hover:text-[var(--text)]">
              <X size={18} />
            </button>
          </div>

          {/* Status */}
          <div className="p-5 space-y-4">
            {/* Active Status */}
            <div className={`flex items-center gap-2 px-3 py-2 rounded-lg border ${
              status.active
                ? "border-[var(--accent)] bg-[var(--bg-agent)]"
                : "border-[var(--border)] bg-[var(--bg-card)]"
            }`}>
              {status.active ? (
                <CheckCircle size={16} className="text-[var(--green)]" />
              ) : (
                <AlertCircle size={16} className="text-[var(--text-muted)]" />
              )}
              <span className="mono text-sm">
                {status.active ? "Active — ready to auto-pay" : "Disabled"}
              </span>
            </div>

            {/* Stats */}
            <div className="grid grid-cols-2 gap-3">
              <div className="p-3 bg-[var(--bg-card)] border border-[var(--border)] rounded-lg">
                <div className="mono text-[10px] text-[var(--text-secondary)] tracking-wider mb-1">TOTAL PAYMENTS</div>
                <div className="mono text-2xl font-bold text-[var(--accent)]">{status.payments}</div>
              </div>
              <div className="p-3 bg-[var(--bg-card)] border border-[var(--border)] rounded-lg">
                <div className="mono text-[10px] text-[var(--text-secondary)] tracking-wider mb-1">TOTAL SPENT</div>
                <div className="mono text-2xl font-bold text-[var(--accent)]">${status.totalUsd.toFixed(4)}</div>
              </div>
            </div>

            {/* How it works */}
            <div>
              <h3 className="mono text-xs text-[var(--text)] font-bold mb-2 tracking-wider">HOW IT WORKS</h3>
              <div className="space-y-2 text-[13px] text-[var(--text-secondary)]">
                <div className="flex gap-2">
                  <span className="mono text-[var(--accent)] shrink-0">1.</span>
                  <span>Autonomy finds a Jupiter market to buy</span>
                </div>
                <div className="flex gap-2">
                  <span className="mono text-[var(--accent)] shrink-0">2.</span>
                  <span>Agent pays for market analysis via <span className="mono text-[var(--accent)]">x402 API</span></span>
                </div>
                <div className="flex gap-2">
                  <span className="mono text-[var(--accent)] shrink-0">3.</span>
                  <span>API returns <span className="mono text-[var(--accent)]">HTTP 402 Payment Required</span></span>
                </div>
                <div className="flex gap-2">
                  <span className="mono text-[var(--accent)] shrink-0">4.</span>
                  <span>x402 auto-signs a Solana USDC payment, submits on-chain</span>
                </div>
                <div className="flex gap-2">
                  <span className="mono text-[var(--accent)] shrink-0">5.</span>
                  <span>Retries with payment proof → analysis received → agent places bet</span>
                </div>
              </div>
              <p className="mono text-[10px] text-[var(--text-muted)] mt-2">Only triggers on Jupiter buy cycles when markets are available. No wasted payments.</p>
            </div>

            {/* Integration */}
            <div>
              <h3 className="mono text-xs text-[var(--text)] font-bold mb-2 tracking-wider">INTEGRATION</h3>
              <div className="bg-[var(--bg-card)] border border-[var(--border)] rounded-lg p-3">
                <pre className="mono text-xs text-[var(--text-secondary)] whitespace-pre-wrap">{`Network: Solana Mainnet + Devnet
Asset: USDC
Cap: $0.10 per request
Packages:
  @x402/fetch  → wraps fetch()
  @x402/svm   → Solana payments
  @x402/core  → protocol`}</pre>
              </div>
            </div>

            {/* Links */}
            <a
              href="https://x402.org"
              target="_blank"
              rel="noopener noreferrer"
              className="flex items-center justify-center gap-2 w-full py-2 border border-[var(--accent)] text-[var(--accent)] rounded-lg text-sm mono hover:bg-[var(--bg-agent)] transition-colors"
            >
              <ArrowUpRight size={14} />
              x402.org — Protocol Docs
            </a>
          </div>
        </div>
      </div>
    </>
  );
}
