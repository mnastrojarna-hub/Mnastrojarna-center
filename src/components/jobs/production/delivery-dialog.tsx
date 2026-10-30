"use client";

import * as React from "react";
import { Check, CircleDotDashed, FileText, ListPlus, Loader2, PackageCheck, Pencil, RotateCcw, Truck } from "lucide-react";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { ProgressPill } from "@/components/flow-status/progress-pill";
import { DialogHead, ErrorBox } from "@/components/jobs/detail/confirm-dialog";
import { formatQty, parseDecimal } from "@/components/jobs/detail/detail-helpers";
import { closeItemDelivery, moveJobStage, recordPartialDelivery, setDeliveredQuantities } from "@/app/actions/flow-status";
import { recordDelivery } from "@/app/actions/delivery-notes";
import { generateJobDocument } from "@/app/actions/job-documents";
import type { JobItem } from "@/lib/jobs/types";
import { czPlural } from "@/lib/jobs/flow-status";
import { qtyInput, remainingQty, round3, type DeliveryRowInput } from "@/lib/jobs/delivery-notes";
import { cn } from "@/lib/utils";
import { DeliveryNoteResult, type IssuedNote } from "./delivery-note-result";

type Item = Pick<JobItem, "id" | "drawingNumber" | "name" | "description" | "quantity" | "unit" | "deliveredQuantity" | "deliveryClosed" | "deliveryClosedReason">;

function itemLabel(i: Item): string {
  return (i.name ?? "").trim() || (i.drawingNumber ?? "").trim() || (i.description ?? "").trim() || "Položka";
}

function itemDone(i: Item): boolean {
  return Boolean(i.deliveryClosed) || (i.deliveredQuantity ?? 0) >= i.quantity;
}

/** „2/3 položek" — po položkách, nikdy součet kusů různých dílů (M4). */
export function deliveredSummary(items: Item[]): { done: number; total: number; label: string; pct: number } {
  const done = items.filter(itemDone).length;
  const total = items.length;
  return { done, total, label: `${done}/${total} ${czPlural(total, "položky", "položek", "položek")}`, pct: total ? Math.round((done / total) * 100) : 0 };
}

/** Řádky dodávky z formuláře „Dodávám teď" (prázdné / 0 se vynechá). Vrací chybu jako text. */
export function rowsFromNow(items: Item[], values: Record<string, string>): DeliveryRowInput[] | string {
  const rows: DeliveryRowInput[] = [];
  for (const i of items) {
    if (i.deliveryClosed) continue;
    const raw = (values[i.id] ?? "").trim();
    if (!raw) continue;
    const n = parseDecimal(raw);
    if (n === null || n < 0) return `${itemLabel(i)}: zadej množství číslem.`;
    if (n === 0) continue;
    const from = round3(i.deliveredQuantity ?? 0);
    rows.push({ itemId: i.id, from, to: round3(from + n) });
  }
  return rows;
}

type View = "record" | "correct" | "closeShort" | "partialNote" | "result" | "noteFailed";

/**
 * Zapsat dodání zákazníkovi po položkách „Dodávám teď" (předvyplněno celým zbytkem — dílčí dodávku
 * uživatel jen sníží) + dodací list TÉTO dodávky (zaškrtnuto „Vystavit dodací list" — vlastní číslo
 * DL, jen dodané množství, bez cen) → výsledek: Stáhnout PDF, Vytisknout, Poslat zákazníkovi. Když
 * DL selže, dodání zůstane zapsané a dialog nabídne „Vystavit dodací list znovu" (stejné číslo). Při 100 % posune zakázku na Dodáno zákazníkovi DB. Dál uzavřít
 * položku s menším množstvím, opravit zapsané množství (bez DL), u zakázky bez položek částečná
 * dodávka / dodáno vše (s DL celé zakázky).
 */
