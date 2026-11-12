/** Prvky rozšíření s rovinou / bodem zadaným odkazem (parametry druhu „plane“ a „point“). */
import path from "node:path";
import { beforeAll, describe, expect, it } from "vitest";
import * as r from "replicad";
import opencascade from "replicad-opencascadejs";
import { buildDoc } from "../build";
import { allExt } from "./registry";
import { emptyDoc, type CadDoc, type Feature } from "../types";
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
