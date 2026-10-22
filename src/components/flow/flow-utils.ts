import type { JobFileKind, JobStage, QuoteStatus } from "@/lib/supabase/database.types";

/**
 * Obchodní tok (Poptávky → Nacenění → Nabídky → Potvrzení, Dokumenty) — čistá logika
 * bez Reactu a DB: kroky toku, odkazy do Knihy zakázek, ceny a marže, filtry nabídek
 * a dokumentů. Testy v flow-utils.test.ts. Třídy Tailwindu jsou vypsané celé (JIT).
 */

// ── Kroky toku ──────────────────────────────────────────────
export type FlowStepKey = "poptavka" | "naceneni" | "nabidka" | "objednavka" | "potvrzeni";

export interface FlowStep {
  key: FlowStepKey;
  label: string;
  href: string;
  /** Stav zakázky, jehož barvu krok nese. */
  stage: JobStage;
  hint: string;
}

/** Odkaz do Knihy zakázek s předvybranou záložkou a stavy. */
export function bookHref(segment: "objednavky" | "poptavky" | "dokoncene" | "nerealizovane" | "vse", stages: JobStage[] = []): string {
  const sp = new URLSearchParams();
  sp.set("segment", segment);
  if (stages.length) sp.set("stages", stages.join(","));
  return `/orders?${sp.toString().replace(/%2C/g, ",")}`;
}

export const FLOW_STEPS: FlowStep[] = [
  { key: "poptavka", label: "Poptávka", href: "/inquiries", stage: "poptavka", hint: "Zákazník poptal díl" },
  { key: "naceneni", label: "Nacenění", href: "/pricing", stage: "naceneni", hint: "Doplníme ceny" },
  { key: "nabidka", label: "Nabídka", href: "/quotes", stage: "nabidka", hint: "Pošleme nabídku" },
  { key: "objednavka", label: "Objednávka", href: bookHref("objednavky", ["objednavka"]), stage: "objednavka", hint: "Zákazník objednal" },
  { key: "potvrzeni", label: "Potvrzení", href: "/confirmations", stage: "potvrzeno", hint: "Potvrdíme termín" },
];

/** Barevné pozadí hlavičky stránky toku (podle barvy stavu). */
export type FlowTone = "sky" | "amber" | "violet" | "orange" | "indigo" | "emerald";

export const FLOW_TONES: Record<FlowTone, { header: string; tile: string; count: string; glow: string }> = {
  sky: {
    header: "border-sky-200/80 bg-gradient-to-br from-sky-50 via-card to-card dark:border-sky-500/25 dark:from-sky-500/10",
    tile: "bg-sky-500 text-white shadow-sky-500/30", count: "bg-sky-100 text-sky-800 dark:bg-sky-500/20 dark:text-sky-200",
    glow: "bg-sky-400/20",
  },
  amber: {
    header: "border-amber-200/80 bg-gradient-to-br from-amber-50 via-card to-card dark:border-amber-500/25 dark:from-amber-500/10",
    tile: "bg-amber-500 text-white shadow-amber-500/30", count: "bg-amber-100 text-amber-800 dark:bg-amber-500/20 dark:text-amber-200",
    glow: "bg-amber-400/20",
  },
  violet: {
    header: "border-violet-200/80 bg-gradient-to-br from-violet-50 via-card to-card dark:border-violet-500/25 dark:from-violet-500/10",
    tile: "bg-violet-500 text-white shadow-violet-500/30", count: "bg-violet-100 text-violet-800 dark:bg-violet-500/20 dark:text-violet-200",
    glow: "bg-violet-400/20",
  },
  orange: {
    header: "border-orange-200/80 bg-gradient-to-br from-orange-50 via-card to-card dark:border-orange-500/25 dark:from-orange-500/10",
    tile: "bg-orange-500 text-white shadow-orange-500/30", count: "bg-orange-100 text-orange-800 dark:bg-orange-500/20 dark:text-orange-200",
    glow: "bg-orange-400/20",
  },
  indigo: {
    header: "border-indigo-200/80 bg-gradient-to-br from-indigo-50 via-card to-card dark:border-indigo-500/25 dark:from-indigo-500/10",
    tile: "bg-indigo-500 text-white shadow-indigo-500/30", count: "bg-indigo-100 text-indigo-800 dark:bg-indigo-500/20 dark:text-indigo-200",
    glow: "bg-indigo-400/20",
  },
  emerald: {
    header: "border-emerald-200/80 bg-gradient-to-br from-emerald-50 via-card to-card dark:border-emerald-500/25 dark:from-emerald-500/10",
    tile: "bg-emerald-600 text-white shadow-emerald-600/30", count: "bg-emerald-100 text-emerald-800 dark:bg-emerald-500/20 dark:text-emerald-200",
    glow: "bg-emerald-400/20",
  },
};

