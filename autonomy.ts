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
  CIRCUIT_BREAKER_LOSS_PCT,
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
  recordStartingBalances,
  checkCircuitBreaker,
  reevaluateStuckDust,
  recordJupPriceSnapshot,
  computeJupTrend,
  pruneStaleJupHistory,
} from "./autonomy-state";

import { analyzeCandidates, type AnalysisResult } from "./autonomy-llm";
import { scanPolymarketMarkets, scanJupiterMarkets, type ScoredMarket, type JupMarket } from "./autonomy-scanner";
import { indexAndEnrich } from "./autonomy-rag";
import { directPolymarketBuy, directJupiterBuy } from "./autonomy-trade";
import {
  collectPositions,
  unifiedPortfolioReview,
  claimJupiterPositions,
} from "./autonomy-sell";
import { log } from "./log";

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

    // Record starting balances for circuit breaker (first cycle only)
    recordStartingBalances(state, polyBalance, solBalance);

    // Circuit breaker: pause all trading if cumulative loss is too large
    if (checkCircuitBreaker(state, polyBalance, solBalance)) {
      callbacks.log(`[CIRCUIT BREAKER] ⚠️ Trading paused — cumulative loss exceeds ${CIRCUIT_BREAKER_LOSS_PCT}%. Starting: $${(state.startingBalance.poly + state.startingBalance.sol).toFixed(2)}, Current: $${(polyBalance + solBalance).toFixed(2)}`);
      callbacks.send({ type: "action_result", text: `⚠️ CIRCUIT BREAKER — Trading paused. Loss exceeds ${CIRCUIT_BREAKER_LOSS_PCT}%. Deposit more funds or manually resume.` });
      // Still run sell phase to manage existing positions, but skip all buys
    }
    const breakerActive = state.circuitBreakerTripped;

    // Re-evaluate stuck dust periodically (every 24h)
    const dustCleared = reevaluateStuckDust(state);
    if (dustCleared > 0) {
      callbacks.log(`[AUTONOMY] Re-evaluated ${dustCleared} stuck dust positions — cleared for re-pricing`);
    }

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
    const { ownedTitles, polySellTargets, polyAllSellable, jupSellTargets, jupAllPositions, jupClaimable, untradeableKeys } =
      await collectPositions(state, sellLossThreshold, sellProfitThreshold);

    // Per-platform position counting (spec: max 3 per platform, not 3 global)
    const polyUntradeable = polyAllSellable.filter(p => untradeableKeys.has(p.token)).length;
    const jupUntradeable = jupAllPositions.filter(p => p.pubkey && untradeableKeys.has(p.pubkey)).length;
    const polyActive = polyAllSellable.length - polyUntradeable;
    const jupActive = jupAllPositions.length - jupUntradeable;
    const polyFull = polyActive >= MAX_POSITIONS;
    const jupFull = jupActive >= MAX_POSITIONS;
    if (polyFull || jupFull) {
      callbacks.log(`[AUTONOMY] Poly: ${polyActive}/${MAX_POSITIONS}${polyUntradeable > 0 ? ` (+${polyUntradeable} untradeable)` : ""} | Jup: ${jupActive}/${MAX_POSITIONS}${jupUntradeable > 0 ? ` (+${jupUntradeable} untradeable)` : ""}`);
    }

    const runPoly = state.platform === "both" || state.platform === "polymarket";
    const runJup = state.platform === "both" || state.platform === "jupiter";

    // ========== Run POLYMARKET and JUPITER in parallel ==========
    const polyPhase = async () => {
      if (!runPoly) return;
      callbacks.log(`[POLYMARKET] ${lowPolyBalance ? "SELL-ONLY (low balance)" : "SELL + BUY"}`);
      // Claim + unified sell+review for Polymarket positions (exclude untradeable from LLM review)
      const polyReviewable = polyAllSellable.filter(p => !untradeableKeys.has(p.token));
      await unifiedPortfolioReview(
        deps, callbacks, state, "POLYMARKET",
        polyReviewable.map((p) => ({ token: p.token, title: p.title, pnl: p.pnl, shares: p.shares, curPrice: p.curPrice })),
        polyBalance, lowPolyBalance,
      );

      if (polyFull || lowPolyBalance || breakerActive) {
        if (polyFull) callbacks.log(`[POLYMARKET] ${polyActive}/${MAX_POSITIONS} positions — sell-only`);
        if (lowPolyBalance) callbacks.log(`[POLYMARKET] Balance $${polyBalance.toFixed(2)} — sell-only mode`);
        if (breakerActive) callbacks.log(`[POLYMARKET] Circuit breaker active — sell-only mode`);
        return;
      }

      try {
        let scored = await scanPolymarketMarkets(ownedTitles, state, callbacks);

        // If Polymarket scan returned 0 candidates due to cooldowns, retry without them.
        // Same fix as Jupiter — cooldowns can exhaust a temporarily thin pool.
        if (scored.length === 0) {
          const beforeAnalyzed = state.recentlyAnalyzed.size;
          const beforeSkipped = state.skippedMarkets.size;
          for (const [key] of state.recentlyAnalyzed) state.recentlyAnalyzed.delete(key);
          for (const [key] of state.skippedMarkets) state.skippedMarkets.delete(key);
          if (beforeAnalyzed > 0 || beforeSkipped > 0) {
            callbacks.log(`[POLYMARKET:SCAN] 0 candidates — retrying without cooldowns (cleared ${beforeAnalyzed} analyzed, ${beforeSkipped} skipped)`);
            scored = await scanPolymarketMarkets(ownedTitles, state, callbacks);
          }
        }

        const ragContext = scored.length > 0
          ? await indexAndEnrich(deps, callbacks, state, scored, "polymarket", scored[0]!.question)
          : "";
        callbacks.log(`[POLYMARKET] ${scored.length} new markets | balance: $${polyBalance.toFixed(2)}`);

        if (scored.length > 0) {
          const candidates = scored.slice(0, 5);
          const analyses = await analyzeCandidates(deps, callbacks, candidates, ragContext);

          // Mark unpicked candidates as recently-analyzed so next cycle tries fresh ones
          // Picked markets stay available (edge may persist if trade failed)
          const pickedQuestions = new Set(analyses.map((a) => a.pick.question.toLowerCase()));
          for (const c of candidates) {
            if (!pickedQuestions.has(c.question.toLowerCase())) {
              state.recentlyAnalyzed.set(c.question.toLowerCase(), Date.now());
            }
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

            if (marketPrice > 0.90) {
              callbacks.log(`[POLYMARKET] ❌ Skipping "${analysis.pick.question.slice(0, 50)}" — ${analysis.side} at $${marketPrice.toFixed(2)} terrible risk/reward`);
              state.skippedMarkets.set(analysis.pick.question.toLowerCase(), Date.now());
              continue;
            }
            if (marketPrice < 0.10) {
              callbacks.log(`[POLYMARKET] ❌ Skipping "${analysis.pick.question.slice(0, 50)}" — ${analysis.side} at $${marketPrice.toFixed(2)} too cheap`);
              state.skippedMarkets.set(analysis.pick.question.toLowerCase(), Date.now());
              continue;
            }
            // Dynamic reward ratio: lower threshold for high-conviction picks.
            // A 0.33:1 ratio (buying at $0.75) is fine at 95% confidence — expected value is huge.
            const effectiveMinRatio = analysis.confidence >= 0.85 ? 0.25
              : analysis.confidence >= 0.70 ? 0.40
              : MIN_REWARD_RATIO;
            if (polyRewardRatio < effectiveMinRatio) {
              callbacks.log(`[POLYMARKET] ❌ Skipping "${analysis.pick.question.slice(0, 50)}" — ratio ${polyRewardRatio.toFixed(2)}:1 below ${effectiveMinRatio.toFixed(2)} (conf=${analysis.confidence.toFixed(2)})`);
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
      // Unified sell+review for Jupiter positions (exclude untradeable from LLM review)
      const jupReviewable = jupAllPositions.filter(p => !p.pubkey || !untradeableKeys.has(p.pubkey));
      await unifiedPortfolioReview(
        deps, callbacks, state, "JUPITER",
        jupReviewable.map((p) => ({ pubkey: p.pubkey, title: p.title, pnl: p.pnl, isYes: p.isYes, contracts: p.contracts, ...(p.curPrice != null ? { curPrice: p.curPrice } : {}) })),
        solBalance, lowSolBalance,
      );

      if (jupFull || lowSolBalance || breakerActive) {
        if (jupFull) callbacks.log(`[JUPITER] ${jupActive}/${MAX_POSITIONS} positions — sell-only`);
        if (lowSolBalance) callbacks.log(`[JUPITER] Balance $${solBalance.toFixed(2)} — sell-only mode`);
        if (breakerActive) callbacks.log(`[JUPITER] Circuit breaker active — sell-only mode`);
        // Still record price snapshots before returning
        for (const p of jupAllPositions) {
          if (p.pubkey && p.curPrice && p.curPrice > 0) {
            recordJupPriceSnapshot(state, p.pubkey, p.curPrice);
          }
        }
        const jupActiveKeys = new Set(jupAllPositions.map(p => p.pubkey).filter(Boolean) as string[]);
        pruneStaleJupHistory(state, jupActiveKeys);
        return;
      }

      if (Date.now() < state.jupBuyPausedUntil) {
        const remaining = Math.ceil((state.jupBuyPausedUntil - Date.now()) / 60_000);
        callbacks.log(`[JUPITER] Skipping buy — insufficient funds cooldown (${remaining}m remaining)`);
        return;
      }

      try {
        let jupScored = await scanJupiterMarkets(ownedTitles, state, callbacks);
        let debugInfo = (jupScored as unknown as { _debug?: string })._debug;
        if (debugInfo) callbacks.log(`[JUPITER:SCAN] ${debugInfo}`);

        // If Jupiter scan returned 0 candidates due to cooldowns, retry without them.
        // Jupiter has a small market pool (~2 qualifying at any time) — cooldowns can
        // exhaust the entire pool, leaving the agent idle for hours.
        if (jupScored.length === 0) {
          const beforeAnalyzed = state.recentlyAnalyzed.size;
          const beforeSkipped = state.skippedMarkets.size;
          // Clear only Jupiter-related entries (questions containing common Jupiter patterns)
          for (const [key] of state.recentlyAnalyzed) {
            state.recentlyAnalyzed.delete(key);
          }
          for (const [key] of state.skippedMarkets) {
            state.skippedMarkets.delete(key);
          }
          if (beforeAnalyzed > 0 || beforeSkipped > 0) {
            callbacks.log(`[JUPITER:SCAN] 0 candidates — retrying without cooldowns (cleared ${beforeAnalyzed} analyzed, ${beforeSkipped} skipped)`);
            jupScored = await scanJupiterMarkets(ownedTitles, state, callbacks);
            debugInfo = (jupScored as unknown as { _debug?: string })._debug;
            if (debugInfo) callbacks.log(`[JUPITER:SCAN:RETRY] ${debugInfo}`);
          }
        }

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

          // Mark unpicked candidates as recently-analyzed so next cycle tries fresh ones
          const pickedQuestions = new Set(analyses.map((a) => a.pick.question.toLowerCase()));
          for (const c of candidates) {
            if (!pickedQuestions.has(c.question.toLowerCase())) {
              state.recentlyAnalyzed.set(c.question.toLowerCase(), Date.now());
            }
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

              if (jupMarketPrice > 0.90) {
                callbacks.log(`[JUPITER] ❌ Skipping "${pick.question.slice(0, 50)}" — terrible risk/reward`);
                state.skippedMarkets.set(pick.question.toLowerCase(), Date.now());
                continue;
              }
              if (jupMarketPrice < 0.10) {
                callbacks.log(`[JUPITER] ❌ Skipping "${pick.question.slice(0, 50)}" — too cheap`);
                state.skippedMarkets.set(pick.question.toLowerCase(), Date.now());
                continue;
              }
              const jupEffectiveMinRatio = analysis.confidence >= 0.85 ? 0.25
                : analysis.confidence >= 0.70 ? 0.40
                : MIN_REWARD_RATIO;
              if (jupRewardRatio < jupEffectiveMinRatio) {
                callbacks.log(`[JUPITER] ❌ Skipping "${pick.question.slice(0, 50)}" — ratio ${jupRewardRatio.toFixed(2)}:1 below ${jupEffectiveMinRatio.toFixed(2)} (conf=${analysis.confidence.toFixed(2)})`);
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
      `[AUTONOMY] x402: ${x402Payments} payments | poly: ${polyActive}/${MAX_POSITIONS} | jup: ${jupActive}/${MAX_POSITIONS}${untradeableKeys.size > 0 ? ` (${untradeableKeys.size} untradeable)` : ""} | poly: $${polyBalance.toFixed(2)} | sol: $${solBalance.toFixed(2)}${spendInfo}${idleInfo}`,
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
              log.warn("autonomy", `heartbeat failed (${consecutiveFailures}x): ${errMsg}`);
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
