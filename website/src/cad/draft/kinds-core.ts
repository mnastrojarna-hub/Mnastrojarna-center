/**
 * Druhy entit jádra 2D výkresu: bod, úsečka, přímka, polopřímka, křivka (s oblouky a šířkami), kružnice, oblouk,
 * elipsa / eliptický oblouk, spline a jednořádkový text. Registrují se při načtení modulu.
 */
import { tr } from "../i18n";
import { cBox, cLength, cPoint, cTransform, ellipseAxes, interpolateFit, type Curve } from "./curves";
import { add, angleOf, arc3, arcBox, boxAdd, boxOf, bulgeArc, bulgeOf, deg, dist, dot, emptyBox, len, mid, mul, normA, onSweep, polar, polyArea, rad, rot90, sub, TAU, unit, xfAngle, xfDet, xfPt, xfUniform, xfVec, type Affine } from "./geom";
import { alignText, curvesBox, registerKind, textWidth1, type DraftField, type Fmt, type InfoRow, type KindCtx, type Seg, type SnapPt } from "./kinds";
import type { DArc, DEllipse, DPolyline, DRay, DSpline, DText, DXLine, DraftEntity, TextHAlign, TextVAlign, Vec2 } from "./model";
import { evalNumber, normDeg } from "./units";

// ---------------------------------------------------------------- pomocné

const num = (raw: string, what: string): number => {
  const v = evalNumber(raw, true);
  if (!Number.isFinite(v)) throw new Error(tr("{0}: očekávám číslo, ne „{1}“", what, raw));
  return v;
};
const pos = (raw: string, what: string): number => {
  const v = num(raw, what);
  if (!(v > 0)) throw new Error(tr("{0} musí být kladné", what));
  return v;
};
export const parsePt = (raw: string, what = tr("bod")): Vec2 => {
  const m = raw.split(/[,;]/);
  if (m.length !== 2) throw new Error(tr("{0}: očekávám souřadnice x,y, ne „{1}“", what, raw));
  return [num(m[0], what), num(m[1], what)];
};
const bool = (raw: string) => /^(1|true|ano|yes|ja|on|zap|ein)$/i.test(raw.trim());
const unknownField = (key: string, keys: string[]) => new Error(tr("neznámá vlastnost „{0}“ – možné: {1}", key, keys.join(", ")));
const f = (key: string, label: string, value: string | number, kind: DraftField["kind"], readonly?: boolean): DraftField => ({ key, label, value, kind, ...(readonly ? { readonly } : {}) });
const arcSweep = (a0: number, a1: number) => {
  const s = normDeg(a1 - a0);
  return s < 1e-12 ? 360 : s;
};

/** úseky křivky jako křivky výpočtu (oblouky vždy proti směru hodin, `rev` = zdroj po směru) */
export function polylineCurves(e: Pick<DPolyline, "pts" | "bulges" | "closed">): Curve[] {
  const out: Curve[] = [];
  const n = e.pts.length;
  const segs = e.closed ? n : n - 1;
  for (let i = 0; i < segs; i++) {
    const a = e.pts[i];
    const b = e.pts[(i + 1) % n];
    const bu = e.bulges?.[i] ?? 0;
    if (Math.abs(bu) < 1e-12 || dist(a, b) < 1e-12) {
      if (dist(a, b) >= 1e-12) out.push({ k: "line", a, b, seg: i });
      continue;
    }
    const arc = bulgeArc(a, b, bu);
    if (arc.sweep > 0) out.push({ k: "arc", c: arc.c, r: arc.r, a0: normA(arc.a0), sweep: arc.sweep, seg: i });
    else out.push({ k: "arc", c: arc.c, r: arc.r, a0: normA(arc.a0 + arc.sweep), sweep: -arc.sweep, rev: true, seg: i });
  }
  return out;
}

function polylineSegs(e: DPolyline): Seg[] {
  const out: Seg[] = [];
  const n = e.pts.length;
  const segs = e.closed ? n : n - 1;
  for (let i = 0; i < segs; i++) {
    const a = e.pts[i];
    const b = e.pts[(i + 1) % n];
    const bu = e.bulges?.[i] ?? 0;
    if (Math.abs(bu) < 1e-12) out.push({ k: "L", a, b });
    else {
      const arc = bulgeArc(a, b, bu);
      out.push({ k: "A", c: arc.c, r: arc.r, a0: arc.a0, a1: arc.a0 + arc.sweep, ccw: arc.sweep > 0 });
    }
  }
  return out;
}

/** obrys širokého úseku (trapez / pás oblouku) */
function wideRing(a: Vec2, b: Vec2, bulge: number, w0: number, w1: number): Vec2[] {
  if (Math.abs(bulge) < 1e-12) {
    const n = unit(rot90(sub(b, a)));
    return [add(a, mul(n, w0 / 2)), add(b, mul(n, w1 / 2)), add(b, mul(n, -w1 / 2)), add(a, mul(n, -w0 / 2))];
  }
  const arc = bulgeArc(a, b, bulge);
  const N = Math.max(8, Math.ceil((Math.abs(arc.sweep) / TAU) * 64));
  const outer: Vec2[] = [];
  const inner: Vec2[] = [];
  for (let i = 0; i <= N; i++) {
    const t = i / N;
    const ang = arc.a0 + arc.sweep * t;
    const w = w0 + (w1 - w0) * t;
    outer.push(polar(arc.c, ang, arc.r + w / 2));
    inner.push(polar(arc.c, ang, Math.max(0, arc.r - w / 2)));
  }
  return [...outer, ...inner.reverse()];
}

/** plocha křivky s oblouky (se znaménkem) */
export function polylineArea(e: Pick<DPolyline, "pts" | "bulges">): number {
  let s = polyArea(e.pts);
  const n = e.pts.length;
  for (let i = 0; i < n; i++) {
    const bu = e.bulges?.[i] ?? 0;
    if (Math.abs(bu) < 1e-12) continue;
    const arc = bulgeArc(e.pts[i], e.pts[(i + 1) % n], bu);
    s += ((arc.r * arc.r) / 2) * (arc.sweep - Math.sin(arc.sweep));
  }
  return s;
}

