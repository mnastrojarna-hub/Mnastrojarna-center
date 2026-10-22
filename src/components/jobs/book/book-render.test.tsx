import { describe, it, expect, vi } from "vitest";
import * as React from "react";
import { renderToString } from "react-dom/server";

// Smoke test vykreslení Knihy zakázek bez Next.js: router, oprávnění a akce jsou nahrazené
const accessState: { features: string[] } = { features: ["orders"] };

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn(), replace: vi.fn(), back: vi.fn(), prefetch: vi.fn() }),
  usePathname: () => "/orders",
}));
vi.mock("@/components/access-provider", () => ({
  useAccess: () => ({
    features: accessState.features,
    role: null,
    userId: "u1",
    can: (f: string) => accessState.features.includes(f),
  }),
}));
vi.mock("@/app/actions/jobs", () => ({ setJobStage: vi.fn(), createJob: vi.fn() }));

import { TooltipProvider } from "@/components/ui/tooltip";
import { BookNavProvider } from "@/components/jobs/book/book-nav";
import { JobRows, JobRowsHeader } from "@/components/jobs/book/job-rows";
import { JobBoard } from "@/components/jobs/book/job-board";
import { BookEmpty } from "@/components/jobs/book/book-empty";
import { StageLegend } from "@/components/jobs/book/stage-legend";
import { KpiStrip } from "@/components/jobs/book/kpi-strip";
import { SegmentTabs, StageChips } from "@/components/jobs/book/segment-tabs";
import { BookToolbar } from "@/components/jobs/book/book-toolbar";
import { JobForm } from "@/components/jobs/job-form";
import { DEFAULT_PARAMS, segmentCounts, bookKpis, type BookParams } from "@/components/jobs/book/book-params";
import { STAGE_ORDER } from "@/lib/jobs/stages";
import type { JobListItem, JobFormOptions } from "@/lib/jobs/types";
import type { JobStage } from "@/lib/supabase/database.types";

const OPTIONS: JobFormOptions = {
  users: [{ id: "u1", name: "Petr Obchodník", role: "obchodnik" }, { id: "u2", name: "Jana Zpracovatelka", role: "zamestnanec" }],
  customers: [{ id: "c1", name: "Strojmetal a.s.", customerNumber: "ZK0007", ico: "45274649" }],
  suppliers: [{ id: "s1", name: "Kalírna Brno" }],
};

function job(over: Partial<JobListItem> = {}): JobListItem {
  return {
    id: "j1", number: "Z-2026-104", title: "Příruby AL 7075 — 200 ks", stage: "objednavka", priority: "vysoka",
    customer: { id: "c1", name: "Strojmetal a.s.", customerNumber: "ZK0007", ico: null },
    customerOrderNumber: "PO-4500021877", customerInquiryNumber: null,
    drawingNumbers: ["PR-1", "PR-2", "PR-3", "PR-4"], itemCount: 4, totalQuantity: 200,
    value: 94000, purchaseCost: null, currency: "CZK",
    inquiryDate: null, orderDate: "2026-10-18", customerRequiredDate: null, dueDate: "2026-10-25",
    expectedDeliveryDate: null, supplierPromisedDate: "2026-10-28", maxToleratedDate: null,
    receivedAt: null, deliveredAt: null,
    owner: { id: "u1", name: "Petr Obchodník" }, assignee: { id: "u2", name: "Jana Zpracovatelka" }, createdBy: null,
    supplier: null, quoteCount: 2, fileCount: 3, aiFilled: true, source: "foto",
    createdAt: "2026-10-18T10:00:00Z", updatedAt: "2026-10-18T10:00:00Z", stageChangedAt: "2026-10-18T10:00:00Z",
    ...over,
  };
}

function render(node: React.ReactNode, params: BookParams = DEFAULT_PARAMS): string {
  // bez oddělovačů textových uzlů (<!-- -->), ať jde hledat souvislý text
  return renderToString(
    <TooltipProvider>
      <BookNavProvider params={params}>{node}</BookNavProvider>
    </TooltipProvider>,
  ).replace(/<!-- -->/g, "");
}

const byStage = Object.fromEntries(STAGE_ORDER.map((s) => [s, 1])) as Record<JobStage, number>;

