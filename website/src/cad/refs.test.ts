import path from "node:path";
import { beforeAll, describe, expect, it } from "vitest";
import * as r from "replicad";
import opencascade from "replicad-opencascadejs";
import { buildDoc } from "./build";
import { refInfo } from "./ref-resolve";
import { emptyDoc, type CadDoc, type Feature } from "./types";

beforeAll(async () => {
  const oc = await (opencascade as unknown as (o: object) => Promise<unknown>)({
    locateFile: () => path.resolve(__dirname, "../../node_modules/replicad-opencascadejs/dist/replicad_single.wasm"),
    print: () => undefined,
    printErr: () => undefined,
  });
  r.setOC(oc as never);
}, 60_000);

const box = (id: string, size: [number, number, number], position: [number, number, number], mode: "new" | "add" = "add"): Feature => ({ id, name: id, type: "box", size, position, centered: false, mode });
const circleSketch = (id: string, z: number, cx = 30, cy = 20, rad = 5): Feature => ({ id, name: id, type: "sketch", plane: { kind: "base", name: "XY", offset: z }, entities: [{ id: "c", type: "circle", cx, cy, r: rad }] });
const rectSketch = (id: string, z: number, w = 20, h = 10): Feature => ({ id, name: id, type: "sketch", plane: { kind: "base", name: "XY", offset: z }, entities: [{ id: "r", type: "rect", cx: 30, cy: 20, w, h, r: 0, angle: 0 }] });
const doc = (features: Feature[]): CadDoc => ({ ...emptyDoc("t"), features });
const vol = async (d: CadDoc) => {
  const res = await buildDoc(d);
  const bad = res.status.filter((s) => !s.ok);
  if (bad.length) throw new Error(bad.map((b) => b.error).join("; "));
  return res.metrics!.volume;
};
const A = Math.PI * 25; // plocha kruhu r=5

