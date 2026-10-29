import { describe, it, expect } from "vitest";
import {
  allocatedOf, capacityOf, invoiceUnallocated, parseAmount, rebalance, remainderOf, round2, splitByPercent, splitEvenly, splitRow,
  toCents, validateAllocations, type EditableRow,
} from "./money";

const items = [{ id: "a", amount: 30_000 }, { id: "b", amount: 1_250.5 }];

describe("haléře a zápis částek", () => {
  it("převod bez chyb plovoucí čárky", () => {
    expect(toCents(0.1 + 0.2)).toBe(30);
    expect(round2(1.005 + 2.005)).toBe(3.01);
    expect(toCents("1 234,50")).toBe(123_450);
  });
  it("česky zapsané částky", () => {
    expect(parseAmount("10 000")).toBe(10_000);
    expect(parseAmount("1 234,5 Kč")).toBe(1_234.5);
    expect(parseAmount("-500")).toBe(-500);
    expect(parseAmount("abc")).toBeNull();
    expect(parseAmount("")).toBeNull();
  });
});

describe("kapacita a zbytek", () => {
  it("položka = její částka, hlavička = net − Σ položek (bez položek celý net)", () => {
    expect(capacityOf("a", 40_000, items)).toBe(30_000);
    expect(capacityOf(null, 32_000, items)).toBe(749.5);
    expect(capacityOf(null, 5_000, [])).toBe(5_000);
  });
  it("zbytek po rozdělení a celkový nerozdělený zbytek", () => {
    const rows = [{ itemId: "a", amount: 10_000 }, { itemId: "a", amount: 15_000 }, { itemId: null, amount: 700 }];
    expect(allocatedOf("a", rows)).toBe(25_000);
    expect(remainderOf("a", 32_000, items, rows)).toBe(5_000);
    expect(remainderOf(null, 32_000, items, rows)).toBe(49.5);
    expect(invoiceUnallocated(32_000, items, rows)).toBe(5_000 + 1_250.5 + 49.5);
  });
});

describe("dělení částkou a procenty", () => {
  it("procenta na haléře — součet sedí přesně (100 / 3)", () => {
    const parts = splitByPercent(100, [33.3333, 33.3333, 33.3334]);
    expect(parts.reduce((s, x) => s + toCents(x), 0)).toBe(10_000);
    expect(splitByPercent(30_000, [100 / 3, 200 / 3])).toEqual([10_000, 20_000]);
    expect(splitEvenly(0.05, 2)).toEqual([0.03, 0.02]);
    expect(splitEvenly(-10, 3).reduce((s, x) => s + toCents(x), 0)).toBe(-1000);
  });
  it("procenta pod 100 rozdělí jen svůj podíl", () => {
    expect(splitByPercent(1000, [10, 20])).toEqual([100, 200]);
  });
});

describe("„10 000 sem, 20 000 tam“ ze 30 000 dvěma ťuknutími", () => {
  type R = EditableRow & { job?: string };
  let n = 0;
  const make = (amount: number): R => ({ key: `k${++n}`, itemId: "a", amount });
  it("Rozdělit rozpůlí plnou alokaci a nový řádek dopočítává zbytek", () => {
    let rows: R[] = [{ key: "ai", itemId: "a", amount: 30_000, job: "Z-1" }];
    rows = splitRow(rows, "a", 30_000, make);
    expect(rows.map((r) => r.amount)).toEqual([15_000, 15_000]);
    expect(rows[1].auto).toBe(true);
    // ťuk 2: první řádek 10 000 → druhý sám 20 000
    rows = rebalance(rows.map((r) => (r.key === "ai" ? { ...r, amount: 10_000 } : r)), "a", 30_000, "ai");
    expect(rows.map((r) => r.amount)).toEqual([10_000, 20_000]);
  });
  it("Rozdělit se zbytkem dá zbytek novému řádku; přetečení zbytkový řádek nevyrovná do mínusu", () => {
    let rows: R[] = [{ key: "x", itemId: "a", amount: 12_000 }];
    rows = splitRow(rows, "a", 30_000, make);
    expect(rows[1].amount).toBe(18_000);
    rows = rebalance(rows.map((r) => (r.key === "x" ? { ...r, amount: 31_000 } : r)), "a", 30_000, "x");
    expect(rows[1].amount).toBe(0);
  });
});

describe("kontrola rozdělení", () => {
  const inv = { totalNet: 31_250.5, items };
  it("v pořádku", () => {
    expect(validateAllocations(inv, [
      { itemId: "a", target: "job", jobId: "j1", category: null, amount: 10_000 },
      { itemId: "a", target: "job", jobId: "j2", category: null, amount: 20_000 },
      { itemId: "b", target: "rezie", jobId: null, category: "doprava", amount: 1_250.5 },
    ])).toBeNull();
  });
  it("přes částku položky, bez zakázky, nulová a opačné znaménko", () => {
    expect(validateAllocations(inv, [
      { itemId: "a", target: "job", jobId: "j1", category: null, amount: 20_000 },
      { itemId: "a", target: "job", jobId: "j2", category: null, amount: 10_000.01 },
    ])).toMatch(/o 0,01 víc/);
    expect(validateAllocations(inv, [{ itemId: "a", target: "job", jobId: null, category: null, amount: 1 }])).toMatch(/Vyber zakázku/);
    expect(validateAllocations(inv, [{ itemId: "a", target: "job", jobId: "j", category: null, amount: 0 }])).toMatch(/nenulovou/);
    expect(validateAllocations(inv, [{ itemId: "a", target: "job", jobId: "j", category: null, amount: -5 }])).toMatch(/znaménko/);
    expect(validateAllocations({ totalNet: 31_250.5, items }, [{ itemId: null, target: "rezie", jobId: null, category: "ostatni", amount: 1 }])).toMatch(/není co rozdělit/);
  });
  it("dobropis: záporná položka se dělí zápornými částkami", () => {
    expect(validateAllocations({ totalNet: -1000, items: [{ id: "c", amount: -1000 }] }, [
      { itemId: "c", target: "job", jobId: "j", category: null, amount: -600 },
      { itemId: "c", target: "job", jobId: "k", category: null, amount: -400 },
    ])).toBeNull();
  });
});
