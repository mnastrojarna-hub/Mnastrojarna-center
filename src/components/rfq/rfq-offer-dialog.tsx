"use client";

import * as React from "react";
import { FilePlus2, Loader2, Sparkles } from "lucide-react";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { DialogHead, ErrorBox } from "@/components/jobs/detail/confirm-dialog";
import { FULLSCREEN_DIALOG } from "@/components/jobs/purchasing/ui-bits";
import { rfqReplyPrefillAction, saveRfqOfferAction } from "@/app/actions/rfq";
import { qtyText, type RfqOffer, type RfqRecipientView, type RfqRoundView } from "@/lib/rfq/model";

/**
 * „Zapsat nabídku dodavatele" — ceny po položkách a poptaných množstvích (varianty), lhůta, platnost, číslo.
 * Odpověď dodavatele v Poště (přiřazená ke kolu) ji předvyplní (ceny u čísel výkresů, lhůta, platnost).
 */
export function RfqOfferDialog({ round, recipient, offer, onClose, onSaved }: {
  round: RfqRoundView;
  recipient: RfqRecipientView;
  offer: RfqOffer | null;
  onClose: () => void;
  onSaved: (text: string) => void;
}) {
  const key = (itemId: string, q: number) => `${itemId}|${q}`;
  const [prices, setPrices] = React.useState<Record<string, string>>(() => {
    const out: Record<string, string> = {};
    for (const it of round.items) {
      for (const q of it.quantities) {
        const l = offer?.lines.find((x) => x.orderItemId === it.orderItemId && Math.abs(x.quantity - q) < 1e-6);
        out[key(it.orderItemId, q)] = l?.unitPrice !== null && l?.unitPrice !== undefined ? String(l.unitPrice).replace(".", ",") : "";
      }
    }
    return out;
  });
  const [lead, setLead] = React.useState(offer?.leadTimeDays !== null && offer?.leadTimeDays !== undefined ? String(offer.leadTimeDays) : "");
  const [delivery, setDelivery] = React.useState(offer?.deliveryDate ?? "");
  const [valid, setValid] = React.useState(offer?.validUntil ?? "");
  const [number, setNumber] = React.useState(offer?.number ?? "");
  const [currency, setCurrency] = React.useState(offer?.currency ?? "CZK");
  const [note, setNote] = React.useState(offer?.note && !/^Poptáno |^Nabídka k poptávce /.test(offer.note) ? offer.note : "");
  const [prefilled, setPrefilled] = React.useState<string | null>(null);
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  React.useEffect(() => {
    if (offer || !recipient.replyEmailId) return;
    let live = true;
    rfqReplyPrefillAction(recipient.id).then((r) => {
      if (!live || !r.ok || !r.prefill) return;
      const p = r.prefill;
      if (p.lines.length) {
        setPrices((v) => {
          const n = { ...v };
          for (const l of p.lines) n[key(l.orderItemId, l.quantity)] = String(l.unitPrice).replace(".", ",");
          return n;
        });
      }
      if (p.leadTimeDays !== null) setLead(String(p.leadTimeDays));
      if (p.validUntil) setValid(p.validUntil);
      if (p.number) setNumber(p.number);
      if (p.found || p.leadTimeDays !== null) setPrefilled(`Předvyplněno z odpovědi${r.subject ? ` „${r.subject}“` : ""} — zkontroluj.`);
    }).catch(() => undefined);
    return () => { live = false; };
  }, [offer, recipient.id, recipient.replyEmailId]);

  async function save() {
    setError(null);
    setBusy(true);
    try {
      const lines = round.items.flatMap((it) => it.quantities.map((q) => ({ orderItemId: it.orderItemId, quantity: q, unitPrice: prices[key(it.orderItemId, q)]?.trim() || null })));
      const r = await saveRfqOfferAction(recipient.id, {
        number: number || null, leadTimeDays: lead || null, deliveryDate: delivery || null, validUntil: valid || null, currency, note: note || null, lines,
      });
      if (!r.ok) return setError(r.error);
      onSaved(`Nabídka ${recipient.supplierName} zapsána.`);
    } catch {
      setError("Spojení se nepovedlo — zkus to znovu.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent aria-describedby={undefined} className={`${FULLSCREEN_DIALOG} sm:max-w-2xl`} data-testid="rfq-offer-dialog">
        <DialogHead icon={FilePlus2} tone="bg-emerald-500/15 text-emerald-600 dark:text-emerald-400" title="Zapsat nabídku dodavatele" subtitle={`${recipient.supplierName} · poptávka ${round.number}`} />
        <div className="space-y-4 p-4 sm:p-5">
          <ErrorBox error={error} />
          {prefilled && <p className="flex items-center gap-2 rounded-lg bg-violet-500/10 px-3 py-2 text-xs text-violet-800 dark:text-violet-200" data-testid="rfq-prefilled"><Sparkles className="h-4 w-4" /> {prefilled}</p>}
          <ul className="divide-y rounded-lg border">
            {round.items.map((it) => (
              <li key={it.orderItemId} className="space-y-2 p-2.5">
                <p className="text-sm"><span className="font-mono font-semibold">{it.drawingNumber ?? it.ref}</span> <span className="text-muted-foreground">{it.ref}{it.name ? ` · ${it.name}` : ""}</span></p>
                <div className="flex flex-wrap gap-2">
                  {it.quantities.map((q) => (
                    <label key={q} className="flex items-center gap-1.5 text-xs">
                      <span className="w-16 text-right text-muted-foreground">{qtyText(q, it.unit)}</span>
                      <Input inputMode="decimal" className="h-9 w-28 text-right" placeholder="Kč/ks" aria-label={`Cena za kus ${it.drawingNumber ?? it.ref} ${q} ${it.unit}`}
                        value={prices[key(it.orderItemId, q)] ?? ""} onChange={(e) => setPrices((v) => ({ ...v, [key(it.orderItemId, q)]: e.target.value }))} />
                    </label>
                  ))}
                </div>
              </li>
            ))}
          </ul>
          <div className="grid gap-3 sm:grid-cols-3">
            <label className="space-y-1 text-sm"><span className="font-medium">Dodací lhůta (dny)</span>
              <Input inputMode="numeric" value={lead} onChange={(e) => setLead(e.target.value)} aria-label="Dodací lhůta (dny)" /></label>
            <label className="space-y-1 text-sm"><span className="font-medium">nebo termín dodání</span>
              <Input type="date" value={delivery} onChange={(e) => setDelivery(e.target.value)} aria-label="Termín dodání" /></label>
            <label className="space-y-1 text-sm"><span className="font-medium">Platnost do</span>
              <Input type="date" value={valid} onChange={(e) => setValid(e.target.value)} aria-label="Platnost do" /></label>
            <label className="space-y-1 text-sm"><span className="font-medium">Číslo nabídky</span>
              <Input value={number} onChange={(e) => setNumber(e.target.value)} aria-label="Číslo nabídky" /></label>
            <label className="space-y-1 text-sm"><span className="font-medium">Měna</span>
              <select value={currency} onChange={(e) => setCurrency(e.target.value)} aria-label="Měna" className="h-9 w-full rounded-md border bg-background px-2 text-sm">
                <option value="CZK">CZK</option><option value="EUR">EUR</option>
              </select></label>
          </div>
          <label className="block space-y-1 text-sm"><span className="font-medium">Poznámka</span>
            <Textarea rows={2} value={note} onChange={(e) => setNote(e.target.value)} aria-label="Poznámka k nabídce" /></label>
        </div>
        <div className="sticky bottom-0 flex flex-col-reverse gap-2 border-t bg-background/95 px-4 py-3 sm:flex-row sm:justify-end sm:px-5">
          <Button variant="ghost" onClick={onClose}>Zrušit</Button>
          <Button variant="success" onClick={save} disabled={busy} className="h-11 sm:h-9" data-testid="rfq-offer-save">
            {busy && <Loader2 className="h-4 w-4 animate-spin" />} Uložit nabídku
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
