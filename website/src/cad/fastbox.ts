/**
 * Rychlý obalový kvádr tělesa.
 *
 * replicad počítá `shape.boundingBox` přes `BRepBndLib.AddOptimal`, který u toroidních ploch (zaoblení, rotace oblouku)
 * spouští numerickou optimalizaci – na oběžném kole s 285 toroidními plochami trvalo jedno volání 7,5 s a volá se u každé
 * díry, řezu i pole. Tady se toroidní plochy počítají analyticky (hrany plochy + body, kde je normála rovnoběžná s osou
 * souřadnic), ostatní plochy dál přesně přes jádro. Výsledek se pamatuje pro každý tvar (tvary se po vzniku nemění).
 */
import * as r from "replicad";

type Shape = r.Shape3D;
type B6 = [number, number, number, number, number, number];
type V3 = [number, number, number];
type OC = any;

const cache = new WeakMap<object, B6>();
const TWO_PI = Math.PI * 2;

const empty = (): B6 => [Infinity, Infinity, Infinity, -Infinity, -Infinity, -Infinity];
function growPoint(b: B6, p: V3) {
  for (let i = 0; i < 3; i++) {
    if (p[i] < b[i]) b[i] = p[i];
    if (p[i] > b[i + 3]) b[i + 3] = p[i];
  }
}
/** přesný kvádr přes jádro (pro vše kromě toroidních ploch) */
function growOptimal(oc: OC, wrapped: unknown, b: B6) {
  const box = new oc.Bnd_Box();
  try {
    oc.BRepBndLib.AddOptimal(wrapped, box, false, false);
    if (box.IsVoid()) return;
    const a = box.CornerMin();
    const c = box.CornerMax();
    growPoint(b, [a.X(), a.Y(), a.Z()]);
    growPoint(b, [c.X(), c.Y(), c.Z()]);
    a.delete();
    c.delete();
  } finally {
    box.delete();
  }
}
const sub = (a: V3, b: V3): V3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const dot = (a: V3, b: V3) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const len = (a: V3) => Math.hypot(a[0], a[1], a[2]);
const scale = (a: V3, k: number): V3 => [a[0] * k, a[1] * k, a[2] * k];

/** posune úhel o násobek 2π do rozsahu ⟨lo; hi⟩ (s tolerancí); mimo rozsah → null */
function intoRange(t: number, lo: number, hi: number): number | null {
  const eps = 1e-9;
  let x = t - Math.ceil((t - hi) / TWO_PI - eps) * TWO_PI; // největší x ≤ hi
  if (x > hi) x = hi;
  if (x < lo - eps) return null;
  return Math.max(x, lo);
}

/** Bod uvnitř rozsahu parametrů plochy, který může ležet v otvoru plochy – započítá se, až když se ověří, že na ploše opravdu je. */
type Candidate = { face: r.Face; point: V3 };

/** Toroidní plocha: hrany + vnitřní body s normálou ve směru os (tam leží krajní hodnoty mimo hranice plochy). */
function growTorusFace(oc: OC, face: r.Face, b: B6, cands: Candidate[]) {
  for (const e of face.edges) growOptimal(oc, e.wrapped, b);
  const ad = new oc.BRepAdaptor_Surface(face.wrapped, true);
  const pnt = new oc.gp_Pnt();
  try {
    const u1 = ad.FirstUParameter();
    const u2 = ad.LastUParameter();
    const v1 = ad.FirstVParameter();
    const v2 = ad.LastVParameter();
    const P = (u: number, v: number): V3 => {
      ad.D0(u, v, pnt);
      return [pnt.X(), pnt.Y(), pnt.Z()];
    };
    // soustava toru ze vzorků: P(u,v) = C + (R + r·cos v)(cos u·X + sin u·Y) + r·sin v·A
    const p00 = P(0, 0);
    const pP0 = P(Math.PI, 0);
    const C = scale([p00[0] + pP0[0], p00[1] + pP0[1], p00[2] + pP0[2]], 0.5);
    const outer = len(sub(p00, C)); // R + r
    if (!(outer > 1e-12)) return;
    const X = scale(sub(p00, C), 1 / outer);
    const inner = dot(sub(P(0, Math.PI), C), X); // R − r
    const R = (outer + inner) / 2;
    const rr = (outer - inner) / 2;
    if (!(rr > 1e-12)) return;
    const yv = sub(P(Math.PI / 2, 0), C);
    const Y = scale(yv, 1 / (len(yv) || 1));
    const A = scale(sub(sub(P(0, Math.PI / 2), C), scale(X, R)), 1 / rr);
    const uMid = (u1 + u2) / 2;
    for (let i = 0; i < 3; i++) {
      const d: V3 = [0, 0, 0];
      d[i] = 1;
      const a = dot(d, A);
      const bx = dot(d, X);
      const by = dot(d, Y);
      const m = Math.hypot(bx, by);
      // normála n(u,v) = cos v (cos u·X + sin u·Y) + sin v·A je rovnoběžná s d ve čtyřech bodech (± směr, vnější a vnitřní strana trubky)
      const cand: [number, number][] = [];
      if (m < 1e-9) {
        cand.push([uMid, Math.PI / 2], [uMid, -Math.PI / 2]);
      } else {
        const u0 = Math.atan2(by, bx);
        const v0 = Math.atan2(a, m);
        cand.push([u0, v0], [u0 + Math.PI, Math.PI - v0], [u0 + Math.PI, -v0], [u0, Math.PI + v0]);
      }
      for (const [cu, cv] of cand) {
        const u = intoRange(cu, u1, u2);
        const v = intoRange(cv, v1, v2);
        if (u === null || v === null) continue;
        cands.push({ face, point: P(u, v) });
      }
    }
  } finally {
    pnt.delete();
    ad.delete();
  }
}

