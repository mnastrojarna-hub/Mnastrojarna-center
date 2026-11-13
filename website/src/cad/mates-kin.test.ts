import { describe, expect, it } from "vitest";
import { apply3, rotMatrix, transformPoint } from "./assembly";
import { MATE_LABEL, residual, solveMates, worldGeo, type FaceGeo, type GeoProvider } from "./mates";
import { KIN_TYPES, closestOnTri, curveNearest, meshSignedDistance, perpOf, wrap } from "./mates-kin";
import { motionCsv, motorValue, runMotion } from "./motion";
import { emptyDoc, type AsmComponent, type CadDoc, type Mate, type MateRef, type MotionStudy, type Placement, type Vec3 } from "./types";

/* ───────── pomocné: syntetická geometrie komponent (souřadnice komponenty) ───────── */
type Geos = Record<string, Record<string, FaceGeo>>;
const key = (r: MateRef) => `${r.ent === "edge" ? "e" : r.ent === "vertex" ? "v" : "f"}${r.face}`;
const provider = (G: Geos): GeoProvider => (r) => G[r.compId]?.[key(r)] ?? null;
const P = (position: Vec3 = [0, 0, 0], rotation: Vec3 = [0, 0, 0]): Placement => ({ position, rotation });
const comp = (id: string, placement: Placement, fixed = false): AsmComponent => ({ id, name: id, source: { kind: "part", doc: emptyDoc(id) }, placement, ...(fixed ? { fixed: true } : {}) });
const asm = (comps: AsmComponent[], mates: Mate[]): CadDoc => ({ ...emptyDoc("T"), kind: "assembly", components: comps, mates });
const f = (compId: string, face: number): MateRef => ({ compId, face });
const e = (compId: string, face: number): MateRef => ({ compId, face, ent: "edge" });
const v = (compId: string, face: number): MateRef => ({ compId, face, ent: "vertex" });
const plane = (origin: Vec3, normal: Vec3): FaceGeo => ({ kind: "plane", origin, normal });
const cyl = (origin: Vec3, normal: Vec3, radius: number): FaceGeo => ({ kind: "cylinder", origin, normal, radius });
const sph = (origin: Vec3, radius: number): FaceGeo => ({ kind: "sphere", origin, normal: [0, 0, 1], radius });
const pt = (origin: Vec3): FaceGeo => ({ kind: "point", origin, normal: [0, 0, 1] });
const at = (r: ReturnType<typeof solveMates>, id: string) => r.components.find((c) => c.id === id)!.placement;
const world = (pl: Placement, p: Vec3) => transformPoint(pl, p);
const dir = (pl: Placement, n: Vec3) => apply3(rotMatrix(pl.rotation), n);
const dot = (a: Vec3, b: Vec3) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const dist = (a: Vec3, b: Vec3) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
/** natočení komponenty kolem Z (rad) z umístění */
const spinZ = (pl: Placement) => {
  const x = dir(pl, [1, 0, 0]);
  return Math.atan2(x[1], x[0]);
};

