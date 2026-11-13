/**
 * Tvářecí nástroje plechu a křížový zlom (modul rozšíření): žaluzie, prolis (důlek), žebro podél dráhy, výstřih (jazýček),
 * můstek, lem díry (límec), vodítko desky; křížový zlom panelu.
 *
 * Nástroj se umisťuje na rovinnou plochu plechu (vybraná plocha, jinak horní plocha základního plechu) do jednoho nebo více
 * bodů s natočením. Tvarovaná oblast je skořepina tloušťky plechu (soustředná zaoblení R / R + t – sheetmetal-form-geom.ts)
 * vytlačená nahoru nebo dolů; kde nástroj materiál prostřihne (žaluzie, výstřih, můstek, lem díry), je plech skutečně otevřený.
 * Stavba: z plechu se vyřízne stopa nástroje (hranice v polovině rovného okraje) a doplní se skořepina s okrajem – spoje jsou
 * přes rovinné plochy (žádné tečné dotyky v booleovských operacích).
 *
 * Křížový zlom: panel (rovinná plocha s rovnými hranami) se po úhlopříčkách (u nepravoúhlého panelu po spojnicích rohů
 * s těžištěm) velmi mírně vyklene – skutečný zlom: horní plocha = jehlan nízké výšky, spodní plocha posunutá o t.
 *
 * Rozvin tvářené nástroje nerozvíjí (jako SolidWorks) – ve výkresu rozvinu je jejich stopa a středová značka ve vrstvě FORM.
 */
import { tr } from "../i18n";
import type * as R from "replicad";
import { planeBasis } from "../defaults";
import type { Vec2, Vec3 } from "../types";
import type { Seg } from "../sketch";
import { registerExt, type ExtBuildCtx, type ExtParam, type Shape } from "./registry";
import { baseFeatureIndex, sheetParamsAt } from "./sheetmetal-flat";
import { CROSS_BREAK_EXT, FORM_EXT, formDims, formPoints, formSection, formToolLabel, halfShell, lipOf, pointOnPlane, sketchChains, tangentAt, toolAxes, type FormSection, type FormTool } from "./sheetmetal-form-geom";

type Rep = typeof R;
let repP: Promise<Rep> | null = null;
const rep = () => (repP ??= import("replicad"));

type Data = Record<string, unknown>;
const num = (v: unknown, d: number) => (typeof v === "number" && Number.isFinite(v) ? v : d);
const sub = (a: Vec3, b: Vec3): Vec3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const add = (a: Vec3, b: Vec3): Vec3 => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
const mul = (a: Vec3, s: number): Vec3 => [a[0] * s, a[1] * s, a[2] * s];
const dot = (a: Vec3, b: Vec3) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const cross = (a: Vec3, b: Vec3): Vec3 => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const norm = (a: Vec3): Vec3 => {
  const l = Math.hypot(...a) || 1;
  return [a[0] / l, a[1] / l, a[2] / l];
};
const vt = (v: { x: number; y: number; z: number }): Vec3 => [v.x, v.y, v.z];
const fmt = (n: number) => String(Math.round(n * 100) / 100).replace(".", ",");

const vol = async (s: Shape) => {
  const r = await rep();
  try {
    return r.measureVolume(s);
  } catch {
    return 0;
  }
};

/** Normála základního plechu (rovina skici obrysu), jinak +Z. */
function baseNormal(ctx: ExtBuildCtx): Vec3 {
  const bi = baseFeatureIndex(ctx.doc, ctx.index);
  const base = bi >= 0 ? ctx.doc.features[bi] : null;
  const sk = base && base.type === "ext" ? ctx.doc.features.find((f) => f.id === base.data.sketchId && f.type === "sketch") : null;
  return sk && sk.type === "sketch" ? planeBasis(sk.plane).n : [0, 0, 1];
}

/** Rovinná plocha plechu pro nástroj: vybraná (`face`), jinak největší rovinná plocha s normálou základního plechu (horní). */
export async function formFace(ctx: ExtBuildCtx, d: Data, probePoint?: (o: Vec3, n: Vec3) => number[] | null): Promise<{ face: R.Face; index: number; o: Vec3; n: Vec3 }> {
  const r = await rep();
  const body = ctx.body;
  if (!body) throw new Error(tr("Nejdřív vytvořte Základní plech."));
  const picked = (Array.isArray(d.face) ? (d.face as unknown[]) : typeof d.face === "number" ? [d.face] : []).filter((x): x is number => typeof x === "number");
  if (picked.length) {
    const idx = picked[0];
    const f = body.faces[idx];
    if (!f) throw new Error(tr("Plocha {0} v tělese neexistuje – vyberte plochu plechu znovu.", idx + 1));
    if (f.geomType !== "PLANE") throw new Error(tr("Tvářecí nástroj i křížový zlom se umisťují na rovinnou plochu plechu (plocha {0} není rovinná).", idx + 1));
    return { face: f, index: idx, o: vt(f.center), n: norm(vt(f.normalAt(f.center))) };
  }
  const nb = baseNormal(ctx);
  // kandidáti: rovinné plochy s normálou blízko normály základního plechu (i plošky křížového zlomu)
  const cands: { face: R.Face; index: number; area: number; n: Vec3; o: Vec3 }[] = [];
  body.faces.forEach((f, i) => {
    if (f.geomType !== "PLANE") return;
    const n = norm(vt(f.normalAt(f.center)));
    if (dot(n, nb) < Math.cos((10 * Math.PI) / 180)) return;
    cands.push({ face: f, index: i, area: r.measureArea(f), n, o: vt(f.center) });
  });
  if (!cands.length) throw new Error(tr("Na plechu chybí horní rovinná plocha – vyberte plochu, na kterou se má nástroj umístit."));
  cands.sort((a, b) => b.area - a.area);
  // plocha, na které leží první bod umístění (nebo začátek dráhy), jinak největší
  const probe = probePoint?.(cands[0].o, cands[0].n);
  let pick = cands[0];
  if (probe) {
    const hit = cands.find((c) => {
      const p = pointOnPlane(probe, c.o, c.n);
      try {
        return r.measureDistanceBetween(c.face, r.makeVertex(p)) < 1e-3;
      } catch {
        return false;
      }
    });
    if (hit) pick = hit;
  }
  return { face: pick.face, index: pick.index, o: pick.o, n: pick.n };
}

