/**
 * Razítko výkresu (ČSN EN ISO 7200) – šablony, pole, nepředepsané tolerance a vykreslení do geometrie listu.
 *
 * Čistý modul bez jádra a bez Reactu (testovatelný v Node): `drawTitleBlock` přidá do `polys` / `texts` listu rám
 * razítka, buňky s popisky a hodnotami, značku promítání ISO 5456-2 a logo (obrázek jako `Poly.img` – SVG / PDF ho
 * vloží jako bitmapu, DXF / DWG jako vektorový obrys z `TitleLogo.trace`). Žádné pole se nezkracuje: dlouhý text se
 * zmenší (do 2 mm), zalomí do více řádků uvnitř buňky a teprve potom zmenší dál; výsledek každého pole je v
 * `TitleBlockInfo.fields` (velikost písma, počet řádků) – agent tak textem ověří, že se vše vešlo.
 *
 * Šablony (všechny široké 180 mm, aby kusovník a tabulka děr nad razítkem zůstaly stejné):
 * - `iso7200` (výchozí, 180 × 38): firma / logo, promítání, název, číslo, materiál, schválil, měřítko, formát,
 *   hmotnost, kreslil, datum, revize;
 * - `compact` (180 × 27): pro malé listy a další listy výkresu;
 * - `toolmaker` – nástrojářská (180 × 64): všechna pole (zákazník, projekt, polotovar, počet kusů, tepelné a povrchové
 *   zpracování, nepředepsané tolerance délek / úhlů / sražení, hrany, kreslil / kontroloval / schválil, list).
 * Pole, která šablona nemá, se vypíšou v patičce nad razítkem („Zákazník: …“) – nic se tiše neztratí.
 */
import { cadLocale, tr } from "./i18n";
import type { DText, DrawingMeta, Poly, RevisionItem } from "./drawing";
import type { Vec2 } from "./types";

// ---------------------------------------------------------------- typy

export type TitleTemplate = "iso7200" | "compact" | "toolmaker";
export const TITLE_TEMPLATES: TitleTemplate[] = ["iso7200", "compact", "toolmaker"];

/** Logo do razítka: obrázek (data URL PNG / JPEG), rozměr v px a vektorový obrys pro DXF / DWG. */
export type TitleLogo = {
  src: string;
  w: number;
  h: number;
  name?: string;
  /** obrys pro DXF / DWG: mřížka `cols × rows`, obdélníky [c0, r0, c1, r1] (v buňkách mřížky, r dolů), barva inkoustu */
  trace?: LogoTrace;
};
export type LogoTrace = { cols: number; rows: number; color: string; rects: number[] };

/** Obrázek na listu (logo): obdélník v mm listu, zdroj a obrys. */
export type SheetImage = { x: number; y: number; w: number; h: number; src: string; trace?: LogoTrace };

/** Nepředepsané tolerance: třída ISO 2768-1 (délky f/m/c/v) + ISO 2768-2 (geometrie H/K/L), tabulka podle desetinných míst, nebo volný text. */
export type GeneralTol =
  | { kind: "iso2768"; lin: "f" | "m" | "c" | "v"; geo?: "H" | "K" | "L" }
  | { kind: "decimals"; rows: string[] }
  | { kind: "text"; text: string };

/** Pole razítka (klíč v `DrawingDoc.meta` / DrawingMeta). */
export type TitleFieldKey =
  | "name" | "number" | "author" | "checkedBy" | "approvedBy" | "revision" | "date" | "material" | "stock" | "quantity"
  | "heatTreatment" | "surfaceTreatment" | "tolerance" | "angleTol" | "chamferTol" | "edges" | "customer" | "project"
  | "company" | "note";

/** Buňka šablony: pole razítka nebo údaj listu (firma / logo, promítání, měřítko, formát, hmotnost, list). */
type CellKey = Exclude<TitleFieldKey, "note" | "company"> | "brand" | "projection" | "scale" | "format" | "mass" | "sheet";
type Cell = { k: CellKey; x: number; y: number; w: number; h: number; size?: number; bold?: boolean };
type TemplateDef = { w: number; h: number; cells: Cell[] };

/** výsledek jednoho pole na listu – velikost písma [mm], počet řádků, zmenšeno pod nominální velikost */
export type TitleFieldFit = {
  key: string;
  label: string;
  value: string;
  size: number;
  lines: number;
  shrunk: boolean;
  small: boolean;
  where: "cell" | "footer";
  /** buňka pole na listu [mm] a vykreslené řádky (ověření, že se text vešel celý) */
  cell?: { x: number; y: number; w: number; h: number };
  rows?: string[];
};
/** Razítko na listu – pro stav výkresu a testy (všechno v mm listu, y dolů). */
export type TitleBlockInfo = {
  template: TitleTemplate;
  x: number;
  y: number;
  w: number;
  h: number;
  projection: "E" | "A";
  logo?: { x: number; y: number; w: number; h: number; name?: string };
  /** výška tabulek nad razítkem [mm] (kusovník, tabulka děr) – s razítkem tvoří jednu překážku pro kóty */
  above?: number;
  generalTol: string;
  fields: TitleFieldFit[];
  footer: string[];
};

// ---------------------------------------------------------------- šablony

const T = (k: CellKey, x: number, y: number, w: number, h: number, size?: number, bold?: boolean): Cell => ({ k, x, y, w, h, size, bold });

