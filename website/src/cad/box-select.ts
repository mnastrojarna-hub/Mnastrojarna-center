/**
 * Výběr oknem a křížením ve 3D (WebGL i náhled bez WebGL) – čistá geometrie nad promítnutými sítěmi (běží i v testech).
 *
 * Pravidla (jako AutoCAD / SolidWorks / ZW3D):
 * – okno (tažení zleva doprava): vybere se entita, jejíž celý průmět leží uvnitř obdélníku,
 * – křížení (zprava doleva): vybere se entita, která do obdélníku zasahuje nebo se ho dotkne,
 * – „jen viditelné“ (výchozí): entita zakrytá jinou plochou se nevybere; „i skryté“ (`occlude: false`) vybere i ji.
 *   Okno navíc chce, aby entita byla vidět aspoň zčásti; křížení, aby byla vidět část uvnitř obdélníku.
 *
 * Viditelnost:
 * – plochy a tělesa: hloubkový a ID buffer (rasterizace trojúhelníků do buněk o velikosti `cell` px, nejvýš ~360 000
 *   buněk); plocha je vidět, vyhraje-li aspoň jednu buňku. Plocha menší než pár buněk (úzké zaoblení) se ověří i těžišti
 *   svých trojúhelníků (bodový test níže);
 * – hrany a vrcholy: bodový test – bod je zakrytý, pokryje-li ho (s okrajem 0,5 px) trojúhelník, který vyhrál buňku
 *   v okolí 3 × 3, a je-li ten trojúhelník v místě bodu blíž ke kameře o víc než toleranci. Hloubka trojúhelníku se
 *   počítá přesně v místě bodu (perspektivně správná interpolace), takže hrana ležící na ploše zakrytá není. Hrana se
 *   vzorkuje po ~1,5–2 px; vzorky do ~3 px od konců hrany se vynechají (konec skryté hrany je často viditelný vrchol).
 * – řez: 3D okno kreslí víčko řezu jako odvrácené stěny zachované části (plná barva), skutečné víčko ale leží v rovině
 *   řezu. Je-li v místě bodu nejbližší zasažený trojúhelník odvrácený (a žádná přivrácená plocha neprochází bodem),
 *   paprsek vstoupil do tělesa rovinou řezu – bod zakrývá víčko, je-li rovina v místě bodu blíž ke kameře. Hrany a
 *   vrcholy vnitřku tělesa pod víčkem (vnitřní rohy vzdálených stěn a dna) se tak nevyberou.
 *
 * Kamera: `view` (svět → kamera, kamera hledí do −Z) a `proj` (kamera → clip prostor) jako `THREE.Camera`
 * (`matrixWorldInverse`, `projectionMatrix`), po sloupcích; pravoúhlé i perspektivní promítání. Souřadnice obdélníku
 * jsou CSS px plátna (0,0 vlevo nahoře).
 */
import type { Vec3 } from "./types";

export type BoxRect = { x0: number; y0: number; x1: number; y1: number };
/** Rovina řezu: zachová se poloprostor `normal·p + constant ≥ 0` (shodně s THREE.Plane). */
export type BoxClip = { normal: Vec3; constant: number };

/** Síť k výběru: díl (bez `matrix`) nebo komponenta sestavy. */
export type BoxItem = {
  vertices: Float32Array;
  triangles: Uint32Array;
  /** [start, count, faceIndex] po trojicích (start/count v indexech `triangles`) */
  faceGroups?: Int32Array | null;
  /** úsečky hran: dva body (6 čísel) na úsečku */
  lines?: Float32Array | null;
  /** [start, count, edgeIndex] po trojicích (start/count v bodech `lines`) */
  edgeGroups?: Int32Array | null;
  /** topologické vrcholy (x, y, z po trojicích) */
  points?: Float32Array | null;
  /** matice umístění 4 × 4 po sloupcích */
  matrix?: ArrayLike<number> | null;
  /** zakrývá jiné entity (výchozí ano; průhledná / potlačená komponenta ne) */
  occluder?: boolean;
};

export type BoxCamera = {
  /** velikost plátna v CSS px */
  width: number;
  height: number;
  /** svět → kamera (po sloupcích) */
  view: ArrayLike<number>;
  /** kamera → clip prostor (po sloupcích) */
  proj: ArrayLike<number>;
};

export type BoxSceneOptions = {
  clip?: BoxClip | null;
  /** zakrytí (výchozí ano); ne = i skryté entity (drátový / průhledný styl, volba „i skryté“) */
  occlude?: boolean;
  /** vynechat odvrácené stěny (výchozí: bez řezu ano – jako vykreslení FrontSide) */
  cull?: boolean;
  /** nejvyšší počet buněk hloubkového bufferu */
  maxCells?: number;
};

export type BoxKinds = { faces?: boolean; edges?: boolean; vertices?: boolean; items?: boolean };
export type BoxQuery = { rect: BoxRect; crossing: boolean; kinds: BoxKinds };
export type BoxHits = {
  faces: { item: number; face: number }[];
  edges: { item: number; edge: number }[];
  vertices: { item: number; index: number; point: Vec3 }[];
  items: number[];
  /** doba dotazu (ms) včetně případné stavby bufferu */
  ms: number;
};

