/**
 * Kolo 7b, bod 14 (nález oponenta): uložené ukotvení „right“ platilo na každé šířce okna, ale tlačítko pro uvolnění je pod
 * `md` (768 px) skryté – na úzkém okně stál sloupec 352 px vedle 3D okna bez ovládání. Skutečné ukotvení teď platí jen na
 * dost širokém okně. (Na 7d72099 funkce neexistovala – test padá na importu; v e2e cad-w22-v krok „úzké okno 700 px“.)
 */
import { describe, expect, it } from "vitest";
import { effectiveMotionDock, MOTION_DOCK_MIN_WIDTH } from "./motion-dock";

describe("bod 14: ukotvení panelu studie podle šířky okna", () => {
  it("uložené „right“ platí jen od šířky md (768 px), pod ní je panel plovoucí", () => {
    expect(MOTION_DOCK_MIN_WIDTH).toBe(768);
    expect(effectiveMotionDock("right", 1280)).toBe("right");
    expect(effectiveMotionDock("right", 768)).toBe("right");
    expect(effectiveMotionDock("right", 767)).toBe("float");
    expect(effectiveMotionDock("right", 0)).toBe("float");
    // šířka neznámá (vykreslení na serveru) = plovoucí, nikdy sloupec bez ovládání
    expect(effectiveMotionDock("right", null)).toBe("float");
    expect(effectiveMotionDock("float", 1920)).toBe("float");
  });
});
