import { describe, it, expect } from "vitest";
import {
  availableModes, bindingQuote, consistencyIssues, defaultMode, distributeJobValue, invoicedValueBlock, itemsPurchaseValue,
  itemsSaleValue, orderedCost, pairQuoteItems, purchaseCostEditBlock, quotePriceWarning, type MoneyItem,
} from "./consistency";

const sum = (items: MoneyItem[], prices: (number | null)[]) =>
  Math.round(items.reduce((s, it, i) => s + it.quantity * (prices[i] ?? 0), 0) * 100) / 100;

describe("součty položek", () => {
  it("hodnota = Σ počet × cena jen u nacenených; bez cen null", () => {
    expect(itemsSaleValue([{ quantity: 2, unitPrice: 54_000 }, { quantity: 1, unitPrice: 24_000 }])).toBe(132_000);
    expect(itemsSaleValue([{ quantity: 3, unitPrice: 10.1 }, { quantity: 5, unitPrice: null }])).toBe(30.3);
    expect(itemsSaleValue([{ quantity: 3, unitPrice: null }])).toBeNull();
    expect(itemsSaleValue([])).toBeNull();
    expect(itemsPurchaseValue([{ quantity: 4, unitPrice: 1, purchaseUnitPrice: 2.5 }])).toBe(10);
  });
});

describe("rozpočítání hodnoty zakázky", () => {
  const items: MoneyItem[] = [
    { quantity: 2, unitPrice: 54_000 },
    { quantity: 1, unitPrice: 24_000 },
  ];

  it("poměrně: součet přesně sedí, změna podle podílu řádků", () => {
    const r = distributeJobValue(items, 145_200, "proportional");
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.achieved).toBe(145_200);
    expect(r.exact).toBe(true);
    expect(sum(items, r.prices)).toBe(145_200);
    // +10 % u obou
    expect(r.prices).toEqual([59_400, 26_400]);
    expect(r.changes).toHaveLength(2);
  });

  it("rovnoměrně na kus: stejná změna ceny za kus", () => {
    const r = distributeJobValue(items, 132_300, "per_piece");
    expect(r.ok && r.prices).toEqual([54_100, 24_100]);
  });

  it("zaokrouhlení: zbytek haléřů na největší řádek, součet přesně", () => {
    const three: MoneyItem[] = [{ quantity: 3, unitPrice: 10 }, { quantity: 7, unitPrice: 10 }, { quantity: 1, unitPrice: 5 }];
    const r = distributeJobValue(three, 200, "proportional");
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(sum(three, r.prices)).toBe(200);
    expect(r.exact).toBe(true);
    for (const p of r.prices) expect(Math.round((p ?? 0) * 100)).toBe(Math.round((p ?? 0) * 100 + 1e-9));
  });

  it("částku nejde složit na haléře (1 položka × 3 ks) → nejbližší možná, exact=false", () => {
    const one: MoneyItem[] = [{ quantity: 3, unitPrice: 30 }];
    const r = distributeJobValue(one, 100, "proportional");
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.exact).toBe(false);
    expect(Math.abs(r.achieved - 100)).toBeLessThan(0.03);
    expect(r.prices[0]).toBeCloseTo(33.33, 2);
  });

  it("řádek po 1 ks pobere zbytek, který řádky s více kusy nepoberou", () => {
    const mix: MoneyItem[] = [{ quantity: 3, unitPrice: 30 }, { quantity: 1, unitPrice: 10 }];
    const r = distributeJobValue(mix, 133.33, "proportional");
    expect(r.ok && r.exact).toBe(true);
    if (r.ok) expect(sum(mix, r.prices)).toBe(133.33);
  });

  it("snížení na nulu i pod nulu", () => {
    const r0 = distributeJobValue(items, 0, "proportional");
    expect(r0.ok && r0.prices).toEqual([0, 0]);
    const neg = distributeJobValue([{ quantity: 1, unitPrice: 10 }, { quantity: 1, unitPrice: 1000 }], 500, "per_piece");
    expect(neg.ok).toBe(false);
  });

  it("položky bez ceny: zbytek rovnoměrně na kus jen na ně; nacenené beze změny", () => {
    const part: MoneyItem[] = [{ quantity: 2, unitPrice: 100 }, { quantity: 4, unitPrice: null }, { quantity: 1, unitPrice: null }];
    expect(availableModes(part, 700)).toEqual(["proportional", "per_piece", "unpriced"]);
    expect(defaultMode(part, 700)).toBe("unpriced");
    const r = distributeJobValue(part, 700, "unpriced");
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.prices).toEqual([100, 100, 100]);
    expect(r.changes.map((c) => c.index)).toEqual([1, 2]);
    // nižší než nacenené → na položky bez ceny nejde
    expect(distributeJobValue(part, 100, "unpriced").ok).toBe(false);
    expect(availableModes(part, 100)).toEqual(["proportional", "per_piece"]);
  });

  it("všechny řádky s nulovou cenou: poměrně = na kus", () => {
    const zero: MoneyItem[] = [{ quantity: 1, unitPrice: 0 }, { quantity: 3, unitPrice: 0 }];
    const r = distributeJobValue(zero, 400, "proportional");
    expect(r.ok && r.prices).toEqual([100, 100]);
  });

  it("bez nacenených položek poměrně nejde (hodnota je ruční)", () => {
    const r = distributeJobValue([{ quantity: 2, unitPrice: null }], 500, "proportional");
    expect(r.ok).toBe(false);
    expect(defaultMode([{ quantity: 2, unitPrice: null }], 500)).toBe("unpriced");
  });

  it("neplatná cílová hodnota", () => {
    expect(distributeJobValue(items, -1, "proportional").ok).toBe(false);
    expect(distributeJobValue(items, Number.NaN, "proportional").ok).toBe(false);
  });
});

