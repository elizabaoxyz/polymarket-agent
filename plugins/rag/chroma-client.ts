import { z } from "zod";
import {
  ChromaCollectionSchema,
  ChromaQueryResponseSchema,
  type ChromaCollection,
  type SimilarityResult,
} from "./types";

const CHROMA_API_VERSION = "api/v2";

/**
 * ChromaDB HTTP client — connects to a running ChromaDB server.
 * Handles collection management, document indexing, and similarity search.
 */
export class ChromaClient {
  private readonly baseUrl: string;
  private readonly headers: Record<string, string>;

  constructor(config: { readonly chromaUrl: string }) {
    this.baseUrl = `${config.chromaUrl}/${CHROMA_API_VERSION}`;
    this.headers = { "Content-Type": "application/json" };
  }

  // --- Collection management ---

  async listCollections(): Promise<ChromaCollection[]> {
    const res = await fetch(
      `${this.baseUrl}/tenants/default_tenant/databases/default_database/collections`,
      { headers: this.headers },
    );
    if (!res.ok) throw new Error(`ChromaDB list collections failed: ${res.status}`);
    const data = await res.json();
    return z.array(ChromaCollectionSchema).parse(data);
  }

  async getOrCreateCollection(name: string): Promise<{ id: string; name: string }> {
    const res = await fetch(
      `${this.baseUrl}/tenants/default_tenant/databases/default_database/collections`,
      {
        method: "POST",
        headers: this.headers,
        body: JSON.stringify({
          name,
          get_or_create: true,
          metadata: { "hnsw:space": "cosine" },
        }),
      },
    );
    if (!res.ok) {
      const text = await res.text().catch(() => "");
      throw new Error(`ChromaDB create collection failed: ${res.status} ${text}`);
    }
    return (await res.json()) as { id: string; name: string };
  }

  // --- Document operations ---

  async upsertDocuments(
    collectionName: string,
    documents: ReadonlyArray<{
      readonly id: string;
      readonly content: string;
      readonly embedding: number[];
      readonly metadata: Record<string, unknown>;
    }>,
  ): Promise<void> {
    if (documents.length === 0) return;

    const collection = await this.getOrCreateCollection(collectionName);

    const body = {
      ids: documents.map((d) => d.id),
      documents: documents.map((d) => d.content),
      embeddings: documents.map((d) => d.embedding),
      metadatas: documents.map((d) => d.metadata),
    };

    // Try add first, fall back to update if doc already exists
    const addRes = await fetch(
      `${this.baseUrl}/tenants/default_tenant/databases/default_database/collections/${collection.id}/add`,
      { method: "POST", headers: this.headers, body: JSON.stringify(body) },
    );

    if (!addRes.ok) {
      const updateRes = await fetch(
        `${this.baseUrl}/tenants/default_tenant/databases/default_database/collections/${collection.id}/update`,
        { method: "POST", headers: this.headers, body: JSON.stringify(body) },
      );
      if (!updateRes.ok) {
        const text = await updateRes.text().catch(() => "");
        throw new Error(`ChromaDB upsert failed: ${updateRes.status} ${text}`);
      }
    }
  }

  async deleteCollection(name: string): Promise<void> {
    const collections = await this.listCollections();
    const existing = collections.find((c) => c.name === name);
    if (!existing) return;

    const res = await fetch(
      `${this.baseUrl}/tenants/default_tenant/databases/default_database/collections/${existing.id}`,
      { method: "DELETE", headers: this.headers },
    );
    if (!res.ok) {
      const text = await res.text().catch(() => "");
      throw new Error(`ChromaDB delete collection failed: ${res.status} ${text}`);
    }
  }

  // --- Similarity search ---

  async query(
    collectionName: string,
    queryEmbedding: number[],
    maxResults: number = 10,
  ): Promise<SimilarityResult[]> {
    const collection = await this.getOrCreateCollection(collectionName);

    const body = {
      query_embeddings: [queryEmbedding],
      n_results: maxResults,
      include: ["documents", "metadatas", "distances"],
    };

    const res = await fetch(
      `${this.baseUrl}/tenants/default_tenant/databases/default_database/collections/${collection.id}/query`,
      { method: "POST", headers: this.headers, body: JSON.stringify(body) },
    );

    if (!res.ok) {
      const text = await res.text().catch(() => "");
      throw new Error(`ChromaDB query failed: ${res.status} ${text}`);
    }

    const data = await res.json();
    const parsed = ChromaQueryResponseSchema.safeParse(data);

    if (!parsed.success || !parsed.data.ids[0]) return [];

    const ids = parsed.data.ids[0];
    const docs = parsed.data.documents[0];
    const dists = parsed.data.distances[0];
    const metas = parsed.data.metadatas[0];

    const results: SimilarityResult[] = [];
    for (let i = 0; i < ids.length; i++) {
      const distance = dists[i] ?? 1;
      const score = Math.max(0, 1 - distance); // cosine distance → similarity
      results.push({
        id: ids[i]!,
        content: docs[i] ?? "",
        score,
        metadata: (metas[i] as Record<string, unknown>) ?? {},
      });
    }
    return results;
  }

  async countDocuments(collectionName: string): Promise<number> {
    try {
      const collection = await this.getOrCreateCollection(collectionName);
      const res = await fetch(
        `${this.baseUrl}/tenants/default_tenant/databases/default_database/collections/${collection.id}/count`,
        { headers: this.headers },
      );
      if (!res.ok) return 0;
      return await res.json() as number;
    } catch {
      return 0;
    }
  }
}
