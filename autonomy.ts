/**
 * Autonomy loop — extracted from ws-server.ts.
 * Manages the autonomous trading cycle across Polymarket and Jupiter.
 */

import type { AgentRuntime, Content } from "@elizaos/core";
import { createMessageMemory, stringToUuid, ChannelType } from "@elizaos/core";
import { v4 as uuidv4 } from "uuid";

import {
  MAX_POSITIONS,
  LOW_BALANCE_THRESHOLD,
  SELL_LOSS_THRESHOLD_NORMAL,
  SELL_LOSS_THRESHOLD_AGGRESSIVE,
  SELL_PROFIT_THRESHOLD_NORMAL,
  SELL_PROFIT_THRESHOLD_AGGRESSIVE,
  AUTONOMY_INTERVAL_MS,
  HEARTBEAT_INTERVAL_MS,
  FAILED_SELL_COOLDOWN_MS,
  FAILED_BUY_COOLDOWN_MS,
  POSITION_MIN_AGE_MS,
  SAME_MARKET_COOLDOWN_MS,
  MAX_TRADE_HISTORY,
  SCORE_SPREAD_WEIGHT,
  SCORE_MIDPOINT_WEIGHT,
  SCORE_TIME_WEIGHT,
  SCORE_VOLUME_WEIGHT,
  SCORE_MOMENTUM_WEIGHT,
  SCORE_DEPTH_WEIGHT,
  MIN_DEPTH_USD,
  CONTRARIAN_BONUS,
  RAG_SIMILARITY_WEIGHT,
  DAILY_SPEND_LIMIT_USD,
  HEARTBEAT_MAX_FAILURES,
  calcBetSize,
} from "./config";
import { withRetry } from "./retry";
import { AsyncMutex } from "./mutex";
import { getSolanaKeypair, getCachedSolanaBalanceBreakdown } from "./solana-wallet";
import { getPortfolioStatus } from "./portfolio";
import { PolymarketExtService } from "./plugins/polymarket-ext/service";
import { POLYMARKET_EXT_SERVICE_TYPE } from "./plugins/polymarket-ext/types";
import { JupiterPredictionService, JUPITER_SERVICE_TYPE } from "./plugins/jupiter-prediction/service";
import { X402SolanaService } from "./plugins/x402-solana/service";
import { X402_SERVICE_TYPE } from "./plugins/x402-solana/types";
import type { RAGService } from "./plugins/rag/service";
import type { ConnectorsService } from "./plugins/connectors/service";
import type { MarketDocument, NewsDocument } from "./plugins/rag/types";
import {
  type MarketIntel,
  type PriceTrend,
  type DepthInfo,
  gatherPolyIntel,
  gatherJupIntel,
  fetchPolyPriceHistory,
  computePriceTrend,
  fetchPolyDepth,
  fetchJupDepth,
  formatIntelForPrompt,
  detectContrarian,
} from "./market-intel";

// --- Types ---

export type AutonomyDeps = {
  runtime: AgentRuntime;
  messageService: { handleMessage: (...args: unknown[]) => Promise<unknown> };
  roomId: ReturnType<typeof stringToUuid>;
  userId: ReturnType<typeof stringToUuid>;
  ragSvc: RAGService | null;
  connectorsSvc: ConnectorsService | null;
  runtimeMutex: AsyncMutex;
};

export type AutonomyCallbacks = {
  send: (msg: Record<string, unknown>) => void;
  log: (text: string) => void;
};

export type AutonomyPlatform = "both" | "polymarket" | "jupiter";

export type AutonomyHandle = {
  stop: () => void;
  readonly isRunning: boolean;
  readonly platform: AutonomyPlatform;
};

type TradeHistoryEntry = { question: string; platform: string; time: number; price: number; amount: number };

// --- Internal state ---

type AutonomyState = {
  platform: AutonomyPlatform;
  cycleCount: number;
  tradeHistory: TradeHistoryEntry[];
  failedSells: Map<string, number>;
  failedBuys: Map<string, number>;
  recentlySold: Map<string, number>;  // token/pubkey → timestamp (auto-expires)
  dailySpend: number;                 // USD spent today
  dailySpendResetAt: number;          // timestamp of next daily reset
  prevPolyBalance: number;            // for P&L tracking
  prevSolBalance: number;
  /** Cache enrichment context per cycle to avoid duplicate API calls */
  cycleEnrichCache: Map<string, string>;
  /** Timestamp until which Jupiter buys should be paused (insufficient funds cooldown) */
  jupBuyPausedUntil: number;
  /** Questions recently sold — don't re-buy (auto-expires) */
  recentlySoldQuestions: Map<string, number>;
  /** Questions currently being bought (parallel dedup within a cycle) */
  pendingBuys: Set<string>;
};

function createState(platform: AutonomyPlatform): AutonomyState {
  const now = new Date();
  const tomorrow = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1);
  return {
    platform,
    cycleCount: 0,
    tradeHistory: [],
    failedSells: new Map(),
    failedBuys: new Map(),
    recentlySold: new Map(),
    dailySpend: 0,
    dailySpendResetAt: tomorrow.getTime(),
    prevPolyBalance: -1,
    prevSolBalance: -1,
    cycleEnrichCache: new Map(),
    jupBuyPausedUntil: 0,
    recentlySoldQuestions: new Map(),
    pendingBuys: new Set(),
  };
}

/**
 * Housekeeping — clean up expired entries from maps/sets.
 * Called at the start of each cycle to prevent unbounded growth.
 */
function housekeep(state: AutonomyState): void {
  const now = Date.now();

  // Expire recentlySold entries older than FAILED_SELL_COOLDOWN_MS
  for (const [key, ts] of state.recentlySold) {
    if (now - ts >= FAILED_SELL_COOLDOWN_MS) state.recentlySold.delete(key);
  }

  // Expire recentlySoldQuestions older than 24 hours (matches SAME_MARKET_COOLDOWN_MS)
  for (const [key, ts] of state.recentlySoldQuestions) {
    if (now - ts >= 86_400_000) state.recentlySoldQuestions.delete(key);
  }

  // Expire failedSells entries older than 2× cooldown (fully stale)
  for (const [key, ts] of state.failedSells) {
    if (now - ts >= FAILED_SELL_COOLDOWN_MS * 2) state.failedSells.delete(key);
  }

  // Expire failedBuys entries older than 2× cooldown
  for (const [key, ts] of state.failedBuys) {
    if (now - ts >= FAILED_BUY_COOLDOWN_MS * 2) state.failedBuys.delete(key);
  }

  // Reset daily spend at midnight
  if (now >= state.dailySpendResetAt) {
    state.dailySpend = 0;
    const tomorrow = new Date();
    tomorrow.setHours(24, 0, 0, 0);
    state.dailySpendResetAt = tomorrow.getTime();
  }

  // Clear per-cycle caches
  state.cycleEnrichCache.clear();
  state.pendingBuys.clear();
}

/**
 * Check if daily spend limit allows a purchase.
 */
function canSpend(state: AutonomyState, amount: number): boolean {
  if (DAILY_SPEND_LIMIT_USD <= 0) return true; // no limit
  return state.dailySpend + amount <= DAILY_SPEND_LIMIT_USD;
}

function recordSpend(state: AutonomyState, amount: number): void {
  state.dailySpend += amount;
}

// --- Helpers ---

async function sendPrompt(
  deps: AutonomyDeps,
  callbacks: AutonomyCallbacks,
  prompt: string,
): Promise<string[]> {
  const results: string[] = [];
  const mem = createMessageMemory({
    id: uuidv4() as ReturnType<typeof stringToUuid>,
    entityId: deps.userId,
    roomId: deps.roomId,
    content: { text: prompt, source: "web-chat", channelType: ChannelType.DM },
  });
  try {
    await deps.runtimeMutex.runExclusive(async () => {
      await deps.messageService.handleMessage(
        deps.runtime,
        mem,
        async (content: Content) => {
          if (typeof content.text === "string" && content.text.trim()) {
            results.push(content.text.trim());
            callbacks.send({ type: "action_result", text: content.text.trim() });
          }
          return [];
        },
        {} as never,
      );
    });
  } catch (err) {
    const errMsg = err instanceof Error ? err.message : String(err);
    callbacks.send({ type: "action_result", text: `[ERROR] ${errMsg}` });
  }
  return results;
}

/**
 * Call the LLM directly via runtime.useModel() — bypasses elizaOS message handler
 * and action routing. Use this for analysis-only prompts where we don't want the
 * LLM to trigger actions like POLYMARKET_PLACE_ORDER.
 */
/**
 * Call the LLM for analysis via direct HTTP — bypasses elizaOS message handler
 * entirely. The message handler routes prompts through action selection which
 * swallows the text response. Direct HTTP to the provider API is the only
 * reliable way to get text back for analysis.
 */
async function directLlmCall(
  deps: AutonomyDeps,
  callbacks: AutonomyCallbacks,
  prompt: string,
  maxTokens = 1000,
): Promise<string> {
  // Try direct HTTP to the LLM provider API
  try {
    const text = await callLlmDirect(prompt, maxTokens);
    if (text.length > 0) return text;
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    callbacks.log(`[LLM] Direct API error: ${msg}`);
  }

  // Fallback to sendPrompt (works for some providers/prompts)
  const results = await sendPrompt(deps, callbacks, prompt);
  const text = results.join(" ").trim();
  if (text.length === 0) {
    callbacks.log(`[LLM] Empty response for: ${prompt.slice(0, 60)}...`);
  }
  return text;
}

/**
 * Direct HTTP call to the LLM provider, bypassing elizaOS entirely.
 * Supports Anthropic-compatible (GLM, Claude) and OpenAI-compatible APIs.
 */
