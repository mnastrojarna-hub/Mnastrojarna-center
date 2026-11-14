/**
 * Výběr kliknutím v softwarovém náhledu (bez WebGL). Čistá logika nad promítnutými sítěmi (běží i v testech bez
 * prohlížeče) se stejným pravoúhlým promítáním jako `softRender`:
 * – plocha = nejbližší trojúhelník pod kurzorem (hloubkový test, řez rovinou, odvrácené stěny jako ve vykreslení),
 * – hrana = nejbližší promítnutá úsečka hrany do ~6 px, která není zakrytá plochou (při shodě vzdálenosti vyhrává
 *   hrana blíž ke kameře),
 * – vrchol = topologický vrchol tělesa do ~7 px, který není zakrytý.
 * Čísla ploch a hran jsou shodná se 3D oknem (skupiny `faceGroups` / `edgeGroups` sítě z jádra), u sestavy s id
 * komponenty (`compId`, `topId`); bod kliknutí je ve světových souřadnicích (po umístění komponenty).
 *
 * Rychlost: promítnutí vrcholů a rozdělení trojúhelníků, úseček hran i vrcholů do hrubé mřížky buněk se počítá jednou
 * na snímek (`buildPickIndex`); trojúhelník patří jen do buněk, které skutečně protíná (ne do celého ohraničení – dlouhé
 * úzké trojúhelníky rovinných ploch s mnoha dírami by jinak zaplnily celé řádky buněk). Dotaz pod kurzorem pak
 * prochází jen trojúhelníky, úsečky a vrcholy své buňky.
 */
import { tr } from "./i18n";
import { affine, type SoftCamera, type SoftClip, type SoftItem } from "./soft-render";
import type { Vec3 } from "./types";

/** Síť k výběru: síť náhledu + čísla hran, topologické vrcholy a id komponenty sestavy. */
export type PickItem = SoftItem & {
  /** [start, count, edgeIndex] po trojicích (start/count v bodech `lines`) */
  edgeGroups?: Int32Array | null;
  /** topologické vrcholy tělesa (x, y, z po trojicích) – výběr bodů */
  points?: Float32Array | null;
  /** listová komponenta sestavy (u podsestav cesta „a/b“) */
  compId?: string;
  /** komponenta nejvyšší úrovně */
  topId?: string;
};

/** Filtr výběru (shodný se `SelFilter` 3D okna). */
export type PickFilter = "all" | "feature" | "face" | "edge" | "vertex" | "body" | "component" | "subasm";
export type SnapAt = "start" | "end" | "mid" | "center";

/** Vybraná entita – stejný tvar jako `SelItem` 3D okna. */
export type SoftPick =
  | { kind: "face"; index: number; compId?: string; topId?: string; point: Vec3 }
  | { kind: "edge"; index: number; compId?: string; topId?: string; point: Vec3; at?: SnapAt }
  | { kind: "vertex"; index: number; compId?: string; topId?: string; point: Vec3 }
  | { kind: "body"; compId?: string; topId?: string; point: Vec3 }
  | { kind: "component"; compId: string; topId?: string; point: Vec3 };

/** Pohled: velikost plátna (CSS px), kamera (měřítko v px/mm téhož prostoru), řez a vynechání odvrácených stěn. */
export type PickView = {
  width: number;
  height: number;
  camera: SoftCamera;
  clip?: SoftClip | null;
  /** vynechat odvrácené stěny (výchozí: bez řezu ano – jako vykreslení stínovaného náhledu) */
  cull?: boolean;
  /** plochy zakrývají hrany a vrcholy (výchozí ano; drátový model ne – kreslí se všechny hrany) */
  occlude?: boolean;
};

type Proj = {
  it: PickItem;
  /** lineární část a posun matice umístění */
  a: number[];
  /** zrcadlení (záporný determinant) – obrací orientaci trojúhelníků */
  flip: boolean;
  sx: Float32Array;
  sy: Float32Array;
  sz: Float32Array;
  /** vzdálenost vrcholů od roviny řezu (jen s řezem) */
  cd: Float32Array | null;
  /** číslo plochy podle trojúhelníku (−1 = mimo plochy) */
  faceOf: Int32Array | null;
  /** číslo hrany podle úsečky (−1 = mimo hrany) */
  segEdge: Int32Array | null;
  /** promítnuté body úseček hran */
  lx: Float32Array;
  ly: Float32Array;
  lz: Float32Array;
  /** promítnuté topologické vrcholy */
  px: Float32Array;
  py: Float32Array;
  pz: Float32Array;
  triBase: number;
  segBase: number;
  ptBase: number;
};

/** Předpočítaná data snímku pro dotazy pod kurzorem. */
export type SoftPickIndex = {
  view: PickView;
  W: number;
  H: number;
  s: number;
  hx: number;
  hy: number;
  cull: boolean;
  clip: SoftClip | null;
  items: Proj[];
  cell: number;
  gw: number;
  gh: number;
  triCell: Int32Array;
  triIds: Int32Array;
  segCell: Int32Array;
  segIds: Int32Array;
  ptCell: Int32Array;
  ptIds: Int32Array;
  segStamp: Int32Array;
  stamp: number;
  /** poloměr scény (mm) – tolerance hloubky */
  radius: number;
  /** tolerance hloubkového testu hran a vrcholů (mm) */
  depthTol: number;
  asm: boolean;
  /** doba sestavení (ms) */
  ms: number;
};

export const EDGE_TOL_PX = 6;
export const VERTEX_TOL_PX = 7;
export const SNAP_TOL_PX = 12;

const nowMs = () => (typeof performance !== "undefined" ? performance.now() : Date.now());

const faceOfCache = new WeakMap<Int32Array, Int32Array>();
/** číslo plochy pro každý trojúhelník (stejně jako `faceOfFrom` 3D okna) */
function faceOfTris(fg: Int32Array | null | undefined, nt: number): Int32Array | null {
  if (!fg || fg.length < 3) return null;
  const hit = faceOfCache.get(fg);
  if (hit && hit.length === nt) return hit;
  const out = new Int32Array(nt).fill(-1);
  for (let i = 0; i + 2 < fg.length; i += 3) for (let t = Math.floor(fg[i] / 3), e = Math.min(nt, Math.floor((fg[i] + fg[i + 1]) / 3)); t < e; t++) out[t] = fg[i + 2];
  faceOfCache.set(fg, out);
  return out;
}
const edgeOfCache = new WeakMap<Int32Array, Int32Array>();
/** číslo hrany pro každou úsečku (stejně jako `edgeOfFrom` 3D okna) */
function edgeOfSegs(eg: Int32Array | null | undefined, ns: number): Int32Array | null {
  if (!eg || eg.length < 3) return null;
  const hit = edgeOfCache.get(eg);
  if (hit && hit.length === ns) return hit;
  const out = new Int32Array(ns).fill(-1);
  for (let i = 0; i + 2 < eg.length; i += 3) for (let k = Math.floor(eg[i] / 2), e = Math.min(ns, Math.floor((eg[i] + eg[i + 1]) / 2)); k < e; k++) out[k] = eg[i + 2];
  edgeOfCache.set(eg, out);
  return out;
}

