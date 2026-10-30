"use client";

import * as React from "react";
import {
  AlertCircle, Building2, CalendarDays, ClipboardList, Copy, Flame, Hash, Loader2, Package, Plus, StickyNote, Trash2,
  Truck, Users, Check, Lock,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { useAccess } from "@/components/access-provider";
import { Combobox, type ComboOption } from "@/components/jobs/book/combobox";
import { NativeSelect } from "@/components/jobs/book/native-select";
import { StagePicker } from "@/components/jobs/book/stage-picker";
import {
  DATE_FIELDS, PRIORITIES, UNITS, MAX_TITLE, emptyItem, findSameCustomer, firstErrorKey, formTotals, initialFormState,
  lineTotal, ownerPreview, validateJobForm, type ItemDraft, type JobFormErrors, type JobFormInitial, type JobFormState, type JobFormValues,
} from "@/components/jobs/book/job-form-model";
import { formatMoney } from "@/components/jobs/book/job-cells";
import { ROLE_LABELS } from "@/lib/auth/permissions";
import type { JobFormOptions } from "@/lib/jobs/types";
import type { PriorityLevel, UserRole } from "@/lib/supabase/database.types";
import { cn } from "@/lib/utils";

/**
 * Úplný formulář zakázky (nová zakázka, ruční vyplnění dokladu vedle fotky).
 * Sekce: Základ, Zákazník, Čísla dokladů, Termíny, Lidé, Dodavatel, Položky,
 * Poznámka. Nákupní ceny jen s právem na marže. Hodnoty odpovídají JobInput
 * (prázdné pole = ""), takže jdou rovnou do createJob / updateJob.
 */

export type { JobFormValues, JobFormInitial } from "@/components/jobs/book/job-form-model";

export type JobFormSubmitResult = { ok: boolean; error?: string } | void;

export interface JobFormProps {
  options: JobFormOptions;
  initial?: JobFormInitial;
  onSubmit: (values: JobFormValues) => Promise<JobFormSubmitResult> | JobFormSubmitResult;
  submitLabel?: string;
  /** Úzké rozložení (formulář vedle náhledu dokladu). */
  compact?: boolean;
  onCancel?: () => void;
  cancelLabel?: string;
  /** Zákazník povinný (výchozí ano). */
  requireCustomer?: boolean;
  /** Vnější „pracuji" (např. po uložení, než se otevře detail). */
  busy?: boolean;
  onDirtyChange?: (dirty: boolean) => void;
  /** Patička s tlačítky přilepená dole (v dialogu). */
  stickyFooter?: boolean;
  className?: string;
}

const TONES = {
  orange: "bg-orange-100 text-orange-600 dark:bg-orange-500/15 dark:text-orange-300",
  sky: "bg-sky-100 text-sky-600 dark:bg-sky-500/15 dark:text-sky-300",
  violet: "bg-violet-100 text-violet-600 dark:bg-violet-500/15 dark:text-violet-300",
  amber: "bg-amber-100 text-amber-600 dark:bg-amber-500/15 dark:text-amber-300",
  emerald: "bg-emerald-100 text-emerald-600 dark:bg-emerald-500/15 dark:text-emerald-300",
  teal: "bg-teal-100 text-teal-600 dark:bg-teal-500/15 dark:text-teal-300",
  blue: "bg-blue-100 text-blue-600 dark:bg-blue-500/15 dark:text-blue-300",
  slate: "bg-slate-100 text-slate-600 dark:bg-slate-500/20 dark:text-slate-300",
} as const;

const PRIORITY_STYLE: Record<PriorityLevel, string> = {
  nizka: "bg-slate-600 text-white",
  stredni: "bg-sky-500 text-white",
  vysoka: "bg-red-600 text-white",
};

export function JobForm({
  options,
  initial,
  onSubmit,
  submitLabel = "Založit zakázku",
  compact = false,
  onCancel,
  cancelLabel = "Zrušit",
  requireCustomer = true,
  busy: externalBusy = false,
  onDirtyChange,
  stickyFooter = false,
  className,
}: JobFormProps) {
  const access = useAccess();
  const margins = access.can("margins");
  // #25: Obchodníka zakázky volí jen super admin — ostatním ho doplní server (obchodník zákazníka)
  const ownerEditable = access.role === "super_admin";
  const uid = React.useId();
  const fid = (key: string) => `${uid}-${key.replace(/\./g, "-")}`;

  const [state, setState] = React.useState<JobFormState>(() =>
    ownerEditable
      ? initialFormState(initial, { ownerId: access.userId ?? undefined })
      : initialFormState({ ...initial, ownerId: undefined }),
  );
  const [errors, setErrors] = React.useState<JobFormErrors>({});
  const [formError, setFormError] = React.useState<string | null>(null);
  const [busy, setBusy] = React.useState(false);
  const [dirty, setDirty] = React.useState(false);
  const working = busy || externalBusy;

  React.useEffect(() => {
    onDirtyChange?.(dirty);
  }, [dirty, onDirtyChange]);

  // obchodník = já (jen super admin), pokud se oprávnění načetla až po otevření
  React.useEffect(() => {
    if (ownerEditable && access.userId && !state.ownerId && !dirty && options.users.some((u) => u.id === access.userId)) {
      setState((s) => ({ ...s, ownerId: access.userId ?? "" }));
    }
  }, [ownerEditable, access.userId, state.ownerId, dirty, options.users]);

  function patch(p: Partial<JobFormState>) {
    setState((s) => ({ ...s, ...p }));
    setDirty(true);
    const keys = Object.keys(p);
    if (keys.some((k) => errors[k] || (k.startsWith("customer") && errors.customer))) {
      setErrors((e) => {
        const next = { ...e };
        for (const k of keys) delete next[k];
        if (keys.some((k) => k.startsWith("customer"))) delete next.customer;
        return next;
      });
    }
  }

  function patchItem(index: number, p: Partial<ItemDraft>) {
    setState((s) => ({ ...s, items: s.items.map((it, i) => (i === index ? { ...it, ...p } : it)) }));
    setDirty(true);
    const keys = Object.keys(p).map((k) => `items.${index}.${k}`);
    if (keys.some((k) => errors[k])) {
      setErrors((e) => {
        const next = { ...e };
        for (const k of keys) delete next[k];
        return next;
      });
    }
  }

  function addItem(copyOf?: ItemDraft) {
    setState((s) => ({ ...s, items: [...s.items, copyOf ? { ...copyOf, key: emptyItem().key, id: undefined } : emptyItem()] }));
    setDirty(true);
  }

  function removeItem(index: number) {
    setState((s) => ({ ...s, items: s.items.filter((_, i) => i !== index) }));
    setDirty(true);
    // chyby položek se po odebrání přečíslují — jednodušší je je smazat
    setErrors((e) => Object.fromEntries(Object.entries(e).filter(([k]) => !k.startsWith("items."))));
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (working) return;
    const { values, errors: found } = validateJobForm(state, { margins, requireCustomer });
    setErrors(found);
    setFormError(null);
    if (!values) {
      const key = firstErrorKey(found);
      if (key) {
        const el = document.getElementById(fid(key === "customer" ? (state.customerMode === "new" ? "customerName" : "customerId") : key));
        el?.scrollIntoView({ block: "center", behavior: "smooth" });
        el?.focus({ preventScroll: true });
      }
      return;
    }
    setBusy(true);
    try {
      // ne-admin obchodníka neposílá (server vezme obchodníka zákazníka) — jinak by „—" zakázku nechalo bez obchodníka
      const sent: JobFormValues = { ...values };
      if (!ownerEditable) delete sent.ownerId;
      const res = await onSubmit(sent);
      if (res && !res.ok) setFormError(res.error ?? "Uložení se nepovedlo.");
      else setDirty(false);
    } catch {
      setFormError("Uložení se nepovedlo — zkus to znovu.");
    } finally {
      setBusy(false);
    }
  }

  const customerOptions = React.useMemo<ComboOption[]>(
    () => options.customers.map((c) => ({
      value: c.id,
      label: c.name,
      hint: [c.customerNumber, c.ico ? `IČ ${c.ico}` : null].filter(Boolean).join(" · ") || undefined,
    })),
    [options.customers],
  );
  const supplierOptions = React.useMemo<ComboOption[]>(
    () => options.suppliers.map((s) => ({ value: s.id, label: s.name })),
    [options.suppliers],
  );
  const sameCustomer = state.customerMode === "new" ? findSameCustomer(options.customers, state.customerName) : null;
  const totals = formTotals(state.items, margins);
  const errorCount = Object.keys(errors).length;

  const userLabel = (u: JobFormOptions["users"][number]) =>
    `${u.name}${u.id === access.userId ? " (já)" : ""}${ROLE_LABELS[u.role as UserRole] ? ` · ${ROLE_LABELS[u.role as UserRole]}` : ""}`;

  const grid2 = compact ? "grid gap-3" : "grid gap-3 sm:grid-cols-2";

  return (
    <form onSubmit={submit} noValidate className={cn("space-y-4", className)} aria-busy={working}>
      {(formError || errorCount > 0) && (
        <div role="alert" className="flex items-start gap-2 rounded-lg border border-red-200 bg-red-50 px-3 py-2.5 text-sm text-red-800 dark:border-red-500/30 dark:bg-red-500/10 dark:text-red-200">
          <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
          <span>{formError ?? "Něco chybí nebo nesedí — zkontroluj červeně označená pole."}</span>
        </div>
      )}

      {/* ── Základ ─────────────────────────────────────── */}
      <Section icon={ClipboardList} tone={TONES.orange} title="Základ" hint="Co se dělá a v jakém je to stavu.">
        <Field id={fid("title")} label="Název zakázky" error={errors.title} required>
          <Input
            id={fid("title")}
            value={state.title}
            maxLength={MAX_TITLE + 20}
            onChange={(e) => patch({ title: e.target.value })}
            placeholder="např. Příruby AL 7075 — 200 ks"
            aria-invalid={Boolean(errors.title)}
            className={errClass(errors.title)}
            autoFocus={!compact}
          />
        </Field>
        <div className={grid2}>
          <Field id={fid("stage")} label="Stav">
            <StagePicker id={fid("stage")} value={state.stage} onChange={(stage) => patch({ stage })} />
          </Field>
          <Field label="Priorita" as="div">
            <div role="radiogroup" aria-label="Priorita" className="flex h-9 gap-1 rounded-md bg-muted p-1">
              {PRIORITIES.map((p) => {
                const on = state.priority === p.key;
                return (
                  <button
                    key={p.key}
                    type="button"
                    role="radio"
                    aria-checked={on}
                    onClick={() => patch({ priority: p.key })}
                    className={cn(
                      "flex flex-1 items-center justify-center gap-1 rounded px-2 text-xs font-medium transition",
                      "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                      on ? PRIORITY_STYLE[p.key] : "text-muted-foreground hover:bg-background/70 hover:text-foreground",
                    )}
                  >
                    {p.key === "vysoka" && <Flame className="h-3.5 w-3.5" />}
                    {p.label}
                  </button>
                );
              })}
            </div>
          </Field>
        </div>
      </Section>

      {/* ── Zákazník ───────────────────────────────────── */}
      <Section
        icon={Building2}
        tone={TONES.sky}
        title="Zákazník"
        hint="Vyber z adresáře, nebo napiš nového — založí se sám."
        action={
          <div className="flex rounded-md bg-muted p-0.5 text-xs font-medium">
            <button
              type="button"
              onClick={() => patch({ customerMode: "existing" })}
              aria-pressed={state.customerMode === "existing"}
              className={cn("rounded px-2 py-1 transition", state.customerMode === "existing" ? "bg-background shadow-sm" : "text-muted-foreground hover:text-foreground")}
            >
              Z adresáře
            </button>
            <button
              type="button"
              onClick={() => patch({ customerMode: "new" })}
              aria-pressed={state.customerMode === "new"}
              className={cn("inline-flex items-center gap-1 rounded px-2 py-1 transition", state.customerMode === "new" ? "bg-background text-emerald-700 shadow-sm dark:text-emerald-400" : "text-muted-foreground hover:text-foreground")}
            >
              <Plus className="h-3 w-3" /> Nový
            </button>
          </div>
        }
      >
        {state.customerMode === "existing" ? (
          <Field id={fid("customerId")} label="Zákazník" error={errors.customer} required={requireCustomer}>
            <Combobox
              id={fid("customerId")}
              options={customerOptions}
              value={state.customerId || null}
              onChange={(v) => patch({ customerId: v ?? "" })}
              placeholder="Hledej název, číslo zákazníka nebo IČ…"
              emptyText="Takového zákazníka nemáme — přidej ho jako nového"
              onCreate={(name) => patch({ customerMode: "new", customerName: name })}
              createLabel={(t) => `Nový zákazník „${t}"`}
              aria-invalid={Boolean(errors.customer)}
              icon={<Building2 />}
            />
          </Field>
        ) : (
          <Field
            id={fid("customerName")}
            label="Název nového zákazníka"
            error={errors.customer}
            required
            hint="Při uložení se zákazník založí a dostane naše číslo zákazníka."
          >
            <Input
              id={fid("customerName")}
              value={state.customerName}
              onChange={(e) => patch({ customerName: e.target.value })}
              placeholder="název firmy"
              aria-invalid={Boolean(errors.customer)}
              className={errClass(errors.customer)}
            />
            {sameCustomer && (
              <p className="mt-1.5 flex flex-wrap items-center gap-2 rounded-md bg-amber-50 px-2 py-1.5 text-xs text-amber-900 dark:bg-amber-500/10 dark:text-amber-200">
                Tohoto zákazníka už máme: <strong>{sameCustomer.name}</strong>
                {sameCustomer.customerNumber && <span className="font-mono">{sameCustomer.customerNumber}</span>}
                <button
                  type="button"
                  onClick={() => patch({ customerMode: "existing", customerId: sameCustomer.id, customerName: "" })}
                  className="inline-flex items-center gap-1 rounded bg-amber-500 px-2 py-0.5 font-medium text-white hover:bg-amber-600"
                >
                  <Check className="h-3 w-3" /> Použít
                </button>
              </p>
            )}
          </Field>
        )}
      </Section>

      {/* ── Čísla dokladů ──────────────────────────────── */}
      <Section icon={Hash} tone={TONES.violet} title="Čísla dokladů zákazníka" hint="Podle nich AI páruje další doklady.">
        <div className={grid2}>
          <Field id={fid("customerOrderNumber")} label="Číslo objednávky zákazníka" error={errors.customerOrderNumber}>
            <Input
              id={fid("customerOrderNumber")}
              value={state.customerOrderNumber}
              onChange={(e) => patch({ customerOrderNumber: e.target.value })}
              placeholder="č. objednávky zákazníka"
              className={cn("font-mono", errClass(errors.customerOrderNumber))}
            />
          </Field>
          <Field id={fid("customerInquiryNumber")} label="Číslo poptávky zákazníka" error={errors.customerInquiryNumber}>
            <Input
              id={fid("customerInquiryNumber")}
              value={state.customerInquiryNumber}
              onChange={(e) => patch({ customerInquiryNumber: e.target.value })}
              placeholder="č. poptávky zákazníka"
              className={cn("font-mono", errClass(errors.customerInquiryNumber))}
            />
          </Field>
        </div>
      </Section>

      {/* ── Termíny ────────────────────────────────────── */}
      <Section icon={CalendarDays} tone={TONES.amber} title="Termíny" hint="Hlídá se potvrzený termín, jinak požadovaný zákazníkem.">
        <div className={compact ? "grid grid-cols-2 gap-3" : "grid grid-cols-2 gap-3 lg:grid-cols-3"}>
          {DATE_FIELDS.map((d) => (
            <Field key={d.key} id={fid(d.key)} label={d.label} hint={d.hint} error={errors[d.key]} emphasize={d.key === "dueDate"}>
              <Input
                id={fid(d.key)}
                type="date"
                value={state[d.key]}
                onChange={(e) => patch({ [d.key]: e.target.value } as Partial<JobFormState>)}
                aria-invalid={Boolean(errors[d.key])}
                className={cn("tabular-nums", d.key === "dueDate" && "border-indigo-300 dark:border-indigo-500/40", errClass(errors[d.key]))}
              />
            </Field>
          ))}
        </div>
      </Section>

      {/* ── Lidé ───────────────────────────────────────── */}
      <Section icon={Users} tone={TONES.emerald} title="Lidé">
        <div className={grid2}>
          {ownerEditable ? (
            <Field id={fid("ownerId")} label="Obchodník" hint="odpovídá za zakázku">
              <NativeSelect id={fid("ownerId")} value={state.ownerId} onChange={(e) => patch({ ownerId: e.target.value })}>
                <option value="">— nikdo —</option>
                {options.users.map((u) => (
                  <option key={u.id} value={u.id}>{userLabel(u)}</option>
                ))}
              </NativeSelect>
            </Field>
          ) : (
            <div className="space-y-1" data-field="owner-readonly">
              <span className="flex items-center gap-1.5 text-xs font-medium text-muted-foreground">
                Obchodník <Lock className="h-3 w-3" aria-label="jen pro čtení" />
              </span>
              <p className="flex min-h-10 items-center rounded-md border border-dashed px-3 text-sm text-muted-foreground">
                {ownerPreview(state, options, { userId: access.userId ?? null, role: access.role ?? null })}
              </p>
              <p className="text-[11px] text-muted-foreground">Obchodníka zakázky mění jen super admin.</p>
            </div>
          )}
          <Field id={fid("assigneeId")} label="Zpracovává" hint="kdo na ní dělá">
            <NativeSelect id={fid("assigneeId")} value={state.assigneeId} onChange={(e) => patch({ assigneeId: e.target.value })}>
              <option value="">— zatím nikdo —</option>
              {options.users.map((u) => (
                <option key={u.id} value={u.id}>{userLabel(u)}</option>
              ))}
            </NativeSelect>
          </Field>
        </div>
      </Section>

      {/* ── Dodavatel ──────────────────────────────────── */}
      <Section icon={Truck} tone={TONES.teal} title="Dodavatel" hint="Jen když díl vyrábí nebo dodává někdo jiný.">
        <div className={grid2}>
          <Field id={fid("supplierId")} label="Dodavatel">
            <Combobox
              id={fid("supplierId")}
              options={supplierOptions}
              value={state.supplierId || null}
              onChange={(v) => patch({ supplierId: v ?? "" })}
              placeholder="Hledej dodavatele…"
              emptyText="Takového dodavatele nemáme"
              icon={<Truck />}
            />
          </Field>
          <Field id={fid("supplierOrderNumber")} label="Číslo naší objednávky u dodavatele" error={errors.supplierOrderNumber}>
            <Input
              id={fid("supplierOrderNumber")}
              value={state.supplierOrderNumber}
              onChange={(e) => patch({ supplierOrderNumber: e.target.value })}
              placeholder="č. naší objednávky"
              className={cn("font-mono", errClass(errors.supplierOrderNumber))}
            />
          </Field>
        </div>
      </Section>

      {/* ── Položky ────────────────────────────────────── */}
      <Section
        icon={Package}
        tone={TONES.blue}
        title="Položky"
        hint={margins ? "Díly / výkresy. Cenu zadává člověk." : "Díly / výkresy a počty kusů."}
        action={
          <Button type="button" size="sm" variant="outline" onClick={() => addItem()}>
            <Plus /> Přidat položku
          </Button>
        }
      >
        {state.items.length === 0 ? (
          <button
            type="button"
            onClick={() => addItem()}
            className="flex w-full flex-col items-center gap-1 rounded-lg border border-dashed px-4 py-5 text-sm text-muted-foreground transition hover:border-blue-300 hover:bg-blue-50/50 hover:text-blue-700 dark:hover:border-blue-500/40 dark:hover:bg-blue-500/10 dark:hover:text-blue-300"
          >
            <Plus className="h-5 w-5" />
            Přidat první položku (číslo výkresu, počet kusů…)
          </button>
        ) : (
          <ol className="space-y-2">
            {state.items.map((it, i) => (
              <ItemRow
                key={it.key}
                index={i}
                item={it}
                compact={compact}
                margins={margins}
                errors={errors}
                fid={fid}
                onChange={(p) => patchItem(i, p)}
                onRemove={() => removeItem(i)}
                onCopy={() => addItem(it)}
              />
            ))}
          </ol>
        )}
        {state.items.length > 0 && (
          <button
            type="button"
            onClick={() => addItem()}
            className="inline-flex items-center gap-1 text-sm font-medium text-blue-700 hover:underline dark:text-blue-400"
          >
            <Plus className="h-4 w-4" /> Další položka
          </button>
        )}
      </Section>

      {/* ── Poznámka ───────────────────────────────────── */}
      <Section icon={StickyNote} tone={TONES.slate} title="Poznámka" hint="Interní — zákazník ji neuvidí.">
        <Textarea
          id={fid("note")}
          aria-label="Interní poznámka"
          value={state.note}
          onChange={(e) => patch({ note: e.target.value })}
          rows={3}
          placeholder="Cokoli, co má kolega vědět…"
        />
      </Section>

      {/* ── Patička ────────────────────────────────────── */}
      <div
        className={cn(
          "flex flex-col-reverse gap-2 border-t pt-3 sm:flex-row sm:items-center sm:justify-between",
          stickyFooter && "sticky bottom-0 z-20 -mx-4 bg-popover/95 px-4 pb-3 backdrop-blur sm:-mx-6 sm:px-6",
        )}
      >
        <div className="text-sm text-muted-foreground">
          {totals.value !== null ? (
            <span>
              Hodnota: <strong className="text-foreground tabular-nums">{formatMoney(totals.value)}</strong>
              {margins && totals.purchase !== null && (
                <>
                  {" · "}nákup <span className="tabular-nums">{formatMoney(totals.purchase)}</span>
                  {totals.value > 0 && (
                    <>
                      {" · "}marže{" "}
                      <strong className={cn("tabular-nums", totals.value - totals.purchase >= 0 ? "text-emerald-600 dark:text-emerald-400" : "text-red-600 dark:text-red-400")}>
                        {Math.round(((totals.value - totals.purchase) / totals.value) * 100)} %
                      </strong>
                    </>
                  )}
                </>
              )}
            </span>
          ) : (
            <span className="text-xs">Cena se doplní později (nacenění dělá člověk).</span>
          )}
        </div>
        <div className="flex gap-2">
          {onCancel && (
            <Button type="button" variant="ghost" onClick={onCancel} disabled={working} className="flex-1 sm:flex-none">
              {cancelLabel}
            </Button>
          )}
          <Button type="submit" variant="success" disabled={working} className="flex-1 sm:flex-none">
            {working ? <Loader2 className="animate-spin" /> : <Check />}
            {submitLabel}
          </Button>
        </div>
      </div>
    </form>
  );
}

function errClass(error?: string): string | undefined {
  return error ? "border-red-500 focus-visible:ring-red-500" : undefined;
}

function Section({
  icon: Icon,
  tone,
  title,
  hint,
  action,
  children,
}: {
  icon: React.ComponentType<{ className?: string }>;
  tone: string;
  title: string;
  hint?: string;
  action?: React.ReactNode;
  children: React.ReactNode;
}) {
  const id = React.useId();
  return (
    <section aria-labelledby={id} className="space-y-3 rounded-xl border bg-card p-3 sm:p-4">
      <div className="flex items-center gap-2.5">
        <span className={cn("flex h-8 w-8 shrink-0 items-center justify-center rounded-lg", tone)}>
          <Icon className="h-4 w-4" />
        </span>
        <div className="min-w-0 flex-1">
          <h3 id={id} className="text-sm font-semibold leading-tight">{title}</h3>
          {hint && <p className="truncate text-xs text-muted-foreground">{hint}</p>}
        </div>
        {action}
      </div>
      {children}
    </section>
  );
}

function Field({
  id,
  label,
  hint,
  error,
  required,
  emphasize,
  as = "label",
  children,
}: {
  id?: string;
  label: string;
  hint?: string;
  error?: string;
  required?: boolean;
  emphasize?: boolean;
  as?: "label" | "div";
  children: React.ReactNode;
}) {
  const head = (
    <span className={cn("block truncate text-xs font-medium", emphasize ? "text-indigo-700 dark:text-indigo-300" : "text-foreground/80")}>
      {label}
      {required && <span className="text-red-500"> *</span>}
    </span>
  );
  return (
    <div className="min-w-0 space-y-1">
      {as === "label" && id ? <label htmlFor={id} className="block" title={label}>{head}</label> : <div title={label}>{head}</div>}
      {children}
      {error ? (
        <p className="text-xs font-medium text-red-600 dark:text-red-400" role="alert">
          {error}
        </p>
      ) : hint ? (
        <p className="truncate text-[11px] text-muted-foreground">{hint}</p>
      ) : null}
    </div>
  );
}

function ItemRow({
  index,
  item,
  compact,
  margins,
  errors,
  fid,
  onChange,
  onRemove,
  onCopy,
}: {
  index: number;
  item: ItemDraft;
  compact: boolean;
  margins: boolean;
  errors: JobFormErrors;
  fid: (key: string) => string;
  onChange: (p: Partial<ItemDraft>) => void;
  onRemove: () => void;
  onCopy: () => void;
}) {
  const k = (f: string) => `items.${index}.${f}`;
  const total = lineTotal(item.quantity, item.unitPrice);
  const unitsId = `${fid(k("unit"))}-list`;
  const small = "h-8 text-sm";
  // nápověda prázdného pole bez ukázkových hodnot (majitel 30. 10.: ukázky četl jako data)
  const HINT = "placeholder:font-sans placeholder:italic placeholder:text-muted-foreground/60";
  return (
    <li className="rounded-lg border bg-muted/30 p-2.5">
      <div className="mb-2 flex items-center gap-2">
        <span className="flex h-6 w-6 items-center justify-center rounded-full bg-blue-100 text-[11px] font-bold text-blue-700 dark:bg-blue-500/20 dark:text-blue-300">
          {index + 1}
        </span>
        <span className="min-w-0 flex-1 truncate text-xs text-muted-foreground">
          {item.name || item.drawingNumber || "Nová položka"}
        </span>
        {total !== null && <span className="text-xs font-semibold tabular-nums">{formatMoney(total)}</span>}
        <button type="button" onClick={onCopy} title="Zkopírovat položku" aria-label={`Zkopírovat položku ${index + 1}`} className="rounded p-1 text-muted-foreground hover:bg-background hover:text-foreground">
          <Copy className="h-3.5 w-3.5" />
        </button>
        <button type="button" onClick={onRemove} title="Odebrat položku" aria-label={`Odebrat položku ${index + 1}`} className="rounded p-1 text-muted-foreground hover:bg-red-50 hover:text-red-600 dark:hover:bg-red-500/10">
          <Trash2 className="h-3.5 w-3.5" />
        </button>
      </div>
      <div className="grid grid-cols-12 gap-2">
        <ItemField id={fid(k("drawingNumber"))} label="Č. výkresu" className={compact ? "col-span-8" : "col-span-8 sm:col-span-4"}>
          <Input id={fid(k("drawingNumber"))} value={item.drawingNumber} onChange={(e) => onChange({ drawingNumber: e.target.value })} className={cn(small, "font-mono", HINT)} placeholder="č. výkresu" />
        </ItemField>
        <ItemField id={fid(k("revision"))} label="Rev." className={compact ? "col-span-4" : "col-span-4 sm:col-span-2"}>
          <Input id={fid(k("revision"))} value={item.revision} onChange={(e) => onChange({ revision: e.target.value })} className={cn(small, "font-mono", HINT)} placeholder="rev." />
        </ItemField>
        <ItemField id={fid(k("name"))} label="Název" className={compact ? "col-span-12" : "col-span-12 sm:col-span-6"}>
          <Input id={fid(k("name"))} value={item.name} onChange={(e) => onChange({ name: e.target.value })} className={cn(small, HINT)} placeholder="název dílu" />
        </ItemField>
        <ItemField id={fid(k("material"))} label="Materiál" className={compact ? "col-span-12" : cn("col-span-12", margins ? "sm:col-span-4" : "sm:col-span-6")}>
          <Input id={fid(k("material"))} value={item.material} onChange={(e) => onChange({ material: e.target.value })} className={cn(small, HINT)} placeholder="materiál" />
        </ItemField>
        <ItemField id={fid(k("quantity"))} label="Množství" error={errors[k("quantity")]} className={compact ? "col-span-6" : "col-span-6 sm:col-span-2"}>
          <Input
            id={fid(k("quantity"))}
            inputMode="decimal"
            value={item.quantity}
            onChange={(e) => onChange({ quantity: e.target.value })}
            aria-invalid={Boolean(errors[k("quantity")])}
            className={cn(small, "tabular-nums", errClass(errors[k("quantity")]))}
          />
        </ItemField>
        <ItemField id={fid(k("unit"))} label="MJ" className={compact ? "col-span-6" : "col-span-6 sm:col-span-1"}>
          <Input id={fid(k("unit"))} list={unitsId} value={item.unit} onChange={(e) => onChange({ unit: e.target.value })} className={small} />
          <datalist id={unitsId}>
            {UNITS.map((u) => <option key={u} value={u} />)}
          </datalist>
        </ItemField>
        <ItemField id={fid(k("unitPrice"))} label="Cena / MJ" error={errors[k("unitPrice")]} className={compact ? "col-span-6" : "col-span-6 sm:col-span-3"}>
          <Input
            id={fid(k("unitPrice"))}
            inputMode="decimal"
            value={item.unitPrice}
            onChange={(e) => onChange({ unitPrice: e.target.value })}
            placeholder="doplní se"
            aria-invalid={Boolean(errors[k("unitPrice")])}
            className={cn(small, "tabular-nums", errClass(errors[k("unitPrice")]))}
          />
        </ItemField>
        {margins && (
          <ItemField id={fid(k("purchaseUnitPrice"))} label="Nákup / MJ" error={errors[k("purchaseUnitPrice")]} className={compact ? "col-span-6" : "col-span-6 sm:col-span-2"}>
            <Input
              id={fid(k("purchaseUnitPrice"))}
              inputMode="decimal"
              value={item.purchaseUnitPrice}
              onChange={(e) => onChange({ purchaseUnitPrice: e.target.value })}
              aria-invalid={Boolean(errors[k("purchaseUnitPrice")])}
              className={cn(small, "tabular-nums", errClass(errors[k("purchaseUnitPrice")]))}
            />
          </ItemField>
        )}
      </div>
    </li>
  );
}

function ItemField({ id, label, error, className, children }: { id: string; label: string; error?: string; className?: string; children: React.ReactNode }) {
  return (
    <div className={cn("min-w-0 space-y-0.5", className)}>
      <label htmlFor={id} className="block text-[11px] font-medium text-muted-foreground">{label}</label>
      {children}
      {error && <p className="text-[11px] font-medium text-red-600 dark:text-red-400" role="alert">{error}</p>}
    </div>
  );
}
