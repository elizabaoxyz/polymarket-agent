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

import { type AnalysisResult, analyzeCandidates } from "./autonomy-llm";
import { indexAndEnrich } from "./autonomy-rag";
import {
  type JupMarket,
  type ScoredMarket,
  scanJupiterMarkets,
  scanPolymarketMarkets,
} from "./autonomy-scanner";
import {
  claimJupiterPositions,
  collectPositions,
  type ReviewablePosition,
  unifiedPortfolioReview,
} from "./autonomy-sell";
import {
  type AutonomyCallbacks,
  type AutonomyDeps,
  type AutonomyState,
  canSpend,
  checkCircuitBreaker,
  housekeep,
  pruneStaleJupHistory,
  recordJupPriceSnapshot,
  recordStartingBalances,
  recordTrade,
  reevaluateStuckDust,
  seedStateFromTradeHistory,
} from "./autonomy-state";
import { directJupiterBuy, directPolymarketBuy } from "./autonomy-trade";
import {
  CIRCUIT_BREAKER_LOSS_PCT,
  calcKellyBetSize,
  DAILY_SPEND_LIMIT_USD,
  LOW_BALANCE_THRESHOLD,
  MAX_BUYS_PER_CYCLE,
  MAX_POSITIONS,
  MIN_BET_SIZE_JUP,
  MIN_BET_SIZE_USD,
  MIN_REWARD_RATIO,
  SECOND_BUY_MIN_CONFIDENCE,
  SECOND_BUY_MIN_EDGE,
  SELL_LOSS_THRESHOLD_AGGRESSIVE,
  SELL_LOSS_THRESHOLD_NORMAL,
  SELL_PROFIT_THRESHOLD_AGGRESSIVE,
  SELL_PROFIT_THRESHOLD_NORMAL,
} from "./config";
import {
  JUPITER_SERVICE_TYPE,
  type JupiterPredictionService,
} from "./plugins/jupiter-prediction/service";
import type { X402SolanaService } from "./plugins/x402-solana/service";
import { X402_SERVICE_TYPE } from "./plugins/x402-solana/types";
import { getPortfolioStatus } from "./portfolio";
import { getCachedSolanaBalanceBreakdown } from "./solana-wallet";

// --- Shared buy phase ---

type PlatformBuyConfig = {
  label: "POLYMARKET" | "JUPITER";
  balance: number;
  lowBalance: boolean;
  isFull: boolean;
  activeCount: number;
  minBet: number;
  filledPositions: number;
  breakerActive: boolean;
  reviewPositions: ReviewablePosition[];
  scan: () => Promise<ScoredMarket[] | JupMarket[]>;
  executeBuy: (
    analysis: AnalysisResult,
    betSize: number,
    remainingBalance: number,
  ) => Promise<boolean>;
  recordFailedBuy: (analysis: AnalysisResult) => void;
  beforeBuy?: () => Promise<boolean>;
  onScanComplete?: (scored: ScoredMarket[] | JupMarket[]) => Promise<void>;
};

