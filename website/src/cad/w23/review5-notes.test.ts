/**
 * Vlna 23, 5. kolo – nálezy oponentů kola 4 (S/w23/open-review4.json) jako regresní testy na skutečném jádru v Node.
 *
 * SPRÁVNOST (commit „5. kolo (správnost)“) – stav b01ecca dával agentovi výkres HORŠÍ než main:
 *  S1  přesun poznámky do razítka je bezeztrátový (correct-F4): rozsah / tolerance tvrdosti se nerozdělí do jiného pole
 *      („58 HRC ±2“ není obecná tolerance ±2), „Kalit 58÷62 HRC“, „HRC 58÷62“, „58/60 HRC“ celé, „Rz 6,3 / Ra 0,8“ obě,
 *      „ISO 2768-mK / ISO 8015“ obě; co parser beze ztráty nezapíše, se nepřesune (✗ s radou), nikdy ✓; kontrola tam a zpět
 *  S2  název dílu / listu / výkresu je jmenná fráze (correct-F6): 40+ skutečných názvů dílů cs/en/de projde, 15+ pokynů ✗;
 *      nález názvu celého dokumentu se neopakuje u každého příkazu výkresu
 *  S3  nález celého dokumentu nemá „list model:“ / „list materiál:“ / „list název dílu:“ a ⚠ načteného souboru je jednou (correct-F7)
 *
 * OBEJITÍ (commit „5. kolo“):
 *  B1  revize s tepelným zpracováním / povrchem / hranami jako „změna“ jen s údajem v razítku (bypass-F1)
 *  B2  údaje generátoru z JSON (meta.formNotes, meta.pmi, meta.bom …) se neberou (bypass-F2); příznak „auto“ popisu se
 *      nevěří – popis se hodnotí obsahem (bypass-F3); popisky pohledů a názvy pohledů modelů jen značkou / jmennou frází (F4)
 *  B3  nosič textu bez ohledu na prvky (0 kót, drobné těleso, „MN-1-B“ = druhý výkres téhož dílu) (bypass-F5, correct-F1)
 *  B4  buňky kusovníku sestavy od agenta (bypass-F6, correct-F2); volné buňky razítka podle druhu (correct-F3)
 *  B5  slovník (correct-F5): složeniny, materiály, HRC ≥, Rockwell – a názvy dílů dál projdou
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
import { bomCellIssue, cellKindIssue, classifyNote, docNameIssue, instructionWord, lostTokens, stampAgentNotes } from "../drawing-notes-rules";
import { sheetMeta } from "../drawing-agent";
import type { CadDoc } from "../types";

const WASM = path.resolve(__dirname, "../../../node_modules/replicad-opencascadejs/dist/replicad_single.wasm");
const FONTS = path.resolve(__dirname, "../../../public/fonts");
const OK_RE = /✓ výkres: list „[^“]+“ vyhodnocen bez nálezů/;
const PART = (name = "Deska") => [`nový díl "${name}"`, "kvádr 100 60 12", "díra 9 skrz v 50 30", "výkres A3 měřítko 1:1 pohledy přední,horní,iso", "kótovat chytře", 'výkres razítko číslo="MN-1" kreslil="AI"'];

let real: KernelApi;
let files = memoryFileSink();
let inputs: Record<string, Uint8Array> = {};
const host = (): EngineHost => ({ kernel: real, files: (files = memoryFileSink()), inputs: memoryFileSource(inputs), now: () => Date.now() });
const run = (ws: MemoryWorkspace, lines: string[]) => runScript(ws, lines.join("\n"), host());
const txt = (r: RunReport) => formatConsole(r);
const errs = (r: RunReport) => r.entries.filter((e) => e.level === "error").map((e) => e.code);
const docOf = (ws: MemoryWorkspace, name: string): CadDoc => ws.listDocs().find((d) => d.title === name)!.doc;
const out = (ext: string) => [...files.files.values()].filter((f) => f.file.name.endsWith(ext));
/** hodnoty buněk razítka listu, kam přesun zapisuje (+ materiál modelu) */
const TITLE_KEYS = ["heatTreatment", "hardness", "surfaceTreatment", "edges", "tolerance", "roughness"] as const;
const cells = (d: CadDoc): string[] => [...TITLE_KEYS.map((k) => String((d.drawings?.[0]?.meta as Record<string, unknown>)[k] ?? "")).filter(Boolean), ...(d.materialName ? [d.materialName] : [])];

