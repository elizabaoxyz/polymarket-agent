"use client";

import { Bot, Zap, LayoutGrid, Heart, RefreshCw } from "lucide-react";

type FeedItem = {
  address: string;
  market: string;
  amount: number;
  side: "BUY" | "SELL";
};

type LeftSidebarProps = {
  balance: number | null;
  positionCount: number;
  isConnected: boolean;
  liveFeed: FeedItem[];
  onAnalyze: () => void;
};

function SectionTitle({ label }: { label: string }) {
  return (
    <div className="flex items-center gap-2 mb-3">
      <div className="w-2 h-2 bg-[var(--green)] rounded-sm" />
      <span className="mono text-[11px] text-[var(--text-secondary)] tracking-wider font-semibold">
        {label}
      </span>
    </div>
  );
}

export function LeftSidebar({
  balance,
  positionCount,
  isConnected,
  liveFeed,
  onAnalyze,
}: LeftSidebarProps) {
  return (
    <aside className="w-[240px] h-full bg-[var(--bg-panel)] border-r border-[var(--border)] flex flex-col overflow-y-auto">
      {/* AI TRADING */}
      <div className="p-4 border-b border-[var(--border)]">
        <SectionTitle label="AI TRADING" />

        <p className="text-[12px] text-[var(--text-muted)] mb-3">
          No analysis yet
        </p>

        <button
          onClick={onAnalyze}
          className="w-full flex items-center justify-center gap-2 px-3 py-2 bg-[var(--green)] hover:opacity-90 text-[#0a0a0a] text-xs font-bold rounded-lg transition-opacity mb-2"
        >
          <Zap size={14} />
          <span>ANALYZE</span>
        </button>

        <a
          href="#"
          className="flex items-center justify-center gap-1.5 text-[11px] text-[var(--text-secondary)] hover:text-[var(--text)] transition-colors"
        >
          <LayoutGrid size={12} />
          <span>FULL DASHBOARD</span>
        </a>
      </div>

      {/* AGENT DEPLOY */}
      <div className="p-4 border-b border-[var(--border)]">
        <SectionTitle label="AGENT DEPLOY" />

        <div className="flex flex-col items-center mb-3">
          <div className="w-[60px] h-[60px] rounded-full border-2 border-[var(--green)] bg-[var(--bg-card)] flex items-center justify-center mb-2">
            <Bot size={28} className="text-[var(--green)]" />
          </div>
        </div>

        <div className="space-y-1.5 text-[11px]">
          <div className="flex items-center justify-between">
            <span className="text-[var(--text-muted)]">Agent</span>
            <span className="mono text-[var(--text)]">Polyagent</span>
          </div>
          <div className="flex items-center justify-between">
            <span className="text-[var(--text-muted)]">Protocol</span>
            <span className="mono text-[var(--text)]">MCP</span>
          </div>
          <div className="flex items-center justify-between">
            <span className="text-[var(--text-muted)]">Plugins</span>
            <span className="mono text-[var(--text)]">Polymarket</span>
          </div>
          <div className="flex items-center justify-between">
            <span className="text-[var(--text-muted)]">Balance</span>
            <span className="mono text-[var(--green)] font-semibold">
              {balance !== null ? `$${balance.toFixed(2)}` : "--"}
            </span>
          </div>
          <div className="flex items-center justify-between">
            <span className="text-[var(--text-muted)]">Positions</span>
            <span className="mono text-[var(--text)]">{positionCount}</span>
          </div>
          <div className="flex items-center justify-between">
            <span className="text-[var(--text-muted)]">Realtime</span>
            <span className="mono text-[var(--green)] text-[10px] font-semibold">
              {isConnected ? "CONNECTED" : "DISCONNECTED"}
            </span>
          </div>
        </div>
      </div>

      {/* WHALE_LIVE */}
      <div className="p-4 flex-1 min-h-0 flex flex-col">
        <SectionTitle label="WHALE_LIVE" />

        <div className="flex items-center gap-2 mb-3">
          <Heart size={14} className="text-[var(--red)]" />
          <button className="flex items-center gap-1 text-[11px] text-[var(--text-secondary)] hover:text-[var(--text)] transition-colors">
            <RefreshCw size={11} />
            <span>SYNC</span>
          </button>
        </div>

        <div className="flex-1 overflow-y-auto space-y-2">
          {liveFeed.length === 0 && (
            <p className="text-[11px] text-[var(--text-muted)]">
              No whale activity
            </p>
          )}

          {liveFeed.map((item, i) => (
            <div
              key={i}
              className="text-[11px] leading-tight space-y-0.5"
            >
              <div className="flex items-center justify-between gap-1">
                <span className="mono text-[var(--green)] truncate max-w-[100px]">
                  {item.address.slice(0, 6)}...{item.address.slice(-4)}
                </span>
                <span
                  className={`mono text-[10px] px-1.5 py-0.5 rounded font-bold ${
                    item.side === "BUY"
                      ? "bg-[var(--green)]/15 text-[var(--green)]"
                      : "bg-[var(--red)]/15 text-[var(--red)]"
                  }`}
                >
                  {item.side}
                </span>
              </div>
              <div className="text-[var(--text-muted)] truncate">
                {item.market}
              </div>
              <div className="mono text-[var(--text-secondary)]">
                ${item.amount.toLocaleString()}
              </div>
            </div>
          ))}
        </div>
      </div>
    </aside>
  );
}
