/**
 * Zaoblení se setbackem a eliptické / kuželosečkové zaoblení (7. vlna – tvary). Modul obaluje stavitele „fillet“ z `fillet.ts`
 * (registr stavitelů – build.ts ani fillet.ts se nemění): druhy `setback` a `conic` staví zde, ostatní předá původnímu staviteli.
 *
 * Setback (`kind: "setback"`): ve vrcholu, kde se stýkají aspoň 3 zaoblené hrany, zaoblení končí ve vzdálenosti `setback`
 * od vrcholu podél každé hrany (rovina kolmá na hranu) a roh uzavře hladká N-stranná záplata (BRepOffsetAPI_MakeFilling)
 * s tečnou spojitostí G1 k plochám zaoblení i k rovinným plochám rohu. Na rovinné ploše rohu vede hranice záplaty po
 * racionální kvadratické křivce (kuželosečce), tečné k dotykovým přímkám obou sousedních zaoblení. Hodnota pro vrchol:
 * `setbacks[].d` (vrchol odkazem `at`), jinak `setback`, jinak poloměr. Přesně pro rohy z rovinných ploch a přímých hran;
 * jiné vrcholy si ponechají výchozí roh (OCCT „rolling ball“) a prvek to ohlásí jako ⚠.
 *
 * Eliptické / kuželosečkové (`kind: "conic"`): průřez zaoblení je oblouk elipsy (výchozí) nebo kuželosečky s parametrem
 * `rho` (0 < rho < 1; 0,5 = parabola), vzdálenost `radius` (D1) na první ploše a `r2` (D2) na druhé. První plocha = plocha
 * z `faceRefs`, jinak plocha s normálou nejvíc nahoru (+Z, pak +Y, +X). Stavba: odebíraná (u vnitřní hrany přidávaná) oblast
 * mezi plochami a kuželosečkou se vytáhne podél hrany a odečte / přičte booleovskou operací:
 *  - přímá hrana mezi rovinnými plochami → hranol (přesně),
 *  - kruhová hrana, jejíž průřez se podél hrany nemění (rovina ⟂ osa, souosý válec / kužel) → rotace průřezu (přesně),
 *  - ostatní hrany → šablonování průřezů v 8–24 místech hrany (přibližně, prvek to ohlásí jako ⚠).
 */
import { subShapes } from "../fastbox";
import { tr } from "../i18n";
import * as r from "replicad";
import { entityIndex, pointOf, V, type ResolveCtx } from "../ref-resolve";
import { isPlaceholder } from "../refs";
import type { Feature, Vec3 } from "../types";
import { pickEdges } from "./fillet";
import { getFeatureBuilder, registerFeatureBuilder, type FeatCtx } from "./registry";

type Shape = r.Shape3D;
type FilletF = Extract<Feature, { type: "fillet" }>;
type OC = any;
const oc = (): OC => r.getOC() as OC;

const vt = (v: { x: number; y: number; z: number }): Vec3 => [v.x, v.y, v.z];
const fmt = (n: number) => String(Math.round(n * 100) / 100).replace(".", ",");
const rc = (ctx: FeatCtx): ResolveCtx => ({ body: ctx.body, sketches: ctx.sketches, features: ctx.features });
const has = <T extends r.Edge | r.Face>(list: T[], x: r.AnyShape) => list.some((e) => e.isSame(x));

function tolOf(body: Shape) {
  const [[x0, y0, z0], [x1, y1, z1]] = body.boundingBox.bounds as [Vec3, Vec3];
  return Math.max(1e-4, Math.hypot(x1 - x0, y1 - y0, z1 - z0) * 1e-6);
}

function occt<T>(fn: () => T, msg: string): T {
  try {
    return fn();
  } catch {
    throw new Error(msg);
  }
}

/** Racionální kvadratická Bézierova křivka A → B s řídicím bodem X a vahou w (kuželosečka; w = cos(φ/2) → kruhový oblouk). */
export function conicEdge(A: Vec3, X: Vec3, B: Vec3, w: number): r.Edge {
  const o = oc();
  const poles = new o.NCollection_Array1_gp_Pnt(1, 3);
  const weights = new o.NCollection_Array1_double(1, 3);
  try {
    [A, X, B].forEach((p, i) => {
      const g = new o.gp_Pnt(p[0], p[1], p[2]);
      poles.SetValue(i + 1, g);
      g.delete();
    });
    weights.SetValue(1, 1);
    weights.SetValue(2, w);
    weights.SetValue(3, 1);
    const curve = new o.Geom_BezierCurve(poles, weights);
    const mk = new o.BRepBuilderAPI_MakeEdge(curve);
    const edge = new r.Edge(mk.Edge());
    mk.delete();
    return edge;
  } finally {
    poles.delete();
    weights.delete();
  }
}

