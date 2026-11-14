/**
 * BALÍK 2 (annot) – registrace druhů entit: mtext, dimension (8 druhů kót), leader (odkaz), hatch (šrafa), tolerance
 * a surfsym (značka drsnosti). Kóty, odkazy, tolerance a značky se skládají z dílčích entit jádra (úsečky, oblouky,
 * plné šipky, MTEXT) – stejné díly kreslí obrazovka, vrací EXPLODE a zapisuje DWG / DXF.
 */
import { tr } from "../../i18n";
import { cClosest, type Curve } from "../curves";
import { add, angleOf, closestOnSeg, deg, dist, dot, mul, rad, rot90, sub, unit, xfAngle, xfDet, xfPt, xfUniform, xfVec, type Affine, type Box } from "../geom";
import { kindOf, registerKind, type DraftField, type InfoRow, type KindCtx, type Prim, type SnapPt } from "../kinds";
import { splineFromFit } from "../kinds-core";
import type { DraftEntity, DraftModel, NewEntity, Vec2 } from "../model";
import { normDeg } from "../units";
import { annoScaleOf, isAnnotative } from "./anno";
import { dimensionGeometry, arrowParts, ordinateAxes, type DimGeom } from "./dimgeom";
import { DIM_VARS, dimStyles, dimVarDef, findDimStyle, fmtDimAng, fmtDimLen, parseDimVar, resolveDimStyle } from "./dimstyle";
import { surfaceParts, toleranceParts, tolerancePlain } from "./gdt";
import { boxDist, cornersBox, mtextCorners, mtextExplode, mtextPlain, mtextPrims, placeMText, type MPlaced } from "./mtext";
import { activeLoops, hatchArea, hatchLines, hatchSegments, inPoly, isSolidName, loopPolygon, type PatLine } from "./patterns";
import type { DDimension, DHatch, DLeader, DMText, DSurfSym, DTolerance } from "./types";
import { partPrimsEntity } from "./parts";
import { boolOf, colorRgb, compactPrims, fld, nonNeg, num, parsePt2, posNum, ptStr, readableAngle, rgbToHex, temp, unknownKey, inheritStyle } from "./util";

const IDENT: Affine = [1, 0, 0, 1, 0, 0];

// ---------------------------------------------------------------- díly (společné pro kóty, odkazy, tolerance, značky)

/** mezipaměť dílů podle identity entity a stavu modelu (styly, měřítko poznámek) */
const partsCache = new WeakMap<object, { tok: unknown[]; v: unknown }>();
const tokenOf = (m: DraftModel) => [m.dimStyles, m.textStyles, m.vars.cannoscale, m.vars.dimstyle, m.vars.measurement, m.vars.textstyle];
function cached<T>(e: object, m: DraftModel, fn: () => T): T {
  const tok = tokenOf(m);
  const c = partsCache.get(e);
  if (c && c.tok.length === tok.length && c.tok.every((x, i) => x === tok[i])) return c.v as T;
  const v = fn();
  partsCache.set(e, { tok, v });
  return v;
}

const hasOwnStyle = (p: NewEntity) => p.color !== undefined || p.lineweight !== undefined || p.linetype !== undefined;

function partsPrims(parts: NewEntity[], ctx: KindCtx): Prim[] {
  const out: Prim[] = [];
  const own: DraftEntity[] = [];
  parts.forEach((p, i) => {
    const t = temp(p, i);
    if (hasOwnStyle(p)) own.push(partPrimsEntity(t, ctx));
    else out.push(...(kindOf(t)?.prims(t, ctx) ?? []));
  });
  const res = compactPrims(out);
  if (own.length) res.push({ k: "sub", entities: own, xf: IDENT });
  return res;
}
const LINEAR_KINDS = new Set(["line", "arc", "circle", "polyline", "spline", "ellipse"]);
function partsCurves(parts: NewEntity[], ctx: KindCtx): Curve[] {
  const out: Curve[] = [];
  parts.forEach((p, i) => {
    if (!LINEAR_KINDS.has(p.type)) return;
    const t = temp(p, i);
    out.push(...(kindOf(t)?.curves(t, ctx) ?? []));
  });
  return out;
}
function partsBox(parts: NewEntity[], ctx: KindCtx): Box | null {
  let b: Box | null = null;
  parts.forEach((p, i) => {
    const t = temp(p, i);
    const pb = kindOf(t)?.bbox(t, ctx);
    if (!pb) return;
    b = b ? { x0: Math.min(b.x0, pb.x0), y0: Math.min(b.y0, pb.y0), x1: Math.max(b.x1, pb.x1), y1: Math.max(b.y1, pb.y1) } : { ...pb };
  });
  return b;
}
function partsHit(parts: NewEntity[], q: Vec2, ctx: KindCtx): number {
  let d = Infinity;
  parts.forEach((p, i) => {
    const t = temp(p, i);
    const k = kindOf(t);
    if (!k) return;
    if (k.hitDist) d = Math.min(d, k.hitDist(t, q, ctx));
    else for (const c of k.curves(t, ctx)) d = Math.min(d, cClosest(c, q).d);
  });
  return d;
}
const explodeParts = (src: DraftEntity, parts: NewEntity[]) => parts.map((p) => inheritStyle(src, p));

const pkey = (key: string, label: string, p: Vec2 | undefined): DraftField[] => (p ? [fld(key, label, ptStr(p), "pt")] : []);
const angF = (raw: string, what: string) => normDeg(num(raw, what));

// ---------------------------------------------------------------- MTEXT

const ATTACH: Record<string, number> = { tl: 1, tc: 2, tr: 3, ml: 4, mc: 5, mr: 6, bl: 7, bc: 8, br: 9 };
export const ATTACH_NAMES = ["TL", "TC", "TR", "ML", "MC", "MR", "BL", "BC", "BR"];
export function parseAttach(raw: string): number {
  const t = raw.trim().toLowerCase();
  const n = ATTACH[t] ?? Number(t);
  if (!(Number.isInteger(n) && n >= 1 && n <= 9)) throw new Error(tr("připojení: 1–9 nebo TL, TC, TR, ML, MC, MR, BL, BC, BR"));
  return n;
}
const mtK = (e: DMText, ctx: KindCtx) => (isAnnotative(e) ? annoScaleOf(e, ctx.model) : 1);
const mtPlace = (e: DMText, ctx: KindCtx): MPlaced => placeMText(e, ctx, mtK(e, ctx));

/** obraz textového rámu v transformaci: čitelný směr, zachovaný střed rámečku */
function mirrorReadable(m: Affine, dir: Vec2): { dir: Vec2; flip: boolean } {
  const d2 = unit(xfVec(m, dir));
  const a = angleOf(d2);
  const r = readableAngle(a);
  return { dir: [Math.cos(r), Math.sin(r)], flip: Math.abs(r - a) > 1e-9 && Math.abs(Math.abs(r - a) - 2 * Math.PI) > 1e-9 };
}