type Pts = {
  n: number;
  x: Float32Array;
  y: Float32Array;
  /** hloubka podél osy pohledu (menší = blíž) */
  d: Float32Array;
  /** 1 / w clip prostoru */
  iw: Float32Array;
  /** vzdálenost od roviny řezu (jen s řezem) */
  cd: Float32Array | null;
  /** před kamerou */
  ok: Uint8Array;
};
type Box2 = { x0: number; y0: number; x1: number; y1: number; all: boolean; any: boolean };
type FaceRec = { face: number; ranges: number[]; box: Box2; area: number };
type EdgeRec = { edge: number; s0: number; s1: number; box: Box2 };
type Proj = {
  it: BoxItem;
  v: Pts;
  l: Pts;
  p: Pts;
  /** body ve světových souřadnicích (vrcholy výsledku) */
  pw: Float32Array;
  nt: number;
  triBase: number;
  faceOf: Int32Array | null;
  flip: boolean;
  faces: FaceRec[];
  edges: EdgeRec[];
  box: Box2;
  area: number;
  occluder: boolean;
};
type Buf = { cell: number; gw: number; gh: number; depth: Float32Array; win: Int32Array; itemWin: Uint8Array | null };
/** rovina řezu v kameře (`n·q + c ≥ 0` zachováno, q v souřadnicích kamery) a prvky promítání pro převod bodu plátna na paprsek */
type CapPlane = { nx: number; ny: number; nz: number; c: number; p0: number; p5: number; p8: number; p9: number; p12: number; p13: number };

export type BoxScene = {
  W: number;
  H: number;
  items: Proj[];
  totalTris: number;
  occlude: boolean;
  cull: boolean;
  clip: BoxClip | null;
  /** rovina řezu v souřadnicích kamery a promítání (hloubka víčka v bodě plátna) – jen s řezem */
  cap: CapPlane | null;
  persp: boolean;
  /** svět na 1 px ve vzdálenosti 1 (perspektiva) nebo konstanta (pravoúhlé) */
  pxK: number;
  radius: number;
  cell: number;
  buf: Buf | null;
  stamp: Int32Array | null;
  stampN: number;
  /** doba přípravy (ms) */
  ms: number;
};

const nowMs = () => (typeof performance !== "undefined" ? performance.now() : Date.now());
const IDENT = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];

/** a × b (4 × 4 po sloupcích) */
function mul(a: ArrayLike<number>, b: ArrayLike<number>): number[] {
  const o = new Array<number>(16);
  for (let c = 0; c < 4; c++)
    for (let r = 0; r < 4; r++) {
      let s = 0;
      for (let k = 0; k < 4; k++) s += a[k * 4 + r] * b[c * 4 + k];
      o[c * 4 + r] = s;
    }
  return o;
}

/** Obdélník s x0 ≤ x1, y0 ≤ y1. */
export function normRect(r: BoxRect): BoxRect {
  return { x0: Math.min(r.x0, r.x1), y0: Math.min(r.y0, r.y1), x1: Math.max(r.x0, r.x1), y1: Math.max(r.y0, r.y1) };
}

/** Tažení zprava doleva = křížení (AutoCAD); zleva doprava = okno. */
export const isCrossingDrag = (startX: number, endX: number) => endX < startX;

/** Úsečka × obdélník (Liang–Barsky): rozsah parametru [t0, t1] uvnitř, nebo null. */
export function segRect(ax: number, ay: number, bx: number, by: number, r: BoxRect): [number, number] | null {
  let t0 = 0, t1 = 1;
  const dx = bx - ax, dy = by - ay;
  const p = [-dx, dx, -dy, dy];
  const q = [ax - r.x0, r.x1 - ax, ay - r.y0, r.y1 - ay];
  for (let i = 0; i < 4; i++) {
    if (p[i] === 0) {
      if (q[i] < 0) return null;
      continue;
    }
    const t = q[i] / p[i];
    if (p[i] < 0) {
      if (t > t1) return null;
      if (t > t0) t0 = t;
    } else {
      if (t < t0) return null;
      if (t < t1) t1 = t;
    }
  }
  return [t0, t1];
}

/** Trojúhelník × obdélník (věta o oddělující ose): dotýkají se nebo překrývají? */
export function triRect(x0: number, y0: number, x1: number, y1: number, x2: number, y2: number, r: BoxRect): boolean {
  if (Math.max(x0, x1, x2) < r.x0 || Math.min(x0, x1, x2) > r.x1 || Math.max(y0, y1, y2) < r.y0 || Math.min(y0, y1, y2) > r.y1) return false;
  const P = [x0, y0, x1, y1, x2, y2];
  for (let e = 0; e < 3; e++) {
    const ax = P[e * 2], ay = P[e * 2 + 1], bx = P[((e + 1) % 3) * 2], by = P[((e + 1) % 3) * 2 + 1];
    const cx = P[((e + 2) % 3) * 2], cy = P[((e + 2) % 3) * 2 + 1];
    const nx = ay - by, ny = bx - ax;
    const side = nx * (cx - ax) + ny * (cy - ay);
    if (side === 0) continue;
    const s = side > 0 ? 1 : -1;
    // všechny rohy obdélníku na opačné straně hrany než třetí vrchol → oddělení
    let sep = true;
    for (const [qx, qy] of [[r.x0, r.y0], [r.x1, r.y0], [r.x0, r.y1], [r.x1, r.y1]]) {
      if (s * (nx * (qx - ax) + ny * (qy - ay)) >= 0) {
        sep = false;
        break;
      }
    }
    if (sep) return false;
  }
  return true;
}

function projectPts(V: Float32Array | null | undefined, PM: number[], VM: number[], CM: number[] | null, W: number, H: number): Pts {
  const n = V ? Math.floor(V.length / 3) : 0;
  const x = new Float32Array(n), y = new Float32Array(n), d = new Float32Array(n), iw = new Float32Array(n), ok = new Uint8Array(n);
  const cd = CM ? new Float32Array(n) : null;
  const hw = W / 2, hh = H / 2;
  for (let i = 0, j = 0; i < n; i++, j += 3) {
    const px = V![j], py = V![j + 1], pz = V![j + 2];
    const cw = PM[3] * px + PM[7] * py + PM[11] * pz + PM[15];
    if (cd) cd[i] = CM![0] * px + CM![1] * py + CM![2] * pz + CM![3];
    if (!(cw > 1e-9)) continue;
    const inv = 1 / cw;
    x[i] = ((PM[0] * px + PM[4] * py + PM[8] * pz + PM[12]) * inv + 1) * hw;
    y[i] = (1 - (PM[1] * px + PM[5] * py + PM[9] * pz + PM[13]) * inv) * hh;
    d[i] = -(VM[2] * px + VM[6] * py + VM[10] * pz + VM[14]);
    iw[i] = inv;
    ok[i] = 1;
  }
  return { n, x, y, d, iw, cd, ok };
}