/** Vzdálenost bodu od tvaru (BRepExtrema). */
function distTo(shape: r.AnyShape, p: Vec3): number {
  const o = oc();
  const v = r.makeVertex(p);
  const q = new o.BRepExtrema_DistShapeShape();
  try {
    q.LoadS1(shape.wrapped);
    q.LoadS2(v.wrapped);
    q.Perform(new o.Message_ProgressRange());
    return q.IsDone() ? Number(q.Value()) : Infinity;
  } finally {
    q.delete();
    v.delete();
  }
}

const unitNormal = (f: r.Face, p: Vec3): Vec3 => V.norm(vt(f.normalAt(p)));

/** Bod uvnitř tělesa? BRepExtrema pozná vnitřek jen u solidu – složený tvar se prochází po solidech. */
function isInside(body: Shape, p: Vec3): boolean {
  const o = oc();
  const v = r.makeVertex(p);
  try {
    for (const s of body.solids) {
      const q = new o.BRepExtrema_DistShapeShape();
      try {
        q.LoadS1(s.wrapped);
        q.LoadS2(v.wrapped);
        q.Perform(new o.Message_ProgressRange());
        if (q.IsDone() && q.Value() < 1e-7 && q.InnerSolution()) return true;
      } finally {
        q.delete();
      }
    }
    return false;
  } finally {
    v.delete();
  }
}

/** Plochy tělesa, kterým hrana patří. */
function facesOfEdge(faces: r.Face[], edgesOf: (f: r.Face) => r.Edge[], e: r.Edge): r.Face[] {
  return faces.filter((f) => has(edgesOf(f), e));
}

function edgeCache() {
  const m = new Map<r.Face, r.Edge[]>();
  return (f: r.Face) => {
    let e = m.get(f);
    if (!e) {
      e = f.edges;
      m.set(f, e);
    }
    return e;
  };
}

// ======================================================================================================================
// Eliptické / kuželosečkové zaoblení
// ======================================================================================================================

/** Místní průřez hrany: bod P, tečna T, směry do ploch u1/u2 (kolmo na hranu), vnější normály n1/n2, vypuklost. */
type Station = { P: Vec3; T: Vec3; u1: Vec3; u2: Vec3; n1: Vec3; n2: Vec3; convex: boolean };

/** Směr kolmý na hranu, ležící v ploše a mířící do ní (ze dvou kandidátů ten, jehož bod leží blíž ploše). */
function intoFace(face: r.Face, P: Vec3, T: Vec3, n: Vec3, step: number): Vec3 {
  const c = V.norm(V.cross(n, T));
  const dPlus = distTo(face, V.add(P, V.mul(c, step)));
  const dMinus = distTo(face, V.sub(P, V.mul(c, step)));
  return dPlus <= dMinus ? c : V.mul(c, -1);
}

function stationAt(edge: r.Edge, t: number, F1: r.Face, F2: r.Face, step: number): Station {
  const P = vt(edge.pointAt(t));
  const T = V.norm(vt(edge.tangentAt(t)));
  const n1 = unitNormal(F1, P);
  const n2 = unitNormal(F2, P);
  const u1 = intoFace(F1, P, T, n1, step);
  const u2 = intoFace(F2, P, T, n2, step);
  // vypuklá hrana: pohyb po ploše 1 od hrany vede pod tečnou rovinu plochy 2 (do materiálu)
  return { P, T, u1, u2, n1, n2, convex: V.dot(u1, n2) < 0 };
}

/** Váha kuželosečky: `rho` (0–1) → w = rho/(1 − rho); bez rho elipsa = afinní obraz kruhového zaoblení (w = sin(α/2)). */
export function conicWeight(u1: Vec3, u2: Vec3, rho?: number): number {
  if (rho !== undefined) return rho / (1 - rho);
  const a = Math.acos(Math.max(-1, Math.min(1, V.dot(u1, u2))));
  return Math.sin(a / 2);
}

/** Průřez nástroje: oblast mezi plochami a kuželosečkou, rozšířená o `m` ven z materiálu (u vnitřní hrany do materiálu). */
function profileFace(s: Station, d1: number, d2: number, w: number, m: number): r.Face {
  const { P, u1, u2, n1, n2 } = s;
  const sg = s.convex ? 1 : -1;
  const A = V.add(P, V.mul(u1, d1));
  const B = V.add(P, V.mul(u2, d2));
  const E1 = V.add(A, V.mul(n1, sg * m));
  const E2 = V.add(B, V.mul(n2, sg * m));
  const C = V.add(P, V.mul(V.add(n1, n2), sg * m));
  const wire = r.assembleWire([r.makeLine(A, E1), r.makeLine(E1, C), r.makeLine(C, E2), r.makeLine(E2, B), conicEdge(B, P, A, w)]);
  return r.makeFace(wire);
}

