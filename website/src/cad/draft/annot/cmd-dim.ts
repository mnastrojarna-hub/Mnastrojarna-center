/**
 * BALÍK 2 (annot) – kótovací příkazy jako v AutoCADu: DIM (chytrá kóta podle objektu), DIMLINEAR, DIMALIGNED,
 * DIMANGULAR, DIMRADIUS (i zalomená), DIMDIAMETER, DIMARC, DIMORDINATE, DIMBASELINE, DIMCONTINUE, DIMSTYLE
 * (kótovací styly, přepsání, měřítko poznámek) a CENTERMARK (značka středu, osy kružnic a osa mezi úsečkami).
 */
import { tr } from "../../i18n";
import { findCommand, kw, registerCommand, type CmdCtx, type CmdGen, type Input, type Prompt } from "../commands";
import { logCreated } from "../cmd-draw";
import { cClosest, type Curve } from "../curves";
import { add, angleOf, deg, dist, dot, mid, mul, normA, polar, rad, rot90, sub, unit } from "../geom";
import { entityCurves, invalidateGeometry, type KindCtx } from "../kinds";
import { spaceEntities, type DraftDimStyle, type DraftEntity, type NewEntity, type Vec2 } from "../model";
import { normDeg } from "../units";
import { annoMultiplier, annoScaleLabel, cannoscaleOf, parseAnnoScale } from "./anno";
import { centerMark, dimSizes, dimTextAt, ordinateAxes } from "./dimgeom";
import { countDims, createDimStyle, currentDimStyle, DIM_VARS, deleteDimStyle, dimStyles, dimVarDef, ensureDimStyles, findDimStyle, materializeDimStyles, modifyDimStyle, parseDimVar, renameDimStyle, resolveDimStyle, setCurrentDimStyle } from "./dimstyle";
import { dimGeom, dimMeasuredText } from "./kinds-annot";
import { askText } from "./cmd-text";
import { mtextPlain } from "./mtext";
import type { DDimension } from "./types";

type Gen<T> = Generator<Prompt, T, Input>;
const fold = (s: string) => s.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/ß/g, "ss");
const isW = (t: string | undefined, ...w: string[]) => t !== undefined && w.includes(fold(t));

export const KD = {
  mtext: kw("mtext", "Mtext", "Mtext", "Mtext"),
  text: kw("text", "Text", "Text", "Text"),
  angle: kw("angle", "Úhel", "Angle", "Winkel"),
  hor: kw("horizontal", "Vodorovně", "Horizontal", "Horizontal"),
  ver: kw("vertical", "Svisle", "Vertical", "Vertikal"),
  rotated: kw("rotated", "Natočit", "Rotated", "Gedreht"),
  select: kw("select", "Vybrat", "Select", "Wählen"),
  undo: kw("undo", "Zpět", "Undo", "Zurück"),
  jogged: kw("jogged", "Zalomená", "Jogged", "Verkürzt"),
  xdatum: kw("xdatum", "Xbáze", "Xdatum", "XBezug"),
  ydatum: kw("ydatum", "Ybáze", "Ydatum", "YBezug"),
  origin: kw("origin", "Počátek", "Origin", "Ursprung"),
  points: kw("points", "Body", "Points", "Punkte"),
  angular: kw("angular", "Úhlová", "Angular", "Winkel2"),
  baseline: kw("baseline", "Základnicová", "Baseline", "Basislinie"),
  cont: kw("continue", "Řetězová", "Continue", "Weiter"),
  ordinate: kw("ordinate", "Souřadnicová", "Ordinate", "Koordinate"),
  aligned: kw("aligned", "Zarovnaná", "Aligned", "Ausgerichtet"),
  radius: kw("radius", "Poloměr", "Radius", "Radius"),
  diameter: kw("diameter", "Průměr", "Diameter", "Durchmesser"),
  arclen: kw("arclength", "Oblouková", "Arclength", "Bogenlänge"),
  partial: kw("partial", "Část", "Partial", "Teil"),
  centerline: kw("centerline", "Osa", "Centerline", "Mittellinie"),
  size: kw("size", "Velikost", "Size", "Größe"),
};

const list = (c: CmdCtx) => spaceEntities(c.tx.model, c.session.space) ?? c.tx.model.entities;
const kctx = (c: CmdCtx): KindCtx => c.kctx();
/** nová kóta aktuálním stylem; anotativní styl (DIMANNO) = anotativní kóta (výřezy rozvržení ji kreslí v měřítku výřezu) */
const newDim = (c: CmdCtx, d: Omit<DDimension, "id" | "layer" | "type">): Omit<DDimension, "id" | "layer"> => {
  const m = c.tx.model;
  const style = currentDimStyle(m);
  return { type: "dimension", style, ...(resolveDimStyle(m, style).dimanno ? { annotative: true } : {}), ...d };
};
const tmp = (d: Omit<DDimension, "id" | "layer">): DDimension => ({ ...d, id: "~dim", layer: "0" }) as DDimension;

/** vytvoří kótu a vypíše naměřenou hodnotu */
function addDim(c: CmdCtx, d: Omit<DDimension, "id" | "layer">): string {
  ensureDimStyles(c);
  const id = c.tx.add(d as NewEntity);
  const e = c.tx.get(id) as DDimension;
  const val = dimMeasuredText(e, kctx(c));
  const g = dimGeom(e, kctx(c));
  c.log(tr("✓ Kóta {0} ({1}): {2}", id, d.kind, mtextPlain(g.text).join(" ") || val));
  const res = (c as CmdCtx & { _dims?: unknown[] })._dims ?? [];
  res.push({ id, kind: d.kind, measured: g.measured, text: mtextPlain(g.text).join(" ") });
  (c as CmdCtx & { _dims?: unknown[] })._dims = res;
  c.out("dimensions", res);
  c.out("measurement", g.measured);
  return id;
}

/** volby u umístění kóty: Mtext / Text (přepis, <> = hodnota), Úhel textu */
function* textOption(c: CmdCtx, id: string, d: { text?: string; textRot?: number }, base: Vec2): Gen<boolean> {
  if (id === "mtext" || id === "text") {
    const s = id === "mtext" ? yield* askText(c, tr("Zadejte text kóty (<> = naměřená hodnota)"), { title: tr("Text kóty"), init: d.text || "<>", p: base, h: c.tx.vars.textsize, rot: 0, w: 0, attach: 5, single: true }) : ((yield { k: "text", msg: tr("Zadejte text kóty (<> = naměřená hodnota)"), def: d.text || "<>" }) as Input);
    const v = typeof s === "string" ? s : s && (s as Input).k === "text" ? (s as Extract<Input, { k: "text" }>).s : null;
    if (v !== null) d.text = v === "<>" ? "" : v;
    return true;
  }
  if (id === "angle") {
    const i = yield { k: "angle", msg: tr("Zadejte úhel textu kóty"), base, def: 0 };
    if (i.k === "num") d.textRot = normDeg(i.v);
    return true;
  }
  return false;
}

