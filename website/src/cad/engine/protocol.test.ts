/**
 * Protokol běhu (CAD-HEADLESS-NAVRH.md kap. 4.4): zlatý test gramatiky v cs/en/de (strojová část bajtově shodná, každý
 * řádek projde regexem), rozpočet 2048 B na syntetickém nástroji P10 a na nejhorším případu (✗ první), priority, přebytek,
 * slučování záznamů, čísla nezávislá na Intl, JSON.
 */
import { afterEach, describe, expect, it } from "vitest";
import { setLang, type CadLang } from "../i18n";
import { CODES, codeEntry, type Code } from "./codes";
import {
  DEFAULT_BUDGET,
  GRAMMAR,
  ReportBuilder,
  entryLines,
  finalizeReport,
  fmtNum,
  formatFull,
  formatShort,
  grammarKind,
  isoDate,
  locOf,
  measureKind,
  mergeEntries,
  quote,
  shortProtocol,
  toJson,
  utf8Bytes,
  type ShortProtocol,
} from "./protocol";
import type { DocSummary, Entry, OutFile, RunReport } from "./protocol-types";

afterEach(() => setLang("cs"));

const B = (s: string) => Buffer.byteLength(s, "utf8");
const MAIN = "959-01-00 Nástroj";
const PARTS = [
  "959-01-00-01 Základová deska",
  "959-01-00-02 Kotevní deska",
  "959-01-00-03 Střižnicová deska",
  "959-01-00-04 Opěrná deska",
  "959-01-00-05 Stírací deska",
  "959-01-00-06 Vodicí lišta L",
  "959-01-00-07 Vodicí lišta P",
  "959-01-00-08 Střižník Ø20",
  "959-01-00-09 Střižnice",
  "959-01-00-10 Sloupek Ø25",
  "959-01-00-11 Pouzdro Ø25",
  "959-01-00-12 Pružina 20×2,5×50",
  "959-01-00-13 Distanční podložka",
  "959-01-00-14 Doraz",
  "959-01-00-15 Stopka",
  "959-01-00-16 Hledáček",
  "959-01-00-17 Štítek",
  "Kolík Ø8×40 ISO 8734",
  "Šroub M10×60 ISO 4762",
];
const box = (x: number, y: number, z: number): DocSummary["bbox"] => [
  [0, 0, 0],
  [x, y, z],
];

/** Syntetický běh nástroje 397 řádků (P10) – záznamy přes registr kódů, takže volný text je v aktuálním jazyce. */
function p10Report(): RunReport {
  const rb = new ReportBuilder({ lang: "cs", lines: 397, now: () => 0 });
  for (let i = 1; i <= 300; i++) rb.ok(i, `prvek ${i}`);
  rb.code("build.failed", { doc: PARTS[2], args: ["prvek „Úkos 2“"] });
  for (const l of [120, 131, 142]) rb.code("hole.cbore-dropped", { line: l, doc: PARTS[0], args: ["16", "M10"] });
  rb.code("drawing.section-miss", { line: 57, doc: MAIN, args: ["list 1, XZ 0"] });
  for (let i = 0; i < 40; i++) rb.code("select.ambiguous", { line: 200 + i * 5 });
  for (let i = 0; i < 6; i++) rb.code("ui.no-view", { line: 380 + i, args: ["pohled iso"] });
  for (const [l, nm] of [
    [388, PARTS[0]],
    [390, PARTS[2]],
    [392, PARTS[7]],
  ] as const)
    rb.measure(l, "measure", `V=${fmtNum(2347.216, 3)}cm3 m=${fmtNum(18.426, 3)}kg bbox=300x200x40 solids=1 valid=1`, { doc: nm });
  rb.measure(394, "clash", "total=40 thread=40 real=0 undetermined=0", { doc: MAIN });
  rb.measure(395, "motion", "steps=40 stroke=60 conflicts=0 clashes=0 t=12.1", { doc: MAIN });
  const rows = PARTS.map((nm, i) => `${quote(nm)} n=${(i % 4) + 1} V=${fmtNum(100 + i * 37.3)}cm3 m=${fmtNum(0.8 + i * 0.29)}kg bbox=${fmtNum(300 - i)}x${fmtNum(200 - i)}x${fmtNum(40 - i / 2)}`);
  rb.measure(396, "check", [`parts=19 comp=70 V=5241.73cm3 m=41.15kg mates=53/53`, ...rows].join("\n"), { doc: MAIN });
  for (let i = 0; i < 389; i++) rb.op(i + 1, "feature", 10);
  rb.op(395, "asm", 12100);
  rb.memory(812);
  const docs: DocSummary[] = [
    { ref: "d0", name: MAIN, kind: "assembly", main: true, components: 70, parts: 19, mates: { total: 53, ok: 53, conflict: 0, missing: 0, suppressed: 0 }, volume_mm3: 5241730, volume_union_mm3: 5239110, mass_kg: 41.15, clashes: { total: 40, thread: 40, real: 0, undetermined: 0 }, sheets: 4 },
    ...PARTS.map((nm, i): DocSummary => ({ ref: `d${i + 1}`, name: nm, kind: "part", features: i === 0 ? { ok: 12, warn: 0, error: 1 } : i === 2 ? { ok: 8, warn: 1, error: 0 } : { ok: 6, warn: 0, error: 0 }, volume_mm3: i === 2 ? undefined : 2347216 - i * 1000, mass_kg: i === 2 ? undefined : 18.426, bbox: i === 2 ? undefined : box(300, 200, 40) })),
  ];
  const files: OutFile[] = [
    { name: `${MAIN}.step`, format: "step", bytes: 1402368, sha256: "0".repeat(64), doc: MAIN, check: { ok: true, text: "" }, run: "fail" },
    { name: `${MAIN} výkres.pdf`, format: "pdf", bytes: 831488, sha256: "1".repeat(64), doc: MAIN, sheets: 4, run: "fail" },
    { name: `${MAIN}.mncad`, format: "mncad", bytes: 412001, sha256: "2".repeat(64), doc: MAIN, run: "fail" },
  ];
  return rb.finish({ docs, files, share: { url: "https://www.mnastrojarna.cz/cad#q=XW830bNW7w.UmyMkW-xoYRPXawojuAAqw", mode: "store", bytes: 61, exp: "2026-11-23" }, ms: 41800 });
}

