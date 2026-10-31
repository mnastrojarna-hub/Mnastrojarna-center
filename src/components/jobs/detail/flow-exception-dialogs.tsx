"use client";

import * as React from "react";
import Link from "next/link";
import { AlertTriangle, ClipboardPen, FileDiff, Loader2, PackageX, ShoppingCart, Upload } from "lucide-react";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { ReasonDialog } from "@/components/flow-status/reason-dialog";
import {
  closeClaim, closeJobAsLost, correctOrder, openClaim, pauseJob, recordDrawingRevision, recordProductionFailure,
  registerCustomerPo, reopenLostJob, resolveClaim, resumeJob, startWithoutCustomerPo, type CorrectionResult,
} from "@/app/actions/flow-exceptions";
import { uploadJobFile } from "@/lib/jobs/upload-client";
import {
  DECLINE_REASONS, NOT_ORDERED_REASONS, pragueToday, reopenLostTarget, resumeTarget, stageEffect, stageEffectText,
  type FlowActionKey, type FlowFacts, type QuoteFacts,
} from "@/lib/jobs/flow-status";
import {
  CLAIM_REASONS, CLAIM_REASON_ORDER, CLAIM_RESOLUTIONS, CORRECTION_NOTES, FAILURE_NEXT, FAILURE_REASONS, HOLD_REASONS,
  START_WITHOUT_PO_NOTES, type FailureNext,
} from "@/lib/jobs/flow-exceptions";
import { stageMeta } from "@/lib/jobs/stages";
import type { ClaimReason, ClaimResolution } from "@/lib/supabase/database.types";
import type { JobDetail, JobItem } from "@/lib/jobs/types";
import { cn } from "@/lib/utils";
import { DialogHead, ErrorBox } from "./confirm-dialog";

/**
 * Dialogy výjimek v toku (majitel 31. 10.) — „Co se stalo?": Zákazník neobjednal, Nebudeme nabízet,
 * Obnovit poptávku, Pozastavit / Pokračovat, Výroba se nepovedla, Reklamace (zapsat, vyřešit, vyřídit),
 * Vyrábět bez objednávky, Objednávka zákazníka dorazila, Oprava zakázky, Aktualizace výkresu.
 * Navazující krok (předání do výroby, potvrzení) otevře onSwitch — stejný dialog jako hlavní tlačítko.
 */

export const EXCEPTION_DIALOG_KEYS: readonly FlowActionKey[] = [
  "job.notOrdered", "job.decline", "job.reopenLost", "job.pause", "job.resume", "production.failed", "claim.open",
  "claim.resolve", "claim.close", "order.startWithoutPo", "order.poArrived", "order.correct", "drawing.update",
];

interface Props {
  actionKey: FlowActionKey;
  job: JobDetail;
  facts: FlowFacts;
  quotes: QuoteFacts[];
  margins: boolean;
  /** Předvybraná položka (Aktualizace výkresu z řádku položky). */
  itemId?: string | null;
  onClose: (open: boolean) => void;
  /** Hotovo: oznámení + obnovení dat (dialog se zavře). */
  onDone: (message: string) => void;
  /** Zápis proběhl, dialog pokračuje navazujícím krokem (oznámení + obnovení bez zavření). */
  onProgress: (message: string) => void;
  onSwitch: (key: FlowActionKey) => void;
}

const SHEET = cn(
  "bottom-0 left-0 top-auto max-h-[92dvh] max-w-none translate-x-0 overflow-y-auto rounded-b-none pb-[max(1rem,env(safe-area-inset-bottom))]",
  "sm:bottom-auto sm:left-1/2 sm:top-[8%] sm:max-w-lg sm:-translate-x-1/2 sm:rounded-xl sm:pb-0",
);
const ROSE = "bg-rose-100 text-rose-700 dark:bg-rose-500/15 dark:text-rose-300";
const AMBER = "bg-amber-100 text-amber-800 dark:bg-amber-500/15 dark:text-amber-300";

function itemLabel(i: Pick<JobItem, "drawingNumber" | "name" | "revision">): string {
  const base = (i.drawingNumber ?? "").trim() || (i.name ?? "").trim() || "Položka";
  return i.revision ? `${base} (rev. ${i.revision})` : base;
}

