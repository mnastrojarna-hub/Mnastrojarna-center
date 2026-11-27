/**
 * Vlna 22, bod 7 – pružina po načtení dokumentu (skutečné jádro in-process, jako engine/acceptance-kernel.test.ts).
 * Repro: sestava s pružinou 25 mm mezi Přidržovačem a Deskou A; externí úprava JSON posune Desku A o 10 mm níž (ZDVIH 47,5) a
 * `spring.length` nechá 25. Dřív: `stav` „„Pružina“ 25 mm … ✓“, `kolize` ⚠ clash.real „Deska A“ × „Pružina“ 445,6 mm³, exit 0.
 * Nyní: po načtení (řádek JSON i CLI `--open` = `preloaded`) ⚠ spring.stale „uložená délka 25 mm … (15 mm)“, `stav` 15 mm
 * „délka odvozená z dosedacích ploch“, kolize bez průniku pružiny do desky.
 */
import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { setHostAssets } from "../host-assets";
import { makeKernelClient } from "../kernel-client";
import type { CadDoc } from "../types";
import { memoryFileSink, memoryFileSource, type EngineHost } from "./host";
import { MemoryWorkspace } from "./memory-workspace";
import { formatConsole } from "./protocol";
import { springsCount } from "./kv";
import { runScript } from "./run";
import { verifyKeyOf } from "./verify";

const WASM = path.resolve(__dirname, "../../../node_modules/replicad-opencascadejs/dist/replicad_single.wasm");
const FONTS = path.resolve(__dirname, "../../../public/fonts");

/** sestava repro bodu 7 (neutrální názvy): Rám, Deska A na ZDVIH 57,5, Přidržovač v Mezi, Pružina mezi Přidržovačem a Deskou A */
const BUILD = [
  'nový díl "Rám"',
  "kvádr 100 100 10",
  'nový díl "Deska A"',
  "kvádr 100 100 10",
  'nový díl "Přidržovač"',
  "kvádr 60 60 8",
  'nový díl "Pružina"',
  "pružina 18 stoupání 5 závity 6 drát 2",
  'nová sestava "Mechanika"',
  'vložit "Rám" ukotvit',
  'vložit "Deska A" v 0 0 67.5',
  'vložit "Přidržovač" v 20 20 34.5',
  'vložit "Pružina" v 50 50 42.5',
  'sestava vazba vzdálenost "Deska A" spodní "Rám" horní hodnota 57.5 název "ZDVIH"',
  'sestava vazba mez-vzdálenosti "Přidržovač" horní "Deska A" spodní min 5 max 25 název "Mez"',
  'sestava vazba zámek "Pružina" "Přidržovač"',
  'sestava pružina "Pružina" mezi "Přidržovač" "Deska A" volná 32 blok 14 tuhost 20',
];

/** externí úprava: Deska A o 10 mm níž, ZDVIH 47,5, uložená délka pružiny ponechána */
function edited(doc: CadDoc): CadDoc {
  const d = JSON.parse(JSON.stringify(doc)) as CadDoc;
  for (const c of d.components ?? []) if (c.name === "Deska A") c.placement.position[2] = 57.5;
  for (const m of d.mates ?? []) if (m.name === "ZDVIH") m.value = 47.5;
  return d;
}

