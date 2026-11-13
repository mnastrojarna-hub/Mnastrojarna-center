import { describe, expect, it } from "vitest";
import { axisSection, facePlane, faceSection, formatVector, isGeneralSection, parseVector, projectionRange, sectionDistance, sectionKey, sectionNormal, sectionOrigin, sectionPlane, sectionPoint, toVectorSection, unitVec, vectorSection, type PlaneMesh, type SectionState } from "./section-plane";
import type { Vec3 } from "./types";

/** Kvádr 40 × 30 × 20 (plochy: 0 spodní, 1 horní, 2 přední −Y, 3 zadní +Y, 4 levá −X, 5 pravá +X) a válcová plocha 6. */
function sample(): PlaneMesh & { triangles: Uint32Array; faceGroups: Int32Array } {
  const [x0, y0, z0, x1, y1, z1] = [0, 0, 0, 40, 30, 20];
  const faces: Vec3[][] = [
    [[x0, y0, z0], [x0, y1, z0], [x1, y1, z0], [x1, y0, z0]],
    [[x0, y0, z1], [x1, y0, z1], [x1, y1, z1], [x0, y1, z1]],
    [[x0, y0, z0], [x1, y0, z0], [x1, y0, z1], [x0, y0, z1]],
    [[x1, y1, z0], [x0, y1, z0], [x0, y1, z1], [x1, y1, z1]],
    [[x0, y1, z0], [x0, y0, z0], [x0, y0, z1], [x0, y1, z1]],
    [[x1, y0, z0], [x1, y1, z0], [x1, y1, z1], [x1, y0, z1]],
  ];
  const v: number[] = [];
  const t: number[] = [];
  const g: number[] = [];
  faces.forEach((f, i) => {
    for (const p of f) v.push(...p);
    t.push(i * 4, i * 4 + 1, i * 4 + 2, i * 4, i * 4 + 2, i * 4 + 3);
    g.push(i * 6, 6, i);
  });
  // plocha 6: čtvrtválec o poloměru 10 kolem osy Z (zakřivená)
  const base = v.length / 3;
  const seg = 8;
  for (let k = 0; k <= seg; k++) {
    const a = (k / seg) * (Math.PI / 2);
    v.push(60 + 10 * Math.cos(a), 10 * Math.sin(a), 0, 60 + 10 * Math.cos(a), 10 * Math.sin(a), 20);
  }
  const start = t.length;
  for (let k = 0; k < seg; k++) {
    const a = base + k * 2;
    t.push(a, a + 2, a + 1, a + 1, a + 2, a + 3);
  }
  g.push(start, t.length - start, 6);
  return { vertices: new Float32Array(v), triangles: new Uint32Array(t), faceGroups: new Int32Array(g) };
}
const box = (): PlaneMesh => {
  const s = sample();
  return { vertices: s.vertices.slice(0, 24 * 3), triangles: s.triangles.slice(0, 36), faceGroups: s.faceGroups.slice(0, 18) };
};
const close = (a: Vec3, b: Vec3, digits = 6) => a.forEach((v, i) => expect(v).toBeCloseTo(b[i], digits));

