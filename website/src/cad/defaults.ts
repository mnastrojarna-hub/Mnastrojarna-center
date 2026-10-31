/** Výchozí parametry prvků, roviny skic a ukázkové modely. */
import type { CadDoc, Feature, FeatureType, SketchPlane, Vec2, Vec3 } from "./types";
import { uid } from "./types";

export const FEATURE_LABEL: Record<FeatureType, string> = {
  sketch: "Skica",
  extrude: "Vysunutí",
  revolve: "Rotace",
  box: "Kvádr",
  cylinder: "Válec",
  sphere: "Koule",
  cone: "Kužel",
  tube: "Trubka",
  hole: "Díra",
  fillet: "Zaoblení",
  chamfer: "Sražení",
  shell: "Skořepina",
  pattern: "Pole",
  mirror: "Zrcadlení",
  import: "Import",
  sweep: "Tažení",
  loft: "Šablonování",
  draft: "Úkos",
  split: "Rozříznout",
  transform: "Transformace",
  datum: "Rovina",
  text: "Text",
  thread: "Závit",
};

/**
 * ISO metrické závity – hrubé stoupání (ISO 261/262).
 * tap = vrták pro závit (d − P), clear = průchozí díra střední (ISO 273),
 * cb = zahloubení pro šroub ISO 4762 [Ø, hloubka], cs = kuželové zahloubení pro ISO 10642 (Ø při 90°).
 */
export const METRIC_THREADS: { name: string; d: number; pitch: number; tap: number; clear: number; cb?: [number, number]; cs?: number }[] = [
  { name: "M2", d: 2, pitch: 0.4, tap: 1.6, clear: 2.4, cb: [4.4, 2.2], cs: 4.4 },
  { name: "M2.5", d: 2.5, pitch: 0.45, tap: 2.05, clear: 2.9, cb: [5.5, 2.7], cs: 5.5 },
  { name: "M3", d: 3, pitch: 0.5, tap: 2.5, clear: 3.4, cb: [6.5, 3.4], cs: 6.7 },
  { name: "M4", d: 4, pitch: 0.7, tap: 3.3, clear: 4.5, cb: [8, 4.4], cs: 9 },
  { name: "M5", d: 5, pitch: 0.8, tap: 4.2, clear: 5.5, cb: [10, 5.4], cs: 11.2 },
  { name: "M6", d: 6, pitch: 1, tap: 5, clear: 6.6, cb: [11, 6.4], cs: 13.4 },
  { name: "M8", d: 8, pitch: 1.25, tap: 6.8, clear: 9, cb: [15, 8.6], cs: 17.9 },
  { name: "M10", d: 10, pitch: 1.5, tap: 8.5, clear: 11, cb: [18, 10.6], cs: 22.4 },
  { name: "M12", d: 12, pitch: 1.75, tap: 10.2, clear: 13.5, cb: [20, 12.6], cs: 26.9 },
  { name: "M14", d: 14, pitch: 2, tap: 12, clear: 15.5, cb: [24, 14.6], cs: 30.8 },
  { name: "M16", d: 16, pitch: 2, tap: 14, clear: 17.5, cb: [26, 16.6], cs: 33.6 },
  { name: "M18", d: 18, pitch: 2.5, tap: 15.5, clear: 20, cb: [30, 18.6] },
  { name: "M20", d: 20, pitch: 2.5, tap: 17.5, clear: 22, cb: [33, 20.6], cs: 40.3 },
  { name: "M22", d: 22, pitch: 2.5, tap: 19.5, clear: 24, cb: [36, 22.8] },
  { name: "M24", d: 24, pitch: 3, tap: 21, clear: 26, cb: [40, 24.8] },
  { name: "M27", d: 27, pitch: 3, tap: 24, clear: 30, cb: [46, 27.8] },
  { name: "M30", d: 30, pitch: 3.5, tap: 26.5, clear: 33, cb: [50, 30.8] },
  { name: "M33", d: 33, pitch: 3.5, tap: 29.5, clear: 36 },
  { name: "M36", d: 36, pitch: 4, tap: 32, clear: 39, cb: [58, 37] },
  { name: "M39", d: 39, pitch: 4, tap: 35, clear: 42 },
  { name: "M42", d: 42, pitch: 4.5, tap: 37.5, clear: 45 },
  { name: "M45", d: 45, pitch: 4.5, tap: 40.5, clear: 48 },
  { name: "M48", d: 48, pitch: 5, tap: 43, clear: 52 },
];

