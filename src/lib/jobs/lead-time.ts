/**
 * Dodací lhůta z textu nabídky / dodacích podmínek (čistá logika, sdílí server i klient).
 * UZAVŘENÁ GRAMATIKA (rozhodnutí po třech kolech ověřování: otevřené hledání vzorů v textu nekonverguje).
 * Text se rozdělí na klauzule (. ; – nový řádek, závorky, čárka mimo desetinné číslo) a lhůta se vezme jen
 * z klauzule, která CELÁ odpovídá gramatice:
 *   KLAUZULE := [ÚVOD] KOTVA [ODDĚLOVAČ] [CCA] DOBA [OD] KONEC
 *   KOTVA    := dodací lhůta | lhůta dodání | termín dodání | dodání | dodáme | expedice | expedujeme |
 *               výroba a dodání | Lieferzeit | Liefertermin | Lieferfrist | Lieferung | delivery (time) | lead time |
 *               shipment | ship
 *   DOBA     := N | N–M (horní mez) + jednotka (dny / pracovní dny / týdny / měsíce, DE, EN, zkratky Wo., měs.);
 *               jednotné číslo („týden", „v 48 týdnu", „Woche", „week") jen u 1; víc než 26 týdnů / 6 měsíců = nic
 *   OD       := od (obdržení|přijetí)? (závazné|písemné)? objednávky | od objednání | od potvrzení … | od dodání
 *               výkresů / podkladů … | nach Auftragseingang … | after PO … | ARO
 * Okamžitá dodávka: KOTVA [ODDĚLOVAČ] ihned / skladem / ab Lager / from stock … → 0–3 pracovní dny.
 * Holá doba („4 týdny od objednávky") jen v dodacím poli, a to jen když je to CELÉ pole (bez dodací
 * parity EXW / DAP … + místa a štítku „Dodací podmínky:"). Uzavřené pravidlo pro klauzuli HNED ZA lhůtou:
 * závorka = nic („4 týdny (po zaplacení zálohy)", „2 týdny (vzorky), 6 týdnů (série)"); v téže větě (čárka,
 * pomlčka, středník) začíná-li podmínkou / rozsahem / posunem začátku / alternativou (resp., nebo, po, od, ab,
 * after, from, upon, pro, u, jinak, sonst, otherwise, whichever…) = nic; na dalším řádku / za tečkou jen posun
 * začátku / alternativa (od, po, ab, after, resp., jinak…) = nic. Cokoli jiného = null (žádné náhradní heuristiky).
 * Špatný termín je horší než žádný: termín odvozený z TEXTU se navíc vždy ukáže ke kontrole (order-deadline).
 * addLeadTime: pracovní dny bez víkendů a českých státních svátků (Velikonoce vlastním výpočtem),
 * kalendářní dny / měsíce prostým přičtením. isRealisticDueDate: termín v budoucnosti, po datu objednávky.
 */
import type { ExtractedLeadTime } from "@/lib/jobs/capture-types";

export type LeadUnit = "kalendarni" | "pracovni";
export type LeadFrom = "objednavka" | "potvrzeni" | "podklady" | null;
/** Odkud lhůta je: quotes.lead_time_days (náš systém), strukturované pole AI, text (gramatika). */
export type LeadSource = "system" | "ai" | "text";

export interface LeadTime {
  /** Počet dní (u rozpětí horní mez; u měsíců orientačně měsíce × 30). */
  days: number;
  unit: LeadUnit;
  /** Od čeho se lhůta počítá (null = neuvedeno → od objednání). */
  from: LeadFrom;
  /** Zdrojový text (gramatická klauzule / text pole AI / „28 dní"). */
  text: string;
  /** Rozpětí ve dnech [od, do] („6–8 týdnů", „ihned" = 0–3 prac. dny). */
  range?: [number, number];
  /** Lhůta v kalendářních měsících (přičítá se po měsících). */
  months?: number;
  /** Odkud lhůta je (parseLeadTime = "text"). */
  source?: LeadSource;
  /** Termín z této lhůty musí zkontrolovat člověk (z textu / AI nesedí s textem) — nikdy plná automatika. */
  review?: boolean;
  /** Jen u pole AI: text pole nechybí a gramatika z něj čte stejnou hodnotu („agrees"), jinou / žádnou („conflict"), text chybí („none"). */
  evidence?: "agrees" | "conflict" | "none";
}

// ── Normalizace ─────────────────────────────────────────────
const MARKS = /[̀-ͯ]/g;