const emptyBox = (): Box2 => ({ x0: Infinity, y0: Infinity, x1: -Infinity, y1: -Infinity, all: true, any: false });
/** rozšíří ohraničení o bod i (body za kamerou → `all` = false; body odříznuté řezem se nepočítají) */
function grow(b: Box2, P: Pts, i: number) {
  if (P.cd && P.cd[i] < 0) return;
  if (!P.ok[i]) {
    b.all = false;
    return;
  }
  const x = P.x[i], y = P.y[i];
  if (x < b.x0) b.x0 = x;
  if (x > b.x1) b.x1 = x;
  if (y < b.y0) b.y0 = y;
  if (y > b.y1) b.y1 = y;
  b.any = true;
}
const boxInside = (b: Box2, r: BoxRect) => b.any && b.all && b.x0 >= r.x0 && b.x1 <= r.x1 && b.y0 >= r.y0 && b.y1 <= r.y1;
const boxOverlap = (b: Box2, r: BoxRect) => b.any && b.x1 >= r.x0 && b.x0 <= r.x1 && b.y1 >= r.y0 && b.y0 <= r.y1;

/**
 * Připraví scénu pro dotazy oknem (jednou na tažení – kamera se během tažení nemění): promítne vrcholy, úsečky hran
 * a body, spočte ohraničení ploch, hran a těles. Hloubkový buffer se postaví až při prvním dotazu, který ho potřebuje.
 */
