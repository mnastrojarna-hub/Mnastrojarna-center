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
import { classifyNote, docNameIssue, instructionWord, lostTokens } from "../drawing-notes-rules";
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
