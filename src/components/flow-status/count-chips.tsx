"use client";

import * as React from "react";
import { ChevronDown } from "lucide-react";
import { cn } from "@/lib/utils";
import {
  DropdownMenu, DropdownMenuCheckboxItem, DropdownMenuContent, DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { FLOW_PALETTE, type FlowPhase, type PaletteKey } from "@/lib/jobs/flow-status";

export interface CountChip {
  key: string;
  phase: FlowPhase;
  label: string;
  count: number;
  palette: PaletteKey;
  open: boolean;
}

/**
 * Výběr po ťuknutí na chip: z výchozího „Otevřené" (všechny otevřené) jedno ťuknutí ukáže
 * jen ten stav; jinak chip přidá / odebere (víc stavů najednou).
 */
export function nextChipSelection(selected: readonly string[], key: string, openKeys: readonly string[]): string[] {
  const isOpenPreset = openKeys.length > 1 && selected.length === openKeys.length && openKeys.every((k) => selected.includes(k));
  if (isOpenPreset && openKeys.includes(key)) return [key];
  return selected.includes(key) ? selected.filter((k) => k !== key) : [...selected, key];
}

/**
 * Chipy dílčích stavů s počty (chipsForTab) — vodorovně posuvné, na mobilu přilepené nahoře.
 * Otevřené stavy vždy viditelné, uzavřené sbalené v „Více ▾". Výběr je víc chipů najednou;
 * „Otevřené" = výchozí výběr všech otevřených.
 */
export function CountChips({
  chips, selected, onChange, sticky = true, showOpenPreset = true, className, label = "Filtr podle stavu",
}: {
  chips: CountChip[];
  selected: string[];
  onChange: (keys: string[]) => void;
  sticky?: boolean;
  showOpenPreset?: boolean;
  className?: string;
  label?: string;
}) {
  const open = chips.filter((c) => c.open);
  const closed = chips.filter((c) => !c.open);
  const openKeys = open.map((c) => c.key);
  const isOpenPreset = selected.length === openKeys.length && openKeys.every((k) => selected.includes(k));
  const toggle = (key: string) => onChange(nextChipSelection(selected, key, openKeys));
  const closedSelected = closed.filter((c) => selected.includes(c.key));

  const chipClass = (active: boolean, palette: PaletteKey) => cn(
    "inline-flex min-h-9 shrink-0 items-center gap-1.5 rounded-full px-3 text-xs font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
    active ? FLOW_PALETTE[palette].solid : "border border-border bg-background text-foreground hover:bg-accent",
  );

  return (
    <div
      role="group"
      aria-label={label}
      className={cn(
        "-mx-4 flex gap-2 overflow-x-auto px-4 py-2 [scrollbar-width:none] sm:mx-0 sm:flex-wrap sm:overflow-visible sm:px-0",
        sticky && "sticky top-0 z-20 bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/80 sm:static sm:bg-transparent sm:backdrop-blur-none",
        className,
      )}
    >
      {showOpenPreset && open.length > 1 && (
        <button type="button" aria-pressed={isOpenPreset} onClick={() => onChange(openKeys)} className={chipClass(isOpenPreset, "ghost.proposal")}>
          Otevřené
          <span className="tabular-nums opacity-80">{open.reduce((s, c) => s + c.count, 0)}</span>
        </button>
      )}
      {open.map((c) => {
        // ve výchozím „Otevřené" jsou členské chipy obrysové (aktivní je jen preset); prázdné ztlumené
        const active = selected.includes(c.key) && !(showOpenPreset && open.length > 1 && isOpenPreset);
        return (
          <button
            key={c.key}
            type="button"
            aria-pressed={active}
            onClick={() => toggle(c.key)}
            className={cn(chipClass(active, c.palette), !active && c.count === 0 && "text-muted-foreground opacity-70")}
          >
            {!active && <span className={cn("size-2 rounded-full", FLOW_PALETTE[c.palette].dot)} aria-hidden />}
            {c.label}
            <span className="tabular-nums opacity-80">{c.count}</span>
          </button>
        );
      })}
      {closed.length > 0 && (
        <DropdownMenu>
          <DropdownMenuTrigger className={chipClass(closedSelected.length > 0, closedSelected[0]?.palette ?? "muted.archive")}>
            {closedSelected.length ? closedSelected.map((c) => c.label).join(", ") : "Více"}
            <ChevronDown className="size-3.5" aria-hidden />
          </DropdownMenuTrigger>
          <DropdownMenuContent align="start">
            {closed.map((c) => (
              <DropdownMenuCheckboxItem
                key={c.key}
                checked={selected.includes(c.key)}
                onCheckedChange={() => toggle(c.key)}
                onSelect={(e) => e.preventDefault()}
                className="min-h-10"
              >
                <span className={cn("mr-2 size-2 rounded-full", FLOW_PALETTE[c.palette].dot)} aria-hidden />
                <span className="flex-1">{c.label}</span>
                <span className="ml-3 tabular-nums text-muted-foreground">{c.count}</span>
              </DropdownMenuCheckboxItem>
            ))}
          </DropdownMenuContent>
        </DropdownMenu>
      )}
    </div>
  );
}