describe("zámky a hlášky", () => {
  it("vyfakturovaná zakázka", () => {
    expect(invoicedValueBlock({ invoiceNumber: "FV-2026-0001" })).toMatch(/vyfakturovaná \(FV-2026-0001\)/);
    expect(invoicedValueBlock({ invoicedAt: "2026-11-01T10:00:00Z" })).toMatch(/vyfakturovaná/);
    expect(invoicedValueBlock({ invoiceNumber: " ", invoicedAt: null })).toBeNull();
  });

  it("nákup z objednávek: ruční změna se odmítne, stejná částka projde", () => {
    const pos = [
      { number: "OV-2026-001", status: "odeslana", total: 1000 },
      { number: "OV-2026-002", status: "zrusena", total: 5000 },
      { number: "OV-2026-003", status: "vystavena", total: 250.5 },
    ];
    expect(orderedCost(pos)).toBe(1250.5);
    expect(orderedCost([{ number: "x", status: "zrusena", total: 1 }])).toBeNull();
    expect(purchaseCostEditBlock(pos, 999)).toMatch(/OV-2026-001, OV-2026-003/);
    expect(purchaseCostEditBlock(pos, 1250.5)).toBeNull();
    expect(purchaseCostEditBlock([], 999)).toBeNull();
  });

  it("odeslaná / přijatá nabídka → upozornění na cenu", () => {
    const quotes = [
      { id: "a", number: "NAB-2026-001", state: "archivovana", total: 100, archived: true, sentAt: "2026-10-01" },
      { id: "b", number: "NAB-2026-001-2", state: "odeslana", total: 200, sentAt: "2026-10-05" },
    ];
    expect(bindingQuote(quotes)?.id).toBe("b");
    expect(quotePriceWarning(quotes, 250)).toMatch(/odeslané nabídce NAB-2026-001-2 \(200\s+Kč\)/);
    expect(quotePriceWarning(quotes, 200)).toBeNull();
    expect(quotePriceWarning([{ ...quotes[1], state: "prijata", accepted: true }], 250)).toMatch(/přijaté/);
    expect(quotePriceWarning([{ id: "c", number: "N", state: "rozpracovana", total: 1 }], 250)).toBeNull();
  });
});

