import { describe, it, expect } from "vitest";
import type { JobCommissionView, SupplierQuoteView } from "@/lib/jobs/purchasing-types";
import {
  commissionDisplay, compareSupplierQuotes, draftsFromJobItems, emptyPurchaseDraft, isPurchaseOrderLate, marginHero,
  matchesPurchaseFilter, ownerAssignedStamp, purchaseChips, purchaseDraftFrom, purchaseNextStep, purchaseSteps,
  receiptDraftsFrom, receiptDraftsToInput, validateReceiptDrafts, purchaseDraftsToInput, purchaseDraftsTotal,
  purchaseOrderFormFromDraft, purchaseOrderFormToInput, supplierQuoteFormFrom, supplierQuoteFormNew, supplierQuoteFormToInput,
  validatePurchaseDrafts, validatePurchaseOrderForm, validateSupplierQuoteForm,
} from "./purchasing-model";

const sp = (s: string) => s.replace(/[  ]/g, " ");

function quote(over: Partial<SupplierQuoteView> = {}): SupplierQuoteView {
  return {
    id: "q1", jobId: "j1", supplier: { id: "s1", name: "Kalírna Brno", email: null, phone: null, ico: null, dic: null, address: null, contactPerson: null, country: null },
    supplierName: "Kalírna Brno", number: "N-1", quoteDate: "2026-10-01", validUntil: "2026-11-30", leadTimeDays: 14,
    deliveryDate: "2026-10-15", currency: "CZK", total: 30_000, selected: false, note: null, fileId: null, source: "manual",
    createdBy: { id: "u1", name: "Vít Volný" }, createdAt: "2026-10-01T08:00:00Z", updatedAt: "2026-10-01T08:00:00Z",
    items: [{ id: "i1", position: 0, drawingNumber: "VL-12", name: "Lišta", material: "1.2379", quantity: 12, unit: "ks", unitPrice: 2500, note: null }],
    ...over,
  };
}

const commission = (over: Partial<JobCommissionView> = {}): JobCommissionView => ({
  ownerId: "u1", ownerName: "Petr", revenue: 48_000, cost: 30_000, profit: 18_000, margin: 0.375, rate: 0.1, base: "margin",
  commission: 1_800, status: "predbezna", costKnown: true, period: "2026-10-01", updatedAt: null, ...over,
});

describe("koncepty položek nákupu", () => {
  it("ze zakázky bez cen, převod na vstup akce, součet", () => {
    const drafts = draftsFromJobItems([
      { drawingNumber: "VL-12", name: "Lišta", description: "kaleno", material: "1.2379", quantity: 12, unit: "ks" },
      { drawingNumber: "VK-2", name: null, description: null, material: null, quantity: 2.5, unit: "kg" },
    ]);
    expect(drafts.map((d) => [d.drawingNumber, d.name, d.quantity, d.unitPrice])).toEqual([
      ["VL-12", "Lišta", "12", ""], ["VK-2", "Díl dle výkresu VK-2", "2,5", ""],
    ]);
    const priced = [{ ...drafts[0], unitPrice: "2 500" }, drafts[1], emptyPurchaseDraft()];
    expect(purchaseDraftsTotal(priced)).toEqual({ total: 30_000, unpriced: 1, count: 2, priced: true });
    expect(purchaseDraftsToInput(priced)).toEqual([
      { drawingNumber: "VL-12", name: "Lišta", material: "1.2379", quantity: 12, unit: "ks", unitPrice: 2500, note: undefined },
      { drawingNumber: "VK-2", name: "Díl dle výkresu VK-2", material: undefined, quantity: 2.5, unit: "kg", unitPrice: null, note: undefined },
    ]);
  });
  it("validace", () => {
    expect(validatePurchaseDrafts([])).toBe("Přidej alespoň jednu položku.");
    expect(validatePurchaseDrafts([], { allowEmpty: true })).toBeNull();
    expect(validatePurchaseDrafts([{ ...emptyPurchaseDraft(), material: "ocel" }])).toBe("Položka 1: vyplň číslo výkresu nebo název.");
    expect(validatePurchaseDrafts([{ ...emptyPurchaseDraft(), name: "A", quantity: "0" }])).toBe("Položka 1: zadej množství větší než 0.");
    expect(validatePurchaseDrafts([{ ...emptyPurchaseDraft(), name: "A", unitPrice: "x" }])).toBe("Položka 1: cena za MJ musí být číslo.");
    expect(purchaseDraftFrom({ name: "A", quantity: 1, unitPrice: 12.5 }).unitPrice).toBe("12,5");
  });
});

