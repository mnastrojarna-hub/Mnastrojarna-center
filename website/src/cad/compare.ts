/**
 * Porovnání modelu s referenčním modelem (STEP / BREP / STL – typicky model zákazníka k výkresu, podle kterého díl vznikl).
 *
 * Výsledek:
 *  – objemy obou těles a jejich rozdíl,
 *  – dva jednostranné rozdíly: „navíc“ = model − reference (v modelu je materiál, který reference nemá – chybějící drážka,
 *    díra, kapsa) a „chybí“ = reference − model (v modelu materiál chybí – chybějící výstupek, příliš velké vybrání),
 *  – seznam souvislých rozdílových těles (objem, obalový kvádr, střed, charakteristické plochy) seřazený podle objemu;
 *    drobné slupky pod prahem se sečtou jako numerický šum,
 *  – mapa odchylek: vzdálenost bodů povrchu modelu od povrchu reference (se znaménkem: + vně reference, − uvnitř).
 *
 * Booleovské operace běží v jádře (`cut` – rychlé verze z fastbool.ts). Vzdálenosti se NEPOČÍTAJÍ nástrojem jádra bod po bodu
 * (milisekundy na bod): reference i model se zasíťují jemněji než pro zobrazení a nejbližší bod sítě reference se hledá
 * v JavaScriptu stromem obalových kvádrů (mesh-distance.ts, jednotky mikrosekund na bod). Přesnost mapy je tím omezená
 * tolerancí sítě (vrací se ve výsledku a ukazuje v UI); rovinné plochy modelu se pro mapu zjemní, jinak by měly body jen na obvodu.
 *
 * Umístění reference: „jak je“, středy obalových kvádrů na sebe, nebo levné automatické hledání (poloha „jak je“ + 24 otočení
 * o násobky 90°); k tomu ruční otočení po 90° a posun. Obecné nejlepší proložení (šikmá poloha) se nedělá.
 */
import * as r from "replicad";
import { tr } from "./i18n";
import { deepCopy, meshArrays, shapeResult } from "./build";
import { checkShape } from "./check";
import { MESH_ANGULAR, meshTolerance } from "./fastbool";
import { importBREP, importSTLBody } from "./formats/kernel-import";
import {
  bestRightAngleFit,
  boxDiag,
  buildTriIndex,
  distanceStats,
  distancesToMesh,
  placementFor,
  refineMesh,
  samplePoints,
  type AlignMode,
  type Box,
  type DistanceStats,
  type Placement3,
} from "./mesh-distance";
import type { KernelImportFormat, MeshData, Vec3 } from "./types";

type Shape = r.Shape3D;
type OC = any;

export type CompareAlign = {
  /** „none“ = reference jak je · „center“ = středy obalových kvádrů na sebe · „auto“ = poloha jak je, nebo nejlepší z 24 otočení po 90° */
  mode: AlignMode;
  /** ruční otočení reference kolem os X, Y, Z (°, násobky 90, v tomto pořadí kolem počátku); v režimu „auto“ se nepoužije */
  rotate?: Vec3;
  /** ruční posun reference (mm) – přičte se nakonec, ve všech režimech */
  offset?: Vec3;
};

export type CompareOptions = {
  align?: CompareAlign;
  /** tolerance odchylky (mm) – statistika mapy a volba jemnosti sítě; výchozí 0,1 */
  tolerance?: number;
  /** rozdílová tělesa s menším objemem (mm³) se počítají jako numerický šum; výchozí 1 */
  noiseVolume?: number;
  /** slupky se střední tloušťkou 2·V/S pod touto hodnotou (mm) se počítají jako numerický šum; výchozí 0,01 */
  noiseThickness?: number;
  /** tolerance sítě pro mapu odchylek (mm); výchozí tolerance / 4 v mezích ⟨úhlopříčka / 100 000; síť pro zobrazení⟩ */
  meshTolerance?: number;
  /** největší délka hrany sítě modelu pro mapu (mm); výchozí úhlopříčka / 150 (při překročení stropu trojúhelníků se zvětší) */
  step?: number;
  /** strop počtu trojúhelníků sítě modelu pro mapu; výchozí 400 000 */
  maxTriangles?: number;
  /** počítat mapu odchylek (výchozí ano) */
  map?: boolean;
  /** rozdílová tělesa: „auto“ = vynechat u reference s velmi mnoha plochami (síťový model), „always“, „never“ */
  booleans?: "auto" | "always" | "never";
  /** od kolika ploch reference se v režimu „auto“ rozdílová tělesa nepočítají; výchozí 4000 */
  maxBooleanFaces?: number;
  /** nejvýš tolik oblastí se vrací jednotlivě (ostatní jen v součtu); výchozí 400 */
  maxRegions?: number;
  /** pro kolik největších oblastí se vrací síť ke zvýraznění; výchozí 60 */
  regionMeshes?: number;
  /** vrátit síť reference pro průhledné zobrazení (výchozí ano) */
  ghost?: boolean;
};