beforeAll(async () => {
  setLang("cs");
  setHostAssets({ font: async (name) => new Uint8Array(fs.readFileSync(path.join(FONTS, name))).buffer });
  const { inProcessTransport } = await import("../kernel-inprocess");
  const k = makeKernelClient(inProcessTransport({ locateFile: (file) => (file.endsWith(".wasm") ? WASM : file) }));
  await k.init();
  real = k as unknown as KernelApi;
}, 120000);

/** rozsahy a dvojice hodnot z praxe – každá se buď přesune CELÁ, nebo vůbec (✗ s radou) */
const RANGES = [
  "58 HRC ±2",
  "Tvrdost 58 HRC ±2",
  "Kalit 58÷62 HRC",
  "HRC 58÷62",
  "58/60 HRC",
  "HRC ≥ 58",
  "≥ 58 HRC",
  "min. 58 HRC",
  "58+2 HRC",
  "60 ± 2 HRC",
  "Kalit a popustit 58-60 HRC",
  "HV10 600",
  "Ra 0,8 max",
  "Rz 6,3 / Ra 0,8",
  "Ra 0,8, Rz 4",
  "Zn 8 µm + pasivace",
  "Pozinkovat 8-12 µm",
  "Zn 8 µm ±2",
  "ISO 2768-mK / ISO 8015",
  "ISO 2768-mK ±0,1",
  "DIN ISO 2768 mittel",
  "ISO 2768-1 mK",
  "Hrany 0,5x45° a R0,5",
  "Materiál 1.2379 / 1.2842",
  "1.2379 / 1.2842 kalit",
  "Ra 3,2 brousit",
  "Nekótované rozměry ±0,1",
  "Tol. +0,1/-0,1",
  "Cementovat CHT 0,8, 58-62 HRC",
  "Nitridovat 0,3 mm",
];

