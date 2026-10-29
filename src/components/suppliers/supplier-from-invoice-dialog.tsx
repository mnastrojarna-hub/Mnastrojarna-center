"use client";

import * as React from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Building2, CheckCircle2, ExternalLink, ReceiptText } from "lucide-react";
import { Dialog, DialogContent, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { InvoiceUploader } from "@/components/supplier-invoices/invoice-uploader";

/**
 * Dodavatelé → „Přiložit fakturu": AI přečte hlavičku faktury a založí (nebo doplní) dodavatele —
 * IČO, DIČ, adresa, účet, e-mail, telefon (dedupe podle IČO). Faktura se výchozím stavem uloží i do Faktur
 * dodavatelů (odškrtnutím jen dodavatel).
 */
export function SupplierFromInvoiceDialog({ className }: { className?: string }) {
  const router = useRouter();
  const [open, setOpen] = React.useState(false);
  // výchozí ANO: kdo dialogem odevzdává fakturu (i bez práva faktury vidět), nesmí ji tiše ztratit
  const [withInvoice, setWithInvoice] = React.useState(true);
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant="outline" className={className} data-testid="supplier-from-invoice">
          <ReceiptText className="h-4 w-4" /> Přiložit fakturu
        </Button>
      </DialogTrigger>
      <DialogContent className="top-[4%] max-h-[90vh] w-[calc(100%-1.5rem)] max-w-xl space-y-3 overflow-y-auto p-4 sm:top-[8%] sm:p-5">
        <DialogTitle>Dodavatel z faktury</DialogTitle>
        <p className="text-sm text-muted-foreground">
          Vyfoť nebo nahraj fakturu od dodavatele — AI z hlavičky založí dodavatele (nebo doplní chybějící údaje u existujícího podle IČO).
        </p>
        <label className="flex items-start gap-2 rounded-xl border p-2.5 text-sm">
          <input type="checkbox" checked={withInvoice} onChange={(e) => setWithInvoice(e.target.checked)} className="mt-0.5 h-4 w-4" data-testid="supplier-from-invoice-with-invoice" />
          <span>Uložit i fakturu do Faktur dodavatelů <span className="block text-xs text-muted-foreground">(odškrtni, když jde jen o dodavatele — soubor se pak nikam neuloží)</span></span>
        </label>
        <InvoiceUploader
          endpoint="/api/suppliers/from-invoice"
          body={{ createInvoice: withInvoice }}
          submitLabel="Přečíst dodavatele"
          onDone={() => router.refresh()}
          renderDone={(res, reset) => {
            const s = (res.supplier ?? {}) as { id?: string; name?: string; created?: boolean; filled?: string[] };
            const inv = (res.invoice ?? null) as { message?: string; id?: string } | null;
            return (
              <div className="space-y-3 rounded-2xl border border-emerald-200 bg-emerald-50 p-4 dark:border-emerald-500/30 dark:bg-emerald-500/10" data-testid="supplier-from-invoice-done">
                <p className="flex items-start gap-2 font-semibold">
                  <CheckCircle2 className="mt-0.5 h-5 w-5 shrink-0 text-emerald-600" />
                  {s.created ? <>Založen nový dodavatel {s.name}</> : <>Dodavatel {s.name} už v adresáři je{s.filled?.length ? " — doplněno" : " — nic nechybělo"}</>}
                </p>
                {s.filled && s.filled.length > 0 && <p className="text-sm text-muted-foreground">{s.created ? "Vyplněno" : "Doplněno"}: {s.filled.join(", ")}</p>}
                {inv?.message && <p className="text-sm">{inv.message}</p>}
                <div className="flex flex-wrap gap-2">
                  {s.name && <Button asChild size="sm"><Link href={`/suppliers?q=${encodeURIComponent(s.name)}`} onClick={() => setOpen(false)}><Building2 /> Ukázat dodavatele</Link></Button>}
                  {inv?.id && <Button asChild size="sm" variant="outline"><Link href={`/supplier-invoices/${inv.id}`}><ExternalLink /> Otevřít fakturu</Link></Button>}
                  <Button size="sm" variant="ghost" onClick={reset}>Další faktura</Button>
                </div>
              </div>
            );
          }}
        />
      </DialogContent>
    </Dialog>
  );
}