const curveLen = (cs: Curve[]) => cs.reduce((s, c) => s + cLength(c), 0);
const ptsInfo = (pts: Vec2[], F: Fmt, label: string): InfoRow[] => pts.slice(0, 200).map((p, i) => [`${label} ${i + 1}`, F.pt(p)]);

// ---------------------------------------------------------------- bod

registerKind<"point">({
  type: "point",
  label: () => tr("Bod"),
  curves: () => [],
  prims: (e) => [{ k: "mark", p: e.p }],
  bbox: (e) => ({ x0: e.p[0], y0: e.p[1], x1: e.p[0], y1: e.p[1] }),
  snaps: (e) => [{ kind: "nod", p: e.p }],
  grips: (e) => [e.p],
  moveGrip: (e, _i, p) => ({ ...e, p }),
  transform: (e, m) => ({ ...e, p: xfPt(m, e.p) }),
  info: (e, _c, F) => [[tr("Poloha"), F.pt(e.p)]],
  fields: (e) => [f("p", tr("Poloha"), `${e.p[0]},${e.p[1]}`, "pt")],
  setField: (e, key, raw) => {
    if (key === "p") return { ...e, p: parsePt(raw) };
    throw unknownField(key, ["p"]);
  },
  hitDist: (e, p) => dist(e.p, p),
});

// ---------------------------------------------------------------- úsečka

registerKind<"line">({
  type: "line",
  label: () => tr("Úsečka"),
  curves: (e) => [{ k: "line", a: e.a, b: e.b }],
  prims: (e) => [{ k: "path", segs: [{ k: "L", a: e.a, b: e.b }] }],
  bbox: (e) => boxOf([e.a, e.b]),
  snaps: (e) => [
    { kind: "end", p: e.a },
    { kind: "end", p: e.b },
    { kind: "mid", p: mid(e.a, e.b) },
  ],
  grips: (e) => [e.a, mid(e.a, e.b), e.b],
  moveGrip: (e, i, p) => {
    if (i === 0) return { ...e, a: p };
    if (i === 2) return { ...e, b: p };
    const d = sub(p, mid(e.a, e.b));
    return { ...e, a: add(e.a, d), b: add(e.b, d) };
  },
  transform: (e, m) => ({ ...e, a: xfPt(m, e.a), b: xfPt(m, e.b) }),
  info: (e, _c, F) => [
    [tr("Od bodu"), F.pt(e.a)],
    [tr("Do bodu"), F.pt(e.b)],
    [tr("Délka"), F.len(dist(e.a, e.b))],
    [tr("Úhel"), F.ang(normDeg(deg(angleOf(sub(e.b, e.a)))))],
    [tr("Delta X, Y"), F.pt(sub(e.b, e.a))],
  ],
  fields: (e, _c, F) => [
    f("a", tr("Počátek"), `${e.a[0]},${e.a[1]}`, "pt"),
    f("b", tr("Konec"), `${e.b[0]},${e.b[1]}`, "pt"),
    f("length", tr("Délka"), F.len(dist(e.a, e.b)), "num"),
    f("angle", tr("Úhel"), F.ang(normDeg(deg(angleOf(sub(e.b, e.a))))), "angle"),
  ],
  setField: (e, key, raw) => {
    if (key === "a") return { ...e, a: parsePt(raw) };
    if (key === "b") return { ...e, b: parsePt(raw) };
    if (key === "length") return { ...e, b: polar(e.a, angleOf(sub(e.b, e.a)), pos(raw, tr("Délka"))) };
    if (key === "angle") return { ...e, b: polar(e.a, rad(num(raw.replace("°", ""), tr("Úhel"))), dist(e.a, e.b)) };
    throw unknownField(key, ["a", "b", "length", "angle"]);
  },
  measure: (e) => ({ length: dist(e.a, e.b) }),
});

// ---------------------------------------------------------------- přímka a polopřímka

for (const t of ["xline", "ray"] as const) {
  registerKind<typeof t>({
    type: t,
    label: () => (t === "xline" ? tr("Přímka") : tr("Polopřímka")),
    curves: (e: DXLine | DRay) => [{ k: "line", a: e.p, b: add(e.p, e.dir), inf: t === "xline" ? 2 : 1 }],
    prims: (e: DXLine | DRay) => [{ k: "inf", p: e.p, dir: e.dir, ray: t === "ray" }],
    bbox: () => null,
    snaps: (e: DXLine | DRay) => [{ kind: t === "xline" ? "mid" : "end", p: e.p }],
    grips: (e: DXLine | DRay) => [e.p, add(e.p, e.dir)],
    moveGrip: (e: DXLine | DRay, i: number, p: Vec2) => (i === 0 ? { ...e, p } : dist(p, e.p) > 1e-12 ? { ...e, dir: unit(sub(p, e.p)) } : null),
    transform: (e: DXLine | DRay, m: Affine) => ({ ...e, p: xfPt(m, e.p), dir: unit(xfVec(m, e.dir)) }),
    info: (e: DXLine | DRay, _c: KindCtx, F: Fmt) => [
      [tr("Bod"), F.pt(e.p)],
      [tr("Směr"), F.ang(normDeg(deg(angleOf(e.dir))))],
    ],
    fields: (e: DXLine | DRay, _c: KindCtx, F: Fmt) => [f("p", tr("Bod"), `${e.p[0]},${e.p[1]}`, "pt"), f("angle", tr("Směr"), F.ang(normDeg(deg(angleOf(e.dir)))), "angle")],
    setField: (e: DXLine | DRay, key: string, raw: string) => {
      if (key === "p") return { ...e, p: parsePt(raw) };
      if (key === "angle") {
        const a = rad(num(raw.replace("°", ""), tr("Směr")));
        return { ...e, dir: [Math.cos(a), Math.sin(a)] as Vec2 };
      }
      throw unknownField(key, ["p", "angle"]);
    },
  });
}

