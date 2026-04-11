/**
 * LLM call utilities for the autonomy engine.
 * Supports direct HTTP to Anthropic/OpenAI-compatible APIs,
 * with fallback to elizaOS message handler.
 */

import type { AgentRuntime, Content } from "@elizaos/core";
import { createMessageMemory, stringToUuid, ChannelType } from "@elizaos/core";
import { v4 as uuidv4 } from "uuid";
import type { AutonomyCallbacks, AutonomyDeps } from "./autonomy-state";

/**
 * Send a prompt through elizaOS message handler (triggers actions).
 */
export async function sendPrompt(
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
export async function callLlmDirect(prompt: string, maxTokens: number): Promise<string> {
  const glmKey = process.env.GLM_API_KEY?.trim();
  const anthropicKey = process.env.ANTHROPIC_API_KEY?.trim();
  const openaiKey = process.env.OPENAI_API_KEY?.trim();

  const maxRetries = 3;
  const baseDelay = 2000;

  // Anthropic-compatible (GLM Coding Plan or native Anthropic)
  if (glmKey || anthropicKey) {
    const apiKey = glmKey || anthropicKey!;
    const baseUrl = glmKey
      ? "https://api.z.ai/api/anthropic"
      : (process.env.ANTHROPIC_BASE_URL?.trim() || "https://api.anthropic.com");
    const model = glmKey
      ? (process.env.GLM_LARGE_MODEL?.trim() || "glm-4.7")
      : (process.env.ANTHROPIC_LARGE_MODEL?.trim() || process.env.LARGE_MODEL?.trim() || "claude-sonnet-4-20250514");

    for (let attempt = 0; attempt <= maxRetries; attempt++) {
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
        if (res.status === 429 && attempt < maxRetries) {
          const delay = baseDelay * Math.pow(2, attempt);
          await new Promise((r) => setTimeout(r, delay));
          continue;
        }
        throw new Error(`Anthropic API ${res.status}: ${errText.slice(0, 200)}`);
      }

      type AnthropicResponse = { content?: Array<{ type: string; text?: string }> };
      const data = (await res.json()) as AnthropicResponse;
      const textBlock = data.content?.find((b) => b.type === "text");
      return textBlock?.text?.trim() ?? "";
    }
    throw new Error("Anthropic API: max retries exceeded on 429");
  }

  // OpenAI-compatible
  if (openaiKey) {
    const baseUrl = process.env.OPENAI_BASE_URL?.trim() || "https://api.openai.com/v1";
    const model = process.env.OPENAI_LARGE_MODEL?.trim() || process.env.LARGE_MODEL?.trim() || "gpt-4o";

    for (let attempt = 0; attempt <= maxRetries; attempt++) {
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
        if (res.status === 429 && attempt < maxRetries) {
          const delay = baseDelay * Math.pow(2, attempt);
          await new Promise((r) => setTimeout(r, delay));
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

  throw new Error("No LLM API key configured (GLM_API_KEY, ANTHROPIC_API_KEY, or OPENAI_API_KEY)");
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
  const pickNum = pickMatch ? Number.parseInt(pickMatch[1]!) : 0;
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
    edge: edgeMatch ? Math.min(0.5, Number.parseFloat(edgeMatch[1]!)) : 0.10,
    confidence: confidenceMatch ? Math.min(1.0, Number.parseFloat(confidenceMatch[1]!)) : 0.5,
    category: categoryMatch ? categoryMatch[1]!.toUpperCase() : "OTHER",
    reason: reasonMatch ? reasonMatch[1]!.trim() : "",
  };
}

/**
 * Merge two LLM responses into a consensus result.
 * - If both agree on SIDE -> average estimates, edge, confidence
 * - If they disagree on SIDE -> return null (no consensus = skip)
 * - If only one result provided -> use it directly
 */
export function mergeEnsembleResults(
  textA: string,
  textB: string | null,
): ParsedLlmPick | null {
  const a = parseLlmResponse(textA);
  if (!textB) return a; // Single-provider mode

  const b = parseLlmResponse(textB);
  if (!a && !b) return null;
  if (!a || !b) return null; // If either provider skipped — no consensus

  // Both must agree on direction
  if (a.side !== b.side) return null;

  return {
    pickNum: a.pickNum,
    side: a.side,
    estimate: (a.estimate + b.estimate) / 2,
    edge: (a.edge + b.edge) / 2,
    confidence: (a.confidence + b.confidence) / 2,
    category: a.category,
    reason: `[ensemble] ${a.reason}`,
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
  const anthropicKey = process.env.ANTHROPIC_API_KEY?.trim() || process.env.GLM_API_KEY?.trim();
  const openaiKey = process.env.OPENAI_API_KEY?.trim();

  // If only one provider, fall back to regular call
  if (!anthropicKey || !openaiKey) {
    return directLlmCall(deps, callbacks, prompt, maxTokens);
  }

  callbacks.log("[LLM:ENSEMBLE] Calling 2 providers in parallel...");

  const anthropicBase = process.env.GLM_API_KEY?.trim()
    ? "https://api.z.ai/api/anthropic"
    : (process.env.ANTHROPIC_BASE_URL?.trim() || "https://api.anthropic.com");
  const anthropicModel = process.env.GLM_API_KEY?.trim()
    ? (process.env.GLM_LARGE_MODEL?.trim() || "glm-4.7")
    : (process.env.ANTHROPIC_LARGE_MODEL?.trim() || process.env.LARGE_MODEL?.trim() || "claude-sonnet-4-20250514");
  const openaiBase = process.env.OPENAI_BASE_URL?.trim() || "https://api.openai.com/v1";
  const openaiModel = process.env.OPENAI_LARGE_MODEL?.trim() || process.env.LARGE_MODEL?.trim() || "gpt-4o";

  const callAnthropic = async (): Promise<string> => {
    const res = await fetch(`${anthropicBase}/v1/messages`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": anthropicKey!,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model: anthropicModel,
        max_tokens: maxTokens,
        temperature: 0.3,
        messages: [{ role: "user", content: prompt }],
      }),
    });
    if (!res.ok) throw new Error(`Anthropic ${res.status}`);
    type R = { content?: Array<{ type: string; text?: string }> };
    const data = (await res.json()) as R;
    return data.content?.find((b) => b.type === "text")?.text?.trim() ?? "";
  };

  const callOpenai = async (): Promise<string> => {
    const res = await fetch(`${openaiBase}/chat/completions`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${openaiKey}`,
      },
      body: JSON.stringify({
        model: openaiModel,
        max_tokens: maxTokens,
        temperature: 0.3,
        messages: [{ role: "user", content: prompt }],
      }),
    });
    if (!res.ok) throw new Error(`OpenAI ${res.status}`);
    type R = { choices?: Array<{ message?: { content?: string } }> };
    const data = (await res.json()) as R;
    return data.choices?.[0]?.message?.content?.trim() ?? "";
  };

  const [resultA, resultB] = await Promise.allSettled([callAnthropic(), callOpenai()]);

  const textA = resultA.status === "fulfilled" ? resultA.value : "";
  const textB = resultB.status === "fulfilled" ? resultB.value : "";

  if (resultA.status === "rejected") {
    callbacks.log(`[LLM:ENSEMBLE] Anthropic failed: ${(resultA.reason as Error).message ?? "unknown"}`);
  }
  if (resultB.status === "rejected") {
    callbacks.log(`[LLM:ENSEMBLE] OpenAI failed: ${(resultB.reason as Error).message ?? "unknown"}`);
  }

  // If both returned results, merge all picks
  if (textA && textB) {
    // Parse all picks from each provider
    const parseAll = (text: string): ParsedLlmPick[] => {
      const blocks = text.split(/\n\s*\n/).filter(b => /PICK:/i.test(b));
      const toParse = blocks.length > 0 ? blocks : [text];
      return toParse.map(b => parseLlmResponse(b)).filter((p): p is ParsedLlmPick => p !== null);
    };

    const picksA = parseAll(textA);
    const picksB = parseAll(textB);

    // If both have picks but disagree on first pick's direction → no consensus
    if (picksA.length > 0 && picksB.length > 0 && picksA[0]!.side !== picksB[0]!.side) {
      callbacks.log(`[LLM:ENSEMBLE] No consensus — providers disagree on direction. Skipping.`);
      return "PICK: 0";
    }

    // Merge matching picks (by pickNum + same side), include extras from A
    const merged: ParsedLlmPick[] = [];
    for (const a of picksA) {
      const b = picksB.find(p => p.pickNum === a.pickNum && p.side === a.side);
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

    if (merged.length === 0) {
      callbacks.log(`[LLM:ENSEMBLE] No consensus — no valid picks from either provider.`);
      return "PICK: 0";
    }

    callbacks.log(`[LLM:ENSEMBLE] Consensus on ${merged.length} pick(s): ${merged.map(p => `${p.side} #${p.pickNum}`).join(", ")}`);

    return merged.map(p =>
      `PICK: ${p.pickNum}\nSIDE: ${p.side}\nESTIMATE: ${p.estimate.toFixed(3)}\nEDGE: ${p.edge.toFixed(3)}\nCONFIDENCE: ${p.confidence.toFixed(3)}\nCATEGORY: ${p.category}\nREASON: ${p.reason}`
    ).join("\n\n");
  }

  // If only one succeeded, use it
  return textA || textB || "";
}
