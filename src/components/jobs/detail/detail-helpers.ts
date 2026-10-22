import type { JobStage, JobFileKind, PriorityLevel, QuoteStatus } from "@/lib/supabase/database.types";
import type {
  JobDetail, JobEvent, JobFile, JobItem, JobItemInput, JobQuote, JobQuoteInput, JobQuoteItemInput,
} from "@/lib/jobs/types";
import {
  MAIN_FLOW, STAGES, CLOSED_STAGES, DELIVERED_STAGES, isJobStage, stageRank,
} from "@/lib/jobs/stages";
import { FILE_KIND_ORDER, isJobFileKind } from "@/lib/jobs/file-kinds";
import { dayNumber, effectiveDeadline, plural } from "@/lib/jobs/deadlines";
import { formatFieldValue, formatIsoDate } from "@/lib/jobs/field-labels";

/**
 * Čistá logika karty zakázky: časová osa stavů, styly nabídek a historie,
 * seskupení dokumentů, varování k termínům, koncepty položek. Bez Reactu a DB
 * (testy v detail-helpers.test.ts).
 */

// ── Datum ───────────────────────────────────────────────────
/** RRRR-MM-DD v pražském čase. */
export function isoToday(now: Date = new Date()): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Prague" }).format(now);
}

/** RRRR-MM-DD + n dní (bez vlivu časových pásem). */
export function addDaysIso(iso: string, days: number): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso);
  const base = m ? Date.UTC(+m[1], +m[2] - 1, +m[3]) : Date.now();
  return new Date(base + days * 86_400_000).toISOString().slice(0, 10);
}

/** Datum (RRRR-MM-DD) nebo časové razítko → RRRR-MM-DD v pražském čase. */
export function toIsoDay(value: string | null | undefined): string | null {
  if (!value) return null;
  if (/^\d{4}-\d{2}-\d{2}$/.test(value)) return value;
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return null;
  return isoToday(d);
}

/** Krátké datum pod krok osy: „12. 3." (rok jen mimo letošek). */
export function shortDate(value: string | null | undefined, today: Date = new Date()): string | null {
  const iso = toIsoDay(value);
  if (!iso) return null;
  const [y, m, d] = iso.split("-").map(Number);
  return y === Number(isoToday(today).slice(0, 4)) ? `${d}. ${m}.` : `${d}. ${m}. ${y}`;
}

/** Dlouhé datum „12. 3. 2026" (prázdné → null). */
export function longDate(value: string | null | undefined): string | null {
  const iso = toIsoDay(value);
  return iso ? formatIsoDate(iso) : null;
}

/** Počet dní mezi dvěma daty (b − a). */
export function daysBetween(a: string, b: string): number {
  return dayNumber(b) - dayNumber(a);
}

// ── Čísla (české zadávání „1 234,5") ───────────────────────
/** Text z políčka → číslo; prázdné nebo nesmysl → null. */
export function parseDecimal(input: string | number | null | undefined): number | null {
  if (input === null || input === undefined) return null;
  if (typeof input === "number") return Number.isFinite(input) ? input : null;
  const s = input.replace(/[\s ]/g, "").replace(/(kč|czk|€|eur|%)$/i, "").replace(",", ".");
  if (!s) return null;
  if (!/^-?\d*\.?\d+$/.test(s) && !/^-?\d+\.$/.test(s)) return null;
  const n = Number(s);
  return Number.isFinite(n) ? n : null;
}

/** Neprázdný text, který není číslo. */
export function isInvalidDecimal(input: string): boolean {
  return input.trim() !== "" && parseDecimal(input) === null;
}

/** Číslo → text do políčka („1,5"). */
export function decimalInput(n: number | null | undefined): string {
  if (n === null || n === undefined || !Number.isFinite(n)) return "";
  return String(Math.round(n * 1000) / 1000).replace(".", ",");
}

export function formatQty(n: number): string {
  return new Intl.NumberFormat("cs-CZ", { maximumFractionDigits: 3 }).format(n);
}

/** Částka s měnou („12 500 Kč", „1 200,50 EUR"). */
export function formatMoney(n: number | null | undefined, currency = "CZK"): string {
  if (n === null || n === undefined || !Number.isFinite(n)) return "—";
  try {
    return new Intl.NumberFormat("cs-CZ", {
      style: "currency", currency: currency || "CZK",
      maximumFractionDigits: Number.isInteger(n) ? 0 : 2,
    }).format(n);
  } catch {
    return `${formatQty(n)} ${currency}`;
  }
}

