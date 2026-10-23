/**
 * Polotovar a hmotnost z rozměrů výkresu („Ø65x120", „120 x 80 x 30", „tl. 10 – 250 x 400", „□40 x 100"…).
 *
 * Čistý modul (klient i server). Postup:
 *  1. parseDimensionText — rozměry z textu výkresu / AI → tvar dílu (kulatina, trubka, šestihran,
 *     čtyřhran, hranol, plech, obalový kvádr ze 3 největších rozměrů).
 *  2. estimateBlank — přídavky na obrábění (dle velikosti) + upnutí/řez u délky, zaokrouhlení na běžné
 *     hutní rozměry, objem → hmotnost polotovaru; hrubý odhad hmotnosti dílu jen když není na výkresu.
 *  3. analyzeDrawingMaterial — vše dohromady (materiál, úpravy, polotovar) → hodnoty sloupců DB.
 *
 * Hmotnost polotovaru je VŽDY odhad (zdroj „odhad"); hmotnost dílu z výkresu má vždy přednost.
 * Rozměr, který už JE polotovar („polotovar Ø70 x 130", hutní zápis „KR 70 ČSN 42 5510 – 130",
 * „PLO 50 x 20 – 120", „P10 – 250 x 400", nebo samostatné pole blankDimensions), se nepřídavkuje.
 */

import {
  classifyMaterial, fold, formatHeatTreatments, formatSurfaceTreatments, materialGroupMeta, parseTreatments,
  type HeatKind, type MaterialClassification, type MaterialGroupKey, type ParsedTreatments,
} from "./material-groups";

// ═════════════════════════════════════════════════════════════════════════
// Hutní tabulky běžných rozměrů (mm)
// ═════════════════════════════════════════════════════════════════════════

/** Tyče kruhové (válcované / tažené / loupané, ČSN EN 10060 / 10278) — běžně skladem. */
export const ROUND_BAR_SIZES = [
  3, 4, 5, 6, 8, 10, 12, 14, 15, 16, 18, 20, 22, 25, 28, 30, 32, 35, 36, 38, 40, 42, 45, 48, 50, 52, 55, 56, 60, 63, 65,
  70, 75, 80, 85, 90, 95, 100, 105, 110, 115, 120, 125, 130, 135, 140, 145, 150, 155, 160, 165, 170, 175, 180, 185, 190,
  195, 200, 210, 220, 230, 240, 250, 260, 270, 280, 290, 300, 310, 320, 330, 340, 350, 360, 380, 400, 420, 450, 480, 500,
  530, 560, 600,
];
/** Šířky plochých tyčí (ČSN EN 10058 / 10278). Nad 200 mm se pálí / řeže z desky. */
export const FLAT_WIDTH_SIZES = [10, 12, 15, 16, 20, 25, 30, 35, 40, 45, 50, 55, 60, 65, 70, 75, 80, 90, 100, 110, 120, 130, 140, 150, 160, 180, 200];
/** Tloušťky plochých tyčí a tlustých plechů / desek. */
export const FLAT_THICKNESS_SIZES = [
  2, 3, 4, 5, 6, 8, 10, 12, 15, 16, 20, 25, 30, 35, 40, 45, 50, 55, 60, 65, 70, 75, 80, 90, 100, 110, 120, 130, 140, 150,
  160, 180, 200, 220, 250, 280, 300,
];
/** Tloušťky plechů (tenké i tlusté). */
export const SHEET_THICKNESS_SIZES = [
  0.5, 0.6, 0.8, 1, 1.2, 1.5, 2, 2.5, 3, 4, 5, 6, 8, 10, 12, 15, 20, 25, 30, 35, 40, 45, 50, 55, 60, 65, 70, 75, 80, 90,
  100, 110, 120, 130, 140, 150,
];
/** Šestihrany (rozměr přes plochy). */
export const HEX_SIZES = [6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20, 21, 22, 24, 26, 27, 30, 32, 34, 36, 38, 41, 46, 50, 55, 60, 65, 70, 75, 80, 85, 90, 100];
/** Čtyřhrany. */
export const SQUARE_SIZES = [8, 10, 12, 14, 15, 16, 18, 20, 22, 25, 28, 30, 32, 35, 40, 45, 50, 55, 60, 63, 65, 70, 75, 80, 90, 100, 110, 120, 130, 140, 150, 160, 180, 200];

// ═════════════════════════════════════════════════════════════════════════
// Přídavky (dílenské hodnoty)
// ═════════════════════════════════════════════════════════════════════════

/**
 * Přídavek na PRŮMĚR (celkem, mm) — soustružení na čisto z válcované / tažené tyče.
 * Nejméně 5 % Ø: u velkých válcovaných tyčí roste tolerance (±1,5–2 mm) i oduhličená vrstva.
 */
export function roundAllowance(d: number): number {
  let a: number;
  if (d <= 20) a = 2;
  else if (d <= 40) a = 3;
  else if (d <= 80) a = 4;
  else if (d <= 150) a = 5;
  else if (d <= 300) a = 8;
  else a = 12;
  return Math.max(a, Math.ceil(0.05 * d));
}

/** Přídavek na ROZMĚR hranolu (celkem na obě strany, mm) — frézování ploch z přířezu. */
export function prismAllowance(x: number): number {
  if (x <= 25) return 3;
  if (x <= 80) return 4;
  if (x <= 200) return 5;
  if (x <= 500) return 8;
  return 10;
}

/** Zarovnání čela na jednu stranu (mm) podle průměru. */
export function faceAllowance(d: number): number {
  if (d <= 50) return 1.5;
  if (d <= 150) return 2.5;
  return 4;
}

/** Nepřesnost / kolmost řezu pilou (mm). */
export const CUT_TOLERANCE_MM = 2;
/**
 * Přídavek na upnutí u krátkých dílů (L < 20 mm nebo L < 0,2·Ø) — jen do Ø80 (tyčový podavač / upnutí
 * za tyč). Větší kotouče se upínají za obvod na dvě upnutí → bez přídavku.
 */
export const GRIP_ALLOWANCE_MM = 10;
export const GRIP_MAX_DIAMETER_MM = 80;

function gripAllowance(l: number, d: number): number {
  return d <= GRIP_MAX_DIAMETER_MM && (l < 20 || l < 0.2 * d) ? GRIP_ALLOWANCE_MM : 0;
}

/** Kotouč / příruba (Ø ≥ 150, L ≤ 0,25·Ø) se pálí z plechu, ne řeže z tyče. */
export const DISC_MIN_DIAMETER_MM = 150;
export const DISC_MAX_RATIO = 0.25;
/** Tyče nad Ø300 se běžně neskladují (kovají se). */
export const MAX_STOCK_BAR_MM = 300;
/** Kontrola věrohodnosti: větší rozměr / hmotnost se nezapisuje (jen varování). */
export const MAX_PLAUSIBLE_DIM_MM = 6000;
export const MAX_PLAUSIBLE_KG = 2000;
/** Využití materiálu u odlitku (polotovar ≈ díl / 0,85). */
export const CASTING_UTILIZATION = 0.85;

/** Délka polotovaru tyče: L + 2× čelo + řez (+ upnutí u krátkých), nahoru na 5 mm. */
export function barBlankLength(l: number, d: number): number {
  return ceilTo(l + 2 * faceAllowance(d) + CUT_TOLERANCE_MM + gripAllowance(l, d), 5);
}

