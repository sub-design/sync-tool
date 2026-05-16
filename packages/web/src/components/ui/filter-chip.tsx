"use client";

import * as React from "react";
import { cn } from "./utils";

// Context: group value (array) + toggle handler
const FilterChipGroupCtx = React.createContext<{
  value: string[];
  toggle: (v: string) => void;
} | null>(null);

// Context: per-chip active state + alert level
const FilterChipItemCtx = React.createContext<{
  isActive: boolean;
  alert?: "warning" | "error";
} | null>(null);

interface FilterChipGroupProps {
  value: string[];
  onValueChange: (value: string[]) => void;
  className?: string;
  children: React.ReactNode;
}

function FilterChipGroup({ value, onValueChange, className, children }: FilterChipGroupProps) {
  const toggle = React.useCallback(
    (chipValue: string) => {
      if (chipValue === "all" || value.includes(chipValue)) {
        onValueChange([]);
        return;
      }
      onValueChange([chipValue]);
    },
    [value, onValueChange],
  );

  return (
    <FilterChipGroupCtx.Provider value={{ value, toggle }}>
      <div className={cn("flex flex-wrap gap-1.5", className)}>{children}</div>
    </FilterChipGroupCtx.Provider>
  );
}

interface FilterChipProps {
  value: string;
  alert?: "warning" | "error";
  className?: string;
  children: React.ReactNode;
}

function FilterChip({ value, alert, className, children }: FilterChipProps) {
  const group = React.useContext(FilterChipGroupCtx);

  // "all" chip is active when nothing else is selected
  const isActive =
    value === "all"
      ? (group?.value.length ?? 0) === 0
      : (group?.value.includes(value) ?? false);

  return (
    <FilterChipItemCtx.Provider value={{ isActive, alert }}>
      <button
        type="button"
        onClick={() => group?.toggle(value)}
        className={cn(
          "inline-flex items-center gap-1.5 rounded-md px-2.5 py-1 text-[13px] font-normal transition-colors",
          isActive
            ? "bg-foreground text-background font-medium"
            : "bg-transparent text-muted-foreground ring-1 ring-border hover:text-foreground hover:ring-foreground/30",
          className,
        )}
      >
        {children}
      </button>
    </FilterChipItemCtx.Provider>
  );
}

interface FilterChipCountProps {
  className?: string;
  children: React.ReactNode;
}

function FilterChipCount({ className, children }: FilterChipCountProps) {
  const item = React.useContext(FilterChipItemCtx);
  const isActive = item?.isActive ?? false;

  return (
    <span
      className={cn(
        "inline-flex h-4 min-w-4 items-center justify-center rounded-sm px-1 text-[11px] font-semibold leading-none transition-colors",
        isActive
          ? "bg-background/20 text-background"
          : "bg-muted text-muted-foreground",
        className,
      )}
    >
      {children}
    </span>
  );
}

export { FilterChipGroup, FilterChip, FilterChipCount };
