import { describe, it, expect } from "vitest";
import {
  deliveryUpdates, isOrderRevision, issuerKey, looksLikeCancellation, normRef, orderChanges, orderedShare, pairLines, quoteMismatch,
  receiptUpdates,
} from "./capture-flow-rules";

const line = (drawingNumber: string, quantity: number, revision = "") => ({
  drawingNumber, revision, name: "", description: "", material: "", quantity, unit: "ks", unitPrice: 0, deliveryDate: "",
});

describe("foto → podrobné stavy: čistá pravidla", () => {
  it("vystavitel a čísla dokladů", () => {
    expect(issuerKey("my")).toBe("my");
    expect(issuerKey("neznamy")).toBeNull();
    expect(issuerKey(null)).toBeNull();
    expect(normRef(" vk-2291 / b ")).toBe("VK2291B");
  });

  it("párování řádků: číslo výkresu, jediný řádek ↔ jediná položka, nepárované", () => {
    const items = [{ id: "a", drawingNumber: "VK-2291", name: "Upínka" }, { id: "b", drawingNumber: "VK-2292", name: null }];
    const r = pairLines([line("vk 2291", 5), line("X-1", 2), line("VK-2292", 0)], items);
    expect(r.pairs.map((p) => [p.item.id, p.quantity])).toEqual([["a", 5]]);
    expect(r.unmatched.map((u) => u.drawingNumber)).toEqual(["X-1"]);
    expect(pairLines([line("cokoli", 3)], [{ id: "z", drawingNumber: "JINE", name: null }]).pairs[0]).toMatchObject({ quantity: 3 });
  });

  it("dodání z našeho DL: přičte, nepřekročí objednané, uzavřené / dodané přeskočí", () => {
    const items = [
      { id: "a", drawingNumber: "A-1", name: null, quantity: 10, deliveredQuantity: 4, deliveryClosed: false, unit: "ks" },
      { id: "b", drawingNumber: "A-2", name: null, quantity: 5, deliveredQuantity: 5, deliveryClosed: false, unit: "ks" },
      { id: "c", drawingNumber: "A-3", name: null, quantity: 8, deliveredQuantity: 1, deliveryClosed: true, unit: "ks" },
    ];
    const r = deliveryUpdates([line("A-1", 20), line("A-2", 1), line("A-3", 7), line("Q-9", 1)], items);
    expect(r.updates).toEqual([{ itemId: "a", delivered: 10, before: 4, label: "A-1", unit: "ks" }]);
    expect(r.unmatched).toEqual(["Q-9"]);
  });

  it("převzetí z DL dodavatele: přičte k převzatému, max. objednané", () => {
    const items = [
      { id: "p1", drawingNumber: "PR-1", name: null, quantity: 200, receivedQuantity: 150, receiptClosed: false },
      { id: "p2", drawingNumber: "PR-2", name: null, quantity: 10, receivedQuantity: 0, receiptClosed: true },
    ];
    expect(receiptUpdates([line("PR-1", 80), line("PR-2", 10)], items)).toEqual([{ itemId: "p1", received: 200 }]);
  });

  it("revize: stejné číslo objednávky u zakázky s objednávkou (ne storno, ne bez objednávky)", () => {
    expect(isOrderRevision({ orderStatus: "potvrzena", customerOrderNumber: "PO 4471" }, "po-4471")).toBe(true);
    expect(isOrderRevision({ orderStatus: "dorucena", customerOrderNumber: "PO-4471" }, "PO-4472")).toBe(false);
    expect(isOrderRevision({ orderStatus: null, customerOrderNumber: "PO-4471" }, "PO-4471")).toBe(false);
    expect(isOrderRevision({ orderStatus: "stornovana", customerOrderNumber: "PO-4471" }, "PO-4471")).toBe(false);
    expect(isOrderRevision({ orderStatus: "potvrzena", customerOrderNumber: null }, "")).toBe(false);
  });

  it("rozdíl objednávky proti uloženým hodnotám: množství, revize výkresu, nová / chybějící položka, termín, cena", () => {
    const job = {
      orderStatus: "potvrzena", customerOrderNumber: "PO-1", customerRequiredDate: "2026-11-20", value: 100_000,
      items: [
        { id: "a", drawingNumber: "VK-1", name: null, quantity: 40, revision: "A", unit: "ks" },
        { id: "b", drawingNumber: "VK-3", name: null, quantity: 5, revision: null, unit: "ks" },
      ],
    };
    const ch = orderChanges({ items: [line("VK-1", 50, "B"), line("VK-2", 10)], requiredDeliveryDate: "2026-11-27", totalWithoutVat: 107_000 }, job);
    expect(ch.map((c) => [c.label, c.from, c.to])).toEqual([
      ["Množství VK-1 (ks)", 40, 50],
      ["Revize výkresu VK-1", "A", "B"],
      ["Nová položka VK-2", null, 10],
      ["Chybí položka VK-3", 5, null],
      ["Požadovaný termín", "2026-11-20", "2026-11-27"],
      ["Cena celkem bez DPH", 100_000, 107_000],
    ]);
    // stejný doklad podruhé = beze změny
    expect(orderChanges({ items: [line("VK-1", 40, "A"), line("VK-3", 5)], requiredDeliveryDate: "2026-11-20", totalWithoutVat: 100_500 }, job)).toEqual([]);
  });

  it("rozpor s nabídkou: cena ±1 %, množství, navíc / chybí, termín vs. dodací lhůta; sedí = prázdné", () => {
    const quote = { number: "NAB-1", total: 100_000, leadTimeDays: 30, items: [{ drawingNumber: "VK-1", name: null, quantity: 50 }, { drawingNumber: "VK-3", name: null, quantity: 2 }] };
    const m = quoteMismatch({ items: [line("VK-1", 40), line("VK-9", 1)], totalWithoutVat: 98_000, requiredDeliveryDate: "2026-10-20", documentDate: "2026-10-05" }, quote, "2026-10-23");
    expect(m.map((x) => x.kind)).toEqual(["cena", "mnozstvi", "polozka_navic", "chybi_polozka", "termin"]);
    expect(orderedShare(m, 2)).toBe("Objednáno částečně (1/2)");
    expect(quoteMismatch({ items: [line("VK-1", 50), line("VK-3", 2)], totalWithoutVat: 100_500, requiredDeliveryDate: "2026-12-01", documentDate: "2026-10-05" }, quote, "2026-10-23")).toEqual([]);
    expect(orderedShare([], 2)).toBeNull();
  });

  it("storno poznáme jen z textu dokladu (pak jen návrh)", () => {
    expect(looksLikeCancellation({ summary: "Zákazník stornuje objednávku PO-1", note: "", documentNumber: "" })).toBe(true);
    expect(looksLikeCancellation({ summary: "Objednávka 50 ks upínek", note: "", documentNumber: "" })).toBe(false);
  });
});