/**
 * Okraj výpalku z plechu na stranu (mm) podle technologie řezu:
 * laser do tl. 12 → 3 mm, plazma do tl. 30 → 5 mm, plamen do tl. 50 → 8 mm, nad → 10 mm.
 */
export function sheetMargin(t: number): number {
  if (t <= 12) return 3;
  if (t <= 30) return 5;
  if (t <= 50) return 8;
  return 10;
}

/** Nad tl. 25 se plocha frézuje → plech o 3 mm silnější (nahoru na běžnou tloušťku). */
export const PLATE_MILL_FROM_MM = 25;
export const PLATE_MILL_ALLOWANCE_MM = 3;

export function ceilTo(v: number, step: number): number {
  return Math.round(Math.ceil(v / step - 1e-9) * step * 1000) / 1000;
}

/** Nejbližší běžný rozměr ≥ v; nad tabulkou nahoru na `stepAbove`. */
export function standardUp(v: number, table: readonly number[], stepAbove = 10): number {
  for (const s of table) if (s >= v - 1e-6) return s;
  return ceilTo(v, stepAbove);
}

// ═════════════════════════════════════════════════════════════════════════
// Parsování rozměrů
// ═════════════════════════════════════════════════════════════════════════

export type PartShape = "kulatina" | "trubka" | "sestihran" | "ctyrhran" | "hranol" | "plech" | "obalovy" | "neurceno";

export interface ParsedDimensions {
  shape: PartShape;
  /** Průměr (kulatina, trubka vnější). */
  d?: number;
  /** Vnitřní průměr trubky. */
  dInner?: number;
  /** Šestihran přes plochy. */
  s?: number;
  /** Strana čtyřhranu. */
  a?: number;
  /** Tloušťka plechu. */
  t?: number;
  /** Délka (největší rozměr hranolu / délka tyče). */
  l?: number;
  /** Šířka (prostřední rozměr). */
  w?: number;
  /** Výška / tloušťka hranolu (nejmenší rozměr). */
  h?: number;
  /** Až 3 největší rozměry sestupně. */
  dims: number[];
  /** Plech podle slova v textu („plech", „výpalek"). */
  sheetHint: boolean;
  /**
   * Rozměr je už polotovar (slovo „polotovar" / „Rohteil" / „blank", rozměrová norma hutního výrobku
   * ČSN 42 5xxx–7xxx / DIN 1013 / EN 10060…, zápis PLO / P<t> / KR … – L) → bez přídavků.
   */
  blankGiven: boolean;
  raw: string;
}

const N = "(\\d+(?:\\.\\d+)?)";

/** Rozměrové normy hutních výrobků (rozměr je polotovar). */
const BLANK_NORM_RE = /(?<![a-z])(?:csn|din|en|iso)(?:\s?(?:en|iso|din))*\s?(?:42\s?[567]\d{3}|1013|1014|1015|1016|1017|1018|1022|1024|1025|1026|1027|1028|1029|1543|1544|1541|1542|1652|17\s?175|2448|2391|2462|10058|10059|10060|10061|10278|10305|10216|10217|10220|10297|10029|10051|10048)(?!\d)/;
const BLANK_WORD_RE = /\bpolotovar\w*|\brohteil\w*|\brohma(?:ss|ß)\w*|\brohling\w*|\bblank\b|\bsemi[\s-]?finished\b|\bstock\s+size\b|\braw\s+material\s+size\b/;
/** Hutní zápis: „PLO 50 x 20 – 120", „P10 – 250 x 400", „KR 70 – 130", „6HR 24 – 50", „TR 60x5 – 200". */
const BLANK_NOTATION_RE = /(?<![a-z])(?:plo\.?\s?\d|p\s?\d+(?:[.,]\d+)?\s*[-–—]\s*\d|(?:kr|4hr|6hr|tr)\.?\s?[ø⌀]?\s?\d+(?:[.,]\d+)?(?:\s*[x×]\s*\d+(?:[.,]\d+)?)?(?:\s+(?:csn|din|en)[\s\d.]+)?\s*[-–—]\s*\d)/;

function prepDims(text: string): string {
  let s = fold(text.normalize("NFKC"));
  s = s
    .replace(/[⌀∅φ]/g, "ø")
    .replace(/[×✕✖*]/g, " x ")
    .replace(/[‐-―−]/g, "-")
    .replace(/(\d),(\d)/g, "$1.$2")
    // normy (ČSN 42 5510, DIN 1013, EN 10060, ISO 2768-mK) nejsou rozměry
    .replace(/(?<![a-z])(?:csn|din|en|iso|astm)(?:\s?(?:en|iso|din))*\s?(?:\d{2}\s?\d{4}|\d{3,5})(?:[-:]\d{1,4})*(?:-?[a-z]{1,2}\b)?/g, " ")
    .replace(/[±]\s?\d+(?:\.\d+)?/g, " ")
    .replace(/\(\s*[+-]?\s?\d*\.?\d+\s*\/\s*[+-]?\s?\d*\.?\d+\s*\)/g, " ")
    .replace(/\s[+-]\s?0\.\d+(?:\s*\/\s*[+-]?\s?0\.\d+)?/g, " ")
    // uložení za číslem (h6, H7, js6, g6…) — „x" mezi rozměry nesmí zmizet
    .replace(/(\d)\s?(?:js|za|zb|zc|[abcdefghjkmnprstuvyz])(\d{1,2})(?=$|[^\d.])/g, "$1")
    // závity M8x1.25
    .replace(/(?<![a-z])m\d{1,3}(?:\s?x\s?\d(?:\.\d+)?)?\b/g, " ")
    .replace(/\bmm\b|(?<=\d)mm\b/g, " ")
    // rádiusy (R5) se do obrysu nepočítají
    .replace(/(?<![a-z])r\s?=?\s?\d+(?:\.\d+)?/g, " ")
    // vnitřní šestihran / imbus (SW10) je prvek dílu, ne tvar polotovaru
    .replace(/(?<![a-z])(?:vnitrn\w*|inbus\w*|imbus\w*|innen\w*|internal|socket)(?:\s+(?:sestihran\w*|sechskant\w*|hex\w*|6\s?-?hr\.?|6kt|sw|klic\w*))*\s*\d+(?:\.\d+)?/g, " ")
    // hutní zápis ploché tyče „plo 50 x 20 - 120" → 3 rozměry
    .replace(/(?<![a-z])plo\.?\s*(\d+(?:\.\d+)?)\s*x\s*(\d+(?:\.\d+)?)(?:\s*-\s*(\d+(?:\.\d+)?))?/g,
      (_m, a: string, b: string, c: string | undefined) => (c ? ` ${a} x ${b} x ${c} ` : ` ${a} x ${b} `))
    // plech „p10 - 250 x 400", „plech p10 250x400" → tloušťka
    .replace(/(?<![a-z])p\s?(\d+(?:\.\d+)?)(?=\s*-?\s*\d+(?:\.\d+)?\s*x\s*\d)\s*-?/g, " tl:$1 ")
    // „D 65 x 120" (D s mezerou)
    .replace(/(?<![a-z])d\s(?=\d+(?:\.\d+)?\s*(?:x|-)\s*\d)/g, "ø");
  s = s
    .replace(/(?<![a-z])(?:6\s?-?hr\.?|sestihran\w*|sw|hex\w*|sechskant\w*|6kt)\s*(?=\d)/g, " hex:")
    .replace(/(?:□|■|(?<![a-z\d])4\s?-?hr\.?|(?<![a-z])ctyrhran\w*|(?<![a-z])ctverec\w*|(?<![a-z])vierkant\w*|(?<![a-z])square|(?<![a-z])kv\.?|(?<![a-z\d])4kt)\s*(?=\d)/g, " sq:")
    .replace(/(?<![a-z])(?:tl\.?|tloustk\w*|t\s?=|s\s?=|thk\.?|thickness|dicke|starke)\s*(?=\d)/g, " tl:")
    .replace(/(?<![a-z])(?:l\s?=|dl\.?\s?=?|delk\w*\s?=?|lange\s?=?|length\s?=?|len\.?)\s*(?=\d)/g, " len:")
    .replace(/(?<![a-z])(?:tr\.?|trubk\w*|tube|rohr)\s*(?=ø|\d)/g, " tube:")
    .replace(/(?<![a-z])(?:fi|kr\.?|kul\.?|kulatin\w*|kruh\w*|pr\.|prum\.?|prumer\w*|dia\.?|diameter|durchm\w*|d\s?=)\s*(?=\d)/g, " ø")
    .replace(/(?<![a-z])d(?=\d)/g, "ø")
    .replace(/ø\s+/g, "ø")
    .replace(/\s+/g, " ")
    .trim();
  return s;
}

