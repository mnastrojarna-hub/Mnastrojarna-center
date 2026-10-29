import { describe, it, expect } from "vitest";
import { businessDocFromInvoice, invoiceFromBusinessDoc, isoDate, normalizeSupplierInvoice, partyAddress } from "./extract";
import { emptyExtracted } from "@/lib/jobs/extracted-normalize";

describe("normalizace vytěžení faktury", () => {
  it("data, měna, součty, položky", () => {
    const x = normalizeSupplierInvoice({
      supplier: { name: "Kovo Hrubý", ico: "25 874 411", dic: "cz25874411", bankAccount: "123456789/0100" },
      number: "FA-2026-0815", variableSymbol: "VS 20260815", issueDate: "15.10.2026", dueDate: "2026-11-14", currency: "Kč",
      totalVat: 6_300, items: [{ text: "Výroba", quantity: 2, unitPrice: 15_000 }, { text: "", amount: 0 }], confidence: 2,
    });
    expect(x.supplier).toMatchObject({ ico: "25874411", dic: "CZ25874411", bankAccount: "123456789/0100" });
    expect(x).toMatchObject({ variableSymbol: "20260815", issueDate: "2026-10-15", dueDate: "2026-11-14", currency: "CZK", totalNet: 30_000, totalGross: 36_300, confidence: 1 });
    expect(x.items).toHaveLength(1);
    expect(x.items[0]).toMatchObject({ amount: 30_000, vatRate: -1 });
    expect(isoDate("31.2.2026")).toBe("");
  });
  it("nesmyslná čísla (přetečení sloupců) se nezapíšou — řádek pryč, poznámka k ověření, nižší jistota", () => {
    const x = normalizeSupplierInvoice({
      totalNet: 5e12, confidence: 0.9, exchangeRate: 24.335, currency: "EUR", isProforma: true,
      items: [{ text: "Výroba", amount: 5e12 }, { text: "Kalení", quantity: 1e12, unitPrice: 10, amount: 500 }, { text: "Doprava", amount: 300 }],
    });
    expect(x.items.map((i) => i.text)).toEqual(["Kalení", "Doprava"]);
    expect(x.items[0]).toMatchObject({ quantity: 0, amount: 500 });
    expect(x.totalNet).toBe(800);
    expect(x.needsClarification.join(" ")).toMatch(/nesmyslnou částku/);
    expect(x.needsClarification.join(" ")).toMatch(/Součet bez DPH/);
    expect(x.confidence).toBe(0.5);
    expect(x).toMatchObject({ exchangeRate: 24.335, currency: "EUR", isProforma: true });
    expect(normalizeSupplierInvoice({ exchangeRate: -3 }).exchangeRate).toBe(0);
    // uložené vytěžení se normalizuje znovu bez nových poznámek
    expect(normalizeSupplierInvoice(x).needsClarification).toEqual(x.needsClarification);
  });
  it("převody s obchodním dokladem", () => {
    const inv = invoiceFromBusinessDoc({ ...emptyExtracted(), documentNumber: "F1", totalWithoutVat: 100, customerOrderNumber: "OV-2026-1",
      items: [{ drawingNumber: "D1", revision: "", name: "Díl", description: "", material: "", quantity: 2, unit: "ks", unitPrice: 50, deliveryDate: "" }] });
    expect(inv).toMatchObject({ number: "F1", totalNet: 100 });
    expect(inv.references.purchaseOrderNumbers).toEqual(["OV-2026-1"]);
    expect(inv.items[0]).toMatchObject({ code: "D1", amount: 100 });
    const doc = businessDocFromInvoice(inv, emptyExtracted());
    expect(doc).toMatchObject({ docKind: "faktura", issuer: "dodavatel", documentNumber: "F1", customerOrderNumber: "OV-2026-1", totalWithoutVat: 100 });
    expect(partyAddress({ street: "Hlavní 1", city: "Brno", zip: "602 00", country: "CZ" })).toBe("Hlavní 1, 602 00 Brno");
  });
});
