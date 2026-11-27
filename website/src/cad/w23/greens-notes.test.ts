/**
 * Vlna 23 – „výkres strojařsky“ (požadavek majitele 27. 11., R1–R7): žádné falešné zelené u výkresu s poznámkami.
 * Skutečné jádro v Node (stejné obsluhy jako CLI / prohlížeč).
 *
 * Inventář a podmínka, za které smí být vidět:
 *  1. `✓ výkres: list „X“ vyhodnocen bez nálezů (…, poznámky a razítko)` – nikdy s 6+ řádky volného textu agenta, s údajem
 *     razítka v poznámce (věta s HRC), s listem jen s poznámkami, s 10 poznámkami vloženými hotovým JSON dokumentem;
 *     ano u čistého listu se 3 krátkými řádky (R7)
 *  2. 6. řádek textu agenta = ✗ drawing.notes-limit (i rozdělený na dva listy / zalomený), věta = ✗ drawing.note-style (R4/R5)
 *  3. „Kalit 58-60 HRC“ jako text = ℹ drawing.note-to-title a pole razítka, ne poznámka (R1)
 *  4. popis plochy v modelu → výkres ho kreslí (odkaz) a změna textu v modelu = změna na výkrese; změněná plocha = ⚠ (R2)
 *  5. oblastní úprava → tlustá čerchovaná čára (vrstva chain, SVG 0,7 mm s čárkováním, DXF vrstva UPRAVY / CENTER), kóta
 *     rozsahu, značka Z1, vysvětlivka v patičce (R3)
 *  6. přísný režim zastaví běh na ⚠ pravidel poznámek (R7); dokument otevřený člověkem (ruční poznámky) = jen ℹ (R6)
 */
import fs from "node:fs";
import path from "node:path";
import { beforeAll, describe, expect, it } from "vitest";
import { memoryFileSink, memoryFileSource, type EngineHost } from "../engine/host";
import type { KernelApi } from "../engine/kernel";
import { MemoryWorkspace } from "../engine/memory-workspace";
import { formatConsole } from "../engine/protocol";
import type { RunReport } from "../engine/protocol-types";
import { runScript } from "../engine/run";
import { setHostAssets } from "../host-assets";
import { setLang } from "../i18n";
import { makeKernelClient } from "../kernel-client";
import { sheetMeta, sheetOptions } from "../drawing-agent";
import type { DrawingResult } from "../drawing";
import type { CadDoc } from "../types";

const WASM = path.resolve(__dirname, "../../../node_modules/replicad-opencascadejs/dist/replicad_single.wasm");
const FONTS = path.resolve(__dirname, "../../../public/fonts");
const OK_RE = /✓ výkres: list „[^“]+“ vyhodnocen bez nálezů \(pohledy, řezy, Chytré kóty, poznámky a razítko\)/;
const PART = ['nový díl "Deska"', "kvádr 100 60 12", "díra 9 skrz v 50 30", "materiál 1.2379", "výkres A3 měřítko 1:1 pohledy přední,horní,iso", "kótovat chytře", "výkres nepředepsané ISO 2768-mK"];

let real: KernelApi;
let files = memoryFileSink();
const host = (): EngineHost => ({ kernel: real, files: (files = memoryFileSink()), inputs: memoryFileSource({}), now: () => Date.now() });
const run = (ws: MemoryWorkspace, lines: string[], o: { strict?: boolean } = {}) => runScript(ws, lines.join("\n"), host(), o);
const txt = (r: RunReport) => formatConsole(r);
const codes = (r: RunReport, level?: string) => r.entries.filter((e) => !level || e.level === level).map((e) => e.code);
const docOf = (ws: MemoryWorkspace, name: string): CadDoc => ws.listDocs().find((d) => d.title === name)!.doc;
const sheetRes = async (d: CadDoc, i = 0): Promise<DrawingResult> => (await real.drawing(d, sheetMeta(d, d.drawings![i], i), sheetOptions(d.drawings![i]))) as DrawingResult;

