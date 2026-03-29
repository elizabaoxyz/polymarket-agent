"use client";

import { Clock, User } from "lucide-react";
import type { ChatMessage } from "@/lib/types";
import { MessageAnimation } from "./animated";

function formatTime(ts: number): string {
  return new Date(ts).toLocaleTimeString("en-US", {
    hour: "2-digit",
    minute: "2-digit",
    hour12: true,
  });
}

function Timestamp({ ts }: { ts: number }) {
  return (
    <span className="flex items-center gap-1 text-[10px] text-[var(--text-muted)] mt-1">
      <Clock size={10} />
      {formatTime(ts)}
    </span>
  );
}

export function Message({ msg }: { msg: ChatMessage }) {
  if (msg.role === "user") {
    return (
      <MessageAnimation>
      <div className="flex justify-end gap-2 mb-4">
        <div className="flex flex-col items-end">
          <div className="bg-[var(--accent)] rounded-xl rounded-br-sm px-4 py-2.5">
            <p className="text-[14px] text-[#0a0a0a] whitespace-pre-wrap leading-relaxed">
              {msg.text}
            </p>
          </div>
          <Timestamp ts={msg.timestamp} />
        </div>
        <div className="w-8 h-8 rounded-full bg-[var(--accent)] flex items-center justify-center shrink-0 mt-0.5">
          <User size={14} className="text-[#0a0a0a]" />
        </div>
      </div>
      </MessageAnimation>
    );
  }

  if (msg.role === "action") {
    return (
      <MessageAnimation>
      <div className="flex gap-2 mb-4">
        <img src="/elizabaobao.png" alt="ElizaBAO" className="w-8 h-8 rounded-full object-cover border border-[var(--green)] shrink-0 mt-0.5" />
        <div className="flex-1">
          <div className="bg-[var(--bg-panel)] border-l-2 border-[var(--accent)] px-4 py-2.5">
            <p className="mono text-[13px] text-[var(--green)] whitespace-pre-wrap leading-relaxed">
              {msg.text}
            </p>
          </div>
          <Timestamp ts={msg.timestamp} />
        </div>
      </div>
      </MessageAnimation>
    );
  }

  // agent — full width like ElizaBao
  return (
    <MessageAnimation>
    <div className="flex gap-2 mb-4">
      <img src="/elizabaobao.png" alt="ElizaBAO" className="w-8 h-8 rounded-full object-cover border border-[var(--green)] shrink-0 mt-0.5" />
      <div className="flex-1">
        <div className="bg-[var(--bg-card)] border border-[var(--border)] rounded-xl rounded-bl-sm px-4 py-2.5">
          <p className="text-[14px] text-[var(--text)] whitespace-pre-wrap leading-relaxed">
            {msg.text}
          </p>
        </div>
        <Timestamp ts={msg.timestamp} />
      </div>
    </div>
    </MessageAnimation>
  );
}

export function ThinkingIndicator() {
  return (
    <div className="flex gap-2 mb-4">
      <img src="/elizabaobao.png" alt="ElizaBAO" className="w-8 h-8 rounded-full object-cover border border-[var(--green)] shrink-0" />
      <div className="bg-[var(--bg-card)] border border-[var(--border)] rounded-xl rounded-bl-sm px-4 py-3 flex gap-1.5">
        <div className="w-2 h-2 bg-[var(--green)] rounded-full thinking-dot" />
        <div className="w-2 h-2 bg-[var(--green)] rounded-full thinking-dot" />
        <div className="w-2 h-2 bg-[var(--green)] rounded-full thinking-dot" />
      </div>
    </div>
  );
}