/** Bez diakritiky, malými písmeny, ZNAK PO ZNAKU (délka zachována — indexy sedí na původní text). */
function fold(s: string): string {
  let out = "";
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    const f = c.normalize("NFD").replace(MARKS, "").toLowerCase();
    if (f.length === 1) out += f;
    else {
      const l = c.toLowerCase();
      out += l.length === 1 ? l : c;
    }
  }
  return out;
}

function normalizeText(text: string | null | undefined): string {
  return (text ?? "").normalize("NFC").replace(/[^\S\n]+/g, " ").replace(/ ?\n\s*/g, "\n").trim();
}

// ── Gramatika (nad textem bez diakritiky, malými písmeny) ───
const R = "(?![a-z0-9])";
const WORD_NUMBERS: Record<string, number> = {
  jeden: 1, jedna: 1, jednoho: 1, jednu: 1, dva: 2, dve: 2, dvou: 2, tri: 3, trech: 3, ctyri: 4, ctyr: 4, pet: 5, peti: 5, sest: 6, sesti: 6,
  sedm: 7, sedmi: 7, osm: 8, osmi: 8, devet: 9, deviti: 9, deset: 10, deseti: 10, dvanact: 12, dvanacti: 12,
  ein: 1, eine: 1, einen: 1, einer: 1, zwei: 2, drei: 3, vier: 4, funf: 5, fuenf: 5, sechs: 6, sieben: 7, acht: 8, neun: 9, zehn: 10, zwolf: 12, zwoelf: 12,
  one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10, twelve: 12,
};
const NUM = String.raw`(?:\d{1,3}(?:[.,]\d{1,2})?(?!\d)|(?:${Object.keys(WORD_NUMBERS).sort((a, b) => b.length - a.length).join("|")})${R})`;
const UNIT = [
  String.raw`pracovni(?:ch|m)?\s+(?:dny|dni|dnu|den|dne|dnech)`, String.raw`prac\.\s*(?:dny|dni|dnu|den)`,
  String.raw`arbeitstag(?:e|en)?`, String.raw`werktag(?:e|en)?`, String.raw`(?:working|business|work)\s+days?`,
  String.raw`kalendarni(?:ch|m)?\s+(?:dny|dni|dnu|den|dnech)`,
  String.raw`tyd(?:en|ny|nu|ne|nech)`, String.raw`tyd\.`, String.raw`wochen?`, String.raw`wo\.?`, String.raw`weeks?`, String.raw`wks?\.?`,
  String.raw`mesic(?:e|u|i|ich)?`, String.raw`mes\.`, String.raw`monat(?:e|en)?`, String.raw`mon\.`, String.raw`months?`,
  String.raw`dny|dni|dnu|den|dne|dnech`, String.raw`tag(?:e|en)?`, String.raw`days?`,
].join("|");

const sticky = (src: string) => new RegExp(src, "y");
const WS = sticky(String.raw`\s*`);
/** Úvodní přívlastek kotvy („naše / standardní / předpokládaná dodací lhůta", „unsere Lieferzeit", „the lead time"). */
const LEAD_IN = sticky(String.raw`\s*(?:nase|nasi|standardni|obvykla|obvykly|obvykle|bezna|predpokladana|predpokladany|predpokladane|aktualni|orientacni|celkova|unsere|die|der|voraussichtliche|aktuelle|ubliche|uebliche|normale|our|the|estimated|standard|current|typical|expected)\s+`);
const ANCHOR_SRC = String.raw`(?:vyroba\s+a\s+dodani|dodaci\s+lhut(?:a|y|e|u|ou)|dodaci\s+dob(?:a|y|e|u|ou)|dodaci\s+termin(?:u|em|y)?|lhut(?:a|y|e|u|ou)\s+dodani|lhut(?:a|y|e|u|ou)\s+dodavk(?:y|ou)|termin(?:u|em)?\s+dodani|termin(?:u|em)?\s+dodavk(?:y|ou)|dodani|dodavk(?:a|y|ou)|dodame|expedice|expedujeme|lieferzeit(?:en)?|liefertermin(?:e)?|lieferfrist(?:en)?|lieferung(?:en)?|delivery\s+lead[\s-]?times?|delivery\s+time|delivery|lead[\s-]?times?|shipment|ships?)`;
const ANCHOR = sticky(String.raw`\s*${ANCHOR_SRC}${R}`);
const ANCHOR_ANY = new RegExp(String.raw`(?<![a-z0-9])${ANCHOR_SRC}${R}`);
/** Odrážka seznamu na začátku řádku („- Dodací lhůta…", „• …", „1) …", „2. …"). */
const BULLET = sticky(String.raw`\s*(?:[-–—•*·▪●]|\d{1,2}[.)])\s+(?=[a-z])`);
/**
 * Klauzule, která začíná jinou obchodní podmínkou (platnost, splatnost, záruka, skonto, záloha, reklamace,
 * uskladnění…) — její doba („Platnost nabídky 30 dní") není další dodací lhůta.
 */
