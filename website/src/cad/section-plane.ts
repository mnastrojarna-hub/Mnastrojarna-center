/**
 * Rovina řezu 3D okna: osová (kolmá na X / Y / Z) nebo obecná (normála + bod), posunutá o zadanou vzdálenost.
 * Čistá matematika bez prohlížeče – používá ji 3D okno (WebGL), softwarový náhled bez WebGL i panel „Řez modelem“.
 *
 * Úmluva: `offset` se měří ve směru normály (u osové roviny je to přímo souřadnice na ose). Výsledná rovina
 * zachovává poloprostor `normal·p + constant ≥ 0` (shodně s THREE.Plane).
 */
import { tr } from "./i18n";
import { evalExpr } from "./params";
import type { Vec3 } from "./types";

export type SectionAxis = "X" | "Y" | "Z";

/** Odkud obecná rovina pochází (jen pro ovládací panel): z rovinné plochy tělesa, nebo ze zadaného vektoru. */
export type SectionSource = { kind: "face"; index: number; compId?: string } | { kind: "vector" };

export type SectionState = {
  /** osa, na kterou je rovina kolmá – platí, není-li zadána `normal` */
  axis: SectionAxis;
  /** poloha roviny v mm: u osové souřadnice na ose, u obecné vzdálenost od `origin` ve směru normály */
  offset: number;
  /** obrátí zachovanou stranu */
  flip: boolean;
  /** obecná rovina: směr normály (libovolná nenulová délka) */
  normal?: Vec3;
  /** bod, kterým obecná rovina prochází při offset = 0 (výchozí počátek souřadnic) */
  origin?: Vec3;
  source?: SectionSource;
};

/** Rovina jako poloprostor `normal·p + constant ≥ 0` (jednotková normála). */
export type ClipPlane = { normal: Vec3; constant: number };

const AXIS_VEC: Record<SectionAxis, Vec3> = { X: [1, 0, 0], Y: [0, 1, 0], Z: [0, 0, 1] };
const dot = (a: Vec3, b: Vec3) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const clean = (v: number) => (Math.abs(v) < 1e-12 ? 0 : v);

/** Jednotkový vektor; nulový nebo neplatný vektor → null. */
export function unitVec(v: Vec3 | null | undefined): Vec3 | null {
  if (!v) return null;
  const l = Math.hypot(v[0], v[1], v[2]);
  if (!(l > 1e-12) || !Number.isFinite(l)) return null;
  return [clean(v[0] / l), clean(v[1] / l), clean(v[2] / l)];
}

/** Je řez zadán obecnou rovinou (platnou normálou)? */
export const isGeneralSection = (s: SectionState): boolean => !!unitVec(s.normal);

/** Jednotkový směr, ve kterém se měří `offset` (osa, nebo normála obecné roviny). */
export function sectionNormal(s: SectionState): Vec3 {
  return unitVec(s.normal) ?? AXIS_VEC[s.axis];
}

/** Bod, od kterého se měří `offset` (u osové roviny počátek souřadnic). */
export function sectionOrigin(s: SectionState): Vec3 {
  return unitVec(s.normal) ? (s.origin ?? [0, 0, 0]) : [0, 0, 0];
}

/** Bod roviny řezu nejbližší k `sectionOrigin` (pata kolmice). */
export function sectionPoint(s: SectionState): Vec3 {
  const n = sectionNormal(s);
  const o = sectionOrigin(s);
  return [o[0] + n[0] * s.offset, o[1] + n[1] * s.offset, o[2] + n[2] * s.offset];
}

/**
 * Rovina ořezu pro vykreslení.
 * Osová rovina (dosavadní chování): u X a Z zůstává část se souřadnicí ≤ poloha, u Y část ≥ poloha – řez je tak
 * vidět z výchozí izometrie; `flip` stranu obrátí.
 * Obecná rovina: normála míří do odříznuté části (zůstává `n·(p − origin) ≤ offset`); `flip` stranu obrátí.
 */
export function sectionPlane(s: SectionState): ClipPlane {
  const n = unitVec(s.normal);
  if (!n) {
    const sign = (s.axis === "Y" ? 1 : -1) * (s.flip ? -1 : 1);
    const a = AXIS_VEC[s.axis];
    return { normal: [clean(a[0] * sign), clean(a[1] * sign), clean(a[2] * sign)], constant: clean(-sign * s.offset) };
  }
  const sign = s.flip ? 1 : -1;
  const d = dot(n, s.origin ?? [0, 0, 0]) + s.offset;
  return { normal: [clean(n[0] * sign), clean(n[1] * sign), clean(n[2] * sign)], constant: clean(-sign * d) };
}

