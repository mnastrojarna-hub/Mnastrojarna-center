import { describe, expect, it } from "vitest";
import { COMPANY_LEAK_WARNING, companyLeakWarning } from "./decide";
import { anonOutPath } from "./filename";
import { subtractBoxes } from "./company-check";

describe("anonOutPath: klíč v úložišti bez diakritiky (12. 11., chyba Invalid key)", () => {
  it("Příloha_bez_názvu → ASCII, přípona zachována", () => {
    const p = anonOutPath("zakazky/j1/anon/", "u1", "Příloha_bez_názvu-_00290.pdf");
    expect(p).toBe("zakazky/j1/anon/u1-Priloha_bez_nazvu-_00290.pdf");
    expect(p).toMatch(/^[A-Za-z0-9._/-]+$/);
  });
  it("mezery, závorky a & jen bezpečné znaky; prázdný název → výchozí", () => {
    const p = anonOutPath("p/", "u", "Výkres (rev. B) & sestava.PDF");
    expect(p.startsWith("p/u-Vykres")).toBe(true);
    expect(p.endsWith(".PDF")).toBe(true);
    expect(p.slice(2)).toMatch(/^[A-Za-z0-9._-]+$/);
    expect(anonOutPath("p/", "u", "")).toBe("p/u-vykres.pdf");
    expect(anonOutPath("p/", "u", null)).toBe("p/u-vykres.pdf");
  });
});

describe("companyLeakWarning: hláška s názvem, který v kopii zůstal (12. 11.)", () => {
  it("bez názvů jako dřív, s názvy v uvozovkách (max. 3, bez duplicit)", () => {
    expect(companyLeakWarning(1)).toBe(`${COMPANY_LEAK_WARNING} (strana 1).`);
    expect(companyLeakWarning(2, ["ACME s.r.o.", "ACME s.r.o.", " Böhler ", "X", "Y"])).toBe(`${COMPANY_LEAK_WARNING} „ACME s.r.o.“, „Böhler“, „X“ (strana 2).`);
  });
  it("začíná COMPANY_LEAK_WARNING — kopie se dál nepoužije", () => {
    expect(companyLeakWarning(3, ["Firma"]).startsWith(COMPANY_LEAK_WARNING)).toBe(true);
  });
});

describe("12. 11.: nález přes chráněné pole se vypálí kolem něj", () => {
  it("subtractBoxes: cesta s číslem výkresu uprostřed → vlevo a vpravo zbytek, číslo zůstane", () => {
    const path = { x: 0, y: 0, w: 300, h: 10 };
    const num = { x: 120, y: -2, w: 60, h: 14 };
    const parts = subtractBoxes(path, [num]);
    expect(parts).toEqual([{ x: 0, y: 0, w: 120, h: 10 }, { x: 180, y: 0, w: 120, h: 10 }]);
    for (const p of parts) expect(p.x + p.w <= num.x || p.x >= num.x + num.w).toBe(true);
  });
  it("bez překryvu beze změny; celé zakryté → nic", () => {
    expect(subtractBoxes({ x: 0, y: 0, w: 10, h: 10 }, [{ x: 50, y: 50, w: 5, h: 5 }])).toEqual([{ x: 0, y: 0, w: 10, h: 10 }]);
    expect(subtractBoxes({ x: 0, y: 0, w: 10, h: 10 }, [{ x: -1, y: -1, w: 20, h: 20 }])).toEqual([]);
  });
  it("hláška nese i důvod, proč to nešlo vypálit", () => {
    expect(companyLeakWarning(1, ["DEL"], "leží přes číslo výkresu / materiál (chráněné pole)")).toBe(`${COMPANY_LEAK_WARNING} „DEL“ (strana 1; leží přes číslo výkresu / materiál (chráněné pole)).`);
  });
});