describe("vazby sestavy – 23 druhů", () => {
  it("má aspoň 18 druhů vazeb s popisky", () => {
    expect(Object.keys(MATE_LABEL).length).toBeGreaterThanOrEqual(18);
    expect(Object.keys(MATE_LABEL).length).toBe(23);
    expect(KIN_TYPES.size).toBe(16);
  });
  it("Kolmo: normála A kolmo na normálu B", () => {
    const G: Geos = { B: { f0: plane([0, 0, 0], [0, 0, 1]) }, A: { f0: plane([0, 0, 0], [0, 0, 1]) } };
    const r = solveMates(asm([comp("B", P(), true), comp("A", P([10, 0, 0], [10, 20, 0]))], [{ id: "m", type: "perpendicular", a: f("A", 0), b: f("B", 0) }]), provider(G));
    expect(r.status.m).toBe("ok");
    expect(Math.abs(dot(dir(at(r, "A"), [0, 0, 1]), [0, 0, 1]))).toBeLessThan(1e-7);
  });
  it("Tečně: válec na rovině, válec na válci (vně i uvnitř), koule na kouli a na rovině", () => {
    const G: Geos = { B: { f0: plane([0, 0, 0], [0, 0, 1]), f1: cyl([0, 0, 0], [0, 0, 1], 10), f2: sph([0, 0, 0], 4) }, A: { f0: cyl([0, 0, 0], [1, 0, 0], 5), f1: cyl([0, 0, 0], [0, 0, 1], 5), f2: sph([0, 0, 0], 3) } };
    const solve = (m: Mate, p: Placement) => solveMates(asm([comp("B", P(), true), comp("A", p)], [m]), provider(G));
    let r = solve({ id: "m", type: "tangent", a: f("A", 0), b: f("B", 0) }, P([3, 4, 20]));
    expect(r.status.m).toBe("ok");
    expect(world(at(r, "A"), [0, 0, 0])[2]).toBeCloseTo(5, 6); // osa válce 5 mm nad rovinou
    expect(Math.abs(dir(at(r, "A"), [1, 0, 0])[2])).toBeLessThan(1e-7); // osa rovnoběžně s rovinou
    r = solve({ id: "m", type: "tangent", a: f("A", 1), b: f("B", 1) }, P([40, 0, 0]));
    expect(Math.hypot(...world(at(r, "A"), [0, 0, 0]).slice(0, 2))).toBeCloseTo(15, 6);
    r = solve({ id: "m", type: "tangent", a: f("A", 1), b: f("B", 1), flip: true }, P([40, 0, 0]));
    expect(Math.hypot(...world(at(r, "A"), [0, 0, 0]).slice(0, 2))).toBeCloseTo(5, 6); // vnitřní dotyk |10 − 5|
    r = solve({ id: "m", type: "tangent", a: f("A", 2), b: f("B", 2) }, P([20, 5, 1]));
    expect(dist(world(at(r, "A"), [0, 0, 0]), [0, 0, 0])).toBeCloseTo(7, 6);
    r = solve({ id: "m", type: "tangent", a: f("A", 2), b: f("B", 0) }, P([20, 5, 9]));
    expect(world(at(r, "A"), [0, 0, 0])[2]).toBeCloseTo(3, 6);
    expect(r.status.m).toBe("ok");
  });
  it("Shodně: vrchol na vrchol, vrchol na rovinu, vrchol na osu", () => {
    const G: Geos = { B: { v0: pt([10, 10, 10]), f0: plane([0, 0, 2], [0, 0, 1]), f1: cyl([5, 5, 0], [0, 0, 1], 2) }, A: { v0: pt([1, 2, 3]) } };
    const solve = (b: MateRef) => solveMates(asm([comp("B", P(), true), comp("A", P([30, -4, 7], [0, 0, 30]))], [{ id: "m", type: "coincident", a: v("A", 0), b }]), provider(G));
    let r = solve(v("B", 0));
    expect(dist(world(at(r, "A"), [1, 2, 3]), [10, 10, 10])).toBeLessThan(2e-6); // polohy se ukládají na 1e-6 mm
    r = solve(f("B", 0));
    expect(world(at(r, "A"), [1, 2, 3])[2]).toBeCloseTo(2, 5);
    r = solve(f("B", 1));
    const p = world(at(r, "A"), [1, 2, 3]);
    expect(Math.hypot(p[0] - 5, p[1] - 5)).toBeLessThan(2e-6);
    expect(r.status.m).toBe("ok");
  });
  it("Symetricky: plocha A je zrcadlem plochy B podle roviny souměrnosti", () => {
    const G: Geos = { B: { f0: plane([-20, 0, 0], [-1, 0, 0]), f1: plane([0, 0, 0], [1, 0, 0]) }, A: { f0: plane([5, 0, 0], [1, 0, 0]) } };
    const r = solveMates(asm([comp("B", P(), true), comp("A", P([3, 0, 0]))], [{ id: "m", type: "symmetric", a: f("A", 0), b: f("B", 0), c: f("B", 1) }]), provider(G));
    expect(r.status.m).toBe("ok");
    expect(world(at(r, "A"), [5, 0, 0])[0]).toBeCloseTo(20, 6);
  });
  it("Šířka: jazýček uprostřed drážky (rovinný i válcový)", () => {
    const G: Geos = { B: { f0: plane([0, 0, 0], [1, 0, 0]), f1: plane([30, 0, 0], [-1, 0, 0]) }, A: { f0: plane([0, 0, 0], [-1, 0, 0]), f1: plane([10, 0, 0], [1, 0, 0]), f2: cyl([0, 0, 0], [0, 1, 0], 3) } };
    let r = solveMates(asm([comp("B", P(), true), comp("A", P([50, 2, 0]))], [{ id: "m", type: "width", a: f("A", 0), c: f("A", 1), b: f("B", 0), d: f("B", 1) }]), provider(G));
    expect(r.status.m).toBe("ok");
    expect(at(r, "A").position[0]).toBeCloseTo(10, 6); // střed jazýčku x = 15
    r = solveMates(asm([comp("B", P(), true), comp("A", P([50, 2, 0]))], [{ id: "m", type: "width", a: f("A", 2), b: f("B", 0), d: f("B", 1) }]), provider(G));
    expect(world(at(r, "A"), [0, 0, 0])[0]).toBeCloseTo(15, 6);
  });
  it("Dráha: bod na kružnici a na úsečce (s omezením na délku hrany)", () => {
    const G: Geos = { B: { e0: { kind: "circle", origin: [0, 0, 0], normal: [0, 0, 1], radius: 20 }, e1: { kind: "line", origin: [0, 0, 0], normal: [1, 0, 0], pts: [[0, 0, 0], [50, 0, 0]] } }, A: { v0: pt([0, 0, 0]) } };
    let r = solveMates(asm([comp("B", P(), true), comp("A", P([5, 5, 3]))], [{ id: "m", type: "path", a: v("A", 0), b: e("B", 0) }]), provider(G));
    const p = world(at(r, "A"), [0, 0, 0]);
    expect(Math.hypot(p[0], p[1])).toBeCloseTo(20, 5);
    expect(p[2]).toBeCloseTo(0, 5);
    expect(Math.atan2(p[1], p[0])).toBeCloseTo(Math.PI / 4, 6); // nejbližší bod (směr se zachová)
    r = solveMates(asm([comp("B", P(), true), comp("A", P([70, 3, 0]))], [{ id: "m", type: "path", a: v("A", 0), b: e("B", 1) }]), provider(G));
    expect(at(r, "A").position).toEqual([50, 0, 0]);
  });
  it("Drážka: čep v drážce – volně mezi konci, za koncem se zastaví, `value` = poloha", () => {
    const G: Geos = { B: { f0: cyl([0, 0, 0], [0, 0, 1], 4), f1: cyl([40, 0, 0], [0, 0, 1], 4) }, A: { f0: cyl([0, 0, 0], [0, 0, 1], 4) } };
    const m: Mate = { id: "m", type: "slot", a: f("A", 0), b: f("B", 0), c: f("B", 1) };
    let r = solveMates(asm([comp("B", P(), true), comp("A", P([20, 7, 5]))], [m]), provider(G));
    expect(at(r, "A").position).toEqual([20, 0, 5]);
    r = solveMates(asm([comp("B", P(), true), comp("A", P([60, 3, 0]))], [m]), provider(G));
    expect(at(r, "A").position[0]).toBeCloseTo(40, 6);
    r = solveMates(asm([comp("B", P(), true), comp("A", P([20, 3, 0]))], [{ ...m, value: 12.5 }]), provider(G));
    expect(at(r, "A").position[0]).toBeCloseTo(12.5, 6);
    expect(r.status.m).toBe("ok");
  });
  it("Závěs: souosost + osová poloha (zachycená, nebo dosedací roviny)", () => {
    const G: Geos = { B: { f0: cyl([10, 10, 0], [0, 0, 1], 3), f1: plane([0, 0, 0], [0, 0, 1]) }, A: { f0: cyl([0, 0, 0], [0, 0, 1], 3), f1: plane([0, 0, -2], [0, 0, -1]) } };
    let r = solveMates(asm([comp("B", P(), true), comp("A", P([0, 0, 5]))], [{ id: "m", type: "hinge", a: f("A", 0), b: f("B", 0) }]), provider(G));
    expect(at(r, "A").position).toEqual([10, 10, 5]);
    expect(r.mates?.[0].phase).toEqual([5]);
    r = solveMates(asm([comp("B", P(), true), comp("A", P([0, 0, 5]))], [{ id: "m", type: "hinge", a: f("A", 0), b: f("B", 0), c: f("A", 1), d: f("B", 1) }]), provider(G));
    expect(at(r, "A").position).toEqual([10, 10, 2]);
    expect(r.status.m).toBe("ok");
  });
  it("Zámek: komponenta drží polohu vůči druhé (posun kotvy ji přenese)", () => {
    const d = asm([comp("B", P([0, 0, 0])), comp("A", P([10, 5, 0], [0, 0, 30]))], [{ id: "m", type: "lock", a: { compId: "A", face: -1 }, b: { compId: "B", face: -1 } }]);
    const r0 = solveMates(d, provider({}));
    const locked = { ...d, mates: r0.mates, components: d.components!.map((c) => (c.id === "B" ? { ...c, placement: P([100, 0, 0], [0, 0, 90]) } : c)) };
    const r = solveMates(locked, provider({}), "B");
    expect(r.status.m).toBe("ok");
    expect(dist(at(r, "A").position, [95, 10, 0])).toBeLessThan(1e-6); // (10,5) otočeno o 90° = (−5,10)
    expect(at(r, "A").rotation[2]).toBeCloseTo(120, 6);
  });
  it("Mez vzdálenosti a Mez úhlu: uvnitř mezí beze změny, mimo se vrátí na mez", () => {
    const G: Geos = { B: { f0: plane([0, 0, 0], [0, 0, 1]) }, A: { f0: plane([0, 0, 0], [0, 0, -1]), f1: plane([0, 0, 0], [1, 0, 0]) } };
    const md: Mate = { id: "m", type: "limitDistance", a: f("A", 0), b: f("B", 0), min: 0, max: 30 };
    let r = solveMates(asm([comp("B", P(), true), comp("A", P([1, 2, 10]))], [md]), provider(G));
    expect(r.moved).toEqual([]);
    r = solveMates(asm([comp("B", P(), true), comp("A", P([1, 2, 50]))], [md]), provider(G));
    expect(at(r, "A").position[2]).toBeCloseTo(30, 6);
    r = solveMates(asm([comp("B", P(), true), comp("A", P([1, 2, -8]))], [md]), provider(G));
    expect(at(r, "A").position[2]).toBeCloseTo(0, 6);
    const ma: Mate = { id: "m", type: "limitAngle", a: f("A", 1), b: f("B", 0), min: 60, max: 120 };
    r = solveMates(asm([comp("B", P(), true), comp("A", P([0, 0, 0], [0, 10, 0]))], [ma]), provider(G));
    expect(r.moved).toEqual([]); // osa X natočená o 10° kolem Y → úhel s +Z = 100°
    r = solveMates(asm([comp("B", P(), true), comp("A", P([0, 0, 0], [0, 50, 0]))], [ma]), provider(G));
    const ang = (Math.acos(dot(dir(at(r, "A"), [1, 0, 0]), [0, 0, 1])) * 180) / Math.PI;
    expect(ang).toBeCloseTo(120, 5);
    expect(r.status.m).toBe("ok");
  });
  it("Ozubení: pootočení kola A (kotva) natočí kolo B v poměru (statické řešení)", () => {
    const G: Geos = { F: { f0: cyl([0, 0, 0], [0, 0, 1], 5), f1: cyl([30, 0, 0], [0, 0, 1], 5) }, A: { f0: cyl([0, 0, 0], [0, 0, 1], 5) }, B: { f0: cyl([0, 0, 0], [0, 0, 1], 5) } };
    const mates: Mate[] = [
      { id: "h1", type: "hinge", a: f("A", 0), b: f("F", 0) },
      { id: "h2", type: "hinge", a: f("B", 0), b: f("F", 1) },
      { id: "g", type: "gear", a: f("A", 0), b: f("B", 0), value: 2 },
    ];
    const d = asm([comp("F", P(), true), comp("A", P()), comp("B", P([30, 0, 0]))], mates);
    const r0 = solveMates(d, provider(G));
    expect(r0.status.g).toBe("ok");
    const d1 = { ...d, mates: r0.mates, components: r0.components.map((c) => (c.id === "A" ? { ...c, placement: P([0, 0, 0], [0, 0, 60]) } : c)) };
    const r = solveMates(d1, provider(G), "A");
    expect(r.status.g).toBe("ok");
    expect((spinZ(at(r, "B")) * 180) / Math.PI).toBeCloseTo(-30, 5);
    expect(dist(at(r, "B").position, [30, 0, 0])).toBeLessThan(1e-6);
  });
  it("původní vazby se řeší přesně jako dřív (bez pokročilých vazeb se nespouští globální řešič)", () => {
    const G: Geos = { B: { f0: plane([0, 0, 5], [0, 0, 1]) }, A: { f1: plane([0, 0, -5], [0, 0, -1]) } };
    const m: Mate = { id: "m", type: "mate", a: f("A", 1), b: f("B", 0) };
    const r = solveMates(asm([comp("B", P(), true), comp("A", P([37, 11, 5]))], [m]), provider(G));
    expect(r.components[1].placement.position).toEqual([37, 11, 10]);
    expect(r.components[1].placement.rotation.map((x) => Math.abs(x))).toEqual([0, 0, 0]);
    expect(r.mates).toBeUndefined();
    expect(residual(m, worldGeo(at(r, "A"), G.A.f1), worldGeo(at(r, "B"), G.B.f0))).toBeLessThan(1e-9);
  });
});

