import type { CommissionBase, CommissionStatus, JobStage } from "@/lib/supabase/database.types";
import { cleanDate, cleanNumber, cleanText, isUuid } from "@/lib/jobs/mapping";

/**
 * Provize obchodníků — čistá logika bez DB a Reactu (sdílí server i klient):
 * smlouvy (pravidla, pásma), vyúčtování, lišta pásem, měsíce, popisky.
 * Provize samotné počítá DB (triggery) — tady se jen ověřují vstupy smluv,
 * kreslí rozpad a počítá NEZÁVAZNÝ modelový příklad v editoru smlouvy.
 * Testy v model.test.ts.
 */

// ── Typy ────────────────────────────────────────────────────
export type CommissionBasis = "ordered" | "collected";
export type StatementStatus = "otevrena" | "k_vyplate" | "vyplaceno";

export interface CommissionTierView {
  from: number;
  /** null = bez horní hranice (poslední pásmo). */
  to: number | null;
  /** Zlomek (0.1 = 10 %). */
  rate: number;
}

export interface CommissionBandView extends CommissionTierView {
  revenue: number;
  profit: number;
  commission: number;
}

/** Smlouva obchodníka (commission_rules). */
export interface CommissionRuleView {
  id: string;
  ownerId: string;
  name: string | null;
  base: CommissionBase;
  basis: CommissionBasis;
  /** Zlomek (0.1 = 10 %) — u margin / revenue. */
  rate: number;
  tiers: CommissionTierView[] | null;
  validFrom: string;
  payoutDays: number;
  note: string | null;
  createdAt: string;
  /** Kdo smlouvu naposledy založil / upravil (audit log). */
  changedBy?: string | null;
  changedAt?: string | null;
}

/** Vstup editoru smlouvy — sazby v PROCENTECH (10 = 10 %). */
export interface CommissionRuleInput {
  id?: string | null;
  ownerId: string;
  name?: string | null;
  base: CommissionBase;
  basis?: CommissionBasis;
  /** Sazba v procentech — pro margin / revenue. */
  rate?: number | string | null;
  /** Pásma (rate v procentech) — pro margin_tiered. */
  tiers?: { from: number | string; to: number | string | null; rate: number | string }[] | null;
  validFrom?: string | null;
  payoutDays?: number | string | null;
  note?: string | null;
}

/** Vyčištěná smlouva pro DB (sazby jako zlomky). */
export interface CleanCommissionRule {
  id: string | null;
  ownerId: string;
  name: string;
  base: CommissionBase;
  basis: CommissionBasis;
  rate: number;
  tiers: CommissionTierView[] | null;
  validFrom: string;
  payoutDays: number;
  note: string | null;
}

/** Měsíční vyúčtování obchodníka (commission_statements). */
export interface CommissionStatementView {
  id: string;
  ownerId: string;
  ownerName: string;
  /** RRRR-MM-01 */
  period: string;
  ruleName: string | null;
  basis: CommissionBasis;
  /** Inkasovaný (u basis ordered objednaný) obrat bez DPH. */
  revenue: number;
  cost: number;
  profit: number;
  commission: number;
  bands: CommissionBandView[];
  jobsCount: number;
  unknownCostJobs: number;
  dueDate: string | null;
  status: StatementStatus;
  paidAt: string | null;
  /** Kdo výplatu označil (audit log). */
  paidBy?: string | null;
  /** Kdy to označil (časové razítko). */
  paidMarkedAt?: string | null;
  updatedAt: string | null;
}

/** Provize jedné zakázky (commission_entries). */
export interface CommissionEntryView {
  id: string;
  ownerId: string;
  /** null = zakázka mezitím smazána. */
  job: {
    id: string;
    number: string;
    title: string;
    stage: JobStage;
    customerName: string | null;
    paidAt: string | null;
  } | null;
  period: string;
  revenue: number;
  cost: number;
  profit: number;
  /** Podíl zisku na obratu. */
  margin: number;
  rate: number;
  base: CommissionBase;
  commission: number;
  /** Odhad pásmové provize pro neinkasovanou zakázku. */
  estimatedCommission: number | null;
  status: CommissionStatus;
  costKnown: boolean;
  collected: boolean;
}

export interface CommissionOwnerView {
  id: string;
  name: string;
  email: string | null;
  role: string;
  /** Platná smlouva (null = sazba z profilu). */
  rule: CommissionRuleView | null;
  /** Sazba z profilu (zlomek) — použije se bez smlouvy. */
  profileRate: number;
}

