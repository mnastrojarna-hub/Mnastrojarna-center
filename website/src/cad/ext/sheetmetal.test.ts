import path from "node:path";
import { beforeAll, describe, expect, it } from "vitest";
import * as r from "replicad";
import opencascade from "replicad-opencascadejs";
import { buildShape } from "../build";
import { newExtFeature } from "../defaults";
import { emptyDoc, uid, type CadDoc, type Feature, type Vec3 } from "../types";
import "./index";
import { bendAllowance, bendTable, flatLayout, flatToDxf, flatToSvg, sheetParamsAt, type EdgeGeom } from "./sheetmetal-flat";
import { sheetEdge } from "./sheetmetal";

beforeAll(async () => {
  const oc = await (opencascade as unknown as (o: object) => Promise<unknown>)({
    locateFile: () => path.resolve(__dirname, "../../../node_modules/replicad-opencascadejs/dist/replicad_single.wasm"),
    print: () => undefined,
    printErr: () => undefined,
  });
  r.setOC(oc as never);
}, 60_000);

const T = 2;
const RB = 2;
const K = 0.44;

/** deska 100 × 60 na XY, tloušťka 2 nad skicou (z ∈ [0, 2]) */
function plateDoc(): CadDoc {
  const doc = emptyDoc("Plech");
  const sk: Feature = { id: "s1", name: "Obrys", type: "sketch", plane: { kind: "base", name: "XY", offset: 0 }, entities: [{ id: "e1", type: "rect", cx: 0, cy: 0, w: 100, h: 60, r: 0, angle: 0 }] };
  doc.features.push(sk);
  const base = newExtFeature(doc, "sheet.base", {});
  if (base.type === "ext") base.data = { ...base.data, sketchId: "s1", direction: "normal", t: T, r: RB, k: K };
  doc.features.push(base);
  return doc;
}

const vol = (s: r.Shape3D | null) => (s ? r.measureVolume(s) : 0);
const bb = (s: r.Shape3D) => s.boundingBox.bounds as [Vec3, Vec3];

/** index rovné hrany tělesa s koncovými body na dané přímce (y = const, z = const) */
function edgeAt(body: r.Shape3D, y: number, z: number): number {
  const i = body.edges.findIndex((e) => e.geomType === "LINE" && Math.abs(e.startPoint.y - y) < 1e-6 && Math.abs(e.endPoint.y - y) < 1e-6 && Math.abs(e.startPoint.z - z) < 1e-6 && Math.abs(e.endPoint.z - z) < 1e-6);
  expect(i).toBeGreaterThanOrEqual(0);
  return i;
}

const kernelResolver = (doc: CadDoc) => {
  const cache = new Map<number, r.Shape3D | null>();
  return async (fi: number, ei: number): Promise<EdgeGeom | null> => {
    if (!cache.has(fi)) cache.set(fi, (await buildShape(doc, fi - 1)).body);
    const b = cache.get(fi);
    const e = b?.edges[ei];
    return e ? { a: [e.startPoint.x, e.startPoint.y, e.startPoint.z], b: [e.endPoint.x, e.endPoint.y, e.endPoint.z] } : null;
  };
};

describe("plech – základ a parametry", () => {
  it("základní plech má objem plocha × t a parametry se dědí", async () => {
    const doc = plateDoc();
    const res = await buildShape(doc);
    expect(res.status.every((s) => s.ok)).toBe(true);
    expect(vol(res.body)).toBeCloseTo(100 * 60 * T, 3);
    expect(sheetParamsAt(doc, doc.features.length)).toEqual({ t: T, r: RB, k: K });
    expect(bendAllowance(90, 2, 2, 0.44)).toBeCloseTo((Math.PI / 2) * (2 + 0.88), 6);
  });
});

