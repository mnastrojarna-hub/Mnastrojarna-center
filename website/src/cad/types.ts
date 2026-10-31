/**
 * Mnástrojárna CAD — parametrický dokument.
 * Model = historie prvků (feature tree); každá změna parametru přestaví model od začátku (jako Inventor/ZW3D).
 * Jednotky: milimetry, úhly ve stupních.
 */

export type Vec2 = [number, number];
export type Vec3 = [number, number, number];

export type PlaneName = "XY" | "XZ" | "YZ";
/** Rovina skici: základní rovina s odsazením, nebo obecná rovina (např. z plochy modelu). */
export type SketchPlane =
  | { kind: "base"; name: PlaneName; offset: number }
  | { kind: "custom"; origin: Vec3; normal: Vec3; xDir: Vec3; label?: string };

export type SketchEntity =
  | { id: string; type: "rect"; cx: number; cy: number; w: number; h: number; r: number; angle: number }
  | { id: string; type: "circle"; cx: number; cy: number; r: number }
  | { id: string; type: "polygon"; cx: number; cy: number; r: number; sides: number; angle: number }
  | { id: string; type: "slot"; cx: number; cy: number; length: number; width: number; angle: number }
  | { id: string; type: "polyline"; points: Vec2[]; closed: boolean }
  | { id: string; type: "arc"; a: Vec2; b: Vec2; c: Vec2 } // oblouk třemi body (a → c přes b), jen 2D/DXF
  | { id: string; type: "line"; a: Vec2; b: Vec2; construction?: boolean };

export type BoolMode = "new" | "add" | "cut" | "intersect";
export type Axis = "X" | "Y" | "Z";

/** Typ díry (jako průvodce dírou v ZW3D/Inventoru). */
export type HoleKind = "simple" | "counterbore" | "countersink" | "tapped";

/** Formáty, které jádro umí načíst jako těleso (ostatní se před uložením převedou na STL). */
export type KernelImportFormat = "step" | "brep" | "stl";
/** Formáty 3D exportu. */
export type ExportFormat = "step" | "stl" | "brep" | "obj" | "glb" | "3mf" | "wrl";

export type Feature = { id: string; name: string; suppressed?: boolean } & (
  | { type: "sketch"; plane: SketchPlane; entities: SketchEntity[] }
  | { type: "extrude"; sketchId: string; distance: number; symmetric: boolean; reverse: boolean; mode: BoolMode; draftAngle?: number }
  | { type: "revolve"; sketchId: string; angle: number; axis: "x" | "y"; mode: BoolMode }
  | { type: "box"; size: Vec3; position: Vec3; centered: boolean; mode: BoolMode }
  | { type: "cylinder"; radius: number; height: number; position: Vec3; axis: Axis; mode: BoolMode }
  | { type: "sphere"; radius: number; position: Vec3; mode: BoolMode }
  | { type: "cone"; radius1: number; radius2: number; height: number; position: Vec3; axis: Axis; mode: BoolMode }
  | { type: "tube"; outer: number; inner: number; height: number; position: Vec3; axis: Axis; mode: BoolMode }
  | {
      type: "hole";
      position: Vec3;
      axis: Axis;
      flip: boolean;
      diameter: number;
      depth: number; // 0 = skrz
      cbDiameter: number; // 0 = bez zahloubení
      cbDepth: number;
      /** výchozí "simple" (nebo "counterbore", pokud cbDiameter > 0) */
      kind?: HoleKind;
      /** kuželové zahloubení: průměr a vrcholový úhel (90°) */
      csDiameter?: number;
      csAngle?: number;
      /** závit, např. "M8" (u kind = "tapped" se vrtá jádrový průměr) */
      thread?: string;
      threadDepth?: number;
    }
  | { type: "fillet"; radius: number; edges: number[] | "all" }
  | { type: "chamfer"; distance: number; edges: number[] | "all" }
  | { type: "shell"; thickness: number; faces: number[] }
  | {
      type: "pattern";
      featureId: string;
      kind: "linear";
      count: number;
      spacing: number;
      direction: Vec3;
      /** druhý směr (mřížka) */
      count2?: number;
      spacing2?: number;
      direction2?: Vec3;
    }
  | { type: "pattern"; featureId: string; kind: "circular"; count: number; angle: number; axis: Axis; center: Vec3 }
  | { type: "mirror"; plane: PlaneName; offset: number; keepOriginal: boolean }
  | { type: "import"; fileName: string; format: KernelImportFormat | "iges"; data: string /* base64 */ }
  /** Tažení profilu po křivce (profil = uzavřená skica, dráha = skica s otevřenou/uzavřenou křivkou). */
  | { type: "sweep"; profileId: string; pathId: string; mode: BoolMode; frenet: boolean }
  /** Šablonování mezi 2+ skicami (profily v různých rovinách). */
  | { type: "loft"; sketchIds: string[]; ruled: boolean; mode: BoolMode }
  /** Úkos vybraných ploch vůči neutrální rovině. */
  | { type: "draft"; angle: number; faces: number[]; plane: PlaneName; offset: number }
  /** Rozříznutí tělesa rovinou, ponechá se jedna strana. */
  | { type: "split"; plane: PlaneName; offset: number; keep: "positive" | "negative" }
  /** Přesun / otočení / měřítko tělesa. */
  | { type: "transform"; translate: Vec3; rotateAxis: Axis; rotateAngle: number; scale: number }
  /** Pomocná (referenční) rovina – nevytváří geometrii, slouží pro skici. */
  | { type: "datum"; origin: Vec3; normal: Vec3; xDir: Vec3; size: number }
  /** Text – vystouplý (add) nebo gravírovaný (cut) do tělesa. */
  | { type: "text"; text: string; height: number; depth: number; plane: SketchPlane; position: Vec2; angle: number; mode: "add" | "cut" }
  /** Vnější závit na válcové ploše (kosmetický = jen ve výkrese, modelovaný = šroubovice). */
  | { type: "thread"; designation: string; position: Vec3; axis: Axis; length: number; modeled: boolean }
);

