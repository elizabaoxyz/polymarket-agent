"use client";

import { useEffect, useRef, useState } from "react";
import { Bot, Smile, Mic, ArrowUp } from "lucide-react";
import type { ChatMessage } from "@/lib/types";
import { Message, ThinkingIndicator } from "./message";

type CenterChatProps = {
  messages: ChatMessage[];
  isThinking: boolean;
  isConnected: boolean;
  onSend: (text: string) => void;
};

export function CenterChat({ messages, isThinking, isConnected, onSend }: CenterChatProps) {
  const [input, setInput] = useState("");
  const scrollRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    scrollRef.current?.scrollTo({
      top: scrollRef.current.scrollHeight,
      behavior: "smooth",
    });
  }, [messages, isThinking]);

  const handleSubmit = () => {
    const text = input.trim();
    if (!text || !isConnected || isThinking) return;
    onSend(text);
    setInput("");
    inputRef.current?.focus();
  };

  return (
    <div className="flex flex-col h-full bg-[var(--bg)]">
      {/* Chat Header */}
      <div className="flex items-center gap-3 px-5 py-3 border-b border-[var(--border)] bg-[var(--bg-panel)]">
        <div className="w-8 h-8 rounded-full bg-[var(--green)] flex items-center justify-center">
          <Bot size={16} className="text-black" />
        </div>
        <div className="flex flex-col">
          <span className="mono text-sm font-bold text-[var(--text)] tracking-wider leading-tight">
            ELIZABAO
          </span>
          <span className="mono text-[10px] text-[var(--text-muted)] tracking-wide leading-tight">
            POWERED BY ELIZAOS
          </span>
        </div>
      </div>

      {/* Messages Area */}
      <div ref={scrollRef} className="flex-1 overflow-y-auto px-5 py-6">
        <div className="max-w-full mx-auto px-4">
          {messages.length === 0 && (
            <div className="flex flex-col items-center justify-center py-24 text-center">
              <div className="w-14 h-14 rounded-full bg-[var(--bg-agent)] border border-[var(--green)]/20 flex items-center justify-center mb-4">
                <Bot size={24} className="text-[var(--green)]" />
              </div>
              <h2 className="text-lg font-semibold text-[var(--text)] mb-2">
                ElizaBAO
              </h2>
              <p className="text-sm text-[var(--text-secondary)] max-w-sm">
                AI trading agent for Polymarket. Try asking me to scan markets,
                place bets, or check your portfolio.
              </p>
            </div>
          )}
          {messages.map((msg) => (
            <Message key={msg.id} msg={msg} />
          ))}
          {isThinking && <ThinkingIndicator />}
        </div>
      </div>

      {/* Input Bar */}
      <div className="px-5 py-3 border-t border-[var(--border)] bg-[var(--bg-panel)]">
        <div className="w-full">
          <div className="flex items-center gap-2 bg-[var(--bg-card)] rounded-full px-4 py-2 border border-[var(--border)]">
            <Smile size={18} className="text-[var(--text-muted)] shrink-0" />
            <input
              ref={inputRef}
              type="text"
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && handleSubmit()}
              placeholder={isConnected ? "Message ElizaBAO..." : "Connecting..."}
              disabled={!isConnected}
              className="flex-1 bg-transparent outline-none text-[15px] text-[var(--text)] placeholder:text-[var(--text-muted)] disabled:opacity-40"
            />
            <Mic size={18} className="text-[var(--text-muted)] shrink-0" />
            <button
              onClick={handleSubmit}
              disabled={!input.trim() || !isConnected || isThinking}
              className="w-8 h-8 bg-[var(--green)] hover:bg-[var(--accent-hover)] disabled:bg-[var(--border)] disabled:text-[var(--text-muted)] rounded-full flex items-center justify-center transition-colors shrink-0"
            >
              <ArrowUp size={16} className="text-black" />
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