export interface CommissionOverview {
  viewerId: string;
  /** Super admin — vidí všechny obchodníky. */
  canSeeAll: boolean;
  /** Vybraný obchodník; null = všichni (jen super admin). */
  ownerId: string | null;
  owners: CommissionOwnerView[];
  /** Posledních N měsíců (RRRR-MM-01), nejnovější první. */
  months: string[];
  statements: CommissionStatementView[];
  entries: CommissionEntryView[];
  /** Všechny smlouvy zobrazených obchodníků (historie), nejnovější první. */
  rules: CommissionRuleView[];
  today: string;
}

// ── Procenta a částky ───────────────────────────────────────
const NF1 = new Intl.NumberFormat("cs-CZ", { maximumFractionDigits: 2 });

/** Zlomek → „12,5" (bez znaku %). */
export function ratePercentNumber(rate: number | null | undefined): string {
  return NF1.format(Math.round(Number(rate ?? 0) * 1_000_000) / 10_000);
}

/** Zlomek → „12,5 %". */
export function formatRate(rate: number | null | undefined): string {
  return `${ratePercentNumber(rate)} %`;
}

/** Procenta (0–100, čárka i tečka) → zlomek na 4 desetinná místa, nebo null. */
export function percentToRate(v: unknown): number | null {
  if (v === undefined || v === null || v === "") return null;
  const n = typeof v === "number" ? v : cleanNumber(String(v).replace(/\s|%/g, ""));
  if (n === null || !Number.isFinite(n) || n < 0 || n > 100) return null;
  return Math.round(n * 100) / 10_000;
}

/** Částka „1 200 000 Kč" (celé koruny), haléře jen když jsou. */
export function czk(n: number | null | undefined): string {
  if (n === null || n === undefined || !Number.isFinite(n)) return "—";
  return new Intl.NumberFormat("cs-CZ", {
    style: "currency", currency: "CZK", maximumFractionDigits: Number.isInteger(Math.round(n * 100) / 100) ? 0 : 2,
  }).format(n);
}

/** Zkrácená částka na lištu: „500 tis.", „1,2 mil.". */
export function compactCzk(n: number): string {
  const a = Math.abs(n);
  if (a >= 1_000_000) return `${NF1.format(Math.round((n / 1_000_000) * 100) / 100)} mil.`;
  if (a >= 1_000) return `${NF1.format(Math.round(n / 1_000))} tis.`;
  return NF1.format(Math.round(n));
}

// ── Měsíce ──────────────────────────────────────────────────
const MONTHS = ["leden", "únor", "březen", "duben", "květen", "červen", "červenec", "srpen", "září", "říjen", "listopad", "prosinec"];
const MONTHS_SHORT = ["led", "úno", "bře", "dub", "kvě", "čvn", "čvc", "srp", "zář", "říj", "lis", "pro"];

function ym(period: string): [number, number] | null {
  const m = /^(\d{4})-(\d{2})/.exec(period ?? "");
  if (!m) return null;
  const mo = Number(m[2]);
  return mo >= 1 && mo <= 12 ? [Number(m[1]), mo] : null;
}

/** RRRR-MM-01 z data / časového razítka. */
export function monthStart(value: string): string {
  const p = ym(value);
  return p ? `${p[0]}-${String(p[1]).padStart(2, "0")}-01` : value;
}

/** Posledních n měsíců (RRRR-MM-01) od měsíce data `today`, nejnovější první. */
export function lastMonths(today: string, n: number): string[] {
  const p = ym(today);
  if (!p) return [];
  let [y, m] = p;
  const out: string[] = [];
  for (let i = 0; i < Math.max(0, Math.floor(n)); i++) {
    out.push(`${y}-${String(m).padStart(2, "0")}-01`);
    m -= 1;
    if (m === 0) {
      m = 12;
      y -= 1;
    }
  }
  return out;
}

/** „říjen 2026" */
export function monthLabel(period: string): string {
  const p = ym(period);
  return p ? `${MONTHS[p[1] - 1]} ${p[0]}` : period;
}

/** „říj" */
export function monthShort(period: string): string {
  const p = ym(period);
  return p ? MONTHS_SHORT[p[1] - 1] : period;
}

