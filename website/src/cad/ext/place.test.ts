/** Prvky rozšíření s rovinou / bodem zadaným odkazem (parametry druhu „plane“ a „point“). */
import path from "node:path";
import { beforeAll, describe, expect, it } from "vitest";
import * as r from "replicad";
import opencascade from "replicad-opencascadejs";
import { buildDoc, buildShape } from "../build";
import { parseAgentText } from "../agent";
import { allExt, extByTab, getExt, visibleExt, type ExtBuildCtx } from "./registry";
import { extAxis, extDirection, toAxisDef, toDirection } from "./place";
import { emptyDoc, type CadDoc, type Feature, type Vec3 } from "../types";
import "./index";
import "../feat/index";

beforeAll(async () => {
  const oc = await (opencascade as unknown as (o: object) => Promise<unknown>)({ locateFile: () => path.resolve(__dirname, "../../../node_modules/replicad-opencascadejs/dist/replicad_single.wasm"), print: () => undefined, printErr: () => undefined });
  r.setOC(oc as never);
}, 60_000);

const box: Feature = { id: "b", name: "Kvádr", type: "box", size: [40, 40, 20], position: [0, 0, 0], centered: false, mode: "new" };
const ext = (id: string, data: Record<string, unknown>): Feature => ({ id: "x", name: "Prvek", type: "ext", ext: id, data } as unknown as Feature);
const doc = (...features: Feature[]): CadDoc => ({ ...emptyDoc("Test"), features });

describe("rovina a bod prvků rozšíření zadané odkazem", () => {
  it("rozdělení tělesa obecnou rovinou (bod + normála) = polovina kvádru; bez odkazu platí základní rovina", async () => {
    const tilted = await buildDoc(doc(box, ext("surf.split", { plane: "XY", offset: 5, keep: "positive", planeDef: { kind: "pointNormal", p: { kind: "xyz", p: [20, 20, 10] }, dir: { kind: "vector", v: [1, 0, 1] } } })));
    expect(tilted.status.every((s) => s.ok), JSON.stringify(tilted.status)).toBe(true);
    expect(tilted.metrics!.volume).toBeCloseTo(16000, 0);
    const base = await buildDoc(doc(box, ext("surf.split", { plane: "XY", offset: 5, keep: "positive" })));
    expect(base.metrics!.volume).toBeCloseTo(40 * 40 * 15, 3);
    const custom = await buildDoc(doc(box, ext("surf.split", { plane: "XY", offset: 0, keep: "negative", planeDef: { kind: "custom", origin: [0, 0, 12], normal: [0, 0, 1], xDir: [1, 0, 0] } })));
    expect(custom.metrics!.volume).toBeCloseTo(40 * 40 * 12, 3);
  });
  it("oříznutí svařence rovinou odkazem (weld.trim) a měřítko kolem bodu odkazem (adv.scaleAbout)", async () => {
    const trim = await buildDoc(doc(box, ext("weld.trim", { plane: "XY", offset: 0, keep: "+", planeDef: { kind: "custom", origin: [10, 0, 0], normal: [1, 0, 0], xDir: [0, 1, 0] } })));
    expect(trim.status.every((s) => s.ok), JSON.stringify(trim.status)).toBe(true);
    expect(trim.metrics!.volume).toBeCloseTo(30 * 40 * 20, 2);
    const scaled = await buildDoc(doc(box, ext("adv.scaleAbout", { factor: 2, useCenter: false, center: [0, 0, 0], centerRef: { kind: "xyz", p: [40, 40, 20] } })));
    expect(scaled.status.every((s) => s.ok), JSON.stringify(scaled.status)).toBe(true);
    expect(scaled.metrics!.bbox[0].map((v) => Math.round(v))).toEqual([-40, -40, -20]);
    expect(scaled.metrics!.bbox[1].map((v) => Math.round(v))).toEqual([40, 40, 20]);
  });
  it("parametry „plane“ a „point“ jsou v registru u prvků, které dřív uměly jen základní roviny a souřadnice", () => {
    const withPlane = allExt().filter((d) => d.params?.some((p) => p.kind === "plane")).map((d) => d.ext).sort();
    expect(withPlane).toEqual(["adv.mirrorFeatures", "adv.partingDraft", "surf.section", "surf.split", "surf.trimPlane", "weld.plate", "weld.trim"]);
    const withPoint = allExt().filter((d) => d.params?.some((p) => p.kind === "point")).map((d) => d.ext).sort();
    expect(withPoint).toEqual(["adv.scaleAbout", "sheet.relief", "surf.helix", "surf.helixSweep"]);
  });
});

// ---------------- směr a osa (parametry druhu „direction“ a „axis“) ----------------

