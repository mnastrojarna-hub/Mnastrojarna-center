"use client";

import * as React from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  ArrowRight, Building2, Calculator, CheckCircle2, ChevronDown, FileText, Loader2, Plus, Save, Sparkles, Trash2,
  UserRound, AlertCircle, Flame,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { StageBadge } from "@/components/jobs/stage-badge";
import { createJobQuote, saveJobItems, updateJob } from "@/app/actions/jobs";
import { stageMeta } from "@/lib/jobs/stages";
import type { JobStage, PriorityLevel, QuoteStatus } from "@/lib/supabase/database.types";
import type { JobItemInput, PersonRef } from "@/lib/jobs/types";
import { cn } from "@/lib/utils";
import { DeadlineChip } from "./flow-job-list";
import {
  addDaysIso, amountInput, formatPercent, marginPercent, marginTone, parseAmount, pricingSummary, quoteStatusUi,
} from "./flow-utils";

/** Zakázka k nacenění (čistá data ze serveru). */
export interface PricingJob {
  id: string;
  number: string;
  title: string;
  stage: JobStage;
  priority: PriorityLevel;
  customerName: string | null;
  customerNumber: string | null;
  customerInquiryNumber: string | null;
  customerRequiredDate: string | null;
  dueDate: string | null;
  maxToleratedDate: string | null;
  supplierPromisedDate: string | null;
  owner: PersonRef | null;
  pricedBy: PersonRef | null;
  currency: string;
  value: number | null;
  aiFilled: boolean;
  items: {
    id: string;
    drawingNumber: string | null;
    revision: string | null;
    name: string | null;
    description: string | null;
    material: string | null;
    quantity: number;
    unit: string;
    unitPrice: number | null;
    purchaseUnitPrice: number | null;
    note: string | null;
  }[];
  quotes: { id: string; number: string; status: QuoteStatus; revision: number; archived: boolean; total: number | null }[];
}

interface Row {
  key: string;
  id?: string;
  drawingNumber: string;
  revision: string | null;
  name: string;
  description: string | null;
  material: string;
  quantity: string;
  unit: string;
  price: string;
  purchase: string;
  note: string | null;
}

interface Result {
  quote?: { id: string; number: string };
  saved?: boolean;
}

let seq = 0;
const newKey = () => `n${++seq}`;

function toRows(job: PricingJob): Row[] {
  return job.items.map((it) => ({
    key: it.id,
    id: it.id,
    drawingNumber: it.drawingNumber ?? "",
    revision: it.revision,
    name: it.name ?? "",
    description: it.description,
    material: it.material ?? "",
    quantity: amountInput(it.quantity),
    unit: it.unit || "ks",
    price: amountInput(it.unitPrice),
    purchase: amountInput(it.purchaseUnitPrice),
    note: it.note,
  }));
}

function emptyRow(): Row {
  return {
    key: newKey(), drawingNumber: "", revision: null, name: "", description: null, material: "", quantity: "1",
    unit: "ks", price: "", purchase: "", note: null,
  };
}

function money(n: number | null, currency: string): string {
  if (n === null || !Number.isFinite(n)) return "—";
  try {
    return new Intl.NumberFormat("cs-CZ", { style: "currency", currency: currency || "CZK", maximumFractionDigits: 2 }).format(n);
  } catch {
    return `${n} ${currency}`;
  }
}

/** Obsah řádků bez klíčů (pro „neuložené změny"). */
function signature(rows: Row[]): string {
  return JSON.stringify(rows.map((r) => [r.id ?? null, r.drawingNumber, r.name, r.material, r.quantity, r.unit, r.price, r.purchase]));
}

/** Řádek → čísla (null = prázdné, NaN = neplatné). */
function parsed(r: Row) {
  const q = parseAmount(r.quantity);
  const p = parseAmount(r.price);
  const b = parseAmount(r.purchase);
  return {
    quantity: q.ok ? q.value : NaN,
    price: p.ok ? p.value : NaN,
    purchase: b.ok ? b.value : NaN,
  };
}

