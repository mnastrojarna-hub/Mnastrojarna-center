import Link from "next/link";
import { ArrowRight, Cog, Sparkles, UserRoundCheck, Users } from "lucide-react";
import { CHIP_BASE, CHIP_ICON, FLOW_PALETTE, relativeStampTime, stateMeta, type FlowPhase } from "@/lib/jobs/flow-status";
import { cn } from "@/lib/utils";
import type { MoverGroup } from "./flow-overview-model";

export interface FlowTile {
  key: string;
  label: string;
  href: string;
}


/**
 * Podrobné stavy toku s počty (co čeká na koho) — barvy a ikony z jednotné palety, ťuknutím
 * rovnou na stránku toku s filtrem. Nulové stavy se neukazují (bez šumu).
 */
export function FlowStateTiles({ tiles, counts }: { tiles: FlowTile[]; counts: Record<string, number> }) {
  const shown = tiles
    .map((t) => {
      const [phase, key] = t.key.split(".");
      return { ...t, n: counts[t.key] ?? 0, meta: stateMeta(phase as FlowPhase, key) };
    })
    .filter((t) => t.n > 0 && t.meta);
  if (!shown.length) return null;
  return (
    <section aria-label="Podrobné stavy toku" className="rounded-2xl border bg-card p-4 shadow-sm">
      <h2 className="mb-2 text-base font-semibold">Co čeká v toku</h2>
      <div className="-mx-1 flex gap-1.5 overflow-x-auto px-1 pb-1 sm:flex-wrap sm:overflow-visible">
        {shown.map((t) => {
          const Icon = t.meta!.icon;
          return (
            <Link
              key={t.key}
              href={t.href}
              className={cn(CHIP_BASE, FLOW_PALETTE[t.meta!.palette].badge, "min-h-9 shrink-0 px-3 text-sm transition hover:opacity-90")}
            >
              <Icon className={CHIP_ICON} aria-hidden />
              {t.label}
              <b className="ml-0.5 tabular-nums">{t.n}</b>
            </Link>
          );
        })}
      </div>
    </section>
  );
}

const KIND_ICON = { user: UserRoundCheck, ai: Sparkles, system: Cog } as const;
const KIND_TONE = {
  user: "bg-sky-100 text-sky-700 dark:bg-sky-500/15 dark:text-sky-300",
  ai: "bg-violet-100 text-violet-700 dark:bg-violet-500/15 dark:text-violet-300",
  system: "bg-zinc-100 text-zinc-600 dark:bg-zinc-500/15 dark:text-zinc-300",
} as const;

/** „Co kdo dnes posunul": počty změn stavů podle účtu (i AI a automatiky), poslední posuny se zakázkou. */
export function MoversPanel({ movers, total, now }: { movers: MoverGroup[]; total: number; now?: Date }) {
  return (
    <section aria-label="Co kdo dnes posunul" className="rounded-2xl border bg-card p-4 shadow-sm">
      <div className="mb-3 flex items-start gap-2.5">
        <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-teal-100 text-teal-700 dark:bg-teal-500/15 dark:text-teal-300">
          <Users className="h-4 w-4" aria-hidden />
        </span>
        <div className="min-w-0 flex-1">
          <h2 className="truncate text-base font-semibold leading-8">Co kdo dnes posunul</h2>
          <p className="-mt-1 text-xs text-muted-foreground">{total ? `${total} změn stavů dnes` : "Dnes zatím žádná změna stavu."}</p>
        </div>
      </div>
      {movers.length > 0 && (
        <ul className="space-y-2">
          {movers.map((m) => {
            const Icon = KIND_ICON[m.kind];
            return (
              <li key={m.key}>
                <details className="group rounded-xl border">
                  <summary className="flex min-h-11 cursor-pointer list-none items-center gap-2.5 px-3 py-2">
                    <span className={cn("flex h-7 w-7 shrink-0 items-center justify-center rounded-md", KIND_TONE[m.kind])} aria-hidden>
                      <Icon className="h-3.5 w-3.5" />
                    </span>
                    <span className="min-w-0 flex-1 truncate text-sm font-medium">{m.name}</span>
                    <span className="rounded-full bg-muted px-2 py-0.5 text-xs font-semibold tabular-nums">{m.count}</span>
                    <ArrowRight className="h-3.5 w-3.5 text-muted-foreground transition-transform group-open:rotate-90" aria-hidden />
                  </summary>
                  <ul className="space-y-1 border-t px-3 py-2">
                    {m.items.map((it, i) => (
                      <li key={`${it.jobId}-${i}`} className="text-xs">
                        <Link href={`/orders/${it.jobId}?tab=historie`} className="group/i flex min-w-0 items-baseline gap-2 hover:text-primary">
                          {it.jobNumber && <span className="shrink-0 font-mono font-semibold">{it.jobNumber}</span>}
                          <span className="min-w-0 flex-1 truncate text-muted-foreground group-hover/i:text-primary">{it.message}</span>
                          <span className="shrink-0 tabular-nums text-[11px] text-muted-foreground">{relativeStampTime(it.at, now)}</span>
                        </Link>
                      </li>
                    ))}
                  </ul>
                </details>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