describe("rovina řezu – osová (dosavadní chování)", () => {
  it("X a Z ponechají část ≤ poloha, Y část ≥ poloha; otočení stranu obrátí", () => {
    expect(sectionPlane({ axis: "X", offset: 12, flip: false })).toEqual({ normal: [-1, 0, 0], constant: 12 });
    expect(sectionPlane({ axis: "Y", offset: 12, flip: false })).toEqual({ normal: [0, 1, 0], constant: -12 });
    expect(sectionPlane({ axis: "Z", offset: 12, flip: false })).toEqual({ normal: [0, 0, -1], constant: 12 });
    expect(sectionPlane({ axis: "X", offset: 12, flip: true })).toEqual({ normal: [1, 0, 0], constant: -12 });
    expect(sectionPlane({ axis: "Y", offset: 12, flip: true })).toEqual({ normal: [0, -1, 0], constant: 12 });
    expect(sectionPlane({ axis: "Z", offset: -3.5, flip: true })).toEqual({ normal: [0, 0, 1], constant: 3.5 });
  });

  it("shoduje se s původním vzorcem 3D okna pro všechny osy, strany a polohy", () => {
    for (const axis of ["X", "Y", "Z"] as const)
      for (const flip of [false, true])
        for (const offset of [-17.25, 0, 3, 120.5]) {
          const sign = (axis === "Y" ? 1 : -1) * (flip ? -1 : 1);
          const n: Vec3 = [axis === "X" ? sign : 0, axis === "Y" ? sign : 0, axis === "Z" ? sign : 0];
          const pl = sectionPlane({ axis, offset, flip });
          close(pl.normal, n, 12);
          expect(pl.constant).toBeCloseTo(-sign * offset, 12);
        }
  });

  it("vzdálenost bodu: kladná na zachované straně", () => {
    const s: SectionState = { axis: "Z", offset: 10, flip: false };
    expect(sectionDistance(s, [0, 0, 4])).toBeCloseTo(6, 12);
    expect(sectionDistance(s, [0, 0, 15])).toBeCloseTo(-5, 12);
    expect(sectionDistance({ ...s, flip: true }, [0, 0, 15])).toBeCloseTo(5, 12);
    expect(sectionNormal(s)).toEqual([0, 0, 1]);
    expect(sectionOrigin(s)).toEqual([0, 0, 0]);
    expect(sectionPoint(s)).toEqual([0, 0, 10]);
    expect(isGeneralSection(s)).toBe(false);
  });
});

describe("rovina řezu – obecná", () => {
  it("normála se normalizuje, poloha se měří ve směru normály od zadaného bodu", () => {
    const s: SectionState = { axis: "X", offset: 5, flip: false, normal: [0, 0, 4], origin: [1, 2, 20] };
    expect(isGeneralSection(s)).toBe(true);
    expect(sectionNormal(s)).toEqual([0, 0, 1]);
    expect(sectionOrigin(s)).toEqual([1, 2, 20]);
    expect(sectionPoint(s)).toEqual([1, 2, 25]);
    // zůstává n·(p − origin) ≤ offset, tj. z ≤ 25
    expect(sectionPlane(s)).toEqual({ normal: [0, 0, -1], constant: 25 });
    expect(sectionDistance(s, [0, 0, 20])).toBeCloseTo(5, 12);
    expect(sectionDistance(s, [0, 0, 30])).toBeCloseTo(-5, 12);
    expect(sectionPlane({ ...s, flip: true })).toEqual({ normal: [0, 0, 1], constant: -25 });
  });

  it("obecná rovina s normálou osy dává tutéž rovinu jako osový řez (X, Z)", () => {
    for (const [axis, n] of [["X", [1, 0, 0]], ["Z", [0, 0, 1]]] as [SectionState["axis"], Vec3][]) {
      const a = sectionPlane({ axis, offset: 7.5, flip: false });
      const g = sectionPlane({ axis: "Y", offset: 7.5, flip: false, normal: n });
      expect(g).toEqual(a);
    }
  });

  it("šikmá rovina: bod na rovině má nulovou vzdálenost, posun o 1 mm změní vzdálenost o 1 mm", () => {
    const s: SectionState = { axis: "X", offset: 3, flip: false, normal: [1, 1, 0], origin: [10, 0, 0] };
    const n = sectionNormal(s);
    close(n, [Math.SQRT1_2, Math.SQRT1_2, 0], 12);
    const p = sectionPoint(s);
    expect(sectionDistance(s, p)).toBeCloseTo(0, 9);
    expect(sectionDistance(s, [p[0] - n[0], p[1] - n[1], p[2] - n[2]])).toBeCloseTo(1, 9);
    expect(sectionDistance({ ...s, offset: 4 }, p)).toBeCloseTo(1, 9);
    // normála roviny ořezu je jednotková
    const pl = sectionPlane(s);
    expect(Math.hypot(...pl.normal)).toBeCloseTo(1, 12);
  });

  it("nulová normála se ignoruje (platí osa)", () => {
    const s: SectionState = { axis: "Y", offset: 2, flip: false, normal: [0, 0, 0], origin: [5, 5, 5] };
    expect(isGeneralSection(s)).toBe(false);
    expect(sectionPlane(s)).toEqual({ normal: [0, 1, 0], constant: -2 });
    expect(sectionOrigin(s)).toEqual([0, 0, 0]);
    expect(unitVec([0, 0, 0])).toBeNull();
    expect(unitVec([NaN, 0, 1])).toBeNull();
    expect(unitVec(undefined)).toBeNull();
  });

  it("klíč stavu se mění s polohou, stranou i normálou", () => {
    const a: SectionState = { axis: "X", offset: 1, flip: false };
    const keys = new Set([sectionKey(a), sectionKey({ ...a, offset: 2 }), sectionKey({ ...a, flip: true }), sectionKey({ ...a, axis: "Z" }), sectionKey({ ...a, normal: [1, 1, 0] }), sectionKey({ ...a, normal: [1, 1, 0], origin: [5, 0, 0] })]);
    expect(keys.size).toBe(6);
    expect(sectionKey(null)).toBe("");
    expect(sectionKey({ ...a })).toBe(sectionKey(a));
  });
});

