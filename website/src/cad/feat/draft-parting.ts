/**
 * Úkos s dělicí křivkou a stupňovitý úkos (7. vlna – tvary). Obaluje stavitele „draft“ z `pattern.ts` (registr stavitelů –
 * build.ts ani pattern.ts se nemění): s `partingSketchId` staví zde, jinak předá původnímu staviteli.
 *
 * Dělicí křivka = skica `partingSketchId`, směr tahu = `pull` (jinak normála základní roviny `plane`):
 *  - skica kolmá na směr tahu → rovinná dělicí křivka: dělicí (neutrální) rovina = rovina skici, platí pro obě strany (přesně);
 *  - skica rovnoběžná se směrem tahu (např. v nárysu) → profil dělicí čáry: křivka se promítne podél normály skici na plochy
 *    (plocha dělení = křivka vytažená podél normály skici skrz těleso), křivka musí postupovat jedním směrem (svislé skoky = stupně).
 * Těleso se rozdělí na části nad a pod dělicí plochou a po sloupcích podle úseků křivky (BRepAlgoAPI_Common s historií –
 * vybrané plochy se dohledají jako jejich kusy). Kusy vybraných ploch nad křivkou se zkosí směrem tahu, pod křivkou proti němu,
 * vždy kolem neutrální roviny úseku (BRepOffsetAPI_DraftAngle); části se pak sloučí – nesoulad sousedních sloupců vyplní stupně.
 *  - úkos podle dělicí křivky: neutrální rovina úseku = rovina úseku dělicí plochy (obsahuje úsek křivky) → dělicí čára zůstane
 *    na místě; přímý úsek = přesně, oblouk / spline = lomená náhrada po rovinných úsecích (přibližně, ⚠);
 *  - stupňovitý úkos (`step`): každý úsek se zkosí od vlastní neutrální roviny kolmé na tah (výška úseku, u šikmého jeho střed),
 *    sousední úseky spojí stupňové plochy (klasický stupňovitý úkos formy).
 */
import { tr } from "../i18n";
import * as r from "replicad";
import { axisPlane, planeOf } from "../build";
import { resolveDirection, V, type ResolveCtx } from "../ref-resolve";
import { arcPoints, shapeSegs, splinePoints } from "../sketch";
import { pathEntities } from "../poly-close";
import type { Feature, Vec2, Vec3 } from "../types";
import { tangentFaces } from "./pattern";
import { getFeatureBuilder, registerFeatureBuilder, type FeatCtx } from "./registry";

type Shape = r.Shape3D;
type DraftF = Extract<Feature, { type: "draft" }>;
type SketchF = Extract<Feature, { type: "sketch" }>;
type OC = any;
const oc = (): OC => r.getOC() as OC;
const DEG = Math.PI / 180;
const vt = (v: { x: number; y: number; z: number }): Vec3 => [v.x, v.y, v.z];
const fmt = (n: number) => String(Math.round(n * 100) / 100).replace(".", ",");
const rc = (ctx: FeatCtx): ResolveCtx => ({ body: ctx.body, sketches: ctx.sketches, features: ctx.features });

/** Počet rovinných úseků na oblouk / spline dělicí křivky. */
export const PARTING_ARC_SEGMENTS = 8;

// ---------------- dělicí křivka v rovině skici ----------------