registerKind<"mtext">({
  type: "mtext",
  label: () => tr("Odstavcový text"),
  curves: () => [],
  prims: (e, ctx) => mtextPrims(mtPlace(e, ctx), e.style),
  bbox: (e, ctx) => cornersBox(mtextCorners(mtPlace(e, ctx))),
  snaps: (e) => [{ kind: "ins", p: e.p }],
  grips: (e, ctx) => {
    const pl = mtPlace(e, ctx);
    return [e.p, add(add(e.p, mul(pl.dir, pl.lay.left + pl.lay.w)), mul(pl.up, pl.lay.top))];
  },
  moveGrip: (e, i, q, ctx) => {
    if (i === 0) return { ...e, p: q };
    const pl = mtPlace(e, ctx);
    const left = add(add(e.p, mul(pl.dir, pl.lay.left)), mul(pl.up, pl.lay.top));
    const w = dot(sub(q, left), pl.dir) / mtK(e, ctx);
    return w > e.h ? { ...e, w } : null;
  },
  transform: (e, m, ctx) => {
    const k = xfUniform(m);
    if (k === null) return null;
    if (xfDet(m) > 0) return { ...e, p: xfPt(m, e.p), h: e.h * k, w: (e.w || 0) * k, rot: normDeg((e.rot ?? 0) + deg(xfAngle(m))) };
    const pl = mtPlace(e, ctx);
    const L = pl.lay;
    const center = add(add(e.p, mul(pl.dir, L.left + L.w / 2)), mul(pl.up, L.top - L.h / 2));
    const c2 = xfPt(m, center);
    const { dir } = mirrorReadable(m, pl.dir);
    const up = rot90(dir);
    const p2 = sub(c2, add(mul(dir, k * (L.left + L.w / 2)), mul(up, k * (L.top - L.h / 2))));
    return { ...e, p: p2, h: e.h * k, w: (e.w || 0) * k, rot: normDeg(deg(angleOf(dir))) };
  },
  info: (e, ctx, F) => [
    [tr("Text"), mtextPlain(e.s).join(" ⏎ ")],
    [tr("Bod vložení"), F.pt(e.p)],
    [tr("Výška"), F.len(e.h)],
    [tr("Šířka rámečku"), e.w ? F.len(e.w) : tr("bez zalamování")],
    [tr("Natočení"), F.ang(e.rot ?? 0)],
    [tr("Styl"), e.style ?? ctx.model.vars.textstyle],
    [tr("Připojení"), ATTACH_NAMES[(e.attach ?? 1) - 1] ?? "TL"],
    [tr("Řádkování"), String(e.lineSpacing ?? 1)],
    [tr("Řádků"), String(mtPlace(e, ctx).lay.glyphs.length ? mtextPlain(e.s).length : 0)],
    ...(e.annotative ? ([[tr("Anotativní"), tr("ano")]] as InfoRow[]) : []),
  ],
  fields: (e, ctx, F) => [
    fld("s", tr("Obsah (kódy MTEXT)"), e.s, "text"),
    fld("p", tr("Bod vložení"), ptStr(e.p), "pt"),
    fld("h", tr("Výška"), F.len(e.h), "num"),
    fld("w", tr("Šířka rámečku"), F.len(e.w || 0), "num"),
    fld("rot", tr("Natočení"), F.ang(e.rot ?? 0), "angle"),
    fld("style", tr("Styl"), e.style ?? ctx.model.vars.textstyle, "text"),
    fld("attach", tr("Připojení (TL…BR)"), ATTACH_NAMES[(e.attach ?? 1) - 1] ?? "TL", "text"),
    fld("lineSpacing", tr("Řádkování"), e.lineSpacing ?? 1, "num"),
    fld("annotative", tr("Anotativní"), e.annotative ? 1 : 0, "bool"),
    fld("bg", tr("Maska pozadí"), e.bg ? 1 : 0, "bool"),
  ],
  setField: (e, key, raw, ctx) => {
    switch (key) {
      case "s":
        return { ...e, s: raw };
      case "p":
        return { ...e, p: parsePt2(raw) };
      case "h":
        return { ...e, h: posNum(raw, tr("Výška")) };
      case "w":
        return { ...e, w: nonNeg(raw, tr("Šířka rámečku")) };
      case "rot":
        return { ...e, rot: angF(raw, tr("Natočení")) };
      case "style": {
        const st = ctx.model.textStyles.find((x) => x.name.toLowerCase() === raw.trim().toLowerCase());
        if (!st) throw new Error(tr("textový styl „{0}“ ve výkresu není – styly: {1}", raw, ctx.model.textStyles.map((x) => x.name).join(", ")));
        return { ...e, style: st.name };
      }
      case "attach":
        return { ...e, attach: parseAttach(raw) };
      case "lineSpacing":
      case "linespacing":
        return { ...e, lineSpacing: posNum(raw, tr("Řádkování")) };
      case "annotative":
        return { ...e, annotative: boolOf(raw) };
      case "bg": {
        if (!boolOf(raw)) {
          const { bg: _b, ...rest } = e;
          void _b;
          return rest;
        }
        return { ...e, bg: { useBackground: true, scale: 1.5 } };
      }
    }
    throw unknownKey(key, ["s", "p", "h", "w", "rot", "style", "attach", "lineSpacing", "annotative", "bg"]);
  },
  hitDist: (e, q, ctx) => boxDist(mtextCorners(mtPlace(e, ctx)), q),
  explode: (e, ctx) => mtextExplode(mtPlace(e, ctx), e.style).map((p) => inheritStyle(e, p)),
});

// ---------------------------------------------------------------- KÓTA

export const dimGeom = (e: DDimension, ctx: KindCtx): DimGeom => cached(e, ctx.model, () => dimensionGeometry(e, ctx));
const DIM_LABEL: Record<string, () => string> = {
  linear: () => tr("lineární"),
  aligned: () => tr("zarovnaná"),
  angular: () => tr("úhlová"),
  angular3: () => tr("úhlová (3 body)"),
  radius: () => tr("poloměr"),
  diameter: () => tr("průměr"),
  ordinate: () => tr("souřadnicová"),
  arc: () => tr("délka oblouku"),
};
export const dimKindLabel = (k: string) => DIM_LABEL[k]?.() ?? k;
/** naměřená hodnota formátovaná stylem kóty (bez textu přepisu) */
export function dimMeasuredText(e: DDimension, ctx: KindCtx): string {
  const st = resolveDimStyle(ctx.model, e.style, e.overrides);
  const v = dimGeom(e, ctx).measured;
  return e.kind === "angular" || e.kind === "angular3" ? fmtDimAng(v, st) : fmtDimLen(v, st);
}
/** definiční body kóty: klíč pole → bod */
function dimPoints(e: DDimension): [keyof DDimension, string][] {
  switch (e.kind) {
    case "linear":
    case "aligned":
      return [["p1", tr("1. vynášecí čára")], ["p2", tr("2. vynášecí čára")], ["line", tr("Kótovací čára")]];
    case "radius":
      return [["center", tr("Střed")], ["chord", tr("Bod na oblouku")]];
    case "diameter":
      return [["chord", tr("Bod na kružnici")], ["far", tr("Protilehlý bod")]];
    case "angular3":
      return [["vertex", tr("Vrchol")], ["p1", tr("1. bod")], ["p2", tr("2. bod")], ["arc", tr("Oblouk kóty")]];
    case "ordinate":
      return [["origin", tr("Počátek")], ["p1", tr("Bod prvku")], ["p2", tr("Konec odkazu")]];
    case "arc":
      return [["center", tr("Střed")], ["p1", tr("Začátek oblouku")], ["p2", tr("Konec oblouku")], ["arc", tr("Oblouk kóty")]];
    default:
      return [["arc", tr("Oblouk kóty")]];
  }
}

