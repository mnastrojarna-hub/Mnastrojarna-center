/**
 * Typy čar 2D výkresu: knihovna jako acadiso.lin (mm) / acad.lin (palce), načtení do výkresu, čtení souborů .lin
 * a přesný rozklad dráhy na čárky a tečky podle vzoru (pro tisk, PDF a testy; obrazovka používá setLineDash se stejnými délkami).
 */
import type { DraftLinetype, DraftModel, Vec2 } from "./model";

/** vzory v palcích (acad.lin); metrická knihovna = ×25,4 (acadiso.lin) */
const BASE: [string, string, number[]][] = [
  ["BORDER", "Border __ __ . __ __ . __ __ . __ __ . __ __ .", [0.5, -0.25, 0.5, -0.25, 0, -0.25]],
  ["CENTER", "Center ____ _ ____ _ ____ _ ____ _ ____ _ ____", [1.25, -0.25, 0.25, -0.25]],
  ["DASHDOT", "Dash dot __ . __ . __ . __ . __ . __ . __ . __", [0.5, -0.25, 0, -0.25]],
  ["DASHED", "Dashed __ __ __ __ __ __ __ __ __ __ __ __ __ _", [0.5, -0.25]],
  ["DIVIDE", "Divide ____ . . ____ . . ____ . . ____ . . ____", [0.5, -0.25, 0, -0.25, 0, -0.25]],
  ["DOT", "Dot . . . . . . . . . . . . . . . . . . . . . . . .", [0, -0.25]],
  ["HIDDEN", "Hidden __ __ __ __ __ __ __ __ __ __ __ __ __ __", [0.25, -0.125]],
  ["PHANTOM", "Phantom ______  __  __  ______  __  __  ______", [1.25, -0.25, 0.25, -0.25, 0.25, -0.25]],
];

/** Knihovna typů čar: 8 základních + varianty „2“ (poloviční) a „X2“ (dvojnásobné), metrická nebo palcová. */
export function linetypeLibrary(metric = true): DraftLinetype[] {
  const k = metric ? 25.4 : 1;
  const out: DraftLinetype[] = [{ name: "Continuous", desc: "Solid line", pattern: [] }];
  for (const [name, desc, pat] of BASE) {
    const p = pat.map((x) => round6(x * k));
    out.push({ name, desc, pattern: p });
    out.push({ name: `${name}2`, desc: `${desc.split(" ")[0]} (.5x)`, pattern: p.map((x) => round6(x / 2)) });
    out.push({ name: `${name}X2`, desc: `${desc.split(" ")[0]} (2x)`, pattern: p.map((x) => round6(x * 2)) });
  }
  return out;
}
const round6 = (x: number) => Math.round(x * 1e6) / 1e6;

/** typy čar, které má nový výkres (jako šablona acadiso.dwt + běžně používané) */
export const DEFAULT_LINETYPES = ["Continuous", "DASHED", "HIDDEN", "CENTER", "PHANTOM", "DOT", "DASHDOT", "DIVIDE", "BORDER"];

export const isContinuous = (lt: DraftLinetype | null | undefined) => !lt || lt.pattern.length === 0 || lt.pattern.every((x) => x > 0);

/** Najde typ čáry ve výkresu (bez ohledu na velikost písmen). */
export const findLinetype = (m: DraftModel, name: string): DraftLinetype | undefined => {
  const n = name.toLowerCase();
  return m.linetypes.find((l) => l.name.toLowerCase() === n);
};

/** Načte typ čáry z knihovny do výkresu (už načtený / neznámý → beze změny; vrací [model, nalezený typ]). */
export function loadLinetype(m: DraftModel, name: string): [DraftModel, DraftLinetype | null] {
  const have = findLinetype(m, name);
  if (have) return [m, have];
  const lib = linetypeLibrary(m.vars.measurement === 1).find((l) => l.name.toLowerCase() === name.toLowerCase());
  if (!lib) return [m, null];
  return [{ ...m, linetypes: [...m.linetypes, lib] }, lib];
}