// ---------------------------------------------------------------- kružnice

const circleArea = (r: number) => Math.PI * r * r;
registerKind<"circle">({
  type: "circle",
  label: () => tr("Kružnice"),
  curves: (e) => [{ k: "arc", c: e.c, r: e.r, a0: 0, sweep: TAU }],
  prims: (e) => [{ k: "path", segs: [{ k: "A", c: e.c, r: e.r, a0: 0, a1: TAU, ccw: true }], closed: true }],
  bbox: (e) => ({ x0: e.c[0] - e.r, y0: e.c[1] - e.r, x1: e.c[0] + e.r, y1: e.c[1] + e.r }),
  snaps: (e) => [{ kind: "cen", p: e.c }, ...[0, 1, 2, 3].map((k) => ({ kind: "qua" as const, p: polar(e.c, (k * Math.PI) / 2, e.r) }))],
  grips: (e) => [e.c, ...[0, 1, 2, 3].map((k) => polar(e.c, (k * Math.PI) / 2, e.r))],
  moveGrip: (e, i, p) => (i === 0 ? { ...e, c: p } : dist(p, e.c) > 1e-12 ? { ...e, r: dist(p, e.c) } : null),
  transform: (e, m) => {
    const k = xfUniform(m);
    if (k !== null) return { ...e, c: xfPt(m, e.c), r: e.r * k };
    return ellipseFromCurve(e, cTransform({ k: "ell", c: e.c, u: [e.r, 0], v: [0, e.r], t0: 0, t1: TAU }, m) as Extract<Curve, { k: "ell" }>, true);
  },
  info: (e, _c, F) => [
    [tr("Střed"), F.pt(e.c)],
    [tr("Poloměr"), F.len(e.r)],
    [tr("Průměr"), F.len(2 * e.r)],
    [tr("Obvod"), F.len(TAU * e.r)],
    [tr("Plocha"), F.len(circleArea(e.r))],
  ],
  fields: (e, _c, F) => [
    f("c", tr("Střed"), `${e.c[0]},${e.c[1]}`, "pt"),
    f("r", tr("Poloměr"), F.len(e.r), "num"),
    f("d", tr("Průměr"), F.len(2 * e.r), "num"),
    f("circumference", tr("Obvod"), F.len(TAU * e.r), "num"),
    f("area", tr("Plocha"), F.len(circleArea(e.r)), "num"),
  ],
  setField: (e, key, raw) => {
    if (key === "c") return { ...e, c: parsePt(raw) };
    if (key === "r") return { ...e, r: pos(raw, tr("Poloměr")) };
    if (key === "d") return { ...e, r: pos(raw, tr("Průměr")) / 2 };
    if (key === "circumference") return { ...e, r: pos(raw, tr("Obvod")) / TAU };
    if (key === "area") return { ...e, r: Math.sqrt(pos(raw, tr("Plocha")) / Math.PI) };
    throw unknownField(key, ["c", "r", "d", "circumference", "area"]);
  },
  measure: (e) => ({ length: TAU * e.r, area: circleArea(e.r), closed: true }),
});

// ---------------------------------------------------------------- oblouk

const arcCurve = (e: DArc): Extract<Curve, { k: "arc" }> => ({ k: "arc", c: e.c, r: e.r, a0: normA(rad(e.a0)), sweep: rad(arcSweep(e.a0, e.a1)) });
const arcEnds = (e: DArc): [Vec2, Vec2, Vec2] => {
  const c = arcCurve(e);
  return [cPoint(c, 0), cPoint(c, c.sweep / 2), cPoint(c, c.sweep)];
};
/** oblouk entity ze tří bodů (zachová ostatní vlastnosti) */
function arcThrough(e: DArc, a: Vec2, m: Vec2, b: Vec2): DArc | null {
  const r = arc3(a, m, b);
  if (!r) return null;
  return { ...e, c: r.c, r: r.r, a0: normDeg(deg(r.a0)), a1: normDeg(deg(r.a0 + r.sweep)) };
}
registerKind<"arc">({
  type: "arc",
  label: () => tr("Oblouk"),
  curves: (e) => [arcCurve(e)],
  prims: (e) => {
    const c = arcCurve(e);
    return [{ k: "path", segs: [{ k: "A", c: e.c, r: e.r, a0: c.a0, a1: c.a0 + c.sweep, ccw: true }] }];
  },
  bbox: (e) => {
    const c = arcCurve(e);
    return arcBox(e.c, e.r, c.a0, c.sweep);
  },
  snaps: (e) => {
    const c = arcCurve(e);
    const [s, m, t] = arcEnds(e);
    const q: SnapPt[] = [];
    for (let k = 0; k < 4; k++) if (onSweep((k * Math.PI) / 2, c.a0, c.sweep)) q.push({ kind: "qua", p: polar(e.c, (k * Math.PI) / 2, e.r) });
    return [{ kind: "end", p: s }, { kind: "end", p: t }, { kind: "mid", p: m }, { kind: "cen", p: e.c }, ...q];
  },
  grips: (e) => [...arcEnds(e), e.c],
  moveGrip: (e, i, p) => {
    const [s, m, t] = arcEnds(e);
    if (i === 3) return { ...e, c: p };
    return i === 0 ? arcThrough(e, p, m, t) : i === 1 ? arcThrough(e, s, p, t) : arcThrough(e, s, m, p);
  },
  transform: (e, m) => {
    const k = xfUniform(m);
    if (k === null) {
      const c = arcCurve(e);
      return ellipseFromCurve(e, cTransform({ k: "ell", c: e.c, u: [e.r, 0], v: [0, e.r], t0: c.a0, t1: c.a0 + c.sweep }, m) as Extract<Curve, { k: "ell" }>, false);
    }
    const cc = xfPt(m, e.c);
    const [s, , t] = arcEnds(e);
    const s2 = xfPt(m, s);
    const t2 = xfPt(m, t);
    const a0 = normDeg(deg(angleOf(sub(s2, cc))));
    const a1 = normDeg(deg(angleOf(sub(t2, cc))));
    return xfDet(m) > 0 ? { ...e, c: cc, r: e.r * k, a0, a1 } : { ...e, c: cc, r: e.r * k, a0: a1, a1: a0 };
  },
  info: (e, _c, F) => {
    const sw = arcSweep(e.a0, e.a1);
    return [
      [tr("Střed"), F.pt(e.c)],
      [tr("Poloměr"), F.len(e.r)],
      [tr("Počáteční úhel"), F.ang(e.a0)],
      [tr("Koncový úhel"), F.ang(e.a1)],
      [tr("Celkový úhel"), F.ang(sw)],
      [tr("Délka oblouku"), F.len(rad(sw) * e.r)],
    ];
  },
  fields: (e, _c, F) => {
    const sw = arcSweep(e.a0, e.a1);
    return [
      f("c", tr("Střed"), `${e.c[0]},${e.c[1]}`, "pt"),
      f("r", tr("Poloměr"), F.len(e.r), "num"),
      f("a0", tr("Počáteční úhel"), F.ang(e.a0), "angle"),
      f("a1", tr("Koncový úhel"), F.ang(e.a1), "angle"),
      f("sweep", tr("Celkový úhel"), F.ang(sw), "angle", true),
      f("length", tr("Délka oblouku"), F.len(rad(sw) * e.r), "num", true),
    ];
  },
  setField: (e, key, raw) => {
    if (key === "c") return { ...e, c: parsePt(raw) };
    if (key === "r") return { ...e, r: pos(raw, tr("Poloměr")) };
    if (key === "a0") return { ...e, a0: normDeg(num(raw.replace("°", ""), tr("Počáteční úhel"))) };
    if (key === "a1") return { ...e, a1: normDeg(num(raw.replace("°", ""), tr("Koncový úhel"))) };
    throw unknownField(key, ["c", "r", "a0", "a1"]);
  },
  measure: (e) => ({ length: rad(arcSweep(e.a0, e.a1)) * e.r }),
});