/** úsek objektu u bodu výběru: úsečka / oblouk (křivka – její úsek), kružnice */
function segAt(e: DraftEntity, p: Vec2, ctx: KindCtx): Curve | null {
  const cs = entityCurves(e, ctx);
  let best: Curve | null = null;
  let bd = Infinity;
  for (const c of cs) {
    const d = cClosest(c, p).d;
    if (d < bd) (bd = d), (best = c);
  }
  return best;
}
const arcEnds = (c: Extract<Curve, { k: "arc" }>): [Vec2, Vec2] => [polar(c.c, c.a0, c.r), polar(c.c, c.a0 + c.sweep, c.r)];

/** automatická orientace lineární kóty podle polohy kótovací čáry (vodorovná / svislá) */
function autoRot(p1: Vec2, p2: Vec2, q: Vec2): number {
  const x0 = Math.min(p1[0], p2[0]);
  const x1 = Math.max(p1[0], p2[0]);
  const y0 = Math.min(p1[1], p2[1]);
  const y1 = Math.max(p1[1], p2[1]);
  const dx = q[0] < x0 ? x0 - q[0] : q[0] > x1 ? q[0] - x1 : 0;
  const dy = q[1] < y0 ? y0 - q[1] : q[1] > y1 ? q[1] - y1 : 0;
  if (dx === 0 && dy === 0) return Math.abs(p2[0] - p1[0]) >= Math.abs(p2[1] - p1[1]) ? 0 : 90;
  return dy >= dx ? 0 : 90;
}
/** bod kótovací čáry u 2. vynášecí čáry (DXF 10) */
const linePoint = (p2: Vec2, q: Vec2, rotDeg: number): Vec2 => {
  const d: Vec2 = [Math.cos(rad(rotDeg)), Math.sin(rad(rotDeg))];
  return add(q, mul(d, dot(sub(p2, q), d)));
};

/** lineární / zarovnaná kóta ze dvou bodů – výzva polohy kótovací čáry s volbami */
function* placeLinear(c: CmdCtx, p1: Vec2, p2: Vec2, aligned: boolean, lock0: number | null = null): Gen<string | null> {
  let lock: number | null = lock0;
  const d: { text?: string; textRot?: number } = {};
  const make = (q: Vec2): Omit<DDimension, "id" | "layer"> => {
    if (aligned) return newDim(c, { kind: "aligned", p1, p2, line: add(q, mul(unit(sub(p2, p1)), dot(sub(p2, q), unit(sub(p2, p1))))), ...(d.text ? { text: d.text } : {}), ...(d.textRot !== undefined ? { textRot: d.textRot } : {}) });
    const rot = lock ?? autoRot(p1, p2, q);
    return newDim(c, { kind: "linear", p1, p2, line: linePoint(p2, q, rot), ...(rot ? { rot } : {}), ...(d.text ? { text: d.text } : {}), ...(d.textRot !== undefined ? { textRot: d.textRot } : {}) });
  };
  for (;;) {
    const i = yield { k: "point", msg: tr("Zadejte polohu kótovací čáry"), base: p2, kw: aligned ? [KD.mtext, KD.text, KD.angle] : [KD.mtext, KD.text, KD.angle, KD.hor, KD.ver, KD.rotated], preview: (q) => [make(q) as NewEntity] };
    if (i.k === "point") return addDim(c, make(i.p));
    if (i.k !== "kw") return null;
    if (yield* textOption(c, i.id, d, p2)) continue;
    if (i.id === "horizontal") lock = 0;
    else if (i.id === "vertical") lock = 90;
    else if (i.id === "rotated") {
      const r = yield { k: "angle", msg: tr("Zadejte úhel kótovací čáry"), base: p1, def: 0 };
      if (r.k === "num") lock = normDeg(r.v);
    }
  }
}

/** první dva body: počátky vynášecích čar, nebo Enter = vybrat objekt (úsečka, oblouk, kružnice, úsek křivky) */
function* twoPoints(c: CmdCtx): Gen<[Vec2, Vec2] | null> {
  const i = yield { k: "point", msg: tr("Zadejte počátek první vynášecí čáry nebo <vybrat objekt>"), none: true };
  if (i.k === "point") {
    const j = yield { k: "point", msg: tr("Zadejte počátek druhé vynášecí čáry"), base: i.p, preview: (q) => [{ type: "line", a: i.p, b: q }] };
    if (j.k !== "point") return null;
    return [i.p, j.p];
  }
  if (i.k !== "none") return null;
  const e = yield { k: "entity", msg: tr("Vyberte objekt ke kótování"), filter: (x) => entityCurves(x, kctx(c)).length > 0 };
  if (e.k !== "ent") return null;
  const ent = c.tx.get(e.id)!;
  const s = segAt(ent, e.p, kctx(c));
  if (!s) throw new Error(tr("objekt nejde okótovat"));
  if (s.k === "line") return [s.a, s.b];
  if (s.k === "arc") {
    if (s.sweep >= 2 * Math.PI - 1e-9) return [[s.c[0] - s.r, s.c[1]], [s.c[0] + s.r, s.c[1]]];
    return arcEnds(s);
  }
  throw new Error(tr("objekt nejde okótovat lineárně – vyberte úsečku, oblouk nebo kružnici"));
}

registerCommand({
  id: "DIMLINEAR",
  names: { cs: ["kóta-lineární"], en: ["dimlinear"], de: ["bemlinear"] },
  alias: ["DLI"],
  group: "annotate",
  desc: () => tr("lineární kóta (vodorovná / svislá / natočená): dva body nebo objekt, poloha kótovací čáry; volby Mtext, Text (<> = hodnota), Úhel textu, Vodorovně, Svisle, Natočit"),
  usage: () => tr("kóta-lineární 0,0 100,0 50,-15 | kóta-lineární 0,0 30,40 svisle -15,20 | kóta-lineární \"\" e3 50,-15 (objekt) | kóta-lineární 0,0 100,0 text \"<> H7\" 50,-15"),
  run: function* (c): CmdGen {
    const pp = yield* twoPoints(c);
    if (!pp) return;
    yield* placeLinear(c, pp[0], pp[1], false);
  },
});
registerCommand({
  id: "DIMALIGNED",
  names: { cs: ["kóta-zarovnaná"], en: ["dimaligned"], de: ["bemausg"] },
  alias: ["DAL"],
  group: "annotate",
  desc: () => tr("zarovnaná kóta (rovnoběžná se spojnicí bodů): dva body nebo objekt, poloha kótovací čáry"),
  usage: () => tr("kóta-zarovnaná 0,0 30,40 10,50"),
  run: function* (c): CmdGen {
    const pp = yield* twoPoints(c);
    if (!pp) return;
    yield* placeLinear(c, pp[0], pp[1], true);
  },
});