registerKind<"dimension">({
  type: "dimension",
  label: () => tr("Kóta"),
  curves: (e, ctx) => partsCurves(dimGeom(e, ctx).parts, ctx),
  prims: (e, ctx) => partsPrims(dimGeom(e, ctx).parts, ctx),
  bbox: (e, ctx) => {
    const g = dimGeom(e, ctx);
    const b = partsBox(g.parts, ctx);
    let out = b;
    for (const p of g.defs) out = out ? { x0: Math.min(out.x0, p[0]), y0: Math.min(out.y0, p[1]), x1: Math.max(out.x1, p[0]), y1: Math.max(out.y1, p[1]) } : { x0: p[0], y0: p[1], x1: p[0], y1: p[1] };
    return out;
  },
  snaps: (e, ctx) => {
    const g = dimGeom(e, ctx);
    const out: SnapPt[] = g.defs.map((p) => ({ kind: "nod", p }));
    if (g.textMid) out.push({ kind: "ins", p: g.textMid });
    return out;
  },
  grips: (e, ctx) => {
    const g = dimGeom(e, ctx);
    const pts = dimPoints(e).map(([k]) => e[k] as Vec2 | undefined);
    if (e.kind === "angular") pts.unshift(e.l1?.[0], e.l1?.[1], e.l2?.[0], e.l2?.[1]);
    if (e.jog) pts.push(e.jog.center, e.jog.jog);
    return [...pts.filter((p): p is Vec2 => !!p), ...(g.textMid ? [g.textMid] : [])];
  },
  moveGrip: (e, i, q, ctx) => {
    const keys = dimPoints(e).map(([k]) => k).filter((k) => e[k]);
    const list: ((q: Vec2) => DDimension)[] = [];
    if (e.kind === "angular") {
      list.push((p) => ({ ...e, l1: [p, e.l1![1]] }), (p) => ({ ...e, l1: [e.l1![0], p] }), (p) => ({ ...e, l2: [p, e.l2![1]] }), (p) => ({ ...e, l2: [e.l2![0], p] }));
    }
    for (const k of keys) list.push((p) => ({ ...e, [k]: p }) as DDimension);
    if (e.jog) list.push((p) => ({ ...e, jog: { ...e.jog!, center: p } }), (p) => ({ ...e, jog: { ...e.jog!, jog: p } }));
    if (dimGeom(e, ctx).textMid) list.push((p) => ({ ...e, textPos: p }));
    const f = list[i];
    if (!f) return null;
    // posun bodu na kótovací čáře posune i ručně umístěný text
    const n = f(q);
    if (keys[i - (e.kind === "angular" ? 4 : 0)] === "line" && e.textPos && e.line) return { ...n, textPos: add(e.textPos, sub(q, e.line)) };
    return n;
  },
  transform: (e, m) => {
    const k = xfUniform(m);
    if (k === null && e.kind !== "linear" && e.kind !== "aligned" && e.kind !== "ordinate") return null;
    const X = (p?: Vec2) => (p ? xfPt(m, p) : undefined);
    const out: DDimension = { ...e };
    for (const key of ["p1", "p2", "line", "center", "chord", "far", "vertex", "arc", "origin", "textPos"] as const) if (e[key]) out[key] = X(e[key]);
    if (e.l1) out.l1 = [X(e.l1[0])!, X(e.l1[1])!];
    if (e.l2) out.l2 = [X(e.l2[0])!, X(e.l2[1])!];
    if (e.jog) out.jog = { center: X(e.jog.center)!, jog: X(e.jog.jog)! };
    if (e.kind === "linear") {
      const d = xfVec(m, [Math.cos(rad(e.rot ?? 0)), Math.sin(rad(e.rot ?? 0))]);
      out.rot = normDeg(deg(angleOf(d)));
      if (Math.abs(out.rot - 360) < 1e-9) out.rot = 0;
    }
    if (e.kind === "ordinate") {
      // soustava kóty se otáčí s kótou (naměřená hodnota zůstane): osa X kóty → nový směr; násobek 90° = prohození os
      // (X-báze ↔ Y-báze) bez natočení, jinak natočení `hdir` (DXF 51) v rozsahu (−45°, 45°]
      const { ux } = ordinateAxes(e);
      const a = deg(angleOf(xfVec(m, ux)));
      const n = Math.round(a / 90);
      let rem = a - 90 * n;
      if (rem <= -45) rem += 90;
      const swap = Math.abs(Math.round((a - rem) / 90)) % 2 === 1;
      const xAxis = swap ? !e.xAxis : !!e.xAxis;
      if (xAxis) out.xAxis = true;
      else delete out.xAxis;
      if (Math.abs(rem) < 1e-9) delete out.hdir;
      else out.hdir = rem;
    }
    if (e.textRot !== undefined) out.textRot = normDeg(deg(readableAngle(angleOf(xfVec(m, [Math.cos(rad(e.textRot)), Math.sin(rad(e.textRot))])))));
    delete out.measurement;
    return out;
  },
  info: (e, ctx, F) => {
    const g = dimGeom(e, ctx);
    const rows: InfoRow[] = [
      [tr("Druh kóty"), dimKindLabel(e.kind)],
      [tr("Naměřeno"), e.kind === "angular" || e.kind === "angular3" ? F.ang(g.measured) : F.len(g.measured)],
      [tr("Text kóty"), mtextPlain(g.text).join(" ")],
      [tr("Kótovací styl"), resolveDimStyle(ctx.model, e.style, e.overrides).name],
      ...dimPoints(e)
        .filter(([k]) => e[k])
        .map(([k, l]) => [l, F.pt(e[k] as Vec2)] as InfoRow),
    ];
    if (e.overrides && Object.keys(e.overrides).length) rows.push([tr("Přepsané proměnné"), Object.entries(e.overrides).map(([k, v]) => `${k.toUpperCase()}=${v}`).join(" ")]);
    return rows;
  },
  fields: (e, ctx, F) => {
    const g = dimGeom(e, ctx);
    const st = resolveDimStyle(ctx.model, e.style, e.overrides);
    const out: DraftField[] = [
      fld("kind", tr("Druh"), dimKindLabel(e.kind), "text", true),
      fld("measurement", tr("Naměřeno"), e.kind === "angular" || e.kind === "angular3" ? F.ang(g.measured) : F.len(g.measured), "num", true),
      fld("text", tr("Text (<> = naměřená hodnota)"), e.text ?? "", "text"),
      fld("style", tr("Kótovací styl"), st.name, "text"),
      ...(e.kind === "linear" ? [fld("rot", tr("Natočení kótovací čáry"), F.ang(e.rot ?? 0), "angle")] : []),
      ...dimPoints(e).flatMap(([k, l]) => pkey(k, l, e[k] as Vec2 | undefined)),
      fld("textPos", tr("Poloha textu (prázdné = výchozí)"), e.textPos ? ptStr(e.textPos) : "", "pt"),
      fld("textRot", tr("Natočení textu (prázdné = podle čáry)"), e.textRot !== undefined ? F.ang(e.textRot) : "", "angle"),
      fld("dimdec", tr("Desetinná místa"), st.dimdec, "int"),
      fld("dimtxt", tr("Výška textu"), st.dimtxt, "num"),
      fld("dimtol", tr("Tolerance"), st.dimtol ? 1 : 0, "bool"),
      fld("dimtp", tr("Horní úchylka"), st.dimtp, "num"),
      fld("dimtm", tr("Dolní úchylka"), st.dimtm, "num"),
      fld("annotative", tr("Anotativní"), e.annotative ? 1 : 0, "bool"),
    ];
    return out;
  },
  setField: (e, key, raw, ctx) => {
    const t = raw.trim();
    if (key === "text") return { ...e, text: raw };
    if (key === "style") {
      const st = findDimStyle(ctx.model, t);
      if (!st) throw new Error(tr("kótovací styl „{0}“ ve výkresu není – styly: {1}", raw, dimStyles(ctx.model).map((x) => x.name).join(", ")));
      return { ...e, style: st.name };
    }
    if (key === "rot" && e.kind === "linear") return { ...e, rot: angF(raw, tr("Natočení")) };
    if (key === "textPos" || key === "textpos") {
      if (!t || t === "-") {
        const { textPos: _t, ...rest } = e;
        void _t;
        return rest;
      }
      return { ...e, textPos: parsePt2(t) };
    }
    if (key === "textRot" || key === "textrot") {
      if (!t || t === "-") {
        const { textRot: _t, ...rest } = e;
        void _t;
        return rest;
      }
      return { ...e, textRot: angF(t, tr("Natočení textu")) };
    }
    if (key === "annotative") return { ...e, annotative: boolOf(raw) };
    if (key === "xAxis" || key === "xaxis") return { ...e, xAxis: boolOf(raw) };
    if (dimPoints(e).some(([k]) => k === key)) return { ...e, [key]: parsePt2(t) } as DDimension;
    const dv = dimVarDef(key);
    if (dv) {
      const ov = { ...(e.overrides ?? {}) } as Record<string, unknown>;
      if (!t || t === "-" || /^(styl|style|stil)$/i.test(t)) delete ov[dv.key];
      else ov[dv.key] = parseDimVar(dv, t, ctx.model);
      const { overrides: _o, ...rest } = e;
      void _o;
      return Object.keys(ov).length ? { ...rest, overrides: ov } : rest;
    }
    throw unknownKey(key, ["text", "style", "rot", "textPos", "textRot", "annotative", ...dimPoints(e).map(([k]) => String(k)), "dimdec…", ...DIM_VARS.slice(0, 3).map((d) => d.key)]);
  },
  measure: (e, ctx) => ({ length: dimGeom(e, ctx).measured }),
  hitDist: (e, q, ctx) => partsHit(dimGeom(e, ctx).parts, q, ctx),
  explode: (e, ctx) => explodeParts(e, dimGeom(e, ctx).parts),
});

