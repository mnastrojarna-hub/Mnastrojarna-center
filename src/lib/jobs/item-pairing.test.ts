import { describe, expect, it } from "vitest";
import {
  findDuplicateItems, itemNameScore, itemNameTokens, pairDocLines, scoreLinePair, totalsMatch, PAIR_SURE,
  type PairExisting,
} from "./item-pairing";

// Z-2026-022 (majitel 30. 10.): položky z poptávky / výkresů + objednávka jen s názvy „… 142/026"
const JOB: PairExisting[] = [
  { id: "i1", position: 0, drawingNumber: "F0N603W88", revision: "02", name: "Unašeč upravený", quantity: 4, unitPrice: 18630 },
  { id: "i2", position: 1, drawingNumber: "EM7223CL0000", revision: "02", name: "Matice upravená", quantity: 8, unitPrice: 9620 },
];
const ORDER = [
  { name: "Unašeč upravený", description: "Unašeč upravený 142/026", quantity: 4, unitPrice: 18630 },
  { name: "Matice upravená", description: "Matice upravená 142/026", quantity: 8, unitPrice: 9620 },
];

describe("itemNameTokens / itemNameScore", () => {
  it("bez diakritiky, odkazů na objednávku a pozici, koncovek", () => {
    expect(itemNameTokens("Unašeč upravený 142/026")).toEqual(["unasec", "upraven"]);
    expect(itemNameTokens("poz. 3 — MATICE upravená, 8 ks")).toEqual(["matic", "upraven"]);
    expect(itemNameTokens("Příruba M12x1,5")).toContain("m12x1");
  });
  it("stejný díl v různém zápisu = 1, různé díly nízko", () => {
    expect(itemNameScore("Unašeč upravený 142/026", "Unašeč upravený")).toBe(1);
    expect(itemNameScore("Matice upravená", "MATICE UPRAVENE")).toBe(1);
    expect(itemNameScore("Unašeč upravený", "Unašeč")).toBeGreaterThan(0.75);
    expect(itemNameScore("Unašeč upravený", "Matice upravená")).toBeLessThan(0.4);
    expect(itemNameScore("Hřídel", "Příruba")).toBeLessThan(0.3);
  });
});

describe("scoreLinePair", () => {
  it("různá čísla výkresu = nikdy", () => {
    expect(scoreLinePair({ drawingNumber: "A-1", name: "Díl" }, { id: "x", drawingNumber: "A-2", name: "Díl" }).incompatible).toBe(true);
  });
  it("číslo výkresu položky v textu řádku", () => {
    const s = scoreLinePair({ name: "F0N 603 W88 Unašeč" }, JOB[0]);
    expect(s.score).toBeGreaterThanOrEqual(95);
  });
  it("stejný název + počet + cena = jisté", () => {
    expect(scoreLinePair(ORDER[0], JOB[0]).score).toBeGreaterThanOrEqual(PAIR_SURE);
  });
});

describe("pairDocLines", () => {
  it("screenshot Z-2026-022: obě řádky objednávky = existující položky, součet sedí", () => {
    const r = pairDocLines(ORDER, JOB, { orderTotal: 151480, lineWins: true });
    expect(r.pairs.map((p) => [p.line, p.itemId, p.confidence])).toEqual([[0, "i1", "sure"], [1, "i2", "sure"]]);
    expect(r.newLines).toEqual([]);
    expect(r.totals).toMatchObject({ order: 151480, ifPaired: 151480, pairedMatches: true, appendMatches: true });
  });

  it("nejistý řádek: součet objednávky rozhodne pro spárování", () => {
    // jiný název (zkratka zákazníka), stejný počet i cena → bez součtu jen otázka; součet sedí → jisté
    const lines = [{ name: "Díl A 142/026", quantity: 4, unitPrice: 18630 }, ORDER[1]];
    const noTotal = pairDocLines(lines, JOB, { lineWins: true });
    expect(noTotal.pairs.find((p) => p.line === 0)?.confidence ?? "none").not.toBe("sure");
    const withTotal = pairDocLines(lines, JOB, { orderTotal: 151480, lineWins: true });
    expect(withTotal.pairs.map((p) => [p.line, p.itemId])).toEqual([[0, "i1"], [1, "i2"]]);
    expect(withTotal.pairs.find((p) => p.line === 0)?.confidence).toBe("ask");
    expect(withTotal.totals?.pairedMatches).toBe(true);
    expect(withTotal.totals?.appendMatches).toBe(false);
  });

  it("podobný název, součet sedí jen se spárováním → jisté", () => {
    const lines = [{ name: "Unašeč 142/026", quantity: 4, unitPrice: 18630 }, ORDER[1]];
    const r = pairDocLines(lines, JOB, { orderTotal: 151480, lineWins: true });
    expect(r.pairs.every((p) => p.confidence === "sure")).toBe(true);
  });

  it("opravdu nová položka (součet sedí jen s přidáním) se nepáruje", () => {
    const lines = [{ name: "Pouzdro kalené", quantity: 4, unitPrice: 1000 }];
    const r = pairDocLines(lines, JOB, { orderTotal: 151480 + 4000 });
    expect(r.pairs).toEqual([]);
    expect(r.newLines).toEqual([0]);
  });

  it("dvě stejně pojmenované položky (jiné výkresy) a řádek bez výkresu = otázka", () => {
    const items: PairExisting[] = [
      { id: "a", drawingNumber: "X-1", name: "Unašeč", quantity: 4, unitPrice: 100 },
      { id: "b", drawingNumber: "X-2", name: "Unašeč", quantity: 4, unitPrice: 100 },
    ];
    const r = pairDocLines([{ name: "Unašeč", quantity: 4, unitPrice: 100 }], items);
    expect(r.pairs).toHaveLength(1);
    expect(r.pairs[0].confidence).toBe("ask");
  });

  it("DPH varianta: AI vzala částku s DPH", () => {
    expect(totalsMatch(151480, 151480 * 1.21)).toBe(true);
    expect(totalsMatch(151480, 151480.6)).toBe(true);
    expect(totalsMatch(303040, 151480)).toBe(false);
  });
});

describe("findDuplicateItems", () => {
  it("screenshot Z-2026-022: 2 duplicity, ponechá položky s výkresem", () => {
    const items = [
      ...JOB,
      { id: "d1", position: 2, name: "Unašeč upravený", description: "Unašeč upravený 142/026", quantity: 4, unitPrice: 18630 },
      { id: "d2", position: 3, name: "Matice upravená", description: "Matice upravená 142/026", quantity: 8, unitPrice: 9620 },
    ];
    expect(findDuplicateItems(items, { orderTotal: 151480 })).toEqual([
      { keepId: "i1", dropId: "d1", reason: expect.stringContaining("2× hodnota") },
      { keepId: "i2", dropId: "d2", reason: expect.stringContaining("2× hodnota") },
    ]);
    expect(findDuplicateItems(items).map((d) => [d.keepId, d.dropId])).toEqual([["i1", "d1"], ["i2", "d2"]]);
  });

  it("různý počet nebo cena, dvě čísla výkresu = ne duplicita", () => {
    expect(findDuplicateItems([JOB[0], { id: "d1", name: "Unašeč upravený", quantity: 5, unitPrice: 18630 }])).toEqual([]);
    expect(findDuplicateItems([JOB[0], { id: "d1", name: "Unašeč upravený", quantity: 4, unitPrice: 17000 }])).toEqual([]);
    expect(findDuplicateItems([JOB[0], { ...JOB[0], id: "x", drawingNumber: "F0N603W89" }])).toEqual([]);
  });
});
