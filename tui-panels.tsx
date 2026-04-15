/**
 * TUI panel components — ChatPanel, SidebarPanel, FatalErrorDisplay.
 */

import { Box, Text, useApp, useInput } from "ink";
import TextInput from "ink-text-input";
import type { ReactNode } from "react";
import { useEffect } from "react";
import type { ChatMessage, InkKey, RenderLine, SidebarView } from "./tui-utils";
import {
  formatTimestamp,
  isCardBorderLine,
  isCardDividerLine,
  sanitizeLine,
  toRenderLines,
  wrapText,
} from "./tui-utils";

// --- Fatal Error Display ---

export function FatalErrorDisplay({
  error,
  columns,
  rows,
}: {
  error: string;
  columns: number;
  rows: number;
}): ReactNode {
  const { exit } = useApp();

  useInput((_, rawKey) => {
    const key = rawKey as InkKey;
    if (key.return || key.escape || (key.ctrl && key.name === "c")) {
      exit();
    }
  });

  let helpText = "";
  if (error.includes("No output generated") || error.includes("AI_NoOutputGeneratedError")) {
    helpText =
      "This usually means your API key is missing, invalid, or rate-limited. Check your .env file.";
  } else if (
    error.includes("API key") ||
    error.includes("api_key") ||
    error.includes("Unauthorized")
  ) {
    helpText =
      "Check that your API key is set correctly in .env (OPENAI_API_KEY, ANTHROPIC_API_KEY, etc.)";
  } else if (error.includes("ECONNREFUSED") || error.includes("network")) {
    helpText = "Network error - check your internet connection and API endpoint URLs.";
  }

  const lines = error.split("\n");
  const maxLines = Math.max(1, rows - (helpText ? 12 : 10));
  const displayLines = lines.slice(0, maxLines);

  return (
    <Box flexDirection="column" width={columns} height={rows} padding={1}>
      <Box marginBottom={1}>
        <Text color="red" bold>
          {"═".repeat(Math.min(50, columns - 4))}
        </Text>
      </Box>
      <Box marginBottom={1}>
        <Text color="red" bold>
          ❌ FATAL ERROR
        </Text>
      </Box>
      <Box marginBottom={1}>
        <Text color="red" bold>
          {"═".repeat(Math.min(50, columns - 4))}
        </Text>
      </Box>
      <Box flexDirection="column" marginBottom={1}>
        {displayLines.map((line, idx) => (
          <Text key={idx} color="white" wrap="truncate">
            {line}
          </Text>
        ))}
        {lines.length > maxLines && (
          <Text color="gray" italic>
            ... {lines.length - maxLines} more lines
          </Text>
        )}
      </Box>
      {helpText && (
        <Box marginBottom={1}>
          <Text color="yellow">💡 {helpText}</Text>
        </Box>
      )}
      <Box marginTop={1}>
        <Text color="red" bold>
          {"═".repeat(Math.min(50, columns - 4))}
        </Text>
      </Box>
      <Box marginTop={1} flexDirection="column">
        <Text color="cyan">📄 Full log: polymarket-error.log</Text>
        <Text color="gray">Press Enter or Escape to exit</Text>
      </Box>
    </Box>
  );
}

// --- Chat Panel ---

export function ChatPanel(props: {
  readonly messages: ChatMessage[];
  readonly input: string;
  readonly onInputChange: (value: string) => void;
  readonly onSubmit: (value: string) => void;
  readonly width: number;
  readonly height: number;
  readonly scrollOffset: number;
  readonly onMaxScrollChange?: (maxScroll: number) => void;
  readonly isActive: boolean;
}): ReactNode {
  const {
    messages,
    input,
    onInputChange,
    onSubmit,
    width,
    height,
    scrollOffset,
    onMaxScrollChange,
    isActive,
  } = props;
  if (height <= 0) return null;
  const contentWidth = Math.max(10, width - 2);
  const renderLines = toRenderLines(messages, contentWidth);
  const messagesHeight = Math.max(0, height - 1);

  const totalLines = renderLines.length;
  const maxScroll = Math.max(0, totalLines - messagesHeight);

  useEffect(() => {
    onMaxScrollChange?.(maxScroll);
  }, [maxScroll, onMaxScrollChange]);

  const effectiveOffset = Math.min(scrollOffset, maxScroll);
  const startIdx = Math.max(0, totalLines - messagesHeight - effectiveOffset);
  const endIdx = Math.min(totalLines, startIdx + messagesHeight);
  const visibleLines = renderLines.slice(startIdx, endIdx);
  const linesToRender = visibleLines.slice(0, messagesHeight);

  return (
    <Box width={width} height={height} flexDirection="column" overflow="hidden">
      <Box flexDirection="column" paddingX={1} height={messagesHeight} overflow="hidden">
        {linesToRender.map((line) => (
          <Text
            key={line.key}
            {...(line.color ? { color: line.color } : {})}
            dimColor={!isActive || line.dim === true}
            bold={line.bold === true}
            italic={line.italic === true}
            wrap="truncate"
          >
            {sanitizeLine(line.text)}
          </Text>
        ))}
      </Box>
      <Box paddingX={1} height={1} flexShrink={0}>
        <Text color="cyan" dimColor={!isActive}>
          {">"}{" "}
        </Text>
        <Box flexGrow={1}>
          <TextInput
            value={input}
            onChange={onInputChange}
            onSubmit={onSubmit}
            focus={isActive}
            showCursor={isActive}
          />
        </Box>
      </Box>
    </Box>
  );
}

