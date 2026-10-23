import {
  OPERATION_KINDS, OPERATION_KIND_ORDER, OPERATION_STATUSES, OPERATION_TEMPLATES,
  isOperationKind, isOperationStatus, productionLabel,
  type OperationKind, type OperationStatus,
} from "@/lib/jobs/operations";
import { CLOSED_STAGES, isJobStage } from "@/lib/jobs/stages";
import { cleanDate, cleanNumber, cleanText, isUuid, one, personRef, todayIso, type PersonEmbed } from "@/lib/jobs/mapping";
import type { JobOperationRow } from "@/lib/supabase/database.types";
import type {
  JobClosingInfo, JobOperation, JobOperationInput, JobProductionSummary, ProductionFilterCounts,
} from "@/lib/jobs/production-types";

/**
 * Výroba zakázky — čistá logika (bez DB): převod řádků na view, validace vstupu,
 * pořadí operací, šablony postupů, termíny, splatnost faktury a texty do historie.
 */

type Row = Record<string, unknown>;
type Embed<T> = T | T[] | null | undefined;

export const IN_HOUSE_LABEL = "U nás";
/** Hodnota „u nás" ve výběru dodavatele šablony. */
export const IN_HOUSE_KEY = "u_nas";
export const DEFAULT_PAYMENT_TERMS = 14;
export const MAX_OPERATIONS = 60;
export const OPERATION_NOTE_MAX = 10_000;
export const CUSTOMER_NOTE_MAX = 10_000;
const OWN_DELETE_WINDOW_MS = 24 * 60 * 60 * 1000;

// ── Select a řádek DB ───────────────────────────────────────
export const OPERATION_SELECT = [
  "*",
  "supplier:suppliers!supplier_id(id, name)",
  "creator:profiles!created_by(id, full_name, email)",
  "po:purchase_orders!purchase_order_id(id, number)",
  "changer:profiles!status_changed_by(id, full_name, email)",
].join(", ");

export type JobOperationDbRow = JobOperationRow & {
  supplier?: Embed<{ id: string; name: string }>;
  creator?: Embed<PersonEmbed>;
  po?: Embed<{ id: string; number: string | null }>;
  changer?: Embed<PersonEmbed>;
};

export const CLOSING_SELECT = [
  "id, status, customer_note, delivery_note_confirmed_at, delivery_note_number, invoice_number, invoice_date",
  "invoice_due_date, paid_at, paid_amount, customer_id",
  "customer:customers!customer_id(id, payment_terms_days)",
].join(", ");

export interface ClosingDbRow {
  id: string;
  status: unknown;
  customer_note?: string | null;
  delivery_note_confirmed_at?: string | null;
  delivery_note_number?: string | null;
  invoice_number?: string | null;
  invoice_date?: string | null;
  invoice_due_date?: string | null;
  paid_at?: string | null;
  paid_amount?: number | string | null;
  customer?: Embed<{ id: string; payment_terms_days?: number | null }>;
}

// ── Data a dny ──────────────────────────────────────────────
function dayNumber(iso: string): number {
  const [y, m, d] = iso.split("-").map(Number);
  return Math.round(Date.UTC(y, m - 1, d) / 86_400_000);
}

/** Datum + n dní (RRRR-MM-DD). */
export function addDays(iso: string, days: number): string {
  const [y, m, d] = iso.split("-").map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d + Math.trunc(days)));
  return dt.toISOString().slice(0, 10);
}

/** Počet dní z `from` do `to` (záporné = `to` je dřív). */
export function daysBetween(from: string, to: string): number {
  return dayNumber(to) - dayNumber(from);
}

/** „5. 11. 2026" z RRRR-MM-DD. */
export function czDay(iso: string | null | undefined): string {
  const d = cleanDate(iso);
  if (!d) return iso ?? "";
  const [y, m, day] = d.split("-");
  return `${Number(day)}. ${Number(m)}. ${y}`;
}