export function prepareBox(items: BoxItem[], cam: BoxCamera, o: BoxSceneOptions = {}): BoxScene {
  const t0 = nowMs();
  const W = Math.max(1, cam.width), H = Math.max(1, cam.height);
  const clip = o.clip ?? null;
  const persp = Math.abs(cam.proj[15]) < 1e-12;
  const p5 = Math.abs(cam.proj[5]) || 1;
  let triBase = 0;
  let wx0 = Infinity, wy0 = Infinity, wz0 = Infinity, wx1 = -Infinity, wy1 = -Infinity, wz1 = -Infinity;
  const proj: Proj[] = items.map((it) => {
    const M = it.matrix && it.matrix.length >= 16 ? Array.from(it.matrix) : IDENT;
    const VM = mul(cam.view, M);
    const PM = mul(cam.proj, VM);
    const CM = clip ? [clip.normal[0] * M[0] + clip.normal[1] * M[1] + clip.normal[2] * M[2], clip.normal[0] * M[4] + clip.normal[1] * M[5] + clip.normal[2] * M[6], clip.normal[0] * M[8] + clip.normal[1] * M[9] + clip.normal[2] * M[10], clip.normal[0] * M[12] + clip.normal[1] * M[13] + clip.normal[2] * M[14] + clip.constant] : null;
    const det = M[0] * (M[5] * M[10] - M[9] * M[6]) - M[4] * (M[1] * M[10] - M[9] * M[2]) + M[8] * (M[1] * M[6] - M[5] * M[2]);
    const v = projectPts(it.vertices, PM, VM, CM, W, H);
    const l = projectPts(it.lines, PM, VM, CM, W, H);
    const p = projectPts(it.points, PM, VM, CM, W, H);
    const P = it.points;
    const pw = new Float32Array(p.n * 3);
    for (let i = 0; i < p.n; i++) {
      const x = P![i * 3], y = P![i * 3 + 1], z = P![i * 3 + 2];
      pw[i * 3] = M[0] * x + M[4] * y + M[8] * z + M[12];
      pw[i * 3 + 1] = M[1] * x + M[5] * y + M[9] * z + M[13];
      pw[i * 3 + 2] = M[2] * x + M[6] * y + M[10] * z + M[14];
    }
    // ohraničení ve světě (poloměr scény → tolerance hloubky)
    const V = it.vertices;
    let lx0 = Infinity, ly0 = Infinity, lz0 = Infinity, lx1 = -Infinity, ly1 = -Infinity, lz1 = -Infinity;
    for (let j = 0; j + 2 < V.length; j += 3) {
      if (V[j] < lx0) lx0 = V[j];
      if (V[j] > lx1) lx1 = V[j];
      if (V[j + 1] < ly0) ly0 = V[j + 1];
      if (V[j + 1] > ly1) ly1 = V[j + 1];
      if (V[j + 2] < lz0) lz0 = V[j + 2];
      if (V[j + 2] > lz1) lz1 = V[j + 2];
    }
    if (Number.isFinite(lx0))
      for (const cx of [lx0, lx1])
        for (const cy of [ly0, ly1])
          for (const cz of [lz0, lz1]) {
            const x = M[0] * cx + M[4] * cy + M[8] * cz + M[12], y = M[1] * cx + M[5] * cy + M[9] * cz + M[13], z = M[2] * cx + M[6] * cy + M[10] * cz + M[14];
            wx0 = Math.min(wx0, x); wx1 = Math.max(wx1, x); wy0 = Math.min(wy0, y); wy1 = Math.max(wy1, y); wz0 = Math.min(wz0, z); wz1 = Math.max(wz1, z);
          }
    // plochy: rozsahy trojúhelníků, ohraničení a plocha průmětu
    const nt = Math.floor(it.triangles.length / 3);
    const T = it.triangles;
    let faceOf: Int32Array | null = null;
    const byFace = new Map<number, FaceRec>();
    const fg = it.faceGroups;
    if (fg && fg.length >= 3) {
      faceOf = new Int32Array(nt).fill(-1);
      for (let g = 0; g + 2 < fg.length; g += 3) {
        const a = Math.floor(fg[g] / 3), b = Math.min(nt, Math.floor((fg[g] + fg[g + 1]) / 3)), f = fg[g + 2];
        if (b <= a) continue;
        for (let t = a; t < b; t++) faceOf[t] = f;
        let rec = byFace.get(f);
        if (!rec) byFace.set(f, (rec = { face: f, ranges: [], box: emptyBox(), area: 0 }));
        rec.ranges.push(a, b);
      }
    }
    const box = emptyBox();
    let area = 0;
    for (let i = 0; i < v.n; i++) grow(box, v, i);
    for (const rec of byFace.values()) {
      for (let k = 0; k < rec.ranges.length; k += 2)
        for (let t = rec.ranges[k]; t < rec.ranges[k + 1]; t++) {
          const a = T[t * 3], b = T[t * 3 + 1], c = T[t * 3 + 2];
          grow(rec.box, v, a);
          grow(rec.box, v, b);
          grow(rec.box, v, c);
          if (v.ok[a] && v.ok[b] && v.ok[c]) rec.area += Math.abs((v.x[b] - v.x[a]) * (v.y[c] - v.y[a]) - (v.x[c] - v.x[a]) * (v.y[b] - v.y[a])) / 2;
        }
      area += rec.area;
    }
    if (!byFace.size)
      for (let t = 0; t < nt; t++) {
        const a = T[t * 3], b = T[t * 3 + 1], c = T[t * 3 + 2];
        if (v.ok[a] && v.ok[b] && v.ok[c]) area += Math.abs((v.x[b] - v.x[a]) * (v.y[c] - v.y[a]) - (v.x[c] - v.x[a]) * (v.y[b] - v.y[a])) / 2;
      }
    // hrany: rozsahy úseček a ohraničení
    const edges: EdgeRec[] = [];
    const eg = it.edgeGroups;
    const ns = Math.floor(l.n / 2);
    if (eg && eg.length >= 3) {
      const byEdge = new Map<number, EdgeRec>();
      for (let g = 0; g + 2 < eg.length; g += 3) {
        const s0 = Math.floor(eg[g] / 2), s1 = Math.min(ns, Math.floor((eg[g] + eg[g + 1]) / 2)), e = eg[g + 2];
        if (s1 <= s0) continue;
        const prev = byEdge.get(e);
        // hrana ve více skupinách (výjimečně): rozsah sjednotit jen při návaznosti, jinak další záznam
        const rec: EdgeRec = prev && prev.s1 === s0 ? prev : { edge: e, s0, s1, box: emptyBox() };
        rec.s1 = s1;
        if (rec !== prev) {
          edges.push(rec);
          byEdge.set(e, rec);
        }
        for (let k = s0; k < s1; k++) {
          grow(rec.box, l, 2 * k);
          grow(rec.box, l, 2 * k + 1);
        }
      }
    }
    const pr: Proj = { it, v, l, p, pw, nt, triBase, faceOf, flip: det < 0, faces: [...byFace.values()], edges, box, area, occluder: it.occluder !== false };
    triBase += nt;
    return pr;
  });
  const radius = Number.isFinite(wx0) ? Math.max(1e-6, Math.hypot(wx1 - wx0, wy1 - wy0, wz1 - wz0) / 2) : 1;
  const maxCells = o.maxCells ?? 360_000;
  // rovina řezu v kameře: q = R p + t → n·p + c = (R n)·q + c − (R n)·t (pohled bez měřítka)
  let cap: CapPlane | null = null;
  if (clip) {
    const V = cam.view, n = clip.normal;
    const nx = V[0] * n[0] + V[4] * n[1] + V[8] * n[2], ny = V[1] * n[0] + V[5] * n[1] + V[9] * n[2], nz = V[2] * n[0] + V[6] * n[1] + V[10] * n[2];
    const P = cam.proj;
    cap = { nx, ny, nz, c: clip.constant - (nx * V[12] + ny * V[13] + nz * V[14]), p0: P[0] || 1, p5: P[5] || 1, p8: P[8], p9: P[9], p12: P[12], p13: P[13] };
  }
  const cell = Math.max(1, Math.ceil(Math.sqrt((W * H) / maxCells) * 100) / 100);
  return {
    W,
    H,
    items: proj,
    totalTris: triBase,
    occlude: o.occlude !== false,
    cull: o.cull ?? !clip,
    clip,
    cap,
    persp,
    pxK: 2 / (H * p5),
    radius,
    cell,
    buf: null,
    stamp: null,
    stampN: 0,
    ms: nowMs() - t0,
  };
}

/** velikost 1 px ve světě v hloubce d */
const pxAt = (s: BoxScene, d: number) => (s.persp ? Math.abs(d) * s.pxK : s.pxK);
/** tolerance hloubky v hloubce d */
const tolAt = (s: BoxScene, d: number) => s.radius * 1e-3 + pxAt(s, d) * 0.75;

function itemOfTri(s: BoxScene, gid: number): number {
  const it = s.items;
  let lo = 0, hi = it.length - 1;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if (it[mid].triBase <= gid) lo = mid;
    else hi = mid - 1;
  }
  return lo;
}

