"use client";

import * as React from "react";
import {
  AlertTriangle, ArrowRight, Building2, CheckCircle2, ChevronDown, ClipboardList, Info, Link2, Loader2, Plus, Search, XCircle,
} from "lucide-react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { StageBadge } from "@/components/jobs/stage-badge";
import { StagePicker } from "@/components/jobs/book/stage-picker";
import { GROUP_BAR, Segmented, SideBadge, TONES } from "@/components/jobs/capture/capture-parts";
import { CaptureReviewForm, TargetCard } from "@/components/jobs/capture/capture-review-form";
import { batchJobsRequest } from "@/components/jobs/capture/capture-client";
import { normalizeSearch } from "@/components/jobs/book/combobox";
import { BATCH_TYPES } from "@/lib/jobs/capture-batch";
import {
  defaultCustomerChoice, defaultSupplierChoice, switchTarget,
  type ChipGroup, type ReviewModel, type ReviewOptions, type ReviewTarget,
} from "@/lib/jobs/capture-review";
import { nextStage, stageMeta } from "@/lib/jobs/stages";
import type {
  BatchApplyState, BatchDocDraft, BatchGroupReview, BatchGroupState, BatchWarning, BatchWarningAction,
} from "@/lib/jobs/capture-batch-types";
import { warningResolved } from "@/components/jobs/capture/capture-flow";
import { plural } from "@/lib/jobs/deadlines";
import { cn } from "@/lib/utils";

/**
 * Hlavička skupiny dávky = jedna zakázka: cíl (radiogroup „Zakázka" + hledání jiné),
 * stav (nejvyšší z dokladů), zákazník, důvod samostatné skupiny, upozornění s akcemi
 * a sbalitelné „Údaje zakázky" (vložený kontrolní formulář).
 */

type Jobs = ReviewOptions["jobs"];

