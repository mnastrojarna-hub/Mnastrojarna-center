/**
 * Kontrola záběru dvou kol v čelní rovině (2D, čistá matematika): obrysy obou kol jako lomené čáry (tolerance tětivy `tol`)
 * v poloze soukolí; kolo A se pootočí o φ ∈ [0, 2π/z_A) v `steps` krocích, kolo B o `ratio`·φ. Pootočením pastorku o jednu
 * rozteč se celé soukolí vrátí do stejné vzájemné polohy (jen s jinými čísly zubů), takže jedna rozteč pokryje všechny
 * polohy. Vrací nejmenší vzdálenost obrysů (do `margin`), příznak protnutí (průnik materiálu) a místo, kde je kolo A
 * druhému nejblíž.
 *
 * Počítají se jen zuby, jejichž obrys zasahuje do mezikruží zubů druhého kola (± `margin`), a jen dvojice úseček, které
 * mřížka najde blíž než dosud nejmenší vzdálenost – jedna kontrola soukolí z 20/60 trvá jednotky ms.
 *
 * Šikmá kola: čelní řezy obou kol jsou v každé rovině jen pootočené kopie téhož páru, 2D kontrola jednoho řezu tedy platí
 * pro celou šířku. Nejmenší vzdálenost evolventních boků v čelní rovině je boční vůle po normále / (2·cos β_b) na stranu.
 */
import { segPoints } from "./preview";
import { rot2, TAU } from "./num";
import type { Profile2D, Vec2 } from "./types";

export type MeshPose = { center: Vec2; rot: number };
export type MeshScan = {
  /** nejmenší vzdálenost obrysů přes všechny polohy (0 = protnutí; nejvýš `margin`) */
  minGap: number;
  /** obrysy se v některé poloze protnuly (průnik materiálu) */
  cross: boolean;
  /** poloha (index kroku) a poloměr na kole A, kde je nejmenší vzdálenost */
  step: number;
  rA: number;
};
/** profil připravený pro kontrolu: body jedné rozteče, počet zubů, rozsah poloměrů a obalová kružnice jedné rozteče */
export type MeshWheel = { one: Vec2[]; z: number; rmin: number; rmax: number; bc: Vec2; br: number };

const cross2 = (o: Vec2, a: Vec2, b: Vec2) => (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]);
function ptSeg(p: Vec2, a: Vec2, b: Vec2): number {
  const dx = b[0] - a[0];
  const dy = b[1] - a[1];
  const l2 = dx * dx + dy * dy;
  const t = l2 > 0 ? Math.max(0, Math.min(1, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / l2)) : 0;
  return Math.hypot(p[0] - a[0] - t * dx, p[1] - a[1] - t * dy);
}
/** vzdálenost dvou úseček (0 = protínají se) */
function segSeg(a0: Vec2, a1: Vec2, b0: Vec2, b1: Vec2): number {
  const d1 = cross2(b0, b1, a0);
  const d2 = cross2(b0, b1, a1);
  const d3 = cross2(a0, a1, b0);
  const d4 = cross2(a0, a1, b1);
  if (((d1 > 0 && d2 < 0) || (d1 < 0 && d2 > 0)) && ((d3 > 0 && d4 < 0) || (d3 < 0 && d4 > 0))) return 0;
  return Math.min(ptSeg(a0, b0, b1), ptSeg(a1, b0, b1), ptSeg(b0, a0, a1), ptSeg(b1, a0, a1));
}

/** Profil → body jedné rozteče s tolerancí tětivy `tol` (stačí jednou pro více kontrol). */
export function meshWheel(p: Profile2D, tol: number): MeshWheel {
  const one = p.tooth.flatMap((s) => segPoints(s, tol));
  let rmin = Infinity;
  let rmax = 0;
  let sx = 0;
  let sy = 0;
  for (const q of one) {
    const r = Math.hypot(q[0], q[1]);
    rmin = Math.min(rmin, r);
    rmax = Math.max(rmax, r);
    sx += q[0];
    sy += q[1];
  }
  const bc: Vec2 = [sx / one.length, sy / one.length];
  let br = 0;
  for (const q of one) br = Math.max(br, Math.hypot(q[0] - bc[0], q[1] - bc[1]));
  return { one, z: p.count, rmin, rmax, bc, br };
}

type Seg = [Vec2, Vec2];
/** úsečky zubů kola `w` v poloze `pose`, které leží v mezikruží [lo, hi] kolem bodu `other` (celé rozteče, které do něj zasahují) */
function segsNear(w: MeshWheel, pose: MeshPose, other: Vec2, lo: number, hi: number): Seg[] {
  const out: Seg[] = [];
  const step = TAU / w.z;
  const place = (q: Vec2, a: number): Vec2 => {
    const r = rot2(q, a);
    return [r[0] + pose.center[0], r[1] + pose.center[1]];
  };
  for (let k = 0; k < w.z; k++) {
    const a = pose.rot + k * step;
    const c = place(w.bc, a);
    const dc = Math.hypot(c[0] - other[0], c[1] - other[1]);
    if (dc + w.br < lo || dc - w.br > hi) continue;
    const pts = w.one.map((q) => place(q, a));
    pts.push(place(w.one[0], a + step)); // navázání na další rozteč
    const inBand = pts.map((p) => {
      const r = Math.hypot(p[0] - other[0], p[1] - other[1]);
      return r >= lo && r <= hi;
    });
    for (let i = 0; i + 1 < pts.length; i++) if (inBand[i] || inBand[i + 1]) out.push([pts[i], pts[i + 1]]);
  }
  return out;
}

