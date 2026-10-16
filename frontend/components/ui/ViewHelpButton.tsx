"use client";

import React, { useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { HelpCircle, X } from "lucide-react";
import { cn } from "@/lib/utils";
import type { ViewHelpContent } from "@/lib/view-help-content";

interface ViewHelpButtonProps {
  content: ViewHelpContent;
}

interface PanelPos {
  top: number;
  left: number;
  placement: 'below' | 'above';
}

export default function ViewHelpButton({ content }: ViewHelpButtonProps) {
  const [open, setOpen] = useState(false);
  const [mounted, setMounted] = useState(false);
  const [pos, setPos] = useState<PanelPos | null>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);

  const PANEL_W = 320; // w-80
  const GAP = 8; // mt-2
  const MARGIN = 8;

  // Mount guard for portal (SSR safety)
  useEffect(() => {
    setMounted(true);
  }, []);

  // Compute position whenever the panel opens (and on scroll/resize)
  const computePos = () => {
    const trigger = triggerRef.current;
    if (!trigger) return;
    const r = trigger.getBoundingClientRect();
    const vw = window.innerWidth;
    const vh = window.innerHeight;

    let left = r.right - PANEL_W;
    if (left < MARGIN) left = MARGIN;
    if (left + PANEL_W > vw - MARGIN) left = vw - MARGIN - PANEL_W;

    const belowTop = r.bottom + GAP;
    const belowOk = belowTop + 360 < vh - MARGIN; // 360 ~ typical content height
    let top: number;
    let placement: 'below' | 'above' = 'below';
    if (belowOk) {
      top = belowTop;
      placement = 'below';
    } else {
      top = r.top - GAP;
      placement = 'above';
    }
    if (top < MARGIN) top = MARGIN;

    setPos({ top, left, placement: placement });
  };

  useLayoutEffect(() => {
    if (!open) return;
    computePos();
    const onScroll = () => computePos();
    const onResize = () => computePos();
    window.addEventListener('scroll', onScroll, true);
    window.addEventListener('resize', onResize);
    return () => {
      window.removeEventListener('scroll', onScroll, true);
      window.removeEventListener('resize', onResize);
    };
  }, [open]);

  // Close on outside click
  useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => {
      if (
        panelRef.current &&
        !panelRef.current.contains(e.target as Node) &&
        triggerRef.current &&
        !triggerRef.current.contains(e.target as Node)
      ) {
        setOpen(false);
      }
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [open]);

  // Close on Escape
  useEffect(() => {
    if (!open) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("keydown", handler);
    return () => document.removeEventListener("keydown", handler);
  }, [open]);

  return (
    <div className="relative inline-flex">
      <button
        ref={triggerRef}
        onClick={() => setOpen(!open)}
        className={cn(
          "inline-flex items-center justify-center w-7 h-7 rounded-md",
          "text-[var(--kt-text-tertiary)] hover:text-[var(--kt-cyan)]",
          "hover:bg-[var(--kt-cyan-dim)] transition-colors duration-150",
          open && "text-[var(--kt-cyan)] bg-[var(--kt-cyan-dim)]"
        )}
        title="查看学习提示"
        aria-label="查看学习提示"
      >
        <HelpCircle size={14} strokeWidth={1.8} />
      </button>

      {open && mounted && pos && createPortal(
        <div
          ref={panelRef}
          style={{ position: 'fixed', top: pos.top, left: pos.left, width: PANEL_W }}
          className={cn(
            "z-[9999] max-h-[70vh] overflow-y-auto",
            "rounded-lg border border-[var(--kt-border)]",
            "bg-[var(--kt-bg-surface)] shadow-xl",
            "text-sm text-[var(--kt-text-secondary)]",
            "animate-in fade-in-0 zoom-in-95",
            "origin-top-right"
          )}
        >
          {/* Header */}
          <div className="flex items-center justify-between px-4 py-3 border-b border-[var(--kt-border)]">
            <div className="flex items-center gap-2">
              <HelpCircle size={16} className="text-[var(--kt-cyan)]" />
              <h4 className="text-sm font-semibold text-[var(--kt-text)]">
                {content.title}
              </h4>
            </div>
            <button
              onClick={() => setOpen(false)}
              className="text-[var(--kt-text-tertiary)] hover:text-[var(--kt-text)] transition-colors"
            >
              <X size={14} />
            </button>
          </div>

          {/* Content */}
          <div className="px-4 py-3 space-y-4">
            {/* Section 1: What is this */}
            <div>
              <h5 className="text-xs font-semibold text-[var(--kt-cyan)] uppercase tracking-wide mb-1.5">
                📖 这个图是什么
              </h5>
              <p className="text-xs leading-relaxed text-[var(--kt-text-secondary)]">
                {content.what}
              </p>
            </div>

            {/* Section 2: How to read */}
            <div>
              <h5 className="text-xs font-semibold text-[var(--kt-amber)] uppercase tracking-wide mb-1.5">
                👀 怎么看
              </h5>
              <ul className="space-y-1.5">
                {content.howToRead.map((item, i) => (
                  <li key={i} className="flex items-start gap-2 text-xs text-[var(--kt-text-secondary)]">
                    <span className="text-[var(--kt-cyan)] mt-0.5 shrink-0">•</span>
                    <span>{item}</span>
                  </li>
                ))}
              </ul>
            </div>

            {/* Section 3: Key terms */}
            <div>
              <h5 className="text-xs font-semibold text-[var(--kt-purple)] uppercase tracking-wide mb-1.5">
                📚 关键概念速查
              </h5>
              <dl className="space-y-2">
                {content.keyTerms.map((term, i) => (
                  <div key={i}>
                    <dt className="text-xs font-medium text-[var(--kt-text)]">
                      {term.term}
                    </dt>
                    <dd className="text-[11px] text-[var(--kt-text-tertiary)] leading-relaxed mt-0.5">
                      {term.definition}
                    </dd>
                  </div>
                ))}
              </dl>
            </div>
          </div>
        </div>,
        document.body
      )}
    </div>
  );
}
