/**
 * Stavba modelu z historie prvků nad jádrem OpenCascade (replicad).
 * Běží ve web workeru (prohlížeč) i v Node (testy). Předpokládá zavolané setOC().
 */
import * as r from "replicad";
import { findLoops, nestLoops, type Loop } from "./sketch";
import type { BoolMode, BuildResult, CadDoc, FaceInfo, Feature, FeatureStatus, SketchPlane, Vec3 } from "./types";

type Shape = r.Shape3D;

export function planeOf(p: SketchPlane): r.Plane {
  if (p.kind === "base") return r.makePlane(p.name, p.offset);
  return new r.Plane(p.origin, p.xDir, p.normal);
}

const vec = (v: r.Vector): Vec3 => [v.x, v.y, v.z];

/** Uzavřené profily skici → replicad Drawing (s otvory dle vnoření). */
export function sketchDrawing(f: Extract<Feature, { type: "sketch" }>): r.Drawing | null {
  const { loops } = findLoops(f.entities);
  if (!loops.length) return null;
  const nested = nestLoops(loops).sort((a, b) => b.area - a.area);
  let result: r.Drawing | null = null;
  for (const { loop, depth } of nested) {
    const d = loopDrawing(loop);
    if (!d) continue;
    if (!result) result = d;
    else if (depth % 2 === 0) result = result.fuse(d);
    else result = result.cut(d);
  }
  return result;
}

function loopDrawing(l: Loop): r.Drawing | null {
  if (l.kind === "circle") return r.drawCircle(l.r).translate(l.cx, l.cy);
  if (!l.segs.length) return null;
  let pen = r.draw(l.segs[0].a);
  for (const s of l.segs) {
    if (s.kind === "line") pen = pen.lineTo(s.b);
    else pen = pen.threePointsArcTo(s.b, s.m);
  }
  return pen.close();
}

const axisVec = (a: "X" | "Y" | "Z"): Vec3 => (a === "X" ? [1, 0, 0] : a === "Y" ? [0, 1, 0] : [0, 0, 1]);

/** Rotační těleso z profilu (poloměr, výška) kolem osy Z v počátku, pak natočené do osy. */
function revolved(profile: [number, number][], axis: "X" | "Y" | "Z", position: Vec3): Shape {
  let pen = r.draw(profile[0]);
  for (const p of profile.slice(1)) pen = pen.lineTo(p);
  let s = pen.close().sketchOnPlane("XZ").revolve([0, 0, 1]) as Shape;
  if (axis === "X") s = s.rotate(90, [0, 0, 0], [0, 1, 0]);
  if (axis === "Y") s = s.rotate(-90, [0, 0, 0], [1, 0, 0]);
  return s.translate(position);
}

function oriented(s: Shape, axis: "X" | "Y" | "Z", position: Vec3): Shape {
  if (axis === "X") s = s.rotate(90, [0, 0, 0], [0, 1, 0]);
  if (axis === "Y") s = s.rotate(-90, [0, 0, 0], [1, 0, 0]);
  return s.translate(position);
}

function applyMode(body: Shape | null, tool: Shape, mode: BoolMode): Shape {
  if (!body) {
    if (mode === "cut" || mode === "intersect") throw new Error("Není z čeho odebírat – nejdřív vytvořte těleso.");
    return tool;
  }
  if (mode === "cut") return body.cut(tool);
  if (mode === "intersect") return body.intersect(tool);
  return body.fuse(tool);
}

function bboxDiag(s: Shape) {
  const b = s.boundingBox;
  const [[x0, y0, z0], [x1, y1, z1]] = b.bounds;
  return Math.hypot(x1 - x0, y1 - y0, z1 - z0) || 100;
}