const TEMPLATES: Record<TitleTemplate, TemplateDef> = {
  // ČSN EN ISO 7200: vlastník (firma), číslo, revize, datum, název, schválil, autor (kreslil); + materiál, měřítko, formát, hmotnost
  iso7200: {
    w: 180,
    h: 38,
    cells: [
      T("brand", 0, 0, 55, 21),
      T("projection", 0, 21, 55, 17),
      T("name", 55, 0, 125, 13, 4.2, true),
      T("number", 55, 13, 55, 12.5, 3.4, true),
      T("material", 110, 13, 40, 12.5),
      T("approvedBy", 150, 13, 30, 12.5),
      T("scale", 55, 25.5, 20, 12.5, 3.2, true),
      T("format", 75, 25.5, 17, 12.5),
      T("mass", 92, 25.5, 25, 12.5),
      T("author", 117, 25.5, 28, 12.5),
      T("date", 145, 25.5, 21, 12.5, 2.8),
      T("revision", 166, 25.5, 14, 12.5),
    ],
  },
  compact: {
    w: 180,
    h: 27,
    cells: [
      T("brand", 0, 0, 40, 14),
      T("projection", 0, 14, 40, 13),
      T("name", 40, 0, 88, 13.5, 3.8, true),
      T("number", 128, 0, 52, 13.5, 3.2, true),
      T("material", 40, 13.5, 36, 13.5),
      T("scale", 76, 13.5, 16, 13.5, 3.2, true),
      T("author", 92, 13.5, 28, 13.5),
      T("date", 120, 13.5, 22, 13.5, 2.8),
      T("revision", 142, 13.5, 14, 13.5),
      T("sheet", 156, 13.5, 24, 13.5),
    ],
  },
  toolmaker: {
    w: 180,
    h: 64,
    cells: [
      T("brand", 0, 0, 45, 21),
      T("projection", 0, 21, 45, 12),
      T("scale", 0, 33, 22.5, 10.5, 3.2, true),
      T("format", 22.5, 33, 22.5, 10.5),
      T("mass", 0, 43.5, 45, 10.5),
      T("sheet", 0, 54, 45, 10),
      T("name", 45, 0, 90, 12, 4.2, true),
      T("number", 135, 0, 45, 12, 3.4, true),
      T("customer", 45, 12, 55, 10),
      T("project", 100, 12, 55, 10),
      T("revision", 155, 12, 25, 10, 3.2, true),
      T("material", 45, 22, 50, 10),
      T("stock", 95, 22, 50, 10),
      T("quantity", 145, 22, 35, 10, 3.2, true),
      T("heatTreatment", 45, 32, 67.5, 10),
      T("surfaceTreatment", 112.5, 32, 67.5, 10),
      T("tolerance", 45, 42, 55, 12),
      T("angleTol", 100, 42, 27, 12),
      T("chamferTol", 127, 42, 27, 12),
      T("edges", 154, 42, 26, 12),
      T("author", 45, 54, 34, 10),
      T("checkedBy", 79, 54, 34, 10),
      T("approvedBy", 113, 54, 34, 10),
      T("date", 147, 54, 33, 10, 2.8),
    ],
  },
};

/** šablona razítka listu (neznámá / chybějící = výchozí ISO 7200) */
export const titleTemplateOf = (meta: Pick<DrawingMeta, "template"> | undefined): TitleTemplate => (meta?.template && meta.template in TEMPLATES ? meta.template : "iso7200");
/** rozměr razítka listu [mm] podle šablony */
export const titleBlockSize = (meta: Pick<DrawingMeta, "template"> | undefined): { w: number; h: number } => {
  const t = TEMPLATES[titleTemplateOf(meta)];
  return { w: t.w, h: t.h };
};
/** pole, která šablona zobrazuje v buňkách (ostatní jdou do patičky) */
export const templateKeys = (t: TitleTemplate): string[] => TEMPLATES[t].cells.map((c) => c.k);

/** název šablony pro protokol a UI */
export const templateLabel = (t: TitleTemplate): string => (t === "compact" ? tr("kompaktní") : t === "toolmaker" ? tr("nástrojářská (všechna pole)") : tr("ISO 7200 (výchozí)"));

const fold = (s: string) => s.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/ß/g, "ss").replace(/[\s_.-]+/g, "");
const TEMPLATE_W: Record<string, TitleTemplate> = {
  iso7200: "iso7200", iso: "iso7200", "7200": "iso7200", csneniso7200: "iso7200", eniso7200: "iso7200", vychozi: "iso7200", default: "iso7200", standard: "iso7200", standardni: "iso7200", norm: "iso7200", normal: "iso7200",
  kompaktni: "compact", kompakt: "compact", compact: "compact", male: "compact", mala: "compact", small: "compact", klein: "compact", zkracene: "compact", reduced: "compact", reduziert: "compact",
  nastrojarska: "toolmaker", nastrojarske: "toolmaker", nastrojarna: "toolmaker", toolmaker: "toolmaker", tooling: "toolmaker", tool: "toolmaker", toolshop: "toolmaker", werkzeugbau: "toolmaker", werkzeugmacher: "toolmaker", uplna: "toolmaker", uplne: "toolmaker", full: "toolmaker", vollstandig: "toolmaker", vollstaendig: "toolmaker",
};
/** šablona z textu (cs / en / de, bez diakritiky) – null = neznámé slovo */
export const parseTemplate = (s: string): TitleTemplate | null => TEMPLATE_W[fold(s)] ?? null;

