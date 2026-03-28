# Multi-User Keys Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let multiple users connect to the web app with their own API keys, each getting an isolated elizaOS runtime.

**Architecture:** Settings modal in Next.js stores keys in localStorage. On WebSocket connect, client sends auth message with keys. Server creates a per-user runtime, destroys it on disconnect.

**Tech Stack:** Next.js, TypeScript, Bun WebSocket, localStorage

**Spec:** `docs/superpowers/specs/2026-03-28-multi-user-keys-design.md`

---

## File Map

| File | Action | Responsibility |
|------|--------|---------------|
| `web/lib/keys.ts` | Create | localStorage key management |
| `web/lib/types.ts` | Modify | Add auth message types |
| `web/lib/ws-client.ts` | Modify | Auth handshake, accept keys param |
| `web/components/settings-modal.tsx` | Create | Key input form with sections |
| `web/components/header.tsx` | Modify | Add gear icon + disconnect button |
| `web/app/page.tsx` | Modify | Orchestrate settings modal + auth flow |
| `ws-server.ts` | Modify | Per-user sessions, auth handling |

---

### Task 1: Keys Utility + Types

**Files:**
- Create: `web/lib/keys.ts`
- Modify: `web/lib/types.ts`

- [ ] **Step 1: Create web/lib/keys.ts**

```typescript
"use client";

export type UserKeys = Record<string, string>;

const STORAGE_KEY = "polyagent-keys";

const REQUIRED_KEYS = ["EVM_PRIVATE_KEY", "CLOB_API_KEY", "CLOB_API_SECRET", "CLOB_API_PASSPHRASE", "POLYMARKET_FUNDER_ADDRESS"];
const LLM_KEYS = ["OPENAI_API_KEY", "ANTHROPIC_API_KEY", "GOOGLE_GENERATIVE_AI_API_KEY", "GROQ_API_KEY", "XAI_API_KEY"];

export function saveKeys(keys: UserKeys): void {
  if (typeof window === "undefined") return;
  localStorage.setItem(STORAGE_KEY, JSON.stringify(keys));
}

export function loadKeys(): UserKeys | null {
  if (typeof window === "undefined") return null;
  const raw = localStorage.getItem(STORAGE_KEY);
  if (!raw) return null;
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

export function clearKeys(): void {
  if (typeof window === "undefined") return;
  localStorage.removeItem(STORAGE_KEY);
}

export function hasRequiredKeys(keys: UserKeys): boolean {
  const hasLlm = LLM_KEYS.some((k) => keys[k]?.trim());
  const hasPolymarket = REQUIRED_KEYS.every((k) => keys[k]?.trim());
  return hasLlm && hasPolymarket;
}
```

- [ ] **Step 2: Add auth types to web/lib/types.ts**

Add to `ServerMessage` union:

```typescript
  | { type: "auth_ok" }
  | { type: "auth_error"; text: string }
```

Add to `ClientMessage` union:

```typescript
  | { type: "auth"; keys: Record<string, string> }
```

- [ ] **Step 3: Commit**

```bash
git add web/lib/keys.ts web/lib/types.ts
git commit -m "feat(web): add key storage utility and auth types"
```

---

### Task 2: Settings Modal

**Files:**
- Create: `web/components/settings-modal.tsx`

- [ ] **Step 1: Create web/components/settings-modal.tsx**

