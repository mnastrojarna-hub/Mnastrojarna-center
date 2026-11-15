/**
 * Síť pružiny při přehrávání pohybové studie (cad/spring-coil-mesh.ts): drát zůstává kulatý v každé délce (dřív se síť jen
 * protáhla po ose – při stlačení 44 → 25 mm měl drát v ose 57 % průměru), délka a vnější průměr sítě odpovídají, broušené konce
 * tabulkové pružiny jsou rovinné v 0 a L, mezipaměť podle délky zaokrouhlené na 0,01 mm, komponenta s posunem na plochu A.
 */
import { describe, expect, it } from "vitest";
import { springGeom, springDocAt } from "./asm-spring-geom";
import { coilMeshAt, coilPathOf, springCoilView, tubeMesh } from "./spring-coil-mesh";
import { compressionSpecOf } from "./springs";
import { emptyDoc, type AsmComponent, type CadDoc, type MeshData, type Vec3 } from "./types";

const springDoc = (): CadDoc => ({ ...emptyDoc("P"), features: [{ id: "sp", name: "Pružina", type: "spring", radius: 9, pitch: 5.25, turns: 8, wire: 2, position: [0, 0, 1], axis: "Z", mode: "new" }] });
/** tabulková tlačná pružina balíku part (data prvku `spring.compression`): d 2, De 20, L0 44, n 8, broušené konce */
const tableDoc = (ends = "ground"): CadDoc => ({ ...emptyDoc("T"), features: [{ id: "tc", name: "Tlačná pružina", type: "ext", ext: "spring.compression", data: { d: 2, De: 20, L0: 44, n: 8, ends, at: [0, 0, 0], axis: "Z", mode: "new" } }] });

const bbox = (m: MeshData) => {
  const lo = [Infinity, Infinity, Infinity];
  const hi = [-Infinity, -Infinity, -Infinity];
  for (let i = 0; i < m.vertices.length; i += 3) for (let k = 0; k < 3; k++) {
    lo[k] = Math.min(lo[k], m.vertices[i + k]);
    hi[k] = Math.max(hi[k], m.vertices[i + k]);
  }
  return { lo, hi };
};
/** nejmenší a největší vzdálenost bodů kruhů sítě od střednice (bez víček a bez srovnaných broušených konců) */
function wireRadius(m: MeshData, pts: Vec3[], sides = 10): { min: number; max: number } {
  let min = Infinity;
  let max = 0;
  for (let i = 0; i < pts.length; i++)
    for (let j = 0; j <= sides; j++) {
      const q = i * (sides + 1) + j;
      const r = Math.hypot(m.vertices[q * 3] - pts[i][0], m.vertices[q * 3 + 1] - pts[i][1], m.vertices[q * 3 + 2] - pts[i][2]);
      min = Math.min(min, r);
      max = Math.max(max, r);
    }
  return { min, max };
}