/** Hloubkový a ID buffer celého plátna (líně, jednou na scénu). */
function ensureBuf(s: BoxScene): Buf {
  if (s.buf) return s.buf;
  const cell = s.cell;
  const gw = Math.max(1, Math.ceil(s.W / cell)), gh = Math.max(1, Math.ceil(s.H / cell));
  const depth = new Float32Array(gw * gh).fill(Infinity);
  const win = new Int32Array(gw * gh).fill(-1);
  for (const p of s.items) {
    if (!p.occluder) continue;
    const { x: X, y: Y, d: D, iw: IW, cd: CD, ok: OK } = p.v;
    const T = p.it.triangles;
    for (let t = 0; t < p.nt; t++) {
      const a = T[t * 3], b = T[t * 3 + 1], c = T[t * 3 + 2];
      if (!OK[a] || !OK[b] || !OK[c]) continue;
      if (CD && CD[a] < 0 && CD[b] < 0 && CD[c] < 0) continue;
      const x0 = X[a], y0 = Y[a], x1 = X[b], y1 = Y[b], x2 = X[c], y2 = Y[c];
      const A = (x1 - x0) * (y2 - y0) - (x2 - x0) * (y1 - y0);
      if (!(A > 1e-9 || A < -1e-9)) continue;
      if (s.cull && (A < 0) === p.flip) continue;
      const minY = Math.min(y0, y1, y2), maxY = Math.max(y0, y1, y2);
      if (maxY < 0 || minY > s.H || Math.max(x0, x1, x2) < 0 || Math.min(x0, x1, x2) > s.W) continue;
      const cy0 = Math.max(0, Math.ceil(minY / cell - 0.5)), cy1 = Math.min(gh - 1, Math.floor(maxY / cell - 0.5));
      if (cy1 < cy0) continue;
      const inv = 1 / A;
      // perspektivně správně: 1/w, d/w a cd/w jsou na plátně lineární
      const w0 = IW[a], w1 = IW[b], w2 = IW[c];
      const q0 = D[a] * w0, q1 = D[b] * w1, q2 = D[c] * w2;
      const k0 = CD ? CD[a] * w0 : 0, k1 = CD ? CD[b] * w1 : 0, k2 = CD ? CD[c] * w2 : 0;
      const gid = p.triBase + t;
      for (let cy = cy0; cy <= cy1; cy++) {
        const yc = (cy + 0.5) * cell;
        // rozsah x řádku: průsečíky stran s vodorovnou přímkou yc
        let xl = Infinity, xr = -Infinity;
        for (let e = 0; e < 3; e++) {
          const ax = e === 0 ? x0 : e === 1 ? x1 : x2, ay = e === 0 ? y0 : e === 1 ? y1 : y2;
          const bx = e === 0 ? x1 : e === 1 ? x2 : x0, by = e === 0 ? y1 : e === 1 ? y2 : y0;
          if ((ay <= yc && by >= yc) || (by <= yc && ay >= yc)) {
            if (ay === by) {
              xl = Math.min(xl, ax, bx);
              xr = Math.max(xr, ax, bx);
            } else {
              const xi = ax + ((yc - ay) * (bx - ax)) / (by - ay);
              if (xi < xl) xl = xi;
              if (xi > xr) xr = xi;
            }
          }
        }
        if (!(xl <= xr)) continue;
        const cx0 = Math.max(0, Math.ceil(xl / cell - 0.5)), cx1 = Math.min(gw - 1, Math.floor(xr / cell - 0.5));
        for (let cx = cx0; cx <= cx1; cx++) {
          const xc = (cx + 0.5) * cell;
          const l0 = ((x1 - xc) * (y2 - yc) - (x2 - xc) * (y1 - yc)) * inv;
          const l1 = ((x2 - xc) * (y0 - yc) - (x0 - xc) * (y2 - yc)) * inv;
          const l2 = 1 - l0 - l1;
          const B = l0 * w0 + l1 * w1 + l2 * w2;
          if (!(B > 0)) continue;
          if (CD && (l0 * k0 + l1 * k1 + l2 * k2) / B < 0) continue;
          const z = (l0 * q0 + l1 * q1 + l2 * q2) / B;
          const i = cy * gw + cx;
          if (z < depth[i]) {
            depth[i] = z;
            win[i] = gid;
          }
        }
      }
    }
  }
  s.buf = { cell, gw, gh, depth, win, itemWin: null };
  return s.buf;
}

/** Hloubka trojúhelníku (globální číslo) v bodě plátna a zda bod pokrývá s okrajem m px; null = nepokrývá. */
function triDepthAt(s: BoxScene, gid: number, x: number, y: number, m: number): number | null {
  const k = itemOfTri(s, gid);
  const p = s.items[k];
  const t = gid - p.triBase;
  const T = p.it.triangles;
  const a = T[t * 3], b = T[t * 3 + 1], c = T[t * 3 + 2];
  const { x: X, y: Y } = p.v;
  const x0 = X[a], y0 = Y[a], x1 = X[b], y1 = Y[b], x2 = X[c], y2 = Y[c];
  const A = (x1 - x0) * (y2 - y0) - (x2 - x0) * (y1 - y0);
  if (!(A > 1e-12 || A < -1e-12)) return null;
  const sg = A > 0 ? 1 : -1;
  const e0 = ((x1 - x) * (y2 - y) - (x2 - x) * (y1 - y)) * sg;
  const e1 = ((x2 - x) * (y0 - y) - (x0 - x) * (y2 - y)) * sg;
  const e2 = ((x0 - x) * (y1 - y) - (x1 - x) * (y0 - y)) * sg;
  // vzdálenost bodu od přímky strany = |e| / délka strany (e < 0 = vně)
  if (e0 < 0 && -e0 > m * Math.hypot(x2 - x1, y2 - y1)) return null;
  if (e1 < 0 && -e1 > m * Math.hypot(x0 - x2, y0 - y2)) return null;
  if (e2 < 0 && -e2 > m * Math.hypot(x1 - x0, y1 - y0)) return null;
  const inv = 1 / (A * sg);
  const l0 = e0 * inv, l1 = e1 * inv, l2 = e2 * inv;
  const { d: D, iw: IW } = p.v;
  const B = l0 * IW[a] + l1 * IW[b] + l2 * IW[c];
  if (!(B > 0)) return null;
  return (l0 * D[a] * IW[a] + l1 * D[b] * IW[b] + l2 * D[c] * IW[c]) / B;
}