/** Body dělicí křivky skici (2D, v pořadí po křivce) + zda je zakřivená. Jedna souvislá otevřená křivka. */
export function partingPolyline(sk: SketchF): { pts: Vec2[]; curved: boolean } {
  type Piece = { pts: Vec2[]; curved: boolean };
  const pieces: Piece[] = [];
  // automaticky uzavřené čáry z textu jako otevřené, bez uzavíracích úseček (poly-close.ts)
  for (const e of pathEntities(sk.entities)) {
    if (e.construction) continue;
    if (e.type === "line") pieces.push({ pts: [e.a, e.b], curved: false });
    // uzavřená lomená čára – uzavírací úsek se pro dělicí čáru vynechá
    else if (e.type === "polyline") pieces.push({ pts: e.points, curved: false });
    else if (e.type === "arc") pieces.push({ pts: arcPoints(e.a, e.b, e.c, PARTING_ARC_SEGMENTS), curved: true });
    else if (e.type === "spline") pieces.push({ pts: splinePoints(e.points, e.closed, 4), curved: true });
    else if (e.type === "point") continue;
    else {
      const segs = shapeSegs(e);
      if (segs) for (const s of segs) pieces.push(s.kind === "line" ? { pts: [s.a, s.b], curved: false } : { pts: arcPoints(s.a, s.m, s.b, PARTING_ARC_SEGMENTS), curved: true });
    }
  }
  if (!pieces.length) throw new Error(tr("Skica dělicí křivky „{0}“ neobsahuje žádnou křivku.", sk.name));
  // řetězení kusů do jedné křivky (konce do 1e-3)
  const eq = (a: Vec2, b: Vec2) => Math.abs(a[0] - b[0]) < 1e-3 && Math.abs(a[1] - b[1]) < 1e-3;
  const left = pieces.slice();
  const deg = (p: Vec2) => pieces.reduce((n, q) => n + (eq(q.pts[0], p) ? 1 : 0) + (eq(q.pts[q.pts.length - 1], p) ? 1 : 0), 0);
  let start = left.findIndex((q) => deg(q.pts[0]) === 1);
  let chain: Vec2[];
  if (start < 0) {
    start = left.findIndex((q) => deg(q.pts[q.pts.length - 1]) === 1);
    chain = start < 0 ? left[0].pts.slice() : left[start].pts.slice().reverse();
    left.splice(Math.max(0, start), 1);
  } else {
    chain = left[start].pts.slice();
    left.splice(start, 1);
  }
  while (left.length) {
    const end = chain[chain.length - 1];
    const j = left.findIndex((q) => eq(q.pts[0], end) || eq(q.pts[q.pts.length - 1], end));
    if (j < 0) throw new Error(tr("Dělicí křivka musí být jedna souvislá čára (skica „{0}“ má mezery nebo větve).", sk.name));
    const q = left.splice(j, 1)[0];
    const pts = eq(q.pts[0], end) ? q.pts : q.pts.slice().reverse();
    chain.push(...pts.slice(1));
  }
  return { pts: chain, curved: pieces.some((p) => p.curved) };
}

/** Úsek dělicí čáry v souřadnicích (h = vodorovně v rovině skici, v = podél směru tahu). */
export type PartSeg = { h0: number; v0: number; h1: number; v1: number };

/**
 * Profil dělicí čáry v (h, v): seřadí podle h (křivka nesmí couvat), sloučí body, prodlouží konce vodorovně za těleso.
 * Vrací úseky se šířkou (svislé skoky mezi nimi = stupně) a počet svislých skoků.
 */
export function partingProfile(hv: Vec2[], hMin: number, hMax: number, tol: number): { segs: PartSeg[]; jumps: number } {
  let p = hv.slice();
  if (p.length < 2) throw new Error(tr("Dělicí křivka musí mít aspoň dva body."));
  if (p[0][0] > p[p.length - 1][0]) p.reverse();
  const out: Vec2[] = [p[0]];
  for (const q of p.slice(1)) {
    const last = out[out.length - 1];
    if (q[0] < last[0] - tol) throw new Error(tr("Dělicí křivka se ve směru kolmém na tah vrací – každému místu smí odpovídat jediná výška (svislé skoky jsou dovoleny)."));
    if (Math.abs(q[0] - last[0]) <= tol && Math.abs(q[1] - last[1]) <= tol) continue;
    out.push(Math.abs(q[0] - last[0]) <= tol ? [last[0], q[1]] : q);
  }
  p = out;
  // prodloužení konců za těleso: ve směru krajního úseku (svislý krajní úsek = vodorovně)
  const margin = Math.max(1, (hMax - hMin) * 0.1);
  const slope = (a: Vec2, b: Vec2) => (Math.abs(b[0] - a[0]) > tol ? (b[1] - a[1]) / (b[0] - a[0]) : 0);
  if (p[0][0] > hMin - margin) {
    const h = hMin - margin;
    const k = p.length > 1 ? slope(p[0], p[1]) : 0;
    p.unshift([h, p[0][1] + k * (h - p[0][0])]);
  }
  if (p[p.length - 1][0] < hMax + margin) {
    const h = hMax + margin;
    const n = p.length;
    const k = n > 1 ? slope(p[n - 2], p[n - 1]) : 0;
    p.push([h, p[n - 1][1] + k * (h - p[n - 1][0])]);
  }
  const segs: PartSeg[] = [];
  let jumps = 0;
  for (let i = 0; i + 1 < p.length; i++) {
    const [h0, v0] = p[i];
    const [h1, v1] = p[i + 1];
    if (h1 - h0 <= tol) {
      jumps++;
      continue;
    }
    // navazující úsek ve stejném směru (prodloužení konce) = jeden úsek
    const prev = segs[segs.length - 1];
    if (prev && Math.abs(prev.h1 - h0) <= tol && Math.abs(prev.v1 - v0) <= tol && Math.abs((prev.v1 - prev.v0) / (prev.h1 - prev.h0) - (v1 - v0) / (h1 - h0)) < 1e-9) {
      prev.h1 = h1;
      prev.v1 = v1;
      continue;
    }
    segs.push({ h0, v0, h1, v1 });
  }
  return { segs, jumps };
}