// ---------------------------------------------------------------- elipsa

const ellCurve = (e: DEllipse): Extract<Curve, { k: "ell" }> => {
  const t0 = rad(e.t0 ?? 0);
  let t1 = rad(e.t1 ?? 360);
  if (e.t0 === undefined && e.t1 === undefined) t1 = t0 + TAU;
  else {
    const sw = normA(t1 - t0);
    t1 = t0 + (sw < 1e-12 ? TAU : sw);
  }
  return { k: "ell", c: e.c, u: e.major, v: mul(rot90(e.major), e.ratio), t0, t1 };
};
const isFullEll = (e: DEllipse) => (e.t0 === undefined && e.t1 === undefined) || Math.abs(arcSweep(e.t0 ?? 0, e.t1 ?? 360) - 360) < 1e-9;

/** entita elipsy z transformované parametrické elipsy (osy, poměr, posun parametru, zrcadlení) */
function ellipseFromCurve(src: DraftEntity, c: Extract<Curve, { k: "ell" }>, full: boolean): DEllipse {
  const ax = ellipseAxes(c.u, c.v);
  const base = { id: src.id, layer: src.layer, ...(src.color !== undefined ? { color: src.color } : {}), ...(src.linetype ? { linetype: src.linetype } : {}), ...(src.lineweight !== undefined ? { lineweight: src.lineweight } : {}), ...(src.ltscale ? { ltscale: src.ltscale } : {}), ...(src.ext ? { ext: src.ext } : {}) };
  if (full) return { ...base, type: "ellipse", c: c.c, major: ax.major, ratio: ax.ratio };
  // parametr s = t − shift; při zrcadlení σ = −s (rozsah se obrátí)
  let s0 = c.t0 - ax.shift;
  let s1 = c.t1 - ax.shift;
  if (ax.flip) [s0, s1] = [-s1, -s0];
  return { ...base, type: "ellipse", c: c.c, major: ax.major, ratio: ax.ratio, t0: normDeg(deg(s0)), t1: normDeg(deg(s1)) };
}

