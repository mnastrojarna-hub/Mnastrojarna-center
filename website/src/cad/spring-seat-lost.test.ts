/**
 * Vlna 22, bod 20 – pružinová část (fáze 2, kolo 4, balík M): dosedací plocha pružiny po změně dílu. Skutečné jádro, běh skriptu
 * jako CLI. Repro: Deska A se schodem (F3 = schod +Z v Z = 5, 800 mm²), pružina mezi schodem a spodní plochou Přidržovače, vazba
 * Vzdálenost Přidržovač F5 → Deska A F3; schod zmizí (smazán prvek „Kvádr 2“).
 *
 *  * `sestava hotovo` (GUI „Zpět do sestavy“): dřív ✗ mate.lost pružiny jen v protokolu – výpis vazeb (`sestava vazby`) o pružině mlčel,
 *    `sestava pružiny` psala obecné „délku nešlo určit (chybí geometrie)“ a `stav` uloženou délku 25 mm · F 10 N.
 *  * `sestava obnovit` (GUI „Obnovit z dílu“, `přepočítat vše`): dřív FALEŠNĚ ZELENÁ – plocha vazby se brala „nejbližší“ (vazba „1 ok“
 *    na boční ploše −Y, Přidržovač otočený ∠[90; 0; 0] na [5; −25; 30]) a dosedací plochy pružin se neprověřily vůbec (pružina dál
 *    ukazovala na „F3“, teď jinou plochu). Teď táž funkce jako `sestava hotovo` (`remapAsmRefs`): ztracená reference, nic se nepohne.
 *  * oprava textem (`sestava vazba 1 plocha b F6`, `sestava pružina … mezi … F6 … F5`) vrátí ✓ jen s novými plochami.
 * GUI (seznam vazeb `data-mate-spring`, panel pružiny `data-asm-spring-lost`) je v e2e `cad-w22-m.e2e.cjs` (kolo 4).
 */
import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { setHostAssets } from "./host-assets";
import { makeKernelClient } from "./kernel-client";
import { memoryFileSink, memoryFileSource, type EngineHost } from "./engine/host";
import { MemoryWorkspace } from "./engine/memory-workspace";
import { formatFull, shortProtocol } from "./engine/protocol";
import { runScript } from "./engine/run";
import { runReport } from "./engine/run-protocol";
import { setLang } from "./i18n";
import { lostSpringComps, springFixCmd, springLostSideTexts, springRemoveCmd, withoutSpringOf } from "./spring-lost";
import type { CadDoc } from "./types";

const WASM = path.resolve(__dirname, "../../node_modules/replicad-opencascadejs/dist/replicad_single.wasm");
const FONTS = path.resolve(__dirname, "../../public/fonts");

const BASE = [
  'nový díl "Deska A"',
  "kvádr 60 40 10",
  "kvádr 20 40 5 v 0 0 5 odebrat",
  'nový díl "Přidržovač"',
  "kvádr 10 10 10",
  'nový díl "Pružina"',
  "pružina tlačná d 1 De 8 L0 30 n 6 konce broušené",
  'nová sestava "Sestava A"',
  'vložit "Deska A" ukotvit',
  'vložit "Přidržovač" v 5 15 30',
  'vložit "Pružina" v 10 20 5',
  'sestava vazba vzdálenost "Přidržovač" F5 "Deska A" F3 hodnota 25',
  'sestava pružina "Pružina" mezi "Deska A" F3 "Přidržovač" F5 volná 30 blok 8 tuhost 2',
];
const LOST_PRINT = "A F3 dílu „Deska A“ (rovinná +Z · střed [10; 20; 5] · 800 mm²) po úpravě dílu neexistuje";
const FIX = 'sestava pružina "Pružina" mezi "Deska A" <plocha> "Přidržovač" F5 | sestava pružina "Pružina" odebrat';
/** výstup jednoho řádku protokolu (blok `= Lnn …` s odsazenými řádky) */
const block = (full: string, line: number) => {
  const rows = full.split("\n");
  const i = rows.findIndex((l) => l.startsWith(`= L${line} `));
  if (i < 0) return "";
  const out = [rows[i]];
  for (const l of rows.slice(i + 1)) {
    if (!l.startsWith("  ")) break;
    out.push(l);
  }
  return out.join("\n");
};

