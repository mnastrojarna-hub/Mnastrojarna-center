/**
 * Vlna 22, balík M – fáze 2, kolo 6 se skutečným jádrem (jako engine/open-springs.test.ts): body 2 a 8 – předpětí pružiny,
 * nevedený díl, dynamika. Skripty jsou repro z nezávislého ověření (neutrální názvy); u každého případu je stav před kolem 6.
 */
import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { setHostAssets } from "../host-assets";
import { makeKernelClient } from "../kernel-client";
import { memoryFileSink, memoryFileSource, type EngineHost } from "../engine/host";
import { MemoryWorkspace } from "../engine/memory-workspace";
import { formatConsole } from "../engine/protocol";
import { runScript } from "../engine/run";

const WASM = path.resolve(__dirname, "../../../node_modules/replicad-opencascadejs/dist/replicad_single.wasm");
const FONTS = path.resolve(__dirname, "../../../public/fonts");

const PARTS = ['nový díl "Rám"', "kvádr 100 100 10", 'nový díl "Deska A"', "kvádr 100 100 10", 'nový díl "Přidržovač"', "kvádr 60 60 8", 'nový díl "Pružina"', "pružina 18 stoupání 5 závity 6 drát 2", 'nová sestava "Mechanika"', 'vložit "Rám" ukotvit', 'vložit "Deska A" v 0 0 67.5'];
const ZDVIH = 'sestava vazba vzdálenost "Deska A" spodní "Rám" horní hodnota 57.5 název "ZDVIH"';
const MEZ = 'sestava vazba mez-vzdálenosti "Přidržovač" horní "Deska A" spodní min 5 max 25 název "Mez"';
const DOSED = 'sestava vazba mez-vzdálenosti "Přidržovač" spodní "Rám" horní min 0 max 500 název "Dosed"';
/** poloha komponenty z výpisu `pohyb krok N` (za řádkem „Krok N“) */
function poseIn(con: string, step: number, comp: string): { p: number[]; rot?: number[] } | null {
  const block = con.split(/\n(?=Krok \d+ \(t = )/).find((b) => b.startsWith(`Krok ${step} (`));
  const m = block?.match(new RegExp(`^ ${comp} \\[([^\\]]+)\\](?: ∠\\[([^\\]]+)\\])?`, "m"));
  if (!m) return null;
  const num = (s: string) => s.split(";").map((x) => Number(x.trim().replace(",", ".")));
  return { p: num(m[1]), ...(m[2] ? { rot: num(m[2]) } : {}) };
}

describe("kolo 6 – body 2 a 8 se skutečným jádrem", async () => {
  setHostAssets({ font: async (name) => new Uint8Array(fs.readFileSync(path.join(FONTS, name))).buffer });
  const { inProcessTransport } = await import("../kernel-inprocess");
  const kernel = makeKernelClient(inProcessTransport({ locateFile: (file) => (file.endsWith(".wasm") ? WASM : file) }));
  await kernel.init();
  const hostOf = (): EngineHost => ({ kernel, files: memoryFileSink(), inputs: memoryFileSource({}), now: () => Date.now() });
  const run = async (lines: string[], o: { strict?: boolean } = {}) => {
    const r = await runScript(new MemoryWorkspace(), lines.join("\n"), hostOf(), o);
    return { r, con: formatConsole(r) };
  };

  it("bod 8: kvazistatika, předepnutá pružina mimo osu nevedeného přidržovače – díly neujedou ani se nenatočí, motor dojede", async () => {
    // dřív (p2-offc1): krok 12 Deska A [−5352,5; 2405,1; 37,15] ∠−22,2°, Přidržovač [5348,1; −2316,6; 10] ∠−67,5°, stopped=1
    // a „žádáno 32,208 mm, dosaženo 32,209 mm … díly zůstávají fyzikálně“
    const { r, con } = await run([...PARTS, 'nový díl "Pružina B"', "pružina 18 stoupání 5 závity 6 drát 2", 'nová sestava "Mechanika"', 'vložit "Rám" ukotvit', 'vložit "Deska A" v 0 0 67.5', 'vložit "Přidržovač" v 20 20 34.5', 'vložit "Pružina B" v 70 70 42.5', ZDVIH, MEZ, DOSED, 'sestava vazba zámek "Pružina B" "Přidržovač"', 'sestava pružina "Pružina B" mezi "Přidržovač" "Deska A" volná 32 blok 14 tuhost 60', 'pohyb motor lineární vazba "ZDVIH" 57.5..27.15 kroky 12', "pohyb krok 12"]);
    const d = poseIn(con, 12, "Deska A")!;
    const h = poseIn(con, 12, "Přidržovač")!;
    expect(Math.hypot(d.p[0], d.p[1])).toBeLessThan(0.01);
    expect(Math.hypot(h.p[0] - 20, h.p[1] - 20)).toBeLessThan(0.01);
    expect(Math.max(0, ...(d.rot ?? []).map(Math.abs), ...(h.rot ?? []).map(Math.abs))).toBeLessThan(0.01);
    expect(d.p[2]).toBeCloseTo(37.15, 2);
    expect(h.p[2]).toBeCloseTo(10, 2);
    expect(r.entries.some((e) => e.code === "motion.motor-limit")).toBe(false);
    expect(con).not.toContain("díly zůstávají fyzikálně");
  }, 300_000);

  it("bod 2: kvazistatika bez vedení (pružina mimo osu) – přidržovač dosedne na rám, ne „visí“ 1,74 mm nad ním se zaseklým motorem", async () => {
    // dřív (p2-offu): kroky 10–12 Přidržovač Z 11,7375, stopped=3, motion.motor-limit „žádáno 32,208, dosaženo 32,209“
    const { r, con } = await run([...PARTS, 'nový díl "Pružina B"', "pružina 18 stoupání 5 závity 6 drát 2", 'nová sestava "Mechanika"', 'vložit "Rám" ukotvit', 'vložit "Deska A" v 0 0 67.5', 'vložit "Přidržovač" v 0 0 34.5', 'vložit "Pružina B" v 45 45 42.5', ZDVIH, MEZ, DOSED, 'sestava vazba zámek "Pružina B" "Přidržovač"', 'sestava pružina "Pružina B" mezi "Přidržovač" "Deska A" volná 32 blok 14 tuhost 60', 'pohyb motor lineární vazba "ZDVIH" 57.5..27.15 kroky 12', "pohyb krok 12"]);
    expect(poseIn(con, 12, "Přidržovač")!.p[2]).toBeCloseTo(10, 2);
    expect(poseIn(con, 12, "Deska A")!.p[2]).toBeCloseTo(37.15, 2);
    expect(r.entries.some((e) => e.code === "motion.motor-limit")).toBe(false);
  }, 300_000);

  const DYN = [...PARTS, 'vložit "Přidržovač" v 0 0 34.5', ZDVIH, 'sestava vazba vzdálenost "Přidržovač" spodní "Rám" horní hodnota 24.5 název "PEVNÁ"', MEZ, "pohyb dynamika čas 2 krok 0.001 snímky 12"];
  it("bod 8: dynamika, motor na mezi stop – motor zastaví na mezi (Deska A Z 47,5), ⚠ motion.motor-limit; dřív projel na 37,15 bez účinku volby", async () => {
    const { r, con } = await run([...DYN, 'pohyb motor lineární vazba "ZDVIH" 57.5..27.15 kroky 12 na mezi stop', "pohyb krok 12"]);
    expect(poseIn(con, 12, "Deska A")!.p[2]).toBeCloseTo(47.5, 1);
    expect(r.entries.some((e) => e.code === "motion.motor-limit")).toBe(true);
  }, 300_000);
  it("bod 8: dynamika, motor na mezi chyba – kroky za mezí neplatné (⚠ motion.invalid), zobrazí poslední platnou polohu", async () => {
    const { r, con } = await run([...DYN, 'pohyb motor lineární vazba "ZDVIH" 57.5..27.15 kroky 12 na mezi chyba', "pohyb krok 12"]);
    expect(r.entries.some((e) => e.code === "motion.invalid")).toBe(true);
    expect(poseIn(con, 12, "Deska A")!.p[2]).toBeGreaterThan(47.4);
  }, 300_000);

  it("bod 2: dynamika nahoru startuje z kvazistatické rovnováhy – krok 0 = krok 0 kvazistatiky, žádná falešná špička síly", async () => {
    // dřív (repro-dyn-up): krok 0 Přidržovač Z 15,15 (na Ln pružiny), spring.max=337,3N@0.001s, „✓ … (max 359,2 N)“
    const { r, con } = await run([...PARTS, 'vložit "Přidržovač" v 20 20 34.5', 'vložit "Pružina" v 50 50 42.5', ZDVIH, MEZ, DOSED, 'sestava vazba zámek "Pružina" "Přidržovač"', 'sestava pružina "Pružina" mezi "Přidržovač" "Deska A" volná 32 blok 14 tuhost 20', 'pohyb hmotnost "Přidržovač" 1', 'pohyb motor lineární vazba "ZDVIH" 27.15..57.5 kroky 12', "pohyb dynamika čas 2 krok 0.001 gravitace -Z tlumení 0.05 odraz 0 snímky 12", "pohyb krok 0"]);
    expect(poseIn(con, 0, "Přidržovač")!.p[2]).toBeCloseTo(10, 2);
    const kv = r.entries.filter((e) => e.level === "measure" && /spring\.max=/.test(e.text)).at(-1)!;
    const max = Number(kv.text.match(/spring\.max=([\d.]+)N/)![1]);
    expect(max).toBeLessThan(270);
    expect(con).not.toMatch(/max 359,2 N/);
  }, 300_000);

  it("bod 2: preference min, kterou v sestavě přebije pružina – statika ⚠ „preference se neuplatnila“, kinematika ⚠ krok 0 ≠ sestava, --strict STOP", async () => {
    // dřív (p2-kinprefmin0): „✓ L22 … preferovaná strana min · ok“, krok 0 Přidržovač 45,5 bez ⚠, „✓ pružina … 14 mm … 360 N“, exit 0
    const lines = [...PARTS, 'vložit "Přidržovač" v 20 20 34.5', 'vložit "Pružina" v 50 50 42.5', ZDVIH, MEZ, DOSED, 'sestava vazba zámek "Pružina" "Přidržovač"', 'sestava pružina "Pružina" mezi "Přidržovač" "Deska A" volná 32 blok 14 tuhost 20', 'sestava vazba "Mez" preferovat min', "pohyb kinematika", 'pohyb motor lineární vazba "ZDVIH" 57.5..27.15 kroky 12'];
    const { r, con } = await run(lines);
    expect(con).not.toMatch(/✓ .*preferovaná strana min · ok/);
    expect(con).toMatch(/⚠ vazba 2 .*preference se neuplatnila \(pružina tlačí k max; drží ji u max\)/);
    expect(r.entries.some((e) => e.code === "motion.start-jump" && /krok 0 se liší od polohy v sestavě: „Přidržovač“ 11 mm/.test(e.text))).toBe(true);
    expect(con).not.toMatch(/^✓ .*pružina „Pružina“: délka 14 mm/m);
    expect(con).not.toMatch(/^ {0,2}Vazby splněny ve všech krocích$/m);
    const strict = await run(lines, { strict: true });
    expect(strict.r.stopped).toBeTruthy();
  }, 300_000);
});