/** Vzdálenost bodu od roviny řezu se znaménkem (≥ 0 = zachovaná strana). */
export function sectionDistance(s: SectionState, p: Vec3): number {
  const pl = sectionPlane(s);
  return dot(pl.normal, p) + pl.constant;
}

/** Klíč stavu řezu pro závislosti efektů (změní se s jakoukoli změnou roviny). */
export function sectionKey(s: SectionState | null | undefined): string {
  if (!s) return "";
  const pl = sectionPlane(s);
  return `${pl.normal.join(",")}|${pl.constant}`;
}

/** Síť (díl nebo komponenta sestavy) pro výpočet rozsahu a roviny plochy. */
export type PlaneMesh = { vertices: Float32Array; triangles?: Uint32Array; faceGroups?: Int32Array; matrix?: ArrayLike<number> | null };

/** Bod po umístění maticí 4×4 (po sloupcích); bez matice beze změny. */
function place(m: ArrayLike<number> | null | undefined, x: number, y: number, z: number): Vec3 {
  if (!m || m.length < 16) return [x, y, z];
  return [m[0] * x + m[4] * y + m[8] * z + m[12], m[1] * x + m[5] * y + m[9] * z + m[13], m[2] * x + m[6] * y + m[10] * z + m[14]];
}
/** Směr po umístění maticí (jen lineární část). */
function placeDir(m: ArrayLike<number> | null | undefined, v: Vec3): Vec3 {
  if (!m || m.length < 16) return v;
  return [m[0] * v[0] + m[4] * v[1] + m[8] * v[2], m[1] * v[0] + m[5] * v[1] + m[9] * v[2], m[2] * v[0] + m[6] * v[1] + m[10] * v[2]];
}

/**
 * Rozsah modelu ve směru normály: nejmenší a největší `n·(p − origin)` přes všechny vrcholy (po umístění komponent).
 * Slouží jako meze posuvníku polohy řezu. Bez vrcholů null.
 */
export function projectionRange(items: PlaneMesh[], normal: Vec3, origin: Vec3 = [0, 0, 0]): [number, number] | null {
  const n = unitVec(normal);
  if (!n) return null;
  let lo = Infinity;
  let hi = -Infinity;
  for (const it of items) {
    const V = it.vertices;
    // n·(M·v + t − origin) = (Mᵀn)·v + n·(t − origin)
    const m = it.matrix && it.matrix.length >= 16 ? it.matrix : null;
    const ax = m ? n[0] * m[0] + n[1] * m[1] + n[2] * m[2] : n[0];
    const ay = m ? n[0] * m[4] + n[1] * m[5] + n[2] * m[6] : n[1];
    const az = m ? n[0] * m[8] + n[1] * m[9] + n[2] * m[10] : n[2];
    const b = (m ? n[0] * m[12] + n[1] * m[13] + n[2] * m[14] : 0) - dot(n, origin);
    for (let j = 0; j + 2 < V.length; j += 3) {
      const d = ax * V[j] + ay * V[j + 1] + az * V[j + 2] + b;
      if (d < lo) lo = d;
      if (d > hi) hi = d;
    }
  }
  return hi >= lo ? [lo, hi] : null;
}

/**
 * Rovina rovinné plochy tělesa ze sítě: bod (těžiště plochy) a jednotková normála ven z materiálu, ve světových
 * souřadnicích (po umístění komponenty). Zakřivená nebo neexistující plocha → null.
 */
export function facePlane(mesh: PlaneMesh, faceIndex: number): { origin: Vec3; normal: Vec3 } | null {
  const V = mesh.vertices;
  const T = mesh.triangles;
  const G = mesh.faceGroups;
  if (!T || !G) return null;
  let sx = 0, sy = 0, sz = 0; // součet vektorových součinů (2× plocha × normála)
  let cx = 0, cy = 0, cz = 0, area = 0;
  let found = false;
  const tris: number[] = [];
  for (let g = 0; g + 2 < G.length; g += 3) {
    if (G[g + 2] !== faceIndex) continue;
    found = true;
    const end = Math.min(T.length, G[g] + G[g + 1]);
    for (let t = G[g]; t + 2 < end; t += 3) {
      const a = T[t] * 3, b = T[t + 1] * 3, c = T[t + 2] * 3;
      const ux = V[b] - V[a], uy = V[b + 1] - V[a + 1], uz = V[b + 2] - V[a + 2];
      const vx = V[c] - V[a], vy = V[c + 1] - V[a + 1], vz = V[c + 2] - V[a + 2];
      const nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
      const w = Math.hypot(nx, ny, nz) / 2;
      if (!(w > 0)) continue;
      sx += nx;
      sy += ny;
      sz += nz;
      area += w;
      cx += (w * (V[a] + V[b] + V[c])) / 3;
      cy += (w * (V[a + 1] + V[b + 1] + V[c + 1])) / 3;
      cz += (w * (V[a + 2] + V[b + 2] + V[c + 2])) / 3;
      tris.push(a, b, c);
    }
  }
  if (!found || !(area > 0)) return null;
  const n = unitVec([sx, sy, sz]);
  if (!n) return null;
  // rovinná plocha: součet normál má délku 2× plochy (všechny trojúhelníky míří stejně) a vrcholy leží v jedné rovině
  if (Math.hypot(sx, sy, sz) / 2 < area * (1 - 1e-5)) return null;
  const o: Vec3 = [cx / area, cy / area, cz / area];
  let size = 0;
  let dev = 0;
  for (const a of tris) {
    const dx = V[a] - o[0], dy = V[a + 1] - o[1], dz = V[a + 2] - o[2];
    const d = Math.abs(n[0] * dx + n[1] * dy + n[2] * dz);
    if (d > dev) dev = d;
    const r = Math.hypot(dx, dy, dz);
    if (r > size) size = r;
  }
  if (dev > 1e-4 * Math.max(1, size)) return null;
  const wn = unitVec(placeDir(mesh.matrix, n));
  if (!wn) return null;
  return { origin: place(mesh.matrix, o[0], o[1], o[2]), normal: wn };
}