// ---------------------------------------------------------------- nepředepsané tolerance

/** výchozí tabulka podle počtu desetinných míst (X. / X.X / X.XX / X.XXX) – jako ve výkresech nástrojáren */
export const DEFAULT_DECIMALS = ["±0,1", "±0,1", "±0,01", "±0,005"];
const DEC_LABEL = ["X.", "X.X", "X.XX", "X.XXX"];
const NONE_W = new Set(["ne", "no", "nein", "none", "zadne", "zadna", "keine", "kein", "zrusit", "clear", "loschen", "loeschen", "-", "—", "–"]);
const DEC_W = new Set(["desetinna", "desetinne", "desetinnamista", "desetinnych", "podledesetinnych", "decimal", "decimals", "decimalplaces", "dezimal", "dezimalen", "dezimalstellen", "nachkommastellen", "tabulka", "table", "tabelle", "stellen"]);

/** popisek řádku tabulky (X. = 0, X.X = 1 …) nebo null */
const decLabel = (w: string): number | null => {
  const m = /^x\.(x*)$/i.exec(w) ?? /^x(x*)[=:]$/i.exec(w) ?? /^x\.(x*)[=:]$/i.exec(w);
  return m ? m[1].length : null;
};

/** Řádky tabulky podle desetinných míst ze zápisu „±0,1 ±0,1 ±0,01 ±0,005“, „X. ±0,1 / X.X ±0,1 …“ nebo „X.XX=±0,02“. */
function decimalRows(body: string): string[] {
  const rows = [...DEFAULT_DECIMALS];
  // +/- a +- = ±; nesouměrná úchylka „+0,1/-0,2“ zůstane jedním údajem, jinak · • / ; | oddělují řádky
  const norm = body
    .replace(/\+\s*\/\s*-|\+-/g, "±")
    .replace(/(\+\s*\d[\d.,]*)\s*\/\s*([-−]\s*\d)/g, "$1\u0001$2")
    .replace(/[·•/;|]/g, " ")
    .replace(/\u0001/g, "/")
    .replace(/±\s+/g, "±");
  let i = 0;
  let pending: number | null = null;
  for (const w0 of norm.split(/\s+/)) {
    const w = w0.replace(/,+$/, "");
    if (!w || w === "=" || w === ":") continue;
    const lab = decLabel(w);
    if (lab !== null) {
      if (lab > 3) throw new Error(tr("nepředepsané desetinná: nejvýš 3 desetinná místa (X.XXX)"));
      pending = lab;
      continue;
    }
    const m = /^(?:x\.?(x*)|([0-3]))\s*[=:]\s*(.+)$/i.exec(w);
    const val = m ? m[3] : w;
    if (!/^[±+\-−]?\d/.test(val)) throw new Error(tr("nepředepsané desetinná: čekám tolerance, např. desetinná ±0,1 ±0,1 ±0,01 ±0,005 nebo X.=±0,1 X.XX=±0,01 – „{0}“", w0));
    const idx = m ? (m[2] !== undefined ? Number(m[2]) : (m[1] ?? "").length) : (pending ?? i);
    if (idx > 3) throw new Error(tr("nepředepsané desetinná: nejvýš 3 desetinná místa (X.XXX)"));
    rows[idx] = /^\d/.test(val) ? `±${val}` : val.replace("−", "-");
    pending = null;
    i = idx + 1;
  }
  if (pending !== null) throw new Error(tr("nepředepsané desetinná: u {0} chybí tolerance", DEC_LABEL[pending]));
  return rows.map((r) => r.replace(/(\d)\.(\d)/g, "$1,$2"));
}

/** Text nepředepsaných tolerancí → strukturovaná hodnota; null = zrušit (ne / none / keine). Prázdný text = null. */
export function parseGeneralTol(text: string): GeneralTol | null {
  const t = text.trim();
  if (!t || NONE_W.has(fold(t))) return null;
  const iso = /^(?:(?:čsn\s*|csn\s*|din\s*)?(?:en\s*)?iso\s*)?2768\s*[-–:]?\s*(?:1\s*)?([fmcv])\s*[-/]?\s*([hkl])?$/i.exec(t) ?? /^(?:třída\s+|trida\s+|class\s+|klasse\s+)?([fmcv])\s*[-/]?\s*([hkl])?$/i.exec(t);
  if (iso) return { kind: "iso2768", lin: iso[1].toLowerCase() as "f", ...(iso[2] ? { geo: iso[2].toUpperCase() as "H" } : {}) };
  const words = t.split(/\s+/);
  const kw = DEC_W.has(fold(words[0]));
  // tabulka: klíčové slovo (desetinná …), nebo zápis s popisky X. / X.X / X.XX / X.XXX – i jak ho CAD sám vypisuje
  // („X. ±0,1 / X.X ±0,1 / …“) a jak je v dokumentech 959 („X. ±0,1 · X.X ±0,1 · …“); oddělovače · • / ; | i mezery
  if (kw || /^x\.?x*\s*[=:]/i.test(t) || /^x\.x*\s*(?:±|\+\s*\/\s*-|\+-|[+\-−])?\s*\d/i.test(t)) return { kind: "decimals", rows: decimalRows(kw ? words.slice(1).join(" ") : t) };
  return { kind: "text", text: t };
}