describe("S1 – přesun do razítka bez ztráty (correct-F4)", () => {
  it.each([
    ["58 HRC ±2", [["hardness", "58 HRC ±2"]]],
    ["Tvrdost 58 HRC ±2", [["hardness", "58 HRC ±2"]]],
    ["Kalit 58÷62 HRC", [["hardness", "58÷62 HRC"], ["heatTreatment", "Kalit"]]],
    ["HRC 58÷62", [["hardness", "58÷62 HRC"]]],
    ["58/60 HRC", [["hardness", "58/60 HRC"]]],
    ["HRC ≥ 58", [["hardness", "≥ 58 HRC"]]],
    ["Rz 6,3 / Ra 0,8", [["roughness", "Rz 6,3 / Ra 0,8"]]],
    ["Ra 0,8 max", [["roughness", "Ra 0,8 max"]]],
    ["ISO 2768-mK / ISO 8015", [["tolerance", "ISO 2768-mK / ISO 8015"]]],
  ])("„%s“ → celé hodnoty %j, nic se neztratí", (t, want) => {
    const c = classifyNote(t)!;
    expect(c.mixed).toBe(false);
    expect(c.parts.map((p) => [p.key, p.value])).toEqual(want);
    expect(lostTokens(t, c.parts.map((p) => p.value))).toEqual([]);
  });
  it("„58 HRC ±2“ nikdy jako obecná tolerance (±2 je rozsah tvrdosti 56–60 HRC)", () => {
    expect(classifyNote("58 HRC ±2")!.parts.some((p) => p.key === "tolerance")).toBe(false);
    expect(classifyNote("Zn 8 µm ±2")!.mixed).toBe(true); // ± u tloušťky povlaku – nepřesune se
  });
  it.each(["Ra 3,2 brousit", "1.2379 / 1.2842 kalit", "ISO 2768-mK ±0,1", "Zn 8 µm ±2"])("„%s“ – parser by část ztratil → nepřesouvá se (mixed)", (t) => {
    expect(classifyNote(t)!.mixed).toBe(true);
  });
  it("kontrola tam a zpět: ztracené / rozdělené části se poznají", () => {
    expect(lostTokens("Kalit 58÷62 HRC", ["62 HRC", "Kalit 58÷"])).toContain("58-62");
    expect(lostTokens("Rz 6,3 / Ra 0,8", ["Rz 6,3"])).toContain("0,8");
    expect(lostTokens("ISO 2768-mK / ISO 8015", ["ISO 2768-mK"])).toContain("8015");
    expect(lostTokens("Ra 0,8 max", ["Ra 0,8"])).toContain("max");
    expect(lostTokens("Tvrdost 58 HRC", ["58 HRC"])).toEqual([]);
  });
  it("jádro: každý text korpusu rozsahů se přesune celý (vše v buňkách razítka), nebo se odmítne ✗ a list zůstane beze změny", async () => {
    const moved: string[] = [];
    const refused: string[] = [];
    for (const t of RANGES) {
      const ws = new MemoryWorkspace();
      await run(ws, PART());
      const before = JSON.stringify(docOf(ws, "Deska").drawings);
      const r = await run(ws, [`výkres značka text "${t}" v 30 120`, "výkres stav"]);
      const d = docOf(ws, "Deska");
      if (errs(r).includes("drawing.note-title-data")) {
        refused.push(t);
        expect(JSON.stringify(d.drawings), t).toBe(before);
        expect(txt(r), t).toMatch(/výkres razítko \S+=/);
      } else {
        moved.push(t);
        expect(errs(r), t).toEqual([]);
        expect(lostTokens(t, cells(d)), t).toEqual([]);
        expect(d.drawings![0].annotations.some((a) => a.type === "text"), t).toBe(false);
      }
    }
    // bezeztrátově rozpoznané rozsahy se přesunou, ty se ztrátou ne
    expect(moved).toEqual(expect.arrayContaining(["58 HRC ±2", "Kalit 58÷62 HRC", "HRC 58÷62", "58/60 HRC", "Rz 6,3 / Ra 0,8", "ISO 2768-mK / ISO 8015", "Ra 0,8 max"]));
    expect(refused).toEqual(expect.arrayContaining(["Ra 3,2 brousit", "Zn 8 µm ±2", "ISO 2768-mK ±0,1"]));
  }, 600000);
  it("58 HRC ±2 v razítku: tvrdost „58 HRC ±2“, obecná tolerance zůstane ISO 2768-mK (ne ±2 pro celý díl)", async () => {
    const ws = new MemoryWorkspace();
    await run(ws, [...PART(), "výkres nepředepsané ISO 2768-mK", 'výkres značka text "58 HRC ±2" v 30 120']);
    const m = docOf(ws, "Deska").drawings![0].meta as Record<string, unknown>;
    expect(m.hardness).toBe("58 HRC ±2");
    expect(m.tolerance).toBe("ISO 2768-mK");
  }, 120000);
});

/** skutečné názvy dílů nástrojárny cs / en / de – žádný není pokyn ani údaj razítka */
const PART_NAMES = [
  "Temperierplatte", "Corner bracket", "Edge clamp", "Kantenschutz", "Hartmetall-Einsatz", "Surface plate", "Povrchová deska", "Chromová tyč", "Kalená vložka", "Brusná deska",
  "Střižník", "Razník 12", "Matrice", "Stírač", "Přidržovač", "Vodicí sloupek", "Vodicí pouzdro", "Kotevní deska", "Základová deska", "Upínací deska",
  "Kalibr", "Měřicí trn", "Kontrolní přípravek", "Vrtací přípravek", "Lešticí kotouč", "Tryska", "Vyhazovač", "Tvárník", "Opěrka", "Doraz",
  "Drill bushing", "Chamfer tool", "Protective cover", "Punch holder", "Die plate", "Stripper plate", "Guide pillar", "Ejector pin", "Hardened insert", "Chrome rod",
  "Gehärtete Führungsleiste", "Nitrierte Welle", "Schneidplatte", "Stempelhalteplatte", "Führungssäule", "Auswerferstift", "Spannpratze", "Eckenschutz", "Härteprüfplatte", "Matrizenplatte",
];
/** pokyny / věty jako název – ✗ */
const INSTRUCTIONS = [
  "Kalit", "Kalit a popustit", "Srazit hrany", "Leštit čela", "Honovat díry", "Lapovat F3", "Brousit na čisto", "Odmastit a konzervovat", "Zabalit do VCI fólie", "Expedovat paletou",
  "Härten", "Kanten brechen", "Entgraten", "Harden all over", "Deburr all edges", "Kalení 58", "Nitridace 0,3", "Kalení a popouštění", "Deska 58 HRC", "Vložka ISO 2768-mK",
];

