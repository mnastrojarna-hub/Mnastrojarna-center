/**
 * Tažení a šablonování s bohatým zadáním (5. vlna, modul W5-C).
 *
 * Tažení (sweep): profil = uzavřená skica (nebo kružnice bez skici), dráha = skica s křivkou. Navíc vodicí křivka
 * (auxiliary spine), kroucení (° / otáčky), měřítko na konci, tenká stěna, pevná orientace profilu a druh přechodu
 * v rozích. Kroucení a měřítko se řeší přes navzorkované řezy podél dráhy (rámec = tečna + paralelní transport
 * normály, nebo normála k vodicí křivce) a šablonování řezů bez přeuspořádání (ThruSections, CheckCompatibility=false).
 *
 * Šablonování (loft): 2+ profily, šablonování do bodu (start/end), uzavřené (plášť přes první profil znovu → těleso),
 * okrajové podmínky (kolmo / směr – aproximace pomocným řezem), osová a vodicí křivka (BRepOffsetAPI_MakePipeShell
 * s více řezy), tenká stěna.
 *
 * Stavitel vrací nové těleso; nástroj ukládá do `ctx.tools`, aby pole a zrcadlení dál fungovaly.
 */
import * as r from "replicad";
import { applyMode, combine, needSketch, planeOf, profileSketch, sketchPathWire, sketchWires } from "../build";
import { pointOf, resolveDirection, V, type ResolveCtx } from "../ref-resolve";
import type { Thin } from "../refs";
import type { Feature, Vec3 } from "../types";
import { registerFeatureBuilder, type FeatCtx } from "./registry";

type Shape = r.Shape3D;
type SketchF = Extract<Feature, { type: "sketch" }>;
type SweepF = Extract<Feature, { type: "sweep" }>;
type LoftF = Extract<Feature, { type: "loft" }>;
/** Drát profilu s hloubkou vnoření (0 = vnější obrys, 1 = otvor) a plochou (pro výběr největšího obrysu). */
export type PWire = { wire: r.Wire; depth: number; area: number };
/** Rámec řezu: bod na dráze, tečna, normála (osa X profilu), délkový parametr 0–1. */
export type Frame = { p: Vec3; t: Vec3; n: Vec3; s: number };

const rctx = (ctx: FeatCtx): ResolveCtx => ({ body: ctx.body, sketches: ctx.sketches, features: ctx.features });
const vt = (v: r.Vector): Vec3 => [v.x, v.y, v.z];
const EPS = 1e-9;

// ---------------- profily ----------------

/** Uzavřené profily skici jako dráty; s tenkou stěnou = prstenec kolem obrysu (vnější obrys + otvor), funguje i pro otevřenou křivku. */
export function profileWires(sk: SketchF, thin?: Thin): PWire[] {
  if (!thin) return sketchWires(sk);
  const s: unknown = profileSketch(sk, planeOf(sk.plane), { thin });
  const faces = s instanceof r.Sketches ? s.faces().faces : s instanceof r.Sketch || s instanceof r.CompoundSketch ? [s.face()] : [];
  const out: PWire[] = [];
  for (const face of faces) {
    out.push({ wire: face.outerWire(), depth: 0, area: r.measureArea(face) });
    for (const w of face.innerWires()) out.push({ wire: w, depth: 1, area: 0 });
  }
  if (!out.length) throw new Error(`Skica „${sk.name}“ neobsahuje profil pro tenkou stěnu.`);
  return out;
}

