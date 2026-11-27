/**
 * Balík B4 (strict-silent, CAD-HEADLESS-NAVRH.md kap. 5): jeden test na řádek soupisu 5.2 (vstup → kód, úroveň, řádek),
 * přísný režim (volba, řádek `přísně`, STOP před během / za běhu, výjimky, výkres po bloku), ověření všech dokumentů běhu
 * stavbou („UNVERIFIED ✓“ zkoušky 959) a třídy kolizí v `kolize` i `pohyb … kolize` (nález 2 fáze A).
 *
 * Skutečné jádro in-process (jako parity.test.ts) tam, kde rozhoduje geometrie; jinak falešné jádro nebo jen rozbor.
 */
import fs from "node:fs";
import path from "node:path";
import { beforeAll, describe, expect, it } from "vitest";
import { parseAgentText } from "../agent";
import { materialClass, parseStrictLine } from "../agent-strict";
import { partFaces, type AsmEnv } from "../asm-agent";
import { motionClashLines } from "../asm-agent-kin";
import { classifyClash, classifyClashes, screwOf } from "../clash-thread";
import { setLang, tr } from "../i18n";
import { setHostAssets } from "../host-assets";
import { makeKernelClient, type KernelClient } from "../kernel-client";
import type { MotionResult } from "../motion";
import { emptyDoc, uid, type AsmComponent, type BuildResult, type CadDoc, type ComponentSource, type Feature } from "../types";
import { CodedError } from "./codes";
import { memoryFileSink, memoryFileSource, type EngineHost } from "./host";
import type { KernelApi } from "./kernel";
import { lintParams } from "./lint";
import { MemoryWorkspace } from "./memory-workspace";
import { formatConsole, formatShort } from "./protocol";
import type { Entry, RunReport } from "./protocol-types";
import { runScript } from "./run";
import { sheetWarningCode } from "./sheet-eval";
import { StrictState, excepted, type StrictOpt } from "./strict";

const WASM = path.resolve(__dirname, "../../../node_modules/replicad-opencascadejs/dist/replicad_single.wasm");
const FONTS = path.resolve(__dirname, "../../../public/fonts");

/* ───────────── pomocné ───────────── */
const result = (d: CadDoc, over: Partial<BuildResult["metrics"]> = {}): BuildResult =>
  ({ status: d.features.map((f) => ({ id: f.id, ok: true })), mesh: null, metrics: d.features.length ? { volume: 1000, area: 600, bbox: [[0, 0, 0], [10, 10, 10]], faces: 6, edges: 12, valid: true, solids: 1, ...over } : null, ms: 1 }) as unknown as BuildResult;
function fakeKernel(over: Partial<Record<string, unknown>> = {}, metrics: Partial<BuildResult["metrics"]> = {}) {
  const k = {
    generation: () => 1,
    build: async (d: CadDoc) => result(d, metrics),
    check: async (d: CadDoc) => ({ status: d.features.map((f) => ({ id: f.id, ok: true })), paramErrors: [], solid: true }),
    asmParts: async (parts: { key: string; source: ComponentSource }[]) => parts.map((p) => ({ key: p.key, result: result(p.source.kind === "part" ? p.source.doc : emptyDoc(), metrics) })),
    interference: async () => Object.assign([], { stats: { pairs: 0, culled: 0, exact: 0, reused: 0, undetermined: 0 } }),
    // zařazení šroub × závit bez OCCT: odhad z prvků (clash-thread.ts) místo geometrie jádra (clash-detail.ts)
    clashDetail: async (d: CadDoc, pairs: { a: string; b: string; volume: number }[]) => classifyClashes(d, pairs).list.map((x) => ({ ...x, why: x.cls === "real" ? "outside-band" : x.cls === "undetermined" ? "no-geometry" : x.cls })),
    stepSplit: async () => null,
    ...over,
  };
  return k as unknown as KernelApi;
}
const hostOf = (kernel: KernelApi): EngineHost => ({ kernel, files: memoryFileSink(), inputs: memoryFileSource({}), now: () => Date.now() });
/** záznamy s kódem jako „L<n> <úroveň> <kód>“ */
const coded = (r: RunReport) => r.entries.filter((e) => e.code && e.level !== "ok" && e.level !== "measure" && e.code !== "msg.note" && e.code !== "op.accepted").map((e) => `L${e.line ?? "-"} ${e.level} ${e.code}`);
const find = (r: RunReport, code: string): Entry | undefined => r.entries.find((e) => e.code === code);
const has = (r: RunReport, line: number | null, level: string, code: string) => expect(coded(r), JSON.stringify(coded(r))).toContain(`L${line ?? "-"} ${level} ${code}`);

let real: KernelClient;
beforeAll(async () => {
  setLang("cs");
  setHostAssets({ font: async (name) => new Uint8Array(fs.readFileSync(path.join(FONTS, name))).buffer });
  const { inProcessTransport } = await import("../kernel-inprocess");
  real = makeKernelClient(inProcessTransport({ locateFile: (file) => (file.endsWith(".wasm") ? WASM : file) }));
  await real.init();
}, 120_000);
const runReal = (text: string, o: Parameters<typeof runScript>[3] = {}, ws = new MemoryWorkspace()) => runScript(ws, text, hostOf(real as unknown as KernelApi), o);
const runFake = (text: string, kernel = fakeKernel(), o: Parameters<typeof runScript>[3] = {}, ws = new MemoryWorkspace()) => runScript(ws, text, hostOf(kernel), o);