/** Trojúhelník (globální číslo) je na plátně odvrácený (při řezu = víčko řezu: díváme se do tělesa)? */
function backTri(s: BoxScene, gid: number): boolean {
  const p = s.items[itemOfTri(s, gid)];
  const t = gid - p.triBase;
  const T = p.it.triangles, X = p.v.x, Y = p.v.y;
  const a = T[t * 3], b = T[t * 3 + 1], c = T[t * 3 + 2];
  const A = (X[b] - X[a]) * (Y[c] - Y[a]) - (X[c] - X[a]) * (Y[b] - Y[a]);
  return (A < 0) === p.flip;
}

/** Hloubka roviny řezu na paprsku bodu plátna (x, y); null = paprsek rovnoběžný s rovinou nebo rovina za kamerou. */
export function capDepthAt(s: BoxScene, x: number, y: number): number | null {
  const k = s.cap;
  if (!k) return null;
  const nx = (2 * x) / s.W - 1, ny = 1 - (2 * y) / s.H;
  if (s.persp) {
    // q = d · ((nx + p8) / p0, (ny + p9) / p5, −1) → n·q + c = 0
    const den = (k.nx * (nx + k.p8)) / k.p0 + (k.ny * (ny + k.p9)) / k.p5 - k.nz;
    if (Math.abs(den) < 1e-12) return null;
    const d = -k.c / den;
    return d > 0 ? d : null;
  }
  // pravoúhle: q = ((nx − p12) / p0, (ny − p13) / p5, −d)
  if (Math.abs(k.nz) < 1e-12) return null;
  return (k.nx * ((nx - k.p12) / k.p0) + k.ny * ((ny - k.p13) / k.p5) + k.c) / k.nz;
}

/** Je bod plátna (x, y) v hloubce d vidět? (zakrytí jen trojúhelníky, které vyhrály buňku v okolí 3 × 3; s řezem i víčkem) */
function pointVisible(s: BoxScene, x: number, y: number, d: number): boolean {
  if (!s.occlude) return true;
  const B = ensureBuf(s);
  const cx = Math.floor(x / B.cell), cy = Math.floor(y / B.cell);
  const tol = tolAt(s, d);
  const lim = d - tol;
  let g0 = -2, g1 = -2, g2 = -2;
  // řez: nejbližší trojúhelník pokrývající bod a zda bodem prochází přivrácená plocha
  let near = Infinity, nearG = -1, front = false;
  for (let dy = -1; dy <= 1; dy++) {
    const yy = cy + dy;
    if (yy < 0 || yy >= B.gh) continue;
    for (let dx = -1; dx <= 1; dx++) {
      const xx = cx + dx;
      if (xx < 0 || xx >= B.gw) continue;
      const g = B.win[yy * B.gw + xx];
      if (g < 0 || g === g0 || g === g1 || g === g2) continue;
      g2 = g1;
      g1 = g0;
      g0 = g;
      const z = triDepthAt(s, g, x, y, 0.5);
      if (z === null) continue;
      if (z < lim) return false;
      if (!s.cap) continue;
      if (z < near) {
        near = z;
        nearG = g;
      }
      if (z <= d + tol && !backTri(s, g)) front = true;
    }
  }
  // víčko řezu: bod uvnitř tělesa za rovinou řezu (nejbližší je odvrácená stěna, bod neleží na přivrácené ploše)
  if (s.cap && nearG >= 0 && !front && backTri(s, nearG)) {
    const dp = capDepthAt(s, x, y);
    if (dp !== null && dp < lim) return false;
  }
  return true;
}

/** perspektivně správná interpolace hloubky (a vzdálenosti od řezu) na úsečce mezi body a, b promítnutých bodů P */
function lerpD(P: Pts, a: number, b: number, t: number): number {
  const wa = P.iw[a] * (1 - t), wb = P.iw[b] * t;
  return (P.d[a] * wa + P.d[b] * wb) / (wa + wb);
}
function lerpC(P: Pts, a: number, b: number, t: number): number {
  if (!P.cd) return 1;
  const wa = P.iw[a] * (1 - t), wb = P.iw[b] * t;
  return (P.cd[a] * wa + P.cd[b] * wb) / (wa + wb);
}

/**
 * Viditelné vzorky hrany (v obdélníku `r`, nebo kdekoli); vrátí true, je-li vidět aspoň `need` vzorků. Vzorky blíž než
 * `skip` px ke koncům hrany se vynechají (koncový bod skryté hrany bývá viditelný vrchol); krátká hrana = jen střed.
 */
