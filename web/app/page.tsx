"use client";

import { useEffect, useState } from "react";
import { useWebSocket } from "@/lib/ws-client";
import { loadKeys, saveKeys, clearKeys, hasRequiredKeys, type UserKeys } from "@/lib/keys";
import { Header } from "@/components/header";
import { Chat } from "@/components/chat";
import { PortfolioPanel } from "@/components/portfolio-panel";
import { SettingsModal } from "@/components/settings-modal";

export default function Home() {
  const [keys, setKeys] = useState<UserKeys | null>(null);
  const [showSettings, setShowSettings] = useState(false);

  useEffect(() => {
    const stored = loadKeys();
    if (stored && hasRequiredKeys(stored)) {
      setKeys(stored);
    } else {
      setShowSettings(true);
    }
  }, []);

  const { messages, sendMessage, isConnected, isThinking, portfolio, requestStatus, authState, authError, disconnect } =
    useWebSocket(keys);

  const [panelTab, setPanelTab] = useState<"positions" | "trades" | null>(null);

  useEffect(() => {
    if (authState === "auth_error") {
      setShowSettings(true);
    }
  }, [authState]);

  const handleSaveKeys = (newKeys: UserKeys) => {
    saveKeys(newKeys);
    setKeys({ ...newKeys });
    setShowSettings(false);
  };

  const handleDisconnect = () => {
    disconnect();
    clearKeys();
    setKeys(null);
    setShowSettings(true);
  };

  const openPanel = (tab: "positions" | "trades") => {
    requestStatus();
    setPanelTab(tab);
  };

  const needsSettings = !keys || showSettings;

  return (
    <div className="h-screen flex flex-col bg-[var(--bg-chat)]">
      <Header
        balance={portfolio?.balance ?? null}
        isConnected={isConnected}
        onOpenPositions={() => openPanel("positions")}
        onOpenTrades={() => openPanel("trades")}
        onOpenSettings={() => setShowSettings(true)}
      />

      <main className="flex-1 pt-14 overflow-hidden">
        <Chat
          messages={messages}
          isThinking={isThinking}
          isConnected={isConnected}
          onSend={sendMessage}
        />
      </main>

      {panelTab && (
        <PortfolioPanel
          portfolio={portfolio}
          initialTab={panelTab}
          onClose={() => setPanelTab(null)}
        />
      )}

      {needsSettings && (
        <SettingsModal
          initialKeys={keys ?? loadKeys() ?? {}}
          onSave={handleSaveKeys}
          onDisconnect={keys ? handleDisconnect : undefined}
          isEdit={!!keys}
        />
      )}

      {authState === "authenticating" && (
        <div className="fixed inset-0 z-[90] bg-white/80 flex items-center justify-center">
          <div className="text-center">
            <div className="w-8 h-8 border-2 border-[var(--accent)] border-t-transparent rounded-full animate-spin mx-auto mb-3" />
            <p className="text-sm text-[var(--text-secondary)]">Initializing agent runtime...</p>
          </div>
        </div>
      )}

      {authError && showSettings && (
        <div className="fixed bottom-4 left-1/2 -translate-x-1/2 z-[110] bg-red-50 border border-red-200 text-red-700 text-sm px-4 py-2 rounded-lg">
          {authError}
        </div>
      )}
    </div>
  );
}