describe("S2 – název = jmenná fráze (correct-F6)", () => {
  it(`${PART_NAMES.length} skutečných názvů dílů projde`, () => {
    expect(PART_NAMES.length).toBeGreaterThanOrEqual(40);
    const bad = PART_NAMES.filter((n) => docNameIssue(n));
    expect(bad).toEqual([]);
  });
  it(`${INSTRUCTIONS.length} pokynů / údajů jako název = ✗`, () => {
    expect(INSTRUCTIONS.length).toBeGreaterThanOrEqual(15);
    const ok = INSTRUCTIONS.filter((n) => !docNameIssue(n));
    expect(ok).toEqual([]);
  });
  it("instructionWord: sloveso / děj s hodnotou ano, jmenná fráze ne", () => {
    expect(instructionWord("Kalená vložka")).toBeNull();
    expect(instructionWord("Kalit")).toBe("kalit");
    expect(instructionWord("Chamfer tool")).toBeNull();
    expect(instructionWord("Chamfer edges")).toBe("chamfer");
  });
  it.each(["Temperierplatte", "Povrchová deska", "Kantenschutz", "Kalená vložka"])("jádro: díl „%s“ s výkresem – žádné ✗, PDF se zapíše", async (n) => {
    const ws = new MemoryWorkspace();
    const r = await run(ws, [...PART(n), "výkres nepředepsané ISO 2768-mK", "výkres stav", "výkres export pdf"]);
    expect(errs(r)).toEqual([]);
    expect(out(".pdf").length).toBe(1);
  }, 120000);
  it("pokyn jako název: ✗ jen jednou u `nový díl`, příkazy výkresu se neopakují (dřív ✗ L3,L4,L5,L6 ×4); export odmítnut", async () => {
    const ws = new MemoryWorkspace();
    const r = await run(ws, [...PART("Kalit a popustit"), "výkres nepředepsané ISO 2768-mK", "výkres stav", "výkres export pdf"]);
    expect(r.entries.filter((e) => e.level === "error" && e.line === 1).map((e) => e.code)).toEqual(["drawing.note-style"]);
    // žádný příkaz výkresu (A3, kótovat, razítko, nepředepsané – řádky 4–7) neselhal kvůli názvu; vyhodnocení listu ho ohlásí
    // jednou (✗ místo ✓, řádek 8) a export se odmítne (řádek 9)
    expect(r.entries.filter((e) => e.level === "error" && e.line !== null && e.line >= 4 && e.line <= 7).map((e) => `${e.line} ${e.code}`)).toEqual([]);
    expect(r.entries.filter((e) => e.level === "error" && /název dílu „Kalit a popustit“/.test(e.text)).map((e) => e.line)).toEqual([1, 8, 9]);
    expect(out(".pdf").length).toBe(0);
    expect(txt(r)).not.toMatch(OK_RE);
  }, 120000);
});

