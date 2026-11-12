import { describe, expect, it } from "vitest";
import { apply3, emptyAssembly, partComponent, rotMatrix, transformPoint } from "./assembly";
import {
  axisLabel,
  dirLabel,
  faceAreas,
  faceLabel,
  faceRow,
  hasFixedMate,
  mateFaceKind,
  mateFromPending,
  mateNeedsValue,
  measureMate,
  measureMateIn,
  patchMate,
  releaseComponent,
  removeMate,
  residual,
  snapDir,
  solveMates,
  solveOne,
  sortFaceRows,
  toggleFixedMate,
  worldGeo,
  type FaceGeo,
  type GeoProvider,
  type PendingMate,
} from "./mates";
import { emptyDoc, type CadDoc, type Mate, type MateRef, type Placement, type Vec3 } from "./types";

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

/** umístění se shoduje (poloha na 1e-6, natočení jako směry os) */
const samePlacement = (a: Placement, b: Placement) => {
  expect(dist(a.position, b.position)).toBeLessThan(1e-6);
  for (const ax of [[1, 0, 0], [0, 1, 0], [0, 0, 1]] as Vec3[]) expect(dist(apply3(rotMatrix(a.rotation), ax), apply3(rotMatrix(b.rotation), ax))).toBeLessThan(1e-6);
};
const withMate = (d: CadDoc, p: PendingMate, id = "m"): CadDoc => ({ ...d, mates: [...(d.mates ?? []), mateFromPending(p, id)!] });