export function formatPercent(share: number | null | undefined): string {
  if (share === null || share === undefined || !Number.isFinite(share)) return "—";
  return `${new Intl.NumberFormat("cs-CZ", { maximumFractionDigits: 1 }).format(share * 100)} %`;
}

// ── Časová osa stavů ────────────────────────────────────────
export type StepState = "done" | "current" | "todo";

export interface TimelineStep {
  stage: JobStage;
  state: StepState;
  /** Kdy byl krok dosažen (RRRR-MM-DD nebo ISO razítko). */
  date: string | null;
  /** Volitelný krok (sklad, montáž) vložený do toku. */
  optional: boolean;
}

export interface Timeline {
  steps: TimelineStep[];
  /** Speciální stav mimo tok (pozastaveno, reklamace, …) — zobrazí se jako stuha. */
  side: JobStage | null;
  /** Kolik kroků je hotovo (pro „3 / 10"). */
  doneCount: number;
}

export type TimelineInput = Pick<
  JobDetail,
  | "stage" | "inquiryDate" | "orderDate" | "confirmedAt" | "productionStartedAt" | "receivedAt"
  | "deliveredAt" | "invoicedAt" | "stageChangedAt"
> & { quotes: Pick<JobQuote, "createdAt" | "sentAt">[] };

function earliest(values: (string | null | undefined)[]): string | null {
  const list = values.filter((v): v is string => Boolean(v)).sort();
  return list[0] ?? null;
}

/** Datum dosažení kroku z údajů zakázky (null = nevíme). */
export function stepDate(stage: JobStage, j: TimelineInput): string | null {
  switch (stage) {
    case "poptavka": return j.inquiryDate;
    case "naceneni": return earliest(j.quotes.map((q) => q.createdAt));
    case "nabidka": return earliest(j.quotes.map((q) => q.sentAt));
    case "objednavka": return j.orderDate;
    case "potvrzeno": return j.confirmedAt;
    case "ve_vyrobe": return j.productionStartedAt;
    case "dodano_k_nam": return j.receivedAt;
    case "dodano_zakaznikovi": return j.deliveredAt;
    case "fakturovano": return j.invoicedAt;
    default: return null;
  }
}

/**
 * Kroky toku pro kartu zakázky. Volitelný krok (sklad / montáž) se vloží jen,
 * když v něm zakázka právě je. U speciálního stavu se hotové kroky odvodí z dat.
 */
export function buildTimeline(j: TimelineInput): Timeline {
  const stage = isJobStage(j.stage) ? j.stage : "poptavka";
  const flow: { stage: JobStage; optional: boolean }[] = MAIN_FLOW.map((s) => ({ stage: s, optional: false }));
  if (stage === "na_sklade" || stage === "montaz") {
    const at = flow.findIndex((f) => f.stage === "dodano_k_nam");
    flow.splice(at + 1, 0, { stage, optional: true });
  }

  const currentRank = stageRank(stage);
  const side = currentRank < 0 ? stage : null;

  // u speciálního stavu = poslední krok, o kterém víme, že proběhl
  let reachedRank = currentRank;
  if (side) {
    reachedRank = -1;
    for (const f of flow) {
      if (stepDate(f.stage, j)) reachedRank = Math.max(reachedRank, stageRank(f.stage));
    }
  }

  const steps = flow.map((f): TimelineStep => {
    const rank = stageRank(f.stage);
    let state: StepState;
    if (side) state = rank <= reachedRank ? "done" : "todo";
    else state = rank < currentRank ? "done" : rank === currentRank ? "current" : "todo";
    let date = stepDate(f.stage, j);
    if (!date && state === "current") date = j.stageChangedAt ?? null;
    return { stage: f.stage, state, date: state === "todo" ? null : date, optional: f.optional };
  });

  return { steps, side, doneCount: steps.filter((s) => s.state !== "todo").length };
}

// ── Termíny ─────────────────────────────────────────────────
export type DeadlineField =
  | "customerRequiredDate" | "dueDate" | "expectedDeliveryDate" | "supplierPromisedDate" | "maxToleratedDate";

export const DEADLINE_FIELDS: { key: DeadlineField; label: string; hint: string }[] = [
  { key: "customerRequiredDate", label: "Požadovaný zákazníkem", hint: "Kdy to zákazník chce." },
  { key: "dueDate", label: "Potvrzený termín", hint: "Co jsme slíbili zákazníkovi — hlídá se." },
  { key: "expectedDeliveryDate", label: "Předpokládané dodání", hint: "Náš aktuální odhad." },
  { key: "supplierPromisedDate", label: "Slíbil dodavatel", hint: "Kdy dodavatel slíbil dodat k nám." },
  { key: "maxToleratedDate", label: "Max. tolerovaný", hint: "Poslední záchrana — pak je průšvih." },
];

