"use client";

import * as React from "react";
import { ArrowRightCircle, Flag, PackageCheck, Plus } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import type { OperationKind } from "@/lib/jobs/operations";
import { shortDay } from "@/lib/jobs/production-suggest";
import { stageMeta } from "@/lib/jobs/stages";
import type { HandoffPlan } from "@/lib/jobs/production-handoff-types";
import type { JobStage } from "@/lib/supabase/database.types";
import { cn } from "@/lib/utils";
import { KindGrid } from "../operation-dialog";
import { receiptPartial, whoName, type HandoffState } from "./handoff-model";

function RadioCard({ on, onPick, icon: Icon, title, sub, testId }: {
  on: boolean; onPick: () => void; icon: typeof Flag; title: string; sub?: string | null; testId?: string;
}) {
  return (
    <button
      type="button"
      role="radio"
      aria-checked={on}
      onClick={onPick}
      data-testid={testId}
      className={cn(
        "flex w-full items-start gap-2.5 rounded-xl border-2 px-3 py-2.5 text-left transition",
        on ? "border-green-500 bg-green-50/70 dark:bg-green-500/10" : "border-border hover:border-foreground/30",
      )}
    >
      <span className={cn("mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full border-2", on ? "border-green-600" : "border-muted-foreground/40")}>
        {on && <span className="h-2.5 w-2.5 rounded-full bg-green-600" />}
      </span>
      <Icon className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" />
      <span className="min-w-0">
        <span className="block text-sm font-semibold">{title}</span>
        {sub && <span className="block text-xs text-muted-foreground">{sub}</span>}
      </span>
    </button>
  );
}

/** Text připraveného dalšího kroku: „Tepelné zpracování · TepKal · mezitermín 19. 11.". */
export function nextStepText(state: HandoffState, label: string | undefined): string | null {
  const s = state.steps[0];
  if (!s) return null;
  const firm = whoName(s.who);
  return [label, firm, s.plannedEnd ? `${s.endsAtCustomerDate ? "konečný termín" : "mezitermín"} ${shortDay(s.plannedEnd)}` : null].filter(Boolean).join(" · ");
}

/**
 * „Posunout dál": připravený další krok / jiný další krok / ukončit výrobu (radio karty).
 * Kroky samotné vykreslí dialog; tady jen volba a převzetí od dodavatele.
 */
export function AdvanceOptions({
  plan, state, nextLabel, hasPlannedNext, onNext, onOther, onFinish,
}: {
  plan: HandoffPlan;
  state: HandoffState;
  nextLabel?: string;
  /** Plán obsahuje připravený čekající krok. */
  hasPlannedNext: boolean;
  onNext: () => void;
  onOther: (kind: OperationKind) => void;
  onFinish: () => void;
}) {
  const [kindPick, setKindPick] = React.useState(false);
  return (
    <div role="radiogroup" aria-label="Kam díl jde dál" className="space-y-2">
      {hasPlannedNext && (
        <RadioCard on={state.advance === "next"} onPick={onNext} icon={ArrowRightCircle} testId="advance-next"
          title={`Další krok: ${nextStepText(state, nextLabel) ?? "—"}`} sub="Připravený krok postupu — zkontroluj kdo a termín." />
      )}
      <RadioCard on={state.advance === "other"} onPick={() => setKindPick(true)} icon={Plus} testId="advance-other"
        title="Jiný další krok…" sub="Vloží se hned za aktuální krok (jiná operace / firma)." />
      {kindPick && (
        <div className="rounded-xl border bg-muted/30 p-2">
          <p className="mb-1.5 px-1 text-xs font-medium text-muted-foreground">Co se dělá v dalším kroku?</p>
          <KindGrid value={null} onPick={(k) => { setKindPick(false); onOther(k); }} />
        </div>
      )}
      <RadioCard on={false} onPick={onFinish} icon={Flag} testId="advance-finish" title="Ukončit výrobu" sub="Díly jsou hotové — výroba končí (zbylé kroky se přeskočí)." />
    </div>
  );
}

