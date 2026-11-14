/**
 * Sestavy v jádře (worker): stavba komponent s mezipamětí podle obsahu (stejné díly se staví jen jednou),
 * složení sestavy do jednoho tělesa (compound) pro export/výkres a kontrola kolizí.
 */
import { tr } from "./i18n";
import * as r from "replicad";
import { flattenAssembly, MAX_DEPTH, rotMatrix, sourceKey } from "./assembly";
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

/** přímé volání OCCT (řízené uvolňování paměti – objekty se mažou hned, ne až po GC) */
type Oc = any;
type Trsf = { delete(): void; PreMultiply(t: Trsf): void };

/**
 * Transformace umístění komponenty v OCCT: nejdřív natočení kolem Z, pak Y, pak X (počátek), nakonec posun – stejné pořadí jako
 * dřívější řetěz `rotate`/`translate` z replicadu, ale jako jedna `gp_Trsf` (volající ji smaže).
 */
function trsfOf(p: Placement): Trsf {
  const oc = r.getOC() as Oc;
  const t = new oc.gp_Trsf() as Trsf;
  const [rx, ry, rz] = p.rotation;
  const rot = (deg: number, d: [number, number, number]) => {
    if (!deg) return;
    const o = new oc.gp_Pnt(0, 0, 0);
    const dir = new oc.gp_Dir(d[0], d[1], d[2]);
    const ax = new oc.gp_Ax1(o, dir);
    const q = new oc.gp_Trsf();
    q.SetRotation(ax, (deg * Math.PI) / 180);
    t.PreMultiply(q);
    q.delete();
    ax.delete();
    dir.delete();
    o.delete();
  };
  rot(rz, [0, 0, 1]);
  rot(ry, [0, 1, 0]);
  rot(rx, [1, 0, 0]);
  if (p.position.some((v) => v)) {
    const v = new oc.gp_Vec(p.position[0], p.position[1], p.position[2]);
    const q = new oc.gp_Trsf();
    q.SetTranslation(v);
    t.PreMultiply(q);
    q.delete();
    v.delete();
  }
  return t;
}

/**
 * Těleso komponenty v jejím umístění: tatáž geometrie jako díl, jen s polohou (TopLoc_Location), volající výsledek smaže.
 * Bez kopie geometrie: kopie přes BRepBuilderAPI_Transform (dřívější replicad `rotate`/`translate`, i vlastní se smazáním builderu)
 * nechává v haldě WASM ~60–90 kB na kopii (sonda: 5 000 kopií šroubu M10 → +435 MB živé haldy, s polohou beze změny v mezích měření) – export sestavy,
 * výkres a měření v sestavě by v dlouhém sezení (serve) rostly s každým voláním. Sdílení geometrie s dílem je totéž, co dřív dělala
 * nulová poloha (`clone()`); OCCT (síť, STEP, HLR, booleovské operace, GProp) polohu tvarů respektuje.
 */
export function placed(s: Shape, p: Placement): Shape {
  const [rx, ry, rz] = p.rotation;
  if (!rx && !ry && !rz && !p.position.some((v) => v)) return s.clone() as Shape;
  const oc = r.getOC() as Oc;
  const t = trsfOf(p);
  const loc = new oc.TopLoc_Location(t);
  const moved = s.wrapped.Moved(loc, false);
  try {
    return r.cast(moved) as Shape;
  } finally {
    moved.delete();
    loc.delete();
    t.delete();
  }
}

/**
 * Compound z těles; vstupní tvary se smažou (jako `r.makeCompound`). Na rozdíl od replicadu se smaže i builder a původní objekt
 * compoundu (replicad ho po `cast` nechá žít – i s odkazem na všechny vložené tvary, tj. celé těleso sestavy na každé volání).
 */
function compoundOf(shapes: Shape[]): Shape {
  const oc = r.getOC() as Oc;
  const builder = new oc.TopoDS_Builder();
  const comp = new oc.TopoDS_Compound();
  try {
    builder.MakeCompound(comp);
    for (const s of shapes) builder.Add(comp, s.wrapped);
    return r.cast(comp) as Shape;
  } finally {
    for (const s of shapes) s.delete();
    comp.delete();
    builder.delete();
  }
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
  return compoundOf(shapes);
}

/** Díl nebo sestava → výsledné těleso (pro export a výkresy). */
export async function shapeOfDoc(doc: CadDoc): Promise<Shape | null> {
  if (doc.kind === "assembly") return assemblyShape(doc);
  return (await buildShape(doc)).body;
}

/** Kolize dvou listových dílů. `a`/`b` = id komponent nejvyšší úrovně (pro zvýraznění), `aPath`/`bPath` = celé cesty. */
export type Interference = { a: string; b: string; volume: number; aPath?: string[]; bPath?: string[] };
/**
 * Počty jedné kontroly: dvojice listů, odfiltrované obálkou, přesné průniky, znovupoužité z mezipaměti dvojic, nevyhodnotitelné
 * (booleovská operace selhala – dvojice se jako dřív nehlásí).
 */
