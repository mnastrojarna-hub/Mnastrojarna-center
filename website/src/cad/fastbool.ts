/**
 * Rychlejší booleovské operace (odebrat / sjednotit / průnik) – náhrada metod `cut`, `fuse`, `intersect` replicadu.
 *
 * 1. replicad staví každou operaci DVAKRÁT: konstruktor `BRepAlgoAPI_Cut(a, b)` ji v jádře rovnou spočítá a replicad pak
 *    volá `Build()` znovu. Tady se operace zadá seznamem těles a spočítá jednou (poloviční čas u všech prvků).
 * 2. Jádro vybírá dvojice ploch k průsečíku podle obálek ploch. U toroidních ploch (rotace oblouku, zaoblení) je obálka bez
 *    sítě hrubý odhad přes celý prstenec i výšku – nástroj se pak zkouší proti stovkám ploch, kterých se nedotýká (oběžné kolo:
 *    4 s na jednu díru). Když má těleso síť, bere jádro obálky z ní a jsou těsné. Větší tělesa se proto před operací zasíťují
 *    (síť zůstává na nezměněných plochách i ve výsledku, takže se počítá jen pro nové plochy a využije ji i zobrazení).
 */
import * as r from "replicad";
import { setSizeHint, sizeOf } from "./fastbox";

type Shape = r.Shape3D;
type BoolOpts = { optimisation?: "none" | "commonFace" | "sameFace"; simplify?: boolean };
type OC = any;

/** od kolika ploch se těleso před operací síťuje (malá tělesa problém s obálkami nemají) */
const PREMESH_MIN_FACES = 24;

function atLeastFaces(oc: OC, wrapped: unknown, n: number): boolean {
  const en = oc.TopAbs_ShapeEnum;
  const ex = new oc.TopExp_Explorer(wrapped, en.TopAbs_FACE, en.TopAbs_SHAPE);
  let k = 0;
  try {
    while (ex.More() && k < n) {
      k++;
      ex.Next();
    }
  } finally {
    ex.delete();
  }
  return k >= n;
}

/** jemnost sítě podle velikosti tělesa – stejné pravidlo jako pro zobrazení (build.ts, shapeResult), aby se síť počítala jen jednou */
export const meshTolerance = (diag: number) => Math.max(0.01, (diag || 100) / 2000);
export const MESH_ANGULAR = 0.2;

/** Zasíťuje těleso (jen plochy, které síť ještě nemají) – kvůli těsným obálkám ploch v booleovské operaci. */
export function premesh(shape: Shape) {
  const oc: OC = r.getOC();
  try {
    if (!atLeastFaces(oc, shape.wrapped, PREMESH_MIN_FACES)) return;
    const m = new oc.BRepMesh_IncrementalMesh(shape.wrapped, meshTolerance(sizeOf(shape)), false, MESH_ANGULAR, false);
    m.delete();
  } catch {
    /* síť je jen urychlení – operace proběhne i bez ní */
  }
}

function run(kind: "Cut" | "Fuse" | "Common", a: Shape, b: Shape | Shape[], { optimisation = "none", simplify = true }: BoolOpts = {}): Shape {
  const oc: OC = r.getOC();
  const list = Array.isArray(b) ? b : [b];
  premesh(a);
  for (const t of list) premesh(t);
  const builder = new oc[`BRepAlgoAPI_${kind}`]();
  const args = new oc.NCollection_List_TopoDS_Shape();
  const tools = new oc.NCollection_List_TopoDS_Shape();
  try {
    args.Append(a.wrapped);
    for (const t of list) tools.Append(t.wrapped);
    builder.SetArguments(args);
    builder.SetTools(tools);
    if (kind !== "Common") {
      if (optimisation === "commonFace") builder.SetGlue(oc.BOPAlgo_GlueEnum.BOPAlgo_GlueShift);
      if (optimisation === "sameFace") builder.SetGlue(oc.BOPAlgo_GlueEnum.BOPAlgo_GlueFull);
    }
    builder.Build();
    if (simplify) builder.SimplifyResult(true, true, 0.001);
    const out = r.cast(builder.Shape()) as unknown as Shape;
    if (!(out instanceof (r as unknown as { _3DShape: new () => unknown })._3DShape)) throw new Error(kind === "Cut" ? "Could not cut as a 3d shape" : kind === "Fuse" ? "Could not fuse as a 3d shape" : "Could not intersect as a 3d shape");
    // výsledek odebrání / průniku není větší než původní těleso → další operace nemusí velikost počítat znovu
    if (kind !== "Fuse") setSizeHint(out, sizeOf(a));
    return out;
  } finally {
    builder.delete();
    args.delete();
    tools.delete();
  }
}

/**
 * Odebere / přidá více nástrojů JEDNOU operací (kruhové pole děr, drážky). Nástroje se mohou navzájem překrývat – jádro je bere
 * jako samostatná tělesa, takže výsledek má stejné plochy i hrany jako postupné operace, jen bez opakovaného průchodu celým tělesem.
 */
export function cutAll(body: Shape, tools: Shape[], opts?: BoolOpts): Shape {
  return run("Cut", body, tools, opts);
}
export function fuseAll(body: Shape, tools: Shape[], opts?: BoolOpts): Shape {
  return run("Fuse", body, tools, opts);
}

let installed = false;
/** Nahradí booleovské metody těles replicadu (jednou pro celé jádro). */
export function installFastBooleans() {
  if (installed) return;
  installed = true;
  const proto = (r as unknown as { _3DShape: { prototype: Record<string, unknown> } })._3DShape.prototype;
  proto.cut = function (this: Shape, tool: Shape, options?: BoolOpts) {
    return run("Cut", this, tool, options);
  };
  proto.fuse = function (this: Shape, other: Shape, options?: BoolOpts) {
    return run("Fuse", this, other, options);
  };
  proto.intersect = function (this: Shape, tool: Shape, options?: BoolOpts) {
    return run("Common", this, tool, options);
  };
}
installFastBooleans();