const OTHER_LABEL = new RegExp(String.raw`^\s*(?:(?:[-–—•*·▪●]|\d{1,2}[.)])\s+)?(?:(?:cenov[aea]\s+)?nabid(?:ka|ky|ce)\s+(?:plati|je\s+platn|je\s+zavazn|platn)|ceny\s+plat|platnost|plati${R}|platn[aeyi]${R}|splatnost|platb[ayu]|platebni|uhrad|zaruk|zarucni|garanc|garantie|reklamac|skont|zaloh|uskladn|skladovan|validity|valid${R}|offer\s+(?:is\s+)?valid|quotation\s+(?:is\s+)?valid|prices?\s+(?:are\s+)?valid|payment|warranty|guarantee|storage|angebot\s+(?:gilt|ist\s+gultig|gultig)|gultig|preise\s+gelten|zahlung|gewahrleistung|lagerung|bindefrist)`);
const SEP_PUNCT = sticky(String.raw`\s*[:=\-–—]`);
const VERB = sticky(String.raw`\s*(?:je|cini|betragt|ist|is|are)${R}`);
const PREP = sticky(String.raw`\s*(?:innerhalb(?:\s+von)?|within|binnen|behem|do|za|ve|v|in)${R}`);
const APPROX = sticky(String.raw`\s*(?:cca\.?|ca\.?|circa|zirka|ungefahr|etwa|approx\.?|approximately|about|max\.?|maximalne|nejpozdeji|spatestens)(?![a-z0-9])`);
const IMMEDIATE = sticky(String.raw`\s*(?:ihned|okamzite|skladem|ze\s+skladu|sofort|ab\s+lager|from\s+stock|ex\s+stock|immediately)${R}`);
const DURATION = sticky(String.raw`\s*(${NUM})(?:\s*(?:-|–|—|az|bis|to)\s*(${NUM}))?\s*(${UNIT})(?![a-z0-9])`);
const END = sticky(String.raw`[\s.!]*$`);
/**
 * Jednotné číslo jednotky („týden", „v 48 týdnu", „Woche", „week", „den", „Tag", „měsíc", „Monat") je doba jen
 * u 1 (nebo desetinného čísla: „1,5 týdne") — „48 týden" / „48 Woche" je kalendářní týden bez tečky.
 */
const SINGULAR_UNIT = /^(?:(?:pracovni|kalendarni)m?\s+(?:den|dne)|prac\.\s*den|arbeitstag|werktag|(?:working|business|work)\s+day|tyden|tydnu|tydne|woche|week|mesic|mesici|monat|month|den|dne|tag|day)$/;
/** Strop lhůty z textu: víc než 26 týdnů / 6 měsíců = spíš něco jiného (kalendářní týden, rok…) → nic. */
const TEXT_MAX_DAYS = 182;

/** OD — od čeho lhůta běží (jen objednávka, potvrzení objednávky, podklady / výkresy). */
const FROM_RULES: [string, Exclude<LeadFrom, null>][] = [
  [String.raw`(?:od|po)\s+potvrzeni(?:\s+(?:vasi\s+)?objednavky)?`, "potvrzeni"],
  [String.raw`(?:nach|ab)\s+(?:(?:erhalt|eingang)\s+der\s+)?(?:auftragsbestatigung|auftragsbestaetigung|bestellbestatigung|bestellbestaetigung)`, "potvrzeni"],
  [String.raw`(?:after|from)\s+(?:receipt\s+of\s+)?(?:the\s+|your\s+)?order\s+confirmation`, "potvrzeni"],
  [String.raw`(?:od|po)\s+(?:obdrzeni|dodani|schvaleni|prijeti|doruceni)\s+(?:(?:kompletnich|kompletni|technicke|vykresove)\s+)?(?:vykresu|podkladu|dokumentace|dat)`, "podklady"],
  [String.raw`nach\s+(?:freigabe|erhalt)\s+der\s+(?:zeichnungen|unterlagen)`, "podklady"],
  [String.raw`after\s+(?:(?:receipt|approval)\s+of\s+)?(?:the\s+)?drawings`, "podklady"],
  [String.raw`od\s+(?:data\s+)?(?:(?:obdrzeni|prijeti|doruceni)\s+)?(?:(?:zavazne|pisemne)\s+)?(?:vasi\s+)?objednavky`, "objednavka"],
  [String.raw`od\s+objednani`, "objednavka"],
  [String.raw`po\s+(?:obdrzeni|prijeti|doruceni)\s+(?:(?:zavazne|pisemne)\s+)?(?:vasi\s+)?objednavky`, "objednavka"],
  [String.raw`(?:nach|ab)\s+(?:(?:erhalt|eingang)\s+(?:der|ihrer)\s+)?bestellung`, "objednavka"],
  [String.raw`(?:nach|ab)\s+(?:auftragseingang|auftragserteilung|bestelleingang)`, "objednavka"],
  [String.raw`(?:after|from)\s+(?:receipt\s+of\s+)?(?:the\s+|your\s+)?(?:purchase\s+order|po|order)`, "objednavka"],
  [String.raw`aro`, "objednavka"],
];
const FROM_STICKY = FROM_RULES.map(([src, from]) => [sticky(String.raw`\s+${src}${R}`), from] as const);
/** Všechny gramatické „OD" v textu (pro záporný filtr textu AI: „od potvrzení objednávky" není „potvrdíme"). */
const FROM_ANY = new RegExp(String.raw`(?<![a-z0-9])(?:${FROM_RULES.map(([s]) => s).join("|")})${R}`, "g");

