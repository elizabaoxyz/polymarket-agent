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
  RAG_SIMILARITY_WEIGHT,
  calcBetSize,
} from "./config";
import { withRetry } from "./retry";
import { AsyncMutex } from "./mutex";
import { getSolanaKeypair } from "./solana-wallet";
import { getPortfolioStatus } from "./portfolio";
import { PolymarketExtService } from "./plugins/polymarket-ext/service";
import { POLYMARKET_EXT_SERVICE_TYPE } from "./plugins/polymarket-ext/types";
import { JupiterPredictionService, JUPITER_SERVICE_TYPE } from "./plugins/jupiter-prediction/service";
import { X402SolanaService } from "./plugins/x402-solana/service";
import { X402_SERVICE_TYPE } from "./plugins/x402-solana/types";
import type { RAGService } from "./plugins/rag/service";
import type { ConnectorsService } from "./plugins/connectors/service";
import type { MarketDocument, NewsDocument } from "./plugins/rag/types";

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

export type AutonomyHandle = {
  stop: () => void;
  readonly isRunning: boolean;
};

type TradeHistoryEntry = { question: string; platform: string; time: number; price: number };

// --- Internal state ---

type AutonomyState = {
  cycleCount: number;
  tradeHistory: TradeHistoryEntry[];
  failedSells: Map<string, number>;
  failedBuys: Map<string, number>;
  recentlySold: Set<string>;
};