const num = (x: string | undefined): number => (x === undefined ? NaN : Number(x));

/** Rozpozná tvar a rozměry dílu z textu výkresu / AI. */
export function parseDimensionText(text: string | null | undefined): ParsedDimensions {
  const raw = (text ?? "").trim();
  const folded = fold(raw.normalize("NFKC"));
  const sheetHint = /\bplech\w*|\bblech\b|\bsheet\b|\bvypal\w*|\blaser\w*|\bplate\b/.test(folded);
  const blankGiven = BLANK_WORD_RE.test(folded) || BLANK_NORM_RE.test(folded) || BLANK_NOTATION_RE.test(folded);
  const base = (shape: PartShape, extra: Partial<ParsedDimensions>, dims: number[]): ParsedDimensions => ({
    shape, ...extra, dims: [...dims].filter((x) => x > 0).sort((a, b) => b - a).slice(0, 3), sheetHint, blankGiven, raw,
  });
  if (!raw) return base("neurceno", {}, []);
  const s = prepDims(raw);
  const lenTok = s.match(new RegExp(`len:${N}`));
  const len = lenTok ? num(lenTok[1]) : undefined;

  // Trubka „ø80/ø50 x 100", „tube:60/40 x 100"
  let m = s.match(new RegExp(`(?:tube:)?ø?${N}\\s*\\/\\s*ø?${N}(?:\\s*(?:x|-|len:)\\s*${N})?`));
  if (m && num(m[2]) < num(m[1])) {
    const l = num(m[3]) || len;
    return base("trubka", { d: num(m[1]), dInner: num(m[2]), l }, [num(m[1]), l ?? 0]);
  }
  // Trubka „TR 60x5 x 200" (Ø × stěna × délka)
  m = s.match(new RegExp(`tube:ø?${N}\\s*x\\s*${N}(?:\\s*(?:x|-|len:)\\s*${N})?`));
  if (m) {
    const D = num(m[1]);
    const second = num(m[2]);
    const dInner = second < D / 2 ? D - 2 * second : second < D ? second : undefined;
    const l = num(m[3]) || len;
    if (dInner !== undefined) return base("trubka", { d: D, dInner, l }, [D, l ?? 0]);
  }
  // Trubka bez „TR": „Ø60x5x200" (Ø × stěna × délka; stěna ≤ Ø/4) — ne sražení „Ø20 x 3 x 45°"
  m = s.match(new RegExp(`ø${N}\\s*x\\s*${N}\\s*x\\s*${N}(?![\\d.]|\\s*°)`));
  if (m && num(m[2]) <= num(m[1]) / 4 && num(m[3]) > num(m[2])) {
    const D = num(m[1]);
    return base("trubka", { d: D, dInner: D - 2 * num(m[2]), l: num(m[3]) }, [D, num(m[3])]);
  }
  const dias = [...s.matchAll(new RegExp(`ø${N}`, "g"))].map((x) => num(x[1]));
  // Šestihran „6hr 24 x 50"; „SW 27" bez délky vedle „Ø30 x 60" = klíčové plochy na rotačním dílu → kulatina
  m = s.match(new RegExp(`hex:${N}(?:\\s*(?:x|-|len:)\\s*${N})?`));
  if (m) {
    const l = num(m[2]) || len;
    if (l || !dias.length) return base("sestihran", { s: num(m[1]), l }, [num(m[1]), l ?? 0]);
  }
  // Čtyřhran „□40 x 100", „□40x40x100"
  m = s.match(new RegExp(`sq:${N}(?:\\s*x\\s*${N})?(?:\\s*(?:x|-|len:)\\s*${N})?`));
  if (m) {
    const a = num(m[1]);
    let l = len;
    if (m[3]) l = num(m[3]);
    else if (m[2] && Math.abs(num(m[2]) - a) > 1e-6) l = num(m[2]);
    return base("ctyrhran", { a, l }, [a, l ?? 0]);
  }
  // Kulatina „ø65x120", „ø65 len:120", stupňovitá „ø80 x ø50 x 100" → největší Ø.
  // Samostatné Ø vedle obrysu („250 x 120 x 45, Ø40", „tl. 10 – 250 x 400, 4× Ø12") je díra / prvek →
  // rozhoduje obrys / plech; kulatina jen při přímém zápisu „Ø × L" nebo se zadanou délkou.
  const tl = s.match(new RegExp(`tl:${N}`));
  const rest = s.replace(new RegExp(`tl:${N}`, "g"), " ");
  const three = rest.match(new RegExp(`(?<![ø\\d.])${N}\\s*x\\s*${N}\\s*x\\s*${N}`));
  const two = rest.match(new RegExp(`(?<![ø\\d.])${N}\\s*x\\s*${N}(?!\\s*x\\s*ø)`));
  const roundDirect = s.match(new RegExp(`ø${N}(?:\\s*x\\s*ø${N})*\\s*(?:x|-)\\s*${N}(?![\\d.])(?!\\s*x)`));
  const boxPattern = !!three;
  const tlPlate = !!tl && !!two;
  if (dias.length && (roundDirect || len !== undefined || (!boxPattern && !tlPlate))) {
    const d = Math.max(...dias);
    let l = len;
    if (l === undefined && roundDirect) l = num(roundDirect[roundDirect.length - 1]);
    if (l === undefined) {
      // jedno samostatné číslo mimo Ø = délka
      const others = [...s.replace(new RegExp(`ø${N}`, "g"), " ").matchAll(new RegExp(N, "g"))].map((x) => num(x[1])).filter((x) => x > 0);
      if (others.length === 1) l = others[0];
    }
    return base("kulatina", { d, l }, [d, l ?? 0]);
  }
  // Plech „tl. 10 – 250 x 400", „3 mm plech 200 x 300"
  if (tl) {
    const t = num(tl[1]);
    if (three) {
      const ds = [num(three[1]), num(three[2]), num(three[3])].sort((a, b) => b - a);
      return base("plech", { t, l: ds[0], w: ds[1] }, [ds[0], ds[1], t]);
    }
    if (two) {
      const ds = [num(two[1]), num(two[2])].sort((a, b) => b - a);
      return base("plech", { t, l: ds[0], w: ds[1] }, [ds[0], ds[1], t]);
    }
  }
  if (three) {
    const ds = [num(three[1]), num(three[2]), num(three[3])].sort((a, b) => b - a);
    const [l, w, h] = ds;
    if (h <= 3 || (sheetHint && h <= 25) || (h <= 6 && w >= 8 * h)) return base("plech", { t: h, l, w }, ds);
    return base("hranol", { l, w, h }, ds);
  }
  // Obalový kvádr ze 3 největších čísel
  const all = [...s.replace(/ø\d+(?:\.\d+)?/g, " ").matchAll(new RegExp(N, "g"))].map((x) => num(x[1])).filter((x) => x > 0);
  if (all.length >= 3) {
    const ds = [...all].sort((a, b) => b - a).slice(0, 3);
    return base("obalovy", { l: ds[0], w: ds[1], h: ds[2] }, ds);
  }
  return base("neurceno", {}, all);
}

