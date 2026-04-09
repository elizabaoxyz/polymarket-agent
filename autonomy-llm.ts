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
 */
export async function callLlmDirect(prompt: string, maxTokens: number): Promise<string> {
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

    type AnthropicResponse = { content?: Array<{ type: string; text?: string }> };
    const data = (await res.json()) as AnthropicResponse;
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

    type OpenAiResponse = { choices?: Array<{ message?: { content?: string } }> };
    const data = (await res.json()) as OpenAiResponse;
    return data.choices?.[0]?.message?.content?.trim() ?? "";
  }

  throw new Error("No LLM API key configured (GLM_API_KEY, ANTHROPIC_API_KEY, or OPENAI_API_KEY)");
}