/** nejhorší případ (P10): 12 ✗ rozboru + 30 různých kódů ⚠ nad syntetickým během */
function worstReport(): RunReport {
  const r = p10Report();
  // různé kódy = nic se neslučuje (stejný kód a dokument by se sloučil do jednoho řádku)
  const warnCodes = CODES.filter((c) => c.level === "warn").map((c) => c.code as Code).slice(0, 30);
  const errCodes = CODES.filter((c) => c.level === "error" && c.code !== "build.failed").map((c) => c.code as Code).slice(0, 12);
  expect([warnCodes.length, errCodes.length]).toEqual([30, 12]);
  const extra: Entry[] = [
    ...errCodes.map((c, i) => codeEntry(c, { line: 10 + i, text: `neznámý příkaz „xyz${i}“ – nápověda hledat xyz${i}` })),
    ...warnCodes.map((c, i) => codeEntry(c, { line: 100 + i * 7, text: `varování číslo ${i} s nějakým textem o délce kolem osmdesáti bajtů` })),
  ];
  return { ...r, entries: [...r.entries, ...extra], counts: { ...r.counts, errors: r.counts.errors + 12, warnings: r.counts.warnings + 30 } };
}

/** strojová část řádku: u ✗/⚠/ℹ vše před volným textem (symbol, loc, ×k, kód, název dokumentu), jinak celý řádek */
function machine(line: string): string {
  const m = /^((?:✗|⚠|ℹ) \S+(?: ×\d+)? [a-z0-9.-]+(?: "(?:[^"\\]|\\.)*")?)(?::? (.*))?$/.exec(line);
  return m ? m[1] : line;
}
function freeText(line: string): string {
  const m = /^(?:✗|⚠|ℹ) \S+(?: ×\d+)? [a-z0-9.-]+(?: "(?:[^"\\]|\\.)*")?(?::? (.*))?$/.exec(line);
  return m?.[1] ?? "";
}
/** každý řádek projde gramatikou; pokračovací řádky jen za řádkem `=` */
function checkGrammar(text: string) {
  const bad: string[] = [];
  let prev: string | null = null;
  for (const l of text.split("\n")) {
    const k = grammarKind(l);
    if (!k) bad.push(l);
    if (k === "cont" && prev !== "measure" && prev !== "cont") bad.push(`cont after ${prev}: ${l}`);
    prev = k;
  }
  return bad;
}
/** záznamy těla stručného protokolu (bez hlavičky, značky přebytku a Σ); pokračovací řádky výpisu patří k řádku `=` */
function bodyItems(text: string): string[] {
  const out: string[] = [];
  for (const l of text.split("\n").slice(1, -1)) {
    if (GRAMMAR.overflow.test(l)) continue;
    if (GRAMMAR.cont.test(l) && out.length) out[out.length - 1] += "\n" + l;
    else out.push(l);
  }
  return out;
}
/** priorita podle kap. 4.1 z tvaru řádku: ✗ > ⚠ > F/O > jednořádkové = > D > výpis > ℹ */
const prioOf = (t: string) => (t.startsWith("✗") ? 0 : t.startsWith("⚠") ? 1 : /^[FO] /.test(t) ? 2 : t.startsWith("= ") ? (t.includes("\n") ? 5 : 3) : t.startsWith("D ") ? 4 : t.startsWith("ℹ") ? 6 : 99);
const markerB = (n: number, bytes: number) => (n > 0 ? B(`… ${n} entries ${bytes}B in protocol-full.txt`) + 1 : 0);

/**
 * Výběr řádků do rozpočtu jako černá skříňka nad textem (4.1). `all` = všechny kandidáty (protokol bez omezení).
 * (a) přesná priorita: žádný vynechaný záznam by se nevešel, ani kdyby se vynechaly VŠECHNY vypsané záznamy nižší priority
 *     (tedy nikdy ⚠ místo ✗, který by se vešel, ani F místo O apod.);
 * (b) maximalita: žádný vynechaný záznam by se už nevešel do zbylého místa (se značkou za zbylé vynechané);
 * (c) přebytek a velikost přesně odpovídají vynechaným záznamům; rozpočet drží.
 */
function checkSelection(s: ShortProtocol, all: string[]) {
  const kept = bodyItems(s.text);
  const isKept: boolean[] = [];
  let j = 0;
  for (const t of all) {
    const k = j < kept.length && kept[j] === t;
    isKept.push(k);
    if (k) j++;
  }
  expect(j, "vypsané záznamy = podposloupnost všech kandidátů v pořadí tisku").toBe(kept.length);
  const lines = s.text.split("\n");
  const fixed = B(lines[0]) + 1 + B(lines.at(-1)!) + 1;
  const bytes = all.map((t) => B(t) + 1);
  const order = all.map((_, i) => i).sort((a, b) => prioOf(all[a]) - prioOf(all[b]) || a - b);
  const total = bytes.reduce((a, b) => a + b, 0);
  const keptBytes = order.filter((i) => isKept[i]).reduce((a, i) => a + bytes[i], 0);
  const dropped = order.filter((i) => !isKept[i]);
  const droppedBytes = total - keptBytes;
  expect(s.overflow ? [s.overflow.entries, s.overflow.bytes] : [0, 0]).toEqual([dropped.length, droppedBytes]);
  expect(s.bytes).toBe(fixed + keptBytes + markerB(dropped.length, droppedBytes));
  expect(s.bytes).toBeLessThanOrEqual(s.budget);
  let hiN = 0;
  let hiB = 0;
  for (const x of order) {
    if (isKept[x]) {
      hiN++;
      hiB += bytes[x];
      continue;
    }
    // (a) jen vypsané záznamy vyšší priority + x; všechno ostatní do přebytku
    const strict = fixed + hiB + bytes[x] + markerB(all.length - hiN - 1, total - hiB - bytes[x]);
    expect(strict, `přesná priorita: ${all[x].slice(0, 50)}`).toBeGreaterThan(s.budget);
    // (b) všechny vypsané + x
    const max = fixed + keptBytes + bytes[x] + markerB(dropped.length - 1, droppedBytes - bytes[x]);
    expect(max, `maximalita: ${all[x].slice(0, 50)}`).toBeGreaterThan(s.budget);
  }
}
const allItems = (r: RunReport, notes = false) => bodyItems(formatShort(r, { budget: Infinity, notes }));

/** spustí `fn` s výchozím Intl v daném locale (Number/Date toLocaleString bez locale → `loc`) */
function withDefaultLocale<T>(loc: string, fn: () => T): T {
  const n = Number.prototype.toLocaleString;
  const d = Date.prototype.toLocaleDateString;
  const ds = Date.prototype.toLocaleString;
  Number.prototype.toLocaleString = function (this: number, l?: string | string[], o?: Intl.NumberFormatOptions) {
    return n.call(this, l ?? loc, o);
  };
  Date.prototype.toLocaleDateString = function (this: Date, l?: string | string[], o?: Intl.DateTimeFormatOptions) {
    return d.call(this, l ?? loc, o);
  };
  Date.prototype.toLocaleString = function (this: Date, l?: string | string[], o?: Intl.DateTimeFormatOptions) {
    return ds.call(this, l ?? loc, o);
  };
  try {
    return fn();
  } finally {
    Number.prototype.toLocaleString = n;
    Date.prototype.toLocaleDateString = d;
    Date.prototype.toLocaleString = ds;
  }
}