/** Kruhový profil bez skici: kružnice (nebo mezikruží u tenké stěny) se středem `center` kolmo na `normal`. */
export function circleProfile(radius: number, center: Vec3, normal: Vec3, thin?: Thin): PWire[] {
  if (!(radius > 0)) throw new Error("Poloměr kruhového profilu musí být kladný.");
  const circ = (rad: number, depth: number): PWire => ({ wire: r.assembleWire([r.makeCircle(rad, center, normal)]), depth, area: Math.PI * rad * rad });
  if (!thin) return [circ(radius, 0)];
  const t1 = Math.abs(thin.t1);
  const t2 = Math.abs(thin.t2 ?? thin.t1);
  if (!(t1 > 0)) throw new Error("Tloušťka tenké stěny musí být kladná.");
  const [ro, ri] = thin.side === "one" ? [radius + t1, radius] : thin.side === "in" ? [radius, radius - t1] : thin.side === "mid" ? [radius + t1 / 2, radius - t1 / 2] : [radius + t1, radius - t2];
  if (!(ri > 1e-6)) throw new Error("Tloušťka tenké stěny je větší než poloměr kruhového profilu.");
  return [circ(ro, 0), circ(ri, 1)];
}

/** Největší vnější obrys a otvory (seřazené podle plochy) jedné sady drátů. */
function outerAndHoles(ws: PWire[], what: string): { outer: r.Wire; holes: r.Wire[] } {
  const outer = ws.filter((w) => w.depth === 0).sort((a, b) => b.area - a.area)[0]?.wire;
  if (!outer) throw new Error(`${what} musí mít uzavřený vnější profil.`);
  return { outer, holes: ws.filter((w) => w.depth === 1).sort((a, b) => b.area - a.area).map((w) => w.wire) };
}

function asWire(s: r.AnyShape | unknown): r.Wire {
  if (s instanceof r.Wire) return s;
  throw new Error("Transformace profilu se nezdařila.");
}

function ensureSolid(s: Shape, what: string): Shape {
  const v = r.measureVolume(s);
  if (!(v > 1e-9)) throw new Error(`${what} nevytvořilo objemové těleso – zkontrolujte, že profil je uzavřený, leží kolmo na začátek dráhy a dráha se neprotíná.`);
  return s;
}

// ---------------- dráha a rámce ----------------

/** Rovnoměrné (po délce) vzorkování křivky: body a jednotkové tečny; `n` ≥ 2. */
export function sampleCurve(w: r.Wire, n: number): { p: Vec3; t: Vec3; s: number }[] {
  const M = Math.max(96, n * 8);
  const pts: Vec3[] = [];
  const cum: number[] = [0];
  for (let i = 0; i <= M; i++) {
    pts.push(vt(w.pointAt(i / M)));
    if (i) cum.push(cum[i - 1] + V.len(V.sub(pts[i], pts[i - 1])));
  }
  const L = cum[M];
  if (!(L > 1e-9)) throw new Error("Dráha má nulovou délku.");
  const out: { p: Vec3; t: Vec3; s: number }[] = [];
  for (let k = 0; k < n; k++) {
    const target = (L * k) / (n - 1);
    let i = 0;
    while (i < M - 1 && cum[i + 1] < target) i++;
    const seg = cum[i + 1] - cum[i];
    const f = seg > 1e-12 ? Math.max(0, Math.min(1, (target - cum[i]) / seg)) : 0;
    const u = Math.min(1, (i + f) / M);
    let t: Vec3;
    try {
      t = V.norm(vt(w.tangentAt(u)));
    } catch {
      t = V.norm(V.sub(pts[Math.min(M, i + 1)], pts[i]));
    }
    out.push({ p: vt(w.pointAt(u)), t, s: k / (n - 1) });
  }
  return out;
}

/** Celkové natočení tečny podél křivky (°) – pro volbu počtu řezů. */
function turning(w: r.Wire): number {
  const s = sampleCurve(w, 48);
  let sum = 0;
  for (let i = 1; i < s.length; i++) sum += (Math.acos(Math.max(-1, Math.min(1, V.dot(s[i - 1].t, s[i].t)))) * 180) / Math.PI;
  return sum;
}

const perpTo = (v: Vec3, t: Vec3): Vec3 | null => {
  const p = V.sub(v, V.mul(t, V.dot(v, t)));
  return V.len(p) > 1e-6 ? V.norm(p) : null;
};

