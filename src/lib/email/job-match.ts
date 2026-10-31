import type { EmailCategory as DbEmailCategory, JobStage } from "@/lib/supabase/database.types";

/**
 * Pošta B — přiřazení e-mailu k zakázce / poptávce (čistá logika, testy v job-match.test.ts).
 *
 * Signály (kandidáty vrací RPC mail_job_candidates, migrace 20261029145000):
 *  - vlákno spojené hlavičkami (In-Reply-To / References), odpověď na naši zprávu; vlákno spojené jen
 *    předmětem („Poptávka" = „Re: Poptávka") je slabé (thread_subject),
 *  - naše čísla v předmětu, vyčištěném textu a názvech příloh (Z-…, NAB-…, OV-…); slovní tvar
 *    („nabídka 31/2026", „zakázka 7/2026") a čísla jen z citované historie jsou slabé (number_weak),
 *    číslo jiného zákazníka / objednávka jiného dodavatele = jen návrh,
 *  - číslo objednávky zákazníka, čísla výkresů položek,
 *  - firma odesílatele s otevřenými zakázkami / dodavatel s naší otevřenou objednávkou.
 * Jisté (≥ 0,85 a jednoznačné) → přiřadit automaticky; nejisté → návrh „Patří k Z-…?"; zbytek může
 * rozhodnout AI (jen kandidáti, s limitem). Uzavřená zakázka (dokončeno, zrušeno, nerealizováno,
 * fakturováno, sloučeno) = nejvýš návrh. Nová poptávka / objednávka se přiřadí automaticky jen s naším
 * číslem dané zakázky v předmětu / textu; jinak návrh (poptávka se slabým signálem nic).
 */

export type MatchSignal =
  | "thread" | "reply" | "job_number" | "quote_number" | "po_number" | "customer_order" | "drawing" | "company" | "supplier"
  | "thread_subject" | "number_weak";

export interface CandidateRow {
  job_id: string;
  number: string | null;
  title: string | null;
  status: JobStage | string | null;
  customer_id: string | null;
  signal: MatchSignal | string;
  detail: string | null;
  open: boolean | null;
  /** Dodavatel naší objednávky (signály po_number / supplier). */
  supplier_id?: string | null;
  /** U vlákna už zamítnuto („Ne, nepatří") — nepřiřazovat ani nenavrhovat, jen brzdí změny (konflikt). */
  rejected?: boolean | null;
}

export interface MatchContext {
  category: DbEmailCategory | null;
  direction: "in" | "out";
  /** Odesílatel je zákazník / dodavatel (emails.customer_id / supplier_id). */
  customerId?: string | null;
  supplierId?: string | null;
}

export interface ScoredCandidate {
  jobId: string;
  number: string;
  title: string;
  open: boolean;
  score: number;
  signals: MatchSignal[];
  /** Lidsky: „odpověď na naši zprávu", „číslo Z-2026-013 v předmětu"… */
  reasons: string[];
}

export type MatchDecision =
  | { kind: "link"; candidate: ScoredCandidate; source: MatchSignal; candidates: ScoredCandidate[] }
  | { kind: "suggest"; candidate: ScoredCandidate; source: MatchSignal; candidates: ScoredCandidate[] }
  | { kind: "ambiguous"; candidates: ScoredCandidate[] }
  | { kind: "none"; candidates: ScoredCandidate[] };

/** Signály, které samy stačí (naše vlákno / čísla). */
export const STRONG_SIGNALS: readonly MatchSignal[] = ["thread", "reply", "job_number", "quote_number", "po_number", "customer_order"];
/** Naše čísla dokladů (nová poptávka / objednávka se přiřadí automaticky jen s nimi). */
export const OUR_NUMBER_SIGNALS: readonly MatchSignal[] = ["job_number", "quote_number", "po_number"];
/** Stavy zakázky, ke kterým se pošta nepřiřazuje automaticky (jen návrh) a nemění položky. */
export const CLOSED_JOB_STAGES: readonly string[] = ["dokonceno", "zruseno", "nerealizovano", "fakturovano"];
export const WEAK_NUMBER_WEIGHT = 0.5;

const BASE_WEIGHT: Record<MatchSignal, number> = {
  thread: 0.98,
  reply: 0.97,
  job_number: 0.96,
  quote_number: 0.94,
  po_number: 0.94,
  customer_order: 0.9,
  drawing: 0.6,
  company: 0.6,
  supplier: 0.6,
  thread_subject: WEAK_NUMBER_WEIGHT,
  number_weak: WEAK_NUMBER_WEIGHT,
};

