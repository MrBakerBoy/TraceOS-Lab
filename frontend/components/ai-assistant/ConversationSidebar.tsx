"use client";

import { useState, useEffect, useRef } from "react";
import { useAIAssistantStore } from "@/stores/ai-assistant";
import { cn } from "@/lib/utils";
import { useChatTheme } from "@/hooks/useChatTheme";
import type { ChatThemeColors } from "@/lib/chat-theme";
import {
  MessageSquare, Plus, Trash2, Pin, Archive, ChevronLeft,
  ChevronRight, Loader2, Bot, Sparkles, Search, Bug,
  BookOpen, History, PinOff, ArchiveRestore, Edit3, Check,
} from "lucide-react";

interface ConversationSidebarProps {
  experimentId: string;
  courseId?: string;
  isOpen: boolean;
  onToggle: () => void;
}

const AGENT_MODES: Record<string, { icon: React.ReactNode; label: string; color: string }> = {
  chat: { icon: <MessageSquare className="size-3.5" />, label: "通用对话", color: "#3B82F6" },
  diagnosis: { icon: <Bug className="size-3.5" />, label: "诊断分析", color: "#F43F5E" },
  audit: { icon: <Search className="size-3.5" />, label: "代码审查", color: "#F59E0B" },
  tutor: { icon: <Sparkles className="size-3.5" />, label: "教学辅导", color: "#8B5CF6" },
  knowledge_qa: { icon: <BookOpen className="size-3.5" />, label: "知识问答", color: "#10B981" },
};