// ═════════════════════════════════════════════════════════════════════════
// Polotovar a hmotnost
// ═════════════════════════════════════════════════════════════════════════

export type BlankShape = "kulatina" | "trubka" | "sestihran" | "ctyrhran" | "plocha_tyc" | "prirez" | "plech" | "odlitek";

export const BLANK_SHAPE_LABELS: Record<BlankShape, string> = {
  kulatina: "kulatina",
  trubka: "trubka",
  sestihran: "šestihran",
  ctyrhran: "čtyřhran",
  plocha_tyc: "plochá tyč",
  prirez: "přířez z desky",
  plech: "výpalek z plechu",
  odlitek: "odlitek",
};

export const PART_SHAPE_LABELS: Record<PartShape, string> = {
  kulatina: "rotační díl",
  trubka: "trubkový díl",
  sestihran: "šestihran",
  ctyrhran: "čtyřhran",
  hranol: "hranol",
  plech: "plechový díl",
  obalovy: "obalový kvádr",
  neurceno: "neurčeno",
};

export type WeightSource = "vykres" | "odhad" | "rucne";

export interface BlankDims {
  d?: number;
  dInner?: number;
  s?: number;
  a?: number;
  t?: number;
  l?: number;
  w?: number;
  h?: number;
}

export interface BlankEstimateInput {
  /** Text rozměrů dílu nebo už rozparsované rozměry. */
  dimensions?: string | ParsedDimensions | null;
  /**
   * Rozměr polotovaru, pokud je na výkrese zvlášť (pole „Polotovar" v razítku, hutní zápis).
   * Má přednost a nepřídavkuje se; `dimensions` pak slouží jen k odhadu hmotnosti dílu.
   */
  blankDimensions?: string | ParsedDimensions | null;
  materialGroup?: MaterialGroupKey | null;
  /** Hustota g/cm³ (jinak podle skupiny). */
  density?: number | null;
  /** Slovo do popisu („ocel", „mosaz"…). */
  densityLabel?: string | null;
  /** Hustota jen předpokládaná (materiál neurčen). */
  densityAssumed?: boolean;
  /** Hmotnost dílu z výkresu (kg), 0/null = neuvedeno. */
  drawingWeightKg?: number | null;
  /** Název dílu — pomůže poznat rotační díl („Hřídel", „Pouzdro"…). */
  title?: string | null;
  quantity?: number | null;
  /** Díl je odlitek (GX…, GS-…, ocelolitina, „odlitek" v textu) → polotovar ≈ díl / 0,85, bez tyče. */
  cast?: boolean;
}

export interface BlankEstimate {
  part: ParsedDimensions;
  blankShape: BlankShape | null;
  blankShapeLabel: string | null;
  blankDims: BlankDims | null;
  /** „Ø70 × 130", „130 × 85 × 35", „tl. 10 × 260 × 410", „tl. 25 × Ø310" (mm) */
  blankDimsText: string | null;
  blankVolumeCm3: number | null;
  /** Hmotnost polotovaru — vždy odhad. */
  blankWeightKg: number | null;
  /** × počet kusů. */
  totalBlankWeightKg: number | null;
  /** true = rozměr polotovaru převzat z výkresu (bez přídavků). */
  blankGiven: boolean;
  /** Hmotnost dílu: z výkresu, jinak hrubý odhad z obrysu. */
  partWeightKg: number | null;
  partWeightSource: WeightSource | null;
  partWeightRangeKg: [number, number] | null;
  /** Využití materiálu díl / polotovar (0–1). */
  utilization: number | null;
  density: number;
  densityLabel: string;
  /** „kulatina Ø70 × 130 mm ≈ 3,9 kg, ocel 7,85 g/cm³" */
  description: string;
  /** „díl ≈ 2,9 kg (odhad 2,1–3,4 kg)" / „díl 2,9 kg (výkres)" */
  partDescription: string;
  /** Jak se počítalo (přídavky, zaokrouhlení). */
  allowanceNote: string;
  warnings: string[];
}

const ROTATIONAL_TITLE = /\b(hridel\w*|cep\w*|kolik\w*|pouzdr\w*|valec\w*|valeck\w*|krouz\w*|kotouc\w*|prirub\w*|vreten\w*|osa|osicka|svornik\w*|matice|kladk\w*|kolo|kola|welle|bolzen|buchse|ring|flansch|scheibe|shaft|pin|bush\w*|sleeve|roller|disc|disk|flange|spindle|nut)\b/;

/** Fill factor obrysu → hrubá hmotnost dílu (střed, min, max). */
const FILL: Record<PartShape, [number, number, number]> = {
  kulatina: [0.75, 0.55, 0.9],
  trubka: [0.9, 0.8, 1.0],
  sestihran: [0.75, 0.55, 0.9],
  ctyrhran: [0.65, 0.4, 0.85],
  hranol: [0.65, 0.4, 0.85],
  plech: [0.8, 0.6, 0.95],
  obalovy: [0.5, 0.25, 0.75],
  neurceno: [0.5, 0.25, 0.75],
};

/** Typické využití materiálu, když známe jen hmotnost dílu (polotovar ≈ díl / 0,6). */
const UTILIZATION_FROM_PART = 0.6;

const HEX_AREA = Math.sqrt(3) / 2;

function round3(n: number): number {
  return Math.round(n * 1000) / 1000;
}

/** Česky: „3,9", „0,38", „125". */
export function formatKg(kg: number): string {
  const d = kg < 0.01 ? 3 : kg < 1 ? 2 : kg < 100 ? 1 : 0;
  const f = 10 ** d;
  return (Math.round(kg * f + 1e-9) / f).toFixed(d).replace(".", ",");
}

function fmtMm(n: number): string {
  return Number.isInteger(n) ? String(n) : String(Math.round(n * 10) / 10).replace(".", ",");
}

function fmtDensity(n: number): string {
  return n.toFixed(2).replace(".", ",");
}