// ---------------------------------------------------------------- úhlová

function* placeArc(c: CmdCtx, make: (q: Vec2, d: { text?: string; textRot?: number }) => Omit<DDimension, "id" | "layer">, base: Vec2): Gen<string | null> {
  const d: { text?: string; textRot?: number } = {};
  for (;;) {
    const i = yield { k: "point", msg: tr("Zadejte polohu oblouku kóty"), base, kw: [KD.mtext, KD.text, KD.angle], preview: (q) => [make(q, d) as NewEntity] };
    if (i.k === "point") return addDim(c, make(i.p, d));
    if (i.k !== "kw") return null;
    yield* textOption(c, i.id, d, base);
  }
}
const withText = (d: { text?: string; textRot?: number }) => ({ ...(d.text ? { text: d.text } : {}), ...(d.textRot !== undefined ? { textRot: d.textRot } : {}) });

registerCommand({
  id: "DIMANGULAR",
  names: { cs: ["kóta-úhlová"], en: ["dimangular"], de: ["bemwinkel"] },
  alias: ["DAN"],
  group: "annotate",
  desc: () => tr("úhlová kóta: dvě úsečky (úhel podle polohy oblouku – kterýkoli ze 4 úhlů), oblouk, kružnice + bod, nebo Enter = vrchol a dva body (i přes 180°)"),
  usage: () => tr("kóta-úhlová e1 e2 40,15 (dvě úsečky) | kóta-úhlová e5 30,30 (oblouk) | kóta-úhlová \"\" 0,0 50,0 0,50 30,30 (vrchol, body, oblouk)"),
  run: function* (c): CmdGen {
    const i = yield { k: "entity", msg: tr("Vyberte oblouk, kružnici, úsečku nebo <zadat vrchol>"), filter: (x) => entityCurves(x, kctx(c)).length > 0, none: true };
    if (i.k === "none") {
      const v = yield { k: "point", msg: tr("Zadejte vrchol úhlu") };
      if (v.k !== "point") return;
      const a = yield { k: "point", msg: tr("Zadejte koncový bod prvního ramene"), base: v.p, preview: (q) => [{ type: "line", a: v.p, b: q }] };
      if (a.k !== "point") return;
      const b = yield { k: "point", msg: tr("Zadejte koncový bod druhého ramene"), base: v.p, preview: (q) => [{ type: "line", a: v.p, b: a.p }, { type: "line", a: v.p, b: q }] };
      if (b.k !== "point") return;
      yield* placeArc(c, (q, d) => newDim(c, { kind: "angular3", vertex: v.p, p1: a.p, p2: b.p, arc: q, ...withText(d) }), v.p);
      return;
    }
    if (i.k !== "ent") return;
    const e1 = c.tx.get(i.id)!;
    const s1 = segAt(e1, i.p, kctx(c));
    if (!s1) return;
    if (s1.k === "arc" && s1.sweep < 2 * Math.PI - 1e-9) {
      const [a, b] = arcEnds(s1);
      yield* placeArc(c, (q, d) => newDim(c, { kind: "angular3", vertex: s1.c, p1: a, p2: b, arc: q, ...withText(d) }), s1.c);
      return;
    }
    if (s1.k === "arc") {
      const a = polar(s1.c, angleOf(sub(i.p, s1.c)), s1.r);
      const j = yield { k: "point", msg: tr("Zadejte druhý koncový bod úhlu"), base: s1.c };
      if (j.k !== "point") return;
      yield* placeArc(c, (q, d) => newDim(c, { kind: "angular3", vertex: s1.c, p1: a, p2: j.p, arc: q, ...withText(d) }), s1.c);
      return;
    }
    if (s1.k !== "line") throw new Error(tr("vyberte úsečku, oblouk nebo kružnici"));
    const j = yield { k: "entity", msg: tr("Vyberte druhou úsečku"), filter: (x) => entityCurves(x, kctx(c)).some((cc) => cc.k === "line") };
    if (j.k !== "ent") return;
    const s2 = segAt(c.tx.get(j.id)!, j.p, kctx(c));
    if (!s2 || s2.k !== "line") throw new Error(tr("druhý objekt musí být úsečka (úsek křivky)"));
    const l1: [Vec2, Vec2] = [s1.a, s1.b];
    const l2: [Vec2, Vec2] = [s2.a, s2.b];
    const d1 = unit(sub(s1.b, s1.a));
    const d2 = unit(sub(s2.b, s2.a));
    if (Math.abs(d1[0] * d2[1] - d1[1] * d2[0]) < 1e-9) throw new Error(tr("úsečky jsou rovnoběžné – úhel mezi nimi nelze okótovat"));
    const v = mid(s1.a, s2.a);
    yield* placeArc(c, (q, d) => newDim(c, { kind: "angular", l1, l2, arc: q, ...withText(d) }), v);
  },
});

// ---------------------------------------------------------------- poloměr, průměr, oblouk

function* pickCircle(c: CmdCtx, msg: string, kws: ReturnType<typeof kw>[] = []): Gen<{ c: Vec2; r: number; arc?: Extract<Curve, { k: "arc" }>; kw?: string } | null> {
  for (;;) {
    const i = yield { k: "entity", msg, filter: (x) => entityCurves(x, kctx(c)).some((cc) => cc.k === "arc"), ...(kws.length ? { kw: kws } : {}) };
    if (i.k === "kw") return { c: [0, 0], r: 0, kw: i.id };
    if (i.k !== "ent") return null;
    const s = segAt(c.tx.get(i.id)!, i.p, kctx(c));
    if (!s || s.k !== "arc") {
      if (!c.interactive) throw new Error(tr("vyberte kružnici nebo oblouk"));
      c.log(tr("✗ vyberte kružnici nebo oblouk"));
      continue;
    }
    return { c: s.c, r: s.r, arc: s };
  }
}

