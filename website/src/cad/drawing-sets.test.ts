/**
 * Více výkresů jednoho dílu a export všech listů (w13 chyby 15 a 17): `výkres nový` / tlačítko Nový výkres založí další
 * výkres („Výkres 2“) s vlastními listy, číslování listů a razítko „List 1/2“ uvnitř výkresu, přepnutí a správa výkresů,
 * export „všechny listy“ (PDF vícestránkové, DXF / SVG ZIP s jedním souborem na list) textem i přes API.
 */
import fs from "node:fs";
import path from "node:path";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { parseAgentText } from "./agent";
import { parseDrawing, type DrawingCmd } from "./agent-drawing";
import { activeSheet, activeSheetIndex, addDrawing, applyDrawingCmd, drawingStatus, sheetMeta } from "./drawing-agent";
import { drawingBase, exportDrawing } from "./drawing-export";
import { fixtureCalls, fixtureCompute, plateDoc } from "./drawing-fixture";
import { drawingSets, drawingsLine, setSheets } from "./drawing-sets";
import { readZip } from "./formats/zip";
import { setLang } from "./i18n";
import type { CadDoc } from "./types";

const P = (text: string): DrawingCmd => {
  // „výkres export …“ z konzole obsluhují výstupy bez dialogu (agent-out.ts); zde příkaz výkresu přímo (stejný export)
  if (/^(výkres|drawing|zeichnung)\s+(export|exportovat|exportieren)\b/i.test(text.trim())) {
    const c = parseDrawing(text.trim().split(/\s+/).slice(1), text.trim().split(/\s+/).slice(1).join(" "));
    if (!c) throw new Error(`není příkaz výkresu: ${text}`);
    return c;
  }
  const p = parseAgentText(text);
  expect(p.errors, JSON.stringify(p.errors)).toEqual([]);
  const op = p.ops[0];
  if (op.k !== "drawingCmd") throw new Error(`není příkaz výkresu: ${text}`);
  return op.cmd;
};
async function run(doc: CadDoc, text: string) {
  let d = doc;
  const log: string[] = [];
  let file: Awaited<ReturnType<typeof applyDrawingCmd>>["file"];
  for (const line of text.split("\n").filter((l) => l.trim())) {
    const r = await applyDrawingCmd(d, P(line), fixtureCompute);
    d = r.doc;
    log.push(...r.log);
    file = r.file ?? file;
  }
  return { doc: d, log: log.join("\n"), file };
}
const pages = (b64: string) => (Buffer.from(b64, "base64").toString("latin1").match(/\/Type \/Page\b(?!s)/g) ?? []).length;