export const threadByName = (name?: string) => METRIC_THREADS.find((t) => t.name.toLowerCase() === (name ?? "").trim().toLowerCase().replace(",", "."));

export function nextName(doc: CadDoc, type: FeatureType) {
  const n = doc.features.filter((f) => f.type === type).length + 1;
  return `${FEATURE_LABEL[type]} ${n}`;
}

export type NewFeatureType = Exclude<FeatureType, "sketch" | "import" | "pattern">;

export function newFeature(doc: CadDoc, type: NewFeatureType, extra: Partial<Feature> = {}): Feature {
  const base = { id: uid(), name: nextName(doc, type) };
  const sketchesRev = [...doc.features].reverse().filter((f) => f.type === "sketch");
  const lastSketch = sketchesRev[0];
  const hasBody = doc.features.some((f) => f.type !== "sketch");
  const mode = hasBody ? "add" : "new";
  let f: Feature;
  switch (type) {
    case "extrude":
      f = { ...base, type, sketchId: lastSketch?.id ?? "", distance: 20, symmetric: false, reverse: false, mode };
      break;
    case "revolve":
      f = { ...base, type, sketchId: lastSketch?.id ?? "", angle: 360, axis: "y", mode };
      break;
    case "box":
      f = { ...base, type, size: [60, 40, 20], position: [0, 0, 0], centered: false, mode };
      break;
    case "cylinder":
      f = { ...base, type, radius: 20, height: 40, position: [0, 0, 0], axis: "Z", mode };
      break;
    case "sphere":
      f = { ...base, type, radius: 20, position: [0, 0, 0], mode };
      break;
    case "cone":
      f = { ...base, type, radius1: 20, radius2: 5, height: 30, position: [0, 0, 0], axis: "Z", mode };
      break;
    case "tube":
      f = { ...base, type, outer: 40, inner: 30, height: 50, position: [0, 0, 0], axis: "Z", mode };
      break;
    case "hole":
      f = { ...base, type, position: [0, 0, 0], axis: "Z", flip: false, diameter: 8.5, depth: 0, cbDiameter: 0, cbDepth: 0 };
      break;
    case "fillet":
      f = { ...base, type, radius: 2, edges: [] };
      break;
    case "chamfer":
      f = { ...base, type, distance: 1, edges: [] };
      break;
    case "shell":
      f = { ...base, type, thickness: 2, faces: [] };
      break;
    case "mirror":
      f = { ...base, type, plane: "YZ", offset: 0, keepOriginal: true };
      break;
    case "sweep":
      // poslední skica = dráha, předposlední = profil
      f = { ...base, type, pathId: lastSketch?.id ?? "", profileId: sketchesRev[1]?.id ?? "", mode, frenet: false };
      break;
    case "loft":
      f = { ...base, type, sketchIds: sketchesRev.slice(0, 2).map((x) => x.id).reverse(), ruled: false, mode };
      break;
    case "draft":
      f = { ...base, type, angle: 3, faces: [], plane: "XY", offset: 0 };
      break;
    case "split":
      f = { ...base, type, plane: "XY", offset: 0, keep: "negative" };
      break;
    case "transform":
      f = { ...base, type, translate: [0, 0, 0], rotateAxis: "Z", rotateAngle: 0, scale: 1 };
      break;
    case "datum":
      f = { ...base, type, origin: [0, 0, 20], normal: [0, 0, 1], xDir: [1, 0, 0], size: 100 };
      break;
    case "text":
      f = { ...base, type, text: "MNÁSTROJÁRNA", height: 8, depth: 1, plane: { kind: "base", name: "XY", offset: 0 }, position: [0, 0], angle: 0, mode: hasBody ? "cut" : "add" };
      break;
    case "thread":
      f = { ...base, type, designation: "M20", position: [0, 0, 0], axis: "Z", length: 30, modeled: false };
      break;
  }
  return { ...f, ...extra } as Feature;
}

