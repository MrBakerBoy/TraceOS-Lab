"use client";

import { useState, useRef, useEffect, useCallback } from "react";
import { useAIAssistantStore } from "@/stores/ai-assistant";
import { useChatTheme } from "@/hooks/useChatTheme";
import { motion } from "framer-motion";
import { cn } from "@/lib/utils";
import MarkdownRenderer from "./MarkdownRenderer";
import {
  Bot, User, Send, Loader2, Copy, Check,
  Sparkles, MessageSquare, Bug, BookOpen, Search, Zap, StopCircle,
} from "lucide-react";

/* Agent mode config */
const AGENT_MODES = [
  { value: "chat", label: "通用对话", icon: <MessageSquare className="size-3.5" />, color: "#3B82F6" },
  { value: "diagnosis", label: "诊断分析", icon: <Bug className="size-3.5" />, color: "#F43F5E" },
  { value: "audit", label: "代码审查", icon: <Search className="size-3.5" />, color: "#F59E0B" },
  { value: "knowledge_qa", label: "知识问答", icon: <BookOpen className="size-3.5" />, color: "#10B981" },
];

const QUICK_PROMPTS = [
  { icon: <Zap className="size-3.5" />, label: "分析代码", color: "#F59E0B", prompt: "请分析我当前代码中可能存在的问题，给出改进建议。" },
  { icon: <BookOpen className="size-3.5" />, label: "解释原理", color: "#3B82F6", prompt: "请解释这个实验涉及的操作系统核心原理。" },
  { icon: <Sparkles className="size-3.5" />, label: "优化性能", color: "#8B5CF6", prompt: "请帮我分析代码的性能瓶颈并给出优化建议。" },
  { icon: <Bug className="size-3.5" />, label: "排查错误", color: "#F43F5E", prompt: "请根据运行结果帮我分析可能的错误原因。" },
];

function formatTime(isoStr: string): string {
  const date = new Date(isoStr);
  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  const diffSec = Math.floor(diffMs / 1000);
  const diffMin = Math.floor(diffSec / 60);
  const diffHour = Math.floor(diffMin / 60);

  if (diffSec < 60) return "刚刚";
  if (diffMin < 60) return `${diffMin} 分钟前`;
  if (diffHour < 24) return `${diffHour} 小时前`;
  return date.toLocaleTimeString("zh-CN", { hour: "2-digit", minute: "2-digit" });
}