/** „10/2026" */
export function periodSlash(period: string): string {
  const p = ym(period);
  return p ? `${p[1]}/${p[0]}` : period;
}

/** RRRR-MM-01 → RRRR-MM (adresa stránky). */
export function periodParam(period: string): string {
  return period.slice(0, 7);
}

/** „2026-10" / „2026-10-01" → RRRR-MM-01, jinak null. */
export function parsePeriodParam(v: unknown): string | null {
  if (typeof v !== "string") return null;
  const m = /^(\d{4})-(\d{2})(?:-01)?$/.exec(v.trim());
  if (!m) return null;
  const mo = Number(m[2]);
  return mo >= 1 && mo <= 12 ? `${m[1]}-${m[2]}-01` : null;
}

/** Časové razítko → „22. 10. 14:05" (rok jen mimo letošek), pražský čas. */
export function formatStamp(iso: string | null | undefined, now: Date = new Date()): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  const parts = new Intl.DateTimeFormat("cs-CZ", {
    timeZone: "Europe/Prague", day: "numeric", month: "numeric", year: "numeric", hour: "2-digit", minute: "2-digit", hour12: false,
  }).formatToParts(d);
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? "";
  const year = get("year");
  const thisYear = new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Prague", year: "numeric" }).format(now);
  return `${get("day")}. ${get("month")}.${year !== thisYear ? ` ${year}` : ""} ${get("hour")}:${get("minute")}`;
}

/** „20. 11. 2026" */
export function czDay(iso: string | null | undefined): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso ?? "");
  return m ? `${Number(m[3])}. ${Number(m[2])}. ${m[1]}` : "—";
}

// ── Stavy ───────────────────────────────────────────────────
export interface StatusMeta {
  label: string;
  hint: string;
  badge: string;
  dot: string;
}

export const STATEMENT_STATUS_META: Record<StatementStatus, StatusMeta> = {
  otevrena: {
    label: "Běží", hint: "Měsíc ještě neskončil — čísla se průběžně mění.",
    badge: "bg-sky-100 text-sky-800 dark:bg-sky-500/15 dark:text-sky-300", dot: "bg-sky-500",
  },
  k_vyplate: {
    label: "K výplatě", hint: "Měsíc skončil — provize čeká na výplatu.",
    badge: "bg-amber-100 text-amber-800 dark:bg-amber-500/15 dark:text-amber-300", dot: "bg-amber-500",
  },
  vyplaceno: {
    label: "Vyplaceno", hint: "Provize za měsíc je vyplacená.",
    badge: "bg-green-100 text-green-800 dark:bg-green-500/15 dark:text-green-300", dot: "bg-green-500",
  },
};

export const ENTRY_STATUS_META: Record<CommissionStatus, StatusMeta> = {
  predbezna: {
    label: "Předběžná", hint: "Zakázka ještě běží — částka se může změnit.",
    badge: "bg-amber-100 text-amber-800 dark:bg-amber-500/15 dark:text-amber-300", dot: "bg-amber-500",
  },
  k_vyplate: {
    label: "K výplatě", hint: "Provize je započtená a čeká na výplatu.",
    badge: "bg-sky-100 text-sky-800 dark:bg-sky-500/15 dark:text-sky-300", dot: "bg-sky-500",
  },
  vyplaceno: {
    label: "Vyplaceno", hint: "Provize je vyplacená — už se nemění.",
    badge: "bg-green-100 text-green-800 dark:bg-green-500/15 dark:text-green-300", dot: "bg-green-500",
  },
};

export function isStatementStatus(v: unknown): v is StatementStatus {
  return v === "otevrena" || v === "k_vyplate" || v === "vyplaceno";
}

export function isCommissionStatus(v: unknown): v is CommissionStatus {
  return v === "predbezna" || v === "k_vyplate" || v === "vyplaceno";
}

export function isCommissionBase(v: unknown): v is CommissionBase {
  return v === "margin" || v === "revenue" || v === "margin_tiered";
}

/** Splatnost vyúčtování: „splatná do 20. 11. 2026" / „vyplaceno 3. 11. 2026" / po splatnosti. */
export function statementDue(
  st: Pick<CommissionStatementView, "status" | "dueDate" | "paidAt">,
  today: string,
): { label: string; overdue: boolean } {
  if (st.status === "vyplaceno") return { label: st.paidAt ? `vyplaceno ${czDay(st.paidAt)}` : "vyplaceno", overdue: false };
  if (!st.dueDate) return { label: "bez splatnosti", overdue: false };
  const overdue = st.status === "k_vyplate" && st.dueDate < today;
  return { label: `${overdue ? "po splatnosti od" : "splatná do"} ${czDay(st.dueDate)}`, overdue };
}

