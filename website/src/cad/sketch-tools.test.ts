import { describe, expect, it } from "vitest";
import { arcGeom, findLoops, keyPoints } from "./sketch";
import { analyzeSketch, measureDim, solveSketch } from "./sketch-solver";
import {
  arcMidForRadius,
  autoConstraints,
  chainOf,
  chainSide,
  circleFrom2,
  inferLine,
  mergeCollinear,
  offsetChain,
  parseInput,
  polarPoint,
  polygonFrom,
  powerTrim,
  projectModelLines,
  rectFrom3,
  resolveInput,
  slotArcEntities,
  splitAt,
  splitCircle,
  tangentArcEnd,
  tangentAt,
} from "./sketch-tools";
import type { SketchConstraint, SketchDim, SketchEntity } from "./types";

const L = (id: string, a: [number, number], b: [number, number]): SketchEntity => ({ id, type: "line", a, b });
const C = (id: string, type: SketchConstraint["type"], refs: [string, string][], value?: number[]): SketchConstraint => ({ id, type, refs: refs.map(([e, k]) => ({ e, k })), value });
const D = (id: string, type: SketchDim["type"], refs: [string, string][], value: number): SketchDim => ({ id, type, refs: refs.map(([e, k]) => ({ e, k })), value, driving: true });
const lines = (es: SketchEntity[]) => es.filter((e) => e.type === "line") as Extract<SketchEntity, { type: "line" }>[];
const arcs = (es: SketchEntity[]) => es.filter((e) => e.type === "arc") as Extract<SketchEntity, { type: "arc" }>[];

describe("číselné zadání u kurzoru", () => {
  it("číslo, dvojice, relativní a polární zadání", () => {
    expect(parseInput("25")).toEqual({ kind: "num", v: 25 });
    expect(parseInput("2*10+5")).toEqual({ kind: "num", v: 25 });
    expect(parseInput("30;20")).toEqual({ kind: "abs", v: [30, 20] });
    expect(parseInput("30,20")).toEqual({ kind: "abs", v: [30, 20] });
    expect(parseInput("30x20")).toEqual({ kind: "abs", v: [30, 20] });
    expect(parseInput("@10;-5")).toEqual({ kind: "rel", v: [10, -5] });
    expect(parseInput("50<90")).toEqual({ kind: "polar", len: 50, ang: 90 });
    expect(parseInput("abc")).toBeNull();
    expect(parseInput("")).toBeNull();
  });
  it("body ze zadání vůči poslednímu bodu", () => {
    expect(resolveInput({ kind: "abs", v: [1, 2] }, [5, 5])).toEqual([1, 2]);
    expect(resolveInput({ kind: "rel", v: [1, 2] }, [5, 5])).toEqual([6, 7]);
    const p = resolveInput({ kind: "polar", len: 10, ang: 90 }, [5, 5])!;
    expect(p[0]).toBeCloseTo(5, 9);
    expect(p[1]).toBeCloseTo(15, 9);
    expect(resolveInput({ kind: "num", v: 3 }, null)).toBeNull();
  });
  it("délka a úhel úsečky doplněné kurzorem", () => {
    const p1 = polarPoint([0, 0], [3, 4], 10, null); // délka 10 ve směru kurzoru
    expect(p1[0]).toBeCloseTo(6, 9);
    expect(p1[1]).toBeCloseTo(8, 9);
    const p2 = polarPoint([0, 0], [10, 1], null, 0); // úhel 0, délka z kurzoru
    expect(p2).toEqual([10, 0]);
    const p3 = polarPoint([0, 0], [1, 1], 20, 30);
    expect(p3[0]).toBeCloseTo(20 * Math.cos(Math.PI / 6), 9);
  });
});

