import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import { circleFrom3, classifyPolyline, computeTopology, smallestEigenvector, weldVertices } from "./topology";
import { occtToModel, type OcctResult } from "./occt";
import { parseStl } from "./formats/mesh";

const FIX = path.join(__dirname, "__fixtures__");
const require = createRequire(import.meta.url);

/** Kvádr s plochami zvlášť (jako z OpenCascade): 6 ploch × 4 vrcholy, 2 trojúhelníky na plochu. */
function boxBrep(sx: number, sy: number, sz: number) {
  const c = [
    [0, 0, 0], [sx, 0, 0], [sx, sy, 0], [0, sy, 0],
    [0, 0, sz], [sx, 0, sz], [sx, sy, sz], [0, sy, sz],
  ];
  const quads = [[0, 3, 2, 1], [4, 5, 6, 7], [0, 1, 5, 4], [1, 2, 6, 5], [2, 3, 7, 6], [3, 0, 4, 7]];
  const pos: number[] = [];
  const idx: number[] = [];
  const faces: { first: number; last: number }[] = [];
  quads.forEach((q, f) => {
    const base = pos.length / 3;
    for (const v of q) pos.push(...c[v]);
    idx.push(base, base + 1, base + 2, base, base + 2, base + 3);
    faces.push({ first: f * 2, last: f * 2 + 1 });
  });
  return { positions: new Float32Array(pos), indices: new Uint32Array(idx), faces };
}

/** Válec (plášť + 2 víka) jako B-rep: 3 plochy, vrcholy na hranách duplikované. */
function cylinderBrep(r: number, h: number, n: number) {
  const pos: number[] = [];
  const idx: number[] = [];
  const faces: { first: number; last: number }[] = [];
  let tri = 0;
  // plášť (šev: první a poslední sloupec mají stejné body, ale jiné vrcholy)
  const side = pos.length / 3;
  for (let i = 0; i <= n; i++) {
    const a = (i / n) * Math.PI * 2;
    pos.push(r * Math.cos(a), r * Math.sin(a), 0, r * Math.cos(a), r * Math.sin(a), h);
  }
  for (let i = 0; i < n; i++) {
    const b = side + i * 2;
    idx.push(b, b + 2, b + 3, b, b + 3, b + 1);
  }
  faces.push({ first: tri, last: tri + n * 2 - 1 });
  tri += n * 2;
  for (const z of [0, h]) {
    const center = pos.length / 3;
    pos.push(0, 0, z);
    for (let i = 0; i < n; i++) {
      const a = (i / n) * Math.PI * 2;
      pos.push(r * Math.cos(a), r * Math.sin(a), z);
    }
    for (let i = 0; i < n; i++) idx.push(center, center + 1 + i, center + 1 + ((i + 1) % n));
    faces.push({ first: tri, last: tri + n - 1 });
    tri += n;
  }
  return { positions: new Float32Array(pos), indices: new Uint32Array(idx), faces };
}

describe("weldVertices", () => {
  it("svaří shodné body a ponechá různé", () => {
    const p = new Float32Array([0, 0, 0, 1, 0, 0, 0, 0, 0, 1, 0, 0, 2, 0, 0]);
    const w = weldVertices(p, 1e-6);
    expect(w.count).toBe(3);
    expect(w.ids[0]).toBe(w.ids[2]);
    expect(w.ids[1]).toBe(w.ids[3]);
    expect(w.ids[4]).not.toBe(w.ids[0]);
  });
});