/* ───────────── soupis 5.2 ───────────── */
describe("soupis 5.2 – rozbor (č. 1–11)", () => {
  it("1 parse.unused ⚠: nepřečtené slovo / číslo příkazu", async () => {
    const r = await runFake("nový díl A\nkvádr 10 10 10\nzaoblit 2 nesmysl\nskořepina 1 2");
    has(r, 3, "warn", "parse.unused");
    has(r, 4, "warn", "parse.unused");
    expect(find(r, "parse.unused")!.text).toMatch(/nesmysl/);
    // platné zápisy bez nálezu (vše přečtené, „lineární“ je výchozí druh pole, „k tělesu“ = volba díry)
    const ok = parseAgentText("zaoblit 2 hrany svislé\npole lineární 3 rozteč 20 směr X\ndíra 5 k tělesu v 1 1 1\nrotovat 90 osa x\nzrcadlit XY\ntext \"AB\" výška 5 hloubka 1 v 1 1 1");
    expect(ok.errors).toEqual([]);
    expect(ok.warnings ?? []).toEqual([]);
  });
  it("1b parse.unused: díra s více polohami (`v x y v x y`, vlna 15) a zahloubení se závitem čtou všechna čísla", () => {
    const p = parseAgentText("díra 6,8 skrz v 20 20 v 80 40\ndíra 6,8 skrz v 50 30 zahloubení 20 7 závit M8\ndíra 5 skrz v 1 2 v 3 4 5");
    expect(p.errors).toEqual([]);
    expect(p.warnings ?? []).toEqual([]);
    // číslo navíc za polohami se dál hlásí
    expect(parseAgentText("díra 5 skrz v 1 2 v 3 4 nesmysl").warnings?.map((w) => w.code)).toEqual(["parse.unused"]);
  });
  it("2 parse.coord-missing ⚠: poloha s chybějící souřadnicí (vložit, normálie); díra jedním číslem = ✗ (vlna 15)", async () => {
    const p = parseAgentText('vložit "A" v 10 20\nnormálie M8x30 v 5');
    expect(p.warnings?.map((w) => `${w.line} ${w.code}`)).toEqual(["1 parse.coord-missing", "2 parse.coord-missing"]);
    // díra s jedním číslem polohy: od vlny 15 ✗ řádku (agent-hole.ts holePositions – nikdy tichá díra jinde), dřív ⚠ s y = 0
    const r = await runFake("nový díl A\nkvádr 10 10 10\ndíra 5 skrz v 10 0 10\ndíra 5 skrz v 10");
    has(r, 4, "error", "parse.error");
    expect(coded(r).filter((c) => c.startsWith("L3"))).toEqual([]);
  });
  it("3 parse.axis ✗: neznámá osa díry / pole; 4 parse.axis ✗: neznámá osa rotace", async () => {
    const p = parseAgentText("díra 5 skrz v 1 1 1 osa Q\nrotovat 90 osa 5\npole kruhové 6 osa Z");
    expect(p.errors.map((e) => `${e.line} ${e.code}`)).toEqual(["1 parse.axis", "2 parse.axis"]);
    const r = await runFake("nový díl A\nkvádr 10 10 10\ndíra 5 skrz v 1 1 1 osa Q");
    has(r, 3, "error", "parse.axis");
  });
  it("5 hole.depth-default ⚠, 6 parse.conflict ⚠ (hloubka + skrz), 7 zahloubení + kuželové = ✗ řádek se neprovede (vlna 15, dřív ⚠ hole.conflict)", async () => {
    const r = await runFake("nový díl A\nkvádr 40 40 10\ndíra 5 v 10 10 10\ndíra 5 hloubka 6 skrz v 20 20 10\ndíra 5 skrz v 30 30 10 zahloubení 10 3 kuželové 10\ndíra 5 skrz v 5 35 10");
    has(r, 3, "warn", "hole.depth-default");
    has(r, 4, "warn", "parse.conflict");
    has(r, 5, "error", "parse.error");
    expect(find(r, "parse.error")!.text).toMatch(/zahloubení.*kuželové.*najednou nejde/);
    expect(coded(r).filter((c) => c.startsWith("L6 "))).toEqual([]);
  });
  it("8 zahloubení u závitové díry se postaví (rozhodnutí 15.3, vlna 15: zahloubení + vrták + závit) – žádné hole.cbore-dropped", async () => {
    const r = await runFake("nový díl A\nkvádr 40 40 20\ndíra skrz v 10 10 20 zahloubení 20 7 závit M8");
    expect(coded(r).filter((c) => c.includes("hole.cbore-dropped"))).toEqual([]);
    const f = (parseAgentText("díra skrz v 10 10 20 zahloubení 20 7 závit M8").ops[0] as Extract<ReturnType<typeof parseAgentText>["ops"][number], { k: "feature" }>).feature;
    expect(f).toMatchObject({ type: "hole", kind: "tapped", head: "counterbore", cbDiameter: 20, cbDepth: 7, thread: "M8" });
  });
  it("9 parse.conflict ⚠: vysunout H skrz; 10 parse.conflict ⚠: víc režimů najednou", async () => {
    const r = await runFake("nový díl A\nkvádr 40 40 10\nskica XY: kružnice 5 v 20 20\nvysunout 10 skrz odebrat\nskica XY: kružnice 3 v 5 5\nvysunout 5 odebrat průnik");
    has(r, 4, "warn", "parse.conflict");
    has(r, 6, "warn", "parse.conflict");
    expect(find(r, "parse.conflict")!.text).toMatch(/skrz/);
  });
  it("11 vložit … jako „X“ = přezdívka instance (vlna 15, B15) – už žádné insert.name-ignored", () => {
    const p = parseAgentText('vložit "Čep" jako "Čep 2" v 0 0 0');
    expect(p.warnings ?? []).toEqual([]);
    expect(p.ops[0]).toMatchObject({ k: "insert", tab: "Čep", alias: "Čep 2" });
  });
});

describe("soupis 5.2 – provedení (č. 12–23)", () => {
  it("12 select.fallback ⚠: strana bez rovinné plochy na obálce → nejkrajnější plocha", async () => {
    const r = await runReal("nový díl A\nkvádr 20 20 10\nkoule 10 v 10 10 10\nskořepina 1 otevřít +Z");
    has(r, 4, "warn", "select.fallback");
  }, 120_000);
  it("14 tab.empty-replaced (B1): nová sestava + nový díl → obě záložky; B2: 27× nový díl → 27 záložek", async () => {
    const ws = new MemoryWorkspace();
    await runFake("nová sestava S\nnový díl A\nkvádr 1 1 1", fakeKernel(), {}, ws);
    expect(ws.tabs().map((t) => t.title)).toEqual(["S", "A"]);
    const ws2 = new MemoryWorkspace();
    const r = await runFake(Array.from({ length: 27 }, (_, i) => `nový díl D${i + 1}\nkvádr 1 1 ${i + 1}`).join("\n"), fakeKernel(), {}, ws2);
    expect(ws2.tabs().length).toBe(27);
    expect(r.counts.errors).toBe(0);
  });
  it("15 name.renamed ⚠ (výslovný název) a name.renamed-auto ℹ (výchozí); 16 mode.new-body ℹ; 17 json.id-renewed ℹ", async () => {
    const ws = new MemoryWorkspace();
    await runFake('nový díl A\nkvádr 1 1 1 název "Deska 1"', fakeKernel(), {}, ws);
    const r = await runFake('kvádr 2 2 2 název "Deska 1"\nkvádr 3 3 3', fakeKernel(), {}, ws);
    has(r, 1, "warn", "name.renamed");
    const r2 = await runFake("nový díl B\nkvádr 1 1 1 přidat\nnový díl\nnový díl");
    has(r2, 2, "note", "mode.new-body");
    has(r2, 4, "note", "name.renamed-auto");
    const doc = { ...emptyDoc("J"), features: [{ id: "x1", name: "Kvádr 1", type: "box", size: [1, 1, 1], position: [0, 0, 0], centered: false, mode: "new" }, { id: "x1", name: "Kvádr 2", type: "box", size: [2, 2, 2], position: [5, 0, 0], centered: false, mode: "add" }] };
    const r3 = await runFake(JSON.stringify(doc));
    expect(coded(r3)).toContain("L1 note json.id-renewed");
  });
  it("18 hole.no-surface ⚠: díra bez z mimo povrch tělesa", async () => {
    const r = await runReal("nový díl A\nkvádr 20 20 10\ndíra 5 skrz v 200 200");
    has(r, 3, "warn", "hole.no-surface");
  }, 120_000);
  it("19 asm.stale-copy ⚠: díl změněný po vložení do sestavy", async () => {
    const r = await runFake('nový díl A\nkvádr 1 1 1\nnová sestava S\nvložit "A"\nzáložka "A"\nválec 1 1');
    has(r, 6, "warn", "asm.stale-copy");
  });
  it("20 clash.undetermined ⚠ a clash.hidden ℹ; kolize šroub × závit = ℹ clash.thread, ostatní ⚠ clash.real", async () => {
    const part = (name: string, features: Feature[]): CadDoc => ({ ...emptyDoc(name), features });
    const plate = part("Deska", [{ id: "b", name: "Kvádr 1", type: "box", size: [40, 40, 20], position: [0, 0, 0], centered: false, mode: "new" } as Feature, { id: "h", name: "Díra 1", type: "hole", position: [10, 10, 20], axis: "Z", flip: false, diameter: 6.8, depth: 20, cbDiameter: 0, cbDepth: 0, kind: "tapped", thread: "M8", threadDepth: 16 } as Feature]);
    const screw = part("Šroub M8x20", [{ id: "c", name: "Válec 1", type: "cylinder", radius: 4, height: 20, position: [0, 0, 0], axis: "Z", mode: "new" } as Feature]);
    const comps: AsmComponent[] = [
      { id: "c1", name: "Deska", source: { kind: "part", doc: plate }, placement: { position: [0, 0, 0], rotation: [0, 0, 0] } },
      { id: "c2", name: "Šroub M8x20", source: { kind: "part", doc: screw }, placement: { position: [10, 10, 4], rotation: [0, 0, 0] } },
      { id: "c3", name: "Kostka", source: { kind: "part", doc: part("Kostka", [{ id: "k", name: "Kvádr 1", type: "box", size: [5, 5, 5], position: [0, 0, 0], centered: false, mode: "new" } as Feature]) }, placement: { position: [30, 30, 18], rotation: [0, 0, 0] } },
      { id: "c4", name: "Skrytá", hidden: true, source: { kind: "part", doc: plate }, placement: { position: [0, 0, 0], rotation: [0, 0, 0] } },
    ];
    const asm: CadDoc = { ...emptyDoc("S"), kind: "assembly", components: comps };
    const res = Object.assign([{ a: "c1", b: "c2", volume: 150 }, { a: "c1", b: "c3", volume: 10 }], { stats: { pairs: 3, culled: 0, exact: 2, reused: 0, undetermined: 1 } });
    const r = await runFake(`${JSON.stringify(asm)}\nkolize`, fakeKernel({ interference: async () => res }));
    has(r, 2, "note", "clash.thread");
    has(r, 2, "warn", "clash.real");
    has(r, 2, "warn", "clash.undetermined");
    has(r, 2, "note", "clash.hidden");
    expect(coded(r).filter((c) => c.endsWith("clash.real"))).toHaveLength(1);
    const kv = r.entries.find((e) => e.level === "measure" && e.code === "clash");
    expect(kv?.text).toBe("total=2 thread=1 underhead=0 real=1 undetermined=0");
  });
  it("22 tab.settle-timeout ✗: výjimka s kódem se zapíše tímto kódem (hostitel aplikace)", async () => {
    const k = fakeKernel({ topology: async () => Promise.reject(new CodedError("tab.settle-timeout", [5])) });
    const r = await runFake("nový díl A\nkvádr 1 1 1\nzaoblit 1 hrany svislé\nstav", k);
    // výjimka z obsluhy operace (zaoblit → topologie) → ✗ s kódem výjimky na řádku operace
    has(r, 3, "error", "tab.settle-timeout");
  });
});

