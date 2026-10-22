"use client";

import * as React from "react";
import {
  AlertCircle, FileSignature, Layers, Loader2, Percent, Plus, Receipt, Trash2, TrendingUp, Pencil, Calculator, CheckCircle2,
  CalendarDays, Clock, StickyNote, Type, X,
} from "lucide-react";
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { deleteCommissionRule, saveCommissionRule } from "@/app/actions/commission-rules";
import {
  BASE_LABELS, DEFAULT_RULE_NAMES, addTierDraft, bandTone, czDay, czk, currentRule, formatRate, formatStamp, ratePercentNumber,
  removeTierDraft, ruleSummary, simpleExample, tierDraftsFromTiers, tierDraftsToInput, tieredExample, validateCommissionRuleInput,
  validateTierDrafts, type CommissionRuleView, type TierDraft,
} from "@/components/commissions/model";
import type { CommissionBase } from "@/lib/supabase/database.types";
import type { ManagedUser } from "@/components/users/types";
import { cn } from "@/lib/utils";

type Notify = (tone: "success" | "error", text: string) => void;

interface RuleForm {
  id: string | null;
  base: CommissionBase;
  rate: string;
  tiers: TierDraft[];
  name: string;
  validFrom: string;
  payoutDays: string;
  note: string;
}

const PRESETS: { base: CommissionBase; icon: typeof Percent; hint: string; tone: string }[] = [
  { base: "margin", icon: TrendingUp, hint: "Z každé zakázky: (objednávka zákazníka − nákup) × %.", tone: "text-emerald-600" },
  { base: "revenue", icon: Receipt, hint: "Z každé zakázky: hodnota objednávky zákazníka × %.", tone: "text-sky-600" },
  { base: "margin_tiered", icon: Layers, hint: "Měsíčně z inkasovaného obratu; každé pásmo nese svůj podíl zisku.", tone: "text-violet-600" },
];

function todayPrague(): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Prague" }).format(new Date());
}

function formFromRule(rule: CommissionRuleView | null, profilePercent: number, today: string, asNew = false): RuleForm {
  if (!rule) {
    return {
      id: null, base: "margin", rate: profilePercent > 0 ? String(profilePercent).replace(".", ",") : "10",
      tiers: tierDraftsFromTiers(null), name: "", validFrom: today, payoutDays: "20", note: "",
    };
  }
  return {
    id: asNew ? null : rule.id,
    base: rule.base,
    rate: rule.base === "margin_tiered" ? "10" : ratePercentNumber(rule.rate).replace(/\s/g, ""),
    tiers: tierDraftsFromTiers(rule.tiers),
    name: asNew ? "" : rule.name ?? "",
    validFrom: asNew ? today : rule.validFrom,
    payoutDays: String(rule.payoutDays ?? 20),
    note: asNew ? "" : rule.note ?? "",
  };
}

function money(v: string): number {
  const n = Number(v.replace(/\s/g, "").replace(",", "."));
  return Number.isFinite(n) ? n : 0;
}

/** Krátký popis smlouvy uživatele pro řádek seznamu (nebo null — bez provize). */
export function contractSummary(
  user: Pick<ManagedUser, "commissionRules" | "commissionPercent">,
  opts: { short?: boolean } = {},
): string | null {
  const rule = currentRule(user.commissionRules ?? [], todayPrague());
  if (rule) return ruleSummary(rule, 0, opts);
  return user.commissionPercent > 0 ? `${String(user.commissionPercent).replace(".", ",")} % ze zisku` : null;
}

/**
 * Smlouva a provize obchodníka: platná smlouva, historie dodatků a editor —
 * procento ze zisku, z obratu nebo pásmová měsíční provize ze zisku (z inkasa)
 * s tabulkou pásem. Po uložení DB přepočítá všechny jeho provize.
 */