/** krok výpočtu pro ukazatel průběhu */
export type CompareStep = { index: number; total: number; name: string };

export type TriMeshData = { vertices: Float32Array; normals: Float32Array; triangles: Uint32Array };

/** charakteristická plocha rozdílového tělesa: válec (r), koule (r), anuloid (R = hlavní, r = vedlejší poloměr), kužel, rovina */
export type SurfaceHint = { kind: "plane" | "cylinder" | "cone" | "sphere" | "torus" | "other"; r?: number; R?: number; n: number };

export type DiffRegion = {
  /** „extra“ = materiál navíc v modelu (model − reference) · „missing“ = materiál v modelu chybí (reference − model) */
  side: "extra" | "missing";
  /** mm³ */
  volume: number;
  /** mm² */
  area: number;
  bbox: [Vec3, Vec3];
  size: Vec3;
  /** střed obalového kvádru */
  center: Vec3;
  /** těžiště (u prstence leží mimo materiál – na ose) */
  centroid: Vec3 | null;
  faces: number;
  surfaces: SurfaceHint[];
  /** síť ke zvýraznění (jen největší oblasti) */
  mesh?: TriMeshData;
};

export type DiffSide = {
  /** celkový objem rozdílu včetně šumu (mm³) */
  volume: number;
  /** oblasti nad prahem šumu, od největší */
  regions: DiffRegion[];
  /** oblasti nad limit seznamu (jen součet) */
  more: { count: number; volume: number };
  /** numerický šum: drobná tělesa a tenké slupky */
  noise: { count: number; volume: number };
  ms: number;
};

export type CompareMap = {
  /** síť modelu pro mapu (jemnější než zobrazovací, rovinné plochy zjemněné) – stejné indexy ploch a hran jako model */
  mesh: MeshData;
  /** vzdálenost každého vrcholu `mesh` od povrchu reference (mm): + vně reference (materiál navíc), − uvnitř (materiál chybí) */
  distances: Float32Array;
  stats: DistanceStats;
  /** tolerance sítí (mm), ze kterých se vzdálenost počítala */
  meshTolerance: number;
  /** odhad chyby vzdálenosti (mm): síť reference + síť modelu */
  accuracy: number;
  /** použitá největší délka hrany sítě modelu (mm); Infinity = bez zjemnění */
  step: number;
  /** síť modelu je nad stropem počtu trojúhelníků a nešla zjemnit rovnoměrně (uprostřed velkých rovinných ploch mohou body chybět) */
  capped: boolean;
  refTriangles: number;
};

export type CompareResult = {
  model: { volume: number; area: number; bbox: [Vec3, Vec3]; faces: number; solids: number };
  /** reference po umístění */
  reference: { volume: number; area: number; bbox: [Vec3, Vec3]; faces: number; solids: number; valid?: boolean; format: KernelImportFormat; fileName: string };
  /** použité umístění reference: p′ = M·p + t (M po řádcích); u režimu „auto“ i skóre poloh */
  transform: Placement3 & { mode: AlignMode; identity: boolean; score?: number; asIsScore?: number; tried?: number };
  /** objem modelu − objem reference (mm³) */
  volumeDiff: number;
  /** model − reference (materiál navíc v modelu); null = nespočítáno (viz `warnings`) */
  extra: DiffSide | null;
  /** reference − model (materiál v modelu chybí) */
  missing: DiffSide | null;
  /** důvod, proč se rozdílová tělesa nepočítala: příliš mnoho ploch reference (lze vynutit `booleans: "always"`) */
  booleansSkipped?: "faces" | "off";
  /** kontrola booleovských operací: (model − navíc) − (reference − chybí), obě strany jsou objem společné části (mm³) */
  residual: number | null;
  map: CompareMap | null;
  /** síť reference pro průhledné zobrazení */
  ghost: TriMeshData | null;
  warnings: string[];
  ms: { import: number; align: number; reference: number; booleans: number; map: number; total: number };
};