export const SIGNAL_LABEL: Record<MatchSignal, string> = {
  thread: "stejné vlákno jako přiřazená pošta",
  reply: "odpověď na naši zprávu k zakázce",
  job_number: "číslo zakázky v e-mailu",
  quote_number: "číslo naší nabídky v e-mailu",
  po_number: "číslo naší objednávky dodavateli",
  customer_order: "číslo objednávky zákazníka",
  drawing: "číslo výkresu položky",
  company: "jediná otevřená zakázka firmy",
  supplier: "otevřená objednávka u dodavatele",
  thread_subject: "stejný předmět jako dřívější pošta",
  number_weak: "číslo podobné našemu dokladu",
};

/** Krátký popisek zdroje přiřazení (chip „přiřazeno: …"). */
export const LINK_SOURCE_LABEL: Record<string, string> = {
  thread: "vlákno",
  reply: "odpověď",
  job_number: "číslo zakázky",
  quote_number: "číslo nabídky",
  po_number: "objednávka dodavateli",
  customer_order: "objednávka zákazníka",
  drawing: "číslo výkresu",
  company: "firma",
  supplier: "dodavatel",
  thread_subject: "předmět vlákna",
  number_weak: "podobné číslo",
  ai: "AI",
  manual: "ručně",
  created: "založeno z e-mailu",
  sent: "odesláno ze zakázky",
  rfq: "odpověď na poptávku",
};

export const AUTO_LINK_SCORE = 0.85;
export const SUGGEST_SCORE = 0.5;
/** Nejasné bez AI (víc otevřených zakázek firmy): návrh nejpravděpodobnější, je-li aspoň takhle jistá. */
export const FALLBACK_SUGGEST_SCORE = 0.3;
const CLEAR_MARGIN = 0.2;

function isSignal(v: unknown): v is MatchSignal {
  return typeof v === "string" && v in BASE_WEIGHT;
}

/** Číslo výkresu / dokladu pro porovnání (= SQL drawing_norm): velká písmena bez mezer, teček, pomlček, lomítek. */
export function normToken(v: string | null | undefined): string | null {
  const n = (v ?? "").replace(/[\s.\-/]/g, "").toUpperCase();
  return n || null;
}

const OUR_NUMBER_RE = /\b(Z|NAB|OV)\s?[-–]\s?(20\d{2})\s?[-–/]\s?(\d{1,5})(?:\s?-\s?R\d{1,3})?\b/gi;
/** „objednávka (dodavateli) OV 5/2026" — jen s doslovným „OV" (vlastní „objednávka č. 1382/2026" zákazníka NE). */
const PO_WORD_RE = /\bobjedn[aá]v\w*\s+(?:dodavateli\s+)?OV\s*(?:[čc]\.|[čc][ií]slo)?\s*(\d{1,5})\s*\/\s*(20\d{2})\b/gi;
/** Slovní tvar „nabídka (č.) 031/2026", „zakázka 13/2026" — může být i číslo dokladu zákazníka → slabý signál. */
const WORD_NUMBER_RE = /\b(nab[ií]d(?:k|c)\w*|nab\.|zak[aá]z(?:k|c)\w*|zak\.)\s*(?:[čc]\.|[čc][ií]slo)?\s*(\d{1,5})\s*\/\s*(20\d{2})\b/gi;

function pad(n: string): string {
  const s = String(Number(n));
  return s.length >= 3 ? s : s.padStart(3, "0");
}

/** Naše čísla dokladů v textu (jistý tvar): Z-2026-013, NAB-2026-031 (i -R2), OV-2026-005, „objednávka OV 5/2026". */
export function extractOurNumbers(...texts: (string | null | undefined)[]): string[] {
  const out = new Set<string>();
  for (const text of texts) {
    // „_" odděluje i názvy příloh („Z-2026-010_vykres.pdf")
    const t = (text ?? "").replace(/_/g, " ");
    for (const m of t.matchAll(OUR_NUMBER_RE)) out.add(`${m[1].toUpperCase()}-${m[2]}-${pad(m[3])}`);
    for (const m of t.matchAll(PO_WORD_RE)) out.add(`OV-${m[2]}-${pad(m[1])}`);
  }
  return [...out].slice(0, 30);
}

