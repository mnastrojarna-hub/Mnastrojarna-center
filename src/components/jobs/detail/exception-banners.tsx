"use client";

import * as React from "react";
import Link from "next/link";
import { AlertTriangle, Check, FileDiff, Factory, Loader2, Send, ShoppingCart } from "lucide-react";
import { Button } from "@/components/ui/button";
import { ComposeDialog, type ComposeRequest } from "@/components/mail/compose-dialog";
import { acknowledgeDrawingChanges, markPurchaseOrdersDrawingChanged } from "@/app/actions/flow-exceptions";
import { awaitingPoDays, claimOpen, czPlural, relativeStampTime, type FlowActionKey } from "@/lib/jobs/flow-status";
import { CLAIM_REASONS, CLAIM_RESOLUTIONS, exceptionFlags, isClaimReason, isClaimResolution } from "@/lib/jobs/flow-exceptions";
import { ExceptionFlagChip } from "@/components/flow-status/exception-flag-chip";
import type { DrawingChangeView, JobDetail } from "@/lib/jobs/types";
import { cn } from "@/lib/utils";
import { useJobDetail } from "./detail-context";
import { useFlowActions } from "./flow-actions";
import { useSettledRefresh } from "@/components/jobs/use-settled-refresh";

/**
 * Výjimky v toku na kartě zakázky (majitel 31. 10.): VÝRAZNÝ banner „Nová revize výkresu" (čeho se týká
 * + „Beru na vědomí"), reklamace, výroba bez objednávky zákazníka; ostatní výjimky jako štítky.
 */

function who(c: DrawingChangeView): string {
  const when = relativeStampTime(c.createdAt);
  const by = c.createdBy?.name ?? (c.via === "email" ? "z e-mailu" : c.via === "foto" ? "z fotky" : "automaticky");
  return [when, by].filter(Boolean).join(", ");
}

