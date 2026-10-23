import type { JobEvent, JobFile, JobListItem, PersonRef } from "@/lib/jobs/types";
import type { JobClosingInfo, JobOperation, JobOperationInput } from "@/lib/jobs/production-types";
import type { OperationKind, OperationStatus } from "@/lib/jobs/operations";
import {
  IN_HOUSE_KEY, czDay, daysBetween, isOperationOverdue, moveOperation, sortOperations,
} from "@/lib/jobs/production";
import { paymentStateOf } from "@/lib/jobs/mapping";
import { shortDate } from "@/components/jobs/book/book-params";

/**
 * Záložka „Výroba" a řádek knihy — čistá logika UI (bez Reactu a DB):
 * barevné úseky průběhu, stav teček na „metru", kdo operaci dělá, termíny,
 * optimistické změny a konec toku (dodací list → faktura → platba).
 * Testy v production-helpers.test.ts.
 */

// ── Skloňování a data ───────────────────────────────────────
/** 1 den, 2–4 dny, 5+ dní. */
export function dayWord(n: number): string {
  const a = Math.abs(n);
  return a === 1 ? "den" : a >= 2 && a <= 4 ? "dny" : "dní";
}

/** RRRR-MM-DD nebo ISO razítko → pražský den RRRR-MM-DD. */
export function pragueDay(value: string | null | undefined): string | null {
  if (!value) return null;
  if (/^\d{4}-\d{2}-\d{2}$/.test(value)) return value;
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return null;
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Prague" }).format(d);
}

/** Krátké datum „5. 11." (rok jen mimo letošek), i z ISO razítka. */
export function dayLabel(value: string | null | undefined, today: string): string | null {
  const d = pragueDay(value);
  return d ? shortDate(d, today) : null;
}

// ── Průběh výroby ───────────────────────────────────────────
/** Stav tečky na „metru": hotovo / běží / problém / na řadě / čeká / přeskočeno. */
export type OperationVisual = "done" | "running" | "problem" | "next" | "todo" | "skipped";

export interface ProgressSegment {
  id: string;
  kind: OperationKind;
  state: Exclude<OperationVisual, "skipped">;
  label: string;
  location: string;
}

/**
 * Úseky velkého pruhu průběhu (bez přeskočených). Když nic neběží, první
 * čekající operace je „na řadě".
 */
export function progressSegments(ops: JobOperation[]): ProgressSegment[] {
  const sorted = sortOperations(ops).filter((o) => o.status !== "preskoceno");
  const active = sorted.some((o) => o.status === "probiha" || o.status === "problem");
  let nextMarked = false;
  return sorted.map((o) => {
    let state: ProgressSegment["state"];
    if (o.status === "hotovo") state = "done";
    else if (o.status === "probiha") state = "running";
    else if (o.status === "problem") state = "problem";
    else if (!active && !nextMarked) {
      state = "next";
      nextMarked = true;
    } else state = "todo";
    return { id: o.id, kind: o.kind, state, label: o.label, location: o.location };
  });
}

/** Stav každé operace pro „metro" (včetně přeskočených). */
export function operationVisuals(ops: JobOperation[]): Map<string, OperationVisual> {
  const map = new Map<string, OperationVisual>(progressSegments(ops).map((s) => [s.id, s.state]));
  for (const o of ops) if (o.status === "preskoceno") map.set(o.id, "skipped");
  return map;
}

/** Kde se zakázka nachází — stejné pravidlo jako DB: první probíhající / problémová, jinak první čekající. */
export function currentOperation(ops: JobOperation[]): JobOperation | null {
  const sorted = sortOperations(ops);
  return sorted.find((o) => o.status === "probiha" || o.status === "problem")
    ?? sorted.find((o) => o.status === "ceka")
    ?? null;
}

/** Co přijde po aktuální operaci (první čekající za ní). */
export function upcomingOperation(ops: JobOperation[]): JobOperation | null {
  const sorted = sortOperations(ops);
  const cur = currentOperation(sorted);
  if (!cur) return null;
  const i = sorted.findIndex((o) => o.id === cur.id);
  return sorted.slice(i + 1).find((o) => o.status === "ceka") ?? null;
}

