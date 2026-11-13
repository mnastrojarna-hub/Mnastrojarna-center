/**
 * Značky kót ISO 129-1 / ISO 15786 jako geometrie + popis s odkazovou čarou (díry, sražení, zaoblení, roztečná kružnice).
 *
 * Písmo výkresu (Roboto ve PDF, isocp.shx v DXF/DWG) značky hloubky ↧, válcového zahloubení ⌴ a kuželového zahloubení ⌵
 * nemá – proto se ve všech výstupech (náhled listu, SVG, PDF, DXF, DWG) kreslí čarami (jako značky geometrických tolerancí
 * ISO 1101). Text kolem značky se rozdělí na úseky ukotvené k okrajům značky, takže skutečná šířka písma nevadí.
 * Ø, ×, °, ± jsou běžné znaky písma (Roboto je má, DXF je zapisuje jako \U+00D8 …).
 *
 * Bez běhové závislosti na cad/drawing.ts (ten tento soubor importuje) – jen typy.
 */
import type { DText, Poly } from "./drawing";
import type { DrawingAnnotation, Vec2 } from "./types";

/** znaky kreslené jako geometrie */
export const GLYPHS = "↧⌴⌵";
const GLYPH_RE = /[↧⌴⌵]/;
/** šířka značky (em) včetně okrajů */
const GW = 0.92;

/** přibližné šířky znaků písma Roboto (em) – pro rozvržení kót a kontrolu překryvů textů */
const W: Record<string, number> = { " ": 0.248, ",": 0.197, ".": 0.264, ":": 0.242, "-": 0.276, "–": 0.6, "(": 0.342, ")": 0.348, "Ø": 0.688, "ø": 0.56, "×": 0.534, "°": 0.377, "±": 0.535, "M": 0.872, "R": 0.63, "W": 0.887, "m": 0.876, "w": 0.75, "i": 0.243, "l": 0.243, "j": 0.239, "I": 0.272, "f": 0.348, "t": 0.327, "r": 0.338, "/": 0.412 };
const charW = (c: string) => (GLYPH_RE.test(c) ? GW : W[c] ?? (/\d/.test(c) ? 0.562 : /[A-ZÁ-Ž]/.test(c) ? 0.66 : 0.54));
/** šířka textu v mm (velikost písma `size` v mm) */
export const textWidth = (s: string, size: number) => [...s].reduce((a, c) => a + charW(c), 0) * size;

export type Box = { x0: number; y0: number; x1: number; y1: number };
/** obdélník textu na listu (osově rovnoběžný obal, i u otočeného textu) */
export function textBox(t: Pick<DText, "x" | "y" | "s" | "size" | "anchor" | "rotate">): Box {
  const w = textWidth(t.s, t.size);
  const a = t.anchor === "middle" ? -w / 2 : t.anchor === "end" ? -w : 0;
  const corners: Vec2[] = [
    [a, -0.72 * t.size],
    [a + w, -0.72 * t.size],
    [a + w, 0.2 * t.size],
    [a, 0.2 * t.size],
  ];
  const th = ((t.rotate ?? 0) * Math.PI) / 180;
  const c = Math.cos(th);
  const s = Math.sin(th);
  const pts = corners.map(([x, y]) => [t.x + x * c - y * s, t.y + x * s + y * c]);
  return { x0: Math.min(...pts.map((p) => p[0])), y0: Math.min(...pts.map((p) => p[1])), x1: Math.max(...pts.map((p) => p[0])), y1: Math.max(...pts.map((p) => p[1])) };
}
export const boxesOverlap = (a: Box, b: Box, gap = 0) => a.x0 < b.x1 + gap && b.x0 < a.x1 + gap && a.y0 < b.y1 + gap && b.y0 < a.y1 + gap;

/** geometrie značky v souřadnicích em (počátek = levý konec na účaří, y dolů) */
function glyphLines(ch: string): Vec2[][] {
  switch (ch) {
    case "↧": // hloubka: šipka dolů na vodorovnou čáru
      return [
        [[0.46, -0.74], [0.46, -0.04]],
        [[0.3, -0.26], [0.46, -0.04], [0.62, -0.26]],
        [[0.16, 0], [0.76, 0]],
      ];
    case "⌴": // válcové zahloubení
      return [[[0.16, -0.62], [0.16, 0], [0.76, 0], [0.76, -0.62]]];
    case "⌵": // kuželové zahloubení
      return [[[0.12, -0.64], [0.46, 0], [0.8, -0.64]]];
    default:
      return [];
  }
}

/**
 * Text se značkami ↧ ⌴ ⌵ → úseky textu + čáry značek. Úsek před značkou se ukotví koncem k jejímu levému okraji,
 * úsek za značkou začátkem k pravému – mezi písmem a značkou tak nezůstane mezera ani překryv.
 */