/** Obsah odebrané oblasti průřezu (mezi plochami a kuželosečkou) – pro kontrolu a testy. */
export function conicRegionArea(d1: number, d2: number, alphaDeg: number, w: number): number {
  // trojúhelník P-A-B minus úseč racionální kvadratické Bézierovy křivky (numericky)
  const a = (alphaDeg * Math.PI) / 180;
  const A: [number, number] = [d1, 0];
  const B: [number, number] = [d2 * Math.cos(a), d2 * Math.sin(a)];
  const pt = (t: number): [number, number] => {
    const b0 = (1 - t) * (1 - t);
    const b1 = 2 * t * (1 - t) * w;
    const b2 = t * t;
    const den = b0 + b1 + b2;
    return [(b0 * A[0] + b2 * B[0]) / den, (b0 * A[1] + b2 * B[1]) / den];
  };
  // obsah mezi P, A, křivkou a B (polygon P → A → křivka → B → P)
  const N = 2000;
  const pts: [number, number][] = [[0, 0]];
  for (let i = 0; i <= N; i++) pts.push(pt(i / N));
  let s = 0;
  for (let i = 0; i < pts.length; i++) {
    const [x0, y0] = pts[i];
    const [x1, y1] = pts[(i + 1) % pts.length];
    s += x0 * y1 - x1 * y0;
  }
  return Math.abs(s) / 2;
}

/** Plocha pro D1: ze sady `faceRefs` (s otiskem), jinak plocha s normálou nejvíc nahoru (+Z, pak +Y, +X). */
function firstFace(F: [r.Face, r.Face], mid: Vec3, refFaces: r.Face[]): [r.Face, r.Face] {
  if (refFaces.length) {
    if (has(refFaces, F[0])) return F;
    if (has(refFaces, F[1])) return [F[1], F[0]];
  }
  const na = unitNormal(F[0], mid);
  const nb = unitNormal(F[1], mid);
  for (const k of [2, 1, 0]) {
    if (Math.abs(na[k] - nb[k]) > 1e-6) return na[k] > nb[k] ? F : [F[1], F[0]];
  }
  return F;
}

type Tool = { shape: Shape; convex: boolean; exact: boolean; parts?: Shape[] };

