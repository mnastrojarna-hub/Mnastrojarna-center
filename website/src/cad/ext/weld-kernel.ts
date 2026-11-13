/**
 * Svary v jádře (OpenCascade přes replicad, 8. vlna):
 *  - tupý svar s úpravou ISO 9692-1 (I, V, Y, X, U, 2U, ½V, ½Y, K, J, 2J) pro tupý, T a rohový spoj: úprava se vyřízne
 *    do spojovaných dílů, svarový kov (drážka + převýšení housenky / kořene) je samostatné těleso „Svar k“, podložka „Podložka k“;
 *  - koutový svar (housenka) po rovných i obloukových hranách: a ↔ z, oboustranný, kolem, přerušovaný, jako těleso;
 *  - děrový / žlábkový svar (otvor v horním plechu vyplněný svarem) a bodový svar (značky Ø d s roztečí);
 *  - výsledek (délka, průřez, objem, hmotnost, přídavný materiál, kotva značky pro výkres) do stavu prvku.
 *
 * Spoj se zadává plochou (čelo připravovaného dílu, které se dotýká druhého dílu), nebo hranou: vypouklá hrana čela = strana
 * svaru (šipky), vydutá hrana sloučeného tělesa = kout T / rohového spoje. Indexy ploch a hran jsou indexy zobrazeného modelu
 * (všechna tělesa dílu, aktivní první – stejně jako popisky F1 / E1).
 */
import type * as R from "replicad";
import { tr } from "../i18n";
import { bodiesAt } from "../bodies";
import { noteFeatureInfo, noteFeatureWarning } from "../feature-notes";
import type { Feature, Vec2, Vec3 } from "../types";
import type { ExtBuildCtx, Shape } from "./registry";
import { add, cross, dot, len, mul, norm, sub } from "./weld-layout";
import { weldBodyNames } from "./weld-bodies";
import { grooveData, type GrooveData } from "./weld-calc";
import {
  depositionEff,
  filletSize,
  grooveProfile,
  intermittent,
  isOpeningAngle,
  materialDensity,
  plugArea,
  domeVolume,
  prepDef,
  processDef,
  rowPositions,
  segmentArea,
  weldInfoText,
  weldMetal,
  PREPS,
  type CPt,
  type GroovePrep,
  type GrooveSpec,
  type JointKind,
  type WeldAnchor,
  type WeldInfo,
} from "./weld-calc";

type Rep = typeof R;
let repP: Promise<Rep> | null = null;
const rep = () => (repP ??= import("replicad"));
const num = (v: unknown, d: number) => (typeof v === "number" && Number.isFinite(v) ? v : d);
const vt = (v: { x: number; y: number; z: number }): Vec3 => [v.x, v.y, v.z];
const MAX_GAP = 15;

// ---------------- tělesa, plochy, hrany ----------------

type BodyEntry = { name: string; shape: Shape; faces: R.Face[]; edges: R.Edge[]; weld: boolean };

/** Názvy těles svarového kovu založených dřívějšími prvky (stejné pravidlo jako weld-bodies.ts / bodies.ts). */
function weldBodiesBefore(features: Feature[], index: number): Set<string> {
  const out = new Set<string>();
  for (let j = 0; j < index; j++) for (const n of weldBodyNames(features, j, bodiesAt({ features }, j).names)) out.add(n);
  return out;
}

function bodyList(ctx: ExtBuildCtx): BodyEntry[] {
  const welds = weldBodiesBefore(ctx.doc.features, ctx.index);
  const src: [string, Shape][] = ctx.bodies && ctx.bodies.size ? [...ctx.bodies] : ctx.body ? [[ctx.activeBody ?? "", ctx.body]] : [];
  return src.map(([name, shape]) => ({ name, shape, faces: shape.faces, edges: shape.edges, weld: welds.has(name) }));
}

/** Plocha / hrana podle indexu zobrazeného modelu (tělesa za sebou, aktivní první). */
function pickAt<K extends "faces" | "edges">(list: BodyEntry[], kind: K, index: number): { entry: BodyEntry; item: BodyEntry[K][number] } {
  let i = index;
  for (const e of list) {
    const arr = e[kind];
    if (i < arr.length) return { entry: e, item: arr[i] as BodyEntry[K][number] };
    i -= arr.length;
  }
  throw new Error(kind === "faces" ? tr("Plocha {0} v tělese neexistuje – vyberte ji znovu.", index + 1) : tr("Hrana {0} v tělese neexistuje – vyberte ji znovu.", index + 1));
}

/** Body zadané souřadnicemi (`edgeAt` / `faceAt`: [[x, y, z], …]) → indexy nejbližších hran / ploch zobrazeného modelu (bez svarů). */
function indicesAt(o: OC, list: BodyEntry[], kind: "faces" | "edges", pts: unknown): number[] {
  if (!Array.isArray(pts)) return [];
  const raw = (pts as unknown[]).length === 3 && (pts as unknown[]).every((v) => typeof v === "number") ? [pts as number[]] : (pts as unknown[]);
  const out: number[] = [];
  for (const p of raw) {
    if (!Array.isArray(p) || p.length < 3 || !p.every((v) => typeof v === "number" && Number.isFinite(v))) throw new Error(tr("Bod hrany / plochy musí mít tři souřadnice x y z."));
    let best = { i: -1, d: Infinity };
    let base = 0;
    for (const e of list) {
      const arr = e[kind];
      if (!e.weld)
        arr.forEach((item, k) => {
          const d = pointDist(o, p as Vec3, item as unknown as Shape).d;
          if (d < best.d - 1e-9) best = { i: base + k, d };
        });
      base += arr.length;
    }
    if (best.i < 0 || best.d > 1) throw new Error(kind === "edges" ? tr("U bodu [{0}] není žádná hrana (nejbližší je dál než 1 mm).", (p as number[]).join("; ")) : tr("U bodu [{0}] není žádná plocha (nejbližší je dál než 1 mm).", (p as number[]).join("; ")));
    if (!out.includes(best.i)) out.push(best.i);
  }
  return out;
}

const solidsOf = (s: Shape): Shape[] => {
  const l = (s as unknown as { solids?: Shape[] }).solids;
  return l && l.length ? l : [s];
};

/** těleso (solid), ke kterému patří plocha / hrana */
function ownerSolid(entry: BodyEntry, item: R.Face | R.Edge, kind: "face" | "edge"): Shape {
  const list = solidsOf(entry.shape);
  if (list.length === 1) return list[0];
  for (const s of list) if ((kind === "face" ? s.faces : s.edges).some((x) => x.isSame(item as never))) return s;
  return list[0];
}

// ---------------- vzdálenosti a sondy (OCCT) ----------------

type OC = {
  gp_Pnt: new (x: number, y: number, z: number) => { delete(): void };
  BRepBuilderAPI_MakeVertex: new (p: unknown) => { Vertex(): { delete(): void }; delete(): void };
  BRepExtrema_DistShapeShape: new (a: unknown, b: unknown) => { IsDone(): boolean; Value(): number; InnerSolution(): boolean; NbSolution(): number; PointOnShape2(n: number): { X(): number; Y(): number; Z(): number; delete(): void }; delete(): void };
};
let ocRef: OC | null = null;
async function oc(): Promise<OC> {
  if (ocRef) return ocRef;
  const r = await rep();
  ocRef = r.getOC() as unknown as OC;
  return ocRef;
}