describe("plech – ohyb z hrany", () => {
  it("90° ohyb nahoru přidá přírubu (objem, rozsah) a rozvin má délku 60 + BA + L", async () => {
    const doc = plateDoc();
    const base = (await buildShape(doc)).body!;
    const ei = edgeAt(base, 30, T); // horní hrana na y = +30
    const fl = newExtFeature(doc, "sheet.flange", { edges: [ei] });
    if (fl.type === "ext") fl.data = { ...fl.data, length: 30, angle: 90, radius: 0 };
    doc.features.push(fl);
    const res = await buildShape(doc);
    expect(res.status.map((s) => s.error ?? "ok")).toEqual(["ok", "ok", "ok"]);
    const body = res.body!;
    const sector = (Math.PI / 4) * ((RB + T) ** 2 - RB ** 2);
    expect(vol(body)).toBeCloseTo(12000 + 100 * (30 * T + sector), -1);
    const [mn, mx] = bb(body);
    expect(mx[2]).toBeCloseTo(T + RB + 30, 2); // příruba nahoru
    expect(mx[1]).toBeCloseTo(30 + RB + T, 2);
    expect(mn[2]).toBeCloseTo(0, 2);
    // rozvin
    const lay = await flatLayout(doc, kernelResolver(doc));
    const ba = bendAllowance(90, RB, T, K);
    expect(lay.bends).toHaveLength(1);
    expect(lay.bends[0].ba).toBeCloseTo(ba, 6);
    expect(lay.bends[0].dir).toBe("up");
    expect(lay.bbox[1][1] - lay.bbox[0][1]).toBeCloseTo(60 + ba + 30, 4);
    expect(lay.bbox[1][0] - lay.bbox[0][0]).toBeCloseTo(100, 6);
    expect(lay.outer).toHaveLength(6);
    const dxf = flatToDxf(lay, "Test");
    expect(dxf).toContain("OHYBY");
    expect(dxf).toContain("NAHORU");
    expect(dxf).toContain("$INSUNITS");
    expect(flatToSvg(lay)).toContain("<svg");
    expect(bendTable(lay)).toContain("Ohyb 1");
  }, 60_000);

  it("ohyb na opačnou stranu (flip) jde dolů; materiál uvnitř zachová obrys základu", async () => {
    const doc = plateDoc();
    const base = (await buildShape(doc)).body!;
    const ei = edgeAt(base, 30, T);
    const fl = newExtFeature(doc, "sheet.flange", { edges: [ei] });
    if (fl.type === "ext") fl.data = { ...fl.data, length: 30, angle: 90, flip: true };
    doc.features.push(fl);
    const res = await buildShape(doc);
    expect(res.status.every((s) => s.ok)).toBe(true);
    const [mn, mx] = bb(res.body!);
    expect(mn[2]).toBeCloseTo(-(RB + 30), 2);
    expect(mx[2]).toBeCloseTo(T, 2);
    const lay = await flatLayout(doc, kernelResolver(doc));
    expect(lay.bends[0].dir).toBe("down");

    const doc2 = plateDoc();
    const fl2 = newExtFeature(doc2, "sheet.flange", { edges: [ei] });
    if (fl2.type === "ext") fl2.data = { ...fl2.data, length: 30, angle: 90, position: "materialInside" };
    doc2.features.push(fl2);
    const res2 = await buildShape(doc2);
    expect(res2.status.every((s) => s.ok)).toBe(true);
    expect(bb(res2.body!)[1][1]).toBeCloseTo(30, 2); // vnější plocha příruby lícuje s původní hranou
  }, 60_000);

  it("ohyb na oblouku je odmítnut česky", async () => {
    const doc = emptyDoc("Kotouč");
    doc.features.push({ id: "s1", name: "Kruh", type: "sketch", plane: { kind: "base", name: "XY", offset: 0 }, entities: [{ id: "c", type: "circle", cx: 0, cy: 0, r: 40 }] });
    const base = newExtFeature(doc, "sheet.base", {});
    if (base.type === "ext") base.data = { ...base.data, sketchId: "s1", t: 2 };
    doc.features.push(base);
    const body = (await buildShape(doc)).body!;
    const ei = body.edges.findIndex((e) => e.geomType === "CIRCLE");
    const fl = newExtFeature(doc, "sheet.flange", { edges: [ei] });
    doc.features.push(fl);
    const res = await buildShape(doc);
    expect(res.status[2].ok).toBe(false);
    expect(res.status[2].error).toMatch(/rovné hraně/);
  }, 60_000);
});