export type FeatureType = Feature["type"];

/** Proměnná (rovnice) – výraz může odkazovat na jiné proměnné: „L = 2*d + 10“. */
export type Variable = { name: string; expr: string; note?: string };

/** Stav (konfigurace) dílu – přepíše hodnoty proměnných a potlačí vybrané prvky. */
export type Config = { id: string; name: string; values: Record<string, number>; suppressed: string[] };

export type CadDoc = {
  app: "mnastrojarna-cad";
  version: 1 | 2;
  name: string;
  material: string;
  features: Feature[];
  /** barva tělesa (#rrggbb) */
  color?: string;
  /** proměnné / rovnice */
  variables?: Variable[];
  /** vazby parametrů na výrazy: klíč „featureId:cesta“ (např. „x1:distance“, „b1:size.0“) → výraz */
  bindings?: Record<string, string>;
  /** stavy (konfigurace) */
  configs?: Config[];
  activeConfig?: string | null;
  /** popisové údaje (razítko výkresu) */
  props?: { number?: string; author?: string; revision?: string; note?: string };
  /** „part“ (výchozí) = díl z historie prvků; „assembly“ = sestava z komponent */
  kind?: "part" | "assembly";
  /** komponenty sestavy */
  components?: AsmComponent[];
};

/** Umístění komponenty: posun (mm) a natočení kolem os X, Y, Z (°, v tomto pořadí). */
export type Placement = { position: Vec3; rotation: Vec3 };

/** Zdroj komponenty: vložený parametrický díl, nebo importovaný soubor (STEP/BREP/STL). */
export type ComponentSource = { kind: "part"; doc: CadDoc } | { kind: "file"; fileName: string; format: KernelImportFormat; data: string };

export type AsmComponent = {
  id: string;
  name: string;
  /** číslo výkresu / normy (do kusovníku) */
  number?: string;
  source: ComponentSource;
  placement: Placement;
  color?: string;
  hidden?: boolean;
  /** ukotvená (nepohyblivá) komponenta */
  fixed?: boolean;
  /** materiál pro kusovník u importovaných souborů */
  material?: string;
  /** skupina v kusovníku (např. „Desky“, „Normálie“) */
  group?: string;
};

export type FeatureStatus = { id: string; ok: boolean; error?: string };

export type MeshData = {
  vertices: Float32Array;
  normals: Float32Array;
  triangles: Uint32Array;
  /** [start, count, faceIndex] po trojicích (start/count v indexech trojúhelníků) */
  faceGroups: Int32Array;
  lines: Float32Array;
  /** [start, count, edgeIndex] po trojicích (start/count v bodech) */
  edgeGroups: Int32Array;
};

export type BuildResult = {
  status: FeatureStatus[];
  /** chyby proměnných / vazeb parametrů (z resolveDoc) */
  paramErrors?: string[];
  mesh: MeshData | null;
  metrics: { volume: number; area: number; bbox: [Vec3, Vec3]; faces: number; edges: number } | null;
  ms: number;
};

export type FaceInfo = { index: number; planar: boolean; origin: Vec3; normal: Vec3; xDir: Vec3 };

export const emptyDoc = (name = "Nový díl"): CadDoc => ({ app: "mnastrojarna-cad", version: 2, name, material: "ocel", features: [] });

export const uid = () => Math.random().toString(36).slice(2, 9);
