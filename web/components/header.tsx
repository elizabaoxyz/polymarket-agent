"use client";

import { Bot, CreditCard, FileText } from "lucide-react";

function XIcon({ size = 15 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="currentColor">
      <path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z" />
    </svg>
  );
}

function GitHubIcon({ size = 15 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="currentColor">
      <path d="M12 0c-6.626 0-12 5.373-12 12 0 5.302 3.438 9.8 8.207 11.387.599.111.793-.261.793-.577v-2.234c-3.338.726-4.033-1.416-4.033-1.416-.546-1.387-1.333-1.756-1.333-1.756-1.089-.745.083-.729.083-.729 1.205.084 1.839 1.237 1.839 1.237 1.07 1.834 2.807 1.304 3.492.997.107-.775.418-1.305.762-1.604-2.665-.305-5.467-1.334-5.467-5.931 0-1.311.469-2.381 1.236-3.221-.124-.303-.535-1.524.117-3.176 0 0 1.008-.322 3.301 1.23.957-.266 1.983-.399 3.003-.404 1.02.005 2.047.138 3.006.404 2.291-1.552 3.297-1.23 3.297-1.23.653 1.653.242 2.874.118 3.176.77.84 1.235 1.911 1.235 3.221 0 4.609-2.807 5.624-5.479 5.921.43.372.823 1.102.823 2.222v3.293c0 .319.192.694.801.576 4.765-1.589 8.199-6.086 8.199-11.386 0-6.627-5.373-12-12-12z" />
    </svg>
  );
}

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
        <div className="flex items-center gap-2 md:gap-3 min-w-0">
          <span className="mono text-[var(--accent)] font-bold text-xs md:text-sm tracking-wider shrink-0">
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
            <span className="hidden sm:inline">{isAutonomyActive ? "AUTONOMY ON" : "AUTONOMY OFF"}</span>
            <span className="sm:hidden">{isAutonomyActive ? "ON" : "OFF"}</span>
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
                    <span className="hidden sm:inline text-[var(--text-secondary)]">
                      {x402Status.payments}tx · ${x402Status.totalUsd.toFixed(2)}
                    </span>
                  )}
                </>
              )}
            </button>
          )}
        </div>

        {/* Right section */}
        <div className="hidden sm:flex items-center gap-2">
          <a
            href="https://x.com/elizabao_ai"
            target="_blank"
            rel="noopener noreferrer"
            className="w-8 h-8 flex items-center justify-center rounded-full text-[var(--text-muted)] hover:text-[var(--accent)] hover:bg-[var(--bg-card)] transition-colors"
            title="Twitter"
          >
            <XIcon size={15} />
          </a>
          <a
            href="https://github.com/elizabaoxyz/polymarket-agent"
            target="_blank"
            rel="noopener noreferrer"
            className="w-8 h-8 flex items-center justify-center rounded-full text-[var(--text-muted)] hover:text-[var(--accent)] hover:bg-[var(--bg-card)] transition-colors"
            title="GitHub"
          >
            <GitHubIcon size={15} />
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
