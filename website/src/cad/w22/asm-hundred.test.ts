/**
 * Vlna 22, bod 23 (kolo 6) – „Rozsáhlé sestavy šly postavit textovými příkazy“: ponechat v regresi.
 *
 * Repro / korpus: engine/__corpus__/83-asm-hundred-text.txt (zlatý snímek z prohlížeče – parita Node i prohlížeč).
 * 100 komponent postavených jen textem (2 desky, 2 lišty, 48 šroubů v 6 textových polích `sestava pole`, 48 kolíků) se 101
 * vazbami (i na kopie z pole – odkazem na název); kolík „K 6-8“ je schválně
 * v horní desce = právě jedna skutečná kolize. Hlídá: všech 100 komponent a 101/101 vazeb, stručný protokol ≤ 2048 B BEZ
 * přebytku (nic se nevytlačilo do protocol-full.txt), každý řádek podle gramatiky, kolize nalezená na správné dvojici,
 * žádné ✓ za kolize (jedna skutečná) a čas běhu pod limitem (pomalé řešení vazeb / kolizí ve velké sestavě = FAIL).
 */
import fs from "node:fs";
import path from "node:path";
import { beforeAll, describe, expect, it } from "vitest";
import { setLang } from "../i18n";
import type { EngineHost } from "../engine/host";
import { MemoryWorkspace } from "../engine/memory-workspace";
import { DEFAULT_BUDGET, finalizeReport, grammarKind, utf8Bytes } from "../engine/protocol";
import { runReport } from "../engine/run-protocol";
import { runScript } from "../engine/run";
import { greenThenRed, realHost } from "./real-host";

const SCRIPT = fs.readFileSync(path.resolve(__dirname, "../engine/__corpus__/83-asm-hundred-text.txt"), "utf8");
/** limit času běhu v Node (CLI ~1,3 s; s rezervou na zatížený stroj) */
const LIMIT_MS = 60_000;

let host: () => EngineHost;
beforeAll(async () => {
  setLang("cs");
  host = await realHost();
}, 120_000);