describe("plech – lem, ohyb podle čáry, výřez, rozvinutí", () => {
  it("lem 180° a rozvin s BA(180°)", async () => {
    const doc = plateDoc();
    const base = (await buildShape(doc)).body!;
    const ei = edgeAt(base, -30, T);
    const hem = newExtFeature(doc, "sheet.hem", { edges: [ei] });
    if (hem.type === "ext") hem.data = { ...hem.data, length: 8, kind: "open", radius: 1 };
    doc.features.push(hem);
    const res = await buildShape(doc);
    expect(res.status.every((s) => s.ok)).toBe(true);
    const [mn, mx] = bb(res.body!);
    expect(mn[1]).toBeCloseTo(-30 - 1 - T, 2); // vnější poloměr lemu
    expect(mx[2]).toBeCloseTo(T + 2 * 1 + T, 2); // horní plocha lemu
    const lay = await flatLayout(doc, kernelResolver(doc));
    expect(lay.bends[0].angle).toBe(180);
    expect(lay.bbox[1][1] - lay.bbox[0][1]).toBeCloseTo(60 + bendAllowance(180, 1, T, K) + 8, 4);
  }, 60_000);

  it("ohyb podle čáry rozdělí desku a ohne jednu stranu", async () => {
    const doc = plateDoc();
    doc.features.push({ id: "s2", name: "Čára ohybu", type: "sketch", plane: { kind: "base", name: "XY", offset: T }, entities: [{ id: "l", type: "line", a: [-60, 0], b: [60, 0] }] });
    const bend = newExtFeature(doc, "sheet.bend", {});
    if (bend.type === "ext") bend.data = { ...bend.data, sketchId: "s2", angle: 90, side: "left", direction: "up" };
    doc.features.push(bend);
    const res = await buildShape(doc);
    expect(res.status.map((s) => s.error ?? "ok")).toEqual(["ok", "ok", "ok", "ok"]);
    const body = res.body!;
    const ba = bendAllowance(90, RB, T, K);
    const [mn, mx] = bb(body);
    expect(mn[1]).toBeCloseTo(-30, 2);
    expect(mx[1]).toBeCloseTo(RB + T, 2);
    expect(mx[2]).toBeCloseTo(T + RB + (30 - ba), 1);
    expect(vol(body)).toBeCloseTo(12000, -2);
    const lay = await flatLayout(doc, kernelResolver(doc));
    expect(lay.bends).toHaveLength(1);
    expect(lay.bbox[1][1] - lay.bbox[0][1]).toBeCloseTo(60, 6);
    expect(lay.bends[0].a2[1]).toBeCloseTo(ba, 6);
  }, 60_000);

  it("výřez a prvek Rozvinout (plochý díl) + rohová úleva", async () => {
    const doc = plateDoc();
    const base = (await buildShape(doc)).body!;
    const ei = edgeAt(base, 30, T);
    const fl = newExtFeature(doc, "sheet.flange", { edges: [ei] });
    if (fl.type === "ext") fl.data = { ...fl.data, length: 30, angle: 90 };
    doc.features.push(fl);
    doc.features.push({ id: "s3", name: "Díra", type: "sketch", plane: { kind: "base", name: "XY", offset: 0 }, entities: [{ id: "c", type: "circle", cx: 0, cy: 0, r: 5 }] });
    const cut = newExtFeature(doc, "sheet.cut", {});
    if (cut.type === "ext") cut.data = { sketchId: "s3" };
    doc.features.push(cut);
    const relief = newExtFeature(doc, "sheet.relief", {});
    if (relief.type === "ext") relief.data = { ...relief.data, point: [-40, 20, 1], kind: "round", size: 4, axis: "Z" };
    doc.features.push(relief);
    const before = await buildShape(doc);
    expect(before.status.every((s) => s.ok)).toBe(true);
    const sector = (Math.PI / 4) * ((RB + T) ** 2 - RB ** 2);
    expect(vol(before.body)).toBeCloseTo(12000 + 100 * (30 * T + sector) - Math.PI * 25 * T - Math.PI * 4 * T, -1);
    const unfold = newExtFeature(doc, "sheet.unfold", {});
    doc.features.push(unfold);
    const res = await buildShape(doc);
    expect(res.status.map((s) => s.error ?? "ok").at(-1)).toBe("ok");
    const flat = res.body!;
    const ba = bendAllowance(90, RB, T, K);
    const [mn, mx] = bb(flat);
    expect(mx[2] - mn[2]).toBeCloseTo(T, 4);
    expect(mx[1] - mn[1]).toBeCloseTo(60 + ba + 30, 3);
    expect(vol(flat)).toBeCloseTo(100 * (60 + ba + 30) * T - Math.PI * 25 * T - Math.PI * 4 * T, -1);
    const lay = await flatLayout(doc, kernelResolver(doc), doc.features.length - 1);
    expect(lay.holes).toHaveLength(2);
    expect(flatToDxf(lay)).toContain("ARC");
  }, 90_000);

  it("sheetEdge vrací normály plechu a boku", async () => {
    const doc = plateDoc();
    const base = (await buildShape(doc)).body!;
    const ei = edgeAt(base, 30, T);
    const e = await sheetEdge(base, ei);
    expect(e.len).toBeCloseTo(100, 6);
    expect(Math.abs(e.faceN[2])).toBeCloseTo(1, 6);
    expect(e.sideN[1]).toBeCloseTo(1, 6);
    const stub = uid();
    expect(stub.length).toBeGreaterThan(3);
  });
});
