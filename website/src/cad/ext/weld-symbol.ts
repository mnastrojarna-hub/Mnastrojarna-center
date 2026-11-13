/**
 * Značka svaru podle ISO 2553 (systém A): odkazová čára se šipkou ke spoji, plná referenční čára s čárkovanou identifikační
 * čarou, základní značka (koutový, I, V, Y, X, ½V, ½Y, K, U, 2U, J, 2J, lemový, děrový / žlábkový, bodový), velikost (a / z / s / Ø)
 * vlevo, délka × počet (rozteč) vpravo, oboustranný svar, svar kolem, montážní svar (vlajka), podložka (M), metoda ISO 4063
 * ve vidličce na konci. Geometrie v mm listu (SVG: osa y dolů) – vykreslí ji výkres (SVG / DXF / DWG / PDF). Bez OCCT.
 */
import { cadLocale, tr } from "../i18n";
import type { DText, Poly } from "../drawing";
import type { Vec2 } from "../types";

const fmt = (n: number) => (Math.round(n * 100) / 100).toLocaleString(cadLocale());

export type SymbolKind = "fillet" | "I" | "V" | "Y" | "X" | "halfV" | "HY" | "K" | "U" | "UU" | "J" | "JJ" | "square" | "plug" | "spot";
export const SYMBOL_TYPES: { v: SymbolKind; l: string }[] = [
  { v: "fillet", l: tr("Koutový") },
  { v: "I", l: tr("I svar") },
  { v: "V", l: tr("V svar") },
  { v: "Y", l: tr("Y svar") },
  { v: "X", l: tr("X svar (2V)") },
  { v: "halfV", l: tr("½V svar") },
  { v: "HY", l: tr("½Y svar") },
  { v: "K", l: tr("K svar") },
  { v: "U", l: tr("U svar") },
  { v: "UU", l: tr("2U svar") },
  { v: "J", l: tr("J svar") },
  { v: "JJ", l: tr("2J svar") },
  { v: "square", l: tr("Lemový") },
  { v: "plug", l: tr("Děrový / žlábkový") },
  { v: "spot", l: tr("Bodový") },
];
/** oboustranné značky (kreslí se nad i pod referenční čarou, bez identifikační čáry) */
const DOUBLE: Partial<Record<SymbolKind, SymbolKind>> = { X: "V", K: "halfV", UU: "U", JJ: "J" };

export type SymbolData = {
  kind: SymbolKind;
  /** a / z / s / Ø (0 = bez údaje) */
  size: number;
  /** písmeno velikosti (výchozí a u koutového, s u tupých, Ø u děrových a bodových) */
  prefix?: string;
  /** délka svaru (úseku); 0 = po celé délce */
  length: number;
  /** rozteč (přerušovaný, bodový, děrový) */
  pitch: number;
  /** počet úseků / bodů (n × l) */
  count?: number;
  allAround: boolean;
  field: boolean;
  otherSide: boolean;
  /** oboustranný koutový svar */
  both?: boolean;
  /** úhel úpravy [°], mezera, otupení (tupé svary) */
  angle?: number;
  gap?: number;
  rootFace?: number;
  /** podložka (M) */
  backing?: boolean;
  /** metoda ISO 4063 (ve vidličce) */
  process?: string;
  note: string;
};

export function symbolData(data: Record<string, unknown>): SymbolData {
  const n = (k: string, d: number) => (typeof data[k] === "number" && Number.isFinite(data[k] as number) ? (data[k] as number) : d);
  const kind = SYMBOL_TYPES.some((t) => t.v === data.kind) ? (data.kind as SymbolKind) : data.kind === "HV" ? "halfV" : "fillet";
  return {
    kind,
    size: n("size", 4),
    ...(typeof data.prefix === "string" && data.prefix ? { prefix: data.prefix } : {}),
    length: n("length", 0),
    pitch: n("pitch", 0),
    ...(n("count", 0) > 0 ? { count: n("count", 0) } : {}),
    allAround: !!data.allAround,
    field: !!data.field,
    otherSide: !!data.otherSide,
    ...(data.both ? { both: true } : {}),
    ...(n("angle", 0) > 0 ? { angle: n("angle", 0) } : {}),
    ...(n("gap", 0) > 0 ? { gap: n("gap", 0) } : {}),
    ...(n("rootFace", 0) > 0 ? { rootFace: n("rootFace", 0) } : {}),
    ...(data.backing ? { backing: true } : {}),
    ...(typeof data.process === "string" && data.process.trim() ? { process: data.process.trim() } : typeof data.process === "number" ? { process: String(data.process) } : {}),
    note: String(data.note ?? ""),
  };
}