export type MiniSegment = "done" | "current" | "problem" | "todo";

/**
 * Mini pruh do řádku knihy jen z počtů (hotovo / celkem). Nad `max` operací
 * vrací null — pak stačí souvislý pruh v procentech.
 */
export function miniSegments(
  done: number,
  total: number,
  opts: { problem?: boolean; finished?: boolean; max?: number } = {},
): MiniSegment[] | null {
  const t = Math.max(0, Math.trunc(total));
  if (!t || t > (opts.max ?? 10)) return null;
  const d = Math.min(t, Math.max(0, Math.trunc(done)));
  return Array.from({ length: t }, (_, i): MiniSegment => {
    if (i < d) return "done";
    if (i === d && !opts.finished) return opts.problem ? "problem" : "current";
    return "todo";
  });
}

// ── Hlavní tlačítko a termíny ───────────────────────────────
/** Jedno klepnutí: Začít (čeká) / Hotovo (probíhá, problém). */
export function primaryAction(status: OperationStatus): { label: string; next: OperationStatus } | null {
  if (status === "ceka") return { label: "Začít", next: "probiha" };
  if (status === "probiha") return { label: "Hotovo", next: "hotovo" };
  if (status === "problem") return { label: "Vyřešeno — hotovo", next: "hotovo" };
  return null;
}

export type PlannedTone = "overdue" | "today" | "soon" | "ok" | "done";

/** Termín operace: barva + text („2 dny po termínu", „termín zítra", „termín 25. 10."). */
export function plannedState(
  op: Pick<JobOperation, "status" | "plannedEnd">,
  today: string,
): { tone: PlannedTone; text: string } | null {
  const end = pragueDay(op.plannedEnd);
  if (!end) return null;
  if (op.status === "hotovo" || op.status === "preskoceno") return { tone: "done", text: `termín ${shortDate(end, today)}` };
  const d = daysBetween(today, end);
  if (d < 0) return { tone: "overdue", text: `${-d} ${dayWord(d)} po termínu (${shortDate(end, today)})` };
  if (d === 0) return { tone: "today", text: "termín dnes" };
  if (d === 1) return { tone: "soon", text: "termín zítra" };
  if (d <= 3) return { tone: "soon", text: `termín za ${d} ${dayWord(d)}` };
  return { tone: "ok", text: `termín ${shortDate(end, today)}` };
}

export const PLANNED_TONE: Record<PlannedTone, string> = {
  overdue: "bg-red-100 text-red-700 dark:bg-red-500/15 dark:text-red-300",
  today: "bg-orange-100 text-orange-800 dark:bg-orange-500/15 dark:text-orange-300",
  soon: "bg-amber-100 text-amber-800 dark:bg-amber-500/15 dark:text-amber-300",
  ok: "bg-muted text-foreground/80",
  done: "bg-muted text-muted-foreground",
};

/** Poslední řádek poznámky (nové se připisují na konec) — náhled na kartě. */
export function lastNoteLine(note: string | null | undefined, max = 180): string | null {
  const lines = (note ?? "").split("\n").map((l) => l.trim()).filter(Boolean);
  const last = lines[lines.length - 1];
  if (!last) return null;
  return last.length > max ? `${last.slice(0, max - 1)}…` : last;
}

/** Operace s problémem a po termínu (souhrnná karta). */
export function problemOperations(ops: JobOperation[]): JobOperation[] {
  return sortOperations(ops).filter((o) => o.status === "problem");
}

export function overdueOperations(ops: JobOperation[], today: string): JobOperation[] {
  return sortOperations(ops).filter((o) => isOperationOverdue(o, today));
}

