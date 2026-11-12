import { describe, it, expect, vi } from "vitest";
import * as React from "react";
import { renderToString } from "react-dom/server";

/**
 * Prémioví zákazníci (9. 11.): příznak živě ze zákazníka (mapping), filtr Knihy „Prémioví", přednostní řazení
 * v seznamech toku a výrazné označení (štítek „Pozor, prémiový zákazník" / „Prémiový zákazník — přednostně").
 */

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn(), replace: vi.fn(), back: vi.fn(), prefetch: vi.fn() }),
  usePathname: () => "/inquiries",
  useSearchParams: () => new URLSearchParams(),
}));
vi.mock("@/app/actions/crm", () => ({ setCustomerPremium: vi.fn() }));

import { PremiumBadge, PremiumBanner, PREMIUM_FLOW_LABEL, PREMIUM_LABEL } from "./premium-badge";
import { PremiumToggle } from "./premium-toggle";
import { JobMiniList } from "./job-mini-list";
import { FlowJobList } from "@/components/flow/flow-job-list";
import { premiumFirst } from "@/lib/jobs/premium";
import { filterJobs, isPremiumCustomer, rowToJobListItem, JOB_LIST_SELECT, JOB_DETAIL_SELECT, QUOTE_LIST_SELECT, type JobRow } from "@/lib/jobs/mapping";
import { bookParamsToFilters, bookQuery, parseBookParams, activeFilterCount, RESET_FILTERS, applyBookPatch } from "@/components/jobs/book/book-params";
import { CUSTOMER_SELECT, customerFormFromView, rowToCustomerView, EMPTY_CUSTOMER_FORM } from "./model";
import type { JobListItem } from "@/lib/jobs/types";

const html = (node: React.ReactNode) => renderToString(node).replace(/<!-- -->/g, "");

function job(over: Partial<JobListItem> = {}): JobListItem {
  return {
    id: "j1", number: "Z-2026-101", title: "Hřídel", stage: "poptavka", priority: "stredni",
    customer: { id: "c1", name: "Strojmetal a.s.", customerNumber: "ZK0007", ico: null },
    customerOrderNumber: null, customerInquiryNumber: null, drawingNumbers: [], itemCount: 0, totalQuantity: 0,
    value: null, purchaseCost: null, currency: "CZK", inquiryDate: null, orderDate: null, customerRequiredDate: null, dueDate: null,
    expectedDeliveryDate: null, supplierPromisedDate: null, maxToleratedDate: null, receivedAt: null, deliveredAt: null,
    owner: null, assignee: null, createdBy: null, supplier: null, quoteCount: 0, fileCount: 0, aiFilled: false, source: "manual",
    createdAt: "2026-11-01T10:00:00Z", updatedAt: "2026-11-01T10:00:00Z", stageChangedAt: null,
    ...over,
  };
}

describe("datová vrstva: příznak živě ze zákazníka", () => {
  it("výpisy čtou customers.is_premium (Kniha, karta, nabídky)", () => {
    expect(JOB_LIST_SELECT).toContain("customer:customers!customer_id(id, name, customer_number, ico, is_premium)");
    expect(JOB_DETAIL_SELECT).toMatch(/customer:customers!customer_id\([^)]*is_premium/);
    expect(QUOTE_LIST_SELECT).toContain("customer:customers!customer_id(id, name, is_premium)");
    expect(CUSTOMER_SELECT).toContain("is_premium");
  });

  it("rowToJobListItem: customerPremium z embedu (objekt i pole), chybí = ne", () => {
    const base = { id: "j", number: "Z-1", status: "objednavka", created_at: "2026-11-01T00:00:00Z" } as JobRow;
    expect(rowToJobListItem({ ...base, customer: { id: "c", name: "Hitachi", is_premium: true } }, { margins: false }).customerPremium).toBe(true);
    expect(rowToJobListItem({ ...base, customer: [{ id: "c", name: "Hitachi", is_premium: true }] }, { margins: false }).customerPremium).toBe(true);
    expect(rowToJobListItem({ ...base, customer: { id: "c", name: "ACME", is_premium: false } }, { margins: false }).customerPremium).toBe(false);
    expect(rowToJobListItem({ ...base, customer: { id: "c", name: "ACME" } }, { margins: false }).customerPremium).toBe(false);
    expect(rowToJobListItem(base, { margins: false }).customerPremium).toBe(false);
    expect(isPremiumCustomer(null)).toBe(false);
  });

  it("filterJobs({ premium }) nechá jen prémiové, bez filtru vše", () => {
    const all = [job({ id: "a" }), job({ id: "b", customerPremium: true }), job({ id: "c", customerPremium: false })];
    expect(filterJobs(all, { premium: true }).map((j) => j.id)).toEqual(["b"]);
    expect(filterJobs(all, {}).map((j) => j.id)).toEqual(["a", "b", "c"]);
  });

  it("zákazník: view a formulář nesou isPremium", () => {
    const v = rowToCustomerView({ id: "c", name: "Eden Europe", is_premium: true });
    expect(v.isPremium).toBe(true);
    expect(rowToCustomerView({ id: "c", name: "X" }).isPremium).toBe(false);
    expect(customerFormFromView(v).isPremium).toBe(true);
    expect(EMPTY_CUSTOMER_FORM.isPremium).toBe(false);
  });
});

