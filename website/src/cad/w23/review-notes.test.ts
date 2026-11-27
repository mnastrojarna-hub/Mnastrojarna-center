/**
 * Vlna 23, 2. kolo – nálezy oponenta (S/w23/review, body 2–29) jako regresní testy na skutečném jádru v Node.
 * Každý případ padá na stavu da89b10 (oponentův CLI 0.1.0-011e7a14) a prochází po opravě.
 *
 *  A  R1 klasifikace: „HRC 58-62“, „Tolerance ±0,1“, „0,5x45°“, „RAL 9005“, „Fe/Zn 8“, „Zn 8 µm“, „Ocel C45“, „Ocel 19 436“,
 *     „N7“, „Pískovat“, „Break sharp corners“ … → razítko, nikdy volný řádek ani ✓ s nimi (body 2, 19)
 *  B  ostatní kanály: text a přípona kóty, ruční kóta, revize, buňky razítka, drsnost, tolerance, popis díry (body 3, 17, 20)
 *  C  druhý výkres téhož dílu i obrácené pořadí „poznámky + výkres“ (body 4, 5, 22)
 *  D  úpravy před výkresem a jejich vysvětlivky (body 6, 18)
 *  E  JSON / otevřený dokument: „by“:„user“ se nebere, porušení = ✗ na řádku načtení, export odmítnut (body 7, 8, 16, 21, 23, 24c)
 *  F  pád vyhodnocení listu na data.lines (body 9, 15)
 *  G  místní popisy: limit 8, odkaz na kótu ✗, odkaz jen na výkrese ⚠ (body 10, 24a)
 *  H  2D výkres `2d mtext` (body 11, 24b)
 *  I  vysoké písmo (bod 12), rozsah úpravy mimo plochu (bod 26), DXF tloušťka 04.2 (bod 27)
 *  J  člověk (GUI): ruční text jen ℹ, ✓ řekne „ruční text: N rad ℹ“ (bod 29 – hranice)
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
import { stampOrigin } from "../drawing-notes-rules";
import type { CadDoc } from "../types";

const WASM = path.resolve(__dirname, "../../../node_modules/replicad-opencascadejs/dist/replicad_single.wasm");
const FONTS = path.resolve(__dirname, "../../../public/fonts");
const OK_RE = /✓ výkres: list „[^“]+“ vyhodnocen bez nálezů/;
const BASE = ['nový díl "Deska"', "kvádr 100 60 12", "díra 9 skrz v 50 30", "materiál 1.2379", "výkres A3 měřítko 1:1 pohledy přední,horní,iso", "kótovat chytře", 'výkres razítko číslo="MN-1" kreslil="AI"'];

let real: KernelApi;
let files = memoryFileSink();
let inputs: Record<string, Uint8Array> = {};
const host = (): EngineHost => ({ kernel: real, files: (files = memoryFileSink()), inputs: memoryFileSource(inputs), now: () => Date.now() });
const run = (ws: MemoryWorkspace, lines: string[], o: { strict?: boolean } = {}) => runScript(ws, lines.join("\n"), host(), o);
const txt = (r: RunReport) => formatConsole(r);
const errs = (r: RunReport) => r.entries.filter((e) => e.level === "error").map((e) => e.code);
const docOf = (ws: MemoryWorkspace, name: string): CadDoc => ws.listDocs().find((d) => d.title === name)!.doc;
const svgOut = () => [...files.files.values()].filter((f) => f.file.name.endsWith(".svg"));
const pdfOut = () => [...files.files.values()].filter((f) => f.file.name.endsWith(".pdf"));

beforeAll(async () => {
  setLang("cs");
  setHostAssets({ font: async (name) => new Uint8Array(fs.readFileSync(path.join(FONTS, name))).buffer });
  const { inProcessTransport } = await import("../kernel-inprocess");
  const k = makeKernelClient(inProcessTransport({ locateFile: (file) => (file.endsWith(".wasm") ? WASM : file) }));
  await k.init();
  real = k as unknown as KernelApi;
}, 120000);

describe("A – R1: běžné zápisy klíčových údajů patří do razítka (body 2, 19)", () => {
  it.each([
    ["HRC 58-62", "hardness"],
    ["Tolerance ±0,1", "tolerance"],
    ["0,5x45°", "edges"],
    ["RAL 9005", "surfaceTreatment"],
    ["Fe/Zn 8", "surfaceTreatment"],
    ["Nekótované tolerance ±0,2", "tolerance"],
    ["Povrch Zn 8 µm", "surfaceTreatment"],
    ["N7", "roughness"],
    ["Pískovat", "surfaceTreatment"],
    ["Nekótované rozměry ±0,1", "tolerance"],
    ["Zn 8 µm", "surfaceTreatment"],
    ["Break sharp corners", "edges"],
  ])("„%s“ → buňka razítka %s, ne řádek poznámky", async (t, key) => {
    const ws = new MemoryWorkspace();
    const r = await run(ws, [...BASE, `výkres značka text "${t}" v 30 120`, "výkres stav"]);
    expect(r.entries.some((e) => e.code === "drawing.note-to-title")).toBe(true);
    const s = docOf(ws, "Deska").drawings![0];
    expect(s.annotations.some((a) => a.type === "text")).toBe(false);
    expect(String((s.meta as Record<string, unknown>)[key] ?? "")).not.toBe("");
    expect(txt(r)).toMatch(/Poznámky nad razítkem: 0\/5/);
  }, 120000);
  // kolo 3 (D3): materiál je údaj MODELU – bez materiálu modelu se z poznámky zapíše do modelu; jiný materiál, než má model
  // (BASE: 1.2379), = ✗ a model se nezmění (dřív poznámka materiál modelu tiše přepsala)
  it.each([["Ocel C45", "C45"], ["Ocel 19 436", "19 436"]])("materiál „%s“ → razítko (materiál dílu)", async (t, v) => {
    const ws = new MemoryWorkspace();
    await run(ws, [...BASE.filter((l) => !l.startsWith("materiál")), `výkres značka text "${t}" v 30 120`]);
    expect(docOf(ws, "Deska").materialName).toContain(v);
    expect(docOf(ws, "Deska").drawings![0].annotations.some((a) => a.type === "text")).toBe(false);
    const ws2 = new MemoryWorkspace();
    const r2 = await run(ws2, [...BASE, `výkres značka text "${t}" v 30 120`]);
    expect(errs(r2)).toContain("drawing.note-title-data");
    expect(docOf(ws2, "Deska").materialName).toBe("1.2379");
  }, 120000);
});

describe("B – ostatní kanály textu (body 3, 17, 20)", () => {
  it.each([
    ['výkres upravit a4 text="Kalit a popustit na 58-60 HRC, ostré hrany srazit"', "drawing.note-style"],
    ['výkres upravit a5 přípona=" po kalení brousit, pokud není uvedeno jinak kontaktujte konstruktéra"', "drawing.note-style"],
    ['výkres kóta vodorovně pohled přední 0 0 100 0 odsazení 20 text "Tepelně zpracovat na tvrdost 58 až 60 HRC podle předpisu"', "drawing.note-style"],
    ['výkres revize A "Při jakékoli nejasnosti kontaktujte konstruktéra, díl kalit na 58-60 HRC"', "drawing.note-style"],
    ['výkres revize B "Kalit 58 HRC"', "drawing.note-title-data"],
    ['výkres razítko název="Deska, kterou je nutné kalit na 58 HRC a černit, pokud není uvedeno jinak"', "drawing.note-style"],
    ['výkres razítko název="Deska kalená 58 HRC"', "drawing.note-title-data"],
    ['výkres razítko povrch="Černění dle normy, vrstva rovnoměrná bez skvrn, kontaktujte konstruktéra"', "drawing.note-style"],
    ['výkres razítko tepelné="Tepelně zpracovat kalit a popustit na tvrdost 58 až 60 HRC podle předpisu výrobce oceli"', "drawing.note-style"],
    ['výkres hrany "Všechny ostré hrany srazit a zbavit otřepů, pokud není uvedeno jinak"', "drawing.note-style"],
    ["výkres značka drsnost Ra 3,2 kalit na 58 HRC a černit na Ø9", "drawing.note-style"],
    ['výkres list přejmenovat 1 "Při nejasnosti kontaktujte konstruktéra, díl kalit na 58 HRC a černit"', "drawing.note-style"],
  ])("%s → ✗ %s, text se nezapíše", async (line, code) => {
    const ws = new MemoryWorkspace();
    const r = await run(ws, [...BASE, line, "výkres export svg"]);
    expect(errs(r)).toContain(code);
    const svg = svgOut().map((f) => new TextDecoder().decode(f.data)).join("");
    expect(svg).not.toMatch(/kontaktujte|předpisu|pokud není|černit/);
    expect(txt(r)).not.toMatch(OK_RE);
  }, 120000);
  it("šest revizí s větami (t10) = ✗, žádné „bez nálezů“", async () => {
    const r = await run(new MemoryWorkspace(), [...BASE, ..."ABCDEF".split("").map((x) => `výkres revize ${x} "Pokud není uvedeno jinak, díl kalit na 58-60 HRC a kontaktujte konstruktéra"`)]);
    expect(errs(r).filter((c) => c === "drawing.note-style")).toHaveLength(6);
    expect(txt(r)).not.toMatch(OK_RE);
  }, 120000);
  // kolo 3 (D2): řádek revize je popis změny – „změna: …“; samotné „tvrdost 58-60 HRC“ popisem změny není (✗, test K5)
  it("krátká revize s údajem, který razítko nese, projde", async () => {
    const r = await run(new MemoryWorkspace(), [...BASE, 'výkres razítko tvrdost="58-60 HRC"', 'výkres revize A "změna: tvrdost 58-60 HRC"']);
    expect(errs(r)).toEqual([]);
  }, 120000);
});

describe("C – druhý výkres a obrácené pořadí listů (body 4, 5, 22)", () => {
  it("r5a: 5 textů na výkrese 1, další výkres „Poznámky“ s texty = ✗ drawing.notes-sheet / notes-limit, export bez porušení", async () => {
    const t = (n: number, i: number) => `výkres značka text "Bod${n}${i}" v 30 ${120 - i * 5}`;
    const r = await run(new MemoryWorkspace(), [...BASE, ...[0, 1, 2, 3, 4].map((i) => t(1, i)), 'výkres nový "Poznámky"', "výkres pohledy iso", ...[0, 1, 2, 3, 4].map((i) => t(2, i)), "výkres export pdf vše"]);
    expect(errs(r).filter((c) => c === "drawing.notes-sheet" || c === "drawing.notes-limit").length).toBeGreaterThanOrEqual(5);
    // kolo 3 (D4): výkres s názvem „Poznámky“ už nevznikne (✗ hned při založení), texty pak narazí na limit hlavního listu
    expect(txt(r)).toMatch(/[Pp]oznámky nad razítkem|volný text patří jen na hlavní list|výkres poznámek/);
  }, 180000);
  it("r5b: list 1 jen izometrie + texty, list 2 skutečný výkres = ✗ drawing.notes-sheet při vyhodnocení, bez ✓", async () => {
    const r = await run(new MemoryWorkspace(), [
      'nový díl "Deska"', "kvádr 100 60 12", "díra 9 skrz v 50 30", "výkres A4 měřítko 1:5 pohledy iso", 'výkres razítko název="Technicke pozadavky"',
      'výkres značka text "Odmastit" v 30 120', 'výkres značka text "Konzervovat" v 30 115',
      'výkres list nový "Výkres"', "výkres A3 měřítko 1:1 pohledy přední,horní", "kótovat chytře",
    ]);
    expect(errs(r)).toContain("drawing.notes-sheet");
    expect(txt(r)).not.toMatch(/✓ výkres: list „List 1“ vyhodnocen bez nálezů/);
  }, 180000);
});

describe("D – oblastní úpravy před výkresem (body 6, 18)", () => {
  it("6. úprava s jiným předpisem = ✗ drawing.notes-limit i bez výkresu; výkres pak má nejvýš 5 vysvětlivek", async () => {
    const ws = new MemoryWorkspace();
    const r = await run(ws, ['nový díl "Deska"', "kvádr 100 60 12", ...[1, 2, 3, 4, 5, 6, 7, 8].map((i) => `úprava F${1 + (i % 6)} tepelná "${50 + i}+2 HRC" od 0 do 10`), "výkres A3 pohledy přední,horní,levý", "kótovat chytře", "výkres stav"]);
    expect(errs(r)).toContain("drawing.notes-limit");
    expect(txt(r)).not.toMatch(/Poznámky nad razítkem: [6-9]\/5/);
  }, 180000);
});

describe("E – dokument z textové cesty (body 7, 8, 16, 21, 23, 24c)", () => {
  const forged = async (by: "user" | undefined) => {
    const ws0 = new MemoryWorkspace();
    await run(ws0, BASE);
    const d = structuredClone(docOf(ws0, "Deska"));
    d.name = "Deska JSON";
    d.drawings![0].annotations.push(...Array.from({ length: 7 }, (_, i) => ({ id: `t${i}`, view: "sheet", type: "text" as const, at: [30, 228 + i * 4.5] as [number, number], text: `${i + 1}. Kalit a popouštět na 58-60 HRC, pokud není uvedeno jinak.`, size: 3.5, ...(by ? { by } : {}) })));
    return d;
  };
  it.each([["user"], [undefined]] as const)("JSON s by=%s → ✗ na řádku JSON, ✗ při vyhodnocení, export odmítnut, žádné ✓", async (by) => {
    const d = await forged(by);
    const r = await run(new MemoryWorkspace(), [JSON.stringify(d), "výkres stav", "výkres export pdf"]);
    const first = r.entries.find((e) => e.level === "error" && e.code?.startsWith("drawing."))!;
    expect(first.line).toBe(1);
    expect(r.entries.some((e) => e.code === "op.failed")).toBe(false);
    expect(pdfOut()).toHaveLength(0);
    expect(txt(r)).toMatch(/export odmítnut/);
    expect(txt(r)).not.toMatch(OK_RE);
    expect(r.entries.filter((e) => e.code?.startsWith("drawing.note")).every((e) => e.level !== "note")).toBe(true);
  }, 180000);
  // kolo 3 (D1): soubor otevřený z disku = text „loaded“ – ne ✗ (archivní výkres člověka musí jít exportovat), ale ⚠
  // drawing.notes-loaded místo ✓; padělané "by":"user" nekoupí víc než ⚠ (dřív ✗ „dokument agenta“)
  it("otevřít \"soubor.mncad\" (CLI --open) s by=user = načtený soubor → ⚠ drawing.notes-loaded, žádné ✓", async () => {
    const d = await forged("user");
    inputs = { "forged.mncad": new TextEncoder().encode(JSON.stringify(d)) };
    const r = await run(new MemoryWorkspace(), ['otevřít "forged.mncad"', "výkres stav"]);
    inputs = {};
    expect(r.entries.some((e) => e.code === "drawing.notes-loaded" && e.level === "warn")).toBe(true);
    expect(txt(r)).not.toMatch(OK_RE);
  }, 180000);
  it("popis plochy z JSON (113 znaků s HRC) = ✗ při vyhodnocení i načtení", async () => {
    const ws0 = new MemoryWorkspace();
    await run(ws0, [...BASE, 'poznámka F2 "Brousit"']);
    const d = structuredClone(docOf(ws0, "Deska"));
    d.functional!.find((m) => m.kind === "note")!.text = "Tepelně zpracovat na tvrdost 58 až 60 HRC podle předpisu výrobce oceli, pokud není uvedeno jinak výše";
    const r = await run(new MemoryWorkspace(), [JSON.stringify(d), "výkres stav"]);
    expect(errs(r)).toContain("drawing.note-style");
    expect(txt(r)).not.toMatch(OK_RE);
  }, 180000);
});

describe("F – vyhodnocení listu nepadá (body 9, 15)", () => {
  it("⚠/✗ drawing.notes-limit s počtem řádků v datech → žádné op.failed „is not iterable“", async () => {
    const ws0 = new MemoryWorkspace();
    await run(ws0, BASE);
    const d = structuredClone(docOf(ws0, "Deska"));
    d.drawings![0].annotations.push(...Array.from({ length: 10 }, (_, i) => ({ id: `t${i}`, view: "sheet", type: "text" as const, at: [30, 228 + i * 4.5] as [number, number], text: `Bod ${i + 1}`, size: 3.5 })));
    const r = await run(new MemoryWorkspace(), [JSON.stringify(d), "výkres stav"]);
    expect(txt(r)).not.toMatch(/is not iterable/);
    expect(r.entries.some((e) => e.code === "op.failed")).toBe(false);
    expect(errs(r)).toContain("drawing.notes-limit");
  }, 180000);
});

describe("G – místní popisy (body 10, 24a)", () => {
  it("odkaz na kótu = ✗; 9. popis v modelu = ✗ drawing.leaders-limit; odkaz jen na výkrese = ⚠ drawing.note-not-model", async () => {
    const r = await run(new MemoryWorkspace(), [...BASE, 'výkres značka poznámka "Brousit" na Ø9']);
    expect(errs(r)).toContain("drawing.note-free-leader");
    // 7 popisů v modelu (F1–F7) + 2 odkazy na hranách = 9 > 8 → ✗ u devátého
    const r2 = await run(new MemoryWorkspace(), [...BASE, ...["Brousit", "Lapovat", "Lestit", "Honovat", "Zabrousit", "Vystruzit", "Zahladit"].map((t, i) => `poznámka F${i + 1} "${t}"`), 'výkres značka poznámka "Uhladit" pohled přední v 50 12', 'výkres značka poznámka "Kartacovat" pohled přední v 20 12']);
    const lim = r2.entries.find((e) => e.code === "drawing.leaders-limit")!;
    expect(lim.level).toBe("error");
    expect(lim.line).toBe(BASE.length + 9);
    const r3 = await run(new MemoryWorkspace(), [...BASE, 'výkres značka poznámka "Brousit" pohled přední v 50 12']);
    expect(r3.entries.find((e) => e.code === "drawing.note-not-model")?.level).toBe("warn");
    expect(txt(r3)).not.toMatch(OK_RE);
  }, 180000);
});

describe("H – 2D výkres (body 11, 24b)", () => {
  it("2d mtext s osmi větami a údaji razítka = ✗, entita nevznikne; krátký štítek projde", async () => {
    const ws = new MemoryWorkspace();
    const r = await run(ws, ['2d nový Deska2D', '2d mtext 10,200 @180,-60 "1. Kalit a popouštět na 58-60 HRC, pokud není uvedeno jinak.\\P2. Hrany srazit 0,5x45.\\P3. Černit.\\P4. Ra 3,2.\\P5. Odmastit.\\P6. Balit.\\P7. Expedovat.\\P8. Zabalit."', '2d text 10,10 3,5 "A-A"']);
    expect(txt(r)).toMatch(/✗.*pravidla výkresu pro agenty/);
    const d = docOf(ws, "Deska2D");
    expect(d.draft!.entities.some((e) => e.type === "mtext")).toBe(false);
  }, 120000);
});

describe("I – výška písma, rozsah úpravy, DXF (body 12, 26, 27)", () => {
  it("text výšky 40 mm = ✗ (vysoké písmo limit neobejde)", async () => {
    const r = await run(new MemoryWorkspace(), [...BASE, 'výkres značka text "Odmastit" v 30 60 výška 40']);
    // 40 mm písma = 12 řádků po 3,5 mm → limit řádků (a výška nad 5 mm)
    expect(errs(r).some((c) => c === "drawing.notes-limit" || c === "drawing.note-style")).toBe(true);
    const r2 = await run(new MemoryWorkspace(), [...BASE, 'výkres značka text "Odmastit" v 30 60 výška 7']);
    expect(errs(r2)).toContain("drawing.note-style");
  }, 120000);
  it("úprava od 50 do 400 na ploše 100 mm = ⚠ drawing.pmi-range, bez ✓", async () => {
    const r = await run(new MemoryWorkspace(), [...BASE, 'úprava F3 povrchová "cernit" od 50 do 400', "výkres stav"]);
    expect(r.entries.some((e) => e.code === "drawing.pmi-range")).toBe(true);
    expect(txt(r)).not.toMatch(OK_RE);
  }, 120000);
  it("DXF: tlustá čerchovaná 04.2 = POLYLINE na UPRAVY se šířkou 0,7", async () => {
    const r = await run(new MemoryWorkspace(), [...BASE, 'úprava F3 tepelná "62+2 HRC" od 10 do 40', "výkres export dxf"]);
    expect(errs(r)).toEqual([]);
    const dxf = new TextDecoder().decode([...files.files.values()].find((f) => f.file.name.endsWith(".dxf"))!.data);
    expect(dxf).toMatch(/POLYLINE\s+8\s+UPRAVY\s+6\s+CENTER\s+66\s+1(?:\s+\d+\s+[\d.-]+){3}\s+40\s+0\.7\s+41\s+0\.7/);
  }, 120000);
});

describe("J – člověk v GUI (R6, bod 29)", () => {
  it("ruční text (GUI razítko „user“) = jen ℹ rady; ✓ to řekne („ruční text: N rad ℹ“)", async () => {
    const ws0 = new MemoryWorkspace();
    await run(ws0, BASE);
    const d0 = docOf(ws0, "Deska");
    const s0 = d0.drawings![0];
    const s1 = stampOrigin(s0, { ...s0, annotations: [...s0.annotations, ...Array.from({ length: 7 }, (_, i) => ({ id: `u${i}`, view: "sheet", type: "text" as const, at: [30, 240 + i * 4.5] as [number, number], text: `Ruční poznámka ${i + 1}, pokud něco, tak to tu je.`, size: 3.5 }))] }, "user");
    const d = { ...structuredClone(d0), name: "Deska ručně", drawings: [s1] };
    const ws = new MemoryWorkspace();
    await ws.openInTab(d);
    const r = await run(ws, ['záložka "Deska ručně"', "výkres stav"], { strict: true });
    expect(r.stopped).toBeUndefined();
    expect(errs(r)).toEqual([]);
    expect(txt(r)).toMatch(/ruční text: \d+ rad ℹ/);
  }, 120000);
});
