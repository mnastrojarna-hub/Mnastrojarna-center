/**
 * Přesný řez položky, ve které je popisek i hodnota („SCHVALIL: J. Iljin" v jedné textové položce):
 * odhad z šířek Helvetiky (lines.ts) se u jiných písem (Courier, ISOCPEUR…) mýlí o několik znaků.
 * Tady se řez posune do SKUTEČNÉ mezery mezi slovy ve vykresleném rastru: mezery mezi slovy jsou
 * nejširší bílé sloupce v pásu položky; jejich počet odpovídá počtu mezer v textu → hranice slov
 * v pixelech. Když to nejde jednoznačně (žádná mezera, nejasné šířky), vrací certain=false
 * (výsledek ke kontrole). Čistý modul (rastr dostane hotový).
 */

export interface CutRaster {
  width: number;
  height: number;
  channels: 1 | 3;
  data: Uint8Array;
}

export interface PartialItemPx {
  /** Text položky. */
  str: string;
  /** Začátek a konec položky ve směru textu (px, jen vodorovný text). */
  x0: number;
  x1: number;
  /** Svislý pás písma (px). */
  yTop: number;
  yBot: number;
  /** Výška písma (px). */
  em: number;
  /** Mazané rozsahy znaků [od, do). */
  ranges: [number, number][];
}

export interface RefinedCut {
  certain: boolean;
  /** Intervaly k vypálení [x0, x1) v px. */
  burn: [number, number][];
  /** Ponechané části [x0, x1) v px (popisek) — nejsou zbytek. */
  kept: [number, number][];
}

function gray(r: CutRaster, x: number, y: number): number {
  const o = (y * r.width + x) * r.channels;
  return r.channels === 1 ? r.data[o] : (r.data[o] * 299 + r.data[o + 1] * 587 + r.data[o + 2] * 114) / 1000;
}

/** Úseky mezer mezi slovy (mezi ne-mezerovými znaky) v textu: [začátek, konec) znaků. */
export function wordGaps(str: string): [number, number][] {
  const out: [number, number][] = [];
  const re = /\s+/gu;
  for (const m of str.matchAll(re)) {
    const s = m.index ?? 0, e = s + m[0].length;
    if (s > 0 && e < str.length) out.push([s, e]);
  }
  return out;
}

export function refineCut(r: CutRaster, it: PartialItemPx, bg = 255): RefinedCut {
  const fail: RefinedCut = { certain: false, burn: [], kept: [] };
  const em = Math.max(1, it.em);
  const y0 = Math.max(0, Math.floor(it.yTop)), y1 = Math.min(r.height, Math.ceil(it.yBot));
  const sx0 = Math.max(0, Math.floor(it.x0 - 0.3 * em)), sx1 = Math.min(r.width, Math.ceil(it.x1 + 0.3 * em));
  if (y1 - y0 < 2 || sx1 - sx0 < 4) return fail;
  const thr = bg * 0.75;
  const darkCol: boolean[] = [];
  for (let x = sx0; x < sx1; x++) {
    let d = false;
    for (let y = y0; y < y1 && !d; y++) if (gray(r, x, y) < thr) d = true;
    darkCol.push(d);
  }
  const first = darkCol.indexOf(true), last = darkCol.lastIndexOf(true);
  if (first < 0) return fail;
  const inkL = sx0 + first, inkR = sx0 + last + 1;
  // bílé běhy uvnitř inkoustu
  const whites: { a: number; b: number; w: number }[] = [];
  for (let i = first; i <= last; i++) {
    if (darkCol[i]) continue;
    let j = i;
    while (j <= last && !darkCol[j]) j++;
    whites.push({ a: sx0 + i, b: sx0 + j, w: j - i }); // [a, b)
    i = j;
  }
  const gaps = wordGaps(it.str);
  if (!gaps.length) return fail;
  const sorted = [...whites].sort((p, q) => q.w - p.w);
  const chosen = sorted.slice(0, gaps.length);
  if (chosen.length < gaps.length) return fail;
  const minChosen = Math.min(...chosen.map((c) => c.w));
  const maxOther = sorted.length > gaps.length ? sorted[gaps.length].w : 0;
  // mezera mezi slovy musí být zřetelně širší než mezery mezi písmeny
  if (minChosen < Math.max(2, 0.12 * em) || (maxOther > 0 && minChosen < 1.3 * maxOther)) return fail;
  const px = chosen.sort((p, q) => p.a - q.a);

  /** Hranice znaku c → px (jen na mezeře mezi slovy, na začátku nebo na konci položky). */
  const boundary = (c: number, side: "start" | "end"): number | null => {
    if (c <= 0) return Math.min(inkL, it.x0) - 0.15 * em;
    if (c >= it.str.length) return Math.max(inkR, it.x1) + 0.15 * em;
    const k = gaps.findIndex(([s, e]) => c >= s && c <= e);
    if (k < 0) return null;
    const g = px[k];
    // začátek mazání: hned za ponechaným slovem (1 bílý sloupec zůstane); konec mazání: před dalším slovem
    return side === "start" ? Math.min(g.b, g.a + 1) : Math.max(g.a, g.b - 1);
  };
  const burn: [number, number][] = [];
  const merged = [...it.ranges].sort((a, b) => a[0] - b[0]).reduce<[number, number][]>((acc, cur) => {
    const l = acc[acc.length - 1];
    if (l && cur[0] <= l[1]) l[1] = Math.max(l[1], cur[1]);
    else acc.push([cur[0], cur[1]]);
    return acc;
  }, []);
  for (const [a, b] of merged) {
    const s = boundary(a, "start"), e = boundary(b, "end");
    if (s === null || e === null || e <= s) return fail;
    burn.push([s, e]);
  }
  const kept: [number, number][] = [];
  let cur = inkL;
  for (const [s, e] of burn) {
    if (s > cur) kept.push([cur, s]);
    cur = Math.max(cur, e);
  }
  if (cur < inkR) kept.push([cur, inkR]);
  return { certain: true, burn, kept };
}