/** Předpočítá promítnutí a mřížku buněk pro dotazy pod kurzorem (jednou na snímek). */
export function buildPickIndex(items: PickItem[], view: PickView): SoftPickIndex {
  const t0 = nowMs();
  const W = Math.max(1, view.width);
  const H = Math.max(1, view.height);
  const cam = view.camera;
  const R = cam.right, U = cam.up, D = cam.dir, C = cam.center;
  const s = cam.scale > 0 && Number.isFinite(cam.scale) ? cam.scale : 1;
  const hx = W / 2, hy = H / 2;
  const clip = view.clip ?? null;
  const cull = view.cull ?? !clip;
  let triBase = 0;
  let segBase = 0;
  let ptBase = 0;
  let x0b = Infinity, x1b = -Infinity, y0b = Infinity, y1b = -Infinity, z0b = Infinity, z1b = -Infinity;
  const proj: Proj[] = items.map((it) => {
    const a = affine(it.matrix);
    const det = a[0] * (a[4] * a[8] - a[5] * a[7]) - a[1] * (a[3] * a[8] - a[5] * a[6]) + a[2] * (a[3] * a[7] - a[4] * a[6]);
    const tx = a[9] - C[0], ty = a[10] - C[1], tz = a[11] - C[2];
    const ax0 = s * (R[0] * a[0] + R[1] * a[3] + R[2] * a[6]), ax1 = s * (R[0] * a[1] + R[1] * a[4] + R[2] * a[7]), ax2 = s * (R[0] * a[2] + R[1] * a[5] + R[2] * a[8]), bx = hx + s * (R[0] * tx + R[1] * ty + R[2] * tz);
    const ay0 = -s * (U[0] * a[0] + U[1] * a[3] + U[2] * a[6]), ay1 = -s * (U[0] * a[1] + U[1] * a[4] + U[2] * a[7]), ay2 = -s * (U[0] * a[2] + U[1] * a[5] + U[2] * a[8]), by = hy - s * (U[0] * tx + U[1] * ty + U[2] * tz);
    const az0 = D[0] * a[0] + D[1] * a[3] + D[2] * a[6], az1 = D[0] * a[1] + D[1] * a[4] + D[2] * a[7], az2 = D[0] * a[2] + D[1] * a[5] + D[2] * a[8], bz = D[0] * tx + D[1] * ty + D[2] * tz;
    const run = (V: Float32Array | null | undefined): [Float32Array, Float32Array, Float32Array] => {
      const n = V ? Math.floor(V.length / 3) : 0;
      const X = new Float32Array(n), Y = new Float32Array(n), Z = new Float32Array(n);
      for (let i = 0, j = 0; i < n; i++, j += 3) {
        const x = V![j], y = V![j + 1], z = V![j + 2];
        X[i] = ax0 * x + ax1 * y + ax2 * z + bx;
        Y[i] = ay0 * x + ay1 * y + ay2 * z + by;
        Z[i] = az0 * x + az1 * y + az2 * z + bz;
      }
      return [X, Y, Z];
    };
    const [sx, sy, sz] = run(it.vertices);
    for (let i = 0; i < sx.length; i++) {
      if (sx[i] < x0b) x0b = sx[i];
      if (sx[i] > x1b) x1b = sx[i];
      if (sy[i] < y0b) y0b = sy[i];
      if (sy[i] > y1b) y1b = sy[i];
      if (sz[i] < z0b) z0b = sz[i];
      if (sz[i] > z1b) z1b = sz[i];
    }
    const [lx, ly, lz] = run(it.lines);
    const [px, py, pz] = run(it.points);
    let cd: Float32Array | null = null;
    if (clip) {
      const N = clip.normal;
      const c0 = N[0] * a[0] + N[1] * a[3] + N[2] * a[6], c1 = N[0] * a[1] + N[1] * a[4] + N[2] * a[7], c2 = N[0] * a[2] + N[1] * a[5] + N[2] * a[8], c3 = N[0] * a[9] + N[1] * a[10] + N[2] * a[11] + clip.constant;
      const V = it.vertices;
      cd = new Float32Array(sx.length);
      for (let i = 0, j = 0; i < cd.length; i++, j += 3) cd[i] = c0 * V[j] + c1 * V[j + 1] + c2 * V[j + 2] + c3;
    }
    const nt = Math.floor(it.triangles.length / 3);
    const ns = Math.floor(lx.length / 2);
    const p: Proj = { it, a, flip: det < 0, sx, sy, sz, cd, faceOf: faceOfTris(it.faceGroups, nt), segEdge: edgeOfSegs(it.edgeGroups, ns), lx, ly, lz, px, py, pz, triBase, segBase, ptBase };
    triBase += nt;
    segBase += ns;
    ptBase += px.length;
    return p;
  });
  const radius = Number.isFinite(x1b) ? Math.max(1e-6, Math.hypot((x1b - x0b) / s, (y1b - y0b) / s, z1b - z0b) / 2) : 1;
  // velikost buňky: řádově jednotky trojúhelníků na buňku, 6–48 px
  const cell = Math.max(6, Math.min(48, Math.round(Math.sqrt((W * H * 4) / Math.max(1, triBase)))));
  let gw = Math.max(1, Math.ceil(W / cell));
  let gh = Math.max(1, Math.ceil(H / cell));
  let cellSize = cell;

  /** buňky jednoho řádku mřížky (cy), které položka pokrývá: sloupce cx0…cx1 */
  type Cover = (gid: number, cy: number, cx0: number, cx1: number) => void;
  /** rozdělí položky (trojúhelníky / úsečky / body) do buněk – dva průchody (počet, plnění) */
  const bucket = (forEach: (cover: Cover) => void, total: number): [Int32Array, Int32Array] => {
    for (let attempt = 0; ; attempt++) {
      const counts = new Int32Array(gw * gh + 1);
      let entries = 0;
      forEach((_gid, cy, cx0, cx1) => {
        const row = cy * gw + 1;
        for (let cx = cx0; cx <= cx1; cx++) counts[row + cx]++;
        entries += cx1 - cx0 + 1;
      });
      // velmi mnoho velkých trojúhelníků (přiblížená velká síť): hrubší mřížka
      if (entries > 12_000_000 && attempt < 4 && total > 0) {
        cellSize *= 2;
        gw = Math.max(1, Math.ceil(W / cellSize));
        gh = Math.max(1, Math.ceil(H / cellSize));
        continue;
      }
      for (let i = 1; i < counts.length; i++) counts[i] += counts[i - 1];
      const fillAt = counts.slice(0, gw * gh);
      const ids = new Int32Array(entries);
      forEach((gid, cy, cx0, cx1) => {
        const row = cy * gw;
        for (let cx = cx0; cx <= cx1; cx++) ids[fillAt[row + cx]++] = gid;
      });
      return [counts, ids];
    }
  };
  /** přesah buněk (px) – body přesně na hranici buňky i dotazy s malým okrajem najdou svůj trojúhelník */
  const PAD = 0.25;
  // pokrytí konvexního útvaru (trojúhelník / úsečka) po řádcích buněk: v pásu řádku je rozsah x dán ořezanými stranami
  let lo = 0, hi = 0;
  const clipEdge = (px0: number, py0: number, px1: number, py1: number, ya: number, yb: number) => {
    const ymin = py0 < py1 ? py0 : py1, ymax = py0 < py1 ? py1 : py0;
    if (ymax < ya || ymin > yb) return;
    if (py1 === py0) {
      const a0 = px0 < px1 ? px0 : px1, a1 = px0 < px1 ? px1 : px0;
      if (a0 < lo) lo = a0;
      if (a1 > hi) hi = a1;
      return;
    }
    const k = (px1 - px0) / (py1 - py0);
    const xa = px0 + k * ((ya > ymin ? ya : ymin) - py0), xb = px0 + k * ((yb < ymax ? yb : ymax) - py0);
    if (xa < lo) lo = xa;
    if (xa > hi) hi = xa;
    if (xb < lo) lo = xb;
    if (xb > hi) hi = xb;
  };
  const coverRows = (gid: number, x0: number, y0: number, x1: number, y1: number, x2: number, y2: number, tri: boolean, cover: Cover) => {
    const minY = tri ? Math.min(y0, y1, y2) : Math.min(y0, y1), maxY = tri ? Math.max(y0, y1, y2) : Math.max(y0, y1);
    const cy0 = Math.max(0, Math.floor((minY - PAD) / cellSize)), cy1 = Math.min(gh - 1, Math.floor((maxY + PAD) / cellSize));
    // malý útvar (nejvýš 2 × 2 buňky – naprostá většina trojúhelníků jemné sítě): stačí ohraničení
    const minX = tri ? Math.min(x0, x1, x2) : Math.min(x0, x1), maxX = tri ? Math.max(x0, x1, x2) : Math.max(x0, x1);
    const bx0 = Math.max(0, Math.floor((minX - PAD) / cellSize)), bx1 = Math.min(gw - 1, Math.floor((maxX + PAD) / cellSize));
    if (bx1 - bx0 <= 1 && cy1 - cy0 <= 1) {
      if (bx0 <= bx1) for (let cy = cy0; cy <= cy1; cy++) cover(gid, cy, bx0, bx1);
      return;
    }
    for (let cy = cy0; cy <= cy1; cy++) {
      const ya = cy * cellSize - PAD, yb = (cy + 1) * cellSize + PAD;
      lo = Infinity;
      hi = -Infinity;
      clipEdge(x0, y0, x1, y1, ya, yb);
      if (tri) {
        clipEdge(x1, y1, x2, y2, ya, yb);
        clipEdge(x2, y2, x0, y0, ya, yb);
      }
      if (!(lo <= hi)) continue;
      const cx0 = Math.max(0, Math.floor((lo - PAD) / cellSize)), cx1 = Math.min(gw - 1, Math.floor((hi + PAD) / cellSize));
      if (cx0 <= cx1) cover(gid, cy, cx0, cx1);
    }
  };

  const eachTri = (cover: Cover) => {
    for (const p of proj) {
      const T = p.it.triangles;
      const { sx, sy, cd } = p;
      for (let t = 0, k = 0; t + 2 < T.length; t += 3, k++) {
        const a = T[t], b = T[t + 1], c = T[t + 2];
        if (a >= sx.length || b >= sx.length || c >= sx.length) continue;
        const x0 = sx[a], y0 = sy[a], x1 = sx[b], y1 = sy[b], x2 = sx[c], y2 = sy[c];
        if ((x0 < -1 && x1 < -1 && x2 < -1) || (x0 > W + 1 && x1 > W + 1 && x2 > W + 1) || (y0 < -1 && y1 < -1 && y2 < -1) || (y0 > H + 1 && y1 > H + 1 && y2 > H + 1)) continue;
        const area = (x1 - x0) * (y2 - y0) - (x2 - x0) * (y1 - y0);
        if (!(area > 1e-12 || area < -1e-12)) continue;
        if (cull && (area < 0) === p.flip) continue;
        if (cd && cd[a] < 0 && cd[b] < 0 && cd[c] < 0) continue;
        // malý trojúhelník (nejvýš 2 × 2 buňky – naprostá většina jemné sítě): rovnou ohraničení, bez ořezu po řádcích
        const bx0 = Math.floor(((x0 < x1 ? (x0 < x2 ? x0 : x2) : x1 < x2 ? x1 : x2) - PAD) / cellSize), bx1 = Math.floor(((x0 > x1 ? (x0 > x2 ? x0 : x2) : x1 > x2 ? x1 : x2) + PAD) / cellSize);
        const by0 = Math.floor(((y0 < y1 ? (y0 < y2 ? y0 : y2) : y1 < y2 ? y1 : y2) - PAD) / cellSize), by1 = Math.floor(((y0 > y1 ? (y0 > y2 ? y0 : y2) : y1 > y2 ? y1 : y2) + PAD) / cellSize);
        if (bx1 - bx0 <= 1 && by1 - by0 <= 1) {
          const cx0 = bx0 < 0 ? 0 : bx0, cx1 = bx1 >= gw ? gw - 1 : bx1;
          if (cx0 <= cx1) for (let cy = by0 < 0 ? 0 : by0, ce = by1 >= gh ? gh - 1 : by1; cy <= ce; cy++) cover(p.triBase + k, cy, cx0, cx1);
          continue;
        }
        coverRows(p.triBase + k, x0, y0, x1, y1, x2, y2, true, cover);
      }
    }
  };
  const eachSeg = (cover: Cover) => {
    for (const p of proj) {
      const { lx, ly } = p;
      for (let k = 0; 2 * k + 1 < lx.length; k++) {
        const x0 = lx[2 * k], y0 = ly[2 * k], x1 = lx[2 * k + 1], y1 = ly[2 * k + 1];
        if (Math.max(x0, x1) < -EDGE_TOL_PX || Math.min(x0, x1) > W + EDGE_TOL_PX || Math.max(y0, y1) < -EDGE_TOL_PX || Math.min(y0, y1) > H + EDGE_TOL_PX) continue;
        if (p.segEdge && p.segEdge[k] < 0) continue;
        coverRows(p.segBase + k, x0, y0, x1, y1, 0, 0, false, cover);
      }
    }
  };
  const eachPt = (cover: Cover) => {
    for (const p of proj) {
      for (let i = 0; i < p.px.length; i++) {
        const x = p.px[i], y = p.py[i];
        if (!(x >= -VERTEX_TOL_PX && y >= -VERTEX_TOL_PX && x <= W + VERTEX_TOL_PX && y <= H + VERTEX_TOL_PX)) continue;
        const cx = Math.min(gw - 1, Math.max(0, Math.floor(x / cellSize))), cy = Math.min(gh - 1, Math.max(0, Math.floor(y / cellSize)));
        cover(p.ptBase + i, cy, cx, cx);
      }
    }
  };
  const [triCell, triIds] = bucket(eachTri, triBase);
  // úsečky a vrcholy ve stejné mřížce (velikost buňky už je ustálená)
  const [segCell, segIds] = bucket(eachSeg, 0);
  const [ptCell, ptIds] = bucket(eachPt, 0);
  return {
    view,
    W,
    H,
    s,
    hx,
    hy,
    cull,
    clip,
    items: proj,
    cell: cellSize,
    gw,
    gh,
    triCell,
    triIds,
    segCell,
    segIds,
    ptCell,
    ptIds,
    segStamp: new Int32Array(segBase),
    stamp: 0,
    radius,
    depthTol: radius * 0.003 + 1.5 / s,
    asm: items.some((it) => !!it.compId),
    ms: nowMs() - t0,
  };
}

