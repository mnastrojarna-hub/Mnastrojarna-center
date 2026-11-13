/** ISO 286-1: úchylky polí tolerance proti známým hodnotám z tabulek, druh uložení a zápis na výkres. */
import { describe, expect, it } from "vitest";
import { describeFit, fitDeviations, fitOfSuffix, fitPair, fitRows, fitSuffix, fmtDev, itValue, parseFit, parseZone } from "./drawing-fits";

const dev = (size: number, code: string) => fitDeviations(size, code);

describe("ISO 286 – stupně IT", () => {
  it("IT podle rozsahu jmenovitého rozměru", () => {
    expect(itValue(40, 7)).toBe(25);
    expect(itValue(40, 6)).toBe(16);
    expect(itValue(25, 7)).toBe(21);
    expect(itValue(3, 7)).toBe(10); // hranice rozsahu patří do nižšího rozsahu
    expect(itValue(3.01, 7)).toBe(12);
    expect(itValue(500, 11)).toBe(400);
    expect(() => itValue(501, 7)).toThrow(/mimo tabulky/);
    expect(() => itValue(40, 19)).toThrow(/IT19 neexistuje/);
  });
});

describe("ISO 286 – mezní úchylky [µm]", () => {
  it.each([
    [40, "H7", 25, 0],
    [40, "g6", -9, -25],
    [25, "H7", 21, 0],
    [25, "k6", 15, 2],
    [30, "h6", 0, -13],
    [50, "H8", 39, 0],
    [50, "f7", -25, -50],
    [60, "s6", 72, 53],
    [100, "P7", -24, -59],
    [20, "N7", -7, -28],
    [6, "H7", 12, 0],
    [12, "F8", 43, 16],
    [200, "H7", 46, 0],
    [400, "g6", -18, -54],
    [35, "K6", 3, -13],
    [40, "K7", 7, -18],
    [40, "M7", 0, -25],
    [40, "M6", -4, -20],
    [25, "S7", -27, -48],
    [40, "j6", 11, -5],
    [40, "u6", 76, 60], // 40 patří do rozsahu 30…40
    [45, "u6", 86, 70],
    [40, "N7", -8, -33],
    [40, "P7", -17, -42],
    [40, "e8", -50, -89],
    [80, "d9", -100, -174],
    [10, "js6", 4.5, -4.5],
    [40, "JS7", 12, -12], // IT7 = 25 (liché) → ±12
    [40, "J7", 14, -11],
    [25, "m6", 21, 8],
    [25, "n6", 28, 15],
    [25, "p6", 35, 22],
    [25, "r6", 41, 28],
    [40, "t6", 64, 48],
    [2, "H7", 10, 0],
    [2, "N7", -4, -14],
  ])("Ø%s %s = %s/%s", (size, code, upper, lower) => {
    expect(dev(size, code)).toEqual({ upper, lower });
  });
  it("pole bez definice pro rozměr / neplatný zápis", () => {
    expect(dev(10, "t6")).toBeNull(); // t až od 24 mm
    expect(dev(40, "cd6")).toBeNull(); // cd jen do 10 mm
    expect(dev(40, "j9")).toBeNull();
    expect(dev(600, "H7")).toBeNull();
    expect(dev(40, "6H")).toBeNull(); // tolerance závitu, ne ISO 286
    expect(dev(40, "Js7")).toBeNull();
  });
});

describe("uložení díra/hřídel", () => {
  it("Ø25 H7/k6 přechodné, Ø40 H7/g6 s vůlí, Ø40 H7/s6 s přesahem", () => {
    const a = fitPair(25, "H7", "k6");
    expect(a).toMatchObject({ hole: { upper: 21, lower: 0 }, shaft: { upper: 15, lower: 2 }, maxClearance: 19, minClearance: -15, kind: "transition" });
    expect(fitPair(40, "H7", "g6")).toMatchObject({ maxClearance: 50, minClearance: 9, kind: "clearance" });
    expect(fitPair(40, "H7", "s6")).toMatchObject({ kind: "interference" });
    expect(() => fitPair(40, "g6", "H7")).toThrow(/není pole tolerance díry/);
  });
  it("rozpoznání zápisu", () => {
    expect(parseZone("H7")).toEqual({ letter: "H", grade: 7, hole: true });
    expect(parseZone("zc11")).toEqual({ letter: "zc", grade: 11, hole: false });
    expect(parseZone("±0,1")).toBeNull();
    expect(parseFit("H7 / g6")).toMatchObject({ hole: { letter: "H" }, shaft: { letter: "g" } });
    expect(parseFit("g6/H7")).toBeNull();
    expect(fitOfSuffix(" H7")).toBe("H7");
    expect(fitOfSuffix("h6")).toBe("h6");
    expect(fitOfSuffix(" ±0,05")).toBeNull();
    expect(fitOfSuffix(undefined)).toBeNull();
  });
});

describe("zápis na výkres", () => {
  it("úchylky v mm (0 bez znaménka), mezní rozměry, uložení", () => {
    expect(fmtDev(25)).toBe("+0,025");
    expect(fmtDev(-9)).toBe("−0,009");
    expect(fmtDev(0)).toBe("0");
    expect(fitSuffix(40, "H7", "dev")).toBe("(+0,025/0)");
    expect(fitSuffix(40, "g6", "dev")).toBe("(−0,009/−0,025)");
    expect(fitSuffix(40, "H7", "limits")).toBe("(40,025/40,000)");
    expect(fitSuffix(40, "H7", "code")).toBe("");
    expect(fitSuffix(25, "H7/k6", "dev")).toBe("(+0,021/0 · +0,015/+0,002)");
    expect(fitSuffix(40, "±0,1", "dev")).toBe("");
  });
  it("tabulka uložení a popis pro agenty", () => {
    const rows = fitRows([
      { label: "Ø40H7", size: 40, code: "H7" },
      { label: "Ø40H7", size: 40, code: "H7" },
      { label: "Ø25 H7/k6", size: 25, code: "H7/k6" },
      { label: "25 ±0,1", size: 25, code: "±0,1" },
    ]);
    expect(rows.map((r) => `${r.label} ${r.code} ${r.upper}/${r.lower} ${r.max}…${r.min}`)).toEqual(["Ø40H7 H7 +0,025/0 40,025…40,000", "Ø25 H7/k6 H7 +0,021/0 25,021…25,000", "Ø25 H7/k6 k6 +0,015/+0,002 25,015…25,002"]);
    expect(rows[1].kind).toBe("přechodné");
    expect(describeFit(40, "H7/g6")).toBe("Ø40 H7/g6: díra +0,025/0, hřídel −0,009/−0,025, vůle 0,009…0,05 (s vůlí)");
    expect(describeFit(40, "H7")).toBe("40 H7: +0,025/0 (mezní rozměry 40,000 až 40,025)");
    expect(() => describeFit(40, "xx")).toThrow(/není zápis uložení/);
  });
});
