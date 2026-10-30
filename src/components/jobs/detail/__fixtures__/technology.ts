// Testovací data karty „Technologie" (Přehled): zakázky v jednotlivých fázích (sdílí testy modelu a renderu).
import type { JobItem } from "@/lib/jobs/types";
import type { JobOperation } from "@/lib/jobs/production-types";
import type { PurchaseOrderView, SupplierQuoteView } from "@/lib/jobs/purchasing-types";

export const NOVAK = { id: "s-novak", name: "Frézy Novák s.r.o." };
export const TEPKAL = { id: "s-tepkal", name: "TepKal s.r.o." };
export const HRUBY = { id: "s-hruby", name: "Kovoobrábění Hrubý s.r.o." };

/** RRRR-MM-DD posunuté o n dní. */
export function addDays(iso: string, n: number): string {
  const d = new Date(`${iso}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

export function item(over: Partial<JobItem> & { id: string }): JobItem {
  return {
    position: 0, drawingNumber: null, revision: null, name: null, description: null, material: "1.2379", quantity: 1, unit: "ks",
    unitPrice: null, purchaseUnitPrice: null, note: null, deliveredQuantity: 0, ...over,
  };
}

export function op(over: Partial<JobOperation> & { id: string }): JobOperation {
  const supplier = over.supplier ?? null;
  return {
    jobId: "j1", position: 0, kind: "frezovani", title: null, label: "Frézování", supplier, supplierName: null,
    inHouse: false, location: supplier?.name ?? (over.inHouse ? "U nás" : "—"), status: "ceka", plannedStart: null, plannedEnd: null,
    startedAt: null, finishedAt: null, note: null, purchaseOrderId: null, purchaseOrderNumber: null, createdBy: null,
    createdAt: "2026-10-01T08:00:00Z", updatedAt: "2026-10-01T08:00:00Z", overdue: false, ...over,
  };
}

export function quote(over: Partial<SupplierQuoteView> & { id: string }): SupplierQuoteView {
  const supplier = over.supplier ?? null;
  return {
    jobId: "j1", supplier, supplierName: supplier?.name ?? "Dodavatel", number: `NAB-${over.id}`, quoteDate: "2026-10-20", validUntil: null,
    leadTimeDays: null, deliveryDate: null, currency: "CZK", total: null, selected: false, note: null, fileId: null, source: "manual",
    createdBy: null, createdAt: "2026-10-20T08:00:00Z", updatedAt: "2026-10-20T08:00:00Z", items: [], operationKinds: null, ...over,
  };
}

export function supplierRef(s: { id: string; name: string }) {
  return { ...s, email: null, phone: null, ico: null, dic: null, address: null, contactPerson: null, country: "CZ" };
}

export function purchaseOrder(over: Partial<PurchaseOrderView> & { id: string; number: string }): PurchaseOrderView {
  return {
    jobId: "j1", status: "vystavena", supplier: null, supplierQuote: null, orderDate: "2026-10-25", requiredDate: null, confirmedDate: null,
    currency: "CZK", total: 0, deliveryTerms: null, paymentTerms: null, deliveryAddress: null, note: null, supplierReference: null,
    fileId: null, sentAt: null, createdBy: null, createdAt: "2026-10-25T08:00:00Z", updatedAt: "2026-10-25T08:00:00Z", items: [], ...over,
  };
}

/** Objednávka na kroku (JobOperation.purchaseOrder). */
export function stepPo(p: PurchaseOrderView): NonNullable<JobOperation["purchaseOrder"]> {
  return { id: p.id, number: p.number, status: p.status, sentAt: p.sentAt, confirmedDate: p.confirmedDate, fileId: null };
}