// ---------------- 2D řez → těleso ----------------

async function drawingOf(segs: Seg[]) {
  const r = await rep();
  let pen = r.draw(segs[0].a);
  for (const s of segs) pen = s.kind === "line" ? pen.lineTo(s.b) : pen.threePointsArcTo(s.b, s.m);
  return pen.close();
}

/** Profil v rovině (s, h) – osa s = `sW`, osa h = `hW` (kolmé jednotkové) – vysunutý podél sW × hW v rozsahu [a0, a1]. */
async function extrudeSection(segs: Seg[], o: Vec3, sW: Vec3, hW: Vec3, a0: number, a1: number): Promise<Shape> {
  const r = await rep();
  const e = cross(sW, hW);
  const plane = new r.Plane(add(o, mul(e, a0)), sW, e);
  return (await drawingOf(segs)).sketchOnPlane(plane).extrude(a1 - a0) as Shape;
}

/** Profil (s ≥ 0 = poloměr, h) otočený kolem osy hW v bodě o; `angle` [°], osa rotace `axis` (výchozí hW). */
async function revolveSection(segs: Seg[], o: Vec3, sW: Vec3, hW: Vec3, angle = 360, axis: Vec3 = hW, center: Vec3 = o): Promise<Shape> {
  const r = await rep();
  const plane = new r.Plane(o, sW, cross(sW, hW));
  return (await drawingOf(segs)).sketchOnPlane(plane).revolve(axis, { origin: center, angle }) as Shape;
}

/** Deska (výřez) v rozsahu s ∈ [s0, s1], a ∈ [a0, a1] přes tloušťku plechu s přesahem. */
async function cutBox(o: Vec3, sW: Vec3, hW: Vec3, c: { s0: number; s1: number; a0: number; a1: number }, t: number, over: number): Promise<Shape> {
  const r = await rep();
  const e = cross(sW, hW);
  const plane = new r.Plane(add(o, mul(hW, -(t + over))), sW, hW);
  // y osa roviny = hW × sW = −e
  const w = c.s1 - c.s0;
  const h = c.a1 - c.a0;
  void e;
  return r
    .drawRectangle(w, h)
    .translate((c.s0 + c.s1) / 2, -(c.a0 + c.a1) / 2)
    .sketchOnPlane(plane)
    .extrude(t + 2 * over) as Shape;
}

async function cutCylinder(o: Vec3, hW: Vec3, radius: number, t: number, over: number): Promise<Shape> {
  const r = await rep();
  return r.makeCylinder(radius, t + 2 * over, add(o, mul(hW, -(t + over))), hW) as Shape;
}

const overOf = (t: number) => Math.max(0.05, 0.1 * t);

/** Konvexní mnohoúhelník půdorysu (pro kontrolu překryvu nástrojů) v souřadnicích roviny plochy. */
type Poly2 = Vec2[];
function polysOverlap(a: Poly2, b: Poly2): boolean {
  for (const poly of [a, b]) {
    for (let i = 0; i < poly.length; i++) {
      const p = poly[i];
      const q = poly[(i + 1) % poly.length];
      const nx = -(q[1] - p[1]);
      const ny = q[0] - p[0];
      const proj = (pts: Poly2) => pts.map((x) => x[0] * nx + x[1] * ny);
      const pa = proj(a);
      const pb = proj(b);
      if (Math.max(...pa) < Math.min(...pb) - 1e-9 || Math.max(...pb) < Math.min(...pa) - 1e-9) return false;
    }
  }
  return true;
}

type Placed = { P0: Vec3; n0: Vec3; sW: Vec3; aW: Vec3; plan: Poly2 };