export function CommissionContractDialog({
  user, open, onOpenChange, notify, onSaved,
}: {
  user: ManagedUser;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  notify: Notify;
  onSaved: () => void;
}) {
  const today = todayPrague();
  const rules = React.useMemo(() => user.commissionRules ?? [], [user.commissionRules]);
  const current = currentRule(rules, today);
  const [form, setForm] = React.useState<RuleForm>(() => formFromRule(current, user.commissionPercent, today));
  const [busy, setBusy] = React.useState<null | "save" | "delete">(null);
  const [error, setError] = React.useState<string | null>(null);
  const [confirmDelete, setConfirmDelete] = React.useState<CommissionRuleView | null>(null);
  const [example, setExample] = React.useState({ revenue: "1 200 000", profit: "600 000" });
  const [wasOpen, setWasOpen] = React.useState(open);
  if (open !== wasOpen) {
    setWasOpen(open);
    if (open) {
      setForm(formFromRule(current, user.commissionPercent, today));
      setError(null);
      setConfirmDelete(null);
    }
  }

  const set = <K extends keyof RuleForm>(k: K, v: RuleForm[K]) => {
    setForm((f) => ({ ...f, [k]: v }));
    setError(null);
  };
  const setTier = (i: number, field: "to" | "rate", v: string) => set("tiers", form.tiers.map((t, j) => (j === i ? { ...t, [field]: v } : t)));

  const tierCheck = form.base === "margin_tiered" ? validateTierDrafts(form.tiers) : null;
  const tierError = tierCheck && "error" in tierCheck ? tierCheck.error : null;
  const rev = money(example.revenue);
  const prof = money(example.profit);
  const ex = form.base === "margin_tiered"
    ? tierCheck && "tiers" in tierCheck ? tieredExample(rev, prof, tierCheck.tiers) : null
    : null;
  const simpleRate = Number(form.rate.replace(",", ".")) / 100;
  const simple = form.base !== "margin_tiered" && Number.isFinite(simpleRate) ? simpleExample(form.base, simpleRate, rev, prof) : null;

  async function save(e: React.FormEvent) {
    e.preventDefault();
    const input = {
      id: form.id,
      ownerId: user.id,
      name: form.name,
      base: form.base,
      rate: form.base === "margin_tiered" ? null : form.rate,
      tiers: form.base === "margin_tiered" ? tierDraftsToInput(form.tiers) : null,
      validFrom: form.validFrom,
      payoutDays: form.payoutDays,
      note: form.note,
    };
    const v = validateCommissionRuleInput(input, today);
    if ("error" in v) return setError(v.error);
    setBusy("save");
    setError(null);
    try {
      const res = await saveCommissionRule(input);
      if (!res.ok) {
        setError(res.error ?? "Smlouvu se nepodařilo uložit.");
        return;
      }
      notify("success", `Smlouva ${user.fullName} uložena — provize se přepočítaly.`);
      onOpenChange(false);
      onSaved();
    } catch {
      setError("Spojení se nepovedlo — zkus to znovu.");
    } finally {
      setBusy(null);
    }
  }

  async function remove(rule: CommissionRuleView) {
    setBusy("delete");
    setError(null);
    try {
      const res = await deleteCommissionRule(rule.id);
      if (!res.ok) {
        setError(res.error ?? "Smlouvu se nepodařilo smazat.");
        return;
      }
      notify("success", "Smlouva smazána — provize se přepočítaly dle předchozí smlouvy.");
      setConfirmDelete(null);
      onOpenChange(false);
      onSaved();
    } catch {
      setError("Spojení se nepovedlo — zkus to znovu.");
    } finally {
      setBusy(null);
    }
  }

  return (
    <Dialog open={open} onOpenChange={(o) => !busy && onOpenChange(o)}>
      <DialogContent
        aria-describedby={undefined}
        className="left-0 top-0 h-[100dvh] max-h-[100dvh] w-full max-w-none translate-x-0 overflow-y-auto rounded-none border-0 sm:left-1/2 sm:top-[4%] sm:h-auto sm:max-h-[92vh] sm:w-[calc(100%-2rem)] sm:max-w-3xl sm:-translate-x-1/2 sm:rounded-xl sm:border"
      >
        <div className="flex items-center gap-3 border-b px-5 py-4 pr-12">
          <span className="flex h-9 w-9 items-center justify-center rounded-lg bg-emerald-500/15 text-emerald-600 dark:text-emerald-400">
            <FileSignature className="h-5 w-5" />
          </span>
          <div className="min-w-0">
            <DialogTitle>Smlouva a provize</DialogTitle>
            <p className="truncate text-xs text-muted-foreground">{user.fullName} · {user.email}</p>
          </div>
        </div>

        <form onSubmit={save} className="space-y-5 p-4 sm:p-5" noValidate>
          {/* platná smlouva + historie */}
          <div className="space-y-2">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <p className="text-sm font-medium">
                Platí teď:{" "}
                <span className="rounded-full bg-emerald-600 px-2.5 py-0.5 text-xs font-semibold text-white">
                  {current ? ruleSummary(current) : user.commissionPercent > 0 ? `${String(user.commissionPercent).replace(".", ",")} % ze zisku (sazba z profilu)` : "bez provize"}
                </span>
              </p>
              {rules.length > 0 && (
                <Button type="button" size="sm" variant="outline" onClick={() => setForm(formFromRule(current, user.commissionPercent, today, true))}>
                  <Plus className="h-4 w-4" /> Nový dodatek
                </Button>
              )}
            </div>
            {rules.length > 0 && (
              <ul className="divide-y rounded-xl border">
                {rules.map((r) => (
                  <li key={r.id} className={cn("flex flex-wrap items-center gap-2 px-3 py-2 text-sm", form.id === r.id && "bg-emerald-50/70 dark:bg-emerald-500/10")}>
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-1.5">
                        <span className="font-medium">{r.name ?? ruleSummary(r)}</span>
                        {current?.id === r.id && <span className="rounded-full bg-emerald-100 px-1.5 py-px text-[10px] font-semibold text-emerald-800 dark:bg-emerald-500/20 dark:text-emerald-200">platná</span>}
                        {r.validFrom > today && <span className="rounded-full bg-sky-100 px-1.5 py-px text-[10px] font-semibold text-sky-800 dark:bg-sky-500/20 dark:text-sky-200">budoucí</span>}
                      </div>
                      <div className="text-[11px] text-muted-foreground" suppressHydrationWarning>
                        {ruleSummary(r)} · od {czDay(r.validFrom)}
                        {r.changedBy ? ` · upravil ${r.changedBy}${r.changedAt ? ` ${formatStamp(r.changedAt)}` : ""}` : ""}
                      </div>
                    </div>
                    <Button type="button" size="sm" variant="ghost" onClick={() => setForm(formFromRule(r, user.commissionPercent, today))}>
                      <Pencil className="h-3.5 w-3.5" /> Upravit
                    </Button>
                    <Button type="button" size="icon-sm" variant="ghost" onClick={() => setConfirmDelete(r)} aria-label={`Smazat smlouvu ${r.name ?? ""}`} className="text-muted-foreground hover:text-red-600">
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  </li>
                ))}
              </ul>
            )}
            {confirmDelete && (
              <div role="alert" className="flex flex-col gap-2 rounded-xl border border-red-200 bg-red-50 p-3 text-sm text-red-800 sm:flex-row sm:items-center dark:border-red-500/30 dark:bg-red-500/10 dark:text-red-200">
                <span className="flex-1">Smazat smlouvu „{confirmDelete.name ?? ruleSummary(confirmDelete)}“? Provize se přepočítají dle předchozí smlouvy (nebo sazby z profilu).</span>
                <div className="flex gap-2">
                  <Button type="button" size="sm" variant="ghost" onClick={() => setConfirmDelete(null)} disabled={busy !== null}><X className="h-4 w-4" /> Ne</Button>
                  <Button type="button" size="sm" variant="destructive" onClick={() => void remove(confirmDelete)} disabled={busy !== null}>
                    {busy === "delete" ? <Loader2 className="h-4 w-4 animate-spin" /> : <Trash2 className="h-4 w-4" />} Smazat
                  </Button>
                </div>
              </div>
            )}
          </div>

          <div className="space-y-1">
            <p className="text-sm font-semibold">{form.id ? "Úprava smlouvy" : rules.length ? "Nový dodatek smlouvy" : "Nová smlouva"}</p>
            <p className="text-xs text-muted-foreground">Smlouva má přednost před sazbou v profilu. Platí nejnovější smlouva s datem „platí od“ ≤ datum zakázky / měsíce.</p>
          </div>

          {error && (
            <div role="alert" className="flex items-start gap-2 rounded-lg border border-destructive/25 bg-destructive/10 p-3 text-sm text-destructive">
              <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
              <span>{error}</span>
            </div>
          )}

          <div className="grid gap-2 sm:grid-cols-3" role="radiogroup" aria-label="Druh provize">
            {PRESETS.map((p) => {
              const Icon = p.icon;
              const active = form.base === p.base;
              return (
                <button
                  key={p.base}
                  type="button"
                  role="radio"
                  aria-checked={active}
                  onClick={() => {
                    set("base", p.base);
                    if (p.base === "margin_tiered" && !form.tiers.length) set("tiers", tierDraftsFromTiers(null));
                  }}
                  className={cn(
                    "flex flex-col gap-1 rounded-xl border p-3 text-left text-sm transition hover:-translate-y-0.5 hover:shadow-md",
                    active ? "border-emerald-500 bg-emerald-50 ring-2 ring-emerald-500/30 dark:bg-emerald-500/10" : "bg-card",
                  )}
                >
                  <span className="flex items-center gap-2 font-semibold">
                    <Icon className={cn("h-4 w-4", p.tone)} /> {BASE_LABELS[p.base]}
                    {active && <CheckCircle2 className="ml-auto h-4 w-4 text-emerald-600" />}
                  </span>
                  <span className="text-xs text-muted-foreground">{p.hint}</span>
                </button>
              );
            })}
          </div>

          {form.base === "margin_tiered" ? (
            <div className="space-y-2">
              <div className="overflow-hidden rounded-xl border">
                <div className="grid grid-cols-[minmax(0,1fr)_minmax(0,1.2fr)_5.5rem_2.25rem] gap-2 bg-muted/50 px-3 py-1.5 text-[11px] font-medium text-muted-foreground">
                  <span>Od (Kč inkasa)</span>
                  <span>Do (Kč inkasa)</span>
                  <span className="text-right">Sazba ze zisku</span>
                  <span />
                </div>
                <ul className="divide-y">
                  {form.tiers.map((t, i) => {
                    const last = i === form.tiers.length - 1;
                    const prev = i === 0 ? 0 : money(form.tiers[i - 1].to || "x");
                    const from = form.tiers[i - 1]?.to.trim() === "" || !Number.isFinite(prev) ? "?" : new Intl.NumberFormat("cs-CZ").format(prev);
                    const tone = bandTone(i);
                    return (
                      <li key={t.key} className="grid grid-cols-[minmax(0,1fr)_minmax(0,1.2fr)_5.5rem_2.25rem] items-center gap-2 px-3 py-1.5">
                        <span className="flex items-center gap-1.5 truncate text-sm tabular-nums text-muted-foreground">
                          <span className={cn("h-2.5 w-2.5 shrink-0 rounded-full", tone.fill)} />
                          {from}
                        </span>
                        {last ? (
                          <span className="text-sm text-muted-foreground">a více</span>
                        ) : (
                          <Input inputMode="decimal" value={t.to} onChange={(e) => setTier(i, "to", e.target.value)} aria-label={`Horní hranice pásma ${i + 1}`} className="h-8 tabular-nums" />
                        )}
                        <div className="relative">
                          <Input inputMode="decimal" value={t.rate} onChange={(e) => setTier(i, "rate", e.target.value)} aria-label={`Sazba pásma ${i + 1} v procentech`} className="h-8 pr-6 text-right tabular-nums" />
                          <span className="pointer-events-none absolute right-2 top-1/2 -translate-y-1/2 text-xs text-muted-foreground">%</span>
                        </div>
                        <button
                          type="button"
                          onClick={() => set("tiers", removeTierDraft(form.tiers, i))}
                          disabled={form.tiers.length <= 1}
                          className="flex h-8 w-8 items-center justify-center rounded-md text-muted-foreground hover:bg-red-50 hover:text-red-600 disabled:opacity-30 dark:hover:bg-red-500/10"
                          aria-label={`Odebrat pásmo ${i + 1}`}
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                        </button>
                      </li>
                    );
                  })}
                </ul>
              </div>
              <div className="flex flex-wrap items-center justify-between gap-2">
                <Button type="button" size="sm" variant="outline" onClick={() => set("tiers", addTierDraft(form.tiers))}>
                  <Plus className="h-4 w-4" /> Přidat pásmo
                </Button>
                {tierError ? (
                  <span className="text-xs text-red-600 dark:text-red-400">{tierError}</span>
                ) : (
                  <span className="text-xs text-muted-foreground">Sleduje se inkasovaný obrat v kalendářním měsíci (bez DPH).</span>
                )}
              </div>
            </div>
          ) : (
            <label className="block max-w-xs space-y-1">
              <span className="flex items-center gap-1.5 text-xs font-medium text-muted-foreground">
                <Percent className="h-3.5 w-3.5 text-emerald-600" /> Sazba provize {form.base === "revenue" ? "z obratu" : "ze zisku"}
              </span>
              <div className="relative">
                <Input inputMode="decimal" value={form.rate} onChange={(e) => set("rate", e.target.value)} className="pr-7 text-right tabular-nums" />
                <span className="pointer-events-none absolute right-2.5 top-1/2 -translate-y-1/2 text-sm text-muted-foreground">%</span>
              </div>
            </label>
          )}

          <div className="grid gap-3 sm:grid-cols-3">
            <label className="block space-y-1 sm:col-span-3">
              <span className="flex items-center gap-1.5 text-xs font-medium text-muted-foreground"><Type className="h-3.5 w-3.5 text-emerald-600" /> Název smlouvy</span>
              <Input value={form.name} onChange={(e) => set("name", e.target.value)} placeholder={DEFAULT_RULE_NAMES[form.base]} />
            </label>
            <label className="block space-y-1">
              <span className="flex items-center gap-1.5 text-xs font-medium text-muted-foreground"><CalendarDays className="h-3.5 w-3.5 text-emerald-600" /> Platí od</span>
              <Input type="date" value={form.validFrom} onChange={(e) => set("validFrom", e.target.value)} />
            </label>
            <label className="block space-y-1">
              <span className="flex items-center gap-1.5 text-xs font-medium text-muted-foreground"><Clock className="h-3.5 w-3.5 text-emerald-600" /> Splatnost (dní po konci měsíce)</span>
              <Input inputMode="numeric" value={form.payoutDays} onChange={(e) => set("payoutDays", e.target.value)} />
            </label>
            <label className="block space-y-1 sm:col-span-3">
              <span className="flex items-center gap-1.5 text-xs font-medium text-muted-foreground"><StickyNote className="h-3.5 w-3.5 text-emerald-600" /> Poznámka (znění smlouvy, výjimky)</span>
              <Textarea rows={2} value={form.note} onChange={(e) => set("note", e.target.value)} />
            </label>
          </div>

          {/* modelový příklad */}
          <div className="space-y-2 rounded-xl border border-violet-200/70 bg-violet-50/50 p-3 dark:border-violet-500/25 dark:bg-violet-500/10">
            <p className="flex items-center gap-1.5 text-sm font-medium">
              <Calculator className="h-4 w-4 text-violet-600" /> Modelový příklad
              <span className="text-xs font-normal text-muted-foreground">— jen náhled, skutečnou provizi počítá databáze</span>
            </p>
            <div className="grid gap-2 sm:grid-cols-[1fr_1fr_auto] sm:items-end">
              <label className="block space-y-1">
                <span className="text-[11px] text-muted-foreground">{form.base === "margin_tiered" ? "Inkaso v měsíci" : "Obrat zakázky"}</span>
                <Input inputMode="decimal" value={example.revenue} onChange={(e) => setExample({ ...example, revenue: e.target.value })} className="h-8 tabular-nums" />
              </label>
              <label className="block space-y-1">
                <span className="text-[11px] text-muted-foreground">Zisk</span>
                <Input inputMode="decimal" value={example.profit} onChange={(e) => setExample({ ...example, profit: e.target.value })} className="h-8 tabular-nums" />
              </label>
              <div className="rounded-lg bg-violet-600 px-3 py-1.5 text-right text-white">
                <div className="text-[10px] uppercase tracking-wide text-white/80">Provize</div>
                <div className="text-lg font-bold tabular-nums">{ex ? czk(ex.commission) : simple !== null ? czk(simple) : "—"}</div>
              </div>
            </div>
            {ex && (
              <p className="text-xs text-muted-foreground">
                {ex.bands.map((b, i) => (
                  <span key={i} className="mr-2 inline-block">
                    <span className={cn("font-semibold", bandTone(i).text)}>{formatRate(b.rate)}</span> z {czk(b.profit)} = {czk(b.commission)}
                    {i < ex.bands.length - 1 ? " +" : ""}
                  </span>
                ))}
              </p>
            )}
          </div>

          <div className="sticky bottom-0 -mx-4 -mb-4 flex flex-col-reverse gap-2 border-t bg-popover/95 px-4 py-3 backdrop-blur sm:-mx-5 sm:-mb-5 sm:flex-row sm:justify-end sm:px-5">
            <Button type="button" variant="ghost" onClick={() => onOpenChange(false)} disabled={busy !== null}>Zrušit</Button>
            <Button type="submit" variant="success" disabled={busy !== null || Boolean(tierError)}>
              {busy === "save" && <Loader2 className="h-4 w-4 animate-spin" />} {form.id ? "Uložit smlouvu" : "Uložit novou smlouvu"}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
