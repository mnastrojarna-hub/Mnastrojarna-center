/**
 * Tolerance uložení ISO 286-1:2010 (soustava lícování): základní úchylky děr (A…ZC, H, JS, J, K, M, N…) a hřídelů
 * (a…zc, h, js, j, k, m, n…) a stupně přesnosti IT1…IT18 pro jmenovité rozměry do 500 mm.
 * Úchylky v µm (celá čísla, ISO tabulky), výpočet mezních úchylek a rozměrů, druh uložení (s vůlí / přechodné / s přesahem)
 * a zápis na výkres „Ø40 H7 (+0,025/0)“ nebo mezními rozměry „(40,025/40,000)“.
 * Čistý modul bez jádra – používá ho výkres (kóty, Tabulka uložení), textové příkazy i výběr uložení ve výkresovém prostředí.
 */
import { cadLocale, tr } from "./i18n";

/** horní hranice rozsahů jmenovitých rozměrů pro stupně IT (ISO 286-1, tab. 1) */
const IT_RANGES = [3, 6, 10, 18, 30, 50, 80, 120, 180, 250, 315, 400, 500];
/** IT1…IT18 [µm] pro rozsahy IT_RANGES */
const IT: number[][] = [
  [0.8, 1.2, 2, 3, 4, 6, 10, 14, 25, 40, 60, 100, 140, 250, 400, 600, 1000, 1400],
  [1, 1.5, 2.5, 4, 5, 8, 12, 18, 30, 48, 75, 120, 180, 300, 480, 750, 1200, 1800],
  [1, 1.5, 2.5, 4, 6, 9, 15, 22, 36, 58, 90, 150, 220, 360, 580, 900, 1500, 2200],
  [1.2, 2, 3, 5, 8, 11, 18, 27, 43, 70, 110, 180, 270, 430, 700, 1100, 1800, 2700],
  [1.5, 2.5, 4, 6, 9, 13, 21, 33, 52, 84, 130, 210, 330, 520, 840, 1300, 2100, 3300],
  [1.5, 2.5, 4, 7, 11, 16, 25, 39, 62, 100, 160, 250, 390, 620, 1000, 1600, 2500, 3900],
  [2, 3, 5, 8, 13, 19, 30, 46, 74, 120, 190, 300, 460, 740, 1200, 1900, 3000, 4600],
  [2.5, 4, 6, 10, 15, 22, 35, 54, 87, 140, 220, 350, 540, 870, 1400, 2200, 3500, 5400],
  [3.5, 5, 8, 12, 18, 25, 40, 63, 100, 160, 250, 400, 630, 1000, 1600, 2500, 4000, 6300],
  [4.5, 7, 10, 14, 20, 29, 46, 72, 115, 185, 290, 460, 720, 1150, 1850, 2900, 4600, 7200],
  [6, 8, 12, 16, 23, 32, 52, 81, 130, 210, 320, 520, 810, 1300, 2100, 3200, 5200, 8100],
  [7, 9, 13, 18, 25, 36, 57, 89, 140, 230, 360, 570, 890, 1400, 2300, 3600, 5700, 8900],
  [8, 10, 15, 20, 27, 40, 63, 97, 155, 250, 400, 630, 970, 1550, 2500, 4000, 6300, 9700],
];

/** jemnější rozsahy pro základní úchylky (ISO 286-1, tab. 2 a 3) – horní hranice */
const FD_RANGES = [3, 6, 10, 14, 18, 24, 30, 40, 50, 65, 80, 100, 120, 140, 160, 180, 200, 225, 250, 280, 315, 355, 400, 450, 500];
/** rozsah IT (index do IT_RANGES) pro každý jemnější rozsah */
const FD_TO_IT = FD_RANGES.map((hi) => IT_RANGES.findIndex((x) => hi <= x));

/** zápis hodnot po hrubších rozsazích IT (13 hodnot) do jemných rozsahů FD (25 hodnot) */
const byIt = (v: (number | null)[]): (number | null)[] => FD_TO_IT.map((i) => v[i]);
const N = null;

