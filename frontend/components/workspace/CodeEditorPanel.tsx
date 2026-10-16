'use client';

import { useRef, useEffect } from 'react';
import dynamic from 'next/dynamic';
import { useWorkspaceStore } from '@/stores/workspace';
import type { SyscallTrace } from '@/lib/api';
import ResultPanel from './ResultPanel';
import EditorToolbar from './EditorToolbar';

// Lazy-load Monaco Editor to reduce initial bundle size (~5MB savings)
const MonacoEditor = dynamic(() => import('@monaco-editor/react'), {
  ssr: false,
  loading: () => (
    <div className="flex items-center justify-center h-full bg-[var(--editor-bg)]">
      <div className="text-center space-y-3">
        <div className="animate-spin w-8 h-8 border-2 border-[var(--accent)] border-t-transparent rounded-full mx-auto" />
        <p className="text-sm text-[var(--text-tertiary)]">加载编辑器...</p>
      </div>
    </div>
  ),
});

export default function CodeEditorPanel() {
  const {
    code,
    language,
    setCode,
    editorFontSize,
    editorTheme,
    evalResult,
    submissions,
    selectedSubmissionId,
    replayTimestamp,
    replayTraces,
    replayActive,
  } = useWorkspaceStore();

  // Monaco editor instance refs for replay line highlighting (FE-M2)
  const editorRef = useRef<any>(null);
  const monacoRef = useRef<any>(null);
  const decorationsRef = useRef<string[]>([]);

  // Update Monaco line highlight when replay timestamp changes
  useEffect(() => {
    const editor = editorRef.current;
    const monaco = monacoRef.current;
    if (!editor || !monaco || !replayActive || !replayTraces.length) {
      if (editor && decorationsRef.current.length) {
        decorationsRef.current = editor.deltaDecorations(decorationsRef.current, []);
      }
      return;
    }
    const ts = replayTimestamp ?? new Date(replayTraces[0].time).getTime();
    let found: SyscallTrace | undefined;
    for (const t of replayTraces) {
      if (new Date(t.time).getTime() <= ts) found = t;
      else break;
    }
    const line = found?.source_line;
    if (line && line > 0) {
      decorationsRef.current = editor.deltaDecorations(decorationsRef.current, [
        {
          range: new monaco.Range(line, 1, line, 1),
          options: {
            isWholeLine: true,
            className: 'replay-highlight-line',
            glyphMarginClassName: 'replay-highlight-glyph',
          },
        },
      ]);
      editor.revealLineInCenter(line);
    } else {
      if (decorationsRef.current.length) {
        decorationsRef.current = editor.deltaDecorations(decorationsRef.current, []);
      }
    }
  }, [replayTimestamp, replayTraces, replayActive]);


  return (
    <div className="flex flex-col h-full">
      <EditorToolbar />

      <div className="flex-1 min-h-0">
        <MonacoEditor
          height="100%"
          language={language}
          value={code}
          onChange={(v) => { console.log('[CodeEditor] onChange fired, length:', v?.length); setCode(v || ''); }}
          theme={editorTheme}
          onMount={(editor, monaco) => {
            editorRef.current = editor;
            monacoRef.current = monaco;
          }}
          options={{ minimap: { enabled: false }, fontSize: editorFontSize, lineNumbers: 'on', glyphMargin: true, scrollBeyondLastLine: false, automaticLayout: true }}
        />
      </div>
      <ResultPanel evalResult={evalResult} submissionId={selectedSubmissionId || submissions?.[submissions.length - 1]?.id} />
    </div>
  );
}
