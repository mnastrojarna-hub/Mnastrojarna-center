import { describe, it, expect } from "vitest";
import { navForFeatures } from "@/lib/nav";
import { allowedFeatures, can, FEATURE_LABELS, type AccessContext, type AccessSubject } from "@/lib/auth/permissions";

const hrefs = (role: AccessSubject["role"], forAll = false) => {
  const ctx: AccessContext = { aiEnabled: true, aiCaptureForAll: true, aiConfigured: true, supplierInvoicesForAll: forAll };
  return navForFeatures(allowedFeatures({ role, aiAccess: false, active: true }, ctx)).flatMap((s) => s.items.map((i) => i.href));
};

describe("Faktury dodavatelů v menu", () => {
  it("menu jen super admin, „Nahrát fakturu“ ostatním (super admin ji má v seznamu)", () => {
    expect(hrefs("super_admin")).toContain("/supplier-invoices");
    expect(hrefs("super_admin")).not.toContain("/supplier-invoices/upload");
    for (const r of ["obchodnik", "zamestnanec"] as const) {
      expect(hrefs(r)).not.toContain("/supplier-invoices");
      expect(hrefs(r)).toContain("/supplier-invoices/upload");
    }
  });
  it("přepínač „všichni“: menu všem", () => {
    expect(hrefs("zamestnanec", true)).toContain("/supplier-invoices");
    expect(hrefs("zamestnanec", true)).not.toContain("/supplier-invoices/upload");
  });
  it("zaplaceno jen super admin i v režimu všichni; popisky funkcí", () => {
    const ctx: AccessContext = { aiEnabled: true, aiCaptureForAll: true, aiConfigured: true, supplierInvoicesForAll: true };
    expect(can({ role: "obchodnik", aiAccess: false, active: true }, "supplier_invoices_paid", ctx)).toBe(false);
    expect(can({ role: "super_admin", aiAccess: false, active: true }, "supplier_invoices_paid", ctx)).toBe(true);
    expect(FEATURE_LABELS.supplier_invoices).toBe("Faktury dodavatelů");
  });
});
