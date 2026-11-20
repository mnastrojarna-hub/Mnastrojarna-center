/**
 * Vlna 22, balík C1 (bod 5 zprávy majitele): kolizní report rozlišuje závitový záběr, numerický dotyk, pracovní kontakt
 * a skutečný náraz – se skutečným jádrem in-process, engine stejný jako v prohlížeči a v CLI.
 *
 * Akceptace majitele: „závitový záběr nezahlcuje seznam závad, ale skutečný náraz hlavy šroubu se neztratí“ – a totéž platí pro
 * `stav`, řádek D, pohyb (i uvnitř podsestavy) a strojové výpisy. Repro skripty = korpus 70–74 (src/cad/engine/__corpus__).
 */
import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { setLang } from "../i18n";
import { setHostAssets } from "../host-assets";
import { makeKernelClient } from "../kernel-client";
import { memoryFileSink, memoryFileSource, type EngineHost } from "../engine/host";
import { MemoryWorkspace } from "../engine/memory-workspace";
import { formatConsole, formatShort } from "../engine/protocol";
import { runReport } from "../engine/run-protocol";
import type { RunReport } from "../engine/protocol-types";

const WASM = path.resolve(__dirname, "../../../node_modules/replicad-opencascadejs/dist/replicad_single.wasm");
const FONTS = path.resolve(__dirname, "../../../public/fonts");
const CORPUS = path.resolve(__dirname, "../engine/__corpus__");
/** skript korpusu jako jeden běh (oddělovače běhů jsou komentáře) */
const corpus = (name: string) => fs.readFileSync(path.join(CORPUS, `${name}.txt`), "utf8");
const lines = (t: string, re: RegExp) => t.split("\n").filter((l) => re.test(l));

