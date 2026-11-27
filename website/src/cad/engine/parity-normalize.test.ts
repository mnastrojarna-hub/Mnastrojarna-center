/**
 * Normalizace parity prohlížeč × Node (e2e/lib/engine-parity.cjs): jediný záměrný rozdíl hostitelů – hláška šablony
 * hlavičky „v Nastavení jen pro tento běh“ (Node / CLI) × „i do Nastavení“ (prohlížeč, bod 22j, kolo 6) – se přepisuje jen
 * na straně Node. Výstup prohlížeče zůstává beze změny: chybná hláška prohlížeče se zlatým snímkem neshoduje.
 */
import { createRequire } from "node:module";
import { afterEach, describe, expect, it } from "vitest";
import { setLang, tr } from "../i18n";

type Parity = { normalize(text: string, o?: { node?: boolean }): string; compare(g: string, a: string): { ok: boolean } };
const P = createRequire(import.meta.url)("../../../e2e/lib/engine-parity.cjs") as Parity;

const node = {
  cs: "→ šablona hlavičky „Firma“ (ISO 7200 (výchozí), polí 1) uložena do dokumentu; v Nastavení jen pro tento běh – výsledek po vyhodnocení listu níže",
  en: "→ title block template “Firma” saved to the document; in Settings for this run only",
  de: "→ Kopfvorlage „Firma“ im Dokument gespeichert; in den Einstellungen nur für diesen Lauf",
};
const browser = {
  cs: "→ šablona hlavičky „Firma“ (ISO 7200 (výchozí), polí 1) uložena do dokumentu i do Nastavení – výsledek po vyhodnocení listu níže",
  en: "→ title block template “Firma” saved to the document and to Settings",
  de: "→ Kopfvorlage „Firma“ im Dokument und in den Einstellungen gespeichert",
};

describe("parita: hláška šablony hlavičky (bod 22j)", () => {
  afterEach(() => setLang("cs"));
  it("skutečné překlady obou hlášek (drawing-agent.ts) se po normalizaci Node shodují v cs / en / de", () => {
    for (const lang of ["cs", "en", "de"] as const) {
      setLang(lang);
      const nodeText = tr("✓ šablona hlavičky {0} uložena do dokumentu; v Nastavení jen pro tento běh{1}", "„Firma“", "");
      const browserText = tr("✓ šablona hlavičky {0} uložena do dokumentu i do Nastavení{1}", "„Firma“", "");
      expect(nodeText, lang).not.toBe(browserText);
      expect(P.normalize(nodeText, { node: true }), lang).toBe(browserText);
    }
  });
  it("výstup Node se přepíše na text prohlížeče (cs / en / de)", () => {
    for (const k of ["cs", "en", "de"] as const) expect(P.normalize(node[k], { node: true })).toBe(browser[k]);
  });
  it("výstup prohlížeče se NEpřepisuje – prohlížeč s hláškou „jen pro tento běh“ paritou neprojde", () => {
    for (const k of ["cs", "en", "de"] as const) {
      expect(P.normalize(node[k])).toBe(node[k]);
      // zlatý snímek korpusu je z prohlížeče (text „i do Nastavení“); chybný prohlížeč = rozdíl
      expect(P.compare(browser[k], P.normalize(node[k])).ok).toBe(false);
      expect(P.compare(browser[k], P.normalize(browser[k])).ok).toBe(true);
    }
  });
});
