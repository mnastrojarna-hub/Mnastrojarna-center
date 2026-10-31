import { describe, expect, it } from "vitest";
import { applyShrinkage, coolingCircuit, draftAnalysis, draftVertexColors, shrinkageScale, suggestEjectors, suggestPartingZ } from "./mold";
import { emptyDoc, type MeshData } from "./types";

/** Jednoduchá síť: komolý jehlan (úkos stěn `draftDeg`) o výšce h na čtvercové základně. */
function frustum(size: number, h: number, draftDeg: number): MeshData {
  const s = size / 2;
  const t = s - h * Math.tan((draftDeg * Math.PI) / 180);
  const v = [
    [-s, -s, 0], [s, -s, 0], [s, s, 0], [-s, s, 0], // 0-3 dole
    [-t, -t, h], [t, -t, h], [t, t, h], [-t, t, h], // 4-7 nahoře
  ];
  const faces = [
    [0, 2, 1], [0, 3, 2], // dno (normála −Z)
    [4, 5, 6], [4, 6, 7], // víko (+Z)
    [0, 1, 5], [0, 5, 4], // −Y stěna
    [1, 2, 6], [1, 6, 5], // +X
    [2, 3, 7], [2, 7, 6], // +Y
    [3, 0, 4], [3, 4, 7], // −X
  ];
  const vertices = new Float32Array(v.flat());
  const triangles = new Uint32Array(faces.flat());
  return { vertices, normals: new Float32Array(vertices.length), triangles, faceGroups: new Int32Array(0), lines: new Float32Array(0), edgeGroups: new Int32Array(0) };
}

describe("analýza úkosů", () => {
  it("komolý jehlan s úkosem 3° je celý v pořádku při požadavku 1°", () => {
    const r = draftAnalysis(frustum(100, 40, 3), [0, 0, 1], 1);
    expect(r.undercutRatio).toBe(0);
    expect(r.areas[3]).toBe(0);
    expect(r.areas[1]).toBe(0);
    expect(r.areas[0]).toBeGreaterThan(0);
  });
  it("svislé stěny se označí jako svislé, obrácený jehlan jako podkos", () => {
    const vertical = draftAnalysis(frustum(100, 40, 0), [0, 0, 1], 1);
    expect(vertical.areas[2]).toBeCloseTo(4 * 100 * 40, 0);
    const under = draftAnalysis(frustum(100, 40, -5), [0, 0, 1], 1);
    expect(under.undercutRatio).toBeGreaterThan(0.3);
    expect(under.areas[3]).toBeGreaterThan(0);
  });
  it("malý úkos 0,5° při požadavku 1° je žlutý; barvy vrcholů odpovídají", () => {
    const m = frustum(100, 40, 0.5);
    const r = draftAnalysis(m, [0, 0, 1], 1);
    expect(r.areas[1]).toBeGreaterThan(0);
    const c = draftVertexColors(m, r);
    expect(c.length).toBe(m.vertices.length);
    expect(Math.max(...c)).toBeGreaterThan(0);
  });
});

describe("smrštění", () => {
  it("měřítko a transformace v historii", () => {
    expect(shrinkageScale(1.5)).toBeCloseTo(1.015, 9);
    const d = applyShrinkage(emptyDoc("Díl"), 2);
    const f = d.features.at(-1)!;
    expect(f.type).toBe("transform");
    if (f.type === "transform") expect(f.scale).toBeCloseTo(1.02, 9);
  });
});

describe("vyhazovače a chlazení", () => {
  it("návrh vyhazovačů leží uvnitř půdorysu", () => {
    const e = suggestEjectors([[0, 0, 0], [120, 80, 30]]);
    expect(e.length).toBeGreaterThanOrEqual(4);
    for (const p of e) {
      expect(p.x).toBeGreaterThan(0);
      expect(p.x).toBeLessThan(120);
      expect(p.y).toBeGreaterThan(0);
      expect(p.y).toBeLessThan(80);
    }
  });
  it("malý díl dostane jeden vyhazovač uprostřed", () => {
    const e = suggestEjectors([[0, 0, 0], [8, 8, 5]]);
    expect(e).toHaveLength(1);
    expect(e[0].x).toBeCloseTo(4);
  });
  it("chladicí okruh je meandr: n kanálů + n−1 propojek", () => {
    const d = coolingCircuit({ bbox: [[0, 0, 0], [200, 150, 40]], diameter: 8, depth: 20, rows: 3, overhang: 30 });
    expect(d.features.filter((f) => f.name.startsWith("Kanál"))).toHaveLength(3);
    expect(d.features.filter((f) => f.name.startsWith("Propojka"))).toHaveLength(2);
    expect(d.features[0].type).toBe("cylinder");
  });
  it("dělicí rovina komolého jehlanu je u základny (největší obvod)", () => {
    const r = suggestPartingZ(frustum(100, 40, 5), 20);
    expect(r.z).toBeCloseTo(0, 5);
    expect(r.perimeter).toBeCloseTo(400, 0);
  });
});
