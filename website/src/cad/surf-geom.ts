/**
 * Geometrie ploch nad OpenCascade (7. vlna, balík „surfaces“): interpolace křivek (i periodická C2), tenzorová interpolace
 * B-spline ploch, plocha z řad pólů, vyhodnocení derivací plochy, normálová křivost ve směru, převod plochy na B-spline.
 * Používá: hladké uzavřené šablonování (feat/loft-smooth.ts), plochy třídy A (ext/surface-a.ts), analýza návaznosti.
 * Běží ve workeru i v Node (testy) – žádné DOM API.
 */
import * as r from "replicad";
import { tr } from "./i18n";
import { solveDense } from "./spline-tangent";
import type { Vec3 } from "./types";

type OC = any;
const oc = (): OC => r.getOC() as OC;

export const V3 = {
  sub: (a: Vec3, b: Vec3): Vec3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]],
  add: (a: Vec3, b: Vec3): Vec3 => [a[0] + b[0], a[1] + b[1], a[2] + b[2]],
  mul: (a: Vec3, k: number): Vec3 => [a[0] * k, a[1] * k, a[2] * k],
  dot: (a: Vec3, b: Vec3) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2],
  cross: (a: Vec3, b: Vec3): Vec3 => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]],
  len: (a: Vec3) => Math.hypot(a[0], a[1], a[2]),
  dist: (a: Vec3, b: Vec3) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]),
  norm: (a: Vec3): Vec3 => {
    const l = Math.hypot(a[0], a[1], a[2]) || 1;
    return [a[0] / l, a[1] / l, a[2] / l];
  },
  /** úhel dvou vektorů (°) */
  angle: (a: Vec3, b: Vec3) => {
    const la = Math.hypot(...a);
    const lb = Math.hypot(...b);
    if (!(la > 0 && lb > 0)) return 0;
    const c = (a[0] * b[0] + a[1] * b[1] + a[2] * b[2]) / (la * lb);
    const s = Math.hypot(a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]) / (la * lb);
    return (Math.atan2(s, c) * 180) / Math.PI;
  },
};

const pnt = (o: OC, p: Vec3) => new o.gp_Pnt(p[0], p[1], p[2]);
const xyz = (p: { X(): number; Y(): number; Z(): number }): Vec3 => [p.X(), p.Y(), p.Z()];

/** Parametry bodů podle délky tětiv (u periodické o jeden víc – perioda je poslední hodnota). */
export function chordParams3(P: Vec3[], periodic: boolean): number[] {
  const t = [0];
  const n = P.length;
  const spans = periodic ? n : n - 1;
  for (let i = 0; i < spans; i++) t.push(t[i] + Math.max(1e-9, V3.dist(P[i], P[(i + 1) % n])));
  return t;
}

/**
 * Derivace periodického kubického C2 splinu v prvním bodě (parametry `t`, n+1 hodnot). OCCT při periodické interpolaci
 * bez tečny v prvním bodě tečnu odhadne a ve švu je jen C1 – zadáním této derivace je výsledek C2 i ve švu.
 */
export function periodicDeriv0(P: Vec3[], t: number[]): Vec3 {
  const n = P.length;
  const out: number[] = [];
  for (let c = 0; c < 3; c++) {
    const A = Array.from({ length: n }, () => new Array<number>(n).fill(0));
    const b = new Array<number>(n).fill(0);
    for (let i = 0; i < n; i++) {
      const ip = (i - 1 + n) % n;
      const iN = (i + 1) % n;
      const hp = i === 0 ? t[n] - t[n - 1] : t[i] - t[i - 1];
      const hn = t[i + 1] - t[i];
      A[i][ip] += 1 / hp;
      A[i][i] += 2 * (1 / hp + 1 / hn);
      A[i][iN] += 1 / hn;
      b[i] = 3 * ((P[i][c] - P[ip][c]) / (hp * hp) + (P[iN][c] - P[i][c]) / (hn * hn));
    }
    out.push(solveDense(A, b)[0]);
  }
  return out as Vec3;
}

/**
 * Interpolační B-spline křivka (OCCT GeomAPI_Interpolate) přes body s parametry `t` (u periodické n+1 hodnot),
 * volitelně s tečnami (vektory derivace, null = volná). Periodická je C2 i ve švu (viz periodicDeriv0).
 */