// ---------------------------------------------------------------- ODKAZ

/**
 * Díly odkazu. Anotativní odkaz má velikosti „na papíře“ (šipka, výška textu, zalomení – uložené i výchozí ze stylu)
 * a ve výkrese / výřezu se násobí měřítkem poznámek; neanotativní má uložené velikosti ve výkrese (výchozí × DIMSCALE).
 */
export function leaderParts(e: DLeader, ctx: KindCtx): NewEntity[] {
  return cached(e, ctx.model, () => {
    const st = resolveDimStyle(ctx.model, undefined);
    const anno = isAnnotative(e);
    const k = anno ? annoScaleOf(e, ctx.model) : st.dimscale || 1;
    const asz = anno ? (e.arrowSize ?? st.dimasz) * k : (e.arrowSize ?? st.dimasz * k);
    const th = anno ? (e.textH ?? st.dimtxt) * k : (e.textH ?? st.dimtxt * k);
    const dogleg = anno && e.dogleg ? e.dogleg * k : e.dogleg;
    const out: NewEntity[] = [];
    const pts = e.pts;
    if (pts.length >= 2) {
      if (e.spline && pts.length >= 3) out.push({ type: "spline", ...splineFromFit(pts) } as NewEntity);
      else out.push({ type: "polyline", pts } as NewEntity);
      if (e.arrow !== "_NONE") arrowParts(out, pts[0], sub(pts[1], pts[0]), asz, e.arrow);
    }
    const last = pts[pts.length - 1] ?? [0, 0];
    const side = (e.textPos ?? last)[0] >= (pts[0]?.[0] ?? 0) ? 1 : -1;
    let land = last;
    if (dogleg && dogleg > 0 && pts.length >= 1) {
      land = add(last, [side * dogleg, 0]);
      out.push({ type: "line", a: last, b: land } as NewEntity);
    }
    if (e.text) {
      const p = e.textPos ?? add(land, [side * st.dimgap * k, 0]);
      out.push({ type: "mtext", p, h: th, w: 0, s: e.text, attach: side > 0 ? 4 : 6 } as NewEntity);
    }
    return out;
  });
}
const textPartOf = (parts: NewEntity[]) => parts.find((p) => p.type === "mtext") as DMText | undefined;
/** text odkazu tak, jak se kreslí (bod vložení, výška, připojení 4 / 6) – pro export DWG / DXF (balík 4: MTEXT odkazu) */
export function leaderText(e: DLeader, ctx: KindCtx): { p: Vec2; h: number; attach: number; s: string } | null {
  const t = textPartOf(leaderParts(e, ctx));
  return t ? { p: t.p, h: t.h, attach: t.attach ?? 4, s: t.s } : null;
}