/** Slovní tvar „nabídka 31/2026" → NAB-2026-031, „zakázka 7/2026" → Z-2026-007 (slabý signál). */
export function extractWordNumbers(...texts: (string | null | undefined)[]): string[] {
  const out = new Set<string>();
  for (const text of texts) {
    for (const m of (text ?? "").matchAll(WORD_NUMBER_RE)) {
      out.add(`${m[1].toLowerCase().startsWith("nab") ? "NAB" : "Z"}-${m[3]}-${pad(m[2])}`);
    }
  }
  return [...out].slice(0, 30);
}

/** Číslo dokladu bez revize nabídky („NAB-2026-031-R2" → „NAB-2026-031"). */
export function baseDocNumber(n: string | null | undefined): string {
  return (n ?? "").trim().toUpperCase().replace(/-R\d+$/i, "");
}

/**
 * Signály našich čísel, jejichž číslo je jen ve slabém tvaru (slovní tvar, citovaná historie) →
 * number_weak (nejvýš návrh). strong = čísla z předmětu, vyčištěného textu a názvů příloh.
 */
export function weakenNumberSignals(rows: readonly CandidateRow[], strong: readonly string[]): CandidateRow[] {
  const set = new Set(strong.map(baseDocNumber));
  return rows.map((r) => (OUR_NUMBER_SIGNALS.includes(r.signal as MatchSignal) && !set.has(baseDocNumber(r.detail))
    ? { ...r, signal: "number_weak" }
    : r));
}

/** Faktura dodavatele z e-mailu (B5) → Faktury dodavatelů, ne dokumenty zakázky. */
export function isSupplierInvoiceMail(m: { category: string | null; supplier_id?: string | null; job_link_source?: string | null }): boolean {
  return m.category === "faktura" && Boolean(m.supplier_id || m.job_link_source === "po_number" || m.job_link_source === "supplier");
}

/**
 * Tokeny pro číslo objednávky zákazníka a čísla výkresů (normalizované jako drawing_norm): slova
 * s číslicí, 4–40 znaků, z textu i z názvů příloh (bez přípony, části oddělené „_" i celé).
 */