/** Objem dílu (mm³) z obrysu — pro hrubý odhad hmotnosti dílu. */
function envelopeVolume(p: ParsedDimensions): number | null {
  switch (p.shape) {
    case "kulatina": return p.d && p.l ? (Math.PI / 4) * p.d ** 2 * p.l : null;
    case "trubka": return p.d && p.l && p.dInner !== undefined ? (Math.PI / 4) * (p.d ** 2 - p.dInner ** 2) * p.l : null;
    case "sestihran": return p.s && p.l ? HEX_AREA * p.s ** 2 * p.l : null;
    case "ctyrhran": return p.a && p.l ? p.a ** 2 * p.l : null;
    case "plech": return p.t && p.l && p.w ? p.t * p.l * p.w : null;
    case "hranol": case "obalovy": return p.l && p.w && p.h ? p.l * p.w * p.h : null;
    default: return null;
  }
}

/** Rotační díl zadaný 3 čísly („120 x 65 x 65" + název „Hřídel") → kulatina. */
function asRotational(p: ParsedDimensions, title: string | null | undefined): ParsedDimensions {
  if ((p.shape !== "hranol" && p.shape !== "obalovy") || !title || !ROTATIONAL_TITLE.test(fold(title))) return p;
  const [a, b, c] = p.dims;
  if (a === undefined || b === undefined || c === undefined) return p;
  const eq = (x: number, y: number) => Math.abs(x - y) <= Math.max(x, y) * 0.02;
  if (eq(b, c)) return { ...p, shape: "kulatina", d: b, l: a, w: undefined, h: undefined };
  if (eq(a, b)) return { ...p, shape: "kulatina", d: a, l: c, w: undefined, h: undefined };
  return p;
}

function toParsed(v: string | ParsedDimensions | null | undefined): ParsedDimensions {
  return typeof v === "object" && v !== null ? v : parseDimensionText(v ?? "");
}

/** Plech / deska: tloušťka (nad tl. 25 + přídavek na frézování) → běžná tloušťka. */
const PLATE_THICKNESS_SIZES = [...new Set([...SHEET_THICKNESS_SIZES, ...FLAT_THICKNESS_SIZES])].sort((a, b) => a - b);
function plateThickness(t: number): number {
  return t > PLATE_MILL_FROM_MM
    ? standardUp(t + PLATE_MILL_ALLOWANCE_MM, PLATE_THICKNESS_SIZES, 10)
    : standardUp(t, SHEET_THICKNESS_SIZES, 10);
}

interface BlankGeometry {
  shape: BlankShape;
  dims: BlankDims;
  text: string;
  volume: number; // mm³
}

/**
 * Odhad polotovaru a hmotnosti.
 *
 * Rozhodnutí:
 *  - kulatina: Ø + přídavek (2–12 mm dle Ø, min. 5 % Ø) → nahoru na běžný průměr tyče; délka L + 2× čelo
 *    + řez 2 mm (+10 mm na upnutí u krátkých dílů do Ø80) → nahoru na 5 mm. Nad Ø300 varování (výkovek).
 *  - kotouč / příruba (Ø ≥ 150, L ≤ 0,25·Ø): výpalek z plechu tl. L + 3 (do L 30, jinak + 5) → běžná
 *    tloušťka, Ø + 10 mm (u příruby s velkou dírou i díra − 10 mm).
 *  - trubka: vnější jako kulatina, vnitřní − přídavek (dolů na celé mm); malá díra (< 25 mm nebo < 0,4·Ø)
 *    → z plné kulatiny (díra se vrtá).
 *  - šestihran: nejbližší běžný šestihran ≥ s (plochy se neobrábí), délka jako kulatina.
 *  - hranol / obalový kvádr: každý rozměr + přídavek (3–10 mm); tloušťka → běžná tloušťka, šířka → běžná
 *    šířka ploché tyče (do 200 mm), jinak přířez z desky (nahoru na 5 mm).
 *  - plech: obrys + okraj dle řezu (laser 3 / plazma 5 / plamen 8–10 mm) → na 5 mm; tloušťka beze změny
 *    (běžná), nad tl. 25 + 3 mm na frézování.
 *  - rozměr už je polotovar (blankDimensions / „polotovar" / hutní zápis): bez přídavků, jen běžný rozměr.
 *  - slinutý karbid: polotovary jsou téměř na čisto → přídavek jen 1 mm (délka 2 mm), bez hutních tabulek.
 *  - odlitek: tyč se nepočítá, polotovar ≈ hmotnost dílu / 0,85.
 *  - hmotnost dílu: z výkresu má přednost; jinak hrubý odhad = objem obrysu × fill factor tvaru
 *    (kulatina 0,75, hranol 0,65, plech 0,8, obalový kvádr 0,5) s rozpětím — vždy označeno „odhad".
 *  - věrohodnost: rozměr nad 6 m nebo hmotnost nad 2 t se nezapisuje (jen varování).
 */