// --- Sidebar Panel ---

function getSidebarBodyLines(
  view: SidebarView,
  content: string,
  loading: boolean,
  logs: string[],
  contentWidth: number,
): string[] {
  const bodyLines: string[] = [];
  if (view === "logs") {
    const logLines = logs.length > 0 ? logs : ["No logs yet."];
    logLines.forEach((line) => wrapText(line, contentWidth).forEach((l) => bodyLines.push(l)));
  } else if (loading) {
    wrapText("Loading...", contentWidth).forEach((line) => bodyLines.push(line));
  } else if (view === "markets") {
    const c = content.length > 0 ? content : "No data.";
    c.split("\n").forEach((line) => bodyLines.push(line));
  } else {
    const c = content.length > 0 ? content : "No data.";
    wrapText(c, contentWidth).forEach((line) => bodyLines.push(line));
  }
  return bodyLines;
}

export function SidebarPanel(props: {
  readonly view: SidebarView;
  readonly content: string;
  readonly loading: boolean;
  readonly updatedAt?: string;
  readonly width: number;
  readonly height: number;
  readonly logs: string[];
  readonly scrollOffset: number;
  readonly onMaxScrollChange?: (maxScroll: number) => void;
  readonly isActive: boolean;
}): ReactNode {
  const {
    view,
    content,
    loading,
    updatedAt,
    width,
    height,
    logs,
    scrollOffset,
    onMaxScrollChange,
    isActive,
  } = props;
  if (height <= 0) return null;
  const title =
    view === "positions" ? "Account" : view === "markets" ? "Active Markets" : "Agent Logs";
  const contentWidth = Math.max(10, width - 2);
  const bodyLines = getSidebarBodyLines(view, content, loading, logs, contentWidth);
  const bodyHeight = Math.max(0, height - 1);
  const totalLines = bodyLines.length;
  const maxScroll = Math.max(0, totalLines - bodyHeight);

  useEffect(() => {
    onMaxScrollChange?.(maxScroll);
  }, [maxScroll, onMaxScrollChange]);

  const effectiveOffset = Math.min(scrollOffset, maxScroll);
  const startIdx = Math.max(0, totalLines - bodyHeight - effectiveOffset);
  const endIdx = Math.min(totalLines, startIdx + bodyHeight);
  const visibleBody = bodyLines.slice(startIdx, endIdx);

  const scrollIndicator = effectiveOffset > 0 ? ` ↑${effectiveOffset}` : "";
  const header = updatedAt
    ? `${title} (${updatedAt})${scrollIndicator}`
    : `${title}${scrollIndicator}`;

  const renderLines: Array<{ key: string; text: string; color?: string; dim?: boolean }> = [];
  if (view === "markets") {
    let inCard = false;
    let inTitle = false;
    visibleBody.forEach((line, idx) => {
      const trimmed = line.trimEnd();
      if (isCardBorderLine(trimmed)) {
        if (!inCard) {
          inCard = true;
          inTitle = true;
        } else {
          inCard = false;
          inTitle = false;
        }
      } else if (isCardDividerLine(trimmed)) {
        inTitle = false;
      }
      let color: string | undefined;
      if (isCardBorderLine(trimmed) || isCardDividerLine(trimmed)) {
        color = "gray";
      } else if (inTitle && trimmed.length > 0) {
        color = "yellow";
      } else if (/https?:\/\//.test(trimmed)) {
        color = "blue";
      } else {
        color = "white";
      }
      renderLines.push({
        key: `body:${idx}`,
        text: line,
        color,
        dim: !isActive || isCardBorderLine(trimmed) || isCardDividerLine(trimmed),
      });
    });
  } else {
    visibleBody.forEach((line, idx) => {
      renderLines.push({ key: `body:${idx}`, text: line, dim: !isActive });
    });
  }

  const linesToRender = renderLines.slice(0, bodyHeight);

  return (
    <Box
      width={width}
      height={height}
      borderStyle="single"
      borderColor="gray"
      borderLeft
      borderRight={false}
      borderTop={false}
      borderBottom={false}
      flexDirection="column"
      paddingLeft={1}
      overflow="hidden"
    >
      <Box height={1} flexShrink={0}>
        <Text bold dimColor={!isActive}>
          {header}
        </Text>
      </Box>
      <Box flexDirection="column" height={bodyHeight} overflow="hidden">
        {linesToRender.map((line) => (
          <Text
            key={line.key}
            wrap="truncate"
            dimColor={line.dim === true}
            {...(line.color ? { color: line.color } : {})}
          >
            {sanitizeLine(line.text)}
          </Text>
        ))}
      </Box>
    </Box>
  );
}
