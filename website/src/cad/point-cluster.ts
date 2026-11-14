/**
 * Shluky 2D bodů do vzdálenosti `tol` (tranzitivně – řetěz blízkých bodů je jeden shluk). Mřížka s buňkou `tol` a sloučení
 * přesně shodných bodů předem: bez kvadratického času i u tisíců konců v jednom bodě (paprsky z jednoho středu) nebo na
 * jedné svislici (mřížka čar z DXF). Čistá funkce (kontrola profilu, uzavírání lomených čar z textu).
 */
import type { Vec2 } from "./types";

/** Číslo shluku pro každý bod (0, 1, 2… v pořadí prvního bodu shluku). Body s nekonečnou / NaN souřadnicí jsou samostatné. */
export function clusterPoints(pts: Vec2[], tol: number): number[] {
  const parent = pts.map((_, i) => i);
  const root = (i: number): number => {
    while (parent[i] !== i) i = parent[i] = parent[parent[i]];
    return i;
  };
  const join = (i: number, j: number) => {
    const a = root(i);
    const b = root(j);
    if (a !== b) parent[a] = b;
  };
  const exact = new Map<string, number>();
  const grid = new Map<string, number[]>();
  const cell = (v: number) => Math.floor(v / tol);
  pts.forEach((p, i) => {
    if (!Number.isFinite(p[0]) || !Number.isFinite(p[1])) return;
    const key = `${p[0]},${p[1]}`;
    const twin = exact.get(key);
    if (twin !== undefined) return join(i, twin); // shodný bod – jeho sousedy už prošel první výskyt
    exact.set(key, i);
    const cx = cell(p[0]);
    const cy = cell(p[1]);
    for (let dx = -1; dx <= 1; dx++)
      for (let dy = -1; dy <= 1; dy++) {
        const b = grid.get(`${cx + dx},${cy + dy}`);
        if (!b) continue;
        for (const m of b) {
          const ex = p[0] - pts[m][0];
          const ey = p[1] - pts[m][1];
          if (Math.sqrt(ex * ex + ey * ey) <= tol) join(i, m);
        }
      }
    const own = `${cx},${cy}`;
    const b = grid.get(own);
    if (b) b.push(i);
    else grid.set(own, [i]);
  });
  const ids = new Map<number, number>();
  return pts.map((_, i) => {
    const r = root(i);
    let id = ids.get(r);
    if (id === undefined) ids.set(r, (id = ids.size));
    return id;
  });
}