describe("S3 – nález celého dokumentu bez „list …:“, ⚠ načteného souboru jednou (correct-F7)", () => {
  it("materiál s tvrdostí: „materiál: přesunuto do razítka – …“, ne „list materiál:“", async () => {
    const ws = new MemoryWorkspace();
    const r = await run(ws, [...PART(), 'materiál "1.2379 kalit, černit"']);
    expect(txt(r)).toMatch(/materiál: přesunuto do razítka/);
    expect(txt(r)).not.toMatch(/list materiál:/);
  }, 120000);
  it("název dílu s pokynem: „název dílu: …“, ne „list název dílu:“", async () => {
    const r = await run(new MemoryWorkspace(), ['nový díl "Odmastit a konzervovat"']);
    expect(txt(r)).toMatch(/název dílu: /);
    expect(txt(r)).not.toMatch(/list název dílu:/);
  }, 120000);
  it("popis v modelu s pokynem: „model: …“, ne „list model:“", async () => {
    const r = await run(new MemoryWorkspace(), ['nový díl "Deska"', "kvádr 100 60 12", 'poznámka F2 "Odmastit"']);
    expect(txt(r)).toMatch(/model: text není strojařsky heslovitý/);
    expect(txt(r)).not.toMatch(/list model:/);
  }, 120000);
  it("soubor z disku přes limit: ⚠ drawing.notes-loaded jednou a u listu, ne „list model:“", async () => {
    const ws = new MemoryWorkspace();
    await run(ws, PART());
    const d = docOf(ws, "Deska");
    const s = d.drawings![0];
    const notes = Array.from({ length: 7 }, (_, i) => ({ id: `n${i}`, view: "sheet", type: "text", at: [30, 120 - 5 * i], text: `Bod${i}`, size: 3.5 }));
    const legacy = { ...d, drawings: [{ ...s, annotations: [...s.annotations.map((a) => ({ ...a, by: undefined })), ...notes] }] };
    inputs = { "a.mncad": new TextEncoder().encode(JSON.stringify(legacy)) };
    const r = await run(new MemoryWorkspace(), ['otevřít "a.mncad"', "výkres export pdf"]);
    const loaded = r.entries.filter((e) => e.code === "drawing.notes-loaded");
    expect(loaded.length).toBe(1);
    expect(loaded[0].text).not.toMatch(/^list model:/);
  }, 120000);
});

describe("B1 – revize s údajem razítka jako změna (bypass-F1)", () => {
  it.each(["doplněno kalit a popustit", "doplněno černit", "doplněno hrany otupit", "změna: cementovat"])("revize „%s“ bez údaje v razítku = ✗, žádné ✓", async (rev) => {
    const ws = new MemoryWorkspace();
    const r = await run(ws, [...PART(), "výkres nepředepsané ISO 2768-mK", `výkres revize A "${rev}"`, "výkres stav"]);
    expect(errs(r)).toContain("drawing.note-title-data");
    expect(txt(r)).not.toMatch(OK_RE);
  }, 120000);
  it("s údajem v razítku revize změnu popsat smí", async () => {
    const ws = new MemoryWorkspace();
    const r = await run(ws, [...PART(), "výkres nepředepsané ISO 2768-mK", 'výkres razítko tepelné="kalit a popustit" tvrdost="58-60 HRC"', 'výkres revize A "doplněno kalit a popustit"', "výkres stav"]);
    expect(errs(r)).toEqual([]);
  }, 120000);
});