export type ReferenceFile = { data: ArrayBuffer | Uint8Array; format: KernelImportFormat; fileName: string };

const V = (p: ArrayLike<number>): Vec3 => [p[0], p[1], p[2]];
const boundsOf = (s: Shape): [Vec3, Vec3] => {
  const b = s.boundingBox.bounds;
  return [V(b[0]), V(b[1])];
};
const del = (o: unknown) => {
  try {
    (o as { delete?: () => void } | null)?.delete?.();
  } catch {
    /* už uvolněno */
  }
};
const errText = (e: unknown) => (e instanceof Error && e.message && !/^\d+$/.test(e.message) ? e.message : tr("chyba geometrického jádra"));

// ── načtení reference ──────────────────────────────────────────────────────────────────────────────────────────

/** poslední načtená reference – opakované porovnání (jiné zarovnání, tolerance) soubor nečte znovu */
let refCache: { key: string; shape: Shape } | null = null;
export function clearCompareCache() {
  del(refCache?.shape);
  refCache = null;
}

function bytesKey(bytes: Uint8Array, format: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < bytes.length; i++) h = Math.imul(h ^ bytes[i], 0x01000193);
  return `${format}:${bytes.length}:${h >>> 0}`;
}

/** Soubor reference → těleso jádra (STEP, BREP, STL). Musí obsahovat objemové těleso. */
export async function importReference(file: ReferenceFile): Promise<Shape> {
  const bytes = file.data instanceof Uint8Array ? file.data : new Uint8Array(file.data);
  const key = bytesKey(bytes, file.format);
  if (refCache?.key === key) return refCache.shape;
  let shape: r.AnyShape;
  switch (file.format) {
    case "step":
      try {
        shape = await r.importSTEP(new Blob([bytes as BlobPart]));
      } catch {
        throw new Error(tr("Referenční soubor STEP se nepodařilo načíst."));
      }
      break;
    case "brep":
      shape = importBREP(new TextDecoder().decode(bytes));
      break;
    case "stl":
      shape = importSTLBody(bytes);
      break;
    default:
      throw new Error(tr("Formát {0} nelze použít jako referenci – použijte STEP, BREP nebo síťový model.", String(file.format).toUpperCase()));
  }
  if (!shape || (shape as { isNull?: boolean }).isNull || !(shape instanceof r._3DShape)) {
    del(shape);
    throw new Error(tr("Referenční model neobsahuje 3D těleso."));
  }
  const s = shape as Shape;
  let vol = 0;
  try {
    vol = Math.abs(r.measureVolume(s));
  } catch {
    vol = 0;
  }
  if (!(vol > 1e-9)) {
    del(s);
    throw new Error(tr("Referenční model neobsahuje objemové těleso (jen plochy) – objemy ani rozdíly nelze spočítat."));
  }
  clearCompareCache();
  refCache = { key, shape: s };
  return s;
}

// ── umístění ───────────────────────────────────────────────────────────────────────────────────────────────────

/** Kopie tvaru přesunutá podle umístění (otočení kolem X, Y, Z v tomto pořadí kolem počátku, potom posun). Původní tvar zůstává. */
export function placeShape(shape: Shape, p: Pick<Placement3, "rot" | "t">): Shape {
  let s = shape.clone() as Shape; // transformace replicadu vstupní tvar uvolňují – pracuje se s dalším odkazem
  if (p.rot[0]) s = s.rotate(p.rot[0], [0, 0, 0], [1, 0, 0]) as Shape;
  if (p.rot[1]) s = s.rotate(p.rot[1], [0, 0, 0], [0, 1, 0]) as Shape;
  if (p.rot[2]) s = s.rotate(p.rot[2], [0, 0, 0], [0, 0, 1]) as Shape;
  if (p.t.some((v) => Math.abs(v) > 1e-12)) s = s.translate(p.t) as Shape;
  return s;
}

