/**
 * Claude AI Integration
 * 
 * Provides AI-powered market analysis using Anthropic's Claude.
 * 
 * @author ElizaBAO
 */

export interface AIDecision {
  shouldTrade: boolean;
  action: "BUY" | "HOLD";
  market: any | null;
  reasoning: string;
  confidence: number;
}

export interface AnalysisContext {
  opportunities: any[];
  elonPrediction?: {
    predicted: number;
    currentCount: number;
    confidence: number;
  };
  openPositions: number;
  maxPositions: number;
  openElonPositions: number;
  maxElonPositions: number;
  totalScans: number;
  totalTrades: number;
  totalPnl: number;
  tradedMarkets: string[];
}

/**
 * Call Claude API for market analysis
 */
export async function callClaude(
  prompt: string,
  apiKey: string,
  model: string = "claude-sonnet-4-20250514"
): Promise<string> {
  if (!apiKey) {
    throw new Error("ANTHROPIC_API_KEY not configured");
  }

  const response = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": apiKey,
      "anthropic-version": "2023-06-01",
    },
    body: JSON.stringify({
      model,
      max_tokens: 500,
      messages: [{ role: "user", content: prompt }],
    }),
  });

  if (!response.ok) {
    throw new Error(`Claude error: ${response.status}`);
  }

  const data = await response.json();
  return data.content?.[0]?.text || "";
}

/**
 * Analyze opportunities using Claude AI
 */
export async function analyzeWithAI(
  context: AnalysisContext,
  apiKey: string
): Promise<AIDecision> {
  const { opportunities, elonPrediction, openPositions, maxPositions, openElonPositions, maxElonPositions, totalScans, totalTrades, totalPnl, tradedMarkets } = context;

  if (!opportunities.length) {
    return {
      shouldTrade: false,
      action: "HOLD",
      market: null,
      reasoning: "No opportunities available",
      confidence: 0,
    };
  }

  // Group by category
  const byCategory: { [key: string]: any[] } = {};
  for (const opp of opportunities) {
    const cat = opp.category || "other";
    if (!byCategory[cat]) byCategory[cat] = [];
    byCategory[cat].push(opp);
  }

  // Get diverse opportunities (one from each category)
  const diverseOpps: any[] = [];
  for (const cat of Object.keys(byCategory)) {
    const best = byCategory[cat][0];
    if (best && !tradedMarkets.includes(best.id)) {
      diverseOpps.push(best);
    }
  }

  if (diverseOpps.length === 0) {
    return {
      shouldTrade: false,
      action: "HOLD",
      market: null,
      reasoning: "All markets already traded",
      confidence: 0,
    };
  }

  // Build prompt
  const elonInfo = elonPrediction
    ? `Elon Prediction: ${elonPrediction.predicted} tweets (currently ${elonPrediction.currentCount})`
    : "";

  const prompt = `You are Poly, AI trader for Polymarket.
Stats: ${totalScans} scans | ${totalTrades} trades | PnL: $${totalPnl.toFixed(2)}
Open: ${openPositions}/${maxPositions} total | Elon: ${openElonPositions}/${maxElonPositions}
Already traded: ${tradedMarkets.slice(-5).join(", ")}
${elonInfo}

Markets (best from each category):
${diverseOpps
  .slice(0, 7)
  .map((o, i) => `${i + 1}. [${o.category}] "${o.question?.slice(0, 60)}" @ ${(o.yesPrice * 100).toFixed(0)}% | Vol: $${(o.volume24h / 1000).toFixed(0)}k | Score: ${o.score?.toFixed(2)}`)
  .join("\n")}

Rules:
- NEVER buy same market twice (check "Already traded")
- Elon tweets max ${maxElonPositions} positions
- For Elon tweet markets, use the prediction data above
- Prefer markets with edge

Respond:
ACTION: [BUY/HOLD]
MARKET: [1-7 or NONE]
CONFIDENCE: [0-100]
REASONING: [brief]`;

  try {
    const resp = await callClaude(prompt, apiKey);
    
    const action = resp.match(/ACTION:\s*(BUY|HOLD)/i)?.[1]?.toUpperCase() as "BUY" | "HOLD" || "HOLD";
    const marketIdx = resp.match(/MARKET:\s*(\d|NONE)/i)?.[1] === "NONE" 
      ? -1 
      : parseInt(resp.match(/MARKET:\s*(\d)/)?.[1] || "0") - 1;
    const confidence = parseInt(resp.match(/CONFIDENCE:\s*(\d+)/)?.[1] || "50");
    const reasoning = resp.match(/REASONING:\s*(.+)/is)?.[1]?.trim().slice(0, 300) || "";
    
    const market = action === "BUY" && marketIdx >= 0 ? diverseOpps[marketIdx] : null;

    // Validate
    if (market && tradedMarkets.includes(market.id)) {
      return {
        shouldTrade: false,
        action: "HOLD",
        market: null,
        reasoning: "Already traded this market",
        confidence: 0,
      };
    }

    if (action === "BUY" && openPositions >= maxPositions) {
      return {
        shouldTrade: false,
        action: "HOLD",
        market: null,
        reasoning: "Max total positions reached",
        confidence: 0,
      };
    }

    if (action === "BUY" && market?.category === "elon" && openElonPositions >= maxElonPositions) {
      return {
        shouldTrade: false,
        action: "HOLD",
        market: null,
        reasoning: `Max Elon positions (${maxElonPositions}) reached`,
        confidence: 0,
      };
    }

    return {
      shouldTrade: action === "BUY" && market !== null,
      action,
      market,
      reasoning,
      confidence,
    };
  } catch (e: any) {
    return {
      shouldTrade: false,
      action: "HOLD",
      market: null,
      reasoning: e.message,
      confidence: 0,
    };
  }
}