/** Jeden nástroj (ne žebro) v bodě: skořepina S, výřez K, stopa tvarované oblasti F (pro kontrolu polohy). */
async function toolSolids(tool: FormTool, sec: FormSection, pl: Placed, t: number): Promise<{ S: Shape; K: Shape; F: Shape }> {
  const over = overOf(t);
  if (sec.mode === "revolve") {
    const S = await revolveSection(sec.shell, pl.P0, pl.sW, pl.n0);
    const K = await cutCylinder(pl.P0, pl.n0, sec.cut.s1, t, over);
    const F = await cutCylinder(pl.P0, pl.n0, sec.s1, t, over);
    return { S, K, F };
  }
  let S = await extrudeSection(sec.shell, pl.P0, pl.sW, pl.n0, sec.a0, sec.a1);
  if (sec.solid) {
    // žaluzie: uzavřené konce – plné čelo tloušťky t na obou koncích
    const e1 = await extrudeSection(sec.solid, pl.P0, pl.sW, pl.n0, sec.a0, sec.a0 + t);
    const e2 = await extrudeSection(sec.solid, pl.P0, pl.sW, pl.n0, sec.a1 - t, sec.a1);
    S = S.fuse(e1).fuse(e2) as Shape;
  }
  const K = await cutBox(pl.P0, pl.sW, pl.n0, sec.cut, t, over);
  const F = await cutBox(pl.P0, pl.sW, pl.n0, { s0: sec.s0, s1: sec.s1, a0: sec.a0, a1: sec.a1 }, t, over);
  void tool;
  return { S, K, F };
}

/**
 * Kontrola polohy: stopa tvarované oblasti F leží celá v půdorysu plochy (ne přes hranu, otvor ani jiný nástroj) a pod ní je
 * plech tloušťky t. Okraj nástroje a výřez za stopou se pak jen ořežou půdorysem plochy.
 */
async function checkOnSheet(body: Shape, F: Shape, prism: Shape, t: number, what: string) {
  const over = overOf(t);
  const vf = await vol(F);
  const inPlan = await vol(F.clone().intersect(prism) as Shape);
  if (inPlan < vf * (1 - 1e-6) - 1e-6) throw new Error(tr("{0} neleží celý na rovné ploše plechu (přesahuje okraj, otvor, ohyb nebo jiný nástroj) – posuňte bod nebo zmenšete nástroj.", what));
  const expected = (vf * t) / (t + 2 * over);
  const inter = await vol(body.clone().intersect(F) as Shape);
  // tloušťka: plošky křížového zlomu jsou kolmo o cos(úhel) tenčí – tolerance 2 %
  if (Math.abs(inter - expected) > 0.02 * expected + 1e-3) {
    throw new Error(
      inter < expected
        ? tr("{0} neleží celý na rovné ploše plechu (přesahuje okraj, otvor, ohyb nebo jiný nástroj) – posuňte bod nebo zmenšete nástroj.", what)
        : tr("{0}: pod plochou není plech tloušťky {1} mm (je tam silnější materiál) – nástroj se umisťuje na plech.", what, fmt(t)),
    );
  }
}

/** Hranol půdorysu plochy přes celou tloušťku (± size podél normály) – okraj nástroje a výřez nesmí přes hranu, otvor ani jiný nástroj. */
async function facePrism(face: R.Face, n: Vec3, size: number): Promise<Shape> {
  const r = await rep();
  const f = face.clone().translate(mul(n, -size)) as R.Face;
  return r.basicFaceExtrusion(f, new r.Vector(mul(n, 2 * size))) as unknown as Shape;
}
/** Těleso oříznuté hranolem plochy (prázdný průnik = beze změny). */
async function clipTo(S: Shape, prism: Shape): Promise<Shape> {
  try {
    const out = S.clone().intersect(prism) as Shape;
    return (await vol(out)) > 1e-9 ? out : S;
  } catch {
    return S;
  }
}

const POINT_TOOLS: Exclude<FormTool, "bead">[] = ["louvre", "dimple", "lance", "bridge", "collar", "cardguide"];