describe("odvozené vazby při kreslení", () => {
  it("vodorovně / svisle do 3°", () => {
    const h = inferLine([0, 0], [20, 0.8]);
    expect(h.kinds).toEqual(["horizontal"]);
    expect(h.p).toEqual([20, 0]);
    const v = inferLine([0, 0], [-0.5, 15]);
    expect(v.kinds).toEqual(["vertical"]);
    expect(v.p).toEqual([0, 15]);
    expect(inferLine([0, 0], [10, 2]).kinds).toEqual([]); // 11° – nic
  });
  it("rovnoběžně a kolmo k referenční úsečce, tečně k oblouku", () => {
    const ref = { id: "r", dir: [1, 1] as [number, number], kind: "line" as const };
    const par = inferLine([0, 0], [10, 10.4], [ref]);
    expect(par.kinds).toEqual(["parallel"]);
    expect(par.p[0]).toBeCloseTo(par.p[1], 9);
    const per = inferLine([0, 0], [-10, 10.3], [ref]);
    expect(per.kinds).toEqual(["perpendicular"]);
    expect(per.p[0]).toBeCloseTo(-per.p[1], 9);
    const tan = inferLine([0, 0], [10, 10.2], [{ id: "a", dir: [1, 1], kind: "tangent" }]);
    expect(tan.kinds).toEqual(["tangent"]);
    const kinds = (id: string) => (id === "r" ? ("line" as const) : id === "a" ? ("arc" as const) : null);
    expect(autoConstraints("n", par, kinds)[0]).toMatchObject({ type: "parallel", refs: [{ e: "n", k: "self" }, { e: "r", k: "self" }] });
    expect(autoConstraints("n", tan, kinds)[0]).toMatchObject({ type: "tangent" });
    expect(autoConstraints("n", inferLine([0, 0], [10, 0]), kinds)[0]).toMatchObject({ type: "horizontal" });
  });
  it("tečna v konci úsečky a oblouku", () => {
    expect(tangentAt(L("l", [0, 0], [10, 0]), "b")).toEqual([10, 0]);
    expect(tangentAt(L("l", [0, 0], [10, 0]), "a")).toEqual([-10, 0]);
    // čtvrtkruh od (10,0) přes (7.07,7.07) do (0,10): v konci c míří tečna doleva (−x)
    const arc: SketchEntity = { id: "a", type: "arc", a: [10, 0], b: [Math.SQRT1_2 * 10, Math.SQRT1_2 * 10], c: [0, 10] };
    const t = tangentAt(arc, "c")!;
    expect(t[0]).toBeLessThan(0);
    expect(Math.abs(t[1])).toBeLessThan(1e-6);
    const t0 = tangentAt(arc, "a")!;
    expect(t0[1]).toBeLessThan(0); // pokračování z počátku míří dolů
  });
});

describe("výkonný ořez tažením", () => {
  it("cesta přes dvě úsečky mřížky smaže oba protnuté úseky", () => {
    // dvě svislé čáry protnuté dvěma vodorovnými → tažení středem smaže střední úseky svislic
    const es = [L("v1", [0, -20], [0, 20]), L("v2", [10, -20], [10, 20]), L("h1", [-5, -5], [15, -5]), L("h2", [-5, 5], [15, 5])];
    const r = powerTrim(es, [[-3, 0], [13, 0]])!;
    const v = lines(r).filter((e) => Math.abs(e.a[0] - e.b[0]) < 1e-9);
    expect(v).toHaveLength(4); // každá svislice na 2 kusy
    expect(v.every((e) => Math.max(e.a[1], e.b[1]) <= -5 + 1e-6 || Math.min(e.a[1], e.b[1]) >= 5 - 1e-6)).toBe(true);
    expect(lines(r).filter((e) => Math.abs(e.a[1] - e.b[1]) < 1e-9)).toHaveLength(2); // vodorovné nedotčené
  });
  it("volná úsečka bez průsečíků se smaže, prázdná cesta nic nedělá", () => {
    const es = [L("a", [0, 0], [10, 0]), L("b", [0, 5], [10, 5])];
    const r = powerTrim(es, [[5, -2], [5, 2]])!;
    expect(r.map((e) => e.id)).toEqual(["b"]);
    expect(powerTrim(es, [[50, 50], [60, 60]])).toBeNull();
  });
});