beforeAll(async () => {
  setLang("cs");
  setHostAssets({ font: async (name) => new Uint8Array(fs.readFileSync(path.join(FONTS, name))).buffer });
  const { inProcessTransport } = await import("../kernel-inprocess");
  const k = makeKernelClient(inProcessTransport({ locateFile: (file) => (file.endsWith(".wasm") ? WASM : file) }));
  await k.init();
  real = k as unknown as KernelApi;
}, 120000);

describe("w23 greens – poznámky výkresu (R4/R5/R7)", () => {
  it("1+2: šestý řádek textu agenta = ✗ drawing.notes-limit; žádné „bez nálezů“", async () => {
    const ws = new MemoryWorkspace();
    const r = await run(ws, [...PART, ...["Brousit", "Odmastit", "Oznacit", "Konzervovat", "Balit", "Zkontrolovat"].map((t, i) => `výkres značka text "${t}" v 30 ${120 - i * 5}`)]);
    const lim = r.entries.find((e) => e.code === "drawing.notes-limit")!;
    expect(lim.level).toBe("error");
    expect(lim.line).toBe(PART.length + 6);
    expect(lim.text).toMatch(/6 řádků volného textu, nejvýš 5/);
    expect(txt(r)).not.toMatch(OK_RE);
  }, 120000);
  it("2: limit neobejde druhý list ani zalomení (dlouhý řádek = víc řádků, věta = ✗)", async () => {
    const ws = new MemoryWorkspace();
    const r = await run(ws, [...PART, 'výkres značka text "Brousit" v 30 120', 'výkres list nový "Poznámky"', "výkres pohledy iso", 'výkres značka text "Odmastit" v 30 120']);
    expect(r.entries.find((e) => e.code === "drawing.notes-sheet")?.level).toBe("error");
    const r2 = await run(new MemoryWorkspace(), [...PART, 'výkres poznámka "Při jakékoli nejasnosti kontaktujte konstruktéra před výrobou dílu."']);
    expect(r2.entries.find((e) => e.code === "drawing.note-style")?.level).toBe("error");
    expect(txt(r2)).not.toMatch(/✓ L\d+ poznámka|→ poznámka:/);
  }, 120000);
  it("1+3: údaj razítka v poznámce se přesune do razítka (ℹ); smíšená věta = ✗ a žádné „bez nálezů“", async () => {
    const ws = new MemoryWorkspace();
    const r = await run(ws, [...PART, 'výkres značka text "Kalit 58-60 HRC" v 30 120', 'výkres značka text "Ra 3,2" v 30 115', 'výkres značka text "Brousit" v 30 110']);
    expect(codes(r, "note")).toContain("drawing.note-to-title");
    const m = docOf(ws, "Deska").drawings![0].meta as Record<string, unknown>;
    expect([m.heatTreatment, m.hardness, m.roughness]).toEqual(["Kalit", "58-60 HRC", "Ra 3,2"]);
    expect(docOf(ws, "Deska").drawings![0].annotations.filter((a) => a.type === "text").map((a) => (a as { text: string }).text)).toEqual(["Brousit"]);
    expect(txt(r)).toMatch(OK_RE);
    const r2 = await run(new MemoryWorkspace(), [...PART, 'výkres značka text "Díl po kalení brousit na rovinnost 0,01" v 30 120']);
    expect(r2.entries.find((e) => e.code === "drawing.note-title-data")?.level).toBe("error");
    expect(txt(r2)).not.toMatch(OK_RE);
  }, 120000);
  it("1: čistý list se 3 krátkými řádky a údaji v razítku = ✓ bez nálezů (… poznámky a razítko)", async () => {
    const ws = new MemoryWorkspace();
    const r = await run(ws, [...PART, 'výkres razítko tepelné="kalit a popustit" tvrdost="58-60 HRC" drsnost="Ra 3,2"', 'výkres značka text "Brousit" v 30 120', 'výkres značka text "Odmastit" v 30 115', 'výkres poznámka "≈ rozměry odhadem – ověřit"', "výkres stav"]);
    expect(codes(r, "error")).toEqual([]);
    expect(txt(r)).toMatch(/Poznámky nad razítkem: 3\/5 řádků \(agent 3\)/);
    expect(txt(r)).toMatch(/Údaje razítka \(technické, v buňkách\): tepelné zpracování „kalit a popustit“ · tvrdost „58-60 HRC“/);
    expect(txt(r)).toMatch(OK_RE);
  }, 120000);
  it("1+6: 10 poznámek vložených hotovým JSON dokumentem = ⚠ drawing.notes-limit, bez ✓; přísný režim zastaví běh", async () => {
    const ws0 = new MemoryWorkspace();
    await run(ws0, PART);
    const d = structuredClone(docOf(ws0, "Deska"));
    d.name = "Deska JSON";
    d.drawings![0].annotations.push(...Array.from({ length: 10 }, (_, i) => ({ id: `t${i}`, view: "sheet", type: "text" as const, at: [30, 228 + i * 4.5] as [number, number], text: `Poznamka ${i + 1}`, size: 3.5 })));
    const r = await run(new MemoryWorkspace(), [JSON.stringify(d)]);
    const lim = r.entries.find((e) => e.code === "drawing.notes-limit")!;
    expect(lim.level).toBe("warn");
    expect(txt(r)).not.toMatch(OK_RE);
    const rs = await run(new MemoryWorkspace(), [JSON.stringify(d)], { strict: true });
    expect(rs.stopped?.code).toBe("drawing.notes-limit");
  }, 120000);
  it("1+R5: list jen s poznámkami (JSON, list bez pohledu) = ⚠ drawing.sheet-duplicate / notes-sheet, bez ✓", async () => {
    const ws0 = new MemoryWorkspace();
    await run(ws0, PART);
    const d = structuredClone(docOf(ws0, "Deska"));
    d.name = "Deska listy";
    const s1 = d.drawings![0];
    d.drawings!.push({ ...structuredClone(s1), id: "s2", name: "Poznámky", options: { ...s1.options, views: { front: false, top: false, left: false, right: false, back: false, bottom: false, iso: false }, dimensions: "none" }, annotations: [{ id: "x", view: "sheet", type: "text", at: [30, 120], text: "Technicke pozadavky", size: 3.5 }] });
    const ws = new MemoryWorkspace();
    const r = await run(ws, [JSON.stringify(d), "výkres list 2", "výkres stav"]);
    // jádro list bez zapnutého pohledu nakreslí s předním pohledem → list jen opakuje pohled listu 1 a nese text = R5
    expect(codes(r)).toContain("drawing.sheet-duplicate");
    expect(codes(r)).toContain("drawing.notes-sheet");
    expect(txt(r)).not.toMatch(/✓ výkres: list „Poznámky“/);
  }, 120000);
  it("6/R6: dokument člověka (ruční poznámky z GUI) – pravidla jen radí (ℹ), nic neselže", async () => {
    const ws0 = new MemoryWorkspace();
    await run(ws0, PART);
    const d = structuredClone(docOf(ws0, "Deska"));
    d.name = "Deska ručně";
    d.drawings![0].annotations.push(...Array.from({ length: 8 }, (_, i) => ({ id: `u${i}`, view: "sheet", type: "text" as const, at: [30, 240 + i * 4.5] as [number, number], text: `Ruční poznámka ${i + 1}, pokud něco, tak to tu je.`, size: 3.5, by: "user" as const })));
    const ws = new MemoryWorkspace();
    await ws.openInTab(d);
    const r = await run(ws, ['záložka "Deska ručně"', "výkres stav"], { strict: true });
    expect(r.stopped).toBeUndefined();
    expect(r.entries.filter((e) => e.code?.startsWith("drawing.note")).every((e) => e.level === "note")).toBe(true);
    expect(codes(r, "note")).toContain("drawing.notes-limit");
  }, 120000);
});