describe("soupis 5.2 – stavba, sestava, měření, výkres, materiál (č. 24–38)", () => {
  it("24–26 param.clamped ⚠: úhel kuželového zahloubení, hrot, rotace 0, úhel stěny tvářecího nástroje", () => {
    const codes = (f: Partial<Feature>) => lintParams({ id: "x", name: "X", ...f } as Feature).map((d) => `${d.code} ${d.args[0]}→${d.args[1]}`);
    expect(codes({ type: "hole", kind: "countersink", csAngle: 200 } as Partial<Feature>)).toEqual(["param.clamped 200→170"]);
    expect(codes({ type: "hole", kind: "tapped", tipAngle: 40 } as Partial<Feature>)).toEqual(["param.clamped 40→60"]);
    expect(codes({ type: "revolve", angle: 0 } as Partial<Feature>)).toEqual(["param.clamped 0→360"]);
    expect(codes({ type: "revolve", angle: 400 } as Partial<Feature>)).toEqual(["param.clamped 400→360"]);
    expect(codes({ type: "ext", ext: "sheet.dimple", data: { wallAngle: 2 } } as Partial<Feature>)).toEqual(["param.clamped 2→5"]);
    expect(codes({ type: "hole", kind: "countersink", csAngle: 90 } as Partial<Feature>)).toEqual([]);
  });
  it("27 geom.approx ℹ, 28 geom.volume-failed ⚠ (metriky stavby)", async () => {
    has(await runFake("nový díl A\nkvádr 1 1 1", fakeKernel({}, { approx: true })), null, "note", "geom.approx");
    has(await runFake("nový díl A\nkvádr 1 1 1", fakeKernel({}, { volumeFailed: true })), null, "warn", "geom.volume-failed");
  });
  it("29 asm.depth ⚠: podsestavy hlubší než 16 úrovní", async () => {
    let d: CadDoc = { ...emptyDoc("L0"), features: [{ id: uid(), name: "Kvádr 1", type: "box", size: [1, 1, 1], position: [0, 0, 0], centered: false, mode: "new" } as Feature] };
    let src: ComponentSource = { kind: "part", doc: d };
    for (let i = 0; i < 18; i++) {
      d = { ...emptyDoc(`S${i}`), kind: "assembly", components: [{ id: uid(), name: `c${i}`, source: src, placement: { position: [0, 0, 0], rotation: [0, 0, 0] } }] };
      src = { kind: "asm", doc: d };
    }
    has(await runFake(JSON.stringify(d)), null, "warn", "asm.depth");
  });
  it("30 asm.faces-truncated ⚠: díl s víc než 400 plochami (plochy pro vazby)", async () => {
    const seen: string[] = [];
    const env = { faceLists: new Map(), geo: new Map(), mateFace: async () => null, onFacesTruncated: (key: string, n: number) => seen.push(`${key}:${n}`) } as unknown as AsmEnv;
    await partFaces(env, "k1", { metrics: { faces: 450 } } as unknown as BuildResult);
    expect(seen).toEqual(["k1:400"]);
  });
  it("31 measure.truncated ℹ: měření pravidlem vypíše nejvýš 200 entit", async () => {
    const faces = Array.from({ length: 250 }, (_, i) => ({ index: i, planar: true, normal: [0, 0, 1], center: [0, 0, 10] }));
    const k = fakeKernel({ topology: async () => ({ faces, edges: [], bbox: [[0, 0, 0], [10, 10, 10]], metrics: {} }), measure: async () => ({ kind: "list", what: "faces", rule: "vše", entities: [] }) });
    const r = await runFake("nový díl A\nkvádr 10 10 10\nměřit plochy vše", k);
    has(r, 3, "note", "measure.truncated");
  });
  it("32 drawing.* po bloku (přísně): řez neprotíná těleso → ✗ drawing.section-miss na posledním řádku bloku; 33 překryv = drawing.overlap", async () => {
    const r = await runReal("přísně\nnový díl A\nkvádr 20 20 10\nvýkres A4 řez XZ odsazení 500\nvýkres měřítko 1:1\nválec 2 2", {});
    expect(r.stopped).toEqual({ line: 5, code: "drawing.section-miss" });
    expect(find(r, "drawing.section-miss")!.data).toEqual({ lines: [4, 5] });
    expect(find(r, "drawing.section-miss")!.level).toBe("error");
    expect(sheetWarningCode("Rovina řezu neprotíná těleso – upravte odsazení.")).toBe("drawing.section-miss");
    expect(sheetWarningCode("Pohledy se v měřítku 1:2 nevejdou na list A2.")).toBe("drawing.warning");
  }, 180_000);
  it("37 material.class ℹ / material.density-assumed ⚠ a mapování tříd", async () => {
    const r = await runFake("nový díl A\nkvádr 1 1 1\nmateriál EN AW-6082\nmateriál XY-123");
    has(r, 3, "note", "material.class");
    has(r, 4, "warn", "material.density-assumed");
    // ČSN 11 423 = ocel třídy 11: třída se pozná (ℹ), hustota se nepředpokládá (žádné ⚠ density-assumed) – e2e cad-plate-roundtrip
    const c = await runFake("nový díl A\nkvádr 1 1 1\nmateriál ČSN 11 423");
    has(c, 3, "note", "material.class");
    expect(find(c, "material.class")!.text).toMatch(/ČSN 11 423.*Ocel \(7\.85 g\/cm³\)/);
    expect(coded(c).some((x) => x.includes("material.density-assumed"))).toBe(false);
    expect(["EN AW-6082", "1.4301", "1.4404", "1.2311", "1.0503", "ČSN 11 523", "19 312", "S235JR", "C45", "42CrMo4", "CuZn39Pb3", "X5CrNi18-10", "3.7165", "nesmysl"].map(materialClass)).toEqual(["hlinik", "nerez", "nerez", "ocel", "ocel", "ocel", "ocel", "ocel", "ocel", "ocel", "mosaz", "nerez", "titan", null]);
  });
  it("38 hole.tap-diameter ⚠: zadaný průměr závitové díry nahrazen tabulkovým vrtákem", async () => {
    const r = await runFake("nový díl A\nkvádr 20 20 20\ndíra 8 hloubka 10 v 10 10 20 závit M8\ndíra 6,8 hloubka 10 v 5 5 20 závit M8");
    has(r, 3, "warn", "hole.tap-diameter");
    expect(coded(r).filter((c) => c.startsWith("L4 "))).toEqual([]);
  });
});

