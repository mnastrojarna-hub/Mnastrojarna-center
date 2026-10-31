/** 2D geometrie skici — čisté funkce bez CAD jádra (testované ve vitestu). */
import type { SketchEntity, Vec2 } from "./types";

export type Seg = { kind: "line"; a: Vec2; b: Vec2 } | { kind: "arc"; a: Vec2; m: Vec2; b: Vec2 };
/** Uzavřený profil: buď smyčka segmentů, nebo analytický tvar (přesnější v jádře). */
export type Loop =
  | { kind: "segs"; segs: Seg[]; sourceIds: string[] }
  | { kind: "circle"; cx: number; cy: number; r: number; sourceIds: string[] };

const EPS = 1e-4;
const near = (p: Vec2, q: Vec2, eps = EPS) => Math.abs(p[0] - q[0]) < eps && Math.abs(p[1] - q[1]) < eps;
const rot = (p: Vec2, c: Vec2, deg: number): Vec2 => {
  const a = (deg * Math.PI) / 180;
  const x = p[0] - c[0];
  const y = p[1] - c[1];
  return [c[0] + x * Math.cos(a) - y * Math.sin(a), c[1] + x * Math.sin(a) + y * Math.cos(a)];
};

/** Střed a poloměr kružnice třemi body (null pro kolineární body). */
export function circleFrom3(a: Vec2, b: Vec2, c: Vec2): { c: Vec2; r: number } | null {
  const d = 2 * (a[0] * (b[1] - c[1]) + b[0] * (c[1] - a[1]) + c[0] * (a[1] - b[1]));
  if (Math.abs(d) < 1e-12) return null;
  const a2 = a[0] ** 2 + a[1] ** 2;
  const b2 = b[0] ** 2 + b[1] ** 2;
  const c2 = c[0] ** 2 + c[1] ** 2;
  const ux = (a2 * (b[1] - c[1]) + b2 * (c[1] - a[1]) + c2 * (a[1] - b[1])) / d;
  const uy = (a2 * (c[0] - b[0]) + b2 * (a[0] - c[0]) + c2 * (b[0] - a[0])) / d;
  return { c: [ux, uy], r: Math.hypot(a[0] - ux, a[1] - uy) };
}

/** Body na oblouku a → m → b (vč. krajních). */
export function arcPoints(a: Vec2, m: Vec2, b: Vec2, n = 24): Vec2[] {
  const cc = circleFrom3(a, m, b);
  if (!cc) return [a, b];
  const ang = (p: Vec2) => Math.atan2(p[1] - cc.c[1], p[0] - cc.c[0]);
  const a0 = ang(a);
  let am = ang(m) - a0;
  let ab = ang(b) - a0;
  const norm = (x: number) => ((x % (2 * Math.PI)) + 2 * Math.PI) % (2 * Math.PI);
  am = norm(am);
  ab = norm(ab);
  const sweep = am < ab ? ab : ab - 2 * Math.PI; // směr přes m
  const pts: Vec2[] = [];
  for (let i = 0; i <= n; i++) {
    const t = a0 + (sweep * i) / n;
    pts.push([cc.c[0] + cc.r * Math.cos(t), cc.c[1] + cc.r * Math.sin(t)]);
  }
  return pts;
}