```tsx
"use client";

import { useState } from "react";
import { type UserKeys, hasRequiredKeys } from "@/lib/keys";

type SettingsModalProps = {
  initialKeys: UserKeys;
  onSave: (keys: UserKeys) => void;
  onDisconnect?: () => void;
  isEdit?: boolean;
};

type FieldDef = {
  key: string;
  label: string;
  placeholder?: string;
  required?: boolean;
  defaultValue?: string;
  type?: "text" | "select";
  options?: { value: string; label: string }[];
};

const LLM_PROVIDERS = [
  { value: "OPENAI_API_KEY", label: "OpenAI" },
  { value: "ANTHROPIC_API_KEY", label: "Anthropic" },
  { value: "GOOGLE_GENERATIVE_AI_API_KEY", label: "Gemini" },
  { value: "GROQ_API_KEY", label: "Groq" },
  { value: "XAI_API_KEY", label: "Grok" },
];

const POLYMARKET_FIELDS: FieldDef[] = [
  { key: "EVM_PRIVATE_KEY", label: "Wallet Private Key (hex)", placeholder: "0x...", required: true },
  { key: "CLOB_API_KEY", label: "CLOB API Key", required: true },
  { key: "CLOB_API_SECRET", label: "CLOB API Secret", required: true },
  { key: "CLOB_API_PASSPHRASE", label: "CLOB API Passphrase", required: true },
  { key: "POLYMARKET_FUNDER_ADDRESS", label: "Proxy Wallet Address", placeholder: "0x...", required: true },
  { key: "POLYMARKET_SIGNATURE_TYPE", label: "Signature Type", defaultValue: "1" },
];

const JUPITER_FIELDS: FieldDef[] = [
  { key: "JUPITER_API_KEY", label: "Jupiter API Key" },
  { key: "SOLANA_PRIVATE_KEY", label: "Solana Private Key (base58)" },
  { key: "SOLANA_RPC_URL", label: "Solana RPC URL", placeholder: "https://api.mainnet-beta.solana.com" },
];

const X402_FIELDS: FieldDef[] = [
  { key: "X402_ENABLED", label: "Enable x402 Payments", defaultValue: "false" },
  { key: "X402_MAX_PAYMENT_USD", label: "Max Payment Per Request ($)", defaultValue: "0.10" },
];

function FieldInput({ field, value, onChange }: { field: FieldDef; value: string; onChange: (v: string) => void }) {
  return (
    <div className="mb-3">
      <label className="block text-sm font-medium text-[var(--text)] mb-1">
        {field.label}
        {field.required && <span className="text-red-500 ml-1">*</span>}
      </label>
      <input
        type={field.key.includes("KEY") || field.key.includes("SECRET") || field.key.includes("PRIVATE") || field.key.includes("PASSPHRASE") ? "password" : "text"}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={field.placeholder ?? ""}
        className="w-full px-3 py-2 text-sm border border-[var(--border)] rounded-lg bg-white text-[var(--text)] placeholder:text-gray-400 focus:outline-none focus:ring-2 focus:ring-[var(--accent)] focus:border-transparent"
      />
    </div>
  );
}

function Section({ title, children, collapsible = false }: { title: string; children: React.ReactNode; collapsible?: boolean }) {
  const [open, setOpen] = useState(!collapsible);
  return (
    <div className="mb-6">
      <button
        type="button"
        onClick={() => collapsible && setOpen(!open)}
        className={`text-sm font-semibold text-[var(--text)] mb-3 flex items-center gap-2 ${collapsible ? "cursor-pointer" : ""}`}
      >
        {collapsible && <span className="text-xs text-gray-400">{open ? "▼" : "▶"}</span>}
        {title}
      </button>
      {open && children}
    </div>
  );
}

export function SettingsModal({ initialKeys, onSave, onDisconnect, isEdit }: SettingsModalProps) {
  const [keys, setKeys] = useState<UserKeys>({ ...initialKeys });
  const [selectedProvider, setSelectedProvider] = useState(() => {
    return LLM_PROVIDERS.find((p) => initialKeys[p.value]?.trim())?.value ?? "OPENAI_API_KEY";
  });

  const update = (key: string, value: string) => {
    setKeys((prev) => ({ ...prev, [key]: value }));
  };

  const canConnect = hasRequiredKeys({ ...keys, [selectedProvider]: keys[selectedProvider] ?? "" });

  const handleSave = () => {
    // Set defaults
    if (!keys.POLYMARKET_SIGNATURE_TYPE?.trim()) keys.POLYMARKET_SIGNATURE_TYPE = "1";
    if (!keys.X402_MAX_PAYMENT_USD?.trim()) keys.X402_MAX_PAYMENT_USD = "0.10";
    onSave(keys);
  };

  return (
    <div className="fixed inset-0 z-[100] bg-black/50 flex items-center justify-center p-4">
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-lg max-h-[90vh] overflow-y-auto">
        <div className="px-6 py-5 border-b border-[var(--border)]">
          <h2 className="text-lg font-semibold text-[var(--text)]">
            {isEdit ? "Settings" : "Connect to Polyagent"}
          </h2>
          <p className="text-sm text-[var(--text-secondary)] mt-1">
            Enter your API keys to start trading. Keys are stored in your browser only.
          </p>
        </div>

        <div className="px-6 py-4">
          {/* LLM Provider */}
          <Section title="LLM Provider">
            <div className="flex flex-wrap gap-2 mb-3">
              {LLM_PROVIDERS.map((p) => (
                <button
                  key={p.value}
                  type="button"
                  onClick={() => setSelectedProvider(p.value)}
                  className={`px-3 py-1.5 text-xs rounded-lg border transition-colors ${
                    selectedProvider === p.value
                      ? "bg-[var(--accent)] text-white border-[var(--accent)]"
                      : "bg-white text-[var(--text-secondary)] border-[var(--border)] hover:border-gray-400"
                  }`}
                >
                  {p.label}
                </button>
              ))}
            </div>
            <FieldInput
              field={{ key: selectedProvider, label: `${LLM_PROVIDERS.find((p) => p.value === selectedProvider)?.label} API Key`, required: true }}
              value={keys[selectedProvider] ?? ""}
              onChange={(v) => update(selectedProvider, v)}
            />
          </Section>

          {/* Polymarket */}
          <Section title="Polymarket">
            {POLYMARKET_FIELDS.map((field) => (
              <FieldInput
                key={field.key}
                field={field}
                value={keys[field.key] ?? field.defaultValue ?? ""}
                onChange={(v) => update(field.key, v)}
              />
            ))}
          </Section>

          {/* Jupiter */}
          <Section title="Jupiter (Optional)" collapsible>
            {JUPITER_FIELDS.map((field) => (
              <FieldInput
                key={field.key}
                field={field}
                value={keys[field.key] ?? ""}
                onChange={(v) => update(field.key, v)}
              />
            ))}
          </Section>

          {/* x402 */}
          <Section title="x402 Payments (Optional)" collapsible>
            {X402_FIELDS.map((field) => (
              <FieldInput
                key={field.key}
                field={field}
                value={keys[field.key] ?? field.defaultValue ?? ""}
                onChange={(v) => update(field.key, v)}
              />
            ))}
          </Section>
        </div>

        <div className="px-6 py-4 border-t border-[var(--border)] flex items-center justify-between">
          {isEdit && onDisconnect ? (
            <button
              type="button"
              onClick={onDisconnect}
              className="text-sm text-red-500 hover:text-red-600"
            >
              Disconnect & Clear Keys
            </button>
          ) : (
            <div />
          )}
          <button
            type="button"
            onClick={handleSave}
            disabled={!canConnect}
            className="px-6 py-2 text-sm font-medium text-white bg-[var(--accent)] hover:bg-indigo-600 disabled:bg-gray-300 rounded-lg transition-colors"
          >
            {isEdit ? "Save & Reconnect" : "Connect"}
          </button>
        </div>
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Commit**

```bash
git add web/components/settings-modal.tsx
git commit -m "feat(web): add settings modal for API key input"
```

---

### Task 3: Update WebSocket Client for Auth

**Files:**
- Modify: `web/lib/ws-client.ts`

- [ ] **Step 1: Rewrite ws-client.ts with auth support**

```typescript
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
      // Send auth as first message
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
```

Note: add `UserKeys` to the import from types. In `web/lib/types.ts`, add:

```typescript
export type UserKeys = Record<string, string>;
```

- [ ] **Step 2: Commit**

```bash
git add web/lib/ws-client.ts web/lib/types.ts
git commit -m "feat(web): add auth handshake to WebSocket client"
```

---

### Task 4: Update Header and Page

**Files:**
- Modify: `web/components/header.tsx`
- Modify: `web/app/page.tsx`

- [ ] **Step 1: Update header.tsx with gear icon**

```tsx
"use client";

