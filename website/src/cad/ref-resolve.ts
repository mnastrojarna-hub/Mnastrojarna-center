/**
 * Řešení odkazů (`refs.ts`) na skutečnou geometrii tělesa – běží ve workeru při stavbě i při dotazech UI.
 * Odkazy na plochy/hrany/vrcholy se hledají podle indexu a kontrolují otiskem (Sig); když se po úpravě
 * historie indexy posunou, entita se znovu najde podle otisku (typ + střed + velikost).
 */
import * as r from "replicad";
import { planeBasis } from "./defaults";
import { entityInfo, vertexPositions } from "./inspect";
import { keyPoints } from "./sketch";
import type { AxisDef, Direction, Geo, PlaneDef, Ref, ResolvedPlane, Sig } from "./refs";
import type { Axis, Feature, SketchPlane, Vec3 } from "./types";

type Shape = r.Shape3D;
type SketchF = Extract<Feature, { type: "sketch" }>;
export type ResolveCtx = { body: Shape | null; sketches: Map<string, SketchF>; features: Feature[] };

// ---------------- vektory ----------------
export const V = {
  sub: (a: Vec3, b: Vec3): Vec3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]],
  add: (a: Vec3, b: Vec3): Vec3 => [a[0] + b[0], a[1] + b[1], a[2] + b[2]],
  mul: (a: Vec3, k: number): Vec3 => [a[0] * k, a[1] * k, a[2] * k],
  dot: (a: Vec3, b: Vec3) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2],
  cross: (a: Vec3, b: Vec3): Vec3 => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]],
  len: (a: Vec3) => Math.hypot(a[0], a[1], a[2]),
  norm: (a: Vec3): Vec3 => {
    const l = Math.hypot(a[0], a[1], a[2]);
    if (l < 1e-12) throw new Error("Nulový směr – vyberte jinou geometrii.");
    return [a[0] / l, a[1] / l, a[2] / l];
  },
  lerp: (a: Vec3, b: Vec3, t: number): Vec3 => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t],
  /** libovolný jednotkový vektor kolmý na n (preferuje globální X, pak Y) */
  perp: (n: Vec3): Vec3 => {
    const ref: Vec3 = Math.abs(n[0]) < 0.9 ? [1, 0, 0] : [0, 1, 0];
    const d = V.dot(ref, n);
    return V.norm([ref[0] - d * n[0], ref[1] - d * n[1], ref[2] - d * n[2]]);
  },
  /** otočení v kolem osy k (jednotkové) o úhel deg (Rodrigues) */
  rotate: (v: Vec3, k: Vec3, deg: number): Vec3 => {
    const a = (deg * Math.PI) / 180;
    const c = Math.cos(a);
    const s = Math.sin(a);
    const kx = V.cross(k, v);
    const kd = V.dot(k, v);
    return [v[0] * c + kx[0] * s + k[0] * kd * (1 - c), v[1] * c + kx[1] * s + k[1] * kd * (1 - c), v[2] * c + kx[2] * s + k[2] * kd * (1 - c)];
  },
};
export const axisVec = (a: Axis): Vec3 => (a === "X" ? [1, 0, 0] : a === "Y" ? [0, 1, 0] : [0, 0, 1]);
const vt = (v: { x: number; y: number; z: number }): Vec3 => [v.x, v.y, v.z];

// ---------------- otisky entit ----------------

export function sigOf(body: Shape, kind: "face" | "edge" | "vertex", index: number): Sig | null {
  try {
    if (kind === "face") {
      const f = body.faces[index];
      if (!f) return null;
      return { t: f.geomType as string, c: vt(f.center), s: r.measureArea(f) };
    }
    if (kind === "edge") {
      const e = body.edges[index];
      if (!e) return null;
      return { t: e.geomType as string, c: vt(e.pointAt(0.5)), s: e.length };
    }
    const v = vertexPositions(body);
    if (index * 3 + 2 >= v.length) return null;
    return { t: "V", c: [v[index * 3], v[index * 3 + 1], v[index * 3 + 2]], s: 0 };
  } catch {
    return null;
  }
}

function sigMatch(a: Sig, b: Sig, tol: number) {
  return a.t === b.t && V.len(V.sub(a.c, b.c)) <= tol && Math.abs(a.s - b.s) <= Math.max(tol * tol, Math.abs(b.s) * 0.02);
}