/** Segmenty uzavřených tvarů (obdélník, mnohoúhelník, drážka). */
export function shapeSegs(e: SketchEntity): Seg[] | null {
  switch (e.type) {
    case "rect": {
      const hw = e.w / 2;
      const hh = e.h / 2;
      const c: Vec2 = [e.cx, e.cy];
      const r = Math.max(0, Math.min(e.r, hw - 1e-6, hh - 1e-6));
      const P = (x: number, y: number) => rot([e.cx + x, e.cy + y], c, e.angle);
      if (r <= 1e-6) {
        const p = [P(-hw, -hh), P(hw, -hh), P(hw, hh), P(-hw, hh)];
        return p.map((a, i) => ({ kind: "line", a, b: p[(i + 1) % 4] }));
      }
      const k = r * (1 - Math.SQRT1_2);
      return [
        { kind: "line", a: P(-hw + r, -hh), b: P(hw - r, -hh) },
        { kind: "arc", a: P(hw - r, -hh), m: P(hw - k, -hh + k), b: P(hw, -hh + r) },
        { kind: "line", a: P(hw, -hh + r), b: P(hw, hh - r) },
        { kind: "arc", a: P(hw, hh - r), m: P(hw - k, hh - k), b: P(hw - r, hh) },
        { kind: "line", a: P(hw - r, hh), b: P(-hw + r, hh) },
        { kind: "arc", a: P(-hw + r, hh), m: P(-hw + k, hh - k), b: P(-hw, hh - r) },
        { kind: "line", a: P(-hw, hh - r), b: P(-hw, -hh + r) },
        { kind: "arc", a: P(-hw, -hh + r), m: P(-hw + k, -hh + k), b: P(-hw + r, -hh) },
      ];
    }
    case "polygon": {
      const n = Math.max(3, Math.round(e.sides));
      const pts: Vec2[] = Array.from({ length: n }, (_, i) => {
        const t = (e.angle * Math.PI) / 180 + (i / n) * Math.PI * 2 + Math.PI / 2;
        return [e.cx + e.r * Math.cos(t), e.cy + e.r * Math.sin(t)];
      });
      return pts.map((a, i) => ({ kind: "line", a, b: pts[(i + 1) % n] }));
    }
    case "slot": {
      const L = Math.max(0, e.length - e.width) / 2;
      const R = e.width / 2;
      const c: Vec2 = [e.cx, e.cy];
      const P = (x: number, y: number) => rot([e.cx + x, e.cy + y], c, e.angle);
      if (L <= 1e-6) return null; // degenerovaná drážka = kružnice (řešeno jinde)
      return [
        { kind: "line", a: P(-L, -R), b: P(L, -R) },
        { kind: "arc", a: P(L, -R), m: P(L + R, 0), b: P(L, R) },
        { kind: "line", a: P(L, R), b: P(-L, R) },
        { kind: "arc", a: P(-L, R), m: P(-L - R, 0), b: P(-L, -R) },
      ];
    }
    case "polyline": {
      if (!e.closed || e.points.length < 3) return null;
      return e.points.map((a, i) => ({ kind: "line", a, b: e.points[(i + 1) % e.points.length] }));
    }
    case "ellipse":
      return arcsThrough(ellipsePoints(e, 48), true);
    case "spline":
      if (e.points.length < 2) return null;
      return arcsThrough(splinePoints(e.points, e.closed, 12), e.closed);
    default:
      return null;
  }
}

/** Body elipsy (n vzorků, bez opakování prvního bodu). */
export function ellipsePoints(e: { cx: number; cy: number; rx: number; ry: number; angle: number }, n = 72): Vec2[] {
  const t = (e.angle * Math.PI) / 180;
  const ct = Math.cos(t);
  const st = Math.sin(t);
  return Array.from({ length: n }, (_, i) => {
    const u = (i / n) * Math.PI * 2;
    const x = Math.abs(e.rx) * Math.cos(u);
    const y = Math.abs(e.ry) * Math.sin(u);
    return [e.cx + x * ct - y * st, e.cy + x * st + y * ct] as Vec2;
  });
}

