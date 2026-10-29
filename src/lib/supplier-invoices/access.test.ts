import { describe, it, expect } from "vitest";
import { can, type AccessContext, type AccessSubject } from "@/lib/auth/permissions";
import { parseVisibility, redactDetail, redactListItem, supplierInvoicePerms } from "./access";
import type { SupplierInvoiceDetail, SupplierInvoiceListItem } from "./types";

const ctx = (forAll: boolean): AccessContext => ({ aiEnabled: true, aiCaptureForAll: true, aiConfigured: true, supplierInvoicesForAll: forAll });
const who = (role: AccessSubject["role"]): AccessSubject => ({ role, aiAccess: false, active: true });
const perms = (role: AccessSubject["role"], forAll: boolean) => supplierInvoicePerms((f) => can(who(role), f, ctx(forAll)));

describe("viditelnost faktur dodavatelů — jeden přepínač", () => {
  it("výchozí režim: nahrát smí všichni, vidí jen super admin", () => {
    expect(perms("super_admin", false)).toEqual({ upload: true, view: true, amounts: true, edit: true, paid: true });
    expect(perms("obchodnik", false)).toEqual({ upload: true, view: false, amounts: false, edit: false, paid: false });
    expect(perms("zamestnanec", false)).toEqual({ upload: true, view: false, amounts: false, edit: false, paid: false });
    // chybějící nastavení = jen super admin
    expect(can(who("obchodnik"), "supplier_invoices", { aiEnabled: true, aiCaptureForAll: true, aiConfigured: true })).toBe(false);
  });
  it("režim „všichni“: faktury vidí všichni, zaplaceno jen super admin, částky jen s nákupními cenami", () => {
    expect(perms("super_admin", true)).toEqual({ upload: true, view: true, amounts: true, edit: true, paid: true });
    // obchodník fakturu vidí i s částkami, ale NEUPRAVUJE (rozdělení mění náklady a provize zakázek ostatních)
    expect(perms("obchodnik", true)).toEqual({ upload: true, view: true, amounts: true, edit: false, paid: false });
    expect(perms("zamestnanec", true)).toEqual({ upload: true, view: true, amounts: false, edit: false, paid: false });
  });
  it("neaktivní účet nesmí ani nahrát", () => {
    expect(supplierInvoicePerms((f) => can({ ...who("super_admin"), active: false }, f, ctx(true))).upload).toBe(false);
  });
  it("nastavení", () => {
    expect(parseVisibility("all")).toBe("all");
    expect(parseVisibility(" ALL ")).toBe("all");
    expect(parseVisibility(undefined)).toBe("super_admin");
    expect(parseVisibility("cokoli")).toBe("super_admin");
  });
  it("redakce seznamu a detailu (RSC nenese, co uživatel nesmí)", () => {
    const item = { totalNet: 1, totalGross: 2, unallocated: 3, paymentStatus: "zaplaceno", paidAt: "2026-10-01", overdue: false } as unknown as SupplierInvoiceListItem;
    expect(redactListItem(item, perms("zamestnanec", true))).toMatchObject({ totalNet: null, totalGross: null, unallocated: null, paymentStatus: null, paidAt: null, overdue: null });
    expect(redactListItem(item, perms("obchodnik", true))).toMatchObject({ totalNet: 1, paymentStatus: null });
    const d = {
      totalNet: 1, totalVat: 1, totalGross: 2, exchangeRate: 25, paymentStatus: "zaplaceno", paidAt: "2026-10-01", paidAmount: null, paidByName: "A", overdue: false,
      items: [{ id: "i", amount: 5, unitPrice: 5 }], allocations: [{ id: "a", amount: 5 }], supplierPurchaseOrders: [{ id: "p", total: 9 }],
      purchaseOrderInvoicing: [{ id: "p", total: 9, invoiced: 4, complete: false, final: false }],
      files: [{ id: "f", href: "/api/supplier-invoices/files/f" }],
      aiSummary: "x", needsClarification: ["y"], perms: perms("super_admin", false),
    } as unknown as SupplierInvoiceDetail;
    const w = redactDetail(d, perms("zamestnanec", true));
    expect(w).toMatchObject({ totalNet: null, totalGross: null, paymentStatus: null, paidByName: null, aiSummary: null });
    // soubor faktury nese částky → bez práva na částky ani odkaz
    expect(w.files).toEqual([]);
    expect(w.purchaseOrderInvoicing[0]).toMatchObject({ total: null, invoiced: null });
    expect(redactDetail(d, perms("obchodnik", true)).files).toHaveLength(1);
    expect(w.items[0]).toMatchObject({ amount: null, unitPrice: null });
    expect(w.allocations[0].amount).toBeNull();
    expect(w.supplierPurchaseOrders[0].total).toBeNull();
    expect(JSON.stringify(w)).not.toMatch(/zaplaceno|"total":9/);
    expect(redactDetail(d, perms("super_admin", false)).paymentStatus).toBe("zaplaceno");
  });
});
