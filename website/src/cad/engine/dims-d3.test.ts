/**
 * Vlna 22, bod 18 – etapa D3 v enginu se skutečným jádrem in-process (stejná cesta jako CLI / `mncad serve` / konzole):
 *  * pomocné řezné těleso (`sloučit … odebrat`) se nekótuje, okno a jeho poloha ano; řádek „Kontrola kót“ bez „všech“;
 *  * výkres bez poloh děr → ⚠ drawing.dims-incomplete ve `výkres stav` a při exportu (`výkres export pdf`, `--formats`);
 *  * `výkres doplnit kóty` přidá navržené kóty (polohy od hrany, „2× Ø8“) a kontrola pak chybějící nevypíše;
 *  * `funkční F…` změří plochu jádrem, válcová plocha díry = prvek díra; `základna A F…`; `funkční` = výpis; skript z dokumentu;
 *  * EN / DE příkazy.
 * Repro: S/w22/repro/18 (repro.txt, repro-b.txt), korpus `__corpus__/79-dims-complete.txt`.
 */
import fs from "node:fs";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { docToScript } from "../doc-script";
import { setHostAssets } from "../host-assets";
import { setLang } from "../i18n";
import { makeKernelClient } from "../kernel-client";
import type { CadDoc } from "../types";
import { memoryFileSink, memoryFileSource, type EngineHost } from "./host";
import { MemoryWorkspace } from "./memory-workspace";
import { formatConsole } from "./protocol";
import type { RunReport } from "./protocol-types";
import { runScript } from "./run";
import { clearDrawingMemo } from "./sheet-eval";

const WASM = path.resolve(__dirname, "../../../node_modules/replicad-opencascadejs/dist/replicad_single.wasm");
const FONTS = path.resolve(__dirname, "../../../public/fonts");

const codes = (r: RunReport, code: string) => r.entries.filter((e) => e.code === code);
const statusLine = (r: RunReport) => formatConsole(r).split("\n").filter((l) => l.includes("Kontrola kót:"));

/** repro A (bod 18): okno vyříznuté pomocným tělesem „Nástroj“, dvě díry Ø8 na různých místech */
const REPRO_A = [
  'nový díl "Deska A"',
  "kvádr 100 60 20",
  "kvádr 30 20 40 v 35 20 -10 nové těleso Nástroj",
  "sloučit 1 Nástroj odebrat",
  "díra 8 skrz v 15 15 20 těleso 1",
  "díra 8 skrz v 85 45 20 těleso 1",
  "výkres A3 na šířku pohledy přední,horní",
  "výkres nepředepsané ISO 2768-mK",
  "kótovat",
].join("\n");
/** repro B: tři díry, ručně jen 100, 60, 20, Ø8, Ø12 a „10“ na hraně – žádná poloha díry */
const REPRO_B = [
  'nový díl "Deska B"',
  "kvádr 100 60 20",
  "díra 8 skrz v 15 15 20",
  "díra 8 skrz v 85 45 20",
  "díra 12 hloubka 10 v 50 30 20",
  "výkres A3 na šířku pohledy přední,horní",
  "výkres nepředepsané ISO 2768-mK",
  "výkres smazat vše",
  "výkres kóta vodorovně pohled horní 0 0 100 0",
  "výkres kóta svisle pohled horní 0 0 0 60",
  "výkres kóta svisle pohled přední 0 0 0 20",
  "výkres kóta průměr pohled horní střed 15 15 r 4",
  "výkres kóta průměr pohled horní střed 50 30 r 6",
  "výkres kóta svisle pohled přední 100 10 100 20",
].join("\n");

