/**
 * Vlna 22, bod 20 (fáze 2, kolo 4, track a): ztracená HRANA / VRCHOL vazby po změně dílu – oprava nejen textem, ale i v aplikaci.
 * Dřív: seznam vazeb nabízel „Vybrat plochu znovu“ jen pro plochy (`!ent`), ztracenou hranu šlo opravit jen příkazem
 * `sestava vazba N plocha b E3`; hláška ✗ mate.lost radila „vyberte plochu znovu“ i u hrany.
 * Nyní: `compEnts` = seznam hran / vrcholů téhož dílu pro výběr v GUI (mate-repick.tsx, `data-repick-ent`), stejné entity jako
 * text; ✗ mate.lost u hrany radí „vyberte hranu znovu (… E…)“. Repro (CLI): S/w22/p2/fixr4a/edge-lost.txt.
 */
import fs from "node:fs";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { mateLostArgs } from "./agent-asm";
import { compEnts, type AsmEnv } from "./asm-agent";
import { emptyAssembly, partComponent } from "./assembly";
import { setHostAssets } from "./host-assets";
import { setLang } from "./i18n";
import { makeKernelClient } from "./kernel-client";
import { memoryFileSink, memoryFileSource, type EngineHost } from "./engine/host";
import { MemoryWorkspace } from "./engine/memory-workspace";
import { formatConsole } from "./engine/protocol";
import { runScript } from "./engine/run";
import type { PartFace } from "./mates";
import { emptyDoc, type BuildResult, type CadDoc, type Mate } from "./types";

const SETUP = [
  'nový díl "Deska A"',
  "kvádr 60 40 10",
  "kvádr 20 40 5 v 0 0 5 odebrat",
  'nový díl "Přidržovač"',
  "kvádr 10 10 10",
  'nová sestava "Sestava A"',
  'vložit "Deska A" ukotvit',
  'vložit "Přidržovač" v 5 10 30',
  // E11 = vnitřní hrana schodu [20; 0; 5]–[20; 40; 5]
  'sestava vazba shodně "Přidržovač" V1 "Deska A" E11',
].join("\n");
const EDIT = ['sestava upravit "Deska A"', 'smazat "Kvádr 2"', "sestava hotovo"].join("\n");