export function ExceptionBanners({ job }: { job: JobDetail }) {
  const flow = useFlowActions();
  const { notify, perms } = useJobDetail();
  const settle = useSettledRefresh();
  const [busy, setBusy] = React.useState<string | null>(null);
  const [compose, setCompose] = React.useState<ComposeRequest | null>(null);
  const facts = flow?.facts ?? null;
  if (!facts) return null;
  const run = (k: FlowActionKey) => flow?.run(k);
  const open = (job.drawingChanges ?? []).filter((c) => !c.acknowledgedAt);
  const flags = exceptionFlags(facts).filter((f) => f.key !== "vykres" && f.key !== "reklamace" && f.key !== "bez_po" && f.key !== "chybi_po");
  const quote = flow?.snapshot?.quote ?? null;
  const quoteSent = quote === "odeslana" || quote === "pripominky" || quote === "vyprsela";
  const quoteDraft = quote === "rozpracovana" || quote === "ke_schvaleni" || quote === "schvalena";
  const poDays = awaitingPoDays(facts);
  const claim = claimOpen(facts) || job.stage === "reklamace";

  async function ack(id: string) {
    setBusy(`ack:${id}`);
    const res = await acknowledgeDrawingChanges(job.id, { changeId: id }).catch(() => ({ ok: false, error: "Spojení se nepovedlo." }));
    setBusy(null);
    if (!res.ok) return notify("error", res.error ?? "Nepovedlo se.");
    notify("success", "Nová revize vzata na vědomí.");
    settle();
  }

  async function sendToSupplier(c: DrawingChangeView, po: NonNullable<JobDetail["drawingAffects"]>["purchaseOrders"][number]) {
    setBusy(`po:${po.id}`);
    const note = `Nová revize výkresu ${c.drawingNumber ?? ""} ${c.revTo ?? ""}`.replace(/\s+/g, " ").trim();
    const res = await markPurchaseOrdersDrawingChanged(job.id, { purchaseOrderIds: [po.id], note }).catch(() => ({ ok: false, error: "Spojení se nepovedlo." }));
    setBusy(null);
    if (!res.ok) return notify("error", res.error ?? "Nepovedlo se.");
    const file = c.fileId ? job.files.find((f) => f.id === c.fileId) : null;
    setCompose({
      mode: "new", jobId: job.id, to: po.supplierEmail ? [po.supplierEmail] : [],
      subject: `Změna výkresu ${c.drawingNumber ?? ""} — rev. ${c.revTo ?? ""} k objednávce ${po.number}`.replace(/\s+/g, " "),
      body: `Dobrý den,\n\nk naší objednávce ${po.number} posíláme novou revizi výkresu ${c.drawingNumber ?? ""} (rev. ${c.revFrom ?? "—"} → ${c.revTo ?? "—"}). Prosíme, vyrábějte podle nové revize a potvrďte, zda se mění cena nebo termín.\n`,
      jobAttachments: file ? [{ id: file.id, filename: file.filename }] : [],
    });
    settle();
  }

  return (
    <div className="space-y-2" data-testid="exception-banners">
      {open.map((c) => {
        const pos = (job.drawingAffects?.purchaseOrders ?? []).filter((p) => !c.itemId || !p.itemIds.length || p.itemIds.includes(c.itemId));
        return (
          <section
            key={c.id}
            role="alert"
            data-testid="drawing-change-banner"
            className="space-y-2 rounded-xl border-2 border-rose-400 bg-rose-50 p-3 text-sm text-rose-950 shadow-sm dark:border-rose-500/60 dark:bg-rose-500/10 dark:text-rose-100"
          >
            <div className="flex flex-wrap items-start justify-between gap-2">
              <p className="flex min-w-0 items-start gap-2 font-semibold">
                <FileDiff className="mt-0.5 h-5 w-5 shrink-0 text-rose-600 dark:text-rose-300" aria-hidden />
                <span>
                  Nová revize výkresu <span className="font-mono">{c.drawingNumber ?? "—"}</span>: {c.revFrom ?? "—"} → {c.revTo ?? "—"}
                  <span className="font-normal text-rose-800/80 dark:text-rose-200/80"> ({who(c)})</span>
                </span>
              </p>
              <Button type="button" size="sm" variant="outline" className="min-h-11 border-rose-300 bg-white sm:min-h-8 dark:bg-transparent" disabled={busy !== null} onClick={() => ack(c.id)}>
                {busy === `ack:${c.id}` ? <Loader2 className="animate-spin" /> : <Check />} Beru na vědomí
              </Button>
            </div>
            {c.note && <p className="text-xs">{c.note}</p>}
            <ul className="space-y-1.5 text-xs" aria-label="Čeho se nová revize týká">
              {quoteSent && (
                <li className="flex flex-wrap items-center gap-2">
                  <span>• Zákazníkovi už odešla nabídka podle staré revize.</span>
                  {perms.margins || flow?.ctx.can("workflow") ? (
                    <Button type="button" size="sm" variant="outline" className="h-8 bg-white dark:bg-transparent" onClick={() => run("quote.newRevision")}>Přecenit — nová verze nabídky</Button>
                  ) : null}
                </li>
              )}
              {quoteDraft && (
                <li className="flex flex-wrap items-center gap-2">
                  <span>• Rozpracovaná nabídka — zkontroluj cenu podle nové revize.</span>
                  <Button type="button" size="sm" variant="outline" className="h-8 bg-white dark:bg-transparent" onClick={() => run("quote.edit")}>Upravit nabídku</Button>
                </li>
              )}
              {pos.map((po) => (
                <li key={po.id} className="flex flex-wrap items-center gap-2" data-testid="drawing-change-po">
                  <span>• Objednávka {po.number}{po.supplier ? ` — ${po.supplier}` : ""} {po.status === "odeslana" || po.status === "potvrzena" ? "už odešla" : "je vystavená"} se starou revizí{po.drawingChangedAt ? " (změna výkresu označena)" : ""}.</span>
                  <Button type="button" size="sm" variant="outline" className="h-8 bg-white dark:bg-transparent" disabled={busy !== null} onClick={() => sendToSupplier(c, po)}>
                    {busy === `po:${po.id}` ? <Loader2 className="animate-spin" /> : <Send />} Poslat dodavateli novou revizi
                  </Button>
                </li>
              ))}
              {(job.drawingAffects?.pendingSupplierQuotes ?? 0) > 0 && (
                <li>• Poptávky u dodavatelů ({job.drawingAffects!.pendingSupplierQuotes}) čekají na cenu podle staré revize — <Link className="underline" href={`/orders/${job.id}?tab=nakup`}>Nákup</Link>.</li>
              )}
              {job.stage === "ve_vyrobe" && (
                <li className="flex items-center gap-1.5"><Factory className="h-3.5 w-3.5" aria-hidden /> Díly jsou ve výrobě podle staré revize — dej vědět dílně / dodavateli.</li>
              )}
              {!quoteSent && !quoteDraft && !pos.length && job.stage !== "ve_vyrobe" && !(job.drawingAffects?.pendingSupplierQuotes ?? 0) && (
                <li>• Nabídka ani objednávky u dodavatelů se zatím nemusí měnit.</li>
              )}
            </ul>
          </section>
        );
      })}

      {claim && (
        <section data-testid="claim-banner" className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-pink-300 bg-pink-50 p-3 text-sm text-pink-950 dark:border-pink-500/40 dark:bg-pink-500/10 dark:text-pink-100">
          <p className="flex min-w-0 items-start gap-2">
            <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
            <span>
              <strong>Reklamace</strong>
              {facts.claimReason && isClaimReason(facts.claimReason) ? ` — ${CLAIM_REASONS[facts.claimReason]}` : ""}
              {facts.claimQty ? ` · ${facts.claimQty} ks` : ""}
              {facts.claimNote ? `: ${facts.claimNote}` : ""}
              {facts.claimResolution && isClaimResolution(facts.claimResolution) ? ` · řešení: ${CLAIM_RESOLUTIONS[facts.claimResolution].label}` : ""}
            </span>
          </p>
        </section>
      )}

      {poDays !== null && (
        <section data-testid="awaiting-po-banner" className={cn(
          "flex flex-wrap items-center justify-between gap-2 rounded-xl border p-3 text-sm",
          poDays >= 7 ? "border-rose-300 bg-rose-50 text-rose-950 dark:border-rose-500/40 dark:bg-rose-500/10 dark:text-rose-100"
            : "border-amber-300 bg-amber-50 text-amber-950 dark:border-amber-500/40 dark:bg-amber-500/10 dark:text-amber-100",
        )}>
          <p className="flex min-w-0 items-start gap-2">
            <ShoppingCart className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
            <span>
              <strong>{poDays >= 7 ? "Chybí objednávka zákazníka" : "Vyrábí se bez objednávky zákazníka"}</strong>
              {` — čeká ${poDays} ${czPlural(poDays, "den", "dny", "dní")}`}
              {facts.awaitingPoNote ? ` (${facts.awaitingPoNote})` : ""}. Potvrzení pošleš, až objednávka dorazí.
            </span>
          </p>
          {flow?.ctx.can("workflow") && (
            <Button type="button" size="sm" variant="outline" className="min-h-11 bg-white sm:min-h-8 dark:bg-transparent" onClick={() => run("order.poArrived")}>
              Objednávka dorazila…
            </Button>
          )}
        </section>
      )}

      {flags.length > 0 && (
        <div className="flex flex-wrap gap-1.5" data-testid="exception-flags">
          {flags.map((f) => <ExceptionFlagChip key={f.key} flag={f} />)}
        </div>
      )}

      <ComposeDialog
        request={compose}
        onClose={() => setCompose(null)}
        onSent={(r) => {
          setCompose(null);
          notify(r.sentCopy === "failed" ? "error" : "success", `Nová revize odeslána dodavateli${r.fromAddress ? ` z ${r.fromAddress}` : ""}.`);
          settle();
        }}
      />
    </div>
  );
}
