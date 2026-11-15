/**
 * Kola a ozubení – sdílené stavební kameny jádra: úsek profilu → hrana (úsečka, přesný kruhový oblouk, interpolovaný
 * B-spline s derivacemi na koncích), profil → drát / plocha, hranol (jedna rovinná plocha → jeden MakePrism), rotační
 * polotovar, díra s drážkou pro pero, volby těla (náboj, stojina, sražení, odlehčovací díry, stavěcí šroub) a umístění.
 * Geometrie se počítá v `cad/gears/*` (čistá matematika); tady se z ní jen staví tvary OpenCascade.
 */
import * as r from "replicad";
import { cutAll, fuseAll } from "../fastbool";
import { boreContour, hasHub, hasWeb, holesPcd, innerR, webOuterR } from "../gears/common";
import { arcSweep, rot2, segReverse, TAU } from "../gears/num";
import { SET_SCREWS } from "../gears/tables";
import type { BodyOpts, Profile2D, Seg2, Vec2 } from "../gears/types";
import { tr } from "../i18n";
import { interpolateCurve } from "../spline-occ";
import type { Vec3 } from "../types";
import type { Shape } from "./registry";

/** zobrazení 2D bodu profilu do prostoru (afinní) */
export type Lift = (p: Vec2) => Vec3;
export const liftXY = (z = 0): Lift => (p) => [p[0], p[1], z];
/** rovina XZ: x profilu → X, y profilu → Z, v hloubce y */
export const liftXZ = (y = 0): Lift => (p) => [p[0], y, p[1]];
/** poloviční řez (r, z) v rovině XZ */
export const liftRZ: Lift = (p) => [p[0], 0, p[1]];

const sub = (a: Vec3, b: Vec3): Vec3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];

/** Hrana jednoho úseku profilu. Oblouk = skutečná kružnice (po vysunutí válcová plocha), křivka = B-spline přes přesné body. */
export function segEdge(s: Seg2, lift: Lift): r.Edge {
  if (s.t === "line") return r.makeLine(lift(s.a), lift(s.b));
  if (s.t === "arc") {
    const sw = arcSweep(s);
    const at = (a: number): Vec3 => lift([s.c[0] + s.r * Math.cos(a), s.c[1] + s.r * Math.sin(a)]);
    return r.makeThreePointArc(at(s.a0), at(s.a0 + sw / 2), at(s.a0 + sw));
  }
  const o = lift([0, 0]);
  const dir = (d: Vec2): Vec3 => sub(lift(d), o);
  const tangents: (Vec3 | null)[] = s.pts.map(() => null);
  tangents[0] = dir(s.d0);
  tangents[s.pts.length - 1] = dir(s.d1);
  return interpolateCurve(s.pts.map(lift), { params: s.params, tangents }).edge;
}

/** otočení / posun úseku pro k-tý zub profilu */
export function toothSegs(p: Profile2D, k: number): Seg2[] {
  if (k === 0) return p.tooth;
  if (p.pitch) return p.tooth.map((s) => moveSeg(s, 0, [k * p.pitch!, 0]));
  return p.tooth.map((s) => moveSeg(s, (TAU * k) / p.count, [0, 0]));
}
function moveSeg(s: Seg2, a: number, d: Vec2): Seg2 {
  const mv = (q: Vec2): Vec2 => {
    const t = a ? rot2(q, a) : q;
    return [t[0] + d[0], t[1] + d[1]];
  };
  if (s.t === "line") return { t: "line", a: mv(s.a), b: mv(s.b) };
  if (s.t === "arc") return { ...s, c: mv(s.c), a0: s.a0 + a, a1: s.a1 + a };
  return { ...s, pts: s.pts.map(mv), d0: a ? rot2(s.d0, a) : s.d0, d1: a ? rot2(s.d1, a) : s.d1 };
}

/** hrany uzavřeného obrysu (všechny zuby) */
export function profileEdges(p: Profile2D, lift: Lift): r.Edge[] {
  const out: r.Edge[] = [];
  for (let k = 0; k < p.count; k++) for (const s of toothSegs(p, k)) out.push(segEdge(s, lift));
  return out;
}
/** uzavřený drát celého profilu (kolo: všech z zubů) */
export function profileWire(p: Profile2D, lift: Lift = liftXY()): r.Wire {
  return r.assembleWire(profileEdges(p, lift));
}
/** drát z úseků (jednou; např. obrys díry s drážkou). `reverse` = opačný směr (otvor v ploše). */
export function segsWire(segs: Seg2[], lift: Lift = liftXY(), reverse = false): r.Wire {
  const list = reverse ? [...segs].reverse().map(segReverse) : segs;
  return r.assembleWire(list.map((s) => segEdge(s, lift)));
}
/** kružnice v rovině z = konst.; `reverse` = po směru hodin (otvor) */
export function circleWire(rad: number, c: Vec2 = [0, 0], z = 0, reverse = false): r.Wire {
  // dva půloblouky: plná kružnice jako jedna hrana má šev v jediném vrcholu, se kterým si některé operace jádra neporadí
  const half: Seg2[] = [
    { t: "arc", c, r: rad, a0: 0, a1: Math.PI, ccw: true },
    { t: "arc", c, r: rad, a0: Math.PI, a1: TAU, ccw: true },
  ];
  return segsWire(half, liftXY(z), reverse);
}

