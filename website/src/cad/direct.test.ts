import path from "node:path";
import { beforeAll, describe, expect, it } from "vitest";
import * as r from "replicad";
import opencascade from "replicad-opencascadejs";
import { buildDoc, buildShape } from "./build";
import { emptyDoc, type CadDoc, type Feature } from "./types";

beforeAll(async () => {
  const oc = await (opencascade as unknown as (o: object) => Promise<unknown>)({
    locateFile: () => path.resolve(__dirname, "../../node_modules/replicad-opencascadejs/dist/replicad_single.wasm"),
    print: () => undefined,
    printErr: () => undefined,
  });
  r.setOC(oc as never);
}, 60_000);

const doc = (features: Feature[]): CadDoc => ({ ...emptyDoc("T"), features });
const box: Feature = { id: "b", name: "Kvádr", type: "box", size: [10, 10, 10], position: [0, 0, 0], centered: true, mode: "new" };
const vol = async (features: Feature[]) => {
  const res = await buildDoc(doc(features));
  const bad = res.status.filter((s) => !s.ok);
  expect(bad, bad.map((b) => b.error).join("; ")).toEqual([]);
  return res.metrics?.volume ?? 0;
};
/** index plochy, jejíž střed splňuje podmínku */
const faceWhere = async (features: Feature[], pred: (c: [number, number, number], type: string) => boolean) => {
  const { body } = await buildShape(doc(features));
  const i = body!.faces.findIndex((f) => pred([f.center.x, f.center.y, f.center.z], f.geomType));
  expect(i).toBeGreaterThanOrEqual(0);
  return i;
};

describe("přímé úpravy", () => {
  it("vytáhnout a zatlačit rovinnou plochu", async () => {
    const top = await faceWhere([box], (c, t) => t === "PLANE" && Math.abs(c[2] - 5) < 1e-6);
    expect(await vol([box, { id: "p", name: "P", type: "pushPull", faces: [top], distance: 5 }])).toBeCloseTo(1500, 3);
    expect(await vol([box, { id: "p", name: "P", type: "pushPull", faces: [top], distance: -3 }])).toBeCloseTo(700, 3);
  });
  it("vytáhnout zakřivenou plochu → chyba", async () => {
    const cyl: Feature = { id: "c", name: "V", type: "cylinder", radius: 5, height: 10, position: [0, 0, 0], axis: "Z", mode: "new" };
    const side = await faceWhere([cyl], (_c, t) => t === "CYLINDRE");
    const res = await buildDoc(doc([cyl, { id: "p", name: "P", type: "pushPull", faces: [side], distance: 2 }]));
    expect(res.status[1].ok).toBe(false);
    expect(res.status[1].error).toMatch(/rovinné/);
  });
  const hole: Feature = { id: "h", name: "Díra", type: "hole", position: [0, 0, 5], axis: "Z", flip: false, diameter: 4, depth: 0, cbDiameter: 0, cbDepth: 0 };
  it("odsadit stěnu díry (díra se zmenší)", async () => {
    const wall = await faceWhere([box, hole], (_c, t) => t === "CYLINDRE");
    const v = await vol([box, hole, { id: "o", name: "O", type: "offsetFace", faces: [wall], distance: 1 }]);
    expect(v).toBeCloseTo(1000 - Math.PI * 1 * 1 * 10, 1);
  });
  it("odstranit díru", async () => {
    const wall = await faceWhere([box, hole], (_c, t) => t === "CYLINDRE");
    expect(await vol([box, hole, { id: "d", name: "D", type: "deleteFace", faces: [wall] }])).toBeCloseTo(1000, 3);
  });
  it("odstranit čep (válcovou plochu výstupku)", async () => {
    const boss: Feature = { id: "c", name: "Čep", type: "cylinder", radius: 2, height: 6, position: [0, 0, 5], axis: "Z", mode: "add" };
    const side = await faceWhere([box, boss], (_c, t) => t === "CYLINDRE");
    expect(await vol([box, boss, { id: "d", name: "D", type: "deleteFace", faces: [side] }])).toBeCloseTo(1000, 3);
  });
  it("odstranit zaoblení hrany (vypuklé)", async () => {
    const fil: Feature = { id: "f", name: "Z", type: "fillet", radius: 2, edges: [0] };
    const before = await vol([box, fil]);
    expect(before).toBeLessThan(1000);
    const f = await faceWhere([box, fil], (_c, t) => t === "CYLINDRE");
    expect(await vol([box, fil, { id: "d", name: "D", type: "deleteFace", faces: [f] }])).toBeCloseTo(1000, 3);
  });
  it("odstranit rovinnou plochu → srozumitelná chyba", async () => {
    const res = await buildDoc(doc([box, { id: "d", name: "D", type: "deleteFace", faces: [0] }]));
    expect(res.status[1].ok).toBe(false);
    expect(res.status[1].error).toMatch(/rovinnou/);
  });
  it("zesílit horní plochu", async () => {
    const top = await faceWhere([box], (c, t) => t === "PLANE" && Math.abs(c[2] - 5) < 1e-6);
    expect(await vol([box, { id: "t", name: "Z", type: "thicken", faces: [top], thickness: 2, mode: "add" }])).toBeCloseTo(1200, 3);
  });
  it("vrcholy tělesa", async () => {
    const res = await buildDoc(doc([box]));
    expect(res.vertices?.length).toBe(24);
  });
});

