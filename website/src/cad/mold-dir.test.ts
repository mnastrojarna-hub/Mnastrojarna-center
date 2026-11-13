/** Směr otevírání formy (vyhazovače, chlazení) a osa kruhového pole komponent zadaná vektorem. */
import { describe, expect, it } from "vitest";
import { coolingCircuit, ejectorHoles, ejectorLength, ejectorPinPlacement, moldFrame, suggestEjectors } from "./mold";
import { emptyDoc, type Feature, type Vec3 } from "./types";
import { partComponent, patternComponent, transformPoint } from "./assembly";

const BOX: [Vec3, Vec3] = [[0, 0, 0], [120, 80, 30]];

describe("směr otevírání formy", () => {
  it("rámec formy pro +Z je X / Y / Z dílu, pro jiný směr pravotočivý a kolmý", () => {
    expect(moldFrame([0, 0, 1])).toEqual({ u: [1, 0, 0], v: [0, 1, 0], w: [0, 0, 1] });
    const f = moldFrame([1, 1, 0]);
    const dot = (a: Vec3, b: Vec3) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
    expect(Math.abs(dot(f.u, f.w))).toBeLessThan(1e-9);
    expect(Math.abs(dot(f.v, f.w))).toBeLessThan(1e-9);
    expect(Math.abs(dot(f.u, f.v))).toBeLessThan(1e-9);
    expect(() => moldFrame([0, 0, 0])).toThrow(/nulový/);
  });

  it("vyhazovače: bez směru / +Z beze změny, směr +X → body na čele x = 120, díry v ose X", () => {
    const plain = suggestEjectors(BOX);
    expect(suggestEjectors(BOX, { dir: [0, 0, 1] })).toEqual(plain);
    expect(suggestEjectors(BOX, { dir: [0, 0, 0] })).toEqual(plain); // rozpracované nulové zadání nespadne
    expect(plain.every((e) => e.p === undefined && e.dir === undefined)).toBe(true);
    const zHoles = ejectorHoles(plain, 30);
    expect(zHoles[0]).toMatchObject({ type: "hole", axis: "Z", position: [plain[0].x, plain[0].y, 30], flip: false, depth: 0 });
    expect((zHoles[0] as Extract<Feature, { type: "hole" }>).dirDef).toBeUndefined();
    const side = suggestEjectors(BOX, { dir: [1, 0, 0] });
    expect(side.length).toBeGreaterThanOrEqual(2);
    for (const e of side) {
      expect(e.p![0]).toBeCloseTo(120, 6);
      expect(e.p![1]).toBeGreaterThan(0);
      expect(e.p![1]).toBeLessThan(80);
      expect(e.p![2]).toBeGreaterThan(0);
      expect(e.p![2]).toBeLessThan(30);
      expect(e.dir).toEqual([1, 0, 0]);
    }
    const xHoles = ejectorHoles(side, 30) as Extract<Feature, { type: "hole" }>[];
    expect(xHoles[0].axis).toBe("X");
    expect(xHoles[0].position).toEqual(side[0].p);
    // šikmý směr → díra s obecným směrem (dirDef vektorem)
    const tilted = ejectorHoles(suggestEjectors(BOX, { dir: [0, -1, 1] }), 30) as Extract<Feature, { type: "hole" }>[];
    expect(tilted[0].dirDef?.kind).toBe("vector");
  });

  it("vyhazovač v sestavě: pro +Z jako dřív, pro +X natočený dříkem do +X pod dílem", () => {
    const [e] = suggestEjectors(BOX);
    expect(ejectorPinPlacement(e, BOX, 100)).toEqual({ position: [e.x, e.y, -105] });
    const [s] = suggestEjectors(BOX, { dir: [1, 0, 0] });
    const pl = ejectorPinPlacement(s, BOX, 100);
    const full = { position: pl.position!, rotation: pl.rotation! };
    const head = transformPoint(full, [0, 0, 0]);
    const tip = transformPoint(full, [0, 0, 100]);
    expect(head[0]).toBeCloseTo(-105, 6);
    expect(tip[0] - head[0]).toBeCloseTo(100, 6);
    expect(head[1]).toBeCloseTo(s.p![1], 6);
    expect(ejectorLength(BOX)).toBe(130);
    expect(ejectorLength(BOX, [1, 0, 0])).toBe(220);
  });

  it("chladicí okruh: +Z beze změny, směr +X → kanály v rovině kolmé na X pod dutinou", () => {
    const base = { bbox: BOX, diameter: 8, depth: 20, rows: 3, overhang: 30 };
    const z = coolingCircuit(base).features as Extract<Feature, { type: "cylinder" }>[];
    expect(z[0]).toMatchObject({ axis: "X", position: [-30, 0, -20], height: 180 });
    const x = coolingCircuit({ ...base, dir: [1, 0, 0] }).features as Extract<Feature, { type: "cylinder" }>[];
    expect(x).toHaveLength(5);
    for (const c of x) expect(c.position[0]).toBeCloseTo(-20, 6);
    expect(x.filter((c) => c.name.startsWith("Kanál")).every((c) => c.axis !== "X")).toBe(true);
  });
});

describe("kruhové pole komponent s osou vektorem", () => {
  it("osa [0,0,2] = osa Z; osa [1,0,0] otočí kolem X; nulová osa = chyba", () => {
    const cube = { ...emptyDoc("A"), features: [] };
    const a = { ...emptyDoc("S"), kind: "assembly" as const, components: [partComponent(cube, { position: [10, 0, 0] })] };
    const byName = patternComponent(a, a.components[0].id, { kind: "circular", count: 4, angle: 360, axis: "Z", center: [0, 0, 0] });
    const byVec = patternComponent(a, a.components[0].id, { kind: "circular", count: 4, angle: 360, axis: [0, 0, 2], center: [0, 0, 0] });
    expect(byVec.components!.map((c) => c.placement.position)).toEqual(byName.components!.map((c) => c.placement.position));
    const b = { ...a, components: [partComponent(cube, { position: [0, 10, 0] })] };
    const aroundX = patternComponent(b, b.components[0].id, { kind: "circular", count: 4, angle: 360, axis: [1, 0, 0], center: [0, 0, 0] });
    expect(aroundX.components![1].placement.position[2]).toBeCloseTo(10, 6);
    expect(() => patternComponent(a, a.components[0].id, { kind: "circular", count: 4, angle: 360, axis: [0, 0, 0], center: [0, 0, 0] })).toThrow(/nulový/);
  });
});