/** Nástroj pro jednu hranu: hranol (přímá hrana, rovinné plochy), rotace (kruhová hrana se stálým průřezem), jinak šablonování. */
function conicTool(body: Shape, edge: r.Edge, F: [r.Face, r.Face], d1: number, d2: number, rho: number | undefined): Tool {
  const len = edge.length;
  const m = Math.max(d1, d2) * 0.5;
  const step = Math.max(1e-3, Math.min(d1, d2, len) * 0.05);
  const st = (t: number) => stationAt(edge, t, F[0], F[1], step);
  const s0 = st(0);
  const w = conicWeight(s0.u1, s0.u2, rho);
  const prof = (s: Station) => profileFace(s, d1, d2, w, m);
  // smí se nástroj prodloužit za konec hrany? Vypuklá hrana: za koncem není materiál; vnitřní: za koncem materiál je.
  const canExtend = (s: Station, out: Vec3) => {
    const probe = V.add(V.add(s.P, V.mul(out, m * 0.5)), V.add(V.mul(s.u1, d1 * 0.15), V.mul(s.u2, d2 * 0.15)));
    const inside = isInside(body, probe);
    return s.convex ? !inside : inside;
  };
  const geom = edge.geomType;
  const planar = F.every((f) => f.geomType === "PLANE");
  if (geom === "LINE" && planar) {
    const s1 = st(1);
    const e0 = canExtend(s0, V.mul(s0.T, -1)) ? m : 0;
    const e1 = canExtend(s1, s1.T) ? m : 0;
    const face = prof({ ...s0, P: V.sub(s0.P, V.mul(s0.T, e0)) });
    const shape = r.basicFaceExtrusion(face, new r.Vector(V.mul(s0.T, len + e0 + e1))) as Shape;
    return { shape, convex: s0.convex, exact: true };
  }
  if (geom === "CIRCLE") {
    const p0 = vt(edge.pointAt(0));
    const p1 = vt(edge.pointAt(1 / 3));
    const p2 = vt(edge.pointAt(2 / 3));
    const circ = circleOf(p0, p1, p2);
    if (circ) {
      // průřez v místní soustavě (radiální, osová, tečná) musí být podél hrany stejný → rotace je přesná
      const local = (s: Station) => {
        const rad = V.norm(V.sub(s.P, circ.c));
        return [V.dot(s.u1, rad), V.dot(s.u1, circ.n), V.dot(s.u2, rad), V.dot(s.u2, circ.n), s.convex ? 1 : 0];
      };
      const ref = local(s0);
      const same = [0.25, 0.5, 0.75].every((t) => local(st(t)).every((x, i) => Math.abs(x - ref[i]) < 1e-5));
      if (same) {
        const R = circ.radius;
        const axisN = V.norm(V.cross(V.sub(s0.P, circ.c), s0.T)); // kladná rotace kolem axisN jde po směru hrany
        if (edge.isClosed) return { shape: r.revolution(prof(s0), circ.c, axisN, 360) as Shape, convex: s0.convex, exact: true };
        const s1 = st(1);
        const phi = (len / R) * (180 / Math.PI);
        const e0 = canExtend(s0, V.mul(s0.T, -1)) ? (m / R) * (180 / Math.PI) : 0;
        const e1 = canExtend(s1, s1.T) ? (m / R) * (180 / Math.PI) : 0;
        const total = Math.min(360, phi + e0 + e1);
        let face = prof(s0);
        if (e0) face = face.rotate(-e0, circ.c, axisN) as r.Face;
        return { shape: r.revolution(face, circ.c, axisN, total) as Shape, convex: s0.convex, exact: true };
      }
    }
  }
  // obecná hrana: šablonování průřezů (přibližně)
  const n = Math.max(8, Math.min(24, Math.ceil(len / Math.max(1e-3, Math.min(d1, d2)))));
  const stations: Station[] = [];
  for (let i = 0; i <= n; i++) stations.push(st(edge.isClosed && i === n ? 0 : i / n));
  const convex = stations.every((s) => s.convex);
  if (!convex && stations.some((s) => s.convex)) throw new Error(tr("Hrana {0} je zčásti vypuklá a zčásti vnitřní – eliptické zaoblení ji neumí; rozdělte ji nebo použijte konstantní zaoblení.", indexIn(body, edge) + 1));
  const wires = stations.map((s) => prof(s).outerWire());
  if (!edge.isClosed) {
    const first = stations[0];
    const last = stations[stations.length - 1];
    if (canExtend(first, V.mul(first.T, -1))) wires.unshift(prof({ ...first, P: V.sub(first.P, V.mul(first.T, m)) }).outerWire());
    if (canExtend(last, last.T)) wires.push(prof({ ...last, P: V.add(last.P, V.mul(last.T, m)) }).outerWire());
  }
  const loftOf = (ws: r.Wire[]) => occt(() => r.loft(ws, { ruled: false }) as Shape, tr("Eliptické zaoblení hrany {0} se nepodařilo vytvořit (šablonování průřezů selhalo).", indexIn(body, edge) + 1));
  // uzavřená hrana: šablonování dvěma polovinami (stejný první a poslední průřez by plochu zdegeneroval)
  const half = Math.floor(wires.length / 2);
  const parts = edge.isClosed ? [loftOf(wires.slice(0, half + 1)), loftOf(wires.slice(half))] : [loftOf(wires)];
  return { shape: parts[0], parts, convex, exact: false };
}

const indexIn = (body: Shape, e: r.Edge) => body.edges.findIndex((x) => x.isSame(e));

/** Kružnice třemi body: střed, normála, poloměr (null = body na přímce). */
function circleOf(a: Vec3, b: Vec3, c: Vec3): { c: Vec3; n: Vec3; radius: number } | null {
  const ab = V.sub(b, a);
  const ac = V.sub(c, a);
  const n = V.cross(ab, ac);
  const nn = V.dot(n, n);
  if (nn < 1e-18) return null;
  const t1 = V.mul(V.cross(n, ab), V.dot(ac, ac));
  const t2 = V.mul(V.cross(ac, n), V.dot(ab, ab));
  const center = V.add(a, V.mul(V.add(t1, t2), 1 / (2 * nn)));
  return { c: center, n: V.norm(n), radius: V.len(V.sub(a, center)) };
}