describe("bod 7: pružina po načtení dokumentu – délka z dosedacích ploch (jádro)", async () => {
  setHostAssets({ font: async (name) => new Uint8Array(fs.readFileSync(path.join(FONTS, name))).buffer });
  const { inProcessTransport } = await import("../kernel-inprocess");
  const kernel = makeKernelClient(inProcessTransport({ locateFile: (file) => (file.endsWith(".wasm") ? WASM : file) }));
  await kernel.init();
  const hostOf = (): EngineHost => ({ kernel, files: memoryFileSink(), inputs: memoryFileSource({}), now: () => Date.now() });

  let built: CadDoc;
  it("sestava: pružina 25 mm podle dosedacích ploch", async () => {
    const ws = new MemoryWorkspace();
    const r = await runScript(ws, BUILD.join("\n"), hostOf());
    expect(r.counts.errors).toBe(0);
    built = ws.present();
    expect(built.components!.find((c) => c.name === "Pružina")!.spring!.length).toBeCloseTo(25, 3);
  }, 240_000);

  it("řádek JSON: ⚠ spring.stale (25 × 15 mm), stav 15 mm z ploch, kolize bez průniku pružiny", async () => {
    const ws = new MemoryWorkspace();
    const r = await runScript(ws, `${JSON.stringify(edited(built))}\nstav\nkolize`, hostOf());
    const stale = r.entries.filter((e) => e.code === "spring.stale");
    expect(stale).toHaveLength(1);
    expect(stale[0].line).toBe(1);
    expect(stale[0].text).toMatch(/pružina „Pružina“: uložená délka 25 mm neodpovídá dosedacím plochám \(15 mm\)/);
    const con = formatConsole(r);
    expect(con).toMatch(/Pružiny: „Pružina“ 15 mm \(L0 32 · Ln 14\) · F 340 N ✓ – délka odvozená z dosedacích ploch/);
    expect(con).not.toMatch(/Pružiny: „Pružina“ 25 mm/);
    expect(r.entries.some((e) => e.code === "clash.real" && /Pružina/.test(e.text))).toBe(false);
    expect(ws.present().components!.find((c) => c.name === "Pružina")!.spring!.length).toBeCloseTo(15, 3);
  }, 240_000);

  it("CLI --open (preloaded): totéž před skriptem (řádek načtení L-)", async () => {
    const ws = new MemoryWorkspace();
    await ws.openInTab(edited(built));
    const r = await runScript(ws, "stav", hostOf(), { preloaded: [{ key: verifyKeyOf(ws.docKey(), ws.present()), doc: ws.present() }] });
    const stale = r.entries.filter((e) => e.code === "spring.stale");
    expect(stale).toHaveLength(1);
    expect(stale[0].line).toBeNull();
    expect(formatConsole(r)).toMatch(/„Pružina“ 15 mm .* – délka odvozená z dosedacích ploch/);
  }, 240_000);

  it("dosedací plocha, kterou díl nemá (vnější úprava, plocha 99): ⚠ spring.lost při načtení i při `stav`, springs.lost=1, --strict STOP (kolo 6)", async () => {
    // dřív: otevření bez ⚠, řádek D bez springs.lost, `stav` „uložená délka, s dosedacími plochami nezkontrolováno“ a pak jen ⚠ clash.real
    const lostDoc = JSON.parse(JSON.stringify(built)) as CadDoc;
    for (const c of lostDoc.components ?? []) if (c.spring) c.spring.b.face = 99;
    const ws = new MemoryWorkspace();
    // `stav` uprostřed skriptu (poslední `stav` vypíše závěrečný stav běhu – D a hlavička nesou springs.lost / ⚠ z načtení)
    const r = await runScript(ws, `${JSON.stringify(lostDoc)}\nstav\nkolize`, hostOf());
    const lost = r.entries.filter((e) => e.code === "spring.lost");
    // tentýž text na řádku načtení (1) i `stav` (2) = jeden záznam ×2 (protokol slučuje opakované záznamy)
    expect(lost[0].line).toBe(1);
    expect(lost.reduce((n, e) => n + (e.count ?? 1), 0)).toBe(2);
    expect(lost[0].level).toBe("warn");
    expect(lost[0].text).toMatch(/pružina „Pružina“: ztracená dosedací plocha B F100 \(„Deska A“\) – délka a síla nezkontrolovány; oprava: sestava pružina "Pružina" mezi "Přidržovač" F6 "Deska A" <plocha>/);
    expect(ws.present().components!.find((c) => c.name === "Pružina")!.spring!.b.lost).toBeTruthy();
    expect(springsCount(ws.present())).toEqual({ total: 1, lost: 1 }); // = springs.lost=1 v řádku D, = status a Σ
    // přísný režim zastaví (dřív exit 0)
    const ws2 = new MemoryWorkspace();
    await ws2.openInTab(lostDoc);
    const st = await runScript(ws2, "stav", hostOf(), { strict: true, preloaded: [{ key: verifyKeyOf(ws2.docKey(), ws2.present()), doc: ws2.present() }] });
    expect(st.entries.some((e) => e.code === "spring.lost")).toBe(true);
    expect(st.stopped).toBeTruthy();
  }, 240_000);

  it("STEP po načtení: pružina v souboru má délku z dosedacích ploch (15 mm), ne uloženou 25 mm; kolize s ní v neověřené délce řekne proč (kolo 7)", async () => {
    // dřív bez testu (CAD-M1-OPRAVY, bod 7 „Co zbývá“): geometrie pružiny ve STEP po načtení. Výška dílu „Pružina“ v souboru
    // (rozdělení STEP na díly jádrem, obálka znovu načteného dílu) = délka v sestavě + drát; uložená 25 mm by dala ~27 mm
    const zOf = async (doc: CadDoc) => {
      const host = hostOf();
      const ws = new MemoryWorkspace();
      const r = await runScript(ws, `${JSON.stringify(doc)}\nexport step "m"`, host);
      expect(r.counts.errors).toBe(0);
      const f = [...(host.files as ReturnType<typeof memoryFileSink>).files.values()].find((x) => x.file.format === "step")!;
      const split = await kernel.stepSplit(f.data, "m.step");
      // výrobky bez jmen (zapisovač OCCT): 4. výskyt kořenové sestavy = 4. komponenta „Pružina“ (pořadí komponent dokumentu)
      expect(split!.nodes[0].children).toHaveLength(4);
      const part = split!.parts.find((p) => p.pd === split!.nodes[0].children[3].pd)!;
      expect(part).toBeTruthy();
      const st = await kernel.exportStats(doc, part.bytes, "step");
      return st.file.bbox[1][2] - st.file.bbox[0][2];
    };
    const hOpen = await zOf(edited(built));
    const hBuilt = await zOf(built);
    expect(hBuilt).toBeGreaterThan(24);
    expect(hOpen).toBeLessThan(18);
    expect(hOpen).toBeGreaterThan(14);
    // kolize s pružinou, které chybí dosedací plocha: text dvojice řekne, že pružina stojí v neověřené délce
    const lostDoc = JSON.parse(JSON.stringify(edited(built))) as CadDoc;
    for (const c of lostDoc.components ?? []) if (c.spring) c.spring.b.face = 99;
    const r = await runScript(new MemoryWorkspace(), `${JSON.stringify(lostDoc)}\nkolize`, hostOf());
    const hit = r.entries.find((e) => e.code === "clash.real" && /Pružina/.test(e.text));
    expect(hit?.text).toMatch(/pružina „Pružina“ v neověřené délce \(ztracená dosedací plocha – spring\.lost\)/);
  }, 300_000);

  it("dokument, jehož délka plochám odpovídá: žádné ⚠ spring.stale", async () => {
    const ws = new MemoryWorkspace();
    const r = await runScript(ws, `${JSON.stringify(built)}\nstav`, hostOf());
    expect(r.entries.filter((e) => e.code === "spring.stale")).toEqual([]);
  }, 240_000);
});
