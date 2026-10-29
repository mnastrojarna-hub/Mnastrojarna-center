"use client";

import * as React from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  AlertTriangle, ArrowLeft, Building2, CheckCheck, CheckCircle2, Copy, Factory, Info, Loader2, PencilLine, RefreshCw, Save, Sparkles, Trash2, Undo2,
  Wallet, XCircle,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ToastProvider, useNotify } from "@/components/jobs/detail/toast";
import { InvoicePreview } from "@/components/supplier-invoices/invoice-preview";
import { AllocationEditor } from "@/components/supplier-invoices/allocation-editor";
import { draftsFromDetail, draftsProblem, draftsToInputs, sameDrafts, type AllocationDraft } from "@/components/supplier-invoices/allocation-model";
import { amountInput, dateText, formatMoney } from "@/components/supplier-invoices/format";
import {
  confirmSupplierInvoiceAi, deleteSupplierInvoice, fillSupplierInvoiceRate, markSupplierInvoiceNotDuplicate, saveSupplierInvoiceAllocations,
  saveSupplierInvoiceItems, setSupplierInvoiceFinalPo, setSupplierInvoicePayment, setSupplierInvoiceRejected, supplierFromInvoiceHeader,
  updateSupplierInvoiceHeader,
} from "@/app/actions/supplier-invoices";
import { invoiceUnallocated } from "@/lib/supplier-invoices/money";
import { INVOICE_STATUS_META, PAYMENT_STATUS_META, SOURCE_LABEL, type SupplierInvoiceDetail, type SupplierInvoicePaymentStatus } from "@/lib/supplier-invoices/types";
import { cn } from "@/lib/utils";

export function InvoiceDetailView(props: { initial: SupplierInvoiceDetail; today: string }) {
  return (
    <ToastProvider>
      <Detail {...props} />
    </ToastProvider>
  );
}

type ActionRes = { ok: true; invoice?: SupplierInvoiceDetail | null } | { ok: false; error: string };

/** Nahraná faktura bez výsledku AI po 3 minutách = čtení selhalo. */
const READ_TIMEOUT_MS = 3 * 60_000;

async function rereadRequest(id: string): Promise<ActionRes> {
  const res = await fetch(`/api/supplier-invoices/${id}/process`, { method: "POST", headers: { "content-type": "application/json" }, body: "{}" });
  const j = (await res.json().catch(() => ({}))) as { ok?: boolean; error?: string };
  return j.ok ? { ok: true as const } : { ok: false as const, error: j.error ?? "AI fakturu nepřečetla." };
}