export default function ConversationSidebar({ experimentId, courseId, isOpen, onToggle }: ConversationSidebarProps) {
  const {
    conversations, activeConversationId, isLoadingConversations,
    loadConversations, createConversation, deleteConversation,
    updateConversation, setActiveConversation,
    ragHistory, isLoadingRAG, loadRAGHistory,
  } = useAIAssistantStore();

  const theme = useChatTheme();
  const [newTitle, setNewTitle] = useState("");
  const [showNewInput, setShowNewInput] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editTitle, setEditTitle] = useState("");
  const [showArchived, setShowArchived] = useState(false);
  const [showRAG, setShowRAG] = useState(false);
  const hasAutoSelected = useRef(false);

  useEffect(() => {
    if (isOpen) loadConversations(experimentId);
  }, [isOpen, experimentId]);

  useEffect(() => {
    if (isOpen && courseId) loadRAGHistory(courseId);
  }, [isOpen, courseId]);

  // Auto-select most recent conversation or create one on first open
  useEffect(() => {
    if (!isOpen || isLoadingConversations || hasAutoSelected.current) return;

    const currentActive = useAIAssistantStore.getState().activeConversationId;
    if (currentActive) {
      hasAutoSelected.current = true;
      return;
    }

    const currentConversations = useAIAssistantStore.getState().conversations;
    if (currentConversations.length > 0) {
      // Pick most recent non-archived conversation
      const recent = (currentConversations as any[])
        .filter((c) => !c.is_archived)
        .sort(
          (a, b) =>
            new Date(b.updated_at || b.created_at || 0).getTime() -
            new Date(a.updated_at || a.created_at || 0).getTime()
        )[0];
      if (recent) {
        setActiveConversation(recent.id);
      } else {
        // All archived — create a fresh one
        createConversation("新的对话", experimentId, "chat");
      }
    } else {
      // No conversations yet — create the first one
      createConversation("新的对话", experimentId, "chat");
    }

    hasAutoSelected.current = true;
  }, [isOpen, isLoadingConversations, conversations, experimentId]);

  const handleCreate = async () => {
    const title = newTitle.trim() || "新的对话";
    await createConversation(title, experimentId, "chat");
    setNewTitle("");
    setShowNewInput(false);
    loadConversations(experimentId);
  };

  const handleDelete = async (id: string, e: React.MouseEvent) => {
    e.stopPropagation();
    if (confirm("确定删除这个会话？")) {
      await deleteConversation(id);
      loadConversations(experimentId);
    }
  };

  const handleRename = async (id: string) => {
    if (editTitle.trim()) {
      await updateConversation(id, { title: editTitle.trim() });
      setEditingId(null);
      setEditTitle("");
    }
  };

  const startRename = (conv: any) => {
    setEditingId(conv.id);
    setEditTitle(conv.title);
  };

  const filteredConversations = (conversations as any[]).filter((c) => {
    if (searchQuery && !c.title.toLowerCase().includes(searchQuery.toLowerCase())) return false;
    return true;
  });

  const pinned = filteredConversations.filter((c) => c.is_pinned && !c.is_archived);
  const active = filteredConversations.filter((c) => !c.is_pinned && !c.is_archived);
  const archived = filteredConversations.filter((c) => c.is_archived);

  if (!isOpen) {
    return (
      <button
        onClick={onToggle}
        className="absolute left-0 top-1/2 -translate-y-1/2 z-20 w-6 h-16 bg-card border border-border/50 rounded-r-xl flex items-center justify-center hover:bg-accent/10 transition-colors shadow-sm"
        title="打开会话面板"
      >
        <ChevronRight className="size-3.5" style={{ color: theme.textTertiary }} />
      </button>
    );
  }

  return (
    <div className="w-72 border-r border-border/50 bg-card/50 backdrop-blur-sm flex flex-col h-full shrink-0">
      {/* Header */}
      <div className="h-12 flex items-center justify-between px-3 border-b border-border/30 shrink-0">
        <div className="flex items-center gap-2">
          <button onClick={onToggle} className="size-7 rounded-md flex items-center justify-center hover:bg-accent/10 transition-colors" style={{ color: theme.textTertiary }}>
            <ChevronLeft className="size-3.5" />
          </button>
          <Bot className="size-4 text-indigo-500" />
          <span className="text-[13px] font-semibold" style={{ color: theme.textPrimary }}>AI 会话</span>
        </div>
        <div className="flex items-center gap-0.5">
          <button
            onClick={() => setShowRAG(!showRAG)}
            className={cn("size-7 rounded-md flex items-center justify-center transition-colors", showRAG ? "bg-violet-500/10 text-violet-500" : "hover:bg-accent/10 text-muted-foreground")}
            title="RAG 历史"
          >
            <History className="size-3.5" />
          </button>
          <button
            onClick={() => setShowNewInput(!showNewInput)}
            className="size-7 rounded-md flex items-center justify-center hover:bg-accent/10 transition-colors text-muted-foreground"
            title="新建会话"
          >
            <Plus className="size-3.5" />
          </button>
        </div>
      </div>

      {/* Search */}
      <div className="px-2.5 py-2 border-b border-border/20">
        <div className="relative">
          <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 size-3 text-muted-foreground/50" />
          <input
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="搜索会话..."
            className="w-full h-8 pl-7 pr-3 text-[12px] rounded-lg bg-muted/50 border border-border/30 focus:outline-none focus:border-indigo-500/30 transition-colors placeholder:text-muted-foreground/40"
          />
        </div>
      </div>

      {/* New conversation input */}
      {showNewInput && (
        <div className="p-2.5 border-b border-border/20 bg-indigo-500/5">
          <div className="flex gap-1.5">
            <input
              value={newTitle}
              onChange={(e) => setNewTitle(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && handleCreate()}
              placeholder="会话名称..."
              className="flex-1 h-8 px-2.5 text-[12px] rounded-lg bg-muted/50 border border-border/30 focus:outline-none focus:border-indigo-500/30 transition-colors"
              autoFocus
            />
            <button
              onClick={handleCreate}
              className="px-3 h-8 text-[11px] rounded-lg bg-gradient-to-r from-indigo-500 to-violet-500 text-white hover:opacity-90 transition-opacity font-medium"
            >
              创建
            </button>
          </div>
        </div>
      )}

      {/* RAG History Panel */}
      {showRAG && (
        <div className="border-b border-border/20 bg-violet-500/5">
          <div className="flex items-center justify-between px-3 py-2">
            <div className="flex items-center gap-1.5">
              <History className="size-3.5 text-violet-500" />
              <span className="text-[11px] font-semibold text-violet-600">RAG 检索历史</span>
            </div>
          </div>
          <div className="max-h-40 overflow-y-auto px-2 pb-2">
            {isLoadingRAG ? (
              <div className="flex items-center justify-center py-4"><Loader2 className="size-4 animate-spin text-muted-foreground" /></div>
            ) : ragHistory.length === 0 ? (
              <p className="text-[11px] text-muted-foreground text-center py-3">暂无检索记录</p>
            ) : (
              ragHistory.slice(0, 10).map((item: any) => (
                <div key={item.id} className="px-2.5 py-1.5 rounded-lg text-[11px] text-muted-foreground hover:bg-violet-500/10 cursor-pointer truncate">
                  {item.query || item.question || '无标题'}
                </div>
              ))
            )}
          </div>
        </div>
      )}

      {/* Conversation list */}
      <div className="flex-1 overflow-y-auto py-1.5 space-y-1">
        {isLoadingConversations ? (
          <div className="flex items-center justify-center py-10"><Loader2 className="size-5 animate-spin text-muted-foreground" /></div>
        ) : conversations.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-14 px-4 text-center">
            <MessageSquare className="size-8 text-muted-foreground/30 mb-3" />
            <p className="text-[12px]" style={{ color: theme.textSecondary }}>暂无会话</p>
            <p className="text-[10px] text-muted-foreground/50 mt-1">点击 + 创建新会话</p>
          </div>
        ) : (
          <>
            {/* Pinned */}
            {pinned.length > 0 && (
              <Section theme={theme} label="已置顶" icon={<Pin className="size-3 text-amber-500" />} color="border-amber-500/20">
                {pinned.map((conv) => <ConversationItem key={conv.id} conv={conv} {...{ activeConversationId, editingId, editTitle, setEditingId, setEditTitle, handleRename, handleDelete, startRename, setActiveConversation, updateConversation, setSearchQuery }} />)}
              </Section>
            )}

            {/* Active */}
            {active.length > 0 && (
              <Section theme={theme} label="活跃会话" icon={<MessageSquare className="size-3 text-indigo-400" />} color="border-indigo-400/20">
                {active.map((conv) => <ConversationItem key={conv.id} conv={conv} {...{ activeConversationId, editingId, editTitle, setEditingId, setEditTitle, handleRename, handleDelete, startRename, setActiveConversation, updateConversation, setSearchQuery }} />)}
              </Section>
            )}

            {/* Archived */}
            {archived.length > 0 && (
              <div>
                <button onClick={() => setShowArchived(!showArchived)} className="flex items-center gap-1.5 px-3 py-1.5 w-full text-[11px] font-medium text-muted-foreground hover:text-foreground transition-colors">
                  <Archive className="size-3" />
                  已归档 ({archived.length})
                  <ChevronRight className={cn("size-3 ml-auto transition-transform", showArchived && "rotate-90")} />
                </button>
                {showArchived && archived.map((conv) => <ConversationItem key={conv.id} conv={conv} {...{ activeConversationId, editingId, editTitle, setEditingId, setEditTitle, handleRename, handleDelete, startRename, setActiveConversation, updateConversation, setSearchQuery }} />)}
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}

/* ── Sub-components ── */

function Section({ label, icon, color, children, theme }: { label: string; icon: React.ReactNode; color: string; children: React.ReactNode; theme: ChatThemeColors }) {
  return (
    <div>
      <div className={cn("flex items-center gap-1.5 px-3 py-1.5 border-b", color)}>
        {icon}
        <span className="text-[10px] font-semibold uppercase tracking-wider" style={{ color: theme.textSecondary }}>{label}</span>
      </div>
      {children}
    </div>
  );
}

function ConversationItem({ conv, activeConversationId, editingId, editTitle, setEditingId, setEditTitle, handleRename, handleDelete, startRename, setActiveConversation, updateConversation }: any) {
  const mode = AGENT_MODES[conv.agent_mode] || AGENT_MODES.chat;
  const isEditing = editingId === (conv as any).id;
  const isActive = activeConversationId === (conv as any).id;

  return (
    <div
      onClick={() => !isEditing && setActiveConversation?.(conv.id)}
      className={cn(
        "group flex items-center gap-2 px-2.5 py-2 mx-1.5 rounded-lg cursor-pointer transition-all duration-150",
        isActive
          ? "bg-indigo-500/10 border border-indigo-500/20"
          : "hover:bg-muted/50 border border-transparent"
      )}
    >
      <div className="shrink-0" style={{ color: mode.color }}>
        {mode.icon}
      </div>
      <div className="flex-1 min-w-0">
        {isEditing ? (
          <input
            value={editTitle}
            onChange={(e) => setEditTitle(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") handleRename(conv.id);
              if (e.key === "Escape") setEditingId(null);
            }}
            onBlur={() => handleRename(conv.id)}
            className="w-full h-6 px-1.5 text-[12px] rounded bg-muted border border-indigo-500/30 focus:outline-none"
            autoFocus
            onClick={(e) => e.stopPropagation()}
          />
        ) : (
          <>
            <div className={cn("text-[12px] font-medium truncate leading-tight", isActive ? "text-indigo-600 dark:text-indigo-400" : "text-foreground")}>
              {conv.title}
            </div>
            <div className="flex items-center gap-1.5 text-[10px] text-muted-foreground/60">
              <span>{conv.message_count > 0 ? `${conv.message_count} 条消息` : ""}</span>
              <span className="px-1 py-0.5 rounded text-[9px]" style={{ background: mode.color + "14", color: mode.color }}>{mode.label}</span>
            </div>
          </>
        )}
      </div>

      {/* Actions */}
      <div className="flex items-center gap-0.5 opacity-0 group-hover:opacity-100 transition-opacity shrink-0">
        {conv.is_pinned ? (
          <button onClick={(e) => { e.stopPropagation(); updateConversation(conv.id, { is_pinned: false }); }} className="size-5 rounded flex items-center justify-center hover:bg-amber-500/10 text-amber-500 transition-colors" title="取消置顶">
            <PinOff className="size-3" />
          </button>
        ) : (
          <button onClick={(e) => { e.stopPropagation(); updateConversation(conv.id, { is_pinned: true }); }} className="size-5 rounded flex items-center justify-center hover:bg-amber-500/10 hover:text-amber-500 text-muted-foreground transition-colors" title="置顶">
            <Pin className="size-3" />
          </button>
        )}
        {conv.is_archived ? (
          <button onClick={(e) => { e.stopPropagation(); updateConversation(conv.id, { is_archived: false }); }} className="size-5 rounded flex items-center justify-center hover:bg-emerald-500/10 hover:text-emerald-500 text-muted-foreground transition-colors" title="取消归档">
            <ArchiveRestore className="size-3" />
          </button>
        ) : (
          <button onClick={(e) => { e.stopPropagation(); updateConversation(conv.id, { is_archived: true }); }} className="size-5 rounded flex items-center justify-center hover:bg-slate-500/10 text-muted-foreground transition-colors" title="归档">
            <Archive className="size-3" />
          </button>
        )}
        <button onClick={(e) => { e.stopPropagation(); startRename(conv); }} className="size-5 rounded flex items-center justify-center hover:bg-blue-500/10 hover:text-blue-500 text-muted-foreground transition-colors" title="重命名">
          <Edit3 className="size-3" />
        </button>
        <button onClick={(e) => handleDelete(conv.id, e)} className="size-5 rounded flex items-center justify-center hover:bg-destructive/10 hover:text-destructive text-muted-foreground transition-colors" title="删除">
          <Trash2 className="size-3" />
        </button>
      </div>
    </div>
  );
}