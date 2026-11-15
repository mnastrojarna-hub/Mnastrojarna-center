/**
 * Kola a ozubení (vlna 19, balík core) – 14 prvků rozšíření `gear.*` a skrytá akce `gear.table`.
 *
 * Každý prvek = jedna tabulka (`cad/gears/*`: řádky, výchozí hodnoty, kontrola, výpočet, profil). Tady se z vypočteného
 * profilu staví těleso:
 *  - hranolová kola (čelní, vnitřní, cykloidní, kotouč reduktoru, řetězové, řemenice, rohatka, přímý hřeben): JEDNA rovinná
 *    plocha (obrys zubů + díra, drážka, odlehčovací díry jako otvory) → jeden hranol, bez booleovských operací na zubech;
 *  - šroubová a kuželová kola (šikmé, šípové, šnek, šnekové, kuželové, hypoidní): záplaty boků jednoho zubu proložené
 *    přesnými body, z otočených kopií a rovinná víka sešité do tělesa (gears-shell.ts) – také bez booleovských operací;
 *  - náboj, stojina, sražení hlav a stavěcí šroub: booleovské operace jen s rovinnými čely a válci (gears-kernel.ts).
 * Měřeno na tomto stroji (spike): hranol z 24 / 200 = 0,13 / 0,4 s; šikmé kolo sešitím z 20 / 60 / 200 = 1,1 / 1,5 / 4,3 s;
 * průnik „objem zubů ∩ polotovar“ z návrhu trval 4,9 / 13,8 / 89 s, proto se nepoužívá.
 */
import * as r from "replicad";
import { noteFeatureWarning } from "../feature-notes";
import { cutAll, fuseAll } from "../fastbool";
import { coneSection, type BevelC, type BevelIn } from "../gears/bevel";
import { boreReach, hasHub, holesPcd, type OutMode } from "../gears/common";
import { coneGeom, coneGroups, type ConeGeom, type ConeMember } from "../gears/conic";
import { ringInner, type CycloDiscC, type CycloDiscIn } from "../gears/cyclodisc";
import type { CylC, CylIn } from "../gears/cylindrical";
import type { HypoidC, HypoidIn } from "../gears/hypoid";
import { cylProfile } from "../gears/involute";
import { DEG, segMove, TAU } from "../gears/num";
import type { PulleyC, PulleyIn } from "../gears/pulley";
import { rackTooth, type RackC, type RackIn } from "../gears/rackgear";
import { GEAR_KINDS, KINDS, rowsToParams, withDefaults, type AnyKind } from "../gears/registry";
import type { SprocketC, SprocketIn } from "../gears/sprocket";
import type { BodyOpts, GearKind, Profile2D, Seg2, Vec2 } from "../gears/types";
import { wormTransverse, type WormC, type WormIn } from "../gears/worm";
import type { WormWheelC, WormWheelIn } from "../gears/wormwheel";
import { tr } from "../i18n";
import type { Vec3 } from "../types";
import "./gears-entry";
import { applyBody, bodyHoleTools, boreFacesFirst, bodyHoleWires, circleWire, liftXY, placeShape, prism, profileWire, revolveSection, revolveSegs, segEdge, sectorPattern, segsWire } from "./gears-kernel";
import { helixStations, lateralFaces, reversedWire, sweptProfileSolid, toothVolume, type Station, type VolumeOpts } from "./gears-shell";
import { extDirection, extPoint } from "./place";
import { registerExt, setExtTool, type ExtBuildCtx, type Shape } from "./registry";

type Data = Record<string, unknown>;
type BodyG = { tipR: number; rootR: number; m: number };
/** co druh vrací: hotové kolo, polotovar a nástroj zubových mezer – vše v místní soustavě; počítá se jen to, co je potřeba */
type Built = { wheel: () => Shape; blank: () => Shape; teeth: () => Shape };