describe("síť pružiny v délce kroku studie", () => {
  it("prvek Pružina: délka sítě = L, vnější Ø = 2R + d, drát kulatý i při stlačení 44 → 25 mm", () => {
    const doc = springDoc();
    expect(springGeom(doc)!.length).toBeCloseTo(44, 9);
    for (const L of [44, 30, 25]) {
      const path = coilPathOf(doc, L)!;
      const m = tubeMesh(path);
      const b = bbox(m);
      // průřez je kolmý na tečnu šroubovice (jako tažení v jádře) – konec drátu se roviny dotkne s odchylkou d/2·(1 − cos α) < 0,1 mm
      expect(Math.abs(b.lo[2])).toBeLessThan(0.1);
      expect(Math.abs(b.hi[2] - L)).toBeLessThan(0.1);
      expect(b.hi[0] - b.lo[0]).toBeCloseTo(20, 1);
      const r = wireRadius(m, path.pts);
      expect(r.min).toBeCloseTo(1, 4); // Float32 síť
      expect(r.max).toBeCloseTo(1, 4);
      expect(m.triangles.length % 3).toBe(0);
      expect(Math.max(...m.triangles)).toBeLessThan(m.vertices.length / 3);
    }
  });

  it("tabulková tlačná pružina: závěrné závity přiložené, broušené konce rovinné v 0 a L, víc bodů v rovině konce", () => {
    for (const L of [44, 30]) {
      const doc = tableDoc();
      const m = tubeMesh(coilPathOf(doc, L)!);
      const b = bbox(m);
      expect(b.lo[2]).toBeCloseTo(0, 9);
      expect(b.hi[2]).toBeCloseTo(L, 9);
      // ploška po broušení: body srovnané do roviny z = 0 (a z = L) s normálou podél osy
      let flat0 = 0;
      let flatL = 0;
      for (let i = 0; i < m.vertices.length; i += 3) {
        if (Math.abs(m.vertices[i + 2]) < 1e-9 && m.normals[i + 2] === -1) flat0++;
        if (Math.abs(m.vertices[i + 2] - L) < 1e-9 && m.normals[i + 2] === 1) flatL++;
      }
      expect(flat0).toBeGreaterThan(20);
      expect(flatL).toBeGreaterThan(20);
    }
    // stoupání z výpočtu pružin (`@/cad/springs` compressionSpecOf – stejný tvar jako jádro): závěrné závity d·1,03,
    // činné (L − 2·zs − 2·ne·pe) / n; v délce 30 mm menší, závěrné stejné
    const data = (tableDoc().features[0] as { data: Record<string, unknown> }).data;
    const s44 = compressionSpecOf(data)!;
    const s30 = compressionSpecOf(data, 30)!;
    expect(s44.pe).toBeCloseTo(2.06, 9);
    expect(s44.pa).toBeCloseTo((44 + 1 - 2 * 2.06) / 8, 9);
    expect(s30.pa).toBeCloseTo((30 + 1 - 2 * 2.06) / 8, 9);
    expect(s30.pe).toBe(s44.pe);
    // neobroušené konce: bez oříznutí
    expect(coilPathOf(tableDoc("closed"), 44)!.clip).toBeUndefined();
  });

  it("integrace vlny 21: n ≥ 17 dosáhne Ln (jedno stoupání s menší mezerou, jako jádro) a osa X jako placeSpring", () => {
    // d 2 · De 20 · n 20 · L0 60, broušené: Ln = 22·2 = 44 mm; s mezerou 3 % ve všech závitech by šlo nejvýš na 2·(−0,5) + 22·2,06 = 44,32
    const doc: CadDoc = { ...emptyDoc("N20"), features: [{ id: "n20", name: "Tlačná pružina", type: "ext", ext: "spring.compression", data: { d: 2, De: 20, L0: 60, n: 20, ends: "ground", at: [0, 0, 0], axis: "Z", mode: "new" } }] };
    const b = bbox(tubeMesh(coilPathOf(doc, 44)!));
    expect(b.lo[2]).toBeCloseTo(0, 9);
    expect(b.hi[2]).toBeCloseTo(44, 9);
    // osa X z bodu [5, 0, 0]: síť od x = 5 do 5 + L, průměr De v Y a Z
    const dx: CadDoc = { ...emptyDoc("X"), features: [{ id: "x", name: "Tlačná pružina", type: "ext", ext: "spring.compression", data: { d: 2, De: 20, L0: 44, n: 8, ends: "ground", at: [5, 0, 0], axis: "X", mode: "new" } }] };
    const bx = bbox(tubeMesh(coilPathOf(dx, 40)!));
    expect(bx.lo[0]).toBeCloseTo(5, 9);
    expect(bx.hi[0]).toBeCloseTo(45, 9);
    expect(bx.hi[1] - bx.lo[1]).toBeCloseTo(20, 1);
    expect(bx.hi[2] - bx.lo[2]).toBeCloseTo(20, 1);
  });

  it("tabulková pružina v sestavě: springGeom (osa, délka L0, Ø) a springDocAt nastaví délku tvaru `len`", () => {
    const doc = tableDoc();
    const g = springGeom(doc)!;
    expect(g.base).toEqual([0, 0, 0]);
    expect(g.axis).toEqual([0, 0, 1]);
    expect(g.length).toBe(44);
    expect(g.ring).toBe(9);
    const at30 = springDocAt(doc, 30);
    expect((at30.features[0] as { data: Record<string, unknown> }).data.len).toBe(30);
    expect(springGeom(at30)!.length).toBe(30);
  });

  it("mezipaměť podle délky zaokrouhlené na 0,01 mm; komponenta: klíč se zdrojem a délkou, posun na plochu A bez měřítka", () => {
    const doc = springDoc();
    const a = coilMeshAt(doc, 30.001);
    expect(coilMeshAt(doc, 29.999)).toBe(a);
    expect(coilMeshAt(doc, 30.02)).not.toBe(a);
    const c: AsmComponent = { id: "p", name: "P", source: { kind: "part", doc }, placement: { position: [0, 0, 0], rotation: [0, 0, 0] }, spring: { a: { compId: "A", face: 1 }, b: { compId: "B", face: 2 }, free: 44, length: 30, offset: 3 } };
    const v = springCoilView(c, "K")!;
    expect(v.key).toBe("K|coil|30");
    expect(v.mesh).toBe(a);
    expect(v.matrix).toEqual([1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 3, 1]);
    // trubka (zjednodušená pružina) – bez střednice drátu → null (zůstává protažení sítě)
    const tube: CadDoc = { ...emptyDoc("T"), features: [{ id: "t", name: "Trubka", type: "tube", outer: 20, inner: 16, height: 44, position: [0, 0, 0], axis: "Z", mode: "new" } as never] };
    expect(springCoilView({ ...c, source: { kind: "part", doc: tube } }, "T")).toBeNull();
  });

  it("výkon: síť pružiny s 20 závity pod 20 ms", () => {
    const doc: CadDoc = { ...emptyDoc("P"), features: [{ id: "sp", name: "Pružina", type: "spring", radius: 9, pitch: 3, turns: 20, wire: 2, position: [0, 0, 1], axis: "Z", mode: "new" }] };
    const t0 = performance.now();
    for (let L = 40; L < 60; L += 1) coilMeshAt(doc, L);
    expect((performance.now() - t0) / 20).toBeLessThan(20);
  });
});
