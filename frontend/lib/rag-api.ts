/**
 * RAG / Knowledge API client — talks to the AI service via the backend proxy.
 *
 * All RAG Q&A goes through rag_chain (single orchestration), and all knowledge
 * ingestion / review / stats go through the knowledge repository endpoints.
 */
import type {
  KnowledgeChunk,
  KnowledgeEntry,
  KnowledgeStats,
  KnowledgeVersion,
  RagAnswer,
  RagSettings,
  Reference,
  RetrievalMeta,
  SearchResult,
  StageInfo,
  UploadResult,
} from "@/lib/knowledge-types";

const API_BASE = process.env.NEXT_PUBLIC_API_URL || "";

function authHeaders(extra?: Record<string, string>): Record<string, string> {
  const token = typeof window !== "undefined" ? localStorage.getItem("token") : "";
  return {
    "Content-Type": "application/json",
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
    ...extra,
  };
}

function multipartHeaders(): Record<string, string> {
  const token = typeof window !== "undefined" ? localStorage.getItem("token") : "";
  return token ? { Authorization: `Bearer ${token}` } : {};
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${API_BASE}${path}`, init);
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`请求失败 (${res.status}): ${text.slice(0, 300)}`);
  }
  const ct = res.headers.get("content-type") || "";
  return (ct.includes("application/json") ? res.json() : (res.text() as unknown)) as Promise<T>;
}

function coursePath(courseId: string, suffix = ""): string {
  return `/api/v1/courses/${encodeURIComponent(courseId)}${suffix}`;
}

export const ragApi = {
  // ── Retrieval & Q&A ─────────────────────────────────────────────────────
  async search(courseId: string, query: string, topK = 8): Promise<SearchResult> {
    const params = new URLSearchParams({ q: query, top_k: String(topK) });
    return request<SearchResult>(
      coursePath(courseId, `/rag/search?${params.toString()}`),
      { headers: authHeaders() },
    );
  },

  async ask(
    courseId: string,
    question: string,
    history?: Array<{ role: string; content: string }>,
    topK?: number,
  ): Promise<RagAnswer> {
    return request<RagAnswer>(coursePath(courseId, "/rag/ask"), {
      method: "POST",
      headers: authHeaders(),
      body: JSON.stringify({ question, history, top_k: topK }),
    });
  },

  /**
   * Stream the RAG answer over SSE. Emits stage events (guard/retrieve/rerank/
   * generate/cite), token deltas, then a harness payload carrying
   * `retrieval_meta` + `references`.
   */
  async askStream(
    courseId: string,
    question: string,
    callbacks: {
      onStage?: (stages: StageInfo[]) => void;
      onChunk?: (delta: string) => void;
      onReplace?: (fullContent: string) => void;
      onHarness?: (data: { retrieval_meta: RetrievalMeta; references: Reference[] }) => void;
      onDone?: (fullContent: string) => void;
      onError?: (error: Error) => void;
    },
    signal?: AbortSignal,
  ): Promise<void> {
    const { onStage, onChunk, onReplace, onHarness, onDone, onError } = callbacks;
    try {
      const res = await fetch(coursePath(courseId, "/rag/ask/stream"), {
        method: "POST",
        headers: authHeaders(),
        body: JSON.stringify({ question }),
        signal,
      });
      if (!res.ok) {
        const text = await res.text().catch(() => "");
        throw new Error(`流式请求失败 (${res.status}): ${text.slice(0, 200)}`);
      }
      const reader = res.body?.getReader();
      if (!reader) throw new Error("Response body is not readable");

      const decoder = new TextDecoder();
      let buffer = "";
      let full = "";
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split("\n");
        buffer = lines.pop() || "";
        for (const line of lines) {
          const trimmed = line.trim();
          if (!trimmed.startsWith("data: ")) continue;
          const payload = trimmed.slice(6).trim();
          if (payload === "[DONE]" || payload === '"[DONE]"') {
            onDone?.(full);
            return;
          }
          try {
            const data = JSON.parse(payload);
            if (data.type === "stage") {
              onStage?.(data.data);
            } else if (data.type === "replace") {
              const replacement = data?.data?.content;
              if (typeof replacement === "string") {
                full = replacement;
                onReplace?.(replacement);
              }
            } else if (data.type === "harness") {
              onHarness?.(data.data);
            } else {
              const delta = data?.choices?.[0]?.delta?.content;
              if (delta) {
                full += delta;
                onChunk?.(delta);
              }
            }
          } catch {
            // skip unparseable keep-alive lines
          }
        }
      }
      onDone?.(full);
    } catch (err) {
      if (err instanceof DOMException && err.name === "AbortError") return;
      onError?.(err instanceof Error ? err : new Error(String(err)));
    }
  },

  async export(
    courseId: string,
    messages: Array<Record<string, unknown>>,
  ): Promise<{ markdown: string }> {
    return request<{ markdown: string }>(coursePath(courseId, "/rag/export"), {
      method: "POST",
      headers: authHeaders(),
      body: JSON.stringify({ messages }),
    });
  },

  // ── RAG settings ────────────────────────────────────────────────────────
  async getSettings(courseId: string): Promise<RagSettings> {
    return request<RagSettings>(coursePath(courseId, "/rag/settings"), { headers: authHeaders() });
  },

  async updateSettings(courseId: string, settings: Partial<RagSettings>): Promise<RagSettings> {
    return request<RagSettings>(coursePath(courseId, "/rag/settings"), {
      method: "PUT",
      headers: authHeaders(),
      body: JSON.stringify(settings),
    });
  },

  // ── Knowledge entries ───────────────────────────────────────────────────
  async listEntries(
    courseId: string,
    filters?: { status?: string; source_type?: string; knowledge_type?: string },
  ): Promise<KnowledgeEntry[]> {
    const params = new URLSearchParams();
    if (filters?.status) params.set("status", filters.status);
    if (filters?.source_type) params.set("source_type", filters.source_type);
    if (filters?.knowledge_type) params.set("knowledge_type", filters.knowledge_type);
    const qs = params.toString();
    return request<KnowledgeEntry[]>(coursePath(courseId, `/knowledge/review/all${qs ? `?${qs}` : ""}`), {
      headers: authHeaders(),
    });
  },

  async getEntry(courseId: string, entryId: string): Promise<KnowledgeEntry> {
    return request<KnowledgeEntry>(coursePath(courseId, `/knowledge/${encodeURIComponent(entryId)}`), {
      headers: authHeaders(),
    });
  },

  async getChunks(
    courseId: string,
    entryId: string,
  ): Promise<{ entry_id: string; title: string; chunks: KnowledgeChunk[] }> {
    return request(coursePath(courseId, `/knowledge/${encodeURIComponent(entryId)}/chunks`), {
      headers: authHeaders(),
    });
  },

  async updateChunk(
    courseId: string,
    entryId: string,
    chunkId: string,
    content: string,
  ): Promise<{ ok: boolean; embedding_dim: number }> {
    return request(coursePath(courseId, `/knowledge/${encodeURIComponent(entryId)}/chunks/${encodeURIComponent(chunkId)}`), {
      method: "PUT",
      headers: authHeaders(),
      body: JSON.stringify({ content }),
    });
  },

  async versions(courseId: string, entryId: string): Promise<KnowledgeVersion[]> {
    return request(coursePath(courseId, `/knowledge/${encodeURIComponent(entryId)}/versions`), {
      headers: authHeaders(),
    });
  },

  async rechunk(
    courseId: string,
    entryId: string,
    payload: { chunking_template: string; chunk_size?: number; chunk_overlap?: number },
  ): Promise<{ ok: boolean; chunk_count: number }> {
    return request(coursePath(courseId, `/knowledge/${encodeURIComponent(entryId)}/rechunk`), {
      method: "POST",
      headers: authHeaders(),
      body: JSON.stringify(payload),
    });
  },

  async rollback(
    courseId: string,
    entryId: string,
    versionNo: number,
  ): Promise<{ ok: boolean; chunk_count: number; version_no: number }> {
    return request(coursePath(courseId, `/knowledge/${encodeURIComponent(entryId)}/rollback`), {
      method: "POST",
      headers: authHeaders(),
      body: JSON.stringify({ version_no: versionNo }),
    });
  },

  // ── Ingestion ───────────────────────────────────────────────────────────
  async uploadFile(
    courseId: string,
    file: File,
    metadata: {
      title?: string;
      knowledge_type?: string;
      tags?: string[];
      experiment_id?: string;
      chunking_template?: string;
      chunk_size?: number;
      chunk_overlap?: number;
    },
  ): Promise<UploadResult> {
    const form = new FormData();
    form.append("file", file);
    if (metadata.title) form.append("title", metadata.title);
    form.append("knowledge_type", metadata.knowledge_type || "course_notes");
    form.append("tags", (metadata.tags || []).join(","));
    if (metadata.experiment_id) form.append("experiment_id", metadata.experiment_id);
    form.append("chunking_template", metadata.chunking_template || "general");
    if (metadata.chunk_size) form.append("chunk_size", String(metadata.chunk_size));
    if (metadata.chunk_overlap) form.append("chunk_overlap", String(metadata.chunk_overlap));

    return request<UploadResult>(coursePath(courseId, "/knowledge/upload"), {
      method: "POST",
      headers: multipartHeaders(),
      body: form,
    });
  },

  async paste(
    courseId: string,
    payload: {
      title: string;
      content: string;
      knowledge_type?: string;
      tags?: string[];
      experiment_id?: string;
      chunking_template?: string;
      chunk_size?: number;
      chunk_overlap?: number;
    },
  ): Promise<UploadResult> {
    return request<UploadResult>(coursePath(courseId, "/knowledge/paste"), {
      method: "POST",
      headers: authHeaders(),
      body: JSON.stringify(payload),
    });
  },

  async importUrl(
    courseId: string,
    payload: { url: string; title?: string; knowledge_type?: string; tags?: string[] },
  ): Promise<UploadResult> {
    return request<UploadResult>(coursePath(courseId, "/knowledge/import/url"), {
      method: "POST",
      headers: authHeaders(),
      body: JSON.stringify(payload),
    });
  },

  // ── Parse preview (two-stage upload) ──────────────────────────────────────
  async previewFile(
    courseId: string,
    file: File,
    config: { chunking_template?: string; chunk_size?: number; chunk_overlap?: number },
  ): Promise<{ chunks: KnowledgeChunk[]; total: number }> {
    const form = new FormData();
    form.append("file", file);
    form.append("chunking_template", config.chunking_template || "general");
    if (config.chunk_size) form.append("chunk_size", String(config.chunk_size));
    if (config.chunk_overlap) form.append("chunk_overlap", String(config.chunk_overlap));
    return request(coursePath(courseId, "/knowledge/parse-preview"), {
      method: "POST",
      headers: multipartHeaders(),
      body: form,
    });
  },

  async previewText(
    courseId: string,
    content: string,
    config: { chunking_template?: string; chunk_size?: number; chunk_overlap?: number },
  ): Promise<{ chunks: KnowledgeChunk[]; total: number }> {
    return request(coursePath(courseId, "/knowledge/parse-preview/text"), {
      method: "POST",
      headers: authHeaders(),
      body: JSON.stringify({ content, ...config }),
    });
  },

  // ── Stats & review ──────────────────────────────────────────────────────
  async stats(courseId: string): Promise<KnowledgeStats> {
    return request<KnowledgeStats>(coursePath(courseId, "/knowledge/stats"), { headers: authHeaders() });
  },

  async approve(courseId: string, entryId: string): Promise<{ ok: boolean }> {
    return request(coursePath(courseId, `/knowledge/${encodeURIComponent(entryId)}/approve`), {
      method: "POST",
      headers: authHeaders(),
    });
  },

  async reject(courseId: string, entryId: string, reason: string): Promise<{ ok: boolean }> {
    return request(coursePath(courseId, `/knowledge/${encodeURIComponent(entryId)}/reject`), {
      method: "POST",
      headers: authHeaders(),
      body: JSON.stringify({ reason }),
    });
  },

  async unpublish(courseId: string, entryId: string): Promise<{ ok: boolean }> {
    return request(coursePath(courseId, `/knowledge/${encodeURIComponent(entryId)}/unpublish`), {
      method: "POST",
      headers: authHeaders(),
    });
  },

  async republish(courseId: string, entryId: string): Promise<{ ok: boolean }> {
    return request(coursePath(courseId, `/knowledge/${encodeURIComponent(entryId)}/republish`), {
      method: "POST",
      headers: authHeaders(),
    });
  },

  async batchReview(
    courseId: string,
    entryIds: string[],
    action: "approve" | "reject",
    reason = "",
  ): Promise<{ succeeded: number; failed: number }> {
    return request(coursePath(courseId, "/knowledge/batch-review"), {
      method: "POST",
      headers: authHeaders(),
      body: JSON.stringify({ entry_ids: entryIds, action, reason }),
    });
  },

  async deleteEntry(courseId: string, entryId: string): Promise<{ ok: boolean }> {
    return request(coursePath(courseId, `/knowledge/${encodeURIComponent(entryId)}`), {
      method: "DELETE",
      headers: authHeaders(),
    });
  },
};