export function interpCurve(P: Vec3[], t: number[], o: { periodic?: boolean; tangents?: (Vec3 | null)[] } = {}): OC {
  const o_ = oc();
  const n = P.length;
  const arr = new o_.NCollection_Array1_gp_Pnt(1, n);
  P.forEach((p, i) => {
    const g = pnt(o_, p);
    arr.SetValue(i + 1, g);
    g.delete();
  });
  const pa = new o_.NCollection_Array1_double(1, t.length);
  t.forEach((v, i) => pa.SetValue(i + 1, v));
  const it = new o_.GeomAPI_Interpolate(new o_.NCollection_HArray1_gp_Pnt(arr), new o_.NCollection_HArray1_double(pa), !!o.periodic, 1e-9);
  const tg: (Vec3 | null)[] = o.tangents ? [...o.tangents] : P.map(() => null);
  if (o.periodic && !tg[0]) tg[0] = periodicDeriv0(P, t);
  const tv = new o_.NCollection_Array1_gp_Vec(1, n);
  const fl = new o_.NCollection_Array1_bool(1, n);
  try {
    if (tg.some((x) => x)) {
      for (let i = 0; i < n; i++) {
        const v = tg[i];
        const g = new o_.gp_Vec(v ? v[0] : 1, v ? v[1] : 0, v ? v[2] : 0);
        tv.SetValue(i + 1, g);
        g.delete();
        fl.SetValue(i + 1, !!v);
      }
      it.Load(tv, new o_.NCollection_HArray1_bool(fl), false);
    }
    it.Perform();
    if (!it.IsDone()) throw new Error(tr("Interpolace křivky se nezdařila – body se nesmí opakovat."));
    return it.Curve();
  } finally {
    it.delete();
    arr.delete();
    pa.delete();
    tv.delete();
    fl.delete();
  }
}

/** Póly, uzly a násobnosti B-spline křivky OCCT. */
export function curveData(c: OC): { poles: Vec3[]; knots: number[]; mults: number[]; degree: number; periodic: boolean } {
  const poles: Vec3[] = [];
  for (let i = 1; i <= c.NbPoles(); i++) poles.push(xyz(c.Pole(i)));
  const knots: number[] = [];
  const mults: number[] = [];
  for (let i = 1; i <= c.NbKnots(); i++) {
    knots.push(c.Knot(i));
    mults.push(c.Multiplicity(i));
  }
  return { poles, knots, mults, degree: c.Degree(), periodic: c.IsPeriodic() };
}

/** B-spline plocha OCCT z mřížky pólů `poles[iu][iv]` (neracionální). */
export function bsplineSurface(poles: Vec3[][], u: { knots: number[]; mults: number[]; degree: number; periodic?: boolean }, v: { knots: number[]; mults: number[]; degree: number; periodic?: boolean }): OC {
  const o_ = oc();
  const nu = poles.length;
  const nv = poles[0].length;
  const P = new o_.NCollection_Array2_gp_Pnt(1, nu, 1, nv);
  for (let i = 0; i < nu; i++)
    for (let j = 0; j < nv; j++) {
      const g = pnt(o_, poles[i][j]);
      P.SetValue(i + 1, j + 1, g);
      g.delete();
    }
  const arr = (xs: number[], int = false) => {
    const a = int ? new o_.NCollection_Array1_int(1, xs.length) : new o_.NCollection_Array1_double(1, xs.length);
    xs.forEach((x, i) => a.SetValue(i + 1, x));
    return a;
  };
  const [UK, VK, UM, VM] = [arr(u.knots), arr(v.knots), arr(u.mults, true), arr(v.mults, true)];
  try {
    return new o_.Geom_BSplineSurface(P, UK, VK, UM, VM, u.degree, v.degree, !!u.periodic, !!v.periodic);
  } catch {
    throw new Error(tr("B-spline plochu se nepodařilo sestavit (nekonzistentní póly a uzly)."));
  } finally {
    [P, UK, VK, UM, VM].forEach((x) => x.delete());
  }
}

