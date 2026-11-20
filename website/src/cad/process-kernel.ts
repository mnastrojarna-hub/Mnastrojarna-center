/**
 * Procesní vrstva pohybové studie v jádře (vlna 22, bod 4 zprávy – „pohybová studie neukazovala vznik střihu a otisku“).
 * Operace `process` (smlouva cad/process-types.ts): GEOMETRICKÁ APROXIMACE střihu a otisku – booleovské operace na tělesech,
 * žádná simulace materiálu (síly, otřep, odpružení, tok materiálu se nepočítají).
 *
 * Pro každý krok studie, ve kterém operace platí:
 *  1. síto obálek (lokální kvádr nástroje v poloze kroku × kvádr obrobku) – bez překryvu žádný záběr;
 *  2. C = T ∩ P(m) (T = PŮVODNÍ obrobek, P = nástroj v poloze kroku; `pairIntersection` z kontroly kolizí – stejná zaokrouhlená
 *     matice, stejný výsledek jako objem kolize);
 *  3. směr pohybu d = posuv nástroje mezi kroky (v souřadnicích obrobku); hrot = největší průmět vrcholů nástroje na d, vstup =
 *     nejmenší průmět C při prvním záběru; průnik pen = hrot − vstup. Hloubka D (otisk / nástřih): nástroj se pro výpočet posune
 *     zpět o pen − D, takže materiál je odebrán nejvýš do hloubky D;
 *  4. R = R ∪ C (odebraný objem roste – co je jednou odstřiženo, už se nevrací; návrat nástroje nic nepřidá);
 *     prostřiženo ⇔ hrot opustil materiál na druhé straně (pen − rozsah C podél d > 1e-3 mm) → R je oddělený odpad;
 *  5. stav = T − R: odebraný objem (přesně z jádra), objem zbytku, odpad; sítě jen na požádání (zobrazení v prohlížeči).
 *
 * Výkon: celá odpověď se pamatuje podle klíče požadavku (stejná studie = žádný přepočet; sítě se dopočítají ze zapamatovaných stavů),
 * průnik C podle klíče polohy; nejvýš `maxOps` (výchozí 48) booleovských sjednocení na operaci – kroky se záběrem nad strop se
 * podvzorkují (každý n-tý a poslední) a odpověď to uvede (`approx`).
 */
import * as r from "replicad";
import { pairIntersection, partEntry } from "./asm-kernel";
import { meshArrays } from "./build";
import { PROC_MAX_OPS, procKey, type ProcReq, type ProcRes, type ProcState, type ProcStep } from "./process-types";
import type { MeshData, Vec3 } from "./types";

type Shape = r.Shape3D;

const EPS_THROUGH = 1e-3;
const DEFAULT_MAX_OPS = PROC_MAX_OPS;
const MESH_TOL = 0.02;
const MESH_ANG = 0.3;

/** stav s tvary (pro sítě na požádání) */
type Held = { res: ProcRes; bodies: (Shape | null)[]; scraps: (Shape | null)[]; used: number };
const memo = new Map<string, Held>();
let tick = 0;
const MAX_MEMO = 12;

function forget(key: string) {
  const h = memo.get(key);
  if (!h) return;
  for (const s of [...h.bodies, ...h.scraps]) s?.delete();
  memo.delete(key);
}
function trimMemo() {
  while (memo.size > MAX_MEMO) {
    const old = [...memo.entries()].sort((a, b) => a[1].used - b[1].used)[0];
    forget(old[0]);
  }
}
/** smaže zapamatované stavy (testy, uvolnění paměti) */
export function clearProcessCache(): void {
  for (const k of [...memo.keys()]) forget(k);
}

const dot = (a: Vec3, b: Vec3) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
/** poloha bodu nástroje v souřadnicích obrobku: R·p + t (m = [R po řádcích, t]) */
const ap = (m: number[], p: Vec3): Vec3 => [m[0] * p[0] + m[1] * p[1] + m[2] * p[2] + m[9], m[3] * p[0] + m[4] * p[1] + m[5] * p[2] + m[10], m[6] * p[0] + m[7] * p[1] + m[8] * p[2] + m[11]];