function* radial(c: CmdCtx, isR: boolean, jogged = false): Gen<void> {
  let ci = yield* pickCircle(c, isR ? tr("Vyberte oblouk nebo kružnici") : tr("Vyberte kružnici nebo oblouk"), isR ? [KD.jogged] : []);
  if (ci?.kw === "jogged") {
    jogged = true;
    ci = yield* pickCircle(c, tr("Vyberte oblouk nebo kružnici"));
  }
  if (!ci) return;
  const { c: cen, r } = ci;
  let oc: Vec2 | null = null;
  if (jogged) {
    const o = yield { k: "point", msg: tr("Zadejte náhradní střed (počátek kótovací čáry)") };
    if (o.k !== "point") return;
    oc = o.p;
  }
  const d: { text?: string; textRot?: number } = {};
  const make = (q: Vec2, jog?: Vec2): Omit<DDimension, "id" | "layer"> => {
    const u = dist(q, cen) > 1e-12 ? unit(sub(q, cen)) : [1, 0] as Vec2;
    const ch = add(cen, mul(u, r));
    const proj = dot(sub(q, cen), u);
    const base: Omit<DDimension, "id" | "layer"> = isR ? newDim(c, { kind: "radius", center: cen, chord: ch, ...withText(d) }) : newDim(c, { kind: "diameter", chord: ch, far: sub(cen, mul(u, r)), ...withText(d) });
    if (oc && jog) return { ...base, jog: { center: oc, jog } };
    const outside = proj > r + 1e-9;
    const g = { ...base } as DDimension;
    const at = add(cen, mul(u, outside ? proj : isR ? Math.max(proj, r * 0.15) : proj));
    return { ...base, textPos: dimTextAt(tmp(g), isR ? r : 2 * r, at, angleOf(u), kctx(c), outside ? 1 : 0) };
  };
  for (;;) {
    const i = yield { k: "point", msg: tr("Zadejte polohu kótovací čáry"), base: cen, kw: [KD.mtext, KD.text, KD.angle], preview: (q) => [make(q) as NewEntity] };
    if (i.k === "kw") {
      yield* textOption(c, i.id, d, cen);
      continue;
    }
    if (i.k !== "point") return;
    if (oc) {
      const j = yield { k: "point", msg: tr("Zadejte polohu zalomení"), base: i.p, preview: (q) => [make(i.p, q) as NewEntity] };
      if (j.k !== "point") return;
      const dd = make(i.p, j.p);
      const u = unit(sub(i.p, cen));
      addDim(c, { ...dd, textPos: dimTextAt(tmp(dd), r, add(cen, mul(u, (r + dot(sub(j.p, cen), u)) / 2)), angleOf(u), kctx(c)) });
    } else addDim(c, make(i.p));
    return;
  }
}

registerCommand({
  id: "DIMRADIUS",
  names: { cs: ["kóta-poloměr"], en: ["dimradius", "dimjogged"], de: ["bemradius", "bemverkürzt"] },
  alias: ["DRA", "DJO", "JOG"],
  group: "annotate",
  desc: () => tr("kóta poloměru R: oblouk / kružnice, poloha (text uvnitř nebo vně); Zalomená = náhradní střed a zalomení (velké poloměry, DIMJOGGED)"),
  usage: () => tr("kóta-poloměr e3 40,30 | kóta-poloměr zalomená e3 0,-80 30,20 10,-20 (náhradní střed, poloha, zalomení)"),
  run: function* (c): CmdGen {
    yield* radial(c, true);
  },
});
registerCommand({
  id: "DIMDIAMETER",
  names: { cs: ["kóta-průměr"], en: ["dimdiameter"], de: ["bemdurchm"] },
  alias: ["DDI"],
  group: "annotate",
  desc: () => tr("kóta průměru Ø: kružnice / oblouk, poloha kótovací čáry (text uvnitř nebo vně)"),
  usage: () => tr("kóta-průměr e3 60,40"),
  run: function* (c): CmdGen {
    yield* radial(c, false);
  },
});
registerCommand({
  id: "DIMARC",
  names: { cs: ["kóta-oblouku"], en: ["dimarc"], de: ["bembogen"] },
  alias: ["DAR"],
  group: "annotate",
  desc: () => tr("kóta délky oblouku (symbol ⌒): oblouk nebo obloukový úsek křivky, poloha; volba Část = jen část oblouku mezi dvěma body"),
  usage: () => tr("kóta-oblouku e4 0,60 | kóta-oblouku e4 část 50,0 0,50 0,70"),
  run: function* (c): CmdGen {
    const ci = yield* pickCircle(c, tr("Vyberte oblouk"));
    if (!ci?.arc) return;
    const s = ci.arc;
    let [p1, p2] = s.sweep >= 2 * Math.PI - 1e-9 ? [polar(s.c, 0, s.r), polar(s.c, Math.PI, s.r)] : arcEnds(s);
    const d: { text?: string; textRot?: number } = {};
    const make = (q: Vec2): Omit<DDimension, "id" | "layer"> => newDim(c, { kind: "arc", center: s.c, p1, p2, arc: q, ...withText(d) });
    for (;;) {
      const i = yield { k: "point", msg: tr("Zadejte polohu kóty délky oblouku"), base: s.c, kw: [KD.mtext, KD.text, KD.angle, KD.partial], preview: (q) => [make(q) as NewEntity] };
      if (i.k === "point") {
        addDim(c, make(i.p));
        return;
      }
      if (i.k !== "kw") return;
      if (i.id === "partial") {
        const a = yield { k: "point", msg: tr("Zadejte první bod na oblouku"), base: s.c };
        if (a.k !== "point") return;
        const b = yield { k: "point", msg: tr("Zadejte druhý bod na oblouku"), base: s.c };
        if (b.k !== "point") return;
        p1 = polar(s.c, angleOf(sub(a.p, s.c)), s.r);
        p2 = polar(s.c, angleOf(sub(b.p, s.c)), s.r);
        continue;
      }
      yield* textOption(c, i.id, d, s.c);
    }
  },
});

// ---------------------------------------------------------------- souřadnicová

registerCommand({
  id: "DIMORDINATE",
  names: { cs: ["kóta-souřadnicová"], en: ["dimordinate"], de: ["bemordinate"] },
  alias: ["DOR"],
  group: "annotate",
  desc: () => tr("souřadnicová kóta od počátku (0,0 nebo volba Počátek): bod prvku, konec odkazu; osa X / Y podle směru odkazu nebo Xbáze / Ybáze"),
  usage: () => tr("kóta-souřadnicová 50,20 50,60 (X = 50) | kóta-souřadnicová 50,20 ybáze 90,20 | kóta-souřadnicová počátek 10,10 50,20 50,60"),
  run: function* (c): CmdGen {
    let origin: Vec2 = [0, 0];
    let f: Vec2 | null = null;
    while (!f) {
      const i = yield { k: "point", msg: tr("Zadejte bod prvku"), kw: [KD.origin] };
      if (i.k === "point") f = i.p;
      else if (i.k === "kw") {
        const o = yield { k: "point", msg: tr("Zadejte počátek souřadnic kót"), def: undefined } as Prompt;
        if (o.k === "point") origin = o.p;
      } else return;
    }
    let axis: boolean | null = null;
    const d: { text?: string; textRot?: number } = {};
    const make = (q: Vec2): Omit<DDimension, "id" | "layer"> => {
      const x = axis ?? Math.abs(q[1] - f![1]) >= Math.abs(q[0] - f![0]);
      return newDim(c, { kind: "ordinate", origin, p1: f!, p2: q, ...(x ? { xAxis: true } : {}), ...withText(d) });
    };
    for (;;) {
      const i = yield { k: "point", msg: tr("Zadejte konec odkazu"), base: f, kw: [KD.xdatum, KD.ydatum, KD.mtext, KD.text, KD.angle], preview: (q) => [make(q) as NewEntity] };
      if (i.k === "point") {
        addDim(c, make(i.p));
        return;
      }
      if (i.k !== "kw") return;
      if (i.id === "xdatum") axis = true;
      else if (i.id === "ydatum") axis = false;
      else yield* textOption(c, i.id, d, f);
    }
  },
});

