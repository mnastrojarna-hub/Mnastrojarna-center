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

/*
 * Ořezané volné plochy (B-spline, Bézier, rotační / odsazené plochy): `AddOptimal` spočte kvádr plochy přes celý obdélník
 * parametrů a body mimo ořez vyřazuje heuristikou (AdjustFaceBox → Extrema plocha–rovina), která u některých ploch selže –
 * broušený konec pružiny d 5 De 30 pak měl kvádr až −0,75·d pod dosedací rovinou. Kde kvádr plochy přesahuje kvádr jejích
 * hran i kvádr z ostatních ploch, ověří se krajní bod: najde se nejvzdálenější bod obdélníku parametrů (mřížka + zpřesnění);
 * leží-li mimo plochu (sudo-lichý test v rovině parametrů proti obrysu z p-křivek hran), platí kvádr hran rozšířený jen
 * o vnitřní krajní body plochy (zpřesnění z bodů mřížky uvnitř, které skončí uvnitř plochy). Kvádr se tak jen zmenšuje, a to
 * jen tam, kde krajní bod jádra prokazatelně na ploše není; každý započtený bod na ploše leží.
 */
const FREE_TYPES = new Set(["BSPLINE_SURFACE", "BEZIER_SURFACE", "REVOLUTION_SURFACE", "OFFSET_SURFACE", "OTHER_SURFACE"]);
/** u větších těles zůstává rychlá cesta jádra (velké importy STEP) */
const FREE_MAX_FACES = 400;
/** nejvýš tolik směrů (plocha × strana kvádru) jednoho tvaru se ověřuje podrobně */
const FREE_BUDGET = 64;
const GRID = 16;
const EDGE_SAMPLES = 48;

function boxOf(oc: OC, wrapped: unknown): B6 {
  const b = empty();
  growOptimal(oc, wrapped, b);
  return b;
}
const growBox = (b: B6, x: B6) => {
  if (!Number.isFinite(x[0])) return;
  growPoint(b, [x[0], x[1], x[2]]);
  growPoint(b, [x[3], x[4], x[5]]);
};