/** Převzetí od dodavatele (jen obchodník / admin): po položkách, plné množství předvyplněné. */
export function ReceiptBlock({ plan, state, onChange, nextFirm }: {
  plan: HandoffPlan; state: HandoffState; onChange: (s: HandoffState) => void; nextFirm?: string | null;
}) {
  const po = plan.current?.purchaseOrder ?? null;
  if (!plan.permissions.canReceive || !po || !po.items.length || !["vystavena", "odeslana", "potvrzena"].includes(po.status)) return null;
  const from = plan.current?.location ?? "dodavatele";
  const partial = receiptPartial(plan, state);
  const direct = nextFirm && nextFirm !== from && nextFirm !== "U nás";
  return (
    <section className="space-y-2 rounded-xl border bg-muted/30 p-3" aria-label="Převzetí od dodavatele">
      {/* na mobilu celé jméno firmy, objednávka pod ním (ne vlastní sloupec) */}
      <h4 className="flex items-start gap-1.5 text-sm font-semibold">
        <PackageCheck className="mt-0.5 h-4 w-4 shrink-0 text-green-600" />
        <span className="min-w-0">
          <span className="block break-words">Převzato od {from}</span>
          <span className="block text-xs font-normal text-muted-foreground">objednávka {po.number}</span>
        </span>
      </h4>
      {direct && <p className="text-xs text-muted-foreground">Když {from} dodává přímo do {nextFirm}, potvrď jen, kolik kusů odešlo.</p>}
      <ul className="space-y-1.5">
        {po.items.map((it) => (
          <li key={it.id} className="flex flex-wrap items-center gap-2 text-sm">
            <span className="min-w-0 flex-1 truncate font-medium">{it.label}</span>
            <Input
              type="number"
              inputMode="decimal"
              min={0}
              step="any"
              aria-label={`Převzato ${it.label}`}
              value={String(state.receipts[it.id] ?? it.quantity)}
              onChange={(e) => onChange({ ...state, receipts: { ...state.receipts, [it.id]: Number(e.target.value) } })}
              className="h-11 w-24 text-right text-base tabular-nums sm:h-9 sm:text-sm"
            />
            <span className="w-16 text-xs text-muted-foreground">/ {it.quantity} {it.unit}</span>
          </li>
        ))}
      </ul>
      {partial && (
        <div role="radiogroup" aria-label="Neúplné převzetí" className="space-y-1.5 pt-1">
          <label className="flex min-h-11 cursor-pointer items-center gap-2 text-sm sm:min-h-9">
            <input type="radio" name="rest" className="h-4 w-4 accent-green-600" checked={!state.continueWithoutRest} onChange={() => onChange({ ...state, continueWithoutRest: false })} />
            Počkat na zbytek (krok běží dál)
          </label>
          <label className="flex min-h-11 cursor-pointer items-center gap-2 text-sm sm:min-h-9">
            <input type="radio" name="rest" className="h-4 w-4 accent-green-600" checked={state.continueWithoutRest} onChange={() => onChange({ ...state, continueWithoutRest: true })} />
            Poslat dál i bez zbytku — zbytek dorazí později
          </label>
        </div>
      )}
    </section>
  );
}

const FINISH_TARGETS: { stage: JobStage; title: string; sub: string }[] = [
  { stage: "dodano_k_nam", title: "Díly jsou u nás — připravit k expedici", sub: "Hotové díly jsou u nás — od dodavatele nebo z naší výroby." },
  { stage: "na_sklade", title: "Na sklad", sub: "Díly jdou na sklad." },
  { stage: "montaz", title: "Montáž / kompletace", sub: "Díly jdou do montáže." },
];

/** Ukončit výrobu: kam díly jdou, zbylé kroky (důvod), odeslané objednávky (storno). */
export function FinishOptions({ plan, state, onChange }: { plan: HandoffPlan; state: HandoffState; onChange: (s: HandoffState) => void }) {
  const remaining = plan.client?.remaining ?? [];
  const targets = FINISH_TARGETS.some((t) => t.stage === state.finishTarget) || !plan.target
    ? FINISH_TARGETS
    : [...FINISH_TARGETS, { stage: plan.target, title: stageMeta(plan.target).label, sub: "Stav, kam jsi zakázku přetáhl." }];
  const sent = remaining.map((r) => r.purchaseOrder).filter((p): p is NonNullable<typeof p> => Boolean(p && (p.status === "odeslana" || p.status === "potvrzena")));
  const skipDelivery = ["dodano_zakaznikovi", "fakturovano", "dokonceno"].includes(state.finishTarget);
  return (
    <div className="space-y-3">
      <div role="radiogroup" aria-label="Kam díly jdou" className="space-y-1.5">
        {targets.map((t) => (
          <RadioCard key={t.stage} on={state.finishTarget === t.stage} onPick={() => onChange({ ...state, finishTarget: t.stage })} icon={Flag} title={t.title} sub={t.sub} />
        ))}
      </div>
      {skipDelivery && (
        <div className="space-y-1">
          <label className="block text-xs font-semibold text-muted-foreground" htmlFor="finish-skip-note">Proč přeskakuješ dodání? *</label>
          <Textarea id="finish-skip-note" rows={2} value={state.note} onChange={(e) => onChange({ ...state, note: e.target.value })} className="text-base sm:text-sm" />
        </div>
      )}
      {remaining.length > 0 && (
        <div className="space-y-1.5 rounded-xl border border-amber-300 bg-amber-50 p-3 text-sm dark:border-amber-500/40 dark:bg-amber-500/10">
          <p className="font-semibold text-amber-900 dark:text-amber-200">Zbývající kroky ({remaining.length}) se přeskočí</p>
          <ul className="list-disc pl-5 text-xs text-amber-900/90 dark:text-amber-200/90">
            {remaining.map((r) => <li key={r.id}>{r.label}{r.location && r.location !== "—" ? ` · ${r.location}` : ""}{r.purchaseOrder ? ` · objednávka ${r.purchaseOrder.number}` : ""}</li>)}
          </ul>
          <label className="block pt-1 text-xs font-semibold text-amber-900 dark:text-amber-200" htmlFor="finish-reason">Proč končíš dřív? *</label>
          <Textarea id="finish-reason" rows={2} value={state.skipReason} onChange={(e) => onChange({ ...state, skipReason: e.target.value })} className="bg-background text-base sm:text-sm" />
          {sent.map((p) => (
            <label key={p.id} className="flex min-h-11 cursor-pointer items-center gap-2 text-sm sm:min-h-9">
              <input type="checkbox" className="h-4 w-4 accent-red-600" disabled={!plan.permissions.canCancelSent}
                checked={state.cancelSent.includes(p.id)}
                onChange={(e) => onChange({ ...state, cancelSent: e.target.checked ? [...state.cancelSent, p.id] : state.cancelSent.filter((x) => x !== p.id) })} />
              Zrušit i odeslanou objednávku {p.number}? (dodavatel dostane storno e-mailem)
            </label>
          ))}
        </div>
      )}
    </div>
  );
}

