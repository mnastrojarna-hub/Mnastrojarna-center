import { describe, it, expect } from "vitest";
import { can, allowedFeatures, type AccessContext, type AccessSubject } from "./permissions";

const ctx = (o: Partial<AccessContext> = {}): AccessContext => ({ aiEnabled: true, aiCaptureForAll: false, aiConfigured: true, ...o });
const admin: AccessSubject = { role: "super_admin", aiAccess: false, active: true };
const sales: AccessSubject = { role: "obchodnik", aiAccess: false, active: true };
const staff: AccessSubject = { role: "zamestnanec", aiAccess: false, active: true };

describe("oprávnění dle rolí", () => {
  it("Kniha zakázek, zákazníci, dodavatelé a vlastní pošta pro všechny aktivní", () => {
    for (const s of [admin, sales, staff]) {
      for (const f of ["orders", "workflow", "documents", "customers", "suppliers", "mail"] as const) {
        expect(can(s, f, ctx())).toBe(true);
      }
    }
  });

  it("neaktivní nebo nepřihlášený nesmí nic", () => {
    expect(allowedFeatures({ ...admin, active: false }, ctx())).toEqual([]);
    expect(allowedFeatures(null, ctx())).toEqual([]);
  });

  it("AI, znalosti, výkresy, nastavení a uživatelé jen super admin", () => {
    for (const f of ["ai_assistant", "ai_tuning", "knowledge", "drawings", "settings", "users", "mail_all", "dashboard", "delete"] as const) {
      expect(can(admin, f, ctx())).toBe(true);
      expect(can(sales, f, ctx())).toBe(false);
      expect(can(staff, f, ctx())).toBe(false);
    }
  });

  it("AI čtení dokladů: admin vždy, ostatní jen po povolení (per uživatel nebo pro všechny)", () => {
    expect(can(admin, "ai_capture", ctx())).toBe(true);
    expect(can(sales, "ai_capture", ctx())).toBe(false);
    expect(can({ ...sales, aiAccess: true }, "ai_capture", ctx())).toBe(true);
    expect(can(staff, "ai_capture", ctx({ aiCaptureForAll: true }))).toBe(true);
  });

  it("bez klíče nebo s vypnutým AI se AI nespouští (ani adminovi)", () => {
    expect(can(admin, "ai_capture", ctx({ aiConfigured: false }))).toBe(false);
    expect(can(admin, "ai_pricing", ctx({ aiEnabled: false }))).toBe(false);
    expect(can({ ...sales, aiAccess: true }, "ai_capture", ctx({ aiEnabled: false }))).toBe(false);
    // asistent zůstane vidět adminovi i bez klíče (stránka řekne, co doplnit), vypínač ho skryje
    expect(can(admin, "ai_assistant", ctx({ aiConfigured: false }))).toBe(true);
    expect(can(admin, "ai_assistant", ctx({ aiEnabled: false }))).toBe(false);
  });

  it("nacenění AI nemá nikdo kromě admina; marže a provize obchodník ano, zaměstnanec ne", () => {
    expect(can({ ...sales, aiAccess: true }, "ai_pricing", ctx())).toBe(false);
    expect(can(sales, "margins", ctx())).toBe(true);
    expect(can(sales, "commissions", ctx())).toBe(true);
    expect(can(sales, "commissions_all", ctx())).toBe(false);
    expect(can(staff, "margins", ctx())).toBe(false);
    expect(can(staff, "commissions", ctx())).toBe(false);
  });
});