describe("geometrie: nejbližší body", () => {
  it("trojúhelník, křivka, znaménková vzdálenost od sítě", () => {
    expect(dist(closestOnTri([0.2, 0.2, 5], [0, 0, 0], [1, 0, 0], [0, 1, 0]), [0.2, 0.2, 0])).toBeLessThan(1e-12);
    expect(dist(closestOnTri([2, 2, 0], [0, 0, 0], [1, 0, 0], [0, 1, 0]), [0.5, 0.5, 0])).toBeLessThan(1e-12);
    expect(curveNearest({ kind: "curve", origin: [0, 0, 0], normal: [0, 0, 1], pts: [[0, 0, 0], [10, 0, 0], [10, 10, 0]] }, [12, 4, 0])).toEqual({ q: [10, 4, 0], s: 14 });
    const cube = cubeMesh(10);
    expect(meshSignedDistance(cube, [0, 0, 8])).toBeCloseTo(3, 9);
    expect(meshSignedDistance(cube, [0, 0, 4])).toBeCloseTo(-1, 9);
    expect(wrap(3 * Math.PI)).toBeCloseTo(Math.PI, 12);
    const n: Vec3 = [0.6, 0, 0.8];
    expect(dot(perpOf(n), n)).toBeCloseTo(0, 12);
  });
});