// ---------------------------------------------------------------- základnicová a řetězová

const chainable = (e: DraftEntity) => e.type === "dimension" && ["linear", "aligned", "ordinate", "angular3"].includes((e as DDimension).kind);
function lastDim(c: CmdCtx): DDimension | null {
  const l = list(c);
  const created = c.session.lastCreated.map((id) => c.tx.get(id)).filter((e): e is DraftEntity => !!e && chainable(e));
  if (created.length) return created[created.length - 1] as DDimension;
  for (let i = l.length - 1; i >= 0; i--) if (chainable(l[i])) return l[i] as DDimension;
  return null;
}

/** je bod výběru blíž 2. vynášecí čáře (p2) než 1. (p1)? (null = kóta bez dvou vynášecích čar) */
function pickedSecond(b: DDimension, q: Vec2): boolean | null {
  if (!b.p1 || !b.p2) return null;
  if (b.kind === "angular3" && b.vertex) {
    const a = angleOf(sub(q, b.vertex));
    const d = (x: Vec2) => Math.abs(normA(angleOf(sub(x, b.vertex!)) - a + Math.PI) - Math.PI);
    return d(b.p2) < d(b.p1);
  }
  if (b.kind !== "linear" && b.kind !== "aligned") return null;
  const dir: Vec2 = b.kind === "aligned" ? unit(sub(b.p2, b.p1)) : [Math.cos(rad(b.rot ?? 0)), Math.sin(rad(b.rot ?? 0))];
  const t = dot(sub(q, b.p1), dir);
  const t2 = dot(sub(b.p2, b.p1), dir);
  return Math.abs(t - t2) < Math.abs(t);
}

function* chain(c: CmdCtx, baseline: boolean): Gen<void> {
  let base = lastDim(c);
  const ids: string[] = [];
  /** výběr kóty: výchozí bude vynášecí čára nejblíž bodu výběru (jako v AutoCADu) – základnicová měří od ní,
   *  řetězová na ni navazuje; kóta se podle toho vnitřně otočí (p1 ↔ p2) */
  const pickBase = function* (): Gen<DDimension | null> {
    const i = yield { k: "entity", msg: baseline ? tr("Vyberte základní kótu") : tr("Vyberte navazovanou kótu"), filter: chainable };
    if (i.k !== "ent") return null;
    const b = c.tx.get(i.id) as DDimension;
    const nearP2 = pickedSecond(b, i.p);
    if (nearP2 === null) return b;
    // základnicová: výchozí vynášecí čára = p1; řetězová: navazuje se na p2
    const swap = baseline ? nearP2 : !nearP2;
    return swap ? ({ ...b, p1: b.p2, p2: b.p1 } as DDimension) : b;
  };
  if (!base) base = yield* pickBase();
  if (!base) throw new Error(tr("ve výkresu není lineární, zarovnaná, souřadnicová ani úhlová (3 body) kóta"));
  const first = base;
  const k = dimSizes(first, kctx(c));
  const step = k.st.dimdli * k.k;
  const make = (b: DDimension, q: Vec2): Omit<DDimension, "id" | "layer"> => {
    const { id: _i, layer: _l, textPos: _t, text: _x, measurement: _m, ...rest } = b;
    void _i, void _l, void _t, void _x, void _m;
    if (b.kind === "ordinate") {
      // konec odkazu na stejné úrovni jako u výchozí kóty (v soustavě kóty), podél měřené osy u nového bodu
      const { ux, uy } = ordinateAxes(b);
      const mDir = b.xAxis ? ux : uy;
      const lDir = b.xAxis ? uy : ux;
      const p2 = add(add(b.origin ?? [0, 0], mul(mDir, dot(sub(q, b.origin ?? [0, 0]), mDir))), mul(lDir, dot(sub(b.p2!, b.origin ?? [0, 0]), lDir)));
      return { ...rest, p1: q, p2 } as Omit<DDimension, "id" | "layer">;
    }
    if (b.kind === "angular3") {
      const R = dist(b.arc!, b.vertex!);
      const a2 = angleOf(sub(q, b.vertex!));
      if (baseline) {
        const R2 = R + step;
        const a1 = angleOf(sub(b.p1!, b.vertex!));
        const am = a1 + normA(a2 - a1) / 2;
        return { ...rest, p2: q, arc: polar(b.vertex!, am, R2) } as Omit<DDimension, "id" | "layer">;
      }
      const a1 = angleOf(sub(b.p2!, b.vertex!));
      return { ...rest, p1: b.p2, p2: q, arc: polar(b.vertex!, a1 + normA(a2 - a1) / 2, R) } as Omit<DDimension, "id" | "layer">;
    }
    const dir: Vec2 = b.kind === "aligned" ? unit(sub(b.p2!, b.p1!)) : [Math.cos(rad(b.rot ?? 0)), Math.sin(rad(b.rot ?? 0))];
    const n = rot90(dir);
    const lp = b.line ?? b.p2!;
    if (baseline) {
      const side = dot(sub(lp, b.p1!), n) >= 0 ? 1 : -1;
      const nl = add(lp, mul(n, side * step));
      const r: Omit<DDimension, "id" | "layer"> = { ...rest, p2: q, line: add(nl, mul(dir, dot(sub(q, nl), dir))) };
      if (b.kind === "aligned") return { ...r, kind: "linear", rot: normDeg(deg(angleOf(dir))) } as Omit<DDimension, "id" | "layer">;
      return r;
    }
    const r: Omit<DDimension, "id" | "layer"> = { ...rest, p1: b.p2, p2: q, line: add(lp, mul(dir, dot(sub(q, lp), dir))) };
    if (b.kind === "aligned") return { ...r, kind: "linear", rot: normDeg(deg(angleOf(dir))) } as Omit<DDimension, "id" | "layer">;
    return r;
  };
  let cur = base;
  for (;;) {
    const i = yield { k: "point", msg: tr("Zadejte počátek druhé vynášecí čáry"), base: cur.p2 ?? cur.p1, kw: [KD.select, KD.undo], none: true, preview: (q) => [make(cur, q) as NewEntity] };
    if (i.k === "point") {
      const id = addDim(c, make(cur, i.p));
      ids.push(id);
      cur = c.tx.get(id) as DDimension;
      if (!baseline) continue;
      continue;
    }
    if (i.k === "kw" && i.id === "select") {
      const b = yield* pickBase();
      if (b) cur = b;
      continue;
    }
    if (i.k === "kw" && i.id === "undo") {
      const id = ids.pop();
      if (id) c.tx.remove(id);
      cur = ids.length ? (c.tx.get(ids[ids.length - 1]) as DDimension) : first;
      continue;
    }
    break;
  }
  if (ids.length) logCreated(c, ids);
}

