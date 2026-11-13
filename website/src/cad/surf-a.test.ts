import path from "node:path";
import { beforeAll, describe, expect, it } from "vitest";
import * as r from "replicad";
import opencascade from "replicad-opencascadejs";
import { blendSurface, continuityReport, curvatureCombs, cvEdit, cvInfo, edgeContinuity, extensionStrip, facesAtEdge, nSidedFill } from "./surf-a";
import type { Vec3 } from "./types";
import { compoundOf } from "./build";
/** složené těleso bez zániku vstupů (r.makeCompound vstupy maže) */
const comp = (xs: r.AnyShape[]) => compoundOf(xs as r.Shape3D[]) as r.AnyShape;

beforeAll(async () => {
  const oc = await (opencascade as unknown as (o: object) => Promise<unknown>)({
    locateFile: () => path.resolve(__dirname, "../../node_modules/replicad-opencascadejs/dist/replicad_single.wasm"),
    print: () => undefined,
    printErr: () => undefined,
  });
  r.setOC(oc as never);
}, 60_000);

type OC = any;
const oc = () => r.getOC() as OC;
/** plocha vytažením hrany o vektor */
function prism(edge: r.Edge, v: Vec3): r.Face {
  const o = oc();
  const vec = new o.gp_Vec(v[0], v[1], v[2]);
  const mk = new o.BRepPrimAPI_MakePrism(edge.wrapped, vec, false, true);
  const f = r.cast(mk.Shape());
  if (!(f instanceof r.Face)) throw new Error("prism");
  return f;
}
const arc = (c: Vec3, R: number, a0: number, a1: number) => {
  const P = (a: number): Vec3 => [c[0] + R * Math.cos((a * Math.PI) / 180), c[1] + R * Math.sin((a * Math.PI) / 180), c[2]];
  return r.makeThreePointArc(P(a0), P((a0 + a1) / 2), P(a1));
};
/** index hrany tělesa, jejíž střed je nejblíž bodu */
const edgeNear = (body: r.AnyShape, p: Vec3) => {
  let best = -1;
  let bd = Infinity;
  body.edges.forEach((e, i) => {
    const m = e.pointAt(0.5);
    const d = Math.hypot(m.x - p[0], m.y - p[1], m.z - p[2]);
    if (d < bd) {
      bd = d;
      best = i;
    }
  });
  return best;
};
const faceIndexOf = (body: r.AnyShape, f: r.Face) => body.faces.findIndex((x) => x.isSame(f));