async function buildPointTool(tool: Exclude<FormTool, "bead">, d: Data, ctx: ExtBuildCtx): Promise<Shape> {
  if (!ctx.body) throw new Error(tr("Nejdřív vytvořte Základní plech."));
  const p = sheetParamsAt(ctx.doc, ctx.index);
  const t = p.t;
  const sec = formSection(tool, d, t, p.r);
  const pts = formPoints(d.points);
  if (!pts.length) throw new Error(tr("{0}: zadejte bod umístění (klik na plochu plechu nebo souřadnice).", formToolLabel(tool)));
  const { face, o, n } = await formFace(ctx, d, () => pts[0]);
  const up = d.direction !== "down";
  const n0 = up ? n : mul(n, -1);
  const { u, v } = toolAxes(n, num(d.rotation, 0));
  const m = lipOf(t);
  const placed: Placed[] = pts.map((q) => {
    const P = pointOnPlane(q, o, n);
    const P0 = up ? P : sub(P, mul(n, t));
    let sW: Vec3;
    let aW: Vec3;
    if (sec.mode === "revolve") {
      sW = u;
      aW = v;
    } else if (sec.sAcross) {
      sW = mul(v, sec.sSign);
      aW = u;
    } else {
      sW = mul(u, sec.sSign);
      aW = v;
    }
    // půdorys tvarované oblasti + okraj (v souřadnicích u, v roviny plochy)
    const pu = dot(P, u);
    const pv = dot(P, v);
    const toUV = (s: number, a: number): Vec2 => {
      const w = add(mul(sW, s), mul(sec.mode === "revolve" ? v : aW, a));
      return [pu + dot(w, u), pv + dot(w, v)];
    };
    const plan: Poly2 =
      sec.mode === "revolve"
        ? Array.from({ length: 16 }, (_, i) => {
            const a = (i / 16) * 2 * Math.PI;
            const rr = (sec.s1 + m) / Math.cos(Math.PI / 16);
            return toUV(rr * Math.cos(a), rr * Math.sin(a));
          })
        : [toUV(sec.cut.s0 - m, sec.a0 - m), toUV(sec.s1 + m, sec.a0 - m), toUV(sec.s1 + m, sec.a1 + m), toUV(sec.cut.s0 - m, sec.a1 + m)];
    return { P0, n0, sW, aW, plan };
  });
  for (let i = 0; i < placed.length; i++)
    for (let j = i + 1; j < placed.length; j++)
      if (polysOverlap(placed[i].plan, placed[j].plan)) throw new Error(tr("{0}: nástroje v bodech {1} a {2} se překrývají – zvětšete rozteč.", formToolLabel(tool), i + 1, j + 1));
  let body = ctx.body;
  const shells: Shape[] = [];
  const prism = await facePrism(face, n, Math.hypot(...sub(ctx.body.boundingBox.bounds[1] as Vec3, ctx.body.boundingBox.bounds[0] as Vec3)) + 50);
  for (let i = 0; i < placed.length; i++) {
    const { S, K, F } = await toolSolids(tool, sec, placed[i], t);
    await checkOnSheet(body, F, prism, t, tr("{0} v bodě {1}", formToolLabel(tool), i + 1));
    body = body.cut(await clipTo(K, prism)) as Shape;
    shells.push(S);
  }
  for (const S of shells) body = body.fuse(await clipTo(S, prism)) as Shape;
  return body;
}

// ---------------- žebro podél dráhy ----------------

async function halfSpace(p: Vec3, normal: Vec3, size: number): Promise<Shape> {
  const r = await rep();
  const ref: Vec3 = Math.abs(normal[0]) < 0.9 ? [1, 0, 0] : [0, 1, 0];
  const x = norm(cross(normal, ref));
  return r.drawRectangle(size, size).sketchOnPlane(new r.Plane(p, x, normal)).extrude(size) as Shape;
}

