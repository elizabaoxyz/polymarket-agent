"use client";

import { ArrowLeft, Zap, Bot, TrendingUp, TrendingDown, Shield, CreditCard, Heart, RefreshCw } from "lucide-react";
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
          <img src="/elizabaobao.png" alt="ElizaBAO" className="w-6 h-6 rounded-full object-cover" />
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
            accessing paid APIs.
          </p>
        </div>

        {/* Getting Started */}
        <Section title="GETTING STARTED">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <Card
              icon={<Bot size={18} className="text-[var(--green)]" />}
              title="Chat with the Agent"
              description="Type in the chat to interact with ElizaBAO. Ask it to scan markets, place bets, check positions, or show your PnL. The agent understands natural language."
            />
            <Card
              icon={<Zap size={18} className="text-[var(--green)]" />}
              title="Enable Autonomy"
              description="Click 'AUTONOMY OFF' in the header to start autonomous trading. The agent will scan, analyze, buy, and sell every 60 seconds across both platforms."
            />
            <Card
              icon={<TrendingUp size={18} className="text-[var(--green)]" />}
              title="Monitor Positions"
              description="Use the PORTFOLIO tab in the left sidebar to see your open positions, PnL, and balances on both Polymarket (Polygon) and Jupiter (Solana)."
            />
            <Card
              icon={<CreditCard size={18} className="text-[var(--green)]" />}
              title="x402 Payments"
              description="The x402 badge shows payment protocol status. When active, the agent auto-pays for premium Jupiter/Solana API calls using USDC on Solana."
            />
          </div>
        </Section>

        {/* Chat Commands */}
        <Section title="CHAT COMMANDS">
          <p className="text-[13px] text-[var(--text-secondary)] mb-4">
            You can type natural language commands in the chat. The agent routes to the correct action automatically.
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
              ["Jupiter bet", "\"bet $3 YES on jupiter market POLY-123\"", "Jupiter"],
              ["Jupiter positions", "\"show my jupiter positions\"", "Jupiter"],
              ["Sell Jupiter", "\"sell my jupiter position on market POLY-123\"", "Jupiter"],
              ["Claim winnings", "\"claim my jupiter winnings\"", "Jupiter"],
            ]}
          />
        </Section>

        {/* Autonomous Trading */}
        <Section title="AUTONOMOUS TRADING">
          <p className="text-[13px] text-[var(--text-secondary)] mb-4 leading-relaxed">
            When autonomy is enabled, the agent runs an infinite loop every 60 seconds, alternating between
            Polymarket (odd cycles) and Jupiter (even cycles).
          </p>

          <div className="bg-[var(--bg-card)] border border-[var(--border)] rounded-lg p-5 mb-6 mono text-[12px] text-[var(--text-secondary)] leading-loose">
            <div className="text-[var(--accent)] font-bold mb-2">CYCLE FLOW:</div>
            <div>1. <span className="text-[var(--red)]">SELL</span> — LLM analyzes positions hitting thresholds (-15% loss / +25% profit). Can say HOLD to override.</div>
            <div>2. <span className="text-[var(--text)]">SCAN</span> — Fetch 500+ markets, filter by price, spread, volume, time, liquidity</div>
            <div>3. <span className="text-[var(--accent)]">ANALYZE</span> — LLM reviews top 5 candidates, picks market + YES/NO side with reasoning</div>
            <div>4. <span className="text-[var(--green)]">BUY</span> — Place $3-$6 bet based on conviction score and balance</div>
            <div>5. <span className="text-[var(--text-muted)]">SKIP</span> — Dead positions (&le;-95%), failed sells/buys, and recently sold positions are skipped</div>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <Card
              icon={<TrendingDown size={18} className="text-[var(--red)]" />}
              title="Smart Selling"
              description="Positions down >15% or up >25% are sent to the LLM for review. The LLM can override and say HOLD if the market outlook is favorable. Dead positions at -95% or worse are auto-skipped (unsellable)."
            />
            <Card
              icon={<RefreshCw size={18} className="text-[var(--green)]" />}
              title="Alternating Platforms"
              description="Odd cycles trade on Polymarket (Polygon). Even cycles trade on Jupiter (Solana). x402 payments only trigger when there are markets to buy — no wasted payments."
            />
            <Card
              icon={<Shield size={18} className="text-[var(--green)]" />}
              title="Safety Guards"
              description="Minimum $3 bets, max 50 positions, 10-minute hold before selling, no sells below $0.05, 5-minute trade cooldown, failed operations skipped for 30 minutes."
            />
            <Card
              icon={<Heart size={18} className="text-[var(--red)]" />}
              title="Heartbeat Protocol"
              description="Sends a signal to Polymarket every 10 seconds to keep GTC orders alive. If the agent stops, orders auto-cancel to protect your funds."
            />
          </div>
        </Section>

        {/* Scoring Algorithm */}
        <Section title="SCORING ALGORITHM">
          <p className="text-[13px] text-[var(--text-secondary)] mb-4 leading-relaxed">
            Each market is scored 0-1 using weighted factors. Only high-quality opportunities get bets.
          </p>
          <Table
            headers={["Factor", "Weight", "Formula", "Why"]}
            rows={[
              ["Spread", "35%", "1 - (spread / 0.15)", "Tighter spread = less slippage"],
              ["Midpoint", "30%", "1 - |midpoint - 0.5| x 2", "50/50 markets = most opportunity"],
              ["Time", "20%", "min(1, daysLeft / 30)", "30+ days to play out"],
              ["Volume", "15%", "min(1, vol / threshold)", "Higher volume = reliable pricing"],
            ]}
          />
          <div className="mt-4 p-4 bg-[var(--bg-card)] border border-[var(--border)] rounded-lg">
            <div className="mono text-[12px] text-[var(--text-secondary)]">
              <span className="text-[var(--accent)] font-bold">Position Sizing:</span>{" "}
              Score &gt; 0.9 = $6 (or 10% balance) | Score &gt; 0.7 = $4.50 (or 8%) | Score &le; 0.7 = $3 (or 5%)
            </div>
          </div>
        </Section>

        {/* Plugins */}
        <Section title="PLUGINS">
          <div className="space-y-4">
            <div>
              <h3 className="mono text-sm font-bold text-[var(--text)] mb-3">Polymarket Extended (8 actions)</h3>
              <Table
                headers={["Action", "Description"]}
                rows={[
                  ["POLYMARKET_PLACE_ORDER", "Buy/sell with smart market search and token resolution"],
                  ["POLYMARKET_SELL", "Sell shares at best bid price from order book"],
                  ["POLYMARKET_CANCEL_ORDER", "Cancel a specific order by ID"],
                  ["POLYMARKET_CANCEL_ALL", "Cancel all open orders"],
                  ["POLYMARKET_GET_ORDERS", "List open orders"],
                  ["POLYMARKET_GET_POSITIONS", "Show portfolio positions with PnL"],
                  ["POLYMARKET_GET_TRADES", "Show recent trade history"],
                  ["POLYMARKET_GET_PNL", "Show profit/loss summary"],
                ]}
              />
              <div className="mt-2 mono text-[11px] text-[var(--text-muted)]">Chain: Polygon | Auth: CLOB API keys + EVM wallet | Signature: POLY_PROXY (type 1)</div>
            </div>

            <div>
              <h3 className="mono text-sm font-bold text-[var(--text)] mb-3">Jupiter Prediction (5 actions)</h3>
              <Table
                headers={["Action", "Description"]}
                rows={[
                  ["SCAN_JUPITER_MARKETS", "Scan live Solana prediction markets"],
                  ["PLACE_JUPITER_BET", "Place a bet on a Jupiter market"],
                  ["CHECK_JUPITER_POSITIONS", "Check positions and PnL"],
                  ["SELL_JUPITER_POSITION", "Sell/close a position by market ID"],
                  ["CLAIM_JUPITER_WINNINGS", "Claim settled positions after resolution"],
                ]}
              />
              <div className="mt-2 mono text-[11px] text-[var(--text-muted)]">Chain: Solana | Auth: Jupiter API key + Solana wallet</div>
            </div>

            <div>
              <h3 className="mono text-sm font-bold text-[var(--text)] mb-3">x402 Solana (auto-pay protocol)</h3>
              <p className="text-[13px] text-[var(--text-secondary)] leading-relaxed">
                Wraps all HTTP calls to detect 402 Payment Required responses. When a paid API responds with 402,
                x402 automatically signs a Solana USDC payment transaction and retries. Cost: $0.01/prediction,
                $0.02/analysis. Maximum $0.10 per request. Payments only trigger during Jupiter cycles when there
                are markets available to buy — no wasted spending on empty scans.
              </p>
            </div>
          </div>
        </Section>

        {/* Heartbeat */}
        <Section title="HEARTBEAT PROTOCOL">
          <p className="text-[13px] text-[var(--text-secondary)] mb-4 leading-relaxed">
            Polymarket requires a heartbeat signal every 10 seconds to keep GTC (Good-Til-Cancelled) limit orders alive.
            If the heartbeat stops, all open orders are automatically cancelled.
          </p>
          <div className="bg-[var(--bg-card)] border border-[var(--border)] rounded-lg p-5 mono text-[12px] text-[var(--text-secondary)] leading-loose">
            <div className="text-[var(--accent)] font-bold mb-2">SESSION LIFECYCLE:</div>
            <div>1. <span className="text-[var(--text)]">START</span> — Autonomy ON resets heartbeat, sends first signal with null ID</div>
            <div>2. <span className="text-[var(--text)]">CREATE</span> — Polymarket responds with a heartbeat_id string</div>
            <div>3. <span className="text-[var(--text)]">CHAIN</span> — Every 10s, send back the same heartbeat_id</div>
            <div>4. <span className="text-[var(--text)]">RECOVER</span> — If ID is stale, auto-reset and create new session</div>
            <div>5. <span className="text-[var(--red)]">STOP</span> — Autonomy OFF clears timer, orders auto-cancel</div>
          </div>
        </Section>

        {/* FAQ */}
        <Section title="FAQ">
          <div className="space-y-4">
            {[
              {
                q: "How does the agent decide YES or NO?",
                a: "The LLM analyzes the market question considering current events, probability, and expected value. For multiple candidates, it uses a structured PICK/SIDE/REASON format. For single candidates, it asks a simple YES/NO question. If neither works, it tries a fallback prompt. The agent never bets blindly on price alone.",
              },
              {
                q: "Why does Jupiter show 0 new markets?",
                a: "Jupiter Prediction Markets is a newer product with ~10 events total. If you already own positions in most events, the dedup filter skips them. Failed buy attempts (no liquidity) are also skipped for 30 minutes. Your Solana balance stays safe until new events appear.",
              },
              {
                q: "What happens if the agent crashes?",
                a: "The Polymarket heartbeat stops, and all open GTC orders are automatically cancelled within 10 seconds. Your positions remain — only unfilled orders are cancelled.",
              },
              {
                q: "Can I chat while autonomy is running?",
                a: "Yes. The chat and autonomy run independently. You can place manual trades, check positions, or ask questions while the autonomous loop runs in the background.",
              },
              {
                q: "What is x402?",
                a: "x402 is a payment protocol that wraps HTTP requests. When an API returns a 402 Payment Required response, x402 automatically signs a Solana USDC payment and retries the request. It's used for paid Jupiter/Solana API calls. Payments only trigger when the agent has markets to buy — no wasted spending.",
              },
              {
                q: "How much does the agent bet?",
                a: "Minimum $3 per bet on both platforms. Maximum $6 for high-conviction bets (score > 0.9). The agent never bets more than 10% of available balance on a single trade. If balance drops below $3, it waits for sells to replenish.",
              },
              {
                q: "What happens to positions at -100% loss?",
                a: "Positions at -95% or worse are automatically skipped — there are no buyers and attempting to sell would fail. These positions are effectively dead and will either settle at $0 or need to be claimed if the market resolves in your favor.",
              },
              {
                q: "Why did the agent sell then immediately re-sell?",
                a: "This was a bug that's now fixed. Successfully sold positions are tracked to prevent double-sells caused by API lag. Failed sell attempts are also tracked and skipped for 30 minutes before retrying.",
              },
            ].map((item, i) => (
              <div key={i} className="p-4 bg-[var(--bg-card)] border border-[var(--border)] rounded-lg">
                <div className="mono text-[13px] font-bold text-[var(--text)] mb-2">{item.q}</div>
                <p className="text-[13px] text-[var(--text-secondary)] leading-relaxed">{item.a}</p>
              </div>
            ))}
          </div>
        </Section>

        {/* Footer */}
        <div className="border-t border-[var(--border)] pt-6 mt-10 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <img src="/elizabaobao.png" alt="ElizaBAO" className="w-5 h-5 rounded-full object-cover" />
            <span className="mono text-[11px] text-[var(--text-muted)]">Built on elizaOS</span>
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
