/**
 * BALÍK 3 (layout) – společné pomůcky: přesné goniometrické funkce pro násobky 90°, měřítka (ISO 5455), zápis slov
 * v CZ / EN / DE, transformace vložení bloku a výřezu.
 */
import { tr } from "../../i18n";
import { xfInv, type Affine } from "../geom";
import type { DraftModel, Vec2 } from "../model";
import { UNITS, evalNumber } from "../units";
import type { DInsert, DViewport } from "./types";

export const fold = (s: string) => s.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/ß/g, "ss").replace(/[-_]/g, "");
/** slovo `t` je jedno z `w` (bez diakritiky, velikosti písmen, pomlček) */
export const isW = (t: string | undefined, ...w: string[]) => t !== undefined && w.some((x) => fold(x) === fold(t));

/** cos / sin úhlu ve stupních – násobky 90° přesně (0, ±1), aby se souřadnice při otočení o 90° nezatížily chybou 6e-17 */
export function cosSinDeg(d: number): [number, number] {
  const n = ((d % 360) + 360) % 360;
  if (n === 0) return [1, 0];
  if (n === 90) return [0, 1];
  if (n === 180) return [-1, 0];
  if (n === 270) return [0, -1];
  const r = (d * Math.PI) / 180;
  return [Math.cos(r), Math.sin(r)];
}

/**
 * Transformace vložení bloku (bloková → nadřazená soustava): P = p + R(rot)·(S·(q − base) + [col·dx, row·dy]).
 * Pole (MINSERT) má posuny v natočené soustavě vložení bez měřítka (jako AutoCAD).
 */
export function insertXf(e: Pick<DInsert, "p" | "sx" | "sy" | "rot" | "colSpacing" | "rowSpacing">, base: Vec2, col = 0, row = 0): Affine {
  const [c, s] = cosSinDeg(e.rot ?? 0);
  const sx = e.sx ?? 1;
  const sy = e.sy ?? 1;
  const a = c * sx;
  const b = s * sx;
  const cc = -s * sy;
  const d = c * sy;
  const ox = col * (e.colSpacing ?? 0);
  const oy = row * (e.rowSpacing ?? 0);
  return [a, b, cc, d, e.p[0] + (c * ox - s * oy) - (a * base[0] + cc * base[1]), e.p[1] + (s * ox + c * oy) - (b * base[0] + d * base[1])];
}

/** Transformace výřezu model → papír: P = c + R(twist)·scale·(q − viewCenter). */
export function vpXf(e: Pick<DViewport, "c" | "viewCenter" | "scale" | "twist">): Affine {
  const [c, s] = cosSinDeg(e.twist ?? 0);
  const k = e.scale;
  const a = c * k;
  const b = s * k;
  return [a, b, -b, a, e.c[0] - (a * e.viewCenter[0] - b * e.viewCenter[1]), e.c[1] - (b * e.viewCenter[0] + a * e.viewCenter[1])];
}
/** papír → model */
export const vpInv = (e: Pick<DViewport, "c" | "viewCenter" | "scale" | "twist">): Affine => xfInv(vpXf(e));

/** obrys výřezu na papíře (ořez nebo obdélník) */
export function vpPolygon(e: Pick<DViewport, "c" | "w" | "h" | "clip">): Vec2[] {
  if (e.clip && e.clip.length >= 3) return e.clip;
  const [x, y] = e.c;
  const w = e.w / 2;
  const h = e.h / 2;
  return [
    [x - w, y - h],
    [x + w, y - h],
    [x + w, y + h],
    [x - w, y + h],
  ];
}

// ---------------------------------------------------------------- měřítka

/** standardní měřítka ISO 5455 (papír : skutečnost) */
export const ISO_SCALES: [number, number][] = [
  [50, 1],
  [20, 1],
  [10, 1],
  [5, 1],
  [2, 1],
  [1, 1],
  [1, 2],
  [1, 5],
  [1, 10],
  [1, 20],
  [1, 50],
  [1, 100],
  [1, 200],
  [1, 500],
  [1, 1000],
  [1, 2000],
  [1, 5000],
  [1, 10000],
];
/** nabídka měřítek v GUI (ISO + běžná AutoCADu) */
export const MENU_SCALES: [number, number][] = [
  [10, 1],
  [5, 1],
  [4, 1],
  [2, 1],
  [1, 1],
  [1, 2],
  [1, 2.5],
  [1, 4],
  [1, 5],
  [1, 10],
  [1, 15],
  [1, 20],
  [1, 25],
  [1, 50],
  [1, 75],
  [1, 100],
  [1, 200],
  [1, 500],
  [1, 1000],
];

const trimNum = (v: number) => String(Math.round(v * 1e6) / 1e6);
/** popisek měřítka z poměru papír : skutečnost (0,02 → „1:50“, 2 → „2:1“) */
export function ratioLabel(r: number): string {
  if (!(r > 0) || !Number.isFinite(r)) return "?";
  if (Math.abs(r - 1) < 1e-12) return "1:1";
  if (r < 1) return `1:${trimNum(1 / r)}`;
  return `${trimNum(r)}:1`;
}

/**
 * Měřítko ze zápisu: „1:50“, „1/50“, „2:1“, „0.02“, „50xp“ / „1/50xp“ (jako ZOOM XP), „1=50“. Vrací poměr papír : skutečnost.
 * Chyba = výjimka s důvodem.
 */
export function parseRatio(raw: string): number {
  const t = raw.trim().toLowerCase().replace(/xp$/, "").replace(",", ".");
  const m = /^([\d.]+)\s*[:/=]\s*([\d.]+)$/.exec(t);
  let r: number;
  if (m) r = Number(m[1]) / Number(m[2]);
  else r = evalNumber(t);
  if (!(r > 0) || !Number.isFinite(r)) throw new Error(tr("neplatné měřítko „{0}“ – např. 1:50, 2:1, 1:2.5 nebo 0.02", raw));
  return r;
}

/** milimetry na jednotku výkresu (bez jednotek = mm) */
export const unitMm = (m: DraftModel) => UNITS[m.vars.units]?.mm ?? 1;
/** poměr papír : skutečnost → DViewport.scale (jednotek papíru [mm] na jednotku modelu) */
export const ratioToScale = (m: DraftModel, ratio: number) => ratio * unitMm(m);
export const scaleToRatio = (m: DraftModel, scale: number) => scale / unitMm(m);
/** popisek měřítka výřezu */
export const vpScaleLabel = (m: DraftModel, vp: Pick<DViewport, "scale">) => ratioLabel(scaleToRatio(m, vp.scale));

/** největší standardní měřítko ISO, při kterém se rozměr (mm skutečnosti) vejde do plochy (mm papíru) */
export function fitIsoRatio(realW: number, realH: number, paperW: number, paperH: number): number {
  const need = Math.min(paperW / Math.max(1e-9, realW), paperH / Math.max(1e-9, realH));
  let best = ISO_SCALES[ISO_SCALES.length - 1];
  for (const s of ISO_SCALES) {
    const r = s[0] / s[1];
    if (r <= need * (1 + 1e-9)) {
      best = s;
      break;
    }
  }
  return best[0] / best[1];
}

/** formát čísla pro protokol (bez zbytečných nul) */
export const nfmt = (v: number, d = 4) => String(Math.round(v * 10 ** d) / 10 ** d);