describe("plochy třídy A – výplň, přechod, prodloužení, analýza", () => {
  it("N-stranná výplň otvoru v kulové ploše s G1: úhel normál napříč hranou < 0,1°", () => {
    const holed = r.makeSphere(50).cut(r.makeCylinder(15, 100));
    const sphereFace = holed.faces.find((f) => f.geomType === "SPHERE")!;
    const body = comp([sphereFace]);
    const hole = body.edges.map((e, i) => ({ e, i })).filter(({ e }) => e.pointAt(0.5).z > 40).map(({ i }) => i);
    expect(hole.length).toBeGreaterThan(0);
    const res = nSidedFill(body, hole, 1);
    expect(res.supported).toBe(hole.length);
    expect(res.g1).toBeLessThan(0.1);
    // nezávislá kontrola analýzou návaznosti (plochy nejsou sešité → sousedství geometricky)
    const both = comp([comp([sphereFace]).faces[0], res.face]);
    const fillIdx = both.faces.length - 1;
    const fillEdges = both.faces[fillIdx].edges.map((e) => both.edges.findIndex((x) => x.isSame(e)));
    const rep = fillEdges.map((i) => edgeContinuity(both, i));
    expect(rep.every((x) => x.faces.length === 2)).toBe(true);
    expect(Math.max(...rep.map((x) => x.g0))).toBeLessThan(0.01);
    expect(Math.max(...rep.map((x) => x.g1))).toBeLessThan(0.1);
  }, 60_000);

  it("přechod G2 mezi dvěma válcovými pásy: G0, G1 i G2 na obou stranách; G1 přechod G2 nesplní", () => {
    const A = prism(arc([0, 0, 0], 50, 180, 270), [0, 0, 40]);
    const B = prism(arc([100, 0, 0], 50, 270, 360), [0, 0, 40]);
    const body = comp([A, B]);
    const eA = edgeNear(body, [0, -50, 20]);
    const eB = edgeNear(body, [100, -50, 20]);
    const g2 = blendSurface(body, eA, eB, { contA: 2, contB: 2, tensionA: 1, tensionB: 1 });
    const g1 = blendSurface(body, eA, eB, { contA: 1, contB: 1, tensionA: 1, tensionB: 1 });
    const check = (blend: r.Face) => {
      const all = comp([comp([A]).faces[0], comp([B]).faces[0], blend]);
      const bi = all.faces.length - 1;
      const sides = [edgeNear(all, [0, -50, 20]), edgeNear(all, [100, -50, 20])];
      // hrany přechodu, které leží na hranách pásů (geometrické sousedství)
      const be = all.faces[bi].edges.map((e) => all.edges.findIndex((x) => x.isSame(e)));
      return be.map((i) => edgeContinuity(all, i)).filter((c) => c.faces.length === 2 && c.faces.includes(bi) && sides.length);
    };
    const r2 = check(g2);
    expect(r2.length).toBe(2);
    for (const c of r2) {
      expect(c.g0).toBeLessThan(0.01);
      expect(c.g1).toBeLessThan(0.1);
      expect(c.g2).toBeLessThan(1e-3); // křivost napříč 1/50 = 0,02 1/mm
      expect(Math.abs(c.kA)).toBeGreaterThan(0.015);
      expect(c.cls).toBe("G2");
    }
    const r1 = check(g1);
    expect(r1.length).toBe(2);
    for (const c of r1) {
      expect(c.g1).toBeLessThan(0.1);
      expect(c.cls).toBe("G1"); // tečně, ale křivost skáče
    }
    // napětí mění tvar (delší tečna = plocha se víc „drží“ směru)
    // (přechod mezi spodními oblouky pásů – tečny míří dolů, napříč spojnicí, takže napětí mění tvar i plochu)
    const body2 = comp([A, B]);
    const s2 = Math.SQRT1_2 * 50;
    const e2 = [edgeNear(body2, [-s2, -s2, 0]), edgeNear(body2, [100 + s2, -s2, 0])] as const;
    const t1 = blendSurface(body2, e2[0], e2[1], { contA: 1, contB: 1, tensionA: 1, tensionB: 1 });
    const t2 = blendSurface(body2, e2[0], e2[1], { contA: 1, contB: 1, tensionA: 2, tensionB: 2 });
    expect(Math.abs(r.measureArea(t2) - r.measureArea(t1))).toBeGreaterThan(1);
  }, 60_000);

  it("prodloužení válcového pásu G2 sleduje kružnici, G1 je tečné", () => {
    const A = prism(arc([0, 0, 0], 50, 180, 270), [0, 0, 40]);
    const body = comp([A]);
    const e = edgeNear(body, [0, -50, 20]);
    const g2 = extensionStrip(body, e, 10, 2);
    const g1 = extensionStrip(body, e, 10, 1);
    // konec prodloužení: vzdálenost od osy Z (G2 ≈ 50, G1 = √(50² + 10²) = 50,99)
    const far = (f: r.Face) => Math.max(...f.edges.map((x) => x.pointAt(0.5)).map((p) => Math.hypot(p.x, p.y)));
    expect(Math.abs(far(g2.strip) - 50)).toBeLessThan(0.05);
    expect(Math.abs(far(g1.strip) - Math.hypot(50, 10))).toBeLessThan(0.05);
    const all = comp([comp([A]).faces[0], g2.strip]);
    const ec = all.faces[1].edges.map((x) => all.edges.findIndex((y) => y.isSame(x))).map((i) => edgeContinuity(all, i)).filter((c) => c.faces.length === 2);
    expect(ec.length).toBe(1);
    expect(ec[0].cls).toBe("G2");
  }, 60_000);

  it("analýza: hrana krychle G0 (90°), hřebeny kružnice mají konstantní křivost", () => {
    const box = r.makeBox([0, 0, 0], [10, 10, 10]);
    const rep = continuityReport(box);
    expect(rep.length).toBe(12);
    expect(rep.every((c) => c.cls === "G0" && Math.abs(c.g1 - 90) < 1e-6 && c.shared)).toBe(true);
    const cyl = r.makeCylinder(50, 10);
    const circ = cyl.edges.findIndex((e) => e.geomType === "CIRCLE");
    const [comb] = curvatureCombs(cyl, [circ]);
    expect(comb.kMin).toBeCloseTo(0.02, 6);
    expect(comb.kMax).toBeCloseTo(0.02, 6);
    expect(comb.teeth.length).toBe(48);
    // zub míří ven ze středu křivosti
    const [p, q] = comb.teeth[5];
    expect(Math.hypot(q[0], q[1])).toBeGreaterThan(Math.hypot(p[0], p[1]));
    expect(facesAtEdge(box, 0).shared).toBe(true);
  }, 60_000);

  it("CV: rovinná plocha → síť 4×4 (kubická, přesná), posun CV [2,2] o 1,5 mm zvedne plochu o 1,5·(4/9)² = 0,296 mm", () => {
    const sq = r.makeFace(r.assembleWire([r.makeLine([0, 0, 0], [100, 0, 0]), r.makeLine([100, 0, 0], [100, 100, 0]), r.makeLine([100, 100, 0], [0, 100, 0]), r.makeLine([0, 100, 0], [0, 0, 0])]));
    const info = cvInfo(sq, [4, 4]);
    expect([info.nu, info.nv, info.udeg, info.vdeg, info.exact]).toEqual([4, 4, 3, 3, true]);
    const res = cvEdit(sq, [{ i: 2, j: 2, d: [0, 0, 1.5] }], [], [4, 4]);
    const zmax = res.face.boundingBox.bounds[1][2];
    expect(zmax).toBeCloseTo(1.5 * (4 / 9) ** 2, 3);
    // řada: posun celé řady u = 1 o 2 mm zvedne celou hranu u = 0 o 2 mm
    const row = cvEdit(sq, [], [{ dir: "u", index: 1, d: [0, 0, 2] }], [4, 4]);
    expect(row.face.boundingBox.bounds[1][2]).toBeCloseTo(2, 6);
    expect(() => cvEdit(sq, [{ i: 5, j: 1, d: [0, 0, 1] }], [], [4, 4])).toThrow(/1–4/);
    // B-spline plocha (přechod) – CV se berou přesně
    const A = prism(arc([0, 0, 0], 50, 180, 270), [0, 0, 40]);
    const ab = comp([A, prism(arc([100, 0, 0], 50, 270, 360), [0, 0, 40])]);
    const bs = blendSurface(ab, edgeNear(ab, [0, -50, 20]), edgeNear(ab, [100, -50, 20]), { contA: 1, contB: 1, tensionA: 1, tensionB: 1 });
    const bi = cvInfo(bs);
    expect(bi.exact).toBe(true);
    expect(bi.vdeg).toBe(3);
    expect(faceIndexOf(comp([bs]), bs)).toBe(0);
  }, 60_000);
});