/** položka podle globálního čísla (binární hledání v počátcích) */
function itemOf(items: Proj[], gid: number, key: "triBase" | "segBase" | "ptBase"): number {
  let lo = 0, hi = items.length - 1;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if (items[mid][key] <= gid) lo = mid;
    else hi = mid - 1;
  }
  return lo;
}

/** Bod modelu (svět) pod bodem plátna v hloubce `z`. */
export function unproject(ix: SoftPickIndex, x: number, y: number, z: number): Vec3 {
  const c = ix.view.camera;
  const r = (x - ix.hx) / ix.s, u = (ix.hy - y) / ix.s;
  return [c.center[0] + c.right[0] * r + c.up[0] * u + c.dir[0] * z, c.center[1] + c.right[1] * r + c.up[1] * u + c.dir[1] * z, c.center[2] + c.right[2] * r + c.up[2] * u + c.dir[2] * z];
}

/** Bod světa → plátno: [x, y, hloubka] (hloubka roste ke kameře). */
export function projectPoint(ix: SoftPickIndex, p: Vec3): [number, number, number] {
  const c = ix.view.camera;
  const dx = p[0] - c.center[0], dy = p[1] - c.center[1], dz = p[2] - c.center[2];
  return [ix.hx + ix.s * (c.right[0] * dx + c.right[1] * dy + c.right[2] * dz), ix.hy - ix.s * (c.up[0] * dx + c.up[1] * dy + c.up[2] * dz), c.dir[0] * dx + c.dir[1] * dy + c.dir[2] * dz];
}