// ── rozdílová tělesa ───────────────────────────────────────────────────────────────────────────────────────────

const round = (v: number | undefined) => (v == null ? "" : String(Math.round(v * 1000) / 1000));

/** Charakteristické plochy tělesa (válce, koule, anuloidy s poloměry; počty rovin a ostatních). */
function surfaceHints(solid: Shape, limit = 300): { hints: SurfaceHint[]; faces: number } {
  const oc: OC = r.getOC();
  const faces = solid.faces;
  const map = new Map<string, SurfaceHint>();
  faces.forEach((f, i) => {
    if (i < limit) {
      const type = f.geomType as string;
      let h: SurfaceHint = { kind: "other", n: 1 };
      if (type === "PLANE") h = { kind: "plane", n: 1 };
      else if (type === "CYLINDRE" || type === "SPHERE" || type === "TORUS" || type === "CONE") {
        let ad: any = null;
        try {
          ad = new oc.BRepAdaptor_Surface(f.wrapped, true);
          if (type === "CYLINDRE") {
            const g = ad.Cylinder();
            h = { kind: "cylinder", r: g.Radius(), n: 1 };
            del(g);
          } else if (type === "SPHERE") {
            const g = ad.Sphere();
            h = { kind: "sphere", r: g.Radius(), n: 1 };
            del(g);
          } else if (type === "TORUS") {
            // gp_Torus není v této sestavě jádra dostupný → poloměry ze tří bodů plochy:
            // P(u, v) = C + (R + r·cos v)(cos u·X + sin u·Y) + r·sin v·A
            const pnt = new oc.gp_Pnt();
            try {
              const P = (u: number, v: number): Vec3 => {
                ad.D0(u, v, pnt);
                return [pnt.X(), pnt.Y(), pnt.Z()];
              };
              const a = P(0, 0);
              const b = P(Math.PI, 0);
              const c = P(0, Math.PI);
              const C: Vec3 = [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2, (a[2] + b[2]) / 2];
              const outer = Math.hypot(a[0] - C[0], a[1] - C[1], a[2] - C[2]); // R + r
              const inner = outer > 1e-12 ? ((c[0] - C[0]) * (a[0] - C[0]) + (c[1] - C[1]) * (a[1] - C[1]) + (c[2] - C[2]) * (a[2] - C[2])) / outer : 0; // R − r
              h = { kind: "torus", R: (outer + inner) / 2, r: (outer - inner) / 2, n: 1 };
            } finally {
              del(pnt);
            }
          } else h = { kind: "cone", n: 1 };
        } catch {
          h = { kind: type === "CYLINDRE" ? "cylinder" : type === "SPHERE" ? "sphere" : type === "TORUS" ? "torus" : "cone", n: 1 };
        } finally {
          del(ad);
        }
      }
      const key = `${h.kind}|${round(h.r)}|${round(h.R)}`;
      const hit = map.get(key);
      if (hit) hit.n++;
      else map.set(key, h);
    }
    del(f);
  });
  const order = { torus: 0, cylinder: 1, sphere: 2, cone: 3, other: 4, plane: 5 } as const;
  const hints = [...map.values()].sort((a, b) => order[a.kind] - order[b.kind] || b.n - a.n || (a.r ?? 0) - (b.r ?? 0));
  return { hints, faces: faces.length };
}

function meshOfSolid(solid: Shape, tolerance: number): TriMeshData | undefined {
  try {
    const m = meshArrays(solid, tolerance, MESH_ANGULAR);
    return m.triangles.length ? { vertices: m.vertices, normals: m.normals, triangles: m.triangles } : undefined;
  } catch {
    return undefined;
  }
}

type SideOpts = { noiseVolume: number; noiseThickness: number; maxRegions: number; regionMeshes: number; displayTol: number };