// ── Optimistické změny ──────────────────────────────────────
/** Nový stav operace hned v UI (časy jako DB trigger). */
export function withStatus(
  ops: JobOperation[],
  id: string,
  status: OperationStatus,
  today: string,
  nowIso: string = new Date().toISOString(),
): JobOperation[] {
  return ops.map((o) => {
    if (o.id !== id) return o;
    let startedAt = o.startedAt;
    let finishedAt = o.finishedAt;
    if ((status === "probiha" || status === "hotovo" || status === "problem") && !startedAt) startedAt = nowIso;
    if (status === "hotovo" && !finishedAt) finishedAt = nowIso;
    if (status === "ceka" || status === "probiha") finishedAt = null;
    if (status === "ceka") startedAt = null;
    return { ...o, status, startedAt, finishedAt, overdue: isOperationOverdue({ status, plannedEnd: o.plannedEnd }, today) };
  });
}

/** Posun o jedno nahoru / dolů (pozice 0, 1, 2…); null = nejde. */
export function moveLocal(ops: JobOperation[], id: string, direction: "up" | "down"): JobOperation[] | null {
  const sorted = sortOperations(ops);
  const ids = moveOperation(sorted.map((o) => o.id), id, direction);
  if (!ids) return null;
  const byId = new Map(sorted.map((o) => [o.id, o]));
  return ids.map((x, i) => ({ ...(byId.get(x) as JobOperation), position: i }));
}

// ── Kdo operaci dělá ────────────────────────────────────────
export type WhoValue =
  | { type: "u_nas" }
  | { type: "supplier"; id: string; name: string }
  | { type: "free"; name: string }
  | { type: "none" };

export const WHO_IN_HOUSE: WhoValue = { type: "u_nas" };
export const WHO_NONE: WhoValue = { type: "none" };

export function whoOfOperation(op: Pick<JobOperation, "inHouse" | "supplier" | "supplierName">): WhoValue {
  if (op.inHouse) return WHO_IN_HOUSE;
  if (op.supplier) return { type: "supplier", id: op.supplier.id, name: op.supplier.name };
  const free = (op.supplierName ?? "").trim();
  return free ? { type: "free", name: free } : WHO_NONE;
}

/** „Kdo" → vstup akce (vždy všechna tři pole, ať se staré hodnoty přepíšou). */
export function whoToInput(who: WhoValue): Pick<JobOperationInput, "inHouse" | "supplierId" | "supplierName"> {
  switch (who.type) {
    case "u_nas": return { inHouse: true, supplierId: null, supplierName: null };
    case "supplier": return { inHouse: false, supplierId: who.id, supplierName: null };
    case "free": return { inHouse: false, supplierId: null, supplierName: who.name.trim() || null };
    default: return { inHouse: false, supplierId: null, supplierName: null };
  }
}

export function whoLabel(who: WhoValue): string {
  if (who.type === "u_nas") return "U nás";
  if (who.type === "supplier" || who.type === "free") return who.name;
  return "Nevybráno";
}

export function sameWho(a: WhoValue, b: WhoValue): boolean {
  if (a.type !== b.type) return false;
  if (a.type === "supplier" && b.type === "supplier") return a.id === b.id;
  if (a.type === "free" && b.type === "free") return a.name.trim().toLowerCase() === b.name.trim().toLowerCase();
  return true;
}

/** Hodnota pro šablonu: „u_nas", id dodavatele, název firmy; null = nikdo. */
export function whoToTemplateValue(who: WhoValue): string | null {
  if (who.type === "u_nas") return IN_HOUSE_KEY;
  if (who.type === "supplier") return who.id;
  if (who.type === "free") return who.name.trim() || null;
  return null;
}

/**
 * Šablona + kdo dělá jednotlivé kroky → požadavek na server. Šablona se mapuje
 * podle druhu operace — když se druh opakuje, pošle se raději celý seznam.
 */
