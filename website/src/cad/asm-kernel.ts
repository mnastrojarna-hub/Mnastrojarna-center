/**
 * Sestavy v jádře (worker): stavba komponent s mezipamětí podle obsahu (stejné díly se staví jen jednou),
 * složení sestavy do jednoho tělesa (compound) pro export/výkres a kontrola kolizí.
 */
import { tr } from "./i18n";
import * as r from "replicad";
import { flattenAssembly, MAX_DEPTH, sourceKey } from "./assembly";
import { buildDoc, buildShape, shapeResult } from "./build";
import { missingBlobs } from "./blobs";
import { subShapes } from "./fastbox";
import type { BuildResult, CadDoc, ComponentSource, Placement, Vec3 } from "./types";

type Shape = r.Shape3D;
type Entry = { body: Shape | null; result: BuildResult; used: number };

const cache = new Map<string, Entry>();
let tick = 0;
const MAX = 400;

function trim() {
  if (cache.size <= MAX) return;
  const old = [...cache.entries()].sort((a, b) => a[1].used - b[1].used).slice(0, cache.size - MAX);
  for (const [k, e] of old) {
    e.body?.delete?.();
    cache.delete(k);
  }
}

function sourceDoc(s: Exclude<ComponentSource, { kind: "asm" }>): CadDoc {
  if (s.kind === "part") return s.doc;
  return { app: "mnastrojarna-cad", version: 2, name: s.fileName, material: "ocel", features: [{ id: "imp", name: s.fileName, type: "import", fileName: s.fileName, format: s.format, data: s.data }] };
}

export async function partEntry(key: string, s: ComponentSource, depth = 0): Promise<Entry> {
  const hit = cache.get(key);
  if (hit) {
    hit.used = ++tick;
    return hit;
  }
  // podsestava = složené těleso z jejích komponent (jedna tuhá síť)
  // importované soubory = lehké komponenty (hrubší síť, objem ze sítě) – díly velkých sestav STEP se tak zobrazí rychle
  const res = s.kind === "asm" ? shapeResult(await assemblyShape(s.doc, depth + 1)) : await buildDoc(sourceDoc(s), { light: s.kind === "file" });
  const { body, ...result } = res;
  const e: Entry = { body, result, used: ++tick };
  // bez dat importu (dorazí s dalším požadavkem) se selhaný díl nezapamatuje
  if (missingBlobs(s.kind === "asm" ? s.doc : sourceDoc(s)).length) return e;
  cache.set(key, e);
  trim();
  return e;
}

export function placed(s: Shape, p: Placement): Shape {
  const [rx, ry, rz] = p.rotation;
  let t = s.clone() as Shape;
  if (rz) t = t.rotate(rz, [0, 0, 0], [0, 0, 1]) as Shape;
  if (ry) t = t.rotate(ry, [0, 0, 0], [0, 1, 0]) as Shape;
  if (rx) t = t.rotate(rx, [0, 0, 0], [1, 0, 0]) as Shape;
  if (p.position.some((v) => v)) t = t.translate(p.position) as Shape;
  return t;
}

/** Sestava → jedno těleso (compound) se všemi viditelnými komponentami na svých místech. */
export async function assemblyShape(doc: CadDoc, depth = 0): Promise<Shape | null> {
  if (depth > MAX_DEPTH) throw new Error(tr("Sestava je zanořená příliš hluboko (nebo obsahuje sama sebe)."));
  const shapes: Shape[] = [];
  for (const c of doc.components ?? []) {
    if (c.hidden) continue;
    const e = await partEntry(sourceKey(c.source), c.source, depth);
    if (e.body) shapes.push(placed(e.body, c.placement));
  }
  if (!shapes.length) return null;
  return r.makeCompound(shapes) as unknown as Shape;
}

/** Díl nebo sestava → výsledné těleso (pro export a výkresy). */
export async function shapeOfDoc(doc: CadDoc): Promise<Shape | null> {
  if (doc.kind === "assembly") return assemblyShape(doc);
  return (await buildShape(doc)).body;
}

/** Kolize dvou listových dílů. `a`/`b` = id komponent nejvyšší úrovně (pro zvýraznění), `aPath`/`bPath` = celé cesty. */
export type Interference = { a: string; b: string; volume: number; aPath?: string[]; bPath?: string[] };