const outside = (b: B6, p: V3) => p.some((v, i) => v < b[i] - 1e-9 || v > b[i + 3] + 1e-9);
/** leží bod na (ořezané) ploše? – vzdálenost bodu od plochy */
function onFace(oc: OC, face: r.Face, p: V3): boolean {
  const pnt = new oc.gp_Pnt(p[0], p[1], p[2]);
  const mk = new oc.BRepBuilderAPI_MakeVertex(pnt);
  const vtx = mk.Vertex();
  const dist = new oc.BRepExtrema_DistShapeShape();
  try {
    dist.LoadS1(vtx);
    dist.LoadS2(face.wrapped);
    dist.Perform();
    return dist.Value() < 1e-6;
  } catch {
    return true; // nelze ověřit → raději větší kvádr než menší
  } finally {
    dist.delete();
    vtx.delete();
    mk.delete();
    pnt.delete();
  }
}

/** Obalový kvádr ⟨min; max⟩ – přesný, rychlý, s pamětí pro každý tvar. */
export function fastBounds(shape: Shape): [V3, V3] {
  const hit = cache.get(shape);
  if (hit) return [[hit[0], hit[1], hit[2]], [hit[3], hit[4], hit[5]]];
  const oc: OC = r.getOC();
  const b = empty();
  let faces: r.Face[] = [];
  try {
    faces = (shape as unknown as { faces: r.Face[] }).faces ?? [];
  } catch {
    faces = [];
  }
  const torus = faces.length ? faces.map((f) => f.geomType === "TORUS") : [];
  if (!torus.some(Boolean)) growOptimal(oc, shape.wrapped, b);
  else {
    const cands: Candidate[] = [];
    faces.forEach((f, i) => {
      if (torus[i]) growTorusFace(oc, f, b, cands);
      else growOptimal(oc, f.wrapped, b);
    });
    // vnitřní krajní body: ověřují se jen ty, které by kvádr zvětšily (bod může ležet v otvoru ořezané plochy)
    for (const c of cands) {
      if (!outside(b, c.point)) continue;
      if (onFace(oc, c.face, c.point)) growPoint(b, c.point);
    }
  }
  if (!Number.isFinite(b[0])) b.fill(0);
  cache.set(shape, b);
  return [[b[0], b[1], b[2]], [b[3], b[4], b[5]]];
}

/** Odhad úhlopříčky tvaru zděděný od předchůdce (výsledek odebrání je nejvýš tak velký jako původní těleso). */
const sizeHints = new WeakMap<object, number>();
export function setSizeHint(shape: object, diag: number) {
  if (diag > 0) sizeHints.set(shape, diag);
}
/** Úhlopříčka tvaru pro volbu jemnosti sítě: spočítaný kvádr → zděděný odhad → přesný výpočet (uloží se). */
export function sizeOf(shape: Shape): number {
  const hit = cache.get(shape);
  if (hit) return Math.hypot(hit[3] - hit[0], hit[4] - hit[1], hit[5] - hit[2]);
  const hint = sizeHints.get(shape);
  if (hint) return hint;
  const [a, b] = fastBounds(shape);
  return Math.hypot(b[0] - a[0], b[1] - a[1], b[2] - a[2]);
}

