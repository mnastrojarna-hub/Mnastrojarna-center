import { describe, it, expect, vi } from "vitest";
import * as React from "react";
import { renderToString as renderRaw } from "react-dom/server";

/** HTML bez oddělovačů textových uzlů Reactu (<!-- -->). */
const renderToString = (node: React.ReactElement) => renderRaw(node).replace(/<!-- -->/g, "");

// Smoke test vykreslení adresáře, odznaků a ⌘K bez Next.js (router, oprávnění a akce nahrazené)
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn(), replace: vi.fn(), back: vi.fn(), prefetch: vi.fn() }),
  usePathname: () => "/customers",
}));
vi.mock("@/components/access-provider", () => ({
  useAccess: () => ({ features: ["orders", "customers"], role: null, userId: "u1", can: (f: string) => ["orders", "customers"].includes(f) }),
}));
vi.mock("@/app/actions/crm", () => ({
  createCustomer: vi.fn(), updateCustomer: vi.fn(), saveCustomerContact: vi.fn(), deleteCustomerContact: vi.fn(),
  createSupplier: vi.fn(), updateSupplier: vi.fn(),
}));

import { CustomersBrowser } from "@/components/customers/customers-browser";
import { ContactsManager } from "@/components/customers/contacts-manager";
import { JobMiniList } from "@/components/customers/job-mini-list";
import { SuppliersBrowser } from "@/components/suppliers/suppliers-browser";
import { CategoryBadge, OrderStatusBadge, QuoteStatusBadge } from "@/components/status-badge";
import { paletteScore, rankEntries, CommandPaletteProvider } from "@/components/command-palette";
import { rowToCustomerView, rowToContactView } from "@/components/customers/model";
import { rowToSupplierView } from "@/components/suppliers/model";
import type { JobListItem } from "@/lib/jobs/types";

const customer = rowToCustomerView({
  id: "c1", name: "Strojmetal a.s.", customer_number: "ZK0007", ico: "45274649", city: "Brno",
  email: "nakup@strojmetal.cz", phone: "+420 777 111 222", contact_person: "Jana Nováková",
  owner: { id: "u1", full_name: "Petr Obchodník" }, jobs: [{ status: "objednavka", value: 1000 }, { status: "dokonceno", value: 1 }],
});

function job(over: Partial<JobListItem> = {}): JobListItem {
  return {
    id: "j1", number: "Z-2026-104", title: "Příruby", stage: "ve_vyrobe", priority: "stredni",
    customer: { id: "c1", name: "Strojmetal a.s.", customerNumber: "ZK0007", ico: null },
    customerOrderNumber: "PO-4500021877", customerInquiryNumber: null, drawingNumbers: [], itemCount: 1, totalQuantity: 10,
    value: 94000, purchaseCost: null, currency: "CZK", inquiryDate: null, orderDate: null, customerRequiredDate: null,
    dueDate: "2026-10-01", expectedDeliveryDate: null, supplierPromisedDate: null, maxToleratedDate: null,
    receivedAt: null, deliveredAt: null, owner: null, assignee: null, createdBy: null, supplier: null, quoteCount: 2,
    fileCount: 0, aiFilled: true, source: "foto", createdAt: "2026-10-01T00:00:00Z", updatedAt: "2026-10-01T00:00:00Z",
    stageChangedAt: null, ...over,
  };
}