/**
 * Rámce řezů podél dráhy. Normála (osa X profilu) se přenáší paralelním transportem; s vodicí křivkou míří
 * k odpovídajícímu bodu vodicí křivky (stejný poměr délky); `fixed` = všechny rámce rovnoběžné s prvním.
 */
export function pathFrames(spine: r.Wire, n: number, o: { xHint?: Vec3; guide?: r.Wire; fixed?: boolean }): Frame[] {
  const s = sampleCurve(spine, n);
  const g = o.guide ? sampleCurve(o.guide, n) : null;
  const frames: Frame[] = [];
  let prevN: Vec3 | null = null;
  for (let k = 0; k < n; k++) {
    const t = o.fixed ? s[0].t : s[k].t;
    let nrm: Vec3 | null = null;
    if (g && !o.fixed) nrm = perpTo(V.sub(g[k].p, s[k].p), t);
    if (!nrm && prevN) nrm = perpTo(prevN, t);
    if (!nrm && o.xHint) nrm = perpTo(o.xHint, t);
    if (!nrm) nrm = V.perp(t);
    if (o.fixed && prevN) nrm = prevN;
    frames.push({ p: s[k].p, t, n: nrm, s: s[k].s });
    prevN = nrm;
  }
  return frames;
}

/** Přenese drát z rámce `from` do rámce `to`, natočí o `twistDeg` kolem tečny a zvětší `scale`× kolem bodu dráhy. */
export function wireToFrame(w: r.Wire, from: Frame, to: Frame, twistDeg = 0, scale = 1): r.Wire {
  let out: r.Wire = w;
  const same = V.len(V.sub(from.p, to.p)) < EPS && V.len(V.sub(from.t, to.t)) < EPS && V.len(V.sub(from.n, to.n)) < EPS;
  if (!same) {
    const tr = new r.Transformation().coordSystemChange({ origin: to.p, zDir: to.t, xDir: to.n }, { origin: from.p, zDir: from.t, xDir: from.n });
    out = asWire(r.cast(tr.transform(out.wrapped)));
  }
  if (Math.abs(twistDeg) > EPS) out = out.rotate(twistDeg, to.p, to.t);
  if (Math.abs(scale - 1) > EPS) out = out.scale(scale, to.p);
  return out;
}

// ---------------- OCCT: šablonování řezů a trubkový plášť ----------------

/**
 * Šablonování drátů přes OCCT ThruSections. `compat=false` zachová pořadí vrcholů (nutné pro kroucení – jinak jádro
 * řezy „odkroutí“). `solid=false` vrátí plášť (pro uzavřené šablonování).
 */
export function thruSections(wires: r.Wire[], o: { ruled: boolean; solid?: boolean; compat?: boolean; start?: Vec3; end?: Vec3 }): Shape {
  const oc = r.getOC();
  const b = new oc.BRepOffsetAPI_ThruSections(o.solid ?? true, o.ruled, 1e-6);
  b.CheckCompatibility(o.compat ?? true);
  if (o.start) b.AddVertex(r.makeVertex(o.start).wrapped);
  for (const w of wires) b.AddWire(w.wrapped);
  if (o.end) b.AddVertex(r.makeVertex(o.end).wrapped);
  let s: r.AnyShape;
  try {
    b.Build();
    s = r.cast(b.Shape());
  } catch {
    throw new Error("Šablonování se nepodařilo – profily se nejspíš kříží nebo mají neslučitelný tvar.");
  } finally {
    b.delete();
  }
  if (!r.isShape3D(s)) throw new Error("Šablonování nevytvořilo těleso – zkontrolujte profily.");
  return s;
}

/** Uzavřený plášť → těleso (ShapeFix_Solid). */
function shellToSolid(shell: Shape, what: string): Shape {
  const sh = shell instanceof r.Shell ? shell : (shell as unknown as { shells?: r.Shell[] }).shells?.[0];
  if (!sh) throw new Error(`${what}: jádro nevrátilo plášť.`);
  const solid = r.makeSolid([sh]);
  const v = r.measureVolume(solid);
  if (!(Math.abs(v) > 1e-9)) throw new Error(`${what}: plášť se nepodařilo uzavřít do tělesa.`);
  return solid;
}