export type DeadlineFields = Pick<JobDetail, "stage" | DeadlineField> & { receivedAt?: string | null };

/** Díly už dorazily k nám — slib dodavatele se dál nehlídá. */
export function isReceived(stage: JobStage, receivedAt?: string | null): boolean {
  const rank = stageRank(stage);
  return rank >= stageRank("dodano_k_nam") || (rank < 0 && Boolean(receivedAt));
}

export interface DeadlineWarning {
  tone: "info" | "warn" | "danger";
  text: string;
}

/** Varování k termínům (dodavatel slíbil později, po max. tolerovaném termínu…). */
export function deadlineWarnings(j: DeadlineFields, today: Date = new Date()): DeadlineWarning[] {
  if (DELIVERED_STAGES.includes(j.stage) || CLOSED_STAGES.includes(j.stage)) return [];
  const out: DeadlineWarning[] = [];
  const now = dayNumber(isoToday(today));
  const target = effectiveDeadline({ stage: j.stage, dueDate: j.dueDate, customerRequiredDate: j.customerRequiredDate, maxToleratedDate: j.maxToleratedDate });
  const targetLabel = j.dueDate ? "potvrzený termín" : "požadovaný termín";
  const fmt = (d: string) => formatIsoDate(d) ?? d;

  if (j.maxToleratedDate && now > dayNumber(j.maxToleratedDate)) {
    const late = now - dayNumber(j.maxToleratedDate);
    out.push({ tone: "danger", text: `Překročen maximální tolerovaný termín (${fmt(j.maxToleratedDate)}) o ${late} ${plural(late, "den", "dny", "dní")} — volej zákazníkovi.` });
  }
  const supplier = isReceived(j.stage, j.receivedAt) ? null : j.supplierPromisedDate;
  if (supplier && j.maxToleratedDate && dayNumber(supplier) > dayNumber(j.maxToleratedDate)) {
    out.push({ tone: "danger", text: `Dodavatel slíbil až ${fmt(supplier)} — to je i po maximálním tolerovaném termínu.` });
  } else if (supplier && target && dayNumber(supplier) > dayNumber(target)) {
    const diff = dayNumber(supplier) - dayNumber(target);
    out.push({ tone: "warn", text: `Dodavatel slíbil ${fmt(supplier)} — o ${diff} ${plural(diff, "den", "dny", "dní")} později než ${targetLabel} (${fmt(target)}).` });
  }
  if (j.expectedDeliveryDate && target && dayNumber(j.expectedDeliveryDate) > dayNumber(target)) {
    out.push({ tone: "warn", text: `Předpokládané dodání ${fmt(j.expectedDeliveryDate)} je až po termínu (${fmt(target)}).` });
  }
  if (j.dueDate && j.customerRequiredDate && dayNumber(j.dueDate) > dayNumber(j.customerRequiredDate)) {
    out.push({ tone: "info", text: `Potvrdili jsme pozdější termín, než zákazník chtěl (${fmt(j.customerRequiredDate)}).` });
  }
  return out;
}

/** Stav jednoho data vůči dnešku: pro barvu dlaždice termínu. */
export function dateTone(date: string | null, stage: JobStage, today: Date = new Date()): "none" | "done" | "ok" | "soon" | "today" | "past" {
  if (!date) return "none";
  if (DELIVERED_STAGES.includes(stage) || CLOSED_STAGES.includes(stage)) return "done";
  const diff = dayNumber(date) - dayNumber(isoToday(today));
  if (diff > 7) return "ok";
  if (diff > 0) return "soon";
  if (diff === 0) return "today";
  return "past";
}

export function relativeDays(date: string, today: Date = new Date()): string {
  const diff = dayNumber(date) - dayNumber(isoToday(today));
  if (diff === 0) return "dnes";
  if (diff === 1) return "zítra";
  if (diff === -1) return "včera";
  if (diff > 0) return `za ${diff} ${plural(diff, "den", "dny", "dní")}`;
  return `před ${-diff} ${plural(-diff, "dnem", "dny", "dny")}`;
}

// ── Priorita ────────────────────────────────────────────────
export const PRIORITY_META: Record<PriorityLevel, { label: string; active: string; dot: string }> = {
  nizka: { label: "Nízká", active: "bg-slate-600 text-white dark:bg-slate-500", dot: "bg-slate-400" },
  stredni: { label: "Střední", active: "bg-amber-500 text-white", dot: "bg-amber-500" },
  vysoka: { label: "Vysoká", active: "bg-red-600 text-white", dot: "bg-red-500" },
};

