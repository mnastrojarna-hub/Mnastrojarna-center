/**
 * Společný formát 2D výkresu (DXF, DWG) pro prohlížeč: hladiny a entity ve světových souřadnicích
 * výkresu v mm (bloky / INSERT / kóty už rozbalené, transformace zapečené).
 */

/** Barva RGB 0–1; `fg` = barva „podle pozadí" (ACI 7 — černá na světlém, bílá na tmavém). */
export type DrawColor = [number, number, number] | "fg";

export interface DrawLayer {
  name: string;
  color: DrawColor;
  /** Vypnutá / zmrazená hladina ve výkresu — po otevření skrytá. */
  off?: boolean;
}

export type Pt = [number, number];

export type DrawEntity =
  | { kind: "line"; layer: string; color: DrawColor; a: Pt; b: Pt }
  /** Lomená čára; bulge (DXF) = tan(úhel/4) oblouku k dalšímu vrcholu, 0 = rovně. */
  | { kind: "polyline"; layer: string; color: DrawColor; points: Pt[]; bulges?: number[]; closed: boolean }
  | { kind: "circle"; layer: string; color: DrawColor; c: Pt; r: number }
  /** Oblouk proti směru hodin od start do end (radiány). */
  | { kind: "arc"; layer: string; color: DrawColor; c: Pt; r: number; start: number; end: number }
  /** Elipsa: střed, konec hlavní poloosy (relativně), poměr os, parametry start / end (radiány). */
  | { kind: "ellipse"; layer: string; color: DrawColor; c: Pt; major: Pt; ratio: number; start: number; end: number }
  /** Obecná křivka (spline) už rozložená na body. */
  | { kind: "curve"; layer: string; color: DrawColor; points: Pt[]; closed: boolean }
  | { kind: "point"; layer: string; color: DrawColor; p: Pt }
  /** Text: poloha = bod vložení podle zarovnání, výška v mm, rotace v radiánech. */
  | {
    kind: "text"; layer: string; color: DrawColor; p: Pt; text: string; height: number; rotation: number;
    /** Vodorovné zarovnání (left / center / right) a svislé (baseline / bottom / middle / top). */
    hAlign: "left" | "center" | "right"; vAlign: "baseline" | "bottom" | "middle" | "top";
    /** Šířka odstavce (MTEXT) — zalomení řádků. */
    width?: number;
  };

export interface Drawing2D {
  layers: DrawLayer[];
  entities: DrawEntity[];
  /** Zdroj pro informace, např. „DXF (R2018)", „DWG (AC1032)". */
  format: string;
  warnings?: string[];
}

/** AutoCAD Color Index → RGB (0–1). 7 = barva popředí. Plná tabulka 256 barev. */
export function aciColor(i: number): DrawColor {
  if (i === 7 || i === 0 || i === 256 || i === 257) return "fg";
  const c = ACI[Math.abs(i) % 256] ?? 0xffffff;
  return [((c >> 16) & 255) / 255, ((c >> 8) & 255) / 255, (c & 255) / 255];
}

/** True color (DXF kód 420) → RGB. */
export function trueColor(n: number): DrawColor {
  return [((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255];
}

// Standardní paleta ACI (index → 0xRRGGBB)
const ACI: number[] = (() => {
  const base = [
    0x000000, 0xff0000, 0xffff00, 0x00ff00, 0x00ffff, 0x0000ff, 0xff00ff, 0xffffff, 0x808080, 0xc0c0c0,
  ];
  const out = [...base];
  // 10–249: odstíny po 24° × 5 jasů × 2 sytosti (aproximace tabulky AutoCADu)
  for (let i = 10; i < 250; i++) {
    const hue = Math.floor((i - 10) / 10) * 15;
    const k = (i - 10) % 10;
    const value = [1, 1, 0.8, 0.8, 0.6, 0.6, 0.5, 0.5, 0.3, 0.3][k];
    const sat = k % 2 === 0 ? 1 : 0.5;
    out.push(hsv(hue, sat, value));
  }
  // 250–255: šedé
  for (const g of [0x333333, 0x505050, 0x696969, 0x828282, 0xbebebe, 0xffffff]) out.push(g);
  return out;
})();

function hsv(h: number, s: number, v: number): number {
  const f = (n: number) => {
    const k = (n + h / 60) % 6;
    return v - v * s * Math.max(0, Math.min(k, 4 - k, 1));
  };
  return (Math.round(f(5) * 255) << 16) | (Math.round(f(3) * 255) << 8) | Math.round(f(1) * 255);
}

/** Jednotky výkresu ($INSUNITS) → násobek na mm. */
export function insunitsToMm(code: number | undefined): number {
  switch (code) {
    case 1: return 25.4; // palce
    case 2: return 304.8; // stopy
    case 5: return 10; // cm
    case 6: return 1000; // m
    case 7: return 1_000_000; // km
    case 8: return 0.0000254; // mikropalce
    case 9: return 0.0254; // mils
    case 10: return 914.4; // yardy
    case 13: return 0.001; // mikrometry
    case 14: return 100; // dm
    default: return 1; // mm nebo bez jednotek
  }
}

/** Formátovací kódy MTEXT / speciální znaky → čistý text (řádky odděleny \n). */
export function plainText(s: string): string {
  return s
    .replace(/\\P/g, "\n")
    .replace(/\\[Ss]([^;]*?)[#^/]([^;]*?);/g, "$1/$2")
    .replace(/\\[fFHhWwQqTtAaCcpL][^;\\]*;?/g, (m) => (/^\\[Ll]$/.test(m) ? "" : ""))
    .replace(/\\[LlOoKk]/g, "")
    .replace(/\\~/g, " ")
    .replace(/\\\\/g, "\\")
    .replace(/[{}]/g, "")
    .replace(/%%[cC]/g, "Ø") // ⌀ v písmu Roboto chybí
    .replace(/%%[dD]/g, "°")
    .replace(/%%[pP]/g, "±")
    .replace(/%%%/g, "%")
    .replace(/%%[uUoO]/g, "")
    .replace(/\\U\+([0-9a-fA-F]{4})/g, (_, h: string) => String.fromCharCode(parseInt(h, 16)));
}
