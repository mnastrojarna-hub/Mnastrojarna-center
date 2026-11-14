/**
 * Filtr výběru „Prvek“: který prvek historie vytvořil plochu tělesa, na kterou uživatel klikl, a které další plochy
 * výsledného tělesa vytvořil tentýž prvek (zvýraznění v 3D okně, výběr ve stromu historie). Běží ve workeru nad stavy
 * tělesa po jednotlivých prvcích z mezipaměti stavby (`cachedSteps` v build.ts) – nic se nepřepočítává.
 *
 * Pravidlo (jako „vlastník plochy“ v desktopových CAD): plocha patří prvku, po kterém se v tělese poprvé objevila plocha
 * se stejnou geometrií (stejný druh plochy, bod plochy na ní leží a normála v něm je rovnoběžná) a od té doby nezmizela.
 * Horní plocha kvádru s dírou tedy patří kvádru, válcová stěna díry díře, zaoblení zaoblení. Prvky, které posunou celé
 * těleso (Přesunout / otočit), „vytvoří“ všechny plochy – to je známé omezení (vybere se ten prvek).
 */
import * as r from "replicad";
import type { Feature, Vec3 } from "./types";

type Shape = r.Shape3D;
/** Stav po `n` prvcích historie: tělesa dílu (aktivní a ostatní). */
export type Step = { n: number; shapes: Shape[] };
export type FaceOwner = { featureId: string; index: number; faces: number[]; exact: boolean };

type OC = {
  BRepExtrema_DistShapeShape: new () => { LoadS1(s: unknown): void; LoadS2(s: unknown): void; Perform(p?: unknown): void; IsDone(): boolean; Value(): number; NbSolution(): number; PointOnShape2(i: number): { X(): number; Y(): number; Z(): number; delete(): void }; delete(): void };
  Message_ProgressRange: new () => unknown;
};
const oc = () => r.getOC() as unknown as OC;
const vt = (v: { x: number; y: number; z: number }): Vec3 => [v.x, v.y, v.z];
const unit = (a: Vec3): Vec3 => {
  const l = Math.hypot(a[0], a[1], a[2]) || 1;
  return [a[0] / l, a[1] / l, a[2] / l];
};

/** vzdálenost bodu od (ořezané) plochy a nejbližší bod na ní */
function nearest(face: r.Face, p: Vec3): { d: number; q: Vec3 } | null {
  const o = oc();
  const v = r.makeVertex(p);
  const q = new o.BRepExtrema_DistShapeShape();
  try {
    q.LoadS1(v.wrapped);
    q.LoadS2(face.wrapped);
    q.Perform(new o.Message_ProgressRange());
    if (!q.IsDone() || q.NbSolution() < 1) return null;
    const pt = q.PointOnShape2(1);
    const out = { d: q.Value(), q: [pt.X(), pt.Y(), pt.Z()] as Vec3 };
    pt.delete();
    return out;
  } catch {
    return null;
  } finally {
    q.delete();
    v.delete();
  }
}

type Probe = { t: string; p: Vec3; n: Vec3 | null };
const normalAt = (f: r.Face, p: Vec3): Vec3 | null => {
  try {
    return unit(vt(f.normalAt(p)));
  } catch {
    return null;
  }
};
/** bod na ploše (nejbližší k jejímu těžišti, případně k zadanému bodu) s druhem plochy a normálou */
function probeOf(f: r.Face, near?: Vec3): Probe | null {
  const at = near ?? vt(f.center);
  const hit = nearest(f, at);
  if (!hit) return null;
  return { t: f.geomType as string, p: hit.q, n: normalAt(f, hit.q) };
}

const inBox = (b: [Vec3, Vec3], p: Vec3, tol: number) => p.every((v, k) => v >= b[0][k] - tol && v <= b[1][k] + tol);

type FaceRec = { g: r.Face; t: string; box: [Vec3, Vec3] | null };
/** plochy tělesa s druhem a obalovým kvádrem – načtou se jednou pro každé těleso (rychlé předběžné vyřazení) */
function recordsOf(s: Shape, cache: Map<Shape, FaceRec[]>): FaceRec[] {
  let list = cache.get(s);
  if (list) return list;
  list = s.faces.map((g) => {
    let box: [Vec3, Vec3] | null = null;
    try {
      box = g.boundingBox.bounds as [Vec3, Vec3];
    } catch {
      box = null;
    }
    return { g, t: g.geomType as string, box };
  });
  cache.set(s, list);
  return list;
}