/** Interpolační spline (centripetální Catmull-Rom) přes body; `perSpan` vzorků na úsek. */
export function splinePoints(pts: Vec2[], closed: boolean, perSpan = 16): Vec2[] {
  const n = pts.length;
  if (n < 2) return [...pts];
  if (n === 2 && !closed) return [pts[0], pts[1]];
  const P = (i: number): Vec2 => {
    if (closed) return pts[((i % n) + n) % n];
    if (i < 0) return [2 * pts[0][0] - pts[1][0], 2 * pts[0][1] - pts[1][1]];
    if (i >= n) return [2 * pts[n - 1][0] - pts[n - 2][0], 2 * pts[n - 1][1] - pts[n - 2][1]];
    return pts[i];
  };
  const out: Vec2[] = [];
  const spans = closed ? n : n - 1;
  for (let i = 0; i < spans; i++) {
    const p0 = P(i - 1), p1 = P(i), p2 = P(i + 1), p3 = P(i + 2);
    const tj = (a: Vec2, b: Vec2) => Math.max(1e-6, Math.sqrt(Math.hypot(b[0] - a[0], b[1] - a[1])));
    const t0 = 0, t1 = t0 + tj(p0, p1), t2 = t1 + tj(p1, p2), t3 = t2 + tj(p2, p3);
    for (let k = 0; k < perSpan; k++) {
      const t = t1 + ((t2 - t1) * k) / perSpan;
      const L = (pa: Vec2, pb: Vec2, ta: number, tb: number): Vec2 => [((tb - t) * pa[0] + (t - ta) * pb[0]) / (tb - ta), ((tb - t) * pa[1] + (t - ta) * pb[1]) / (tb - ta)];
      const A1 = L(p0, p1, t0, t1), A2 = L(p1, p2, t1, t2), A3 = L(p2, p3, t2, t3);
      const B1 = L(A1, A2, t0, t2), B2 = L(A2, A3, t1, t3);
      out.push(L(B1, B2, t1, t2));
    }
  }
  if (!closed) out.push(pts[n - 1]);
  return out;
}

/** Aproximace hladké křivky oblouky přes trojice vzorků (G0, velmi blízko křivce). */
function arcsThrough(pts: Vec2[], closed: boolean): Seg[] {
  const P = closed ? [...pts, pts[0]] : pts;
  if (P.length % 2 === 0) P.splice(P.length - 1, 0, [(P[P.length - 2][0] + P[P.length - 1][0]) / 2, (P[P.length - 2][1] + P[P.length - 1][1]) / 2]);
  const segs: Seg[] = [];
  for (let i = 0; i + 2 < P.length; i += 2) {
    const [a, m, b] = [P[i], P[i + 1], P[i + 2]];
    const cc = circleFrom3(a, m, b);
    if (!cc || cc.r > 1e5 * Math.hypot(b[0] - a[0], b[1] - a[1])) segs.push({ kind: "line", a, b });
    else segs.push({ kind: "arc", a, m, b });
  }
  return segs;
}

