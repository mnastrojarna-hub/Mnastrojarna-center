import Link from "next/link";
import { ArrowUpRight, Cog, ScrollText, Sparkles, Trash2, UserRoundCheck } from "lucide-react";
import { ActorStamp } from "@/components/flow-status/actor-stamp";
import { cn } from "@/lib/utils";
import { diffLines, type AuditEntry } from "./audit-model";

const KIND_TONE = {
  user: "bg-sky-100 text-sky-700 dark:bg-sky-500/15 dark:text-sky-300",
  ai: "bg-violet-100 text-violet-700 dark:bg-violet-500/15 dark:text-violet-300",
  system: "bg-zinc-100 text-zinc-600 dark:bg-zinc-500/15 dark:text-zinc-300",
} as const;

function when(at: string): string {
  return new Intl.DateTimeFormat("cs-CZ", { timeZone: "Europe/Prague", dateStyle: "medium", timeStyle: "short" }).format(new Date(at));
}

/** Seznam záznamů auditu: kdy, kdo (vždy jméno — i u smazaného účtu), co, objekt, rozdíl po ťuknutí. */
export function AuditList({ entries, now }: { entries: AuditEntry[]; now?: Date }) {
  if (!entries.length) {
    return (
      <div className="flex flex-col items-center gap-2 rounded-2xl border border-dashed px-4 py-12 text-center text-sm text-muted-foreground">
        <ScrollText className="h-8 w-8 opacity-40" aria-hidden />
        Pro tento filtr nejsou žádné záznamy.
      </div>
    );
  }
  return (
    <ol className="space-y-2" aria-label="Záznamy auditu">
      {entries.map((e) => {
        const Icon = e.destructive ? Trash2 : e.stamp.kind === "ai" ? Sparkles : e.stamp.kind === "system" ? Cog : UserRoundCheck;
        const lines = diffLines(e.diff);
        return (
          <li key={e.id} className="rounded-xl border bg-card p-3 shadow-sm">
            <div className="flex items-start gap-3">
              <span
                className={cn(
                  "flex h-9 w-9 shrink-0 items-center justify-center rounded-lg",
                  e.destructive ? "bg-red-100 text-red-700 dark:bg-red-500/15 dark:text-red-300" : KIND_TONE[e.stamp.kind],
                )}
                aria-hidden
              >
                <Icon className="h-4 w-4" />
              </span>
              <div className="min-w-0 flex-1 space-y-0.5">
                <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                  <span className="font-medium">{e.actionLabel}</span>
                  <span className="rounded-full bg-muted px-2 py-0.5 text-[11px] text-muted-foreground">{e.entityLabel}</span>
                  <time dateTime={e.at} className="ml-auto text-xs tabular-nums text-muted-foreground">{when(e.at)}</time>
                </div>
                {e.summary && (
                  <p className="break-words text-sm text-muted-foreground">
                    {e.href ? (
                      <Link href={e.href} className="inline-flex items-center gap-1 text-primary hover:underline">
                        {e.summary} <ArrowUpRight className="h-3 w-3" aria-hidden />
                      </Link>
                    ) : e.summary}
                  </p>
                )}
                <ActorStamp stamp={e.stamp} now={now} />
                {lines.length > 0 && (
                  <details className="group mt-1 text-xs">
                    <summary className="cursor-pointer select-none text-muted-foreground hover:text-foreground">Podrobnosti ({lines.length})</summary>
                    <dl className="mt-1.5 grid grid-cols-1 gap-x-3 gap-y-0.5 rounded-lg bg-muted/40 p-2 sm:grid-cols-[minmax(0,10rem)_minmax(0,1fr)]">
                      {lines.map((l) => (
                        <div key={l.key} className="contents">
                          <dt className="truncate font-mono text-[11px] text-muted-foreground">{l.key}</dt>
                          <dd className="break-words font-mono text-[11px]">{l.value}</dd>
                        </div>
                      ))}
                    </dl>
                  </details>
                )}
              </div>
            </div>
          </li>
        );
      })}
    </ol>
  );
}