/** vzdálenost bodu od tvaru; `inner` = bod uvnitř tělesa (jen u solidu); `q` = nejbližší bod tvaru */
function pointDist(o: OC, p: Vec3, shape: Shape | R.Face): { d: number; inner: boolean; q: Vec3 } {
  const pnt = new o.gp_Pnt(p[0], p[1], p[2]);
  const mk = new o.BRepBuilderAPI_MakeVertex(pnt);
  const v = mk.Vertex();
  const t = new o.BRepExtrema_DistShapeShape(v, (shape as unknown as { wrapped: unknown }).wrapped);
  try {
    if (!t.IsDone()) return { d: Infinity, inner: false, q: p };
    const d = t.Value();
    const inner = t.InnerSolution();
    let q: Vec3 = p;
    if (t.NbSolution() > 0) {
      const pt = t.PointOnShape2(1);
      q = [pt.X(), pt.Y(), pt.Z()];
      pt.delete();
    }
    return { d, inner, q };
  } finally {
    t.delete();
    v.delete();
    mk.delete();
    pnt.delete();
  }
}
const inside = (o: OC, p: Vec3, solid: Shape) => {
  const r0 = pointDist(o, p, solid);
  return r0.d < 1e-7;
};

/** hloubka materiálu tělesa od bodu `p` (těsně uvnitř) ve směru `dir` – délka prvního úseku přímky uvnitř tělesa */
async function rayDepth(solid: Shape, p: Vec3, dir: Vec3, max = 2000): Promise<number> {
  const r = await rep();
  const q = add(p, mul(dir, max));
  let res: Shape;
  try {
    res = (solid.clone() as unknown as { intersect(s: unknown): Shape }).intersect(r.makeLine(p, q));
  } catch {
    return 0;
  }
  let best = 0;
  for (const e of res.edges) {
    const a = dot(sub(vt(e.startPoint), p), dir);
    const b = dot(sub(vt(e.endPoint), p), dir);
    if (Math.min(a, b) < 1e-3 && Math.max(a, b) > best) best = Math.max(a, b);
  }
  return best;
}

/** směr v ploše kolmo na hranu (tečna e) v bodě P, mířící do plochy (od hrany) */
function inFaceDir(o: OC, face: R.Face, P: Vec3, e: Vec3): { t: Vec3; n: Vec3 } {
  const n = norm(vt(face.normalAt(P)));
  const c = norm(cross(e, n));
  const step = 0.02;
  const d1 = pointDist(o, add(P, mul(c, step)), face).d;
  const d2 = pointDist(o, add(P, mul(c, -step)), face).d;
  return { t: d1 <= d2 ? c : mul(c, -1), n };
}

/** plochy tělesa, na kterých leží hrana */
const adjacentFaces = (solid: Shape, edge: R.Edge) => solid.faces.filter((f) => f.edges.some((x) => x.isSame(edge)));

/** vydutá (vnitřní) hrana mezi plochami A a B v bodě P */
function concaveAt(o: OC, A: R.Face, B: R.Face, P: Vec3, e: Vec3): { concave: boolean; a: { t: Vec3; n: Vec3 }; b: { t: Vec3; n: Vec3 } } {
  const a = inFaceDir(o, A, P, e);
  const b = inFaceDir(o, B, P, e);
  return { concave: dot(a.t, b.n) > 1e-6 && dot(b.t, a.n) > 1e-6, a, b };
}

/** Nejbližší jiný díl ve směru normály plochy (do `MAX_GAP`): mezera a těleso. */
function otherMember(o: OC, c: Vec3, nu: Vec3, others: Shape[]): { gap: number; solid: Shape } | null {
  const eps = 0.02; // sonda kousek před plochou (body blíž než ~1 µm povrchu jádro hlásí „na hranici“, ne „uvnitř“)
  const p0 = add(c, mul(nu, eps));
  let best: { gap: number; solid: Shape } | null = null;
  for (const s of others) {
    const r0 = pointDist(o, p0, s);
    if (r0.d + eps > MAX_GAP) continue;
    if (r0.d > 1e-7 && dot(sub(r0.q, c), nu) < 0.8 * (r0.d + eps)) continue; // druhý díl musí ležet před plochou (ve směru normály)
    const g = r0.d < 1e-7 ? 0 : r0.d + eps;
    if (!best || g < best.gap) best = { gap: g, solid: s };
  }
  return best;
}

// ---------------- výkres průřezu → těleso ----------------

function drawContour(r: Rep, c: CPt[]): R.Drawing {
  let pen = r.draw(c[0].p);
  for (let i = 1; i < c.length; i++) pen = c[i].arc ? pen.threePointsArcTo(c[i].p, c[i].arc!) : pen.lineTo(c[i].p);
  return pen.close();
}

/** Kusy průřezu (rovina x = dvec, y = tau, počátek O) vysunuté podél spoje u o délku L; null = prázdné. */
function extrudePieces(r: Rep, pieces: CPt[][], O: Vec3, dvec: Vec3, tau: Vec3, u: Vec3, L: number): Shape | null {
  if (!pieces.length) return null;
  const n = norm(cross(dvec, tau));
  const origin = dot(n, u) > 0 ? O : add(O, mul(u, L));
  const plane = new r.Plane(origin, dvec, n);
  try {
    let d = drawContour(r, pieces[0]);
    for (const pc of pieces.slice(1)) d = d.fuse(drawContour(r, pc));
    return d.sketchOnPlane(plane).extrude(L) as unknown as Shape;
  } catch {
    // záloha: každý kus zvlášť a sjednocení v prostoru
    let acc: Shape | null = null;
    for (const pc of pieces) {
      const s = drawContour(r, pc).sketchOnPlane(plane).extrude(L) as unknown as Shape;
      acc = acc ? (acc.fuse(s) as Shape) : s;
    }
    return acc;
  }
}

const boxesOverlap = (a: Shape, b: Shape, tol = 1e-3) => {
  const [a0, a1] = a.boundingBox.bounds as [Vec3, Vec3];
  const [b0, b1] = b.boundingBox.bounds as [Vec3, Vec3];
  return a0.every((v, i) => v <= b1[i] + tol) && b0.every((v, i) => v <= a1[i] + tol);
};

/** Aktuální tvary těles dílu během prvku (název → tvar) a jejich zápis zpět do jádra. */
type BodyState = { cur: Map<string, Shape>; weld: Set<string>; changed: Set<string>; active: string };
function bodyState(ctx: ExtBuildCtx, list: BodyEntry[]): BodyState {
  return { cur: new Map(list.map((e) => [e.name, e.shape])), weld: new Set(list.filter((e) => e.weld).map((e) => e.name)), changed: new Set(), active: ctx.activeBody ?? list[0]?.name ?? "" };
}

