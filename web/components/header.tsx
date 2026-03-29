"use client";

import { Bot, CreditCard, FileText, Github, Twitter } from "lucide-react";

type HeaderProps = {
  isConnected: boolean;
  isAutonomyActive: boolean;
  onToggleAutonomy: () => void;
  x402Status?: { active: boolean; payments: number; totalUsd: number };
  onX402Click?: () => void;
};

export function Header({ isConnected, isAutonomyActive, onToggleAutonomy, x402Status, onX402Click }: HeaderProps) {
  return (
    <header className="fixed top-0 left-0 right-0 z-50 bg-[var(--bg)] border-b border-[var(--border)]">
      <div className="w-full px-4 h-12 flex items-center justify-between">
        {/* Left section */}
        <div className="flex items-center gap-3">
          <span className="mono text-[var(--accent)] font-bold text-sm tracking-wider">
            ELIZABAO
          </span>

          <div
            className={`w-2 h-2 rounded-full ${
              isConnected ? "bg-[var(--green)]" : "bg-[var(--red)]"
            }`}
            title={isConnected ? "Connected" : "Disconnected"}
          />

          {/* Autonomy Toggle */}
          <button
            onClick={onToggleAutonomy}
            disabled={!isConnected}
            className={`flex items-center gap-1.5 px-3 py-1 rounded-full text-[11px] font-bold mono transition-all ${
              isAutonomyActive
                ? "bg-[var(--green)] text-[#0a0a0a] autonomy-active"
                : "bg-[var(--bg-card)] border border-[var(--border)] text-[var(--text-secondary)] hover:border-[var(--green)] hover:text-[var(--green)] hover-glow"
            } disabled:opacity-40`}
          >
            <Bot size={12} />
            {isAutonomyActive ? "AUTONOMY ON" : "AUTONOMY OFF"}
          </button>

          {/* x402 Status Badge */}
          {x402Status && (
            <button
              onClick={onX402Click}
              className={`flex items-center gap-1.5 px-3 py-1 rounded-full text-[11px] mono cursor-pointer transition-all hover-glow ${
                x402Status.active
                  ? "bg-[var(--bg-card)] border border-[var(--accent)] text-[var(--accent)]"
                  : "bg-[var(--bg-card)] border border-[var(--border)] text-[var(--text-muted)]"
              }`}
              title={x402Status.active
                ? `x402 active — ${x402Status.payments} payments, $${x402Status.totalUsd.toFixed(4)} spent`
                : "x402 disabled"
              }
            >
              <CreditCard size={12} />
              <span>x402</span>
              {x402Status.active && (
                <>
                  <div className="w-1.5 h-1.5 rounded-full bg-[var(--green)]" />
                  {x402Status.payments > 0 && (
                    <span className="text-[var(--text-secondary)]">
                      {x402Status.payments}tx · ${x402Status.totalUsd.toFixed(2)}
                    </span>
                  )}
                </>
              )}
            </button>
          )}
        </div>

        {/* Right section */}
        <div className="flex items-center gap-2">
          <a
            href="https://x.com/elizabao_ai"
            target="_blank"
            rel="noopener noreferrer"
            className="w-8 h-8 flex items-center justify-center rounded-full text-[var(--text-muted)] hover:text-[var(--accent)] hover:bg-[var(--bg-card)] transition-colors"
            title="Twitter"
          >
            <Twitter size={15} />
          </a>
          <a
            href="https://github.com/elizabaoxyz/polymarket-agent"
            target="_blank"
            rel="noopener noreferrer"
            className="w-8 h-8 flex items-center justify-center rounded-full text-[var(--text-muted)] hover:text-[var(--accent)] hover:bg-[var(--bg-card)] transition-colors"
            title="GitHub"
          >
            <Github size={15} />
          </a>
          <a
            href="/docs"
            className="w-8 h-8 flex items-center justify-center rounded-full text-[var(--text-muted)] hover:text-[var(--accent)] hover:bg-[var(--bg-card)] transition-colors"
            title="Docs"
          >
            <FileText size={15} />
          </a>
        </div>
      </div>
    </header>
  );
}