async function buildBead(d: Data, ctx: ExtBuildCtx): Promise<Shape> {
  if (!ctx.body) throw new Error(tr("Nejdřív vytvořte Základní plech."));
  const r = await rep();
  const p = sheetParamsAt(ctx.doc, ctx.index);
  const t = p.t;
  const sk = ctx.sketches.get(String(d.sketchId ?? ""));
  if (!sk) throw new Error(tr("Vyberte {0} (musí být v historii před tímto prvkem).", tr("skicu s dráhou žebra")));
  const sec = formSection("bead", d, t, p.r);
  const { face, o, n } = await formFace(ctx, d);
  const up = d.direction !== "down";
  const n0 = up ? n : mul(n, -1);
  const shift = up ? [0, 0, 0] as Vec3 : mul(n, -t);
  const toFace = (q: Vec3) => add(pointOnPlane(q, o, n), shift);
  const chains = sketchChains(sk, toFace, n0);
  const over = overOf(t);
  const m = lipOf(t);
  const reach = sec.s1 + m;
  const half = halfShell(sec, t);
  const cutR = sec.cut.s1;
  const BIG = 4 * (Math.hypot(...sub(ctx.body.boundingBox.bounds[1] as Vec3, ctx.body.boundingBox.bounds[0] as Vec3)) + 100);
  let body = ctx.body;
  const shells: Shape[] = [];
  const cuts: Shape[] = [];
  const foots: Shape[] = [];
  for (const ch of chains) {
    const segs = ch.segs;
    const k = segs.length;
    // napojení: tečné (nic), roh (pokos v rovině půlící úhel)
    const joint = (i: number): { miter: Vec3 | null; turn: number } => {
      const d1 = tangentAt(segs[i], true, n0);
      const d2 = tangentAt(segs[(i + 1) % k], false, n0);
      const c = Math.max(-1, Math.min(1, dot(d1, d2)));
      if (c > 1 - 1e-7) return { miter: null, turn: 0 };
      const turn = Math.acos(c);
      if (turn > (150 * Math.PI) / 180) throw new Error(tr("Žebro: dráha se v rohu otáčí o víc než 150° – roh rozdělte nebo zaoblete."));
      return { miter: norm(add(d1, d2)), turn };
    };
    const joints = segs.map((_, i) => (i < k - 1 || ch.closed ? joint(i) : null));
    for (let i = 0; i < k; i++) {
      const s = segs[i];
      const jIn = i > 0 ? joints[i - 1] : ch.closed ? joints[k - 1] : null;
      const jOut = joints[i];
      if (s.kind === "arc") {
        if (s.r <= reach + 1e-6) throw new Error(tr("Žebro: poloměr oblouku dráhy {0} mm je menší než polovina šířky žebra s okrajem ({1} mm).", fmt(s.r), fmt(reach)));
        if ((jIn && jIn.miter) || (jOut && jOut.miter)) throw new Error(tr("Žebro: oblouk dráhy musí na sousední úseky navazovat tečně."));
        const sW = cross(n0, tangentAt(s, false, n0));
        const ang = (s.angle * 180) / Math.PI;
        const axis = s.ccw ? n0 : mul(n0, -1);
        shells.push(await revolveSection(sec.shell, s.a, sW, n0, ang, axis, s.c));
        // výřez: obdélník (s, h) otočený stejně
        const box: Seg[] = (() => {
          const c = sec.cut;
          const pts: Vec2[] = [[c.s0, -(t + over)], [c.s1, -(t + over)], [c.s1, over], [c.s0, over]];
          return pts.map((q, j) => ({ kind: "line", a: q, b: pts[(j + 1) % 4] }) as Seg);
        })();
        cuts.push(await revolveSection(box, s.a, sW, n0, ang, axis, s.c));
        const fbox: Seg[] = (() => {
          const pts: Vec2[] = [[sec.s0, -(t + over)], [sec.s1, -(t + over)], [sec.s1, over], [sec.s0, over]];
          return pts.map((q, j) => ({ kind: "line", a: q, b: pts[(j + 1) % 4] }) as Seg);
        })();
        foots.push(await revolveSection(fbox, s.a, sW, n0, ang, axis, s.c));
        continue;
      }
      const dL = norm(sub(s.b, s.a));
      const L = Math.hypot(...sub(s.b, s.a));
      const sW = cross(n0, dL);
      const extIn = jIn?.miter ? reach * Math.tan(jIn.turn / 2) + 1 : 0;
      const extOut = jOut?.miter ? reach * Math.tan(jOut.turn / 2) + 1 : 0;
      // profil v rovině kolmé na úsečku: osa s = vlevo (n0 × d), vysunutí podél d
      let S = await extrudeSection(sec.shell, s.a, sW, n0, -extIn, L + extOut);
      // výřez stejně dlouhý a ve stejném pokosu jako skořepina (dutina v rohu se vyřízne celá)
      let Kp = await cutBox(s.a, sW, n0, { s0: sec.cut.s0, s1: sec.cut.s1, a0: -extIn, a1: L + extOut }, t, over);
      let Fp = await cutBox(s.a, sW, n0, { s0: sec.s0, s1: sec.s1, a0: -extIn, a1: L + extOut }, t, over);
      if (jIn?.miter) {
        const hs = await halfSpace(s.a, mul(jIn.miter, -1), BIG);
        S = S.cut(hs) as Shape;
        Kp = Kp.cut(hs) as Shape;
        Fp = Fp.cut(hs) as Shape;
      }
      if (jOut?.miter) {
        const hs = await halfSpace(s.b, jOut.miter, BIG);
        S = S.cut(hs) as Shape;
        Kp = Kp.cut(hs) as Shape;
        Fp = Fp.cut(hs) as Shape;
      }
      shells.push(S);
      cuts.push(Kp);
      foots.push(Fp);
    }
    // výřez na zaoblených koncích: válec (poloměr výřezu)
    if (!ch.closed)
      for (const c of [segs[0].a, segs[k - 1].b]) {
        cuts.push(await cutCylinder(c, n0, cutR, t, over));
        foots.push(await cutCylinder(c, n0, sec.s1, t, over));
      }
    if (!ch.closed) {
      // zaoblené konce: polovina řezu otočená o 180° kolem svislé osy v koncovém bodě
      const d0 = tangentAt(segs[0], false, n0);
      const d1 = tangentAt(segs[k - 1], true, n0);
      shells.push(await revolveSection(half, segs[0].a, cross(n0, d0), n0, 180, n0, segs[0].a));
      shells.push(await revolveSection(half, segs[k - 1].b, cross(n0, d1), n0, 180, mul(n0, -1), segs[k - 1].b));
    }
  }
  const union = (list: Shape[]) => list.slice(1).reduce((a, x) => a.fuse(x) as Shape, list[0]);
  const prism = await facePrism(face, n, BIG);
  await checkOnSheet(body, union(foots), prism, t, formToolLabel("bead"));
  body = body.cut(await clipTo(union(cuts), prism)) as Shape;
  body = body.fuse(await clipTo(union(shells), prism)) as Shape;
  void r;
  return body;
}

// ---------------- křížový zlom ----------------