/** Leží v některém z těles plocha se stejnou geometrií jako sonda? */
function present(shapes: Shape[], pr: Probe, tol: number, cache: Map<Shape, FaceRec[]>): boolean {
  for (const s of shapes) {
    for (const { g, t, box } of recordsOf(s, cache)) {
      if (t !== pr.t || (box && !inBox(box, pr.p, tol))) continue;
      const hit = nearest(g, pr.p);
      if (!hit || hit.d > tol) continue;
      if (!pr.n) return true;
      const n = normalAt(g, pr.p);
      if (!n || Math.abs(n[0] * pr.n[0] + n[1] * pr.n[1] + n[2] * pr.n[2]) > 0.999) return true;
    }
  }
  return false;
}

/** prvky, které mohou vytvořit plochu (skica, pomocné prvky a potlačené prvky ne) */
const GEOMETRY_LESS = new Set(["sketch", "datum", "datumAxis", "datumPoint", "csys"]);
const canCreate = (f: Feature | undefined) => !!f && !f.suppressed && !GEOMETRY_LESS.has(f.type);
/** nad tímto počtem ploch (velké importy) se plochy prvku nehledají – zvýrazní se jen kliknutá */
const MAX_FACES = 2500;

/**
 * Prvek, který vytvořil plochu `faceIndex` výsledného tělesa `final` (bod kliknutí `point` upřesní místo na ploše),
 * a všechny plochy výsledného tělesa, které vytvořil. `steps` = stavy po prvcích (seřazené podle n, nemusí být všechny –
 * mezipaměť drží nejvýš 24 stavů); v mezeře mezi stavy se vybere poslední prvek, který mohl plochu vytvořit (`exact: false`).
 */
export function faceOwner(final: Shape, faceIndex: number, point: Vec3 | undefined, steps: Step[], features: Feature[]): FaceOwner | null {
  const faces = final.faces;
  const face = faces[faceIndex];
  if (!face) return null;
  const pr = probeOf(face, point);
  if (!pr) return null;
  const [[x0, y0, z0], [x1, y1, z1]] = final.boundingBox.bounds as [Vec3, Vec3];
  const tol = Math.max(1e-4, Math.hypot(x1 - x0, y1 - y0, z1 - z0) * 1e-6);
  const cache = new Map<Shape, FaceRec[]>();
  const sorted = [...steps].filter((s) => s.n >= 1 && s.n <= features.length).sort((a, b) => a.n - b.n);
  // od konce: poslední stav, ve kterém plocha ještě není → plochu vytvořil některý z prvků za ním
  let lo = 0; // počet prvků, po kterých plocha (naposledy) chyběla
  for (let i = sorted.length - 1; i >= 0; i--) {
    if (!present(sorted[i].shapes, pr, tol, cache)) {
      lo = sorted[i].n;
      break;
    }
  }
  const hi = sorted.find((s) => s.n > lo)?.n ?? features.length; // první známý stav, ve kterém plocha je
  let idx = -1;
  for (let k = hi - 1; k >= lo; k--) if (canCreate(features[k])) {
    idx = k;
    break;
  }
  if (idx < 0) return null;
  const exact = hi - lo === 1 || features.slice(lo, hi).filter(canCreate).length === 1;
  // ostatní plochy téhož prvku: chybí ve stavu před ním (lo) a jsou ve stavu po něm (hi) – stačí dva stavy, žádná stavba.
  // Stav po posledním prvku = výsledné těleso (plocha v něm je), před prvním prvkem není nic; velmi velká tělesa (import) jen klik.
  const before = lo > 0 ? (sorted.find((s) => s.n === lo)?.shapes ?? []) : [];
  const after = hi < features.length ? sorted.find((s) => s.n === hi)?.shapes : undefined;
  const out: number[] = [];
  if (faces.length > MAX_FACES) out.push(faceIndex);
  else
    faces.forEach((f, i) => {
      if (i === faceIndex) return void out.push(i);
      if (!after && !before.length) return void out.push(i); // první prvek a zároveň poslední stav – všechny plochy
      const q = probeOf(f);
      if (!q) return;
      if ((after ? present(after, q, tol, cache) : true) && !present(before, q, tol, cache)) out.push(i);
    });
  return { featureId: features[idx].id, index: idx, faces: out, exact };
}
