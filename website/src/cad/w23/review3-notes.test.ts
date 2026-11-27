/**
 * Vlna 23, 3. kolo – nálezy oponentů (S/w23/open-review2.md, body 3–28) a závazná rozhodnutí D1–D7 jako regresní testy na
 * skutečném jádru v Node. Každý případ padá na stavu 67ed254 (CLI 0.1.0-390b97fa) a prochází po opravě.
 *
 *  K1  slovník R1 (D3): „Tol. ±0,1“, „Mat. 11 523“, „Ra=1,6“, „Brunýrovat“, „KTL“, „C0,5“, „CHT 0,8 mm“, „Ck45“, „IT12“,
 *      „DIN ISO 2768 mittel“, „AISI 304“, „Hardox 450“, „EN-GJL-250“, „PA6“, „Rohy zaoblit R0,5“ … (body 3, 20)
 *  K2  všechny kanály slovem (D2/D3): text / přípona kóty, drsnost, revize, buňky a název razítka, název listu, materiál (bod 4)
 *  K3  hlavní list podle plochy pohledů, název „Technické požadavky“ / „…/2“, dokument jen s textem, kopie listu ✗ (body 5, 6, 24)
 *  K4  výchozí list --formats, název dílu větou, materiál s tvrdostí (bod 7, D5)
 *  K5  revize jako seznam pokynů, značky drsnosti se slovy, popisy s odkazem (body 8, 9, 22)
 *  K6  přesun do obsazené buňky ⚠ title-conflict, materiál ≠ model ✗, tvrdost ve tvaru razítka (body 11, 21)
 *  K7  kóta s textem místo hodnoty ✗ a nepočítá se do kontroly kót; věta rozdělená na řádky (bod 23)
 *  K8  původ D1: soubor z disku = ⚠ drawing.notes-loaded, export povolen; úprava agentem = ✗; JSON na řádku = ✗; žádné
 *      „bez ⚠ a ✗“ vedle ✗ téhož dokumentu (bod 25)
 *  K9  2D: krátká slova, kóty, atributy, bloky × vložení, JSON / --open 2D dokument, 2d stav (body 10, 16–19)
 *  K10 volné buňky razítka jako pokyny (bod 26); popis plochy v `stav` dílu (bod 27, D7)
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
import { classifyNote, stampAgentNotes } from "../drawing-notes-rules";
import { draftNotesAudit, isLabel } from "../draft/agent-notes";
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
const warns = (r: RunReport) => r.entries.filter((e) => e.level === "warn").map((e) => e.code);
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

describe("K1 – slovník R1: běžné dílenské zápisy jsou údaje razítka (body 3, 20)", () => {
  it.each([
    ["Tol. ±0,1", "tolerance"],
    ["Volné míry ±0,2", "tolerance"],
    ["Obecně ±0,2", "tolerance"],
    ["DIN ISO 2768 mittel", "tolerance"],
    ["IT12", "tolerance"],
    ["Mat. 11 523", "material"],
    ["Ck45", "material"],
    ["AISI 304", "material"],
    ["Hardox 450", "material"],
    ["Toolox 44", "material"],
    ["EN-GJL-250", "material"],
    ["PA6 natur", "material"],
    ["Ra=1,6", "roughness"],
    ["Brunýrovat", "surfaceTreatment"],
    ["Nátěr šedý", "surfaceTreatment"],
    ["Chromátovat", "surfaceTreatment"],
    ["Cínovat", "surfaceTreatment"],
    ["KTL černá", "surfaceTreatment"],
    ["Kataforéza", "surfaceTreatment"],
    ["Vytvrdit", "heatTreatment"],
    ["CHT 0,8 mm", "heatTreatment"],
    ["Kalit indukčně", "heatTreatment"],
    ["Rohy zaoblit R1", "edges"],
    ["Fazeta 0,5", "edges"],
    ["C0,5", "edges"],
    ["Ostré rohy otupit", "edges"],
  ])("„%s“ → %s", (t, key) => {
    expect(classifyNote(t)?.parts.map((p) => p.key)).toContain(key);
  });
  it("„ISO 2768“ bez třídy je neúplný údaj – do razítka se nepřesune (mixed), „HRC 58-62“ dostane tvar razítka", () => {
    expect(classifyNote("ISO 2768")?.mixed).toBe(true);
    expect(classifyNote("HRC 58-62")?.parts).toEqual([{ key: "hardness", value: "58-62 HRC" }]);
    expect(classifyNote("1.2379 kalený na 58-60 HRC")?.parts.map((p) => `${p.key}=${p.value}`).sort()).toEqual(["hardness=58-60 HRC", "heatTreatment=kalený", "material=1.2379"]);
  });
  it("obyčejné pokyny a názvy údajem razítka nejsou („Odmastit“, „Hranol 20“, „15 000 ks“, „C45“ je materiál, ne sražení)", () => {
    for (const t of ["Odmastit", "Zabalit do VCI", "Brousit", "Hranol 20", "15 000 ks"]) expect(classifyNote(t), t).toBeNull();
    expect(classifyNote("C45")?.parts.map((p) => p.key)).toEqual(["material"]);
  });
  it("c1: 5 takových textů na listu → přesun do razítka, žádný volný řádek, ne ✓ s nimi", async () => {
    const ws = new MemoryWorkspace();
    const r = await run(ws, [...BASE, 'výkres značka text "Tol. ±0,1" v 30 120', 'výkres značka text "Mat. 11 523" v 30 115', 'výkres značka text "Ra=1,6" v 30 110', 'výkres značka text "Brunýrovat" v 30 105', 'výkres značka text "CHT 0,8 mm" v 30 100', "výkres stav"]);
    const t = txt(r);
    expect(t).toContain("Poznámky nad razítkem: 0/5");
    // „Mat. 11 523“ se liší od materiálu modelu 1.2379 → ✗ (model je zdroj, D3)
    expect(errs(r)).toContain("drawing.note-title-data");
    const m = docOf(ws, "Deska").drawings![0].meta as Record<string, unknown>;
    expect(m.surfaceTreatment).toBe("Brunýrovat");
    expect(m.heatTreatment).toBe("CHT 0,8 mm");
    expect(m.roughness).toBe("Ra 1,6");
  }, 120000);
});

describe("K2 – tepelné / povrch / hrany slovem v každém kanálu (bod 4)", () => {
  it("k2: kóta, přípona, drsnost, revize, buňky razítka a název listu se slovy úprav = ✗, nikde ✓", async () => {
    const ws = new MemoryWorkspace();
    const r = await run(ws, [...BASE, 'výkres upravit a4 text="Kalit a popustit"', 'výkres upravit a5 přípona=" černit"', 'výkres značka drsnost "Nitridovat" na Ø9', 'výkres revize A "Kalit a popustit, černit"', 'výkres razítko název="Deska kalená černěná" zákazník="Zinkovat" projekt="Hrany otupit"', 'výkres list přejmenovat 1 "Kalit a černit"', "výkres stav"]);
    const e = errs(r);
    expect(e.length).toBeGreaterThanOrEqual(6);
    expect(txt(r)).not.toMatch(OK_RE);
    const s = docOf(ws, "Deska").drawings![0];
    expect(s.name).not.toBe("Kalit a černit");
    expect(JSON.stringify(s.annotations)).not.toMatch(/Kalit a popustit|černit|Nitridovat/);
  }, 120000);
  it("mt1: `materiál 1.2379 kalit, černit` s výkresem se rozdělí – materiál 1.2379, tepelné a povrch do razítka (ℹ)", async () => {
    const ws = new MemoryWorkspace();
    const r = await run(ws, [...BASE, "materiál 1.2379 kalit, černit", "výkres stav"]);
    const d = docOf(ws, "Deska");
    expect(d.materialName).toBe("1.2379");
    const m = d.drawings![0].meta as Record<string, unknown>;
    expect(m.heatTreatment).toBe("kalit");
    expect(m.surfaceTreatment).toBe("černit");
    expect(errs(r)).toEqual([]);
  }, 120000);
});

describe("K3 – R5 / D4: hlavní list podle plochy pohledů, výkres poznámek ✗ (body 5, 6, 24)", () => {
  it("r5c: list 2 „Technické požadavky“ A4 1:5 s kótou a poznámkami → ✗ notes-sheet, export odmítnut", async () => {
    const ws = new MemoryWorkspace();
    const r = await run(ws, ['nový díl "Deska"', "kvádr 100 60 12", "díra 9 skrz v 50 30", "materiál 1.2379", "výkres A3 měřítko 1:1 pohledy přední,horní,iso", "kótovat základní", "výkres nepředepsané ISO 2768-mK", 'výkres razítko číslo="MN-1" kreslil="AI"', 'výkres list nový "Technické požadavky"', "výkres A4 měřítko 1:5 pohledy přední", "výkres kóta vodorovně pohled přední 0 0 100 0 odsazení 10", 'výkres značka text "Odmastit" v 30 120', "výkres export pdf vše"]);
    expect(errs(r)).toContain("drawing.notes-sheet");
    // list „Technické požadavky“ nevznikne (příkaz odmítnut) – výkres se na „výkres + poznámky“ nerozdělí
    const d = docOf(ws, "Deska");
    expect(d.drawings!.map((s) => s.name)).not.toContain("Technické požadavky");
    expect(d.drawings!.length).toBe(1);
  }, 120000);
  it("s2b: list 1 žeton 1:10 s poznámkami před skutečným výkresem → hlavní list je list 2, poznámky na listu 1 ✗", async () => {
    const ws = new MemoryWorkspace();
    const r = await run(ws, ['nový díl "Deska"', "kvádr 100 60 12", "díra 9 skrz v 50 30", "materiál 1.2379", "výkres A4 měřítko 1:10 pohledy přední", 'výkres razítko číslo="MN-1" kreslil="AI"', "výkres nepředepsané ISO 2768-mK", 'výkres list nový "Výkres"', "výkres A3 měřítko 1:1 pohledy přední,horní", "kótovat chytře", "výkres list 1", 'výkres značka text "Odmastit" v 30 120', "výkres stav vše"]);
    expect(errs(r)).toContain("drawing.notes-sheet");
    expect(txt(r)).not.toMatch(/List 1“ vyhodnocen bez nálezů/);
  }, 120000);
  it("md1 / s1: dokument jen s textem (kvádr 1×1×1) a výkres s číslem „…/2“ → ✗ notes-sheet, nic se neexportuje", async () => {
    const ws = new MemoryWorkspace();
    const r = await run(ws, ['nový díl "Pomocný"', "kvádr 1 1 1", "výkres A4 měřítko 1:1 pohledy přední", 'výkres razítko číslo="MN-1/2" kreslil="AI"', 'výkres značka text "Odmastit" v 30 200', "výkres export pdf"]);
    expect(errs(r)).toContain("drawing.notes-sheet");
    // číslo „…/2“ ani text na zástupném tělese se nezapíšou
    const s = docOf(ws, "Pomocný").drawings![0];
    expect((s.meta as Record<string, unknown>).number ?? "").not.toBe("MN-1/2");
    expect(JSON.stringify(s.annotations)).not.toContain("Odmastit");
  }, 120000);
  it("dokument jen s textem z JSON řádku (zástupné těleso + poznámka) = ✗ a export odmítnut", async () => {
    const ws = new MemoryWorkspace();
    await run(ws, ['nový díl "Pomocný"', "kvádr 1 1 1", "výkres A4 měřítko 1:1 pohledy přední"]);
    const d = docOf(ws, "Pomocný");
    const bad = { ...d, drawings: d.drawings!.map((s) => ({ ...s, annotations: [...s.annotations, { id: "t1", view: "sheet", type: "text", at: [30, 200], text: "Odmastit", size: 3.5 }] })) };
    const r = await run(new MemoryWorkspace(), [JSON.stringify(bad), "výkres export pdf"]);
    expect(errs(r)).toContain("drawing.notes-sheet");
    expect(out(".pdf").length).toBe(0);
  }, 120000);
  it("kopie listu (jen opakuje pohledy): prázdná = ⚠ drawing.sheet-duplicate, s textem agenta = ✗", async () => {
    const ws = new MemoryWorkspace();
    const r = await run(ws, [...BASE, 'výkres list nový "Kopie"', "výkres A3 měřítko 1:1 pohledy přední,horní,iso", "výkres stav vše"]);
    expect(r.entries.some((e) => e.code === "drawing.sheet-duplicate" && e.level === "warn")).toBe(true);
    // JSON agenta: kopie listu 1 s textem (text na jiném než hlavním listu je ✗ notes-sheet i duplicitní list ✗)
    const d = docOf(ws, "Deska");
    const s0 = d.drawings![0];
    const copy = { ...s0, id: "kopie2", name: "Kopie 2", annotations: [{ id: "t9", view: "sheet", type: "text", at: [30, 60], text: "Odmastit", size: 3.5 }] };
    const r2 = await run(new MemoryWorkspace(), [JSON.stringify({ ...d, drawings: [s0, copy] }), "výkres list 2", "výkres stav"]);
    expect(r2.entries.some((e) => e.code === "drawing.sheet-duplicate" && e.level === "error")).toBe(true);
  }, 120000);
});

describe("K4 – D5: výchozí list --formats a název dílu (bod 7)", () => {
  it("dn2: název dílu větou bez výkresu = ✗ už na řádku `nový díl`; materiál s tvrdostí bez výkresu ✗ s radou", async () => {
    const ws = new MemoryWorkspace();
    const r = await run(ws, ['nový díl "Deska kalit a popustit na 58-60 HRC, černit, pokud není uvedeno jinak kontaktujte konstruktéra"', "kvádr 100 60 12", "materiál 1.2379 kalený na 58-60 HRC"]);
    const e = errs(r);
    expect(e.filter((c) => c === "drawing.note-style" || c === "drawing.note-title-data").length).toBeGreaterThanOrEqual(2);
    expect(txt(r)).not.toMatch(/✓ nový díl „Deska kalit/);
  }, 120000);
  it("výchozí list (dokument bez výkresu) jde stejnou kontrolou: export výkresu dílu s názvem-větou se odmítne", async () => {
    const ws = new MemoryWorkspace();
    const r = await run(ws, ['nový díl "Kalit a popustit"', "kvádr 100 60 12", "výkres export pdf"]);
    expect(errs(r).length).toBeGreaterThan(0);
    expect(out(".pdf").length).toBe(0);
  }, 120000);
});

describe("K5 – revize, drsnost a popisy s odkazem jako kanál poznámek (body 8, 9, 22)", () => {
  it("rv1: revize, která není popis změny = ✗; víc než 5 řádků revize od agenta = ✗", async () => {
    const ws = new MemoryWorkspace();
    const r = await run(ws, [...BASE, 'výkres revize A "Odmastit"', "výkres stav"]);
    expect(errs(r)).toContain("drawing.note-style");
    const ws2 = new MemoryWorkspace();
    const revs = ["A", "B", "C", "D", "E", "F"].map((x, i) => `výkres revize ${x} "Ø${20 + i} → Ø${21 + i}"`);
    const r2 = await run(ws2, [...BASE, ...revs, "výkres stav"]);
    expect(errs(r2)).toContain("drawing.notes-limit");
    expect(txt(r2)).not.toMatch(OK_RE);
  }, 120000);
  it("k3: značka drsnosti se slovy bez hodnoty = ✗; s hodnotou a jedním slovem projde", async () => {
    const ws = new MemoryWorkspace();
    const r = await run(ws, [...BASE, 'výkres značka drsnost "Brousit jemně" na 100']);
    expect(errs(r)).toContain("drawing.note-style");
    const ws2 = new MemoryWorkspace();
    const r2 = await run(ws2, [...BASE, 'výkres značka drsnost "Ra 0,4 lapovat" na 100']);
    expect(errs(r2)).toEqual([]);
  }, 120000);
});

describe("K6 – přesun do razítka: rozpor ⚠, materiál z modelu, tvar hodnoty (body 11, 21)", () => {
  it("r1a: „RAL 9005“ a pak „Fe/Zn 8“ – první hodnota zůstane, ⚠ drawing.title-conflict s oběma", async () => {
    const ws = new MemoryWorkspace();
    const r = await run(ws, [...BASE, "výkres nepředepsané ISO 2768-mK", 'výkres značka text "RAL 9005" v 30 120', 'výkres značka text "Fe/Zn 8" v 30 115']);
    expect(warns(r)).toContain("drawing.title-conflict");
    expect((docOf(ws, "Deska").drawings![0].meta as Record<string, unknown>).surfaceTreatment).toBe("RAL 9005");
    expect(txt(r)).not.toMatch(OK_RE);
  }, 120000);
  it("p3: „Ocel tř. 19“ při materiálu modelu 1.2379 = ✗ (model je zdroj), materiál se nezmění", async () => {
    const ws = new MemoryWorkspace();
    const r = await run(ws, [...BASE, 'výkres značka text "Ocel tř. 19" v 30 115']);
    expect(errs(r)).toContain("drawing.note-title-data");
    expect(docOf(ws, "Deska").materialName).toBe("1.2379");
  }, 120000);
  it("p4: „HRC 58-62“ se do buňky tvrdost zapíše ve tvaru razítka „58-62 HRC“", async () => {
    const ws = new MemoryWorkspace();
    await run(ws, [...BASE, 'výkres značka text "HRC 58-62" v 30 115']);
    expect((docOf(ws, "Deska").drawings![0].meta as Record<string, unknown>).hardness).toBe("58-62 HRC");
  }, 120000);
});

describe("K7 – kóta s textem místo hodnoty a věta rozdělená na řádky (bod 23)", () => {
  it("p6b: `výkres upravit a4 text=\"Odmastit\"` = ✗, kóta se nezmění", async () => {
    const ws = new MemoryWorkspace();
    const r = await run(ws, [...BASE, 'výkres upravit a4 text="Odmastit"']);
    expect(errs(r)).toContain("drawing.note-style");
    expect(JSON.stringify(docOf(ws, "Deska").drawings![0].annotations)).not.toContain("Odmastit");
  }, 120000);
  it("věta rozdělená na řádky („…očistit,“ / „a odeslat …“) = ✗", async () => {
    const ws = new MemoryWorkspace();
    const r = await run(ws, [...BASE, 'výkres značka text "Po obrobení díl očistit," v 30 120']);
    expect(errs(r)).toContain("drawing.note-style");
    const r2 = await run(new MemoryWorkspace(), [...BASE, 'výkres značka text "a odeslat zákazníkovi" v 30 120']);
    expect(errs(r2)).toContain("drawing.note-style");
  }, 120000);
});

describe("K8 – původ D1: soubor z disku ⚠, ne ✗; úprava agentem ✗; JSON na řádku ✗ (bod 25)", () => {
  const legacy = async () => {
    const ws = new MemoryWorkspace();
    await run(ws, [...BASE, "výkres nepředepsané ISO 2768-mK"]);
    const d = docOf(ws, "Deska");
    const s = d.drawings![0];
    const notes = ["Odmastit", "Konzervovat", "Zabalit", "Označit", "Měřit", "Balit", "Expedovat"].map((t, i) => ({ id: `n${i}`, view: "sheet", type: "text", at: [30, 120 - 5 * i], text: t, size: 3.5 }));
    // soubor uložený člověkem před vlnou 23: texty bez razítka původu
    return { ...d, drawings: [{ ...s, annotations: [...s.annotations.map((a) => ({ ...a, by: undefined })), ...notes] }] } as unknown as CadDoc;
  };
  it("h1: `--open`/`otevřít` archivního výkresu se 7 poznámkami → ⚠ drawing.notes-loaded, export PDF proběhne, žádné ✓", async () => {
    inputs = { "archiv.mncad": new TextEncoder().encode(JSON.stringify(await legacy())) };
    const ws = new MemoryWorkspace();
    const r = await run(ws, ['otevřít "archiv.mncad"', "výkres export pdf"]);
    expect(errs(r)).toEqual([]);
    expect(warns(r)).toContain("drawing.notes-loaded");
    expect(out(".pdf").length).toBe(1);
    const t = txt(r);
    expect(t).not.toMatch(OK_RE);
    expect(t).not.toMatch(/postaven: prvků \d+, bez ⚠ a ✗/);
  }, 120000);
  it("soubor s padělaným `\"by\":\"user\"` dostane jen ⚠ (původ loaded), přidání textu agentem nad limit = ✗", async () => {
    const d = await legacy();
    const forged = { ...d, drawings: d.drawings!.map((s) => ({ ...s, annotations: s.annotations.map((a) => ({ ...a, by: "user" })) })) };
    expect(stampAgentNotes(forged as CadDoc, "loaded").drawings![0].annotations.every((a) => a.by === "loaded")).toBe(true);
    inputs = { "archiv.mncad": new TextEncoder().encode(JSON.stringify(forged)) };
    const ws = new MemoryWorkspace();
    const r = await run(ws, ['otevřít "archiv.mncad"', 'výkres značka text "Leštit" v 30 60']);
    expect(errs(r)).toContain("drawing.notes-limit");
  }, 120000);
  it("JSON dokument na řádku skriptu (agent v tomto běhu) se 7 poznámkami = ✗ a export odmítnut", async () => {
    const ws = new MemoryWorkspace();
    const r = await run(ws, [JSON.stringify(await legacy()), "výkres export pdf"]);
    expect(errs(r)).toContain("drawing.notes-limit");
    expect(out(".pdf").length).toBe(0);
    expect(txt(r)).not.toMatch(/postaven: prvků \d+, bez ⚠ a ✗/);
  }, 120000);
});

describe("K9 – 2D výkres: všechny kanály (body 10, 16–19)", () => {
  it("štítek jen podle seznamu: „A-A“, „Řez A-A“, „Detail B“, „12“, „Z1“, „1:2“ ano; „Kalit“, „HRC60“, „±0,1“ ne", () => {
    for (const t of ["A", "A-A", "Řez A-A", "Detail B", "12", "Poz. 3", "Z1", "1:2"]) expect(isLabel(t), t).toBe(true);
    for (const t of ["Kalit", "HRC60", "±0,1", "Odmastit", "Ra0,8", "Zinkovat"]) expect(isLabel(t), t).toBe(false);
  });
  it("d1: 12 jednoslovných textů → údaje razítka ✗ a limit ✗ (2d text se nepřijme)", async () => {
    const ws = new MemoryWorkspace();
    const words = ["HRC58-62", "Odmastit", "Konzervovat", "Zabalit", "Označit", "Měřit", "Balit"];
    const r = await run(ws, ["2d nový Deska2D", "2d obdélník 0,0 100,60", ...words.map((w, i) => `2d text 10,${150 - 5 * i} 3.5 0 "${w}"`), "2d stav"]);
    const t = txt(r);
    expect(t).toMatch(/✗ .*HRC58-62/);
    expect(t).toMatch(/Poznámky nad razítkem: 5\/5/);
  }, 120000);
  it("d8: text kóty větou / údajem razítka = ✗", async () => {
    const ws = new MemoryWorkspace();
    const r = await run(ws, ["2d nový Deska2D", "2d obdélník 0,0 100,60", '2d kóta-lineární 0,0 100,0 text "Kalit a popouštět na 58-60 HRC" 50,-15']);
    expect(txt(r)).toMatch(/✗ .*pravidla výkresu pro agenty/);
  }, 120000);
  it("d3b: text v bloku × počet vložení se počítá – 4. vložení 5řádkového bloku = ✗", async () => {
    const ws = new MemoryWorkspace();
    const r = await run(ws, ["2d nový Deska2D", "2d obdélník 0,0 100,60", '2d mtext 10,200 @120,-30 "Odmastit\\PKonzervovat\\PZabalit\\POznačit\\PMěřit"', "2d blok POZN 10,200 e2", "2d vložit POZN 10,150", "2d vložit POZN 10,100"]);
    expect(txt(r)).toMatch(/✗ .*pravidla výkresu pro agenty/);
  }, 120000);
  it("d6: 2D dokument z JSON řádku s větami = ✗ na načtení, DXF se nezapíše", async () => {
    const ws = new MemoryWorkspace();
    await run(ws, ["2d nový Deska2D", "2d obdélník 0,0 100,60"]);
    const d = docOf(ws, "Deska2D");
    const draft = d.draft as { entities: unknown[] };
    const bad = { ...d, draft: { ...draft, entities: [...draft.entities, { type: "mtext", p: [10, 150], h: 3.5, s: "1. Kalit a popouštět na 58-60 HRC podle předpisu výrobce oceli.\\P2. Při jakékoli nejasnosti kontaktujte konstruktéra.", id: "e99", layer: "0", w: 180 }] } };
    const ws2 = new MemoryWorkspace();
    const r = await run(ws2, [JSON.stringify(bad), "2d export dxf"]);
    expect(errs(r).length).toBeGreaterThan(0);
    expect(txt(r)).toMatch(/export odmítnut/);
    // týž soubor otevřený z disku = jen ⚠ (D1)
    const stamped = stampAgentNotes(bad as unknown as CadDoc, "loaded");
    const f = draftNotesAudit(stamped.draft as never);
    expect(f.length).toBeGreaterThan(0);
    expect(f.every((x) => x.by === "loaded")).toBe(true);
  }, 120000);
});

describe("K10 – volné buňky razítka a popis plochy v modelu (body 26, 27)", () => {
  it("l1: zákazník / projekt / kontroloval jako pokyny = ✗", async () => {
    const ws = new MemoryWorkspace();
    const r = await run(ws, [...BASE, 'výkres razítko projekt="Odmastit, konzervovat" zákazník="Zabalit do VCI" kontroloval="Měrný protokol 3.1"']);
    expect(errs(r)).toContain("drawing.note-style");
  }, 120000);
  it("`poznámka F2 \"Brousit\"` je vidět ve `stav` dílu (řádek Popisy ploch) – jeden zdroj s výkresem", async () => {
    const ws = new MemoryWorkspace();
    const r = await run(ws, ['nový díl "Deska"', "kvádr 100 60 12", 'poznámka F2 "Brousit"', "stav"]);
    expect(txt(r)).toMatch(/Popisy ploch \(1\): F2 „Brousit“/);
  }, 120000);
});
