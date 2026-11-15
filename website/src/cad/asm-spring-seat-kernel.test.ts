/**
 * Pružina z tabulky dosedá v pohybu PŘESNĚ (recenze integrace vlny 21, nález 1) – skutečné jádro, běh textového skriptu jako CLI:
 * dřív se začátek pružiny (posun po ose na dosedací plochu A) zaokrouhloval na 1e-4 mm a délka tvaru na nejbližší 1e-4 mm, desky
 * v krocích 1/3 mm (43,3333… mm) tak pružinu o 3·10⁻⁵ mm „probodly“ a broušený konec (rovinná plocha) dal ⚠ clash.real
 * (0,105 mm³), zatímco stará pružina (kulatý drát, dotyk v čáře) 0. Teď: posun bez zaokrouhlení na 1e-4 (mřížka 1e-7 jako
 * vzájemná poloha kolize) a tvar v délce zaokrouhlené DOLŮ (nikdy nepřesáhne plochu B) → 0 kolizí v kinematice i v dynamice;
 * dynamika s kolizí kontroluje `kroky` snímků (nález 4), ne všechny zaznamenané.
 */
import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { setHostAssets } from "./host-assets";
import { makeKernelClient } from "./kernel-client";
import { memoryFileSink, memoryFileSource, type EngineHost } from "./engine/host";
import { MemoryWorkspace } from "./engine/memory-workspace";
import { formatFull, formatShort } from "./engine/protocol";
import { runScript } from "./engine/run";

const WASM = path.resolve(__dirname, "../../node_modules/replicad-opencascadejs/dist/replicad_single.wasm");
const FONTS = path.resolve(__dirname, "../../public/fonts");

/** stírací deska pevně 25 mm pod horní deskou (pružina stále 35 mm), lis jede po 1/3 mm (43,3333… mm) */
const PLATES = [
  "nový díl Spodní deska",
  "kvádr 200 120 30",
  "nový díl Horní deska",
  "kvádr 200 120 30",
  "válec 21 10 v 40 30 0 odebrat",
  "nový díl Stírací deska",
  "kvádr 200 120 15",
];
const asm = (spring: string, motion: string[]) =>
  [
    ...PLATES,
    "nový díl Pružina",
    spring,
    "nová sestava S",
    'vložit "Spodní deska" ukotvit',
    'vložit "Stírací deska" v 0 0 45',
    'vložit "Horní deska" v 0 0 85',
    'vložit "Pružina" v 40 30 60',
    'sestava vazba vzdálenost "Horní deska" spodní "Spodní deska" horní hodnota 55 název "LIS"',
    'sestava vazba vzdálenost "Stírací deska" horní "Horní deska" spodní hodnota 25 název "Pevně"',
    'sestava pružina "Pružina" mezi "Stírací deska" F6 "Horní deska" F8',
    ...motion,
  ].join("\n");
const motionKv = (out: string) => out.split("\n").filter((l) => / motion steps=/.test(l));

describe("pružina z tabulky v pohybu dosedá přesně – bez falešné kolize (skutečné jádro)", async () => {
  setHostAssets({ font: async (name) => new Uint8Array(fs.readFileSync(path.join(FONTS, name))).buffer });
  const { inProcessTransport } = await import("./kernel-inprocess");
  const kernel = makeKernelClient(inProcessTransport({ locateFile: (file) => (file.endsWith(".wasm") ? WASM : file) }));
  await kernel.init();
  const host = (): EngineHost => ({ kernel, files: memoryFileSink(), inputs: memoryFileSource({}), now: () => Date.now() });

  it("kinematika: tabulková pružina 35 mm mezi deskami v krocích po 1/3 mm – 0 kolizí jako stará pružina", async () => {
    for (const spring of ["pružina tlačná d 2 De 19,5 L0 41 n 6", "pružina 8,75 stoupání 6,5 závity 6 drát 2"]) {
      const r = await runScript(new MemoryWorkspace(), asm(spring, ['pohyb motor lineární vazba "LIS" 55..45 kroky 6 kolize']), host());
      const out = formatShort(r, { budget: Infinity });
      const kv = motionKv(out);
      expect(kv.length, out).toBeGreaterThan(0);
      expect(kv.at(-1), spring).toMatch(/ clash\.steps=0\/7 thread=0 real=0( |$)/);
      expect(out).not.toMatch(/clash\.real/);
      expect(formatFull(r)).toMatch(/✓ L\d+ pružina „Pružina“: délka 35 mm \(min 35 /);
    }
  }, 300_000);

  it("dynamika s kolizí: kontrola v `kroky` snímcích (5 z 101), tabulková pružina bez falešné kolize", async () => {
    const r = await runScript(
      new MemoryWorkspace(),
      asm("pružina tlačná d 2 De 19,5 L0 41 n 6", ["pohyb dynamika čas 0,05 krok 0,0005 gravitace -Z", 'pohyb motor lineární vazba "LIS" 55..45 kroky 4 kolize']),
      host(),
    );
    const out = formatShort(r, { budget: Infinity });
    const kv = motionKv(out).at(-1) ?? "";
    expect(kv, out).toMatch(/ mode=dyn /);
    expect(kv, out).toMatch(/ steps=100 /);
    expect(kv, out).toMatch(/ clash\.steps=0\/5 thread=0 real=0( |$)/);
    expect(out).not.toMatch(/clash\.real/);
  }, 300_000);
});
