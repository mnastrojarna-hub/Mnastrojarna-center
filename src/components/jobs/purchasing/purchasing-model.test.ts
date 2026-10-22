import { describe, it, expect } from "vitest";
import type { JobCommissionView, SupplierQuoteView } from "@/lib/jobs/purchasing-types";
import {
  commissionDisplay, compareSupplierQuotes, draftsFromJobItems, emptyPurchaseDraft, isPurchaseOrderLate, marginHero,
  matchesPurchaseFilter, orderActs, purchaseActivity, purchaseDraftFrom, purchaseDraftsToInput, purchaseDraftsTotal,
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
  });
});

describe("kdo co udělal (historie)", () => {
  const ev = (type: string, data: Record<string, unknown>, who: string, at: string) => ({ type, data, actor: { name: who }, createdAt: at });
  it("úkony objednávek, výběr vítěze, přidělení obchodníka", () => {
    const a = purchaseActivity([
      ev("email", { purchaseOrderId: "po1" }, "Vít Volný", "2026-10-22T13:00:00Z"),
      ev("field", { purchaseOrderId: "po1", number: "OV-2026-001", itemCount: 1 }, "Admin", "2026-10-22T12:05:00Z"),
      ev("field", { purchaseOrderId: "po1", changes: [{ field: "supplier_id" }] }, "Admin", "2026-10-22T12:05:01Z"),
      ev("field", { purchaseOrderId: "po1", number: "OV-2026-001", fields: ["status", "confirmed_date"], statusFrom: "odeslana", statusTo: "potvrzena" }, "Petr", "2026-10-23T08:00:00Z"),
      ev("field", { purchaseOrderId: "po1", fields: ["note"] }, "Petr", "2026-10-23T09:00:00Z"),
      ev("quote", { supplierQuoteId: "q1", action: "selected" }, "Admin", "2026-10-21T10:00:00Z"),
      ev("quote", { supplierQuoteId: "q1", action: "selected", purchaseOrderId: "po1" }, "Vít Volný", "2026-10-22T12:06:00Z"),
      ev("field", { changes: [{ field: "owner_id" }] }, "Admin", "2026-10-20T10:00:00Z"),
      ev("stage", { purchaseOrderId: "po1", from: "potvrzeno", to: "dodano_k_nam" }, "Petr", "2026-10-24T08:00:00Z"),
    ]);
    expect(a.orders.get("po1")?.map((x) => [x.kind, x.verb, x.by])).toEqual([
      ["vystavena", "Vystavil", "Admin"],
      ["odeslana_email", "Odeslal dodavateli", "Vít Volný"],
      ["potvrzena", "Potvrzení zapsal", "Petr"],
      ["upravena", "Upravil", "Petr"],
    ]);
    expect(a.quoteSelected.get("q1")).toEqual({ by: "Vít Volný", at: "2026-10-22T12:06:00Z" });
    expect(a.ownerAssigned).toEqual({ by: "Admin", at: "2026-10-20T10:00:00Z" });
  });
  it("bez historie aspoň autor objednávky", () => {
    const acts = orderActs({ id: "x", createdBy: { id: "u", name: "Vít Volný" }, createdAt: "2026-10-22T12:05:00Z" }, null);
    expect(acts).toEqual([{ kind: "vystavena", verb: "Vystavil", by: "Vít Volný", at: "2026-10-22T12:05:00Z" }]);
  });
});
