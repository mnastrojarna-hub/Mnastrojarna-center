/**
 * Přímé úpravy a speciální prvky nad jádrem OpenCascade:
 * vytáhnout/zatlačit plochu, odsadit plochu, odstranit plochu, zesílit plochy, žebro, pružina.
 * Běží ve workeru i v Node (testy).
 */
import * as r from "replicad";
import { arcPoints, type Seg } from "./sketch";
import type { Axis, Feature, Vec2, Vec3 } from "./types";

type Shape = r.Shape3D;
type SketchF = Extract<Feature, { type: "sketch" }>;
type OC = any;
const oc = (): OC => r.getOC() as OC;

const vec = (v: r.Vector | { x: number; y: number; z: number }): Vec3 => [v.x, v.y, v.z];
const add = (a: Vec3, b: Vec3, k = 1): Vec3 => [a[0] + b[0] * k, a[1] + b[1] * k, a[2] + b[2] * k];
const norm = (a: Vec3): Vec3 => {
  const l = Math.hypot(...a) || 1;
  return [a[0] / l, a[1] / l, a[2] / l];
};

function shapeDiag(s: Shape) {
  const [[x0, y0, z0], [x1, y1, z1]] = s.boundingBox.bounds;
  return Math.hypot(x1 - x0, y1 - y0, z1 - z0) || 100;
}

/** Vybrané plochy tělesa podle indexů. */
export function pickFaces(body: Shape, idx: number[], what = "plochy"): r.Face[] {
  const all = body.faces;
  const picked = [...new Set(idx)].map((k) => all[k]).filter(Boolean);
  if (!picked.length) throw new Error(`Vyberte ${what} v modelu.`);
  return picked;
}

/** Vnější normála plochy v jejím středu (respektuje orientaci plochy v tělese). */
export function faceNormal(f: r.Face): Vec3 {
  return norm(vec(f.normalAt(f.center)));
}

/** Normála plochy v bodě (orientovaná ven z materiálu). */
function faceNormal2(f: r.Face, p: Vec3): Vec3 {
  return norm(vec(f.normalAt(p)));
}

/** Bod uvnitř tělesa? (BRepExtrema – „vnitřní řešení“ při nulové vzdálenosti) */
export function isInside(body: Shape, p: Vec3): boolean {
  const o = oc();
  const v = r.makeVertex(p);
  const q = new o.BRepExtrema_DistShapeShape();
  try {
    q.LoadS1(body.wrapped);
    q.LoadS2(v.wrapped);
    q.Perform(new o.Message_ProgressRange());
    return q.IsDone() && q.Value() < 1e-7 && q.InnerSolution();
  } finally {
    q.delete();
    v.delete();
  }
}

/** Deska tloušťky `t` z plochy (kladně po normále plochy, záporně proti ní). */
function slab(face: r.Face, t: number): Shape {
  if (face.geomType === "PLANE") {
    const n = faceNormal(face);
    return r.basicFaceExtrusion(face, new r.Vector([n[0] * t, n[1] * t, n[2] * t])) as unknown as Shape;
  }
  const o = oc();
  const mk = new o.BRepOffsetAPI_MakeThickSolid();
  try {
    mk.MakeThickSolidBySimple(face.wrapped, t);
    mk.Build(new o.Message_ProgressRange());
    if (!mk.IsDone()) throw new Error("Plochu se nepodařilo odsadit – zkuste menší vzdálenost.");
    const s = r.cast(mk.Shape()) as unknown as Shape;
    if (!(Math.abs(r.measureVolume(s)) > 0)) throw new Error("Odsazení plochy nevytvořilo objem – tento typ plochy zatím odsadit nelze.");
    return s;
  } finally {
    mk.delete();
  }
}

function fuseAll(parts: Shape[]): Shape {
  let acc = parts[0];
  for (const p of parts.slice(1)) acc = acc.fuse(p);
  return acc;
}

/** Vytáhnout / zatlačit rovinné plochy po normále. */
export function pushPull(body: Shape, faces: number[], distance: number): Shape {
  if (!distance) throw new Error("Vzdálenost nesmí být nulová.");
  const picked = pickFaces(body, faces);
  if (picked.some((f) => f.geomType !== "PLANE")) throw new Error("Vytáhnout/zatlačit lze jen rovinné plochy – pro zakřivené použijte Odsadit plochu.");
  const tools = picked.map((f) => slab(f, distance));
  const tool = fuseAll(tools);
  return distance > 0 ? body.fuse(tool) : body.cut(tool);
}

