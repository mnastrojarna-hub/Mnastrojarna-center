/**
 * Nálezy brány B6 se skutečným jádrem in-process (scripts/cad-acceptance.mjs, zkouška 959):
 * * obálka sestavy přesně – natočený díl (45° kolem Z) změřený jádrem, ne rohy jeho lokální obálky – v řádku D CLI
 *   (`summarize`), v `= status` i v konzoli `stav`;
 * * sestava otevřená celá (JSON / `--open`): ⚠ prvků dílů jejích komponent jdou do protokolu (CLI `summarize`), jednou
 *   na díl a prvek, i když je díl ve více komponentách;
 * * pohybová studie = jeden strojový řádek `= … asm "<sestava>" motion …` se zdvihem tuhé skupiny; konzole beze změny.
 */
import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { setHostAssets } from "../host-assets";
import { makeKernelClient } from "../kernel-client";
import { summarize } from "../cli/job";
import { memoryFileSink, memoryFileSource, type EngineHost } from "./host";
import { MemoryWorkspace } from "./memory-workspace";
import { docLine, formatConsole, formatShort, ReportBuilder } from "./protocol";
import { runScript } from "./run";

const WASM = path.resolve(__dirname, "../../../node_modules/replicad-opencascadejs/dist/replicad_single.wasm");
const FONTS = path.resolve(__dirname, "../../../public/fonts");

describe("brána B6: obálka, díly komponent, pohyb (jádro)", async () => {
  setHostAssets({ font: async (name) => new Uint8Array(fs.readFileSync(path.join(FONTS, name))).buffer });
  const { inProcessTransport } = await import("../kernel-inprocess");
  const kernel = makeKernelClient(inProcessTransport({ locateFile: (file) => (file.endsWith(".wasm") ? WASM : file) }));
  await kernel.init();
  const hostOf = (): EngineHost => ({ kernel, files: memoryFileSink(), inputs: memoryFileSource({}), now: () => Date.now() });

  it("natočený válec Ø20: obálka 20 × 20 × 75 v řádku D, `= status` i konzoli (rohy lokální obálky by daly 28,28)", async () => {
    const ws = new MemoryWorkspace();
    const r = await runScript(ws, `nový díl Čep\nválec 20 75\nnová sestava Natočení\nvložit "Čep" ukotvit\nvložit "Čep" v 100 0 0 otočení 0 0 45\nstav`, hostOf());
    expect(r.counts.errors).toBe(0);
    const st = formatShort(r, { budget: Infinity }).split("\n").find((l) => l.startsWith("= ") && l.includes(" status "))!;
    // obě komponenty: X od −10 do 110, Y −10…10, Z 0…75 – přesně, s natočením o 45° stejně jako bez něj
    expect(st).toMatch(/ bbox=120x20x75 /);
    expect(st.match(/ bbox=/g)).toHaveLength(1);
    expect(formatConsole(r)).toMatch(/obálka 120 × 20 × 75 mm/);
    const d = await summarize(ws.present(), kernel, new ReportBuilder({ lang: "cs", lines: 1 }), true, ws, ws.docKey());
    expect(docLine(d.summary)).toMatch(/ bbox=120x20x75(?: |$)/);
  }, 240_000);

  it("sestava otevřená z JSON: ⚠ prvku dílu komponenty v protokolu jednou (díl ve dvou komponentách)", async () => {
    const ws0 = new MemoryWorkspace();
    // díl s varováním (díra mimo těleso – nic neodebere) ve dvou komponentách; dokument sestavy pak otevřený jako JSON
    const r0 = await runScript(ws0, `nový díl Deska\nkvádr 40 40 10\ndíra 5 skrz v 200 200 10\nnová sestava S\nvložit "Deska" ukotvit\nvložit "Deska" v 100 0 0`, hostOf());
    const warned = r0.entries.filter((e) => e.code === "feature.warning" && e.doc === "Deska");
    expect(warned.length).toBeGreaterThan(0);
    const json = JSON.stringify(ws0.present());
    const ws = new MemoryWorkspace();
    const rb = new ReportBuilder({ lang: "cs", lines: 1 });
    await ws.openInTab(JSON.parse(json));
    const d = await summarize(ws.present(), kernel, rb, true, ws, ws.docKey());
    expect(d.built).toBe(true);
    const fw = rb.entries.filter((e) => e.code === "feature.warning" && e.doc === "Deska");
    expect(fw).toHaveLength(warned.length);
    expect(fw[0].line).toBeNull();
    // co už ohlásil běh skriptu (stejný kód, díl a text), se neopakuje
    const rb2 = new ReportBuilder({ lang: "cs", lines: 1 });
    for (const e of warned) rb2.add(e);
    await summarize(ws.present(), kernel, rb2, true, ws, ws.docKey());
    expect(rb2.entries.filter((e) => e.code === "feature.warning" && e.doc === "Deska")).toHaveLength(warned.length);
  }, 240_000);

  it("pohyb: jeden řádek `= … motion` se zdvihem tuhé skupiny, konzole s rozsahem komponent beze změny", async () => {
    const ws = new MemoryWorkspace();
    const r = await runScript(
      ws,
      `nový díl Vodítko\nkvádr 100 20 10\nnový díl Jezdec\nkvádr 20 20 10\nnová sestava Pohyb\nvložit "Vodítko" ukotvit\nvložit "Jezdec" v 0 0 10\nsestava vazba vzdálenost "Jezdec" -X "Vodítko" -X hodnota 10\npohyb motor lineární vazba 1 10..50 kroky 4`,
      hostOf(),
    );
    expect(r.counts.errors).toBe(0);
    const lines = formatShort(r, { budget: Infinity }).split("\n");
    const mo = lines.filter((l) => / motion steps=/.test(l));
    expect(mo).toHaveLength(1);
    // vlna 22, bod 9: motor (průběh, začátek > konec, směr) na konci řádku
    // vlna 22, bod 2: úroveň simulace na konci řádku (sestava bez pružiny → automaticky kinematika)
    expect(mo[0]).toMatch(/^= L9 asm "Pohyb" motion steps=4 t=2 motors=1 conflicts=0 travel=40mm:1 static=1 m1=range:10>50:\+ level=kin groups=1:x-40:Jezdec$/); // vlna 22, M3: tuhé skupiny na konci; kolo 7, bod 15: + jméno kořene (vědomě upraveno)
    expect(formatConsole(r)).toMatch(/ „Jezdec“: ΔX −40 mm/); // vlna 22, M3: výchozí souhrn po tuhých skupinách (po dílech: pohyb detail)
  }, 240_000);
});
