import { create } from "zustand";

// ── Types ──

export type GlassPreset = "balanced" | "focus" | "showcase";
export type CursorStyle = "line" | "block" | "underline";
export type DockPosition = "bottom" | "left";
export type MaxFps = 30 | 60;

export interface AppearanceSettings {
  glassBlur: number;          // 12-40
  glassOpacity: number;       // 0.6-0.95
  glassSaturate: number;      // 100-250
  borderOpacity: number;      // 0.02-0.15
  shadowDepth: number;        // 0-3
  bgIntensity: number;        // 0-1
  noiseIntensity: number;     // 0-1
  accentCyan: string;         // #00D4FF
  accentPurple: string;       // #BF5AF2
  borderRadius: number;       // 6-18
}

export interface AnimationSettings {
  globalEnable: boolean;
  speedMultiplier: number;    // 0.5-2.0
  pageEntrance: boolean;
  dockParallax: boolean;
  prismReflection: boolean;
  ambientOrb: boolean;
  cardHover: boolean;
  scanline: boolean;
  runGlow: boolean;
}

export interface TypographySettings {
  uiScale: number;            // 0.85-1.3
  editorFontSize: number;     // 10-22
  editorLineHeight: number;   // 1.2-2.0
  editorLigatures: boolean;
  letterSpacing: number;      // -0.5-2
}

export interface EditorSettings {
  cursorStyle: CursorStyle;
  tabSize: 2 | 4 | 8;
  wordWrap: boolean;
  smoothScroll: boolean;
  highlightContrast: number;  // 0.5-1.5
  lineNumbers: boolean;
  minimap: boolean;
  autoSave: boolean;
}

export interface PerformanceSettings {
  hwAccel: boolean;
  maxFps: MaxFps;
}

export interface DockSettings {
  position: DockPosition;
  iconScale: number;          // 0.8-1.3
  autoHide: boolean;
  glowIntensity: number;      // 0-1
}

export interface SystemSettings {
  advancedMode: boolean;
  language: string;
  timezone: string;
}

// ── Preset Definitions ──

export const PRESETS: Record<GlassPreset, Partial<SettingsState>> = {
  balanced: {
    appearance: {
      glassBlur: 20, glassOpacity: 0.85, glassSaturate: 180,
      borderOpacity: 0.06, shadowDepth: 1, bgIntensity: 1,
      noiseIntensity: 0.3, accentCyan: "#00D4FF", accentPurple: "#BF5AF2",
      borderRadius: 10,
    },
    animation: {
      globalEnable: true, speedMultiplier: 1,
      pageEntrance: true, dockParallax: true, prismReflection: true,
      ambientOrb: true, cardHover: true, scanline: true, runGlow: true,
    },
  },
  focus: {
    appearance: {
      glassBlur: 12, glassOpacity: 0.7, glassSaturate: 120,
      borderOpacity: 0.03, shadowDepth: 0, bgIntensity: 0.5,
      noiseIntensity: 0, accentCyan: "#00D4FF", accentPurple: "#BF5AF2",
      borderRadius: 6,
    },
    animation: {
      globalEnable: true, speedMultiplier: 1.5,
      pageEntrance: false, dockParallax: false, prismReflection: false,
      ambientOrb: false, cardHover: false, scanline: false, runGlow: true,
    },
  },
  showcase: {
    appearance: {
      glassBlur: 32, glassOpacity: 0.92, glassSaturate: 220,
      borderOpacity: 0.1, shadowDepth: 3, bgIntensity: 1,
      noiseIntensity: 0.8, accentCyan: "#00D4FF", accentPurple: "#BF5AF2",
      borderRadius: 14,
    },
    animation: {
      globalEnable: true, speedMultiplier: 0.8,
      pageEntrance: true, dockParallax: true, prismReflection: true,
      ambientOrb: true, cardHover: true, scanline: true, runGlow: true,
    },
  },
};

// ── Defaults ──

const defaults = (): SettingsState => ({
  appearance: {
    glassBlur: 20, glassOpacity: 0.85, glassSaturate: 180,
    borderOpacity: 0.06, shadowDepth: 1, bgIntensity: 1,
    noiseIntensity: 0.3, accentCyan: "#00D4FF", accentPurple: "#BF5AF2",
    borderRadius: 10,
  },
  animation: {
    globalEnable: true, speedMultiplier: 1,
    pageEntrance: true, dockParallax: true, prismReflection: true,
    ambientOrb: true, cardHover: true, scanline: true, runGlow: true,
  },
  typography: {
    uiScale: 1, editorFontSize: 13, editorLineHeight: 1.6,
    editorLigatures: true, letterSpacing: 0,
  },
  editor: {
    cursorStyle: "line", tabSize: 4, wordWrap: true,
    smoothScroll: true, highlightContrast: 1,
    lineNumbers: true, minimap: true, autoSave: true,
  },
  performance: {
    hwAccel: true, maxFps: 60,
  },
  dock: {
    position: "bottom", iconScale: 1, autoHide: false, glowIntensity: 0.6,
  },
  system: {
    advancedMode: false, language: "zh-CN", timezone: "Asia/Shanghai",
  },
  activePreset: "balanced",
});

