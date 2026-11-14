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

/** s jakou jemností už těleso síť má (tvary se po vzniku nemění) – opakovaný průchod všemi plochami se pak vynechá */
const meshedAt = new WeakMap<object, number>();
/** Zasíťuje těleso stejně jako zobrazení (jen plochy, které síť ještě nemají). */
export function meshShape(shape: Shape) {
  const oc: OC = r.getOC();
  const tolerance = meshTolerance(sizeOf(shape));
  if (meshedAt.get(shape) === tolerance) return;
  const m = new oc.BRepMesh_IncrementalMesh(shape.wrapped, tolerance, false, MESH_ANGULAR, false);
  m.delete();
  meshedAt.set(shape, tolerance);
}
/**
 * Má každá plocha tělesa síť a každá hrana lomenou čáru? Po průchodu sítě to neplatí jen u vadných ploch (sebeprotínající
 * obrys) – zobrazení je pak zkusí zasíťovat znovu jinou cestou a teprve po tomto druhém průchodu je stav tělesa konečný.
 */
export function meshComplete(shape: Shape): boolean {
  const oc: OC = r.getOC();
  try {
    return !!oc.BRepTools.Triangulation(shape.wrapped, 1e9, false);
  } catch {
    return true;
  }
}
/** Další průchod sítě týmž nastavením (to, co s tělesem udělá zobrazení): doplní plochy, které v prvním průchodu síť nedostaly. */
export function remeshShape(shape: Shape) {
  const oc: OC = r.getOC();
  const m = new oc.BRepMesh_IncrementalMesh(shape.wrapped, meshTolerance(sizeOf(shape)), false, MESH_ANGULAR, false);
  m.delete();
}

/** Zasíťuje těleso (jen plochy, které síť ještě nemají) – kvůli těsným obálkám ploch v booleovské operaci. */
export function premesh(shape: Shape) {
  const oc: OC = r.getOC();
  try {
    if (!atLeastFaces(oc, shape.wrapped, PREMESH_MIN_FACES)) return;
    meshShape(shape);
  } catch {
    /* síť je jen urychlení – operace proběhne i bez ní */
  }
}

/**
 * Tolerance modelu (mm) pro OPAKOVANOU booleovskou operaci: 1e-7 × úhlopříčka, nejméně 1e-5 a nejvýš 1e-4 mm. Jádro samo
 * počítá přesně (1e-7 mm) a tak běží každá operace napoprvé – stejně jako dřív. Tolerance se použije, až když přesný výsledek
 * nese příznak vady (shape-health.ts): souřadnice zadané na 5–6 desetinných míst a směrové vektory rovin na 6 míst se od
 * „stejné“ plochy tělesa liší o 1e-5 mm i víc a u tečných a souběžných ploch z toho vznikají zbytky, vrcholy s tolerancí
 * tisíckrát větší nebo se operace neprovede vůbec (střižnice se zadním odlehčením: klín tečný ke kuželu).
 *
 * Proč ne tolerance u každé operace: plochy bližší než tolerance jádro spojí, i když totožné být nemají. Dvě díry, které se
 * překrývají o 1e-5 mm, se protínají ve dvou přímkách 0,014 mm od sebe – s tolerancí z nich je jedna hrana s tolerancí
 * vrcholu 0,007 mm, neplatné těleso a síť, která se počítá minuty. Kanál, který prorazí plochu o 1e-5 mm, se uzavře (chybí
 * 2,4 mm³ a export STEP dá dvě tělesa). Ramena zkrutné pružiny se s tolerancí nespojí se závity.
 */
export const baseFuzzy = (size: number) => Math.min(1e-4, Math.max(1e-5, (size || 100) * 1e-7));
const exact = () => 0;
let tolerance: (size: number) => number = exact;
/**
 * Pravidlo tolerance PRVNÍHO pokusu každé operace (mm); výchozí je 0 = přesné jádro. Jen pro měření a testy (např. `baseFuzzy`
 * = tolerance u každé operace); `null` vrátí výchozí. Vrací předchozí pravidlo.
 */
export function setBooleanTolerance(rule: ((size: number) => number) | null): (size: number) => number {
  const before = tolerance;
  tolerance = rule ?? exact;
  return before;
}

/** druh booleovské operace */
export type BoolKind = "Cut" | "Fuse" | "Common";
/**
 * Kontrola výsledku každé operace (shape-health.ts): dostane výsledek (`null`, když přesná operace skončila chybou jádra)
 * a operaci (druh, původní těleso, nástroje a funkci, která ji zopakuje s tolerancí v mm) a vrátí těleso, které se použije
 * (`null` = náhrada za neúspěšnou operaci není, chyba platí). Bez registrace se výsledek bere tak, jak je.
 */
type BooleanGuard = (out: Shape | null, op: { kind: BoolKind; a: Shape; tools: Shape[]; redo: (fuzzy: number) => Shape }) => Shape | null;
let guard: BooleanGuard | null = null;
export function setBooleanGuard(g: BooleanGuard | null): BooleanGuard | null {
  const before = guard;
  guard = g;
  return before;
}

function run(kind: BoolKind, a: Shape, b: Shape | Shape[], opts?: BoolOpts): Shape {
  const op = { kind, a, tools: Array.isArray(b) ? b : [b], redo: (fuzzy: number) => runOnce(kind, a, b, opts, fuzzy) };
  let out: Shape;
  try {
    out = runOnce(kind, a, b, opts, tolerance(sizeOf(a)));
  } catch (e) {
    const rescued = guard ? guard(null, op) : null;
    if (!rescued) throw e;
    return rescued;
  }
  return (guard ? guard(out, op) : null) ?? out;
}

/** Jedna operace bez kontroly výsledku (ověřovací průnik tělesa s nástroji v shape-health.ts); `fuzzy` = tolerance v mm, 0 = přesně. */
export function booleanOnce(kind: BoolKind, a: Shape, tools: Shape[], fuzzy = 0): Shape {
  return runOnce(kind, a, tools, { simplify: false }, fuzzy);
}

function runOnce(kind: BoolKind, a: Shape, b: Shape | Shape[], { optimisation = "none", simplify = true }: BoolOpts = {}, fuzzy = 0): Shape {
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
    // tolerance jen u opakované operace: plochy a hrany bližší než tato hodnota se berou jako totožné
    if (fuzzy > 0) builder.SetFuzzyValue(fuzzy);
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