describe("Kniha zakázek — vykreslení", () => {
  it("řádek ukáže číslo, zákazníka, obj. zákazníka, výkresy, termín a odkaz na detail", () => {
    const html = render(
      <>
        <JobRowsHeader />
        <JobRows jobs={[job(), job({ id: "j2", number: "Z-2026-105", stage: "dokonceno", customer: null, value: null })]} today="2026-10-22" />
      </>,
    );
    expect(html).toContain("Z-2026-104");
    expect(html).toContain('href="/orders/j1"');
    expect(html).toContain('href="/customers/c1"');
    expect(html).toContain("PO-4500021877");
    expect(html).toContain("PR-1");
    expect(html).toContain("+1"); // 4 výkresy → 3 + „+1"
    expect(html).toContain("za 3 dny");
    expect(html).toContain("dod. 28. 10.");
    expect(html).toContain("Bez zákazníka");
    expect(html).toContain("splněno");
    expect(html).toMatch(/94\s000\sKč/);
  });

  it("tabule má sloupce stavů a karty", () => {
    const html = render(<JobBoard jobs={[job()]} stages={["objednavka", "potvrzeno"]} today="2026-10-22" />);
    expect(html).toContain("Objednávka");
    expect(html).toContain("Potvrzená objednávka");
    expect(html).toContain('draggable="true"');
    expect(html).toContain("Nic tu není");
  });

  it("prázdné stavy vysvětlí, co dělat", () => {
    const empty = render(<BookEmpty segment="objednavky" filtered={false} options={OPTIONS} defaultStage="objednavka" userId="u1" />);
    expect(empty).toContain("Zatím žádné objednávky");
    expect(empty).toContain("Vyfotit doklad");
    expect(empty).toContain("Nová zakázka");
    const none = render(<BookEmpty segment="vse" filtered options={OPTIONS} defaultStage="objednavka" userId="u1" />);
    expect(none).toContain("Nic tomu neodpovídá");
    expect(none).toContain("Zrušit filtry");
  });

  it("dlaždice, záložky, chipy, lišta a legenda", () => {
    const counts = { byStage, overdue: 2, dueThisWeek: 1, active: 13, total: 16 };
    const html = render(
      <>
        <KpiStrip kpis={bookKpis(counts)} runningValue={524100} />
        <SegmentTabs counts={segmentCounts(byStage)} />
        <StageChips byStage={byStage} />
        <BookToolbar options={OPTIONS} />
        <StageLegend />
      </>,
      { ...DEFAULT_PARAMS, stages: ["ve_vyrobe"] },
    );
    expect(html).toContain("Objednávky v běhu");
    expect(html).toContain("Po termínu");
    expect(html).toMatch(/524\s100\sKč/);
    expect(html).toContain("Poptávky &amp; nabídky");
    expect(html).toContain("Ve výrobě");
    expect(html).toContain("stages=ve_vyrobe"); // odkazy nesou aktuální výběr
    expect(html).toContain("Všichni obchodníci");
    expect(html).toContain("Jak číst barvy");
  });

  it("výroba, platba a domluvy v řádku i na kartě tabule", () => {
    const heat = job({
      id: "j3", stage: "ve_vyrobe", productionStep: "tepelne_zpracovani", productionLocation: "TepKal s.r.o.",
      productionDone: 1, productionTotal: 4, productionProblem: true, customerNote: "Balit po 10 ks do VCI.",
    });
    const late = job({ id: "j4", number: "Z-2026-110", stage: "fakturovano", invoiceNumber: "FV-9", invoiceDueDate: "2026-10-15" });
    const soon = job({ id: "j5", number: "Z-2026-111", stage: "fakturovano", invoiceDueDate: "2026-11-21" });
    const paid = job({ id: "j6", number: "Z-2026-112", stage: "dokonceno", paidAt: "2026-10-03", productionStep: "hotovo", productionDone: 2, productionTotal: 2 });
    const html = render(<JobRows jobs={[heat, late, soon, paid]} today="2026-10-22" />);
    expect(html).toContain('href="/orders/j3?tab=vyroba"');
    expect(html).toContain("Tepelné zpracování · TepKal s.r.o."); // mobil: celý název
    expect(html).toContain("Kalení · TepKal s.r.o."); // desktop: krátký
    expect(html).toContain("1/4");
    expect(html).toContain("problém");
    expect(html).toContain('aria-label="Domluvy se zákazníkem"');
    expect(html).toContain("po splatnosti");
    expect(html).toContain("Faktura FV-9 — 7 dní po splatnosti");
    expect(html).toContain("splatná 21. 11.");
    expect(html).toContain("zaplaceno");
    expect(html).toContain("Výroba hotová");
    const board = render(<JobBoard jobs={[heat]} stages={["ve_vyrobe"]} today="2026-10-22" />);
    expect(board).toContain("Kalení · TepKal s.r.o.");
    expect(board).toContain('aria-label="Domluvy se zákazníkem"');
  });

  it("filtry výroby a platby + dlaždice Po splatnosti", () => {
    const counts = { byStage, overdue: 0, dueThisWeek: 0, active: 13, total: 16 };
    const production = {
      steps: [{ key: "tepelne_zpracovani", label: "Tepelné zpracování", count: 3 }, { key: "hotovo", label: "Výroba hotová", count: 1 }],
      locations: [{ name: "TepKal s.r.o.", count: 2 }, { name: "U nás", count: 1 }],
    };
    const html = render(
      <>
        <KpiStrip kpis={bookKpis(counts)} runningValue={null} overdueInvoices={2} />
        <BookToolbar options={OPTIONS} production={production} />
      </>,
      { ...DEFAULT_PARAMS, step: "tepelne_zpracovani", payment: "po_splatnosti" },
    );
    expect(html).toContain("Po splatnosti");
    expect(html).toContain("faktury čekají na peníze");
    expect(html).toContain("payment=po_splatnosti");
    expect(html).toContain("Výroba: všechny operace");
    expect(html).toContain("Tepelné zpracování (3)");
    expect(html).toContain("Výroba hotová (1)");
    expect(html).toContain("Kde: kdekoli");
    expect(html).toContain("TepKal s.r.o. (2)");
    expect(html).toContain("Platba: vše");
    expect(html).toContain("Nezaplaceno");
    // bez dat výroby se filtry operace / místa neukazují
    const plain = render(<BookToolbar options={OPTIONS} />);
    expect(plain).not.toContain("Výroba: všechny operace");
    expect(plain).toContain("Platba: vše");
  });

  it("formulář: nákupní cena jen s právem na marže", () => {
    const init = { items: [{ drawingNumber: "VK-1", quantity: 2 }] };
    accessState.features = ["orders"];
    const plain = render(<JobForm options={OPTIONS} initial={init} onSubmit={() => {}} />);
    expect(plain).toContain("Č. výkresu");
    expect(plain).not.toContain("Nákup / MJ");
    expect(plain).toContain("Potvrzený termín zákazníkovi");
    accessState.features = ["orders", "margins"];
    const sales = render(<JobForm options={OPTIONS} initial={init} onSubmit={() => {}} />);
    expect(sales).toContain("Nákup / MJ");
  });
});
