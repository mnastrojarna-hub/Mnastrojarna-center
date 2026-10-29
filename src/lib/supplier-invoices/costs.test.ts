import { describe, it, expect } from "vitest";
import { amountCzkOf, jobCostBreakdown, withInvoiceCosts } from "./costs";
import type { JobPurchasingTotals } from "@/lib/jobs/purchasing-types";

const po = (id: string, total: number, o: Partial<{ status: string; hasUnpriced: boolean }> = {}) => ({ id, number: `OV-${id}`, status: o.status ?? "vystavena", total, hasUnpriced: o.hasUnpriced ?? false });

describe("náklad zakázky bez dvojího počítání", () => {
  it("bez faktur = Σ objednávek, bez objednávek odhad", () => {
    expect(jobCostBreakdown({ plannedCost: 9_000, purchaseOrders: [po("1", 30_000), po("2", 5_000)], allocations: [] }).cost).toBe(35_000);
    const e = jobCostBreakdown({ plannedCost: 9_000, purchaseOrders: [], allocations: [] });
    expect(e).toMatchObject({ cost: 9_000, known: true, estimate: true });
    expect(jobCostBreakdown({ plannedCost: null, purchaseOrders: [], allocations: [] }).known).toBe(false);
  });
  it("faktura k objednávce nahradí její částku (i jinou), objednávka bez faktury platí dál", () => {
    const b = jobCostBreakdown({
      plannedCost: 9_000,
      purchaseOrders: [po("1", 30_000), po("2", 5_000)],
      allocations: [
        { purchaseOrderId: "1", amountCzk: 10_000, confirmed: true },
        { purchaseOrderId: "1", amountCzk: 21_000, confirmed: true },
      ],
    });
    expect(b.cost).toBe(36_000);
    expect(b.invoicedByPo).toEqual({ "1": 31_000 });
    expect(b.purchaseOrdersOpen).toBe(5_000);
  });
  it("faktura bez objednávky se přičte; nepotvrzený návrh se nepočítá", () => {
    const b = jobCostBreakdown({
      plannedCost: null,
      purchaseOrders: [po("1", 30_000)],
      allocations: [
        { purchaseOrderId: null, amountCzk: 2_500.5, confirmed: true },
        { purchaseOrderId: "1", amountCzk: 29_000, confirmed: false },
      ],
    });
    expect(b.cost).toBe(32_500.5);
  });
  it("faktura na zrušenou objednávku = faktura bez objednávky (zrušená se nepočítá)", () => {
    const b = jobCostBreakdown({ plannedCost: null, purchaseOrders: [po("1", 30_000, { status: "zrusena" })], allocations: [{ purchaseOrderId: "1", amountCzk: 1_000, confirmed: true }] });
    expect(b.cost).toBe(1_000);
    expect(b.invoicesWithoutPo).toBe(1_000);
  });
  it("objednávka s položkou bez ceny: náklad neznámý, dokud ji nenahradí faktura", () => {
    expect(jobCostBreakdown({ plannedCost: null, purchaseOrders: [po("1", 0, { hasUnpriced: true })], allocations: [] }).known).toBe(false);
    const b = jobCostBreakdown({ plannedCost: null, purchaseOrders: [po("1", 0, { hasUnpriced: true })], allocations: [{ purchaseOrderId: "1", amountCzk: 4_000, confirmed: true }] });
    expect(b).toMatchObject({ cost: 4_000, known: true });
  });
});

