"use client";

import React, { useEffect, useState, useCallback } from "react";

type ToastType = "success" | "error" | "warning" | "info";

interface ToastItem {
  id: number;
  type: ToastType;
  message: string;
}

let toastId = 0;
let addToastFn: ((t: ToastItem) => void) | null = null;

export function showToast(type: ToastType, message: string, duration = 4000) {
  const id = ++toastId;
  addToastFn?.({ id, type, message });
  if (type !== "error") {
    setTimeout(() => {
      addToastFn?.(null!);
    }, duration);
  }
}

// Hook for global toast management
export function useToast() {
  return {
    success: (msg: string) => showToast("success", msg),
    error: (msg: string) => showToast("error", msg, 0),
    warning: (msg: string) => showToast("warning", msg),
    info: (msg: string) => showToast("info", msg),
  };
}

const typeStyles: Record<ToastType, string> = {
  success: "border-[var(--success)]",
  error: "border-[var(--error)]",
  warning: "border-[var(--warning)]",
  info: "border-[var(--accent)]",
};

const typeIcons: Record<ToastType, string> = {
  success: "✓",
  error: "✕",
  warning: "!",
  info: "i",
};

export function ToastContainer() {
  const [toasts, setToasts] = useState<ToastItem[]>([]);

  useEffect(() => {
    addToastFn = (t: ToastItem) => {
      if (!t) {
        setToasts((prev) => prev.slice(1));
      } else {
        setToasts((prev) => [...prev, t]);
      }
    };
    return () => {
      addToastFn = null;
    };
  }, []);

  if (toasts.length === 0) return null;

  return (
    <div className="fixed top-4 right-4 z-[9999] flex flex-col gap-2 max-w-sm">
      {toasts.map((t, i) => (
        <div
          key={t.id}
          className={`flex items-center gap-2 bg-[var(--bg-card)] border-l-4 rounded-[var(--radius-md)] shadow-[var(--shadow-modal)] px-4 py-3 text-sm animate-[slideIn_300ms_ease-out] ${typeStyles[t.type]}`}
          style={{
            animation: "slideIn 300ms cubic-bezier(0.34,1.56,0.64,1)",
            opacity: i === 0 ? 1 : 0.6,
            transform: i > 0 ? "scale(0.95)" : "none",
          }}
        >
          <span className="font-bold text-sm">{typeIcons[t.type]}</span>
          <span className="text-[var(--text-primary)] flex-1">{t.message}</span>
          <button
            onClick={() => setToasts((prev) => prev.filter((_, j) => j !== i))}
            className="text-[var(--text-tertiary)] hover:text-[var(--text-primary)] text-xs ml-2"
          >
            ✕
          </button>
        </div>
      ))}
      <style>{`
        @keyframes slideIn {
          from { opacity: 0; transform: translateX(100%); }
          to { opacity: 1; transform: translateX(0); }
        }
      `}</style>
    </div>
  );
}