/** zápis nepředepsaných tolerancí do `meta.tolerance` (text pro razítko) a `meta.tolTable` (tabulka) */
export function generalTolFields(g: GeneralTol | null): { tolerance: string; tolTable?: string[] } {
  if (!g) return { tolerance: "" };
  if (g.kind === "iso2768") return { tolerance: `ISO 2768-${g.lin}${g.geo ?? ""}` };
  if (g.kind === "decimals") return { tolerance: decimalsText(g.rows), tolTable: g.rows };
  return { tolerance: g.text };
}
const decimalsText = (rows: string[]) => rows.map((r, i) => `${DEC_LABEL[i]} ${r}`).join(" / ");

/** nepředepsané tolerance listu (tabulka má přednost, jinak text – rozpozná i „ISO 2768-mK“) */
export function generalTolOf(meta: Pick<DrawingMeta, "tolerance" | "tolTable">): GeneralTol | null {
  if (meta.tolTable?.length) return { kind: "decimals", rows: [...meta.tolTable, ...DEFAULT_DECIMALS.slice(meta.tolTable.length)].slice(0, 4) };
  try {
    return parseGeneralTol(meta.tolerance ?? "");
  } catch {
    return meta.tolerance?.trim() ? { kind: "text", text: meta.tolerance.trim() } : null;
  }
}
/** text nepředepsaných tolerancí pro razítko (prázdný = nezadané) */
export function generalTolText(g: GeneralTol | null): string {
  if (!g) return "";
  return g.kind === "iso2768" ? `ISO 2768-${g.lin}${g.geo ?? ""}` : g.kind === "decimals" ? decimalsText(g.rows) : g.text;
}
/** popis pro protokol: „ISO 2768-mK (délky a úhly třída m – střední, geometrie K)“ */
export function generalTolDescribe(g: GeneralTol | null): string {
  if (!g) return tr("nezadané");
  if (g.kind === "iso2768") {
    const cls = { f: tr("jemná"), m: tr("střední"), c: tr("hrubá"), v: tr("velmi hrubá") }[g.lin];
    return tr("ISO 2768-{0}{1} (délky, úhly a sražení třída {0} – {2}{3})", g.lin, g.geo ?? "", cls, g.geo ? tr(", geometrie {0}", g.geo) : "");
  }
  if (g.kind === "decimals") return tr("tabulka podle desetinných míst: {0}", decimalsText(g.rows));
  return tr("text „{0}“", g.text);
}

/** ISO 2768-1 – mezní úchylky délek [mm] podle třídy pro rozsahy 0,5–3–6–30–120–400–1000–2000–4000 (kontrola, protokol) */
export const ISO2768_LINEAR: Record<"f" | "m" | "c" | "v", (number | null)[]> = {
  f: [0.05, 0.05, 0.1, 0.15, 0.2, 0.3, 0.5, null],
  m: [0.1, 0.1, 0.2, 0.3, 0.5, 0.8, 1.2, 2],
  c: [0.2, 0.3, 0.5, 0.8, 1.2, 2, 3, 4],
  v: [null, 0.5, 1, 1.5, 2.5, 4, 6, 8],
};
const LIN_RANGES = [3, 6, 30, 120, 400, 1000, 2000, 4000];
/** mezní úchylka délky `L` [mm] dle ISO 2768-1 (null = třída ji nepředepisuje) */
export function iso2768Linear(cls: "f" | "m" | "c" | "v", L: number): number | null {
  const i = LIN_RANGES.findIndex((u) => L <= u);
  return i < 0 ? null : ISO2768_LINEAR[cls][i];
}

// ---------------------------------------------------------------- šířka textu a přizpůsobení buňce

/** odhad šířky textu [mm] podle metrik Roboto (velikost písma = em) – mírně nadsazený, aby text v PDF nikdy nepřetekl */
export function textWidth(s: string, size: number, bold = false): number {
  let w = 0;
  for (const ch of s) {
    if (ch === " ") w += 0.26;
    else if ("iljtfrI.,;:'|!()[]-‐–".includes(ch)) w += 0.32;
    else if ("mwMW@%".includes(ch)) w += 0.9;
    else if (/[0-9]/.test(ch)) w += 0.58;
    else if (/\p{Lu}/u.test(ch)) w += 0.69;
    else w += 0.56;
  }
  return w * size * (bold ? 1.06 : 1);
}

/** nejmenší písmo, které se ještě nezalamuje / pod které se už jen zalamuje [mm] (ISO 3098: nejmenší výška písma 1,8 mm) */
export const FIT_MIN = 2.0;
/** krajní mez zmenšení (velmi dlouhý text v malé buňce – stav výkresu to ohlásí ⚠) */
const FIT_FLOOR = 1.0;

