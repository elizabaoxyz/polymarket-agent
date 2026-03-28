import { Clock } from "lucide-react";
import type { ChatMessage } from "@/lib/types";

function formatTime(ts: number): string {
  return new Date(ts).toLocaleTimeString("en-US", {
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
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
      <div className="flex justify-end mb-4">
        <div className="max-w-[75%]">
          <div className="bg-[var(--accent)] rounded-xl rounded-br-sm px-4 py-2.5">
            <p className="text-[14px] text-[#0a0a0a] whitespace-pre-wrap leading-relaxed">
              {msg.text}
            </p>
          </div>
          <div className="flex justify-end">
            <Timestamp ts={msg.timestamp} />
          </div>
        </div>
      </div>
    );
  }

  if (msg.role === "action") {
    return (
      <div className="flex justify-start mb-4">
        <div className="max-w-[75%]">
          <div className="bg-[var(--bg-panel)] border-l-2 border-[var(--accent)] px-4 py-2.5">
            <p className="mono text-[13px] text-[var(--green)] whitespace-pre-wrap leading-relaxed">
              {msg.text}
            </p>
          </div>
          <Timestamp ts={msg.timestamp} />
        </div>
      </div>
    );
  }

  // agent
  return (
    <div className="flex justify-start mb-4">
      <div className="max-w-[75%]">
        <div className="bg-[var(--bg-card)] border border-[var(--border)] rounded-xl rounded-bl-sm px-4 py-2.5">
          <p className="text-[14px] text-[var(--text)] whitespace-pre-wrap leading-relaxed">
            {msg.text}
          </p>
        </div>
        <Timestamp ts={msg.timestamp} />
      </div>
    </div>
  );
}

export function ThinkingIndicator() {
  return (
    <div className="flex justify-start mb-4">
      <div className="bg-[var(--bg-card)] border border-[var(--border)] rounded-xl rounded-bl-sm px-4 py-3 flex gap-1.5">
        <div className="w-2 h-2 bg-[var(--green)] rounded-full thinking-dot" />
        <div className="w-2 h-2 bg-[var(--green)] rounded-full thinking-dot" />
        <div className="w-2 h-2 bg-[var(--green)] rounded-full thinking-dot" />
      </div>
    </div>
  );
}
