"use client";

import React, { useState, useRef, useEffect } from "react";
import { createPortal } from "react-dom";
import { useWorkspaceStore } from "@/stores/workspace";
import { THEMES } from "@/lib/themes";
import { Palette } from "lucide-react";

export function ThemeSwitcher() {
  const { themeMode, setThemeMode } = useWorkspaceStore();
  const [open, setOpen] = useState(false);
  const [mounted, setMounted] = useState(false);
  const btnRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState({ top: 0, right: 0 });

  useEffect(() => { setMounted(true); }, []);

  // Close on outside click
  useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => {
      if (
        menuRef.current &&
        !menuRef.current.contains(e.target as Node) &&
        !btnRef.current?.contains(e.target as Node)
      ) {
        setOpen(false);
      }
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [open]);

  const toggle = () => {
    if (!open && btnRef.current) {
      const r = btnRef.current.getBoundingClientRect();
      setPos({ top: r.bottom + 6, right: window.innerWidth - r.right });
    }
    setOpen((p) => !p);
  };

  const handleSelect = (id: string) => {
    setThemeMode(id as any);
    setOpen(false);
  };

  const cur = THEMES.find((t) => t.id === themeMode) ?? THEMES[0];

  const menu = open && (
    <div
      ref={menuRef}
      style={{
        position: "fixed",
        top: pos.top,
        right: pos.right,
        zIndex: 99999,
        background: "var(--kt-bg-glass-heavy)",
        borderColor: "var(--kt-border)",
      }}
      className="w-40 p-1.5 rounded-xl border shadow-lg backdrop-blur-xl animate-in fade-in slide-in-from-top-2 duration-150"
    >
      {THEMES.map((t) => (
        <button
          key={t.id}
          onClick={() => handleSelect(t.id)}
          className={`w-full flex items-center gap-2.5 px-3 py-2 rounded-lg text-xs transition-colors ${
            themeMode === t.id
              ? "bg-[var(--kt-cyan-dim)] text-[var(--kt-cyan)]"
              : "text-[var(--kt-text-secondary)] hover:bg-[var(--kt-bg-elevated)] hover:text-[var(--kt-text)]"
          }`}
        >
          <span
            className="size-4 rounded-full border border-[var(--kt-border)] flex-shrink-0 shadow-sm"
            style={{
              background:
                t.id === "light" ? "linear-gradient(135deg, #f5f5f7 50%, #e5e5ea 50%)"
                : t.id === "dark" ? "linear-gradient(135deg, #1c1c1e 50%, #0A0A0F 50%)"
                : t.id === "warm" ? "linear-gradient(135deg, #fdf8f0 50%, #d97706 50%)"
                : "linear-gradient(135deg, #334155 50%, #38bdf8 50%)",
            }}
          />
          <span className="text-[11px]">{t.icon}</span>
          <span>{t.label}</span>
          {themeMode === t.id && (
            <svg className="ml-auto size-3" viewBox="0 0 10 10" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M1 5l3 3 5-6" />
            </svg>
          )}
        </button>
      ))}
    </div>
  );

  return (
    <>
      <button
        ref={btnRef}
        onClick={toggle}
        className="flex items-center gap-1.5 px-2.5 py-1 text-xs border border-[var(--kt-border)] rounded-lg
          bg-[var(--kt-bg-surface)] text-[var(--kt-text-secondary)] hover:text-[var(--kt-text)]
          hover:border-[var(--kt-cyan)] transition-colors"
        title="切换主题色"
      >
        <Palette className="size-3.5" />
        <span className="hidden sm:inline">{cur.icon}</span>
        <span className="hidden md:inline text-[11px]">{cur.label}</span>
        <svg className={`size-3 transition-transform ${open ? "rotate-180" : ""}`} viewBox="0 0 10 10" fill="none" stroke="currentColor" strokeWidth="1.5">
          <path d="M2 3l3 4 3-4" />
        </svg>
      </button>
      {mounted && createPortal(menu, document.body)}
    </>
  );
}