registerCommand({
  id: "DIMBASELINE",
  names: { cs: ["kóta-základnicová"], en: ["dimbaseline"], de: ["bembasisl"] },
  alias: ["DBA"],
  group: "annotate",
  desc: () => tr("základnicové kóty od 1. vynášecí čáry poslední (nebo vybrané) kóty, rozestup DIMDLI; Enter ukončí, Zpět, Vybrat"),
  usage: () => tr("kóta-základnicová 150,0 200,0 (po kóta-lineární 0,0 100,0 50,-15)"),
  run: function* (c): CmdGen {
    yield* chain(c, true);
  },
});
registerCommand({
  id: "DIMCONTINUE",
  names: { cs: ["kóta-řetězová"], en: ["dimcontinue"], de: ["bemweiter"] },
  alias: ["DCO"],
  group: "annotate",
  desc: () => tr("řetězové kóty navazující na 2. vynášecí čáru poslední (nebo vybrané) kóty na stejné kótovací čáře; Enter ukončí, Zpět, Vybrat"),
  usage: () => tr("kóta-řetězová 150,0 200,0 (po kóta-lineární 0,0 100,0 50,-15)"),
  run: function* (c): CmdGen {
    yield* chain(c, false);
  },
});

// ---------------------------------------------------------------- DIM (chytrá kóta)

registerCommand({
  id: "DIM",
  names: { cs: ["kóta"], en: ["dim"], de: ["bem"] },
  group: "annotate",
  desc: () => tr("chytrá kóta podle objektu: úsečka → délka (vodorovně / svisle / zarovnaná), kružnice → průměr, oblouk → poloměr; volby Body, Úhlová, Základnicová, Řetězová, Souřadnicová, Zarovnaná, Poloměr, Průměr, Oblouková, Zalomená"),
  usage: () => tr("kóta e3 50,-15 | kóta e5 60,40 (kružnice → Ø) | kóta body 0,0 100,0 50,-15 | kóta úhlová e1 e2 40,15"),
  run: function* (c): CmdGen {
    const kws = [KD.points, KD.angular, KD.baseline, KD.cont, KD.ordinate, KD.aligned, KD.radius, KD.diameter, KD.arclen, KD.jogged];
    const i = yield { k: "entity", msg: tr("Vyberte objekt nebo zvolte druh kóty"), filter: (x) => entityCurves(x, kctx(c)).length > 0 && x.type !== "dimension", kw: kws };
    if (i.k === "kw") {
      const map: Record<string, string> = { angular: "DIMANGULAR", baseline: "DIMBASELINE", continue: "DIMCONTINUE", ordinate: "DIMORDINATE", aligned: "DIMALIGNED", radius: "DIMRADIUS", diameter: "DIMDIAMETER", arclength: "DIMARC" };
      if (i.id === "points") {
        const a = yield { k: "point", msg: tr("Zadejte počátek první vynášecí čáry") };
        if (a.k !== "point") return;
        const b = yield { k: "point", msg: tr("Zadejte počátek druhé vynášecí čáry"), base: a.p, preview: (q) => [{ type: "line", a: a.p, b: q }] };
        if (b.k !== "point") return;
        yield* placeLinear(c, a.p, b.p, false);
        return;
      }
      if (i.id === "jogged") return yield* radial(c, true, true);
      const def = findCommand(map[i.id]);
      if (def?.run) yield* def.run(c);
      return;
    }
    if (i.k !== "ent") return;
    const e = c.tx.get(i.id)!;
    const s = segAt(e, i.p, kctx(c));
    if (!s) return;
    if (s.k === "line") {
      const aligned = Math.abs(s.a[0] - s.b[0]) > 1e-9 && Math.abs(s.a[1] - s.b[1]) > 1e-9;
      yield* placeLinear(c, s.a, s.b, aligned);
      return;
    }
    if (s.k === "arc") {
      const full = s.sweep >= 2 * Math.PI - 1e-9;
      const isR = !full;
      const d: { text?: string; textRot?: number } = {};
      const make = (q: Vec2): Omit<DDimension, "id" | "layer"> => {
        const u = dist(q, s.c) > 1e-12 ? unit(sub(q, s.c)) : ([1, 0] as Vec2);
        const ch = add(s.c, mul(u, s.r));
        const proj = dot(sub(q, s.c), u);
        const outside = proj > s.r + 1e-9;
        const base = isR ? newDim(c, { kind: "radius", center: s.c, chord: ch, ...withText(d) }) : newDim(c, { kind: "diameter", chord: ch, far: sub(s.c, mul(u, s.r)), ...withText(d) });
        return { ...base, textPos: dimTextAt(tmp(base), isR ? s.r : 2 * s.r, add(s.c, mul(u, outside ? proj : isR ? Math.max(proj, s.r * 0.15) : proj)), angleOf(u), kctx(c), outside ? 1 : 0) };
      };
      for (;;) {
        const q = yield { k: "point", msg: tr("Zadejte polohu kótovací čáry"), base: s.c, kw: [KD.mtext, KD.text, KD.angle], preview: (p) => [make(p) as NewEntity] };
        if (q.k === "point") {
          addDim(c, make(q.p));
          return;
        }
        if (q.k !== "kw") return;
        yield* textOption(c, q.id, d, s.c);
      }
    }
    throw new Error(tr("objekt nejde okótovat – vyberte úsečku, kružnici nebo oblouk"));
  },
});
// ---------------------------------------------------------------- DIMSTYLE

