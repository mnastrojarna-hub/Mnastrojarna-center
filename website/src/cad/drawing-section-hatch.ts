/**
 * Kolo 7 (čela řezu, oprava po oponentovi): šrafy řezu ve 2D výkresu sestavy po KOMPONENTÁCH podle ISO 128-50 – jedna
 * komponenta = jeden vzor (i když má víc těles, např. svařenec se svary nebo díl se dvěma tělesy), sousední komponenty
 * v řezu (dotýkající se řezné plochy) dostanou různé vzory. Vzory jsou tytéž jako u čel řezu ve 3D okně (`CAP_PATTERNS`,
 * osm vzorů: úhel a rozteč), takže sestava s až osmi navzájem sousedícími komponentami nemá dva sousedy se stejnými šrafami.
 *
 * Čistá funkce bez OCCT: vstupem jsou obrysy řezných ploch v obraze pohledu, pořadí tělesa každé plochy, obálky těles
 * (svět) a obálky výskytů komponent (`DrawingMeta.components`, z nich se těleso přiřadí komponentě: nejmenší obálka
 * výskytu, která obálku tělesa obsahuje).
 */
import { CAP_PATTERNS } from "./section-cap";
import type { Vec2, Vec3 } from "./types";

/** vzory šraf řezu ve výkresu: úhel (°) a násobek základní rozteče listu (rozteč vzoru / 8 – jako čela 3D okna) */
export const SECTION_HATCH_PATTERNS: readonly { angle: number; factor: number }[] = CAP_PATTERNS.map((p) => ({ angle: p.angle, factor: p.step / 8 }));

/** vzor k (cyklicky) */
export function sectionHatch(k: number): { angle: number; factor: number } {
  const n = SECTION_HATCH_PATTERNS.length;
  return SECTION_HATCH_PATTERNS[((Math.floor(k) % n) + n) % n];
}

type Box3 = [Vec3, Vec3];
/** výskyt komponenty pro přiřazení tělesa: pozice v kusovníku a obálky výskytů (bez `boxes` jedna obálka `bbox`) */
export type HatchComponent = { pos: number; bbox: Box3; boxes?: Box3[] };

const vol = (b: Box3) => Math.max(0, b[1][0] - b[0][0]) * Math.max(0, b[1][1] - b[0][1]) * Math.max(0, b[1][2] - b[0][2]);
const contains = (o: Box3, i: Box3, tol: number) => [0, 1, 2].every((k) => i[0][k] >= o[0][k] - tol && i[1][k] <= o[1][k] + tol);

/**
 * Klíč komponenty pro každé těleso: `c<pos>:<výskyt>` (nejmenší obálka výskytu, která obálku tělesa obsahuje), jinak
 * `s<k>` (těleso bez komponenty – samostatný vzor).
 */
export function solidComponentKeys(solidBoxes: readonly (Box3 | null | undefined)[], components?: readonly HatchComponent[]): string[] {
  const inst: { key: string; box: Box3; v: number }[] = [];
  for (const c of components ?? []) {
    const bs = c.boxes?.length ? c.boxes : [c.bbox];
    bs.forEach((b, i) => inst.push({ key: `c${c.pos}:${i}`, box: b, v: vol(b) }));
  }
  return solidBoxes.map((sb, k) => {
    if (!sb || !inst.length) return `s${k}`;
    const diag = Math.hypot(sb[1][0] - sb[0][0], sb[1][1] - sb[0][1], sb[1][2] - sb[0][2]);
    const tol = Math.max(0.05, diag * 0.01); // obálky výskytů jsou ze sítě (u oblých ploch o tětivu menší)
    let best: { key: string; v: number } | null = null;
    for (const it of inst) if (contains(it.box, sb, tol) && (!best || it.v < best.v)) best = it;
    return best ? best.key : `s${k}`;
  });
}

/**
 * Vzor šraf pro každou řeznou plochu: plochy jedné komponenty mají jeden vzor, sousední komponenty (obdélníky jejich ploch
 * v obraze se dotýkají nebo překrývají, do `gap`) různé – hladové barvení grafu sousedství v pořadí komponent (první
 * komponenta = vzor 0, tj. výchozí 45°). Když všech osm vzorů mají sousedé, vezme se ten, který mají nejméně často.
 */
export function sectionHatchPlan(loops: readonly Vec2[][][], loopSolid: readonly number[], solidKeys: readonly string[], gap?: number): number[] {
  const keyOf = (i: number) => solidKeys[loopSolid[i] ?? 0] ?? `s${loopSolid[i] ?? 0}`;
  const order: string[] = [];
  const boxes = new Map<string, [number, number, number, number][]>();
  let gx0 = Infinity, gy0 = Infinity, gx1 = -Infinity, gy1 = -Infinity;
  loops.forEach((face, i) => {
    const k = keyOf(i);
    if (!boxes.has(k)) {
      boxes.set(k, []);
      order.push(k);
    }
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    for (const q of face[0] ?? []) {
      x0 = Math.min(x0, q[0]);
      y0 = Math.min(y0, q[1]);
      x1 = Math.max(x1, q[0]);
      y1 = Math.max(y1, q[1]);
    }
    if (x1 >= x0) {
      boxes.get(k)!.push([x0, y0, x1, y1]);
      gx0 = Math.min(gx0, x0);
      gy0 = Math.min(gy0, y0);
      gx1 = Math.max(gx1, x1);
      gy1 = Math.max(gy1, y1);
    }
  });
  const g = gap ?? Math.max(1e-3, (Number.isFinite(gx1 - gx0) ? Math.max(gx1 - gx0, gy1 - gy0) : 0) * 2e-3);
  const touch = (a: [number, number, number, number], b: [number, number, number, number]) => a[0] <= b[2] + g && b[0] <= a[2] + g && a[1] <= b[3] + g && b[1] <= a[3] + g;
  const n = SECTION_HATCH_PATTERNS.length;
  const pat = new Map<string, number>();
  for (const k of order) {
    const mine = boxes.get(k)!;
    const used = new Array<number>(n).fill(0);
    for (const [o, p] of pat) if (boxes.get(o)!.some((b) => mine.some((m) => touch(b, m)))) used[p]++;
    let pick = used.findIndex((u) => u === 0);
    if (pick < 0) pick = used.indexOf(Math.min(...used));
    pat.set(k, pick);
  }
  return loops.map((_, i) => pat.get(keyOf(i)) ?? 0);
}