describe("formulář nabídky dodavatele", () => {
  it("nová z položek zakázky, kontrola dodavatele a ceny", () => {
    const f = supplierQuoteFormNew({ items: [] }, "2026-10-22");
    expect(validateSupplierQuoteForm(f)).toBe("Vyber dodavatele nebo napiš jeho název.");
    expect(validateSupplierQuoteForm({ ...f, supplierName: "Nový s.r.o." })).toBe("Zadej položky nebo celkovou cenu nabídky.");
    const ok = { ...f, supplierName: "Nový s.r.o.", total: "15 000" };
    expect(validateSupplierQuoteForm(ok)).toBeNull();
    expect(supplierQuoteFormToInput(ok)).toMatchObject({ supplierId: null, supplierName: "Nový s.r.o.", total: 15_000, items: [], quoteDate: "2026-10-22" });
    expect(validateSupplierQuoteForm({ ...ok, validUntil: "2026-10-01" })).toBe("Platnost nabídky končí před datem nabídky.");
    expect(validateSupplierQuoteForm({ ...ok, leadTimeDays: "-3" })).toBe("Dodací lhůta musí být počet dní.");
  });
  it("úprava: celková cena jen když se liší od součtu položek", () => {
    expect(supplierQuoteFormFrom(quote()).total).toBe("");
    expect(supplierQuoteFormFrom(quote({ total: 28_000 })).total).toBe("28000");
    expect(supplierQuoteFormFrom(quote({ items: [] })).total).toBe("30000");
    expect(supplierQuoteFormToInput(supplierQuoteFormFrom(quote()))).toMatchObject({ supplierId: "s1", supplierName: undefined, total: null, leadTimeDays: 14 });
  });
});

describe("formulář objednávky", () => {
  it("návrh → formulář → vstup akce", () => {
    const f = purchaseOrderFormFromDraft({
      supplierId: null, supplierName: "Kalírna", supplierQuoteId: "q1", orderDate: "2026-10-22", requiredDate: "2026-11-02",
      currency: "CZK", deliveryTerms: "DAP", paymentTerms: "30 dní", deliveryAddress: "Mnástrojárna", note: "Zakázka Z-1",
      items: [{ drawingNumber: "VL-12", name: "Lišta", quantity: 12, unit: "ks", unitPrice: 2500 }],
    });
    expect(validatePurchaseOrderForm(f)).toBeNull();
    expect(purchaseOrderFormToInput(f)).toMatchObject({ supplierId: null, supplierName: "Kalírna", supplierQuoteId: "q1", requiredDate: "2026-11-02" });
    expect(validatePurchaseOrderForm({ ...f, supplierName: "" })).toBe("Vyber dodavatele.");
    expect(validatePurchaseOrderForm({ ...f, requiredDate: "2026-10-01" })).toBe("Požadovaný termín dodání je před datem objednávky.");
  });
});