describe("B2 – údaje generátoru a příznak auto z JSON, popisky pohledů (bypass-F2, F3, F4)", () => {
  const INSTR = ["Odmastit a konzervovat olejem", "Zabalit do VCI fólie", "Označit rytinou", "Expedovat na paletě", "Měrný protokol 3.1", "Kalit a popustit na 58-60 HRC", "Černit, hrany otupit 0,5", "Skladovat v suchu"];
  it("stampAgentNotes zahodí meta.formNotes / pmi / bom / welds / components; sheetMeta je z uložených údajů nebere", () => {
    const doc = { name: "D", features: [], drawings: [{ id: "s", name: "List 1", options: {}, annotations: [], meta: { name: "", formNotes: INSTR, pmi: [{ id: "p", kind: "note", face: 0, text: "Odmastit" }], bom: [{ pos: 1, name: "Zabalit", qty: 1 }], welds: [], components: [], number: "MN-1" } }] } as unknown as CadDoc;
    const s = stampAgentNotes(doc, "agent").drawings![0];
    for (const k of ["formNotes", "pmi", "bom", "welds", "components"]) expect(k in (s.meta as object)).toBe(false);
    expect((s.meta as { number: string }).number).toBe("MN-1");
    const m = sheetMeta(doc, doc.drawings![0]);
    expect(m.formNotes).toBeUndefined();
    expect(m.bom).toBeUndefined();
  });
  it("j3/j5: JSON s meta.formNotes a meta.bom – pokyny se na list nedostanou (PDF ani stav)", async () => {
    const ws = new MemoryWorkspace();
    await run(ws, [...PART(), "výkres nepředepsané ISO 2768-mK"]);
    const d = docOf(ws, "Deska");
    const s = d.drawings![0];
    const bad = { ...d, drawings: [{ ...s, meta: { ...s.meta, formNotes: INSTR, bom: INSTR.map((t, i) => ({ pos: i + 1, name: t, qty: 1, note: "pokud není uvedeno jinak kontaktujte konstruktéra" })) } }] };
    const ws2 = new MemoryWorkspace();
    await run(ws2, [JSON.stringify(bad), "výkres stav"]);
    const m = docOf(ws2, "Deska").drawings![0].meta as Record<string, unknown>;
    expect(m.formNotes).toBeUndefined();
    expect(m.bom).toBeUndefined();
  }, 120000);
  it("j1b: popisy s podvrženým „auto“ a pokyny = ✗ (limit řádků / místních popisů), žádné PDF", async () => {
    const ws = new MemoryWorkspace();
    await run(ws, [...PART(), "výkres nepředepsané ISO 2768-mK"]);
    const d = docOf(ws, "Deska");
    const s = d.drawings![0];
    const fake = INSTR.map((t, i) => ({ id: `f${i}`, view: "top", type: "callout", auto: `hole:fake${i}`, tip: [10 + i * 5, 10], at: [20 + i * 5, 30], lines: [t] }));
    const bad = { ...d, drawings: [{ ...s, annotations: [...s.annotations, ...fake] }] };
    const r = await run(new MemoryWorkspace(), [JSON.stringify(bad), "výkres export pdf"]);
    expect(errs(r).some((c) => c === "drawing.notes-limit" || c === "drawing.leaders-limit")).toBe(true);
    expect(out(".pdf").length).toBe(0);
  }, 120000);
  it("j2: popisek detailu s pokyny = ✗; „B“ / „Detail C“ projde", async () => {
    const ws = new MemoryWorkspace();
    await run(ws, [...PART(), "výkres nepředepsané ISO 2768-mK"]);
    const d = docOf(ws, "Deska");
    const s = d.drawings![0];
    const det = (label: string) => ({ ...d, drawings: [{ ...s, options: { ...s.options, details: [{ id: "d1", label, view: "front", cx: 10, cy: 5, r: 8, scale: 2 }] } }] });
    const r = await run(new MemoryWorkspace(), [JSON.stringify(det("KALIT A POPUSTIT 58-60 HRC ČERNIT")), "výkres export pdf"]);
    expect(errs(r)).toContain("drawing.note-style");
    expect(out(".pdf").length).toBe(0);
    const ok = await run(new MemoryWorkspace(), [JSON.stringify(det("B")), "výkres stav"]);
    expect(ok.entries.filter((e) => e.level === "error" && /popisek pohledu/.test(e.text))).toEqual([]);
  }, 120000);
  it("t4: `výkres model` s pokynem jako názvem pohledu = ✗ na tom řádku", async () => {
    const ws = new MemoryWorkspace();
    const r = await run(ws, ['nový díl "Odmastit konzervovat"', "kvádr 20 20 20", ...PART(), "výkres nepředepsané ISO 2768-mK", 'výkres model "Odmastit konzervovat" pohled přední', "výkres stav"]);
    expect(r.entries.some((e) => e.level === "error" && e.line === 10 && /název pohledu modelu/.test(e.text))).toBe(true);
  }, 120000);
});