describe("vazby sestavy – hodnota po výběru ploch (naměřená výchozí hodnota)", () => {
  it("Vzdálenost: naměřená hodnota komponentou nepohne, úprava hodnoty ji posune", () => {
    const d = asm(2);
    const [c1, c2] = ids(d);
    const a = { compId: c2, face: 1 };
    const b = { compId: c1, face: 0 };
    const cur = measureMateIn(d, geo, "distance", a, b);
    expect(cur).toEqual({ value: -5 }); // spodní plocha kostky 2 (z = 0) je 5 mm pod horní plochou kostky 1 (z = 5); plochy míří proti sobě
    const d1 = withMate(d, { mode: "distance", compId: c2, a, b, ...cur });
    const r = solveMates(d1, geo);
    expect(r.status.m).toBe("ok");
    expect(r.moved).toEqual([]);
    samePlacement(r.components[1].placement, d.components![1].placement);
    // úprava hodnoty existující vazby → přepočet posune jen ve směru normály cíle
    const r2 = solveMates(patchMate(d1, "m", { value: 3 }), geo);
    expect(r2.status.m).toBe("ok");
    expect(r2.components[1].placement.position).toEqual([37, 11, 13]);
  });
  it("Vzdálenost souhlasně orientovaných ploch: vazba se obrátí (flip), díl se nepřeklopí", () => {
    const d = asm(2);
    const [c1, c2] = ids(d);
    const a = { compId: c2, face: 0 };
    const b = { compId: c1, face: 0 };
    const cur = measureMateIn(d, geo, "distance", a, b);
    expect(cur).toEqual({ value: 5, flip: true }); // horní plocha kostky 2 (z = 10) je 5 mm nad horní plochou kostky 1
    const d1 = withMate(d, { mode: "distance", compId: c2, a, b, ...cur });
    expect(d1.mates![0]).toMatchObject({ type: "distance", value: 5, flip: true });
    const r = solveMates(d1, geo);
    expect(r.status.m).toBe("ok");
    samePlacement(r.components[1].placement, d.components![1].placement);
    const r2 = solveMates(patchMate(d1, "m", { value: 0 }), geo); // 0 = zarovnat do roviny
    expect(r2.components[1].placement.position).toEqual([37, 11, 0]);
    expect(r2.status.m).toBe("ok");
  });
  it("hýbe-li se cíl (pohyblivá komponenta je ukotvená), naměřená hodnota drží i u obrácené vazby – žádný konflikt", () => {
    for (const face of [0, 1]) {
      const d = asm(2);
      const [c1, c2] = ids(d);
      d.components![0].fixed = false;
      d.components![1].fixed = true;
      const a = { compId: c2, face };
      const b = { compId: c1, face: 0 };
      const cur = measureMateIn(d, geo, "distance", a, b);
      const d1 = withMate(d, { mode: "distance", compId: c2, a, b, ...cur });
      const r = solveMates(d1, geo);
      expect(r.status.m).toBe("ok");
      expect(r.moved).toEqual([]);
      samePlacement(r.components[0].placement, d.components![0].placement);
      // změna hodnoty: plocha A má být `value` nad rovinou B → posune se kostka 1 (B), kostka 2 stojí
      const v = (cur.value ?? 0) + 3;
      const r2 = solveMates(patchMate(d1, "m", { value: v }), geo);
      expect(r2.status.m).toBe("ok");
      expect(r2.moved).toEqual([c1]);
      expect(r2.components[0].placement.position[2]).toBeCloseTo(-3, 6);
      samePlacement(r2.components[1].placement, d.components![1].placement);
    }
  });
  it("Úhel: naměřený úhel normál komponentu nenatočí, úprava hodnoty ano", () => {
    const d = asm(2);
    const [c1, c2] = ids(d);
    d.components![1].placement = { position: [40, 0, 20], rotation: [0, 30, 0] };
    const a = { compId: c2, face: 0 };
    const b = { compId: c1, face: 0 };
    const cur = measureMateIn(d, geo, "angle", a, b);
    expect(cur.value).toBeCloseTo(30, 4);
    expect(cur.flip).toBeUndefined();
    const d1 = withMate(d, { mode: "angle", compId: c2, a, b, ...cur });
    const r = solveMates(d1, geo);
    expect(r.status.m).toBe("ok");
    samePlacement(r.components[1].placement, d.components![1].placement);
    const r2 = solveMates(patchMate(d1, "m", { value: 45 }), geo);
    const n = apply3(rotMatrix(r2.components[1].placement.rotation), [0, 0, 1]);
    expect((Math.acos(n[2]) * 180) / Math.PI).toBeCloseTo(45, 4);
    expect(r2.status.m).toBe("ok");
  });
  it("measureMate: úhel 0–180°, vzdálenost podél normály cíle; bez geometrie 0; ostatní typy bez hodnoty", () => {
    const pl = (origin: Vec3, normal: Vec3): FaceGeo => ({ kind: "plane", origin, normal });
    expect(measureMate("angle", pl([0, 0, 0], [0, 0, 1]), pl([5, 5, 5], [0, 0, -2]))).toEqual({ value: 180 });
    expect(measureMate("angle", pl([0, 0, 0], [1, 0, 0]), pl([0, 0, 0], [0, 1, 0]))).toEqual({ value: 90 });
    expect(measureMate("distance", pl([3, 4, 12.34567], [0, 0, -1]), pl([0, 0, 2], [0, 0, 1]))).toEqual({ value: 10.3457 });
    const d = asm(2);
    const [c1, c2] = ids(d);
    expect(measureMateIn(d, geo, "distance", { compId: c2, face: 99 }, { compId: c1, face: 0 })).toEqual({ value: 0 });
    expect(measureMateIn(d, geo, "mate", { compId: c2, face: 1 }, { compId: c1, face: 0 })).toEqual({});
  });
  it("mateFromPending: typ, střed, hodnota, flip; neúplná vazba a výběr směru nic nevytvoří", () => {
    const a = { compId: "x", face: 1 };
    const b = { compId: "y", face: 0 };
    expect(mateFromPending({ mode: "center", compId: "x", a, b }, "i")).toEqual({ id: "i", type: "mate", center: true, a, b });
    expect(mateFromPending({ mode: "concentric", compId: "x", a, b }, "i")).toEqual({ id: "i", type: "concentric", a, b });
    expect(mateFromPending({ mode: "distance", compId: "x", a, b, value: 12.5, flip: true }, "i")).toEqual({ id: "i", type: "distance", a, b, value: 12.5, flip: true });
    expect(mateFromPending({ mode: "angle", compId: "x", a, b, value: NaN }, "i")).toEqual({ id: "i", type: "angle", a, b, value: 0 });
    expect(mateFromPending({ mode: "distance", compId: "x", a }, "i")).toBeNull();
    expect(mateFromPending({ mode: "dir", compId: "x", a, b }, "i")).toBeNull();
    expect(mateFaceKind("concentric")).toBe("cylinder");
    expect((["mate", "flush", "center", "distance", "angle", "parallel"] as const).map(mateFaceKind)).toEqual(Array(6).fill("plane"));
    expect((["distance", "angle", "mate", "fixed", "dir"] as const).map((m) => mateNeedsValue(m))).toEqual([true, true, false, false, false]);
  });
});