describe("vysunutí – ukončení", () => {
  const base = [box("A", [60, 40, 20], [0, 0, 0], "new")];
  it("skrz vše (cut) prořízne celý kvádr", async () => {
    const v = await vol(doc([...base, circleSketch("s", 20), { id: "e", name: "e", type: "extrude", sketchId: "s", distance: 5, symmetric: false, reverse: true, mode: "cut", extent: { kind: "throughAll" } }]));
    expect(v).toBeCloseTo(60 * 40 * 20 - A * 20, 0);
  });
  it("k dalšímu (cut) odebere jen první stěnu", async () => {
    // dvě desky: 0–20 a 30–50, díra shora skrz horní desku jen
    const v = await vol(doc([...base, box("B", [60, 40, 20], [0, 0, 30]), circleSketch("s", 50), { id: "e", name: "e", type: "extrude", sketchId: "s", distance: 5, symmetric: false, reverse: true, mode: "cut", extent: { kind: "toNext" } }]));
    expect(v).toBeCloseTo(2 * 60 * 40 * 20 - A * 20, 0);
  });
  it("k dalšímu (add) vyplní mezeru po další plochu", async () => {
    const v = await vol(doc([...base, box("B", [60, 40, 20], [0, 0, 30]), circleSketch("s", 20), { id: "e", name: "e", type: "extrude", sketchId: "s", distance: 5, symmetric: false, reverse: false, mode: "add", extent: { kind: "toNext" } }]));
    expect(v).toBeCloseTo(2 * 60 * 40 * 20 + A * 10, 0);
  });
  it("k ploše (rovinná, šikmo) a odsazeně od plochy", async () => {
    // horní plocha kvádru A: index najdeme přes refInfo – použijeme pomocnou rovinu místo toho (deterministické)
    const d = doc([...base, { id: "dt", name: "dt", type: "datum", origin: [0, 0, 35], normal: [0, 0, 1], xDir: [1, 0, 0], size: 50 }, circleSketch("s", 20), { id: "e", name: "e", type: "extrude", sketchId: "s", distance: 5, symmetric: false, reverse: false, mode: "add", extent: { kind: "toFace", ref: { kind: "datum", featureId: "dt" } } }]);
    expect(await vol(d)).toBeCloseTo(60 * 40 * 20 + A * 15, 0);
    const d2 = doc([...base, { id: "dt", name: "dt", type: "datum", origin: [0, 0, 35], normal: [0, 0, 1], xDir: [1, 0, 0], size: 50 }, circleSketch("s", 20), { id: "e", name: "e", type: "extrude", sketchId: "s", distance: 5, symmetric: false, reverse: false, mode: "add", extent: { kind: "offsetFromFace", ref: { kind: "datum", featureId: "dt" }, d: 5 } }]);
    expect(await vol(d2)).toBeCloseTo(60 * 40 * 20 + A * 10, 0);
  });
  it("k ploše tělesa (extrudeUntil) – skutečná plocha", async () => {
    const d = doc([...base, box("B", [60, 40, 20], [0, 0, 30]), circleSketch("s", 20), { id: "e", name: "e", type: "extrude", sketchId: "s", distance: 5, symmetric: false, reverse: false, mode: "add", extent: { kind: "toFace", ref: { kind: "face", index: -1 } } }]);
    // najít spodní plochu horní desky (střed z=30, normála -Z)
    const res = await buildDoc(doc([...base, box("B", [60, 40, 20], [0, 0, 30])]));
    const body = res.body!;
    const idx = body.faces.findIndex((f) => Math.abs(f.center.z - 30) < 1e-6 && f.geomType === "PLANE");
    expect(idx).toBeGreaterThanOrEqual(0);
    (d.features[3] as Extract<Feature, { type: "extrude" }>).extent = { kind: "toFace", ref: { kind: "face", index: idx } };
    expect(await vol(d)).toBeCloseTo(2 * 60 * 40 * 20 + A * 10, 0);
  });
  it("k vrcholu, střední rovina, dva směry", async () => {
    const vtx = doc([...base, circleSketch("s", 20), { id: "e", name: "e", type: "extrude", sketchId: "s", distance: 5, symmetric: false, reverse: false, mode: "add", extent: { kind: "toVertex", ref: { kind: "xyz", p: [0, 0, 32] } } }]);
    expect(await vol(vtx)).toBeCloseTo(60 * 40 * 20 + A * 12, 0);
    const mid = doc([circleSketch("s", 0), { id: "e", name: "e", type: "extrude", sketchId: "s", distance: 5, symmetric: false, reverse: false, mode: "new", extent: { kind: "midPlane", d: 30 } }]);
    const res = await buildDoc(mid);
    expect(res.metrics!.bbox[0][2]).toBeCloseTo(-15, 5);
    expect(res.metrics!.bbox[1][2]).toBeCloseTo(15, 5);
    const two = doc([circleSketch("s", 0), { id: "e", name: "e", type: "extrude", sketchId: "s", distance: 5, symmetric: false, reverse: false, mode: "new", extent: { kind: "blind", d: 10 }, extent2: { kind: "blind", d: 4 } }]);
    const r2 = await buildDoc(two);
    expect(r2.metrics!.bbox[0][2]).toBeCloseTo(-4, 5);
    expect(r2.metrics!.bbox[1][2]).toBeCloseTo(10, 5);
  });
  it("začátek odsazením, směr pod úhlem, tenká stěna, bez otvorů, kroucení", async () => {
    const from = doc([circleSketch("s", 0), { id: "e", name: "e", type: "extrude", sketchId: "s", distance: 10, symmetric: false, reverse: false, mode: "new", from: { kind: "offset", d: 7 } }]);
    const rf = await buildDoc(from);
    expect(rf.metrics!.bbox[0][2]).toBeCloseTo(7, 5);
    const ang = doc([rectSketch("s", 0), { id: "e", name: "e", type: "extrude", sketchId: "s", distance: 10, symmetric: false, reverse: false, mode: "new", dir: { kind: "angle", deg: 30 } }]);
    const ra = await buildDoc(ang);
    expect(ra.metrics!.volume).toBeCloseTo(20 * 10 * 10 * Math.cos(Math.PI / 6), 0); // délka 10 podél šikmého směru → výška 10·cos30°
    const thin = doc([circleSketch("s", 0), { id: "e", name: "e", type: "extrude", sketchId: "s", distance: 10, symmetric: false, reverse: false, mode: "new", thin: { side: "one", t1: 2 } }]);
    expect(await vol(thin)).toBeCloseTo(Math.PI * (49 - 25) * 10, 0);
    const holes: Feature = { id: "s", name: "s", type: "sketch", plane: { kind: "base", name: "XY", offset: 0 }, entities: [{ id: "o", type: "circle", cx: 0, cy: 0, r: 10 }, { id: "i", type: "circle", cx: 0, cy: 0, r: 4 }] };
    expect(await vol(doc([holes, { id: "e", name: "e", type: "extrude", sketchId: "s", distance: 10, symmetric: false, reverse: false, mode: "new" }]))).toBeCloseTo(Math.PI * (100 - 16) * 10, 0);
    expect(await vol(doc([holes, { id: "e", name: "e", type: "extrude", sketchId: "s", distance: 10, symmetric: false, reverse: false, mode: "new", outerOnly: true }]))).toBeCloseTo(Math.PI * 100 * 10, 0);
    const tw = doc([rectSketch("s", 0), { id: "e", name: "e", type: "extrude", sketchId: "s", distance: 10, symmetric: false, reverse: false, mode: "new", twist: 45 }]);
    expect(await vol(tw)).toBeGreaterThan(100);
  });
});

