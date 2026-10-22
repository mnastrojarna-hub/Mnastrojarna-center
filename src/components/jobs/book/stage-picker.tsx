"use client";

import * as React from "react";
import { Check, ChevronDown } from "lucide-react";
import {
  DropdownMenu, DropdownMenuTrigger, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel,
  DropdownMenuSeparator,
} from "@/components/ui/dropdown-menu";
import { StageBadge } from "@/components/jobs/stage-badge";
import { STAGE_ORDER, SIDE_STAGES, stageMeta } from "@/lib/jobs/stages";
import type { JobStage } from "@/lib/supabase/database.types";
import { cn } from "@/lib/utils";

/**
 * Barevný výběr stavu bez zápisu do DB (formulář nové zakázky, ruční vyplnění
 * dokladu). Zapisující varianta pro existující zakázku je StageSelect.
 */
export function StagePicker({
  value,
  onChange,
  id,
  stages,
  disabled,
  className,
}: {
  value: JobStage;
  onChange: (stage: JobStage) => void;
  id?: string;
  /** Omezení nabídky (výchozí = všechny stavy). */
  stages?: JobStage[];
  disabled?: boolean;
  className?: string;
}) {
  const list = stages?.length ? STAGE_ORDER.filter((s) => stages.includes(s)) : STAGE_ORDER;
  const flow = list.filter((s) => !SIDE_STAGES.includes(s));
  const side = list.filter((s) => SIDE_STAGES.includes(s));
  const current = stageMeta(value);

  const item = (s: JobStage) => {
    const m = stageMeta(s);
    const Icon = m.icon;
    const on = s === value;
    return (
      <DropdownMenuItem key={s} onSelect={() => onChange(s)} className={cn("items-center gap-2.5 py-1.5", on && "bg-accent/60")}>
        <span className={cn("flex h-7 w-7 shrink-0 items-center justify-center rounded-full", m.badge)}>
          <Icon className="!size-3.5 !text-current" />
        </span>
        <span className="min-w-0 flex-1">
          <span className={cn("block text-sm font-medium leading-tight", on && m.text)}>{m.label}</span>
          <span className="block truncate text-[11px] leading-tight text-muted-foreground">{m.description}</span>
        </span>
        {on && <Check className={cn("!size-4 shrink-0", m.text)} />}
      </DropdownMenuItem>
    );
  };

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild disabled={disabled}>
        <button
          id={id}
          type="button"
          aria-label={`Stav: ${current.label} — změnit`}
          className={cn(
            "group flex h-9 w-full items-center justify-between gap-2 rounded-md border border-input bg-background px-2 text-left shadow-sm transition-colors",
            "hover:bg-accent/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1 disabled:cursor-not-allowed disabled:opacity-50",
            className,
          )}
        >
          <StageBadge stage={value} />
          <ChevronDown className="h-4 w-4 shrink-0 text-muted-foreground transition-transform group-data-[state=open]:rotate-180" />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="max-h-[60vh] w-72 overflow-y-auto">
        {flow.length > 0 && <DropdownMenuLabel>Tok zakázky</DropdownMenuLabel>}
        {flow.map(item)}
        {flow.length > 0 && side.length > 0 && <DropdownMenuSeparator />}
        {side.length > 0 && <DropdownMenuLabel>Speciální stavy</DropdownMenuLabel>}
        {side.map(item)}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
