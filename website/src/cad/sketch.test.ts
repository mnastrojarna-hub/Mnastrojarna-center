import { describe, expect, it } from "vitest";
import { entityPath, findLoops, keyPoints, sketchToDxf } from "./sketch";
import { allIntersections, chamferLines, circularPattern, explode, extend, filletLines, linearPattern, offsetEntity, transformEntity, trim, xfMirror } from "./sketch-ops";
import { measureDim, sketchDof, solveSketch } from "./sketch-solver";
import type { SketchConstraint, SketchDim, SketchEntity } from "./types";

const L = (id: string, a: [number, number], b: [number, number]): SketchEntity => ({ id, type: "line", a, b });
const C = (id: string, type: SketchConstraint["type"], refs: [string, string][], value?: number[]): SketchConstraint => ({ id, type, refs: refs.map(([e, k]) => ({ e, k })), value });
const D = (id: string, type: SketchDim["type"], refs: [string, string][], value: number): SketchDim => ({ id, type, refs: refs.map(([e, k]) => ({ e, k })), value, driving: true });
const line = (es: SketchEntity[], id: string) => es.find((e) => e.id === id) as Extract<SketchEntity, { type: "line" }>;

describe("geometrie skici – nové entity", () => {
  it("elipsa a uzavřený spline tvoří profil, pomocná geometrie a body ne", () => {
    const { loops } = findLoops([
      { id: "e", type: "ellipse", cx: 0, cy: 0, rx: 30, ry: 15, angle: 20 },
      { id: "s", type: "spline", points: [[100, 0], [140, 20], [120, 60], [90, 30]], closed: true },
      { id: "k", type: "circle", cx: 0, cy: 0, r: 50, construction: true },
      { id: "p", type: "point", p: [5, 5] },
    ]);
    expect(loops.map((l) => l.sourceIds[0]).sort()).toEqual(["e", "s"]);
  });
  it("otevřený spline + úsečka uzavřou smyčku", () => {
    const { loops } = findLoops([
      { id: "s", type: "spline", points: [[0, 0], [20, 15], [40, 0]], closed: false },
      L("l", [40, 0], [0, 0]),
    ]);
    expect(loops).toHaveLength(1);
  });
  it("cesta spline prochází řídicími body", () => {
    const pts = entityPath({ id: "s", type: "spline", points: [[0, 0], [10, 10], [20, 0]], closed: false }).pts;
    expect(pts[0]).toEqual([0, 0]);
    expect(pts.some((p) => Math.abs(p[0] - 10) < 1e-9 && Math.abs(p[1] - 10) < 1e-9)).toBe(true);
  });
  it("DXF obsahuje bod a vrstvu konstrukce", () => {
    const dxf = sketchToDxf([{ id: "p", type: "point", p: [1, 2] }, { ...L("l", [0, 0], [5, 0]), construction: true }]);
    expect(dxf).toContain("POINT");
    expect(dxf).toContain("KONSTRUKCE");
  });
});

