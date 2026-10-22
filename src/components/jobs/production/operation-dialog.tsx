"use client";

import * as React from "react";
import { Loader2, Plus, Pencil } from "lucide-react";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { DialogHead, ErrorBox } from "@/components/jobs/detail/confirm-dialog";
import { addJobOperations, updateJobOperation } from "@/app/actions/production";
import { OPERATION_KINDS, OPERATION_KIND_ORDER, type OperationKind } from "@/lib/jobs/operations";
import { operationDisplayName, operationLabel, operationLocation, isOperationOverdue } from "@/lib/jobs/production";
import type { JobOperation, JobOperationInput } from "@/lib/jobs/production-types";
import { cn } from "@/lib/utils";
import { useProduction, useRunner } from "./production-context";
import { WHO_IN_HOUSE, whoOfOperation, whoToInput, whoLabel, type WhoValue } from "./production-helpers";
import { WhoPicker } from "./who-picker";

/** Barevná mřížka druhů operací (výběr jedním klepnutím). */
export function KindGrid({
  value, onPick, className, size = "md",
}: { value?: OperationKind | null; onPick: (k: OperationKind) => void; className?: string; size?: "md" | "lg" }) {
  return (
    <div role="radiogroup" aria-label="Druh operace" className={cn("grid grid-cols-2 gap-1.5 min-[480px]:grid-cols-3", className)}>
      {OPERATION_KIND_ORDER.map((k) => {
        const m = OPERATION_KINDS[k];
        const Icon = m.icon;
        const on = value === k;
        return (
          <button
            key={k}
            type="button"
            role="radio"
            aria-checked={on}
            onClick={() => onPick(k)}
            className={cn(
              "flex min-w-0 items-center gap-2 rounded-lg border text-left font-medium transition active:scale-[0.98]",
              size === "lg" ? "px-3 py-2.5 text-sm" : "px-2.5 py-2 text-[13px]",
              on ? cn(m.solid, "border-transparent shadow-sm") : cn(m.badge, "border-transparent hover:brightness-95 dark:hover:brightness-125"),
            )}
          >
            <Icon className="h-4 w-4 shrink-0" />
            <span className="min-w-0 truncate">{m.label}</span>
          </button>
        );
      })}
    </div>
  );
}

function Field({ label, htmlFor, children, hint }: { label: string; htmlFor?: string; children: React.ReactNode; hint?: string }) {
  return (
    <div className="min-w-0">
      <label htmlFor={htmlFor} className="mb-1 block text-xs font-medium text-muted-foreground">{label}</label>
      {children}
      {hint && <p className="mt-0.5 text-[11px] text-muted-foreground">{hint}</p>}
    </div>
  );
}

/**
 * Přidání (na konec / za danou operaci) a úprava operace: druh, vlastní název,
 * kdo to dělá, termíny a poznámka.
 */
