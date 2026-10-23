/**
 * Dodací lhůta z textu nabídky / dodacích podmínek (čistá logika, sdílí server i klient).
 * „4 týdny od objednání", „6–8 týdnů", „30 pracovních dnů", „Lieferzeit 4 Wochen", „4 weeks ARO",
 * „3 měsíce", „ihned / skladem" → počet dní + druh dní + od čeho se počítá. „dle dohody" = nic.
 * ZÁSADA: KLADNÝ seznam a asymetrie rizika — špatný termín je horší než žádný (bez termínu systém ukáže
 * „doplň termín"). Dva režimy: „delivery-field" (text, o kterém víme, že je o dodání — dovolí holou dobu,
 * ne klauzuli o jiné podmínce) a „free-text" (poznámka, popis, shrnutí — číslo jen u výslovného dodacího slova).
 * addLeadTime: pracovní dny bez víkendů a českých státních svátků (Velikonoce vlastním výpočtem),
 * kalendářní dny / měsíce prostým přičtením. isRealisticDueDate: termín v budoucnosti, po datu objednávky.
 */
import type { ExtractedLeadTime } from "@/lib/jobs/capture-types";

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
  sedm: 7, osm: 8, devet: 9, deset: 10, dvanact: 12, peti: 5, sesti: 6, sedmi: 7, osmi: 8, deviti: 9, deseti: 10,
  ein: 1, eine: 1, einen: 1, zwei: 2, drei: 3, vier: 4, funf: 5, fuenf: 5, sechs: 6, sieben: 7, acht: 8, neun: 9, zehn: 10,
  one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10, twelve: 12,
};

const NUM = String.raw`(\d{1,3}(?:[.,]\d)?|${Object.keys(WORD_NUMBERS).sort((a, b) => b.length - a.length).join("|")})`;
/** „6–8", „6 - 8", „6 až 8", „6 bis 8", „6 to 8". */
const RANGE = String.raw`${NUM}(?:\s*(?:-|–|—|az|bis|to|or|nebo|\/)\s*${NUM})?`;

/**
 * Jednotky (bez diakritiky). Pořadí: pracovní dny před dny. Zkratky „Wo.", „měs.", „Mon." i bez tečky
 * (na konci textu tečku odřízne dělení na klauzule).
 */
const UNIT_RE = String.raw`(pracovni(?:ch|m)?\s+(?:dn[iuy]|dnech|den)|prac\.?\s*(?:dn[iuy]|dnu|d\.?)|pd\b|arbeitstag(?:e|en)?|werktag(?:e|en)?|business\s+days?|working\s+days?|work\s+days?|kalendarni(?:ch)?\s+(?:dn[iuy]|dnu|den)|dn[iuy]\b|dnu\b|den\b|dnech\b|tag(?:e|en)?\b|days?\b|d\b|tydn[uyi]?\b|tydnech\b|tyden\b|tyd\.?|tydny\b|wochen?\b|wo\b\.?|weeks?\b|wks?\b|w\b|mesic(?:e|u|i|ich)?\b|mes\b\.?|monat(?:e|en)?\b|months?\b|mon\b\.?|mo\b)`;

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
  if (/^(tyd|woch|wo\.?$|week|wk|w$)/.test(u)) return "tyden";
  if (/^(mesic|mes\.?$|monat|month|mon\.?$|mo$)/.test(u)) return "mesic";
  return "den";
}

/** Od čeho se lhůta počítá — hledá se v okolí nalezené lhůty (za ní, pak celý text). */
function fromOf(text: string): LeadFrom {
  if (/(potvrz|order confirmation|confirmation of order|auftragsbestatigung|bestellbestatigung|\boc\b)/.test(text)) return "potvrzeni";
  if (/(podklad|vykres|dat\b|dokumentac|zeichnung|unterlagen|drawings?|documents?|approval|schvalen|freigabe)/.test(text)) return "podklady";
  if (/(objedn|zakazk|\baro\b|after (?:receipt of )?(?:the |your )?(?:po|purchase order)\b|after receipt of (?:the )?order|receipt of your order|your order|from (?:the )?order|after order|upon order|of order|auftragseingang|auftragserteilung|bestellung|nach auftrag|ab auftrag|order date)/.test(text)) return "objednavka";
  return null;
}