describe("B3 – nosič textu bez ohledu na prvky (bypass-F5, correct-F1)", () => {
  const TXT = ["Svary zabrousit", "Kontrola rovinnosti 100 %", "Skladovat v suchu", "Expedovat paletou", "Balit jednotlivě"].map((t, i) => `výkres značka text "${t}" v 30 ${120 - 5 * i}`);
  it("t3 / md4: kostička 6 mm i 2 mm s dírou a 5 texty = ✗ drawing.notes-sheet; bez kót (kótovat nic) se nezapíše ani jeden", async () => {
    for (const [k, dims] of [["6 6 6", "kótovat chytře"], ["2 2 2", "kótovat chytře"], ["2 2 2", "kótovat nic"]]) {
      const ws = new MemoryWorkspace();
      const r = await run(ws, ['nový díl "Štítek"', `kvádr ${k}`, "díra 1 skrz v 1 1", "výkres A4 měřítko 1:1 pohledy přední,horní", dims, 'výkres razítko číslo="MN-1-B" kreslil="AI"', ...TXT, "výkres export pdf"]);
      expect(errs(r)).toContain("drawing.notes-sheet");
      const n = docOf(ws, "Štítek").drawings![0].annotations.filter((a) => a.type === "text").length;
      expect(n).toBeLessThanOrEqual(dims === "kótovat nic" ? 0 : 2);
    }
  }, 240000);
  it("t2: druhý dokument téhož dílu „MN-1-B“ s dalšími poznámkami = ✗; samotný díl MN-1 s poznámkami projde", async () => {
    const ws = new MemoryWorkspace();
    const r1 = await run(ws, [...PART("Deska"), "výkres nepředepsané ISO 2768-mK", ...TXT, "výkres stav"]);
    expect(errs(r1)).toEqual([]);
    const r = await run(ws, [...PART("Deska B").map((l) => l.replace('"MN-1"', '"MN-1-B"')), "výkres nepředepsané ISO 2768-mK", ...TXT, "výkres export pdf"]);
    expect(r.entries.some((e) => e.code === "drawing.notes-sheet" && /druhý výkres dílu/.test(e.text))).toBe(true);
    // poznámky se do druhého výkresu nezapsaly (příkazy odmítnuty) – zapsat se smí jen výkres bez nich
    expect(docOf(ws, "Deska B").drawings![0].annotations.some((a) => a.type === "text")).toBe(false);
  }, 240000);
  it("skutečný malý díl s kótami a 1 poznámkou nosičem není", async () => {
    const r = await run(new MemoryWorkspace(), ['nový díl "Kolík"', "válec 3 8", "výkres A4 měřítko 2:1 pohledy přední,horní", "kótovat chytře", "výkres nepředepsané ISO 2768-mK", 'výkres značka text "Lapovat" v 30 120', "výkres stav"]);
    expect(errs(r)).toEqual([]);
  }, 120000);
});