// ---------------- jádro ----------------

/** Průnik tělesa s oblastí + kusy sledovaných ploch v průniku (historie BRepAlgoAPI_Common). */
function commonWithPieces(body: Shape, tool: Shape, track: r.Face[]): { shape: Shape | null; pieces: r.Face[] } {
  const o = oc();
  const b = new o.BRepAlgoAPI_Common(body.wrapped, tool.wrapped, new o.Message_ProgressRange());
  try {
    if (!b.IsDone()) throw new Error(tr("Rozdělení tělesa dělicí plochou se nepodařilo (booleovská operace jádra selhala)."));
    const shape = r.cast(b.Shape()) as Shape;
    if (!shape || shape.isNull || !shape.solids?.length || r.measureVolume(shape) <= 1e-9) return { shape: null, pieces: [] };
    const pieces: r.Face[] = [];
    for (const F of track) {
      const lst = b.Modified(F.wrapped);
      try {
        if (lst.IsEmpty()) {
          if (!b.IsDeleted(F.wrapped)) pieces.push(F);
        } else
          while (!lst.IsEmpty()) {
            const s = r.cast(lst.First());
            if (s instanceof r.Face) pieces.push(s);
            lst.RemoveFirst();
          }
      } finally {
        lst.delete();
      }
    }
    // jen kusy, které v průniku opravdu jsou
    const faces = shape.faces;
    return { shape, pieces: pieces.filter((p) => faces.some((f) => f.isSame(p))) };
  } finally {
    b.delete();
  }
}

/** Úkos ploch tělesa: směr tahu `dir`, neutrální rovina (bod, normála). */
function draftFaces(solid: Shape, faces: r.Face[], dir: Vec3, angleDeg: number, origin: Vec3, normal: Vec3): Shape {
  const o = oc();
  const b = new o.BRepOffsetAPI_DraftAngle(solid.wrapped);
  const d = new o.gp_Dir(dir[0], dir[1], dir[2]);
  const p = new o.gp_Pnt(origin[0], origin[1], origin[2]);
  const n = new o.gp_Dir(normal[0], normal[1], normal[2]);
  const pln = new o.gp_Pln(p, n);
  try {
    for (const f of faces) {
      b.Add(f.wrapped, d, angleDeg * DEG, pln, false);
      if (!b.AddDone()) throw new Error(tr("Plochu nelze zkosit kolem dělicí křivky – plocha je kolmá na směr tahu nebo ji jádro neumí naklopit."));
    }
    b.Build(new o.Message_ProgressRange());
    if (!b.IsDone()) throw new Error(tr("Úkos kolem dělicí křivky se nepodařilo dopočítat (sousední plochy nelze znovu protnout) – zmenšete úhel nebo upravte výběr ploch."));
    const out = r.cast(b.Shape());
    if (!r.isShape3D(out)) throw new Error(tr("Úkos kolem dělicí křivky nevrátil těleso."));
    return out;
  } finally {
    b.delete();
    d.delete();
    p.delete();
    n.delete();
    pln.delete();
  }
}

type Region = { tool: Shape; dir: Vec3; origin: Vec3; normal: Vec3 };

const baseNormal = (f: DraftF): Vec3 => vt(axisPlane(f.plane, 0).zDir);

/** Krajní hodnoty projekce obalového kvádru tělesa na směr. */
function spanAlong(body: Shape, dir: Vec3): [number, number] {
  const [a, b] = body.boundingBox.bounds as [Vec3, Vec3];
  let lo = Infinity;
  let hi = -Infinity;
  for (const x of [a[0], b[0]]) for (const y of [a[1], b[1]]) for (const z of [a[2], b[2]]) {
    const t = V.dot([x, y, z], dir);
    lo = Math.min(lo, t);
    hi = Math.max(hi, t);
  }
  return [lo, hi];
}

/** Hranol z mnohoúhelníku (3D body v rovině) vytažený o vektor. */
function prism(pts: Vec3[], along: Vec3): Shape {
  return r.basicFaceExtrusion(r.makePolygon(pts) as r.Face, new r.Vector(along)) as Shape;
}

