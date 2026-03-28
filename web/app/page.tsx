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
import dynamic from "next/dynamic";

const VrmAvatar = dynamic(() => import("@/components/vrm-avatar"), { ssr: false });

export default function Home() {
  const { messages, sendMessage, isConnected, isThinking, portfolio, requestStatus } =
    useWebSocket();

  const [dashboardStats, setDashboardStats] = useState<DashboardStats | null>(null);
  const [selectedWhale, setSelectedWhale] = useState<{
    address: string;
    name: string;
    pseudonym: string;
    volume: number;
  } | null>(null);
  const [selectedPlugin, setSelectedPlugin] = useState<string | null>(null);
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
      <Header balance={portfolio?.balance ?? null} isConnected={isConnected} />

      <div className="flex pt-12" style={{ height: "calc(100vh - 48px)", minHeight: "500px" }}>
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

      <Dashboard stats={dashboardStats} onWhaleClick={handleWhaleClick} />

      <VrmAvatar />

      {selectedWhale && (
        <WhaleModal
          address={selectedWhale.address}
          name={selectedWhale.name}
          pseudonym={selectedWhale.pseudonym}
          totalVolume={selectedWhale.volume}
          onClose={() => setSelectedWhale(null)}
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