/** Rohy rovinné plochy s rovnými hranami (vnější obrys, po sobě jdoucí) a vnitřní obrysy (díry). */
function facePolygon(face: R.Face): { outer: Vec3[]; curved: boolean } {
  const wirePts = (w: R.Wire): { pts: Vec3[]; curved: boolean } => {
    const pts: Vec3[] = [];
    let curved = false;
    for (const e of w.edges) {
      if (e.geomType !== "LINE") curved = true;
      const a = vt(e.startPoint);
      const b = vt(e.endPoint);
      if (!pts.length) pts.push(a, b);
      else {
        const last = pts[pts.length - 1];
        const near = (p: Vec3, q: Vec3) => Math.hypot(...sub(p, q)) < 1e-5;
        if (near(last, a)) pts.push(b);
        else if (near(last, b)) pts.push(a);
        else if (pts.length === 2 && near(pts[0], a)) {
          pts.reverse();
          pts.push(b);
        } else if (pts.length === 2 && near(pts[0], b)) {
          pts.reverse();
          pts.push(a);
        } else pts.push(a, b);
      }
    }
    if (pts.length > 1 && Math.hypot(...sub(pts[0], pts[pts.length - 1])) < 1e-5) pts.pop();
    // sloučit body na přímce
    const out: Vec3[] = [];
    for (let i = 0; i < pts.length; i++) {
      const p0 = pts[(i - 1 + pts.length) % pts.length];
      const p1 = pts[i];
      const p2 = pts[(i + 1) % pts.length];
      const c = cross(sub(p1, p0), sub(p2, p1));
      if (Math.hypot(...c) > 1e-9 * Math.max(1, Math.hypot(...sub(p1, p0)) * Math.hypot(...sub(p2, p1)))) out.push(p1);
    }
    return { pts: out, curved };
  };
  // outerWire() plochu uvolní – pracovat s kopií
  const o = wirePts(face.clone().outerWire());
  return { outer: o.pts, curved: o.curved };
}

/** Těžiště mnohoúhelníku v rovině (n) a nejmenší vzdálenost těžiště od hran. */
export function polygonCentroid(pts: Vec3[], n: Vec3): { c: Vec3; inR: number } {
  const x = norm(sub(pts[1], pts[0]));
  const y = cross(n, x);
  const o = pts[0];
  const p2 = pts.map((p): Vec2 => [dot(sub(p, o), x), dot(sub(p, o), y)]);
  let A = 0;
  let cx = 0;
  let cy = 0;
  for (let i = 0; i < p2.length; i++) {
    const [x1, y1] = p2[i];
    const [x2, y2] = p2[(i + 1) % p2.length];
    const k = x1 * y2 - x2 * y1;
    A += k;
    cx += (x1 + x2) * k;
    cy += (y1 + y2) * k;
  }
  A /= 2;
  cx /= 6 * A;
  cy /= 6 * A;
  let inR = Infinity;
  for (let i = 0; i < p2.length; i++) {
    const a = p2[i];
    const b = p2[(i + 1) % p2.length];
    const ab: Vec2 = [b[0] - a[0], b[1] - a[1]];
    const l = Math.hypot(...ab) || 1;
    inR = Math.min(inR, Math.abs((cx - a[0]) * ab[1] - (cy - a[1]) * ab[0]) / l);
  }
  return { c: add(o, add(mul(x, cx), mul(y, cy))), inR };
}

/** Výška vyklenutí středu: nejmenší vzdálenost těžiště od hrany × tan(úhel). */
export const crossBreakRise = (inR: number, angleDeg: number) => inR * Math.tan((angleDeg * Math.PI) / 180);

async function pyramid(base: Vec3[], apex: Vec3): Promise<Shape> {
  const r = await rep();
  const faces = [r.makePolygon(base)];
  for (let i = 0; i < base.length; i++) faces.push(r.makePolygon([base[i], base[(i + 1) % base.length], apex]));
  return r.makeSolid(faces) as unknown as Shape;
}

async function buildCrossBreak(d: Data, ctx: ExtBuildCtx): Promise<Shape> {
  if (!ctx.body) throw new Error(tr("Nejdřív vytvořte Základní plech."));
  const r = await rep();
  const t = sheetParamsAt(ctx.doc, ctx.index).t;
  const angle = num(d.angle, 1.5);
  if (!(angle > 0 && angle <= 10)) throw new Error(tr("Křížový zlom: úhel musí být 0–10° (obvykle 1–2°)."));
  const { face, n } = await formFace(ctx, d);
  const poly = facePolygon(face);
  if (poly.curved) throw new Error(tr("Křížový zlom: panel musí mít rovné hrany (mnohoúhelník) – plocha má zaoblený nebo zakřivený obrys."));
  if (poly.outer.length < 3) throw new Error(tr("Křížový zlom: plocha nemá platný obrys."));
  const { c, inR } = polygonCentroid(poly.outer, n);
  const rise = crossBreakRise(inR, angle);
  const up = d.direction !== "down";
  const bottom = poly.outer.map((p) => sub(p, mul(n, t)));
  const cb = sub(c, mul(n, t));
  // nahoru: horní plocha = jehlan nad plochou, spodní plocha zevnitř stejně; dolů obráceně
  let O = up ? await pyramid(poly.outer, add(c, mul(n, rise))) : await pyramid(bottom, sub(cb, mul(n, rise)));
  let C = up ? await pyramid(bottom, add(cb, mul(n, rise))) : await pyramid(poly.outer, sub(c, mul(n, rise)));
  // díry panelu (výřezy, dříve umístěné tvářecí nástroje): jehlany se v nich vynechají – nástroj zůstane v rovině panelu
  const big = t + 2 * rise + 2;
  for (const w of face.clone().innerWires()) {
    const hf = r.makeFace(w).translate(mul(n, -big)) as R.Face;
    const hp = r.basicFaceExtrusion(hf, new r.Vector(mul(n, 2 * big))) as unknown as Shape;
    O = O.cut(hp) as Shape;
    C = C.cut(hp) as Shape;
  }
  const vC = await vol(C);
  let body = ctx.body.fuse(O) as Shape;
  const v1 = await vol(body);
  const cutB = body.cut(C) as Shape;
  const removed = v1 - (await vol(cutB));
  if (Math.abs(removed - vC) > 0.02 * vC + 1e-6) throw new Error(tr("Křížový zlom: protilehlá strana panelu nemá stejný obrys (panel není rovný plech tloušťky {0} mm).", fmt(t)));
  return cutB;
}

