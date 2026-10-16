"use client";

import { useState, useEffect } from "react";
import { useWorkspaceStore } from "@/stores/workspace";
import { cn } from "@/lib/utils";
import {
  MessageSquare, Plus, Trash2, Pin, Archive, ChevronLeft,
  ChevronRight, Loader2, Bot, Sparkles, Search, Bug,
} from "lucide-react";

interface ConversationSidebarProps {
  experimentId: string;
  isOpen: boolean;
  onToggle: () => void;
}

export default function ConversationSidebar({ experimentId, isOpen, onToggle }: ConversationSidebarProps) {
  const {
    conversations, activeConversationId, isLoadingConversations,
    loadConversations, createConversation, deleteConversation,
    setActiveConversation,
  } = useWorkspaceStore() as any;

  const [newTitle, setNewTitle] = useState("");
  const [showNewInput, setShowNewInput] = useState(false);

  useEffect(() => {
    if (isOpen) loadConversations(experimentId);
  }, [isOpen, experimentId]);

  const handleCreate = async () => {
    const title = newTitle.trim() || "New Chat";
    await createConversation(title, experimentId, "chat");
    setNewTitle("");
    setShowNewInput(false);
    loadConversations(experimentId);
  };

  const handleDelete = async (id: string, e: React.MouseEvent) => {
    e.stopPropagation();
    if (confirm("Delete this conversation?")) {
      await deleteConversation(id);
      loadConversations(experimentId);
    }
  };

  const modeIcons: Record<string, React.ReactNode> = {
    chat: <MessageSquare className="size-3.5" />,
    diagnosis: <Bug className="size-3.5" />,
    audit: <Search className="size-3.5" />,
    tutor: <Sparkles className="size-3.5" />,
  };

  if (!isOpen) {
    return (
      <button
        onClick={onToggle}
        className="absolute left-0 top-1/2 -translate-y-1/2 z-20 w-6 h-16 bg-card border border-border/50 rounded-r-xl flex items-center justify-center hover:bg-accent/10 transition-colors shadow-sm"
        title="Open conversations"
      >
        <ChevronRight className="size-3.5 text-muted-foreground" />
      </button>
    );
  }

  return (
    <div className="w-64 border-r border-border/50 bg-card/50 backdrop-blur-sm flex flex-col h-full shrink-0">
      {/* Header */}
      <div className="h-10 flex items-center justify-between px-3 border-b border-border/30 shrink-0">
        <div className="flex items-center gap-2">
          <Bot className="size-4 text-primary" />
          <span className="text-[12px] font-semibold">Conversations</span>
        </div>
        <div className="flex items-center gap-1">
          <button
            onClick={() => setShowNewInput(!showNewInput)}
            className="size-6 rounded-md flex items-center justify-center hover:bg-accent/10 transition-colors"
            title="New conversation"
          >
            <Plus className="size-3.5 text-muted-foreground" />
          </button>
          <button
            onClick={onToggle}
            className="size-6 rounded-md flex items-center justify-center hover:bg-accent/10 transition-colors"
          >
            <ChevronLeft className="size-3.5 text-muted-foreground" />
          </button>
        </div>
      </div>

      {/* New conversation input */}
      {showNewInput && (
        <div className="p-2 border-b border-border/30">
          <div className="flex gap-1.5">
            <input
              value={newTitle}
              onChange={(e) => setNewTitle(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && handleCreate()}
              placeholder="Conversation name..."
              className="flex-1 h-8 px-2.5 text-[12px] rounded-lg bg-muted/50 border border-border/30 focus:outline-none focus:border-primary/30 transition-colors"
              autoFocus
            />
            <button
              onClick={handleCreate}
              className="px-2.5 h-8 text-[11px] rounded-lg bg-primary text-primary-foreground hover:opacity-90 transition-opacity"
            >
              Create
            </button>
          </div>
        </div>
      )}

      {/* Conversation list */}
      <div className="flex-1 overflow-y-auto py-1">
        {isLoadingConversations ? (
          <div className="flex items-center justify-center py-8">
            <Loader2 className="size-5 animate-spin text-muted-foreground" />
          </div>
        ) : conversations?.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-12 px-4 text-center">
            <MessageSquare className="size-6 text-muted-foreground/40 mb-2" />
            <p className="text-[11px] text-muted-foreground">No conversations yet</p>
            <p className="text-[10px] text-muted-foreground/60 mt-0.5">Start a new chat with AI</p>
          </div>
        ) : (
          conversations?.map((conv: any) => (
            <div
              key={conv.id}
              onClick={() => setActiveConversation?.(conv.id)}
              className={cn(
                "group flex items-center gap-2 px-3 py-2 mx-1.5 rounded-lg cursor-pointer transition-all duration-150",
                activeConversationId === conv.id
                  ? "bg-primary/10 text-primary border border-primary/20"
                  : "hover:bg-muted/50 text-muted-foreground hover:text-foreground border border-transparent"
              )}
            >
              <div className="shrink-0">
                {modeIcons[conv.agent_mode] || modeIcons.chat}
              </div>
              <div className="flex-1 min-w-0">
                <div className="text-[12px] font-medium truncate leading-tight">
                  {conv.title}
                </div>
                <div className="text-[10px] text-muted-foreground/60 truncate">
                  {conv.message_count} messages
                </div>
              </div>
              {conv.is_pinned && (
                <Pin className="size-3 text-amber-500 shrink-0" />
              )}
              <button
                onClick={(e) => handleDelete(conv.id, e)}
                className="size-5 rounded flex items-center justify-center opacity-0 group-hover:opacity-100 hover:bg-destructive/10 hover:text-destructive transition-all shrink-0"
              >
                <Trash2 className="size-3" />
              </button>
            </div>
          ))
        )}
      </div>
    </div>
  );
}