describe("ztracená dosedací plocha pružiny po změně dílu (skutečné jádro)", async () => {
  setHostAssets({ font: async (name) => new Uint8Array(fs.readFileSync(path.join(FONTS, name))).buffer });
  const { inProcessTransport } = await import("./kernel-inprocess");
  const kernel = makeKernelClient(inProcessTransport({ locateFile: (file) => (file.endsWith(".wasm") ? WASM : file) }));
  await kernel.init();
  const host = (): EngineHost => ({ kernel, files: memoryFileSink(), inputs: memoryFileSource({}), now: () => Date.now() });
  const run = async (lines: string[]) => {
    const ws = new MemoryWorkspace();
    const r = await runScript(ws, lines.join("\n"), host());
    return { r, full: formatFull(r), ws };
  };

  it("sestava hotovo: výpis vazeb ukáže pružinu se ztracenou dosedací plochou, sestava pružiny a stav bez délky a bez ✓", async () => {
    const n = BASE.length;
    const { full } = await run([...BASE, 'sestava upravit "Deska A"', 'smazat "Kvádr 2"', "sestava hotovo", "sestava vazby", "sestava pružiny", "stav"]);
    // ✗ mate.lost pružiny: otisk plochy a příkaz opravy s platnou stranou (F5), ne zástupné „"A" <plocha> "B" <plocha>“
    expect(full).toContain(`✗ L${n + 3} mate.lost "Sestava A": pružina „Pružina“ „Deska A“ F3 → „Přidržovač“ F5 – ztracená reference: ${LOST_PRINT} – ${FIX}; délka pružiny se z ní nepočítá`);
    expect(full).toMatch(/· ztracené reference: 2 – stav vazeb níže/); // strana vazby + dosedací plocha pružiny
    const mates = block(full, n + 4);
    expect(mates).toContain("Vazby sestavy „Sestava A“: 1 (1 ztracená reference) · pružiny se ztracenou dosedací plochou: 1");
    expect(mates).toContain(`  pružina „Pružina“ „Deska A“ F3 → „Přidržovač“ F5 – ztracená reference: ${LOST_PRINT} – ${FIX}`);
    expect(full).toContain(`⚠ L${n + 5} msg.warn "Sestava A": pružina „Pružina“ – ztracená dosedací plocha A F3 („Deska A“): délka a síla nezkontrolovány – ${FIX}`);
    expect(full).not.toMatch(/délku nešlo určit/);
    const st = block(full, n + 6);
    expect(st).toContain(`  Pružiny: „Pružina“ – ztracená dosedací plocha A F3 („Deska A“): délka a síla nezkontrolovány – ${FIX}`);
    expect(st).not.toMatch(/Pružiny: .*(25 mm|F 10 N|✓)/);
  }, 300_000);

  it("sestava obnovit (díl změněn v záložce): ztracená reference jako po sestava hotovo – vazba ani pružina se nepřichytí jinam, nic se nepohne", async () => {
    const n = BASE.length;
    const { full, ws } = await run([...BASE, 'záložka "Deska A"', 'smazat "Kvádr 2"', 'záložka "Sestava A"', 'sestava obnovit "Deska A"', "sestava vazby", "stav"]);
    expect(full).toContain(`✓ L${n + 4} komponenta „Deska A“ obnovena z dílu (geometrie)`);
    expect(full).toMatch(new RegExp(`✗ L${n + 4} mate\\.lost "Sestava A": vazba 1 Vzdálenost „Přidržovač“ F5 → „Deska A“ F3 · 25 mm – ztracená reference B F3 dílu „Deska A“ \\(rovinná \\+Z · střed \\[10; 20; 5\\] · 800 mm²\\) po úpravě dílu neexistuje`));
    expect(full).toContain(`✗ L${n + 4} mate.lost "Sestava A": pružina „Pružina“ „Deska A“ F3 → „Přidržovač“ F5 – ztracená reference: ${LOST_PRINT}`);
    // dřív: „Vazby: 1 (1 ok)“ a Přidržovač [5; -25; 30] ∠[90; 0; 0] (vazba na boční ploše −Y, která má teď číslo F3)
    const st = block(full, n + 6);
    expect(st).toContain("  Komponenty: Deska A [0; 0; 0] ⚓ · Přidržovač [5; 15; 30] · Pružina [10; 20; 5]");
    expect(st).toContain("  Vazby: 1 (1 ztracená reference)");
    expect(st).not.toMatch(/Vazby: 1 \(1 ok\)|∠/);
    expect(block(full, n + 5)).toContain("· pružiny se ztracenou dosedací plochou: 1");
    const asm = ws.listDocs().find((x) => x.doc.name === "Sestava A")?.doc;
    const spring = asm?.components?.find((c) => c.name === "Pružina")?.spring;
    expect(spring?.a).toMatchObject({ face: 2, lost: { kind: "plane", origin: [10, 20, 5], normal: [0, 0, 1], why: "none" } });
    expect(spring?.b.lost).toBeUndefined();
  }, 300_000);

  it("oprava textem: nová plocha vazby a nové dosedací plochy pružiny → ok a ✓ pružina z nových ploch, žádná ztracená reference", async () => {
    const n = BASE.length;
    const { full } = await run([
      ...BASE,
      'záložka "Deska A"',
      'smazat "Kvádr 2"',
      'záložka "Sestava A"',
      'sestava obnovit "Deska A"',
      "sestava vazba 1 plocha b F6",
      'sestava pružina "Pružina" mezi "Deska A" F6 "Přidržovač" F5',
      "sestava vazby",
      "stav",
    ]);
    expect(full).toContain(`✓ L${n + 6} pružina „Pružina“: délka 25 mm · L0 30 · Ln 8 · stlačení 5 mm · síla 10 N (c 2 N/mm)`);
    const mates = block(full, n + 7);
    expect(mates).toContain("Vazby sestavy „Sestava A“: 1 (1 ok)");
    expect(mates).not.toMatch(/ztracen/);
    expect(block(full, n + 8)).toContain("  Pružiny: „Pružina“ 25 mm (L0 30 · Ln 8) · F 10 N ✓ – délka odvozená z dosedacích ploch (řídí polohy komponent)");
  }, 300_000);

  // kolo 5 (oponent): jen pružina, bez vazby – dřív řádky D / = status / Σ / kontrola sestava bez jakékoli značky (`D "Sestava A" asm
  // comp=3 parts=3 V.sum=…`) a po uložení a novém otevření `MNCAD/1 OK … err=0` s čistým řádkem D: agent četl zelenou sestavu
  it("strojové řádky: ztracená dosedací plocha pružiny = springs.lost=1 v = status, D, Σ a kontrola sestava – i po novém otevření dokumentu", async () => {
    const lines = [...BASE.filter((l) => !l.startsWith("sestava vazba")), 'sestava upravit "Deska A"', 'smazat "Kvádr 2"', "sestava hotovo", "kontrola sestava", "stav"];
    const n = lines.length;
    const ws = new MemoryWorkspace();
    const r = await runReport(ws, lines.join("\n"), host()); // závěr běhu jako CLI / window.mncad.run (řádky D, Σ)
    const full = formatFull(r);
    const short = shortProtocol(r, { budget: Infinity }).text;
    const dLine = short.split("\n").find((l) => l.startsWith('D "Sestava A" '))!;
    expect(dLine).toMatch(/^D "Sestava A" asm comp=3 parts=3 .*\bsprings\.lost=1$/);
    expect(dLine).not.toMatch(/\bmates=/); // bez vazeb žádné mates=, značka nese jen pružina
    expect(short).toMatch(new RegExp(`^= L${n} status "Sestava A" asm comp=3 parts=3 V\\.sum=\\S+ m=\\S+ bbox=\\S+ springs\\.lost=1 clash=`, "m"));
    expect(short).toMatch(/^Σ docs=\d+ comp=3 .*\bsprings\.lost=1 files=/m);
    expect(block(full, n - 1)).toMatch(/^= L\d+ check "Sestava A" asm comp=3 parts=3 .* springs\.lost=1 clash=/);
    expect(block(full, n - 1)).toContain("· pružiny se ztracenou dosedací plochou: 1");
    // uložený dokument otevřený znovu (jako `mncad run stav.txt --open "Sestava A.mncad"`): značka je vlastnost dokumentu
    const asm = ws.listDocs().find((x) => x.doc.name === "Sestava A")!.doc;
    const ws2 = new MemoryWorkspace();
    await ws2.openInTab(JSON.parse(JSON.stringify(asm)) as CadDoc);
    const r2 = await runReport(ws2, "stav", host());
    const short2 = shortProtocol(r2, { budget: Infinity }).text;
    expect(short2).toMatch(/^= L1 status "Sestava A" asm .*\bsprings\.lost=1\b/m);
    expect(short2).toMatch(/^D "Sestava A" asm .*\bsprings\.lost=1$/m);
    expect(short2).toMatch(/^Σ .*\bsprings\.lost=1\b/m);
    // po opravě dosedacích ploch značka zmizí (nikdy natrvalo „červená“)
    const r3 = await runReport(new MemoryWorkspace(), [...lines.slice(0, -2), 'sestava pružina "Pružina" mezi "Deska A" F6 "Přidržovač" F5', "stav"].join("\n"), host());
    expect(shortProtocol(r3, { budget: Infinity }).text).not.toMatch(/springs\.lost/);
  }, 300_000);
});