/**
 * Následující klauzule, která podmiňuje / mění lhůtu („resp. od uhrazení zálohy", „nejdříve však po…",
 * „whichever is later", „subject to…", „(+/- 1 týden)") → celá lhůta neplatí.
 */
const QUALIFIER = /^\s*(?:[+±]|(?:resp\.?|respektive|nebo|popr\.?|popripade|pripadne|ale|avsak|vsak|nejdrive|pokud|jestlize|pod\s+podminkou|za\s+predpokladu|s\s+vyhradou|v\s+zavislosti|dle|podle|or|oder|bzw\.?|beziehungsweise|jedoch|sofern|falls|fruhestens|fruehestens|vorbehaltlich|unter\s+vorbehalt|vorausgesetzt|abhangig|je\s+nach|nach|whichever|but|however|unless|if|provided|subject\s+to|depending|according)(?![a-z0-9]))/;
/**
 * Klauzule hned za lhůtou (i na dalším řádku / za tečkou), která posouvá začátek nebo je alternativa
 * („od obdržení zálohy", „po zaplacení", „ab Zahlungseingang", „after receipt of…", „jinak 4 týdny") → nic.
 * „Ab Werk" je dodací parita, ne začátek lhůty.
 */
const NEXT_START = /^\s*(?:[+±]|(?:resp\.?|respektive|nebo|popr\.?|popripade|pripadne|nejdrive|or|oder|bzw\.?|beziehungsweise|fruhestens|fruehestens|whichever|od|ab(?!\s+werk)|from|po|after|upon|following|nach|jinak|sonst|otherwise|ansonsten|else|vorbehaltlich|subject\s+to|s\s+vyhradou|pod\s+podminkou|za\s+predpokladu)(?![a-z0-9]))/;
/** Předchozí klauzule téže věty (za čárkou / pomlčkou), která omezuje platnost („Po zaplacení zálohy, dodání 4 týdny", „Pro vzorky, …"). */
const SCOPE_BEFORE = /^\s*(?:po|pri|u|pro|v\s+pripade|pokud|jestlize|after|upon|following|for|if|in\s+case|unless|nach|bei|fur|falls|sofern|im\s+falle)(?![a-z0-9])/;

const INCOTERM = String.raw`(?:incoterms?(?:\s*20\d\d)?\s*:?\s*)?(?:exw|fca|fas|fob|cfr|cif|cpt|cip|dap|dpu|ddp|dat|ddu)${R}`;
const FIELD_LABEL = /^\s*(?:dodaci\s+podminky|lieferbedingungen|delivery\s+terms|terms\s+of\s+delivery)\s*:\s*/;
const INCO_HEAD = new RegExp(String.raw`^\s*${INCOTERM}[^,;\n]*[,;]\s*`);
const INCO_TAIL = new RegExp(String.raw`\s*[,;]\s*${INCOTERM}[^,;\n]*$`);

/** Kurzor: s = text bez diakritiky (malými), raw = původní text se stejnými indexy. */
interface Cur { s: string; i: number; raw: string }
function eat(c: Cur, re: RegExp): RegExpExecArray | null {
  re.lastIndex = c.i;
  const m = re.exec(c.s);
  if (m) c.i = re.lastIndex;
  return m;
}

function num(s: string | undefined): number | null {
  if (!s) return null;
  const w = WORD_NUMBERS[s];
  if (w !== undefined) return w;
  const n = Number(s.replace(",", "."));
  return Number.isFinite(n) && n >= 0 ? n : null;
}

