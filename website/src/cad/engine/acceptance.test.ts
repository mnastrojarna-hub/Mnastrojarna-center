/**
 * Nálezy brány B6 (zkouška 959, scripts/cad-acceptance.mjs) bez jádra:
 * * stručný protokol slučuje ⚠/✗ prvků jednoho dílu se stejnou hláškou (osm stejných „neplatná geometrie“ zaplnilo 2 kB
 *   a vytlačilo skutečné kolize pohybu) – plný protokol a JSON je mají dál zvlášť;
 * * `codeArgs` vrátí argumenty z textu kódu v cs/en/de;
 * * řádek D sestavy nese obálku (`bbox=`);
 * * pohybová studie = jeden strojový řádek `motion … travel=<zdvih>mm:<komponent> static=<n>` (tuhé skupiny).
 */
import { afterEach, describe, expect, it } from "vitest";
import { setLang, type CadLang } from "../i18n";
import { motionKv } from "../asm-agent-kin";
import { motionGroups, type MotionResult } from "../motion";
import type { Placement } from "../types";
import { codeArgs, codeEntry, codeText } from "./codes";
import { GRAMMAR, ReportBuilder, docLine, formatFull, grammarKind, mergeSimilar, shortProtocol } from "./protocol";
import type { DocSummary } from "./protocol-types";

afterEach(() => setLang("cs"));

const PART = "900-01-00-03 Stírací deska";
const MSG = "Výsledek má neplatnou geometrii (sebeprotínající nebo neorientovatelné plochy) – export STEP může selhat.";
const NAMES = ["Rotace 1", "Vysunutí 2", "Rotace 3", "Vysunutí 4", "Vysunutí 5", "Rotace 6", "Vysunutí 7", "Rotace 8"];
const ASM: DocSummary = { ref: "a", name: "900-01-00 Střižný nástroj", kind: "assembly", main: true, components: 70, parts: 19, mates: { total: 53, ok: 53, conflict: 0, missing: 0, suppressed: 0 }, volume_mm3: 8375264.2, volume_union_mm3: 8363690.1, mass_kg: 65.746, bbox: [[-2.5, -10, 0], [317.5, 210, 304]], clashes: { total: 30, thread: 30, real: 0, undetermined: 0 }, sheets: 1 };

/** běh jako skutečný nástroj: 8 ⚠ prvků dílu (stejná hláška), 2 skutečné kolize pohybu, souhrn pohybu, výpisy */
function report(lang: CadLang = "cs") {
  setLang(lang);
  const rb = new ReportBuilder({ lang, lines: 397, now: () => 0 });
  NAMES.forEach((n, i) => rb.code("feature.warning", { line: 76 + 2 * i, doc: PART, args: [n, MSG] }));
  rb.code("feature.warning", { line: 120, doc: PART, args: ["Díra 3", "jiná hláška"] });
  rb.code("clash.real", { line: 390, doc: ASM.name, text: "v pohybu „900-01-00-06 Horní deska“ × „Pružina 2,5×20×38,5“ od kroku 3 (t = 0,15 s): kroků 38, dvojic komponent 4, největší průnik 120,5 mm³" });
  rb.code("clash.real", { line: 390, doc: ASM.name, text: "v pohybu „900-01-00-03 Stírací deska“ × „900-01-00-11 Střižník“ od kroku 40 (t = 2 s): kroků 1, dvojic komponent 1, největší průnik 12,25 mm³" });
  rb.measure(389, "clash", "total=30 thread=30 underhead=0 real=0 undetermined=0", { doc: ASM.name });
  rb.measure(390, "asm", "motion steps=40 t=2 motors=1 conflicts=0 travel=50mm:36,20mm:1 static=33 clash.steps=41/41 thread=30 real=2 first.real=3", { doc: ASM.name, detail: "Pohybová studie: 40 kroků …" });
  rb.measure(392, "asm", ["lines=28", ...Array.from({ length: 27 }, (_, i) => `${i + 1} | díl ${i + 1} | 1 | ocel | 1,000`)].join("\n"), { doc: ASM.name });
  return rb.finish({ docs: [ASM], files: [{ name: `${ASM.name}.step`, format: "step", bytes: 2133820, sha256: "0".repeat(64), doc: ASM.name, check: { ok: true, text: "" } }], share: { url: "http://127.0.0.1:3471/cad#q=Z33UxCPenu.cw2Akls1PlpeYZvMcp4JIw", mode: "self", bytes: 7768, exp: "2026-11-24" }, ms: 38900 });
}