export function PricingBoard({
  jobs,
  me,
  margins,
  today,
  initialOpenId,
}: {
  jobs: PricingJob[];
  me: PersonRef;
  margins: boolean;
  today: string;
  /** Rozbalit tuto zakázku (odkaz „Nacenit" z Poptávek), jinak první. */
  initialOpenId?: string | null;
}) {
  const [openId, setOpenId] = React.useState<string | null>(
    initialOpenId && jobs.some((j) => j.id === initialOpenId) ? initialOpenId : (jobs[0]?.id ?? null),
  );
  const [results, setResults] = React.useState<Record<string, Result>>({});

  // odkaz „Nacenit" z Poptávek → dojet k rozbalené zakázce
  React.useEffect(() => {
    if (!initialOpenId) return;
    document.getElementById(`job-${initialOpenId}`)?.scrollIntoView({ block: "start", behavior: "smooth" });
  }, [initialOpenId]);

  return (
    <ul className="space-y-2">
      {jobs.map((job) => {
        const open = openId === job.id;
        const unpriced = job.items.filter((i) => i.unitPrice === null).length;
        const priced = job.items.length > 0 && unpriced === 0;
        const quotes = job.quotes.filter((q) => !q.archived);
        const m = stageMeta(job.stage);
        return (
          <li key={job.id} id={`job-${job.id}`} className={cn("relative scroll-mt-24 overflow-hidden rounded-xl border bg-card shadow-sm transition", open && "shadow-md ring-1 ring-amber-300/60 dark:ring-amber-500/30")}>
            <span aria-hidden className={cn("absolute inset-y-0 left-0 w-1.5", m.bar)} />
            <button
              type="button"
              onClick={() => setOpenId(open ? null : job.id)}
              aria-expanded={open}
              className="flex w-full flex-col gap-2 p-3 pl-4 text-left transition hover:bg-accent/40 sm:flex-row sm:items-center"
            >
              <div className="min-w-0 flex-1 space-y-1">
                <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                  <span className="font-mono text-sm font-bold">{job.number}</span>
                  <StageBadge stage={job.stage} size="sm" />
                  {job.priority === "vysoka" && (
                    <span className="inline-flex items-center gap-0.5 rounded-full bg-red-100 px-1.5 py-0.5 text-[10.5px] font-semibold text-red-700 dark:bg-red-500/15 dark:text-red-300">
                      <Flame className="h-3 w-3" /> Spěchá
                    </span>
                  )}
                  <DeadlineChip job={job} today={today} />
                  {job.aiFilled && <Sparkles aria-label="Vyplněno AI" className="h-3.5 w-3.5 text-violet-500" />}
                </div>
                <p className="truncate font-medium">{job.title || "Bez názvu"}</p>
                <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
                  <span className="inline-flex items-center gap-1">
                    <Building2 className="h-3.5 w-3.5 text-sky-500" />
                    <span className="font-medium text-foreground/80">{job.customerName ?? "Zákazník neuveden"}</span>
                  </span>
                  {job.customerInquiryNumber && <span>Popt. zák. <span className="font-mono font-semibold">{job.customerInquiryNumber}</span></span>}
                  <span>{job.items.length ? `${job.items.length} pol.` : "bez položek"}</span>
                  {job.pricedBy && <span className="inline-flex items-center gap-1"><UserRound className="h-3.5 w-3.5" /> nacenil {job.pricedBy.name}</span>}
                </div>
              </div>
              <div className="flex shrink-0 items-center gap-2">
                {quotes.length > 0 && (
                  <span className="inline-flex items-center gap-1 rounded-full bg-violet-100 px-2 py-0.5 text-[11px] font-semibold text-violet-800 dark:bg-violet-500/15 dark:text-violet-300">
                    <FileText className="h-3 w-3" /> {quotes.length === 1 ? quotes[0].number : `${quotes.length} nabídky`}
                  </span>
                )}
                {priced ? (
                  <span className="inline-flex items-center gap-1 rounded-full bg-green-100 px-2 py-0.5 text-xs font-semibold text-green-800 dark:bg-green-500/15 dark:text-green-300">
                    <CheckCircle2 className="h-3.5 w-3.5" /> {money(job.value, job.currency)}
                  </span>
                ) : (
                  <span className="inline-flex items-center gap-1 rounded-full bg-amber-100 px-2 py-0.5 text-xs font-semibold text-amber-800 dark:bg-amber-500/15 dark:text-amber-300">
                    <Calculator className="h-3.5 w-3.5" /> {job.items.length ? `chybí ${unpriced} ${unpriced === 1 ? "cena" : unpriced < 5 ? "ceny" : "cen"}` : "nacenit"}
                  </span>
                )}
                <ChevronDown className={cn("h-5 w-5 text-muted-foreground transition-transform", open && "rotate-180")} />
              </div>
            </button>
            {open && (
              <PricingPanel
                key={`${job.id}:${job.items.map((i) => i.id).join(",")}`}
                job={job}
                me={me}
                margins={margins}
                today={today}
                result={results[job.id]}
                onResult={(r) => setResults((all) => ({ ...all, [job.id]: { ...all[job.id], ...r } }))}
              />
            )}
          </li>
        );
      })}
    </ul>
  );
}

