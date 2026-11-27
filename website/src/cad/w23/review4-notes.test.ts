/**
 * Vlna 23, 4. kolo – nálezy oponentů kola 3 (body 3–12 a F1–F10) jako regresní testy na skutečném jádru v Node. Každý případ
 * padá na stavu 7b9c882 (CLI 0.1.0-5aff447c, repro S/w23/review-r3/atk, …/s, …/v, …/d) a prochází po opravě.
 *
 *  P1  řádek popisu s odkazem je technický jen jako označení díry / závitu / sražení – číslo ho technickým nedělá (bod 3)
 *  P2  2D: blok „ISO7200_TITLE“ od agenta s vlastním textem se počítá; rámeček tolerance a značka drsnosti 2D se kontrolují
 *      (body 4, 5, F6)
 *  P3  dokument jen nosič textu: holé primitivum 6 mm s pokyny (bod 6, F3); kopie listu / dělení výkres + poznámky (bod 11, F2)
 *  P4  slova v textu / příponě kóty se počítají do 5 řádků (bod 7, F7)
 *  P5  technická buňka razítka nese hodnotu svého druhu; polotovar bez tvrdosti / úprav (bod 8, F8)
 *  P6  slovník: nástrojové oceli, DC01, X5CrNi18-10, Ms58, DIN 7168, +0,1/-0,1, Zaoblit R0,5, Black oxide, „Tvrdit 58-60“,
 *      „Allgemeintoleranz“, HV 650 → 650 HV, neviditelné znaky (bod 9, F4, F8, F9)
 *  P7  původ D1: `uložit` + `otevřít` a soubor z běhu s ✗ (`--open`) text agenta nevyperou; „ze souboru“ v hlášce (bod 10, F1)
 *  P8  revize s pokynem ✗ i se „změna:“ / „→“ (F5); popis plochy v modelu s pokynem ✗ u příkazu (F10)
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
import { calloutLineTech, cellValueProblem, classifyNote, dimFreeWords, freeTextList, normHardness, noteStyle, stampAgentNotes, type FreeText } from "../drawing-notes-rules";
import type { CadDoc, DrawingAnnotation } from "../types";

const WASM = path.resolve(__dirname, "../../../node_modules/replicad-opencascadejs/dist/replicad_single.wasm");
const FONTS = path.resolve(__dirname, "../../../public/fonts");
const OK_RE = /✓ výkres: list „[^“]+“ vyhodnocen bez nálezů/;
const BASE = ['nový díl "Deska"', "kvádr 100 60 12", "díra 9 skrz v 50 30", "materiál 1.2379", "výkres A3 měřítko 1:1 pohledy přední,horní,iso", "kótovat chytře", "výkres nepředepsané ISO 2768-mK", 'výkres razítko číslo="MN-1" kreslil="AI"'];
const NOTES5 = ["Odmastit", "Konzervovat", "Zabalit do VCI", "Označit rytinou", "Měrný protokol 3.1"].map((t, i) => `výkres značka text "${t}" v 30 ${120 - 5 * i}`);

let real: KernelApi;
let files = memoryFileSink();
let inputs: Record<string, Uint8Array> = {};
const host = (): EngineHost => ({ kernel: real, files: (files = memoryFileSink()), inputs: memoryFileSource(inputs), now: () => Date.now() });
const run = (ws: MemoryWorkspace, lines: string[]) => runScript(ws, lines.join("\n"), host());
const txt = (r: RunReport) => formatConsole(r);
const errs = (r: RunReport) => r.entries.filter((e) => e.level === "error").map((e) => e.code);
const docOf = (ws: MemoryWorkspace, name: string): CadDoc => ws.listDocs().find((d) => d.title === name)!.doc;
const out = (ext: string) => [...files.files.values()].filter((f) => f.file.name.endsWith(ext));

beforeAll(async () => {
  setLang("cs");
  setHostAssets({ font: async (name) => new Uint8Array(fs.readFileSync(path.join(FONTS, name))).buffer });
  const { inProcessTransport } = await import("../kernel-inprocess");
  const k = makeKernelClient(inProcessTransport({ locateFile: (file) => (file.endsWith(".wasm") ? WASM : file) }));
  await k.init();
  real = k as unknown as KernelApi;
}, 120000);

describe("P1 – popis s odkazem: číslo v řádku ho technickým nedělá (bod 3)", () => {
  it.each([
    ["4× Ø9 skrz", true],
    ["⌴ Ø15 ↧9", true],
    ["⌵ Ø16,5 × 90°", true],
    ["M8×1,25 - 6H ↧12", true],
    ["Ø6,8 ↧20 (ploché dno)", true],
    ["2× Ø8 H7", true],
    ["0,5×45°", true],
    ["1) Brousit jemně", false],
    ["1) Rovinnost hlídat 2x", false],
    ["Ø9honovat skrz", false],
  ])("„%s“ technický = %s", (l, tech) => {
    expect(calloutLineTech(l)).toBe(tech);
  });
  it("t2b: JSON dokument s 12 popisy „1) Brousit jemně“ / „1) Rovinnost hlídat 2x“ = ✗ limit řádků i místních popisů, žádné PDF", async () => {
    const ws = new MemoryWorkspace();
    await run(ws, BASE);
    const d = docOf(ws, "Deska");
    const s = d.drawings![0];
    const callouts = Array.from({ length: 12 }, (_, i) => ({ id: `c${i}`, view: "top", type: "callout", tip: [10 + i * 5, 10], at: [20 + i * 5, 30], lines: [`${i + 1}) Brousit jemně`, `${i + 1}) Rovinnost hlídat 2x`] }));
    const bad = { ...d, drawings: [{ ...s, annotations: [...s.annotations, ...callouts] }] };
    const ws2 = new MemoryWorkspace();
    const r = await run(ws2, [JSON.stringify(bad), "výkres stav", "výkres export pdf"]);
    expect(errs(r)).toContain("drawing.notes-limit");
    expect(errs(r)).toContain("drawing.leaders-limit");
    expect(out(".pdf").length).toBe(0);
    expect(txt(r)).not.toMatch(OK_RE);
    expect(txt(r)).not.toMatch(/postaven: prvků \d+, bez ⚠ a ✗/);
  }, 120000);
});

describe("P2 – 2D: blok razítka podle obsahu, rámeček tolerance, značka drsnosti (body 4, 5, F6)", () => {
  it("d1: MTEXT v bloku pojmenovaném ISO7200_TITLE × 3 vložení se počítá = ✗ (dřív 5/5 a ✓)", async () => {
    const ws = new MemoryWorkspace();
    const r = await run(ws, ["2d nový Deska2D", "2d obdélník 0,0 100,60", '2d mtext 10,200 @120,-30 "Odmastit\\PKonzervovat\\PZabalit do VCI\\POznačit rytinou\\PMěrný protokol"', "2d blok ISO7200_TITLE 10,200 e2", "2d vložit ISO7200_TITLE 10,150", "2d vložit ISO7200_TITLE 10,100", "2d vložit ISO7200_TITLE 150,200", "2d stav"]);
    expect(txt(r)).toMatch(/✗ .*pravidla výkresu pro agenty/);
    expect(txt(r)).toMatch(/Poznámky nad razítkem: 5\/5/);
  }, 120000);
  it("skutečné razítko rozvržení (popisky buněk) se jako poznámka nepočítá", async () => {
    const ws = new MemoryWorkspace();
    const r = await run(ws, ["2d nový Deska2D", "2d obdélník 0,0 100,60", "2d rozvržení nové Výkres A3", "2d stav"]);
    expect(txt(r)).not.toMatch(/✗ .*pravidla výkresu pro agenty/);
    expect(txt(r)).toMatch(/Poznámky nad razítkem: 0\/5/);
  }, 120000);
  it("d3: rámeček tolerance s pokyny / údaji razítka = ✗; čistý rámeček projde", async () => {
    const ws = new MemoryWorkspace();
    const r = await run(ws, ["2d nový Deska2D", "2d obdélník 0,0 100,60", '2d tolerance řetězec "Kalit a popustit na 58-60 HRC, černit, odmastit, zabalit do VCI" 120,40', '2d tolerance řetězec "Odmastit" 120,80']);
    expect((txt(r).match(/✗ .*TOLERANCE: pravidla výkresu pro agenty/g) ?? []).length).toBe(2);
    const ws2 = new MemoryWorkspace();
    const r2 = await run(ws2, ["2d nový Deska2D", "2d obdélník 0,0 100,60", "2d tolerance poloha 0.1 A 120,40"]);
    expect(txt(r2)).not.toMatch(/✗/);
  }, 120000);
  it("dd1: značka drsnosti 2D s větou / pokynem / bez hodnoty = ✗; „Ra 1,6“ projde", async () => {
    const ws = new MemoryWorkspace();
    const r = await run(ws, ["2d nový Deska2D", "2d obdélník 0,0 100,60", '2d drsnost 10,60 0 "Kalit a popouštět na 58-60 HRC podle předpisu"', '2d drsnost 50,60 0 "Odmastit a konzervovat olejem"', '2d drsnost 100,30 270 "Při nejasnosti kontaktujte konstruktéra"', '2d drsnost 30,60 0 "Ra 1,6"']);
    expect((txt(r).match(/✗ .*SURFSYM: pravidla výkresu pro agenty/g) ?? []).length).toBe(3);
    expect(docOf(ws, "Deska2D").draft!.entities.filter((e) => e.type === "surfsym").length).toBe(1);
  }, 120000);
});

describe("P3 – nosič textu a dělení výkres + poznámky (body 6, 11, F2, F3)", () => {
  it("t3: druhý dokument = holé primitivum 6×6×6 s 5 pokyny → ✗ notes-sheet, jeho PDF se nezapíše", async () => {
    const ws = new MemoryWorkspace();
    const r = await run(ws, [...BASE, ...NOTES5, 'nový díl "Deska B"', "kvádr 6 6 6", "výkres A4 měřítko 1:1 pohledy přední,horní", 'výkres razítko číslo="MN-1-B" kreslil="AI"', ...["Svary zabrousit", "Kontrola rovinnosti 100 %", "Skladovat v suchu", "Expedovat paletou", "Balit jednotlivě"].map((t, i) => `výkres značka text "${t}" v 30 ${120 - 5 * i}`), "výkres export pdf"]);
    expect(errs(r)).toContain("drawing.notes-sheet");
    expect(txt(r)).toMatch(/nosič textu/);
    // dokument Deska B nese nejvýš tolik řádků textu, kolik má kót (zbytek odmítnut)
    const b = docOf(ws, "Deska B");
    expect(b.drawings![0].annotations.filter((a) => a.type === "text").length).toBeLessThanOrEqual(3);
  }, 120000);
  it("t4: list 1 s kótami + list „Detail“ se stejnými pohledy a poznámkami → ✗ (dřív OK exit 0, ⚠ obviňovalo list bez textu)", async () => {
    const ws = new MemoryWorkspace();
    const r = await run(ws, ['nový díl "Deska"', "kvádr 100 60 12", "díra 9 skrz v 50 30", "materiál 1.2379", "výkres A3 měřítko 1:1 pohledy přední,horní", "kótovat chytře", "výkres nepředepsané ISO 2768-mK", 'výkres list nový "Detail"', "výkres A3 měřítko 1:1 pohledy přední,horní,levý", ...NOTES5, "výkres stav vše", "výkres export pdf vše"]);
    expect(errs(r).some((c) => c === "drawing.sheet-duplicate" || c === "drawing.notes-sheet")).toBe(true);
    expect(txt(r)).not.toMatch(/nepřidává nic než text.*„List 1“ opakuje|„List 1“ opakuje pohledy listu „Detail“ a nepřidává nic než text/);
    // poznámky na listu „Detail“ se nezapíšou (hlavní list = List 1 s kótami); případné PDF je bez nich
    expect(docOf(ws, "Deska").drawings!.flatMap((s) => s.annotations).filter((a) => a.type === "text").length).toBe(0);
  }, 120000);
  it("t5: ruční kóta na listu s poznámkami nevypne kontrolu kopie – kopie ✗ a export obou listů se odmítne kódem chyby", async () => {
    const ws = new MemoryWorkspace();
    const r = await run(ws, ['nový díl "Deska"', "kvádr 100 60 12", "díra 9 skrz v 50 30", "materiál 1.2379", "výkres A3 měřítko 1:1 pohledy přední,horní", "kótovat základní", "výkres nepředepsané ISO 2768-mK", 'výkres list nový "Detail"', "výkres A3 měřítko 1:1 pohledy přední,horní,levý", "výkres kóta vodorovně pohled přední 0 0 100 0 odsazení 10", ...NOTES5, "výkres stav vše", "výkres export pdf vše"]);
    expect(errs(r)).toContain("drawing.sheet-duplicate");
    expect(r.entries.some((e) => e.level === "error" && /export odmítnut/.test(e.text ?? ""))).toBe(true);
    expect(out(".pdf").length).toBe(0);
  }, 120000);
  it("n1 (F2): list 2 s více pohledy bez kót a s poznámkami hlavním listem není → ✗ notes-sheet", async () => {
    const ws = new MemoryWorkspace();
    const r = await run(ws, [...BASE, 'výkres list nový "Pohledy"', "výkres A3 měřítko 1:1 pohledy přední,horní,levý", "kótovat nic", ...NOTES5]);
    expect(errs(r).filter((c) => c === "drawing.notes-sheet").length).toBe(5);
    expect(docOf(ws, "Deska").drawings![1].annotations.filter((a) => a.type === "text").length).toBe(0);
  }, 120000);
  it("prázdná kopie listu v dokumentu bez textu zůstane ⚠ (ne ✗) – e2e cad-w15-titleblock / cad-drawing-springs", async () => {
    const ws = new MemoryWorkspace();
    const r = await run(ws, ['nový díl "Sestava pružin"', "kvádr 40 30 10", "výkres A4", "výkres list nový Pružina", "výkres stav vše"]);
    expect(errs(r)).toEqual([]);
  }, 120000);
});

describe("P4 – slova v kótě se počítají do 5 řádků (bod 7, F7)", () => {
  it("dimFreeWords: „100 lapovat“, „Ø9honovat“ = slova; „<> H7“, „2× Ø8“, „116,62 úhl.“ ne", () => {
    const d = (x: Partial<{ prefix: string; text: string; suffix: string }>) => ({ type: "dim", kind: "horizontal", a: [0, 0], b: [100, 0], offset: 10, ...x }) as unknown as DrawingAnnotation;
    expect(dimFreeWords(d({ suffix: " lapovat" }))).toEqual(["lapovat"]);
    expect(dimFreeWords(d({ text: "Ø9honovat skrz" }))).toEqual(["honovat"]);
    expect(dimFreeWords(d({ text: "<> H7" }))).toEqual([]);
    expect(dimFreeWords(d({ prefix: "2× Ø8" }))).toEqual([]);
    expect(dimFreeWords(d({ text: "116,62 úhl." }))).toEqual([]);
  });
  it("t1: 4 kóty s příponou „lapovat / leštit / brousit / honovat“ + 5 poznámek → ✗ notes-limit (dřív 5/5 a ✓)", async () => {
    const ws = new MemoryWorkspace();
    const r = await run(ws, [...BASE, 'výkres upravit a4 přípona=" lapovat"', 'výkres upravit a5 přípona=" leštit"', 'výkres upravit a6 přípona=" brousit"', 'výkres upravit a3 přípona="honovat"', ...NOTES5, "výkres stav"]);
    expect(errs(r)).toContain("drawing.notes-limit");
    expect(txt(r)).toMatch(/Poznámky nad razítkem: [45]\/5 řádků/);
    expect(txt(r)).not.toMatch(OK_RE);
  }, 120000);
});

describe("P5 – buňka razítka nese hodnotu svého druhu (bod 8, F8)", () => {
  it.each([
    ["heatTreatment", "Konzervovat olejem", false],
    ["surfaceTreatment", "Zabalit do VCI", false],
    ["angleTol", "Označit rytinou", false],
    ["chamferTol", "Měrný protokol 3.1", false],
    ["stock", "Odmastit a zabalit", false],
    ["stock", "Tyč 1.2379 kalená 58 HRC černěná", false],
    ["edges", "chránit", false],
    ["tolerance", "Allgemeintoleranz", false],
    ["heatTreatment", "kalit a popustit", true],
    ["heatTreatment", "kalit 58–60 HRC", true],
    ["surfaceTreatment", "černit", true],
    ["surfaceTreatment", "zinek", true],
    ["surfaceTreatment", "bez úpravy", true],
    ["angleTol", "±0°30′", true],
    ["chamferTol", "±0,2", true],
    ["stock", "plech 40×160×185", true],
    ["stock", "Ø14×20", true],
    ["edges", "ISO 13715 -0,3", true],
    ["tolerance", "X. ±0,1 / X.X ±0,1 / X.XX ±0,02", true],
    ["hardness", "650 HV10", true],
  ])("%s = „%s“ v pořádku: %s", (k, v, okv) => {
    expect(cellValueProblem(k, v) === null).toBe(okv);
  });
  it("l2: `výkres razítko polotovar=… tepelné=\"Konzervovat olejem\" …` = ✗, razítko se nezmění", async () => {
    const ws = new MemoryWorkspace();
    const r = await run(ws, [...BASE, 'výkres razítko polotovar="Odmastit a zabalit" tepelné="Konzervovat olejem" povrch="Zabalit do VCI" úhly="Označit rytinou" sražení="Měrný protokol 3.1"']);
    expect(errs(r)).toContain("drawing.note-title-data");
    const m = docOf(ws, "Deska").drawings![0].meta as Record<string, unknown>;
    expect(m.heatTreatment).toBeUndefined();
    expect(m.surfaceTreatment).toBeUndefined();
  }, 120000);
});

describe("P6 – slovník a tvar hodnot (bod 9, F4, F8, F9)", () => {
  it.each([
    ["Vanadis 23", "material"],
    ["Böhler K110", "material"],
    ["Sverker 21", "material"],
    ["Elmax", "material"],
    ["Calmax", "material"],
    ["X5CrNi18-10", "material"],
    ["DC01", "material"],
    ["Ms58", "material"],
    ["DIN 7168 m", "tolerance"],
    ["+0,1/-0,1", "tolerance"],
    ["Zaoblit R0,5", "edges"],
    ["Black oxide", "surfaceTreatment"],
    ["Chem. Ni", "surfaceTreatment"],
  ])("„%s“ → %s", (t, key) => {
    expect(classifyNote(t)?.parts.map((p) => p.key)).toContain(key);
  });
  it("neúplný údaj se do razítka nepřesune (mixed): „Tvrdit 58-60“, „Tvrdost 58“, „Allgemeintoleranz“, „Tolerance volných rozměrů m“", () => {
    for (const t of ["Tvrdit 58-60", "Tvrdost 58", "Allgemeintoleranz", "Tolerance volných rozměrů m", "Nepředepsané tolerance střední"]) expect(classifyNote(t)?.mixed, t).toBe(true);
    expect(classifyNote("Kalit a popustit na 58-60 HRC")?.mixed).toBe(false);
    expect(classifyNote("Cementovat CHT 0,8")?.mixed).toBe(false);
  });
  it("F4: „HV 650“ = 650 HV (dřív „0 HV65“), „HV10 600“ = 600 HV10", () => {
    expect(normHardness("HV 650")).toBe("650 HV");
    expect(normHardness("HV10 600")).toBe("600 HV10");
    expect(classifyNote("HV 650")?.parts).toEqual([{ key: "hardness", value: "650 HV" }]);
  });
  it("F4: poznámka „HV 650“ → razítko tvrdost „650 HV“", async () => {
    const ws = new MemoryWorkspace();
    await run(ws, [...BASE, 'výkres značka text "HV 650" v 30 60']);
    expect((docOf(ws, "Deska").drawings![0].meta as Record<string, unknown>).hardness).toBe("650 HV");
  }, 120000);
  it("F9: měkké dělení / nulová mezera klasifikaci neobejdou a styl je ohlásí", () => {
    expect(classifyNote("Ka­lit")?.parts.map((p) => p.key)).toEqual(["heatTreatment"]);
    expect(classifyNote("Čer​nit")?.parts.map((p) => p.key)).toEqual(["surfaceTreatment"]);
    expect(noteStyle("Odm​astit")).toMatch(/neviditelné znaky/);
  });
  it("v1: nástrojová ocel jiná než materiál modelu = ✗ (model je zdroj), žádné ✓", async () => {
    const ws = new MemoryWorkspace();
    const r = await run(ws, [...BASE, 'výkres značka text "Vanadis 23" v 30 120', "výkres stav"]);
    expect(errs(r)).toContain("drawing.note-title-data");
  }, 120000);
});

describe("P7 – původ D1: uložit + otevřít text agenta nevypere (bod 10, F1)", () => {
  it("stampAgentNotes(…, loaded): `by:\"agent\"` ze souboru zůstane agent, `by:\"user\"` / chybí = loaded", () => {
    const doc = { name: "D", nameBy: "agent", drawings: [{ id: "s", name: "List 1", meta: { name: "", by: { number: "agent" }, number: "MN-1" }, annotations: [{ id: "a", type: "text", text: "X", size: 3.5, at: [0, 0], view: "sheet", by: "agent" }, { id: "b", type: "text", text: "Y", size: 3.5, at: [0, 0], view: "sheet", by: "user" }, { id: "c", type: "text", text: "Z", size: 3.5, at: [0, 0], view: "sheet" }] }] } as unknown as CadDoc;
    const s = stampAgentNotes(doc, "loaded");
    expect(s.drawings![0].annotations.map((a) => a.by)).toEqual(["agent", "loaded", "loaded"]);
    expect((s.drawings![0].meta as { by: Record<string, string> }).by.number).toBe("agent");
    expect((s as { nameBy?: string }).nameBy).toBe("agent");
  });
  it("t6a / F1: JSON s 9 poznámkami → uložit → otevřít → export = ✗, žádné PDF (dřív ⚠ a PDF)", async () => {
    const ws = new MemoryWorkspace();
    await run(ws, BASE);
    const d = docOf(ws, "Deska");
    const s = d.drawings![0];
    const notes = ["Kalit a popustit na 58-60 HRC podle předpisu výrobce oceli", "Odmastit", "Konzervovat", "Zabalit", "Označit", "Měřit", "Balit", "Expedovat", "Pokud není uvedeno jinak, kontaktujte konstruktéra"].map((t, i) => ({ id: `n${i}`, view: "sheet", type: "text", at: [30, 120 - 5 * i], text: t, size: 3.5 }));
    const bad = { ...d, drawings: [{ ...s, annotations: [...s.annotations, ...notes] }] };
    const ws2 = new MemoryWorkspace();
    await run(ws2, [JSON.stringify(bad), 'uložit "Lndr"']);
    const saved = out(".mncad")[0];
    expect(saved).toBeTruthy();
    inputs = { "Lndr.mncad": new Uint8Array(saved.data) };
    const ws3 = new MemoryWorkspace();
    const r = await run(ws3, ['otevřít "Lndr.mncad"', "výkres export pdf"]);
    expect(errs(r)).toContain("drawing.notes-limit");
    expect(out(".pdf").length).toBe(0);
    expect(txt(r)).not.toMatch(/agent ho nezměnil, export je povolen/);
  }, 120000);
  it("výpis řádků: text ze souboru je „ze souboru“, ne „generátor“", () => {
    const x: FreeText = { sheet: 0, pos: 0, ref: "a1", key: "ann:a", kind: "text", text: "Bod 1", lines: 1, by: "loaded" };
    expect(freeTextList([x])).toContain("ze souboru");
    expect(freeTextList([x])).not.toContain("generátor");
  });
});

describe("P8 – revize a popis plochy v modelu s pokynem (F5, F10)", () => {
  it("rv2: revize „změna: odmastit …“, „Expedice → paleta“ = ✗ (pokyn i s prefixem)", async () => {
    const ws = new MemoryWorkspace();
    const r = await run(ws, [...BASE, 'výkres revize A "změna: odmastit a konzervovat"', 'výkres revize B "Expedice → paleta"', 'výkres revize C "Ø9 → Ø10"']);
    expect(errs(r).filter((c) => c === "drawing.note-style").length).toBe(2);
    const revs = (docOf(ws, "Deska").drawings![0].meta as { revisions?: { rev: string }[] }).revisions ?? [];
    expect(revs.map((x) => x.rev)).toEqual(["C"]);
  }, 120000);
  it("m2: `poznámka F3 \"Odmastit\"` = ✗ u příkazu, model ho nepřijme; „Lapovat“ projde", async () => {
    const ws = new MemoryWorkspace();
    const r = await run(ws, ['nový díl "Deska"', "kvádr 100 60 12", 'poznámka F3 "Odmastit"', 'poznámka F2 "Lapovat"', "stav"]);
    expect(errs(r)).toEqual(["drawing.note-style"]);
    const pmi = (docOf(ws, "Deska").functional ?? []).filter((m) => m.kind === "note");
    expect(pmi.map((m) => m.text)).toEqual(["Lapovat"]);
    expect(txt(r)).toMatch(/Popisy ploch \(1\): F2 „Lapovat“/);
  }, 120000);
});