export type PartingInfo = { mode: "plane" | "profile"; regions: number; segments: number; jumps: number; curved: boolean };
/** Údaje posledního úkosu s dělicí křivkou (pro testy). */
export let lastPartingInfo: PartingInfo | null = null;

function partingDraft(f: DraftF, ctx: FeatCtx): Shape {
  const body = ctx.body;
  if (!body) throw new Error(tr("Není těleso pro úkos."));
  if (!(Math.abs(f.angle) > 0 && Math.abs(f.angle) < 45)) throw new Error(tr("Úhel úkosu musí být mezi 0 a 45°."));
  const sk = ctx.sketches.get(f.partingSketchId ?? "");
  if (!sk) throw new Error(tr("Vyberte skicu dělicí křivky (skica musí být v historii před úkosem)."));
  const all = body.faces;
  const idx = f.tangentChain ? tangentFaces(body, f.faces) : f.faces;
  const picked = [...new Set(idx)].map((k) => all[k]).filter(Boolean);
  if (!picked.length) throw new Error(tr("Vyberte plochy, které se mají zkosit (obvykle boční plochy, přes které vede dělicí křivka)."));
  const d = V.norm(f.pull ? resolveDirection(rc(ctx), f.pull, { normal: baseNormal(f) }) : baseNormal(f));
  const pl = planeOf(sk.plane);
  const O = vt(pl.origin);
  const nS = V.norm(vt(pl.zDir));
  const c = Math.abs(V.dot(nS, d));
  const [vLo, vHi] = spanAlong(body, d);
  const diag = Math.hypot(...V.sub((body.boundingBox.bounds as [Vec3, Vec3])[1], (body.boundingBox.bounds as [Vec3, Vec3])[0])) || 100;
  const big = diag * 4;
  const regions: Region[] = [];
  let info: PartingInfo;
  if (c > Math.cos(DEG)) {
    // rovinná dělicí křivka: dělicí = neutrální rovina skici pro obě strany
    const h = V.perp(d);
    const k = V.cross(d, h);
    const sq = (s: number) => [V.add(V.add(O, V.mul(h, -big)), V.mul(k, -big)), V.add(V.add(O, V.mul(h, big)), V.mul(k, -big)), V.add(V.add(O, V.mul(h, big)), V.mul(k, big)), V.add(V.add(O, V.mul(h, -big)), V.mul(k, big))].map((p) => V.add(p, V.mul(d, s)));
    const level = V.dot(O, d);
    if (level <= vLo || level >= vHi) ctx.warn?.(tr("Rovina dělicí křivky těleso neprotíná – celé těleso se zkosí na jednu stranu."));
    regions.push({ tool: prism(sq(0), V.mul(d, big)), dir: d, origin: O, normal: d });
    regions.push({ tool: prism(sq(0), V.mul(d, -big)), dir: V.mul(d, -1), origin: O, normal: d });
    info = { mode: "plane", regions: 2, segments: 1, jumps: 0, curved: false };
    if (f.step) ctx.warn?.(tr("Dělicí křivka je rovinná (skica kolmá na tah) – stupňovitý úkos je zde totožný s úkosem kolem dělicí roviny."));
  } else if (c < Math.sin(DEG)) {
    // profil dělicí čáry v rovině rovnoběžné s tahem: h = vodorovně v rovině skici, v = podél tahu, s = podél normály skici
    const hdir = V.norm(V.cross(d, nS));
    const { pts, curved } = partingPolyline(sk);
    const W = (p: Vec2): Vec3 => vt(pl.toWorldCoords(p));
    const hv: Vec2[] = pts.map((p) => {
      const q = V.sub(W(p), O);
      return [V.dot(q, hdir), V.dot(q, d)];
    });
    const [hLo, hHi] = spanAlong(body, hdir).map((x) => x - V.dot(O, hdir)) as [number, number];
    const tol = Math.max(1e-6, diag * 1e-7);
    const { segs, jumps } = partingProfile(hv, hLo, hHi, tol);
    const [sLo, sHi] = spanAlong(body, nS).map((x) => x - V.dot(O, nS)) as [number, number];
    const vTop = vHi - V.dot(O, d) + diag;
    const vBot = vLo - V.dot(O, d) - diag;
    for (const s of segs) if (s.v0 >= vTop || s.v0 <= vBot) throw new Error(tr("Dělicí křivka leží mimo těleso."));
    const P3 = (h: number, v: number, s: number): Vec3 => V.add(V.add(V.add(O, V.mul(hdir, h)), V.mul(d, v)), V.mul(nS, s));
    const s0 = sLo - diag * 0.1;
    const depth = V.mul(nS, sHi - sLo + diag * 0.2);
    let slanted = 0;
    /** úseky, které tělesem opravdu procházejí (prodloužení za tělesem se nepočítají) */
    const inner = segs.filter((s) => s.h1 > hLo + tol && s.h0 < hHi - tol).length;
    for (const s of segs) {
      const crosses = s.h1 > hLo + tol && s.h0 < hHi - tol;
      const up = prism([P3(s.h0, s.v0, s0), P3(s.h1, s.v1, s0), P3(s.h1, vTop, s0), P3(s.h0, vTop, s0)], depth);
      const down = prism([P3(s.h0, vBot, s0), P3(s.h1, vBot, s0), P3(s.h1, s.v1, s0), P3(s.h0, s.v0, s0)], depth);
      const flat = Math.abs(s.v1 - s.v0) <= tol;
      if (!flat && crosses) slanted++;
      let origin: Vec3;
      let normal: Vec3;
      if (f.step || flat) {
        // stupňovitý: neutrální rovina kolmá na tah ve výšce úseku (u šikmého v jeho středu)
        origin = P3((s.h0 + s.h1) / 2, (s.v0 + s.v1) / 2, 0);
        normal = d;
      } else {
        // dělicí čára zůstává: neutrální rovina = rovina úseku dělicí plochy (obsahuje úsek a normálu skici)
        const g = V.norm(V.add(V.mul(hdir, s.h1 - s.h0), V.mul(d, s.v1 - s.v0)));
        const n = V.norm(V.cross(g, nS));
        normal = V.dot(n, d) < 0 ? V.mul(n, -1) : n;
        origin = P3(s.h0, s.v0, 0);
        if (Math.abs(V.dot(normal, d)) < Math.cos(60 * DEG)) throw new Error(tr("Úsek dělicí křivky je příliš strmý (víc než 60° od kolmice na tah) – zkosit kolem něj nelze; použijte stupňovitý úkos nebo svislý skok."));
      }
      regions.push({ tool: up, dir: d, origin, normal });
      regions.push({ tool: down, dir: V.mul(d, -1), origin, normal });
    }
    info = { mode: "profile", regions: regions.length, segments: inner, jumps, curved };
    if (curved) ctx.warn?.(tr("Dělicí křivka je zakřivená – úkos se počítá po {0} rovinných úsecích (přibližně, mezi úseky drobné stupně).", inner));
    else if (!f.step && slanted && inner > 1) ctx.warn?.(tr("Dělicí čára má {0} úseků – každý se zkosí kolem své roviny; mezi nerovnoběžnými úseky vzniknou drobné přechodové stupně.", inner));
    if (!f.step && jumps) ctx.warn?.(tr("Svislé úseky dělicí křivky ({0}) nelze použít jako neutrální – plochy po obou stranách spojí stupňové plochy.", jumps));
    if (f.step && slanted) ctx.warn?.(tr("Stupňovitý úkos: {0} šikmých úseků – neutrální rovina kolmá na tah prochází středem úseku.", slanted));
  } else {
    throw new Error(tr("Rovina skici dělicí křivky musí být kolmá na směr tahu (rovinná dělicí křivka), nebo s ním rovnoběžná (profil dělicí čáry, např. skica v nárysu). Odchylka je {0}°.", fmt(Math.acos(Math.min(1, c)) / DEG)));
  }
  lastPartingInfo = info;
  const parts: Shape[] = [];
  for (const g of regions) {
    const { shape, pieces } = commonWithPieces(body, g.tool, picked);
    if (!shape) continue;
    parts.push(pieces.length ? draftFaces(shape, pieces, g.dir, f.angle, g.origin, g.normal) : shape);
  }
  if (!parts.length) throw new Error(tr("Dělicí plocha těleso nerozdělila – zkontrolujte polohu skici dělicí křivky."));
  let out = parts[0];
  for (const p of parts.slice(1)) {
    const prev = out;
    try {
      out = prev.fuse(p);
    } catch {
      throw new Error(tr("Zkosené části tělesa se nepodařilo sloučit (booleovská operace jádra selhala) – zmenšete úhel."));
    }
  }
  return out;
}

// ---------------- registrace: obalit původního stavitele úkosu ----------------

const base = getFeatureBuilder("draft");
registerFeatureBuilder("draft", (f, ctx) => {
  if (f.partingSketchId !== undefined && f.partingSketchId !== null) return partingDraft(f, ctx);
  if (!base) throw new Error(tr("Úkos není k dispozici."));
  return base(f, ctx);
});
