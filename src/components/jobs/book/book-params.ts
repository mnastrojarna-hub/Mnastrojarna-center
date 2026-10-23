import type { JobStage } from "@/lib/supabase/database.types";
import type { JobDeadlineFilter, JobFilters, JobListItem, JobPaymentFilter, JobSort } from "@/lib/jobs/types";
import { STAGE_ORDER, isJobStage } from "@/lib/jobs/stages";
import { isOperationKind } from "@/lib/jobs/operations";
import {
  DELIVERY_STATES, INQUIRY_ORDER, ORDER_TAB_CHIPS, isInquiryStatus, type DeliveryState, type InquiryStatus,
} from "@/lib/jobs/flow-status";

/**
 * Kniha zakázek — parametry URL ↔ filtry, segmenty (záložky), řazení,
 * skupiny pro tabuli a drobné formátovací pomocníky. Čistá logika bez Reactu
 * (sdílí server i klient, testy v book-params.test.ts).
 */

// ── Segmenty (záložky knihy) ────────────────────────────────
export type BookSegmentKey = "objednavky" | "poptavky" | "dokoncene" | "nerealizovane" | "vse";
export type BookView = "radky" | "tabule";
export type SortDir = "asc" | "desc";

export interface BookSegment {
  key: BookSegmentKey;
  label: string;
  /** Krátký popisek (mobil). */
  short: string;
  /** Jednou větou, co v záložce je. */
  hint: string;
  stages: JobStage[];
}

/** Objednávky — hlavní pohled knihy (vč. pozastavených a reklamací). */
export const ORDER_STAGES: JobStage[] = [
  "objednavka", "potvrzeno", "ve_vyrobe", "dodano_k_nam", "na_sklade", "montaz",
  "dodano_zakaznikovi", "fakturovano", "pozastaveno", "reklamace",
];
/** Předobjednávková fáze. */
export const INQUIRY_STAGES: JobStage[] = ["poptavka", "naceneni", "nabidka"];
export const PROBLEM_STAGES: JobStage[] = ["reklamace", "pozastaveno"];

export const BOOK_SEGMENTS: BookSegment[] = [
  { key: "objednavky", label: "Objednávky", short: "Objednávky", hint: "Objednané zakázky od objednávky po fakturu.", stages: ORDER_STAGES },
  { key: "poptavky", label: "Poptávky & nabídky", short: "Poptávky", hint: "Poptávky, nacenění a odeslané nabídky — před objednávkou.", stages: INQUIRY_STAGES },
  { key: "dokoncene", label: "Dokončené", short: "Hotové", hint: "Uzavřené a zaplacené zakázky.", stages: ["dokonceno"] },
  { key: "nerealizovane", label: "Nerealizované & zrušené", short: "Nerealiz.", hint: "Prohrané nabídky a zrušené zakázky.", stages: ["nerealizovano", "zruseno"] },
  { key: "vse", label: "Vše", short: "Vše", hint: "Celá kniha zakázek.", stages: STAGE_ORDER },
];

export const DEFAULT_SEGMENT: BookSegmentKey = "objednavky";

export function isBookSegment(v: unknown): v is BookSegmentKey {
  return typeof v === "string" && BOOK_SEGMENTS.some((s) => s.key === v);
}

export function bookSegment(key: BookSegmentKey): BookSegment {
  return BOOK_SEGMENTS.find((s) => s.key === key) ?? BOOK_SEGMENTS[0];
}

/** Do které záložky stav patří (pro „Vše" se nehledá). */
export function segmentOfStage(stage: JobStage): BookSegmentKey {
  return BOOK_SEGMENTS.find((s) => s.key !== "vse" && s.stages.includes(stage))?.key ?? "vse";
}

/** Výchozí stav nové zakázky podle otevřené záložky. */
export function defaultStageFor(segment: BookSegmentKey): JobStage {
  return segment === "poptavky" ? "poptavka" : "objednavka";
}

// ── Řazení a termíny ────────────────────────────────────────
export interface BookSortOption {
  key: JobSort;
  label: string;
  defaultDir: SortDir;
}

