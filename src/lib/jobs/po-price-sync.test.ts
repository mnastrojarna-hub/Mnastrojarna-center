import { describe, expect, it } from "vitest";
import { nextPoLinePrice } from "./po-price-sync";

describe("nákupní cena položky → neodeslaná objednávka (16. 11.)", () => {
  const ch = (before: number | null, after: number | null) => ({ orderItemId: "i", before, after });
  it("řádek bez ceny dostane uloženou cenu", () => {
    expect(nextPoLinePrice({ unitPrice: null, unit: "ks" }, ch(null, 120))).toBe(120);
  });
  it("řádek s předchozí uloženou cenou se aktualizuje", () => {
    expect(nextPoLinePrice({ unitPrice: 100, unit: "ks" }, ch(100, 95.5))).toBe(95.5);
  });
  it("cena dodavatele z nabídky (jiná) zůstane; kg / kpl se nemění; smazání nic nemaže", () => {
    expect(nextPoLinePrice({ unitPrice: 80, unit: "ks" }, ch(100, 95))).toBeUndefined();
    expect(nextPoLinePrice({ unitPrice: null, unit: "kg" }, ch(null, 95))).toBeUndefined();
    expect(nextPoLinePrice({ unitPrice: 100, unit: "ks" }, ch(100, null))).toBeUndefined();
  });
});
