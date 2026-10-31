import { describe, expect, it } from "vitest";
import { fmtKg, massKg, standardBar, stockFor } from "./stock";
import { MATERIALS } from "@/lib/pricing/materials";

const density = (key: string) => MATERIALS.find((m) => m.key === key)!.densityKgDm3;

describe("hmotnost a polotovar z modelu", () => {
  it("hmotnost dílu = objem × hustota (krychle 100 mm)", () => {
    // 1 dm³ oceli = 7,85 kg, hliníku 2,7 kg
    expect(massKg(1_000_000, density("12050"))).toBeCloseTo(7.85, 6);
    expect(massKg(1_000_000, density("alu_6082"))).toBeCloseTo(2.7, 6);
    expect(fmtKg(7.85)).toBe("7,85 kg");
    expect(fmtKg(0.0123)).toBe("0,012 kg");
  });

  it("přířez: kvádr + standardní přídavky (podle nacenění), celé mm", () => {
    const r = stockFor({ size: [120, 60, 25], volumeMm3: 120 * 60 * 25 * 0.6 }, 7.85, "prirez");
    // přídavek 120 → 5, 60 → 4, 25 → 3
    expect(r.dims).toEqual([125, 64, 28]);
    expect(r.label).toBe("Přířez 125 × 64 × 28 mm");
    expect(r.massKg).toBeCloseTo((125 * 64 * 28 / 1e6) * 7.85, 6);
    expect(r.partMassKg).toBeCloseTo((120 * 60 * 25 * 0.6 / 1e6) * 7.85, 6);
    expect(r.utilization).toBeGreaterThan(0);
    expect(r.utilization).toBeLessThan(100);
    expect(r.wasteKg).toBeCloseTo(r.massKg - r.partMassKg, 9);
  });

  it("tenký díl = plech: tloušťka bez přídavku", () => {
    const r = stockFor({ size: [200, 100, 3], volumeMm3: 200 * 100 * 3 }, 7.85);
    expect(r.sheet).toBe(true);
    expect(r.dims).toEqual([205, 105, 3]);
  });

  it("rotační díl automaticky jako kulatina, průměr na běžnou tyč", () => {
    const r = stockFor({ size: [40, 40, 80], round: { diameter: 40, length: 80 }, volumeMm3: Math.PI * 20 * 20 * 80 }, 7.85);
    // ⌀40 + 4 = 44 → tyč ⌀45; délka 80 + 4 = 84
    expect(r.kind).toBe("kulatina");
    expect(r.dims).toEqual([45, 84]);
    expect(r.label).toBe("Kulatina ⌀45 × 84 mm");
    expect(r.massKg).toBeCloseTo((Math.PI * 22.5 ** 2 * 84 / 1e6) * 7.85, 6);
  });

  it("vlastní přídavek přepíše standard", () => {
    const r = stockFor({ size: [50, 50, 50], volumeMm3: 125000 }, 2.7, "prirez", 10);
    expect(r.dims).toEqual([60, 60, 60]);
    const k = stockFor({ size: [30, 30, 100], round: { diameter: 30, length: 100 }, volumeMm3: 70000 }, 2.7, "kulatina", 0);
    expect(k.dims).toEqual([30, 100]);
  });

  it("kulatina u nerotačního dílu: průměr přes úhlopříčku průřezu", () => {
    const r = stockFor({ size: [30, 40, 100], volumeMm3: 100000 }, 7.85, "kulatina");
    // úhlopříčka 50 + 4 = 54 → ⌀55
    expect(r.dims[0]).toBe(55);
  });

  it("řada průměrů tyčí", () => {
    expect(standardBar(44)).toBe(45);
    expect(standardBar(45)).toBe(45);
    expect(standardBar(45.2)).toBe(48);
    expect(standardBar(301)).toBe(310);
  });
});
