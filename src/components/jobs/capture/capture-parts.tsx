"use client";

import * as React from "react";
import { Sparkles, Lock } from "lucide-react";
import { cn } from "@/lib/utils";

/** Barevné dlaždice ikon sekcí (stejná paleta jako formulář zakázky). */
export const TONES = {
  rose: "bg-rose-100 text-rose-600 dark:bg-rose-500/15 dark:text-rose-300",
  fuchsia: "bg-fuchsia-100 text-fuchsia-600 dark:bg-fuchsia-500/15 dark:text-fuchsia-300",
  orange: "bg-orange-100 text-orange-600 dark:bg-orange-500/15 dark:text-orange-300",
  sky: "bg-sky-100 text-sky-600 dark:bg-sky-500/15 dark:text-sky-300",
  violet: "bg-violet-100 text-violet-600 dark:bg-violet-500/15 dark:text-violet-300",
  amber: "bg-amber-100 text-amber-600 dark:bg-amber-500/15 dark:text-amber-300",
  emerald: "bg-emerald-100 text-emerald-600 dark:bg-emerald-500/15 dark:text-emerald-300",
  teal: "bg-teal-100 text-teal-600 dark:bg-teal-500/15 dark:text-teal-300",
  lime: "bg-lime-100 text-lime-700 dark:bg-lime-500/15 dark:text-lime-300",
  blue: "bg-blue-100 text-blue-600 dark:bg-blue-500/15 dark:text-blue-300",
  slate: "bg-slate-100 text-slate-600 dark:bg-slate-500/20 dark:text-slate-300",
} as const;

export type Tone = keyof typeof TONES;

/** Pole vyplněné AI (✨ + fuchsiový nádech) — člověk má hlavně tohle zkontrolovat. */
export const AI_FIELD = "border-fuchsia-300 bg-fuchsia-50/70 focus-visible:ring-fuchsia-400 dark:border-fuchsia-500/40 dark:bg-fuchsia-500/10";
/** Údaj, který zakázka už má (nepřepisuje se). */
export const LOCKED_FIELD = "cursor-not-allowed border-dashed bg-muted/60 text-muted-foreground";

export function Section({
  icon: Icon,
  tone,
  title,
  hint,
  action,
  children,
  className,
  id,
}: {
  icon: React.ComponentType<{ className?: string }>;
  tone: Tone;
  title: string;
  hint?: React.ReactNode;
  action?: React.ReactNode;
  children: React.ReactNode;
  className?: string;
  id?: string;
}) {
  return (
    <section id={id} className={cn("rounded-2xl border bg-card p-3 shadow-sm sm:p-4", className)}>
      <div className="mb-3 flex items-start gap-2.5">
        <span className={cn("flex h-8 w-8 shrink-0 items-center justify-center rounded-lg", TONES[tone])}>
          <Icon className="h-4 w-4" />
        </span>
        <div className="min-w-0 flex-1">
          <h3 className="text-sm font-semibold leading-tight">{title}</h3>
          {hint && <p className="mt-0.5 text-xs text-muted-foreground">{hint}</p>}
        </div>
        {action}
      </div>
      {children}
    </section>
  );
}

export function AiMark({ className, label = "vyplnila AI" }: { className?: string; label?: string }) {
  return (
    <span
      title="Vyplnila AI — zkontroluj"
      className={cn("inline-flex items-center gap-0.5 text-[10px] font-medium text-fuchsia-600 dark:text-fuchsia-400", className)}
    >
      <Sparkles className="h-3 w-3" />
      <span className="sr-only sm:not-sr-only">{label}</span>
    </span>
  );
}

export function LockedMark({ className }: { className?: string }) {
  return (
    <span title="Zakázka už tento údaj má — nepřepisuje se" className={cn("inline-flex items-center gap-0.5 text-[10px] text-muted-foreground", className)}>
      <Lock className="h-3 w-3" />
      <span className="sr-only sm:not-sr-only">už v zakázce</span>
    </span>
  );
}

/** Jistota AI jako barevný proužek (zelená ≥ 85 %, oranžová ≥ 60 %, jinak červená). */
export function ConfidenceMeter({ value, className }: { value: number; className?: string }) {
  const pct = Math.round(Math.min(1, Math.max(0, value)) * 100);
  const tone = pct >= 85 ? "bg-emerald-500" : pct >= 60 ? "bg-amber-500" : "bg-red-500";
  const text = pct >= 85 ? "text-emerald-700 dark:text-emerald-400" : pct >= 60 ? "text-amber-700 dark:text-amber-400" : "text-red-700 dark:text-red-400";
  const label = pct >= 85 ? "jistá" : pct >= 60 ? "spíš jistá" : "nejistá";
  return (
    <div className={cn("flex items-center gap-2", className)} title={`Jistota AI ${pct} %`}>
      <div className="h-2 w-24 overflow-hidden rounded-full bg-muted" role="meter" aria-valuenow={pct} aria-valuemin={0} aria-valuemax={100} aria-label="Jistota AI">
        <div className={cn("h-full rounded-full transition-all", tone)} style={{ width: `${pct}%` }} />
      </div>
      <span className={cn("text-xs font-semibold tabular-nums", text)}>{pct} %</span>
      <span className="text-xs text-muted-foreground">{label}</span>
    </div>
  );
}

/** Skóre shody zakázky jako barevná pilulka. */
export function ScorePill({ score }: { score: number }) {
  const s = Math.max(0, Math.min(100, Math.round(score)));
  const tone = s >= 90 ? TONES.emerald : s >= 60 ? TONES.sky : TONES.slate;
  return <span className={cn("shrink-0 rounded-full px-2 py-0.5 text-[10px] font-semibold tabular-nums", tone)}>shoda {s} %</span>;
}

export function FieldLabel({ htmlFor, children, extra }: { htmlFor: string; children: React.ReactNode; extra?: React.ReactNode }) {
  return (
    <label htmlFor={htmlFor} className="mb-1 flex items-center justify-between gap-2 text-xs font-medium text-muted-foreground">
      <span className="truncate">{children}</span>
      {extra}
    </label>
  );
}

/** Segmentový přepínač (zákazník: existující / nový / bez). */
export function Segmented<T extends string>({
  value,
  options,
  onChange,
  className,
}: {
  value: T;
  options: { value: T; label: string; icon?: React.ComponentType<{ className?: string }> }[];
  onChange: (v: T) => void;
  className?: string;
}) {
  return (
    <div role="radiogroup" className={cn("inline-flex w-full rounded-lg bg-muted p-0.5 sm:w-auto", className)}>
      {options.map((o) => {
        const on = o.value === value;
        const Icon = o.icon;
        return (
          <button
            key={o.value}
            type="button"
            role="radio"
            aria-checked={on}
            onClick={() => onChange(o.value)}
            className={cn(
              "flex flex-1 items-center justify-center gap-1.5 whitespace-nowrap rounded-md px-3 py-1.5 text-xs font-medium transition sm:flex-none",
              on ? "bg-background text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground",
            )}
          >
            {Icon && <Icon className="h-3.5 w-3.5" />}
            {o.label}
          </button>
        );
      })}
    </div>
  );
}
