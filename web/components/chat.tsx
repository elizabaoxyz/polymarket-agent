"use client";

import { useEffect, useRef, useState } from "react";
import type { ChatMessage } from "@/lib/types";
import { Message, ThinkingIndicator } from "./message";

type ChatProps = {
  messages: ChatMessage[];
  isThinking: boolean;
  isConnected: boolean;
  onSend: (text: string) => void;
};

export function Chat({ messages, isThinking, isConnected, onSend }: ChatProps) {
  const [input, setInput] = useState("");
  const scrollRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: "smooth" });
  }, [messages, isThinking]);

  const handleSubmit = () => {
    const text = input.trim();
    if (!text || !isConnected || isThinking) return;
    onSend(text);
    setInput("");
    inputRef.current?.focus();
  };

  return (
    <div className="flex flex-col h-full">
      {/* Messages */}
      <div ref={scrollRef} className="flex-1 overflow-y-auto px-4 py-6">
        <div className="max-w-[720px] mx-auto">
          {messages.length === 0 && (
            <div className="text-center py-20">
              <div className="w-12 h-12 bg-[var(--accent)] rounded-xl flex items-center justify-center text-white text-xl font-bold mx-auto mb-4">
                P
              </div>
              <h2 className="text-xl font-semibold text-[var(--text)] mb-2">Polyagent</h2>
              <p className="text-[var(--text-secondary)] text-sm max-w-md mx-auto">
                AI trading agent for Polymarket. Try: &quot;place a $5 YES bet on something interesting&quot;
              </p>
            </div>
          )}
          {messages.map((msg) => (
            <Message key={msg.id} msg={msg} />
          ))}
          {isThinking && <ThinkingIndicator />}
        </div>
      </div>

      {/* Input */}
      <div className="border-t border-[var(--border)] bg-white px-4 py-3">
        <div className="max-w-[720px] mx-auto">
          <div className="flex items-center gap-2 bg-[#f4f4f5] rounded-full px-4 py-2">
            <input
              ref={inputRef}
              type="text"
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && handleSubmit()}
              placeholder={isConnected ? "Message Polyagent..." : "Connecting..."}
              disabled={!isConnected}
              className="flex-1 bg-transparent outline-none text-[15px] text-[var(--text)] placeholder:text-[var(--text-secondary)] disabled:opacity-50"
            />
            <button
              onClick={handleSubmit}
              disabled={!input.trim() || !isConnected || isThinking}
              className="w-8 h-8 bg-[var(--accent)] hover:bg-indigo-600 disabled:bg-gray-300 rounded-full flex items-center justify-center transition-colors"
            >
              <svg width="16" height="16" viewBox="0 0 16 16" fill="none" className="text-white">
                <path d="M8 12V4M8 4L4 8M8 4L12 8" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