describe("řetězec a odsazení řetězce", () => {
  const Lshape = [L("a", [0, 0], [20, 0]), L("b", [20, 0], [20, 10]), L("c", [20, 10], [30, 10])];
  it("řetězec se najde oběma směry a pozná uzavření", () => {
    const ch = chainOf(Lshape, "b");
    expect(ch.segs.map((s) => s.id)).toEqual(["a", "b", "c"]);
    expect(ch.closed).toBe(false);
    const sq = [L("1", [0, 0], [10, 0]), L("2", [10, 0], [10, 10]), L("3", [10, 10], [0, 10]), L("4", [0, 10], [0, 0])];
    expect(chainOf(sq, "3").closed).toBe(true);
    expect(chainOf(sq, "3").segs).toHaveLength(4);
  });
  it("řetězec končí na větvení", () => {
    const es = [...Lshape, L("x", [20, 0], [25, -5])];
    expect(chainOf(es, "c").segs.map((s) => s.id)).toEqual(["b", "c"]);
  });
  it("odsazení úseček: ostré rohy, správná strana", () => {
    const ch = chainOf(Lshape, "a");
    expect(chainSide(ch.segs, [10, 3])).toBe(1); // nad první úsečkou = vlevo od směru +x
    const o = offsetChain(ch.segs, false, 2)!;
    expect(o).toHaveLength(3);
    const [a, b, c] = lines(o);
    expect(a.a).toEqual([0, 2]);
    expect(a.b).toEqual([18, 2]); // roh „a/b“ zevnitř zkrácen
    expect(b.a).toEqual([18, 2]);
    expect(b.b).toEqual([18, 12]);
    expect(c.a).toEqual([18, 12]);
    expect(c.b).toEqual([30, 12]);
    const o2 = offsetChain(ch.segs, false, -2)!;
    expect(lines(o2)[0].b).toEqual([22, -2]); // vnější roh protažen
  });
  it("odsazení úsečky + tečného oblouku zůstává spojité; vnitřní odsazení větší než poloměr selže", () => {
    // úsečka (0,0)→(10,0), pak čtvrtkruh se středem (10,5) r=5 z (10,0) do (15,5) proti směru hodin
    const es: SketchEntity[] = [L("l", [0, 0], [10, 0]), { id: "k", type: "arc", a: [10, 0], b: [10 + 5 * Math.SQRT1_2, 5 - 5 * Math.SQRT1_2], c: [15, 5] }];
    const ch = chainOf(es, "l");
    expect(ch.segs).toHaveLength(2);
    const o = offsetChain(ch.segs, false, 1)!; // vlevo = nahoru = dovnitř oblouku → r = 4
    const ar = arcs(o)[0];
    const g = arcGeom(ar.a, ar.b, ar.c)!;
    expect(g.r).toBeCloseTo(4, 6);
    expect(lines(o)[0].b[1]).toBeCloseTo(1, 6);
    expect(Math.hypot(lines(o)[0].b[0] - ar.a[0], lines(o)[0].b[1] - ar.a[1])).toBeLessThan(1e-6);
    expect(offsetChain(ch.segs, false, 6)).toBeNull();
    const o2 = offsetChain(ch.segs, false, -1)!;
    expect(arcGeom(arcs(o2)[0].a, arcs(o2)[0].b, arcs(o2)[0].c)!.r).toBeCloseTo(6, 6);
  });
  it("nenavazující roh úsečka–oblouk: vně spojovací oblouk, uvnitř průsečík", () => {
    // úsečka (0,0)→(10,0) a oblouk z (10,0) kolmo vzhůru (střed (15,0), r=5, konec (15,5), po směru hodin)
    const es: SketchEntity[] = [L("l", [0, 0], [10, 0]), { id: "k", type: "arc", a: [10, 0], b: [15 - 5 * Math.SQRT1_2, 5 * Math.SQRT1_2], c: [15, 5] }];
    const ch = chainOf(es, "l");
    expect(ch.segs).toHaveLength(2);
    const outer = offsetChain(ch.segs, false, -1)!; // vpravo (dolů) = vnější roh → mezera → spojovací oblouk r=1
    expect(arcs(outer)).toHaveLength(2);
    const join = arcs(outer).find((a) => arcGeom(a.a, a.b, a.c)!.r < 2)!;
    expect(arcGeom(join.a, join.b, join.c)!.r).toBeCloseTo(1, 6);
    expect(arcs(outer).some((a) => Math.abs(arcGeom(a.a, a.b, a.c)!.r - 4) < 1e-6)).toBe(true);
    const inner = offsetChain(ch.segs, false, 1)!; // vlevo (nahoru) = vnitřní roh → zkrácení do průsečíku
    expect(arcs(inner)).toHaveLength(1);
    expect(arcGeom(arcs(inner)[0].a, arcs(inner)[0].b, arcs(inner)[0].c)!.r).toBeCloseTo(6, 6);
    expect(lines(inner)[0].b[0]).toBeLessThan(10);
    expect(lines(inner)[0].b[1]).toBeCloseTo(1, 6);
  });
});