function conicFillet(f: FilletF, ctx: FeatCtx): Shape {
  const body = ctx.body;
  if (!body) throw new Error(tr("Není co zaoblit – nejdřív vytvořte těleso."));
  const d1 = f.radius;
  const d2 = f.r2 ?? f.radius;
  if (!(d1 > 0 && d2 > 0)) throw new Error(tr("Obě vzdálenosti eliptického zaoblení (D1 i D2) musí být kladné."));
  if (f.rho !== undefined && !(f.rho > 0 && f.rho < 1)) throw new Error(tr("Parametr kuželosečky rho musí být mezi 0 a 1 (0,5 = parabola, menší = elipsa, větší = hyperbola)."));
  const picked = pickEdges(body, f.edges, f.tangentChain) ?? body.edges;
  const faces = body.faces;
  const edgesOf = edgeCache();
  const refFaces: r.Face[] = [];
  for (const ref of f.faceRefs ?? []) {
    if (isPlaceholder(ref) || ref.kind !== "face") continue;
    refFaces.push(faces[entityIndex(body, "face", ref.index, ref.sig)]);
  }
  for (const i of f.faces ?? []) if (faces[i]) refFaces.push(faces[i]);
  const tools: Tool[] = [];
  for (const e of picked) {
    const F = facesOfEdge(faces, edgesOf, e);
    if (F.length !== 2) throw new Error(tr("Hrana {0} nesousedí právě se dvěma plochami – eliptické zaoblení na ní nelze vytvořit.", indexIn(body, e) + 1));
    const pair = firstFace([F[0], F[1]], vt(e.pointAt(0.5)), refFaces);
    tools.push(conicTool(body, e, pair, d1, d2, f.rho));
  }
  let out: Shape = body;
  const fail = tr("Eliptické zaoblení D1 {0} × D2 {1} nelze provést – vzdálenosti jsou pro vybrané hrany příliš velké nebo se zaoblení kříží.", fmt(d1), fmt(d2));
  for (const t of tools.filter((x) => x.convex)) for (const p of t.parts ?? [t.shape]) out = occt(() => out.cut(p), fail);
  for (const t of tools.filter((x) => !x.convex)) for (const p of t.parts ?? [t.shape]) out = occt(() => out.fuse(p), fail);
  const approx = tools.filter((t) => !t.exact).length;
  if (approx) ctx.warn?.(tr("Eliptické zaoblení: {0} z {1} hran není přímka mezi rovinnými plochami ani kruhová hrana se stálým průřezem – průřez je tam proložen šablonováním (přibližně).", approx, tools.length));
  return out;
}

// ======================================================================================================================
// Setback – zaoblení zastavené před vrcholem a uzavřené hladkou záplatou
// ======================================================================================================================

type Corner = { P: Vec3; edges: r.Edge[]; dirs: Vec3[] };

/** Vrcholy, ve kterých se stýkají aspoň 3 vybrané hrany (spolu se směry hran z vrcholu). */
function setbackCorners(body: Shape, picked: r.Edge[], tol: number): { corners: Corner[]; skipped: string[] } {
  const all = body.edges;
  type End = { P: Vec3; e: r.Edge; dir: Vec3 | null };
  const ends: End[] = [];
  for (const e of all) {
    if (e.isClosed) continue;
    const straight = e.geomType === "LINE";
    const a = vt(e.startPoint);
    const b = vt(e.endPoint);
    ends.push({ P: a, e, dir: straight ? V.norm(V.sub(b, a)) : null });
    ends.push({ P: b, e, dir: straight ? V.norm(V.sub(a, b)) : null });
  }
  const groups: End[][] = [];
  for (const x of ends) {
    const g = groups.find((gr) => V.len(V.sub(gr[0].P, x.P)) <= tol);
    if (g) g.push(x);
    else groups.push([x]);
  }
  const corners: Corner[] = [];
  const skipped: string[] = [];
  for (const g of groups) {
    const sel = g.filter((x) => has(picked, x.e));
    if (sel.length < 3) continue;
    const at = `[${g[0].P.map((v) => fmt(v)).join("; ")}]`;
    if (sel.length !== g.length) {
      skipped.push(tr("vrchol {0}: nejsou vybrány všechny jeho hrany", at));
      continue;
    }
    if (sel.some((x) => !x.dir)) {
      skipped.push(tr("vrchol {0}: hrany nejsou přímé", at));
      continue;
    }
    corners.push({ P: g[0].P, edges: sel.map((x) => x.e), dirs: sel.map((x) => x.dir!) });
  }
  return { corners, skipped };
}

/** Řešení 3×3 (Cramer). */
function solve3(n: [Vec3, Vec3, Vec3], rhs: Vec3): Vec3 | null {
  const det = V.dot(n[0], V.cross(n[1], n[2]));
  if (Math.abs(det) < 1e-12) return null;
  const x = V.add(V.add(V.mul(V.cross(n[1], n[2]), rhs[0]), V.mul(V.cross(n[2], n[0]), rhs[1])), V.mul(V.cross(n[0], n[1]), rhs[2]));
  return V.mul(x, 1 / det);
}