/** Horní úchylka es hřídelů a…h [µm] (záporné) – jemné rozsahy FD_RANGES. */
const SHAFT_ES: Record<string, (number | null)[]> = {
  a: [-270, -270, -280, -290, -290, -300, -300, -310, -320, -340, -360, -380, -410, -460, -520, -580, -660, -740, -820, -920, -1050, -1200, -1350, -1500, -1650],
  b: [-140, -140, -150, -150, -150, -160, -160, -170, -180, -190, -200, -220, -240, -260, -280, -310, -340, -380, -420, -480, -540, -600, -680, -760, -840],
  c: [-60, -70, -80, -95, -95, -110, -110, -120, -130, -140, -150, -170, -180, -200, -210, -230, -240, -260, -280, -300, -330, -360, -400, -440, -480],
  cd: [-34, -46, -56, ...Array(22).fill(N)],
  d: byIt([-20, -30, -40, -50, -65, -80, -100, -120, -145, -170, -190, -210, -230]),
  e: byIt([-14, -20, -25, -32, -40, -50, -60, -72, -85, -100, -110, -125, -135]),
  ef: [-10, -14, -18, ...Array(22).fill(N)],
  f: byIt([-6, -10, -13, -16, -20, -25, -30, -36, -43, -50, -56, -62, -68]),
  fg: [-4, -6, -8, ...Array(22).fill(N)],
  g: byIt([-2, -4, -5, -6, -7, -9, -10, -12, -14, -15, -17, -18, -20]),
  h: Array(25).fill(0),
};
/** Dolní úchylka ei hřídelů m…zc [µm] (kladné) – jemné rozsahy; null = pro rozsah není definována. */
const SHAFT_EI: Record<string, (number | null)[]> = {
  m: byIt([2, 4, 6, 7, 8, 9, 11, 13, 15, 17, 20, 21, 23]),
  n: byIt([4, 8, 10, 12, 15, 17, 20, 23, 27, 31, 34, 37, 40]),
  p: byIt([6, 12, 15, 18, 22, 26, 32, 37, 43, 50, 56, 62, 68]),
  r: [10, 15, 19, 23, 23, 28, 28, 34, 34, 41, 43, 51, 54, 63, 65, 68, 77, 80, 84, 94, 98, 108, 114, 126, 132],
  s: [14, 19, 23, 28, 28, 35, 35, 43, 43, 53, 59, 71, 79, 92, 100, 108, 122, 130, 140, 158, 170, 190, 208, 232, 252],
  t: [N, N, N, N, N, N, 41, 48, 54, 66, 75, 91, 104, 122, 134, 146, 166, 180, 196, 218, 240, 268, 294, 330, 360],
  u: [18, 23, 28, 33, 33, 41, 48, 60, 70, 87, 102, 124, 144, 170, 190, 210, 236, 258, 284, 315, 350, 390, 435, 490, 540],
  v: [N, N, N, N, 39, 47, 55, 68, 81, 102, 120, 146, 172, 202, 228, 252, 284, 310, 340, 385, 425, 475, 530, 595, 660],
  x: [20, 28, 34, 40, 45, 54, 64, 80, 97, 122, 146, 178, 210, 248, 280, 310, 350, 385, 425, 475, 525, 590, 660, 740, 820],
  y: [N, N, N, N, N, 63, 75, 94, 114, 144, 174, 214, 254, 300, 340, 380, 425, 470, 520, 580, 650, 730, 820, 920, 1000],
  z: [26, 35, 42, 50, 60, 73, 88, 112, 136, 172, 210, 258, 310, 365, 415, 465, 520, 575, 640, 710, 790, 900, 1000, 1100, 1250],
  za: [32, 42, 52, 64, 77, 98, 118, 148, 180, 226, 274, 335, 400, 470, 535, 600, 670, 740, 820, 920, 1000, 1150, 1300, 1450, 1600],
  zb: [40, 50, 67, 90, 108, 136, 160, 200, 242, 300, 360, 445, 525, 620, 700, 780, 880, 960, 1050, 1200, 1300, 1500, 1650, 1850, 2100],
  zc: [60, 80, 97, 130, 150, 188, 218, 274, 325, 405, 480, 585, 690, 800, 900, 1000, 1150, 1250, 1350, 1550, 1700, 1900, 2100, 2400, 2600],
};
/** hřídel j: dolní úchylka ei pro j5 a j6, j7, j8 (rozsahy IT; j8 jen do 3 mm) */
const SHAFT_J: Record<string, (number | null)[]> = {
  "5": [-2, -2, -2, -3, -4, -5, -7, -9, -11, -13, -16, -18, -20],
  "7": [-4, -4, -5, -6, -8, -10, -12, -15, -18, -21, -26, -28, -32],
  "8": [-6, N, N, N, N, N, N, N, N, N, N, N, N],
};
/** hřídel k (k4…k7): dolní úchylka ei po rozsazích IT; ostatní stupně a rozměry do 3 mm = 0 */
const SHAFT_K = [0, 1, 1, 1, 2, 2, 2, 3, 3, 4, 4, 4, 5];
/** díra J: horní úchylka ES pro J6, J7, J8 po rozsazích IT */
const HOLE_J: Record<string, number[]> = {
  "6": [2, 5, 5, 6, 8, 10, 13, 16, 18, 22, 25, 29, 33],
  "7": [4, 6, 8, 10, 12, 14, 18, 22, 26, 30, 36, 39, 43],
  "8": [6, 10, 12, 15, 20, 24, 28, 34, 41, 47, 55, 60, 66],
};
/** hodnota Δ [µm] pro díry K, M, N (do IT8) a P…ZC (do IT7) – sloupce IT3…IT8, řádky rozsahy IT */
const DELTA: number[][] = [
  [0, 0, 0, 0, 0, 0],
  [1, 1.5, 1, 3, 4, 6],
  [1, 1.5, 2, 3, 6, 7],
  [1, 2, 3, 3, 7, 9],
  [1.5, 2, 3, 4, 8, 12],
  [1.5, 3, 4, 5, 9, 14],
  [2, 3, 5, 6, 11, 16],
  [2, 4, 5, 7, 13, 19],
  [3, 4, 6, 7, 15, 23],
  [3, 4, 6, 9, 17, 26],
  [4, 4, 7, 9, 20, 29],
  [4, 5, 7, 11, 21, 32],
  [5, 5, 7, 13, 23, 34],
];