describe("vlna 22 C1: třídy kolizí všude (bod 5)", async () => {
  setLang("cs");
  setHostAssets({ font: async (name) => new Uint8Array(fs.readFileSync(path.join(FONTS, name))).buffer });
  const { inProcessTransport } = await import("../kernel-inprocess");
  const kernel = makeKernelClient(inProcessTransport({ locateFile: (file) => (file.endsWith(".wasm") ? WASM : file) }));
  await kernel.init();
  const host = (): EngineHost => ({ kernel, files: memoryFileSink(), inputs: memoryFileSource({}), now: () => Date.now() });
  const run = async (text: string): Promise<{ r: RunReport; short: string; con: string }> => {
    const r = await runReport(new MemoryWorkspace(), text, host());
    return { r, short: formatShort(r, { budget: Infinity, notes: true }), con: formatConsole(r) };
  };

  it("70: šroub v závitu = ℹ, náraz hlavy S2 do přidržovače a bok hlavy S3 do plechu = ⚠ s instancí a místem; stav a D po třídách", async () => {
    const { r, short, con } = await run(corpus("70-clash-classes"));
    expect(short).toMatch(/^= L\d+ clash "Sestava 5" total=5 thread=3 underhead=0 real=2 undetermined=0$/m);
    const real = lines(short, /clash\.real/);
    expect(real.length).toBeGreaterThanOrEqual(2);
    expect(real.some((l) => /„Přidržovač“ × „Šroub M12 \[S2\]“ \(365,2 mm³\) – místo \[50; 30; 28,5\] · obálka 18 × 18 × 3 mm/.test(l))).toBe(true);
    expect(real.some((l) => /„Plech“ × „Šroub M12 \[S3\]“ \(77,3 mm³\)/.test(l))).toBe(true);
    // závity se seznamem závad nemíchají: žádné ⚠ s Deskou A, v `stav` jen počet
    expect(lines(short, /^⚠/).some((l) => /Deska A/.test(l))).toBe(false);
    expect(short).toMatch(/^= L\d+ status "Sestava 5" .* clash=5\(thread=3,real=2\)$/m);
    const stav = /^Kolize: .*$/m.exec(con)![0];
    expect(stav).toMatch(/^Kolize: 5 – skutečné 2: Přidržovač × Šroub M12 \[S2\] \(365,2 mm³\) v místě \[50; 30; 28,5\]; Plech × Šroub M12 \[S3\]/);
    expect(stav).toMatch(/; šroub v závitu 3 \(zkontrolováno/);
    expect(stav).not.toMatch(/Deska A × Šroub/);
    expect(short).toMatch(/^D "Sestava 5" asm .* clash=5\(thread=3,real=2\)$/m);
    // JSON: data skupiny s cestami, objemem a místem
    const e = r.entries.find((x) => x.code === "clash.real" && /S2/.test(x.text))!;
    const data = e.data as { cls: string; items: { aPath: string[]; bPath: string[]; at: number[]; box: number[][]; volume: number }[] };
    expect(data.cls).toBe("real");
    expect(data.items[0].at).toEqual([50, 30, 28.5].map((v, i) => expect.closeTo(v, i === 2 ? 2 : 3)));
    // výpis s filtrem: závity jen na vyžádání, bez nových ⚠
    expect(short).toMatch(/^= L\d+ clash "Sestava 5" .* shown=2 filter=thread$/m);
  }, 240_000);

  it("71: přesah 0,0001 mm = ℹ dotyk (ne ⚠); tolerance ho přepne; jádrová díra bez závitu = ⚠ nevyhodnotitelné s nápovědou, pravidlo závit = ℹ", async () => {
    const { short } = await run(corpus("71-clash-touch-plain"));
    expect(short).toMatch(/^= L\d+ clash "Sestava 5b" total=3 thread=0 underhead=0 real=2 undetermined=0 touch=1$/m);
    expect(lines(short, /^⚠.*Deska B/)).toEqual([]);
    // hlava v téže závitové desce (S4) a dřík delší než díra (S5) zůstanou skutečnou kolizí
    expect(lines(short, /^⚠.*clash\.real.*\[S4\]/).length).toBe(1);
    expect(lines(short, /^⚠.*clash\.real.*\[S5\]/).length).toBe(1);
    expect(short).toMatch(/^= L\d+ clash "Sestava 5b" total=3 thread=0 underhead=0 real=3 undetermined=0$/m); // tolerance 0,00001 mm
    expect(short).toMatch(/^= L\d+ clash "Sestava 5P" total=1 thread=0 underhead=0 real=0 undetermined=1$/m);
    expect(short).toMatch(/clash\.undetermined "Sestava 5P": kolizi „Deska C“ × „Šroub M12 \[S1\]“ nelze vyhodnotit: šroub Ø12 v díře Ø10,2 bez prvku závitu/);
    expect(short).toMatch(/^= L\d+ clash "Sestava 5P" total=1 thread=1 underhead=0 real=0 undetermined=0$/m); // po pravidle závit
    expect(short).toMatch(/^D "Sestava 5P" asm .* clash=1\(thread=1,real=0\)$/m);
  }, 240_000);

  it("72: čtyři stejné nárazy hlav = jeden ⚠ „4×“ s instancemi, ne čtyři řádky", async () => {
    const { short } = await run(corpus("72-clash-group"));
    const real = lines(short, /clash\.real/);
    expect(real.length).toBe(1);
    expect(real[0]).toMatch(/4× kolize „Přidržovač“ × „Šroub M12“ \[#3, #4, #5, #6\] \(365,2 mm³\)/);
    expect(short).toMatch(/^= L\d+ clash "Sestava 5G" total=8 thread=4 underhead=0 real=4 undetermined=0$/m);
  }, 240_000);

  it("73: pohyb uvnitř podsestavy = šroub v závitu (dřív ⚠ „Horní skupina × Horní skupina“); kroků s kolizí jen se skutečnou kolizí", async () => {
    const { short, con } = await run(corpus("73-clash-motion-sub"));
    expect(lines(short, /clash\.undetermined/)).toEqual([]);
    expect(short).not.toMatch(/„Horní skupina“ × „Horní skupina“/);
    expect(short).toMatch(/^= L\d+ asm "Sestava 5S" motion .* clash\.steps=0\/6 thread=2 real=0$/m);
    expect(con).toMatch(/kolize šroub v závitu: Horní skupina › Deska A × Horní skupina › Šroub M12 \[S1\]/);
    // `stav`: pohyb bez skutečné kolize, ale ne „bez průniku těles“ (šrouby v závitu se protínají); motion=ok, ne clash
    expect(con).toMatch(/^Pohyb: výsledek platí .* bez skutečné kolize v kontrolovaných krocích \(jen šroub v závitu, dotyk nebo pracovní kontakt\)/m);
    expect(short).toMatch(/^= L\d+ status "Sestava 5S" .* motion=ok$/m);
    expect(short).toMatch(/^= L\d+ asm "Sestava 5M" motion .* clash\.steps=7\/16 thread=2 real=1 first\.real=9$/m);
    expect(short).toMatch(/clash\.real "Sestava 5M": v pohybu „Doraz“ × „Šroub M12 \[S2\]“ od kroku 9/);
  }, 240_000);

  it("74: pracovní kontakt razník × plech jen v okně operace (kroky / hodnota motoru); mimo okno ⚠; pravidla se dají vypsat a smazat", async () => {
    const { short, con } = await run(corpus("74-clash-work-rule"));
    const clash = lines(short, /^= L\d+ clash "Střih" total=/);
    expect(clash[0]).toMatch(/total=1 thread=0 underhead=0 real=1 undetermined=0$/); // kontrola bez pravidla
    expect(clash[1]).toMatch(/real=1 undetermined=0$/); // okno kroků staticky neplatí
    expect(short).toMatch(/^= L\d+ asm "Střih" motion .* clash\.steps=2\/5 thread=0 real=1 first\.real=3 work=1$/m);
    expect(lines(short, /clash\.work "Střih"/).length).toBeGreaterThanOrEqual(1);
    expect(clash.some((l) => /real=0 undetermined=0 work=1$/.test(l))).toBe(true); // okno hodnoty motoru platí i staticky (26 v 26–24)
    expect(con).toMatch(/r1 pracovní kontakt „Razník“ × „Plech“ při hodnotě vazby „ZDVIH“ 26–24 \(střih\)/);
    expect(short).toMatch(/^D "Střih" asm .* clash=1\(thread=0,real=1\)$/m); // pravidlo smazáno → konečný stav: skutečná kolize
  }, 240_000);
});