const DW = {
  new: ["novy", "new", "neu", "vytvorit"],
  modify: ["upravit", "modify", "andern", "aendern", "zmenit", "set"],
  current: ["aktualni", "current", "aktuell", "restore", "obnovit"],
  rename: ["prejmenovat", "rename", "umbenennen"],
  delete: ["smazat", "delete", "loschen", "loeschen"],
  apply: ["pouzit", "apply", "anwenden", "aplikovat"],
  override: ["prepsat", "override", "uberschreiben", "ueberschreiben", "dimoverride"],
  show: ["vypsat", "status", "show", "anzeigen", "zobrazit", "list", "seznam"],
  anno: ["meritko-poznamek", "meritkopoznamek", "annoscale", "cannoscale", "beschriftungsmassstab", "anno"],
  from: ["z", "from", "von", "podle"],
  moveTo: ["presunout-na", "presunoutna", "moveto", "nach"],
  clear: ["vycistit", "clear", "zrusit", "loschen-ov"],
};
function varPatch(a: string[], from: number, c: CmdCtx): Partial<DraftDimStyle> {
  const out: Record<string, unknown> = {};
  for (let i = from; i < a.length; i++) {
    let key = a[i];
    let val: string | undefined;
    const eq = key.indexOf("=");
    if (eq > 0) {
      val = key.slice(eq + 1);
      key = key.slice(0, eq);
    } else val = a[++i];
    const def = dimVarDef(key);
    if (!def) throw new Error(tr("neznámá proměnná kótovacího stylu „{0}“ – např. {1}", key, DIM_VARS.slice(0, 12).map((d) => d.key).join(", ")));
    if (val === undefined) throw new Error(tr("chybí hodnota proměnné {0}", key.toUpperCase()));
    out[def.key] = parseDimVar(def, val, c.tx.model);
  }
  return out as Partial<DraftDimStyle>;
}
const styleSummary = (s: DraftDimStyle, m: import("../model").DraftModel) => {
  const r = resolveDimStyle(m, s.name);
  return `${s.name === currentDimStyle(m) ? "* " : "  "}${s.name}: DIMTXT ${r.dimtxt}, DIMASZ ${r.dimasz}, DIMSCALE ${r.dimscale}, DIMDEC ${r.dimdec}, DIMDSEP "${r.dimdsep}", DIMTAD ${r.dimtad}${r.dimtol ? `, DIMTOL +${r.dimtp}/-${r.dimtm}` : ""}${r.dimlim ? ", DIMLIM" : ""} (${tr("kót")}: ${countDims(m, s.name)})`;
};
function selIds(c: CmdCtx, a: string[], from: number): { ids: string[]; next: number } {
  const ids: string[] = [];
  let i = from;
  for (; i < a.length && /^e\d+$/i.test(a[i]); i++) ids.push(a[i].toLowerCase());
  if (!ids.length) ids.push(...c.session.sel);
  const dims = ids.filter((id) => c.tx.get(id)?.type === "dimension");
  if (!dims.length) throw new Error(tr("zadejte kóty (e3 e5) nebo je nejdřív vyberte"));
  return { ids: dims, next: i };
}

registerCommand({
  id: "DIMSTYLE",
  names: { cs: ["kótovací-styl"], en: ["dimstyle", "ddim"], de: ["bemstil"] },
  alias: ["D", "DST"],
  group: "annotate",
  desc: () => tr("kótovací styly (ISO-25 výchozí): výpis, nový [z ZDROJ] / upravit s proměnnými (dimtxt, dimasz, dimscale, dimdec, dimdsep, dimzin, dimlfac, dimpost, dimtol, dimtp, dimtm, dimlim…), aktuální, přejmenovat, smazat, použít na kóty, přepsat u kóty, vypsat, měřítko-poznámek 1:50"),
  usage: () => tr("kótovací-styl nový Strojní z ISO-25 dimtxt 3.5 dimdec 1 | kótovací-styl aktuální Strojní | kótovací-styl upravit Strojní dimtol 1 dimtp 0.1 dimtm 0.05 | kótovací-styl přepsat e5 dimdec 3 | kótovací-styl měřítko-poznámek 1:50"),
  line: (c, a) => {
    const m0 = c.tx.model;
    if (!a.length) {
      if (c.interactive) c.ui?.openPanel?.("annot-styles");
      c.out("dimStyles", dimStyles(m0).map((s) => ({ ...resolveDimStyle(m0, s.name), current: s.name === currentDimStyle(m0), count: countDims(m0, s.name) })));
      c.out("annoScale", annoMultiplier(m0));
      c.out("cannoscale", m0.vars.cannoscale ?? 1);
      for (const s of dimStyles(m0)) c.log(styleSummary(s, m0));
      c.log(tr("měřítko poznámek: {0}", annoScaleLabel(annoMultiplier(m0))));
      return;
    }
    const op = a[0];
    const set = (fn: (m: import("../model").DraftModel) => import("../model").DraftModel) => c.tx.setModel(fn);
    if (isW(op, ...DW.new)) {
      const name = a[1];
      if (!name) throw new Error(tr("zadejte název nového stylu"));
      let from: string | undefined;
      let i = 2;
      if (isW(a[2], ...DW.from)) {
        from = a[3];
        i = 4;
      }
      const patch = varPatch(a, i, c);
      set((m) => setCurrentDimStyle(createDimStyle(m, name, from, patch), name));
      c.log(tr("✓ kótovací styl {0} vytvořen a nastaven jako aktuální", name));
      return;
    }
    if (isW(op, ...DW.modify)) {
      let name = a[1];
      let i = 2;
      if (!name || !findDimStyle(m0, name)) {
        // a[1] není styl: buď je to už proměnná (styl = aktuální), nebo neexistující styl před proměnnými
        const nextIsVar = a[2] !== undefined && !!dimVarDef(a[2].split("=")[0]);
        if (name && nextIsVar && !dimVarDef(name.split("=")[0])) throw new Error(tr("kótovací styl „{0}“ ve výkresu není – styly: {1}", name, dimStyles(m0).map((x) => x.name).join(", ")));
        name = currentDimStyle(m0);
        i = 1;
      }
      const patch = varPatch(a, i, c);
      if (!Object.keys(patch).length) throw new Error(tr("zadejte proměnné a hodnoty, např. dimtxt 3.5"));
      set((m) => modifyDimStyle(m, name, patch));
      c.log(tr("✓ kótovací styl {0} upraven: {1}", findDimStyle(c.tx.model, name)?.name ?? name, Object.entries(patch).map(([k, v]) => `${k.toUpperCase()}=${v}`).join(" ")));
      return;
    }
    if (isW(op, ...DW.current)) {
      set((m) => setCurrentDimStyle(m, a[1] ?? ""));
      c.log(tr("✓ aktuální kótovací styl: {0}", currentDimStyle(c.tx.model)));
      return;
    }
    if (isW(op, ...DW.rename)) {
      set((m) => renameDimStyle(m, a[1] ?? "", a[2] ?? ""));
      c.log(tr("✓ kótovací styl {0} přejmenován na {1}", a[1], a[2]));
      return;
    }
    if (isW(op, ...DW.delete)) {
      const mv = isW(a[2], ...DW.moveTo) ? a[3] : undefined;
      set((m) => deleteDimStyle(m, a[1] ?? "", mv));
      c.log(tr("✓ kótovací styl {0} smazán", a[1]));
      return;
    }
    if (isW(op, ...DW.show)) {
      const s = findDimStyle(m0, a[1] ?? currentDimStyle(m0));
      if (!s) throw new Error(tr("kótovací styl „{0}“ ve výkresu není – styly: {1}", a[1] ?? "", dimStyles(m0).map((x) => x.name).join(", ")));
      const r = resolveDimStyle(m0, s.name);
      c.out("dimStyle", r);
      for (const d of DIM_VARS) c.log(`${d.key.toUpperCase()} = ${JSON.stringify((r as Record<string, unknown>)[d.key] ?? "")}  (${d.label()})`);
      return;
    }
    if (isW(op, ...DW.anno)) {
      const k = parseAnnoScale(a[1] ?? "");
      // CANNOSCALE = papír : skutečnost (1:50 → 0,02) jako v AutoCADu a v balíku layout
      c.tx.setVars({ cannoscale: cannoscaleOf(k) });
      c.out("annoScale", k);
      invalidateGeometry();
      c.log(tr("✓ měřítko poznámek: {0}", annoScaleLabel(k)));
      return;
    }
    if (isW(op, ...DW.apply)) {
      const name = a[1];
      const st = name ? findDimStyle(m0, name) : undefined;
      if (!st) throw new Error(tr("kótovací styl „{0}“ ve výkresu není – styly: {1}", name ?? "", dimStyles(m0).map((x) => x.name).join(", ")));
      const { ids } = selIds(c, a, 2);
      set(materializeDimStyles);
      const anno = !!resolveDimStyle(c.tx.model, st.name).dimanno;
      for (const id of ids)
        c.tx.update(id, (e) => {
          const { overrides: _o, annotative: _a, ...rest } = e as DDimension;
          void _o, void _a;
          return { ...rest, style: st.name, ...(anno ? { annotative: true } : {}) } as DraftEntity;
        });
      c.log(tr("✓ styl {0} použit na kóty: {1}", st.name, ids.join(", ")));
      return;
    }
    if (isW(op, ...DW.override)) {
      const { ids, next } = selIds(c, a, 1);
      const clear = isW(a[next], ...DW.clear);
      const patch = clear ? {} : varPatch(a, next, c);
      if (!clear && !Object.keys(patch).length) throw new Error(tr("zadejte proměnné a hodnoty, např. dimdec 3"));
      for (const id of ids)
        c.tx.update(id, (e) => {
          const d = e as DDimension;
          if (clear) {
            const { overrides: _o, ...rest } = d;
            void _o;
            return rest as DraftEntity;
          }
          return { ...d, overrides: { ...(d.overrides ?? {}), ...patch } } as DraftEntity;
        });
      c.log(clear ? tr("✓ přepsání zrušeno: {0}", ids.join(", ")) : tr("✓ přepsáno u kót {0}: {1}", ids.join(", "), Object.entries(patch).map(([k, v]) => `${k.toUpperCase()}=${v}`).join(" ")));
      return;
    }
    // název stylu → aktuální
    if (findDimStyle(m0, op) && a.length === 1) {
      set((m) => setCurrentDimStyle(m, op));
      c.log(tr("✓ aktuální kótovací styl: {0}", currentDimStyle(c.tx.model)));
      return;
    }
    throw new Error(tr("neznámá volba „{0}“ – nový, upravit, aktuální, přejmenovat, smazat, použít, přepsat, vypsat, měřítko-poznámek", op));
  },
});