/** Najde všechny uzavřené profily ve skice (tvary + smyčky poskládané z úseček/oblouků). */
export function findLoops(entities: SketchEntity[]): { loops: Loop[]; openCount: number } {
  const loops: Loop[] = [];
  const open: { seg: Seg; id: string }[] = [];
  for (const e of entities) {
    if (e.construction || e.type === "point") continue;
    if (e.type === "spline" && !e.closed) {
      (shapeSegs(e) ?? []).forEach((seg) => open.push({ seg, id: e.id }));
      continue;
    }
    if (e.type === "circle") {
      if (e.r > 0) loops.push({ kind: "circle", cx: e.cx, cy: e.cy, r: e.r, sourceIds: [e.id] });
      continue;
    }
    if (e.type === "slot" && e.length <= e.width) {
      loops.push({ kind: "circle", cx: e.cx, cy: e.cy, r: e.width / 2, sourceIds: [e.id] });
      continue;
    }
    const s = shapeSegs(e);
    if (s) {
      loops.push({ kind: "segs", segs: s.filter((x) => !(x.kind === "line" && near(x.a, x.b, 1e-9))), sourceIds: [e.id] });
      continue;
    }
    if (e.type === "line") open.push({ seg: { kind: "line", a: e.a, b: e.b }, id: e.id });
    else if (e.type === "arc") open.push({ seg: { kind: "arc", a: e.a, m: e.b, b: e.c }, id: e.id });
    else if (e.type === "polyline") e.points.slice(1).forEach((p, i) => open.push({ seg: { kind: "line", a: e.points[i], b: p }, id: e.id }));
  }

  // řetězení otevřených segmentů do smyček
  const used = new Array(open.length).fill(false);
  const tol = 1e-3;
  const reverse = (s: Seg): Seg => (s.kind === "line" ? { kind: "line", a: s.b, b: s.a } : { kind: "arc", a: s.b, m: s.m, b: s.a });
  for (let i = 0; i < open.length; i++) {
    if (used[i]) continue;
    const chain: Seg[] = [open[i].seg];
    const ids = [open[i].id];
    used[i] = true;
    let progressed = true;
    while (progressed && !near(chain[0].a, chain[chain.length - 1].b, tol)) {
      progressed = false;
      const end = chain[chain.length - 1].b;
      for (let j = 0; j < open.length; j++) {
        if (used[j]) continue;
        const s = open[j].seg;
        if (near(s.a, end, tol)) chain.push(s);
        else if (near(s.b, end, tol)) chain.push(reverse(s));
        else continue;
        used[j] = true;
        ids.push(open[j].id);
        progressed = true;
        break;
      }
    }
    if (chain.length >= 2 && near(chain[0].a, chain[chain.length - 1].b, tol)) {
      // přesné uzavření
      const last = chain[chain.length - 1];
      chain[chain.length - 1] = { ...last, b: chain[0].a };
      loops.push({ kind: "segs", segs: chain, sourceIds: [...new Set(ids)] });
    }
    // nevyužité segmenty se započítají jako otevřené (viz openCount)
  }
  const inLoops = new Set(loops.flatMap((l) => l.sourceIds));
  const openCount = new Set(open.filter((o) => !inLoops.has(o.id)).map((o) => o.id)).size;
  return { loops, openCount };
}

/** Polygonová aproximace smyčky (pro obsah, vnoření a náhled). */
export function loopPolygon(l: Loop): Vec2[] {
  if (l.kind === "circle") return Array.from({ length: 48 }, (_, i) => [l.cx + l.r * Math.cos((i / 48) * Math.PI * 2), l.cy + l.r * Math.sin((i / 48) * Math.PI * 2)] as Vec2);
  const pts: Vec2[] = [];
  for (const s of l.segs) {
    if (s.kind === "line") pts.push(s.a);
    else pts.push(...arcPoints(s.a, s.m, s.b, 16).slice(0, -1));
  }
  return pts;
}

export function polygonArea(p: Vec2[]) {
  let a = 0;
  for (let i = 0; i < p.length; i++) {
    const [x1, y1] = p[i];
    const [x2, y2] = p[(i + 1) % p.length];
    a += x1 * y2 - x2 * y1;
  }
  return a / 2;
}

export function pointInPolygon(pt: Vec2, poly: Vec2[]) {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [xi, yi] = poly[i];
    const [xj, yj] = poly[j];
    if (yi > pt[1] !== yj > pt[1] && pt[0] < ((xj - xi) * (pt[1] - yi)) / (yj - yi + 1e-300) + xi) inside = !inside;
  }
  return inside;
}

/**
 * Vnoření profilů: každá smyčka dostane hloubku (0 = vnější obrys, 1 = otvor, 2 = ostrůvek v otvoru…).
 * Sudá hloubka = materiál, lichá = díra.
 */
export function nestLoops(loops: Loop[]): { loop: Loop; depth: number; area: number }[] {
  const polys = loops.map((l) => loopPolygon(l));
  const areas = polys.map((p) => Math.abs(polygonArea(p)));
  return loops.map((loop, i) => {
    const sample = polys[i][0];
    let depth = 0;
    polys.forEach((q, j) => {
      if (j !== i && areas[j] > areas[i] && pointInPolygon(sample, q)) depth++;
    });
    return { loop, depth, area: areas[i] };
  });
}

// ---------------- DXF ----------------