async function callLlmDirect(prompt: string, maxTokens: number): Promise<string> {
  // Determine provider and credentials from env
  const glmKey = process.env.GLM_API_KEY?.trim();
  const anthropicKey = process.env.ANTHROPIC_API_KEY?.trim();
  const openaiKey = process.env.OPENAI_API_KEY?.trim();

  // Anthropic-compatible (GLM Coding Plan or native Anthropic)
  if (glmKey || anthropicKey) {
    const apiKey = glmKey || anthropicKey!;
    const baseUrl = glmKey
      ? "https://api.z.ai/api/anthropic"
      : (process.env.ANTHROPIC_BASE_URL?.trim() || "https://api.anthropic.com");
    const model = glmKey
      ? (process.env.GLM_LARGE_MODEL?.trim() || "glm-4.7")
      : (process.env.ANTHROPIC_LARGE_MODEL?.trim() || process.env.LARGE_MODEL?.trim() || "claude-sonnet-4-20250514");

    const res = await fetch(`${baseUrl}/v1/messages`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": apiKey,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model,
        max_tokens: maxTokens,
        temperature: 0.3,
        messages: [{ role: "user", content: prompt }],
      }),
    });

    if (!res.ok) {
      const errText = await res.text().catch(() => "");
      throw new Error(`Anthropic API ${res.status}: ${errText.slice(0, 200)}`);
    }

    const data = await res.json() as { content?: Array<{ type: string; text?: string }> };
    const textBlock = data.content?.find((b) => b.type === "text");
    return textBlock?.text?.trim() ?? "";
  }

  // OpenAI-compatible
  if (openaiKey) {
    const baseUrl = process.env.OPENAI_BASE_URL?.trim() || "https://api.openai.com/v1";
    const model = process.env.OPENAI_LARGE_MODEL?.trim() || process.env.LARGE_MODEL?.trim() || "gpt-4o";

    const res = await fetch(`${baseUrl}/chat/completions`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${openaiKey}`,
      },
      body: JSON.stringify({
        model,
        max_tokens: maxTokens,
        temperature: 0.3,
        messages: [{ role: "user", content: prompt }],
      }),
    });

    if (!res.ok) {
      const errText = await res.text().catch(() => "");
      throw new Error(`OpenAI API ${res.status}: ${errText.slice(0, 200)}`);
    }

    const data = await res.json() as { choices?: Array<{ message?: { content?: string } }> };
    return data.choices?.[0]?.message?.content?.trim() ?? "";
  }

  throw new Error("No LLM API key configured (GLM_API_KEY, ANTHROPIC_API_KEY, or OPENAI_API_KEY)");
}

function isRecentlyTraded(state: AutonomyState, question: string): boolean {
  const q = question.toLowerCase();
  return state.tradeHistory.some(
    (h) => h.question.toLowerCase() === q && Date.now() - h.time < SAME_MARKET_COOLDOWN_MS,
  );
}

function isFailCooledDown(failMap: Map<string, number>, key: string, cooldownMs: number): boolean {
  const failTime = failMap.get(key);
  return !failTime || Date.now() - failTime >= cooldownMs;
}

function recordTrade(state: AutonomyState, entry: TradeHistoryEntry): void {
  state.tradeHistory.push(entry);
  while (state.tradeHistory.length > MAX_TRADE_HISTORY) state.tradeHistory.shift();
}

// --- Direct sell via CLOB API (bypasses LLM) ---

async function directPolymarketSell(
  deps: AutonomyDeps,
  callbacks: AutonomyCallbacks,
  state: AutonomyState,
  token: string,
  shares: number,
  title: string,
  positionCurPrice?: number,
): Promise<boolean> {
  try {
    const extSvc = (await deps.runtime.getServiceLoadPromise(
      POLYMARKET_EXT_SERVICE_TYPE,
    )) as unknown as PolymarketExtService;
    if (!extSvc?.isFullyActive()) {
      callbacks.log(`[SELL:POLYMARKET] ❌ CLOB not active — cannot sell`);
      state.failedSells.set(token, Date.now());
      return false;
    }

    // Get best bid price from order book
    let price = 0;
    try {
      const book = await extSvc.clob!.getOrderBook(token);
      if (book.bids.length > 0) {
        price = parseFloat(book.bids[0]!.price);
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      callbacks.log(`[SELL:POLYMARKET] Order book fetch failed for "${title}": ${msg}`);
      // Don't give up — try position curPrice as fallback
    }

    // If order book bid is garbage, use position's curPrice with a 5% discount
    // The Data API curPrice is the mid-market price and often more reliable than
    // a thin order book with only a $0.01 resting bid.
    if (price < 0.03 && positionCurPrice && positionCurPrice >= 0.05) {
      const fallbackPrice = Math.round(positionCurPrice * 0.95 * 100) / 100; // 5% discount, round to cents
      callbacks.log(
        `[SELL:POLYMARKET] Order book bid $${price.toFixed(4)} too low, using position price $${positionCurPrice.toFixed(2)} → sell at $${fallbackPrice.toFixed(2)}`,
      );
      price = fallbackPrice;
    }

    if (price < 0.01 || price > 0.99) {
      callbacks.log(`[SELL:POLYMARKET] ❌ "${title}" — price $${price.toFixed(4)} out of range, market closed/illiquid`);
      state.failedSells.set(token, Date.now());
      return false;
    }

    if (price < 0.03) {
      callbacks.log(`[SELL:POLYMARKET] ❌ "${title}" — price $${price.toFixed(4)}, near-zero, skipping`);
      state.failedSells.set(token, Date.now());
      return false;
    }

    // Polymarket requires minimum order size (usually 5 shares)
    // If we have fewer shares, we can't sell — mark as failed to avoid retrying
    if (shares < 5) {
      callbacks.log(`[SELL:POLYMARKET] ❌ "${title}" — only ${shares} shares (minimum 5). Position too small to sell.`);
      state.failedSells.set(token, Date.now());
      return false;
    }

    const result = await extSvc.sellOrder({ tokenId: token, price, size: shares });
    const total = (shares * price).toFixed(2);
    const statusIcon = result.status === "matched" ? "FILLED" : String(result.status).toUpperCase();
    const txInfo = result.transactionsHashes.length > 0
      ? ` | tx: ${result.transactionsHashes[0]!.slice(0, 10)}...`
      : "";
    callbacks.log(
      `[SELL:POLYMARKET] ✅ ${statusIcon}: "${title}" — ${shares} shares @ $${price.toFixed(2)} ($${total})${txInfo}`,
    );
    state.recentlySold.set(token, Date.now());
    state.recentlySoldQuestions.set(title.toLowerCase(), Date.now());
    return true;
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    callbacks.log(`[SELL:POLYMARKET] ❌ "${title}" — failed: ${msg}`);
    state.failedSells.set(token, Date.now());
    return false;
  }
}

// --- Direct Polymarket buy via CLOB API (bypasses LLM) ---

async function directPolymarketBuy(
  deps: AutonomyDeps,
  callbacks: AutonomyCallbacks,
  state: AutonomyState,
  question: string,
  side: string,
  betSize: number,
  availableBalance?: number,
): Promise<boolean> {
  // Dedup is handled by the caller (recordTrade before call) + scanner filtering.
  // No additional guard here — the previous check was blocking ALL buys because
  // recordTrade() is called BEFORE this function, so it always found a "duplicate".
  try {
    const extSvc = (await deps.runtime.getServiceLoadPromise(
      POLYMARKET_EXT_SERVICE_TYPE,
    )) as unknown as PolymarketExtService;
    if (!extSvc?.isFullyActive()) {
      callbacks.log(`[BUY:POLYMARKET] ❌ CLOB not active`);
      return false;
    }

    // Search for the market
    const markets = await extSvc.clob!.searchMarkets(question);
    if (markets.length === 0) {
      callbacks.log(`[BUY:POLYMARKET] ❌ No market found matching "${question.slice(0, 50)}"`);
      return false;
    }
    const market = markets[0]!;
    const outcome = side === "YES" ? "Yes" : "No";
    const token = market.tokens.find((t) => t.outcome.toLowerCase() === outcome.toLowerCase());
    if (!token) {
      callbacks.log(`[BUY:POLYMARKET] ❌ No ${outcome} token for "${market.question?.slice(0, 50)}"`);
      return false;
    }

    // IMPORTANT: Use mid-price (token.price) for limit orders, NOT the ask price.
    // The ask is often $0.99 on thin markets — buying there guarantees a 50% loss.
    // Instead, place a GTC limit bid at mid-price and wait for a fill.
    const askPrice = token.price; // default to mid
    let midPrice = token.price;
    try {
      const book = await extSvc.clob!.getOrderBook(token.token_id);
      const bestAsk = book.asks.length > 0 ? parseFloat(book.asks[0]!.price) : null;
      const bestBid = book.bids.length > 0 ? parseFloat(book.bids[0]!.price) : null;
      // Calculate true mid-price from order book
      if (bestAsk !== null && bestBid !== null) {
        midPrice = Math.round(((bestAsk + bestBid) / 2) * 100) / 100;
      } else if (bestAsk !== null) {
        midPrice = bestAsk; // fallback
      }
      // If ask is way above mid (>20% premium), always use mid-price with limit order
      if (bestAsk !== null && bestAsk > midPrice * 1.2) {
        callbacks.log(
          `[BUY:POLYMARKET] ⚠️ Ask $${bestAsk.toFixed(2)} is ${Math.round((bestAsk / midPrice - 1) * 100)}% above mid $${midPrice.toFixed(2)} — using limit bid at mid`,
        );
      }
    } catch {
      // Fall back to token.price
    }

    // Always use mid-price for the limit order
    let price = midPrice;
    if (price < 0.01 || price > 0.99) {
      callbacks.log(`[BUY:POLYMARKET] ❌ Price $${price.toFixed(4)} out of range`);
      return false;
    }

    // Calculate position size based on mid-price
    const size = Math.max(5, Math.floor(betSize / price));
    let totalCost = size * price;
    const balance = availableBalance ?? betSize * 2;
    if (totalCost > balance) {
      // Reduce price to fit budget, but never above mid-price
      const affordablePrice = Math.floor((balance / 5) * 100) / 100;
      if (affordablePrice < 0.01) {
        callbacks.log(`[BUY:POLYMARKET] ❌ Not enough balance: $${balance.toFixed(2)} — can't even afford 5 shares at $0.01`);
        return false;
      }
      price = Math.min(affordablePrice, midPrice);
      callbacks.log(
        `[BUY:POLYMARKET] 💡 Adjusting limit bid to $${price.toFixed(2)} (5 shares = $${(5 * price).toFixed(2)})`,
      );
    }

    const result = await extSvc.placeOrder({ tokenId: token.token_id, side: "BUY", price, size });
    const total = (size * price).toFixed(2);
    const statusIcon = result.status === "matched" ? "FILLED" : String(result.status).toUpperCase();
    const txInfo = result.transactionsHashes.length > 0
      ? ` | tx: ${result.transactionsHashes[0]!.slice(0, 10)}...`
      : "";
    callbacks.log(
      `[BUY:POLYMARKET] ✅ ${statusIcon}: ${size} ${outcome} shares of "${market.question?.slice(0, 60)}" @ $${price.toFixed(2)} ($${total})${txInfo}`,
    );
    recordSpend(state, Number(total));
    return true;
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    callbacks.log(`[BUY:POLYMARKET] ❌ "${question.slice(0, 50)}" — failed: ${msg}`);
    return false;
  }
}

// --- Direct Jupiter buy via API (bypasses LLM action routing) ---