registerKind<"ellipse">({
  type: "ellipse",
  label: () => tr("Elipsa"),
  curves: (e) => [ellCurve(e)],
  prims: (e) => {
    const c = ellCurve(e);
    const rx = len(e.major);
    return [{ k: "path", segs: [{ k: "E", c: e.c, rx, ry: rx * e.ratio, rot: angleOf(e.major), t0: c.t0, t1: c.t1, ccw: true }], closed: isFullEll(e) }];
  },
  bbox: (e) => cBox(ellCurve(e)),
  snaps: (e) => {
    const c = ellCurve(e);
    const out: SnapPt[] = [{ kind: "cen", p: e.c }];
    for (let k = 0; k < 4; k++) {
      const t = (k * Math.PI) / 2;
      if (isFullEll(e) || normA(t - c.t0) <= c.t1 - c.t0 + 1e-12) out.push({ kind: "qua", p: cPoint(c, t) });
    }
    if (!isFullEll(e)) out.push({ kind: "end", p: cPoint(c, c.t0) }, { kind: "end", p: cPoint(c, c.t1) }, { kind: "mid", p: cPoint(c, (c.t0 + c.t1) / 2) });
    return out;
  },
  grips: (e) => {
    const c = ellCurve(e);
    return [e.c, cPoint(c, 0), cPoint(c, Math.PI / 2), cPoint(c, Math.PI), cPoint(c, (3 * Math.PI) / 2)];
  },
  moveGrip: (e, i, p) => {
    if (i === 0) return { ...e, c: p };
    const d = sub(p, e.c);
    if (len(d) < 1e-12) return null;
    if (i === 1 || i === 3) {
      const minor = len(e.major) * e.ratio;
      const major = i === 1 ? d : mul(d, -1);
      const L = len(major);
      return L >= minor ? { ...e, major, ratio: minor / L } : { ...e, major: mul(unit(rot90(major)), minor), ratio: L / minor };
    }
    const L = len(e.major);
    const r = Math.abs(dot(d, unit(rot90(e.major))));
    return r <= L ? { ...e, ratio: r / L } : { ...e, major: mul(unit(rot90(e.major)), r), ratio: L / r };
  },
  transform: (e, m) => ellipseFromCurve(e, cTransform(ellCurve(e), m) as Extract<Curve, { k: "ell" }>, isFullEll(e)),
  info: (e, _c, F) => {
    const a = len(e.major);
    const rows: InfoRow[] = [
      [tr("Střed"), F.pt(e.c)],
      [tr("Hlavní poloosa"), F.len(a)],
      [tr("Vedlejší poloosa"), F.len(a * e.ratio)],
      [tr("Natočení"), F.ang(normDeg(deg(angleOf(e.major))))],
      [tr("Poměr os"), String(Math.round(e.ratio * 1e6) / 1e6)],
    ];
    if (!isFullEll(e)) rows.push([tr("Počáteční parametr"), F.ang(e.t0 ?? 0)], [tr("Koncový parametr"), F.ang(e.t1 ?? 360)]);
    rows.push([tr("Délka"), F.len(cLength(ellCurve(e)))]);
    if (isFullEll(e)) rows.push([tr("Plocha"), F.len(Math.PI * a * a * e.ratio)]);
    return rows;
  },
  fields: (e, _c, F) => [
    f("c", tr("Střed"), `${e.c[0]},${e.c[1]}`, "pt"),
    f("a", tr("Hlavní poloosa"), F.len(len(e.major)), "num"),
    f("b", tr("Vedlejší poloosa"), F.len(len(e.major) * e.ratio), "num"),
    f("rot", tr("Natočení"), F.ang(normDeg(deg(angleOf(e.major)))), "angle"),
    f("t0", tr("Počáteční parametr"), F.ang(e.t0 ?? 0), "angle"),
    f("t1", tr("Koncový parametr"), F.ang(e.t1 ?? 360), "angle"),
  ],
  setField: (e, key, raw) => {
    if (key === "c") return { ...e, c: parsePt(raw) };
    const a = len(e.major);
    if (key === "a") {
      const na = pos(raw, tr("Hlavní poloosa"));
      const b = a * e.ratio;
      if (na < b) throw new Error(tr("hlavní poloosa musí být delší než vedlejší ({0})", b));
      return { ...e, major: mul(unit(e.major), na), ratio: b / na };
    }
    if (key === "b") {
      const nb = pos(raw, tr("Vedlejší poloosa"));
      if (nb > a) throw new Error(tr("vedlejší poloosa nesmí být delší než hlavní ({0})", a));
      return { ...e, ratio: nb / a };
    }
    if (key === "rot") {
      const r = rad(num(raw.replace("°", ""), tr("Natočení")));
      return { ...e, major: [a * Math.cos(r), a * Math.sin(r)] };
    }
    if (key === "t0") return { ...e, t0: normDeg(num(raw.replace("°", ""), tr("Počáteční parametr"))), t1: e.t1 ?? 360 };
    if (key === "t1") return { ...e, t1: normDeg(num(raw.replace("°", ""), tr("Koncový parametr"))), t0: e.t0 ?? 0 };
    throw unknownField(key, ["c", "a", "b", "rot", "t0", "t1"]);
  },
  measure: (e) => ({ length: cLength(ellCurve(e)), ...(isFullEll(e) ? { area: Math.PI * len(e.major) ** 2 * e.ratio, closed: true } : {}) }),
});

// ---------------------------------------------------------------- spline

const splCurve = (e: DSpline): Extract<Curve, { k: "nurbs" }> => ({ k: "nurbs", deg: e.degree, ctrl: e.ctrl, knots: e.knots, ...(e.weights ? { w: e.weights } : {}) });
/** spline z bodů proložení (kubický, délka tětiv) */
export function splineFromFit(fit: Vec2[], closed = false): Pick<DSpline, "degree" | "ctrl" | "knots" | "fit" | "closed"> {
  const r = interpolateFit(fit, { closed });
  return { degree: r.degree, ctrl: r.ctrl, knots: r.knots, fit, ...(closed ? { closed: true } : {}) };
}
registerKind<"spline">({
  type: "spline",
  label: () => tr("Spline"),
  curves: (e) => [splCurve(e)],
  prims: (e) => {
    const c = splCurve(e);
    const N = Math.min(4000, Math.max(32, (e.ctrl.length - e.degree) * 24));
    const [t0, t1] = [e.knots[e.degree], e.knots[e.ctrl.length]];
    const pts: Vec2[] = [];
    for (let i = 0; i <= N; i++) pts.push(cPoint(c, t0 + ((t1 - t0) * i) / N));
    return [{ k: "path", segs: [{ k: "P", pts }], closed: !!e.closed }];
  },
  bbox: (e) => {
    const b = emptyBox();
    const c = splCurve(e);
    const [t0, t1] = [e.knots[e.degree], e.knots[e.ctrl.length]];
    for (let i = 0; i <= 256; i++) boxAdd(b, cPoint(c, t0 + ((t1 - t0) * i) / 256));
    return b;
  },
  snaps: (e) => {
    const c = splCurve(e);
    const [t0, t1] = [e.knots[e.degree], e.knots[e.ctrl.length]];
    const s = cPoint(c, t0);
    const t = cPoint(c, t1);
    return e.closed || dist(s, t) < 1e-9 ? [] : [{ kind: "end" as const, p: s }, { kind: "end" as const, p: t }];
  },
  grips: (e) => (e.fit?.length ? e.fit : e.ctrl),
  moveGrip: (e, i, p) => {
    if (e.fit?.length) {
      const fit = e.fit.map((q, k) => (k === i ? p : q));
      return { ...e, ...splineFromFit(fit, !!e.closed) };
    }
    const { fit: _drop, ...rest } = e;
    void _drop;
    return { ...rest, ctrl: e.ctrl.map((q, k) => (k === i ? p : q)) };
  },
  transform: (e, m) => ({ ...e, ctrl: e.ctrl.map((p) => xfPt(m, p)), ...(e.fit ? { fit: e.fit.map((p) => xfPt(m, p)) } : {}) }),
  info: (e, _c, F) => [
    [tr("Stupeň"), String(e.degree)],
    [tr("Řídicí body"), String(e.ctrl.length)],
    ...(e.fit?.length ? ([[tr("Body proložení"), String(e.fit.length)]] as InfoRow[]) : []),
    [tr("Uzavřená"), e.closed ? tr("ano") : tr("ne")],
    [tr("Délka"), F.len(cLength(splCurve(e)))],
    ...ptsInfo(e.fit?.length ? e.fit : e.ctrl, F, e.fit?.length ? tr("Bod proložení") : tr("Řídicí bod")),
  ],
  fields: (e, _c, F) => [
    f("degree", tr("Stupeň"), e.degree, "int", true),
    f("count", e.fit?.length ? tr("Body proložení") : tr("Řídicí body"), (e.fit ?? e.ctrl).length, "int", true),
    f("closed", tr("Uzavřená"), e.closed ? 1 : 0, "bool", true),
    f("length", tr("Délka"), F.len(cLength(splCurve(e))), "num", true),
  ],
  setField: (e, key) => {
    throw unknownField(key, []);
  },
  measure: (e) => {
    const c = splCurve(e);
    const L = cLength(c);
    if (!e.closed) return { length: L };
    const [t0, t1] = [e.knots[e.degree], e.knots[e.ctrl.length]];
    const pts: Vec2[] = [];
    for (let i = 0; i < 512; i++) pts.push(cPoint(c, t0 + ((t1 - t0) * i) / 512));
    return { length: L, area: Math.abs(polyArea(pts)), closed: true };
  },
});