/**
 * Trubkový plášť OCCT (BRepOffsetAPI_MakePipeShell): jeden nebo více řezů podél osové křivky `spine`,
 * volitelně s vodicí křivkou (normála míří k vodicí křivce) nebo pevným rámcem (`fixed` = osy rámce).
 */
export function pipeShell(spine: r.Wire, sections: r.Wire[], o: { guide?: r.Wire; frenet?: boolean; fixed?: { p: Vec3; t: Vec3; n: Vec3 }; transition?: "right" | "round" | "transformed"; correction?: boolean }): Shape {
  const oc = r.getOC();
  const b = new oc.BRepOffsetAPI_MakePipeShell(spine.wrapped);
  const gc: { delete(): void }[] = [b];
  try {
    const tm = { transformed: oc.BRepBuilderAPI_TransitionMode.BRepBuilderAPI_Transformed, round: oc.BRepBuilderAPI_TransitionMode.BRepBuilderAPI_RoundCorner, right: oc.BRepBuilderAPI_TransitionMode.BRepBuilderAPI_RightCorner }[o.transition ?? "right"];
    b.SetTransitionMode(tm);
    if (o.fixed) {
      const ax = new oc.gp_Ax2(new r.Vector(o.fixed.p).toPnt(), new r.Vector(o.fixed.t).toDir(), new r.Vector(o.fixed.n).toDir());
      gc.push(ax);
      b.SetMode(ax);
    } else if (o.frenet) b.SetMode(true);
    if (o.guide) b.SetMode(o.guide.wrapped, false, oc.BRepFill_TypeOfContact.BRepFill_NoContact);
    for (const w of sections) b.Add(w.wrapped, false, !!o.correction);
    b.Build();
    if (!b.IsDone()) throw new Error("Tažení podél křivky se nepodařilo – zkontrolujte, že řezy leží na dráze a dráha je hladká.");
    b.MakeSolid();
    const s = r.cast(b.Shape());
    if (!r.isShape3D(s)) throw new Error("Tažení podél křivky nevytvořilo těleso.");
    return s;
  } finally {
    gc.forEach((x) => x.delete());
  }
}

// ---------------- tažení ----------------

