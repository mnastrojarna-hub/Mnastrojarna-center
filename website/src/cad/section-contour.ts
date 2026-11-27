/**
 * Vlna 22, kolo 7 (čela řezu – „obrys čela se nekreslí“): obrys čela řezu = průsečnice roviny řezu se sítí tělesa.
 *
 * Čistá funkce bez three.js – stejné úsečky kreslí 3D okno (`components/cad/section-cap-gl.ts`, `LineSegments` v místních
 * souřadnicích komponenty, hýbe se s ní) i softwarový náhled (`soft-render.ts`, průchod hran s hloubkovým testem). Obrys je
 * vázaný na model (ne na pixely obrazovky): při otáčení, přiblížení i přehrávání studie leží přesně na hranici čela.
 *
 * Rovina: zachová se poloprostor `n·p + c ≥ 0` (shodně s THREE.Plane a `SoftClip`). Úsečky leží v rovině; `offset` je posune
 * po normále (záporný = do odebrané strany, odkud je čelo vidět), aby obrys nezápasil s čelem o hloubku.
 */
import type { Vec3 } from "./types";

export type PlaneLocal = { normal: Vec3; constant: number };

/**
 * Rovina řezu ve světových souřadnicích → místní souřadnice komponenty s maticí `m` (4×4 po sloupcích, p_w = A·p_l + t):
 * n·(A·p + t) + c = (Aᵀ·n)·p + (n·t + c). Bez matice beze změny.
 */
export function localPlane(m: ArrayLike<number> | null | undefined, normal: Vec3, constant: number): PlaneLocal {
  if (!m || m.length < 16) return { normal: [normal[0], normal[1], normal[2]], constant };
  const [nx, ny, nz] = normal;
  return {
    normal: [m[0] * nx + m[1] * ny + m[2] * nz, m[4] * nx + m[5] * ny + m[6] * nz, m[8] * nx + m[9] * ny + m[10] * nz],
    constant: nx * m[12] + ny * m[13] + nz * m[14] + constant,
  };
}

/**
 * Průsečnice roviny se sítí: úsečky (6 čísel na úsečku) v souřadnicích sítě. Vrchol přesně v rovině patří ponechané straně
 * (≥ 0), takže každý trojúhelník dá nejvýš jednu úsečku a sousední trojúhelníky sdílejí koncové body (uzavřený obrys).
 */
export function sectionContour(V: ArrayLike<number>, T: ArrayLike<number>, pl: PlaneLocal, offset = 0): Float32Array {
  const [nx, ny, nz] = pl.normal;
  const len = Math.hypot(nx, ny, nz);
  if (!(len > 0)) return new Float32Array(0);
  const ux = nx / len, uy = ny / len, uz = nz / len;
  const c = pl.constant / len;
  const ox = ux * offset, oy = uy * offset, oz = uz * offset;
  const nv = Math.floor(V.length / 3);
  const d = new Float64Array(nv);
  for (let i = 0, j = 0; i < nv; i++, j += 3) d[i] = ux * V[j] + uy * V[j + 1] + uz * V[j + 2] + c;
  const out: number[] = [];
  const pt = (a: number, b: number) => {
    const da = d[a], db = d[b];
    const t = da / (da - db);
    const ja = a * 3, jb = b * 3;
    out.push(V[ja] + (V[jb] - V[ja]) * t + ox, V[ja + 1] + (V[jb + 1] - V[ja + 1]) * t + oy, V[ja + 2] + (V[jb + 2] - V[ja + 2]) * t + oz);
  };
  for (let t = 0; t + 2 < T.length; t += 3) {
    const a = T[t], b = T[t + 1], cc = T[t + 2];
    if (a >= nv || b >= nv || cc >= nv) continue;
    const sa = d[a] >= 0, sb = d[b] >= 0, sc = d[cc] >= 0;
    if (sa === sb && sb === sc) continue;
    // dvě hrany trojúhelníku mění stranu: vrchol, který je sám na své straně, je jejich společný
    if (sa !== sb && sa !== sc) {
      pt(a, b);
      pt(a, cc);
    } else if (sb !== sa && sb !== sc) {
      pt(b, a);
      pt(b, cc);
    } else {
      pt(cc, a);
      pt(cc, b);
    }
  }
  return new Float32Array(out);
}

/** mezipaměť obrysů: síť (pole trojúhelníků) → místní rovina → úsečky; nejvýš CACHE_PER_MESH rovin na síť (nejstarší pryč) */
const CACHE = new WeakMap<object, Map<string, Float32Array>>();
const CACHE_PER_MESH = 64;
const r9 = (v: number) => Math.round(v * 1e9) / 1e9;

/**
 * `sectionContour` s mezipamětí podle sítě (pole trojúhelníků) a místní roviny: při přehrávání studie se obrys přepočítá
 * jen u komponent, které se vůči rovině řezu pohnuly; stejné kusy (sdílená síť) ve stejné místní rovině sdílejí výsledek.
 */
export function cachedContour(V: ArrayLike<number>, T: ArrayLike<number> & object, pl: PlaneLocal, offset = 0): Float32Array {
  const key = `${r9(pl.normal[0])},${r9(pl.normal[1])},${r9(pl.normal[2])},${r9(pl.constant)},${r9(offset)},${V.length}`;
  let m = CACHE.get(T);
  if (!m) CACHE.set(T, (m = new Map()));
  const hit = m.get(key);
  if (hit) return hit;
  const seg = sectionContour(V, T, pl, offset);
  if (m.size >= CACHE_PER_MESH) m.delete(m.keys().next().value as string);
  m.set(key, seg);
  return seg;
}

/** součet délek úseček (kontrola obrysu v testech a diagnostice) */
export function contourLength(seg: ArrayLike<number>): number {
  let s = 0;
  for (let j = 0; j + 5 < seg.length; j += 6) s += Math.hypot(seg[j + 3] - seg[j], seg[j + 4] - seg[j + 1], seg[j + 5] - seg[j + 2]);
  return s;
}
