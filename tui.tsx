/**
 * TUI main app — imports from extracted modules:
 *   tui-utils.ts   — text formatting, mouse handling, types
 *   tui-panels.tsx  — ChatPanel, SidebarPanel, FatalErrorDisplay
 */

import { Box, render, Text, useApp, useInput, useStdout } from "ink";
import TextInput from "ink-text-input";
import type { ReactNode } from "react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

// Global error state
let globalFatalError: string | null = null;
let fatalErrorCallbacks: Array<(error: string) => void> = [];

export function setFatalError(message: string): void {
  globalFatalError = message;
  fatalErrorCallbacks.forEach((cb) => cb(message));
}

function useFatalError(): string | null {
  const [error, setError] = useState<string | null>(globalFatalError);
  useEffect(() => {
    const callback = (msg: string) => setError(msg);
    fatalErrorCallbacks.push(callback);
    if (globalFatalError) setError(globalFatalError);
    return () => {
      fatalErrorCallbacks = fatalErrorCallbacks.filter((cb) => cb !== callback);
    };
  }, []);
  return error;
}

import {
  type AgentRuntime,
  type AutonomyService,
  ChannelType,
  type Content,
  createMessageMemory,
  EventType,
  type IMessageService,
  type Memory,
  type UUID,
} from "@elizaos/core";
import type PolymarketService from "@elizaos/plugin-polymarket";
import type Market from "@elizaos/plugin-polymarket";
import type MarketsResponse from "@elizaos/plugin-polymarket";
import POLYMARKET_SERVICE_NAME from "@elizaos/plugin-polymarket";
import { v4 as uuidv4 } from "uuid";

// Re-export types used externally
export type { SettingsField } from "./tui-settings";

// Import extracted panels
import { ChatPanel, FatalErrorDisplay, SidebarPanel } from "./tui-panels";
import { runSettingsWizard } from "./tui-settings";
// Import extracted utilities
import type {
  ChatMessage,
  FocusPanel,
  InkKey,
  LayoutMode,
  LogArg,
  LoggerLike,
  LoggerMethod,
  SidebarView,
} from "./tui-utils";
import {
  buildSidebarCard,
  consumeMouseScroll,
  formatLogArgs,
  formatTimestamp,
  getSidebarCardInnerWidth,
  hasMouseSequence,
  normalizeSetting,
  sanitizeLine,
  shortenId,
  stripInputArtifacts,
  truncateText,
} from "./tui-utils";

// --- Session types ---

type StreamTagState = {
  opened: boolean;
  done: boolean;
  text: string;
};

type ActionPayload = {
  readonly content?: Content;
};

type TuiSession = {
  readonly runtime: AgentRuntime;
  readonly roomId: UUID;
  readonly worldId: UUID;
  readonly userId: UUID;
  readonly messageService: IMessageService;
  readonly venue?: "polymarket" | "jupiter";
  readonly startupInfo?: string[];
};

// --- Autonomy helpers ---

function extractTagFromBuffer(buffer: { value: string }, tag: string, state: StreamTagState): void {
  if (state.done) return;
  const openTag = `<${tag}>`;
  const closeTag = `</${tag}>`;
  if (!state.opened) {
    const openIdx = buffer.value.indexOf(openTag);
    if (openIdx === -1) return;
    buffer.value = buffer.value.slice(openIdx + openTag.length);
    state.opened = true;
  }
  if (!state.opened) return;
  const closeIdx = buffer.value.indexOf(closeTag);
  if (closeIdx !== -1) {
    state.text += buffer.value.slice(0, closeIdx);
    buffer.value = buffer.value.slice(closeIdx + closeTag.length);
    state.done = true;
    return;
  }
  if (buffer.value.length > closeTag.length) {
    state.text += buffer.value.slice(0, buffer.value.length - closeTag.length);
    buffer.value = buffer.value.slice(buffer.value.length - closeTag.length);
  }
}

function isAutonomyResponse(memory: Memory): memory is Memory & { createdAt: number } {
  if (typeof memory.createdAt !== "number") return false;
  if (typeof memory.content?.text !== "string") return false;
  const metadata = memory.content?.metadata;
  if (!metadata || typeof metadata !== "object") return false;
  const typed = metadata as { isAutonomous?: boolean; type?: string };
  return typed.isAutonomous === true && typed.type === "autonomous-response";
}

async function pollAutonomyLogs(
  runtime: AgentRuntime,
  lastSeen: { value: number },
  onLog: (text: string) => void,
): Promise<void> {
  const svc = runtime.getService<AutonomyService>("AUTONOMY");
  if (!svc) return;
  const roomId = svc.getAutonomousRoomId();
  const memories = await runtime.getMemories({ roomId, count: 20, tableName: "memories" });
  type AutonomyMemory = Memory & { createdAt: number };
  const fresh = memories
    .filter(isAutonomyResponse)
    .filter((memory: AutonomyMemory) => memory.createdAt > lastSeen.value)
    .sort((a: AutonomyMemory, b: AutonomyMemory) => a.createdAt - b.createdAt);
  for (const memory of fresh) {
    onLog(memory.content?.text ?? "");
  }
  if (fresh.length > 0) {
    const last = fresh[fresh.length - 1];
    if (last) lastSeen.value = last.createdAt;
  }
}