const cylinder = (rad: number, z0: number, z1: number): Shape => prism(circleWire(rad, [0, 0], z0), [], z1 - z0);
/** otvory ve víkách + jejich stěny pro tělesa sešívaná ze záplat (díra s drážkou, odlehčovací díry) */
function throughHoles(o: BodyOpts, g: BodyG, z0: number, z1: number, holes = true): VolumeOpts {
  const tools = bodyHoleTools({ ...o, holesN: holes ? o.holesN : 0 }, g, z0, z1);
  if (!tools.length) return {};
  // nástroje děr přesahují o 1 mm na obě strany – stěny se postaví znovu přesně mezi víky
  const walls: r.Face[] = [];
  for (const w of bodyHoleWires(o, g, z0, holes)) walls.push(...lateralFaces(prism(reversedWire(w), [], z1 - z0), z0, z1));
  return { capHoles: (z) => bodyHoleWires(o, g, z, holes), walls };
}
/** polotovar: rotační těleso z polovičního řezu, pak díra, drážka, odlehčovací díry a stavěcí šroub */
function blankFrom(sec: Vec2[], o: BodyOpts, g: BodyG, z0: number, z1: number): Shape {
  const hub = hasHub(o);
  const zb = hub && o.hubSide !== "top" ? z0 - o.hubL : z0;
  const zt = hub && o.hubSide !== "bottom" ? z1 + o.hubL : z1;
  let s = revolveSection(sec);
  // tělo už má náboj, stojinu i sražení v řezu – zbývají jen díry (applyBody bez těchto voleb)
  const cuts = bodyHoleTools({ ...o, b: z1 - z0 }, g, zb, zt);
  if (cuts.length) s = cutAll(s, cuts);
  if (o.setScrew && hub) s = applyBody(s, { ...o, bore: 0, holesN: 0, hubD: o.hubD, hubL: o.hubL, webT: 0, chamfer: 0, keyway: false, b: z1 - z0 }, g, true, z0, true);
  return s;
}

// ---------------- hranolová kola ----------------

/** kotouč z profilu s otvory v ploše + volby těla; `z0` = spodní líc ozubení */
function discWheel(profile: Profile2D, o: BodyOpts, g: BodyG, b: number, z0 = 0): Shape {
  return prism(profileWire(profile, liftXY(z0)), bodyHoleWires(o, g, z0), b);
}
/** nástroj zubových mezer hranolového kola: mezikruží mezi obrysem zubů a kružnicí nad hlavami */
const discTeeth = (profile: Profile2D, g: BodyG, b: number, z0 = 0): Shape => prism(circleWire(g.tipR + 0.25 * g.m, [0, 0], z0), [reversedWire(profileWire(profile, liftXY(z0)))], b);

function buildDisc(def: AnyKind, i: { body: BodyOpts }, c: unknown, g: BodyG): Built {
  const p = () => def.profile(i, c);
  const o = i.body;
  return {
    wheel: () => applyBody(discWheel(p(), o, g, o.b), o, g, true),
    blank: () => blankFrom(def.blank(i, c), o, g, 0, o.b),
    teeth: () => discTeeth(p(), g, o.b),
  };
}

// ---------------- válcová evolventní kola ----------------

