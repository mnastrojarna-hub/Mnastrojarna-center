"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import {
  Award, BellRing, CheckCircle2, ChevronDown, Clock, FileText, Hourglass, Loader2, Mail, MailCheck, RotateCw, Send, Sparkles,
  ThumbsDown, Trophy, Zap,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import { DialogHead, ErrorBox } from "@/components/jobs/detail/confirm-dialog";
import { useNotify } from "@/components/jobs/detail/toast";
import {
  declineRfqAction, remindRfqAction, retryRfqAction, selectRfqAction, sendWithoutDrawingsRfqAction, thankRfqAction,
} from "@/app/actions/rfq";
import type { JobRfqData } from "@/lib/rfq/store";
import {
  RECIPIENT_STATUS, canRemind, compareRfq, czDay, needsReminder, qtyText, rfqSummary, whatText,
  type CompareCell, type Comparison, type RfqRecipientView, type RfqRoundView,
} from "@/lib/rfq/model";
import { cn } from "@/lib/utils";
import { useRfq } from "./rfq-context";
import { RfqOfferDialog } from "./rfq-offer-dialog";

/**
 * Poptávky dodavatelům v kartě zakázky (Nákup & marže, u zaměstnance se „Smí poptávat" samostatně): kola, stav
 * u každého dodavatele (odesláno → odpověděl / nabídka / odmítl / bez odpovědi), Urgovat, Zapsat nabídku,
 * porovnání po položkách s „Doporučujeme" (cena / termín / kvalita) a Vybrat → nákupní cena pro Nacenění.
 */

const TONE: Record<string, string> = {
  grey: "bg-muted text-muted-foreground",
  amber: "bg-amber-500/15 text-amber-800 dark:text-amber-300",
  sky: "bg-sky-500/15 text-sky-800 dark:text-sky-300",
  green: "bg-emerald-500/15 text-emerald-800 dark:text-emerald-300",
  red: "bg-red-500/15 text-red-700 dark:text-red-300",
  violet: "bg-violet-500/15 text-violet-800 dark:text-violet-300",
};

function money(n: number | null, cur = "CZK"): string {
  if (n === null) return "—";
  return new Intl.NumberFormat("cs-CZ", { style: "currency", currency: cur, maximumFractionDigits: 2 }).format(n);
}

export function RfqSection({ data, jobId }: { data: JobRfqData | null; jobId: string }) {
  const rfq = useRfq();
  const rounds = data?.rounds ?? [];
  return (
    <section className="space-y-3" data-testid="rfq-section">
      <div className="flex flex-wrap items-center gap-2">
        <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-orange-100 text-orange-700 dark:bg-orange-500/15 dark:text-orange-300"><Send className="h-4 w-4" /></span>
        <div className="min-w-0 flex-1">
          <h3 className="font-semibold">Poptávky dodavatelům {rounds.length ? <span className="text-muted-foreground">({rounds.length})</span> : null}</h3>
          <p className="text-xs text-muted-foreground">Anonymně, každý dodavatel zvlášť — porovnání nabídek a doporučený dodavatel.</p>
        </div>
        {rfq?.canRfq && (
          <Button size="sm" variant={rounds.length ? "outline" : "send"} onClick={() => rfq.open()} data-testid="rfq-open">
            <Send className="h-4 w-4" /> {rounds.length ? "Poptat znovu" : "Poptat dodavatele"}
          </Button>
        )}
      </div>
      {!rounds.length ? (
        <p className="rounded-xl border border-dashed px-4 py-5 text-center text-sm text-muted-foreground">
          Zatím jsme nepoptávali. „Poptat dodavatele“ pošle 2–5 dodavatelům naši poptávku s anonymizovanými výkresy — každému zvlášť.
        </p>
      ) : (
        rounds.map((r, i) => <RoundCard key={r.id} round={r} data={data as JobRfqData} jobId={jobId} defaultOpen={i === 0} />)
      )}
    </section>
  );
}

