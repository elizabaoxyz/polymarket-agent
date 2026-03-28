"use client";

import { useState } from "react";
import { useWebSocket } from "@/lib/ws-client";
import { Header } from "@/components/header";
import { Chat } from "@/components/chat";
import { PortfolioPanel } from "@/components/portfolio-panel";

export default function Home() {
  // Connect immediately — server uses env vars for keys
  const { messages, sendMessage, isConnected, isThinking, portfolio, requestStatus } =
    useWebSocket();

  const [panelTab, setPanelTab] = useState<"positions" | "trades" | null>(null);

  const openPanel = (tab: "positions" | "trades") => {
    requestStatus();
    setPanelTab(tab);
  };

  return (
    <div className="h-screen flex flex-col bg-[var(--bg-chat)]">
      <Header
        balance={portfolio?.balance ?? null}
        isConnected={isConnected}
        onOpenPositions={() => openPanel("positions")}
        onOpenTrades={() => openPanel("trades")}
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
    </div>
  );
}