async function directJupiterBuy(
  deps: AutonomyDeps,
  callbacks: AutonomyCallbacks,
  state: AutonomyState,
  marketId: string,
  side: string,
  betSize: number,
  question?: string,
  availableBalance?: number,
  usdcBalance?: number,
  jupUsdBalance?: number,
): Promise<boolean> {
  try {
    const jupSvc = (await deps.runtime.getServiceLoadPromise(
      JUPITER_SERVICE_TYPE,
    )) as unknown as JupiterPredictionService | null;
    if (!jupSvc || !jupSvc.ownerPubkey) {
      callbacks.log(`[BUY:JUPITER] ❌ Jupiter service not available`);
      return false;
    }

    const isYes = side.toUpperCase() === "YES";
    const depositAmount = Math.round(Math.max(betSize, 1.1) * 1_000_000); // micro-USD

    // Use available balance from cycle-level check (already subtracts locked orders)
    if (availableBalance !== undefined && availableBalance < betSize) {
      callbacks.log(`[BUY:JUPITER] ❌ Not enough available balance: $${availableBalance.toFixed(2)} < $${betSize.toFixed(2)}`);
      state.jupBuyPausedUntil = Date.now() + 5 * 60_000;
      return false;
    }

    // Pick mint based on which token has enough balance — prefer JupUSD, fall back to USDC
    let mint: string;
    if ((jupUsdBalance ?? 0) >= betSize) {
      mint = "JuprjznTrTSp2UFa3ZBUFgwdAmtZCq4MQCwysN55USD";
    } else if ((usdcBalance ?? 0) >= betSize) {
      mint = "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v";
    } else {
      // Neither token alone has enough — try JupUSD first (most common from sells)
      mint = (jupUsdBalance ?? 0) > (usdcBalance ?? 0)
        ? "JuprjznTrTSp2UFa3ZBUFgwdAmtZCq4MQCwysN55USD"
        : "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v";
    }
    const mintLabel = mint.startsWith("Jupr") ? "JupUSD" : "USDC";
    callbacks.log(`[BUY:JUPITER] Using ${mintLabel} (USDC=$${(usdcBalance ?? 0).toFixed(2)}, JupUSD=$${(jupUsdBalance ?? 0).toFixed(2)})`);

    const { orderId, signature } = await jupSvc.placeOrderAndSign({
      ownerPubkey: jupSvc.ownerPubkey,
      marketId,
      isYes,
      isBuy: true,
      depositAmount,
      depositMint: mint,
    });

    callbacks.log(`[BUY:JUPITER] ✅ Order placed! Order: ${orderId} | Signature: ${signature}`);
    recordSpend(state, betSize);
    return true;
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    callbacks.log(`[BUY:JUPITER] ❌ Failed: ${msg}`);
    state.failedBuys.set(marketId, Date.now());
    // Pause Jupiter buys on insufficient funds to avoid tight-looping
    if (msg.includes("Insufficient funds") || msg.includes("insufficient")) {
      state.jupBuyPausedUntil = Date.now() + 5 * 60_000; // 5 min cooldown
    }
    return false;
  }
}

// --- Polymarket sell phase ---

async function polymarketSellPhase(
  deps: AutonomyDeps,
  callbacks: AutonomyCallbacks,
  state: AutonomyState,
  sellTargets: PolySellTarget[],
  allSellable: PolySellTarget[],
  polyBalance: number,
  lowBalance: boolean,
  sellLossThreshold: number,
): Promise<void> {
  if (sellTargets.length > 0) {
    const sellList = sellTargets
      .map((s, i) => `${i + 1}. "${s.title}" — PnL: ${s.pnl.toFixed(0)}%, shares: ${s.shares}`)
      .join("\n");
    if (lowBalance) {
      callbacks.log(
        `[SELL MODE] Balance low ($${polyBalance.toFixed(2)}) — aggressive sell thresholds: -${Math.abs(sellLossThreshold)}% / +${Math.abs(SELL_PROFIT_THRESHOLD_AGGRESSIVE)}%`,
      );
    }
    callbacks.log(`[SELL ANALYSIS] Analyzing ${sellTargets.length} positions...`);
    const sellText = await directLlmCall(
      deps,
      callbacks,
      `You are a portfolio manager reviewing positions. Today is ${new Date().toISOString().split("T")[0]}.${lowBalance ? ` Balance is critically low ($${polyBalance.toFixed(2)}). Be aggressive — sell anything profitable.` : ""} For each position, decide SELL or HOLD.\n\n${sellList}\n\nRespond with one line per position:\n<number>: SELL or HOLD — <reason>`,
    );

    for (let i = 0; i < sellTargets.length; i++) {
      const sell = sellTargets[i]!;
      if (state.failedSells.has(sell.token) || state.recentlySold.has(sell.token)) continue;
      const holdPattern = new RegExp(`${i + 1}[:\\s]*HOLD`, "i");
      if (holdPattern.test(sellText)) {
        callbacks.log(`[HOLD:POLYMARKET] "${sell.title}" ${sell.pnl.toFixed(0)}% — LLM says hold`);
        continue;
      }
      const action = sell.pnl < 0 ? "cutting loss" : "taking profit";
      callbacks.log(`[SELL:POLYMARKET] "${sell.title}" ${sell.pnl.toFixed(0)}% — ${action}`);
      await directPolymarketSell(deps, callbacks, state, sell.token, sell.shares, sell.title, sell.curPrice);
    }
  }

  // Recovery mode — if balance is critically low and no threshold sells triggered
  if (polyBalance < LOW_BALANCE_THRESHOLD && sellTargets.length === 0 && allSellable.length > 0) {
    const positionList = allSellable
      .sort((a, b) => a.pnl - b.pnl)
      .slice(0, 10)
      .map((p, i) => `${i + 1}. "${p.title}" — PnL: ${p.pnl.toFixed(0)}%, shares: ${p.shares}`)
      .join("\n");
    callbacks.log(`[RECOVERY MODE] Balance $${polyBalance.toFixed(2)} — asking LLM which positions to sell...`);
    const recoveryText = await directLlmCall(
      deps,
      callbacks,
      `You are a portfolio manager. Balance is critically low ($${polyBalance.toFixed(2)}). Today is ${new Date().toISOString().split("T")[0]}.\n\nPositions (worst first):\n${positionList}\n\nPick 1-3 to sell. Respond with:\n<number>: SELL — <reason>`,
    );
    const sorted = allSellable.sort((a, b) => a.pnl - b.pnl);
    for (let i = 0; i < Math.min(10, sorted.length); i++) {
      const sellPattern = new RegExp(`${i + 1}[:\\s]*SELL`, "i");
      if (sellPattern.test(recoveryText)) {
        const pos = sorted[i]!;
        if (state.failedSells.has(pos.token) || state.recentlySold.has(pos.token)) continue;
        callbacks.log(`[RECOVERY SELL] "${pos.title}" ${pos.pnl.toFixed(0)}% — LLM recommended`);
        await directPolymarketSell(deps, callbacks, state, pos.token, pos.shares, pos.title, pos.curPrice);
      }
    }
  }
}

// --- Smart profit review (runs every cycle on all positions) ---

async function reviewAllPositions(
  deps: AutonomyDeps,
  callbacks: AutonomyCallbacks,
  state: AutonomyState,
  platform: "POLYMARKET" | "JUPITER",
  positions: Array<{ token?: string; pubkey?: string; title: string; pnl: number; shares?: number; curPrice?: number; isYes?: boolean; contracts?: string }>,
): Promise<void> {
  // Filter to sellable positions (skip recently sold/failed, too few shares, dead positions)
  const reviewable = positions.filter((p) => {
    const key = p.token ?? p.pubkey ?? "";
    if (!key) return false;
    if (state.recentlySold.has(key)) return false;
    if (state.failedSells.has(key)) return false;
    if (platform === "POLYMARKET" && (p.shares ?? 0) < 5) return false;
    // Skip dead/resolved positions with $0.00 price — these can't be sold, only claimed
    if ((p.curPrice ?? 0) < 0.01) return false;
    return true;
  });

  if (reviewable.length === 0) {
    callbacks.log(`[PORTFOLIO:${platform}] No reviewable positions`);
    return;
  }

  const positionList = reviewable
    .sort((a, b) => b.pnl - a.pnl)
    .slice(0, 12)
    .map((p, i) => {
      const dir = p.isYes !== undefined ? (p.isYes ? "YES" : "NO") : "";
      const qty = p.shares ?? p.contracts ?? "?";
      const sign = p.pnl >= 0 ? "+" : "";
      return `${i + 1}. "${p.title}" — PnL: ${sign}${p.pnl.toFixed(0)}%, ${dir} ${qty} units, price: $${(p.curPrice ?? 0).toFixed(2)}`;
    })
    .join("\n");

  // === HARD RULES: auto-sell without asking the LLM ===
  const autoSellTargets = reviewable.filter((p) => {
    if (p.pnl >= 30) return true;   // Lock in 30%+ profits automatically
    if (p.pnl <= -25) return true;  // Stop-loss at -25%
    return false;
  });

  for (const pos of autoSellTargets) {
    const key = pos.token ?? pos.pubkey ?? "";
    if (state.recentlySold.has(key) || state.failedSells.has(key)) continue;
    const sign = pos.pnl >= 0 ? "+" : "";
    const reason = pos.pnl >= 10 ? "auto-profit-lock" : "auto-stop-loss";

    if (platform === "POLYMARKET" && pos.token) {
      callbacks.log(`[SELL:POLYMARKET] "${pos.title}" ${sign}${pos.pnl.toFixed(0)}% — ${reason}`);
      await directPolymarketSell(deps, callbacks, state, pos.token, pos.shares ?? 0, pos.title, pos.curPrice);
    } else if (platform === "JUPITER" && pos.pubkey) {
      callbacks.log(`[SELL:JUPITER] "${pos.title}" ${sign}${pos.pnl.toFixed(0)}% — ${reason}`);
      let jupSvc: JupiterPredictionService | null = null;
      try {
        jupSvc = (await deps.runtime.getServiceLoadPromise(JUPITER_SERVICE_TYPE)) as unknown as JupiterPredictionService | null;
      } catch {}
      if (jupSvc) {
        try {
          const { transaction } = await jupSvc.client.closePosition(pos.pubkey, jupSvc.ownerPubkey);
          const signature = await jupSvc.signAndSubmit(transaction);
          callbacks.log(`[SELL:JUPITER] ✅ Closed! Signature: ${signature}`);
          state.recentlySold.set(pos.pubkey, Date.now());
          state.recentlySoldQuestions.set(pos.title.toLowerCase(), Date.now());
        } catch (err) {
          const errMsg = err instanceof Error ? err.message : String(err);
          callbacks.log(`[SELL:JUPITER] ❌ Failed: ${errMsg}`);
          state.failedSells.set(pos.pubkey, Date.now());
        }
      }
    }
  }

  // Filter out auto-sold positions from LLM review
  const autoSoldKeys = new Set(autoSellTargets.map((p) => p.token ?? p.pubkey ?? ""));
  const llmReviewable = reviewable.filter((p) => !autoSoldKeys.has(p.token ?? p.pubkey ?? ""));

  if (llmReviewable.length === 0) return;

  // Fetch price trends for top positions (parallel, cap at 8 to avoid rate limits)
  const sortedForReview = llmReviewable.sort((a, b) => b.pnl - a.pnl).slice(0, 12);
  const trendMap = new Map<string, PriceTrend>();
  if (platform === "POLYMARKET") {
    const trendFetches = sortedForReview.slice(0, 8).map(async (p) => {
      if (!p.token) return;
      try {
        const history = await fetchPolyPriceHistory(p.token, "1h", 24);
        if (history.length > 2) {
          trendMap.set(p.token, computePriceTrend(history, p.curPrice ?? 0));
        }
      } catch {}
    });
    await Promise.allSettled(trendFetches);
  }

  // Rebuild position list for LLM with trend context
  const llmPositionList = sortedForReview
    .map((p, i) => {
      const dir = p.isYes !== undefined ? (p.isYes ? "YES" : "NO") : "";
      const qty = p.shares ?? p.contracts ?? "?";
      const sign = p.pnl >= 0 ? "+" : "";
      let trendStr = "";
      const trend = trendMap.get(p.token ?? "");
      if (trend) {
        const parts: string[] = [];
        if (trend.change1h !== null) parts.push(`1h: ${trend.change1h > 0 ? "+" : ""}${trend.change1h.toFixed(1)}%`);
        if (trend.change24h !== null) parts.push(`24h: ${trend.change24h > 0 ? "+" : ""}${trend.change24h.toFixed(1)}%`);
        trendStr = ` | trend: ${trend.direction} (${parts.join(", ")})`;
      }
      return `${i + 1}. "${p.title}" — PnL: ${sign}${p.pnl.toFixed(0)}%, ${dir} ${qty} units, price: $${(p.curPrice ?? 0).toFixed(2)}${trendStr}`;
    })
    .join("\n");

  callbacks.log(`[PORTFOLIO:${platform}] LLM reviewing ${llmReviewable.length} remaining positions with trend data...`);
  const reviewText = await directLlmCall(
    deps,
    callbacks,
    `You are a disciplined prediction market portfolio manager. Today is ${new Date().toISOString().split("T")[0]}.

RULES — follow these strictly:
- Positions with PnL > +20%: SELL — lock in significant profit.
- Positions with PnL +5% to +20%: check trend data:
  - If price is trending DOWN or flat: SELL — take profit before it fades.
  - If price is trending UP: HOLD — let the winner run.
- Positions with PnL 0% to +5%: HOLD — too small to justify selling (spread costs eat the profit).
- Positions with PnL -15% to 0%: check trend data:
  - If price is trending DOWN (negative 1h/24h change): SELL — cut before it gets worse.
  - If price is trending UP or flat: HOLD — give it time to recover.
- Positions with PnL < -15%: SELL — cut the loss.
- Sports/event markets resolving within 2 DAYS: SELL if profitable — take guaranteed money.
- 20%+ price drop in 24h with no recovery: SELL — momentum collapse.

IMPORTANT: Do NOT sell small winners (<5% profit). The bid-ask spread costs 3-5% on each round trip. Selling at +2% and re-buying costs more than holding.

Positions:
${llmPositionList}

Respond with one line per position:
<number>: SELL or HOLD — <reason citing specific data>`,
  );

  if (reviewText.length === 0) return;
  callbacks.log(`[PORTFOLIO:${platform}] ${reviewText.slice(0, 300)}`);

  const sorted = llmReviewable.sort((a, b) => b.pnl - a.pnl).slice(0, 12);
  for (let i = 0; i < sorted.length; i++) {
    const sellPattern = new RegExp(`${i + 1}[:\\s]*SELL`, "i");
    if (!sellPattern.test(reviewText)) continue;
    const pos = sorted[i]!;
    const key = pos.token ?? pos.pubkey ?? "";
    if (state.recentlySold.has(key) || state.failedSells.has(key)) continue;
    const sign = pos.pnl >= 0 ? "+" : "";

    if (platform === "POLYMARKET" && pos.token) {
      callbacks.log(`[SELL:POLYMARKET] "${pos.title}" ${sign}${pos.pnl.toFixed(0)}% — portfolio review`);
      await directPolymarketSell(deps, callbacks, state, pos.token, pos.shares ?? 0, pos.title, pos.curPrice);
    } else if (platform === "JUPITER" && pos.pubkey) {
      callbacks.log(`[SELL:JUPITER] "${pos.title}" ${sign}${pos.pnl.toFixed(0)}% — portfolio review`);
      let jupSvc: JupiterPredictionService | null = null;
      try {
        jupSvc = (await deps.runtime.getServiceLoadPromise(JUPITER_SERVICE_TYPE)) as unknown as JupiterPredictionService | null;
      } catch {}
      if (jupSvc) {
        try {
          const { transaction } = await jupSvc.client.closePosition(pos.pubkey, jupSvc.ownerPubkey);
          const signature = await jupSvc.signAndSubmit(transaction);
          callbacks.log(`[SELL:JUPITER] ✅ Closed! Signature: ${signature}`);
          state.recentlySold.set(pos.pubkey, Date.now());
          state.recentlySoldQuestions.set(pos.title.toLowerCase(), Date.now());
        } catch (err) {
          const errMsg = err instanceof Error ? err.message : String(err);
          callbacks.log(`[SELL:JUPITER] ❌ Failed: ${errMsg}`);
          state.failedSells.set(pos.pubkey, Date.now());
        }
      }
    }
  }
}

