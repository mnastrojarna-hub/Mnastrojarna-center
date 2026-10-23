"use client";

import * as React from "react";
import {
  AlertTriangle, ArrowRight, Building2, CalendarDays, ChevronDown, ClipboardList, FileStack, Hash, Info, Link2,
  Loader2, Package, Paperclip, PenLine, Plus, Sparkles, Trash2, Truck, UserX, Wallet, Contact, Flag, Check,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { StageBadge, FileKindBadge } from "@/components/jobs/stage-badge";
import { Combobox, type ComboOption } from "@/components/jobs/book/combobox";
import { NativeSelect } from "@/components/jobs/book/native-select";
import { StagePicker } from "@/components/jobs/book/stage-picker";
import {
  AI_FIELD, AiMark, ConfidenceMeter, FieldLabel, GROUP_TONE, LOCKED_FIELD, LockedMark, ScorePill, Section, Segmented,
  SOURCE_FIELD, SourceMark, TONES,
} from "@/components/jobs/capture/capture-parts";
import {
  CAPTURE_CHIPS, CHIP_GROUPS, MERGE_FIELD_LABELS, REVIEW_FIELDS, REVIEW_FIELD_KEYS, REVIEW_GROUPS, changeChip, chipByKey, defaultCustomerChoice,
  defaultSupplierChoice, emptyReviewItem, hiddenFieldCount, isAiValue, isFieldLocked, proposeStage, switchTarget,
  visibleFieldGroups,
  type MergeField, type PartyChoice, type ReviewFieldGroup, type ReviewFieldKey, type ReviewItem,
  type ReviewModel, type ReviewState, type ReviewTarget,
} from "@/lib/jobs/capture-review";
import { isSupplierSideDoc } from "@/lib/jobs/matching";
import { emptyParty } from "@/lib/jobs/extracted-normalize";
import { FILE_KINDS, FILE_KIND_ORDER } from "@/lib/jobs/file-kinds";
import { formatIsoDate } from "@/lib/jobs/field-labels";
import { nextStage, stageMeta } from "@/lib/jobs/stages";
import { cleanNumber } from "@/lib/jobs/mapping";
import type { ExtractedParty } from "@/lib/jobs/capture-types";
import type { FieldSource } from "@/lib/jobs/capture-batch-types";
import { cn, formatCZK } from "@/lib/utils";

/**
 * Krok 3 — kontrola. Vše, co AI navrhla, je předvyplněné (✨ fuchsiově),
 * člověk jen opraví výjimky. Bez AI je to stejný formulář, jen prázdný.
 */

const FIELD_GROUP_ICON: Record<ReviewFieldGroup, React.ComponentType<{ className?: string }>> = {
  zaklad: ClipboardList,
  cisla: Hash,
  terminy: CalendarDays,
  kontakt: Contact,
  hodnota: Wallet,
};

const CURRENCIES = ["CZK", "EUR", "USD", "GBP", "CHF", "PLN"];

function moneyLabel(v: string, currency = "CZK"): string | null {
  const n = cleanNumber(v);
  if (n === null) return null;
  if (currency === "CZK") return formatCZK(n);
  return `${new Intl.NumberFormat("cs-CZ", { maximumFractionDigits: 2 }).format(n)} ${currency}`;
}

function displayValue(key: ReviewFieldKey, v: string): string {
  const type = REVIEW_FIELDS[key].type;
  if (type === "date") return formatIsoDate(v) ?? v;
  if (type === "money") return moneyLabel(v) ?? v;
  return v;
}

/**
 * Vložený formulář „Údaje zakázky" ve skupině dávky: bez druhu dokladu, cíle, stavu
 * a souboru (ty řeší hlavička skupiny a sekce dokladů); pole podle `visibleFields`,
 * u doplněných údajů značka zdroje („z faktury FV-118").
 */
export interface CaptureReviewEmbedded {
  visibleFields: ReviewFieldKey[];
  fieldSources: Partial<Record<ReviewFieldKey, FieldSource>>;
  itemSources: Record<string, FieldSource[]>;
  hideTarget: true;
  hideStage: true;
  hideKind: true;
}

export interface CaptureReviewFormProps {
  model: ReviewModel;
  review: ReviewState;
  targets: ReviewTarget[];
  onChange: (review: ReviewState) => void;
  /** „Jiná zakázka…" — dialog načte návrh pro vybranou zakázku. */
  onPickJob: (jobId: string) => void;
  pickingJob: boolean;
  embedded?: CaptureReviewEmbedded;
  /** Předpona id polí (víc formulářů vedle sebe v dávce). */
  idPrefix?: string;
}

export function CaptureReviewForm({ model, review, targets, onChange, onPickJob, pickingJob, embedded, idPrefix = "cap" }: CaptureReviewFormProps) {
  const target = targets.find((t) => t.key === review.targetKey) ?? targets[0];
  // ve skupině dávky jsou zákaznická pole zakázky; dodavatele řeší sekce dokladů
  const supplierSide = !embedded && isSupplierSideDoc(review);
  const set = (patch: Partial<ReviewState>) => onChange({ ...review, ...patch });

  return (
    <div className={cn("space-y-3", !embedded && "pb-4")}>
      {!embedded && <Banner model={model} />}
      {!embedded?.hideKind && <KindSection model={model} review={review} target={target} onChange={onChange} />}
      {!embedded?.hideTarget && (
        <TargetSection model={model} review={review} targets={targets} target={target} onChange={onChange} onPickJob={onPickJob} pickingJob={pickingJob} />
      )}
      <CustomerSection model={model} review={review} target={target} idPrefix={idPrefix} onChange={(customer) => set({ customer })} />
      {supplierSide && <SupplierSection model={model} review={review} target={target} idPrefix={idPrefix} onChange={(supplier) => set({ supplier })} />}
      <FieldsSection model={model} review={review} target={target} embedded={embedded} idPrefix={idPrefix} onChange={(fields) => set({ fields })} />
      <ItemsSection model={model} review={review} target={target} supplierSide={supplierSide} itemSources={embedded?.itemSources} idPrefix={idPrefix} onChange={set} />
      {!embedded?.hideStage && <StageSection review={review} target={target} onChange={(stage) => set({ stage })} />}
      {!embedded && <FileSection review={review} onChange={set} />}
    </div>
  );
}

// ── Shrnutí AI / ruční režim ────────────────────────────────
function Banner({ model }: { model: ReviewModel }) {
  if (!model.aiUsed) {
    return (
      <div className="rounded-2xl border border-sky-200 bg-sky-50 p-3 text-sm text-sky-950 dark:border-sky-500/30 dark:bg-sky-500/10 dark:text-sky-100">
        <p className="flex items-start gap-2 font-medium">
          <PenLine className="mt-0.5 h-4 w-4 shrink-0 text-sky-600 dark:text-sky-300" />
          Vyplň, co vidíš na fotce — zabere to minutu.
        </p>
        {model.reason && <p className="mt-1 pl-6 text-xs text-sky-900/80 dark:text-sky-100/80">{model.reason}</p>}
        {model.needsClarification.length > 0 && <Clarifications items={model.needsClarification} />}
      </div>
    );
  }
  return (
    <div className="rounded-2xl border border-fuchsia-200 bg-gradient-to-br from-fuchsia-50 via-white to-violet-50 p-3 dark:border-fuchsia-500/30 dark:from-fuchsia-500/10 dark:via-transparent dark:to-violet-500/10">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="flex items-center gap-2 text-sm font-semibold">
          <Sparkles className="h-4 w-4 text-fuchsia-500" /> AI přečetla doklad
        </p>
        {model.confidence !== null && <ConfidenceMeter value={model.confidence} />}
      </div>
      {model.summary && <p className="mt-1.5 text-sm text-foreground/80">{model.summary}</p>}
      {model.needsClarification.length > 0 && <Clarifications items={model.needsClarification} />}
      <p className="mt-2 text-xs text-muted-foreground">
        <Info className="mr-1 inline h-3.5 w-3.5 align-[-3px]" />
        Zkontroluj hlavně údaje označené <Sparkles className="inline h-3 w-3 align-[-2px] text-fuchsia-500" /> a ulož. Co opravíš, to se AI naučí.
      </p>
    </div>
  );
}

function Clarifications({ items }: { items: string[] }) {
  return (
    <ul className="mt-2 space-y-1 rounded-xl border border-amber-200 bg-amber-50 p-2.5 text-xs text-amber-900 dark:border-amber-500/30 dark:bg-amber-500/10 dark:text-amber-100">
      {items.map((t, i) => (
        <li key={i} className="flex items-start gap-1.5">
          <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0 text-amber-500" />
          {t}
        </li>
      ))}
    </ul>
  );
}

// ── Druh dokladu ────────────────────────────────────────────
function KindSection({ model, review, target, onChange }: { model: ReviewModel; review: ReviewState; target: ReviewTarget; onChange: (r: ReviewState) => void }) {
  const chip = chipByKey(review.chip);
  const aiChip = model.aiUsed && review.chip === model.initial.chip;
  return (
    <Section
      icon={FileStack}
      tone="violet"
      title="Co je to za doklad?"
      hint="Podle toho se doklad zařadí a posune stav zakázky."
      action={aiChip ? <AiMark label="poznala AI" /> : undefined}
    >
      {model.aiUsed && !model.chipExact && review.chip === model.initial.chip && (
        <p className="mb-2 flex items-start gap-1.5 rounded-lg bg-amber-50 p-2 text-xs text-amber-900 dark:bg-amber-500/10 dark:text-amber-100">
          <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0 text-amber-500" />
          AI si není jistá, kdo doklad vystavil — zkontroluj, jestli je od zákazníka, od nás, nebo od dodavatele.
        </p>
      )}
      {!model.aiUsed && review.chip === "ostatni" && (
        <p className="mb-2 text-xs font-medium text-violet-700 dark:text-violet-300">👇 Vyber druh dokladu — formulář ukáže, co vyplnit.</p>
      )}
      <div className="space-y-2.5">
        {CHIP_GROUPS.map((g) => (
          <div key={g.key}>
            <p className={cn("mb-1 text-[11px] font-semibold uppercase tracking-wide", GROUP_TONE[g.key])}>{g.label}</p>
            <div className="flex flex-wrap gap-1.5">
              {CAPTURE_CHIPS.filter((c) => c.group === g.key).map((c) => {
                const fk = FILE_KINDS[c.fileKind];
                const Icon = fk.icon;
                const on = c.key === review.chip;
                return (
                  <button
                    key={c.key}
                    type="button"
                    aria-pressed={on}
                    title={c.hint}
                    onClick={() => onChange(changeChip(review, c.key, target))}
                    className={cn(
                      "inline-flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-xs font-medium transition",
                      on
                        ? cn(fk.badge, "border-transparent shadow-sm ring-2 ring-foreground/20 ring-offset-1 ring-offset-background")
                        : "bg-background text-foreground hover:bg-accent",
                    )}
                  >
                    {on ? <Check className="h-3.5 w-3.5" /> : <Icon className={cn("h-3.5 w-3.5", fk.text)} />}
                    {c.label}
                  </button>
                );
              })}
            </div>
          </div>
        ))}
      </div>
      <p className="mt-2.5 text-xs text-muted-foreground">
        <span className="font-medium text-foreground">{chip.label}:</span> {chip.hint}.
      </p>
    </Section>
  );
}

// ── Zakázka ─────────────────────────────────────────────────
function TargetSection({
  model, review, targets, target, onChange, onPickJob, pickingJob,
}: {
  model: ReviewModel;
  review: ReviewState;
  targets: ReviewTarget[];
  target: ReviewTarget;
  onChange: (r: ReviewState) => void;
  onPickJob: (jobId: string) => void;
  pickingJob: boolean;
}) {
  const fallbackCustomer = defaultCustomerChoice({ mode: "new", customerId: null, customerName: null }, model.customerMatch, model.docCustomer);
  const fallbackSupplier = defaultSupplierChoice({ mode: "new", supplierId: null, supplierName: null }, model.supplierMatch, model.docSupplier);
  const choose = (to: ReviewTarget) => {
    if (to.key === review.targetKey) return;
    onChange(switchTarget(review, target, to, fallbackCustomer, fallbackSupplier));
  };
  const jobOptions: ComboOption[] = React.useMemo(() => model.options.jobs
    .filter((j) => !targets.some((t) => t.key === j.id))
    .map((j) => ({
      value: j.id,
      label: `${j.number} — ${j.title || "bez názvu"}`,
      hint: [j.customerName, stageMeta(j.stage).label].filter(Boolean).join(" · "),
    })), [model.options.jobs, targets]);
  const existing = targets.filter((t) => t.mode === "existing");
  const best = existing[0];
  const hint = model.fixedJobId
    ? "Doklad nahráváš přímo u zakázky."
    : best && (best.score ?? 0) >= 60
      ? "Našla jsem zakázku, ke které doklad patří. Když nesedí, vyber jinou."
      : existing.length
        ? "Jistou shodu jsem nenašla — možná patří k některé z těchto, nebo založ novou."
        : model.aiUsed
          ? "Žádná podobná zakázka v knize není — založí se nová."
          : "Vyber zakázku, ke které doklad patří, nebo založ novou.";

  return (
    <Section icon={Link2} tone="sky" title="Ke které zakázce?" hint={hint}>
      <div role="radiogroup" aria-label="Zakázka" className="space-y-2">
        {targets.map((t) => (
          <TargetCard key={t.key} t={t} selected={t.key === review.targetKey} fixed={Boolean(model.fixedJobId)} onSelect={() => choose(t)} />
        ))}
      </div>
      {!model.fixedJobId && (
        <div className="mt-2.5 flex items-center gap-2">
          <Combobox
            options={jobOptions}
            value={null}
            onChange={(id) => id && onPickJob(id)}
            placeholder="Jiná zakázka — hledej číslo, zákazníka, název…"
            aria-label="Vybrat jinou zakázku"
            clearable={false}
            className="flex-1"
            disabled={pickingJob}
          />
          {pickingJob && <Loader2 className="h-4 w-4 shrink-0 animate-spin text-sky-600" />}
        </div>
      )}
    </Section>
  );
}

export function TargetCard({ t, selected, fixed, onSelect }: { t: ReviewTarget; selected: boolean; fixed: boolean; onSelect: () => void }) {
  const isNew = t.mode === "new";
  const m = t.stage ? stageMeta(t.stage) : null;
  return (
    <button
      type="button"
      role="radio"
      aria-checked={selected}
      disabled={fixed}
      onClick={onSelect}
      className={cn(
        "relative flex w-full items-start gap-3 overflow-hidden rounded-xl border p-3 text-left transition disabled:cursor-default",
        selected
          ? isNew
            ? "border-emerald-300 bg-emerald-50/70 ring-2 ring-emerald-500/30 dark:border-emerald-500/40 dark:bg-emerald-500/10"
            : cn("bg-accent/40 ring-2", m?.ring)
          : "hover:bg-accent/50",
      )}
    >
      {!isNew && m && <span aria-hidden className={cn("absolute inset-y-0 left-0 w-1", m.bar)} />}
      {!fixed && (
        <span className={cn(
          "mt-0.5 flex h-4 w-4 shrink-0 items-center justify-center rounded-full border-2",
          selected ? (isNew ? "border-emerald-500" : "border-foreground") : "border-muted-foreground/40",
        )}>
          {selected && <span className={cn("h-2 w-2 rounded-full", isNew ? "bg-emerald-500" : "bg-foreground")} />}
        </span>
      )}
      {isNew ? (
        <span className="flex min-w-0 flex-1 items-center gap-2.5">
          <span className={cn("flex h-8 w-8 shrink-0 items-center justify-center rounded-lg", TONES.emerald)}>
            <Plus className="h-4 w-4" />
          </span>
          <span className="min-w-0">
            <span className="block text-sm font-semibold">Založit novou zakázku</span>
            <span className="block text-xs text-muted-foreground">Dostane další číslo v knize (Z-…)</span>
          </span>
        </span>
      ) : (
        <span className="min-w-0 flex-1">
          <span className="flex flex-wrap items-center gap-1.5">
            <span className="font-mono text-sm font-bold tracking-tight">{t.number}</span>
            {t.stage && <StageBadge stage={t.stage} size="xs" />}
            {t.score !== null && <ScorePill score={t.score} />}
          </span>
          <span className="mt-0.5 block truncate text-sm">{t.title || "Bez názvu"}</span>
          {t.customerName && <span className="block truncate text-xs text-muted-foreground">{t.customerName}</span>}
          {t.reason && (
            <span className="mt-1 flex items-start gap-1 text-xs text-sky-700 dark:text-sky-400">
              <Link2 className="mt-0.5 h-3 w-3 shrink-0" />
              <span>{t.reason}</span>
            </span>
          )}
        </span>
      )}
    </button>
  );
}

// ── Zákazník / dodavatel ────────────────────────────────────
const PARTY_FIELDS: { key: keyof ExtractedParty; label: string; full?: boolean; type?: string }[] = [
  { key: "name", label: "Název firmy", full: true },
  { key: "ico", label: "IČO" },
  { key: "dic", label: "DIČ" },
  { key: "street", label: "Ulice a číslo", full: true },
  { key: "city", label: "Město" },
  { key: "zip", label: "PSČ" },
  { key: "country", label: "Země" },
  { key: "contactPerson", label: "Kontaktní osoba" },
  { key: "email", label: "E-mail", type: "email" },
  { key: "phone", label: "Telefon", type: "tel" },
];

function PartyFields({
  idPrefix, party, docParty, aiUsed, onChange,
}: {
  idPrefix: string;
  party: ExtractedParty;
  docParty: ExtractedParty;
  aiUsed: boolean;
  onChange: (p: ExtractedParty) => void;
}) {
  return (
    <div className="grid gap-2.5 sm:grid-cols-2">
      {PARTY_FIELDS.map((f) => {
        const id = `${idPrefix}-${f.key}`;
        const ai = aiUsed && Boolean(docParty[f.key]) && party[f.key] === docParty[f.key];
        return (
          <div key={f.key} className={cn(f.full && "sm:col-span-2")}>
            <FieldLabel htmlFor={id} extra={ai ? <AiMark /> : undefined}>{f.label}</FieldLabel>
            <Input
              id={id}
              type={f.type ?? "text"}
              value={party[f.key]}
              onChange={(e) => onChange({ ...party, [f.key]: e.target.value })}
              className={cn(ai && AI_FIELD)}
              autoComplete="off"
            />
          </div>
        );
      })}
    </div>
  );
}

export function PartyPicker({
  kind, choice, docParty, match, options, aiUsed, onChange, idPrefix = "cap",
}: {
  idPrefix?: string;
  kind: "customer" | "supplier";
  choice: PartyChoice;
  docParty: ExtractedParty;
  match: ReviewModel["customerMatch"];
  options: ComboOption[];
  aiUsed: boolean;
  onChange: (c: PartyChoice) => void;
}) {
  const noun = kind === "customer" ? "zákazník" : "dodavatel";
  const Noun = kind === "customer" ? "Zákazník" : "Dodavatel";
  const toNew = (name?: string): PartyChoice => {
    const base = docParty.name.trim() ? { ...docParty } : emptyParty();
    return { mode: "new", party: name ? { ...base, name } : base };
  };
  return (
    <div className="space-y-2.5">
      <Segmented
        value={choice.mode}
        onChange={(m) => {
          if (m === choice.mode) return;
          if (m === "existing") onChange(match ? { mode: "existing", id: match.id, name: match.name, reason: match.reason } : { mode: "existing", id: "", name: "", reason: null });
          else if (m === "new") onChange(toNew());
          else onChange({ mode: "none" });
        }}
        options={[
          { value: "existing", label: "Existující", icon: Building2 },
          { value: "new", label: kind === "customer" ? "Nový zákazník" : "Nový dodavatel", icon: Plus },
          { value: "none", label: kind === "customer" ? "Bez zákazníka" : "Bez dodavatele", icon: UserX },
        ]}
      />
      {choice.mode === "existing" && (
        <div>
          <Combobox
            options={options}
            value={choice.id || null}
            onChange={(id) => {
              const o = options.find((x) => x.value === id);
              onChange(id && o ? { mode: "existing", id, name: o.label, reason: match && match.id === id ? match.reason : null } : { mode: "existing", id: "", name: "", reason: null });
            }}
            onCreate={(text) => onChange(toNew(text))}
            createLabel={(t) => `Založit nového: „${t}"`}
            placeholder={`Hledej ${noun}a — název, IČO…`}
            aria-label={`Vybrat ${noun}a`}
            aria-invalid={!choice.id}
            icon={kind === "customer" ? <Building2 /> : <Truck />}
          />
          {choice.id && choice.reason && (
            <p className="mt-1.5 flex items-center gap-1 text-xs text-emerald-700 dark:text-emerald-400">
              <Check className="h-3.5 w-3.5" /> Nalezen {choice.reason}
            </p>
          )}
          {!choice.id && <p className="mt-1.5 text-xs text-muted-foreground">Začni psát a vyber ze seznamu.</p>}
        </div>
      )}
      {choice.mode === "new" && (
        <div className="rounded-xl border border-emerald-200 bg-emerald-50/50 p-2.5 dark:border-emerald-500/30 dark:bg-emerald-500/5">
          <p className="mb-2 flex items-center gap-1.5 text-xs font-semibold text-emerald-700 dark:text-emerald-300">
            <Plus className="h-3.5 w-3.5" /> Založí se {kind === "customer" ? "nový zákazník" : "nový dodavatel"}
            <span className="font-normal text-muted-foreground">(když už existuje se stejným IČO, použije se ten)</span>
          </p>
          <PartyFields
            idPrefix={`${idPrefix}-${kind}`}
            party={choice.party}
            docParty={docParty}
            aiUsed={aiUsed}
            onChange={(party) => onChange({ mode: "new", party })}
          />
        </div>
      )}
      {choice.mode === "none" && (
        <p className="text-xs text-muted-foreground">{Noun} se dá doplnit kdykoli později v kartě zakázky.</p>
      )}
    </div>
  );
}

function CustomerSection({ model, review, target, onChange, idPrefix }: { model: ReviewModel; review: ReviewState; target: ReviewTarget; onChange: (c: PartyChoice) => void; idPrefix: string }) {
  const options = React.useMemo<ComboOption[]>(() => model.options.customers.map((c) => ({
    value: c.id,
    label: c.name,
    hint: [c.customerNumber, c.ico && `IČO ${c.ico}`].filter(Boolean).join(" · ") || undefined,
    keywords: c.ico ?? undefined,
  })), [model.options.customers]);

  if (target.mode === "existing" && target.customerId) {
    const docOther = model.aiUsed && model.docCustomer.name.trim()
      && (model.customerMatch ? model.customerMatch.id !== target.customerId : true);
    return (
      <Section icon={Building2} tone="orange" title="Zákazník" hint="Zákazník zakázky se nemění.">
        <div className="flex items-center gap-2 rounded-xl border bg-muted/40 p-2.5">
          <Building2 className="h-4 w-4 shrink-0 text-orange-600 dark:text-orange-400" />
          <span className="min-w-0 flex-1 truncate text-sm font-medium">{target.customerName}</span>
          <LockedMark />
        </div>
        {docOther && (
          <p className="mt-2 flex items-start gap-1.5 text-xs text-amber-800 dark:text-amber-300">
            <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0 text-amber-500" />
            Na dokladu je {model.docCustomer.name} — zkontroluj, jestli je to správná zakázka.
          </p>
        )}
      </Section>
    );
  }
  const aiHit = model.aiUsed && review.customer.mode === "existing" && model.customerMatch?.id === review.customer.id;
  return (
    <Section
      icon={Building2}
      tone="orange"
      title="Zákazník"
      hint={model.aiUsed && !model.customerMatch && model.docCustomer.name ? "Zákazníka z dokladu v adresáři nemáme — založí se nový." : undefined}
      action={aiHit ? <AiMark label="našla AI" /> : undefined}
    >
      <PartyPicker
        idPrefix={idPrefix}
        kind="customer"
        choice={review.customer}
        docParty={model.docCustomer}
        match={model.customerMatch}
        options={options}
        aiUsed={model.aiUsed}
        onChange={onChange}
      />
    </Section>
  );
}

function SupplierSection({ model, review, target, onChange, idPrefix }: { model: ReviewModel; review: ReviewState; target: ReviewTarget; onChange: (c: PartyChoice) => void; idPrefix: string }) {
  const options = React.useMemo<ComboOption[]>(() => model.options.suppliers.map((s) => ({ value: s.id, label: s.name })), [model.options.suppliers]);
  const differs = target.mode === "existing" && target.supplierId && review.supplier.mode !== "none"
    && !(review.supplier.mode === "existing" && review.supplier.id === target.supplierId);
  const aiHit = model.aiUsed && review.supplier.mode === "existing" && model.supplierMatch?.id === review.supplier.id;
  return (
    <Section icon={Truck} tone="lime" title="Dodavatel" hint="Kdo doklad vystavil (kooperant, dodavatel materiálu…)." action={aiHit ? <AiMark label="našla AI" /> : undefined}>
      <PartyPicker
        idPrefix={idPrefix}
        kind="supplier"
        choice={review.supplier}
        docParty={model.docSupplier}
        match={model.supplierMatch}
        options={options}
        aiUsed={model.aiUsed}
        onChange={onChange}
      />
      {differs && (
        <p className="mt-2 flex items-start gap-1.5 text-xs text-muted-foreground">
          <Info className="mt-0.5 h-3.5 w-3.5 shrink-0" />
          Hlavní dodavatel zakázky ({target.supplierName}) zůstane — doklad se jen přiloží.
        </p>
      )}
    </Section>
  );
}

// ── Údaje ───────────────────────────────────────────────────
/** Skupiny polí vloženého formuláře: `visibleFields` + vše s hodnotou / návrhem (showAll = všechna). */
function embeddedFieldGroups(visible: ReviewFieldKey[], target: ReviewTarget, fields: ReviewState["fields"], margins: boolean, showAll: boolean) {
  const wanted = new Set<ReviewFieldKey>(visible);
  for (const k of REVIEW_FIELD_KEYS) if (fields[k]?.trim() || target.proposed[k] || target.conflicts[k]) wanted.add(k);
  const keys = REVIEW_FIELD_KEYS.filter((k) => (showAll || wanted.has(k)) && (margins || !REVIEW_FIELDS[k].sensitive));
  return REVIEW_GROUPS
    .map((g) => ({ group: g.key, label: g.label, keys: keys.filter((k) => REVIEW_FIELDS[k].group === g.key) }))
    .filter((g) => g.keys.length > 0);
}

function FieldsSection({
  model, review, target, onChange, embedded, idPrefix,
}: {
  model: ReviewModel;
  review: ReviewState;
  target: ReviewTarget;
  onChange: (f: ReviewState["fields"]) => void;
  embedded?: CaptureReviewEmbedded;
  idPrefix: string;
}) {
  const [showAll, setShowAll] = React.useState(false);
  const args = { chip: review.chip, target, fields: review.fields, margins: model.margins };
  const groups = embedded
    ? embeddedFieldGroups(embedded.visibleFields, target, review.fields, model.margins, showAll)
    : visibleFieldGroups({ ...args, showAll });
  const hidden = embedded
    ? embeddedFieldGroups(embedded.visibleFields, target, review.fields, model.margins, true).reduce((n, g) => n + g.keys.length, 0)
      - embeddedFieldGroups(embedded.visibleFields, target, review.fields, model.margins, false).reduce((n, g) => n + g.keys.length, 0)
    : hiddenFieldCount(args);
  const currency = (review.fields.currency || target.existing.currency || "CZK").toUpperCase();
  const aiCount = groups.reduce((n, g) => n + g.keys.filter((k) => !isFieldLocked(target, k) && isAiValue(target, review, k, model.aiUsed)).length, 0);

  return (
    <Section
      icon={ClipboardList}
      tone="amber"
      title="Údaje do zakázky"
      hint={target.mode === "existing"
        ? "Doplní se jen prázdné údaje — co už zakázka má, zůstane (šedě)."
        : "Vyplň, co je na dokladu. Prázdná pole nevadí."}
      action={aiCount > 0 ? <span className={cn("rounded-full px-2 py-0.5 text-[10px] font-semibold", TONES.fuchsia)}>✨ {aiCount}</span> : undefined}
    >
      <div className="space-y-4">
        {groups.map((g) => {
          const Icon = FIELD_GROUP_ICON[g.group];
          return (
            <div key={g.group}>
              <p className="mb-1.5 flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
                <Icon className="h-3.5 w-3.5" /> {g.label}
              </p>
              <div className="grid gap-2.5 sm:grid-cols-2">
                {g.keys.map((key) => (
                  <ReviewFieldInput
                    key={key}
                    k={key}
                    target={target}
                    review={review}
                    aiUsed={model.aiUsed}
                    currency={currency}
                    idPrefix={idPrefix}
                    source={embedded?.fieldSources[key] && review.fields[key]?.trim()
                      && review.fields[key] === model.initial.fields[key] ? embedded.fieldSources[key] : undefined}
                    onChange={(v) => onChange({ ...review.fields, [key]: v })}
                  />
                ))}
              </div>
            </div>
          );
        })}
      </div>
      {hidden > 0 && (
        <button
          type="button"
          onClick={() => setShowAll((x) => !x)}
          className="mt-3 inline-flex items-center gap-1 text-xs font-medium text-sky-700 hover:underline dark:text-sky-400"
        >
          <ChevronDown className={cn("h-3.5 w-3.5 transition-transform", showAll && "rotate-180")} />
          {showAll ? "Skrýt další údaje" : `Další údaje (${hidden})`}
        </button>
      )}
    </Section>
  );
}

function ReviewFieldInput({
  k, target, review, aiUsed, currency, onChange, idPrefix, source,
}: {
  k: ReviewFieldKey;
  target: ReviewTarget;
  review: ReviewState;
  aiUsed: boolean;
  currency: string;
  onChange: (v: string) => void;
  idPrefix: string;
  /** Údaj doplněný z jiného dokladu dávky. */
  source?: FieldSource;
}) {
  const meta = REVIEW_FIELDS[k];
  const id = `${idPrefix}-field-${k}`;
  const locked = isFieldLocked(target, k);
  const value = locked ? target.existing[k] ?? "" : review.fields[k] ?? "";
  const fromDoc = !locked && Boolean(source);
  const ai = !locked && !fromDoc && isAiValue(target, review, k, aiUsed);
  const conflict = target.conflicts[k];
  const full = k === "title" || k === "deliveryMethod";

  let control: React.ReactNode;
  if (locked) {
    control = <Input id={id} readOnly value={displayValue(k, value)} className={LOCKED_FIELD} />;
  } else if (meta.type === "currency") {
    control = (
      <NativeSelect id={id} value={value || "CZK"} onChange={(e) => onChange(e.target.value)} className={cn(ai && AI_FIELD, fromDoc && SOURCE_FIELD)}>
        {[...new Set([...CURRENCIES, value].filter(Boolean))].map((c) => <option key={c} value={c}>{c}</option>)}
      </NativeSelect>
    );
  } else {
    const money = meta.type === "money";
    control = (
      <div className="relative">
        <Input
          id={id}
          type={meta.type === "date" ? "date" : meta.type === "email" ? "email" : meta.type === "tel" ? "tel" : "text"}
          inputMode={money ? "decimal" : undefined}
          value={value}
          maxLength={meta.max}
          placeholder={money ? "0" : undefined}
          onChange={(e) => onChange(e.target.value)}
          className={cn(ai && AI_FIELD, fromDoc && SOURCE_FIELD, money && "pr-12 text-right tabular-nums", k === "title" && "font-medium", meta.type === "date" && "dark:[color-scheme:dark]")}
          autoComplete="off"
        />
        {money && <span className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-xs text-muted-foreground">{currency}</span>}
      </div>
    );
  }

  return (
    <div className={cn(full && "sm:col-span-2")}>
      <FieldLabel htmlFor={id} extra={locked ? <LockedMark /> : fromDoc && source ? <SourceMark label={source.label} /> : ai ? <AiMark /> : undefined}>{meta.label}</FieldLabel>
      {control}
      {conflict && (
        <p className="mt-1 flex items-start gap-1 text-[11px] text-amber-800 dark:text-amber-300">
          <AlertTriangle className="mt-px h-3 w-3 shrink-0 text-amber-500" />
          Na dokladu je {displayValue(k, conflict)} — zakázka má jinou hodnotu (nepřepisuji, změň v kartě zakázky).
        </p>
      )}
      {!conflict && meta.hint && !locked && <p className="mt-1 text-[11px] text-muted-foreground">{meta.hint}</p>}
    </div>
  );
}

// ── Položky ─────────────────────────────────────────────────
function ItemsSection({
  model, review, target, supplierSide, onChange, itemSources, idPrefix,
}: {
  model: ReviewModel;
  review: ReviewState;
  target: ReviewTarget;
  supplierSide: boolean;
  onChange: (patch: Partial<ReviewState>) => void;
  itemSources?: Record<string, FieldSource[]>;
  idPrefix: string;
}) {
  const priceMode: "sale" | "purchase" | "none" = supplierSide ? (model.margins ? "purchase" : "none") : "sale";
  const currency = (review.fields.currency || target.existing.currency || "CZK").toUpperCase();
  const setItem = (i: number, patch: Partial<ReviewItem>) => onChange({ items: review.items.map((it, n) => (n === i ? { ...it, ...patch } : it)) });
  const total = review.items.reduce((s, it) => {
    const q = cleanNumber(it.quantity) ?? 0;
    const p = cleanNumber(priceMode === "purchase" ? it.purchaseUnitPrice : it.unitPrice) ?? 0;
    return s + q * p;
  }, 0);

  return (
    <Section
      icon={Package}
      tone="teal"
      title="Položky"
      hint={target.mode === "existing" && target.existingItems > 0
        ? `Zakázka už má ${target.existingItems} ${target.existingItems === 1 ? "položku" : target.existingItems < 5 ? "položky" : "položek"} — tady jsou jen nové a doplnění.`
        : "Díly z dokladu (číslo výkresu, kusy, cena)."}
      action={
        <Button type="button" variant="outline" size="sm" onClick={() => onChange({ items: [...review.items, emptyReviewItem(`new-${Date.now()}`)] })}>
          <Plus /> Přidat
        </Button>
      }
    >
      {review.merges.length > 0 && (
        <ul className="mb-3 space-y-1.5">
          {review.merges.map((m, i) => (
            <li key={m.itemId}>
              <label className={cn(
                "flex cursor-pointer items-start gap-2.5 rounded-xl border p-2.5 text-sm transition",
                m.apply ? "border-teal-200 bg-teal-50/60 dark:border-teal-500/30 dark:bg-teal-500/10" : "opacity-70",
              )}>
                <input
                  type="checkbox"
                  checked={m.apply}
                  onChange={(e) => onChange({ merges: review.merges.map((x, n) => (n === i ? { ...x, apply: e.target.checked } : x)) })}
                  className="mt-0.5 h-4 w-4 shrink-0 accent-teal-600"
                />
                <span className="min-w-0">
                  <span className="font-medium">{m.override?.length ? "Upravit položku" : "Doplnit k položce"} {m.label}</span>
                  <span className="block text-xs text-muted-foreground">
                    {(Object.entries(m.patch) as [MergeField, string][])
                      .map(([f, v]) => `${MERGE_FIELD_LABELS[f]}: ${v}${m.override?.includes(f) ? " (platí objednávka)" : ""}`).join(" · ")}
                  </span>
                </span>
                {model.aiUsed && <AiMark className="ml-auto shrink-0" label="" />}
              </label>
            </li>
          ))}
        </ul>
      )}

      {review.items.length === 0 ? (
        <button
          type="button"
          onClick={() => onChange({ items: [emptyReviewItem(`new-${Date.now()}`)] })}
          className="flex w-full items-center justify-center gap-2 rounded-xl border-2 border-dashed p-4 text-sm text-muted-foreground transition hover:bg-accent hover:text-foreground"
        >
          <Plus className="h-4 w-4" /> {review.merges.length ? "Přidat další položku" : "Žádné položky — přidat položku"}
        </button>
      ) : (
        <ol className="space-y-2">
          {review.items.map((it, i) => (
            <ItemRow
              key={it.key}
              index={i}
              item={it}
              idPrefix={idPrefix}
              sources={itemSources?.[it.key]}
              priceMode={priceMode}
              currency={currency}
              onChange={(patch) => setItem(i, patch)}
              onRemove={() => onChange({ items: review.items.filter((_, n) => n !== i) })}
            />
          ))}
        </ol>
      )}
      {total > 0 && (
        <p className="mt-2 text-right text-xs text-muted-foreground">
          Celkem {priceMode === "purchase" ? "nákup" : ""} <span className="font-semibold tabular-nums text-foreground">{moneyLabel(String(total), currency)}</span> bez DPH
        </p>
      )}
    </Section>
  );
}

function ItemRow({
  index, item, priceMode, currency, onChange, onRemove, idPrefix, sources,
}: {
  idPrefix: string;
  sources?: FieldSource[];
  index: number;
  item: ReviewItem;
  priceMode: "sale" | "purchase" | "none";
  currency: string;
  onChange: (patch: Partial<ReviewItem>) => void;
  onRemove: () => void;
}) {
  const id = (f: string) => `${idPrefix}-item-${item.key}-${f}`;
  const ai = item.aiFilled;
  const priceKey = priceMode === "purchase" ? "purchaseUnitPrice" : "unitPrice";
  const cell = (f: keyof ReviewItem, label: string, cls: string, extra: React.InputHTMLAttributes<HTMLInputElement> = {}) => (
    <div className={cls}>
      <label htmlFor={id(f)} className="mb-0.5 block text-[10px] font-medium uppercase tracking-wide text-muted-foreground">{label}</label>
      <Input
        id={id(f)}
        value={String(item[f] ?? "")}
        onChange={(e) => onChange({ [f]: e.target.value } as Partial<ReviewItem>)}
        className={cn("h-8 px-2 text-sm", ai && AI_FIELD)}
        autoComplete="off"
        {...extra}
      />
    </div>
  );
  return (
    <li className={cn("rounded-xl border p-2.5", ai && "border-l-4 border-l-fuchsia-400 dark:border-l-fuchsia-500/60")}>
      <div className="mb-1.5 flex items-center justify-between gap-2">
        <span className="flex items-center gap-1.5 text-xs font-semibold">
          <span className={cn("flex h-5 w-5 items-center justify-center rounded-full text-[10px]", TONES.teal)}>{index + 1}</span>
          {item.drawingNumber || item.name || "Nová položka"}
          {ai && <AiMark label="" />}
        </span>
        {sources?.length ? (
          <span className="flex min-w-0 flex-1 flex-wrap justify-end gap-x-2">
            {sources.map((src, n) => <SourceMark key={`${src.docId}-${n}`} label={src.label} />)}
          </span>
        ) : null}
        <Button type="button" variant="ghost" size="icon-sm" className="h-7 w-7 text-red-600 hover:text-red-700 dark:text-red-400" onClick={onRemove} aria-label="Odebrat položku">
          <Trash2 />
        </Button>
      </div>
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-6">
        {cell("drawingNumber", "Výkres", "col-span-1 sm:col-span-2", { className: cn("h-8 px-2 font-mono text-sm", ai && AI_FIELD) })}
        {cell("revision", "Rev.", "col-span-1")}
        {cell("name", "Název", "col-span-2 sm:col-span-3")}
        {cell("material", "Materiál", "col-span-2 sm:col-span-2")}
        {cell("quantity", "Množství", "col-span-1", { inputMode: "decimal", className: cn("h-8 px-2 text-right text-sm tabular-nums", ai && AI_FIELD) })}
        {cell("unit", "MJ", "col-span-1")}
        {priceMode !== "none" && cell(priceKey, priceMode === "purchase" ? `Nákup / MJ (${currency})` : `Cena / MJ (${currency})`, "col-span-2", {
          inputMode: "decimal", placeholder: "doplní obchodník", className: cn("h-8 px-2 text-right text-sm tabular-nums", ai && AI_FIELD),
        })}
      </div>
    </li>
  );
}

// ── Stav ────────────────────────────────────────────────────
function StageSection({ review, target, onChange }: { review: ReviewState; target: ReviewTarget; onChange: (s: ReviewState["stage"]) => void }) {
  const from = target.mode === "existing" ? target.stage : null;
  const proposed = proposeStage(review.docKind, review.issuer, target);
  const moveTo = proposed !== "keep" ? proposed : (from && nextStage(from)) || from || "poptavka";
  return (
    <Section
      icon={Flag}
      tone="orange"
      title="Stav zakázky"
      hint={proposed !== "keep" ? `Podle dokladu navrhuji: ${stageMeta(proposed).label}.` : target.mode === "existing" ? "Tenhle doklad stav zakázky neposouvá." : undefined}
    >
      <div className="flex flex-wrap items-center gap-2">
        {from ? <StageBadge stage={from} size="md" /> : (
          <span className={cn("inline-flex items-center gap-1 rounded-full px-3 py-1 text-sm font-medium", TONES.emerald)}>
            <Plus className="h-4 w-4" /> Nová zakázka
          </span>
        )}
        <ArrowRight className="h-4 w-4 text-muted-foreground" />
        {review.stage === "keep" ? (
          <span className="text-sm text-muted-foreground">beze změny</span>
        ) : (
          <StagePicker value={review.stage} onChange={(s) => onChange(s)} className="w-auto min-w-[13rem]" />
        )}
      </div>
      {target.mode === "existing" && (
        <Segmented
          className="mt-3"
          value={review.stage === "keep" ? "keep" : "move"}
          onChange={(v) => onChange(v === "keep" ? "keep" : moveTo)}
          options={[{ value: "keep", label: "Neměnit stav" }, { value: "move", label: "Posunout stav" }]}
        />
      )}
    </Section>
  );
}

// ── Soubor ──────────────────────────────────────────────────
function FileSection({ review, onChange }: { review: ReviewState; onChange: (patch: Partial<ReviewState>) => void }) {
  return (
    <Section icon={Paperclip} tone="rose" title="Uložit fotku jako" hint="Doklad se přiloží k zakázce do Dokumentů.">
      <div className="grid gap-2.5 sm:grid-cols-[minmax(0,14rem)_minmax(0,1fr)]">
        <div>
          <FieldLabel htmlFor="cap-file-kind" extra={<FileKindBadge kind={review.fileKind} className="px-1.5 py-0 text-[10px]" />}>Druh dokumentu</FieldLabel>
          <NativeSelect id="cap-file-kind" value={review.fileKind} onChange={(e) => onChange({ fileKind: e.target.value as ReviewState["fileKind"] })}>
            {FILE_KIND_ORDER.map((k) => <option key={k} value={k}>{FILE_KINDS[k].label}</option>)}
          </NativeSelect>
        </div>
        <div>
          <FieldLabel htmlFor="cap-doc-note">Poznámka k dokladu</FieldLabel>
          <Textarea
            id="cap-doc-note"
            value={review.docNote}
            onChange={(e) => onChange({ docNote: e.target.value })}
            placeholder="Např. ručně psané poznámky, razítko převzetí…"
            className="min-h-[38px]"
            rows={2}
            maxLength={2000}
          />
        </div>
      </div>
    </Section>
  );
}
