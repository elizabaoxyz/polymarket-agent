"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { ChatMessage, PortfolioData, ServerMessage } from "./types";

const WS_URL = process.env.NEXT_PUBLIC_WS_URL ?? "ws://localhost:3001";
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
        case "status":
          setPortfolio({
            balance: msg.balance,
            positions: msg.positions,
            trades: msg.trades,
          });
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

  return { messages, sendMessage, isConnected, isThinking, portfolio, requestStatus };
}