const clipOk = (ix: SoftPickIndex, p: Vec3) => !ix.clip || ix.clip.normal[0] * p[0] + ix.clip.normal[1] * p[1] + ix.clip.normal[2] * p[2] + ix.clip.constant >= -1e-6 * Math.max(1, ix.radius);

/** Povrch pod bodem plátna: nejbližší (viditelný) trojúhelník. `cap` = vidět je plocha řezu (vnitřek tělesa). */
export type SurfaceHit = { item: number; tri: number; face: number; z: number; point: Vec3; front: boolean; cap: boolean };

/**
 * Nejbližší trojúhelník pod bodem (x, y) plátna; `margin` (px) zahrne i trojúhelníky těsně vedle bodu – pro test
 * zakrytí hran a vrcholů, které leží přesně na hranici trojúhelníků.
 */
export function surfaceAt(ix: SoftPickIndex, x: number, y: number, margin = 0): SurfaceHit | null {
  if (!(x >= -margin && y >= -margin && x <= ix.W + margin && y <= ix.H + margin)) return null;
  const cx = Math.min(ix.gw - 1, Math.max(0, Math.floor(x / ix.cell)));
  const cy = Math.min(ix.gh - 1, Math.max(0, Math.floor(y / ix.cell)));
  const ci = cy * ix.gw + cx;
  let best: SurfaceHit | null = null;
  let bestZ = -Infinity;
  const tie = ix.depthTol * 0.5;
  for (let e = ix.triCell[ci], end = ix.triCell[ci + 1]; e < end; e++) {
    const gid = ix.triIds[e];
    const k = itemOf(ix.items, gid, "triBase");
    const p = ix.items[k];
    const t = gid - p.triBase;
    const T = p.it.triangles;
    const a = T[t * 3], b = T[t * 3 + 1], c = T[t * 3 + 2];
    const x0 = p.sx[a], y0 = p.sy[a], x1 = p.sx[b], y1 = p.sy[b], x2 = p.sx[c], y2 = p.sy[c];
    const A = (x1 - x0) * (y2 - y0) - (x2 - x0) * (y1 - y0);
    if (!(A > 1e-12 || A < -1e-12)) continue;
    const sg = A > 0 ? 1 : -1;
    // dvojnásobné plochy podtrojúhelníků proti vrcholům a, b, c (součet = A)
    const e0 = ((x1 - x) * (y2 - y) - (x2 - x) * (y1 - y)) * sg;
    const e1 = ((x2 - x) * (y0 - y) - (x0 - x) * (y2 - y)) * sg;
    const e2 = ((x0 - x) * (y1 - y) - (x1 - x) * (y0 - y)) * sg;
    if (e0 < 0 || e1 < 0 || e2 < 0) {
      if (!(margin > 0)) continue;
      // vzdálenost od přímky protější strany = |e| / délka strany
      if (e0 < 0 && -e0 > margin * Math.hypot(x2 - x1, y2 - y1)) continue;
      if (e1 < 0 && -e1 > margin * Math.hypot(x0 - x2, y0 - y2)) continue;
      if (e2 < 0 && -e2 > margin * Math.hypot(x1 - x0, y1 - y0)) continue;
    }
    const inv = 1 / (A * sg);
    const z = (e0 * p.sz[a] + e1 * p.sz[b] + e2 * p.sz[c]) * inv;
    const front = (A < 0) !== p.flip;
    // stejná hloubka (společná hrana přivrácené a odvrácené stěny, např. spodní hrana s řezem): vyhrává přivrácená –
    // odvrácená stěna by se jinak brala jako pohled do řezu (plocha řezu) a hrana by vypadala zakrytá
    if (z <= bestZ + tie) {
      if (z < bestZ - tie) continue;
      if (best && front !== best.front ? !front : z <= bestZ) continue;
    }
    if (p.cd) {
      const d = (e0 * p.cd[a] + e1 * p.cd[b] + e2 * p.cd[c]) * inv;
      if (d < -1e-6 * Math.max(1, ix.radius)) continue;
    }
    if (ix.cull && !front) continue;
    bestZ = z;
    best = { item: k, tri: t, face: p.faceOf ? p.faceOf[t] : -1, z, point: [0, 0, 0], front, cap: !front && !!ix.clip };
  }
  if (!best) return null;
  if (best.cap && ix.clip) {
    // plocha řezu leží v rovině řezu (stejně jako ve vykreslení): hloubka roviny pod bodem
    const N = ix.clip.normal;
    const cam = ix.view.camera;
    const nd = N[0] * cam.dir[0] + N[1] * cam.dir[1] + N[2] * cam.dir[2];
    if (nd > 1e-9 || nd < -1e-9) {
      const r = (x - ix.hx) / ix.s, u = (ix.hy - y) / ix.s;
      const k0 = N[0] * cam.center[0] + N[1] * cam.center[1] + N[2] * cam.center[2] + ix.clip.constant;
      const nr = N[0] * cam.right[0] + N[1] * cam.right[1] + N[2] * cam.right[2];
      const nu = N[0] * cam.up[0] + N[1] * cam.up[1] + N[2] * cam.up[2];
      best.z = Math.max(best.z, -(k0 + nr * r + nu * u) / nd);
    }
  }
  best.point = unproject(ix, x, y, best.z);
  return best;
}

