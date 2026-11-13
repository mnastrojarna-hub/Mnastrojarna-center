/**
 * Hladké uzavřené šablonování (7. vlna): profily tvoří uzavřenou smyčku a plocha je ve směru mezi profily PERIODICKÁ
 * (C2 – tedy G2 – i ve švu za posledním profilem). Postup:
 *  1. každý profil se převzorkuje na N bodů rovnoměrně po délce, se sjednocenou orientací (podle směru „páteře“
 *     přes těžiště profilů) a srovnanými začátky (posun začátku po obvodu; zbylé zkroucení smyčky se rozloží rovnoměrně),
 *  2. tenzorová interpolace mřížky periodickou B-spline plochou stupně 3×3 (C2 v obou směrech, i ve švech),
 *  3. uzavřená plocha → skořepina → těleso.
 * Aproximace: profil je proložen hladce N body – ostré rohy profilů se zaoblí; největší odchylka od profilů se měří a nad
 * 0,01 mm se ohlásí ve varování prvku (viz `lastSmoothLoftDeviation`).
 */
import * as r from "replicad";
import { tr } from "../i18n";
import { surfD2, tensorInterp, faceOf, solidFromClosedFace, V3 } from "../surf-geom";
import type { Vec3 } from "../types";

type Shape = r.Shape3D;

/** N bodů uzavřeného drátu rovnoměrně po délce, začátek posunutý o `phase` bodů (smí být necelé). */
function sampleClosed(w: r.Wire, N: number, phase = 0): Vec3[] {
  const M = Math.max(256, N * 12);
  const us: number[] = [];
  const pts: Vec3[] = [];
  const cum = [0];
  for (let i = 0; i <= M; i++) {
    const u = i / M;
    const p = w.pointAt(u);
    us.push(u);
    pts.push([p.x, p.y, p.z]);
    if (i) cum.push(cum[i - 1] + V3.dist(pts[i], pts[i - 1]));
  }
  const L = cum[M];
  if (!(L > 1e-9)) throw new Error(tr("Profil má nulovou délku."));
  const out: Vec3[] = [];
  for (let j = 0; j < N; j++) {
    let target = (((j + phase) / N) % 1) * L;
    if (target < 0) target += L;
    let lo = 0;
    let hi = M;
    while (hi - lo > 1) {
      const mid = (lo + hi) >> 1;
      if (cum[mid] <= target) lo = mid;
      else hi = mid;
    }
    const seg = cum[hi] - cum[lo];
    const f = seg > 1e-12 ? (target - cum[lo]) / seg : 0;
    const p = w.pointAt(us[lo] + (us[hi] - us[lo]) * f);
    out.push([p.x, p.y, p.z]);
  }
  return out;
}

const centroid = (P: Vec3[]): Vec3 => V3.mul(P.reduce((s, p) => V3.add(s, p), [0, 0, 0] as Vec3), 1 / P.length);
/** normála polygonu (Newell) */
function newell(P: Vec3[]): Vec3 {
  const n: Vec3 = [0, 0, 0];
  for (let i = 0; i < P.length; i++) {
    const a = P[i];
    const b = P[(i + 1) % P.length];
    n[0] += (a[1] - b[1]) * (a[2] + b[2]);
    n[1] += (a[2] - b[2]) * (a[0] + b[0]);
    n[2] += (a[0] - b[0]) * (a[1] + b[1]);
  }
  return V3.norm(n);
}
/** posun začátku (celé číslo) řezu `q` vůči `prev`, při kterém si body nejvíc odpovídají (vůči těžišti) */
function bestShift(prev: Vec3[], q: Vec3[]): number {
  const N = q.length;
  const cp = centroid(prev);
  const cq = centroid(q);
  let best = 0;
  let bestD = Infinity;
  for (let s = 0; s < N; s++) {
    let d = 0;
    for (let j = 0; j < N; j++) d += V3.dot(V3.sub(V3.sub(q[(j + s) % N], cq), V3.sub(prev[j], cp)), V3.sub(V3.sub(q[(j + s) % N], cq), V3.sub(prev[j], cp)));
    if (d < bestD) {
      bestD = d;
      best = s;
    }
  }
  return best;
}