// --- Polymarket scan & buy phase ---

type ScoredMarket = {
  question: string;
  yesPrice: number;
  score: number;
  volume: number;
  daysLeft: number;
  tokenId: string;
  conditionId: string | undefined;
  intel: MarketIntel | null;
};

async function scanPolymarketMarkets(
  ownedTitles: Set<string>,
  state: AutonomyState,
  callbacks: AutonomyCallbacks,
): Promise<ScoredMarket[]> {
  const scored: ScoredMarket[] = [];
  const res = await withRetry(
    () => fetch("https://clob.polymarket.com/sampling-markets"),
    { label: "polymarket-scan" },
  );
  const data = await res.json();
  for (const m of (data.data ?? []).filter(
    (x: Record<string, unknown>) => x.active && !x.closed && x.accepting_orders,
  )) {
    const yes = (m.tokens ?? []).find((t: Record<string, unknown>) => t.outcome === "Yes");
    const no = (m.tokens ?? []).find((t: Record<string, unknown>) => t.outcome === "No");
    if (!yes) continue;
    const yp = Number(yes.price);
    const np = no ? Number(no.price) : 1 - yp;
    if (yp < 0.1 || yp > 0.9) continue;
    const q = String(m.question ?? "");
    if (ownedTitles.has(q.toLowerCase())) continue;
    if (isRecentlyTraded(state, q)) continue;
    if (state.recentlySoldQuestions.has(q.toLowerCase())) continue;
    if (state.pendingBuys.has(q.toLowerCase())) continue;

    const spread = Math.abs(np - yp);
    const midpoint = (yp + np) / 2;
    const spreadScore = Math.max(0, 1 - spread / 0.15);
    const midScore = 1 - Math.abs(midpoint - 0.5) * 2;

    const endDate = m.end_date_iso ?? m.endDate;
    let daysLeft = 365;
    if (endDate) {
      daysLeft = Math.max(0, (new Date(endDate as string).getTime() - Date.now()) / 86400000);
      if (daysLeft < 1) continue;
      if (daysLeft > 180) continue; // Skip markets >6 months out — capital locked, no edge
    }
    const timeScore = Math.min(1, daysLeft / 30);
    // Use actual volume if available, fall back to rewards.dailyRate
    const volume = Number(m.volume ?? m.rewards?.dailyRate ?? 0);
    const volumeScore = Math.min(1, volume / 100);

    const tokenId = String(yes.token_id ?? "");
    const conditionId = m.condition_id ? String(m.condition_id) : undefined;

    const score =
      spreadScore * SCORE_SPREAD_WEIGHT +
      midScore * SCORE_MIDPOINT_WEIGHT +
      timeScore * SCORE_TIME_WEIGHT +
      volumeScore * SCORE_VOLUME_WEIGHT;
    scored.push({ question: q, yesPrice: yp, score, volume, daysLeft, tokenId, conditionId, intel: null });
  }
  scored.sort((a, b) => b.score - a.score);

  // Gather market intelligence for top candidates (parallel, capped at 5 to avoid rate limits)
  const topN = scored.slice(0, 5);
  if (topN.length > 0) {
    callbacks.log(`[INTEL:POLY] Gathering price history + depth for top ${topN.length} markets...`);
    const intelResults = await Promise.allSettled(
      topN.map((m) => gatherPolyIntel(m.tokenId, m.conditionId, m.yesPrice, m.question)),
    );
    for (let i = 0; i < topN.length; i++) {
      const result = intelResults[i]!;
      if (result.status === "fulfilled") {
        const intel = result.value;
        topN[i]!.intel = intel;

        // Adjust score with momentum signal
        if (intel.trend) {
          // Positive momentum → slight boost; negative → slight penalty
          const momentumScore = (intel.trend.momentum + 1) / 2; // normalize 0-1
          topN[i]!.score += (momentumScore - 0.5) * SCORE_MOMENTUM_WEIGHT * 2;
        }

        // Adjust score with depth/liquidity signal
        if (intel.depth) {
          const depthScore = Math.min(1, intel.depth.totalDepthUsd / (MIN_DEPTH_USD * 5));
          topN[i]!.score += depthScore * SCORE_DEPTH_WEIGHT;

          // Buy pressure bonus (imbalance > 0 means more bids than asks)
          if (intel.depth.imbalance > 0.3) {
            topN[i]!.score += 0.03; // small boost for buy pressure
          }
        }

        // Contrarian bonus — big 24h move = mean reversion opportunity
        if (intel.isContrarian) {
          topN[i]!.score += CONTRARIAN_BONUS;
          callbacks.log(`[INTEL:POLY] ⚠️ "${topN[i]!.question.slice(0, 50)}" — contrarian signal: ${intel.contrarian24hMove!.toFixed(0)}% 24h move`);
        }

        // Reject illiquid markets
        if (intel.depth && !intel.depth.isLiquid) {
          callbacks.log(`[INTEL:POLY] ❌ "${topN[i]!.question.slice(0, 50)}" — illiquid ($${intel.depth.totalDepthUsd.toFixed(0)} depth), deprioritized`);
          topN[i]!.score *= 0.3; // heavy penalty, don't fully remove (LLM may still pick)
        }
      }
    }
    // Re-sort after intel adjustments
    scored.sort((a, b) => b.score - a.score);
  }

  return scored;
}

// --- Jupiter scan ---

type JupMarket = {
  question: string;
  marketId: string;
  yesPrice: number;
  score: number;
  volume: number;
  intel: MarketIntel | null;
};

