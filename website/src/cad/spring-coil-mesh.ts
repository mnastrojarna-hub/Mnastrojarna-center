/**
 * Síť pružiny při přehrávání pohybové studie: drát (trubka kruhového průřezu) podél střednice pružiny v AKTUÁLNÍ délce, spočtená
 * v JS pro každý krok – místo protažení sítě volné pružiny po ose (drát by se zploštil do elipsy, broušené konce by se naklonily).
 * Stoupání činných závitů sleduje délku, drát zůstává kulatý, závěrné závity přiložené a broušené konce rovinné (body pod rovinou
 * z = 0 / nad z = L se do roviny srovnají – stejná ploška jako po broušení). Síť se pamatuje podle délky zaokrouhlené na 0,01 mm.
 * Přesný tvar pro export, kolize a výkres dál staví jádro (cad/asm-spring-geom.ts springDocAt).
 *
 * Střednice: prvek Pružina (stálé stoupání, cad/direct.ts springSolid: šroubovice z polohy prvku, stoupání (L − d) / závity)
 * a tabulková tlačná pružina `spring.compression` – střednice přímo z výpočtu pružin `springPathOf` (`@/cad/springs`, stejné
 * funkce jako jádro: závěrné závity, kosinový přechod stoupání, broušené konce, pod délkou se všemi mezerami 3 % jedno stoupání
 * až k Ln – i pro n ≥ 17), natočená do osy a posunutá do bodu `at` stejně jako těleso v jádře (ext/springs-kernel.ts placeSpring).
 */
import { springGeom } from "./asm-spring-geom";
import { springAxisOf, springPathOf } from "./springs";
import type { AsmComponent, CadDoc, Feature, MeshData, Vec3 } from "./types";

/** Střednice drátu v souřadnicích dílu (jako `SpringPath` balíku part): body, tečny, průměr drátu, oříznutí rovinami kolmými na osu. */
export type CoilPath = { pts: Vec3[]; tangents?: Vec3[]; d: number; clip?: { base: Vec3; axis: Vec3; from: number; to: number } };

const add = (a: Vec3, b: Vec3, k = 1): Vec3 => [a[0] + b[0] * k, a[1] + b[1] * k, a[2] + b[2] * k];
const sub = (a: Vec3, b: Vec3): Vec3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const dot = (a: Vec3, b: Vec3) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const cross = (a: Vec3, b: Vec3): Vec3 => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const unit = (v: Vec3): Vec3 => {
  const l = Math.hypot(v[0], v[1], v[2]) || 1;
  return [v[0] / l, v[1] / l, v[2] / l];
};
/** pravotočivá základna (e1, e2, u) kolmá k ose u – pro osu Z je e1 = X (jako šroubovice OCCT) */
function frame(u: Vec3): [Vec3, Vec3] {
  const e1 = unit(Math.abs(u[0]) < 0.9 ? sub([1, 0, 0], [u[0] * u[0], u[0] * u[1], u[0] * u[2]]) : sub([0, 1, 0], [u[1] * u[0], u[1] * u[1], u[1] * u[2]]));
  return [e1, cross(u, e1)];
}

/**
 * Natočení z osy +Z do `axis` (osa otočení Z × a, úhel acos(a_z); −Z = 180° kolem X) – stejně jako `placeSpring` v jádře,
 * aby síť v kroku studie seděla na tělese pružiny.
 */
export function zToAxis(axis: Vec3): (v: Vec3) => Vec3 {
  const a = unit(axis);
  const c = a[2];
  if (c >= 1 - 1e-12) return (v) => [v[0], v[1], v[2]];
  if (c <= -1 + 1e-12) return (v) => [v[0], -v[1], -v[2]];
  const k = unit([-a[1], a[0], 0]);
  const sn = Math.sqrt(Math.max(0, 1 - c * c));
  // Rodrigues: v cosθ + (k × v) sinθ + k (k·v)(1 − cosθ)
  return (v) => add(add(scale(v, c), cross(k, v), sn), k, dot(k, v) * (1 - c));
}

/* ───────────────────────── střednice podle prvku dílu ───────────────────────── */

