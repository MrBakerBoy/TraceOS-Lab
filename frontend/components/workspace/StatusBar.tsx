"use client";

import React from "react";
import { useWorkspaceStore } from "@/stores/workspace";
import { Loader2 } from "lucide-react";

export function StatusBar() {
  const { experiment, language, submitting } = useWorkspaceStore();

  return (
    <div className="h-7 flex items-center gap-4 px-4 bg-card border-t flex-shrink-0 select-none text-[11px]">
      <div className="flex-1" />

      {experiment && (
        <div className="flex items-center gap-3">
          <span className="text-muted-foreground">
            <span className="text-foreground/70 font-medium">{experiment.category || "OS"}</span>
          </span>
          <span className="w-px h-3 bg-border" />
          <span className="text-muted-foreground">
            语言: <span className="text-foreground/70 font-medium font-mono">{language || "c"}</span>
          </span>
          {submitting && (
            <>
              <span className="w-px h-3 bg-border" />
              <span className="text-yellow-500 flex items-center gap-1">
                <Loader2 className="size-3 animate-spin" />
                运行中...
              </span>
            </>
          )}
        </div>
      )}
    </div>
  );
}
