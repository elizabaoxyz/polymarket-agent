"use client";

import { useState } from "react";
import type { PortfolioData } from "@/lib/types";

type PanelProps = {
  portfolio: PortfolioData | null;
  initialTab: "positions" | "trades";
  onClose: () => void;
};

export function PortfolioPanel({ portfolio, initialTab, onClose }: PanelProps) {
  const [tab, setTab] = useState<"positions" | "trades">(initialTab);

  return (
    <>
      {/* Backdrop */}
      <div className="fixed inset-0 bg-black/20 z-40" onClick={onClose} />

      {/* Panel */}
      <div className="fixed top-0 right-0 bottom-0 w-[380px] max-w-full bg-white shadow-xl z-50 flex flex-col border-l border-[var(--border)]">
        {/* Header */}
        <div className="flex items-center justify-between px-4 h-14 border-b border-[var(--border)]">
          <div className="flex gap-1">
            <button
              onClick={() => setTab("positions")}
              className={`px-3 py-1.5 text-sm rounded-lg transition-colors ${
                tab === "positions"
                  ? "bg-[var(--accent-light)] text-[var(--accent)] font-medium"
                  : "text-[var(--text-secondary)] hover:bg-gray-100"
              }`}
            >
              Positions
            </button>
            <button
              onClick={() => setTab("trades")}
              className={`px-3 py-1.5 text-sm rounded-lg transition-colors ${
                tab === "trades"
                  ? "bg-[var(--accent-light)] text-[var(--accent)] font-medium"
                  : "text-[var(--text-secondary)] hover:bg-gray-100"
              }`}
            >
              Trades
            </button>
          </div>
          <button onClick={onClose} className="text-[var(--text-secondary)] hover:text-[var(--text)] p-1">
            <svg width="20" height="20" viewBox="0 0 20 20" fill="none">
              <path d="M6 6L14 14M14 6L6 14" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
            </svg>
          </button>
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto p-4">
          {!portfolio ? (
            <p className="text-sm text-[var(--text-secondary)] text-center py-10">Loading...</p>
          ) : tab === "positions" ? (
            <PositionsList positions={portfolio.positions} />
          ) : (
            <TradesList trades={portfolio.trades} />
          )}
        </div>
      </div>
    </>
  );
}

function PositionsList({ positions }: { positions: PortfolioData["positions"] }) {
  if (positions.length === 0) {
    return <p className="text-sm text-[var(--text-secondary)] text-center py-10">No open positions</p>;
  }
  return (
    <div className="space-y-3">
      {positions.map((pos, i) => {
        const isPositive = pos.cashPnl >= 0;
        return (
          <div key={`${pos.conditionId}-${i}`} className="border border-[var(--border)] rounded-xl p-3">
            <p className="text-sm font-medium text-[var(--text)] mb-1 leading-snug">{pos.title}</p>
            <div className="flex items-center gap-2 mb-2">
              <span
                className={`text-xs font-medium px-2 py-0.5 rounded-full ${
                  pos.outcome === "Yes"
                    ? "bg-green-50 text-green-600"
                    : "bg-red-50 text-red-600"
                }`}
              >
                {pos.outcome}
              </span>
              <span className="text-xs text-[var(--text-secondary)]">{pos.size} shares</span>
            </div>
            <div className="flex justify-between text-xs">
              <span className="text-[var(--text-secondary)]">
                Avg ${pos.avgPrice.toFixed(2)} &rarr; ${pos.curPrice.toFixed(2)}
              </span>
              <span className={isPositive ? "text-green-600 font-medium" : "text-red-500 font-medium"}>
                {isPositive ? "+" : ""}${pos.cashPnl.toFixed(2)} ({pos.percentPnl.toFixed(0)}%)
              </span>
            </div>
          </div>
        );
      })}
    </div>
  );
}

function TradesList({ trades }: { trades: PortfolioData["trades"] }) {
  if (trades.length === 0) {
    return <p className="text-sm text-[var(--text-secondary)] text-center py-10">No trades yet</p>;
  }
  return (
    <div className="space-y-2">
      {trades.map((trade, i) => (
        <div key={`${trade.transactionHash}-${i}`} className="flex items-center gap-3 py-2 border-b border-[var(--border)] last:border-0">
          <span
            className={`text-xs font-medium px-2 py-0.5 rounded ${
              trade.side === "BUY"
                ? "bg-green-50 text-green-600"
                : "bg-red-50 text-red-500"
            }`}
          >
            {trade.side}
          </span>
          <div className="flex-1 min-w-0">
            <p className="text-sm text-[var(--text)] truncate">{trade.title}</p>
            <p className="text-xs text-[var(--text-secondary)]">
              {trade.size} @ ${trade.price.toFixed(2)} (${trade.usdcSize.toFixed(2)}) &middot; {trade.outcome}
            </p>
          </div>
        </div>
      ))}
    </div>
  );
}