describe("rotace a díry", () => {
  it("rotace kolem globální osy, symetricky a dvěma směry", async () => {
    const sk: Feature = { id: "s", name: "s", type: "sketch", plane: { kind: "base", name: "XZ", offset: 0 }, entities: [{ id: "r", type: "rect", cx: 20, cy: 5, w: 10, h: 10, r: 0, angle: 0 }] };
    const full = await vol(doc([sk, { id: "rv", name: "rv", type: "revolve", sketchId: "s", angle: 360, axis: "y", mode: "new", axisDef: { kind: "global", axis: "Z" } }]));
    expect(full).toBeCloseTo(Math.PI * (25 * 25 - 15 * 15) * 10, 0);
    const half = await vol(doc([sk, { id: "rv", name: "rv", type: "revolve", sketchId: "s", angle: 90, axis: "y", mode: "new", axisDef: { kind: "global", axis: "Z" }, symmetric: true }]));
    expect(half).toBeCloseTo(full / 4, 0);
    const two = await vol(doc([sk, { id: "rv", name: "rv", type: "revolve", sketchId: "s", angle: 90, axis: "y", mode: "new", axisDef: { kind: "global", axis: "Z" }, angle2: 90 }]));
    expect(two).toBeCloseTo(full / 2, 0);
  });
  it("díra: více poloh, k dalšímu, k ploše, libovolný směr", async () => {
    const base = [box("A", [60, 40, 20], [0, 0, 0], "new"), box("B", [60, 40, 20], [0, 0, 30])];
    const hole = (extra: Partial<Extract<Feature, { type: "hole" }>>): Feature => ({ id: "h", name: "h", type: "hole", position: [15, 20, 50], axis: "Z", flip: false, diameter: 10, depth: 0, cbDiameter: 0, cbDepth: 0, ...extra });
    const two = await vol(doc([...base, hole({ points: [{ kind: "xyz", p: [15, 20, 50] }, { kind: "xyz", p: [45, 20, 50] }] })]));
    expect(two).toBeCloseTo(2 * 48000 - 2 * A * 40, 0);
    const next = await vol(doc([...base, hole({ end: { kind: "toNext" } })]));
    expect(next).toBeCloseTo(2 * 48000 - A * 20, 0);
    const toFace = await vol(doc([...base, { id: "dt", name: "dt", type: "datum", origin: [0, 0, 40], normal: [0, 0, 1], xDir: [1, 0, 0], size: 50 }, hole({ end: { kind: "toFace", ref: { kind: "datum", featureId: "dt" } } })]));
    expect(toFace).toBeCloseTo(2 * 48000 - A * 10, 0);
    const side = await vol(doc([box("A", [60, 40, 20], [0, 0, 0], "new"), hole({ position: [60, 20, 10], dirDef: { kind: "vector", v: [1, 0, 0] } })]));
    expect(side).toBeCloseTo(48000 - A * 60, 0);
  });
});