// ---------------- registrace ----------------

const FACE_PARAM: ExtParam = { key: "face", label: tr("Plocha plechu"), kind: "faces", hint: tr("rovinná plocha, ze které se tvaruje; prázdné = horní plocha základního plechu") };
const POINTS_PARAM: ExtParam = { key: "points", label: tr("Body umístění"), kind: "text", hint: tr("[[x, y], …] v rovině plochy nebo [[x, y, z], …]; klik na plochu přidá bod") };
const DIR_PARAM: ExtParam = { key: "direction", label: tr("Směr tvarování"), kind: "enum", options: [{ v: "up", l: tr("Nahoru (od plochy)") }, { v: "down", l: tr("Dolů (do plochy)") }] };
const ROT_PARAM: ExtParam = { key: "rotation", label: tr("Natočení"), kind: "number", unit: "°", step: 15, hint: tr("kolem normály plochy od osy X (u ploch kolmých na X od osy Y)") };
const RADIUS_PARAM: ExtParam = { key: "radius", label: tr("Vnitřní poloměr"), kind: "number", min: 0, step: 0.25, hint: tr("0 = automaticky (poloměr plechu, zmenšený, aby se vešel)") };

type ToolDef = { tool: FormTool; icon: string; order: number; hint: string; defaults: (t: number) => Data; params: ExtParam[] };
const TOOLS: ToolDef[] = [
  {
    tool: "louvre",
    icon: "sheet-louvre",
    order: 0,
    hint: tr("větrací žaluzie: prostřih podél jedné strany a vytlačená stříška"),
    defaults: (t) => ({ length: 40, width: 8, height: Math.max(3, 2 * t), open: "left", rotation: 0 }),
    params: [
      { key: "length", label: tr("Délka"), kind: "number", min: 1 },
      { key: "width", label: tr("Šířka"), kind: "number", min: 0.5 },
      { key: "height", label: tr("Výška otvoru"), kind: "number", min: 0.1 },
      { key: "open", label: tr("Otevřená strana"), kind: "enum", options: [{ v: "left", l: tr("Vlevo") }, { v: "right", l: tr("Vpravo") }] },
      ROT_PARAM,
    ],
  },
  {
    tool: "dimple",
    icon: "sheet-dimple",
    order: 1,
    hint: tr("kruhový prolis (důlek) – průměr, hloubka, úhel stěny"),
    defaults: (t) => ({ diameter: 12, height: Math.max(1.5, t), wallAngle: 60, rounded: true }),
    params: [
      { key: "diameter", label: tr("Průměr"), kind: "number", min: 0.5, hint: tr("u plochy plechu") },
      { key: "height", label: tr("Hloubka"), kind: "number", min: 0.1 },
      { key: "wallAngle", label: tr("Úhel stěny"), kind: "number", min: 5, max: 90, unit: "°", hint: tr("od roviny plechu; 90° = svislá stěna") },
      { key: "rounded", label: tr("Zaoblené rohy"), kind: "bool" },
    ],
  },
  {
    tool: "bead",
    icon: "sheet-bead",
    order: 2,
    hint: tr("vylisované žebro podél dráhy ve skice (úsečky, oblouky) – skořepina tloušťky plechu"),
    defaults: (t) => ({ sketchId: "", width: 8, height: Math.max(1.5, t), wallAngle: 60 }),
    params: [
      { key: "sketchId", label: tr("Skica s dráhou"), kind: "sketch" },
      { key: "width", label: tr("Šířka"), kind: "number", min: 0.5 },
      { key: "height", label: tr("Výška"), kind: "number", min: 0.1 },
      { key: "wallAngle", label: tr("Úhel stěny"), kind: "number", min: 5, max: 90, unit: "°" },
    ],
  },
  {
    tool: "lance",
    icon: "sheet-lance",
    order: 3,
    hint: tr("jazýček prostřižený ze tří stran a vytlačený s náběhem"),
    defaults: (t) => ({ length: 20, width: 10, height: Math.max(2, 1.5 * t), wallAngle: 45, rotation: 0 }),
    params: [
      { key: "length", label: tr("Délka"), kind: "number", min: 1, hint: tr("od ohybu po otevřený konec (ve směru natočení)") },
      { key: "width", label: tr("Šířka"), kind: "number", min: 0.5 },
      { key: "height", label: tr("Výška"), kind: "number", min: 0.1 },
      { key: "wallAngle", label: tr("Úhel náběhu"), kind: "number", min: 5, max: 90, unit: "°" },
      ROT_PARAM,
    ],
  },
  {
    tool: "bridge",
    icon: "sheet-bridge",
    order: 4,
    hint: tr("můstek: pás prostřižený po stranách a vytlačený s náběhy na obou koncích"),
    defaults: (t) => ({ length: 30, width: 8, height: Math.max(2, 1.5 * t), wallAngle: 45, rotation: 0 }),
    params: [
      { key: "length", label: tr("Délka"), kind: "number", min: 1 },
      { key: "width", label: tr("Šířka"), kind: "number", min: 0.5 },
      { key: "height", label: tr("Výška"), kind: "number", min: 0.1 },
      { key: "wallAngle", label: tr("Úhel náběhu"), kind: "number", min: 5, max: 90, unit: "°" },
      ROT_PARAM,
    ],
  },
  {
    tool: "collar",
    icon: "sheet-collar",
    order: 5,
    hint: tr("protažený otvor s límcem (pro závit nebo trubku)"),
    defaults: (t) => ({ diameter: 10, height: Math.max(2, 1.5 * t) }),
    params: [
      { key: "diameter", label: tr("Průměr díry"), kind: "number", min: 0.5, hint: tr("vnitřní průměr límce") },
      { key: "height", label: tr("Výška límce"), kind: "number", min: 0.1, hint: tr("od plochy plechu") },
    ],
  },
  {
    tool: "cardguide",
    icon: "sheet-cardguide",
    order: 6,
    hint: tr("vodítko desky plošných spojů: můstek s mezerou pro hranu desky"),
    defaults: () => ({ length: 25, width: 6, slot: 1.6, wallAngle: 60, rotation: 0 }),
    params: [
      { key: "length", label: tr("Délka"), kind: "number", min: 1 },
      { key: "width", label: tr("Šířka"), kind: "number", min: 0.5 },
      { key: "slot", label: tr("Mezera pro desku"), kind: "number", min: 0.1, hint: tr("tloušťka desky + vůle") },
      { key: "wallAngle", label: tr("Úhel náběhu"), kind: "number", min: 5, max: 90, unit: "°" },
      ROT_PARAM,
    ],
  },
];

