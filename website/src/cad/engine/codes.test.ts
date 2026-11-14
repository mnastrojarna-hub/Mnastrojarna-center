/** Registr kódů protokolu (CAD-HEADLESS-NAVRH.md 4.3, 5.2): tvar, jedinečnost, úrovně, překlady, záznamy. */
import { afterEach, describe, expect, it } from "vitest";
import { hasTranslation, setLang } from "../i18n";
import { CODES, CODE_RE, codeDef, codeEntry, codeText, fallbackCode, isCode } from "./codes";
import { GRAMMAR, formatShort, ReportBuilder } from "./protocol";

afterEach(() => setLang("cs"));

const placeholders = (s: string) => [...new Set([...s.matchAll(/\{(\d+)\}/g)].map((m) => m[1]))].sort().join(",");

/** kódy a úrovně ze soupisu 5.2 (č. 1–40) a kap. 2.5, 3.1, 3.4, 6 – musí v registru být s touto úrovní */
const REQUIRED: Record<string, "error" | "warn" | "note"> = {
  "parse.unused": "warn", // 1
  "parse.coord-missing": "warn", // 2
  "parse.axis": "error", // 3, 4
  "hole.depth-default": "warn", // 5
  "parse.conflict": "warn", // 6, 9, 10
  "hole.conflict": "warn", // 7
  "hole.cbore-dropped": "warn", // 8 (rozhodnutí 15.3: jen když je zahloubení menší než závit)
  "insert.name-ignored": "warn", // 11
  "select.fallback": "warn", // 12
  "select.ambiguous": "warn", // 13
  "tab.empty-replaced": "warn", // 14
  "name.renamed": "warn", // 15 výslovný
  "name.renamed-auto": "note", // 15 automatický
  "mode.new-body": "note", // 16
  "json.id-renewed": "note", // 17
  "hole.no-surface": "warn", // 18
  "asm.stale-copy": "warn", // 19
  "clash.undetermined": "warn", // 20
  "clash.hidden": "note", // 20
  "build.failed": "error", // 21
  "tab.settle-timeout": "error", // 22
  "ui.no-view": "note", // 23
  "param.clamped": "warn", // 24–26
  "geom.approx": "note", // 27
  "geom.volume-failed": "warn", // 28
  "asm.depth": "warn", // 29
  "asm.faces-truncated": "warn", // 30
  "measure.truncated": "note", // 31
  "drawing.warning": "warn", // 32
  "drawing.overlap": "warn", // 33
  "share.uncompressed": "note", // 34
  "share.fallback-link": "warn", // 35
  "host.fonts": "error", // 36
  "material.density-assumed": "warn", // 37
  "material.class": "note", // 37
  "hole.tap-diameter": "warn", // 38
  "host.app-only": "error", // 39
  "asm.kernel-restarted": "note", // 40
  "asm.face-missing": "error", // 40
  "run.timeout": "error",
  "run.memory": "error",
  "out.path": "error",
  "share.rejected": "error",
  "session.history": "note",
  "clash.thread": "note",
  "clash.underhead": "note",
  "clash.real": "warn",
  "check.hole-missing": "warn",
  "compare.mismatch": "warn",
  "motion.conflict": "warn",
  "asm.instance-duplicate": "warn",
  "drawing.tolerance-missing": "warn",
  "reference.mismatch": "warn",
  "file.missing": "error",
};

describe("registr kódů", () => {
  it("tvar kódu, jedinečnost, úroveň, český klíč", () => {
    const seen = new Set<string>();
    for (const c of CODES) {
      expect(c.code).toMatch(CODE_RE);
      expect(GRAMMAR.msg.exec(`⚠ L1 ${c.code} text`)?.[4]).toBe(c.code);
      expect(seen.has(c.code), c.code).toBe(false);
      seen.add(c.code);
      expect(["error", "warn", "note"]).toContain(c.level);
      expect(c.key).toMatch(/\p{L}{3,}/u);
    }
    expect(CODES.length).toBeGreaterThanOrEqual(60);
  });
  it("každý kód ze soupisu 5.2 a návrhu je v registru se správnou úrovní", () => {
    const miss = Object.entries(REQUIRED).filter(([code, level]) => codeDef(code)?.level !== level);
    expect(miss).toEqual([]);
  });
  for (const lang of ["en", "de"] as const) {
    it(`${lang}: každý text kódu má překlad se stejnými zástupnými {n}`, () => {
      const bad = CODES.filter((c) => !hasTranslation(lang, c.key)).map((c) => c.code);
      expect(bad).toEqual([]);
      setLang(lang);
      for (const c of CODES) {
        const t = codeText(c.code, "A", "B", "C");
        expect(t, c.code).not.toBe(c.key.replace(/\{0\}/g, "A").replace(/\{1\}/g, "B").replace(/\{2\}/g, "C"));
        expect(t, c.code).not.toMatch(/\{\d\}/);
      }
      setLang("cs");
    });
  }
  it("zástupné {n} jsou souvislé od 0", () => {
    for (const c of CODES) {
      const ph = placeholders(c.key);
      if (ph) expect(ph.split(",").map(Number), c.code).toEqual(ph.split(",").map((_, i) => i));
    }
  });
  it("codeEntry: úroveň a text z registru v aktuálním jazyce, přepis úrovně, vlastní text, dokument a data", () => {
    expect(codeEntry("select.ambiguous", { line: 4 })).toEqual({ line: 4, level: "warn", code: "select.ambiguous", text: "více vyhovujících ploch – použita první" });
    setLang("en");
    expect(codeEntry("run.timeout", { args: [300] }).text).toBe("time limit of 300 s exceeded");
    setLang("de");
    expect(codeEntry("run.timeout", { args: [300] }).text).toBe("Zeitlimit von 300 s überschritten");
    setLang("cs");
    expect(codeEntry("compare.mismatch", { level: "error", args: ["dV=1%"] })).toMatchObject({ level: "error", line: null, text: "model se od reference liší: dV=1%" });
    expect(codeEntry("op.failed", { line: 2, text: "vlastní", doc: "D", data: { a: 1 } })).toEqual({ line: 2, level: "error", code: "op.failed", text: "vlastní", doc: "D", data: { a: 1 } });
    expect([isCode("run.timeout"), isCode("nic.takoveho"), fallbackCode("error"), fallbackCode("warn"), fallbackCode("note")]).toEqual([true, false, "msg.error", "msg.warn", "msg.note"]);
  });
  it("záznam bez kódu dostane náhradní kód podle úrovně (gramatika vyžaduje kód)", () => {
    const rb = new ReportBuilder({ lang: "cs", lines: 3 });
    rb.add({ line: 1, level: "error", text: "něco" });
    rb.add({ line: 2, level: "warn", code: "Neplatný Kód", text: "jiné" });
    const t = formatShort(rb.finish());
    expect(t).toContain("✗ L1 msg.error něco");
    expect(t).toContain("⚠ L2 msg.warn jiné");
  });
});