/** úsečky delší než `h` rozdělené na kratší (tatáž lomená čára – mřížka pak drží každou úsečku v nejvýš 4 buňkách) */
function split(segs: Seg[], h: number): Seg[] {
  const out: Seg[] = [];
  for (const [a, b] of segs) {
    const n = Math.ceil(Math.hypot(b[0] - a[0], b[1] - a[1]) / h);
    if (n <= 1) {
      out.push([a, b]);
      continue;
    }
    let p = a;
    for (let i = 1; i <= n; i++) {
      const q: Vec2 = i === n ? b : [a[0] + ((b[0] - a[0]) * i) / n, a[1] + ((b[1] - a[1]) * i) / n];
      out.push([p, q]);
      p = q;
    }
  }
  return out;
}

/** nejmenší vzdálenost dvou množin úseček do `limit` (mřížka s buňkou `h` nad úsečkami B); [vzdálenost, bod A] */
function closest(sa: Seg[], sb: Seg[], limit: number, h: number): [number, Vec2] {
  let best = limit;
  let where: Vec2 = [0, 0];
  if (!sa.length || !sb.length) return [best, where];
  const grid = new Map<number, Seg[]>();
  const key = (x: number, y: number) => x * 1048576 + y;
  for (const s of sb) {
    const x0 = Math.floor(Math.min(s[0][0], s[1][0]) / h);
    const x1 = Math.floor(Math.max(s[0][0], s[1][0]) / h);
    const y0 = Math.floor(Math.min(s[0][1], s[1][1]) / h);
    const y1 = Math.floor(Math.max(s[0][1], s[1][1]) / h);
    for (let x = x0; x <= x1; x++)
      for (let y = y0; y <= y1; y++) {
        const k = key(x, y);
        const cell = grid.get(k);
        if (cell) cell.push(s);
        else grid.set(k, [s]);
      }
  }
  for (const a of sa) {
    const x0 = Math.floor((Math.min(a[0][0], a[1][0]) - best) / h);
    const x1 = Math.floor((Math.max(a[0][0], a[1][0]) + best) / h);
    const y0 = Math.floor((Math.min(a[0][1], a[1][1]) - best) / h);
    const y1 = Math.floor((Math.max(a[0][1], a[1][1]) + best) / h);
    for (let x = x0; x <= x1; x++)
      for (let y = y0; y <= y1; y++) {
        const cell = grid.get(key(x, y));
        if (!cell) continue;
        for (const b of cell) {
          const d = segSeg(a[0], a[1], b[0], b[1]);
          if (d < best) {
            best = d;
            where = a[0];
          }
        }
      }
  }
  return [best, where];
}

/** Kontrola záběru (viz hlavička modulu). `ratio` = pootočení kola B na jednotku pootočení kola A (vnější −z_A/z_B, vnitřní +z_A/z_B). */
export function meshScan(A: MeshWheel, B: MeshWheel, poseA: MeshPose, poseB: MeshPose, o: { ratio: number; steps?: number; margin: number }): MeshScan {
  const steps = Math.max(1, o.steps ?? 12);
  const out: MeshScan = { minGap: o.margin, cross: false, step: 0, rA: 0 };
  for (let k = 0; k < steps; k++) {
    const phi = ((TAU / A.z) * k) / steps;
    const pa: MeshPose = { center: poseA.center, rot: poseA.rot + phi };
    const pb: MeshPose = { center: poseB.center, rot: poseB.rot + o.ratio * phi };
    const h = o.margin / 6;
    const sa = split(segsNear(A, pa, poseB.center, B.rmin - o.margin, B.rmax + o.margin), h);
    const sb = split(segsNear(B, pb, poseA.center, A.rmin - o.margin, A.rmax + o.margin), h);
    // nejdřív s malým dosahem (rychlé), teprve když nic, do celého `margin`
    const lim1 = Math.min(out.minGap, h);
    let [best, where] = closest(sa, sb, lim1, h);
    if (best >= lim1 && lim1 < out.minGap) [best, where] = closest(sa, sb, out.minGap, h);
    if (best <= 1e-9) out.cross = true;
    if (best < out.minGap) {
      out.minGap = best;
      out.step = k;
      out.rA = Math.hypot(where[0] - poseA.center[0], where[1] - poseA.center[1]);
    }
  }
  return out;
}
