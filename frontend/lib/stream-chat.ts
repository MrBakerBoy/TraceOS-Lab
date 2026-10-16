/**
 * SSE streaming chat client — consumes OpenAI-compatible text/event-stream.
 *
 * Routes through Go passthrough: POST /api/v1/conversations/{id}/messages
 * with Accept: text/event-stream. Go injects detection data, proxies to
 * Python AI service, and streams back.
 */

export interface StreamChunk {
  delta: string;
}

export interface HarnessData {
  intent?: string;
  concepts?: string[];
  hint_level?: string;
  bloom_level?: string;
  next_bloom_level?: string;
  [key: string]: unknown;
}

export interface StageInfo {
  name: string;
  label: string;
  status: "pending" | "running" | "done" | "error";
}

export interface StreamResult {
  fullContent: string;
  harness?: HarnessData;
}

export interface StreamChatCallbacks {
  onChunk: (delta: string) => void;
  onStage?: (stages: StageInfo[]) => void;
  onHarness?: (harness: HarnessData) => void;
  onDone: (result: StreamResult) => void;
  onError: (error: Error) => void;
}

export interface StreamChatOptions extends StreamChatCallbacks {
  conversationId: string;
  content: string;
  agentMode?: string;
  code?: string;
  language?: string;
  useRAG?: boolean;
  signal?: AbortSignal;
}

export async function streamChat(options: StreamChatOptions): Promise<void> {
  const {
    conversationId, content, agentMode = "chat", code, language = "c",
    useRAG = true, onChunk, onStage, onHarness, onDone, onError, signal,
  } = options;

  const token = typeof window !== "undefined" ? localStorage.getItem("token") : "";

  try {
    const res = await fetch(
      `/api/v1/conversations/${encodeURIComponent(conversationId)}/messages`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Accept": "text/event-stream",
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        body: JSON.stringify({
          content, code, language,
          agent_mode: agentMode,
          use_rag: useRAG,
        }),
        signal,
      },
    );

    if (!res.ok) {
      const text = await res.text().catch(() => "");
      throw new Error(`Stream request failed (${res.status}): ${text.slice(0, 200)}`);
    }

    const reader = res.body?.getReader();
    if (!reader) throw new Error("Response body is not readable");

    const decoder = new TextDecoder();
    let buffer = "";
    let fullContent = "";
    let harness: HarnessData | undefined;

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split("\n");
      buffer = lines.pop() || "";

      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed.startsWith("data: ")) continue;

        const payload = trimmed.slice(6);
        if (payload === "[DONE]") {
          onDone({ fullContent, harness });
          return;
        }

        try {
          const data = JSON.parse(payload);

          // Stage progress event
          if (data.type === "stage") {
            onStage?.(data.data);
            continue;
          }

          // Harness metadata
          if (data.type === "harness") {
            harness = data.data;
            onHarness?.(data.data);
            continue;
          }

          // OpenAI-compatible delta
          const delta = data?.choices?.[0]?.delta?.content;
          if (delta) {
            fullContent += delta;
            onChunk(delta);
          }
        } catch {
          // skip unparseable lines
        }
      }
    }

    onDone({ fullContent, harness });
  } catch (err: unknown) {
    if (err instanceof DOMException && err.name === "AbortError") {
      return;
    }
    onError(err instanceof Error ? err : new Error(String(err)));
  }
}