async function scanJupiterMarkets(
  ownedTitles: Set<string>,
  state: AutonomyState,
  callbacks: AutonomyCallbacks,
): Promise<JupMarket[]> {
  const jupApiKey = process.env.JUPITER_API_KEY?.trim();
  if (!jupApiKey) return [];

  const jupScored: JupMarket[] = [];
  const res = await withRetry(
    () =>
      fetch("https://api.jup.ag/prediction/v1/events?status=live", {
        headers: { "x-api-key": jupApiKey },
      }),
    { label: "jupiter-scan" },
  );
  const evData = await res.json();
  let _jupDbgTotal = 0, _jupDbgPrice = 0, _jupDbgVol = 0, _jupDbgOwned = 0;
  for (const event of (evData.data ?? [])) {
    for (const m of (event.markets ?? []).filter(
      (x: Record<string, unknown>) => x.status === "open",
    )) {
      _jupDbgTotal++;
      const yp = Number(m.pricing?.buyYesPriceUsd ?? 0) / 1_000_000;
      const np = Number(m.pricing?.buyNoPriceUsd ?? 0) / 1_000_000;
      if (yp < 0.02 || yp > 0.98) { _jupDbgPrice++; continue; }

      // Skip markets resolving more than 180 days out — capital locked too long, no edge
      const closeTime = Number(m.closeTime ?? 0);
      if (closeTime > 0) {
        const daysUntilClose = (closeTime * 1000 - Date.now()) / 86_400_000;
        if (daysUntilClose > 180) continue;
      }

      const effectiveNp = np > 0 ? np : 1 - yp;
      const spread = Math.abs(effectiveNp - yp);
      const mid = (yp + effectiveNp) / 2;
      const spreadScore = Math.max(0, 1 - spread / 0.15);
      const midScore = 1 - Math.abs(mid - 0.5) * 2;
      const volume = Number(m.pricing?.volume ?? 0) / 1_000_000;
      if (volume < 0.5) { _jupDbgVol++; continue; }
      const volumeScore = Math.min(1, volume / 10000);
      const score = spreadScore * 0.35 + midScore * 0.3 + volumeScore * 0.35;
      const q = `${event.metadata?.title} — ${m.metadata?.title}`;
      const marketTitle = (m.metadata?.title ?? "").toLowerCase();
      const eventTitle = (event.metadata?.title ?? "").toLowerCase();
      if (ownedTitles.has(marketTitle) || ownedTitles.has(`${eventTitle} — ${marketTitle}`)) { _jupDbgOwned++; continue; }
      if (isRecentlyTraded(state, q)) continue;
      if (state.recentlySoldQuestions.has(q.toLowerCase())) continue;
      if (state.pendingBuys.has(q.toLowerCase())) continue;
      if (!isFailCooledDown(state.failedBuys, m.marketId, FAILED_BUY_COOLDOWN_MS)) continue;
      jupScored.push({ question: q, marketId: m.marketId, yesPrice: yp, score, volume, intel: null });
    }
  }
  jupScored.sort((a, b) => b.score - a.score);

  // Gather market intelligence for top Jupiter candidates
  const topN = jupScored.slice(0, 5);
  if (topN.length > 0 && jupApiKey) {
    callbacks.log(`[INTEL:JUP] Gathering depth for top ${topN.length} markets...`);
    const intelResults = await Promise.allSettled(
      topN.map((m) => gatherJupIntel(m.marketId, m.yesPrice, m.question, jupApiKey)),
    );
    for (let i = 0; i < topN.length; i++) {
      const result = intelResults[i]!;
      if (result.status === "fulfilled") {
        const intel = result.value;
        topN[i]!.intel = intel;

        // Adjust score with depth/liquidity signal
        if (intel.depth) {
          const depthScore = Math.min(1, intel.depth.totalDepthUsd / (MIN_DEPTH_USD * 3));
          topN[i]!.score += depthScore * SCORE_DEPTH_WEIGHT;
          if (intel.depth.imbalance > 0.3) topN[i]!.score += 0.03;
        }

        // Reject illiquid markets
        if (intel.depth && !intel.depth.isLiquid) {
          callbacks.log(`[INTEL:JUP] ❌ "${topN[i]!.question.slice(0, 50)}" — illiquid ($${intel.depth.totalDepthUsd.toFixed(0)} depth), deprioritized`);
          topN[i]!.score *= 0.3;
        }
      }
    }
    jupScored.sort((a, b) => b.score - a.score);
  }

  // Return debug info alongside results
  (jupScored as unknown as { _debug?: string })._debug =
    `${_jupDbgTotal} scanned, filtered: price=${_jupDbgPrice}, volume=${_jupDbgVol}, owned=${_jupDbgOwned}, passed=${jupScored.length}`;
  return jupScored;
}

// --- RAG helpers ---