/** DXF (R12, mm) z entit skici — přímý export 2D výkresu pro laser, vodní paprsek, CNC. */
export function sketchToDxf(entities: SketchEntity[]): string {
  const out: string[] = [];
  const add = (...kv: (string | number)[]) => out.push(...kv.map(String));
  const line = (a: Vec2, b: Vec2, layer = "0") => add(0, "LINE", 8, layer, 10, f(a[0]), 20, f(a[1]), 30, 0, 11, f(b[0]), 21, f(b[1]), 31, 0);
  const f = (n: number) => (Math.round(n * 1e6) / 1e6).toString();
  add(0, "SECTION", 2, "HEADER", 9, "$INSUNITS", 70, 4, 0, "ENDSEC");
  add(0, "SECTION", 2, "ENTITIES");
  for (const e of entities) {
    const layer = e.construction ? "KONSTRUKCE" : "0";
    if (e.type === "point") add(0, "POINT", 8, layer, 10, f(e.p[0]), 20, f(e.p[1]), 30, 0);
    else if (e.type === "ellipse" || e.type === "spline") {
      const { pts, closed } = entityPath(e);
      const P = closed ? [...pts, pts[0]] : pts;
      P.slice(1).forEach((p, i) => line(P[i], p, layer));
    } else if (e.type === "circle") add(0, "CIRCLE", 8, layer, 10, f(e.cx), 20, f(e.cy), 30, 0, 40, f(e.r));
    else if (e.type === "line") line(e.a, e.b, layer);
    else if (e.type === "arc") {
      const cc = circleFrom3(e.a, e.b, e.c);
      if (!cc) line(e.a, e.c);
      else {
        const pts = arcPoints(e.a, e.b, e.c, 8);
        // DXF ARC je vždy proti směru hodinových ručiček → určit start/konec
        const ccw = polygonArea([e.a, e.b, e.c]) > 0;
        const s = ccw ? pts[0] : pts[pts.length - 1];
        const t = ccw ? pts[pts.length - 1] : pts[0];
        const deg = (p: Vec2) => (((Math.atan2(p[1] - cc.c[1], p[0] - cc.c[0]) * 180) / Math.PI) + 360) % 360;
        add(0, "ARC", 8, "0", 10, f(cc.c[0]), 20, f(cc.c[1]), 30, 0, 40, f(cc.r), 50, f(deg(s)), 51, f(deg(t)));
      }
    } else if (e.type === "polyline" && !e.closed) e.points.slice(1).forEach((p, i) => line(e.points[i], p));
    else {
      const segs = shapeSegs(e);
      if (!segs) continue;
      for (const s of segs) {
        if (s.kind === "line") line(s.a, s.b);
        else {
          const pts = arcPoints(s.a, s.m, s.b, 12);
          pts.slice(1).forEach((p, i) => line(pts[i], p));
        }
      }
    }
  }
  add(0, "ENDSEC", 0, "EOF");
  return out.join("\n") + "\n";
}

/** Body entity pro vykreslení (SVG polyline). */
export function entityPath(e: SketchEntity): { pts: Vec2[]; closed: boolean } {
  if (e.type === "point") return { pts: [e.p], closed: false };
  if (e.type === "ellipse") return { pts: ellipsePoints(e, 72), closed: true };
  if (e.type === "spline") return { pts: splinePoints(e.points, e.closed, 16), closed: e.closed };
  if (e.type === "circle") return { pts: loopPolygon({ kind: "circle", cx: e.cx, cy: e.cy, r: e.r, sourceIds: [] }), closed: true };
  if (e.type === "line") return { pts: [e.a, e.b], closed: false };
  if (e.type === "arc") return { pts: arcPoints(e.a, e.b, e.c, 32), closed: false };
  if (e.type === "polyline" && !e.closed) return { pts: e.points, closed: false };
  if (e.type === "slot" && e.length <= e.width) return entityPath({ id: e.id, type: "circle", cx: e.cx, cy: e.cy, r: e.width / 2 });
  const segs = shapeSegs(e);
  if (!segs) return { pts: [], closed: false };
  return { pts: loopPolygon({ kind: "segs", segs, sourceIds: [] }), closed: true };
}