/* ───────────── ověření stavbou (UNVERIFIED ✓) ───────────── */
describe("každý dokument běhu se postaví dřív, než se ohlásí jeho prvky", () => {
  it("chybný prvek dílu, ze kterého běh odešel, je ✗ (dřív ✓ bez stavby – zkouška 959)", async () => {
    const r = await runReal("nový díl A\nkvádr 10 10 10\nzaoblit 40\nnový díl B\nkvádr 1 1 1");
    has(r, 3, "error", "feature.failed");
    expect(r.entries.find((e) => e.level === "ok" && e.text.startsWith("Zaoblení 1"))).toBeUndefined();
    expect(formatConsole(r)).toMatch(/✗ Zaoblení 1 \(fillet\)/);
  }, 120_000);
  it("díl ověřený při odchodu se do sestavy nestaví znovu (výsledek v ws.asm.cache)", async () => {
    let parts = 0;
    const k = fakeKernel({ asmParts: async (list: { key: string; source: ComponentSource }[]) => ((parts += list.length), list.map((p) => ({ key: p.key, result: result(p.source.kind === "part" ? p.source.doc : emptyDoc()) }))) });
    await runFake('nový díl A\nkvádr 1 1 1\nnová sestava S\nvložit "A"\nvložit "A" v 5 0 0\nstav', k);
    expect(parts).toBe(1);
  });
});

/* ───────────── přísný režim ───────────── */
describe("přísný režim (5.3)", () => {
  it("řádek přísně: rozbor, výjimky a předpony", () => {
    expect(parseStrictLine("přísně")).toEqual({ on: true });
    expect(parseStrictLine("strict off")).toEqual({ on: false });
    expect(parseStrictLine("streng außer hole.depth-default, select.")).toEqual({ on: true, except: ["hole.depth-default", "select."] });
    expect(parseStrictLine("přísnější")).toBeNull();
    expect(() => parseStrictLine("přísně možná")).toThrow();
    expect(excepted("hole.depth-default", new Set(["hole."]))).toBe(true);
    expect(excepted("hole.depth-default", new Set(["hole"]))).toBe(true);
    expect(excepted("holes.x", new Set(["hole"]))).toBe(false);
    const s = new StrictState(false);
    s.apply({ on: true, except: ["a.b"] });
    expect(s.opt).toEqual({ except: ["a.b"] });
  });
  it("varování rozboru v přísném úseku: nic se neprovede (STOP před během), dřívější úsek bez přísnosti nevadí", async () => {
    const ws = new MemoryWorkspace();
    const r = await runFake("nový díl A\ndíra 5 v 1 1 1\npřísně\nkvádr 1 1 1\ndíra 5 v 2 2 2", fakeKernel(), {}, ws);
    expect(r.stopped).toEqual({ line: 5, code: "hole.depth-default" });
    expect(ws.tabs().map((t) => t.title)).not.toContain("A"); // nic se neprovedlo
    expect(formatShort(r).split("\n")[0]).toMatch(/^MNCAD\/1 STOP /);
    expect(formatConsole(r)).toMatch(/■ přísný režim: zastaveno na řádku 5 \(hole\.depth-default\)/);
  });
  it("za běhu zastaví první ⚠/✗ na řádku prvku (stavba po každé operaci); kromě = výjimka; ℹ nezastaví", async () => {
    const ws = new MemoryWorkspace();
    const r = await runReal("nový díl A\nkvádr 10 10 10\nzaoblit 40\nválec 2 2", { strict: true }, ws);
    expect(r.stopped).toEqual({ line: 3, code: "feature.failed" });
    expect(ws.present().features.map((f) => f.type)).toEqual(["box", "fillet"]); // válec na ř. 4 se neprovedl
    const r2 = await runReal("přísně kromě feature.\nnový díl A\nkvádr 10 10 10\nzaoblit 40\nválec 2 2");
    expect(r2.stopped).toBeUndefined();
    const r3 = await runFake("přísně\nnový díl B\nnový díl\nkvádr 1 1 1 přidat"); // ℹ name.renamed-auto, mode.new-body
    expect(r3.stopped).toBeUndefined();
    expect(r3.strict).toBe(true);
  }, 180_000);
  it("výkres po bloku: mezistav uvnitř bloku nezastaví, varování platného listu až na konci bloku", async () => {
    const r = await runReal("přísně\nnový díl A\nkvádr 20 20 10\nvýkres A4\nvýkres měřítko 1:1\nvýkres A4 na výšku");
    expect(r.stopped).toBeUndefined();
  }, 180_000);
  it("přísně vyp: varování po vypnutí nezastaví", async () => {
    const r = await runFake("přísně\nnový díl A\nkvádr 1 1 1\npřísně vyp\ndíra 5 v 1 1 1");
    expect(r.stopped).toBeUndefined();
    has(r, 5, "warn", "hole.depth-default");
  });
});