export const BOOK_SORTS: BookSortOption[] = [
  { key: "created", label: "Nejnovější", defaultDir: "desc" },
  { key: "deadline", label: "Termín", defaultDir: "asc" },
  { key: "number", label: "Číslo", defaultDir: "desc" },
  { key: "customer", label: "Zákazník", defaultDir: "asc" },
  { key: "value", label: "Hodnota", defaultDir: "desc" },
  { key: "stage", label: "Stav", defaultDir: "asc" },
  { key: "updated", label: "Naposledy změněné", defaultDir: "desc" },
];

export const DEFAULT_SORT: JobSort = "created";

export function defaultDirFor(sort: JobSort): SortDir {
  return BOOK_SORTS.find((s) => s.key === sort)?.defaultDir ?? "desc";
}

export const DEADLINE_FILTERS: { key: JobDeadlineFilter; label: string }[] = [
  { key: "overdue", label: "Po termínu" },
  { key: "week", label: "Do 7 dní" },
  { key: "month", label: "Tento měsíc" },
  { key: "no_date", label: "Bez termínu" },
];

export const PAYMENT_FILTERS: { key: JobPaymentFilter; label: string }[] = [
  { key: "po_splatnosti", label: "Po splatnosti" },
  { key: "nezaplaceno", label: "Nezaplaceno" },
  { key: "ceka_na_uhradu", label: "Čeká na úhradu" },
  { key: "castecne_zaplaceno", label: "Částečně zaplaceno" },
  { key: "zaplaceno", label: "Zaplaceno" },
];

/** Dodání zákazníkovi (podrobný stav delivery_key) — pořadí filtru. */
export const DELIVERY_FILTERS: DeliveryState[] = ["k_expedici", "castecne", "dodano", "dl_potvrzen"];
export function deliveryLabel(k: DeliveryState): string {
  return DELIVERY_STATES[k].label;
}
/** Klíče chipů segmentu Objednávky (doklad + plnění, stejné jako /confirmations). */
export const ORDER_FILTER_KEYS: string[] = ORDER_TAB_CHIPS.map((c) => c.key);

function isDeliveryKey(v: unknown): v is DeliveryState {
  return typeof v === "string" && (DELIVERY_FILTERS as string[]).includes(v);
}

/** Seznam klíčů z URL („a,b") — jen povolené, bez duplicit, v daném pořadí. */
function keyList<T extends string>(raw: string | undefined, allowed: readonly T[]): T[] {
  const set = new Set((raw ?? "").split(",").map((s) => s.trim()));
  return allowed.filter((k) => set.has(k));
}

function isPaymentFilter(v: unknown): v is JobPaymentFilter {
  return typeof v === "string" && PAYMENT_FILTERS.some((p) => p.key === v);
}

/** Aktuální výrobní operace: druh operace nebo „hotovo" (výroba hotová). */
export function isProductionStepKey(v: unknown): v is string {
  return v === "hotovo" || isOperationKind(v);
}

function isSort(v: unknown): v is JobSort {
  return typeof v === "string" && BOOK_SORTS.some((s) => s.key === v);
}

function isDeadlineFilter(v: unknown): v is JobDeadlineFilter {
  return typeof v === "string" && DEADLINE_FILTERS.some((d) => d.key === v);
}

// ── Parametry knihy ─────────────────────────────────────────
export interface BookParams {
  segment: BookSegmentKey;
  /** Vybrané stavy (jen ze stavů segmentu, v pořadí knihy). Prázdné = celý segment. */
  stages: JobStage[];
  q: string;
  /** Obchodník (uuid) nebo "". */
  owner: string;
  /** Zpracovává (uuid) nebo "". */
  assignee: string;
  /** Zákazník (uuid) nebo "". */
  customer: string;
  deadline: JobDeadlineFilter | null;
  /** Výroba: aktuální operace (druh / „hotovo") nebo "". */
  step: string;
  /** Kde se zakázka nachází (firma / „U nás") nebo "". */
  location: string;
  payment: JobPaymentFilter | null;
  /** Poptávka: dílčí stavy (URL poptavka=). */
  inquiry: InquiryStatus[];
  /** Objednávka: doklad / plnění (URL objednavka=). */
  order: string[];
  /** Dodání zákazníkovi (URL dodani=). */
  delivery: DeliveryState[];
  /** Kdo naposledy posunul stav (uuid, URL zmenil=) nebo "". */
  changedBy: string;
  sort: JobSort;
  dir: SortDir;
  view: BookView;
}

