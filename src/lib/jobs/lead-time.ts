/**
 * Dodací lhůta z textu nabídky / dodacích podmínek (čistá logika, sdílí server i klient).
 * „4 týdny od objednání", „6–8 týdnů", „30 pracovních dnů", „Lieferzeit 4 Wochen", „4 weeks ARO",
 * „3 měsíce", „ihned / skladem" → počet dní + druh dní + od čeho se počítá. „dle dohody" = nic.
 * addLeadTime: pracovní dny bez víkendů a českých státních svátků (Velikonoce vlastním výpočtem),
 * kalendářní dny / měsíce prostým přičtením. isRealisticDueDate: termín v budoucnosti, po datu objednávky.
 */

export type LeadUnit = "kalendarni" | "pracovni";
export type LeadFrom = "objednavka" | "potvrzeni" | "podklady" | null;

export interface LeadTime {
  /** Počet dní (u rozpětí horní mez; u měsíců orientačně měsíce × 30). */
  days: number;
  unit: LeadUnit;
  /** Od čeho se lhůta počítá (null = neuvedeno → od objednání). */
  from: LeadFrom;
  /** Nalezený úsek textu („do 4 týdnů od objednání"). */
  text: string;
  /** Rozpětí ve dnech [od, do] („6–8 týdnů", „ihned" = 0–3 prac. dny). */
  range?: [number, number];
  /** Lhůta v kalendářních měsících (přičítá se po měsících). */
  months?: number;
}

/** Bez diakritiky, malými písmeny (délka zachována — indexy sedí na původní text). */
function fold(s: string): string {
  return s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
}

const WORD_NUMBERS: Record<string, number> = {
  jeden: 1, jedna: 1, jednoho: 1, jednu: 1, dva: 2, dve: 2, dvou: 2, tri: 3, trech: 3, ctyri: 4, ctyr: 4, pet: 5, sest: 6,
  sedm: 7, osm: 8, devet: 9, deset: 10, dvanact: 12, ein: 1, eine: 1, einen: 1, zwei: 2, drei: 3, vier: 4, funf: 5, fuenf: 5,
  sechs: 6, acht: 8, zehn: 10, one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, ten: 10, twelve: 12,
};

const NUM = String.raw`(\d{1,3}(?:[.,]\d)?|${Object.keys(WORD_NUMBERS).sort((a, b) => b.length - a.length).join("|")})`;
/** „6–8", „6 - 8", „6 až 8", „6 bis 8", „6 to 8". */
const RANGE = String.raw`${NUM}(?:\s*(?:-|–|—|az|bis|to|or|nebo|\/)\s*${NUM})?`;

/** Jednotky (bez diakritiky). Pořadí: pracovní dny před dny. */
const UNIT_RE = String.raw`(pracovni(?:ch|m)?\s+(?:dn[iuy]|dnech|den)|prac\.?\s*(?:dn[iuy]|dnu|d\.?)|pd\b|arbeitstag(?:e|en)?|werktag(?:e|en)?|business\s+days?|working\s+days?|work\s+days?|kalendarni(?:ch)?\s+(?:dn[iuy]|dnu|den)|dn[iuy]\b|dnu\b|den\b|dnech\b|tag(?:e|en)?\b|days?\b|d\b|tydn[uyi]?\b|tydnech\b|tyden\b|tyd\.?|tydny\b|wochen?\b|wo\.|weeks?\b|wks?\b|w\b|mesic(?:e|u|i|ich)?\b|mes\.|monat(?:e|en)?\b|months?\b|mo\b)`;

const LEAD_RE = new RegExp(String.raw`(?<![\p{L}\d])${RANGE}\s*(?:-\s*)?${UNIT_RE}`, "giu");

function num(s: string | undefined): number | null {
  if (!s) return null;
  const w = WORD_NUMBERS[s];
  if (w !== undefined) return w;
  const n = Number(s.replace(",", "."));
  return Number.isFinite(n) && n >= 0 ? n : null;
}

type UnitKind = "pracovni" | "den" | "tyden" | "mesic";