/** Nástrojové těleso prvku (pro pole/zrcadlení) — null u prvků, které nástroj nemají. */
function toolOf(f: Feature, ctx: { sketches: Map<string, Extract<Feature, { type: "sketch" }>>; body: Shape | null }): Shape | null {
  switch (f.type) {
    case "extrude": {
      const sk = ctx.sketches.get(f.sketchId);
      if (!sk) throw new Error("Chybí skica.");
      const d = sketchDrawing(sk);
      if (!d) throw new Error("Skica neobsahuje uzavřený profil.");
      if (!(f.distance > 0)) throw new Error("Vzdálenost musí být kladná.");
      const plane = planeOf(sk.plane);
      const dist = f.reverse ? -f.distance : f.distance;
      let s = d.sketchOnPlane(plane).extrude(dist) as Shape;
      if (f.symmetric) {
        const n = plane.zDir;
        s = s.translate([(-n.x * dist) / 2, (-n.y * dist) / 2, (-n.z * dist) / 2]);
      }
      return s;
    }
    case "revolve": {
      const sk = ctx.sketches.get(f.sketchId);
      if (!sk) throw new Error("Chybí skica.");
      const d = sketchDrawing(sk);
      if (!d) throw new Error("Skica neobsahuje uzavřený profil.");
      const plane = planeOf(sk.plane);
      const ax = f.axis === "x" ? plane.xDir : plane.yDir;
      const angle = Math.max(1, Math.min(360, f.angle || 360));
      return d.sketchOnPlane(plane).revolve(vec(ax), { origin: vec(plane.origin), angle }) as Shape;
    }
    case "box": {
      const [w, h, d] = f.size;
      if (!(w > 0 && h > 0 && d > 0)) throw new Error("Rozměry musí být kladné.");
      const [x, y, z] = f.position;
      const c1: Vec3 = f.centered ? [x - w / 2, y - h / 2, z - d / 2] : [x, y, z];
      return r.makeBox(c1, [c1[0] + w, c1[1] + h, c1[2] + d]);
    }
    case "cylinder":
      if (!(f.radius > 0 && f.height > 0)) throw new Error("Rozměry musí být kladné.");
      return r.makeCylinder(f.radius, f.height, f.position, axisVec(f.axis));
    case "sphere":
      if (!(f.radius > 0)) throw new Error("Poloměr musí být kladný.");
      return r.makeSphere(f.radius).translate(f.position);
    case "cone":
      if (!(f.height > 0) || f.radius1 < 0 || f.radius2 < 0 || f.radius1 + f.radius2 <= 0) throw new Error("Neplatné rozměry kuželu.");
      return revolved(
        [[0, 0], [Math.max(f.radius1, 1e-4), 0], [Math.max(f.radius2, 1e-4), f.height], [0, f.height]],
        f.axis,
        f.position,
      );
    case "tube": {
      if (!(f.outer > f.inner && f.inner >= 0 && f.height > 0)) throw new Error("Vnější průměr musí být větší než vnitřní.");
      let t = r.makeCylinder(f.outer / 2, f.height) as Shape;
      if (f.inner > 0) t = t.cut(r.makeCylinder(f.inner / 2, f.height));
      return oriented(t, f.axis, f.position);
    }
    case "hole": {
      if (!(f.diameter > 0)) throw new Error("Průměr díry musí být kladný.");
      const dir = axisVec(f.axis).map((v) => (f.flip ? v : -v)) as Vec3; // výchozí: vrtání proti ose (shora dolů)
      const through = !(f.depth > 0);
      const L = through ? (ctx.body ? bboxDiag(ctx.body) * 2 + 10 : 1000) : f.depth;
      const start: Vec3 = through ? [f.position[0] - (dir[0] * L) / 2, f.position[1] - (dir[1] * L) / 2, f.position[2] - (dir[2] * L) / 2] : f.position;
      let tool = r.makeCylinder(f.diameter / 2, L, start, dir) as Shape;
      if (f.cbDiameter > f.diameter && f.cbDepth > 0) {
        const back: Vec3 = [f.position[0] - dir[0] * 1000, f.position[1] - dir[1] * 1000, f.position[2] - dir[2] * 1000];
        tool = tool.fuse(r.makeCylinder(f.cbDiameter / 2, 1000 + f.cbDepth, back, dir));
      }
      return tool;
    }
    case "import":
      return null;
    default:
      return null;
  }
}