describe("rovina řezu – rovina z plochy tělesa", () => {
  it("rovinné plochy kvádru: bod na ploše a normála ven", () => {
    const m = sample();
    const exp: [number, Vec3, Vec3][] = [
      [0, [20, 15, 0], [0, 0, -1]],
      [1, [20, 15, 20], [0, 0, 1]],
      [2, [20, 0, 10], [0, -1, 0]],
      [3, [20, 30, 10], [0, 1, 0]],
      [4, [0, 15, 10], [-1, 0, 0]],
      [5, [40, 15, 10], [1, 0, 0]],
    ];
    for (const [i, o, n] of exp) {
      const p = facePlane(m, i)!;
      expect(p).not.toBeNull();
      close(p.origin, o);
      close(p.normal, n);
    }
  });

  it("zakřivená a neexistující plocha → null", () => {
    const m = sample();
    expect(facePlane(m, 6)).toBeNull();
    expect(facePlane(m, 99)).toBeNull();
    expect(facePlane({ vertices: m.vertices }, 0)).toBeNull();
  });

  it("komponenta sestavy: rovina se převede maticí umístění (otočení o 90° kolem Z + posun)", () => {
    const m = { ...box(), matrix: [0, 1, 0, 0, -1, 0, 0, 0, 0, 0, 1, 0, 100, 0, 5, 1] };
    const p = facePlane(m, 5)!; // pravá (+X) → po otočení míří do +Y
    close(p.normal, [0, 1, 0]);
    close(p.origin, [100 - 15, 40, 15]);
    const top = facePlane(m, 1)!;
    close(top.normal, [0, 0, 1]);
    close(top.origin, [85, 20, 25]);
  });

  it("řez z plochy: rovina leží na ploše a zachová těleso; záporný posun řeže do materiálu", () => {
    const m = box();
    const p = facePlane(m, 1)!;
    const s = faceSection({ axis: "Y", offset: 9, flip: true }, p, 1);
    expect(s.offset).toBe(0);
    expect(s.flip).toBe(false);
    expect(s.source).toEqual({ kind: "face", index: 1 });
    // všechny vrcholy tělesa jsou na zachované straně (s tolerancí)
    const V = m.vertices;
    for (let j = 0; j < V.length; j += 3) expect(sectionDistance(s, [V[j], V[j + 1], V[j + 2]])).toBeGreaterThanOrEqual(-1e-6);
    // posun −5 mm: rovina z = 15, zůstává z ≤ 15
    const cut = { ...s, offset: -5 };
    expect(sectionPlane(cut).normal).toEqual([0, 0, -1]);
    expect(sectionPlane(cut).constant).toBeCloseTo(15, 6);
    expect(sectionDistance(cut, [0, 0, 20])).toBeCloseTo(-5, 6);
    // rozsah posuvníku: od protější stěny (−20) po plochu (0)
    const r = projectionRange([m], sectionNormal(s), sectionOrigin(s))!;
    expect(r[0]).toBeCloseTo(-20, 5);
    expect(r[1]).toBeCloseTo(0, 5);
    expect(faceSection(s, p, 3, "c1").source).toEqual({ kind: "face", index: 3, compId: "c1" });
  });
});