// ── Data a čísla ────────────────────────────────────────────

/** Dnešní datum v Praze (RRRR-MM-DD). */
export function todayPrague(now: Date = new Date()): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Prague" }).format(now);
}

/** RRRR-MM-DD → Date v poledne (porovnání dnů bez posunu pásem). */
export function dateFromIso(iso: string): Date {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso);
  return m ? new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]), 12) : new Date();
}

export function addDaysIso(iso: string, days: number): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso);
  const base = m ? Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])) : Date.now();
  return new Date(base + Math.round(days) * 86_400_000).toISOString().slice(0, 10);
}

/** „2026-11-21" → „21. 11. 2026" (bez roku, je-li letošní a `short`). */
export function czDay(iso: string | null | undefined, opts: { short?: boolean; today?: string } = {}): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso ?? "");
  if (!m) return "—";
  const thisYear = opts.today ? opts.today.slice(0, 4) : String(new Date().getFullYear());
  const day = `${Number(m[3])}. ${Number(m[2])}.`;
  return opts.short && m[1] === thisYear ? day : `${day} ${m[1]}`;
}

/** Vstup ceny / množství: „1 250,50" i „1250.5" → 1250.5; prázdné → null. */
export function parseAmount(text: string | null | undefined): { ok: true; value: number | null } | { ok: false } {
  const s = String(text ?? "").replace(/[\s  ]/g, "").replace(/(Kč|CZK|,-)$/i, "");
  if (!s) return { ok: true, value: null };
  if (!/^-?\d+([.,]\d+)?$/.test(s)) return { ok: false };
  const n = Number(s.replace(",", "."));
  return Number.isFinite(n) ? { ok: true, value: n } : { ok: false };
}

/** Číslo do vstupního pole: 1250.5 → „1250,5". */
export function amountInput(n: number | null | undefined): string {
  if (n === null || n === undefined || !Number.isFinite(n)) return "";
  return String(Math.round(n * 1000) / 1000).replace(".", ",");
}

/** Marže v % z prodejní ceny (null, když chybí některá cena). */
export function marginPercent(sale: number | null | undefined, purchase: number | null | undefined): number | null {
  if (sale === null || sale === undefined || purchase === null || purchase === undefined) return null;
  if (!(sale > 0)) return null;
  return ((sale - purchase) / sale) * 100;
}

export function formatPercent(n: number | null | undefined): string {
  if (n === null || n === undefined || !Number.isFinite(n)) return "—";
  return `${new Intl.NumberFormat("cs-CZ", { maximumFractionDigits: 1 }).format(n)} %`;
}

/** Barva marže: záporná červeně, nízká oranžově, zdravá zeleně. */
export function marginTone(pct: number | null): string {
  if (pct === null) return "text-muted-foreground";
  if (pct < 0) return "text-red-600 dark:text-red-400";
  if (pct < 15) return "text-amber-600 dark:text-amber-400";
  return "text-green-600 dark:text-green-400";
}

export interface PricedRow {
  quantity: number;
  unitPrice: number | null;
  purchaseUnitPrice: number | null;
}

export interface PricingSummary {
  /** Prodej celkem (jen naceněné položky). */
  sale: number;
  /** Nákup celkem — null, pokud žádná položka nemá nákupní cenu. */
  purchase: number | null;
  marginPct: number | null;
  /** Položek bez prodejní ceny. */
  unpriced: number;
  /** Všechny položky mají cenu. */
  complete: boolean;
}