/**
 * Tenzorová interpolace mřížky bodů `grid[iv][iu]` (řady = řezy) B-spline plochou stupně 3×3: nejdřív každá řada v u,
 * pak póly řad ve v. Periodické směry jsou C2 i ve švu. `tu` / `tv` = parametry (u periodického směru o jeden víc).
 * Volitelné tečny řad v u na začátku / konci (`uStart[iv]`, `uEnd[iv]`) – pro neperiodický směr.
 */
export function tensorInterp(grid: Vec3[][], tu: number[], tv: number[], o: { uPeriodic?: boolean; vPeriodic?: boolean } = {}): OC {
  const rows = grid.map((row) => curveData(interpCurve(row, tu, { periodic: o.uPeriodic })));
  const nu = rows[0].poles.length;
  if (rows.some((r_) => r_.poles.length !== nu)) throw new Error(tr("Řezy plochy nemají stejnou strukturu – zkuste jiný počet bodů."));
  const cols: ReturnType<typeof curveData>[] = [];
  for (let j = 0; j < nu; j++) cols.push(curveData(interpCurve(rows.map((r_) => r_.poles[j]), tv, { periodic: o.vPeriodic })));
  const poles = cols.map((c) => c.poles); // poles[iu][iv]
  return bsplineSurface(poles, { knots: rows[0].knots, mults: rows[0].mults, degree: rows[0].degree, periodic: o.uPeriodic }, { knots: cols[0].knots, mults: cols[0].mults, degree: cols[0].degree, periodic: o.vPeriodic });
}

/** Plocha z „řad pólů“ ve směru v (Bézierův směr stupně `rows.length − 1`): každá řada je křivka v u se stejnými uzly. */
export function surfaceFromRows(rows: ReturnType<typeof curveData>[]): OC {
  const nu = rows[0].poles.length;
  if (rows.some((r_) => r_.poles.length !== nu)) throw new Error(tr("Řady pólů plochy nemají stejnou strukturu."));
  const deg = rows.length - 1;
  const poles = Array.from({ length: nu }, (_, i) => rows.map((r_) => r_.poles[i]));
  return bsplineSurface(poles, { knots: rows[0].knots, mults: rows[0].mults, degree: rows[0].degree, periodic: rows[0].periodic }, { knots: [0, 1], mults: [deg + 1, deg + 1], degree: deg });
}

/** Plocha (Geom_Surface) → topologická plocha v rozsahu parametrů (bez rozsahu = celá plocha). */
export function faceOf(surf: OC, b?: { u0: number; u1: number; v0: number; v1: number }): r.Face {
  const o_ = oc();
  const mk = b ? new o_.BRepBuilderAPI_MakeFace(surf, b.u0, b.u1, b.v0, b.v1, 1e-7) : new o_.BRepBuilderAPI_MakeFace(surf, 1e-7);
  try {
    if (!mk.IsDone()) throw new Error(tr("Z plochy se nepodařilo vytvořit stěnu."));
    const f = r.cast(mk.Face());
    if (!(f instanceof r.Face)) throw new Error(tr("Z plochy se nepodařilo vytvořit stěnu."));
    return f;
  } finally {
    mk.delete();
  }
}

/** Uzavřená plocha (nebo skořepina z jedné plochy) → objemové těleso se správnou orientací. */
export function solidFromClosedFace(face: r.Face): r.Shape3D {
  const o_ = oc();
  const b = new o_.TopoDS_Builder();
  const shell = new o_.TopoDS_Shell();
  b.MakeShell(shell);
  b.Add(shell, face.wrapped);
  const fix = new o_.ShapeFix_Solid();
  try {
    let s = r.cast(fix.SolidFromShell(shell)) as r.Shape3D;
    if (r.measureVolume(s) < 0) s = r.cast(s.wrapped.Reversed()) as r.Shape3D;
    return s;
  } finally {
    fix.delete();
    b.delete();
  }
}

