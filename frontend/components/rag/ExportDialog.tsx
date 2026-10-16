"use client";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { ScrollArea } from "@/components/ui/scroll-area";
import type { RagChatItem } from "@/lib/knowledge-types";
import { Check, Copy, Download } from "lucide-react";
import { useMemo, useState } from "react";

interface ExportDialogProps {
  open: boolean;
  messages: RagChatItem[];
  onClose: () => void;
}

function buildMarkdown(messages: RagChatItem[]): string {
  const lines: string[] = ["# RAG 问答导出", "", `导出时间：${new Date().toLocaleString("zh-CN")}`, ""];
  for (const m of messages) {
    if (m.role === "user") {
      lines.push("## 用户", "", m.content, "");
    } else {
      lines.push("## AI 助教", "", m.content, "");
      if (m.references && m.references.length > 0) {
        lines.push("### 引用来源", "");
        m.references.forEach((r, i) => {
          lines.push(`- [${i + 1}] ${r.title}（相似度 ${(r.similarity * 100).toFixed(1)}%）`);
        });
        lines.push("");
      }
    }
  }
  return lines.join("\n");
}

export default function ExportDialog({ open, messages, onClose }: ExportDialogProps) {
  const [copied, setCopied] = useState(false);
  const markdown = useMemo(() => buildMarkdown(messages), [messages]);

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(markdown);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      /* ignore */
    }
  };

  const handleDownload = () => {
    const blob = new Blob([markdown], { type: "text/markdown;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `rag-export-${Date.now()}.md`;
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <Dialog open={open} onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>导出对话</DialogTitle>
          <DialogDescription>将问答内容与引用来源导出为 Markdown</DialogDescription>
        </DialogHeader>

        <ScrollArea className="max-h-[50vh] rounded-lg border border-[var(--border-default)] bg-[var(--bg-elevated)] p-4">
          <pre className="whitespace-pre-wrap font-mono text-[12px] leading-relaxed text-[var(--text-secondary)]">
            {markdown}
          </pre>
        </ScrollArea>

        <DialogFooter className="sm:justify-between">
          <span className="text-[11px] text-[var(--text-tertiary)]">{messages.length} 条消息</span>
          <div className="flex gap-2">
            <Button variant="outline" size="sm" onClick={handleCopy}>
              {copied ? <Check className="size-4 text-[var(--success)]" /> : <Copy className="size-4" />}
              {copied ? "已复制" : "复制"}
            </Button>
            <Button size="sm" onClick={handleDownload}>
              <Download className="size-4" />
              下载 .md
            </Button>
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}