function modeOf(f: Feature): BoolMode {
  if (f.type === "hole") return "cut";
  return "mode" in f ? f.mode : "add";
}

function edgeFilter(body: Shape, edges: number[] | "all") {
  if (edges === "all") return null;
  const all = body.edges;
  const picked = edges.map((i) => all[i]).filter(Boolean);
  if (!picked.length) throw new Error("Vyberte hrany v modelu.");
  return picked;
}

function b64ToBytes(b64: string) {
  if (typeof atob === "function") {
    const s = atob(b64);
    const u = new Uint8Array(s.length);
    for (let i = 0; i < s.length; i++) u[i] = s.charCodeAt(i);
    return u;
  }
  return new Uint8Array(Buffer.from(b64, "base64"));
}

/** Vrátí výsledné těleso po prvek `untilIndex` (vč.) + stav prvků. */
export async function buildShape(doc: CadDoc, untilIndex = Infinity): Promise<{ body: Shape | null; status: FeatureStatus[] }> {
  const sketches = new Map<string, Extract<Feature, { type: "sketch" }>>();
  const tools = new Map<string, { tool: Shape; mode: BoolMode }>();
  const status: FeatureStatus[] = [];
  let body: Shape | null = null;

  for (let i = 0; i < doc.features.length && i <= untilIndex; i++) {
    const f = doc.features[i];
    if (f.suppressed) {
      status.push({ id: f.id, ok: true });
      if (f.type === "sketch") sketches.set(f.id, f);
      continue;
    }
    try {
      let next: Shape | null = body;
      switch (f.type) {
        case "sketch":
          sketches.set(f.id, f);
          break;
        case "import": {
          const blob = new Blob([b64ToBytes(f.data) as BlobPart]);
          const s = (await r.importSTEP(blob)) as Shape;
          next = body ? body.fuse(s) : s;
          break;
        }
        case "fillet":
        case "chamfer": {
          if (!body) throw new Error("Není co zaoblit – nejdřív vytvořte těleso.");
          const size = f.type === "fillet" ? f.radius : f.distance;
          if (!(size > 0)) throw new Error("Hodnota musí být kladná.");
          const picked = edgeFilter(body, f.edges);
          const cfg = picked ? (e: r.Edge) => (picked.some((p) => p.isSame(e)) ? size : null) : size;
          next = f.type === "fillet" ? body.clone().fillet(cfg as never) : body.clone().chamfer(cfg as never);
          break;
        }
        case "shell": {
          if (!body) throw new Error("Není co skořepinovat.");
          if (!(f.thickness > 0)) throw new Error("Tloušťka musí být kladná.");
          const all = body.faces;
          const picked = f.faces.map((k) => all[k]).filter(Boolean);
          if (!picked.length) throw new Error("Vyberte plochy, které se mají otevřít.");
          next = body.clone().shell(Math.abs(f.thickness), (ff) => ff.when(({ element }) => picked.some((p) => p.isSame(element as r.Face))));
          break;
        }
        case "pattern": {
          if (!body) throw new Error("Není těleso.");
          const src = tools.get(f.featureId);
          if (!src) throw new Error("Vyberte prvek (vysunutí, díra, primitivum…), který se má opakovat.");
          let acc: Shape = body;
          for (let k = 1; k < Math.max(1, Math.round(f.count)); k++) {
            let t = src.tool.clone();
            if (f.kind === "linear") {
              const d = f.direction;
              const len = Math.hypot(d[0], d[1], d[2]) || 1;
              t = t.translate([(d[0] / len) * f.spacing * k, (d[1] / len) * f.spacing * k, (d[2] / len) * f.spacing * k]);
            } else {
              const step = (f.angle >= 360 ? 360 / f.count : f.angle / Math.max(1, f.count - 1)) * k;
              t = t.rotate(step, f.center, axisVec(f.axis));
            }
            acc = applyMode(acc, t, src.mode);
          }
          next = acc;
          break;
        }
        case "mirror": {
          if (!body) throw new Error("Není co zrcadlit.");
          const origin: Vec3 = f.plane === "YZ" ? [f.offset, 0, 0] : f.plane === "XZ" ? [0, f.offset, 0] : [0, 0, f.offset];
          const m = body.clone().mirror(f.plane, origin) as Shape;
          next = f.keepOriginal ? body.fuse(m) : m;
          break;
        }
        default: {
          const tool = toolOf(f, { sketches, body });
          if (!tool) break;
          const mode = modeOf(f);
          tools.set(f.id, { tool: tool.clone(), mode });
          next = applyMode(body, tool, mode);
        }
      }
      body = next;
      status.push({ id: f.id, ok: true });
    } catch (e) {
      status.push({ id: f.id, ok: false, error: humanError(e) });
    }
  }
  return { body, status };
}