/** Odebere nástroj (úpravu) ze všech těles dílu kromě svarových, kterých se týká. */
async function cutFromBodies(st: BodyState, tool: Shape, only?: string) {
  const r = await rep();
  for (const [name, shape] of st.cur) {
    if (st.weld.has(name) || (only && name !== only) || !boxesOverlap(shape, tool)) continue;
    const v0 = r.measureVolume(shape);
    let cut: Shape;
    try {
      cut = shape.clone().cut(tool.clone()) as Shape;
    } catch {
      throw new Error(tr("Úpravu svarových ploch se nepodařilo vyříznout do tělesa „{0}“ – zkontrolujte rozměry úpravy.", name));
    }
    if (Math.abs(r.measureVolume(cut) - v0) < 1e-6 * Math.max(1, v0)) continue;
    st.cur.set(name, cut);
    st.changed.add(name);
  }
}

/** Zapíše upravená tělesa (kromě aktivního) do jádra; vrací aktivní těleso. */
function commitBodies(ctx: ExtBuildCtx, st: BodyState): Shape | null {
  for (const name of st.changed) if (name !== st.active) ctx.putBody?.(name, st.cur.get(name)!);
  return st.changed.has(st.active) ? (st.cur.get(st.active) ?? ctx.body) : ctx.body;
}

/** názvy těles svaru tohoto prvku */
function myWeldBodies(ctx: ExtBuildCtx, list: BodyEntry[]): string[] {
  return weldBodyNames(ctx.doc.features, ctx.index, list.map((e) => e.name));
}

function putWeldBody(ctx: ExtBuildCtx, name: string, shape: Shape) {
  if (!ctx.putBody) throw new Error(tr("Jádro nepodporuje samostatná tělesa svarů."));
  ctx.putBody(name, shape);
}

// ---------------- tupý svar ----------------

type Joint = {
  /** počátek: kořenová strana spáry na referenční rovině (x = 0 průřezu), začátek spoje */
  O: Vec3;
  u: Vec3;
  tau: Vec3;
  /** do připravovaného dílu (osa x průřezu) */
  dvec: Vec3;
  L: number;
  t: number;
  /** skutečná mezera v modelu */
  gm: number;
  kind: JointKind;
};

/** Spoj z rovinného čela J připravovaného dílu (tauHint = normála plochy na straně svaru, uHint = směr hrany). */
function faceJoint(o: OC, J: R.Face, others: Shape[], d: GrooveData, prepBoth: boolean, tauHint?: Vec3, uHint?: Vec3): Joint {
  if (J.geomType !== "PLANE") throw new Error(tr("Čelo spoje musí být rovinná plocha (čelo plechu nebo profilu)."));
  const c = vt(J.center);
  const nu = norm(vt(J.normalAt(J.center)));
  const pts: Vec3[] = [];
  let longest: { dir: Vec3; l: number } | null = null;
  for (const e of J.edges) {
    const a = vt(e.startPoint);
    const b = vt(e.endPoint);
    pts.push(a, b, vt(e.pointAt(0.5)));
    if (e.geomType === "LINE") {
      const l = len(sub(b, a));
      if (!longest || l > longest.l + 1e-9) longest = { dir: norm(sub(b, a)), l };
    }
  }
  let u = uHint ?? longest?.dir;
  if (!u) throw new Error(tr("Čelo spoje nemá rovnou hranu – tupý svar s úpravou lze zatím vést jen po rovné spáře."));
  u = norm(sub(u, mul(nu, dot(u, nu))));
  const tau0 = norm(cross(nu, u));
  let tau: Vec3;
  if (tauHint) tau = dot(tauHint, tau0) >= 0 ? tau0 : mul(tau0, -1);
  else {
    const pick = Math.abs(tau0[2]) > 1e-6 ? tau0[2] : Math.abs(tau0[1]) > 1e-6 ? tau0[1] : tau0[0];
    tau = pick >= 0 ? tau0 : mul(tau0, -1);
    if (d.flip) tau = mul(tau, -1);
  }
  const su = pts.map((p) => dot(sub(p, c), u));
  const st = pts.map((p) => dot(sub(p, c), tau));
  const u0 = Math.min(...su);
  const u1 = Math.max(...su);
  const t0 = Math.min(...st);
  const t1 = Math.max(...st);
  const L = u1 - u0;
  const t = t1 - t0;
  if (!(L > 1e-6 && t > 1e-6)) throw new Error(tr("Čelo spoje má nulový rozměr."));
  const other = otherMember(o, c, nu, others);
  if (!other) noteFeatureWarning(tr("Ve směru čela spoje do {0} mm není druhý díl – úprava se udělá jen na vybraném dílu.", MAX_GAP));
  const gm = other?.gap ?? 0;
  // druh spoje: přesahuje druhý díl za povrch připravovaného dílu (T / rohový), nebo ne (tupý)?
  let kind: JointKind = "butt";
  if (other && !prepBoth) {
    const beyond = add(c, mul(nu, gm + 0.5));
    const f = inside(o, add(beyond, mul(tau, t1 + 2)), other.solid);
    const rr = inside(o, add(beyond, mul(tau, t0 - 2)), other.solid);
    kind = f && rr ? "T" : f || rr ? "corner" : "butt";
  }
  const O = add(add(c, mul(u, u0)), mul(tau, t0));
  return { O, u, tau, dvec: mul(nu, -1), L, t, gm, kind };
}

/** Spoj z vyduté hrany sloučeného tělesa (kout T / rohového spoje): připravuje se stěna W, referenční rovina je plocha R. */
async function concaveJoint(o: OC, edge: R.Edge, A: R.Face, B: R.Face, solid: Shape, d: GrooveData, ca: ReturnType<typeof concaveAt>): Promise<Joint> {
  if (edge.geomType !== "LINE") throw new Error(tr("Tupý svar s úpravou lze zatím vést jen po rovné hraně."));
  const E0 = vt(edge.startPoint);
  const E1 = vt(edge.endPoint);
  const u = norm(sub(E1, E0));
  const L = len(sub(E1, E0));
  // referenční plocha R = ta s normálou bližší svislici (vodorovná pásnice), „obráceně“ prohodí
  let [rf, wf] = Math.abs(ca.a.n[2]) >= Math.abs(ca.b.n[2]) ? [ca.a, ca.b] : [ca.b, ca.a];
  if (d.flip) [rf, wf] = [wf, rf];
  void A;
  void B;
  if (Math.abs(dot(rf.n, wf.n)) > 0.05) throw new Error(tr("Šikmý T / rohový spoj (úhel stěn ≠ 90°) zatím jen koutovým svarem."));
  const dvec = rf.n; // do stěny W (ta stojí na ploše R)
  const tau = wf.n; // strana svaru = strana vybrané hrany
  let t = d.t;
  if (!(t > 0)) {
    const mid = add(add(E0, mul(u, L / 2)), mul(dvec, Math.min(2, L / 4)));
    t = (await rayDepth(solid, add(mid, mul(tau, -1e-3)), mul(tau, -1))) + 1e-3;
    if (!(t > 1e-3)) throw new Error(tr("Tloušťku stěny se nepodařilo změřit – zadejte ji (t)."));
  }
  const O = sub(E0, mul(tau, t));
  // T: pásnice pokračuje i za kořenovou stranou stěny; jinak rohový spoj
  const below = add(add(add(O, mul(u, L / 2)), mul(tau, -2)), mul(dvec, -0.5));
  const kind: JointKind = inside(o, below, solid) ? "T" : "corner";
  return { O, u, tau, dvec, L, t, gm: 0, kind };
}

