"use client";

import * as React from "react";
import { Ban, Loader2, PauseCircle } from "lucide-react";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { DialogHead, ErrorBox } from "@/components/jobs/detail/confirm-dialog";
import { notifySuppliers } from "@/app/actions/purchasing";
import type { PurchaseOrderStatus } from "@/lib/supabase/database.types";

export interface NoticePurchaseOrder {
  id: string;
  number: string;
  status: PurchaseOrderStatus;
  supplierName: string;
}

const OPEN: PurchaseOrderStatus[] = ["vystavena", "odeslana", "potvrzena"];

/**
 * Zakázka zrušená / pozastavená s otevřenými objednávkami (E.6): obchodník / admin jedním dialogem
 * stornuje nebo pozastaví objednávky u dodavatelů. Odeslané dostanou e-mail hned (ze schránky obchodníka
 * zakázky), neodeslané se jen zruší; když e-mail neodejde, čeká ve frontě ke schválení.
 */
export function SupplierNoticeDialog({
  open, onOpenChange, jobId, kind, purchaseOrders, onDone,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  jobId: string;
  kind: "cancel" | "hold";
  purchaseOrders: NoticePurchaseOrder[];
  onDone?: (message: string) => void;
}) {
  const list = purchaseOrders.filter((p) => OPEN.includes(p.status));
  const [picked, setPicked] = React.useState<string[]>(() => list.map((p) => p.id));
  const [reason, setReason] = React.useState("");
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const cancel = kind === "cancel";

  async function submit() {
    setBusy(true);
    setError(null);
    try {
      const r = await notifySuppliers(jobId, { kind, purchaseOrderIds: picked, reason: reason.trim() || undefined });
      if (!r.ok) { setError(r.error ?? "Nepodařilo se."); return; }
      const parts = [
        r.sent?.length ? `odesláno ${r.sent.length}` : null,
        r.cancelled?.length ? `zrušeno ${r.cancelled.length}` : null,
        r.queued?.length ? `čeká ve frontě ${r.queued.length}` : null,
      ].filter(Boolean);
      if (r.errors?.length) { setError(r.errors.join(" · ")); return; }
      onDone?.(`${cancel ? "Storno" : "Pozastavení"} u dodavatelů: ${parts.join(", ") || "hotovo"}.`);
      onOpenChange(false);
    } catch {
      setError("Spojení se nepovedlo — zkus to znovu.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={(o) => !busy && onOpenChange(o)}>
      <DialogContent aria-describedby={undefined} className="w-[calc(100%-1.5rem)] sm:max-w-lg">
        <DialogHead
          icon={cancel ? Ban : PauseCircle}
          tone={cancel ? "bg-red-100 text-red-700 dark:bg-red-500/15 dark:text-red-300" : "bg-amber-100 text-amber-800 dark:bg-amber-500/15 dark:text-amber-300"}
          title={cancel ? "Stornovat u dodavatelů" : "Pozastavit u dodavatelů"}
          subtitle={`${list.length} ${list.length === 1 ? "otevřená objednávka" : list.length < 5 ? "otevřené objednávky" : "otevřených objednávek"} u dodavatelů`}
        />
        <div className="space-y-3 p-5">
          {!list.length && <p className="text-sm text-muted-foreground">Zakázka nemá otevřené objednávky u dodavatelů.</p>}
          <ul className="space-y-1.5">
            {list.map((p) => {
              const sent = p.status === "odeslana" || p.status === "potvrzena";
              return (
                <li key={p.id}>
                  <label className="flex min-h-11 cursor-pointer items-start gap-2 rounded-lg border px-3 py-2 text-sm hover:bg-accent">
                    <input type="checkbox" className="mt-0.5 h-4 w-4 accent-red-600" checked={picked.includes(p.id)}
                      onChange={(e) => setPicked((cur) => (e.target.checked ? [...cur, p.id] : cur.filter((x) => x !== p.id)))} />
                    <span className="min-w-0">
                      <span className="block font-medium">{p.number} · {p.supplierName}</span>
                      <span className="block text-xs text-muted-foreground">
                        {sent
                          ? `Dodavatel dostane e-mail: „${cancel ? "Storno" : "Pozastavení"} objednávky ${p.number}"`
                          : cancel ? "Dodavateli ještě neodešla — jen se zruší." : "Dodavateli ještě neodešla — pozastaví se bez e-mailu."}
                      </span>
                    </span>
                  </label>
                </li>
              );
            })}
          </ul>
          <div>
            <label htmlFor="notice-reason" className="mb-1 block text-xs font-medium text-muted-foreground">Důvod (do e-mailu a historie)</label>
            <Textarea id="notice-reason" rows={2} value={reason} onChange={(e) => setReason(e.target.value)} className="text-base sm:text-sm"
              placeholder={cancel ? "Zákazník zakázku zrušil" : "Zakázka je pozastavená"} />
          </div>
          <ErrorBox error={error} />
          <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
            <Button type="button" variant="ghost" onClick={() => onOpenChange(false)} disabled={busy}>Zpět</Button>
            <Button type="button" variant="send" onClick={() => void submit()} disabled={busy || !picked.length} className="h-11 sm:h-9">
              {busy && <Loader2 className="animate-spin" />} Odeslat dodavatelům
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