/** Splatnost faktury: datum faktury + splatnost zákazníka (jinak 14 dní). */
export function dueDateFor(invoiceDate: string, termsDays: number | null | undefined): string {
  const n = cleanNumber(termsDays);
  const terms = n !== null && n >= 0 && n <= 365 ? Math.round(n) : DEFAULT_PAYMENT_TERMS;
  return addDays(invoiceDate, terms);
}

// ── Operace: řádek → view ───────────────────────────────────
export function operationKindOf(v: unknown): OperationKind {
  return isOperationKind(v) ? v : "jine";
}

export function operationStatusOf(v: unknown): OperationStatus {
  return isOperationStatus(v) ? v : "ceka";
}

/** Kde se operace dělá (zobrazení). */
export function operationLocation(op: {
  inHouse: boolean;
  supplier?: { name: string } | null;
  supplierName?: string | null;
}): string {
  if (op.inHouse) return IN_HOUSE_LABEL;
  const s = (op.supplier?.name ?? "").trim();
  if (s) return s;
  const free = (op.supplierName ?? "").trim();
  return free || "—";
}

export function operationLabel(kind: OperationKind, title?: string | null): string {
  return (title ?? "").trim() || OPERATION_KINDS[kind].label;
}

/** Termín prošel a operace není hotová / přeskočená. */
export function isOperationOverdue(
  op: { status: OperationStatus; plannedEnd: string | null },
  today: string = todayIso(),
): boolean {
  if (!op.plannedEnd || op.status === "hotovo" || op.status === "preskoceno") return false;
  const end = cleanDate(op.plannedEnd);
  return end !== null && end < today;
}

export function rowToJobOperation(row: JobOperationDbRow, today: string = todayIso()): JobOperation {
  const kind = operationKindOf(row.kind);
  const status = operationStatusOf(row.status);
  const sup = one(row.supplier);
  const supplier = sup && sup.id ? { id: sup.id, name: sup.name } : null;
  const po = one(row.po);
  const view = {
    inHouse: Boolean(row.in_house),
    supplier,
    supplierName: cleanText(row.supplier_name, 300),
  };
  const plannedEnd = cleanDate(row.planned_end);
  return {
    id: row.id,
    jobId: row.job_id,
    position: cleanNumber(row.position) ?? 0,
    kind,
    title: cleanText(row.title, 300),
    label: operationLabel(kind, row.title),
    supplier,
    supplierName: view.supplierName,
    inHouse: view.inHouse,
    location: operationLocation(view),
    status,
    plannedStart: cleanDate(row.planned_start),
    plannedEnd,
    startedAt: row.started_at ?? null,
    finishedAt: row.finished_at ?? null,
    note: row.note ?? null,
    purchaseOrderId: row.purchase_order_id ?? null,
    purchaseOrderNumber: po?.number ?? null,
    createdBy: personRef(row.creator),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    overdue: isOperationOverdue({ status, plannedEnd }, today),
    ...(row.status_changed_at
      ? { changedBy: personRef(row.changer), changedAt: row.status_changed_at, changedVia: row.status_changed_via ?? null }
      : {}),
  };
}

/** Seřazení podle pořadí (při shodě podle založení). */
export function sortOperations<T extends { position: number; createdAt?: string; created_at?: string }>(ops: T[]): T[] {
  return [...ops].sort((a, b) =>
    a.position - b.position || String(a.createdAt ?? a.created_at ?? "").localeCompare(String(b.createdAt ?? b.created_at ?? "")));
}

// ── Souhrn výroby ───────────────────────────────────────────
function percentOf(done: number, total: number): number {
  if (total <= 0) return 0;
  return Math.max(0, Math.min(100, Math.round((done / total) * 100)));
}

function stepOf(v: unknown): OperationKind | "hotovo" | null {
  if (v === "hotovo") return "hotovo";
  return isOperationKind(v) ? v : null;
}

/** Souhrn z orders.production_* (udržuje DB trigger). */
export function summaryFromJob(row: {
  production_step?: string | null;
  production_location?: string | null;
  production_done?: number | string | null;
  production_total?: number | string | null;
  production_problem?: boolean | null;
}): JobProductionSummary {
  const step = stepOf(row.production_step);
  const location = cleanText(row.production_location, 300);
  const done = Math.max(0, Math.round(cleanNumber(row.production_done) ?? 0));
  const total = Math.max(0, Math.round(cleanNumber(row.production_total) ?? 0));
  return {
    step,
    location,
    done,
    total,
    problem: Boolean(row.production_problem),
    label: productionLabel(step, location),
    percent: percentOf(done, total),
  };
}