export function templateRequest(
  kinds: OperationKind[],
  picks: WhoValue[],
):
  | { mode: "template"; supplierByKind: Partial<Record<OperationKind, string>> }
  | { mode: "list"; ops: JobOperationInput[] } {
  const unique = new Set(kinds).size === kinds.length;
  if (!unique) {
    return { mode: "list", ops: kinds.map((kind, i) => ({ kind, ...whoToInput(picks[i] ?? WHO_NONE) })) };
  }
  const supplierByKind: Partial<Record<OperationKind, string>> = {};
  kinds.forEach((kind, i) => {
    const v = whoToTemplateValue(picks[i] ?? WHO_NONE);
    if (v) supplierByKind[kind] = v;
  });
  return { mode: "template", supplierByKind };
}

// ── Konec toku ──────────────────────────────────────────────
export type InvoiceTone = "paid" | "overdue" | "today" | "soon" | "ok";

/** Barva splatnosti faktury (null = bez faktury / bez splatnosti). */
export function invoiceTone(c: Pick<JobClosingInfo, "paidAt" | "daysToDue" | "invoiceDueDate">): InvoiceTone | null {
  if (c.paidAt) return "paid";
  if (!c.invoiceDueDate || c.daysToDue === null) return null;
  if (c.daysToDue < 0) return "overdue";
  if (c.daysToDue === 0) return "today";
  if (c.daysToDue <= 3) return "soon";
  return "ok";
}

export const INVOICE_TONE: Record<InvoiceTone, string> = {
  paid: "bg-green-100 text-green-800 dark:bg-green-500/15 dark:text-green-300",
  overdue: "bg-red-600 text-white",
  today: "bg-orange-100 text-orange-800 dark:bg-orange-500/15 dark:text-orange-300",
  soon: "bg-amber-100 text-amber-800 dark:bg-amber-500/15 dark:text-amber-300",
  ok: "bg-sky-100 text-sky-800 dark:bg-sky-500/15 dark:text-sky-300",
};

/** Kolik ze tří kroků konce toku je hotovo (DL, faktura, platba). */
export function closingProgress(c: Pick<JobClosingInfo, "deliveryNoteConfirmedAt" | "invoiceNumber" | "invoiceDate" | "paidAt">): {
  delivery: boolean;
  invoice: boolean;
  paid: boolean;
  done: number;
} {
  const delivery = Boolean(c.deliveryNoteConfirmedAt);
  const invoice = Boolean((c.invoiceNumber ?? "").trim() || c.invoiceDate);
  const paid = Boolean(c.paidAt);
  return { delivery, invoice, paid, done: [delivery, invoice, paid].filter(Boolean).length };
}

export const CONFIRMED_DL_TITLE = "Potvrzený dodací list";

/** Nahraný potvrzený dodací list (nejnovější, nearchivovaný). */
export function confirmedDeliveryFile(files: JobFile[]): JobFile | null {
  const list = files
    .filter((f) => !f.archived && f.kind === "dodaci_list" && (f.title ?? "").trim() === CONFIRMED_DL_TITLE)
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  return list[0] ?? null;
}

// ── Kdo to udělal (historie zakázky) ────────────────────────
/** Kdo a kdy změnu udělal. */
export interface ActorStamp {
  name: string;
  at: string;
}

/** Volitelná pole, která časem doplní DB (status_changed_by…) — mají přednost před historií. */
export interface ChangedByFields {
  changedBy?: PersonRef | null;
  changedAt?: string | null;
  /** „automaticky" = navázalo samo (changedBy = kdo to spustil). */
  changedVia?: string | null;
}

type EventLike = Pick<JobEvent, "data" | "actor" | "createdAt">;