describe("Kniha: chip „Prémioví“ (premiovi=1)", () => {
  it("URL ↔ parametry ↔ filtry, počítá se do filtrů a „Zrušit filtry“ ho vypne", () => {
    const p = parseBookParams({ premiovi: "1" });
    expect(p.premium).toBe(true);
    expect(parseBookParams({}).premium).toBe(false);
    expect(bookQuery(p)).toBe("premiovi=1");
    expect(bookParamsToFilters(p).premium).toBe(true);
    expect(bookParamsToFilters(parseBookParams({})).premium).toBeUndefined();
    expect(activeFilterCount(p)).toBe(1);
    expect(applyBookPatch(p, RESET_FILTERS).premium).toBe(false);
    // výchozí řazení Knihy se nemění
    expect(bookParamsToFilters(p).sort).toBe(bookParamsToFilters(parseBookParams({})).sort);
  });
});

describe("přednostní řazení v seznamech toku", () => {
  it("premiumFirst: prémiové nahoru, stabilně; bez prémiových beze změny", () => {
    const list = [{ id: 1 }, { id: 2, p: true }, { id: 3 }, { id: 4, p: true }];
    expect(premiumFirst(list, (x) => x.p).map((x) => x.id)).toEqual([2, 4, 1, 3]);
    expect(premiumFirst([{ id: 1 }, { id: 2 }], () => false).map((x) => x.id)).toEqual([1, 2]);
    expect(list.map((x) => x.id)).toEqual([1, 2, 3, 4]); // vstup nezměněn
  });

  it("FlowJobList (Poptávky, Potvrzení): prémiová zakázka první, výrazně „Prémiový zákazník — přednostně“", () => {
    const out = html(
      <FlowJobList
        jobs={[job({ id: "a", number: "Z-A" }), job({ id: "b", number: "Z-B", customerPremium: true, customer: { id: "c9", name: "Hitachi Energy", customerNumber: null, ico: null } })]}
        today="2026-11-09"
      />,
    );
    expect(out.indexOf("Z-B")).toBeLessThan(out.indexOf("Z-A"));
    expect(out.match(/data-testid="premium-badge"/g)).toHaveLength(1);
    expect(out.match(/data-premium="1"/g)).toHaveLength(1);
    expect(out).toContain(PREMIUM_FLOW_LABEL);
    expect(out).toContain("border-red-500/70");
  });

  it("JobMiniList v přehledu (showCustomer) zvýrazní, v kartě zákazníka ne (prémiový je celý zákazník)", () => {
    const jobs = [job({ id: "b", customerPremium: true })];
    expect(html(<JobMiniList jobs={jobs} showCustomer />)).toContain('data-premium="1"');
    expect(html(<JobMiniList jobs={jobs} />)).not.toContain("premium-badge");
  });
});

describe("štítek, banner a přepínač", () => {
  it("štítek: plná červená, výstražná ikona, popisky podle místa", () => {
    const full = html(<PremiumBadge label="full" />);
    expect(full).toContain(PREMIUM_LABEL);
    expect(full).toContain("bg-red-600");
    expect(full).toContain("text-white");
    expect(full).toContain("<svg");
    expect(html(<PremiumBadge label="compact" />)).toContain(">Prémiový</span>");
    const icon = html(<PremiumBadge label="icon" />);
    expect(icon).toContain(`aria-label="${PREMIUM_LABEL}"`);
    expect(icon).not.toContain(">Prémiový");
  });

  it("banner „Pozor — prémiový zákazník“", () => {
    const out = html(<PremiumBanner customerName="Hitachi Energy" />);
    expect(out).toContain("Pozor — prémiový zákazník");
    expect(out).toContain("Hitachi Energy");
  });

  it("přepínač v kartě zákazníka ukazuje stav", () => {
    const on = html(<PremiumToggle customerId="c1" value />);
    expect(on).toContain("Prémiový zákazník");
    expect(on).toContain('aria-checked="true"');
    expect(html(<PremiumToggle customerId="c1" value={false} />)).toContain('aria-checked="false"');
  });
});
