"use client";

import { create } from "zustand";
import type { EbpfTabId, EbpfViewState, HealthScore, HealthStatus, AIAskContext } from "@/types/ebpf";

export interface EbpfStoreState {
  // ── View State ──
  activeTab: EbpfTabId;
  realtimeMode: boolean;
  filterCategory: EbpfViewState["filterCategory"];

  // ── Health ──
  healthScore: HealthScore | null;
  healthLoading: boolean;
  healthError: string | null;

  // ── Realtime SSE ──
  sseConnected: boolean;
  ssePid: number | null;

  // ── AI Context ──
  aiContext: AIAskContext | null;
  aiSidebarOpen: boolean;

  // ── Cross-tab navigation ──
  navigateTo: (tabId: EbpfTabId) => void;

  // ── Actions ──
  setActiveTab: (tab: EbpfTabId) => void;
  setRealtimeMode: (on: boolean) => void;
  setFilterCategory: (cat: EbpfViewState["filterCategory"]) => void;
  setHealthScore: (score: HealthScore | null) => void;
  setHealthLoading: (loading: boolean) => void;
  setHealthError: (error: string | null) => void;
  setSseConnected: (connected: boolean) => void;
  setSsePid: (pid: number | null) => void;
  openAiSidebar: (ctx: AIAskContext) => void;
  closeAiSidebar: () => void;
  reset: () => void;
}

const initialState = {
  activeTab: "health" as EbpfTabId,
  realtimeMode: false,
  filterCategory: "all" as EbpfViewState["filterCategory"],
  healthScore: null,
  healthLoading: false,
  healthError: null,
  sseConnected: false,
  ssePid: null,
  aiContext: null,
  aiSidebarOpen: false,
};

export const useEbpfStore = create<EbpfStoreState>((set) => ({
  ...initialState,

  navigateTo: (tabId) => set({ activeTab: tabId }),

  setActiveTab: (tab) => set({ activeTab: tab }),
  setRealtimeMode: (on) => set({ realtimeMode: on }),
  setFilterCategory: (cat) => set({ filterCategory: cat }),
  setHealthScore: (score) => set({ healthScore: score }),
  setHealthLoading: (loading) => set({ healthLoading: loading }),
  setHealthError: (error) => set({ healthError: error }),
  setSseConnected: (connected) => set({ sseConnected: connected }),
  setSsePid: (pid) => set({ ssePid: pid }),
  openAiSidebar: (ctx) => set({ aiContext: ctx, aiSidebarOpen: true }),
  closeAiSidebar: () => set({ aiSidebarOpen: false }),
  reset: () => set(initialState),
}));