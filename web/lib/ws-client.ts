"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { ChatMessage, PortfolioData, ServerMessage } from "./types";

function getWsUrl(): string {
  if (process.env.NEXT_PUBLIC_WS_URL) return process.env.NEXT_PUBLIC_WS_URL;
  if (typeof window !== "undefined") {
    const proto = window.location.protocol === "https:" ? "wss:" : "ws:";
    if (window.location.hostname !== "localhost") {
      return `${proto}//${window.location.host}`;
    }
  }
  return "ws://localhost:3001";
}
const WS_URL = getWsUrl();
const RECONNECT_BASE_MS = 1000;
const RECONNECT_MAX_MS = 30000;

let msgCounter = 0;
function nextId(): string {
  return `msg-${Date.now()}-${++msgCounter}`;
}

export function useWebSocket() {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [isConnected, setIsConnected] = useState(false);
  const [isThinking, setIsThinking] = useState(false);
  const [portfolio, setPortfolio] = useState<PortfolioData | null>(null);

  const wsRef = useRef<WebSocket | null>(null);
  const reconnectDelay = useRef(RECONNECT_BASE_MS);

  const connect = useCallback(() => {
    if (wsRef.current?.readyState === WebSocket.OPEN) return;

    const ws = new WebSocket(WS_URL);
    wsRef.current = ws;

    ws.onopen = () => {
      setIsConnected(true);
      reconnectDelay.current = RECONNECT_BASE_MS;
    };

    ws.onclose = () => {
      setIsConnected(false);
      setIsThinking(false);
      const delay = reconnectDelay.current;
      reconnectDelay.current = Math.min(delay * 2, RECONNECT_MAX_MS);
      setTimeout(connect, delay);
    };

    ws.onerror = () => {
      ws.close();
    };

    ws.onmessage = (event) => {
      let msg: ServerMessage;
      try {
        msg = JSON.parse(event.data);
      } catch {
        return;
      }

      switch (msg.type) {
        case "reply":
          setMessages((prev) => [
            ...prev,
            { id: nextId(), role: "agent", text: msg.text, timestamp: Date.now() },
          ]);
          break;
        case "action_result":
          setMessages((prev) => [
            ...prev,
            { id: nextId(), role: "action", text: msg.text, timestamp: Date.now() },
          ]);
          break;
        case "thinking":
          setIsThinking(msg.active);
          break;
        case "status": {
          const raw = msg as Record<string, unknown>;
          setPortfolio({
            balance: msg.balance,
            solanaBalance: (raw.solanaBalance as number) ?? 0,
            positions: msg.positions,
            trades: msg.trades,
            jupiterPositions: (raw.jupiterPositions as PortfolioData["jupiterPositions"]) ?? [],
            x402: (raw.x402 as PortfolioData["x402"]) ?? { active: false, payments: 0, totalUsd: 0 },
          });
        }
          break;
        case "autonomy_status":
          setIsAutonomyActive(msg.active);
          break;
        case "error":
          setMessages((prev) => [
            ...prev,
            { id: nextId(), role: "action", text: `Error: ${msg.text}`, timestamp: Date.now() },
          ]);
          break;
      }
    };
  }, []);

  useEffect(() => {
    connect();
    return () => {
      wsRef.current?.close();
    };
  }, [connect]);

  const sendMessage = useCallback((text: string) => {
    if (!wsRef.current || wsRef.current.readyState !== WebSocket.OPEN) return;
    setMessages((prev) => [
      ...prev,
      { id: nextId(), role: "user", text, timestamp: Date.now() },
    ]);
    wsRef.current.send(JSON.stringify({ type: "message", text }));
  }, []);

  const requestStatus = useCallback(() => {
    if (!wsRef.current || wsRef.current.readyState !== WebSocket.OPEN) return;
    wsRef.current.send(JSON.stringify({ type: "get_status" }));
  }, []);

  const [isAutonomyActive, setIsAutonomyActive] = useState(false);

  const toggleAutonomy = useCallback(() => {
    if (!wsRef.current || wsRef.current.readyState !== WebSocket.OPEN) return;
    const newState = !isAutonomyActive;
    wsRef.current.send(JSON.stringify({ type: newState ? "start_autonomy" : "stop_autonomy" }));
    setIsAutonomyActive(newState);
  }, [isAutonomyActive]);

  return { messages, sendMessage, isConnected, isThinking, portfolio, requestStatus, isAutonomyActive, toggleAutonomy };
}
