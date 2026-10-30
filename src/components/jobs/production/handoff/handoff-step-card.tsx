"use client";

import * as React from "react";
import { AlertTriangle, CalendarClock, ChevronDown, FileText, Flag, Home, Loader2, PencilLine, Phone, Play, Search, Trash2 } from "lucide-react";
import { Input } from "@/components/ui/input";
import { recordPhoneQuote } from "@/app/actions/production-handoff";
import { OPERATION_KINDS, type OperationKind } from "@/lib/jobs/operations";
import { money, shortDay } from "@/lib/jobs/production-suggest";
import type { HandoffPlan, StepWho, WhoSuggestion } from "@/lib/jobs/production-handoff-types";
import { cn } from "@/lib/utils";
import { KindGrid } from "../operation-dialog";
import { WhoIcon, WhoPicker } from "../who-picker";
import type { WhoValue } from "../production-helpers";
import {
  applyPhoneQuote, coverHintOf, deadlineLine, finalDateOf, itemNoteOf, overlapWarning, patchStep, poLineOf, quickDate, roleOf, setEndsAtFinal, setStepDate,
  setStepKind, setStepWho, stepCounter, stepItems, whoKey, whoName, type DraftStep, type HandoffState,
} from "./handoff-model";
import { AiLabel, AlternativesList, PrimaryCard } from "./handoff-suggestions";

function toWhoValue(w: StepWho): WhoValue {
  if (w.type === "supplier") return { type: "supplier", id: w.id, name: w.name ?? "" };
  if (w.type === "free") return { type: "free", name: w.name };
  return w;
}

function Label({ children, required, htmlFor }: { children: React.ReactNode; required?: boolean; htmlFor?: string }) {
  return (
    <label htmlFor={htmlFor} className="mb-1.5 block text-xs font-semibold uppercase tracking-wide text-muted-foreground">
      {children}{required ? " *" : ""}
    </label>
  );
}

function StateBadge({ step, kind }: { step: DraftStep; kind: HandoffState["kind"] }) {
  const running = step.status === "probiha" || step.status === "problem";
  const text = kind === "zaznam" ? "Hotovo" : running ? "Běží" : step.start ? "Začíná teď" : "Připraveno";
  return (
    <span className={cn(
      "inline-flex shrink-0 items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-semibold",
      running ? "bg-amber-100 text-amber-800 dark:bg-amber-500/15 dark:text-amber-300"
        : step.start ? "bg-green-100 text-green-800 dark:bg-green-500/15 dark:text-green-300" : "bg-muted text-muted-foreground",
    )}>
      {step.start && <Play className="h-3 w-3 fill-current" />} {text}
    </span>
  );
}

/** Řádek „Díly: všechny (2)" / „Díly: 1 ze 2 (PR-7075-20)". */
function partsText(plan: HandoffPlan, step: DraftStep): string {
  const items = plan.client?.items ?? [];
  if (!step.orderItemIds) return `Díly: všechny (${items.length})`;
  const picked = items.filter((i) => step.orderItemIds!.includes(i.id));
  return `Díly: ${picked.length} ze ${items.length} (${picked.map((i) => i.drawingNumber || i.name || "díl").join(", ")})`;
}