describe("srovnání nabídek", () => {
  it("od nejlevnější, nejlevnější a nejrychlejší, rozdíl, pruh, prošlá", () => {
    const rows = compareSupplierQuotes([
      quote({ id: "a", supplierName: "A", total: 36_000, deliveryDate: "2026-10-10" }),
      quote({ id: "b", supplierName: "B", total: 30_000, deliveryDate: "2026-10-20", validUntil: "2026-10-01" }),
      quote({ id: "c", supplierName: "C", total: null, deliveryDate: null }),
    ], "2026-10-22");
    expect(rows.map((r) => r.id)).toEqual(["b", "a", "c"]);
    expect(rows[0]).toMatchObject({ cheapest: true, fastest: false, diff: 0, bar: 83, expired: true });
    expect(rows[1]).toMatchObject({ cheapest: false, fastest: true, diff: 6_000, diffShare: 0.2, bar: 100 });
    expect(rows[2]).toMatchObject({ cheapest: false, diff: null, bar: 0 });
  });
  it("jediná nabídka není „nejlevnější“", () => {
    expect(compareSupplierQuotes([quote()], "2026-10-22")[0].cheapest).toBe(false);
  });
});

describe("marže a provize", () => {
  it("zisk, marže, lišta, chybějící nákup", () => {
    const h = marginHero({ revenue: 48_000, purchaseOrdersTotal: 30_000, plannedCost: 31_000, cost: 30_000, costSource: "objednavky", profit: 18_000, margin: 0.375 });
    expect(h).toMatchObject({ tone: "green", costPct: 62.5, profitPct: 37.5, missingCost: false, costLabel: "objednávky dodavatelům" });
    const loss = marginHero({ revenue: 10_000, purchaseOrdersTotal: 12_000, plannedCost: null, cost: 12_000, costSource: "objednavky", profit: -2_000, margin: -0.2 });
    expect(loss).toMatchObject({ tone: "red", costPct: 100, profitPct: 0 });
    expect(marginHero({ revenue: 10_000, purchaseOrdersTotal: 0, plannedCost: null, cost: null, costSource: null, profit: null, margin: null }))
      .toMatchObject({ tone: "amber", missingCost: true, costLabel: "zatím neznámý" });
  });
  it("provize: bez obchodníka, procento, pásmová před a po inkasu", () => {
    expect(commissionDisplay(null, { hasOwner: false })).toMatchObject({ amount: null, title: "Bez obchodníka" });
    expect(commissionDisplay(null, { hasOwner: true })).toMatchObject({ amount: null, title: "Provize zatím nevznikla" });
    const simple = commissionDisplay(commission(), { hasOwner: true });
    expect(simple).toMatchObject({ amount: 1_800, estimate: false, title: "Předběžná provize", status: "predbezna" });
    expect(sp(simple.detail)).toBe("10 % ze zisku · 10/2026 · finální po fakturaci");
    expect(commissionDisplay(commission({ costKnown: false, commission: 0 }), { hasOwner: true })).toMatchObject({ amount: null, tone: "amber" });
    expect(commissionDisplay(commission({ costKnown: false, commission: 0, pendingPurchaseOrders: ["OV-2026-012"] }), { hasOwner: true }).detail)
      .toContain("čeká na nákupní cenu (OV-2026-012)");
    expect(marginHero({ revenue: 48_000, purchaseOrdersTotal: 8_000, plannedCost: null, cost: null, costSource: "neuplna", profit: null, margin: null,
      incompleteCost: 8_000, unpricedItems: 1, unpricedPurchaseOrders: ["OV-2026-012"] }))
      .toMatchObject({ cost: null, missingCost: true, tone: "amber", costLabel: "neúplná — objednávka OV-2026-012 má položku bez ceny" });
    const est = commissionDisplay(commission({ base: "margin_tiered", rate: 0, commission: 0, estimatedCommission: 1_800, collected: false }), { hasOwner: true });
    expect(est).toMatchObject({ amount: 1_800, estimate: true, title: "Pásmová provize z inkasa · předběžná", tone: "amber" });
    expect(sp(est.detail)).toContain("Odhad 1 800 Kč dle aktuálního pásma");
    const done = commissionDisplay(commission({ base: "margin_tiered", commission: 2_222.22, collected: true, status: "k_vyplate" }), { hasOwner: true });
    expect(done).toMatchObject({ amount: 2_222.22, estimate: false, title: "Započteno do vyúčtování 10/2026", tone: "emerald" });
    const paid = commissionDisplay(commission({ base: "margin_tiered", commission: 100, collected: true, status: "vyplaceno" }), { hasOwner: true });
    expect(paid).toMatchObject({ title: "Pásmová provize vyplacena", tone: "green" });
  });
});