/**
 * Stejný souhrn jako DB funkce recompute_job_production — pro okamžité
 * překreslení UI: aktuální = první probíhající / problémová, jinak první čekající.
 */
export function summarizeOperations(ops: JobOperation[]): JobProductionSummary {
  const sorted = sortOperations(ops);
  const total = sorted.filter((o) => o.status !== "preskoceno").length;
  const done = sorted.filter((o) => o.status === "hotovo").length;
  const problem = sorted.some((o) => o.status === "problem");
  const cur = sorted.find((o) => o.status === "probiha" || o.status === "problem")
    ?? sorted.find((o) => o.status === "ceka")
    ?? null;
  const step: JobProductionSummary["step"] = cur ? cur.kind : total > 0 && done === total ? "hotovo" : null;
  const location = cur && cur.location !== "—" ? cur.location : null;
  return { step, location, done, total, problem, label: productionLabel(step, location), percent: percentOf(done, total) };
}

// ── Validace a převod vstupu ────────────────────────────────
function badDate(v: unknown): boolean {
  return v !== undefined && v !== null && v !== "" && cleanDate(v) === null;
}

/** Chyba vstupu operace (česky), jinak null. `partial` = úprava (druh nepovinný). */
export function validateOperationInput(input: Partial<JobOperationInput> | null | undefined, partial = false): string | null {
  if (!input || typeof input !== "object") return "Chybí údaje operace.";
  if (!partial || input.kind !== undefined) {
    if (!isOperationKind(input.kind)) return "Neznámý druh operace.";
  }
  if (input.title !== undefined && input.title !== null && typeof input.title !== "string") return "Neplatný název operace.";
  if (typeof input.title === "string" && input.title.trim().length > 300) return "Název operace je příliš dlouhý (max. 300 znaků).";
  if (input.supplierId !== undefined && input.supplierId !== null && input.supplierId !== "" && !isUuid(input.supplierId)) {
    return "Neplatný dodavatel.";
  }
  if (input.supplierName !== undefined && input.supplierName !== null && typeof input.supplierName !== "string") return "Neplatný název firmy.";
  if (typeof input.supplierName === "string" && input.supplierName.trim().length > 300) return "Název firmy je příliš dlouhý.";
  if (input.inHouse !== undefined && typeof input.inHouse !== "boolean") return "Neplatná volba „u nás\".";
  if (input.status !== undefined && !isOperationStatus(input.status)) return "Neznámý stav operace.";
  if (badDate(input.plannedStart) || badDate(input.plannedEnd)) return "Neplatné datum (čekám RRRR-MM-DD).";
  const start = cleanDate(input.plannedStart);
  const end = cleanDate(input.plannedEnd);
  if (start && end && start > end) return "Začátek operace je po jejím termínu.";
  if (input.note !== undefined && input.note !== null && typeof input.note !== "string") return "Neplatná poznámka.";
  if (typeof input.note === "string" && input.note.length > OPERATION_NOTE_MAX) return "Poznámka je příliš dlouhá.";
  if (input.purchaseOrderId !== undefined && input.purchaseOrderId !== null && input.purchaseOrderId !== "" && !isUuid(input.purchaseOrderId)) {
    return "Neplatná objednávka.";
  }
  return null;
}

/** Validace seznamu nových operací. */
export function validateOperationList(ops: unknown): string | null {
  if (!Array.isArray(ops) || !ops.length) return "Vyber aspoň jednu operaci.";
  if (ops.length > MAX_OPERATIONS) return `Najednou lze přidat nejvýš ${MAX_OPERATIONS} operací.`;
  for (const [i, op] of ops.entries()) {
    const err = validateOperationInput(op as JobOperationInput);
    if (err) return ops.length > 1 ? `Operace ${i + 1}: ${err}` : err;
  }
  return null;
}