/* ───────────── třídy kolizí (nález 2) ───────────── */
describe("kolize šroub × závit = ℹ v kolize i v pohybu", () => {
  const plate: AsmComponent = { id: "p", name: "Základová deska", source: { kind: "part", doc: { ...emptyDoc("Základová deska"), features: [{ id: "h", name: "Díra 1", type: "hole", position: [0, 0, 0], axis: "Z", flip: false, diameter: 8.5, depth: 30, cbDiameter: 0, cbDepth: 0, kind: "tapped", thread: "M10", threadDepth: 20, points: [{ kind: "xyz", p: [0, 0, 0] }, { kind: "xyz", p: [10, 0, 0] }] } as Feature] } }, placement: { position: [0, 0, 0], rotation: [0, 0, 0] } };
  const screw: AsmComponent = { id: "s", name: "Šroub M10x45", source: { kind: "part", doc: { ...emptyDoc("Šroub M10x45"), features: [{ id: "t", name: "Závit 1", type: "thread", designation: "M10", position: [0, 0, 0], axis: "Z", length: 30, modeled: false } as Feature] } }, placement: { position: [0, 0, 0], rotation: [0, 0, 0] } };
  const other: AsmComponent = { id: "o", name: "Stírací deska", source: { kind: "part", doc: emptyDoc("Stírací deska") }, placement: { position: [0, 0, 0], rotation: [0, 0, 0] } };
  const doc: CadDoc = { ...emptyDoc("Nástroj"), kind: "assembly", components: [plate, screw, other] };
  it("zařazení: šroub (kosmetický závit / název) × závitová díra téhož průměru; objem nad mezikruží = skutečná", () => {
    expect(screwOf(screw)).toEqual({ d: 10, length: 30 });
    expect(screwOf({ ...other, name: "7 SROUB M6x20" })).toEqual({ d: 6, length: 20 });
    expect(screwOf({ ...other, name: "Deska M8" })).toBeNull();
    expect(classifyClash(doc, { a: "p", b: "s", volume: 300 })).toBe("thread");
    expect(classifyClash(doc, { a: "p", b: "s", volume: 5000 })).toBe("real"); // hlava v desce
    expect(classifyClash(doc, { a: "p", b: "o", volume: 10 })).toBe("real");
    expect(classifyClashes(doc, [{ a: "s", b: "p", volume: 10 }]).counts).toEqual({ total: 1, thread: 1, underhead: 0, real: 0, undetermined: 0 });
  });
  it("pohyb … kolize: šrouby v závitu ℹ clash.thread, první skutečná kolize ⚠ clash.real s krokem (ne „první kolize v kroku 0“)", async () => {
    const step = (i: number, clashes: { a: string; b: string; volume: number }[]) => ({ i, t: i * 0.1, motors: [i], place: {}, conflicts: [], clashes });
    const res = { steps: [step(0, [{ a: "p", b: "s", volume: 200 }]), step(1, [{ a: "p", b: "s", volume: 200 }]), step(2, [{ a: "p", b: "s", volume: 200 }, { a: "p", b: "o", volume: 12.5 }])], comps: [], motors: [], collision: { a: "p", b: "s", volume: 200, step: 0, t: 0 }, collisionsChecked: true, conflictSteps: 0 } as unknown as MotionResult;
    const out = await motionClashLines(res, doc);
    expect(out.codes.map((c) => c.code)).toEqual(["clash.thread", "clash.real"]);
    expect(out.codes[1].text).toMatch(/„Stírací deska“ × „Základová deska“ od kroku 2 /);
    expect(out.lines[0]).not.toMatch(/^⚠/);
    const only = await motionClashLines({ ...res, steps: res.steps.slice(0, 2) } as MotionResult, doc);
    expect(only.codes.map((c) => c.code)).toEqual(["clash.thread"]);
    expect(only.lines[0]).toMatch(/skutečné: žádné/);
  });
});

/* ───────────── opravy po recenzi B4 (nálezy 1–10) ───────────── */
describe("recenze B4: přísný režim podle řádků i v CLI, výjimky předponou, STOP bez výstupů", () => {
  const cli = async (script: string, strict: StrictOpt, kernel = fakeKernel(), open: string[] = [], files: Record<string, Uint8Array> = {}) => {
    const { engineRun, finishRun } = await import("../cli/job");
    const { ReportBuilder } = await import("./protocol");
    const ws = new MemoryWorkspace();
    const sink = memoryFileSink();
    // STEP se po zápisu znovu načte a změří (engine/files.ts verifyExport) – falešné jádro vrátí tytéž údaje jako model
    const stats = { solids: 1, volume: 1000, bbox: [[0, 0, 0], [10, 10, 10]] };
    const host: EngineHost = { kernel: { ...kernel, exportFile: async () => new TextEncoder().encode("ISO-10303-21;").buffer, exportStats: async () => ({ model: stats, file: stats }) } as unknown as KernelApi, files: sink, inputs: memoryFileSource(files), now: () => Date.now() };
    const rb = new ReportBuilder({ lang: "cs", lines: script.split("\n").length, strict: !!strict });
    const noop = { opStart: () => undefined, opEnd: () => undefined };
    await engineRun(ws, script, host, rb, { strict: strict ?? false, open }, noop);
    await finishRun(ws, host, rb, { formats: ["step"], allDocs: false, noOutputOnError: false, share: false, strict: strict ?? false }, noop);
    // pojistka konce vlákna (cli/job.ts handleRun) = tatáž funkce úseků
    const net = rb.strictMode?.hit(rb.entries, null);
    return { rb, files: [...sink.files.keys()], net };
  };
  it("nález 1: ⚠ před `přísně`, za `přísně vyp` / `strict off` ani varování rozboru mimo přísný úsek nezastaví (CLI = engine)", async () => {
    for (const s of ["přísně\nkvádr 40 40 20\npřísně vyp\ndíra 5 v 10 10", "kvádr 40 40 20\ndíra 5 v 10 10\npřísně\nválec 2 2", "přísně\nkvádr 40 40 20\nstrict off\ndíra 5 v 10 10"]) {
      const r = await cli(s, false);
      expect(r.rb.stopped, s).toBeUndefined();
      expect(r.net, s).toBeUndefined();
      expect(r.files, s).toEqual(["Nový díl.step"]);
    }
    // --strict + `přísně vyp` na 1. řádku: chybný prvek = FAIL (exit 1), ne STOP
    const k = fakeKernel({ build: async (d: CadDoc) => ({ ...result(d), status: d.features.map((f) => ({ id: f.id, ok: f.type !== "fillet", ...(f.type === "fillet" ? { error: "R40" } : {}) })) }) });
    const f = await cli("přísně vyp\nnový díl A\nkvádr 10 10 10\nzaoblit 40", true, k);
    expect(f.rb.stopped).toBeUndefined();
    expect(f.net).toBeUndefined();
    expect(f.rb.count("error")).toBe(1);
  });
  it("nález 1 / rozhodnutí 15.2: STOP přísného úseku = žádné výstupy --formats; StrictState.hit podle řádků", async () => {
    const r = await cli("kvádr 40 40 20\npřísně\ndíra 5 v 10 10", false);
    expect(r.rb.stopped).toEqual({ line: 3, code: "hole.depth-default" });
    expect(r.files).toEqual([]);
    const s = new StrictState(false, [
      { line: 2, on: true, except: ["hole."] },
      { line: 4, on: false },
    ]);
    const e = (line: number | null, code: string, level: Entry["level"] = "warn"): Entry => ({ line, level, code, text: "" });
    expect(s.hit([e(1, "a.b"), e(3, "hole.depth-default"), e(5, "a.b"), e(3, "x.y", "note")], 9)).toBeUndefined();
    expect(s.hit([e(3, "a.b")], 9)?.code).toBe("a.b");
    expect(s.at(null).on).toBe(false); // konec skriptu: vypnuto
    const settled = e(3, "a.b");
    s.settled.add(settled);
    expect(s.hit([settled], 9)).toBeUndefined();
  });
  it("nález 2: výjimka předponou i v CLI (`--strict=hole.`, `strict except hole.`)", async () => {
    const { parseStrict } = await import("../cli/args");
    const { strictStopper } = await import("../cli/watchdog");
    expect(parseStrict("hole.")).toEqual({ except: ["hole."] });
    expect(parseStrict("kromě hole.,select.ambiguous")).toEqual({ except: ["hole.", "select.ambiguous"] });
    expect(strictStopper([{ line: 3, level: "warn", code: "hole.depth-default", text: "" }], { except: ["hole."] })).toBeUndefined();
    const r = await cli("strict except hole.\nbox 40 40 20\nhole 5 at 10 10\ncylinder 2 2", false);
    expect(r.rb.stopped).toBeUndefined();
    expect(r.net).toBeUndefined();
    const r2 = await cli("kvádr 40 40 20\ndíra 5 v 10 10", { except: ["hole."] });
    expect(r2.rb.stopped).toBeUndefined();
  });
  it("nález 9: po STOP se poslední `stav` neprovedl – žádný řádek `= status`", async () => {
    const r = await runFake("přísně\nkvádr 10 10 10\ndíra 5 v 1 1\nstav");
    expect(r.stopped).toEqual({ line: 3, code: "hole.depth-default" });
    expect(r.entries.some((x) => x.level === "measure" && x.code === "status")).toBe(false);
    const ok = await runFake("kvádr 10 10 10\nstav");
    expect(ok.entries.some((x) => x.level === "measure" && x.code === "status")).toBe(true);
  });
});

