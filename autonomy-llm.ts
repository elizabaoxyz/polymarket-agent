/**
 * LLM call utilities for the autonomy engine.
 * Supports direct HTTP to Anthropic/OpenAI-compatible APIs,
 * with fallback to elizaOS message handler.
 */

import type { Content } from "@elizaos/core";
import { ChannelType, createMessageMemory, type stringToUuid } from "@elizaos/core";
import { v4 as uuidv4 } from "uuid";
import type { AutonomyCallbacks, AutonomyDeps } from "./autonomy-state";
import { LLM_TEMPERATURE, MIN_CONFIDENCE_THRESHOLD, MIN_EDGE_THRESHOLD } from "./config";
import { DEFAULT_LLM_MODELS, type LlmProvider, resolveLlmModel, resolveLlmProvider } from "./lib";
import { formatIntelForPrompt } from "./market-intel";

type AnthropicFamilyProvider = "anthropic" | "glm";

const MAX_LLM_RETRIES = 3;
const LLM_RETRY_BASE_DELAY_MS = 2000;

function getEnvValue(key: string): string | undefined {
  const value = process.env[key];
  return typeof value === "string" ? value : undefined;
}

function isTruthyEnv(value: string | undefined): boolean {
  if (!value) return false;
  return ["1", "true", "yes", "on"].includes(value.trim().toLowerCase());
}

export function resolveAutonomyLlmProvider(
  getValue: (key: string) => string | undefined = getEnvValue,
): LlmProvider | null {
  return resolveLlmProvider((key) => getValue(key));
}

export function shouldUseAutonomyEnsemble(
  getValue: (key: string) => string | undefined = getEnvValue,
): boolean {
  if (!isTruthyEnv(getValue("AUTONOMY_LLM_ENSEMBLE"))) return false;
  const openaiEmbeddingsOnly = isTruthyEnv(getValue("OPENAI_EMBEDDINGS_ONLY"));
  const openaiKey = getValue("OPENAI_API_KEY")?.trim();
  const anthropicKey = getValue("GLM_API_KEY")?.trim() || getValue("ANTHROPIC_API_KEY")?.trim();
  return Boolean(anthropicKey && openaiKey && !openaiEmbeddingsOnly);
}

function resolveModelForProvider(
  provider: LlmProvider,
  getValue: (key: string) => string | undefined = getEnvValue,
): string {
  return resolveLlmModel(provider, (key) => getValue(key)) ?? DEFAULT_LLM_MODELS[provider];
}

function getAnthropicFamilyConfig(
  provider: AnthropicFamilyProvider,
  getValue: (key: string) => string | undefined = getEnvValue,
): { apiKey: string; baseUrl: string; model: string } {
  if (provider === "glm") {
    const apiKey = getValue("GLM_API_KEY")?.trim();
    if (!apiKey) throw new Error("GLM provider selected but GLM_API_KEY is not configured");
    return {
      apiKey,
      baseUrl: getValue("ANTHROPIC_BASE_URL")?.trim() || "https://api.z.ai/api/anthropic",
      model: resolveModelForProvider("glm", getValue),
    };
  }

  const apiKey = getValue("ANTHROPIC_API_KEY")?.trim();
  if (!apiKey) {
    throw new Error("Anthropic provider selected but ANTHROPIC_API_KEY is not configured");
  }
  return {
    apiKey,
    baseUrl: getValue("ANTHROPIC_BASE_URL")?.trim() || "https://api.anthropic.com",
    model: resolveModelForProvider("anthropic", getValue),
  };
}

function getOpenAiConfig(getValue: (key: string) => string | undefined = getEnvValue): {
  apiKey: string;
  baseUrl: string;
  model: string;
} {
  if (isTruthyEnv(getValue("OPENAI_EMBEDDINGS_ONLY"))) {
    throw new Error("OpenAI provider is reserved for embeddings only in this environment");
  }
  const apiKey = getValue("OPENAI_API_KEY")?.trim();
  if (!apiKey) throw new Error("OpenAI provider selected but OPENAI_API_KEY is not configured");
  return {
    apiKey,
    baseUrl: getValue("OPENAI_BASE_URL")?.trim() || "https://api.openai.com/v1",
    model: resolveModelForProvider("openai", getValue),
  };
}