describe("editační operace", () => {
  it("průsečíky a ořez kříže", () => {
    const es = [L("h", [-10, 0], [10, 0]), L("v", [0, -10], [0, 10])];
    expect(allIntersections(es)).toHaveLength(1);
    const t = trim(es, "h", [8, 0])!;
    const h = t.filter((e) => e.id !== "v");
    expect(h).toHaveLength(1);
    expect((h[0] as { b: number[] }).b[0]).toBeCloseTo(0, 6);
  });
  it("ořez kružnice dvěma úsečkami → oblouk", () => {
    const es: SketchEntity[] = [{ id: "c", type: "circle", cx: 0, cy: 0, r: 10 }, L("v", [0, -20], [0, 20])];
    const t = trim(es, "c", [10, 0])!;
    const arc = t.find((e) => e.type === "arc");
    expect(arc).toBeTruthy();
    const k = keyPoints(arc!);
    expect(k.mid[0]).toBeLessThan(0); // zůstala levá půlka
  });
  it("prodloužení k hraně", () => {
    const es = [L("a", [0, 0], [5, 0]), L("w", [20, -5], [20, 5])];
    const r = extend(es, "a", [5, 0])!;
    expect(line(r, "a").b[0]).toBeCloseTo(20, 6);
  });
  it("zaoblení a sražení rohu", () => {
    const es = [L("a", [0, 0], [20, 0]), L("b", [20, 0], [20, 20])];
    const f = filletLines(es, "a", "b", 5)!;
    expect(f).toHaveLength(3);
    expect(line(f, "a").b[0]).toBeCloseTo(15, 6);
    const arc = f.find((e) => e.type === "arc")!;
    expect(keyPoints(arc).center[0]).toBeCloseTo(15, 5);
    const c = chamferLines(es, "a", "b", 3)!;
    expect(c).toHaveLength(3);
  });
  it("odsazení, rozložení, zrcadlení a pole", () => {
    expect((offsetEntity({ id: "r", type: "rect", cx: 0, cy: 0, w: 20, h: 10, r: 0, angle: 0 }, 2) as { w: number }).w).toBe(24);
    expect((offsetEntity({ id: "c", type: "circle", cx: 0, cy: 0, r: 5 }, -2) as { r: number }).r).toBe(3);
    const sq = offsetEntity({ id: "p", type: "polyline", points: [[0, 0], [10, 0], [10, 10], [0, 10]], closed: true }, 1) as { points: number[][] };
    expect(sq.points[0]).toEqual([-1, -1]);
    expect(explode({ id: "r", type: "rect", cx: 0, cy: 0, w: 20, h: 10, r: 2, angle: 0 })).toHaveLength(8);
    const m = transformEntity({ id: "c", type: "circle", cx: 5, cy: 0, r: 1 }, xfMirror([0, 0], [0, 1]), true) as { cx: number };
    expect(m.cx).toBe(-5);
    expect(linearPattern([L("a", [0, 0], [1, 0])], [5, 0], 4)).toHaveLength(3);
    expect(circularPattern([{ id: "c", type: "circle", cx: 10, cy: 0, r: 1 }], [0, 0], 6)).toHaveLength(5);
  });
});