export type SurfD2 = { p: Vec3; du: Vec3; dv: Vec3; duu: Vec3; dvv: Vec3; duv: Vec3 };
/** Bod a derivace plochy do 2. řádu. */
export function surfD2(surf: OC, u: number, v: number): SurfD2 {
  const o_ = oc();
  const p = new o_.gp_Pnt();
  const vs = [new o_.gp_Vec(), new o_.gp_Vec(), new o_.gp_Vec(), new o_.gp_Vec(), new o_.gp_Vec()];
  try {
    surf.D2(u, v, p, vs[0], vs[1], vs[2], vs[3], vs[4]);
    return { p: xyz(p), du: xyz(vs[0]), dv: xyz(vs[1]), duu: xyz(vs[2]), dvv: xyz(vs[3]), duv: xyz(vs[4]) };
  } finally {
    p.delete();
    vs.forEach((x) => x.delete());
  }
}

/** Jednotková normála plochy (bez ohledu na orientaci stěny). */
export const surfNormal = (d: SurfD2): Vec3 => V3.norm(V3.cross(d.du, d.dv));

/**
 * Normálová křivost plochy ve směru `w` (tečný vektor) vůči normále `n` (1/mm) – druhá základní forma:
 * w = a·Su + b·Sv (nejmenší čtverce), κ = (L a² + 2M ab + N b²) / (E a² + 2F ab + G b²).
 */
export function normalCurvature(d: SurfD2, w: Vec3, n: Vec3): number {
  const E = V3.dot(d.du, d.du);
  const F = V3.dot(d.du, d.dv);
  const G = V3.dot(d.dv, d.dv);
  const det = E * G - F * F;
  if (!(Math.abs(det) > 1e-18)) return 0;
  const wu = V3.dot(w, d.du);
  const wv = V3.dot(w, d.dv);
  const a = (G * wu - F * wv) / det;
  const b = (E * wv - F * wu) / det;
  const L = V3.dot(d.duu, n);
  const M = V3.dot(d.duv, n);
  const N = V3.dot(d.dvv, n);
  const den = E * a * a + 2 * F * a * b + G * b * b;
  return den > 1e-18 ? (L * a * a + 2 * M * a * b + N * b * b) / den : 0;
}

/** Plocha stěny (Geom_Surface, už v poloze stěny) a její rozsah parametrů. */
export function faceSurface(face: r.Face): { surf: OC; u0: number; u1: number; v0: number; v1: number; reversed: boolean } {
  const o_ = oc();
  const surf = o_.BRep_Tool.Surface(face.wrapped);
  const b = face.UVBounds;
  return { surf, u0: b.uMin, u1: b.uMax, v0: b.vMin, v1: b.vMax, reversed: face.orientation === "backward" };
}

/** B-spline podoba plochy stěny (kopie; analytické plochy se převedou přesně přes GeomConvert, ořezané na rozsah stěny). */
export function toBSpline(face: r.Face): OC {
  const o_ = oc();
  const { surf, u0, u1, v0, v1 } = faceSurface(face);
  const kind = surf.DynamicType?.()?.Name?.() ?? "";
  if (kind === "Geom_BSplineSurface" || surf instanceof o_.Geom_BSplineSurface) return new o_.Geom_BSplineSurface(surf);
  try {
    const trimmed = new o_.Geom_RectangularTrimmedSurface(surf, u0, u1, v0, v1, true, true);
    return o_.GeomConvert.SurfaceToBSplineSurface(trimmed);
  } catch {
    throw new Error(tr("Plochu tohoto typu nelze převést na B-spline (řídicí body)."));
  }
}

/** Bod na stěně nejblíže k `p` (parametry u, v a vzdálenost). */
export function projectOnSurface(surf: OC, p: Vec3, b?: { u0: number; u1: number; v0: number; v1: number }): { u: number; v: number; d: number; q: Vec3 } | null {
  const o_ = oc();
  const g = pnt(o_, p);
  const pr = b ? new o_.GeomAPI_ProjectPointOnSurf(g, surf, b.u0, b.u1, b.v0, b.v1) : new o_.GeomAPI_ProjectPointOnSurf(g, surf);
  try {
    if (!pr.NbPoints()) return null;
    const uv = pr.LowerDistanceParameters();
    const q = xyz(pr.NearestPoint());
    return { u: uv.U, v: uv.V, d: pr.LowerDistance(), q };
  } catch {
    return null;
  } finally {
    pr.delete();
    g.delete();
  }
}
