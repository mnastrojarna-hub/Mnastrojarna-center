/** Export výkresu (sdílený s výkresovým prostředím) a API exportDrawing bez jádra: SVG, DXF R12, CSV kusovníku, list podle čísla / názvu. */
import { beforeEach, describe, expect, it } from "vitest";
import { parseAgentText } from "./agent";
import { activeSheet, applyDrawingCmd } from "./drawing-agent";
import { drawingFile, exportDrawing, safeName, toBase64 } from "./drawing-export";
import { fixtureCalls, fixtureCompute, plateDoc } from "./drawing-fixture";
import type { CadDoc } from "./types";

const b64 = (s: string) => Buffer.from(s, "base64").toString("utf8");
async function run(doc: CadDoc, text: string) {
  let d = doc;
  for (const line of text.split("\n")) {
    const op = parseAgentText(line).ops[0];
    if (op.k !== "drawingCmd") throw new Error(line);
    d = (await applyDrawingCmd(d, op.cmd, fixtureCompute)).doc;
  }
  return d;
}

beforeEach(() => activeSheet.set(null, false));

describe("drawingFile – soubory z hotového listu", () => {
  it("SVG začíná <svg, DXF R12 má sekce a entity, CSV kusovníku s BOM a středníky", async () => {
    const res = await fixtureCompute(plateDoc(), { name: "Deska", material: "Ocel" }, {});
    const svg = await drawingFile(res, "svg", { base: "deska", title: "Deska" });
    expect(svg).toMatchObject({ name: "deska_vykres.svg", mime: "image/svg+xml" });
    expect(new TextDecoder().decode(svg.data)).toMatch(/^<svg xmlns="http:\/\/www.w3.org\/2000\/svg" width="420mm" height="297mm"/);
    const dxf = new TextDecoder().decode((await drawingFile(res, "dxf", { base: "deska", title: "Deska" })).data);
    expect(dxf).toContain("SECTION");
    expect(dxf).toContain("ENTITIES");
    expect(dxf).toContain("AC1009");
    expect(dxf.trimEnd().endsWith("EOF")).toBe(true);
    const csv = await drawingFile(res, "csv", { base: "sestava", title: "S", bom: [{ pos: 1, name: "Hřídel; dlouhá", qty: 2 }] });
    const text = new TextDecoder("utf-8", { ignoreBOM: true }).decode(csv.data);
    expect(csv.name).toBe("sestava_kusovnik.csv");
    expect(text.charCodeAt(0)).toBe(0xfeff);
    expect(text).toContain('1;"Hřídel; dlouhá";;2;');
    await expect(drawingFile(res, "csv", { base: "d", title: "D" })).rejects.toThrow(/Kusovník CSV je jen u sestavy/);
    await expect(drawingFile(res, "png", { base: "d", title: "D" })).rejects.toThrow(/PNG výkresu jde vytvořit jen v prohlížeči/);
    await expect(drawingFile(res, "dwg", { base: "d", title: "D", dwgVersion: "R14" as never })).rejects.toThrow(/Neznámá verze DWG „R14“/);
  });
  it("bezpečný název souboru a base64", () => {
    expect(safeName("Příruba DN50 / A")).toBe("Priruba_DN50_A");
    expect(toBase64(new TextEncoder().encode("ahoj"))).toBe("YWhvag==");
  });
});

describe("exportDrawing – list podle čísla / názvu, Chytré kóty a značky jako výkresové prostředí", () => {
  it("SVG aktivního / zadaného listu obsahuje kóty a značky toho listu", async () => {
    let doc = await run(plateDoc(), 'výkres A3\nvýkres značka drsnost Ra 1,6 na Ø40\nvýkres list nový "Detail"\nvýkres značka text "JEN LIST 2" v 20 30');
    const second = await exportDrawing(doc, "svg", {}, fixtureCompute);
    expect(second.name).toBe("Deska_vykres.svg");
    expect(second.mime).toBe("image/svg+xml");
    expect(b64(second.base64)).toContain("JEN LIST 2");
    expect(b64(second.base64)).not.toContain("Ra 1,6");
    const first = await exportDrawing(doc, "svg", { sheet: 1 }, fixtureCompute);
    expect(b64(first.base64)).toContain("Ra 1,6");
    expect(b64(first.base64)).toContain("Ø40");
    expect(b64(first.base64)).not.toContain("JEN LIST 2");
    const byName = await exportDrawing(doc, "dxf", { sheet: "detail" }, fixtureCompute);
    expect(b64(byName.base64)).toContain("ENTITIES");
    expect(byName.bytes).toBe(Buffer.from(byName.base64, "base64").length);
    await expect(exportDrawing(doc, "svg", { sheet: 7 }, fixtureCompute)).rejects.toThrow(/list 7 neexistuje/);
    await expect(exportDrawing(doc, "xls" as never, {}, fixtureCompute)).rejects.toThrow(/Neznámý formát výkresu „xls“/);
    // razítko s kusovníkem podle volby listu (sestava) a číslem listu
    doc = await run(doc, "výkres kusovník ne");
    await exportDrawing(doc, "svg", {}, fixtureCompute, { bom: [{ pos: 1, name: "Díl", qty: 1 }] });
    expect(fixtureCalls.last?.meta).toMatchObject({ sheetIndex: 2, sheetCount: 2 });
    expect(fixtureCalls.last?.meta.bom).toBeUndefined();
  });
  it("kusovník CSV sestavy (z doplňků aplikace) a varování výkresu", async () => {
    const asm: CadDoc = { ...plateDoc("Sestava"), kind: "assembly", features: [], components: [{ id: "c1", name: "Hřídel" } as never] };
    const r = await exportDrawing(asm, "csv", {}, fixtureCompute, { bom: [{ pos: 1, name: "Hřídel", qty: 2, material: "Ocel" }] });
    expect(r).toMatchObject({ name: "Sestava_kusovnik.csv", mime: "text/csv;charset=utf-8" });
    expect(Buffer.from(r.base64, "base64").toString("utf8")).toContain("1;Hřídel;;2;Ocel");
    const d = await run(plateDoc(), "výkres detail přední v 0 10 poloměr 3");
    const w = await exportDrawing({ ...d, drawings: [{ ...d.drawings![0], options: { ...d.drawings![0].options, details: [{ id: "x", label: "Z", view: "left", cx: 0, cy: 0, r: 1, scale: 2 }] } }] }, "svg", {}, fixtureCompute);
    expect(w.warnings).toEqual(["Detail Z: pohled left není na listu."]);
  });
  it("dokument bez výkresu: výchozí list s Chytrými kótami; prázdný model = chyba", async () => {
    const r = await exportDrawing(plateDoc(), "svg", {}, fixtureCompute);
    expect(b64(r.base64)).toContain("Ø40");
    await expect(exportDrawing({ ...plateDoc(), features: [] }, "svg", {}, fixtureCompute)).rejects.toThrow(/model je prázdný/);
  });
});
