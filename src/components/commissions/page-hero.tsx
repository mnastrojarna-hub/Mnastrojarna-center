import type { LucideIcon } from "lucide-react";
import { cn } from "@/lib/utils";

const TONES = {
  emerald: {
    header: "border-emerald-200/80 bg-gradient-to-br from-emerald-50 via-card to-card dark:border-emerald-500/25 dark:from-emerald-500/10",
    tile: "bg-emerald-600 text-white shadow-emerald-600/30",
    count: "bg-emerald-100 text-emerald-800 dark:bg-emerald-500/20 dark:text-emerald-200",
    glow: "bg-emerald-400/20",
  },
  lime: {
    header: "border-lime-200/80 bg-gradient-to-br from-lime-50 via-card to-card dark:border-lime-500/25 dark:from-lime-500/10",
    tile: "bg-lime-600 text-white shadow-lime-600/30",
    count: "bg-lime-100 text-lime-800 dark:bg-lime-500/20 dark:text-lime-200",
    glow: "bg-lime-400/20",
  },
} as const;

/** Barevná hlavička stránky (provize, objednávky dodavatelům) — dlaždice, popis, akce. */
export function PageHero({
  tone, icon: Icon, title, description, count, actions, children,
}: {
  tone: keyof typeof TONES;
  icon: LucideIcon;
  title: string;
  description: React.ReactNode;
  count?: number;
  actions?: React.ReactNode;
  children?: React.ReactNode;
}) {
  const t = TONES[tone];
  return (
    <section className={cn("relative overflow-hidden rounded-2xl border p-4 shadow-sm sm:p-5", t.header)}>
      <span aria-hidden className={cn("pointer-events-none absolute -right-16 -top-20 h-52 w-52 rounded-full blur-3xl", t.glow)} />
      <div className="relative flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
        <div className="flex min-w-0 items-start gap-3">
          <span className={cn("flex h-11 w-11 shrink-0 items-center justify-center rounded-xl shadow-md sm:h-12 sm:w-12", t.tile)}>
            <Icon className="h-6 w-6" />
          </span>
          <div className="min-w-0 space-y-1">
            <div className="flex flex-wrap items-center gap-2">
              <h1 className="text-xl font-semibold tracking-tight sm:text-2xl">{title}</h1>
              {count !== undefined && (
                <span className={cn("rounded-full px-2.5 py-0.5 text-xs font-semibold tabular-nums", t.count)}>{count}</span>
              )}
            </div>
            <div className="max-w-2xl text-sm leading-relaxed text-muted-foreground">{description}</div>
          </div>
        </div>
        {actions && <div className="flex flex-wrap items-center gap-2 lg:shrink-0 lg:justify-end">{actions}</div>}
      </div>
      {children && <div className="relative mt-4">{children}</div>}
    </section>
  );
}