describe("bod 23: sestava 100 komponent postavená textem (korpus 83)", () => {
  it("100 komponent, 101/101 vazeb, jedna skutečná kolize, stručný protokol ≤ 2048 B bez přebytku, čas pod limitem", async () => {
    // kolo 6 (oponent): šrouby textovým polem, ne jednotlivými vložit – rozsáhlá sestava polem je to, co má zůstat v regresi
    expect(SCRIPT.match(/^sestava pole "Š \d" 8 rozteč 34 směr X$/gm)).toHaveLength(6);
    const t0 = Date.now();
    const ws = new MemoryWorkspace();
    const r = finalizeReport(await runReport(ws, SCRIPT, host()));
    const ms = Date.now() - t0;
    expect(ms, `běh ${ms} ms`).toBeLessThan(LIMIT_MS);
    // stručný protokol: celý v rozpočtu, nic nevytlačené do přebytku
    const text = r.protocol ?? "";
    expect(DEFAULT_BUDGET).toBe(2048);
    expect(utf8Bytes(text) + 1).toBeLessThanOrEqual(2048);
    expect(r.overflow, JSON.stringify(r.overflow)).toBeUndefined();
    const lines = text.split("\n");
    for (const l of lines) expect(grammarKind(l), l).not.toBeNull();
    expect(lines[0]).toMatch(/^MNCAD\/1 OK lines=\d+ ops=\d+ err=0 warn=1 /);
    // sestava: všech 100 komponent a vazeb (strojový řádek D)
    const d = lines.find((l) => l.startsWith('D "Sto dílů" asm '));
    expect(d, text).toBeDefined();
    expect(d).toMatch(/ comp=100 parts=5 mates=101\/101 /);
    expect(d).toMatch(/ clash=1\(thread=0,real=1\)/);
    // právě jedna skutečná kolize – na správné dvojici, ne ✓ „bez kolizí“
    const real = r.entries.filter((e) => e.code === "clash.real");
    expect(real).toHaveLength(1);
    expect(real[0].text).toContain("„Deska B“ × „Kolík 6 [K 6-8]“");
    expect(lines.some((l) => /^= L\d+ clash "Sto dílů" total=1 thread=0 underhead=0 real=1 undetermined=0$/.test(l))).toBe(true);
    expect(r.entries.some((e) => e.level === "ok" && /bez koliz|kolize: žádné/i.test(e.text))).toBe(false);
    // žádná chyba, žádný řádek s ✓ i ✗ (22i), všechny vazby ok
    expect(r.entries.filter((e) => e.level === "error")).toEqual([]);
    expect(greenThenRed(r.entries)).toEqual([]);
    const mates = r.entries.filter((e) => e.level === "ok" && e.text.startsWith("vazba "));
    expect(mates).toHaveLength(101);
    // pole: 6 × ✓ pole s 7 kopiemi a názvy všech 100 komponent různé (bez přezdívky musí být název jednoznačný)
    expect(r.entries.filter((e) => e.level === "ok" && /^pole „Šroub M8“: 8 ks/.test(e.text))).toHaveLength(6);
    const asm = ws.present();
    const comps = asm.components ?? [];
    expect(comps).toHaveLength(100);
    const names = comps.filter((c) => !c.alias).map((c) => c.name);
    expect(names.length - new Set(names).size, names.join(", ")).toBe(0);
    expect(names).toContain("Šroub M8 (43)");
  }, 180_000);

  it("dvě textová pole téhož dílu: kopie mají volné názvy (2)…(4), (5)…(7) – ne dvakrát „(2)“; vazba na kopii jednoznačná", async () => {
    const ws = new MemoryWorkspace();
    const r = await runScript(ws, ['nový díl "Šroub M8"', "válec 4 30", 'nový díl "Deska"', "kvádr 200 200 10", 'nová sestava "S"', 'vložit "Deska" ukotvit', 'vložit "Šroub M8" v 0 0 10 jako "Š 1"', 'sestava pole "Š 1" 4 rozteč 30 směr X', 'vložit "Šroub M8" v 0 50 10 jako "Š 2"', 'sestava pole "Š 2" 4 rozteč 30 směr X', 'sestava vazba zámek "Šroub M8 (2)" "Deska"', 'sestava zrcadlit "Š 1" YZ', 'sestava zrcadlit "Š 1" YZ'].join("\n"), host());
    const errs = r.entries.filter((e) => e.level === "error");
    expect(errs, JSON.stringify(errs)).toEqual([]);
    const comps = ws.present().components ?? [];
    const names = comps.map((c) => c.name);
    // dva vložené šrouby se jmenují stejně (rozliší je přezdívka Š 1 / Š 2); kopie z polí přezdívku nemají → názvy různé
    const plain = comps.filter((c) => !c.alias).map((c) => c.name);
    expect(plain.length - new Set(plain).size, plain.join(", ")).toBe(0);
    expect([...plain].sort()).toEqual(["Deska", "Šroub M8 (2)", "Šroub M8 (3)", "Šroub M8 (4)", "Šroub M8 (5)", "Šroub M8 (6)", "Šroub M8 (7)", "Šroub M8 (zrcadlo 2)", "Šroub M8 (zrcadlo)"]);
    const l10 = r.entries.filter((e) => e.line === 10 && e.level === "ok");
    expect(l10[0]?.text).toMatch(/kopie „Šroub M8 \(5\)“ .*„Šroub M8 \(6\)“ .*„Šroub M8 \(7\)“/);
    // zrcadlení dvakrát: „(zrcadlo)“ a „(zrcadlo 2)“, ne dvě stejná jména
    expect(names.filter((n) => /zrcadlo/.test(n)).sort()).toEqual(["Šroub M8 (zrcadlo 2)", "Šroub M8 (zrcadlo)"]);
  }, 60_000);
});
