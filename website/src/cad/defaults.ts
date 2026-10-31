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
  import: "Import STEP",
};

export function nextName(doc: CadDoc, type: FeatureType) {
  const n = doc.features.filter((f) => f.type === type).length + 1;
  return `${FEATURE_LABEL[type]} ${n}`;
}

export function newFeature(doc: CadDoc, type: Exclude<FeatureType, "sketch" | "import" | "pattern">, extra: Partial<Feature> = {}): Feature {
  const base = { id: uid(), name: nextName(doc, type) };
  const lastSketch = [...doc.features].reverse().find((f) => f.type === "sketch");
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
    version: 1,
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
    version: 1,
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
    version: 1,
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

export const EXAMPLES = [
  { id: "flange", label: "Příruba DN50", make: exampleFlange },
  { id: "shaft", label: "Hřídel s osazením", make: exampleShaft },
  { id: "bracket", label: "Úhelník – konzola", make: exampleBracket },
];