/** Odsadit plochy (rovinné i zakřivené): kladně ven z materiálu, záporně dovnitř. */
export function offsetFaces(body: Shape, faces: number[], distance: number): Shape {
  if (!distance) throw new Error("Vzdálenost nesmí být nulová.");
  const picked = pickFaces(body, faces);
  const tool = fuseAll(
    picked.map((f) => {
      const info = f.geomType === "CYLINDRE" ? revolutionInfo(f) : null;
      if (info?.full) {
        // posun válcové plochy = mezikruží mezi R a R ± d (díra se zmenší / čep zesílí)
        const outward = info.convex ? 1 : -1; // normála ven z materiálu míří od osy (čep) nebo k ose (díra)
        const R2 = info.R + outward * distance;
        if (R2 <= 1e-6) throw new Error("Odsazení by zrušilo celý válec – zvolte menší vzdálenost.");
        const [ri, ro] = [Math.min(info.R, R2), Math.max(info.R, R2)];
        return revolveAbout([[ri, info.v0], [ro, info.v0], [ro, info.v1], [ri, info.v1]], info.loc, info.dir);
      }
      return slab(f, distance);
    }),
  );
  return distance > 0 ? body.fuse(tool) : body.cut(tool);
}

/** Zesílit plochy na desku tloušťky t (výsledek = samostatné těleso). */
export function thickenFaces(body: Shape, faces: number[], thickness: number): Shape {
  if (!thickness) throw new Error("Tloušťka nesmí být nulová.");
  return fuseAll(pickFaces(body, faces).map((f) => slab(f, thickness)));
}

/**
 * Rotační plocha: osa, rozsah a vypuklost. `convex` = materiál je na straně osy (čep, vypuklé zaoblení),
 * jinak díra / vyduté zaoblení. Určeno z normály plochy vůči radiále (spolehlivé i pro díry).
 */
type RevInfo = { kind: "cyl" | "cone"; loc: Vec3; dir: Vec3; full: boolean; profile: [number, number][]; convex: boolean; R: number; v0: number; v1: number };

/** Rotační plocha (válec, kužel): osa a profil (poloměr, poloha na ose) pro náhradní těleso. */
function revolutionInfo(face: r.Face): RevInfo | null {
  const o = oc();
  const t = face.geomType;
  if (t !== "CYLINDRE" && t !== "CONE") return null;
  const ad = new o.BRepAdaptor_Surface(face.wrapped, true);
  try {
    const u0 = ad.FirstUParameter();
    const u1 = ad.LastUParameter();
    const v0 = ad.FirstVParameter();
    const v1 = ad.LastVParameter();
    const full = u1 - u0 > 2 * Math.PI - 1e-3;
    const pm = ad.Value((u0 + u1) / 2, (v0 + v1) / 2);
    const P: Vec3 = [pm.X(), pm.Y(), pm.Z()];
    pm.delete?.();
    const nrm = faceNormal2(face, P);
    const convexOf = (loc: Vec3, dir: Vec3) => {
      const d = norm(dir);
      const w: Vec3 = [P[0] - loc[0], P[1] - loc[1], P[2] - loc[2]];
      const along = w[0] * d[0] + w[1] * d[1] + w[2] * d[2];
      const radial: Vec3 = [w[0] - along * d[0], w[1] - along * d[1], w[2] - along * d[2]];
      return radial[0] * nrm[0] + radial[1] * nrm[1] + radial[2] * nrm[2] > 0;
    };
    if (t === "CYLINDRE") {
      const c = ad.Cylinder();
      const ax = c.Axis();
      const loc: Vec3 = [ax.Location().X(), ax.Location().Y(), ax.Location().Z()];
      const dir: Vec3 = [ax.Direction().X(), ax.Direction().Y(), ax.Direction().Z()];
      const R = c.Radius();
      return { kind: "cyl", loc, dir, full, profile: [[0, v0], [R, v0], [R, v1], [0, v1]], convex: convexOf(loc, dir), R, v0, v1 };
    }
    const c = ad.Cone();
    const ax = c.Axis();
    const loc: Vec3 = [ax.Location().X(), ax.Location().Y(), ax.Location().Z()];
    const dir: Vec3 = [ax.Direction().X(), ax.Direction().Y(), ax.Direction().Z()];
    const R0 = c.RefRadius();
    const a = c.SemiAngle();
    const rad = (v: number) => Math.max(1e-4, R0 + v * Math.sin(a));
    const z = (v: number) => v * Math.cos(a);
    return { kind: "cone", loc, dir, full, profile: [[0, z(v0)], [rad(v0), z(v0)], [rad(v1), z(v1)], [0, z(v1)]], convex: convexOf(loc, dir), R: R0, v0: z(v0), v1: z(v1) };
  } finally {
    ad.delete();
  }
}