function humanError(e: unknown): string {
  if (e instanceof Error && e.message && !/^\d+$/.test(e.message)) {
    if (/deleted/i.test(e.message)) return "Vnitřní chyba jádra – zkuste upravit parametry.";
    return e.message;
  }
  return "Operaci nelze provést s těmito parametry (např. příliš velký poloměr zaoblení nebo neplatná geometrie).";
}

export async function buildDoc(doc: CadDoc, opts: { tolerance?: number } = {}): Promise<BuildResult & { body: Shape | null }> {
  const t0 = Date.now();
  const { body, status } = await buildShape(doc);
  if (!body) return { status, mesh: null, metrics: null, ms: Date.now() - t0, body: null };
  const tol = opts.tolerance ?? Math.max(0.01, bboxDiag(body) / 2000);
  const m = body.mesh({ tolerance: tol, angularTolerance: 0.2 });
  const em = body.meshEdges({ tolerance: tol, angularTolerance: 0.2 });
  const faceIndex = new Map(body.faces.map((f, i) => [f.hashCode, i]));
  const edgeIndex = new Map(body.edges.map((e, i) => [e.hashCode, i]));
  const faceGroups = new Int32Array(m.faceGroups.length * 3);
  m.faceGroups.forEach((g, i) => faceGroups.set([g.start, g.count, faceIndex.get(g.faceId) ?? -1], i * 3));
  const edgeGroups = new Int32Array(em.edgeGroups.length * 3);
  em.edgeGroups.forEach((g, i) => edgeGroups.set([g.start, g.count, edgeIndex.get(g.edgeId) ?? -1], i * 3));
  let volume = 0;
  let area = 0;
  try {
    volume = r.measureVolume(body);
    area = r.measureArea(body);
  } catch {
    /* otevřené těleso */
  }
  const bb = body.boundingBox.bounds as [Vec3, Vec3];
  return {
    status,
    body,
    ms: Date.now() - t0,
    mesh: {
      vertices: new Float32Array(m.vertices),
      normals: new Float32Array(m.normals),
      triangles: new Uint32Array(m.triangles),
      faceGroups,
      lines: new Float32Array(em.lines),
      edgeGroups,
    },
    metrics: { volume, area, bbox: bb, faces: body.faces.length, edges: body.edges.length },
  };
}

/** Informace o ploše (pro „skicu na ploše“). */
export function faceInfo(body: Shape, index: number): FaceInfo | null {
  const f = body.faces[index];
  if (!f) return null;
  const planar = f.geomType === "PLANE";
  const c = f.center;
  const n = f.normalAt(c);
  // xDir kolmý na normálu (preferuje globální X, jinak Y)
  const ref: Vec3 = Math.abs(n.x) < 0.9 ? [1, 0, 0] : [0, 1, 0];
  const nv: Vec3 = [n.x, n.y, n.z];
  const dot = ref[0] * nv[0] + ref[1] * nv[1] + ref[2] * nv[2];
  const x: Vec3 = [ref[0] - dot * nv[0], ref[1] - dot * nv[1], ref[2] - dot * nv[2]];
  const xl = Math.hypot(...x) || 1;
  const round = (v: number) => Math.round(v * 1e6) / 1e6;
  return {
    index,
    planar,
    origin: [round(c.x), round(c.y), round(c.z)],
    normal: nv.map(round) as Vec3,
    xDir: x.map((v) => round(v / xl)) as Vec3,
  };
}