// ── Smlouvy ─────────────────────────────────────────────────
/** Pásma dle dodatku smlouvy obchodního zástupce (výchozí návrh editoru). */
export const DEFAULT_TIERS: CommissionTierView[] = [
  { from: 0, to: 500_000, rate: 0 },
  { from: 500_000, to: 1_000_000, rate: 0.1 },
  { from: 1_000_000, to: 2_000_000, rate: 0.15 },
  { from: 2_000_000, to: null, rate: 0.2 },
];

export const BASE_LABELS: Record<CommissionBase, string> = {
  margin: "Procento ze zisku",
  revenue: "Procento z obratu",
  margin_tiered: "Pásmová měsíční provize ze zisku (z inkasa)",
};

export const DEFAULT_RULE_NAMES: Record<CommissionBase, string> = {
  margin: "Provize ze zisku",
  revenue: "Provize z obratu",
  margin_tiered: "Dodatek — pásmová měsíční provize ze zisku",
};

export const MAX_TIERS = 12;

/**
 * Ověří pásma: seřadí podle „od", první od 0, navazují (od = předchozí do),
 * poslední bez horní hranice, sazby 0–100 %. `unit` = v jakých jednotkách
 * přišly sazby (procenta z editoru / zlomky z DB). Vrací zlomky.
 */
export function cleanTiers(
  raw: unknown,
  unit: "percent" | "fraction" = "percent",
): { tiers: CommissionTierView[] } | { error: string } {
  if (!Array.isArray(raw) || !raw.length) return { error: "Zadej alespoň jedno pásmo." };
  if (raw.length > MAX_TIERS) return { error: `Maximálně ${MAX_TIERS} pásem.` };
  const parsed: CommissionTierView[] = [];
  for (let i = 0; i < raw.length; i++) {
    const t = raw[i] as { from?: unknown; to?: unknown; rate?: unknown } | null;
    if (!t || typeof t !== "object") return { error: `Pásmo ${i + 1}: neplatná data.` };
    const from = cleanNumber(t.from ?? 0);
    const to = t.to === null || t.to === undefined || t.to === "" ? null : cleanNumber(t.to);
    if (from === null || from < 0) return { error: `Pásmo ${i + 1}: neplatná dolní hranice.` };
    if (t.to !== null && t.to !== undefined && t.to !== "" && to === null) return { error: `Pásmo ${i + 1}: neplatná horní hranice.` };
    let rate: number | null;
    if (unit === "percent") rate = percentToRate(t.rate);
    else {
      const r = cleanNumber(t.rate);
      rate = r === null || r < 0 || r > 1 ? null : Math.round(r * 10_000) / 10_000;
    }
    if (rate === null) return { error: `Pásmo ${i + 1}: sazba musí být 0–100 %.` };
    parsed.push({ from: Math.round(from * 100) / 100, to: to === null ? null : Math.round(to * 100) / 100, rate });
  }
  const tiers = [...parsed].sort((a, b) => a.from - b.from);
  if (tiers[0].from !== 0) return { error: "První pásmo musí začínat od 0 Kč." };
  for (let i = 0; i < tiers.length; i++) {
    const t = tiers[i];
    const last = i === tiers.length - 1;
    if (last) {
      if (t.to !== null) return { error: "Poslední pásmo musí být bez horní hranice („a více“)." };
      continue;
    }
    if (t.to === null) return { error: `Pásmo ${i + 1}: jen poslední pásmo může být bez horní hranice.` };
    if (t.to <= t.from) return { error: `Pásmo ${i + 1}: horní hranice musí být vyšší než dolní.` };
    if (tiers[i + 1].from !== t.to) {
      return { error: `Pásma musí navazovat — pásmo ${i + 2} má začínat na ${czk(t.to)}.` };
    }
  }
  return { tiers };
}