export const PRIORITY_ORDER: PriorityLevel[] = ["nizka", "stredni", "vysoka"];

// ── Nabídky ─────────────────────────────────────────────────
export interface QuoteStatusMeta {
  label: string;
  badge: string;
  dot: string;
  /** Proužek karty. */
  bar: string;
  hint: string;
}

export const QUOTE_STATUS_META: Record<QuoteStatus, QuoteStatusMeta> = {
  navrh_ai: {
    label: "Návrh AI", badge: "bg-slate-100 text-slate-700 dark:bg-slate-500/20 dark:text-slate-300",
    dot: "bg-slate-400", bar: "bg-slate-300 dark:bg-slate-600", hint: "Připravila AI — zkontroluj a schval.",
  },
  ke_schvaleni: {
    label: "Ke schválení", badge: "bg-amber-100 text-amber-800 dark:bg-amber-500/15 dark:text-amber-300",
    dot: "bg-amber-500", bar: "bg-amber-400", hint: "Čeká na schválení a odeslání zákazníkovi.",
  },
  odeslano: {
    label: "Odesláno", badge: "bg-violet-100 text-violet-800 dark:bg-violet-500/15 dark:text-violet-300",
    dot: "bg-violet-500", bar: "bg-violet-500", hint: "Odešla zákazníkovi — čekáme na odpověď.",
  },
  prijato: {
    label: "Přijato", badge: "bg-green-100 text-green-800 dark:bg-green-500/15 dark:text-green-300",
    dot: "bg-green-500", bar: "bg-green-500", hint: "Zákazník nabídku přijal.",
  },
  zamitnuto: {
    label: "Zamítnuto", badge: "bg-red-100 text-red-700 dark:bg-red-500/15 dark:text-red-300",
    dot: "bg-red-500", bar: "bg-red-400", hint: "Zákazník nabídku nepřijal.",
  },
};

export function quoteStatusMeta(status: string): QuoteStatusMeta {
  return QUOTE_STATUS_META[status as QuoteStatus] ?? QUOTE_STATUS_META.ke_schvaleni;
}

export type QuoteAction =
  | "approve" | "edit" | "send" | "markSent" | "accept" | "reject" | "revision" | "archive" | "unarchive"
  | "pdf" | "delete";

/** Které akce nabídka v daném stavu nabízí (pořadí = pořadí tlačítek). */
export function quoteActions(q: Pick<JobQuote, "status" | "approvedBy" | "archived" | "accepted">, opts: { canDelete: boolean }): QuoteAction[] {
  const out: QuoteAction[] = [];
  const open = q.status === "navrh_ai" || q.status === "ke_schvaleni";
  if (!q.archived) {
    if (open && !q.approvedBy) out.push("approve");
    if (open || q.status === "odeslano") out.push("send");
    if (open) out.push("markSent", "edit");
    if ((q.status === "odeslano" || q.status === "ke_schvaleni") && !q.accepted) out.push("accept");
    if (q.status !== "prijato" && q.status !== "zamitnuto") out.push("reject");
    out.push("revision");
  }
  out.push("pdf");
  out.push(q.archived ? "unarchive" : "archive");
  if (opts.canDelete) out.push("delete");
  return out;
}

/** Aktuální nabídky (nejnovější první) a archivované starší verze. */
export function splitQuotes<T extends Pick<JobQuote, "archived" | "createdAt" | "revision">>(quotes: T[]): { current: T[]; archived: T[] } {
  const sorted = [...quotes].sort((a, b) => b.createdAt.localeCompare(a.createdAt) || b.revision - a.revision);
  return { current: sorted.filter((q) => !q.archived), archived: sorted.filter((q) => q.archived) };
}

/** Nabídka pro doklad „Nabídka" (přijatá, jinak nejnovější aktuální nezamítnutá). */
export function primaryQuote<T extends Pick<JobQuote, "id" | "archived" | "createdAt" | "revision" | "status">>(
  quotes: T[], acceptedQuoteId: string | null,
): T | null {
  if (acceptedQuoteId) {
    const acc = quotes.find((q) => q.id === acceptedQuoteId);
    if (acc) return acc;
  }
  const { current } = splitQuotes(quotes);
  return current.find((q) => q.status !== "zamitnuto") ?? current[0] ?? null;
}

