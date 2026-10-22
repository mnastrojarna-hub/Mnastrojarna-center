"use client";

import { Ban, CircleCheckBig, LayoutList, MessageSquareQuote, ShoppingCart, type LucideIcon } from "lucide-react";
import { BookLink, useBookNav } from "@/components/jobs/book/book-nav";
import {
  BOOK_SEGMENTS, bookSegment, toggleStagePatch, type BookSegmentKey,
} from "@/components/jobs/book/book-params";
import { stageMeta } from "@/lib/jobs/stages";
import type { JobStage } from "@/lib/supabase/database.types";
import { cn } from "@/lib/utils";

/** Záložky knihy (Objednávky = výchozí) s počty. */

const SEGMENT_STYLE: Record<BookSegmentKey, { icon: LucideIcon; active: string; iconCls: string }> = {
  objednavky: { icon: ShoppingCart, active: "bg-orange-500 text-white shadow-sm shadow-orange-500/30", iconCls: "text-orange-500" },
  poptavky: { icon: MessageSquareQuote, active: "bg-sky-500 text-white shadow-sm shadow-sky-500/30", iconCls: "text-sky-500" },
  dokoncene: { icon: CircleCheckBig, active: "bg-slate-600 text-white shadow-sm", iconCls: "text-slate-500" },
  nerealizovane: { icon: Ban, active: "bg-stone-500 text-white shadow-sm", iconCls: "text-stone-500" },
  vse: { icon: LayoutList, active: "bg-foreground text-background shadow-sm", iconCls: "text-muted-foreground" },
};

export function SegmentTabs({ counts }: { counts: Record<BookSegmentKey, number> }) {
  const { params } = useBookNav();
  return (
    <nav aria-label="Části knihy" className="-mx-1 overflow-x-auto px-1 scrollbar-thin">
      <ul className="flex w-max min-w-full gap-1 rounded-xl bg-muted/70 p-1">
        {BOOK_SEGMENTS.map((s) => {
          const st = SEGMENT_STYLE[s.key];
          const active = params.segment === s.key;
          const Icon = st.icon;
          return (
            <li key={s.key} className="flex-1">
              <BookLink
                patch={{ segment: s.key }}
                aria-current={active ? "page" : undefined}
                title={s.hint}
                className={cn(
                  "flex h-9 items-center justify-center gap-1.5 whitespace-nowrap rounded-lg px-3 text-sm font-medium transition",
                  "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                  active ? st.active : "text-muted-foreground hover:bg-background/70 hover:text-foreground",
                )}
              >
                <Icon className={cn("h-4 w-4", !active && st.iconCls)} />
                <span className="xl:hidden">{s.short}</span>
                <span className="hidden xl:inline">{s.label}</span>
                <span
                  className={cn(
                    "rounded-full px-1.5 text-[11px] font-bold leading-[18px] tabular-nums",
                    active ? "bg-white/25 text-current" : "bg-background text-foreground/70",
                  )}
                >
                  {counts[s.key]}
                </span>
              </BookLink>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}

/** Barevné chipy stavů uvnitř záložky (vícenásobný výběr, „Vše" ruší výběr). */
export function StageChips({ byStage }: { byStage: Record<JobStage, number> }) {
  const { params } = useBookNav();
  const seg = bookSegment(params.segment);
  if (seg.stages.length < 2) return null;
  const none = params.stages.length === 0;

  return (
    <div role="group" aria-label="Filtr podle stavu" className="-mx-1 flex gap-1.5 overflow-x-auto px-1 pb-1 scrollbar-thin sm:flex-wrap sm:overflow-visible sm:pb-0">
      <BookLink
        patch={{ stages: [] }}
        aria-current={none ? "true" : undefined}
        className={cn(
          "inline-flex h-8 shrink-0 items-center gap-1.5 rounded-full border px-3 text-xs font-semibold transition",
          "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
          none ? "border-transparent bg-foreground text-background" : "bg-background text-muted-foreground hover:text-foreground",
        )}
      >
        Vše
      </BookLink>
      {seg.stages.map((stage) => {
        const m = stageMeta(stage);
        const on = params.stages.includes(stage);
        const n = byStage[stage] ?? 0;
        const Icon = m.icon;
        return (
          <BookLink
            key={stage}
            patch={toggleStagePatch(params, stage)}
            aria-current={on ? "true" : undefined}
            title={m.description}
            className={cn(
              "inline-flex h-8 shrink-0 items-center gap-1.5 rounded-full border px-2.5 text-xs font-medium transition",
              "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
              on ? cn("border-transparent shadow-sm", m.solid) : cn("bg-background hover:bg-muted/60", m.ring),
              !on && n === 0 && "opacity-60",
            )}
          >
            {on ? <Icon className="h-3.5 w-3.5" /> : <span className={cn("h-2.5 w-2.5 rounded-full", m.dot)} />}
            <span className={cn(!on && "text-foreground")}>{m.label}</span>
            <span
              className={cn(
                "rounded-full px-1.5 text-[10.5px] font-bold leading-4 tabular-nums",
                on ? "bg-white/25" : m.badge,
              )}
            >
              {n}
            </span>
          </BookLink>
        );
      })}
    </div>
  );
}
