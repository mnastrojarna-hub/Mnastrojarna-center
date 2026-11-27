/**
 * Kolo 7, bod 21 (CAD-M1-OPRAVY.md „Co zbývá“: `window.mncad.status()` neuvádí `view=`): řádek zobrazení ve stavu aplikace.
 * Před opravou (260ff8b) funkce neexistovala a stav neříkal, zda model kreslí 3D okno, nebo softwarový náhled.
 */
import { describe, expect, it } from "vitest";
import { setLang } from "../i18n";
import { viewStatusLine } from "../soft-view";

describe("bod 21: window.mncad.status() – řádek zobrazení (view=…)", () => {
  it("WebGL: perspektiva / pravoúhlá podle volby; strojová část view=webgl", () => {
    expect(viewStatusLine("webgl")).toBe("Zobrazení: 3D okno (WebGL) · perspektiva · view=webgl projection=persp");
    expect(viewStatusLine("webgl", { ortho: true })).toBe("Zobrazení: 3D okno (WebGL) · pravoúhlá · view=webgl projection=ortho");
  });

  it("bez WebGL: softwarové zobrazení je vždy pravoúhlé – nikdy „perspektiva“ ani view=webgl (greens)", () => {
    const soft = viewStatusLine("soft");
    expect(soft).toBe("Zobrazení: Softwarové zobrazení – WebGL není dostupné · pravoúhlá (perspektiva jen ve WebGL) · view=soft projection=ortho");
    expect(soft).not.toMatch(/view=webgl|projection=persp|· perspektiva ·/);
    expect(viewStatusLine("soft", { ortho: true })).toMatch(/· pravoúhlá · view=soft projection=ortho$/);
    expect(viewStatusLine("none")).toBe("Zobrazení: model se nezobrazuje · view=none projection=ortho");
  });

  it("EN / DE: lidská věta přeložená, strojová část stejná", () => {
    try {
      setLang("en");
      expect(viewStatusLine("soft")).toMatch(/^View: Software view – WebGL is not available · orthographic \(perspective only with WebGL\) · view=soft projection=ortho$/);
      setLang("de");
      expect(viewStatusLine("webgl")).toMatch(/^Ansicht: 3D-Fenster \(WebGL\) · .* · view=webgl projection=persp$/);
    } finally {
      setLang("cs");
    }
  });
});
