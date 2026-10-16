"use client";

import React, { useCallback, useMemo } from "react";
import { X, Filter, Clock } from "lucide-react";
import { cn } from "@/lib/utils";
import { useWorkspaceStore, type ActiveFilter } from "@/stores/workspace";
import type { FilterFacet } from "@/types/obs_context";

/**
 * FilterBar — Datadog Template Variables style filter chips.
 * 
 * Supports multi-dimensional filtering:
 *   syscall:*  severity:*  process:*  thread:*  source:*  type:*  fd:*
 * 
 * Integration with workspace store:
 *   - syncedTimestamp: displays current timeline position
 *   - activeFilters: manages current filter state
 *   - filterFacets: available filter options from ObsContext
 */
export function FilterBar() {
  const syncedTimestamp = useWorkspaceStore((s) => s.syncedTimestamp);
  const crossPanelSync = useWorkspaceStore((s) => s.crossPanelSync);
  const setCrossPanelSync = useWorkspaceStore((s) => s.setCrossPanelSync);
  const setSyncedTimestamp = useWorkspaceStore((s) => s.setSyncedTimestamp);
  const obsContext = useWorkspaceStore((s) => s.obsContext);

  // Active filters from store (would be managed via a filter state)
  const [localFilters, setLocalFilters] = React.useState<ActiveFilter[]>([]);
  const [showDropdown, setShowDropdown] = React.useState<string | null>(null);

  const facets: FilterFacet[] = obsContext?.filter_facets || [];

  const addFilter = useCallback((field: string, value: string) => {
    setLocalFilters((prev) => {
      const exists = prev.find((f) => f.field === field && f.value === value);
      if (exists) return prev;
      return [...prev, { field, value }];
    });
    setShowDropdown(null);
  }, []);

  const removeFilter = useCallback((field: string, value: string) => {
    setLocalFilters((prev) => prev.filter((f) => !(f.field === field && f.value === value)));
  }, []);

  const clearFilters = useCallback(() => {
    setLocalFilters([]);
  }, []);

  const clearTimestamp = useCallback(() => {
    setSyncedTimestamp(null);
  }, [setSyncedTimestamp]);

  const formatTimestamp = (ts: number | null) => {
    if (ts === null) return "";
    const ms = Math.floor(ts);
    const sec = Math.floor(ms / 1000);
    const min = Math.floor(sec / 60);
    const remainSec = sec % 60;
    const remainMs = ms % 1000;
    return `T+${min}:${String(remainSec).padStart(2, "0")}.${String(remainMs).padStart(3, "0")}`;
  };

  const hasActiveFilters = localFilters.length > 0;
  const hasTimestamp = syncedTimestamp !== null;

  return (
    <div className="h-8 flex items-center gap-2 px-3 bg-background/50 border-b text-xs flex-shrink-0">
      {/* Cross-panel sync toggle */}
      <button
        onClick={() => setCrossPanelSync(!crossPanelSync)}
        className={cn(
          "flex items-center gap-1 px-1.5 py-0.5 rounded text-[11px] transition-colors",
          crossPanelSync
            ? "bg-primary/10 text-primary border border-primary/20"
            : "text-muted-foreground border border-transparent hover:border-border"
        )}
        title={crossPanelSync ? "跨面板同步已启用" : "跨面板同步已禁用"}
      >
        <Clock className="size-3" />
        {crossPanelSync ? "同步中" : "已断开"}
      </button>

      {/* Active timestamp display */}
      {hasTimestamp && (
        <span className="flex items-center gap-1 px-1.5 py-0.5 bg-primary/10 text-primary rounded text-[11px] border border-primary/20">
          {formatTimestamp(syncedTimestamp)}
          <button onClick={clearTimestamp} className="hover:text-primary/70">
            <X className="size-3" />
          </button>
        </span>
      )}

      {/* Filter trigger */}
      {facets.length > 0 && (
        <div className="relative">
          <button
            onClick={() => setShowDropdown(showDropdown === "filter" ? null : "filter")}
            className={cn(
              "flex items-center gap-1 px-1.5 py-0.5 rounded text-[11px] transition-colors",
              hasActiveFilters
                ? "bg-blue-500/10 text-blue-600 border border-blue-500/20"
                : "text-muted-foreground border border-transparent hover:border-border"
            )}
          >
            <Filter className="size-3" />
            {hasActiveFilters ? `筛选 (${localFilters.length})` : "筛选"}
          </button>

          {showDropdown === "filter" && (
            <div className="absolute top-full left-0 mt-1 w-56 bg-popover border rounded-md shadow-lg z-50 py-1 max-h-64 overflow-y-auto">
              {facets.map((facet) => (
                <div key={facet.field}>
                  <div className="px-2 py-1 text-[10px] font-semibold text-muted-foreground uppercase">
                    {facet.field}
                  </div>
                  {facet.values.slice(0, 8).map((value) => {
                    const isActive = localFilters.some(
                      (f) => f.field === facet.field && f.value === value
                    );
                    return (
                      <button
                        key={value}
                        onClick={() =>
                          isActive
                            ? removeFilter(facet.field, value)
                            : addFilter(facet.field, value)
                        }
                        className={cn(
                          "w-full text-left px-3 py-1 text-[11px] hover:bg-muted transition-colors flex items-center justify-between",
                          isActive && "bg-blue-500/5 text-blue-600"
                        )}
                      >
                        {value}
                        {isActive && <span className="text-blue-500">✓</span>}
                      </button>
                    );
                  })}
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Active filter chips */}
      {localFilters.map((filter) => (
        <span
          key={`${filter.field}:${filter.value}`}
          className="flex items-center gap-1 px-1.5 py-0.5 bg-blue-500/10 text-blue-600 rounded text-[11px] border border-blue-500/20"
        >
          <span className="text-blue-400">{filter.field}:</span>
          {filter.value}
          <button onClick={() => removeFilter(filter.field, filter.value)}>
            <X className="size-3 hover:text-blue-800" />
          </button>
        </span>
      ))}

      {/* Clear all */}
      {hasActiveFilters && (
        <button
          onClick={clearFilters}
          className="text-[10px] text-muted-foreground hover:text-foreground transition-colors"
        >
          清除全部
        </button>
      )}

      <div className="flex-1" />
    </div>
  );
}