registerKind<"leader">({
  type: "leader",
  label: () => tr("Odkazová čára"),
  curves: (e, ctx) => partsCurves(leaderParts(e, ctx), ctx),
  prims: (e, ctx) => partsPrims(leaderParts(e, ctx), ctx),
  bbox: (e, ctx) => partsBox(leaderParts(e, ctx), ctx),
  snaps: (e, ctx) => [...e.pts.map((p) => ({ kind: "end" as const, p })), ...(textPartOf(leaderParts(e, ctx)) ? [{ kind: "ins" as const, p: textPartOf(leaderParts(e, ctx))!.p }] : [])],
  grips: (e, ctx) => [...e.pts, ...(textPartOf(leaderParts(e, ctx)) ? [textPartOf(leaderParts(e, ctx))!.p] : [])],
  moveGrip: (e, i, q, ctx) => {
    if (i < e.pts.length) {
      const pts = e.pts.map((p, j) => (j === i ? q : p));
      if (i === e.pts.length - 1 && e.textPos) return { ...e, pts, textPos: add(e.textPos, sub(q, e.pts[i])) };
      return { ...e, pts };
    }
    return textPartOf(leaderParts(e, ctx)) ? { ...e, textPos: q } : null;
  },
  transform: (e, m) => {
    const k = xfUniform(m);
    if (k === null && e.spline) return null;
    const s = k ?? 1;
    return { ...e, pts: e.pts.map((p) => xfPt(m, p)), ...(e.textPos ? { textPos: xfPt(m, e.textPos) } : {}), ...(e.textH ? { textH: e.textH * s } : {}), ...(e.arrowSize ? { arrowSize: e.arrowSize * s } : {}), ...(e.dogleg ? { dogleg: e.dogleg * s } : {}) };
  },
  info: (e, _c, F) => [
    [tr("Text"), mtextPlain(e.text ?? "").join(" ⏎ ")],
    [tr("Vrcholy"), String(e.pts.length)],
    [tr("Šipka"), e.arrow === "_NONE" ? tr("bez šipky") : e.arrow || tr("plná uzavřená")],
    ...e.pts.map((p, i) => [`${tr("Vrchol")} ${i + 1}`, F.pt(p)] as InfoRow),
  ],
  fields: (e, ctx, F) => {
    const st = resolveDimStyle(ctx.model, undefined);
    return [
      fld("text", tr("Text (kódy MTEXT)"), e.text ?? "", "text"),
      fld("textH", e.annotative ? tr("Výška textu (na papíře)") : tr("Výška textu"), F.len(e.textH ?? st.dimtxt * (e.annotative ? 1 : st.dimscale || 1)), "num"),
      fld("arrowSize", e.annotative ? tr("Velikost šipky (na papíře)") : tr("Velikost šipky"), F.len(e.arrowSize ?? st.dimasz * (e.annotative ? 1 : st.dimscale || 1)), "num"),
      fld("arrow", tr("Šipka (\"\" plná, _OPEN, _DOT, _NONE…)"), e.arrow ?? "", "text"),
      fld("dogleg", tr("Délka zalomení"), F.len(e.dogleg ?? 0), "num"),
      fld("spline", tr("Spline"), e.spline ? 1 : 0, "bool"),
      fld("annotative", tr("Anotativní"), e.annotative ? 1 : 0, "bool"),
      fld("textPos", tr("Poloha textu (prázdné = u konce)"), e.textPos ? ptStr(e.textPos) : "", "pt"),
      ...(e.pts.length <= 30 ? e.pts.map((p, i) => fld(`v${i + 1}`, `${tr("Vrchol")} ${i + 1}`, ptStr(p), "pt")) : []),
    ];
  },
  setField: (e, key, raw) => {
    const t = raw.trim();
    switch (key) {
      case "text":
        return { ...e, text: raw };
      case "textH":
      case "texth":
        return { ...e, textH: posNum(t, tr("Výška textu")) };
      case "arrowSize":
      case "arrowsize":
        return { ...e, arrowSize: nonNeg(t, tr("Velikost šipky")) };
      case "arrow":
        return { ...e, arrow: t === '""' ? "" : t.toUpperCase() };
      case "dogleg":
        return { ...e, dogleg: nonNeg(t, tr("Délka zalomení")) };
      case "spline":
        return { ...e, spline: boolOf(t) };
      case "annotative":
        return { ...e, annotative: boolOf(t) };
      case "textPos":
      case "textpos": {
        if (!t || t === "-") {
          const { textPos: _t, ...rest } = e;
          void _t;
          return rest;
        }
        return { ...e, textPos: parsePt2(t) };
      }
    }
    const vm = /^v(\d+)$/.exec(key);
    if (vm) {
      const i = Number(vm[1]) - 1;
      if (i < 0 || i >= e.pts.length) throw new Error(tr("vrchol {0} neexistuje (vrcholů {1})", i + 1, e.pts.length));
      return { ...e, pts: e.pts.map((p, j) => (j === i ? parsePt2(t) : p)) };
    }
    throw unknownKey(key, ["text", "textH", "arrowSize", "arrow", "dogleg", "spline", "annotative", "textPos", "v1…vN"]);
  },
  hitDist: (e, q, ctx) => partsHit(leaderParts(e, ctx), q, ctx),
  explode: (e, ctx) => explodeParts(e, leaderParts(e, ctx)),
});

// ---------------------------------------------------------------- ŠRAFA

type HatchCalc = { polys: Vec2[][]; act: number[]; lines: PatLine[] | null; segs: [Vec2, Vec2][]; dense: boolean; box: Box | null };
export function hatchCalc(e: DHatch, ctx: KindCtx): HatchCalc {
  return cached(e, ctx.model, () => {
    const polys = e.loops.map((l) => loopPolygon(l.pts, l.bulges, 2));
    const act = activeLoops(e, polys);
    const k = isAnnotative(e) ? annoScaleOf(e, ctx.model) : 1;
    const lines = hatchLines(e, ctx.model.vars.measurement === 1, k);
    const r = lines ? hatchSegments(e, lines) : { segs: [] as [Vec2, Vec2][], dense: false };
    let box: Box | null = null;
    for (const p of polys) for (const q of p) box = box ? { x0: Math.min(box.x0, q[0]), y0: Math.min(box.y0, q[1]), x1: Math.max(box.x1, q[0]), y1: Math.max(box.y1, q[1]) } : { x0: q[0], y0: q[1], x1: q[0], y1: q[1] };
    return { polys, act, lines, segs: r.segs, dense: r.dense, box };
  });
}
const insideHatch = (hc: HatchCalc, q: Vec2) => hc.act.reduce((n, i) => (inPoly(q, hc.polys[i]) ? n + 1 : n), 0) % 2 === 1;