describe("objednávky — termíny a filtry", () => {
  const po = (status: "navrh" | "vystavena" | "odeslana" | "potvrzena" | "dodana" | "zrusena", requiredDate: string | null = "2026-10-01", confirmedDate: string | null = null) =>
    ({ status, requiredDate, confirmedDate });
  it("po termínu jen nedodané", () => {
    expect(isPurchaseOrderLate(po("odeslana"), "2026-10-22")).toBe(true);
    expect(isPurchaseOrderLate(po("potvrzena", "2026-10-01", "2026-10-30"), "2026-10-22")).toBe(false);
    expect(isPurchaseOrderLate(po("dodana"), "2026-10-22")).toBe(false);
    expect(isPurchaseOrderLate(po("vystavena", null), "2026-10-22")).toBe(false);
  });
  it("filtry přehledu", () => {
    const t = "2026-10-22";
    expect(matchesPurchaseFilter(po("zrusena"), "vse", t)).toBe(false);
    expect(matchesPurchaseFilter(po("navrh"), "k_odeslani", t)).toBe(true);
    expect(matchesPurchaseFilter(po("odeslana"), "ceka", t)).toBe(true);
    expect(matchesPurchaseFilter(po("odeslana"), "po_terminu", t)).toBe(true);
    expect(matchesPurchaseFilter(po("zrusena"), "zrusena", t)).toBe(true);
    expect(matchesPurchaseFilter({ ...po("potvrzena"), receipt: { partial: true } }, "castecne", t)).toBe(true);
    expect(matchesPurchaseFilter({ ...po("dodana"), receipt: { partial: true } }, "castecne", t)).toBe(false);
    expect(matchesPurchaseFilter(po("potvrzena"), "castecne", t)).toBe(false);
  });
});

describe("kdo co udělal (razítka ze sloupců)", () => {
  const st = (name: string | null, at: string) => ({
    by: name ? { id: `u-${name}`, name } : null, byName: name, at, via: null, kind: name ? ("user" as const) : ("system" as const),
  });
  it("kroky objednávky od nejstaršího, zrušení s důvodem, převzetí jen u nedodané", () => {
    const steps = purchaseSteps({
      status: "zrusena",
      cancelReason: "Objednáno jinde",
      receipt: { done: 1, total: 2, partial: true },
      stamps: {
        created: st("Admin", "2026-10-22T12:05:00Z"),
        status: st("Petr", "2026-10-24T08:00:00Z"),
        sent: st("Vít Volný", "2026-10-22T13:00:00Z"),
        confirmed: st("Petr", "2026-10-23T08:00:00Z"),
        delivered: null,
        cancelled: st("Petr", "2026-10-24T08:00:00Z"),
        received: st("Pavel Dílna", "2026-10-23T12:00:00Z"),
      },
    });
    expect(steps.map((s) => [s.label, s.stamp.by?.name])).toEqual([
      ["Vystavena", "Admin"],
      ["Odeslána", "Vít Volný"],
      ["Potvrzena dodavatelem", "Petr"],
      ["Převzato 1/2 položek", "Pavel Dílna"],
      ["Zrušena — Objednáno jinde", "Petr"],
    ]);
    // bez rodových sloves
    for (const s of steps) expect(s.label).not.toMatch(/(il|ila|al|ala)\b/);
    expect(purchaseSteps({ status: "navrh", stamps: undefined, receipt: undefined, cancelReason: null })).toEqual([]);
  });
  it("přidělení obchodníka z poslední události owner_id", () => {
    const ev = (data: Record<string, unknown>, name: string | null, at: string) => ({
      type: "field" as const, data, actor: name ? { id: "x", name } : null, createdAt: at,
    });
    const s = ownerAssignedStamp([
      ev({ changes: [{ field: "owner_id" }] }, "Admin", "2026-10-20T10:00:00Z"),
      ev({ changes: [{ field: "title" }] }, "Petr", "2026-10-21T10:00:00Z"),
      ev({ changes: [{ field: "owner_id" }] }, null, "2026-10-22T10:00:00Z"),
    ]);
    expect(s).toMatchObject({ by: null, kind: "system", at: "2026-10-22T10:00:00Z" });
    expect(ownerAssignedStamp([])).toBeNull();
  });
  it("další krok: poslat → potvrzeno → převzít (zbytek)", () => {
    expect(purchaseNextStep({ status: "navrh" })).toBe("poslat");
    expect(purchaseNextStep({ status: "odeslana" })).toBe("potvrzeno");
    expect(purchaseNextStep({ status: "odeslana", receipt: { partial: true } })).toBe("prevzit_zbytek");
    expect(purchaseNextStep({ status: "potvrzena" })).toBe("prevzit");
    expect(purchaseNextStep({ status: "potvrzena", receipt: { partial: true } })).toBe("prevzit_zbytek");
    expect(purchaseNextStep({ status: "dodana" })).toBeNull();
    expect(purchaseNextStep({ status: "zrusena" })).toBeNull();
  });
});

