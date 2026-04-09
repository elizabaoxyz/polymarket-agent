/**
 * RAG indexing, similarity scoring, and context enrichment.
 * Extracted from autonomy.ts for maintainability.
 */

import { RAG_SIMILARITY_WEIGHT } from "./config";
import type { AutonomyDeps, AutonomyCallbacks, AutonomyState } from "./autonomy-state";
import type { RAGService } from "./plugins/rag/service";
import type { MarketDocument, NewsDocument } from "./plugins/rag/types";
import type { ScoredMarket, JupMarket } from "./autonomy-scanner";

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

/**
 * Index markets into ChromaDB, apply similarity scoring, and fetch enrichment context.
 * Returns a string of additional context for the LLM analysis prompt.
 */
export async function indexAndEnrich(
  deps: AutonomyDeps,
  callbacks: AutonomyCallbacks,
  state: AutonomyState,
  markets: ScoredMarket[] | JupMarket[],
  platform: "polymarket" | "jupiter",
  topQuestion: string,
): Promise<string> {
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
      const ctx = connectorCtx as {
        contextSummary: string;
        articles: Array<{ title: string; description: string; source: unknown; url: unknown; publishedAt: unknown }>;
      };
      parts.push(`NEWS & WEB SEARCH:\n${ctx.contextSummary}`);
      callbacks.log(`[RAG:ENRICH] Got news+search context (${ctx.contextSummary.length} chars)`);
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