export function estimateBlank(input: BlankEstimateInput): BlankEstimate {
  const part = asRotational(toParsed(input.dimensions), input.title);
  const explicit = input.blankDimensions ? asRotational(toParsed(input.blankDimensions), input.title) : null;
  const explicitOk = !!explicit && explicit.shape !== "neurceno";
  /** Z čeho se počítá polotovar; given = rozměr už je polotovar. */
  const geo = explicitOk ? explicit! : part;
  const given = explicitOk || part.blankGiven;
  /** Obrys dílu pro odhad hmotnosti dílu (ne, když text rozměrů popisuje polotovar). */
  const partEnvelope = part.blankGiven ? null : part;

  const group = input.materialGroup ?? "ostatni";
  const meta = materialGroupMeta(group);
  const density = input.density && input.density > 0 ? input.density : meta.density;
  const densityLabel = input.densityLabel || meta.densityLabel;
  const nearNet = group === "slinuty_karbid" && !given;
  const cast = !!input.cast && !given;
  const warnings: string[] = [];
  const notes: string[] = [];
  if (input.densityAssumed || (!input.materialGroup && !input.density) || (group === "ostatni" && !input.density)) {
    warnings.push(`Materiál neurčen — počítáno s hustotou ${fmtDensity(density)} g/cm³.`);
  }

  const lengthFor = (l: number, d: number) => (given ? l : nearNet ? ceilTo(l + 2, 1) : barBlankLength(l, d));
  const diaFor = (d: number) => (given ? standardUp(d, ROUND_BAR_SIZES, 10)
    : nearNet ? ceilTo(d + 1, 0.5) : standardUp(d + roundAllowance(d), ROUND_BAR_SIZES, d > 600 ? 50 : 10));
  const lengthNote = (l: number, d: number) => (given ? "délka dle výkresu" : nearNet ? "délka +2 mm" : `délka +${fmtMm(2 * faceAllowance(d) + CUT_TOLERANCE_MM + gripAllowance(l, d))} mm (čela 2× ${fmtMm(faceAllowance(d))}, řez ${CUT_TOLERANCE_MM}${gripAllowance(l, d) ? `, upnutí ${GRIP_ALLOWANCE_MM}` : ""}) → na 5 mm`);
  const missingLength = () => warnings.push("Chybí délka — hmotnost polotovaru nelze spočítat.");

  let g: BlankGeometry | null = null;

  if (cast) {
    notes.push(`odlitek: polotovar ≈ hmotnost dílu / ${String(CASTING_UTILIZATION).replace(".", ",")}`);
  } else {
    switch (geo.shape) {
      case "kulatina":
      case "trubka": {
        if (!geo.d) break;
        if (!geo.l) { missingLength(); break; }
        const disc = !given && !nearNet && geo.d >= DISC_MIN_DIAMETER_MM && geo.l <= DISC_MAX_RATIO * geo.d;
        if (disc) {
          // Kotouč / příruba → výpalek z plechu
          const t = standardUp(geo.l + (geo.l <= 30 ? 3 : 5), PLATE_THICKNESS_SIZES, 10);
          const D = ceilTo(geo.d + 10, 5);
          const ring = geo.shape === "trubka" && geo.dInner !== undefined && geo.dInner >= 100;
          const di = ring && geo.dInner !== undefined ? Math.max(0, Math.floor(geo.dInner - 10)) : 0;
          g = {
            shape: "plech",
            dims: ring ? { d: D, dInner: di, t } : { d: D, t },
            text: ring ? `tl. ${fmtMm(t)} × Ø${fmtMm(D)}/Ø${fmtMm(di)}` : `tl. ${fmtMm(t)} × Ø${fmtMm(D)}`,
            volume: (Math.PI / 4) * (D ** 2 - di ** 2) * t,
          };
          notes.push(`kotouč (L ≤ ${String(DISC_MAX_RATIO).replace(".", ",")}·Ø) → výpalek z plechu tl. ${fmtMm(t)}, Ø +10 mm${ring ? ", díra −10 mm" : ""}`);
          break;
        }
        const D = diaFor(geo.d);
        const L = lengthFor(geo.l, geo.d);
        const bore = geo.shape === "trubka" && geo.dInner !== undefined && (given || (geo.dInner >= 25 && geo.dInner >= 0.4 * geo.d));
        if (bore && geo.dInner !== undefined) {
          let di = given ? geo.dInner : Math.max(0, Math.floor(geo.dInner - (nearNet ? 1 : roundAllowance(geo.dInner))));
          if (!given) di = Math.min(di, D - 6);
          g = { shape: "trubka", dims: { d: D, dInner: di, l: L }, text: `Ø${fmtMm(D)}/Ø${fmtMm(di)} × ${fmtMm(L)}`, volume: (Math.PI / 4) * (D ** 2 - di ** 2) * L };
          notes.push(given ? "rozměr polotovaru dle výkresu" : nearNet ? "Ø +1 mm" : `Ø +${roundAllowance(geo.d)} mm → běžná tyč Ø${fmtMm(D)}, díra −${roundAllowance(geo.dInner)} mm`);
        } else {
          g = { shape: "kulatina", dims: { d: D, l: L }, text: `Ø${fmtMm(D)} × ${fmtMm(L)}`, volume: (Math.PI / 4) * D ** 2 * L };
          notes.push(given ? `rozměr polotovaru dle výkresu${D !== geo.d ? ` (běžná tyč Ø${fmtMm(D)})` : ""}` : nearNet ? "Ø +1 mm" : `Ø +${roundAllowance(geo.d)} mm → běžná tyč Ø${fmtMm(D)}`);
          if (geo.shape === "trubka" && !given) notes.push("díra malá → z plné kulatiny (vrtá se)");
        }
        if (!nearNet && D > MAX_STOCK_BAR_MM) warnings.push(`Kulatina Ø${fmtMm(D)} se běžně neskladuje (nad Ø${MAX_STOCK_BAR_MM}) — spíš výkovek, ověř dostupnost.`);
        notes.push(lengthNote(geo.l, geo.d));
        break;
      }
      case "sestihran": {
        if (!geo.s) break;
        if (!geo.l) { missingLength(); break; }
        const s = nearNet ? ceilTo(geo.s + 1, 0.5) : standardUp(geo.s, HEX_SIZES, 5);
        const L = lengthFor(geo.l, geo.s);
        g = { shape: "sestihran", dims: { s, l: L }, text: `6hr ${fmtMm(s)} × ${fmtMm(L)}`, volume: HEX_AREA * s ** 2 * L };
        notes.push(`šestihran ${fmtMm(s)} (běžný rozměr ≥ ${fmtMm(geo.s)})`, lengthNote(geo.l, geo.s));
        break;
      }
      case "ctyrhran": {
        if (!geo.a) break;
        if (!geo.l) { missingLength(); break; }
        const a = given ? standardUp(geo.a, SQUARE_SIZES, 10) : nearNet ? ceilTo(geo.a + 1, 0.5) : standardUp(geo.a + prismAllowance(geo.a), SQUARE_SIZES, 10);
        const L = lengthFor(geo.l, geo.a);
        g = { shape: "ctyrhran", dims: { a, l: L }, text: `□${fmtMm(a)} × ${fmtMm(L)}`, volume: a ** 2 * L };
        notes.push(given ? "rozměr polotovaru dle výkresu" : `strana +${prismAllowance(geo.a)} mm → □${fmtMm(a)}`, lengthNote(geo.l, geo.a));
        break;
      }
      case "plech": {
        if (!geo.t || !geo.l || !geo.w) break;
        if (given) {
          const t = standardUp(geo.t, SHEET_THICKNESS_SIZES, 10);
          g = { shape: "plech", dims: { t, l: geo.l, w: geo.w }, text: `tl. ${fmtMm(t)} × ${fmtMm(geo.w)} × ${fmtMm(geo.l)}`, volume: t * geo.l * geo.w };
          notes.push("rozměr přířezu plechu dle výkresu");
          break;
        }
        const t = plateThickness(geo.t);
        const margin = sheetMargin(geo.t);
        const L = ceilTo(geo.l + 2 * margin, 5);
        const W = ceilTo(geo.w + 2 * margin, 5);
        g = { shape: "plech", dims: { t, l: L, w: W }, text: `tl. ${fmtMm(t)} × ${fmtMm(W)} × ${fmtMm(L)}`, volume: t * L * W };
        const how = geo.t <= 12 ? "laser" : geo.t <= 30 ? "plazma" : "plamen";
        notes.push(`plech tl. ${fmtMm(t)}${t !== geo.t && geo.t > PLATE_MILL_FROM_MM ? ` (tl. ${fmtMm(geo.t)} + ${PLATE_MILL_ALLOWANCE_MM} mm na frézování)` : ""}, obrys + ${fmtMm(margin)} mm na stranu (${how}) → na 5 mm (obdélník bez otvorů)`);
        break;
      }
      case "hranol":
      case "obalovy": {
        if (!geo.l || !geo.w || !geo.h) break;
        if (geo.shape === "obalovy" && !given) warnings.push("Tvar neurčen — polotovar odhadnut z obalového kvádru 3 největších rozměrů.");
        if (nearNet) {
          const H = ceilTo(geo.h + 1, 0.5), W = ceilTo(geo.w + 1, 0.5), L = ceilTo(geo.l + 1, 0.5);
          g = { shape: "prirez", dims: { l: L, w: W, h: H }, text: `${fmtMm(L)} × ${fmtMm(W)} × ${fmtMm(H)}`, volume: L * W * H };
          notes.push("slinutý karbid: přídavek 1 mm na rozměr");
          break;
        }
        let H: number, W: number, L: number;
        if (given) {
          H = geo.h; W = geo.w; L = geo.l;
          notes.push("rozměr polotovaru dle výkresu");
        } else {
          H = standardUp(geo.h + prismAllowance(geo.h), FLAT_THICKNESS_SIZES, 10);
          const wRaw = geo.w + prismAllowance(geo.w);
          W = wRaw <= 200 ? standardUp(wRaw, FLAT_WIDTH_SIZES, 5) : ceilTo(wRaw, 5);
          L = ceilTo(geo.l + prismAllowance(geo.l), 5);
        }
        const square = Math.abs(geo.w - geo.h) <= Math.max(geo.w, geo.h) * 0.02;
        if (square && W <= 200) {
          const a = given ? Math.max(W, H) : standardUp(Math.max(geo.w, geo.h) + prismAllowance(Math.max(geo.w, geo.h)), SQUARE_SIZES, 10);
          g = { shape: "ctyrhran", dims: { a, l: L }, text: `□${fmtMm(a)} × ${fmtMm(L)}`, volume: a * a * L };
        } else {
          const shape: BlankShape = W <= 200 && H <= 100 ? "plocha_tyc" : "prirez";
          g = { shape, dims: { l: L, w: W, h: H }, text: `${fmtMm(L)} × ${fmtMm(W)} × ${fmtMm(H)}`, volume: L * W * H };
        }
        if (!given) notes.push(`přídavky ${prismAllowance(geo.l)}/${prismAllowance(geo.w)}/${prismAllowance(geo.h)} mm (D/Š/V) → běžné rozměry ${g.shape === "prirez" ? "desky" : "tyče"}`);
        break;
      }
      default:
        break;
    }
  }

  // Věrohodnost rozměru (např. číslo normy vzaté jako rozměr)
  if (g && Math.max(...Object.values(g.dims).filter((x): x is number => typeof x === "number")) > MAX_PLAUSIBLE_DIM_MM) {
    warnings.push(`Rozměr polotovaru ${g.text} mm je nad ${MAX_PLAUSIBLE_DIM_MM / 1000} m — nevěrohodné, nezapisuji. Zkontroluj rozměry.`);
    g = null;
  }

  // Hmotnost dílu: výkres > hrubý odhad z obrysu
  const drawingKg = input.drawingWeightKg && input.drawingWeightKg > 0 ? input.drawingWeightKg : null;
  let partWeightKg: number | null = drawingKg;
  let partWeightSource: WeightSource | null = drawingKg ? "vykres" : null;
  let partWeightRangeKg: [number, number] | null = null;
  const env = partEnvelope ? envelopeVolume(partEnvelope) : null;
  if (!drawingKg && env && partEnvelope && Math.max(...partEnvelope.dims) <= MAX_PLAUSIBLE_DIM_MM) {
    const [mid, lo, hi] = FILL[partEnvelope.shape];
    // odlitek: obrys je bližší tvaru (bez obrábění z plna) — stejný fill factor, rozpětí ponecháno
    partWeightKg = round3((env * mid * density) / 1e6);
    partWeightRangeKg = [round3((env * lo * density) / 1e6), round3((env * hi * density) / 1e6)];
    partWeightSource = "odhad";
    if (partWeightKg > MAX_PLAUSIBLE_KG) {
      warnings.push(`Odhad hmotnosti dílu ${formatKg(partWeightKg)} kg je nad ${MAX_PLAUSIBLE_KG / 1000} t — nezapisuji, zkontroluj rozměry.`);
      partWeightKg = null; partWeightRangeKg = null; partWeightSource = null;
    }
  }

  let blankWeightKg = g ? round3((g.volume * density) / 1e6) : null;
  if (cast) {
    if (partWeightKg) blankWeightKg = round3(partWeightKg / CASTING_UTILIZATION);
    else warnings.push("Odlitek bez rozměrů i hmotnosti — polotovar nelze odhadnout.");
  } else if (!blankWeightKg && drawingKg) {
    // Jen hmotnost z výkresu, bez rozměrů → polotovar ≈ díl / typické využití
    blankWeightKg = round3(drawingKg / UTILIZATION_FROM_PART);
    notes.push(`polotovar ≈ hmotnost dílu / ${String(UTILIZATION_FROM_PART).replace(".", ",")} (rozměry chybí)`);
    warnings.push("Rozměry chybí — polotovar odhadnut jen z hmotnosti dílu.");
  }
  if (!blankWeightKg && !drawingKg && geo.shape === "neurceno" && !cast) {
    warnings.push("Z rozměrů nelze určit tvar ani polotovar — doplň rozměry (např. „Ø65 x 120“ nebo „120 x 80 x 30“).");
  }
  if (blankWeightKg && blankWeightKg > MAX_PLAUSIBLE_KG) {
    warnings.push(`Odhad polotovaru ${formatKg(blankWeightKg)} kg je nad ${MAX_PLAUSIBLE_KG / 1000} t — nevěrohodné, nezapisuji. Zkontroluj rozměry a jednotky.`);
    blankWeightKg = null;
    g = null;
  }
  if (!cast && group === "litina" && g) {
    warnings.push("Litina: počítáno jako kontislitá tyč / deska — je-li díl odlitek, polotovar ≈ díl / 0,85.");
  }

  if (drawingKg && g && blankWeightKg) {
    if (drawingKg > blankWeightKg * 1.05) warnings.push(`Hmotnost z výkresu (${formatKg(drawingKg)} kg) je větší než odhad polotovaru — zkontroluj rozměry, materiál nebo jednotky.`);
    else if (drawingKg < blankWeightKg * 0.03) warnings.push(`Hmotnost z výkresu (${formatKg(drawingKg)} kg) je velmi malá vůči polotovaru — nejsou to gramy?`);
  }

  const utilization = partWeightKg && blankWeightKg ? Math.min(1, Math.round((partWeightKg / blankWeightKg) * 100) / 100) : null;
  const qty = input.quantity && input.quantity > 0 ? input.quantity : null;
  const totalBlankWeightKg = blankWeightKg && qty ? round3(blankWeightKg * qty) : null;

  const shape: BlankShape | null = cast && blankWeightKg ? "odlitek" : g?.shape ?? null;
  const shapeLabel = shape ? BLANK_SHAPE_LABELS[shape] : null;
  const description = blankWeightKg
    ? g
      ? `${shapeLabel} ${g.shape === "sestihran" ? g.text.replace(/^6hr\s/, "") : g.text} mm ≈ ${formatKg(blankWeightKg)} kg, ${densityLabel} ${fmtDensity(density)} g/cm³${given ? " (rozměr polotovaru z výkresu)" : ""}`
      : cast
        ? `odlitek ≈ ${formatKg(blankWeightKg)} kg (díl / ${String(CASTING_UTILIZATION).replace(".", ",")})`
        : `polotovar ≈ ${formatKg(blankWeightKg)} kg (odhad z hmotnosti dílu)`
    : "";
  const partDescription = partWeightKg
    ? partWeightSource === "vykres"
      ? `díl ${formatKg(partWeightKg)} kg (výkres)`
      : `díl ≈ ${formatKg(partWeightKg)} kg (odhad ${partWeightRangeKg ? `${formatKg(partWeightRangeKg[0])}–${formatKg(partWeightRangeKg[1])} kg` : ""})`
    : "";

  return {
    part,
    blankShape: shape,
    blankShapeLabel: shapeLabel,
    blankDims: g?.dims ?? null,
    blankDimsText: g?.text ?? null,
    blankVolumeCm3: g ? round3(g.volume / 1000) : null,
    blankWeightKg,
    totalBlankWeightKg,
    blankGiven: given && !!g,
    partWeightKg,
    partWeightSource,
    partWeightRangeKg,
    utilization,
    density,
    densityLabel,
    description,
    partDescription,
    allowanceNote: notes.join("; "),
    warnings,
  };
}