type HeaderProps = {
  balance: number | null;
  isConnected: boolean;
  onOpenPositions: () => void;
  onOpenTrades: () => void;
  onOpenSettings: () => void;
};

export function Header({ balance, isConnected, onOpenPositions, onOpenTrades, onOpenSettings }: HeaderProps) {
  return (
    <header className="fixed top-0 left-0 right-0 z-50 bg-white border-b border-[var(--border)]">
      <div className="max-w-5xl mx-auto px-4 h-14 flex items-center justify-between">
        <div className="flex items-center gap-2.5">
          <div className="w-7 h-7 bg-[var(--accent)] rounded-md flex items-center justify-center text-white text-sm font-bold">
            P
          </div>
          <span className="font-semibold text-[15px]">Polyagent</span>
          <div
            className={`w-2 h-2 rounded-full ml-1 ${isConnected ? "bg-green-400" : "bg-red-400"}`}
            title={isConnected ? "Connected" : "Disconnected"}
          />
        </div>
        <div className="flex items-center gap-3">
          {balance !== null && (
            <span className="text-[var(--accent)] font-semibold text-sm font-mono">
              ${balance.toFixed(2)}
            </span>
          )}
          <button
            onClick={onOpenPositions}
            className="text-sm text-[var(--text-secondary)] hover:text-[var(--text)] px-3 py-1.5 rounded-lg hover:bg-gray-100 transition-colors"
          >
            Positions
          </button>
          <button
            onClick={onOpenTrades}
            className="text-sm text-[var(--text-secondary)] hover:text-[var(--text)] px-3 py-1.5 rounded-lg hover:bg-gray-100 transition-colors"
          >
            Trades
          </button>
          <button
            onClick={onOpenSettings}
            className="text-[var(--text-secondary)] hover:text-[var(--text)] p-1.5 rounded-lg hover:bg-gray-100 transition-colors"
            title="Settings"
          >
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <circle cx="12" cy="12" r="3" />
              <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" />
            </svg>
          </button>
        </div>
      </div>
    </header>
  );
}
```

- [ ] **Step 2: Rewrite page.tsx with settings flow**

```tsx
"use client";