export function splitSymbols(t: DText, layer: Poly["layer"] = "dim"): { texts: DText[]; polys: Poly[] } {
  if (!GLYPH_RE.test(t.s)) return { texts: [t], polys: [] };
  const parts = t.s.split(/([↧⌴⌵])/).filter((p) => p !== "");
  const size = t.size;
  const total = textWidth(t.s, size);
  let x = t.anchor === "middle" ? -total / 2 : t.anchor === "end" ? -total : 0;
  const th = ((t.rotate ?? 0) * Math.PI) / 180;
  const c = Math.cos(th);
  const s = Math.sin(th);
  const P = (dx: number, dy: number): Vec2 => [t.x + dx * c - dy * s, t.y + dx * s + dy * c];
  const texts: DText[] = [];
  const polys: Poly[] = [];
  parts.forEach((p, i) => {
    if (GLYPH_RE.test(p)) {
      for (const l of glyphLines(p)) polys.push({ layer, pts: l.map(([gx, gy]) => P(x + gx * size, gy * size)) });
      x += GW * size;
      return;
    }
    const w = textWidth(p, size);
    const nextGlyph = i + 1 < parts.length && GLYPH_RE.test(parts[i + 1]);
    const prevGlyph = i > 0 && GLYPH_RE.test(parts[i - 1]);
    // před značkou (a ne hned za jinou) → ukotvit koncem; jinak začátkem. Mezery u značky SVG/PDF na okraji textu
    // zahodí – převedou se na posun (zachová se rozestup jako v textu)
    const atEnd = nextGlyph && !prevGlyph;
    const lead = prevGlyph ? (/^ +/.exec(p)?.[0].length ?? 0) : 0;
    const trail = nextGlyph ? (/ +$/.exec(p)?.[0].length ?? 0) : 0;
    const core = p.slice(lead, p.length - trail);
    if (core) {
      const sp = textWidth(" ", size);
      const [px, py] = P(atEnd ? x + w - trail * sp : x + lead * sp, 0);
      const { anchor: _a, ...rest } = t;
      void _a;
      const run: DText = { ...rest, x: px, y: py, s: core };
      if (atEnd) run.anchor = "end";
      texts.push(run);
    }
    x += w;
  });
  return { texts, polys };
}

/** Všechny texty se značkami → úseky + čáry (výsledek annotationGeometry / výkresu). */
export function symbolsAsGeometry<T extends { polys: Poly[]; texts: DText[] }>(g: T): T {
  if (!g.texts.some((t) => GLYPH_RE.test(t.s))) return g;
  const polys = [...g.polys];
  const texts: DText[] = [];
  for (const t of g.texts) {
    const r = splitSymbols(t, t.layer === "text" ? "thin" : "dim");
    texts.push(...r.texts);
    polys.push(...r.polys);
  }
  return { ...g, polys, texts };
}

// ---------------------------------------------------------------- popis s odkazovou čarou

export type Callout = Extract<DrawingAnnotation, { type: "callout" }>;
export const CALLOUT_SIZE = 3.5;
/** řádkování víceřádkového popisu [mm] */
export const CALLOUT_LEAD = 5.2;

/** první řádek s tolerancí za prvním označením (M8 → M8-6H, Ø8,5 → Ø8,5H7, jinak na konec) */
export function calloutLines(a: Pick<Callout, "lines" | "tol">): string[] {
  if (!a.tol?.trim() || !a.lines.length) return a.lines;
  const tol = a.tol.trim();
  const [first, ...rest] = a.lines;
  const m = /(M\d+(?:[.,]\d+)?(?:×\d+(?:[.,]\d+)?)?|Ø\d+(?:[.,]\d+)?|R\d+(?:[.,]\d+)?)/.exec(first);
  if (!m) return [`${first} ${tol}`, ...rest];
  const sep = m[1].startsWith("M") ? "-" : "";
  const at = m.index + m[1].length;
  return [`${first.slice(0, at)}${sep}${tol}${first.slice(at)}`, ...rest];
}

/** Texty popisu (souřadnice listu): první řádek nad policí, další pod ní; `right` = text vpravo od kolena. */
export function calloutTexts(K: Vec2, lines: string[], right: boolean): DText[] {
  return lines.map((s, i) => ({
    x: K[0] + (right ? 1 : -1),
    y: i === 0 ? K[1] - 1 : K[1] + CALLOUT_SIZE + 0.4 + (i - 1) * CALLOUT_LEAD,
    s,
    size: CALLOUT_SIZE,
    anchor: right ? ("start" as const) : ("end" as const),
    layer: "dim" as const,
  }));
}

function arrowTo(polys: Poly[], tip: Vec2, dir: Vec2) {
  const l = 3;
  const w = 0.8;
  const d = Math.hypot(dir[0], dir[1]) || 1;
  const ux = dir[0] / d;
  const uy = dir[1] / d;
  polys.push({ layer: "dim", fill: true, pts: [tip, [tip[0] - ux * l - uy * w, tip[1] - uy * l + ux * w], [tip[0] - ux * l + uy * w, tip[1] - uy * l - ux * w], tip] });
}

/** Geometrie popisu: (osová kružnice) + odkazová čára se šipkou + police + řádky textu. `S` = souřadnice pohledu → list. */
export function calloutGeometry(polys: Poly[], texts: DText[], a: Callout, S: (q: Vec2) => Vec2) {
  if (a.circle) {
    const n = 72;
    const pts: Vec2[] = [];
    for (let i = 0; i <= n; i++) pts.push(S([a.circle.c[0] + a.circle.r * Math.cos((2 * Math.PI * i) / n), a.circle.c[1] + a.circle.r * Math.sin((2 * Math.PI * i) / n)]));
    polys.push({ layer: "center", pts });
  }
  const T = S(a.tip);
  const K = S(a.at);
  const lines = calloutLines(a);
  const right = K[0] >= T[0];
  const w = Math.max(6, ...lines.map((l) => textWidth(l, CALLOUT_SIZE))) + 2;
  polys.push({ layer: "dim", pts: [T, K, [K[0] + (right ? w : -w), K[1]]] });
  arrowTo(polys, T, [T[0] - K[0], T[1] - K[1]]);
  texts.push(...calloutTexts(K, lines, right));
}