/** krychle 2a×… se středem v počátku jako síť s vnějšími normálami */
function cubeMesh(a: number): FaceGeo {
  const h = a / 2;
  const pts: Vec3[] = [];
  const tris: number[] = [];
  const nrm: Vec3[] = [];
  const quad = (c: Vec3[], n: Vec3) => {
    const b = pts.length;
    pts.push(...c);
    nrm.push(n, n, n, n);
    tris.push(b, b + 1, b + 2, b, b + 2, b + 3);
  };
  quad([[-h, -h, h], [h, -h, h], [h, h, h], [-h, h, h]], [0, 0, 1]);
  quad([[-h, -h, -h], [-h, h, -h], [h, h, -h], [h, -h, -h]], [0, 0, -1]);
  quad([[h, -h, -h], [h, h, -h], [h, h, h], [h, -h, h]], [1, 0, 0]);
  quad([[-h, -h, -h], [-h, -h, h], [-h, h, h], [-h, h, -h]], [-1, 0, 0]);
  quad([[-h, h, -h], [-h, h, h], [h, h, h], [h, h, -h]], [0, 1, 0]);
  quad([[-h, -h, -h], [h, -h, -h], [h, -h, h], [-h, -h, h]], [0, -1, 0]);
  return { kind: "other", origin: [0, 0, 0], normal: [0, 0, 1], pts, tris, nrm };
}