/** Ortonormální báze roviny skici (shodná s replicad). */
export function planeBasis(p: SketchPlane): { origin: Vec3; x: Vec3; y: Vec3; n: Vec3 } {
  if (p.kind === "custom") {
    const n = norm(p.normal);
    const x = norm(p.xDir);
    return { origin: p.origin, x, y: cross(n, x), n };
  }
  const cfg: Record<string, { x: Vec3; n: Vec3 }> = {
    XY: { x: [1, 0, 0], n: [0, 0, 1] },
    XZ: { x: [1, 0, 0], n: [0, -1, 0] },
    YZ: { x: [0, 1, 0], n: [1, 0, 0] },
  };
  const { x, n } = cfg[p.name];
  return { origin: [n[0] * p.offset, n[1] * p.offset, n[2] * p.offset], x, y: cross(n, x), n };
}

export function toWorld(p: SketchPlane, pt: Vec2): Vec3 {
  const b = planeBasis(p);
  return [0, 1, 2].map((k) => b.origin[k] + b.x[k] * pt[0] + b.y[k] * pt[1]) as Vec3;
}

export const cross = (a: Vec3, b: Vec3): Vec3 => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
export const norm = (a: Vec3): Vec3 => {
  const l = Math.hypot(a[0], a[1], a[2]) || 1;
  return [a[0] / l, a[1] / l, a[2] / l];
};

export function planeLabel(p: SketchPlane) {
  if (p.kind === "custom") return p.label ?? "Plocha modelu";
  return `${p.name}${p.offset ? ` + ${p.offset} mm` : ""}`;
}

// ---------------- Ukázkové modely ----------------

export function exampleFlange(): CadDoc {
  const s = uid();
  const h = uid();
  return {
    app: "mnastrojarna-cad",
    version: 2,
    name: "Příruba DN50",
    material: "ocel",
    features: [
      {
        id: s,
        name: "Skica 1",
        type: "sketch",
        plane: { kind: "base", name: "XY", offset: 0 },
        entities: [
          { id: uid(), type: "circle", cx: 0, cy: 0, r: 82.5 },
          { id: uid(), type: "circle", cx: 0, cy: 0, r: 30.5 },
        ],
      },
      { id: uid(), name: "Vysunutí 1", type: "extrude", sketchId: s, distance: 18, symmetric: false, reverse: false, mode: "new" },
      { id: uid(), name: "Náboj", type: "tube", outer: 88, inner: 61, height: 30, position: [0, 0, 18], axis: "Z", mode: "add" },
      { id: h, name: "Díra 1", type: "hole", position: [62.5, 0, 18], axis: "Z", flip: false, diameter: 18, depth: 0, cbDiameter: 0, cbDepth: 0 },
      { id: uid(), name: "Pole 1", type: "pattern", featureId: h, kind: "circular", count: 4, angle: 360, axis: "Z", center: [0, 0, 0] },
      { id: uid(), name: "Sražení 1", type: "chamfer", distance: 1.5, edges: "all" },
    ],
  };
}

export function exampleShaft(): CadDoc {
  const s = uid();
  return {
    app: "mnastrojarna-cad",
    version: 2,
    name: "Hřídel s osazením",
    material: "ocel",
    features: [
      {
        id: s,
        name: "Profil hřídele",
        type: "sketch",
        plane: { kind: "base", name: "XZ", offset: 0 },
        entities: [
          {
            id: uid(),
            type: "polyline",
            closed: true,
            points: [
              [0, 0], [12.5, 0], [12.5, 40], [17.5, 40], [17.5, 110], [22.5, 110], [22.5, 125], [15, 125], [15, 180], [0, 180],
            ],
          },
        ],
      },
      { id: uid(), name: "Rotace 1", type: "revolve", sketchId: s, angle: 360, axis: "y", mode: "new" },
      { id: uid(), name: "Drážka pro pero", type: "box", size: [6, 10, 32], position: [-3, 13.5, 60], centered: false, mode: "cut" },
      { id: uid(), name: "Sražení hran", type: "chamfer", distance: 1, edges: "all" },
    ],
  };
}