function unitKind(u: string): UnitKind {
  if (/^(pracovni|prac|pd|arbeitstag|werktag|business|working|work)/.test(u)) return "pracovni";
  if (/^(tyd|woch|wo\.|week|wk|w$)/.test(u)) return "tyden";
  if (/^(mesic|mes\.|monat|month|mo$)/.test(u)) return "mesic";
  return "den";
}

/** Od čeho se lhůta počítá — hledá se v okolí nalezené lhůty (za ní, pak celý text). */
function fromOf(text: string): LeadFrom {
  if (/(potvrz|order confirmation|confirmation of order|auftragsbestatigung|bestellbestatigung|\boc\b)/.test(text)) return "potvrzeni";
  if (/(podklad|vykres|dat\b|dokumentac|zeichnung|unterlagen|drawings?|documents?|approval|schvalen|freigabe)/.test(text)) return "podklady";
  if (/(objedn|zakazk|\baro\b|after receipt of (?:the )?order|from (?:the )?order|after order|upon order|of order|auftragseingang|auftragserteilung|bestellung|nach auftrag|ab auftrag|order date)/.test(text)) return "objednavka";
  return null;
}

/** Text, který lhůtu neurčuje („dle dohody", „po dohodě", „nach Vereinbarung", „to be agreed"). */
const BY_AGREEMENT = /(dle|podle|po)\s+dohod|k\s+dohodn|nach\s+(vereinbarung|absprache)|to\s+be\s+agreed|by\s+agreement|tba\b|tbd\b|upon\s+request|na\s+dotaz/;

/** „dle dohody", „nach Absprache", „to be agreed"… (lhůtu neurčuje). */
export function isByAgreement(text: string): boolean {
  return BY_AGREEMENT.test(fold(text));
}
/** Okamžitá dodávka: „ihned", „skladem", „ab Lager", „sofort", „from stock", „immediately". */
const IMMEDIATE = /(ihned|okamzite|skladem|ze\s+skladu|ab\s+lager|sofort|lagerware|from\s+stock|ex\s+stock|in\s+stock|immediately|immediate)/;

/**
 * Slovo jiné podmínky než dodací (bez diakritiky): platnost nabídky / cen („platí 30 dní", „Platnost této
 * cenové nabídky je 30 dní", „Angebot gilt 30 Tage", „Bindefrist", „freibleibend", „valid"), platba
 * („Platba převodem 14 dní", „Zahlung 30 Tage", „Skonto … při platbě do 10 dnů", „payment"), záruka
 * („Záruční doba 24 měsíců", „Garantie 12 Monate", „guarantee", „warranty") a reklamace.
 */
const OTHER_TERM = /(splatn|platn|plati\b|platebn|platb|zaruk|zaruc|garanc|garant|guarant|zahlung|zahlbar|skont|bindefrist|freibleib|gultig|gueltig|\bgilt\b|\bgelten\b|gewahrleist|payment|payable|valid|warranty|\bnet(?:to)?\b|reklamac)/g;
/** Slovo o dodání / výrobě — po něm předchozí jiná podmínka už neplatí („Platba 14 dní, dodání 4 týdny"). */
const DELIVERY_WORD = /(dodan|dodac|dodav|dodam|dodat|dodej|vyrob|expedic|odesl|liefer|deliver|lead\s*time|\baro\b|shipping|shipment|versand|fertigung|production|manufactur)/g;
/** Slovo jiné podmínky hned ZA číslem („30 Tage netto", „14 dní splatnost", „30 days net", „30 Tage gültig"). */
const OTHER_AFTER = /^\W*(?:netto|net\b|splatn|gultig|gueltig|gilt\b|valid|zahlbar|payable)/;

function lastIndexOf(re: RegExp, s: string): { index: number; end: number } | null {
  re.lastIndex = 0;
  let m: RegExpExecArray | null;
  let last: { index: number; end: number } | null = null;
  while ((m = re.exec(s))) last = { index: m.index, end: m.index + m[0].length };
  return last;
}

/**
 * Vyloučit čísla, která lhůtou nejsou: splatnost faktury, platnost nabídky, záruka, platba.
 * before = text věty před číslem, after = text za jednotkou. Rozhoduje poslední slovo jiné podmínky
 * PO posledním slově o dodání v téže větě (čárka hranicí není: „Platební podmínky: převodem, 14 dní").
 */
