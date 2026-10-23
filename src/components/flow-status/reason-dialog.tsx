"use client";

import * as React from "react";
import { Loader2 } from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";
import { Textarea } from "@/components/ui/textarea";
import { LOST_REASONS, lostReasonsFor, type LostReason, type ReasonPhase } from "@/lib/jobs/flow-status";

export interface ReasonDialogResult {
  reason: LostReason | null;
  note: string | null;
}

/**
 * Důvod jedním ťuknutím (mřížka tlačítek) + volitelná poznámka (povinná u „Jiný důvod" nebo
 * s requireNote); quickNotes = rychlé volby, které ťuknutím doplní poznámku (jde dopsat). Na mobilu panel zespodu, od sm: klasický dialog. Náhled dopadu (effect) nad
 * tlačítkem potvrzení. onConfirm vrátí chybu → zobrazí se v dialogu, jinak se dialog zavře.
 */
export function ReasonDialog({
  open, onOpenChange, title, description, phase, to, reasons, confirmLabel = "Potvrdit", destructive = true,
  requireNote = false, notePlaceholder, noteLabel = "Poznámka", quickNotes, effect, children, onConfirm,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  description?: string;
  /** Fáze + cíl určí nabídku důvodů (lostReasonsFor); reasons = vlastní výběr, [] = bez důvodu. */
  phase?: ReasonPhase;
  to?: string;
  reasons?: LostReason[];
  confirmLabel?: string;
  destructive?: boolean;
  requireNote?: boolean;
  notePlaceholder?: string;
  noteLabel?: string;
  /** Rychlé volby do poznámky jedním ťuknutím („Výkres", „Termín"…). */
  quickNotes?: readonly string[];
  /** Řádky náhledu dopadu (stageEffectText). */
  effect?: string[];
  children?: React.ReactNode;
  onConfirm: (v: ReasonDialogResult) => Promise<{ ok: boolean; error?: string } | void> | { ok: boolean; error?: string } | void;
}) {
  const options = React.useMemo(
    () => reasons ?? (phase ? lostReasonsFor(phase, to) : []),
    [reasons, phase, to],
  );
  const [reason, setReason] = React.useState<LostReason | null>(null);
  const [note, setNote] = React.useState("");
  const [error, setError] = React.useState<string | null>(null);
  const [pending, setPending] = React.useState(false);
  const noteId = React.useId();

  React.useEffect(() => {
    if (open) { setReason(null); setNote(""); setError(null); setPending(false); }
  }, [open]);

  const noteRequired = requireNote || reason === "jine";
  const parts = note.split(",").map((x) => x.trim()).filter(Boolean);
  function toggleQuick(q: string) {
    const next = parts.includes(q) ? parts.filter((x) => x !== q) : [...parts, q];
    setNote(next.join(", "));
  }
  const missing = (options.length > 0 && !reason) || (noteRequired && !note.trim());

  async function submit() {
    if (missing || pending) return;
    setPending(true);
    setError(null);
    try {
      const res = await onConfirm({ reason, note: note.trim() || null });
      if (res && !res.ok) setError(res.error ?? "Nepodařilo se uložit.");
      else onOpenChange(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Nepodařilo se uložit.");
    } finally {
      setPending(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={(o) => !pending && onOpenChange(o)}>
      <DialogContent
        className={cn(
          "bottom-0 left-0 top-auto max-h-[90dvh] max-w-none translate-x-0 overflow-y-auto rounded-b-none pb-[max(1rem,env(safe-area-inset-bottom))]",
          "sm:bottom-auto sm:left-1/2 sm:top-[15%] sm:max-w-lg sm:-translate-x-1/2 sm:rounded-xl sm:pb-0",
        )}
        aria-describedby={description ? `${noteId}-desc` : undefined}
      >
        <div className="space-y-4 p-4 sm:p-5">
          <div className="pr-8">
            <DialogTitle>{title}</DialogTitle>
            {description && <p id={`${noteId}-desc`} className="mt-1 text-sm text-muted-foreground">{description}</p>}
          </div>

          {options.length > 0 && (
            <div role="radiogroup" aria-label="Důvod" className="grid grid-cols-1 gap-2 min-[400px]:grid-cols-2">
              {options.map((r) => {
                const active = reason === r;
                return (
                  <button
                    key={r}
                    type="button"
                    role="radio"
                    aria-checked={active}
                    onClick={() => setReason(r)}
                    className={cn(
                      "min-h-11 rounded-lg border px-3 py-2 text-left text-sm transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                      active ? "border-foreground bg-foreground text-background" : "border-border bg-background hover:bg-accent",
                    )}
                  >
                    {LOST_REASONS[r].label}
                  </button>
                );
              })}
            </div>
          )}

          {children}

          <div className="space-y-1.5">
            <label htmlFor={noteId} className="text-xs font-medium text-muted-foreground">
              {noteLabel}{noteRequired ? " (povinná)" : ""}
            </label>
            {quickNotes && quickNotes.length > 0 && (
              <div role="group" aria-label="Rychlá volba" className="flex flex-wrap gap-1.5">
                {quickNotes.map((q) => {
                  const on = parts.includes(q);
                  return (
                    <button
                      key={q}
                      type="button"
                      aria-pressed={on}
                      onClick={() => toggleQuick(q)}
                      className={cn(
                        "min-h-11 rounded-full border px-3 text-sm transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring sm:min-h-8",
                        on ? "border-foreground bg-foreground text-background" : "border-border bg-background hover:bg-accent",
                      )}
                    >
                      {q}
                    </button>
                  );
                })}
              </div>
            )}
            <Textarea
              id={noteId}
              value={note}
              onChange={(e) => setNote(e.target.value)}
              maxLength={500}
              rows={2}
              placeholder={notePlaceholder ?? (noteRequired ? "Napiš krátce proč…" : "Poznámka (nepovinná)")}
              aria-required={noteRequired}
            />
          </div>

          {effect && effect.length > 0 && (
            <ul className="space-y-1 rounded-lg bg-muted/60 p-3 text-xs" aria-label="Co se stane">
              {effect.map((line) => <li key={line}>• {line}</li>)}
            </ul>
          )}

          {error && <p role="alert" className="text-sm text-red-600 dark:text-red-400">{error}</p>}

          <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
            <Button type="button" variant="outline" className="min-h-11 sm:min-h-9" onClick={() => onOpenChange(false)} disabled={pending}>
              Zpět
            </Button>
            <Button
              type="button"
              variant={destructive ? "destructive" : "default"}
              className="min-h-11 sm:min-h-9"
              onClick={submit}
              disabled={missing || pending}
            >
              {pending && <Loader2 className="animate-spin" aria-hidden />}
              {confirmLabel}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
