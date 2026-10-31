import path from "node:path";
import { beforeAll, describe, expect, it } from "vitest";
import * as r from "replicad";
import opencascade from "replicad-opencascadejs";
import { DwgReader } from "@node-projects/acad-ts";
import { makeDrawing, type DrawingResult } from "../drawing";
import { DWG_SIGNATURE, DWG_VERSIONS, drawingToDwg, sketchToDwg, type DwgVersion } from "./dwg";
import type { SketchEntity } from "../types";

const sig = (buf: ArrayBuffer) => new TextDecoder().decode(new Uint8Array(buf, 0, 6));
const readBack = (buf: ArrayBuffer) => DwgReader.readFromStream(buf);
const ents = (buf: ArrayBuffer) => [...readBack(buf).entities!];

/** malý syntetický list: obrys (uzavřený), skrytá čára, osa, kóta se šipkou (SOLID), texty */
const synthetic: Pick<DrawingResult, "polys" | "texts" | "sheet"> = {
  sheet: { name: "A4", w: 297, h: 210 },
  polys: [
    { pts: [[50, 50], [150, 50], [150, 120], [50, 120], [50, 50]], layer: "visible" },
    { pts: [[60, 60], [140, 60]], layer: "hidden" },
    { pts: [[100, 40], [100, 130]], layer: "center" },
    { pts: [[50, 30], [150, 30]], layer: "dim" },
    { pts: [[50, 30], [53, 29], [53, 31]], layer: "dim", fill: true },
    { pts: [[10, 10], [287, 10], [287, 200], [10, 200], [10, 10]], layer: "frame" },
    { pts: [[70, 70], [80, 80]], layer: "hatch", width: 0.18 },
  ],
  texts: [
    { x: 100, y: 28, s: "100", size: 3.5, anchor: "middle", layer: "dim" },
    { x: 20, y: 190, s: "Příruba Ø20 ±0,1 – Mnástrojárna s.r.o.", size: 5, bold: true },
    { x: 45, y: 85, s: "70", size: 3.5, anchor: "middle", rotate: -90, layer: "dim" },
  ],
};

describe("DWG export – syntetický výkres", () => {
  for (const { id } of DWG_VERSIONS) {
    it(`verze ${id}: podpis, velikost a zpětné načtení`, async () => {
      const buf = await drawingToDwg(synthetic, { version: id as DwgVersion });
      expect(sig(buf)).toBe(DWG_SIGNATURE[id as DwgVersion]);
      expect(buf.byteLength).toBeGreaterThan(1024);
      const doc = readBack(buf);
      const list = [...doc.entities!];
      expect(list).toHaveLength(synthetic.polys.length + synthetic.texts.length);
      const names = list.map((e) => e.objectName);
      expect(names.filter((n) => n === "LWPOLYLINE")).toHaveLength(6);
      expect(names.filter((n) => n === "SOLID")).toHaveLength(1);
      expect(names.filter((n) => n === "TEXT")).toHaveLength(3);
      const layerNames = [...doc.layers!].map((l) => l.name);
      for (const n of ["OBRYS", "SKRYTE", "OSY", "KOTY", "SRAFY", "RAM", "TEXT"]) expect(layerNames).toContain(n);
      expect(doc.layers!.tryGetValue("SKRYTE")!.lineType.name).toBe("HIDDEN");
      expect(doc.layers!.tryGetValue("OSY")!.lineType.name).toBe("CENTER");
      expect(doc.header!.insUnits).toBe(4);
    });
  }

  it("geometrie: osa Y obrácená, uzavřený obrys, rotace a zarovnání textu", async () => {
    const buf = await drawingToDwg(synthetic, { version: "R2018" });
    const list = ents(buf);
    const outline = list[0] as unknown as { vertices: { location: { x: number; y: number } }[]; isClosed: boolean; layer: { name: string } };
    expect(outline.isClosed).toBe(true);
    expect(outline.vertices).toHaveLength(4);
    expect(outline.vertices[0].location.x).toBeCloseTo(50);
    expect(outline.vertices[0].location.y).toBeCloseTo(210 - 50);
    expect(outline.layer.name).toBe("OBRYS");
    const texts = list.filter((e) => e.objectName === "TEXT") as unknown as { value: string; rotation: number; height: number; horizontalAlignment: number; layer: { name: string }; style: { name: string } }[];
    expect(texts[1].value).toBe("Příruba Ø20 ±0,1 – Mnástrojárna s.r.o."); // R2007+ = Unicode
    expect(texts[2].rotation).toBeCloseTo(Math.PI / 2, 5);
    expect(texts[0].horizontalAlignment).toBe(1);
    expect(texts[0].layer.name).toBe("KOTY");
    expect(texts[0].style.name).toBe("ISO");
    expect(texts[0].height).toBeCloseTo(3.5 * 0.72, 5);
  });

  it("R2000: znaky mimo ASCII jako \\U+XXXX (AutoCAD je zobrazí správně)", async () => {
    const buf = await drawingToDwg(synthetic, { version: "R2000" });
    const t = ents(buf).filter((e) => e.objectName === "TEXT") as unknown as { value: string }[];
    expect(t[1].value).toContain("P\\U+0159\\U+00EDruba \\U+00D820");
    expect(t[0].value).toBe("100");
  });

  it("neznámá verze → česká chyba", async () => {
    await expect(drawingToDwg(synthetic, { version: "R1999" as DwgVersion })).rejects.toThrow(/Neznámá verze DWG/);
  });
});

