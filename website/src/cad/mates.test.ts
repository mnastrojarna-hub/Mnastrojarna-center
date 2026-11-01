import { describe, expect, it } from "vitest";
import { apply3, emptyAssembly, partComponent, rotMatrix, transformPoint } from "./assembly";
import { residual, solveMates, solveOne, worldGeo, type FaceGeo, type GeoProvider } from "./mates";
import { emptyDoc, type CadDoc, type Mate, type MateRef, type Vec3 } from "./types";

/** kostka 10 mm se středem v počátku: plochy +Z (0), −Z (1), +X (2), válcová díra Ø4 podél Z (3) */
const cube = (name: string): CadDoc => ({ ...emptyDoc(name), features: [{ id: "b", name: "Kvádr", type: "box", size: [10, 10, 10], position: [0, 0, 0], centered: true, mode: "new" }] });
const FACES: Record<number, FaceGeo> = {
  0: { kind: "plane", origin: [0, 0, 5], normal: [0, 0, 1] },
  1: { kind: "plane", origin: [0, 0, -5], normal: [0, 0, -1] },
  2: { kind: "plane", origin: [5, 0, 0], normal: [1, 0, 0] },
  3: { kind: "cylinder", origin: [0, 0, 0], normal: [0, 0, 1], radius: 2 },
};
const geo: GeoProvider = (ref: MateRef) => FACES[ref.face] ?? null;
const asm = (n = 3) => {
  const a = emptyAssembly("A");
  a.components = Array.from({ length: n }, (_, i) => partComponent(cube(`K${i + 1}`), { position: [i * 37, i * 11, i * 5], rotation: [0, 0, 0] }, { fixed: i === 0 }));
  return a;
};
const ids = (d: CadDoc) => (d.components ?? []).map((c) => c.id);
const dist = (a: Vec3, b: Vec3) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);