export async function buildGroove(data: Record<string, unknown>, ctx: ExtBuildCtx): Promise<Shape | null> {
  const r = await rep();
  const o = await oc();
  if (!ctx.body) throw new Error(tr("Není těleso – nejdřív vytvořte spojované díly."));
  const d = grooveData(data);
  const def = prepDef(d.prep)!;
  const list = bodyList(ctx);
  d.faces = [...d.faces, ...indicesAt(o, list, "faces", data.faceAt)];
  d.edges = [...d.edges, ...indicesAt(o, list, "edges", data.edgeAt)];
  if (!d.faces.length && !d.edges.length) throw new Error(tr("Vyberte čelo spoje (plochu) nebo hranu spáry na straně svaru."));
  const allSolids = list.filter((e) => !e.weld).flatMap((e) => solidsOf(e.shape));
  const joints: Joint[] = [];
  for (const fi of d.faces) {
    const { entry, item } = pickAt(list, "faces", fi);
    if (entry.weld) throw new Error(tr("Plocha {0} patří svaru – vyberte plochu spojovaného dílu.", fi + 1));
    const owner = ownerSolid(entry, item, "face");
    joints.push(faceJoint(o, item, allSolids.filter((s) => !s.isSame(owner)), d, def.both));
  }
  for (const ei of d.edges) {
    const { entry, item: edge } = pickAt(list, "edges", ei);
    if (entry.weld) throw new Error(tr("Hrana {0} patří svaru – vyberte hranu spojovaného dílu.", ei + 1));
    if (edge.geomType !== "LINE") throw new Error(tr("Tupý svar s úpravou lze zatím vést jen po rovné hraně."));
    const owner = ownerSolid(entry, edge, "edge");
    const adj = adjacentFaces(owner, edge);
    if (adj.length !== 2) throw new Error(tr("Hrana musí ležet mezi dvěma plochami tělesa."));
    const E0 = vt(edge.startPoint);
    const E1 = vt(edge.endPoint);
    const e = norm(sub(E1, E0));
    const mid = vt(edge.pointAt(0.5));
    const ca = concaveAt(o, adj[0], adj[1], mid, e);
    if (ca.concave) {
      if (def.both && d.prep !== "I") throw new Error(tr("Úprava {0} je pro tupý spoj dvou dílů – u vnitřního koutu použijte ½V, ½Y, K, J nebo 2J, nebo vyberte čelo dílu.", d.prep));
      joints.push(await concaveJoint(o, edge, adj[0], adj[1], owner, d, ca));
      continue;
    }
    // vypouklá hrana čela: čelo = plocha, před kterou leží jiný díl; druhá plocha určuje stranu svaru
    const others = allSolids.filter((s) => !s.isSame(owner));
    const cand = adj
      .map((f, k) => ({ f, k, m: f.geomType === "PLANE" ? otherMember(o, vt(f.center), norm(vt(f.normalAt(f.center))), others) : null }))
      .filter((x) => x.m)
      .sort((a, b) => a.m!.gap - b.m!.gap);
    if (!cand.length) throw new Error(tr("K hraně {0} nepřiléhá druhý díl – vyberte hranu čela, které se dotýká druhého dílu (nebo čelo samotné).", ei + 1));
    const J = cand[0].f;
    const side = adj[1 - cand[0].k];
    joints.push(faceJoint(o, J, others, d, def.both, norm(vt(side.normalAt(mid))), e));
  }

  const names = myWeldBodies(ctx, list);
  const density = materialDensity(ctx.doc.material);
  const eff = depositionEff(d.process, d.eff);
  let weldShape: Shape | null = null;
  let backingShape: Shape | null = null;
  const st = bodyState(ctx, list);
  let length = 0;
  let volume = 0;
  let area = 0;
  let tMax = 0;
  let gUsed = d.g;
  const anchors: WeldAnchor[] = [];
  const kinds = new Set<JointKind>();
  for (const j of joints) {
    const g = Math.max(d.g, j.gm);
    if (j.gm > d.g + 0.05) noteFeatureWarning(tr("Mezera v modelu {0} mm je větší než zadaná {1} mm – počítá se se skutečnou.", Math.round(j.gm * 100) / 100, d.g));
    gUsed = g;
    const backing = d.backing && j.kind === "butt";
    if (d.backing && !backing) noteFeatureWarning(tr("Podložka se modeluje jen u tupého spoje."));
    const spec: GrooveSpec = { prep: d.prep, t: j.t, c: Math.min(d.c, j.t * 0.999), g, angle: d.angle, R: d.R, cap: d.cap, root: d.root, backing, overlap: 1 };
    if (d.prep === "I") spec.c = 0;
    const prof = grooveProfile(spec);
    // referenční rovina: střed mezery (souměrné úpravy) nebo povrch druhého dílu (jednostranné)
    const O = add(j.O, mul(j.dvec, def.both ? -j.gm / 2 : -j.gm));
    const G = extrudePieces(r, prof.groove, O, j.dvec, j.tau, j.u, j.L);
    if (!G) continue;
    await cutFromBodies(st, G);
    const W = extrudePieces(r, [...prof.groove, ...prof.caps.map((c) => c.piece)], O, j.dvec, j.tau, j.u, j.L);
    if (W) weldShape = weldShape ? (weldShape.fuse(W) as Shape) : W;
    if (prof.backing) {
      const B = extrudePieces(r, [prof.backing.map((p) => ({ p }))], O, j.dvec, j.tau, j.u, j.L);
      if (B) backingShape = backingShape ? (backingShape.fuse(B) as Shape) : B;
    }
    const a = prof.groove.reduce((s, pc) => s + contourAreaOf(pc), 0) + prof.caps.reduce((s, c) => s + segmentArea(c.chord, c.h), 0);
    area = Math.max(area, a);
    length += j.L;
    volume += a * j.L;
    tMax = Math.max(tMax, j.t);
    kinds.add(j.kind);
    const xc = (prof.top[0][0] + prof.top[1][0]) / 2;
    anchors.push({ p: add(add(add(O, mul(j.u, j.L / 2)), mul(j.dvec, xc)), mul(j.tau, j.t + d.cap)), dir: j.u, out: j.tau, depth: j.t + d.cap });
  }
  if (!weldShape) throw new Error(tr("Svarový kov se nepodařilo vytvořit."));
  const active = commitBodies(ctx, st);
  putWeldBody(ctx, names[0], weldShape);
  if (backingShape && names[1]) putWeldBody(ctx, names[1], backingShape);
  const measured = r.measureVolume(weldShape);
  const m = weldMetal(measured, density, eff, processDef(d.process)?.filler ?? true);
  const info: WeldInfo = {
    kind: "groove",
    prep: d.prep,
    joint: kinds.has("T") ? "T" : kinds.has("corner") ? "corner" : "butt",
    body: names[0],
    size: tMax,
    sizeLabel: "s",
    angle: d.prep === "I" ? 0 : d.angle,
    c: d.prep === "I" ? 0 : d.c,
    g: gUsed,
    ...(def.curved ? { R: d.R } : {}),
    t: tMax,
    cap: d.cap,
    root: d.root,
    backing: d.backing,
    length,
    count: joints.length,
    field: d.field,
    process: d.process,
    area: length > 0 ? measured / length : area,
    volume: measured,
    mass: m.mass,
    filler: m.filler,
    density,
    eff,
    anchors,
  };
  if (Math.abs(measured - volume) > 0.02 * Math.max(volume, 1)) noteFeatureWarning(tr("Objem svarového kovu z geometrie ({0} mm³) se liší od průřezu × délky ({1} mm³).", Math.round(measured), Math.round(volume)));
  noteFeatureInfo(weldInfoText(info), { weld: info });
  return active;
}