// PDF v Node: písma z public/fonts místo fetch v prohlížeči
beforeAll(() => {
  vi.stubGlobal("fetch", async (u: string) => {
    const b = fs.readFileSync(path.resolve(__dirname, "../../public", String(u).replace(/^\//, "")));
    return { ok: true, arrayBuffer: async () => b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength) };
  });
});
afterAll(() => vi.unstubAllGlobals());
beforeEach(() => activeSheet.set(null, false));

describe("výkres nový – další výkres dílu (chyba 15)", () => {
  it("výkres nový založí Výkres 2 s listem 1; listy, razítko a příkazy se počítají uvnitř výkresu", async () => {
    let { doc, log } = await run(plateDoc(), 'výkres A3\nvýkres list nový "Detail"\nvýkres nový');
    expect(doc.drawings!.map((s) => [s.drawing ?? "", s.name])).toEqual([["", "List 1"], ["", "Detail"], ["Výkres 2", "List 1"]]);
    expect(log).toMatch(/✓ nový výkres „Výkres 2“ – list 1 „List 1“ \(Chytré kóty\); další příkazy výkresu pracují s ním · výkresů 2/);
    expect(activeSheetIndex(doc)).toBe(2);
    expect(drawingSets(doc).map((s) => [s.name, s.sheets])).toEqual([["Výkres 1", [0, 1]], ["Výkres 2", [2]]]);
    // nový list patří do aktivního výkresu; „výkres list 1“ = list 1 výkresu 2
    ({ doc, log } = await run(doc, 'výkres list nový "Řez"\nvýkres list 1\nvýkres A4'));
    expect(doc.drawings!.map((s) => s.drawing ?? "")).toEqual(["", "", "Výkres 2", "Výkres 2"]);
    expect((doc.drawings![2].options as { sheet?: string }).sheet).toBe("A4");
    expect((doc.drawings![0].options as { sheet?: string }).sheet).toBe("A3");
    expect(log).toMatch(/✓ nový list 2 „Řez“/);
    // razítko: list 2/2 výkresu 2 (ne 4/4 všech listů dokumentu)
    expect(sheetMeta(doc, doc.drawings![3], 3)).toMatchObject({ sheetIndex: 2, sheetCount: 2 });
    expect(sheetMeta(doc, doc.drawings![1], 1)).toMatchObject({ sheetIndex: 2, sheetCount: 2 });
    // přehled výkresů a listů aktivního výkresu
    const st = (await drawingStatus(doc, fixtureCompute)).text;
    expect(st).toContain("Výkresy (2): 1 „Výkres 1“ 2 listy · 2 „Výkres 2“ 2 listy (aktivní)");
    expect(st).toContain("Výkres „Výkres 2“ – Listy (2): 1 „List 1“ A4 (aktivní) · 2 „Řez“ auto");
  });
  it("výkres výkresy: přehled, přepnutí, přejmenování, smazání; chyby", async () => {
    let { doc, log } = await run(plateDoc(), 'výkres A3\nvýkres nový "Montážní"\nvýkres výkresy');
    expect(log).toContain("Výkresy (2): 1 „Výkres 1“ 1 list · 2 „Montážní“ 1 list (aktivní)");
    ({ doc, log } = await run(doc, "výkres výkresy 1\nvýkres měřítko 1:2"));
    expect(log).toMatch(/✓ výkres „Výkres 1“ \(1 list\) – další příkazy výkresu pracují s ním/);
    expect((doc.drawings![0].options as { scale?: number }).scale).toBe(0.5);
    expect((doc.drawings![1].options as { scale?: unknown }).scale).toBe("auto");
    ({ doc, log } = await run(doc, 'výkres výkresy přejmenovat 2 "Sestava"\nvýkres výkresy "sestava"'));
    expect(drawingSets(doc).map((s) => s.name)).toEqual(["Výkres 1", "Sestava"]);
    expect(activeSheetIndex(doc)).toBe(1);
    await expect(run(doc, 'výkres nový "Sestava"')).rejects.toThrow(/výkres „Sestava“ už existuje/);
    await expect(run(doc, "výkres výkresy 5")).rejects.toThrow(/výkres 5 neexistuje – Výkresy \(2\)/);
    ({ doc, log } = await run(doc, "výkres výkresy smazat 2"));
    expect(log).toMatch(/✓ výkres „Sestava“ smazán \(1 list\) – aktivní výkres „Výkres 1“/);
    expect(doc.drawings!.length).toBe(1);
    await expect(run(doc, "výkres výkresy smazat 1")).rejects.toThrow(/jen jeden výkres/);
  });
  it("díl bez výkresu: výkres nový založí první výkres; addDrawing (tlačítko Nový výkres) další", async () => {
    const { doc } = await run(plateDoc(), "výkres nový");
    expect(doc.drawings!.length).toBe(1);
    expect(drawingsLine(doc, 0)).toBe("Výkresy (1): 1 „Výkres 1“ 1 list (aktivní)");
    const r = addDrawing(doc);
    expect(r.name).toBe("Výkres 2");
    expect(r.doc.drawings!.map((s) => s.drawing ?? "")).toEqual(["", "Výkres 2"]);
    expect(r.doc.drawings![1].id).toBe(r.sheetId);
    expect(addDrawing(r.doc).name).toBe("Výkres 3");
    expect(() => addDrawing(r.doc, "výkres 2")).toThrow(/už existuje/);
    expect(addDrawing(plateDoc()).doc.drawings![0].drawing).toBeUndefined(); // první výkres bez názvu = starší formát
  });
  it("starší dokument (listy bez názvu výkresu) se chová jako dřív", async () => {
    const { doc } = await run(plateDoc(), 'výkres list nový "B"\nvýkres list nový "C"');
    expect(drawingSets(doc).length).toBe(1);
    expect(setSheets(doc, 1)).toEqual([0, 1, 2]);
    expect(sheetMeta(doc, doc.drawings![2], 2)).toMatchObject({ sheetIndex: 3, sheetCount: 3 });
  });
});

describe("export všech listů (chyba 17)", () => {
  it("PDF vše = jedna stránka na list aktivního výkresu; výchozí = aktivní list", async () => {
    const { doc } = await run(plateDoc(), 'výkres A3\nvýkres list nový "Detail"\nvýkres list nový "Řez"');
    const one = await exportDrawing(doc, "pdf", {}, fixtureCompute);
    expect(pages(one.base64)).toBe(1);
    expect(one.sheets).toBeUndefined();
    const all = await exportDrawing(doc, "pdf", { sheet: "all" }, fixtureCompute);
    expect(all).toMatchObject({ name: "Deska_vykres.pdf", mime: "application/pdf", sheets: 3 });
    expect(pages(all.base64)).toBe(3);
    // razítko každé stránky má své číslo listu
    fixtureCalls.n = 0;
    await exportDrawing(doc, "svg", { sheet: "all" }, fixtureCompute);
    expect(fixtureCalls.n).toBe(3);
  });
  it("DXF / SVG vše = ZIP s jedním souborem na list; jeden list = obyčejný soubor; CSV = kusovník jednou", async () => {
    const { doc } = await run(plateDoc(), 'výkres list nový "Detail"\nvýkres značka text "JEN DETAIL" v 20 30');
    const z = await exportDrawing(doc, "dxf", { sheet: "all" }, fixtureCompute);
    expect(z).toMatchObject({ name: "Deska_vykres_dxf_listy.zip", mime: "application/zip", sheets: 2, files: ["Deska_list1_List_1.dxf", "Deska_list2_Detail.dxf"] });
    const entries = readZip(Buffer.from(z.base64, "base64"));
    expect(entries.map((e) => e.name)).toEqual(z.files);
    const svgs = await Promise.all(readZip(Buffer.from((await exportDrawing(doc, "svg", { sheet: "all" }, fixtureCompute)).base64, "base64")).map(async (e) => new TextDecoder().decode(await e.read())));
    expect(svgs.map((s) => s.includes("JEN DETAIL"))).toEqual([false, true]);
    const single = await exportDrawing(plateDoc(), "svg", { sheet: "all" }, fixtureCompute);
    expect(single.name).toBe("Deska_vykres.svg");
    const csv = await exportDrawing({ ...doc, kind: "assembly" }, "csv", { sheet: "all" }, fixtureCompute, { bom: [{ pos: 1, name: "Díl", qty: 1 }] });
    expect(csv.name).toBe("Deska_kusovnik.csv");
  });
  it("vše = jen listy aktivního výkresu", async () => {
    const { doc } = await run(plateDoc(), 'výkres list nový "Detail"\nvýkres nový');
    const r = await exportDrawing(doc, "pdf", { sheet: "all" }, fixtureCompute);
    expect(pages(r.base64)).toBe(1);
    activeSheet.set(doc.drawings![0].id, false);
    expect(pages((await exportDrawing(doc, "pdf", { sheet: "all" }, fixtureCompute)).base64)).toBe(2);
  });
  it("text: výkres export pdf vše vrátí soubor a protokol; list N; chyby", async () => {
    const { doc } = await run(plateDoc(), 'výkres list nový "Detail"');
    const r = await run(doc, "výkres export pdf vše");
    expect(r.file).toMatchObject({ name: "Deska_vykres.pdf", sheets: 2 });
    expect(r.log).toMatch(/^✓ výkres export PDF: Deska_vykres\.pdf \(\d+ kB, listů 2\)/);
    expect(r.doc).toBe(doc); // export dokument nemění
    expect(P("výkres export dxf list 1")).toEqual({ k: "export", format: "dxf", sheet: 1 });
    expect(P("drawing export dwg all R2010")).toEqual({ k: "export", format: "dwg", sheet: "all", dwgVersion: "R2010" });
    expect(P("zeichnung export svg alle")).toEqual({ k: "export", format: "svg", sheet: "all" });
    expect(P("výkres nový \"Montážní\"")).toEqual({ k: "drawings", op: "new", name: "Montážní" });
    expect(P("drawing new")).toEqual({ k: "drawings", op: "new" });
    expect(P("zeichnung zeichnungen 2")).toEqual({ k: "drawings", op: "select", ref: 2 });
    expect(parseAgentText("výkres export xls").errors[0]?.message).toMatch(/výkres export: neznámý formát/);
  });
});

describe("nálezy kontroly: stručný přehled výkresů a názvy souborů podle výkresu", () => {
  it("výkres výkresy vypíše přehled výkresů jen jednou (CS / EN / DE)", async () => {
    const { doc } = await run(plateDoc(), 'výkres A3\nvýkres list nový "Detail"\nvýkres nový');
    const { log } = await run(doc, "výkres výkresy");
    expect(log.match(/Výkresy \(2\):/g)?.length).toBe(1);
    expect(log).toContain("Výkres „Výkres 2“ – Listy (1): 1 „List 1“ auto (aktivní)");
    // jeden výkres: přehled výkresů + přehled listů (každý jednou)
    const one = (await run(plateDoc(), "výkres A3\nvýkres výkresy")).log;
    expect(one.match(/Výkresy \(1\):/g)?.length).toBe(1);
    expect(one).toContain("Listy (1): 1 „List 1“ A3 (aktivní)");
    for (const [lang, re] of [["en", /Drawings \(2\):/g], ["de", /Zeichnungen \(2\):/g]] as const) {
      setLang(lang);
      try {
        const l = (await run(doc, "výkres výkresy")).log;
        expect(l.match(re)?.length, l).toBe(1);
      } finally {
        setLang("cs");
      }
    }
  });
  it("export různých výkresů téhož dílu: v názvu souboru je název výkresu (PDF, ZIP i soubory v něm); jeden výkres beze změny", async () => {
    const { doc } = await run(plateDoc(), 'výkres list nový "Detail"\nvýkres nový\nvýkres list nový "Řez"');
    const d2 = await exportDrawing(doc, "pdf", { sheet: "all" }, fixtureCompute);
    expect(d2).toMatchObject({ name: "Deska_Vykres_2_vykres.pdf", sheets: 2 });
    activeSheet.set(doc.drawings![0].id, false);
    const d1 = await exportDrawing(doc, "pdf", { sheet: "all" }, fixtureCompute);
    expect(d1.name).toBe("Deska_Vykres_1_vykres.pdf");
    const z1 = await exportDrawing(doc, "dxf", { sheet: "all" }, fixtureCompute);
    expect(z1).toMatchObject({ name: "Deska_Vykres_1_vykres_dxf_listy.zip", files: ["Deska_Vykres_1_list1_List_1.dxf", "Deska_Vykres_1_list2_Detail.dxf"] });
    activeSheet.set(doc.drawings![2].id, false);
    const z2 = await exportDrawing(doc, "dxf", { sheet: "all" }, fixtureCompute);
    expect(z2.files).toEqual(["Deska_Vykres_2_list1_List_1.dxf", "Deska_Vykres_2_list2_Rez.dxf"]);
    expect((await exportDrawing(doc, "svg", {}, fixtureCompute)).name).toBe("Deska_Vykres_2_vykres.svg");
    // text: výkres export pdf vše pracuje s aktivním výkresem
    expect((await run(doc, "výkres export pdf vše")).file?.name).toBe("Deska_Vykres_2_vykres.pdf");
    // přejmenovaný výkres → jeho název
    const ren = (await run(doc, 'výkres výkresy přejmenovat 2 "Montážní"')).doc;
    expect((await exportDrawing(ren, "pdf", {}, fixtureCompute)).name).toBe("Deska_Montazni_vykres.pdf");
    // jen jeden výkres: název jako dřív
    expect((await exportDrawing((await run(plateDoc(), 'výkres list nový "Detail"')).doc, "pdf", { sheet: "all" }, fixtureCompute)).name).toBe("Deska_vykres.pdf");
  });
  it("drawingBase: díl s jedním výkresem bez přípony, s více výkresy s názvem výkresu", () => {
    const { doc } = addDrawing(addDrawing(plateDoc()).doc);
    expect(drawingBase("Hřídel", { drawings: [doc.drawings![0]] }, "")).toBe("Hridel");
    expect(drawingBase("Hřídel", doc, "")).toBe("Hridel_Vykres_1");
    expect(drawingBase("Hřídel", doc, "Výkres 2")).toBe("Hridel_Vykres_2");
  });
});
