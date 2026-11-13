import path from "node:path";
import { beforeAll, describe, expect, it } from "vitest";
import * as r from "replicad";
import opencascade from "replicad-opencascadejs";
import { buildDoc } from "../build";
import { newExtFeature } from "../defaults";
import { continuityReport, cvInfo } from "../surf-a";
import { emptyDoc, type CadDoc, type Feature, type SketchEntity, type SketchPlane } from "../types";

beforeAll(async () => {
  const oc = await (opencascade as unknown as (o: object) => Promise<unknown>)({
    locateFile: () => path.resolve(__dirname, "../../../node_modules/replicad-opencascadejs/dist/replicad_single.wasm"),
    print: () => undefined,
    printErr: () => undefined,
  });
  r.setOC(oc as never);
}, 60_000);

let n = 0;
const id = () => `f${++n}`;
const XY: SketchPlane = { kind: "base", name: "XY", offset: 0 };
const XZ: SketchPlane = { kind: "base", name: "XZ", offset: 0 };
const sketch = (plane: SketchPlane, entities: SketchEntity[]): Feature => ({ id: id(), name: `Skica ${n}`, type: "sketch", plane, entities });
const base = (features: Feature[]): CadDoc => ({ ...emptyDoc("Test"), features });
const ext = (features: Feature[], ext: string, data: Record<string, unknown>): Feature => {
  const f = newExtFeature(base(features), ext);
  if (f.type === "ext") f.data = { ...f.data, ...data };
  return f;
};
const build = async (features: Feature[]) => {
  const res = await buildDoc(base(features));
  return { res, errors: res.status.filter((s) => !s.ok).map((s) => s.error), body: res.body! };
};
const edgeNear = (body: r.AnyShape, p: [number, number, number]) => {
  let best = -1;
  let bd = Infinity;
  body.edges.forEach((e, i) => {
    const m = e.pointAt(0.5);
    const d = Math.hypot(m.x - p[0], m.y - p[1], m.z - p[2]);
    if (d < bd) [bd, best] = [d, i];
  });
  return best;
};
const arc = (cx: number, R: number, a0: number, a1: number): SketchEntity => {
  const P = (a: number): [number, number] => [cx + R * Math.cos((a * Math.PI) / 180), R * Math.sin((a * Math.PI) / 180)];
  return { id: id(), type: "arc", a: P(a0), b: P((a0 + a1) / 2), c: P(a1) };
};

describe("plochy třídy A v dokumentu", () => {
  it("výplň otvoru v kulové zóně (G1) – stav ✓ a analýza G1 < 0,1°", async () => {
    // profil = oblouk koule R 50 od rovníku k otvoru r 15, rotace kolem Z → kulová zóna s otvorem nahoře
    const zTop = Math.sqrt(50 * 50 - 15 * 15);
    const sk = sketch(XZ, [{ id: id(), type: "arc", a: [50, 0], b: [50 * Math.cos(0.6), 50 * Math.sin(0.6)], c: [15, zTop] }]);
    const rev = ext([sk], "surf.revolve", { sketchId: sk.id, angle: 360, axis: { kind: "sketchY" } });
    const pre = await build([sk, rev]);
    expect(pre.errors).toEqual([]);
    const hole = edgeNear(pre.body, [15, 0, zTop]);
    const fill = ext([sk, rev], "surf.fill", { edges: [hole], continuity: "G1" });
    const x = await build([sk, rev, fill]);
    expect(x.errors).toEqual([]);
    expect(x.res.status[2].warning ?? "").toBe("");
    expect(x.body.faces.length).toBe(2);
    const rep = continuityReport(x.body).filter((c) => c.faces.length === 2 && c.faces.includes(1) && c.faces.includes(0));
    expect(rep.length).toBeGreaterThan(0);
    expect(Math.max(...rep.map((c) => c.g1))).toBeLessThan(0.1);
    expect(Math.max(...rep.map((c) => c.g0))).toBeLessThan(0.01);
  }, 120_000);

  it("přechod G2 mezi dvěma pásy a prodloužení G2 – analýza tříd", async () => {
    const skA = sketch(XY, [arc(0, 50, 180, 270)]);
    const skB = sketch(XY, [arc(100, 50, 270, 360)]);
    const exA = ext([skA], "surf.extrude", { sketchId: skA.id, distance: 40 });
    const exB = ext([skA, exA, skB], "surf.extrude", { sketchId: skB.id, distance: 40 });
    const feats = [skA, exA, skB, exB];
    const pre = await build(feats);
    expect(pre.errors).toEqual([]);
    const eA = edgeNear(pre.body, [0, -50, 20]);
    const eB = edgeNear(pre.body, [100, -50, 20]);
    const blend = ext(feats, "surf.blend", { edges: [eA, eB], contA: "G2", contB: "G2" });
    const x = await build([...feats, blend]);
    expect(x.errors).toEqual([]);
    expect(x.body.faces.length).toBe(3);
    const rep = continuityReport(x.body).filter((c) => c.faces.includes(2) && c.faces.length === 2);
    // každé rozhraní se ukáže dvakrát (hrana přechodu i hrana pásu – plochy nejsou sešité)
    expect(rep.length).toBe(4);
    expect(rep.every((c) => c.cls === "G2")).toBe(true);
    // prodloužení pásu A přes jeho svislou hranu na druhém konci (úhel 180°) o 10 mm s G2
    const eFar = edgeNear(pre.body, [-50, 0, 20]);
    const extd = ext(feats, "surf.extendEdge", { edges: [eFar], length: 10, continuity: "G2" });
    const y = await build([...feats, extd]);
    expect(y.errors).toEqual([]);
    // pás A (π/2 · 50 · 40 = 3 142) + prodloužení 10 × 40 = 400 + pás B 3 142
    expect(y.res.metrics!.area).toBeGreaterThan(3142 * 2 + 395);
    expect(y.res.metrics!.area).toBeLessThan(3142 * 2 + 405);
    const ry = continuityReport(y.body).filter((c) => c.shared && c.faces.length === 2);
    expect(ry.length).toBe(1);
    expect(ry[0].cls).toBe("G2");
  }, 120_000);

  it("CV: síť 4×4 na rovinné ploše a posun CV [2,2] o (0, 0, 1,5) zvedne plochu o 0,296 mm; číslo plochy zůstane", async () => {
    const sk = sketch(XY, [{ id: id(), type: "rect", cx: 50, cy: 50, w: 100, h: 100, r: 0, angle: 0 }]);
    const pl = ext([sk], "surf.planar", { sketchId: sk.id });
    const cv = ext([sk, pl], "surf.cv", { faces: [0], gridU: 4, gridV: 4, moves: [{ i: 2, j: 2, d: [0, 0, 1.5] }] });
    const x = await build([sk, pl, cv]);
    expect(x.errors).toEqual([]);
    expect(x.res.metrics!.bbox[1][2]).toBeCloseTo(1.5 * (4 / 9) ** 2, 3);
    expect(x.body.faces.length).toBe(1);
    const info = cvInfo(x.body.faces[0]);
    expect([info.nu, info.nv]).toEqual([4, 4]);
    expect(info.poles[1][1][2]).toBeCloseTo(1.5, 9);
    // řada v = 4 o 3 mm
    const cv2 = ext([sk, pl], "surf.cv", { faces: [0], gridU: 4, gridV: 4, rows: [{ dir: "v", index: 4, d: [0, 0, 3] }] });
    const y = await build([sk, pl, cv2]);
    expect(y.errors).toEqual([]);
    expect(y.res.metrics!.bbox[1][2]).toBeCloseTo(3, 6);
  }, 120_000);
});
