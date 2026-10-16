'use client';

import { useRef, useEffect, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { useWorkspaceStore } from '@/stores/workspace';
import { PanelHeader } from '@/components/ui/panel-header';
import { MessageCircle } from 'lucide-react';

export default function AIChatPanel() {
  const [collapsed, setCollapsed] = useState(false);
  const {
    experiment,
    aiMessages,
    aiLoading,
    aiInput,
    setAIInput,
    sendAIMessage,
  } = useWorkspaceStore();
  const messagesEndRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [aiMessages]);

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      sendAIMessage();
    }
  };

  return (
    <div className="flex flex-col h-full bg-[var(--bg-card)]">
      {/* Header */}
      <div onClick={() => setCollapsed(!collapsed)} className="cursor-pointer">
        <PanelHeader
          icon={MessageCircle}
          title="AI 教学助手"
          subtitle={experiment?.title || "苏格拉底式引导"}
        />
      </div>

      {/* Collapsible content */}
      <AnimatePresence initial={false}>
        {!collapsed && (
          <motion.div
            key="chat-body"
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: "auto", opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.3 }}
            className="flex-1 flex flex-col overflow-hidden"
          >
            <div className="flex-1 overflow-y-auto p-3 space-y-3">
        {aiMessages.length === 0 && !aiLoading && (
          <div className="flex flex-col items-center justify-center h-full text-center px-4">
            <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" className="text-[var(--text-tertiary)] mb-2">
              <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/>
              <line x1="9" y1="10" x2="15" y2="10"/>
              <line x1="12" y1="7" x2="12" y2="13"/>
            </svg>
            <p className="text-[12px] text-[var(--text-secondary)]">Ask AI anything about this experiment</p>
            <p className="text-[10px] text-[var(--text-tertiary)] mt-0.5">Your current code is included automatically</p>
          </div>
        )}

        {aiMessages.map((msg, i) => (
          <motion.div
            key={i}
            initial={{ opacity: 0, x: msg.role === 'user' ? 20 : -20 }}
            animate={{ opacity: 1, x: 0 }}
            transition={{ duration: 0.25, delay: i * 0.05 }}
            className={`flex gap-2 ${msg.role === 'user' ? 'flex-row-reverse' : ''}`}>
            <div className={`w-6 h-6 rounded-full flex items-center justify-center text-[9px] font-semibold shrink-0 mt-0.5 ${
              msg.role === 'ai'
                ? 'bg-[var(--bg-input)] text-[var(--accent)] border border-[var(--border-default)]'
                : 'bg-[var(--accent)] text-white'
            }`}>
              {msg.role === 'ai' ? 'AI' : 'U'}
            </div>
            <div className={`max-w-[82%] rounded-lg px-3 py-2 text-[12px] leading-relaxed ${
              msg.role === 'ai'
                ? 'bg-[var(--bg-card-hover)] text-[var(--text-primary)] border border-[var(--border-default)]'
                : 'bg-[var(--accent)] text-white'
            }`}>
              <div className="whitespace-pre-wrap break-words">{msg.content}</div>
            </div>
          </motion.div>
        ))}

        {aiLoading && (
          <div className="flex gap-2">
            <div className="w-6 h-6 rounded-full flex items-center justify-center text-[9px] font-semibold shrink-0 bg-[var(--bg-input)] text-[var(--accent)] border border-[var(--border-default)]">AI</div>
            <div className="bg-[var(--bg-card-hover)] border border-[var(--border-default)] rounded-lg px-3 py-2">
              <div className="flex items-center gap-1.5">
                <span className="w-1.5 h-1.5 rounded-full bg-[var(--accent)] animate-bounce" style={{ animationDelay: '0ms' }} />
                <span className="w-1.5 h-1.5 rounded-full bg-[var(--accent)] animate-bounce" style={{ animationDelay: '150ms' }} />
                <span className="w-1.5 h-1.5 rounded-full bg-[var(--accent)] animate-bounce" style={{ animationDelay: '300ms' }} />
              </div>
            </div>
          </div>
        )}

        <div ref={messagesEndRef} />
      </div>

            {/* Input */}
            <div className="border-t border-[var(--border-default)] p-3 flex-shrink-0">
              <div className="flex gap-2 items-end">
                <textarea
                  value={aiInput}
                  onChange={(e) => setAIInput(e.target.value)}
                  onKeyDown={handleKeyDown}
                  placeholder="Ask AI (Enter to send, Shift+Enter for newline)"
                  className="flex-1 px-3 py-2 border border-[var(--border-default)] rounded-lg resize-none text-[12px] bg-[var(--bg-input)] text-[var(--text-primary)] placeholder:text-[var(--text-tertiary)] focus:outline-none focus:border-[var(--accent)] focus:ring-1 focus:ring-[var(--accent)]/20 transition"
                  rows={2}
                  disabled={aiLoading}
                />
                <button
                  onClick={sendAIMessage}
                  disabled={aiLoading || !aiInput.trim()}
                  className="px-3.5 py-2 bg-[var(--accent)] text-white rounded-lg text-[12px] font-medium hover:opacity-90 disabled:opacity-40 transition shrink-0"
                >
                  Send
                </button>
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