/** první nepotlačený prvek pružiny dílu: Pružina nebo tabulková tlačná pružina */
function springFeature(doc: CadDoc): Feature | null {
  return doc.features.find((f) => !f.suppressed && (f.type === "spring" || (f.type === "ext" && f.ext === "spring.compression"))) ?? null;
}

/** Střednice pružiny dílu v délce L (souřadnice dílu); null = díl nemá prvek, ze kterého jde střednice spočítat (trubka, válec…). */
export function coilPathOf(doc: CadDoc, L: number, perTurn = 20): CoilPath | null {
  const f = springFeature(doc);
  if (!f) return null;
  if (f.type === "spring") {
    const g = springGeom(doc);
    if (!g) return null;
    const p = Math.max(f.wire * 1.0005, (L - f.wire) / f.turns);
    const [e1, e2] = frame(g.axis);
    const start = add(g.base, g.axis, f.wire / 2);
    const n = Math.max(8, Math.ceil(f.turns * perTurn));
    const pts: Vec3[] = [];
    const tangents: Vec3[] = [];
    for (let i = 0; i <= n; i++) {
      const th = (2 * Math.PI * f.turns * i) / n;
      const c = Math.cos(th);
      const s = Math.sin(th);
      pts.push(add(add(add(start, e1, f.radius * c), e2, f.radius * s), g.axis, (p * th) / (2 * Math.PI)));
      tangents.push(unit(add(add(scale(e1, -f.radius * s), e2, f.radius * c), g.axis, p / (2 * Math.PI))));
    }
    return { pts, tangents, d: f.wire };
  }
  if (f.type !== "ext") return null;
  // tabulková tlačná pružina: střednice z výpočtu pružin (souřadnice prvku, osa +Z) → osa a bod prvku
  const p = springPathOf(f.ext, f.data ?? {}, L, perTurn);
  const ax = springAxisOf(f.data ?? {});
  if (!p || !ax) return null;
  const at = (Array.isArray(f.data?.at) ? (f.data.at as number[]).map((x) => Number(x) || 0) : [0, 0, 0]) as Vec3;
  const rot = zToAxis(ax);
  return {
    pts: p.pts.map((q) => add(at, rot(q))),
    tangents: p.tangents.map(rot),
    d: p.d,
    ...(p.clip ? { clip: { base: at, axis: unit(ax), from: p.clip[0], to: p.clip[1] } } : {}),
  };
}
const scale = (a: Vec3, k: number): Vec3 => [a[0] * k, a[1] * k, a[2] * k];
/* ───────────────────────── síť trubky ───────────────────────── */

/**
 * Síť drátu podél střednice: kruh `sides` bodů v každém bodě střednice (rámec přenášený bez kroucení), trojúhelníky mezi sousedními
 * kruhy, víčka na koncích drátu. `clip` = body pod / nad rovinou konce se srovnají do roviny (normála = osa) – broušené konce.
 */