/** průměty vrcholů sítě na směr d (min, max) */
function projRange(vertices: Float32Array, d: Vec3, m?: number[]): [number, number] {
  let lo = Infinity;
  let hi = -Infinity;
  for (let i = 0; i + 2 < vertices.length; i += 3) {
    const p: Vec3 = [vertices[i], vertices[i + 1], vertices[i + 2]];
    const v = dot(m ? ap(m, p) : p, d);
    if (v < lo) lo = v;
    if (v > hi) hi = v;
  }
  return [lo, hi];
}
function shapeRange(s: Shape, d: Vec3): [number, number] {
  const mesh = meshArrays(s, MESH_TOL, MESH_ANG);
  return projRange(mesh.vertices, d);
}
function volumeOf(s: Shape | null): number {
  if (!s) return 0;
  try {
    return r.measureVolume(s);
  } catch {
    return 0;
  }
}
function centerOf(s: Shape): Vec3 {
  const b = s.boundingBox;
  const [[x0, y0, z0], [x1, y1, z1]] = b.bounds as [Vec3, Vec3];
  b.delete();
  return [(x0 + x1) / 2, (y0 + y1) / 2, (z0 + z1) / 2];
}
function meshOf(s: Shape | null): MeshData | null {
  if (!s) return null;
  try {
    const m = meshArrays(s, MESH_TOL, MESH_ANG);
    return { vertices: m.vertices, normals: m.normals, triangles: m.triangles, faceGroups: m.faceGroups, lines: m.lines, edgeGroups: m.edgeGroups };
  } catch {
    return null;
  }
}
/** obálka (lokální kvádr) v poloze m – 8 rohů */
function boxAt([lo, hi]: [Vec3, Vec3], m: number[]): [Vec3, Vec3] {
  const out: [Vec3, Vec3] = [
    [Infinity, Infinity, Infinity],
    [-Infinity, -Infinity, -Infinity],
  ];
  for (let c = 0; c < 8; c++) {
    const w = ap(m, [c & 1 ? hi[0] : lo[0], c & 2 ? hi[1] : lo[1], c & 4 ? hi[2] : lo[2]]);
    for (let i = 0; i < 3; i++) {
      if (w[i] < out[0][i]) out[0][i] = w[i];
      if (w[i] > out[1][i]) out[1][i] = w[i];
    }
  }
  return out;
}
const overlap = (a: [Vec3, Vec3], b: [Vec3, Vec3]) => [0, 1, 2].every((i) => a[0][i] <= b[1][i] && b[0][i] <= a[1][i]);


/**
 * Procesní operace v jádře (viz hlavička). `req.mesh` = stavy, jejichž sítě se vrátí (obrobek po operaci a odpad).
 */
export async function processOp(req: ProcReq): Promise<ProcRes> {
  const key = procKey(req);
  let held = memo.get(key);
  if (!held) {
    held = await compute(req);
    memo.set(key, held);
    trimMemo();
  } else held.res = { ...held.res, cached: true };
  held.used = ++tick;
  if (!req.mesh?.length) return { ...held.res, states: held.res.states.map(({ mesh: _m, scrapMesh: _s, ...rest }) => rest) };
  const want = new Set(req.mesh);
  return {
    ...held.res,
    states: held.res.states.map((s, i) => (want.has(i) ? { ...s, mesh: meshOf(held!.bodies[i]), scrapMesh: meshOf(held!.scraps[i]) } : s)),
  };
}