export function DeliveryDialog({
  open, onOpenChange, jobId, items, mode = "record", prefill, onDone, onSplitItems,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  jobId: string;
  items: Item[];
  mode?: "record" | "closeShort" | "partialNote";
  /** Předvyplnění „Dodávám teď": celý zbytek (výchozí — AI/systém vyplní, člověk koriguje) nebo prázdné. */
  prefill?: "remaining" | "empty";
  onDone?: (message: string) => void;
  /** Zakázka bez položek → „Rozepsat na položky" (záložka Položky). */
  onSplitItems?: () => void;
}) {
  const [values, setValues] = React.useState<Record<string, string>>({});
  const [totals, setTotals] = React.useState<Record<string, string>>({});
  const [note, setNote] = React.useState("");
  const [issue, setIssue] = React.useState(true);
  const [closeId, setCloseId] = React.useState<string | null>(null);
  const [view, setView] = React.useState<View>(mode);
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  // DL selhal po zapsaném dodání → „Vystavit dodací list znovu" (stejné číslo, jen DL)
  const [retry, setRetry] = React.useState<{ id: string | null; number: string | null; rows: DeliveryRowInput[] } | null>(null);
  const [issued, setIssued] = React.useState<IssuedNote | null>(null);
  // po vystavení DL zůstává dialog s výsledkem; oznámení + obnovení stránky až při zavření
  const pendingDone = React.useRef<string | null>(null);
  const noteId = React.useId();
  const issueId = React.useId();

  // stav se nastaví jen při otevření — obnovení stránky po zápisu (nové položky) výsledek nesmaže
  const [wasOpen, setWasOpen] = React.useState(false);
  if (open !== wasOpen) {
    setWasOpen(open);
    if (open) {
      const rest = Object.fromEntries(items.map((i) => [i.id, prefill !== "empty" && !i.deliveryClosed && remainingQty(i) > 0 ? qtyInput(remainingQty(i)) : ""]));
      setValues(rest);
      setTotals(Object.fromEntries(items.map((i) => [i.id, qtyInput(i.deliveredQuantity ?? 0)])));
      setNote("");
      setIssue(true);
      setError(null);
      setRetry(null);
      setIssued(null);
      pendingDone.current = null;
      setView(items.length ? (mode === "partialNote" ? "record" : mode) : "partialNote");
      setCloseId(items.find((i) => !itemDone(i))?.id ?? null);
    }
  }

  function close() {
    const message = pendingDone.current;
    pendingDone.current = null;
    if (message) onDone?.(message);
    onOpenChange(false);
  }

  const open_ = items.filter((i) => !i.deliveryClosed);
  const summary = deliveredSummary(items);

  async function run(fn: () => Promise<{ ok: boolean; error?: string }>, message: string) {
    setBusy(true);
    setError(null);
    try {
      const res = await fn();
      if (!res.ok) return setError(res.error ?? "Uložení se nepovedlo.");
      onDone?.(message);
      onOpenChange(false);
    } catch {
      setError("Spojení se nepovedlo — zkus to znovu.");
    } finally {
      setBusy(false);
    }
  }

  async function submitDelivery(rows: DeliveryRowInput[], again: { id: string | null } | null) {
    setBusy(true);
    setError(null);
    try {
      const res = await recordDelivery(jobId, rows, {
        note: note.trim() || null, issueNote: again ? true : issue, retryId: again?.id ?? null, reissue: Boolean(again),
      });
      if (!res.ok) {
        setError(res.error ?? "Uložení se nepovedlo.");
        if (res.recorded || again) {
          // dodání je zapsané — formulář už nejde poslat znovu, jen vystavit DL (nebo zavřít)
          pendingDone.current = "Dodání zapsáno — dodací list se nevystavil.";
          setRetry(res.retry ? { ...res.retry, rows } : null);
          setView("noteFailed");
        }
        return;
      }
      setRetry(null);
      const dn = res.deliveryNote;
      if (dn) {
        setIssued({ number: dn.number, fileId: dn.fileId, filename: dn.filename, label: dn.label, final: dn.final });
        setView("result");
        pendingDone.current = `Dodání zapsáno · dodací list ${dn.number} vystaven.`;
        return;
      }
      onDone?.("Dodání zapsáno.");
      onOpenChange(false);
    } catch {
      setError("Spojení se nepovedlo — zkus to znovu.");
    } finally {
      setBusy(false);
    }
  }

  function saveDelivery(e: React.FormEvent) {
    e.preventDefault();
    if (busy) return;
    const rows = rowsFromNow(items, values);
    if (typeof rows === "string") return setError(rows);
    if (!rows.length) return setError("Zadej, kolik se dodává teď (u položky „Vše“ = celý zbytek).");
    void submitDelivery(rows, null);
  }

  function saveTotals(e: React.FormEvent) {
    e.preventDefault();
    const rows: { itemId: string; delivered: number }[] = [];
    for (const i of open_) {
      const raw = totals[i.id] ?? "";
      const n = raw.trim() === "" ? 0 : parseDecimal(raw);
      if (n === null || n < 0) return setError(`${itemLabel(i)}: zadej množství číslem.`);
      if (n !== (i.deliveredQuantity ?? 0)) rows.push({ itemId: i.id, delivered: n });
    }
    if (!rows.length) return setError("Nic se nezměnilo.");
    void run(() => setDeliveredQuantities(jobId, rows, { note: note.trim() || null }), "Zapsané množství opraveno.");
  }

  function saveClose(e: React.FormEvent) {
    e.preventDefault();
    if (!closeId) return setError("Vyber položku.");
    if (!note.trim()) return setError("Napiš, proč se položka uzavírá s menším množstvím.");
    void run(() => closeItemDelivery(jobId, closeId, { reason: note.trim() }), "Položka uzavřena s menším množstvím.");
  }

  /** Zakázka bez položek: Dodáno vše (+ DL celé zakázky). */
  async function deliverAllNoItems() {
    setBusy(true);
    setError(null);
    try {
      const res = await moveJobStage(jobId, "dodano_zakaznikovi", { note: note.trim() || "dodáno vše" });
      if (!res.ok) return setError(res.error ?? "Uložení se nepovedlo.");
      if (!issue) {
        onDone?.("Dodáno vše ✓");
        onOpenChange(false);
        return;
      }
      const dl = await generateJobDocument(jobId, "dodaci_list", note.trim() ? { note: note.trim() } : undefined);
      if (!dl.ok || !dl.fileId) {
        onDone?.("Dodáno vše ✓");
        setError(`Dodání je zapsané, ale dodací list se nepodařilo vystavit: ${dl.error ?? "neznámá chyba"} Vystav ho v Doklady → Dodací list.`);
        return;
      }
      setIssued({ number: dl.number ?? "", fileId: dl.fileId, filename: dl.filename ?? "Dodaci_list.pdf", final: true });
      setView("result");
      pendingDone.current = `Dodáno vše · dodací list ${dl.number} vystaven.`;
    } catch {
      setError("Spojení se nepovedlo — zkus to znovu.");
    } finally {
      setBusy(false);
    }
  }

  const nowRows = rowsFromNow(items, values);
  const nowCount = typeof nowRows === "string" ? 0 : nowRows.length;
  const title = view === "result" || view === "noteFailed" ? "Dodání zapsáno"
    : view === "closeShort" ? "Uzavřít s menším množstvím"
    : view === "correct" ? "Opravit zapsané množství"
    : items.length ? "Zapsat dodání zákazníkovi" : "Dodání zakázky bez položek";
  const submitLabel = issue ? "Zapsat dodání a dodací list" : "Zapsat dodání";

  const issueToggle = (
    <label htmlFor={issueId} className="flex min-h-11 cursor-pointer items-start gap-2.5 rounded-lg border bg-muted/30 px-3 py-2 text-sm">
      <input
        id={issueId}
        type="checkbox"
        checked={issue}
        onChange={(e) => setIssue(e.target.checked)}
        disabled={busy}
        className="mt-0.5 h-4 w-4 shrink-0 accent-green-600"
      />
      <span className="min-w-0">
        <span className="flex items-center gap-1.5 font-medium"><FileText className="h-4 w-4 text-green-600 dark:text-green-400" /> Vystavit dodací list</span>
        <span className="block text-xs text-muted-foreground">
          {items.length
            ? "Vlastní číslo DL, jen to, co odchází teď, bez cen — hned ho stáhneš, vytiskneš nebo pošleš."
            : "DL celé zakázky (bez cen) — hned ho stáhneš, vytiskneš nebo pošleš."}
        </span>
      </span>
    </label>
  );

  return (
    <Dialog open={open} onOpenChange={(o) => { if (busy) return; if (o) onOpenChange(o); else close(); }}>
      <DialogContent aria-describedby={undefined} className="top-[3%] max-h-[94dvh] w-[calc(100%-1rem)] overflow-y-auto sm:top-[8%] sm:max-w-xl" data-testid="delivery-dialog">
        <DialogHead
          icon={view === "closeShort" ? PackageCheck : view === "correct" ? Pencil : Truck}
          tone="bg-green-100 text-green-700 dark:bg-green-500/15 dark:text-green-300"
          title={title}
          subtitle={items.length ? <span className="inline-flex items-center gap-2">Dodáno <ProgressPill progress={summary} hue="green" /></span> : "Částečná dodávka se zapíše poznámkou."}
        />
        <div className="space-y-4 p-4 sm:p-5">
          <ErrorBox error={error} />
          {view === "noteFailed" && (
            <div className="flex flex-col gap-2 sm:flex-row" data-testid="delivery-note-retry">
              {retry && (
                <Button type="button" variant="success" className="h-11 sm:h-10" disabled={busy} onClick={() => void submitDelivery(retry.rows, { id: retry.id })}>
                  {busy ? <Loader2 className="animate-spin" /> : <RotateCcw />} Vystavit dodací list znovu{retry.number ? ` (${retry.number})` : ""}
                </Button>
              )}
              <Button type="button" variant="outline" className="h-11 sm:h-10" disabled={busy} onClick={close}>Zavřít</Button>
            </div>
          )}

          {view === "result" && issued && (
            <DeliveryNoteResult jobId={jobId} note={issued} onClose={close} />
          )}

          {!items.length && view !== "result" && (
            <div className="space-y-3">
              <label htmlFor={noteId} className="block text-xs font-medium text-muted-foreground">Co se dodalo (pro částečnou dodávku)</label>
              <Textarea id={noteId} rows={3} value={note} onChange={(e) => setNote(e.target.value)} placeholder="např. 1. část — 50 ks, zbytek do 14 dní" maxLength={500} />
              {issueToggle}
              <div className="grid gap-2 sm:grid-cols-3">
                <Button type="button" variant="outline" className="h-11" disabled={busy || !note.trim()}
                  onClick={() => void run(() => recordPartialDelivery(jobId, { note: note.trim() }), "Částečná dodávka zapsána.")}>
                  <CircleDotDashed className="text-green-600" /> Částečná dodávka
                </Button>
                <Button type="button" variant="success" className="h-11" disabled={busy} onClick={() => void deliverAllNoItems()}>
                  {busy ? <Loader2 className="animate-spin" /> : <Check />} Dodáno vše
                </Button>
                {onSplitItems && (
                  <Button type="button" variant="ghost" className="h-11" disabled={busy} onClick={() => { onOpenChange(false); onSplitItems(); }}>
                    <ListPlus /> Rozepsat na položky
                  </Button>
                )}
              </div>
            </div>
          )}

          {items.length > 0 && view === "record" && (
            <form onSubmit={saveDelivery} className="space-y-3">
              <div className="flex items-center justify-between gap-2">
                <p className="text-xs text-muted-foreground">Předvyplněn celý zbytek — u dílčí dodávky jen sniž. Při 100 % se zakázka posune sama.</p>
                <Button type="button" size="sm" variant="outline" disabled={busy}
                  onClick={() => setValues((v) => ({ ...v, ...Object.fromEntries(open_.map((i) => [i.id, remainingQty(i) > 0 ? qtyInput(remainingQty(i)) : ""])) }))}>
                  Dodat vše
                </Button>
              </div>
              <ul className="divide-y rounded-lg border">
                {items.map((i) => {
                  const done = itemDone(i);
                  const rest = remainingQty(i);
                  return (
                    <li key={i.id} className={cn("flex flex-wrap items-center gap-2 px-3 py-2", (i.deliveryClosed || done) && "bg-muted/40")}>
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-sm font-medium">{itemLabel(i)}</p>
                        <p className="text-[11px] text-muted-foreground">
                          {i.drawingNumber && <span className="font-mono">{i.drawingNumber} · </span>}
                          objednáno {formatQty(i.quantity)} {i.unit} · dodáno {formatQty(i.deliveredQuantity ?? 0)}
                          {!done && <> · zbývá {formatQty(rest)}</>}
                          {i.deliveryClosed && <> · uzavřeno{i.deliveryClosedReason ? ` (${i.deliveryClosedReason})` : ""}</>}
                        </p>
                      </div>
                      {i.deliveryClosed || done ? (
                        <span className="inline-flex items-center gap-1 text-xs font-medium text-green-700 dark:text-green-400"><Check className="h-3.5 w-3.5" /> {i.deliveryClosed ? "uzavřeno" : "dodáno"}</span>
                      ) : (
                        <div className="flex items-center gap-1">
                          <Input
                            inputMode="decimal"
                            aria-label={`Dodávám teď — ${itemLabel(i)}`}
                            placeholder="0"
                            value={values[i.id] ?? ""}
                            onChange={(e) => setValues((v) => ({ ...v, [i.id]: e.target.value }))}
                            className="h-10 w-24 text-right tabular-nums"
                          />
                          <span className="w-8 text-xs text-muted-foreground">{i.unit}</span>
                          <Button type="button" size="sm" variant="outline" className="h-10"
                            onClick={() => setValues((v) => ({ ...v, [i.id]: qtyInput(rest) }))} aria-label={`Vše — ${itemLabel(i)}`}>
                            Vše
                          </Button>
                        </div>
                      )}
                    </li>
                  );
                })}
              </ul>
              <div className="space-y-1">
                <label htmlFor={noteId} className="block text-xs font-medium text-muted-foreground">Poznámka (nepovinná{issue ? " — bude na dodacím listu" : ""})</label>
                <Input id={noteId} value={note} onChange={(e) => setNote(e.target.value)} maxLength={500} placeholder="např. osobní odběr, 2 palety" className="h-10" />
              </div>
              {issueToggle}
              <Button type="submit" variant="success" className="h-11 w-full" disabled={busy}>
                {busy ? <Loader2 className="animate-spin" /> : <Truck />} {submitLabel}
                {nowCount > 0 && (
                  <span className="rounded bg-white/20 px-1.5 text-xs tabular-nums" aria-hidden>
                    {nowCount} {czPlural(nowCount, "položka", "položky", "položek")}
                  </span>
                )}
              </Button>
              <div className="flex flex-wrap gap-x-1 gap-y-0">
                <Button type="button" variant="ghost" size="sm" className="h-10 text-muted-foreground" disabled={busy || !open_.some((i) => !itemDone(i))} onClick={() => { setView("closeShort"); setNote(""); setError(null); }}>
                  <PackageCheck /> Uzavřít s menším množstvím…
                </Button>
                <Button type="button" variant="ghost" size="sm" className="h-10 text-muted-foreground" disabled={busy} onClick={() => { setView("correct"); setError(null); }}>
                  <Pencil /> Opravit zapsané…
                </Button>
              </div>
            </form>
          )}

          {items.length > 0 && view === "correct" && (
            <form onSubmit={saveTotals} className="space-y-3">
              <p className="text-xs text-muted-foreground">Oprava překlepu: zadej celkem dodané množství. Dodací list se nevystaví.</p>
              <ul className="divide-y rounded-lg border">
                {open_.map((i) => (
                  <li key={i.id} className="flex flex-wrap items-center gap-2 px-3 py-2">
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-medium">{itemLabel(i)}</p>
                      <p className="text-[11px] text-muted-foreground">objednáno {formatQty(i.quantity)} {i.unit}</p>
                    </div>
                    <Input
                      inputMode="decimal"
                      aria-label={`Dodáno celkem — ${itemLabel(i)}`}
                      value={totals[i.id] ?? ""}
                      onChange={(e) => setTotals((v) => ({ ...v, [i.id]: e.target.value }))}
                      className="h-10 w-24 text-right tabular-nums"
                    />
                    <span className="w-8 text-xs text-muted-foreground">{i.unit}</span>
                  </li>
                ))}
              </ul>
              <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
                <Button type="button" variant="ghost" className="h-11 sm:h-9" onClick={() => setView("record")} disabled={busy}>Zpět</Button>
                <Button type="submit" variant="outline" className="h-11 sm:h-9" disabled={busy}>
                  {busy ? <Loader2 className="animate-spin" /> : <Pencil />} Uložit opravu
                </Button>
              </div>
            </form>
          )}

          {items.length > 0 && view === "closeShort" && (
            <form onSubmit={saveClose} className="space-y-3">
              <div role="radiogroup" aria-label="Položka" className="space-y-1.5">
                {open_.filter((i) => !itemDone(i)).map((i) => (
                  <button
                    key={i.id}
                    type="button"
                    role="radio"
                    aria-checked={closeId === i.id}
                    onClick={() => setCloseId(i.id)}
                    className={cn(
                      "flex min-h-11 w-full items-center justify-between gap-2 rounded-lg border px-3 py-2 text-left text-sm",
                      closeId === i.id ? "border-foreground bg-foreground text-background" : "hover:bg-accent",
                    )}
                  >
                    <span className="truncate">{itemLabel(i)}</span>
                    <span className="shrink-0 tabular-nums opacity-80">{formatQty(i.deliveredQuantity ?? 0)}/{formatQty(i.quantity)} {i.unit}</span>
                  </button>
                ))}
              </div>
              <div className="space-y-1">
                <label htmlFor={noteId} className="block text-xs font-medium text-muted-foreground">Proč méně (povinné)</label>
                <Textarea id={noteId} rows={2} value={note} onChange={(e) => setNote(e.target.value)} maxLength={500} placeholder="např. 2 ks zmetky, zákazník přijal 98 ks" />
              </div>
              <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
                <Button type="button" variant="ghost" className="h-11 sm:h-9" onClick={() => setView("record")} disabled={busy}>Zpět</Button>
                <Button type="submit" variant="success" className="h-11 sm:h-9" disabled={busy || !closeId || !note.trim()}>
                  {busy ? <Loader2 className="animate-spin" /> : <PackageCheck />} Uzavřít položku
                </Button>
              </div>
            </form>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