function createState(): AutonomyState {
  return {
    cycleCount: 0,
    tradeHistory: [],
    failedSells: new Map(),
    failedBuys: new Map(),
    recentlySold: new Set(),
  };
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

function isRecentlyTraded(state: AutonomyState, question: string): boolean {
  return state.tradeHistory.some(
    (h) => h.question.toLowerCase() === question.toLowerCase() && Date.now() - h.time < SAME_MARKET_COOLDOWN_MS,
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

    const result = await extSvc.sellOrder({ tokenId: token, price, size: shares });
    const total = (shares * price).toFixed(2);
    const statusIcon = result.status === "matched" ? "FILLED" : String(result.status).toUpperCase();
    const txInfo = result.transactionsHashes.length > 0
      ? ` | tx: ${result.transactionsHashes[0]!.slice(0, 10)}...`
      : "";
    callbacks.log(
      `[SELL:POLYMARKET] ✅ ${statusIcon}: "${title}" — ${shares} shares @ $${price.toFixed(2)} ($${total})${txInfo}`,
    );
    state.recentlySold.add(token);
    return true;
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    callbacks.log(`[SELL:POLYMARKET] ❌ "${title}" — failed: ${msg}`);
    state.failedSells.set(token, Date.now());
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
    const sellAnalysis = await sendPrompt(
      deps,
      callbacks,
      `DO NOT place any orders. You are reviewing your Polymarket positions. Today is ${new Date().toISOString().split("T")[0]}.${lowBalance ? ` IMPORTANT: Balance is critically low ($${polyBalance.toFixed(2)}). Prioritize selling to free up capital. Be aggressive — sell anything profitable.` : ""} These positions hit sell thresholds. For each one, decide SELL or HOLD.\n\n${sellList}\n\nRespond with one line per position:\n<number>: SELL or HOLD — <reason>`,
    );
    const sellText = sellAnalysis.join(" ");

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
    const recoveryAnalysis = await sendPrompt(
      deps,
      callbacks,
      `DO NOT place any orders. Our Polymarket balance is critically low ($${polyBalance.toFixed(2)}). We need to sell some positions to free up capital. Today is ${new Date().toISOString().split("T")[0]}.\n\nHere are our positions (worst-performing first):\n${positionList}\n\nWhich positions should we sell? Consider: which markets are least likely to recover? Which are dead money? Pick 1-3 positions to sell.\n\nRespond with the numbers to SELL, one per line:\n<number>: SELL — <reason>`,
    );
    const recoveryText = recoveryAnalysis.join(" ");
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

// --- Polymarket scan & buy phase ---

type ScoredMarket = {
  question: string;
  yesPrice: number;
  score: number;
  volume: number;
  daysLeft: number;
};

async function scanPolymarketMarkets(
  ownedTitles: Set<string>,
  state: AutonomyState,
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

    const spread = Math.abs(np - yp);
    const midpoint = (yp + np) / 2;
    const spreadScore = Math.max(0, 1 - spread / 0.15);
    const midScore = 1 - Math.abs(midpoint - 0.5) * 2;

    const endDate = m.end_date_iso ?? m.endDate;
    let daysLeft = 365;
    if (endDate) {
      daysLeft = Math.max(0, (new Date(endDate as string).getTime() - Date.now()) / 86400000);
      if (daysLeft < 1) continue;
    }
    const timeScore = Math.min(1, daysLeft / 30);
    const volume = Number(m.rewards?.dailyRate ?? 0);
    const volumeScore = Math.min(1, volume / 100);

    const score =
      spreadScore * SCORE_SPREAD_WEIGHT +
      midScore * SCORE_MIDPOINT_WEIGHT +
      timeScore * SCORE_TIME_WEIGHT +
      volumeScore * SCORE_VOLUME_WEIGHT;
    scored.push({ question: q, yesPrice: yp, score, volume, daysLeft });
  }
  scored.sort((a, b) => b.score - a.score);
  return scored;
}

// --- Jupiter scan ---

type JupMarket = {
  question: string;
  marketId: string;
  yesPrice: number;
  score: number;
  volume: number;
};

async function scanJupiterMarkets(
  ownedTitles: Set<string>,
  state: AutonomyState,
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
  for (const event of (evData.data ?? []).slice(0, 30)) {
    for (const m of (event.markets ?? []).filter(
      (x: Record<string, unknown>) => x.status === "open",
    )) {
      const yp = Number(m.pricing?.buyYesPriceUsd ?? 0) / 1_000_000;
      const np = Number(m.pricing?.buyNoPriceUsd ?? 0) / 1_000_000;
      if (yp < 0.05 || yp > 0.95) continue;
      const effectiveNp = np > 0 ? np : 1 - yp;
      const spread = Math.abs(effectiveNp - yp);
      const mid = (yp + effectiveNp) / 2;
      const spreadScore = Math.max(0, 1 - spread / 0.15);
      const midScore = 1 - Math.abs(mid - 0.5) * 2;
      const volume = Number(m.pricing?.volume ?? 0) / 1_000_000;
      if (volume < 0.5) continue;
      const volumeScore = Math.min(1, volume / 10000);
      const score = spreadScore * 0.35 + midScore * 0.3 + volumeScore * 0.35;
      const q = `${event.metadata?.title} — ${m.metadata?.title}`;
      if (ownedTitles.has((event.metadata?.title ?? "").toLowerCase())) continue;
      if (isRecentlyTraded(state, q)) continue;
      if (!isFailCooledDown(state.failedBuys, m.marketId, FAILED_BUY_COOLDOWN_MS)) continue;
      jupScored.push({ question: q, marketId: m.marketId, yesPrice: yp, score, volume });
    }
  }
  jupScored.sort((a, b) => b.score - a.score);
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
  markets: ScoredMarket[] | JupMarket[],
  platform: "polymarket" | "jupiter",
  topQuestion: string,
): Promise<string> {
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

    return parts.length > 0
      ? `\n\nADDITIONAL CONTEXT FOR YOUR ANALYSIS:\n${parts.join("\n\n")}\n\nUse this context to improve your prediction accuracy.`
      : "";
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    callbacks.log(`[RAG:ENRICH] Context fetch failed: ${msg}`);
    return "";
  }
}

// --- LLM analysis helpers ---

async function analyzeCandidates(
  deps: AutonomyDeps,
  callbacks: AutonomyCallbacks,
  candidates: Array<{ question: string; yesPrice: number; score: number; volume?: number; daysLeft?: number }>,
  ragContext: string,
): Promise<{ pick: (typeof candidates)[0]; side: string; reason: string } | null> {
  const candidateList = candidates
    .map((c, i) => {
      const extra = c.daysLeft !== undefined ? `, ${c.daysLeft.toFixed(0)} days left` : "";
      const vol = c.volume !== undefined ? `, vol: $${c.volume.toFixed(0)}` : "";
      return `${i + 1}. "${c.question}" — YES: $${c.yesPrice.toFixed(2)}, NO: $${(1 - c.yesPrice).toFixed(2)}, score: ${c.score.toFixed(2)}${extra}${vol}`;
    })
    .join("\n");

  callbacks.log(`[ANALYSIS] Analyzing top ${candidates.length} markets...`);
  const results = await sendPrompt(
    deps,
    callbacks,
    `DO NOT place any orders or execute any actions. Just analyze these prediction markets and tell me which one is the best bet and why. Today is ${new Date().toISOString().split("T")[0]}.\n\n${candidateList}${ragContext}\n\nRespond in this EXACT format:\nPICK: <number 1-${candidates.length}>\nSIDE: <YES or NO>\nREASON: <one sentence why>`,
  );
  const text = results.join(" ");
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

  // Fallback: simple YES/NO on top pick
  const pick = candidates[0]!;
  callbacks.log(`[ANALYSIS] Structured response failed (got: "${text.slice(0, 80)}"), asking simpler question...`);
  const fallback = await sendPrompt(
    deps,
    callbacks,
    `DO NOT place any orders. Answer only YES or NO. Today is ${new Date().toISOString().split("T")[0]}. Should I bet YES or NO on: "${pick.question}"? Current YES price: $${pick.yesPrice.toFixed(2)}. Reply with just YES or NO and why.`,
  );
  const fbText = fallback.join(" ");
  const yesNo = /\b(YES|NO)\b/i.exec(fbText);
  if (!yesNo) {
    // Last resort: use price-based heuristic instead of skipping entirely
    const heuristicSide = pick.yesPrice < 0.5 ? "YES" : "NO";
    callbacks.log(`[ANALYSIS] LLM can't decide ("${fbText.slice(0, 60)}") — using price heuristic: ${heuristicSide}`);
    return {
      pick,
      side: heuristicSide,
      reason: `price heuristic (YES=$${pick.yesPrice.toFixed(2)})`,
    };
  }
  return {
    pick,
    side: yesNo[1]!.toUpperCase(),
    reason: fbText.slice(0, 100) || "fallback analysis",
  };
}

// --- Collect owned positions ---

type PolySellTarget = { token: string; shares: number; title: string; pnl: number; curPrice: number };
type JupSellTarget = { marketId: string; pubkey: string; title: string; pnl: number };
type JupClaimTarget = { pubkey: string; title: string; payout: number };

async function collectPositions(
  state: AutonomyState,
  sellLossThreshold: number,
  sellProfitThreshold: number,
): Promise<{
  ownedTitles: Set<string>;
  polySellTargets: PolySellTarget[];
  polyAllSellable: PolySellTarget[];
  jupSellTargets: JupSellTarget[];
  jupClaimable: JupClaimTarget[];
}> {
  const ownedTitles = new Set<string>();
  const polySellTargets: PolySellTarget[] = [];
  const polyAllSellable: PolySellTarget[] = [];
  const jupSellTargets: JupSellTarget[] = [];
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
          if (isRecentlyTraded(state, pos.title ?? "")) continue;
          if (pnl <= -95) continue;
          if (price < 0.05) continue;
          if (!isFailCooledDown(state.failedSells, pos.asset, FAILED_SELL_COOLDOWN_MS)) continue;
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
          if (isRecentlyTraded(state, title)) continue;
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

  return { ownedTitles, polySellTargets, polyAllSellable, jupSellTargets, jupClaimable };
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
    const jupSellAnalysis = await sendPrompt(
      deps,
      callbacks,
      `DO NOT place any orders. You are reviewing your Jupiter/Solana positions. Today is ${new Date().toISOString().split("T")[0]}.${lowSolBalance ? ` IMPORTANT: Balance is critically low ($${solBalance.toFixed(2)}). Prioritize selling to free up capital.` : ""} These positions hit sell thresholds. For each one, decide SELL or HOLD.\n\n${jupSellList}\n\nRespond with one line per position:\n<number>: SELL or HOLD — <reason>`,
    );
    const jupSellText = jupSellAnalysis.join(" ");

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
          state.recentlySold.add(sell.pubkey);
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
  state.cycleCount++;
  try {
    callbacks.send({ type: "thinking", active: true });
  } catch {}

  const isPolymarketCycle = state.cycleCount % 2 === 1;
  const platform = isPolymarketCycle ? "POLYMARKET" : "JUPITER";
  const ragActive = deps.ragSvc?.isActive() === true;
  const connectorsActive = deps.connectorsSvc?.isActive() === true;

  try {
    callbacks.log(
      `[AUTONOMY:${platform}] Cycle #${state.cycleCount} — ${isPolymarketCycle ? "Polygon" : "Solana + x402"}`,
    );
    if (ragActive) callbacks.log("[RAG] ChromaDB online");
    if (connectorsActive) callbacks.log("[CONNECTORS] News + Search online");

    // Get balances
    const portfolioStatus = await getPortfolioStatus(deps.runtime);
    const polyBalance = portfolioStatus.balance;
    const solBalance = portfolioStatus.solanaBalance;
    const lowPolyBalance = polyBalance < LOW_BALANCE_THRESHOLD;
    const lowSolBalance = solBalance < LOW_BALANCE_THRESHOLD;
    callbacks.log(
      `[BALANCE] Polygon: $${polyBalance.toFixed(2)} | Solana: $${solBalance.toFixed(2)} (USDC+JupUSD)`,
    );

    // Dynamic sell thresholds
    const sellLossThreshold = lowPolyBalance || lowSolBalance
      ? SELL_LOSS_THRESHOLD_AGGRESSIVE
      : SELL_LOSS_THRESHOLD_NORMAL;
    const sellProfitThreshold = lowPolyBalance || lowSolBalance
      ? SELL_PROFIT_THRESHOLD_AGGRESSIVE
      : SELL_PROFIT_THRESHOLD_NORMAL;

    // Collect positions
    const { ownedTitles, polySellTargets, polyAllSellable, jupSellTargets, jupClaimable } =
      await collectPositions(state, sellLossThreshold, sellProfitThreshold);

    // ========== POLYMARKET CYCLE ==========
    if (isPolymarketCycle || lowPolyBalance) {
      await polymarketSellPhase(
        deps,
        callbacks,
        state,
        polySellTargets,
        polyAllSellable,
        polyBalance,
        lowPolyBalance,
        sellLossThreshold,
      );

      // Scan and buy
      if (ownedTitles.size >= MAX_POSITIONS) {
        callbacks.log(`[AUTONOMY] ${ownedTitles.size}/${MAX_POSITIONS} positions — full, selling only`);
      } else if (polyBalance < LOW_BALANCE_THRESHOLD) {
        if (polySellTargets.length === 0 && polyAllSellable.length === 0) {
          callbacks.log(
            `[AUTONOMY:POLYMARKET] Balance too low ($${polyBalance.toFixed(2)}) — waiting for sells`,
          );
        }
      } else {
        try {
          const scored = await scanPolymarketMarkets(ownedTitles, state);
          const ragContext = scored.length > 0
            ? await indexAndEnrich(deps, callbacks, scored, "polymarket", scored[0]!.question)
            : "";
          callbacks.log(
            `[AUTONOMY:POLYMARKET] ${scored.length} new markets | balance: $${polyBalance.toFixed(2)}`,
          );

          if (scored.length > 0) {
            const candidates = scored.slice(0, 5);
            const analysis = await analyzeCandidates(deps, callbacks, candidates, ragContext);
            if (analysis) {
              const betSize = calcBetSize(analysis.pick.score, polyBalance);
              callbacks.log(`[ANALYSIS] ${analysis.reason}`);
              callbacks.log(
                `[BUY:POLYMARKET] "${analysis.pick.question}" (${analysis.side}:$${analysis.pick.yesPrice.toFixed(2)}, score:${analysis.pick.score.toFixed(2)}, $${betSize.toFixed(2)}, ${(analysis.pick as ScoredMarket).daysLeft?.toFixed(0) ?? "?"}d left)`,
              );
              await sendPrompt(
                deps,
                callbacks,
                `buy $${betSize.toFixed(0)} ${analysis.side} on "${analysis.pick.question}" on polymarket`,
              );
              recordTrade(state, {
                question: analysis.pick.question,
                platform: "POLYMARKET",
                time: Date.now(),
                price: analysis.pick.yesPrice,
              });
            }
          } else {
            callbacks.log("[AUTONOMY:POLYMARKET] No new markets to buy");
          }
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err);
          callbacks.log(`[AUTONOMY:POLYMARKET] Scan failed: ${msg}`);
        }
      }
    }

    // ========== JUPITER CYCLE ==========
    if (!isPolymarketCycle || lowSolBalance) {
      await jupiterSellClaimPhase(
        deps,
        callbacks,
        state,
        jupSellTargets,
        jupClaimable,
        solBalance,
        lowSolBalance,
        sellLossThreshold,
      );

      // Jupiter buy (only on Jupiter cycles)
      if (!isPolymarketCycle) {
        if (solBalance < LOW_BALANCE_THRESHOLD) {
          callbacks.log(
            `[AUTONOMY:JUPITER] Solana balance too low ($${solBalance.toFixed(2)}) — skipping buy`,
          );
        } else {
          try {
            const jupScored = await scanJupiterMarkets(ownedTitles, state);
            const ragContext =
              jupScored.length > 0
                ? await indexAndEnrich(
                    deps,
                    callbacks,
                    jupScored,
                    "jupiter",
                    jupScored[0]!.question,
                  )
                : "";
            callbacks.log(
              `[AUTONOMY:JUPITER] ${jupScored.length} new markets | SOL balance: $${solBalance.toFixed(2)}`,
            );

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

              const betSize = calcBetSize(pick.score, solBalance);
              callbacks.log(`[ANALYSIS] ${reason}`);
              callbacks.log(
                `[BUY:JUPITER] "${pick.question}" (${side}:$${pick.yesPrice.toFixed(2)}, score:${pick.score.toFixed(2)}, $${betSize.toFixed(2)}, vol:$${(pick as JupMarket).volume?.toFixed(0) ?? "0"})`,
              );
              const betResults = await sendPrompt(
                deps,
                callbacks,
                `bet $${betSize.toFixed(0)} ${side} on jupiter market ${(pick as JupMarket).marketId}`,
              );
              const betFailed = betResults.some((r) =>
                /failed|error|no shares|no buyers/i.test(r),
              );
              if (betFailed) {
                state.failedBuys.set((pick as JupMarket).marketId, Date.now());
                if (candidates.length > 1) {
                  const fallback = (candidates as JupMarket[]).find(
                    (c) =>
                      c.marketId !== (pick as JupMarket).marketId &&
                      !state.failedBuys.has(c.marketId),
                  );
                  if (fallback) {
                    callbacks.log(`[BUY:JUPITER] Retrying: "${fallback.question}" (${side})`);
                    const fbResults = await sendPrompt(
                      deps,
                      callbacks,
                      `bet $${betSize.toFixed(0)} ${side} on jupiter market ${fallback.marketId}`,
                    );
                    if (fbResults.some((r) => /failed|error|no shares|no buyers/i.test(r))) {
                      state.failedBuys.set(fallback.marketId, Date.now());
                    }
                  }
                }
              }
              recordTrade(state, {
                question: pick.question,
                platform: "JUPITER",
                time: Date.now(),
                price: pick.yesPrice,
              });
            } else {
              callbacks.log("[AUTONOMY:JUPITER] No new markets to buy");
            }
          } catch (err) {
            const msg = err instanceof Error ? err.message : String(err);
            callbacks.log(`[AUTONOMY:JUPITER] Scan failed: ${msg}`);
          }
        }
      }
    }

    // Status summary
    if (!isPolymarketCycle) {
      let x402Payments = 0;
      try {
        const x402Svc = (await deps.runtime.getServiceLoadPromise(
          X402_SERVICE_TYPE,
        )) as unknown as X402SolanaService | null;
        if (x402Svc?.isActive()) x402Payments = x402Svc.getPaymentStats().count;
      } catch {}
      callbacks.log(
        `[AUTONOMY] x402: ${x402Payments} payments | positions: ${ownedTitles.size}/${MAX_POSITIONS}`,
      );
    } else {
      callbacks.log(`[AUTONOMY] positions: ${ownedTitles.size}/${MAX_POSITIONS}`);
    }

    callbacks.log("[AUTONOMY] Cycle complete.");
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
): AutonomyHandle {
  const state = createState();
  let timer: ReturnType<typeof setInterval> | null = null;
  let heartbeatTimer: ReturnType<typeof setInterval> | null = null;
  let running = true;

  // Start heartbeat
  (async () => {
    try {
      const extSvc = (await deps.runtime.getServiceLoadPromise(
        POLYMARKET_EXT_SERVICE_TYPE,
      )) as unknown as PolymarketExtService;
      if (extSvc?.clob) {
        extSvc.clob.resetHeartbeat();
        extSvc.clob.heartbeat().catch(() => {});
        heartbeatTimer = setInterval(() => {
          extSvc.clob!.heartbeat().catch((err) => {
            const errMsg = err instanceof Error ? err.message : String(err);
            console.warn(`autonomy: heartbeat failed: ${errMsg}`);
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

  // Run first cycle immediately, then on interval
  runAutonomyCycle(deps, callbacks, state);
  timer = setInterval(() => runAutonomyCycle(deps, callbacks, state), AUTONOMY_INTERVAL_MS);

  return {
    get isRunning() {
      return running;
    },
    stop() {
      running = false;
      if (timer) {
        clearInterval(timer);
        timer = null;
      }
      if (heartbeatTimer) {
        clearInterval(heartbeatTimer);
        heartbeatTimer = null;
      }
    },
  };
}
