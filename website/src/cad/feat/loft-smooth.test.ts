import path from "node:path";
import { beforeAll, describe, expect, it } from "vitest";
import * as r from "replicad";
import opencascade from "replicad-opencascadejs";
import { buildDoc, sketchWires } from "../build";
import { checkShape } from "../check";
import { smoothClosedLoft } from "./loft-smooth";
import { surfD2, surfNormal, V3 } from "../surf-geom";
import { parseAgentText } from "../agent";
import { emptyDoc, type Feature, type SketchEntity, type Vec3 } from "../types";

beforeAll(async () => {
  const oc = await (opencascade as unknown as (o: object) => Promise<unknown>)({
    locateFile: () => path.resolve(__dirname, "../../../node_modules/replicad-opencascadejs/dist/replicad_single.wasm"),
    print: () => undefined,
    printErr: () => undefined,
  });
  r.setOC(oc as never);
}, 60_000);

type SketchF = Extract<Feature, { type: "sketch" }>;
/** profil v rovině kolmé na kružnici o poloměru R (úhel a °), entita v souřadnicích roviny (x = radiálně, y = Z) */
const ringSketch = (id: string, aDeg: number, ent: SketchEntity): SketchF => {
  const a = (aDeg * Math.PI) / 180;
  const xDir: Vec3 = [Math.cos(a), Math.sin(a), 0];
  const normal: Vec3 = [-Math.sin(a), Math.cos(a), 0];
  return { id, name: id, type: "sketch", plane: { kind: "custom", origin: [0, 0, 0], normal, xDir }, entities: [ent] };
};
const circ = (cx: number, r_: number): SketchEntity => ({ id: "c", type: "circle", cx, cy: 0, r: r_ });
const ell = (cx: number, rx: number, ry: number): SketchEntity => ({ id: "e", type: "ellipse", cx, cy: 0, rx, ry, angle: 0 });

describe("hladké uzavřené šablonování (periodická plocha)", () => {
  it("prstenec z kružnic: objem ≈ torus, platné těleso, šev bez hrany (normála < 0,1°, C2)", () => {
    const sks = [0, 72, 144, 216, 288].map((a, k) => ringSketch(`s${k}`, a, circ(40, 5)));
    const wires = sks.map((s) => sketchWires(s)[0].wire);
    const { solid, surface, period, deviation } = smoothClosedLoft(wires);
    // torus 2π²Rr² = 19 739 mm³ – 5 profilů: plocha mezi profily mírně odstává od ideální kružnice páteře (< 1,5 %)
    const vol = r.measureVolume(solid);
    expect(vol).toBeGreaterThan(19739 * 0.985);
    expect(vol).toBeLessThan(19739 * 1.015);
    expect(checkShape(solid).valid).toBe(true);
    expect(deviation).toBeLessThan(0.01);
    // šev ve směru mezi profily (v = 0 ≡ v = perioda) a po obvodu profilu (u = 0 ≡ u = N)
    let maxV = 0;
    let maxU = 0;
    let maxD2 = 0;
    for (let k = 0; k < 24; k++) {
      const u = (period.u * k) / 24;
      const a = surfD2(surface, u, 1e-9);
      const b = surfD2(surface, u, period.v - 1e-9);
      maxV = Math.max(maxV, V3.angle(surfNormal(a), surfNormal(b)));
      maxD2 = Math.max(maxD2, V3.dist(a.dvv, b.dvv) / Math.max(1e-9, V3.len(a.dvv)));
      const v = (period.v * k) / 24;
      maxU = Math.max(maxU, V3.angle(surfNormal(surfD2(surface, 1e-9, v)), surfNormal(surfD2(surface, period.u - 1e-9, v))));
    }
    expect(maxV).toBeLessThan(0.1);
    expect(maxU).toBeLessThan(0.1);
    expect(maxD2).toBeLessThan(1e-3); // druhá derivace spojitá (C2 → G2)
  }, 60_000);

  it("prvek šablonování closed + smooth v dokumentu; obyčejné uzavřené má ve švu hranu", async () => {
    const sks = [0, 90, 180, 270].map((a, k) => ringSketch(`s${k}`, a, ell(50, 8 + 3 * (k % 2), 5)));
    const loft = (smooth: boolean): Feature => ({ id: "L", name: "Šablonování", type: "loft", sketchIds: sks.map((s) => s.id), ruled: false, mode: "new", closed: true, smooth });
    const hard = await buildDoc({ ...emptyDoc("T"), features: [...sks, loft(false)] });
    const soft = await buildDoc({ ...emptyDoc("T"), features: [...sks, loft(true)] });
    expect(soft.status.map((s) => s.error ?? "")).toEqual(["", "", "", "", ""]);
    expect(soft.metrics!.valid).toBe(true);
    // hladká varianta je jediná periodická plocha; uzavřená bez vyhlazení má šev napříč (víc ploch / hran)
    expect(soft.metrics!.faces).toBe(1);
    expect(hard.metrics!.faces).toBeGreaterThanOrEqual(1);
    // Pappus: 2π·R·průměrná plocha elipsy (8×5 a 11×5) ≈ 46 810 mm³; čtyři profily → plocha mezi nimi lehce pod ideálem
    const ideal = 2 * Math.PI * 50 * ((Math.PI * 8 * 5 + Math.PI * 11 * 5) / 2);
    expect(Math.abs(soft.metrics!.volume - ideal) / ideal).toBeLessThan(0.05);
    expect(hard.metrics!.volume).toBeGreaterThan(0);
  }, 120_000);

  it("ostré rohy profilu → varování s odchylkou", async () => {
    const rect: SketchEntity = { id: "q", type: "rect", cx: 40, cy: 0, w: 10, h: 10, r: 0, angle: 0 };
    const sks = [0, 90, 180, 270].map((a, k) => ringSketch(`s${k}`, a, rect));
    const res = await buildDoc({ ...emptyDoc("T"), features: [...sks, { id: "L", name: "Š", type: "loft", sketchIds: sks.map((s) => s.id), ruled: false, mode: "new", closed: true, smooth: true }] });
    const st = res.status[res.status.length - 1];
    expect(st.ok).toBe(true);
    expect(st.warning ?? "").toMatch(/odchylkou až/);
  }, 120_000);

  it("text: prvek loft … closed=ano smooth=ano", () => {
    const prog = parseAgentText('prvek loft sketchIds=["a","b","c"] closed=ano smooth=ano');
    expect(prog.errors).toEqual([]);
    const f = (prog.ops[0] as { feature: Extract<Feature, { type: "loft" }> }).feature;
    expect(f.closed).toBe(true);
    expect(f.smooth).toBe(true);
  });
});
