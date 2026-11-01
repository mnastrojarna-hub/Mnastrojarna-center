import path from "node:path";
import { beforeAll, describe, expect, it } from "vitest";
import * as r from "replicad";
import opencascade from "replicad-opencascadejs";
import { buildDoc } from "../build";
import { newExtFeature } from "../defaults";
import { emptyDoc, type CadDoc, type Feature, type SketchEntity, type SketchPlane, type Vec2 } from "../types";
import { allExt } from "./index";

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
const sketch = (name: string, plane: SketchPlane, entities: SketchEntity[]): Feature => ({ id: id(), name, type: "sketch", plane, entities });
const poly = (points: Vec2[], closed = false): SketchEntity => ({ id: id(), type: "polyline", points, closed });
const rect = (w: number, h: number): SketchEntity => ({ id: id(), type: "rect", cx: 0, cy: 0, w, h, r: 0, angle: 0 });
const XY: SketchPlane = { kind: "base", name: "XY", offset: 0 };
const XZ: SketchPlane = { kind: "base", name: "XZ", offset: 0 };
const YZ: SketchPlane = { kind: "base", name: "YZ", offset: 0 };
const base = (features: Feature[]): CadDoc => ({ ...emptyDoc("Test"), features });
const ext = (doc: CadDoc, ext: string, data: Record<string, unknown>) => {
  const f = newExtFeature(doc, ext);
  if (f.type === "ext") f.data = { ...f.data, ...data };
  return f;
};
const build = async (features: Feature[]) => {
  const res = await buildDoc(base(features));
  const bad = res.status.filter((s) => !s.ok);
  return { res, bad, body: res.body, m: res.metrics };
};
const ok = (x: { bad: { error?: string }[] }) => expect(x.bad.map((b) => b.error), "chyby prvků").toEqual([]);

describe("plošné modelování – tvorba ploch", () => {
  it("registruje ≥ 14 příkazů na kartě Plochy", () => {
    const list = allExt().filter((d) => d.tab === "surface");
    expect(list.length).toBeGreaterThanOrEqual(14);
    for (const d of list) expect(d.icon?.startsWith("surf-"), d.ext).toBe(true);
  });

  it("plošné vysunutí otevřené křivky: plocha = délka × vzdálenost", async () => {
    const sk = sketch("Křivka", XY, [poly([[0, 0], [50, 0], [50, 30]])]);
    const doc = base([sk]);
    const x = await build([sk, ext(doc, "surf.extrude", { sketchId: sk.id, distance: 20 })]);
    ok(x);
    expect(x.m!.area).toBeCloseTo(1600, 0);
    const y = await build([sk, ext(doc, "surf.extrude", { sketchId: sk.id, distance: 20, symmetric: true })]);
    ok(y);
    expect(y.m!.bbox[0][2]).toBeCloseTo(-10, 3);
    expect(y.m!.bbox[1][2]).toBeCloseTo(10, 3);
  });

  it("plošná rotace úsečky kolem osy skici = válcová plocha", async () => {
    const sk = sketch("Profil", XZ, [poly([[10, 0], [10, 40]])]);
    const doc = base([sk]);
    const x = await build([sk, ext(doc, "surf.revolve", { sketchId: sk.id, angle: 360, axis: "y" })]);
    ok(x);
    expect(x.m!.area).toBeCloseTo(2 * Math.PI * 10 * 40, 0);
    const half = await build([sk, ext(doc, "surf.revolve", { sketchId: sk.id, angle: 180, axis: "y" })]);
    ok(half);
    expect(half.m!.area).toBeCloseTo(Math.PI * 10 * 40, 0);
  });

  it("rovinná plocha z obdélníku, včetně otvoru", async () => {
    const sk = sketch("Deska", XY, [rect(40, 20), { id: id(), type: "circle", cx: 0, cy: 0, r: 5 }]);
    const doc = base([sk]);
    const x = await build([sk, ext(doc, "surf.planar", { sketchId: sk.id })]);
    ok(x);
    expect(x.m!.area).toBeCloseTo(800 - Math.PI * 25, 0);
  });

  it("tažení otevřeného profilu po dráze", async () => {
    const prof = sketch("Profil", YZ, [poly([[0, 0], [0, 10]])]);
    const path = sketch("Dráha", XY, [poly([[0, 0], [30, 0]])]);
    const doc = base([prof, path]);
    const x = await build([prof, path, ext(doc, "surf.sweep", { profileId: prof.id, pathId: path.id })]);
    ok(x);
    expect(x.m!.area).toBeCloseTo(300, 0);
  });

  it("šablonování dvou křivek v rovnoběžných rovinách", async () => {
    const a = sketch("A", XY, [poly([[0, 0], [40, 0]])]);
    const b = sketch("B", { kind: "base", name: "XY", offset: 20 }, [poly([[0, 0], [40, 0]])]);
    const doc = base([a, b]);
    const x = await build([a, b, ext(doc, "surf.loft", { sketchIds: [a.id, b.id], ruled: true })]);
    ok(x);
    expect(x.m!.area).toBeCloseTo(800, 0);
  });

  it("chyby: prázdná skica, stejná skica pro profil a dráhu, šablonování s jednou skicou", async () => {
    const sk = sketch("Prázdná", XY, []);
    const doc = base([sk]);
    const x = await build([sk, ext(doc, "surf.extrude", { sketchId: sk.id })]);
    expect(x.bad[0].error).toMatch(/prázdná|Vyberte/);
    const y = await build([sk, ext(doc, "surf.sweep", { profileId: sk.id, pathId: sk.id })]);
    expect(y.bad[0].error).toMatch(/prázdná|dvě různé/);
    const z = await build([ext(doc, "surf.loft", { sketchIds: [] })]);
    expect(z.bad[0].error).toMatch(/dvě skici/);
  });
});