export type InterferenceStats = { pairs: number; culled: number; exact: number; reused: number; undetermined: number };

/* ───── přírůstková kontrola kolizí: mezipaměť dvojic (stav modulu ve vlákně jádra) ───── */

/** Poloha listu jako R (po řádcích) a posun – shodná s `trsfOf` (R = Rx·Ry·Rz). */
type Rt = { R: number[]; t: Vec3 };
const rtOf = (p: Placement): Rt => ({ R: rotMatrix(p.rotation), t: [p.position[0], p.position[1], p.position[2]] });
/**
 * Vzájemná poloha A⁻¹·B (B v souřadnicích A) zaokrouhlená na mřížku 1e-7: `q` = celá čísla (klíč), `m` = zaokrouhlené hodnoty
 * [R po řádcích, t]. Přesný průnik se počítá právě s `m`, takže objem je funkcí klíče (plná a přírůstková kontrola dávají totéž)
 * a šum poloh z řešiče (1e-9 mm) nerozbije souosé plochy: OCCT u šroubu posunutého o 1e-9 mm vůči ose závitové díry vrátí
 * prázdný průnik (ověřeno i dřívějším algoritmem: 515,736 mm³ → 0).
 */
function relOf(A: Rt, B: Rt): { key: string; m: number[] } {
  const a = A.R;
  const R = new Array<number>(9);
  for (let i = 0; i < 3; i++) for (let j = 0; j < 3; j++) R[i * 3 + j] = a[i] * B.R[j] + a[3 + i] * B.R[3 + j] + a[6 + i] * B.R[6 + j];
  const d = [B.t[0] - A.t[0], B.t[1] - A.t[1], B.t[2] - A.t[2]];
  const t = [0, 1, 2].map((i) => a[i] * d[0] + a[3 + i] * d[1] + a[6 + i] * d[2]);
  const q = [...R, ...t].map((v) => Math.round(v * 1e7) || 0);
  return { key: q.join(","), m: q.map((v) => v / 1e7) };
}
/** Světová obálka z lokální obálky dílu a umístění (8 rohů, bez OCCT); vždy obsahuje skutečnou obálku. */
function worldBox([lo, hi]: [Vec3, Vec3], m: Rt): [Vec3, Vec3] {
  const out: [Vec3, Vec3] = [
    [Infinity, Infinity, Infinity],
    [-Infinity, -Infinity, -Infinity],
  ];
  for (let c = 0; c < 8; c++) {
    const v = [c & 1 ? hi[0] : lo[0], c & 2 ? hi[1] : lo[1], c & 4 ? hi[2] : lo[2]];
    for (let i = 0; i < 3; i++) {
      const w = m.R[i * 3] * v[0] + m.R[i * 3 + 1] * v[1] + m.R[i * 3 + 2] * v[2] + m.t[i];
      if (w < out[0][i]) out[0][i] = w;
      if (w > out[1][i]) out[1][i] = w;
    }
  }
  return out;
}

/** lokální obálky dílů (klíč dílu = obsah, takže platí trvale) */
const boxCache = new Map<string, [Vec3, Vec3]>();
/** (díl A, díl B, vzájemná poloha) → objem průniku (NaN = nevyhodnotitelné) */
const pairCache = new Map<string, number>();
const PAIR_MAX = 20000;
const BOX_MAX = 4000;
let lastStats: InterferenceStats = { pairs: 0, culled: 0, exact: 0, reused: 0, undetermined: 0 };

function localBox(key: string, body: Shape): [Vec3, Vec3] {
  let b = boxCache.get(key);
  if (!b) {
    const bb = body.boundingBox;
    b = bb.bounds as [Vec3, Vec3];
    bb.delete();
    if (boxCache.size >= BOX_MAX) boxCache.delete(boxCache.keys().next().value!);
    boxCache.set(key, b);
  }
  return b;
}

/**
 * Objem průniku A ∩ B s B převedeným do souřadnic A (`m` = zaokrouhlená A⁻¹·B z `relOf`). Výsledek závisí jen na dílech a klíči
 * vzájemné polohy, proto ho plná i přírůstková kontrola počítají stejně. Booleovská operace nemění vstupy (díl A je těleso z mezipaměti), všechny objekty OCCT
 * se hned mažou (replicad `intersect` nechává `BRepAlgoAPI_Common` na úklid GC, nevolá Clear() a staví průnik dvakrát – konstruktor
 * se dvěma tělesy už staví a pak ještě Build()).
 */
