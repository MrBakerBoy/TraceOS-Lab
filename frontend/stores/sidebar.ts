import { create } from "zustand";

interface SidebarState {
  collapsed: boolean;
  toggleCollapsed: () => void;
  setCollapsed: (collapsed: boolean) => void;
}

function loadCollapsed(): boolean {
  if (typeof window === "undefined") return false;
  return localStorage.getItem("sidebar_collapsed") === "true";
}

function saveCollapsed(collapsed: boolean) {
  if (typeof window === "undefined") return;
  localStorage.setItem("sidebar_collapsed", String(collapsed));
  // Also save to backend
  const token = localStorage.getItem("token");
  if (token) {
    const API_BASE = process.env.NEXT_PUBLIC_API_URL || "";
    fetch(API_BASE + "/api/v1/user/preferences", {
      method: "PUT",
      headers: { "Content-Type": "application/json", Authorization: "Bearer " + token },
      body: JSON.stringify({ sidebar_collapsed: collapsed }),
    }).catch(() => {});
  }
}

export const useSidebarStore = create<SidebarState>((set) => ({
  collapsed: loadCollapsed(),
  toggleCollapsed: () => set((s) => {
    const next = !s.collapsed;
    saveCollapsed(next);
    return { collapsed: next };
  }),
  setCollapsed: (collapsed) => {
    saveCollapsed(collapsed);
    set({ collapsed });
  },
}));