// ---------------------------------------------------------------- křivka

registerKind<"polyline">({
  type: "polyline",
  label: () => tr("Křivka"),
  curves: (e) => polylineCurves(e),
  prims: (e) => {
    const segs = polylineSegs(e);
    const hasVar = e.widths?.some(([a, b]) => a > 0 || b > 0);
    if (!hasVar) return [{ k: "path", segs, closed: !!e.closed, ...(e.width ? { width: e.width } : {}) }];
    const rings: Vec2[][] = [];
    const n = e.pts.length;
    const cnt = e.closed ? n : n - 1;
    for (let i = 0; i < cnt; i++) {
      const [w0, w1] = e.widths?.[i] ?? [e.width ?? 0, e.width ?? 0];
      if (w0 > 0 || w1 > 0) rings.push(wideRing(e.pts[i], e.pts[(i + 1) % n], e.bulges?.[i] ?? 0, w0, w1));
    }
    return [{ k: "path", segs, closed: !!e.closed }, { k: "fill", rings }];
  },
  bbox: (e) => {
    const b = curvesBox(polylineCurves(e)) ?? boxOf(e.pts);
    const w = Math.max(e.width ?? 0, ...(e.widths ?? []).flat()) / 2;
    return w > 0 ? { x0: b.x0 - w, y0: b.y0 - w, x1: b.x1 + w, y1: b.y1 + w } : b;
  },
  snaps: (e) => {
    const out: SnapPt[] = e.pts.map((p) => ({ kind: "end" as const, p }));
    for (const c of polylineCurves(e)) {
      if (c.k === "line") out.push({ kind: "mid", p: mid(c.a, c.b) });
      else if (c.k === "arc") out.push({ kind: "mid", p: cPoint(c, c.sweep / 2) }, { kind: "cen", p: c.c });
    }
    return out;
  },
  grips: (e) => {
    const g = [...e.pts];
    for (const c of polylineCurves(e)) g.push(c.k === "line" ? mid(c.a, c.b) : cPoint(c, (c as Extract<Curve, { k: "arc" }>).sweep / 2));
    return g;
  },
  moveGrip: (e, i, p) => {
    const n = e.pts.length;
    if (i < n) return { ...e, pts: e.pts.map((q, k) => (k === i ? p : q)) };
    const cs = polylineCurves(e);
    const c = cs[i - n];
    if (!c) return null;
    const s = c.seg ?? 0;
    const a = e.pts[s];
    const b = e.pts[(s + 1) % n];
    if (c.k === "line") {
      const d = sub(p, mid(a, b));
      return { ...e, pts: e.pts.map((q, k) => (k === s || k === (s + 1) % n ? add(q, d) : q)) };
    }
    const r = arc3(a, p, b);
    if (!r) return { ...e, bulges: (e.bulges ?? []).map((x, k) => (k === s ? 0 : x)) };
    // směr: a → p → b
    const ccw = normA(angleOf(sub(p, r.c)) - angleOf(sub(a, r.c))) <= normA(angleOf(sub(b, r.c)) - angleOf(sub(a, r.c)));
    const sweep = ccw ? normA(angleOf(sub(b, r.c)) - angleOf(sub(a, r.c))) : -normA(angleOf(sub(a, r.c)) - angleOf(sub(b, r.c)));
    const bul = Array.from({ length: n }, (_, k) => e.bulges?.[k] ?? 0);
    bul[s] = bulgeOf(sweep);
    return { ...e, bulges: bul };
  },
  transform: (e, m) => {
    const k = xfUniform(m);
    const hasArcs = e.bulges?.some((b) => Math.abs(b) > 1e-12);
    if (k === null && hasArcs) return null;
    const flip = xfDet(m) < 0;
    const s = k ?? 1;
    return {
      ...e,
      pts: e.pts.map((p) => xfPt(m, p)),
      ...(e.bulges ? { bulges: flip ? e.bulges.map((b) => -b) : e.bulges } : {}),
      ...(e.width ? { width: e.width * s } : {}),
      ...(e.widths ? { widths: e.widths.map(([a, b]) => [a * s, b * s] as [number, number]) } : {}),
    };
  },
  info: (e, _c, F) => {
    const rows: InfoRow[] = [
      [tr("Uzavřená"), e.closed ? tr("ano") : tr("ne")],
      [tr("Vrcholy"), String(e.pts.length)],
      [tr("Délka"), F.len(curveLen(polylineCurves(e)))],
    ];
    if (e.closed) rows.push([tr("Plocha"), F.len(Math.abs(polylineArea(e)))]);
    if (e.width) rows.push([tr("Šířka"), F.len(e.width)]);
    return [...rows, ...ptsInfo(e.pts, F, tr("Vrchol"))];
  },
  fields: (e, _c, F) => {
    const out: DraftField[] = [
      f("closed", tr("Uzavřená"), e.closed ? 1 : 0, "bool"),
      f("width", tr("Konstantní šířka"), F.len(e.width ?? 0), "num"),
      f("length", tr("Délka"), F.len(curveLen(polylineCurves(e))), "num", true),
    ];
    if (e.closed) out.push(f("area", tr("Plocha"), F.len(Math.abs(polylineArea(e))), "num", true));
    if (e.pts.length <= 60) e.pts.forEach((p, i) => out.push(f(`v${i + 1}`, `${tr("Vrchol")} ${i + 1}`, `${p[0]},${p[1]}`, "pt")));
    return out;
  },
  setField: (e, key, raw) => {
    if (key === "closed") return { ...e, closed: bool(raw) };
    if (key === "width") {
      const w = num(raw, tr("Šířka"));
      if (w < 0) throw new Error(tr("šířka nesmí být záporná"));
      const { widths: _w, ...rest } = e;
      void _w;
      return w > 0 ? { ...rest, width: w } : { ...rest, width: 0 };
    }
    const vm = /^v(\d+)$/.exec(key);
    if (vm) {
      const i = Number(vm[1]) - 1;
      if (i < 0 || i >= e.pts.length) throw new Error(tr("vrchol {0} neexistuje (vrcholů {1})", i + 1, e.pts.length));
      return { ...e, pts: e.pts.map((p, k) => (k === i ? parsePt(raw) : p)) };
    }
    const bm = /^b(\d+)$/.exec(key);
    if (bm) {
      const i = Number(bm[1]) - 1;
      if (i < 0 || i >= e.pts.length) throw new Error(tr("úsek {0} neexistuje", i + 1));
      const bul = Array.from({ length: e.pts.length }, (_, k) => e.bulges?.[k] ?? 0);
      bul[i] = num(raw, tr("Vydutí"));
      return { ...e, bulges: bul };
    }
    throw unknownField(key, ["closed", "width", "v1…vN", "b1…bN"]);
  },
  measure: (e) => ({ length: curveLen(polylineCurves(e)), ...(e.closed ? { area: Math.abs(polylineArea(e)), closed: true } : {}) }),
});