/** Rozdělení textu na `n` řádků s co nejkratším nejdelším řádkem (slova; příliš dlouhé slovo se rozdělí). */
export function wrapText(s: string, n: number, size = 1, bold = false): string[] {
  const words = s.split(/\s+/).filter(Boolean);
  if (n <= 1 || !words.length) return [s.trim()];
  const total = textWidth(s, size, bold);
  // binární hledání nejmenší šířky řádku, při které se text vejde do n řádků (hladové plnění)
  const fill = (lim: number): string[] | null => {
    const out: string[] = [];
    let cur = "";
    const queue = [...words];
    while (queue.length) {
      const w = queue.shift()!;
      const cand = cur ? `${cur} ${w}` : w;
      if (textWidth(cand, size, bold) <= lim + 1e-9) {
        cur = cand;
        continue;
      }
      if (out.length >= n) return null;
      if (cur) {
        out.push(cur);
        cur = "";
        queue.unshift(w);
        continue;
      }
      // slovo samo je delší než řádek: rozdělí se za pomlčkou / podtržítkem, jinak po znacích
      let k = w.length;
      while (k > 1 && textWidth(w.slice(0, k), size, bold) > lim) k--;
      const soft = Math.max(w.lastIndexOf("-", k - 1), w.lastIndexOf("_", k - 1), w.lastIndexOf("/", k - 1));
      const cut = soft > 0 ? soft + 1 : k;
      out.push(w.slice(0, cut));
      queue.unshift(w.slice(cut));
    }
    if (cur) out.push(cur);
    return out.length <= n ? out : null;
  };
  let lo = total / n;
  let hi = total;
  let best = fill(hi) ?? [s];
  for (let it = 0; it < 30; it++) {
    const mid = (lo + hi) / 2;
    const r = fill(mid);
    if (r) {
      best = r;
      hi = mid;
    } else lo = mid;
  }
  return best;
}

/**
 * Přizpůsobení textu buňce (šířka `w`, výška `h` pro řádky textu, mm): nominální velikost → zmenšení do FIT_MIN →
 * zalomení do 2–4 řádků → další zmenšení. Text se nikdy nezkracuje. `small` = písmo pod FIT_MIN (stav výkresu varuje).
 */
export function fitText(s: string, w: number, h: number, size: number, bold = false, maxLines = 4): { lines: string[]; size: number; shrunk: boolean; small: boolean } {
  const one = textWidth(s, 1, bold);
  const pitch = 1.2;
  const fitN = (n: number) => {
    const lines = n === 1 ? [s] : wrapText(s, n, 1, bold);
    const wMax = Math.max(...lines.map((l) => textWidth(l, 1, bold)), 1e-9);
    const sz = Math.min(size, w / wMax, h / (1 + pitch * (lines.length - 1)));
    return { lines, size: sz };
  };
  if (one * size <= w) return { lines: [s], size, shrunk: false, small: false };
  let best = fitN(1);
  if (best.size >= FIT_MIN) return { ...best, shrunk: true, small: false };
  for (let n = 2; n <= maxLines; n++) {
    const r = fitN(n);
    if (r.size > best.size + 1e-9) best = r;
    if (r.size >= FIT_MIN) return { ...r, shrunk: true, small: false };
  }
  const sz = Math.max(FIT_FLOOR, best.size);
  return { lines: best.lines, size: sz, shrunk: true, small: true };
}

// ---------------------------------------------------------------- hodnoty polí

const fmtNum = (n: number) => (Math.round(n * 100) / 100).toLocaleString(cadLocale());

/** popisek pole razítka (cs; překlad přes tr) */
export function fieldLabel(k: string): string {
  switch (k) {
    case "name": return tr("Název");
    case "number": return tr("Číslo výkresu");
    case "author": return tr("Kreslil");
    case "checkedBy": return tr("Kontroloval");
    case "approvedBy": return tr("Schválil");
    case "revision": return "Rev.";
    case "date": return tr("Datum");
    case "material": return tr("Materiál");
    case "stock": return tr("Polotovar");
    case "quantity": return tr("Počet kusů");
    case "heatTreatment": return tr("Tepelné zpracování");
    case "surfaceTreatment": return tr("Povrchová úprava");
    case "tolerance": return tr("Nepředepsané tolerance");
    case "angleTol": return tr("Tolerance úhlů");
    case "chamferTol": return tr("Tolerance sražení");
    case "edges": return tr("Hrany");
    case "customer": return tr("Zákazník");
    case "project": return tr("Projekt");
    case "company": return tr("Firma");
    case "note": return tr("Poznámka");
    case "scale": return tr("Měřítko");
    case "format": return tr("Formát");
    case "mass": return tr("Hmotnost");
    case "sheet": return tr("List");
    case "projection": return tr("Promítání");
    default: return k;
  }
}

/** revize v razítku: zadaná, jinak poslední z tabulky revizí (propojení s tabulkou), jinak „–“ */
export const titleRevision = (meta: Pick<DrawingMeta, "revision" | "revisions">): string => meta.revision?.trim() || lastRevision(meta.revisions) || "";
const lastRevision = (revs?: RevisionItem[]) => (revs?.length ? revs[revs.length - 1].rev : "");

export type TitleCtx = { sheet: string; scaleLabel: string; projection: "E" | "A" };

/** hodnota buňky / pole (prázdné = pole nevyplněné) */
export function fieldValue(k: string, meta: DrawingMeta, ctx: TitleCtx): string {
  const g = generalTolOf(meta);
  const s = (v?: string) => v?.trim() ?? "";
  switch (k) {
    case "name": return meta.name || tr("Bez názvu");
    case "date": return meta.date ?? new Date().toLocaleDateString(cadLocale());
    case "revision": return titleRevision(meta) || "–";
    case "scale": return ctx.scaleLabel;
    case "format": return ctx.sheet;
    case "mass": return meta.massKg != null ? `${fmtNum(meta.massKg)} kg` : "—";
    case "sheet": return `${meta.sheetIndex ?? 1}/${meta.sheetCount ?? 1}`;
    case "quantity": {
      const q = s(meta.quantity);
      return /^\d+([.,]\d+)?$/.test(q) ? tr("{0} ks", q) : q;
    }
    case "tolerance": return generalTolText(g);
    // úhly a sražení: zadané, jinak podle třídy ISO 2768-1 (norma je pokrývá také)
    case "angleTol": return s(meta.angleTol) || (g?.kind === "iso2768" ? `ISO 2768-${g.lin}` : "");
    case "chamferTol": return s(meta.chamferTol) || (g?.kind === "iso2768" ? `ISO 2768-${g.lin}` : "");
    default: {
      const v = (meta as unknown as Record<string, unknown>)[k];
      return typeof v === "string" ? v.trim() : "";
    }
  }
}