export default function ChatPanel() {
  const {
    activeConversationId, conversations, messages, isStreaming,
    streamingContent, sendMessageStream, stopStreaming, isLoadingMessages,
    thinkingStages,
  } = useAIAssistantStore();

  const theme = useChatTheme();
  const [input, setInput] = useState("");
  const [agentMode, setAgentMode] = useState("chat");
  const [copiedIdx, setCopiedIdx] = useState<number | null>(null);
  const [showThinking, setShowThinking] = useState(false);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const scrollContainerRef = useRef<HTMLDivElement>(null);

  const activeConv = (conversations as any[]).find((c) => c.id === activeConversationId);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, streamingContent, thinkingStages]);

  const handleSend = useCallback(() => {
    if (!input.trim() || isStreaming || !activeConversationId) return;
    sendMessageStream(input, { agentMode, useRAG: true });
    setInput("");
    if (textareaRef.current) textareaRef.current.style.height = "auto";
  }, [input, isStreaming, activeConversationId, agentMode, sendMessageStream]);

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  const handleCopy = async (content: string, idx: number) => {
    try {
      await navigator.clipboard.writeText(content);
      setCopiedIdx(idx);
      setTimeout(() => setCopiedIdx(null), 2000);
    } catch { /* clipboard unavailable */ }
  };

  const handleQuickPrompt = (prompt: string) => {
    setInput(prompt);
    textareaRef.current?.focus();
  };

  useEffect(() => {
    if (textareaRef.current) {
      textareaRef.current.style.height = "auto";
      textareaRef.current.style.height = Math.min(textareaRef.current.scrollHeight, 150) + "px";
    }
  }, [input]);

  const inputCharCount = input.length;
  const isOverLimit = inputCharCount > 4000;

  return (
    <div className="flex flex-col h-full" style={{ background: theme.panelBg }}>
      {/* Chat Header */}
      <div
        className="h-12 flex items-center justify-between px-4 border-b shrink-0"
        style={{
          borderColor: theme.divider,
          background: `linear-gradient(to right, ${theme.accentDim}, transparent, ${theme.accentDim})`,
        }}
      >
        <div className="flex items-center gap-2.5 min-w-0">
          <div className="size-7 rounded-lg flex items-center justify-center text-white" style={{ background: `linear-gradient(135deg, ${theme.accent}, ${theme.inlineCodeText})` }}>
            <Bot className="size-3.5" />
          </div>
          <div className="min-w-0">
            <p className="text-[13px] font-semibold truncate" style={{ color: theme.textPrimary }}>
              {activeConv?.title || "AI 智能助手"}
            </p>
            {activeConv && (
              <p className="text-[10px] truncate" style={{ color: theme.textTertiary }}>
                {activeConv.agent_mode || "chat"}{activeConv.message_count > 0 ? ` · ${activeConv.message_count} 条消息` : ""}
              </p>
            )}
          </div>
        </div>
        <div className="flex items-center gap-1">
          {AGENT_MODES.map((m) => (
            <button
              key={m.value}
              onClick={() => setAgentMode(m.value)}
              className={cn(
                "size-7 rounded-lg flex items-center justify-center transition-all duration-200",
                agentMode === m.value
                  ? "text-white shadow-sm"
                  : "text-muted-foreground hover:text-foreground"
              )}
              style={{
                background: agentMode === m.value ? m.color : theme.sidebarHover,
                color: agentMode !== m.value ? theme.textSecondary : undefined,
              }}
              title={m.label}
            >
              {m.icon}
            </button>
          ))}
        </div>
      </div>

      {/* Messages */}
      <div ref={scrollContainerRef} className="flex-1 overflow-y-auto px-4 py-3 space-y-3">
        {isLoadingMessages ? (
          <div className="flex items-center justify-center py-16">
            <Loader2 className="size-6 animate-spin" style={{ color: theme.accent }} />
          </div>
        ) : !activeConversationId ? (
          /* Empty state — no conversation selected */
          <div className="flex flex-col items-center justify-center min-h-[300px] px-6 text-center">
            <div className="relative mb-5">
              <div className="size-20 rounded-2xl flex items-center justify-center" style={{ background: `${theme.accent}14`, border: `1px solid ${theme.accent}30` }}>
                <Bot className="size-9" style={{ color: theme.accent, opacity: 0.7 }} />
              </div>
              <div className="absolute -bottom-1 -right-1 size-7 rounded-full flex items-center justify-center border-2" style={{ background: theme.panelBg, borderColor: theme.divider }}>
                <Sparkles className="size-3.5" style={{ color: theme.accent }} />
              </div>
            </div>
            <h3 className="text-base font-bold mb-2" style={{ color: theme.accent }}>
              TraceOS AI 智能助手
            </h3>
            <p className="text-[13px] max-w-[340px] mb-6 leading-relaxed" style={{ color: theme.textSecondary }}>
              基于 ETCLOVG 7层 Agent 管道，结合代码上下文与 RAG 知识库，提供精准的教学辅导与智能诊断
            </p>
            <div className="grid grid-cols-2 gap-2.5 w-full max-w-[360px]">
              {QUICK_PROMPTS.map((qp, i) => (
                <button
                  key={i}
                  onClick={() => handleQuickPrompt(qp.prompt)}
                  className="flex flex-col items-center gap-1.5 p-3.5 rounded-xl border transition-all duration-300 group text-left"
                  style={{
                    background: theme.aiBubbleBg,
                    borderColor: theme.divider,
                  }}
                  onMouseEnter={(e) => {
                    e.currentTarget.style.borderColor = `${theme.accent}40`;
                    e.currentTarget.style.background = theme.accentDim;
                  }}
                  onMouseLeave={(e) => {
                    e.currentTarget.style.borderColor = theme.divider;
                    e.currentTarget.style.background = theme.aiBubbleBg;
                  }}
                >
                  <span style={{ color: qp.color }} className="group-hover:scale-110 transition-transform">
                    {qp.icon}
                  </span>
                  <span className="text-[11px] font-medium leading-tight text-center transition-colors" style={{ color: theme.textSecondary }}>
                    {qp.label}
                  </span>
                </button>
              ))}
            </div>
          </div>
        ) : messages.length === 0 && !isStreaming ? (
          /* Empty state — conversation exists but no messages */
          <div className="flex flex-col items-center justify-center min-h-[300px] px-6 text-center">
            <div className="size-16 rounded-2xl flex items-center justify-center mb-4" style={{ background: `${theme.accent}10`, border: `1px solid ${theme.accent}20` }}>
              <MessageSquare className="size-7" style={{ color: theme.accent, opacity: 0.7 }} />
            </div>
            <h3 className="text-sm font-semibold mb-1.5" style={{ color: theme.textPrimary }}>开始对话</h3>
            <p className="text-[12px] max-w-[300px] mb-5" style={{ color: theme.textSecondary }}>
              向 AI 助手提问关于操作系统实验的任何问题
            </p>
            <div className="grid grid-cols-2 gap-2 w-full max-w-[340px]">
              {QUICK_PROMPTS.map((qp, i) => (
                <button
                  key={i}
                  onClick={() => handleQuickPrompt(qp.prompt)}
                  className="flex flex-col items-center gap-1.5 p-3 rounded-xl border transition-all duration-300 group"
                  style={{ background: theme.aiBubbleBg, borderColor: theme.divider }}
                  onMouseEnter={(e) => {
                    e.currentTarget.style.borderColor = `${theme.accent}40`;
                    e.currentTarget.style.background = theme.accentDim;
                  }}
                  onMouseLeave={(e) => {
                    e.currentTarget.style.borderColor = theme.divider;
                    e.currentTarget.style.background = theme.aiBubbleBg;
                  }}
                >
                  <span style={{ color: qp.color }} className="group-hover:scale-110 transition-transform">
                    {qp.icon}
                  </span>
                  <span className="text-[10px] font-medium leading-tight text-center transition-colors" style={{ color: theme.textSecondary }}>
                    {qp.label}
                  </span>
                </button>
              ))}
            </div>
          </div>
        ) : (
          <>
            {messages.map((msg, idx) => {
              const isAI = msg.role === "assistant";
              return (
                <motion.div
                  key={msg.id || idx}
                  initial={{ opacity: 0, y: 8 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ duration: 0.25 }}
                  className={cn("flex gap-3", isAI ? "" : "flex-row-reverse")}
                >
                  {/* Avatar */}
                  <div className="shrink-0 mt-0.5">
                    <div
                      className="size-7 rounded-lg flex items-center justify-center"
                      style={isAI ? { background: `${theme.accent}20` } : {}}
                    >
                      {isAI ? (
                        <Bot className="size-3.5" style={{ color: theme.accent }} />
                      ) : (
                        <div className="size-7 rounded-lg flex items-center justify-center" style={{ background: `linear-gradient(135deg, ${theme.userBubbleFrom}, ${theme.userBubbleTo})` }}>
                          <User className="size-3.5 text-white" />
                        </div>
                      )}
                    </div>
                  </div>

                  {/* Bubble */}
                  <div className={cn("group/bubble max-w-[82%]", isAI ? "" : "flex flex-col items-end")}>
                    <div
                      className="rounded-2xl px-4 py-3 text-[13px] leading-relaxed"
                      style={
                        isAI
                          ? { background: theme.aiBubbleBg, borderColor: theme.aiBubbleBorder, border: `1px solid ${theme.aiBubbleBorder}`, borderRadius: "0.75rem 0.75rem 0.75rem 0.25rem", color: theme.textPrimary }
                          : { background: `linear-gradient(135deg, ${theme.userBubbleFrom}, ${theme.userBubbleTo})`, color: theme.userBubbleText, borderRadius: "0.75rem 0.75rem 0.25rem 0.75rem" }
                      }
                    >
                      {isAI ? (
                        <MarkdownRenderer>{msg.content}</MarkdownRenderer>
                      ) : (
                        <div className="whitespace-pre-wrap break-words">{msg.content}</div>
                      )}
                    </div>

                    {/* Tool calls */}
                    {isAI && msg.toolCalls && msg.toolCalls.length > 0 && (
                      <div className="mt-1.5 space-y-1">
                        {msg.toolCalls.map((tc, tci) => (
                          <div key={tci} className="flex items-center gap-1.5 px-2.5 py-1 rounded-md text-[10px]" style={{ background: `${theme.accent}10`, border: `1px solid ${theme.accent}20`, color: theme.accent }}>
                            <Zap className="size-3" />
                            <span className="font-medium">{tc.name}</span>
                            {tc.result && <span style={{ opacity: 0.6 }}>→ 完成</span>}
                          </div>
                        ))}
                      </div>
                    )}

                    {/* Meta: timestamp + copy */}
                    <div className="flex items-center gap-2 mt-1 px-0.5">
                      <span className="text-[10px] select-none" style={{ color: `${theme.textTertiary}80` }}>
                        {formatTime(msg.createdAt)}
                      </span>
                      {isAI && msg.content && (
                        <button onClick={() => handleCopy(msg.content, idx)} className="text-[10px] hover:opacity-80 transition-colors flex items-center gap-1" style={{ color: `${theme.textTertiary}70` }}>
                          {copiedIdx === idx ? (
                            <>
                              <Check className="size-2.5" style={{ color: theme.accent }} />
                              <span style={{ color: theme.accent }}>已复制</span>
                            </>
                          ) : (
                            <>
                              <Copy className="size-2.5" />
                              <span>复制</span>
                            </>
                          )}
                        </button>
                      )}
                      {(msg.tokensUsed ?? 0) > 0 && (
                        <span className="text-[10px] tabular-nums" style={{ color: `${theme.textTertiary}50` }}>
                          {msg.tokensUsed} tokens
                        </span>
                      )}
                    </div>
                  </div>
                </motion.div>
              );
            })}

            {/* Streaming bubble */}
            {isStreaming && (
              <div className="flex gap-3">
                <div className="shrink-0">
                  <div className="size-7 rounded-lg flex items-center justify-center" style={{ background: `${theme.accent}20` }}>
                    <Bot className="size-3.5" style={{ color: theme.accent }} />
                  </div>
                </div>
                <div className="max-w-[82%]">
                  <div className="rounded-2xl rounded-tl-md px-4 py-3 text-[13px] leading-relaxed" style={{ background: theme.aiBubbleBg, borderColor: `${theme.accent}30`, border: `1px solid ${theme.accent}30` }}>
                    {streamingContent ? (
                      <MarkdownRenderer>{streamingContent}</MarkdownRenderer>
                    ) : (
                      <div className="flex flex-col gap-2">
                        {/* Thinking stages */}
                        {thinkingStages && thinkingStages.length > 0 && (
                          <div className="mb-2">
                            <button
                              onClick={() => setShowThinking(!showThinking)}
                              className="flex items-center gap-1.5 text-[11px] font-medium mb-1"
                              style={{ color: theme.accent }}
                            >
                              <span>{showThinking ? "▾" : "▸"} AI 思考中...</span>
                            </button>
                            {showThinking && (
                              <div className="space-y-0.5 pl-1">
                                {thinkingStages.map((stage, i) => (
                                  <div key={i} className="flex items-center gap-1.5 text-[10px]" style={{ color: theme.textSecondary }}>
                                    <span className="shrink-0" style={{ color: stage.status === "done" ? theme.accent : stage.status === "running" ? "#f59e0b" : theme.textTertiary }}>
                                      {stage.status === "done" ? "✓" : stage.status === "running" ? "◎" : "○"}
                                    </span>
                                    <span>{stage.label}</span>
                                  </div>
                                ))}
                              </div>
                            )}
                          </div>
                        )}
                        {(!thinkingStages || thinkingStages.length === 0) && (
                          <div className="flex items-center gap-2 py-1">
                            <span className="w-2 h-2 rounded-full animate-bounce" style={{ background: theme.accent, animationDelay: "0ms" }} />
                            <span className="w-2 h-2 rounded-full animate-bounce" style={{ background: theme.accent, animationDelay: "150ms", opacity: 0.7 }} />
                            <span className="w-2 h-2 rounded-full animate-bounce" style={{ background: theme.accent, animationDelay: "300ms", opacity: 0.4 }} />
                            <span className="text-[12px] ml-1" style={{ color: theme.textSecondary }}>思考中...</span>
                          </div>
                        )}
                      </div>
                    )}
                    {streamingContent && (
                      <span className="inline-block w-0.5 h-[1.1em] align-text-bottom ml-0.5 animate-pulse" style={{ background: theme.accent }} />
                    )}
                  </div>
                  <div className="flex items-center gap-2 mt-1 px-0.5">
                    <span className="text-[10px] select-none" style={{ color: `${theme.textTertiary}70` }}>
                      正在生成...
                    </span>
                  </div>
                </div>
              </div>
            )}
          </>
        )}

        <div ref={messagesEndRef} />
      </div>

      {/* Input */}
      <div className="p-3 backdrop-blur-sm" style={{ borderTop: `1px solid ${theme.divider}`, background: `${theme.panelBg}CC` }}>
        <div className="flex gap-2 items-end">
          <div className="flex-1 relative">
            <textarea
              ref={textareaRef}
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder="向 AI 提问... (Enter 发送, Shift+Enter 换行)"
              rows={1}
              disabled={isStreaming || !activeConversationId}
              className="w-full rounded-2xl px-4 py-2.5 pr-14 text-[13px] outline-none transition-all resize-none disabled:opacity-40"
              style={{
                background: theme.inputBg,
                border: `1px solid ${theme.inputBorder}`,
                color: theme.textPrimary,
                minHeight: "40px",
                maxHeight: "150px",
              }}
              onFocus={(e) => { e.currentTarget.style.borderColor = theme.inputFocusBorder; e.currentTarget.style.boxShadow = `0 0 0 2px ${theme.accent}10`; }}
              onBlur={(e) => { e.currentTarget.style.borderColor = theme.inputBorder; e.currentTarget.style.boxShadow = "none"; }}
            />
            {inputCharCount > 0 && (
              <span className="absolute right-3 bottom-2.5 text-[10px] select-none transition-colors" style={{ color: isOverLimit ? "#F43F5E" : `${theme.textTertiary}50` }}>
                {inputCharCount}{isOverLimit ? "/4000" : ""}
              </span>
            )}
          </div>
          {isStreaming ? (
            <button
              onClick={stopStreaming}
              className="size-10 rounded-xl flex items-center justify-center bg-red-500 hover:bg-red-600 text-white transition-all shrink-0 shadow-sm"
              title="停止生成"
            >
              <StopCircle className="size-4" />
            </button>
          ) : (
            <button
              onClick={handleSend}
              disabled={!input.trim() || !activeConversationId}
              className="size-10 rounded-xl flex items-center justify-center transition-all shrink-0 shadow-sm"
              style={{
                background: input.trim() && activeConversationId
                  ? `linear-gradient(135deg, ${theme.sendBtnFrom}, ${theme.sendBtnTo})`
                  : theme.inputBg,
                border: input.trim() && activeConversationId ? "none" : `1px solid ${theme.inputBorder}`,
                opacity: !input.trim() || !activeConversationId ? 0.3 : 1,
                cursor: !input.trim() || !activeConversationId ? "not-allowed" : "pointer",
              }}
            >
              <Send className="size-4" style={{ color: input.trim() && activeConversationId ? "#fff" : theme.textTertiary }} />
            </button>
          )}
        </div>
      </div>
    </div>
  );
}