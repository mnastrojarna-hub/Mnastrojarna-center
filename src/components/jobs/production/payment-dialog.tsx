"use client";

import * as React from "react";
import { Banknote, Loader2 } from "lucide-react";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { DialogHead, ErrorBox } from "@/components/jobs/detail/confirm-dialog";
import { formatMoney, parseDecimal } from "@/components/jobs/detail/detail-helpers";
import { todayInPrague } from "@/components/jobs/book/book-params";
import { recordJobPayment } from "@/app/actions/flow-status";

/**
 * „Zadat platbu" (dílčí úhrada, záloha) a „Zaplaceno" (vyrovnání). Částky bez DPH; částku smí
 * zadat jen role s právem na marže — bez ní jde o celou / zbývající částku, která zakázku vyrovná.
 * Historie částky nikdy neobsahuje, autora zapíše DB.
 */
export function PaymentDialog({
  open, onOpenChange, jobId, margins, settle = false, value, paidSoFar, currency = "CZK", onDone,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  jobId: string;
  margins: boolean;
  /** true = „Zaplaceno" (vyrovnání), false = dílčí úhrada. */
  settle?: boolean;
  value: number | null;
  paidSoFar: number;
  currency?: string;
  onDone?: (message: string) => void;
}) {
  const remaining = value !== null ? Math.max(0, Math.round((value - paidSoFar) * 100) / 100) : null;
  const [date, setDate] = React.useState(() => todayInPrague());
  const [amount, setAmount] = React.useState("");
  const [settles, setSettles] = React.useState(settle);
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const ids = { d: React.useId(), a: React.useId(), s: React.useId() };

  React.useEffect(() => {
    if (!open) return;
    setDate(todayInPrague());
    setAmount("");
    setSettles(settle);
    setError(null);
  }, [open, settle]);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    const n = margins && amount.trim() ? parseDecimal(amount) : null;
    if (margins && amount.trim() && (n === null || n < 0)) return setError("Zadej částku číslem (např. 48 000).");
    if (margins && !settles && n === null) return setError("U dílčí úhrady zadej částku — nebo zapni „vyrovnává zakázku“.");
    setBusy(true);
    setError(null);
    try {
      const res = await recordJobPayment(jobId, { date, amount: n, settles: n === null ? true : settles });
      if (!res.ok) return setError(res.error ?? "Úhradu se nepodařilo uložit.");
      onDone?.(res.stage === "dokonceno" ? "Zaplaceno ✓ — zakázka je dokončená." : res.paymentState === "zaplaceno" ? "Zaplaceno ✓" : "Úhrada zapsána.");
      onOpenChange(false);
    } catch {
      setError("Spojení se nepovedlo — zkus to znovu.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={(o) => !busy && onOpenChange(o)}>
      <DialogContent aria-describedby={undefined} className="top-[3%] w-[calc(100%-1rem)] sm:top-[12%] sm:max-w-md">
        <DialogHead
          icon={Banknote}
          tone="bg-emerald-100 text-emerald-700 dark:bg-emerald-500/15 dark:text-emerald-300"
          title={settle ? "Zaplaceno" : "Zadat platbu"}
          subtitle={margins && value !== null
            ? `Hodnota ${formatMoney(value, currency)} bez DPH${paidSoFar > 0 ? ` · zaplaceno zatím ${formatMoney(paidSoFar, currency)}` : ""}`
            : "Částky jsou bez DPH."}
        />
        <form onSubmit={submit} className="space-y-4 p-4 sm:p-5">
          <ErrorBox error={error} />
          <div className="grid gap-3 sm:grid-cols-2">
            <div>
              <label htmlFor={ids.d} className="mb-0.5 block text-[11px] font-medium text-muted-foreground">Přišlo dne</label>
              <Input id={ids.d} type="date" value={date} onChange={(e) => setDate(e.target.value)} className="h-11 sm:h-10" required />
            </div>
            {margins && (
              <div>
                <label htmlFor={ids.a} className="mb-0.5 block text-[11px] font-medium text-muted-foreground">Částka bez DPH</label>
                <Input
                  id={ids.a}
                  inputMode="decimal"
                  value={amount}
                  onChange={(e) => setAmount(e.target.value)}
                  placeholder={remaining !== null ? `zbývá ${formatMoney(remaining, currency)}` : "celá částka"}
                  className="h-11 text-right tabular-nums sm:h-10"
                />
              </div>
            )}
          </div>
          {margins ? (
            <label htmlFor={ids.s} className="flex min-h-11 items-center justify-between gap-3 rounded-lg border px-3 py-2 text-sm">
              <span>
                <span className="font-medium">Vyrovnává zakázku</span>
                <span className="block text-[11px] text-muted-foreground">Sleva, skonto nebo poslední splátka — zakázka bude zaplacená.</span>
              </span>
              <Switch id={ids.s} checked={settles} onCheckedChange={setSettles} />
            </label>
          ) : (
            <p className="text-xs text-muted-foreground">Zapíše se úhrada celé (zbývající) částky — zakázka bude zaplacená.</p>
          )}
          <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
            <Button type="button" variant="ghost" className="h-11 sm:h-9" onClick={() => onOpenChange(false)} disabled={busy}>Zpět</Button>
            <Button type="submit" variant="success" className="h-11 sm:h-9" disabled={busy || !date}>
              {busy ? <Loader2 className="animate-spin" /> : <Banknote />} {settles || !margins ? "Zaplaceno" : "Zapsat úhradu"}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