/** Text značky (pro tabulku a stav): „a5 ◺ 3×50 (100) 135“. */
export function symbolText(s: SymbolData): string {
  const pre = s.prefix ?? (s.kind === "fillet" ? "a" : s.kind === "plug" || s.kind === "spot" ? "Ø" : "s");
  const kind = SYMBOL_TYPES.find((t) => t.v === s.kind)?.l ?? s.kind;
  const len = s.length > 0 ? (s.count && s.count > 1 ? `${s.count}×${fmt(s.length)}` : fmt(s.length)) + (s.pitch > 0 ? ` (${fmt(s.pitch)})` : "") : s.count && s.count > 1 ? `${s.count}${s.pitch > 0 ? `(${fmt(s.pitch)})` : ""}` : "";
  return [kind, s.size > 0 ? `${pre}${fmt(s.size)}` : "", s.angle ? `${fmt(s.angle)}°` : "", len, s.both ? tr("oboustranně") : "", s.allAround ? tr("kolem") : "", s.field ? tr("montážní") : "", s.process ?? ""].filter(Boolean).join(" ");
}

export type SymbolOpts = {
  /** referenční čára vede od kolena doleva (šipka vpravo od značky) */
  flip?: boolean;
  /** délka referenční čáry [mm listu] */
  len?: number;
};

/**
 * Geometrie značky svaru pro výkres (mm listu): `at` = koleno (spoj odkazové a referenční čáry), `leader` = hrot šipky.
 * Strana šipky: značka nad plnou referenční čarou, čárkovaná identifikační čára pod ní; druhá strana naopak; oboustranné
 * značky (X, K, 2U, 2J, oboustranný koutový) na obou stranách bez identifikační čáry.
 */