describe("rozdělení v bodě", () => {
  it("úsečka a oblouk na dva kusy, kružnice dvěma body", () => {
    const r = splitAt([L("a", [0, 0], [10, 0])], "a", [4, 1])!;
    expect(r).toHaveLength(2);
    expect(lines(r)[0].b).toEqual([4, 0]);
    expect(lines(r)[1].a).toEqual([4, 0]);
    expect(splitAt([L("a", [0, 0], [10, 0])], "a", [0, 0])).toBeNull();
    const arc: SketchEntity = { id: "k", type: "arc", a: [10, 0], b: [0, 10], c: [-10, 0] };
    const s = splitAt([arc], "k", [7, 7])!;
    expect(s).toHaveLength(2);
    const [a1, a2] = arcs(s);
    expect(Math.hypot(a1.c[0] - a2.a[0], a1.c[1] - a2.a[1])).toBeLessThan(1e-6);
    expect(a1.c[0]).toBeCloseTo(Math.SQRT1_2 * 10, 5);
    const cc = splitCircle([{ id: "c", type: "circle", cx: 0, cy: 0, r: 5 }], "c", [5, 0], [-5, 0])!;
    expect(cc).toHaveLength(2);
    expect(arcGeom(arcs(cc)[0].a, arcs(cc)[0].b, arcs(cc)[0].c)!.sweep).toBeCloseTo(Math.PI, 6);
    expect(findLoops(cc).loops).toHaveLength(1); // dva půlkruhy stále tvoří profil
  });
});

