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

  it("9. 11.: ruční změna stavu (stage_any) — super admin vždy, ostatní jen se „Smí ručně měnit stav zakázky“, bez marží", () => {
    expect(can(admin, "stage_any", ctx())).toBe(true);
    expect(can({ ...admin, fullAccess: true }, "stage_any", ctx())).toBe(true);
    expect(can(staff, "stage_any", ctx())).toBe(false);
    // obchodník bez příznaku v subjektu ne (current-user ho obchodníkovi dosadí — přechody má i tak přes marže)
    expect(can(sales, "stage_any", ctx())).toBe(false);
    expect(can({ ...sales, canChangeStage: true }, "stage_any", ctx())).toBe(true);
    const sponer: AccessSubject = { ...staff, canChangeStage: true };
    expect(can(sponer, "stage_any", ctx())).toBe(true);
    expect(can({ ...sponer, active: false }, "stage_any", ctx())).toBe(false);
    expect(can({ ...staff, canChangeStage: false }, "stage_any", ctx())).toBe(false);
    // příznak dává jen změnu stavu — ne marže, ceny, provize, nacenění, mazání ani poptávky dodavatelům
    for (const f of ["margins", "commissions", "commissions_all", "pricing", "delete", "rfq", "quote_approval", "flow_all", "supplier_invoices"] as const) {
      expect(can(sponer, f, ctx())).toBe(false);
    }
    expect(allowedFeatures(sponer, ctx())).toContain("stage_any");
    expect(allowedFeatures(staff, ctx())).not.toContain("stage_any");
  });

  it("9. 11.: fronta ke schválení (approval_queue) — super admin vždy, ostatní jen se „Smí řešit frontu ke schválení“", () => {
    expect(can(admin, "approval_queue", ctx())).toBe(true);
    expect(can({ ...admin, fullAccess: true }, "approval_queue", ctx())).toBe(true);
    expect(can(sales, "approval_queue", ctx())).toBe(false);
    expect(can(staff, "approval_queue", ctx())).toBe(false);
    expect(can({ ...sales, canResolveQueue: true }, "approval_queue", ctx())).toBe(true);
    const q: AccessSubject = { ...staff, canResolveQueue: true };
    expect(can(q, "approval_queue", ctx())).toBe(true);
    expect(can({ ...q, active: false }, "approval_queue", ctx())).toBe(false);
    // jen fronta — ne AI přehled, schvalování nabídek, marže, provize, nastavení…
    for (const f of ["dashboard", "quote_approval", "margins", "commissions", "commissions_all", "settings", "users", "delete", "pricing", "flow_all", "mail_all"] as const) {
      expect(can(q, f, ctx())).toBe(false);
    }
    expect(allowedFeatures(q, ctx())).toContain("approval_queue");
    expect(allowedFeatures(staff, ctx())).not.toContain("approval_queue");
  });

  it("9. 11.: nákupní ceny a marže (margins) — zaměstnanec jen s „Vidí nákupní ceny a marže“, bez provizí ostatních", () => {
    expect(can(staff, "margins", ctx())).toBe(false);
    const m: AccessSubject = { ...staff, canSeeMargins: true };
    expect(can(m, "margins", ctx())).toBe(true);
    expect(can({ ...m, active: false }, "margins", ctx())).toBe(false);
    expect(can(sales, "margins", ctx())).toBe(true);
    expect(can(admin, "margins", ctx())).toBe(true);
    // příznak dává jen marže — ne provize (vlastní ani ostatních), nacenění, nastavení, uživatele, mazání, poštu ostatních ani tok všech
    for (const f of ["commissions", "commissions_all", "pricing", "settings", "users", "delete", "mail_all", "flow_all", "dashboard", "approval_queue", "quote_approval"] as const) {
      expect(can(m, f, ctx())).toBe(false);
    }
    // Šponer: všechny čtyři příznaky — fronta, marže, poptávky, stav; zakázané funkce dál ne
    const sponer: AccessSubject = { ...staff, canResolveQueue: true, canSeeMargins: true, canRfq: true, canChangeStage: true };
    expect(allowedFeatures(sponer, ctx())).toEqual(expect.arrayContaining(["approval_queue", "margins", "rfq", "stage_any"]));
    for (const f of ["commissions_all", "settings", "users", "delete", "mail_all", "pricing", "flow_all", "dashboard"] as const) {
      expect(can(sponer, f, ctx())).toBe(false);
    }
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

describe("plný přístup (2. 11. — Volný, Šponer)", () => {
  // current-user.ts dosadí efektivní roli super_admin + fullAccess
  const full: AccessSubject = { role: "super_admin", aiAccess: true, active: true, fullAccess: true };

  it("smí vše jako super admin kromě pošty ostatních schránek a správy uživatelů", () => {
    const allowed = allowedFeatures(full, ctx({ supplierInvoicesForAll: false }));
    expect(allowed).not.toContain("users");
    expect(allowed).not.toContain("mail_all");
    expect([...allowed].sort()).toEqual(ALL_FEATURES.filter((f) => f !== "users" && f !== "mail_all").sort());
  });

  it("vlastní pošta ano, ostatní schránky ne", () => {
    expect(can(full, "mail", ctx())).toBe(true);
    expect(can(full, "mail_all", ctx())).toBe(false);
  });

  it("neaktivní účet s plným přístupem nesmí nic", () => {
    expect(allowedFeatures({ ...full, active: false }, ctx())).toEqual([]);
  });

  it("skutečný super admin beze změny", () => {
    expect(can(admin, "users", ctx())).toBe(true);
    expect(can(admin, "mail_all", ctx())).toBe(true);
  });
});
