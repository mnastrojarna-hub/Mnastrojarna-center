"use client";

import * as React from "react";
import { Check } from "lucide-react";
import { stageMeta } from "@/lib/jobs/stages";
import { cn } from "@/lib/utils";
import { buildTimeline, shortDate, longDate, type TimelineInput } from "./detail-helpers";

/**
 * Barevná časová osa zakázky: hotové kroky plné, aktuální zvýrazněný,
 * pod kroky data. Speciální stav (pauza, reklamace…) jako stuha nad osou.
 * Na mobilu se osa posouvá do strany.
 */
export function StageTimeline({ job, today }: { job: TimelineInput; today?: Date }) {
  const { steps, side, doneCount } = buildTimeline(job);
  const sideMeta = side ? stageMeta(side) : null;
  const SideIcon = sideMeta?.icon;
  const listRef = React.useRef<HTMLOListElement>(null);
  const focusIndex = Math.max(0, steps.findIndex((s) => s.state === "current"), doneCount - 1);

  // na úzkém displeji posunout osu tak, aby byl aktuální krok vidět
  React.useEffect(() => {
    const list = listRef.current;
    const el = list?.children[focusIndex] as HTMLElement | undefined;
    if (!list || !el || list.scrollWidth <= list.clientWidth) return;
    list.scrollLeft = Math.max(0, el.offsetLeft - list.clientWidth / 2 + el.clientWidth / 2);
  }, [focusIndex]);

  return (
    <section aria-label="Průběh zakázky" className="rounded-xl border bg-card p-4 shadow-sm">
      <div className="mb-3 flex items-center justify-between gap-2">
        <h2 className="text-sm font-semibold">Průběh zakázky</h2>
        <span className="text-xs text-muted-foreground">
          hotovo {doneCount} z {steps.length} kroků
        </span>
      </div>

      {sideMeta && SideIcon && (
        <div className={cn("mb-3 flex items-start gap-2.5 rounded-lg px-3 py-2 text-sm", sideMeta.badge)}>
          <SideIcon className="mt-0.5 h-4 w-4 shrink-0" />
          <div>
            <span className="font-semibold">{sideMeta.label}</span>
            <span className="opacity-80"> — {sideMeta.description}</span>
          </div>
        </div>
      )}

      <ol ref={listRef} className="relative -mx-1 flex overflow-x-auto scroll-smooth scrollbar-thin pb-1">
        {steps.map((s, i) => {
          const m = stageMeta(s.stage);
          const Icon = m.icon;
          const reached = s.state !== "todo";
          const prevReached = i > 0 && steps[i - 1].state !== "todo";
          const date = shortDate(s.date, today);
          return (
            <li
              key={s.stage}
              className="relative flex min-w-[84px] flex-1 flex-col items-center px-1 text-center"
              aria-current={s.state === "current" ? "step" : undefined}
            >
              {i > 0 && (
                <span
                  aria-hidden
                  className={cn(
                    "absolute right-1/2 top-[14px] h-1 w-full rounded-full",
                    reached && prevReached ? m.bar : "bg-muted",
                    sideMeta && reached && "opacity-60",
                  )}
                />
              )}
              <span
                className={cn(
                  "relative z-10 flex h-8 w-8 items-center justify-center rounded-full transition",
                  s.state === "done" && cn(m.solid, "shadow-sm"),
                  s.state === "current" && cn(m.solid, "shadow-md ring-4", m.ring),
                  s.state === "todo" && "border-2 border-dashed border-muted-foreground/25 bg-background text-muted-foreground/60",
                  sideMeta && s.state === "done" && "opacity-70",
                )}
                title={`${m.label} — ${m.description}`}
              >
                {s.state === "done" ? <Check className="h-4 w-4" strokeWidth={3} /> : <Icon className="h-4 w-4" />}
              </span>
              <span
                className={cn(
                  "mt-1.5 text-[11px] font-medium leading-tight",
                  s.state === "current" ? cn("font-bold", m.text) : reached ? "text-foreground" : "text-muted-foreground",
                )}
              >
                {m.short}
                {s.optional && <span className="sr-only"> (volitelný krok)</span>}
              </span>
              <span className="mt-0.5 h-3.5 text-[10px] leading-none text-muted-foreground" title={longDate(s.date) ?? undefined}>
                {date ?? ""}
              </span>
            </li>
          );
        })}
      </ol>
    </section>
  );
}
