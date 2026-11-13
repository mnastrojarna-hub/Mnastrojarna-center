/**
 * Spline s tečnami v jádře: `GeomAPI_Interpolate` (přesná interpolace bodů) s tečnými podmínkami `Load(tečny, příznaky,
 * Scale=false)`. Velikost tečny = váha × jednotkový směr (derivace podle parametru délky tětiv; 1 = přirozená velikost).
 * Uzavřená křivka = periodická interpolace. Křivka je totožná s 2D výpočtem ve skicáři (spline-tangent.ts).
 */
import * as r from "replicad";
import { tr } from "./i18n";
import { dirOf, splineDerivatives, tangentAt, weightAt, type SplineEnt } from "./spline-tangent";
import type { Vec3 } from "./types";

type OC = any;
const oc = (): OC => r.getOC() as OC;

/**
 * B-spline hrana interpolující body `pts` s volitelnými tečnami (`tangents[i]` = vektor derivace, null = volná).
 * `params` = vlastní parametry bodů (u periodické n+1 hodnot), jinak délky tětiv.
 */
export function interpolateCurve(pts: Vec3[], o: { tangents?: (Vec3 | null)[] | null; periodic?: boolean; params?: number[] } = {}): { curve: unknown; edge: r.Edge } {
  const o_ = oc();
  const n = pts.length;
  if (n < 2) throw new Error(tr("Spline potřebuje aspoň dva body."));
  const gc: { delete(): void }[] = [];
  try {
    const arr = new o_.NCollection_Array1_gp_Pnt(1, n);
    gc.push(arr);
    pts.forEach((p, i) => {
      const g = new o_.gp_Pnt(p[0], p[1], p[2]);
      arr.SetValue(i + 1, g);
      g.delete();
    });
    const h = new o_.NCollection_HArray1_gp_Pnt(arr);
    let it: OC;
    if (o.params) {
      const pa = new o_.NCollection_Array1_double(1, o.params.length);
      gc.push(pa);
      o.params.forEach((v, i) => pa.SetValue(i + 1, v));
      it = new o_.GeomAPI_Interpolate(h, new o_.NCollection_HArray1_double(pa), !!o.periodic, 1e-9);
    } else it = new o_.GeomAPI_Interpolate(h, !!o.periodic, 1e-9);
    gc.push(it);
    const tg = o.tangents;
    if (tg && tg.some((v) => v)) {
      const tv = new o_.NCollection_Array1_gp_Vec(1, n);
      const fl = new o_.NCollection_Array1_bool(1, n);
      gc.push(tv, fl);
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
    if (!it.IsDone()) throw new Error(tr("Spline se nepodařilo proložit body – body se nesmí opakovat."));
    const curve = it.Curve();
    const mk = new o_.BRepBuilderAPI_MakeEdge(curve);
    gc.push(mk);
    return { curve, edge: new r.Edge(mk.Edge()) };
  } catch (e) {
    if (e instanceof Error) throw e;
    throw new Error(tr("Spline se nepodařilo proložit body – body se nesmí opakovat."));
  } finally {
    gc.forEach((x) => x.delete());
  }
}

/** Spline entita skici s tečnami jako hrana v prostoru roviny skici. */
export function sketchSplineEdge(e: SplineEnt, plane: r.Plane): r.Edge {
  const W = (p: [number, number]): Vec3 => {
    const v = plane.toWorldCoords(p);
    return [v.x, v.y, v.z];
  };
  const xd: Vec3 = [plane.xDir.x, plane.xDir.y, plane.xDir.z];
  const yd: Vec3 = [plane.yDir.x, plane.yDir.y, plane.yDir.z];
  const closed = e.closed && e.points.length >= 3;
  const tangents: (Vec3 | null)[] = e.points.map((_, i) => {
    const a = tangentAt(e, i);
    if (a === null) return null;
    const [c, s] = dirOf(a);
    const w = weightAt(e, i);
    return [w * (c * xd[0] + s * yd[0]), w * (c * xd[1] + s * yd[1]), w * (c * xd[2] + s * yd[2])] as Vec3;
  });
  if (closed && !tangents[0]) {
    // OCCT u periodické interpolace bez tečny v prvním bodě odhadne tečnu (Lagrange) a ve švu je jen C1; zadáním derivace
    // z periodického C2 řešení (stejné jako ve skicáři) je výsledek C2 i ve švu a přesně shodný s 2D náhledem
    const m0 = splineDerivatives(e).m[0];
    tangents[0] = [m0[0] * xd[0] + m0[1] * yd[0], m0[0] * xd[1] + m0[1] * yd[1], m0[0] * xd[2] + m0[1] * yd[2]];
  }
  return interpolateCurve(e.points.map(W), { tangents, periodic: closed }).edge;
}
