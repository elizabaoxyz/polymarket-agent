"use client";

import { useState } from "react";
import { Bot, Zap, LayoutGrid, Heart, RefreshCw, Wallet, History, TrendingUp, TrendingDown } from "lucide-react";
import type { Position, Trade } from "@/lib/types";

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
  positions: Position[];
  trades: Trade[];
  onAnalyze: () => void;
  onRefreshPortfolio: () => void;
};

type SidebarTab = "agent" | "portfolio" | "activity";

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

function TabButton({ active, onClick, children }: { active: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      onClick={onClick}
      className={`flex-1 text-[10px] font-semibold tracking-wider py-2 transition-colors ${
        active
          ? "text-[var(--accent)] border-b-2 border-[var(--accent)]"
          : "text-[var(--text-muted)] hover:text-[var(--text-secondary)]"
      }`}
    >
      {children}
    </button>
  );
}

function formatTimeAgo(timestamp: number): string {
  const seconds = Math.floor((Date.now() - timestamp * 1000) / 1000);
  if (seconds < 60) return `${seconds}s ago`;
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m ago`;
  if (seconds < 86400) return `${Math.floor(seconds / 3600)}h ago`;
  return `${Math.floor(seconds / 86400)}d ago`;
}

export function LeftSidebar({
  balance,
  positionCount,
  isConnected,
  liveFeed,
  positions,
  trades,
  onAnalyze,
  onRefreshPortfolio,
}: LeftSidebarProps) {
  const [tab, setTab] = useState<SidebarTab>("agent");

  return (
    <aside className="w-[240px] h-full bg-[var(--bg-panel)] border-r border-[var(--border)] flex flex-col overflow-hidden">
      {/* Tabs */}
      <div className="flex border-b border-[var(--border)]">
        <TabButton active={tab === "agent"} onClick={() => setTab("agent")}>AGENT</TabButton>
        <TabButton active={tab === "portfolio"} onClick={() => { setTab("portfolio"); onRefreshPortfolio(); }}>PORTFOLIO</TabButton>
        <TabButton active={tab === "activity"} onClick={() => { setTab("activity"); onRefreshPortfolio(); }}>ACTIVITY</TabButton>
      </div>

      <div className="flex-1 overflow-y-auto">
        {tab === "agent" && (
          <>
            {/* AI TRADING */}
            <div className="p-4 border-b border-[var(--border)]">
              <SectionTitle label="AI TRADING" />
              <p className="text-[12px] text-[var(--text-muted)] mb-3">No analysis yet</p>
              <button
                onClick={onAnalyze}
                className="w-full flex items-center justify-center gap-2 px-3 py-2 bg-[var(--green)] hover:opacity-90 text-[#0a0a0a] text-xs font-bold rounded-lg transition-opacity mb-2"
              >
                <Zap size={14} />
                <span>ANALYZE</span>
              </button>
              <a href="#" className="flex items-center justify-center gap-1.5 text-[11px] text-[var(--text-secondary)] hover:text-[var(--text)] transition-colors">
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
                  <span className="text-[var(--text-muted)]">Plugins</span>
                  <span className="mono text-[var(--text)]">3 active</span>
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
                  <span className={`mono text-[10px] font-semibold ${isConnected ? "text-[var(--green)]" : "text-[var(--red)]"}`}>
                    {isConnected ? "CONNECTED" : "DISCONNECTED"}
                  </span>
                </div>
              </div>
            </div>

            {/* WHALE_LIVE */}
            <div className="p-4 flex-1 min-h-0 flex flex-col">
              <div className="flex items-center gap-2 mb-3">
                <SectionTitle label="WHALE_LIVE" />
                <Heart size={12} className="text-[var(--red)] -mt-1" />
                <button className="flex items-center gap-1 text-[10px] text-[var(--text-secondary)] hover:text-[var(--text)] transition-colors -mt-1">
                  <RefreshCw size={10} />
                  SYNC
                </button>
              </div>
              <div className="space-y-2">
                {liveFeed.length === 0 && (
                  <p className="text-[11px] text-[var(--text-muted)]">No whale activity</p>
                )}
                {liveFeed.map((item, i) => (
                  <div key={i} className="text-[11px] leading-tight space-y-0.5">
                    <div className="flex items-center justify-between gap-1">
                      <span className="mono text-[var(--green)] truncate max-w-[100px]">
                        {item.address.slice(0, 6)}...{item.address.slice(-4)}
                      </span>
                      <span className={`mono text-[10px] px-1.5 py-0.5 rounded font-bold ${
                        item.side === "BUY" ? "bg-[var(--green)]/15 text-[var(--green)]" : "bg-[var(--red)]/15 text-[var(--red)]"
                      }`}>
                        {item.side}
                      </span>
                    </div>
                    <div className="text-[var(--text-muted)] truncate">{item.market}</div>
                    <div className="mono text-[var(--text-secondary)]">${item.amount.toLocaleString()}</div>
                  </div>
                ))}
              </div>
            </div>
          </>
        )}

        {tab === "portfolio" && (
          <div className="p-4">
            {/* Balance */}
            <div className="mb-4 p-3 bg-[var(--bg-card)] border border-[var(--border)] rounded-lg">
              <div className="flex items-center gap-2 mb-1">
                <Wallet size={14} className="text-[var(--accent)]" />
                <span className="mono text-[10px] text-[var(--text-secondary)] tracking-wider">USDC BALANCE</span>
              </div>
              <div className="mono text-xl font-bold text-[var(--green)]">
                {balance !== null ? `$${balance.toFixed(2)}` : "--"}
              </div>
            </div>

            {/* Polymarket Positions */}
            <SectionTitle label="POLYMARKET POSITIONS" />
            {positions.length === 0 ? (
              <p className="text-[11px] text-[var(--text-muted)] mb-4">No open positions</p>
            ) : (
              <div className="space-y-2 mb-4">
                {positions.map((pos, i) => {
                  const isPositive = pos.cashPnl >= 0;
                  return (
                    <div key={`${pos.conditionId}-${i}`} className="p-2.5 bg-[var(--bg-card)] border border-[var(--border)] rounded-lg">
                      <div className="text-[11px] text-[var(--text)] font-medium leading-tight mb-1 truncate">
                        {pos.title}
                      </div>
                      <div className="flex items-center gap-2 mb-1">
                        <span className={`mono text-[9px] px-1.5 py-0.5 rounded font-bold ${
                          pos.outcome === "Yes" ? "bg-[var(--green)]/15 text-[var(--green)]" : "bg-[var(--red)]/15 text-[var(--red)]"
                        }`}>
                          {pos.outcome}
                        </span>
                        <span className="mono text-[10px] text-[var(--text-secondary)]">{pos.size} shares</span>
                      </div>
                      <div className="flex items-center justify-between">
                        <span className="mono text-[10px] text-[var(--text-muted)]">
                          ${pos.avgPrice.toFixed(2)} → ${pos.curPrice.toFixed(2)}
                        </span>
                        <span className={`mono text-[10px] font-bold flex items-center gap-0.5 ${isPositive ? "text-[var(--green)]" : "text-[var(--red)]"}`}>
                          {isPositive ? <TrendingUp size={10} /> : <TrendingDown size={10} />}
                          {isPositive ? "+" : ""}${pos.cashPnl.toFixed(2)}
                        </span>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}

            {/* Jupiter note */}
            <SectionTitle label="JUPITER POSITIONS" />
            <p className="text-[11px] text-[var(--text-muted)]">
              Use &quot;show my jupiter positions on solana&quot; in chat
            </p>
          </div>
        )}

        {tab === "activity" && (
          <div className="p-4">
            <SectionTitle label="YOUR RECENT TRADES" />
            {trades.length === 0 ? (
              <p className="text-[11px] text-[var(--text-muted)]">No trades yet</p>
            ) : (
              <div className="space-y-2">
                {trades.map((trade, i) => (
                  <div key={`${trade.transactionHash}-${i}`} className="p-2.5 bg-[var(--bg-card)] border border-[var(--border)] rounded-lg">
                    <div className="flex items-center justify-between mb-1">
                      <span className={`mono text-[9px] px-1.5 py-0.5 rounded font-bold ${
                        trade.side === "BUY" ? "bg-[var(--green)]/15 text-[var(--green)]" : "bg-[var(--red)]/15 text-[var(--red)]"
                      }`}>
                        {trade.side}
                      </span>
                      <span className="mono text-[9px] text-[var(--text-muted)]">
                        {formatTimeAgo(trade.timestamp)}
                      </span>
                    </div>
                    <div className="text-[11px] text-[var(--text)] font-medium leading-tight mb-1 truncate">
                      {trade.title}
                    </div>
                    <div className="flex items-center justify-between">
                      <span className={`mono text-[9px] px-1 py-0.5 rounded ${
                        trade.outcome === "Yes" ? "text-[var(--green)]" : "text-[var(--red)]"
                      }`}>
                        {trade.outcome}
                      </span>
                      <span className="mono text-[10px] text-[var(--text-secondary)]">
                        {trade.size} @ ${trade.price.toFixed(2)} (${trade.usdcSize.toFixed(2)})
                      </span>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
      </div>
    </aside>
  );
}