describe("převzetí od dodavatele", () => {
  const items = [
    { id: "i1", drawingNumber: "4711-02", name: "Příruba", material: null, quantity: 10, unit: "ks", unitPrice: 100, note: null, receivedQuantity: 4 },
    { id: "i2", drawingNumber: null, name: "Hřídel", material: null, quantity: 5, unit: "ks", unitPrice: null, note: null, receivedQuantity: 3, receiptClosed: true, receiptClosedReason: "2 ks zmetky" },
    { drawingNumber: null, name: "bez id", material: null, quantity: 1, unit: "ks", unitPrice: null, note: null },
  ];
  it("předvyplní celé množství, uzavřené zachová, položky bez id vynechá", () => {
    const d = receiptDraftsFrom(items as never);
    expect(d.map((x) => [x.itemId, x.before, x.received, x.close, x.reason])).toEqual([
      ["i1", 4, "10", false, ""],
      ["i2", 3, "3", true, "2 ks zmetky"],
    ]);
    expect(validateReceiptDrafts(d)).toBeNull();
    expect(receiptDraftsToInput(d)).toEqual([
      { itemId: "i1", received: 10 },
      { itemId: "i2", received: 3, close: true, closeReason: "2 ks zmetky" },
    ]);
  });
  it("kontrola: záporné množství, uzavření bez důvodu; uzavření plného množství se neposílá", () => {
    const d = receiptDraftsFrom(items as never);
    expect(validateReceiptDrafts([{ ...d[0], received: "-1" }])).toMatch(/4711-02: zadej převzaté množství/);
    expect(validateReceiptDrafts([{ ...d[0], received: "6", close: true, reason: " " }])).toMatch(/důvod/);
    expect(receiptDraftsToInput([{ ...d[0], received: "10", close: true, reason: "x" }])).toEqual([{ itemId: "i1", received: 10 }]);
    expect(validateReceiptDrafts([])).toMatch(/nemá položky/);
  });
  it("chipy: částečně dodaná s průběhem, po termínu se dny", () => {
    const chips = purchaseChips({ status: "potvrzena", requiredDate: "2026-10-20", confirmedDate: null, receipt: { done: 1, total: 2, partial: true } }, "2026-10-23");
    expect(chips.map((c) => [c.key, c.progress?.label ?? null, c.hint])).toEqual([
      ["castecne_dodana", "1/2 položek", null],
      ["po_terminu", null, "+3 dny"],
    ]);
    expect(purchaseChips({ status: "dodana", requiredDate: "2026-10-20", confirmedDate: null, receipt: { done: 2, total: 2, partial: false } }, "2026-10-23")).toEqual([]);
  });
});