export type BookPatch = Partial<BookParams>;

export type RawSearchParams =
  | Record<string, string | string[] | undefined>
  | URLSearchParams;

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export const MAX_QUERY = 200;
export const MAX_LOCATION = 300;

/** První hodnota parametru (Next předává string | string[]). */
export function firstParam(sp: RawSearchParams, key: string): string | undefined {
  if (sp instanceof URLSearchParams) return sp.get(key) ?? undefined;
  const v = sp[key];
  if (Array.isArray(v)) return v[0];
  return v ?? undefined;
}

function cleanId(v: string | undefined): string {
  const s = (v ?? "").trim();
  return UUID_RE.test(s) ? s.toLowerCase() : "";
}

/** Stavy omezené na segment, bez duplicit a v pořadí knihy. */
export function normalizeStages(stages: readonly string[], segment: BookSegmentKey): JobStage[] {
  const allowed = bookSegment(segment).stages;
  const set = new Set(stages.filter(isJobStage));
  return allowed.filter((s) => set.has(s));
}

export const DEFAULT_PARAMS: BookParams = {
  segment: DEFAULT_SEGMENT,
  stages: [],
  q: "",
  owner: "",
  assignee: "",
  customer: "",
  deadline: null,
  step: "",
  location: "",
  payment: null,
  inquiry: [],
  order: [],
  delivery: [],
  changedBy: "",
  sort: DEFAULT_SORT,
  dir: defaultDirFor(DEFAULT_SORT),
  view: "radky",
};

/** URL → parametry knihy (neplatné hodnoty = výchozí). */
export function parseBookParams(sp: RawSearchParams): BookParams {
  const segRaw = firstParam(sp, "segment");
  const segment = isBookSegment(segRaw) ? segRaw : DEFAULT_SEGMENT;
  const stages = normalizeStages((firstParam(sp, "stages") ?? "").split(",").map((s) => s.trim()), segment);
  const sortRaw = firstParam(sp, "sort");
  const sort = isSort(sortRaw) ? sortRaw : DEFAULT_SORT;
  const dirRaw = firstParam(sp, "dir");
  const dir: SortDir = dirRaw === "asc" || dirRaw === "desc" ? dirRaw : defaultDirFor(sort);
  const deadlineRaw = firstParam(sp, "deadline");
  const stepRaw = (firstParam(sp, "step") ?? "").trim();
  const paymentRaw = firstParam(sp, "payment");
  return {
    segment,
    stages,
    q: (firstParam(sp, "q") ?? "").trim().slice(0, MAX_QUERY),
    owner: cleanId(firstParam(sp, "owner")),
    assignee: cleanId(firstParam(sp, "assignee")),
    customer: cleanId(firstParam(sp, "customer")),
    deadline: isDeadlineFilter(deadlineRaw) ? deadlineRaw : null,
    step: isProductionStepKey(stepRaw) ? stepRaw : "",
    location: (firstParam(sp, "location") ?? "").trim().slice(0, MAX_LOCATION),
    payment: isPaymentFilter(paymentRaw) ? paymentRaw : null,
    inquiry: keyList(firstParam(sp, "poptavka"), INQUIRY_ORDER),
    order: keyList(firstParam(sp, "objednavka"), ORDER_FILTER_KEYS),
    delivery: keyList(firstParam(sp, "dodani"), DELIVERY_FILTERS),
    changedBy: cleanId(firstParam(sp, "zmenil")),
    sort,
    dir,
    view: firstParam(sp, "view") === "tabule" ? "tabule" : "radky",
  };
}