export const FIT_MAX_SIZE = 500;
/** písmena polí tolerance (ISO 286-1) – hřídele malými, díry velkými písmeny */
export const SHAFT_LETTERS = ["a", "b", "c", "cd", "d", "e", "ef", "f", "fg", "g", "h", "js", "j", "k", "m", "n", "p", "r", "s", "t", "u", "v", "x", "y", "z", "za", "zb", "zc"];
export const HOLE_LETTERS = SHAFT_LETTERS.map((l) => l.toUpperCase());
/** obvyklé stupně přesnosti ve strojírenství (výběr ve výkresovém prostředí) */
export const COMMON_GRADES = [5, 6, 7, 8, 9, 10, 11];
/** doporučená uložení (soustava jednotné díry H a jednotného hřídele h) – výběr ve výkresovém prostředí */
export const PREFERRED_FITS = ["H7/g6", "H7/h6", "H7/js6", "H7/k6", "H7/m6", "H7/n6", "H7/p6", "H7/r6", "H7/s6", "H8/f7", "H8/h7", "H8/e8", "H9/d9", "H11/c11", "G7/h6", "F8/h7", "K7/h6", "N7/h6", "P7/h6"];

/** Pole tolerance: písmeno (díra velkým, hřídel malým) a stupeň IT. */
export type FitZone = { letter: string; grade: number; hole: boolean };
/** Mezní úchylky [µm]: horní (ES / es) a dolní (EI / ei). */
export type Deviations = { upper: number; lower: number };

const rangeIdx = (ranges: number[], size: number) => {
  if (!(size > 0) || size > ranges[ranges.length - 1] + 1e-9) return -1;
  return ranges.findIndex((hi) => size <= hi + 1e-9);
};

/** Tolerance IT [µm] pro jmenovitý rozměr (mm) a stupeň 1…18. */
export function itValue(size: number, grade: number): number {
  const i = rangeIdx(IT_RANGES, size);
  if (i < 0) throw new Error(tr("ISO 286: jmenovitý rozměr {0} mm je mimo tabulky (0 až {1} mm)", fmtMm(size), FIT_MAX_SIZE));
  if (!Number.isInteger(grade) || grade < 1 || grade > 18) throw new Error(tr("ISO 286: stupeň přesnosti IT{0} neexistuje (IT1 až IT18)", grade));
  return IT[i][grade - 1];
}

