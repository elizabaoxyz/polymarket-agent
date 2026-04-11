/**
 * Autonomy loop — slim orchestrator.
 * Manages the autonomous trading cycle across Polymarket and Jupiter.
 *
 * Extracted modules:
 *   autonomy-state.ts  — types + state management
 *   autonomy-llm.ts    — LLM calls (direct HTTP + elizaOS fallback)
 *   autonomy-scanner.ts — market scanning/scoring
 *   autonomy-trade.ts  — direct buy/sell execution
 *   autonomy-sell.ts   — sell phases + position review
 *   autonomy-rag.ts    — RAG indexing + enrichment
 */

import {
  MAX_POSITIONS,
  LOW_BALANCE_THRESHOLD,
  SELL_LOSS_THRESHOLD_NORMAL,
  SELL_LOSS_THRESHOLD_AGGRESSIVE,
  SELL_PROFIT_THRESHOLD_NORMAL,
  SELL_PROFIT_THRESHOLD_AGGRESSIVE,
  AUTONOMY_INTERVAL_MS,
  HEARTBEAT_INTERVAL_MS,
  DAILY_SPEND_LIMIT_USD,
  HEARTBEAT_MAX_FAILURES,
  MIN_REWARD_RATIO,
  MIN_BET_SIZE_JUP,
  calcKellyBetSize,
  MAX_BUYS_PER_CYCLE,
  SECOND_BUY_MIN_EDGE,
  SECOND_BUY_MIN_CONFIDENCE,
} from "./config";
import { getSolanaKeypair, getCachedSolanaBalanceBreakdown } from "./solana-wallet";
import { getPortfolioStatus } from "./portfolio";
import { PolymarketExtService } from "./plugins/polymarket-ext/service";
import { POLYMARKET_EXT_SERVICE_TYPE } from "./plugins/polymarket-ext/types";
import { JupiterPredictionService, JUPITER_SERVICE_TYPE } from "./plugins/jupiter-prediction/service";
import { X402SolanaService } from "./plugins/x402-solana/service";
import { X402_SERVICE_TYPE } from "./plugins/x402-solana/types";

// Re-export public types from state module
export type {
  AutonomyDeps,
  AutonomyCallbacks,
  AutonomyPlatform,
  AutonomyHandle,
} from "./autonomy-state";

import {
  type AutonomyDeps,
  type AutonomyCallbacks,
  type AutonomyPlatform,
  type AutonomyHandle,
  type AutonomyState,
  createState,
  housekeep,
  canSpend,
  recordTrade,
  seedStateFromTradeHistory,
} from "./autonomy-state";

import { directLlmCall, ensembleLlmCall } from "./autonomy-llm";
import { scanPolymarketMarkets, scanJupiterMarkets, type ScoredMarket, type JupMarket } from "./autonomy-scanner";
import { indexAndEnrich } from "./autonomy-rag";
import { directPolymarketBuy, directJupiterBuy } from "./autonomy-trade";
import {
  collectPositions,
  unifiedPortfolioReview,
  claimJupiterPositions,
} from "./autonomy-sell";

// --- LLM analysis ---

export type AnalysisResult = {
  pick: { question: string; yesPrice: number; score: number; volume?: number; daysLeft?: number; intel?: import("./market-intel").MarketIntel | null };
  side: string;
  reason: string;
  edge: number;       // 0-1: how big the edge is
  confidence: number;  // 0-1: how confident the LLM is
  category: string;    // market category for logging
  estimatedProb: number; // LLM's estimated true probability
};