function tolOf(body: Shape) {
  const [[x0, y0, z0], [x1, y1, z1]] = body.boundingBox.bounds as [Vec3, Vec3];
  return Math.max(1e-3, Math.hypot(x1 - x0, y1 - y0, z1 - z0) * 1e-4);
}

/** Najde entitu podle otisku (nejbližší střed stejného typu, velikost v toleranci); -1 = nenalezeno. */
export function findBySig(body: Shape, kind: "face" | "edge" | "vertex", sig: Sig): number {
  const n = kind === "face" ? body.faces.length : kind === "edge" ? body.edges.length : vertexPositions(body).length / 3;
  let best = -1;
  let bestD = Infinity;
  const tol = tolOf(body) * 50;
  for (let i = 0; i < n; i++) {
    const s = sigOf(body, kind, i);
    if (!s || s.t !== sig.t) continue;
    const d = V.len(V.sub(s.c, sig.c)) + Math.abs(s.s - sig.s) / Math.max(1, Math.abs(sig.s)) * tol;
    if (d < bestD) {
      bestD = d;
      best = i;
    }
  }
  return bestD <= tol ? best : -1;
}

/** Index entity: ověří otisk a v případě posunu indexů entitu znovu najde. */
export function entityIndex(body: Shape | null, kind: "face" | "edge" | "vertex", index: number, sig?: Sig): number {
  const what = kind === "face" ? "plocha" : kind === "edge" ? "hrana" : "vrchol";
  if (!body) throw new Error(`Odkaz na ${what === "plocha" ? "plochu" : what === "hrana" ? "hranu" : "vrchol"} vyžaduje těleso – nejdřív vytvořte tvar.`);
  if (index < 0 && !sig) throw new Error(`Vyberte ${what === "plocha" ? "plochu" : what === "hrana" ? "hranu" : "vrchol"} v modelu.`);
  if (index >= 0) {
    const cur = sigOf(body, kind, index);
    if (cur && (!sig || sigMatch(cur, sig, tolOf(body) * 10))) return index;
  }
  if (sig) {
    const i = findBySig(body, kind, sig);
    if (i >= 0) return i;
  }
  if (index >= 0 && sigOf(body, kind, index)) return index; // otisk neodpovídá, ale entita existuje – použít (uživatel vidí výsledek)
  throw new Error(`Odkazovaná ${what} už v modelu není – vyberte ji znovu.`);
}

// ---------------- řešení odkazů ----------------

function sketchPoint(ctx: ResolveCtx, ref: Extract<Ref, { kind: "sketchPt" }>): Vec3 {
  const sk = ctx.sketches.get(ref.sketchId) ?? (ctx.features.find((f) => f.id === ref.sketchId && f.type === "sketch") as SketchF | undefined);
  if (!sk) throw new Error("Skica odkazu neexistuje.");
  const e = sk.entities.find((x) => x.id === ref.entityId);
  if (!e) throw new Error("Entita skici odkazu neexistuje.");
  const kp = keyPoints(e)[ref.k];
  if (!kp) throw new Error(`Bod „${ref.k}“ entity skici neexistuje.`);
  return sketchTo3D(sk.plane, kp);
}

export function sketchTo3D(plane: SketchPlane, p: [number, number]): Vec3 {
  const b = planeBasis(plane);
  return V.add(b.origin, V.add(V.mul(b.x, p[0]), V.mul(b.y, p[1])));
}

function datumOf(ctx: ResolveCtx, id: string) {
  const d = ctx.features.find((f) => f.id === id);
  if (!d || d.type !== "datum") throw new Error("Pomocná rovina odkazu neexistuje.");
  return d;
}

