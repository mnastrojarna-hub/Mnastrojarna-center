"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import {
  AlertTriangle, ArrowLeft, ArrowRight, CheckCircle2, Clock, FileText, Hourglass, Loader2, Mail, Search, Send, ShieldCheck, Sparkles, Star,
} from "lucide-react";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { DialogHead, ErrorBox } from "@/components/jobs/detail/confirm-dialog";
import { FULLSCREEN_DIALOG } from "@/components/jobs/purchasing/ui-bits";
import { previewRfqAction, rfqSetupAction, sendRfqAction } from "@/app/actions/rfq";
import type { RfqPreview, RfqSetup } from "@/lib/rfq/store";
import {
  RFQ_MAX_SUPPLIERS, czDay, parseQuantities, rankRfqSuppliers, whatText, type RankedSupplier, type RfqScope,
} from "@/lib/rfq/model";
import { OPERATION_KINDS, type OperationKind } from "@/lib/jobs/operations";
import { cn } from "@/lib/utils";
import type { RfqOpenOptions } from "./rfq-context";

/**
 * „Poptat dodavatele" — poptávkové kolo na pár ťuknutí (desktop i mobil):
 *  1. Co: položky (výchozí všechny), množství zákazníka + varianty, celý díl / jen operace, termín, „odpověď do", poznámka.
 *  2. Komu: doporučení dodavatelé (technologie, materiál, historie, kvalita, lhůta) předvybraní, hledání, e-mail pro poptávky.
 *  3. Náhled: e-mail každému zvlášť (tykání / vykání, podpis), PDF + anonymizované výkresy, pojistka anonymizace → Odeslat.
 */

const COMMON_KINDS: OperationKind[] = ["tepelne_zpracovani", "povrchova_uprava", "brouseni", "dratove_rezani", "elektroeroze", "frezovani", "soustruzeni", "svarovani"];

type Step = 1 | 2 | 3;

interface ItemState { checked: boolean; qty: string; variants: string }