/** Největší odchylka profilů od plochy při posledním hladkém uzavřeném šablonování (mm) – pro varování a testy. */
export let lastSmoothLoftDeviation = 0;

/**
 * Hladké uzavřené šablonování drátů (každý drát = jeden uzavřený profil, v pořadí smyčky). Vrací těleso a
 * B-spline plochu (pro testy návaznosti) a největší odchylku profilů od plochy.
 */
export function smoothClosedLoft(wires: r.Wire[], N = 48): { solid: Shape; surface: unknown; period: { u: number; v: number }; deviation: number } {
  const M = wires.length;
  if (M < 3) throw new Error(tr("Uzavřené šablonování potřebuje alespoň tři profily."));
  if (wires.some((w) => !w.isClosed)) throw new Error(tr("Uzavřené hladké šablonování potřebuje uzavřené profily."));
  // 1) navzorkovat, sjednotit orientaci podle páteře přes těžiště
  let secs = wires.map((w) => sampleClosed(w, N));
  const cents = secs.map(centroid);
  const flip = secs.map((P, k) => V3.dot(newell(P), V3.sub(cents[(k + 1) % M], cents[(k - 1 + M) % M])) < 0);
  const orient = (P: Vec3[], f: boolean) => (f ? [P[0], ...P.slice(1).reverse()] : P);
  secs = secs.map((P, k) => orient(P, flip[k]));
  // 2) srovnat začátky: posuny po řadě, zbylé „zkroucení“ smyčky (posun prvního vůči poslednímu) rozložit rovnoměrně
  const shifts = [0];
  for (let k = 1; k < M; k++) {
    const s = bestShift(secs[k - 1].map((_, j) => secs[k - 1][(j + shifts[k - 1]) % N]), secs[k]);
    shifts.push(shifts[k - 1] + s);
  }
  const lastAligned = secs[M - 1].map((_, j) => secs[M - 1][(j + shifts[M - 1]) % N]);
  let close = bestShift(lastAligned, secs[0]);
  if (close > N / 2) close -= N;
  // fáze vzorkování drátu: posun začátku v (orientovaném) pořadí bodů; obrácený profil se vzorkuje proti směru drátu
  const phase = (k: number) => {
    const p = shifts[k] - (close * k) / M;
    return flip[k] ? -p : p;
  };
  const grid = wires.map((w, k) => orient(sampleClosed(w, N, phase(k)), flip[k]));
  // 3) parametry: u = index bodu (rovnoměrně po délce), v = délky tětiv mezi těžišti profilů
  const tu = Array.from({ length: N + 1 }, (_, j) => j);
  const c2 = grid.map(centroid);
  const tv = [0];
  for (let k = 1; k <= M; k++) tv.push(tv[k - 1] + Math.max(1e-6, V3.dist(c2[k - 1], c2[k % M])));
  const surface = tensorInterp(grid, tu, tv, { uPeriodic: true, vPeriodic: true });
  // odchylka profilu od plochy mezi body vzorkování (polovina kroku)
  let deviation = 0;
  for (let k = 0; k < M; k++) {
    // bod profilu uprostřed mezi body mřížky j a j+1 (u obráceného profilu posun −½ proti směru drátu)
    const mid = orient(sampleClosed(wires[k], N, phase(k) + (flip[k] ? -0.5 : 0.5)), flip[k]);
    for (let j = 0; j < N; j++) {
      const s = surfD2(surface, j + 0.5, tv[k]).p;
      deviation = Math.max(deviation, V3.dist(s, mid[j]));
    }
  }
  const face = faceOf(surface);
  const solid = solidFromClosedFace(face);
  if (!(Math.abs(r.measureVolume(solid)) > 1e-6)) throw new Error(tr("Uzavřené hladké šablonování nevytvořilo objem – profily se nejspíš kříží."));
  lastSmoothLoftDeviation = deviation;
  return { solid, surface, period: { u: N, v: tv[M] }, deviation };
}