/** Nejbližší body dvou přímek A + a·u a B + b·v → parametry a, b (null = rovnoběžné). */
function lineLine(A: Vec3, u: Vec3, B: Vec3, v: Vec3): { a: number; b: number } | null {
  const w0 = V.sub(A, B);
  const uu = V.dot(u, u);
  const uv = V.dot(u, v);
  const vv = V.dot(v, v);
  const uw = V.dot(u, w0);
  const vw = V.dot(v, w0);
  const den = uu * vv - uv * uv;
  if (Math.abs(den) < 1e-12) return null;
  return { a: (uv * vw - vv * uw) / den, b: (uu * vw - uv * uw) / den };
}

function sewFaces(faces: r.Face[], tol: number): { shape: r.AnyShape; free: number } {
  const o = oc();
  const s = new o.BRepBuilderAPI_Sewing(tol, true, true, true, false);
  try {
    for (const f of faces) s.Add(f.wrapped);
    s.Perform(new o.Message_ProgressRange());
    return { shape: r.cast(r.downcast(s.SewedShape())), free: Number(s.NbFreeEdges()) };
  } finally {
    s.delete();
  }
}

/** Skořepiny tvaru (sešití vrací Shell nebo složený tvar). */
function subShells(shape: r.AnyShape): r.AnyShape[] {
  return subShapes(shape, "SHELL").map((s) => r.cast(s as never));
}

function solidFromShell(shell: r.AnyShape): Shape {
  const o = oc();
  const fix = new o.ShapeFix_Solid();
  try {
    let solid = r.cast(fix.SolidFromShell(shell.wrapped)) as Shape;
    if (r.measureVolume(solid) < 0) solid = r.cast(solid.wrapped.Reversed()) as Shape;
    return solid;
  } finally {
    fix.delete();
  }
}

export type SetbackReport = { g0: number; g1: number; corners: number };

/**
 * Jeden roh: odříznout výchozí roh oblastí Q = {(p − V)·t_i ≤ s} (roviny kolmé na hrany ve vzdálenosti s), nahradit čela řezu
 * záplatou (oblouky průřezů zaoblení G1 k zaoblení, hraniční kuželosečky na rovinných plochách G1 k ploše) a sešít.
 */
