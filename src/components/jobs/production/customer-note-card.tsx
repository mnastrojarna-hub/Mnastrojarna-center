"use client";

import * as React from "react";
import { AlertCircle, Check, Handshake, Loader2 } from "lucide-react";
import { Textarea } from "@/components/ui/textarea";
import { setCustomerNote } from "@/app/actions/production";
import { useJobDetail } from "@/components/jobs/detail/detail-context";
import { cn } from "@/lib/utils";

type SaveState = "idle" | "saving" | "saved" | "error";

/**
 * Domluvy se zákazníkem — to, co není v objednávce (balení, atest, dodání po
 * částech…). Ukládá se samo při opuštění pole (a při zavření záložky).
 */
export function CustomerNoteCard({ jobId, note, className }: { jobId: string; note: string | null; className?: string }) {
  const { notify, refresh } = useJobDetail();
  const [text, setText] = React.useState(note ?? "");
  const [saved, setSaved] = React.useState(note ?? "");
  const [synced, setSynced] = React.useState(note);
  const [state, setState] = React.useState<SaveState>("idle");
  const [error, setError] = React.useState<string | null>(null);
  const id = React.useId();

  // nová hodnota ze serveru (jiný uživatel / obnovení) — rozepsaný text nepřepisovat
  if (note !== synced) {
    setSynced(note);
    if (text.trim() === saved.trim()) setText(note ?? "");
    setSaved(note ?? "");
  }

  const dirty = text.trim() !== saved.trim();
  const latest = React.useRef({ text, dirty, jobId, refresh });
  React.useEffect(() => {
    latest.current = { text, dirty, jobId, refresh };
  });
  // zavření záložky s rozepsaným textem → uložit na pozadí
  React.useEffect(() => () => {
    const l = latest.current;
    if (l.dirty) {
      void setCustomerNote(l.jobId, l.text).then((r) => r.ok && l.refresh()).catch(() => {});
    }
  }, []);

  async function save() {
    if (!dirty || state === "saving") return;
    const value = text;
    setState("saving");
    setError(null);
    try {
      const res = await setCustomerNote(jobId, value);
      if (!res.ok) {
        setState("error");
        setError(res.error ?? "Domluvy se nepodařilo uložit.");
        notify("error", res.error ?? "Domluvy se nepodařilo uložit.");
        return;
      }
      setSaved(value);
      setState("saved");
      refresh();
      window.setTimeout(() => setState((s) => (s === "saved" ? "idle" : s)), 2500);
    } catch {
      setState("error");
      setError("Spojení se nepovedlo — text zůstal tady, zkus to znovu.");
    }
  }

  return (
    <section
      aria-labelledby={`${id}-h`}
      className={cn(
        "overflow-hidden rounded-2xl border border-amber-200 bg-amber-50/70 shadow-sm dark:border-amber-500/30 dark:bg-amber-500/[0.07]",
        className,
      )}
    >
      <header className="flex items-center gap-2.5 px-4 pb-2 pt-3">
        <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-amber-500 text-white shadow-sm">
          <Handshake className="h-4 w-4" />
        </span>
        <div className="min-w-0 flex-1">
          <h3 id={`${id}-h`} className="text-sm font-semibold leading-tight">Domluvy se zákazníkem</h3>
          <p className="text-xs text-amber-800/80 dark:text-amber-300/80">co není v objednávce</p>
        </div>
        <span className="shrink-0 text-xs" aria-live="polite">
          {state === "saving" && (
            <span className="inline-flex items-center gap-1 text-muted-foreground"><Loader2 className="h-3 w-3 animate-spin" /> Ukládám…</span>
          )}
          {state === "saved" && (
            <span className="inline-flex items-center gap-1 font-medium text-green-700 dark:text-green-400"><Check className="h-3 w-3" /> Uloženo</span>
          )}
          {state !== "saving" && state !== "saved" && dirty && (
            <span className="font-medium text-amber-700 dark:text-amber-400">neuloženo</span>
          )}
        </span>
      </header>
      <div className="px-4 pb-4">
        <label htmlFor={id} className="sr-only">Domluvy se zákazníkem</label>
        <Textarea
          id={id}
          value={text}
          rows={Math.min(10, Math.max(3, text.split("\n").length + 1))}
          maxLength={10_000}
          onChange={(e) => {
            setText(e.target.value);
            if (state === "error") setState("idle");
          }}
          onBlur={() => void save()}
          onKeyDown={(e) => {
            if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
              e.preventDefault();
              void save();
            }
          }}
          placeholder="Např. balit po 10 ks do VCI fólie, atest 3.1, dodat po částech, vyzvedne si sám…"
          className="border-amber-200 bg-background/80 text-sm leading-relaxed dark:border-amber-500/30"
        />
        {error && (
          <p role="alert" className="mt-1.5 flex items-start gap-1 text-xs text-red-600 dark:text-red-400">
            <AlertCircle className="mt-px h-3.5 w-3.5 shrink-0" /> {error}
            <button type="button" onClick={() => void save()} className="ml-1 font-semibold underline">Zkusit znovu</button>
          </p>
        )}
        {!error && <p className="mt-1 text-[11px] text-muted-foreground">Uloží se samo, jakmile klikneš jinam. Uvidí to všichni u zakázky.</p>}
      </div>
    </section>
  );
}