async function setAutonomy(runtime: AgentRuntime, enabled: boolean): Promise<string> {
  const svc = runtime.getService<AutonomyService>("AUTONOMY");
  if (!svc) return "Autonomy service not available. The agent may still be initializing.";
  try {
    if (enabled) {
      await svc.enableAutonomy();
      const status = svc.getStatus?.() ?? { running: false, interval: 0 };
      const intervalSec = Math.round((status.interval ?? 5000) / 1000);
      return `Autonomy enabled. Loop running: ${status.running ? "yes" : "starting..."}, interval: ${intervalSec}s`;
    }
    await svc.disableAutonomy();
    return "Autonomy disabled. Agent will only respond to direct messages.";
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return `Failed to ${enabled ? "enable" : "disable"} autonomy: ${msg}`;
  }
}

function getAutonomyStatus(
  runtime: AgentRuntime,
): { enabled: boolean; running: boolean; interval: number } | null {
  const svc = runtime.getService<AutonomyService>("AUTONOMY");
  if (!svc || typeof svc.getStatus !== "function") return null;
  const status = svc.getStatus();
  return {
    enabled: status.enabled ?? false,
    running: status.running ?? false,
    interval: status.interval ?? 5000,
  };
}

// --- Main TUI App ---

function PolymarketTuiApp(props: TuiSession): ReactNode {
  const { runtime, roomId, userId, messageService } = props;
  const venue = props.venue ?? "polymarket";
  const { exit } = useApp();
  const { stdout } = useStdout();
  const fatalError = useFatalError();

  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState("");
  const [isProcessing, setIsProcessing] = useState(false);
  const [layout, setLayout] = useState<LayoutMode>("chat");
  const [sidebarView, setSidebarView] = useState<SidebarView>("positions");
  const [focusPanel, setFocusPanel] = useState<FocusPanel>("chat");
  const [scrollOffset, setScrollOffset] = useState(0);
  const [sidebarScrollOffset, setSidebarScrollOffset] = useState(0);
  const [chatMaxScroll, setChatMaxScroll] = useState(0);
  const [sidebarMaxScroll, setSidebarMaxScroll] = useState(0);
  const [sidebarContent, setSidebarContent] = useState("Loading...");
  const [sidebarLoading, setSidebarLoading] = useState(true);
  const [sidebarUpdatedAt, setSidebarUpdatedAt] = useState<string>("");
  const [logs, setLogs] = useState<string[]>([]);
  const [balanceText, setBalanceText] = useState("USDC: --");
  const [autonomyEnabled, setAutonomyEnabled] = useState(false);

  const marketNameCacheRef = useRef<Map<string, string>>(new Map());
  const lastAutonomyRef = useRef<{ value: number }>({ value: 0 });
  const actionMessageIdsRef = useRef<Map<string, string>>(new Map());
  const greetedRef = useRef(false);

  // Terminal size
  const [terminalSize, setTerminalSize] = useState(() => ({
    columns: stdout?.columns ?? 100,
    rows: stdout?.rows ?? 28,
  }));
  const columns = terminalSize.columns;
  const rows = terminalSize.rows;
  const headerHeight = rows >= 2 ? 1 : 0;
  const bottomReserve = rows >= 3 ? 1 : 0;
  const bodyHeight = Math.max(0, rows - headerHeight - bottomReserve);
  const isWide = columns >= 110;

  const showChat = layout === "chat" || layout === "split";
  const showSidebar = layout === "sidebar" || layout === "split";
  const targetSidebarWidth = Math.min(42, Math.max(28, Math.floor(columns * 0.35)));
  const sidebarWidth = showSidebar ? (showChat && isWide ? targetSidebarWidth : columns) : 0;
  const gap = showChat && showSidebar && isWide ? 1 : 0;
  const chatWidth = showChat ? Math.max(20, columns - sidebarWidth - gap) : 0;
  const showChatPanel = isWide ? showChat : layout !== "sidebar";
  const showSidebarPanel = isWide ? showSidebar : layout === "sidebar";

  // --- Callbacks ---

  const appendLog = useCallback((line: string) => {
    setLogs((prev) => {
      const next = [...prev, line];
      return next.length > 200 ? next.slice(next.length - 200) : next;
    });
  }, []);

  const appendMessage = useCallback((msg: ChatMessage) => {
    setMessages((prev) => [...prev, msg]);
    setScrollOffset(0);
  }, []);

  const handleInputChange = useCallback((value: string) => {
    if (hasMouseSequence(value)) {
      setInput((prev) => stripInputArtifacts(prev));
      return;
    }
    setInput(stripInputArtifacts(value).replace(/\s*\n\s*/g, " "));
  }, []);

  const updateMessage = useCallback((id: string, content: string) => {
    setMessages((prev) => prev.map((msg) => (msg.id === id ? { ...msg, content } : msg)));
  }, []);

  const cycleSidebarView = useCallback(() => {
    setSidebarView((prev) => {
      const order: SidebarView[] = ["positions", "markets", "logs"];
      return order[(order.indexOf(prev) + 1) % order.length] ?? "positions";
    });
    setSidebarScrollOffset(0);
  }, []);

  // --- Effects ---

  // Balance fetch
  useEffect(() => {
    let cancelled = false;
    const fetchBalance = async () => {
      let service = runtime.getService<PolymarketService>(POLYMARKET_SERVICE_NAME);
      if (!service && typeof runtime.getServiceLoadPromise === "function") {
        try {
          service = (await runtime.getServiceLoadPromise(
            POLYMARKET_SERVICE_NAME,
          )) as PolymarketService;
        } catch {}
      }
      if (!service) {
        for (let i = 0; i < 10 && !cancelled; i++) {
          await new Promise((r) => setTimeout(r, 500));
          service = runtime.getService<PolymarketService>(POLYMARKET_SERVICE_NAME);
          if (service) break;
        }
      }
      if (service && !cancelled) {
        try {
          const state = await service.refreshAccountState();
          const balance = state?.balances?.collateral?.balance;
          if (balance !== undefined && !cancelled) setBalanceText(`USDC: $${balance}`);
        } catch {}
      }
    };
    fetchBalance();
    return () => {
      cancelled = true;
    };
  }, [runtime]);

  // Focus alignment
  useEffect(() => {
    if (layout === "chat") {
      setFocusPanel("chat");
      return;
    }
    if (layout === "sidebar") setFocusPanel("sidebar");
  }, [layout]);

  useEffect(() => {
    if (isWide) return;
    if (layout === "split") setLayout(focusPanel === "sidebar" ? "sidebar" : "chat");
  }, [focusPanel, isWide, layout]);

  // Greeting
  useEffect(() => {
    if (greetedRef.current || messages.length > 0) return;
    greetedRef.current = true;
    const greetings: Record<string, string> = {
      polymarket:
        "Hello! I'm Eliza v2 — I trade on Polymarket (Polygon) and Jupiter Prediction Markets (Solana), with x402 auto-payments enabled. Ask me to scan markets, check positions, or place orders. Type /help for commands.",
      jupiter:
        "Hello! I'm the Jupiter Prediction trading agent on Solana. I can scan prediction markets, place bets, check positions, and claim winnings. Type /help for commands.",
    };
    appendMessage({
      id: uuidv4(),
      role: "assistant",
      content: greetings[venue] ?? greetings.polymarket ?? "",
      timestamp: Date.now(),
    });
    if (props.startupInfo?.length) {
      appendMessage({
        id: uuidv4(),
        role: "system",
        content: props.startupInfo.join("\n"),
        timestamp: Date.now(),
      });
    }
  }, [appendMessage, messages.length, venue, props.startupInfo]);

  // Terminal resize
  useEffect(() => {
    if (!stdout) return;
    const update = () =>
      setTerminalSize({ columns: stdout.columns ?? 100, rows: stdout.rows ?? 28 });
    stdout.on("resize", update);
    return () => {
      stdout.off("resize", update);
    };
  }, [stdout]);

  // Mouse tracking
  useEffect(() => {
    if (!stdout) return;
    stdout.write("\x1b[?1000h\x1b[?1006h\x1b[?1015h\x1b[?1007l");
    return () => {
      stdout.write("\x1b[?1000l\x1b[?1006l\x1b[?1015l\x1b[?1007l");
    };
  }, [stdout]);

  // Mouse scroll
  useEffect(() => {
    const stdin = process.stdin;
    if (!stdin || typeof stdin.on !== "function") return;
    let buffer = "";
    const onData = (data: Buffer) => {
      buffer += data.toString("utf8");
      const scroll = consumeMouseScroll(buffer);
      buffer = scroll.remaining;
      if (scroll.delta === 0) return;
      setInput((prev) => stripInputArtifacts(prev));
      if (focusPanel === "chat") {
        setScrollOffset((prev) => Math.max(0, Math.min(chatMaxScroll, prev + scroll.delta)));
      } else {
        setSidebarScrollOffset((prev) =>
          Math.max(0, Math.min(sidebarMaxScroll, prev + scroll.delta)),
        );
      }
    };
    stdin.on("data", onData);
    return () => {
      stdin.off("data", onData);
    };
  }, [chatMaxScroll, focusPanel, sidebarMaxScroll]);

  // Sidebar scroll reset
  useEffect(() => {
    setSidebarScrollOffset(0);
  }, [sidebarView]);

  // Sidebar data fetch
  useEffect(() => {
    if (sidebarView === "logs") {
      setSidebarLoading(false);
      return;
    }
    let isActive = true;
    const update = async () => {
      setSidebarLoading(true);
      setSidebarContent("Starting up...");
      let service = runtime.getService<PolymarketService>(POLYMARKET_SERVICE_NAME);
      if (!service && typeof runtime.getServiceLoadPromise === "function") {
        try {
          service = (await runtime.getServiceLoadPromise(
            POLYMARKET_SERVICE_NAME,
          )) as PolymarketService;
        } catch {}
      }
      if (!service) {
        for (let attempt = 0; attempt < 5 && isActive; attempt++) {
          await new Promise((resolve) => setTimeout(resolve, 1000));
          service = runtime.getService<PolymarketService>(POLYMARKET_SERVICE_NAME);
          if (service) break;
          if (isActive) setSidebarContent(`Starting up... (attempt ${attempt + 2}/6)`);
        }
      }
      if (!service) {
        if (isActive) {
          setSidebarLoading(false);
          setSidebarContent("Polymarket service failed to start.");
          setSidebarUpdatedAt(formatTimestamp(new Date()));
        }
        return;
      }
      try {
        if (sidebarView === "positions") {
          const state = await service.refreshAccountState();
          const positions = state?.positions ?? [];
          const lines: string[] = [];
          const funderSetting =
            runtime.getSetting("POLYMARKET_FUNDER_ADDRESS") ||
            runtime.getSetting("POLYMARKET_FUNDER") ||
            runtime.getSetting("CLOB_FUNDER_ADDRESS");
          const funderAddress = normalizeSetting(funderSetting);
          const walletAddress = state?.walletAddress ?? "unknown";
          lines.push(
            `Account: ${funderAddress ? `Proxy ${shortenId(funderAddress)}` : `EOA ${shortenId(walletAddress)}`}`,
          );
          const balance = state?.balances?.collateral?.balance;
          if (balance !== undefined) {
            setBalanceText(`USDC: $${balance}`);
            lines.push(`USDC: $${balance}`);
          } else lines.push("USDC: Unable to fetch");
          lines.push("");
          if (positions.length === 0) {
            lines.push("No positions found.");
          } else {
            lines.push(`Positions (${positions.length}):`);
            const entries = await Promise.all(
              positions
                .slice(0, 10)
                .map(
                  async (
                    pos: { size: string; average_price: string; market?: string },
                    idx: number,
                  ) => {
                    const size = Number.parseFloat(pos.size);
                    const avg = Number.parseFloat(pos.average_price);
                    const odds = Number.isFinite(avg) ? avg.toFixed(4) : "N/A";
                    const side = size >= 0 ? "LONG" : "SHORT";
                    let marketName = pos.market || "Unknown market";
                    const marketId = pos.market ?? "";
                    if (marketId.startsWith("0x")) {
                      const cached = marketNameCacheRef.current.get(marketId);
                      if (cached) marketName = cached;
                      else {
                        try {
                          const m = (await service.getClobClient().getMarket(marketId)) as Market;
                          if (m?.question) {
                            marketName = m.question;
                            marketNameCacheRef.current.set(marketId, m.question);
                          }
                        } catch {}
                      }
                    }
                    return `${idx + 1}. ${marketName}\n   ${side} ${Math.abs(size).toFixed(4)} @ ${odds}`;
                  },
                ),
            );
            lines.push(...entries);
          }
          if (isActive) {
            setSidebarLoading(false);
            setSidebarContent(lines.join("\n"));
            setSidebarUpdatedAt(formatTimestamp(new Date()));
          }
        } else if (sidebarView === "markets") {
          interface MarketItem {
            id: string;
            title: string;
            volume: number;
            endDate: string | null;
            source: "gamma" | "clob";
          }
          const gammaPromise = fetch(
            "https://gamma-api.polymarket.com/events?closed=false&active=true&limit=20&order=volume&ascending=false",
          )
            .then(async (res) => {
              if (!res.ok) return [] as MarketItem[];
              interface GammaEvent {
                id?: string;
                slug?: string;
                title?: string;
                question?: string;
                endDate?: string;
                volume?: number;
                closed?: boolean;
                active?: boolean;
              }
              return ((await res.json()) as GammaEvent[])
                .filter((e) => e.active !== false && e.closed !== true)
                .map(
                  (e): MarketItem => ({
                    id: e.id || e.slug || "",
                    title: e.title || e.question || e.slug || "Unknown",
                    volume: e.volume ?? 0,
                    endDate: e.endDate || null,
                    source: "gamma",
                  }),
                );
            })
            .catch(() => [] as MarketItem[]);
          const clobPromise = (async () => {
            const client = service.getClobClient();
            const response = (await client.getMarkets(undefined)) as MarketsResponse;
            const now = Date.now();
            interface ClobMarket {
              condition_id: string;
              question?: string;
              active?: boolean;
              closed?: boolean;
              end_date_iso?: string;
            }
            return (response?.data ?? [])
              .filter(
                (m: ClobMarket) =>
                  m.active &&
                  !m.closed &&
                  (!m.end_date_iso || new Date(m.end_date_iso).getTime() >= now),
              )
              .map(
                (m: ClobMarket): MarketItem => ({
                  id: m.condition_id,
                  title: m.question || m.condition_id,
                  volume: 0,
                  endDate: m.end_date_iso || null,
                  source: "clob",
                }),
              );
          })().catch(() => [] as MarketItem[]);
          const [gammaMarkets, clobMarkets] = await Promise.all([gammaPromise, clobPromise]);
          const seen = new Set<string>();
          const combined: MarketItem[] = [];
          for (const m of gammaMarkets) {
            const key = m.title.toLowerCase().slice(0, 50);
            if (!seen.has(key)) {
              seen.add(key);
              combined.push(m);
            }
          }
          for (const m of clobMarkets) {
            const key = m.title.toLowerCase().slice(0, 50);
            if (!seen.has(key)) {
              seen.add(key);
              combined.push(m);
            }
          }
          combined.sort(
            (a, b) =>
              b.volume - a.volume ||
              (a.endDate && b.endDate
                ? new Date(a.endDate).getTime() - new Date(b.endDate).getTime()
                : 0),
          );
          const trimmed = combined.slice(0, 12);
          const panelWidth = isWide ? sidebarWidth : chatWidth;
          const cardInnerWidth = getSidebarCardInnerWidth(panelWidth);
          const content =
            trimmed.length === 0
              ? "No active markets found."
              : trimmed
                  .map((m) => {
                    const lines: string[] = [];
                    if (m.volume > 0)
                      lines.push(`Volume: $${Math.round(m.volume).toLocaleString()}`);
                    if (m.endDate) lines.push(`Ends: ${new Date(m.endDate).toLocaleDateString()}`);
                    lines.push(
                      m.source === "gamma"
                        ? `https://polymarket.com/event/${m.id}`
                        : `https://polymarket.com/market/${m.id}`,
                    );
                    return buildSidebarCard(m.title, lines, cardInnerWidth);
                  })
                  .join("\n\n");
          if (isActive) {
            setSidebarLoading(false);
            setSidebarContent(content);
            setSidebarUpdatedAt(formatTimestamp(new Date()));
          }
        }
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        if (isActive) {
          setSidebarLoading(false);
          setSidebarContent(`Error: ${message}`);
          setSidebarUpdatedAt(formatTimestamp(new Date()));
        }
      }
    };
    update().catch(() => undefined);
    return () => {
      isActive = false;
    };
  }, [runtime, sidebarView, chatWidth, isWide, sidebarWidth]);

  // Autonomy log polling
  useEffect(() => {
    const timer = setInterval(() => {
      pollAutonomyLogs(runtime, lastAutonomyRef.current, (text) => {
        const trimmed = text.trim();
        if (!trimmed) return;
        const lines = trimmed.split("\n").map((line) => `[Autonomy] ${line}`);
        const now = Date.now();
        lines.forEach((line) => {
          appendMessage({ id: uuidv4(), role: "system", content: line, timestamp: now });
          appendLog(line);
        });
      }).catch(() => undefined);
    }, 1500);
    return () => clearInterval(timer);
  }, [appendLog, appendMessage, runtime]);

  // Logger wrapping
  useEffect(() => {
    const logger = runtime.logger as LoggerLike;
    const MAX_LOG_LENGTH = 400;
    const wrap =
      (level: "info" | "warn" | "error" | "debug", original?: LoggerMethod) =>
      (...args: LogArg[]) => {
        if (original) original(...args);
        const text = formatLogArgs(args);
        if (!text) return;
        const clipped = text.length > MAX_LOG_LENGTH ? `${text.slice(0, MAX_LOG_LENGTH)}…` : text;
        appendLog(`${level.toUpperCase()}: ${clipped}`);
      };
    const originalInfo = logger.info;
    const originalWarn = logger.warn;
    const originalError = logger.error;
    const originalDebug = logger.debug;
    if (logger.info) logger.info = wrap("info", originalInfo);
    if (logger.warn) logger.warn = wrap("warn", originalWarn);
    if (logger.error) logger.error = wrap("error", originalError);
    if (logger.debug) logger.debug = wrap("debug", originalDebug);
    return () => {
      if (originalInfo) logger.info = originalInfo;
      if (originalWarn) logger.warn = originalWarn;
      if (originalError) logger.error = originalError;
      if (originalDebug) logger.debug = originalDebug;
    };
  }, [appendLog, runtime]);

  // Action events
  useEffect(() => {
    const onActionStarted = (payload: unknown) => {
      const typed = payload as ActionPayload;
      const content = typed.content;
      if (!content) return;
      const actionName = content.actions?.[0] ?? "action";
      const actionId =
        typeof content.actionId === "string" ? content.actionId : `${actionName}:${Date.now()}`;
      const messageId = uuidv4();
      actionMessageIdsRef.current.set(actionId, messageId);
      appendMessage({
        id: messageId,
        role: "system",
        content: `calling ${actionName}...`,
        timestamp: Date.now(),
      });
      appendLog(`calling ${actionName}...`);
    };
    const onActionCompleted = (payload: unknown) => {
      const typed = payload as ActionPayload;
      const content = typed.content;
      if (!content) return;
      const actionName = content.actions?.[0] ?? "action";
      const actionId =
        typeof content.actionId === "string" ? content.actionId : `${actionName}:done`;
      const status = typeof content.actionStatus === "string" ? content.actionStatus : "completed";
      const messageId = actionMessageIdsRef.current.get(actionId);
      if (messageId) {
        updateMessage(messageId, `action ${actionName} ${status}`);
        actionMessageIdsRef.current.delete(actionId);
      } else {
        appendMessage({
          id: uuidv4(),
          role: "system",
          content: `action ${actionName} ${status}`,
          timestamp: Date.now(),
        });
      }
      appendLog(`action ${actionName} ${status}`);
    };
    runtime.on(EventType.ACTION_STARTED, onActionStarted as never);
    runtime.on(EventType.ACTION_COMPLETED, onActionCompleted as never);
    return () => {
      runtime.off(EventType.ACTION_STARTED, onActionStarted as never);
      runtime.off(EventType.ACTION_COMPLETED, onActionCompleted as never);
    };
  }, [appendLog, appendMessage, updateMessage, runtime]);

  // Autonomy status polling
  useEffect(() => {
    const check = () => {
      const status = getAutonomyStatus(runtime);
      if (status) setAutonomyEnabled(status.running);
    };
    check();
    const timer = setInterval(check, 2000);
    return () => clearInterval(timer);
  }, [runtime]);

  // --- Submit handler ---

  const handleSubmit = useCallback(
    async (value: string) => {
      const trimmed = stripInputArtifacts(value).trim();
      if (!trimmed) return;
      setInput("");
      setIsProcessing(true);
      try {
        if (trimmed === "/exit" || trimmed === "/quit") {
          exit();
          return;
        }
        if (trimmed === "/help") {
          appendMessage({
            id: uuidv4(),
            role: "system",
            content: [
              "Commands:",
              "  /autonomy [true|false] - Show status or toggle autonomous mode",
              "  /think - Trigger autonomous thinking immediately",
              "  /interval <seconds> - Set autonomy loop interval (5-600s)",
              "  /account - Show wallet and positions",
              "  /markets - Show active markets",
              "  /logs - Show agent logs",
              "  /error - Show recent errors",
              "  /clear - Clear chat history",
              "  /help - Show this help",
              "  /exit - Exit the application",
            ].join("\n"),
            timestamp: Date.now(),
          });
          return;
        }
        if (trimmed === "/error") {
          const errorLogs = logs
            .filter(
              (log) => log.includes("ERROR") || log.includes("Error") || log.includes("error"),
            )
            .slice(-10);
          appendMessage({
            id: uuidv4(),
            role: "system",
            content:
              errorLogs.length === 0
                ? "No recent errors found. Check polymarket-error.log for crash logs."
                : `Recent errors (${errorLogs.length}):\n${errorLogs.join("\n")}`,
            timestamp: Date.now(),
          });
          return;
        }
        if (trimmed === "/clear") {
          setMessages([]);
          return;
        }
        if (trimmed === "/account") {
          setSidebarView("positions");
          setLayout("split");
          return;
        }
        if (trimmed === "/markets") {
          setSidebarView("markets");
          setLayout("split");
          return;
        }
        if (trimmed === "/logs") {
          setSidebarView("logs");
          setLayout("split");
          return;
        }
        if (trimmed.startsWith("/autonomy")) {
          const parts = trimmed.split(/\s+/);
          const valueArg = parts[1];
          if (!valueArg) {
            const currentStatus = getAutonomyStatus(runtime);
            if (!currentStatus)
              appendMessage({
                id: uuidv4(),
                role: "system",
                content: "Autonomy service not available.",
                timestamp: Date.now(),
              });
            else
              appendMessage({
                id: uuidv4(),
                role: "system",
                content: `Autonomy status: ${currentStatus.enabled ? "enabled" : "disabled"}, running: ${currentStatus.running ? "yes" : "no"}, interval: ${Math.round(currentStatus.interval / 1000)}s`,
                timestamp: Date.now(),
              });
            return;
          }
          if (valueArg !== "true" && valueArg !== "false") {
            appendMessage({
              id: uuidv4(),
              role: "system",
              content: "Usage: /autonomy [true|false]",
              timestamp: Date.now(),
            });
            return;
          }
          const status = await setAutonomy(runtime, valueArg === "true");
          setAutonomyEnabled(valueArg === "true");
          appendMessage({ id: uuidv4(), role: "system", content: status, timestamp: Date.now() });
          appendLog(`[Autonomy] ${status}`);
          return;
        }
        if (trimmed === "/think") {
          const svc = runtime.getService<AutonomyService>("AUTONOMY");
          if (!svc) {
            appendMessage({
              id: uuidv4(),
              role: "system",
              content: "Autonomy service not available.",
              timestamp: Date.now(),
            });
            return;
          }
          if (svc.getStatus?.()?.thinking) {
            appendMessage({
              id: uuidv4(),
              role: "system",
              content: "Already thinking... please wait.",
              timestamp: Date.now(),
            });
            return;
          }
          if (typeof svc.triggerThinkNow === "function") {
            appendMessage({
              id: uuidv4(),
              role: "system",
              content: "Triggering autonomous thinking...",
              timestamp: Date.now(),
            });
            appendLog("[Autonomy] Manual think triggered");
            try {
              const success = await svc.triggerThinkNow();
              if (success === false)
                appendMessage({
                  id: uuidv4(),
                  role: "system",
                  content: "Think cycle skipped (already in progress or error occurred).",
                  timestamp: Date.now(),
                });
            } catch (err) {
              const msg = err instanceof Error ? err.message : String(err);
              appendMessage({
                id: uuidv4(),
                role: "system",
                content: `Think error: ${msg}`,
                timestamp: Date.now(),
              });
              appendLog(`[Autonomy] Think error: ${msg}`);
            }
            return;
          }
          const autonomousRoomId = svc.getAutonomousRoomId?.();
          if (!autonomousRoomId) {
            appendMessage({
              id: uuidv4(),
              role: "system",
              content: "Could not get autonomous room ID.",
              timestamp: Date.now(),
            });
            return;
          }
          const thinkMsgId = uuidv4();
          appendMessage({
            id: thinkMsgId,
            role: "system",
            content: "Triggering autonomous thinking...",
            timestamp: Date.now(),
          });
          appendLog("[Autonomy] Manual think triggered (fallback mode)");
          try {
            const autonomousPrompt = `AUTONOMOUS TASK MODE - You have been manually triggered to think and act.\n\nReview your current context:\n- Check available Polymarket markets\n- Review any pending tasks or goals\n- Consider what actions would be most valuable right now\n\nDecide on your next action and execute it.`;
            const autonomousMessage = createMessageMemory({
              id: uuidv4() as UUID,
              entityId: userId,
              roomId,
              content: {
                text: autonomousPrompt,
                source: "manual-trigger",
                channelType: ChannelType.DM,
                metadata: { type: "autonomous-prompt", isAutonomous: true, isManualTrigger: true },
              },
            });
            const result = await messageService.handleMessage(
              runtime,
              autonomousMessage,
              async (content: Content) => {
                if (typeof content.text === "string" && content.text.trim()) {
                  appendMessage({
                    id: uuidv4(),
                    role: "assistant",
                    content: `[Autonomous] ${content.text}`,
                    timestamp: Date.now(),
                  });
                  appendLog(`[Autonomy] Response: ${content.text.slice(0, 100)}...`);
                }
                return [];
              },
            );
            updateMessage(
              thinkMsgId,
              `Autonomous thinking complete. Responded: ${result.didRespond ? "yes" : "no"}`,
            );
          } catch (err) {
            const msg = err instanceof Error ? err.message : String(err);
            updateMessage(thinkMsgId, `Think error: ${msg}`);
            appendLog(`[Autonomy] Think error: ${msg}`);
          }
          return;
        }
        if (trimmed.startsWith("/interval")) {
          const parts = trimmed.split(/\s+/);
          const valueArg = parts[1];
          if (!valueArg) {
            const currentStatus = getAutonomyStatus(runtime);
            appendMessage({
              id: uuidv4(),
              role: "system",
              content: `Current autonomy interval: ${currentStatus ? Math.round(currentStatus.interval / 1000) : "unknown"}s. Usage: /interval <seconds> (5-600)`,
              timestamp: Date.now(),
            });
            return;
          }
          const seconds = Number.parseInt(valueArg, 10);
          if (Number.isNaN(seconds) || seconds < 5 || seconds > 600) {
            appendMessage({
              id: uuidv4(),
              role: "system",
              content: "Invalid interval. Must be between 5 and 600 seconds.",
              timestamp: Date.now(),
            });
            return;
          }
          const svc = runtime.getService<AutonomyService>("AUTONOMY");
          if (!svc || typeof svc.setLoopInterval !== "function") {
            appendMessage({
              id: uuidv4(),
              role: "system",
              content: "Autonomy service not available or setLoopInterval not supported.",
              timestamp: Date.now(),
            });
            return;
          }
          svc.setLoopInterval(seconds * 1000);
          appendMessage({
            id: uuidv4(),
            role: "system",
            content: `Autonomy interval set to ${seconds} seconds.`,
            timestamp: Date.now(),
          });
          appendLog(`[Autonomy] Interval set to ${seconds}s`);
          return;
        }

        // Regular message
        appendMessage({ id: uuidv4(), role: "user", content: trimmed, timestamp: Date.now() });
        appendLog(`User: ${trimmed}`);
        const assistantId = uuidv4();
        appendMessage({
          id: assistantId,
          role: "assistant",
          content: "(processing...)",
          timestamp: Date.now(),
        });
        appendLog("🔄 Processing...");

        const message = createMessageMemory({
          id: uuidv4() as UUID,
          entityId: userId,
          roomId,
          content: { text: trimmed, source: "polymarket-demo", channelType: ChannelType.DM },
        });
        let callbackText = "";
        const actionResultIds: string[] = [];

        await messageService.handleMessage(
          runtime,
          message,
          async (content: Content) => {
            if (typeof content.text === "string" && content.text.trim()) {
              const text = content.text.trim();
              const isActionResult =
                text.startsWith("⏳") ||
                text.startsWith("🔍") ||
                text.startsWith("📊") ||
                text.startsWith("❌") ||
                text.startsWith("✅") ||
                text.includes("**");
              if (isActionResult) {
                const resultId = uuidv4();
                actionResultIds.push(resultId);
                appendMessage({
                  id: resultId,
                  role: "assistant",
                  content: text,
                  timestamp: Date.now(),
                });
                appendLog(`Action Result: ${text.slice(0, 100)}...`);
              } else {
                callbackText = text;
              }
            }
            return [];
          },
          {} as never,
        );

        const finalText = callbackText.trim();
        if (!finalText) {
          updateMessage(assistantId, "(no response)");
          appendLog("Eliza: (no response)");
        } else {
          updateMessage(assistantId, finalText);
          appendLog(`Eliza: ${finalText}`);
        }
      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : String(error);
        appendMessage({
          id: uuidv4(),
          role: "system",
          content: `❌ Error: ${errorMessage}`,
          timestamp: Date.now(),
        });
        appendLog(`ERROR: ${errorMessage}`);
        if (error instanceof Error && error.stack) appendLog(`Stack: ${error.stack}`);
        if (
          errorMessage.includes("FATAL") ||
          errorMessage.includes("Cannot read") ||
          errorMessage.includes("undefined is not") ||
          errorMessage.includes("null is not")
        )
          throw error;
      } finally {
        setIsProcessing(false);
      }
    },
    [appendLog, appendMessage, exit, messageService, roomId, runtime, updateMessage, userId, logs],
  );

  // --- Keyboard input ---

  useInput((inputVal, rawKey) => {
    const key = rawKey as InkKey;
    if (key.ctrl && key.name === "c") {
      if (messages.length > 0) {
        setInput("");
        setScrollOffset(0);
        setMessages([]);
        return;
      }
      void runtime.stop().finally(() => process.exit(0));
      exit();
      return;
    }
    if (key.escape) {
      setInput("");
      return;
    }
    if (hasMouseSequence(inputVal)) return;
    if ((key.shift && key.tab) || inputVal === "\x1b[Z") {
      if (layout === "split" || layout === "chat") {
        setLayout("chat");
        setFocusPanel("chat");
      } else {
        setLayout(isWide ? "split" : "chat");
        setFocusPanel("chat");
      }
      return;
    }
    if (key.tab && !key.ctrl && !key.meta) {
      if (layout === "split") setFocusPanel((prev) => (prev === "chat" ? "sidebar" : "chat"));
      else if (layout === "chat") {
        setLayout(isWide ? "split" : "sidebar");
        setFocusPanel("sidebar");
      } else {
        setLayout(isWide ? "split" : "chat");
        setFocusPanel("chat");
      }
      return;
    }
    if (key.return && focusPanel === "sidebar") {
      cycleSidebarView();
      return;
    }
    if (focusPanel === "chat") {
      if (key.pageUp) {
        setScrollOffset((prev) => Math.min(chatMaxScroll, prev + 10));
        return;
      }
      if (key.pageDown) {
        setScrollOffset((prev) => Math.max(0, prev - 10));
        return;
      }
      if (key.upArrow || key.downArrow) {
        setScrollOffset((prev) =>
          Math.max(0, Math.min(chatMaxScroll, prev + (key.upArrow ? 1 : -1))),
        );
        return;
      }
    }
    if (focusPanel === "sidebar") {
      if (key.pageUp) {
        setSidebarScrollOffset((prev) => Math.min(sidebarMaxScroll, prev + 10));
        return;
      }
      if (key.pageDown) {
        setSidebarScrollOffset((prev) => Math.max(0, prev - 10));
        return;
      }
      if (key.upArrow || key.downArrow) {
        setSidebarScrollOffset((prev) =>
          Math.max(0, Math.min(sidebarMaxScroll, prev + (key.upArrow ? 1 : -1))),
        );
        return;
      }
    }
  });

  // --- Status and render ---

  const statusText = useMemo(() => {
    const autonomyIndicator = autonomyEnabled ? "🤖 Auto" : "💤 Manual";
    const processingIndicator = isProcessing ? "..." : "Idle";
    const venueName = venue === "jupiter" ? "Jupiter Prediction" : "Eliza Polymarket";
    return `${venueName} | ${balanceText} | ${autonomyIndicator} | ${processingIndicator} | Tab: Focus | /autonomy true|false`;
  }, [balanceText, isProcessing, autonomyEnabled, venue]);
  const headerText = truncateText(statusText, Math.max(0, columns - 2));

  if (fatalError) return <FatalErrorDisplay error={fatalError} columns={columns} rows={rows} />;

  return (
    <Box flexDirection="column" width={columns} height={rows}>
      {headerHeight > 0 ? (
        <Box paddingX={1} height={headerHeight} flexShrink={0}>
          <Text color="#FFA500">{headerText}</Text>
        </Box>
      ) : null}
      <Box flexDirection="row" gap={gap} height={bodyHeight} overflow="hidden">
        <Box display={showChatPanel ? "flex" : "none"} width={chatWidth} height={bodyHeight}>
          <ChatPanel
            messages={messages}
            input={input}
            onInputChange={handleInputChange}
            onSubmit={handleSubmit}
            width={chatWidth}
            height={bodyHeight}
            scrollOffset={scrollOffset}
            onMaxScrollChange={setChatMaxScroll}
            isActive={focusPanel === "chat"}
          />
        </Box>
        <Box
          display={showSidebarPanel ? "flex" : "none"}
          width={isWide ? sidebarWidth : chatWidth}
          height={bodyHeight}
        >
          <SidebarPanel
            view={sidebarView}
            content={sidebarContent}
            loading={sidebarLoading}
            updatedAt={sidebarUpdatedAt}
            width={isWide ? sidebarWidth : chatWidth}
            height={bodyHeight}
            logs={logs}
            scrollOffset={sidebarScrollOffset}
            onMaxScrollChange={setSidebarMaxScroll}
            isActive={focusPanel === "sidebar"}
          />
        </Box>
      </Box>
    </Box>
  );
}

// --- Entry points ---

export async function runPolymarketTui(session: TuiSession): Promise<void> {
  let instance: ReturnType<typeof render> | null = null;
  try {
    instance = render(<PolymarketTuiApp {...session} />);
    await instance.waitUntilExit();
  } catch (error) {
    if (instance) {
      try {
        instance.unmount();
      } catch {}
    }
    throw error;
  } finally {
    if (process.stdout?.write) process.stdout.write("\x1b[?1000l\x1b[?1006l\x1b[?1015l\x1b[?1007l");
  }
}

export const runTradingTui = runPolymarketTui;