/** Geometrie odkazu: bod / směr / rovina / poloměr podle druhu entity. */
export function resolveRef(ctx: ResolveCtx, ref: Ref): Geo {
  switch (ref.kind) {
    case "xyz":
      return { point: ref.p, kindLabel: "bod" };
    case "csys":
      return { point: [0, 0, 0], dir: ref.axis ? axisVec(ref.axis) : [0, 0, 1], plane: { origin: [0, 0, 0], normal: ref.axis ? axisVec(ref.axis) : [0, 0, 1], xDir: ref.axis === "Z" || !ref.axis ? [1, 0, 0] : ref.axis === "X" ? [0, 1, 0] : [0, 0, 1] } };
    case "vertex": {
      const i = entityIndex(ctx.body, "vertex", ref.index, ref.sig);
      const v = vertexPositions(ctx.body!);
      return { point: [v[i * 3], v[i * 3 + 1], v[i * 3 + 2]], kindLabel: "vrchol" };
    }
    case "edge": {
      const i = entityIndex(ctx.body, "edge", ref.index, ref.sig);
      const body = ctx.body!;
      const edge = body.edges[i];
      const info = entityInfo(body, { kind: "edge", index: i });
      const at = ref.at ?? "mid";
      let point: Vec3;
      if (at === "start") point = vt(edge.startPoint);
      else if (at === "end") point = vt(edge.endPoint);
      else if (at === "center") {
        if (!info.center) throw new Error("Hrana není kruhová – střed kružnice nelze určit (použijte střed hrany).");
        point = info.center;
      } else if (typeof at === "object") point = vt(edge.pointAt(at.t));
      else point = vt(edge.pointAt(0.5));
      const dir = info.dir ?? (info.axis ? V.norm(info.axis.dir) : V.norm(vt(edge.tangentAt(typeof at === "object" ? at.t : at === "start" ? 0 : at === "end" ? 1 : 0.5))));
      const plane: ResolvedPlane | undefined = info.axis && info.center ? { origin: info.center, normal: V.norm(info.axis.dir), xDir: V.perp(V.norm(info.axis.dir)) } : undefined;
      return { point, dir, plane, radius: info.radius, kindLabel: "hrana" };
    }
    case "face": {
      const i = entityIndex(ctx.body, "face", ref.index, ref.sig);
      const body = ctx.body!;
      const info = entityInfo(body, { kind: "face", index: i });
      const c = info.center!;
      if (info.normal) {
        const n = V.norm(info.normal);
        return { point: c, dir: n, plane: { origin: c, normal: n, xDir: V.perp(n) }, kindLabel: "rovinná plocha" };
      }
      if (info.axis) {
        const d = V.norm(info.axis.dir);
        // bod na ose nejblíže středu plochy
        const o = info.axis.origin;
        const t = V.dot(V.sub(c, o), d);
        return { point: V.add(o, V.mul(d, t)), dir: d, plane: { origin: V.add(o, V.mul(d, t)), normal: d, xDir: V.perp(d) }, radius: info.radius, kindLabel: info.surface === "CONE" ? "kuželová plocha" : "válcová plocha" };
      }
      const n = V.norm(vt(body.faces[i].normalAt(body.faces[i].center)));
      return { point: c, dir: n, plane: { origin: c, normal: n, xDir: V.perp(n) }, kindLabel: "plocha" };
    }
    case "sketchPt":
      return { point: sketchPoint(ctx, ref), kindLabel: "bod skici" };
    case "datum": {
      const d = datumOf(ctx, ref.featureId);
      const n = V.norm(d.normal);
      return { point: d.origin, dir: n, plane: { origin: d.origin, normal: n, xDir: V.norm(d.xDir) }, kindLabel: "pomocná rovina" };
    }
    case "derived":
      return derived(ctx, ref);
  }
}

export function pointOf(ctx: ResolveCtx, ref: Ref | undefined, what = "bod"): Vec3 {
  if (!ref) throw new Error(`Vyberte ${what}.`);
  const g = resolveRef(ctx, ref);
  if (!g.point) throw new Error(`Odkaz neurčuje ${what}.`);
  return g.point;
}
export function dirOf(ctx: ResolveCtx, ref: Ref | undefined, what = "směr"): Vec3 {
  if (!ref) throw new Error(`Vyberte ${what}.`);
  const g = resolveRef(ctx, ref);
  if (!g.dir) throw new Error(`Odkaz neurčuje ${what} (vyberte hranu, válcovou nebo rovinnou plochu).`);
  return g.dir;
}
export function planeOfRef(ctx: ResolveCtx, ref: Ref | undefined, what = "rovinu"): ResolvedPlane {
  if (!ref) throw new Error(`Vyberte ${what}.`);
  const g = resolveRef(ctx, ref);
  if (!g.plane) throw new Error(`Odkaz neurčuje ${what} (vyberte rovinnou plochu nebo pomocnou rovinu).`);
  return g.plane;
}