describe("DWG export – skica", () => {
  it("úsečka, kružnice, oblouk přesně; obdélník jako uzavřená křivka; pomocná geometrie na vlastní vrstvě", async () => {
    const sk: SketchEntity[] = [
      { id: "l", type: "line", a: [0, 0], b: [100, 0] },
      { id: "c", type: "circle", cx: 50, cy: 50, r: 20 },
      { id: "a", type: "arc", a: [0, 100], b: [50, 150], c: [100, 100] },
      { id: "r", type: "rect", cx: 200, cy: 50, w: 60, h: 40, r: 0, angle: 0 },
      { id: "x", type: "line", a: [-50, -50], b: [250, 250], construction: true },
    ];
    const buf = await sketchToDwg(sk, { version: "R2018" });
    expect(sig(buf)).toBe("AC1032");
    const list = ents(buf);
    expect(list.map((e) => e.objectName)).toEqual(["LWPOLYLINE", "CIRCLE", "ARC", "LWPOLYLINE", "LWPOLYLINE"]);
    const circle = list[1] as unknown as { radius: number; center: { x: number; y: number } };
    expect(circle.radius).toBeCloseTo(20);
    expect(circle.center.x).toBeCloseTo(50);
    const arc = list[2] as unknown as { radius: number; center: { x: number; y: number }; startAngle: number; endAngle: number };
    expect(arc.radius).toBeCloseTo(50);
    expect(arc.center.y).toBeCloseTo(100);
    // horní půlkružnice: od 0 (bod [100,100]) proti směru hodinových ručiček do π (bod [0,100])
    expect(arc.startAngle).toBeCloseTo(0, 5);
    expect(arc.endAngle).toBeCloseTo(Math.PI, 5);
    const rect = list[3] as unknown as { isClosed: boolean; vertices: unknown[] };
    expect(rect.isClosed).toBe(true);
    expect(rect.vertices).toHaveLength(4);
    expect((list[4] as unknown as { layer: { name: string } }).layer.name).toBe("POMOCNE");
  });
});

describe("DWG export – skutečný výkres z modelu (OCCT)", () => {
  beforeAll(async () => {
    const oc = await (opencascade as unknown as (o: object) => Promise<unknown>)({
      locateFile: () => path.resolve(__dirname, "../../../node_modules/replicad-opencascadejs/dist/replicad_single.wasm"),
      print: () => undefined,
      printErr: () => undefined,
    });
    r.setOC(oc as never);
  }, 60_000);

  it("deska s dírami: zapíše se a načte zpět se všemi entitami", async () => {
    let s = r.makeBox([-40, -25, 0], [40, 25, 20]) as r.Shape3D;
    s = s.cut(r.makeCylinder(10, 40, [0, 0, -10], [0, 0, 1]));
    const d = makeDrawing(s, { name: "Deska", material: "Ocel S235", massKg: 0.5, number: "MN-001" });
    const expected = d.polys.filter((p) => p.pts.length >= 2 || (p.fill && p.pts.length >= 3)).length + d.texts.length;
    for (const v of ["R2018", "R2000"] as DwgVersion[]) {
      const buf = await drawingToDwg(d, { version: v });
      expect(sig(buf)).toBe(DWG_SIGNATURE[v]);
      expect(buf.byteLength).toBeGreaterThan(10_000);
      const list = ents(buf);
      expect(list.length).toBe(expected);
      expect(list.some((e) => (e as unknown as { layer: { name: string } }).layer.name === "SKRYTE")).toBe(true);
    }
  }, 60_000);
});
