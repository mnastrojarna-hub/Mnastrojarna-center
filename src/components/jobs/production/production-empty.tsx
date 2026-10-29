"use client";

import { ChevronRight, Factory, PackageCheck } from "lucide-react";
import { OPERATION_KINDS, OPERATION_TEMPLATES } from "@/lib/jobs/operations";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { stageRank } from "@/lib/jobs/stages";
import type { JobStage } from "@/lib/supabase/database.types";
import { useProduction } from "./production-context";
import { KindGrid } from "./operation-dialog";

/**
 * Zakázka zatím bez postupu: jedním klepnutím „Kompletní dodávka" (dodá jedna
 * firma), šablona postupu, nebo poskládat operace ručně z barevných dlaždic.
 */
export function ProductionEmpty({ stage }: { stage?: JobStage }) {
  const { open } = useProduction();
  const templates = OPERATION_TEMPLATES.filter((t) => t.key !== "komplet");
  const rank = stage ? stageRank(stage) : -1;
  const before = Boolean(stage) && ((rank >= 3 && rank < 5) || stage === "pozastaveno" || stage === "reklamace");

  return (
    <div className="space-y-4">
      {before && (
        <section aria-label="Předat do výroby" className="flex flex-col gap-3 rounded-2xl border-2 border-rose-200 bg-rose-50/60 p-4 dark:border-rose-500/30 dark:bg-rose-500/10 sm:flex-row sm:items-center sm:p-5" data-testid="handoff-empty">
          <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-rose-600 text-white">
            <Factory className="h-6 w-6" />
          </span>
          <div className="min-w-0 flex-1">
            <h3 className="text-lg font-bold leading-tight">Zakázka ještě není ve výrobě</h3>
            <p className="mt-0.5 text-sm text-muted-foreground">Předej ji do výroby — AI předvyplní nejlevnější firmu z nabídek a termín, ty jen potvrdíš.</p>
          </div>
          <Button type="button" onClick={() => open({ type: "handoff", kind: "predani" })} className="h-12 shrink-0 gap-2 bg-rose-600 px-5 text-base font-semibold text-white hover:bg-rose-700 sm:h-11">
            <Factory /> Předat do výroby…
          </Button>
        </section>
      )}
    <section aria-label={before ? "Naplánovat postup" : "Založit postup výroby"} className="overflow-hidden rounded-2xl border bg-card shadow-sm">
      <div className="h-1.5 w-full bg-gradient-to-r from-sky-500 via-orange-500 to-purple-500" />
      <div className="space-y-5 p-4 sm:p-6">
        <div className="flex items-start gap-3">
          <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-yellow-100 text-yellow-700 dark:bg-yellow-500/15 dark:text-yellow-300">
            <Factory className="h-6 w-6" />
          </span>
          <div>
            <h3 className="text-lg font-bold leading-tight">{before ? "Naplánovat postup" : "Jak se zakázka vyrobí?"}</h3>
            <p className="mt-0.5 text-sm text-muted-foreground">
              Vyber postup — pak už jen klepáš <strong className="text-foreground">Začít</strong> a <strong className="text-foreground">Hotovo</strong> a v knize je vždy vidět, kde díl je.
            </p>
          </div>
        </div>

        <button
          type="button"
          onClick={() => open({ type: "complete" })}
          className="group flex w-full items-center gap-3 rounded-xl border-2 border-lime-300 bg-lime-50 p-4 text-left transition hover:border-lime-500 hover:bg-lime-100 active:scale-[0.99] dark:border-lime-500/40 dark:bg-lime-500/10 dark:hover:bg-lime-500/15"
        >
          <span className={cn("flex h-12 w-12 shrink-0 items-center justify-center rounded-xl shadow-sm", OPERATION_KINDS.kompletni_dodavka.solid)}>
            <PackageCheck className="h-6 w-6" />
          </span>
          <span className="min-w-0 flex-1">
            <span className="block text-base font-bold">Kompletní dodávka</span>
            <span className="block text-sm text-muted-foreground">Celé to vyrobí a dodá jedna firma — jen vyber kterou.</span>
          </span>
          <ChevronRight className="h-5 w-5 shrink-0 text-muted-foreground transition group-hover:translate-x-0.5" />
        </button>

        <div>
          <h4 className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">Podrobný postup ze šablony</h4>
          <div className="grid gap-2 sm:grid-cols-2">
            {templates.map((t) => (
              <button
                key={t.key}
                type="button"
                onClick={() => open({ type: "template", key: t.key })}
                className="group flex min-w-0 flex-col gap-2 rounded-xl border bg-background p-3 text-left transition hover:border-foreground/20 hover:shadow-md active:scale-[0.99]"
              >
                <span className="flex items-center gap-1">
                  {t.kinds.map((k, i) => {
                    const m = OPERATION_KINDS[k];
                    const Icon = m.icon;
                    return (
                      <span key={`${k}-${i}`} className="flex items-center gap-1">
                        {i > 0 && <span aria-hidden className="h-0.5 w-2 rounded-full bg-border sm:w-3" />}
                        <span title={m.label} className={cn("flex h-7 w-7 items-center justify-center rounded-full", m.solid)}>
                          <Icon className="h-3.5 w-3.5" />
                        </span>
                      </span>
                    );
                  })}
                </span>
                <span className="text-sm font-semibold leading-snug">{t.label}</span>
                <span className="text-[11px] text-muted-foreground">{t.kinds.map((k) => OPERATION_KINDS[k].short).join(" → ")}</span>
              </button>
            ))}
          </div>
        </div>

        <div>
          <h4 className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">Nebo poskládej sám — klepni na první operaci</h4>
          <KindGrid onPick={(kind) => open({ type: "add", kind })} size="lg" />
        </div>
      </div>
    </section>
    </div>
  );
}