function contourAreaOf(c: CPt[]): number {
  // lomená čára s oblouky (viz weld-calc contourArea) – lokálně, aby jádro nečetlo celé UI
  const pts: Vec2[] = [];
  for (let i = 0; i < c.length; i++) {
    const cur = c[i];
    if (cur.arc && i > 0) {
      const A = c[i - 1].p;
      const M = cur.arc;
      const B = cur.p;
      const dd = 2 * (A[0] * (M[1] - B[1]) + M[0] * (B[1] - A[1]) + B[0] * (A[1] - M[1]));
      if (Math.abs(dd) > 1e-12) {
        const a2 = A[0] ** 2 + A[1] ** 2;
        const m2 = M[0] ** 2 + M[1] ** 2;
        const b2 = B[0] ** 2 + B[1] ** 2;
        const cx = (a2 * (M[1] - B[1]) + m2 * (B[1] - A[1]) + b2 * (A[1] - M[1])) / dd;
        const cy = (a2 * (B[0] - M[0]) + m2 * (A[0] - B[0]) + b2 * (M[0] - A[0])) / dd;
        const rr = Math.hypot(A[0] - cx, A[1] - cy);
        const a0 = Math.atan2(A[1] - cy, A[0] - cx);
        const am = Math.atan2(M[1] - cy, M[0] - cx);
        const a1 = Math.atan2(B[1] - cy, B[0] - cx);
        const nrm = (x: number) => ((x % (2 * Math.PI)) + 2 * Math.PI) % (2 * Math.PI);
        let sw = nrm(a1 - a0);
        if (nrm(am - a0) > sw) sw -= 2 * Math.PI;
        for (let k = 1; k < 128; k++) pts.push([cx + rr * Math.cos(a0 + (sw * k) / 128), cy + rr * Math.sin(a0 + (sw * k) / 128)]);
      }
    }
    pts.push(cur.p);
  }
  let s = 0;
  for (let i = 0; i < pts.length; i++) {
    const a = pts[i];
    const b = pts[(i + 1) % pts.length];
    s += a[0] * b[1] - b[0] * a[1];
  }
  return Math.abs(s) / 2;
}

// ---------------- koutový svar (housenka) ----------------

type BeadEdge = { edge: R.Edge; solid: Shape; entry: BodyEntry };

/** Kout pro housenku na hraně: bod v rohu, ramena l1 (po stěně) a l2 (po druhé ploše), tečna. */
type Corner = { P: Vec3; e: Vec3; l1: Vec3; l2: Vec3; gap: number };

function cornerAt(o: OC, be: BeadEdge, P: Vec3, e: Vec3, others: Shape[]): Corner {
  const adj = adjacentFaces(be.solid, be.edge);
  if (adj.length !== 2) throw new Error(tr("Hrana musí ležet mezi dvěma plochami tělesa."));
  const ca = concaveAt(o, adj[0], adj[1], P, e);
  if (ca.concave) return { P, e, l1: ca.a.t, l2: ca.b.t, gap: 0 };
  // vypouklá hrana dílu, který stojí na jiném dílu: plocha J se dotýká druhého dílu, kout tvoří stěna W a povrch druhého dílu
  const m = [0, 1].map((k) => ({ k, m: otherMember(o, add(P, mul(k === 0 ? ca.a.t : ca.b.t, 0.05)), k === 0 ? ca.a.n : ca.b.n, others) })).filter((x) => x.m && x.m.gap <= 3);
  if (!m.length) throw new Error(tr("Hrana není vnitřní (konkávní) a nedotýká se jiného dílu – housenka se dělá do koutu mezi dvěma plochami nebo dvěma díly."));
  m.sort((a, b) => a.m!.gap - b.m!.gap);
  const jn = m[0].k === 0 ? ca.a.n : ca.b.n;
  const w = m[0].k === 0 ? ca.b : ca.a;
  const l2 = norm(sub(w.n, mul(jn, dot(w.n, jn))));
  const gap = m[0].m!.gap;
  return { P: add(P, mul(jn, gap)), e, l1: w.t, l2, gap };
}

/** Těleso housenky na jedné hraně (rovná: hranol po úsecích, oblouk: rotace). */
async function beadOnEdge(o: OC, be: BeadEdge, z: number, spansOf: (L: number) => [number, number][], others: Shape[]): Promise<{ shapes: Shape[]; length: number; count: number; corner: Corner; shift: Vec3 }> {
  const r = await rep();
  const edge = be.edge;
  const E0 = vt(edge.startPoint);
  if (edge.geomType === "LINE") {
    const E1 = vt(edge.endPoint);
    const L = len(sub(E1, E0));
    const e = norm(sub(E1, E0));
    const k = cornerAt(o, be, add(E0, mul(e, L / 2)), e, others);
    const base = add(E0, sub(k.P, add(E0, mul(e, L / 2)))); // posun o mezeru
    const yDir = cross(e, k.l1);
    const tri: Vec2[] = [[0, 0], [z, 0], [z * dot(k.l2, k.l1), z * dot(k.l2, yDir)]];
    const drawing = r.draw(tri[0]).lineTo(tri[1]).lineTo(tri[2]).close();
    const shapes: Shape[] = [];
    let length = 0;
    for (const [s, l] of spansOf(L)) {
      if (l <= 1e-6) continue;
      shapes.push(drawing.sketchOnPlane(new r.Plane(add(base, mul(e, s)), k.l1, e)).extrude(l) as unknown as Shape);
      length += l;
    }
    return { shapes, length, count: shapes.length, corner: { ...k, P: add(base, mul(e, L / 2)) }, shift: sub(base, E0) };
  }
  if (edge.geomType === "CIRCLE") {
    const pA = vt(edge.pointAt(0));
    const pM = vt(edge.pointAt(0.5));
    const pB = vt(edge.pointAt(0.25));
    // kružnice třemi body
    const ab = sub(pB, pA);
    const am = sub(pM, pA);
    const nrm = cross(ab, am);
    const n2 = dot(nrm, nrm);
    if (n2 < 1e-18) throw new Error(tr("Oblouk hrany se nepodařilo určit."));
    const C = add(pA, mul(add(mul(cross(nrm, ab), dot(am, am)), mul(cross(am, nrm), dot(ab, ab))), 1 / (2 * n2)));
    const rad = len(sub(pA, C));
    const axis = norm(nrm);
    const angle = (edge.length / rad) * (180 / Math.PI);
    const e = norm(vt(edge.tangentAt(0)));
    const k = cornerAt(o, be, pA, e, others);
    const P = k.P;
    const yDir = cross(e, k.l1);
    const tri: Vec2[] = [[0, 0], [z, 0], [z * dot(k.l2, k.l1), z * dot(k.l2, yDir)]];
    const sk = r.draw(tri[0]).lineTo(tri[1]).lineTo(tri[2]).close().sketchOnPlane(new r.Plane(P, k.l1, e));
    // smysl otáčení: tečna v počátku = osa × (P − C)
    const sgn = dot(cross(axis, sub(pA, C)), e) >= 0 ? 1 : -1;
    const solid = sk.revolve(mul(axis, sgn), { origin: C, angle: Math.min(360, angle) }) as unknown as Shape;
    return { shapes: [solid], length: edge.length, count: 1, corner: { ...k, P: add(C, mul(sub(pM, C), 1)) }, shift: sub(P, pA) };
  }
  throw new Error(tr("Housenku lze vést po rovné hraně nebo oblouku (hrana {0}).", edge.geomType));
}