/** Uchopovací body entity (koncové body, středy). */
export function snapPoints(e: SketchEntity): Vec2[] {
  switch (e.type) {
    case "line":
      return [e.a, e.b, [(e.a[0] + e.b[0]) / 2, (e.a[1] + e.b[1]) / 2]];
    case "arc":
      return [e.a, e.c, ...(circleFrom3(e.a, e.b, e.c) ? [circleFrom3(e.a, e.b, e.c)!.c] : [])];
    case "polyline":
      return e.points;
    case "circle":
      return [[e.cx, e.cy], [e.cx + e.r, e.cy], [e.cx - e.r, e.cy], [e.cx, e.cy + e.r], [e.cx, e.cy - e.r]];
    case "point":
      return [e.p];
    case "spline":
      return e.points;
    case "ellipse":
      return Object.values(keyPoints(e));
    default: {
      const segs = shapeSegs(e);
      return [[(e as { cx: number }).cx, (e as { cy: number }).cy], ...(segs ? segs.map((s) => s.a) : [])];
    }
  }
}

// ---------------- charakteristické body a primitiva (uchopování, vazby, ořez) ----------------

const rotD = (p: Vec2, c: Vec2, deg: number) => rot(p, c, deg);

/** Pojmenované charakteristické body entity (klíče shodné s SketchRef.k). */
export function keyPoints(e: SketchEntity): Record<string, Vec2> {
  const out: Record<string, Vec2> = {};
  switch (e.type) {
    case "line":
      out.a = e.a;
      out.b = e.b;
      out.mid = [(e.a[0] + e.b[0]) / 2, (e.a[1] + e.b[1]) / 2];
      break;
    case "arc": {
      out.a = e.a;
      out.c = e.c;
      const cc = circleFrom3(e.a, e.b, e.c);
      if (cc) {
        out.center = cc.c;
        const pts = arcPoints(e.a, e.b, e.c, 2);
        out.mid = pts[1];
      }
      break;
    }
    case "circle":
      out.center = [e.cx, e.cy];
      out.q0 = [e.cx + e.r, e.cy];
      out.q1 = [e.cx, e.cy + e.r];
      out.q2 = [e.cx - e.r, e.cy];
      out.q3 = [e.cx, e.cy - e.r];
      break;
    case "rect": {
      const c: Vec2 = [e.cx, e.cy];
      out.center = c;
      const hw = e.w / 2;
      const hh = e.h / 2;
      const cs: Vec2[] = [rotD([e.cx - hw, e.cy - hh], c, e.angle), rotD([e.cx + hw, e.cy - hh], c, e.angle), rotD([e.cx + hw, e.cy + hh], c, e.angle), rotD([e.cx - hw, e.cy + hh], c, e.angle)];
      cs.forEach((p, i) => {
        out[`c${i}`] = p;
        const q = cs[(i + 1) % 4];
        out[`m${i}`] = [(p[0] + q[0]) / 2, (p[1] + q[1]) / 2];
      });
      break;
    }
    case "polygon": {
      out.center = [e.cx, e.cy];
      const n = Math.max(3, Math.round(e.sides));
      for (let i = 0; i < n; i++) {
        const t = (e.angle * Math.PI) / 180 + (i / n) * Math.PI * 2 + Math.PI / 2;
        out[`c${i}`] = [e.cx + e.r * Math.cos(t), e.cy + e.r * Math.sin(t)];
      }
      break;
    }
    case "slot": {
      const c: Vec2 = [e.cx, e.cy];
      out.center = c;
      const L = Math.max(0, e.length - e.width) / 2;
      out.e0 = rotD([e.cx - L, e.cy], c, e.angle);
      out.e1 = rotD([e.cx + L, e.cy], c, e.angle);
      break;
    }
    case "polyline":
    case "spline":
      e.points.forEach((p, i) => (out[`p${i}`] = p));
      break;
    case "point":
      out.p = e.p;
      break;
    case "ellipse": {
      const c: Vec2 = [e.cx, e.cy];
      out.center = c;
      out.q0 = rotD([e.cx + e.rx, e.cy], c, e.angle);
      out.q1 = rotD([e.cx, e.cy + e.ry], c, e.angle);
      out.q2 = rotD([e.cx - e.rx, e.cy], c, e.angle);
      out.q3 = rotD([e.cx, e.cy - e.ry], c, e.angle);
      break;
    }
  }
  return out;
}