describe("vazby sestavy – vazba Ukotvit", () => {
  it("přidání ukotví komponentu a řešič pak hýbe druhou; smazání / potlačení ji uvolní", () => {
    const d = asm(2);
    const [c1, c2] = ids(d);
    d.components![0].fixed = false;
    const d1 = toggleFixedMate(d, c2, "fx");
    expect(d1.mates).toEqual([{ id: "fx", type: "fixed", a: { compId: c2, face: -1 }, b: { compId: c2, face: -1 } }]);
    expect(d1.components![1].fixed).toBe(true);
    expect(hasFixedMate(d1, c2)).toBe(true);
    expect(hasFixedMate(d1, c1)).toBe(false);
    const d2: CadDoc = { ...d1, mates: [...d1.mates!, { id: "m1", type: "mate", a: { compId: c2, face: 1 }, b: { compId: c1, face: 0 } }] };
    const r = solveMates(d2, geo);
    expect(r.status).toEqual({ fx: "ok", m1: "ok" });
    expect(r.moved).toEqual([c1]);
    samePlacement(r.components[1].placement, d.components![1].placement);
    // potlačení uvolní, zapnutí znovu ukotví
    const sup = patchMate(d2, "fx", { suppressed: true });
    expect(sup.components![1].fixed).toBe(false);
    expect(hasFixedMate(sup, c2)).toBe(false);
    expect(patchMate(sup, "fx", { suppressed: false }).components![1].fixed).toBe(true);
    // smazání ze seznamu vazeb = uvolnění; ostatní vazby zůstanou
    const del = removeMate(d2, "fx");
    expect(del.mates!.map((m) => m.id)).toEqual(["m1"]);
    expect(del.components![1].fixed).toBe(false);
    expect(removeMate(d2, "m1").components![1].fixed).toBe(true); // smazání jiné vazby ukotvení nemění
    // druhé kliknutí na Ukotvit vazbu odebere; „Uvolnit“ zruší příznak i vazby
    expect(toggleFixedMate(d2, c2, "x").mates!.map((m) => m.id)).toEqual(["m1"]);
    expect(toggleFixedMate(d2, c2, "x").components![1].fixed).toBe(false);
    const rel = releaseComponent(d2, c2);
    expect(rel.mates!.map((m) => m.id)).toEqual(["m1"]);
    expect(rel.components![1].fixed).toBe(false);
    expect(removeMate(d2, "nic")).toBe(d2);
    expect(patchMate(d2, "nic", { value: 1 })).toBe(d2);
  });
  it("vazba Ukotvit bez příznaku `fixed` (z JSON): první komponenta už není implicitní kotva", () => {
    const d = asm(2);
    const [c1, c2] = ids(d);
    d.components![0].fixed = false;
    d.mates = [
      { id: "fx", type: "fixed", a: { compId: c2, face: -1 }, b: { compId: c2, face: -1 } },
      { id: "m1", type: "mate", a: { compId: c2, face: 1 }, b: { compId: c1, face: 0 } },
    ];
    const r = solveMates(d, geo);
    expect(r.status).toEqual({ fx: "ok", m1: "ok" });
    expect(r.moved).toEqual([c1]);
    expect(r.components[0].placement.position).toEqual([0, 0, -5]); // kostka 1 se posune pod spodní plochu kostky 2 (ta stojí)
    samePlacement(r.components[1].placement, d.components![1].placement);
  });
});