describe("projekce hran modelu do roviny skici", () => {
  it("jen hrany v rovině, duplicity a kolineární navazující úsečky se sloučí", () => {
    // krychle 10 (hrany po dvojicích): spodní čtverec v z=0, horní v z=10, svislé hrany
    const seg: number[] = [];
    const push = (a: number[], b: number[]) => seg.push(...a, ...b);
    const sq = (z: number) => {
      push([0, 0, z], [10, 0, z]);
      push([10, 0, z], [10, 10, z]);
      push([10, 10, z], [0, 10, z]);
      push([0, 10, z], [0, 0, z]);
    };
    sq(0);
    sq(10);
    push([0, 0, 0], [0, 0, 10]);
    push([10, 0, 0], [10, 0, 10]);
    push([10, 0, 0], [10, 0, 10]); // duplicitní hrana
    const inPlane = projectModelLines(new Float32Array(seg), { kind: "base", name: "XY", offset: 0 }, { inPlaneOnly: true });
    expect(inPlane).toHaveLength(4);
    expect(inPlane.every((e) => e.type === "line")).toBe(true);
    const all = projectModelLines(new Float32Array(seg), { kind: "base", name: "XY", offset: 0 }, { inPlaneOnly: false, construction: true });
    // horní čtverec se promítne na spodní (duplicity pryč), svislé hrany degenerují → 4 úsečky
    expect(all).toHaveLength(4);
    expect(all.every((e) => e.construction)).toBe(true);
    // rovina XZ s odsazením: jen přední hrany v y=0 (4 ks: 2 vodorovné, 2 svislé)
    const xz = projectModelLines(new Float32Array(seg), { kind: "base", name: "XZ", offset: 0 }, { inPlaneOnly: true });
    expect(xz).toHaveLength(4);
  });
  it("kolineární sloučení", () => {
    const m = mergeCollinear([[[0, 0], [5, 0]], [[5, 0], [10, 0]], [[10, 0], [10, 5]]]);
    expect(m).toHaveLength(2);
    expect(m[0]).toEqual([[0, 0], [10, 0]]);
  });
});

describe("další tvary", () => {
  it("obdélník třemi body je natočený a správně velký", () => {
    const r = rectFrom3([0, 0], [10, 10], [-5, 5])!; // první strana pod 45°, výška 10/√2·… kolmá vzdálenost
    expect(r.angle).toBeCloseTo(45, 6);
    expect(r.w).toBeCloseTo(Math.SQRT2 * 10, 6);
    expect(r.h).toBeCloseTo(5 * Math.SQRT2, 6);
    const k = keyPoints(r);
    expect(Object.values(k).some((p) => Math.hypot(p[0], p[1]) < 1e-6)).toBe(true); // roh v počátku
    expect(rectFrom3([0, 0], [10, 0], [5, 0])).toBeNull();
  });
  it("kružnice dvěma body, mnohoúhelník vepsaný/opsaný", () => {
    const c = circleFrom2([0, 0], [10, 0])!;
    expect(c).toMatchObject({ cx: 5, cy: 0, r: 5 });
    const pi = polygonFrom([0, 0], [10, 0], 6, false)!;
    expect(pi.r).toBeCloseTo(10, 6);
    expect(keyPoints(pi).c0[0]).toBeCloseTo(10, 6); // vrchol v zadaném bodě
    const po = polygonFrom([0, 0], [10, 0], 6, true)!;
    expect(po.r).toBeCloseTo(10 / Math.cos(Math.PI / 6), 6);
    const kp = keyPoints(po);
    const mid: [number, number] = [(kp.c0[0] + kp.c1[0]) / 2, (kp.c0[1] + kp.c1[1]) / 2];
    expect(Math.hypot(mid[0] - 10, mid[1])).toBeLessThan(1e-6); // střed strany v zadaném bodě
  });
  it("drážka obloukem: 4 tečné oblouky, uzavřený profil, 6 stupňů volnosti", () => {
    const s = slotArcEntities([0, 0], [20, 0], [0, 20], 6)!;
    expect(s.entities).toHaveLength(4);
    expect(s.constraints).toHaveLength(9);
    const { loops, openCount } = findLoops(s.entities);
    expect(loops).toHaveLength(1);
    expect(openCount).toBe(0);
    const r = solveSketch(s.entities, s.constraints);
    expect(r.ok).toBe(true);
    expect(r.dof).toBe(6);
    expect(slotArcEntities([0, 0], [2, 0], [0, 2], 6)).toBeNull(); // šířka větší než oblouk
  });
  it("pomocné body pro poloměr oblouku a tečný oblouk", () => {
    const m = arcMidForRadius([0, 0], [10, 0], 5, 1)!; // půlkruh
    expect(Math.abs(m[1])).toBeCloseTo(5, 6);
    expect(arcMidForRadius([0, 0], [10, 0], 4, 1)).toBeNull();
    const e = tangentArcEnd([0, 0], [1, 0], 5, 1, [10, 10]);
    expect(Math.hypot(e[0], e[1] - 5)).toBeCloseTo(5, 6); // leží na kružnici r=5 se středem (0,5)
  });
});