describe("rovina řezu – rozsah modelu a zadání vektorem", () => {
  it("rozsah na osách odpovídá ohraničení, u šikmé normály průmětu rohů", () => {
    const m = box();
    expect(projectionRange([m], [1, 0, 0])).toEqual([0, 40]);
    expect(projectionRange([m], [0, 5, 0])).toEqual([0, 30]);
    expect(projectionRange([m], [0, 0, 1])).toEqual([0, 20]);
    const r = projectionRange([m], [1, 1, 0])!;
    expect(r[0]).toBeCloseTo(0, 5);
    expect(r[1]).toBeCloseTo(70 * Math.SQRT1_2, 4);
    expect(projectionRange([m], [1, 0, 0], [10, 0, 0])).toEqual([-10, 30]);
    expect(projectionRange([], [1, 0, 0])).toBeNull();
    expect(projectionRange([m], [0, 0, 0])).toBeNull();
    // sestava: dvě komponenty, druhá posunutá o 100 v X
    const moved = { ...box(), matrix: [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 100, 0, 0, 1] };
    expect(projectionRange([m, moved], [1, 0, 0])).toEqual([0, 140]);
  });

  it("osový a vektorový řez začínají uprostřed modelu", () => {
    const m = box();
    expect(axisSection("X", [m])).toEqual({ axis: "X", offset: 20, flip: false });
    expect(axisSection("Z", [m], true)).toEqual({ axis: "Z", offset: 10, flip: true });
    expect(axisSection("Y", [])).toEqual({ axis: "Y", offset: 0, flip: false });
    const v = vectorSection({ axis: "Y", offset: 1, flip: true }, [1, 0, 1], [m]);
    expect(v.normal).toEqual([1, 0, 1]);
    expect(v.origin).toEqual([0, 0, 0]);
    expect(v.source).toEqual({ kind: "vector" });
    expect(v.flip).toBe(true);
    expect(v.offset).toBeCloseTo(round2((60 * Math.SQRT1_2) / 2), 9);
    // nulová normála stav nezmění
    const prev: SectionState = { axis: "Y", offset: 1, flip: true };
    expect(vectorSection(prev, [0, 0, 0], [m])).toBe(prev);
  });

  it("převod na zadání vektorem zachová rovinu i stranu (osový řez i rovina z plochy)", () => {
    const same = (a: SectionState, b: SectionState) => {
      const pa = sectionPlane(a), pb = sectionPlane(b);
      close(pa.normal, pb.normal, 5);
      expect(pb.constant).toBeCloseTo(pa.constant, 3);
    };
    for (const axis of ["X", "Y", "Z"] as const)
      for (const flip of [false, true]) {
        const s: SectionState = { axis, offset: 7.25, flip };
        const v = toVectorSection(s);
        expect(v.source).toEqual({ kind: "vector" });
        expect(v.origin).toEqual([0, 0, 0]);
        expect(v.offset).toBe(7.25);
        same(s, v);
      }
    const face: SectionState = { axis: "X", offset: -4, flip: false, normal: [1, 1, 0], origin: [10, 20, 5], source: { kind: "face", index: 3 } };
    const v = toVectorSection(face);
    expect(v.offset).toBeCloseTo(30 * Math.SQRT1_2 - 4, 4);
    same(face, v);
    same({ ...face, flip: true }, toVectorSection({ ...face, flip: true }));
  });

  it("zápis a čtení vektoru: středníky, mezery, desetinná čárka, výrazy", () => {
    expect(parseVector("1; 0; 1")).toEqual([1, 0, 1]);
    expect(parseVector("0,5;0;-2.5")).toEqual([0.5, 0, -2.5]);
    expect(parseVector("1 0 -1")).toEqual([1, 0, -1]);
    expect(parseVector("(0; 1; 0)")).toEqual([0, 1, 0]);
    expect(parseVector("1/2; sqrt(4); 2*3")).toEqual([0.5, 2, 6]);
    const c = parseVector("cos(30); sin(30); 0");
    expect(c[0]).toBeCloseTo(Math.cos(Math.PI / 6), 12);
    expect(c[1]).toBeCloseTo(0.5, 12);
    expect(() => parseVector("0; 0; 0")).toThrow();
    expect(() => parseVector("1; 2")).toThrow();
    expect(() => parseVector("1; ; 2")).toThrow();
    expect(() => parseVector("a; b; c")).toThrow();
    expect(() => parseVector("")).toThrow();
    expect(formatVector([0.70710678, 0, -0.5])).toBe("0.7071; 0; -0.5");
    expect(parseVector(formatVector([0.25, -1, 3]))).toEqual([0.25, -1, 3]);
  });
});

const round2 = (v: number) => Math.round(v * 100) / 100;