async function platformBuyPhase(
  deps: AutonomyDeps,
  callbacks: AutonomyCallbacks,
  state: AutonomyState,
  config: PlatformBuyConfig,
): Promise<void> {
  const tag = `[${config.label}]`;

  callbacks.log(`${tag} ${config.lowBalance ? "SELL-ONLY (low balance)" : "SELL + BUY"}`);

  await unifiedPortfolioReview(
    deps,
    callbacks,
    state,
    config.label,
    config.reviewPositions,
    config.balance,
    config.lowBalance,
  );

  if (config.isFull || config.lowBalance || config.breakerActive) {
    if (config.isFull)
      callbacks.log(`${tag} ${config.activeCount}/${MAX_POSITIONS} positions — sell-only`);
    if (config.lowBalance)
      callbacks.log(`${tag} Balance $${config.balance.toFixed(2)} — sell-only mode`);
    if (config.breakerActive) callbacks.log(`${tag} Circuit breaker active — sell-only mode`);
    return;
  }

  if (config.beforeBuy) {
    const proceed = await config.beforeBuy();
    if (!proceed) return;
  }

  try {
    let scored = await config.scan();

    // If scan returned 0 candidates due to cooldowns, retry without them.
    if (scored.length === 0) {
      const beforeAnalyzed = state.recentlyAnalyzed.size;
      const beforeSkipped = state.skippedMarkets.size;
      for (const [key] of state.recentlyAnalyzed) state.recentlyAnalyzed.delete(key);
      for (const [key] of state.skippedMarkets) state.skippedMarkets.delete(key);
      if (beforeAnalyzed > 0 || beforeSkipped > 0) {
        callbacks.log(
          `${tag.replace("]", ":SCAN]")} 0 candidates — retrying without cooldowns (cleared ${beforeAnalyzed} analyzed, ${beforeSkipped} skipped)`,
        );
        scored = await config.scan();
      }
    }

    const ragContext =
      scored.length > 0
        ? await indexAndEnrich(
            deps,
            callbacks,
            state,
            scored,
            config.label === "POLYMARKET" ? "polymarket" : "jupiter",
            scored[0]!.question,
          )
        : "";

    const balanceLabel = config.label === "JUPITER" ? "SOL balance" : "balance";
    const dbg = (scored as unknown as { _debug?: string })._debug;
    callbacks.log(
      `${tag} ${scored.length} new markets | ${balanceLabel}: $${config.balance.toFixed(2)}${dbg ? ` | ${dbg}` : ""}`,
    );

    if (config.onScanComplete) {
      await config.onScanComplete(scored);
    }

    if (scored.length > 0) {
      const candidates = scored.slice(0, 5);
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
        callbacks.log(`${tag} No high-conviction pick — skipping buy this cycle`);
        return;
      }

      let buyCount = 0;
      let remainingBalance = config.balance;

      for (let ai = 0; ai < analyses.length && buyCount < MAX_BUYS_PER_CYCLE; ai++) {
        const analysis = analyses[ai]!;

        // Second+ buy requires higher bar
        if (buyCount > 0) {
          if (analysis.edge < SECOND_BUY_MIN_EDGE) {
            callbacks.log(
              `${tag} Pick #${ai + 1} edge ${analysis.edge.toFixed(2)} below second-buy minimum ${SECOND_BUY_MIN_EDGE} — stopping`,
            );
            break;
          }
          if (analysis.confidence < SECOND_BUY_MIN_CONFIDENCE) {
            callbacks.log(
              `${tag} Pick #${ai + 1} confidence ${analysis.confidence.toFixed(2)} below second-buy minimum — stopping`,
            );
            break;
          }
          if (ai > 0 && analyses[ai - 1]?.category === analysis.category) {
            callbacks.log(
              `${tag} Pick #${ai + 1} same category (${analysis.category}) as previous — skipping for diversification`,
            );
            continue;
          }
        }

        const marketPrice =
          analysis.side === "YES" ? analysis.pick.yesPrice : 1 - analysis.pick.yesPrice;
        const rewardRatio = marketPrice > 0 ? (1 - marketPrice) / marketPrice : 0;

        if (marketPrice > 0.9) {
          callbacks.log(
            `${tag} ❌ Skipping "${analysis.pick.question.slice(0, 50)}" — ${analysis.side} at $${marketPrice.toFixed(2)} terrible risk/reward`,
          );
          state.skippedMarkets.set(analysis.pick.question.toLowerCase(), Date.now());
          continue;
        }
        if (marketPrice < 0.1) {
          callbacks.log(
            `${tag} ❌ Skipping "${analysis.pick.question.slice(0, 50)}" — ${analysis.side} at $${marketPrice.toFixed(2)} too cheap`,
          );
          state.skippedMarkets.set(analysis.pick.question.toLowerCase(), Date.now());
          continue;
        }
        // Dynamic reward ratio: lower threshold for high-conviction picks.
        const effectiveMinRatio =
          analysis.confidence >= 0.85 ? 0.25 : analysis.confidence >= 0.7 ? 0.4 : MIN_REWARD_RATIO;
        if (rewardRatio < effectiveMinRatio) {
          callbacks.log(
            `${tag} ❌ Skipping "${analysis.pick.question.slice(0, 50)}" — ratio ${rewardRatio.toFixed(2)}:1 below ${effectiveMinRatio.toFixed(2)} (conf=${analysis.confidence.toFixed(2)})`,
          );
          state.skippedMarkets.set(analysis.pick.question.toLowerCase(), Date.now());
          continue;
        }

        const kellyProb =
          analysis.side === "YES" ? analysis.estimatedProb : 1 - analysis.estimatedProb;
        const betSize = calcKellyBetSize({
          estimatedProb: kellyProb,
          marketPrice,
          confidence: analysis.confidence,
          balance: remainingBalance,
          minBet: config.minBet,
          filledPositions: config.filledPositions,
        });

        if (!canSpend(state, betSize)) {
          callbacks.log(`${tag} Daily spend limit reached — skipping buy`);
          break;
        }

        if (remainingBalance < betSize) {
          callbacks.log(
            `${tag} Insufficient balance ($${remainingBalance.toFixed(2)}) for $${betSize.toFixed(2)} bet — stopping`,
          );
          break;
        }

        callbacks.log(
          `[BUY:${config.label}] #${buyCount + 1} "${analysis.pick.question}" (${analysis.side}:$${marketPrice.toFixed(2)}, kelly:$${betSize.toFixed(2)}, edge:${analysis.edge.toFixed(2)}, conf:${analysis.confidence.toFixed(2)}, est:${analysis.estimatedProb.toFixed(2)})`,
        );
        state.pendingBuys.add(analysis.pick.question.toLowerCase());
        const bought = await config.executeBuy(analysis, betSize, remainingBalance);
        if (bought) {
          recordTrade(state, {
            question: analysis.pick.question,
            platform: config.label,
            time: Date.now(),
            price: analysis.pick.yesPrice,
            amount: betSize,
          });
          remainingBalance -= betSize;
          buyCount++;
        } else {
          config.recordFailedBuy(analysis);
        }
      }
    } else {
      callbacks.log(`${tag} No new markets to buy`);
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    callbacks.log(`${tag} Scan failed: ${msg}`);
  }
}

