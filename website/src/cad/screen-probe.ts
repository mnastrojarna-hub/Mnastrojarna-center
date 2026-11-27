/**
 * Kde na obrazovce kliknout na plochu / hranu / vrchol komponenty (vlna 22 kolo 7, bod 20 – testovací háček).
 *
 * E2E testy dřív uměly kliknout na hranu jen v softwarovém náhledu (čtení pixelů plátna) a na vrchol vůbec; ve WebGL
 * nebylo jak zjistit, kde entita na obrazovce leží. `entityCandidates` dá body entity ve světových souřadnicích ze sítě,
 * kterou kreslí obě 3D okna (MeshData + topologické vrcholy + matice komponenty), `findOnScreen` je promítne kamerou okna
 * a ověří STEJNÝM výběrem, jaký dělá klik myší (pick podle filtru), že bod opravdu vybere tuto entitu (není zakrytá jiným
 * dílem, leží v okně). Vrací souřadnice klienta pro skutečný klik myší (`page.mouse.click`) – samotný výběr dělá aplikace.
 */
import type { MeshData, Vec3 } from "./types";

export type ProbeKind = "face" | "edge" | "vertex";
export type ProbeQuery = { /** id listu sestavy (u dílu bez) */ compId?: string; kind: ProbeKind; index: number };
export type ProbeHit = { x: number; y: number; /** bod entity ve světě, na který se kliká */ p: Vec3 };
export type ProbeSource = { mesh: MeshData | null | undefined; /** topologické vrcholy (x, y, z …) */ vertices?: Float32Array | null; /** matice komponenty po sloupcích (THREE) */ matrix?: ArrayLike<number> | null };
export type ProbePick = { kind?: string; index?: number; compId?: string } | null;

const xf = (m: ArrayLike<number> | null | undefined, x: number, y: number, z: number): Vec3 =>
  m && m.length >= 16 ? [m[0] * x + m[4] * y + m[8] * z + m[12], m[1] * x + m[5] * y + m[9] * z + m[13], m[2] * x + m[6] * y + m[10] * z + m[14]] : [x, y, z];

/** body entity (svět): vrchol = 1 bod; hrana = body podél úseček (střed, čtvrtiny); plocha = těžiště trojúhelníků od největšího */
export function entityCandidates(src: ProbeSource, kind: ProbeKind, index: number, max = 64): Vec3[] {
  const m = src.matrix;
  if (kind === "vertex") {
    const v = src.vertices;
    if (!v || index < 0 || index * 3 + 2 >= v.length) return [];
    return [xf(m, v[index * 3], v[index * 3 + 1], v[index * 3 + 2])];
  }
  const mesh = src.mesh;
  if (!mesh) return [];
  if (kind === "edge") {
    const L = mesh.lines;
    const g = mesh.edgeGroups;
    const out: Vec3[] = [];
    for (let i = 0; i + 2 < g.length; i += 3) {
      if (g[i + 2] !== index) continue;
      const start = g[i];
      const count = g[i + 1];
      for (let q = start; q + 1 < start + count && out.length < max; q += 2) {
        for (const f of [0.5, 0.3, 0.7, 0.15, 0.85]) {
          const a = q * 3;
          const b = (q + 1) * 3;
          out.push(xf(m, L[a] + (L[b] - L[a]) * f, L[a + 1] + (L[b + 1] - L[a + 1]) * f, L[a + 2] + (L[b + 2] - L[a + 2]) * f));
        }
      }
    }
    // střed hrany první (u úsečky střed, u křivky prostřední úsek)
    const mid = out.length ? Math.floor(out.length / 10) * 5 : 0;
    return out.length ? [...out.slice(mid), ...out.slice(0, mid)].slice(0, max) : out;
  }
  const V = mesh.vertices;
  const T = mesh.triangles;
  const g = mesh.faceGroups;
  const tris: { c: Vec3; area: number }[] = [];
  for (let i = 0; i + 2 < g.length; i += 3) {
    if (g[i + 2] !== index) continue;
    const t0 = Math.floor(g[i] / 3);
    const t1 = Math.floor((g[i] + g[i + 1]) / 3);
    for (let t = t0; t < t1 && t * 3 + 2 < T.length; t++) {
      const a = T[t * 3] * 3;
      const b = T[t * 3 + 1] * 3;
      const c = T[t * 3 + 2] * 3;
      const ux = V[b] - V[a], uy = V[b + 1] - V[a + 1], uz = V[b + 2] - V[a + 2];
      const vx = V[c] - V[a], vy = V[c + 1] - V[a + 1], vz = V[c + 2] - V[a + 2];
      const area = Math.hypot(uy * vz - uz * vy, uz * vx - ux * vz, ux * vy - uy * vx) / 2;
      tris.push({ c: xf(m, (V[a] + V[b] + V[c]) / 3, (V[a + 1] + V[b + 1] + V[c + 1]) / 3, (V[a + 2] + V[b + 2] + V[c + 2]) / 3), area });
    }
  }
  return tris
    .sort((x, y) => y.area - x.area)
    .slice(0, max)
    .map((x) => x.c);
}

/**
 * První bod entity, který po promítnutí leží v okně a klik na něj (stejný výběr jako myš, `pick`) vybere právě tuto entitu.
 * `project` = svět → souřadnice klienta (null mimo okno). null = entita není vidět (zakrytá, mimo pohled, neexistuje).
 */
export function findOnScreen(cands: Vec3[], q: ProbeQuery, project: (p: Vec3) => [number, number] | null, pick: (x: number, y: number) => ProbePick): ProbeHit | null {
  for (const p of cands) {
    const s = project(p);
    if (!s || !Number.isFinite(s[0]) || !Number.isFinite(s[1])) continue;
    const x = Math.round(s[0]);
    const y = Math.round(s[1]);
    const r = pick(x, y);
    if (r && r.kind === q.kind && r.index === q.index && (q.compId === undefined || r.compId === q.compId)) return { x, y, p };
  }
  return null;
}