/** Je bod (x, y, z) vidět – není za povrchem pod sebou? */
function visibleAt(ix: SoftPickIndex, x: number, y: number, z: number): boolean {
  if (ix.view.occlude === false) return true;
  const sf = surfaceAt(ix, x, y, 0.05);
  return !sf || z >= sf.z - ix.depthTol;
}

export type EdgeHit = { item: number; edge: number; seg: number; dist: number; z: number; point: Vec3; x: number; y: number };

/** Nejbližší viditelná hrana do `tol` px (při téměř shodné vzdálenosti vyhrává hrana blíž ke kameře). */
export function edgeNear(ix: SoftPickIndex, x: number, y: number, tol = EDGE_TOL_PX): EdgeHit | null {
  const cx0 = Math.max(0, Math.floor((x - tol) / ix.cell)), cx1 = Math.min(ix.gw - 1, Math.floor((x + tol) / ix.cell));
  const cy0 = Math.max(0, Math.floor((y - tol) / ix.cell)), cy1 = Math.min(ix.gh - 1, Math.floor((y + tol) / ix.cell));
  if (cx0 > cx1 || cy0 > cy1) return null;
  const stamp = ++ix.stamp;
  let best: EdgeHit | null = null;
  for (let cy = cy0; cy <= cy1; cy++)
    for (let cx = cx0; cx <= cx1; cx++) {
      const ci = cy * ix.gw + cx;
      for (let e = ix.segCell[ci], end = ix.segCell[ci + 1]; e < end; e++) {
        const gid = ix.segIds[e];
        if (ix.segStamp[gid] === stamp) continue;
        ix.segStamp[gid] = stamp;
        const k = itemOf(ix.items, gid, "segBase");
        const p = ix.items[k];
        const j = gid - p.segBase;
        const edge = p.segEdge ? p.segEdge[j] : -1;
        if (edge < 0) continue;
        const ax = p.lx[2 * j], ay = p.ly[2 * j], az = p.lz[2 * j];
        const bx = p.lx[2 * j + 1], by = p.ly[2 * j + 1], bz = p.lz[2 * j + 1];
        const dx = bx - ax, dy = by - ay;
        const l2 = dx * dx + dy * dy;
        let t = l2 > 1e-12 ? ((x - ax) * dx + (y - ay) * dy) / l2 : 0;
        t = t < 0 ? 0 : t > 1 ? 1 : t;
        const ex = ax + dx * t, ey = ay + dy * t;
        const d = Math.hypot(ex - x, ey - y);
        if (d > tol) continue;
        const ez = az + (bz - az) * t;
        // lepší kandidát: zřetelně blíž kurzoru, nebo podobně blízko (±1 px) a zřetelně blíž ke kameře / stejně hluboko a blíž
        if (best && !(d < best.dist - 1 || (d <= best.dist + 1 && (ez > best.z + ix.depthTol || (Math.abs(ez - best.z) <= ix.depthTol && d < best.dist))))) continue;
        const wp = unproject(ix, ex, ey, ez);
        if (!clipOk(ix, wp)) continue;
        if (!visibleAt(ix, ex, ey, ez)) continue;
        best = { item: k, edge, seg: j, dist: d, z: ez, point: wp, x: ex, y: ey };
      }
    }
  return best;
}

export type VertexHit = { item: number; index: number; dist: number; z: number; point: Vec3; x: number; y: number };

/** Nejbližší viditelný topologický vrchol do `tol` px (při shodné vzdálenosti dřívější komponenta / vrchol). */
export function vertexNear(ix: SoftPickIndex, x: number, y: number, tol = VERTEX_TOL_PX): VertexHit | null {
  const cx0 = Math.max(0, Math.floor((x - tol) / ix.cell)), cx1 = Math.min(ix.gw - 1, Math.floor((x + tol) / ix.cell));
  const cy0 = Math.max(0, Math.floor((y - tol) / ix.cell)), cy1 = Math.min(ix.gh - 1, Math.floor((y + tol) / ix.cell));
  let best: VertexHit | null = null;
  let bestGid = -1;
  for (let cy = cy0; cy <= cy1; cy++)
    for (let cx = cx0; cx <= cx1; cx++) {
      const ci = cy * ix.gw + cx;
      for (let e = ix.ptCell[ci], end = ix.ptCell[ci + 1]; e < end; e++) {
        const gid = ix.ptIds[e];
        const k = itemOf(ix.items, gid, "ptBase");
        const p = ix.items[k];
        const i = gid - p.ptBase;
        const dx = p.px[i] - x, dy = p.py[i] - y;
        if (dx > tol || dx < -tol || dy > tol || dy < -tol) continue;
        const d = Math.hypot(dx, dy);
        if (d > tol || (best && (d > best.dist || (d === best.dist && gid > bestGid)))) continue;
        const wp = unproject(ix, p.px[i], p.py[i], p.pz[i]);
        if (!clipOk(ix, wp)) continue;
        if (!visibleAt(ix, p.px[i], p.py[i], p.pz[i])) continue;
        best = { item: k, index: i, dist: d, z: p.pz[i], point: wp, x: p.px[i], y: p.py[i] };
        bestGid = gid;
      }
    }
  return best;
}