function isOtherTerm(before: string, after: string): boolean {
  // klíčové slovo ZA číslem v téže klauzuli
  const tail = after.split(/[.;,\n]/)[0] ?? "";
  if (OTHER_AFTER.test(tail)) return true;
  // jen poslední věta — „Splatnost 14 dní. Dodání 10 dní" se nesmí vyloučit
  const sentence = before.split(/[.;\n]\s/).pop() ?? before;
  const other = lastIndexOf(OTHER_TERM, sentence);
  if (!other) return false;
  const delivery = lastIndexOf(DELIVERY_WORD, sentence);
  if (delivery && delivery.index > other.index) return false;
  const clauseStart = Math.max(sentence.lastIndexOf(", "), sentence.lastIndexOf(",")) + 1;
  if (other.index >= clauseStart) {
    // stejná klauzule: nejvýš ~6 slov mezi klíčovým slovem a číslem („Platnost této cenové nabídky je 30 dní")
    return /^\S*\W*(\S+\s+){0,6}$/.test(sentence.slice(other.end));
  }
  // dřívější klauzule téže věty bez slova o dodání: jiná podmínka pokračuje („Platba převodem, 14 dní"),
  // ledaže lhůta říká, od čeho běží („Platba 14 dní, 4 týdny od objednání")
  return !fromOf(tail);
}

/** „3D model", „2D výkres", „3D CAD" — číslo + „d" je technické označení, ne lhůta. */
const TECH_AFTER = /^\s*[-/]?\s*(model|vykres|cad|data|dat\b|tisk|print|sken|scan|step|stp\b|dxf|dwg|pdf|soubor|zeichnung|drawing|file|format|geometri|mereni|measur|konstrukc)/;

/**
 * Dodací lhůta z textu (česky, německy, anglicky), null = žádná / „dle dohody".
 * Rozpětí → horní mez (range zachová obě). Bez slova „pracovní" = kalendářní dny.
 */
export function parseLeadTime(text: string | null | undefined, opts: { startAt?: number } = {}): LeadTime | null {
  const raw = (text ?? "").normalize("NFC").replace(/\s+/g, " ").trim();
  if (!raw) return null;
  const f = fold(raw);
  // startAt: lhůta se hledá až od této pozice, text před ní je jen kontext („Platební lhůta 14 dní")
  const startAt = Math.max(0, opts.startAt ?? 0);
  LEAD_RE.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = LEAD_RE.exec(f))) {
    if (m.index < startAt) continue;
    const start = m.index;
    const end = m.index + m[0].length;
    const before = f.slice(Math.max(0, start - 80), start);
    if (isOtherTerm(before, f.slice(end, end + 40))) continue;
    const a = num(m[1]);
    const b = num(m[2]);
    if (a === null) continue;
    const lo = b !== null ? Math.min(a, b) : a;
    const hi = b !== null ? Math.max(a, b) : a;
    if (!(hi > 0)) continue;
    const kind = unitKind(m[3]);
    // „d" / „w" / „mo" samotné jen hned za číslicí (30d, 4w) — jinak to bývá něco jiného
    if (/^(d|w|mo)$/.test(m[3]) && !/\d\s?$/.test(f.slice(start, end - m[3].length))) continue;
    // „2D / 3D" (velké D, malé „2d/3d" bez mezery, nebo za ním model / výkres / CAD…) není lhůta
    const flat = (hi === 2 || hi === 3) && (raw[end - 1] === "D" || /^[23]d$/.test(m[0]));
    if (m[3] === "d" && (flat || TECH_AFTER.test(f.slice(end, end + 20)))) continue;
    const after = f.slice(end, end + 60);
    const from = fromOf(after) ?? fromOf(before.slice(-25));
    let snippet = raw.slice(start, end);
    if (from) {
      const tail = raw.slice(end, end + 50);
      const stop = tail.search(/[.;,\n()]|\s(?:a|und|and|platnost|splatnost|cena|price|preis)\s/i);
      snippet += stop >= 0 ? tail.slice(0, stop) : tail;
    }
    const mult = kind === "tyden" ? 7 : kind === "mesic" ? 30 : 1;
    const lead: LeadTime = {
      days: Math.round(hi * mult), unit: kind === "pracovni" ? "pracovni" : "kalendarni", from, text: snippet.trim(),
    };
    if (b !== null && lo !== hi) lead.range = [Math.round(lo * mult), Math.round(hi * mult)];
    if (kind === "mesic") lead.months = hi;
    if (lead.days > 3 * 365) continue;
    return lead;
  }
  if (BY_AGREEMENT.test(f)) return null;
  const im = IMMEDIATE.exec(f);
  if (im) return { days: 3, unit: "pracovni", from: null, text: raw.slice(im.index, im.index + im[0].length), range: [0, 3] };
  return null;
}