/** zlatý výstup (cs) syntetického nástroje P10 – mění se jen záměrnou změnou gramatiky */
const GOLDEN_CS = `MNCAD/1 FAIL lines=397 ops=390 err=1 warn=44 note=6 t=41.8
✗ L- build.failed "959-01-00-03 Střižnicová deska": stavba selhala: prvek „Úkos 2“
⚠ L57 drawing.section-miss "959-01-00 Nástroj": rovina řezu neprotíná těleso: list 1, XZ 0
⚠ L120,L131,L142 ×3 hole.cbore-dropped "959-01-00-01 Základová deska": zahloubení Ø16 je menší než závit M10
⚠ L200-L395 ×40 select.ambiguous více vyhovujících ploch – použita první
= L388 measure "959-01-00-01 Základová deska" V=2347.216cm3 m=18.426kg bbox=300x200x40 solids=1 valid=1
= L390 measure "959-01-00-03 Střižnicová deska" V=2347.216cm3 m=18.426kg bbox=300x200x40 solids=1 valid=1
= L392 measure "959-01-00-08 Střižník Ø20" V=2347.216cm3 m=18.426kg bbox=300x200x40 solids=1 valid=1
= L394 clash "959-01-00 Nástroj" total=40 thread=40 real=0 undetermined=0
= L395 motion "959-01-00 Nástroj" steps=40 stroke=60 conflicts=0 clashes=0 t=12.1
D "959-01-00 Nástroj" asm comp=70 parts=19 mates=53/53 V.sum=5241.73cm3 V.union=5239.11cm3 m=41.15kg clash=40(thread=40,real=0) sheets=4
D "959-01-00-01 Základová deska" part feat=12/0/1 V=2347.22cm3 m=18.426kg bbox=300x200x40
D "959-01-00-03 Střižnicová deska" part feat=8/1/0 V=- bbox=-
F step "959-01-00 Nástroj.step" 1402368B check=ok run=fail
F pdf "959-01-00 Nástroj výkres.pdf" 831488B sheets=4 run=fail
F mncad "959-01-00 Nástroj.mncad" 412001B run=fail
O https://www.mnastrojarna.cz/cad#q=XW830bNW7w.UmyMkW-xoYRPXawojuAAqw exp=2026-11-23 mode=store
… 1 entries 1453B in protocol-full.txt
Σ docs=20 comp=70 mates=53/53 V.sum=5241.73cm3 V.union=5239.11cm3 clash=thread:40,real:0 files=3 share=store t=41.8 slow=L395:asm:12.1 mem=812MB`;