/** pás polygonu mezi dvěma rovnoběžkami (ořez Sutherland–Hodgman) */
function clipStrip(poly: Vec2[], u: Vec2, t0: number, t1: number): Vec2[] {
  const clip = (pts: Vec2[], keep: (p: Vec2) => number) => {
    const out: Vec2[] = [];
    for (let i = 0; i < pts.length; i++) {
      const a = pts[i];
      const b = pts[(i + 1) % pts.length];
      const da = keep(a);
      const db = keep(b);
      if (da >= 0) out.push(a);
      if (da >= 0 !== db >= 0) {
        const f = da / (da - db);
        out.push([a[0] + (b[0] - a[0]) * f, a[1] + (b[1] - a[1]) * f]);
      }
    }
    return out;
  };
  return clip(clip(poly, (p) => dot(p, u) - t0), (p) => t1 - dot(p, u));
}
function gradientPrims(e: DHatch, hc: HatchCalc): Prim[] {
  const g = e.gradient!;
  const c1 = colorRgb(g.color1) ?? [64, 128, 255];
  const c2 = g.color2 !== undefined ? (colorRgb(g.color2) ?? [255, 255, 255]) : ([c1[0] + (255 - c1[0]) * 0.85, c1[1] + (255 - c1[1]) * 0.85, c1[2] + (255 - c1[2]) * 0.85] as [number, number, number]);
  const a = rad(g.angle ?? 0);
  const u: Vec2 = [Math.cos(a), Math.sin(a)];
  const polys = hc.act.map((i) => hc.polys[i]);
  const ts = polys.flat().map((p) => dot(p, u));
  if (!ts.length) return [];
  const t0 = Math.min(...ts);
  const t1 = Math.max(...ts);
  const N = 32;
  const name = g.name.toUpperCase();
  const ents: DraftEntity[] = [];
  for (let i = 0; i < N; i++) {
    const x = (i + 0.5) / N;
    let f = x;
    if (/INVCYL/.test(name)) f = Math.abs(2 * x - 1);
    else if (/CYL/.test(name)) f = 1 - Math.abs(2 * x - 1);
    if (g.shift) f = Math.min(1, Math.max(0, f + g.shift - 0.5 * g.shift));
    const col = rgbToHex([c1[0] + (c2[0] - c1[0]) * f, c1[1] + (c2[1] - c1[1]) * f, c1[2] + (c2[2] - c1[2]) * f]);
    const lo = t0 + ((t1 - t0) * i) / N - 1e-9;
    const hi = t0 + ((t1 - t0) * (i + 1)) / N + 1e-9;
    const loops = polys.map((p) => clipStrip(p, u, lo, hi)).filter((p) => p.length >= 3).map((pts) => ({ pts }));
    if (loops.length) ents.push({ id: `~g${i}`, layer: "0", type: "hatch", pattern: "SOLID", solid: true, scale: 1, angle: 0, loops, color: col } as DraftEntity);
  }
  return ents.length ? [{ k: "sub", entities: ents, xf: IDENT }] : [];
}
const ISL = ["normal", "outer", "ignore"];
export function parseIsland(raw: string): 0 | 1 | 2 {
  const t = raw.trim().toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "");
  if (["0", "normal", "normalni", "n"].includes(t)) return 0;
  if (["1", "outer", "vnejsi", "aussen", "außen", "auss", "o"].includes(t)) return 1;
  if (["2", "ignore", "ignorovat", "ignorieren", "i"].includes(t)) return 2;
  throw new Error(tr("styl ostrovů: normální, vnější, ignorovat (0, 1, 2)"));
}

registerKind<"hatch">({
  type: "hatch",
  label: () => tr("Šrafa"),
  curves: () => [],
  prims: (e, ctx) => {
    const hc = hatchCalc(e, ctx);
    const rings = hc.act.map((i) => hc.polys[i]);
    if (e.gradient) return gradientPrims(e, hc);
    if (e.solid || isSolidName(e.pattern)) return [{ k: "fill", rings }];
    if (hc.dense || !hc.lines) return rings.map((r) => ({ k: "path" as const, segs: [{ k: "P" as const, pts: r.length ? [...r, r[0]] : r }] }));
    return hc.segs.map(([a, b]) => (a[0] === b[0] && a[1] === b[1] ? ({ k: "mark", p: a } as Prim) : ({ k: "path", segs: [{ k: "L", a, b }] } as Prim)));
  },
  bbox: (e, ctx) => hatchCalc(e, ctx).box,
  snaps: () => [],
  grips: (e, ctx) => {
    const b = hatchCalc(e, ctx).box;
    return b ? [[(b.x0 + b.x1) / 2, (b.y0 + b.y1) / 2]] : [];
  },
  moveGrip: (e, _i, q, ctx) => {
    const b = hatchCalc(e, ctx).box;
    if (!b) return null;
    const d = sub(q, [(b.x0 + b.x1) / 2, (b.y0 + b.y1) / 2]);
    return { ...e, loops: e.loops.map((l) => ({ ...l, pts: l.pts.map((p) => add(p, d)) })), ...(e.origin ? { origin: add(e.origin, d) } : {}) };
  },
  transform: (e, m) => {
    const k = xfUniform(m);
    const hasArcs = e.loops.some((l) => l.bulges?.some((b) => Math.abs(b) > 1e-12));
    if (k === null && hasArcs) return null;
    const flip = xfDet(m) < 0;
    const s = k ?? 1;
    const ang = (a: number) => normDeg(deg(angleOf(xfVec(m, [Math.cos(rad(a)), Math.sin(rad(a))]))));
    const ext = e.ext as (DHatch["ext"] & { pat?: PatLine[] }) | undefined;
    const pat = ext?.pat?.map((L) => ({ angle: ang(L.angle), base: xfVec(m, L.base), offset: xfVec(m, L.offset), dashes: L.dashes.map((x) => x * s) }));
    return {
      ...e,
      loops: e.loops.map((l) => ({ ...l, pts: l.pts.map((p) => xfPt(m, p)), ...(l.bulges ? { bulges: flip ? l.bulges.map((b) => -b) : l.bulges } : {}) })),
      scale: (e.scale || 1) * s,
      angle: ang(e.angle ?? 0),
      origin: xfPt(m, e.origin ?? [0, 0]),
      ...(e.gradient ? { gradient: { ...e.gradient, angle: ang(e.gradient.angle ?? 0) } } : {}),
      ...(pat ? { ext: { ...ext, pat } as DHatch["ext"] } : {}),
    };
  },
  info: (e, ctx, F) => [
    [tr("Vzor"), e.gradient ? `${tr("přechod")} ${e.gradient.name}` : e.solid || isSolidName(e.pattern) ? "SOLID" : e.pattern],
    [tr("Měřítko"), String(e.scale)],
    [tr("Úhel"), F.ang(e.angle ?? 0)],
    [tr("Styl ostrovů"), ISL[e.islandStyle ?? 0]],
    [tr("Smyčky"), String(e.loops.length)],
    [tr("Plocha"), F.len(hatchArea(e))],
    ...(e.boundary?.length ? ([[tr("Asociativní hranice"), e.boundary.join(", ")]] as InfoRow[]) : []),
    ...(hatchCalc(e, ctx).dense ? ([[tr("Upozornění"), tr("vzor je pro tuto plochu příliš hustý – zvětšete měřítko")]] as InfoRow[]) : []),
  ],
  fields: (e, _c, F) => [
    fld("pattern", tr("Vzor"), e.solid ? "SOLID" : e.pattern, "text"),
    fld("scale", tr("Měřítko (u _USER rozteč)"), e.scale, "num"),
    fld("angle", tr("Úhel"), F.ang(e.angle ?? 0), "angle"),
    fld("islandStyle", tr("Styl ostrovů (normal, outer, ignore)"), ISL[e.islandStyle ?? 0], "text"),
    fld("double", tr("Dvojitá (křížem)"), e.double ? 1 : 0, "bool"),
    fld("origin", tr("Počátek vzoru"), ptStr(e.origin ?? [0, 0]), "pt"),
    fld("gradient", tr("Přechod (LINEAR, CYLINDER, INVCYLINDER, prázdné = ne)"), e.gradient?.name ?? "", "text"),
    fld("color1", tr("Barva přechodu 1"), e.gradient ? String(e.gradient.color1) : "", "text"),
    fld("color2", tr("Barva přechodu 2"), e.gradient?.color2 !== undefined ? String(e.gradient.color2) : "", "text"),
    fld("annotative", tr("Anotativní"), e.annotative ? 1 : 0, "bool"),
    fld("area", tr("Plocha"), F.len(hatchArea(e)), "num", true),
    fld("loops", tr("Smyčky"), e.loops.length, "int", true),
  ],
  setField: (e, key, raw) => setHatchField(e, key, raw),
  measure: (e) => ({ area: hatchArea(e), closed: true }),
  hitDist: (e, q, ctx) => {
    const hc = hatchCalc(e, ctx);
    let dB = Infinity;
    for (const i of hc.act) {
      const p = hc.polys[i];
      for (let j = 0; j < p.length; j++) dB = Math.min(dB, closestOnSeg(q, p[j], p[(j + 1) % p.length]).d);
    }
    if (!insideHatch(hc, q)) return dB;
    if (e.solid || isSolidName(e.pattern) || e.gradient || hc.dense || !hc.segs.length) return 0;
    let d = dB;
    const n = Math.min(hc.segs.length, 60000);
    for (let i = 0; i < n; i++) d = Math.min(d, closestOnSeg(q, hc.segs[i][0], hc.segs[i][1]).d);
    return d;
  },
  explode: (e, ctx) => {
    const hc = hatchCalc(e, ctx);
    if (e.solid || isSolidName(e.pattern) || e.gradient || !hc.lines || hc.dense) return null;
    return hc.segs.map(([a, b]) => inheritStyle(e, a[0] === b[0] && a[1] === b[1] ? ({ type: "point", p: a } as NewEntity) : ({ type: "line", a, b } as NewEntity)));
  },
});