const r2 = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100;

export function pricingSummary(rows: PricedRow[]): PricingSummary {
  let sale = 0;
  let purchase = 0;
  let hasPurchase = false;
  let unpriced = 0;
  // marže jen z položek, které mají obě ceny
  let mSale = 0;
  let mPurchase = 0;
  for (const r of rows) {
    const q = Number.isFinite(r.quantity) ? r.quantity : 0;
    if (r.unitPrice === null) unpriced += 1;
    else sale += q * r.unitPrice;
    if (r.purchaseUnitPrice !== null) {
      hasPurchase = true;
      purchase += q * r.purchaseUnitPrice;
    }
    if (r.unitPrice !== null && r.purchaseUnitPrice !== null) {
      mSale += q * r.unitPrice;
      mPurchase += q * r.purchaseUnitPrice;
    }
  }
  return {
    sale: r2(sale),
    purchase: hasPurchase ? r2(purchase) : null,
    marginPct: mSale > 0 && hasPurchase ? ((mSale - mPurchase) / mSale) * 100 : null,
    unpriced,
    complete: rows.length > 0 && unpriced === 0,
  };
}

// ── Hledání ─────────────────────────────────────────────────
export function normalizeText(s: string | null | undefined): string {
  return String(s ?? "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
}

export function matchesQuery(haystack: (string | null | undefined)[], query: string): boolean {
  const tokens = normalizeText(query).split(/\s+/).filter(Boolean);
  if (!tokens.length) return true;
  const h = normalizeText(haystack.filter(Boolean).join(" "));
  return tokens.every((t) => h.includes(t));
}

// ── Nabídky ─────────────────────────────────────────────────
export const QUOTE_STATUS_ORDER: QuoteStatus[] = ["navrh_ai", "ke_schvaleni", "odeslano", "prijato", "zamitnuto"];

export const QUOTE_STATUS_UI: Record<QuoteStatus, { label: string; badge: string; solid: string; dot: string; hint: string }> = {
  navrh_ai: {
    label: "Návrh AI", badge: "bg-slate-100 text-slate-700 dark:bg-slate-500/20 dark:text-slate-300",
    solid: "bg-slate-600 text-white", dot: "bg-slate-400", hint: "Připravila AI — zkontroluj a schval.",
  },
  ke_schvaleni: {
    label: "Ke schválení", badge: "bg-amber-100 text-amber-800 dark:bg-amber-500/15 dark:text-amber-300",
    solid: "bg-amber-500 text-white", dot: "bg-amber-500", hint: "Čeká na schválení a odeslání zákazníkovi.",
  },
  odeslano: {
    label: "Odesláno", badge: "bg-violet-100 text-violet-800 dark:bg-violet-500/15 dark:text-violet-300",
    solid: "bg-violet-500 text-white", dot: "bg-violet-500", hint: "Odešla zákazníkovi — čekáme na odpověď.",
  },
  prijato: {
    label: "Přijato", badge: "bg-green-100 text-green-800 dark:bg-green-500/15 dark:text-green-300",
    solid: "bg-green-600 text-white", dot: "bg-green-500", hint: "Zákazník nabídku přijal.",
  },
  zamitnuto: {
    label: "Zamítnuto", badge: "bg-red-100 text-red-700 dark:bg-red-500/15 dark:text-red-300",
    solid: "bg-red-600 text-white", dot: "bg-red-500", hint: "Zákazník nabídku nepřijal.",
  },
};

export function quoteStatusUi(status: string) {
  return QUOTE_STATUS_UI[status as QuoteStatus] ?? QUOTE_STATUS_UI.ke_schvaleni;
}

/** Nabídka čekající na odpověď, které už vypršela platnost. */
export function isQuoteExpired(q: { validUntil: string | null; status: string }, today: string): boolean {
  if (!q.validUntil) return false;
  if (q.status !== "navrh_ai" && q.status !== "ke_schvaleni" && q.status !== "odeslano") return false;
  return q.validUntil.slice(0, 10) < today;
}

export type QuoteFilterKey = QuoteStatus | "vse" | "po_platnosti";

export interface QuoteLike {
  number: string;
  title: string | null;
  status: string;
  validUntil: string | null;
  archived: boolean;
  job: { number: string; title: string } | null;
  customer: { name: string } | null;
  createdBy?: { name: string } | null;
}

export function filterQuotes<T extends QuoteLike>(
  quotes: T[],
  f: { status: QuoteFilterKey; archived: boolean; q: string },
  today: string,
): T[] {
  return quotes.filter((q) => {
    if (!f.archived && q.archived) return false;
    if (f.status === "po_platnosti") {
      if (!isQuoteExpired(q, today)) return false;
    } else if (f.status !== "vse" && q.status !== f.status) return false;
    return matchesQuery([q.number, q.title, q.job?.number, q.job?.title, q.customer?.name, q.createdBy?.name], f.q);
  });
}

export function quoteCounts(quotes: QuoteLike[], archived: boolean, today: string): Record<QuoteFilterKey, number> {
  const out = { vse: 0, po_platnosti: 0, navrh_ai: 0, ke_schvaleni: 0, odeslano: 0, prijato: 0, zamitnuto: 0 } as Record<QuoteFilterKey, number>;
  for (const q of quotes) {
    if (!archived && q.archived) continue;
    out.vse += 1;
    if (q.status in out) out[q.status as QuoteStatus] += 1;
    if (isQuoteExpired(q, today)) out.po_platnosti += 1;
  }
  return out;
}

// ── Dokumenty ───────────────────────────────────────────────
export interface FileLike {
  kind: JobFileKind;
  filename: string;
  title: string | null;
  note: string | null;
  archived: boolean;
  job: { number: string; title: string; customerName: string | null };
}

export function filterFiles<T extends FileLike>(files: T[], f: { kind: JobFileKind | "vse"; archived: boolean; q: string }): T[] {
  return files.filter((x) => {
    if (!f.archived && x.archived) return false;
    if (f.kind !== "vse" && x.kind !== f.kind) return false;
    return matchesQuery([x.filename, x.title, x.note, x.job.number, x.job.title, x.job.customerName], f.q);
  });
}

export function fileKindCounts(files: FileLike[], archived: boolean): Partial<Record<JobFileKind | "vse", number>> {
  const out: Partial<Record<JobFileKind | "vse", number>> = { vse: 0 };
  for (const x of files) {
    if (!archived && x.archived) continue;
    out.vse = (out.vse ?? 0) + 1;
    out[x.kind] = (out[x.kind] ?? 0) + 1;
  }
  return out;
}

export function isImageFile(mime: string | null | undefined, filename: string): boolean {
  if (mime?.startsWith("image/")) return !/heic|heif/i.test(mime);
  return /\.(jpe?g|png|webp|gif)$/i.test(filename);
}

export function formatBytes(n: number | null | undefined): string {
  if (n === null || n === undefined || !Number.isFinite(n) || n <= 0) return "";
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${Math.round(n / 1024)} kB`;
  return `${new Intl.NumberFormat("cs-CZ", { maximumFractionDigits: 1 }).format(n / 1024 / 1024)} MB`;
}

/** Druh dokladu, který jde ze zakázky vystavit (= druh souboru). */
export type IssuableKind = "nabidka" | "potvrzeni" | "dodaci_list" | "faktura";

export const ISSUABLE_KINDS: { kind: IssuableKind; label: string; hint: string; preview: string }[] = [
  { kind: "nabidka", label: "Nabídka", hint: "z aktuální nabídky zakázky", preview: "nabidka" },
  { kind: "potvrzeni", label: "Potvrzení objednávky", hint: "s potvrzeným termínem", preview: "potvrzeni" },
  { kind: "dodaci_list", label: "Dodací list", hint: "položky a množství, bez cen", preview: "dodaci-list" },
  { kind: "faktura", label: "Faktura", hint: "s QR platbou, posune do „Vyfakturováno“", preview: "faktura" },
];
