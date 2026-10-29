"use client";

import * as React from "react";
import { Check, RotateCcw } from "lucide-react";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { cn } from "@/lib/utils";
import { PRIORITY_STYLE, PRIORITY_VALUES, priorityStyle, type PriorityValue } from "./priority";
import { PriorityBadge } from "./priority-badge";

/**
 * Výběr priority 1–5 jedním ťuknutím: na štítek → nabídka 1–5 (barvy), „Zpět na AI" (je-li ruční).
 * `inline` = pět tlačítek vedle sebe (detail, filtr). Volající uloží (onChange) a ukáže chybu.
 */
export function PrioritySelect({
  value, manual, by, onChange, disabled, inline, allowReset = true, label = "Priorita", className,
}: {
  value: number;
  manual?: boolean;
  by?: string | null;
  onChange: (v: PriorityValue | null) => void;
  disabled?: boolean;
  inline?: boolean;
  allowReset?: boolean;
  label?: string;
  className?: string;
}) {
  const cur = priorityStyle(value).value;
  if (inline) {
    return (
      <div role="radiogroup" aria-label={label} className={cn("inline-flex items-center gap-1", className)} data-testid="priority-inline">
        {PRIORITY_VALUES.map((v) => {
          const s = PRIORITY_STYLE[v];
          const on = v === cur;
          return (
            <button
              key={v}
              type="button"
              role="radio"
              aria-checked={on}
              aria-label={`Priorita ${v} – ${s.label}`}
              title={`Priorita ${v} – ${s.label}`}
              disabled={disabled}
              onClick={() => onChange(v)}
              className={cn(
                "h-8 min-w-8 rounded-full border px-2 text-xs font-bold tabular-nums transition-all disabled:opacity-50",
                on ? cn(s.solid, manual ? "ring-2 ring-offset-1 ring-offset-background" : "opacity-90") : cn(s.soft, "hover:brightness-95"),
              )}
            >
              {v}
            </button>
          );
        })}
        {allowReset && manual && (
          <button type="button" disabled={disabled} onClick={() => onChange(null)} className="ml-1 inline-flex h-8 items-center gap-1 rounded-full px-2 text-xs text-muted-foreground hover:bg-accent" title="Zpět na prioritu z AI">
            <RotateCcw className="h-3.5 w-3.5" /> AI
          </button>
        )}
      </div>
    );
  }
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild disabled={disabled}>
        <button type="button" className={cn("inline-flex min-h-8 items-center rounded-full focus:outline-none focus-visible:ring-2 focus-visible:ring-ring", className)} aria-label={`${label}: ${cur} – ${PRIORITY_STYLE[cur].label}. Změnit`} data-testid="priority-select">
          <PriorityBadge value={cur} manual={manual} by={by} />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="min-w-[11rem]">
        <DropdownMenuLabel className="text-xs text-muted-foreground">{label} (1 = nejvyšší)</DropdownMenuLabel>
        {PRIORITY_VALUES.map((v) => {
          const s = PRIORITY_STYLE[v];
          return (
            <DropdownMenuItem key={v} onSelect={() => onChange(v)} data-testid={`priority-option-${v}`}>
              <span className={cn("h-2.5 w-2.5 rounded-full", s.dot)} aria-hidden />
              <span className="font-semibold tabular-nums">{v}</span>
              <span>{s.label}</span>
              {v === cur && <Check className="ml-auto" />}
            </DropdownMenuItem>
          );
        })}
        {allowReset && manual && (
          <>
            <DropdownMenuSeparator />
            <DropdownMenuItem onSelect={() => onChange(null)}>
              <RotateCcw /> Zpět na prioritu z AI
            </DropdownMenuItem>
          </>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
