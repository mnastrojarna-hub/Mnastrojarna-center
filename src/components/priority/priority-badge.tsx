import * as React from "react";
import { cn } from "@/lib/utils";
import { priorityStyle, priorityTitle } from "./priority";

/**
 * Barevný štítek priority 1–5 („P1"). `manual` = nastavil člověk (plný), jinak z AI / pravidel (jemný).
 * Znovupoužitelné: pošta i Kniha zakázek.
 */
export function PriorityBadge({
  value, manual, by, size = "sm", showLabel, className,
}: {
  value: number;
  manual?: boolean;
  by?: string | null;
  size?: "xs" | "sm";
  /** Vedle „P1" i slovo („Nejvyšší"). */
  showLabel?: boolean;
  className?: string;
}) {
  const s = priorityStyle(value);
  return (
    <span
      className={cn(
        "inline-flex shrink-0 items-center gap-1 rounded-full border font-semibold tabular-nums",
        size === "xs" ? "px-1.5 text-[10px] leading-4" : "px-2 py-0.5 text-[11px]",
        manual ? s.solid : s.soft,
        className,
      )}
      title={priorityTitle(value, { manual, by })}
      aria-label={priorityTitle(value, { manual, by })}
      data-priority={s.value}
      data-testid="priority-badge"
    >
      {s.short}
      {showLabel && <span className="font-medium">{s.label}</span>}
    </span>
  );
}