// ── State Interface ──

export interface SettingsState {
  appearance: AppearanceSettings;
  animation: AnimationSettings;
  typography: TypographySettings;
  editor: EditorSettings;
  performance: PerformanceSettings;
  dock: DockSettings;
  system: SystemSettings;
  activePreset: GlassPreset;
}

interface SettingsActions {
  // Update individual settings (auto-save)
  updateAppearance: (patch: Partial<AppearanceSettings>) => void;
  updateAnimation: (patch: Partial<AnimationSettings>) => void;
  updateTypography: (patch: Partial<TypographySettings>) => void;
  updateEditor: (patch: Partial<EditorSettings>) => void;
  updatePerformance: (patch: Partial<PerformanceSettings>) => void;
  updateDock: (patch: Partial<DockSettings>) => void;
  updateSystem: (patch: Partial<SystemSettings>) => void;

  // Presets
  applyPreset: (preset: GlassPreset) => void;

  // Advanced mode
  toggleAdvancedMode: () => void;

  // Reset
  resetCategory: (category: keyof SettingsState) => void;
  resetAll: () => void;

  // Import/Export
  exportConfig: () => string;
  importConfig: (json: string) => boolean;

  // Undo
  undo: () => void;
  canUndo: boolean;
}

type SettingsStore = SettingsState & SettingsActions;

// ── Persistence ──

const STORE_KEY = "traceos_glass_settings";
const UNDO_STACK_KEY = "traceos_settings_undo";
const MAX_UNDO = 20;

function loadPersisted(): SettingsState | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = localStorage.getItem(STORE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw);
      return { ...defaults(), ...parsed };
    }
  } catch { /* ignore */ }
  return null;
}

function persist(state: SettingsState) {
  if (typeof window === "undefined") return;
  localStorage.setItem(STORE_KEY, JSON.stringify(state));
}

// Undo stack
function getUndoStack(): SettingsState[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = localStorage.getItem(UNDO_STACK_KEY);
    return raw ? JSON.parse(raw) : [];
  } catch { return []; }
}

function pushUndo(state: SettingsState) {
  const stack = getUndoStack();
  stack.push(JSON.parse(JSON.stringify(state)));
  if (stack.length > MAX_UNDO) stack.shift();
  localStorage.setItem(UNDO_STACK_KEY, JSON.stringify(stack));
}

// ── CSS Variable Sync ──

function syncCssVars(app: AppearanceSettings, anim: AnimationSettings) {
  if (typeof document === "undefined") return;
  const root = document.documentElement.style;

  // Glass parameters
  root.setProperty("--kt-glass-blur", `${app.glassBlur}px`);
  root.setProperty("--kt-glass-saturate", `${app.glassSaturate}%`);

  // Recalculate glass backgrounds
  root.setProperty("--kt-bg-glass", `rgba(18, 18, 26, ${app.glassOpacity})`);
  root.setProperty("--kt-bg-glass-light", `rgba(24, 24, 31, ${Math.max(0, app.glassOpacity - 0.2)})`);
  root.setProperty("--kt-bg-glass-heavy", `rgba(10, 10, 15, ${Math.min(1, app.glassOpacity + 0.07)})`);

  // Border
  root.setProperty("--kt-border", `rgba(255, 255, 255, ${app.borderOpacity})`);
  root.setProperty("--kt-border-strong", `rgba(255, 255, 255, ${app.borderOpacity + 0.04})`);

  // ACcent colors
  root.setProperty("--kt-cyan", app.accentCyan);
  root.setProperty("--kt-purple", app.accentPurple);
  root.setProperty("--kt-cyan-dim", `${app.accentCyan}26`);
  root.setProperty("--kt-cyan-glow", `${app.accentCyan}40`);
  root.setProperty("--kt-purple-dim", `${app.accentPurple}26`);
  root.setProperty("--kt-purple-glow", `${app.accentPurple}40`);

  // Border radius
  root.setProperty("--kt-radius-sm", `${Math.round(app.borderRadius * 0.6)}px`);
  root.setProperty("--kt-radius-md", `${app.borderRadius}px`);
  root.setProperty("--kt-radius-lg", `${Math.round(app.borderRadius * 1.4)}px`);
  root.setProperty("--kt-radius-xl", `${Math.round(app.borderRadius * 1.8)}px`);

  // Animation speed
  root.setProperty("--kt-anim-speed", `${anim.speedMultiplier}`);

  // Animation global disable
  if (!anim.globalEnable) {
    root.setProperty("--kt-anim-none", "none");
  } else {
    root.setProperty("--kt-anim-none", "unset");
  }

  // Noise intensity
  root.setProperty("--kt-noise-opacity", `${app.noiseIntensity * 0.04}`);

  // Background intensity
  root.setProperty("--kt-bg-deep", `hsl(240, 25%, ${3 + app.bgIntensity * 1.5}%)`);
}