function buildCyl(def: AnyKind, i: CylIn, c: CylC): Built {
  const o = i.body;
  const g: BodyG = { tipR: c.ra, rootR: c.rf, m: i.m };
  const sign = i.hand === "left" ? -1 : 1;
  const tau = c.be > 1e-12 ? (sign * Math.tan(c.be)) / c.r : 0;
  const stations = (): Station[][] => (i.kind === "herringbone" ? [helixStations(0, o.b / 2, tau, 0), helixStations(o.b / 2, o.b, -tau, o.b)] : [helixStations(0, o.b, tau, 0)]);
  if (i.internal) {
    const rim = c.rimD / 2;
    const ringG: BodyG = { tipR: rim, rootR: c.ra, m: i.m };
    const hole = () => cylProfile(i, c);
    const ring = (): Shape => (tau ? sweptProfileSolid(hole(), stations(), { outerR: rim }) : prism(circleWire(rim), [reversedWire(profileWire(hole()))], o.b));
    return {
      wheel: ring,
      blank: () => prism(circleWire(rim), [circleWire(c.ra, [0, 0], 0, true)], o.b),
      teeth: () => (tau ? sweptProfileSolid(hole(), stations()) : prism(profileWire(hole()), [], o.b)),
      ...(ringG ? {} : {}),
    };
  }
  if (!tau) return buildDisc(def, i, c, g);
  const groove = (): Shape[] => {
    if (!(i.gap > 0)) return [];
    const rg = c.rf - 0.3 * i.m;
    return [revolveSection([[rg, (o.b - i.gap) / 2], [c.ra + 1, (o.b - i.gap) / 2], [c.ra + 1, (o.b + i.gap) / 2], [rg, (o.b + i.gap) / 2]])];
  };
  return {
    wheel: () => {
      let s = applyBody(sweptProfileSolid(cylProfile(i, c), stations(), throughHoles(o, g, 0, o.b)), o, g, true);
      const gr = groove();
      if (gr.length) s = cutAll(s, gr);
      return s;
    },
    blank: () => blankFrom(def.blank(i, c), o, g, 0, o.b),
    teeth: () => sweptProfileSolid(cylProfile(i, c), stations(), { outerR: c.ra + 0.25 * i.m }),
  };
}

// ---------------- hřeben ----------------

function buildRack(i: RackIn, c: RackC): Built {
  const tooth = rackTooth(i, c);
  const be = i.beta * DEG;
  const s = i.hand === "left" ? -1 : 1;
  const top = c.h0 + c.ha;
  /** uzavřený obrys řezu od zubu k0 po k1 mezi výškami zLo (dno) a obrysem zubů, nebo mezi obrysem a zHi (nástroj mezer) */
  const section = (k0: number, k1: number, lift: (p: Vec2) => Vec3, tool: boolean): r.Wire => {
    const edges: r.Edge[] = [];
    for (let k = k0; k < k1; k++) for (const sg of tooth) edges.push(segEdge(segMove(sg, 0, [k * c.pn, c.h0]), lift));
    const x0 = k0 * c.pn;
    const x1 = k1 * c.pn;
    const zc = tool ? top + 0.25 * i.m : 0;
    const close: Seg2[] = [
      { t: "line", a: [x1, top], b: [x1, zc] },
      { t: "line", a: [x1, zc], b: [x0, zc] },
      { t: "line", a: [x0, zc], b: [x0, top] },
    ];
    for (const sg of close) edges.push(segEdge(sg, lift));
    return r.assembleWire(edges);
  };
  const box = (z0: number, z1: number): Shape => prism(segsWire([{ t: "line", a: [0, 0], b: [c.L, 0] }, { t: "line", a: [c.L, 0], b: [c.L, i.b] }, { t: "line", a: [c.L, i.b], b: [0, i.b] }, { t: "line", a: [0, i.b], b: [0, 0] }], liftXY(z0)), [], z1 - z0);
  const make = (tool: boolean): Shape => {
    if (!(be > 1e-12)) return r.basicFaceExtrusion(r.makeFace(section(0, c.n, (p) => [p[0], 0, p[1]], tool)), new r.Vector([0, i.b, 0])) as Shape;
    // šikmý hřeben: normálný profil v rovině kolmé na zuby, vysunutý ve směru zubů t = (s·sin β, cos β, 0) a oříznutý do kvádru
    const n: Vec3 = [Math.cos(be), -s * Math.sin(be), 0];
    const t: Vec3 = [s * Math.sin(be), Math.cos(be), 0];
    const us = [0, c.L * Math.cos(be), -i.b * s * Math.sin(be), c.L * Math.cos(be) - i.b * s * Math.sin(be)];
    const ws = [0, c.L * s * Math.sin(be), i.b * Math.cos(be), c.L * s * Math.sin(be) + i.b * Math.cos(be)];
    const k0 = Math.floor(Math.min(...us) / c.pn) - 1;
    const k1 = Math.ceil(Math.max(...us) / c.pn) + 1;
    const w0 = Math.min(...ws) - 1;
    const len = Math.max(...ws) - w0 + 1;
    const lift = (p: Vec2): Vec3 => [p[0] * n[0] + w0 * t[0], p[0] * n[1] + w0 * t[1], p[1]];
    const long = r.basicFaceExtrusion(r.makeFace(section(k0, k1, lift, tool)), new r.Vector([t[0] * len, t[1] * len, 0])) as Shape;
    return long.intersect(tool ? box(c.h0 - c.hf - 1, top + 0.25 * i.m) : box(0, top)) as Shape;
  };
  return { wheel: () => make(false), blank: () => box(0, i.h), teeth: () => make(true) };
}