/** Vstup editoru → smlouva pro DB, nebo česká chyba. */
export function validateCommissionRuleInput(
  input: CommissionRuleInput,
  today: string,
): { value: CleanCommissionRule } | { error: string } {
  if (!input || typeof input !== "object") return { error: "Chybí údaje smlouvy." };
  const id = input.id ? String(input.id) : null;
  if (id && !isUuid(id)) return { error: "Smlouva nenalezena." };
  if (!isUuid(input.ownerId)) return { error: "Vyber obchodníka." };
  if (!isCommissionBase(input.base)) return { error: "Vyber druh provize." };
  const base = input.base;

  let rate = 0;
  let tiers: CommissionTierView[] | null = null;
  if (base === "margin_tiered") {
    const t = cleanTiers(input.tiers, "percent");
    if ("error" in t) return t;
    tiers = t.tiers;
  } else {
    const r = percentToRate(input.rate);
    if (r === null) return { error: "Sazba provize musí být číslo 0–100 %." };
    rate = r;
  }
  // pásmová provize se v DB počítá vždy z měsíčního inkasa
  const basis: CommissionBasis = base === "margin_tiered" ? "collected" : input.basis === "collected" ? "collected" : "ordered";

  if (input.validFrom && !cleanDate(input.validFrom)) return { error: "Neplatné datum platnosti." };
  const validFrom = cleanDate(input.validFrom) ?? today;

  let payoutDays = 20;
  if (input.payoutDays !== undefined && input.payoutDays !== null && input.payoutDays !== "") {
    const d = cleanNumber(input.payoutDays);
    if (d === null || d < 0 || d > 365 || !Number.isInteger(d)) return { error: "Splatnost musí být celý počet dní 0–365." };
    payoutDays = d;
  }

  const name = cleanText(input.name, 200) ?? DEFAULT_RULE_NAMES[base];
  const note = cleanText(input.note, 2000);
  return { value: { id, ownerId: input.ownerId, name, base, basis, rate, tiers, validFrom, payoutDays, note } };
}

/** Platná smlouva k datu (nejnovější valid_from ≤ datum), jinak null. */
export function currentRule<T extends Pick<CommissionRuleView, "validFrom" | "createdAt">>(rules: T[], today: string): T | null {
  const valid = rules.filter((r) => r.validFrom <= today);
  valid.sort((a, b) => (a.validFrom === b.validFrom ? b.createdAt.localeCompare(a.createdAt) : b.validFrom.localeCompare(a.validFrom)));
  return valid[0] ?? null;
}

/** Krátký popis smlouvy: „Pásmová provize · 0/10/15/20 %", „10 % ze zisku". */
export function ruleSummary(
  rule: Pick<CommissionRuleView, "base" | "rate" | "tiers"> | null,
  profileRate = 0,
  opts: { short?: boolean } = {},
): string {
  if (!rule) return profileRate > 0 ? `${formatRate(profileRate)} ze zisku` : "Bez provize";
  if (rule.base === "margin_tiered") {
    const t = [...(rule.tiers ?? [])].sort((a, b) => a.from - b.from);
    const label = opts.short ? "Pásma" : "Pásmová provize ·";
    return t.length ? `${label} ${t.map((x) => ratePercentNumber(x.rate)).join("/")} %` : "Pásmová provize";
  }
  return `${formatRate(rule.rate)} ${rule.base === "revenue" ? "z obratu" : "ze zisku"}`;
}

/** Popisek rozsahu pásma: „do 500 000 Kč", „500 000 – 1 000 000 Kč", „nad 2 000 000 Kč". */
export function tierRangeLabel(t: Pick<CommissionTierView, "from" | "to">, compact = false): string {
  const f = (n: number) => (compact ? compactCzk(n) : czk(n));
  if (t.from <= 0 && t.to !== null) return `do ${f(t.to)}`;
  if (t.to === null) return `nad ${f(t.from)}`;
  return compact ? `${compactCzk(t.from)} – ${compactCzk(t.to)}` : `${czk(t.from).replace(/\s?Kč$/, "")} – ${czk(t.to)}`;
}

