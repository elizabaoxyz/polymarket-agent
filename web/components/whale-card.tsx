import type { WhaleWallet } from "@/lib/types";
import { Copy, Search } from "lucide-react";

type WhaleCardProps = {
  whale: WhaleWallet;
  onClick: () => void;
};

function formatUsd(n: number): string {
  if (n >= 1_000_000) return `$${(n / 1_000_000).toFixed(2)}M`;
  if (n >= 1_000) return `$${(n / 1_000).toFixed(1)}K`;
  return `$${n.toFixed(2)}`;
}

export default function WhaleCard({ whale, onClick }: WhaleCardProps) {
  const shortAddress =
    whale.address.slice(0, 6) + "..." + whale.address.slice(-4);

  return (
    <div
      onClick={onClick}
      className="bg-[var(--bg-panel)] border border-[var(--border)] rounded-lg p-4 cursor-pointer hover:border-[var(--accent)] transition-colors"
    >
      {/* Header */}
      <div className="flex items-center justify-between mb-1">
        <span
          className="mono text-[var(--green)] text-sm font-semibold truncate"
          style={{ fontFamily: "var(--font-mono), monospace" }}
        >
          {whale.name}
        </span>
        <button
          onClick={(e) => e.stopPropagation()}
          className="text-[var(--text-muted)] hover:text-[var(--text-secondary)] p-1"
          aria-label="Copy address"
        >
          <Copy size={14} />
        </button>
      </div>

      {/* Pseudonym */}
      {whale.pseudonym && (
        <p className="text-xs text-[var(--text-muted)] mb-2">{whale.pseudonym}</p>
      )}

      {/* Volume */}
      <div className="mb-2">
        <span
          className="text-[9px] uppercase tracking-wider text-[var(--text-muted)]"
          style={{ fontFamily: "var(--font-mono), monospace" }}
        >
          VOLUME:
        </span>
        <span
          className="ml-2 text-sm text-[var(--text)] font-bold"
          style={{ fontFamily: "var(--font-mono), monospace" }}
        >
          {formatUsd(whale.totalVolume)}
        </span>
      </div>

      {/* Wallet address */}
      <p
        className="text-[10px] text-[var(--text-muted)] mb-3"
        style={{ fontFamily: "var(--font-mono), monospace" }}
      >
        {shortAddress}
      </p>

      {/* View on Polymarket button */}
      <button
        onClick={(e) => {
          e.stopPropagation();
          window.open(
            `https://polymarket.com/profile/${whale.address}`,
            "_blank",
            "noopener,noreferrer"
          );
        }}
        className="w-full flex items-center justify-center gap-1.5 text-xs text-[var(--green)] border border-[var(--green)] rounded-md py-1.5 hover:bg-[var(--green)]/10 transition-colors"
        style={{ fontFamily: "var(--font-mono), monospace" }}
      >
        <Search size={12} />
        View on Polymarket
      </button>
    </div>
  );
}