describe("plošné modelování – úpravy ploch", () => {
  const plate = () => sketch("Deska", XY, [rect(40, 20)]);

  it("odsazená plocha zdvojí plochu, bez zachování originálu ji nahradí", async () => {
    const sk = plate();
    const doc = base([sk]);
    const pl = ext(doc, "surf.planar", { sketchId: sk.id });
    const x = await build([sk, pl, ext(doc, "surf.offset", { distance: 5, keepOriginal: true })]);
    ok(x);
    expect(x.m!.area).toBeCloseTo(1600, 0);
    expect(x.m!.bbox[1][2]).toBeCloseTo(5, 3);
    const y = await build([sk, pl, ext(doc, "surf.offset", { distance: -5, keepOriginal: false })]);
    ok(y);
    expect(y.m!.area).toBeCloseTo(800, 0);
    expect(y.m!.bbox[0][2]).toBeCloseTo(-5, 3);
  });

  it("prodloužení rovinné plochy o 5 mm po obvodu", async () => {
    const sk = plate();
    const doc = base([sk]);
    const pl = ext(doc, "surf.planar", { sketchId: sk.id });
    const x = await build([sk, pl, ext(doc, "surf.extend", { faces: [0], length: 5 })]);
    ok(x);
    expect(x.m!.bbox[1][0]).toBeCloseTo(25, 2);
    expect(x.m!.bbox[1][1]).toBeCloseTo(15, 2);
    expect(x.m!.area).toBeGreaterThan(1400);
  });

  it("oříznutí rovinou YZ ponechá polovinu, skicou vnitřek kruhu", async () => {
    const sk = plate();
    const doc = base([sk]);
    const pl = ext(doc, "surf.planar", { sketchId: sk.id });
    const x = await build([sk, pl, ext(doc, "surf.trimPlane", { plane: "YZ", offset: 0, keep: "positive" })]);
    ok(x);
    expect(x.m!.area).toBeCloseTo(400, 0);
    expect(x.m!.bbox[0][0]).toBeCloseTo(0, 3);
    const circ = sketch("Kruh", XY, [{ id: id(), type: "circle", cx: 0, cy: 0, r: 8 }]);
    const doc2 = base([sk, circ]);
    const y = await build([sk, circ, ext(doc2, "surf.planar", { sketchId: sk.id }), ext(doc2, "surf.trimSketch", { sketchId: circ.id, keep: "inside" })]);
    ok(y);
    expect(y.m!.area).toBeCloseTo(Math.PI * 64, 0);
    const z = await build([sk, circ, ext(doc2, "surf.planar", { sketchId: sk.id }), ext(doc2, "surf.trimSketch", { sketchId: circ.id, keep: "outside" })]);
    ok(z);
    expect(z.m!.area).toBeCloseTo(800 - Math.PI * 64, 0);
  });

  it("sešití stěn + uzavření do tělesa + zesílení plochy", async () => {
    const sk = plate();
    const top = sketch("Víko", { kind: "base", name: "XY", offset: 10 }, [rect(40, 20)]);
    const doc = base([sk, top]);
    const sides = ext(doc, "surf.extrude", { sketchId: sk.id, distance: 10 });
    const bottom = ext(doc, "surf.planar", { sketchId: sk.id });
    const lid = ext(doc, "surf.planar", { sketchId: top.id });
    const sewn = await build([sk, top, sides, bottom, lid, ext(doc, "surf.sew", { tolerance: 0.01 })]);
    ok(sewn);
    expect(sewn.m!.area).toBeCloseTo(2 * 800 + 1200, 0);
    expect(sewn.body!.solids.length).toBe(0);
    const closed = await build([sk, top, sides, bottom, lid, ext(doc, "surf.close", { mode: "new" })]);
    ok(closed);
    expect(closed.m!.volume).toBeCloseTo(8000, 0);
    expect(closed.body!.solids.length).toBe(1);
    const thick = await build([sk, bottom, ext(doc, "surf.thicken", { thickness: 5 })]);
    ok(thick);
    expect(thick.m!.volume).toBeCloseTo(4000, 0);
    const open = await build([sk, top, sides, ext(doc, "surf.close", { mode: "new" })]);
    expect(open.bad[0]?.error).toMatch(/neuzavírají/);
  });

  it("záplata z hran rovinné plochy", async () => {
    const sk = plate();
    const doc = base([sk]);
    const x = await build([sk, ext(doc, "surf.planar", { sketchId: sk.id }), ext(doc, "surf.patch", { edges: [0, 1, 2, 3] })]);
    ok(x);
    expect(x.m!.area).toBeCloseTo(1600, 0);
    const y = await build([sk, ext(doc, "surf.planar", { sketchId: sk.id }), ext(doc, "surf.patch", { edges: [0] })]);
    expect(y.bad[0].error).toMatch(/hrany/);
  });
});