type UnitKind = "pracovni" | "den" | "tyden" | "mesic";
function unitKind(u: string): UnitKind {
  if (/^(pracovni|prac\.|arbeitstag|werktag|working|business|work\s)/.test(u)) return "pracovni";
  if (/^(tyd|woch|wo|week|wk)/.test(u)) return "tyden";
  if (/^(mesic|mes\.|monat|mon\.|month)/.test(u)) return "mesic";
  return "den";
}

/** „tydnu" bez diakritiky je i „týdnů" (2. pád mn. č.) — jednotné „týdnu" jen s „ý" a bez kroužku. */
function isSingularUnit(folded: string, raw: string): boolean {
  const u = folded.replace(/\s+/g, " ");
  if (!SINGULAR_UNIT.test(u)) return false;
  return u !== "tydnu" || raw.toLowerCase() === "týdnu";
}

type Parsed = Omit<LeadTime, "text" | "source" | "review" | "evidence">;

/** [VERB] [CCA] [PŘEDLOŽKA] [CCA] — „je cca", „do cca", „cca do", „beträgt ca.", „innerhalb von". */
function modifiers(c: Cur): void {
  eat(c, VERB);
  eat(c, APPROX);
  if (eat(c, PREP)) eat(c, APPROX);
}

/** DOBA [OD] KONEC od kurzoru. */
function durationTail(c: Cur): Parsed | null {
  const m = eat(c, DURATION);
  if (!m) return null;
  const a = num(m[1]);
  const b = num(m[2]);
  if (a === null || (m[2] !== undefined && b === null)) return null;
  const lo = b !== null ? Math.min(a, b) : a;
  const hi = b !== null ? Math.max(a, b) : a;
  if (!(hi > 0)) return null;
  if (isSingularUnit(m[3], c.raw.slice(c.i - m[3].length, c.i)) && hi !== 1 && Number.isInteger(hi)) return null;
  let from: LeadFrom = null;
  for (const [re, f] of FROM_STICKY) {
    if (eat(c, re)) {
      from = f;
      break;
    }
  }
  if (!eat(c, END)) return null;
  const kind = unitKind(m[3]);
  const mult = kind === "tyden" ? 7 : kind === "mesic" ? 30 : 1;
  const lead: Parsed = { days: Math.round(hi * mult), unit: kind === "pracovni" ? "pracovni" : "kalendarni", from };
  if (b !== null && lo !== hi) lead.range = [Math.round(lo * mult), Math.round(hi * mult)];
  if (kind === "mesic") lead.months = hi;
  if (lead.days > TEXT_MAX_DAYS) return null;
  return lead;
}

/** KLAUZULE := [ÚVOD] KOTVA [ODDĚLOVAČ] [CCA] DOBA [OD] KONEC | KOTVA [ODDĚLOVAČ] IHNED KONEC. */
function anchoredClause(f: string, raw: string): Parsed | null {
  const c: Cur = { s: f, i: 0, raw };
  eat(c, WS);
  eat(c, BULLET);
  for (let k = 0; k < 2 && eat(c, LEAD_IN); k++);
  if (!eat(c, ANCHOR)) return null;
  eat(c, SEP_PUNCT);
  const after = c.i;
  eat(c, VERB);
  if (eat(c, IMMEDIATE) && eat(c, END)) return { days: 3, unit: "pracovni", from: null, range: [0, 3] };
  c.i = after;
  modifiers(c);
  return durationTail(c);
}

/** Holá doba v dodacím poli: [CCA] [PŘEDLOŽKA] DOBA [OD] — celé pole. */
function bareField(f: string, raw: string): Parsed | null {
  const c: Cur = { s: f, i: 0, raw };
  eat(c, WS);
  eat(c, APPROX);
  if (eat(c, PREP)) eat(c, APPROX);
  return durationTail(c);
}

/** Čím klauzule končí: čárka / pomlčka / středník („soft"), otevírací závorka, zavírací závorka, tečka / nový řádek („hard"), konec textu. */
type Boundary = "soft" | "open" | "close" | "hard" | "end";

/** Kdekoli v textu doba (číslo / číslovka + jednotka). */
const DURATION_ANY = new RegExp(String.raw`(?<![a-z0-9])${NUM}\s*(?:${UNIT})${R}`);

const IMMEDIATE_ANY = new RegExp(String.raw`(?<![a-z0-9])(?:ihned|okamzite|skladem|ze\s+skladu|sofort|ab\s+lager|from\s+stock|ex\s+stock|immediately)${R}`);
const NUM_START = new RegExp(String.raw`^\s*${NUM}`);

