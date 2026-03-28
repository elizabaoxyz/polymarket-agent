"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { ChatMessage, PortfolioData, ServerMessage, UserKeys } from "./types";

const WS_URL = process.env.NEXT_PUBLIC_WS_URL ?? "ws://localhost:3001";
const RECONNECT_BASE_MS = 1000;
const RECONNECT_MAX_MS = 30000;

let msgCounter = 0;
function nextId(): string {
  return `msg-${Date.now()}-${++msgCounter}`;
}

export type AuthState = "disconnected" | "authenticating" | "authenticated" | "auth_error";

export function useWebSocket(keys: UserKeys | null) {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [authState, setAuthState] = useState<AuthState>("disconnected");
  const [authError, setAuthError] = useState<string | null>(null);
  const [isThinking, setIsThinking] = useState(false);
  const [portfolio, setPortfolio] = useState<PortfolioData | null>(null);

  const wsRef = useRef<WebSocket | null>(null);
  const reconnectDelay = useRef(RECONNECT_BASE_MS);
  const keysRef = useRef(keys);
  keysRef.current = keys;

  const disconnect = useCallback(() => {
    if (wsRef.current) {
      wsRef.current.close();
      wsRef.current = null;
    }
    setAuthState("disconnected");
    setMessages([]);
    setPortfolio(null);
    setIsThinking(false);
    setAuthError(null);
  }, []);

  const connect = useCallback(() => {
    if (!keysRef.current) return;
    if (wsRef.current?.readyState === WebSocket.OPEN) return;

    const ws = new WebSocket(WS_URL);
    wsRef.current = ws;
    setAuthState("authenticating");
    setAuthError(null);

    ws.onopen = () => {
      ws.send(JSON.stringify({ type: "auth", keys: keysRef.current }));
    };

    ws.onclose = () => {
      setAuthState("disconnected");
      setIsThinking(false);
      if (keysRef.current) {
        const delay = reconnectDelay.current;
        reconnectDelay.current = Math.min(delay * 2, RECONNECT_MAX_MS);
        setTimeout(connect, delay);
      }
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
        case "auth_ok":
          setAuthState("authenticated");
          reconnectDelay.current = RECONNECT_BASE_MS;
          break;
        case "auth_error":
          setAuthState("auth_error");
          setAuthError(msg.text);
          break;
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
          setPortfolio({ balance: msg.balance, positions: msg.positions, trades: msg.trades });
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
    if (keys) {
      connect();
    } else {
      disconnect();
    }
    return () => {
      wsRef.current?.close();
    };
  }, [keys, connect, disconnect]);

  const sendMessage = useCallback((text: string) => {
    if (!wsRef.current || wsRef.current.readyState !== WebSocket.OPEN || authState !== "authenticated") return;
    setMessages((prev) => [
      ...prev,
      { id: nextId(), role: "user", text, timestamp: Date.now() },
    ]);
    wsRef.current.send(JSON.stringify({ type: "message", text }));
  }, [authState]);

  const requestStatus = useCallback(() => {
    if (!wsRef.current || wsRef.current.readyState !== WebSocket.OPEN || authState !== "authenticated") return;
    wsRef.current.send(JSON.stringify({ type: "get_status" }));
  }, [authState]);

  const isConnected = authState === "authenticated";

  return { messages, sendMessage, isConnected, isThinking, portfolio, requestStatus, authState, authError, disconnect };
}
