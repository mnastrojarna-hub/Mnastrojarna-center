"use client";

import * as React from "react";
import {
  AlertTriangle, ArrowRight, Banknote, ChevronDown, ClipboardList, FileText, Flag, Home, Hourglass, MapPin, PackageCheck, Send, StickyNote, Truck,
  Wrench, Factory, type LucideIcon,
} from "lucide-react";
import { useRfq } from "@/components/rfq/rfq-context";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { OPERATION_KINDS } from "@/lib/jobs/operations";
import { FLOW_ACTIONS } from "@/lib/jobs/flow-status";
import type { JobDetail } from "@/lib/jobs/types";
import type { JobPurchasing } from "@/lib/jobs/purchasing-types";
import type { JobProductionData } from "@/components/jobs/production/production-tab";
import { PILL_TONE } from "@/components/jobs/production/handoff/deadline-chip";
import { openProductionTab } from "@/components/jobs/production/production-chip";
import { todayInPrague } from "@/components/jobs/book/book-params";
import { useJobDetail } from "./detail-context";
import { useFlowActions } from "./flow-actions";
import { JobField } from "./inline-field";
import { formatMoney, formatQty } from "./detail-helpers";
import {
  buildTechCard, rfqTargetOf, techNextAction, techSummary, type StepTone, type TechGroupView, type TechNext, type TechStepView,
} from "./technology-overview";

/**
 * Karta „Technologie" v Přehledu (majitel 30. 10.: „ukazuje strašně málo informací, strohé až zavádějící"):
 * po skupinách položek se stejným postupem kroky v pořadí — co se dělá, kdo (u nás / dodavatel), stav kroku,
 * termín proti termínu zákazníka, objednávka, poznámky pro dodavatele, náklad (jen s právem na ceny) a jeden
 * další krok. Na mobilu sbalené řádky kroků (podrobnosti rozbalením), na desktopu vše.
 */

const STEP_TONE: Record<StepTone, string> = {
  grey: "bg-muted text-muted-foreground",
  amber: "bg-amber-100 text-amber-900 dark:bg-amber-500/15 dark:text-amber-200",
  lime: "bg-lime-100 text-lime-800 dark:bg-lime-500/15 dark:text-lime-300",
  orange: "bg-orange-100 text-orange-800 dark:bg-orange-500/15 dark:text-orange-300",
  green: "bg-green-100 text-green-800 dark:bg-green-500/15 dark:text-green-300",
  red: "bg-red-100 text-red-700 dark:bg-red-500/15 dark:text-red-300",
};

const CHIP = "inline-flex max-w-full items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-semibold";

function money(amount: number | null, currency: string): string {
  return amount === null ? "cena zatím nepřišla" : formatMoney(amount, currency);
}

/** Krok, u kterého dává smysl poptat dodavatele (nabídka chybí nebo ještě nepřišla). */
const RFQ_PHASES = new Set(["bez_firmy", "ceka_na_nabidku", "k_objednani"]);