type UvPt = { u: number; v: number; p: V3 };
type Climbed = UvPt & { s: number; atRect: boolean; left: boolean };
/** body plochy v rovině parametrů + obrys plochy z p-křivek hran (lomené čáry) pro sudo-lichý test */
function faceSampler(oc: OC, face: r.Face) {
  const uv = oc.BRepTools.UVBounds(face.wrapped, 0, 0, 0, 0) as { UMin: number; UMax: number; VMin: number; VMax: number };
  const u0 = uv.UMin;
  const u1 = uv.UMax;
  const v0 = uv.VMin;
  const v1 = uv.VMax;
  if (![u0, u1, v0, v1].every(Number.isFinite) || !(u1 > u0) || !(v1 > v0)) return null;
  // obrys: všechny hrany plochy v jejich orientaci (švová hrana dvakrát – obě p-křivky). Test „uvnitř“ = paprsek v obecném
  // směru v normované rovině parametrů (krajní bod jádra leží často přesně na hraně obdélníku v = vmax, na přímce, kde leží
  // i hrana čela drátu – vodorovný paprsek by s ní splýval a parita by závisela na šumu p-křivky)
  const su = 1 / (u1 - u0);
  const sv = 1 / (v1 - v0);
  const CA = Math.cos(0.5113);
  const SA = Math.sin(0.5113);
  const rot = (u: number, v: number): [number, number] => {
    const x = (u - u0) * su;
    const y = (v - v0) * sv;
    return [x * CA + y * SA, -x * SA + y * CA];
  };
  const segs: number[] = [];
  const en = oc.TopAbs_ShapeEnum;
  const ex = new oc.TopExp_Explorer(face.wrapped, en.TopAbs_EDGE, en.TopAbs_SHAPE);
  const p2 = new oc.gp_Pnt2d();
  const downcast = (r as unknown as { downcast(s: unknown): { delete(): void } }).downcast;
  try {
    while (ex.More()) {
      const cur = ex.Current();
      const e = downcast(cur);
      const c = new oc.BRepAdaptor_Curve2d(e, face.wrapped);
      try {
        const a = c.FirstParameter();
        const z = c.LastParameter();
        let pu = NaN;
        let pv = NaN;
        for (let k = 0; k <= EDGE_SAMPLES; k++) {
          c.D0(a + ((z - a) * k) / EDGE_SAMPLES, p2);
          const [qu, qv] = rot(p2.X(), p2.Y());
          if (k > 0) segs.push(pu, pv, qu, qv);
          pu = qu;
          pv = qv;
        }
      } finally {
        c.delete();
        e.delete();
        cur.delete();
      }
      ex.Next();
    }
  } finally {
    ex.delete();
    p2.delete();
  }
  const inside = (uu: number, vv: number): boolean => {
    const [u, v] = rot(uu, vv);
    let odd = false;
    for (let k = 0; k < segs.length; k += 4) {
      const au = segs[k];
      const av = segs[k + 1];
      const bu = segs[k + 2];
      const bv = segs[k + 3];
      if (av > v !== bv > v && u < au + ((v - av) * (bu - au)) / (bv - av)) odd = !odd;
    }
    return odd;
  };
  const ad = new oc.BRepAdaptor_Surface(face.wrapped, false);
  const pnt = new oc.gp_Pnt();
  const P = (u: number, v: number): V3 => {
    ad.D0(u, v, pnt);
    return [pnt.X(), pnt.Y(), pnt.Z()];
  };
  const grid: UvPt[] = [];
  for (let i = 0; i <= GRID; i++)
    for (let j = 0; j <= GRID; j++) {
      const u = u0 + ((u1 - u0) * i) / GRID;
      const v = v0 + ((v1 - v0) * j) / GRID;
      grid.push({ u, v, p: P(u, v) });
    }
  const DIRS = [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [-1, -1], [1, -1], [-1, 1]];
  /**
   * Zpřesnění k místnímu maximu `score` v obdélníku parametrů (vzorový krok, půlení). `enough` = skóre, při kterém stačí
   * skončit (bod pro test „leží na ploše?“); `stay` = skončit, jakmile bod plochu opustí (maximum té oblasti je na hraně).
   */
  const climb = (st: UvPt, score: (p: V3) => number, o: { enough?: number; stay?: boolean } = {}): Climbed => {
    let { u, v } = st;
    let best = score(st.p);
    let bp = st.p;
    let hu = (u1 - u0) / GRID;
    let hv = (v1 - v0) / GRID;
    const minU = (u1 - u0) * 1e-10;
    const minV = (v1 - v0) * 1e-10;
    let left = false;
    for (let it = 0; it < 400 && (hu > minU || hv > minV); it++) {
      if (o.enough !== undefined && best >= o.enough) break;
      let moved = false;
      for (const [du, dv] of DIRS) {
        const nu = Math.min(u1, Math.max(u0, u + du * hu));
        const nv = Math.min(v1, Math.max(v0, v + dv * hv));
        if (nu === u && nv === v) continue;
        const q = P(nu, nv);
        const sc = score(q);
        if (sc > best) {
          best = sc;
          bp = q;
          u = nu;
          v = nv;
          moved = true;
          break;
        }
      }
      if (moved && o.stay && !inside(u, v)) {
        left = true;
        break;
      }
      if (!moved) {
        hu /= 2;
        hv /= 2;
      }
    }
    const eu = (u1 - u0) * 1e-9;
    const evv = (v1 - v0) * 1e-9;
    return { u, v, p: bp, s: best, left, atRect: u - u0 < eu || u1 - u < eu || v - v0 < evv || v1 - v < evv };
  };
  return {
    grid,
    inside,
    climb,
    done: () => {
      pnt.delete();
      ad.delete();
    },
  };
}

/**
 * Ověří stranu `k` (0–2 min x/y/z, 3–5 max) kvádru jádra `fb` ořezané volné plochy (viz výše). Vrací opravenou hodnotu,
 * nebo null, když kvádr jádra platí (krajní bod leží na ploše) nebo se ověřit nedá.
 */
