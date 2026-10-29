import { describe, it, expect } from "vitest";
import { totalsOf, unpaidOf } from "./totals";
import { parseCnbDaily } from "./cnb-parse";
import { batchResultHeadline } from "@/lib/jobs/capture-batch";
import type { SupplierInvoiceListItem, SupplierInvoicePerms } from "./types";

const ADMIN: SupplierInvoicePerms = { upload: true, view: true, amounts: true, edit: true, paid: true };
const it0 = (o: Partial<SupplierInvoiceListItem>): SupplierInvoiceListItem => ({
  id: "x", number: "F", supplierId: null, supplierName: null, issueDate: null, dueDate: null, currency: "CZK", totalNet: 0, totalGross: 0,
  status: "ke_kontrole", paymentStatus: "nezaplaceno", paidAt: null, paidAmount: null, overdue: false, unallocated: 0, isProforma: false,
  missingRate: false, pendingAi: 0, jobs: [], hasOverhead: false, duplicateOfId: null, source: "upload", uploadedByName: null, createdAt: "", fileCount: 1,
  ...o,
});

describe("součty seznamu faktur", () => {
  it("cizí měna bez kurzu se nesčítá 1:1 do Kč — mezisoučet po měnách; s kurzem × kurz", () => {
    const list = [
      it0({ id: "a", totalNet: 65_100, totalGross: 78_771 }),
      it0({ id: "b", currency: "EUR", totalNet: 240, totalGross: 290.4, missingRate: true }),
      it0({ id: "c", currency: "EUR", totalNet: 100, totalGross: 121 }),
    ];
    const t = totalsOf(list, [{ id: "a", currency: "CZK", exchange_rate: null }, { id: "b", currency: "EUR", exchange_rate: null }, { id: "c", currency: "EUR", exchange_rate: "24.5" }], ADMIN);
    expect(t.net).toBe(65_100 + 2_450);
    expect(t.foreign).toEqual([{ currency: "EUR", count: 1, net: 240, gross: 290.4 }]);
  });
  it("nezaplaceno: částečná úhrada odečte uhrazené; zaplacené 0", () => {
    expect(unpaidOf({ paymentStatus: "castecne", totalGross: 36_300, paidAmount: 10_000 })).toBe(26_300);
    expect(unpaidOf({ paymentStatus: "castecne", totalGross: 100, paidAmount: 300 })).toBe(0);
    expect(unpaidOf({ paymentStatus: "zaplaceno", totalGross: 100, paidAmount: null })).toBe(0);
    const t = totalsOf([it0({ id: "a", totalGross: 36_300, paymentStatus: "castecne", paidAmount: 10_000, overdue: true }), it0({ id: "b", totalGross: 1_000 })],
      [{ id: "a", currency: "CZK", exchange_rate: null }, { id: "b", currency: "CZK", exchange_rate: null }], ADMIN);
    expect(t).toMatchObject({ unpaid: 27_300, overdue: 26_300 });
  });
  it("bez práva na zaplaceno ani částky nic", () => {
    const t = totalsOf([it0({ totalGross: 5 })], [{ id: "x", currency: "CZK", exchange_rate: null }], { ...ADMIN, amounts: false, paid: false });
    expect(t).toMatchObject({ net: null, unpaid: null, foreign: null });
  });
});

describe("kurzovní lístek ČNB", () => {
  it("Kč za 1 jednotku (množství 100 u JPY)", () => {
    const txt = "29.10.2026 #209\nzemě|měna|množství|kód|kurz\nEMU|euro|1|EUR|24,335\nJaponsko|jen|100|JPY|15,123\nUSA|dolar|1|USD|22,100\n";
    expect(parseCnbDaily(txt)).toEqual({ EUR: 24.335, JPY: 0.15123, USD: 22.1 });
  });
});

describe("výsledek dávky s fakturou dodavatele", () => {
  const doc = (o: Record<string, unknown>) => ({ docId: "d", groupKey: "", type: "objednavka_zakaznik", label: "", ok: true, jobId: null, jobNumber: null, fileIds: [], fileKind: "objednavka", title: "", summary: "", links: [], ...o }) as never;
  it("faktura se do „uloženo k zakázce“ nepočítá, je zvlášť", () => {
    const r = { groups: [{ key: "g", ok: true, jobId: "j", jobNumber: "Z-REV-SINV-J", created: false }], docs: [doc({}), doc({ supplierInvoice: true, type: "faktura_dodavatel" })] } as never;
    expect(batchResultHeadline(r)).toBe("Uložen 1 doklad k zakázce Z-REV-SINV-J · 1 faktura → Faktury dodavatelů");
    const only = { groups: [], docs: [doc({ supplierInvoice: true }), doc({ supplierInvoice: true })] } as never;
    expect(batchResultHeadline(only)).toBe("Děkujeme, nahráno");
  });
});