// ── Store ──

export const useSettingsStore = create<SettingsStore>((set, get) => {
  const initial = loadPersisted() || defaults();

  // Sync CSS vars on creation
  syncCssVars(initial.appearance, initial.animation);

  // Helper to update + persist + sync + undo
  const apply = (partial: Partial<SettingsState>) => {
    const prev = get();
    // Push undo before change
    const undoState: SettingsState = {
      appearance: { ...prev.appearance },
      animation: { ...prev.animation },
      typography: { ...prev.typography },
      editor: { ...prev.editor },
      performance: { ...prev.performance },
      dock: { ...prev.dock },
      system: { ...prev.system },
      activePreset: prev.activePreset,
    };
    pushUndo(undoState);
    set(partial);
    const next = get();
    persist({
      appearance: next.appearance,
      animation: next.animation,
      typography: next.typography,
      editor: next.editor,
      performance: next.performance,
      dock: next.dock,
      system: next.system,
      activePreset: next.activePreset,
    });
    syncCssVars(next.appearance, next.animation);
  };

  return {
    ...initial,
    canUndo: getUndoStack().length > 0,

    updateAppearance: (patch) => {
      const app = { ...get().appearance, ...patch };
      apply({ appearance: app, activePreset: "balanced" });
    },
    updateAnimation: (patch) => {
      const anim = { ...get().animation, ...patch };
      apply({ animation: anim, activePreset: "balanced" });
    },
    updateTypography: (patch) => {
      apply({ typography: { ...get().typography, ...patch }, activePreset: "balanced" });
    },
    updateEditor: (patch) => {
      apply({ editor: { ...get().editor, ...patch } });
    },
    updatePerformance: (patch) => {
      apply({ performance: { ...get().performance, ...patch } });
    },
    updateDock: (patch) => {
      apply({ dock: { ...get().dock, ...patch } });
    },
    updateSystem: (patch) => {
      apply({ system: { ...get().system, ...patch } });
    },

    applyPreset: (preset) => {
      const presetData = PRESETS[preset];
      if (!presetData) return;
      apply({
        ...presetData,
        typography: get().typography,
        editor: get().editor,
        performance: get().performance,
        dock: get().dock,
        system: get().system,
        activePreset: preset,
      } as SettingsState);
    },

    toggleAdvancedMode: () => {
      const sys = { ...get().system, advancedMode: !get().system.advancedMode };
      apply({ system: sys });
    },

    resetCategory: (category) => {
      const d = defaults();
      apply({ [category]: d[category] } as unknown as Partial<SettingsState>);
    },

    resetAll: () => {
      const d = defaults();
      apply(d);
    },

    exportConfig: () => {
      const state = get();
      return JSON.stringify({
        appearance: state.appearance,
        animation: state.animation,
        typography: state.typography,
        editor: state.editor,
        performance: state.performance,
        dock: state.dock,
        system: state.system,
        activePreset: state.activePreset,
      }, null, 2);
    },

    importConfig: (json) => {
      try {
        const parsed = JSON.parse(json);
        apply({ ...defaults(), ...parsed });
        return true;
      } catch {
        return false;
      }
    },

    undo: () => {
      const stack = getUndoStack();
      if (stack.length === 0) return;
      const prev = stack.pop()!;
      localStorage.setItem(UNDO_STACK_KEY, JSON.stringify(stack));
      set({
        ...prev,
        canUndo: stack.length > 0,
      });
      persist(prev);
      syncCssVars(prev.appearance, prev.animation);
    },
  };
});

// re-sync on load
if (typeof window !== "undefined") {
  const stored = loadPersisted();
  if (stored) {
    syncCssVars(stored.appearance, stored.animation);
  }
}
