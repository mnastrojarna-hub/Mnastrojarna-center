"use client";

import * as React from "react";
import { Ellipsis } from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { FLOW_ACTIONS, FLOW_EXCEPTION_KEYS, type FlowActionKey } from "@/lib/jobs/flow-status";

/**
 * Menu „⋯" z menuActions(): bezpečné akce nahoře, destruktivní červeně dole, „Korekce stavu…"
 * úplně na konci. Výběr předá onAction (dialog / přímou akci řeší rodič).
 */
export function StateMenu({
  actions, onAction, label = "Další akce", disabled, align = "end", className, triggerClassName,
}: {
  actions: FlowActionKey[];
  onAction: (key: FlowActionKey) => void;
  label?: string;
  disabled?: boolean;
  align?: "start" | "center" | "end";
  className?: string;
  triggerClassName?: string;
}) {
  if (!actions.length) return null;
  // výjimky v toku („Co se stalo?") jako první skupina — jedno srozumitelné tlačítko pro to, co se stalo
  const exceptions = actions.filter((k) => FLOW_EXCEPTION_KEYS.includes(k));
  const rest = actions.filter((k) => !FLOW_EXCEPTION_KEYS.includes(k));
  const safe = rest.filter((k) => FLOW_ACTIONS[k].intent !== "danger" && k !== "job.correct");
  const danger = rest.filter((k) => FLOW_ACTIONS[k].intent === "danger");
  const correct = rest.includes("job.correct");
  const item = (k: FlowActionKey) => {
    const a = FLOW_ACTIONS[k];
    const Icon = a.icon;
    return (
      <DropdownMenuItem
        key={k}
        onSelect={() => onAction(k)}
        className={cn("min-h-10", a.intent === "danger" && "text-red-600 focus:text-red-700 dark:text-red-400 [&_svg]:text-red-600 dark:[&_svg]:text-red-400")}
      >
        <Icon aria-hidden />
        {a.label}
      </DropdownMenuItem>
    );
  };
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild disabled={disabled}>
        <Button variant="outline" size="icon" className={cn("h-11 w-11 sm:h-9 sm:w-9", triggerClassName)} aria-label={label}>
          <Ellipsis aria-hidden />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align={align} className={cn("max-h-[min(75vh,var(--radix-dropdown-menu-content-available-height))] w-64 max-w-[calc(100vw-2rem)] overflow-y-auto", className)}>
        {exceptions.length > 0 && (
          <DropdownMenuLabel className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">Co se stalo?</DropdownMenuLabel>
        )}
        {exceptions.map(item)}
        {exceptions.length > 0 && (safe.length > 0 || danger.length > 0 || correct) && <DropdownMenuSeparator />}
        {safe.map(item)}
        {danger.length > 0 && safe.length > 0 && <DropdownMenuSeparator />}
        {danger.map(item)}
        {correct && (safe.length > 0 || danger.length > 0) && <DropdownMenuSeparator />}
        {correct && item("job.correct")}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