describe("řešič vazeb", () => {
  it("vodorovná vazba narovná úsečku", () => {
    const r = solveSketch([L("a", [0, 0], [10, 3])], [C("h", "horizontal", [["a", "self"]])]);
    expect(r.ok).toBe(true);
    const a = line(r.entities, "a");
    expect(a.a[1]).toBeCloseTo(a.b[1], 6);
  });
  it("obdélník ze 4 úseček s kótami 40 × 25 a pevným rohem je plně určený", () => {
    const es = [L("1", [0, 0], [38, 1]), L("2", [38, 1], [37, 22]), L("3", [37, 22], [1, 23]), L("4", [1, 23], [0, 0])];
    const cons: SketchConstraint[] = [
      C("c1", "coincident", [["1", "b"], ["2", "a"]]),
      C("c2", "coincident", [["2", "b"], ["3", "a"]]),
      C("c3", "coincident", [["3", "b"], ["4", "a"]]),
      C("c4", "coincident", [["4", "b"], ["1", "a"]]),
      C("h1", "horizontal", [["1", "self"]]),
      C("h3", "horizontal", [["3", "self"]]),
      C("v2", "vertical", [["2", "self"]]),
      C("v4", "vertical", [["4", "self"]]),
      C("f", "fixed", [["1", "a"]], [0, 0]),
    ];
    const dims = [D("w", "length", [["1", "self"]], 40), D("h", "length", [["2", "self"]], 25)];
    const r = solveSketch(es, cons, dims);
    expect(r.ok).toBe(true);
    const m = new Map(r.entities.map((e) => [e.id, e]));
    expect(measureDim(m, dims[0])).toBeCloseTo(40, 5);
    expect(measureDim(m, dims[1])).toBeCloseTo(25, 5);
    expect(line(r.entities, "3").a[0]).toBeCloseTo(40, 5);
    expect(line(r.entities, "3").a[1]).toBeCloseTo(25, 5);
    expect(r.dof).toBe(0);
  });
  it("stupně volnosti a konflikt", () => {
    expect(sketchDof([L("a", [0, 0], [10, 0])])).toBe(4);
    expect(sketchDof([L("a", [0, 0], [10, 0])], [C("h", "horizontal", [["a", "self"]])])).toBe(3);
    const r = solveSketch([L("a", [0, 0], [10, 0])], [], [D("d1", "length", [["a", "self"]], 10), { ...D("d2", "length", [["a", "self"]], 20) }]);
    expect(r.ok).toBe(false);
    expect(r.conflicts.length).toBeGreaterThan(0);
  });
  it("tečnost úsečky ke kružnici a průměr", () => {
    const es: SketchEntity[] = [{ id: "c", type: "circle", cx: 0, cy: 0, r: 8 }, L("t", [-20, 12], [20, 12])];
    const r = solveSketch(es, [C("tg", "tangent", [["t", "self"], ["c", "self"]]), C("h", "horizontal", [["t", "self"]])], [D("d", "diameter", [["c", "self"]], 30)]);
    expect(r.ok).toBe(true);
    const c = r.entities.find((e) => e.id === "c") as { r: number; cy: number };
    expect(c.r).toBeCloseTo(15, 5);
    expect(Math.abs(line(r.entities, "t").a[1] - c.cy)).toBeCloseTo(15, 5);
  });
  it("úhel mezi úsečkami, rovnoběžnost, rovnost, soustřednost, bod na křivce, symetrie", () => {
    const es: SketchEntity[] = [
      L("a", [0, 0], [10, 0]),
      L("b", [0, 0], [10, 4]),
      L("p", [0, 5], [10, 6]),
      { id: "c1", type: "circle", cx: 0, cy: 0, r: 3 },
      { id: "c2", type: "circle", cx: 1, cy: 1, r: 5 },
      { id: "pt", type: "point", p: [3, 3] },
      { id: "q1", type: "point", p: [-2, 1] },
      { id: "q2", type: "point", p: [3, 2] },
      L("ax", [0, -10], [0, 10]),
    ];
    const r = solveSketch(
      es,
      [
        C("fa", "fixed", [["a", "self"]], [0, 0, 10, 0]),
        C("par", "parallel", [["p", "self"], ["a", "self"]]),
        C("eq", "equal", [["c1", "self"], ["c2", "self"]]),
        C("con", "concentric", [["c1", "self"], ["c2", "self"]]),
        C("on", "pointOnCurve", [["pt", "p"], ["c2", "self"]]),
        C("fax", "fixed", [["ax", "self"]], [0, -10, 0, 10]),
        C("sym", "symmetric", [["q1", "p"], ["q2", "p"], ["ax", "self"]]),
      ],
      [{ ...D("ang", "angle", [["a", "self"], ["b", "self"]], 30) }],
    );
    expect(r.ok).toBe(true);
    const m = new Map(r.entities.map((e) => [e.id, e]));
    expect(measureDim(m, { ...D("x", "angle", [["a", "self"], ["b", "self"]], 0) })).toBeCloseTo(30, 4);
    const p = m.get("p") as { a: number[]; b: number[] };
    expect(p.a[1]).toBeCloseTo(p.b[1], 5);
    const q1 = (m.get("q1") as { p: number[] }).p;
    const q2 = (m.get("q2") as { p: number[] }).p;
    expect(q1[0]).toBeCloseTo(-q2[0], 5);
    expect(q1[1]).toBeCloseTo(q2[1], 5);
  });
});