describe("recenze int2, nález 2: drawing.section-legacy v přísném režimu respektuje výjimky", () => {
  // starší zápis odsazení řezu (souřadnice osy −20 u hranolu Y 0…30 → dnešní výklad mine těleso) = ⚠, přísně ✗
  const T = "nový díl Hranol\nskica XZ: obdélník 40 30 v 0 15\nvysunout 60\nvýkres A3 pohledy přední,horní";
  const legacy = (r: RunReport) => coded(r).filter((c) => c.includes("drawing.section-legacy"));
  it("normálně ⚠; přísně ✗ a STOP; `přísně kromě drawing.section-legacy` / `--strict=kromě …` / předpona `drawing.` = ⚠ bez zastavení", async () => {
    const normal = await runReal(`${T}\nvýkres řez XZ odsazení -20\nstav`);
    expect(legacy(normal)).toEqual(["L5 warn drawing.section-legacy"]);
    expect(normal.ok).toBe(true);
    const strict = await runReal(`${T}\npřísně\nvýkres řez XZ odsazení -20\nstav`);
    expect(legacy(strict)).toEqual(["L6 error drawing.section-legacy"]);
    expect(strict.stopped).toEqual({ line: 6, code: "drawing.section-legacy" });
    const cases: [string, string, { strict?: StrictOpt }][] = [
      ["řádek přísně kromě", `${T}\npřísně kromě drawing.section-legacy\nvýkres řez XZ odsazení -20\nstav`, {}],
      ["řádek přísně kromě předpona", `${T}\npřísně kromě drawing.\nvýkres řez XZ odsazení -20\nstav`, {}],
      ["volba běhu kromě", `${T}\nvýkres řez XZ odsazení -20\nstav`, { strict: { except: ["drawing.section-legacy"] } }],
    ];
    for (const [label, text, o] of cases) {
      const r = await runReal(text, o);
      expect(legacy(r), label).toEqual([`L${text.split("\n").findIndex((l) => l.startsWith("výkres řez")) + 1} warn drawing.section-legacy`]);
      expect(r.stopped, label).toBeUndefined();
      expect(r.ok, label).toBe(true);
    }
    // přísně vyp nad řádkem: ⚠
    const off = await runReal(`přísně\n${T}\npřísně vyp\nvýkres řez XZ odsazení -20\nstav`);
    expect(legacy(off)).toEqual(["L7 warn drawing.section-legacy"]);
    // StrictState.escalates: stav na řádku (volba + řádky `přísně` nad ním), výjimka přesně i předponou
    const s = new StrictState({ except: ["hole."] }, [{ line: 3, on: true, except: ["drawing.section-legacy"] }, { line: 5, on: false }]);
    expect([s.escalates("drawing.section-legacy", 2), s.escalates("drawing.section-legacy", 4), s.escalates("drawing.overlap", 4), s.escalates("hole.x", 4), s.escalates("drawing.overlap", 6)]).toEqual([true, false, true, false, false]);
    expect(new StrictState(false).escalates("drawing.section-legacy", 1)).toBe(false);
  }, 240_000);
});

describe("recenze B4: výkres – mezistav bloku, list v normálním běhu, kódy nezávislé na jazyce", () => {
  const T7 = 'nový díl A\nkvádr 20 20 10\nvýkres A4\nvýkres značka text "KALIT 58 HRC KALIT" v 240 20 výška 5';
  // List kvádru bez úplných kót hlásí i kontrolu kót (vlna 22, bod 18 – ⚠ drawing.dims-incomplete); tyto případy zkoumají
  // překryv, proto přísný běh výjimkou `kromě drawing.dims-incomplete` a výpis kódů bez ní (její přítomnost se ověří zvlášť).
  const overlapCodes = (r: RunReport) => coded(r).filter((c) => c.includes("drawing.") && !c.includes("drawing.dims-incomplete"));
  it("nález 3: překryv opravený dalším příkazem bloku nezastaví ani nehlásí ⚠; trvající překryv = ⚠ drawing.overlap na řádku značky", async () => {
    const fixed = await runReal(`přísně kromě drawing.dims-incomplete\n${T7}\nvýkres upravit a4 posun="-150 120"\nválec 2 2`);
    expect(fixed.stopped).toBeUndefined();
    expect(overlapCodes(fixed)).toEqual([]);
    expect(coded(fixed)).toContain("L6 warn drawing.dims-incomplete");
    const normal = await runReal(`${T7}\nvýkres upravit a4 posun="-150 120"\nválec 2 2`);
    expect(overlapCodes(normal)).toEqual([]);
    const kept = await runReal(`${T7}\nválec 2 2`);
    expect(overlapCodes(kept)).toEqual(["L4 warn drawing.overlap", "L4 warn drawing.overlap"]);
    const strict = await runReal(`přísně kromě drawing.dims-incomplete\n${T7}\nválec 2 2`);
    expect(strict.stopped).toEqual({ line: 5, code: "drawing.overlap" });
  }, 240_000);
  it("nález 6: kód překryvu je stejný v cs / en / de", async () => {
    const out: string[][] = [];
    for (const lang of ["cs", "en", "de"] as const) {
      setLang(lang);
      try {
        const r = await runReal(`${T7}\nválec 2 2`, { lang });
        out.push(overlapCodes(r));
      } finally {
        setLang("cs");
      }
    }
    expect(out[1]).toEqual(out[0]);
    expect(out[2]).toEqual(out[0]);
    expect(out[0]).toEqual(["L4 warn drawing.overlap", "L4 warn drawing.overlap"]);
  }, 240_000);
  it("nález 4: řez mimo těleso je ✗ i v normálním běhu bez exportu; `výkres stav` varování listu kóduje", async () => {
    const r = await runReal("nový díl A\nkvádr 20 20 10\nvýkres A4 řez XZ odsazení 500\nvýkres měřítko 1:1\nválec 2 2");
    has(r, 4, "error", "drawing.section-miss");
    // text kódu + přesný důvod s rozsahem odsazení z hlášení jádra (vlna 15, B5)
    expect(find(r, "drawing.section-miss")!.text).toMatch(/^rovina řezu neprotíná těleso: List 1 – rovina řezu Y = -500 leží mimo těleso/);
    expect(r.ok).toBe(false);
    const st = await runReal("nový díl A\nkvádr 20 20 10\nvýkres A4 řez XZ odsazení 500\nvýkres stav");
    expect(coded(st).filter((c) => c.includes("section-miss"))).toEqual(["L4 error drawing.section-miss"]);
    expect(sheetWarningCode(tr("Rovina řezu neprotíná těleso – upravte odsazení."))).toBe("drawing.section-miss");
  }, 240_000);
});