/** Řádky smlouvy pro kartu („Pásmo do 500 000 Kč → 0 % ze zisku"…). */
export function ruleLines(rule: Pick<CommissionRuleView, "base" | "rate" | "tiers" | "basis" | "payoutDays"> | null, profileRate = 0): string[] {
  if (!rule) {
    return profileRate > 0
      ? [`${formatRate(profileRate)} ze zisku každé zakázky (sazba z profilu)`, "Provize patří do měsíce objednávky."]
      : ["Bez smlouvy a bez sazby — provize se nepočítá."];
  }
  const lines: string[] = [];
  if (rule.base === "margin_tiered") {
    for (const t of [...(rule.tiers ?? [])].sort((a, b) => a.from - b.from)) {
      lines.push(`${tierRangeLabel(t)} měsíčního inkasa → ${formatRate(t.rate)} ze zisku`);
    }
    lines.push("Každé pásmo inkasa nese svůj podíl zisku; sleduje se inkaso v kalendářním měsíci.");
  } else {
    lines.push(`${formatRate(rule.rate)} ${rule.base === "revenue" ? "z obratu" : "ze zisku"} každé zakázky`);
    lines.push(rule.basis === "collected" ? "Provize patří do měsíce inkasa." : "Provize patří do měsíce objednávky.");
  }
  lines.push(`Splatnost do ${rule.payoutDays} dnů po skončení měsíce.`);
  return lines;
}

// ── Modelový příklad (editor smlouvy, NEZÁVAZNÝ) ────────────
/**
 * Stejný rozpad jako DB funkce tiered_commission_bands: každé pásmo obratu
 * nese poměrnou část zisku. Jen náhled v editoru — skutečnou provizi počítá DB.
 */
export function tieredExample(revenue: number, profit: number, tiers: CommissionTierView[]): { bands: CommissionBandView[]; commission: number } {
  const rev = Math.max(0, Number(revenue) || 0);
  const ratio = rev > 0 ? Math.max(0, Number(profit) || 0) / rev : 0;
  const r2 = (n: number) => Math.round(n * 100) / 100;
  const bands = [...tiers].sort((a, b) => a.from - b.from).map((t) => {
    const slice = Math.max(0, Math.min(rev, t.to ?? rev) - t.from);
    return { ...t, revenue: r2(slice), profit: r2(slice * ratio), commission: r2(slice * ratio * t.rate) };
  });
  return { bands, commission: r2(bands.reduce((s, b) => s + b.commission, 0)) };
}

/** Příklad pro jednoduchou smlouvu (procento ze zisku / z obratu). */
export function simpleExample(base: "margin" | "revenue", rate: number, revenue: number, profit: number): number {
  const v = base === "revenue" ? Math.max(0, revenue) * rate : Math.max(0, profit) * rate;
  return Math.round(v * 100) / 100;
}

// ── Lišta pásem ─────────────────────────────────────────────
export interface BandSegment extends CommissionBandView {
  index: number;
  /** Šířka segmentu v % lišty. */
  width: number;
  /** Naplnění segmentu inkasem (0–1). */
  fill: number;
  /** Inkaso do pásma zasáhlo. */
  reached: boolean;
  /** Další koruna inkasa padne do tohoto pásma. */
  current: boolean;
}

export interface BandBarModel {
  segments: BandSegment[];
  /** Pozice značky inkasa na liště (0–100 %). */
  markerPct: number;
  currentIndex: number;
  /** Nejbližší vyšší pásmo: kolik inkasa chybí. */
  next: { rate: number; from: number; missing: number } | null;
  commission: number;
}

/**
 * Lišta rozdělená do pásem: šířka podle rozsahu pásma (poslední otevřené pásmo
 * dostane čtvrtinu své dolní hranice, při vyšším inkasu víc), naplnění podle
 * inkasa v pásmu. Částky pásem bere z vyúčtování (DB), jinak jen rozsah.
 */
export function bandBar(
  tiers: (CommissionTierView & Partial<Pick<CommissionBandView, "revenue" | "profit" | "commission">>)[],
  revenue: number,
): BandBarModel {
  const rev = Math.max(0, Number(revenue) || 0);
  const sorted = [...tiers].sort((a, b) => a.from - b.from);
  if (!sorted.length) return { segments: [], markerPct: 0, currentIndex: -1, next: null, commission: 0 };

  const sizes = sorted.map((t) => {
    if (t.to !== null) return Math.max(0, t.to - t.from);
    const base = t.from > 0 ? t.from * 0.25 : Math.max(rev, 1);
    return Math.max(base, (rev - t.from) * 1.15);
  });
  const scale = sizes.reduce((s, n) => s + n, 0) || 1;

  let currentIndex = -1;
  const segments: BandSegment[] = sorted.map((t, index) => {
    const size = sizes[index];
    const inBand = t.revenue ?? Math.max(0, Math.min(rev, t.to ?? rev) - t.from);
    const current = t.from <= rev && (t.to === null || rev < t.to);
    if (current && currentIndex < 0) currentIndex = index;
    return {
      from: t.from,
      to: t.to,
      rate: t.rate,
      revenue: inBand,
      profit: t.profit ?? 0,
      commission: t.commission ?? 0,
      index,
      width: Math.round((size / scale) * 10_000) / 100,
      fill: size > 0 ? Math.min(1, Math.max(0, inBand / size)) : 0,
      reached: inBand > 0,
      current,
    };
  });

  const nextTier = sorted.find((t) => t.from > rev);
  return {
    segments,
    markerPct: Math.min(100, Math.round((rev / scale) * 10_000) / 100),
    currentIndex,
    next: nextTier ? { rate: nextTier.rate, from: nextTier.from, missing: Math.round((nextTier.from - rev) * 100) / 100 } : null,
    commission: Math.round(segments.reduce((s, b) => s + b.commission, 0) * 100) / 100,
  };
}

