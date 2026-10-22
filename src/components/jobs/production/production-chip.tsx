"use client";

import * as React from "react";
import { AlertTriangle, CircleCheckBig, Factory, Plus, ReceiptText } from "lucide-react";
import { OPERATION_KINDS, isOperationKind, productionLabel } from "@/lib/jobs/operations";
import { paymentStateOf } from "@/lib/jobs/mapping";
import { todayInPrague } from "@/components/jobs/book/book-params";
import type { JobListItem } from "@/lib/jobs/types";
import type { JobStage } from "@/lib/supabase/database.types";
import { cn } from "@/lib/utils";
import { ProductionMiniBar } from "./production-mini";

/** Stavy, ve kterých má smysl nabídnout „Naplánovat výrobu". */
const PLAN_STAGES: JobStage[] = ["objednavka", "potvrzeno", "ve_vyrobe"];

/**
 * Přepne kartu zakázky na záložku „Výroba" bez načtení stránky (záložky jsou
 * Radix Tabs — aktivují se stiskem). Bez nalezené záložky proběhne běžná
 * navigace na ?tab=vyroba.
 */
export function openProductionTab(e: React.MouseEvent<HTMLAnchorElement>) {
  if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
  const trigger = document.querySelector<HTMLElement>('[role="tab"][id$="-trigger-vyroba"]');
  if (!trigger) return;
  e.preventDefault();
  trigger.dispatchEvent(new MouseEvent("mousedown", { bubbles: true, cancelable: true, button: 0 }));
  const list = trigger.closest('[role="tablist"]') ?? trigger;
  const top = list.getBoundingClientRect().top + window.scrollY - 72;
  window.scrollTo({ top: Math.max(0, top), behavior: "smooth" });
}

function ChipLink({ className, title, children }: { className: string; title: string; children: React.ReactNode }) {
  return (
    <a
      href="?tab=vyroba"
      onClick={openProductionTab}
      title={title}
      className={cn(
        "inline-flex min-w-0 max-w-full items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-semibold transition hover:brightness-95 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring dark:hover:brightness-125",
        className,
      )}
    >
      {children}
    </a>
  );
}

/**
 * Hlavička zakázky: kde je výroba („Teď: Tepelné zpracování · TepKal"),
 * problém ve výrobě a faktura po splatnosti. Klik → záložka Výroba.
 */
export function ProductionHeaderBadges({ job, className }: { job: JobListItem; className?: string }) {
  const step = job.productionStep ?? null;
  const total = job.productionTotal ?? 0;
  const done = job.productionDone ?? 0;
  const problem = Boolean(job.productionProblem);
  const overdue = paymentStateOf(job, todayInPrague()) === "po_splatnosti";
  const kind = isOperationKind(step) ? OPERATION_KINDS[step] : null;
  const plan = !step && !total && PLAN_STAGES.includes(job.stage);
  if (!step && !problem && !overdue && !plan) return null;
  const label = productionLabel(step, job.productionLocation ?? null);

  return (
    <div className={cn("flex min-w-0 flex-wrap items-center gap-1.5", className)}>
      {step === "hotovo" && (
        <ChipLink title={`Výroba hotová (${done}/${total})`} className="bg-green-100 text-green-800 dark:bg-green-500/15 dark:text-green-300">
          <CircleCheckBig className="h-3.5 w-3.5 shrink-0" /> Výroba hotová
        </ChipLink>
      )}
      {kind && (
        <ChipLink title={`Výroba: ${label} — hotovo ${done} z ${total}`} className={kind.badge}>
          <kind.icon className="h-3.5 w-3.5 shrink-0" />
          <span className="min-w-0 truncate">Teď: {label}</span>
          {total > 0 && (
            <span className="flex shrink-0 items-center gap-1 pl-0.5">
              <ProductionMiniBar done={done} total={total} step={step} problem={problem} className="w-10" />
              <span className="tabular-nums opacity-80">{done}/{total}</span>
            </span>
          )}
        </ChipLink>
      )}
      {plan && (
        <ChipLink title="Zakázka zatím nemá postup výroby" className="border border-dashed border-muted-foreground/40 bg-transparent font-medium text-muted-foreground">
          <Factory className="h-3.5 w-3.5 shrink-0" /> <Plus className="-ml-1 h-3 w-3" /> Naplánovat výrobu
        </ChipLink>
      )}
      {problem && (
        <ChipLink title="Některá operace hlásí problém — otevřít výrobu" className="bg-red-600 text-white">
          <AlertTriangle className="h-3.5 w-3.5 shrink-0" /> Problém ve výrobě
        </ChipLink>
      )}
      {overdue && (
        <ChipLink title="Faktura je po splatnosti a není zaplacená" className="bg-orange-500 text-white">
          <ReceiptText className="h-3.5 w-3.5 shrink-0" /> Po splatnosti
        </ChipLink>
      )}
    </div>
  );
}