function StepRow({ step, open, onRfq }: { step: TechStepView; open: boolean; onRfq?: (() => void) | null }) {
  const kind = OPERATION_KINDS[step.kind];
  const KindIcon = kind.icon;
  const WhoIcon: LucideIcon = step.who.type === "u_nas" ? Home : step.who.type !== "none" ? Factory : step.quotePending ? Hourglass : AlertTriangle;
  const details = Boolean(step.po || step.cost || (step.quotePending && step.who.type !== "none") || step.note);
  return (
    <li
      className={cn("relative flex gap-2.5 py-2 first:pt-0 last:pb-0", step.current && "rounded-lg bg-amber-50/70 px-2 dark:bg-amber-500/[0.07]")}
      data-testid="tech-step"
      data-phase={step.phase}
    >
      <span className={cn("mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full", kind.badge)} title={kind.label}>
        <KindIcon className="h-3.5 w-3.5" aria-hidden />
      </span>
      <div className="min-w-0 flex-1 sm:grid sm:grid-cols-[minmax(0,1.15fr)_minmax(0,1fr)] sm:gap-x-3">
        <div className="min-w-0">
          <p className="break-words text-sm font-semibold leading-snug">
            <span className="tabular-nums text-muted-foreground">{step.no}.</span>{" "}
            {step.label}
          </p>
          <p className={cn("flex min-w-0 items-start gap-1 text-[13px] leading-snug", step.who.type === "none" && !step.quotePending ? "text-amber-700 dark:text-amber-300" : "text-foreground/90")} data-testid="tech-step-who">
            <WhoIcon className="mt-0.5 h-3.5 w-3.5 shrink-0 text-muted-foreground" aria-hidden />
            <span className="min-w-0 break-words">
              {step.who.type !== "none" ? step.whoText : step.quotePending ? `Poptáno: ${step.quotePending}` : "Nevybráno"}
              {step.whoRole && <span className="text-[11px] text-muted-foreground"> · {step.whoRole}</span>}
            </span>
          </p>
        </div>
        <div className="mt-1 flex min-w-0 flex-wrap items-center gap-1 sm:mt-0 sm:content-start">
          <span className={cn(CHIP, STEP_TONE[step.tone])} data-testid="tech-step-status">
            <span className="min-w-0 truncate">{step.current && step.phase === "ceka" ? "Na řadě" : step.status}</span>
          </span>
          {step.deadline && (
            <span className={cn(CHIP, PILL_TONE[step.deadline.tone])} title={step.deadline.title ?? undefined} data-testid="tech-step-deadline">
              {step.endsAtCustomerDate && <Flag className="h-3 w-3 shrink-0" aria-hidden />}
              <span className="min-w-0 truncate">{step.deadline.text}</span>
            </span>
          )}
          {onRfq && step.who.type !== "u_nas" && RFQ_PHASES.has(step.phase) && !step.cost && (
            <button type="button" onClick={onRfq} className={cn(CHIP, "border border-orange-300 bg-orange-50 text-orange-800 hover:bg-orange-100 dark:border-orange-500/40 dark:bg-orange-500/10 dark:text-orange-200")} data-testid="tech-step-rfq">
              <Send className="h-3 w-3 shrink-0" aria-hidden /> Poptat
            </button>
          )}
        </div>
        {details && (
          <div className={cn("col-span-2 mt-1 flex-wrap gap-x-3 gap-y-0.5 text-xs text-muted-foreground", open ? "flex" : "hidden sm:flex")} data-testid="tech-step-details">
            {step.po && (
              <span className="inline-flex min-w-0 items-center gap-1" data-testid="tech-step-po">
                <FileText className="h-3 w-3 shrink-0" aria-hidden /> <span className="min-w-0 break-words">{step.po}</span>
              </span>
            )}
            {step.quotePending && step.who.type !== "none" && (
              <span className="inline-flex items-center gap-1 text-amber-700 dark:text-amber-300">
                <Hourglass className="h-3 w-3 shrink-0" aria-hidden /> nabídka {step.quotePending} — bez ceny
              </span>
            )}
            {step.cost && (
              <span className="inline-flex items-center gap-1" data-testid="tech-step-cost">
                <Banknote className="h-3 w-3 shrink-0 text-emerald-600" aria-hidden />
                <span className="font-medium text-foreground/90">{money(step.cost.amount, step.cost.currency)}</span>
                {step.cost.amount !== null && <span>{step.cost.source === "objednavka" ? `objednávka${step.cost.ref ? ` ${step.cost.ref}` : ""}` : `dle nabídky${step.cost.ref ? ` ${step.cost.ref}` : ""}`}</span>}
              </span>
            )}
            {step.note && (
              <span className="inline-flex min-w-0 items-start gap-1">
                <StickyNote className="mt-0.5 h-3 w-3 shrink-0 text-amber-500" aria-hidden /> <span className="min-w-0 break-words">{step.note}</span>
              </span>
            )}
          </div>
        )}
      </div>
    </li>
  );
}

