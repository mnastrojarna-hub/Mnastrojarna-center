/**
 * Vlna 22, fáze 2, kolo 4 (track a): Ctrl+Z / `zpět` hned po exportu nesmí smazat záznam exportu – soubor na disku existuje.
 * Dřív: export z menu zapsal záznam jen do současného stavu (liveWith), Zpět vrátil předchozí stav bez záznamu → seznam
 * Exporty / Zastaralé výstupy soubor neukazoval („žádné exporty“ = falešná čistota); `zpět` v CLI totéž s krokem běhu.
 * Pravidlo a jeho výjimky: cad/history-outputs.ts.
 */
import fs from "node:fs";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { histStep } from "./agent-edit";
import { exportState, modelId, recordExport, staleExports } from "./doc-outputs";
import { carryOutputs, recordOutsideHistory, undoKeepOutputs, type OutHist } from "./history-outputs";
import { setHostAssets } from "./host-assets";
import { setLang } from "./i18n";
import { makeKernelClient } from "./kernel-client";
import { memoryFileSink, memoryFileSource, type EngineHost } from "./engine/host";
import { MemoryWorkspace } from "./engine/memory-workspace";
import { formatConsole } from "./engine/protocol";
import { runScript } from "./engine/run";
import { emptyDoc, type CadDoc, type Feature } from "./types";

const box = (id: string, x: number): Feature => ({ id, name: `Kvádr ${id}`, type: "box", size: [x, 40, 10] }) as unknown as Feature;
const part = (x: number): CadDoc => ({ ...emptyDoc(), name: "Deska A", features: [box("k1", x)] });
const rec = (d: CadDoc, file: string, at: string) => recordExport(d, { what: "model", format: "step", file, at });

describe("záznam exportu a krok Zpět (čisté funkce)", () => {
  it("Ctrl+Z hned po exportu z menu: záznam zůstane, Ctrl+Y ho nesmaže (padá na starém liveWith + past[-1])", () => {
    const d0 = part(60);
    const d1 = part(50); // krok: změna rozměru
    let h: OutHist = { past: [d0], present: d1, future: [] };
    h = recordOutsideHistory(h, (d) => rec(d, "Deska_A.step", "2026-11-26T10:00:00.000Z").doc); // export po doběhnutí úlohy
    const id = h.present.outputs![0].id;
    // staré chování: Zpět = past[-1] → bez záznamu
    expect(h.past[0].outputs ?? []).toEqual([]);
    const u = undoKeepOutputs(h);
    expect(u.present.outputs?.map((r) => r.id)).toEqual([id]);
    expect(u.present.features).toBe(d0.features); // model se vrátil
    // poctivý stav: soubor je z modelu 50 × 40, model je teď 60 × 40 → ZASTARALÝ, ne „odpovídá“ ani „žádné“
    expect(exportState(u.present, u.present.outputs![0])).toBe("stale");
    expect(staleExports(u.present).map((r) => r.file)).toEqual(["Deska_A.step"]);
    // Ctrl+Y: zpět na model 50 × 40 se záznamem, který mu odpovídá
    const r = histStep(u, "redo", 1).hist;
    expect(r.present.outputs?.map((x) => x.id)).toEqual([id]);
    expect(exportState(r.present, r.present.outputs![0])).toBe("current");
  });

  it("export ve vráceném stavu: záznam se přidá i do stavů Znovu (Ctrl+Y ho nesmaže)", () => {
    const d0 = part(60);
    const d1 = part(50);
    let h: OutHist = undoKeepOutputs({ past: [d0], present: d1, future: [] });
    h = recordOutsideHistory(h, (d) => rec(d, "Stary.step", "2026-11-26T10:00:00.000Z").doc);
    const r = histStep(h, "redo", 1).hist;
    expect(r.present.outputs?.map((x) => x.file)).toEqual(["Stary.step"]);
  });

  it("`exporty vymazat` jako krok: Zpět vrátí vymazaný seznam, Znovu ho znovu vymaže", () => {
    const d0 = rec(part(60), "A.step", "2026-11-26T10:00:00.000Z").doc;
    const cleared: CadDoc = { ...d0, outputs: [] };
    const h: OutHist = { past: [d0], present: cleared, future: [] };
    const u = undoKeepOutputs(h);
    expect(u.present.outputs?.map((x) => x.file)).toEqual(["A.step"]);
    const r = histStep(u, "redo", 1).hist;
    expect(r.present.outputs).toEqual([]);
  });

  it("stejný formát + soubor: novější záznam nahradí starší i při přenosu; beze změny týž objekt", () => {
    const a = rec(part(60), "A.step", "2026-11-26T10:00:00.000Z").doc;
    const b = rec(a, "A.step", "2026-11-26T11:00:00.000Z").doc;
    const t = carryOutputs(a, b);
    expect(t.outputs?.map((x) => x.at)).toEqual(["2026-11-26T11:00:00.000Z"]);
    expect(carryOutputs(b, b)).toBe(b);
    const plain = part(60);
    expect(carryOutputs(plain, part(50))).toBe(plain);
  });

  it("histStep s přenosem (text `zpět` v prohlížeči) = Ctrl+Z; bez přenosu původní chování (obecné T)", () => {
    const d0 = part(60);
    const d1 = rec(part(50), "A.step", "2026-11-26T10:00:00.000Z").doc;
    const h = { past: [d0], present: d1, future: [] as CadDoc[] };
    expect(histStep(h, "undo", 1, carryOutputs).hist.present.outputs?.map((x) => x.file)).toEqual(["A.step"]);
    expect(histStep(h, "undo", 1).hist.present).toBe(d0);
    expect(histStep(h, "undo", 1, carryOutputs).hist).toEqual(undoKeepOutputs(h));
  });

  it("CLI pracovní prostor: zpět po kroku se záznamem exportu záznam drží (MemoryWorkspace.undo)", async () => {
    const ws = new MemoryWorkspace();
    ws.commit(part(60));
    ws.commit(rec(part(50), "A.step", "2026-11-26T10:00:00.000Z").doc);
    expect(ws.undo(1)).toEqual({ moved: 1 });
    const now = ws.present();
    expect(now.outputs?.map((x) => x.file)).toEqual(["A.step"]);
    expect(modelId(now).rev).not.toBe(now.outputs![0].modelRev); // záznam nese revizi exportovaného modelu
  });
});