/** pole, která se do patičky vypíšou, když je šablona nemá (pořadí = pořadí v patičce) */
const FOOTER_EXTRA: string[] = ["customer", "project", "quantity", "stock", "heatTreatment", "surfaceTreatment", "angleTol", "chamferTol", "checkedBy", "approvedBy", "mass"];

// ---------------------------------------------------------------- vykreslení

const rect = (polys: Poly[], x: number, y: number, w: number, h: number, layer: Poly["layer"] = "frame", width?: number) => polys.push({ layer, width, pts: [[x, y], [x + w, y], [x + w, y + h], [x, y + h], [x, y]] });

/**
 * Značka promítání ISO 5456-2 (ISO 128-30): komolý kužel v bokorysu (lichoběžník, užší konec vlevo) a v nárysu (dvě
 * soustředné kružnice). Promítání v 1. kvadrantu (ISO E, Evropa) má kružnice VPRAVO od lichoběžníku, ve 3. kvadrantu
 * (ISO A, USA) VLEVO – lichoběžník je v obou stejný. Výška 7 mm; vrací šířku značky.
 */
export function projectionSymbol(polys: Poly[], x: number, y: number, projection: "E" | "A", h = 7): number {
  const L = h * 1.3;
  const gap = h * 0.55;
  const trap = (tx: number) => {
    const small = h * 0.5;
    polys.push({ layer: "title", width: 0.35, pts: [[tx, y + (h - small) / 2], [tx + L, y], [tx + L, y + h], [tx, y + (h + small) / 2], [tx, y + (h - small) / 2]] });
    polys.push({ layer: "center", pts: [[tx - 1.5, y + h / 2], [tx + L + 1.5, y + h / 2]] });
  };
  const circ = (ccx: number) => {
    for (const rr of [h / 2, h / 4]) {
      const pts: Vec2[] = [];
      for (let i = 0; i <= 36; i++) pts.push([ccx + rr * Math.cos((i / 36) * 2 * Math.PI), y + h / 2 + rr * Math.sin((i / 36) * 2 * Math.PI)]);
      polys.push({ layer: "title", width: 0.35, pts });
    }
    polys.push({ layer: "center", pts: [[ccx - h / 2 - 1.5, y + h / 2], [ccx + h / 2 + 1.5, y + h / 2]] }, { layer: "center", pts: [[ccx, y - 1], [ccx, y + h + 1]] });
  };
  if (projection === "E") {
    trap(x);
    circ(x + L + gap + h / 2);
  } else {
    circ(x + h / 2);
    trap(x + h + gap);
  }
  return L + gap + h;
}

export type TitleDrawArgs = {
  /** rozměr listu [mm] */
  W: number;
  H: number;
  /** okraje rámu (vpravo / dole) */
  margin: number;
  ctx: TitleCtx;
  meta: DrawingMeta;
  polys: Poly[];
  texts: DText[];
  /** výška tabulek nad razítkem (kusovník, tabulka děr) – patička je nad nimi */
  above: number;
};