// ---------------------------------------------------------------- CENTERMARK

registerCommand({
  id: "CENTERMARK",
  names: { cs: ["značka-středu"], en: ["centermark", "dimcenter"], de: ["zentrumsmarke", "mittelpunktmarke"] },
  alias: ["CM", "DCE"],
  group: "annotate",
  desc: () => tr("značka středu kružnice / oblouku s osami (čárkovaná CENTER, přesah 3 mm); Velikost = velikost kříže; Osa = osa mezi dvěma úsečkami"),
  usage: () => tr("značka-středu e3 e4 | značka-středu velikost 5 e3 | značka-středu osa e1 e2"),
  run: function* (c): CmdGen {
    const st = dimSizes({}, kctx(c));
    let size = Math.abs(st.st.dimcen || 2.5) * st.k;
    const ext = 3 * st.k;
    const ids: string[] = [];
    const lt = c.tx.linetype("CENTER");
    for (;;) {
      const i = yield { k: "entity", msg: tr("Vyberte kružnici nebo oblouk"), filter: (x) => entityCurves(x, kctx(c)).some((cc) => cc.k === "arc" || cc.k === "line"), kw: [KD.size, KD.centerline], none: true };
      if (i.k === "kw" && i.id === "size") {
        const s = yield { k: "dist", msg: tr("Zadejte velikost značky středu"), def: size, min: 1e-9 };
        if (s.k === "num") size = s.v;
        continue;
      }
      if (i.k === "kw" && i.id === "centerline") {
        const a = yield { k: "entity", msg: tr("Vyberte první úsečku"), filter: (x) => entityCurves(x, kctx(c)).some((cc) => cc.k === "line") };
        if (a.k !== "ent") break;
        const b = yield { k: "entity", msg: tr("Vyberte druhou úsečku"), filter: (x) => entityCurves(x, kctx(c)).some((cc) => cc.k === "line") };
        if (b.k !== "ent") break;
        const s1 = segAt(c.tx.get(a.id)!, a.p, kctx(c));
        const s2 = segAt(c.tx.get(b.id)!, b.p, kctx(c));
        if (s1?.k !== "line" || s2?.k !== "line") throw new Error(tr("osa se kreslí mezi dvěma úsečkami"));
        let [a2, b2] = [s2.a, s2.b];
        if (dot(sub(b2, a2), sub(s1.b, s1.a)) < 0) [a2, b2] = [b2, a2];
        const p = mid(s1.a, a2);
        const q = mid(s1.b, b2);
        const u = unit(sub(q, p));
        ids.push(c.tx.add({ type: "line", a: sub(p, mul(u, ext)), b: add(q, mul(u, ext)), linetype: lt } as NewEntity));
        continue;
      }
      if (i.k !== "ent") break;
      const s = segAt(c.tx.get(i.id)!, i.p, kctx(c));
      if (!s || s.k !== "arc") {
        if (!c.interactive) throw new Error(tr("vyberte kružnici nebo oblouk"));
        continue;
      }
      const parts: NewEntity[] = [];
      centerMark(parts, s.c, s.r, size, {}, { ext, linetype: lt });
      for (const p of parts) ids.push(c.tx.add(p));
      if (!c.interactive && !ids.length) break;
    }
    logCreated(c, ids);
  },
});