// ---------------- řetězové kolo, řemenice ----------------

/** leží díra s drážkou a odlehčovací díry celé uvnitř poloměru `rIn` (jádro výsečového pole)? */
function holesInside(o: BodyOpts, g: BodyG, rIn: number, holes: boolean): boolean {
  if (boreReach(o) >= rIn - 1e-6) return false;
  if (holes && o.holesN > 0 && o.holesD > 0 && holesPcd(o, g.rootR, g.m) / 2 + o.holesD / 2 >= rIn - 1e-6) return false;
  return true;
}

function buildSprocket(def: AnyKind, i: SprocketIn, c: SprocketC): Built {
  const o = i.body;
  const g: BodyG = { tipR: c.da / 2, rootR: c.df / 2, m: c.p / Math.PI };
  const multi = i.rows > 1;
  /** boční odlehčení zubu: oblouk r_x končící b_a pod… na hlavě, začíná 0,44·p pod hlavou (není tečný k čelu) */
  const relief = (z: number, up: boolean): Shape => {
    const ra = c.da / 2;
    const e = 0.05 * c.p;
    const dr = 0.9 * Math.sqrt(2 * c.rx * c.ba - c.ba * c.ba);
    const P0: Vec2 = [ra - dr, 0];
    const P1: Vec2 = [ra + e, c.ba * (1 + e / dr)];
    // střed oblouku r_x procházejícího P0 a P1, vypuklého ven z materiálu
    const mx = (P0[0] + P1[0]) / 2;
    const my = (P0[1] + P1[1]) / 2;
    const d = Math.hypot(P1[0] - P0[0], P1[1] - P0[1]);
    const hh = Math.sqrt(Math.max(0, c.rx * c.rx - (d / 2) ** 2));
    const cen: Vec2 = [mx - (hh * (P1[1] - P0[1])) / d, my + (hh * (P1[0] - P0[0])) / d];
    const sg = up ? -1 : 1;
    const T = (q: Vec2): Vec2 => [q[0], z + sg * q[1]];
    const a0 = Math.atan2(P0[1] - cen[1], P0[0] - cen[0]);
    const a1 = Math.atan2(P1[1] - cen[1], P1[0] - cen[0]);
    const arc: Seg2 = up ? { t: "arc", c: T(cen), r: c.rx, a0: -a0, a1: -a1, ccw: false } : { t: "arc", c: T(cen), r: c.rx, a0, a1, ccw: true };
    return revolveSegs([arc, { t: "line", a: T(P1), b: T([ra + e, -e]) }, { t: "line", a: T([ra + e, -e]), b: T([P0[0], -e]) }, { t: "line", a: T([P0[0], -e]), b: T(P0) }]);
  };
  const wheel = () => {
    const prof = def.profile(i, c);
    const plate = (z: number): Shape => prism(profileWire(prof, liftXY(z)), bodyHoleWires(o, g, z, !multi), c.bf1);
    // odlehčení zubů na jedné výseči + kruhové pole (sectorPattern); jádro pod patou nese díru a odlehčovací díry
    const reliefTools = [relief(0, false), relief(c.bf1, true)];
    const rIn = Math.max(c.df / 2 - 0.3 * c.p, 0.5 * c.df / 2);
    const holesIn = bodyHoleWires(o, g, 0, !multi);
    const fits = holesInside(o, g, rIn, !multi);
    let s = (fits ? sectorPattern(prof, c.bf1, rIn, holesIn, (sec) => cutAll(sec, reliefTools)) : null) ?? cutAll(plate(0), reliefTools);
    if (multi) {
      const rs = Math.min(c.dg / 2, c.df / 2 - 0.1 * c.p);
      const parts: Shape[] = [];
      for (let k = 1; k < i.rows; k++) {
        parts.push(s.clone().translate([0, 0, k * c.pt]) as Shape);
        parts.push(prism(circleWire(rs, [0, 0], (k - 1) * c.pt + c.bf1), bodyHoleWires(o, g, (k - 1) * c.pt + c.bf1, false), c.pt - c.bf1));
      }
      s = fuseAll(s, parts, { optimisation: "commonFace" }); // řady a rozpěrky se dotýkají jen rovinnými čely
      const holes = bodyHoleTools({ ...o, bore: 0 }, g, 0, o.b);
      if (holes.length) s = cutAll(s, holes);
    }
    return applyBody(s, o, g, true);
  };
  return {
    wheel,
    blank: () => blankFrom(def.blank(i, c), o, g, 0, o.b),
    teeth: () => {
      const prof = def.profile(i, c);
      const one = discTeeth(prof, g, c.bf1);
      return multi ? fuseAll(one, Array.from({ length: i.rows - 1 }, (_, k) => discTeeth(prof, g, c.bf1, (k + 1) * c.pt))) : one;
    },
  };
}