// ---------------------------------------------------------------- text

/** písmo pro vykreslení podle stylu (SHX a TTF ze zdroje → webové písmo) */
export function textFont(styleFont: string | undefined): string {
  const s = (styleFont ?? "").toLowerCase();
  if (/mono|courier|consol/.test(s)) return "'Roboto Mono', 'Courier New', monospace";
  if (/times|serif|roman(?!s)|romant|romanc/.test(s) && !/sans/.test(s)) return "'Times New Roman', serif";
  return "'Roboto', Arial, sans-serif";
}

type TextFrame = { s: Vec2; dir: Vec2; h: number; w: number; wf: number; font: string };
/** rám textu: levý konec účaří, směr, výška, šířka (po Zarovnat / Přizpůsobit) */
export function textFrame(e: DText, ctx: KindCtx): TextFrame {
  const st = ctx.model.textStyles.find((x) => x.name.toLowerCase() === (e.style ?? ctx.model.vars.textstyle).toLowerCase());
  const font = textFont(st?.font);
  let h = e.h;
  let wf = e.wf ?? st?.wf ?? 1;
  const w1 = textWidth1(e.s, font);
  if ((e.halign === "aligned" || e.halign === "fit") && e.p2 && dist(e.p, e.p2) > 1e-12) {
    const L = dist(e.p, e.p2);
    const dir = unit(sub(e.p2, e.p));
    if (e.halign === "aligned") h = L / Math.max(1e-9, w1 * wf);
    else wf = L / Math.max(1e-9, w1 * h);
    return { s: e.p, dir, h, w: L, wf, font };
  }
  const r = rad(e.rot ?? 0);
  const dir: Vec2 = [Math.cos(r), Math.sin(r)];
  const w = w1 * h * wf;
  const [dx, dy] = alignText(w, h, e.halign, e.valign);
  return { s: add(e.p, add(mul(dir, dx), mul(rot90(dir), dy))), dir, h, w, wf, font };
}
const textCorners = (fr: TextFrame): Vec2[] => {
  const up = mul(rot90(fr.dir), fr.h);
  const down = mul(rot90(fr.dir), -fr.h * 0.25);
  const along = mul(fr.dir, fr.w);
  return [add(fr.s, down), add(add(fr.s, along), down), add(add(fr.s, along), up), add(fr.s, up)];
};
/** text s rámem: z nového levého konce účaří a směru dopočítá bod vložení podle zarovnání */
function textFromFrame(e: DText, s: Vec2, dir: Vec2, h: number, ctx: KindCtx, scale: number): DText {
  const rot = normDeg(deg(angleOf(dir)));
  if ((e.halign === "aligned" || e.halign === "fit") && e.p2) {
    const L = dist(e.p, e.p2) * scale;
    return { ...e, p: s, p2: add(s, mul(dir, L)), h: e.h * scale, rot };
  }
  const fr = textFrame({ ...e, h, rot }, ctx);
  const [dx, dy] = alignText(fr.w, h, e.halign, e.valign);
  const p = sub(s, add(mul(dir, dx), mul(rot90(dir), dy)));
  return { ...e, p, h, rot };
}

