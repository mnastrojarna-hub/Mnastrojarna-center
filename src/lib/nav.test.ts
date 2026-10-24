import { describe, expect, it } from "vitest";
import { activeNavHref, allNavItems, matchesNavPath, navForFeatures } from "@/lib/nav";
import { allowedFeatures, type AccessContext, type AccessSubject } from "@/lib/auth/permissions";

describe("aktivní položka navigace", () => {
  const hrefs = allNavItems.map((i) => i.href);

  it("podstránka patří k položce, podobný prefix ne", () => {
    expect(matchesNavPath("/orders/abc", "/orders")).toBe(true);
    expect(matchesNavPath("/orders", "/orders")).toBe(true);
    expect(matchesNavPath("/ordersx", "/orders")).toBe(false);
  });

  it("vyhraje nejdelší shoda — na auditu svítí jen Audit", () => {
    expect(activeNavHref("/settings/audit", hrefs)).toBe("/settings/audit");
    expect(activeNavHref("/settings", hrefs)).toBe("/settings");
    expect(activeNavHref("/orders/123", hrefs)).toBe("/orders");
    expect(activeNavHref("/neznamo", hrefs)).toBeNull();
  });
});

describe("#25 navigace podle role", () => {
  const ctx: AccessContext = { aiEnabled: true, aiCaptureForAll: true, aiConfigured: true };
  const hrefsOf = (role: AccessSubject["role"]) =>
    navForFeatures(allowedFeatures({ role, aiAccess: false, active: true }, ctx)).flatMap((s) => s.items.map((i) => i.href));

  it("Nacenění jen super admin; Objednávky dodavatelům všem (bez cen jen přehled)", () => {
    expect(hrefsOf("super_admin")).toEqual(expect.arrayContaining(["/pricing", "/purchasing", "/inquiries", "/quotes", "/documents"]));
    const sales = hrefsOf("obchodnik");
    expect(sales).not.toContain("/pricing");
    expect(sales).toEqual(expect.arrayContaining(["/purchasing", "/inquiries", "/quotes", "/confirmations", "/documents", "/orders"]));
    const worker = hrefsOf("zamestnanec");
    expect(worker).not.toContain("/pricing");
    expect(worker).toEqual(expect.arrayContaining(["/inquiries", "/quotes", "/documents", "/orders"]));
    // 25-C: přehled bez cen, PDF a akcí (data maskuje server)
    expect(worker).toContain("/purchasing");
    expect(worker).not.toContain("/commissions");
  });

  it("neaktivní účet nevidí nic", () => {
    expect(navForFeatures(allowedFeatures({ role: "super_admin", aiAccess: true, active: false }, ctx))).toEqual([]);
  });
});