/** Rozdílové těleso → souvislé oblasti seřazené podle objemu; drobná tělesa a tenké slupky do šumu. */
function sideOf(diff: Shape, side: DiffRegion["side"], o: SideOpts, t0: number): DiffSide {
  const solids = ((diff as unknown as { solids?: Shape[] }).solids ?? []) as Shape[];
  const items = solids.map((s) => {
    let volume = 0;
    let area = 0;
    try {
      volume = Math.abs(r.measureVolume(s));
      area = r.measureArea(s);
    } catch {
      /* neměřitelné těleso → šum */
    }
    return { s, volume, area };
  });
  items.sort((a, b) => b.volume - a.volume);
  const out: DiffSide = { volume: 0, regions: [], more: { count: 0, volume: 0 }, noise: { count: 0, volume: 0 }, ms: 0 };
  for (const it of items) {
    out.volume += it.volume;
    const thin = it.area > 0 ? (2 * it.volume) / it.area : 0;
    if (!(it.volume >= o.noiseVolume) || !(thin >= o.noiseThickness)) {
      out.noise.count++;
      out.noise.volume += it.volume;
    } else if (out.regions.length >= o.maxRegions) {
      out.more.count++;
      out.more.volume += it.volume;
    } else {
      const bbox = boundsOf(it.s);
      const { hints, faces } = surfaceHints(it.s);
      let centroid: Vec3 | null = null;
      try {
        centroid = V(r.measureShapeVolumeProperties(it.s).centerOfMass as unknown as number[]);
      } catch {
        centroid = null;
      }
      out.regions.push({
        side,
        volume: it.volume,
        area: it.area,
        bbox,
        size: [bbox[1][0] - bbox[0][0], bbox[1][1] - bbox[0][1], bbox[1][2] - bbox[0][2]],
        center: [(bbox[0][0] + bbox[1][0]) / 2, (bbox[0][1] + bbox[1][1]) / 2, (bbox[0][2] + bbox[1][2]) / 2],
        centroid,
        faces,
        surfaces: hints,
        mesh: out.regions.length < o.regionMeshes ? meshOfSolid(it.s, o.displayTol) : undefined,
      });
    }
    del(it.s);
  }
  out.ms = Date.now() - t0;
  return out;
}

// ── mapa odchylek ──────────────────────────────────────────────────────────────────────────────────────────────

/** skupiny sítě [začátek, počet, otisk] → [začátek, počet, index plochy / hrany] (stejně jako shapeResult v build.ts) */
function indexGroups(shape: Shape, faceGroups: Int32Array, edgeGroups: Int32Array) {
  const faces = shape.faces;
  const edges = shape.edges;
  const fi = new Map(faces.map((f, i) => [f.hashCode, i]));
  const ei = new Map(edges.map((e, i) => [e.hashCode, i]));
  for (let i = 2; i < faceGroups.length; i += 3) faceGroups[i] = fi.get(faceGroups[i]) ?? -1;
  for (let i = 2; i < edgeGroups.length; i += 3) edgeGroups[i] = ei.get(edgeGroups[i]) ?? -1;
  faces.forEach(del);
  edges.forEach(del);
}

/** Tolerance sítě pro mapu: čtvrtina tolerance odchylky, nejvýš síť pro zobrazení, nejméně úhlopříčka / 100 000 (≥ 1 µm). */
export function mapMeshTolerance(diag: number, tolerance: number, wanted?: number): number {
  const lower = Math.max(0.001, diag / 100_000);
  return Math.min(meshTolerance(diag), Math.max(lower, wanted ?? tolerance / 4));
}

/**
 * Mapa odchylek: vzdálenost bodů povrchu modelu od povrchu reference. Obě tělesa se síťují na kopiích (jemná síť by jinak
 * zůstala na tělese v mezipaměti stavby a zpomalila zobrazení).
 */