/** Razítko listu do geometrie (pravý dolní roh nad okrajem) – vrací údaje pro stav výkresu. */
export function drawTitleBlock(a: TitleDrawArgs): TitleBlockInfo {
  const { meta, polys, texts, ctx } = a;
  const tpl = titleTemplateOf(meta);
  const def = TEMPLATES[tpl];
  const x = a.W - a.margin - def.w;
  const y = a.H - a.margin - def.h;
  const fields: TitleFieldFit[] = [];
  const Tx = (tx: number, ty: number, s: string, size: number, bold = false, brand = false, anchor?: DText["anchor"]) => texts.push({ x: tx, y: ty, s, size, bold, brand, layer: "text", ...(anchor ? { anchor } : {}) });
  rect(polys, x, y, def.w, def.h, "frame", 0.7);
  // čáry buněk (každá hrana jednou)
  const segs = new Set<string>();
  const seg = (x0: number, y0: number, x1: number, y1: number) => {
    const k = `${x0},${y0},${x1},${y1}`;
    if (segs.has(k)) return;
    segs.add(k);
    polys.push({ layer: "title", pts: [[x + x0, y + y0], [x + x1, y + y1]] });
  };
  for (const c of def.cells) {
    if (c.x > 0) seg(c.x, c.y, c.x, c.y + c.h);
    if (c.y > 0) seg(c.x, c.y, c.x + c.w, c.y);
  }
  let logoInfo: TitleBlockInfo["logo"];
  const g = generalTolOf(meta);
  for (const c of def.cells) {
    const cx = x + c.x;
    const cy = y + c.y;
    if (c.k === "brand") {
      logoInfo = brandCell(cx, cy, c.w, c.h, meta, polys, texts, fields);
      continue;
    }
    if (c.k === "projection") {
      Tx(cx + 1.5, cy + 3.2, fieldLabel("projection"), 2);
      const sh = Math.min(7, c.h - 6.5);
      const sw = sh * 1.3 + sh * 0.55 + sh;
      projectionSymbol(polys, cx + (c.w - sw) / 2, cy + 4 + (c.h - 4 - sh) / 2, ctx.projection, sh);
      continue;
    }
    Tx(cx + 1.5, cy + 3.2, fieldLabel(c.k), 2);
    if (c.k === "tolerance" && g?.kind === "decimals") {
      // tabulka podle desetinných míst: 2 sloupce × 2 řádky
      const sz = Math.min(2.6, (c.h - 5) / 2.3);
      const colW = (c.w - 3) / 2;
      g.rows.forEach((r, i) => {
        const s = `${DEC_LABEL[i]} ${r}`;
        const f = fitText(s, colW - 1, sz, sz);
        Tx(cx + 1.5 + Math.floor(i / 2) * colW, cy + 4.2 + sz * 0.8 + (i % 2) * sz * 1.25, s, f.size);
      });
      fields.push({ key: "tolerance", label: fieldLabel("tolerance"), value: decimalsText(g.rows), size: sz, lines: 2, shrunk: false, small: false, where: "cell" });
      continue;
    }
    const value = fieldValue(c.k, meta, ctx);
    if (!value) continue;
    const nominal = c.size ?? 3.2;
    const bold = !!c.bold;
    const f = fitText(value, c.w - 3, c.h - 5.2, nominal, bold);
    const n = f.lines.length;
    // jeden řádek v nominální velikosti = stejná poloha jako dřív; jinak svisle na střed plochy pod popiskem
    const base0 = !f.shrunk ? cy + 3.2 + nominal + 2.6 : cy + 4 + (c.h - 5.2 - f.size * (1 + 1.2 * (n - 1))) / 2 + f.size * 0.8;
    f.lines.forEach((l, i) => Tx(cx + 1.5, base0 + i * 1.2 * f.size, l, f.size, bold));
    fields.push({ key: c.k, label: fieldLabel(c.k), value, size: round2(f.size), lines: n, shrunk: f.shrunk, small: f.small, where: "cell", cell: { x: cx, y: cy, w: c.w, h: c.h }, rows: f.lines });
  }
  // patička nad razítkem a tabulkami: rozměry v mm, nepředepsané tolerance, hrany, pole mimo šablonu; poznámka a list
  const keys = new Set(def.cells.map((c) => c.k as string));
  const req: string[] = [tr("Rozměry v mm")];
  if (!keys.has("tolerance") && g) req.push(tr("Nepředepsané tolerance {0}", generalTolText(g)));
  if (!keys.has("edges") && meta.edges?.trim()) req.push(tr("Hrany: {0}", meta.edges.trim()));
  for (const k of FOOTER_EXTRA) {
    if (keys.has(k)) continue;
    // úhly / sražení odvozené z ISO 2768 se v patičce neopakují (třída už tam je)
    if ((k === "angleTol" || k === "chamferTol") && !meta[k]?.trim()) continue;
    if (k === "mass" && meta.massKg == null) continue;
    const v = fieldValue(k, meta, ctx);
    if (!v) continue;
    req.push(`${fieldLabel(k)}: ${v}`);
    fields.push({ key: k, label: fieldLabel(k), value: v, size: 2.5, lines: 1, shrunk: false, small: false, where: "footer" });
  }
  req.push(...(meta.formNotes ?? []));
  const noteRow = [meta.note?.trim() ?? "", keys.has("sheet") ? "" : tr("List {0}/{1}", meta.sheetIndex ?? 1, meta.sheetCount ?? 1)].filter(Boolean);
  const footer = footerLines([req.join(" · "), noteRow.join(" · ")].filter(Boolean), def.w);
  const ny = y - a.above;
  footer.lines.forEach((l, i) => Tx(x, ny - 1.8 - (footer.lines.length - 1 - i) * footer.pitch, l, footer.size));
  return {
    template: tpl,
    x,
    y,
    w: def.w,
    h: def.h,
    projection: ctx.projection,
    ...(logoInfo ? { logo: logoInfo } : {}),
    ...(a.above > 0 ? { above: round2(a.above) } : {}),
    generalTol: generalTolText(g),
    fields,
    footer: footer.lines,
  };
}

const round2 = (n: number) => Math.round(n * 100) / 100;

/** Řádky patičky: každý řádek se vejde do šířky razítka (zmenšení do 1,8 mm, zalomení), nejvýš 4 řádky do 11,5 mm. */
function footerLines(rows: string[], w: number): { lines: string[]; size: number; pitch: number } {
  for (let s = 2.5; s >= 1.6 - 1e-9; s -= 0.1) {
    const lines = rows.flatMap((r) => {
      for (let n = 1; n <= 4; n++) {
        const ls = n === 1 ? [r] : wrapText(r, n, s);
        if (ls.every((l) => textWidth(l, s) <= w)) return ls;
      }
      return wrapText(r, 4, s);
    });
    const pitch = lines.length <= 2 ? 3.7 * (s / 2.5) : 1.2 * s;
    if (lines.length <= 4 && 1.8 + (lines.length - 1) * pitch + s <= 11.6 && lines.every((l) => textWidth(l, s) <= w)) return { lines, size: round2(s), pitch };
  }
  const lines = rows.flatMap((r) => wrapText(r, 4, 1.6));
  return { lines, size: 1.6, pitch: 1.2 * 1.6 };
}

