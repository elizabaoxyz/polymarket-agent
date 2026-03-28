"use client";

import { Settings, ExternalLink, LogIn, Copy } from "lucide-react";

type HeaderProps = {
  balance: number | null;
  isConnected: boolean;
  onOpenPositions?: () => void;
  onOpenTrades?: () => void;
};

export function Header({ balance, isConnected }: HeaderProps) {
  return (
    <header className="fixed top-0 left-0 right-0 z-50 bg-[var(--bg)] border-b border-[var(--border)]">
      <div className="w-full px-4 h-12 flex items-center justify-between">
        {/* Left section */}
        <div className="flex items-center gap-3">
          <span className="mono text-[var(--accent)] font-bold text-sm tracking-wider">
            POLYAGENT
          </span>

          <button
            onClick={() => navigator.clipboard.writeText("0xb1b5...ac56")}
            className="flex items-center gap-1.5 text-[var(--text-muted)] hover:text-[var(--text-secondary)] transition-colors"
            title="Copy contract address"
          >
            <span className="mono text-[11px]">CA: 0xb1b5...ac56</span>
            <Copy size={11} />
          </button>

          <div
            className={`w-2 h-2 rounded-full ${
              isConnected ? "bg-[var(--green)]" : "bg-[var(--red)]"
            }`}
            title={isConnected ? "Connected" : "Disconnected"}
          />

          {balance !== null && (
            <span className="mono text-[var(--accent)] text-xs font-semibold">
              ${balance.toFixed(2)}
            </span>
          )}
        </div>

        {/* Right section */}
        <div className="flex items-center gap-1">
          <button
            className="p-2 text-[var(--text-secondary)] hover:text-[var(--text)] hover:bg-[var(--bg-card)] rounded-lg transition-colors"
            title="Settings"
          >
            <Settings size={16} />
          </button>

          <button
            className="p-2 text-[var(--text-secondary)] hover:text-[var(--text)] hover:bg-[var(--bg-card)] rounded-lg transition-colors"
            title="Open external"
          >
            <ExternalLink size={16} />
          </button>

          <button className="flex items-center gap-1.5 ml-2 px-3 py-1.5 bg-[var(--red)] hover:opacity-90 text-white text-xs font-semibold rounded-lg transition-opacity">
            <LogIn size={14} />
            <span>SIGN IN</span>
          </button>
        </div>
      </div>
    </header>
  );
}