describe("B4 – kusovník sestavy a volné buňky razítka (bypass-F6, correct-F2, correct-F3)", () => {
  it.each([
    ["vendor", "Odmastit a konzervovat olejem"],
    ["grade", "Kalit a popustit 58-60 HRC"],
    ["alias", "Zabalit do VCI fólie"],
    ["vendor", "Označit rytinou číslo dílu"],
    ["alias", "Měrný protokol 3.1 přiložit"],
    ["material", "Kalit a popustit 58 HRC"],
    ["catalog", "Konzervovat olejem"],
    ["size", "Odmastit"],
    ["name", "Zabalit do VCI fólie"],
  ] as const)("kusovník %s „%s“ = ✗", (f, v) => {
    expect(bomCellIssue(f, v)).not.toBeNull();
  });
  it.each([
    ["vendor", "Misumi"],
    ["vendor", "Meusburger"],
    ["catalog", "E 1000/10x100"],
    ["grade", "8.8"],
    ["grade", "A2-70"],
    ["material", "1.2379"],
    ["size", "M8x20"],
    ["name", "Vodicí sloupek"],
    ["alias", "K48"],
  ] as const)("kusovník %s „%s“ projde", (f, v) => {
    expect(bomCellIssue(f, v)).toBeNull();
  });
  it("t1 / as2: `sestava komponenta … výrobce \"Odmastit…\"` = ✗ (sestava beze změny), kusovník bez pokynů", async () => {
    const ws = new MemoryWorkspace();
    const r = await run(ws, ['nový díl "Deska"', "kvádr 100 60 12", 'nový díl "Čep"', "válec 4 30", 'nová sestava "Sestava"', 'vložit "Deska" ukotvit', 'vložit "Čep" v 50 30 0', 'sestava komponenta "Čep" druh nakupovaný katalog "Konzervovat olejem" výrobce "Expedovat paletou"', 'sestava komponenta "Deska" materiál "Kalit a popustit 58 HRC"', 'sestava komponenta "Čep" výrobce "Misumi"']);
    expect(r.entries.filter((e) => e.level === "error" && (e.line === 8 || e.line === 9)).length).toBe(2);
    expect(r.entries.some((e) => e.level === "error" && e.line === 10)).toBe(false);
    const c = docOf(ws, "Sestava").components!;
    expect(JSON.stringify(c)).not.toMatch(/Konzervovat|Expedovat|Kalit/);
  }, 120000);
  it.each([
    ["checkedBy", "Leštit čela", false],
    ["approvedBy", "Honovat díry", false],
    ["project", "Lapovat F3", false],
    ["customer", "Brousit na čisto", false],
    ["quantity", "Superfiniš", false],
    ["quantity", "4 ks", true],
    ["quantity", "2 + 1", true],
    ["customer", "Galvanovna Brno s.r.o.", true],
    ["checkedBy", "Ing. Novák", true],
    ["project", "100 NASTROJ-A", true],
    ["date", "27. 11. 2026", true],
  ] as const)("buňka %s „%s“ v pořádku = %s", async (k, v, ok) => {
    const { auditDoc } = await import("../drawing-notes-rules");
    const doc = { name: "Deska", drawings: [{ id: "s", name: "List 1", options: {}, annotations: [], meta: { name: "", [k]: v, by: { [k]: "agent" } } }] } as unknown as CadDoc;
    const f = auditDoc(doc).filter((x) => x.key === `meta:${k}`);
    expect(f.length === 0).toBe(ok);
    if (k === "quantity") expect(cellKindIssue(k, v) === null).toBe(ok);
  });
  it("g1: kontroloval / schválil / projekt / zákazník / počet a název listu s pokyny = ✗, žádné ✓", async () => {
    const ws = new MemoryWorkspace();
    const r = await run(ws, [...PART(), "výkres nepředepsané ISO 2768-mK", 'výkres razítko kontroloval="Leštit čela"', 'výkres razítko počet="Superfiniš"', 'výkres list přejmenovat 1 "Leštit všude"', "výkres stav"]);
    expect(r.entries.filter((e) => e.level === "error").length).toBeGreaterThanOrEqual(3);
    expect(txt(r)).not.toMatch(OK_RE);
  }, 120000);
});

describe("B5 – slovník (correct-F5)", () => {
  it.each([
    ["HRC ≥ 58", "hardness"], ["St37", "material"], ["St 52-3", "material"], ["Al 6061-T6", "material"], ["7075 T651", "material"], ["Dural", "material"],
    ["K340", "material"], ["M390", "material"], ["Plazmanitridace", "heatTreatment"], ["Gasnitrieren", "heatTreatment"], ["Vakuumgehärtet", "heatTreatment"],
    ["Durchgehärtet", "heatTreatment"], ["Induktionsgehärtet", "heatTreatment"], ["Tenifer QPQ", "heatTreatment"], ["Pasivace", "surfaceTreatment"],
    ["Passivieren", "surfaceTreatment"], ["Manganfosfát", "surfaceTreatment"], ["Geomet 500", "surfaceTreatment"], ["Dacromet", "surfaceTreatment"],
    ["Smaltovat", "surfaceTreatment"], ["Stabilizovat", "heatTreatment"], ["Kryogenně zpracovat", "heatTreatment"], ["Ohne Grat", "edges"],
    ["Scharfkantig", "edges"], ["ISO 8015", "tolerance"], ["Tvrdokov K20", "material"], ["HSS", "material"], ["Rockwell 58", "hardness"],
    ["Hartcoatiert", "surfaceTreatment"],
  ])("„%s“ = údaj razítka %s (ne volná poznámka)", (t, key) => {
    const c = classifyNote(t);
    expect(c?.parts.map((p) => p.key)).toContain(key);
  });
  it("„Rockwell 58“ bez jednotky = neúplné (nepřesune se – ✗ s radou)", () => {
    expect(classifyNote("Rockwell 58")!.mixed).toBe(true);
  });
  it("názvy dílů po rozšíření slovníku dál projdou", () => {
    expect(PART_NAMES.filter((n) => docNameIssue(n))).toEqual([]);
  });
});