function buildPulley(def: AnyKind, i: PulleyIn, c: PulleyC): Built {
  const o = i.body;
  const g: BodyG = { tipR: c.da / 2, rootR: c.df / 2, m: c.p / Math.PI };
  return {
    wheel: () => {
      let s = discWheel(def.profile(i, c), o, g, c.wt, c.ft);
      if (i.flanges) s = fuseAll(s, [prism(circleWire(c.fd / 2, [0, 0], 0), bodyHoleWires(o, g, 0), c.ft), prism(circleWire(c.fd / 2, [0, 0], c.ft + c.wt), bodyHoleWires(o, g, c.ft + c.wt), c.ft)]);
      return applyBody(s, o, g, true);
    },
    blank: () => blankFrom(def.blank(i, c), o, g, 0, o.b),
    teeth: () => discTeeth(def.profile(i, c), g, c.wt, c.ft),
  };
}

// ---------------- kotouč cykloidního reduktoru ----------------

function buildCycloDisc(def: AnyKind, i: CycloDiscIn, c: CycloDiscC): Built {
  const outHoles = (z: number, reverse: boolean): r.Wire[] => {
    const out: r.Wire[] = [];
    if (i.centerD > 0) out.push(circleWire(i.centerD / 2, [0, 0], z, reverse));
    for (let k = 0; k < i.outN && i.outD > 0; k++) {
      const a = (TAU * k) / i.outN;
      out.push(circleWire(i.outD / 2, [(c.outPcd / 2) * Math.cos(a), (c.outPcd / 2) * Math.sin(a)], z, reverse));
    }
    return out;
  };
  if (i.part === "ring") {
    const inner = (): r.Wire => {
      const one = ringInner(i, c);
      if (!one) throw new Error(tr("Čepy se nedotýkají vnitřního průměru věnce Ø{0} – zvětšete čep nebo zmenšete výstřednost.", String(Math.round(c.ringIn * 100) / 100)));
      return profileWire({ tooth: one, count: i.N, circles: { ref: 0, tip: 0, root: 0 }, area: 0 });
    };
    return {
      wheel: () => prism(circleWire(c.ringD / 2), [reversedWire(inner())], i.b),
      blank: () => prism(circleWire(c.ringD / 2), [circleWire(c.ringIn / 2, [0, 0], 0, true)], i.b),
      teeth: () => prism(inner(), [], i.b),
    };
  }
  const prof = () => def.profile(i, c);
  return {
    wheel: () => prism(profileWire(prof()), outHoles(0, true), i.b),
    blank: () => prism(circleWire(c.da / 2), outHoles(0, true), i.b),
    teeth: () => prism(circleWire(c.da / 2 + 0.25), [reversedWire(profileWire(prof()))], i.b),
  };
}