describe("geometrie křivek", () => {
  it("kružnice třemi body", () => {
    const c = circleFrom3([5, 0, 1], [0, 5, 1], [-5, 0, 1])!;
    expect(c.radius).toBeCloseTo(5, 9);
    expect(c.center[0]).toBeCloseTo(0, 9);
    expect(c.center[2]).toBeCloseTo(1, 9);
    expect(Math.abs(c.normal[2])).toBeCloseTo(1, 9);
    expect(circleFrom3([0, 0, 0], [1, 1, 1], [2, 2, 2])).toBeNull();
  });

  it("rozpozná úsečku, kružnici a oblouk", () => {
    const line = classifyPolyline(new Float64Array([0, 0, 0, 1, 0, 0, 3, 0, 0]), false, 1e-6);
    expect(line.kind).toBe("line");
    expect(line.length).toBeCloseTo(3);
    expect(line.mid[0]).toBeCloseTo(1.5);

    const ring: number[] = [];
    for (let i = 0; i < 24; i++) ring.push(10 + 4 * Math.cos((i / 24) * 2 * Math.PI), 4 * Math.sin((i / 24) * 2 * Math.PI), 7);
    const circle = classifyPolyline(new Float64Array(ring), true, 1e-6);
    expect(circle.kind).toBe("circle");
    expect(circle.radius).toBeCloseTo(4, 6);
    expect(circle.center![0]).toBeCloseTo(10, 6);

    const arcPts: number[] = [];
    for (let i = 0; i <= 6; i++) arcPts.push(3 * Math.cos((i / 6) * (Math.PI / 2)), 3 * Math.sin((i / 6) * (Math.PI / 2)), 0);
    const arc = classifyPolyline(new Float64Array(arcPts), false, 1e-6);
    expect(arc.kind).toBe("arc");
    expect(arc.radius).toBeCloseTo(3, 6);
  });

  it("nejmenší vlastní vektor", () => {
    // normály ležící v rovině XY → osa Z
    const v = smallestEigenvector([1, 0, 0, 0, 1, 0, 0, 0, 0]);
    expect(Math.abs(v[2])).toBeCloseTo(1, 9);
  });
});

describe("computeTopology", () => {
  it("kvádr z B-repu: 12 hran, 8 rohů, 6 rovin", () => {
    const t = computeTopology(boxBrep(10, 20, 30));
    expect(t.curves).toHaveLength(12);
    expect(t.curves.every((c) => c.kind === "line")).toBe(true);
    expect(t.corners.length / 3).toBe(8);
    expect(t.faces).toHaveLength(6);
    expect(t.faces.every((f) => f.kind === "plane")).toBe(true);
    const lengths = t.curves.map((c) => Math.round(c.length)).sort((a, b) => a - b);
    expect(lengths).toEqual([10, 10, 10, 10, 20, 20, 20, 20, 30, 30, 30, 30]);
    expect(t.edgeSegments.length / 6).toBe(12);
    expect(t.faces.reduce((s, f) => s + f.area, 0)).toBeCloseTo(2 * (10 * 20 + 20 * 30 + 10 * 30), 3);
  });

  it("válec: 2 kružnice se středem a poloměrem, plášť jako válec, šev není hrana", () => {
    const t = computeTopology(cylinderBrep(6, 15, 32));
    const circles = t.curves.filter((c) => c.kind === "circle");
    expect(circles).toHaveLength(2);
    for (const c of circles) {
      expect(c.radius).toBeCloseTo(6, 4);
      expect(Math.hypot(c.center![0], c.center![1])).toBeLessThan(1e-4);
    }
    expect(t.curves).toHaveLength(2);
    const cyl = t.faces.find((f) => f.kind === "cylinder")!;
    expect(cyl.radius).toBeCloseTo(6, 3);
    expect(Math.abs(cyl.normal![2])).toBeCloseTo(1, 6);
    expect(t.faces.filter((f) => f.kind === "plane")).toHaveLength(2);
  });

  it("síť bez ploch (STL): plochy podle úhlů, ostré hrany", () => {
    const b = boxBrep(5, 5, 5);
    // bez informace o plochách — jako STL
    const t = computeTopology({ positions: b.positions, indices: b.indices });
    expect(t.faces).toHaveLength(6);
    expect(t.curves).toHaveLength(12);
  });
});

