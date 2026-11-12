import { describe, expect, it } from "vitest";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { CAD_LANGS, clearMissing, dictOf, getLang, hasTranslation, langFromPath, langMeta, missingKeys, setLang, tr } from "./index";

const ROOT = path.resolve(__dirname, "../../..");
/** Klíče bez významu pro překlad (kódy, normy) – shodně se scripts/cad-i18n-build.mjs. */
const SKIP = (k: string) =>
  !/\p{L}{3,}/u.test(k.replace(/\{\d+\}/g, " ")) || /^(DIN|ISO|ČSN|EN|ANSI|JIS) [\d/ A-Z-]+$/.test(k) || /^[A-Z]{1,4}\d[\w ×x./-]*$/.test(k);

function usedKeys(): string[] {
  const out = path.join(os.tmpdir(), `mncad-i18n-keys-${process.pid}.json`);
  execFileSync(process.execPath, [path.join(ROOT, "scripts/cad-i18n-codemod.mjs"), "--extract", "--keys", out], { cwd: ROOT, stdio: "ignore" });
  const keys = Object.keys(JSON.parse(fs.readFileSync(out, "utf8")));
  fs.unlinkSync(out);
  return keys;
}
const placeholders = (s: string) => [...s.matchAll(/\{(\d+)\}/g)].map((m) => m[1]).sort().join(",");

describe("CAD i18n – slovníky", () => {
  const keys = usedKeys();
  it("v kódu je přes 3000 přeložitelných klíčů", () => {
    expect(keys.length).toBeGreaterThan(3000);
  });
  for (const lang of ["en", "de"] as const) {
    it(`${lang}: každý klíč z kódu má překlad (kromě kódů a norem)`, () => {
      const miss = keys.filter((k) => !SKIP(k) && !hasTranslation(lang, k));
      expect(miss, miss.slice(0, 20).join("\n")).toEqual([]);
    });
    it(`${lang}: překlady zachovávají zástupné {n} i okolní mezery`, () => {
      const bad: string[] = [];
      for (const [k, v] of Object.entries(dictOf(lang))) {
        if (placeholders(k) !== placeholders(v)) bad.push(`${k} → ${v}`);
        if (/^\s/.test(k) !== /^\s/.test(v) || /\s$/.test(k) !== /\s$/.test(v)) bad.push(`mezery: ${JSON.stringify(k)} → ${JSON.stringify(v)}`);
        if (!v.trim()) bad.push(`prázdný: ${k}`);
      }
      expect(bad, bad.slice(0, 20).join("\n")).toEqual([]);
    });
    it(`${lang}: překlady nejsou jen kopií češtiny (mimo kódy)`, () => {
      const entries = Object.entries(dictOf(lang)).filter(([k]) => !SKIP(k));
      const same = entries.filter(([k, v]) => k === v).length;
      expect(same / entries.length).toBeLessThan(0.03);
    });
  }
});

describe("CAD i18n – tr()", () => {
  it("čeština vrací zdroj a doplní argumenty", () => {
    setLang("cs");
    expect(tr("Export {0} hotov ({1} kB)", "STEP", 12)).toBe("Export STEP hotov (12 kB)");
    expect(tr("Bez argumentů {0}")).toBe("Bez argumentů {0}");
  });
  it("angličtina a němčina překládají a doplňují argumenty", () => {
    setLang("en");
    expect(tr("Není co zaoblit – nejdřív vytvořte těleso.")).toBe("Nothing to fillet – create a body first.");
    expect(tr("Skica „{0}“ je prázdná.", "S1")).toBe("Sketch “S1” is empty.");
    setLang("de");
    expect(tr("Skica „{0}“ je prázdná.", "S1")).toBe("Die Skizze „S1“ ist leer.");
    expect(getLang()).toBe("de");
  });
  it("chybějící klíč vrátí zdroj a zapíše se mezi chybějící; kódy se nepočítají", () => {
    setLang("en");
    clearMissing();
    expect(tr("Tenhle text ve slovníku není")).toBe("Tenhle text ve slovníku není");
    expect(tr("M{0}×{1}", 18, 1.5)).toBe("M18×1.5");
    expect(missingKeys()).toEqual(["Tenhle text ve slovníku není"]);
    clearMissing();
    setLang("cs");
  });
  it("jazyk z cesty a metadata jazyků", () => {
    expect(langFromPath("/cad")).toBe("cs");
    expect(langFromPath("/en/cad")).toBe("en");
    expect(langFromPath("/de/cad/")).toBe("de");
    expect(langFromPath("/english/cad")).toBe("cs");
    expect(CAD_LANGS.map((l) => l.id)).toEqual(["cs", "en", "de"]);
    expect(langMeta("de").locale).toBe("de-DE");
    setLang("xx" as never);
    expect(getLang()).toBe("cs");
  });
});