/** změna vlastnosti šrafy (panel vlastností, `nastavit`, HATCHEDIT) */
export function setHatchField(e: DHatch, key: string, raw: string): DHatch {
  const t = raw.trim();
  switch (key) {
    case "pattern": {
      const n = t.toUpperCase();
      if (isSolidName(n)) {
        const { gradient: _g, ...rest } = e;
        void _g;
        return { ...rest, pattern: "SOLID", solid: true };
      }
      const { solid: _s, gradient: _g, ...rest } = e;
      void _s;
      void _g;
      return { ...rest, pattern: n === "USER" ? "_USER" : n };
    }
    case "scale":
      return { ...e, scale: posNum(t, tr("Měřítko")) };
    case "angle":
      return { ...e, angle: angF(t, tr("Úhel")) };
    case "islandStyle":
    case "islandstyle":
    case "island":
      return { ...e, islandStyle: parseIsland(t) };
    case "double":
      return { ...e, double: boolOf(t) };
    case "origin":
      return { ...e, origin: parsePt2(t) };
    case "annotative":
      return { ...e, annotative: boolOf(t) };
    case "solid":
      return boolOf(t) ? setHatchField(e, "pattern", "SOLID") : { ...e, solid: false, pattern: isSolidName(e.pattern) ? "ANSI31" : e.pattern };
    case "gradient": {
      if (!t || t === "-" || /^(ne|no|nein|off)$/i.test(t)) {
        const { gradient: _g, ...rest } = e;
        void _g;
        return rest;
      }
      return { ...e, gradient: { name: t.toUpperCase(), color1: e.gradient?.color1 ?? 5, ...(e.gradient?.color2 !== undefined ? { color2: e.gradient.color2 } : {}), ...(e.gradient?.angle ? { angle: e.gradient.angle } : {}) } };
    }
    case "color1":
    case "color2": {
      const c = /^#|^\d+$/.test(t) ? (t.startsWith("#") ? t : Number(t)) : null;
      if (c === null) throw new Error(tr("barva přechodu: číslo ACI nebo #rrggbb"));
      const g = e.gradient ?? { name: "LINEAR", color1: 5 };
      return { ...e, gradient: { ...g, [key]: c } };
    }
  }
  throw unknownKey(key, ["pattern", "scale", "angle", "islandStyle", "double", "origin", "gradient", "color1", "color2", "solid", "annotative"]);
}

// ---------------------------------------------------------------- TOLERANCE

const tolK = (e: DTolerance, ctx: KindCtx) => (isAnnotative(e) ? annoScaleOf(e, ctx.model) : 1);
const tolGeo = (e: DTolerance, ctx: KindCtx) => cached(e, ctx.model, () => toleranceParts(e, ctx, tolK(e, ctx)));

