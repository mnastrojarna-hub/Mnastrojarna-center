import { docNumbersEqual, normalizeDocNumber } from "@/lib/jobs/matching";

/**
 * Párování řádků dokladu (objednávka zákazníka, potvrzení, DL, faktura, doklady dodavatele) na
 * EXISTUJÍCÍ položky zakázky — jeden sdílený párovač pro všechny cesty (focení jednoho dokladu,
 * dávka, kontrola duplicit v Položkách, DL po položkách). Čistá logika, testy item-pairing.test.ts.
 *
 * Pravidla (majitel 30. 10.: objednávka „Unašeč upravený 142/026" bez čísla výkresu se k zakázce
 * s položkou F0N603W88 „Unašeč upravený" PŘIDALA jako nová položka → zdvojený součet):
 *  1. číslo výkresu (+ revize) na obou stranách = tentýž díl; různá čísla = nikdy;
 *  2. číslo výkresu položky v textu řádku (název / popis) = tentýž díl;
 *  3. jinak normalizovaný název (bez diakritiky, velikosti písmen, odkazů typu „142/026",
 *     „poz. 3", slov „upravený / nový…"; tokeny + bigramy), počet kusů, cena / MJ a pořadí;
 *  4. CELKOVÁ ČÁSTKA dokladu je tvrdá kontrola: když přidání řádků dá součet zakázky ≠ objednávka,
 *     ale spárování = objednávka (v toleranci zaokrouhlení / DPH), vyhrává spárování;
 *  5. nejisté (≈ 2 %) → otázka pro člověka, nikdy tiché přidání.
 */

export interface PairExisting {
  id: string;
  position?: number | null;
  drawingNumber?: string | null;
  revision?: string | null;
  name?: string | null;
  description?: string | null;
  quantity?: number | string | null;
  /** Prodejní cena / MJ (u dodavatelských dokladů nákupní — viz priceOf). */
  unitPrice?: number | string | null;
  purchaseUnitPrice?: number | string | null;
}

export interface PairLine {
  drawingNumber?: string | null;
  revision?: string | null;
  name?: string | null;
  description?: string | null;
  quantity?: number | string | null;
  unitPrice?: number | string | null;
}

export type PairConfidence = "sure" | "ask";

export interface LinePair {
  /** Index řádku dokladu. */
  line: number;
  itemId: string;
  score: number;
  confidence: PairConfidence;
  /** Český důvod („stejný název, počet i cena", „číslo výkresu F0N603W88"). */
  reason: string;
}

export interface PairTotals {
  /** Celková částka dokladu (bez DPH). */
  order: number;
  /** Součet položek zakázky, kdyby se nejisté řádky PŘIDALY jako nové. */
  ifAppended: number;
  /** Součet položek zakázky po spárování všech navržených párů. */
  ifPaired: number;
  /** Součet sedí na doklad při přidání / spárování (null = nejde spočítat). */
  appendMatches: boolean;
  pairedMatches: boolean;
}

export interface PairingResult {
  pairs: LinePair[];
  /** Indexy řádků bez protějšku (opravdu nové). */
  newLines: number[];
  totals: PairTotals | null;
}

export interface PairOptions {
  /** Celková částka dokladu bez DPH (0 / null = kontrola součtu se nedělá). */
  orderTotal?: number | null;
  /** Porovnávat s nákupní cenou položek (doklady dodavatele). */
  purchase?: boolean;
  /** Doklad nahrazuje počet a cenu spárované položky (objednávka zákazníka k zakázce bez objednávky). */
  lineWins?: boolean;
}

/** Hranice skóre 0–100. */
export const PAIR_SURE = 72;
export const PAIR_ASK = 45;
/** Nejslabší kandidát, který může zachránit jen kontrola součtu (počet + cena sedí). */
const PAIR_WEAK = 35;

const num = (v: unknown): number => {
  const x = typeof v === "number" ? v : typeof v === "string" ? Number(v.replace(/\s/g, "").replace(",", ".")) : NaN;
  return Number.isFinite(x) ? x : 0;
};

function fold(s: string): string {
  return s.normalize("NFD").replace(/[̀-ͯ]+/g, "").toLowerCase();
}