/** Barvy pásem podle pořadí (třídy vypsané celé kvůli JIT). */
export const BAND_TONES: { fill: string; track: string; text: string; chip: string }[] = [
  { fill: "bg-slate-400 dark:bg-slate-500", track: "bg-slate-200/70 dark:bg-slate-500/15", text: "text-slate-600 dark:text-slate-300", chip: "bg-slate-100 text-slate-700 dark:bg-slate-500/15 dark:text-slate-300" },
  { fill: "bg-sky-500", track: "bg-sky-500/15", text: "text-sky-700 dark:text-sky-300", chip: "bg-sky-100 text-sky-800 dark:bg-sky-500/15 dark:text-sky-300" },
  { fill: "bg-emerald-500", track: "bg-emerald-500/15", text: "text-emerald-700 dark:text-emerald-300", chip: "bg-emerald-100 text-emerald-800 dark:bg-emerald-500/15 dark:text-emerald-300" },
  { fill: "bg-amber-500", track: "bg-amber-500/15", text: "text-amber-700 dark:text-amber-300", chip: "bg-amber-100 text-amber-800 dark:bg-amber-500/15 dark:text-amber-300" },
  { fill: "bg-fuchsia-500", track: "bg-fuchsia-500/15", text: "text-fuchsia-700 dark:text-fuchsia-300", chip: "bg-fuchsia-100 text-fuchsia-800 dark:bg-fuchsia-500/15 dark:text-fuchsia-300" },
  { fill: "bg-violet-500", track: "bg-violet-500/15", text: "text-violet-700 dark:text-violet-300", chip: "bg-violet-100 text-violet-800 dark:bg-violet-500/15 dark:text-violet-300" },
];

export function bandTone(index: number) {
  return BAND_TONES[Math.max(0, index) % BAND_TONES.length];
}

// ── Editor pásem ────────────────────────────────────────────
/**
 * Koncept pásma v editoru: zadává se jen HORNÍ hranice a sazba — dolní je
 * vždy horní hranice předchozího pásma (pásma tak nemůžou mít mezeru);
 * poslední pásmo je „a více".
 */
export interface TierDraft {
  key: string;
  /** Horní hranice v Kč (u posledního pásma ignorováno). */
  to: string;
  /** Sazba v procentech. */
  rate: string;
}

let tierSeq = 0;
function tierKey(): string {
  tierSeq += 1;
  return `t${tierSeq}`;
}

function numText(n: number | null | undefined): string {
  if (n === null || n === undefined || !Number.isFinite(n)) return "";
  return String(Math.round(n * 100) / 100).replace(".", ",");
}

export function tierDraftsFromTiers(tiers: CommissionTierView[] | null | undefined): TierDraft[] {
  const src = tiers && tiers.length ? [...tiers].sort((a, b) => a.from - b.from) : DEFAULT_TIERS;
  return src.map((t) => ({ key: tierKey(), to: numText(t.to), rate: ratePercentNumber(t.rate).replace(/\s/g, "") }));
}

/** Koncepty → pásma v procentech (vstup akce) — dolní hranice dopočítané. */
export function tierDraftsToInput(drafts: TierDraft[]): { from: number | string; to: number | string | null; rate: number | string }[] {
  let from: number | string = 0;
  return drafts.map((d, i) => {
    const last = i === drafts.length - 1;
    const to = last ? null : d.to.trim();
    const out = { from, to, rate: d.rate.trim() };
    from = to === null ? from : (cleanNumber(to) ?? to);
    return out;
  });
}