async function delay(ms: number): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, ms));
}

async function callAnthropicCompatible(
  prompt: string,
  maxTokens: number,
  config: { apiKey: string; baseUrl: string; model: string },
  label: string,
): Promise<string> {
  for (let attempt = 0; attempt <= MAX_LLM_RETRIES; attempt++) {
    const res = await fetch(`${config.baseUrl}/v1/messages`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": config.apiKey,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model: config.model,
        max_tokens: maxTokens,
        temperature: LLM_TEMPERATURE,
        messages: [{ role: "user", content: prompt }],
      }),
    });

    if (!res.ok) {
      const errText = await res.text().catch(() => "");
      if (res.status === 429 && attempt < MAX_LLM_RETRIES) {
        await delay(LLM_RETRY_BASE_DELAY_MS * 2 ** attempt);
        continue;
      }
      throw new Error(`${label} API ${res.status}: ${errText.slice(0, 200)}`);
    }

    type AnthropicResponse = { content?: Array<{ type: string; text?: string }> };
    const data = (await res.json()) as AnthropicResponse;
    const textBlock = data.content?.find((block) => block.type === "text");
    return textBlock?.text?.trim() ?? "";
  }

  throw new Error(`${label} API: max retries exceeded on 429`);
}

async function callOpenAiCompatible(
  prompt: string,
  maxTokens: number,
  config: { apiKey: string; baseUrl: string; model: string },
): Promise<string> {
  for (let attempt = 0; attempt <= MAX_LLM_RETRIES; attempt++) {
    const res = await fetch(`${config.baseUrl}/chat/completions`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${config.apiKey}`,
      },
      body: JSON.stringify({
        model: config.model,
        max_tokens: maxTokens,
        temperature: LLM_TEMPERATURE,
        messages: [{ role: "user", content: prompt }],
      }),
    });

    if (!res.ok) {
      const errText = await res.text().catch(() => "");
      if (res.status === 429 && attempt < MAX_LLM_RETRIES) {
        await delay(LLM_RETRY_BASE_DELAY_MS * 2 ** attempt);
        continue;
      }
      throw new Error(`OpenAI API ${res.status}: ${errText.slice(0, 200)}`);
    }

    type OpenAiResponse = { choices?: Array<{ message?: { content?: string } }> };
    const data = (await res.json()) as OpenAiResponse;
    return data.choices?.[0]?.message?.content?.trim() ?? "";
  }

  throw new Error("OpenAI API: max retries exceeded on 429");
}

/**
 * Send a prompt through elizaOS message handler (triggers actions).
 */
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
 * Call the LLM for analysis via direct HTTP — bypasses elizaOS message handler
 * entirely. The message handler routes prompts through action selection which
 * swallows the text response.
 */
export async function directLlmCall(
  deps: AutonomyDeps,
  callbacks: AutonomyCallbacks,
  prompt: string,
  maxTokens = 1000,
): Promise<string> {
  try {
    const text = await callLlmDirect(prompt, maxTokens);
    if (text.length > 0) return text;
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    callbacks.log(`[LLM] Direct API error: ${msg}`);
  }

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
 * Retries up to 3 times on 429 (rate limit) with exponential backoff.
 */
async function callLlmDirect(prompt: string, maxTokens: number): Promise<string> {
  const provider = resolveAutonomyLlmProvider();

  switch (provider) {
    case "glm":
      return callAnthropicCompatible(prompt, maxTokens, getAnthropicFamilyConfig("glm"), "GLM");
    case "anthropic":
      return callAnthropicCompatible(
        prompt,
        maxTokens,
        getAnthropicFamilyConfig("anthropic"),
        "Anthropic",
      );
    case "openai":
      return callOpenAiCompatible(prompt, maxTokens, getOpenAiConfig());
    case "gemini":
    case "groq":
    case "grok":
      throw new Error(
        `Direct autonomy LLM calls are not implemented for configured provider "${provider}"`,
      );
    default:
      throw new Error(
        "No LLM provider configured for autonomy (set ELIZA_LLM_PROVIDER or a provider API key)",
      );
  }
}

/** Parsed LLM structured output for a single pick. */
export type ParsedLlmPick = {
  pickNum: number;
  side: string;
  estimate: number;
  edge: number;
  confidence: number;
  category: string;
  reason: string;
};

/** Parse a single structured LLM response into fields. Returns null if unparseable or SKIP. */
function parseLlmResponse(text: string): ParsedLlmPick | null {
  if (!text || text.length === 0) return null;

  const pickMatch = /PICK:\s*(\d+)/i.exec(text);
  const pickNum = pickMatch ? Number.parseInt(pickMatch[1]!, 10) : 0;
  if (pickNum === 0) return null;

  const sideMatch = /SIDE:\s*(YES|NO)/i.exec(text);
  if (!sideMatch) return null;

  const estimateMatch = /ESTIMATE:\s*([\d.]+)/i.exec(text);
  const edgeMatch = /EDGE:\s*([\d.]+)/i.exec(text);
  const confidenceMatch = /CONFIDENCE:\s*([\d.]+)/i.exec(text);
  const categoryMatch = /CATEGORY:\s*(\w+)/i.exec(text);
  const reasonMatch = /REASON:\s*(.+)/i.exec(text);

  return {
    pickNum,
    side: sideMatch[1]!.toUpperCase(),
    estimate: estimateMatch ? Number.parseFloat(estimateMatch[1]!) : 0.5,
    edge: edgeMatch ? Math.min(0.5, Number.parseFloat(edgeMatch[1]!)) : 0.1,
    confidence: confidenceMatch ? Math.min(1.0, Number.parseFloat(confidenceMatch[1]!)) : 0.5,
    category: categoryMatch ? categoryMatch[1]!.toUpperCase() : "OTHER",
    reason: reasonMatch ? reasonMatch[1]!.trim() : "",
  };
}

/**
 * Call two LLM providers in parallel and merge results.
 * Falls back to single-provider if only one API key is configured.
 */
export async function ensembleLlmCall(
  deps: AutonomyDeps,
  callbacks: AutonomyCallbacks,
  prompt: string,
  maxTokens = 800,
): Promise<string> {
  if (!shouldUseAutonomyEnsemble()) {
    return directLlmCall(deps, callbacks, prompt, maxTokens);
  }

  callbacks.log("[LLM:ENSEMBLE] Calling 2 providers in parallel...");

  const anthropicProvider: AnthropicFamilyProvider = process.env.GLM_API_KEY?.trim()
    ? "glm"
    : "anthropic";
  const anthropicConfig = getAnthropicFamilyConfig(anthropicProvider);
  const openaiConfig = getOpenAiConfig();

  const callAnthropic = async (): Promise<string> => {
    return callAnthropicCompatible(
      prompt,
      maxTokens,
      anthropicConfig,
      anthropicProvider === "glm" ? "GLM" : "Anthropic",
    );
  };

  const callOpenai = async (): Promise<string> => {
    return callOpenAiCompatible(prompt, maxTokens, openaiConfig);
  };

  const [resultA, resultB] = await Promise.allSettled([callAnthropic(), callOpenai()]);

  const textA = resultA.status === "fulfilled" ? resultA.value : "";
  const textB = resultB.status === "fulfilled" ? resultB.value : "";

  if (resultA.status === "rejected") {
    callbacks.log(
      `[LLM:ENSEMBLE] Anthropic failed: ${(resultA.reason as Error).message ?? "unknown"}`,
    );
  }
  if (resultB.status === "rejected") {
    callbacks.log(
      `[LLM:ENSEMBLE] OpenAI failed: ${(resultB.reason as Error).message ?? "unknown"}`,
    );
  }

  // If both returned results, merge all picks
  if (textA && textB) {
    // Parse all picks from each provider
    const parseAll = (text: string): ParsedLlmPick[] => {
      const blocks = text.split(/\n\s*\n/).filter((b) => /PICK:/i.test(b));
      const toParse = blocks.length > 0 ? blocks : [text];
      return toParse.map((b) => parseLlmResponse(b)).filter((p): p is ParsedLlmPick => p !== null);
    };

    const picksA = parseAll(textA);
    const picksB = parseAll(textB);

    // Merge picks: consensus gets full confidence, disagreement lets the more confident provider through with a penalty
    const merged: ParsedLlmPick[] = [];

    if (picksA.length > 0 && picksB.length > 0 && picksA[0]!.side !== picksB[0]!.side) {
      // Providers disagree on direction — pick the more confident one with a penalty
      const confA = picksA[0]!.confidence;
      const confB = picksB[0]!.confidence;
      const winner = confA >= confB ? picksA[0]! : picksB[0]!;
      const loser = confA >= confB ? picksB[0]! : picksA[0]!;
      const confGap = Math.abs(confA - confB);
      // Bigger gap = more conviction from winner. Scale penalty: 0.75x base, up to 0.85x if gap > 0.15
      const penalty = confGap > 0.15 ? 0.85 : 0.75;
      callbacks.log(
        `[LLM:ENSEMBLE] Providers disagree (${picksA[0]!.side} vs ${picksB[0]!.side}) — using ${winner.side} (conf ${winner.confidence.toFixed(2)} vs ${loser.confidence.toFixed(2)}, ${penalty}x penalty)`,
      );
      merged.push({
        ...winner,
        confidence: winner.confidence * penalty,
        edge: winner.edge * 0.9,
        reason: `[split-decision] ${winner.reason}`,
      });
    } else {
      // Same direction or only one has picks — merge normally
      for (const a of picksA) {
        const b = picksB.find((p) => p.pickNum === a.pickNum && p.side === a.side);
        if (b) {
          merged.push({
            ...a,
            estimate: (a.estimate + b.estimate) / 2,
            edge: (a.edge + b.edge) / 2,
            confidence: (a.confidence + b.confidence) / 2,
            reason: `[ensemble] ${a.reason}`,
          });
        } else {
          merged.push({ ...a, confidence: a.confidence * 0.9, reason: `[single] ${a.reason}` });
        }
      }
    }

    if (merged.length === 0) {
      callbacks.log(`[LLM:ENSEMBLE] No consensus — no valid picks from either provider.`);
      return "PICK: 0";
    }

    callbacks.log(
      `[LLM:ENSEMBLE] Consensus on ${merged.length} pick(s): ${merged.map((p) => `${p.side} #${p.pickNum}`).join(", ")}`,
    );

    return merged
      .map(
        (p) =>
          `PICK: ${p.pickNum}\nSIDE: ${p.side}\nESTIMATE: ${p.estimate.toFixed(3)}\nEDGE: ${p.edge.toFixed(3)}\nCONFIDENCE: ${p.confidence.toFixed(3)}\nCATEGORY: ${p.category}\nREASON: ${p.reason}`,
      )
      .join("\n\n");
  }

  // If only one succeeded, use it
  return textA || textB || "";
}

export type AnalysisResult = {
  pick: {
    question: string;
    yesPrice: number;
    score: number;
    volume?: number;
    daysLeft?: number;
    intel?: import("./market-intel").MarketIntel | null;
  };
  side: string;
  reason: string;
  edge: number; // 0-1: how big the edge is
  confidence: number; // 0-1: how confident the LLM is
  category: string; // market category for logging
  estimatedProb: number; // LLM's estimated true probability
};

export async function analyzeCandidates(
  deps: AutonomyDeps,
  callbacks: AutonomyCallbacks,
  candidates: Array<{
    question: string;
    yesPrice: number;
    score: number;
    volume?: number;
    daysLeft?: number;
    intel?: import("./market-intel").MarketIntel | null;
  }>,
  ragContext: string,
): Promise<AnalysisResult[]> {
  const today = new Date().toISOString().split("T")[0];
  const useEnsemble = shouldUseAutonomyEnsemble();

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

  callbacks.log(
    `[ANALYSIS] Analyzing top ${candidates.length} markets${useEnsemble ? " (ensemble)" : ""}...`,
  );
  for (const c of candidates) {
    callbacks.log(
      `[ANALYSIS:CANDIDATE] "${c.question.slice(0, 60)}" YES:$${c.yesPrice.toFixed(2)} score:${c.score.toFixed(2)} vol:$${c.volume?.toFixed(0) ?? "?"}`,
    );
  }

  const structuredPrompt = `You are a prediction market TRADER, not an analyst. Today is ${today}.
You trade Polymarket (~$22) and Jupiter Predict (~$42). Your job is to MAKE MONEY, not write reports.

CORE PRINCIPLE: You have idle capital and your job is to put it to work.
Pick the BEST opportunity from the candidates. Even a small edge is worth trading — idle cash earns nothing.
Only skip ALL markets if you truly see zero edge on any of them.

HOW TO THINK:
- You have REAL knowledge. Crypto prices, sports matchups, geopolitical trends, tech news — USE IT.
- Markets are set by other traders who are often wrong. Your edge comes from knowing things the crowd hasn't priced in.
- A 55-45 situation priced at 50-50 IS an edge. But a 51-49 situation is NOT — skip it.
- You don't need certainty. You need a GENUINE LEAN — which side is more likely and WHY?
- BUY NO aggressively when YES is overpriced. Most traders only look at YES.
- Sports: home/away, recent form, injuries, matchup history. You know this.
- Politics: incumbency advantage, polling, structural factors. Make a call.
- Crypto: current price action vs market target. You can estimate this.

SIZING (code handles this — just be honest about your confidence):
- Half-Kelly with 10% bankroll cap. Bigger confidence = bigger bet.
- $2-$7 per trade depending on edge and confidence.

FEE REALITY: Polymarket trades cost ~3% in fees. Jupiter Predict fees are lower (~1%).
Don't let fee paranoia stop you from trading. A 5% edge after fees is still a 5% edge.

${candidateList}${ragContext}

=== YOUR JOB ===

Evaluate each candidate honestly. Pick ONLY if you have genuine conviction.

For each candidate, decide: which side would you bet? How confident are you?

PICK: <market number — pick the best opportunity. PICK: 0 only if you truly see no edge on ANY candidate>
SIDE: YES or NO
ESTIMATE: <your TRUE probability for YES, 0.00-1.00 — commit to a number, don't hedge>
EDGE: <your estimate minus market price for your chosen side>
CONFIDENCE: <0.55-1.0 — 0.55 means genuine lean, 0.70 means solid read, 0.90 means near-certain>
CATEGORY: <SPORTS|POLITICS|CRYPTO|CULTURE|TECH|OTHER>
REASON: <one sentence — your strongest signal>

PICK: 0 only if you genuinely see zero edge on every single candidate. Idle capital is a cost — find the best trade.`;

  const text = useEnsemble
    ? await ensembleLlmCall(deps, callbacks, structuredPrompt, 1000)
    : await directLlmCall(deps, callbacks, structuredPrompt, 1000);

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

    const pickNum = pickMatch ? Number.parseInt(pickMatch[1]!, 10) : 0;
    if (pickNum === 0) continue;

    const pickIdx = Math.min(pickNum - 1, candidates.length - 1);
    const pick = candidates[Math.max(0, pickIdx)]!;
    const side = sideMatch[1]!.toUpperCase();
    const edge = edgeMatch ? Math.min(0.5, Number.parseFloat(edgeMatch[1]!)) : 0.1;
    const confidence = confidenceMatch
      ? Math.min(1.0, Number.parseFloat(confidenceMatch[1]!))
      : 0.5;
    const estimatedProb = estimateMatch ? Number.parseFloat(estimateMatch[1]!) : pick.yesPrice;
    const category = categoryMatch ? categoryMatch[1]!.toUpperCase() : "OTHER";
    const reason = reasonMatch ? reasonMatch[1]!.trim() : "";

    if (edge < MIN_EDGE_THRESHOLD) {
      callbacks.log(
        `[ANALYSIS] ❌ Edge ${edge.toFixed(2)} below minimum ${MIN_EDGE_THRESHOLD} — skipping "${pick.question.slice(0, 50)}"`,
      );
      continue;
    }

    if (confidence < MIN_CONFIDENCE_THRESHOLD) {
      callbacks.log(
        `[ANALYSIS] ❌ Confidence ${confidence.toFixed(2)} below minimum ${MIN_CONFIDENCE_THRESHOLD} — skipping "${pick.question.slice(0, 50)}"`,
      );
      continue;
    }

    callbacks.log(
      `[ANALYSIS] ✅ #${results.length + 1} ${category} | ${side} | edge=${edge.toFixed(2)} | conf=${confidence.toFixed(2)} | est=${estimatedProb.toFixed(2)} | "${reason.slice(0, 80)}"`,
    );

    results.push({ pick, side, reason, edge, confidence, category, estimatedProb });
  }

  if (results.length === 0) {
    callbacks.log(`[ANALYSIS] Skipping — LLM found no qualifying trades`);
  }

  return results;
}
