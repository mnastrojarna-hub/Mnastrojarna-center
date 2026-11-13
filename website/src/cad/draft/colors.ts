/**
 * Barvy 2D výkresu: indexové barvy AutoCADu (ACI 1–255), pravé barvy #rrggbb, ByLayer / ByBlock.
 * Tabulka ACI odpovídá standardní paletě (1–9 pevné, 10–249 odstín × jas × sytost, 250–255 šedé).
 */
import { tr } from "../i18n";
import type { DraftColor } from "./model";

const fixed: [number, number, number][] = [
  [0, 0, 0],
  [255, 0, 0],
  [255, 255, 0],
  [0, 255, 0],
  [0, 255, 255],
  [0, 0, 255],
  [255, 0, 255],
  [255, 255, 255],
  [65, 65, 65],
  [128, 128, 128],
];
const GRAYS = [51, 80, 105, 130, 190, 255];
const VAL = [255, 189, 129, 104, 79];

function hsv(h: number, s: number, v: number): [number, number, number] {
  const c = v * s;
  const x = c * (1 - Math.abs(((h / 60) % 2) - 1));
  const m = v - c;
  const [r, g, b] = h < 60 ? [c, x, 0] : h < 120 ? [x, c, 0] : h < 180 ? [0, c, x] : h < 240 ? [0, x, c] : h < 300 ? [x, 0, c] : [c, 0, x];
  return [Math.round(r + m), Math.round(g + m), Math.round(b + m)];
}

/** RGB barvy ACI (0–255; 0 = ByBlock, 256 = ByLayer → černá/bílá dle pozadí řeší volající). */
export function aciRgb(i: number): [number, number, number] {
  if (i >= 1 && i <= 9) return fixed[i];
  if (i >= 250 && i <= 255) {
    const g = GRAYS[i - 250];
    return [g, g, g];
  }
  if (i >= 10 && i <= 249) {
    const k = i - 10;
    const hue = Math.floor(k / 10) * 15;
    const d = k % 10;
    return hsv(hue, d % 2 ? 1 / 3 : 1, VAL[Math.floor(d / 2)]);
  }
  return [255, 255, 255];
}

const hex2 = (n: number) => n.toString(16).padStart(2, "0");
export const rgbHex = ([r, g, b]: [number, number, number]) => `#${hex2(r)}${hex2(g)}${hex2(b)}`;
export const aciHex = (i: number) => rgbHex(aciRgb(i));
export function hexRgb(h: string): [number, number, number] | null {
  const m = /^#?([0-9a-f]{6})$/i.exec(h.trim());
  if (!m) return null;
  const n = parseInt(m[1], 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

/** Nejbližší barva ACI (1–255) k RGB – pro starší formáty bez pravých barev. */
export function nearestAci(rgb: [number, number, number]): number {
  let best = 7;
  let bd = Infinity;
  for (let i = 1; i <= 255; i++) {
    const [r, g, b] = aciRgb(i);
    const d = (r - rgb[0]) ** 2 + (g - rgb[1]) ** 2 + (b - rgb[2]) ** 2;
    if (d < bd) {
      bd = d;
      best = i;
    }
  }
  return best;
}

/** jména barev 1–7 ve všech jazycích (pro zadání textem) */
const NAMES: [number, string[]][] = [
  [1, ["red", "cervena", "rot", "r"]],
  [2, ["yellow", "zluta", "gelb", "y"]],
  [3, ["green", "zelena", "grun", "gruen", "g"]],
  [4, ["cyan", "azurova", "tyrkysova", "c"]],
  [5, ["blue", "modra", "blau", "b"]],
  [6, ["magenta", "purpurova", "fialova", "m"]],
  [7, ["white", "bila", "black", "cerna", "weiss", "schwarz", "w"]],
];
const fold = (s: string) => s.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/ß/g, "ss");

/**
 * Barva ze zadání textem: „ByLayer“ / „dlehladiny“ / „vonlayer“, „ByBlock“ / „dlebloku“ / „vonblock“, číslo ACI 1–255,
 * název (červená / red / rot…), „#rrggbb“ nebo „r,g,b“. Neplatné → null.
 */
export function parseColor(raw: string): DraftColor | null {
  const t = fold(raw.trim()).replace(/[\s_-]/g, "");
  if (!t) return null;
  if (["bylayer", "dlehladiny", "hladina", "vonlayer", "layer"].includes(t)) return "ByLayer";
  if (["byblock", "dlebloku", "blok", "vonblock", "block"].includes(t)) return "ByBlock";
  if (/^\d+$/.test(t)) {
    const n = Number(t);
    return n >= 1 && n <= 255 ? n : null;
  }
  if (/^#?[0-9a-f]{6}$/.test(t)) return `#${t.replace("#", "")}`;
  const m = /^(\d{1,3}),(\d{1,3}),(\d{1,3})$/.exec(t);
  if (m) {
    const c = [Number(m[1]), Number(m[2]), Number(m[3])] as [number, number, number];
    return c.every((x) => x <= 255) ? rgbHex(c) : null;
  }
  for (const [i, names] of NAMES) if (names.includes(t)) return i;
  return null;
}

/** Popis barvy pro panel vlastností a protokol (ACI s názvem u 1–7). */
export function colorLabel(c: DraftColor | undefined): string {
  if (c === undefined || c === "ByLayer") return tr("DleHladiny");
  if (c === "ByBlock") return tr("DleBloku");
  if (typeof c === "number") {
    const nm = ["", tr("červená"), tr("žlutá"), tr("zelená"), tr("azurová"), tr("modrá"), tr("purpurová"), tr("bílá")][c];
    return nm ? `${c} (${nm})` : String(c);
  }
  return c;
}

/** Zobrazovaná barva: ACI 7 a černá/bílá podle pozadí (jako AutoCAD). */
export function displayHex(c: number | string, darkBg: boolean): string {
  if (typeof c === "number") {
    if (c === 7) return darkBg ? "#ffffff" : "#000000";
    return aciHex(c);
  }
  const rgb = hexRgb(c);
  if (!rgb) return darkBg ? "#ffffff" : "#000000";
  // pravá bílá na světlém pozadí / černá na tmavém by nebyla vidět
  if (!darkBg && rgb[0] > 245 && rgb[1] > 245 && rgb[2] > 245) return "#000000";
  if (darkBg && rgb[0] < 10 && rgb[1] < 10 && rgb[2] < 10) return "#ffffff";
  return c.toLowerCase();
}