describe("dílčí faktury a kurz", () => {
  it("dílčí faktura náklad objednávky nesníží (max), konečná / ≥ 99,5 % / všechny položky → skutečnost", () => {
    const POs = [{ ...po("1", 30_000), itemIds: ["a", "b"] }];
    // první dílčí faktura 10 000 na objednávku 30 000 → pořád 30 000 (ne 10 000)
    const part = jobCostBreakdown({ plannedCost: null, purchaseOrders: POs, allocations: [{ purchaseOrderId: "1", amountCzk: 10_000, confirmed: true }] });
    expect(part).toMatchObject({ cost: 30_000, known: true });
    expect(part.purchaseOrders[0]).toMatchObject({ invoiced: true, complete: false, inv: 10_000, contributes: 30_000 });
    // druhá dílčí, součet 29 900 (≥ 99,5 %) → celá → 29 900
    const two = jobCostBreakdown({ plannedCost: null, purchaseOrders: POs, allocations: [
      { purchaseOrderId: "1", amountCzk: 10_000, confirmed: true }, { purchaseOrderId: "1", amountCzk: 19_900, confirmed: true },
    ] });
    expect(two.cost).toBe(29_900);
    // levnější konečná faktura (sleva) → jen s „Faktura konečná"
    const cheap = [{ purchaseOrderId: "1", amountCzk: 27_000, confirmed: true }];
    expect(jobCostBreakdown({ plannedCost: null, purchaseOrders: POs, allocations: cheap }).cost).toBe(30_000);
    expect(jobCostBreakdown({ plannedCost: null, purchaseOrders: POs, allocations: [{ ...cheap[0], poFinal: true }] }).cost).toBe(27_000);
    // každá položka objednávky má svou fakturu → celá
    expect(jobCostBreakdown({ plannedCost: null, purchaseOrders: POs, allocations: [
      { purchaseOrderId: "1", purchaseOrderItemId: "a", amountCzk: 12_000, confirmed: true },
      { purchaseOrderId: "1", purchaseOrderItemId: "b", amountCzk: 14_000, confirmed: true },
    ] }).cost).toBe(26_000);
    // vyšší faktura než objednávka → skutečnost
    expect(jobCostBreakdown({ plannedCost: null, purchaseOrders: POs, allocations: [{ purchaseOrderId: "1", amountCzk: 33_000, confirmed: true }] }).cost).toBe(33_000);
  });
  it("objednávka s položkou bez ceny a jen dílčí fakturou = náklad neznámý", () => {
    const b = jobCostBreakdown({ plannedCost: null, purchaseOrders: [po("1", 10_000, { hasUnpriced: true })], allocations: [{ purchaseOrderId: "1", amountCzk: 4_000, confirmed: true }] });
    expect(b).toMatchObject({ known: false, unpricedPurchaseOrders: ["OV-1"] });
  });
  it("cizí měna bez kurzu: nikdy 1:1 — náklad neznámý, s důvodem „kurz EUR u faktury…“", () => {
    expect(amountCzkOf(240, "EUR", null)).toBeNull();
    expect(amountCzkOf(240, "EUR", 24.5)).toBe(5_880);
    expect(amountCzkOf(240, "CZK", null)).toBe(240);
    const b = jobCostBreakdown({ plannedCost: null, purchaseOrders: [po("1", 28_000)], allocations: [
      { purchaseOrderId: null, amountCzk: null, confirmed: true, invoiceNumber: "CT-33", currency: "EUR" },
    ] });
    expect(b).toMatchObject({ cost: 28_000, known: false, missingRates: ["kurz EUR u faktury dodavatele"] });
    const base: JobPurchasingTotals = { revenue: 50_000, purchaseOrdersTotal: 28_000, plannedCost: null, cost: 28_000, costSource: "objednavky", profit: 22_000, margin: 0.44 };
    expect(withInvoiceCosts(base, { purchaseOrders: [po("1", 28_000)], allocations: [{ purchaseOrderId: null, amountCzk: null, confirmed: true, invoiceNumber: "CT-33", currency: "EUR" }] }))
      .toMatchObject({ cost: null, costSource: "neuplna", missingRates: ["kurz EUR u faktury dodavatele"] });
  });
});

describe("karta marže s fakturami", () => {
  const base: JobPurchasingTotals = { revenue: 50_000, purchaseOrdersTotal: 30_000, plannedCost: null, cost: 30_000, costSource: "objednavky", profit: 20_000, margin: 0.4 };
  it("bez potvrzených faktur beze změny", () => {
    expect(withInvoiceCosts(base, { purchaseOrders: [po("1", 30_000)], allocations: [{ purchaseOrderId: "1", amountCzk: 1, confirmed: false }] })).toBe(base);
  });
  it("s fakturou: náklad, zisk a marže ze skutečnosti", () => {
    const t = withInvoiceCosts(base, { purchaseOrders: [po("1", 30_000)], allocations: [{ purchaseOrderId: "1", amountCzk: 32_000, confirmed: true }] });
    expect(t).toMatchObject({ cost: 32_000, costSource: "faktury", profit: 18_000, margin: 0.36 });
  });
});