/** Buňka firmy: logo (obrázek přizpůsobený buňce) a / nebo název firmy; bez obojího výchozí Mnástrojárna. */
function brandCell(cx: number, cy: number, w: number, h: number, meta: DrawingMeta, polys: Poly[], texts: DText[], fields: TitleFieldFit[]): TitleBlockInfo["logo"] {
  const company = meta.company?.trim() ?? "";
  const logo = meta.logo?.src ? meta.logo : null;
  const pad = 1.5;
  if (!logo && !company) {
    // výchozí: Mnástrojárna (barevně), slogan a web – jako dosud (velikost podle buňky)
    const k = Math.min(1, w / 55, h / 21);
    texts.push({ x: cx + 3 * k, y: cy + 8.5 * k, s: "Mnástrojárna s.r.o.", size: 4.6 * k, bold: true, brand: true, layer: "text" });
    if (h >= 14) texts.push({ x: cx + 3 * k, y: cy + 13.5 * k, s: tr("Váš partner ve strojírenství"), size: 2.6 * k, layer: "text" });
    if (h >= 18) texts.push({ x: cx + 3 * k, y: cy + 18 * k, s: "www.mnastrojarna.cz", size: 2.4 * k, layer: "text" });
    return undefined;
  }
  let companyH = 0;
  if (company) {
    const f = fitText(company, w - 2 * pad, logo ? Math.min(6, h * 0.32) : h - 2 * pad, logo ? 3.4 : 4.2, true, logo ? 2 : 3);
    companyH = logo ? f.size * (1 + 1.2 * (f.lines.length - 1)) + 1.2 : 0;
    const top = logo ? cy + h - pad - f.size * (1 + 1.2 * (f.lines.length - 1)) : cy + (h - f.size * (1 + 1.2 * (f.lines.length - 1))) / 2;
    f.lines.forEach((l, i) => texts.push({ x: cx + pad, y: top + f.size * 0.8 + i * 1.2 * f.size, s: l, size: f.size, bold: true, layer: "text" }));
    fields.push({ key: "company", label: fieldLabel("company"), value: company, size: round2(f.size), lines: f.lines.length, shrunk: f.shrunk, small: f.small, where: "cell" });
  }
  if (!logo) return undefined;
  const bw = w - 2 * pad;
  const bh = h - 2 * pad - companyH;
  const k = Math.min(bw / Math.max(1, logo.w), bh / Math.max(1, logo.h));
  const iw = logo.w * k;
  const ih = logo.h * k;
  const ix = cx + pad + (bw - iw) / 2;
  const iy = cy + pad + (bh - ih) / 2;
  polys.push({ layer: "title", pts: [[ix, iy], [ix + iw, iy], [ix + iw, iy + ih], [ix, iy + ih], [ix, iy]], img: { x: ix, y: iy, w: iw, h: ih, src: logo.src, ...(logo.trace ? { trace: logo.trace } : {}) } });
  return { x: round2(ix), y: round2(iy), w: round2(iw), h: round2(ih), ...(logo.name ? { name: logo.name } : {}) };
}

// ---------------------------------------------------------------- logo ve vektorových formátech

/** Obdélníky obrysu loga v mm listu (DXF / DWG: plné plošky SOLID), y dolů. */
export function imageRects(img: SheetImage): { x0: number; y0: number; x1: number; y1: number }[] {
  const t = img.trace;
  if (!t?.rects.length) return [];
  const sx = img.w / t.cols;
  const sy = img.h / t.rows;
  const out: { x0: number; y0: number; x1: number; y1: number }[] = [];
  for (let i = 0; i + 3 < t.rects.length; i += 4) out.push({ x0: img.x + t.rects[i] * sx, y0: img.y + t.rects[i + 1] * sy, x1: img.x + t.rects[i + 2] * sx, y1: img.y + t.rects[i + 3] * sy });
  return out;
}

/** nejbližší barva AutoCADu (ACI 1–9) k barvě obrysu loga – DXF R12 skutečné barvy nezná */
export function nearestAci(hex: string): number {
  const m = /^#?([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(hex);
  if (!m) return 7;
  const [r, g, b] = [m[1], m[2], m[3]].map((x) => parseInt(x, 16));
  const pal: [number, number, number, number][] = [[1, 255, 0, 0], [2, 255, 255, 0], [3, 0, 255, 0], [4, 0, 255, 255], [5, 0, 0, 255], [6, 255, 0, 255], [7, 0, 0, 0], [8, 128, 128, 128], [9, 192, 192, 192]];
  let best = 7;
  let bd = Infinity;
  for (const [aci, pr, pg, pb] of pal) {
    const d = (r - pr) ** 2 + (g - pg) ** 2 + (b - pb) ** 2;
    if (d < bd) {
      bd = d;
      best = aci;
    }
  }
  return best;
}

// ---------------------------------------------------------------- nový list a výpis

/** údaje razítka, které nový list převezme z aktivního (šablona, logo, firma, zákazník, projekt, schválil …) */
export const INHERITED_TITLE: (keyof DrawingMeta)[] = ["name", "number", "author", "revision", "date", "tolerance", "tolTable", "template", "logo", "company", "customer", "project", "checkedBy", "approvedBy", "quantity", "stock", "heatTreatment", "surfaceTreatment", "angleTol", "chamferTol", "edges"];
export function inheritTitle(cur: Partial<DrawingMeta>): Partial<DrawingMeta> {
  const out: Record<string, unknown> = {};
  for (const k of INHERITED_TITLE) if (cur[k] !== undefined) out[k] = cur[k];
  return out as Partial<DrawingMeta>;
}