describe("OpenCascade → model → topologie (skutečné soubory)", () => {
  async function occt() {
    const factory = require("occt-import-js") as () => Promise<{
      ReadStepFile: (b: Uint8Array, p: unknown) => OcctResult;
      ReadIgesFile: (b: Uint8Array, p: unknown) => OcctResult;
    }>;
    return factory();
  }

  it("STEP kostka", async () => {
    const o = await occt();
    const m = occtToModel(o.ReadStepFile(new Uint8Array(fs.readFileSync(path.join(FIX, "cube.stp"))), null), "STEP");
    expect(m.parts).toHaveLength(1);
    expect(m.parts[0].faces).toHaveLength(6);
    const t = computeTopology({ positions: m.parts[0].positions, indices: m.parts[0].indices, faces: m.parts[0].faces });
    expect(t.curves).toHaveLength(12);
    expect(t.corners.length / 3).toBe(8);
  });

  it("STEP se zaoblením: oblouky a válcová plocha R5", async () => {
    const o = await occt();
    const m = occtToModel(o.ReadStepFile(new Uint8Array(fs.readFileSync(path.join(FIX, "rounded-cube.step"))), null), "STEP");
    const p = m.parts[0];
    const t = computeTopology({ positions: p.positions, indices: p.indices, faces: p.faces });
    expect(t.curves.filter((c) => c.kind === "arc")).toHaveLength(2);
    const cyl = t.faces.filter((f) => f.kind === "cylinder");
    expect(cyl).toHaveLength(1);
    expect(cyl[0].radius).toBeCloseTo(5, 2);
  });

  it("STEP s kuželem: kružnice Ø11", async () => {
    const o = await occt();
    const m = occtToModel(o.ReadStepFile(new Uint8Array(fs.readFileSync(path.join(FIX, "conical-surface.step"))), null), "STEP");
    const p = m.parts[0];
    const t = computeTopology({ positions: p.positions, indices: p.indices, faces: p.faces });
    const diameters = t.curves.filter((c) => c.kind === "circle").map((c) => Math.round(c.radius! * 2 * 1000) / 1000);
    expect(diameters).toContain(11);
  });

  it("IGES kostka 10 mm (černá barva = bez barvy)", async () => {
    const o = await occt();
    const m = occtToModel(o.ReadIgesFile(new Uint8Array(fs.readFileSync(path.join(FIX, "cube-10mm.igs"))), null), "IGES");
    expect(m.parts[0].color).toBeNull();
    const t = computeTopology({ positions: m.parts[0].positions, indices: m.parts[0].indices, faces: m.parts[0].faces });
    for (const c of t.curves) expect(c.length).toBeCloseTo(10, 3);
  });

  it("STL kostka 10 mm", () => {
    const m = parseStl(new Uint8Array(fs.readFileSync(path.join(FIX, "cube-10mm.stl"))), "kostka");
    expect(m.parts).toHaveLength(1);
    const t = computeTopology({ positions: m.parts[0].positions, indices: m.parts[0].indices });
    expect(t.curves).toHaveLength(12);
    expect(t.faces.filter((f) => f.kind === "plane")).toHaveLength(6);
  });

  it("velká síť (≈ 500 tis. trojúhelníků) do pár sekund", () => {
    // koule z UV sítě
    const seg = 500;
    const ring = 500;
    const pos = new Float32Array((seg + 1) * (ring + 1) * 3);
    let k = 0;
    for (let i = 0; i <= ring; i++) {
      const th = (i / ring) * Math.PI;
      for (let j = 0; j <= seg; j++) {
        const ph = (j / seg) * Math.PI * 2;
        pos[k++] = 50 * Math.sin(th) * Math.cos(ph);
        pos[k++] = 50 * Math.sin(th) * Math.sin(ph);
        pos[k++] = 50 * Math.cos(th);
      }
    }
    const idx = new Uint32Array(ring * seg * 6);
    k = 0;
    for (let i = 0; i < ring; i++) {
      for (let j = 0; j < seg; j++) {
        const a = i * (seg + 1) + j;
        const b = a + seg + 1;
        idx[k++] = a; idx[k++] = b; idx[k++] = a + 1;
        idx[k++] = b; idx[k++] = b + 1; idx[k++] = a + 1;
      }
    }
    const t0 = Date.now();
    const t = computeTopology({ positions: pos, indices: idx });
    expect(Date.now() - t0).toBeLessThan(8000);
    // hladká koule: žádné ostré hrany
    expect(t.curves.length).toBe(0);
  });
});

describe("okrajové případy", () => {
  it("díl bez trojúhelníků (jen čáry) — prázdná topologie, žádná chyba", () => {
    const t = computeTopology({ positions: new Float32Array(0), indices: null });
    expect(t.curves).toHaveLength(0);
    expect(t.faces).toHaveLength(0);
    expect(t.edgeSegments.length).toBe(0);
  });
});