function RoundCard({ round, data, jobId, defaultOpen }: { round: RfqRoundView; data: JobRfqData; jobId: string; defaultOpen: boolean }) {
  const router = useRouter();
  const notify = useNotify();
  const [open, setOpen] = React.useState(defaultOpen);
  const [busy, setBusy] = React.useState<string | null>(null);
  const [offerFor, setOfferFor] = React.useState<RfqRecipientView | null>(null);
  const [override, setOverride] = React.useState<{ orderItemId: string | null; recipientId: string; supplier: string } | null>(null);
  const sum = rfqSummary(round);
  const cmp: Comparison = React.useMemo(() => compareRfq(
    round, new Map(data.quality.map((q) => [q.supplierId, q])), data.weights, new Map(data.ratings.map((r) => [r.supplierId, r])),
  ), [round, data]);

  async function run(key: string, fn: () => Promise<{ ok: boolean; error?: string }>, ok: string) {
    setBusy(key);
    try {
      const r = await fn();
      if (!r.ok) notify("error", r.error ?? "Akce se nepovedla.");
      else {
        notify("success", ok);
        router.refresh();
      }
    } catch {
      notify("error", "Spojení se nepovedlo — zkus to znovu.");
    } finally {
      setBusy(null);
    }
  }

  function choose(orderItemId: string | null, recipientId: string) {
    const rec = round.recipients.find((x) => x.id === recipientId);
    const recommended = orderItemId ? cmp.rows.find((r) => r.item.orderItemId === orderItemId)?.recommended?.recipientId : cmp.overall?.recipientId ?? cmp.rows[0]?.recommended?.recipientId;
    if (recommended && recommended !== recipientId) {
      setOverride({ orderItemId, recipientId, supplier: rec?.supplierName ?? "" });
      return;
    }
    void run(`sel:${orderItemId ?? "all"}:${recipientId}`, () => selectRfqAction(round.id, { orderItemId, recipientId }), `Vybrán ${rec?.supplierName ?? "dodavatel"} — cena je v Nacenění.`);
  }

  const winners = new Set(round.selections.map((s) => s.recipientId));
  const canThank = winners.size > 0 && round.recipients.some((x) => !winners.has(x.id) && !x.thankedAt && (x.status === "nabidka" || x.status === "odpovedel"));

  return (
    <article className="overflow-hidden rounded-xl border bg-card shadow-sm" data-testid="rfq-round" data-number={round.number}>
      <button type="button" onClick={() => setOpen((v) => !v)} className="flex w-full items-center gap-2 px-3 py-2.5 text-left hover:bg-accent/40" aria-expanded={open}>
        <span className="font-mono text-sm font-bold">{round.number}</span>
        <span className="truncate text-sm text-muted-foreground">{whatText(round.scope, round.operationKinds)} · {round.items.length} pol.</span>
        <span className="ml-auto shrink-0 rounded-full bg-orange-500/15 px-2 py-0.5 text-xs font-semibold text-orange-800 dark:text-orange-300" data-testid="rfq-summary">{sum.text}</span>
        {round.status === "vybrano" && <Trophy className="h-4 w-4 shrink-0 text-emerald-600" aria-label="Vybráno" />}
        <ChevronDown className={cn("h-4 w-4 shrink-0 transition-transform", open && "rotate-180")} />
      </button>
      {open && (
        <div className="space-y-3 border-t px-3 py-3">
          <p className="flex flex-wrap gap-x-3 gap-y-1 text-xs text-muted-foreground">
            {round.requiredDate && <span>Termín dodání {czDay(round.requiredDate)}</span>}
            {round.replyBy && <span>Odpověď do {czDay(round.replyBy)}</span>}
            <span>Poslal(a) {round.createdBy ?? "—"} · {czDay(round.createdAt.slice(0, 10))}</span>
            {round.fileId && <a href={`/api/jobs/files/${round.fileId}`} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 font-medium text-sky-700 hover:underline dark:text-sky-400"><FileText className="h-3.5 w-3.5" /> PDF poptávky</a>}
          </p>

          <ul className="space-y-2" data-testid="rfq-recipients">
            {round.recipients.map((x) => {
              const st = RECIPIENT_STATUS[x.status];
              const remind = needsReminder(x, round.replyBy, data.today);
              return (
                <li key={x.id} className="rounded-lg border p-2.5" data-testid="rfq-recipient" data-supplier={x.supplierName} data-status={x.status}>
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="font-semibold">{x.supplierName}</span>
                    <span className={cn("rounded-full px-2 py-0.5 text-[11px] font-semibold", TONE[st.tone])}>{st.label}</span>
                    {x.thankedAt && <span className="text-[11px] text-muted-foreground">poděkováno</span>}
                    <span className="w-full truncate text-xs text-muted-foreground sm:w-auto">{x.emails.join(", ")}{x.sentAt ? ` · ${czDay(x.sentAt.slice(0, 10))}` : ""}{x.reminderCount ? ` · urgováno ${x.reminderCount}×` : ""}</span>
                  </div>
                  {x.error && <p className="mt-1 text-xs text-red-700 dark:text-red-300">{x.error}</p>}
                  {x.replySubject && <p className="mt-1 flex items-center gap-1 text-xs text-violet-700 dark:text-violet-300"><MailCheck className="h-3.5 w-3.5" /> Odpověď: „{x.replySubject}“ <a href={`/orders/${jobId}?tab=komunikace`} className="underline">Komunikace</a></p>}
                  <div className="mt-2 flex flex-wrap gap-1.5">
                    {x.status !== "odmitl" && x.status !== "zruseno" && x.status !== "chyba" && x.status !== "ceka_na_anonymizaci" && (
                      <Button size="sm" variant={x.status === "odpovedel" ? "success" : "outline"} onClick={() => setOfferFor(x)} data-testid="rfq-offer">
                        <FileText className="h-3.5 w-3.5" /> {x.status === "nabidka" ? "Upravit nabídku" : "Zapsat nabídku"}
                      </Button>
                    )}
                    {canRemind(x) && (
                      <Button size="sm" variant={remind ? "default" : "ghost"} className={cn(remind && "bg-amber-500 text-amber-950 hover:bg-amber-500/90")} disabled={busy !== null}
                        onClick={() => run(`rem:${x.id}`, () => remindRfqAction(x.id), `Urgence odeslána — ${x.supplierName}.`)} data-testid="rfq-remind">
                        {busy === `rem:${x.id}` ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <BellRing className="h-3.5 w-3.5" />} Urgovat
                      </Button>
                    )}
                    {x.status === "ceka_na_anonymizaci" && (
                      <Button size="sm" variant="outline" disabled={busy !== null} onClick={() => run(`skip:${x.id}`, () => sendWithoutDrawingsRfqAction(x.id), `Odesláno ${x.supplierName} bez čekajících výkresů.`)}>
                        <Hourglass className="h-3.5 w-3.5" /> Poslat hned bez čekajících výkresů
                      </Button>
                    )}
                    {x.status === "chyba" && (
                      <Button size="sm" variant="outline" disabled={busy !== null} onClick={() => run(`retry:${x.id}`, () => retryRfqAction(x.id), `Odesláno — ${x.supplierName}.`)}>
                        <RotateCw className="h-3.5 w-3.5" /> Zkusit odeslat znovu
                      </Button>
                    )}
                    {["odeslano", "odpovedel", "bez_odpovedi"].includes(x.status) && (
                      <Button size="sm" variant="ghost" disabled={busy !== null} onClick={() => run(`dec:${x.id}`, () => declineRfqAction(x.id), `${x.supplierName}: nenabídne.`)}>
                        <ThumbsDown className="h-3.5 w-3.5" /> Nenabídne
                      </Button>
                    )}
                  </div>
                </li>
              );
            })}
          </ul>

          {round.offers.length > 0 && <CompareTable round={round} cmp={cmp} busy={busy} onChoose={choose} />}
          {canThank && (
            <Button size="sm" variant="outline" disabled={busy !== null} onClick={() => run("thank", () => thankRfqAction(round.id), "Poděkování odesláno nevybraným dodavatelům.")} data-testid="rfq-thank">
              <Mail className="h-3.5 w-3.5" /> Poděkovat ostatním „tentokrát ne“
            </Button>
          )}
        </div>
      )}
      {offerFor && (
        <RfqOfferDialog
          round={round} recipient={offerFor} offer={round.offers.find((o) => o.recipientId === offerFor.id) ?? null}
          onClose={() => setOfferFor(null)}
          onSaved={(t) => { setOfferFor(null); notify("success", t); router.refresh(); }}
        />
      )}
      {override && (
        <OverrideDialog
          supplier={override.supplier}
          onClose={() => setOverride(null)}
          onConfirm={async (reason) => {
            const r = await selectRfqAction(round.id, { orderItemId: override.orderItemId, recipientId: override.recipientId, reason });
            if (!r.ok) return r.error;
            setOverride(null);
            notify("success", `Vybrán ${override.supplier} (místo doporučeného) — cena je v Nacenění.`);
            router.refresh();
            return null;
          }}
        />
      )}
    </article>
  );
}

function CellView({ c }: { c: CompareCell }) {
  return (
    <div className="space-y-0.5">
      <p className={cn("font-semibold tabular-nums", c.cheapest && "text-emerald-700 dark:text-emerald-400")}>
        {money(c.unitPrice, c.currency)}<span className="text-xs font-normal text-muted-foreground">/ks</span>
        {c.cheapest && <span className="ml-1 rounded bg-emerald-500/15 px-1 text-[10px] font-semibold text-emerald-700 dark:text-emerald-300">nejlevnější</span>}
      </p>
      <p className="text-xs text-muted-foreground tabular-nums">celkem {money(c.total, c.currency)} · {qtyText(c.quantity)}</p>
      <p className="flex items-center gap-1 text-xs">
        <Clock className="h-3 w-3" />
        {c.deliveryDate ? czDay(c.deliveryDate) : c.leadTimeDays !== null ? `${c.leadTimeDays} dní` : "termín neuveden"}
        {c.fastest && <span className="inline-flex items-center gap-0.5 rounded bg-sky-500/15 px-1 text-[10px] font-semibold text-sky-700 dark:text-sky-300"><Zap className="h-2.5 w-2.5" /> nejrychlejší</span>}
        {c.bufferDays !== null && c.bufferDays < 0 && <span className="rounded bg-red-500/15 px-1 text-[10px] font-semibold text-red-700 dark:text-red-300">po termínu</span>}
      </p>
      {c.variants.length > 0 && <p className="text-[11px] text-muted-foreground">{c.variants.map((v) => `${qtyText(v.quantity)}: ${money(v.unitPrice, c.currency)}`).join(" · ")}</p>}
      {c.validUntil && <p className="text-[11px] text-muted-foreground">platí do {czDay(c.validUntil)}</p>}
      {c.note && !/^(Poptáno |Nabídka k poptávce )/.test(c.note) && <p className="line-clamp-2 text-[11px] text-muted-foreground">{c.note}</p>}
      <p className="text-[11px] text-muted-foreground">{c.quality.noHistory ? "bez historie" : `kvalita ${String(c.quality.stars).replace(".", ",")}/5`}</p>
    </div>
  );
}

function CompareTable({ round, cmp, busy, onChoose }: { round: RfqRoundView; cmp: Comparison; busy: string | null; onChoose: (orderItemId: string | null, recipientId: string) => void }) {
  const name = (id: string) => round.recipients.find((r) => r.id === id)?.supplierName ?? "";
  return (
    <div className="space-y-3" data-testid="rfq-compare">
      <h4 className="flex items-center gap-1.5 text-sm font-semibold"><Award className="h-4 w-4 text-orange-600" /> Porovnání nabídek</h4>
      {cmp.overall && round.items.length > 1 && (
        <div className="flex flex-col gap-2 rounded-lg border border-violet-300 bg-violet-50 px-3 py-2 sm:flex-row sm:items-center dark:border-violet-500/30 dark:bg-violet-500/10" data-testid="rfq-recommend-all">
          <p className="min-w-0 flex-1 text-sm"><Sparkles className="mr-1 inline h-4 w-4 text-violet-600" /><strong>Doporučujeme celou poptávku: {cmp.overall.supplierName}</strong> — {cmp.overall.reason}</p>
          {cmp.selectedAll?.recipientId === cmp.overall.recipientId ? <span className="text-xs font-semibold text-emerald-700"><CheckCircle2 className="mr-1 inline h-4 w-4" />Vybráno</span> : (
            <Button size="sm" variant="success" disabled={busy !== null} onClick={() => onChoose(null, cmp.overall!.recipientId)} data-testid="rfq-choose-all">Vybrat {cmp.overall.supplierName} pro vše</Button>
          )}
        </div>
      )}
      {cmp.rows.map((row) => (
        <div key={row.item.orderItemId} className="rounded-lg border" data-testid="rfq-compare-row" data-drawing={row.item.drawingNumber ?? ""}>
          <div className="border-b bg-muted/40 px-3 py-2">
            <p className="text-sm"><span className="font-mono font-semibold">{row.item.drawingNumber ?? row.item.ref}</span> <span className="text-muted-foreground">{row.item.ref} · {qtyText(row.item.customerQty, row.item.unit)}</span></p>
            {row.recommended && (
              <p className="mt-0.5 text-sm" data-testid="rfq-recommend"><Sparkles className="mr-1 inline h-3.5 w-3.5 text-violet-600" /><strong>Doporučujeme: {name(row.recommended.recipientId)}</strong> <span className="text-muted-foreground">— {row.recommended.reason}</span></p>
            )}
            {row.selected && (
              <p className="mt-0.5 text-xs text-emerald-700 dark:text-emerald-400"><CheckCircle2 className="mr-1 inline h-3.5 w-3.5" />Vybráno: {name(row.selected.recipientId)}{row.selected.selectedBy ? ` (${row.selected.selectedBy})` : ""}{row.selected.overridden && row.selected.overrideReason ? ` — místo doporučeného: ${row.selected.overrideReason}` : ""}</p>
            )}
          </div>
          {/* mobil: karty pod sebou; desktop: sloupce dodavatelů */}
          <div className="grid gap-px bg-border sm:grid-cols-[repeat(auto-fit,minmax(180px,1fr))]">
            {row.cells.map((c) => {
              const rec = row.recommended?.recipientId === c.recipientId;
              const sel = row.selected?.recipientId === c.recipientId;
              return (
                <div key={c.recipientId} className={cn("space-y-2 bg-card p-3", rec && "ring-2 ring-inset ring-violet-400", sel && "bg-emerald-50 dark:bg-emerald-500/10")} data-testid="rfq-cell" data-supplier={c.supplierName}>
                  <p className="text-sm font-semibold">{c.supplierName}{rec && <Sparkles className="ml-1 inline h-3.5 w-3.5 text-violet-600" aria-label="Doporučeno" />}</p>
                  <CellView c={c} />
                  {sel ? <p className="text-xs font-semibold text-emerald-700 dark:text-emerald-400">Vybráno</p> : c.unitPrice !== null && (
                    <Button size="sm" variant={rec ? "success" : "outline"} className="w-full" disabled={busy !== null} onClick={() => onChoose(row.item.orderItemId, c.recipientId)} data-testid="rfq-choose">
                      Vybrat
                    </Button>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      ))}
    </div>
  );
}

function OverrideDialog({ supplier, onClose, onConfirm }: { supplier: string; onClose: () => void; onConfirm: (reason: string) => Promise<string | null> }) {
  const [reason, setReason] = React.useState("");
  const [error, setError] = React.useState<string | null>(null);
  const [busy, setBusy] = React.useState(false);
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent aria-describedby={undefined} className="w-[calc(100%-1.5rem)] sm:max-w-md" data-testid="rfq-override">
        <DialogHead icon={Award} tone="bg-amber-500/15 text-amber-600" title={`Vybrat ${supplier}?`} subtitle="Doporučený je jiný dodavatel — napiš krátce proč (uloží se ke kolu)." />
        <div className="space-y-3 p-5">
          <ErrorBox error={error} />
          <Textarea rows={2} value={reason} onChange={(e) => setReason(e.target.value)} placeholder="např. lepší zkušenost s kalením, jistější termín" aria-label="Proč jiný dodavatel" />
          <div className="flex justify-end gap-2">
            <Button variant="ghost" onClick={onClose}>Zpět</Button>
            <Button variant="success" disabled={busy || !reason.trim()} onClick={async () => {
              setBusy(true);
              setError(await onConfirm(reason.trim()));
              setBusy(false);
            }}>{busy && <Loader2 className="h-4 w-4 animate-spin" />} Vybrat</Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