function Detail({ initial, today }: { initial: SupplierInvoiceDetail; today: string }) {
  const router = useRouter();
  const notify = useNotify();
  const [inv, setInv] = React.useState(initial);
  const [rows, setRows] = React.useState<AllocationDraft[]>(() => draftsFromDetail(initial));
  const [busy, setBusy] = React.useState<string | null>(null);
  const [editHeader, setEditHeader] = React.useState(false);
  const [editItems, setEditItems] = React.useState(false);
  const [showPreview, setShowPreview] = React.useState(true);
  const saved = React.useMemo(() => draftsFromDetail(inv), [inv]);
  const dirty = !sameDrafts(rows, saved);
  const shape = { totalNet: inv.totalNet, items: inv.items.map((i) => ({ id: i.id, amount: i.amount })) };
  const problem = draftsProblem(rows, shape);
  const pendingAi = inv.allocations.filter((a) => !a.confirmed).length;
  const unallocated = invoiceUnallocated(inv.totalNet, shape.items.map((i) => ({ id: i.id, amount: i.amount ?? 0 })), rows.map((r) => ({ itemId: r.itemId, amount: r.amount })));
  const unread = inv.status === "nahrano" && !inv.aiProcessedAt;
  // čtení trvá do ~1 min; po 3 min bez výsledku je to selhání (pád na pozadí) → nabídnout přečíst znovu
  const [now, setNow] = React.useState(() => Date.now());
  const stale = unread && now - Date.parse(inv.createdAt) > READ_TIMEOUT_MS;
  const reading = unread && !stale;

  React.useEffect(() => { setInv(initial); setRows(draftsFromDetail(initial)); }, [initial]);
  // AI fakturu ještě čte → obnovovat (max. ~3 min)
  React.useEffect(() => {
    if (!reading) return;
    let n = 0;
    const t = window.setInterval(() => { n += 1; setNow(Date.now()); if (n > 60) window.clearInterval(t); router.refresh(); }, 3000);
    return () => window.clearInterval(t);
  }, [reading, router]);

  const run = async (key: string, fn: () => Promise<ActionRes>, ok?: string) => {
    if (busy) return false;
    setBusy(key);
    try {
      const res = await fn();
      if (!res.ok) { notify("error", res.error); return false; }
      if (res.invoice) { setInv(res.invoice); setRows(draftsFromDetail(res.invoice)); }
      if (ok) notify("success", ok);
      router.refresh();
      return true;
    } finally {
      setBusy(null);
    }
  };

  const st = INVOICE_STATUS_META[inv.status];
  const pay = inv.paymentStatus ? PAYMENT_STATUS_META[inv.paymentStatus] : null;
  // během čtení AI se needituje (nové čtení by úpravy přepsalo — server to navíc pozná a neuloží)
  const canEdit = inv.perms.edit && inv.status !== "zamitnuto" && !reading;

  return (
    <div className="space-y-4 pb-6">
      <div className="flex flex-wrap items-center gap-2">
        <Button asChild variant="ghost" size="sm" className="-ml-2"><Link href="/supplier-invoices"><ArrowLeft className="h-4 w-4" /> Faktury dodavatelů</Link></Button>
      </div>
      <header className="flex flex-wrap items-start gap-3">
        <div className="min-w-0 flex-1">
          <h1 className="text-xl font-semibold tracking-tight sm:text-2xl" data-testid="invoice-title">
            {inv.supplier?.name ?? (inv.supplierHeader.name || "Faktura dodavatele")}
            {inv.number ? <span className="ml-2 font-mono text-base font-normal text-muted-foreground">č. {inv.number}</span> : null}
          </h1>
          <div className="mt-1 flex flex-wrap items-center gap-1.5 text-xs">
            <span className={cn("rounded-full px-2 py-0.5 font-medium", st.tone)} data-testid="invoice-status">{st.label}</span>
            {pay && <span className={cn("rounded-full px-2 py-0.5 font-medium", pay.tone)} data-testid="invoice-payment">{pay.label}</span>}
            {inv.overdue && <span className="rounded-full bg-red-600 px-2 py-0.5 font-semibold text-white">po splatnosti</span>}
            {inv.isCreditNote && <span className="rounded-full bg-violet-100 px-2 py-0.5 font-medium text-violet-800 dark:bg-violet-500/15 dark:text-violet-300">dobropis</span>}
            {inv.isProforma && <span className="rounded-full bg-sky-100 px-2 py-0.5 font-medium text-sky-800 dark:bg-sky-500/15 dark:text-sky-300" data-testid="invoice-proforma">zálohová</span>}
            {inv.missingRate && <span className="rounded-full bg-amber-100 px-2 py-0.5 font-medium text-amber-900 dark:bg-amber-500/15 dark:text-amber-300">chybí kurz</span>}
            <span className="text-muted-foreground">{SOURCE_LABEL[inv.source]} · nahrál {inv.uploadedByName ?? "—"} · {dateText(inv.createdAt.slice(0, 10))}</span>
          </div>
        </div>
        {inv.perms.amounts && inv.totalGross !== null && (
          <div className="text-right">
            <p className="text-2xl font-semibold tabular-nums">{formatMoney(inv.totalGross, inv.currency)}</p>
            <p className="text-xs text-muted-foreground">{formatMoney(inv.totalNet, inv.currency)} bez DPH{inv.totalVat ? ` · DPH ${formatMoney(inv.totalVat, inv.currency)}` : ""}</p>
          </div>
        )}
      </header>

      {reading && (
        <p className="flex items-center gap-2 rounded-xl border border-fuchsia-200 bg-fuchsia-50 px-3 py-2 text-sm text-fuchsia-900 dark:border-fuchsia-500/30 dark:bg-fuchsia-500/10 dark:text-fuchsia-100">
          <Loader2 className="h-4 w-4 animate-spin" /> AI fakturu čte — hlavička, položky a návrh rozdělení se doplní samy.
        </p>
      )}
      {stale && (
        <div className="flex flex-wrap items-center gap-2 rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-900 dark:border-amber-500/30 dark:bg-amber-500/10 dark:text-amber-100" data-testid="invoice-read-stale">
          <AlertTriangle className="h-4 w-4 shrink-0 text-amber-500" />
          <span className="min-w-0 flex-1">AI fakturu nepřečetla (čtení se nedokončilo). Nech ji přečíst znovu, nebo ji vyplň ručně.</span>
          {inv.perms.edit && (
            <Button size="sm" variant="outline" disabled={Boolean(busy)} onClick={() => void run("ai", () => rereadRequest(inv.id), "AI fakturu přečetla znovu.")}>
              {busy === "ai" ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />} Přečíst znovu (AI)
            </Button>
          )}
        </div>
      )}
      {inv.missingRate && !inv.isProforma && inv.perms.amounts && (
        <div className="flex flex-wrap items-center gap-2 rounded-xl border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-900 dark:border-amber-500/40 dark:bg-amber-500/10 dark:text-amber-100" data-testid="invoice-missing-rate">
          <AlertTriangle className="h-4 w-4 shrink-0 text-amber-500" />
          <span className="min-w-0 flex-1">
            <strong>Chybí kurz {inv.currency} — doplň.</strong> Bez kurzu se faktura do nákladů zakázek nepočítá (náklad a provize zůstanou „neúplné“).
          </span>
          {canEdit && (
            <>
              <Button size="sm" variant="outline" disabled={Boolean(busy)} onClick={() => void run("rate", () => fillSupplierInvoiceRate(inv.id), "Kurz ČNB doplněn.")} data-testid="invoice-fill-rate">
                {busy === "rate" ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />} Načíst kurz ČNB
              </Button>
              <Button size="sm" variant="ghost" onClick={() => setEditHeader(true)}>Doplnit ručně</Button>
            </>
          )}
        </div>
      )}
      {inv.isProforma && (
        <p className="flex items-start gap-2 rounded-xl border border-sky-200 bg-sky-50 px-3 py-2 text-sm text-sky-900 dark:border-sky-500/30 dark:bg-sky-500/10 dark:text-sky-100">
          <Info className="mt-0.5 h-4 w-4 shrink-0" /> Zálohová faktura — do nákladů zakázek se nepočítá (náklad přinese až daňový doklad / vyúčtování). Rozdělovat ji není potřeba.
        </p>
      )}
      {inv.aiError && (
        <p className="flex items-start gap-2 rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-900 dark:border-amber-500/30 dark:bg-amber-500/10 dark:text-amber-100">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-amber-500" /> {inv.aiError}
        </p>
      )}
      {inv.duplicateOf && (
        <div className="rounded-xl border border-slate-300 bg-slate-50 p-3 text-sm dark:border-slate-500/40 dark:bg-slate-500/10" data-testid="invoice-duplicate">
          <p className="flex items-start gap-2 font-medium"><Copy className="mt-0.5 h-4 w-4 shrink-0" /> Duplicita — stejná faktura (dodavatel + číslo) už je nahraná {dateText(inv.duplicateOf.createdAt.slice(0, 10))}.</p>
          <div className="mt-2 flex flex-wrap gap-2">
            <Button asChild size="sm" variant="outline"><Link href={`/supplier-invoices/${inv.duplicateOf.id}`}>Otevřít původní</Link></Button>
            {inv.perms.paid && <Button size="sm" variant="destructive" disabled={Boolean(busy)} onClick={() => { if (window.confirm("Smazat duplicitní fakturu i soubor?")) void run("delete", async () => { const r = await deleteSupplierInvoice(inv.id); if (r.ok) router.push("/supplier-invoices"); return r; }, "Duplicita smazána."); }}><Trash2 className="h-4 w-4" /> Smazat duplicitu</Button>}
            {canEdit && <Button size="sm" variant="ghost" disabled={Boolean(busy)} onClick={() => void run("notdup", () => markSupplierInvoiceNotDuplicate(inv.id), "Označeno — není duplicita.")}>Není duplicita</Button>}
          </div>
        </div>
      )}
      {inv.perms.amounts && inv.needsClarification.length > 0 && (
        <ul className="space-y-1 rounded-xl border border-sky-200 bg-sky-50 p-2.5 text-xs text-sky-900 dark:border-sky-500/30 dark:bg-sky-500/10 dark:text-sky-100">
          {inv.needsClarification.map((n, i) => <li key={i} className="flex gap-1.5"><Sparkles className="mt-0.5 h-3 w-3 shrink-0" /> {n}</li>)}
        </ul>
      )}

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-[minmax(0,5fr)_minmax(0,6fr)]">
        <div className="min-w-0 lg:sticky lg:top-4 lg:self-start">
          <button type="button" onClick={() => setShowPreview((v) => !v)} className="mb-2 inline-flex min-h-9 items-center rounded-full px-2 text-xs font-medium text-muted-foreground hover:bg-accent lg:hidden">
            {showPreview ? "Skrýt fakturu" : "Ukázat fakturu"}
          </button>
          <InvoicePreview
            files={inv.files}
            emptyText={inv.perms.amounts ? "Bez souboru" : "Soubor faktury (s cenami) vidí jen ti, kdo vidí nákupní ceny."}
            className={cn(inv.perms.amounts ? "h-[42vh] lg:h-[calc(100vh-8rem)]" : "h-24", !showPreview && "hidden lg:flex")}
          />
        </div>

        <div className="min-w-0 space-y-4">
          <SupplierCard inv={inv} busy={busy} canEdit={canEdit} run={run} />
          <HeaderCard inv={inv} busy={busy} canEdit={canEdit} editing={editHeader} setEditing={setEditHeader} run={run} />
          {inv.perms.paid && <PaymentCard inv={inv} busy={busy} today={today} run={run} />}

          {inv.perms.amounts && (
            <section className="space-y-2" aria-label="Rozdělení na zakázky">
              <div className="flex flex-wrap items-center gap-2">
                <h2 className="text-base font-semibold">Rozdělení na zakázky</h2>
                <span className={cn("rounded-full px-2 py-0.5 text-xs font-medium", unallocated > 0.004 ? "bg-amber-100 text-amber-900 dark:bg-amber-500/15 dark:text-amber-300" : "bg-emerald-100 text-emerald-800 dark:bg-emerald-500/15 dark:text-emerald-300")} data-testid="invoice-unallocated">
                  {unallocated > 0.004 ? `nerozděleno ${formatMoney(unallocated, inv.currency)}` : "vše rozděleno"}
                </span>
                {canEdit && !editItems && (
                  <Button size="sm" variant="ghost" className="ml-auto h-8" onClick={() => setEditItems(true)}><PencilLine className="h-4 w-4" /> Upravit položky</Button>
                )}
              </div>
              {editItems ? (
                <ItemsEditor inv={inv} busy={busy} onCancel={() => setEditItems(false)} run={async (fn) => { const ok = await run("items", fn, "Položky uloženy."); if (ok) setEditItems(false); }} />
              ) : (
                <AllocationEditor detail={inv} rows={rows} onChange={setRows} disabled={!canEdit || Boolean(inv.duplicateOf)} />
              )}
              {inv.purchaseOrderInvoicing.length > 0 && <PoInvoicingCard inv={inv} busy={busy} canEdit={canEdit} run={run} />}
            </section>
          )}
          {!inv.perms.amounts && (
            <section className="space-y-1.5" aria-label="Položky">
              <h2 className="text-base font-semibold">Položky</h2>
              <ul className="space-y-1 text-sm">
                {inv.items.map((i) => <li key={i.id} className="rounded-lg border px-3 py-2">{i.position + 1}. {i.text}</li>)}
              </ul>
              <ul className="flex flex-wrap gap-1 text-xs">
                {inv.allocations.map((a) => <li key={a.id} className="rounded-md border px-1.5 py-0.5 font-mono">{a.job?.number ?? "režie"}</li>)}
              </ul>
            </section>
          )}

          <footer className="flex flex-wrap items-center gap-2 border-t pt-3 text-xs text-muted-foreground">
            {inv.processedAt && <span>zpracoval {inv.processedByName ?? "✨ AI"} · {dateText(inv.processedAt.slice(0, 10))}</span>}
            <span className="flex-1" />
            {canEdit && (
              <Button size="sm" variant="ghost" disabled={Boolean(busy) || inv.allocations.some((a) => a.confirmed)} title={inv.allocations.some((a) => a.confirmed) ? "Faktura má potvrzené rozdělení" : undefined}
                onClick={() => void run("ai", () => rereadRequest(inv.id), "AI fakturu přečetla znovu.")}>
                {busy === "ai" ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />} Přečíst znovu (AI)
              </Button>
            )}
            {inv.perms.edit && (
              inv.status === "zamitnuto"
                ? <Button size="sm" variant="ghost" disabled={Boolean(busy)} onClick={() => void run("rej", () => setSupplierInvoiceRejected(inv.id, false), "Faktura obnovena.")}><Undo2 className="h-4 w-4" /> Obnovit</Button>
                : <Button size="sm" variant="ghost" disabled={Boolean(busy)} onClick={() => void run("rej", () => setSupplierInvoiceRejected(inv.id, true), "Faktura zamítnuta — do nákladů se nepočítá.")}><XCircle className="h-4 w-4" /> Zamítnout</Button>
            )}
            {inv.perms.paid && (
              <Button size="sm" variant="ghost" className="text-red-600" disabled={Boolean(busy)} onClick={() => { if (window.confirm("Smazat fakturu i soubor? Rozdělení zmizí z nákladů zakázek.")) void run("delete", async () => { const r = await deleteSupplierInvoice(inv.id); if (r.ok) router.push("/supplier-invoices"); return r; }, "Faktura smazána."); }}>
                <Trash2 className="h-4 w-4" /> Smazat
              </Button>
            )}
          </footer>
        </div>
      </div>

      {inv.perms.amounts && canEdit && !editItems && (dirty || pendingAi > 0) && (
        // plovoucí lišta nad spodní navigací (mobil) i nad ladicí lištou (desktop) — nic nepřekrývá
        <div className="sticky bottom-20 z-20 rounded-xl border bg-background/95 p-3 shadow-lg backdrop-blur supports-[backdrop-filter]:bg-background/85 md:bottom-12" data-testid="invoice-savebar">
          <div className="flex flex-wrap items-center gap-2">
            {problem && dirty ? <p className="min-w-0 flex-1 text-xs font-medium text-red-700 dark:text-red-300">{problem}</p>
              : <p className="min-w-0 flex-1 text-xs text-muted-foreground">{dirty ? "Uložením rozdělení potvrdíš." : `AI navrhla ${pendingAi} ${pendingAi === 1 ? "řádek" : pendingAi < 5 ? "řádky" : "řádků"} — zkontroluj a potvrď.`}</p>}
            {dirty && <Button variant="ghost" onClick={() => setRows(saved)} disabled={Boolean(busy)}>Vrátit</Button>}
            {dirty ? (
              <Button size="lg" variant="success" disabled={Boolean(busy) || Boolean(problem)} onClick={() => void run("save", () => saveSupplierInvoiceAllocations(inv.id, draftsToInputs(rows, true)), "Rozdělení uloženo a potvrzeno.")} data-testid="invoice-save">
                {busy === "save" ? <Loader2 className="animate-spin" /> : <Save />} Uložit a potvrdit
              </Button>
            ) : (
              <Button size="lg" variant="success" disabled={Boolean(busy)} onClick={() => void run("confirm", () => confirmSupplierInvoiceAi(inv.id), "Návrhy AI potvrzeny.")} data-testid="invoice-confirm-ai">
                {busy === "confirm" ? <Loader2 className="animate-spin" /> : <CheckCheck />} Potvrdit vše, co navrhla AI
              </Button>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

type Run = (key: string, fn: () => Promise<ActionRes>, ok?: string) => Promise<boolean>;

/**
 * Objednávky dodavatelům, na které faktura jde: kolik je na ně vyfakturováno (všemi fakturami) a jestli celé.
 * Dílčí faktura náklad objednávky nesníží; „Faktura konečná" řekne, že víc faktur nepřijde (pak platí Σ faktur).
 */
function PoInvoicingCard({ inv, busy, canEdit, run }: { inv: SupplierInvoiceDetail; busy: string | null; canEdit: boolean; run: Run }) {
  // zaškrtnutí se ukáže hned (uložení doběhne na pozadí; při chybě se vrátí)
  const [optimistic, setOptimistic] = React.useState<Record<string, boolean>>({});
  const toggle = async (poId: string, final: boolean) => {
    setOptimistic((o) => ({ ...o, [poId]: final }));
    await run("final", () => setSupplierInvoiceFinalPo(inv.id, poId, final), final ? "Objednávka vyfakturovaná celá." : "Faktura už není konečná.");
    setOptimistic((o) => { const n = { ...o }; delete n[poId]; return n; });
  };
  return (
    <section className="rounded-2xl border bg-card p-3 shadow-sm" data-testid="invoice-po-invoicing">
      <h3 className="mb-1.5 text-sm font-semibold">Objednávky dodavateli</h3>
      <ul className="space-y-2">
        {inv.purchaseOrderInvoicing.map((po) => (
          <li key={po.id} className="flex flex-wrap items-center gap-x-3 gap-y-1.5 text-sm" data-testid="invoice-po-row">
            <span className="min-w-0 flex-1">
              <span className="font-mono font-semibold">{po.number ?? "—"}</span>
              {po.jobNumber ? <span className="text-muted-foreground"> · {po.jobNumber}</span> : null}
              <span className="block text-xs text-muted-foreground">
                objednáno {formatMoney(po.total)} · vyfakturováno {po.invoiced === null ? "— (chybí kurz)" : formatMoney(po.invoiced)}
                {" · "}
                <span className={po.complete ? "font-medium text-emerald-700 dark:text-emerald-300" : "font-medium text-amber-800 dark:text-amber-300"}>
                  {po.complete ? "vyfakturováno celé — do nákladu jde faktura" : "dílčí — do nákladu zatím jde objednávka"}
                </span>
              </span>
            </span>
            <label className={cn("inline-flex min-h-9 items-center gap-2 rounded-lg border px-2.5 text-xs font-medium", !canEdit && "opacity-60")}>
              <input
                type="checkbox"
                className="h-4 w-4 accent-emerald-600"
                checked={optimistic[po.id] ?? po.final}
                disabled={!canEdit || Boolean(busy)}
                onChange={(e) => void toggle(po.id, e.target.checked)}
                data-testid="invoice-po-final"
              />
              Faktura konečná
            </label>
          </li>
        ))}
      </ul>
    </section>
  );
}

function Card({ title, icon: Icon, children, actions, testId }: { title: string; icon: typeof Factory; children: React.ReactNode; actions?: React.ReactNode; testId?: string }) {
  return (
    <section className="rounded-2xl border bg-card p-3 shadow-sm sm:p-4" data-testid={testId}>
      <div className="mb-2 flex items-center gap-2">
        <Icon className="h-4 w-4 text-emerald-600" />
        <h2 className="text-sm font-semibold">{title}</h2>
        <div className="ml-auto flex items-center gap-1">{actions}</div>
      </div>
      {children}
    </section>
  );
}

function SupplierCard({ inv, busy, canEdit, run }: { inv: SupplierInvoiceDetail; busy: string | null; canEdit: boolean; run: Run }) {
  const h = inv.supplierHeader;
  return (
    <Card title="Dodavatel" icon={Factory} testId="invoice-supplier">
      {inv.supplier ? (
        <p className="text-sm">
          <Link href={`/suppliers?q=${encodeURIComponent(inv.supplier.name)}`} className="font-semibold text-emerald-700 hover:underline dark:text-emerald-300">{inv.supplier.name}</Link>
          {inv.supplier.ico ? <span className="text-muted-foreground"> · IČO {inv.supplier.ico}</span> : null}
          {" · "}<Link href={`/supplier-invoices?dodavatel=${inv.supplier.id}`} className="text-xs text-muted-foreground hover:underline">faktury dodavatele</Link>
        </p>
      ) : (
        <div className="space-y-2 text-sm">
          <p>{h.name || "Dodavatel nepřečten"}{h.ico ? <span className="text-muted-foreground"> · IČO {h.ico}</span> : null}{h.dic ? <span className="text-muted-foreground"> · DIČ {h.dic}</span> : null}</p>
          {canEdit && (
            <div className="flex flex-wrap gap-2">
              {inv.supplierMatch && (
                <Button size="sm" variant="outline" disabled={Boolean(busy)} onClick={() => void run("sup", () => updateSupplierInvoiceHeader(inv.id, { supplierId: inv.supplierMatch!.id }), "Dodavatel přiřazen.")}>
                  <CheckCircle2 className="h-4 w-4" /> Přiřadit {inv.supplierMatch.name} <span className="text-muted-foreground">({inv.supplierMatch.reason})</span>
                </Button>
              )}
              {h.name && (
                <Button size="sm" variant={inv.supplierMatch ? "ghost" : "outline"} disabled={Boolean(busy)} onClick={() => void run("sup", () => supplierFromInvoiceHeader(inv.id), "Dodavatel uložen do adresáře.")} data-testid="invoice-create-supplier">
                  <Building2 className="h-4 w-4" /> {inv.supplierMatch ? "Doplnit dodavatele z faktury" : "Založit dodavatele z faktury"}
                </Button>
              )}
            </div>
          )}
        </div>
      )}
      {(h.address || h.bankAccount || h.email || h.phone) && (
        <p className="mt-1.5 text-xs text-muted-foreground">{[h.address, h.bankAccount && `účet ${h.bankAccount}`, h.email, h.phone].filter(Boolean).join(" · ")}</p>
      )}
    </Card>
  );
}

function HeaderCard({ inv, busy, canEdit, editing, setEditing, run }: {
  inv: SupplierInvoiceDetail; busy: string | null; canEdit: boolean; editing: boolean; setEditing: (v: boolean) => void; run: Run;
}) {
  const [f, setF] = React.useState(() => headerForm(inv));
  React.useEffect(() => { if (!editing) setF(headerForm(inv)); }, [inv, editing]);
  const field = (k: Exclude<keyof typeof f, "proforma">, label: string, type = "text") => (
    <label className="space-y-1 text-xs font-medium text-muted-foreground">
      {label}
      <Input type={type} value={f[k]} onChange={(e) => setF((x) => ({ ...x, [k]: e.target.value }))} className="h-9 text-sm text-foreground" />
    </label>
  );
  return (
    <Card title="Faktura" icon={Wallet} testId="invoice-header" actions={canEdit && !editing ? <Button size="sm" variant="ghost" className="h-8" onClick={() => setEditing(true)}><PencilLine className="h-4 w-4" /> Upravit</Button> : null}>
      {editing ? (
        <form
          className="space-y-3"
          onSubmit={(e) => {
            e.preventDefault();
            void run("header", () => updateSupplierInvoiceHeader(inv.id, {
              number: f.number, variableSymbol: f.vs, issueDate: f.issue || null, taxableDate: f.taxable || null, dueDate: f.due || null,
              currency: f.currency, isProforma: f.proforma,
              ...(inv.perms.amounts ? { totalNet: f.net, totalVat: f.vat, totalGross: f.gross, exchangeRate: f.rate || null } : {}),
            }), "Uloženo.").then((ok) => { if (ok) setEditing(false); });
          }}
        >
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
            {field("number", "Číslo faktury")}
            {field("vs", "Variabilní symbol")}
            {field("currency", "Měna")}
            {field("issue", "Vystaveno", "date")}
            {field("taxable", "DUZP", "date")}
            {field("due", "Splatnost", "date")}
            {inv.perms.amounts && field("net", "Bez DPH")}
            {inv.perms.amounts && field("vat", "DPH")}
            {inv.perms.amounts && field("gross", "S DPH")}
            {inv.perms.amounts && f.currency.toUpperCase() !== "CZK" && field("rate", "Kurz (Kč za 1, prázdné = ČNB)")}
          </div>
          <label className="flex min-h-9 items-center gap-2 text-sm">
            <input type="checkbox" className="h-4 w-4 accent-sky-600" checked={f.proforma} onChange={(e) => setF((x) => ({ ...x, proforma: e.target.checked }))} data-testid="invoice-proforma-toggle" />
            Zálohová (proforma) faktura — do nákladů zakázek se nepočítá
          </label>
          <div className="flex gap-2">
            <Button type="submit" size="sm" disabled={Boolean(busy)}>{busy === "header" ? <Loader2 className="animate-spin" /> : <Save />} Uložit</Button>
            <Button type="button" size="sm" variant="ghost" onClick={() => setEditing(false)}>Zrušit</Button>
          </div>
        </form>
      ) : (
        <dl className="grid grid-cols-2 gap-x-3 gap-y-1.5 text-sm sm:grid-cols-3">
          <Item label="Číslo" value={inv.number ?? "—"} mono />
          <Item label="VS" value={inv.variableSymbol ?? "—"} mono />
          <Item label="Měna" value={inv.currency + (inv.exchangeRate ? ` · kurz ${String(inv.exchangeRate).replace(".", ",")}` : inv.missingRate ? " · bez kurzu" : "")} tone={inv.missingRate ? "text-amber-700 dark:text-amber-300 font-medium" : undefined} />
          <Item label="Vystaveno" value={dateText(inv.issueDate)} />
          <Item label="DUZP" value={dateText(inv.taxableDate)} />
          <Item label="Splatnost" value={dateText(inv.dueDate)} tone={inv.overdue ? "text-red-600 font-semibold" : undefined} />
        </dl>
      )}
    </Card>
  );
}

function headerForm(inv: SupplierInvoiceDetail) {
  return {
    number: inv.number ?? "", vs: inv.variableSymbol ?? "", currency: inv.currency, issue: inv.issueDate ?? "", taxable: inv.taxableDate ?? "",
    due: inv.dueDate ?? "", net: amountInput(inv.totalNet), vat: amountInput(inv.totalVat), gross: amountInput(inv.totalGross),
    rate: inv.exchangeRate ? String(inv.exchangeRate).replace(".", ",") : "",
    proforma: inv.isProforma,
  };
}

function Item({ label, value, mono, tone }: { label: string; value: string; mono?: boolean; tone?: string }) {
  return (
    <div className="min-w-0">
      <dt className="text-[11px] text-muted-foreground">{label}</dt>
      <dd className={cn("truncate", mono && "font-mono", tone)}>{value}</dd>
    </div>
  );
}

function PaymentCard({ inv, busy, today, run }: { inv: SupplierInvoiceDetail; busy: string | null; today: string; run: Run }) {
  const [date, setDate] = React.useState(inv.paidAt ?? today);
  const [part, setPart] = React.useState(amountInput(inv.paidAmount));
  React.useEffect(() => { setDate(inv.paidAt ?? today); setPart(amountInput(inv.paidAmount)); }, [inv.paidAt, inv.paidAmount, today]);
  const set = (status: SupplierInvoicePaymentStatus) => void run("pay", () => setSupplierInvoicePayment(inv.id, {
    status, paidAt: status === "nezaplaceno" ? null : date || today,
    paidAmount: status === "castecne" ? Number(part.replace(/\s+/g, "").replace(",", ".")) || null : null,
  }), status === "zaplaceno" ? "Označeno jako zaplacené." : status === "nezaplaceno" ? "Označeno jako nezaplacené." : "Částečná úhrada uložena.");
  const opts: { key: SupplierInvoicePaymentStatus; label: string }[] = [
    { key: "nezaplaceno", label: "Nezaplaceno" }, { key: "zaplaceno", label: "Zaplaceno" }, { key: "castecne", label: "Částečně" },
  ];
  return (
    <Card title="Úhrada (vidí jen super admin)" icon={Wallet} testId="invoice-paid-card">
      <div className="flex flex-wrap items-center gap-2">
        <div className="inline-flex rounded-xl border p-0.5" role="group" aria-label="Zaplaceno">
          {opts.map((o) => (
            <button
              key={o.key}
              type="button"
              aria-pressed={inv.paymentStatus === o.key}
              disabled={Boolean(busy)}
              onClick={() => set(o.key)}
              className={cn("rounded-lg px-3 py-2 text-sm font-medium", inv.paymentStatus === o.key ? (o.key === "zaplaceno" ? "bg-emerald-600 text-white" : o.key === "castecne" ? "bg-amber-500 text-white" : "bg-rose-600 text-white") : "text-muted-foreground hover:bg-accent")}
              data-testid={`pay-${o.key}`}
            >
              {o.label}
            </button>
          ))}
        </div>
        <label className="flex items-center gap-1.5 text-xs text-muted-foreground">
          dne <Input type="date" value={date} onChange={(e) => setDate(e.target.value)} className="h-9 w-auto text-sm text-foreground" aria-label="Datum úhrady" />
        </label>
        {inv.paymentStatus === "castecne" && (
          <label className="flex items-center gap-1.5 text-xs text-muted-foreground">
            uhrazeno <Input value={part} onChange={(e) => setPart(e.target.value)} onBlur={() => set("castecne")} className="h-9 w-28 text-right text-sm text-foreground" aria-label="Uhrazená částka" />
          </label>
        )}
      </div>
      {inv.paidByName && inv.paymentStatus !== "nezaplaceno" && <p className="mt-1.5 text-xs text-muted-foreground">označil {inv.paidByName}{inv.paidAt ? ` · ${dateText(inv.paidAt)}` : ""}</p>}
    </Card>
  );
}

interface ItemRowForm { id: string | null; text: string; code: string; quantity: string; unit: string; unitPrice: string; amount: string; vatRate: string }

function ItemsEditor({ inv, busy, onCancel, run }: { inv: SupplierInvoiceDetail; busy: string | null; onCancel: () => void; run: (fn: () => Promise<ActionRes>) => Promise<void> }) {
  const [items, setItems] = React.useState<ItemRowForm[]>(() => inv.items.map((i) => ({
    id: i.id, text: i.text, code: i.code ?? "", quantity: i.quantity !== null ? String(i.quantity).replace(".", ",") : "", unit: i.unit ?? "",
    unitPrice: amountInput(i.unitPrice), amount: amountInput(i.amount), vatRate: i.vatRate !== null ? String(i.vatRate) : "",
  })));
  const set = (n: number, p: Partial<ItemRowForm>) => setItems((x) => x.map((r, i) => (i === n ? { ...r, ...p } : r)));
  return (
    <div className="space-y-2 rounded-2xl border bg-card p-3">
      <p className="text-xs text-muted-foreground">Položky jak jsou na faktuře (částka bez DPH; sleva záporně). Smazaná položka ztratí i své rozdělení.</p>
      {items.map((r, n) => (
        <div key={r.id ?? `new-${n}`} className="grid grid-cols-6 gap-1.5 rounded-xl border p-2">
          <Input className="col-span-6 h-9 sm:col-span-3" value={r.text} onChange={(e) => set(n, { text: e.target.value })} placeholder="Text položky" aria-label="Text položky" />
          <Input className="col-span-3 h-9 sm:col-span-1" value={r.code} onChange={(e) => set(n, { code: e.target.value })} placeholder="Kód / výkres" aria-label="Kód" />
          <Input className="col-span-3 h-9 text-right sm:col-span-1" value={r.amount} onChange={(e) => set(n, { amount: e.target.value })} placeholder="Bez DPH" aria-label="Částka bez DPH" inputMode="decimal" />
          <button type="button" aria-label="Smazat položku" onClick={() => setItems((x) => x.filter((_, i) => i !== n))} className="col-span-6 inline-flex items-center justify-center rounded-md border text-red-600 hover:bg-accent sm:col-span-1"><Trash2 className="h-4 w-4" /></button>
        </div>
      ))}
      <div className="flex flex-wrap gap-2">
        <Button size="sm" variant="outline" onClick={() => setItems((x) => [...x, { id: null, text: "", code: "", quantity: "", unit: "", unitPrice: "", amount: "", vatRate: "" }])}>+ Položka</Button>
        <span className="flex-1" />
        <Button size="sm" variant="ghost" onClick={onCancel}>Zrušit</Button>
        <Button size="sm" disabled={Boolean(busy)} onClick={() => void run(() => saveSupplierInvoiceItems(inv.id, items.map((r) => ({
          id: r.id, text: r.text, code: r.code || null, quantity: r.quantity || null, unit: r.unit || null, unitPrice: r.unitPrice || null, amount: r.amount, vatRate: r.vatRate || null,
        }))))}><Save className="h-4 w-4" /> Uložit položky</Button>
      </div>
    </div>
  );
}