/** Slova bez rozlišovací hodnoty (jednotky, odkazy, „pozice", „dle výkresu"). */
const STOP = new Set([
  "ks", "kus", "kusu", "kusy", "pc", "pcs", "mj", "pos", "poz", "pozice", "polozka", "pol", "c", "cislo", "no", "nr",
  "vykres", "vykresu", "vyk", "dle", "podle", "rev", "revize", "index", "idx", "obj", "objednavka", "radek", "ref",
  "a", "i", "s", "se", "z", "ze", "na", "do", "pro", "the", "and", "of",
]);

/** Slova úpravy / varianty — nesou málo informace („Unašeč upravený" ≈ „Unašeč"). */
const WEAK_WORDS = new Set([
  "upraven", "uprav", "upravy", "novy", "nov", "modifikovan", "modif", "kompletn", "komplet", "sestav", "dil", "dily",
  "vyrob", "vyrobek", "obrobek", "obroben", "frezovan", "soustruzen", "brousen",
]);

/** Česká koncovka pryč (upravený / upravená / upravené → upraven; matice → matic). */
function stem(t: string): string {
  if (t.length <= 3 || /^\d/.test(t)) return t;
  for (const suf of ["ymi", "ych", "eho", "emu", "ami", "ach", "ove", "ova", "ovy", "ou", "y", "a", "e", "i", "o", "u"]) {
    if (t.endsWith(suf) && t.length - suf.length >= 3) return t.slice(0, -suf.length);
  }
  return t;
}

/** Odkazy na řádek / objednávku v textu: „142/026", „poz. 3", „#12", „1." na začátku. */
const REF_PATTERNS: RegExp[] = [
  /\b\d+\s*[/\\]\s*\d+\b/g,
  /\b(?:poz|pos|pol|c|no|nr)\.?\s*\d+\b/g,
  /#\s*\d+/g,
  /^\s*\d+\s*[.)]\s+/g,
];

/** Tokeny názvu pro porovnání (bez diakritiky, odkazů, jednotek; kmeny slov). */
export function itemNameTokens(v: string | null | undefined): string[] {
  if (!v) return [];
  let s = fold(v);
  for (const re of REF_PATTERNS) s = s.replace(re, " ");
  const out: string[] = [];
  for (const raw of s.split(/[^a-z0-9]+/)) {
    if (!raw || raw.length < 2 || STOP.has(raw)) continue;
    // čisté číslo bez rozlišovací hodnoty (počty, roky); čísla s písmeny (M12, 4711B) zůstávají
    if (/^\d+$/.test(raw)) continue;
    out.push(stem(raw));
  }
  return out;
}

function tokenWeight(t: string): number {
  return WEAK_WORDS.has(t) ? 0.25 : 1;
}

function bigramDice(a: string, b: string): number {
  if (!a || !b) return 0;
  if (a === b) return 1;
  const grams = (s: string) => {
    const m = new Map<string, number>();
    for (let i = 0; i < s.length - 1; i++) m.set(s.slice(i, i + 2), (m.get(s.slice(i, i + 2)) ?? 0) + 1);
    return m;
  };
  const ga = grams(a);
  const gb = grams(b);
  let total = 0;
  for (const c of ga.values()) total += c;
  for (const c of gb.values()) total += c;
  if (!total) return 0;
  let common = 0;
  for (const [g, c] of ga) common += Math.min(c, gb.get(g) ?? 0);
  return (2 * common) / total;
}

/** Podobnost dvou názvů dílu 0..1 (vážené tokeny + bigramy na překlepy). */
export function itemNameScore(a: string | null | undefined, b: string | null | undefined): number {
  const ta = itemNameTokens(a);
  const tb = itemNameTokens(b);
  if (!ta.length || !tb.length) return 0;
  const sa = new Set(ta);
  const sb = new Set(tb);
  let common = 0;
  let wa = 0;
  let wb = 0;
  for (const t of sa) {
    wa += tokenWeight(t);
    if (sb.has(t)) common += tokenWeight(t);
    else {
      // překlep / zkratka ve slově („unasec" × „unasece") — částečná shoda
      const best = Math.max(0, ...[...sb].map((x) => bigramDice(t, x)));
      if (best >= 0.8) common += tokenWeight(t) * best;
    }
  }
  for (const t of sb) wb += tokenWeight(t);
  const tokenScore = wa + wb > 0 ? (2 * common) / (wa + wb) : 0;
  // bigramy přes slova (překlepy, slepená slova) — jen rozlišující slova, „upravený" nerozhoduje
  const strong = (s: Set<string>) => {
    const x = [...s].filter((t) => !WEAK_WORDS.has(t));
    return (x.length ? x : [...s]).sort().join("");
  };
  const joined = bigramDice(strong(sa), strong(sb));
  return Math.min(1, Math.max(tokenScore, joined * 0.9));
}

