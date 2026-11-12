import { describe, it, expect } from "vitest";
import { hiddenQueueTypes, mayResolveQueueRow, maySeeQueue, type QueueFeature } from "./approval-queue-access";
import { DEFAULT_ACCESS_CONTEXT, can, type AccessSubject } from "./permissions";

const canOf = (s: AccessSubject, extra: Partial<Record<QueueFeature, boolean>> = {}) =>
  (f: QueueFeature) => extra[f] ?? can(s, f, DEFAULT_ACCESS_CONTEXT);

const admin: AccessSubject = { role: "super_admin", aiAccess: false, active: true };
const sales: AccessSubject = { role: "obchodnik", aiAccess: false, active: true };
const staff: AccessSubject = { role: "zamestnanec", aiAccess: false, active: true };
const sponer: AccessSubject = { ...staff, canResolveQueue: true, canSeeMargins: true };
const ME = "11111111-1111-1111-1111-111111111111";

describe("9. 11. fronta ke schválení — kdo vyřídí který řádek", () => {
  it("super admin vše, nic skrytého", () => {
    const c = canOf(admin);
    expect(maySeeQueue(c)).toBe(true);
    expect(hiddenQueueTypes(c)).toEqual([]);
    for (const type of ["email_reply", "quote", "supplier_request", "purchase_order", "supplier_invoice", "job_stage", "reminder"]) {
      expect(mayResolveQueueRow({ type, owner_id: null }, ME, c)).toBe(true);
    }
  });

  it("„Smí řešit frontu“: odchozí e-maily, objednávky, stav z pošty ano — AI návrh nabídky a faktura dodavatele ne", () => {
    const c = canOf(sponer);
    expect(maySeeQueue(c)).toBe(true);
    expect(hiddenQueueTypes(c)).toEqual(["quote", "supplier_invoice"]);
    for (const type of ["email_reply", "supplier_request", "purchase_order", "job_stage", "reminder", "categorization", "order_match"]) {
      expect(mayResolveQueueRow({ type, owner_id: "someone-else" }, ME, c)).toBe(true);
    }
    expect(mayResolveQueueRow({ type: "quote", owner_id: ME }, ME, c)).toBe(false);
    expect(mayResolveQueueRow({ type: "supplier_invoice", owner_id: null }, ME, c)).toBe(false);
    // s přístupem k fakturám dodavatelů (přepínač „pro všechny") i rozdělení faktury
    const withInvoices = canOf(sponer, { supplier_invoices: true });
    expect(hiddenQueueTypes(withInvoices)).toEqual(["quote"]);
    expect(mayResolveQueueRow({ type: "supplier_invoice", owner_id: null }, ME, withInvoices)).toBe(true);
  });

  it("bez příznaku: zaměstnanec nic; obchodník jen objednávku u své zakázky (jako dřív)", () => {
    const st = canOf(staff);
    expect(maySeeQueue(st)).toBe(false);
    expect(mayResolveQueueRow({ type: "email_reply", owner_id: ME }, ME, st)).toBe(false);
    expect(mayResolveQueueRow({ type: "purchase_order", owner_id: ME }, ME, st)).toBe(false);
    const sa = canOf(sales);
    expect(maySeeQueue(sa)).toBe(false);
    expect(mayResolveQueueRow({ type: "purchase_order", owner_id: ME }, ME, sa)).toBe(true);
    expect(mayResolveQueueRow({ type: "purchase_order", owner_id: "other" }, ME, sa)).toBe(false);
    expect(mayResolveQueueRow({ type: "purchase_order", owner_id: null }, ME, sa)).toBe(false);
    expect(mayResolveQueueRow({ type: "email_reply", owner_id: ME }, ME, sa)).toBe(false);
  });
});