function blendCorner(shape: Shape, corner: Corner, cornerFaces: { n: Vec3 }[], s: number, radius: number, tol: number, rep: SetbackReport): Shape {
  const { P: Vx, dirs } = corner;
  const L = 12 * (s + radius);
  const tp = Math.max(tol * 10, 1e-5 * (s + radius));
  let Q: Shape = r.makeBox(V.sub(Vx, [L, L, L]) as Vec3, V.add(Vx, [L, L, L]) as Vec3) as Shape;
  for (const t of dirs) {
    const half = r
      .drawRectangle(8 * L, 8 * L)
      .sketchOnPlane(new r.Plane(V.add(Vx, V.mul(t, s)), V.perp(t), t))
      .extrude(4 * L) as Shape;
    Q = Q.cut(half);
  }
  const notched = occt(() => shape.cut(Q), tr("Setback: odříznutí rohu se nepodařilo (booleovská operace jádra selhala)."));
  // oblast rohu nesmí zasáhnout jiné části tělesa (např. protější stěnu tenkého dílu) – odříznutý objem je omezený velikostí rohu
  if (r.measureVolume(shape) - r.measureVolume(notched) > (4 * (s + radius)) ** 3) throw new Error(tr("Setback {0} mm: oblast rohu zasahuje do jiné části tělesa – zvolte menší setback.", fmt(s)));
  const faces = notched.faces;
  const onPlane = (p: Vec3, i: number) => Math.abs(V.dot(V.sub(p, Vx), dirs[i]) - s) <= tp;
  const near = (p: Vec3) => V.len(V.sub(p, Vx)) <= (s + radius) * 4;
  const pts = (e: r.Edge) => [vt(e.startPoint), vt(e.endPoint), vt(e.pointAt(0.5))];
  // oblouky průřezů zaoblení v rovinách setbacku: v rovině i ten, který leží nejblíž bodu V + s·t_i (rovina protíná i zaoblení
  // jiných, rovnoběžných hran – ta jsou dál)
  const best: ({ e: r.Edge; face: r.Face; i: number; dist: number } | null)[] = dirs.map(() => null);
  for (const fc of faces) {
    if (fc.geomType === "PLANE") continue;
    for (const e of fc.edges) {
      if (e.geomType === "LINE") continue; // dotyková přímka sousedního zaoblení může ležet v rovině setbacku (setback = poloměr)
      const p = pts(e);
      if (!p.every(near)) continue;
      const i = dirs.findIndex((_, k) => p.every((q) => onPlane(q, k)));
      if (i < 0) continue;
      const dist = V.len(V.sub(p[2], V.add(Vx, V.mul(dirs[i], s))));
      if (dist <= radius * 3 && (!best[i] || dist < best[i]!.dist)) best[i] = { e, face: fc, i, dist };
    }
  }
  const arcs = best.filter((a): a is NonNullable<typeof a> => !!a);
  if (arcs.length !== dirs.length) throw new Error(tr("Setback {0} mm: ve vrcholu se nepodařilo najít konce všech zaoblení – setback je nejspíš delší než hrana nebo se zaoblení jinde kříží.", fmt(s)));
  // hraniční křivky na rovinných plochách rohu
  const curves: { e: r.Edge; piece: r.Face }[] = [];
  for (const cf of cornerFaces) {
    const onF = (p: Vec3) => Math.abs(V.dot(V.sub(p, Vx), cf.n)) <= tp;
    const hits: { i: number; A: Vec3 }[] = [];
    for (const a of arcs) {
      for (const p of [vt(a.e.startPoint), vt(a.e.endPoint)]) if (onF(p)) hits.push({ i: a.i, A: p });
    }
    if (hits.length !== 2) throw new Error(tr("Setback: roh není tvořen rovinnými plochami mezi zaoblenými hranami (plocha rohu má {0} konců zaoblení místo 2).", hits.length));
    const [hi, hj] = hits;
    if (V.len(V.sub(hi.A, hj.A)) <= tp) continue; // setback = poloměr: konce zaoblení se potkají, plocha do záplaty nezasahuje
    const ti = dirs[hi.i];
    const tj = dirs[hj.i];
    const ll = lineLine(hi.A, ti, hj.A, tj);
    if (!ll || ll.a > -tp || ll.b > -tp) throw new Error(tr("Setback {0} mm je pro poloměr R{1} příliš malý – zvolte setback alespoň rovný poloměru.", fmt(s), fmt(radius)));
    const X = V.add(hi.A, V.mul(ti, ll.a));
    const theta = Math.acos(Math.max(-1, Math.min(1, V.dot(ti, tj))));
    const edge = conicEdge(hi.A, X, hj.A, Math.sin(theta / 2));
    const C = solve3([cf.n, ti, tj], [V.dot(cf.n, Vx), V.dot(ti, Vx) + s, V.dot(tj, Vx) + s]);
    if (!C) throw new Error(tr("Setback: roviny rohu jsou rovnoběžné – roh nelze uzavřít."));
    const piece = occt(() => r.makeFace(r.assembleWire([edge, r.makeLine(hj.A, C), r.makeLine(C, hi.A)])), tr("Setback: hraniční plochu rohu se nepodařilo vytvořit."));
    curves.push({ e: edge, piece });
  }
  // záplata G1
  const o = oc();
  const fill = new o.BRepOffsetAPI_MakeFilling(3, 15, 2, false, 1e-5, 1e-4, 0.01, 0.1, 8, 9);
  let patch: r.AnyShape;
  try {
    for (const a of arcs) fill.Add(a.e.wrapped, a.face.wrapped, o.GeomAbs_Shape.GeomAbs_G1, true);
    for (const c of curves) fill.Add(c.e.wrapped, c.piece.wrapped, o.GeomAbs_Shape.GeomAbs_G1, true);
    fill.Build(new o.Message_ProgressRange());
    if (!fill.IsDone()) throw new Error("fill");
    rep.g0 = Math.max(rep.g0, Number(fill.G0Error()));
    rep.g1 = Math.max(rep.g1, Number(fill.G1Error()));
    patch = r.cast(fill.Shape());
  } catch {
    throw new Error(tr("Setback: záplatu rohu (N-stranná plocha G1) se nepodařilo spočítat."));
  } finally {
    fill.delete();
  }
  if (!(patch instanceof r.Face)) throw new Error(tr("Setback: záplatu rohu (N-stranná plocha G1) se nepodařilo spočítat."));
  // čela řezu (rovinné plochy v rovinách setbacku u vrcholu) se nahradí záplatou a hraničními plochami
  const isCap = (fc: r.Face) => {
    if (fc.geomType !== "PLANE") return false;
    const ps = fc.edges.flatMap(pts);
    return ps.every(near) && dirs.some((_, k) => ps.every((q) => onPlane(q, k)));
  };
  const keep = faces.filter((fc) => !isCap(fc));
  const sewTol = Math.max(1e-4, rep.g0 * 10, tp);
  const sewn = sewFaces([...keep, patch, ...curves.map((c) => c.piece)], sewTol);
  if (sewn.free > 0) throw new Error(tr("Setback: záplata rohu nenavazuje na okolní plochy ({0} volných hran) – zkuste jiný setback.", sewn.free));
  const shell = sewn.shape instanceof r.Shell ? sewn.shape : (subShells(sewn.shape)[0] ?? sewn.shape);
  const solid = occt(() => solidFromShell(shell), tr("Setback: z ploch rohu se nepodařilo uzavřít těleso."));
  rep.corners++;
  try {
    return solid.simplify();
  } catch {
    return solid;
  }
}