async function compute(req: ProcReq): Promise<Held> {
  const t0 = Date.now();
  const te = await partEntry(req.target.key, req.target.source);
  const pe = await partEntry(req.tool.key, req.tool.source);
  const T = te.body as Shape | null;
  const P = pe.body as Shape | null;
  const volume0 = te.result.metrics?.volume ?? volumeOf(T);
  const n = req.rels.length;
  const empty = (): ProcStep => ({ contact: false, depth: 0, through: false, state: 0 });
  const steps: ProcStep[] = Array.from({ length: n }, empty);
  const states: ProcState[] = [{ removed: 0, volume: volume0, scrap: [] }];
  const bodies: (Shape | null)[] = [null];
  const scraps: (Shape | null)[] = [null];
  if (!T || !P) return { res: { steps, states, dir: null, thickness: null, volume0, error: !T ? "target" : "tool", ms: Date.now() - t0 }, bodies, scraps, used: 0 };
  const tBox = te.result.metrics?.bbox ?? (T.boundingBox.bounds as [Vec3, Vec3]);
  const pBox = pe.result.metrics?.bbox ?? (P.boundingBox.bounds as [Vec3, Vec3]);
  const pVerts = pe.result.mesh?.vertices ?? meshArrays(P, MESH_TOL, MESH_ANG).vertices;
  // směr pohybu: první nenulový posuv nástroje mezi kroky (v souřadnicích obrobku)
  let dir: Vec3 | null = null;
  for (let k = 1; k < n && !dir; k++) {
    const a = req.rels[k - 1];
    const b = req.rels[k];
    if (!a || !b) continue;
    const v: Vec3 = [b[9] - a[9], b[10] - a[10], b[11] - a[11]];
    const l = Math.hypot(...v);
    if (l > 1e-9) dir = [v[0] / l, v[1] / l, v[2] / l];
  }
  // kroky s překryvem obálek (kandidáti záběru) a strop booleovských operací
  const cand: number[] = [];
  for (let k = 0; k < n; k++) {
    const m = req.rels[k];
    if (m && overlap(boxAt(pBox, m), tBox)) cand.push(k);
  }
  const maxOps = Math.max(2, req.maxOps ?? DEFAULT_MAX_OPS);
  let pick = new Set(cand);
  if (cand.length > maxOps) {
    // rovnoměrně nejvýš `maxOps` kroků se záběrem, vždy první a poslední
    pick = new Set(Array.from({ length: maxOps }, (_, j) => cand[Math.round((j * (cand.length - 1)) / (maxOps - 1))]));
  }
  const commons = new Map<string, Shape | null>();
  let R: Shape | null = null;
  let entry: number | null = null;
  let thickness: number | null = null;
  let through = false;
  let depth = 0;
  let state = 0;
  let error: string | undefined;
  let computed = 0;
  let contactSteps = 0;
  try {
    for (let k = 0; k < n; k++) {
      const m0 = req.rels[k];
      steps[k] = { contact: false, depth, through, state };
      if (!m0 || !cand.includes(k)) continue;
      if (!pick.has(k)) {
        steps[k] = { ...steps[k], skipped: true };
        continue;
      }
      const d: Vec3 = dir ?? [0, 0, -1];
      // hrot nástroje v poloze kroku
      const tip = projRange(pVerts, d, m0)[1];
      let m = m0;
      let C = commonAt(T, P, m, commons);
      if (!C) continue;
      const cr = shapeRange(C, d);
      if (entry === null) entry = cr[0];
      const pen = tip - entry;
      // hloubka zásahu (otisk / nástřih): nástroj o (pen − D) zpět → materiál odebrán nejvýš do hloubky D
      if (req.depth !== undefined && pen > req.depth + 1e-9) {
        const back = pen - req.depth;
        m = [...m0];
        m[9] -= back * d[0];
        m[10] -= back * d[1];
        m[11] -= back * d[2];
        C = commonAt(T, P, m, commons);
        if (!C) continue;
      }
      contactSteps++;
      computed++;
      const ext = shapeRange(C, d);
      const penEff = req.depth !== undefined ? Math.min(pen, req.depth) : pen;
      const thr = req.kind === "cut" && penEff - (ext[1] - ext[0]) > EPS_THROUGH;
      // sjednocení odebraného objemu (původní obrobek ∩ nástroj v krocích dosud)
      const next: Shape = R ? (R.fuse(C) as Shape) : (C.clone() as Shape);
      if (R) R.delete();
      R = next;
      const rr = shapeRange(R, d);
      depth = Math.max(depth, rr[1] - rr[0]);
      if (thr && !through) {
        through = true;
        thickness = ext[1] - ext[0];
      }
      // nový stav obrobku: T − R; odpad = R po prostřižení
      const body = T.clone().cut(R) as Shape;
      const removed = volumeOf(R);
      const scrapShape = through ? (R.clone() as Shape) : null;
      states.push({ removed, volume: volumeOf(body), scrap: scrapShape ? [{ volume: removed, center: centerOf(scrapShape) }] : [] });
      bodies.push(body);
      scraps.push(scrapShape);
      state = states.length - 1;
      steps[k] = { contact: true, depth, through, state };
    }
  } catch (e) {
    error = (e as Error)?.message ?? String(e);
  } finally {
    R?.delete();
    for (const s of commons.values()) s?.delete();
  }
  // podvzorkované kroky se záběrem: stav předchozího spočítaného kroku, „v záběru“
  for (let k = 1; k < n; k++) if (steps[k].skipped) steps[k] = { ...steps[k - 1], skipped: true, contact: true };
  const res: ProcRes = {
    steps,
    states,
    dir,
    thickness,
    volume0,
    ...(cand.length > pick.size ? { approx: { contact: cand.length, computed: pick.size } } : {}),
    ...(error ? { error } : {}),
    ms: Date.now() - t0,
  };
  void contactSteps;
  void computed;
  return { res, bodies, scraps, used: 0 };
}

/** T ∩ P(m) (zapamatováno podle matice); prázdný průnik / selhání → null */
function commonAt(T: Shape, P: Shape, m: number[], cache: Map<string, Shape | null>): Shape | null {
  const k = m.map((v) => Math.round(v * 1e7)).join(",");
  if (cache.has(k)) return cache.get(k)!;
  const c = pairIntersection(T, P, m);
  let out: Shape | null = c;
  if (c && volumeOf(c) < 1e-9) {
    c.delete();
    out = null;
  }
  cache.set(k, out);
  return out;
}