// ---------------- šnek a šnekové kolo ----------------

function buildWorm(def: AnyKind, i: WormIn, c: WormC): Built {
  const g: BodyG = { tipR: c.da / 2, rootR: c.df / 2, m: i.m };
  const o: BodyOpts = { ...i.body, b: c.L, hubD: i.shaftD, hubL: i.shaftL, hubSide: "both" };
  const tau = ((i.hand === "left" ? -1 : 1) * TAU) / c.pz;
  const thread = (z0: number, z1: number, opts: VolumeOpts = {}) => sweptProfileSolid(wormTransverse(i, c), [helixStations(z0, z1, tau, c.L / 2, 0, 0.09)], opts);
  /** čepy hřídele přišité přímo do pláště závitu (bez booleovské operace): víko závitu má otvor Ø čepu, čepy a díra jsou stěny */
  const withJournals = (): Shape | null => {
    const rj = i.shaftD / 2;
    if (!(rj < c.df / 2 - 0.01 * i.m)) return null; // čep přes patu závitu → sjednocení v applyBody
    const bore: BodyOpts = { ...i.body, holesN: 0, b: c.L };
    const boreWires = (z: number) => bodyHoleWires(bore, g, z, false);
    const journal = (z0: number, keepTop: boolean): r.Face[] =>
      prism(circleWire(rj, [0, 0], z0), boreWires(z0), i.shaftL).faces.filter((f) => {
        const [[, , a], [, , b]] = f.boundingBox.bounds;
        if (b - a > 1e-6) return true; // plášť čepu a stěny díry
        return Math.abs((a + b) / 2 - (keepTop ? z0 + i.shaftL : z0)) < 1e-6; // čelo čepu, ne styčná plocha se závitem
      });
    const boreWalls = boreWires(0).flatMap((w) => lateralFaces(prism(reversedWire(w), [], c.L), 0, c.L));
    return thread(0, c.L, { capHoles: (z) => [circleWire(rj, [0, 0], z, true)], walls: [...journal(-i.shaftL, false), ...journal(c.L, true), ...boreWalls] });
  };
  return {
    wheel: () => (i.shaftD > 0 && i.shaftL > 0 ? withJournals() : null) ?? applyBody(thread(0, c.L, throughHoles(o, g, 0, c.L, false)), o, g, true),
    blank: () => blankFrom(def.blank(i, c), o, g, 0, c.L),
    teeth: () => (prism(circleWire(c.da / 2 + 0.25 * i.m), [circleWire(c.df / 2 - 0.1 * i.m, [0, 0], 0, true)], c.L) as Shape).cut(thread(-0.5 * i.m, c.L + 0.5 * i.m)) as Shape,
  };
}

function buildWormWheel(def: AnyKind, i: WormWheelIn, c: WormWheelC): Built {
  const o = i.body;
  const g: BodyG = { tipR: c.de2 / 2, rootR: c.df2 / 2, m: i.m };
  const stations = (z0: number, z1: number) => [helixStations(z0, z1, c.tau, o.b / 2)];
  const throat = (): Shape => revolveSegs([{ t: "arc", c: [c.a, o.b / 2], r: c.rk, a0: 0, a1: Math.PI, ccw: true }, { t: "arc", c: [c.a, o.b / 2], r: c.rk, a0: Math.PI, a1: TAU, ccw: true }]);
  return {
    wheel: () => applyBody(sweptProfileSolid(cylProfile(c.cylE, c.gE), stations(0, o.b), throughHoles(o, g, 0, o.b)), o, g, true).cut(throat()) as Shape,
    blank: () => blankFrom(def.blank(i, c), o, g, 0, o.b),
    teeth: () => sweptProfileSolid(cylProfile(c.cylE, c.gE), stations(0, o.b), { outerR: c.de2 / 2 + 0.25 * i.m }),
  };
}

