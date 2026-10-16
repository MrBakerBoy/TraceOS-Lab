import type { Config } from "tailwindcss";

// shadcn/ui 语义色：映射到 globals.css 中已定义的 CSS 变量。
// 用 color-mix 注入透明度，使 bg-primary/80、bg-destructive/10 等
// 透明度变体（slash opacity）能正确生成，而不是丢失 alpha 变成实心色。
const shadcnColor =
  (varName: string): any =>
  ({ opacityValue }: { opacityValue?: string | number } = {}) => {
    // Tailwind 对显式 alpha（/10、/80）传入数字字符串如 "0.1"；
    // 对无 alpha 修饰传入 "var(--tw-*-opacity, 1)" 这类 CSS 变量字符串。
    const n = Number(opacityValue);
    if (Number.isFinite(n)) {
      const pct = Math.round(n * 100);
      return `color-mix(in srgb, var(${varName}) ${pct}%, transparent)`;
    }
    return `var(${varName})`;
  };

const config: Config = {
  content: ["./pages/**/*.{js,ts,jsx,tsx,mdx}","./components/**/*.{js,ts,jsx,tsx,mdx}","./app/**/*.{js,ts,jsx,tsx,mdx}"],
  darkMode: "class",
  theme: { extend: {
    colors: {
      // ── shadcn/ui 标准语义色（从 globals.css 变量接入）──
      border: shadcnColor("--border"),
      input: shadcnColor("--input"),
      ring: shadcnColor("--ring"),
      background: shadcnColor("--background"),
      foreground: shadcnColor("--foreground"),
      primary: {
        DEFAULT: shadcnColor("--primary"),
        foreground: shadcnColor("--primary-foreground"),
      },
      secondary: {
        DEFAULT: shadcnColor("--secondary"),
        foreground: shadcnColor("--secondary-foreground"),
      },
      destructive: {
        DEFAULT: shadcnColor("--destructive"),
        foreground: shadcnColor("--destructive-foreground"),
      },
      muted: {
        DEFAULT: shadcnColor("--muted"),
        foreground: shadcnColor("--muted-foreground"),
      },
      accent: {
        DEFAULT: shadcnColor("--accent-shadcn"),
        foreground: shadcnColor("--accent-foreground"),
      },
      popover: {
        DEFAULT: shadcnColor("--popover"),
        foreground: shadcnColor("--popover-foreground"),
      },
      card: {
        DEFAULT: shadcnColor("--card"),
        foreground: shadcnColor("--card-foreground"),
      },

      // ── TraceOS 自定义 token ──
      "app-bg":"var(--bg-root)","app-card":"var(--bg-card)","app-card-hover":"var(--bg-card-hover)","app-input":"var(--bg-input)","app-border":"var(--border-default)","app-text":"var(--text-primary)","app-text-2":"var(--text-secondary)","app-text-3":"var(--text-tertiary)","app-accent":"var(--accent)","app-accent-hover":"var(--accent-hover)","app-success":"var(--success)","app-warning":"var(--warning)","app-error":"var(--error)","editor-bg":"var(--editor-bg)","terminal-bg":"var(--terminal-bg)",
    },
    fontFamily: {display:["var(--font-display)"],body:["var(--font-body)"],mono:["var(--font-mono)"]},
    borderRadius: {sm:"var(--radius-sm)",md:"var(--radius-md)",lg:"var(--radius-lg)",full:"var(--radius-full)"},
    boxShadow: {card:"var(--shadow-card)","card-hover":"var(--shadow-card-hover)",modal:"var(--shadow-modal)",glow:"var(--shadow-glow)"},
    backgroundImage: {"gradient-hero":"var(--gradient-hero)"},
    animation: {"fade-in":"fadeIn 250ms ease-out both","fade-in-up":"fadeInUp 400ms ease-out both","float":"float 3s ease-in-out infinite","pulse-glow":"pulseGlow 2s ease-in-out infinite","gradient":"gradientShift 3s ease infinite","spin-slow":"spin-slow 8s linear infinite","shimmer":"shimmer 1.5s ease-in-out infinite"},
  }},
  plugins: [require("tailwindcss-animate")],
};
export default config;