function GroupItems({ group, open }: { group: TechGroupView; open: boolean }) {
  // jedna položka: název, kusy a materiál už jsou v titulku skupiny — tady jen postup a poznámka
  const single = group.items.length === 1;
  if (!group.items.length || (single && !group.items[0].complete && !group.items[0].procedure && !group.items[0].supplierNote)) return null;
  return (
    <ul className={cn("mt-2 space-y-1.5 border-t pt-2", open ? "block" : "hidden sm:block")} data-testid="tech-group-items">
      {group.items.map((it) => (
        <li key={it.id} className="text-xs leading-relaxed">
          {!single && (
            <p className="text-muted-foreground">
              <span className="font-medium text-foreground">{it.label}</span>
              {" · "}{formatQty(it.quantity)} {it.unit}{it.material ? ` · ${it.material}` : ""}
            </p>
          )}
          {it.complete ? (
            <p className="inline-flex items-start gap-1 text-emerald-700 dark:text-emerald-300">
              <PackageCheck className="mt-0.5 h-3 w-3 shrink-0" aria-hidden /> Bez technologie — kompletně zadáno{it.completeBy ? ` ${it.completeBy}` : ""}
            </p>
          ) : it.procedure ? (
            <p className="flex items-start gap-1 text-foreground/80" title={it.procedure}>
              <ClipboardList className="mt-0.5 h-3 w-3 shrink-0 text-sky-600" aria-hidden />
              <span className="line-clamp-2 min-w-0 whitespace-pre-line break-words">{it.procedure}</span>
            </p>
          ) : null}
          {it.supplierNote && (
            <p className="flex items-start gap-1 text-amber-800 dark:text-amber-300" data-testid="tech-card-supplier-note">
              <AlertTriangle className="mt-0.5 h-3 w-3 shrink-0" aria-hidden />
              <span className="min-w-0 break-words"><span className="font-semibold">Pro dodavatele:</span> {it.supplierNote}</span>
            </p>
          )}
        </li>
      ))}
    </ul>
  );
}

function Group({ group, onRfq }: { group: TechGroupView; onRfq?: ((s: TechStepView, g: TechGroupView) => void) | null }) {
  const [open, setOpen] = React.useState(false);
  const one = group.items.length === 1 ? group.items[0] : null;
  const qty = one ? `${formatQty(one.quantity)} ${one.unit}${one.material ? ` · ${one.material}` : ""}` : null;
  return (
    <li className="rounded-lg border bg-background/60 p-2.5 sm:p-3" data-testid="tech-group">
      <div className="mb-2 flex items-start gap-2">
        <div className="min-w-0 flex-1">
          <p className="break-words text-xs font-semibold text-muted-foreground" data-testid="tech-group-title">
            {group.title}{qty ? ` · ${qty}` : ""}
          </p>
          {group.delivered && (
            <span className={cn(CHIP, "mt-1", group.delivered.done >= group.delivered.total ? STEP_TONE.green : STEP_TONE.lime)}>
              <Truck className="h-3 w-3 shrink-0" aria-hidden /> Zákazníkovi dodáno {formatQty(group.delivered.done)} z {formatQty(group.delivered.total)} {group.delivered.unit}
            </span>
          )}
        </div>
        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          aria-expanded={open}
          className="-mr-1 -mt-1 inline-flex min-h-9 shrink-0 items-center gap-1 rounded-md px-2 text-xs font-medium text-muted-foreground hover:bg-accent sm:hidden"
          data-testid="tech-group-toggle"
        >
          {open ? "Méně" : "Podrobnosti"} <ChevronDown className={cn("h-3.5 w-3.5 transition-transform", open && "rotate-180")} aria-hidden />
        </button>
      </div>
      {group.steps.length ? (
        <ol className="divide-y divide-border/60" aria-label={`Kroky: ${group.title}`}>
          {group.steps.map((s) => <StepRow key={s.id} step={s} open={open} onRfq={onRfq ? () => onRfq(s, group) : null} />)}
        </ol>
      ) : (
        <p className="text-xs text-muted-foreground">Kroky výroby zatím nenaplánované.</p>
      )}
      <GroupItems group={group} open={open} />
    </li>
  );
}

