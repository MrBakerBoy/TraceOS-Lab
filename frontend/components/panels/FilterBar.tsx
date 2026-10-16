'use client';

import React, { useCallback } from 'react';
import { X } from 'lucide-react';
import { useWorkspaceStore } from '@/stores/workspace';
import type { FilterFacet, ActiveFilter } from '@/types/obs_context';

/**
 * FilterBar — Datadog-style filter chip bar for cross-panel event filtering.
 *
 * Design reference: Datadog Template Variables (Field:Value format active chips)
 * Usage: [syscall:read ×] [severity:error ×] [process:worker ×] [+]
 */
export default function FilterBar() {
  const obsContext = useWorkspaceStore((s) => s.obsContext);
  const activeFilters = useWorkspaceStore((s) => s.tierState.activeFilters);
  const setActiveFilters = useWorkspaceStore((s) => s.setActiveFilters);

  const facets: FilterFacet[] = obsContext?.filter_facets || defaultFacets();

  const addFilter = useCallback((field: string, value: string) => {
    const exists = activeFilters.find((f) => f.field === field && f.value === value);
    if (!exists) {
      setActiveFilters([...activeFilters, { field, value }]);
    }
  }, [activeFilters, setActiveFilters]);

  const removeFilter = useCallback((field: string, value: string) => {
    setActiveFilters(activeFilters.filter((f) => !(f.field === field && f.value === value)));
  }, [activeFilters, setActiveFilters]);

  const clearAll = useCallback(() => {
    setActiveFilters([]);
  }, [setActiveFilters]);

  return (
    <div className="filter-bar flex items-center gap-2 px-3 py-1.5 bg-muted/30 border-b text-xs">
      {/* Active filter chips */}
      {activeFilters.map((f) => (
        <span
          key={`${f.field}:${f.value}`}
          className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-primary/10 text-primary border border-primary/20"
        >
          <span className="text-[10px] text-muted-foreground">{f.field}:</span>
          {f.value}
          <button
            onClick={() => removeFilter(f.field, f.value)}
            className="ml-0.5 hover:text-red-500 transition-colors"
          >
            <X className="w-3 h-3" />
          </button>
        </span>
      ))}

      {/* Add filter dropdowns */}
      {facets.map((facet) => (
        <div key={facet.field} className="relative group">
          <button className="px-2 py-0.5 rounded hover:bg-muted transition-colors text-muted-foreground hover:text-foreground">
            + {facet.field}
          </button>
          <div className="absolute top-full left-0 mt-1 z-50 hidden group-hover:block bg-popover border rounded-md shadow-md min-w-[120px] max-h-48 overflow-y-auto">
            {facet.values.slice(0, 15).map((v) => {
              const isActive = activeFilters.some((f) => f.field === facet.field && f.value === v);
              return (
                <button
                  key={v}
                  onClick={() => isActive ? removeFilter(facet.field, v) : addFilter(facet.field, v)}
                  className={`w-full text-left px-3 py-1.5 text-xs hover:bg-muted transition-colors ${
                    isActive ? 'text-primary font-medium' : ''
                  }`}
                >
                  {v}
                </button>
              );
            })}
          </div>
        </div>
      ))}

      {/* Clear all */}
      {activeFilters.length > 0 && (
        <button
          onClick={clearAll}
          className="ml-auto px-2 py-0.5 text-muted-foreground hover:text-red-500 transition-colors"
        >
          清除全部
        </button>
      )}
    </div>
  );
}

function defaultFacets(): FilterFacet[] {
  return [
    { field: 'syscall', values: [] },
    { field: 'severity', values: ['info', 'warning', 'critical'] },
    { field: 'source', values: ['process', 'memory', 'lock', 'io'] },
  ];
}