const FIT_RE = /^([A-Za-z]{1,2})(\d{1,2})$/;
/** Rozpozná pole tolerance „H7“, „g6“, „JS7“, „zc8“; jinak null. */
export function parseZone(code: string): FitZone | null {
  const m = FIT_RE.exec(code.trim());
  if (!m) return null;
  const [, l, g] = m;
  const hole = l === l.toUpperCase();
  if (!hole && l !== l.toLowerCase()) return null; // smíšená velikost písmen („Js7“)
  if (!(hole ? HOLE_LETTERS : SHAFT_LETTERS).includes(l)) return null;
  const grade = Number(g);
  if (grade < 1 || grade > 18) return null;
  return { letter: l, grade, hole };
}

/** Rozpozná zápis uložení „H7“, „g6“, „H7/g6“ (i s mezerami); jinak null. */
export function parseFit(code: string): { hole?: FitZone; shaft?: FitZone } | null {
  const s = code.trim().replace(/\s+/g, "");
  if (!s) return null;
  const parts = s.split("/");
  if (parts.length > 2) return null;
  const zones = parts.map(parseZone);
  if (zones.some((z) => !z)) return null;
  if (parts.length === 2) {
    const [h, sh] = zones as FitZone[];
    if (!h.hole || sh.hole) return null;
    return { hole: h, shaft: sh };
  }
  const z = zones[0]!;
  return z.hole ? { hole: z } : { shaft: z };
}

/** Mezní úchylky pole tolerance [µm] pro jmenovitý rozměr (ISO 286-1); chyba, když pole pro rozměr není definováno. */
export function zoneDeviations(size: number, z: FitZone): Deviations {
  const IT = itValue(size, z.grade);
  const fi = rangeIdx(FD_RANGES, size);
  const ii = rangeIdx(IT_RANGES, size);
  const name = `${z.letter}${z.grade}`;
  const undef = () => new Error(tr("ISO 286: pole {0} není pro rozměr {1} mm definováno", name, fmtMm(size)));
  const l = z.letter.toLowerCase();
  if (l === "js") {
    // ±IT/2; liché IT (v µm) u stupňů 7…11 se zaokrouhlí na nejbližší nižší sudé číslo
    const it = z.grade >= 7 && z.grade <= 11 && IT % 2 === 1 ? IT - 1 : IT;
    return { upper: it / 2, lower: -it / 2 };
  }
  if (!z.hole) {
    if (SHAFT_ES[l]) {
      const es = SHAFT_ES[l][fi];
      if (es == null) throw undef();
      return { upper: es, lower: es - IT };
    }
    let ei: number | null;
    if (l === "j") {
      const key = z.grade === 5 || z.grade === 6 ? "5" : String(z.grade);
      ei = SHAFT_J[key]?.[ii] ?? null;
    } else if (l === "k") ei = z.grade >= 4 && z.grade <= 7 ? SHAFT_K[ii] : 0;
    else ei = SHAFT_EI[l]?.[fi] ?? null;
    if (ei == null) throw undef();
    return { upper: ei + IT, lower: ei };
  }
  // díry
  if (SHAFT_ES[l]) {
    const es = SHAFT_ES[l][fi];
    if (es == null) throw undef();
    const EI = es === 0 ? 0 : -es;
    return { upper: EI + IT, lower: EI };
  }
  if (l === "j") {
    const ES = HOLE_J[String(z.grade)]?.[ii];
    if (ES == null) throw undef();
    return { upper: ES, lower: ES - IT };
  }
  const delta = z.grade >= 3 && z.grade <= 8 ? DELTA[ii][z.grade - 3] : 0;
  const small = size <= 3 + 1e-9;
  let ES: number;
  if (l === "k") {
    // K do IT8: −ei(k) + Δ; nad IT8 0 (do 3 mm vždy 0)
    ES = small ? 0 : z.grade <= 8 ? -SHAFT_K[ii] + delta : 0;
  } else if (l === "m") {
    const ei = SHAFT_EI.m[fi]!;
    ES = small ? -2 : z.grade <= 8 ? -ei + delta : -ei;
  } else if (l === "n") {
    const ei = SHAFT_EI.n[fi]!;
    ES = small ? -4 : z.grade <= 8 ? -ei + delta : 0;
  } else {
    const ei = SHAFT_EI[l]?.[fi];
    if (ei == null) throw undef();
    // P…ZC: do IT7 −ei + Δ, nad IT7 −ei (do 3 mm bez Δ)
    ES = -ei + (z.grade <= 7 && !small ? delta : 0);
  }
  return { upper: ES, lower: ES - IT };
}