function derived(ctx: ResolveCtx, ref: Extract<Ref, { kind: "derived" }>): Geo {
  const a = ref.args;
  switch (ref.op) {
    case "mid": {
      if (a.length < 2) throw new Error("Vyberte dva body.");
      const pts = a.map((x) => pointOf(ctx, x));
      return { point: V.mul(pts.reduce((s, p) => V.add(s, p), [0, 0, 0] as Vec3), 1 / pts.length) };
    }
    case "between":
      if (a.length < 2) throw new Error("Vyberte dva body.");
      return { point: V.lerp(pointOf(ctx, a[0]), pointOf(ctx, a[1]), ref.v ?? 0.5) };
    case "offset": {
      if (a.length < 2) throw new Error("Vyberte bod a hranu (směr).");
      const d = dirOf(ctx, a[1]);
      return { point: V.add(pointOf(ctx, a[0]), V.mul(d, ref.v ?? 0)), dir: d };
    }
    case "project": {
      if (a.length < 2) throw new Error("Vyberte bod a plochu.");
      const p = pointOf(ctx, a[0]);
      const g = resolveRef(ctx, a[1]);
      if (g.plane && !g.radius) {
        const n = g.plane.normal;
        return { point: V.sub(p, V.mul(n, V.dot(V.sub(p, g.plane.origin), n))), dir: n };
      }
      if (g.point && g.dir) {
        const t = V.dot(V.sub(p, g.point), g.dir);
        return { point: V.add(g.point, V.mul(g.dir, t)), dir: g.dir };
      }
      throw new Error("Cíl průmětu musí být rovinná plocha, osa válce nebo přímá hrana.");
    }
    case "intersect": {
      if (a.length < 2) throw new Error("Vyberte hranu a plochu.");
      const l = resolveRef(ctx, a[0]);
      const pl = planeOfRef(ctx, a[1], "plochu");
      if (!l.point || !l.dir) throw new Error("První odkaz musí být přímá hrana.");
      const den = V.dot(l.dir, pl.normal);
      if (Math.abs(den) < 1e-9) throw new Error("Hrana je rovnoběžná s plochou – průsečík neexistuje.");
      const t = V.dot(V.sub(pl.origin, l.point), pl.normal) / den;
      return { point: V.add(l.point, V.mul(l.dir, t)) };
    }
    case "percent": {
      const e = a[0];
      if (!e || e.kind !== "edge") throw new Error("Vyberte hranu.");
      return resolveRef(ctx, { ...e, at: { t: Math.max(0, Math.min(1, ref.v ?? 0.5)) } });
    }
  }
}

// ---------------- směr ----------------

/** Jednotkový směr. `base` = normála roviny skici/plochy a její osa X (pro „pod úhlem“). */
export function resolveDirection(ctx: ResolveCtx, d: Direction | undefined, base: { normal: Vec3; xDir?: Vec3 }): Vec3 {
  if (!d || d.kind === "normal") return V.norm(base.normal);
  switch (d.kind) {
    case "axis":
      return axisVec(d.axis);
    case "edge":
      return dirOf(ctx, d.ref);
    case "twoPoints":
      return V.norm(V.sub(pointOf(ctx, d.b, "druhý bod"), pointOf(ctx, d.a, "první bod")));
    case "faceNormal":
      return dirOf(ctx, d.ref);
    case "vector":
      return V.norm(d.v);
    case "angle": {
      const n = V.norm(base.normal);
      const x = base.xDir ? V.norm(base.xDir) : V.perp(n);
      const y = V.cross(n, x); // osa Y skici
      return V.rotate(n, y, d.deg);
    }
    case "tangent": {
      const g = resolveRef(ctx, d.ref);
      if (!g.dir) throw new Error("Vyberte hranu pro tečnu.");
      return g.dir;
    }
  }
}

// ---------------- osa ----------------