/** Klauzule je CELÁ jen gramatické OD („ab Auftragseingang", „od obdržení objednávky") → od čeho, jinak null. */
function fromOnly(f: string): LeadFrom {
  const c: Cur = { s: ` ${f}`, i: 0, raw: ` ${f}` };
  for (const [re, from] of FROM_STICKY) {
    c.i = 0;
    if (eat(c, re) && eat(c, END)) return from;
  }
  return null;
}

interface Span {
  start: number;
  end: number;
  /** Klauzule navazuje na předchozí v téže větě (oddělena čárkou / pomlčkou / středníkem). */
  soft: boolean;
  /** Čím klauzule končí. */
  after: Boundary;
}

/** Klauzule: . (konec věty), ; ! ? nový řádek, závorky, čárka (ne desetinná), pomlčka mezi mezerami (ne rozpětí, ne za kotvou). */
function clausesOf(raw: string, f: string): Span[] {
  const out: Span[] = [];
  let start = 0;
  let soft = false;
  const cut = (at: number, kind: Boundary) => {
    const last = out[out.length - 1];
    if (f.slice(start, at).trim()) out.push({ start, end: at, soft, after: kind });
    else if (last && last.after === "close" && kind !== "close") last.after = kind; // „(vzorky), 6 týdnů" — čárka za závorkou
    start = at + 1;
    soft = kind === "soft";
  };
  for (let i = 0; i < f.length; i++) {
    const ch = f[i];
    if (ch === "(" || ch === "[") cut(i, "open");
    else if (ch === ")" || ch === "]") cut(i, "close");
    else if (ch === ";") cut(i, "soft");
    else if ("\n!?".includes(ch)) cut(i, "hard");
    else if (ch === "." && (i + 1 >= f.length || /^\s+(?:\p{Lu}|\n)/u.test(raw.slice(i + 1, i + 3)))) cut(i, "hard");
    else if (ch === "," && !(/\d/.test(f[i - 1] ?? "") && /\d/.test(f[i + 1] ?? ""))) cut(i, "soft");
    else if ((ch === "–" || ch === "—" || ch === "-") && f[i - 1] === " " && f[i + 1] === " ") {
      const left = f.slice(start, i);
      const range = /\d\s*$/.test(left) && /^\s*\d/.test(f.slice(i + 1));
      const c: Cur = { s: left, i: 0, raw: left };
      eat(c, WS);
      for (let k = 0; k < 2 && eat(c, LEAD_IN); k++);
      const afterAnchor = Boolean(eat(c, ANCHOR)) && !left.slice(c.i).trim();
      if (!range && !afterAnchor) cut(i, "soft");
    }
  }
  if (f.slice(start).trim()) out.push({ start, end: f.length, soft, after: "end" });
  return out;
}

const done = (p: Parsed, text: string): LeadTime => ({ ...p, text: text.trim(), source: "text" });

/**
 * Režim čtení: „delivery-field" = text, o kterém víme, že je o dodání (deliveryTerms, quotes.delivery_terms,
 * text pole AI) — navíc dovolí holou dobu, je-li to celé pole; „free-text" = poznámka, popis položky, shrnutí.
 */
export type LeadParseMode = "delivery-field" | "free-text";

/**
 * Dodací lhůta z textu (česky, německy, anglicky) podle uzavřené gramatiky, jinak null. Rozpětí → horní mez
 * (range zachová obě). Bez slova „pracovní" = kalendářní dny. Dvě gramatické klauzule s různou lhůtou = null.
 */
