"use client";

import * as React from "react";
import { ArrowDown, Home, Loader2, PackageCheck, Workflow } from "lucide-react";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { DialogHead, ErrorBox } from "@/components/jobs/detail/confirm-dialog";
import { addJobOperations, applyOperationTemplate } from "@/app/actions/production";
import { OPERATION_KINDS, OPERATION_TEMPLATES } from "@/lib/jobs/operations";
import { cn } from "@/lib/utils";
import { useProduction, useRunner } from "./production-context";
import {
  WHO_IN_HOUSE, WHO_NONE, sameWho, templateRequest, whoLabel, whoToInput, type WhoValue,
} from "./production-helpers";
import { WhoPicker } from "./who-picker";

/** Postup ze šablony: ke každému kroku jen vybrat, kdo ho dělá (výchozí „U nás"). */
export function TemplateDialog({ templateKey, onClose }: { templateKey: string; onClose: () => void }) {
  const { jobId, suppliers } = useProduction();
  const { run, isBusy } = useRunner();
  const tpl = OPERATION_TEMPLATES.find((t) => t.key === templateKey) ?? null;
  const kinds = React.useMemo(() => tpl?.kinds ?? [], [tpl]);
  const [picks, setPicks] = React.useState<WhoValue[]>(() => kinds.map(() => WHO_IN_HOUSE));
  const [error, setError] = React.useState<string | null>(null);
  const busy = isBusy("template");

  if (!tpl) return null;

  function setPick(i: number, v: WhoValue) {
    setPicks((list) => list.map((p, j) => (j === i ? v : p)));
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!tpl) return;
    setError(null);
    const req = templateRequest(kinds, picks);
    const n = kinds.length;
    const res = await run(
      "template",
      () => (req.mode === "template" ? applyOperationTemplate(jobId, tpl.key, req.supplierByKind) : addJobOperations(jobId, req.ops)),
      { success: `Postup založen — ${n} ${n < 5 ? "operace" : "operací"}. Klepnutím na „Začít“ ho rozběhneš.` },
    );
    if (res) onClose();
  }

  const allInHouse = picks.every((p) => p.type === "u_nas");

  return (
    <Dialog open onOpenChange={(o) => !o && !busy && onClose()}>
      <DialogContent aria-describedby={undefined} className="top-[4%] max-h-[92vh] w-[calc(100%-1.5rem)] overflow-y-auto sm:top-[8%] sm:max-w-lg">
        <DialogHead
          icon={Workflow}
          tone="bg-yellow-100 text-yellow-800 dark:bg-yellow-500/15 dark:text-yellow-300"
          title={tpl.label}
          subtitle="U každého kroku vyber, kdo ho dělá. Pořadí i firmy jde později změnit."
        />
        <form onSubmit={submit} className="space-y-4 p-5">
          {!allInHouse && (
            <button
              type="button"
              onClick={() => setPicks(kinds.map(() => WHO_IN_HOUSE))}
              className="inline-flex items-center gap-1.5 rounded-full border border-emerald-200 bg-emerald-50 px-3 py-1 text-xs font-medium text-emerald-800 hover:bg-emerald-100 dark:border-emerald-500/30 dark:bg-emerald-500/10 dark:text-emerald-300"
            >
              <Home className="h-3.5 w-3.5" /> Vše u nás
            </button>
          )}
          <ol className="space-y-3">
            {kinds.map((kind, i) => {
              const m = OPERATION_KINDS[kind];
              const Icon = m.icon;
              const pick = picks[i] ?? WHO_NONE;
              const others = picks.some((p, j) => j !== i && !sameWho(p, pick));
              return (
                <li key={`${kind}-${i}`} className="relative flex gap-3">
                  <div className="flex flex-col items-center">
                    <span className={cn("flex h-9 w-9 shrink-0 items-center justify-center rounded-full shadow-sm", m.solid)}>
                      <Icon className="h-4 w-4" />
                    </span>
                    {i < kinds.length - 1 && <span aria-hidden className="mt-1 w-0.5 flex-1 rounded-full bg-border" />}
                  </div>
                  <div className="min-w-0 flex-1 pb-1">
                    <div className="mb-1 flex items-baseline gap-1.5">
                      <span className="text-[11px] font-semibold tabular-nums text-muted-foreground">{i + 1}.</span>
                      <span className={cn("text-sm font-semibold", m.text)}>{m.label}</span>
                    </div>
                    <WhoPicker value={pick} onChange={(v) => setPick(i, v)} suppliers={suppliers} label="" />
                    {(pick.type === "supplier" || pick.type === "free") && others && kinds.length > 1 && (
                      <button
                        type="button"
                        onClick={() => setPicks(kinds.map(() => pick))}
                        className="mt-1 inline-flex items-center gap-1 text-[11px] font-medium text-sky-700 hover:underline dark:text-sky-400"
                      >
                        <ArrowDown className="h-3 w-3" /> {whoLabel(pick)} i pro ostatní kroky
                      </button>
                    )}
                  </div>
                </li>
              );
            })}
          </ol>
          <ErrorBox error={error} />
          <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
            <Button type="button" variant="ghost" onClick={onClose} disabled={busy}>Zpět</Button>
            <Button type="submit" variant="success" disabled={busy} className="h-10 sm:h-9">
              {busy ? <Loader2 className="animate-spin" /> : <Workflow />} Založit postup
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}

