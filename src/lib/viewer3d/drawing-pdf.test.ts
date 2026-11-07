/**
 * Výkres → PDF: platné PDF (1 strana, formát A podle výkresu), texty včetně čísel kót a češtiny
 * jdou z PDF přečíst (pdf.js — stejně jako je čte anonymizace), vypnuté hladiny se nekreslí.
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { PDFDocument } from "pdf-lib";
import { describe, expect, it } from "vitest";
import { openPdf } from "@/lib/anonymize/pdf-node";
import { chooseSheet, drawingBounds, drawingToPdf, EmptyDrawingError } from "./drawing-pdf";
import { parseDxf } from "./formats/dxf";
import { parseDwg } from "./formats/dwg";
import type { Drawing2D } from "./drawing2d";

const FONT = new Uint8Array(readFileSync(fileURLToPath(new URL("../../../public/fonts/Roboto-Regular.ttf", import.meta.url))));
const WASM_DIR = fileURLToPath(new URL("../../../node_modules/@mlightcad/libredwg-web/wasm/", import.meta.url));
const fixture = (rel: string) => new Uint8Array(readFileSync(fileURLToPath(new URL(rel, import.meta.url))));

async function pdfText(bytes: Uint8Array): Promise<{ pages: number; text: string; width: number; height: number }> {
  const doc = await openPdf(bytes);
  try {
    const page = await doc.getPage(1);
    const content = await page.getTextContent();
    const [, , width, height] = page.view;
    const text = content.items.map((i) => ("str" in i ? i.str : "")).join("\n");
    return { pages: doc.numPages, text, width, height };
  } finally {
    await doc.destroy();
  }
}

describe("výkres → PDF", () => {
  it("příruba (DXF, cp1250): A4 na šířku, čeština, Ø, kóty, patička se zdrojem a datem", async () => {
    const d = parseDxf(fixture("./__fixtures__/priruba-cp1250.dxf"));
    const res = await drawingToPdf(d, { font: FONT, sourceName: "PRIRUBA-200x120.dxf", date: new Date(2026, 10, 7) });
    expect(res.sheet).toBe("A4 na šířku");
    expect(res.scale).toBeGreaterThan(1); // malý výkres zvětšený na list
    expect(res.texts).toBe(4);
    const doc = await PDFDocument.load(res.bytes);
    expect(doc.getPageCount()).toBe(1);
    expect(doc.getTitle()).toBe("PRIRUBA-200x120");
    const t = await pdfText(res.bytes);
    expect(t.pages).toBe(1);
    expect(Math.round(t.width / (72 / 25.4))).toBe(297);
    expect(Math.round(t.height / (72 / 25.4))).toBe(210);
    for (const s of ["PŘÍRUBA — materiál 1.4301, tloušťka 10 mm", "Ø50 H7", "200", "Nekótované rozměry ISO 2768-mK", "Srazit hrany 0,5×45°", "PRIRUBA-200x120.dxf"]) {
      expect(t.text, s).toContain(s);
    }
    expect(t.text).toContain("Převedeno do PDF 7. 11. 2026");
  });

  it("DWG s kótami (R2018): čísla kót v PDF, výkres na A0 (větší než A1)", async () => {
    const d = await parseDwg(fixture("./formats/__fixtures__/dwg-example-r2018.dwg"), WASM_DIR);
    const res = await drawingToPdf(d, { font: FONT, sourceName: "example.dwg" });
    const t = await pdfText(res.bytes);
    for (const s of ["1504,68", "4177,65", "108°", "277,87"]) expect(t.text, s).toContain(s);
    expect(res.sheet.startsWith("A0")).toBe(true);
  });

  it("vypnutá hladina se nekreslí, prázdný výkres → srozumitelná chyba, znaky mimo písmo → ?", async () => {
    const d: Drawing2D = {
      format: "DXF",
      layers: [{ name: "A", color: "fg" }, { name: "SKRYTA", color: [1, 0, 0], off: true }],
      entities: [
        { kind: "line", layer: "A", color: "fg", a: [0, 0], b: [100, 0] },
        { kind: "circle", layer: "A", color: [1, 1, 0], c: [50, 20], r: 10 },
        { kind: "polyline", layer: "A", color: "fg", points: [[0, 40], [40, 40]], bulges: [1, 0], closed: false },
        { kind: "text", layer: "A", color: "fg", p: [0, 60], text: "房间 R5", height: 3.5, rotation: Math.PI / 2, hAlign: "left", vAlign: "baseline" },
        { kind: "text", layer: "SKRYTA", color: "fg", p: [0, 80], text: "TAJNE", height: 3.5, rotation: 0, hAlign: "left", vAlign: "baseline" },
      ],
    };
    const res = await drawingToPdf(d, { font: FONT, sourceName: "x.dxf" });
    const t = await pdfText(res.bytes);
    expect(t.text).toContain("?? R5");
    expect(t.text).not.toContain("TAJNE");
    expect(drawingBounds(d.entities.filter((e) => e.layer === "A"))![3]).toBeLessThan(80);
    await expect(drawingToPdf({ format: "DXF", layers: [], entities: [] }, { font: FONT, sourceName: "x.dxf" })).rejects.toBeInstanceOf(EmptyDrawingError);
  });

  it("volba listu: nejmenší formát A, na který se výkres vejde 1 : 1, orientace podle poměru stran", () => {
    expect(chooseSheet(200, 120)).toMatchObject({ name: "A4", landscape: true, width: 297, height: 210 });
    expect(chooseSheet(120, 200)).toMatchObject({ name: "A4", landscape: false });
    expect(chooseSheet(380, 250)).toMatchObject({ name: "A3", landscape: true });
    expect(chooseSheet(500, 300)).toMatchObject({ name: "A2" });
    expect(chooseSheet(800, 500)).toMatchObject({ name: "A1" });
    expect(chooseSheet(1100, 700)).toMatchObject({ name: "A0" });
    expect(chooseSheet(24000, 12000)).toMatchObject({ name: "A0", landscape: true });
  });
});