/** Objednávka kroku: co se vystaví / použije / proč ne. */
function OrderLine({ plan, state, index, onChange }: { plan: HandoffPlan; state: HandoffState; index: number; onChange: (s: HandoffState) => void }) {
  const step = state.steps[index];
  const line = poLineOf(plan, state, index);
  const prices = plan.permissions.canSeePrices;
  const [reasonOpen, setReasonOpen] = React.useState(step.po.mode === "neobjednavat");
  const set = (po: DraftStep["po"]) => onChange(patchStep(state, index, { po }));
  const plural = (n: number) => `${n} ${n === 1 ? "položka" : n < 5 ? "položky" : "položek"}`;
  if (line.mode === "u_nas") return <p className="flex items-center gap-1.5 text-sm text-muted-foreground"><Home className="h-4 w-4 text-emerald-600" /> U nás — bez objednávky dodavateli</p>;
  if (line.mode === "none_who") return <p className="text-sm text-muted-foreground">Objednávka se vystaví, až vybereš firmu.</p>;
  return (
    <div className="space-y-1.5 text-sm">
      {line.mode === "existing" && (
        <>
          <p className="flex items-start gap-1.5 font-medium"><FileText className="mt-0.5 h-4 w-4 shrink-0 text-lime-600" /> Použije se vystavená objednávka {line.number}{line.supplierName ? ` (${line.supplierName})` : ""}</p>
        </>
      )}
      {line.mode === "new" && (
        <>
          <p className="flex items-start gap-1.5 font-medium" data-testid="handoff-po-line">
            <FileText className="mt-0.5 h-4 w-4 shrink-0 text-lime-600" /> Vytvoří se objednávka OV-… pro {line.supplierName ?? "dodavatele"} (PDF)
          </p>
          <p className="pl-5 text-xs text-muted-foreground">
            {plural(line.itemCount)}{prices && line.total !== null ? ` · ${money(line.total, line.currency)}` : ""}
            {line.requiredDate ? ` · požadovaný termín ${shortDay(line.requiredDate)}` : ""}
            {line.unpriced > 0 && prices ? ` · ${plural(line.unpriced)} bez ceny — dodavatel je nacení` : ""}
          </p>
          {prices && line.blockers.length > 0 && plan.automation.mode === "full" && (
            <p className="pl-5 text-xs text-amber-700 dark:text-amber-300">Automaticky neodejde: {line.blockers.join(" · ")}</p>
          )}
        </>
      )}
      {line.mode === "later" && (
        <div className="flex flex-wrap items-center gap-2">
          <p className="text-muted-foreground">Objednávka se vystaví, až díl půjde do tohoto kroku</p>
          {plan.stage !== "poptavka" && (
            <button type="button" onClick={() => set({ ...step.po, mode: step.po.mode ?? "pri_predani", orderNow: true })}
              className="inline-flex h-8 items-center rounded-full border px-3 text-xs font-semibold hover:bg-accent">
              Objednat hned
            </button>
          )}
        </div>
      )}
      {line.mode === "other" || reasonOpen ? (
        <div className="space-y-1">
          <label className="block text-xs font-medium text-muted-foreground" htmlFor={`po-reason-${step.key}`}>Objednáno jinak — jak? *</label>
          <Input
            id={`po-reason-${step.key}`}
            value={step.po.noneReason ?? ""}
            onChange={(e) => set({ ...step.po, mode: "neobjednavat", noneReason: e.target.value, existingId: null, orderNow: false })}
            placeholder="např. objednáno telefonicky, rámcová objednávka…"
            className="h-11 text-base sm:h-10 sm:text-sm"
            maxLength={500}
          />
          <button type="button" className="text-xs font-semibold text-sky-700 hover:underline dark:text-sky-400" onClick={() => { setReasonOpen(false); set({ mode: step.start ? "vystavit" : "pri_predani" }); }}>
            Ne, vystavit objednávku
          </button>
        </div>
      ) : (
        <div className="flex flex-wrap items-center gap-x-4 gap-y-1">
          {line.mode === "existing" && (
            <button type="button" className="min-h-8 text-xs font-semibold text-sky-700 hover:underline dark:text-sky-400" onClick={() => set({ mode: step.start ? "vystavit" : "pri_predani", existingId: null })}>
              Ne, vystavit novou objednávku
            </button>
          )}
          {state.kind !== "zaznam" && (
            <button type="button" className="min-h-8 text-xs font-semibold text-muted-foreground hover:text-foreground hover:underline" onClick={() => { setReasonOpen(true); set({ ...step.po, mode: "neobjednavat", noneReason: step.po.noneReason ?? "", existingId: null }); }}>
              Už objednáno jinak…
            </button>
          )}
        </div>
      )}
      {step.po.orderNow && line.mode === "new" && !step.start && (
        <button type="button" className="text-xs font-semibold text-muted-foreground hover:underline" onClick={() => set({ ...step.po, orderNow: false })}>
          Objednat až při předání tohoto kroku
        </button>
      )}
    </div>
  );
}

