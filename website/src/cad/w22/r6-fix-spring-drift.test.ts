/**
 * Vlna 22, fáze 2 – oprava po úplném běhu kola 6 (e2e cad-w15-asm, skutečné jádro in-process). Repro: dvě desky jen se
 * vzdáleností „ZDVIH“ (posuv v rovině a natočení kolem normály volné), pružina mimo střed mezi deskami, šrouby se zámkem.
 *
 * Dřív (kolo 6, motion-quasi.ts `solveStep`): úklid bez měkkých členů přijal polohu penalizačního optima, které s pružinou
 * „uklouzlo“ v nedourčených stupních volnosti – `sestava vazba "ZDVIH" hodnota=30` posunula desku na Y +31 560 mm, pružina
 * 30,082 mm / 347,9 N místo 30 mm / 350 N a šrouby v pohybu „konec [19,974; 31540,161; 57,921]“. Teď úklid platí jen tehdy,
 * když tutéž polohu dá i nejmenší změna od počátečního odhadu; jinak rozhodne větev (B) jako před kolem 6.
 */
import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { setLang } from "../i18n";
import { setHostAssets } from "../host-assets";
import { makeKernelClient } from "../kernel-client";
import { memoryFileSink, memoryFileSource, type EngineHost } from "../engine/host";
import { MemoryWorkspace } from "../engine/memory-workspace";
import { formatConsole } from "../engine/protocol";
import { runScript } from "../engine/run";

const WASM = path.resolve(__dirname, "../../../node_modules/replicad-opencascadejs/dist/replicad_single.wasm");
const FONTS = path.resolve(__dirname, "../../../public/fonts");

const SPRING = "Pružina 2×20×44";
const SETUP = [
  "nový díl Vodicí deska",
  "kvádr 189.8 308 20 v -2.4 -308 0",
  "nový díl Kotevní deska",
  "kvádr 189.8 308 20 v -2.4 -308 0",
  "nový díl Stopka",
  "válec 80 60",
  "kvádr 20 100 62 v 30 -50 -1 odebrat",
  "nový díl Šroub M6x20",
  "válec 6 20",
  "normálie pružina d2 D20 L44 n8",
  "nová sestava Zkouška",
  'vložit "Vodicí deska" ukotvit',
  'vložit "Kotevní deska" v 0 0 58',
  'vložit "Stopka" v 92.5 -42 78 otočení 0 0 20',
  'vložit "Šroub M6x20" v 20 -20 78 otočení 180 0 0 jako "K48"',
  'vložit "Šroub M6x20" v 160 -20 78 otočení 180 0 0 jako "K49"',
  `vložit "${SPRING}" v 20 -250 21`,
  'sestava vazba vzdálenost "Kotevní deska" spodní "Vodicí deska" horní hodnota 38 název "ZDVIH"',
  'sestava vazba zámek "K48" "Kotevní deska"',
  'sestava vazba zámek "K49" "Kotevní deska"',
  'sestava vazba zámek "Stopka" "Kotevní deska"',
  `sestava vazba zámek "${SPRING}" "Vodicí deska"`,
  `sestava pružina "${SPRING}" mezi "Vodicí deska" "Kotevní deska" tuhost 25`,
];

describe("kolo 6 – pružina mezi deskami bez vedení: statický přepočet a pohyb bez ujetí v rovině", async () => {
  setLang("cs");
  setHostAssets({ font: async (name) => new Uint8Array(fs.readFileSync(path.join(FONTS, name))).buffer });
  const { inProcessTransport } = await import("../kernel-inprocess");
  const kernel = makeKernelClient(inProcessTransport({ locateFile: (file) => (file.endsWith(".wasm") ? WASM : file) }));
  await kernel.init();
  const host = (): EngineHost => ({ kernel, files: memoryFileSink(), inputs: memoryFileSource({}), now: () => Date.now() });

  it("ZDVIH 30 → přesně 30 mm / 350 N, desky na místě; pohyb 38..16: šrouby jen ve Z o 20 mm, bez natočení", async () => {
    const r = await runScript(new MemoryWorkspace(), [...SETUP, 'sestava vazba "ZDVIH" hodnota=30', "sestava pružiny", "stav", 'sestava vazba "ZDVIH" hodnota=38', 'pohyb motor lineární vazba "ZDVIH" 38..16 kroky 11', "pohyb detail"].join("\n"), host());
    const con = formatConsole(r);
    // statický přepočet: délka = hodnota vazby (rovnoběžné desky), síla c·(L0 − L)
    expect(con).toMatch(/✓ pružina „Pružina 2×20×44“: délka 30 mm · L0 44 · Ln 18 · stlačení 14 mm · síla 350 N \(c 25 N\/mm\)/);
    expect(con).toMatch(/Pružiny: „Pružina 2×20×44“ 30 mm \(L0 44 · Ln 18\) · F 350 N ✓/);
    expect(con).toMatch(/Kotevní deska \[0; 0; 50\]/);
    expect(con).not.toMatch(/31\s?5\d\d[,.]\d/); // žádné ujetí o desítky metrů (dřív Y 31 560 mm)
    // pohyb: tuhá skupina se šrouby jen ve Z, bez „natáčí se“
    const screws = con.split("\n").filter((l) => /Šroub M6x20: rozsah pohybu/.test(l));
    expect(screws.length).toBe(2);
    for (const l of screws) {
      expect(l).toMatch(/rozsah pohybu X 0 · Y 0 · Z 20 mm/);
      expect(l).not.toMatch(/natáčí se/);
    }
    expect(con).toMatch(/✓ pružina „Pružina 2×20×44“: délka 38 → 18 mm \(min 18 · L0 44 · Ln 18\) · síla 150 → 650 N \(max 650 N\)/);
    expect(con).toMatch(/motor 1 stojí na mezi v krocích 11 .*dosaženo 18 mm/);
  }, 300_000);
});