/** Úchylky podle zápisu („H7“, „g6“); null = zápis není pole tolerance ISO 286 nebo rozměr je mimo tabulky. */
export function fitDeviations(size: number, code: string): Deviations | null {
  const z = parseZone(code);
  if (!z) return null;
  try {
    return zoneDeviations(size, z);
  } catch {
    return null;
  }
}

export type FitKind = "clearance" | "transition" | "interference";
/** Uložení díra/hřídel: úchylky obou polí, největší a nejmenší vůle (záporná = přesah) a druh uložení. */
export function fitPair(size: number, holeCode: string, shaftCode: string): { hole: Deviations; shaft: Deviations; maxClearance: number; minClearance: number; kind: FitKind } {
  const h = parseZone(holeCode);
  const s = parseZone(shaftCode);
  if (!h?.hole) throw new Error(tr("uložení: „{0}“ není pole tolerance díry (velké písmeno, např. H7)", holeCode));
  if (!s || s.hole) throw new Error(tr("uložení: „{0}“ není pole tolerance hřídele (malé písmeno, např. g6)", shaftCode));
  const hole = zoneDeviations(size, h);
  const shaft = zoneDeviations(size, s);
  const maxClearance = hole.upper - shaft.lower;
  const minClearance = hole.lower - shaft.upper;
  const kind: FitKind = minClearance >= 0 ? "clearance" : maxClearance <= 0 ? "interference" : "transition";
  return { hole, shaft, maxClearance, minClearance, kind };
}

/** druh uložení slovy (přeložený) */
export const fitKindLabel = (k: FitKind) => (k === "clearance" ? tr("s vůlí") : k === "transition" ? tr("přechodné") : tr("s přesahem"));

// ---------------------------------------------------------------- zápis na výkres

const fmtMm = (n: number) => String(Math.round(n * 1000) / 1000).replace(".", ",");
/** úchylka v mm se znaménkem (0 bez znaménka, ISO 129-1): „+0,025“, „−0,009“, „0“ */
export function fmtDev(um: number): string {
  if (Math.abs(um) < 1e-9) return "0";
  const mm = Math.round(Math.abs(um)) / 1000;
  const s = mm.toLocaleString(cadLocale(), { minimumFractionDigits: 3, maximumFractionDigits: 4, useGrouping: false });
  return `${um > 0 ? "+" : "−"}${s}`;
}
/** mezní rozměr v mm se třemi desetinnými místy */
const fmtLimit = (mm: number) => mm.toLocaleString(cadLocale(), { minimumFractionDigits: 3, maximumFractionDigits: 4, useGrouping: false });

/** Jak se u kóty s polem tolerance zobrazí úchylky: jen značka, značka + úchylky „(+0,025/0)“, značka + mezní rozměry. */
export type FitShow = "code" | "dev" | "limits";

/** Doplněk za značkou uložení: „(+0,025/0)“ nebo „(40,025/40,000)“; prázdný = bez doplňku / neznámé pole. */
export function fitSuffix(size: number, code: string, show: FitShow): string {
  if (show === "code") return "";
  const f = parseFit(code);
  if (!f) return "";
  try {
    if (f.hole && f.shaft) {
      // uložení na sestavném výkrese: úchylky díry nad úchylkami hřídele
      const h = zoneDeviations(size, f.hole);
      const s = zoneDeviations(size, f.shaft);
      return show === "limits" ? `(${fmtLimit(size + h.upper / 1000)}/${fmtLimit(size + h.lower / 1000)} · ${fmtLimit(size + s.upper / 1000)}/${fmtLimit(size + s.lower / 1000)})` : `(${fmtDev(h.upper)}/${fmtDev(h.lower)} · ${fmtDev(s.upper)}/${fmtDev(s.lower)})`;
    }
    const d = zoneDeviations(size, (f.hole ?? f.shaft)!);
    return show === "limits" ? `(${fmtLimit(size + d.upper / 1000)}/${fmtLimit(size + d.lower / 1000)})` : `(${fmtDev(d.upper)}/${fmtDev(d.lower)})`;
  } catch {
    return "";
  }
}