// --- Main autonomy cycle ---

export async function runAutonomyCycle(
  deps: AutonomyDeps,
  callbacks: AutonomyCallbacks,
  state: AutonomyState,
): Promise<void> {
  const cycleStart = Date.now();
  state.cycleCount++;
  housekeep(state);

  // Monitor pending orders from previous cycles
  if (state.pendingOrders.size > 0) {
    const { POLYMARKET_EXT_SERVICE_TYPE } = await import("./plugins/polymarket-ext/types");
    type ExtSvcShape = { clob: { cancelOrder: (id: string) => Promise<unknown> } | null };
    let extSvc: ExtSvcShape | null = null;
    try {
      extSvc = (await deps.runtime.getServiceLoadPromise(
        POLYMARKET_EXT_SERVICE_TYPE,
      )) as unknown as ExtSvcShape;
    } catch {}

    for (const [key, order] of state.pendingOrders) {
      const ageMs = Date.now() - order.placedAt;
      if (ageMs > 2 * 60_000) {
        if (extSvc?.clob) {
          try {
            await extSvc.clob.cancelOrder(order.orderID);
            callbacks.log(
              `[ORDER] Cancelled stale ${order.platform} order ${order.orderID.slice(0, 12)}... for "${order.question}"`,
            );
          } catch {}
        }
        state.pendingOrders.delete(key);
      }
    }
  }

  // On first cycle, seed state from Polymarket trade history so we don't
  // re-buy markets we recently sold (survives redeploys)
  if (state.cycleCount === 1) {
    try {
      await seedStateFromTradeHistory(state);
      if (state.recentlySoldQuestions.size > 0) {
        callbacks.log(
          `[AUTONOMY] Seeded ${state.recentlySoldQuestions.size} recently-sold markets from trade history`,
        );
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
    const platformLabel =
      state.platform === "both"
        ? "Polygon + Solana"
        : state.platform === "polymarket"
          ? "Polygon only"
          : "Solana + x402 only";
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
            const deposited =
              Number(o.sizeUsd ?? o.depositedAmount ?? o.depositAmount ?? 0) / 1_000_000;
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
    const lockedInfo =
      solLockedInOrders > 0
        ? ` (avail: $${solBalance.toFixed(2)}, locked: $${solLockedInOrders.toFixed(2)}, USDC: $${solUsdcBalance.toFixed(2)}, JupUSD: $${solJupUsdBalance.toFixed(2)})`
        : ` (USDC: $${solUsdcBalance.toFixed(2)}, JupUSD: $${solJupUsdBalance.toFixed(2)})`;
    callbacks.log(
      `[BALANCE] Polygon: $${polyBalance.toFixed(2)} | Solana: $${solBalanceTotal.toFixed(2)}${lockedInfo}`,
    );

    // Record starting balances for circuit breaker (first cycle only)
    recordStartingBalances(state, polyBalance, solBalance);

    // Circuit breaker: pause all trading if cumulative loss is too large
    if (checkCircuitBreaker(state, polyBalance, solBalance)) {
      callbacks.log(
        `[CIRCUIT BREAKER] ⚠️ Trading paused — cumulative loss exceeds ${CIRCUIT_BREAKER_LOSS_PCT}%. Starting: $${(state.startingBalance.poly + state.startingBalance.sol).toFixed(2)}, Current: $${(polyBalance + solBalance).toFixed(2)}`,
      );
      callbacks.send({
        type: "action_result",
        text: `⚠️ CIRCUIT BREAKER — Trading paused. Loss exceeds ${CIRCUIT_BREAKER_LOSS_PCT}%. Deposit more funds or manually resume.`,
      });
      // Still run sell phase to manage existing positions, but skip all buys
    }
    const breakerActive = state.circuitBreakerTripped;

    // Re-evaluate stuck dust periodically (every 24h)
    const dustCleared = reevaluateStuckDust(state);
    if (dustCleared > 0) {
      callbacks.log(
        `[AUTONOMY] Re-evaluated ${dustCleared} stuck dust positions — cleared for re-pricing`,
      );
    }

    // P&L tracking
    if (state.prevPolyBalance >= 0 || state.prevSolBalance >= 0) {
      const polyDelta = state.prevPolyBalance >= 0 ? polyBalance - state.prevPolyBalance : 0;
      const solDelta = state.prevSolBalance >= 0 ? solBalance - state.prevSolBalance : 0;
      const totalDelta = polyDelta + solDelta;
      if (Math.abs(totalDelta) >= 0.01) {
        const sign = totalDelta >= 0 ? "+" : "";
        callbacks.log(
          `[P&L] ${sign}$${totalDelta.toFixed(2)} since last cycle (poly: ${sign}$${polyDelta.toFixed(2)}, sol: ${sign}$${solDelta.toFixed(2)})`,
        );
      }
    }
    state.prevPolyBalance = polyBalance;
    state.prevSolBalance = solBalance;

    if (DAILY_SPEND_LIMIT_USD > 0) {
      callbacks.log(
        `[SPEND] Today: $${state.dailySpend.toFixed(2)} / $${DAILY_SPEND_LIMIT_USD.toFixed(2)} limit`,
      );
    }

    // Dynamic sell thresholds
    const polySellLoss = lowPolyBalance
      ? SELL_LOSS_THRESHOLD_AGGRESSIVE
      : SELL_LOSS_THRESHOLD_NORMAL;
    const polySellProfit = lowPolyBalance
      ? SELL_PROFIT_THRESHOLD_AGGRESSIVE
      : SELL_PROFIT_THRESHOLD_NORMAL;
    const jupSellLoss = lowSolBalance ? SELL_LOSS_THRESHOLD_AGGRESSIVE : SELL_LOSS_THRESHOLD_NORMAL;
    const jupSellProfit = lowSolBalance
      ? SELL_PROFIT_THRESHOLD_AGGRESSIVE
      : SELL_PROFIT_THRESHOLD_NORMAL;

    const sellLossThreshold = Math.min(polySellLoss, jupSellLoss);
    const sellProfitThreshold = Math.max(polySellProfit, jupSellProfit);
    const {
      ownedTitles,
      polySellTargets,
      polyAllSellable,
      jupSellTargets,
      jupAllPositions,
      jupClaimable,
      untradeableKeys,
    } = await collectPositions(state, sellLossThreshold, sellProfitThreshold);

    // Per-platform position counting (spec: max 3 per platform, not 3 global)
    const polyUntradeable = polyAllSellable.filter((p) => untradeableKeys.has(p.token)).length;
    const jupUntradeable = jupAllPositions.filter(
      (p) => p.pubkey && untradeableKeys.has(p.pubkey),
    ).length;
    const polyActive = polyAllSellable.length - polyUntradeable;
    const jupActive = jupAllPositions.length - jupUntradeable;
    const polyFull = polyActive >= MAX_POSITIONS;
    const jupFull = jupActive >= MAX_POSITIONS;
    if (polyFull || jupFull) {
      callbacks.log(
        `[AUTONOMY] Poly: ${polyActive}/${MAX_POSITIONS}${polyUntradeable > 0 ? ` (+${polyUntradeable} untradeable)` : ""} | Jup: ${jupActive}/${MAX_POSITIONS}${jupUntradeable > 0 ? ` (+${jupUntradeable} untradeable)` : ""}`,
      );
    }

    const runPoly = state.platform === "both" || state.platform === "polymarket";
    const runJup = state.platform === "both" || state.platform === "jupiter";

    // ========== Run POLYMARKET and JUPITER in parallel ==========
    const polyPhase = async () => {
      if (!runPoly) return;
      const polyReviewable = polyAllSellable.filter((p) => !untradeableKeys.has(p.token));
      await platformBuyPhase(deps, callbacks, state, {
        label: "POLYMARKET",
        balance: polyBalance,
        lowBalance: lowPolyBalance,
        isFull: polyFull,
        activeCount: polyActive,
        minBet: MIN_BET_SIZE_USD,
        filledPositions: polyActive,
        breakerActive,
        reviewPositions: polyReviewable.map((p) => ({
          token: p.token,
          title: p.title,
          pnl: p.pnl,
          shares: p.shares,
          curPrice: p.curPrice,
          ...(p.daysLeft !== undefined ? { daysLeft: p.daysLeft } : {}),
        })),
        scan: () => scanPolymarketMarkets(ownedTitles, state, callbacks),
        executeBuy: async (analysis, betSize, remaining) => {
          const marketPrice =
            analysis.side === "YES" ? analysis.pick.yesPrice : 1 - analysis.pick.yesPrice;
          return directPolymarketBuy(
            deps,
            callbacks,
            state,
            analysis.pick.question,
            analysis.side,
            betSize,
            remaining,
            (analysis.pick as ScoredMarket).tokenId,
            marketPrice,
            (analysis.pick as ScoredMarket).noTokenId,
          );
        },
        recordFailedBuy: (analysis) => {
          state.failedBuys.set(analysis.pick.question, Date.now());
        },
      });
    };

    const jupPhase = async () => {
      if (!runJup) return;
      await claimJupiterPositions(deps, callbacks, state, jupClaimable);
      const jupReviewable = jupAllPositions.filter(
        (p) => !p.pubkey || !untradeableKeys.has(p.pubkey),
      );
      await platformBuyPhase(deps, callbacks, state, {
        label: "JUPITER",
        balance: solBalance,
        lowBalance: lowSolBalance,
        isFull: jupFull,
        activeCount: jupActive,
        minBet: MIN_BET_SIZE_JUP,
        filledPositions: jupActive,
        breakerActive,
        reviewPositions: jupReviewable.map((p) => ({
          pubkey: p.pubkey,
          title: p.title,
          pnl: p.pnl,
          isYes: p.isYes,
          contracts: p.contracts,
          ...(p.curPrice != null ? { curPrice: p.curPrice } : {}),
        })),
        scan: () => scanJupiterMarkets(ownedTitles, state, callbacks),
        executeBuy: async (analysis, betSize, remaining) => {
          const pick = analysis.pick as JupMarket;
          return directJupiterBuy(
            deps,
            callbacks,
            state,
            pick.marketId,
            analysis.side,
            betSize,
            pick.question,
            remaining,
            solUsdcBalance,
            solJupUsdBalance,
          );
        },
        recordFailedBuy: (analysis) => {
          state.failedBuys.set((analysis.pick as JupMarket).marketId, Date.now());
        },
        beforeBuy: async () => {
          if (Date.now() < state.jupBuyPausedUntil) {
            const remaining = Math.ceil((state.jupBuyPausedUntil - Date.now()) / 60_000);
            callbacks.log(
              `[JUPITER] Skipping buy — insufficient funds cooldown (${remaining}m remaining)`,
            );
            return false;
          }
          return true;
        },
        onScanComplete: async (scored) => {
          const x402ApiUrl = process.env.X402_API_URL;
          if (x402ApiUrl && scored.length > 0) {
            try {
              callbacks.log("[x402] Paying for market analysis on Solana...");
              await fetch(`${x402ApiUrl}/prediction`);
            } catch {}
          }
        },
      });
      // Jupiter price snapshots — always run (even when platformBuyPhase handled sell-only)
      // This is safe because it's idempotent
      for (const p of jupAllPositions) {
        if (p.pubkey && p.curPrice && p.curPrice > 0) {
          recordJupPriceSnapshot(state, p.pubkey, p.curPrice);
        }
      }
      const jupActiveKeys = new Set(
        jupAllPositions.map((p) => p.pubkey).filter(Boolean) as string[],
      );
      pruneStaleJupHistory(state, jupActiveKeys);
    };

    await Promise.allSettled([polyPhase(), jupPhase()]);

    // Idle detection
    const bothLow = lowPolyBalance && lowSolBalance;
    const hadSells =
      polySellTargets.length > 0 || jupSellTargets.length > 0 || jupClaimable.length > 0;
    const hadPositionsToReview = polyAllSellable.length > 0 || jupAllPositions.length > 0;
    if (bothLow && !hadSells && !hadPositionsToReview) {
      state.idleCycles++;
      if (!state.depositNotified && state.idleCycles >= 3) {
        callbacks.log(
          `[AUTONOMY] ⚠️ Both platforms low on funds (Poly: $${polyBalance.toFixed(2)}, Sol: $${solBalance.toFixed(2)}). Deposit funds to resume trading. Slowing cycle to 5 minutes.`,
        );
        callbacks.send({
          type: "action_result",
          text: `⚠️ DEPOSIT NEEDED — Both platforms have insufficient balance to trade. Poly: $${polyBalance.toFixed(2)}, Sol available: $${solBalance.toFixed(2)}. The agent will check less frequently until funds are available.`,
        });
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
    const spendInfo =
      DAILY_SPEND_LIMIT_USD > 0
        ? ` | spent: $${state.dailySpend.toFixed(2)}/$${DAILY_SPEND_LIMIT_USD.toFixed(2)}`
        : "";
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