/** Kontrola kolizí listových dílů (i uvnitř podsestav): síto podle obalových kvádrů, pak přesný průnik. */
export async function interference(doc: CadDoc, tolerance = 1e-3): Promise<Interference[]> {
  const items: { path: string[]; shape: Shape; box: [Vec3, Vec3] }[] = [];
  for (const f of flattenAssembly(doc)) {
    if (f.hidden) continue;
    const e = await partEntry(f.key, f.comp.source);
    if (!e.body) continue;
    const s = placed(e.body, f.placement);
    items.push({ path: f.path, shape: s, box: s.boundingBox.bounds as [Vec3, Vec3] });
  }
  const out: Interference[] = [];
  for (let i = 0; i < items.length; i++)
    for (let j = i + 1; j < items.length; j++) {
      const [a0, a1] = items[i].box;
      const [b0, b1] = items[j].box;
      if (a1[0] < b0[0] || b1[0] < a0[0] || a1[1] < b0[1] || b1[1] < a0[1] || a1[2] < b0[2] || b1[2] < a0[2]) continue;
      try {
        const x = items[i].shape.intersect(items[j].shape);
        const v = r.measureVolume(x);
        if (v > tolerance) out.push({ a: items[i].path[0], b: items[j].path[0], volume: v, aPath: items[i].path, bPath: items[j].path });
      } catch {
        /* nelze určit – přeskočit */
      }
    }
  for (const it of items) it.shape.delete?.();
  return out;
}

export function cachedBody(key: string): Shape | null {
  return cache.get(key)?.body ?? null;
}

// ---------------- geometrie ploch pro vazby ----------------

/** Geometrie plochy dílu (lokální souřadnice dílu) pro trvalé vazby: rovina (normála) nebo válec/kužel (osa). */
export type MateFaceInfo = {
  /** plocha: rovina / válec (kužel) / koule / jiná; hrana (mateEdgeInfo): úsečka / kružnice / křivka; vrchol: bod */
  kind: "plane" | "cylinder" | "other" | "sphere" | "line" | "circle" | "curve" | "point";
  origin: Vec3;
  normal: Vec3;
  radius?: number;
  /** rozsah válce podél osy (parametr t od origin) */
  extent?: [number, number];
  /** body hrany (úsečka: začátek a konec; křivka: lomená čára) nebo vrcholy sítě plochy (mateFaceMesh) */
  pts?: Vec3[];
  /** síť plochy: trojúhelníky (indexy do pts) a normály ve vrcholech */
  tris?: number[];
  nrm?: Vec3[];
  /** délka hrany */
  length?: number;
};

type OcAny = Record<string, new (...a: unknown[]) => Record<string, (...a: unknown[]) => unknown>>;
const P3 = (p: { X(): number; Y(): number; Z(): number }): Vec3 => [p.X(), p.Y(), p.Z()];

export function mateFaceInfoOf(body: Shape, index: number): MateFaceInfo | null {
  const face = body.faces[index];
  if (!face) return null;
  const type = face.geomType as string;
  const c = face.center;
  const origin: Vec3 = [c.x, c.y, c.z];
  if (type === "PLANE") {
    const n = face.normalAt(c);
    return { kind: "plane", origin, normal: [n.x, n.y, n.z] };
  }
  if (type === "SPHERE") {
    try {
      const oc = r.getOC() as unknown as OcAny;
      const ad = new oc.BRepAdaptor_Surface(face.wrapped);
      const sp = ad.Sphere() as { Location(): { X(): number; Y(): number; Z(): number }; Radius(): number };
      const out: MateFaceInfo = { kind: "sphere", origin: P3(sp.Location()), normal: [0, 0, 1], radius: sp.Radius() };
      (ad as unknown as { delete(): void }).delete();
      return out;
    } catch {
      return { kind: "other", origin, normal: [0, 0, 1] };
    }
  }
  if (type === "CYLINDRE" || type === "CONE") {
    try {
      const oc = r.getOC() as unknown as OcAny;
      const ad = new oc.BRepAdaptor_Surface(face.wrapped);
      const g = (type === "CYLINDRE" ? ad.Cylinder() : ad.Cone()) as { Radius?(): number; RefRadius?(): number; Axis(): { Location(): { X(): number; Y(): number; Z(): number }; Direction(): { X(): number; Y(): number; Z(): number } } };
      const ax = g.Axis();
      const o = P3(ax.Location());
      const d = P3(ax.Direction());
      const radius = type === "CYLINDRE" ? g.Radius!() : g.RefRadius!();
      (ad as unknown as { delete(): void }).delete();
      // rozsah podél osy z obalového kvádru plochy
      const [[x0, y0, z0], [x1, y1, z1]] = face.boundingBox.bounds as [Vec3, Vec3];
      let tmin = Infinity;
      let tmax = -Infinity;
      for (const x of [x0, x1]) for (const y of [y0, y1]) for (const z of [z0, z1]) {
        const t = (x - o[0]) * d[0] + (y - o[1]) * d[1] + (z - o[2]) * d[2];
        tmin = Math.min(tmin, t);
        tmax = Math.max(tmax, t);
      }
      return { kind: "cylinder", origin: o, normal: d, radius, extent: [tmin, tmax] };
    } catch {
      return { kind: "other", origin, normal: [0, 0, 1] };
    }
  }
  return { kind: "other", origin, normal: [0, 0, 1] };
}

