"use client";

import * as React from "react";
import { SlidersHorizontal, X } from "lucide-react";
import { cn } from "./utils";
import { Popover, PopoverContent, PopoverTrigger } from "./popover";
import { Checkbox } from "./checkbox";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "./select";

export interface FilterDef {
  key: string;
  label: string;
  options: { value: string; label: string; count?: number }[];
}

interface FilterBarProps {
  filterDefs: FilterDef[];
  filterValues: Record<string, string[]>;
  onFilterChange: (key: string, values: string[]) => void;
  onClearAll?: () => void;
  activeFiltersPlacement?: "inline" | "below";
  sortOptions?: { value: string; label: string }[];
  sortValue?: string;
  onSortChange?: (value: string) => void;
  className?: string;
  triggerClassName?: string;
}

export function FilterBar({
  filterDefs,
  filterValues,
  onFilterChange,
  onClearAll,
  activeFiltersPlacement = "inline",
  sortOptions,
  sortValue,
  onSortChange,
  className,
  triggerClassName,
}: FilterBarProps) {
  const [open, setOpen] = React.useState(false);

  const activeFilters: { key: string; defLabel: string; value: string; label: string }[] = [];
  for (const def of filterDefs) {
    const selected = filterValues[def.key] ?? [];
    for (const v of selected) {
      const opt = def.options.find((o) => o.value === v);
      if (opt) activeFilters.push({ key: def.key, defLabel: def.label, value: v, label: opt.label });
    }
  }

  const hasActiveFilters = activeFilters.length > 0;

  function removeFilter(key: string, value: string) {
    const current = filterValues[key] ?? [];
    onFilterChange(key, current.filter((v) => v !== value));
  }

  function clearAll() {
    if (onClearAll) {
      onClearAll();
      return;
    }
    for (const def of filterDefs) {
      onFilterChange(def.key, []);
    }
  }

  function toggleOption(key: string, value: string) {
    const current = filterValues[key] ?? [];
    const next = current.includes(value)
      ? current.filter((v) => v !== value)
      : [...current, value];
    onFilterChange(key, next);
  }

  const showActiveFiltersBelow = activeFiltersPlacement === "below";

  return (
    <div className={cn(showActiveFiltersBelow ? "contents" : "flex items-center gap-2 flex-wrap", className)}>
      {/* + Filter button */}
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger asChild>
          <button
            type="button"
            className={cn(
              "inline-flex items-center gap-1.5 rounded-md px-2.5 py-1 text-[13px] transition-colors ring-1",
              hasActiveFilters
                ? "ring-foreground/40 text-foreground font-medium"
                : "ring-border text-muted-foreground hover:text-foreground hover:ring-foreground/30",
              triggerClassName,
            )}
          >
            <SlidersHorizontal className="w-3.5 h-3.5" />
            Filter
            {hasActiveFilters && (
              <span className="inline-flex h-4 min-w-4 items-center justify-center rounded-sm bg-foreground px-1 text-[11px] font-semibold text-background leading-none">
                {activeFilters.length}
              </span>
            )}
          </button>
        </PopoverTrigger>
        <PopoverContent align="start" className="w-64 p-3">
          <div className="space-y-4">
            {filterDefs.map((def) => (
              <div key={def.key}>
                <p className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground mb-2">
                  {def.label}
                </p>
                <div className="space-y-1">
                  {def.options.map((opt) => {
                    const checked = (filterValues[def.key] ?? []).includes(opt.value);
                    return (
                      <label
                        key={opt.value}
                        className="flex items-center gap-2 rounded px-1 py-0.5 text-sm cursor-pointer hover:bg-muted"
                      >
                        <Checkbox
                          checked={checked}
                          onCheckedChange={() => toggleOption(def.key, opt.value)}
                        />
                        <span className="flex-1">{opt.label}</span>
                        {opt.count !== undefined && (
                          <span className="text-[11px] text-muted-foreground">{opt.count}</span>
                        )}
                      </label>
                    );
                  })}
                </div>
              </div>
            ))}
          </div>
        </PopoverContent>
      </Popover>

      {/* Active filter chips */}
      {hasActiveFilters && (
        <div className={cn(showActiveFiltersBelow ? "basis-full flex items-center gap-2 flex-wrap pt-1" : "contents")}>
          {activeFilters.map((f) => (
            <span
              key={`${f.key}-${f.value}`}
              className="inline-flex items-center gap-1 rounded-md px-2 py-1 text-[13px] bg-muted text-foreground"
            >
              <span className="text-muted-foreground text-[12px]">{f.defLabel}:</span>
              {f.label}
              <button
                type="button"
                onClick={() => removeFilter(f.key, f.value)}
                className="ml-0.5 rounded hover:bg-foreground/10"
                aria-label={`Remove ${f.label} filter`}
              >
                <X className="w-3 h-3" />
              </button>
            </span>
          ))}

          <button
            type="button"
            onClick={clearAll}
            className="text-[13px] text-muted-foreground hover:text-foreground underline-offset-2 hover:underline"
          >
            Clear
          </button>
        </div>
      )}

      {/* Sort */}
      {sortOptions && sortOptions.length > 0 && (
        <div className="ml-auto">
          <Select value={sortValue} onValueChange={onSortChange}>
            <SelectTrigger className="h-7 text-[13px] gap-1 px-2.5 ring-1 ring-border rounded-md shadow-none border-0 bg-transparent [&>svg]:w-3.5 [&>svg]:h-3.5">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {sortOptions.map((opt) => (
                <SelectItem key={opt.value} value={opt.value} className="text-[13px]">
                  {opt.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      )}
    </div>
  );
}
