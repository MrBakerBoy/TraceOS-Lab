"use client";

import React from "react";
import dynamic from "next/dynamic";
import { useWorkspaceStore } from "@/stores/workspace";
import { useThemeStore } from "@/stores/theme";

// MUST import Monaco loader config BEFORE dynamic import of the editor
import "@/lib/monaco";

const MonacoEditor = dynamic(() => import("@monaco-editor/react").then((m) => m.Editor), {
  ssr: false,
  loading: () => (
    <div className="flex-1 flex items-center justify-center bg-[var(--editor-bg)] text-[var(--text-tertiary)] text-sm">
      编辑器加载中...
    </div>
  ),
});

export function EditorPanel() {
  const code = useWorkspaceStore((s) => s.code);
  const setCode = useWorkspaceStore((s) => s.setCode);
  const language = useWorkspaceStore((s) => s.language);
  const editorTheme = useThemeStore((s) => s.editorTheme);

  return (
    <div className="flex-1 flex flex-col min-w-0 overflow-hidden">
      {/* File Tabs */}
      <div className="flex bg-[#252526] border-b border-[#3e3e42] flex-shrink-0">
        <div className="flex items-center px-4 py-2 text-[12px] text-white bg-[var(--editor-bg)] border-b-2 border-[var(--accent)] gap-2">
          main.c
          <span className="w-2 h-2 rounded-full bg-[var(--warning)]" />
        </div>
      </div>

      {/* Monaco Editor */}
      <div className="flex-1">
        <MonacoEditor
          height="100%"
          language={language || "c"}
          theme={editorTheme === "github-light" ? "vs" : "vs-dark"}
          value={code}
          onChange={(val) => setCode(val || "")}
          options={{
            fontSize: 13,
            fontFamily: "var(--font-mono)",
            minimap: { enabled: false },
            automaticLayout: true,
            scrollBeyondLastLine: false,
            lineNumbers: "on",
            renderWhitespace: "selection",
            tabSize: 2,
          }}
        />
      </div>
    </div>
  );
}
