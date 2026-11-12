/**
 * Faktury vydané — čistá logika bez DB (sdílí server, API i klient): období (měsíc / rok), stav úhrady
 * z plateb zakázky, součty po měnách, řazení a hledání, CSV pro účetní a názvy souborů v ZIPu.
 *
 * Faktura patří do období podle DATA VYSTAVENÍ (issue_date) — tak je řadí i číselná řada FV a tak je
 * majitel posílá účetní („faktury z listopadu"). DUZP je v CSV zvlášť (u faktur z aplikace stejné datum).
 */

// ── Období ───────────────────────────────────────────────────

export type IssuedPeriod = { kind: "month"; year: number; month: number } | { kind: "year"; year: number };

const MONTHS = [
  "leden", "únor", "březen", "duben", "květen", "červen", "červenec", "srpen", "září", "říjen", "listopad", "prosinec",
];
/** 2. pád („faktury z listopadu"). */
const MONTHS_GEN = [
  "ledna", "února", "března", "dubna", "května", "června", "července", "srpna", "září", "října", "listopadu", "prosince",
];
const MONTHS_SHORT = ["led", "úno", "bře", "dub", "kvě", "čvn", "čvc", "srp", "zář", "říj", "lis", "pro"];

export const monthName = (m: number) => MONTHS[m - 1] ?? "";
export const monthShort = (m: number) => MONTHS_SHORT[m - 1] ?? "";

const pad = (n: number) => String(n).padStart(2, "0");

function validYear(y: number): boolean {
  return Number.isInteger(y) && y >= 2000 && y <= 2100;
}

/** „2026-11" (měsíc) / „2026" (rok); cokoli jiného → aktuální měsíc podle `today` (RRRR-MM-DD). */
export function parsePeriod(raw: string | null | undefined, today: string): IssuedPeriod {
  const s = String(raw ?? "").trim();
  const m = /^(\d{4})-(\d{2})$/.exec(s);
  if (m) {
    const year = Number(m[1]);
    const month = Number(m[2]);
    if (validYear(year) && month >= 1 && month <= 12) return { kind: "month", year, month };
  }
  const y = /^(\d{4})$/.exec(s);
  if (y && validYear(Number(y[1]))) return { kind: "year", year: Number(y[1]) };
  const [ty, tm] = today.split("-").map(Number);
  return { kind: "month", year: validYear(ty) ? ty : 2026, month: tm >= 1 && tm <= 12 ? tm : 1 };
}

export function periodKey(p: IssuedPeriod): string {
  return p.kind === "month" ? `${p.year}-${pad(p.month)}` : String(p.year);
}

/** První a poslední den období (včetně). */
export function periodRange(p: IssuedPeriod): { from: string; to: string } {
  if (p.kind === "year") return { from: `${p.year}-01-01`, to: `${p.year}-12-31` };
  const last = new Date(Date.UTC(p.year, p.month, 0)).getUTCDate();
  return { from: `${p.year}-${pad(p.month)}-01`, to: `${p.year}-${pad(p.month)}-${pad(last)}` };
}

/** Předchozí / další měsíc nebo rok. */
export function shiftPeriod(p: IssuedPeriod, delta: number): IssuedPeriod {
  if (p.kind === "year") return { kind: "year", year: p.year + delta };
  const idx = p.year * 12 + (p.month - 1) + delta;
  return { kind: "month", year: Math.floor(idx / 12), month: (idx % 12) + 1 };
}

/** „listopad 2026" / „rok 2026". */
export function periodLabel(p: IssuedPeriod): string {
  return p.kind === "month" ? `${monthName(p.month)} ${p.year}` : `rok ${p.year}`;
}

/** „z listopadu 2026" / „z roku 2026". */
export function periodLabelFrom(p: IssuedPeriod): string {
  return p.kind === "month" ? `z ${MONTHS_GEN[p.month - 1]} ${p.year}` : `z roku ${p.year}`;
}

/** Je období v budoucnu (za dnešním měsícem / rokem)? Šipka „další" pak nemá smysl. */
export function isFuturePeriod(p: IssuedPeriod, today: string): boolean {
  const [ty, tm] = today.split("-").map(Number);
  if (p.kind === "year") return p.year > ty;
  return p.year * 12 + p.month > ty * 12 + tm;
}