/** Text řádku / položky pro porovnání názvu (název, jinak i popis). */
function texts(x: { name?: string | null; description?: string | null }): string[] {
  return [x.name, x.description].map((t) => (t ?? "").trim()).filter(Boolean);
}

function bestNameScore(line: PairLine, item: PairExisting): number {
  let best = 0;
  for (const a of texts(line)) for (const b of texts(item)) best = Math.max(best, itemNameScore(a, b));
  return best;
}

/** Číslo výkresu je obsažené v textu (název / popis) — „F0N603W88 Unašeč" nebo „Unašeč (F0N 603 W88)". */
function numberInText(numberRaw: string | null | undefined, x: { name?: string | null; description?: string | null }): boolean {
  const n = normalizeDocNumber(numberRaw).replace(/-/g, "");
  if (n.length < 4) return false;
  return texts(x).some((t) => normalizeDocNumber(t).replace(/-/g, "").includes(n));
}

function sameRevision(a: string | null | undefined, b: string | null | undefined): boolean | null {
  const x = (a ?? "").trim().toUpperCase().replace(/^0+(?=\w)/, "");
  const y = (b ?? "").trim().toUpperCase().replace(/^0+(?=\w)/, "");
  if (!x || !y) return null;
  return x === y;
}

function priceOf(item: PairExisting, purchase: boolean): number {
  return num(purchase ? item.purchaseUnitPrice : item.unitPrice);
}

function samePrice(a: number, b: number): boolean {
  if (!(a > 0) || !(b > 0)) return false;
  return Math.abs(a - b) <= Math.max(0.01, 0.005 * Math.max(a, b));
}

function sameQty(a: number, b: number): boolean {
  return a > 0 && b > 0 && Math.abs(a - b) < 1e-9;
}

export interface PairScore {
  score: number;
  reason: string;
  /** Různá čísla výkresu = nikdy tentýž díl. */
  incompatible: boolean;
  /** Shoda podle čísla výkresu (ne jen podle názvu). */
  byNumber?: boolean;
}

