"use client";

type HeaderProps = {
  balance: number | null;
  isConnected: boolean;
  onOpenPositions: () => void;
  onOpenTrades: () => void;
  onOpenSettings: () => void;
};

export function Header({ balance, isConnected, onOpenPositions, onOpenTrades, onOpenSettings }: HeaderProps) {
  return (
    <header className="fixed top-0 left-0 right-0 z-50 bg-white border-b border-[var(--border)]">
      <div className="max-w-5xl mx-auto px-4 h-14 flex items-center justify-between">
        <div className="flex items-center gap-2.5">
          <div className="w-7 h-7 bg-[var(--accent)] rounded-md flex items-center justify-center text-white text-sm font-bold">
            P
          </div>
          <span className="font-semibold text-[15px]">Polyagent</span>
          <div
            className={`w-2 h-2 rounded-full ml-1 ${isConnected ? "bg-green-400" : "bg-red-400"}`}
            title={isConnected ? "Connected" : "Disconnected"}
          />
        </div>
        <div className="flex items-center gap-3">
          {balance !== null && (
            <span className="text-[var(--accent)] font-semibold text-sm font-mono">
              ${balance.toFixed(2)}
            </span>
          )}
          <button
            onClick={onOpenPositions}
            className="text-sm text-[var(--text-secondary)] hover:text-[var(--text)] px-3 py-1.5 rounded-lg hover:bg-gray-100 transition-colors"
          >
            Positions
          </button>
          <button
            onClick={onOpenTrades}
            className="text-sm text-[var(--text-secondary)] hover:text-[var(--text)] px-3 py-1.5 rounded-lg hover:bg-gray-100 transition-colors"
          >
            Trades
          </button>
          <button
            onClick={onOpenSettings}
            className="text-[var(--text-secondary)] hover:text-[var(--text)] p-1.5 rounded-lg hover:bg-gray-100 transition-colors"
            title="Settings"
          >
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <circle cx="12" cy="12" r="3" />
              <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" />
            </svg>
          </button>
        </div>
      </div>
    </header>
  );
}