// ── Úhrada ───────────────────────────────────────────────────

export type IssuedPaymentState = "zaplaceno" | "castecne" | "nezaplaceno" | "po_splatnosti" | "storno";

export const PAYMENT_STATE_META: Record<IssuedPaymentState, { label: string; tone: string }> = {
  zaplaceno: { label: "Zaplaceno", tone: "bg-emerald-100 text-emerald-800 dark:bg-emerald-500/15 dark:text-emerald-300" },
  castecne: { label: "Částečně zaplaceno", tone: "bg-amber-100 text-amber-800 dark:bg-amber-500/15 dark:text-amber-300" },
  nezaplaceno: { label: "Nezaplaceno", tone: "bg-slate-100 text-slate-700 dark:bg-slate-500/15 dark:text-slate-300" },
  po_splatnosti: { label: "Po splatnosti", tone: "bg-rose-100 text-rose-800 dark:bg-rose-500/15 dark:text-rose-300" },
  storno: { label: "Stornováno", tone: "bg-muted text-muted-foreground line-through" },
};

export interface PaymentRowInput {
  paid_on: string | null;
  /** Bez DPH (job_payments.amount); null = celá / zbývající částka. */
  amount: number | string | null;
  settles?: boolean | null;
}

export interface IssuedPayment {
  state: IssuedPaymentState;
  /** Uhrazeno s DPH (zálohy i platby zakázky). */
  paid: number;
  /** Zbývá uhradit s DPH (nikdy záporně). */
  remaining: number;
  /** Po splatnosti a něco zbývá (i u částečné úhrady). */
  overdue: boolean;
  /** Datum poslední úhrady. */
  paidOn: string | null;
}

const round2 = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100;

/**
 * Stav úhrady faktury. Platby se v aplikaci zapisují k zakázce BEZ DPH (job_payments) — na fakturu se
 * přepočtou poměrem celkem / základ (stejně jako „Zbývá uhradit" na PDF faktury). Zakázka označená
 * „Zaplaceno" (paid_at nebo platba, která ji vyrovnává) = zaplaceno celé.
 */
export function paymentOf(
  inv: { net: number; gross: number; dueDate: string | null; status?: string | null; jobPaidAt?: string | null },
  payments: readonly PaymentRowInput[] | null | undefined,
  today: string,
): IssuedPayment {
  const gross = round2(inv.gross || 0);
  if (inv.status === "stornovana") return { state: "storno", paid: 0, remaining: 0, overdue: false, paidOn: null };
  const ratio = inv.net > 0 ? gross / inv.net : 1;
  const rows = [...(payments ?? [])]
    .filter((r) => typeof r?.paid_on === "string" && r.paid_on)
    .sort((a, b) => String(a.paid_on).localeCompare(String(b.paid_on)));
  let paid = 0;
  let settled = inv.status === "uhrazena" || Boolean(inv.jobPaidAt);
  let paidOn: string | null = inv.jobPaidAt ? String(inv.jobPaidAt).slice(0, 10) : null;
  for (const r of rows) {
    if (r.settles) settled = true;
    const day = String(r.paid_on).slice(0, 10);
    if (r.amount === null || r.amount === undefined || r.amount === "") {
      const rest = round2(gross - paid);
      if (rest > 0) paid = round2(paid + rest);
      paidOn = paidOn && paidOn > day ? paidOn : day;
      continue;
    }
    const net = Number(r.amount);
    if (!Number.isFinite(net) || net <= 0) continue;
    paid = round2(paid + net * ratio);
    paidOn = paidOn && paidOn > day ? paidOn : day;
  }
  // haléřové rozdíly z přepočtu bez DPH → s DPH nejsou dluh
  if (settled || (gross > 0 && paid >= gross - 0.5)) {
    return { state: "zaplaceno", paid: gross, remaining: 0, overdue: false, paidOn };
  }
  const remaining = Math.max(0, round2(gross - paid));
  const overdue = Boolean(inv.dueDate) && String(inv.dueDate) < today && remaining > 0;
  const state: IssuedPaymentState = overdue ? "po_splatnosti" : paid > 0 ? "castecne" : "nezaplaceno";
  return { state, paid: Math.min(paid, gross), remaining, overdue, paidOn };
}