describe("vazby sestavy – seznam ploch komponenty", () => {
  it("faceAreas sečte trojúhelníky skupiny plochy; skupiny bez plochy přeskočí", () => {
    const mesh = {
      vertices: new Float32Array([0, 0, 0, 2, 0, 0, 2, 3, 0, 0, 3, 0, 0, 0, 5]),
      triangles: new Uint32Array([0, 1, 2, 0, 2, 3, 0, 1, 4, 0, 3, 4]),
      faceGroups: new Int32Array([0, 6, 0, 6, 3, 2, 9, 3, -1]),
    };
    const a = faceAreas(mesh);
    expect(a[0]).toBeCloseTo(6, 6);
    expect(a[1]).toBeUndefined();
    expect(a[2]).toBeCloseTo(5, 6);
    expect(a.length).toBe(3);
  });
  it("faceRow převede plochu dílu do souřadnic sestavy; popis je čitelný", () => {
    const at: Placement = { position: [10, 0, 0], rotation: [0, 0, 0] };
    const top = faceRow(0, FACES[0], at, 100)!;
    expect(top).toEqual({ face: 0, kind: "plane", origin: [10, 0, 5], normal: [0, 0, 1], area: 100 });
    expect(faceLabel(top)).toEqual({ title: "Plocha 1 · rovinná · normála +Z", detail: "střed 10; 0; 5 · 100 mm²" });
    // natočená komponenta: normála se otočí s ní
    const turned = faceRow(0, FACES[0], { position: [0, 0, 0], rotation: [90, 0, 0] }, 12.345)!;
    expect(Math.abs(turned.normal[1])).toBeCloseTo(1, 6);
    expect(faceLabel(turned).title).toMatch(/^Plocha 1 · rovinná · normála [+−]Y$/);
    expect(faceLabel(turned).detail).toMatch(/ · 12,3 mm²$/);
    // válec: střed osy v rozsahu plochy, průměr a délka
    const hole = faceRow(3, { kind: "cylinder", origin: [0, 0, 0], normal: [0, 0, 1], radius: 4, extent: [2, 12] }, { position: [5, 5, 0], rotation: [0, 0, 0] })!;
    expect(hole).toMatchObject({ face: 3, kind: "cylinder", origin: [5, 5, 7], normal: [0, 0, 1], radius: 4, length: 10 });
    expect(faceLabel(hole)).toEqual({ title: "Plocha 4 · válcová Ø8 · osa Z", detail: "střed osy 5; 5; 7 · délka 10 mm" });
    const cone = faceRow(5, { kind: "cylinder", origin: [0, 0, 0], normal: [0, 0, -1], radius: 4, extent: [0, 2], cone: true }, at)!;
    expect(faceLabel(cone).title).toBe("Plocha 6 · kuželová · osa Z");
    expect(faceRow(7, { kind: "other", origin: [0, 0, 0], normal: [0, 0, 1] }, at)).toBeNull();
  });
  it("sortFaceRows: rovinné od největší, válcové od největšího průměru; směry se popisují osami", () => {
    const row = (face: number, kind: "plane" | "cylinder", x: { area?: number; radius?: number; length?: number }) => ({ face, kind, origin: [0, 0, 0] as Vec3, normal: [0, 0, 1] as Vec3, ...x });
    const rows = [row(0, "cylinder", { radius: 2, length: 5 }), row(1, "plane", { area: 10 }), row(2, "plane", { area: 400 }), row(3, "cylinder", { radius: 6, length: 1 }), row(4, "plane", { area: 10 }), row(5, "cylinder", { radius: 2, length: 9 })];
    expect(sortFaceRows(rows).map((r) => r.face)).toEqual([2, 1, 4, 3, 5, 0]);
    expect(rows.map((r) => r.face)).toEqual([0, 1, 2, 3, 4, 5]); // vstup se nemění
    expect(dirLabel([0, 0, -3])).toBe("−Z");
    expect(dirLabel([1, 0, 0])).toBe("+X");
    expect(dirLabel([1, 1, 0])).toBe("0,71; 0,71; 0");
    expect(axisLabel([0, -1, 0])).toBe("Y");
    expect(axisLabel([-1, -1, 0])).toBe("0,71; 0,71; 0");
    expect(snapDir([0, 1e-9, -2])).toEqual([0, 0, -1]);
    expect(Object.is(snapDir([0, -1e-9, 2])[1], 0)).toBe(true); // žádná −0 v polích formuláře
  });
});