function edgeVisible(s: BoxScene, p: Proj, e: EdgeRec, r: BoxRect | null): boolean {
  const L = p.l;
  let total = 0;
  for (let k = e.s0; k < e.s1; k++) {
    const a = 2 * k, b = a + 1;
    if (L.ok[a] && L.ok[b]) total += Math.hypot(L.x[b] - L.x[a], L.y[b] - L.y[a]);
  }
  const step = Math.max(1.5, s.cell);
  const skip = Math.max(3, s.cell + 1.5, total * 0.08);
  // krátká hrana: jediný vzorek – střed hrany, a nezasahuje-li střed do obdélníku, střed části v obdélníku
  const short = total < 2 * skip + step;
  const mid = total / 2;
  let alt: [number, number, number] | null = null;
  let cum = 0;
  let seen = 0, tried = 0;
  for (let k = e.s0; k < e.s1; k++) {
    const a = 2 * k, b = a + 1;
    if (!L.ok[a] || !L.ok[b]) continue;
    const ax = L.x[a], ay = L.y[a], bx = L.x[b], by = L.y[b];
    const len = Math.hypot(bx - ax, by - ay);
    const c0 = cum;
    cum += len;
    let t0 = 0, t1 = 1;
    if (r) {
      const tt = segRect(ax, ay, bx, by, r);
      if (!tt) continue;
      [t0, t1] = tt;
    }
    if (short) {
      const tm = len > 1e-9 ? (mid - c0) / len : 0.5;
      const t = mid >= c0 && mid <= cum && tm >= t0 - 1e-9 && tm <= t1 + 1e-9 ? tm : (t0 + t1) / 2;
      if (lerpC(L, a, b, t) < 0) continue;
      const cand: [number, number, number] = [ax + (bx - ax) * t, ay + (by - ay) * t, lerpD(L, a, b, t)];
      if (t === tm) return pointVisible(s, cand[0], cand[1], cand[2]);
      alt ??= cand;
      continue;
    }
    const n = Math.max(1, Math.ceil((len * (t1 - t0)) / step));
    for (let i = 0; i < n; i++) {
      const t = t0 + ((i + 0.5) * (t1 - t0)) / n;
      const at = c0 + t * len;
      if (at < skip || at > total - skip) {
        // obdélník zasahuje jen konec hrany: náhradní vzorek (použije se, nebude-li žádný jiný)
        if (r && !alt && lerpC(L, a, b, t) >= 0) alt = [ax + (bx - ax) * t, ay + (by - ay) * t, lerpD(L, a, b, t)];
        continue;
      }
      if (lerpC(L, a, b, t) < 0) continue;
      tried++;
      if (pointVisible(s, ax + (bx - ax) * t, ay + (by - ay) * t, lerpD(L, a, b, t)) && ++seen >= 2) return true;
    }
  }
  if (short || (r && !tried)) return !!alt && pointVisible(s, alt[0], alt[1], alt[2]);
  // jediný viditelný vzorek stačí, je-li vzorků málo (krátká nebo obdélníkem oříznutá hrana), jinak dva
  return seen >= (tried >= 6 ? 2 : 1);
}

/** Hrana zasahuje do obdélníku (bez ohledu na zakrytí)? */
function edgeTouches(p: Proj, e: EdgeRec, r: BoxRect): boolean {
  const L = p.l;
  for (let k = e.s0; k < e.s1; k++) {
    const a = 2 * k, b = a + 1;
    if (!L.ok[a] || !L.ok[b]) continue;
    if (L.cd && L.cd[a] < 0 && L.cd[b] < 0) continue;
    if (segRect(L.x[a], L.y[a], L.x[b], L.y[b], r)) return true;
  }
  return false;
}

/** Trojúhelníky plochy (nebo celé sítě) – rozsahy [a, b) po dvojicích. */
const allRange = (p: Proj) => [0, p.nt];

/** Některý trojúhelník rozsahů zasahuje do obdélníku? */
function trisTouch(p: Proj, ranges: number[], r: BoxRect): boolean {
  const { x: X, y: Y, ok: OK, cd: CD } = p.v;
  const T = p.it.triangles;
  for (let k = 0; k < ranges.length; k += 2)
    for (let t = ranges[k]; t < ranges[k + 1]; t++) {
      const a = T[t * 3], b = T[t * 3 + 1], c = T[t * 3 + 2];
      if (!OK[a] || !OK[b] || !OK[c]) continue;
      if (CD && CD[a] < 0 && CD[b] < 0 && CD[c] < 0) continue;
      if (triRect(X[a], Y[a], X[b], Y[b], X[c], Y[c], r)) return true;
    }
  return false;
}

/** Těžiště některého trojúhelníku (v obdélníku `r`, je-li zadán) je vidět? Nejvýš `max` vzorků rovnoměrně. */
function centroidVisible(s: BoxScene, p: Proj, ranges: number[], r: BoxRect | null, max: number): boolean {
  const { x: X, y: Y, d: D, iw: IW, ok: OK, cd: CD } = p.v;
  const T = p.it.triangles;
  let count = 0;
  for (let k = 0; k < ranges.length; k += 2) count += ranges[k + 1] - ranges[k];
  const stride = Math.max(1, Math.floor(count / max));
  let idx = 0;
  for (let k = 0; k < ranges.length; k += 2)
    for (let t = ranges[k]; t < ranges[k + 1]; t++, idx++) {
      if (idx % stride) continue;
      const a = T[t * 3], b = T[t * 3 + 1], c = T[t * 3 + 2];
      if (!OK[a] || !OK[b] || !OK[c]) continue;
      const x = (X[a] + X[b] + X[c]) / 3, y = (Y[a] + Y[b] + Y[c]) / 3;
      if (r && (x < r.x0 || x > r.x1 || y < r.y0 || y > r.y1)) continue;
      const B = (IW[a] + IW[b] + IW[c]) / 3;
      if (CD && (CD[a] * IW[a] + CD[b] * IW[b] + CD[c] * IW[c]) / 3 / B < 0) continue;
      const d = (D[a] * IW[a] + D[b] * IW[b] + D[c] * IW[c]) / 3 / B;
      if (pointVisible(s, x, y, d)) return true;
    }
  return false;
}