// ---------------- kuželové a hypoidní kolo ----------------

function buildCone(m: ConeMember, geom: ConeGeom, body: BodyOpts, mod: number): Built {
  const o: BodyOpts = { ...body, hubSide: "bottom", b: geom.zFront - geom.zBack };
  const g: BodyG = { tipR: geom.dae / 2, rootR: geom.rBack, m: mod };
  const toothed = (mm: ConeMember, withHoles: boolean): Shape => {
    const gg = coneGeom(mm);
    return toothVolume(coneGroups(mm), mm.z, withHoles ? throughHoles(o, g, gg.zBack, gg.zFront, false) : {});
  };
  return {
    wheel: () => applyBody(toothed(m, true), o, g, true, geom.zBack),
    blank: () => blankFrom(coneSection(m, geom, o), o, g, geom.zBack, geom.zFront),
    teeth: () => {
      // obálka = pás mezi kuželem těsně pod patami a kuželem nad hlavami, přesně mezi koncovými řezy; ozubené těleso je delší
      const e = 0.5 * mod;
      const pt = (R: number, hgt: number): Vec2 => {
        const k = m.taper ? R / m.Re : 1;
        const y = Math.atan((hgt * k) / R);
        const s = R / Math.cos(y);
        return [s * Math.sin(m.delta + y), m.apexZ - s * Math.cos(m.delta + y)];
      };
      const env = revolveSection([pt(m.Re, -(m.hf + 0.1 * mod)), pt(m.Re, m.ha + 0.25 * mod), pt(geom.Ri, m.ha + 0.25 * mod), pt(geom.Ri, -(m.hf + 0.1 * mod))]);
      return env.cut(toothed({ ...m, Re: m.Re + e, b: m.b + 2 * e }, false)) as Shape;
    },
  };
}

// ---------------- stavba prvku ----------------

function builders(def: AnyKind, i: unknown, c: unknown): Built {
  switch (def.kind as GearKind) {
    case "spur":
    case "helical":
    case "herringbone":
    case "internal":
      return buildCyl(def, i as CylIn, c as CylC);
    case "rack":
      return buildRack(i as RackIn, c as RackC);
    case "sprocket":
      return buildSprocket(def, i as SprocketIn, c as SprocketC);
    case "pulley":
      return buildPulley(def, i as PulleyIn, c as PulleyC);
    case "cyclodisc":
      return buildCycloDisc(def, i as CycloDiscIn, c as CycloDiscC);
    case "worm":
      return buildWorm(def, i as WormIn, c as WormC);
    case "wormwheel":
      return buildWormWheel(def, i as WormWheelIn, c as WormWheelC);
    case "bevel": {
      const bi = i as BevelIn;
      const bc = c as BevelC;
      return buildCone(bc.member, bc.geom, bi.body, bi.m);
    }
    case "hypoid": {
      const hi = i as HypoidIn;
      const hc = c as HypoidC;
      if (!hc.cone || !hc.geom || !hc.mean) throw new Error(tr("Pro toto přesazení a úhel sklonu se roztečné kužely nepodařilo najít – zmenšete přesazení E nebo úhel sklonu pastorku, případně zadejte úhel kužele kola."));
      return buildCone(hc.cone, hc.geom, hi.body, hc.mean.mmn);
    }
    default: {
      // cykloidní kolo a rohatka: hranol s volbami těla
      const di = i as { body: BodyOpts; m?: number };
      const p = def.profile(i, c);
      return buildDisc(def, di, c, { tipR: p.circles.tip / 2, rootR: p.circles.root / 2, m: di.m ?? (Math.PI * p.circles.tip) / p.count / Math.PI });
    }
  }
}