export function weldSymbolGeometry(sym: SymbolData, at: Vec2, leader: Vec2, opts: SymbolOpts = {}): { polys: Poly[]; texts: DText[] } {
  const polys: Poly[] = [];
  const texts: DText[] = [];
  const L = opts.len ?? 30;
  const sx = opts.flip ? -1 : 1;
  const [x, y] = at;
  const xEnd = x + sx * L;
  const line = (pts: Vec2[]) => polys.push({ layer: "dim", pts });
  const doubleOf = DOUBLE[sym.kind];
  const twoSided = !!doubleOf || (sym.kind === "fillet" && !!sym.both) || sym.kind === "spot";
  // referenční čára (plná) + identifikační (čárkovaná) – ne u oboustranných a bodových značek
  line([[x, y], [xEnd, y]]);
  if (!twoSided) polys.push({ layer: "hidden", pts: [[x, y + 2.2], [xEnd, y + 2.2]] });
  // šipka
  line([[x, y], leader]);
  const dx = leader[0] - x;
  const dy = leader[1] - y;
  const l = Math.hypot(dx, dy) || 1;
  const ux = dx / l;
  const uy = dy / l;
  polys.push({ layer: "dim", fill: true, pts: [leader, [leader[0] - ux * 3 - uy * 0.9, leader[1] - uy * 3 + ux * 0.9], [leader[0] - ux * 3 + uy * 0.9, leader[1] - uy * 3 - ux * 0.9], leader] });
  // značka: střed ve vzdálenosti 13 mm od kolena; strana: −1 = nad čarou (SVG y dolů), +1 = pod
  const cx = x + sx * 13;
  const h = 3.6;
  /** základna značky: strana šipky nad plnou čarou, druhá strana pod čárkovanou identifikační čarou (vždy pod plnou) */
  const base = (side: number) => (!twoSided && side > 0 ? 2.2 : 0);
  const glyph = (kind: SymbolKind, side: number) => {
    const y0 = y + base(side);
    const g = (pts: Vec2[]) => line(pts.map(([px, py]) => [cx + px, y0 + side * py] as Vec2));
    switch (kind) {
      case "fillet":
        g([[-h / 2, 0], [-h / 2, h], [h / 2, 0]]);
        break;
      case "V":
        g([[-h / 2, h], [0, 0], [h / 2, h]]);
        break;
      case "Y":
        g([[-h / 2, h], [0, h * 0.45], [h / 2, h]]);
        g([[0, 0], [0, h * 0.45]]);
        break;
      case "halfV":
        g([[-h / 3, h], [-h / 3, 0]]);
        g([[-h / 3, 0], [h * 0.55, h]]);
        break;
      case "HY":
        g([[-h / 3, h], [-h / 3, 0]]);
        g([[-h / 3, h * 0.45], [h * 0.45, h]]);
        break;
      case "U": {
        g([[-h / 2, h], [-h * 0.32, h * 0.55]]);
        const arc: Vec2[] = [];
        for (let i = 0; i <= 10; i++) {
          const a = (Math.PI * i) / 10;
          arc.push([-h * 0.32 * Math.cos(a), h * 0.55 - h * 0.45 * Math.sin(a)]);
        }
        g(arc);
        g([[h * 0.32, h * 0.55], [h / 2, h]]);
        g([[0, 0], [0, h * 0.1]]);
        break;
      }
      case "J": {
        g([[-h / 3, h], [-h / 3, 0]]);
        const arc: Vec2[] = [];
        for (let i = 0; i <= 8; i++) {
          const a = (Math.PI / 2) * (i / 8);
          arc.push([-h / 3 + h * 0.45 * Math.sin(a), h * 0.55 - h * 0.45 * Math.cos(a)]);
        }
        g(arc);
        g([[-h / 3 + h * 0.45, h * 0.55], [h * 0.55, h]]);
        break;
      }
      case "I":
        g([[-1.2, 0], [-1.2, h]]);
        g([[1.2, 0], [1.2, h]]);
        break;
      case "square":
        g([[-h / 2, h], [-h / 2, 0], [h / 2, 0], [h / 2, h]]);
        break;
      case "plug":
        g([[-h * 0.6, 0], [-h * 0.6, h * 0.8], [h * 0.6, h * 0.8], [h * 0.6, 0]]);
        break;
      default:
        break;
    }
  };
  const sides: number[] = twoSided ? [-1, 1] : [sym.otherSide ? 1 : -1];
  if (sym.kind === "spot") {
    // bodový svar: kružnice na referenční čáře
    const pts: Vec2[] = [];
    for (let i = 0; i <= 24; i++) pts.push([cx + Math.cos((i / 24) * Math.PI * 2) * 2, y + Math.sin((i / 24) * Math.PI * 2) * 2]);
    line(pts);
  } else for (const sd of sides) glyph(doubleOf ?? sym.kind, sd);
  // texty: velikost vlevo od značky, délka × počet (rozteč) vpravo; u oboustranných na obou stranách
  const pre = sym.prefix ?? (sym.kind === "fillet" ? "a" : sym.kind === "plug" || sym.kind === "spot" ? "Ø" : "s");
  const lenText = sym.length > 0 ? `${sym.count && sym.count > 1 ? `${sym.count}×` : ""}${fmt(sym.length)}${sym.pitch > 0 ? ` (${fmt(sym.pitch)})` : ""}` : sym.count && sym.count > 1 ? `${sym.count}${sym.pitch > 0 ? ` (${fmt(sym.pitch)})` : ""}` : "";
  for (const sd of sym.kind === "spot" ? [-1] : sides) {
    const ty = y + base(sd) + sd * (h / 2) + 1.2;
    if (sym.size > 0) texts.push({ x: cx - h / 2 - 1.2, y: ty, s: `${pre}${fmt(sym.size)}`, size: 3, anchor: "end", layer: "dim" });
    if (lenText) texts.push({ x: cx + h / 2 + 1.2, y: ty, s: lenText, size: 3, layer: "dim" });
  }
  // úhel / mezera / otupení nad značkou
  const prepBits = [sym.angle ? `${fmt(sym.angle)}°` : "", sym.gap ? `b${fmt(sym.gap)}` : "", sym.rootFace ? `c${fmt(sym.rootFace)}` : ""].filter(Boolean).join(" ");
  if (prepBits) {
    const sd = sides[0];
    texts.push({ x: cx, y: y + base(sd) + sd * (h + 1.6) + (sd < 0 ? 0 : 2.2), s: prepBits, size: 2.5, anchor: "middle", layer: "dim" });
  }
  // podložka: obdélník s M na druhé straně čáry
  if (sym.backing) {
    const sd = -sides[0];
    const y0 = y + sd * (twoSided || sd < 0 ? 0.6 : 2.8);
    const y1 = y0 + sd * 3;
    line([[cx - 2.4, y0], [cx + 2.4, y0], [cx + 2.4, y1], [cx - 2.4, y1], [cx - 2.4, y0]]);
    texts.push({ x: cx, y: (y0 + y1) / 2 + 1, s: "M", size: 2.5, anchor: "middle", layer: "dim" });
  }
  // svar kolem: kružnice v koleni
  if (sym.allAround) {
    const pts: Vec2[] = [];
    for (let i = 0; i <= 16; i++) pts.push([x + Math.cos((i / 16) * Math.PI * 2) * 1.6, y + Math.sin((i / 16) * Math.PI * 2) * 1.6]);
    line(pts);
  }
  // montážní svar: vlajka v koleni
  if (sym.field) {
    line([[x, y], [x, y - 7]]);
    polys.push({ layer: "dim", fill: true, pts: [[x, y - 7], [x + sx * 4, y - 5.5], [x, y - 4], [x, y - 7]] });
  }
  // metoda: vidlička na konci referenční čáry
  if (sym.process) {
    line([[xEnd, y], [xEnd + sx * 2.5, y - 2.5]]);
    line([[xEnd, y], [xEnd + sx * 2.5, y + 2.5]]);
    texts.push({ x: xEnd + sx * 3.2, y: y + 1.1, s: sym.process, size: 2.5, anchor: opts.flip ? "end" : "start", layer: "dim" });
  }
  if (sym.note) texts.push({ x: xEnd + sx * (sym.process ? 3.2 + 2.2 * sym.process.length + 1 : 2), y: y + 1.1, s: sym.note, size: 2.5, anchor: opts.flip ? "end" : "start", layer: "text" });
  return { polys, texts };
}