/** Parametry → query string (výchozí hodnoty se vynechávají; capture/pristup nikdy). */
export function bookQuery(p: BookParams): string {
  const out = new URLSearchParams();
  if (p.segment !== DEFAULT_SEGMENT) out.set("segment", p.segment);
  const stages = normalizeStages(p.stages, p.segment);
  if (stages.length) out.set("stages", stages.join(","));
  const q = p.q.trim().slice(0, MAX_QUERY);
  if (q) out.set("q", q);
  if (cleanId(p.owner)) out.set("owner", cleanId(p.owner));
  if (cleanId(p.assignee)) out.set("assignee", cleanId(p.assignee));
  if (cleanId(p.customer)) out.set("customer", cleanId(p.customer));
  if (p.deadline && isDeadlineFilter(p.deadline)) out.set("deadline", p.deadline);
  if (isProductionStepKey(p.step)) out.set("step", p.step);
  const location = (p.location ?? "").trim().slice(0, MAX_LOCATION);
  if (location) out.set("location", location);
  if (p.payment && isPaymentFilter(p.payment)) out.set("payment", p.payment);
  const inquiry = (p.inquiry ?? []).filter(isInquiryStatus);
  if (inquiry.length) out.set("poptavka", keyList(inquiry.join(","), INQUIRY_ORDER).join(","));
  const order = keyList((p.order ?? []).join(","), ORDER_FILTER_KEYS);
  if (order.length) out.set("objednavka", order.join(","));
  const delivery = (p.delivery ?? []).filter(isDeliveryKey);
  if (delivery.length) out.set("dodani", keyList(delivery.join(","), DELIVERY_FILTERS).join(","));
  if (cleanId(p.changedBy)) out.set("zmenil", cleanId(p.changedBy));
  const sort = isSort(p.sort) ? p.sort : DEFAULT_SORT;
  if (sort !== DEFAULT_SORT) out.set("sort", sort);
  if (p.dir !== defaultDirFor(sort)) out.set("dir", p.dir);
  if (p.view === "tabule") out.set("view", "tabule");
  return out.toString();
}

export function bookHref(p: BookParams): string {
  const qs = bookQuery(p);
  return qs ? `/orders?${qs}` : "/orders";
}

/** Adresa knihy v kanonickém tvaru — tak, jak ji po načtení vrátí server (parse → bookHref). */
export function canonicalBookHref(href: string): string {
  const sp: Record<string, string> = {};
  new URL(href, "http://kniha.local").searchParams.forEach((v, k) => {
    if (!(k in sp)) sp[k] = v;
  });
  return bookHref(parseBookParams(sp));
}

/**
 * Změna parametrů: nová záložka ruší výběr stavů, nové řazení bere svůj
 * výchozí směr (pokud ho patch neurčí). Stavy se vždy omezí na segment.
 */
export function applyBookPatch(p: BookParams, patch: BookPatch): BookParams {
  const next: BookParams = { ...p, ...patch };
  if (patch.segment !== undefined && patch.segment !== p.segment) {
    if (patch.stages === undefined) next.stages = [];
    if (patch.inquiry === undefined) next.inquiry = [];
    if (patch.order === undefined) next.order = [];
  }
  if (patch.sort !== undefined && patch.dir === undefined && patch.sort !== p.sort) next.dir = defaultDirFor(patch.sort);
  next.stages = normalizeStages(next.stages, next.segment);
  return next;
}

/** Zapnout / vypnout stav ve výběru (multi-select chipů). */
export function toggleStagePatch(p: BookParams, stage: JobStage): BookPatch {
  const has = p.stages.includes(stage);
  return { stages: has ? p.stages.filter((s) => s !== stage) : [...p.stages, stage] };
}

/** „Zrušit filtry" — záložka, řazení a pohled zůstávají. */
export const RESET_FILTERS: BookPatch = {
  stages: [], q: "", owner: "", assignee: "", customer: "", deadline: null, step: "", location: "", payment: null,
  inquiry: [], order: [], delivery: [], changedBy: "",
};

export function activeFilterCount(p: BookParams): number {
  return [
    p.stages.length > 0, p.q.trim() !== "", p.owner !== "", p.assignee !== "", p.customer !== "", p.deadline !== null,
    Boolean(p.step), Boolean((p.location ?? "").trim()), Boolean(p.payment),
    (p.inquiry ?? []).length > 0, (p.order ?? []).length > 0, (p.delivery ?? []).length > 0, Boolean(p.changedBy),
  ].filter(Boolean).length;
}

export function isFiltered(p: BookParams): boolean {
  return activeFilterCount(p) > 0;
}

/** Odpovídají parametry patchi? (zvýraznění aktivní dlaždice / záložky) */
export function isPatchActive(p: BookParams, patch: BookPatch): boolean {
  const next = applyBookPatch(p, patch);
  return (Object.keys(patch) as (keyof BookParams)[]).every((k) => {
    const a = p[k];
    const b = next[k];
    if (Array.isArray(a) && Array.isArray(b)) return a.length === b.length && a.every((x, i) => x === b[i]);
    return a === b;
  });
}