const idsOf = (ix: SoftPickIndex, k: number): { compId?: string; topId?: string } => {
  const it = ix.items[k]?.it;
  if (!it?.compId) return {};
  return it.topId ? { compId: it.compId, topId: it.topId } : { compId: it.compId };
};

/**
 * Výběr pod kurzorem podle filtru – stejná pravidla jako 3D okno: „vše“ = vrchol, jinak hrana, jinak plocha;
 * těleso / prvek = cokoli na tělese; komponenta (podsestava) = komponenta pod kurzorem (v dílu těleso).
 * Plocha řezu (vnitřek tělesa) se nevybírá.
 */
export function pickAt(ix: SoftPickIndex, x: number, y: number, filter: PickFilter = "all"): SoftPick | null {
  const face = (): SoftPick | null => {
    const h = surfaceAt(ix, x, y);
    if (!h || h.cap || h.face < 0) return null;
    return { kind: "face", index: h.face, point: h.point, ...idsOf(ix, h.item) };
  };
  const body = (): SurfaceHit | null => {
    const h = surfaceAt(ix, x, y);
    return h && !h.cap ? h : null;
  };
  const edge = (): SoftPick | null => {
    const h = edgeNear(ix, x, y);
    return h ? { kind: "edge", index: h.edge, point: h.point, ...idsOf(ix, h.item) } : null;
  };
  const vertex = (): SoftPick | null => {
    const h = vertexNear(ix, x, y);
    return h ? { kind: "vertex", index: h.index, point: h.point, ...idsOf(ix, h.item) } : null;
  };
  switch (filter) {
    case "vertex":
      return vertex();
    case "edge":
      return edge();
    case "face":
      return face();
    case "body":
    case "feature": {
      const h = body();
      return h ? { kind: "body", point: h.point, ...idsOf(ix, h.item) } : null;
    }
    case "component":
    case "subasm": {
      const h = body();
      if (!h) return null;
      const ids = idsOf(ix, h.item);
      if (!ix.asm || !ids.compId) return { kind: "body", point: h.point };
      return { kind: "component", compId: filter === "subasm" ? (ids.topId ?? ids.compId) : ids.compId, topId: ids.topId, point: h.point };
    }
    default:
      return vertex() ?? edge() ?? face();
  }
}

/** Lomená čára hrany sítě ve světových souřadnicích (úseky hrany jdou v bufferu za sebou – jako 3D okno). */
export function itemEdgePolyline(it: PickItem, edge: number): Vec3[] {
  const L = it.lines;
  const segEdge = L ? edgeOfSegs(it.edgeGroups, Math.floor(L.length / 6)) : null;
  if (!L || !segEdge) return [];
  const a = affine(it.matrix);
  const w = (i: number): Vec3 => {
    const x = L[i * 3], y = L[i * 3 + 1], z = L[i * 3 + 2];
    return [a[0] * x + a[1] * y + a[2] * z + a[9], a[3] * x + a[4] * y + a[5] * z + a[10], a[6] * x + a[7] * y + a[8] * z + a[11]];
  };
  const pts: Vec3[] = [];
  for (let k = 0; k < segEdge.length; k++) {
    if (segEdge[k] !== edge) continue;
    if (!pts.length) pts.push(w(2 * k));
    pts.push(w(2 * k + 1));
  }
  return pts;
}

/** Lomená čára hrany dílu (bez `compId`) nebo komponenty sestavy ve světových souřadnicích. */
export function edgePolyline(ix: SoftPickIndex, edge: number, compId?: string): Vec3[] {
  const p = ix.items.find((q) => (q.it.compId ?? "") === (compId ?? ""));
  return p ? itemEdgePolyline(p.it, edge) : [];
}

const dist3 = (a: Vec3, b: Vec3) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);