/** Zjednodušeně: celou zakázku dodá jedna firma (jedna operace „Kompletní dodávka"). */
export function CompleteDeliveryDialog({ onClose }: { onClose: () => void }) {
  const { jobId, suppliers } = useProduction();
  const { run, isBusy } = useRunner();
  const [who, setWho] = React.useState<WhoValue>(WHO_NONE);
  const [end, setEnd] = React.useState("");
  const [note, setNote] = React.useState("");
  const [error, setError] = React.useState<string | null>(null);
  const busy = isBusy("complete");
  const endId = React.useId();
  const noteId = React.useId();

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (who.type === "none") {
      setError("Vyber firmu, která zakázku dodá (nebo „U nás“).");
      return;
    }
    setError(null);
    const res = await run(
      "complete",
      () => addJobOperations(jobId, [{
        kind: "kompletni_dodavka", ...whoToInput(who), plannedEnd: end || null, note: note.trim() || null,
      }]),
      { success: `Kompletní dodávka: ${whoLabel(who)}` },
    );
    if (res) onClose();
  }

  return (
    <Dialog open onOpenChange={(o) => !o && !busy && onClose()}>
      <DialogContent aria-describedby={undefined} className="top-[4%] max-h-[92vh] w-[calc(100%-1.5rem)] overflow-y-auto sm:top-[10%] sm:max-w-md">
        <DialogHead
          icon={PackageCheck}
          tone={OPERATION_KINDS.kompletni_dodavka.badge}
          title="Kompletní dodávka"
          subtitle="Celé to vyrobí a dodá jedna firma — bez podrobného postupu."
        />
        <form onSubmit={submit} className="space-y-4 p-5">
          <WhoPicker value={who} onChange={(v) => { setWho(v); setError(null); }} suppliers={suppliers} label="Kdo to dodá" allowNone={false} startOpen />
          <div>
            <label htmlFor={endId} className="mb-1 block text-xs font-medium text-muted-foreground">Termín dodání od firmy (nepovinné)</label>
            <Input id={endId} type="date" value={end} onChange={(e) => setEnd(e.target.value)} className="h-10" />
          </div>
          <div>
            <label htmlFor={noteId} className="mb-1 block text-xs font-medium text-muted-foreground">Poznámka (nepovinné)</label>
            <Textarea id={noteId} rows={2} value={note} onChange={(e) => setNote(e.target.value)} placeholder="Např. včetně kalení a černění, dováží sami" />
          </div>
          <ErrorBox error={error} />
          <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
            <Button type="button" variant="ghost" onClick={onClose} disabled={busy}>Zpět</Button>
            <Button type="submit" variant="success" disabled={busy} className="h-10 sm:h-9">
              {busy ? <Loader2 className="animate-spin" /> : <PackageCheck />} Uložit dodávku
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