export function matchTokens(texts: (string | null | undefined)[], filenames: (string | null | undefined)[] = []): string[] {
  const out = new Set<string>();
  const add = (raw: string) => {
    const n = normToken(raw.replace(/^[^\p{L}\p{N}]+|[^\p{L}\p{N}]+$/gu, ""));
    if (n && n.length >= 4 && n.length <= 40 && /\d/.test(n)) out.add(n);
  };
  for (const t of texts) {
    for (const w of (t ?? "").slice(0, 20000).split(/[\s,;:()[\]{}<>"'„“”‚‘’|*]+/)) if (w) add(w);
  }
  for (const f of filenames) {
    const base = (f ?? "").replace(/\.[a-z0-9]{1,5}$/i, "");
    if (!base) continue;
    add(base);
    for (const part of base.split(/[_\s]+/)) if (part) add(part);
  }
  return [...out].slice(0, 300);
}

function weightOf(signal: MatchSignal, row: CandidateRow, ctx: MatchContext, companyCount: number, supplierCount: number): number {
  const open = row.open !== false;
  const otherCustomer = Boolean(ctx.customerId && row.customer_id && row.customer_id !== ctx.customerId);
  switch (signal) {
    case "job_number":
    case "quote_number":
      // naše číslo zakázky / nabídky jiného zákazníka = jen návrh
      return otherCustomer ? WEAK_NUMBER_WEIGHT : BASE_WEIGHT[signal];
    case "po_number":
      // naše objednávka: jistá jen od dodavatele té objednávky
      return otherCustomer || !ctx.supplierId || (row.supplier_id && row.supplier_id !== ctx.supplierId) ? WEAK_NUMBER_WEIGHT : BASE_WEIGHT.po_number;
    case "drawing": {
      const sameCustomer = Boolean(ctx.customerId && row.customer_id === ctx.customerId);
      if (!open) return sameCustomer ? 0.4 : 0.25;
      return sameCustomer ? 0.85 : 0.55;
    }
    case "company":
      return companyCount <= 1 ? 0.6 : companyCount === 2 ? 0.35 : 0.2;
    case "supplier":
      return supplierCount <= 1 ? 0.6 : supplierCount === 2 ? 0.35 : 0.2;
    case "customer_order":
      return ctx.customerId && row.customer_id && row.customer_id !== ctx.customerId ? 0.6 : BASE_WEIGHT.customer_order;
    default:
      return BASE_WEIGHT[signal];
  }
}

/** Kandidáti seřazení podle jistoty (kombinace signálů 1 − Π(1 − w)). */
export function scoreCandidates(rows: readonly CandidateRow[], ctx: MatchContext): ScoredCandidate[] {
  const companyJobs = new Set(rows.filter((r) => r.signal === "company").map((r) => r.job_id));
  const supplierJobs = new Set(rows.filter((r) => r.signal === "supplier").map((r) => r.job_id));
  // signál se počítá jednou na zakázku; víc řádků téhož signálu (dvě nabídky / OV / výkresy jedné zakázky)
  // → platí nejsilnější (např. OV od dodavatele té objednávky), ne náhodně první
  const by = new Map<string, { row: CandidateRow; ws: number[]; at: Map<MatchSignal, number>; reasons: string[] }>();
  for (const r of rows) {
    if (!r?.job_id || !isSignal(r.signal)) continue;
    const e = by.get(r.job_id) ?? { row: r, ws: [], at: new Map<MatchSignal, number>(), reasons: [] };
    const w = weightOf(r.signal, r, ctx, companyJobs.size, supplierJobs.size);
    const detail = (r.detail ?? "").trim();
    const reason = r.signal === "drawing" || r.signal === "customer_order" || r.signal.endsWith("_number")
      ? `${SIGNAL_LABEL[r.signal]}${detail ? ` ${detail}` : ""}`
      : SIGNAL_LABEL[r.signal];
    const i = e.at.get(r.signal);
    if (i === undefined) {
      e.at.set(r.signal, e.ws.length);
      e.ws.push(w);
      e.reasons.push(reason);
    } else if (w > e.ws[i]) {
      e.ws[i] = w;
      e.reasons[i] = reason;
    }
    by.set(r.job_id, e);
  }
  const out: ScoredCandidate[] = [];
  for (const [jobId, e] of by) {
    const score = Math.min(0.99, 1 - e.ws.reduce((p, w) => p * (1 - w), 1));
    out.push({
      jobId, number: e.row.number ?? "", title: e.row.title ?? "", open: e.row.open !== false,
      score: Math.round(score * 1000) / 1000, signals: [...e.at.keys()], reasons: e.reasons,
    });
  }
  // shoda skóre → otevřená, pak novější zakázka (vyšší číslo)
  return out.sort((a, b) => b.score - a.score || Number(b.open) - Number(a.open) || b.number.localeCompare(a.number));
}

function bestSignal(c: ScoredCandidate): MatchSignal {
  const order: MatchSignal[] = ["thread", "reply", "job_number", "quote_number", "po_number", "customer_order", "drawing", "supplier", "company", "thread_subject", "number_weak"];
  return order.find((s) => c.signals.includes(s)) ?? c.signals[0] ?? "company";
}

export function hasStrongSignal(c: Pick<ScoredCandidate, "signals">): boolean {
  return c.signals.some((s) => STRONG_SIGNALS.includes(s));
}

/**
 * Rozhodnutí: přiřadit / navrhnout / nejisté (pro AI) / nic. Nová poptávka bez silného signálu se
 * nepřiřazuje ani nenavrhuje (zůstává Poptávkou); nová objednávka se slabým signálem jen jako návrh.
 */
export function decideMatch(rows: readonly CandidateRow[], ctx: MatchContext): MatchDecision {
  const candidates = scoreCandidates(rows, ctx);
  const [top, second] = candidates;
  if (!top) return { kind: "none", candidates };
  const strong = hasStrongSignal(top);
  const threadish = (c: ScoredCandidate) => c.signals.includes("thread") || c.signals.includes("reply");
  const clear = !second || top.score - second.score >= CLEAR_MARGIN || (strong && !hasStrongSignal(second))
    || (threadish(top) && !threadish(second));
  const newBusiness = ctx.direction === "in" && (ctx.category === "poptavka" || ctx.category === "objednavka");
  if (newBusiness && !strong) {
    if (ctx.category === "objednavka" && clear && top.score >= SUGGEST_SCORE && top.open) {
      return { kind: "suggest", candidate: top, source: bestSignal(top), candidates };
    }
    return { kind: "none", candidates };
  }
  const autoOk = top.score >= AUTO_LINK_SCORE && clear
    // uzavřená / sloučená zakázka: nikdy automaticky (nová poptávka ve starém vlákně)
    && top.open
    // nová poptávka / objednávka: automaticky jen s naším číslem té zakázky v předmětu / textu
    && (!newBusiness || top.signals.some((s) => OUR_NUMBER_SIGNALS.includes(s)));
  if (autoOk) return { kind: "link", candidate: top, source: bestSignal(top), candidates };
  if (top.score >= AUTO_LINK_SCORE && clear && ctx.direction === "in") return { kind: "suggest", candidate: top, source: bestSignal(top), candidates };
  // odchozí pošta: jen jisté přiřazení (návrhy jsou pro příchozí)
  if (ctx.direction === "out") return { kind: "none", candidates };
  if (top.score >= SUGGEST_SCORE && clear) return { kind: "suggest", candidate: top, source: bestSignal(top), candidates };
  return { kind: "ambiguous", candidates: candidates.slice(0, 6) };
}

/**
 * Kategorie po přiřazení: komunikace k zakázce → „K zakázce". Zůstává: poptávka (nová poptávka se nikdy
 * automaticky nepřetřídí), objednávka, potvrzení, faktura, upomínka, reklamace, spam, nabídka DODAVATELE.
 * Odpověď zákazníka na naši nabídku („Re: Nabídka NAB-…") pravidla zařadí jako nabídku dodavatele — od
 * nedodavatele se silným signálem je to komunikace k zakázce.
 */
export function categoryAfterLink(
  category: DbEmailCategory | null,
  opts: { direction: "in" | "out"; strong: boolean; fromSupplier: boolean },
): DbEmailCategory | null {
  if (opts.direction !== "in") return category;
  const c = category ?? "ostatni";
  if (c === "ostatni" || c === "technicka_dokumentace") return "k_zakazce";
  if (c === "nabidka_dodavatele" && opts.strong && !opts.fromSupplier) return "k_zakazce";
  return category;
}

// ── Odpověď ve vlákně jmenuje jinou zakázku (owner: špatná změna na špatné zakázce = špatné díly) ──

/**
 * Vlastní text e-mailu: VYČIŠTĚNÉ tělo (bez citace a podpisu) + názvy příloh. Předmět zvlášť (subjectNumbers,
 * jen naše čísla Z- / NAB- / OV-): dědí se z vlákna, takže se počítá jen číslo, které v dřívějších předmětech
 * pošty zakázky vlákna nebylo (zákazník předmět změnil na jinou zakázku).
 */
export interface OwnText { numbers: readonly string[]; tokens: readonly string[]; subjectNumbers?: readonly string[] }

export function ownTextOf(clean: string | null | undefined, files: readonly (string | null | undefined)[] = [], subject?: string | null): OwnText {
  return { numbers: extractOurNumbers(clean, ...files), tokens: matchTokens([clean], [...files]), subjectNumbers: extractOurNumbers(subject) };
}

/** Signály vlákna — jejich detail je předmět dřívější pošty zakázky (SQL mail_job_candidates). */
const THREAD_SIGNALS: readonly string[] = ["thread", "reply", "thread_subject"];

/** Naše čísla zakázky (zakázka / nabídka / OV), která jmenuje předmět a dřívější předměty vlákna ne. */
function subjectHits(rows: readonly CandidateRow[], jobId: string, subject: ReadonlySet<string>, inherited: ReadonlySet<string>): Set<MatchSignal> {
  const out = new Set<MatchSignal>();
  if (!subject.size) return out;
  for (const r of rows) {
    if (r.job_id !== jobId || !isSignal(r.signal) || !OUR_NUMBER_SIGNALS.includes(r.signal) || !r.detail) continue;
    const n = baseDocNumber(r.detail);
    if (subject.has(n) && !inherited.has(n)) out.add(r.signal);
  }
  return out;
}

const NUMBER_CLASS: readonly MatchSignal[] = ["job_number", "quote_number", "po_number", "customer_order"];

/** Signály zakázky, jejichž hodnotu jmenuje vlastní text e-mailu (číslo zakázky / nabídky / OV / objednávky zákazníka, výkres). */
function ownHits(rows: readonly CandidateRow[], jobId: string, own: OwnText): Set<MatchSignal> {
  const nums = new Set(own.numbers.map(baseDocNumber));
  const toks = new Set(own.tokens);
  const out = new Set<MatchSignal>();
  for (const r of rows) {
    if (r.job_id !== jobId || !isSignal(r.signal)) continue;
    if (OUR_NUMBER_SIGNALS.includes(r.signal)) {
      if (r.detail && nums.has(baseDocNumber(r.detail))) out.add(r.signal);
    } else if (r.signal === "customer_order" || r.signal === "drawing") {
      const n = normToken(r.detail);
      if (n && toks.has(n)) out.add(r.signal);
    }
  }
  return out;
}

export interface ThreadConflict {
  /** Jiná otevřená zakázka, kterou vlastní text e-mailu jmenuje. */
  other: ScoredCandidate;
  /**
   * true = text jmenuje naše číslo / objednávku zákazníka JINÉ zakázky (téhož zákazníka) a zakázku vlákna
   * ne → nepřiřazovat vláknem, jen návrh „Patří k …?". false = vlákno platí, ale změny jen jako návrh.
   */
  strong: boolean;
  signals: MatchSignal[];
}

/**
 * Přiřazení vláknem / odpovědí, ale vlastní (necitovaný) text odpovědi — nebo předmět změněný na naše číslo
 * jiné zakázky — jmenuje jinou otevřenou zakázku. Výkres stejný v obou zakázkách nerozhoduje; uzavřená
 * zakázka a výkres cizí firmy se nepočítají.
 */
export function threadConflict(top: ScoredCandidate, rows: readonly CandidateRow[], own: OwnText, ctx: MatchContext): ThreadConflict | null {
  if (!top.signals.includes("thread") && !top.signals.includes("reply")) return null;
  const mine = ownHits(rows, top.jobId, own);
  const mineNumber = [...mine].some((s) => NUMBER_CLASS.includes(s));
  // předmět: naše čísla, která v dřívějších předmětech pošty zakázky vlákna nebyla (zděděné „Re: …" ne)
  const subject = new Set((own.subjectNumbers ?? []).map(baseDocNumber));
  const inherited = new Set(extractOurNumbers(...rows.filter((r) => r.job_id === top.jobId && THREAD_SIGNALS.includes(r.signal)).map((r) => r.detail)).map(baseDocNumber));
  const mineSubject = subject.has(baseDocNumber(top.number)) || subjectHits(rows, top.jobId, subject, new Set()).size > 0;
  const all = scoreCandidates(rows, ctx);
  let best: ThreadConflict | null = null;
  for (const c of all) {
    if (c.jobId === top.jobId || !c.open) continue;
    const hits = ownHits(rows, c.jobId, own);
    const subj = subjectHits(rows, c.jobId, subject, inherited);
    if (!hits.size && !subj.size) continue;
    const row = rows.find((r) => r.job_id === c.jobId);
    const otherCustomer = Boolean(ctx.customerId && row?.customer_id && row.customer_id !== ctx.customerId);
    // u vlákna dřív zamítnutá zakázka („Ne" / přeřazení vlákna): NOVÁ zpráva, která ji výslovně jmenuje
    // naším číslem, se zeptá znovu (rozhodnutí platilo pro dřívější zprávy); zmínka jen výkresem ne
    const number = [...hits].some((s) => NUMBER_CLASS.includes(s));
    let found: ThreadConflict | null = null;
    if (number) found = { other: c, strong: !mineNumber && !otherCustomer, signals: [...hits] };
    // předmět změněný na číslo jiné zakázky jako vlastní text; jmenuje-li (předmět / text) i zakázku vlákna → jen návrhy
    else if (subj.size) found = { other: c, strong: !mineNumber && !mineSubject && !otherCustomer, signals: [...subj] };
    else if (hits.has("drawing") && !otherCustomer && !mine.size) found = { other: c, strong: false, signals: [...hits] };
    if (found && (!best || (found.strong && !best.strong))) best = found;
  }
  return best;
}

/**
 * Nejasné bez AI (víc otevřených zakázek firmy se stejnou jistotou): návrh zakázky s nejčerstvější
 * komunikací (poslední přiřazená pošta), ne nejvyššího čísla. Vyšší jistota má vždy přednost.
 */
export function pickLatestCommunication(cands: readonly ScoredCandidate[], lastMailAt: ReadonlyMap<string, string>): ScoredCandidate {
  const top = cands[0];
  const tied = cands.filter((c) => Math.abs(c.score - top.score) < 0.001 && c.open === top.open);
  let best = top;
  let bestAt = Date.parse(lastMailAt.get(top.jobId) ?? "") || 0;
  for (const c of tied) {
    const at = Date.parse(lastMailAt.get(c.jobId) ?? "") || 0;
    if (at > bestAt) {
      best = c;
      bestAt = at;
    }
  }
  return best;
}

/** Text chipu důvodu („odpověď na naši zprávu k zakázce · číslo výkresu H-200"). */
export function reasonsText(c: Pick<ScoredCandidate, "reasons">, max = 2): string {
  return c.reasons.slice(0, max).join(" · ");
}