export function distanceMap(model: Shape, ref: Shape, o: { tolerance: number; meshTolerance?: number; step?: number; maxTriangles?: number; onDistances?: () => void }): CompareMap {
  const diag = boxDiag(boundsOf(model) as Box) || 100;
  const tol = mapMeshTolerance(diag, o.tolerance, o.meshTolerance);
  const mc = deepCopy(model);
  let mm: ReturnType<typeof meshArrays>;
  try {
    mm = meshArrays(mc, tol, MESH_ANGULAR);
    indexGroups(mc, mm.faceGroups, mm.edgeGroups);
  } finally {
    del(mc);
  }
  const budget = o.maxTriangles ?? 400_000;
  let step = o.step ?? Math.max(diag / 150, tol * 8);
  let refined: ReturnType<typeof refineMesh> = { vertices: mm.vertices, normals: mm.normals, triangles: mm.triangles, faceGroups: mm.faceGroups, capped: true };
  if (mm.triangles.length / 3 >= budget) step = Infinity; // síť je už teď nad limitem – bez zjemnění
  else {
    // půlení dlouhých úzkých trojúhelníků (válce, kužely) dává víc trojúhelníků, než odpovídá ploše – při překročení limitu
    // se zkusí hrubší krok (nedokončené zjemnění by nechalo část ploch bez bodů uvnitř)
    for (let k = 0; ; k++) {
      refined = refineMesh(mm, step, budget);
      if (!refined.capped || k >= 14) break;
      step *= 1.35;
    }
  }
  const capped = refined.capped;
  const rc = deepCopy(ref);
  let rm: ReturnType<typeof meshArrays>;
  try {
    rm = meshArrays(rc, tol, MESH_ANGULAR);
  } finally {
    del(rc);
  }
  const ix = buildTriIndex(rm.vertices, rm.triangles);
  if (!ix.triangles) throw new Error(tr("Referenční model se nepodařilo zasíťovat."));
  o.onDistances?.();
  const distances = distancesToMesh(ix, refined.vertices, { signed: true });
  return {
    mesh: { vertices: refined.vertices, normals: refined.normals ?? mm.normals, triangles: refined.triangles, faceGroups: refined.faceGroups, lines: mm.lines, edgeGroups: mm.edgeGroups },
    distances,
    stats: distanceStats(distances, o.tolerance, { vertices: refined.vertices, triangles: refined.triangles }),
    meshTolerance: tol,
    accuracy: 2 * tol,
    step,
    capped,
    refTriangles: ix.triangles,
  };
}

// ── porovnání ──────────────────────────────────────────────────────────────────────────────────────────────────

const overlap = (a: [Vec3, Vec3], b: [Vec3, Vec3]) => [0, 1, 2].every((k) => a[0][k] <= b[1][k] && b[0][k] <= a[1][k]);

/**
 * Porovná model s referencí (reference v původní poloze ze souboru; umístění podle `opts.align`). Vstupní tělesa nemění
 * ani neuvolňuje.
 */