function pairVolume(a: Shape, b: Shape, m: number[]): number {
  const oc = r.getOC() as Oc;
  const rel = new oc.gp_Trsf();
  rel.SetValues(m[0], m[1], m[2], m[9], m[3], m[4], m[5], m[10], m[6], m[7], m[8], m[11]);
  rel.SetScaleFactor(1); // zaokrouhlená matice → OCCT ji ortogonalizuje; měřítko přesně 1 (tuhá transformace)
  // B jen s polohou (TopLoc_Location), bez kopie geometrie: kopie přes BRepBuilderAPI_Transform nechává po delete() v haldě
  // ~50–80 kB na kopii (sonda: 1000 kopií šroubu M10 → +84 MB), poloha nic nealokuje
  const loc = new oc.TopLoc_Location(rel);
  const moved = b.wrapped.Moved(loc, false);
  loc.delete();
  rel.delete();
  const args = new oc.NCollection_List_TopoDS_Shape();
  const tools = new oc.NCollection_List_TopoDS_Shape();
  const op = new oc.BRepAlgoAPI_Common();
  try {
    args.Append(a.wrapped);
    tools.Append(moved);
    op.SetArguments(args);
    op.SetTools(tools);
    op.SetNonDestructive(true);
    op.Build();
    if (op.HasErrors() || !op.IsDone()) return NaN;
    const res = op.Shape();
    const props = new oc.GProp_GProps();
    try {
      oc.BRepGProp.VolumeProperties(res, props, false, false, false);
      return props.Mass() as number;
    } finally {
      props.delete();
      res.delete();
    }
  } catch {
    return NaN;
  } finally {
    // Clear() uvolní data průniku (PaveFiller, DS, historie): samotné delete() z vazby WASM je neuvolní – bez Clear() roste halda
    // o ~0,6–1 MB na každý přesný průnik (P7; ověřeno sondou: 200× Common + delete → +139 MB, s Clear() → +0 MB)
    op.Clear();
    op.delete();
    tools.delete();
    args.delete();
    moved.delete();
  }
}

/**
 * Kontrola kolizí listových dílů (i uvnitř podsestav), přírůstkově: světové obálky analyticky z lokální obálky dílu (bez kopií
 * těles), síto obálek, přesný průnik jen pro dvojici (díl A, díl B, vzájemná poloha zaokrouhlená na 1e-7), která ještě nebyla
 * spočtená – opakovaná `kolize` a kroky pohybu s tuhými skupinami tak počítají jen dvojice, jejichž vzájemná poloha se změnila.
 * `full` = bez mezipaměti (kontrolní plný výpočet, stejný algoritmus). Výsledek nese `stats` (počty dvojic).
 */
export async function interference(doc: CadDoc, tolerance = 1e-3, opts: { full?: boolean } = {}): Promise<Interference[] & { stats: InterferenceStats }> {
  const st: InterferenceStats = { pairs: 0, culled: 0, exact: 0, reused: 0, undetermined: 0 };
  const items: { key: string; path: string[]; body: Shape; m: Rt; box: [Vec3, Vec3] }[] = [];
  // vlastní odkaz na tělesa dílů po dobu kontroly: LRU mezipaměti dílů (400) by je jinak mohla smazat uprostřed
  const held = new Map<string, Shape>();
  const out = [] as unknown as Interference[] & { stats: InterferenceStats };
  try {
    for (const f of flattenAssembly(doc)) {
      if (f.hidden) continue;
      let body = held.get(f.key);
      if (!body) {
        const e = await partEntry(f.key, f.comp.source);
        if (!e.body) continue;
        body = e.body.clone() as Shape;
        held.set(f.key, body);
      }
      const m = rtOf(f.placement);
      items.push({ key: f.key, path: f.path, body, m, box: worldBox(localBox(f.key, body), m) });
    }
    const EPS = 1e-6;
    for (let i = 0; i < items.length; i++)
      for (let j = i + 1; j < items.length; j++) {
        st.pairs++;
        const [a0, a1] = items[i].box;
        const [b0, b1] = items[j].box;
        if (a1[0] + EPS < b0[0] || b1[0] + EPS < a0[0] || a1[1] + EPS < b0[1] || b1[1] + EPS < a0[1] || a1[2] + EPS < b0[2] || b1[2] + EPS < a0[2]) {
          st.culled++;
          continue;
        }
        const rel = relOf(items[i].m, items[j].m);
        const key = `${items[i].key}|${items[j].key}|${rel.key}`;
        let v = opts.full ? undefined : pairCache.get(key);
        if (v === undefined) {
          v = pairVolume(items[i].body, items[j].body, rel.m);
          st.exact++;
          if (pairCache.size >= PAIR_MAX) pairCache.delete(pairCache.keys().next().value!);
          pairCache.set(key, v);
        } else st.reused++;
        if (Number.isNaN(v)) st.undetermined++;
        else if (v > tolerance) out.push({ a: items[i].path[0], b: items[j].path[0], volume: v, aPath: items[i].path, bPath: items[j].path });
      }
  } finally {
    for (const b of held.values()) b.delete();
  }
  lastStats = st;
  out.stats = st;
  return out;
}

/** Počty poslední kontroly kolizí (in-process volající; přes worker nesou počty pole výsledku `stats`). */
export const interferenceStats = (): InterferenceStats => ({ ...lastStats });
/** Vyprázdní mezipaměť dvojic a obálek (testy; po restartu jádra je modul nový). */
export function clearInterferenceCache(): void {
  pairCache.clear();
  boxCache.clear();
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