/** Ověření konceptů pásem (stejná pravidla jako na serveru). */
export function validateTierDrafts(drafts: TierDraft[]): { tiers: CommissionTierView[] } | { error: string } {
  return cleanTiers(tierDraftsToInput(drafts), "percent");
}

/** Nové pásmo před posledním („a více"): horní hranice = dvojnásobek předchozí. */
export function addTierDraft(drafts: TierDraft[]): TierDraft[] {
  if (drafts.length >= MAX_TIERS) return drafts;
  if (!drafts.length) return [{ key: tierKey(), to: "", rate: "0" }];
  const prev = drafts.length >= 2 ? cleanNumber(drafts[drafts.length - 2].to) ?? 0 : 0;
  const to = prev > 0 ? prev * 2 : 500_000;
  const next = [...drafts];
  next.splice(drafts.length - 1, 0, { key: tierKey(), to: numText(to), rate: drafts[drafts.length - 1].rate || "0" });
  return next;
}

export function removeTierDraft(drafts: TierDraft[], index: number): TierDraft[] {
  if (drafts.length <= 1 || index < 0 || index >= drafts.length) return drafts;
  return drafts.filter((_, i) => i !== index);
}

// ── Vyúčtování a záznamy ────────────────────────────────────
/** Zakázky započtené do vyúčtování (u inkasa jen inkasované). */
export function entriesOfStatement<T extends Pick<CommissionEntryView, "ownerId" | "period" | "collected">>(
  entries: T[],
  st: Pick<CommissionStatementView, "ownerId" | "period" | "basis">,
): T[] {
  return entries.filter((e) => e.ownerId === st.ownerId && e.period === st.period && (st.basis !== "collected" || e.collected));
}

/** Předběžné pásmové provize (zakázka ještě není inkasovaná). */
export function pendingEntries<T extends Pick<CommissionEntryView, "base" | "collected">>(entries: T[]): T[] {
  return entries.filter((e) => e.base === "margin_tiered" && !e.collected);
}

export interface OwnerTotals {
  ownerId: string;
  /** Provize vybraného měsíce. */
  month: number;
  /** Čeká na výplatu (k výplatě). */
  toPay: number;
  /** Vyplaceno za zobrazené měsíce. */
  paid: number;
  /** Běžící měsíc (otevřené vyúčtování). */
  running: number;
  /** Odhad z neinkasovaných zakázek (pásmová provize). */
  estimate: number;
}

/** Součty po obchodnících (přehled super admina). */
export function ownerTotals(
  ownerIds: string[],
  statements: Pick<CommissionStatementView, "ownerId" | "period" | "status" | "commission">[],
  entries: Pick<CommissionEntryView, "ownerId" | "base" | "collected" | "estimatedCommission">[],
  month: string,
): OwnerTotals[] {
  const r2 = (n: number) => Math.round(n * 100) / 100;
  return ownerIds.map((ownerId) => {
    const mine = statements.filter((s) => s.ownerId === ownerId);
    const sum = (list: typeof mine) => r2(list.reduce((s, x) => s + (Number(x.commission) || 0), 0));
    return {
      ownerId,
      month: sum(mine.filter((s) => s.period === month)),
      toPay: sum(mine.filter((s) => s.status === "k_vyplate")),
      paid: sum(mine.filter((s) => s.status === "vyplaceno")),
      running: sum(mine.filter((s) => s.status === "otevrena")),
      estimate: r2(pendingEntries(entries.filter((e) => e.ownerId === ownerId)).reduce((s, e) => s + (e.estimatedCommission ?? 0), 0)),
    };
  });
}

/** Výška sloupečků měsíců (0–100) podle provize — pro výběr měsíce. */
export function monthBars(months: string[], statements: Pick<CommissionStatementView, "period" | "commission">[]): { period: string; commission: number; height: number }[] {
  const by = new Map<string, number>();
  for (const s of statements) by.set(s.period, (by.get(s.period) ?? 0) + (Number(s.commission) || 0));
  const max = Math.max(0, ...months.map((m) => by.get(m) ?? 0));
  return months.map((period) => {
    const commission = Math.round((by.get(period) ?? 0) * 100) / 100;
    return { period, commission, height: max > 0 ? Math.round((commission / max) * 100) : 0 };
  });
}