describe("bod 18 (kontrola kót pro výrobu) – engine se skutečným jádrem", async () => {
  setHostAssets({ font: async (name) => new Uint8Array(fs.readFileSync(path.join(FONTS, name))).buffer });
  const { inProcessTransport } = await import("../kernel-inprocess");
  const kernel = makeKernelClient(inProcessTransport({ locateFile: (file) => (file.endsWith(".wasm") ? WASM : file) }));
  await kernel.init();
  const hostOf = (): EngineHost & { files: ReturnType<typeof memoryFileSink> } => ({ kernel, files: memoryFileSink(), inputs: memoryFileSource({}), now: () => Date.now() });
  const docOf = (ws: MemoryWorkspace, name: string): CadDoc => {
    const t = ws.tabs().find((x) => x.title === name)!;
    return ws.docOf!(t.id)!;
  };
  afterEach(() => {
    setLang("cs");
    clearDrawingMemo();
  });

  it("repro A: výška nástroje 40 se neočekává, okno a polohy ano; Chytré kóty splní velikosti i polohy; bez „všech“", async () => {
    const ws = new MemoryWorkspace();
    const r = await runScript(ws, `${REPRO_A}\nvýkres stav`, hostOf());
    const line = statusLine(r).join("\n");
    expect(line).not.toContain("40 (Kvádr 2)");
    expect(line).toMatch(/Kontrola kót: velikosti (\d+)\/\1 · polohy (\d+)\/\2 · pomocná tělesa \(nekótují se\): Nástroj \(odebráno\)/);
    expect(line).not.toMatch(/všech|kompletní/);
    expect(codes(r, "drawing.dims-incomplete")).toEqual([]);
    expect(formatConsole(r)).toMatch(/Polohy děr: .* – na listu (\d+)\/\1/);
  }, 240_000);

  it("repro A po smazání kót: ⚠ drawing.dims-incomplete na řádku výkres stav, polohy 0/6, Ø8 jen 1× z 2×", async () => {
    const ws = new MemoryWorkspace();
    const r = await runScript(ws, `${REPRO_A}\nvýkres smazat vše\nvýkres kóta vodorovně pohled horní 0 0 100 0\nvýkres kóta svisle pohled horní 0 0 0 60\nvýkres kóta svisle pohled přední 0 0 0 20\nvýkres kóta vodorovně pohled horní 35 20 65 20\nvýkres kóta průměr pohled horní střed 15 15 r 4\nvýkres stav`, hostOf());
    const w = codes(r, "drawing.dims-incomplete");
    expect(w.length).toBeGreaterThanOrEqual(1);
    expect(w[0].level).toBe("warn");
    expect(w[0].text).toMatch(/^list List 1: kóty neúplné – chybí \d+ \(velikosti \d+\/6, polohy 0\/6\)/);
    expect(statusLine(r).join("\n")).toContain("2× Ø8 skrz (Díra 1, Díra 2) – na listu 1× z 2×");
  }, 240_000);

  it("repro B: libovolná „10“ hloubku díry nesplní; ⚠ i při výkres export pdf; konec běhu hlášku neopakuje", async () => {
    const ws = new MemoryWorkspace();
    const host = hostOf();
    const r = await runScript(ws, `${REPRO_B}\nvýkres stav\nvýkres export pdf`, host);
    expect(statusLine(r).join("\n")).toContain("10 (hloubka díry) (Díra 3)");
    const w = codes(r, "drawing.dims-incomplete");
    const lines = REPRO_B.split("\n").length;
    expect(w.map((e) => e.line)).toEqual([lines + 1, lines + 2]);
  }, 240_000);

  it("výkres doplnit kóty: navržené polohy od hran a „2× Ø8“ – potom žádné chybějící položky", async () => {
    const ws = new MemoryWorkspace();
    const r = await runScript(ws, `${REPRO_A}\nvýkres smazat vše\nvýkres doplnit kóty\nvýkres kontrola kót`, hostOf());
    const txt = formatConsole(r);
    expect(txt).toMatch(/✓ doplněno kót: \d+ – /);
    const chk = txt.split("\n").filter((l) => l.includes("Kontrola kót:")).pop()!;
    expect(chk).not.toContain("chybí");
    expect(chk).toMatch(/velikosti (\d+)\/\1 · polohy (\d+)\/\2/);
  }, 240_000);

  it("funkční F (válcová plocha díry) = díra; základna A F (rovina); výpis; bez tolerance ⚠ drawing.tolerance-missing; skript z dokumentu", async () => {
    const ws = new MemoryWorkspace();
    const host = hostOf();
    await runScript(ws, REPRO_A, host);
    // plochu díry najde měření (měřit díry) – číslo plochy z protokolu
    const m = formatConsole(await runScript(ws, 'záložka "Deska A"\nměřit díry', host));
    const face = /\bD1\b.*?\bF(\d+)/.exec(m)?.[1];
    expect(face).toBeTruthy();
    const r = await runScript(ws, `záložka "Deska A"\nfunkční F${face} H7\nzákladna A F1\nfunkční\nvýkres stav`, host);
    const txt = formatConsole(r);
    expect(txt).toMatch(/✓ funkční Díra [12] · tolerance H7/);
    expect(txt).toMatch(/Funkční prvky a základny \(2\):/);
    const d = docOf(ws, "Deska A");
    expect(d.functional?.map((x) => x.kind)).toEqual(["functional", "datum"]);
    expect(d.functional?.[0].feature).toBeTruthy();
    expect(codes(r, "drawing.tolerance-missing").length).toBeGreaterThanOrEqual(1);
    expect(statusLine(r).join("\n")).toMatch(/funkční prvky: tolerance 0\/\d+/);
    // skript z dokumentu nese funkční prvek i základnu
    const s = docToScript(d).text;
    expect(s).toMatch(/^funkční "Díra [12]" H7$/m);
    expect(s).toMatch(/^funkční základna A F1$/m);
  }, 240_000);

  it("EN / DE: functional datum, drawing check dims / zeichnung prüfen maße", async () => {
    const ws = new MemoryWorkspace();
    const host = hostOf();
    setLang("en");
    const en = await runScript(ws, `${REPRO_A}\nfunctional datum A F1\ndrawing check dims`, host);
    expect(formatConsole(en)).toMatch(/Dimension check: sizes \d+\/\d+ · positions \d+\/\d+/);
    expect(formatConsole(en)).toMatch(/✓ datum A = F1/);
    setLang("de");
    const de = await runScript(ws, 'tab "Deska A"\nzeichnung prüfen maße', host);
    expect(formatConsole(de)).toMatch(/Maßprüfung: Größen \d+\/\d+ · Lagen \d+\/\d+/);
  }, 240_000);
});
