/**
 * Vlna 22, bod 23 (kolo 6) – „Rozsáhlé sestavy šly postavit textovými příkazy“: ponechat v regresi.
 *
 * Repro / korpus: engine/__corpus__/83-asm-hundred-text.txt (zlatý snímek z prohlížeče – parita Node i prohlížeč).
 * 100 komponent postavených jen textem (2 desky, 2 lišty, 48 šroubů, 48 kolíků) se 101 vazbami; kolík „K 6-8“ je schválně
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
    const t0 = Date.now();
    const r = finalizeReport(await runReport(new MemoryWorkspace(), SCRIPT, host()));
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
  }, 180_000);
});