/**
 * Kdo operaci dělá — jedna ze tří možností: u nás / dodavatel z adresáře /
 * firma mimo adresář. Vrací sloupce jen když vstup „kdo" obsahuje.
 */
export function resolveWho(input: Partial<JobOperationInput>): { in_house: boolean; supplier_id: string | null; supplier_name: string | null } | null {
  if (input.inHouse === undefined && input.supplierId === undefined && input.supplierName === undefined) return null;
  if (input.inHouse === true) return { in_house: true, supplier_id: null, supplier_name: null };
  if (isUuid(input.supplierId)) return { in_house: false, supplier_id: input.supplierId.toLowerCase(), supplier_name: null };
  const name = cleanText(input.supplierName, 300);
  return { in_house: false, supplier_id: null, supplier_name: name };
}

/** Vstup → sloupce job_operations (jen zadaná pole; u nové operace i výchozí). */
export function operationInputToRow(input: Partial<JobOperationInput>, partial = false): Row {
  const row: Row = {};
  if (input.kind !== undefined) row.kind = input.kind;
  if (input.title !== undefined) row.title = cleanText(input.title, 300);
  const who = resolveWho(input);
  if (who) Object.assign(row, who);
  else if (!partial) Object.assign(row, { in_house: false, supplier_id: null, supplier_name: null });
  if (input.status !== undefined) row.status = input.status;
  else if (!partial) row.status = "ceka";
  if (input.plannedStart !== undefined) row.planned_start = cleanDate(input.plannedStart);
  if (input.plannedEnd !== undefined) row.planned_end = cleanDate(input.plannedEnd);
  if (input.note !== undefined) row.note = cleanText(input.note, OPERATION_NOTE_MAX);
  if (input.purchaseOrderId !== undefined) row.purchase_order_id = isUuid(input.purchaseOrderId) ? input.purchaseOrderId.toLowerCase() : null;
  return row;
}

const OPERATION_COLUMNS = [
  "kind", "title", "in_house", "supplier_id", "supplier_name", "status",
  "planned_start", "planned_end", "note", "purchase_order_id",
] as const;

/** Jen skutečně změněné sloupce operace. */
export function diffOperation(before: Row, patch: Row): Row {
  const out: Row = {};
  for (const k of OPERATION_COLUMNS) {
    if (!(k in patch)) continue;
    const a = before[k] ?? null;
    const b = patch[k] ?? null;
    if (k === "planned_start" || k === "planned_end") {
      if (cleanDate(a) === cleanDate(b)) continue;
    } else if (k === "in_house") {
      if (Boolean(a) === Boolean(b)) continue;
    } else if (a === b) continue;
    out[k] = patch[k];
  }
  return out;
}

// ── Pořadí ──────────────────────────────────────────────────
/** Posun o jedno nahoru / dolů; null = nejde (okraj, neznámé id). */
export function moveOperation(orderedIds: string[], id: string, direction: "up" | "down"): string[] | null {
  const i = orderedIds.indexOf(id);
  if (i < 0) return null;
  const j = direction === "up" ? i - 1 : i + 1;
  if (j < 0 || j >= orderedIds.length) return null;
  const out = [...orderedIds];
  [out[i], out[j]] = [out[j], out[i]];
  return out;
}

/** Přesun na index (drag & drop). */
export function moveToIndex(orderedIds: string[], id: string, index: number): string[] {
  const i = orderedIds.indexOf(id);
  if (i < 0) return [...orderedIds];
  const out = orderedIds.filter((x) => x !== id);
  const to = Math.max(0, Math.min(out.length, Math.trunc(index)));
  out.splice(to, 0, id);
  return out;
}

/** Nové pořadí musí obsahovat přesně stávající operace. */
export function validateReorder(currentIds: string[], orderedIds: unknown): string | null {
  if (!Array.isArray(orderedIds)) return "Chybí pořadí operací.";
  if (orderedIds.length !== currentIds.length || new Set(orderedIds).size !== orderedIds.length) {
    return "Pořadí neodpovídá operacím zakázky — obnov stránku.";
  }
  const cur = new Set(currentIds);
  for (const id of orderedIds) if (typeof id !== "string" || !cur.has(id)) return "Pořadí neodpovídá operacím zakázky — obnov stránku.";
  return null;
}

