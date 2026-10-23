"use client";

import * as React from "react";
import { BadgeCheck, CalendarPlus, Check, CircleX, GitCompare, Hand, Loader2, Mail, Plus, RotateCcw, Sparkles, Trash2, X } from "lucide-react";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { DialogHead, ErrorBox } from "@/components/jobs/detail/confirm-dialog";
import { actorName, lostReasonLabel, type ChangeStamp } from "@/lib/jobs/flow-status";
import type { FlowProposal, OrderMismatch, OrderMismatchKind } from "@/lib/supabase/database.types";
import { addDaysIso, czDay } from "./flow-utils";
import { MismatchList, RevisionDiff } from "./confirm-order-dialog";
import type { OrderRevisionView } from "./flow-state";

/**
 * Dialogy objednávky a nabídky na stránkách toku: rozpor s nabídkou (zapsat / vyřešit),
 * rozhodnutí o změně objednávky (rev N), prodloužení platnosti a rozhodnutí návrhu.
 * Na mobilu panel zespodu, tlačítka min. 44 px.
 */

type Result = { ok: boolean; error?: string } | void;

const SHEET = "bottom-0 left-0 top-auto max-h-[92dvh] max-w-none translate-x-0 overflow-y-auto rounded-b-none pb-[max(1rem,env(safe-area-inset-bottom))] sm:bottom-auto sm:left-1/2 sm:top-[10%] sm:max-w-lg sm:-translate-x-1/2 sm:rounded-xl sm:pb-0";

