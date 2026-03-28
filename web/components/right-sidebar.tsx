"use client";

import {
  BarChart3,
  Globe,
  CreditCard,
  Zap,
  DollarSign,
  Activity,
  Search,
  FileText,
  LayoutGrid,
  Smartphone,
} from "lucide-react";

type RightSidebarProps = {
  onQuickAction: (prompt: string) => void;
  onPluginClick?: (key: string) => void;
};

const plugins = [
  { key: "polymarket", icon: BarChart3, name: "Polymarket", tools: "8 tools" },
  { key: "jupiter", icon: Globe, name: "Jupiter", tools: "4 tools" },
  { key: "x402", icon: CreditCard, name: "x402 Payments", tools: "1 tools" },
];

const quickActionGroups = [
  {
    title: "Polymarket",
    actions: [
      { icon: Zap, label: "Scan Markets", prompt: "place a $3 YES bet on polymarket on something interesting" },
      { icon: BarChart3, label: "Show Positions", prompt: "show my positions" },
      { icon: DollarSign, label: "Place $3 Bet", prompt: "buy $3 YES on something interesting" },
      { icon: Activity, label: "Show PnL", prompt: "show me my pnl on polymarket" },
      { icon: FileText, label: "Show Trades", prompt: "show my recent trades" },
    ],
  },
  {
    title: "Jupiter (Solana)",
    actions: [
      { icon: Search, label: "Scan Jupiter", prompt: "scan jupiter prediction markets on solana" },
      { icon: DollarSign, label: "Bet on Jupiter", prompt: "bet $2 YES on jupiter market POLY-567688" },
    ],
  },
  {
    title: "x402 Payments",
    actions: [
      { icon: CreditCard, label: "Payment Status", prompt: "what x402 payments have you made?" },
    ],
  },
];

function SectionTitle({ label }: { label: string }) {
  return (
    <div className="flex items-center gap-2 mb-3">
      <div className="w-2 h-2 bg-[var(--green)] rounded-sm" />
      <span className="mono text-[10px] font-semibold tracking-wider text-[var(--text-secondary)] uppercase">
        {label}
      </span>
    </div>
  );
}

export function RightSidebar({ onQuickAction, onPluginClick }: RightSidebarProps) {
  return (
    <aside className="w-[220px] min-w-[220px] h-full bg-[var(--bg-panel)] border-l border-[var(--border)] overflow-y-auto px-3 py-4 flex flex-col gap-5">
      {/* Plugins */}
      <section>
        <SectionTitle label="Plugins MCP Enabled 3" />
        <div className="flex flex-col gap-2">
          {plugins.map((plugin) => (
            <div
              key={plugin.key}
              onClick={() => onPluginClick?.(plugin.key)}
              className="flex items-center gap-3 px-2 py-2 rounded-lg hover:bg-[var(--bg-card)] transition-colors cursor-pointer"
            >
              <div className="w-7 h-7 rounded-md bg-[var(--bg-card)] border border-[var(--border)] flex items-center justify-center text-[var(--text-secondary)]">
                <plugin.icon size={14} />
              </div>
              <div className="flex flex-col">
                <span className="text-xs text-[var(--text)] font-medium leading-tight">
                  {plugin.name}
                </span>
                <span className="mono text-[10px] text-[var(--green)] leading-tight">
                  {plugin.tools}
                </span>
              </div>
            </div>
          ))}
        </div>
      </section>

      {/* Quick Actions */}
      <section>
        <SectionTitle label="Quick Actions" />
        <div className="flex flex-col gap-3">
          {quickActionGroups.map((group) => (
            <div key={group.title}>
              <span className="mono text-[9px] text-[var(--accent)] tracking-wider uppercase mb-1.5 block">
                {group.title}
              </span>
              <div className="grid grid-cols-2 gap-2">
                {group.actions.map((action) => (
                  <button
                    key={action.label}
                    onClick={() => onQuickAction(action.prompt)}
                    className="flex items-center gap-2 px-2.5 py-2 rounded-lg border border-[var(--green)]/30 hover:border-[var(--green)] hover:bg-[var(--bg-agent)] text-[var(--text)] transition-colors text-left"
                  >
                    <action.icon size={13} className="text-[var(--green)] shrink-0" />
                    <span className="text-[11px] font-medium leading-tight">{action.label}</span>
                  </button>
                ))}
              </div>
            </div>
          ))}
        </div>
      </section>

      {/* Builder Card */}
      <section>
        <div className="rounded-lg border border-[var(--border)] bg-[var(--bg-card)] px-3 py-3 flex items-center gap-3">
          <div className="w-7 h-7 rounded-md bg-[var(--bg-agent)] border border-[var(--green)]/20 flex items-center justify-center text-[var(--green)]">
            <LayoutGrid size={14} />
          </div>
          <div className="flex flex-col flex-1 min-w-0">
            <div className="flex items-center gap-2">
              <span className="text-xs text-[var(--text)] font-medium truncate">
                Polymarket Builder
              </span>
              <span className="mono text-[9px] font-bold px-1.5 py-0.5 rounded bg-[var(--green)]/15 text-[var(--green)] leading-none shrink-0">
                API
              </span>
            </div>
            <span className="text-[10px] text-[var(--text-secondary)] leading-tight mt-0.5">
              Builder Dashboard
            </span>
          </div>
        </div>
      </section>

      {/* Coming Soon */}
      <section>
        <SectionTitle label="Coming Soon" />
        <div className="flex flex-col gap-2">
          {["iOS App", "Android App"].map((name) => (
            <div
              key={name}
              className="flex items-center gap-3 px-2 py-2 rounded-lg opacity-60"
            >
              <div className="w-7 h-7 rounded-md bg-[var(--bg-card)] border border-[var(--border)] flex items-center justify-center text-[var(--text-muted)]">
                <Smartphone size={14} />
              </div>
              <div className="flex flex-col">
                <span className="text-xs text-[var(--text)] font-medium leading-tight">
                  {name}
                </span>
                <span className="text-[10px] text-[var(--text-muted)] leading-tight">
                  Coming Soon
                </span>
              </div>
            </div>
          ))}
        </div>
      </section>
    </aside>
  );
}
