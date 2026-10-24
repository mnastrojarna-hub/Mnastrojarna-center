"use client";

import * as React from "react";
import { Loader2, Undo2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";
import { Textarea } from "@/components/ui/textarea";
import { returnQuoteToAuthor } from "@/app/actions/flow-status";
import { cn } from "@/lib/utils";
import { returnedToast } from "./quote-approval-copy";

/**
 * „Vrátit nabídku {č.} k přepracování“ (#25, jen super admin): povinný důvod → returnQuoteToAuthor.
 * Nabídka zůstává „Neschválená“, zmizí z fronty ke schválení a autor ji uvidí s důvodem.
 * Na mobilu panel zespodu, od sm: klasický dialog.
 */
export function QuoteReturnDialog({
  open, onOpenChange, quoteId, number, author, onDone,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  quoteId: string;
  number: string | null;
  author?: string | null;
  /** Hotovo — volající ukáže toast (returnedToast) a obnoví data. */
  onDone: (message: string) => void;
}) {
  const [note, setNote] = React.useState("");
  const [error, setError] = React.useState<string | null>(null);
  const [pending, setPending] = React.useState(false);
  const id = React.useId();

  React.useEffect(() => {
    if (open) { setNote(""); setError(null); setPending(false); }
  }, [open]);

  const missing = note.trim().length < 3;

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (pending) return;
    if (missing) return setError("Napiš, co má autor upravit.");
    setPending(true);
    setError(null);
    try {
      const res = await returnQuoteToAuthor(quoteId, note.trim());
      if (!res.ok) return setError(res.error ?? "Vrácení se nepovedlo.");
      onDone(returnedToast(number, author));
      onOpenChange(false);
    } catch {
      setError("Spojení se nepovedlo — zkus to znovu.");
    } finally {
      setPending(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={(o) => !pending && onOpenChange(o)}>
      <DialogContent
        aria-describedby={`${id}-desc`}
        className={cn(
          "bottom-0 left-0 top-auto max-h-[90dvh] max-w-none translate-x-0 overflow-y-auto rounded-b-none pb-[max(1rem,env(safe-area-inset-bottom))]",
          "sm:bottom-auto sm:left-1/2 sm:top-[15%] sm:max-w-lg sm:-translate-x-1/2 sm:rounded-xl sm:pb-0",
        )}
      >
        <form onSubmit={submit} className="space-y-4 p-4 sm:p-5">
          <div className="flex items-start gap-3 pr-8">
            <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-rose-100 text-rose-700 dark:bg-rose-500/15 dark:text-rose-300">
              <Undo2 className="h-5 w-5" aria-hidden />
            </span>
            <div className="min-w-0">
              <DialogTitle>{`Vrátit nabídku ${number?.trim() || ""} k přepracování`.replace(/\s+/g, " ")}</DialogTitle>
              <p id={`${id}-desc`} className="mt-1 text-sm text-muted-foreground">
                Nabídka zůstane neschválená{author ? ` a ${author} ji uvidí s tvým důvodem` : " a autor ji uvidí s tvým důvodem"}.
                Po jeho úpravě se ti vrátí ke schválení.
              </p>
            </div>
          </div>
          <div className="space-y-1.5">
            <label htmlFor={id} className="text-xs font-medium text-muted-foreground">Co má autor upravit?</label>
            <Textarea
              id={id}
              value={note}
              onChange={(e) => setNote(e.target.value)}
              maxLength={1000}
              rows={3}
              required
              aria-required
              placeholder="např. Cena u položky 2 je nízká, termín zkrať na 3 týdny"
            />
          </div>
          {error && <p role="alert" className="text-sm text-red-600 dark:text-red-400">{error}</p>}
          <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
            <Button type="button" variant="outline" className="min-h-11 sm:min-h-9" onClick={() => onOpenChange(false)} disabled={pending}>
              Zpět
            </Button>
            <Button type="submit" variant="destructive" className="min-h-11 sm:min-h-9" disabled={pending || missing}>
              {pending ? <Loader2 className="animate-spin" aria-hidden /> : <Undo2 aria-hidden />}
              Vrátit k přepracování
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
