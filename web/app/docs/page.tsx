"use client";

import { ArrowLeft, Zap, Bot, TrendingUp, TrendingDown, Shield, CreditCard, Heart, RefreshCw, Layers, Timer, DollarSign, Database, Search, BarChart3, Hexagon, Sun } from "lucide-react";
import Link from "next/link";

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="mb-10">
      <h2 className="mono text-lg font-bold text-[var(--accent)] mb-4 tracking-wider">{title}</h2>
      {children}
    </section>
  );
}

function Card({ icon, title, description }: { icon: React.ReactNode; title: string; description: string }) {
  return (
    <div className="p-4 bg-[var(--bg-card)] border border-[var(--border)] rounded-lg">
      <div className="flex items-center gap-2 mb-2">
        {icon}
        <span className="mono text-sm font-bold text-[var(--text)]">{title}</span>
      </div>
      <p className="text-[13px] text-[var(--text-secondary)] leading-relaxed">{description}</p>
    </div>
  );
}

function Table({ headers, rows }: { headers: string[]; rows: string[][] }) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-[13px] border border-[var(--border)] rounded-lg overflow-hidden">
        <thead>
          <tr className="bg-[var(--bg-card)]">
            {headers.map((h, i) => (
              <th key={i} className="mono text-left px-4 py-2 text-[var(--accent)] font-semibold border-b border-[var(--border)]">{h}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row, i) => (
            <tr key={i} className={i % 2 === 0 ? "bg-[var(--bg)]" : "bg-[var(--bg-panel)]"}>
              {row.map((cell, j) => (
                <td key={j} className="px-4 py-2 text-[var(--text-secondary)] border-b border-[var(--border)]">
                  <span className={j === 0 ? "mono text-[var(--text)]" : ""}>{cell}</span>
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export default function DocsPage() {
  return (
    <div className="min-h-screen bg-[var(--bg)] text-[var(--text)]">
      {/* Header */}
      <header className="sticky top-0 z-50 bg-[var(--bg)] border-b border-[var(--border)]">
        <div className="max-w-4xl mx-auto px-6 h-12 flex items-center gap-3">
          <Link href="/" className="flex items-center gap-2 text-[var(--text-muted)] hover:text-[var(--accent)] transition-colors">
            <ArrowLeft size={16} />
            <span className="mono text-[11px] tracking-wider">BACK TO APP</span>
          </Link>
          <div className="flex-1" />
          <span className="mono text-sm font-bold text-[var(--accent)] tracking-wider">ELIZABAO DOCS</span>
        </div>
      </header>

      {/* Content */}
      <main className="max-w-4xl mx-auto px-6 py-10">
        {/* Hero */}
        <div className="mb-12">
          <h1 className="mono text-2xl font-bold text-[var(--text)] mb-3 tracking-wider">
            ElizaBAO Documentation
          </h1>
          <p className="text-[15px] text-[var(--text-secondary)] leading-relaxed max-w-2xl">
            ElizaBAO is an AI-powered autonomous trading agent that scans, analyzes, buys, and sells across
            Polymarket (Polygon) and Jupiter Prediction Markets (Solana), with x402 payment protocol for
            accessing paid APIs. Built on elizaOS 2.0 with 6 custom plugins, RAG pipeline, and a real-time web dashboard.
          </p>
        </div>

        {/* Getting Started */}
        <Section title="GETTING STARTED">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <Card
              icon={<Bot size={18} className="text-[var(--green)]" />}
              title="Chat with the Agent"
              description="Type in the chat to interact with ElizaBAO. Ask it to scan markets, place bets, check positions, or show your PnL. The agent understands natural language and routes to the correct action."
            />
            <Card
              icon={<Zap size={18} className="text-[var(--green)]" />}
              title="Enable Autonomy"
              description="Click ALL in the header to trade both platforms, POLY for Polymarket only, or JUP+x402 for Jupiter only. The agent scans, analyzes, and trades every 60 seconds."
            />
            <Card
              icon={<TrendingUp size={18} className="text-[var(--green)]" />}
              title="Monitor Positions"
              description="Use the PORTFOLIO tab in the left sidebar to see open positions, PnL, and balances on both Polymarket (Polygon) and Jupiter (Solana)."
            />
            <Card
              icon={<CreditCard size={18} className="text-[var(--green)]" />}
              title="x402 Payments"
              description="The x402 badge shows payment protocol status. When active, the agent auto-pays for premium Jupiter/Solana API calls using USDC on Solana mainnet."
            />
          </div>
        </Section>

        {/* Dashboard Controls */}
        <Section title="DASHBOARD CONTROLS">
          <p className="text-[13px] text-[var(--text-secondary)] mb-4 leading-relaxed">
            The header provides three autonomy toggles. Click an active button to stop, or click a different button to switch platforms.
          </p>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-4">
            <Card
              icon={<Bot size={16} className="text-[var(--green)]" />}
              title="ALL"
              description="Run both Polymarket and Jupiter in parallel every cycle. Heartbeat active. x402 active."
            />
            <Card
              icon={<Hexagon size={16} className="text-[var(--green)]" />}
              title="POLY"
              description="Polymarket only (Polygon). Scan, analyze, buy/sell on CLOB. Heartbeat active. No Jupiter."
            />
            <Card
              icon={<Sun size={16} className="text-[var(--green)]" />}
              title="JUP + x402"
              description="Jupiter only (Solana). Scan, analyze, buy/sell prediction markets. x402 payments active. No heartbeat."
            />
          </div>
        </Section>

        {/* Chat Commands */}
        <Section title="CHAT COMMANDS">
          <p className="text-[13px] text-[var(--text-secondary)] mb-4">
            Type natural language commands in the chat. The agent routes to the correct action automatically.
          </p>
          <Table
            headers={["Command", "Example", "Platform"]}
            rows={[
              ["Place a bet", "\"buy $5 YES on Will Trump win 2028\"", "Polymarket"],
              ["Sell position", "\"sell my position on Trump market\"", "Polymarket"],
              ["Cancel orders", "\"cancel all my orders\"", "Polymarket"],
              ["Check positions", "\"show my positions\"", "Polymarket"],
              ["Check PnL", "\"show my PnL\"", "Polymarket"],
              ["View trades", "\"show my recent trades\"", "Polymarket"],
              ["Scan markets", "\"scan jupiter prediction markets\"", "Jupiter"],
              ["Jupiter bet", "\"bet $3 YES on jupiter market abc123\"", "Jupiter"],
              ["Jupiter positions", "\"show my jupiter positions\"", "Jupiter"],
              ["Sell Jupiter", "\"sell my jupiter position on market abc123\"", "Jupiter"],
              ["Claim winnings", "\"claim my jupiter winnings\"", "Jupiter"],
            ]}
          />
        </Section>

        {/* Autonomous Trading */}
        <Section title="AUTONOMOUS TRADING">
          <p className="text-[13px] text-[var(--text-secondary)] mb-4 leading-relaxed">
            When autonomy is enabled, both platforms run <strong>in parallel</strong> every 60 seconds. Each platform independently
            decides: if balance ≥ $3 → sell + buy; if balance &lt; $3 → sell only. Cycles never overlap — the next cycle
            waits for the previous one to finish.
          </p>

          <div className="bg-[var(--bg-card)] border border-[var(--border)] rounded-lg p-5 mb-6 mono text-[12px] text-[var(--text-secondary)] leading-loose">
            <div className="text-[var(--accent)] font-bold mb-2">CYCLE FLOW (EACH PLATFORM):</div>
            <div>1. <span className="text-[var(--red)]">SELL</span> — LLM analyzes positions hitting thresholds. Direct API execution (bypasses LLM routing).</div>
            <div>2. <span className="text-[var(--text)]">SCAN</span> — Fetch 500+ markets, filter by price, spread, volume, time, owned positions</div>
            <div>3. <span className="text-[var(--accent)]">RAG ENRICH</span> — Index markets in ChromaDB, fetch news + web search, compute similarity scores</div>
            <div>4. <span className="text-[var(--accent)]">ANALYZE</span> — LLM reviews top 5 candidates, picks market + YES/NO side with reasoning</div>
            <div>5. <span className="text-[var(--green)]">BUY</span> — Direct API call: search market → resolve token → order book → place order</div>
            <div>6. <span className="text-[var(--text-muted)]">REVIEW</span> — If 0 new markets (Jupiter), LLM reviews all positions for sell opportunities</div>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <Card
              icon={<TrendingDown size={18} className="text-[var(--red)]" />}
              title="Smart Selling"
              description="Positions down >15% or up >25% are sent to the LLM for SELL/HOLD review. Executed via direct CLOB/Jupiter API (not LLM routing). Falls back to curPrice × 0.95 when order book is thin."
            />
            <Card
              icon={<Layers size={18} className="text-[var(--green)]" />}
              title="Parallel Execution"
              description="Polymarket and Jupiter run simultaneously via Promise.allSettled(). Neither blocks the other. setTimeout chaining prevents cycle overlap."
            />
            <Card
              icon={<Shield size={18} className="text-[var(--green)]" />}
              title="Safety Guards"
              description="Min $3 bets, max 50 positions, 10-min hold before selling, no sells below $0.03, 5-min trade cooldown, failed ops skipped for 30 min, daily spend limit."
            />
            <Card
              icon={<Heart size={18} className="text-[var(--red)]" />}
              title="Heartbeat Protocol"
              description="Sends a signal to Polymarket every 10 seconds. Alerts after 5 consecutive failures. If agent stops, orders auto-cancel to protect funds."
            />
            <Card
              icon={<BarChart3 size={18} className="text-[var(--green)]" />}
              title="P&L Tracking"
              description="Every cycle logs the balance delta: [P&L] +$2.50 since last cycle (poly: +$1.50, sol: +$1.00). Cycle duration also tracked."
            />
            <Card
              icon={<DollarSign size={18} className="text-[var(--green)]" />}
              title="Daily Spend Limit"
              description="Configurable DAILY_SPEND_LIMIT_USD prevents runaway spending. Resets at midnight. Shows [SPEND] Today: $12/$50 in cycle logs."
            />
            <Card
              icon={<Database size={18} className="text-[var(--accent)]" />}
              title="RAG Pipeline"
              description="Markets indexed in ChromaDB every cycle. Similarity scores adjust market rankings ±10%. News + web search enriches LLM analysis context."
            />
            <Card
              icon={<Search size={18} className="text-[var(--accent)]" />}
              title="Position Review"
              description="When Jupiter finds 0 new markets, the LLM reviews all existing positions and recommends exits for dead money or unlikely outcomes."
            />
          </div>
        </Section>

        {/* Scoring Algorithm */}
        <Section title="SCORING ALGORITHM">
          <p className="text-[13px] text-[var(--text-secondary)] mb-4 leading-relaxed">
            Each market is scored 0–1 using weighted factors. RAG similarity adds ±10% adjustment. All weights are configurable via environment variables.
          </p>
          <Table
            headers={["Factor", "Polymarket", "Jupiter", "Formula"]}
            rows={[
              ["Spread", "35%", "35%", "1 - (spread / 0.15)"],
              ["Midpoint", "30%", "30%", "1 - |midpoint - 0.5| × 2"],
              ["Time", "20%", "—", "min(1, daysLeft / 30)"],
              ["Volume", "15%", "35%", "min(1, volume / threshold)"],
              ["RAG Similarity", "±10%", "±10%", "ChromaDB cosine similarity"],
            ]}
          />
          <div className="mt-4 p-4 bg-[var(--bg-card)] border border-[var(--border)] rounded-lg">
            <div className="mono text-[12px] text-[var(--text-secondary)]">
              <span className="text-[var(--accent)] font-bold">Position Sizing:</span>{" "}
              Score &gt; 0.9 → $6 (10% cap) | Score &gt; 0.7 → $4.50 (8% cap) | Score ≤ 0.7 → $3 (5% cap)
            </div>
          </div>
        </Section>

        {/* Plugins */}
        <Section title="PLUGINS (6)">
          <div className="space-y-6">
            <div>
              <h3 className="mono text-sm font-bold text-[var(--text)] mb-3">Polymarket Extended — 8 actions</h3>
              <Table
                headers={["Action", "Description"]}
                rows={[
                  ["POLYMARKET_PLACE_ORDER", "Buy with smart market search, token resolution, order book pricing"],
                  ["POLYMARKET_SELL", "Sell at best bid (fallback to curPrice × 0.95 on thin books)"],
                  ["POLYMARKET_CANCEL_ORDER", "Cancel a specific order by ID"],
                  ["POLYMARKET_CANCEL_ALL", "Cancel all open orders"],
                  ["POLYMARKET_GET_ORDERS", "List open orders with fill status"],
                  ["POLYMARKET_GET_POSITIONS", "Show positions with live PnL"],
                  ["POLYMARKET_GET_TRADES", "Show recent trade history with tx hashes"],
                  ["POLYMARKET_GET_PNL", "Portfolio value and unrealized P&L"],
                ]}
              />
              <div className="mt-2 mono text-[11px] text-[var(--text-muted)]">
                Chain: Polygon | Auth: HMAC-SHA256 CLOB API | Buys &amp; sells bypass LLM in autonomy mode
              </div>
            </div>

            <div>
              <h3 className="mono text-sm font-bold text-[var(--text)] mb-3">Jupiter Prediction — 5 actions</h3>
              <Table
                headers={["Action", "Description"]}
                rows={[
                  ["SCAN_JUPITER_MARKETS", "Scan live Solana prediction markets with scoring"],
                  ["PLACE_JUPITER_BET", "Place a bet (signed Solana VersionedTransaction)"],
                  ["CHECK_JUPITER_POSITIONS", "Check positions with PnL"],
                  ["SELL_JUPITER_POSITION", "Close position via DELETE /positions/{pubkey}"],
                  ["CLAIM_JUPITER_WINNINGS", "Claim settled positions after resolution"],
                ]}
              />
              <div className="mt-2 mono text-[11px] text-[var(--text-muted)]">
                Chain: Solana | Auth: Jupiter API key + Ed25519 keypair | Full position closure only (no partial sells)
              </div>
            </div>

            <div>
              <h3 className="mono text-sm font-bold text-[var(--text)] mb-3">x402 Solana — auto-pay protocol</h3>
              <p className="text-[13px] text-[var(--text-secondary)] leading-relaxed">
                Wraps <code className="mono text-[var(--accent)]">globalThis.fetch</code> to detect HTTP 402 responses. Auto-signs Solana USDC payment and retries.
                Supports mainnet + devnet. Configurable per-request cap (default $0.10). Payment stats visible in x402 dashboard modal.
              </p>
            </div>

            <div>
              <h3 className="mono text-sm font-bold text-[var(--text)] mb-3">RAG Pipeline — ChromaDB</h3>
              <p className="text-[13px] text-[var(--text-secondary)] leading-relaxed">
                Indexes top 20 markets from each platform into ChromaDB vectors every cycle. Computes similarity scores
                to adjust market rankings ±10%. Caches news articles for future retrieval. Enriches LLM analysis with
                similar markets + relevant news + web search context.
              </p>
            </div>

            <div>
              <h3 className="mono text-sm font-bold text-[var(--text)] mb-3">Connectors — News + Search</h3>
              <p className="text-[13px] text-[var(--text-secondary)] leading-relaxed">
                NewsAPI fetches market-relevant articles by extracted keywords. Tavily provides web search for broader context.
                Combined context injected into LLM analysis prompts. Results cached per cycle to avoid duplicate API calls.
              </p>
            </div>
          </div>
        </Section>

        {/* Heartbeat */}
        <Section title="HEARTBEAT PROTOCOL">
          <p className="text-[13px] text-[var(--text-secondary)] mb-4 leading-relaxed">
            Polymarket GTC orders require a heartbeat every 10 seconds. If it stops, all orders auto-cancel.
            Only active in ALL and POLY modes (not JUP+x402).
          </p>
          <div className="bg-[var(--bg-card)] border border-[var(--border)] rounded-lg p-5 mono text-[12px] text-[var(--text-secondary)] leading-loose">
            <div className="text-[var(--accent)] font-bold mb-2">SESSION LIFECYCLE:</div>
            <div>1. <span className="text-[var(--text)]">START</span> — Autonomy ON resets heartbeat, sends first signal with null ID</div>
            <div>2. <span className="text-[var(--text)]">CREATE</span> — Polymarket responds with heartbeat_id</div>
            <div>3. <span className="text-[var(--text)]">CHAIN</span> — Every 10s, send back the same heartbeat_id</div>
            <div>4. <span className="text-[var(--text)]">RECOVER</span> — Stale ID? Auto-reset and create new session</div>
            <div>5. <span className="text-[var(--red)]">ALERT</span> — After 5 consecutive failures: ⚠️ GTC orders at risk!</div>
            <div>6. <span className="text-[var(--red)]">STOP</span> — Autonomy OFF clears timer, orders auto-cancel</div>
          </div>
        </Section>

        {/* Configuration */}
        <Section title="CONFIGURATION">
          <p className="text-[13px] text-[var(--text-secondary)] mb-4 leading-relaxed">
            All trading constants are configurable via environment variables with sensible defaults.
          </p>
          <Table
            headers={["Variable", "Default", "Description"]}
            rows={[
              ["MAX_POSITIONS", "50", "Maximum open positions across all platforms"],
              ["MIN_BET_SIZE_USD", "3", "Minimum bet size in USD"],
              ["MAX_BET_SIZE_USD", "6", "Maximum bet size in USD"],
              ["SELL_LOSS_THRESHOLD_NORMAL", "-15", "Normal loss cutoff (%)"],
              ["SELL_LOSS_THRESHOLD_AGGRESSIVE", "-5", "Low-balance loss cutoff (%)"],
              ["SELL_PROFIT_THRESHOLD_NORMAL", "25", "Normal profit taking (%)"],
              ["SELL_PROFIT_THRESHOLD_AGGRESSIVE", "5", "Low-balance profit taking (%)"],
              ["LOW_BALANCE_THRESHOLD", "3", "USD below which aggressive mode activates"],
              ["AUTONOMY_INTERVAL_MS", "60000", "Cycle interval in milliseconds"],
              ["HEARTBEAT_INTERVAL_MS", "10000", "Heartbeat signal interval"],
              ["DAILY_SPEND_LIMIT_USD", "0", "Daily spend cap (0 = unlimited)"],
              ["WS_AUTH_TOKEN", "", "Optional WebSocket auth token"],
              ["MAX_RETRIES", "3", "API retry attempts with exponential backoff"],
            ]}
          />
        </Section>

        {/* FAQ */}
        <Section title="FAQ">
          <div className="space-y-4">
            {[
              {
                q: "How does the agent decide YES or NO?",
                a: "The LLM analyzes the top 5 scored markets using a structured PICK/SIDE/REASON format, enriched with news, web search, and ChromaDB similarity context. If parsing fails, a simpler YES/NO prompt is tried. If that also fails, a price-based heuristic is used (YES if price < $0.50).",
              },
              {
                q: "Why does Jupiter show 0 new markets?",
                a: "Jupiter filters markets by price ($0.02–$0.98), volume (> $0.50), and owned positions. The scan diagnostics show exactly why: [JUPITER:SCAN] 270 scanned, filtered: price=40, volume=8, owned=5. When 0 pass, the agent reviews existing positions for sell opportunities instead.",
              },
              {
                q: "How do sells work in autonomy mode?",
                a: "Polymarket sells use directPolymarketSell() — fetches order book best bid, places SELL order via CLOB API. If bid is < $0.03, falls back to curPrice × 0.95. Jupiter sells call closePosition() directly. Both bypass LLM routing for reliable execution.",
              },
              {
                q: "How do buys work in autonomy mode?",
                a: "Polymarket buys use directPolymarketBuy() — searches market by name, resolves YES/NO token, gets best ask from order book, places BUY order via CLOB API. Jupiter buys go through sendPrompt → PLACE_JUPITER_BET action → signed Solana transaction.",
              },
              {
                q: "What happens if the agent crashes?",
                a: "The Polymarket heartbeat stops and all GTC orders auto-cancel within 10 seconds. Positions remain intact. On restart, the agent picks up where it left off.",
              },
              {
                q: "Can I run just one platform?",
                a: "Yes. Click POLY for Polymarket only (no Jupiter scanning, no x402 payments) or JUP+x402 for Jupiter only (no Polymarket scanning, no heartbeat). Click ALL to run both in parallel.",
              },
              {
                q: "What is the daily spend limit?",
                a: "Set DAILY_SPEND_LIMIT_USD to cap how much the agent can spend per day. Default is 0 (unlimited). Resets at midnight. The agent logs [SPEND] Today: $12/$50 each cycle when a limit is set.",
              },
              {
                q: "What is x402?",
                a: "x402 is a payment protocol that wraps HTTP requests. When an API returns 402 Payment Required, x402 auto-signs a Solana USDC transaction and retries. Used for paid Jupiter API calls. Cap: $0.10/request, configurable via X402_MAX_PAYMENT_USD.",
              },
              {
                q: "What does RAG do?",
                a: "The RAG (Retrieval-Augmented Generation) pipeline indexes markets into ChromaDB vectors each cycle. It computes similarity scores to adjust market rankings, fetches news and web search context, and injects all of this into the LLM analysis prompt for better predictions.",
              },
              {
                q: "Why does [P&L] show negative after buying?",
                a: "The P&L tracks balance delta between cycles. Buying $3 of shares reduces your USDC balance by $3, showing as -$3 in P&L. The position value isn't counted until it's sold or the market resolves.",
              },
            ].map((item, i) => (
              <div key={i} className="p-4 bg-[var(--bg-card)] border border-[var(--border)] rounded-lg">
                <div className="mono text-[13px] font-bold text-[var(--text)] mb-2">{item.q}</div>
                <p className="text-[13px] text-[var(--text-secondary)] leading-relaxed">{item.a}</p>
              </div>
            ))}
          </div>
        </Section>

        {/* Tech Stack */}
        <Section title="TECH STACK">
          <Table
            headers={["Component", "Technology"]}
            rows={[
              ["Runtime", "elizaOS 2.0"],
              ["Language", "TypeScript"],
              ["Server", "Bun"],
              ["Frontend", "Next.js 15, React 19, Tailwind CSS 4, Framer Motion"],
              ["Polymarket", "@polymarket/clob-client, CLOB REST API, Data API"],
              ["Jupiter", "Jupiter Prediction API (api.jup.ag/prediction/v1)"],
              ["x402", "@x402/fetch, @x402/svm, @x402/core"],
              ["RAG", "ChromaDB + OpenAI text-embedding-3-small"],
              ["News/Search", "NewsAPI + Tavily"],
              ["Wallets", "ethers.js (Polygon), @solana/web3.js (Solana)"],
              ["Validation", "Zod"],
              ["Testing", "bun:test (131 tests)"],
            ]}
          />
        </Section>

        {/* Footer */}
        <div className="border-t border-[var(--border)] pt-6 mt-10 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <span className="mono text-[11px] text-[var(--text-muted)]">ElizaBAO — Built on elizaOS</span>
          </div>
          <div className="flex items-center gap-4 mono text-[11px]">
            <a href="https://x.com/elizabao_ai" target="_blank" rel="noopener noreferrer" className="text-[var(--text-muted)] hover:text-[var(--accent)] transition-colors">Twitter</a>
            <a href="https://github.com/elizabaoxyz/polymarket-agent" target="_blank" rel="noopener noreferrer" className="text-[var(--text-muted)] hover:text-[var(--accent)] transition-colors">GitHub</a>
          </div>
        </div>
      </main>
    </div>
  );
}