// ═════════════════════════════════════════════════════════════════════════
// Vše z výkresu dohromady → sloupce DB (drawings / order_items)
// ═════════════════════════════════════════════════════════════════════════

/** Kompatibilní s DrawingExtract (capture-batch-types) — stačí předat vytěžený výkres. */
export interface DrawingMaterialInput {
  material?: string | null;
  /** Skupina navržená AI (klíč nebo volný text) — jen záloha. */
  materialGroup?: string | null;
  /** Rozměry dílu (obrys). */
  dimensions?: string | null;
  /** Rozměr polotovaru, je-li na výkrese zvlášť (pole „Polotovar") — nepřídavkuje se. */
  blankDimensions?: string | null;
  weightKg?: number | null;
  heatTreatment?: string | null;
  surfaceTreatment?: string | null;
  notes?: string | null;
  title?: string | null;
  quantity?: number | null;
  /** Hustota g/cm³ z katalogu materiálů (tabulka materials) — má přednost před skupinou. */
  densityOverride?: number | null;
}

/** Nové sloupce (migrace 20261023130000_vykres_material_hmotnost) na drawings i order_items. */
export interface DrawingMaterialColumns {
  material_group: MaterialGroupKey | null;
  material_designation: string | null;
  /** Stav dodání materiálu (+QT, +A, T6, ČSN .7…) — není operace TZ. */
  material_condition: string | null;
  weight_kg: number | null;
  blank_weight_kg: number | null;
  blank_dims: string | null;
  blank_shape: BlankShape | null;
  heat_treatment: string | null;
  surface_treatment: string | null;
  hardness: string | null;
  drawing_notes: string | null;
  weight_source: WeightSource | null;
}