/** Uzavřená smyčka koutu, na které leží hrana (svar kolem): drát plochy, jehož všechny hrany jsou kout. */
function aroundLoop(o: OC, be: BeadEdge, others: Shape[], label: number): R.Edge[] {
  const adj = adjacentFaces(be.solid, be.edge);
  for (const f of adj) {
    const wires = (f as unknown as { wires: R.Wire[] }).wires ?? [];
    for (const w of wires) {
      const edges = w.edges;
      if (!edges.some((x) => x.isSame(be.edge)) || (edges.length < 2 && !be.edge.isClosed)) continue;
      const ok = edges.every((x) => {
        try {
          const P = vt(x.pointAt(0.5));
          const e = norm(vt(x.tangentAt(0.5)));
          cornerAt(o, { ...be, edge: x }, P, e, others);
          return true;
        } catch {
          return false;
        }
      });
      if (ok) return edges;
    }
  }
  throw new Error(tr("Kolem hrany {0} není uzavřený kout (svar kolem potřebuje uzavřenou smyčku, např. profil postavený na desce).", label));
}

/** Hrana na druhé straně stěny (oboustranný svar): rovnoběžná, posunutá přes stěnu proti jednomu rameni koutu, nejbližší. */
function partnerEdge(o: OC, be: BeadEdge, others: Shape[]): R.Edge | null {
  const edge = be.edge;
  if (edge.geomType !== "LINE") return null;
  const E0 = vt(edge.startPoint);
  const E1 = vt(edge.endPoint);
  const e = norm(sub(E1, E0));
  const mid = add(E0, mul(sub(E1, E0), 0.5));
  const k = cornerAt(o, be, mid, e, others);
  const close = (a: Vec3, b: Vec3) => dot(a, b) > 0.99;
  let best: { edge: R.Edge; d: number } | null = null;
  for (const x of be.solid.edges) {
    if (x.isSame(edge) || x.geomType !== "LINE") continue;
    const a = vt(x.startPoint);
    const b = vt(x.endPoint);
    const ex = norm(sub(b, a));
    if (Math.abs(dot(ex, e)) < 0.999) continue;
    const xm = add(a, mul(sub(b, a), 0.5));
    const off = sub(xm, mid);
    for (const [A, B] of [[k.l1, k.l2], [k.l2, k.l1]] as [Vec3, Vec3][]) {
      const across = -dot(off, A);
      if (across < 1e-3 || Math.abs(dot(off, B)) > 1e-3 + k.gap) continue;
      if (best && across >= best.d) continue;
      try {
        const kx = cornerAt(o, { ...be, edge: x }, xm, ex, others);
        const mA = mul(A, -1);
        if (!((close(kx.l1, mA) && close(kx.l2, B)) || (close(kx.l2, mA) && close(kx.l1, B)))) continue;
      } catch {
        continue;
      }
      best = { edge: x, d: across };
    }
  }
  return best?.edge ?? null;
}

/** Výplň rohu smyčky „kolem“ mezi dvěma rovnými housenkami: rotace průřezu kolem společné hrany rohu (rameno po stěně). */
async function cornerFill(V: Vec3, ki: Corner, kj: Corner, z: number): Promise<Shape | null> {
  const r = await rep();
  // společné rameno (po stěně – svislá hrana rohu) a ramena po desce
  let axis: Vec3 | null = null;
  let pi: Vec3 | null = null;
  let pj: Vec3 | null = null;
  for (const [ai, bi] of [[ki.l1, ki.l2], [ki.l2, ki.l1]] as [Vec3, Vec3][])
    for (const [aj, bj] of [[kj.l1, kj.l2], [kj.l2, kj.l1]] as [Vec3, Vec3][])
      if (!axis && dot(ai, aj) > 0.999) {
        axis = ai;
        pi = bi;
        pj = bj;
      }
  if (!axis || !pi || !pj) return null;
  const ang = (Math.acos(Math.max(-1, Math.min(1, dot(pi, pj)))) * 180) / Math.PI;
  if (ang < 1) return null;
  const sgn = dot(cross(pi, pj), axis) >= 0 ? 1 : -1;
  const e = norm(cross(axis, pi));
  const yDir = cross(e, axis);
  const tri: Vec2[] = [[0, 0], [z, 0], [z * dot(pi, axis), z * dot(pi, yDir)]];
  try {
    const sk = r.draw(tri[0]).lineTo(tri[1]).lineTo(tri[2]).close().sketchOnPlane(new r.Plane(V, axis, e));
    return sk.revolve(mul(axis, sgn), { origin: V, angle: ang }) as unknown as Shape;
  } catch {
    return null;
  }
}

