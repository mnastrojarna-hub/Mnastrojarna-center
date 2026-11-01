import { describe, it, expect } from "vitest";
import {
  ALL_FEATURES, DEFAULT_ACCESS_CONTEXT, FEATURE_HINTS, FEATURE_LABELS, can, allowedFeatures,
  type AccessContext, type AccessSubject,
} from "./permissions";

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

  it("#25: Nacenění, schvalování nabídek a obchodní tok všech jen super admin (i bez AI klíče)", () => {
    for (const f of ["pricing", "quote_approval", "flow_all"] as const) {
      expect(can(admin, f, ctx({ aiConfigured: false, aiEnabled: false }))).toBe(true);
      expect(can(sales, f, ctx())).toBe(false);
      expect(can({ ...staff, aiAccess: true }, f, ctx({ aiCaptureForAll: true }))).toBe(false);
      expect(ALL_FEATURES).toContain(f);
    }
    expect(FEATURE_HINTS.pricing).toContain("Nacenění zatím dělá jen super admin");
  });

  it("31. 10.: „Smí schvalovat nabídky ostatních“ → quote_approval (nic dalšího z adminských funkcí); neaktivní ne", () => {
    const volny: AccessSubject = { ...sales, canApproveQuotes: true };
    const workerApprover: AccessSubject = { ...staff, canApproveQuotes: true };
    expect(can(volny, "quote_approval", ctx())).toBe(true);
    expect(can(workerApprover, "quote_approval", ctx())).toBe(true);
    expect(can({ ...volny, active: false }, "quote_approval", ctx())).toBe(false);
    expect(can({ ...sales, canApproveQuotes: false }, "quote_approval", ctx())).toBe(false);
    for (const f of ["pricing", "flow_all", "dashboard", "users", "settings", "delete"] as const) {
      expect(can(volny, f, ctx())).toBe(false);
    }
    expect(allowedFeatures(volny, ctx())).toContain("quote_approval");
    expect(allowedFeatures(workerApprover, ctx())).not.toContain("margins");
  });

  it("31. 10.: poptávky dodavatelům (rfq) — obchodník a super admin vždy, zaměstnanec jen se „Smí poptávat“ a bez marží", () => {
    expect(can(admin, "rfq", ctx())).toBe(true);
    expect(can(sales, "rfq", ctx())).toBe(true);
    expect(can(staff, "rfq", ctx())).toBe(false);
    const sponer: AccessSubject = { ...staff, canRfq: true };
    expect(can(sponer, "rfq", ctx())).toBe(true);
    expect(can({ ...sponer, active: false }, "rfq", ctx())).toBe(false);
    // příznak nedává marže, provize ani objednávky dodavatelům
    for (const f of ["margins", "commissions", "pricing", "commissions_all"] as const) expect(can(sponer, f, ctx())).toBe(false);
    expect(FEATURE_HINTS.rfq).toContain("Smí poptávat dodavatele");
  });

  it("#25: AI focení pro všechny je výchozí — s klíčem ho má obchodník i zaměstnanec", () => {
    expect(DEFAULT_ACCESS_CONTEXT.aiCaptureForAll).toBe(true);
    const withKey = { ...DEFAULT_ACCESS_CONTEXT, aiConfigured: true };
    expect(can(sales, "ai_capture", withKey)).toBe(true);
    expect(can(staff, "ai_capture", withKey)).toBe(true);
    // bez klíče (výchozí kontext integračních testů) se AI nespouští nikomu
    expect(can(staff, "ai_capture", DEFAULT_ACCESS_CONTEXT)).toBe(false);
    // super admin ho vypne → jen per-uživatel
    expect(can(staff, "ai_capture", { ...withKey, aiCaptureForAll: false })).toBe(false);
  });

  it("popisky pokrývají všechny funkce", () => {
    for (const f of ALL_FEATURES) expect(FEATURE_LABELS[f]).toBeTruthy();
    expect(new Set(ALL_FEATURES).size).toBe(ALL_FEATURES.length);
  });
});
