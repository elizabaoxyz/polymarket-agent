/**
 * TUI utility functions — text formatting, wrapping, mouse handling.
 * Extracted from tui.tsx for maintainability.
 */

import { Box, Text } from "ink";
import type { ReactNode } from "react";

// --- Types ---

export type ChatRole = "user" | "assistant" | "system";

export type ChatMessage = {
  readonly id: string;
  readonly role: ChatRole;
  readonly content: string;
  readonly timestamp: number;
};

export type SidebarView = "positions" | "markets" | "logs";

export type FocusPanel = "chat" | "sidebar";

export type RenderLine = {
  readonly key: string;
  readonly text: string;
  readonly color?: string;
  readonly dim?: boolean;
  readonly bold?: boolean;
  readonly italic?: boolean;
};

export type LayoutMode = "chat" | "split" | "sidebar";

// Ink key type
export type InkKey = {
  upArrow: boolean;
  downArrow: boolean;
  leftArrow: boolean;
  rightArrow: boolean;
  pageDown: boolean;
  pageUp: boolean;
  return: boolean;
  escape: boolean;
  ctrl: boolean;
  shift: boolean;
  tab: boolean;
  backspace: boolean;
  delete: boolean;
  meta: boolean;
  name?: string;
};

export type LogArg =
  | string
  | number
  | boolean
  | null
  | undefined
  | Error
  | Record<string, string | number | boolean | null | undefined>;

export type LoggerMethod = (...args: LogArg[]) => void;
export type LoggerLike = {
  info?: LoggerMethod;
  warn?: LoggerMethod;
  error?: LoggerMethod;
  debug?: LoggerMethod;
};

// --- Text utilities ---

export function wrapText(text: string, maxWidth: number): string[] {
  if (maxWidth <= 0) return [text];
  const lines: string[] = [];
  const paragraphs = text.split("\n");
  for (const paragraph of paragraphs) {
    if (paragraph.length <= maxWidth) {
      lines.push(paragraph);
      continue;
    }
    const words = paragraph.split(" ");
    let current = "";
    for (const word of words) {
      const next = current.length > 0 ? `${current} ${word}` : word;
      if (next.length <= maxWidth) {
        current = next;
        continue;
      }
      if (current.length > 0) {
        lines.push(current);
      }
      if (word.length > maxWidth) {
        let remaining = word;
        while (remaining.length > maxWidth) {
          lines.push(remaining.slice(0, maxWidth));
          remaining = remaining.slice(maxWidth);
        }
        current = remaining;
      } else {
        current = word;
      }
    }
    if (current.length > 0) {
      lines.push(current);
    }
  }
  return lines.length > 0 ? lines : [""];
}