export function parseLeadTime(text: string | null | undefined, opts: { mode?: LeadParseMode } = {}): LeadTime | null {
  const mode = opts.mode ?? "delivery-field";
  const raw = normalizeText(text);
  if (!raw) return null;
  const f = fold(raw);
  if (mode === "delivery-field") {
    let s = 0;
    let e = f.length;
    const label = FIELD_LABEL.exec(f);
    if (label) s += label[0].length;
    const head = INCO_HEAD.exec(f.slice(s));
    if (head) s += head[0].length;
    const tail = INCO_TAIL.exec(f.slice(s));
    if (tail) e = s + tail.index;
    const bare = s < e ? bareField(f.slice(s, e), raw.slice(s, e)) : null;
    if (bare) return done(bare, raw.slice(s, e));
  }
  const clauses = clausesOf(raw, f);
  let found: LeadTime | null = null;
  /** Klauzule, které tvoří přečtenou lhůtu (kotva + doba, případně OD na další klauzuli). */
  const used = new Set<number>();
  for (let k = 0; k < clauses.length; k++) {
    const c = clauses[k];
    const p = anchoredClause(f.slice(c.start, c.end), raw.slice(c.start, c.end));
    if (!p) continue;
    used.add(k);
    // hned za lhůtou závorka („4 týdny (po zaplacení zálohy)", „2 týdny (vzorky), 6 týdnů (série)", „1 týden (expres)") → nic
    if (c.after === "open") return null;
    const next = clauses[k + 1];
    let withNext = false;
    if (next) {
      const nt = f.slice(next.start, next.end);
      const onlyFrom = p.from === null ? fromOnly(nt) : null;
      if (onlyFrom) {
        // „Lieferzeit: 4 Wochen⏎ab Auftragseingang", „Dodací lhůta 4 týdny, od obdržení objednávky" = OD na další klauzuli
        p.from = onlyFrom;
        withNext = true;
        used.add(k + 1);
      } else if (c.after === "soft" || c.after === "close") {
        // v téže větě (čárka / pomlčka / středník): podmínka, rozsah i posun začátku („…, resp. od zálohy",
        // „…, po obdržení zálohy", „…, ab Zahlungseingang", „…, jinak 4 týdny", „…; pro sérii 6 týdnů") → nic
        // … i další doba („4 týdny – 6 týdnů" = rozpětí s jednotkou dvakrát, „2 týdny, 6 týdnů (série)")
        if (QUALIFIER.test(nt) || SCOPE_BEFORE.test(nt) || NEXT_START.test(nt) || NUM_START.test(nt)) return null;
        withNext = c.after === "soft";
      } else if (NEXT_START.test(nt)) {
        return null; // další řádek / věta „od obdržení zálohy", „resp. …"
      } else if ((QUALIFIER.test(nt) || SCOPE_BEFORE.test(nt)) && DURATION_ANY.test(nt)) {
        return null; // další řádek s vlastní dobou pro jiný rozsah: „U zakázek nad 1000 ks 6 týdnů"
      }
    }
    // „Po zaplacení zálohy, dodání 4 týdny", „Pro vzorky, dodací lhůta 2 týdny", „Pro vzorky:⏎Dodací lhůta…" → nic
    const prev = clauses[k - 1];
    if (prev) {
      const pt = f.slice(prev.start, prev.end);
      if ((c.soft || /:\s*$/.test(pt)) && SCOPE_BEFORE.test(pt)) return null;
    }
    if (found) {
      if (found.days !== p.days || found.unit !== p.unit) return null;
      continue;
    }
    // text pro kontrolu: klauzule + navazující klauzule téže věty („Dodací lhůta 4 týdny, balení v ceně")
    found = done(p, raw.slice(c.start, next && withNext ? next.end : c.end));
  }
  if (!found) return null;
  // Uzavřené pravidlo: jiná klauzule téhož textu s vlastní dobou, která není jinou obchodní podmínkou
  // („…, série 6 týdnů", „Výroba 4 týdny, expedice 2 dny", „kalené díly 6 týdnů", „položka 2 – 8 týdnů") =
  // lhůta není jednoznačná → nic (člověk doplní). „Platnost nabídky 30 dní, dodací lhůta 4 týdny" platí dál.
  for (let k = 0; k < clauses.length; k++) {
    if (used.has(k)) continue;
    const t = f.slice(clauses[k].start, clauses[k].end);
    if ((DURATION_ANY.test(t) || IMMEDIATE_ANY.test(t)) && !OTHER_LABEL.test(t)) return null;
  }
  return found;
}

/**
 * Text vůbec mluví o lhůtě (číslo, dodací kotva, číslovka)? „EXW Vimperk" ne — takový dodací text nevyžaduje,
 * aby ho gramatika přečetla stejně jako pole AI.
 */
export function hasLeadCue(text: string | null | undefined): boolean {
  const f = fold(normalizeText(text));
  return /\d/.test(f) || ANCHOR_ANY.test(f) || DURATION_ANY.test(f);
}

/**
 * Volný text (poznámka, shrnutí, popis položky) mluví o dodací lhůtě: dodací kotva i doba v něm („…, dodací
 * lhůta 4 týdny po obdržení zálohy"). Užší než hasLeadCue — „zkouška 5 dnů" ani „120 ks" ne.
 */
export function mentionsLead(text: string | null | undefined): boolean {
  const f = fold(normalizeText(text));
  return ANCHOR_ANY.test(f) && (DURATION_ANY.test(f) || IMMEDIATE_ANY.test(f));
}

// ── Strukturované pole AI ───────────────────────────────────
/**
 * Dodací lhůta nabídky je, ale nedá se použít (AI: běží od něčeho jiného, nebo její text je jiná podmínka) —
 * u TÉŽE nabídky se pak nečtou ani dodací podmínky, poznámka a shrnutí („doplň termín").
 */
export interface LeadBlocked {
  blocked: true;
  text: string;
}