/** Pozice podle pořadí (0, 1, 2…) — vrací jen ty, které se mění. */
export function positionUpdates(current: { id: string; position: number }[], orderedIds: string[]): { id: string; position: number }[] {
  const pos = new Map(current.map((c) => [c.id, c.position]));
  const out: { id: string; position: number }[] = [];
  orderedIds.forEach((id, i) => {
    if (pos.get(id) !== i) out.push({ id, position: i });
  });
  return out;
}

/**
 * Vložení `count` nových operací na index `at` (výchozí = na konec).
 * Vrací pozice nových operací a posuny stávajících.
 */
export function insertPositions(
  existing: { id: string; position: number }[],
  count: number,
  at?: number | null,
): { positions: number[]; shifts: { id: string; position: number }[] } {
  const ordered = [...existing].sort((a, b) => a.position - b.position);
  const n = Math.max(0, Math.trunc(count));
  if (at === undefined || at === null || !Number.isFinite(at) || at >= ordered.length) {
    const start = ordered.length ? Math.max(ordered.length, ordered[ordered.length - 1].position + 1) : 0;
    return { positions: Array.from({ length: n }, (_, i) => start + i), shifts: [] };
  }
  const idx = Math.max(0, Math.trunc(at));
  const ids: (string | null)[] = ordered.map((o) => o.id);
  ids.splice(idx, 0, ...Array.from({ length: n }, () => null));
  const positions: number[] = [];
  const shifts: { id: string; position: number }[] = [];
  const pos = new Map(ordered.map((o) => [o.id, o.position]));
  ids.forEach((id, i) => {
    if (id === null) positions.push(i);
    else if (pos.get(id) !== i) shifts.push({ id, position: i });
  });
  return { positions, shifts };
}

// ── Šablony ─────────────────────────────────────────────────
/**
 * Šablona → operace. `supplierByKind`: id dodavatele, „u_nas", nebo název firmy
 * mimo adresář. Neznámá šablona → null.
 */
export function expandTemplate(
  templateKey: string,
  supplierByKind?: Partial<Record<OperationKind, string | null>> | null,
): JobOperationInput[] | null {
  const tpl = OPERATION_TEMPLATES.find((t) => t.key === templateKey);
  if (!tpl) return null;
  return tpl.kinds.map((kind) => {
    const who = cleanText(supplierByKind?.[kind], 300);
    if (!who) return { kind };
    if (who === IN_HOUSE_KEY) return { kind, inHouse: true };
    if (isUuid(who)) return { kind, supplierId: who.toLowerCase() };
    return { kind, supplierName: who };
  });
}

export function templateLabel(templateKey: string): string | null {
  return OPERATION_TEMPLATES.find((t) => t.key === templateKey)?.label ?? null;
}

// ── Navazující operace ──────────────────────────────────────
type WhoRef = { id: string; status: OperationStatus; position: number; inHouse: boolean; supplierId: string | null; supplierName: string | null };

function sameHands(a: WhoRef, b: WhoRef): boolean {
  if (b.inHouse) return true;
  if (a.inHouse) return false;
  if (a.supplierId && b.supplierId) return a.supplierId === b.supplierId;
  if (!a.supplierId && !b.supplierId) {
    const x = (a.supplierName ?? "").trim().toLowerCase();
    const y = (b.supplierName ?? "").trim().toLowerCase();
    return Boolean(x) && x === y;
  }
  return false;
}

/**
 * Po dokončení operace: další čekající operace se rozběhne sama, jen když ji
 * děláme u nás, nebo ji dělá stejná firma (díl tam už je). Jinak čeká na převoz.
 * Když už mezitím něco dalšího běží, nic se nespouští.
 */
