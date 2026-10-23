"use client";

import * as React from "react";
import Link from "next/link";
import { Check, Loader2, Undo2 } from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { useNotify } from "@/components/jobs/detail/toast";
import { FLOW_ACTIONS, FLOW_PALETTE, type FlowActionKey, type PaletteKey } from "@/lib/jobs/flow-status";

type RunResult = { ok: boolean; error?: string } | void;

/** Jak dlouho jde přímou akci vrátit. */
export const UNDO_MS = 8000;

/**
 * Primární tlačítko dalšího kroku (nextAction) — vždy sloveso („Převzít", „Potvrdit objednávku").
 * link → přejde (FLOW_ACTIONS.href), dialog → onRun otevře dialog rodiče, direct → provede
 * onRun a 8 s nabízí „Vrátit" (onUndo). Chyba jde do oznámení i do aria-live.
 */
export function NextActionButton({
  action, jobId, onRun, onUndo, palette, size = "default", className, successText,
}: {
  action: { key: FlowActionKey; label: string } | null;
  jobId: string;
  onRun?: (key: FlowActionKey) => Promise<RunResult> | RunResult;
  onUndo?: (key: FlowActionKey) => Promise<RunResult> | RunResult;
  /** Barva tlačítka v odstínu fáze (solid); bez ní neutrální výchozí. */
  palette?: PaletteKey;
  size?: "default" | "sm" | "lg";
  className?: string;
  /** Text po úspěšné přímé akci (výchozí „Hotovo"). */
  successText?: string;
}) {
  const notify = useNotify();
  const [pending, setPending] = React.useState(false);
  const [undoable, setUndoable] = React.useState<FlowActionKey | null>(null);
  const [status, setStatus] = React.useState("");
  const timer = React.useRef<number | null>(null);

  React.useEffect(() => () => { if (timer.current) window.clearTimeout(timer.current); }, []);

  if (!action) return null;
  const meta = FLOW_ACTIONS[action.key];
  const Icon = meta.icon;
  // hover celým literálem palety → twMerge přebije hover:bg-foreground/90 výchozí varianty (jinak text zmizí)
  const cls = cn("min-h-11 sm:min-h-9", palette && cn(FLOW_PALETTE[palette].solid, FLOW_PALETTE[palette].hover), className);

  if (meta.kind === "link" && meta.href) {
    return (
      <Button asChild size={size} className={cls}>
        <Link href={meta.href(jobId)}>
          <Icon aria-hidden />
          {action.label}
        </Link>
      </Button>
    );
  }

  async function run() {
    if (!onRun || pending || !action) return;
    setPending(true);
    setStatus("");
    try {
      const res = await onRun(action.key);
      if (res && !res.ok) {
        notify("error", res.error ?? "Akce se nepovedla.");
        setStatus(res.error ?? "Akce se nepovedla.");
        return;
      }
      if (meta.kind === "direct") {
        setStatus(`${successText ?? "Hotovo"}: ${action.label}`);
        if (onUndo) {
          setUndoable(action.key);
          if (timer.current) window.clearTimeout(timer.current);
          timer.current = window.setTimeout(() => setUndoable(null), UNDO_MS);
        }
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Akce se nepovedla.";
      notify("error", msg);
      setStatus(msg);
    } finally {
      setPending(false);
    }
  }

  async function undo() {
    if (!onUndo || !undoable) return;
    const key = undoable;
    setUndoable(null);
    if (timer.current) window.clearTimeout(timer.current);
    const res = await onUndo(key);
    if (res && !res.ok) notify("error", res.error ?? "Vrátit se nepodařilo.");
    else setStatus("Vráceno.");
  }

  return (
    <span className="inline-flex flex-wrap items-center gap-2">
      {undoable ? (
        <span className="inline-flex min-h-11 items-center gap-2 rounded-md border border-border px-3 text-sm sm:min-h-9">
          <Check className="size-4 text-green-600 dark:text-green-400" aria-hidden />
          {successText ?? "Hotovo"}
          <Button type="button" variant="ghost" size="sm" onClick={undo} className="min-h-9 sm:min-h-7">
            <Undo2 aria-hidden />
            Vrátit
          </Button>
        </span>
      ) : (
        <Button type="button" size={size} className={cls} onClick={run} disabled={pending || !onRun}>
          {pending ? <Loader2 className="animate-spin" aria-hidden /> : <Icon aria-hidden />}
          {action.label}
        </Button>
      )}
      <span className="sr-only" role="status" aria-live="polite">{status}</span>
    </span>
  );
}