/**
 * Čtení souboru .lin (jednoduché typy čar): `*NÁZEV,popis` a `A,12.7,-6.35,0,-6.35`. Složité typy (tvary, text v [ ])
 * se načtou bez vložených prvků (vzor čar a mezer zůstává).
 */
export function parseLin(text: string): DraftLinetype[] {
  const out: DraftLinetype[] = [];
  let cur: DraftLinetype | null = null;
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.replace(/;;.*$/, "").trim();
    if (!line) continue;
    if (line.startsWith("*")) {
      const i = line.indexOf(",");
      cur = { name: (i < 0 ? line.slice(1) : line.slice(1, i)).trim(), desc: i < 0 ? "" : line.slice(i + 1).trim(), pattern: [] };
      out.push(cur);
    } else if (cur && /^a\s*,/i.test(line)) {
      cur.pattern = line
        .replace(/\[[^\]]*\]/g, "")
        .split(",")
        .slice(1)
        .filter((s) => s.trim() !== "")
        .map((s) => Number(s.trim()))
        .filter((x) => Number.isFinite(x));
    }
  }
  return out;
}

/** délka jedné periody vzoru */
export const patternLength = (p: number[]) => p.reduce((s, x) => s + Math.abs(x), 0);

/**
 * Rozloží lomenou čáru (body ve světových souřadnicích) na čárky podle vzoru × měřítko: vrací úsečky čárek
 * a body teček. Vzor začíná na začátku dráhy a pokračuje přes vrcholy (jako PLINEGEN = 1).
 */
export function dashPolyline(pts: Vec2[], pattern: number[], scale: number): { dashes: [Vec2, Vec2][]; dots: Vec2[] } {
  const dashes: [Vec2, Vec2][] = [];
  const dots: Vec2[] = [];
  if (pts.length < 2) return { dashes, dots };
  const pat = pattern.map((x) => x * scale);
  const period = patternLength(pat);
  if (!pat.length || period <= 1e-12 || pat.every((x) => x > 0)) {
    for (let i = 1; i < pts.length; i++) dashes.push([pts[i - 1], pts[i]]);
    return { dashes, dots };
  }
  let k = 0; // index prvku vzoru
  let left = Math.abs(pat[0]); // zbývající délka aktuálního prvku
  let open: Vec2 | null = pat[0] > 0 ? pts[0] : null;
  if (pat[0] === 0) dots.push(pts[0]);
  const advance = () => {
    k = (k + 1) % pat.length;
    left = Math.abs(pat[k]);
  };
  if (pat[0] === 0) advance();
  for (let i = 1; i < pts.length; i++) {
    const a = pts[i - 1];
    const b = pts[i];
    const L = Math.hypot(b[0] - a[0], b[1] - a[1]);
    let s = 0;
    let guard = 0;
    while (s < L - 1e-12 && guard++ < 1e6) {
      const step = Math.min(left, L - s);
      s += step;
      left -= step;
      const p: Vec2 = [a[0] + ((b[0] - a[0]) * s) / L, a[1] + ((b[1] - a[1]) * s) / L];
      if (left <= 1e-12) {
        // konec prvku vzoru
        if (pat[k] > 0 && open) {
          dashes.push([open, p]);
          open = null;
        }
        advance();
        while (pat[k] === 0) {
          dots.push(p);
          advance();
          if (guard++ > 1e6) break;
        }
        if (pat[k] > 0) open = p;
      }
    }
    if (open && pat[k] > 0) {
      // čárka pokračuje přes vrchol
      dashes.push([open, b]);
      open = b;
    }
  }
  return { dashes: mergeDashes(dashes), dots };
}

/** spojí navazující úsečky čárek přes vrcholy (stejná čárka přes roh = 2 úsečky, ne přerušení) */
function mergeDashes(d: [Vec2, Vec2][]): [Vec2, Vec2][] {
  return d.filter(([a, b]) => Math.hypot(b[0] - a[0], b[1] - a[1]) > 1e-12);
}