/** index hrany kvádru rovnoběžné s osou X a plochy s normálou +X (na tělese před prvkem) */
async function boxRefs() {
  const { body } = await buildShape(doc(box));
  const b = body!;
  const along = (v: { x: number; y: number; z: number }, w: { x: number; y: number; z: number }) => Math.abs(w.x - v.x) > 1 && Math.abs(w.y - v.y) < 1e-6 && Math.abs(w.z - v.z) < 1e-6;
  const edgeX = b.edges.findIndex((e) => along(e.startPoint, e.endPoint));
  const faceX = b.faces.findIndex((f) => {
    const n = f.normalAt(f.center);
    return n.x > 0.99 && Math.abs(f.center.x - 40) < 1e-6;
  });
  expect(edgeX).toBeGreaterThanOrEqual(0);
  expect(faceX).toBeGreaterThanOrEqual(0);
  return { edgeX, faceX };
}
const ok = (res: { status: { ok: boolean }[] }) => expect(res.status.every((s) => s.ok), JSON.stringify(res.status)).toBe(true);

describe("směr a osa prvků rozšíření zadané odkazem nebo čísly", () => {
  it("toDirection / toAxisDef převedou starší zápisy i nový tvar; neplatné → null", () => {
    expect(toDirection("Z")).toEqual({ kind: "axis", axis: "Z" });
    expect(toDirection("x")).toEqual({ kind: "axis", axis: "X" });
    expect(toDirection("-Y")).toEqual({ kind: "vector", v: [0, -1, 0] });
    expect(toDirection([1, 2, 3])).toEqual({ kind: "vector", v: [1, 2, 3] });
    expect(toDirection("normála")).toEqual({ kind: "normal" });
    const edge = { kind: "edge", ref: { kind: "edge", index: 3 } };
    expect(toDirection(edge)).toBe(edge);
    expect(toDirection(undefined)).toBeNull();
    expect(toDirection("W")).toBeNull();
    expect(toDirection([1, "a", 2])).toBeNull();
    expect(toDirection({ kind: "axis", axis: "Q" })).toBeNull();
    expect(toAxisDef("y")).toEqual({ kind: "sketchY" });
    expect(toAxisDef("x")).toEqual({ kind: "sketchX" });
    expect(toAxisDef("Z")).toEqual({ kind: "global", axis: "Z" });
    expect(toAxisDef({ kind: "cylFace", ref: { kind: "face", index: 2 } })).toEqual({ kind: "cylFace", ref: { kind: "face", index: 2 } });
    expect(toAxisDef("w")).toBeNull();
    expect(toAxisDef([0, 0, 1])).toBeNull();
  });

  it("extDirection / extAxis: osa a vektor bez jádra, odkaz přes ctx.resolveDirection / resolveAxis, prázdné = výchozí", () => {
    const calls: unknown[] = [];
    const ctx = {
      resolveDirection: (d: unknown) => (calls.push(d), [0, 1, 0] as Vec3),
      resolveAxis: (a: unknown, sid?: string) => (calls.push([a, sid]), { origin: [1, 2, 3] as Vec3, dir: [0, 0, 2] as Vec3 }),
    } as unknown as ExtBuildCtx;
    expect(extDirection({ a: "X" }, ctx, "a")).toEqual([1, 0, 0]);
    expect(extDirection({ a: [0, 3, 4] }, ctx, "a")).toEqual([0, 0.6, 0.8]);
    expect(extDirection({}, ctx, "a", { fallback: [0, 0, 5] })).toEqual([0, 0, 1]);
    expect(extDirection({ a: { kind: "normal" } }, ctx, "a", { base: { normal: [1, 0, 0] } })).toEqual([1, 0, 0]);
    expect(extDirection({ a: { kind: "faceNormal", ref: { kind: "face", index: 1 } } }, ctx, "a")).toEqual([0, 1, 0]);
    expect(() => extDirection({ a: [0, 0, 0] }, ctx, "a")).toThrow(/Nulový směr/);
    expect(extAxis({ ax: "Z" }, ctx, "ax")).toEqual({ origin: [0, 0, 0], dir: [0, 0, 1] });
    expect(extAxis({ ax: { kind: "edge", ref: { kind: "edge", index: 0 } }, sk: "s1" }, ctx, "ax", { sketchKey: "sk" })).toEqual({ origin: [1, 2, 3], dir: [0, 0, 1] });
    expect(calls).toEqual([{ kind: "faceNormal", ref: { kind: "face", index: 1 } }, [{ kind: "edge", ref: { kind: "edge", index: 0 } }, "s1"]]);
    expect(() => extDirection({ a: { kind: "edge", ref: { kind: "edge", index: 0 } } }, {} as ExtBuildCtx, "a")).toThrow(/odkazem/);
  });

  it("Rohová úleva: osa X dřívějším „X“, osou, vektorem, starým [x,y,z], hranou i normálou plochy vyřízne totéž", async () => {
    const { edgeX, faceX } = await boxRefs();
    const full = 40 * 40 * 20 - Math.PI * 9 * 40;
    const variants: unknown[] = ["X", { kind: "axis", axis: "X" }, { kind: "vector", v: [2, 0, 0] }, [1, 0, 0], { kind: "edge", ref: { kind: "edge", index: edgeX } }, { kind: "faceNormal", ref: { kind: "face", index: faceX } }];
    for (const axis of variants) {
      const res = await buildDoc(doc(box, ext("sheet.relief", { point: [20, 20, 10], kind: "round", size: 6, axis })));
      ok(res);
      expect(res.metrics!.volume, JSON.stringify(axis)).toBeCloseTo(full, 1);
    }
    // obecný směr: čtvercový výřez natočený do osy (dřív jen X / Y / Z)
    const tilted = await buildDoc(doc(box, ext("sheet.relief", { point: [20, 20, 10], kind: "rect", size: 4, axis: { kind: "vector", v: [1, 1, 0] } })));
    ok(tilted);
    expect(tilted.metrics!.volume).toBeLessThan(40 * 40 * 20 - 16 * 40);
    expect(tilted.metrics!.volume).toBeGreaterThan(40 * 40 * 20 - 16 * 60);
    const straight = await buildDoc(doc(box, ext("sheet.relief", { point: [20, 20, 10], kind: "rect", size: 4, axis: "Y" })));
    expect(straight.metrics!.volume).toBeCloseTo(40 * 40 * 20 - 16 * 40, 1);
  });

  it("Šroubovice: osa dřívějším „X“, hranou podél X a normálou plochy +X dá stejnou křivku; vektor otočí osu", async () => {
    const { edgeX, faceX } = await boxRefs();
    const helix = (axis: unknown) => ext("surf.helix", { radius: 5, pitch: 5, turns: 20, position: [0, 0, 0], axis });
    for (const axis of ["X", { kind: "edge", ref: { kind: "edge", index: edgeX } }, { kind: "faceNormal", ref: { kind: "face", index: faceX } }]) {
      const res = await buildDoc(doc(box, helix(axis)));
      ok(res);
      expect(res.metrics!.bbox[1][0], JSON.stringify(axis)).toBeCloseTo(100, 1);
    }
    const up = await buildDoc(doc(box, helix({ kind: "vector", v: [0, 0, 3] })));
    ok(up);
    expect(up.metrics!.bbox[1][2]).toBeCloseTo(100, 1);
    expect(up.metrics!.bbox[1][0]).toBeCloseTo(40, 1);
  });

  it("Tažení po šroubovici s osou odkazem (hrana) = totéž jako dřívější osa X", async () => {
    const { edgeX } = await boxRefs();
    const spring = (axis: unknown) => ext("surf.helixSweep", { profile: "circle", wire: 2, radius: 10, pitch: 5, turns: 2, position: [60, 20, 10], axis, mode: "add" });
    const a = await buildDoc(doc(box, spring("X")));
    const b = await buildDoc(doc(box, spring({ kind: "edge", ref: { kind: "edge", index: edgeX } })));
    ok(a);
    ok(b);
    expect(b.metrics!.volume).toBeCloseTo(a.metrics!.volume, 1);
    expect(b.metrics!.bbox[1][0]).toBeCloseTo(a.metrics!.bbox[1][0], 2);
  });

  it("Plošná rotace: dřívější „y“, nový tvar, globální osa a osa dvěma body dají stejnou plochu", async () => {
    const sk: Feature = { id: "s", name: "Profil", type: "sketch", plane: { kind: "base", name: "XZ", offset: 0 }, entities: [{ id: "l", type: "polyline", points: [[10, 0], [10, 40]], closed: false }] };
    const want = 2 * Math.PI * 10 * 40;
    for (const axis of ["y", { kind: "sketchY" }, { kind: "global", axis: "Z" }, { kind: "twoPoints", a: { kind: "xyz", p: [0, 0, 0] }, b: { kind: "xyz", p: [0, 0, 1] } }]) {
      const res = await buildDoc(doc(sk, ext("surf.revolve", { sketchId: "s", angle: 360, axis })));
      ok(res);
      expect(res.metrics!.area, JSON.stringify(axis)).toBeCloseTo(want, 0);
    }
    // osa X skici (= globální X) – kužel / disk místo válce
    const disk = await buildDoc(doc(sk, ext("surf.revolve", { sketchId: "s", angle: 360, axis: "x" })));
    ok(disk);
    expect(disk.metrics!.area).not.toBeCloseTo(want, 0);
  });

  it("Plošné vysunutí: bez směru kolmo na skicu (jako dřív), se směrem osou / vektorem", async () => {
    const sk: Feature = { id: "s", name: "Křivka", type: "sketch", plane: { kind: "base", name: "XY", offset: 0 }, entities: [{ id: "p", type: "polyline", points: [[0, 0], [50, 0], [50, 30]], closed: false }] };
    const plain = await buildDoc(doc(sk, ext("surf.extrude", { sketchId: "s", distance: 20 })));
    ok(plain);
    expect(plain.metrics!.area).toBeCloseTo(1600, 0);
    const down = await buildDoc(doc(sk, ext("surf.extrude", { sketchId: "s", distance: 20, dir: { kind: "vector", v: [0, 0, -1] } })));
    ok(down);
    expect(down.metrics!.bbox[0][2]).toBeCloseTo(-20, 3);
    const slanted = await buildDoc(doc(sk, ext("surf.extrude", { sketchId: "s", distance: 20, dir: { kind: "vector", v: [0, 1, 1] } })));
    ok(slanted);
    expect(slanted.metrics!.bbox[1][2]).toBeCloseTo(20 / Math.SQRT2, 3);
  });

  it("parametry „direction“ a „axis“ jsou v registru u prvků, které dřív uměly jen X / Y / Z; text `prvek` je převede", () => {
    const withDir = allExt().filter((d) => d.params?.some((p) => p.kind === "direction")).map((d) => d.ext).sort();
    expect(withDir).toEqual(["sheet.relief", "surf.extrude", "surf.helix", "surf.helixSweep"]);
    const withAxis = allExt().filter((d) => d.params?.some((p) => p.kind === "axis")).map((d) => d.ext).sort();
    expect(withAxis).toEqual(["surf.revolve"]);
    const data = (text: string) => {
      const p = parseAgentText(text);
      expect(p.errors, JSON.stringify(p.errors)).toEqual([]);
      const op = p.ops[0] as { feature: { data: Record<string, unknown> } };
      return op.feature.data;
    };
    expect(data("prvek surf.helix axis=X").axis).toEqual({ kind: "axis", axis: "X" });
    expect(data("prvek surf.helix axis=1;0;1").axis).toEqual({ kind: "vector", v: [1, 0, 1] });
    expect(data('prvek surf.revolve axis=x').axis).toEqual({ kind: "sketchX" });
    expect(data('prvek sheet.relief axis={"kind":"faceNormal","ref":{"kind":"face","index":4}}').axis).toEqual({ kind: "faceNormal", ref: { kind: "face", index: 4 } });
    const bad = parseAgentText("prvek surf.helix axis=W");
    expect(bad.errors[0]?.message).toMatch(/směr/);
  });
});

