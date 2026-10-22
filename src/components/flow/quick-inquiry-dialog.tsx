"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { Loader2, MessageSquareQuote, Plus } from "lucide-react";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import { Button, type ButtonProps } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { DialogHead, ErrorBox } from "@/components/jobs/detail/confirm-dialog";
import { createJob } from "@/app/actions/jobs";
import { FlowCombo, type ComboItem } from "./flow-combo";
import { parseAmount } from "./flow-utils";

interface Form {
  customerText: string;
  customerId: string | null;
  title: string;
  drawingNumber: string;
  quantity: string;
  requiredDate: string;
  inquiryNumber: string;
  note: string;
}

const EMPTY: Form = {
  customerText: "", customerId: null, title: "", drawingNumber: "", quantity: "1",
  requiredDate: "", inquiryNumber: "", note: "",
};

/**
 * Rychlé založení poptávky (zákazník, co poptává, kusy, termín) — bez dlouhého
 * formuláře. Vše ostatní jde doplnit v kartě zakázky, kam se po uložení přejde.
 */
export function QuickInquiryDialog({
  customers,
  label = "Nová poptávka",
  variant = "outline",
  className,
}: {
  customers: { id: string; name: string; customerNumber: string | null; ico: string | null }[];
  label?: string;
  variant?: ButtonProps["variant"];
  className?: string;
}) {
  const router = useRouter();
  const [open, setOpen] = React.useState(false);
  const [form, setForm] = React.useState<Form>(EMPTY);
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  const items: ComboItem[] = React.useMemo(
    () => customers.map((c) => ({
      id: c.id,
      label: c.name,
      sub: [c.customerNumber ? `č. ${c.customerNumber}` : null, c.ico ? `IČO ${c.ico}` : null].filter(Boolean).join(" · ") || null,
    })),
    [customers],
  );

  function set<K extends keyof Form>(k: K, v: Form[K]) {
    setForm((f) => ({ ...f, [k]: v }));
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (busy) return;
    const title = form.title.trim();
    if (!title) return setError("Napiš, co zákazník poptává (např. „Hřídel VK-2291, C45“).");
    const qty = parseAmount(form.quantity);
    if (!qty.ok || qty.value === null || qty.value <= 0) return setError("Počet kusů musí být kladné číslo.");
    setBusy(true);
    setError(null);
    try {
      const res = await createJob({
        stage: "poptavka",
        title,
        ...(form.customerId ? { customerId: form.customerId } : form.customerText.trim() ? { customerName: form.customerText.trim() } : {}),
        customerRequiredDate: form.requiredDate || undefined,
        customerInquiryNumber: form.inquiryNumber.trim() || undefined,
        note: form.note.trim() || undefined,
        items: [{ name: title, drawingNumber: form.drawingNumber.trim() || undefined, quantity: qty.value, unit: "ks" }],
      });
      if (!res.ok || !res.id) {
        setError(res.error ?? "Poptávku se nepodařilo založit.");
        return;
      }
      setOpen(false);
      setForm(EMPTY);
      router.push(`/orders/${res.id}`);
    } catch {
      setError("Spojení se nepovedlo — zkus to znovu.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <Button type="button" variant={variant} className={className} onClick={() => setOpen(true)}>
        <Plus className="h-4 w-4" /> {label}
      </Button>
      <Dialog open={open} onOpenChange={(o) => !busy && (setOpen(o), setError(null))}>
        <DialogContent aria-describedby={undefined} className="top-[4%] max-h-[92vh] w-[calc(100%-1rem)] overflow-y-auto sm:top-[8%] sm:max-w-lg">
          <DialogHead
            icon={MessageSquareQuote}
            tone="bg-sky-100 text-sky-700 dark:bg-sky-500/15 dark:text-sky-300"
            title="Nová poptávka"
            subtitle="Stačí zákazník a co poptává. Zbytek doplníš v kartě zakázky."
          />
          <form onSubmit={submit} className="space-y-4 p-4 sm:p-5" noValidate>
            <ErrorBox error={error} />
            <label className="block space-y-1">
              <span className="text-xs font-medium text-muted-foreground">Zákazník</span>
              <FlowCombo
                items={items}
                text={form.customerText}
                selectedId={form.customerId}
                onChange={(text, id) => setForm((f) => ({ ...f, customerText: text, customerId: id }))}
                placeholder="Hledej firmu nebo napiš novou…"
                allowFree
                autoFocus
              />
            </label>
            <label className="block space-y-1">
              <span className="text-xs font-medium text-muted-foreground">Co poptává *</span>
              <Input value={form.title} onChange={(e) => set("title", e.target.value)} placeholder="Hřídel VK-2291, C45, broušená" className="h-10" />
            </label>
            <div className="grid grid-cols-2 gap-3">
              <label className="block space-y-1">
                <span className="text-xs font-medium text-muted-foreground">Číslo výkresu</span>
                <Input value={form.drawingNumber} onChange={(e) => set("drawingNumber", e.target.value)} placeholder="VK-2291" className="h-10 font-mono" />
              </label>
              <label className="block space-y-1">
                <span className="text-xs font-medium text-muted-foreground">Kusů</span>
                <Input inputMode="decimal" value={form.quantity} onChange={(e) => set("quantity", e.target.value)} className="h-10" />
              </label>
              <label className="block space-y-1">
                <span className="text-xs font-medium text-muted-foreground">Požadovaný termín</span>
                <Input type="date" value={form.requiredDate} onChange={(e) => set("requiredDate", e.target.value)} className="h-10" />
              </label>
              <label className="block space-y-1">
                <span className="text-xs font-medium text-muted-foreground">Č. poptávky zákazníka</span>
                <Input value={form.inquiryNumber} onChange={(e) => set("inquiryNumber", e.target.value)} placeholder="RFQ-1234" className="h-10 font-mono" />
              </label>
            </div>
            <label className="block space-y-1">
              <span className="text-xs font-medium text-muted-foreground">Poznámka</span>
              <Textarea rows={2} value={form.note} onChange={(e) => set("note", e.target.value)} placeholder="Materiál, povrch, tolerance, kontakt…" />
            </label>
            <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
              <Button type="button" variant="ghost" onClick={() => setOpen(false)} disabled={busy}>Zrušit</Button>
              <Button type="submit" variant="success" disabled={busy}>
                {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4" />}
                Založit poptávku
              </Button>
            </div>
          </form>
        </DialogContent>
      </Dialog>
    </>
  );
}
