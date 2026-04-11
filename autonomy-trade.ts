/**
 * Direct trade execution (buy/sell) for Polymarket and Jupiter.
 * Bypasses LLM action routing for reliable execution.
 */

import { PolymarketExtService } from "./plugins/polymarket-ext/service";
import { POLYMARKET_EXT_SERVICE_TYPE } from "./plugins/polymarket-ext/types";
import { JupiterPredictionService, JUPITER_SERVICE_TYPE } from "./plugins/jupiter-prediction/service";
import type { AutonomyDeps, AutonomyCallbacks, AutonomyState } from "./autonomy-state";
import { recordSpend } from "./autonomy-state";

/**
 * Direct Polymarket sell via CLOB API (bypasses LLM).
 */
export async function directPolymarketSell(
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
    }

    // If order book bid is garbage, use position's curPrice with a 5% discount
    if (price < 0.03 && positionCurPrice && positionCurPrice >= 0.05) {
      const fallbackPrice = Math.round(positionCurPrice * 0.95 * 100) / 100;
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

    if (shares < 1) {
      state.stuckDust.add(token);
      return false;
    }
    if (shares < 5) {
      if (!state.stuckDust.has(token)) {
        callbacks.log(`[SELL:POLYMARKET] ⏭️ "${title}" — only ${shares} shares, below CLOB minimum of 5. Stuck dust.`);
      }
      state.stuckDust.add(token);
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

/**
 * Direct Polymarket buy via CLOB API (bypasses LLM).
 */
export async function directPolymarketBuy(
  deps: AutonomyDeps,
  callbacks: AutonomyCallbacks,
  state: AutonomyState,
  question: string,
  side: string,
  betSize: number,
  availableBalance?: number,
  knownTokenId?: string,
  expectedPrice?: number,
): Promise<boolean> {
  try {
    const extSvc = (await deps.runtime.getServiceLoadPromise(
      POLYMARKET_EXT_SERVICE_TYPE,
    )) as unknown as PolymarketExtService;
    if (!extSvc?.isFullyActive()) {
      callbacks.log(`[BUY:POLYMARKET] ❌ CLOB not active`);
      return false;
    }

    // Resolve the correct token for the side we want to buy.
    // knownTokenId from scanner is always the YES token — if buying NO, we need to
    // search for the market to find the NO token.
    let tokenId: string;
    let midPrice: number;
    if (knownTokenId && side === "BUY" || knownTokenId && side === "YES") {
      // YES side: use the known YES token directly
      tokenId = knownTokenId;
      midPrice = 0.5;
      try {
        const book = await extSvc.clob!.getOrderBook(tokenId);
        const bestAsk = book.asks.length > 0 ? parseFloat(book.asks[0]!.price) : null;
        const bestBid = book.bids.length > 0 ? parseFloat(book.bids[0]!.price) : null;
        if (bestAsk !== null && bestBid !== null) midPrice = Math.round(((bestAsk + bestBid) / 2) * 100) / 100;
        else if (bestAsk !== null) midPrice = bestAsk;
        else if (bestBid !== null) midPrice = bestBid;
      } catch {}
    } else if (knownTokenId && side === "NO") {
      // NO side: search for the market to get the NO token ID
      // (knownTokenId is the YES token — can't use it for NO)
      const markets = await extSvc.clob!.searchMarkets(question);
      if (markets.length === 0) {
        callbacks.log(`[BUY:POLYMARKET] ❌ No market found for NO side: "${question.slice(0, 50)}"`);
        return false;
      }
      const market = markets[0]!;
      const noToken = market.tokens.find((t) => t.outcome.toLowerCase() === "no");
      if (!noToken) {
        callbacks.log(`[BUY:POLYMARKET] ❌ No NO token for "${market.question?.slice(0, 50)}"`);
        return false;
      }
      tokenId = noToken.token_id;
      midPrice = noToken.price;
      try {
        const book = await extSvc.clob!.getOrderBook(tokenId);
        const bestAsk = book.asks.length > 0 ? parseFloat(book.asks[0]!.price) : null;
        const bestBid = book.bids.length > 0 ? parseFloat(book.bids[0]!.price) : null;
        if (bestAsk !== null && bestBid !== null) midPrice = Math.round(((bestAsk + bestBid) / 2) * 100) / 100;
        else if (bestAsk !== null) midPrice = bestAsk;
        else if (bestBid !== null) midPrice = bestBid;
      } catch {}
    } else {
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
      tokenId = token.token_id;
      midPrice = token.price;
      try {
        const book = await extSvc.clob!.getOrderBook(tokenId);
        const bestAsk = book.asks.length > 0 ? parseFloat(book.asks[0]!.price) : null;
        const bestBid = book.bids.length > 0 ? parseFloat(book.bids[0]!.price) : null;
        if (bestAsk !== null && bestBid !== null) {
          midPrice = Math.round(((bestAsk + bestBid) / 2) * 100) / 100;
        } else if (bestAsk !== null) {
          midPrice = bestAsk;
        }
        if (bestAsk !== null && bestAsk > midPrice * 1.2) {
          callbacks.log(
            `[BUY:POLYMARKET] ⚠️ Ask $${bestAsk.toFixed(2)} is ${Math.round((bestAsk / midPrice - 1) * 100)}% above mid $${midPrice.toFixed(2)} — using limit bid at mid`,
          );
        }
      } catch {
        // Fall back to token.price
      }
    }

    let price = midPrice;
    if (price < 0.01 || price > 0.99) {
      callbacks.log(`[BUY:POLYMARKET] ❌ Price $${price.toFixed(4)} out of range`);
      return false;
    }

    // Sanity check: abort if CLOB price is much worse than scanner expected
    if (expectedPrice && expectedPrice > 0 && price > expectedPrice * 1.5) {
      callbacks.log(`[BUY:POLYMARKET] ❌ CLOB price $${price.toFixed(2)} is ${Math.round((price / expectedPrice - 1) * 100)}% worse than expected $${expectedPrice.toFixed(2)} — stale data, aborting`);
      state.skippedMarkets.set(question.toLowerCase(), Date.now());
      return false;
    }

    const size = Math.max(5, Math.floor(betSize / price));
    let totalCost = size * price;
    const balance = availableBalance ?? betSize * 2;
    if (totalCost > balance) {
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

    const result = await extSvc.placeOrder({ tokenId, side: "BUY", price, size });
    const total = (size * price).toFixed(2);
    const statusIcon = result.status === "matched" ? "FILLED" : String(result.status).toUpperCase();
    const txInfo = result.transactionsHashes.length > 0
      ? ` | tx: ${result.transactionsHashes[0]!.slice(0, 10)}...`
      : "";
    callbacks.log(
      `[BUY:POLYMARKET] ✅ ${statusIcon}: ${size} shares @ $${price.toFixed(2)} ($${total}) for "${question.slice(0, 60)}"${txInfo}`,
    );
    recordSpend(state, Number(total));
    return true;
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    callbacks.log(`[BUY:POLYMARKET] ❌ "${question.slice(0, 50)}" — failed: ${msg}`);
    return false;
  }
}

/**
 * Direct Jupiter buy via API (bypasses LLM action routing).
 */
export async function directJupiterBuy(
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
    const depositAmount = Math.round(Math.max(betSize, 1.1) * 1_000_000);

    if (availableBalance !== undefined && availableBalance < betSize) {
      callbacks.log(`[BUY:JUPITER] ❌ Not enough available balance: $${availableBalance.toFixed(2)} < $${betSize.toFixed(2)}`);
      state.jupBuyPausedUntil = Date.now() + 5 * 60_000;
      return false;
    }

    let mint: string;
    const jup = jupUsdBalance ?? 0;
    const usdc = usdcBalance ?? 0;
    const combined = jup + usdc;
    if (jup >= betSize) {
      mint = "JuprjznTrTSp2UFa3ZBUFgwdAmtZCq4MQCwysN55USD";
    } else if (usdc >= betSize) {
      mint = "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v";
    } else if (combined >= betSize && usdc >= 0.50) {
      // Combined balance covers the bet — use whichever has more
      // Jupiter only takes from one mint, so pick the larger one
      mint = jup >= usdc
        ? "JuprjznTrTSp2UFa3ZBUFgwdAmtZCq4MQCwysN55USD"
        : "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v";
      callbacks.log(`[BUY:JUPITER] Using larger mint for combined balance (USDC=$${usdc.toFixed(2)} + JupUSD=$${jup.toFixed(2)} = $${combined.toFixed(2)})`);
    } else {
      callbacks.log(`[BUY:JUPITER] ❌ Combined balance $${combined.toFixed(2)} too low for $${betSize.toFixed(2)} (USDC=$${usdc.toFixed(2)}, JupUSD=$${jup.toFixed(2)}). Need to deposit.`);
      state.jupBuyPausedUntil = Date.now() + 5 * 60_000;
      return false;
    }
    const mintLabel = mint.startsWith("Jupr") ? "JupUSD" : "USDC";
    callbacks.log(`[BUY:JUPITER] Using ${mintLabel} (USDC=$${usdc.toFixed(2)}, JupUSD=$${jup.toFixed(2)})`);

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
    if (msg.includes("Insufficient funds") || msg.includes("insufficient")) {
      state.jupBuyPausedUntil = Date.now() + 5 * 60_000;
    }
    return false;
  }
}