// ── Faktura v seznamu ────────────────────────────────────────

export interface IssuedInvoice {
  /** id řádku v invoices; u faktury zapsané jen na zakázce „job:<id zakázky>". */
  id: string;
  number: string;
  issueDate: string;
  taxableDate: string | null;
  dueDate: string | null;
  variableSymbol: string | null;
  currency: string;
  net: number;
  vat: number;
  gross: number;
  vatRate: number | null;
  customer: { id: string; name: string; ico: string | null; dic: string | null } | null;
  job: { id: string; number: string | null; title: string | null } | null;
  /** PDF (nebo sken) faktury v dokumentech zakázky. */
  file: { id: string; filename: string; mimeType: string | null; generated: boolean } | null;
  payment: IssuedPayment;
  /** Odeslána zákazníkovi (čas). */
  sentAt: string | null;
  /** Částky odhadnuté z hodnoty zakázky (faktura mimo systém bez evidence). */
  estimated: boolean;
  /** Faktura vystavená mimo systém (evidence bez PDF z aplikace). */
  external: boolean;
}

export const isPdfFile = (f: { filename: string; mimeType?: string | null } | null | undefined): boolean =>
  Boolean(f) && (/\.pdf$/i.test(f!.filename) || f!.mimeType === "application/pdf");

// ── Součty ───────────────────────────────────────────────────

export interface CurrencyTotals {
  currency: string;
  count: number;
  net: number;
  vat: number;
  gross: number;
  paid: number;
  unpaid: number;
  overdue: number;
}

export interface IssuedTotals {
  count: number;
  /** Stornované (mimo součty). */
  storno: number;
  /** Bez PDF (ke kontrole). */
  withoutPdf: number;
  /** Po měnách, CZK první. */
  byCurrency: CurrencyTotals[];
  /** Vše přepočtené na Kč (kurz ČNB k DUZP); null = některé cizí měně chybí kurz. */
  czk: { net: number; gross: number; unpaid: number; converted: boolean } | null;
  /** Počty zaplaceno / nezaplaceno. */
  paidCount: number;
  unpaidCount: number;
  overdueCount: number;
}

/** Součty faktur (storno mimo). `rateOf` = kurz Kč za 1 jednotku měny faktury (null = neznám). */
export function totalsOf(items: readonly IssuedInvoice[], rateOf?: (it: IssuedInvoice) => number | null): IssuedTotals {
  const map = new Map<string, CurrencyTotals>();
  let storno = 0;
  let withoutPdf = 0;
  let paidCount = 0;
  let unpaidCount = 0;
  let overdueCount = 0;
  let czkNet = 0;
  let czkGross = 0;
  let czkUnpaid = 0;
  let missingRate = false;
  let converted = false;
  for (const it of items) {
    if (it.payment.state === "storno") {
      storno++;
      continue;
    }
    if (!it.file) withoutPdf++;
    const cur = (it.currency || "CZK").toUpperCase();
    const t = map.get(cur) ?? { currency: cur, count: 0, net: 0, vat: 0, gross: 0, paid: 0, unpaid: 0, overdue: 0 };
    t.count++;
    t.net = round2(t.net + it.net);
    t.vat = round2(t.vat + it.vat);
    t.gross = round2(t.gross + it.gross);
    t.paid = round2(t.paid + it.payment.paid);
    t.unpaid = round2(t.unpaid + it.payment.remaining);
    if (it.payment.overdue) t.overdue = round2(t.overdue + it.payment.remaining);
    map.set(cur, t);
    if (it.payment.state === "zaplaceno") paidCount++;
    else unpaidCount++;
    if (it.payment.overdue) overdueCount++;
    const rate = cur === "CZK" ? 1 : rateOf?.(it) ?? null;
    if (rate === null || !Number.isFinite(rate) || rate <= 0) {
      missingRate = true;
    } else {
      if (cur !== "CZK") converted = true;
      czkNet += it.net * rate;
      czkGross += it.gross * rate;
      czkUnpaid += it.payment.remaining * rate;
    }
  }
  const byCurrency = [...map.values()].sort((a, b) => (a.currency === "CZK" ? -1 : b.currency === "CZK" ? 1 : a.currency.localeCompare(b.currency)));
  return {
    count: items.length - storno,
    storno,
    withoutPdf,
    byCurrency,
    czk: missingRate ? null : { net: round2(czkNet), gross: round2(czkGross), unpaid: round2(czkUnpaid), converted },
    paidCount,
    unpaidCount,
    overdueCount,
  };
}

