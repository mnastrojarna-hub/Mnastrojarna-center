/** Audit mezer (12. vlna): osa / směr / rovina odkazem u rotace, pole, zrcadlení a sražení; hrany a plochy čísly – CS / EN / DE, jádro. */
import path from "node:path";
import { afterEach, beforeAll, describe, expect, it } from "vitest";
import * as r from "replicad";
import opencascade from "replicad-opencascadejs";
import { buildDoc } from "./build";
import { parseAgentText, selectEdges, selectFaces, type EdgeLite, type FaceLite } from "./agent";
import { resolveDatumNames } from "./agent-prim";
import { setLang } from "./i18n";
import { emptyDoc, type Feature } from "./types";
import "./ext/index";
import "./feat/index";

afterEach(() => setLang("cs"));

const op = (text: string) => {
  const p = parseAgentText(text);
  expect(p.errors, text).toEqual([]);
  return p.ops[0] as { k: string; feature: Feature & Record<string, unknown>; rule?: string[] };
};
const feat = (text: string) => op(text).feature;
const err = (text: string) => parseAgentText(text).errors[0]?.message ?? "";

describe("odkazy textem – rotace, pole, zrcadlení, sražení (CS)", () => {
  it("rotovat: osa hranou, válcovou plochou, pomocnou osou, dvěma body; symetricky; dřívější osa X beze změny", () => {
    expect(feat("rotovat 180 osa hrana E3 odebrat")).toMatchObject({ type: "revolve", angle: 180, mode: "cut", axisDef: { kind: "edge", ref: { kind: "edge", index: 2 } } });
    expect(feat("rotovat osa plocha F7")).toMatchObject({ angle: 360, axisDef: { kind: "cylFace", ref: { kind: "face", index: 6 } } });
    expect(feat('rotovat 90 osa "Osa 1" symetricky')).toMatchObject({ angle: 90, symmetric: true, axisDef: { kind: "datumAxis", featureId: "Osa 1" } });
    expect(feat("rotovat osa body V1 V5")).toMatchObject({ axisDef: { kind: "twoPoints", a: { kind: "vertex", index: 0 }, b: { kind: "vertex", index: 4 } } });
    expect(feat("rotovat 90 osa X")).toMatchObject({ axis: "x", axisDef: { kind: "global", axis: "X" } });
    expect(err("rotovat osa 1 0 0")).toBe("");
    expect(err("rotovat osa -Z")).toMatch(/osa rotace potřebuje polohu/);
  });
  it("pole: směr hranou / dvěma body, druhý směr; kruhové pole s osou odkazem", () => {
    expect(feat("pole 4 rozteč 20 směr hrana E3")).toMatchObject({ kind: "linear", count: 4, spacing: 20, direction: [1, 0, 0], dirDef: { kind: "edge", ref: { kind: "edge", index: 2 } } });
    expect(feat("pole 3 rozteč 10 směr 1 0 0 2 rozteč 20 směr body V1 V5")).toMatchObject({ count: 3, spacing: 10, direction: [1, 0, 0], count2: 2, spacing2: 20, dirDef2: { kind: "twoPoints" } });
    expect(feat("pole kruhové 6 osa plocha F7")).toMatchObject({ kind: "circular", count: 6, angle: 360, axisDef: { kind: "cylFace", ref: { kind: "face", index: 6 } } });
    expect(feat('pole kruhové 4 úhel 90 osa "Osa 1"')).toMatchObject({ angle: 90, axisDef: { kind: "datumAxis", featureId: "Osa 1" } });
    expect(feat("pole 4 rozteč 25 směr Y")).toMatchObject({ direction: [0, 1, 0] });
    expect(feat("pole 4 rozteč 25 směr Y").dirDef).toBeUndefined();
  });
  it("zrcadlit plochou / pomocnou rovinou; XY dál základní rovina", () => {
    expect(feat("zrcadlit plocha F3 odsazení 5")).toMatchObject({ type: "mirror", keepOriginal: true, planeDef: { kind: "face", ref: { kind: "face", index: 2 }, offset: 5 } });
    expect(feat('zrcadlit rovina "Rovina 1"')).toMatchObject({ planeDef: { kind: "datum", featureId: "Rovina 1" } });
    expect(feat("zrcadlit XZ odsazení 10")).toMatchObject({ plane: "XZ", offset: 10 });
    expect(feat("zrcadlit XZ odsazení 10").planeDef).toBeUndefined();
  });
  it("srazit vzdálenost + úhel / dvě vzdálenosti od referenční plochy; hrany čísly", () => {
    const o = op("srazit 2 úhel 30 plocha F3 hrany E5 E6");
    expect(o).toMatchObject({ k: "select", rule: ["e5", "e6"], feature: { type: "chamfer", distance: 2, kind: "distanceAngle", angle: 30, faceRef: { kind: "face", index: 2 } } });
    expect(feat("srazit 2 1 plocha F3")).toMatchObject({ kind: "twoDistances", distance: 2, d2: 1, edges: "all" });
    expect(err("srazit 2 úhel 30 hrany horní")).toMatch(/potřebuje referenční plochu/);
    expect(op("zaoblit 2 hrany E3 E7")).toMatchObject({ k: "select", rule: ["e3", "e7"] });
    expect(op("skořepina 2 otevřít F3 F5")).toMatchObject({ k: "select", rule: ["f3", "f5"] });
  });
  it("výběr hran a ploch čísly (E3 = index 2); neexistující číslo a míchání s pravidlem = chyba", () => {
    const edges: EdgeLite[] = Array.from({ length: 12 }, (_, index) => ({ index }));
    const faces: FaceLite[] = Array.from({ length: 6 }, (_, index) => ({ index, planar: true }));
    const bb: [[number, number, number], [number, number, number]] = [[0, 0, 0], [1, 1, 1]];
    expect(selectEdges(["e3", "e7"], edges, bb)).toEqual([2, 6]);
    expect(selectFaces(["f3", "f5"], faces, bb)).toEqual([2, 4]);
    expect(() => selectFaces(["f9"], faces, bb)).toThrow(/plocha F9 v tělese není \(ploch 6\)/);
    expect(() => selectEdges(["e3", "svisle"], edges, bb)).toThrow(/nelze míchat/);
  });
});

