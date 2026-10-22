"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { Check, ChevronDown, Loader2, ArrowRight } from "lucide-react";
import {
  DropdownMenu, DropdownMenuTrigger, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel,
  DropdownMenuSeparator,
} from "@/components/ui/dropdown-menu";
import { StageBadge } from "@/components/jobs/stage-badge";
import { setJobStage } from "@/app/actions/jobs";
import { STAGE_ORDER, SIDE_STAGES, nextStage, stageMeta } from "@/lib/jobs/stages";
import type { JobStage } from "@/lib/supabase/database.types";
import { cn } from "@/lib/utils";

/** Tok zakázky včetně volitelných kroků (sklad, montáž) v pořadí knihy. */
const FLOW_STAGES: JobStage[] = STAGE_ORDER.filter((s) => !SIDE_STAGES.includes(s));

function StageRow({ stage, current }: { stage: JobStage; current: boolean }) {
  const m = stageMeta(stage);
  const Icon = m.icon;
  return (
    <>
      <span className={cn("flex h-7 w-7 shrink-0 items-center justify-center rounded-full", m.badge)}>
        <Icon className="!size-3.5 !text-current" />
      </span>
      <span className="min-w-0 flex-1">
        <span className={cn("block text-sm font-medium leading-tight", current && m.text)}>{m.label}</span>
        <span className="block truncate text-[11px] leading-tight text-muted-foreground">{m.description}</span>
      </span>
      {current && <Check className={cn("!size-4 shrink-0", m.text)} />}
    </>
  );
}

/**
 * Barevný výběr stavu zakázky. Změna se projeví hned (optimisticky),
 * při chybě se vrátí zpět a ukáže důvod.
 */
export function StageSelect({
  jobId,
  stage,
  onChanged,
  size = "md",
  disabled,
}: {
  jobId: string;
  stage: JobStage;
  onChanged?: (stage: JobStage) => void;
  size?: "sm" | "md";
  disabled?: boolean;
}) {
  const router = useRouter();
  const [current, setCurrent] = React.useState<JobStage>(stage);
  const [synced, setSynced] = React.useState<JobStage>(stage);
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  // nový stav ze serveru (router.refresh) přepíše lokální
  if (stage !== synced) {
    setSynced(stage);
    setCurrent(stage);
  }

  async function choose(next: JobStage) {
    if (next === current || busy) return;
    const prev = current;
    setCurrent(next);
    setError(null);
    setBusy(true);
    try {
      const res = await setJobStage(jobId, next);
      if (!res.ok) {
        setCurrent(prev);
        setError(res.error ?? "Stav se nepodařilo změnit.");
        return;
      }
      onChanged?.(next);
      router.refresh();
    } catch {
      setCurrent(prev);
      setError("Stav se nepodařilo změnit — zkus to znovu.");
    } finally {
      setBusy(false);
    }
  }

  const item = (s: JobStage) => (
    <DropdownMenuItem
      key={s}
      onSelect={() => void choose(s)}
      className={cn("items-center gap-2.5 py-1.5", s === current && "bg-accent/60")}
    >
      <StageRow stage={s} current={s === current} />
    </DropdownMenuItem>
  );

  return (
    <div className="inline-flex flex-col items-start gap-1">
      <DropdownMenu>
        <DropdownMenuTrigger asChild disabled={disabled || busy}>
          <button
            type="button"
            aria-label={`Stav zakázky: ${stageMeta(current).label} — změnit`}
            className={cn(
              "group inline-flex items-center gap-1 rounded-full outline-none transition focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1 disabled:cursor-not-allowed disabled:opacity-60",
              !disabled && "hover:brightness-95 active:scale-[0.98]",
            )}
          >
            <StageBadge stage={current} size={size === "sm" ? "sm" : "md"} className="pr-1.5" />
            <span className={cn("-ml-1 inline-flex items-center", stageMeta(current).text)}>
              {busy ? (
                <Loader2 className={cn("animate-spin", size === "sm" ? "h-3.5 w-3.5" : "h-4 w-4")} />
              ) : (
                <ChevronDown className={cn("transition-transform group-data-[state=open]:rotate-180", size === "sm" ? "h-3.5 w-3.5" : "h-4 w-4")} />
              )}
            </span>
          </button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start" className="max-h-[70vh] w-72 overflow-y-auto">
          <DropdownMenuLabel>Tok zakázky</DropdownMenuLabel>
          {FLOW_STAGES.map(item)}
          <DropdownMenuSeparator />
          <DropdownMenuLabel>Speciální stavy</DropdownMenuLabel>
          {SIDE_STAGES.map(item)}
        </DropdownMenuContent>
      </DropdownMenu>
      {error && (
        <p role="alert" className="max-w-xs text-xs text-red-600 dark:text-red-400">
          {error}
        </p>
      )}
    </div>
  );
}

/** Tlačítko „Posunout: další krok" v barvě cílového stavu. Bez dalšího kroku se nevykreslí. */
export function NextStageButton({
  jobId,
  stage,
  onChanged,
  className,
}: {
  jobId: string;
  stage: JobStage;
  onChanged?: (stage: JobStage) => void;
  className?: string;
}) {
  const router = useRouter();
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const target = nextStage(stage);
  if (!target) return null;
  const m = stageMeta(target);
  const Icon = m.icon;

  async function advance() {
    if (!target || busy) return;
    setBusy(true);
    setError(null);
    try {
      const res = await setJobStage(jobId, target);
      if (!res.ok) {
        setError(res.error ?? "Stav se nepodařilo změnit.");
        return;
      }
      onChanged?.(target);
      router.refresh();
    } catch {
      setError("Stav se nepodařilo změnit — zkus to znovu.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="inline-flex flex-col items-start gap-1">
      <button
        type="button"
        onClick={() => void advance()}
        disabled={busy}
        title={m.description}
        className={cn(
          "inline-flex h-9 items-center justify-center gap-2 whitespace-nowrap rounded-md px-4 text-sm font-medium shadow-sm transition",
          "hover:brightness-110 active:scale-[0.98] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1 disabled:pointer-events-none disabled:opacity-60",
          m.solid,
          className,
        )}
      >
        {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Icon className="h-4 w-4" />}
        Posunout: {m.label}
        <ArrowRight className="h-4 w-4" />
      </button>
      {error && (
        <p role="alert" className="max-w-xs text-xs text-red-600 dark:text-red-400">
          {error}
        </p>
      )}
    </div>
  );
}