/** Osový řez uprostřed rozsahu modelu na dané ose (zaokrouhleno na setiny mm). */
export function axisSection(axis: SectionAxis, items: PlaneMesh[], flip = false): SectionState {
  const r = projectionRange(items, AXIS_VEC[axis]);
  return { axis, offset: r ? round2((r[0] + r[1]) / 2) : 0, flip };
}

/** Obecný řez podle zadané normály: rovina prochází středem rozsahu modelu ve směru normály; poloha se měří od počátku. */
export function vectorSection(prev: SectionState, normal: Vec3, items: PlaneMesh[]): SectionState {
  const n = unitVec(normal);
  if (!n) return prev;
  const r = projectionRange(items, n);
  return { axis: prev.axis, flip: prev.flip, offset: r ? round2((r[0] + r[1]) / 2) : 0, normal, origin: [0, 0, 0], source: { kind: "vector" } };
}

/** Řez rovinou vybrané rovinné plochy: rovina leží na ploše (offset 0), normála míří ven z materiálu. */
export function faceSection(prev: SectionState, plane: { origin: Vec3; normal: Vec3 }, index: number, compId?: string): SectionState {
  return { axis: prev.axis, flip: false, offset: 0, normal: plane.normal, origin: plane.origin, source: { kind: "face", index, ...(compId ? { compId } : {}) } };
}

/**
 * Převede řez na zadání vektorem se stejnou rovinou i zachovanou stranou (normála + vzdálenost od počátku) –
 * výchozí stav pro ruční úpravu normály.
 */
export function toVectorSection(s: SectionState): SectionState {
  const n = sectionNormal(s);
  const src: SectionSource = { kind: "vector" };
  if (!isGeneralSection(s)) return { axis: s.axis, offset: s.offset, flip: s.axis === "Y" ? !s.flip : s.flip, normal: n, origin: [0, 0, 0], source: src };
  const r6 = (v: number) => clean(Math.round(v * 1e6) / 1e6);
  return { axis: s.axis, offset: round4(dot(n, sectionOrigin(s)) + s.offset), flip: s.flip, normal: [r6(n[0]), r6(n[1]), r6(n[2])], origin: [0, 0, 0], source: src };
}

const round2 = (v: number) => Math.round(v * 100) / 100;
const round4 = (v: number) => Math.round(v * 1e4) / 1e4;

/** Zápis vektoru „nx; ny; nz“ (nejvýš 4 desetinná místa). */
export function formatVector(v: Vec3): string {
  return v.map((c) => String(round4(clean(c)))).join("; ");
}

/**
 * Přečte normálu zapsanou jako „nx; ny; nz“ (složky lze psát i výrazem, desetinná čárka i tečka; bez středníků se
 * složky oddělují mezerou). Chybný zápis nebo nulový vektor → Error s českou zprávou.
 */
export function parseVector(text: string): Vec3 {
  const t = text.trim().replace(/^[[(]\s*/, "").replace(/\s*[\])]$/, "");
  let parts = t.split(";").map((p) => p.trim());
  if (parts.length === 1) parts = t.split(/\s+/).filter(Boolean);
  if (parts.length !== 3 || parts.some((p) => !p)) throw new Error(tr("Zadejte tři složky normály oddělené středníkem, např. 1; 0; 1."));
  const v = parts.map((p) => evalExpr(p)) as Vec3;
  if (v.some((c) => !Number.isFinite(c))) throw new Error(tr("Složky normály musí být čísla."));
  if (!unitVec(v)) throw new Error(tr("Normála nesmí být nulový vektor."));
  return v;
}
