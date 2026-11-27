/**
 * Vlna 22, balík M – fáze 2, kolo 7 se skutečným jádrem: nálezy oponenta kola 6 (body 3 a 8). Skripty = repro oponenta
 * (neutrální názvy); u každého případu stav před kolem 7. Na kódu před kolem 7 všechny selhávají.
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
const PEVNA = 'sestava vazba vzdálenost "Přidržovač" spodní "Rám" horní hodnota 24.5 název "PEVNÁ"';
/** poloha komponenty z výpisu `pohyb krok N` (za řádkem „Krok N“) */
function poseIn(con: string, step: number, comp: string): number[] | null {
  const block = con.split(/\n(?=Krok \d+ \(t = )/).find((b) => b.startsWith(`Krok ${step} (`));
  const m = block?.match(new RegExp(`^ ${comp} \\[([^\\]]+)\\]`, "m"));
  return m ? m[1].split(";").map((x) => Number(x.trim().replace(",", "."))) : null;
}
const kvOf = (r: Awaited<ReturnType<typeof runScript>>, re: RegExp) => r.entries.filter((e) => e.level === "measure" && re.test(e.text)).at(-1)!.text;

describe("kolo 7 – body 3 a 8 se skutečným jádrem", async () => {
  setHostAssets({ font: async (name) => new Uint8Array(fs.readFileSync(path.join(FONTS, name))).buffer });
  const { inProcessTransport } = await import("../kernel-inprocess");
  const kernel = makeKernelClient(inProcessTransport({ locateFile: (file) => (file.endsWith(".wasm") ? WASM : file) }));
  await kernel.init();
  const hostOf = (): EngineHost => ({ kernel, files: memoryFileSink(), inputs: memoryFileSource({}), now: () => Date.now() });
  const run = async (lines: string[]) => {
    const r = await runScript(new MemoryWorkspace(), lines.join("\n"), hostOf());
    return { r, con: formatConsole(r) };
  };
  const DYN = [...PARTS, 'vložit "Přidržovač" v 0 0 34.5', ZDVIH, PEVNA, MEZ, "pohyb dynamika čas 2 krok 0.001 snímky 12"];

  it("bod 8 (oponent kola 6): dynamika, „na mezi chyba“ a motor, který dojel za mez a stojí tam – neplatné VŠECHNY kroky za mezí, ne jen ty s pohybem", async () => {
    // dřív (rev7m/holderr): invalid=2, ⚠ motion.invalid „kroky 4–5“, `pohyb krok 6` a `pohyb krok 12` Deska A [0; 0; 37,15]
    // (10,35 mm v přidržovači, Mez min 5 porušená) jako běžná poloha, souhrn ΔZ −30,35 mm
    const { r, con } = await run([...DYN, 'pohyb motor lineární vazba "ZDVIH" 57.5..27.15 rychlost 30.35 na mezi chyba', "pohyb krok 6", "pohyb krok 12"]);
    const inv = r.entries.find((e) => e.code === "motion.invalid")!;
    expect(inv.text).toMatch(/neřešitelné kroky 4–12 /);
    expect(kvOf(r, / mode=dyn .*m1=/)).toMatch(/ invalid=9 /);
    for (const k of [6, 12]) expect(poseIn(con, k, "Deska A")![2]).toBeGreaterThan(47.4);
    expect(con).not.toMatch(/Deska A \[0; 0; 37,15\]/);
    expect(con).not.toMatch(/„Deska A“: ΔZ −30,35 mm/);
    expect(r.entries.filter((e) => /NEŘEŠITELNÝ krok/.test(e.text)).reduce((n, e) => n + (e.count ?? 1), 0)).toBe(2);
  }, 300_000);

  it("bod 8 (oponent kola 6): zastavení na mezi v dynamice = nesplněný pohon jako v kinematice (conflicts, motion.conflict ZDVIH), ne „Vazby splněny ve všech krocích“", async () => {
    // dřív (dynstop): dynamika conflicts=0 + „Vazby splněny ve všech krocích“ vedle ⚠ motion.motor-limit stopped=5; kinematika téhož
    // dokumentu conflicts=5 + „nesplněné vazby v 5 krocích“ + motion.conflict ZDVIH
    const MOTOR = 'pohyb motor lineární vazba "ZDVIH" 57.5..27.15 kroky 12 na mezi stop';
    const d = await run([...DYN, MOTOR]);
    const k = await run([...PARTS, 'vložit "Přidržovač" v 0 0 34.5', ZDVIH, PEVNA, MEZ, MOTOR]);
    const dk = kvOf(d.r, / mode=dyn .*m1=/);
    const kk = kvOf(k.r, / level=kin /);
    expect(dk).toMatch(/ stopped=5 /);
    expect(kk).toMatch(/ stopped=5 /);
    expect(dk).toMatch(/ conflicts=5 /);
    expect(kk).toMatch(/ conflicts=5 /);
    for (const x of [d, k]) {
      expect(x.r.entries.some((e) => /motion\.conflict pohyb porušuje vazbu „ZDVIH Deska A → Rám“ v kroku 8–12/.test(e.text))).toBe(true);
      expect(x.r.entries.some((e) => /nesplněné vazby v 5 krocích/.test(e.text))).toBe(true);
    }
    // souhrn motoru v dynamice (řádky za ✓ motor 1) bez zelené věty
    const after = d.con.slice(d.con.indexOf("✓ L18 motor 1"));
    expect(after).not.toMatch(/^ {0,2}Vazby splněny ve všech krocích$/m);
  }, 300_000);

  it("bod 8 (nit oponenta kola 6): motor-limit u profilu, který za mezí dojel a couvl, uvede nejzazší žádanou hodnotu", async () => {
    // dřív (dynback): „v krocích 4–8 … žádáno 37,226 → 37,348 mm“ – profil přitom žádal až 27,15
    const { r } = await run([...DYN, 'pohyb motor lineární vazba "ZDVIH" 57.5..27.15 pak 57.5 kroky 24 na mezi stop']);
    const lim = r.entries.find((e) => e.code === "motion.motor-limit")!;
    expect(lim.text).toMatch(/v krocích 4–8 .*žádáno 37,226 → 37,348 mm \(nejdál 27,15 mm\), dosaženo 37,49\d mm/);
  }, 300_000);

  it("bod 10: zkušební posun motoru na sestavě se 100 komponentami – změřená doba, dosah s instancemi (přezdívky), ne „„Kostka“, „Kostka“…“", async () => {
    // dřív neměřeno (CAD-M1-OPRAVY bod 10 „Co zbývá“); dosah vypsal jména dílů bez instance: „„Kostka“, „Kostka“, „Kostka“ a další“
    const L = ['nový díl "Rám"', "kvádr 400 400 10", 'nový díl "Deska A"', "kvádr 400 400 10", 'nový díl "Kostka"', "kvádr 10 10 10", 'nová sestava "Nástroj 100"', 'vložit "Rám" ukotvit', 'vložit "Deska A" v 0 0 67.5'];
    for (let i = 1; i <= 98; i++) L.push(`vložit "Kostka" v ${10 + (i % 10) * 35} ${10 + Math.floor(i / 10) * 35} ${i <= 50 ? 77.5 : 10} jako "K${i}"`);
    L.push('sestava vazba vzdálenost "Deska A" spodní "Rám" horní hodnota 57.5 název "ZDVIH"');
    for (let i = 1; i <= 98; i++) L.push(`sestava vazba zámek "K${i}" "${i <= 50 ? "Deska A" : "Rám"}"`);
    const ws = new MemoryWorkspace();
    expect((await runScript(ws, L.join("\n"), hostOf())).counts.errors).toBe(0);
    const t0 = Date.now();
    const r = await runScript(ws, 'pohyb motor lineární vazba "ZDVIH" 57.5..27.15 kroky 12', hostOf());
    const ms = Date.now() - t0;
    const con = formatConsole(r);
    expect(con).toMatch(/pohání: „Deska A“ \+ 50 dílů – spolu s ním kvůli pevné vazbě \(zámku\): „Kostka \[K1\]“, „Kostka \[K2\]“, „Kostka \[K3\]“ a další · směr −Z/);
    expect(kvOf(r, / level=kin /)).toMatch(/ travel=30\.35mm:51 static=49 /);
    // měřeno v kole 7: ~0,1 s v CLI (definice motoru + zkušební posun + studie 12 kroků); mez s rezervou pro zatížený stroj
    expect(ms).toBeLessThan(15_000);
  }, 300_000);

  it("bod 3 (oponent kola 6): začátek fáze při dotyku = okamžik dosednutí t = 0,807 s pro každý práh (0 / 0,0001 / 0,001), slabší práh nezačne později", async () => {
    // dřív (qc / qtol / qctol): `<= 0` 0,812 s, `<= 0.0001` 0,808 s, `<= 0.001` 0,807 s – půlení skončilo v prvním bodě s hodnotou
    // na mezi a sečna u dotyku uvízla; správně 24,5 / 30,35 = 0,8072 s
    for (const thr of ["0", "0.0001", "0.001"]) {
      const { con } = await run([...PARTS, 'vložit "Přidržovač" v 20 20 34.5', 'vložit "Pružina" v 50 50 42.5', ZDVIH, MEZ, DOSED, 'sestava vazba zámek "Pružina" "Přidržovač"', 'sestava pružina "Pružina" mezi "Přidržovač" "Deska A" volná 32 blok 14 tuhost 20', 'pohyb fáze "Nájezd"', `pohyb fáze "Přidržení" při vazba "Dosed" <= ${thr}`, 'pohyb fáze "Návrat" při vazba "ZDVIH" >= 28', 'pohyb motor lineární vazba "ZDVIH" 57.5..27.15 pak 57.5 kroky 24']);
      expect(con, `práh ${thr}`).toMatch(/Fáze 2 „Přidržení“: kroky 10–12 · t = 0,807–1 s/);
    }
  }, 600_000);
});