/** Parametry knihy → filtry datové vrstvy (listJobs). */
export function bookParamsToFilters(p: BookParams): JobFilters {
  const stages = p.stages.length ? normalizeStages(p.stages, p.segment) : p.segment === "vse" ? [] : bookSegment(p.segment).stages;
  const filters: JobFilters = { sort: p.sort, dir: p.dir };
  if (stages.length) filters.stages = stages;
  else filters.group = "vse";
  if (p.q.trim()) filters.q = p.q.trim();
  if (p.owner) filters.ownerId = p.owner;
  if (p.assignee) filters.assigneeId = p.assignee;
  if (p.customer) filters.customerId = p.customer;
  if (p.deadline) filters.deadline = p.deadline;
  if (isProductionStepKey(p.step)) filters.step = p.step;
  if ((p.location ?? "").trim()) filters.location = p.location.trim();
  if (p.payment) filters.payment = p.payment;
  if (p.inquiry?.length) filters.inquiry = p.inquiry;
  if (p.order?.length) filters.order = p.order;
  if (p.delivery?.length) filters.delivery = p.delivery;
  if (p.changedBy) filters.changedBy = p.changedBy;
  return filters;
}

// ── Počty (záložky, chipy, dlaždice) ────────────────────────
export function sumStages(byStage: Partial<Record<JobStage, number>>, stages: readonly JobStage[]): number {
  return stages.reduce((n, s) => n + (byStage[s] ?? 0), 0);
}

export function segmentCounts(byStage: Partial<Record<JobStage, number>>): Record<BookSegmentKey, number> {
  return Object.fromEntries(BOOK_SEGMENTS.map((s) => [s.key, sumStages(byStage, s.stages)])) as Record<BookSegmentKey, number>;
}

export interface BookKpis {
  ordersRunning: number;
  overdue: number;
  dueSoon: number;
  inquiries: number;
  problems: number;
}

export function bookKpis(counts: { byStage: Partial<Record<JobStage, number>>; overdue: number; dueThisWeek: number }): BookKpis {
  return {
    ordersRunning: sumStages(counts.byStage, ORDER_STAGES),
    overdue: counts.overdue,
    dueSoon: counts.dueThisWeek,
    inquiries: sumStages(counts.byStage, INQUIRY_STAGES),
    problems: sumStages(counts.byStage, PROBLEM_STAGES),
  };
}

/** Kliknutí na dlaždici = filtr. Termíny jdou přes celou knihu (počty jsou celkové). */
export const KPI_PATCHES = {
  // dlaždice = celý pohled: zbylý filtr platby (z dlaždice Po splatnosti) by výsledek zkreslil
  ordersRunning: { segment: "objednavky", stages: [], deadline: null, payment: null },
  overdue: { segment: "vse", stages: [], deadline: "overdue", payment: null },
  dueSoon: { segment: "vse", stages: [], deadline: "week", payment: null },
  inquiries: { segment: "poptavky", stages: [], deadline: null, payment: null },
  problems: { segment: "objednavky", stages: [...PROBLEM_STAGES], deadline: null, payment: null },
  value: { segment: "objednavky", stages: [], deadline: null, payment: null, sort: "value", dir: "desc" },
  /** Faktury po splatnosti — přes celou knihu. */
  overdueInvoices: { segment: "vse", stages: [], deadline: null, payment: "po_splatnosti" },
} satisfies Record<keyof BookKpis | "value" | "overdueInvoices", BookPatch>;

/** Součet hodnot zakázek (bez prázdných). */
export function sumValue(jobs: readonly Pick<JobListItem, "value">[]): number {
  return Math.round(jobs.reduce((n, j) => n + (j.value ?? 0), 0) * 100) / 100;
}

// ── Tabule (kanban) ─────────────────────────────────────────
/** Sloupce tabule = vybrané stavy, jinak všechny stavy segmentu. */
export function boardStages(p: BookParams): JobStage[] {
  const picked = normalizeStages(p.stages, p.segment);
  return picked.length ? picked : bookSegment(p.segment).stages;
}

