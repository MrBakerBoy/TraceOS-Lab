"use client";

import { useState, useCallback } from "react";
import { Prism as SyntaxHighlighter } from "react-syntax-highlighter";
import { oneLight, oneDark } from "react-syntax-highlighter/dist/esm/styles/prism";
import { Copy, Check } from "lucide-react";
import { useChatTheme } from "@/hooks/useChatTheme";
import { useWorkspaceStore } from "@/stores/workspace";

interface CodeBlockProps {
  language?: string;
  value: string;
}

/** Map common language identifiers to Prism language names */
const LANG_MAP: Record<string, string> = {
  c: "c",
  cpp: "cpp",
  "c++": "cpp",
  python: "python",
  py: "python",
  javascript: "javascript",
  js: "javascript",
  typescript: "typescript",
  ts: "typescript",
  go: "go",
  golang: "go",
  rust: "rust",
  rs: "rust",
  java: "java",
  shell: "bash",
  sh: "bash",
  bash: "bash",
  zsh: "bash",
  makefile: "makefile",
  dockerfile: "docker",
  yaml: "yaml",
  yml: "yaml",
  json: "json",
  html: "markup",
  css: "css",
  sql: "sql",
  text: "text",
  plaintext: "text",
  markdown: "markdown",
};

const FALLBACK_LANG = "text";

export default function CodeBlock({ language, value }: CodeBlockProps) {
  const [copied, setCopied] = useState(false);
  const theme = useChatTheme();
  const themeMode = useWorkspaceStore((s) => s.themeMode);
  const isDark = themeMode === "dark" || themeMode === "slate" || themeMode === "neon";
  const lang = LANG_MAP[language?.toLowerCase() || ""] || language || FALLBACK_LANG;
  const displayLang = language || "text";
  const lineCount = value.split("\n").length;

  const handleCopy = useCallback(async () => {
    try {
      await navigator.clipboard.writeText(value);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // clipboard not available
    }
  }, [value]);

  return (
    <div
      className="code-block group/code relative my-4 rounded-lg border overflow-hidden"
      style={{
        background: theme.codeBlockBg,
        borderColor: `${theme.aiBubbleBorder}`,
      }}
    >
      {/* Header bar */}
      <div
        className="flex items-center justify-between px-4 py-2 border-b"
        style={{
          background: isDark ? `${theme.panelBg}` : `${theme.aiBubbleBg}`,
          borderColor: `${theme.aiBubbleBorder}`,
        }}
      >
        <span
          className="text-[11px] font-medium uppercase tracking-wide select-none"
          style={{ color: `${theme.textTertiary}` }}
        >
          {displayLang}
        </span>
        <div className="flex items-center gap-2">
          <span
            className="text-[10px] select-none tabular-nums"
            style={{ color: `${theme.textTertiary}` }}
          >
            {lineCount} {lineCount === 1 ? "line" : "lines"}
          </span>
          <button
            onClick={handleCopy}
            className="flex items-center gap-1 px-2 py-0.5 rounded text-[11px] transition-colors"
            style={{
              color: theme.textTertiary,
            }}
            onMouseEnter={(e) => {
              e.currentTarget.style.background = theme.sidebarHover;
              e.currentTarget.style.color = theme.textSecondary;
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.background = "transparent";
              e.currentTarget.style.color = theme.textTertiary;
            }}
            aria-label={copied ? "已复制" : "复制代码"}
          >
            {copied ? (
              <Check className="size-3" style={{ color: theme.inlineCodeText }} />
            ) : (
              <Copy className="size-3" />
            )}
            <span>{copied ? "已复制" : "复制"}</span>
          </button>
        </div>
      </div>

      {/* Code body */}
      <div className="overflow-x-auto">
        <SyntaxHighlighter
          language={lang}
          style={isDark ? oneDark : oneLight}
          showLineNumbers
          lineNumberStyle={{
            minWidth: "2.25em",
            paddingRight: "1em",
            color: isDark ? "#6e7681" : "#8c959f",
            textAlign: "right",
            userSelect: "none",
            fontSize: "0.75rem",
            lineHeight: "1.6",
          }}
          codeTagProps={{
            style: {
              fontSize: "0.8125rem",
              lineHeight: "1.6",
              fontFamily: "'JetBrains Mono', 'Fira Code', 'Cascadia Code', monospace",
            },
          }}
          customStyle={{
            margin: 0,
            padding: "1rem 0",
            background: "transparent",
            borderRadius: 0,
          }}
          wrapLines={false}
          wrapLongLines={false}
        >
          {value}
        </SyntaxHighlighter>
      </div>
    </div>
  );
}