export function resolveAxis(ctx: ResolveCtx, def: AxisDef | undefined, sk: SketchF | null, fallback: "x" | "y" = "y"): { origin: Vec3; dir: Vec3 } {
  const b = sk ? planeBasis(sk.plane) : { origin: [0, 0, 0] as Vec3, x: [1, 0, 0] as Vec3, y: [0, 1, 0] as Vec3, n: [0, 0, 1] as Vec3 };
  const kind = def?.kind ?? (fallback === "x" ? "sketchX" : "sketchY");
  switch (kind) {
    case "sketchX":
      return { origin: b.origin, dir: b.x };
    case "sketchY":
      return { origin: b.origin, dir: b.y };
    case "sketchLine": {
      const id = def && def.kind === "sketchLine" ? def.entityId : "";
      const e = sk?.entities.find((x) => x.id === id);
      if (!e || e.type !== "line") throw new Error("Vyberte úsečku ve skice jako osu rotace.");
      const p = sketchTo3D(sk!.plane, e.a);
      const q = sketchTo3D(sk!.plane, e.b);
      return { origin: p, dir: V.norm(V.sub(q, p)) };
    }
    case "edge":
    case "cylFace": {
      const g = resolveRef(ctx, (def as { ref: Ref }).ref);
      if (!g.dir || !g.point) throw new Error("Vyberte přímou hranu nebo válcovou plochu.");
      return { origin: g.point, dir: g.dir };
    }
    case "twoPoints": {
      const dd = def as Extract<AxisDef, { kind: "twoPoints" }>;
      const p = pointOf(ctx, dd.a, "první bod");
      return { origin: p, dir: V.norm(V.sub(pointOf(ctx, dd.b, "druhý bod"), p)) };
    }
    case "global":
      return { origin: [0, 0, 0], dir: axisVec((def as { axis: Axis }).axis) };
    case "datum": {
      const d = datumOf(ctx, (def as { featureId: string }).featureId);
      return { origin: d.origin, dir: V.norm(d.normal) };
    }
  }
}

// ---------------- roviny ----------------

export function resolvePlaneDef(ctx: ResolveCtx, p: PlaneDef): ResolvedPlane {
  switch (p.kind) {
    case "base": {
      const pl = r.makePlane(p.name, p.offset);
      return { origin: vt(pl.origin), normal: vt(pl.zDir), xDir: vt(pl.xDir) };
    }
    case "face": {
      const g = resolveRef(ctx, p.ref);
      if (!g.plane || g.radius) throw new Error("Vyberte rovinnou plochu nebo pomocnou rovinu.");
      const n = p.flip ? V.mul(g.plane.normal, -1) : g.plane.normal;
      return { origin: V.add(g.plane.origin, V.mul(n, p.offset ?? 0)), normal: n, xDir: g.plane.xDir };
    }
    case "threePoints": {
      const [a, b, c] = [pointOf(ctx, p.a, "1. bod"), pointOf(ctx, p.b, "2. bod"), pointOf(ctx, p.c, "3. bod")];
      const x = V.norm(V.sub(b, a));
      const n0 = V.cross(x, V.sub(c, a));
      if (V.len(n0) < 1e-9) throw new Error("Body leží na jedné přímce – rovinu nelze určit.");
      return { origin: a, normal: V.norm(n0), xDir: x };
    }
    case "pointLine": {
      const pt = pointOf(ctx, p.p);
      const l = resolveRef(ctx, p.line);
      if (!l.dir || !l.point) throw new Error("Vyberte přímou hranu.");
      const n0 = V.cross(l.dir, V.sub(pt, l.point));
      if (V.len(n0) < 1e-9) throw new Error("Bod leží na přímce – rovinu nelze určit.");
      return { origin: pt, normal: V.norm(n0), xDir: l.dir };
    }
    case "pointNormal": {
      const pt = pointOf(ctx, p.p);
      const n = resolveDirection(ctx, p.dir, { normal: [0, 0, 1] });
      return { origin: pt, normal: n, xDir: V.perp(n) };
    }
    case "angle": {
      const f = planeOfRef(ctx, p.face, "plochu");
      const e = resolveRef(ctx, p.edge);
      if (!e.dir || !e.point) throw new Error("Vyberte přímou hranu (osu otáčení).");
      const n = V.norm(V.rotate(f.normal, e.dir, p.deg));
      return { origin: e.point, normal: n, xDir: e.dir };
    }
    case "mid": {
      const a = planeOfRef(ctx, p.a, "1. plochu");
      const b = planeOfRef(ctx, p.b, "2. plochu");
      const na = a.normal;
      const nb = b.normal;
      if (Math.abs(V.dot(na, nb)) > 0.999) {
        const dist = V.dot(V.sub(b.origin, a.origin), na);
        return { origin: V.add(a.origin, V.mul(na, dist / 2)), normal: na, xDir: a.xDir };
      }
      const bis = V.norm(V.dot(na, nb) < 0 ? V.sub(na, nb) : V.add(na, nb));
      return { origin: V.mul(V.add(a.origin, b.origin), 0.5), normal: bis, xDir: V.perp(bis) };
    }
    case "tangentCyl": {
      const cyl = resolveRef(ctx, p.face);
      if (!cyl.radius || !cyl.dir || !cyl.point) throw new Error("Vyberte válcovou plochu.");
      const thr = resolveRef(ctx, p.through);
      const m = thr.plane?.normal ?? thr.dir;
      if (!m) throw new Error("Vyberte rovinu/plochu, se kterou má být tečná rovina rovnoběžná.");
      const mp0 = V.sub(m, V.mul(cyl.dir, V.dot(m, cyl.dir)));
      if (V.len(mp0) < 1e-9) throw new Error("Zvolená rovina je kolmá na osu válce – tečná rovina neexistuje.");
      const mp = V.norm(mp0);
      return { origin: V.add(cyl.point, V.mul(mp, cyl.radius)), normal: mp, xDir: cyl.dir };
    }
    case "normalToCurve": {
      const at = pointOf(ctx, p.at);
      const c = resolveRef(ctx, p.curve);
      if (!c.dir) throw new Error("Vyberte hranu.");
      let t = c.dir;
      if (p.curve.kind === "edge" && ctx.body) {
        // tečna v místě nejblíže bodu (pro oblouky)
        const i = entityIndex(ctx.body, "edge", p.curve.index, p.curve.sig);
        const edge = ctx.body.edges[i];
        let best = 0;
        let bestD = Infinity;
        for (let k = 0; k <= 20; k++) {
          const q = vt(edge.pointAt(k / 20));
          const d = V.len(V.sub(q, at));
          if (d < bestD) {
            bestD = d;
            best = k / 20;
          }
        }
        t = V.norm(vt(edge.tangentAt(best)));
      }
      return { origin: at, normal: t, xDir: V.perp(t) };
    }
    case "twoEdges": {
      const a = resolveRef(ctx, p.a);
      const b = resolveRef(ctx, p.b);
      if (!a.dir || !a.point || !b.dir || !b.point) throw new Error("Vyberte dvě přímé hrany.");
      const cr = V.cross(a.dir, b.dir);
      const n = V.len(cr) < 1e-6 ? V.cross(a.dir, V.sub(b.point, a.point)) : cr;
      if (V.len(n) < 1e-9) throw new Error("Hrany leží na jedné přímce – rovinu nelze určit.");
      return { origin: a.point, normal: V.norm(n), xDir: a.dir };
    }
    case "datum": {
      const d = datumOf(ctx, p.featureId);
      const n = V.norm(d.normal);
      return { origin: V.add(d.origin, V.mul(n, p.offset ?? 0)), normal: n, xDir: V.norm(d.xDir) };
    }
    case "custom":
      return { origin: p.origin, normal: V.norm(p.normal), xDir: V.norm(p.xDir) };
  }
}