export const FORM_TOOL_DEFS = TOOLS;

for (const def of TOOLS) {
  const isBead = def.tool === "bead";
  registerExt({
    ext: FORM_EXT[def.tool],
    label: formToolLabel(def.tool),
    icon: def.icon,
    tone: "feature",
    tab: "sheet",
    group: "Tvarování",
    order: def.order,
    hint: def.hint,
    pick: { kind: "faces", key: "face" },
    rollback: true,
    make: (doc, extra) => {
      const t = sheetParamsAt(doc, doc.features.length).t;
      const base: Data = { face: (extra?.faces as number[] | undefined)?.slice(0, 1) ?? [], direction: "up", radius: 0, ...def.defaults(t) };
      if (isBead) {
        const sk = [...doc.features].reverse().find((f) => f.type === "sketch");
        base.sketchId = sk?.id ?? "";
      } else base.points = [];
      return base;
    },
    params: [FACE_PARAM, ...(isBead ? [] : [POINTS_PARAM]), ...def.params, DIR_PARAM, RADIUS_PARAM],
    build: (d, ctx) => (isBead ? buildBead(d, ctx) : buildPointTool(def.tool as Exclude<FormTool, "bead">, d, ctx)),
  });
}

registerExt({
  ext: CROSS_BREAK_EXT,
  label: tr("Křížový zlom"),
  icon: "sheet-crossbreak",
  tone: "feature",
  tab: "sheet",
  group: "Tvarování",
  order: 7,
  hint: tr("vyztužení rovného panelu mírným zlomem po úhlopříčkách (1–2°)"),
  pick: { kind: "faces", key: "face" },
  rollback: true,
  make: (_doc, extra) => ({ face: (extra?.faces as number[] | undefined)?.slice(0, 1) ?? [], angle: 1.5, direction: "up" }),
  params: [
    { key: "face", label: tr("Panel (rovinná plocha)"), kind: "faces", hint: tr("plocha s rovnými hranami; prázdné = horní plocha základního plechu") },
    { key: "angle", label: tr("Úhel zlomu"), kind: "number", min: 0.1, max: 10, step: 0.5, unit: "°", hint: tr("sklon plošek u delších stran; obvykle 1–2°") },
    { key: "direction", label: tr("Směr"), kind: "enum", options: [{ v: "up", l: tr("Nahoru (vyklenout)") }, { v: "down", l: tr("Dolů (prohnout)") }] },
  ],
  build: (d, ctx) => buildCrossBreak(d, ctx),
});

/** Pro testy a UI. */
export { POINT_TOOLS, formDims };
