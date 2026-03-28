"use client";

import { X } from "lucide-react";

type PluginInfo = {
  name: string;
  version: string;
  toolCount: number;
  description: string;
  endpoint: string;
  config: Record<string, unknown>;
  tools: string[];
  requirement?: string;
};

const PLUGINS: Record<string, PluginInfo> = {
  polymarket: {
    name: "Polymarket",
    version: "v2.0.0",
    toolCount: 8,
    description:
      "Full Polymarket prediction market integration. Access markets, order books, price history, trade events, and place orders via CLOB API.",
    endpoint: "https://clob.polymarket.com",
    config: {
      servers: {
        polymarket: {
          type: "http",
          url: "https://clob.polymarket.com",
        },
      },
    },
    tools: [
      "PLACE_ORDER",
      "CANCEL_ORDER",
      "CANCEL_ALL",
      "GET_ORDERS",
      "GET_POSITIONS",
      "GET_TRADES",
      "GET_PNL",
      "SELL_POSITION",
    ],
    requirement: "Requires CLOB_API_KEY, CLOB_API_SECRET, CLOB_API_PASSPHRASE environment variables",
  },
  jupiter: {
    name: "Jupiter",
    version: "v1.0.0",
    toolCount: 4,
    description:
      "Jupiter Prediction Markets on Solana. Scan live events, place bets, check positions, and claim winnings.",
    endpoint: "https://api.jup.ag/prediction/v1",
    config: {
      servers: {
        jupiter: {
          type: "http",
          url: "https://api.jup.ag/prediction/v1",
        },
      },
    },
    tools: [
      "SCAN_MARKETS",
      "PLACE_BET",
      "CHECK_POSITIONS",
      "CLAIM_WINNINGS",
    ],
    requirement: "Requires JUPITER_API_KEY and SOLANA_PRIVATE_KEY environment variables",
  },
  x402: {
    name: "x402 Payments",
    version: "v1.0.0",
    toolCount: 1,
    description:
      "x402 HTTP payment protocol. Automatic USDC payments on Solana for 402-gated API endpoints. Wraps global fetch to handle payment challenges transparently.",
    endpoint: "Solana Mainnet",
    config: {
      servers: {
        x402: {
          type: "solana",
          network: "mainnet",
          maxPaymentUsd: 0.10,
        },
      },
    },
    tools: ["AUTO_PAY_402"],
    requirement: "Requires SOLANA_PRIVATE_KEY and X402_ENABLED=true environment variables",
  },
};

type PluginModalProps = {
  pluginKey: string;
  onClose: () => void;
};

export default function PluginModal({ pluginKey, onClose }: PluginModalProps) {
  const plugin = PLUGINS[pluginKey];
  if (!plugin) return null;

  return (
    <>
      <div className="fixed inset-0 bg-black/60 z-[100]" onClick={onClose} />
      <div className="fixed inset-0 z-[101] flex items-center justify-center p-4">
        <div className="bg-[var(--bg-panel)] border border-[var(--border)] rounded-xl max-w-lg w-full max-h-[85vh] overflow-y-auto">
          {/* Header */}
          <div className="flex items-start justify-between p-5 border-b border-[var(--border)]">
            <div>
              <h2 className="text-lg font-bold text-[var(--text)]">{plugin.name}</h2>
              <p className="mono text-xs text-[var(--text-secondary)] mt-0.5">
                {plugin.version} · {plugin.toolCount} tools
              </p>
            </div>
            <div className="flex items-center gap-3">
              <span className="mono text-xs text-[var(--green)] border border-[var(--green)] rounded-full px-3 py-0.5">
                Enabled
              </span>
              <button
                onClick={onClose}
                className="text-[var(--text-secondary)] hover:text-[var(--text)] transition-colors"
              >
                <X size={18} />
              </button>
            </div>
          </div>

          {/* Body */}
          <div className="p-5 space-y-5">
            {/* Description */}
            <p className="text-sm text-[var(--text-secondary)] leading-relaxed">
              {plugin.description}
            </p>

            {/* MCP Endpoint */}
            <div>
              <h3 className="mono text-xs text-[var(--text)] font-bold mb-2 tracking-wider">
                MCP ENDPOINT
              </h3>
              <div className="bg-[var(--bg-card)] border border-[var(--border)] rounded-lg px-4 py-3">
                <code className="mono text-sm text-[var(--accent)]">{plugin.endpoint}</code>
              </div>
            </div>

            {/* Configuration */}
            <div>
              <h3 className="mono text-xs text-[var(--text)] font-bold mb-2 tracking-wider">
                CONFIGURATION
              </h3>
              <div className="bg-[var(--bg-card)] border border-[var(--border)] rounded-lg px-4 py-3">
                <pre className="mono text-xs text-[var(--text-secondary)] whitespace-pre-wrap overflow-x-auto">
                  {JSON.stringify(plugin.config, null, 2)}
                </pre>
              </div>
            </div>

            {/* Available Tools */}
            <div>
              <h3 className="mono text-xs text-[var(--text)] font-bold mb-2 tracking-wider">
                AVAILABLE TOOLS ({plugin.tools.length})
              </h3>
              <div className="flex flex-wrap gap-2">
                {plugin.tools.map((tool) => (
                  <span
                    key={tool}
                    className="mono text-xs text-[var(--text)] bg-[var(--bg-card)] border border-[var(--border)] rounded-md px-3 py-1.5 hover:border-[var(--accent)] transition-colors"
                  >
                    {tool}
                  </span>
                ))}
              </div>
            </div>

            {/* Requirement */}
            {plugin.requirement && (
              <p className="mono text-xs text-[var(--accent)] italic">
                {plugin.requirement}
              </p>
            )}
          </div>
        </div>
      </div>
    </>
  );
}