export function nextToAutoStart(ops: WhoRef[], finishedId: string): string | null {
  const sorted = [...ops].sort((a, b) => a.position - b.position);
  const i = sorted.findIndex((o) => o.id === finishedId);
  if (i < 0) return null;
  const done = sorted[i];
  for (const o of sorted.slice(i + 1)) {
    if (o.status === "hotovo" || o.status === "preskoceno") continue;
    if (o.status !== "ceka") return null;
    return sameHands(done, o) ? o.id : null;
  }
  return null;
}

export function whoRefFromRow(r: Pick<JobOperationRow, "id" | "status" | "position" | "in_house" | "supplier_id" | "supplier_name">): WhoRef {
  return {
    id: r.id, status: operationStatusOf(r.status), position: cleanNumber(r.position) ?? 0,
    inHouse: Boolean(r.in_house), supplierId: r.supplier_id ?? null, supplierName: r.supplier_name ?? null,
  };
}

// ── Oprávnění k mazání ──────────────────────────────────────
/** Bez práva „delete" smí uživatel smazat jen svou operaci do 24 hodin od založení. */
export function canDeleteOwnOperation(
  op: { created_by?: string | null; created_at?: string | null },
  userId: string,
  now: Date = new Date(),
): boolean {
  if (!op.created_by || op.created_by !== userId || !op.created_at) return false;
  const t = new Date(op.created_at).getTime();
  if (!Number.isFinite(t)) return false;
  const age = now.getTime() - t;
  return age >= -60_000 && age < OWN_DELETE_WINDOW_MS;
}

// ── Poznámky ────────────────────────────────────────────────
function czStamp(at: Date): string {
  const parts = new Intl.DateTimeFormat("cs-CZ", {
    timeZone: "Europe/Prague", day: "numeric", month: "numeric", year: "numeric", hour: "2-digit", minute: "2-digit",
  }).formatToParts(at);
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? "";
  return `${get("day")}. ${get("month")}. ${get("year")} ${get("hour")}:${get("minute")}`;
}

/** Připíše řádek „22. 10. 2026 14:05 · Petr: text" na konec poznámky (nejnovější se vždy vejdou). */
export function appendNote(existing: string | null | undefined, text: string, author: string | null | undefined, at: Date = new Date()): string {
  const line = `${czStamp(at)}${(author ?? "").trim() ? ` · ${(author ?? "").trim()}` : ""}: ${text.trim()}`;
  const base = (existing ?? "").trim();
  const out = base ? `${base}\n${line}` : line;
  return out.length > OPERATION_NOTE_MAX ? out.slice(out.length - OPERATION_NOTE_MAX) : out;
}

// ── Konec toku ──────────────────────────────────────────────
export function computeClosingInfo(row: ClosingDbRow, opts: { margins: boolean; today?: string }): JobClosingInfo {
  const today = opts.today ?? todayIso();
  const due = cleanDate(row.invoice_due_date);
  const paidAt = cleanDate(row.paid_at);
  const terms = cleanNumber(one(row.customer)?.payment_terms_days);
  return {
    jobId: row.id,
    stage: isJobStage(row.status) ? row.status : "poptavka",
    customerNote: row.customer_note ?? null,
    deliveryNoteConfirmedAt: cleanDate(row.delivery_note_confirmed_at),
    deliveryNoteNumber: row.delivery_note_number ?? null,
    invoiceNumber: row.invoice_number ?? null,
    invoiceDate: cleanDate(row.invoice_date),
    invoiceDueDate: due,
    paymentTermsDays: terms,
    paidAt,
    paidAmount: opts.margins ? cleanNumber(row.paid_amount) : null,
    overdueInvoice: Boolean(due && !paidAt && due < today),
    daysToDue: due && !paidAt ? daysBetween(today, due) : null,
  };
}

/** „splatná za 5 dní" / „splatná dnes" / „12 dní po splatnosti" / „zaplaceno 3. 11. 2026". */
export function dueText(info: Pick<JobClosingInfo, "paidAt" | "daysToDue" | "invoiceDueDate">): string | null {
  if (info.paidAt) return `zaplaceno ${czDay(info.paidAt)}`;
  if (info.daysToDue === null || !info.invoiceDueDate) return null;
  const d = info.daysToDue;
  if (d === 0) return "splatná dnes";
  if (d > 0) return `splatná za ${d} ${d === 1 ? "den" : d < 5 ? "dny" : "dní"}`;
  const n = -d;
  return `${n} ${n === 1 ? "den" : n < 5 ? "dny" : "dní"} po splatnosti`;
}