describe("záznam exportu a `zpět` v enginu se skutečným jádrem (CLI / konzole)", async () => {
  const WASM = path.resolve(__dirname, "../../node_modules/replicad-opencascadejs/dist/replicad_single.wasm");
  const FONTS = path.resolve(__dirname, "../../public/fonts");
  setHostAssets({ font: async (name) => new Uint8Array(fs.readFileSync(path.join(FONTS, name))).buffer });
  const { inProcessTransport } = await import("./kernel-inprocess");
  const kernel = makeKernelClient(inProcessTransport({ locateFile: (file) => (file.endsWith(".wasm") ? WASM : file) }));
  await kernel.init();
  const hostOf = (): EngineHost => ({ kernel, files: memoryFileSink(), inputs: memoryFileSource({}), now: () => Date.now() });
  afterEach(() => setLang("cs"));

  it("export step → zpět: `exporty` soubor dál vypisuje (ne „žádné“) a po vrácení změny modelu ho hlásí ZASTARALÝ", async () => {
    const ws = new MemoryWorkspace();
    const host = hostOf();
    await runScript(ws, ['nový díl "Deska A"', "kvádr 60 40 10"].join("\n"), host);
    await runScript(ws, ['upravit "Kvádr 1" size=50;40;10', "export step"].join("\n"), host);
    const before = formatConsole(await runScript(ws, "exporty", host));
    expect(before).toMatch(/STEP „Deska_A\.step“ · z modelu r·[0-9a-f]{6} .*– odpovídá modelu/);
    // zpět o krok běhu (změna rozměru + export): model je zase 60 × 40, soubor 50 × 40 na disku zůstal
    const back = formatConsole(await runScript(ws, "zpět\nexporty\nstav", host));
    expect(back).toMatch(/[→✓] zpět o 1 krok/);
    expect(back).toMatch(/Dokument: „Deska A“/);
    expect(back).toMatch(/STEP „Deska_A\.step“ · z modelu r·[0-9a-f]{6}[^\n]*ZASTARALÝ/);
    expect(back).not.toMatch(/STEP „Deska_A\.step“[^\n]*– odpovídá modelu/);
    expect(back).not.toMatch(/Exporty: žádné|žádný export/);
  });
});