/** Rotační těleso z profilu (r, z) kolem obecné osy. */
function revolveAbout(profile: [number, number][], loc: Vec3, dir: Vec3): Shape {
  const z = norm(dir);
  const ref: Vec3 = Math.abs(z[0]) < 0.9 ? [1, 0, 0] : [0, 1, 0];
  const d = ref[0] * z[0] + ref[1] * z[1] + ref[2] * z[2];
  const x = norm([ref[0] - d * z[0], ref[1] - d * z[1], ref[2] - d * z[2]]);
  // rovina obsahující osu: lokální X = radiála, lokální Y = osa
  const plane = new r.Plane(loc, x, [x[1] * z[2] - x[2] * z[1], x[2] * z[0] - x[0] * z[2], x[0] * z[1] - x[1] * z[0]]);
  let pen = r.draw(profile[0]);
  for (const p of profile.slice(1)) pen = pen.lineTo(p);
  return pen.close().sketchOnPlane(plane).revolve(z, { origin: loc }) as Shape;
}

/**
 * Odstranit plochy (defeaturing pro přímé úpravy importovaných i vlastních těles):
 * • díry a čepy (celé válcové a kuželové plochy) – zaplní se / odříznou se,
 * • zaoblení (část válce) – obnoví se ostrá hrana (osově rovnoběžné zaoblení).
 * Rovinné a obecné plochy nelze odstranit bez prodloužení sousedních ploch – vrací srozumitelnou chybu.
 */
export function deleteFaces(body: Shape, faces: number[]): Shape {
  const picked = pickFaces(body, faces);
  let acc = body;
  for (const face of picked) {
    const info = revolutionInfo(face);
    if (!info) {
      const kind = face.geomType === "PLANE" ? "rovinnou" : face.geomType === "TORUS" ? "toroidní (zaoblení po oblouku)" : "obecnou";
      throw new Error(`Plochu ${kind} nelze odstranit. Odstranit lze díry, čepy, kuželová zahloubení a válcová zaoblení – rovinné plochy posuňte příkazem Vytáhnout/Zatlačit.`);
    }
    const solidAxis = info.convex; // materiál u osy = čep / vypuklé zaoblení
    if (info.full) {
      const tool = revolveAbout(info.profile, info.loc, info.dir);
      acc = solidAxis ? acc.cut(tool) : acc.fuse(tool);
    } else {
      if (info.kind !== "cyl") throw new Error("Částečnou kuželovou plochu nelze odstranit.");
      const bb = face.boundingBox.bounds as [Vec3, Vec3];
      const box = r.makeBox(bb[0], bb[1]) as Shape;
      if (!(r.measureVolume(box) > 1e-9)) throw new Error("Zaoblení není rovnoběžné s osami – nelze jej odstranit.");
      acc = solidAxis ? acc.fuse(box) : acc.cut(box);
    }
  }
  try {
    return acc.simplify() as Shape;
  } catch {
    return acc;
  }
}

/** Body otevřené křivky skici (úsečky, lomené čáry, oblouky) v pořadí. */
function chainPoints(ordered: Seg[]): Vec2[] {
  const pts: Vec2[] = [ordered[0].a];
  for (const s of ordered) {
    if (s.kind === "line") pts.push(s.b);
    else pts.push(...arcPoints(s.a, s.m, s.b, 16).slice(1));
  }
  return pts;
}

function solidsOf(s: Shape): Shape[] {
  return Array.from(r.iterTopo(s.wrapped, "solid" as never), (x) => r.cast(x) as unknown as Shape);
}

/**
 * Žebro z otevřené skici: profil (čára) se zesílí a protáhne k tělesu.
 * • direction "normal": tloušťka kolmo na rovinu skici (symetricky), žebro vyplní prostor mezi čarou a tělesem,
 * • direction "inPlane": tloušťka v rovině skici, žebro roste kolmo k rovině skici až k tělesu.
 */
export function ribTool(body: Shape, sk: SketchF, segs: Seg[], plane: r.Plane, thickness: number, direction: "normal" | "inPlane", flip: boolean): Shape {
  try {
    return ribSide(body, sk, segs, plane, thickness, direction, flip);
  } catch (e) {
    // druhá strana – žebro se obvykle najde samo
    try {
      return ribSide(body, sk, segs, plane, thickness, direction, !flip);
    } catch {
      throw e;
    }
  }
}

