import fs from "node:fs";
import path from "node:path";
import { beforeAll, describe, expect, it } from "vitest";
import * as r from "replicad";
import opencascade from "replicad-opencascadejs";
import { makeDrawing, modelViewKey, type ModelView } from "./drawing";
import { drawingModelShapes } from "./drawing-models";
import { emptyDoc, type CadDoc } from "./types";
import "./ext/index";
import "./feat/index";

beforeAll(async () => {
  const oc = await (opencascade as unknown as (o: object) => Promise<unknown>)({
    locateFile: () => path.resolve(__dirname, "../../node_modules/replicad-opencascadejs/dist/replicad_single.wasm"),
    print: () => undefined,
    printErr: () => undefined,
  });
  r.setOC(oc as never);
}, 60_000);

const fixture = (name: string): CadDoc => JSON.parse(fs.readFileSync(path.resolve(__dirname, "fixtures", name), "utf8")) as CadDoc;

/** váleček Ø30 × 60 (skica kružnice v XY + vysunutí) */
const pinDoc = (): CadDoc => ({
  ...emptyDoc("Čep"),
  features: [
    { id: "s", name: "Skica", type: "sketch", plane: { kind: "base", name: "XY", offset: 0 }, entities: [{ id: "c", type: "circle", cx: 0, cy: 0, r: 15 }] },
    { id: "e", name: "Vysunutí", type: "extrude", sketchId: "s", distance: 60, symmetric: false, reverse: false, mode: "new" },
  ],
});

describe("další modely na listu výkresu (komponenta sestavy, vložený dokument)", () => {
  it("tělesa: komponenta podle id, vložený dokument; neznámá komponenta chybí; opakované volání vrací totéž těleso", async () => {
    const asm: CadDoc = {
      ...emptyDoc("Sestava"),
      kind: "assembly",
      components: [{ id: "c1", name: "Čep", source: { kind: "part", doc: pinDoc() }, placement: { position: [100, 0, 0], rotation: [0, 0, 0] } }],
    };
    const models: ModelView[] = [
      { id: "a", name: "Čep", source: { kind: "component", compId: "c1" }, view: "front", scale: "auto" },
      { id: "b", name: "Oběžné kolo B", source: { kind: "doc", doc: fixture("impeller-B.mncad.json") }, view: "front", scale: 0.2 },
      { id: "x", name: "Smazaná", source: { kind: "component", compId: "nic" }, view: "front", scale: "auto" },
    ];
    const s1 = await drawingModelShapes(asm, models);
    expect(Object.keys(s1).sort()).toEqual(["a", "b"]);
    // komponenta ve vlastních souřadnicích (bez umístění v sestavě)
    const bb = s1.a.boundingBox.bounds as [number[], number[]];
    expect(bb[0][0]).toBeCloseTo(-15, 3);
    expect(bb[1][2]).toBeCloseTo(60, 3);
    const s2 = await drawingModelShapes(asm, models);
    expect(s2.a).toBe(s1.a);
    expect(s2.b).toBe(s1.b);

    // list s hlavním modelem (čep) a oběma dalšími modely: vlastní měřítka, chybějící model = varování
    const d = makeDrawing(s1.a, { name: "Čep", material: "ocel" }, { models }, s1);
    // „auto“ = měřítko listu (nebo nejbližší menší, při kterém se pohled vejde), číslo = pevné měřítko
    expect(d.models?.map((m) => [m.key, m.scale])).toEqual([[modelViewKey("a"), d.scale], [modelViewKey("b"), "1:5"]]);
    expect(d.texts.some((t) => t.s === "Oběžné kolo B (1:5)")).toBe(true);
    expect(d.warnings.join(" ")).toMatch(/Smazaná/);
  }, 120_000);
});