function useRun(onOpenChange: (o: boolean) => void) {
  const [pending, setPending] = React.useState<string | null>(null);
  const [error, setError] = React.useState<string | null>(null);
  const run = React.useCallback(async (tag: string, fn: () => Promise<Result> | Result, keepOpen = false) => {
    setPending(tag);
    setError(null);
    try {
      const res = await fn();
      if (res && !res.ok) setError(res.error ?? "Nepodařilo se uložit.");
      else if (!keepOpen) onOpenChange(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Spojení se nepovedlo — zkus to znovu.");
    } finally {
      setPending(null);
    }
  }, [onOpenChange]);
  return { pending, error, setError, run };
}

// ── Rozpor s nabídkou: zapsat rozdíly ───────────────────────
export const MISMATCH_KINDS: { kind: OrderMismatchKind; label: string }[] = [
  { kind: "cena", label: "Cena" },
  { kind: "mnozstvi", label: "Množství" },
  { kind: "revize_vykresu", label: "Revize výkresu" },
  { kind: "termin", label: "Termín" },
  { kind: "chybi_polozka", label: "Chybí položka" },
  { kind: "polozka_navic", label: "Položka navíc" },
  { kind: "platebni_podminky", label: "Platební podmínky" },
  { kind: "jine", label: "Jiné" },
];

interface DraftItem { key: number; kind: OrderMismatchKind; label: string; quote: string; order: string }

export function MismatchEditDialog({
  open, onOpenChange, jobNumber, onConfirm,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  jobNumber: string;
  onConfirm: (items: OrderMismatch["items"]) => Promise<Result> | Result;
}) {
  const seq = React.useRef(0);
  const blank = (): DraftItem => ({ key: ++seq.current, kind: "mnozstvi", label: "", quote: "", order: "" });
  const [items, setItems] = React.useState<DraftItem[]>(() => [blank()]);
  const { pending, error, setError, run } = useRun(onOpenChange);
  const [wasOpen, setWasOpen] = React.useState(false);
  if (open !== wasOpen) {
    setWasOpen(open);
    if (open) { setItems([blank()]); setError(null); }
  }
  const patch = (key: number, p: Partial<DraftItem>) => setItems((l) => l.map((i) => (i.key === key ? { ...i, ...p } : i)));
  const valid = items.filter((i) => i.label.trim() || i.quote.trim() || i.order.trim());

  return (
    <Dialog open={open} onOpenChange={(o) => !pending && onOpenChange(o)}>
      <DialogContent aria-describedby={undefined} className={SHEET}>
        <DialogHead icon={GitCompare} tone="bg-rose-100 text-rose-700 dark:bg-rose-500/15 dark:text-rose-300" title={`Rozpor s nabídkou — ${jobNumber}`} subtitle="V čem se objednávka liší od nabídky? Zákazníka pak požádáš o opravu, nebo ji přijmeš, jak je." />
        <div className="space-y-3 p-4 sm:p-5">
          <ErrorBox error={error} />
          <ul className="space-y-3">
            {items.map((it, n) => (
              <li key={it.key} className="space-y-2 rounded-lg border p-3">
                <div className="flex items-center gap-2">
                  <label className="sr-only" htmlFor={`mm-kind-${it.key}`}>Druh rozdílu {n + 1}</label>
                  <select
                    id={`mm-kind-${it.key}`}
                    value={it.kind}
                    onChange={(e) => patch(it.key, { kind: e.target.value as OrderMismatchKind })}
                    className="h-11 flex-1 rounded-md border border-input bg-background px-2 text-sm sm:h-9"
                  >
                    {MISMATCH_KINDS.map((k) => <option key={k.kind} value={k.kind}>{k.label}</option>)}
                  </select>
                  {items.length > 1 && (
                    <Button type="button" size="icon" variant="ghost" className="h-11 w-11 sm:h-9 sm:w-9" aria-label={`Odebrat rozdíl ${n + 1}`} onClick={() => setItems((l) => l.filter((i) => i.key !== it.key))}>
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  )}
                </div>
                <Input value={it.label} onChange={(e) => patch(it.key, { label: e.target.value })} placeholder="Co se liší (např. Příruba VK-12)" aria-label={`Popis rozdílu ${n + 1}`} className="h-11 sm:h-9" maxLength={200} />
                <div className="grid grid-cols-2 gap-2">
                  <Input value={it.quote} onChange={(e) => patch(it.key, { quote: e.target.value })} placeholder="V nabídce" aria-label={`V nabídce ${n + 1}`} className="h-11 sm:h-9" maxLength={200} />
                  <Input value={it.order} onChange={(e) => patch(it.key, { order: e.target.value })} placeholder="V objednávce" aria-label={`V objednávce ${n + 1}`} className="h-11 sm:h-9" maxLength={200} />
                </div>
              </li>
            ))}
          </ul>
          <Button type="button" variant="outline" className="min-h-11 w-full sm:min-h-9" onClick={() => setItems((l) => [...l, blank()])}>
            <Plus className="h-4 w-4" /> Další rozdíl
          </Button>
          <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
            <Button type="button" variant="ghost" className="min-h-11 sm:min-h-9" onClick={() => onOpenChange(false)} disabled={Boolean(pending)}>Zpět</Button>
            <Button
              type="button"
              className="min-h-11 bg-rose-600 text-white hover:bg-rose-600/90 sm:min-h-9"
              disabled={!valid.length || Boolean(pending)}
              onClick={() => void run("save", () => onConfirm(valid.map((i) => ({
                kind: i.kind,
                label: i.label.trim() || MISMATCH_KINDS.find((k) => k.kind === i.kind)?.label || "Rozdíl",
                quote: i.quote.trim() || null,
                order: i.order.trim() || null,
              }))))}
            >
              {pending ? <Loader2 className="h-4 w-4 animate-spin" /> : <GitCompare className="h-4 w-4" />} Zapsat rozpor
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

// ── Rozpor s nabídkou: vyřešit ──────────────────────────────
export function ResolveMismatchDialog({
  open, onOpenChange, jobNumber, mismatch, fixRequested, onAccept, onFixed, onRequestFix,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  jobNumber: string;
  mismatch: OrderMismatch | null;
  /** Kdy jsme zákazníka požádali o opravu. */
  fixRequested?: string | null;
  /** Přijmout, jak je → potvrzení (otevře dialog potvrzení). */
  onAccept: () => void;
  /** Přišla opravená objednávka → Doručená. */
  onFixed: () => Promise<Result> | Result;
  onRequestFix: (note: string | null) => Promise<Result> | Result;
}) {
  const [note, setNote] = React.useState("");
  const { pending, error, setError, run } = useRun(onOpenChange);
  const [wasOpen, setWasOpen] = React.useState(false);
  if (open !== wasOpen) {
    setWasOpen(open);
    if (open) { setNote(""); setError(null); }
  }
  return (
    <Dialog open={open} onOpenChange={(o) => !pending && onOpenChange(o)}>
      <DialogContent aria-describedby={undefined} className={SHEET}>
        <DialogHead icon={GitCompare} tone="bg-rose-100 text-rose-700 dark:bg-rose-500/15 dark:text-rose-300" title={`Vyřešit rozpor — ${jobNumber}`} subtitle={mismatch?.source === "ai" ? <span className="inline-flex items-center gap-1"><Sparkles className="h-3.5 w-3.5" aria-hidden /> Rozdíly našla AI — zkontroluj je.</span> : undefined} />
        <div className="space-y-3 p-4 sm:p-5">
          <ErrorBox error={error} />
          {mismatch?.items?.length ? <MismatchList items={mismatch.items} /> : <p className="text-sm text-muted-foreground">Rozdíly nejsou vypsané.</p>}
          {fixRequested && <p className="text-xs text-muted-foreground">O opravu jsme požádali {czDay(fixRequested.slice(0, 10))}.</p>}
          <div className="grid gap-2">
            <Button type="button" className="min-h-11 justify-start bg-indigo-600 text-white hover:bg-indigo-600/90 sm:min-h-10" disabled={Boolean(pending)} onClick={() => { onOpenChange(false); onAccept(); }}>
              <BadgeCheck className="h-4 w-4" /> Přijmout, jak je — potvrdit objednávku
            </Button>
            <Button type="button" variant="outline" className="min-h-11 justify-start sm:min-h-10" disabled={Boolean(pending)} onClick={() => void run("fixed", onFixed)}>
              {pending === "fixed" ? <Loader2 className="h-4 w-4 animate-spin" /> : <RotateCcw className="h-4 w-4" />} Přišla opravená objednávka
            </Button>
          </div>
          <div className="space-y-1.5 rounded-lg border p-3">
            <label htmlFor="fix-note" className="text-xs font-medium text-muted-foreground">Požádat zákazníka o opravu (poznámka, nepovinná)</label>
            <Textarea id="fix-note" rows={2} value={note} onChange={(e) => setNote(e.target.value)} maxLength={500} placeholder="Např. prosíme o opravu ceny podle nabídky NAB-…" />
            <Button type="button" variant="outline" className="min-h-11 w-full sm:min-h-9" disabled={Boolean(pending)} onClick={() => void run("fix", () => onRequestFix(note.trim() || null))}>
              {pending === "fix" ? <Loader2 className="h-4 w-4 animate-spin" /> : <Mail className="h-4 w-4" />} Požádat o opravu
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

// ── Změna potvrzené objednávky: rozhodnout ───────────────────
export function DecideChangeDialog({
  open, onOpenChange, jobNumber, revision, stamp, onAccept, onReject,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  jobNumber: string;
  revision: OrderRevisionView | null;
  stamp?: ChangeStamp | null;
  onAccept: () => Promise<Result> | Result;
  onReject: (note: string) => Promise<Result> | Result;
}) {
  const [rejecting, setRejecting] = React.useState(false);
  const [note, setNote] = React.useState("");
  const { pending, error, setError, run } = useRun(onOpenChange);
  const [wasOpen, setWasOpen] = React.useState(false);
  if (open !== wasOpen) {
    setWasOpen(open);
    if (open) { setRejecting(false); setNote(""); setError(null); }
  }
  const who = stamp ? actorName(stamp) : revision ? actorName(revision.created) : null;
  return (
    <Dialog open={open} onOpenChange={(o) => !pending && onOpenChange(o)}>
      <DialogContent aria-describedby={undefined} className={SHEET}>
        <DialogHead
          icon={GitCompare}
          tone="bg-indigo-100 text-indigo-700 dark:bg-indigo-500/15 dark:text-indigo-300"
          title={`Změna objednávky ${jobNumber}${revision ? ` (rev ${revision.revision})` : ""}`}
          subtitle={who ? `Zápis změny · ${who}` : undefined}
        />
        <div className="space-y-3 p-4 sm:p-5">
          <ErrorBox error={error} />
          {revision ? <RevisionDiff revision={revision} /> : <p className="text-sm text-muted-foreground">Zákazník poslal změnu potvrzené objednávky.</p>}
          <p className="text-xs text-muted-foreground">Položky zakázky se samy nepřepisují — po potvrzení změny je uprav v kartě zakázky a pošli nové potvrzení.</p>
          {rejecting ? (
            <div className="space-y-2">
              <label htmlFor="reject-change" className="text-xs font-medium text-muted-foreground">Proč změnu nepřijímáme (povinné)</label>
              <Textarea id="reject-change" rows={2} value={note} onChange={(e) => setNote(e.target.value)} maxLength={500} autoFocus placeholder="Např. materiál už je nařezaný, termín nejde zkrátit…" />
              <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
                <Button type="button" variant="ghost" className="min-h-11 sm:min-h-9" onClick={() => setRejecting(false)} disabled={Boolean(pending)}>Zpět</Button>
                <Button type="button" variant="destructive" className="min-h-11 sm:min-h-9" disabled={!note.trim() || Boolean(pending)} onClick={() => void run("reject", () => onReject(note.trim()))}>
                  {pending === "reject" ? <Loader2 className="h-4 w-4 animate-spin" /> : <CircleX className="h-4 w-4" />} Změnu nepřijímáme
                </Button>
              </div>
            </div>
          ) : (
            <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
              <Button type="button" variant="outline" className="min-h-11 sm:min-h-9" onClick={() => setRejecting(true)} disabled={Boolean(pending)}>
                <CircleX className="h-4 w-4" /> Změnu nepřijímáme…
              </Button>
              <Button type="button" className="min-h-11 bg-indigo-600 text-white hover:bg-indigo-600/90 sm:min-h-9" disabled={Boolean(pending)} onClick={() => void run("accept", onAccept)}>
                {pending === "accept" ? <Loader2 className="h-4 w-4 animate-spin" /> : <BadgeCheck className="h-4 w-4" />} Potvrdit změnu
              </Button>
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}

// ── Nabídka: prodloužit platnost ────────────────────────────
export function ExtendQuoteDialog({
  open, onOpenChange, quoteNumber, validUntil, today, onConfirm,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  quoteNumber: string;
  validUntil: string | null;
  today: string;
  onConfirm: (date: string) => Promise<Result> | Result;
}) {
  const [date, setDate] = React.useState(addDaysIso(today, 14));
  const { pending, error, setError, run } = useRun(onOpenChange);
  const [wasOpen, setWasOpen] = React.useState(false);
  if (open !== wasOpen) {
    setWasOpen(open);
    if (open) { setDate(addDaysIso(today, 14)); setError(null); }
  }
  return (
    <Dialog open={open} onOpenChange={(o) => !pending && onOpenChange(o)}>
      <DialogContent aria-describedby={undefined} className={SHEET}>
        <DialogHead icon={CalendarPlus} tone="bg-violet-100 text-violet-700 dark:bg-violet-500/15 dark:text-violet-300" title={`Prodloužit platnost ${quoteNumber}`} subtitle={validUntil ? `Dosud platná do ${czDay(validUntil)}.` : undefined} />
        <form className="space-y-3 p-4 sm:p-5" onSubmit={(e) => { e.preventDefault(); void run("save", () => onConfirm(date)); }}>
          <ErrorBox error={error} />
          <label className="block space-y-1">
            <span className="text-xs font-medium text-muted-foreground">Platná do</span>
            <Input type="date" value={date} min={today} onChange={(e) => setDate(e.target.value)} className="h-11 sm:h-10" autoFocus />
          </label>
          <div className="flex flex-wrap gap-2">
            {[7, 14, 30].map((d) => (
              <Button key={d} type="button" size="sm" variant="outline" className="min-h-10 sm:min-h-8" onClick={() => setDate(addDaysIso(today, d))}>+{d} dní</Button>
            ))}
          </div>
          <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
            <Button type="button" variant="ghost" className="min-h-11 sm:min-h-9" onClick={() => onOpenChange(false)} disabled={Boolean(pending)}>Zpět</Button>
            <Button type="submit" className="min-h-11 bg-violet-600 text-white hover:bg-violet-600/90 sm:min-h-9" disabled={!date || date < today || Boolean(pending)}>
              {pending ? <Loader2 className="h-4 w-4 animate-spin" /> : <CalendarPlus className="h-4 w-4" />} Prodloužit
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}

// ── Návrh změny: rozhodnout ─────────────────────────────────
export function ProposalDecisionDialog({
  open, onOpenChange, proposal, stamp, onDecide,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  proposal: FlowProposal | null;
  stamp?: ChangeStamp | null;
  onDecide: (accept: boolean) => Promise<Result> | Result;
}) {
  const { pending, error, setError, run } = useRun(onOpenChange);
  const [wasOpen, setWasOpen] = React.useState(false);
  if (open !== wasOpen) {
    setWasOpen(open);
    if (open) setError(null);
  }
  if (!proposal) return null;
  const Icon = proposal.kind === "ai" ? Sparkles : Hand;
  const who = stamp ? actorName(stamp) : proposal.kind === "ai" ? "✨ AI" : "neznámý účet";
  return (
    <Dialog open={open} onOpenChange={(o) => !pending && onOpenChange(o)}>
      <DialogContent aria-describedby={undefined} className={SHEET}>
        <DialogHead icon={Icon} tone="bg-muted text-muted-foreground" title={`Návrh: ${proposal.label}`} subtitle={`Návrh · ${who}`} />
        <div className="space-y-3 p-4 sm:p-5">
          <ErrorBox error={error} />
          {proposal.reason && <p className="text-sm"><span className="text-muted-foreground">Důvod:</span> {lostReasonLabel(proposal.reason)}</p>}
          {proposal.note && <p className="whitespace-pre-wrap rounded-lg bg-muted/60 p-3 text-sm">{proposal.note}</p>}
          {typeof proposal.confidence === "number" && (
            <p className="text-xs text-muted-foreground">Jistota AI {Math.round(proposal.confidence * 100)} %</p>
          )}
          <p className="text-xs text-muted-foreground">Po přijetí se změna provede s poznámkou „na návrh: {who}“; obě rozhodnutí se zapíšou do historie s tvým jménem.</p>
          <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
            <Button type="button" variant="outline" className="min-h-11 sm:min-h-9" disabled={Boolean(pending)} onClick={() => void run("no", () => onDecide(false))}>
              {pending === "no" ? <Loader2 className="h-4 w-4 animate-spin" /> : <X className="h-4 w-4" />} Zamítnout návrh
            </Button>
            <Button type="button" className="min-h-11 sm:min-h-9" disabled={Boolean(pending)} onClick={() => void run("yes", () => onDecide(true))}>
              {pending === "yes" ? <Loader2 className="h-4 w-4 animate-spin" /> : <Check className="h-4 w-4" />} Přijmout návrh
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