export function OperationDialog({
  mode, op, at, initialKind, afterLabel, onClose,
}: {
  mode: "add" | "edit";
  op?: JobOperation;
  /** Pozice vložení (add). */
  at?: number;
  initialKind?: OperationKind;
  /** „Vloží se za: …" */
  afterLabel?: string | null;
  onClose: () => void;
}) {
  const { jobId, suppliers, setOps, today } = useProduction();
  const { run, isBusy } = useRunner();
  const [kind, setKind] = React.useState<OperationKind | null>(op?.kind ?? initialKind ?? null);
  const [title, setTitle] = React.useState(op?.title ?? "");
  const [who, setWho] = React.useState<WhoValue>(op ? whoOfOperation(op) : WHO_IN_HOUSE);
  const [start, setStart] = React.useState(op?.plannedStart ?? "");
  const [end, setEnd] = React.useState(op?.plannedEnd ?? "");
  const [note, setNote] = React.useState(op?.note ?? "");
  const [error, setError] = React.useState<string | null>(null);
  const busy = isBusy("save");
  const ids = { title: React.useId(), start: React.useId(), end: React.useId(), note: React.useId(), who: React.useId() };

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!kind) {
      setError("Vyber druh operace.");
      return;
    }
    if (start && end && start > end) {
      setError("Začátek je po termínu operace.");
      return;
    }
    setError(null);
    const input: JobOperationInput = {
      kind,
      title: title.trim() || null,
      ...whoToInput(who),
      plannedStart: start || null,
      plannedEnd: end || null,
      note: note.trim() ? note : null,
    };
    const name = operationDisplayName({
      label: operationLabel(kind, input.title),
      location: who.type === "none" ? "—" : whoLabel(who),
    });

    if (mode === "add") {
      const res = await run("save", () => addJobOperations(jobId, [input], at !== undefined ? { atPosition: at } : {}), {
        success: `Přidáno: ${name}`,
      });
      if (res) onClose();
      return;
    }
    if (!op) return;
    const before = op;
    const location = operationLocation({
      inHouse: who.type === "u_nas",
      supplier: who.type === "supplier" ? { name: who.name } : null,
      supplierName: who.type === "free" ? who.name : null,
    });
    setOps((list) => list.map((o) => (o.id === op.id
      ? {
        ...o, kind, title: input.title ?? null, label: operationLabel(kind, input.title), location,
        inHouse: who.type === "u_nas", supplier: who.type === "supplier" ? { id: who.id, name: who.name } : null,
        supplierName: who.type === "free" ? who.name : null, plannedStart: input.plannedStart ?? null,
        plannedEnd: input.plannedEnd ?? null, note: input.note ?? null,
        overdue: isOperationOverdue({ status: o.status, plannedEnd: input.plannedEnd ?? null }, today),
      }
      : o)));
    const res = await run("save", () => updateJobOperation(op.id, input), {
      success: `Uloženo: ${name}`,
      rollback: () => setOps((list) => list.map((o) => (o.id === before.id ? before : o))),
    });
    if (res) onClose();
  }

  const Icon = mode === "add" ? Plus : Pencil;
  const meta = kind ? OPERATION_KINDS[kind] : null;

  return (
    <Dialog open onOpenChange={(o) => !o && !busy && onClose()}>
      <DialogContent aria-describedby={undefined} className="top-[4%] max-h-[92vh] w-[calc(100%-1.5rem)] overflow-y-auto sm:top-[8%] sm:max-w-xl">
        <DialogHead
          icon={meta?.icon ?? Icon}
          tone={meta?.badge ?? "bg-yellow-100 text-yellow-800 dark:bg-yellow-500/15 dark:text-yellow-300"}
          title={mode === "add" ? "Přidat operaci" : `Upravit: ${op?.label ?? "operace"}`}
          subtitle={mode === "add" ? (afterLabel ? `Vloží se za: ${afterLabel}` : "Přidá se na konec postupu.") : "Změny se zapíšou do historie zakázky."}
        />
        <form onSubmit={submit} className="space-y-4 p-5">
          <div>
            <div className="mb-1.5 text-xs font-medium text-muted-foreground">Co se dělá</div>
            <KindGrid value={kind} onPick={(k) => { setKind(k); setError(null); }} />
          </div>

          <WhoPicker id={ids.who} value={who} onChange={setWho} suppliers={suppliers} />

          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Termín operace" htmlFor={ids.end} hint="Kdy to má být hotové.">
              <Input id={ids.end} type="date" value={end} onChange={(e) => setEnd(e.target.value)} className="h-10" />
            </Field>
            <Field label="Začátek (nepovinné)" htmlFor={ids.start}>
              <Input id={ids.start} type="date" value={start} onChange={(e) => setStart(e.target.value)} className="h-10" />
            </Field>
          </div>

          <Field label="Vlastní název (nepovinné)" htmlFor={ids.title} hint="Např. „Soustružení — 2. upnutí“. Jinak se použije druh operace.">
            <Input id={ids.title} value={title} maxLength={300} onChange={(e) => setTitle(e.target.value)} placeholder={meta?.label ?? "Název operace"} className="h-10" />
          </Field>

          <Field label="Poznámka" htmlFor={ids.note}>
            <Textarea
              id={ids.note}
              value={note}
              rows={Math.min(8, Math.max(2, note.split("\n").length + 1))}
              onChange={(e) => setNote(e.target.value)}
              placeholder="Co je potřeba vědět — upnutí, tvrdost, kdo vozí…"
            />
          </Field>

          <ErrorBox error={error} />
          <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
            <Button type="button" variant="ghost" onClick={onClose} disabled={busy}>Zpět</Button>
            <Button type="submit" variant="success" disabled={busy || !kind} className="h-10 sm:h-9">
              {busy ? <Loader2 className="animate-spin" /> : <Icon />}
              {mode === "add" ? "Přidat operaci" : "Uložit změny"}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