/** Pole tolerance z přípony kóty („H7“, „ H7“, „h6“, „H7/g6“); null = přípona není uložení ISO 286. */
export function fitOfSuffix(suffix: string | undefined): string | null {
  const s = (suffix ?? "").trim();
  return s && parseFit(s) ? s.replace(/\s+/g, "") : null;
}

/** Řádek Tabulky uložení: kóta, pole, úchylky a mezní rozměry. */
export type FitRow = { label: string; size: number; code: string; upper: string; lower: string; max: string; min: string; kind?: string };

/** Řádky tabulky uložení pro kóty s polem tolerance (jmenovitý rozměr + zápis z přípony). */
export function fitRows(items: { label: string; size: number; code: string }[]): FitRow[] {
  const out: FitRow[] = [];
  const seen = new Set<string>();
  for (const it of items) {
    const f = parseFit(it.code);
    if (!f) continue;
    const key = `${it.size.toFixed(4)}|${it.code}`;
    if (seen.has(key)) continue;
    seen.add(key);
    try {
      const zones = [f.hole, f.shaft].filter(Boolean) as FitZone[];
      for (const z of zones) {
        const d = zoneDeviations(it.size, z);
        out.push({ label: it.label, size: it.size, code: `${z.letter}${z.grade}`, upper: fmtDev(d.upper), lower: fmtDev(d.lower), max: fmtLimit(it.size + d.upper / 1000), min: fmtLimit(it.size + d.lower / 1000), ...(zones.length === 2 ? { kind: fitKindLabel(fitPair(it.size, `${f.hole!.letter}${f.hole!.grade}`, `${f.shaft!.letter}${f.shaft!.grade}`).kind) } : {}) });
      }
    } catch {
      /* pole pro rozměr není definováno – v tabulce se vynechá */
    }
  }
  return out;
}

/** Textový popis uložení pro agenty a výběr ve výkresovém prostředí: „Ø40 H7/g6: díra +0,025/0, hřídel −0,009/−0,025, vůle 0,009…0,050 (s vůlí)“. */
export function describeFit(size: number, code: string): string {
  const f = parseFit(code);
  if (!f) throw new Error(tr("„{0}“ není zápis uložení ISO 286 – např. H7, g6, H7/g6", code));
  if (f.hole && f.shaft) {
    const p = fitPair(size, `${f.hole.letter}${f.hole.grade}`, `${f.shaft.letter}${f.shaft.grade}`);
    const cl = (um: number) => fmtMm(um / 1000);
    const range = p.kind === "interference" ? tr("přesah {0}…{1}", cl(-p.maxClearance), cl(-p.minClearance)) : p.kind === "clearance" ? tr("vůle {0}…{1}", cl(p.minClearance), cl(p.maxClearance)) : tr("vůle až {0}, přesah až {1}", cl(p.maxClearance), cl(-p.minClearance));
    return tr("Ø{0} {1}: díra {2}/{3}, hřídel {4}/{5}, {6} ({7})", fmtMm(size), code, fmtDev(p.hole.upper), fmtDev(p.hole.lower), fmtDev(p.shaft.upper), fmtDev(p.shaft.lower), range, fitKindLabel(p.kind));
  }
  const z = (f.hole ?? f.shaft)!;
  const d = zoneDeviations(size, z);
  return tr("{0} {1}: {2}/{3} (mezní rozměry {4} až {5})", fmtMm(size), code, fmtDev(d.upper), fmtDev(d.lower), fmtLimit(size + d.lower / 1000), fmtLimit(size + d.upper / 1000));
}