export function sanitizeLine(text: string): string {
  return text
    .replace(/\r/g, " ")
    .replace(/\n/g, " ")
    .replace(/\x1b\[[0-9;]*[A-Za-z]/g, "")
    .trimEnd();
}

export function truncateText(text: string, maxWidth: number): string {
  if (maxWidth <= 0) return "";
  if (text.length <= maxWidth) return text;
  if (maxWidth <= 3) return text.slice(0, maxWidth);
  return text.slice(0, Math.max(0, maxWidth - 3)) + "...";
}

export function formatTime(timestamp: number): string {
  const date = new Date(timestamp);
  if (Number.isNaN(date.getTime())) return "";
  return date.toLocaleTimeString("en-US", {
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });
}

export function formatTimestamp(date: Date): string {
  const hh = String(date.getHours()).padStart(2, "0");
  const mm = String(date.getMinutes()).padStart(2, "0");
  const ss = String(date.getSeconds()).padStart(2, "0");
  return `${hh}:${mm}:${ss}`;
}

export function shortenId(value: string): string {
  if (value.length <= 12) return value;
  return `${value.slice(0, 5)}...${value.slice(-5)}`;
}

// --- Mouse handling ---

export function hasMouseSequence(value: string): boolean {
  return (
    /\x1b\[<\d+;\d+;\d+[mM]/.test(value) ||
    /\x1b\[\d+;\d+;\d+M/.test(value) ||
    /\x1b\[M[\s\S]{3}/.test(value) ||
    /\[<?\d+;\d+;\d+[mM]/.test(value) ||
    /\[M[\s\S]{3}/.test(value)
  );
}

export function consumeMouseScroll(buffer: string): { remaining: string; delta: number } {
  let delta = 0;
  let lastIndex = 0;
  const sgrPattern = /\x1b\[<(64|65|96|97);(\d+);(\d+)[mM]/g;
  let match = sgrPattern.exec(buffer);
  while (match) {
    delta += match[1] === "64" || match[1] === "96" ? 1 : -1;
    lastIndex = sgrPattern.lastIndex;
    match = sgrPattern.exec(buffer);
  }

  let remaining = buffer;
  if (lastIndex > 0) {
    remaining = buffer.slice(lastIndex);
  }
  const lastEsc = remaining.lastIndexOf("\x1b[<");
  if (lastEsc > 0) {
    remaining = remaining.slice(lastEsc);
  }
  return { remaining, delta };
}

export function stripInputArtifacts(value: string): string {
  let cleaned = value;
  cleaned = cleaned.replace(/\r\n/g, "\n").replace(/\r/g, "\n");
  cleaned = cleaned.replace(/\x1b\[<\d+;\d+;\d+[mM]/g, "");
  cleaned = cleaned.replace(/\x1b\[\d+;\d+;\d+M/g, "");
  cleaned = cleaned.replace(/\[<?\d+;\d+;\d+[mM]/g, "");
  cleaned = cleaned.replace(/\x1b\[M[\s\S]{3}/g, "");
  cleaned = cleaned.replace(/\[M[\s\S]{3}/g, "");
  cleaned = cleaned.replace(/\x1b\[[0-9;?]*[ -/]*[@-~]/g, "");
  cleaned = cleaned.replace(/\x1b\][^\x07]*(\x07|\x1b\\)/g, "");
  cleaned = cleaned.replace(/\x1b/g, "");
  cleaned = cleaned.replace(/[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/g, "");
  return cleaned;
}

// --- Card helpers ---

export function isCardBorderLine(line: string): boolean {
  const trimmed = line.trimEnd();
  return trimmed.length > 0 && /^-+$/.test(trimmed);
}

export function isCardDividerLine(line: string): boolean {
  const trimmed = line.trimEnd();
  return trimmed.length > 0 && /^=+$/.test(trimmed);
}

export function buildSidebarCard(title: string, lines: string[], maxInnerWidth: number): string {
  const titleLines = wrapText(title, maxInnerWidth);
  const bodyLines = lines.flatMap((line) => wrapText(line, maxInnerWidth));
  const allLines = [...titleLines, ...bodyLines];
  const widest = Math.max(12, ...allLines.map((line) => line.length));
  const contentWidth = Math.min(maxInnerWidth, widest);
  const border = "-".repeat(contentWidth);
  const divider = "=".repeat(contentWidth);
  const renderLine = (line: string) => line.padEnd(contentWidth);
  const rows = [
    border,
    ...titleLines.map(renderLine),
    divider,
    ...bodyLines.map(renderLine),
    border,
  ];
  return rows.join("\n");
}

export function getSidebarCardInnerWidth(panelWidth: number): number {
  const contentWidth = Math.max(10, panelWidth - 2);
  return Math.max(12, contentWidth - 4);
}

// --- Log formatting ---

export function formatLogArgs(args: LogArg[]): string {
  const parts = args.map((arg) => {
    if (typeof arg === "string") return arg;
    if (typeof arg === "number" || typeof arg === "boolean") return String(arg);
    if (arg instanceof Error) return arg.message;
    if (arg === null || arg === undefined) return "";
    try {
      return JSON.stringify(arg);
    } catch {
      return "[object]";
    }
  });
  return parts.filter((p) => p.length > 0).join(" ");
}

// --- Render helpers ---

export function toRenderLines(messages: ChatMessage[], maxWidth: number): RenderLine[] {
  const lines: RenderLine[] = [];
  for (const msg of messages) {
    if (msg.role === "system") {
      const wrapped = wrapText(msg.content, maxWidth);
      wrapped.forEach((line, idx) => {
        lines.push({
          key: `${msg.id}:system:${idx}`,
          text: sanitizeLine(line),
          dim: true,
          italic: true,
        });
      });
      continue;
    }
    const speaker = msg.role === "user" ? "You" : "Eliza";
    const color = msg.role === "user" ? "cyan" : "green";
    const header = `${speaker}: ${formatTime(msg.timestamp)}`;
    lines.push({
      key: `${msg.id}:header`,
      text: sanitizeLine(header),
      color,
      bold: true,
    });
    const indent = "  ";
    const contentLines = msg.content.split("\n");
    let lineIndex = 0;
    for (const rawLine of contentLines) {
      if (isCardBorderLine(rawLine) || isCardDividerLine(rawLine)) {
        lines.push({
          key: `${msg.id}:card:${lineIndex}`,
          text: sanitizeLine(rawLine),
        });
        lineIndex += 1;
        continue;
      }
      const wrapped = wrapText(rawLine, Math.max(1, maxWidth - indent.length));
      wrapped.forEach((line) => {
        lines.push({
          key: `${msg.id}:body:${lineIndex}`,
          text: sanitizeLine(`${indent}${line}`),
        });
        lineIndex += 1;
      });
    }
  }
  return lines;
}

export function normalizeSetting(
  value: string | number | boolean | null | undefined,
): string | null {
  if (typeof value === "number") return String(value);
  if (typeof value === "boolean") return value ? "true" : "false";
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  if (!trimmed) return null;
  const lowered = trimmed.toLowerCase();
  if (lowered === "null" || lowered === "undefined") return null;
  return trimmed;
}