// ---------------- starší duplicitní prvky (legacy) ----------------

describe("starší prvky rozšíření, které opakují vestavěné prvky", () => {
  const LEGACY = ["adv.chamfer2", "adv.curvePattern", "adv.fillPattern", "adv.fullRound", "adv.holesAtPoints", "adv.varFillet"];
  it("jsou označené, chybí na pásu karet / v nabídkách, ale zůstávají v registru", () => {
    expect(allExt().filter((d) => d.legacy).map((d) => d.ext).sort()).toEqual(LEGACY);
    for (const id of LEGACY) {
      expect(getExt(id), id).toBeDefined();
      expect(getExt(id)!.legacy, id).toMatch(/vestavěn/);
      expect(extByTab(getExt(id)!.tab).some((d) => d.ext === id), id).toBe(false);
      expect(visibleExt().some((d) => d.ext === id), id).toBe(false);
    }
    expect(extByTab("create").some((d) => d.ext === "adv.chainFillet")).toBe(true);
    expect(visibleExt().length + LEGACY.length).toBe(allExt().length);
  });
  it("uložený dokument i obecný příkaz `prvek` je dál postaví", async () => {
    const { body } = await buildShape(doc(box));
    const vertical = body!.edges.findIndex((e) => Math.abs(e.endPoint.z - e.startPoint.z) > 1);
    const res = await buildDoc(doc(box, ext("adv.varFillet", { edges: [vertical], r1: 2, r2: 4 })));
    ok(res);
    expect(res.metrics!.volume).toBeLessThan(40 * 40 * 20);
    const p = parseAgentText("prvek adv.chamfer2 edges=1 d1=2 d2=1");
    expect(p.errors).toEqual([]);
    expect((p.ops[0] as { feature: { ext: string } }).feature.ext).toBe("adv.chamfer2");
  });
});