/** Rok po měsících (1–12): faktury každého měsíce + jejich součty. */
export function byMonth(items: readonly IssuedInvoice[], rateOf?: (it: IssuedInvoice) => number | null): { month: number; totals: IssuedTotals }[] {
  const out: { month: number; totals: IssuedTotals }[] = [];
  for (let m = 1; m <= 12; m++) {
    const list = items.filter((it) => Number(it.issueDate.slice(5, 7)) === m);
    out.push({ month: m, totals: totalsOf(list, rateOf) });
  }
  return out;
}

// ── Hledání a řazení ─────────────────────────────────────────

export type IssuedSortKey = "datum" | "cislo" | "castka" | "odberatel";

export function normalizeSearch(s: string | null | undefined): string {
  return String(s ?? "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/\s+/g, " ").trim();
}

/** Hledá v čísle faktury, VS, odběrateli (název, IČ), čísle a názvu zakázky. Víc slov = všechna. */
export function filterInvoices(items: readonly IssuedInvoice[], q: string): IssuedInvoice[] {
  const words = normalizeSearch(q).split(" ").filter(Boolean);
  if (!words.length) return [...items];
  return items.filter((it) => {
    const hay = normalizeSearch([
      it.number, it.variableSymbol, it.customer?.name, it.customer?.ico, it.job?.number, it.job?.title,
    ].filter(Boolean).join(" "));
    return words.every((w) => hay.includes(w));
  });
}

const collator = new Intl.Collator("cs", { numeric: true, sensitivity: "base" });

export function sortInvoices(items: readonly IssuedInvoice[], key: IssuedSortKey, dir: "asc" | "desc"): IssuedInvoice[] {
  const sign = dir === "asc" ? 1 : -1;
  const cmp = (a: IssuedInvoice, b: IssuedInvoice): number => {
    switch (key) {
      case "cislo":
        return collator.compare(a.number, b.number);
      case "castka":
        return a.gross - b.gross || collator.compare(a.number, b.number);
      case "odberatel":
        return collator.compare(a.customer?.name ?? "", b.customer?.name ?? "") || collator.compare(a.number, b.number);
      default:
        return a.issueDate.localeCompare(b.issueDate) || collator.compare(a.number, b.number);
    }
  };
  return [...items].sort((a, b) => sign * cmp(a, b));
}

// ── Názvy souborů ────────────────────────────────────────────

/** Bezpečná ASCII část názvu (bez diakritiky — ZIP i Windows / účetní programy). */
export function asciiPart(s: string | null | undefined, max = 60): string {
  return String(s ?? "")
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^A-Za-z0-9._-]+/g, "_")
    .replace(/_{2,}/g, "_")
    .replace(/^[._-]+|[._-]+$/g, "")
    .slice(0, max)
    .replace(/[._-]+$/g, "");
}

/** „FV-2026-012_Strojmetal_a.s.pdf" (přípona podle souboru). */
export function invoiceEntryName(it: Pick<IssuedInvoice, "number" | "customer">, ext = "pdf"): string {
  const num = asciiPart(it.number, 60) || "faktura";
  const cust = asciiPart(it.customer?.name, 40);
  const e = asciiPart(ext, 8).toLowerCase() || "pdf";
  return `${num}${cust ? `_${cust}` : ""}.${e}`;
}

