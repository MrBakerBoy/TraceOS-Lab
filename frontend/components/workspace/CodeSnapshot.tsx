"use client";

import React, { useState } from "react";
import { useWorkspaceStore } from "@/stores/workspace";
import { cn } from "@/lib/utils";
import { Camera, RotateCcw, Trash2, Clock, ChevronRight } from "lucide-react";

export function CodeSnapshotPanel() {
  const {
    codeSnapshots,
    addSnapshot,
    restoreSnapshot,
    deleteSnapshot,
    code,
  } = useWorkspaceStore();

  const [note, setNote] = useState("");
  const [showConfirmReset, setShowConfirmReset] = useState(false);
  const [resetOption, setResetOption] = useState<"keep" | "full">("keep");

  const handleSave = () => {
    if (!code.trim()) return;
    addSnapshot(note.trim() || `快照 ${codeSnapshots.length + 1}`);
    setNote("");
  };

  const formatTime = (ts: number) => {
    const d = new Date(ts);
    return d.toLocaleString("zh-CN", {
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
    });
  };

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="flex items-center gap-2 px-3 py-2 border-b border-[var(--kt-border)] flex-shrink-0">
        <Camera className="size-3.5 text-[var(--kt-cyan)]" />
        <span className="text-xs font-semibold text-[var(--kt-text)]">代码快照</span>
        <span className="text-[10px] text-[var(--kt-text-tertiary)] ml-auto">{codeSnapshots.length}</span>
      </div>

      {/* Save new snapshot */}
      <div className="px-3 py-2 border-b border-[var(--kt-border)] flex-shrink-0">
        <div className="flex gap-1.5">
          <input
            value={note}
            onChange={(e) => setNote(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && handleSave()}
            placeholder="备注（可选）"
            className="flex-1 px-2 py-1 text-[11px] bg-[var(--kt-bg-elevated)] border border-[var(--kt-border)] rounded text-[var(--kt-text)] focus:border-[var(--kt-cyan)] outline-none placeholder:text-[var(--kt-text-tertiary)]"
          />
          <button
            onClick={handleSave}
            disabled={!code.trim()}
            className="px-2.5 py-1 text-[11px] font-medium bg-[var(--kt-cyan-dim)] text-[var(--kt-cyan)] rounded hover:bg-[var(--kt-cyan)]/20 disabled:opacity-30 transition-colors flex-shrink-0"
          >
            保存
          </button>
        </div>
      </div>

      {/* Snapshot list */}
      <div className="flex-1 overflow-y-auto kt-scroll">
        {codeSnapshots.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-8 text-center">
            <Camera className="size-6 text-[var(--kt-text-tertiary)] mb-2" />
            <p className="text-[11px] text-[var(--kt-text-tertiary)]">暂无快照</p>
            <p className="text-[10px] text-[var(--kt-text-tertiary)] mt-0.5">保存代码版本以便回溯</p>
          </div>
        ) : (
          codeSnapshots.map((snap) => (
            <div
              key={snap.id}
              className="kt-snapshot-item group flex items-start gap-2 mx-2 mt-1"
            >
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-1.5">
                  <Clock className="size-3 text-[var(--kt-text-tertiary)] flex-shrink-0" />
                  <span className="text-[11px] font-medium text-[var(--kt-text)] truncate">
                    {snap.note || "未命名快照"}
                  </span>
                </div>
                <div className="text-[10px] text-[var(--kt-text-tertiary)] mt-0.5">
                  {formatTime(snap.createdAt)} · {snap.code.length} 字符
                </div>
              </div>
              <div className="flex items-center gap-0.5 opacity-0 group-hover:opacity-100 transition-opacity flex-shrink-0">
                <button
                  onClick={() => restoreSnapshot(snap.id)}
                  className="p-1 rounded hover:bg-[var(--kt-cyan-dim)] text-[var(--kt-cyan)]"
                  title="恢复此版本"
                >
                  <RotateCcw className="size-3" />
                </button>
                <button
                  onClick={() => deleteSnapshot(snap.id)}
                  className="p-1 rounded hover:bg-[var(--kt-red-dim)] text-[var(--kt-red)]"
                  title="删除"
                >
                  <Trash2 className="size-3" />
                </button>
              </div>
            </div>
          ))
        )}
      </div>
    </div>
  );
}