function setbackFillet(f: FilletF, ctx: FeatCtx): Shape {
  const body = ctx.body;
  if (!body) throw new Error(tr("Není co zaoblit – nejdřív vytvořte těleso."));
  if (!(f.radius > 0)) throw new Error(tr("Poloměr musí být kladný."));
  const dflt = f.setback ?? f.radius;
  if (!(dflt > 0)) throw new Error(tr("Setback musí být kladný."));
  const picked = pickEdges(body, f.edges, f.tangentChain) ?? body.edges;
  const tol = tolOf(body);
  const { corners, skipped } = setbackCorners(body, picked, tol * 10);
  // hodnoty pro jednotlivé vrcholy (vrchol odkazem)
  const per: { P: Vec3; d: number }[] = [];
  for (const sb of f.setbacks ?? []) {
    if (!sb || isPlaceholder(sb.at)) continue;
    if (!(sb.d > 0)) throw new Error(tr("Setback u vrcholu musí být kladný."));
    per.push({ P: pointOf(rc(ctx), sb.at, "vrchol"), d: sb.d });
  }
  // rovinné plochy rohu (z původního tělesa, obsahují vrchol)
  const faces = body.faces;
  const cornerFacesOf = (c: Corner): { n: Vec3 }[] | null => {
    const out: { n: Vec3 }[] = [];
    for (const fc of faces) {
      if (!fc.edges.some((e) => has(c.edges, e))) continue;
      if (fc.geomType !== "PLANE") return null;
      const n = unitNormal(fc, vt(fc.center));
      if (Math.abs(V.dot(V.sub(c.P, vt(fc.center)), n)) > tol * 100) continue; // plocha vrcholem neprochází
      out.push({ n });
    }
    return out.length === c.edges.length ? out : null;
  };
  let out = occt(
    () => body.clone().fillet((e) => (has(picked, e) ? f.radius : null)),
    tr("Zaoblení R{0} nelze provést – poloměr je pro vybrané hrany příliš velký nebo se zaoblení kříží.", fmt(f.radius)),
  );
  const rep: SetbackReport = { g0: 0, g1: 0, corners: 0 };
  for (const c of corners) {
    const cf = cornerFacesOf(c);
    if (!cf) {
      skipped.push(tr("vrchol [{0}]: plochy rohu nejsou rovinné", c.P.map((v) => fmt(v)).join("; ")));
      continue;
    }
    const s = per.find((x) => V.len(V.sub(x.P, c.P)) <= tol * 100)?.d ?? dflt;
    if (s < f.radius * (1 - 1e-6)) throw new Error(tr("Setback {0} mm je pro poloměr R{1} příliš malý – zvolte setback alespoň rovný poloměru.", fmt(s), fmt(f.radius)));
    const shortest = Math.min(...c.edges.map((e) => e.length));
    if (s >= shortest) throw new Error(tr("Setback {0} mm je delší než hrana u vrcholu [{1}] ({2} mm).", fmt(s), c.P.map((v) => fmt(v)).join("; "), fmt(shortest)));
    out = blendCorner(out, c, cf, s, f.radius, tol, rep);
  }
  lastSetbackReport = rep;
  if (!corners.length && !skipped.length) ctx.warn?.(tr("Setback: mezi vybranými hranami není vrchol, ve kterém by se stýkaly aspoň 3 hrany – použito běžné zaoblení."));
  if (skipped.length) ctx.warn?.(tr("Setback nelze použít ({0}) – tyto rohy mají výchozí zaoblení vrcholu.", skipped.join("; ")));
  if (rep.g1 > 0.02) ctx.warn?.(tr("Setback: záplata rohu navazuje s odchylkou tečen {0}° (G1 přibližně).", fmt((rep.g1 * 180) / Math.PI)));
  return out;
}

/** Odchylky poslední záplaty setbacku (G0 mm, G1 rad) – pro testy a protokol. */
export let lastSetbackReport: SetbackReport = { g0: 0, g1: 0, corners: 0 };

// ---------------- registrace: obalit původního stavitele zaoblení ----------------

const base = getFeatureBuilder("fillet");
registerFeatureBuilder("fillet", (f, ctx) => {
  if (f.kind === "setback") return setbackFillet(f, ctx);
  if (f.kind === "conic") return conicFillet(f, ctx);
  if (!base) throw new Error(tr("Zaoblení není k dispozici."));
  return base(f, ctx);
});