/** malá mezipaměť těles v místní soustavě: posun kola nebo úprava pozdějšího prvku nestaví zuby znovu */
const cache = new Map<string, Shape>();
const CACHE_MAX = 4;
const PLACE_KEYS = new Set(["position", "positionRef", "axis", "turn", "mode"]);
function localTool(def: AnyKind, data: Data, out: OutMode, build: () => Shape): Shape {
  const key = `${def.ext}|${out}|${JSON.stringify(Object.fromEntries(Object.entries(data).filter(([k]) => !PLACE_KEYS.has(k))))}`;
  const hit = cache.get(key);
  if (hit) {
    try {
      cache.delete(key);
      cache.set(key, hit);
      return hit.clone() as Shape;
    } catch {
      cache.delete(key); // těleso uvolnilo jádro (nové spuštění) – postavit znovu
    }
  }
  const s = build();
  cache.set(key, s.clone() as Shape);
  while (cache.size > CACHE_MAX) cache.delete(cache.keys().next().value as string);
  return s;
}
/** vyprázdní mezipaměť (testy výkonu) */
export const clearGearCache = () => cache.clear();

/** Stavba prvku ozubení: kontrola zadání → těleso v místní soustavě → umístění → operace s aktivním tělesem. */
export function buildGear(def: AnyKind, raw: Data, ctx: ExtBuildCtx): Shape {
  const data = withDefaults(def, raw);
  const i = def.read(data);
  const v = def.validate(i);
  const bad = v.issues.find((x) => x.level === "error");
  if (bad) throw new Error(bad.text);
  for (const w of v.issues) if (w.level === "warn") noteFeatureWarning(w.text);
  const out: OutMode = data.out === "blank" ? "blank" : data.out === "teeth" ? "teeth" : "wheel";
  if (out === "teeth" && !ctx.body) throw new Error(tr("Není do čeho řezat zuby – nejdřív vytvořte polotovar."));
  const local = localTool(def, data, out, () => {
    const b = builders(def, i, def.compute(i));
    const s = out === "blank" ? b.blank() : out === "teeth" ? b.teeth() : b.wheel();
    if (!(Math.abs(r.measureVolume(s)) > 1e-9)) throw new Error(tr("{0}: jádro nevrátilo objemové těleso – zkuste jiné rozměry.", def.label));
    // díra a náboj mezi prvními plochami (vazby sestavy čtou jen prvních 400 ploch dílu)
    return out === "teeth" ? s : boreFacesFirst(s);
  });
  const tool = placeShape(local, extPoint(data, ctx, "position"), extDirection(data, ctx, "axis"), Number(data.turn) || 0);
  const mode = out === "teeth" || data.mode === "cut" ? "cut" : "add";
  setExtTool(ctx, tool, mode);
  if (mode === "cut") {
    if (!ctx.body) throw new Error(tr("Není z čeho odebírat – nejdřív vytvořte těleso."));
    return ctx.body.cut(tool) as Shape;
  }
  return ctx.body ? (ctx.body.fuse(tool) as Shape) : tool;
}

for (const kind of GEAR_KINDS) {
  const def = KINDS[kind];
  registerExt({
    ext: def.ext,
    label: def.label,
    icon: "gear",
    tone: "create",
    tab: "create",
    group: "Kola a ozubení",
    hidden: true,
    hint: def.accuracy,
    toolBody: true,
    make: () => def.defaults(),
    params: rowsToParams(def.rows),
    build: (data, ctx) => buildGear(def, data, ctx),
  });
}

/** Akce „Tabulka ozubení“ (vypíše tabulky všech kol dílu) – její obsluhu v UI doplňuje balík text (components/cad/ext/gears-text-ui.ts). */
registerExt({ ext: "gear.table", label: tr("Tabulka ozubení"), icon: "gear", tone: "tool", tab: "tools", group: "Kola a ozubení", hidden: true, action: true, scope: "part", hint: tr("vypíše tabulku ozubení všech kol dílu (modul, počet zubů, průměry, rozměr přes zuby a přes kuličky)"), make: () => ({}) });