describe("adresář — vykreslení", () => {
  it("seznam zákazníků: číslo, kontakt, zakázky v běhu", () => {
    const html = renderToString(<CustomersBrowser customers={[customer]} owners={[{ id: "u1", name: "Petr Obchodník" }]} userId="u1" />);
    expect(html).toContain("Strojmetal a.s.");
    expect(html).toContain("ZK0007");
    expect(html).toContain("1 v běhu");
    expect(html).toContain("2 zakázky celkem");
    expect(html).toContain('href="/customers/c1"');
    expect(html).toContain("mailto:nakup@strojmetal.cz");
  });

  it("prázdný adresář vysvětlí, co dělat", () => {
    const html = renderToString(<CustomersBrowser customers={[]} owners={[]} userId="u1" />);
    expect(html).toContain("Zatím tu není žádný zákazník");
    expect(html).toContain("Nový zákazník");
  });

  it("kontakty: hlavní kontakt a prázdný stav", () => {
    expect(renderToString(<ContactsManager customerId="c1" contacts={[]} />)).toContain("Přidat kontaktní osobu");
    const html = renderToString(
      <ContactsManager customerId="c1" contacts={[rowToContactView({ id: "k1", name: "Jana", is_primary: true, email: "j@f.cz" })]} />,
    );
    expect(html).toContain("hlavní");
    expect(html).toContain("mailto:j@f.cz");
  });

  it("dodavatelé: štítky, hodnocení, prázdný stav", () => {
    const s = rowToSupplierView({ id: "s1", name: "Kalírna Brno", technologies: ["Kalení"], materials: ["1.2343"], certifications: ["ISO 9001"], rating: 4, lead_days: 7 });
    const html = renderToString(<SuppliersBrowser suppliers={[s]} />);
    expect(html).toContain("Kalírna Brno");
    expect(html).toContain("Kalení");
    expect(html).toContain("ISO 9001");
    expect(html).toContain("7 dní");
    expect(renderToString(<SuppliersBrowser suppliers={[]} />)).toContain("Zatím žádní dodavatelé");
  });

  it("řádky zakázek: číslo, stav, číslo objednávky zákazníka, termín po splatnosti", () => {
    const html = renderToString(<JobMiniList jobs={[job()]} showCustomer today={new Date("2026-10-22T10:00:00Z")} />);
    expect(html).toContain("Z-2026-104");
    expect(html).toContain("Ve výrobě");
    expect(html).toContain("PO-4500021877");
    expect(html).toContain("po termínu");
    expect(html).toContain('href="/orders/j1"');
  });
});

describe("odznaky", () => {
  it("stav zakázky z kódu i popisku, nabídka barevně, kategorie e-mailu", () => {
    expect(renderToString(<OrderStatusBadge status="objednavka" />)).toContain("Objednávka");
    expect(renderToString(<OrderStatusBadge status="Ve výrobě" />)).toContain("bg-yellow-100");
    expect(renderToString(<OrderStatusBadge status="Neznámý" />)).toContain("Neznámý");
    expect(renderToString(<QuoteStatusBadge status="ke_schvaleni" />)).toContain("Ke schválení");
    expect(renderToString(<QuoteStatusBadge status="Přijato" />)).toContain("bg-green-100");
    expect(renderToString(<QuoteStatusBadge status="odeslano" archived />)).toContain("Archiv");
    expect(renderToString(<CategoryBadge category="Poptávka" />)).toContain("bg-sky-50");
  });
});

describe("⌘K hledání", () => {
  const entries = [
    { id: "1", label: "Z-2026-001 · Příruby", keywords: "z-2026-001 priruby strojmetal po-4500021877" },
    { id: "2", label: "Z-2026-002 · Hřídel", keywords: "z-2026-002 hridel kovo zdar" },
    { id: "3", label: "Strojmetal a.s.", keywords: "strojmetal a.s. zk0007 45274649" },
  ];

  it("skóre: shoda všech slov, bez diakritiky, začátek popisku nejvýš", () => {
    expect(paletteScore("", entries[0])).toBe(1);
    expect(paletteScore("hřídel", entries[1])).toBe(2);
    expect(paletteScore("4500021877", entries[0])).toBe(1);
    expect(paletteScore("strojmetal", entries[2])).toBe(3);
    expect(paletteScore("strojmetal hridel", entries[0])).toBe(0);
  });

  it("řazení a limit", () => {
    expect(rankEntries(entries, "strojmetal", 5).map((e) => e.id)).toEqual(["3", "1"]);
    expect(rankEntries(entries, "", 2).map((e) => e.id)).toEqual(["1", "2"]);
    expect(rankEntries(entries, "nic", 5)).toEqual([]);
  });

  it("poskytovatel se vykreslí (dialog zavřený)", () => {
    expect(renderToString(<CommandPaletteProvider><span>obsah</span></CommandPaletteProvider>)).toContain("obsah");
  });
});