describe("vazby sestavy – řešič", () => {
  it("Kontakt položí kostku 2 na kostku 1 (horní plocha na spodní)", () => {
    const d = asm(2);
    const [c1, c2] = ids(d);
    d.mates = [{ id: "m1", type: "mate", a: { compId: c2, face: 1 }, b: { compId: c1, face: 0 } }];
    const r = solveMates(d, geo);
    expect(r.status.m1).toBe("ok");
    const p = r.components[1].placement;
    expect(p.position[2]).toBeCloseTo(10, 6); // −Z plocha kostky 2 na z=5 → střed v z=10
    const wA = worldGeo(p, FACES[1]);
    expect(wA.normal[2]).toBeCloseTo(-1, 6);
    expect(r.moved).toContain(c2);
  });
  it("Zarovnat (flush) srovná normály souhlasně, Vzdálenost přidá mezeru", () => {
    const d = asm(2);
    const [c1, c2] = ids(d);
    d.mates = [{ id: "f", type: "flush", a: { compId: c2, face: 0 }, b: { compId: c1, face: 0 } }];
    let r = solveMates(d, geo);
    expect(r.components[1].placement.position[2]).toBeCloseTo(0, 6);
    d.mates = [{ id: "d", type: "distance", a: { compId: c2, face: 1 }, b: { compId: c1, face: 0 }, value: 3 }];
    r = solveMates(d, geo);
    expect(r.components[1].placement.position[2]).toBeCloseTo(13, 6);
    expect(residual(d.mates[0], worldGeo(r.components[1].placement, FACES[1]), worldGeo(r.components[0].placement, FACES[0]))).toBeLessThan(1e-6);
  });
  it("Souosost: osa díry kostky 2 na osu díry kostky 1 (včetně natočené komponenty)", () => {
    const d = asm(2);
    const [c1, c2] = ids(d);
    d.components![1].placement = { position: [40, 20, 3], rotation: [90, 0, 0] };
    d.mates = [{ id: "c", type: "concentric", a: { compId: c2, face: 3 }, b: { compId: c1, face: 3 } }];
    const r = solveMates(d, geo);
    expect(r.status.c).toBe("ok");
    const p = r.components[1].placement;
    const axisDir = apply3(rotMatrix(p.rotation), [0, 0, 1]);
    expect(Math.abs(axisDir[2])).toBeCloseTo(1, 6);
    const o = transformPoint(p, [0, 0, 0]);
    expect(Math.hypot(o[0], o[1])).toBeLessThan(1e-6); // na ose Z kostky 1
  });
  it("řetězené vazby konvergují (3 kostky na sobě) a posun kotvy přepočítá závislé", () => {
    const d = asm(3);
    const [c1, c2, c3] = ids(d);
    d.mates = [
      { id: "m1", type: "mate", a: { compId: c2, face: 1 }, b: { compId: c1, face: 0 }, center: true },
      { id: "m2", type: "mate", a: { compId: c3, face: 1 }, b: { compId: c2, face: 0 }, center: true },
    ];
    const r = solveMates(d, geo);
    expect(r.components[1].placement.position[2]).toBeCloseTo(10, 6);
    expect(r.components[2].placement.position[2]).toBeCloseTo(20, 6);
    expect(dist(r.components[2].placement.position, [0, 0, 20])).toBeLessThan(1e-6); // center = středy ztotožněny
    expect(Object.values(r.status).every((s) => s === "ok")).toBe(true);
    // uživatel posune kostku 1 → vše se přepočítá podle nové polohy kotvy
    const d2 = { ...d, components: r.components.map((c) => (c.id === c1 ? { ...c, placement: { position: [100, 0, 0] as Vec3, rotation: [0, 0, 0] as Vec3 } } : c)) };
    const r2 = solveMates(d2, geo, c1);
    expect(r2.components[2].placement.position[0]).toBeCloseTo(100, 6);
    expect(r2.components[2].placement.position[2]).toBeCloseTo(20, 6);
  });
  it("konflikt: dvě neslučitelné vazby označí druhou jako konflikt; potlačená se neřeší", () => {
    const d = asm(2);
    const [c1, c2] = ids(d);
    d.mates = [
      { id: "m1", type: "mate", a: { compId: c2, face: 1 }, b: { compId: c1, face: 0 } },
      { id: "m2", type: "distance", a: { compId: c2, face: 1 }, b: { compId: c1, face: 0 }, value: 7 },
      { id: "m3", type: "mate", a: { compId: c2, face: 2 }, b: { compId: c1, face: 2 }, suppressed: true },
    ];
    const r = solveMates(d, geo);
    expect(r.status.m3).toBe("suppressed");
    expect([r.status.m1, r.status.m2]).toContain("conflict");
  });
  it("ukotvená pohyblivá komponenta → hýbe se druhá; chybějící plocha = missing; Úhel a Rovnoběžně natáčí", () => {
    const d = asm(2);
    const [c1, c2] = ids(d);
    d.components![1].fixed = true;
    d.components![0].fixed = false;
    d.mates = [{ id: "m", type: "mate", a: { compId: c2, face: 1 }, b: { compId: c1, face: 0 } }];
    const r = solveMates(d, geo);
    expect(r.moved).toEqual([c1]);
    expect(solveMates({ ...d, mates: [{ id: "x", type: "mate", a: { compId: c2, face: 99 }, b: { compId: c1, face: 0 } }] }, geo).status.x).toBe("missing");
    const ang: Mate = { id: "a", type: "angle", a: { compId: "x", face: 0 }, b: { compId: "y", face: 0 }, value: 30 };
    const p = solveOne(ang, { position: [0, 0, 0], rotation: [0, 0, 0] }, FACES[0], { kind: "plane", origin: [0, 0, 0], normal: [1, 0, 0] });
    const n = apply3(rotMatrix(p.rotation), [0, 0, 1]);
    expect((Math.acos(n[0]) * 180) / Math.PI).toBeCloseTo(30, 4);
    const par = solveOne({ ...ang, type: "parallel", flip: true }, { position: [1, 2, 3], rotation: [0, 0, 0] }, FACES[0], { kind: "plane", origin: [0, 0, 0], normal: [1, 0, 0] });
    expect(apply3(rotMatrix(par.rotation), [0, 0, 1])[0]).toBeCloseTo(-1, 6);
    expect(par.position).toEqual([1, 2, 3]);
  });
});