function ribSide(body: Shape, sk: SketchF, segs: Seg[], plane: r.Plane, thickness: number, direction: "normal" | "inPlane", flip: boolean): Shape {
  if (!(thickness > 0)) throw new Error("Tloušťka žebra musí být kladná.");
  if (!segs.length) throw new Error(`Skica „${sk.name}“ neobsahuje čáru žebra.`);
  const pts = chainPoints(segs);
  const D = shapeDiag(body) * 3 + 100;
  const n = vec(plane.zDir);
  let tool: Shape;
  let probe: Vec3;
  const W = (p: Vec2): Vec3 => vec(plane.toWorldCoords(p));
  if (direction === "normal") {
    const a = pts[0];
    const b = pts[pts.length - 1];
    const chord: Vec2 = [b[0] - a[0], b[1] - a[1]];
    const L = Math.hypot(...chord);
    if (L < 1e-6) throw new Error("Čára žebra je příliš krátká.");
    const s = flip ? -1 : 1;
    const perp: Vec2 = [(-chord[1] / L) * s, (chord[0] / L) * s];
    const far = pts.map((p) => [p[0] + perp[0] * D, p[1] + perp[1] * D] as Vec2).reverse();
    let pen = r.draw(pts[0]);
    for (const p of [...pts.slice(1), ...far]) pen = pen.lineTo(p);
    tool = (pen.close().sketchOnPlane(plane).extrude(thickness) as Shape).translate([(-n[0] * thickness) / 2, (-n[1] * thickness) / 2, (-n[2] * thickness) / 2]);
    const m = pts[Math.floor(pts.length / 2)];
    const m2 = pts.length > 1 ? pts[Math.floor(pts.length / 2) - (pts.length % 2 === 0 ? 1 : 0)] : m;
    const mid: Vec2 = [(m[0] + m2[0]) / 2 + perp[0] * thickness * 0.05, (m[1] + m2[1]) / 2 + perp[1] * thickness * 0.05];
    probe = W(mid);
  } else {
    let d: r.Drawing | null = null;
    for (let i = 1; i < pts.length; i++) {
      const [a, b] = [pts[i - 1], pts[i]];
      const L = Math.hypot(b[0] - a[0], b[1] - a[1]);
      if (L < 1e-9) continue;
      const ang = (Math.atan2(b[1] - a[1], b[0] - a[0]) * 180) / Math.PI;
      const rect = r.drawRectangle(L, thickness).rotate(ang, [0, 0]).translate((a[0] + b[0]) / 2, (a[1] + b[1]) / 2);
      d = d ? d.fuse(rect) : rect;
      if (i > 1) d = d.fuse(r.drawCircle(thickness / 2).translate(a[0], a[1]));
    }
    if (!d) throw new Error("Čára žebra je příliš krátká.");
    const s = flip ? 1 : -1;
    tool = d.sketchOnPlane(plane).extrude(s * D) as Shape;
    const m: Vec2 = [(pts[0][0] + pts[1][0]) / 2, (pts[0][1] + pts[1][1]) / 2];
    probe = add(W(m), n, s * 1e-3);
  }
  const rest = tool.cut(body);
  const v = r.makeVertex(probe);
  const pieces = solidsOf(rest).filter((p) => {
    const q = new r.DistanceQuery(p);
    const dist = q.distanceTo(v);
    q.delete();
    return dist < Math.max(1e-3, thickness * 0.06);
  });
  v.delete();
  if (!pieces.length) throw new Error("Žebro nenarazilo na těleso – přesuňte čáru blíž k tělesu nebo otočte stranu.");
  for (const p of pieces) if (shapeDiag(p) > D * 0.5) throw new Error("Žebro na zvolené straně nenarazí na těleso – zaškrtněte „Obrátit stranu“.");
  return fuseAll(pieces);
}

/** Šroubovice s kruhovým průřezem (pružina, závitový drát). */
export function springSolid(f: { radius: number; pitch: number; turns: number; wire: number; position: Vec3; axis: Axis }): Shape {
  if (!(f.radius > 0 && f.pitch > 0 && f.turns > 0 && f.wire > 0)) throw new Error("Rozměry pružiny musí být kladné.");
  if (f.wire >= f.pitch) throw new Error("Průměr drátu musí být menší než stoupání (závity by se protínaly).");
  if (f.wire / 2 >= f.radius) throw new Error("Průměr drátu musí být menší než průměr pružiny.");
  if (f.turns > 200) throw new Error("Pružina může mít nejvýš 200 závitů.");
  const dir: Vec3 = f.axis === "X" ? [1, 0, 0] : f.axis === "Y" ? [0, 1, 0] : [0, 0, 1];
  const helix = r.makeHelix(f.pitch, f.pitch * f.turns, f.radius, f.position, dir);
  const start = vec(helix.startPoint);
  const tangent = norm(vec(helix.tangentAt(0)));
  const profile = r.assembleWire([r.makeCircle(f.wire / 2, start, tangent)]);
  const s = r.genericSweep(profile, helix, { frenet: true }, false) as Shape;
  if (!(r.measureVolume(s) > 0)) throw new Error("Pružinu se nepodařilo vytvořit.");
  return s;
}

/** Polohy topologických vrcholů tělesa (x, y, z po trojicích). */
export function vertexPositions(body: Shape): Float32Array {
  const out: number[] = [];
  for (const v of r.iterTopo(body.wrapped, "vertex" as never)) {
    const vx = new r.Vertex(v as never);
    out.push(...vx.asTuple());
  }
  return new Float32Array(out);
}