describe("GUI funkce ztracené dosedací plochy (spring-lost.ts)", () => {
  const doc: CadDoc = {
    app: "mnastrojarna-cad",
    version: 2,
    name: "S",
    material: "ocel",
    kind: "assembly",
    features: [],
    components: [
      { id: "d", name: "Deska A", source: { kind: "part", doc: { app: "mnastrojarna-cad", version: 2, name: "Deska A", material: "ocel", kind: "part", features: [] } }, placement: { position: [0, 0, 0], rotation: [0, 0, 0] } },
      { id: "h", name: "Přidržovač", source: { kind: "part", doc: { app: "mnastrojarna-cad", version: 2, name: "Přidržovač", material: "ocel", kind: "part", features: [] } }, placement: { position: [0, 0, 0], rotation: [0, 0, 0] } },
      { id: "p", name: "Pružina", alias: "P1", source: { kind: "part", doc: { app: "mnastrojarna-cad", version: 2, name: "Pružina", material: "ocel", kind: "part", features: [] } }, placement: { position: [0, 0, 0], rotation: [0, 0, 0] }, spring: { a: { compId: "d", face: 2, lost: { kind: "plane", origin: [10, 20, 5], normal: [0, 0, 1], why: "ambiguous" } }, b: { compId: "h", face: 4 }, free: 30, length: 25 } },
    ],
  } as CadDoc;
  it("řádky stran, příkaz opravy (přezdívka, platná strana s číslem), odebrání pružiny; EN bez češtiny", () => {
    setLang("cs");
    const c = lostSpringComps(doc)[0];
    expect(springLostSideTexts(doc, c)).toEqual(["A: dosedací plocha F3 dílu „Deska A“ – není jednoznačná"]);
    expect(springFixCmd(doc, c)).toBe('sestava pružina "P1" mezi "Deska A" <plocha> "Přidržovač" F5 | sestava pružina "P1" odebrat');
    const without = withoutSpringOf(doc, "p");
    expect(without.components!.find((x) => x.id === "p")!.spring).toBeUndefined();
    expect(lostSpringComps(without)).toEqual([]);
    // tlačítko „Odebrat pružinu“ v seznamu vazeb = tentýž textový příkaz jako panel pružiny (protokol ✓ pružina odebrána, záznam agenta)
    expect(springRemoveCmd(doc, "p")).toBe("sestava pružina #3 odebrat");
    expect(doc.components!.find((x) => x.id === "p")!.spring).toBeDefined(); // původní dokument beze změny (krok zpět)
    setLang("en");
    expect(springLostSideTexts(doc, c)).toEqual(["A: seat face F3 of part “Deska A” – is ambiguous"]);
    expect(springFixCmd(doc, c)).toBe('assembly spring "P1" between "Deska A" <face> "Přidržovač" F5 | assembly spring "P1" remove');
    setLang("cs");
  });
});
