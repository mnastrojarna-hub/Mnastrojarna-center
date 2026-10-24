import { describe, it, expect, vi } from "vitest";
import * as React from "react";
import { renderToString } from "react-dom/server";

// #25 (zbytky 2 a 3): Obchodníka zákazníka / zakázky volí jen super admin; zaměstnanec obchodníkem
// zákazníka není (bez předvyplnění). Dialog je otevřený (bez portálu), oprávnění podle role.
const who: { role: "super_admin" | "obchodnik" | "zamestnanec"; userId: string } = { role: "obchodnik", userId: "u1" };

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn(), replace: vi.fn(), back: vi.fn(), prefetch: vi.fn() }),
  usePathname: () => "/customers",
}));
vi.mock("@/components/access-provider", () => ({
  useAccess: () => ({
    features: ["orders", "customers"], role: who.role, userId: who.userId,
    can: (f: string) => ["orders", "customers"].includes(f),
  }),
}));
vi.mock("@/app/actions/crm", () => ({ createCustomer: vi.fn(), updateCustomer: vi.fn() }));
vi.mock("@/app/actions/jobs", () => ({ setJobStage: vi.fn(), createJob: vi.fn() }));
vi.mock("@/components/ui/dialog", () => ({
  Dialog: ({ children }: { children: React.ReactNode }) => <div data-dialog>{children}</div>,
  DialogTrigger: ({ children }: { children: React.ReactNode }) => <>{children}</>,
  DialogContent: ({ children }: { children: React.ReactNode }) => <div role="dialog">{children}</div>,
  DialogTitle: ({ children }: { children: React.ReactNode }) => <h2>{children}</h2>,
}));

import { CustomerDialog } from "@/components/customers/customer-dialog";
import { JobForm } from "@/components/jobs/job-form";
import { ownerPreview } from "@/components/jobs/book/job-form-model";
import type { JobFormOptions } from "@/lib/jobs/types";

const html = (el: React.ReactElement) => renderToString(el).replace(/<!-- -->/g, "");
const OWNERS = [{ id: "u1", name: "Petr Obchodník" }, { id: "u2", name: "Jana Zaměstnanec" }, { id: "u9", name: "Jan Semorád" }];

/** Text read-only pole „Obchodník“ (bez značek). */
function ownerReadonly(markup: string): string | null {
  const m = markup.match(/data-field="owner-readonly"[^>]*>([\s\S]*?)<\/div>/);
  return m ? m[1].replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim() : null;
}

describe("#25 Nový zákazník — Obchodník podle role", () => {
  it("super admin: výběr obchodníka, předvyplněný přihlášený", () => {
    who.role = "super_admin";
    who.userId = "u9";
    const out = html(<CustomerDialog owners={OWNERS} defaultOwnerId="u9" />);
    expect(out).toContain('id="cust-ownerId"');
    expect(out).not.toContain('data-field="owner-readonly"');
    expect(out).toMatch(/<option value="u9" selected="">Jan Semorád<\/option>/);
  });

  it("obchodník: jen pro čtení se svým jménem, bez výběru", () => {
    who.role = "obchodnik";
    who.userId = "u1";
    const out = html(<CustomerDialog owners={OWNERS} defaultOwnerId="u1" />);
    expect(out).not.toContain('id="cust-ownerId"');
    expect(ownerReadonly(out)).toContain("Petr Obchodník");
    expect(out).toContain("Obchodníka zákazníka mění jen super admin.");
  });

  it("zaměstnanec: jen pro čtení „— bez obchodníka —“, sám sebe nepředvyplní", () => {
    who.role = "zamestnanec";
    who.userId = "u2";
    const out = html(<CustomerDialog owners={OWNERS} defaultOwnerId="u2" />);
    expect(out).not.toContain('id="cust-ownerId"');
    const ro = ownerReadonly(out) ?? "";
    expect(ro).toContain("— bez obchodníka —");
    expect(ro).not.toContain("Jana Zaměstnanec");
  });
});

const OPTIONS: JobFormOptions = {
  users: [
    { id: "u1", name: "Petr Obchodník", role: "obchodnik" }, { id: "u2", name: "Jana Zaměstnanec", role: "zamestnanec" },
    { id: "u9", name: "Jan Semorád", role: "super_admin" },
  ],
  customers: [
    { id: "c1", name: "Strojmetal a.s.", customerNumber: "ZK0007", ico: null, ownerId: "u1" },
    { id: "c2", name: "Bez obchodníka s.r.o.", customerNumber: "ZK0008", ico: null, ownerId: null },
  ],
  suppliers: [],
};

describe("#25 Nová zakázka — Obchodník jen pro čtení mimo super admina", () => {
  it("zaměstnanec: žádný výběr Obchodníka, read-only blok s vysvětlením", () => {
    who.role = "zamestnanec";
    who.userId = "u2";
    const out = html(<JobForm options={OPTIONS} onSubmit={() => {}} />);
    expect(out).toContain('data-field="owner-readonly"');
    expect(out).not.toMatch(/<label[^>]*>Obchodník/);
    expect(ownerReadonly(out)).toContain("obchodník zákazníka (doplní se sám)");
    expect(out).toContain("Obchodníka zakázky mění jen super admin.");
  });

  it("super admin: výběr Obchodníka zůstává", () => {
    who.role = "super_admin";
    who.userId = "u9";
    const out = html(<JobForm options={OPTIONS} onSubmit={() => {}} />);
    expect(out).not.toContain('data-field="owner-readonly"');
    expect(out).toContain("odpovídá za zakázku");
  });

  it("náhled jména: obchodník vybraného zákazníka, jinak zakládající obchodník; zaměstnanec nikdo", () => {
    const sales = { userId: "u1", role: "obchodnik" };
    const worker = { userId: "u2", role: "zamestnanec" };
    const pick = (customerId: string) => ({ customerMode: "existing" as const, customerId, customerName: "" });
    expect(ownerPreview(pick(""), OPTIONS, worker)).toBe("obchodník zákazníka (doplní se sám)");
    expect(ownerPreview(pick("c1"), OPTIONS, worker)).toBe("Petr Obchodník (obchodník zákazníka)");
    expect(ownerPreview(pick("c2"), OPTIONS, worker)).toBe("— bez obchodníka —");
    expect(ownerPreview(pick("c2"), OPTIONS, sales)).toBe("Petr Obchodník (ty)");
    const fresh = { customerMode: "new" as const, customerId: "", customerName: "Nová firma" };
    expect(ownerPreview(fresh, OPTIONS, sales)).toBe("Petr Obchodník (ty)");
    expect(ownerPreview(fresh, OPTIONS, worker)).toBe("— bez obchodníka —");
    // neaktivní / neznámý obchodník zákazníka (není v seznamu aktivních) → jako bez obchodníka
    const gone = { ...OPTIONS, customers: [{ id: "c3", name: "X", customerNumber: null, ico: null, ownerId: "u-old" }] };
    expect(ownerPreview(pick("c3"), gone, worker)).toBe("— bez obchodníka —");
  });
});
