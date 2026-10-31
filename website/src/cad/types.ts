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

export type Feature = { id: string; name: string; suppressed?: boolean } & (
  | { type: "sketch"; plane: SketchPlane; entities: SketchEntity[] }
  | { type: "extrude"; sketchId: string; distance: number; symmetric: boolean; reverse: boolean; mode: BoolMode }
  | { type: "revolve"; sketchId: string; angle: number; axis: "x" | "y"; mode: BoolMode }
  | { type: "box"; size: Vec3; position: Vec3; centered: boolean; mode: BoolMode }
  | { type: "cylinder"; radius: number; height: number; position: Vec3; axis: "X" | "Y" | "Z"; mode: BoolMode }
  | { type: "sphere"; radius: number; position: Vec3; mode: BoolMode }
  | { type: "cone"; radius1: number; radius2: number; height: number; position: Vec3; axis: "X" | "Y" | "Z"; mode: BoolMode }
  | { type: "tube"; outer: number; inner: number; height: number; position: Vec3; axis: "X" | "Y" | "Z"; mode: BoolMode }
  | {
      type: "hole";
      position: Vec3;
      axis: "X" | "Y" | "Z";
      flip: boolean;
      diameter: number;
      depth: number; // 0 = skrz
      cbDiameter: number; // 0 = bez zahloubení
      cbDepth: number;
    }
  | { type: "fillet"; radius: number; edges: number[] | "all" }
  | { type: "chamfer"; distance: number; edges: number[] | "all" }
  | { type: "shell"; thickness: number; faces: number[] }
  | { type: "pattern"; featureId: string; kind: "linear"; count: number; spacing: number; direction: Vec3 }
  | { type: "pattern"; featureId: string; kind: "circular"; count: number; angle: number; axis: "X" | "Y" | "Z"; center: Vec3 }
  | { type: "mirror"; plane: PlaneName; offset: number; keepOriginal: boolean }
  | { type: "import"; fileName: string; format: "step" | "iges"; data: string /* base64 */ }
);

export type FeatureType = Feature["type"];

export type CadDoc = {
  app: "mnastrojarna-cad";
  version: 1;
  name: string;
  material: string;
  features: Feature[];
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
  mesh: MeshData | null;
  metrics: { volume: number; area: number; bbox: [Vec3, Vec3]; faces: number; edges: number } | null;
  ms: number;
};

export type FaceInfo = { index: number; planar: boolean; origin: Vec3; normal: Vec3; xDir: Vec3 };

export const emptyDoc = (name = "Nový díl"): CadDoc => ({ app: "mnastrojarna-cad", version: 1, name, material: "ocel", features: [] });

export const uid = () => Math.random().toString(36).slice(2, 9);