import { useEffect, useState } from "react";
import { useWebSocket } from "@/lib/ws-client";
import { loadKeys, saveKeys, clearKeys, hasRequiredKeys, type UserKeys } from "@/lib/keys";
import { Header } from "@/components/header";
import { Chat } from "@/components/chat";
import { PortfolioPanel } from "@/components/portfolio-panel";
import { SettingsModal } from "@/components/settings-modal";

export default function Home() {
  const [keys, setKeys] = useState<UserKeys | null>(null);
  const [showSettings, setShowSettings] = useState(false);

  // Load keys from localStorage on mount
  useEffect(() => {
    const stored = loadKeys();
    if (stored && hasRequiredKeys(stored)) {
      setKeys(stored);
    } else {
      setShowSettings(true);
    }
  }, []);

  const { messages, sendMessage, isConnected, isThinking, portfolio, requestStatus, authState, authError, disconnect } =
    useWebSocket(keys);

  const [panelTab, setPanelTab] = useState<"positions" | "trades" | null>(null);

  // Show settings on auth error
  useEffect(() => {
    if (authState === "auth_error") {
      setShowSettings(true);
    }
  }, [authState]);

  const handleSaveKeys = (newKeys: UserKeys) => {
    saveKeys(newKeys);
    setKeys({ ...newKeys }); // new ref triggers reconnect
    setShowSettings(false);
  };

  const handleDisconnect = () => {
    disconnect();
    clearKeys();
    setKeys(null);
    setShowSettings(true);
  };

  const openPanel = (tab: "positions" | "trades") => {
    requestStatus();
    setPanelTab(tab);
  };

  // Show settings modal if no keys or user clicked gear
  const needsSettings = !keys || showSettings;

  return (
    <div className="h-screen flex flex-col bg-[var(--bg-chat)]">
      <Header
        balance={portfolio?.balance ?? null}
        isConnected={isConnected}
        onOpenPositions={() => openPanel("positions")}
        onOpenTrades={() => openPanel("trades")}
        onOpenSettings={() => setShowSettings(true)}
      />

      <main className="flex-1 pt-14 overflow-hidden">
        <Chat
          messages={messages}
          isThinking={isThinking}
          isConnected={isConnected}
          onSend={sendMessage}
        />
      </main>

      {panelTab && (
        <PortfolioPanel
          portfolio={portfolio}
          initialTab={panelTab}
          onClose={() => setPanelTab(null)}
        />
      )}

      {needsSettings && (
        <SettingsModal
          initialKeys={keys ?? loadKeys() ?? {}}
          onSave={handleSaveKeys}
          onDisconnect={keys ? handleDisconnect : undefined}
          isEdit={!!keys}
        />
      )}

      {authState === "authenticating" && (
        <div className="fixed inset-0 z-[90] bg-white/80 flex items-center justify-center">
          <div className="text-center">
            <div className="w-8 h-8 border-2 border-[var(--accent)] border-t-transparent rounded-full animate-spin mx-auto mb-3" />
            <p className="text-sm text-[var(--text-secondary)]">Initializing agent runtime...</p>
          </div>
        </div>
      )}

      {authError && showSettings && (
        <div className="fixed bottom-4 left-1/2 -translate-x-1/2 z-[110] bg-red-50 border border-red-200 text-red-700 text-sm px-4 py-2 rounded-lg">
          {authError}
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 3: Commit**

```bash
git add web/components/header.tsx web/app/page.tsx
git commit -m "feat(web): wire settings modal into page with auth flow"
```

---

### Task 5: Update WebSocket Server for Per-User Sessions

**Files:**
- Modify: `ws-server.ts`

- [ ] **Step 1: Rewrite ws-server.ts with per-user session management**

The key changes:
1. Remove the global `createRuntime()` call from `main()`
2. Add `createRuntimeFromKeys(keys)` that takes user-provided keys
3. Add `sessions` Map to track per-connection runtimes
4. Handle `auth` message type
5. Reject `message`/`get_status` if not authenticated
6. Destroy runtime on WebSocket close

Replace the `main()` function and WebSocket handlers. The `buildCharacter()`, `BROKEN_POLYMARKET_ACTIONS`, and `getPortfolioStatus()` functions stay the same. The changes are:

**Replace `createRuntime()`** with:

```typescript
async function createRuntimeFromKeys(keys: Record<string, string>) {
  const privateKey = keys.EVM_PRIVATE_KEY?.trim();
  if (!privateKey) throw new Error("EVM_PRIVATE_KEY is required");

  const hasLlm = ["OPENAI_API_KEY", "ANTHROPIC_API_KEY", "GOOGLE_GENERATIVE_AI_API_KEY", "GROQ_API_KEY", "XAI_API_KEY"]
    .some((k) => keys[k]?.trim());
  if (!hasLlm) throw new Error("At least one LLM API key is required");

  const character = buildCharacter();
  const llmProvider = resolveLlmProviderFromEnv();
  const llmPlugins = buildLlmPlugins(llmProvider);

  // Build settings from user keys + env fallbacks for LLM provider detection
  const settings: Record<string, string | undefined> = {
    ...buildLlmRuntimeSettings(llmProvider),
  };
  // Override with user-provided keys
  for (const [k, v] of Object.entries(keys)) {
    if (v?.trim()) settings[k] = v.trim();
  }
  // Ensure polymarket keys are set
  settings.EVM_PRIVATE_KEY = privateKey;
  settings.POLYMARKET_PRIVATE_KEY = privateKey;
  if (keys.CLOB_API_KEY?.trim()) settings.CLOB_API_KEY = keys.CLOB_API_KEY.trim();
  if (keys.CLOB_API_SECRET?.trim()) settings.CLOB_API_SECRET = keys.CLOB_API_SECRET.trim();
  if (keys.CLOB_API_PASSPHRASE?.trim()) settings.CLOB_API_PASSPHRASE = keys.CLOB_API_PASSPHRASE.trim();
  if (keys.POLYMARKET_FUNDER_ADDRESS?.trim()) settings.POLYMARKET_FUNDER_ADDRESS = keys.POLYMARKET_FUNDER_ADDRESS.trim();
  if (keys.POLYMARKET_SIGNATURE_TYPE?.trim()) settings.POLYMARKET_SIGNATURE_TYPE = keys.POLYMARKET_SIGNATURE_TYPE.trim();

  const runtime = new AgentRuntime({
    character,
    plugins: [
      sqlPlugin,
      {
        ...polymarketPlugin,
        actions: (polymarketPlugin.actions ?? []).filter(
          (a: { name?: string }) => !BROKEN_POLYMARKET_ACTIONS.includes(a.name ?? ""),
        ),
      },
      polymarketExtPlugin,
      jupiterPredictionPlugin,
      x402SolanaPlugin,
      ...llmPlugins,
    ],
    settings,
    logLevel: "error",
    enableAutonomy: true,
    actionPlanning: true,
    checkShouldRespond: false,
  });

  await runtime.initialize();

  try {
    const x402Svc = (await runtime.getServiceLoadPromise(X402_SERVICE_TYPE)) as X402SolanaService | null;
    if (x402Svc && x402Svc.isActive()) {
      globalThis.fetch = x402Svc.getWrappedFetch();
    }
  } catch {}

  // Use a unique room/world per session to avoid collisions
  const sessionId = uuidv4();
  const roomId = stringToUuid(`web-${sessionId}-room`);
  const worldId = stringToUuid(`web-${sessionId}-world`);

  await runtime.ensureConnection({
    entityId: DEFAULT_USER_ID,
    roomId,
    worldId,
    userName: "WebUser",
    source: "web-chat",
    channelId: "web",
    serverId: "web-server",
    type: ChannelType.DM,
  } as Parameters<typeof runtime.ensureConnection>[0]);

  return { runtime, roomId, worldId };
}
```

**Replace `main()`** with:

```typescript
type UserSession = {
  runtime: AgentRuntime;
  messageService: any;
  roomId: ReturnType<typeof stringToUuid>;
  worldId: ReturnType<typeof stringToUuid>;
};

const sessions = new Map<object, UserSession>();

async function main() {
  console.log("ws-server: ready (multi-user mode)");

  const server = Bun.serve({
    port: WS_PORT,
    fetch(req, server) {
      const url = new URL(req.url);
      if (req.method === "OPTIONS") {
        return new Response(null, {
          headers: {
            "Access-Control-Allow-Origin": "*",
            "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
            "Access-Control-Allow-Headers": "*",
          },
        });
      }
      if (url.pathname === "/health") {
        return Response.json({ status: "ok", sessions: sessions.size });
      }
      if (server.upgrade(req)) return undefined;
      return new Response("Not Found", { status: 404 });
    },
    websocket: {
      open(ws) {
        console.log("ws-server: client connected (awaiting auth)");
      },
      close(ws) {
        const session = sessions.get(ws);
        if (session) {
          console.log("ws-server: client disconnected, stopping runtime");
          session.runtime.stop().catch(() => {});
          sessions.delete(ws);
        }
      },
      async message(ws, raw) {
        let msg: { type: string; text?: string; keys?: Record<string, string> };
        try {
          msg = JSON.parse(String(raw));
        } catch {
          ws.send(JSON.stringify({ type: "error", text: "Invalid JSON" }));
          return;
        }

        // Auth message — must be first
        if (msg.type === "auth" && msg.keys) {
          if (sessions.has(ws)) {
            // Already authenticated — tear down old runtime first
            const old = sessions.get(ws)!;
            await old.runtime.stop().catch(() => {});
            sessions.delete(ws);
          }

          try {
            console.log("ws-server: creating runtime for user...");
            const { runtime, roomId, worldId } = await createRuntimeFromKeys(msg.keys);
            const messageService = runtime.messageService;
            if (!messageService) throw new Error("Message service not initialized");
            sessions.set(ws, { runtime, messageService, roomId, worldId });
            ws.send(JSON.stringify({ type: "auth_ok" }));
            console.log("ws-server: user authenticated, runtime ready");
          } catch (err) {
            const errMsg = err instanceof Error ? err.message : String(err);
            console.error("ws-server: auth failed:", errMsg);
            ws.send(JSON.stringify({ type: "auth_error", text: errMsg }));
          }
          return;
        }

        // All other messages require auth
        const session = sessions.get(ws);
        if (!session) {
          ws.send(JSON.stringify({ type: "error", text: "Not authenticated. Send auth first." }));
          return;
        }

        if (msg.type === "get_status") {
          const status = await getPortfolioStatus(session.runtime);
          ws.send(JSON.stringify({ type: "status", ...status }));
          return;
        }

        if (msg.type === "message" && typeof msg.text === "string") {
          ws.send(JSON.stringify({ type: "thinking", active: true }));

          const memory = createMessageMemory({
            id: uuidv4() as ReturnType<typeof stringToUuid>,
            entityId: DEFAULT_USER_ID,
            roomId: session.roomId,
            content: {
              text: msg.text,
              source: "web-chat",
              channelType: ChannelType.DM,
            },
          });

          try {
            await session.messageService.handleMessage(
              session.runtime,
              memory,
              async (content: Content) => {
                if (typeof content.text === "string" && content.text.trim()) {
                  ws.send(JSON.stringify({ type: "action_result", text: content.text.trim() }));
                }
                return [];
              },
              {} as never,
            );
          } catch (err) {
            const errMsg = err instanceof Error ? err.message : String(err);
            ws.send(JSON.stringify({ type: "error", text: errMsg }));
          }

          ws.send(JSON.stringify({ type: "thinking", active: false }));
          return;
        }

        ws.send(JSON.stringify({ type: "error", text: `Unknown message type: ${msg.type}` }));
      },
    },
  });

  console.log(`ws-server: listening on ws://localhost:${server.port}`);
}
```

- [ ] **Step 2: Verify the server starts**

Run: `bun run ws-server.ts`
Expected: `ws-server: ready (multi-user mode)` and `ws-server: listening on ws://localhost:3001`

- [ ] **Step 3: Verify end-to-end**

1. Start ws-server: `bun run ws-server.ts`
2. Start Next.js: `cd web && npm run dev`
3. Open http://localhost:3000
4. Settings modal should appear
5. Enter keys, click Connect
6. Should see "Initializing agent runtime..." spinner
7. Then chat should be enabled
8. Type a message — should get a response
9. Click gear icon — settings modal reopens
10. Close tab — server should log "client disconnected, stopping runtime"

- [ ] **Step 4: Commit**

```bash
git add ws-server.ts
git commit -m "feat(web): per-user sessions with auth handshake in WS server"
```
