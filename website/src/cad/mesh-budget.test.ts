import path from "node:path";
import { beforeAll, describe, expect, it } from "vitest";
import * as r from "replicad";
import opencascade from "replicad-opencascadejs";
import { BIG_FACES, LIGHT_ANGULAR, LIGHT_DIVISOR, meshMetrics, meshParams, quickDiag } from "./mesh-budget";
import { MESH_ANGULAR, meshTolerance } from "./fastbool";
import { shapeResult } from "./build";

beforeAll(async () => {
  const oc = await (opencascade as unknown as (o: object) => Promise<unknown>)({
    locateFile: () => path.resolve(__dirname, "../../node_modules/replicad-opencascadejs/dist/replicad_single.wasm"),
    print: () => undefined,
    printErr: () => undefined,
  });
  r.setOC(oc as never);
}, 60_000);

describe("jemnost sítě podle velikosti a složitosti", () => {
  it("běžné modely beze změny, velká tělesa hrubší (nejvýš 4×), lehké komponenty úhlopříčka/800", () => {
    expect(meshParams(200, 50)).toEqual({ tolerance: meshTolerance(200), angular: MESH_ANGULAR });
    expect(meshParams(200, BIG_FACES)).toEqual({ tolerance: meshTolerance(200), angular: MESH_ANGULAR });
    const big = meshParams(5000, BIG_FACES * 4);
    expect(big.tolerance).toBeCloseTo(meshTolerance(5000) * 2, 9);
    expect(big.angular).toBeGreaterThan(MESH_ANGULAR);
    expect(meshParams(5000, BIG_FACES * 100).tolerance).toBeCloseTo(meshTolerance(5000) * 4, 9);
    // monotónní v počtu ploch
    let prev = 0;
    for (const f of [10, 1000, 2000, 5000, 20000, 1e6]) {
      const t = meshParams(1000, f).tolerance;
      expect(t).toBeGreaterThanOrEqual(prev);
      prev = t;
    }
    expect(meshParams(100, 0, true)).toEqual({ tolerance: 100 / LIGHT_DIVISOR, angular: LIGHT_ANGULAR });
    expect(meshParams(0, 0, true).tolerance).toBeGreaterThan(0);
  });

  it("objem, plocha a kvádr ze sítě: krychle 10 mm", () => {
    // 8 vrcholů, 12 trojúhelníků s normálami ven
    const v = new Float32Array([0, 0, 0, 10, 0, 0, 10, 10, 0, 0, 10, 0, 0, 0, 10, 10, 0, 10, 10, 10, 10, 0, 10, 10]);
    const t = new Uint32Array([0, 2, 1, 0, 3, 2, 4, 5, 6, 4, 6, 7, 0, 1, 5, 0, 5, 4, 1, 2, 6, 1, 6, 5, 2, 3, 7, 2, 7, 6, 3, 0, 4, 3, 4, 7]);
    const m = meshMetrics(v, t);
    expect(m.volume).toBeCloseTo(1000, 6);
    expect(m.area).toBeCloseTo(600, 6);
    expect(m.bbox).toEqual([[0, 0, 0], [10, 10, 10]]);
    expect(meshMetrics(new Float32Array(0), new Uint32Array(0)).volume).toBe(0);
  });

  it("lehký výsledek tělesa: objem ze sítě blízko přesnému, rychlý kvádr, bez kontroly platnosti", () => {
    const s = r.makeCylinder(20, 100, [5000, 0, 0], [0, 0, 1]).fuse(r.makeBox([4990, -30, -5], [5010, 30, 5])) as r.Shape3D;
    const exact = shapeResult(s.clone() as r.Shape3D);
    const light = shapeResult(s.clone() as r.Shape3D, { light: true });
    expect(exact.metrics!.valid).toBe(true);
    expect(light.metrics!.valid).toBeUndefined();
    expect(Math.abs(light.metrics!.volume - exact.metrics!.volume) / exact.metrics!.volume).toBeLessThan(0.01);
    expect(light.metrics!.bbox[0][0]).toBeCloseTo(4980, 0);
    expect(light.mesh!.triangles.length).toBeLessThanOrEqual(exact.mesh!.triangles.length);
    expect(quickDiag(s)).toBeGreaterThanOrEqual(Math.hypot(40, 60, 100) - 1e-6);
  });
});