export interface BoardColumn<T> {
  stage: JobStage;
  jobs: T[];
  value: number;
}

/** Rozdělení zakázek do sloupců (pořadí v rámci sloupce zůstává). */
export function groupByStage<T extends Pick<JobListItem, "stage" | "value">>(jobs: readonly T[], stages: readonly JobStage[]): BoardColumn<T>[] {
  const map = new Map<JobStage, T[]>(stages.map((s) => [s, []]));
  for (const j of jobs) map.get(j.stage)?.push(j);
  return stages.map((stage) => {
    const list = map.get(stage) ?? [];
    return { stage, jobs: list, value: sumValue(list) };
  });
}

/** Optimistický přesun karty (vrací nové pole, ostatní zakázky beze změny). */
export function moveJobStage<T extends { id: string; stage: JobStage }>(jobs: readonly T[], id: string, stage: JobStage): T[] {
  return jobs.map((j) => (j.id === id && j.stage !== stage ? { ...j, stage } : j));
}

// ── Datum a lidé ────────────────────────────────────────────
/** Dnešek v Praze (RRRR-MM-DD) — stejný na serveru (UTC) i v prohlížeči. */
export function todayInPrague(now: Date = new Date()): string {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Europe/Prague", year: "numeric", month: "2-digit", day: "2-digit",
  }).formatToParts(now);
  const get = (t: string) => parts.find((x) => x.type === t)?.value ?? "";
  return `${get("year")}-${get("month")}-${get("day")}`;
}

/** RRRR-MM-DD → Date (místní poledne; pro deadlineInfo). */
export function dateFromIso(iso: string): Date {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso);
  if (!m) return new Date();
  return new Date(+m[1], +m[2] - 1, +m[3], 12);
}

/** Krátké datum: „5. 11." (letos) nebo „5. 11. 2027". */
export function shortDate(iso: string | null | undefined, todayIso?: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso ?? "");
  if (!m) return "—";
  const base = `${+m[3]}. ${+m[2]}.`;
  const year = todayIso?.slice(0, 4);
  return year && year === m[1] ? base : `${base} ${m[1]}`;
}

/** Iniciály pro avatar („Jan Novák" → „JN", „admin@firma.cz" → „AD"). */
export function initials(name: string | null | undefined): string {
  const s = (name ?? "").trim();
  if (!s) return "?";
  const base = s.includes("@") ? s.split("@")[0] : s;
  const words = base.split(/[\s._-]+/).filter(Boolean);
  if (words.length >= 2) return (words[0][0] + words[words.length - 1][0]).toUpperCase();
  return (words[0] ?? base).slice(0, 2).toUpperCase();
}

/** Barvy avatarů (celé třídy kvůli JIT). */
export const AVATAR_TONES = [
  "bg-sky-100 text-sky-800 dark:bg-sky-500/20 dark:text-sky-200",
  "bg-violet-100 text-violet-800 dark:bg-violet-500/20 dark:text-violet-200",
  "bg-amber-100 text-amber-800 dark:bg-amber-500/20 dark:text-amber-200",
  "bg-emerald-100 text-emerald-800 dark:bg-emerald-500/20 dark:text-emerald-200",
  "bg-rose-100 text-rose-800 dark:bg-rose-500/20 dark:text-rose-200",
  "bg-indigo-100 text-indigo-800 dark:bg-indigo-500/20 dark:text-indigo-200",
  "bg-teal-100 text-teal-800 dark:bg-teal-500/20 dark:text-teal-200",
  "bg-fuchsia-100 text-fuchsia-800 dark:bg-fuchsia-500/20 dark:text-fuchsia-200",
] as const;

/** Stálá barva avatara podle id (stejný člověk = stejná barva všude). */
export function avatarTone(id: string | null | undefined): string {
  const s = id ?? "";
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0;
  return AVATAR_TONES[h % AVATAR_TONES.length];
}

/** Číslo s českým skloňováním („1 zakázka", „3 zakázky", „5 zakázek"). */
export function countLabel(n: number, one: string, few: string, many: string): string {
  const word = n === 1 ? one : n >= 2 && n <= 4 ? few : many;
  return `${n.toLocaleString("cs-CZ")} ${word}`;
}
