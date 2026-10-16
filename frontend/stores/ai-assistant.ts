import { create } from 'zustand';
import { api } from '@/lib/api';
import { streamChat } from '@/lib/stream-chat';
import type { Conversation, ConversationMessage } from '@/lib/api';

// ── Types ──────────────────────────────────────────────────────────────────

export interface RAGHistoryItem {
  id: string;
  query: string;
  answer: string;
  sources: string[];
  mode: string;
  created_at: string;
  course_id?: string;
}

export interface AgentPipelineStage {
  name: string;
  label: string;
  color: string;
  status: 'idle' | 'running' | 'done' | 'error';
  latencyMs?: number;
  tokensUsed?: number;
}

export interface MemoryTiers {
  L0: { label: string; tokens: number; maxTokens: number; description: string };
  L1: { label: string; turns: number; messageCount: number; description: string };
  L2: { label: string; weakTopics: string[]; strongTopics: string[]; description: string };
  L3: { label: string; errorPatterns: Record<string, number>; description: string };
}

export interface TokenBudget {
  used: number;
  total: number;
  watermark60: boolean;
  watermark80: boolean;
  watermark95: boolean;
  recentPrunings: { timestamp: string; turnsRemoved: number; reason: string }[];
}

export interface MonitoringData {
  agentPipeline: AgentPipelineStage[];
  memory: MemoryTiers;
  tokenBudget: TokenBudget;
  ragQueries: RAGHistoryItem[];
}

export interface AIMessage {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  toolCalls?: { name: string; args: string; result?: string }[];
  tokensUsed?: number;
  latencyMs?: number;
  createdAt: string;
}

interface AIAssistantState {
  // Conversations
  conversations: Conversation[];
  activeConversationId: string | null;
  experimentId: string | null;
  isLoadingConversations: boolean;

  // Messages
  messages: AIMessage[];
  isLoadingMessages: boolean;

  // Streaming
  isStreaming: boolean;
  streamingContent: string;
  abortController: AbortController | null;
  thinkingStages: { name: string; label: string; status: string }[];

  // Monitoring
  monitoring: MonitoringData;
  isPollingMonitoring: boolean;

  // RAG History
  ragHistory: RAGHistoryItem[];
  isLoadingRAG: boolean;

  // Actions - Conversations
  loadConversations: (experimentId: string) => Promise<void>;
  createConversation: (title: string, experimentId: string, agentMode?: string) => Promise<string | null>;
  deleteConversation: (id: string) => Promise<void>;
  updateConversation: (id: string, data: { title?: string; is_archived?: boolean; is_pinned?: boolean }) => Promise<void>;
  setActiveConversation: (id: string | null) => void;

  // Actions - Messages
  loadMessages: (conversationId: string) => Promise<void>;
  sendMessage: (content: string, options?: { agentMode?: string; useRAG?: boolean; code?: string; language?: string }) => Promise<void>;
  sendMessageStream: (content: string, options?: { agentMode?: string; useRAG?: boolean; code?: string; language?: string }) => Promise<void>;
  stopStreaming: () => void;

  // Actions - Monitoring
  startPolling: (experimentId: string) => void;
  stopPolling: () => void;

  // Actions - RAG
  loadRAGHistory: (courseId?: string) => Promise<void>;
}

