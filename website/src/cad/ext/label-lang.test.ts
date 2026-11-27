/**
 * Vlna 22, bod 22d (kolo 6): výchozí název prvku rozšíření v jazyce BĚHU, ne v jazyce načtení modulu.
 *
 * Moduly rozšíření se načtou dřív, než CLI / HTTP nastaví jazyk (`--lang`, pole `lang`); `label: tr("…")` se tak
 * vyhodnotil česky a `prvek surf.helixSweep …` v anglickém běhu dal prvek „Tažení po šroubovici“ (vestavěné prvky
 * „Cylinder 1“ byly přeložené). Teď `registerExt` popisek překládá až při čtení; hledání podle českého popisku zůstává.
 */
import { afterEach, describe, expect, it } from "vitest";
import { parseAgentText } from "../agent";
import { setLang } from "../i18n";
import { getExt } from "./index";

const extName = (text: string) => {
  const p = parseAgentText(text);
  expect(p.errors, JSON.stringify(p.errors)).toEqual([]);
  const op = p.ops.filter((o) => o.k === "feature").pop() as { feature: { name: string } } | undefined;
  return op?.feature.name;
};

afterEach(() => setLang("cs"));

describe("bod 22d: popisek prvku rozšíření v jazyce běhu (moduly načtené česky)", () => {
  it("EN / DE běh po načtení modulů: výchozí název prvku je přeložený, ne český", () => {
    // moduly (a s nimi registerExt) se načetly při importu výše – v jazyce cs, jako v CLI před --lang
    setLang("en");
    expect(getExt("surf.helixSweep")?.label).toBe("Helical sweep");
    expect(extName('nový díl "A"\nválec 18 30\nprvek surf.helixSweep turns=2')).toBe("Helical sweep");
    setLang("de");
    expect(extName('nový díl "A"\nválec 18 30\nprvek surf.helixSweep turns=2')).toBe("Austragung entlang Helix");
    setLang("cs");
    expect(extName('nový díl "A"\nválec 18 30\nprvek surf.helixSweep turns=2')).toBe("Tažení po šroubovici");
  });
  it("hledání prvku podle českého popisku funguje i v anglickém běhu (i podle přeloženého)", () => {
    setLang("en");
    expect(extName('nový díl "A"\nválec 18 30\nprvek "Tažení po šroubovici" turns=2')).toBe("Helical sweep");
    expect(extName('nový díl "A"\nválec 18 30\nprvek "Helical sweep" turns=2')).toBe("Helical sweep");
    expect(getExt("surf.helixSweep")?.labelSrc).toBe("Tažení po šroubovici");
  });
});
