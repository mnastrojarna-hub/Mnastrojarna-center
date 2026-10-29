// Viditelnost faktur dodavatelů — jeden přepínač (AccessContext.supplierInvoicesForAll ← integration_settings).
import type { Feature } from "@/lib/auth/permissions";
import type {
  SupplierInvoiceAllocationView, SupplierInvoiceDetail, SupplierInvoiceItemView, SupplierInvoiceListItem, SupplierInvoicePerms,
} from "@/lib/supplier-invoices/types";

export type SupplierInvoiceVisibility = "super_admin" | "all";

export const VISIBILITY_SETTING_KEY = "supplier_invoices_visibility";

export function parseVisibility(v: string | null | undefined): SupplierInvoiceVisibility {
  return (v ?? "").trim().toLowerCase() === "all" ? "all" : "super_admin";
}

/**
 * Práva k fakturám dodavatelů z oprávnění uživatele:
 *  - nahrát smí každý aktivní účet,
 *  - vidět: super admin; v režimu „all" všichni,
 *  - částky a soubor faktury (na něm jsou částky): kdo vidí faktury a zároveň nákupní ceny (super admin,
 *    obchodník) — zaměstnanec nikdy (stejně jako RLS / storage: supplier_invoices_readable),
 *  - upravovat (rozdělení, položky, hlavička, dodavatel, zamítnutí, AI znovu): JEN super admin v obou režimech —
 *    rozdělení mění náklady a provize zakázek ostatních obchodníků,
 *  - zaplaceno / nezaplaceno: jen super admin (v obou režimech).
 */
export function supplierInvoicePerms(can: (f: Feature) => boolean): SupplierInvoicePerms {
  const view = can("supplier_invoices");
  const admin = can("supplier_invoices_paid");
  const amounts = view && (admin || can("margins"));
  return { upload: can("supplier_invoices_upload"), view, amounts, edit: view && admin, paid: view && admin };
}

const hideItem = (i: SupplierInvoiceItemView): SupplierInvoiceItemView => ({ ...i, amount: null, unitPrice: null });
const hideAlloc = (a: SupplierInvoiceAllocationView): SupplierInvoiceAllocationView => ({ ...a, amount: null });

/** Seznam bez částek / bez zaplaceno podle práv. */
export function redactListItem(x: SupplierInvoiceListItem, p: SupplierInvoicePerms): SupplierInvoiceListItem {
  let out = x;
  if (!p.amounts) out = { ...out, totalNet: null, totalGross: null, unallocated: null };
  if (!p.paid) out = { ...out, paymentStatus: null, paidAt: null, paidAmount: null, overdue: null };
  return out;
}

/** Detail bez částek / bez zaplaceno podle práv (RSC payload nesmí nést, co uživatel nesmí vidět). */
export function redactDetail(d: SupplierInvoiceDetail, p: SupplierInvoicePerms): SupplierInvoiceDetail {
  let out: SupplierInvoiceDetail = { ...d, perms: p };
  if (!p.amounts) {
    out = {
      ...out,
      totalNet: null, totalVat: null, totalGross: null, exchangeRate: null,
      items: out.items.map(hideItem),
      allocations: out.allocations.map(hideAlloc),
      supplierPurchaseOrders: out.supplierPurchaseOrders.map((po) => ({ ...po, total: null })),
      purchaseOrderInvoicing: out.purchaseOrderInvoicing.map((po) => ({ ...po, total: null, invoiced: null })),
      // soubor faktury nese částky → bez práva na částky ani odkaz (route vrací 403)
      files: [],
      aiSummary: null,
      needsClarification: [],
    };
  }
  if (!p.paid) out = { ...out, paymentStatus: null, paidAt: null, paidAmount: null, paidByName: null, overdue: null };
  return out;
}