export function exampleBracket(): CadDoc {
  const s = uid();
  const h = uid();
  const rib = uid();
  return {
    app: "mnastrojarna-cad",
    version: 2,
    name: "Úhelník – konzola",
    material: "hlinik",
    features: [
      {
        id: s,
        name: "Profil L",
        type: "sketch",
        plane: { kind: "base", name: "XZ", offset: 0 },
        entities: [{ id: uid(), type: "polyline", closed: true, points: [[0, 0], [80, 0], [80, 10], [10, 10], [10, 60], [0, 60]] }],
      },
      { id: uid(), name: "Vysunutí 1", type: "extrude", sketchId: s, distance: 50, symmetric: true, reverse: false, mode: "new" },
      { id: h, name: "Díra 1", type: "hole", position: [35, -12, 10], axis: "Z", flip: false, diameter: 8.5, depth: 0, cbDiameter: 15, cbDepth: 5 },
      { id: uid(), name: "Pole 1", type: "pattern", featureId: h, kind: "linear", count: 2, spacing: 24, direction: [0, 1, 0] },
      {
        id: rib,
        name: "Profil žebra",
        type: "sketch",
        plane: { kind: "base", name: "XZ", offset: 0 },
        entities: [{ id: uid(), type: "polyline", closed: true, points: [[9, 9], [50, 9], [9, 50]] }],
      },
      { id: uid(), name: "Žebro", type: "extrude", sketchId: rib, distance: 6, symmetric: true, reverse: false, mode: "add" },
    ],
  };
}

export function exampleHandle(): CadDoc {
  const path = uid();
  const prof = uid();
  const foot = uid();
  const hole = uid();
  return {
    app: "mnastrojarna-cad",
    version: 2,
    name: "Madlo s patkami",
    material: "nerez",
    variables: [
      { name: "rozpeti", expr: "120", note: "Rozteč patek" },
      { name: "vyska", expr: "60" },
      { name: "d", expr: "16", note: "Průměr madla" },
    ],
    features: [
      {
        id: path,
        name: "Dráha madla",
        type: "sketch",
        plane: { kind: "base", name: "XZ", offset: 0 },
        entities: [
          { id: uid(), type: "line", a: [-60, 0], b: [-60, 30] },
          { id: uid(), type: "arc", a: [-60, 30], b: [-51.2132, 51.2132], c: [-30, 60] },
          { id: uid(), type: "line", a: [-30, 60], b: [30, 60] },
          { id: uid(), type: "arc", a: [30, 60], b: [51.2132, 51.2132], c: [60, 30] },
          { id: uid(), type: "line", a: [60, 30], b: [60, 0] },
        ],
      },
      { id: prof, name: "Průřez", type: "sketch", plane: { kind: "base", name: "XY", offset: 0 }, entities: [{ id: uid(), type: "circle", cx: -60, cy: 0, r: 8 }] },
      { id: uid(), name: "Tažení 1", type: "sweep", profileId: prof, pathId: path, mode: "new", frenet: true },
      { id: foot, name: "Patka", type: "box", size: [32, 32, 8], position: [-60, 0, -4], centered: true, mode: "add" },
      { id: uid(), name: "Patka 2", type: "box", size: [32, 32, 8], position: [60, 0, -4], centered: true, mode: "add" },
      { id: hole, name: "Díra M6", type: "hole", kind: "tapped", thread: "M6", position: [-60, 0, -8], axis: "Z", flip: true, diameter: 5, depth: 14, cbDiameter: 0, cbDepth: 0 },
      { id: uid(), name: "Pole děr", type: "pattern", featureId: hole, kind: "linear", count: 2, spacing: 120, direction: [1, 0, 0] },
      { id: uid(), name: "Text", type: "text", text: "MNÁSTROJÁRNA", height: 4, depth: 0.6, plane: { kind: "base", name: "XY", offset: 0 }, position: [0, 0], angle: 0, mode: "cut", suppressed: true },
    ],
  };
}