// ── Filtry knihy ────────────────────────────────────────────
/** Počty aktivních zakázek podle aktuální operace a místa. */
export function countProductionFilters(
  rows: { status?: unknown; production_step?: string | null; production_location?: string | null }[],
): ProductionFilterCounts {
  const steps = new Map<string, number>();
  const locations = new Map<string, number>();
  for (const r of rows) {
    if (isJobStage(r.status) && CLOSED_STAGES.includes(r.status)) continue;
    const step = stepOf(r.production_step);
    if (!step) continue;
    steps.set(step, (steps.get(step) ?? 0) + 1);
    const loc = cleanText(r.production_location, 300);
    if (loc && step !== "hotovo") locations.set(loc, (locations.get(loc) ?? 0) + 1);
  }
  const order = [...OPERATION_KIND_ORDER, "hotovo"];
  return {
    steps: [...steps.entries()]
      .sort((a, b) => order.indexOf(a[0]) - order.indexOf(b[0]))
      .map(([key, count]) => ({ key, label: key === "hotovo" ? "Výroba hotová" : OPERATION_KINDS[key as OperationKind].label, count })),
    locations: [...locations.entries()]
      .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0], "cs"))
      .map(([name, count]) => ({ name, count })),
  };
}

// ── Texty do historie zakázky ───────────────────────────────
/** „Tepelné zpracování (TepKal s.r.o.)", bez místa jen název. */
export function operationDisplayName(op: { label: string; location: string }): string {
  return op.location && op.location !== "—" ? `${op.label} (${op.location})` : op.label;
}

export function statusEventMessage(name: string, status: OperationStatus, note?: string | null): string {
  const n = cleanText(note, 300);
  return `Výroba: ${name} → ${OPERATION_STATUSES[status].label}${n ? ` — ${n}` : ""}`;
}

/** „Přidány operace: Soustružení, Frézování (TepKal s.r.o.)…" */
export function addedEventMessage(names: string[], prefix?: string): string {
  const shown = names.slice(0, 8).join(", ");
  const more = names.length > 8 ? ` a další (${names.length - 8})` : "";
  const head = prefix ?? (names.length === 1 ? "Přidána operace" : "Přidány operace");
  return `${head}: ${shown}${more}`;
}

const CHANGE_LABELS: Record<string, string> = {
  kind: "druh", title: "název", status: "stav", planned_start: "začátek", planned_end: "termín",
  note: "poznámka", purchase_order_id: "objednávka",
};

/** Popis změn operace do historie (bez cen — operace žádné nemá). */
export function describeOperationChanges(changed: Row, who: string | null): string[] {
  const out: string[] = [];
  if ("kind" in changed) out.push(`druh: ${OPERATION_KINDS[operationKindOf(changed.kind)].label}`);
  if ("title" in changed) out.push(changed.title ? `název: ${String(changed.title)}` : "název odstraněn");
  if ("in_house" in changed || "supplier_id" in changed || "supplier_name" in changed) out.push(`kdo: ${who ?? "—"}`);
  if ("status" in changed) out.push(`stav: ${OPERATION_STATUSES[operationStatusOf(changed.status)].label}`);
  for (const k of ["planned_start", "planned_end"] as const) {
    if (k in changed) out.push(changed[k] ? `${CHANGE_LABELS[k]} ${czDay(String(changed[k]))}` : `${CHANGE_LABELS[k]} odstraněn`);
  }
  if ("note" in changed) out.push(CHANGE_LABELS.note);
  if ("purchase_order_id" in changed) out.push(changed.purchase_order_id ? CHANGE_LABELS.purchase_order_id : "objednávka odpojena");
  return out;
}

export function updateEventMessage(name: string, changes: string[]): string {
  return `Výroba: ${name} — ${changes.join(", ")}`;
}