describe("odkazy textem – EN / DE", () => {
  it("anglicky", () => {
    setLang("en");
    expect(feat("revolve 180 axis edge E3")).toMatchObject({ axisDef: { kind: "edge" } });
    expect(feat("pattern 4 spacing 20 direction edge E3")).toMatchObject({ dirDef: { kind: "edge" } });
    expect(feat('mirror plane "Plane 1"')).toMatchObject({ planeDef: { kind: "datum", featureId: "Plane 1" } });
    expect(feat("mirror face F3")).toMatchObject({ planeDef: { kind: "face" } });
    expect(feat("chamfer 2 angle 30 face F3")).toMatchObject({ kind: "distanceAngle", angle: 30 });
  });
  it("německy", () => {
    setLang("de");
    expect(feat("rotieren 180 achse kante E3")).toMatchObject({ axisDef: { kind: "edge" } });
    expect(feat("muster 4 abstand 20 richtung kante E3")).toMatchObject({ dirDef: { kind: "edge" } });
    expect(feat("muster kreisförmig 6 achse fläche F7")).toMatchObject({ axisDef: { kind: "cylFace" } });
    expect(feat("spiegeln fläche F3")).toMatchObject({ planeDef: { kind: "face" } });
    expect(feat("fase 2 winkel 30 fläche F3")).toMatchObject({ kind: "distanceAngle", angle: 30 });
  });
});