// ── Kalendář ────────────────────────────────────────────────
function ymd(d: Date): string {
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}-${String(d.getUTCDate()).padStart(2, "0")}`;
}

export function parseYmd(s: string | null | undefined): Date | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec((s ?? "").trim());
  if (!m) return null;
  const d = new Date(Date.UTC(+m[1], +m[2] - 1, +m[3]));
  return ymd(d) === m[0] ? d : null;
}

/** Velikonoční neděle (anonymní gregoriánský algoritmus). */
export function easterSunday(year: number): string {
  const a = year % 19;
  const b = Math.floor(year / 100);
  const c = year % 100;
  const d = Math.floor(b / 4);
  const e = b % 4;
  const f = Math.floor((b + 8) / 25);
  const g = Math.floor((b - f + 1) / 3);
  const h = (19 * a + b - d - g + 15) % 30;
  const i = Math.floor(c / 4);
  const k = c % 4;
  const l = (32 + 2 * e + 2 * i - h - k) % 7;
  const m = Math.floor((a + 11 * h + 22 * l) / 451);
  const month = Math.floor((h + l - 7 * m + 114) / 31);
  const day = ((h + l - 7 * m + 114) % 31) + 1;
  return ymd(new Date(Date.UTC(year, month - 1, day)));
}

const holidayCache = new Map<number, Set<string>>();

/** České státní svátky a dny pracovního klidu v roce (vč. Velkého pátku a Velikonočního pondělí). */
export function czechHolidays(year: number): Set<string> {
  const hit = holidayCache.get(year);
  if (hit) return hit;
  const fixed = ["01-01", "05-01", "05-08", "07-05", "07-06", "09-28", "10-28", "11-17", "12-24", "12-25", "12-26"];
  const out = new Set(fixed.map((md) => `${year}-${md}`));
  const easter = parseYmd(easterSunday(year))!;
  out.add(ymd(new Date(easter.getTime() - 2 * 86_400_000))); // Velký pátek
  out.add(ymd(new Date(easter.getTime() + 86_400_000))); // Velikonoční pondělí
  holidayCache.set(year, out);
  return out;
}

export function isWorkingDay(date: string): boolean {
  const d = parseYmd(date);
  if (!d) return false;
  const wd = d.getUTCDay();
  return wd !== 0 && wd !== 6 && !czechHolidays(d.getUTCFullYear()).has(date);
}

export function addDays(date: string, n: number): string {
  const d = parseYmd(date);
  if (!d) return "";
  return ymd(new Date(d.getTime() + n * 86_400_000));
}

function addMonths(date: string, months: number): string {
  const d = parseYmd(date);
  if (!d) return "";
  const whole = Math.floor(months);
  const y = d.getUTCFullYear();
  const m = d.getUTCMonth() + whole;
  const last = new Date(Date.UTC(y, m + 1, 0)).getUTCDate();
  const out = ymd(new Date(Date.UTC(y, m, Math.min(d.getUTCDate(), last))));
  const rest = Math.round((months - whole) * 30);
  return rest ? addDays(out, rest) : out;
}

/** n pracovních dní po datu (datum samo se nepočítá); 0 = datum, je-li pracovní, jinak nejbližší další. */
export function addWorkingDays(date: string, n: number): string {
  if (!parseYmd(date)) return "";
  let cur = date;
  if (n <= 0) {
    while (!isWorkingDay(cur)) cur = addDays(cur, 1);
    return cur;
  }
  let left = Math.round(n);
  while (left > 0) {
    cur = addDays(cur, 1);
    if (isWorkingDay(cur)) left--;
  }
  return cur;
}

/** Termín = datum + lhůta (pracovní dny přes víkendy a svátky, kalendářní dny / měsíce prostě). */
export function addLeadTime(fromDate: string, lead: Pick<LeadTime, "days" | "unit" | "months">): string {
  if (!parseYmd(fromDate)) return "";
  if (lead.months && lead.months > 0) return addMonths(fromDate, lead.months);
  return lead.unit === "pracovni" ? addWorkingDays(fromDate, lead.days) : addDays(fromDate, Math.round(lead.days));
}

/** Dnešek v Praze (RRRR-MM-DD). */
export function pragueToday(now: Date = new Date()): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Prague", year: "numeric", month: "2-digit", day: "2-digit" }).format(now);
}

/**
 * Je termín objednávky reálný? Neprázdný, platné datum, PO datu objednávky (stejný den = nereálné —
 * to je jen datum vystavení), ne v minulosti vůči dnešku (Praha) a rozumný (méně než 3 roky dopředu).
 */
export function isRealisticDueDate(due: string | null | undefined, orderDate?: string | null, today: string = pragueToday()): boolean {
  const d = parseYmd(due);
  if (!d) return false;
  const o = parseYmd(orderDate);
  if (o && d.getTime() <= o.getTime()) return false;
  const t = parseYmd(today);
  if (t && d.getTime() < t.getTime()) return false;
  const base = t ?? o;
  if (base && d.getTime() >= parseYmd(addMonths(ymd(base), 36))!.getTime()) return false;
  return true;
}

// ── Popisky ─────────────────────────────────────────────────
/** „20. 11. 2026" */
export function czDate(date: string): string {
  const d = parseYmd(date);
  return d ? `${d.getUTCDate()}. ${d.getUTCMonth() + 1}. ${d.getUTCFullYear()}` : date;
}

function plural(n: number, one: string, few: string, many: string): string {
  return n === 1 ? one : n >= 2 && n <= 4 ? few : many;
}

/** „4 týdny", „6–8 týdnů", „30 pracovních dnů", „3 měsíce", „ihned (do 3 prac. dnů)". */
export function leadAmountText(lead: LeadTime): string {
  if (lead.range && lead.range[0] === 0 && lead.unit === "pracovni" && lead.days <= 3) return "ihned (do 3 pracovních dnů)";
  const fmt = (n: number) => String(Math.round(n * 10) / 10).replace(".", ",");
  if (lead.months) {
    const lo = lead.range ? lead.range[0] / 30 : null;
    return `${lo !== null ? `${fmt(lo)}–` : ""}${fmt(lead.months)} ${plural(lead.months, "měsíc", "měsíce", "měsíců")}`;
  }
  if (lead.unit === "kalendarni" && lead.days % 7 === 0 && (!lead.range || lead.range.every((x) => x % 7 === 0))) {
    const w = lead.days / 7;
    const lo = lead.range ? lead.range[0] / 7 : null;
    return `${lo !== null ? `${lo}–` : ""}${w} ${lo !== null ? "týdnů" : plural(w, "týden", "týdny", "týdnů")}`;
  }
  const lo = lead.range ? lead.range[0] : null;
  const n = lead.days;
  if (lead.unit === "pracovni") return `${lo !== null ? `${lo}–` : ""}${n} ${lo !== null ? "pracovních dnů" : plural(n, "pracovní den", "pracovní dny", "pracovních dnů")}`;
  return `${lo !== null ? `${lo}–` : ""}${n} ${lo !== null ? "dnů" : plural(n, "den", "dny", "dnů")}`;
}

const FROM_TEXT: Record<Exclude<LeadFrom, null>, string> = {
  objednavka: "od objednání", potvrzeni: "od potvrzení objednávky", podklady: "od dodání podkladů",
};

/** „4 týdny od objednání" */
export function leadText(lead: LeadTime): string {
  return `${leadAmountText(lead)} ${FROM_TEXT[lead.from ?? "objednavka"]}`;
}