/** Nástrojové těleso tažení. */
export function sweepTool(f: SweepF, ctx: FeatCtx): Shape {
  const path = needSketch(ctx, f.pathId, "skica dráhy");
  const spine = sketchPathWire(path);
  const useCircle = f.circleRadius != null;
  if (useCircle && !(f.circleRadius! > 0)) throw new Error("Poloměr kruhového profilu musí být kladný.");
  if (!useCircle && !f.profileId) throw new Error("Chybí skica profilu – vyberte ji v parametrech (nebo zvolte kruhový profil bez skici).");
  const prof = useCircle ? null : needSketch(ctx, f.profileId, "skica profilu");
  if (prof && prof.id === path.id) throw new Error("Profil a dráha musí být dvě různé skici.");
  const guideSk = f.guideId ? needSketch(ctx, f.guideId, "skica vodicí křivky") : null;
  if (guideSk && guideSk.id === path.id) throw new Error("Vodicí křivka musí být jiná skica než dráha.");
  const guide = guideSk ? sketchPathWire(guideSk) : undefined;
  const scaleEnd = f.scaleEnd ?? 1;
  if (!(scaleEnd > 0)) throw new Error("Měřítko profilu na konci musí být kladné.");
  const twist = (f.twist ?? 0) + (f.twistTurns ?? 0) * 360;

  const start = sampleCurve(spine, 2)[0];
  const wires = prof ? profileWires(prof, f.thin) : circleProfile(f.circleRadius!, start.p, start.t, f.thin);
  const xHint = prof ? vt(planeOf(prof.plane).xDir) : undefined;
  const transition = f.transition ?? "right";

  // 1) kroucení / měřítko → řezy podél dráhy a jejich šablonování (bez přeuspořádání vrcholů)
  if (Math.abs(twist) > EPS || Math.abs(scaleEnd - 1) > EPS) {
    const n = Math.max(2, Math.min(64, 2 + Math.ceil(turning(spine) / 10) + Math.ceil(Math.abs(twist) / 15)));
    const frames = pathFrames(spine, n, { xHint, guide, fixed: !!f.keepNormal });
    const loftOf = (w: r.Wire) => thruSections(frames.map((fr) => wireToFrame(w, frames[0], fr, twist * fr.s, 1 + (scaleEnd - 1) * fr.s)), { ruled: false, compat: false });
    return ensureSolid(combine(wires.map(({ wire, depth }) => ({ solid: loftOf(wire), depth }))), "Tažení s kroucením / měřítkem");
  }
  // 2) pevná orientace profilu → pevný rámec (všechny řezy rovnoběžné)
  if (f.keepNormal) {
    const fixed = { p: start.p, t: start.t, n: xHint && perpTo(xHint, start.t) ? perpTo(xHint, start.t)! : V.perp(start.t) };
    return ensureSolid(combine(wires.map(({ wire, depth }) => ({ solid: pipeShell(spine, [wire], { fixed, guide, transition }), depth }))), "Tažení s pevnou orientací profilu");
  }
  // 3) běžné tažení (Frenet / korigovaný Frenet, vodicí křivka, přechod v rozích)
  const cfg: r.GenericSweepConfig = { frenet: f.frenet, transitionMode: transition, auxiliarySpine: guide };
  return ensureSolid(combine(wires.map(({ wire, depth }) => ({ solid: r.genericSweep(wire, spine, cfg) as Shape, depth }))), "Tažení");
}

// ---------------- šablonování ----------------

const bboxCenter = (w: r.Wire): Vec3 => w.boundingBox.center as Vec3;

/** Posun pomocného řezu pro okrajovou podmínku (kolmo na profil / zadaným směrem), orientovaný k sousednímu profilu. */
function condShift(rc: ResolveCtx, sk: SketchF, section: r.Wire, toward: Vec3, cond: "none" | "normal" | "direction" | undefined, dir: LoftF["startDir"], len: number | undefined): Vec3 | null {
  if (!cond || cond === "none") return null;
  const pl = planeOf(sk.plane);
  const normal = vt(pl.zDir);
  let d = cond === "direction" ? resolveDirection(rc, dir, { normal, xDir: vt(pl.xDir) }) : normal;
  const c = bboxCenter(section);
  const dist = V.len(V.sub(toward, c));
  if (V.dot(d, V.sub(toward, c)) < 0) d = V.mul(d, -1);
  const l = len && len > 0 ? len : dist * 0.1;
  if (!(l > 1e-6)) return null;
  return V.mul(d, l);
}

