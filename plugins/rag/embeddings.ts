import { z } from "zod";
import { EmbeddingResponseSchema } from "./types";

/**
 * OpenAI Embeddings client — generates vector embeddings for RAG indexing and similarity search.
 * Uses text-embedding-3-small by default (1536 dimensions).
 */
export class EmbeddingClient {
  private readonly apiKey: string;
  private readonly model: string;
  private readonly baseUrl = "https://api.openai.com/v1";

  constructor(config: { readonly apiKey: string; readonly model?: string }) {
    this.apiKey = config.apiKey;
    this.model = config.model ?? "text-embedding-3-small";
  }

  /**
   * Generate embedding for a single text string.
   */
  async embedSingle(text: string): Promise<number[]> {
    const results = await this.embedBatch([text]);
    return results[0]!;
  }

  /**
   * Generate embeddings for multiple texts in a single API call.
   * Batches larger than 100 texts are automatically chunked.
   */
  async embedBatch(texts: readonly string[]): Promise<number[][]> {
    if (texts.length === 0) return [];

    const chunkSize = 100;
    const allEmbeddings: number[][] = [];

    for (let i = 0; i < texts.length; i += chunkSize) {
      const chunk = texts.slice(i, i + chunkSize);
      const embeddings = await this.callApi(chunk);
      allEmbeddings.push(...embeddings);
    }

    return allEmbeddings;
  }

  private async callApi(texts: readonly string[]): Promise<number[][]> {
    const res = await fetch(`${this.baseUrl}/embeddings`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${this.apiKey}`,
      },
      body: JSON.stringify({
        model: this.model,
        input: texts,
      }),
    });

    if (!res.ok) {
      const text = await res.text().catch(() => "");
      throw new Error(`OpenAI embeddings API error ${res.status}: ${text}`);
    }

    const data = await res.json();
    const parsed = EmbeddingResponseSchema.parse(data);

    // Sort by index to ensure correct ordering
    const sorted = parsed.data.sort((a, b) => a.index - b.index);
    return sorted.map((d) => d.embedding);
  }
}