// ── Historie ────────────────────────────────────────────────
export const EVENT_TONES: Record<JobEvent["type"], string> = {
  created: "bg-sky-100 text-sky-700 dark:bg-sky-500/15 dark:text-sky-300",
  stage: "bg-slate-100 text-slate-700 dark:bg-slate-500/20 dark:text-slate-300",
  field: "bg-slate-100 text-slate-700 dark:bg-slate-500/20 dark:text-slate-300",
  file: "bg-emerald-100 text-emerald-700 dark:bg-emerald-500/15 dark:text-emerald-300",
  quote: "bg-violet-100 text-violet-700 dark:bg-violet-500/15 dark:text-violet-300",
  comment: "bg-blue-100 text-blue-700 dark:bg-blue-500/15 dark:text-blue-300",
  ai: "bg-fuchsia-100 text-fuchsia-700 dark:bg-fuchsia-500/15 dark:text-fuchsia-300",
  email: "bg-cyan-100 text-cyan-700 dark:bg-cyan-500/15 dark:text-cyan-300",
};

export const EVENT_TYPE_LABELS: Record<JobEvent["type"], string> = {
  created: "Založení",
  stage: "Stav",
  field: "Změny",
  file: "Dokumenty",
  quote: "Nabídky",
  comment: "Komentáře",
  ai: "AI",
  email: "E-maily",
};

/** Cílový stav u události změny stavu. */
export function eventStage(e: Pick<JobEvent, "type" | "data">): { from: JobStage | null; to: JobStage } | null {
  if (e.type !== "stage") return null;
  const to = e.data?.to;
  if (!isJobStage(to)) return null;
  const from = e.data?.from;
  return { from: isJobStage(from) ? from : null, to };
}

/** Barva ikony události (stav = barva cílového stavu). */
export function eventTone(e: Pick<JobEvent, "type" | "data">): string {
  const st = eventStage(e);
  if (st) return STAGES[st.to].badge;
  return EVENT_TONES[e.type] ?? EVENT_TONES.field;
}

export interface EventChange {
  field: string;
  label: string;
  from: string;
  to: string;
  sensitive: boolean;
}

/** Změny polí z data.changes (texty od serveru, jinak formatFieldValue). */
export function eventChanges(data: Record<string, unknown> | null | undefined): EventChange[] {
  const raw = data?.changes;
  if (!Array.isArray(raw)) return [];
  const out: EventChange[] = [];
  for (const c of raw) {
    if (!c || typeof c !== "object") continue;
    const r = c as Record<string, unknown>;
    const field = typeof r.field === "string" ? r.field : "";
    const label = typeof r.label === "string" && r.label ? r.label : field;
    if (!label) continue;
    const sensitive = r.sensitive === true;
    const from = typeof r.fromText === "string" ? r.fromText : formatFieldValue(field, r.from);
    const to = typeof r.toText === "string" ? r.toText : formatFieldValue(field, r.to);
    out.push({ field, label, from: sensitive ? "" : from, to: sensitive ? "" : to, sensitive });
  }
  return out;
}

// ── Dokumenty ───────────────────────────────────────────────
export interface FileGroup<T> {
  kind: JobFileKind;
  current: T[];
  archived: T[];
}

/** Dokumenty po druzích v pořadí FILE_KIND_ORDER (jen neprázdné skupiny). */
export function groupFiles<T extends Pick<JobFile, "kind" | "archived" | "createdAt" | "version">>(files: T[]): FileGroup<T>[] {
  const map = new Map<JobFileKind, FileGroup<T>>();
  const sorted = [...files].sort((a, b) => b.createdAt.localeCompare(a.createdAt) || b.version - a.version);
  for (const f of sorted) {
    const kind: JobFileKind = isJobFileKind(f.kind) ? f.kind : "ostatni";
    let g = map.get(kind);
    if (!g) {
      g = { kind, current: [], archived: [] };
      map.set(kind, g);
    }
    (f.archived ? g.archived : g.current).push(f);
  }
  return FILE_KIND_ORDER.filter((k) => map.has(k)).map((k) => map.get(k)!);
}

/** „nahrazeno v3" — verze dokumentu, který tento nahradil. */
export function replacedByLabel(file: Pick<JobFile, "replacedBy">, all: Pick<JobFile, "id" | "version">[]): string | null {
  if (!file.replacedBy) return null;
  const next = all.find((f) => f.id === file.replacedBy);
  return next ? `nahrazeno v${next.version}` : "nahrazeno novější verzí";
}

export function isImageFile(f: Pick<JobFile, "mimeType" | "filename">): boolean {
  if (f.mimeType?.startsWith("image/")) return !/svg|heic|heif|tiff/i.test(f.mimeType);
  return /\.(jpe?g|png|gif|webp|bmp)$/i.test(f.filename);
}

export function isPdfFile(f: Pick<JobFile, "mimeType" | "filename">): boolean {
  return f.mimeType === "application/pdf" || /\.pdf$/i.test(f.filename);
}