export function mateFaceInfo(key: string, index: number): MateFaceInfo | null {
  const b = cachedBody(key);
  return b ? mateFaceInfoOf(b, index) : null;
}

/** Geometrie hrany dílu pro vazby (Dráha, Shodně, Hřeben): úsečka (začátek, směr), kružnice (střed, osa, poloměr), jiná křivka (body). */
export function mateEdgeInfoOf(body: Shape, index: number): MateFaceInfo | null {
  const edge = body.edges[index];
  if (!edge) return null;
  const type = edge.geomType as string;
  const V = (v: { x: number; y: number; z: number }): Vec3 => [v.x, v.y, v.z];
  const a = V(edge.startPoint);
  const b = V(edge.endPoint);
  const length = edge.length;
  if (type === "LINE") {
    const d: Vec3 = [b[0] - a[0], b[1] - a[1], b[2] - a[2]];
    const l = Math.hypot(...d) || 1;
    return { kind: "line", origin: a, normal: [d[0] / l, d[1] / l, d[2] / l], pts: [a, b], length };
  }
  const N = Math.max(16, Math.min(400, Math.ceil(length / 0.5)));
  const pts: Vec3[] = [];
  for (let i = 0; i <= N; i++) pts.push(V(edge.pointAt(i / N)));
  if (type === "CIRCLE") {
    try {
      const oc = r.getOC() as unknown as OcAny;
      const ad = new oc.BRepAdaptor_Curve(edge.wrapped);
      const c = ad.Circle() as { Axis(): { Location(): { X(): number; Y(): number; Z(): number }; Direction(): { X(): number; Y(): number; Z(): number } }; Radius(): number };
      const ax = c.Axis();
      const out: MateFaceInfo = { kind: "circle", origin: P3(ax.Location()), normal: P3(ax.Direction()), radius: c.Radius(), pts, length };
      (ad as unknown as { delete(): void }).delete();
      return out;
    } catch {
      /* jako obecná křivka */
    }
  }
  return { kind: "curve", origin: a, normal: [0, 0, 1], pts, length };
}

export function mateEdgeInfo(key: string, index: number): MateFaceInfo | null {
  const b = cachedBody(key);
  return b ? mateEdgeInfoOf(b, index) : null;
}

/** Poloha vrcholu dílu (přesně z jádra) jako geometrie „point“. */
export function mateVertexInfo(key: string, index: number): MateFaceInfo | null {
  const b = cachedBody(key);
  if (!b) return null;
  const oc = r.getOC() as unknown as { BRep_Tool: { Pnt(v: unknown): { X(): number; Y(): number; Z(): number; delete(): void } } };
  let i = 0;
  let out: MateFaceInfo | null = null;
  for (const v of subShapes(b, "VERTEX")) {
    if (i++ === index) {
      const p = oc.BRep_Tool.Pnt(v);
      out = { kind: "point", origin: [p.X(), p.Y(), p.Z()], normal: [0, 0, 1] };
      p.delete();
    }
    (v as { delete(): void }).delete();
  }
  return out;
}

/** Jemná síť jedné plochy dílu (vačka): vrcholy, trojúhelníky a normály; `tol` = odchylka tětivy [mm]. */
export function mateFaceMesh(key: string, index: number, tol = 0.002): MateFaceInfo | null {
  const b = cachedBody(key);
  const face = b?.faces[index];
  if (!face) return null;
  const info = mateFaceInfoOf(b!, index);
  const m = face.mesh({ tolerance: tol, angularTolerance: 0.05 });
  const pts: Vec3[] = [];
  const nrm: Vec3[] = [];
  for (let i = 0; i + 2 < m.vertices.length; i += 3) {
    pts.push([m.vertices[i], m.vertices[i + 1], m.vertices[i + 2]]);
    nrm.push([m.normals[i] ?? 0, m.normals[i + 1] ?? 0, m.normals[i + 2] ?? 1]);
  }
  return { ...(info ?? { kind: "other", origin: pts[0] ?? [0, 0, 0], normal: [0, 0, 1] }), pts, tris: [...m.triangles], nrm };
}

/** Index válcové plochy dílu s daným poloměrem (největší plocha) – pro automatické vazby normálií (šroub v díře). */
export function findCylFace(key: string, radius: number, tol = 0.05): number {
  const b = cachedBody(key);
  if (!b) return -1;
  let best = -1;
  let bestArea = -1;
  b.faces.forEach((f, i) => {
    if (f.geomType !== "CYLINDRE") return;
    const info = mateFaceInfoOf(b, i);
    if (!info?.radius || Math.abs(info.radius - radius) > tol) return;
    let area = 0;
    try {
      area = r.measureArea(f);
    } catch {
      area = 0;
    }
    if (area > bestArea) {
      bestArea = area;
      best = i;
    }
  });
  return best;
}