describe("stručný protokol: hlášky prvků jednoho dílu se stejnou hláškou = jeden řádek", () => {
  it("8× feature.warning se stejnou hláškou → ⚠ L76-L90 ×8 …, jiná hláška zvlášť, skutečné kolize pohybu viditelné", () => {
    const r = report();
    const s = shortProtocol(r);
    const lines = s.text.split("\n");
    expect(s.bytes).toBeLessThanOrEqual(2048);
    for (const l of lines) expect(grammarKind(l), l).not.toBeNull();
    const merged = lines.filter((l) => l.startsWith("⚠") && l.includes(`feature.warning "${PART}"`));
    expect(merged).toHaveLength(2);
    expect(merged[0]).toMatch(/^⚠ L76-L90 ×8 feature\.warning "900-01-00-03 Stírací deska": 8 prvků: Výsledek má neplatnou geometrii/);
    expect(merged[1]).toMatch(/^⚠ L120 feature\.warning "900-01-00-03 Stírací deska": prvek „Díra 3“: jiná hláška$/);
    // obě skutečné kolize pohybu, souhrn pohybu na jednom řádku, řádek D, odkaz – nic z toho nevytlačily ⚠ prvků
    expect(lines.filter((l) => l.includes(" clash.real "))).toHaveLength(2);
    expect(lines.some((l) => /^= L390 asm "900-01-00 Střižný nástroj" motion steps=40 .*travel=50mm:36,20mm:1 static=33/.test(l))).toBe(true);
    expect(lines.some((l) => l.startsWith(`D "${ASM.name}" asm `) && l.includes(" m=65.75kg bbox=320x220x304 "))).toBe(true);
    expect(lines.some((l) => l.startsWith("O http://127.0.0.1:3471/cad#q="))).toBe(true);
  });

  it("plný protokol a JSON mají každý prvek zvlášť (nic se neztratí)", () => {
    const r = report();
    expect(r.entries.filter((e) => e.code === "feature.warning")).toHaveLength(9);
    const full = formatFull(r);
    for (const n of NAMES) expect(full).toContain(`prvek „${n}“: ${MSG}`);
  });

  it("strojová část je stejná v cs/en/de, slučuje se i v en/de (šablona kódu v jazyce běhu)", () => {
    const head = (lang: CadLang) =>
      shortProtocol(report(lang))
        .text.split("\n")
        .filter((l) => GRAMMAR.msg.test(l))
        .map((l) => l.replace(/^(\S+ \S+(?: ×\d+)? [a-z0-9.-]+(?: "(?:[^"\\]|\\.)*")?).*$/, "$1"));
    const cs = head("cs");
    expect(head("en")).toEqual(cs);
    expect(head("de")).toEqual(cs);
    expect(cs).toContain(`⚠ L76-L90 ×8 feature.warning "${PART}"`);
  });

  it("mergeSimilar: jen ⚠/✗ prvků téhož dílu, úrovně, řádek / bez řádku, text v šabloně kódu", () => {
    const e = (line: number | null, doc: string, name: string, msg = MSG) => codeEntry("feature.warning", { line, doc, args: [name, msg] });
    const out = mergeSimilar([e(1, "A", "x"), e(2, "B", "y"), e(3, "A", "z"), e(null, "A", "w"), e(4, "A", "q", "jiná"), { ...e(5, "A", "r"), data: { part: "A" } }, codeEntry("feature.failed", { line: 6, doc: "A", args: ["s", MSG] }), { line: 7, level: "warn", code: "feature.warning", doc: "A", text: "vlastní text" }]);
    expect(out.map((x) => [x.line, x.doc, x.count ?? 1])).toEqual([
      [1, "A", 2],
      [2, "B", 1],
      [null, "A", 1],
      [4, "A", 1],
      [5, "A", 1],
      [6, "A", 1],
      [7, "A", 1],
    ]);
    expect(out[0].lines).toEqual([1, 3]);
    expect(out[0].text).toBe(`2 prvků: ${MSG} – „x, z“`);
  });
});

describe("stručný protokol: varování listů výkresu", () => {
  it("drawing.warning listů téhož výkresu se stejnou hláškou a jinými čísly → jeden řádek s čísly u listů", () => {
    const d = (line: number | null, sheet: string, n: number) => codeEntry("drawing.warning", { line, doc: "S", args: [sheet, `${n} ručních úprav kót se nepodařilo přiřadit`] });
    const out = mergeSimilar([d(null, "01 A", 1), d(null, "02 B", 1), d(5, "List 1", 3), d(null, "07 C", 2), d(5, "List 1", 4)]);
    expect(out.map((e) => [e.line, e.count ?? 1])).toEqual([
      [null, 3],
      [5, 1],
      [5, 1],
    ]);
    expect(out[0].text).toBe("3 listů: N ručních úprav kót se nepodařilo přiřadit – „01 A: 1, 02 B: 1, 07 C: 2“");
    // jeden list s různými čísly = žádné slučování (dvě hlášky téhož listu zůstanou celé)
    expect(out.slice(1).map((e) => e.text)).toEqual(["list List 1: 3 ručních úprav kót se nepodařilo přiřadit", "list List 1: 4 ručních úprav kót se nepodařilo přiřadit"]);
    // stejná hláška na všech listech → celá hláška bez „N“ a seznam listů bez čísel
    const same = mergeSimilar([d(null, "01 A", 1), d(null, "02 B", 1)]);
    expect(same).toHaveLength(1);
    expect(same[0].text).toBe("2 listů: 1 ručních úprav kót se nepodařilo přiřadit – „01 A, 02 B“");
  });
});

describe("codeArgs", () => {
  it("vrátí argumenty z textu kódu ve všech jazycích; text mimo šablonu → null", () => {
    for (const lang of ["cs", "en", "de"] as const) {
      setLang(lang);
      expect(codeArgs("feature.warning", codeText("feature.warning", "Rotace 1", "a: b"))).toEqual(["Rotace 1", "a: b"]);
      expect(codeArgs("feature.failed", codeText("feature.failed", "Díra", "chyba"))).toEqual(["Díra", "chyba"]);
    }
    setLang("cs");
    expect(codeArgs("feature.warning", "vlastní text")).toBeNull();
    expect(codeArgs("neexistuje", "x")).toBeNull();
  });
});

describe("řádek D sestavy", () => {
  it("nese obálku bbox= za hmotností", () => {
    expect(docLine(ASM)).toBe('D "900-01-00 Střižný nástroj" asm comp=70 parts=19 mates=53/53 V.sum=8375.26cm3 V.union=8363.69cm3 m=65.75kg bbox=320x220x304 clash=30(thread=30,real=0) sheets=1');
  });
});

describe("pohybová studie: tuhé skupiny a jeden souhrnný řádek", () => {
  const pl = (x: number, y: number, z: number, rz = 0): Placement => ({ position: [x, y, z], rotation: [0, 0, rz] });
  /** 3 komponenty jedou spolu −50 v Z, 2 jen −20 (stírací deska dosedne), 2 stojí, 1 se natáčí */
  function study(): MotionResult {
    const comps = ["a", "b", "c", "d", "e", "f", "g", "h"].map((id) => ({ id, name: id.toUpperCase() }));
    const steps = Array.from({ length: 10 }, (_, i) => {
      const z1 = -50 * (i / 9);
      const z2 = Math.max(-20, z1);
      return { i, t: (2 * i) / 9, motors: [167 - (50 * i) / 9], conflicts: [], place: { a: pl(0, 0, z1), b: pl(10, 0, 100 + z1), c: pl(5, 5, 50 + z1), d: pl(0, 0, 30 + z2), e: pl(1, 1, 31 + z2), f: pl(0, 0, 0), g: pl(9, 9, 0), h: pl(0, 0, 0, i * 10) } };
    });
    return { steps, comps, motors: [{ id: "m", kind: "linear", mate: "x", from: 167, to: 117 }], collision: null, collisionsChecked: true, conflictSteps: 0 };
  }

  it("motionGroups: 3 komp. 50 mm · 2 komp. 20 mm · 2 stojí · 1 se natáčí", () => {
    const g = motionGroups(study());
    expect(g.moving.map((x) => [x.n, +x.travel.toFixed(3)])).toEqual([
      [3, 50],
      [2, 20],
    ]);
    expect([g.still, g.rotating]).toEqual([2, 1]);
  });

  it("motionKv: jeden řádek s kroky, zdvihy skupin a třídami kolizí; projde gramatikou stručného protokolu", () => {
    const kv = motionKv(study(), { steps: 10, of: 10, thread: 30, real: 2, firstReal: 1 });
    // vlna 22, bod 9: motor (průběh, začátek > konec, směr) vždy na KONCI řádku – směr a konec i ve stručném protokolu
    // vlna 22, bod 2: úroveň simulace na KONCI řádku (level=kin – výsledek bez úrovně je kinematika); dosavadní pole beze změny
    // vlna 22, M3: tuhé skupiny (počet:osy±Δ) na KONCI řádku – stejné skupiny jako travel=
    expect(kv).toBe("motion steps=9 t=2 motors=1 conflicts=0 travel=50mm:3,20mm:2 static=2 rot=1 clash.steps=10/10 thread=30 real=2 first.real=1 m1=range:167>117:- level=kin groups=3:z-50,2:z-20");
    expect(motionKv(study(), null)).toBe("motion steps=9 t=2 motors=1 conflicts=0 travel=50mm:3,20mm:2 static=2 rot=1 m1=range:167>117:- level=kin groups=3:z-50,2:z-20");
    expect(GRAMMAR.measure.test(`= L390 asm "${ASM.name}" ${kv}`)).toBe(true);
  });
});