function PricingPanel({
  job,
  me,
  margins,
  today,
  result,
  onResult,
}: {
  job: PricingJob;
  me: PersonRef;
  margins: boolean;
  today: string;
  result?: Result;
  onResult: (r: Result) => void;
}) {
  const router = useRouter();
  const initial = React.useMemo(() => (job.items.length ? toRows(job) : [emptyRow()]), [job]);
  const [rows, setRows] = React.useState<Row[]>(initial);
  const [leadTime, setLeadTime] = React.useState("");
  const [validity, setValidity] = React.useState("30");
  const [busy, setBusy] = React.useState<null | "save" | "quote">(null);
  const [error, setError] = React.useState<string | null>(null);
  const [baseline] = React.useState(() => signature(initial));
  const dirty = signature(rows) !== baseline || !job.items.length;

  const nums = rows.map(parsed);
  const summary = pricingSummary(
    nums.map((n) => ({
      quantity: Number.isFinite(n.quantity) && n.quantity !== null ? n.quantity : 0,
      unitPrice: Number.isFinite(n.price) ? n.price : null,
      purchaseUnitPrice: margins && Number.isFinite(n.purchase) ? n.purchase : null,
    })),
  );

  function patch(key: string, p: Partial<Row>) {
    setRows((list) => list.map((r) => (r.key === key ? { ...r, ...p } : r)));
  }

  /** Kontrola + převod na vstup akcí; chyba = text. */
  function collect(): { items: JobItemInput[] } | { error: string } {
    const items: JobItemInput[] = [];
    for (let i = 0; i < rows.length; i++) {
      const r = rows[i];
      const n = nums[i];
      const empty = !r.drawingNumber.trim() && !r.name.trim() && !r.price.trim() && !r.id;
      if (empty) continue;
      if (n.quantity === null || !Number.isFinite(n.quantity) || n.quantity <= 0) return { error: `Položka ${i + 1}: počet kusů musí být kladné číslo.` };
      if (Number.isNaN(n.price) || (n.price !== null && n.price < 0)) return { error: `Položka ${i + 1}: neplatná prodejní cena.` };
      if (margins && (Number.isNaN(n.purchase) || (n.purchase !== null && n.purchase < 0))) return { error: `Položka ${i + 1}: neplatná nákupní cena.` };
      items.push({
        ...(r.id ? { id: r.id } : {}),
        drawingNumber: r.drawingNumber.trim() || undefined,
        revision: r.revision ?? undefined,
        name: r.name.trim() || undefined,
        description: r.description ?? undefined,
        material: r.material.trim() || undefined,
        quantity: n.quantity,
        unit: r.unit || "ks",
        unitPrice: n.price,
        ...(margins ? { purchaseUnitPrice: n.purchase } : {}),
        note: r.note ?? undefined,
      });
    }
    if (!items.length) return { error: "Přidej aspoň jednu položku (číslo výkresu nebo název a počet kusů)." };
    return { items };
  }

  async function persist(items: JobItemInput[]): Promise<string | null> {
    const saved = await saveJobItems(job.id, items);
    if (!saved.ok) return saved.error ?? "Nacenění se nepodařilo uložit.";
    const up = await updateJob(job.id, { pricedById: me.id, ...(job.stage === "poptavka" ? { stage: "naceneni" as const } : {}) });
    if (!up.ok) return up.error ?? "Ceny jsou uložené, ale nepodařilo se zapsat, kdo nacenil.";
    return null;
  }

  async function save() {
    if (busy) return;
    const c = collect();
    if ("error" in c) return setError(c.error);
    setBusy("save");
    setError(null);
    try {
      const err = await persist(c.items);
      if (err) return setError(err);
      onResult({ saved: true });
      router.refresh();
    } catch {
      setError("Spojení se nepovedlo — zkus to znovu.");
    } finally {
      setBusy(null);
    }
  }

  async function makeQuote() {
    if (busy) return;
    const c = collect();
    if ("error" in c) return setError(c.error);
    const missing = c.items.filter((i) => i.unitPrice === null || i.unitPrice === undefined).length;
    if (missing) return setError(`Doplň prodejní cenu u všech položek (chybí u ${missing}) — pak z ní vytvořím nabídku.`);
    const lead = parseAmount(leadTime);
    if (!lead.ok || (lead.value !== null && (lead.value < 0 || lead.value > 3650))) return setError("Dodací lhůta musí být počet dní (např. 21).");
    const valid = parseAmount(validity);
    if (!valid.ok || valid.value === null || valid.value <= 0 || valid.value > 365) return setError("Platnost nabídky zadej ve dnech (např. 30).");
    setBusy("quote");
    setError(null);
    try {
      if (dirty) {
        const err = await persist(c.items);
        if (err) return setError(err);
      }
      const res = await createJobQuote(job.id, {
        title: job.title || undefined,
        leadTimeDays: lead.value === null ? null : Math.round(lead.value),
        validUntil: addDaysIso(today, Math.round(valid.value)),
        items: c.items.map((i) => ({
          drawingNumber: i.drawingNumber,
          name: i.name,
          description: i.description,
          material: i.material,
          quantity: i.quantity,
          unit: i.unit,
          unitPrice: i.unitPrice,
          ...(margins ? { purchaseUnitPrice: i.purchaseUnitPrice } : {}),
          note: i.note,
        })),
      });
      if (!res.ok || !res.id) return setError(res.error ?? "Nabídku se nepodařilo vytvořit.");
      onResult({ quote: { id: res.id, number: res.number ?? "" }, saved: true });
      router.refresh();
    } catch {
      setError("Spojení se nepovedlo — zkus to znovu.");
    } finally {
      setBusy(null);
    }
  }

  const grid = margins
    ? "md:grid-cols-[minmax(0,2.4fr)_minmax(0,1fr)_4.5rem_7.5rem_7.5rem_4.5rem_7rem_2.25rem]"
    : "md:grid-cols-[minmax(0,2.4fr)_minmax(0,1fr)_4.5rem_7.5rem_7rem_2.25rem]";
  const cur = job.currency || "CZK";

  return (
    <div className="space-y-4 border-t bg-amber-50/30 p-3 pl-4 dark:bg-amber-500/[0.03] sm:p-4 sm:pl-5">
      {result?.quote && (
        <div role="status" className="flex flex-col gap-2 rounded-xl border border-violet-200 bg-violet-50 p-3 text-sm text-violet-900 dark:border-violet-500/30 dark:bg-violet-500/10 dark:text-violet-100 sm:flex-row sm:items-center">
          <CheckCircle2 className="h-5 w-5 shrink-0 text-violet-600" />
          <p className="min-w-0 flex-1">
            Nabídka <span className="font-mono font-semibold">{result.quote.number}</span> je vytvořená a čeká na schválení a odeslání.
          </p>
          <div className="flex flex-wrap gap-2">
            <Button asChild size="sm" variant="outline">
              <Link href={`/orders/${job.id}?tab=nabidky`}>Otevřít nabídku</Link>
            </Button>
            <Button asChild size="sm" className="bg-violet-600 text-white hover:bg-violet-600/90">
              <Link href="/quotes">Schválit a odeslat <ArrowRight className="h-3.5 w-3.5" /></Link>
            </Button>
          </div>
        </div>
      )}

      <div className="space-y-2">
        <div className={cn("hidden gap-2 px-1 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground md:grid", grid)}>
          <span>Výkres a název</span>
          <span>Materiál</span>
          <span className="text-right">Kusů</span>
          <span className="text-right">Prodej / ks</span>
          {margins && <span className="text-right">Nákup / ks</span>}
          {margins && <span className="text-right">Marže</span>}
          <span className="text-right">Celkem</span>
          <span />
        </div>
        {rows.map((r, i) => {
          const n = nums[i];
          const qtyBad = n.quantity === null || !Number.isFinite(n.quantity) || n.quantity <= 0;
          const priceBad = Number.isNaN(n.price);
          const purchaseBad = Number.isNaN(n.purchase);
          const line = !qtyBad && n.price !== null && Number.isFinite(n.price) ? (n.quantity as number) * n.price : null;
          const pct = margins ? marginPercent(Number.isFinite(n.price) ? n.price : null, Number.isFinite(n.purchase) ? n.purchase : null) : null;
          return (
            <div key={r.key} className={cn("grid grid-cols-2 items-center gap-2 rounded-lg border bg-card p-2 md:border-0 md:bg-transparent md:p-0 md:px-1", grid)}>
              <div className="col-span-2 flex gap-1.5 md:col-span-1">
                <Input
                  aria-label={`Položka ${i + 1}: číslo výkresu`}
                  value={r.drawingNumber}
                  onChange={(e) => patch(r.key, { drawingNumber: e.target.value })}
                  placeholder="Výkres"
                  className="w-28 shrink-0 font-mono text-xs"
                />
                <Input
                  aria-label={`Položka ${i + 1}: název`}
                  value={r.name}
                  onChange={(e) => patch(r.key, { name: e.target.value })}
                  placeholder="Název dílu"
                  className="min-w-0 flex-1"
                />
              </div>
              <label className="col-span-2 block md:col-span-1">
                <span className="text-[11px] text-muted-foreground md:hidden">Materiál</span>
                <Input value={r.material} onChange={(e) => patch(r.key, { material: e.target.value })} placeholder="C45, 1.4301…" aria-label={`Položka ${i + 1}: materiál`} />
              </label>
              <label className="block">
                <span className="text-[11px] text-muted-foreground md:hidden">Kusů</span>
                <Input
                  inputMode="decimal"
                  value={r.quantity}
                  onChange={(e) => patch(r.key, { quantity: e.target.value })}
                  aria-label={`Položka ${i + 1}: počet kusů`}
                  aria-invalid={qtyBad}
                  className={cn("text-right tabular-nums", qtyBad && "border-red-400 focus-visible:ring-red-400")}
                />
              </label>
              <label className="block">
                <span className="text-[11px] text-muted-foreground md:hidden">Prodej / ks ({cur})</span>
                <Input
                  inputMode="decimal"
                  value={r.price}
                  onChange={(e) => patch(r.key, { price: e.target.value })}
                  placeholder="cena"
                  aria-label={`Položka ${i + 1}: prodejní cena za kus`}
                  aria-invalid={priceBad}
                  className={cn(
                    "text-right font-semibold tabular-nums",
                    !r.price.trim() && "border-amber-300 bg-amber-50/60 dark:border-amber-500/40 dark:bg-amber-500/10",
                    priceBad && "border-red-400 focus-visible:ring-red-400",
                  )}
                />
              </label>
              {margins && (
                <label className="block">
                  <span className="text-[11px] text-muted-foreground md:hidden">Nákup / ks ({cur})</span>
                  <Input
                    inputMode="decimal"
                    value={r.purchase}
                    onChange={(e) => patch(r.key, { purchase: e.target.value })}
                    placeholder="nákup"
                    aria-label={`Položka ${i + 1}: nákupní cena za kus`}
                    aria-invalid={purchaseBad}
                    className={cn("text-right tabular-nums", purchaseBad && "border-red-400 focus-visible:ring-red-400")}
                  />
                </label>
              )}
              {margins && (
                <div className="text-right">
                  <span className="text-[11px] text-muted-foreground md:hidden">Marže </span>
                  <span className={cn("text-sm font-semibold tabular-nums", marginTone(pct))}>{formatPercent(pct)}</span>
                </div>
              )}
              <div className="text-right">
                <span className="text-[11px] text-muted-foreground md:hidden">Celkem </span>
                <span className="text-sm font-semibold tabular-nums">{line === null ? "—" : money(line, cur)}</span>
              </div>
              <div className="flex justify-end">
                <Button
                  type="button"
                  size="icon-sm"
                  variant="ghost"
                  aria-label={`Odebrat položku ${i + 1}`}
                  onClick={() => setRows((list) => (list.length > 1 ? list.filter((x) => x.key !== r.key) : [emptyRow()]))}
                  className="text-muted-foreground hover:text-red-600"
                >
                  <Trash2 className="h-4 w-4" />
                </Button>
              </div>
            </div>
          );
        })}
        <Button type="button" size="sm" variant="ghost" onClick={() => setRows((list) => [...list, emptyRow()])} className="text-amber-700 hover:bg-amber-100 dark:text-amber-300 dark:hover:bg-amber-500/10">
          <Plus className="h-4 w-4" /> Přidat položku
        </Button>
      </div>

      <div className="grid gap-3 lg:grid-cols-[1fr_auto]">
        <div className="flex flex-wrap items-end gap-3">
          <label className="block w-36 space-y-1">
            <span className="text-xs font-medium text-muted-foreground">Dodací lhůta (dní)</span>
            <Input inputMode="numeric" value={leadTime} onChange={(e) => setLeadTime(e.target.value)} placeholder="např. 21" />
          </label>
          <label className="block w-36 space-y-1">
            <span className="text-xs font-medium text-muted-foreground">Platnost nabídky (dní)</span>
            <Input inputMode="numeric" value={validity} onChange={(e) => setValidity(e.target.value)} />
          </label>
          <span className="inline-flex h-9 items-center gap-1.5 rounded-full bg-muted px-3 text-xs text-muted-foreground">
            <UserRound className="h-3.5 w-3.5" /> Nacenil: <span className="font-semibold text-foreground">{me.name}</span>
          </span>
        </div>
        <div className="flex flex-wrap items-center gap-x-5 gap-y-1 rounded-xl border bg-card px-4 py-2.5 text-sm">
          <span>
            Celkem <span className="text-lg font-bold tabular-nums">{money(summary.sale, cur)}</span>
            <span className="ml-1 text-xs text-muted-foreground">bez DPH</span>
          </span>
          {margins && (
            <span className="text-xs text-muted-foreground">
              nákup <span className="font-semibold text-foreground tabular-nums">{money(summary.purchase, cur)}</span>
              {" · "}marže <span className={cn("font-semibold tabular-nums", marginTone(summary.marginPct))}>{formatPercent(summary.marginPct)}</span>
            </span>
          )}
          {summary.unpriced > 0 && (
            <span className="text-xs font-semibold text-amber-700 dark:text-amber-400">bez ceny: {summary.unpriced}</span>
          )}
        </div>
      </div>

      {error && (
        <p role="alert" className="flex items-start gap-2 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700 dark:border-red-500/30 dark:bg-red-500/10 dark:text-red-300">
          <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" /> {error}
        </p>
      )}

      <div className="flex flex-col-reverse gap-2 sm:flex-row sm:items-center sm:justify-end">
        {result?.saved && !dirty && !result.quote && (
          <span className="inline-flex items-center gap-1 text-sm text-green-700 dark:text-green-400 sm:mr-auto">
            <CheckCircle2 className="h-4 w-4" /> Uloženo — AI se z tvých cen učí.
          </span>
        )}
        {dirty && job.items.length > 0 && <span className="text-xs text-amber-700 dark:text-amber-400 sm:mr-auto">Neuložené změny</span>}
        <Button asChild type="button" variant="ghost">
          <Link href={`/orders/${job.id}`}>Otevřít kartu zakázky</Link>
        </Button>
        <Button type="button" variant="outline" onClick={() => void save()} disabled={Boolean(busy)}>
          {busy === "save" ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />} Uložit nacenění
        </Button>
        <Button type="button" onClick={() => void makeQuote()} disabled={Boolean(busy)} className="bg-violet-600 text-white shadow-sm hover:bg-violet-600/90">
          {busy === "quote" ? <Loader2 className="h-4 w-4 animate-spin" /> : <FileText className="h-4 w-4" />} Vytvořit nabídku z ceny
        </Button>
      </div>

      {job.quotes.length > 0 && (
        <div className="flex flex-wrap items-center gap-1.5 text-xs text-muted-foreground">
          <span>Nabídky zakázky:</span>
          {job.quotes.map((q) => {
            const ui = quoteStatusUi(q.status);
            return (
              <Link key={q.id} href={`/orders/${job.id}?tab=nabidky`} className={cn("inline-flex items-center gap-1 rounded-full px-2 py-0.5 font-medium hover:brightness-95", ui.badge, q.archived && "opacity-60 line-through")}>
                <span className="font-mono">{q.number}</span> · {ui.label}
              </Link>
            );
          })}
        </div>
      )}
    </div>
  );
}