export interface DrawingMaterialAnalysis {
  material: MaterialClassification;
  treatments: ParsedTreatments;
  blank: BlankEstimate;
  columns: DrawingMaterialColumns;
  /** „Nástrojová ocel (1.2379) · kalení 58-60 HRC · kulatina Ø70 × 130 mm ≈ 3,9 kg" */
  summary: string;
}

const STEEL_GROUPS: MaterialGroupKey[] = ["bezna_ocel", "zuslechtena_ocel", "nastrojova_ocel", "nerez", "duplex"];

/**
 * Z textu MATERIÁLU se berou jen operace (cementace, nitridace, kalení…), ne stav dodání:
 * +QT / zušlechtěno, +A / +N, T6, popuštěno… jsou stav, ve kterém se materiál kupuje (material_condition).
 */
const MATERIAL_TEXT_HEAT_OPS: HeatKind[] = ["kaleni", "indukcni_kaleni", "cementace", "karbonitridace", "nitridace", "nitrocementace", "hlubokozmrazeni"];

/** Slovo do popisu hmotnosti: u ocelí skupina („nástrojová ocel"), jinak podskupina („mosaz", „PTFE"). */
function densityWord(m: MaterialClassification): string {
  if (!m.subgroup || STEEL_GROUPS.includes(m.group)) return materialGroupMeta(m.group).densityLabel;
  return m.subgroup.label.replace(/\s*\(.*\)\s*$/, "");
}

const clip = (s: string | null | undefined): string | null => {
  const v = (s ?? "").trim();
  return v ? v : null;
};

const CAST_WORD = /\bodlit\w*|\bodlitk\w*|\bgussteil\w*|\bguss\b|\bcasting\w*|\bslevar\w*/;

export function analyzeDrawingMaterial(input: DrawingMaterialInput): DrawingMaterialAnalysis {
  const material = classifyMaterial(input.material ?? "", input.materialGroup ?? null);
  // TZ + PÚ + poznámky — oddělovač „ | " drží úseky od sebe; materiál zvlášť (jen operace, viz výše)
  const treatmentText = [input.heatTreatment, input.surfaceTreatment, input.notes]
    .map((x) => (x ?? "").trim()).filter(Boolean).join(" | ");
  const fromFields = parseTreatments(treatmentText);
  const fromMaterial = parseTreatments(input.material ?? "").heat
    .filter((h) => MATERIAL_TEXT_HEAT_OPS.includes(h.kind) && !h.inferred);
  const treatments: ParsedTreatments = {
    heat: [...fromFields.heat, ...fromMaterial.filter((h) => !fromFields.heat.some((x) => x.kind === h.kind))],
    surface: fromFields.surface,
    hardness: fromFields.hardness,
  };
  const known = material.group !== "ostatni" || material.subgroup !== null;
  const castText = fold([input.title, input.notes, input.dimensions].filter(Boolean).join(" "));
  const cast = material.cast || material.subgroup?.key === "ocelolitina" || CAST_WORD.test(castText);
  const override = input.densityOverride && input.densityOverride > 0 ? input.densityOverride : null;
  const blank = estimateBlank({
    dimensions: input.dimensions ?? "",
    blankDimensions: input.blankDimensions ?? null,
    materialGroup: material.group,
    density: override ?? material.density,
    densityLabel: densityWord(material),
    densityAssumed: !override && (!known || material.densityAssumed),
    drawingWeightKg: input.weightKg ?? null,
    title: input.title ?? null,
    quantity: input.quantity ?? null,
    cast,
  });

  const heatText = clip(input.heatTreatment) ?? clip(formatHeatTreatments(treatments.heat));
  const surfaceText = clip(input.surfaceTreatment) ?? clip(formatSurfaceTreatments(treatments.surface));
  const hardness = treatments.heat.find((h) => h.hardness)?.hardness ?? material.hardness ?? treatments.hardness[0] ?? null;

  const columns: DrawingMaterialColumns = {
    material_group: known || clip(input.material) ? material.group : null,
    material_designation: clip(material.normalizedDesignation) ?? clip(input.material),
    material_condition: material.condition,
    weight_kg: blank.partWeightKg,
    blank_weight_kg: blank.blankWeightKg,
    blank_dims: blank.blankDimsText ? `${blank.blankDimsText} mm` : null,
    blank_shape: blank.blankShape,
    heat_treatment: heatText,
    surface_treatment: surfaceText,
    hardness,
    drawing_notes: clip(input.notes),
    weight_source: blank.partWeightSource,
  };

  const meta = materialGroupMeta(material.group);
  const parts: string[] = [];
  if (known) parts.push(material.normalizedDesignation ? `${meta.label} (${material.normalizedDesignation})` : meta.label);
  if (material.condition) parts.push(`stav ${material.condition}`);
  if (treatments.heat.length) parts.push(formatHeatTreatments(treatments.heat));
  if (treatments.surface.length) parts.push(formatSurfaceTreatments(treatments.surface));
  if (blank.description) parts.push(blank.description);
  if (blank.partDescription) parts.push(blank.partDescription);

  return { material, treatments, blank, columns, summary: parts.join(" · ") };
}