/** `PlaneDef` → rovina skici (custom), s popiskem. */
export function planeDefToSketchPlane(ctx: ResolveCtx, p: PlaneDef, label?: string): SketchPlane {
  if (p.kind === "base") return { kind: "base", name: p.name, offset: p.offset };
  const r0 = resolvePlaneDef(ctx, p);
  // xDir musí být kolmý na normálu
  const n = r0.normal;
  const x0 = V.sub(r0.xDir, V.mul(n, V.dot(r0.xDir, n)));
  const x = V.len(x0) < 1e-9 ? V.perp(n) : V.norm(x0);
  const round = (v: Vec3): Vec3 => v.map((c) => Math.round(c * 1e6) / 1e6) as Vec3;
  return { kind: "custom", origin: round(r0.origin), normal: round(n), xDir: round(x), label };
}

/** Informace o odkazu pro UI (popisek + otisk pro trvalé uložení). */
export function refInfo(ctx: ResolveCtx, ref: Ref): { geo: Geo | null; sig: Sig | null; error?: string } {
  let sig: Sig | null = null;
  if (ctx.body && (ref.kind === "vertex" || ref.kind === "edge" || ref.kind === "face")) sig = sigOf(ctx.body, ref.kind, ref.index);
  try {
    return { geo: resolveRef(ctx, ref), sig };
  } catch (e) {
    return { geo: null, sig, error: e instanceof Error ? e.message : String(e) };
  }
}