describe("recenze B4: šroub × závit podle polohy a osy, kolize v pohybu po dvojicích", () => {
  const holes = [10, 20, 30, 40, 50].map((x, i) => ({ id: `h${i}`, name: `Díra ${i + 1}`, type: "hole", position: [x, 20, 20], axis: "Z", flip: false, diameter: 0, depth: 20, cbDiameter: 0, cbDepth: 0, kind: "tapped", thread: "M8", threadDepth: 16 }) as unknown as Feature);
  const plate: AsmComponent = { id: "p", name: "Deska", source: { kind: "part", doc: { ...emptyDoc("Deska"), features: [{ id: "b", name: "Kvádr 1", type: "box", size: [100, 40, 20], position: [0, 0, 0], centered: false, mode: "new" } as Feature, ...holes] } }, placement: { position: [0, 0, 0], rotation: [0, 0, 0] } };
  const screwDoc: CadDoc = { ...emptyDoc("Šroub M8x20"), features: [{ id: "c", name: "Válec 1", type: "cylinder", radius: 4, height: 20, position: [0, 0, 0], axis: "Z", mode: "new" } as Feature] };
  const at = (x: number, y = 20, rot: [number, number, number] = [0, 0, 0]): AsmComponent => ({ id: "s", name: "Šroub M8x20", source: { kind: "part", doc: screwDoc }, placement: { position: [x, y, 0], rotation: rot } });
  const asm = (s: AsmComponent): CadDoc => ({ ...emptyDoc("S"), kind: "assembly", components: [plate, s] });
  it("nález 5: šroub v plném materiálu desky s 5 závitovými dírami = skutečná kolize; v ose díry = závit; mimo osu 0,5 mm = skutečná", () => {
    expect(classifyClash(asm(at(80)), { a: "p", b: "s", volume: 1005.3 })).toBe("real");
    expect(classifyClash(asm(at(30)), { a: "p", b: "s", volume: 278.9 })).toBe("thread");
    expect(classifyClash(asm(at(30.5)), { a: "p", b: "s", volume: 279 })).toBe("real");
    // díra jedna: objem nad mezikruží jedné díry (5 děr by součtem „prošlo“)
    expect(classifyClash(asm(at(30)), { a: "p", b: "s", volume: 600 })).toBe("real");
    // podsestava: světová poloha přes složené polohy
    const sub: AsmComponent = { id: "g", name: "Skupina", source: { kind: "asm", doc: { ...emptyDoc("Skupina"), kind: "assembly", components: [{ ...at(10), placement: { position: [10, 20, 0], rotation: [0, 0, 0] } }] } }, placement: { position: [10, 0, 0], rotation: [0, 0, 0] } };
    const nested: CadDoc = { ...emptyDoc("S"), kind: "assembly", components: [plate, sub] };
    expect(classifyClash(nested, { a: "p", b: "g", aPath: ["p"], bPath: ["g", "s"], volume: 278.9 })).toBe("thread"); // x = 10 + 10 = 20
    // otočený šroub (osa X) v ose díry Z není souosý
    expect(classifyClash(asm(at(30, 20, [0, 90, 0])), { a: "p", b: "s", volume: 200 })).toBe("real");
    // díra s polohou odkazem: bez geometrie nerozhodnutelné (⚠)
    const refPlate: AsmComponent = { ...plate, source: { kind: "part", doc: { ...emptyDoc("Deska"), features: [{ ...holes[0], points: [{ kind: "vertex", index: 3 }] } as Feature] } } };
    expect(classifyClash({ ...emptyDoc("S"), kind: "assembly", components: [refPlate, at(10)] }, { a: "p", b: "s", volume: 200 })).toBe("undetermined");
  });
  it("nález 8: kolize v pohybu po dvojicích názvů (i pozdější jiná dvojice), krok v poloze kroku; pohyb krok = ⚠ clash.real", async () => {
    const pad: AsmComponent = { id: "n", name: "Zvedák", source: { kind: "part", doc: emptyDoc("Zvedák") }, placement: { position: [0, 0, 0], rotation: [0, 0, 0] } };
    const spring: AsmComponent = { id: "q", name: "Pružina", source: { kind: "part", doc: emptyDoc("Pružina") }, placement: { position: [0, 0, 0], rotation: [0, 0, 0] } };
    const doc: CadDoc = { ...emptyDoc("S"), kind: "assembly", components: [plate, at(30), pad, spring] };
    const step = (i: number, clashes: { a: string; b: string; volume: number }[], place: Record<string, unknown> = {}) => ({ i, t: i * 0.1, motors: [i], place, conflicts: [], clashes });
    const res = {
      steps: [step(0, [{ a: "p", b: "s", volume: 270 }]), step(1, [{ a: "p", b: "s", volume: 270 }, { a: "p", b: "q", volume: 5 }]), step(9, [{ a: "p", b: "q", volume: 6 }, { a: "p", b: "n", volume: 40 }]), step(10, [{ a: "p", b: "s", volume: 270 }], { s: { position: [80, 20, 0], rotation: [0, 0, 0] } })],
      comps: [],
      motors: [],
      collision: null,
      collisionsChecked: true,
      conflictSteps: 0,
    } as unknown as MotionResult;
    const out = await motionClashLines(res, doc);
    expect(out.codes.map((c) => c.code)).toEqual(["clash.thread", "clash.real", "clash.real", "clash.real"]);
    expect(out.codes[1].text).toMatch(/„Deska“ × „Pružina“ od kroku 1 .*kroků 2/);
    expect(out.codes[2].text).toMatch(/„Deska“ × „Zvedák“ od kroku 9/);
    expect(out.codes[3].text).toMatch(/„Deska“ × „Šroub M8x20“ od kroku 10/); // šroub v kroku 10 mimo díru (poloha kroku)
    expect(out.lines[0]).toMatch(/skutečné: 3 dvojic dílů v 3 krocích, první v kroku 1/);
  });
});

