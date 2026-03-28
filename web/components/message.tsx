import type { ChatMessage } from "@/lib/types";

function formatTime(ts: number): string {
  return new Date(ts).toLocaleTimeString("en-US", {
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });
}

export function Message({ msg }: { msg: ChatMessage }) {
  if (msg.role === "user") {
    return (
      <div className="flex justify-end mb-4">
        <div className="max-w-[75%]">
          <div className="bg-white border border-[var(--border)] rounded-2xl rounded-br-md px-4 py-2.5">
            <p className="text-[15px] text-[var(--text)] whitespace-pre-wrap">{msg.text}</p>
          </div>
          <p className="text-[11px] text-[var(--text-secondary)] mt-1 text-right">{formatTime(msg.timestamp)}</p>
        </div>
      </div>
    );
  }

  if (msg.role === "action") {
    return (
      <div className="flex justify-start mb-4">
        <div className="max-w-[75%]">
          <div className="bg-[var(--accent-light)] border border-indigo-100 rounded-2xl rounded-bl-md px-4 py-2.5">
            <p className="text-[13px] text-[var(--accent)] whitespace-pre-wrap font-mono">{msg.text}</p>
          </div>
          <p className="text-[11px] text-[var(--text-secondary)] mt-1">{formatTime(msg.timestamp)}</p>
        </div>
      </div>
    );
  }

  return (
    <div className="flex justify-start mb-4">
      <div className="max-w-[75%]">
        <div className="bg-[var(--accent)] rounded-2xl rounded-bl-md px-4 py-2.5">
          <p className="text-[15px] text-white whitespace-pre-wrap">{msg.text}</p>
        </div>
        <p className="text-[11px] text-[var(--text-secondary)] mt-1">{formatTime(msg.timestamp)}</p>
      </div>
    </div>
  );
}

export function ThinkingIndicator() {
  return (
    <div className="flex justify-start mb-4">
      <div className="bg-gray-100 rounded-2xl rounded-bl-md px-4 py-3 flex gap-1.5">
        <div className="w-2 h-2 bg-gray-400 rounded-full thinking-dot" />
        <div className="w-2 h-2 bg-gray-400 rounded-full thinking-dot" />
        <div className="w-2 h-2 bg-gray-400 rounded-full thinking-dot" />
      </div>
    </div>
  );
}
