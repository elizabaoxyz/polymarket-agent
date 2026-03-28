# Multi-User Web App with Per-User Keys Design Spec

> Each user provides their own API keys via a settings modal. Keys stored in browser localStorage, sent to WS server per-session. Server creates an isolated elizaOS runtime per user.

## Problem

The current web app uses hardcoded .env credentials for a single user. For a demo where multiple people try the agent, each user needs to connect with their own Polymarket wallet, LLM keys, and optionally Jupiter/x402 keys.

## Architecture

```
Browser (User A)  ──WebSocket──→  WS Server (port 3001)
  localStorage: keys A              ├─ Runtime A (User A's keys)
                                    │
Browser (User B)  ──WebSocket──→    ├─ Runtime B (User B's keys)
  localStorage: keys B              │
                                    └─ (max ~5 concurrent)
```

### Lifecycle

1. User opens web app
2. If no keys in localStorage → settings modal appears (blocks chat)
3. User enters keys, saves → stored in localStorage
4. WebSocket connects, sends `{ type: "auth", keys: { ... } }`
5. Server creates a new elizaOS runtime with those keys
6. Server sends `{ type: "auth_ok" }` or `{ type: "auth_error", text: "..." }`
7. Chat is enabled
8. On disconnect → server stops and destroys the runtime

### WebSocket Protocol Changes

New client-to-server message:

```typescript
{ type: "auth", keys: Record<string, string> }
```

New server-to-client messages:

```typescript
{ type: "auth_ok" }
{ type: "auth_error", text: string }
```

The `auth` message MUST be the first message sent after WebSocket connection. All other messages (`message`, `get_status`) are rejected until auth succeeds.

## Keys Required

### LLM Provider (at least one required)

| Key | Label | Default |
|-----|-------|---------|
| `OPENAI_API_KEY` | OpenAI API Key | — |
| `ANTHROPIC_API_KEY` | Anthropic API Key | — |
| `GOOGLE_GENERATIVE_AI_API_KEY` | Gemini API Key | — |
| `GROQ_API_KEY` | Groq API Key | — |
| `XAI_API_KEY` | Grok API Key | — |

### Polymarket (required for trading)

| Key | Label | Default |
|-----|-------|---------|
| `EVM_PRIVATE_KEY` | Wallet Private Key (hex) | — |
| `CLOB_API_KEY` | CLOB API Key | — |
| `CLOB_API_SECRET` | CLOB API Secret | — |
| `CLOB_API_PASSPHRASE` | CLOB API Passphrase | — |
| `POLYMARKET_FUNDER_ADDRESS` | Proxy Wallet Address | — |
| `POLYMARKET_SIGNATURE_TYPE` | Signature Type | 1 |

### Jupiter (optional)

| Key | Label | Default |
|-----|-------|---------|
| `JUPITER_API_KEY` | Jupiter API Key | — |
| `SOLANA_PRIVATE_KEY` | Solana Private Key (base58) | — |
| `SOLANA_RPC_URL` | Solana RPC URL | — |

### x402 (optional)

| Key | Label | Default |
|-----|-------|---------|
| `X402_ENABLED` | Enable x402 Payments | false |
| `X402_MAX_PAYMENT_USD` | Max Payment Per Request ($) | 0.10 |

## Frontend Changes

### New: `web/components/settings-modal.tsx`

Full-screen modal that appears when no keys are in localStorage. Sections:

1. **LLM Provider** — radio select for provider (OpenAI/Anthropic/Gemini/Groq/Grok), then API key input for the selected one
2. **Polymarket** — all 6 fields, all required. Help text: "Get these from polymarket.com/settings"
3. **Jupiter** — 3 fields, all optional. Collapsible section.
4. **x402** — toggle + max payment, optional. Collapsible section.

Bottom: "Connect" button (disabled until required fields filled).

Also accessible via a gear icon in the header (to edit keys later).

### New: `web/lib/keys.ts`

```typescript
type UserKeys = Record<string, string>;

function saveKeys(keys: UserKeys): void     // localStorage.setItem
function loadKeys(): UserKeys | null        // localStorage.getItem + parse
function clearKeys(): void                  // localStorage.removeItem
function hasRequiredKeys(keys: UserKeys): boolean  // check LLM + Polymarket keys
```

### Modified: `web/lib/ws-client.ts`

- On connect, send `{ type: "auth", keys }` as first message
- Handle `auth_ok` → set connected state, enable chat
- Handle `auth_error` → show error, prompt to fix keys
- Don't send any other messages until auth_ok received

### Modified: `web/components/header.tsx`

- Add gear icon button to open settings modal
- Balance comes from WebSocket status (no change)

### Modified: `web/app/page.tsx`

- Check localStorage for keys on mount
- If no keys → show settings modal
- On settings save → connect WebSocket with keys
- Gear icon in header reopens settings

## Backend Changes

### Modified: `ws-server.ts`

Replace single global runtime with per-connection runtime management:

```typescript
type UserSession = {
  runtime: AgentRuntime;
  messageService: IMessageService;
  authenticated: boolean;
};

const sessions = new Map<WebSocket, UserSession>();
```

**On WebSocket open**: Store connection, set `authenticated: false`.

**On `auth` message**:
1. Validate keys (check at least one LLM key + EVM_PRIVATE_KEY present)
2. Create a new elizaOS runtime with the user's keys as settings
3. Initialize runtime, ensure connection
4. Store in sessions map
5. Send `auth_ok` or `auth_error`

**On `message` / `get_status`**: Reject if not authenticated. Use the session's runtime.

**On WebSocket close**:
1. Get session from map
2. Stop runtime
3. Delete from map

**Runtime creation**: Same as current `createRuntime()` but takes `keys: Record<string, string>` parameter instead of reading from process.env. The `loadEnvConfig` call is replaced with direct key extraction from the auth message.

## Security

- Keys transmitted over WebSocket (use WSS/TLS in production)
- Keys held in server memory only during active session
- Keys never logged, never written to disk
- Each user's runtime is fully isolated
- Runtime destroyed immediately on disconnect
- localStorage can be cleared by user via "Disconnect" button

## Scope

**In scope:**
- Settings modal with all key inputs
- localStorage persistence
- Per-user runtime creation/destruction
- Auth handshake over WebSocket
- Gear icon to edit keys
- "Disconnect" to clear keys and close session

**Out of scope:**
- Key encryption in localStorage (browser security model applies)
- Rate limiting per user
- User accounts / registration
- Key validation against APIs before runtime creation
- WSS/TLS (deployment concern)