/** Stejné názvy v jednom ZIPu → „…(2).pdf". */
export function dedupeEntryNames(names: readonly string[]): string[] {
  const seen = new Map<string, number>();
  return names.map((n) => {
    const key = n.toLowerCase();
    const k = (seen.get(key) ?? 0) + 1;
    seen.set(key, k);
    if (k === 1) return n;
    const dot = n.lastIndexOf(".");
    return dot > 0 ? `${n.slice(0, dot)}(${k})${n.slice(dot)}` : `${n}(${k})`;
  });
}

/** „Faktury_vydane_2026-11" (bez přípony). */
export function exportBaseName(p: IssuedPeriod): string {
  return `Faktury_vydane_${periodKey(p)}`;
}

// ── CSV pro účetní ───────────────────────────────────────────

/** „12500,50" — bez oddělovače tisíců, desetinná čárka (český Excel to bere jako číslo). */
export function csvNumber(n: number | null | undefined): string {
  if (n === null || n === undefined || !Number.isFinite(n)) return "";
  return (Math.round(n * 100) / 100).toFixed(2).replace(".", ",");
}

/** RRRR-MM-DD → „5.11.2026". */
export function csvDate(iso: string | null | undefined): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(iso ?? ""));
  return m ? `${Number(m[3])}.${Number(m[2])}.${m[1]}` : "";
}

function csvCell(v: string): string {
  return /[";\r\n]/.test(v) || /^\s|\s$/.test(v) ? `"${v.replace(/"/g, '""')}"` : v;
}

export const CSV_HEADER = [
  "Číslo faktury", "Datum vystavení", "DUZP", "Splatnost", "Variabilní symbol", "Odběratel", "IČ", "DIČ", "Zakázka",
  "Základ bez DPH", "Sazba DPH %", "DPH", "Celkem s DPH", "Měna", "Uhrazeno", "Zbývá uhradit", "Stav", "Poznámka",
];

/**
 * CSV pro účetní: UTF-8 s BOM, středník, CRLF (český Excel otevře dvojklikem se správnou diakritikou).
 * Pod seznamem prázdný řádek a součty po měnách.
 */
export function invoicesCsv(items: readonly IssuedInvoice[]): string {
  const rows: string[][] = [CSV_HEADER];
  for (const it of items) {
    const note = [it.estimated ? "částky odhadnuté z hodnoty zakázky" : "", it.file ? "" : "bez PDF"].filter(Boolean).join(", ");
    rows.push([
      it.number, csvDate(it.issueDate), csvDate(it.taxableDate), csvDate(it.dueDate), it.variableSymbol ?? "",
      it.customer?.name ?? "", it.customer?.ico ?? "", it.customer?.dic ?? "", it.job?.number ?? "",
      csvNumber(it.net), it.vatRate === null ? "" : csvNumber(it.vatRate).replace(/,00$/, ""), csvNumber(it.vat), csvNumber(it.gross),
      it.currency, csvNumber(it.payment.paid), csvNumber(it.payment.remaining), PAYMENT_STATE_META[it.payment.state].label, note,
    ]);
  }
  const totals = totalsOf(items);
  if (totals.byCurrency.length) {
    rows.push([]);
    for (const t of totals.byCurrency) {
      rows.push([
        `Celkem ${t.currency}`, "", "", "", "", `${t.count} ${t.count === 1 ? "faktura" : t.count < 5 ? "faktury" : "faktur"}`, "", "", "",
        csvNumber(t.net), "", csvNumber(t.vat), csvNumber(t.gross), t.currency, csvNumber(t.paid), csvNumber(t.unpaid), "", "",
      ]);
    }
  }
  return "﻿" + rows.map((r) => r.map(csvCell).join(";")).join("\r\n") + "\r\n";
}

/** Výchozí řazení seznamu (nejnovější nahoře). */
export const DEFAULT_SORT: { key: IssuedSortKey; dir: "asc" | "desc" } = { key: "datum", dir: "desc" };

/** Ze seznamu ID řádku zjistí, jestli jde o fakturu jen na zakázce („job:<uuid>"). */
export function jobOnlyId(id: string): string | null {
  return id.startsWith("job:") ? id.slice(4) : null;
}