function NextButton({ next, onRun }: { next: TechNext; onRun: (n: TechNext) => void }) {
  const Icon = FLOW_ACTIONS[next.key].icon;
  return (
    <div className="flex min-w-0 flex-col gap-1.5 sm:flex-row sm:items-center sm:gap-3">
      <Button type="button" onClick={() => onRun(next)} className="h-11 w-full gap-2 font-semibold sm:h-9 sm:w-auto" data-testid="tech-next">
        <Icon aria-hidden /> {next.label}
      </Button>
      {next.hint && <p className="min-w-0 break-words text-xs text-muted-foreground" data-testid="tech-next-hint">{next.hint}</p>}
    </div>
  );
}

const TAB_LINK = "inline-flex items-center gap-1 text-xs font-semibold text-sky-700 hover:underline dark:text-sky-400";

/** Doplňující údaje zakázky (požadavky, dodání); starší ruční pole technologie / místa výroby jen s hodnotou. */
function ExtraFields({ job }: { job: JobDetail }) {
  return (
    <div className="grid gap-3 border-t pt-3 sm:grid-cols-2">
      {(job.technology ?? "").trim() && (
        <JobField field="technology" label="Technologie (ruční poznámka)" value={job.technology} icon={Wrench} iconClass="text-yellow-600" placeholder="např. frézování, kalení" />
      )}
      {(job.manufacturingLocation ?? "").trim() && (
        <JobField field="manufacturingLocation" label="Místo výroby (ručně)" value={job.manufacturingLocation} icon={MapPin} iconClass="text-yellow-600" placeholder="u nás / u dodavatele" />
      )}
      <JobField field="specificRequirements" kind="textarea" label="Specifické požadavky" value={job.specificRequirements} icon={ClipboardList} iconClass="text-yellow-600" placeholder="atesty, tolerance, balení…" />
      <JobField field="deliveryMethod" label="Způsob dodání" value={job.deliveryMethod} icon={Truck} iconClass="text-yellow-600" placeholder="např. naše doprava, PPL, osobní odběr" />
    </div>
  );
}

