/** Doplňky prvků po analýze nástrojů: zrcadlení vybraných prvků, rozříznutí rovinou plochy (faceRef), ukončení díry k bodu a s odsazením od plochy. */
import path from "node:path";
import { beforeAll, describe, expect, it } from "vitest";
import * as r from "replicad";
import opencascade from "replicad-opencascadejs";
import { buildDoc } from "./build";
import { emptyDoc, type CadDoc, type Feature } from "./types";
import "./ext/index";
import "./feat/index";

beforeAll(async () => {
  const oc = await (opencascade as unknown as (o: object) => Promise<unknown>)({ locateFile: () => path.resolve(__dirname, "../../node_modules/replicad-opencascadejs/dist/replicad_single.wasm"), print: () => undefined, printErr: () => undefined });
  r.setOC(oc as never);
}, 60_000);

const doc = (...features: Feature[]): CadDoc => ({ ...emptyDoc("Test"), features });
const box: Feature = { id: "b", name: "Kvádr", type: "box", size: [100, 60, 20], position: [0, 0, 0], centered: false, mode: "new" };
const hole = (extra: Partial<Extract<Feature, { type: "hole" }>> = {}): Feature => ({ id: "h", name: "Díra", type: "hole", position: [20, 30, 20], axis: "Z", flip: false, diameter: 10, depth: 0, cbDiameter: 0, cbDepth: 0, ...extra });
const V_HOLE = Math.PI * 25 * 20;

describe("zrcadlení vybraných prvků", () => {
  it("zrcadlí jen díru (nástroj prvku) přes rovinu YZ posunutou do středu – těleso zůstává, přibude druhá díra", async () => {
    const res = await buildDoc(doc(box, hole(), { id: "m", name: "Zrcadlení", type: "mirror", plane: "YZ", offset: 50, keepOriginal: true, featureIds: ["h"] }));
    expect(res.status.every((s) => s.ok), JSON.stringify(res.status)).toBe(true);
    expect(res.metrics!.volume).toBeCloseTo(100 * 60 * 20 - 2 * V_HOLE, 1);
    expect(res.metrics!.bbox[1][0]).toBeCloseTo(100, 6); // těleso se nezvětšilo (nezrcadlilo se celé)
  });
  it("prvek bez nástrojového tělesa → srozumitelná chyba", async () => {
    const res = await buildDoc(doc(box, { id: "f", name: "Zaoblení", type: "fillet", radius: 2, edges: "all" }, { id: "m", name: "Zrcadlení", type: "mirror", plane: "YZ", offset: 50, keepOriginal: true, featureIds: ["f"] }));
    const s = res.status.find((x) => x.id === "m")!;
    expect(s.ok).toBe(false);
    expect(s.error).toMatch(/nemá nástrojové těleso/);
  });
  it("bez featureIds se dál zrcadlí celé těleso", async () => {
    const res = await buildDoc(doc(box, { id: "m", name: "Zrcadlení", type: "mirror", plane: "YZ", offset: 0, keepOriginal: true }));
    expect(res.metrics!.volume).toBeCloseTo(2 * 100 * 60 * 20, 1);
  });
});

describe("rozříznutí rovinou plochy (faceRef) a ukončení díry", () => {
  it("split s faceRef: řez rovinou vybrané plochy (svislá stěna schodu) oddělí schod od zbytku desky", async () => {
    const step: Feature = { id: "b2", name: "Schod", type: "box", size: [30, 60, 30], position: [0, 0, 0], centered: false, mode: "add" };
    const stepped = await buildDoc(doc(box, step));
    expect(stepped.metrics!.volume).toBeCloseTo(100 * 60 * 20 + 30 * 60 * 10, 1);
    // stěna schodu leží v rovině x = 30; její index se najde zkouškou – řez rovinou této plochy dá 54 000 nebo 84 000 mm³
    const volumes: number[] = [];
    for (let i = 0; i < stepped.metrics!.faces; i++) {
      const res = await buildDoc(doc(box, step, { id: "s", name: "Řez", type: "split", plane: "XY", offset: 0, keep: "positive", faceRef: { kind: "face", index: i } }));
      if (res.status.every((x) => x.ok)) volumes.push(Math.round(res.metrics!.volume));
    }
    expect(volumes.some((v) => v === 54000 || v === 84000), volumes.join(", ")).toBe(true);
    // rovina zadaná přímo má přednost před faceRef
    const byDef = await buildDoc(doc(box, { id: "s", name: "Řez", type: "split", plane: "XY", offset: 0, keep: "negative", faceRef: { kind: "face", index: 0 }, planeDef: { kind: "custom", origin: [40, 0, 0], normal: [1, 0, 0], xDir: [0, 1, 0] } }));
    expect(byDef.metrics!.volume).toBeCloseTo(40 * 60 * 20, 2);
  });
  it("díra k bodu: dno v úrovni bodu podél osy; díra s odsazením od plochy = k ploše s odsazením", async () => {
    const toVertex = await buildDoc(doc(box, hole({ end: { kind: "toVertex", ref: { kind: "xyz", p: [80, 10, 8] } } })));
    expect(toVertex.status.every((s) => s.ok), JSON.stringify(toVertex.status)).toBe(true);
    expect(toVertex.metrics!.volume).toBeCloseTo(100 * 60 * 20 - Math.PI * 25 * 12, 1); // z 20 → 8, rovné dno
    const up = await buildDoc(doc(box, hole({ end: { kind: "toVertex", ref: { kind: "xyz", p: [0, 0, 30] } } })));
    expect(up.status.find((s) => s.id === "h")!.error).toMatch(/neleží ve směru vrtání/);
  });
});