registerKind<"tolerance">({
  type: "tolerance",
  label: () => tr("Geometrická tolerance"),
  curves: (e, ctx) => partsCurves(tolGeo(e, ctx).parts, ctx),
  prims: (e, ctx) => partsPrims(tolGeo(e, ctx).parts, ctx),
  bbox: (e, ctx) => tolGeo(e, ctx).box ?? { x0: e.p[0], y0: e.p[1], x1: e.p[0], y1: e.p[1] },
  snaps: (e) => [{ kind: "ins", p: e.p }],
  grips: (e) => [e.p],
  moveGrip: (e, _i, q) => ({ ...e, p: q }),
  transform: (e, m, ctx) => {
    const k = xfUniform(m);
    if (k === null) return null;
    if (xfDet(m) > 0) return { ...e, p: xfPt(m, e.p), h: e.h * k, rot: normDeg((e.rot ?? 0) + deg(xfAngle(m))) };
    const a = rad(e.rot ?? 0);
    const dir: Vec2 = [Math.cos(a), Math.sin(a)];
    const { dir: d2, flip } = mirrorReadable(m, dir);
    const c = tolGeo(e, ctx).corners;
    const W = c.length >= 2 ? dist(c[0], c[1]) : 0;
    const p = flip ? xfPt(m, add(e.p, mul(dir, W))) : xfPt(m, e.p);
    return { ...e, p, h: e.h * k, rot: normDeg(deg(angleOf(d2))) };
  },
  info: (e, _c, F) => [
    [tr("Tolerance"), tolerancePlain(e.s)],
    [tr("Řetězec DXF"), e.s],
    [tr("Bod vložení"), F.pt(e.p)],
    [tr("Výška"), F.len(e.h)],
  ],
  fields: (e, ctx, F) => [
    fld("s", tr("Řetězec (DXF: %%v buňky, {\\Fgdt;j} značky)"), e.s, "text"),
    fld("plain", tr("Čitelně"), tolerancePlain(e.s), "text", true),
    fld("p", tr("Bod vložení"), ptStr(e.p), "pt"),
    fld("h", tr("Výška textu"), F.len(e.h), "num"),
    fld("rot", tr("Natočení"), F.ang(e.rot ?? 0), "angle"),
    fld("style", tr("Styl"), e.style ?? ctx.model.vars.textstyle, "text"),
    fld("annotative", tr("Anotativní"), e.annotative ? 1 : 0, "bool"),
  ],
  setField: (e, key, raw, ctx) => {
    if (key === "s") return { ...e, s: raw };
    if (key === "p") return { ...e, p: parsePt2(raw) };
    if (key === "h") return { ...e, h: posNum(raw, tr("Výška")) };
    if (key === "rot") return { ...e, rot: angF(raw, tr("Natočení")) };
    if (key === "annotative") return { ...e, annotative: boolOf(raw) };
    if (key === "style") {
      const st = ctx.model.textStyles.find((x) => x.name.toLowerCase() === raw.trim().toLowerCase());
      if (!st) throw new Error(tr("textový styl „{0}“ ve výkresu není – styly: {1}", raw, ctx.model.textStyles.map((x) => x.name).join(", ")));
      return { ...e, style: st.name };
    }
    throw unknownKey(key, ["s", "p", "h", "rot", "style", "annotative"]);
  },
  hitDist: (e, q, ctx) => {
    const c = tolGeo(e, ctx).corners;
    let d = Infinity;
    for (let i = 0; i + 3 < c.length; i += 4) d = Math.min(d, boxDist(c.slice(i, i + 4), q));
    return d;
  },
  explode: (e, ctx) => explodeParts(e, tolGeo(e, ctx).parts),
});

// ---------------------------------------------------------------- ZNAČKA DRSNOSTI

const SURF_KINDS = ["basic", "removal", "noremoval"] as const;
export function parseSurfKind(raw: string): DSurfSym["kind"] {
  const t = raw.trim().toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "");
  if (["basic", "zakladni", "libovolna", "any", "grund", "0"].includes(t)) return "basic";
  if (["removal", "s-ubirem", "ubirani", "ubirem", "obrabeni", "abtrag", "spanend", "1"].includes(t)) return "removal";
  if (["noremoval", "bez-ubirani", "bez-ubiru", "bez", "ohne", "ohneabtrag", "2"].includes(t)) return "noremoval";
  throw new Error(tr("druh značky: základní, s-úběrem, bez-úběru (basic, removal, noremoval)"));
}
const surfGeo = (e: DSurfSym, ctx: KindCtx) => cached(e, ctx.model, () => surfaceParts(e, ctx, isAnnotative(e) ? annoScaleOf(e, ctx.model) : 1));

registerKind<"surfsym">({
  type: "surfsym",
  label: () => tr("Značka drsnosti"),
  curves: (e, ctx) => partsCurves(surfGeo(e, ctx).parts, ctx),
  prims: (e, ctx) => partsPrims(surfGeo(e, ctx).parts, ctx),
  bbox: (e, ctx) => cornersBox(surfGeo(e, ctx).corners),
  snaps: (e) => [{ kind: "ins", p: e.p }],
  grips: (e) => [e.p],
  moveGrip: (e, _i, q) => ({ ...e, p: q }),
  transform: (e, m) => {
    const k = xfUniform(m);
    if (k === null) return null;
    const a = rad(e.rot ?? 0);
    const up = xfVec(m, [-Math.sin(a), Math.cos(a)]);
    return { ...e, p: xfPt(m, e.p), h: e.h * k, rot: normDeg(deg(angleOf(up)) - 90) };
  },
  info: (e, _c, F) => [
    [tr("Druh"), e.kind ?? "basic"],
    [tr("Požadavek"), e.text ?? ""],
    [tr("Výrobní postup"), e.process ?? ""],
    [tr("Bod"), F.pt(e.p)],
    [tr("Natočení"), F.ang(e.rot ?? 0)],
  ],
  fields: (e, _c, F) => [
    fld("kind", tr("Druh (basic, removal, noremoval)"), e.kind ?? "basic", "text"),
    fld("text", tr("Požadavek (např. Ra 1,6)"), e.text ?? "", "text"),
    fld("process", tr("Výrobní postup"), e.process ?? "", "text"),
    fld("lay", tr("Směr stop (=, ⊥, X, M, C, R, P)"), e.lay ?? "", "text"),
    fld("allAround", tr("Kolem dokola"), e.allAround ? 1 : 0, "bool"),
    fld("p", tr("Bod"), ptStr(e.p), "pt"),
    fld("h", tr("Výška písma"), F.len(e.h), "num"),
    fld("rot", tr("Natočení"), F.ang(e.rot ?? 0), "angle"),
    fld("annotative", tr("Anotativní"), e.annotative ? 1 : 0, "bool"),
  ],
  setField: (e, key, raw) => {
    const t = raw.trim();
    switch (key) {
      case "kind":
        return { ...e, kind: parseSurfKind(t) };
      case "text":
        return { ...e, text: raw };
      case "process":
        return { ...e, process: raw };
      case "lay":
        return { ...e, lay: t };
      case "allAround":
      case "allaround":
        return { ...e, allAround: boolOf(t) };
      case "p":
        return { ...e, p: parsePt2(t) };
      case "h":
        return { ...e, h: posNum(t, tr("Výška")) };
      case "rot":
        return { ...e, rot: angF(t, tr("Natočení")) };
      case "annotative":
        return { ...e, annotative: boolOf(t) };
    }
    throw unknownKey(key, ["kind", "text", "process", "lay", "allAround", "p", "h", "rot", "annotative"]);
  },
  hitDist: (e, q, ctx) => partsHit(surfGeo(e, ctx).parts, q, ctx),
  explode: (e, ctx) => explodeParts(e, surfGeo(e, ctx).parts),
});
export { SURF_KINDS };