describe("recenze B4: načtené dokumenty se ověří, jedna chyba = jeden ✗", () => {
  const jsonA = JSON.stringify({ app: "mnastrojarna-cad", version: 2, name: "A", material: "ocel", features: [{ id: "k1", name: "Kvádr 1", type: "box", size: [10, 10, 10], position: [0, 0, 0], centered: false, mode: "new" }, { id: "z1", name: "Zaoblení 1", type: "fillet", radius: 40, edges: "all" }] });
  it("nález 6: JSON na 1. řádku, ze kterého běh odešel = ✗ L1 (normálně FAIL, přísně STOP)", async () => {
    const r = await runReal(`${jsonA}\nnový díl B\nkvádr 1 1 1`);
    has(r, 1, "error", "feature.failed");
    expect(r.stopped).toBeUndefined();
    const s = await runReal(`${jsonA}\nnový díl B\nkvádr 1 1 1`, { strict: true });
    expect(s.stopped).toEqual({ line: 1, code: "feature.failed" });
  }, 180_000);
  it("nález 6: dokument z --open (preloaded) se ověří i po přechodu na jiný; přísně = STOP před skriptem", async () => {
    const files = { "A.mncad": new TextEncoder().encode(jsonA) };
    const { engineRun } = await import("../cli/job");
    const { ReportBuilder } = await import("./protocol");
    for (const strict of [false, true]) {
      const ws = new MemoryWorkspace();
      const host: EngineHost = { kernel: real as unknown as KernelApi, files: memoryFileSink(), inputs: memoryFileSource(files), now: () => Date.now() };
      const rb = new ReportBuilder({ lang: "cs", lines: 2, strict });
      const ops: string[] = [];
      await engineRun(ws, "nový díl B\nkvádr 1 1 1", host, rb, { strict, open: ["A.mncad"] }, { opStart: (_l, op) => void ops.push(op), opEnd: () => undefined });
      const r = rb.finish();
      expect(coded(r)).toContain("L- error feature.failed");
      if (strict) {
        expect(r.stopped).toEqual({ line: null, code: "feature.failed" });
        expect(ops).toEqual(["open", "build"]); // skript se neprovedl (jen otevření a závěrečná stavba bez řádku)
      } else expect(r.stopped).toBeUndefined();
    }
  }, 180_000);
  it("vlna 22, bod 22b (kolo 6): ⚠ prvku dokumentu z --open zastaví přísný běh PŘED skriptem – žádný export se nezapíše", async () => {
    // dřív: řádek načtení `--open` je null a `report` ⚠ nezměněného prvku u dokumentu bez řádku načtení přeskočil –
    // přísné ověření před skriptem ⚠ nevidělo, `export stl` se provedl a soubor se zapsal; STOP dal až závěrečný souhrn (L-)
    const doc = { app: "mnastrojarna-cad", version: 2, name: "Deska R", material: "ocel", features: [{ id: "t1", name: "Trubka 1", type: "tube", outer: 30, inner: 16.4, height: 20, position: [0, 0, 0], mode: "new", axis: "Z" }, { id: "h1", name: "Tažení po šroubovici", type: "box", size: [1, 1, 1], position: [0, 0, 0], centered: false, mode: "cut" }] };
    const warned = (d: CadDoc) => d.features.map((f) => (f.id === "h1" ? { id: f.id, ok: true, warning: "špička profilu závitu je tečná k povrchu", warnCode: "thread.tip-tangent" } : { id: f.id, ok: true }));
    const kernel = fakeKernel({
      build: async (d: CadDoc) => ({ ...result(d), status: warned(d) }),
      check: async (d: CadDoc) => ({ status: warned(d), paramErrors: [], solid: true }),
      asmParts: async (parts: { key: string; source: ComponentSource }[]) => parts.map((p) => ({ key: p.key, result: { ...result(p.source.kind === "part" ? p.source.doc : emptyDoc()), status: warned(p.source.kind === "part" ? p.source.doc : emptyDoc()) } })),
    });
    const { engineRun, finishRun } = await import("../cli/job");
    const { ReportBuilder } = await import("./protocol");
    for (const strict of [true, false]) {
      const ws = new MemoryWorkspace();
      const files = memoryFileSink();
      const host: EngineHost = { kernel, files, inputs: memoryFileSource({ "deska-r.mncad": new TextEncoder().encode(JSON.stringify(doc)) }), now: () => Date.now() };
      const rb = new ReportBuilder({ lang: "cs", lines: 2, strict });
      const ops: string[] = [];
      const hooks = { opStart: (_l: number | null, op: string) => void ops.push(op), opEnd: () => undefined };
      await engineRun(ws, "stav\nexport stl r7", host, rb, { strict, open: ["deska-r.mncad"] }, hooks);
      await finishRun(ws, host, rb, { formats: "none", allDocs: false, noOutputOnError: false, share: false, strict }, hooks);
      const r = rb.finish();
      expect(coded(r)).toContain("L- warn thread.tip-tangent");
      if (strict) {
        expect(r.stopped).toEqual({ line: null, code: "thread.tip-tangent" });
        expect(ops).not.toContain("export"); // skript se neprovedl
        expect(ops).not.toContain("status");
        expect([...files.files.keys()]).toEqual([]);
      } else {
        expect(r.stopped).toBeUndefined();
        // normální běh: ⚠ jen jednou (ověření při otevření + závěrečný souhrn se neopakují)
        expect(coded(r).filter((c) => c === "L- warn thread.tip-tangent")).toHaveLength(1);
      }
    }
  });
  it("nález 10: selhané zaoblení v úpravě v kontextu = jeden ✗ feature.failed (ne další msg.error ze `sestava hotovo`)", async () => {
    const r = await runReal('nový díl Čep\nválec 10 30\nnová sestava S\nvložit "Čep" ukotvit\nsestava upravit "Čep"\nzaoblit 40\nsestava hotovo\nkolize');
    expect(coded(r).filter((c) => c.includes("error"))).toEqual(["L6 error feature.failed"]);
  }, 180_000);
});

describe("recenze B4: režie přísného režimu a listy výkresu (nález 10)", () => {
  it("list spočítaný na konci běhu (normálně i přísně) se při exportu PDF z CLI nepočítá znovu", async () => {
    const { engineRun, finishRun } = await import("../cli/job");
    const { ReportBuilder } = await import("./protocol");
    const { clearDrawingMemo } = await import("./sheet-eval");
    const count = async (formats: "none" | ["pdf"], strict: boolean) => {
      clearDrawingMemo();
      let n = 0;
      const kernel = Object.create(real) as KernelApi;
      (kernel as { drawing: KernelApi["drawing"] }).drawing = (...a: Parameters<KernelApi["drawing"]>) => ((n += 1), real.drawing(...a));
      const ws = new MemoryWorkspace();
      const host: EngineHost = { kernel, files: memoryFileSink(), inputs: memoryFileSource({}), now: () => Date.now() };
      const rb = new ReportBuilder({ lang: "cs", lines: 5, strict });
      const noop = { opStart: () => undefined, opEnd: () => undefined };
      await engineRun(ws, "nový díl A\nkvádr 20 20 10\nvýkres A4 řez XZ\nvýkres měřítko 1:1\nválec 2 2", host, rb, { strict, open: [] }, noop);
      await finishRun(ws, host, rb, { formats, allDocs: false, noOutputOnError: false, share: false, strict }, noop);
      return n;
    };
    const none = await count("none", false);
    expect(none).toBeGreaterThan(0); // normální běh list spočítá (dřív jen export / výkres stav)
    expect(await count(["pdf"], false)).toBe(none);
    expect(await count("none", true)).toBe(none); // přísný běh: list po bloku = týž výpočet, žádný navíc
  }, 240_000);
});