export async function buildBead(data: Record<string, unknown>, ctx: ExtBuildCtx, b: { edges: number[]; a: number; measure: "a" | "z"; intermittent: boolean; segLen: number; pitch: number; both: boolean; allAround: boolean; separate: boolean; field: boolean; process: string; eff: number }): Promise<Shape | null> {
  const o = await oc();
  if (!ctx.body) throw new Error(tr("Není těleso – nejdřív vytvořte profily."));
  const list = bodyList(ctx);
  b = { ...b, edges: [...b.edges, ...indicesAt(o, list, "edges", data.edgeAt)] };
  if (!b.edges.length) throw new Error(tr("Vyberte hranu vnitřního rohu v modelu."));
  if (!(b.a > 0)) throw new Error(tr("Velikost svaru musí být kladná."));
  const allSolids = list.filter((e) => !e.weld).flatMap((e) => solidsOf(e.shape));
  // vybrané hrany (+ smyčka kolem, + druhá strana)
  const items: BeadEdge[] = [];
  const addItem = (x: BeadEdge) => {
    if (!items.some((y) => y.edge.isSame(x.edge))) items.push(x);
  };
  for (const idx of b.edges) {
    const { entry, item } = pickAt(list, "edges", idx);
    if (entry.weld) throw new Error(tr("Hrana {0} patří svaru – vyberte hranu spojovaného dílu.", idx + 1));
    const be: BeadEdge = { edge: item, solid: ownerSolid(entry, item, "edge"), entry };
    const others = allSolids.filter((s) => !s.isSame(be.solid));
    if (b.allAround) {
      for (const x of aroundLoop(o, be, others, idx + 1)) addItem({ ...be, edge: x });
      continue;
    }
    addItem(be);
    if (b.both) {
      const p = partnerEdge(o, be, others);
      if (!p) throw new Error(tr("Druhou stranu stěny u hrany {0} se nepodařilo najít – vyberte obě hrany ručně.", idx + 1));
      addItem({ ...be, edge: p });
    }
  }
  // velikost: a / z a úhel koutu (z první hrany)
  const shapes: Shape[] = [];
  let length = 0;
  let count = 0;
  let fs = filletSize(b.a, b.measure);
  const anchors: WeldAnchor[] = [];
  const done: { it: BeadEdge; res: Awaited<ReturnType<typeof beadOnEdge>>; z: number }[] = [];
  for (const it of items) {
    const others = allSolids.filter((s) => !s.isSame(it.solid));
    const e0 = it.edge.geomType === "LINE" ? norm(sub(vt(it.edge.endPoint), vt(it.edge.startPoint))) : norm(vt(it.edge.tangentAt(0.5)));
    const kk = cornerAt(o, it, vt(it.edge.pointAt(0.5)), e0, others);
    const ang = (Math.acos(Math.max(-1, Math.min(1, dot(kk.l1, kk.l2)))) * 180) / Math.PI;
    fs = filletSize(b.a, b.measure, ang);
    const spans = (L: number) => (b.intermittent && b.pitch > 0 ? intermittent(L, b.segLen, b.pitch).spans : ([[0, L]] as [number, number][]));
    const res = await beadOnEdge(o, it, fs.z, spans, others);
    done.push({ it, res, z: fs.z });
    shapes.push(...res.shapes);
    length += res.length;
    count += res.count;
    if (anchors.length < 2) anchors.push({ p: add(res.corner.P, mul(add(res.corner.l1, res.corner.l2), fs.z / 2)), dir: e0, out: norm(add(res.corner.l1, res.corner.l2)) });
  }
  if (!shapes.length) throw new Error(tr("Housenka je prázdná – zkontrolujte délku úseku a rozteč."));
  // svar kolem: rohy mezi rovnými housenkami vyplnit (rotace průřezu kolem rohové hrany)
  if (b.allAround && !b.intermittent && done.length > 1)
    for (let i = 0; i < done.length; i++) {
      const A = done[i];
      const B = done[(i + 1) % done.length];
      if (A.it.edge.geomType !== "LINE" || B.it.edge.geomType !== "LINE") continue;
      const ends = (x: R.Edge) => [vt(x.startPoint), vt(x.endPoint)];
      const V = ends(A.it.edge).find((p) => ends(B.it.edge).some((q) => len(sub(p, q)) < 1e-6));
      if (!V) continue;
      const fill = await cornerFill(add(V, A.res.shift), A.res.corner, B.res.corner, A.z);
      if (fill) shapes.push(fill);
    }
  let bead = shapes[0];
  for (const s of shapes.slice(1)) bead = bead.fuse(s) as Shape;
  const r = await rep();
  const measured = r.measureVolume(bead);
  const density = materialDensity(ctx.doc.material);
  const eff = depositionEff(b.process, b.eff);
  const m = weldMetal(measured, density, eff);
  const names = b.separate ? myWeldBodies(ctx, list) : [];
  const info: WeldInfo = {
    kind: "fillet",
    size: b.measure === "z" ? fs.z : fs.a,
    sizeLabel: b.measure,
    z: fs.z,
    a: fs.a,
    length,
    count,
    ...(b.intermittent ? { segLen: b.segLen, pitch: b.pitch } : {}),
    both: b.both && !b.allAround,
    allAround: b.allAround,
    field: b.field,
    process: b.process,
    area: fs.area,
    volume: measured,
    mass: m.mass,
    filler: m.filler,
    density,
    eff,
    anchors,
    ...(names[0] ? { body: names[0] } : {}),
  };
  noteFeatureInfo(weldInfoText(info), { weld: info });
  if (b.separate) {
    putWeldBody(ctx, names[0], bead);
    return ctx.body;
  }
  // starší chování: housenka sloučená s tělesem, ke kterému patří první hrana
  const first = items[0].entry;
  if (first.shape === ctx.body) return ctx.body.fuse(bead) as Shape;
  ctx.putBody?.(first.name, first.shape.fuse(bead) as Shape);
  return ctx.body;
}

// ---------------- děrový / žlábkový a bodový svar ----------------

type RowData = { faces: number[]; d: number; slot: number; n: number; pitch: number; axis: "long" | "short"; shift: number; t: number; cap: number; field: boolean; process: string; eff: number };
export function rowData(data: Record<string, unknown>, spot: boolean): RowData {
  return {
    faces: Array.isArray(data.faces) ? (data.faces as number[]) : [],
    d: num(data.d, spot ? 6 : 12),
    slot: num(data.slot, 0),
    n: Math.max(1, Math.round(num(data.n, spot ? 5 : 2))),
    pitch: num(data.pitch, spot ? 40 : 60),
    axis: data.axis === "short" ? "short" : "long",
    shift: num(data.shift, 0),
    t: num(data.t, 0),
    cap: num(data.cap, 0),
    field: !!data.field,
    process: String(data.process ?? (spot ? "21" : "135")),
    eff: num(data.eff, 0),
  };
}

/** Rovinná plocha řady: střed, normála ven, směr řady (delší / kratší strana plochy). */
function rowFrame(face: R.Face, axis: "long" | "short"): { c: Vec3; n: Vec3; u: Vec3; v: Vec3 } {
  if (face.geomType !== "PLANE") throw new Error(tr("Vyberte rovinnou plochu horního plechu."));
  const c = vt(face.center);
  const n = norm(vt(face.normalAt(face.center)));
  let longest: { dir: Vec3; l: number } | null = null;
  for (const e of face.edges)
    if (e.geomType === "LINE") {
      const a = vt(e.startPoint);
      const b = vt(e.endPoint);
      const l = len(sub(b, a));
      if (!longest || l > longest.l + 1e-9) longest = { dir: norm(sub(b, a)), l };
    }
  let u = longest?.dir ?? perp(n);
  if (axis === "short") u = norm(cross(n, u));
  // jednoznačný smysl řady (kladně podél globální osy)
  const k = Math.abs(u[0]) > 1e-6 ? u[0] : Math.abs(u[1]) > 1e-6 ? u[1] : u[2];
  if (k < 0) u = mul(u, -1);
  return { c, n, u, v: cross(n, u) };
}
function perp(n: Vec3): Vec3 {
  return norm(Math.abs(n[2]) < 0.9 ? cross(n, [0, 0, 1]) : cross(n, [1, 0, 0]));
}