registerKind<"text">({
  type: "text",
  label: () => tr("Text"),
  curves: () => [],
  prims: (e, ctx) => {
    const fr = textFrame(e, ctx);
    const st = ctx.model.textStyles.find((x) => x.name.toLowerCase() === (e.style ?? ctx.model.vars.textstyle).toLowerCase());
    return [{ k: "text", p: fr.s, h: fr.h, rot: angleOf(fr.dir), s: e.s, font: fr.font, wf: fr.wf, oblique: rad(e.oblique ?? st?.oblique ?? 0) }];
  },
  bbox: (e, ctx) => boxOf(textCorners(textFrame(e, ctx))),
  snaps: (e) => [{ kind: "ins", p: e.p }, ...(e.p2 ? [{ kind: "ins" as const, p: e.p2 }] : [])],
  grips: (e) => [e.p, ...(e.p2 ? [e.p2] : [])],
  moveGrip: (e, i, p) => (i === 0 ? (e.p2 ? { ...e, p, p2: add(e.p2, sub(p, e.p)) } : { ...e, p }) : { ...e, p2: p }),
  transform: (e, m, ctx) => {
    const k = xfUniform(m);
    if (k === null) return null;
    if (xfDet(m) > 0) return { ...e, p: xfPt(m, e.p), ...(e.p2 ? { p2: xfPt(m, e.p2) } : {}), h: e.h * k, rot: normDeg((e.rot ?? 0) + deg(xfAngle(m))) };
    // zrcadlení: MIRRTEXT = 1 → zrcadlový text (obrácený směr), jinak čitelný text v zrcadleném rámu
    const fr = textFrame(e, ctx);
    const s2 = xfPt(m, fr.s);
    const e2 = xfPt(m, add(fr.s, mul(fr.dir, fr.w)));
    const d2 = unit(xfVec(m, fr.dir));
    const u2 = mul(unit(xfVec(m, rot90(fr.dir))), fr.h * k);
    if (ctx.model.vars.mirrtext === 1) return textFromFrame(e, s2, d2, e.h * k, ctx, k);
    const flipDir = d2[0] < -1e-9 || (Math.abs(d2[0]) <= 1e-9 && d2[1] < 0);
    return flipDir ? textFromFrame(e, e2, mul(d2, -1), e.h * k, ctx, k) : textFromFrame(e, add(s2, u2), d2, e.h * k, ctx, k);
  },
  info: (e, ctx, F) => [
    [tr("Text"), e.s],
    [tr("Bod vložení"), F.pt(e.p)],
    [tr("Výška"), F.len(e.h)],
    [tr("Natočení"), F.ang(e.rot ?? 0)],
    [tr("Styl"), e.style ?? ctx.model.vars.textstyle],
    [tr("Zarovnání"), `${e.halign ?? "left"} / ${e.valign ?? "baseline"}`],
    [tr("Šířkový faktor"), String(e.wf ?? 1)],
  ],
  fields: (e, ctx, F) => [
    f("s", tr("Obsah"), e.s, "text"),
    f("p", tr("Bod vložení"), `${e.p[0]},${e.p[1]}`, "pt"),
    f("h", tr("Výška"), F.len(e.h), "num"),
    f("rot", tr("Natočení"), F.ang(e.rot ?? 0), "angle"),
    f("style", tr("Styl"), e.style ?? ctx.model.vars.textstyle, "text"),
    f("halign", tr("Zarovnání vodorovně"), e.halign ?? "left", "text"),
    f("valign", tr("Zarovnání svisle"), e.valign ?? "baseline", "text"),
    f("wf", tr("Šířkový faktor"), e.wf ?? 1, "num"),
    f("oblique", tr("Sklon"), F.ang(e.oblique ?? 0), "angle"),
  ],
  setField: (e, key, raw, ctx) => {
    if (key === "s") return { ...e, s: raw };
    if (key === "p") return { ...e, p: parsePt(raw) };
    if (key === "h") return { ...e, h: pos(raw, tr("Výška")) };
    if (key === "rot") return { ...e, rot: normDeg(num(raw.replace("°", ""), tr("Natočení"))) };
    if (key === "wf") return { ...e, wf: pos(raw, tr("Šířkový faktor")) };
    if (key === "oblique") {
      const o = num(raw.replace("°", ""), tr("Sklon"));
      if (Math.abs(o) > 85) throw new Error(tr("sklon musí být v rozsahu −85° až 85°"));
      return { ...e, oblique: o };
    }
    if (key === "style") {
      const st = ctx.model.textStyles.find((x) => x.name.toLowerCase() === raw.trim().toLowerCase());
      if (!st) throw new Error(tr("textový styl „{0}“ ve výkresu není – styly: {1}", raw, ctx.model.textStyles.map((x) => x.name).join(", ")));
      return { ...e, style: st.name };
    }
    if (key === "halign") {
      const v = raw.trim().toLowerCase() as TextHAlign;
      if (!["left", "center", "right", "aligned", "middle", "fit"].includes(v)) throw new Error(tr("zarovnání: left, center, right, middle, aligned, fit"));
      return { ...e, halign: v };
    }
    if (key === "valign") {
      const v = raw.trim().toLowerCase() as TextVAlign;
      if (!["baseline", "bottom", "middle", "top"].includes(v)) throw new Error(tr("svislé zarovnání: baseline, bottom, middle, top"));
      return { ...e, valign: v };
    }
    throw unknownField(key, ["s", "p", "h", "rot", "style", "halign", "valign", "wf", "oblique"]);
  },
  hitDist: (e, p, ctx) => {
    const fr = textFrame(e, ctx);
    // vzdálenost od obdélníku textu (uvnitř = 0)
    const loc = sub(p, fr.s);
    const x = dot(loc, fr.dir);
    const y = dot(loc, rot90(fr.dir));
    const dx = x < 0 ? -x : x > fr.w ? x - fr.w : 0;
    const dy = y < -fr.h * 0.25 ? -fr.h * 0.25 - y : y > fr.h ? y - fr.h : 0;
    return Math.hypot(dx, dy);
  },
});