/** vítězné trojúhelníky buněk se středem v obdélníku (nebo celého plátna): viditelné plochy (ne plochy řezu) a tělesa */
function winners(s: BoxScene, r: BoxRect | null, wantFaces: boolean): { faces: Set<number>[]; items: Uint8Array } {
  const B = ensureBuf(s);
  const faces = s.items.map(() => new Set<number>());
  const items = new Uint8Array(s.items.length);
  if (!s.stamp || s.stamp.length < s.totalTris) s.stamp = new Int32Array(s.totalTris);
  const stamp = ++s.stampN;
  const cx0 = r ? Math.max(0, Math.ceil(r.x0 / B.cell - 0.5)) : 0, cx1 = r ? Math.min(B.gw - 1, Math.floor(r.x1 / B.cell - 0.5)) : B.gw - 1;
  const cy0 = r ? Math.max(0, Math.ceil(r.y0 / B.cell - 0.5)) : 0, cy1 = r ? Math.min(B.gh - 1, Math.floor(r.y1 / B.cell - 0.5)) : B.gh - 1;
  for (let cy = cy0; cy <= cy1; cy++)
    for (let cx = cx0; cx <= cx1; cx++) {
      const g = B.win[cy * B.gw + cx];
      if (g < 0 || s.stamp[g] === stamp) continue;
      s.stamp[g] = stamp;
      const k = itemOfTri(s, g);
      items[k] = 1;
      if (!wantFaces) continue;
      const p = s.items[k];
      const t = g - p.triBase;
      const f = p.faceOf ? p.faceOf[t] : -1;
      if (f < 0) continue;
      if (s.clip) {
        // odvrácená stěna s řezem = plocha řezu (vnitřek tělesa) – zakrývá, ale nevybírá se
        const T = p.it.triangles, X = p.v.x, Y = p.v.y;
        const a = T[t * 3], b = T[t * 3 + 1], c = T[t * 3 + 2];
        const A = (X[b] - X[a]) * (Y[c] - Y[a]) - (X[c] - X[a]) * (Y[b] - Y[a]);
        if ((A < 0) === p.flip) continue;
      }
      faces[k].add(f);
    }
  return { faces, items };
}

/**
 * Výběr oknem (`crossing` false) nebo křížením (true) v obdélníku `rect` (CSS px plátna). `kinds` říká, co hledat
 * (plochy, hrany, vrcholy, celá tělesa / komponenty). Výsledek je seřazený podle sítě a čísla entity.
 */
export function boxSelect(s: BoxScene, q: BoxQuery): BoxHits {
  const t0 = nowMs();
  const r = normRect(q.rect);
  const out: BoxHits = { faces: [], edges: [], vertices: [], items: [], ms: 0 };
  const occ = s.occlude;
  const needWin = occ && (q.kinds.faces || q.kinds.items);
  // okno: celá entita uvnitř → všechny její vítězné buňky jsou uvnitř obdélníku; stačí buňky obdélníku
  const W = needWin ? winners(s, r, !!q.kinds.faces) : null;
  const small = 4 * s.cell * s.cell;
  s.items.forEach((p, k) => {
    // průhledná / potlačená síť v bufferu není: její viditelnost jen bodovými testy (bez ohledu na velikost)
    const big = p.occluder ? 1 : Infinity;
    if (q.kinds.items) {
      let hit = false;
      if (!q.crossing) {
        if (boxInside(p.box, r)) hit = !occ || !!W!.items[k] || (p.area < small * 4 * big && centroidVisible(s, p, allRange(p), null, 256));
      } else if (boxOverlap(p.box, r)) {
        hit = occ ? !!W!.items[k] || (p.area < small * 16 * big && centroidVisible(s, p, allRange(p), r, 256)) : trisTouch(p, allRange(p), r);
      }
      if (hit) out.items.push(k);
    }
    if (q.kinds.faces) {
      for (const f of p.faces) {
        let hit = false;
        if (!q.crossing) {
          if (boxInside(f.box, r)) hit = !occ || W!.faces[k].has(f.face) || (f.area < small * big && centroidVisible(s, p, f.ranges, null, 48));
        } else if (boxOverlap(f.box, r)) {
          hit = occ ? W!.faces[k].has(f.face) || (f.area < small * 4 * big && trisTouch(p, f.ranges, r) && centroidVisible(s, p, f.ranges, r, 48)) : trisTouch(p, f.ranges, r);
        }
        if (hit) out.faces.push({ item: k, face: f.face });
      }
      out.faces.sort((a, b) => a.item - b.item || a.face - b.face);
    }
    if (q.kinds.edges) {
      const seen = new Set<number>();
      for (const e of p.edges) {
        if (seen.has(e.edge)) continue;
        let hit = false;
        if (!q.crossing) {
          if (boxInside(e.box, r)) hit = !occ || edgeVisible(s, p, e, null);
        } else if (boxOverlap(e.box, r) && edgeTouches(p, e, r)) {
          hit = !occ || edgeVisible(s, p, e, r);
        }
        if (hit) {
          seen.add(e.edge);
          out.edges.push({ item: k, edge: e.edge });
        }
      }
    }
    if (q.kinds.vertices) {
      const P = p.p;
      for (let i = 0; i < P.n; i++) {
        if (!P.ok[i] || (P.cd && P.cd[i] < 0)) continue;
        const x = P.x[i], y = P.y[i];
        if (x < r.x0 || x > r.x1 || y < r.y0 || y > r.y1) continue;
        if (occ && !pointVisible(s, x, y, P.d[i])) continue;
        out.vertices.push({ item: k, index: i, point: [p.pw[i * 3], p.pw[i * 3 + 1], p.pw[i * 3 + 2]] });
      }
    }
  });
  out.edges.sort((a, b) => a.item - b.item || a.edge - b.edge);
  out.ms = nowMs() - t0;
  return out;
}

/**
 * Pravoúhlá kamera náhledu bez WebGL (`soft-render`: střed, měřítko px/mm, báze right / up / dir, `dir` míří ke
 * kameře) jako matice `view` a `proj` pro `prepareBox`.
 */
export function orthoBoxCamera(c: { right: Vec3; up: Vec3; dir: Vec3; center: Vec3; scale: number }, width: number, height: number): BoxCamera {
  const { right: R, up: U, dir: D, center: C } = c;
  const dot = (a: Vec3) => a[0] * C[0] + a[1] * C[1] + a[2] * C[2];
  const view = [R[0], U[0], D[0], 0, R[1], U[1], D[1], 0, R[2], U[2], D[2], 0, -dot(R), -dot(U), -dot(D), 1];
  const s = c.scale > 0 && Number.isFinite(c.scale) ? c.scale : 1;
  const proj = [(2 * s) / Math.max(1, width), 0, 0, 0, 0, (2 * s) / Math.max(1, height), 0, 0, 0, 0, -1e-6, 0, 0, 0, 0, 1];
  return { width, height, view, proj };
}