export function tubeMesh(path: CoilPath, sides = 10): MeshData {
  const P = path.pts;
  const n = P.length;
  const r = path.d / 2;
  const T = path.tangents && path.tangents.length === n ? path.tangents : P.map((_, i) => unit(sub(P[Math.min(n - 1, i + 1)], P[Math.max(0, i - 1)])));
  // rámec bez kroucení: první normála kolmo k tečně, další přenesená (projekce předchozí do roviny kolmé k nové tečně)
  let N0 = cross(T[0], Math.abs(T[0][2]) < 0.9 ? [0, 0, 1] : [1, 0, 0]);
  N0 = unit(N0);
  // kruh má sides + 1 bodů (opakovaný bod švu) a dva středy víček
  const nv = n * (sides + 1) + 2;
  const V = new Float32Array(nv * 3);
  const Nn = new Float32Array(nv * 3);
  let Nk = N0;
  let k = 0;
  const put = (p: Vec3, nn: Vec3) => {
    V[k * 3] = p[0];
    V[k * 3 + 1] = p[1];
    V[k * 3 + 2] = p[2];
    Nn[k * 3] = nn[0];
    Nn[k * 3 + 1] = nn[1];
    Nn[k * 3 + 2] = nn[2];
    k++;
  };
  for (let i = 0; i < n; i++) {
    if (i > 0) Nk = unit(sub(Nk, scale(T[i], dot(Nk, T[i]))));
    const B = cross(T[i], Nk);
    for (let j = 0; j <= sides; j++) {
      const a = (2 * Math.PI * j) / sides;
      const dir = add(scale(Nk, Math.cos(a)), B, Math.sin(a));
      put(add(P[i], dir, r), dir);
    }
  }
  // víčka: střed na začátku a konci drátu
  put(P[0], scale(T[0], -1));
  put(P[n - 1], T[n - 1]);
  const tris: number[] = [];
  const W = sides + 1;
  for (let i = 0; i + 1 < n; i++)
    for (let j = 0; j < sides; j++) {
      const a = i * W + j;
      const b = a + 1;
      const c = a + W;
      const dd = c + 1;
      tris.push(a, c, b, b, c, dd);
    }
  const c0 = n * W;
  const c1 = c0 + 1;
  for (let j = 0; j < sides; j++) {
    tris.push(c0, j + 1, j);
    tris.push(c1, (n - 1) * W + j, (n - 1) * W + j + 1);
  }
  // broušené konce: srovnat do rovin from / to (normála ve srovnané části = osa)
  if (path.clip) {
    const { base, axis, from, to } = path.clip;
    for (let q = 0; q < nv; q++) {
      const p: Vec3 = [V[q * 3], V[q * 3 + 1], V[q * 3 + 2]];
      const z = dot(sub(p, base), axis);
      const zc = z < from ? from : z > to ? to : z;
      if (zc === z) continue;
      const pc = add(p, axis, zc - z);
      V[q * 3] = pc[0];
      V[q * 3 + 1] = pc[1];
      V[q * 3 + 2] = pc[2];
      const nn = z < from ? scale(axis, -1) : axis;
      Nn[q * 3] = nn[0];
      Nn[q * 3 + 1] = nn[1];
      Nn[q * 3 + 2] = nn[2];
    }
  }
  const triangles = new Uint32Array(tris);
  return { vertices: V, normals: Nn, triangles, faceGroups: new Int32Array([0, triangles.length, 0]), lines: new Float32Array(0), edgeGroups: new Int32Array(0) };
}

/* ───────────────────────── síť komponenty v kroku studie (mezipaměť) ───────────────────────── */

const cache = new WeakMap<CadDoc, Map<number, MeshData | null>>();
const MAX = 96;
/** Síť drátu dílu pružiny v délce L (zaokrouhlené na 0,01 mm) – z mezipaměti podle dílu a délky. */
export function coilMeshAt(doc: CadDoc, L: number): MeshData | null {
  const key = Math.round(L * 100) / 100;
  let m = cache.get(doc);
  if (!m) cache.set(doc, (m = new Map()));
  if (m.has(key)) {
    const hit = m.get(key)!;
    m.delete(key); // LRU: naposledy použitá na konec
    m.set(key, hit);
    return hit;
  }
  const path = coilPathOf(doc, key);
  const mesh = path ? tubeMesh(path) : null;
  m.set(key, mesh);
  if (m.size > MAX) m.delete(m.keys().next().value!);
  return mesh;
}

/**
 * Pružina komponenty pro zobrazení kroku studie: síť drátu v délce `spring.length`, klíč pro mezipaměť zobrazení a lokální
 * matice (posun začátku pružiny po ose o `spring.offset` na dosedací plochu A – bez měřítka). null = komponenta není pružina
 * s prvkem, ze kterého jde síť spočítat (pak zůstává protažení sítě, cad/asm-spring-geom.ts springMeshMatrix).
 */
export function springCoilView(c: AsmComponent, key: string): { key: string; mesh: MeshData; matrix: number[] } | null {
  // `key` = klíč zdroje komponenty (sourceKey) – síť se v zobrazení pamatuje pod klíčem zdroje + délkou
  const s = c.spring;
  if (!s || c.source.kind !== "part") return null;
  const g = springGeom(c.source.doc);
  if (!g) return null;
  const L = s.length ?? g.length;
  const mesh = coilMeshAt(c.source.doc, L);
  if (!mesh) return null;
  const off = s.offset ?? 0;
  const t = scale(g.axis, off);
  return { key: `${key}|coil|${Math.round(L * 100) / 100}`, mesh, matrix: [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, t[0], t[1], t[2], 1] };
}