async function analyzeCandidates(
  deps: AutonomyDeps,
  callbacks: AutonomyCallbacks,
  candidates: Array<{ question: string; yesPrice: number; score: number; volume?: number; daysLeft?: number; intel?: import("./market-intel").MarketIntel | null }>,
  ragContext: string,
): Promise<AnalysisResult[]> {
  const { formatIntelForPrompt } = await import("./market-intel");
  const { MIN_EDGE_THRESHOLD, MIN_CONFIDENCE_THRESHOLD } = await import("./config");

  const today = new Date().toISOString().split("T")[0];

  const candidateList = candidates
    .map((c, i) => {
      const yesPrice = c.yesPrice;
      const noPrice = 1 - c.yesPrice;
      const yesRR = yesPrice > 0 ? ((1 - yesPrice) / yesPrice).toFixed(2) : "∞";
      const noRR = noPrice > 0 ? ((1 - noPrice) / noPrice).toFixed(2) : "∞";
      const extra = c.daysLeft !== undefined ? `, ${c.daysLeft.toFixed(0)} days to resolve` : "";
      const vol = c.volume !== undefined ? `, $${c.volume.toFixed(0)} volume` : "";
      const intelStr = c.intel ? formatIntelForPrompt(c.intel) : "";
      return `${i + 1}. "${c.question}"
   YES price: $${yesPrice.toFixed(2)} → risk $${yesPrice.toFixed(2)} to win $${(1 - yesPrice).toFixed(2)} (ratio ${yesRR}:1)
   NO  price: $${noPrice.toFixed(2)} → risk $${noPrice.toFixed(2)} to win $${yesPrice.toFixed(2)} (ratio ${noRR}:1)
   liquidity score: ${c.score.toFixed(2)}${extra}${vol}${intelStr}`;
    })
    .join("\n\n");

  callbacks.log(`[ANALYSIS] Analyzing top ${candidates.length} markets (ensemble)...`);
  for (const c of candidates) {
    callbacks.log(`[ANALYSIS:CANDIDATE] "${c.question.slice(0, 60)}" YES:$${c.yesPrice.toFixed(2)} score:${c.score.toFixed(2)} vol:$${c.volume?.toFixed(0) ?? "?"}`);
  }

  const structuredPrompt = `You are an expert prediction market analyst. Today is ${today}.
Your job is to find genuine mispricings — markets where the true probability differs significantly from the price.

You manage a SMALL portfolio (under $50). Capital efficiency is critical.
PRIORITIZE: Markets resolving within 1-7 days (fastest capital turnover).
AVOID: Markets > 14 days out unless edge is exceptionally large (> 20%).
A $3 bet that returns $4.50 in 3 days is BETTER than a $3 bet that returns $6 in 30 days.

${candidateList}${ragContext}

=== ANALYSIS FRAMEWORK ===

For each market, work through these steps mentally:

STEP 1 — CATEGORIZE: SPORTS | POLITICS | CRYPTO | CULTURE | TECH | OTHER
STEP 2 — DECOMPOSE probability: base rate + adjustments for this specific instance
STEP 3 — CALCULATE edge: your estimate MINUS market price (for your chosen side)
STEP 4 — CHECK risk/reward: ratio = (1 - price) / price. Minimum 1.0:1.
STEP 5 — CONFIDENCE: 0.0-1.0. HIGH(0.8+)=clear facts. MED(0.5-0.8)=some unknowns. LOW(<0.5)=speculation.

=== OUTPUT FORMAT ===

Rank ALL viable markets. For each, output a PICK block (up to 3 markets):

PICK: <market number, or 0 to SKIP all>
SIDE: YES or NO
ESTIMATE: <true probability 0.00-1.00 for YES>
EDGE: <calculated edge 0.00-0.50>
CONFIDENCE: <0.0-1.0>
CATEGORY: <SPORTS|POLITICS|CRYPTO|CULTURE|TECH|OTHER>
REASON: <one sentence strongest evidence>

If multiple markets are viable, add more blocks separated by a blank line.
Rank by edge × confidence descending. Only include markets with edge >= 10% AND confidence >= 0.6.
If no market qualifies, respond PICK: 0

RULES:
- Rank by BIGGEST edge AND highest confidence
- It is ALWAYS better to skip than to make a mediocre bet
- Never pick a side where price > $0.75 (terrible risk/reward) or < $0.15 (likely resolved)
- Diversify: if multiple picks, prefer different CATEGORIES
- Heavily prioritize markets resolving SOON (1-7 days) — faster resolution = faster compounding
- With small balance, ONE good high-conviction pick is better than two mediocre ones`;

  const text = await ensembleLlmCall(deps, callbacks, structuredPrompt, 1000);

  if (text.length === 0) {
    callbacks.log(`[ANALYSIS] LLM returned empty`);
    return [];
  }

  callbacks.log(`[ANALYSIS] LLM: "${text.slice(0, 300)}"`);

  // Parse multiple PICK blocks
  const results: AnalysisResult[] = [];
  const blocks = text.split(/\n\s*\n/).filter((b) => /PICK:/i.test(b));
  const blocksToProcess = blocks.length > 0 ? blocks : [text];

  for (const block of blocksToProcess) {
    const pickMatch = /PICK:\s*(\d+)/i.exec(block);
    const sideMatch = /SIDE:\s*(YES|NO)/i.exec(block);
    const estimateMatch = /ESTIMATE:\s*([\d.]+)/i.exec(block);
    const edgeMatch = /EDGE:\s*([\d.]+)/i.exec(block);
    const confidenceMatch = /CONFIDENCE:\s*([\d.]+)/i.exec(block);
    const categoryMatch = /CATEGORY:\s*(\w+)/i.exec(block);
    const reasonMatch = /REASON:\s*(.+)/i.exec(block);

    if (!sideMatch) continue;

    const pickNum = pickMatch ? Number.parseInt(pickMatch[1]!) : 0;
    if (pickNum === 0) continue;

    const pickIdx = Math.min(pickNum - 1, candidates.length - 1);
    const pick = candidates[Math.max(0, pickIdx)]!;
    const side = sideMatch[1]!.toUpperCase();
    const edge = edgeMatch ? Math.min(0.5, Number.parseFloat(edgeMatch[1]!)) : 0.10;
    const confidence = confidenceMatch ? Math.min(1.0, Number.parseFloat(confidenceMatch[1]!)) : 0.5;
    const estimatedProb = estimateMatch ? Number.parseFloat(estimateMatch[1]!) : pick.yesPrice;
    const category = categoryMatch ? categoryMatch[1]!.toUpperCase() : "OTHER";
    const reason = reasonMatch ? reasonMatch[1]!.trim() : "";

    if (edge < MIN_EDGE_THRESHOLD) {
      callbacks.log(`[ANALYSIS] ❌ Edge ${edge.toFixed(2)} below minimum ${MIN_EDGE_THRESHOLD} — skipping "${pick.question.slice(0, 50)}"`);
      continue;
    }
    if (confidence < MIN_CONFIDENCE_THRESHOLD) {
      callbacks.log(`[ANALYSIS] ❌ Confidence ${confidence.toFixed(2)} below minimum ${MIN_CONFIDENCE_THRESHOLD} — skipping "${pick.question.slice(0, 50)}"`);
      continue;
    }

    callbacks.log(`[ANALYSIS] ✅ #${results.length + 1} ${category} | ${side} | edge=${edge.toFixed(2)} | conf=${confidence.toFixed(2)} | est=${estimatedProb.toFixed(2)} | "${reason.slice(0, 80)}"`);

    results.push({ pick, side, reason, edge, confidence, category, estimatedProb });
  }

  if (results.length === 0) {
    const yesNo = /\b(YES|NO)\b/i.exec(text);
    if (yesNo) {
      return [{ pick: candidates[0]!, side: yesNo[1]!.toUpperCase(), reason: text.slice(0, 100), edge: 0.10, confidence: 0.5, category: "OTHER", estimatedProb: candidates[0]!.yesPrice }];
    }
    callbacks.log(`[ANALYSIS] Skipping — no valid picks produced`);
  }

  return results;
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

  // On first cycle, seed state from Polymarket trade history so we don't
  // re-buy markets we recently sold (survives redeploys)
  if (state.cycleCount === 1) {
    try {
      await seedStateFromTradeHistory(state);
      if (state.recentlySoldQuestions.size > 0) {
        callbacks.log(`[AUTONOMY] Seeded ${state.recentlySoldQuestions.size} recently-sold markets from trade history`);
      }
      if (state.tradeHistory.length > 0) {
        callbacks.log(`[AUTONOMY] Seeded ${state.tradeHistory.length} recent trades from history`);
      }
    } catch {}
  }

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

    const solBreakdown = await getCachedSolanaBalanceBreakdown();
    let solUsdcBalance = solBreakdown.usdc;
    let solJupUsdBalance = solBreakdown.jupUsd;

    // Subtract locked order deposits from Solana balance
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

    if (DAILY_SPEND_LIMIT_USD > 0) {
      callbacks.log(`[SPEND] Today: $${state.dailySpend.toFixed(2)} / $${DAILY_SPEND_LIMIT_USD.toFixed(2)} limit`);
    }

    // Dynamic sell thresholds
    const polySellLoss = lowPolyBalance ? SELL_LOSS_THRESHOLD_AGGRESSIVE : SELL_LOSS_THRESHOLD_NORMAL;
    const polySellProfit = lowPolyBalance ? SELL_PROFIT_THRESHOLD_AGGRESSIVE : SELL_PROFIT_THRESHOLD_NORMAL;
    const jupSellLoss = lowSolBalance ? SELL_LOSS_THRESHOLD_AGGRESSIVE : SELL_LOSS_THRESHOLD_NORMAL;
    const jupSellProfit = lowSolBalance ? SELL_PROFIT_THRESHOLD_AGGRESSIVE : SELL_PROFIT_THRESHOLD_NORMAL;

    const sellLossThreshold = Math.min(polySellLoss, jupSellLoss);
    const sellProfitThreshold = Math.max(polySellProfit, jupSellProfit);
    const { ownedTitles, polySellTargets, polyAllSellable, jupSellTargets, jupAllPositions, jupClaimable } =
      await collectPositions(state, sellLossThreshold, sellProfitThreshold);

    const activePositions = ownedTitles.size - state.stuckDust.size;
    const positionsFull = activePositions >= MAX_POSITIONS;
    if (positionsFull) {
      callbacks.log(`[AUTONOMY] ${activePositions}/${MAX_POSITIONS} positions — sell-only${state.stuckDust.size > 0 ? ` (${state.stuckDust.size} stuck dust excluded)` : ""}`);
    }

    const runPoly = state.platform === "both" || state.platform === "polymarket";
    const runJup = state.platform === "both" || state.platform === "jupiter";

    // ========== Run POLYMARKET and JUPITER in parallel ==========
    const polyPhase = async () => {
      if (!runPoly) return;
      callbacks.log(`[POLYMARKET] ${lowPolyBalance ? "SELL-ONLY (low balance)" : "SELL + BUY"}`);
      // Claim + unified sell+review for all Polymarket positions
      await unifiedPortfolioReview(
        deps, callbacks, state, "POLYMARKET",
        polyAllSellable.map((p) => ({ token: p.token, title: p.title, pnl: p.pnl, shares: p.shares, curPrice: p.curPrice })),
        polyBalance, lowPolyBalance,
      );

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
          const analyses = await analyzeCandidates(deps, callbacks, candidates, ragContext);

          // Mark all analyzed candidates so next cycle picks fresh ones
          for (const c of candidates) {
            state.recentlyAnalyzed.set(c.question.toLowerCase(), Date.now());
          }

          let buyCount = 0;
          let remainingBalance = polyBalance;

          for (let ai = 0; ai < analyses.length && buyCount < MAX_BUYS_PER_CYCLE; ai++) {
            const analysis = analyses[ai]!;

            // Second+ buy requires higher bar
            if (buyCount > 0) {
              if (analysis.edge < SECOND_BUY_MIN_EDGE) {
                callbacks.log(`[POLYMARKET] Pick #${ai + 1} edge ${analysis.edge.toFixed(2)} below second-buy minimum ${SECOND_BUY_MIN_EDGE} — stopping`);
                break;
              }
              if (analysis.confidence < SECOND_BUY_MIN_CONFIDENCE) {
                callbacks.log(`[POLYMARKET] Pick #${ai + 1} confidence ${analysis.confidence.toFixed(2)} below second-buy minimum — stopping`);
                break;
              }
              if (ai > 0 && analyses[ai - 1]?.category === analysis.category) {
                callbacks.log(`[POLYMARKET] Pick #${ai + 1} same category (${analysis.category}) as previous — skipping for diversification`);
                continue;
              }
            }

            const marketPrice = analysis.side === "YES" ? analysis.pick.yesPrice : 1 - analysis.pick.yesPrice;
            const polyRewardRatio = marketPrice > 0 ? (1 - marketPrice) / marketPrice : 0;

            if (marketPrice > 0.75) {
              callbacks.log(`[POLYMARKET] ❌ Skipping "${analysis.pick.question.slice(0, 50)}" — ${analysis.side} at $${marketPrice.toFixed(2)} terrible risk/reward`);
              state.skippedMarkets.set(analysis.pick.question.toLowerCase(), Date.now());
              continue;
            }
            if (marketPrice < 0.15) {
              callbacks.log(`[POLYMARKET] ❌ Skipping "${analysis.pick.question.slice(0, 50)}" — ${analysis.side} at $${marketPrice.toFixed(2)} too cheap`);
              state.skippedMarkets.set(analysis.pick.question.toLowerCase(), Date.now());
              continue;
            }
            if (polyRewardRatio < MIN_REWARD_RATIO) {
              callbacks.log(`[POLYMARKET] ❌ Skipping "${analysis.pick.question.slice(0, 50)}" — ratio ${polyRewardRatio.toFixed(1)}:1 below minimum`);
              state.skippedMarkets.set(analysis.pick.question.toLowerCase(), Date.now());
              continue;
            }

            const kellyProb = analysis.side === "YES" ? analysis.estimatedProb : 1 - analysis.estimatedProb;
            const betSize = calcKellyBetSize({
              estimatedProb: kellyProb,
              marketPrice,
              confidence: analysis.confidence,
              balance: remainingBalance,
            });

            if (!canSpend(state, betSize)) {
              callbacks.log(`[POLYMARKET] Daily spend limit reached — skipping buy`);
              break;
            }

            if (remainingBalance < betSize) {
              callbacks.log(`[POLYMARKET] Insufficient balance ($${remainingBalance.toFixed(2)}) for $${betSize.toFixed(2)} bet — stopping`);
              break;
            }

            callbacks.log(`[BUY:POLYMARKET] #${buyCount + 1} "${analysis.pick.question}" (${analysis.side}:$${marketPrice.toFixed(2)}, kelly:$${betSize.toFixed(2)}, edge:${analysis.edge.toFixed(2)}, conf:${analysis.confidence.toFixed(2)}, est:${analysis.estimatedProb.toFixed(2)})`);
            state.pendingBuys.add(analysis.pick.question.toLowerCase());
            const bought = await directPolymarketBuy(deps, callbacks, state, analysis.pick.question, analysis.side, betSize, remainingBalance, (analysis.pick as ScoredMarket).tokenId, marketPrice, (analysis.pick as ScoredMarket).noTokenId);
            if (bought) {
              recordTrade(state, { question: analysis.pick.question, platform: "POLYMARKET", time: Date.now(), price: analysis.pick.yesPrice, amount: betSize });
              remainingBalance -= betSize;
              buyCount++;
            } else {
              state.failedBuys.set(analysis.pick.question, Date.now());
            }
          }

          if (analyses.length === 0) {
            for (const c of candidates) {
              state.skippedMarkets.set(c.question.toLowerCase(), Date.now());
            }
          }
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
      // Claim settled Jupiter positions first
      await claimJupiterPositions(deps, callbacks, state, jupClaimable);
      // Unified sell+review for all Jupiter positions
      await unifiedPortfolioReview(
        deps, callbacks, state, "JUPITER",
        jupAllPositions.map((p) => ({ pubkey: p.pubkey, title: p.title, pnl: p.pnl, isYes: p.isYes, contracts: p.contracts, curPrice: p.curPrice })),
        solBalance, lowSolBalance,
      );

      if (positionsFull || lowSolBalance) {
        if (lowSolBalance) callbacks.log(`[JUPITER] Balance $${solBalance.toFixed(2)} — sell-only mode`);
        return;
      }

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

        const x402ApiUrl = process.env.X402_API_URL;
        if (x402ApiUrl && jupScored.length > 0) {
          try {
            callbacks.log("[x402] Paying for market analysis on Solana...");
            await fetch(`${x402ApiUrl}/prediction`);
          } catch {}
        }

        if (jupScored.length > 0) {
          const candidates = jupScored.slice(0, 5);
          const analyses = await analyzeCandidates(deps, callbacks, candidates, ragContext);

          // Mark all analyzed candidates so next cycle picks fresh ones
          for (const c of candidates) {
            state.recentlyAnalyzed.set(c.question.toLowerCase(), Date.now());
          }

          if (analyses.length === 0) {
            for (const c of candidates) {
              state.skippedMarkets.set(c.question.toLowerCase(), Date.now());
            }
            callbacks.log("[JUPITER] No high-conviction pick — skipping buy this cycle");
          } else {
            let buyCount = 0;
            let remainingBalance = solBalance;

            for (let ai = 0; ai < analyses.length && buyCount < MAX_BUYS_PER_CYCLE; ai++) {
              const analysis = analyses[ai]!;
              const pick = analysis.pick;
              const side = analysis.side;

              if (buyCount > 0) {
                if (analysis.edge < SECOND_BUY_MIN_EDGE || analysis.confidence < SECOND_BUY_MIN_CONFIDENCE) {
                  callbacks.log(`[JUPITER] Pick #${ai + 1} below second-buy threshold — stopping`);
                  break;
                }
                if (ai > 0 && analyses[ai - 1]?.category === analysis.category) {
                  callbacks.log(`[JUPITER] Pick #${ai + 1} same category — skipping`);
                  continue;
                }
              }

              const jupMarketPrice = side === "YES" ? pick.yesPrice : 1 - pick.yesPrice;
              const jupRewardRatio = jupMarketPrice > 0 ? (1 - jupMarketPrice) / jupMarketPrice : 0;

              if (jupMarketPrice > 0.75) {
                callbacks.log(`[JUPITER] ❌ Skipping "${pick.question.slice(0, 50)}" — terrible risk/reward`);
                state.skippedMarkets.set(pick.question.toLowerCase(), Date.now());
                continue;
              }
              if (jupMarketPrice < 0.15) {
                callbacks.log(`[JUPITER] ❌ Skipping "${pick.question.slice(0, 50)}" — too cheap`);
                state.skippedMarkets.set(pick.question.toLowerCase(), Date.now());
                continue;
              }
              if (jupRewardRatio < MIN_REWARD_RATIO) {
                callbacks.log(`[JUPITER] ❌ Skipping "${pick.question.slice(0, 50)}" — ratio below minimum`);
                state.skippedMarkets.set(pick.question.toLowerCase(), Date.now());
                continue;
              }

              const kellyProb = analysis.side === "YES" ? analysis.estimatedProb : 1 - analysis.estimatedProb;
              const betSize = calcKellyBetSize({
                estimatedProb: kellyProb,
                marketPrice: jupMarketPrice,
                confidence: analysis.confidence,
                balance: remainingBalance,
                minBet: MIN_BET_SIZE_JUP,
              });

              if (!canSpend(state, betSize)) {
                callbacks.log(`[JUPITER] Daily spend limit reached — stopping`);
                break;
              }

              callbacks.log(`[BUY:JUPITER] #${buyCount + 1} "${pick.question}" (${side}:$${jupMarketPrice.toFixed(2)}, kelly:$${betSize.toFixed(2)}, edge:${analysis.edge.toFixed(2)}, conf:${analysis.confidence.toFixed(2)}, est:${analysis.estimatedProb.toFixed(2)})`);
              state.pendingBuys.add(pick.question.toLowerCase());
              const bought = await directJupiterBuy(deps, callbacks, state, (pick as JupMarket).marketId, side, betSize, pick.question, remainingBalance, solUsdcBalance, solJupUsdBalance);
              if (bought) {
                recordTrade(state, { question: pick.question, platform: "JUPITER", time: Date.now(), price: pick.yesPrice, amount: betSize });
                remainingBalance -= betSize;
                buyCount++;
              } else {
                state.failedBuys.set((pick as JupMarket).marketId, Date.now());
              }
            }
          }
        } else {
          callbacks.log(`[JUPITER] No new markets to buy (profit review already ran above)`);
        }
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        callbacks.log(`[JUPITER] Scan failed: ${msg}`);
      }
    };

    await Promise.allSettled([polyPhase(), jupPhase()]);

    // Idle detection
    const bothLow = lowPolyBalance && lowSolBalance;
    const hadSells = polySellTargets.length > 0 || jupSellTargets.length > 0 || jupClaimable.length > 0;
    const hadPositionsToReview = polyAllSellable.length > 0 || jupAllPositions.length > 0;
    if (bothLow && !hadSells && !hadPositionsToReview) {
      state.idleCycles++;
      if (!state.depositNotified && state.idleCycles >= 3) {
        callbacks.log(`[AUTONOMY] ⚠️ Both platforms low on funds (Poly: $${polyBalance.toFixed(2)}, Sol: $${solBalance.toFixed(2)}). Deposit funds to resume trading. Slowing cycle to 5 minutes.`);
        callbacks.send({ type: "action_result", text: `⚠️ DEPOSIT NEEDED — Both platforms have insufficient balance to trade. Poly: $${polyBalance.toFixed(2)}, Sol available: $${solBalance.toFixed(2)}. The agent will check less frequently until funds are available.` });
        state.depositNotified = true;
      }
    } else {
      if (state.idleCycles > 0) {
        state.idleCycles = 0;
        state.depositNotified = false;
      }
    }

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
    const idleInfo = state.idleCycles > 0 ? ` | idle: ${state.idleCycles} cycles` : "";
    callbacks.log(
      `[AUTONOMY] x402: ${x402Payments} payments | positions: ${activePositions}/${MAX_POSITIONS}${state.stuckDust.size > 0 ? ` (+${state.stuckDust.size} dust)` : ""} | poly: $${polyBalance.toFixed(2)} | sol: $${solBalance.toFixed(2)}${spendInfo}${idleInfo}`,
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

  const IDLE_MULTIPLIER = 5;
  const scheduleNext = () => {
    if (!running) return;
    const interval = state.idleCycles >= 3
      ? AUTONOMY_INTERVAL_MS * IDLE_MULTIPLIER
      : AUTONOMY_INTERVAL_MS;
    timer = setTimeout(async () => {
      await runAutonomyCycle(deps, callbacks, state);
      scheduleNext();
    }, interval);
  };
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
