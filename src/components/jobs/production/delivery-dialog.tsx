"use client";

import * as React from "react";
import { Check, CircleDotDashed, ListPlus, Loader2, PackageCheck, Truck } from "lucide-react";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { ProgressPill } from "@/components/flow-status/progress-pill";
import { DialogHead, ErrorBox } from "@/components/jobs/detail/confirm-dialog";
import { formatQty, parseDecimal } from "@/components/jobs/detail/detail-helpers";
import { closeItemDelivery, moveJobStage, recordPartialDelivery, setDeliveredQuantities } from "@/app/actions/flow-status";
import type { JobItem } from "@/lib/jobs/types";
import { czPlural } from "@/lib/jobs/flow-status";
import { cn } from "@/lib/utils";

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

/**
 * Zapsat dodání zákazníkovi po položkách (DB při 100 % posune zakázku na Dodáno zákazníkovi),
 * uzavřít položku s menším množstvím, nebo u zakázky bez položek částečná dodávka / dodáno vše.
 */
export function DeliveryDialog({
  open, onOpenChange, jobId, items, mode = "record", onDone, onSplitItems,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  jobId: string;
  items: Item[];
  mode?: "record" | "closeShort" | "partialNote";
  onDone?: (message: string) => void;
  /** Zakázka bez položek → „Rozepsat na položky" (záložka Položky). */
  onSplitItems?: () => void;
}) {
  const [values, setValues] = React.useState<Record<string, string>>({});
  const [note, setNote] = React.useState("");
  const [closeId, setCloseId] = React.useState<string | null>(null);
  const [view, setView] = React.useState(mode);
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const noteId = React.useId();

  React.useEffect(() => {
    if (!open) return;
    setValues(Object.fromEntries(items.map((i) => [i.id, String(i.deliveredQuantity ?? 0)])));
    setNote("");
    setError(null);
    setView(items.length ? mode : mode === "closeShort" ? "record" : mode);
    setCloseId(items.find((i) => !itemDone(i))?.id ?? null);
  }, [open, items, mode]);

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

  function saveDelivered(e: React.FormEvent) {
    e.preventDefault();
    const rows: { itemId: string; delivered: number }[] = [];
    for (const i of open_) {
      const raw = values[i.id] ?? "";
      const n = raw.trim() === "" ? 0 : parseDecimal(raw);
      if (n === null || n < 0) return setError(`${itemLabel(i)}: zadej množství číslem.`);
      if (n !== (i.deliveredQuantity ?? 0)) rows.push({ itemId: i.id, delivered: n });
    }
    if (!rows.length) return setError("Nic se nezměnilo — zadej, kolik se dodalo.");
    void run(() => setDeliveredQuantities(jobId, rows, { note: note.trim() || null }), "Dodání zapsáno.");
  }

  function saveClose(e: React.FormEvent) {
    e.preventDefault();
    if (!closeId) return setError("Vyber položku.");
    if (!note.trim()) return setError("Napiš, proč se položka uzavírá s menším množstvím.");
    void run(() => closeItemDelivery(jobId, closeId, { reason: note.trim() }), "Položka uzavřena s menším množstvím.");
  }

  const title = view === "closeShort" ? "Uzavřít s menším množstvím" : items.length ? "Zapsat dodání zákazníkovi" : "Dodání zakázky bez položek";

  return (
    <Dialog open={open} onOpenChange={(o) => !busy && onOpenChange(o)}>
      <DialogContent aria-describedby={undefined} className="top-[3%] max-h-[94dvh] w-[calc(100%-1rem)] overflow-y-auto sm:top-[8%] sm:max-w-xl">
        <DialogHead
          icon={view === "closeShort" ? PackageCheck : Truck}
          tone="bg-green-100 text-green-700 dark:bg-green-500/15 dark:text-green-300"
          title={title}
          subtitle={items.length ? <span className="inline-flex items-center gap-2">Dodáno <ProgressPill progress={summary} hue="green" /></span> : "Částečná dodávka se zapíše poznámkou."}
        />
        <div className="space-y-4 p-4 sm:p-5">
          <ErrorBox error={error} />

          {!items.length && (
            <div className="space-y-3">
              <label htmlFor={noteId} className="block text-xs font-medium text-muted-foreground">Co se dodalo (pro částečnou dodávku)</label>
              <Textarea id={noteId} rows={3} value={note} onChange={(e) => setNote(e.target.value)} placeholder="např. 1. část — 50 ks, zbytek do 14 dní" maxLength={500} />
              <div className="grid gap-2 sm:grid-cols-3">
                <Button type="button" variant="outline" className="h-11" disabled={busy || !note.trim()}
                  onClick={() => void run(() => recordPartialDelivery(jobId, { note: note.trim() }), "Částečná dodávka zapsána.")}>
                  <CircleDotDashed className="text-green-600" /> Částečná dodávka
                </Button>
                <Button type="button" variant="success" className="h-11" disabled={busy}
                  onClick={() => void run(() => moveJobStage(jobId, "dodano_zakaznikovi", { note: note.trim() || "dodáno vše" }), "Dodáno vše ✓")}>
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

          {items.length > 0 && view !== "closeShort" && (
            <form onSubmit={saveDelivered} className="space-y-3">
              <div className="flex items-center justify-between gap-2">
                <p className="text-xs text-muted-foreground">Zadej celkem dodané množství. Při 100 % se zakázka posune sama.</p>
                <Button type="button" size="sm" variant="outline" disabled={busy}
                  onClick={() => setValues((v) => ({ ...v, ...Object.fromEntries(open_.map((i) => [i.id, String(i.quantity)])) }))}>
                  Dodat vše
                </Button>
              </div>
              <ul className="divide-y rounded-lg border">
                {items.map((i) => {
                  const done = itemDone(i);
                  return (
                    <li key={i.id} className={cn("flex flex-wrap items-center gap-2 px-3 py-2", i.deliveryClosed && "bg-muted/40")}>
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-sm font-medium">{itemLabel(i)}</p>
                        <p className="text-[11px] text-muted-foreground">
                          {i.drawingNumber && <span className="font-mono">{i.drawingNumber} · </span>}
                          objednáno {formatQty(i.quantity)} {i.unit} · dodáno {formatQty(i.deliveredQuantity ?? 0)}
                          {i.deliveryClosed && <> · uzavřeno{i.deliveryClosedReason ? ` (${i.deliveryClosedReason})` : ""}</>}
                        </p>
                      </div>
                      {i.deliveryClosed ? (
                        <span className="inline-flex items-center gap-1 text-xs font-medium text-green-700 dark:text-green-400"><Check className="h-3.5 w-3.5" /> uzavřeno</span>
                      ) : (
                        <div className="flex items-center gap-1">
                          <Input
                            inputMode="decimal"
                            aria-label={`Dodáno celkem — ${itemLabel(i)}`}
                            value={values[i.id] ?? ""}
                            onChange={(e) => setValues((v) => ({ ...v, [i.id]: e.target.value }))}
                            className="h-10 w-24 text-right tabular-nums"
                          />
                          <span className="w-8 text-xs text-muted-foreground">{i.unit}</span>
                          <Button type="button" size="sm" variant={done ? "ghost" : "outline"} className="h-10"
                            onClick={() => setValues((v) => ({ ...v, [i.id]: String(i.quantity) }))} aria-label={`Vše — ${itemLabel(i)}`}>
                            Vše
                          </Button>
                        </div>
                      )}
                    </li>
                  );
                })}
              </ul>
              <div className="space-y-1">
                <label htmlFor={noteId} className="block text-xs font-medium text-muted-foreground">Poznámka (nepovinná)</label>
                <Input id={noteId} value={note} onChange={(e) => setNote(e.target.value)} maxLength={500} placeholder="např. DL 2026-118, osobní odběr" className="h-10" />
              </div>
              <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-between">
                <Button type="button" variant="ghost" className="h-11 sm:h-9" disabled={busy || !open_.some((i) => !itemDone(i))} onClick={() => { setView("closeShort"); setNote(""); setError(null); }}>
                  <PackageCheck /> Uzavřít s menším množstvím…
                </Button>
                <Button type="submit" variant="success" className="h-11 sm:h-9" disabled={busy}>
                  {busy ? <Loader2 className="animate-spin" /> : <Truck />} Zapsat dodání
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