/** boční plocha válce (kruhová vačka) jako síť: střed `c`, poloměr `r`, výška z0…z1, `n` segmentů */
function cylMesh(c: Vec3, r: number, z0: number, z1: number, n: number): FaceGeo {
  const pts: Vec3[] = [];
  const nrm: Vec3[] = [];
  const tris: number[] = [];
  for (let i = 0; i < n; i++) {
    const a = (2 * Math.PI * i) / n;
    const u: Vec3 = [Math.cos(a), Math.sin(a), 0];
    pts.push([c[0] + r * u[0], c[1] + r * u[1], z0], [c[0] + r * u[0], c[1] + r * u[1], z1]);
    nrm.push(u, u);
  }
  for (let i = 0; i < n; i++) {
    const j = (i + 1) % n;
    tris.push(2 * i, 2 * j, 2 * j + 1, 2 * i, 2 * j + 1, 2 * i + 1);
  }
  return { kind: "other", origin: c, normal: [0, 0, 1], pts, tris, nrm };
}

const study = (motors: MotionStudy["motors"], steps: number, extra: Partial<MotionStudy> = {}): MotionStudy => ({ motors, duration: 1, steps, ...extra });

describe("pohybová studie – známá kinematika", () => {
  it("klika – ojnice – píst: poloha pístu odpovídá analytickému vzorci ve všech krocích (73 kroků po 5°)", async () => {
    const r = 20;
    const l = 60;
    const G: Geos = {
      F: { f0: cyl([0, 0, 0], [0, 0, 1], 5), f1: plane([0, 0, 0], [0, 1, 0]), f2: plane([0, 0, 0], [0, 0, 1]) },
      K: { f0: cyl([0, 0, 0], [0, 0, 1], 5), f1: cyl([r, 0, 0], [0, 0, 1], 3), f2: plane([0, 0, 0], [0, 0, -1]) },
      O: { f0: cyl([0, 0, 0], [0, 0, 1], 3), f1: cyl([l, 0, 0], [0, 0, 1], 3) },
      S: { f0: cyl([0, 0, 0], [0, 0, 1], 3), f1: plane([0, 0, 0], [0, 1, 0]), f2: plane([0, 0, 0], [0, 0, -1]) },
    };
    const mates: Mate[] = [
      { id: "hinge", type: "hinge", a: f("K", 0), b: f("F", 0), c: f("K", 2), d: f("F", 2) },
      { id: "c1", type: "concentric", a: f("O", 0), b: f("K", 1) },
      { id: "c2", type: "concentric", a: f("O", 1), b: f("S", 0) },
      { id: "g1", type: "flush", a: f("S", 1), b: f("F", 1) },
      { id: "g2", type: "mate", a: f("S", 2), b: f("F", 2) },
    ];
    const d = asm([comp("F", P(), true), comp("K", P()), comp("O", P([r, 0, 0])), comp("S", P([r + l, 0, 0]))], mates);
    const res = await runMotion(d, provider(G), study([{ id: "mo", kind: "rotary", mate: "hinge", from: 0, to: 360 }], 72));
    expect(res.steps.length).toBe(73);
    expect(res.conflictSteps).toBe(0);
    let worst = 0;
    for (const s of res.steps) {
      const th = (s.motors[0] * Math.PI) / 180;
      const x = r * Math.cos(th) + Math.sqrt(l * l - r * r * Math.sin(th) ** 2);
      worst = Math.max(worst, Math.abs(s.place.S.position[0] - x), Math.abs(s.place.S.position[1]));
      expect(Math.abs(wrap(spinZ(s.place.K) - th))).toBeLessThan(1e-6);
    }
    expect(worst).toBeLessThan(1e-6);
    const csv = motionCsv(res, d);
    expect(csv.split("\r\n").length).toBe(75);
    expect(csv).toMatch(/^﻿Krok;Čas \[s\];Motor 1 \[°\];F X;/);
  });
  it("ozubená kola: poměr 2 přesně (A 0…720°, B −360°), vnitřní ozubení stejný smysl", async () => {
    const G: Geos = { F: { f0: cyl([0, 0, 0], [0, 0, 1], 5), f1: cyl([30, 0, 0], [0, 0, 1], 5) }, A: { f0: cyl([0, 0, 0], [0, 0, 1], 10) }, B: { f0: cyl([0, 0, 0], [0, 0, 1], 20) } };
    for (const flip of [false, true]) {
      const mates: Mate[] = [
        { id: "h1", type: "hinge", a: f("A", 0), b: f("F", 0) },
        { id: "h2", type: "hinge", a: f("B", 0), b: f("F", 1) },
        { id: "g", type: "gear", a: f("A", 0), b: f("B", 0), value: 2, flip },
      ];
      const d = asm([comp("F", P(), true), comp("A", P()), comp("B", P([30, 0, 0]))], mates);
      const res = await runMotion(d, provider(G), study([{ id: "mo", kind: "rotary", mate: "h1", from: 0, to: 720 }], 144));
      expect(res.conflictSteps).toBe(0);
      for (const s of res.steps) {
        const a = (s.motors[0] * Math.PI) / 180;
        expect(Math.abs(wrap(spinZ(s.place.B) - (flip ? 1 : -1) * (a / 2)))).toBeLessThan(1e-7);
        expect(Math.abs(wrap(spinZ(s.place.A) - a))).toBeLessThan(1e-7);
      }
    }
  });
  it("šroub: stoupání 1,5 – 3 otáčky matice = posuv 4,5 mm; levý závit opačně", async () => {
    const G: Geos = { S: { f0: cyl([0, 0, 0], [0, 0, 1], 4) }, M: { f0: cyl([0, 0, 0], [0, 0, 1], 4) } };
    for (const flip of [false, true]) {
      const d = asm([comp("S", P(), true), comp("M", P([0, 0, 10]))], [{ id: "s", type: "screw", a: f("M", 0), b: f("S", 0), value: 1.5, flip }]);
      const res = await runMotion(d, provider(G), study([{ id: "mo", kind: "rotary", mate: "s", from: 0, to: 1080 }], 108));
      expect(res.conflictSteps).toBe(0);
      for (const s of res.steps) expect(s.place.M.position[2]).toBeCloseTo(10 + (flip ? -1 : 1) * 1.5 * (s.motors[0] / 360), 7);
      expect(res.steps[108].place.M.position[2]).toBeCloseTo(flip ? 5.5 : 14.5, 7);
    }
  });
  it("hřeben a pastorek: posuv hřebenu = π·d na otáčku pastorku", async () => {
    const d0 = 24;
    const G: Geos = {
      F: { f0: cyl([0, 0, 0], [0, 0, 1], 5), f1: plane([0, -12, 0], [0, 1, 0]), f2: plane([0, 0, -5], [0, 0, 1]) },
      A: { f0: cyl([0, 0, 0], [0, 0, 1], 12) },
      R: { f0: plane([0, 0, 0], [0, 1, 0]), f1: plane([0, -5, 0], [0, -1, 0]), f2: plane([0, 0, -5], [0, 0, -1]) },
    };
    const mates: Mate[] = [
      { id: "h", type: "hinge", a: f("A", 0), b: f("F", 0) },
      { id: "c1", type: "mate", a: f("R", 1), b: f("F", 1) },
      { id: "c2", type: "flush", a: f("R", 2), b: f("F", 2), flip: true },
      { id: "rk", type: "rack", a: f("A", 0), b: f("R", 0), value: Math.PI * d0 },
    ];
    const d = asm([comp("F", P(), true), comp("A", P()), comp("R", P([0, -7, 0]))], mates);
    const res = await runMotion(d, provider(G), study([{ id: "mo", kind: "rotary", mate: "h", from: 0, to: 90 }], 18));
    expect(res.conflictSteps).toBe(0);
    for (const s of res.steps) expect(s.place.R.position[0]).toBeCloseTo((Math.PI * d0 * s.motors[0]) / 360, 6);
    expect(res.steps[18].place.R.position[0]).toBeCloseTo((Math.PI * d0) / 4, 6);
  });
  it("vačka: zdvihátko s rovinnou čelní plochou na excentrické kruhové vačce – zdvih = R + e·sin θ", async () => {
    const R = 20;
    const e0 = 5;
    const G: Geos = {
      F: { f0: cyl([0, 0, 0], [0, 0, 1], 4), f1: cyl([0, 40, 0], [0, 1, 0], 3) },
      C: { f0: cyl([0, 0, 0], [0, 0, 1], 4), f1: cylMesh([e0, 0, 0], R, -5, 5, 1440) },
      Z: { f0: cyl([0, 0, 0], [0, 1, 0], 3), f1: plane([0, 0, 0], [0, -1, 0]) },
    };
    const mates: Mate[] = [
      { id: "h", type: "hinge", a: f("C", 0), b: f("F", 0) },
      { id: "guide", type: "concentric", a: f("Z", 0), b: f("F", 1) },
      { id: "cam", type: "cam", a: f("Z", 1), b: f("C", 1) },
    ];
    const d = asm([comp("F", P(), true), comp("C", P()), comp("Z", P([0, 30, 0]))], mates);
    const res = await runMotion(d, provider(G), study([{ id: "mo", kind: "rotary", mate: "h", from: 0, to: 360 }], 36));
    expect(res.conflictSteps).toBe(0);
    let worst = 0;
    for (const s of res.steps) {
      const th = (s.motors[0] * Math.PI) / 180;
      // opěrná funkce kružnice ve směru +Y: e·sin θ + R (polygon 1440 segmentů → chyba ≤ R·(1 − cos(π/1440)) ≈ 4,8e-5 mm)
      worst = Math.max(worst, Math.abs(s.place.Z.position[1] - (R + e0 * Math.sin(th))));
    }
    expect(worst).toBeLessThan(1e-4);
  });
  it("kardan: tan θ2 = tan θ1 / cos β (hřídele pod úhlem 30°)", async () => {
    const beta = 30;
    const G: Geos = {
      F: { f0: cyl([0, 0, 0], [1, 0, 0], 5), f1: cyl([0, 0, 0], [Math.cos((beta * Math.PI) / 180), Math.sin((beta * Math.PI) / 180), 0], 5) },
      A: { f0: cyl([0, 0, 0], [1, 0, 0], 5) },
      B: { f0: cyl([0, 0, 0], [Math.cos((beta * Math.PI) / 180), Math.sin((beta * Math.PI) / 180), 0], 5) },
    };
    const mates: Mate[] = [
      { id: "h1", type: "hinge", a: f("A", 0), b: f("F", 0) },
      { id: "h2", type: "hinge", a: f("B", 0), b: f("F", 1) },
      { id: "u", type: "universal", a: f("A", 0), b: f("B", 0) },
    ];
    const d = asm([comp("F", P(), true), comp("A", P()), comp("B", P())], mates);
    const res = await runMotion(d, provider(G), study([{ id: "mo", kind: "rotary", mate: "h1", from: 0, to: 360 }], 24));
    expect(res.conflictSteps).toBe(0);
    // natočení výstupu vůči výchozí poloze z rotačního stupně volnosti Závěsu h2
    const b0 = res.steps[0].place.B;
    for (const s of res.steps) {
      const t1 = (s.motors[0] * Math.PI) / 180;
      const want = Math.atan2(Math.sin(t1), Math.cos(t1) * Math.cos((beta * Math.PI) / 180));
      const axis: Vec3 = [Math.cos((beta * Math.PI) / 180), Math.sin((beta * Math.PI) / 180), 0];
      const y0 = dir(b0, [0, 0, 1]);
      const y = dir(s.place.B, [0, 0, 1]);
      const got = Math.atan2(dot(cross3(y0, y), axis), dot(y0, y));
      expect(Math.abs(wrap(got - want))).toBeLessThan(1e-6);
    }
  });
  it("lineární motor na Vzdálenosti a na Dráze; rychlost motoru", async () => {
    const G: Geos = { B: { f0: plane([0, 0, 0], [0, 0, 1]), e0: { kind: "circle", origin: [0, 0, 0], normal: [0, 0, 1], radius: 10 } }, A: { f0: plane([0, 0, 0], [0, 0, -1]), v0: pt([0, 0, 0]) } };
    let d = asm([comp("B", P(), true), comp("A", P([0, 0, 5]))], [{ id: "dm", type: "distance", a: f("A", 0), b: f("B", 0), value: 5 }]);
    let res = await runMotion(d, provider(G), study([{ id: "mo", kind: "linear", mate: "dm", from: 5, to: 25 }], 4));
    expect(res.steps.map((s) => s.place.A.position[2])).toEqual([5, 10, 15, 20, 25]);
    d = asm([comp("B", P(), true), comp("A", P([10, 0, 0]))], [{ id: "p", type: "path", a: v("A", 0), b: e("B", 0) }]);
    res = await runMotion(d, provider(G), study([{ id: "mo", kind: "linear", mate: "p", from: 0, to: (Math.PI * 10) / 2 }], 6));
    const end = res.steps[6].place.A.position;
    expect(end[0]).toBeCloseTo(0, 6);
    expect(end[1]).toBeCloseTo(10, 6);
    expect(motorValue({ id: "x", kind: "rotary", mate: "h", from: 0, to: 0, speed: 60 }, 5, 10, 2)).toBeCloseTo(360, 9);
    expect(motorValue({ id: "x", kind: "linear", mate: "h", from: 2, to: 0, speed: 10 }, 10, 10, 2)).toBeCloseTo(22, 9);
  });
  it("kolize v krocích a stopa bodu", async () => {
    const G: Geos = { F: { f0: cyl([0, 0, 0], [0, 0, 1], 5) }, K: { f0: cyl([0, 0, 0], [0, 0, 1], 5) } };
    const d = asm([comp("F", P(), true), comp("K", P())], [{ id: "h", type: "hinge", a: f("K", 0), b: f("F", 0) }]);
    const res = await runMotion(d, provider(G), study([{ id: "mo", kind: "rotary", mate: "h", from: 0, to: 180 }], 6, { collisions: true, trace: { compId: "K", point: [10, 0, 0] } }), {
      collide: async (doc) => {
        const k = doc.components!.find((c) => c.id === "K")!;
        return spinZ(k.placement) > Math.PI / 2 - 1e-9 ? [{ a: "K", b: "F", volume: 1 }] : [];
      },
    });
    expect(res.collision).toMatchObject({ step: 3, a: "K", b: "F" });
    expect(res.collision!.t).toBeCloseTo(0.5, 9);
    expect(res.steps[3].trace![0]).toBeCloseTo(0, 6);
    expect(res.steps[3].trace![1]).toBeCloseTo(10, 6);
  });
  it("chyby: motor na nevhodné vazbě, studie bez motoru", async () => {
    const d = asm([comp("F", P(), true), comp("K", P())], [{ id: "par", type: "parallel", a: f("K", 0), b: f("F", 0) }]);
    await expect(runMotion(d, provider({}), study([{ id: "mo", kind: "rotary", mate: "par", from: 0, to: 90 }], 4))).rejects.toThrow(/Souosost, Závěs nebo Šroub/);
    await expect(runMotion(d, provider({}), study([], 4))).rejects.toThrow(/žádný motor/);
  });
});

const cross3 = (a: Vec3, b: Vec3): Vec3 => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
