"use client";

import { useEffect, useState } from "react";
import { X, Copy, ExternalLink } from "lucide-react";
import { getWalletTrades } from "@/lib/polymarket-api";
import type { GlobalTrade } from "@/lib/types";

type WhaleModalProps = {
  address: string;
  name: string;
  pseudonym: string;
  totalVolume: number;
  onClose: () => void;
};

function formatUsd(n: number): string {
  if (n >= 1_000_000) return `$${(n / 1_000_000).toFixed(2)}M`;
  if (n >= 1_000) return `$${(n / 1_000).toFixed(1)}K`;
  return `$${n.toFixed(2)}`;
}

function formatTime(ts: number): string {
  const d = new Date(ts * 1000);
  return d.toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

const mono: React.CSSProperties = {
  fontFamily: "var(--font-mono), monospace",
};

export default function WhaleModal({
  address,
  name,
  pseudonym,
  totalVolume,
  onClose,
}: WhaleModalProps) {
  const [trades, setTrades] = useState<GlobalTrade[] | null>(null);

  useEffect(() => {
    let cancelled = false;
    getWalletTrades(address, 50).then((result) => {
      if (!cancelled) setTrades(result);
    });
    return () => {
      cancelled = true;
    };
  }, [address]);

  const shortAddress = address.slice(0, 6) + "..." + address.slice(-4);

  const buyCount = trades?.filter((t) => t.side === "BUY").length ?? 0;
  const sellCount = trades?.filter((t) => t.side === "SELL").length ?? 0;

  return (
    <div
      className="fixed inset-0 bg-black/60 z-[100] flex items-center justify-center p-4"
      onClick={onClose}
    >
      <div
        className="w-full max-w-2xl bg-[var(--bg-panel)] border border-[var(--border)] rounded-xl overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-start justify-between p-5 border-b border-[var(--border)]">
          <div className="min-w-0">
            <h2 className="text-lg font-bold text-[var(--green)]" style={mono}>
              {name}
            </h2>
            {pseudonym && (
              <p className="text-xs text-[var(--text-muted)] mt-0.5">
                {pseudonym}
              </p>
            )}
            <div className="flex items-center gap-2 mt-1.5">
              <span
                className="text-[11px] text-[var(--text-muted)] truncate"
                style={mono}
              >
                {shortAddress}
              </span>
              <button
                className="text-[var(--text-muted)] hover:text-[var(--text-secondary)] p-0.5"
                aria-label="Copy address"
              >
                <Copy size={12} />
              </button>
            </div>
          </div>
          <button
            onClick={onClose}
            className="text-[var(--text-muted)] hover:text-[var(--text)] p-1"
            aria-label="Close"
          >
            <X size={18} />
          </button>
        </div>

        {/* Stats row */}
        <div className="grid grid-cols-3 gap-3 p-5 border-b border-[var(--border)]">
          <div>
            <p
              className="text-[9px] uppercase tracking-wider text-[var(--text-muted)] mb-1"
              style={mono}
            >
              Total Volume
            </p>
            <p className="text-base font-bold text-[var(--text)]" style={mono}>
              {formatUsd(totalVolume)}
            </p>
          </div>
          <div>
            <p
              className="text-[9px] uppercase tracking-wider text-[var(--text-muted)] mb-1"
              style={mono}
            >
              Trades
            </p>
            <p className="text-base font-bold text-[var(--text)]" style={mono}>
              {trades !== null ? trades.length : "--"}
            </p>
          </div>
          <div>
            <p
              className="text-[9px] uppercase tracking-wider text-[var(--text-muted)] mb-1"
              style={mono}
            >
              Buy / Sell
            </p>
            <p className="text-base font-bold" style={mono}>
              <span className="text-[var(--green)]">{buyCount}</span>
              <span className="text-[var(--text-muted)]"> / </span>
              <span className="text-[var(--red)]">{sellCount}</span>
            </p>
          </div>
        </div>

        {/* Trade history */}
        <div className="max-h-80 overflow-y-auto">
          {trades === null ? (
            <p
              className="text-sm text-[var(--text-muted)] text-center py-10"
              style={mono}
            >
              Loading trades...
            </p>
          ) : trades.length === 0 ? (
            <p
              className="text-sm text-[var(--text-muted)] text-center py-10"
              style={mono}
            >
              No trades found
            </p>
          ) : (
            <div className="divide-y divide-[var(--border)]">
              {trades.map((trade, i) => (
                <div
                  key={`${trade.conditionId}-${trade.timestamp}-${i}`}
                  className="flex items-center gap-3 px-5 py-3"
                >
                  {/* Title */}
                  <p className="flex-1 min-w-0 text-sm text-[var(--text)] truncate">
                    {trade.title}
                  </p>

                  {/* Side badge */}
                  <span
                    className={`shrink-0 text-[10px] font-bold px-2 py-0.5 rounded ${
                      trade.side === "BUY"
                        ? "bg-[var(--green)]/15 text-[var(--green)]"
                        : "bg-[var(--red)]/15 text-[var(--red)]"
                    }`}
                    style={mono}
                  >
                    {trade.side}
                  </span>

                  {/* Size */}
                  <span
                    className="shrink-0 text-xs text-[var(--text)]"
                    style={mono}
                  >
                    {formatUsd(trade.usdcSize ?? trade.size * trade.price)}
                  </span>

                  {/* Price */}
                  <span
                    className="shrink-0 text-xs text-[var(--text-secondary)]"
                    style={mono}
                  >
                    @{trade.price.toFixed(2)}
                  </span>

                  {/* Outcome */}
                  <span
                    className={`shrink-0 text-[10px] ${
                      trade.outcome === "Yes"
                        ? "text-[var(--green)]"
                        : "text-[var(--red)]"
                    }`}
                    style={mono}
                  >
                    {trade.outcome}
                  </span>

                  {/* Time */}
                  <span
                    className="shrink-0 text-[10px] text-[var(--text-muted)]"
                    style={mono}
                  >
                    {formatTime(trade.timestamp)}
                  </span>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="p-4 border-t border-[var(--border)]">
          <a
            href={`https://polymarket.com/profile/${address}`}
            target="_blank"
            rel="noopener noreferrer"
            className="flex items-center justify-center gap-2 w-full py-2 text-sm text-[var(--green)] border border-[var(--green)] rounded-lg hover:bg-[var(--green)]/10 transition-colors"
            style={mono}
          >
            <ExternalLink size={14} />
            View on Polymarket
          </a>
        </div>
      </div>
    </div>
  );
}