export function isLeadBlocked(x: unknown): x is LeadBlocked {
  return typeof x === "object" && x !== null && (x as { blocked?: unknown }).blocked === true;
}

/**
 * ZÁPORNÝ filtr — jen pro text strukturovaného pole AI (gramatika žádné záporné seznamy nemá): potvrzení
 * termínu, platnost, splatnost / platba, záruka, záloha, uskladnění, avízo, „před / předem", frekvence,
 * zahájení, vzorky, prodloužení. Gramatická „OD" („od potvrzení objednávky", „nach Auftragsbestätigung")
 * se předem vyjmou.
 */
const NEGATIVE = new RegExp([
  "potvr[dz]", "confirm", "bestatig", "bestaetig",
  "platn", String.raw`(?<![a-z])plati(?![a-z])`, "platb", "plateb", String.raw`(?<![a-z])valid`, "gultig", "gueltig", "bindefrist",
  "splatn", "payment", String.raw`(?<![a-z])pay(?![a-z])`, "zahlung", String.raw`(?<![a-z])netto(?![a-z])`, "skont", "zaplac", "uhrad", "uhraz",
  "zaruk", "zaruc", "garant", "guarant", "warrant", "gewahrleist", "gewaehrleist",
  "zaloh", String.raw`(?<![a-z])advance`, "anzahlung", "vorauszahl", "deposit",
  "uskladn", "storage", "lagerung", String.raw`(?<![a-z])aviz`, String.raw`(?<![a-z])avis`, "notif",
  String.raw`(?<![a-z])pred(?:em)?(?![a-z])`, String.raw`(?<![a-z])vor(?![a-z])`, String.raw`(?<![a-z])prior(?![a-z])`,
  "kazd", String.raw`(?<![a-z])alle(?![a-z])`, String.raw`(?<![a-z])every(?![a-z])`, String.raw`(?<![a-z])jednou(?![a-z])`,
  "rhythmus", String.raw`(?<![a-z])takt`, "cycle", "interval",
  "zahajeni", String.raw`(?<![a-z])start`, "beginn", "vzor(?:k|ek)", "muster", "sample", "prodluz", "verlang", "extend",
].join("|"));

/** Text pole AI je jiná podmínka než dodací lhůta (záporný filtr). */
export function rejectsLeadText(text: string): boolean {
  const f = fold(normalizeText(text)).replace(FROM_ANY, " ");
  return NEGATIVE.test(f);
}

const AI_UNIT: Record<string, { mult: number; unit: LeadUnit; months?: boolean }> = {
  dny: { mult: 1, unit: "kalendarni" }, pracovni_dny: { mult: 1, unit: "pracovni" }, tydny: { mult: 7, unit: "kalendarni" }, mesice: { mult: 30, unit: "kalendarni", months: true },
};

/**
 * Strukturovaná dodací lhůta z AI (deliveryLeadTime) → lhůta. „jine" = blok (stop). Text pole, který záporný
 * filtr odmítne, = blok (stop, nečte se ani zbytek nabídky). Přijato: hodnota > 0, známá jednotka a „od"
 * objednávka / potvrzení / podklady — nebo „od" neuvedeno a text, který gramatika přijme. Jinak null (čte se
 * zbytek nabídky). evidence: text pole gramatika čte stejně („agrees"), jinak („conflict"), text chybí („none").
 */
export function leadOfExtracted(x: ExtractedLeadTime | null | undefined): LeadTime | LeadBlocked | null {
  if (!x) return null;
  const text = normalizeText(x.text).replace(/\s+/g, " ");
  if (x.from === "jine") return { blocked: true, text };
  if (text && rejectsLeadText(text)) return { blocked: true, text };
  const parsed = text ? parseLeadTime(text, { mode: "delivery-field" }) : null;
  const v = Number(x.value);
  const u = AI_UNIT[x.unit];
  if (!u || !Number.isFinite(v) || !(v > 0)) return null;
  if (x.from == null && !parsed) return null;
  if (x.from != null && !["objednavka", "potvrzeni", "podklady"].includes(x.from)) return null;
  const days = Math.round(v * u.mult);
  if (days > 3 * 365) return null;
  const agrees = Boolean(parsed && parsed.days === days && parsed.unit === u.unit);
  const lead: LeadTime = {
    days, unit: u.unit, from: (x.from as LeadFrom) ?? parsed?.from ?? null, text: "", source: "ai",
    evidence: !text ? "none" : agrees ? "agrees" : "conflict",
  };
  if (u.months) lead.months = v;
  if (agrees && parsed?.range) lead.range = parsed.range;
  lead.text = text || leadAmountText(lead);
  return lead;
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