export function exampleBolt(): CadDoc {
  const prof = uid();
  return {
    app: "mnastrojarna-cad",
    version: 2,
    name: "Čep se závitem M20",
    material: "ocel",
    variables: [
      { name: "L", expr: "80", note: "Celková délka" },
      { name: "Lz", expr: "30", note: "Délka závitu" },
    ],
    configs: [
      { id: "k1", name: "Čep 80", values: { L: 80, Lz: 30 }, suppressed: [] },
      { id: "k2", name: "Čep 120", values: { L: 120, Lz: 45 }, suppressed: [] },
    ],
    activeConfig: "k1",
    features: [
      { id: prof, name: "Hlava", type: "sketch", plane: { kind: "base", name: "XY", offset: 0 }, entities: [{ id: uid(), type: "polygon", cx: 0, cy: 0, r: 17.32, sides: 6, angle: 0 }] },
      { id: "hl", name: "Šestihran", type: "extrude", sketchId: prof, distance: 12.5, symmetric: false, reverse: true, mode: "new" },
      { id: "dr", name: "Dřík", type: "cylinder", radius: 10, height: 80, position: [0, 0, 0], axis: "Z", mode: "add" },
      { id: "sr", name: "Sražení", type: "chamfer", distance: 1, edges: "all" },
      { id: "zv", name: "Závit M20", type: "thread", designation: "M20", position: [0, 0, 50], axis: "Z", length: 30, modeled: false },
      { id: "hd", name: "Středicí důlek", type: "hole", kind: "countersink", position: [0, 0, 80], axis: "Z", flip: false, diameter: 4, depth: 8, cbDiameter: 0, cbDepth: 0, csDiameter: 8.5, csAngle: 60 },
    ],
    bindings: {
      "dr:height": "L",
      "zv:position.2": "L - Lz",
      "zv:length": "Lz",
      "hd:position.2": "L",
    },
  };
}

export function exampleFunnel(): CadDoc {
  const a = uid();
  const b = uid();
  const ai = uid();
  const bi = uid();
  return {
    app: "mnastrojarna-cad",
    version: 2,
    name: "Přechodový kus (šablonování)",
    material: "nerez",
    features: [
      { id: a, name: "Čtverec 200", type: "sketch", plane: { kind: "base", name: "XY", offset: 0 }, entities: [{ id: uid(), type: "rect", cx: 0, cy: 0, w: 200, h: 200, r: 20, angle: 0 }] },
      { id: b, name: "Kruh Ø120", type: "sketch", plane: { kind: "base", name: "XY", offset: 120 }, entities: [{ id: uid(), type: "circle", cx: 0, cy: 0, r: 60 }] },
      { id: uid(), name: "Šablonování 1", type: "loft", sketchIds: [a, b], ruled: false, mode: "new" },
      { id: ai, name: "Vnitřní čtverec", type: "sketch", plane: { kind: "base", name: "XY", offset: 0 }, entities: [{ id: uid(), type: "rect", cx: 0, cy: 0, w: 194, h: 194, r: 17, angle: 0 }] },
      { id: bi, name: "Vnitřní kruh", type: "sketch", plane: { kind: "base", name: "XY", offset: 120 }, entities: [{ id: uid(), type: "circle", cx: 0, cy: 0, r: 57 }] },
      { id: uid(), name: "Dutina", type: "loft", sketchIds: [ai, bi], ruled: false, mode: "cut" },
      { id: uid(), name: "Hrdlo", type: "tube", outer: 120, inner: 114, height: 40, position: [0, 0, 120], axis: "Z", mode: "add" },
      { id: uid(), name: "Příruba", type: "tube", outer: 160, inner: 114, height: 6, position: [0, 0, 154], axis: "Z", mode: "add" },
    ],
  };
}

export const EXAMPLES = [
  { id: "flange", label: "Příruba DN50", make: exampleFlange },
  { id: "shaft", label: "Hřídel s osazením", make: exampleShaft },
  { id: "bracket", label: "Úhelník – konzola", make: exampleBracket },
  { id: "handle", label: "Madlo s patkami (tažení)", make: exampleHandle },
  { id: "bolt", label: "Čep M20 (závit, stavy, rovnice)", make: exampleBolt },
  { id: "funnel", label: "Přechodový kus (šablonování)", make: exampleFunnel },
];
