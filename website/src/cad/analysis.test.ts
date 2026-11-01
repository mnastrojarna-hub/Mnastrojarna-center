import { describe, expect, it } from "vitest";
import { curvatureColors, vertexCurvature, wallThickness } from "./analysis";
import type { MeshData } from "./types";

/** krychle 10 mm jako síť s normálami po plochách (každá stěna 4 vrcholy) */
function cube(s = 10): MeshData {
  const faces: { n: [number, number, number]; pts: [number, number, number][] }[] = [];
  const h = s / 2;
  const axes: [number, number, number][] = [[1, 0, 0], [-1, 0, 0], [0, 1, 0], [0, -1, 0], [0, 0, 1], [0, 0, -1]];
  for (const n of axes) {
    const u: [number, number, number] = n[0] ? [0, 1, 0] : [1, 0, 0];
    const w: [number, number, number] = [n[1] * u[2] - n[2] * u[1], n[2] * u[0] - n[0] * u[2], n[0] * u[1] - n[1] * u[0]];
    const c = n.map((x) => x * h);
    const pts = [[-1, -1], [1, -1], [1, 1], [-1, 1]].map(([a, b]) => [c[0] + a * h * u[0] + b * h * w[0], c[1] + a * h * u[1] + b * h * w[1], c[2] + a * h * u[2] + b * h * w[2]] as [number, number, number]);
    faces.push({ n, pts });
  }
  const vertices: number[] = [];
  const normals: number[] = [];
  const triangles: number[] = [];
  faces.forEach((f, i) => {
    f.pts.forEach((p) => {
      vertices.push(...p);
      normals.push(...f.n);
    });
    triangles.push(i * 4, i * 4 + 1, i * 4 + 2, i * 4, i * 4 + 2, i * 4 + 3);
  });
  return { vertices: new Float32Array(vertices), normals: new Float32Array(normals), triangles: new Uint32Array(triangles), faceGroups: new Int32Array(0), lines: new Float32Array(0), edgeGroups: new Int32Array(0) };
}

describe("analýza ploch", () => {
  it("rovinné stěny mají nulovou křivost a zelenou barvu", () => {
    const m = cube();
    const k = vertexCurvature(m);
    expect(Math.max(...Array.from(k, Math.abs))).toBeLessThan(1e-6);
    const c = curvatureColors(m, 0.1);
    expect(c.colors[1]).toBeCloseTo(1, 5); // G
  });
  it("tloušťka stěny krychle = hrana", () => {
    const r = wallThickness(cube(10), 1, 100);
    expect(r.min).toBeCloseTo(10, 3);
    expect(r.below).toBe(0);
    const thin = wallThickness(cube(0.5), 1, 100);
    expect(thin.below).toBeGreaterThan(0.9);
  });
});