export const useAIAssistantStore = create<AIAssistantState>((set, get) => ({
  // Initial state
  conversations: [],
  activeConversationId: null,
  experimentId: null,
  isLoadingConversations: false,
  messages: [],
  isLoadingMessages: false,
  isStreaming: false,
  streamingContent: '',
  abortController: null,
  thinkingStages: [],
  monitoring: {
    agentPipeline: [
      { name: 'E', label: '执行层', color: '#10B981', status: 'idle' },
      { name: 'T', label: '工具层', color: '#06B6D4', status: 'idle' },
      { name: 'C', label: '上下文层', color: '#F59E0B', status: 'idle' },
      { name: 'L', label: '生命周期', color: '#3B82F6', status: 'idle' },
      { name: 'O', label: '可观测层', color: '#8B5CF6', status: 'idle' },
      { name: 'V', label: '校验层', color: '#F43F5E', status: 'idle' },
      { name: 'G', label: '治理层', color: '#F97316', status: 'idle' },
    ],
    memory: {
      L0: { label: '工作记忆', tokens: 0, maxTokens: 8192, description: '当前上下文窗口' },
      L1: { label: '短期记忆', turns: 0, messageCount: 0, description: '当前会话消息' },
      L2: { label: '长期记忆', weakTopics: [], strongTopics: [], description: '学生档案' },
      L3: { label: '全局记忆', errorPatterns: {}, description: '实验错误模式' },
    },
    tokenBudget: { used: 0, total: 100000, watermark60: false, watermark80: false, watermark95: false, recentPrunings: [] },
    ragQueries: [],
  },
  isPollingMonitoring: false,
  ragHistory: [],
  isLoadingRAG: false,

  // ── Conversation Actions ──────────────────────────────────────────────────

  loadConversations: async (experimentId) => {
    set({ isLoadingConversations: true, experimentId });
    try {
      const res = await api.listConversations(experimentId);
      set({ conversations: (res as any).conversations || [] });
    } catch (err) {
      console.error('Failed to load conversations:', err);
    } finally {
      set({ isLoadingConversations: false });
    }
  },

  createConversation: async (title, experimentId, agentMode = 'chat') => {
    try {
      const res = await api.createConversation({ title, experiment_id: experimentId, agent_mode: agentMode });
      const conv = res as any;
      const id = conv?.id || conv?.conversation?.id;
      if (id) {
        await get().loadConversations(experimentId);
        get().setActiveConversation(id);
        return id;
      }
      return null;
    } catch (err) {
      console.error('Failed to create conversation:', err);
      return null;
    }
  },

  deleteConversation: async (id) => {
    try {
      await api.deleteConversation(id);
      const { activeConversationId } = get();
      if (activeConversationId === id) {
        set({ activeConversationId: null, messages: [] });
      }
    } catch (err) {
      console.error('Failed to delete conversation:', err);
    }
  },

  updateConversation: async (id, data) => {
    try {
      await api.updateConversation(id, data);
      const { conversations } = get();
      set({
        conversations: conversations.map((c) =>
          (c as any).id === id ? { ...c, ...data } : c
        ),
      });
    } catch (err) {
      console.error('Failed to update conversation:', err);
    }
  },

  setActiveConversation: (id) => {
    set({ activeConversationId: id });
    if (id) {
      get().loadMessages(id);
    } else {
      set({ messages: [] });
    }
  },

  // ── Message Actions ───────────────────────────────────────────────────────

  loadMessages: async (conversationId) => {
    set({ isLoadingMessages: true });
    try {
      const res = await api.getMessages(conversationId);
      const raw = (res as any).messages || [];
      set({
        messages: raw.map((m: any) => ({
          id: m.id,
          role: m.role,
          content: m.content || '',
          toolCalls: m.tool_calls,
          tokensUsed: m.tokens_used,
          latencyMs: m.latency_ms,
          createdAt: m.created_at,
        })),
      });
    } catch (err) {
      console.error('Failed to load messages:', err);
    } finally {
      set({ isLoadingMessages: false });
    }
  },

  sendMessage: async (content, options = {}) => {
    const { activeConversationId, messages } = get();
    if (!activeConversationId || !content.trim()) return;

    const userMsg: AIMessage = {
      id: `temp-${Date.now()}`,
      role: 'user',
      content,
      createdAt: new Date().toISOString(),
    };

    const abortController = new AbortController();
    set({
      messages: [...messages, userMsg],
      isStreaming: true,
      streamingContent: '',
      abortController,
    });

    try {
      const res = await fetch(`/api/v1/conversations/${activeConversationId}/messages`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          content,
          code: options.code,
          language: options.language,
          agent_mode: options.agentMode || 'chat',
          use_rag: options.useRAG !== false,
        }),
        signal: abortController.signal,
      });

      if (!res.ok) throw new Error(`HTTP ${res.status}`);

      const data = await res.json();
      const assistantMsg: AIMessage = {
        id: `reply-${Date.now()}`,
        role: 'assistant',
        content: data.reply || data.content || '',
        toolCalls: data.tool_calls,
        tokensUsed: data.tokens_used,
        latencyMs: data.latency_ms,
        createdAt: new Date().toISOString(),
      };

      set((state) => ({
        messages: [...state.messages, assistantMsg],
        isStreaming: false,
        streamingContent: '',
        abortController: null,
      }));
    } catch (err: any) {
      if (err.name !== 'AbortError') {
        console.error('Failed to send message:', err);
      }
      set({ isStreaming: false, streamingContent: '', abortController: null });
    }
  },

  sendMessageStream: async (content, options = {}) => {
    const { activeConversationId, messages } = get();
    if (!activeConversationId || !content.trim()) return;

    const userMsg: AIMessage = {
      id: `temp-${Date.now()}`,
      role: 'user',
      content,
      createdAt: new Date().toISOString(),
    };

    const abortController = new AbortController();
    const streamingId = `stream-${Date.now()}`;

    set({
      messages: [...messages, userMsg],
      isStreaming: true,
      streamingContent: '',
      thinkingStages: [],
      abortController,
    });

    await streamChat({
      conversationId: activeConversationId,
      content,
      agentMode: options.agentMode || 'chat',
      code: options.code,
      language: options.language,
      useRAG: options.useRAG !== false,
      signal: abortController.signal,
      onStage: (stages) => {
        set({ thinkingStages: stages });
      },
      onChunk: (delta) => {
        set((state) => ({
          streamingContent: state.streamingContent + delta,
        }));
      },
      onDone: (result) => {
        const assistantMsg: AIMessage = {
          id: streamingId,
          role: 'assistant',
          content: result.fullContent,
          createdAt: new Date().toISOString(),
        };
        set((state) => ({
          messages: [...state.messages, assistantMsg],
          isStreaming: false,
          streamingContent: '',
          thinkingStages: [],
          abortController: null,
        }));
      },
      onError: (err) => {
        console.error('Stream error:', err);
        set({ isStreaming: false, streamingContent: '', thinkingStages: [], abortController: null });
      },
    });
  },

  stopStreaming: () => {
    const { abortController } = get();
    if (abortController) {
      abortController.abort();
      set({ isStreaming: false, streamingContent: '', thinkingStages: [], abortController: null });
    }
  },

  // ── Monitoring Actions ────────────────────────────────────────────────────

  startPolling: (experimentId) => {
    const { isPollingMonitoring } = get();
    if (isPollingMonitoring) return;
    set({ isPollingMonitoring: true });

    const poll = async () => {
      if (!get().isPollingMonitoring) return;
      const { activeConversationId } = get();
      if (!activeConversationId) { setTimeout(poll, 3000); return; }

      try {
        const token = localStorage.getItem("token");
        const res = await fetch(`/api/v1/conversations/${activeConversationId}/monitoring`, {
          headers: token ? { Authorization: `Bearer ${token}` } : {},
        });
        if (res.ok) {
          const data = await res.json();
          set({
            monitoring: {
              agentPipeline: (data.agent_pipeline || []).map((s: any) => ({
                name: s.name, label: s.label, color: s.color,
                status: s.status, latencyMs: s.latency_ms, tokensUsed: s.tokens_used,
              })),
              memory: {
                L0: data.memory?.L0 || { label: '工作记忆', tokens: 0, maxTokens: 8192, description: '' },
                L1: data.memory?.L1 || { label: '短期记忆', turns: 0, messageCount: 0, description: '' },
                L2: data.memory?.L2 || { label: '长期记忆', weakTopics: [], strongTopics: [], description: '' },
                L3: data.memory?.L3 || { label: '全局记忆', errorPatterns: {}, description: '' },
              },
              tokenBudget: data.token_budget || { used: 0, total: 100000, watermark60: false, watermark80: false, watermark95: false, recentPrunings: [] },
              ragQueries: data.rag_queries || [],
            },
          });
        }
      } catch {
        // silently ignore polling errors
      }
      setTimeout(poll, 5000);
    };
    poll();
  },

  stopPolling: () => {
    set({ isPollingMonitoring: false });
  },

  // ── RAG Actions ───────────────────────────────────────────────────────────

  loadRAGHistory: async (courseId) => {
    set({ isLoadingRAG: true });
    try {
      const res = await fetch(`/api/v1/rag/history${courseId ? `?course_id=${courseId}` : ''}`);
      if (res.ok) {
        const data = await res.json();
        set({ ragHistory: data.history || [] });
      }
    } catch (err) {
      console.error('Failed to load RAG history:', err);
    } finally {
      set({ isLoadingRAG: false });
    }
  },
}));