const HASH_MAX = 2147483647;
/**
 * Jedinečné podtvary (plochy / hrany) v pořadí průchodu tvarem. replicad duplicity hledá porovnáním každého s každým
 * (u 1 500 hran přes milion volání jádra, ~1 s na jeden výčet); tady se porovnává jen v rámci stejného otisku.
 */
type SubKind = "FACE" | "EDGE" | "VERTEX" | "SOLID" | "SHELL" | "WIRE";
function uniqueSub(wrapped: unknown, kind: SubKind): { delete(): void }[] {
  const oc: OC = r.getOC();
  const en = oc.TopAbs_ShapeEnum;
  const ex = new oc.TopExp_Explorer(wrapped, en[`TopAbs_${kind}`], en.TopAbs_SHAPE);
  const out: { delete(): void }[] = [];
  const buckets = new Map<number, { IsSame(o: unknown): boolean }[]>();
  try {
    while (ex.More()) {
      const it = ex.Current();
      const h = oc.ReplicadShapeHasher.HashCode(it, HASH_MAX) as number;
      const b = buckets.get(h);
      if (!b) {
        buckets.set(h, [it]);
        out.push(it);
      } else if (!b.some((x) => x.IsSame(it))) {
        b.push(it);
        out.push(it);
      } else it.delete();
      ex.Next();
    }
  } finally {
    ex.delete();
  }
  return out;
}

/**
 * Jedinečné podtvary daného druhu jako konkrétní typ jádra (TopoDS_Vertex, TopoDS_Solid…) – rychlá náhrada `r.iterTopo`
 * se stejným pořadím. Vrácené objekty patří volajícímu.
 */
export function subShapes(shape: { wrapped: unknown }, kind: SubKind): unknown[] {
  const downcast = (r as unknown as { downcast(s: unknown): unknown }).downcast;
  return uniqueSub(shape.wrapped, kind).map((it) => {
    const d = downcast(it);
    it.delete();
    return d;
  });
}

/** Už spočítaný kvádr tvaru (bez výpočtu) – pro odhady velikosti tam, kde se kvůli nim nevyplatí počítat. */
export function cachedBounds(shape: object): [V3, V3] | null {
  const hit = cache.get(shape);
  return hit ? [[hit[0], hit[1], hit[2]], [hit[3], hit[4], hit[5]]] : null;
}

let installed = false;
/** Nahradí pomalý `Shape.boundingBox` replicadu rychlou variantou (jednou pro celé jádro – platí i pro volání uvnitř replicadu). */
export function installFastBounds() {
  if (installed) return;
  installed = true;
  const proto = (r as unknown as { Shape: { prototype: object } }).Shape.prototype;
  const BB = (r as unknown as { BoundingBox: { fromBounds(min: V3, max: V3): unknown } }).BoundingBox;
  Object.defineProperty(proto, "boundingBox", {
    configurable: true,
    get(this: Shape) {
      const [min, max] = fastBounds(this);
      return BB.fromBounds(min, max);
    },
  });
  // kopie tvaru (jiný objekt, stejná geometrie) si spočítaný kvádr i odhad velikosti nese s sebou
  const p = proto as { clone: (this: Shape) => Shape };
  const clone = p.clone;
  p.clone = function (this: Shape) {
    const c = clone.call(this);
    const hit = cache.get(this);
    if (hit) cache.set(c, hit);
    const hint = sizeHints.get(this);
    if (hint) sizeHints.set(c, hint);
    return c;
  };
  // výčet ploch a hran bez porovnávání každého s každým (stejné pořadí i výsledek jako v replicadu)
  const cast = (r as unknown as { cast(s: unknown): unknown }).cast;
  for (const [name, kind] of [["faces", "FACE"], ["edges", "EDGE"]] as const) {
    Object.defineProperty(proto, name, {
      configurable: true,
      get(this: Shape) {
        return uniqueSub(this.wrapped, kind).map((it) => {
          const w = cast(it);
          it.delete();
          return w;
        });
      },
    });
  }
}
installFastBounds();