/** Skóre páru řádek dokladu × položka zakázky (0–100). */
export function scoreLinePair(line: PairLine, item: PairExisting, opts: { purchase?: boolean; linePos?: number; itemPos?: number } = {}): PairScore {
  const ld = (line.drawingNumber ?? "").trim();
  const idn = (item.drawingNumber ?? "").trim();
  if (ld && idn) {
    if (!docNumbersEqual(ld, idn)) return { score: 0, reason: "", incompatible: true };
    const rev = sameRevision(line.revision, item.revision);
    return { score: rev === false ? 88 : 100, reason: `číslo výkresu ${idn}${rev === false ? " (jiná revize)" : ""}`, incompatible: false, byNumber: true };
  }
  if (idn && numberInText(idn, line)) return { score: 95, reason: `číslo výkresu ${idn} v textu řádku`, incompatible: false, byNumber: true };
  if (ld && numberInText(ld, item)) return { score: 95, reason: `číslo výkresu ${ld} v textu položky`, incompatible: false, byNumber: true };

  const name = bestNameScore(line, item);
  const lq = num(line.quantity);
  const iq = num(item.quantity);
  const qty = sameQty(lq, iq);
  const price = samePrice(num(line.unitPrice), priceOf(item, Boolean(opts.purchase)));
  const pos = opts.linePos !== undefined && opts.itemPos !== undefined && opts.linePos === opts.itemPos;
  let score = name * 60 + (qty ? 20 : 0) + (price ? 15 : 0) + (pos ? 5 : 0);
  // stejný název (po normalizaci) = tentýž díl i bez počtu a ceny (DL, dílčí dodávky)
  if (name >= 0.92) score = Math.max(score, 76);
  const bits: string[] = [];
  if (name >= 0.92) bits.push("stejný název");
  else if (name >= 0.6) bits.push("podobný název");
  if (qty) bits.push("počet");
  if (price) bits.push("cena");
  const reason = bits.length ? bits.join(", ").replace(/, ([^,]*)$/, " i $1") : "";
  return { score: Math.round(score * 10) / 10, reason, incompatible: false };
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

/** Součet sedí na částku dokladu (zaokrouhlení ±1 Kč / 0,5 %; AI mohla vzít částku s DPH 21 / 12 %). */
export function totalsMatch(sum: number, order: number): boolean {
  if (!(order > 0) || !(sum > 0)) return false;
  for (const base of [order, order / 1.21, order / 1.12]) {
    if (Math.abs(sum - base) <= Math.max(1, 0.005 * base)) return true;
  }
  return false;
}

/**
 * Spáruje řádky dokladu s existujícími položkami 1:1 (nejlepší skóre první). Nejisté páry
 * rozhodne součet dokladu; co zůstane nejisté, je otázka „ask".
 */
export function pairDocLines(lines: PairLine[], items: PairExisting[], opts: PairOptions = {}): PairingResult {
  const purchase = Boolean(opts.purchase);
  const cands: { line: number; item: number; s: PairScore }[] = [];
  lines.forEach((l, li) => {
    items.forEach((it, ii) => {
      const s = scoreLinePair(l, it, { purchase, linePos: li, itemPos: it.position ?? ii });
      if (!s.incompatible && s.score >= PAIR_WEAK) cands.push({ line: li, item: ii, s });
    });
  });
  cands.sort((a, b) => b.s.score - a.s.score || Math.abs(a.line - a.item) - Math.abs(b.line - b.item));
  const usedLine = new Set<number>();
  const usedItem = new Set<number>();
  const chosen: { line: number; item: number; s: PairScore; tie: boolean }[] = [];
  for (const c of cands) {
    if (usedLine.has(c.line) || usedItem.has(c.item)) continue;
    // nejednoznačné: stejně dobrý kandidát téhož řádku s jinou volnou položkou (dvě stejné položky)
    // (rozdíl jen o pořadí řádku = +5 nerozhoduje)
    const tie = !c.s.byNumber && cands.some((o) => o.line === c.line && o.item !== c.item && !usedItem.has(o.item) && c.s.score - o.s.score < 6);
    usedLine.add(c.line);
    usedItem.add(c.item);
    chosen.push({ ...c, tie });
  }

  const conf = new Map<number, PairConfidence | "weak">();
  for (const c of chosen) {
    const base = c.s.score >= PAIR_SURE ? "sure" : c.s.score >= PAIR_ASK ? "ask" : "weak";
    conf.set(c.line, c.tie && base === "sure" ? "ask" : base);
  }

  // kontrola součtu (jen když jde spočítat: celková částka, ceny u všech řádků i položek)
  let totals: PairTotals | null = null;
  const order = num(opts.orderTotal);
  const linePrice = (i: number) => num(lines[i].unitPrice) * num(lines[i].quantity);
  const pricedLines = lines.length > 0 && lines.every((l) => num(l.unitPrice) > 0 && num(l.quantity) > 0);
  const pricedItems = items.every((it) => priceOf(it, purchase) > 0 && num(it.quantity) > 0);
  if (order > 0 && pricedLines && pricedItems) {
    const sumWith = (paired: Set<number>) => {
      let s = 0;
      const pairedItems = new Map<number, number>();
      for (const c of chosen) if (paired.has(c.line)) pairedItems.set(c.item, c.line);
      items.forEach((it, ii) => {
        const li = pairedItems.get(ii);
        s += li !== undefined && opts.lineWins ? linePrice(li) : priceOf(it, purchase) * num(it.quantity);
      });
      lines.forEach((_, li) => { if (!paired.has(li)) s += linePrice(li); });
      return round2(s);
    };
    const sure = new Set(chosen.filter((c) => conf.get(c.line) === "sure").map((c) => c.line));
    const all = new Set(chosen.map((c) => c.line));
    const ifAppended = sumWith(sure);
    const ifPaired = sumWith(all);
    const appendMatches = totalsMatch(ifAppended, order);
    const pairedMatches = totalsMatch(ifPaired, order);
    totals = { order: round2(order), ifAppended, ifPaired, appendMatches, pairedMatches };
    for (const c of chosen) {
      const k = conf.get(c.line);
      if (k === "sure") continue;
      if (pairedMatches && !appendMatches) conf.set(c.line, k === "ask" && !c.tie ? "sure" : "ask");
      else if (appendMatches && !pairedMatches) conf.set(c.line, "weak");
    }
  }

  const pairs: LinePair[] = [];
  for (const c of chosen) {
    const k = conf.get(c.line);
    if (k === "weak") continue;
    const totalReason = totals?.pairedMatches && !totals.appendMatches && c.s.score < PAIR_SURE ? "součet sedí na doklad" : "";
    pairs.push({
      line: c.line, itemId: items[c.item].id, score: c.s.score, confidence: k ?? "ask",
      reason: [c.s.reason, totalReason].filter(Boolean).join("; ") || "podobný řádek",
    });
  }
  pairs.sort((a, b) => a.line - b.line);
  const paired = new Set(pairs.map((p) => p.line));
  return { pairs, newLines: lines.map((_, i) => i).filter((i) => !paired.has(i)), totals };
}

// ── Duplicitní položky zakázky (Položky → „Sloučit") ────────

export interface DuplicateItem extends PairExisting {
  material?: string | null;
  /** Položka má navázaný výkres / technologii / objednávky dodavatele (= „bohatší"). */
  links?: number;
}

export interface DuplicatePair {
  keepId: string;
  dropId: string;
  reason: string;
}

function richness(it: DuplicateItem): number {
  return (it.drawingNumber?.trim() ? 4 : 0) + (it.revision?.trim() ? 1 : 0) + (it.material?.trim() ? 1 : 0) + (it.links ?? 0) * 2;
}

/**
 * Pravděpodobné duplicity v položkách zakázky: stejný / podobný název, stejný počet i cena a jen
 * jedna z dvojice má číslo výkresu (druhá je řádek objednávky bez výkresu). Když je součet položek
 * 2× hodnota zakázky (objednávky), stačí i slabší podobnost názvu. Nikdy dvě různá čísla výkresu.
 */
export function findDuplicateItems(items: DuplicateItem[], opts: { orderTotal?: number | null } = {}): DuplicatePair[] {
  const sum = round2(items.reduce((s, it) => s + num(it.unitPrice) * num(it.quantity), 0));
  const order = num(opts.orderTotal);
  const doubled = order > 0 && totalsMatch(sum, 2 * order);
  const out: DuplicatePair[] = [];
  const used = new Set<string>();
  const cands: { a: DuplicateItem; b: DuplicateItem; score: number; reason: string }[] = [];
  for (let i = 0; i < items.length; i++) {
    for (let j = i + 1; j < items.length; j++) {
      const a = items[i];
      const b = items[j];
      const ad = (a.drawingNumber ?? "").trim();
      const bd = (b.drawingNumber ?? "").trim();
      if (ad && bd) continue; // dvě čísla výkresu: stejná = úmyslně dvě položky / různá = různé díly
      if (!sameQty(num(a.quantity), num(b.quantity))) continue;
      const pa = num(a.unitPrice);
      const pb = num(b.unitPrice);
      const priceOk = samePrice(pa, pb) || (!(pa > 0) && !(pb > 0));
      if (!priceOk) continue;
      const inText = (ad && numberInText(ad, b)) || (bd && numberInText(bd, a));
      const name = bestNameScore(a, b);
      const need = doubled ? 0.6 : 0.85;
      if (!inText && name < need) continue;
      const reason = inText ? "číslo výkresu v textu" : name >= 0.92 ? "stejný název, počet i cena" : "podobný název, stejný počet i cena";
      cands.push({ a, b, score: (inText ? 1 : name) + (priceOk && pa > 0 ? 0.1 : 0), reason: doubled ? `${reason}; součet položek je 2× hodnota zakázky` : reason });
    }
  }
  cands.sort((x, y) => y.score - x.score);
  for (const c of cands) {
    if (used.has(c.a.id) || used.has(c.b.id)) continue;
    const [keep, drop] = richness(c.a) >= richness(c.b) ? [c.a, c.b] : [c.b, c.a];
    used.add(keep.id);
    used.add(drop.id);
    out.push({ keepId: keep.id, dropId: drop.id, reason: c.reason });
  }
  return out;
}
