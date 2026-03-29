"use client";

import type { DashboardStats } from "@/lib/types";
import WhaleCard from "./whale-card";
import {
  DollarSign,
  ArrowLeftRight,
  Users,
  Activity,
  TrendingUp,
  TrendingDown,
  Check,
  X,
} from "lucide-react";

type DashboardProps = {
  stats: DashboardStats | null;
  onWhaleClick: (address: string) => void;
};

function formatUsd(n: number): string {
  if (n >= 1_000_000) return `$${(n / 1_000_000).toFixed(2)}M`;
  if (n >= 1_000) return `$${(n / 1_000).toFixed(1)}K`;
  return `$${n.toFixed(2)}`;
}

const mono: React.CSSProperties = {
  fontFamily: "var(--font-mono), monospace",
};

export default function Dashboard({ stats, onWhaleClick }: DashboardProps) {
  return (
    <div className="p-4 md:p-6 space-y-4 md:space-y-6 shimmer-border">
      {/* Section title */}
      <div className="flex items-center gap-2">
        <div className="w-3 h-3 rounded-sm bg-[var(--green)]" />
        <h2
          className="text-sm tracking-wider text-[var(--text)]"
          style={mono}
        >
          WHALE_ANALYTICS_DASHBOARD
        </h2>
      </div>

      {stats === null ? (
        <p className="text-sm text-[var(--text-muted)]" style={mono}>
          Loading dashboard...
        </p>
      ) : (
        <>
          {/* Stats row */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            <StatCard
              icon={<DollarSign size={16} />}
              label="24H_VOLUME"
              value={formatUsd(stats.volume24h)}
              color="var(--green)"
            />
            <StatCard
              icon={<ArrowLeftRight size={16} />}
              label="TXS"
              value={String(stats.transactions)}
              color="var(--text)"
            />
            <StatCard
              icon={<Users size={16} />}
              label="WHALES"
              value={String(stats.whaleCount)}
              color="var(--text)"
            />
            <StatCard
              icon={<Activity size={16} />}
              label="AVG"
              value={formatUsd(stats.avgTradeSize)}
              color="var(--red)"
            />
          </div>

          {/* Pressure bars */}
          <div className="grid grid-cols-2 gap-3">
            {/* Buy / Sell pressure */}
            <PressureCard
              leftLabel="BUY_PRESSURE"
              rightLabel="SELL_PRESSURE"
              leftIcon={<TrendingUp size={12} />}
              rightIcon={<TrendingDown size={12} />}
              leftValue={stats.buyVolume}
              rightValue={stats.sellVolume}
            />
            {/* Yes / No outcome */}
            <PressureCard
              leftLabel="YES_OUTCOME"
              rightLabel="NO_OUTCOME"
              leftIcon={<Check size={12} />}
              rightIcon={<X size={12} />}
              leftValue={stats.yesVolume}
              rightValue={stats.noVolume}
            />
          </div>

          {/* Largest row */}
          <div className="grid grid-cols-2 gap-3">
            <div className="bg-[var(--bg-card)] border border-[var(--border)] rounded-lg p-4">
              <div className="flex items-center gap-1.5 mb-2">
                <TrendingUp size={14} className="text-[var(--green)]" />
                <span
                  className="text-[9px] uppercase tracking-wider text-[var(--text-muted)]"
                  style={mono}
                >
                  LARGEST_BUY
                </span>
              </div>
              <p
                className="text-xl font-bold text-[var(--green)]"
                style={mono}
              >
                {formatUsd(stats.largestBuy)}
              </p>
            </div>
            <div className="bg-[var(--bg-card)] border border-[var(--border)] rounded-lg p-4">
              <div className="flex items-center gap-1.5 mb-2">
                <TrendingDown size={14} className="text-[var(--red)]" />
                <span
                  className="text-[9px] uppercase tracking-wider text-[var(--text-muted)]"
                  style={mono}
                >
                  LARGEST_SELL
                </span>
              </div>
              <p
                className="text-xl font-bold text-[var(--red)]"
                style={mono}
              >
                {formatUsd(stats.largestSell)}
              </p>
            </div>
          </div>

          {/* Whale grid */}
          <div className="space-y-3">
            <div className="flex items-center gap-2">
              <Users size={14} className="text-[var(--text-muted)]" />
              <h3
                className="text-xs tracking-wider text-[var(--text-secondary)]"
                style={mono}
              >
                WHALE_WALLETS ({stats.whales.length})
              </h3>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-3">
              {stats.whales.map((whale) => (
                <WhaleCard
                  key={whale.address}
                  whale={whale}
                  onClick={() => onWhaleClick(whale.address)}
                />
              ))}
            </div>
          </div>
        </>
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Sub-components                                                      */
/* ------------------------------------------------------------------ */

function StatCard({
  icon,
  label,
  value,
  color,
}: {
  icon: React.ReactNode;
  label: string;
  value: string;
  color: string;
}) {
  return (
    <div className="bg-[var(--bg-card)] border border-[var(--border)] rounded-lg p-4">
      <div className="flex items-center gap-1.5 mb-2 text-[var(--text-muted)]">
        {icon}
        <span
          className="text-[9px] uppercase tracking-wider"
          style={{ fontFamily: "var(--font-mono), monospace" }}
        >
          {label}
        </span>
      </div>
      <p
        className="text-xl font-bold"
        style={{
          fontFamily: "var(--font-mono), monospace",
          color,
        }}
      >
        {value}
      </p>
    </div>
  );
}

function PressureCard({
  leftLabel,
  rightLabel,
  leftIcon,
  rightIcon,
  leftValue,
  rightValue,
}: {
  leftLabel: string;
  rightLabel: string;
  leftIcon: React.ReactNode;
  rightIcon: React.ReactNode;
  leftValue: number;
  rightValue: number;
}) {
  const total = leftValue + rightValue;
  const leftPct = total > 0 ? (leftValue / total) * 100 : 50;

  return (
    <div className="bg-[var(--bg-card)] border border-[var(--border)] rounded-lg p-4">
      {/* Header */}
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-1 text-[var(--green)]">
          {leftIcon}
          <span
            className="text-[9px] uppercase tracking-wider"
            style={{ fontFamily: "var(--font-mono), monospace" }}
          >
            {leftLabel}
          </span>
        </div>
        <div className="flex items-center gap-1 text-[var(--red)]">
          <span
            className="text-[9px] uppercase tracking-wider"
            style={{ fontFamily: "var(--font-mono), monospace" }}
          >
            {rightLabel}
          </span>
          {rightIcon}
        </div>
      </div>

      {/* Bar */}
      <div
        className="w-full h-2 rounded-full overflow-hidden flex"
        style={{ background: "var(--bg-panel)" }}
      >
        <div
          className="h-full rounded-l-full"
          style={{
            width: `${leftPct}%`,
            background: "var(--green)",
          }}
        />
        <div
          className="h-full rounded-r-full"
          style={{
            width: `${100 - leftPct}%`,
            background: "var(--red)",
          }}
        />
      </div>

      {/* Value labels */}
      <div className="flex items-center justify-between mt-2">
        <span
          className="text-xs text-[var(--green)]"
          style={{ fontFamily: "var(--font-mono), monospace" }}
        >
          {formatUsd(leftValue)}
        </span>
        <span
          className="text-xs text-[var(--red)]"
          style={{ fontFamily: "var(--font-mono), monospace" }}
        >
          {formatUsd(rightValue)}
        </span>
      </div>
    </div>
  );
}