/** Jeden krok předání: co se dělá, kdo to dělá (nejlevnější nabídka předvyplněná), díly, termín, objednávka. */
export function HandoffStepCard({
  plan, state, index, label, expanded, onExpand, onChange, onRemove, jobId,
}: {
  /** Zakázka (nabídka telefonem); bez ní se volba nenabízí (náhled / testy). */
  jobId?: string;
  plan: HandoffPlan;
  state: HandoffState;
  index: number;
  label: string;
  expanded: boolean;
  onExpand: () => void;
  onChange: (s: HandoffState) => void;
  onRemove?: () => void;
}) {
  const step = state.steps[index];
  const prices = plan.permissions.canSeePrices;
  const [kindOpen, setKindOpen] = React.useState(false);
  const [pickerOpen, setPickerOpen] = React.useState(false);
  const [partsOpen, setPartsOpen] = React.useState(false);
  const [phoneOpen, setPhoneOpen] = React.useState(false);
  const ids = { date: React.useId() };
  const role = roleOf(plan, state.steps, index);
  const running = step.status === "probiha" || step.status === "problem";
  const later = !step.start && !running && state.kind !== "zaznam" && !(step.po.mode === "vystavit" || step.po.orderNow);
  const firm = whoName(step.who);
  const isLast = index === state.steps.length - 1;
  const fin = finalDateOf(plan, state);
  const today = plan.client?.today ?? "";
  const primary = step.suggestions.primary;
  const cur = whoKey(step.who);
  const meta = OPERATION_KINDS[step.kind];
  const KindIcon = meta.icon;
  // firma kroku má nabídku, která už kryje díly jiného kroku (kompletní dodávka / nabídka jiného kroku)
  const overlap = overlapWarning(plan, state, index);

  const pick =(who: StepWho, s?: WhoSuggestion | null) => {
    setPickerOpen(false);
    onChange(setStepWho(plan, state, index, who, s ?? null));
  };

  const header = (
    <div className="flex items-center gap-2">
      <span className={cn("flex h-8 w-8 shrink-0 items-center justify-center rounded-full", meta.badge)}><KindIcon className="h-4 w-4" /></span>
      <div className="min-w-0 flex-1">
        <p className="truncate text-[15px] font-semibold leading-tight">{stepCounter(plan, state.steps, index)} · {label}</p>
        {!expanded && (
          <p className="truncate text-xs text-muted-foreground">
            {firm ? `Kdo: ${firm}${role === "částečný dodavatel" ? " (částečný dodavatel)" : ""}` : "Kdo: zatím nevybráno"}
            {step.plannedEnd ? ` · ${step.endsAtCustomerDate ? "konečný termín" : "mezitermín"} ${shortDay(step.plannedEnd)}` : ""}
          </p>
        )}
      </div>
      <StateBadge step={step} kind={state.kind} />
    </div>
  );

  if (!expanded) {
    const line = poLineOf(plan, state, index);
    return (
      <section className="rounded-xl border bg-card p-3" aria-label={`${stepCounter(plan, state.steps, index)} · ${label}`}>
        {header}
        <div className="mt-2 space-y-0.5 pl-10 text-xs text-muted-foreground">
          {step.orderItemIds && <p>{partsText(plan, step)}</p>}
          <p>{deadlineLine(plan, state, index)}</p>
          <p>
            {line.mode === "later" ? "Objednávka se vystaví, až díl půjde do tohoto kroku"
              : line.mode === "new" ? `Vytvoří se objednávka OV-… pro ${line.supplierName ?? "dodavatele"} (PDF)`
                : line.mode === "existing" ? `Použije se vystavená objednávka ${line.number}`
                  : line.mode === "other" ? `Objednáno jinak: ${line.reason || "—"}` : line.mode === "u_nas" ? "U nás — bez objednávky" : ""}
          </p>
          {overlap && <OverlapWarning text={overlap} />}
        </div>
        <div className="mt-2 flex flex-wrap gap-1.5 pl-10">
          <button type="button" onClick={onExpand} className="inline-flex h-9 items-center gap-1 rounded-full border px-3 text-xs font-semibold hover:bg-accent sm:h-8">
            <PencilLine className="h-3.5 w-3.5" /> Upravit
          </button>
          {line.mode === "later" && (
            <button type="button" onClick={() => onChange(patchStep(state, index, { po: { ...step.po, orderNow: true } }))} className="inline-flex h-9 items-center rounded-full border px-3 text-xs font-semibold hover:bg-accent sm:h-8">
              Objednat hned
            </button>
          )}
          {onRemove && (
            <button type="button" onClick={onRemove} className="inline-flex h-9 items-center gap-1 rounded-full px-3 text-xs font-semibold text-red-600 hover:bg-red-50 dark:text-red-400 dark:hover:bg-red-500/10 sm:h-8">
              <Trash2 className="h-3.5 w-3.5" /> Odebrat krok
            </button>
          )}
        </div>
      </section>
    );
  }

  const items = plan.client?.items ?? [];
  return (
    <section className="space-y-4 rounded-xl border-2 border-foreground/10 bg-card p-3 shadow-sm sm:p-4" aria-label={`${stepCounter(plan, state.steps, index)} · ${label}`}>
      {header}

      {/* co se dělá */}
      <div>
        <Label>Co se dělá</Label>
        <div className="flex flex-wrap items-center gap-2">
          <span className={cn("inline-flex h-9 items-center gap-1.5 rounded-full px-3 text-sm font-medium", meta.badge)}><KindIcon className="h-4 w-4" /> {meta.label}</span>
          {step.locked === "none" && (
            <button type="button" onClick={() => setKindOpen((v) => !v)} aria-expanded={kindOpen} className="inline-flex h-9 items-center gap-1 rounded-full px-2.5 text-xs font-semibold text-sky-700 hover:bg-sky-50 dark:text-sky-400 dark:hover:bg-sky-500/10">
              Změnit <ChevronDown className={cn("h-3.5 w-3.5 transition-transform", kindOpen && "rotate-180")} />
            </button>
          )}
          {onRemove && (
            <button type="button" onClick={onRemove} className="ml-auto inline-flex h-9 items-center gap-1 rounded-full px-2.5 text-xs font-semibold text-red-600 hover:bg-red-50 dark:text-red-400 dark:hover:bg-red-500/10">
              <Trash2 className="h-3.5 w-3.5" /> Odebrat krok
            </button>
          )}
        </div>
        {kindOpen && (
          <KindGrid className="mt-2" value={step.kind} onPick={(k: OperationKind) => { setKindOpen(false); onChange(setStepKind(plan, state, index, k)); }} />
        )}
      </div>

      {/* kdo to dělá */}
      <div className="space-y-2">
        <div className="flex flex-wrap items-center gap-2">
          <Label required>{state.kind === "zaznam" ? "Kdo to vyrobil?" : "Kdo to dělá"}</Label>
          {primary && cur === whoKey(primary.who) && <AiLabel className="-mt-1.5" />}
        </div>
        {primary && stepHasPrimary(primary) && (
          <PrimaryCard s={primary} selected={cur === whoKey(primary.who)} canSeePrices={prices}
            date={cur === whoKey(primary.who) ? step.plannedEnd || null : null} onPick={() => pick(primary.who, primary)} />
        )}
        {!primary && step.who.type === "none" && (
          <p className="rounded-lg border border-dashed px-3 py-2 text-sm text-muted-foreground" data-testid="handoff-who-hint">
            {coverHintOf(plan, state, index) ?? "K tomuto kroku nemáme nabídku — vyber firmu, nebo „U nás“."}
          </p>
        )}
        {/* vybraná jiná nabídka (i nabídka telefonem) — vidět hned, ne až v rozbaleném seznamu */}
        {(() => {
          if (step.who.type === "none" || (primary && cur === whoKey(primary.who))) return null;
          const alt = step.suggestions.alternatives.find((a) => a.supplierQuoteId && a.supplierQuoteId === step.supplierQuoteId)
            ?? step.suggestions.alternatives.find((a) => whoKey(a.who) === cur);
          return alt ? <PrimaryCard s={alt} selected canSeePrices={prices} date={step.plannedEnd || null} onPick={() => pick(alt.who, alt)} /> : null;
        })()}
        {step.who.type !== "none" && (!primary || cur !== whoKey(primary.who)) && !step.suggestions.alternatives.some((a) => whoKey(a.who) === cur) && (
          <div className="flex min-h-11 items-center gap-2 rounded-xl border-2 border-green-500 bg-green-50/60 px-3 py-2 dark:bg-green-500/10">
            <WhoIcon who={toWhoValue(step.who)} className="h-4 w-4 shrink-0" />
            <span className="min-w-0 flex-1 truncate text-sm font-semibold">{firm}</span>
            {step.who.type === "free" && <span className="shrink-0 text-[11px] text-muted-foreground">mimo adresář — založí se v adresáři</span>}
            <span className="shrink-0 text-xs font-semibold text-green-700 dark:text-green-400">✓ vybráno ručně</span>
          </div>
        )}
        <div className="flex flex-wrap items-center gap-1.5">
          {/* bez předvyplněného návrhu (další výroba) jsou volby hned vidět — stejná firma / naposledy dělal */}
          <AlternativesList items={step.suggestions.alternatives} current={cur} canSeePrices={prices} onPick={(s) => pick(s.who, s)}
            defaultOpen={!primary && step.who.type === "none"} />
          <button
            type="button"
            onClick={() => pick({ type: "u_nas" })}
            aria-pressed={step.who.type === "u_nas"}
            className={cn("inline-flex h-9 items-center gap-1.5 rounded-full border px-3 text-sm font-medium transition",
              step.who.type === "u_nas" ? "border-emerald-500 bg-emerald-500 text-white" : "border-emerald-200 bg-emerald-50 text-emerald-800 hover:bg-emerald-100 dark:border-emerald-500/30 dark:bg-emerald-500/10 dark:text-emerald-300")}
          >
            <Home className="h-4 w-4" /> U nás
          </button>
          <button type="button" onClick={() => setPickerOpen((v) => !v)} aria-expanded={pickerOpen}
            className="inline-flex h-9 items-center gap-1.5 rounded-full border px-3 text-sm font-medium hover:bg-accent">
            <Search className="h-4 w-4" /> Jiná firma…
          </button>
          {state.kind !== "zaznam" && jobId && (
            <button type="button" onClick={() => setPhoneOpen((v) => !v)} aria-expanded={phoneOpen} data-testid="handoff-phone-open"
              className="inline-flex h-9 items-center gap-1.5 rounded-full border border-sky-200 bg-sky-50 px-3 text-sm font-medium text-sky-800 hover:bg-sky-100 dark:border-sky-500/30 dark:bg-sky-500/10 dark:text-sky-200">
              <Phone className="h-4 w-4" /> Nabídka telefonem…
            </button>
          )}
        </div>
        {phoneOpen && jobId && (
          <PhoneQuoteForm
            jobId={jobId}
            plan={plan}
            step={step}
            onCancel={() => setPhoneOpen(false)}
            onSaved={(sug) => { setPhoneOpen(false); onChange(applyPhoneQuote(plan, state, index, sug)); }}
          />
        )}
        {pickerOpen && (
          <WhoPicker
            value={toWhoValue(step.who)}
            onChange={(v) => pick(v.type === "supplier" ? { type: "supplier", id: v.id, name: v.name } : v)}
            suppliers={plan.client?.suppliers ?? []}
            label=""
            startOpen
            allowNone={later}
            noneLabel="Rozhodnu, až bude krok na řadě"
          />
        )}
        {role && role !== "u nás" && <p className="text-xs text-muted-foreground">Kdo: {firm} ({role})</p>}
        {overlap && <OverlapWarning text={overlap} />}
      </div>

      {/* díly */}
      {items.length > 1 && (
        <div className="space-y-1.5">
          <div className="flex flex-wrap items-center gap-2 text-sm">
            <span className="font-medium">{partsText(plan, step)}</span>
            <button type="button" onClick={() => setPartsOpen((v) => !v)} className="inline-flex h-8 items-center rounded-full border px-3 text-xs font-semibold hover:bg-accent">
              {partsOpen ? "Hotovo" : "Vybrat díly"}
            </button>
          </div>
          {partsOpen && (
            <ul className="grid gap-1 sm:grid-cols-2">
              {items.map((it) => {
                const on = !step.orderItemIds || step.orderItemIds.includes(it.id);
                return (
                  <li key={it.id}>
                    <label className="flex min-h-11 cursor-pointer items-center gap-2 rounded-lg border px-2.5 py-1.5 text-sm hover:bg-accent sm:min-h-9">
                      <input
                        type="checkbox"
                        className="h-4 w-4 accent-green-600"
                        checked={on}
                        onChange={(e) => {
                          const all = items.map((x) => x.id);
                          const curIds = step.orderItemIds ?? all;
                          const next = e.target.checked ? [...new Set([...curIds, it.id])] : curIds.filter((x) => x !== it.id);
                          onChange(patchStep(state, index, { orderItemIds: next.length === all.length ? null : next }));
                        }}
                      />
                      <span className="min-w-0 flex-1 truncate"><span className="font-medium">{it.drawingNumber || it.name || "Díl"}</span> · {it.quantity} {it.unit}</span>
                      {(it.heatTreatment || it.surfaceTreatment) && <span className="shrink-0 truncate text-[11px] text-muted-foreground">{it.heatTreatment ?? it.surfaceTreatment}</span>}
                    </label>
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      )}

      {/* termín */}
      <div className="space-y-1.5">
        <Label required htmlFor={ids.date}>{state.kind === "zaznam" ? "Hotovo dne" : "Termín kroku"}</Label>
        <div className="flex flex-wrap items-center gap-2">
          <Input
            id={ids.date}
            type="date"
            value={step.plannedEnd}
            min={running || state.kind === "zaznam" ? undefined : today || undefined}
            max={state.kind === "zaznam" ? today || undefined : undefined}
            onChange={(e) => onChange(setStepDate(plan, state, index, e.target.value))}
            className="h-11 w-auto min-w-[10.5rem] text-base sm:h-10 sm:text-sm"
            aria-describedby={`${ids.date}-cap`}
          />
          {step.deadlineCaption && (
            <span id={`${ids.date}-cap`} className="inline-flex items-center gap-1 text-xs text-muted-foreground">
              {step.autoDeadline && <AiLabel text="AI" className="px-1.5" />} {step.deadlineCaption}
            </span>
          )}
        </div>
        {state.kind !== "zaznam" && (
          <div className="flex flex-wrap gap-1.5">
            {([["3d", "+3 dny"], ["1w", "+1 týden"], ["2w", "+2 týdny"], ...(fin ? [["final", "= konečný termín"]] : [])] as [("3d" | "1w" | "2w" | "final"), string][]).map(([q, t]) => (
              <button
                key={q}
                type="button"
                onClick={() => {
                  const d = quickDate(plan, state, index, q);
                  if (!d) return;
                  onChange(q === "final" && isLast ? setEndsAtFinal(plan, state, index, true) : setStepDate(plan, state, index, d));
                }}
                className="inline-flex h-9 items-center rounded-full border px-3 text-xs font-medium hover:bg-accent sm:h-8"
              >
                {t}
              </button>
            ))}
          </div>
        )}
        {state.kind !== "zaznam" && (
          <p className={cn("flex items-center gap-1.5 text-sm font-medium", step.endsAtCustomerDate ? "text-rose-700 dark:text-rose-300" : "text-foreground/80")} data-testid="handoff-deadline-line">
            {step.endsAtCustomerDate ? <Flag className="h-4 w-4 shrink-0" /> : <CalendarClock className="h-4 w-4 shrink-0" />}
            {deadlineLine(plan, state, index)}
          </p>
        )}
        {state.kind !== "zaznam" && (step.who.type === "supplier" || step.who.type === "free") && !step.endsAtCustomerDate && (
          <label className="flex min-h-11 cursor-pointer items-center gap-2 text-sm sm:min-h-9">
            <input type="checkbox" className="h-4 w-4 accent-green-600" checked={step.deadlineAgreed}
              onChange={(e) => onChange(patchStep(state, index, { deadlineAgreed: e.target.checked }))} />
            Termín mám dohodnutý s {firm}
          </label>
        )}
        {state.kind !== "zaznam" && isLast && fin && (
          <label className="flex min-h-11 cursor-pointer items-center gap-2 text-sm sm:min-h-9">
            <input type="checkbox" className="h-4 w-4 accent-rose-600" checked={step.endsAtCustomerDate}
              onChange={(e) => onChange(setEndsAtFinal(plan, state, index, e.target.checked))} />
            Tento krok končí konečným termínem (zákazník) {shortDay(fin)}
          </label>
        )}
      </div>

      {/* poznámky pro dodavatele k dílům kroku (Technologie) — jdou do objednávky u položky */}
      {state.kind !== "zaznam" && (step.who.type === "supplier" || step.who.type === "free") && (
        <ItemNotes plan={plan} state={state} step={step} onChange={onChange} line={poLineOf(plan, state, index)} />
      )}

      {/* objednávka */}
      {state.kind !== "zaznam" && (
        <div>
          <Label>Objednávka dodavateli</Label>
          <OrderLine plan={plan} state={state} index={index} onChange={onChange} />
        </div>
      )}
    </section>
  );
}

/** Poznámky pro dodavatele u dílů kroku (z Technologie, jde upravit) — vytisknou se do objednávky. */
function ItemNotes({ plan, state, step, onChange, line }: {
  plan: HandoffPlan; state: HandoffState; step: DraftStep; onChange: (s: HandoffState) => void; line: ReturnType<typeof poLineOf>;
}) {
  const items = stepItems(plan, step);
  const filled = items.filter((it) => itemNoteOf(plan, state, it.id).trim()).length;
  const [open, setOpen] = React.useState(filled > 0);
  if (!items.length) return null;
  // co se s poznámkou stane: nová objednávka ji vytiskne; neodeslaná existující se doplní (nové PDF); odeslaná už ne
  const sent = line.mode === "existing" && (line.status === "odeslana" || line.status === "potvrzena" || line.status === "dodana");
  const where = sent
    ? `Objednávka ${line.mode === "existing" ? line.number : ""} už odešla — poznámku pošli dodavateli zvlášť (uloží se k položce v Technologii).`
    : line.mode === "existing"
      ? `Doplní se do objednávky ${line.number} u položky („Pozor: …“, nové PDF) a uloží se k položce (Technologie).`
      : "Vytiskne se do objednávky u položky („Pozor: …“) a uloží se k položce (Technologie).";
  return (
    <div className="space-y-1.5" data-testid="handoff-item-notes">
      <div className="flex flex-wrap items-center gap-2">
        <Label>Poznámky pro dodavatele</Label>
        <button type="button" onClick={() => setOpen((v) => !v)} aria-expanded={open}
          className="-mt-1.5 inline-flex h-8 items-center gap-1 rounded-full px-2 text-xs font-semibold text-sky-700 hover:bg-sky-50 dark:text-sky-400 dark:hover:bg-sky-500/10">
          {open ? "Skrýt" : filled ? `Zobrazit (${filled})` : "Přidat poznámku"} <ChevronDown className={cn("h-3.5 w-3.5 transition-transform", open && "rotate-180")} />
        </button>
      </div>
      {!open && filled > 0 && (
        <ul className="space-y-0.5 text-xs text-amber-800 dark:text-amber-300">
          {items.filter((it) => itemNoteOf(plan, state, it.id).trim()).map((it) => (
            <li key={it.id} className="truncate">Pozor · {it.drawingNumber || it.name || "díl"}: {itemNoteOf(plan, state, it.id)}</li>
          ))}
          {sent && <li className="whitespace-normal font-medium">{where}</li>}
        </ul>
      )}
      {open && (
        <ul className="space-y-1.5">
          {items.map((it) => (
            <li key={it.id}>
              <label className="block">
                <span className="mb-0.5 block text-xs font-medium">{it.drawingNumber || it.name || "Díl"} <span className="font-normal text-muted-foreground">· {it.quantity} {it.unit}</span></span>
                <Input
                  value={itemNoteOf(plan, state, it.id)}
                  maxLength={1000}
                  onChange={(e) => onChange({ ...state, itemNotes: { ...state.itemNotes, [it.id]: e.target.value } })}
                  placeholder="např. pozor popsat na čele · změna materiálu"
                  className="h-11 text-base sm:h-10 sm:text-sm"
                />
              </label>
            </li>
          ))}
          <li className={cn("text-[11px]", sent ? "font-medium text-amber-700 dark:text-amber-300" : "text-muted-foreground")} data-testid="handoff-item-notes-where">{where}</li>
        </ul>
      )}
    </div>
  );
}

/**
 * „Nabídka telefonem": firma (z adresáře nebo nová), cena (jen obchodník / admin), lhůta nebo datum
 * dodání, poznámka → nabídka dodavatele, kterou krok rovnou použije (kdo + termín + objednávka).
 */
function PhoneQuoteForm({ jobId, plan, step, onCancel, onSaved }: {
  jobId: string; plan: HandoffPlan; step: DraftStep; onCancel: () => void; onSaved: (s: WhoSuggestion) => void;
}) {
  const prices = plan.permissions.canSeePrices;
  const suppliers = plan.client?.suppliers ?? [];
  const firstName = step.who.type === "supplier" ? step.who.name ?? "" : step.who.type === "free" ? step.who.name : "";
  const [firm, setFirm] = React.useState(firstName);
  const [price, setPrice] = React.useState("");
  const [lead, setLead] = React.useState("");
  const [date, setDate] = React.useState("");
  const [note, setNote] = React.useState("");
  const [itemPrices, setItemPrices] = React.useState<Record<string, string>>({});
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const listId = React.useId();
  const exact = suppliers.find((s) => s.name.trim().toLowerCase() === firm.trim().toLowerCase()) ?? null;
  // víc dílů: cena za kus u každého dílu (objednávka potřebuje cenu položek — celková cena by se nepropsala)
  const parts = stepItems(plan, step);
  const perPart = prices && parts.length > 1;
  const parse = (v: string) => (v.trim() ? Number(v.replace(/\s/g, "").replace(",", ".")) : null);
  const partSum = perPart
    ? parts.reduce<{ sum: number; missing: number }>((acc, it) => {
      const p = parse(itemPrices[it.id] ?? "");
      return p !== null && Number.isFinite(p) && p > 0 ? { ...acc, sum: acc.sum + p * it.quantity } : { ...acc, missing: acc.missing + 1 };
    }, { sum: 0, missing: 0 })
    : null;

  async function save() {
    setError(null);
    if (firm.trim().length < 2) { setError("Napiš, od které firmy nabídka je."); return; }
    const leadDays = lead.trim() ? Number(lead.replace(",", ".")) : null;
    if (leadDays !== null && (!Number.isFinite(leadDays) || leadDays <= 0)) { setError("Lhůta je počet dní (např. 14)."); return; }
    const priceNum = prices && !perPart ? parse(price) : null;
    if (priceNum !== null && (!Number.isFinite(priceNum) || priceNum <= 0)) { setError("Cena musí být kladné číslo."); return; }
    const per: Record<string, number> = {};
    if (perPart) {
      for (const it of parts) {
        const p = parse(itemPrices[it.id] ?? "");
        if (p === null) continue;
        if (!Number.isFinite(p) || p <= 0) { setError(`Cena dílu ${it.drawingNumber || it.name || ""} musí být kladné číslo.`); return; }
        per[it.id] = p;
      }
    }
    const anyPrice = priceNum !== null || Object.keys(per).length > 0;
    if (!leadDays && !date && !anyPrice) { setError("Doplň aspoň termín (lhůtu nebo datum dodání)."); return; }
    setBusy(true);
    try {
      const r = await recordPhoneQuote(jobId, {
        ...(exact ? { supplierId: exact.id } : { supplierName: firm.trim() }),
        price: priceNum, ...(perPart ? { itemPrices: per } : {}), leadTimeDays: leadDays, deliveryDate: date || null, note: note.trim() || null,
        kind: step.kind, orderItemIds: step.orderItemIds,
      });
      if (!r.ok || !r.suggestion) { setError(r.error ?? "Nabídku se nepodařilo zapsat."); return; }
      onSaved(r.suggestion);
    } catch {
      setError("Spojení se nepovedlo — zkus to znovu.");
    } finally {
      setBusy(false);
    }
  }

  const field = "h-11 text-base sm:h-10 sm:text-sm";
  return (
    <div className="space-y-2.5 rounded-xl border border-sky-200 bg-sky-50/50 p-3 dark:border-sky-500/30 dark:bg-sky-500/5" data-testid="handoff-phone-form">
      <p className="flex items-center gap-1.5 text-sm font-semibold"><Phone className="h-4 w-4 text-sky-600" /> Nabídka telefonem</p>
      <label className="block">
        <span className="mb-0.5 block text-xs font-medium text-muted-foreground">Firma *</span>
        <Input value={firm} onChange={(e) => setFirm(e.target.value)} list={listId} placeholder="Dodavatel z adresáře, nebo nová firma" className={field} autoComplete="off" />
        <datalist id={listId}>{suppliers.map((s) => <option key={s.id} value={s.name} />)}</datalist>
        {firm.trim().length >= 2 && !exact && <span className="mt-0.5 block text-[11px] text-muted-foreground">Nová firma — založí se v adresáři dodavatelů.</span>}
      </label>
      {perPart && (
        <fieldset className="space-y-1.5" data-testid="handoff-phone-part-prices">
          <legend className="mb-0.5 text-xs font-medium text-muted-foreground">Cena za kus bez DPH — u každého dílu</legend>
          {parts.map((it) => (
            <label key={it.id} className="flex items-center gap-2">
              <span className="min-w-0 flex-1 truncate text-sm"><span className="font-medium">{it.drawingNumber || it.name || "Díl"}</span> <span className="text-muted-foreground">· {it.quantity} {it.unit}</span></span>
              <Input value={itemPrices[it.id] ?? ""} onChange={(e) => setItemPrices({ ...itemPrices, [it.id]: e.target.value })} inputMode="decimal"
                placeholder="Kč/ks" className="h-11 w-32 text-base sm:h-10 sm:text-sm" aria-label={`Cena za kus — ${it.drawingNumber || it.name || "díl"}`} />
            </label>
          ))}
          {partSum && partSum.sum > 0 && (
            <p className="text-xs text-muted-foreground" data-testid="handoff-phone-sum">
              Celkem {money(partSum.sum, plan.steps.find((x) => x.poPreview)?.poPreview?.currency ?? "CZK")}{partSum.missing ? ` · ${partSum.missing} ${partSum.missing === 1 ? "díl" : partSum.missing < 5 ? "díly" : "dílů"} bez ceny — dodavatel je nacení` : ""}
            </p>
          )}
        </fieldset>
      )}
      <div className={cn("grid gap-2", prices && !perPart ? "grid-cols-1 sm:grid-cols-3" : "grid-cols-1 sm:grid-cols-2")}>
        {prices && !perPart && (
          <label className="block">
            <span className="mb-0.5 block text-xs font-medium text-muted-foreground">Cena bez DPH (díly kroku)</span>
            <Input value={price} onChange={(e) => setPrice(e.target.value)} inputMode="decimal" placeholder="např. 12 400" className={field} />
          </label>
        )}
        <label className="block">
          <span className="mb-0.5 block text-xs font-medium text-muted-foreground">Lhůta (dní)</span>
          <Input value={lead} onChange={(e) => setLead(e.target.value)} inputMode="numeric" placeholder="např. 14" className={field} />
        </label>
        <label className="block">
          <span className="mb-0.5 block text-xs font-medium text-muted-foreground">nebo dodá do</span>
          <Input type="date" value={date} min={plan.client?.today} onChange={(e) => setDate(e.target.value)} className={field} />
        </label>
      </div>
      <label className="block">
        <span className="mb-0.5 block text-xs font-medium text-muted-foreground">Poznámka (kdo volal, co slíbil)</span>
        <Input value={note} onChange={(e) => setNote(e.target.value)} maxLength={900} placeholder="např. volal p. Dvořák, cena platí do pátku" className={field} />
      </label>
      {error && <p role="alert" className="text-sm text-red-600 dark:text-red-400">{error}</p>}
      <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
        <button type="button" onClick={onCancel} disabled={busy} className="inline-flex h-11 items-center justify-center rounded-md px-3 text-sm font-medium hover:bg-accent sm:h-9">Zrušit</button>
        <button type="button" onClick={() => void save()} disabled={busy} data-testid="handoff-phone-save"
          className="inline-flex h-11 items-center justify-center gap-1.5 rounded-md bg-sky-600 px-4 text-sm font-semibold text-white hover:bg-sky-700 disabled:opacity-60 sm:h-9">
          {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Phone className="h-4 w-4" />} Zapsat a použít
        </button>
      </div>
    </div>
  );
}

/** „Pozor: Hrubý má nabídku na kompletní dodávku — díly dělá i krok 1 (Výroba 1)…" (bez cen). */
function OverlapWarning({ text }: { text: string }) {
  return (
    <p className="flex items-start gap-1.5 rounded-lg bg-amber-50 px-2.5 py-1.5 text-xs font-medium text-amber-900 dark:bg-amber-500/10 dark:text-amber-200" data-testid="handoff-overlap-warning">
      <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" /> <span className="min-w-0">{text}</span>
    </p>
  );
}

function stepHasPrimary(s: WhoSuggestion): boolean {
  return s.who.type !== "none";
}