describe("odkazy textem – jádro", () => {
  beforeAll(async () => {
    const oc = await (opencascade as unknown as (o: object) => Promise<unknown>)({ locateFile: () => path.resolve(__dirname, "../../node_modules/replicad-opencascadejs/dist/replicad_single.wasm"), print: () => undefined, printErr: () => undefined });
    r.setOC(oc as never);
  }, 60_000);
  const plate: Feature = { id: "plate", name: "Deska", type: "box", size: [100, 60, 20], position: [0, 0, 0], centered: false, mode: "new" };

  it("rotace kolem pomocné osy názvem: prstenec π(R²−r²)·h", async () => {
    const sk: Feature = { id: "s", name: "Skica 1", type: "sketch", plane: { kind: "base", name: "XZ", offset: 0 }, entities: [{ id: "e1", type: "rect", cx: 15, cy: 5, w: 10, h: 10, r: 0, angle: 0 }] };
    const ax: Feature = { id: "a1", name: "Osa 1", type: "datumAxis", def: { kind: "global", axis: "Z" }, length: 50 };
    const rev = { ...feat('rotovat osa "Osa 1"'), id: "rv", sketchId: "s", mode: "new" } as Feature;
    resolveDatumNames(rev, [sk, ax]);
    const res = await buildDoc({ ...emptyDoc("t"), features: [sk, ax, rev] });
    expect(res.status.every((s) => s.ok), JSON.stringify(res.status)).toBe(true);
    expect(res.metrics!.volume).toBeCloseTo(Math.PI * (20 * 20 - 10 * 10) * 10, 0);
  }, 60_000);

  it("pole děr podél pomocné osy (směr osa \"Osa Y\"): 3 díry", async () => {
    const ax: Feature = { id: "a1", name: "Osa Y", type: "datumAxis", def: { kind: "global", axis: "Y" }, length: 50 };
    const hole: Feature = { id: "h", name: "Díra 1", type: "hole", position: [20, 10, 20], axis: "Z", flip: false, diameter: 8, depth: 0, cbDiameter: 0, cbDepth: 0 };
    const pat = { ...feat('pole 3 rozteč 15 směr osa "Osa Y"'), id: "p", featureId: "h" } as Feature;
    resolveDatumNames(pat, [plate, ax, hole]);
    const res = await buildDoc({ ...emptyDoc("t"), features: [plate, ax, hole, pat] });
    expect(res.status.every((s) => s.ok), JSON.stringify(res.status)).toBe(true);
    expect(res.metrics!.volume).toBeCloseTo(100 * 60 * 20 - 3 * Math.PI * 16 * 20, 0);
  }, 60_000);

  it("zrcadlení pomocnou rovinou názvem: deska 40 mm zrcadlená přes x = 50 → objem 2×, obálka 0…100", async () => {
    const box: Feature = { id: "b", name: "Kvádr", type: "box", size: [40, 60, 20], position: [0, 0, 0], centered: false, mode: "new" };
    const dat: Feature = { id: "d1", name: "Rovina 1", type: "datum", origin: [50, 0, 0], normal: [1, 0, 0], xDir: [0, 1, 0], size: 50 };
    const m = { ...feat('zrcadlit rovina "Rovina 1"'), id: "m" } as Feature;
    resolveDatumNames(m, [box, dat]);
    const res = await buildDoc({ ...emptyDoc("t"), features: [box, dat, m] });
    expect(res.status.every((s) => s.ok), JSON.stringify(res.status)).toBe(true);
    expect(res.metrics!.volume).toBeCloseTo(2 * 40 * 60 * 20, 1);
    expect(res.metrics!.bbox[1][0]).toBeCloseTo(100, 4);
  }, 60_000);

  it("srazit 2 úhel 45 plocha F(horní/spodní) = sražení 4 hran plochy 2 mm; dvě vzdálenosti 2 2 totéž; 30° podle úhlu", async () => {
    // odebraný objem: deska tloušťky d minus komolý jehlan (prismatoid) mezi obdélníky L1×L2 a (L1−2a)×(L2−2a) výšky b
    const removed = (a: number, b: number) => 100 * 60 * b - (b / 6) * (100 * 60 + (100 - 2 * a) * (60 - 2 * a) + 4 * (100 - a) * (60 - a));
    const v0 = 100 * 60 * 20;
    let top = -1; // horní nebo spodní plocha 100 × 60 (obě dají stejný objem)
    for (let k = 1; k <= 6 && top < 0; k++) {
      const res = await buildDoc({ ...emptyDoc("t"), features: [plate, { ...feat(`srazit 2 úhel 45 plocha F${k}`), id: "c" }] });
      if (res.status.every((s) => s.ok) && Math.abs(res.metrics!.volume - (v0 - removed(2, 2))) < 0.05) top = k;
    }
    expect(top).toBeGreaterThan(0);
    const two = await buildDoc({ ...emptyDoc("t"), features: [plate, { ...feat(`srazit 2 2 plocha F${top}`), id: "c" }] });
    expect(two.metrics!.volume).toBeCloseTo(v0 - removed(2, 2), 1);
    const a30 = await buildDoc({ ...emptyDoc("t"), features: [plate, { ...feat(`srazit 2 úhel 30 plocha F${top}`), id: "c" }] });
    expect(a30.status.every((s) => s.ok), JSON.stringify(a30.status)).toBe(true);
    const cands = [removed(2, 2 * Math.tan(Math.PI / 6)), removed(2, 2 / Math.tan(Math.PI / 6))];
    expect(cands.some((c) => Math.abs(a30.metrics!.volume - (v0 - c)) < 0.05), `${a30.metrics!.volume} vs ${cands.map((c) => v0 - c)}`).toBe(true);
  }, 120_000);
});

describe("stav – odkazy u rotace, pole, zrcadlení a sražení", () => {
  it("souhrn ukáže osu / směr / rovinu odkazem; bez odkazu dřívější souhrn", async () => {
    const { featureSummary } = await import("./agent");
    expect(featureSummary(feat("rotovat 180 osa hrana E3 odebrat"))).toBe("180°, cut, osa hrana E3");
    expect(featureSummary(feat('rotovat 90 osa "Osa 1" symetricky'))).toBe("90° symetricky, $auto, osa pomocná osa „Osa 1“");
    expect(featureSummary(feat("rotovat 90"))).toBe("90°, $auto");
    expect(featureSummary(feat("pole 4 rozteč 20 směr hrana E3"))).toBe("lineární 4× po 20, směr hrana E3");
    expect(featureSummary(feat("pole kruhové 6 osa plocha F7"))).toBe("kruhové 6× / 360°, osa osa plochy F7");
    expect(featureSummary(feat("zrcadlit plocha F3 odsazení 5"))).toBe("rovina plochy F3 +5");
    expect(featureSummary(feat('zrcadlit rovina "Rovina 1"'))).toBe("pomocná rovina „Rovina 1“");
    expect(featureSummary(feat("srazit 2 úhel 30 plocha F3"))).toBe("2 mm × 30° od plochy F3, hrany vše");
    expect(featureSummary(feat("srazit 2 1 plocha F3"))).toBe("2 × 1 mm od plochy F3, hrany vše");
  });
});