describe("asociativní roviny a odkazy", () => {
  it("skica s planeDef (rovnoběžně s plochou + odsazení) se vyřeší a vrátí rovinu", async () => {
    const d = doc([box("A", [60, 40, 20], [0, 0, 0], "new")]);
    const res0 = await buildDoc(d);
    const top = res0.body!.faces.findIndex((f) => Math.abs(f.center.z - 20) < 1e-6 && f.geomType === "PLANE");
    const sk: Feature = { id: "s", name: "s", type: "sketch", plane: { kind: "base", name: "XY", offset: 0 }, planeDef: { kind: "face", ref: { kind: "face", index: top }, offset: 5 }, entities: [{ id: "c", type: "circle", cx: 30, cy: 20, r: 5 }] };
    const res = await buildDoc(doc([...d.features, sk, { id: "e", name: "e", type: "extrude", sketchId: "s", distance: 10, symmetric: false, reverse: false, mode: "add" }]));
    expect(res.status.every((s) => s.ok)).toBe(true);
    expect(res.resolved?.planes.s).toBeTruthy();
    const p = res.resolved!.planes.s;
    expect(p.kind === "custom" && p.origin[2]).toBeCloseTo(25, 5);
    expect(res.metrics!.bbox[1][2]).toBeCloseTo(35, 5);
  });
  it("refInfo: střed hrany, střed kružnice, odvozené body, otisk přežije změnu indexů", async () => {
    const d = doc([box("A", [60, 40, 20], [0, 0, 0], "new")]);
    const res = await buildDoc(d);
    const ctx = { body: res.body, sketches: new Map(), features: d.features };
    const e0 = refInfo(ctx, { kind: "edge", index: 0, at: "mid" });
    expect(e0.geo?.point).toBeTruthy();
    expect(e0.sig?.t).toBe("LINE");
    const mid = refInfo(ctx, { kind: "derived", op: "mid", args: [{ kind: "xyz", p: [0, 0, 0] }, { kind: "xyz", p: [10, 0, 0] }] });
    expect(mid.geo?.point).toEqual([5, 0, 0]);
    const betw = refInfo(ctx, { kind: "derived", op: "between", args: [{ kind: "xyz", p: [0, 0, 0] }, { kind: "xyz", p: [10, 0, 0] }], v: 0.25 });
    expect(betw.geo?.point).toEqual([2.5, 0, 0]);
    // otisk: po přidání díry se indexy ploch změní, odkaz s otiskem najde stejnou plochu
    const top = res.body!.faces.findIndex((f) => Math.abs(f.center.z - 20) < 1e-6 && f.geomType === "PLANE");
    const sig = refInfo(ctx, { kind: "face", index: top }).sig!;
    const d2 = doc([...d.features, { id: "h", name: "h", type: "hole", position: [10, 10, 20], axis: "Z", flip: false, diameter: 6, depth: 0, cbDiameter: 0, cbDepth: 0 }]);
    const res2 = await buildDoc(d2);
    const g = refInfo({ body: res2.body, sketches: new Map(), features: d2.features }, { kind: "face", index: 0, sig }).geo!;
    expect(g.plane!.origin[2]).toBeCloseTo(20, 5);
    expect(g.plane!.normal[2]).toBeCloseTo(1, 5);
  });
});