/** Střed kružnice třemi body lomené čáry (null, nejsou-li všechny body na kružnici) – shodně se 3D oknem. */
export function circleOf(pts: Vec3[]): { c: Vec3; r: number } | null {
  if (pts.length < 4) return null;
  const A = pts[0], B = pts[Math.floor(pts.length / 3)], C = pts[Math.floor((2 * pts.length) / 3)];
  const a: Vec3 = [A[0] - C[0], A[1] - C[1], A[2] - C[2]];
  const b: Vec3 = [B[0] - C[0], B[1] - C[1], B[2] - C[2]];
  const axb: Vec3 = [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
  const den = 2 * (axb[0] ** 2 + axb[1] ** 2 + axb[2] ** 2);
  if (den < 1e-12) return null;
  const la = a[0] ** 2 + a[1] ** 2 + a[2] ** 2, lb = b[0] ** 2 + b[1] ** 2 + b[2] ** 2;
  const v: Vec3 = [b[0] * la - a[0] * lb, b[1] * la - a[1] * lb, b[2] * la - a[2] * lb];
  const num: Vec3 = [v[1] * axb[2] - v[2] * axb[1], v[2] * axb[0] - v[0] * axb[2], v[0] * axb[1] - v[1] * axb[0]];
  const c: Vec3 = [C[0] + num[0] / den, C[1] + num[1] / den, C[2] + num[2] / den];
  const r = dist3(c, A);
  if (!(r > 1e-6)) return null;
  const tol = r * 0.02 + 1e-6;
  return pts.every((q) => Math.abs(dist3(q, c) - r) <= tol) ? { c, r } : null;
}

/** Body k uchopení na hraně: začátek, konec (u otevřené), střed délky, střed kružnice / oblouku. */
export function edgeSnaps(ix: SoftPickIndex, edge: number, compId?: string): { at: SnapAt; point: Vec3 }[] {
  const pts = edgePolyline(ix, edge, compId);
  if (pts.length < 2) return [];
  const out: { at: SnapAt; point: Vec3 }[] = [];
  const a = pts[0], b = pts[pts.length - 1];
  if (dist3(a, b) >= 1e-6) out.push({ at: "start", point: a }, { at: "end", point: b });
  const cum = [0];
  for (let i = 1; i < pts.length; i++) cum.push(cum[i - 1] + dist3(pts[i], pts[i - 1]));
  const half = cum[cum.length - 1] / 2;
  for (let i = 1; i < pts.length; i++) {
    if (cum[i] >= half) {
      const t = cum[i] - cum[i - 1] > 1e-9 ? (half - cum[i - 1]) / (cum[i] - cum[i - 1]) : 0;
      const p = pts[i - 1], q = pts[i];
      out.push({ at: "mid", point: [p[0] + (q[0] - p[0]) * t, p[1] + (q[1] - p[1]) * t, p[2] + (q[2] - p[2]) * t] });
      break;
    }
  }
  const circ = circleOf(pts);
  if (circ) out.push({ at: "center", point: circ.c });
  return out;
}

/** Nejbližší bod k uchopení do `tol` px (bod musí být na zachované straně řezu). */
export function snapNear<T extends { point: Vec3 }>(ix: SoftPickIndex, cands: T[], x: number, y: number, tol = SNAP_TOL_PX): T | null {
  let best: T | null = null;
  let bd = Infinity;
  for (const c of cands) {
    if (!clipOk(ix, c.point)) continue;
    const [sx, sy] = projectPoint(ix, c.point);
    const d = Math.hypot(sx - x, sy - y);
    if (d < tol && d < bd) {
      bd = d;
      best = c;
    }
  }
  return best;
}

/** Popisek entity pro výběr bez trefování (F1 plocha, E2 hrana, V3 vrchol) – stejný tvar jako u 3D okna. */
export type SoftHint = { id: string; kind: "face" | "edge" | "vertex"; index: number; x: number; y: number; p: Vec3; title: string };

const axisName = (n: Vec3): string => (Math.abs(n[0]) > 0.95 ? (n[0] > 0 ? "+X" : "-X") : Math.abs(n[1]) > 0.95 ? (n[1] > 0 ? "+Y" : "-Y") : Math.abs(n[2]) > 0.95 ? (n[2] > 0 ? "+Z" : "-Z") : "");

/** Volby popisků. */
export type HintOptions = {
  /**
   * Místo plátna (px) zakryté jiným prvkem stránky (upozornění, panel vlastností, lišta) – skutečný klik by tam entitu
   * nevybral, popisek se proto položí jinam (nebo vynechá).
   */
  blocked?: (x: number, y: number) => boolean;
};

/**
 * Okolí bodu popisku, ve kterém klik musí vybrat tutéž entitu: bod a ±1 px ve směru os (kosočtverec |dx| + |dy| ≤ 1).
 * Pokryje zaokrouhlení na celé pixely (snímek obrazovky, agent s obrázkem) i neceločíselnou polohu plátna na stránce
 * (±0,5 px). Větší okolí (±1,5 px s úhlopříčkami) by u členitých modelů vzalo popisek ~10–30 % entit.
 */
const HINT_RING: [number, number][] = [[0, 0], [1, 0], [-1, 0], [0, 1], [0, -1]];

/**
 * Popisky entit dílu na viditelných místech. Každý popisek leží v celém pixelu, kde klik (filtr „vše“) vybere právě
 * tuto entitu – ověřeno dotazem `pickAt` v bodě i v jeho okolí ±1 px (`HINT_RING`), a s `blocked` jen tam, kam klik
 * opravdu dopadne na plátno. Entita bez takového místa (zakrytá, mimo plátno, menší než tolerance hran, pod panelem)
 * popisek nedostane. Limity jako 3D okno: 300 ploch, 400 hran, 200 vrcholů.
 */
export function softHints(ix: SoftPickIndex, o: HintOptions = {}): SoftHint[] {
  const g = softHintSteps(ix, o);
  let r = g.next();
  while (!r.done) r = g.next();
  return r.value;
}

/**
 * Totéž po částech: generátor po každé entitě vrátí řízení (`yield`), výsledek je hodnota po dokončení. Náhled tak
 * popisky velkého modelu počítá po krátkých dávkách mezi snímky a nezamrzne (viz `softHints`).
 */
export function* softHintSteps(ix: SoftPickIndex, o: HintOptions = {}): Generator<void, SoftHint[], void> {
  const out: SoftHint[] = [];
  const k = ix.items.findIndex((p) => !p.it.compId);
  if (k < 0) return out;
  const p = ix.items[k];
  const m = p.it;
  const inside = (x: number, y: number) => x >= 4 && y >= 4 && x <= ix.W - 4 && y <= ix.H - 4;
  /** celý pixel u bodu (x0, y0), kde klik i v okolí vybere entitu; null = místo nevyhovuje */
  const place = (x0: number, y0: number, kind: "face" | "edge" | "vertex", index: number): [number, number] | null => {
    const x = Math.round(x0), y = Math.round(y0);
    if (!inside(x, y)) return null;
    if (o.blocked) for (const [dx, dy] of HINT_RING) if (o.blocked(x + dx, y + dy)) return null;
    for (const [dx, dy] of HINT_RING) {
      const r = pickAt(ix, x + dx, y + dy, "all");
      if (!r || r.kind !== kind || (r as { index: number }).index !== index || (r as { compId?: string }).compId) return null;
    }
    return [x, y];
  };
  const world = (x: number, y: number, z: number): Vec3 => {
    const a = p.a;
    return [a[0] * x + a[1] * y + a[2] * z + a[9], a[3] * x + a[4] * y + a[5] * z + a[10], a[6] * x + a[7] * y + a[8] * z + a[11]];
  };
  const D = ix.view.camera.dir;
  const V = m.vertices, T = m.triangles, N = m.normals;
  const FG = m.faceGroups;
  if (FG) {
    const TOP = 8;
    const nearI = new Int32Array(TOP), bigI = new Int32Array(TOP);
    const nearD = new Float64Array(TOP), bigA = new Float64Array(TOP);
    for (let g = 0; g + 2 < FG.length && out.length < 300; g += 3) {
      const start = FG[g], count = FG[g + 1], fi = FG[g + 2];
      if (count < 3) continue;
      const end = Math.min(start + count, T.length);
      // 1. průchod: těžiště plochy (průměr těžišť trojúhelníků) a součet normál
      let cx = 0, cy = 0, cz = 0, nx = 0, ny = 0, nz = 0, n = 0;
      const hasN = !!N && N.length === V.length;
      for (let i = start; i + 2 < end; i += 3) {
        const a = T[i] * 3, b = T[i + 1] * 3, c = T[i + 2] * 3;
        cx += V[a] + V[b] + V[c];
        cy += V[a + 1] + V[b + 1] + V[c + 1];
        cz += V[a + 2] + V[b + 2] + V[c + 2];
        if (hasN) {
          nx += N![a];
          ny += N![a + 1];
          nz += N![a + 2];
        }
        n++;
      }
      if (!n) continue;
      cx /= 3 * n;
      cy /= 3 * n;
      cz /= 3 * n;
      const nl = Math.hypot(nx, ny, nz) || 1;
      // normála plochy ve světě (lineární část matice; u dílu jednotková)
      const a0 = p.a;
      const nw: Vec3 = [(a0[0] * nx + a0[1] * ny + a0[2] * nz) / nl, (a0[3] * nx + a0[4] * ny + a0[5] * nz) / nl, (a0[6] * nx + a0[7] * ny + a0[8] * nz) / nl];
      const planar = nl / n > 0.98;
      if (planar && nw[0] * D[0] + nw[1] * D[1] + nw[2] * D[2] < 0.03) continue; // rovinná plocha odvrácená od kamery
      // 2. průchod: kandidáti = 8 trojúhelníků s těžištěm nejblíž těžišti plochy a 8 největších (bez řazení všech)
      nearD.fill(Infinity);
      bigA.fill(-1);
      nearI.fill(-1);
      bigI.fill(-1);
      for (let i = start; i + 2 < end; i += 3) {
        const a = T[i] * 3, b = T[i + 1] * 3, c = T[i + 2] * 3;
        const tx = (V[a] + V[b] + V[c]) / 3 - cx, ty = (V[a + 1] + V[b + 1] + V[c + 1]) / 3 - cy, tz = (V[a + 2] + V[b + 2] + V[c + 2]) / 3 - cz;
        const d = tx * tx + ty * ty + tz * tz;
        if (d < nearD[TOP - 1]) {
          let j = TOP - 1;
          while (j > 0 && nearD[j - 1] > d) {
            nearD[j] = nearD[j - 1];
            nearI[j] = nearI[j - 1];
            j--;
          }
          nearD[j] = d;
          nearI[j] = i;
        }
        const ux = V[b] - V[a], uy = V[b + 1] - V[a + 1], uz = V[b + 2] - V[a + 2], vx = V[c] - V[a], vy = V[c + 1] - V[a + 1], vz = V[c + 2] - V[a + 2];
        const ar = Math.hypot(uy * vz - uz * vy, uz * vx - ux * vz, ux * vy - uy * vx);
        if (ar > bigA[TOP - 1]) {
          let j = TOP - 1;
          while (j > 0 && bigA[j - 1] < ar) {
            bigA[j] = bigA[j - 1];
            bigI[j] = bigI[j - 1];
            j--;
          }
          bigA[j] = ar;
          bigI[j] = i;
        }
      }
      const tried = new Set<number>();
      for (const i of [...nearI, ...bigI]) {
        if (i < 0 || tried.has(i)) continue;
        tried.add(i);
        const a = T[i] * 3, b = T[i + 1] * 3, c = T[i + 2] * 3;
        const wp = world((V[a] + V[b] + V[c]) / 3, (V[a + 1] + V[b + 1] + V[c + 1]) / 3, (V[a + 2] + V[b + 2] + V[c + 2]) / 3);
        const [px, py] = projectPoint(ix, wp);
        const at = place(px, py, "face", fi);
        if (!at) continue;
        const dir = axisName(nw);
        out.push({ id: `F${fi + 1}`, kind: "face", index: fi, x: at[0], y: at[1], p: wp, title: tr("Plocha {0} · {1}{2}", fi + 1, planar ? tr("rovinná") : tr("zakřivená"), dir ? tr(" · normála {0}", dir) : "") });
        break;
      }
      yield;
    }
  }
  const L = m.lines;
  const EG = (m as PickItem).edgeGroups;
  if (L && EG) {
    let edges = 0;
    for (let g = 0; g + 2 < EG.length && edges < 400; g += 3) {
      const start = EG[g], count = EG[g + 1], ei = EG[g + 2];
      const nSeg = Math.floor(count / 2);
      if (nSeg < 1) continue;
      let len = 0;
      for (let q = start; q + 1 < start + count; q += 2) len += Math.hypot(L[(q + 1) * 3] - L[q * 3], L[(q + 1) * 3 + 1] - L[q * 3 + 1], L[(q + 1) * 3 + 2] - L[q * 3 + 2]);
      // štítek uprostřed hrany (u úsečky střed, u křivky prostřední bod), jinak ve třetinách / osminách
      const at = (seg: number, t: number): Vec3 => {
        const i0 = (start + 2 * seg) * 3, i1 = (start + 2 * seg + 1) * 3;
        return world(L[i0] + (L[i1] - L[i0]) * t, L[i0 + 1] + (L[i1 + 1] - L[i0 + 1]) * t, L[i0 + 2] + (L[i1 + 2] - L[i0 + 2]) * t);
      };
      const cands: Vec3[] =
        nSeg === 1
          ? [at(0, 0.5), at(0, 0.3), at(0, 0.7), at(0, 0.15), at(0, 0.85)]
          : [at(Math.floor(nSeg / 2), 0), at(Math.floor(nSeg / 4), 0.5), at(Math.floor((3 * nSeg) / 4), 0.5), at(Math.floor(nSeg / 8), 0.5), at(Math.floor((7 * nSeg) / 8), 0.5)];
      for (const wp of cands) {
        const [px, py] = projectPoint(ix, wp);
        const pos = place(px, py, "edge", ei);
        if (!pos) continue;
        let kind = tr("křivka");
        if (nSeg === 1) {
          const i0 = start * 3, i1 = (start + 1) * 3;
          const d: Vec3 = [L[i1] - L[i0], L[i1 + 1] - L[i0 + 1], L[i1 + 2] - L[i0 + 2]];
          const dl = Math.hypot(d[0], d[1], d[2]) || 1;
          const dz = d[2] / dl;
          kind = Math.abs(dz) > 0.99 ? tr("svislá úsečka") : Math.abs(dz) < 0.01 ? tr("vodorovná úsečka") : tr("úsečka");
        }
        out.push({ id: `E${ei + 1}`, kind: "edge", index: ei, x: pos[0], y: pos[1], p: wp, title: tr("Hrana {0} · {1} · délka ≈ {2} mm", ei + 1, kind, Math.round(len * 10) / 10) });
        edges++;
        break;
      }
      yield;
    }
  }
  const P = m.points;
  if (P) {
    let nv = 0;
    for (let i = 0; i + 2 < P.length && nv < 200; i += 3) {
      const wp = world(P[i], P[i + 1], P[i + 2]);
      const [px, py] = projectPoint(ix, wp);
      const pos = place(px, py, "vertex", i / 3);
      if (pos) {
        out.push({ id: `V${i / 3 + 1}`, kind: "vertex", index: i / 3, x: pos[0], y: pos[1], p: wp, title: tr("Vrchol {0} · [{1}; {2}; {3}]", i / 3 + 1, Math.round(wp[0] * 100) / 100, Math.round(wp[1] * 100) / 100, Math.round(wp[2] * 100) / 100) });
        nv++;
      }
      if (i % 30 === 27) yield;
    }
  }
  return out;
}