/** hranol z rovinné plochy (vnější drát + otvory) vysunutý o `h` podél `dir` */
export function prism(outer: r.Wire, holes: r.Wire[], h: number, dir: Vec3 = [0, 0, 1]): Shape {
  const face = r.makeFace(outer, holes);
  return r.basicFaceExtrusion(face, new r.Vector([dir[0] * h, dir[1] * h, dir[2] * h])) as Shape;
}

/** rotační těleso z polovičního řezu (r, z) kolem osy Z */
export function revolveSection(sec: Vec2[]): Shape {
  const pts = sec.map(liftRZ);
  const edges = pts.map((p, i) => r.makeLine(p, pts[(i + 1) % pts.length]));
  const face = r.makeFace(r.assembleWire(edges));
  return r.revolution(face, [0, 0, 0], [0, 0, 1], 360);
}
/** rotační těleso z obrysu s oblouky (úseky v rovině (r, z)) */
export function revolveSegs(segs: Seg2[]): Shape {
  return r.revolution(r.makeFace(segsWire(segs, liftRZ)), [0, 0, 0], [0, 0, 1], 360);
}

/** otvory v čelní ploše kola: díra (s drážkou) a odlehčovací díry – dráty po směru hodin v rovině z */
export function bodyHoleWires(o: BodyOpts, g: { rootR: number; m: number }, z = 0, holes = true): r.Wire[] {
  const out: r.Wire[] = [];
  if (o.bore > 0) {
    const c = boreContour(o);
    out.push(c ? segsWire(c, liftXY(z), true) : circleWire(o.bore / 2, [0, 0], z, true));
  }
  if (holes && o.holesN > 0 && o.holesD > 0) {
    const pr = holesPcd(o, g.rootR, g.m) / 2;
    // díry mezi osami zubů a mimo drážku pro pero (ta je na +Y): první díra na ose −Y
    for (let k = 0; k < o.holesN; k++) {
      const a = -Math.PI / 2 + (TAU * k) / o.holesN;
      out.push(circleWire(o.holesD / 2, [pr * Math.cos(a), pr * Math.sin(a)], z, true));
    }
  }
  return out;
}

/** nástroj díry (s drážkou) a odlehčovacích děr přes z ∈ [z0, z1] – pro tělesa, která nevznikla z jedné plochy */
export function bodyHoleTools(o: BodyOpts, g: { rootR: number; m: number }, z0: number, z1: number): Shape[] {
  const out: Shape[] = [];
  const h = z1 - z0 + 2;
  if (o.bore > 0) {
    const c = boreContour(o);
    out.push(prism(c ? segsWire(c, liftXY(z0 - 1)) : circleWire(o.bore / 2, [0, 0], z0 - 1), [], h));
  }
  if (o.holesN > 0 && o.holesD > 0) {
    const pr = holesPcd(o, g.rootR, g.m) / 2;
    for (let k = 0; k < o.holesN; k++) {
      const a = -Math.PI / 2 + (TAU * k) / o.holesN;
      out.push(prism(circleWire(o.holesD / 2, [pr * Math.cos(a), pr * Math.sin(a)], z0 - 1), [], h));
    }
  }
  return out;
}

/**
 * Volby těla na ozubeném kotouči z ∈ [z0, z0 + b]: náboj(e) se přidají, vybrání stojiny, sražení hlav a stavěcí šroub
 * odeberou. `bored` = kotouč už má díru a odlehčovací díry (vznikl z plochy s otvory) – náboj pak dostane stejnou díru;
 * jinak se díra, drážka a odlehčovací díry odeberou nakonec přes celou délku. `hubsDone` = náboje už tělo má (soustružený
 * polotovar z polovičního řezu) – zbývá jen díra stavěcího šroubu.
 */