describe("plošné modelování – těleso ↔ plocha, křivky", () => {
  const box = (): Feature => ({ id: id(), name: "Kvádr", type: "box", size: [40, 20, 10], position: [0, 0, 0], centered: false, mode: "new" });

  it("rozdělení tělesa rovinou: obě části / jedna strana", async () => {
    const b = box();
    const doc = base([b]);
    const both = await build([b, ext(doc, "surf.split", { plane: "XY", offset: 5, keep: "both" })]);
    ok(both);
    expect(both.body!.solids.length).toBe(2);
    expect(both.m!.volume).toBeCloseTo(8000, 0);
    const pos = await build([b, ext(doc, "surf.split", { plane: "XY", offset: 5, keep: "positive" })]);
    ok(pos);
    expect(pos.m!.volume).toBeCloseTo(4000, 0);
    expect(pos.m!.bbox[0][2]).toBeCloseTo(5, 3);
    const miss = await build([b, ext(doc, "surf.split", { plane: "XY", offset: 50, keep: "positive" })]);
    expect(miss.bad[0].error).toMatch(/neprotíná/);
  });

  it("nahrazení (posun) horní plochy tělesa o 5 mm", async () => {
    const b = box();
    const doc = base([b]);
    const first = await build([b]);
    const top = first.body!.faces.findIndex((f) => Math.abs(f.center.z - 10) < 1e-6);
    expect(top).toBeGreaterThanOrEqual(0);
    const x = await build([b, ext(doc, "surf.replaceFace", { faces: [top], distance: 5 })]);
    ok(x);
    expect(x.m!.volume).toBeCloseTo(12000, 0);
  });

  it("křivka průniku s rovinou a promítnutí skici na plochu zachovají těleso", async () => {
    const b = box();
    const doc = base([b]);
    const sec = await build([b, ext(doc, "surf.section", { plane: "XY", offset: 5 })]);
    ok(sec);
    expect(sec.body!.solids.length).toBe(1);
    expect(sec.m!.edges).toBeGreaterThanOrEqual(12 + 4);
    const circ = sketch("Kruh", { kind: "base", name: "XY", offset: 30 }, [{ id: id(), type: "circle", cx: 20, cy: 10, r: 4 }]);
    const doc2 = base([b, circ]);
    const first = await build([b]);
    const top = first.body!.faces.findIndex((f) => Math.abs(f.center.z - 10) < 1e-6);
    const pr = await build([b, circ, ext(doc2, "surf.project", { sketchId: circ.id, faces: [top] })]);
    ok(pr);
    expect(pr.m!.edges).toBeGreaterThanOrEqual(13);
    const miss = await build([b, circ, ext(doc2, "surf.project", { sketchId: circ.id, faces: [] })]);
    expect(miss.bad[0].error).toMatch(/cílovou plochu/);
  });

  it("šroubovice jako křivka a tažení po šroubovici (pružina, závit)", async () => {
    const doc = base([]);
    const h = await build([ext(doc, "surf.helix", { radius: 10, pitch: 5, turns: 4 })]);
    ok(h);
    expect(h.m!.edges).toBeGreaterThanOrEqual(1);
    expect(h.m!.bbox[1][2]).toBeCloseTo(20, 2);
    const spring = await build([ext(doc, "surf.helixSweep", { profile: "circle", wire: 2, radius: 10, pitch: 5, turns: 4, mode: "new" })]);
    ok(spring);
    const L = 4 * Math.hypot(2 * Math.PI * 10, 5);
    expect(spring.m!.volume).toBeGreaterThan(Math.PI * L * 0.95);
    expect(spring.m!.volume).toBeLessThan(Math.PI * L * 1.05);
    const cyl: Feature = { id: id(), name: "Válec", type: "cylinder", radius: 10, height: 30, position: [0, 0, -5], axis: "Z", mode: "new" };
    const docC = base([cyl]);
    const thread = await build([cyl, ext(docC, "surf.helixSweep", { profile: "thread60", depth: 1.2, radius: 10, pitch: 2, turns: 10, mode: "cut" })]);
    ok(thread);
    expect(thread.m!.volume).toBeLessThan(Math.PI * 100 * 30 - 50);
    expect(thread.m!.volume).toBeGreaterThan(Math.PI * 100 * 30 * 0.8);
    const bad = await build([ext(doc, "surf.helixSweep", { profile: "circle", wire: 6, radius: 10, pitch: 5, turns: 2 })]);
    expect(bad.bad[0].error).toMatch(/menší než stoupání/);
  });
});