export function compareShapes(model: Shape, ref0: Shape, opts: CompareOptions = {}, info: { format?: KernelImportFormat; fileName?: string } = {}, onStep?: (s: CompareStep) => void): CompareResult {
  const t0 = Date.now();
  const tolerance = opts.tolerance && opts.tolerance > 0 ? opts.tolerance : 0.1;
  const align: CompareAlign = opts.align ?? { mode: "none" };
  const wantMap = opts.map !== false;
  const boolMode = opts.booleans ?? "auto";
  const warnings: string[] = [];
  const total = 2 + (boolMode === "never" ? 0 : 2) + (wantMap ? 2 : 0);
  let stepNo = 0;
  const step = (name: string) => onStep?.({ index: stepNo++, total, name });

  // model
  const mBox = boundsOf(model);
  const diag = boxDiag(mBox as Box) || 100;
  const displayTol = meshTolerance(diag);
  let mVol = 0;
  let mArea = 0;
  try {
    mVol = r.measureVolume(model);
    mArea = r.measureArea(model);
  } catch {
    /* otevřené těleso */
  }
  if (!(Math.abs(mVol) > 1e-9)) throw new Error(tr("Model není objemové těleso – porovnání objemů nelze provést."));
  const mSolids = ((model as unknown as { solids?: Shape[] }).solids ?? []) as Shape[];
  const mFaces = model.faces;
  const modelInfo = { volume: mVol, area: mArea, bbox: mBox, faces: mFaces.length, solids: mSolids.length };
  mSolids.forEach(del);
  mFaces.forEach(del);

  // umístění reference
  step(tr("zarovnání reference"));
  const tAlign = Date.now();
  const rBox0 = boundsOf(ref0);
  const offset = align.offset ?? [0, 0, 0];
  let place: Placement3;
  let fit: { score: number; asIsScore: number; tried: number } | undefined;
  if (align.mode === "auto") {
    const mm = meshArrays(model, displayTol, MESH_ANGULAR);
    const rm = meshArrays(ref0, meshTolerance(boxDiag(rBox0 as Box) || 100), MESH_ANGULAR);
    const f = bestRightAngleFit(buildTriIndex(mm.vertices, mm.triangles), mBox as Box, samplePoints(rm.vertices, 3000), rBox0 as Box);
    place = { rot: f.rot, m: f.m, t: [f.t[0] + offset[0], f.t[1] + offset[1], f.t[2] + offset[2]] };
    fit = { score: f.score, asIsScore: f.asIsScore, tried: f.tried };
  } else place = placementFor(align.mode === "center", align.rotate ?? [0, 0, 0], offset, mBox as Box, rBox0 as Box);
  const identity = !place.rot.some(Boolean) && !place.t.some((v) => Math.abs(v) > 1e-12);
  const ref = placeShape(ref0, place);
  const msAlign = Date.now() - tAlign;

  try {
    // reference: metriky a síť pro průhledné zobrazení
    const tRef = Date.now();
    const rr = shapeResult(ref);
    if (!rr.metrics || !rr.mesh) throw new Error(tr("Referenční model se nepodařilo zasíťovat."));
    // shapeResult u velkých těles (> BIG_FACES ploch) bere objem a obálku z hrubší sítě a vynechá kontrolu platnosti –
    // pro porovnání musí být reference změřená stejně přesně jako model (jinak falešný rozdíl objemů)
    const refInfo = { volume: rr.metrics.volume, area: rr.metrics.area, bbox: rr.metrics.bbox, faces: rr.metrics.faces, solids: rr.metrics.solids ?? 0, valid: rr.metrics.valid, format: info.format ?? "step", fileName: info.fileName ?? "" };
    try {
      refInfo.volume = r.measureVolume(ref);
      refInfo.area = r.measureArea(ref);
      refInfo.bbox = boundsOf(ref);
    } catch {
      /* otevřené těleso – zůstanou hodnoty ze sítě */
    }
    if (refInfo.valid === undefined && refInfo.faces <= 2000)
      try {
        const chk = checkShape(ref);
        refInfo.valid = chk.valid;
        refInfo.solids = chk.solids;
      } catch {
        /* bez kontroly */
      }
    const ghost: TriMeshData | null = opts.ghost === false ? null : { vertices: rr.mesh.vertices, normals: rr.mesh.normals, triangles: rr.mesh.triangles };
    const msRef = Date.now() - tRef;
    if (refInfo.valid === false) warnings.push(tr("Referenční model není podle kontroly jádra platné těleso – rozdíly mohou být nepřesné."));
    const ratio = boxDiag(refInfo.bbox as Box) / diag;
    if (ratio > 5 || ratio < 0.2) warnings.push(tr("Reference má výrazně jinou velikost než model ({0}×) – zkontrolujte jednotky souboru.", ratio >= 10 ? Math.round(ratio) : Math.round(ratio * 100) / 100));
    else if (!overlap(mBox, refInfo.bbox)) warnings.push(tr("Obalové kvádry modelu a reference se nepřekrývají – zkontrolujte zarovnání reference."));

    // rozdílová tělesa
    const tBool = Date.now();
    let extra: DiffSide | null = null;
    let missing: DiffSide | null = null;
    let booleansSkipped: CompareResult["booleansSkipped"];
    const sideOpts: SideOpts = { noiseVolume: opts.noiseVolume ?? 1, noiseThickness: opts.noiseThickness ?? 0.01, maxRegions: opts.maxRegions ?? 400, regionMeshes: opts.regionMeshes ?? 60, displayTol };
    if (boolMode === "never") booleansSkipped = "off";
    else if (boolMode === "auto" && refInfo.faces > (opts.maxBooleanFaces ?? 4000)) {
      booleansSkipped = "faces";
      stepNo += 2;
      warnings.push(tr("Reference má {0} ploch (síťový model) – rozdílová tělesa se nepočítala, protože by výpočet trval velmi dlouho. Objemy a mapa odchylek platí.", refInfo.faces));
    } else {
      step(tr("materiál navíc (model − reference)"));
      let t = Date.now();
      try {
        const d = model.cut(ref) as Shape;
        extra = sideOf(d, "extra", sideOpts, t);
        del(d);
      } catch (e) {
        warnings.push(tr("Rozdíl „model − reference“ se nepodařilo spočítat: {0}", errText(e)));
      }
      step(tr("chybějící materiál (reference − model)"));
      t = Date.now();
      try {
        const d = ref.cut(model) as Shape;
        missing = sideOf(d, "missing", sideOpts, t);
        del(d);
      } catch (e) {
        warnings.push(tr("Rozdíl „reference − model“ se nepodařilo spočítat: {0}", errText(e)));
      }
    }
    const msBool = Date.now() - tBool;
    const volumeDiff = modelInfo.volume - refInfo.volume;
    const residual = extra && missing ? volumeDiff - (extra.volume - missing.volume) : null;
    if (residual != null && Math.abs(residual) > Math.max(1, 1e-5 * Math.abs(modelInfo.volume)))
      warnings.push(tr("Kontrola rozdílů nesedí o {0} mm³ (objem navíc − objem chybí se má rovnat rozdílu objemů) – booleovská operace je na tomto páru nepřesná.", Math.round(residual * 100) / 100));
    if (extra && missing && extra.volume + missing.volume > 0.5 * Math.abs(modelInfo.volume))
      warnings.push(tr("Modely se liší o více než polovinu objemu – reference je nejspíš jinak umístěná. Zkuste jiné zarovnání."));

    // mapa odchylek
    const tMap = Date.now();
    let map: CompareMap | null = null;
    if (wantMap) {
      step(tr("síť pro mapu odchylek"));
      try {
        map = distanceMap(model, ref, { tolerance, meshTolerance: opts.meshTolerance, step: opts.step, maxTriangles: opts.maxTriangles, onDistances: () => step(tr("vzdálenosti od reference")) });
        if (map.accuracy > tolerance) warnings.push(tr("Přesnost mapy (±{0} mm) je horší než zadaná tolerance – u takto velkého dílu jemnější síť nejde.", Math.round(map.accuracy * 1000) / 1000));
      } catch (e) {
        warnings.push(tr("Mapu odchylek se nepodařilo spočítat: {0}", errText(e)));
      }
    }
    const msMap = Date.now() - tMap;

    return {
      model: modelInfo,
      reference: refInfo,
      transform: { ...place, mode: align.mode, identity, ...fit },
      volumeDiff,
      extra,
      missing,
      booleansSkipped,
      residual,
      map,
      ghost,
      warnings,
      ms: { import: 0, align: msAlign, reference: msRef, booleans: msBool, map: msMap, total: Date.now() - t0 },
    };
  } finally {
    del(ref);
  }
}