function Chips<T extends string>({ options, value, onChange, label }: { options: { key: T; label: string }[]; value: T | null; onChange: (v: T) => void; label: string }) {
  return (
    <div role="radiogroup" aria-label={label} className="grid grid-cols-1 gap-2 min-[400px]:grid-cols-2">
      {options.map((o) => (
        <button
          key={o.key}
          type="button"
          role="radio"
          aria-checked={value === o.key}
          onClick={() => onChange(o.key)}
          className={cn(
            "min-h-11 rounded-lg border px-3 py-2 text-left text-sm transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
            value === o.key ? "border-foreground bg-foreground text-background" : "border-border bg-background hover:bg-accent",
          )}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

function Field({ label, htmlFor, children, hint }: { label: string; htmlFor?: string; children: React.ReactNode; hint?: string }) {
  return (
    <div className="space-y-1">
      <label htmlFor={htmlFor} className="text-xs font-medium text-muted-foreground">{label}</label>
      {children}
      {hint && <p className="text-[11px] text-muted-foreground">{hint}</p>}
    </div>
  );
}

function Actions({ busy, disabled, label, onBack, destructive }: { busy: boolean; disabled?: boolean; label: string; onBack: () => void; destructive?: boolean }) {
  return (
    <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
      <Button type="button" variant="outline" className="min-h-11 sm:min-h-9" onClick={onBack} disabled={busy}>Zpět</Button>
      <Button type="submit" variant={destructive ? "destructive" : "default"} className="min-h-11 sm:min-h-9" disabled={busy || disabled}>
        {busy && <Loader2 className="animate-spin" aria-hidden />} {label}
      </Button>
    </div>
  );
}

function ItemSelect({ id, items, value, onChange, allowNone = true }: { id: string; items: JobItem[]; value: string; onChange: (v: string) => void; allowNone?: boolean }) {
  return (
    <select id={id} value={value} onChange={(e) => onChange(e.target.value)} className="h-11 w-full rounded-md border bg-background px-3 text-sm sm:h-10">
      {allowNone && <option value="">Celá zakázka</option>}
      {items.map((i) => <option key={i.id} value={i.id}>{itemLabel(i)} · {i.quantity} {i.unit}</option>)}
    </select>
  );
}

export function FlowExceptionDialog(p: Props) {
  const { actionKey: key, job, facts } = p;
  // navazující krok (předání do výroby…) nesmí zavřít ReasonDialog, který se po úspěchu zavírá sám
  const switched = React.useRef(false);
  const reasonClose = (o: boolean) => { if (!o && !switched.current) p.onClose(false); };
  const switchTo = (k: FlowActionKey, message: string) => {
    switched.current = true;
    p.onProgress(message);
    p.onSwitch(k);
  };

  switch (key) {
    case "job.notOrdered":
    case "job.decline": {
      const notOrdered = key === "job.notOrdered";
      const effect = stageEffectText(stageEffect(facts, p.quotes, { kind: "stage", to: "nerealizovano" }));
      return (
        <ReasonDialog
          open
          onOpenChange={reasonClose}
          title={notOrdered ? "Zákazník neobjednal" : "Nebudeme nabízet"}
          description={notOrdered
            ? "Zakázka se uklidí do Nerealizované & zrušené s důvodem. Kdyby se zákazník vrátil, „Obnovit poptávku“ ji vrátí zpět."
            : "Poptávku odmítáme my. Zakázka se uklidí do Nerealizované & zrušené s důvodem."}
          reasons={notOrdered ? NOT_ORDERED_REASONS : DECLINE_REASONS}
          confirmLabel={notOrdered ? "Zákazník neobjednal" : "Nebudeme nabízet"}
          effect={["Zakázka → Nerealizováno", ...effect]}
          onConfirm={async ({ reason, note }) => {
            if (!reason) return { ok: false, error: "Vyber důvod." };
            const res = await closeJobAsLost(job.id, notOrdered ? "notOrdered" : "decline", { reason, note });
            if (res.ok) p.onDone(notOrdered ? "Zákazník neobjednal — zakázka je v Nerealizovaných." : "Poptávka odmítnuta — zakázka je v Nerealizovaných.");
            return res;
          }}
        />
      );
    }
    case "job.reopenLost": {
      const to = reopenLostTarget(facts);
      return (
        <ReasonDialog
          open
          onOpenChange={reasonClose}
          title="Obnovit poptávku"
          description={`Zákazník se vrátil — zakázka půjde zpět do stavu „${stageMeta(to).label}“${to === "nabidka" ? " a poslední zamítnutá nabídka bude zase odeslaná" : ""}.`}
          reasons={[]}
          destructive={false}
          confirmLabel="Obnovit poptávku"
          onConfirm={async ({ note }) => {
            const res = await reopenLostJob(job.id, { note });
            if (res.ok) p.onDone("Poptávka obnovena.");
            return res;
          }}
        />
      );
    }
    case "job.pause":
      return (
        <ReasonDialog
          open
          onOpenChange={reasonClose}
          title="Pozastavit zakázku"
          description="Zakázka zůstane v Objednávkách se štítkem „Pozastaveno“. „Pokračovat“ ji vrátí přesně tam, kde je teď."
          reasons={[]}
          requireNote
          noteLabel="Proč stojí"
          quickNotes={HOLD_REASONS}
          destructive={false}
          confirmLabel="Pozastavit"
          effect={(facts.openPurchaseOrders ?? 0) > 0 ? ["Otevřené objednávky u dodavatelů: pak v menu „Stornovat u dodavatelů…“ pošli pozastavení."] : undefined}
          onConfirm={async ({ note }) => {
            const res = await pauseJob(job.id, { reason: note ?? "" });
            if (res.ok) p.onDone("Zakázka pozastavena.");
            return res;
          }}
        />
      );
    case "job.resume": {
      const to = resumeTarget(facts);
      return (
        <ReasonDialog
          open
          onOpenChange={reasonClose}
          title="Pokračovat v zakázce"
          description={to ? `Zakázka se vrátí do stavu „${stageMeta(to).label}“, kde se zastavila.` : "Nevím, kde zakázka stála — vyber stav v Korekci stavu."}
          reasons={[]}
          destructive={false}
          confirmLabel={to ? `Pokračovat — ${stageMeta(to).label}` : "Pokračovat"}
          onConfirm={async ({ note }) => {
            const res = await resumeJob(job.id, { note });
            if (res.ok) p.onDone("Zakázka zase běží.");
            return res;
          }}
        />
      );
    }
    case "claim.close":
      return (
        <ReasonDialog
          open
          onOpenChange={reasonClose}
          title="Reklamace vyřízena"
          description={facts.claimFromStage ? `Reklamace se uzavře a zakázka se vrátí do stavu „${stageMeta(facts.claimFromStage).label}“ (je-li dál).` : "Reklamace se uzavře."}
          reasons={[]}
          destructive={false}
          confirmLabel="Reklamace vyřízena"
          onConfirm={async ({ note }) => {
            const res = await closeClaim(job.id, { note });
            if (res.ok) p.onDone("Reklamace vyřízena.");
            return res;
          }}
        />
      );
    case "order.startWithoutPo":
      return (
        <ReasonDialog
          open
          onOpenChange={reasonClose}
          title="Vyrábět bez objednávky"
          description="Zákazník napsal „vyrábějte“ — objednávka dorazí později. Zakázka jde rovnou do Objednávek se štítkem „Bez objednávky“; potvrzení pošleš, až objednávka s číslem dorazí (spáruje se sama)."
          reasons={[]}
          destructive={false}
          noteLabel="Jak zákazník dal pokyn"
          quickNotes={START_WITHOUT_PO_NOTES}
          confirmLabel="Vyrábět — předat do výroby"
          onConfirm={async ({ note }) => {
            const res = await startWithoutCustomerPo(job.id, { note });
            if (res.ok) switchTo("production.handoff", "Vyrábí se bez objednávky — předej do výroby (kdo a do kdy).");
            return res;
          }}
        />
      );
    case "order.poArrived":
      return <PoArrivedDialog {...p} />;
    case "production.failed":
      return <ProductionFailedDialog {...p} switchTo={switchTo} />;
    case "claim.open":
      return <ClaimOpenDialog {...p} />;
    case "claim.resolve":
      return <ClaimResolveDialog {...p} switchTo={switchTo} />;
    case "order.correct":
      return <CorrectionDialog {...p} />;
    case "drawing.update":
      return <DrawingUpdateDialog {...p} />;
    default:
      return null;
  }
}

// ── Objednávka zákazníka dorazila ───────────────────────────
function PoArrivedDialog({ job, onClose, onProgress, onSwitch }: Props) {
  const [number, setNumber] = React.useState("");
  const [date, setDate] = React.useState(pragueToday());
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [done, setDone] = React.useState(false);
  const id = React.useId();
  return (
    <Dialog open onOpenChange={(o) => !busy && onClose(o)}>
      <DialogContent aria-describedby={undefined} className={SHEET}>
        <DialogHead icon={ShoppingCart} tone="bg-orange-100 text-orange-700 dark:bg-orange-500/15 dark:text-orange-300" title="Objednávka zákazníka dorazila"
          subtitle="Zakázka se vyráběla bez ní — zapiš číslo, štítek „Bez objednávky“ zmizí." />
        {done ? (
          <div className="space-y-4 p-4 sm:p-5" data-testid="po-arrived-done">
            <p className="text-sm">Objednávka <strong className="font-mono">{number}</strong> zapsána. Teď ji zákazníkovi potvrď — potvrzení už ponese její číslo.</p>
            <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
              <Button type="button" variant="outline" className="min-h-11 sm:min-h-9" onClick={() => onClose(false)}>Později</Button>
              <Button type="button" className="min-h-11 sm:min-h-9" onClick={() => onSwitch("order.sendConfirmation")}>Potvrdit objednávku</Button>
            </div>
          </div>
        ) : (
          <form
            className="space-y-4 p-4 sm:p-5"
            onSubmit={async (e) => {
              e.preventDefault();
              setBusy(true);
              setError(null);
              const res = await registerCustomerPo(job.id, { number, date }).catch(() => ({ ok: false, error: "Spojení se nepovedlo." }));
              setBusy(false);
              if (!res.ok) return setError(res.error ?? "Nepovedlo se.");
              onProgress("Objednávka zákazníka zapsána.");
              setDone(true);
            }}
          >
            <ErrorBox error={error} />
            <Field label="Číslo objednávky zákazníka" htmlFor={`${id}-n`}>
              <Input id={`${id}-n`} value={number} onChange={(e) => setNumber(e.target.value)} className="h-11 font-mono sm:h-10" required autoFocus />
            </Field>
            <Field label="Datum objednávky" htmlFor={`${id}-d`}>
              <Input id={`${id}-d`} type="date" value={date} onChange={(e) => setDate(e.target.value)} className="h-11 sm:h-10" />
            </Field>
            <p className="text-xs text-muted-foreground">Vyfocená nebo e-mailem přijatá objednávka se k zakázce spáruje sama — tohle je ruční zápis.</p>
            <Actions busy={busy} disabled={!number.trim()} label="Zapsat objednávku" onBack={() => onClose(false)} />
          </form>
        )}
      </DialogContent>
    </Dialog>
  );
}

// ── Výroba se nepovedla ─────────────────────────────────────
function ProductionFailedDialog({ job, onClose, onDone, margins, switchTo }: Props & { switchTo: (k: FlowActionKey, m: string) => void }) {
  const [itemId, setItemId] = React.useState(job.items.length === 1 ? job.items[0].id : "");
  const [qty, setQty] = React.useState("");
  const [reason, setReason] = React.useState<string | null>(null);
  const [note, setNote] = React.useState("");
  const [next, setNext] = React.useState<FailureNext | null>(null);
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const id = React.useId();
  const item = job.items.find((i) => i.id === itemId) ?? null;
  const partial = item && Number(qty) > 0 && Number(qty) < item.quantity;
  const nexts = (Object.keys(FAILURE_NEXT) as FailureNext[]).filter((k) => (k !== "cancel" || margins) && (k !== "short" || partial));
  return (
    <Dialog open onOpenChange={(o) => !busy && onClose(o)}>
      <DialogContent aria-describedby={undefined} className={SHEET}>
        <DialogHead icon={PackageX} tone={ROSE} title="Výroba se nepovedla" subtitle="Zmetek nebo chyba výroby — zapíše se do historie a rozhodneš, co dál." />
        <form
          className="space-y-4 p-4 sm:p-5"
          onSubmit={async (e) => {
            e.preventDefault();
            if (!reason || !next) return;
            setBusy(true);
            setError(null);
            const res = await recordProductionFailure(job.id, {
              itemId: itemId || null, qty: qty ? Number(qty) : null, reason: reason === "Jiné" && note.trim() ? note.trim() : reason, note: note.trim() || null, next,
            }).catch(() => ({ ok: false as const, error: "Spojení se nepovedlo." }));
            setBusy(false);
            if (!res.ok) return setError(res.error ?? "Nepovedlo se.");
            if (next === "remake" && "handoff" in res && res.handoff) {
              switchTo(res.handoff === "plan" ? "production.replan" : "production.handoff", "Zmetek zapsán — naplánuj výrobu znovu (kdo a do kdy).");
              return;
            }
            onDone(next === "cancel" ? "Zakázka zrušena — výroba se nepovedla." : "Zmetek zapsán — při dodání položku uzavři s menším množstvím.");
            onClose(false);
          }}
        >
          <ErrorBox error={error} />
          <Chips label="Co se stalo" options={FAILURE_REASONS.map((r) => ({ key: r, label: r }))} value={reason} onChange={setReason} />
          <div className="grid gap-3 sm:grid-cols-[1fr_7rem]">
            <Field label="Položka" htmlFor={`${id}-i`}><ItemSelect id={`${id}-i`} items={job.items} value={itemId} onChange={setItemId} /></Field>
            <Field label="Zmetků (ks)" htmlFor={`${id}-q`}>
              <Input id={`${id}-q`} type="number" inputMode="decimal" min={0} step="any" value={qty} onChange={(e) => setQty(e.target.value)} className="h-11 sm:h-10" />
            </Field>
          </div>
          <Field label="Popis (nepovinný)" htmlFor={`${id}-n`}>
            <Textarea id={`${id}-n`} rows={2} maxLength={500} value={note} onChange={(e) => setNote(e.target.value)} placeholder="např. díra Ø12 mimo toleranci" />
          </Field>
          <div className="space-y-1.5">
            <p className="text-xs font-medium text-muted-foreground">Co dál</p>
            <Chips label="Co dál" options={nexts.map((k) => ({ key: k, label: FAILURE_NEXT[k].label }))} value={next} onChange={setNext} />
            {next && <p className="text-xs text-muted-foreground">{FAILURE_NEXT[next].hint}</p>}
          </div>
          <Actions busy={busy} disabled={!reason || !next} label={next === "cancel" ? "Zrušit zakázku" : next === "remake" ? "Zapsat a vyrobit znovu" : "Zapsat zmetek"} destructive={next === "cancel"} onBack={() => onClose(false)} />
        </form>
      </DialogContent>
    </Dialog>
  );
}

// ── Reklamace ───────────────────────────────────────────────
function ClaimOpenDialog({ job, onClose, onDone }: Props) {
  const [reason, setReason] = React.useState<ClaimReason | null>(null);
  const [itemId, setItemId] = React.useState(job.items.length === 1 ? job.items[0].id : "");
  const [qty, setQty] = React.useState("");
  const [note, setNote] = React.useState("");
  const [files, setFiles] = React.useState<File[]>([]);
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const id = React.useId();
  return (
    <Dialog open onOpenChange={(o) => !busy && onClose(o)}>
      <DialogContent aria-describedby={undefined} className={SHEET}>
        <DialogHead icon={AlertTriangle} tone={ROSE} title="Reklamace" subtitle="Zákazník reklamuje dodané díly — zakázka se vrátí do Objednávek, dokud reklamaci nevyřešíš." />
        <form
          className="space-y-4 p-4 sm:p-5"
          onSubmit={async (e) => {
            e.preventDefault();
            if (!reason) return;
            setBusy(true);
            setError(null);
            try {
              for (const f of files) {
                const up = await uploadJobFile(f, { jobId: job.id, kind: f.type.startsWith("image/") ? "foto" : "korespondence", note: "Reklamace" });
                if (!up.ok) { setError(up.error ?? "Soubor se nepodařilo nahrát."); return; }
              }
              const res = await openClaim(job.id, { reason, qty: qty ? Number(qty) : null, itemId: itemId || null, note });
              if (!res.ok) { setError(res.error ?? "Nepovedlo se."); return; }
              onDone("Reklamace zapsána — rozhodni, jak ji vyřešíš.");
              onClose(false);
            } catch {
              setError("Spojení se nepovedlo — zkus to znovu.");
            } finally {
              setBusy(false);
            }
          }}
        >
          <ErrorBox error={error} />
          <Chips label="Důvod reklamace" options={CLAIM_REASON_ORDER.map((r) => ({ key: r, label: CLAIM_REASONS[r] }))} value={reason} onChange={setReason} />
          <div className="grid gap-3 sm:grid-cols-[1fr_7rem]">
            <Field label="Položka" htmlFor={`${id}-i`}><ItemSelect id={`${id}-i`} items={job.items} value={itemId} onChange={setItemId} /></Field>
            <Field label="Kusů" htmlFor={`${id}-q`}>
              <Input id={`${id}-q`} type="number" inputMode="decimal" min={0} step="any" value={qty} onChange={(e) => setQty(e.target.value)} className="h-11 sm:h-10" />
            </Field>
          </div>
          <Field label="Co zákazník reklamuje (povinné)" htmlFor={`${id}-n`}>
            <Textarea id={`${id}-n`} rows={3} maxLength={2000} value={note} onChange={(e) => setNote(e.target.value)} placeholder="např. 5 ks má otřep na hraně, foto v příloze" />
          </Field>
          <Field label="Fotky / dokumenty (nepovinné)" htmlFor={`${id}-f`} hint={files.length ? files.map((f) => f.name).join(", ") : "Uloží se do Dokumentů zakázky."}>
            <label htmlFor={`${id}-f`} className="inline-flex min-h-11 cursor-pointer items-center gap-2 rounded-md border px-3 text-sm hover:bg-accent sm:min-h-9">
              <Upload className="h-4 w-4" aria-hidden /> Přidat soubory
            </label>
            <input id={`${id}-f`} type="file" multiple accept="image/*,application/pdf" className="sr-only" onChange={(e) => setFiles(Array.from(e.target.files ?? []))} />
          </Field>
          <Actions busy={busy} disabled={!reason || !note.trim()} label="Zapsat reklamaci" onBack={() => onClose(false)} />
        </form>
      </DialogContent>
    </Dialog>
  );
}

function ClaimResolveDialog({ job, facts, onClose, onDone, switchTo }: Props & { switchTo: (k: FlowActionKey, m: string) => void }) {
  const [resolution, setResolution] = React.useState<ClaimResolution | null>(null);
  const [note, setNote] = React.useState("");
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const id = React.useId();
  const keys = Object.keys(CLAIM_RESOLUTIONS) as ClaimResolution[];
  const back = facts.claimFromStage ?? facts.sideFromStage ?? null;
  return (
    <Dialog open onOpenChange={(o) => !busy && onClose(o)}>
      <DialogContent aria-describedby={undefined} className={SHEET}>
        <DialogHead icon={AlertTriangle} tone={ROSE} title="Vyřešit reklamaci" subtitle={facts.claimNote ?? undefined} />
        <form
          className="space-y-4 p-4 sm:p-5"
          onSubmit={async (e) => {
            e.preventDefault();
            if (!resolution) return;
            setBusy(true);
            setError(null);
            const res = await resolveClaim(job.id, { resolution, note: note.trim() || null }).catch(() => ({ ok: false as const, error: "Spojení se nepovedlo." }));
            setBusy(false);
            if (!res.ok) return setError(res.error ?? "Nepovedlo se.");
            if (resolution === "oprava") return switchTo("production.handoff", "Reklamace: opravit / vyrobit znovu — předej do výroby.");
            onDone(resolution === "dobropis" ? "Reklamace uznána — dobropis zapsán." : "Reklamace zamítnuta.");
            onClose(false);
          }}
        >
          <ErrorBox error={error} />
          <Chips label="Jak reklamaci řešíme" options={keys.map((k) => ({ key: k, label: CLAIM_RESOLUTIONS[k].label }))} value={resolution} onChange={setResolution} />
          {resolution && (
            <p className="text-xs text-muted-foreground">
              {CLAIM_RESOLUTIONS[resolution].hint}
              {resolution !== "oprava" && back ? ` Zakázka se vrátí do stavu „${stageMeta(back).label}“.` : ""}
            </p>
          )}
          <Field label={resolution && resolution !== "oprava" ? "Poznámka (povinná — č. dobropisu, proč zamítáme…)" : "Poznámka"} htmlFor={`${id}-n`}>
            <Textarea id={`${id}-n`} rows={2} maxLength={500} value={note} onChange={(e) => setNote(e.target.value)} />
          </Field>
          <Actions busy={busy} disabled={!resolution || (resolution !== "oprava" && !note.trim())} label={resolution === "oprava" ? "Opravit — předat do výroby" : "Uložit"} onBack={() => onClose(false)} />
        </form>
      </DialogContent>
    </Dialog>
  );
}

// ── Oprava zakázky ──────────────────────────────────────────
function CorrectionDialog({ job, margins, onClose, onProgress, onSwitch }: Props) {
  const [reason, setReason] = React.useState("");
  const [rows, setRows] = React.useState(() => job.items.map((i) => ({ id: i.id, quantity: String(i.quantity), unitPrice: i.unitPrice === null ? "" : String(i.unitPrice) })));
  const [due, setDue] = React.useState(job.dueDate ?? "");
  const [delivery, setDelivery] = React.useState("");
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [result, setResult] = React.useState<CorrectionResult | null>(null);
  const id = React.useId();
  const parts = reason.split(",").map((x) => x.trim()).filter(Boolean);
  if (result) {
    return (
      <Dialog open onOpenChange={onClose}>
        <DialogContent aria-describedby={undefined} className={SHEET}>
          <DialogHead icon={ClipboardPen} tone={AMBER} title="Zakázka opravena" subtitle={`${result.changes.length} ${result.changes.length === 1 ? "změna" : result.changes.length < 5 ? "změny" : "změn"} v historii`} />
          <div className="space-y-3 p-4 sm:p-5" data-testid="correction-done">
            <ul className="space-y-1 rounded-lg bg-muted/60 p-3 text-xs">
              {result.changes.map((c) => <li key={c.field}>• {c.label}: {String(c.from ?? "—")} → {String(c.to ?? "—")}</li>)}
            </ul>
            {result.inProduction && (
              <p className="rounded-lg border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900 dark:border-amber-500/30 dark:bg-amber-500/10 dark:text-amber-200">
                Zakázka se už vyrábí — dej vědět dílně / dodavateli, ať se vyrábí podle opravy.
              </p>
            )}
            {result.purchaseOrders.length > 0 && (
              <div className="space-y-1.5 rounded-lg border p-3 text-sm">
                <p className="font-medium">Týká se objednávek u dodavatelů:</p>
                <ul className="text-xs text-muted-foreground">
                  {result.purchaseOrders.map((po) => <li key={po.id}>{po.number}{po.supplier ? ` — ${po.supplier}` : ""}</li>)}
                </ul>
                <Button asChild variant="outline" size="sm" className="min-h-11 sm:min-h-8">
                  <Link href={`/orders/${job.id}?tab=nakup`}>Upravit objednávku dodavateli</Link>
                </Button>
              </div>
            )}
            <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
              <Button type="button" variant="outline" className="min-h-11 sm:min-h-9" onClick={() => onClose(false)}>Hotovo</Button>
              {result.confirmationSent && (
                <Button type="button" className="min-h-11 sm:min-h-9" onClick={() => onSwitch("order.sendConfirmation")}>Poslat opravené potvrzení</Button>
              )}
            </div>
          </div>
        </DialogContent>
      </Dialog>
    );
  }
  return (
    <Dialog open onOpenChange={(o) => !busy && onClose(o)}>
      <DialogContent aria-describedby={undefined} className={SHEET}>
        <DialogHead icon={ClipboardPen} tone={AMBER} title="Oprava zakázky" subtitle="Zákazník změnil objednávku — uprav, co se mění; rozdíl půjde do historie a do nové revize objednávky." />
        <form
          className="space-y-4 p-4 sm:p-5"
          onSubmit={async (e) => {
            e.preventDefault();
            setBusy(true);
            setError(null);
            const res = await correctOrder(job.id, {
              reason,
              items: rows.map((r) => ({ id: r.id, quantity: Number(r.quantity), ...(margins ? { unitPrice: r.unitPrice === "" ? null : Number(r.unitPrice) } : {}) })),
              dueDate: due || null,
              deliveryNote: delivery.trim() || null,
            }).catch(() => ({ ok: false as const, error: "Spojení se nepovedlo." }));
            setBusy(false);
            if (!res.ok || !("changes" in res)) return setError(res.error ?? "Nepovedlo se.");
            onProgress("Zakázka opravena.");
            setResult(res as CorrectionResult);
          }}
        >
          <ErrorBox error={error} />
          <div className="space-y-1.5">
            <label htmlFor={`${id}-r`} className="text-xs font-medium text-muted-foreground">Co a proč se opravuje (povinné)</label>
            <div role="group" aria-label="Rychlá volba" className="flex flex-wrap gap-1.5">
              {CORRECTION_NOTES.map((q) => {
                const on = parts.includes(q);
                return (
                  <button key={q} type="button" aria-pressed={on}
                    onClick={() => setReason((on ? parts.filter((x) => x !== q) : [...parts, q]).join(", "))}
                    className={cn("min-h-11 rounded-full border px-3 text-sm sm:min-h-8", on ? "border-foreground bg-foreground text-background" : "hover:bg-accent")}>
                    {q}
                  </button>
                );
              })}
            </div>
            <Textarea id={`${id}-r`} rows={2} maxLength={500} value={reason} onChange={(e) => setReason(e.target.value)} placeholder="např. e-mail p. Nováka 31. 10." />
          </div>
          {job.items.length > 0 && (
            <div className="space-y-2">
              <p className="text-xs font-medium text-muted-foreground">Položky</p>
              {job.items.map((it, i) => (
                <div key={it.id} className="grid grid-cols-[minmax(0,1fr)_5.5rem] items-center gap-2 sm:grid-cols-[minmax(0,1fr)_6rem_7rem]">
                  <span className="truncate text-sm" title={itemLabel(it)}>{itemLabel(it)}</span>
                  <Input aria-label={`Množství ${itemLabel(it)}`} type="number" inputMode="decimal" min={0} step="any" value={rows[i]?.quantity ?? ""}
                    onChange={(e) => setRows((rs) => rs.map((r, j) => (j === i ? { ...r, quantity: e.target.value } : r)))} className="h-11 sm:h-9" />
                  {margins && (
                    <Input aria-label={`Cena / ks ${itemLabel(it)}`} type="number" inputMode="decimal" min={0} step="any" value={rows[i]?.unitPrice ?? ""} placeholder="cena / ks"
                      onChange={(e) => setRows((rs) => rs.map((r, j) => (j === i ? { ...r, unitPrice: e.target.value } : r)))} className="col-span-2 h-11 sm:col-span-1 sm:h-9" />
                  )}
                </div>
              ))}
              <p className="text-[11px] text-muted-foreground">Novou položku přidáš v záložce Položky — tady se mění, co už v zakázce je.</p>
            </div>
          )}
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Termín dodání" htmlFor={`${id}-d`}>
              <Input id={`${id}-d`} type="date" value={due} onChange={(e) => setDue(e.target.value)} className="h-11 sm:h-10" />
            </Field>
            <Field label="Dodací adresa / pokyny (nepovinné)" htmlFor={`${id}-a`}>
              <Input id={`${id}-a`} value={delivery} onChange={(e) => setDelivery(e.target.value)} className="h-11 sm:h-10" />
            </Field>
          </div>
          <Actions busy={busy} disabled={reason.trim().length < 3} label="Uložit opravu" onBack={() => onClose(false)} />
        </form>
      </DialogContent>
    </Dialog>
  );
}

// ── Aktualizace výkresu ─────────────────────────────────────
function nextRevision(rev: string | null | undefined): string {
  const r = (rev ?? "").trim();
  if (!r) return "";
  const num = /^(\d+)$/.exec(r);
  if (num) return String(Number(num[1]) + 1).padStart(num[1].length, "0");
  const letter = /^([A-Y])$/i.exec(r);
  if (letter) return String.fromCharCode(letter[1].toUpperCase().charCodeAt(0) + 1);
  return "";
}

function DrawingUpdateDialog({ job, itemId: preset, onClose, onDone }: Props) {
  const items = job.items;
  const [itemId, setItemId] = React.useState(preset ?? (items.length === 1 ? items[0].id : ""));
  const item = items.find((i) => i.id === itemId) ?? null;
  const [rev, setRev] = React.useState(() => nextRevision(item?.revision));
  const [file, setFile] = React.useState<File | null>(null);
  const [note, setNote] = React.useState("");
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const id = React.useId();
  return (
    <Dialog open onOpenChange={(o) => !busy && onClose(o)}>
      <DialogContent aria-describedby={undefined} className={SHEET}>
        <DialogHead icon={FileDiff} tone={ROSE} title="Aktualizace výkresu"
          subtitle="Nová revize se stane aktuálním výkresem položky (stará zůstane v archivu), anonymizuje se jako vždy a zakázka dostane výrazný štítek, dokud ji někdo nevezme na vědomí." />
        <form
          className="space-y-4 p-4 sm:p-5"
          onSubmit={async (e) => {
            e.preventDefault();
            if (!item) return;
            setBusy(true);
            setError(null);
            try {
              let fileId: string | null = null;
              if (file) {
                const up = await uploadJobFile(file, { jobId: job.id, kind: "vykres", note: `Revize ${rev}` });
                if (!up.ok || !up.file) { setError(up.error ?? "Výkres se nepodařilo nahrát."); return; }
                fileId = up.file.id;
              }
              const res = await recordDrawingRevision(job.id, { itemId: item.id, revision: rev, fileId, note: note.trim() || null });
              if (!res.ok) { setError(res.error ?? "Nepovedlo se."); return; }
              onDone(`Nová revize výkresu ${item.drawingNumber ?? ""} zapsána — zkontroluj, čeho se týká.`.replace(/\s+—/, " —"));
              onClose(false);
            } catch {
              setError("Spojení se nepovedlo — zkus to znovu.");
            } finally {
              setBusy(false);
            }
          }}
        >
          <ErrorBox error={error} />
          {items.length === 0 ? (
            <p className="text-sm text-muted-foreground">Zakázka nemá položky — přidej položku s číslem výkresu v záložce Položky.</p>
          ) : (
            <Field label="Položka (výkres)" htmlFor={`${id}-i`}>
              <ItemSelect id={`${id}-i`} items={items} value={itemId} allowNone={false} onChange={(v) => { setItemId(v); setRev(nextRevision(items.find((i) => i.id === v)?.revision)); }} />
            </Field>
          )}
          <div className="grid gap-3 sm:grid-cols-[8rem_1fr]">
            <Field label={`Nová revize${item?.revision ? ` (teď ${item.revision})` : ""}`} htmlFor={`${id}-r`}>
              <Input id={`${id}-r`} value={rev} onChange={(e) => setRev(e.target.value)} className="h-11 font-mono sm:h-10" required />
            </Field>
            <Field label="Nový výkres (PDF, STEP, DXF, obrázek)" htmlFor={`${id}-f`} hint={file ? file.name : "Nepovinné — revize jde zapsat i bez souboru."}>
              <label htmlFor={`${id}-f`} className="inline-flex min-h-11 cursor-pointer items-center gap-2 rounded-md border px-3 text-sm hover:bg-accent sm:min-h-10">
                <Upload className="h-4 w-4" aria-hidden /> {file ? "Vyměnit soubor" : "Vybrat soubor"}
              </label>
              <input id={`${id}-f`} type="file" className="sr-only" onChange={(e) => setFile(e.target.files?.[0] ?? null)} />
            </Field>
          </div>
          <Field label="Co se změnilo (nepovinné)" htmlFor={`${id}-n`}>
            <Textarea id={`${id}-n`} rows={2} maxLength={500} value={note} onChange={(e) => setNote(e.target.value)} placeholder="např. změna tolerance díry, nový materiál" />
          </Field>
          <Actions busy={busy} disabled={!item || !rev.trim()} label="Zapsat novou revizi" onBack={() => onClose(false)} />
        </form>
      </DialogContent>
    </Dialog>
  );
}