/** Hledání zakázky: hned v posledních zakázkách, po 2 znacích i na serveru. */
function JobSearch({ base, exclude, onPick, disabled }: { base: Jobs; exclude: string[]; onPick: (id: string) => void; disabled?: boolean }) {
  const [q, setQ] = React.useState("");
  const [open, setOpen] = React.useState(false);
  const [remote, setRemote] = React.useState<Jobs>([]);
  const [loading, setLoading] = React.useState(false);
  const listId = React.useId();

  React.useEffect(() => {
    const query = q.trim();
    if (query.length < 2) {
      setRemote([]);
      return;
    }
    const ctrl = new AbortController();
    const t = window.setTimeout(() => {
      setLoading(true);
      batchJobsRequest(query, ctrl.signal)
        .then((res) => {
          if (!ctrl.signal.aborted && res.ok) setRemote(res.jobs);
        })
        .catch(() => {})
        .finally(() => {
          if (!ctrl.signal.aborted) setLoading(false);
        });
    }, 250);
    return () => {
      ctrl.abort();
      window.clearTimeout(t);
    };
  }, [q]);

  const tokens = normalizeSearch(q).split(/\s+/).filter(Boolean);
  const seen = new Set(exclude);
  const results: Jobs = [];
  for (const j of [...remote, ...base]) {
    if (seen.has(j.id)) continue;
    const h = normalizeSearch(`${j.number} ${j.title} ${j.customerName ?? ""}`);
    if (tokens.length && !tokens.every((t) => h.includes(t))) continue;
    seen.add(j.id);
    results.push(j);
    if (results.length >= 20) break;
  }

  return (
    <div className="relative" data-combobox-open={open ? "" : undefined}>
      <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
      <Input
        role="combobox"
        aria-label="Vybrat jinou zakázku"
        aria-expanded={open}
        aria-controls={listId}
        aria-autocomplete="list"
        value={q}
        disabled={disabled}
        onChange={(e) => {
          setQ(e.target.value);
          setOpen(true);
        }}
        onFocus={() => setOpen(true)}
        onBlur={() => window.setTimeout(() => setOpen(false), 150)}
        onKeyDown={(e) => {
          if (e.key === "Escape" && open) {
            e.stopPropagation();
            setOpen(false);
          }
        }}
        placeholder="Jiná zakázka — hledej číslo, zákazníka, název…"
        className="h-10 pl-9"
        autoComplete="off"
      />
      {loading && <Loader2 className="absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 animate-spin text-sky-600" />}
      {open && (
        <ul id={listId} role="listbox" className="absolute inset-x-0 top-full z-20 mt-1 max-h-64 overflow-y-auto rounded-xl border bg-popover p-1 shadow-lg scrollbar-thin">
          {results.length === 0 ? (
            <li className="px-3 py-2 text-xs text-muted-foreground">{q.trim().length < 2 ? "Napiš aspoň 2 znaky…" : "Nic nenalezeno"}</li>
          ) : results.map((j) => (
            <li key={j.id} role="option" aria-selected={false}>
              <button
                type="button"
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => {
                  setOpen(false);
                  setQ("");
                  onPick(j.id);
                }}
                className="flex w-full flex-col items-start rounded-lg px-3 py-1.5 text-left text-sm hover:bg-accent"
              >
                <span><span className="font-mono font-semibold">{j.number}</span> — {j.title || "bez názvu"}</span>
                <span className="text-xs text-muted-foreground">{[j.customerName, stageMeta(j.stage).label].filter(Boolean).join(" · ")}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function groupSide(docs: BatchDocDraft[], primaryDocId: string | null): ChipGroup {
  const primary = docs.find((d) => d.id === primaryDocId);
  const first = primary ?? docs.find((d) => BATCH_TYPES[d.type].side !== "none") ?? docs[0];
  if (!first) return "ostatni";
  const side = BATCH_TYPES[first.type].side;
  return side === "supplier" ? "dodavatel" : side === "customer" ? "zakaznik" : "ostatni";
}

function docsWord(n: number): string {
  return `${n} ${n === 1 ? "doklad" : n < 5 ? "doklady" : "dokladů"}`;
}

export interface GroupHeaderProps {
  index: number;
  group: BatchGroupReview;
  state: BatchGroupState;
  apply: BatchApplyState;
  docs: BatchDocDraft[];
  options: ReviewOptions;
  margins: boolean;
  aiUsed: boolean;
  fixedJobId: string | null;
  warnings: BatchWarning[];
  /** Všechny doklady skupiny už uložené (po částečném uložení). */
  locked: boolean;
  picking: boolean;
  onChange: (s: BatchGroupState) => void;
  onPickJob: (jobId: string) => void;
  onAction: (w: BatchWarning, a: BatchWarningAction) => void;
}

export function CaptureGroupHeader({
  index, group, state, apply, docs, options, margins, aiUsed, fixedJobId, warnings, locked, picking, onChange, onPickJob, onAction,
}: GroupHeaderProps) {
  const side = groupSide(docs, group.primaryDocId);
  const targets = group.model.targets;
  const target: ReviewTarget | null = targets.find((t) => t.key === state.job.targetKey) ?? null;
  const open = warnings.filter((w) => !warningResolved(w, apply));
  const autoOpen = !aiUsed || open.some((w) => w.severity !== "info") || (group.model.confidence ?? 1) < 0.85;
  const [dataOpen, setDataOpen] = React.useState(autoOpen);
  const fullModel: ReviewModel = { ...group.model, options, previews: [] };
  const fb = {
    customer: defaultCustomerChoice({ mode: "new", customerId: null, customerName: null }, group.model.customerMatch, group.model.docCustomer),
    supplier: defaultSupplierChoice({ mode: "new", supplierId: null, supplierName: null }, group.model.supplierMatch, group.model.docSupplier),
  };
  const choose = (to: ReviewTarget) => {
    if (to.key === state.job.targetKey) return;
    const from = target ?? to;
    onChange({ ...state, job: switchTarget(state.job, from, to, fb.customer, fb.supplier) });
  };
  const fixed = Boolean(fixedJobId && state.job.targetKey === fixedJobId);
  const from = target?.mode === "existing" ? target.stage : null;
  const moveTo = state.job.stage !== "keep" ? state.job.stage : target?.stageTo ?? ((from && nextStage(from)) || from || "poptavka");
  const itemsCount = state.job.items.length;
  const fieldsCount = Object.values(state.job.fields).filter((v) => v?.trim()).length;
  const customer = state.job.customer;
  const customerLine = target?.mode === "existing" && target.customerName
    ? target.customerName
    : customer.mode === "existing" ? customer.name : customer.mode === "new" ? `${customer.party.name || "nový zákazník"} (nový)` : "bez zákazníka";
  const primary = docs.find((d) => d.id === group.primaryDocId);
  const idPrefix = `cap-${group.key}`;

  return (
    <section
      role="region"
      aria-label={`Zakázka ${index}`}
      data-testid="capture-group"
      data-group-key={group.key}
      data-target={state.job.targetKey}
      className="relative overflow-hidden rounded-2xl border-2 bg-card p-3 pl-4 shadow-sm sm:p-4 sm:pl-5"
    >
      <span aria-hidden className={cn("absolute inset-y-0 left-0 w-1.5", GROUP_BAR[side])} />
      <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
        <h3 className="text-sm font-bold">Zakázka {index}</h3>
        <SideBadge group={side} />
        <span className="text-xs text-muted-foreground">· {docsWord(docs.length)}</span>
        {group.label && <span className="min-w-0 truncate text-xs font-medium text-foreground/80">· {group.label}</span>}
        {locked && <span className={cn("ml-auto inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-semibold", TONES.emerald)}><CheckCircle2 className="h-3.5 w-3.5" /> uloženo</span>}
      </div>
      {group.autoReason && (
        <p className="mt-1 flex items-start gap-1.5 text-xs text-sky-800 dark:text-sky-300">
          <Link2 className="mt-0.5 h-3.5 w-3.5 shrink-0" /> Samostatná zakázka: {group.autoReason}
        </p>
      )}

      <fieldset disabled={locked} className="mt-3 min-w-0 space-y-3">
        {/* Cíl */}
        <div>
          <p className="mb-1.5 text-xs font-semibold text-muted-foreground">Ke které zakázce?</p>
          {!state.job.targetKey && (
            <p className="mb-2 flex items-start gap-1.5 rounded-lg bg-red-50 p-2 text-xs font-medium text-red-800 dark:bg-red-500/10 dark:text-red-200">
              <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" /> Vyber zakázku{primary?.documentNumber ? ` pro ${primary.documentNumber}` : ""} — podle dokladů ji nešlo jistě určit.
            </p>
          )}
          <div role="radiogroup" aria-label="Zakázka" className="space-y-2">
            {targets.map((t) => (
              <TargetCard key={t.key} t={t} selected={t.key === state.job.targetKey} fixed={fixed} onSelect={() => choose(t)} />
            ))}
          </div>
          {!fixed && (
            <div className="mt-2 flex items-center gap-2">
              <div className="min-w-0 flex-1">
                <JobSearch base={options.jobs} exclude={targets.map((t) => t.key)} onPick={onPickJob} disabled={picking || locked} />
              </div>
              {picking && <Loader2 className="h-4 w-4 shrink-0 animate-spin text-sky-600" />}
            </div>
          )}
        </div>

        {!group.primaryDocId && state.job.targetKey === "new" && (
          <div>
            <label htmlFor={`${idPrefix}-draft`} className="mb-1 block text-xs font-medium text-muted-foreground">Název nové zakázky</label>
            <Input
              id={`${idPrefix}-draft`}
              value={state.job.fields.title ?? state.jobDraftTitle}
              maxLength={300}
              // název jde rovnou do údajů zakázky (kontrola uložení i server čtou fields.title)
              onChange={(e) => onChange({ ...state, jobDraftTitle: e.target.value, job: { ...state.job, fields: { ...state.job.fields, title: e.target.value } } })}
              placeholder="název zakázky"
              autoComplete="off"
            />
          </div>
        )}

        {/* Stav */}
        {target && (
          <div>
            <p className="mb-1.5 text-xs font-semibold text-muted-foreground">Stav (nejvyšší z dokladů)</p>
            <div className="flex flex-wrap items-center gap-2">
              {from ? <StageBadge stage={from} size="md" /> : (
                <span className={cn("inline-flex items-center gap-1 rounded-full px-3 py-1 text-sm font-medium", TONES.emerald)}>
                  <Plus className="h-4 w-4" /> Nová zakázka
                </span>
              )}
              <ArrowRight className="h-4 w-4 text-muted-foreground" />
              {state.job.stage === "keep" ? (
                <span className="text-sm text-muted-foreground">beze změny</span>
              ) : (
                <StagePicker value={state.job.stage} onChange={(s) => onChange({ ...state, job: { ...state.job, stage: s } })} className="w-auto min-w-[13rem]" />
              )}
            </div>
            {target.mode === "existing" && (
              <Segmented
                className="mt-2"
                value={state.job.stage === "keep" ? "keep" : "move"}
                onChange={(v) => onChange({ ...state, job: { ...state.job, stage: v === "keep" ? "keep" : moveTo } })}
                options={[{ value: "keep", label: "Neměnit" }, { value: "move", label: "Posunout stav" }]}
              />
            )}
          </div>
        )}

        {/* Zákazník */}
        <p className="flex items-center gap-1.5 text-sm">
          <Building2 className="h-4 w-4 shrink-0 text-orange-600 dark:text-orange-400" />
          <span className="text-muted-foreground">Zákazník:</span>
          <span className="min-w-0 truncate font-medium">{customerLine}</span>
        </p>

        {/* Upozornění */}
        {open.length > 0 && (
          <ul className="space-y-1.5">
            {open.map((w) => (
              <li
                key={w.id}
                className={cn(
                  "rounded-xl border p-2.5 text-xs",
                  w.severity === "block"
                    ? "border-red-200 bg-red-50 text-red-900 dark:border-red-500/30 dark:bg-red-500/10 dark:text-red-100"
                    : w.severity === "warn"
                      ? "border-amber-200 bg-amber-50 text-amber-950 dark:border-amber-500/30 dark:bg-amber-500/10 dark:text-amber-100"
                      : "border-sky-200 bg-sky-50 text-sky-950 dark:border-sky-500/30 dark:bg-sky-500/10 dark:text-sky-100",
                )}
              >
                <p className="flex items-start gap-1.5">
                  {w.severity === "block" ? <XCircle className="mt-0.5 h-3.5 w-3.5 shrink-0" /> : w.severity === "warn" ? <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0 text-amber-500" /> : <Info className="mt-0.5 h-3.5 w-3.5 shrink-0" />}
                  {w.message}
                </p>
                {w.actions.length > 0 && (
                  <div className="mt-1.5 flex flex-wrap gap-1.5">
                    {w.actions.map((a, i) => (
                      <Button key={i} type="button" size="sm" variant={i === 0 && w.severity !== "info" ? "default" : "outline"} className="h-8" onClick={() => onAction(w, a)}>
                        {a.label}
                      </Button>
                    ))}
                  </div>
                )}
              </li>
            ))}
          </ul>
        )}

        {/* Údaje zakázky */}
        {target && (
          <div className="rounded-xl border">
            <button
              type="button"
              aria-expanded={dataOpen}
              onClick={() => setDataOpen((x) => !x)}
              className="flex w-full items-center gap-2 px-3 py-2.5 text-left text-sm font-semibold"
            >
              <ChevronDown className={cn("h-4 w-4 transition-transform", !dataOpen && "-rotate-90")} />
              <ClipboardList className="h-4 w-4 text-amber-600" />
              <span className="flex-1">Údaje zakázky</span>
              <span className="text-xs font-normal text-muted-foreground">
                {fieldsCount} {plural(fieldsCount, "pole", "pole", "polí")} · {itemsCount} {plural(itemsCount, "položka", "položky", "položek")}
              </span>
            </button>
            {dataOpen && (
              <div className="border-t p-2 sm:p-3">
                <CaptureReviewForm
                  model={{ ...fullModel, margins }}
                  review={state.job}
                  targets={targets}
                  onChange={(job) => onChange({ ...state, job })}
                  onPickJob={onPickJob}
                  pickingJob={picking}
                  idPrefix={idPrefix}
                  embedded={{
                    visibleFields: group.visibleFields,
                    fieldSources: group.fieldSources,
                    itemSources: group.itemSources,
                    hideTarget: true,
                    hideStage: true,
                    hideKind: true,
                  }}
                />
              </div>
            )}
          </div>
        )}
      </fieldset>
    </section>
  );
}