async function applyRagSimilarity(
  ragSvc: RAGService,
  markets: Array<{ question: string; score: number }>,
  callbacks: AutonomyCallbacks,
  platform: string,
): Promise<void> {
  for (const m of markets.slice(0, 10)) {
    try {
      const simScore = await ragSvc.computeSimilarityScore(m.question);
      if (simScore > 0) {
        const oldScore = m.score;
        m.score = oldScore * (1 - RAG_SIMILARITY_WEIGHT) + simScore * RAG_SIMILARITY_WEIGHT;
        callbacks.log(
          `[RAG:SIMILARITY] "${m.question.slice(0, 50)}" score: ${oldScore.toFixed(2)} → ${m.score.toFixed(2)} (sim: ${simScore.toFixed(2)})`,
        );
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      callbacks.log(`[RAG:SIM-${platform}-ERR] ${msg}`);
    }
  }
}

async function indexAndEnrich(
  deps: AutonomyDeps,
  callbacks: AutonomyCallbacks,
  state: AutonomyState,
  markets: ScoredMarket[] | JupMarket[],
  platform: "polymarket" | "jupiter",
  topQuestion: string,
): Promise<string> {
  // Check enrichment cache — avoid duplicate NewsAPI/Tavily calls for similar topics
  const cacheKey = topQuestion.toLowerCase().slice(0, 40);
  const cached = state.cycleEnrichCache.get(cacheKey);
  if (cached !== undefined) {
    callbacks.log(`[RAG:ENRICH] Using cached context for "${topQuestion.slice(0, 40)}"`);
    return cached;
  }

  const ragActive = deps.ragSvc?.isActive() === true;
  const connectorsActive = deps.connectorsSvc?.isActive() === true;

  // Index markets into ChromaDB
  if (ragActive && markets.length > 0) {
    try {
      const docs: MarketDocument[] = markets.slice(0, 20).map((m) => ({
        id: `${platform === "polymarket" ? "poly" : "jup"}_${m.question.slice(0, 50).replace(/[^a-zA-Z0-9]/g, "_")}`,
        question: m.question,
        description: m.question,
        outcomes: `YES: $${m.yesPrice.toFixed(2)}, NO: $${(1 - m.yesPrice).toFixed(2)}`,
        outcomePrices: `YES:${m.yesPrice.toFixed(2)},NO:${(1 - m.yesPrice).toFixed(2)}`,
        volume: m.volume,
        platform,
        metadata: { score: m.score },
      }));
      const indexFn =
        platform === "polymarket"
          ? deps.ragSvc!.indexPolymarketMarkets.bind(deps.ragSvc!)
          : deps.ragSvc!.indexJupiterMarkets.bind(deps.ragSvc!);
      const indexed = await indexFn(docs);
      callbacks.log(`[RAG:${platform.toUpperCase()}] Indexed ${indexed} markets into ChromaDB`);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      callbacks.log(`[RAG:${platform.toUpperCase()}] Indexing failed: ${msg}`);
    }
  }

  // Apply similarity scoring
  if (ragActive && markets.length > 0) {
    callbacks.log(
      `[RAG:SIMILARITY] Computing similarity scores for ${Math.min(markets.length, 10)} markets...`,
    );
    await applyRagSimilarity(deps.ragSvc!, markets, callbacks, platform.toUpperCase());
    markets.sort((a, b) => b.score - a.score);
  }

  // Fetch enrichment context
  if (!ragActive && !connectorsActive) return "";

  try {
    callbacks.log(`[RAG:ENRICH] Fetching context for: "${topQuestion.slice(0, 60)}"`);
    const ctxPromises = await Promise.allSettled([
      connectorsActive ? deps.connectorsSvc!.getSearchContext(topQuestion) : Promise.resolve(null),
      ragActive ? deps.ragSvc!.enrichContext(topQuestion) : Promise.resolve(null),
    ]);
    const connectorCtx = ctxPromises[0]!.status === "fulfilled" ? ctxPromises[0]!.value : null;
    const ragCtx = ctxPromises[1]!.status === "fulfilled" ? ctxPromises[1]!.value : null;

    const parts: string[] = [];
    if (connectorCtx && (connectorCtx as { contextSummary?: string }).contextSummary) {
      const ctx = connectorCtx as { contextSummary: string; articles: Array<{ title: string; description: string; source: unknown; url: unknown; publishedAt: unknown }> };
      parts.push(`NEWS & WEB SEARCH:\n${ctx.contextSummary}`);
      callbacks.log(`[RAG:ENRICH] Got news+search context (${ctx.contextSummary.length} chars)`);
      // Index news into ChromaDB
      if (ragActive && ctx.articles.length > 0) {
        const newsDocs: NewsDocument[] = ctx.articles.map((a, i) => ({
          id: `news_${a.title.slice(0, 30).replace(/[^a-zA-Z0-9]/g, "_")}_${i}`,
          title: a.title,
          content: `${a.title}. ${a.description}`,
          source: String(a.source),
          url: String(a.url ?? ""),
          publishedAt: String(a.publishedAt ?? ""),
          keywords: topQuestion,
        }));
        const indexed = await deps.ragSvc!.indexNewsArticles(newsDocs);
        callbacks.log(`[RAG:INDEX] Indexed ${indexed} news articles into ChromaDB`);
      }
    }
    if (ragCtx && (ragCtx as { similarMarkets: Array<{ metadata: Record<string, unknown>; id: string; score: number }> }).similarMarkets.length > 0) {
      const r = ragCtx as { similarMarkets: Array<{ metadata: Record<string, unknown>; id: string; score: number }>; relevantNews: unknown[] };
      const simLines = r.similarMarkets.slice(0, 3).map(
        (s) => `  - "${(s.metadata as Record<string, unknown>).question ?? s.id}" (similarity: ${(s.score * 100).toFixed(0)}%)`,
      );
      parts.push(`SIMILAR MARKETS (from ChromaDB):\n${simLines.join("\n")}`);
      callbacks.log(`[RAG:ENRICH] Found ${r.similarMarkets.length} similar markets in ChromaDB`);
    }

    const result = parts.length > 0
      ? `\n\nADDITIONAL CONTEXT FOR YOUR ANALYSIS:\n${parts.join("\n\n")}\n\nUse this context to improve your prediction accuracy.`
      : "";
    state.cycleEnrichCache.set(cacheKey, result);
    return result;
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    callbacks.log(`[RAG:ENRICH] Context fetch failed: ${msg}`);
    state.cycleEnrichCache.set(cacheKey, "");
    return "";
  }
}

// --- LLM analysis helpers ---

async function analyzeCandidates(
  deps: AutonomyDeps,
  callbacks: AutonomyCallbacks,
  candidates: Array<{ question: string; yesPrice: number; score: number; volume?: number; daysLeft?: number; intel?: MarketIntel | null }>,
  ragContext: string,
): Promise<{ pick: (typeof candidates)[0]; side: string; reason: string } | null> {
  // Build candidate list with explicit risk/reward for each side
  const candidateList = candidates
    .map((c, i) => {
      const yesPrice = c.yesPrice;
      const noPrice = 1 - c.yesPrice;
      const yesRR = yesPrice > 0 ? ((1 - yesPrice) / yesPrice).toFixed(1) : "∞";
      const noRR = noPrice > 0 ? ((1 - noPrice) / noPrice).toFixed(1) : "∞";
      const extra = c.daysLeft !== undefined ? `, ${c.daysLeft.toFixed(0)} days left` : "";
      const vol = c.volume !== undefined ? `, vol: $${c.volume.toFixed(0)}` : "";
      const intelStr = c.intel ? formatIntelForPrompt(c.intel) : "";
      return `${i + 1}. "${c.question}"
   YES: $${yesPrice.toFixed(2)} (risk $${yesPrice.toFixed(2)}, win $${(1 - yesPrice).toFixed(2)}, ratio ${yesRR}:1)
   NO:  $${noPrice.toFixed(2)} (risk $${noPrice.toFixed(2)}, win $${yesPrice.toFixed(2)}, ratio ${noRR}:1)
   score: ${c.score.toFixed(2)}${extra}${vol}${intelStr}`;
    })
    .join("\n");

  callbacks.log(`[ANALYSIS] Analyzing top ${candidates.length} markets with intel...`);

  const structuredPrompt = `You are a prediction market trader. Today is ${new Date().toISOString().split("T")[0]}.

For each market below, both YES and NO sides are shown with their RISK/REWARD RATIO.
The ratio means: for every $1 you risk, you win that many dollars if correct.

${candidateList}${ragContext}

YOUR DECISION PROCESS:
1. For each market, estimate the TRUE probability of the event happening.
2. Compare your estimate to the market price. The EDGE = |your probability - market price|.
3. Pick the side where your edge is highest AND the risk/reward ratio is favorable.
4. A 2:1 ratio means you only need to be right 33% of the time to profit. A 0.3:1 ratio means you need to be right 77% of the time — very hard.

RULES:
- NEVER pick a side with ratio below 0.5:1 (you'd risk $1 to win only $0.50 — needs >67% win rate)
- Prefer sides with ratio 1.5:1 or better (profitable even at 40% accuracy)
- Markets resolving in 7-60 days are ideal — enough time for price discovery
- Consider the specific event: sports/dated events have clearer edges than far-future politics
- If ALL candidates have bad ratios on both sides, pick the LEAST bad one

Respond in EXACTLY this format (3 lines only):
PICK: <number 1-${candidates.length}>
SIDE: YES or NO
REASON: <cite the risk/reward ratio and your estimated edge>`;

  const text = await directLlmCall(deps, callbacks, structuredPrompt);

  if (text.length > 0) {
    callbacks.log(`[ANALYSIS] LLM response: "${text.slice(0, 120)}"`);
    const pickMatch = /PICK:\s*(\d+)/i.exec(text);
    const sideMatch = /SIDE:\s*(YES|NO)/i.exec(text);
    const reasonMatch = /REASON:\s*(.+?)(?:\.|$)/i.exec(text);

    if (sideMatch) {
      const pickIdx = pickMatch
        ? Math.min(Number.parseInt(pickMatch[1]!) - 1, candidates.length - 1)
        : 0;
      return {
        pick: candidates[Math.max(0, pickIdx)]!,
        side: sideMatch[1]!.toUpperCase(),
        reason: reasonMatch ? reasonMatch[1]!.trim() : text.slice(0, 100),
      };
    }

    // Try to extract YES/NO from unstructured response
    const yesNo = /\b(YES|NO)\b/i.exec(text);
    if (yesNo) {
      return {
        pick: candidates[0]!,
        side: yesNo[1]!.toUpperCase(),
        reason: text.slice(0, 100),
      };
    }

    callbacks.log(`[ANALYSIS] Could not parse LLM response, trying simpler prompt...`);
  } else {
    callbacks.log(`[ANALYSIS] LLM returned empty, trying simpler prompt...`);
  }

  // Fallback: simpler YES/NO question on top pick
  const pick = candidates[0]!;
  const simplePrompt = `Today is ${new Date().toISOString().split("T")[0]}. Should I bet YES or NO on: "${pick.question}"? Current YES price: $${pick.yesPrice.toFixed(2)}. Answer only YES or NO with a short reason.`;
  const fbText = await directLlmCall(deps, callbacks, simplePrompt);

  if (fbText.length > 0) {
    callbacks.log(`[ANALYSIS] Fallback response: "${fbText.slice(0, 100)}"`);
    const yesNo = /\b(YES|NO)\b/i.exec(fbText);
    if (yesNo) {
      return {
        pick,
        side: yesNo[1]!.toUpperCase(),
        reason: fbText.slice(0, 100),
      };
    }
  }

  // Last resort: price-based heuristic
  const heuristicSide = pick.yesPrice < 0.5 ? "YES" : "NO";
  callbacks.log(`[ANALYSIS] All LLM attempts failed — using price heuristic: ${heuristicSide} (YES=$${pick.yesPrice.toFixed(2)})`);
  return {
    pick,
    side: heuristicSide,
    reason: `price heuristic (YES=$${pick.yesPrice.toFixed(2)})`,
  };
}

// --- Collect owned positions ---

type PolySellTarget = { token: string; shares: number; title: string; pnl: number; curPrice: number };
type JupSellTarget = { marketId: string; pubkey: string; title: string; pnl: number };
type JupClaimTarget = { pubkey: string; title: string; payout: number };
type JupPositionInfo = { marketId: string; pubkey: string; title: string; pnl: number; isYes: boolean; contracts: string };

async function collectPositions(
  state: AutonomyState,
  sellLossThreshold: number,
  sellProfitThreshold: number,
): Promise<{
  ownedTitles: Set<string>;
  polySellTargets: PolySellTarget[];
  polyAllSellable: PolySellTarget[];
  jupSellTargets: JupSellTarget[];
  jupAllPositions: JupPositionInfo[];
  jupClaimable: JupClaimTarget[];
}> {
  const ownedTitles = new Set<string>();
  const polySellTargets: PolySellTarget[] = [];
  const polyAllSellable: PolySellTarget[] = [];
  const jupSellTargets: JupSellTarget[] = [];
  const jupAllPositions: JupPositionInfo[] = [];
  const jupClaimable: JupClaimTarget[] = [];

  // Polymarket positions
  try {
    const funder = process.env.POLYMARKET_FUNDER_ADDRESS?.trim();
    if (funder) {
      const posRes = await withRetry(
        () => fetch(`https://data-api.polymarket.com/positions?user=${funder}`),
        { label: "poly-positions" },
      );
      if (posRes.ok) {
        for (const pos of await posRes.json()) {
          if (pos.title) ownedTitles.add(pos.title.toLowerCase());
          const pnl = pos.percentPnl ?? 0;
          const price = pos.curPrice ?? 0;
          if (price < 0.02 || pos.redeemable) continue;
          // Skip freshly bought positions (protect POSITION_MIN_AGE_MS)
          const isNew = state.tradeHistory.some(
            (h) => h.question.toLowerCase() === (pos.title ?? "").toLowerCase() && Date.now() - h.time < POSITION_MIN_AGE_MS,
          );
          if (isNew) continue;
          if (pnl <= -95) continue;
          if (price < 0.05) continue;
          if (!isFailCooledDown(state.failedSells, pos.asset, FAILED_SELL_COOLDOWN_MS)) continue;
          // Skip positions too small to sell on Polymarket (min 5 shares) — dead money
          if ((pos.size ?? 0) < 5) continue;
          polyAllSellable.push({ token: pos.asset, shares: pos.size, title: pos.title, pnl, curPrice: price });
          if (pnl < sellLossThreshold || pnl > sellProfitThreshold) {
            polySellTargets.push({ token: pos.asset, shares: pos.size, title: pos.title, pnl, curPrice: price });
          }
        }
      }
    }
  } catch {}

  // Jupiter positions
  try {
    const jupApiKey = process.env.JUPITER_API_KEY?.trim();
    const kp = getSolanaKeypair();
    if (jupApiKey && kp) {
      const posRes = await withRetry(
        () =>
          fetch(
            `https://api.jup.ag/prediction/v1/positions?ownerPubkey=${kp.publicKey.toBase58()}`,
            { headers: { "x-api-key": jupApiKey } },
          ),
        { label: "jup-positions" },
      );
      if (posRes.ok) {
        for (const pos of (await posRes.json()).data ?? []) {
          const title = pos.eventMetadata?.title ?? pos.marketId ?? "";
          if (title) ownedTitles.add(title.toLowerCase());
          if (pos.claimable === true && pos.claimed !== true && pos.pubkey) {
            const payout = Number(pos.payoutUsd ?? 0) / 1_000_000;
            jupClaimable.push({
              pubkey: pos.pubkey,
              title: pos.marketMetadata?.title ?? pos.marketId,
              payout,
            });
            continue;
          }
          const pnl = pos.pnlUsdPercent ?? 0;
          // Skip freshly bought positions — protects both sell targeting AND portfolio review
          const isNewJup = state.tradeHistory.some(
            (h) => h.question.toLowerCase().includes(title.toLowerCase()) && Date.now() - h.time < POSITION_MIN_AGE_MS,
          );
          if (isNewJup) continue;
          // Track remaining positions for portfolio review
          if (pos.pubkey) {
            jupAllPositions.push({
              marketId: pos.marketId,
              pubkey: pos.pubkey,
              title: pos.marketMetadata?.title ?? pos.marketId,
              pnl,
              isYes: pos.isYes ?? true,
              contracts: pos.contracts ?? "0",
            });
          }
          if (
            (pnl < sellLossThreshold || pnl > sellProfitThreshold) &&
            pos.pubkey &&
            pnl > -95 &&
            !state.recentlySold.has(pos.pubkey) &&
            isFailCooledDown(state.failedSells, pos.pubkey, FAILED_SELL_COOLDOWN_MS)
          ) {
            jupSellTargets.push({
              marketId: pos.marketId,
              pubkey: pos.pubkey,
              title: pos.marketMetadata?.title ?? pos.marketId,
              pnl,
            });
          }
        }
      }
    }
  } catch {}

  return { ownedTitles, polySellTargets, polyAllSellable, jupSellTargets, jupAllPositions, jupClaimable };
}

// --- Jupiter sell/claim phase ---

async function jupiterSellClaimPhase(
  deps: AutonomyDeps,
  callbacks: AutonomyCallbacks,
  state: AutonomyState,
  jupSellTargets: JupSellTarget[],
  jupClaimable: JupClaimTarget[],
  solBalance: number,
  lowSolBalance: boolean,
  sellLossThreshold: number,
): Promise<void> {
  if (jupClaimable.length === 0 && jupSellTargets.length === 0) {
    callbacks.log(`[JUPITER] No threshold sells or claims this cycle`);
  }

  // Claim settled positions first
  if (jupClaimable.length > 0) {
    let jupSvc: JupiterPredictionService | null = null;
    try {
      jupSvc = (await deps.runtime.getServiceLoadPromise(
        JUPITER_SERVICE_TYPE,
      )) as unknown as JupiterPredictionService | null;
    } catch {}
    for (const claim of jupClaimable) {
      callbacks.log(`[CLAIM:JUPITER] "${claim.title}" — payout: $${claim.payout.toFixed(2)}`);
      if (jupSvc) {
        try {
          const { transaction } = await jupSvc.client.claimPosition(claim.pubkey, jupSvc.ownerPubkey);
          const signature = await jupSvc.signAndSubmit(transaction);
          callbacks.log(`[CLAIM:JUPITER] Claimed! Signature: ${signature}`);
        } catch (err) {
          const errMsg = err instanceof Error ? err.message : String(err);
          callbacks.log(`[CLAIM:JUPITER] Failed: ${errMsg}`);
        }
      }
    }
  }

  // Sell phase
  if (jupSellTargets.length > 0) {
    const jupSellList = jupSellTargets
      .map((s, i) => `${i + 1}. "${s.title}" — PnL: ${s.pnl.toFixed(0)}%`)
      .join("\n");
    if (lowSolBalance) {
      callbacks.log(
        `[SELL MODE] SOL balance low ($${solBalance.toFixed(2)}) — aggressive sell thresholds: -${Math.abs(sellLossThreshold)}%`,
      );
    }
    callbacks.log(`[SELL ANALYSIS] Analyzing ${jupSellTargets.length} Jupiter positions...`);
    const jupSellText = await directLlmCall(
      deps,
      callbacks,
      `You are a portfolio manager reviewing Jupiter/Solana positions. Today is ${new Date().toISOString().split("T")[0]}.${lowSolBalance ? ` Balance is critically low ($${solBalance.toFixed(2)}). Be aggressive.` : ""} For each position, decide SELL or HOLD.\n\n${jupSellList}\n\nRespond with one line per position:\n<number>: SELL or HOLD — <reason>`,
    );

    let jupSvc: JupiterPredictionService | null = null;
    try {
      jupSvc = (await deps.runtime.getServiceLoadPromise(
        JUPITER_SERVICE_TYPE,
      )) as unknown as JupiterPredictionService | null;
    } catch {}

    for (let i = 0; i < jupSellTargets.length; i++) {
      const sell = jupSellTargets[i]!;
      if (state.recentlySold.has(sell.pubkey) || state.failedSells.has(sell.pubkey)) continue;
      const holdPattern = new RegExp(`${i + 1}[:\\s]*HOLD`, "i");
      if (holdPattern.test(jupSellText)) {
        callbacks.log(`[HOLD:JUPITER] "${sell.title}" ${sell.pnl.toFixed(0)}% — LLM says hold`);
        continue;
      }
      const action = sell.pnl < 0 ? "cutting loss" : "taking profit";
      callbacks.log(`[SELL:JUPITER] "${sell.title}" ${sell.pnl.toFixed(0)}% — ${action}`);
      if (jupSvc) {
        try {
          const { transaction } = await jupSvc.client.closePosition(sell.pubkey, jupSvc.ownerPubkey);
          const signature = await jupSvc.signAndSubmit(transaction);
          callbacks.log(`[SELL:JUPITER] ✅ Closed! Signature: ${signature}`);
          state.recentlySold.set(sell.pubkey, Date.now());
          state.recentlySoldQuestions.set(sell.title.toLowerCase(), Date.now());
        } catch (err) {
          const errMsg = err instanceof Error ? err.message : String(err);
          callbacks.log(`[SELL:JUPITER] ❌ Failed to close: ${errMsg}`);
          state.failedSells.set(sell.pubkey, Date.now());
        }
      } else {
        callbacks.log(`[SELL:JUPITER] ❌ Jupiter service not available`);
        state.failedSells.set(sell.pubkey, Date.now());
      }
    }
  }
}

// --- Main autonomy cycle ---

async function runAutonomyCycle(
  deps: AutonomyDeps,
  callbacks: AutonomyCallbacks,
  state: AutonomyState,
): Promise<void> {
  const cycleStart = Date.now();
  state.cycleCount++;
  housekeep(state);
  try {
    callbacks.send({ type: "thinking", active: true });
  } catch {}

  const ragActive = deps.ragSvc?.isActive() === true;
  const connectorsActive = deps.connectorsSvc?.isActive() === true;

  try {
    const platformLabel = state.platform === "both" ? "Polygon + Solana" : state.platform === "polymarket" ? "Polygon only" : "Solana + x402 only";
    callbacks.log(`[AUTONOMY] Cycle #${state.cycleCount} — ${platformLabel}`);
    if (ragActive) callbacks.log("[RAG] ChromaDB online");
    if (connectorsActive) callbacks.log("[CONNECTORS] News + Search online");

    // Get balances
    const portfolioStatus = await getPortfolioStatus(deps.runtime);
    const polyBalance = portfolioStatus.balance;
    const solBalanceTotal = portfolioStatus.solanaBalance;

    // Get per-token Solana balance breakdown (USDC vs JupUSD)
    const solBreakdown = await getCachedSolanaBalanceBreakdown();
    let solUsdcBalance = solBreakdown.usdc;
    let solJupUsdBalance = solBreakdown.jupUsd;

    // Compute available Solana balance (subtract locked orders)
    let solLockedInOrders = 0;
    try {
      const jupSvc = (await deps.runtime.getServiceLoadPromise(
        JUPITER_SERVICE_TYPE,
      )) as unknown as JupiterPredictionService | null;
      if (jupSvc?.ownerPubkey) {
        const openOrders = await jupSvc.client.getOrders(jupSvc.ownerPubkey);
        if (Array.isArray(openOrders)) {
          for (const order of openOrders) {
            const o = order as Record<string, unknown>;
            const deposited = Number(o.sizeUsd ?? o.depositedAmount ?? o.depositAmount ?? 0) / 1_000_000;
            const status = String(o.status ?? "");
            if (status !== "cancelled" && status !== "filled" && status !== "expired") {
              solLockedInOrders += deposited;
            }
          }
        }
      }
    } catch {}
    const solBalance = Math.max(0, solBalanceTotal - solLockedInOrders);
    // Proportionally reduce per-token balances by locked amount
    if (solLockedInOrders > 0 && solBalanceTotal > 0) {
      const lockRatio = Math.min(1, solLockedInOrders / solBalanceTotal);
      solUsdcBalance = Math.max(0, solUsdcBalance * (1 - lockRatio));
      solJupUsdBalance = Math.max(0, solJupUsdBalance * (1 - lockRatio));
    }

    const lowPolyBalance = polyBalance < LOW_BALANCE_THRESHOLD;
    const lowSolBalance = solBalance < LOW_BALANCE_THRESHOLD;
    const lockedInfo = solLockedInOrders > 0
      ? ` (avail: $${solBalance.toFixed(2)}, locked: $${solLockedInOrders.toFixed(2)}, USDC: $${solUsdcBalance.toFixed(2)}, JupUSD: $${solJupUsdBalance.toFixed(2)})`
      : ` (USDC: $${solUsdcBalance.toFixed(2)}, JupUSD: $${solJupUsdBalance.toFixed(2)})`;
    callbacks.log(
      `[BALANCE] Polygon: $${polyBalance.toFixed(2)} | Solana: $${solBalanceTotal.toFixed(2)}${lockedInfo}`,
    );

    // P&L tracking
    if (state.prevPolyBalance >= 0 || state.prevSolBalance >= 0) {
      const polyDelta = state.prevPolyBalance >= 0 ? polyBalance - state.prevPolyBalance : 0;
      const solDelta = state.prevSolBalance >= 0 ? solBalance - state.prevSolBalance : 0;
      const totalDelta = polyDelta + solDelta;
      if (Math.abs(totalDelta) >= 0.01) {
        const sign = totalDelta >= 0 ? "+" : "";
        callbacks.log(`[P&L] ${sign}$${totalDelta.toFixed(2)} since last cycle (poly: ${sign}$${polyDelta.toFixed(2)}, sol: ${sign}$${solDelta.toFixed(2)})`);
      }
    }
    state.prevPolyBalance = polyBalance;
    state.prevSolBalance = solBalance;

    // Daily spend limit check
    if (DAILY_SPEND_LIMIT_USD > 0) {
      callbacks.log(`[SPEND] Today: $${state.dailySpend.toFixed(2)} / $${DAILY_SPEND_LIMIT_USD.toFixed(2)} limit`);
    }

    // Dynamic sell thresholds — per-platform
    const polySellLoss = lowPolyBalance ? SELL_LOSS_THRESHOLD_AGGRESSIVE : SELL_LOSS_THRESHOLD_NORMAL;
    const polySellProfit = lowPolyBalance ? SELL_PROFIT_THRESHOLD_AGGRESSIVE : SELL_PROFIT_THRESHOLD_NORMAL;
    const jupSellLoss = lowSolBalance ? SELL_LOSS_THRESHOLD_AGGRESSIVE : SELL_LOSS_THRESHOLD_NORMAL;
    const jupSellProfit = lowSolBalance ? SELL_PROFIT_THRESHOLD_AGGRESSIVE : SELL_PROFIT_THRESHOLD_NORMAL;

    // Collect positions (use the more aggressive threshold of the two)
    const sellLossThreshold = Math.max(polySellLoss, jupSellLoss);
    const sellProfitThreshold = Math.min(polySellProfit, jupSellProfit);
    const { ownedTitles, polySellTargets, polyAllSellable, jupSellTargets, jupAllPositions, jupClaimable } =
      await collectPositions(state, sellLossThreshold, sellProfitThreshold);

    const positionsFull = ownedTitles.size >= MAX_POSITIONS;
    if (positionsFull) {
      callbacks.log(`[AUTONOMY] ${ownedTitles.size}/${MAX_POSITIONS} positions — sell-only`);
    }

    // Determine which platforms to run based on the configured platform filter
    const runPoly = state.platform === "both" || state.platform === "polymarket";
    const runJup = state.platform === "both" || state.platform === "jupiter";

    // ========== Run POLYMARKET and JUPITER in parallel ==========
    const polyPhase = async () => {
      if (!runPoly) return;
      callbacks.log(`[POLYMARKET] ${lowPolyBalance ? "SELL-ONLY (low balance)" : "SELL + BUY"}`);
      await polymarketSellPhase(
        deps, callbacks, state,
        polySellTargets, polyAllSellable,
        polyBalance, lowPolyBalance, polySellLoss,
      );

      // Smart profit review — analyze all profitable positions every cycle
      if (polyAllSellable.length > 0) {
        await reviewAllPositions(deps, callbacks, state, "POLYMARKET",
          polyAllSellable.map((p) => ({ token: p.token, title: p.title, pnl: p.pnl, shares: p.shares, curPrice: p.curPrice })),
        );
      }

      if (positionsFull || lowPolyBalance) {
        if (lowPolyBalance) callbacks.log(`[POLYMARKET] Balance $${polyBalance.toFixed(2)} — sell-only mode`);
        return;
      }

      try {
        const scored = await scanPolymarketMarkets(ownedTitles, state, callbacks);
        const ragContext = scored.length > 0
          ? await indexAndEnrich(deps, callbacks, state, scored, "polymarket", scored[0]!.question)
          : "";
        callbacks.log(`[POLYMARKET] ${scored.length} new markets | balance: $${polyBalance.toFixed(2)}`);

        if (scored.length > 0) {
          const candidates = scored.slice(0, 5);
          const analysis = await analyzeCandidates(deps, callbacks, candidates, ragContext);
          if (analysis) {
            const marketPrice = analysis.side === "YES" ? analysis.pick.yesPrice : 1 - analysis.pick.yesPrice;

            // Reject terrible risk/reward: buying at >$0.85 means risking $0.85+ to win <$0.15
            if (marketPrice > 0.85) {
              callbacks.log(`[POLYMARKET] ❌ Skipping "${analysis.pick.question.slice(0, 50)}" — ${analysis.side} at $${marketPrice.toFixed(2)} is terrible risk/reward`);
            } else if (marketPrice < 0.10) {
              callbacks.log(`[POLYMARKET] ❌ Skipping "${analysis.pick.question.slice(0, 50)}" — ${analysis.side} at $${marketPrice.toFixed(2)} too cheap / likely resolved`);
            } else {
            const betSize = calcBetSize(analysis.pick.score, polyBalance, undefined, marketPrice);
            if (!canSpend(state, betSize)) {
              callbacks.log(`[POLYMARKET] Daily spend limit reached ($${state.dailySpend.toFixed(2)}/$${DAILY_SPEND_LIMIT_USD.toFixed(2)}) — skipping buy`);
            } else {
              callbacks.log(`[ANALYSIS:POLY] ${analysis.reason}`);
              callbacks.log(
                `[BUY:POLYMARKET] "${analysis.pick.question}" (${analysis.side}:$${marketPrice.toFixed(2)}, score:${analysis.pick.score.toFixed(2)}, size:$${betSize.toFixed(2)}, ${(analysis.pick as ScoredMarket).daysLeft?.toFixed(0) ?? "?"}d left)`,
              );
              // Mark as pending for parallel dedup (cleared each cycle)
              state.pendingBuys.add(analysis.pick.question.toLowerCase());
              // Direct CLOB API buy — bypasses LLM for reliability
              const bought = await directPolymarketBuy(deps, callbacks, state, analysis.pick.question, analysis.side, betSize, polyBalance);
              if (bought) {
                // Record trade only on success — prevents 24h cooldown on failed buys
                recordTrade(state, { question: analysis.pick.question, platform: "POLYMARKET", time: Date.now(), price: analysis.pick.yesPrice, amount: betSize });
              } else {
                state.failedBuys.set(analysis.pick.question, Date.now());
              }
            }
          }
          } // close risk/reward guard
        } else {
          callbacks.log("[POLYMARKET] No new markets to buy");
        }
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        callbacks.log(`[POLYMARKET] Scan failed: ${msg}`);
      }
    };

    const jupPhase = async () => {
      if (!runJup) return;
      callbacks.log(`[JUPITER] ${lowSolBalance ? "SELL-ONLY (low balance)" : "SELL + BUY"}`);
      await jupiterSellClaimPhase(
        deps, callbacks, state,
        jupSellTargets, jupClaimable,
        solBalance, lowSolBalance, jupSellLoss,
      );

      // Smart profit review — analyze all Jupiter positions for profit-taking
      if (jupAllPositions.length > 0) {
        await reviewAllPositions(deps, callbacks, state, "JUPITER",
          jupAllPositions.map((p) => ({ pubkey: p.pubkey, title: p.title, pnl: p.pnl, isYes: p.isYes, contracts: p.contracts })),
        );
      }

      if (positionsFull || lowSolBalance) {
        if (lowSolBalance) callbacks.log(`[JUPITER] Balance $${solBalance.toFixed(2)} — sell-only mode`);
        return;
      }

      // Skip Jupiter buying if recently hit insufficient funds (funds locked in open orders)
      if (Date.now() < state.jupBuyPausedUntil) {
        const remaining = Math.ceil((state.jupBuyPausedUntil - Date.now()) / 60_000);
        callbacks.log(`[JUPITER] Skipping buy — insufficient funds cooldown (${remaining}m remaining)`);
        return;
      }

      try {
        const jupScored = await scanJupiterMarkets(ownedTitles, state, callbacks);
        const debugInfo = (jupScored as unknown as { _debug?: string })._debug;
        if (debugInfo) callbacks.log(`[JUPITER:SCAN] ${debugInfo}`);
        const ragContext = jupScored.length > 0
          ? await indexAndEnrich(deps, callbacks, state, jupScored, "jupiter", jupScored[0]!.question)
          : "";
        callbacks.log(`[JUPITER] ${jupScored.length} new markets | SOL balance: $${solBalance.toFixed(2)}`);

        // x402 payment for analysis
        const x402ApiUrl = process.env.X402_API_URL;
        if (x402ApiUrl && jupScored.length > 0) {
          try {
            callbacks.log("[x402] Paying for market analysis on Solana...");
            await fetch(`${x402ApiUrl}/prediction`);
          } catch {}
        }

        if (jupScored.length > 0) {
          const candidates = jupScored.slice(0, 5);
          const analysis = await analyzeCandidates(deps, callbacks, candidates, ragContext);
          const pick = analysis?.pick ?? candidates[0]!;
          const side = analysis?.side ?? (pick.yesPrice < 0.5 ? "YES" : "NO");
          const reason = analysis?.reason ?? "best scored market";

          const jupMarketPrice = side === "YES" ? pick.yesPrice : 1 - pick.yesPrice;

          // Reject terrible risk/reward: buying at >$0.85 means risking $0.85+ to win <$0.15
          if (jupMarketPrice > 0.85) {
            callbacks.log(`[JUPITER] ❌ Skipping "${pick.question.slice(0, 50)}" — ${side} at $${jupMarketPrice.toFixed(2)} is terrible risk/reward (risking $${jupMarketPrice.toFixed(2)} to win $${(1 - jupMarketPrice).toFixed(2)})`);
          } else

          if (jupMarketPrice < 0.10) {
            callbacks.log(`[JUPITER] ❌ Skipping "${pick.question.slice(0, 50)}" — ${side} at $${jupMarketPrice.toFixed(2)} too cheap / likely resolved`);
          } else

          {
          const betSize = calcBetSize(pick.score, solBalance, undefined, jupMarketPrice);
          if (!canSpend(state, betSize)) {
            callbacks.log(`[JUPITER] Daily spend limit reached ($${state.dailySpend.toFixed(2)}/$${DAILY_SPEND_LIMIT_USD.toFixed(2)}) — skipping buy`);
          } else {
            callbacks.log(`[ANALYSIS:JUP] ${reason}`);
            callbacks.log(
              `[BUY:JUPITER] "${pick.question}" (${side}:$${jupMarketPrice.toFixed(2)}, score:${pick.score.toFixed(2)}, size:$${betSize.toFixed(2)}, vol:$${(pick as JupMarket).volume?.toFixed(0) ?? "0"})`,
            );
            // Mark as pending for parallel dedup
            state.pendingBuys.add(pick.question.toLowerCase());
            // Direct API buy — bypasses LLM action routing for reliable execution
            const bought = await directJupiterBuy(deps, callbacks, state, (pick as JupMarket).marketId, side, betSize, pick.question, solBalance, solUsdcBalance, solJupUsdBalance);
            if (bought) {
              recordTrade(state, { question: pick.question, platform: "JUPITER", time: Date.now(), price: pick.yesPrice, amount: betSize });
            } else if (candidates.length > 1) {
              // Fallback: re-analyze the fallback market independently (don't reuse side)
              const fallback = (candidates as JupMarket[]).find(
                (c) => c.marketId !== (pick as JupMarket).marketId && !state.failedBuys.has(c.marketId),
              );
              if (fallback) {
                const fbSide = fallback.yesPrice < 0.5 ? "YES" : "NO";
                const fbPrice = fbSide === "YES" ? fallback.yesPrice : 1 - fallback.yesPrice;
                if (fbPrice > 0.10 && fbPrice < 0.85) {
                  callbacks.log(`[BUY:JUPITER] Retrying: "${fallback.question}" (${fbSide}:$${fbPrice.toFixed(2)})`);
                  state.pendingBuys.add(fallback.question.toLowerCase());
                  const fbBought = await directJupiterBuy(deps, callbacks, state, fallback.marketId, fbSide, betSize, fallback.question, solBalance, solUsdcBalance, solJupUsdBalance);
                  if (fbBought) {
                    recordTrade(state, { question: fallback.question, platform: "JUPITER", time: Date.now(), price: fallback.yesPrice, amount: betSize });
                  }
                }
              }
            }
          }
          } // close risk/reward guard
        } else {
          callbacks.log(`[JUPITER] No new markets to buy (profit review already ran above)`);
        }
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        callbacks.log(`[JUPITER] Scan failed: ${msg}`);
      }
    };

    // Run both platforms in parallel — neither blocks the other
    await Promise.allSettled([polyPhase(), jupPhase()]);

    // Status summary
    let x402Payments = 0;
    try {
      const x402Svc = (await deps.runtime.getServiceLoadPromise(
        X402_SERVICE_TYPE,
      )) as unknown as X402SolanaService | null;
      if (x402Svc?.isActive()) x402Payments = x402Svc.getPaymentStats().count;
    } catch {}
    const cycleDuration = ((Date.now() - cycleStart) / 1000).toFixed(1);
    const spendInfo = DAILY_SPEND_LIMIT_USD > 0 ? ` | spent: $${state.dailySpend.toFixed(2)}/$${DAILY_SPEND_LIMIT_USD.toFixed(2)}` : "";
    callbacks.log(
      `[AUTONOMY] x402: ${x402Payments} payments | positions: ${ownedTitles.size}/${MAX_POSITIONS} | poly: $${polyBalance.toFixed(2)} | sol: $${solBalance.toFixed(2)}${spendInfo}`,
    );
    callbacks.log(`[AUTONOMY] Cycle #${state.cycleCount} complete in ${cycleDuration}s`);
  } catch (err) {
    const errMsg = err instanceof Error ? err.message : String(err);
    callbacks.log(`[AUTONOMY] Fatal error: ${errMsg}`);
  }

  try {
    callbacks.send({ type: "thinking", active: false });
  } catch {}
}

// --- Public API ---

/**
 * Start the autonomy loop. Returns a handle to stop it.
 */
export function startAutonomy(
  deps: AutonomyDeps,
  callbacks: AutonomyCallbacks,
  platform: AutonomyPlatform = "both",
): AutonomyHandle {
  const state = createState(platform);
  let timer: ReturnType<typeof setTimeout> | null = null;
  let heartbeatTimer: ReturnType<typeof setInterval> | null = null;
  let running = true;

  // Start heartbeat (only needed for Polymarket GTC orders)
  if (platform !== "jupiter") (async () => {
    try {
      const extSvc = (await deps.runtime.getServiceLoadPromise(
        POLYMARKET_EXT_SERVICE_TYPE,
      )) as unknown as PolymarketExtService;
      if (extSvc?.clob) {
        extSvc.clob.resetHeartbeat();
        extSvc.clob.heartbeat().catch(() => {});
        let consecutiveFailures = 0;
        heartbeatTimer = setInterval(() => {
          extSvc.clob!.heartbeat()
            .then(() => {
              if (consecutiveFailures > 0) {
                callbacks.send({ type: "action_result", text: `[HEARTBEAT] ✅ Recovered after ${consecutiveFailures} failures` });
                consecutiveFailures = 0;
              }
            })
            .catch((err) => {
              consecutiveFailures++;
              const errMsg = err instanceof Error ? err.message : String(err);
              console.warn(`autonomy: heartbeat failed (${consecutiveFailures}x): ${errMsg}`);
              if (consecutiveFailures >= HEARTBEAT_MAX_FAILURES) {
                callbacks.send({
                  type: "action_result",
                  text: `[HEARTBEAT] ⚠️ ${consecutiveFailures} consecutive failures — GTC orders at risk of auto-cancel! Error: ${errMsg}`,
                });
              }
            });
        }, HEARTBEAT_INTERVAL_MS);
        callbacks.send({
          type: "action_result",
          text: "[AUTONOMY] Heartbeat started — GTC orders protected",
        });
      }
    } catch {}
  })();

  // x402 status
  (async () => {
    try {
      const x402Svc = (await deps.runtime.getServiceLoadPromise(
        X402_SERVICE_TYPE,
      )) as unknown as X402SolanaService | null;
      if (x402Svc && x402Svc.isActive()) {
        globalThis.fetch = x402Svc.getWrappedFetch();
        callbacks.send({
          type: "action_result",
          text: `[AUTONOMY] x402 payments active — cap: $${x402Svc.getMaxPaymentUsd().toFixed(2)}/request`,
        });
      } else {
        callbacks.send({
          type: "action_result",
          text: "[AUTONOMY] x402 payments disabled — set SOLANA_PRIVATE_KEY + X402_ENABLED=true to enable",
        });
      }
    } catch {}
  })();

  // Run cycles with setTimeout chaining — next cycle only starts after previous finishes.
  // This prevents overlapping cycles when a cycle takes longer than AUTONOMY_INTERVAL_MS.
  const scheduleNext = () => {
    if (!running) return;
    timer = setTimeout(async () => {
      await runAutonomyCycle(deps, callbacks, state);
      scheduleNext();
    }, AUTONOMY_INTERVAL_MS);
  };
  // Run first cycle immediately
  runAutonomyCycle(deps, callbacks, state).then(scheduleNext);

  return {
    get isRunning() {
      return running;
    },
    get platform() {
      return platform;
    },
    stop() {
      running = false;
      if (timer) {
        clearTimeout(timer);
        timer = null;
      }
      if (heartbeatTimer) {
        clearInterval(heartbeatTimer);
        heartbeatTimer = null;
      }
    },
  };
}