export function applyBody(disc: Shape, o: BodyOpts, g: { tipR: number; rootR: number; m: number }, bored: boolean, z0 = 0, hubsDone = false): Shape {
  let s = disc;
  const hub = hasHub(o);
  const z1 = z0 + o.b;
  const zb = hub && o.hubSide !== "top" ? z0 - o.hubL : z0;
  const zt = hub && o.hubSide !== "bottom" ? z1 + o.hubL : z1;
  if (hub && !hubsDone) {
    const hubs: Shape[] = [];
    const ring = (z: number, h: number) => prism(circleWire(o.hubD / 2, [0, 0], z), bored ? bodyHoleWires(o, g, z, false) : [], h);
    if (zb < z0) hubs.push(ring(zb, z0 - zb));
    if (zt > z1) hubs.push(ring(z1, zt - z1));
    s = fuseAll(s, hubs);
  }
  const cuts: Shape[] = [];
  if (hasWeb(o)) {
    const rec = (o.b - o.webT) / 2;
    const wi = innerR(o);
    const wo = webOuterR(g.rootR, g.m);
    // bez náboje a díry sahá vybrání až k ose (plný kotouč bez otvoru)
    const ringCut = (z: number) => prism(circleWire(wo, [0, 0], z), wi > 1e-9 ? [circleWire(wi, [0, 0], z, true)] : [], rec);
    cuts.push(ringCut(z0), ringCut(z1 - rec));
  }
  if (o.chamfer > 0) {
    const c = o.chamfer;
    const e = 0.02 * g.m + 0.01; // přesah nástroje přes hlavový válec a čelo
    cuts.push(revolveSection([[g.tipR - c - e, z0 - e], [g.tipR + e, z0 - e], [g.tipR + e, z0 + c + e]]));
    cuts.push(revolveSection([[g.tipR + e, z1 - c - e], [g.tipR + e, z1 + e], [g.tipR - c - e, z1 + e]]));
  }
  if (!bored) cuts.push(...bodyHoleTools(o, g, zb, zt));
  if (o.setScrew && hub) {
    const d = SET_SCREWS[o.setScrew] ?? 0;
    const z = zt > z1 ? z1 + o.hubL / 2 : z0 - o.hubL / 2;
    if (d > 0) cuts.push(r.makeCylinder(d / 2, o.hubD / 2 + 1, [0, 0, z], [0, 1, 0]) as Shape);
  }
  if (cuts.length) s = cutAll(s, cuts);
  return s;
}

/**
 * „Jeden zub + kruhové pole“ pro hranolová kola, jejichž zuby ještě upraví rotační nástroj (boční odlehčení zubů řetězového
 * kola): z profilu se postaví JEDNA výseč (zub 0 od středu mezery −π/z po střed mezery +π/z, dole uzavřená obloukem `rIn`),
 * nástroj se odebere jen z ní, z otočených kopií a jádro (válec `rIn` s otvory) se sjednotí lepením totožných ploch
 * (BOPAlgo_GlueFull – radiální stěny sousedních výsečí jsou otočením téže plochy, takže se shodují přesně). Výsledek má
 * stejné plochy i objem jako odebrání nástroje z celého kola, jen bez z·(počet ploch zubu) průsečíků najednou: řetězové
 * kolo z 60 = 0,8 s místo 14,5 s (měřeno). `null` = profil se na výseče rozdělit nedá (oblouk `rIn` by zasáhl do zubů).
 */
export function sectorPattern(p: Profile2D, b: number, rIn: number, coreHoles: r.Wire[], cut: (sector: Shape) => Shape, z0 = 0): Shape | null {
  const z = p.count;
  const h = Math.PI / z;
  if (!(rIn > 0) || !(rIn < p.circles.root / 2 - 1e-6) || p.pitch) return null;
  const segs = p.tooth;
  const first = segs[0];
  const last = segs[segs.length - 1];
  const startOf = (sg: Seg2): Vec2 => (sg.t === "line" ? sg.a : sg.t === "arc" ? [sg.c[0] + sg.r * Math.cos(sg.a0), sg.c[1] + sg.r * Math.sin(sg.a0)] : sg.pts[0]);
  const endOf = (sg: Seg2): Vec2 => (sg.t === "line" ? sg.b : sg.t === "arc" ? [sg.c[0] + sg.r * Math.cos(sg.a1), sg.c[1] + sg.r * Math.sin(sg.a1)] : sg.pts[sg.pts.length - 1]);
  const s0 = startOf(first);
  const s1 = endOf(last);
  // výseč musí začínat a končit na ose mezery (−π/z a +π/z)
  if (Math.abs(Math.atan2(s0[1], s0[0]) + h) > 1e-9 || Math.abs(Math.atan2(s1[1], s1[0]) - h) > 1e-9) return null;
  const pin = (a: number): Vec2 => [rIn * Math.cos(a), rIn * Math.sin(a)];
  const outline: Seg2[] = [...segs, { t: "line", a: s1, b: pin(h) }, { t: "arc", c: [0, 0], r: rIn, a0: h, a1: -h, ccw: false }, { t: "line", a: pin(-h), b: s0 }];
  const one = cut(prism(segsWire(outline, liftXY(z0)), [], b));
  const copies = Array.from({ length: z - 1 }, (_, k) => one.clone().rotate((360 * (k + 1)) / z, [0, 0, 0], [0, 0, 1]) as Shape);
  const core = prism(circleWire(rIn, [0, 0], z0), coreHoles, b);
  return fuseAll(core, [one, ...copies], { optimisation: "sameFace" });
}