/** Geometrické primitivum: úsečka, nebo oblouk/kružnice (a0 → a0+sweep proti směru hodin, rad). */
export type Prim = { kind: "line"; a: Vec2; b: Vec2; id: string; part?: string } | { kind: "arc"; c: Vec2; r: number; a0: number; sweep: number; id: string; part?: string };

/** Oblouk třemi body → střed, poloměr, počáteční úhel a průběh (kladně = CCW). */
export function arcGeom(a: Vec2, m: Vec2, b: Vec2): { c: Vec2; r: number; a0: number; sweep: number } | null {
  const cc = circleFrom3(a, m, b);
  if (!cc) return null;
  const ang = (p: Vec2) => Math.atan2(p[1] - cc.c[1], p[0] - cc.c[0]);
  const TAU = Math.PI * 2;
  const nrm = (x: number) => ((x % TAU) + TAU) % TAU;
  const a0 = ang(a);
  const am = nrm(ang(m) - a0);
  const ab = nrm(ang(b) - a0);
  const sweep = am < ab ? ab : ab - TAU;
  // normalizovat na CCW
  if (sweep < 0) return { c: cc.c, r: cc.r, a0: ang(b), sweep: -sweep };
  return { c: cc.c, r: cc.r, a0, sweep };
}

function segPrim(s: Seg, id: string, part?: string): Prim | null {
  if (s.kind === "line") return { kind: "line", a: s.a, b: s.b, id, part };
  const g = arcGeom(s.a, s.m, s.b);
  return g ? { kind: "arc", ...g, id, part } : { kind: "line", a: s.a, b: s.b, id, part };
}

/** Primitiva entity (pro uchopení, průsečíky, ořez). */
export function prims(e: SketchEntity): Prim[] {
  switch (e.type) {
    case "line":
      return [{ kind: "line", a: e.a, b: e.b, id: e.id }];
    case "arc": {
      const g = arcGeom(e.a, e.b, e.c);
      return g ? [{ kind: "arc", ...g, id: e.id }] : [{ kind: "line", a: e.a, b: e.c, id: e.id }];
    }
    case "circle":
      return [{ kind: "arc", c: [e.cx, e.cy], r: e.r, a0: 0, sweep: Math.PI * 2, id: e.id }];
    case "point":
      return [];
    case "polyline": {
      const out: Prim[] = e.points.slice(1).map((p, i) => ({ kind: "line" as const, a: e.points[i], b: p, id: e.id, part: `g${i}` }));
      if (e.closed && e.points.length > 2) out.push({ kind: "line", a: e.points[e.points.length - 1], b: e.points[0], id: e.id, part: `g${e.points.length - 1}` });
      return out;
    }
    case "ellipse":
    case "spline": {
      const { pts, closed } = entityPath(e);
      const P = closed ? [...pts, pts[0]] : pts;
      return P.slice(1).map((p, i) => ({ kind: "line" as const, a: P[i], b: p, id: e.id }));
    }
    case "slot":
      if (e.length <= e.width) return [{ kind: "arc", c: [e.cx, e.cy], r: e.width / 2, a0: 0, sweep: Math.PI * 2, id: e.id }];
    // eslint-disable-next-line no-fallthrough
    default: {
      const segs = shapeSegs(e) ?? [];
      return segs.map((sg, i) => segPrim(sg, e.id, e.type === "rect" && !e.r ? `s${i}` : e.type === "polygon" ? `s${i}` : undefined)).filter((x): x is Prim => !!x);
    }
  }
}