describe("stav určenosti po entitách", () => {
  it("volná, plně určená a přeurčená entita", () => {
    const es = [L("a", [0, 0], [10, 0]), L("b", [0, 5], [10, 7])];
    const cons = [C("f", "fixed", [["a", "self"]], [0, 0, 10, 0])];
    const an = analyzeSketch(es, cons);
    expect(an.states.get("a")).toBe("full");
    expect(an.states.get("b")).toBe("free");
    expect(an.status).toBe("under");
    expect(an.dof).toBe(4);
    const over = analyzeSketch(es, [...cons, C("h", "horizontal", [["a", "self"]])]);
    expect(over.redundant).toEqual(["h"]);
    expect(over.status).toBe("over");
    expect(over.states.get("a")).toBe("over");
    const conf = analyzeSketch(es, cons, [D("d", "length", [["a", "self"]], 20)]);
    expect(conf.conflicts).toEqual(["d"]);
    expect(conf.status).toBe("over");
  });
  it("kružnice s kótou průměru je nedourčená, s pevným středem plně určená; oblouk se nepočítá za volný kvůli prostřednímu bodu", () => {
    const circ: SketchEntity = { id: "c", type: "circle", cx: 0, cy: 0, r: 5 };
    const a1 = analyzeSketch([circ], [], [D("d", "diameter", [["c", "self"]], 10)]);
    expect(a1.states.get("c")).toBe("free");
    expect(a1.dof).toBe(2);
    const a2 = analyzeSketch([circ], [C("f", "fixed", [["c", "center"]], [0, 0])], [D("d", "diameter", [["c", "self"]], 10)]);
    expect(a2.states.get("c")).toBe("full");
    expect(a2.status).toBe("full");
    const arc: SketchEntity = { id: "k", type: "arc", a: [10, 0], b: [0, 10], c: [-10, 0] };
    const a3 = analyzeSketch([arc], [C("fa", "fixed", [["k", "a"]], [10, 0]), C("fc", "fixed", [["k", "c"]], [-10, 0])], [D("r", "radius", [["k", "self"]], 10)]);
    expect(a3.states.get("k")).toBe("full");
    expect(a3.dof).toBe(0);
  });
  it("plně určený obdélník ze 4 úseček je černý, délka oblouku jako kóta", () => {
    const es = [L("1", [0, 0], [40, 0]), L("2", [40, 0], [40, 25]), L("3", [40, 25], [0, 25]), L("4", [0, 25], [0, 0])];
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
    const an = analyzeSketch(es, cons, dims);
    expect([...an.states.values()].every((s) => s === "full")).toBe(true);
    expect(an.status).toBe("full");
    const arc: SketchEntity = { id: "k", type: "arc", a: [10, 0], b: [0, 10], c: [-10, 0] };
    const m = new Map<string, SketchEntity>([["k", arc]]);
    expect(measureDim(m, D("al", "arcLength", [["k", "self"]], 0))).toBeCloseTo(Math.PI * 10, 6);
    const r = solveSketch([arc], [C("fa", "fixed", [["k", "a"]], [10, 0]), C("fc", "fixed", [["k", "c"]], [-10, 0])], [D("al", "arcLength", [["k", "self"]], 20)]);
    expect(r.ok).toBe(true);
    expect(measureDim(new Map(r.entities.map((e) => [e.id, e])), D("al", "arcLength", [["k", "self"]], 20))).toBeCloseTo(20, 4);
  });
});