/**
 * Pořadí ploch kola: nejdřív souosé válce (díra, náboj, čepy hřídele, pak paty a hlavy zubů) od nejmenšího poloměru, potom
 * rovinné plochy, nakonec boky zubů. Plochy, hrany i jejich orientace zůstávají (stejná topologie, jen jiné pořadí v plášti).
 * Proč: sestava čte pro vazby jen prvních 400 ploch dílu (asm-agent.ts FACE_LIMIT) a kolo z 60 má 360 boků před dírou –
 * vazba ozubení „Ø30“ by díru nenašla. Těleso s více plášti nebo více tělesy se vrací beze změny.
 */
export function boreFacesFirst(s: Shape): Shape {
  const oc = r.getOC() as any; // eslint-disable-line @typescript-eslint/no-explicit-any -- přímé API OCCT
  const E = oc.TopAbs_ShapeEnum;
  const count = (what: unknown) => {
    const ex = new oc.TopExp_Explorer(s.wrapped, what, E.TopAbs_SHAPE);
    let n = 0;
    for (; ex.More(); ex.Next()) n++;
    ex.delete();
    return n;
  };
  if (count(E.TopAbs_SOLID) !== 1 || count(E.TopAbs_SHELL) !== 1) return s;
  const faces: { f: unknown; key: number; r: number; i: number }[] = [];
  const ex = new oc.TopExp_Explorer(s.wrapped, E.TopAbs_FACE, E.TopAbs_SHAPE);
  try {
    for (let i = 0; ex.More(); ex.Next(), i++) {
      const f = oc.TopoDS.Face(ex.Current());
      const ad = new oc.BRepAdaptor_Surface(f, true);
      let key = 2;
      let rad = 0;
      const t = ad.GetType();
      if (t === oc.GeomAbs_SurfaceType.GeomAbs_Plane) key = 1;
      else if (t === oc.GeomAbs_SurfaceType.GeomAbs_Cylinder) {
        const cy = ad.Cylinder();
        const ax = cy.Axis();
        const d = ax.Direction();
        const l = ax.Location();
        if (Math.abs(Math.abs(d.Z()) - 1) < 1e-9 && Math.hypot(l.X(), l.Y()) < 1e-7) {
          key = 0;
          rad = cy.Radius();
        }
        cy.delete();
      }
      ad.delete();
      faces.push({ f, key, r: rad, i });
    }
  } finally {
    ex.delete();
  }
  faces.sort((a, b) => a.key - b.key || a.r - b.r || a.i - b.i);
  if (faces.every((x, k) => x.i === k)) return s;
  const bld = new oc.TopoDS_Builder();
  const shell = new oc.TopoDS_Shell();
  const solid = new oc.TopoDS_Solid();
  try {
    bld.MakeShell(shell);
    for (const x of faces) bld.Add(shell, x.f);
    shell.Closed(true);
    bld.MakeSolid(solid);
    bld.Add(solid, shell);
    return r.cast(solid) as Shape;
  } finally {
    bld.delete();
  }
}

/**
 * Umístění: pootočení kolem osy Z o `turn` (°), natočení osy +Z do `axis`, posun do `at`.
 * Osa X / Y se řeší stejně jako u vestavěných prvků (build.ts `oriented`), obecný směr nejkratším otočením.
 */
export function placeShape(s: Shape, at: Vec3, axis: Vec3, turn: number): Shape {
  let out = s;
  if (turn) out = out.rotate(turn, [0, 0, 0], [0, 0, 1]);
  const [x, y, z] = axis;
  const l = Math.hypot(x, y, z) || 1;
  const d: Vec3 = [x / l, y / l, z / l];
  if (d[2] < 1 - 1e-12) {
    if (d[2] < -1 + 1e-12) out = out.rotate(180, [0, 0, 0], [1, 0, 0]);
    else {
      // osa otočení = Z × d, úhel = acos(d_z)
      const ax: Vec3 = [-d[1], d[0], 0];
      out = out.rotate((Math.acos(d[2]) * 180) / Math.PI, [0, 0, 0], ax);
    }
  }
  if (at[0] || at[1] || at[2]) out = out.translate(at);
  return out;
}

/** objem tělesa (kontrola, že stavba vrátila objemové těleso) */
export function needSolid(s: Shape, what: string): Shape {
  if (!(Math.abs(r.measureVolume(s)) > 1e-9)) throw new Error(tr("{0}: jádro nevrátilo objemové těleso – zkuste jiné rozměry.", what));
  return s;
}