describe("protokol – zlatý test gramatiky cs/en/de (4.4)", () => {
  const runs: Record<string, string> = {};
  for (const [lang, loc] of [
    ["cs", "cs-CZ"],
    ["en", "en-GB"],
    ["de", "de-DE"],
  ] as [CadLang, string][]) {
    runs[lang] = (() => {
      setLang(lang);
      const r = p10Report();
      return withDefaultLocale(loc, () => formatShort(r));
    })();
  }
  setLang("cs");

  it("cs = zlatý výstup bajt po bajtu", () => {
    expect(runs.cs).toBe(GOLDEN_CS);
  });
  for (const lang of ["cs", "en", "de"]) {
    it(`${lang}: každý řádek projde jedním regexem gramatiky`, () => {
      expect(checkGrammar(runs[lang])).toEqual([]);
    });
  }
  it("strojová část (vše kromě volného textu za kódem) je v cs/en/de bajtově shodná", () => {
    const m = (t: string) => t.split("\n").map(machine);
    expect(m(runs.en)).toEqual(m(runs.cs));
    expect(m(runs.de)).toEqual(m(runs.cs));
    // počet řádků i pořadí stejné; volný text se liší (překlad kódů je aktivní)
    const free = (t: string) => t.split("\n").map(freeText);
    expect(free(runs.en)).not.toEqual(free(runs.cs));
    expect(free(runs.de)).not.toEqual(free(runs.en));
    expect(runs.en).toContain("⚠ L200-L395 ×40 select.ambiguous several matching faces – the first one is used");
    expect(runs.de).toContain("⚠ L200-L395 ×40 select.ambiguous mehrere passende Flächen – die erste wird verwendet");
  });
  it("čísla: tečka, bez seskupení, bez U+00A0/U+202F i při výchozím Intl cs-CZ/de-DE", () => {
    for (const t of Object.values(runs)) {
      const mach = t.split("\n").map(machine).join("\n");
      expect(mach).not.toMatch(/[  ]/);
      expect(mach).not.toMatch(/\d,\d{3}\b(?![^"]*")/); // žádná desetinná čárka / seskupení mimo názvy v uvozovkách
      expect(mach).toContain("V.sum=5241.73cm3");
    }
    for (const loc of ["cs-CZ", "de-DE", "en-US"]) withDefaultLocale(loc, () => expect([fmtNum(5241.73), fmtNum(1234567.891, 3), fmtNum(-0.00001), fmtNum(0.5, 0)]).toEqual(["5241.73", "1234567.891", "0", "1"]));
  });
  it("hlavička je ASCII a datum ISO", () => {
    expect(runs.cs.split("\n")[0]).toMatch(/^[\x20-\x7e]+$/);
    expect(runs.cs).toMatch(/exp=2026-11-23 mode=store/);
  });
});

describe("protokol – tvrdý rozpočet a priority (4.1)", () => {
  it(`P10 syntetický nástroj ≤ ${DEFAULT_BUDGET} B, výpis kontroly sestavy jde do přebytku`, () => {
    const s = shortProtocol(p10Report());
    expect(s.bytes).toBe(B(s.text) + 1);
    expect(s.bytes).toBeLessThanOrEqual(2048);
    expect(s.overflow).toEqual({ entries: 1, bytes: expect.any(Number), file: "protocol-full.txt" });
    expect(s.text).not.toContain("= L396 check");
    expect(formatFull(p10Report())).toContain("= L396 check");
  });
  it("nejhorší případ (12 ✗ + 30 různých ⚠) ≤ 2048 B, ✗ všechny a první, výběr ⚠ s přesnou prioritou a maximální", () => {
    const r = worstReport();
    const s = shortProtocol(r);
    const lines = s.text.split("\n");
    expect(s.bytes).toBeLessThanOrEqual(2048);
    expect(checkGrammar(s.text)).toEqual([]);
    const err = lines.filter((l) => l.startsWith("✗"));
    const warn = lines.filter((l) => l.startsWith("⚠"));
    expect(err.length).toBe(13); // 12 parse.unknown + build.failed
    expect(lines.findIndex((l) => l.startsWith("⚠"))).toBeGreaterThan(lines.findLastIndex((l) => l.startsWith("✗")));
    const all = allItems(r);
    expect(warn.length).toBeLessThan(all.filter((l) => l.startsWith("⚠")).length);
    checkSelection(s, all);
    expect(lines.at(-2)).toMatch(GRAMMAR.overflow);
    expect(lines.at(-1)).toMatch(/^Σ /);
    expect(lines[0]).toMatch(GRAMMAR.header);
    // každý rozpočet od minima do 2100 B: přesná priorita, maximalita, gramatika
    const min = shortProtocol(r, { budget: 0 }).budget;
    for (let budget = min; budget <= 2100; budget += 3) {
      const sb = shortProtocol(r, { budget });
      checkSelection(sb, all);
      expect(checkGrammar(sb.text)).toEqual([]);
    }
  });
  it("300 dlouhých ✗: rozpočet drží, ✗ jsou souvislý začátek v pořadí řádků, Σ poslední", () => {
    const rb = new ReportBuilder({ lang: "cs", lines: 400 });
    for (let i = 0; i < 300; i++) rb.code("op.failed", { line: i + 1, doc: `Díl ${i}`, args: ["x".repeat(150 + (i % 17))] });
    rb.code("select.ambiguous", { line: 5 });
    const s = shortProtocol(rb.finish({ docs: [{ ref: "a", name: "Díl 0", kind: "part", main: true }] }));
    const lines = s.text.split("\n");
    expect(s.bytes).toBeLessThanOrEqual(2048);
    const err = lines.filter((l) => l.startsWith("✗"));
    expect(err.length).toBeGreaterThan(5);
    expect(err.map((l) => Number(/^✗ L(\d+)/.exec(l)![1]))).toEqual(err.map((_, i) => i + 1));
    expect(err.every((l) => [...freeText(l)].length <= 160)).toBe(true);
    expect(s.overflow!.entries).toBeGreaterThan(290);
  });
  it("priority: řádky stejné délky – při každém rozpočtu je vypsaná množina tříd začátkem pořadí ✗ > ⚠ > F/O > = > D > výpis", () => {
    // šest tříd, každá jeden řádek (výpis dva) – výplně se dorovnají tak, aby všechny řádky měly stejný počet bajtů
    const make = (pad: number[]) => {
      const x = (i: number) => "x".repeat(pad[i]);
      const rb = new ReportBuilder({ lang: "cs", lines: 10 });
      rb.code("op.failed", { line: 1, text: x(0) });
      rb.code("select.fallback", { line: 2, text: x(1) });
      rb.measure(3, "measure", `V=1cm3 ${x(3)}`);
      rb.measure(4, "check", `a=${x(5)}\nb`);
      const docs: DocSummary[] = [{ ref: "m", name: x(4), kind: "draft", main: true }];
      const files: OutFile[] = [{ name: x(2), format: "step", bytes: 1, sha256: "", doc: "m" }];
      return rb.finish({ docs, files });
    };
    const cls = (l: string) => (l.startsWith("✗") ? 0 : l.startsWith("⚠") ? 1 : l.startsWith("F ") ? 2 : l.startsWith("= L3") ? 3 : l.startsWith("D ") ? 4 : l.startsWith("= L4") ? 5 : -1);
    const sizes = (r: RunReport) => {
      const s = [0, 0, 0, 0, 0, 0];
      for (const l of formatShort(r, { budget: 1e6 }).split("\n")) if (cls(l) >= 0) s[cls(l)] += B(l) + 1;
      s[5] += 2; // pokračovací řádek výpisu „  b“
      return s;
    };
    let pad = [60, 60, 60, 60, 60, 60];
    const s0 = sizes(make(pad));
    const T = Math.max(...s0);
    pad = pad.map((p, i) => p + T - s0[i]);
    const r = make(pad);
    expect(new Set(sizes(r)).size).toBe(1);
    const min = shortProtocol(r, { budget: 0 }).budget;
    let seen = 0;
    for (let budget = min; budget <= 2048; budget++) {
      const s = shortProtocol(r, { budget });
      expect(s.bytes).toBeLessThanOrEqual(budget);
      const kept = [...new Set(s.text.split("\n").map(cls).filter((c) => c >= 0))].sort();
      expect(kept).toEqual([0, 1, 2, 3, 4, 5].slice(0, kept.length));
      seen |= 1 << kept.length;
    }
    expect(seen).toBe(0b1111111); // prošly všechny stupně 0…6 tříd
  });
  it("dlouhý záznam, který se nevejde, se přeskočí – kratší záznam téže priority se vypíše dřív než nižší priorita (jako sonda P10)", () => {
    const rb = new ReportBuilder({ lang: "cs", lines: 9 });
    rb.code("select.fallback", { line: 1, doc: "A", text: "a".repeat(36) });
    rb.code("select.fallback", { line: 2, doc: "B", text: "b".repeat(150) }); // nevejde se
    rb.code("select.fallback", { line: 3, doc: "C", text: "c" }); // vejde se → vypíše se (před F)
    const r = rb.finish({ files: [{ name: "a.step", format: "step", bytes: 1, sha256: "", doc: "a" }] });
    const fixed = B(formatShort(r, { budget: 0 })) + 1; // hlavička + značka + Σ
    const s = shortProtocol(r, { budget: fixed + 70 + 30 });
    expect(s.text).toContain('⚠ L1 select.fallback "A": aaaa');
    expect(s.text).not.toContain("L2");
    expect(s.text).toContain('⚠ L3 select.fallback "C": c');
    expect(s.overflow!.entries).toBe(2); // ⚠ L2 a F (F se už nevešel)
    checkSelection(s, allItems(r));
  });
  it("regrese: ✗, které se vejdou, se nikdy nevynechají kvůli ⚠ (nález recenze, sonda p3c: ✗ L31/L32 za dlouhým ✗ L30)", () => {
    const make = (n: number, pad: number) => {
      const rb = new ReportBuilder({ lang: "cs", lines: 397, now: () => 0 });
      rb.code("parse.error", { line: 5, args: ["kvádr " + "1".repeat(pad)] });
      for (let i = 0; i < n; i++) rb.code("feature.failed", { line: 10 + i, doc: `959-01-00-0${i} Deska ${i}`, args: [`Úkos ${i}`, "plocha pro úkos nenalezena – zkontrolujte výběr ploch a směr vytažení prvku"] });
      rb.code("feature.failed", { line: 30, doc: "959-01-00-09 Střižnice", args: ["Zaoblení 7", "poloměr zaoblení 6 mm je větší než nejkratší sousední hrana; zmenšete poloměr nebo vyberte jiné hrany, jinak se těleso nepostaví a sestava zůstane bez střižnice"] });
      rb.code("parse.unknown", { line: 31, args: ["vložit2"] });
      rb.code("op.failed", { line: 32, args: ["sestava hotovo bez upravit"] });
      rb.code("select.ambiguous", { line: 120 });
      rb.code("drawing.section-miss", { line: 57, doc: MAIN, args: ["list 1, XZ 0"] });
      return rb.finish({ docs: [{ ref: "m", name: MAIN, kind: "assembly", main: true, components: 70 }], files: [{ name: `${MAIN}.step`, format: "step", bytes: 1402368, sha256: "", doc: "m" }], share: { url: "https://www.mnastrojarna.cz/cad#q=XW830bNW7w.UmyMkW-xoYRPXawojuAAqw", mode: "store", bytes: 61, exp: "2026-11-23" } });
    };
    // přesně případ z recenze (n=10, pad=11): dříve ✗ L31 a ✗ L32 v přebytku a ⚠ L57, ⚠ L120 vypsané
    const s = shortProtocol(make(10, 11));
    expect(s.text).toContain("✗ L31 parse.unknown neznámý příkaz „vložit2“");
    expect(s.text).toContain("✗ L32 op.failed příkaz selhal: sestava hotovo bez upravit");
    checkSelection(s, allItems(make(10, 11)));
    for (let n = 5; n <= 12; n++)
      for (let pad = 1; pad <= 158; pad += 3) {
        const r = make(n, pad);
        checkSelection(shortProtocol(r), allItems(r));
      }
  });
  it("regrese: O se vypíše, když se vejde, i když se delší F nevešel (nález recenze, rozpočet 219)", () => {
    const rb = new ReportBuilder({ lang: "cs", lines: 9, now: () => 0 });
    const r = rb.finish({
      files: [{ name: "Velmi dlouhý název souboru výkresu sestavy střižného nástroje 959-01-00 včetně všech listů a kusovníku.pdf", format: "pdf", bytes: 831488, sha256: "", doc: "d", sheets: 4 }],
      share: { url: "https://www.mnastrojarna.cz/cad#q=XW830bNW7w.UmyMkW-xoYRPXawojuAAqw", mode: "store", bytes: 61, exp: "2026-11-23" },
    });
    const s = shortProtocol(r, { budget: 219 });
    expect(s.text).toContain("\nO https://www.mnastrojarna.cz/cad#q=XW830bNW7w.UmyMkW-xoYRPXawojuAAqw exp=2026-11-23 mode=store\n");
    expect(s.overflow?.entries).toBe(1);
    const all = allItems(r);
    const min = shortProtocol(r, { budget: 0 }).budget;
    for (let budget = min; budget <= min + 400; budget++) checkSelection(shortProtocol(r, { budget }), all);
  });
  it("D jen hlavní dokument a dokumenty s ✗/⚠ (ze stavby nebo ze záznamů); plný protokol má D všech", () => {
    const rb = new ReportBuilder({ lang: "cs", lines: 3 });
    rb.code("select.ambiguous", { line: 2, doc: "B" });
    const r = rb.finish({
      docs: [
        { ref: "1", name: "A", kind: "part", features: { ok: 1, warn: 0, error: 0 } },
        { ref: "2", name: "B", kind: "part" },
        { ref: "3", name: "C", kind: "part", features: { ok: 0, warn: 0, error: 1 } },
        { ref: "4", name: "S", kind: "assembly", components: 2 },
      ],
    });
    const d = formatShort(r)
      .split("\n")
      .filter((l) => l.startsWith("D "));
    expect(d.map((l) => /^D "([^"]*)"/.exec(l)![1])).toEqual(["S", "B", "C"]); // hlavní = poslední sestava, první
    expect(formatFull(r).split("\n").filter((l) => l.startsWith("D ")).length).toBe(4);
  });
  it("ℹ jen s notes, s nejnižší prioritou; bez notes se nepočítají do přebytku", () => {
    const rb = new ReportBuilder({ lang: "cs", lines: 3 });
    rb.code("ui.no-view", { line: 1, args: ["pohled iso"] });
    const r = rb.finish();
    expect(formatShort(r)).not.toContain("ℹ");
    expect(shortProtocol(r).overflow).toBeUndefined();
    expect(formatShort(r, { notes: true })).toContain("ℹ L1 ui.no-view bez 3D okna nemá příkaz účinek: pohled iso");
  });
  it("náhodné reporty (400 případů): rozpočet, gramatika, pořadí tisku, přesný počet přebytku", () => {
    let seed = 12345;
    const rnd = () => ((seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff);
    const pick = <T>(a: readonly T[]) => a[Math.floor(rnd() * a.length)];
    const words = ["díra", "Ø8,5", "„X“", 'quote "q"', '"začíná uvozovkou', "back\\slash", "nový\nřádek", "a\u2028b", "c\u2029d", "e\u0085f", "\u001b[31m", "\t", "😀", "€", "x".repeat(60), "kvádr 10 20 30"];
    const txt = () => Array.from({ length: 1 + Math.floor(rnd() * 12) }, () => pick(words)).join(" ");
    const order = (l: string) => (l.startsWith("MNCAD") ? 0 : l.startsWith("✗") ? 1 : l.startsWith("⚠") ? 2 : l.startsWith("ℹ") ? 3 : l.startsWith("=") || l.startsWith("  ") ? 4 : l.startsWith("D ") ? 5 : l.startsWith("F ") ? 6 : l.startsWith("O ") ? 7 : l.startsWith("…") ? 8 : 9);
    for (let n = 0; n < 400; n++) {
      const rb = new ReportBuilder({ lang: "cs", lines: 500 });
      const docs: DocSummary[] = Array.from({ length: Math.floor(rnd() * 5) }, (_, i) => ({ ref: `r${i}`, name: `Dok ${txt()}`, kind: pick(["part", "assembly", "draft"] as const), main: i === 0 && rnd() < 0.5, features: { ok: 1, warn: Math.floor(rnd() * 2), error: 0 }, volume_mm3: rnd() * 1e7, bbox: box(rnd() * 500, rnd() * 500, rnd() * 50) }));
      const codes = CODES.map((c) => c.code as Code);
      for (let i = Math.floor(rnd() * 60); i > 0; i--) {
        const k = rnd();
        if (k < 0.6) rb.code(pick(codes), { line: rnd() < 0.1 ? null : 1 + Math.floor(rnd() * 400), doc: rnd() < 0.4 && docs.length ? pick(docs).name : undefined, text: txt() });
        else if (k < 0.8) rb.measure(1 + Math.floor(rnd() * 400), pick(["measure", "clash", "Bad.Kind", "check", "compare-2d", "měření"]), rnd() < 0.3 ? `a=1\n${txt()}\n\n  ${txt()}` : `k=${fmtNum(rnd() * 1e5, 3)}`, { doc: rnd() < 0.5 ? txt() : undefined });
        else rb.ok(1 + Math.floor(rnd() * 400), txt());
      }
      const files: OutFile[] = Array.from({ length: Math.floor(rnd() * 4) }, () => ({ name: `${txt()}.step`, format: pick(["step", "PDF", "dxf", "?"]), bytes: Math.floor(rnd() * 1e6), sha256: "", doc: "x", ...(rnd() < 0.5 ? { run: "fail" as const } : {}) }));
      const r = rb.finish({ docs, files, ...(rnd() < 0.5 ? { share: { url: "https://x.cz/cad#q=a b", mode: pick(["store", "self", "link"] as const), bytes: 1, exp: rnd() < 0.5 ? null : "2026-12-01T10:00:00Z" } } : {}) });
      const budget = 300 + Math.floor(rnd() * 3800);
      const notes = rnd() < 0.3;
      const s = shortProtocol(r, { budget, notes });
      expect(s.bytes).toBe(B(s.text) + 1);
      expect(s.bytes).toBeLessThanOrEqual(s.budget);
      expect(s.budget).toBeGreaterThanOrEqual(budget);
      if (s.budget > budget) expect(s.text.split("\n").length).toBeLessThanOrEqual(3); // zvýšené minimum: hlavička, značka, Σ
      expect(checkGrammar(s.text), s.text).toEqual([]);
      const lines = s.text.split("\n");
      const ord = lines.map(order);
      expect(ord).toEqual([...ord].sort((a, b) => a - b));
      expect(lines[0]).toMatch(GRAMMAR.header);
      expect(lines.at(-1)).toMatch(GRAMMAR.sum);
      const big = shortProtocol(r, { budget: 1e7, notes });
      const items = (t: string) => t.split("\n").filter((l) => !/^(MNCAD|Σ|…| {2})/.test(l)).length;
      expect(big.overflow).toBeUndefined();
      expect(items(s.text) + (s.overflow?.entries ?? 0)).toBe(items(big.text));
      checkSelection(s, allItems(r, notes));
    }
  });
});

describe("protokol – slučování, formáty, JSON", () => {
  it("stejný kód a dokument se slučují: L120,L131,L142 ×3; víc než 6 řádků → rozsah; JSON lines úplné", () => {
    const es: Entry[] = [120, 131, 142].map((l) => codeEntry("hole.cbore-dropped", { line: l, doc: "A", args: [16, "M10"] }));
    es.push(codeEntry("hole.cbore-dropped", { line: 150, doc: "B", args: [16, "M10"] }));
    const m = mergeEntries(es);
    expect(m.length).toBe(2);
    expect(m[0]).toMatchObject({ line: 120, lines: [120, 131, 142], count: 3, doc: "A" });
    expect(mergeEntries(m)).toEqual(m); // idempotentní
    const many = mergeEntries(Array.from({ length: 40 }, (_, i) => codeEntry("select.ambiguous", { line: 200 + i * 5 })));
    expect(many[0].lines!.length).toBe(40);
    expect(locOf(entryLines(many[0]))).toBe("L200-L395");
    expect(locOf(entryLines(many[0]), true)).toContain("L205,L210");
    expect(locOf([1, 2, 3, 4, 5, 6])).toBe("L1,L2,L3,L4,L5,L6");
    expect(locOf([])).toBe("L-");
    const nul = mergeEntries([codeEntry("host.fonts"), codeEntry("host.fonts")]);
    expect(nul).toEqual([expect.objectContaining({ line: null, count: 2 })]);
  });
  it("regrese: hlášky s různým textem nebo daty se neslučují – žádný výskyt se neztratí (stručný, plný i JSON)", () => {
    const rb = new ReportBuilder({ lang: "cs", lines: 50, now: () => 0 });
    rb.code("clash.real", { line: 40, doc: "Nástroj", args: ["Deska A", "Šroub 1", 12] });
    rb.code("clash.real", { line: 41, doc: "Nástroj", args: ["Lišta P", "Kolík 3", 0.4], data: { pair: ["Lišta P", "Kolík 3"] } });
    rb.code("feature.failed", { line: 10, doc: "Deska", args: ["Úkos 2", "plocha nenalezena"] });
    rb.code("feature.failed", { line: 12, doc: "Deska", args: ["Zaoblení 3", "poloměr příliš velký"] });
    rb.code("parse.unknown", { line: 3, args: ["xyz"] });
    rb.code("parse.unknown", { line: 7, args: ["abc"] });
    const r = rb.finish({ docs: [{ ref: "a", name: "Nástroj", kind: "assembly", main: true }] });
    const short = formatShort(r);
    for (const l of [
      "✗ L3 parse.unknown neznámý příkaz „xyz“",
      "✗ L7 parse.unknown neznámý příkaz „abc“",
      '✗ L10 feature.failed "Deska": prvek „Úkos 2“ se nepostavil: plocha nenalezena',
      '✗ L12 feature.failed "Deska": prvek „Zaoblení 3“ se nepostavil: poloměr příliš velký',
      '⚠ L40 clash.real "Nástroj": kolize „Deska A“ × „Šroub 1“ (12 mm³)',
      '⚠ L41 clash.real "Nástroj": kolize „Lišta P“ × „Kolík 3“ (0.4 mm³)',
    ]) {
      expect(short.split("\n")).toContain(l);
      expect(formatFull(r).split("\n")).toContain(l);
    }
    expect(short).not.toContain("×2");
    const j = JSON.parse(toJson(r, { full: true })) as RunReport;
    expect(j.entries.length).toBe(6);
    expect(j.entries.find((e) => e.text.includes("Lišta P"))).toMatchObject({ line: 41, data: { pair: ["Lišta P", "Kolík 3"] } });
    expect(j.entries.every((e) => e.count === undefined && e.lines === undefined)).toBe(true);
    expect(j.counts).toMatchObject({ errors: 4, warnings: 2 });
  });
  it("regrese: záznam bez řádku (L-) se neslučuje se záznamem s řádkem; stejná data se slučují, různá a neporovnatelná ne", () => {
    const m = mergeEntries([codeEntry("host.fonts"), codeEntry("host.fonts", { line: 5 }), codeEntry("host.fonts"), codeEntry("host.fonts", { line: 9 })]);
    expect(m.map((e) => [e.line, e.lines, e.count])).toEqual([
      [null, undefined, 2],
      [5, [5, 9], 2],
    ]);
    const r = { ...new ReportBuilder({ lang: "cs", lines: 9 }).finish(), entries: m };
    const t = formatShort(r).split("\n");
    expect(t).toContain("✗ L- ×2 host.fonts písma pro PDF a text modelu nejsou k dispozici");
    expect(t).toContain("✗ L5,L9 ×2 host.fonts písma pro PDF a text modelu nejsou k dispozici");
    const d = (line: number, data: unknown) => codeEntry("select.ambiguous", { line, data });
    const cyc: Record<string, unknown> = {};
    cyc.self = cyc;
    const md = mergeEntries([d(1, { f: [1, 2] }), d(2, { f: [1, 2] }), d(3, { f: [3] }), d(4, cyc), d(5, cyc), d(6, 10n), d(7, undefined)]);
    expect(md.map((e) => e.lines ?? [e.line])).toEqual([[1, 2], [3], [4], [5], [6], [7]]);
    expect(mergeEntries(md)).toEqual(md); // idempotentní
  });
  it("regrese: slučování je lineární – 40 000 záznamů na různých řádcích pod 1,5 s, finish 5000× parse.unused pod 1 s", () => {
    const many = Array.from({ length: 40000 }, (_, i) => codeEntry("select.ambiguous", { line: i + 1 }));
    let t0 = performance.now();
    const m = mergeEntries(many);
    const tMerge = performance.now() - t0;
    expect(m.length).toBe(1);
    expect(m[0].lines!.length).toBe(40000);
    expect(m[0].count).toBe(40000);
    expect(tMerge).toBeLessThan(1500);
    const rb = new ReportBuilder({ lang: "cs", lines: 5000, now: () => 0 });
    for (let i = 0; i < 5000; i++) rb.code("parse.unused", { line: i + 1, args: ["mm"] });
    t0 = performance.now();
    const r = rb.finish();
    const s = shortProtocol(r);
    const tFinish = performance.now() - t0;
    expect(s.text).toContain("⚠ L1-L5000 ×5000 parse.unused nevyužitá slova: mm");
    expect(tFinish).toBeLessThan(1000);
  });
  it("regrese: konce řádků všech druhů (U+2028, U+2029, NEL, \\v, \\f, \\r) a řídicí znaky – každý řádek projde gramatikou", () => {
    for (const ch of ["\u2028", "\u2029", "\u0085", "\u000b", "\u000c", "\r", "\n", "\t", "\u001b", "\u0000", "\u007f"]) {
      const rb = new ReportBuilder({ lang: "cs", lines: 5, now: () => 0 });
      rb.code("select.ambiguous", { line: 1, text: `a${ch}b` });
      rb.code("op.failed", { line: 2, doc: `Díl${ch}X`, args: ["x"] });
      rb.measure(3, "measure", `V=1cm3 note=a${ch}b`, { doc: `D${ch}` });
      rb.measure(4, "check", `a=1\n  řádek${ch}2`);
      const r = rb.finish({
        docs: [{ ref: "a", name: `Díl${ch}X`, kind: "part", main: true }],
        files: [{ name: `f${ch}.step`, format: "step", bytes: 1, sha256: "", doc: "x" }],
        share: { url: `https://x.cz/cad#q=a${ch}b`, mode: "store", bytes: 1, exp: null },
      });
      for (const t of [formatShort(r), formatShort(r, { budget: 200 })]) {
        expect(checkGrammar(t), JSON.stringify(ch)).toEqual([]);
        expect(t).not.toMatch(/[\u0000-\u0009\u000b-\u001f\u007f-\u009f\u2028\u2029]/);
      }
      expect(formatFull(r)).not.toMatch(/[\u0000-\u0009\u000b-\u001f\u007f-\u009f\u2028\u2029]/);
      expect(formatShort(r)).toContain("O https://x.cz/cad#q=a");
    }
  });
  it("regrese: t= v hlavičce a Σ i při ms NaN / ∞ a hodinách vracejících NaN", () => {
    const cases: [number | undefined, () => number][] = [
      [NaN, () => 0],
      [Infinity, () => 0],
      [-5, () => 0],
      [undefined, () => NaN],
      [undefined, () => Infinity],
    ];
    for (const [ms, now] of cases) {
      const r = new ReportBuilder({ lang: "cs", lines: 1, now }).finish({ ms });
      expect(Number.isFinite(r.ms)).toBe(true);
      const t = formatShort(r).split("\n");
      expect(t[0]).toBe("MNCAD/1 OK lines=1 ops=0 err=0 warn=0 note=0 t=0");
      expect(t.at(-1)).toMatch(/ t=0$/);
    }
    // i hotový report s NaN (ručně sestavený) dá platnou hlavičku
    const r = { ...new ReportBuilder({ lang: "cs", lines: 1 }).finish(), ms: NaN };
    expect(formatShort(r).split("\n")[0]).toMatch(GRAMMAR.header);
  });
  it("regrese: rozpočet NaN / ne-číslo = výchozí 2048, Infinity = bez omezení, záporný = minimum", () => {
    const rb = new ReportBuilder({ lang: "cs", lines: 3, now: () => 0 });
    rb.code("op.failed", { line: 1, args: ["x"] });
    const r = rb.finish();
    for (const budget of [NaN, Number("abc"), "100" as unknown as number, undefined]) {
      const s = shortProtocol(r, { budget });
      expect(s.budget).toBe(DEFAULT_BUDGET);
      expect(s.text).toContain("✗ L1 op.failed příkaz selhal: x");
      expect(s.overflow).toBeUndefined();
    }
    expect(shortProtocol(p10Report(), { budget: Infinity }).overflow).toBeUndefined();
    const neg = shortProtocol(r, { budget: -5 });
    expect(neg.bytes).toBeLessThanOrEqual(neg.budget);
    expect(neg.budget).toBeGreaterThan(0);
  });
  it("regrese: značka přebytku vždy „… <n> entries <bajty>B in protocol-full.txt“ (gramatika), overflow.file stejný", () => {
    const rb = new ReportBuilder({ lang: "cs", lines: 3, now: () => 0 });
    for (let i = 0; i < 40; i++) rb.code("op.failed", { line: i + 1, doc: `D${i}`, text: "x".repeat(100) });
    const s = shortProtocol(rb.finish());
    const marker = s.text.split("\n").at(-2)!;
    expect(marker).toMatch(GRAMMAR.overflow);
    expect(marker).toBe(`… ${s.overflow!.entries} entries ${s.overflow!.bytes}B in protocol-full.txt`);
    expect(s.overflow!.file).toBe("protocol-full.txt");
  });
  it("regrese: druh `=` má tvar kódu – compare-2d (kap. 8.1) zůstane, neplatný se převede bez ztráty smyslu", () => {
    expect(["compare-2d", "measure", "Bad.Kind", "měření", "kontrola sestava", "", undefined, "--"].map((k) => measureKind(k))).toEqual(["compare-2d", "measure", "bad.kind", "mereni", "kontrola-sestava", "value", "value", "value"]);
    const rb = new ReportBuilder({ lang: "cs", lines: 20, now: () => 0 });
    rb.measure(12, "compare-2d", "matched=10 missing=1 extra=0 maxdev=0.02mm", { doc: "ref.dxf" });
    const t = formatShort(rb.finish());
    expect(t.split("\n")).toContain('= L12 compare-2d "ref.dxf" matched=10 missing=1 extra=0 maxdev=0.02mm');
    expect(checkGrammar(t)).toEqual([]);
    expect(GRAMMAR.measure.exec('= L12 compare-2d "ref.dxf" matched=10')![2]).toBe("compare-2d");
  });
  it("regrese: volný text bez dokumentu začínající uvozovkou se neplete s názvem dokumentu (úvodní \\)", () => {
    const rb = new ReportBuilder({ lang: "cs", lines: 4, now: () => 0 });
    rb.code("msg.error", { line: 1, text: '"Deska A": těleso chybí' });
    rb.code("msg.error", { line: 2, doc: "Deska A", text: "těleso chybí" });
    rb.measure(3, "stav", '"Díl A" part V=1cm3');
    rb.measure(4, "stav", "V=1cm3", { doc: "Díl A" });
    const t = formatShort(rb.finish()).split("\n");
    expect(t).toContain('✗ L1 msg.error \\"Deska A": těleso chybí');
    expect(t).toContain('✗ L2 msg.error "Deska A": těleso chybí');
    expect(t).toContain('= L3 stav \\"Díl A" part V=1cm3');
    expect(t).toContain('= L4 stav "Díl A" V=1cm3');
    // parser podle gramatiky: uvozovka hned za kódem = dokument
    const docOf = (l: string) => /^\S+ \S+(?: ×\d+)? [a-z0-9.-]+ "((?:[^"\\]|\\.)*)"/.exec(l)?.[1] ?? null;
    expect([t[1], t[2]].map(docOf)).toEqual([null, "Deska A"]);
    expect(t.filter((l) => l.startsWith("= ")).map(docOf)).toEqual([null, "Díl A"]);
  });
  it("čísla, uvozovky, data, UTF-8", () => {
    expect([fmtNum(5241.73), fmtNum(2347.216, 3), fmtNum(1e6), fmtNum(NaN), fmtNum(undefined), fmtNum(-1.005, 2), fmtNum(0.1 + 0.2)]).toEqual(["5241.73", "2347.216", "1000000", "-", "-", "-1", "0.3"]);
    expect(quote('Deska "A" 2\\x\nb')).toBe('"Deska \\"A\\" 2\\\\x b"');
    expect(GRAMMAR.doc.test(`D ${quote('Deska "A" 2')} part -`)).toBe(true);
    expect([isoDate("2026-11-23T10:00:00Z"), isoDate(Date.UTC(2026, 0, 2)), isoDate(null), isoDate("nesmysl")]).toEqual(["2026-11-23", "2026-01-02", null, null]);
    for (const s of ["", "abc", "Střižnice Ø20 ×3 – „x“", "😀€ß", "\ud800 osamělý"]) expect(utf8Bytes(s)).toBe(B(s));
  });
  it("text ✗ na jeden řádek, nejvýš 160 znaků; plný protokol nezkrácený", () => {
    const long = "ž".repeat(300);
    const r = new ReportBuilder({ lang: "cs", lines: 1 });
    r.add({ line: 1, level: "error", text: `a\nb ${long}` });
    const rep = r.finish();
    const l = formatShort(rep).split("\n")[1];
    expect(l.startsWith("✗ L1 msg.error a b ")).toBe(true);
    expect([...l.slice("✗ L1 msg.error ".length)].length).toBe(160);
    expect(formatFull(rep)).toContain(long);
  });
  it("STOP: hlavička, Σ stop=…, ok=false", () => {
    const rb = new ReportBuilder({ lang: "cs", lines: 5, strict: true });
    rb.code("select.ambiguous", { line: 3 });
    rb.stop(3, "select.ambiguous");
    const r = rb.finish();
    expect(r.ok).toBe(false);
    expect(r.stopped).toEqual({ line: 3, code: "select.ambiguous" });
    const t = formatShort(r);
    expect(t.split("\n")[0]).toMatch(/^MNCAD\/1 STOP /);
    expect(t).toMatch(/stop=L3:select\.ambiguous/);
  });
  it("JSON: RunReport s protocol, overflow, timing (5 nejpomalejších), peakMB; full na vyžádání", () => {
    const r = p10Report();
    const j = JSON.parse(toJson(r, { full: true })) as RunReport;
    expect(j.v).toBe(1);
    expect(j.protocol).toBe(GOLDEN_CS);
    expect(j.overflow).toEqual(shortProtocol(r).overflow);
    expect(j.full).toBe(formatFull(r));
    expect(j.timing.length).toBe(5);
    expect(j.timing[0]).toEqual({ line: 395, op: "asm", ms: 12100 });
    expect(j.peakMB).toBe(812);
    expect(j.counts).toEqual({ lines: 397, ops: 390, ok: 300, notes: 6, warnings: 44, errors: 1 });
    const sel = j.entries.find((e) => e.code === "select.ambiguous")!;
    expect(sel.lines!.length).toBe(40);
    expect(JSON.parse(toJson(r)).full).toBeUndefined();
    expect(finalizeReport({ ...r, overflow: { entries: 9, bytes: 9, file: "x" } }, { budget: 1e6 }).overflow).toBeUndefined();
  });
  it("plný protokol: ✓ i ℹ v pořadí řádků, úplné výčty řádků, D všech dokumentů", () => {
    const full = formatFull(p10Report());
    const lines = full.split("\n");
    expect(lines.filter((l) => l.startsWith("✓")).length).toBe(300);
    expect(lines.filter((l) => l.startsWith("ℹ")).length).toBe(1);
    expect(full).toContain("ℹ L380,L381,L382,L383,L384,L385 ×6 ui.no-view");
    expect(full).toMatch(/⚠ L200,L205,.*,L395 ×40 select\.ambiguous/);
    expect(lines.filter((l) => l.startsWith("D ")).length).toBe(20);
    const firstLines = lines.slice(1).map((l) => /^\S+ L(\d+)/.exec(l)?.[1]).filter(Boolean).map(Number);
    expect(firstLines).toEqual([...firstLines].sort((a, b) => a - b));
  });
});