describe("žebro a pružina", () => {
  const L: Feature[] = [
    { id: "s", name: "L", type: "sketch", plane: { kind: "base", name: "XZ", offset: 0 }, entities: [{ id: "p", type: "polyline", closed: true, points: [[0, 0], [80, 0], [80, 10], [10, 10], [10, 60], [0, 60]] }] },
    { id: "x", name: "V", type: "extrude", sketchId: "s", distance: 50, symmetric: true, reverse: false, mode: "new" },
  ];
  const ribSk: Feature = { id: "r", name: "Č", type: "sketch", plane: { kind: "base", name: "XZ", offset: 0 }, entities: [{ id: "l", type: "line", a: [10, 40], b: [50, 10] }] };
  it("žebro v rohu úhelníku (strana se najde sama)", async () => {
    const base = await vol(L);
    const v = await vol([...L, ribSk, { id: "rb", name: "Ž", type: "rib", sketchId: "r", thickness: 6, direction: "normal", flip: false }]);
    expect(v - base).toBeCloseTo(0.5 * 30 * 40 * 6, 0);
  });
  it("žebro kolmo k rovině skici (dolů k desce)", async () => {
    const plate: Feature = { id: "b", name: "D", type: "box", size: [100, 100, 10], position: [0, 0, 5], centered: true, mode: "new" };
    const sk: Feature = { id: "r", name: "Č", type: "sketch", plane: { kind: "base", name: "XY", offset: 30 }, entities: [{ id: "l", type: "line", a: [-30, 0], b: [30, 0] }] };
    const v = await vol([plate, sk, { id: "rb", name: "Ž", type: "rib", sketchId: "r", thickness: 4, direction: "inPlane", flip: false }]);
    expect(v - 100000).toBeCloseTo(60 * 4 * 20, 0);
  });
  it("pružina – objem drátu", async () => {
    const v = await vol([{ id: "p", name: "P", type: "spring", radius: 10, pitch: 5, turns: 4, wire: 2, position: [0, 0, 0], axis: "Z", mode: "new" }]);
    const expected = Math.PI * 1 * 1 * 4 * Math.hypot(2 * Math.PI * 10, 5);
    expect(Math.abs(v - expected) / expected).toBeLessThan(0.03);
  }, 60_000);
  it("pružina – chybné rozměry", async () => {
    const res = await buildDoc(doc([{ id: "p", name: "P", type: "spring", radius: 10, pitch: 2, turns: 4, wire: 3, position: [0, 0, 0], axis: "Z", mode: "new" }]));
    expect(res.status[0].ok).toBe(false);
  });
});