function newestFirst<T extends { createdAt: string }>(list: T[]): T[] {
  return [...list].sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

/**
 * Kdo operaci naposledy přepnul do jejího stavu (z historie zakázky). Když
 * poslední záznam nesedí na stav (optimistická změna ještě bez obnovení), nic.
 */
export function operationStatusStamp(
  events: EventLike[],
  op: Pick<JobOperation, "id" | "status"> & ChangedByFields,
): (ActorStamp & { auto: boolean }) | null {
  if (op.changedBy && op.changedAt) return { name: op.changedBy.name, at: op.changedAt, auto: op.changedVia === "automaticky" };
  for (const e of newestFirst(events)) {
    const d = e.data ?? {};
    if (d.operationId !== op.id || d.production !== "status") continue;
    if (d.to !== op.status) return null;
    return e.actor ? { name: e.actor.name, at: e.createdAt, auto: d.auto === true } : null;
  }
  return null;
}

/**
 * Poslední zápis konce toku (potvrzení DL, faktura, úhrada). Zrušení
 * (date / paidAt = null) znamená, že teď nikdo „nepotvrdil".
 */
export function closingStamp(events: EventLike[], kind: "delivery_note" | "invoice" | "paid"): ActorStamp | null {
  for (const e of newestFirst(events)) {
    const d = e.data ?? {};
    if (d.production !== kind) continue;
    if (kind === "delivery_note" && !d.date) return null;
    if (kind === "paid" && !d.paidAt) return null;
    return e.actor ? { name: e.actor.name, at: e.createdAt } : null;
  }
  return null;
}

/** „14:05" (dnes), jinak „22. 10. 14:05" — pražský čas. */
export function stampTime(at: string, today: string): string {
  const d = new Date(at);
  if (Number.isNaN(d.getTime())) return "";
  const time = new Intl.DateTimeFormat("cs-CZ", { timeZone: "Europe/Prague", hour: "2-digit", minute: "2-digit" }).format(d);
  const day = pragueDay(at);
  return !day || day === today ? time : `${shortDate(day, today)} ${time}`;
}

/** „Hotovo · 14:05 · Dominik Šponer" */
export function stampLabel(prefix: string, s: ActorStamp, today: string): string {
  const t = stampTime(s.at, today);
  return [prefix, t, s.name].filter(Boolean).join(" · ");
}

export const STATUS_STAMP: Record<OperationStatus, string> = {
  ceka: "Vráceno na Čeká",
  probiha: "Začato",
  hotovo: "Hotovo",
  problem: "Problém",
  preskoceno: "Přeskočeno",
};

// ── Řádek knihy: platba ─────────────────────────────────────
export type PaymentMarkTone = "paid" | "overdue" | "soon" | "ok";

/** „zaplaceno" / „po splatnosti" / „splatná 21. 11." pro vyfakturované zakázky. */
export function listPaymentMark(
  job: Pick<JobListItem, "stage" | "paidAt" | "invoiceDueDate" | "invoiceNumber">,
  today: string,
): { tone: PaymentMarkTone; text: string; title: string } | null {
  const state = paymentStateOf(job, today);
  if (!state) return null;
  if (state === "zaplaceno") {
    return { tone: "paid", text: "zaplaceno", title: job.paidAt ? `Zaplaceno ${czDay(job.paidAt)}` : "Zakázka dokončena a zaplacena" };
  }
  const inv = job.invoiceNumber ? `Faktura ${job.invoiceNumber}` : "Faktura";
  const due = pragueDay(job.invoiceDueDate);
  if (!due) return { tone: "ok", text: "vyfakturováno", title: `${inv} — čeká na úhradu` };
  const d = daysBetween(today, due);
  if (state === "po_splatnosti") {
    return { tone: "overdue", text: "po splatnosti", title: `${inv} — ${-d} ${dayWord(d)} po splatnosti (splatná ${czDay(due)})` };
  }
  return {
    tone: d <= 3 ? "soon" : "ok",
    text: d === 0 ? "splatná dnes" : `splatná ${shortDate(due, today)}`,
    title: `${inv} — splatná ${czDay(due)}`,
  };
}

export const PAYMENT_MARK_TONE: Record<PaymentMarkTone, string> = {
  paid: "bg-green-100 text-green-800 dark:bg-green-500/15 dark:text-green-300",
  overdue: "bg-red-600 text-white",
  soon: "bg-amber-100 text-amber-800 dark:bg-amber-500/15 dark:text-amber-300",
  ok: "bg-sky-50 text-sky-800 dark:bg-sky-500/10 dark:text-sky-300",
};
