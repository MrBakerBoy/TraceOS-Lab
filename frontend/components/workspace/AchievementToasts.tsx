"use client";

import { AnimatePresence, motion } from "framer-motion";
import { useWorkspaceStore } from "@/stores/workspace";
import { AchievementIcon } from "./AchievementIcon";

export function AchievementToasts() {
  const achievementToasts = useWorkspaceStore((s) => s.achievementToasts);
  const dismissAchievementToast = useWorkspaceStore(
    (s) => s.dismissAchievementToast,
  );

  return (
    <div className="fixed bottom-6 right-6 z-[200] flex flex-col gap-2 pointer-events-none">
      <AnimatePresence>
        {achievementToasts.map((t) => (
          <motion.div
            key={t.id}
            layout
            initial={{ opacity: 0, x: 80, scale: 0.96 }}
            animate={{ opacity: 1, x: 0, scale: 1 }}
            exit={{ opacity: 0, x: 80, scale: 0.96 }}
            transition={{ type: "spring", stiffness: 420, damping: 32 }}
            onClick={() => dismissAchievementToast(t.id)}
            className="pointer-events-auto cursor-pointer w-[320px] rounded-lg border border-[var(--kt-border-strong)] bg-[var(--kt-bg-elevated)] shadow-[var(--shadow-modal)] overflow-hidden"
          >
            <div className="flex items-center gap-3 px-4 py-3">
              <div className="flex-shrink-0 size-11 rounded-md bg-[var(--kt-amber-dim)] text-[var(--kt-amber)] flex items-center justify-center">
                <AchievementIcon icon={t.achievement.icon} className="size-6" />
              </div>
              <div className="min-w-0 flex-1">
                <div className="text-[10px] font-semibold uppercase tracking-wider text-[var(--kt-amber)]">
                  成就解锁
                </div>
                <div className="text-sm font-semibold text-[var(--kt-text)] truncate">
                  {t.achievement.name}
                </div>
              </div>
              <div className="flex-shrink-0 text-[11px] font-medium text-[var(--kt-green)]">
                已完成
              </div>
            </div>
            <motion.div
              className="h-0.5 bg-[var(--kt-amber)]"
              initial={{ width: "100%" }}
              animate={{ width: "0%" }}
              transition={{ duration: 4.5, ease: "linear" }}
            />
          </motion.div>
        ))}
      </AnimatePresence>
    </div>
  );
}