export function TechnologyCard({ job, production, purchasing, className }: {
  job: JobDetail;
  production?: JobProductionData | null;
  purchasing?: JobPurchasing | null;
  className?: string;
}) {
  const { perms } = useJobDetail();
  const flow = useFlowActions();
  const today = todayInPrague();
  const canSeePrices = Boolean(perms.margins && (production?.handoff?.permissions.canSeePrices ?? true));
  const handoffFinal = production?.handoff?.finalDate ?? null;

  const view = React.useMemo(() => buildTechCard({
    stage: job.stage, items: job.items, ops: production?.operations ?? [],
    quotes: purchasing?.supplierQuotes ?? null, purchaseOrders: purchasing?.purchaseOrders ?? null,
    // konečný termín (zákazník): z předání, jinak z termínů zakázky
    finalDate: handoffFinal ?? (job.dueDate ? { date: job.dueDate, source: "due_date" }
      : job.customerRequiredDate ? { date: job.customerRequiredDate, source: "customer_required_date" } : null),
    today, canSeePrices, currency: job.currency,
  }), [job.stage, job.items, production?.operations, purchasing?.supplierQuotes, purchasing?.purchaseOrders, handoffFinal, job.dueDate, job.customerRequiredDate, today, canSeePrices, job.currency]);

  const rfq = useRfq();
  const can = flow ? flow.ctx.can : (f: string) => (f === "rfq" ? Boolean(rfq?.canRfq) : f !== "margins" || perms.margins);
  const next = techNextAction(view, { stage: job.stage, flowNext: flow?.next ?? null, can });
  const run = (n: TechNext) => {
    // 31. 10.: „Poptat dodavatele" = poptávkové kolo pro krok (operace) a jeho položky
    if (n.key === "rfq.create" && rfq?.canRfq) rfq.open({ kinds: n.rfq?.kinds ?? null, itemIds: n.rfq?.itemIds ?? null });
    else if (flow) flow.run(n.key);
    else window.location.search = "?tab=vyroba";
  };
  const early = job.stage === "poptavka" || job.stage === "naceneni" || job.stage === "nabidka";
  const onRfq = rfq?.canRfq && early
    ? (s: TechStepView, g: TechGroupView) => { const t = rfqTargetOf(s, g); rfq.open({ kinds: t.kinds, itemIds: t.itemIds }); }
    : null;

  return (
    <section className={cn("rounded-xl border bg-card shadow-sm", className)} aria-label="Technologie" data-testid="tech-card">
      <header className="flex flex-wrap items-center gap-x-2.5 gap-y-2 border-b px-4 py-3">
        <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-yellow-100 text-yellow-800 dark:bg-yellow-500/15 dark:text-yellow-300">
          <Wrench className="h-4 w-4" />
        </span>
        <div className="min-w-0 flex-1">
          <h3 className="text-sm font-semibold leading-tight">Technologie</h3>
          <p className="break-words text-xs text-muted-foreground" data-testid="tech-summary">{techSummary(view)}</p>
        </div>
        {rfq?.summary && (
          <span className={cn(CHIP, STEP_TONE.orange)} title={`Poptávka ${rfq.summary.number}`} data-testid="tech-rfq">
            <Send className="h-3 w-3 shrink-0" aria-hidden /> {rfq.summary.text}
          </span>
        )}
        {view.final && (
          <span className={cn(CHIP, PILL_TONE[view.final.tone])} title={view.final.title} data-testid="tech-final">
            <Flag className="h-3 w-3 shrink-0" aria-hidden /> {view.final.text}
          </span>
        )}
      </header>
      <div className="grid gap-3 p-3 sm:p-4">
        {view.empty ? (
          <p className="rounded-lg border border-dashed px-3 py-4 text-center text-sm text-muted-foreground" data-testid="tech-empty">
            Technologie zatím nenastavena —{" "}
            <a href="?tab=vyroba" onClick={openProductionTab} className="font-semibold text-sky-700 hover:underline dark:text-sky-400">Nastavit</a>
          </p>
        ) : (
          <>
            {view.risk && (
              <p role="alert" className="flex items-start gap-1.5 rounded-lg bg-red-50 px-3 py-2 text-xs font-medium text-red-800 dark:bg-red-500/10 dark:text-red-300" data-testid="tech-risk">
                <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden /> {view.risk}
              </p>
            )}
            <ul className="grid gap-2">
              {view.groups.map((g) => <Group key={g.key} group={g} onRfq={onRfq} />)}
            </ul>
            {(view.cost || view.skipped > 0) && (
              <p className="flex flex-wrap gap-x-3 gap-y-0.5 text-xs text-muted-foreground">
                {view.cost && (
                  <span data-testid="tech-cost-total">
                    Nákup podle kroků: <strong className="text-foreground">{formatMoney(view.cost.amount, view.cost.currency)}</strong>
                    {view.cost.pending ? ` · ${view.cost.pending} ${view.cost.pending === 1 ? "cena chybí" : "ceny chybí"}` : ""}
                  </span>
                )}
                {view.skipped > 0 && <span>{view.skipped} {view.skipped === 1 ? "krok přeskočen" : "kroky přeskočeny"}</span>}
              </p>
            )}
            <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between sm:gap-4">
              {next ? <NextButton next={next} onRun={run} /> : <span />}
              <a href="?tab=vyroba" onClick={openProductionTab} className={cn(TAB_LINK, "shrink-0 self-start sm:self-auto sm:whitespace-nowrap")}>
                Celý postup v záložce Technologie <ArrowRight className="h-3 w-3" aria-hidden />
              </a>
            </div>
          </>
        )}
        <ExtraFields job={job} />
      </div>
    </section>
  );
}