function verifySide(sm: NonNullable<ReturnType<typeof faceSampler>>, fb: B6, eb: B6, k: number, conf: number, ins: () => UvPt[]): number | null {
  const i = k % 3;
  const s = k < 3 ? -1 : 1;
  const score = (p: V3) => s * p[i];
  const want = s * fb[k];
  let g = sm.grid[0];
  for (const q of sm.grid) if (score(q.p) > score(g.p)) g = q;
  const top = sm.climb(g, score, { enough: want - conf / 2 });
  if (top.s < want - conf) return null; // krajní bod jádra se nenašel – kvádr jádra zůstává
  if (sm.inside(top.u, top.v)) return null; // krajní bod leží na ploše
  // na ploše: hrany + vnitřní místní maxima (zpřesnění z nejlepších bodů mřížky uvnitř plochy, dokud v ní zůstávají)
  let bound = s * eb[k];
  for (const st of [...ins()].sort((x, y) => score(y.p) - score(x.p)).slice(0, 4)) {
    const q = sm.climb(st, score, { stay: true });
    if (!q.left && !q.atRect && sm.inside(q.u, q.v) && q.s > bound) bound = q.s;
  }
  return s * Math.min(bound, want);
}

const isFreeTrimmed = (oc: OC, f: r.Face): boolean => {
  if (!FREE_TYPES.has(f.geomType)) return false;
  try {
    return !oc.BRep_Tool.NaturalRestriction(f.wrapped);
  } catch {
    return false;
  }
};

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
  const free = faces.length && faces.length <= FREE_MAX_FACES ? faces.map((f) => isFreeTrimmed(oc, f)) : [];
  if (!torus.some(Boolean) && !free.some(Boolean)) growOptimal(oc, shape.wrapped, b);
  else {
    const cands: Candidate[] = [];
    // volné plochy až po ostatních: jejich hrany a ostatní plochy dají „jistý“ kvádr, ověřují se jen strany, které ho přesahují
    const pending: { face: r.Face; fb: B6; eb: B6 }[] = [];
    faces.forEach((f, i) => {
      if (torus[i]) growTorusFace(oc, f, b, cands);
      else if (free[i]) {
        const fb = boxOf(oc, f.wrapped);
        const eb = empty();
        for (const e of f.edges) growOptimal(oc, e.wrapped, eb);
        growBox(b, eb);
        pending.push({ face: f, fb, eb });
      } else growOptimal(oc, f.wrapped, b);
    });
    let budget = FREE_BUDGET;
    for (const { face, fb, eb } of pending) {
      if (!Number.isFinite(fb[0])) continue;
      const diag = Math.hypot(fb[3] - fb[0], fb[4] - fb[1], fb[5] - fb[2]);
      const tol = diag * 1e-7 + 1e-9;
      const out = fb.slice() as B6;
      const sides: number[] = [];
      if (Number.isFinite(eb[0]))
        for (let k = 0; k < 6; k++) {
          const s = k < 3 ? -1 : 1;
          // přesahuje kvádr jádra hrany plochy i dosavadní kvádr? (jinak na straně nezáleží)
          if (s * (fb[k] - eb[k]) > tol && s * (fb[k] - b[k]) > tol) sides.push(k);
        }
      if (sides.length && budget > 0) {
        let sm: ReturnType<typeof faceSampler> = null;
        try {
          sm = faceSampler(oc, face);
          if (sm) {
            const conf = diag * 1e-4 + 1e-6;
            let ins: UvPt[] | null = null;
            const insideGrid = () => (ins ??= sm!.grid.filter((q) => sm!.inside(q.u, q.v)));
            for (const k of sides) {
              if (budget-- <= 0) break;
              const fixed = verifySide(sm, fb, eb, k, conf, insideGrid);
              if (fixed !== null) out[k] = fixed;
            }
          }
        } catch {
          /* ověření se nepovedlo – kvádr jádra */
        } finally {
          sm?.done();
        }
      }
      growBox(b, out);
    }
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