export function RfqDialog({ jobId, opts, onClose }: { jobId: string; opts: RfqOpenOptions; onClose: () => void }) {
  const router = useRouter();
  const [setup, setSetup] = React.useState<RfqSetup | null>(null);
  const [error, setError] = React.useState<string | null>(null);
  const [step, setStep] = React.useState<Step>(1);
  const [items, setItems] = React.useState<Record<string, ItemState>>({});
  const [scope, setScope] = React.useState<RfqScope>(opts.kinds?.length ? "operace" : "dil");
  const [kinds, setKinds] = React.useState<OperationKind[]>(opts.kinds ?? []);
  const [requiredDate, setRequiredDate] = React.useState("");
  const [replyBy, setReplyBy] = React.useState("");
  const [note, setNote] = React.useState("");
  const [picked, setPicked] = React.useState<Record<string, string>>({});
  const [search, setSearch] = React.useState("");
  const [preview, setPreview] = React.useState<RfqPreview | null>(null);
  const [skipPending, setSkipPending] = React.useState(false);
  const [busy, setBusy] = React.useState(false);
  const [done, setDone] = React.useState<string | null>(null);

  React.useEffect(() => {
    let live = true;
    rfqSetupAction(jobId).then((r) => {
      if (!live) return;
      if (!r.ok) return setError(r.error);
      const s = r.setup;
      setSetup(s);
      const only = opts.itemIds?.length ? new Set(opts.itemIds) : null;
      setItems(Object.fromEntries(s.items.map((i) => [i.id, { checked: only ? only.has(i.id) : true, qty: String(i.quantity).replace(".", ","), variants: "" }])));
      setRequiredDate(s.defaults.requiredDate);
      setReplyBy(s.defaults.replyBy);
    }).catch(() => live && setError("Spojení se nepovedlo — zkus to znovu."));
    return () => { live = false; };
  }, [jobId, opts.itemIds]);

  const chosen = React.useMemo(() => (setup?.items ?? []).filter((i) => items[i.id]?.checked), [setup, items]);
  const ranked: RankedSupplier[] = React.useMemo(() => {
    if (!setup) return [];
    return rankRfqSuppliers({
      suppliers: setup.suppliers, scope, kinds, materials: chosen.map((i) => i.material), drawingNumbers: chosen.map((i) => i.drawingNumber),
      history: setup.history, quality: new Map(setup.quality.map((q) => [q.supplierId, q])),
    });
  }, [setup, scope, kinds, chosen]);

  // doporučení předvybere 3 dodavatele (jednou, při prvním vstupu do kroku 2)
  const seeded = React.useRef(false);
  function goSuppliers() {
    setError(null);
    if (!chosen.length) return setError("Vyber aspoň jednu položku.");
    if (scope === "operace" && !kinds.length) return setError("Vyber, kterou operaci poptáváš.");
    if (!seeded.current) {
      seeded.current = true;
      setPicked(Object.fromEntries(ranked.filter((r) => r.recommended).map((r) => [r.supplier.id, r.supplier.email ?? ""])));
    }
    setStep(2);
  }

  function input() {
    return {
      jobId, scope, operationKinds: kinds,
      items: chosen.map((i) => {
        const base = Number((items[i.id]?.qty ?? "").replace(",", ".")) || i.quantity;
        return { orderItemId: i.id, quantities: parseQuantities(items[i.id]?.variants ?? "", base) };
      }),
      requiredDate: requiredDate || null, replyBy: replyBy || null, note: note.trim() || null,
      recipients: Object.entries(picked).map(([supplierId, emails]) => ({ supplierId, emails: emails.split(/[,;\s]+/).filter(Boolean) })),
      skipPending,
    };
  }

  async function goPreview() {
    setError(null);
    const n = Object.keys(picked).length;
    if (!n) return setError("Vyber aspoň jednoho dodavatele.");
    if (n > RFQ_MAX_SUPPLIERS) return setError(`Najednou nejvýš ${RFQ_MAX_SUPPLIERS} dodavatelů.`);
    setBusy(true);
    try {
      const r = await previewRfqAction(input());
      if (!r.ok) return setError(r.error);
      setPreview(r.preview);
      setStep(3);
    } catch {
      setError("Spojení se nepovedlo — zkus to znovu.");
    } finally {
      setBusy(false);
    }
  }

  async function send() {
    setError(null);
    setBusy(true);
    try {
      const r = await sendRfqAction(input());
      if (!r.ok) return setError(r.error);
      const x = r.result;
      const parts = [`Poptávka ${x.number} odeslána ${x.sent} ${x.sent === 1 ? "dodavateli" : "dodavatelům"} (každému zvlášť).`];
      if (x.waiting) parts.push(`${x.waiting} čeká na anonymizaci výkresů — odejde samo.`);
      if (x.failed.length) parts.push(`Neodešlo: ${x.failed.map((f) => `${f.supplier} (${f.error})`).join("; ")} — je v Poště → K odeslání.`);
      setDone(parts.join(" "));
      router.refresh();
    } catch {
      setError("Spojení se nepovedlo — zkus to znovu.");
    } finally {
      setBusy(false);
    }
  }

  const stepKinds = React.useMemo(() => {
    const fromSteps = (setup?.steps ?? []).map((s) => s.kind).filter((k) => k !== "vyroba" && k !== "kompletni_dodavka");
    return [...new Set([...fromSteps, ...COMMON_KINDS])];
  }, [setup]);
  const filtered = ranked.filter((r) => !search.trim() || r.supplier.name.toLowerCase().includes(search.trim().toLowerCase())
    || r.supplier.technologies.join(" ").toLowerCase().includes(search.trim().toLowerCase()));
  const shown = search.trim() ? filtered : filtered.filter((r, i) => i < 8 || picked[r.supplier.id] !== undefined);
  const pickedCount = Object.keys(picked).length;

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent aria-describedby={undefined} className={`${FULLSCREEN_DIALOG} sm:max-w-3xl`} data-testid="rfq-dialog">
        <DialogHead
          icon={Send}
          tone="bg-orange-500/15 text-orange-600 dark:text-orange-400"
          title="Poptat dodavatele"
          subtitle={setup ? `${setup.job.number} · anonymně — dodavatel neuvidí zákazníka ani jeho čísla` : "Načítám…"}
        />
        <ol className="flex gap-1 border-b px-5 py-2 text-xs font-medium" aria-label="Kroky">
          {(["Co poptat", "Komu", "Náhled a odeslání"] as const).map((t, i) => (
            <li key={t} className={cn("flex items-center gap-1 rounded-full px-2.5 py-1", step === i + 1 ? "bg-orange-500/15 text-orange-700 dark:text-orange-300" : "text-muted-foreground")}>
              <span className="tabular-nums">{i + 1}.</span> {t}
            </li>
          ))}
        </ol>
        <div className="space-y-4 p-4 sm:p-5">
          <ErrorBox error={error} />
          {!setup && !error && <p className="flex items-center gap-2 text-sm text-muted-foreground"><Loader2 className="h-4 w-4 animate-spin" /> Načítám položky a dodavatele…</p>}

          {done ? (
            <div className="space-y-3" data-testid="rfq-done">
              <p className="flex items-start gap-2 rounded-lg border border-emerald-300 bg-emerald-50 px-3 py-2 text-sm text-emerald-800 dark:border-emerald-500/30 dark:bg-emerald-500/10 dark:text-emerald-200">
                <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0" /> {done}
              </p>
              <Button onClick={onClose} className="w-full sm:w-auto">Hotovo</Button>
            </div>
          ) : setup && step === 1 ? (
            <div className="space-y-4">
              <fieldset className="space-y-2">
                <legend className="text-sm font-medium">Co poptáváš</legend>
                <div className="flex flex-wrap gap-2">
                  <Chip on={scope === "dil"} onClick={() => setScope("dil")}>Celý díl (výrobu)</Chip>
                  <Chip on={scope === "operace"} onClick={() => setScope("operace")}>Jen operaci…</Chip>
                </div>
                {scope === "operace" && (
                  <div className="flex flex-wrap gap-1.5" data-testid="rfq-kinds">
                    {stepKinds.map((k) => (
                      <Chip key={k} small on={kinds.includes(k)} onClick={() => setKinds((v) => (v.includes(k) ? v.filter((x) => x !== k) : [...v, k]))}>
                        {OPERATION_KINDS[k].label}
                      </Chip>
                    ))}
                  </div>
                )}
              </fieldset>

              <fieldset className="space-y-2">
                <legend className="text-sm font-medium">Položky a množství <span className="font-normal text-muted-foreground">(varianty např. „50, 100“)</span></legend>
                <ul className="divide-y rounded-lg border" data-testid="rfq-items">
                  {setup.items.map((it) => {
                    const st = items[it.id];
                    return (
                      <li key={it.id} className="flex flex-col gap-2 p-2.5 sm:flex-row sm:items-center">
                        <label className="flex min-w-0 flex-1 items-start gap-2">
                          <input
                            type="checkbox" className="mt-1 h-4 w-4 accent-orange-600" checked={Boolean(st?.checked)}
                            onChange={(e) => setItems((v) => ({ ...v, [it.id]: { ...v[it.id], checked: e.target.checked } }))}
                            aria-label={`Poptat ${it.drawingNumber ?? it.name ?? "položku"}`}
                          />
                          <span className="min-w-0">
                            <span className="block truncate font-mono text-sm font-semibold">{it.drawingNumber ?? "bez výkresu"}{it.revision ? <span className="font-sans text-xs font-normal text-muted-foreground"> rev. {it.revision}</span> : null}</span>
                            <span className="block truncate text-xs text-muted-foreground">{[it.name, it.material].filter(Boolean).join(" · ")}</span>
                          </span>
                        </label>
                        {st?.checked && (
                          <div className="flex gap-2 pl-6 sm:pl-0">
                            <Input aria-label={`Množství ${it.drawingNumber ?? ""}`} inputMode="decimal" value={st.qty} className="h-9 w-20 text-right"
                              onChange={(e) => setItems((v) => ({ ...v, [it.id]: { ...v[it.id], qty: e.target.value } }))} />
                            <span className="self-center text-xs text-muted-foreground">{it.unit}</span>
                            <Input aria-label={`Varianty množství ${it.drawingNumber ?? ""}`} placeholder="varianty" value={st.variants} className="h-9 w-28"
                              onChange={(e) => setItems((v) => ({ ...v, [it.id]: { ...v[it.id], variants: e.target.value } }))} />
                          </div>
                        )}
                      </li>
                    );
                  })}
                </ul>
              </fieldset>

              <div className="grid gap-3 sm:grid-cols-2">
                <label className="space-y-1 text-sm">
                  <span className="font-medium">Požadovaný termín dodání</span>
                  <Input type="date" value={requiredDate} onChange={(e) => setRequiredDate(e.target.value)} aria-label="Požadovaný termín dodání" />
                  <span className="block text-xs text-muted-foreground">
                    {setup.job.customerDate ? `Zákazník chce ${czDay(setup.job.customerDate)} — rezerva 5 pracovních dní.` : "Zákazník termín neuvedl — za 3 týdny."}
                  </span>
                </label>
                <label className="space-y-1 text-sm">
                  <span className="font-medium">Odpověď do</span>
                  <Input type="date" value={replyBy} onChange={(e) => setReplyBy(e.target.value)} aria-label="Odpověď do" />
                  <span className="block text-xs text-muted-foreground">Den předem připomeneme „Urgovat“.</span>
                </label>
              </div>
              <label className="block space-y-1 text-sm">
                <span className="font-medium">Poznámka pro dodavatele <span className="font-normal text-muted-foreground">(nepovinné)</span></span>
                <Textarea rows={2} value={note} onChange={(e) => setNote(e.target.value)} placeholder="např. materiál dodáme my, atest 3.1" aria-label="Poznámka pro dodavatele" />
              </label>
              <p className="flex items-start gap-2 rounded-lg bg-muted/50 px-3 py-2 text-xs text-muted-foreground">
                <ShieldCheck className="mt-0.5 h-4 w-4 shrink-0 text-emerald-600" />
                Dodavatel dostane jen naši poptávku ({whatText(scope, kinds)}), naše čísla položek a anonymizované výkresy — žádné jméno zákazníka,
                jeho čísla ani původní názvy souborů.
              </p>
            </div>
          ) : setup && step === 2 ? (
            <div className="space-y-3">
              <div className="flex items-center gap-2">
                <div className="relative flex-1">
                  <Search className="pointer-events-none absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
                  <Input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Hledat dodavatele nebo technologii" className="pl-8" aria-label="Hledat dodavatele" />
                </div>
                <span className={cn("shrink-0 rounded-full px-2.5 py-1 text-xs font-semibold", pickedCount >= 2 && pickedCount <= 5 ? "bg-emerald-500/15 text-emerald-700 dark:text-emerald-300" : "bg-amber-500/15 text-amber-700 dark:text-amber-300")} data-testid="rfq-picked-count">
                  Vybráno {pickedCount}
                </span>
              </div>
              <p className="text-xs text-muted-foreground">Doporučujeme 2–5 dodavatelů. Pořadí: technologie, materiál, historie (stejný výkres, cena), kvalita a dodací lhůta.</p>
              <ul className="space-y-2" data-testid="rfq-suppliers">
                {shown.map((r) => {
                  const on = picked[r.supplier.id] !== undefined;
                  return (
                    <li key={r.supplier.id} className={cn("rounded-lg border p-2.5", on && "border-orange-400 bg-orange-50/60 dark:border-orange-500/50 dark:bg-orange-500/10")} data-testid="rfq-supplier" data-supplier={r.supplier.name}>
                      <label className="flex items-start gap-2">
                        <input
                          type="checkbox" className="mt-1 h-4 w-4 accent-orange-600" checked={on} aria-label={`Poptat ${r.supplier.name}`}
                          onChange={(e) => setPicked((v) => {
                            const n = { ...v };
                            if (e.target.checked) n[r.supplier.id] = r.supplier.email ?? "";
                            else delete n[r.supplier.id];
                            return n;
                          })}
                        />
                        <span className="min-w-0 flex-1">
                          <span className="flex flex-wrap items-center gap-x-2 gap-y-0.5">
                            <span className="font-semibold">{r.supplier.name}</span>
                            {r.recommended && <span className="inline-flex items-center gap-0.5 rounded-full bg-violet-500/15 px-1.5 py-0.5 text-[10.5px] font-semibold text-violet-700 dark:text-violet-300"><Sparkles className="h-3 w-3" /> Doporučeno</span>}
                            <span className={cn("inline-flex items-center gap-0.5 text-[11px]", r.quality.noHistory ? "text-muted-foreground" : "text-amber-700 dark:text-amber-300")}>
                              <Star className="h-3 w-3" /> {r.quality.noHistory ? "bez historie" : `${String(r.quality.stars).replace(".", ",")}/5`}
                            </span>
                          </span>
                          <span className="block text-xs text-muted-foreground">{r.reasons.join(" · ") || (r.supplier.technologies.join(", ") || "technologie neuvedené")}</span>
                        </span>
                      </label>
                      {on && (
                        <div className="mt-2 flex items-center gap-2 pl-6">
                          <Mail className="h-4 w-4 shrink-0 text-muted-foreground" />
                          <Input
                            type="email" value={picked[r.supplier.id]} placeholder="e-mail pro poptávky" className="h-9"
                            aria-label={`E-mail ${r.supplier.name}`}
                            onChange={(e) => setPicked((v) => ({ ...v, [r.supplier.id]: e.target.value }))}
                            list={`rfq-mails-${r.supplier.id}`}
                          />
                          {r.supplier.email && <datalist id={`rfq-mails-${r.supplier.id}`}><option value={r.supplier.email} /></datalist>}
                        </div>
                      )}
                    </li>
                  );
                })}
              </ul>
              {!shown.length && <p className="text-sm text-muted-foreground">Nic nenalezeno — dodavatele přidáš v adresáři Dodavatelé.</p>}
            </div>
          ) : setup && step === 3 && preview ? (
            <div className="space-y-3" data-testid="rfq-preview">
              {preview.leaks.length > 0 && (
                <p className="flex items-start gap-2 rounded-lg border border-red-300 bg-red-50 px-3 py-2 text-sm text-red-800 dark:border-red-500/30 dark:bg-red-500/10 dark:text-red-200">
                  <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" /> Text obsahuje údaj zákazníka ({preview.leaks.join(", ")}) — uprav poznámku, jinak se neodešle.
                </p>
              )}
              {preview.redacted.length > 0 && (
                <p className="flex items-start gap-2 rounded-lg bg-muted/50 px-3 py-2 text-xs text-muted-foreground">
                  <ShieldCheck className="mt-0.5 h-4 w-4 shrink-0 text-emerald-600" /> Z popisu položek / poznámky jsme odstranili údaje zákazníka ({preview.redacted.length}).
                </p>
              )}
              {preview.pending > 0 && (
                <div className="space-y-1.5 rounded-lg border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-900 dark:border-amber-500/30 dark:bg-amber-500/10 dark:text-amber-200" data-testid="rfq-pending">
                  <p className="flex items-center gap-2 font-medium"><Hourglass className="h-4 w-4" /> {preview.pending} {preview.pending === 1 ? "výkres čeká" : "výkresy čekají"} na anonymizaci</p>
                  <label className="flex items-center gap-2"><input type="radio" name="rfq-pending" checked={!skipPending} onChange={() => setSkipPending(false)} /> Počkat a odeslat samo, až budou hotové (doporučeno)</label>
                  <label className="flex items-center gap-2"><input type="radio" name="rfq-pending" checked={skipPending} onChange={() => setSkipPending(true)} /> Odeslat hned bez nich</label>
                </div>
              )}
              {preview.mails.map((m) => (
                <article key={m.supplierId} className="space-y-1.5 rounded-lg border p-3" data-testid="rfq-preview-mail">
                  <header className="text-sm">
                    <p className="font-semibold">{m.supplierName}</p>
                    <p className="break-all text-xs text-muted-foreground">Komu: {m.to.join(", ")} · samostatný e-mail</p>
                    <p className="text-xs">Předmět: <span className="font-medium">{m.subject}</span></p>
                  </header>
                  <pre className="max-h-40 overflow-y-auto whitespace-pre-wrap break-words rounded bg-muted/40 p-2 font-sans text-xs leading-relaxed">{m.body}</pre>
                  <div className="flex flex-wrap gap-1.5">
                    {m.attachments.map((a) => (
                      <span key={a.name} title={a.message ?? undefined} className={cn("inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[11px]",
                        a.status === "ready" ? "border-emerald-300 text-emerald-800 dark:text-emerald-300" : a.status === "pending" ? "border-amber-300 text-amber-800 dark:text-amber-300" : "border-red-300 text-red-700 line-through dark:text-red-300")}>
                        {a.status === "pending" ? <Clock className="h-3 w-3" /> : <FileText className="h-3 w-3" />}
                        {a.name}{a.status === "pending" ? " · čeká na anonymizaci" : a.status === "blocked" ? " · nelze poslat" : ""}
                      </span>
                    ))}
                  </div>
                </article>
              ))}
            </div>
          ) : null}
        </div>

        {setup && !done && (
          <div className="sticky bottom-0 flex flex-col-reverse gap-2 border-t bg-background/95 px-4 py-3 backdrop-blur sm:flex-row sm:justify-between sm:px-5">
            {step > 1 ? (
              <Button variant="ghost" onClick={() => setStep((s) => (s - 1) as Step)} disabled={busy}><ArrowLeft className="h-4 w-4" /> Zpět</Button>
            ) : <Button variant="ghost" onClick={onClose}>Zrušit</Button>}
            {step === 1 && <Button onClick={goSuppliers} className="h-11 sm:h-9" data-testid="rfq-next">Vybrat dodavatele <ArrowRight className="h-4 w-4" /></Button>}
            {step === 2 && (
              <Button onClick={goPreview} disabled={busy || !pickedCount} className="h-11 sm:h-9" data-testid="rfq-preview-btn">
                {busy && <Loader2 className="h-4 w-4 animate-spin" />} Náhled ({pickedCount}) <ArrowRight className="h-4 w-4" />
              </Button>
            )}
            {step === 3 && (
              <Button variant="send" onClick={send} disabled={busy || Boolean(preview?.leaks.length)} className="h-11 sm:h-9" data-testid="rfq-send">
                {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
                Odeslat {pickedCount} {pickedCount === 1 ? "dodavateli" : "dodavatelům"}
              </Button>
            )}
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}

function Chip({ on, onClick, children, small }: { on: boolean; onClick: () => void; children: React.ReactNode; small?: boolean }) {
  return (
    <button
      type="button" onClick={onClick} aria-pressed={on}
      className={cn("rounded-full border font-medium transition", small ? "px-2.5 py-1 text-xs" : "px-3 py-1.5 text-sm",
        on ? "border-orange-500 bg-orange-500/15 text-orange-800 dark:text-orange-200" : "hover:bg-accent")}
    >
      {children}
    </button>
  );
}