// ── Od čeho lhůta běží — kladný seznam ──────────────────────
/** Předložka za číslem („4 týdny od…", „4 Wochen nach…", „4 weeks after…"), volitelně v závorce. */
const FROM_PREP_WORD = /^\s*\(?\s*(?:od|ode|po|nach|after|ab|from|upon|following)\s+/;
/** Povolená slova mezi předložkou a tím, od čeho lhůta běží („od obdržení závazné objednávky", „after receipt of your PO"). */
const FROM_FILL = String.raw`(?:data|datum|date|dne|dnem|der|dem|des|den|the|a|an|your|our|ihrer|ihres|ihre|ihrem|unserer|vasi|vasich|nasi|obdrzeni|prijeti|doruceni|dodani|zaslani|predani|vystaveni|zadani|schvaleni|odsouhlaseni|uvolneni|erhalt|eingang|zugang|freigabe|receipt|receiving|approval|release|of|zavazne|zavaznou|platne|platnou|pisemne|valid|binding|firm|written|official|verbindlichen|verbindliche|verbindlicher|schriftlichen|schriftliche|gultigen|gueltigen|kompletnich|kompletni|uplnych|finalnich|technickych|schvalenych|complete|final|approved|technical|vollstandigen|vollstaendigen|technischen|freigegebenen)`;
/** Od čeho smí lhůta běžet: objednávka, potvrzení objednávky, podklady / výkresy (nic jiného). */
const FROM_KEY = String.raw`(potvrz\w*|order\s+confirmation|confirmation(?:\s+of\s+(?:the\s+|your\s+)?order)?|auftragsbestatigung\w*|bestellbestatigung\w*|oc\b|objedn\w*|zakazk\w*|purchase\s+order|order(?:\s+(?:date|placement))?\b|po\b|auftrag\w*|bestell\w*|podklad\w*|vykres\w*|dat\b|dokumentac\w*|zeichnung\w*|unterlagen|drawings?\b|documents?\b|documentation)`;
const FROM_HEAD = new RegExp(String.raw`^\s*\(?\s*(?:od|ode|po|nach|after|ab|from|upon|following)\s+(?:${FROM_FILL}\s+){0,4}${FROM_KEY}`);

function keyFrom(k: string): Exclude<LeadFrom, null> {
  if (/^(potvrz|order\s+confirmation|confirmation|auftragsbest|bestellbest|oc$)/.test(k)) return "potvrzeni";
  if (/^(podklad|vykres|dat$|dokumentac|zeichnung|unterlagen|drawing|document)/.test(k)) return "podklady";
  return "objednavka";
}

/**
 * Za číslem stojí předložka („od / po / nach / after…") — od čeho lhůta běží. Kladný seznam: jen objednávka,
 * potvrzení, podklady (+ „ab Werk / ab Lager" = místo, ne začátek → bez „od čeho"). Cokoli jiného (záloha,
 * platba, materiál, dokončení výroby, dodání zboží…) = undefined → lhůtu nebrat.
 */
function fromHead(after: string): LeadFrom | undefined {
  if (/^\s*\(?\s*ab\s+(?:werk|lager)\b/.test(after)) return null;
  const m = FROM_HEAD.exec(after);
  if (!m) return undefined;
  // „od objednávky a uhrazení zálohy", „after PO and receipt of material" → podmínka navíc = nebrat
  const next = after.slice(m[0].length).split(/\s+/).filter(Boolean).slice(0, 4).join(" ");
  if (OTHER_RE.test(next) || /(materi|zbozi|vyrob|fertig|product|manufact|zahl)/.test(next)) return undefined;
  return keyFrom(m[1]);
}

/** Text, který lhůtu neurčuje („dle dohody", „po dohodě", „nach Vereinbarung", „to be agreed"). */
const BY_AGREEMENT = /(dle|podle|po)\s+dohod|k\s+dohodn|nach\s+(vereinbarung|absprache)|to\s+be\s+agreed|by\s+agreement|tba\b|tbd\b|upon\s+request|na\s+dotaz/;

/** „dle dohody", „nach Absprache", „to be agreed"… (lhůtu neurčuje). */
export function isByAgreement(text: string): boolean {
  return BY_AGREEMENT.test(fold(text));
}
/** Okamžitá dodávka: „ihned", „skladem", „ab Lager", „sofort", „from stock", „immediately". */
const IMMEDIATE = /(ihned|okamzite|skladem|ze\s+skladu|ab\s+lager|sofort|lagerware|from\s+stock|ex\s+stock|in\s+stock|immediately|immediate)/g;

// ── Kladný seznam ───────────────────────────────────────────
/**
 * Slova JINÝCH podmínek (bez diakritiky) — klauzule s nimi lhůtou není: platnost / závaznost nabídky, splatnost,
 * platba, úhrada, záloha, faktura, záruka, reklamace, skonto, sleva, storno; DE Gültigkeit, Bindungsfrist, gilt,
 * freibleibend, Zahlung, fällig, Rechnung, Anzahlung, Gewährleistung, Mängelrüge; EN valid, payment, due, net,
 * invoice, deposit, warranty, guarantee. „závazná / platná objednávka", „valid PO", „gültige Bestellung" jinou
 * podmínkou NEJSOU (přívlastek objednávky).
 */
const ORDER_NEXT = String.raw`(?!\w*\s+(?:objedn|zakazk|order|po\b|purchase|bestell|auftrag))`;
const OTHER_TERMS = String.raw`splatn|platnost|platn[aeiouy]${ORDER_NEXT}|plati\b|platebn|platb|doplat|uhrad|uhraz|zaplac|pripis|faktur|zaloh|zaruk|zaruc|garanc|garant|guarant|warrant|gewahrleist|gewaehrleist|reklam|zavazn${ORDER_NEXT}|vazan[aoy]?\b|skont|sleva|slevu|rabatt|discount|zahlung|zahlbar|anzahlung|vorauszahl|rechnung|vorkasse|faellig|fallig|bindefrist|bindungsfrist|freibleib|gultig${ORDER_NEXT}|gueltig${ORDER_NEXT}|\bgilt\b|\bgelten\b|beanstand|mangelr|maengelr|payment|payable|\bpay\b|\bpaid\b|invoice|deposit|prepay|\bdue\b|valid${ORDER_NEXT}|\bnet(?:to)?\b|storn|cancel|kundig|kuendig`;
const OTHER_RE = new RegExp(OTHER_TERMS);
/** Před číslem (bez dodacího slova těsně u čísla) = lhůta něčeho jiného: vzorky, podklady, výkresy, materiál. */
const BEFORE_ONLY_RE = /(vzor|muster|sample|prototyp|podklad|unterlagen|vykres|zeichnung|drawing|material|dokumentac|documentation)/;
/** Začátek / alternativa před číslem: zahájení výroby, Produktionsbeginn, production start, expres, příplatek. */
const START_RE = /(zahaj|zacat|zacne|zacina|(?<!\p{L})start|beginn|(?<!\p{L})expres|express|(?<!\p{L})eil|(?<!\p{L})rush(?!\p{L})|priplat|aufpreis|zuschlag|surcharge)/u;
/** Alternativa ZA číslem („dodání do 2 týdnů za příplatek", „2 Wochen gegen Eilzuschlag"). */
const ALT_AFTER_RE = /(priplat|aufpreis|zuschlag|surcharge|(?<!\p{L})expres|express|(?<!\p{L})eil|(?<!\p{L})rush(?!\p{L}))/u;
/** „dle výkresu", „nach Zeichnung", „according to drawing" — odkaz na výkres, ne lhůta výkresu. */
const PER_DOC = /(?:dle|podle|nach|gem(?:ass|aess)?\.?|according\s+to|as\s+per|per)\s+\S+/g;
/** Prefix klauzule, za kterým číslo není dodací lhůta: vzorky / podklady / materiál, zahájení, expres. */
function sideBefore(prefix: string): boolean {
  return BEFORE_ONLY_RE.test(prefix.replace(PER_DOC, " ")) || START_RE.test(prefix);
}
/** Frekvence dílčích dodávek („každé 2 týdny", „alle 2 Wochen", „every 2 weeks", „1x za", „po 500 ks"). */
const FREQ_BEFORE = /(kazd\w*|\d+\s*x\b|(?<!\p{L})po\s+\d+\s*(?:ks|kus\w*|stk|stuck|pcs|pieces)\b|interval\w*|rhythmus|turnus|(?<!\p{L})(?:alle|every|jede[nrsm]?)\s*$)/u;
const FREQ_AFTER = /^\s*(?:tydne|mesicne|denne|wochentlich|monatlich|taglich|weekly|monthly|daily)(?!\p{L})/u;
/** Jakékoli slovo o dodání / výrobě (pro dodací pole: klauzule s ním není pokračováním jiné podmínky). */
const DELIVERY_RE = /(dodan|dodac|dodav|dodam|dodat|dodej|vyrob|expedic|odesl|liefer|deliver|lead\s*time|\baro\b|shipping|shipment|versand|fertigung|production|manufactur)/;

/**
 * Výslovná dodací slova (kladný seznam). „lhůta" / „termín" / „Frist" samy o sobě dodací slovo NEJSOU —
 * jen s kvalifikací dodání / dodací / expedice / výroba / Liefer… / delivery / lead time.
 */
const ANCHOR = String.raw`(?:dodaci\s+(?:lhut[aeyu]?|dob[auy]|termin)|vyrobni\s+(?:lhut[aeyu]?|dob[auy]|cas)|dodani|dodavk[aeuy]|dodavame|dodame|expedice|expedujeme|expedovat|odeslani|vyroba|vyrobu|vyroby|vyrobime|lieferzeit(?:en)?|lieferfrist|liefertermin|lieferdauer|lieferung|liefern(?:\s+wir)?|versand|fertigungszeit|produktionszeit|herstellungszeit|fertigung|delivery(?:\s+(?:time|period|lead\s*time|date))?|lead[\s-]*times?|shipment|shipping|ships?|production\s+time|manufacturing\s+time|turnaround(?:\s+time)?)`;
/** Výplňová slova mezi dodacím slovem a číslem („dodání do", „Lieferzeit ca.", „delivery within"). */
const FILLER = String.raw`(?:do|za|v|ve|cca|ca|zirka|circa|asi|priblizne|zhruba|max|maximalne|nejpozdeji|nejdele|behem|je|cini|bude|probehne|terminu|lhute|dobe|in|within|is|are|takes|will\s+be|approx|approximately|about|around|up\s+to|innerhalb(?:\s+von)?|binnen|von|bis(?:\s+zu)?|zu|etwa|rund|betragt|ist|sind|erfolgt|erfolgen|spatestens|derzeit|aktuell|currently|standardne|obvykle|typicky|typically|normalne|normalerweise|usually|dilu|dilcu|dilce|zbozi|kusu|vyrobku|zakazky|serie|teile|ware|parts|goods)`;
/** Text před číslem končí dodacím slovem (+ výplň): „dodací lhůta: ", „dodání do ", „Lieferzeit ca. ". */
const ANCHORED_BEFORE = new RegExp(String.raw`(?<!\p{L})${ANCHOR}\s*(?:[:=]|[-–—])?\s*(?:${FILLER}\.?\s*:?\s+){0,3}$`, "u");
const ANCHOR_END = new RegExp(String.raw`(?<!\p{L})${ANCHOR}\s*$`, "u");
/** Dodací slovo hned ZA číslem („4 týdny dodání"). */
const ANCHOR_AFTER = /^\s*(?:dodani|dodaci\s+(?:lhut|dob)\w*|expedice|lieferzeit|lieferfrist|delivery|lead[\s-]*time)\b/;
/** Za číslem předložka + od čeho se počítá („od objednání", „nach Auftragseingang", „after PO", „ARO"). */
const FROM_PREP = /^\s*(?:\(?\s*(?:od|ode|po|nach|after|ab|from|upon|following)\s|aro\b)/;
/** Jiná podmínka ZA číslem („30 Tage netto", „24 měsíců záruka", „od data vystavení faktury", „10 Tage 2 % Skonto"). */
const AFTER_OTHER = new RegExp(String.raw`^\s*(?:(?:od|ode|po|nach|after|ab|from|upon|of|ze|z|bei|pri|with|following|within)\s+(?:(?:data|datum|date|dne|der|dem|des|the|a|an|vystaveni|obdrzeni|prijeti|doruceni|erhalt|eingang|receipt|of)\s+){0,3}|(?:[\d.,]+\s*%?\s+){1,2})?(?:${OTHER_TERMS})`);

/**
 * Výslovné dodání (ne výroba / expedice / „X od objednávky"): taková lhůta má přednost před lhůtou výroby.
 * Expedice / Versand / shipping běží často až PO výrobě („Výroba 3 týdny, expedice 2 dny") — výslovné není.
 */
const EXPLICIT_DELIVERY = /^(?:dodac|dodan|dodavk|dodavame|dodame|liefer|deliver|lead|turnaround)/;

interface Clause { start: number; end: number; sentence: number }

/**
 * Klauzule textu: hranice . (konec věty — tečka + mezera + velké písmeno / konec), ; , (ne desetinná čárka),
 * pomlčka mezi mezerami (ne v rozpětí „6 – 8" a ne za dodacím slovem „Dodací lhůta – 4 týdny") a nový řádek.
 * sentence = pořadí věty (. ; nový řádek), čárka a pomlčka větu nedělí.
 */
function clausesOf(raw: string, f: string): Clause[] {
  const out: Clause[] = [];
  let start = 0;
  let sentence = 0;
  const cut = (at: number, newSentence: boolean) => {
    if (at > start) out.push({ start, end: at, sentence });
    start = at + 1;
    if (newSentence) sentence++;
  };
  for (let i = 0; i < f.length; i++) {
    const ch = f[i];
    if (ch === "\n" || ch === ";") cut(i, true);
    else if (ch === "." && (i + 1 >= f.length || /^\s+\p{Lu}/u.test(raw.slice(i + 1, i + 3)))) cut(i, true);
    else if (ch === "," && !/\d/.test(f[i + 1] ?? "")) cut(i, false);
    else if ((ch === "–" || ch === "—" || ch === "-") && f[i - 1] === " " && f[i + 1] === " ") {
      const left = f.slice(start, i);
      const range = /\d\s*$/.test(left) && /^\s*\d/.test(f.slice(i + 1));
      if (!range && !ANCHOR_END.test(left)) cut(i, false);
    }
  }
  if (f.length > start) out.push({ start, end: f.length, sentence });
  return out;
}

/** Dodací pole: holá doba v klauzuli, která navazuje na jinou podmínku téže věty („Platba převodem, 14 dní"). */
function continuesOther(f: string, clauses: Clause[], ci: number): boolean {
  if (DELIVERY_RE.test(f.slice(clauses[ci].start, clauses[ci].end))) return false;
  for (let j = ci - 1; j >= 0 && clauses[j].sentence === clauses[ci].sentence; j--) {
    const t = f.slice(clauses[j].start, clauses[j].end);
    if (DELIVERY_RE.test(t)) return false;
    if (OTHER_RE.test(t)) return true;
  }
  return false;
}

/** „3D model", „2D výkres", „3D CAD" — číslo + „d" je technické označení, ne lhůta. */
const TECH_AFTER = /^\s*[-/]?\s*(model|vykres|cad|data|dat\b|tisk|print|sken|scan|step|stp\b|dxf|dwg|pdf|soubor|zeichnung|drawing|file|format|geometri|mereni|measur|konstrukc)/;

/**
 * Režim čtení: „delivery-field" = text, o kterém víme, že je o dodání (deliveryLeadTime.text, deliveryTerms
 * z AI, quotes.delivery_terms); „free-text" = poznámka, popis položky, shrnutí.
 */
export type LeadParseMode = "delivery-field" | "free-text";

/**
 * Dodací lhůta z textu (česky, německy, anglicky), null = žádná / „dle dohody" / nejistá.
 * Číslo se vezme, když (1) k němu přímo patří výslovné dodací slovo („dodací lhůta X", „dodání do X",
 * „Lieferzeit ca. X", „delivery within X", „X dodání"), nebo (2) za ním stojí, od čeho běží („X týdnů od
 * objednání", „X Wochen nach Auftragseingang", „X weeks ARO") a před ním v klauzuli není jiná podmínka,
 * nebo (3) jen v dodacím poli: holá doba („4 týdny", „6–8 Wochen") v klauzuli bez jiné podmínky, která
 * nenavazuje na jinou podmínku téže věty a text není „dle dohody". Vždy NIC: jiná podmínka hned za číslem
 * („24 měsíců záruka", „30 Tage netto"), lhůta běžící OD dodání zboží („do 14 dnů od dodání").
 * Rozpětí → horní mez (range zachová obě). Bez slova „pracovní" = kalendářní dny.
 */
export function parseLeadTime(text: string | null | undefined, opts: { mode?: LeadParseMode } = {}): LeadTime | null {
  const mode = opts.mode ?? "delivery-field";
  let raw = (text ?? "").normalize("NFC").replace(/[^\S\n]+/g, " ").replace(/ ?\n[\s]*/g, "\n").trim();
  if (!raw) return null;
  const f = fold(raw);
  if (f.length !== raw.length) raw = f; // indexy musí sedět na původní text
  const agreed = BY_AGREEMENT.test(f);
  const clauses = clausesOf(raw, f);
  let explicitLead: LeadTime | null = null;
  let fallback: LeadTime | null = null;
  let otherMax = 0;
  for (let ci = 0; ci < clauses.length; ci++) {
    const c = clauses[ci];
    const seg = f.slice(c.start, c.end);
    LEAD_RE.lastIndex = 0;
    let m: RegExpExecArray | null;
    while ((m = LEAD_RE.exec(seg))) {
      const start = m.index;
      const end = m.index + m[0].length;
      const a = num(m[1]);
      const b = num(m[2]);
      if (a === null) continue;
      const lo = b !== null ? Math.min(a, b) : a;
      const hi = b !== null ? Math.max(a, b) : a;
      if (!(hi > 0)) continue;
      const kind = unitKind(m[3]);
      // „d" / „w" / „mo" samotné jen hned za číslicí (30d, 4w) — jinak to bývá něco jiného
      if (/^(d|w|mo)$/.test(m[3]) && !/\d\s?$/.test(seg.slice(start, end - m[3].length))) continue;
      // „2D / 3D" (velké D, malé „2d/3d" bez mezery, nebo za ním model / výkres / CAD…) není lhůta
      const flat = (hi === 2 || hi === 3) && (raw[c.start + end - 1] === "D" || /^[23]d$/.test(m[0]));
      const after = seg.slice(end);
      if (m[3] === "d" && (flat || TECH_AFTER.test(after.slice(0, 20)))) continue;
      // vždy nic: jiná podmínka za číslem, frekvence dodávek („každé 2 týdny", „2 Wochen wöchentlich"),
      // alternativa za příplatek / expres
      if (AFTER_OTHER.test(after) || FREQ_AFTER.test(after) || ALT_AFTER_RE.test(after)) continue;
      const prefix = seg.slice(0, start);
      if (FREQ_BEFORE.test(prefix)) continue;
      // za číslem předložka (od / po / nach / after…): lhůta jen od objednávky / potvrzení / podkladů (kladný
      // seznam) — od zálohy, platby, materiálu, dokončení výroby, dodání zboží… = nic
      let fromAfter: LeadFrom;
      if (FROM_PREP_WORD.test(after)) {
        const h = fromHead(after);
        if (h === undefined) continue;
        fromAfter = h;
      } else fromAfter = fromOf(after.slice(0, 60));
      const anchored = ANCHORED_BEFORE.exec(prefix);
      // „Vzorky: dodání 2 týdny", „Zahájení výroby do 5 dnů", „Expresní příplatek za dodání do 2 týdnů" = nic
      if (anchored && sideBefore(prefix.slice(0, anchored.index))) continue;
      const otherBefore = OTHER_RE.test(prefix) || sideBefore(prefix);
      const anchorAfter = otherBefore ? null : ANCHOR_AFTER.exec(after);
      const strict = Boolean(anchored) || Boolean(anchorAfter) || (!otherBefore && FROM_PREP.test(after) && fromAfter !== null);
      const bare = mode === "delivery-field" && !agreed && !OTHER_RE.test(seg) && !sideBefore(prefix) && !continuesOther(f, clauses, ci);
      if (!strict && !bare) continue;
      // výslovné dodání („dodací lhůta", „dodání", „Lieferzeit", „delivery") vyhraje nad výrobou / expedicí /
      // „X od objednávky" / holou dobou
      const explicit = Boolean(anchored && EXPLICIT_DELIVERY.test(anchored[0])) || Boolean(anchorAfter && EXPLICIT_DELIVERY.test(anchorAfter[0].trim()));
      const from = fromAfter ?? fromOf(prefix.slice(-25));
      let snippet = raw.slice(c.start + start, c.start + end);
      if (from) {
        const tail = raw.slice(c.start + end, c.end).slice(0, 50);
        const stop = tail.search(/[()]|\s(?:a|und|and|platnost|splatnost|cena|price|preis)\s/i);
        snippet += stop >= 0 ? tail.slice(0, stop) : tail;
      }
      const mult = kind === "tyden" ? 7 : kind === "mesic" ? 30 : 1;
      const lead: LeadTime = {
        days: Math.round(hi * mult), unit: kind === "pracovni" ? "pracovni" : "kalendarni", from, text: snippet.trim(),
      };
      if (b !== null && lo !== hi) lead.range = [Math.round(lo * mult), Math.round(hi * mult)];
      if (kind === "mesic") lead.months = hi;
      if (lead.days > 3 * 365) continue;
      if (explicit) explicitLead ??= lead;
      else {
        fallback ??= lead;
        otherMax = Math.max(otherMax, lead.days);
      }
    }
  }
  // výslovná dodací lhůta kratší než jiná lhůta v textu („Výroba 6 týdnů, dodání 2 týdny") = nejistota → nic
  if (explicitLead) return otherMax > explicitLead.days ? null : explicitLead;
  if (fallback) return fallback;
  if (agreed) return null;
  for (const c of clauses) {
    const seg = f.slice(c.start, c.end);
    IMMEDIATE.lastIndex = 0;
    const im = IMMEDIATE.exec(seg);
    if (!im) continue;
    // dodací pole: klauzule bez jiné podmínky („Platba ihned" není dodání); volný text jen u dodacího slova
    const ok = mode === "delivery-field" ? !OTHER_RE.test(seg) : ANCHORED_BEFORE.test(seg.slice(0, im.index));
    if (ok) return { days: 3, unit: "pracovni", from: null, text: raw.slice(c.start + im.index, c.start + im.index + im[0].length), range: [0, 3] };
  }
  return null;
}

/**
 * Dodací lhůta nabídky je, ale nedá se použít (běží od zálohy / materiálu, nebo hodnota AI odporuje vlastnímu
 * textu) — u TÉŽE nabídky se pak nečtou ani dodací podmínky, poznámka a shrnutí („doplň termín").
 */
export interface LeadBlocked {
  blocked: true;
  text: string;
}

export function isLeadBlocked(x: unknown): x is LeadBlocked {
  return typeof x === "object" && x !== null && (x as { blocked?: unknown }).blocked === true;
}

const LEAD_ONE = new RegExp(LEAD_RE.source, "iu");

/** V textu je počet + jednotka, za nímž stojí předložka „od / po / nach / after…" (lhůta od něčeho). */
function leadRunsFrom(ft: string): boolean {
  const m = LEAD_ONE.exec(ft);
  return Boolean(m && FROM_PREP_WORD.test(ft.slice(m.index + m[0].length)));
}

/**
 * Strukturovaná dodací lhůta z AI (deliveryLeadTime) → lhůta. „jine" (běží od něčeho jiného než objednávka /
 * potvrzení / podklady) = blok. Text, který je zjevně jiná podmínka (platnost, splatnost, záruka…), = nic
 * (pole se ignoruje), leda jde o lhůtu od objednávky / potvrzení / podkladů a text dává stejnou hodnotu.
 * Hodnota v rozporu s vlastním textem pole (čteným jako dodací pole), nebo text s lhůtou, kterou nelze
 * potvrdit (od zálohy…), = blok. Bez hodnoty se čte text. Rozpětí převezme z textu („6–8 týdnů").
 */
export function leadOfExtracted(x: ExtractedLeadTime | null | undefined): LeadTime | LeadBlocked | null {
  if (!x) return null;
  const text = (x.text ?? "").replace(/\s+/g, " ").trim();
  const block = (): LeadBlocked => ({ blocked: true, text });
  if (x.from === "jine") return block();
  const ft = fold(text);
  const parsed = text ? parseLeadTime(text, { mode: "delivery-field" }) : null;
  const v = Number(x.value);
  const valid = Number.isFinite(v) && v > 0;
  const mult = x.unit === "tydny" ? 7 : x.unit === "mesice" ? 30 : 1;
  const days = valid ? Math.round(v * mult) : 0;
  const unit: LeadUnit = x.unit === "pracovni_dny" ? "pracovni" : "kalendarni";
  const agrees = Boolean(parsed && parsed.days === days && parsed.unit === unit);
  if (text && OTHER_RE.test(ft) && !DELIVERY_RE.test(ft) && !(x.from && agrees)) {
    // „4 týdny od připsání zálohy" = lhůta od něčeho jiného → blok; „Platnost nabídky 30 dní" = pole se ignoruje
    return leadRunsFrom(ft) ? block() : null;
  }
  if (!valid) return parsed ?? (text && LEAD_ONE.test(ft) ? block() : null);
  if (days > 3 * 365) return null;
  // rozpor hodnoty a textu / text s lhůtou, kterou kladný seznam nepotvrdí = nejistota
  if (text && !agrees && (parsed || LEAD_ONE.test(ft))) return block();
  const lead: LeadTime = { days, unit, from: x.from ?? parsed?.from ?? null, text: "" };
  if (x.unit === "mesice") lead.months = v;
  if (parsed && agrees && parsed.range) lead.range = parsed.range;
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