describe("ztracená hrana vazby: výběr v GUI = text (compEnts, mate.lost)", () => {
  afterEach(() => setLang("cs"));

  it("compEnts: hrany / vrcholy listového dílu s popisem jako otisk; jiný list = prázdno", async () => {
    const line = (a: [number, number, number], b: [number, number, number]): PartFace => ({ kind: "line", origin: a, normal: [0, 1, 0], pts: [a, b] });
    const EDGES = [line([0, 0, 10], [0, 40, 10]), line([60, 0, 10], [60, 40, 10])];
    const env: AsmEnv = {
      parts: async (list) => list.map((p) => ({ key: p.key, result: { status: [], mesh: null, metrics: { volume: 1, area: 0, bbox: [[0, 0, 0], [1, 1, 1]], faces: 6, edges: EDGES.length }, ms: 0 } as BuildResult })),
      mateFace: async () => null,
      mateEnt: async (_k, i, e) => (e === "edge" ? (EDGES[i] ?? null) : e === "vertex" && i < 4 ? { kind: "point", origin: [i, 0, 0], normal: [0, 0, 1] } : null),
      cylFace: async () => -1,
      geo: new Map(),
      faceLists: new Map(),
      stack: [],
    };
    const deska = partComponent({ ...emptyDoc("Deska A"), kind: "part", features: [] }, {}, {} as never);
    const doc: CadDoc = { ...emptyAssembly("Sestava A"), components: [{ ...deska, id: "deska", fixed: true }] };
    const rows = await compEnts(doc, "deska", "edge", env);
    expect(rows.map((r) => r.text)).toEqual(["E1 · hrana – úsečka · [0; 0; 10]–[0; 40; 10]", "E2 · hrana – úsečka · [60; 0; 10]–[60; 40; 10]"]);
    expect(rows[1]).toMatchObject({ leafId: "deska", index: 1, ent: "edge", ref: "E2" });
    const verts = await compEnts(doc, "deska", "vertex", env);
    expect(verts.map((r) => r.ref)).toEqual(["V1", "V2", "V3", "V4"]);
    expect(verts[0].text).toMatch(/^V1 · vrchol · /);
    expect(await compEnts(doc, "jiny", "edge", env)).toEqual([]);
  });

  it("mate.lost u hrany / vrcholu radí výběr téže entity (E… / V…), u plochy beze změny", () => {
    const base = { compId: "deska", face: 10, lost: { kind: "line", origin: [20, 0, 5], normal: [0, 1, 0], why: "none" } } as Mate["b"];
    const doc = (b: Mate["b"]): CadDoc => ({ ...emptyAssembly("Sestava A"), components: [], mates: [{ id: "m1", type: "coincident", a: { compId: "prid", face: 0, ent: "vertex" }, b }] });
    const d1 = doc({ ...base, ent: "edge" });
    expect(mateLostArgs(d1, d1.mates![0])[2]).toBe("vyberte hranu znovu (sestava vazba 1 plocha b E…), nebo vazbu smažte (sestava vazba 1 smazat)");
    const d2 = doc({ ...base, ent: "vertex" });
    expect(mateLostArgs(d2, d2.mates![0])[2]).toBe("vyberte vrchol znovu (sestava vazba 1 plocha b V…), nebo vazbu smažte (sestava vazba 1 smazat)");
    const d3 = doc({ ...base });
    expect(mateLostArgs(d3, d3.mates![0])[2]).toBe("vyberte plochu znovu (sestava vazba 1 plocha b …), nebo vazbu smažte (sestava vazba 1 smazat)");
  });
});

describe("ztracená hrana vazby se skutečným jádrem (CLI / konzole)", async () => {
  const WASM = path.resolve(__dirname, "../../node_modules/replicad-opencascadejs/dist/replicad_single.wasm");
  const FONTS = path.resolve(__dirname, "../../public/fonts");
  setHostAssets({ font: async (name) => new Uint8Array(fs.readFileSync(path.join(FONTS, name))).buffer });
  const { inProcessTransport } = await import("./kernel-inprocess");
  const kernel = makeKernelClient(inProcessTransport({ locateFile: (file) => (file.endsWith(".wasm") ? WASM : file) }));
  await kernel.init();
  const hostOf = (): EngineHost => ({ kernel, files: memoryFileSink(), inputs: memoryFileSource({}), now: () => Date.now() });

  it("hrana schodu zmizí → ✗ mate.lost „vyberte hranu znovu“, ztracená E11 se NEpřipojí na novou E11; oprava E2 → vazba ok", async () => {
    const ws = new MemoryWorkspace();
    const host = hostOf();
    const r1 = formatConsole(await runScript(ws, SETUP, host));
    expect(r1).toMatch(/✓ vazba Shodně „Přidržovač“ V1 → „Deska A“ E11: ok/);
    const r2 = formatConsole(await runScript(ws, EDIT, host));
    expect(r2).toMatch(/✗ řádek 3: vazba 1 Shodně „Přidržovač“ V1 → „Deska A“ E11 – ztracená reference B E11 dílu „Deska A“ \(hrana – úsečka · \[20; 0; 5\]–\[20; 40; 5\]\)[^\n]*vyberte hranu znovu \(sestava vazba 1 plocha b E…\)/);
    expect(r2).not.toMatch(/vazby 1\/1 ok/);
    const r3 = formatConsole(await runScript(ws, "sestava vazba 1 plocha b E2\nsestava vazby", host));
    expect(r3).toMatch(/plocha B E11 → E2/);
    expect(r3).toMatch(/Vazby sestavy „Sestava A“: 1 \(1 ok\)/);
  });
});