/** Porovná model se souborem reference (STEP / BREP / STL). */
export async function compareWithReference(model: Shape, file: ReferenceFile, opts: CompareOptions = {}, onStep?: (s: CompareStep) => void): Promise<CompareResult> {
  const t0 = Date.now();
  const total = 2 + ((opts.booleans ?? "auto") === "never" ? 0 : 2) + (opts.map !== false ? 2 : 0);
  onStep?.({ index: 0, total: total + 1, name: tr("načítám referenční model") });
  const ref0 = await importReference(file);
  const msImport = Date.now() - t0;
  const res = compareShapes(model, ref0, opts, { format: file.format, fileName: file.fileName }, onStep ? (s) => onStep({ index: s.index + 1, total: s.total + 1, name: s.name }) : undefined);
  res.ms.import = msImport;
  res.ms.total = Date.now() - t0;
  return res;
}

/** Pole výsledku, která se do UI předávají přenosem (bez kopie). */
export function compareTransferables(res: CompareResult): ArrayBuffer[] {
  const out: ArrayBuffer[] = [];
  const mesh = (m?: TriMeshData | null) => m && out.push(m.vertices.buffer as ArrayBuffer, m.normals.buffer as ArrayBuffer, m.triangles.buffer as ArrayBuffer);
  mesh(res.ghost);
  for (const side of [res.extra, res.missing]) for (const g of side?.regions ?? []) mesh(g.mesh);
  if (res.map) {
    const m = res.map.mesh;
    out.push(m.vertices.buffer as ArrayBuffer, m.normals.buffer as ArrayBuffer, m.triangles.buffer as ArrayBuffer, m.faceGroups.buffer as ArrayBuffer, m.lines.buffer as ArrayBuffer, m.edgeGroups.buffer as ArrayBuffer, res.map.distances.buffer as ArrayBuffer);
  }
  return [...new Set(out)];
}