/** Nástrojové těleso šablonování. */
export function loftTool(f: LoftF, ctx: FeatCtx): Shape {
  const rc = rctx(ctx);
  const sks = f.sketchIds.map((id, k) => needSketch(ctx, id, `skica ${k + 1}`));
  const start = f.startPoint ? pointOf(rc, f.startPoint, "počáteční bod šablonování") : undefined;
  const end = f.endPoint ? pointOf(rc, f.endPoint, "koncový bod šablonování") : undefined;
  if (!sks.length || sks.length + (start ? 1 : 0) + (end ? 1 : 0) < 2) throw new Error("Šablonování potřebuje alespoň dvě skici (profily), nebo jednu skicu a bod.");
  if (new Set(sks.map((s) => s.id)).size !== sks.length) throw new Error("Každý profil šablonování musí být jiná skica.");
  if (f.closed && (start || end)) throw new Error("Uzavřené šablonování nelze kombinovat s bodem na začátku / konci.");
  if (f.closed && sks.length < 3) throw new Error("Uzavřené šablonování potřebuje alespoň tři profily.");

  const sets = sks.map((sk, k) => outerAndHoles(profileWires(sk, f.thin), `Skica ${k + 1} („${sk.name}“)`));
  let outer = sets.map((s) => s.outer);
  const nHoles = sets[0].holes.length;
  const sameHoles = nHoles > 0 && sets.every((s) => s.holes.length === nHoles);
  let holes: r.Wire[][] = sameHoles ? Array.from({ length: nHoles }, (_, k) => sets.map((s) => s.holes[k])) : [];

  // okrajové podmínky – pomocné řezy (aproximace tečného náběhu)
  if (!f.closed && sks.length >= 2) {
    const s0 = start ? null : condShift(rc, sks[0], outer[0], bboxCenter(outer[1]), f.startCond, f.startDir, f.startLen);
    const last = sks.length - 1;
    const s1 = end ? null : condShift(rc, sks[last], outer[last], bboxCenter(outer[last - 1]), f.endCond, f.endDir, f.endLen);
    const ins = (ws: r.Wire[]) => {
      const out = ws.slice();
      if (s1) out.splice(last, 0, ws[last].translate(s1));
      if (s0) out.splice(1, 0, ws[0].translate(s0));
      return out;
    };
    outer = ins(outer);
    holes = holes.map(ins);
  }

  const cut = (s: Shape, tools: Shape[]) => tools.reduce((acc, t) => acc.cut(t), s);
  // osová / vodicí křivka → trubkový plášť s více řezy
  if (f.centerlineId || f.guideIds?.length) {
    if (f.closed) throw new Error("Uzavřené šablonování nelze kombinovat s osovou / vodicí křivkou.");
    if (start || end) throw new Error("Šablonování do bodu nelze kombinovat s osovou / vodicí křivkou.");
    const center = f.centerlineId ? needSketch(ctx, f.centerlineId, "skica osové křivky") : null;
    const guides = (f.guideIds ?? []).filter(Boolean).map((id) => needSketch(ctx, id, "skica vodicí křivky"));
    if ([center, ...guides].some((g) => g && sks.some((s) => s.id === g.id))) throw new Error("Osová / vodicí křivka musí být jiná skica než profily.");
    const spine = center ? sketchPathWire(center) : r.assembleWire(outer.slice(1).map((w, i) => r.makeLine(bboxCenter(outer[i]), bboxCenter(w))));
    const guide = guides.length ? sketchPathWire(guides[0]) : undefined;
    const body = pipeShell(spine, outer, { guide });
    return ensureSolid(cut(body, holes.map((h) => pipeShell(spine, h, { guide }))), "Šablonování podél křivky");
  }
  if (f.closed) {
    const ring = (ws: r.Wire[]) => shellToSolid(thruSections([...ws, ws[0]], { ruled: f.ruled, solid: false }), "Uzavřené šablonování");
    return ensureSolid(cut(ring(outer), holes.map(ring)), "Uzavřené šablonování");
  }
  const body = thruSections(outer, { ruled: f.ruled, start, end });
  const holeSolids = holes.length && outer.length >= 2 ? holes.map((h) => thruSections(h, { ruled: f.ruled })) : [];
  return ensureSolid(cut(body, holeSolids), "Šablonování");
}

// ---------------- registrace ----------------

registerFeatureBuilder("sweep", (f, ctx) => {
  const tool = sweepTool(f, ctx);
  ctx.tools.set(f.id, { tool: tool.clone(), mode: f.mode });
  return applyMode(ctx.body, tool, f.mode);
});

registerFeatureBuilder("loft", (f, ctx) => {
  const tool = loftTool(f, ctx);
  ctx.tools.set(f.id, { tool: tool.clone(), mode: f.mode });
  return applyMode(ctx.body, tool, f.mode);
});