export function formatBytes(n: number | null | undefined): string {
  if (!n || n <= 0) return "";
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${Math.round(n / 1024)} kB`;
  return `${new Intl.NumberFormat("cs-CZ", { maximumFractionDigits: 1 }).format(n / 1024 / 1024)} MB`;
}

// ── Koncepty položek (editor) ───────────────────────────────
export interface ItemDraft {
  key: string;
  id?: string;
  drawingNumber: string;
  revision: string;
  name: string;
  description: string;
  material: string;
  quantity: string;
  unit: string;
  unitPrice: string;
  purchaseUnitPrice: string;
  vatRate: string;
  note: string;
}

let draftSeq = 0;
export function newDraftKey(): string {
  draftSeq += 1;
  return `n${draftSeq}`;
}

export function emptyItemDraft(): ItemDraft {
  return {
    key: newDraftKey(), drawingNumber: "", revision: "", name: "", description: "", material: "",
    quantity: "1", unit: "ks", unitPrice: "", purchaseUnitPrice: "", vatRate: "21", note: "",
  };
}

export function itemToDraft(it: Pick<JobItem, "id" | "drawingNumber" | "name" | "description" | "material" | "quantity" | "unit" | "unitPrice" | "purchaseUnitPrice" | "note"> & { revision?: string | null; vatRate?: number }): ItemDraft {
  return {
    key: it.id || newDraftKey(),
    id: it.id,
    drawingNumber: it.drawingNumber ?? "",
    revision: it.revision ?? "",
    name: it.name ?? "",
    description: it.description ?? "",
    material: it.material ?? "",
    quantity: decimalInput(it.quantity) || "1",
    unit: it.unit || "ks",
    unitPrice: decimalInput(it.unitPrice),
    purchaseUnitPrice: decimalInput(it.purchaseUnitPrice),
    vatRate: decimalInput(it.vatRate ?? 21) || "21",
    note: it.note ?? "",
  };
}

/** Prázdný řádek (nic nevyplněno) se při ukládání vynechá. */
export function isBlankDraft(d: ItemDraft): boolean {
  return !d.drawingNumber.trim() && !d.name.trim() && !d.description.trim() && !d.material.trim() &&
    !d.unitPrice.trim() && !d.purchaseUnitPrice.trim() && !d.note.trim() && !d.revision.trim();
}

/** Kontrola konceptů — česká chyba nebo null. */
export function validateDrafts(drafts: ItemDraft[]): string | null {
  let n = 0;
  for (const d of drafts) {
    if (isBlankDraft(d)) continue;
    n += 1;
    const q = parseDecimal(d.quantity);
    if (q === null || q <= 0) return `Položka ${n}: zadej množství větší než 0.`;
    if (isInvalidDecimal(d.unitPrice) || (parseDecimal(d.unitPrice) ?? 0) < 0) return `Položka ${n}: cena za MJ musí být číslo.`;
    if (isInvalidDecimal(d.purchaseUnitPrice) || (parseDecimal(d.purchaseUnitPrice) ?? 0) < 0) return `Položka ${n}: nákupní cena musí být číslo.`;
    if (isInvalidDecimal(d.vatRate)) return `Položka ${n}: DPH musí být číslo.`;
  }
  return null;
}

/** Koncept → vstup akce saveJobItems (nákupní cena jen s právem na marže). */
export function draftToItemInput(d: ItemDraft, margins: boolean): JobItemInput {
  const out: JobItemInput = {
    drawingNumber: d.drawingNumber.trim(),
    revision: d.revision.trim(),
    name: d.name.trim(),
    description: d.description.trim(),
    material: d.material.trim(),
    quantity: parseDecimal(d.quantity) ?? 1,
    unit: d.unit.trim() || "ks",
    unitPrice: parseDecimal(d.unitPrice),
    note: d.note.trim(),
  };
  if (d.id) out.id = d.id;
  if (margins) out.purchaseUnitPrice = parseDecimal(d.purchaseUnitPrice);
  return out;
}

export function draftToQuoteItemInput(d: ItemDraft, margins: boolean): JobQuoteItemInput {
  const vat = parseDecimal(d.vatRate);
  const out: JobQuoteItemInput = {
    drawingNumber: d.drawingNumber.trim(),
    name: d.name.trim(),
    description: d.description.trim(),
    material: d.material.trim(),
    quantity: parseDecimal(d.quantity) ?? 1,
    unit: d.unit.trim() || "ks",
    unitPrice: parseDecimal(d.unitPrice),
    vatRate: vat === null ? 21 : vat,
    note: d.note.trim(),
  };
  if (margins) out.purchaseUnitPrice = parseDecimal(d.purchaseUnitPrice);
  return out;
}

export interface DraftTotals {
  /** Bez DPH (null = žádná cena). */
  net: number | null;
  vat: number | null;
  gross: number | null;
  purchase: number | null;
  quantity: number;
  /** Marže jako podíl. */
  margin: number | null;
  unpriced: number;
}

const r2 = (n: number) => Math.round(n * 100) / 100;

export function draftTotals(drafts: ItemDraft[]): DraftTotals {
  let net: number | null = null;
  let vat: number | null = null;
  let purchase: number | null = null;
  let quantity = 0;
  let unpriced = 0;
  for (const d of drafts) {
    if (isBlankDraft(d)) continue;
    const q = parseDecimal(d.quantity) ?? 0;
    quantity += q;
    const up = parseDecimal(d.unitPrice);
    const pp = parseDecimal(d.purchaseUnitPrice);
    const rate = parseDecimal(d.vatRate) ?? 21;
    if (up === null) unpriced += 1;
    else {
      net = (net ?? 0) + q * up;
      vat = (vat ?? 0) + (q * up * rate) / 100;
    }
    if (pp !== null) purchase = (purchase ?? 0) + q * pp;
  }
  const margin = net !== null && purchase !== null && net > 0 ? Math.round(((net - purchase) / net) * 10000) / 10000 : null;
  return {
    net: net === null ? null : r2(net),
    vat: vat === null ? null : r2(vat),
    gross: net === null ? null : r2(net + (vat ?? 0)),
    purchase: purchase === null ? null : r2(purchase),
    quantity: Math.round(quantity * 1000) / 1000,
    margin,
    unpriced,
  };
}

/** Řádek × množství (null bez ceny). */
export function lineTotal(d: Pick<ItemDraft, "quantity" | "unitPrice">): number | null {
  const q = parseDecimal(d.quantity);
  const p = parseDecimal(d.unitPrice);
  if (q === null || p === null) return null;
  return r2(q * p);
}

/** Podpis konceptů pro „máš neuložené změny". */
export function draftsSignature(drafts: ItemDraft[]): string {
  return JSON.stringify(drafts.filter((d) => !isBlankDraft(d)).map((d) => [
    d.id ?? "", d.drawingNumber.trim(), d.revision.trim(), d.name.trim(), d.description.trim(), d.material.trim(),
    parseDecimal(d.quantity), d.unit.trim() || "ks", parseDecimal(d.unitPrice), parseDecimal(d.purchaseUnitPrice),
    parseDecimal(d.vatRate), d.note.trim(),
  ]));
}

/** Přesun prvku v poli (nová kopie). */
export function moveItem<T>(arr: T[], from: number, to: number): T[] {
  if (from < 0 || from >= arr.length || to < 0 || to >= arr.length || from === to) return arr;
  const next = [...arr];
  const [x] = next.splice(from, 1);
  next.splice(to, 0, x);
  return next;
}

// ── Formulář nabídky ────────────────────────────────────────
export interface QuoteFormState {
  title: string;
  validUntil: string;
  leadTimeDays: string;
  deliveryTerms: string;
  paymentTerms: string;
  note: string;
  items: ItemDraft[];
}

/** Nová nabídka z položek zakázky: platnost +30 dní, lhůta podle požadovaného termínu. */
export function quoteFormFromJob(
  j: Pick<JobDetail, "title" | "items" | "customerRequiredDate" | "dueDate" | "deliveryMethod"> & {
    customerDetail: { paymentTermsDays: number | null } | null;
  },
  today: Date = new Date(),
): QuoteFormState {
  const now = isoToday(today);
  const wanted = j.customerRequiredDate ?? j.dueDate;
  const lead = wanted ? daysBetween(now, wanted) : null;
  const days = j.customerDetail?.paymentTermsDays;
  return {
    title: j.title ?? "",
    validUntil: addDaysIso(now, 30),
    leadTimeDays: lead !== null && lead > 0 ? String(lead) : "",
    deliveryTerms: j.deliveryMethod ?? "",
    paymentTerms: days ? `Splatnost ${days} dní od vystavení faktury` : "",
    note: "",
    items: j.items.length ? j.items.map((it) => ({ ...itemToDraft(it), id: undefined, key: newDraftKey() })) : [emptyItemDraft()],
  };
}

export function quoteFormFromQuote(q: JobQuote): QuoteFormState {
  return {
    title: q.title ?? "",
    validUntil: q.validUntil ?? "",
    leadTimeDays: q.leadTimeDays === null ? "" : String(q.leadTimeDays),
    deliveryTerms: q.deliveryTerms ?? "",
    paymentTerms: q.paymentTerms ?? "",
    note: q.note ?? "",
    items: q.items.length
      ? q.items.map((it) => ({ ...itemToDraft({ ...it, revision: null }), id: undefined, key: newDraftKey() }))
      : [emptyItemDraft()],
  };
}

/** Kontrola formuláře nabídky — česká chyba nebo null. */
export function validateQuoteForm(f: QuoteFormState): string | null {
  const items = f.items.filter((d) => !isBlankDraft(d));
  if (!items.length) return "Přidej alespoň jednu položku.";
  const bad = validateDrafts(items);
  if (bad) return bad;
  if (f.validUntil && !/^\d{4}-\d{2}-\d{2}$/.test(f.validUntil)) return "Neplatné datum platnosti.";
  if (f.leadTimeDays.trim()) {
    const n = parseDecimal(f.leadTimeDays);
    if (n === null || n < 0 || n > 3650) return "Dodací lhůta musí být počet dní (0–3650).";
  }
  return null;
}

export function quoteFormToInput(f: QuoteFormState, margins: boolean): JobQuoteInput {
  const lead = parseDecimal(f.leadTimeDays);
  return {
    title: f.title.trim(),
    validUntil: f.validUntil,
    leadTimeDays: lead === null ? null : Math.round(lead),
    deliveryTerms: f.deliveryTerms.trim(),
    paymentTerms: f.paymentTerms.trim(),
    note: f.note.trim(),
    items: f.items.filter((d) => !isBlankDraft(d)).map((d) => draftToQuoteItemInput(d, margins)),
  };
}

// ── Štítky ──────────────────────────────────────────────────
/** „a, b;c" → ["a","b","c"] bez duplicit (velikost písmen se ignoruje). */
export function parseTags(input: string, existing: string[] = []): string[] {
  const out = [...existing];
  const seen = new Set(existing.map((t) => t.toLowerCase()));
  for (const raw of input.split(/[,;\n]/)) {
    const t = raw.trim().replace(/^#/, "").slice(0, 40);
    if (!t || seen.has(t.toLowerCase())) continue;
    seen.add(t.toLowerCase());
    out.push(t);
  }
  return out.slice(0, 30);
}

/** Barva štítku podle textu (stabilní, ať je kniha barevná). */
const TAG_TONES = [
  "bg-sky-100 text-sky-800 dark:bg-sky-500/15 dark:text-sky-300",
  "bg-violet-100 text-violet-800 dark:bg-violet-500/15 dark:text-violet-300",
  "bg-amber-100 text-amber-800 dark:bg-amber-500/15 dark:text-amber-300",
  "bg-emerald-100 text-emerald-800 dark:bg-emerald-500/15 dark:text-emerald-300",
  "bg-pink-100 text-pink-800 dark:bg-pink-500/15 dark:text-pink-300",
  "bg-cyan-100 text-cyan-800 dark:bg-cyan-500/15 dark:text-cyan-300",
  "bg-orange-100 text-orange-800 dark:bg-orange-500/15 dark:text-orange-300",
];

export function tagTone(tag: string): string {
  let h = 0;
  for (const ch of tag.toLowerCase()) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  return TAG_TONES[h % TAG_TONES.length];
}

// ── Záložky ─────────────────────────────────────────────────
export type DetailTab = "prehled" | "vyroba" | "polozky" | "nabidky" | "nakup" | "dokumenty" | "historie";
export const DETAIL_TABS: DetailTab[] = ["prehled", "vyroba", "polozky", "nabidky", "nakup", "dokumenty", "historie"];

export function isDetailTab(v: unknown): v is DetailTab {
  return typeof v === "string" && (DETAIL_TABS as string[]).includes(v);
}

/** Výběr z možností vyhledávání (bez diakritiky, prefix má přednost). */
export function normalizeSearch(s: string): string {
  return s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().trim();
}

export function filterOptions<T extends { label: string; sub?: string | null }>(options: T[], query: string, limit = 50): T[] {
  const q = normalizeSearch(query);
  if (!q) return options.slice(0, limit);
  const scored: { o: T; s: number }[] = [];
  for (const o of options) {
    const l = normalizeSearch(o.label);
    const sub = normalizeSearch(o.sub ?? "");
    const s = l.startsWith(q) ? 0 : l.includes(q) ? 1 : sub.includes(q) ? 2 : -1;
    if (s >= 0) scored.push({ o, s });
  }
  return scored.sort((a, b) => a.s - b.s).slice(0, limit).map((x) => x.o);
}