export async function buildPlug(data: Record<string, unknown>, ctx: ExtBuildCtx): Promise<Shape | null> {
  const r = await rep();
  const o = await oc();
  if (!ctx.body) throw new Error(tr("Není těleso – nejdřív vytvořte plechy přeplátovaného spoje."));
  const p = rowData(data, false);
  const list = bodyList(ctx);
  p.faces = [...p.faces, ...indicesAt(o, list, "faces", data.faceAt)];
  if (!p.faces.length) throw new Error(tr("Vyberte horní plochu horního plechu."));
  if (!(p.d > 0)) throw new Error(tr("Průměr / šířka otvoru musí být kladná."));
  const { entry, item: face } = pickAt(list, "faces", p.faces[0]);
  if (entry.weld) throw new Error(tr("Plocha patří svaru – vyberte plochu plechu."));
  const solid = ownerSolid(entry, face, "face");
  const fr = rowFrame(face, p.axis);
  let t = p.t;
  if (!(t > 0)) t = (await rayDepth(solid, add(fr.c, mul(fr.n, -1e-3)), mul(fr.n, -1))) + 1e-3;
  if (!(t > 1e-3)) throw new Error(tr("Tloušťku horního plechu se nepodařilo změřit – zadejte ji (t)."));
  const slot = p.slot > p.d ? p.slot : 0;
  const tools: Shape[] = [];
  const domes: Shape[] = [];
  const xs = rowPositions(p.n, p.pitch, p.shift);
  for (const x of xs) {
    const at = add(fr.c, mul(fr.u, x));
    if (pointDist(o, at, face).d > 1e-4) throw new Error(tr("Otvor v poloze {0} mm leží mimo vybranou plochu – zmenšete rozteč nebo počet.", Math.round(x * 10) / 10));
    const base = sub(at, mul(fr.n, t));
    const plane = new r.Plane(base, fr.u, fr.n);
    const dr = slot ? r.drawRoundedRectangle(slot, p.d, p.d / 2 - 1e-6) : r.drawCircle(p.d / 2);
    tools.push(dr.sketchOnPlane(plane).extrude(t) as unknown as Shape);
    if (!slot && p.cap > 0) {
      const Rs = ((p.d / 2) ** 2 + p.cap * p.cap) / (2 * p.cap);
      const sphere = r.makeSphere(Rs).translate(add(at, mul(fr.n, p.cap - Rs))) as unknown as Shape;
      const cyl = r.makeCylinder(p.d / 2, p.cap, at, fr.n) as unknown as Shape;
      domes.push(sphere.intersect(cyl) as Shape);
    }
  }
  let tool = tools[0];
  for (const s of tools.slice(1)) tool = tool.fuse(s) as Shape;
  // otvor jen v tělese horního plechu (těleso vybrané plochy); svar ho vyplní až k dolnímu plechu
  const st = bodyState(ctx, list);
  await cutFromBodies(st, tool, entry.name);
  const active = commitBodies(ctx, st);
  let weld = tool;
  for (const dm of domes) weld = weld.fuse(dm) as Shape;
  const names = myWeldBodies(ctx, list);
  putWeldBody(ctx, names[0], weld);
  const measured = r.measureVolume(weld);
  const density = materialDensity(ctx.doc.material);
  const eff = depositionEff(p.process, p.eff);
  const m = weldMetal(measured, density, eff, processDef(p.process)?.filler ?? true);
  const area = plugArea(p.d, slot);
  const info: WeldInfo = {
    kind: slot ? "slot" : "plug",
    joint: "lap",
    body: names[0],
    size: p.d,
    sizeLabel: "d",
    t,
    cap: slot ? 0 : p.cap,
    length: slot ? slot * xs.length : 0,
    count: xs.length,
    ...(slot ? { slotLen: slot } : {}),
    pitch: xs.length > 1 ? p.pitch : 0,
    field: p.field,
    process: p.process,
    area,
    volume: measured,
    mass: m.mass,
    filler: m.filler,
    density,
    eff,
    anchors: [{ p: add(fr.c, mul(fr.u, xs[0])), dir: fr.u, out: fr.n }],
  };
  const expect = xs.length * (area * t + (slot ? 0 : domeVolume(p.d, p.cap)));
  if (Math.abs(measured - expect) > 0.02 * expect) noteFeatureWarning(tr("Objem svarového kovu z geometrie ({0} mm³) se liší od výpočtu ({1} mm³).", Math.round(measured), Math.round(expect)));
  noteFeatureInfo(weldInfoText(info), { weld: info });
  return active;
}

/** výška značky bodového svaru nad plochou (jen zobrazení – do hmotnosti se nepočítá) */
export const SPOT_MARK = 0.2;

export async function buildSpot(data: Record<string, unknown>, ctx: ExtBuildCtx): Promise<Shape | null> {
  const r = await rep();
  const o = await oc();
  if (!ctx.body) throw new Error(tr("Není těleso – nejdřív vytvořte plechy."));
  const p = rowData(data, true);
  const list = bodyList(ctx);
  p.faces = [...p.faces, ...indicesAt(o, list, "faces", data.faceAt)];
  if (!p.faces.length) throw new Error(tr("Vyberte horní plochu horního plechu."));
  if (!(p.d > 0)) throw new Error(tr("Průměr bodu musí být kladný."));
  const { entry, item: face } = pickAt(list, "faces", p.faces[0]);
  if (entry.weld) throw new Error(tr("Plocha patří svaru – vyberte plochu plechu."));
  const fr = rowFrame(face, p.axis);
  const xs = rowPositions(p.n, p.pitch, p.shift);
  const marks: Shape[] = [];
  for (const x of xs) {
    const at = add(fr.c, mul(fr.u, x));
    if (pointDist(o, at, face).d > 1e-4) throw new Error(tr("Bod v poloze {0} mm leží mimo vybranou plochu – zmenšete rozteč nebo počet.", Math.round(x * 10) / 10));
    marks.push(r.makeCylinder(p.d / 2, SPOT_MARK, at, fr.n) as unknown as Shape);
  }
  const names = myWeldBodies(ctx, list);
  putWeldBody(ctx, names[0], r.makeCompound(marks as never) as unknown as Shape);
  const density = materialDensity(ctx.doc.material);
  const info: WeldInfo = {
    kind: "spot",
    joint: "lap",
    body: names[0],
    size: p.d,
    sizeLabel: "d",
    length: 0,
    count: xs.length,
    pitch: xs.length > 1 ? p.pitch : 0,
    field: p.field,
    process: p.process,
    area: (Math.PI * p.d * p.d) / 4,
    volume: 0,
    mass: 0,
    filler: 0,
    density,
    eff: 1,
    anchors: [{ p: add(fr.c, mul(fr.u, xs[0])), dir: fr.u, out: fr.n }],
  };
  noteFeatureInfo(weldInfoText(info), { weld: info });
  return ctx.body;
}

/** Kotva ruční značky svaru na hraně (výkres). */
export async function symbolAnchor(data: Record<string, unknown>, ctx: ExtBuildCtx): Promise<void> {
  const edges = Array.isArray(data.edges) ? (data.edges as number[]) : [];
  if (!edges.length || !ctx.body) return;
  const list = bodyList(ctx);
  const { item: edge } = pickAt(list, "edges", edges[0]);
  const P = vt(edge.pointAt(0.5));
  const e = norm(vt(edge.tangentAt(0.5)));
  const out = perp(e);
  noteFeatureInfo(tr("značka u hrany {0}", edges[0] + 1), { weldMark: { anchors: [{ p: P, dir: e, out }] } });
}

export { isOpeningAngle, grooveData, type GrooveData };
