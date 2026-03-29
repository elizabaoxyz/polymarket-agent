"use client";

import { Settings, ExternalLink, LogIn, Bot } from "lucide-react";

type HeaderProps = {
  isConnected: boolean;
  isAutonomyActive: boolean;
  onToggleAutonomy: () => void;
};

export function Header({ isConnected, isAutonomyActive, onToggleAutonomy }: HeaderProps) {
  return (
    <header className="fixed top-0 left-0 right-0 z-50 bg-[var(--bg)] border-b border-[var(--border)]">
      <div className="w-full px-4 h-12 flex items-center justify-between">
        {/* Left section */}
        <div className="flex items-center gap-3">
          <span className="mono text-[var(--accent)] font-bold text-sm tracking-wider">
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
            {isAutonomyActive ? "AUTONOMY ON" : "AUTONOMY OFF"}
          </button>
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
