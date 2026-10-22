"use client";

import * as React from "react";
import { AlertTriangle, Loader2, StickyNote } from "lucide-react";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { DialogHead, ErrorBox } from "@/components/jobs/detail/confirm-dialog";
import { setJobOperationStatus } from "@/app/actions/production";
import { appendNote } from "@/lib/jobs/production";
import type { JobOperation } from "@/lib/jobs/production-types";
import { useProduction, useRunner } from "./production-context";
import { withStatus } from "./production-helpers";

/**
 * Nahlásit problém (stav „Problém" + důvod) nebo připsat poznámku k operaci.
 * Text se připíše na konec poznámky s časem a jménem (dělá server).
 */
export function NoteDialog({ op, mode, onClose }: { op: JobOperation; mode: "problem" | "note"; onClose: () => void }) {
  const { setOps, today } = useProduction();
  const { run, isBusy } = useRunner();
  const [text, setText] = React.useState("");
  const [error, setError] = React.useState<string | null>(null);
  const busy = isBusy("note");
  const id = React.useId();
  const problem = mode === "problem";

  async function submit(e?: React.SyntheticEvent) {
    e?.preventDefault();
    const t = text.trim();
    if (!t) {
      setError(problem ? "Napiš, co se stalo — ostatní to uvidí na kartě." : "Napiš poznámku.");
      return;
    }
    setError(null);
    const before = op;
    const status = problem ? "problem" : op.status;
    setOps((list) => withStatus(list, op.id, status, today).map((o) => (o.id === op.id ? { ...o, note: appendNote(o.note, t, null) } : o)));
    const res = await run("note", () => setJobOperationStatus(op.id, status, t), {
      success: problem ? `Problém nahlášen: ${op.label}` : "Poznámka připsána.",
      rollback: () => setOps((list) => list.map((o) => (o.id === before.id ? before : o))),
    });
    if (res) onClose();
  }

  return (
    <Dialog open onOpenChange={(o) => !o && !busy && onClose()}>
      <DialogContent aria-describedby={undefined} className="top-[6%] max-h-[90vh] w-[calc(100%-1.5rem)] overflow-y-auto sm:top-[12%] sm:max-w-md">
        <DialogHead
          icon={problem ? AlertTriangle : StickyNote}
          tone={problem ? "bg-red-100 text-red-600 dark:bg-red-500/15 dark:text-red-400" : "bg-amber-100 text-amber-700 dark:bg-amber-500/15 dark:text-amber-300"}
          title={problem ? `Problém: ${op.label}` : `Poznámka: ${op.label}`}
          subtitle={op.location !== "—" ? op.location : undefined}
        />
        <form onSubmit={submit} className="space-y-4 p-5">
          {op.note && (
            <div className="max-h-36 overflow-y-auto whitespace-pre-wrap rounded-lg bg-muted/50 px-3 py-2 text-xs leading-relaxed text-muted-foreground">
              {op.note}
            </div>
          )}
          <div>
            <label htmlFor={id} className="mb-1 block text-xs font-medium text-muted-foreground">
              {problem ? "Co se stalo?" : "Nová poznámka"}
            </label>
            <Textarea
              id={id}
              autoFocus
              rows={3}
              value={text}
              maxLength={2000}
              onChange={(e) => setText(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) void submit(e);
              }}
              placeholder={problem ? "Např. prasklina po kalení, chybí materiál, dodavatel nestíhá…" : "Např. domluveno s Petrem — vozíme v pátek"}
            />
          </div>
          <ErrorBox error={error} />
          <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
            <Button type="button" variant="ghost" onClick={onClose} disabled={busy}>Zpět</Button>
            <Button type="submit" variant={problem ? "destructive" : "success"} disabled={busy} className="h-10 sm:h-9">
              {busy ? <Loader2 className="animate-spin" /> : problem ? <AlertTriangle /> : <StickyNote />}
              {problem ? "Nahlásit problém" : "Připsat poznámku"}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
