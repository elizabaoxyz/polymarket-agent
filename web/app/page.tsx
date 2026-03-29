"use client";

import { useCallback, useEffect, useState } from "react";
import { useWebSocket } from "@/lib/ws-client";
import { getGlobalTrades, computeDashboardStats } from "@/lib/polymarket-api";
import type { DashboardStats } from "@/lib/types";
import { Header } from "@/components/header";
import { LeftSidebar } from "@/components/left-sidebar";
import { CenterChat } from "@/components/center-chat";
import { RightSidebar } from "@/components/right-sidebar";
import Dashboard from "@/components/dashboard";
import WhaleModal from "@/components/whale-modal";
import PluginModal from "@/components/plugin-modal";
import X402Modal from "@/components/x402-modal";
import { BarChart3, MessageSquare, Puzzle } from "lucide-react";

type MobileTab = "chat" | "portfolio" | "plugins";

export default function Home() {
  const { messages, sendMessage, isConnected, isThinking, portfolio, requestStatus, isAutonomyActive, toggleAutonomy } =
    useWebSocket();

  const [dashboardStats, setDashboardStats] = useState<DashboardStats | null>(null);
  const [selectedWhale, setSelectedWhale] = useState<{
    address: string;
    name: string;
    pseudonym: string;
    volume: number;
  } | null>(null);
  const [selectedPlugin, setSelectedPlugin] = useState<string | null>(null);
  const [showX402, setShowX402] = useState(false);
  const [mobileTab, setMobileTab] = useState<MobileTab>("chat");
  const [liveFeed, setLiveFeed] = useState<
    Array<{ address: string; market: string; amount: number; side: "BUY" | "SELL" }>
  >([]);

  // Fetch dashboard data on mount + every 30s
  const fetchDashboard = useCallback(async () => {
    try {
      const trades = await getGlobalTrades(500);
      const stats = computeDashboardStats(trades);
      setDashboardStats(stats);
      setLiveFeed(
        trades.slice(0, 10).map((t) => ({
          address: t.proxyWallet,
          market: t.title,
          amount: t.usdcSize ?? t.size * t.price,
          side: t.side as "BUY" | "SELL",
        }))
      );
    } catch {
      // silently fail
    }
  }, []);

  useEffect(() => {
    fetchDashboard();
    const interval = setInterval(fetchDashboard, 30000);
    return () => clearInterval(interval);
  }, [fetchDashboard]);

  // Request portfolio status on connect
  useEffect(() => {
    if (isConnected) requestStatus();
  }, [isConnected, requestStatus]);

  const handleQuickAction = (prompt: string) => {
    sendMessage(prompt);
  };

  const handleWhaleClick = (address: string) => {
    const whale = dashboardStats?.whales.find((w) => w.address === address);
    if (whale) {
      setSelectedWhale({
        address,
        name: whale.name,
        pseudonym: whale.pseudonym,
        volume: whale.totalVolume,
      });
    }
  };

  return (
    <div className="flex flex-col bg-[var(--bg)] min-h-screen">
      <Header
        isConnected={isConnected}
        isAutonomyActive={isAutonomyActive}
        onToggleAutonomy={toggleAutonomy}
        x402Status={portfolio?.x402}
        onX402Click={() => setShowX402(true)}
      />

      {/* Desktop layout: 3 columns */}
      <div className="hidden md:flex pt-12" style={{ height: "calc(100vh - 48px)", minHeight: "500px" }}>
        <LeftSidebar
          balance={portfolio?.balance ?? null}
          solanaBalance={portfolio?.solanaBalance ?? null}
          positionCount={portfolio?.positions?.length ?? 0}
          isConnected={isConnected}
          liveFeed={liveFeed}
          positions={portfolio?.positions ?? []}
          trades={portfolio?.trades ?? []}
          jupiterPositions={portfolio?.jupiterPositions ?? []}
          onAnalyze={() => sendMessage("analyze polymarket markets and place a bet")}
          onRefreshPortfolio={requestStatus}
        />

        <div className="flex-1 flex flex-col overflow-hidden">
          <CenterChat
            messages={messages}
            isThinking={isThinking}
            isConnected={isConnected}
            onSend={sendMessage}
          />
        </div>

        <RightSidebar onQuickAction={handleQuickAction} onPluginClick={setSelectedPlugin} />
      </div>

      {/* Mobile layout: single panel with bottom nav */}
      <div className="md:hidden pt-12 pb-14" style={{ height: "calc(100vh - 48px)" }}>
        {mobileTab === "chat" && (
          <div className="h-full flex flex-col overflow-hidden">
            <CenterChat
              messages={messages}
              isThinking={isThinking}
              isConnected={isConnected}
              onSend={sendMessage}
            />
          </div>
        )}
        {mobileTab === "portfolio" && (
          <div className="h-full overflow-y-auto">
            <LeftSidebar
              balance={portfolio?.balance ?? null}
              solanaBalance={portfolio?.solanaBalance ?? null}
              positionCount={portfolio?.positions?.length ?? 0}
              isConnected={isConnected}
              liveFeed={liveFeed}
              positions={portfolio?.positions ?? []}
              trades={portfolio?.trades ?? []}
              jupiterPositions={portfolio?.jupiterPositions ?? []}
              onAnalyze={() => sendMessage("analyze polymarket markets and place a bet")}
              onRefreshPortfolio={requestStatus}
            />
          </div>
        )}
        {mobileTab === "plugins" && (
          <div className="h-full overflow-y-auto">
            <RightSidebar onQuickAction={(prompt) => { handleQuickAction(prompt); setMobileTab("chat"); }} onPluginClick={setSelectedPlugin} />
          </div>
        )}

        {/* Mobile bottom nav */}
        <nav className="fixed bottom-0 left-0 right-0 z-50 bg-[var(--bg-panel)] border-t border-[var(--border)] flex">
          {([
            { key: "chat" as MobileTab, icon: <MessageSquare size={18} />, label: "Chat" },
            { key: "portfolio" as MobileTab, icon: <BarChart3 size={18} />, label: "Portfolio" },
            { key: "plugins" as MobileTab, icon: <Puzzle size={18} />, label: "Plugins" },
          ]).map((tab) => (
            <button
              key={tab.key}
              onClick={() => setMobileTab(tab.key)}
              className={`flex-1 flex flex-col items-center gap-0.5 py-2 transition-colors ${
                mobileTab === tab.key
                  ? "text-[var(--accent)]"
                  : "text-[var(--text-muted)]"
              }`}
            >
              {tab.icon}
              <span className="mono text-[9px] tracking-wider">{tab.label.toUpperCase()}</span>
            </button>
          ))}
        </nav>
      </div>

      {/* Dashboard — below main content on both layouts */}
      <div className="hidden md:block">
        <Dashboard stats={dashboardStats} onWhaleClick={handleWhaleClick} />
      </div>

      {selectedWhale && (
        <WhaleModal
          address={selectedWhale.address}
          name={selectedWhale.name}
          pseudonym={selectedWhale.pseudonym}
          totalVolume={selectedWhale.volume}
          onClose={() => setSelectedWhale(null)}
        />
      )}

      {showX402 && portfolio?.x402 && (
        <X402Modal
          status={portfolio.x402}
          onClose={() => setShowX402(false)}
        />
      )}

      {selectedPlugin && (
        <PluginModal
          pluginKey={selectedPlugin}
          onClose={() => setSelectedPlugin(null)}
        />
      )}
    </div>
  );
}