describe("nesoulad údajů", () => {
  const base = {
    value: 132_000, purchaseCost: 88_000, currency: "CZK", margins: true, stage: "ve_vyrobe",
    items: [
      { id: "i1", quantity: 2, unitPrice: 54_000, label: "H-1" },
      { id: "i2", quantity: 1, unitPrice: 24_000, label: "H-2" },
    ],
  };

  it("vše sedí → bez upozornění", () => {
    expect(consistencyIssues({ ...base, purchaseOrders: [] })).toEqual([]);
  });

  it("případ majitele: součet položek ≠ hodnota, objednávky ≠ nákup", () => {
    const issues = consistencyIssues({
      ...base, value: 140_000,
      purchaseOrders: [{ id: "p1", number: "OV-1", status: "odeslana", total: 90_000 }],
    });
    expect(issues.map((i) => i.key)).toEqual(["value_items", "cost_orders"]);
    expect(issues[0].fix).toBe("value_from_items");
    expect(issues[1].fix).toBe("cost_from_orders");
  });

  it("bez cen na položkách ruční hodnota bez upozornění", () => {
    expect(consistencyIssues({ ...base, items: [{ quantity: 1, unitPrice: null }] })).toEqual([]);
  });

  it("vyfakturovaná: rozdíl ukáže, ale bez opravy jedním klikem", () => {
    const [i] = consistencyIssues({ ...base, value: 1, invoiceNumber: "FV-1" });
    expect(i.key).toBe("value_items");
    expect(i.fix).toBeUndefined();
  });

  it("počty kusů objednávky vs. zakázky a termíny po termínu zákazníka", () => {
    const issues = consistencyIssues({
      ...base, dueDate: "2026-12-01", maxToleratedDate: "2026-11-20",
      purchaseOrders: [{
        id: "p1", number: "OV-1", status: "potvrzena", total: 88_000, requiredDate: "2026-11-25", confirmedDate: "2026-12-05",
        items: [{ orderItemId: "i1", quantity: 1 }, { orderItemId: "i2", quantity: 1 }],
      }],
    });
    expect(issues.map((i) => i.key)).toEqual(["po_qty_p1_i1", "po_date_p1", "dates_max"]);
    expect(issues[0].text).toMatch(/objednáno 1 ks, zakázka má 2 ks \(méně\)/);
    expect(issues[1].tone).toBe("danger");
  });

  it("nákup podle položek bez objednávek", () => {
    const issues = consistencyIssues({
      ...base, purchaseOrders: [],
      items: [{ id: "i1", quantity: 2, unitPrice: 66_000, purchaseUnitPrice: 40_000 }],
    });
    expect(issues.map((i) => i.key)).toEqual(["cost_items"]);
  });

  it("nabídka odeslaná s jinou cenou", () => {
    const issues = consistencyIssues({ ...base, quotes: [{ id: "q", number: "NAB-9", state: "odeslana", total: 120_000, sentAt: "2026-10-01" }] });
    expect(issues).toHaveLength(1);
    expect(issues[0]).toMatchObject({ key: "value_quote", fix: "quote_revision", quoteId: "q" });
  });
});

describe("párování položek nabídky", () => {
  it("podle výkresu, pak názvu, pak pozice", () => {
    const job = [{ drawingNumber: "H-200", name: "Hřídel" }, { drawingNumber: null, name: "Pouzdro" }, { drawingNumber: "X", name: "" }];
    const quote = [{ drawingNumber: null, name: "pouzdro" }, { drawingNumber: "h 200", name: "Hridel" }, { drawingNumber: "Y", name: "" }];
    const m = pairQuoteItems(job, quote);
    expect(m.get(0)).toBe(1);
    expect(m.get(1)).toBe(0);
    expect(m.get(2)).toBe(2);
  });
  it("nejednoznačné výkresy se nepárují naslepo, jiný počet položek bez pozice", () => {
    const m = pairQuoteItems([{ drawingNumber: "A" }, { drawingNumber: "A" }], [{ drawingNumber: "A" }]);
    expect(m.size).toBe(0);
  });
});
