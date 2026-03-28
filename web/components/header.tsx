"use client";

type HeaderProps = {
  balance: number | null;
  isConnected: boolean;
  onOpenPositions: () => void;
  onOpenTrades: () => void;
};

export function Header({ balance, isConnected, onOpenPositions, onOpenTrades }: HeaderProps) {
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
        </div>
      </div>
    </header>
  );
}