describe("w23 – popis a oblastní úprava z modelu (R2/R3)", () => {
  it("4: popis plochy v modelu → odkaz na listu; změna textu v modelu = změna na výkrese; změněná plocha = ⚠ drawing.pmi-lost", async () => {
    const ws = new MemoryWorkspace();
    const r = await run(ws, [...PART, 'poznámka F2 "Brousit"', 'poznámka F7 "Vystruzit"', "výkres stav"]);
    expect(codes(r, "error")).toEqual([]);
    expect(txt(r)).toMatch(/Z modelu: F2 „Brousit“ → (horní|přední) \(odkaz se šipkou\)/);
    expect(txt(r)).toMatch(OK_RE);
    let res = await sheetRes(docOf(ws, "Deska"));
    expect(res.texts.some((t) => t.s === "Brousit")).toBe(true);
    await run(ws, ['záložka "Deska"', 'poznámka F2 "Lapovat"']);
    res = await sheetRes(docOf(ws, "Deska"));
    expect(res.texts.some((t) => t.s === "Lapovat")).toBe(true);
    expect(res.texts.some((t) => t.s === "Brousit")).toBe(false);
    // díra po změně průměru: plocha F7 už není označený válec Ø9 – popis se nekreslí na jinou plochu, ⚠ drawing.pmi-lost
    const r3 = await run(ws, ['záložka "Deska"', 'upravit "Díra 1" diameter=12', "výkres stav"]);
    expect(codes(r3)).toContain("drawing.pmi-lost");
    expect(txt(r3)).not.toMatch(OK_RE);
  }, 180000);
  it("4: popis z modelu nesmí nést údaj razítka ani větu (✗)", async () => {
    const r = await run(new MemoryWorkspace(), [...PART, 'poznámka F2 "Kalit 58 HRC"', 'poznámka F2 "Tuto plochu je třeba pečlivě přebrousit"']);
    expect(r.entries.filter((e) => e.level === "error").map((e) => e.code)).toEqual(["drawing.note-title-data", "drawing.note-style"]);
  }, 120000);
  it("5: oblastní úprava = tlustá čerchovaná čára 04.2 (SVG 0,7 + čárkování, DXF UPRAVY/CENTER), kóta rozsahu, Z1 a vysvětlivka", async () => {
    const ws = new MemoryWorkspace();
    const r = await run(ws, [...PART, 'úprava F3 tepelná "62+2 HRC" od 10 do 40', "výkres stav", "výkres export svg", "výkres export dxf"]);
    expect(codes(r, "error")).toEqual([]);
    expect(txt(r)).toMatch(/Z modelu: Z1 F3 „62\+2 HRC“ → přední \(tlustá čerchovaná 04\.2 \+ kóta rozsahu\)/);
    expect(txt(r)).toMatch(/Poznámky nad razítkem: 1\/5 řádků \(generátor 1\)/);
    const res = await sheetRes(docOf(ws, "Deska"));
    const chain = res.polys.filter((p) => p.layer === "chain");
    expect(chain).toHaveLength(1);
    expect(Math.hypot(chain[0].pts[1][0] - chain[0].pts[0][0], chain[0].pts[1][1] - chain[0].pts[0][1])).toBeCloseTo(30, 1);
    expect(res.texts.some((t) => t.s === "Z1")).toBe(true);
    expect(res.texts.some((t) => t.s === "30")).toBe(true);
    expect(res.texts.some((t) => t.s === "10")).toBe(true);
    expect(res.titleBlock?.footer.join(" ")).toMatch(/Z1 tepelná: 62\+2 HRC/);
    const svg = new TextDecoder().decode([...files.files.values()].find((f) => f.file.name.endsWith(".svg"))!.data);
    expect(svg).toMatch(/stroke-width="0\.7" stroke-dasharray="12 3 1\.5 3"/);
    const dxf = new TextDecoder().decode([...files.files.values()].find((f) => f.file.name.endsWith(".dxf"))!.data);
    expect(dxf).toMatch(/UPRAVY\s+70\s+0\s+62\s+1\s+6\s+CENTER/);
  }, 180000);
  it("3+R4: vysvětlivka úpravy se počítá do limitu – 5 textů + úprava = ✗ drawing.notes-limit na řádku úpravy", async () => {
    const r = await run(new MemoryWorkspace(), [...PART, ...["A1", "B2", "C3", "D4", "E5"].map((t, i) => `výkres značka text "${t}" v 30 ${120 - i * 5}`), 'úprava F3 tepelná "62+2 HRC"']);
    const lim = r.entries.find((e) => e.code === "drawing.notes-limit")!;
    expect(lim.level).toBe("error");
    expect(lim.line).toBe(PART.length + 6);
  }, 120000);
});
