import { describe, it, expect, vi } from "vitest";
import * as React from "react";
import { renderToString } from "react-dom/server";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn(), replace: vi.fn(), back: vi.fn(), prefetch: vi.fn() }),
  usePathname: () => "/orders/t1",
}));
vi.mock("@/app/actions/job-merge", () => ({ mergeJobs: vi.fn(), previewJobMerge: vi.fn(), searchMergeCandidates: vi.fn() }));
vi.mock("@/app/actions/jobs", () => ({ updateJob: vi.fn(), addJobComment: vi.fn() }));

import { MergePreviewBody, PickStep } from "./merge-job-dialog";
import { MergeBanner, MergedSourceBanner } from "./merge-banner";
import { mergedFromNumber } from "./history-tab";
import type { MergePreview } from "@/lib/jobs/job-merge-types";
import type { JobDetail } from "@/lib/jobs/types";

function preview(over: Partial<MergePreview> = {}): MergePreview {
  return {
    ok: true, needsForce: false, canForce: false,
    target: { id: "t1", number: "Z-2026-013", title: "F00N603W84 — objednávka", stage: "objednavka", customerId: "c1", customer: "Bosch Termotechnika", customerOrderNumber: "8000060875", value: 48000, createdAt: "2026-10-20T08:00:00Z" },
    source: { id: "s1", number: "Z-2026-014", title: "F00N603W84 — nabídka", stage: "nabidka", customerId: "c1", customer: "Bosch Termotechnika", customerOrderNumber: null, value: null, createdAt: "2026-10-20T08:01:00Z" },
    stage: { from: "objednavka", to: "objednavka", source: "nabidka" },
    acceptQuote: { id: "q1", number: "136/026" },
    counts: {
      items: 1, itemsMerged: 1, files: 2, filesDuplicate: 1, drawings: 0, quotes: 1, emails: 1, purchaseOrders: 0, supplierQuotes: 0,
      operations: 0, payments: 0, revisions: 0, handoffs: 0, events: 4, approvals: 0, anonQueue: 0, training: 0, invoices: 0,
      deliveryNotes: 0, documents: 0, captureSessions: 0,
    },
    fields: [
      { field: "due_date", label: "Potvrzený termín zákazníkovi", kind: "date", rule: "fill", target: null, source: "11. 12. 2026", result: "11. 12. 2026" },
      { field: "value", label: "Hodnota zakázky", kind: "num", rule: "keep", target: "48 000,00 Kč", source: "75 000,00 Kč", result: "48 000,00 Kč" },
    ],
    conflicts: [],
    ...over,
  };
}

const noop = () => {};

describe("Sloučit zakázky — dialog (render)", () => {
  it("náhled: co se přesune, kdo zůstane, stav, přijetí nabídky a vítězné hodnoty", () => {
    const html = renderToString(<MergePreviewBody preview={preview()} onSwap={noop} force={false} setForce={noop} reason="" setReason={noop} />);
    expect(html).toContain("Sloučí se (zruší se jako duplicita)");
    expect(html).toContain("Zůstane");
    expect(html).toContain("Z-2026-014");
    expect(html.replace(/<[^>]+>/g, "")).toContain("Do Z-2026-013 se přesune");
    expect(html).toContain("1 nabídka");
    expect(html).toContain("2 dokumenty");
    expect(html).toContain("1 e-mail");
    expect(html).toContain("položka se stejným výkresem (spojí se)");
    expect(html).toContain("136/026");
    expect(html).toContain("se označí jako přijatá");
    expect(html).toContain("doplní se");
    expect(html).toContain("zůstane");
    expect(html).toContain("<s>75 000,00 Kč</s>");
    expect(html).toContain("Prohodit směr");
    expect(html).not.toMatch(/sm:hidden[^>]*>Prohodit/);             // popisek i na desktopu
    expect(html).not.toContain("merge-conflict-block");
    expect(html).toContain('<span class="whitespace-nowrap">Z-2026-013</span>');   // číslo se nezalomí
  });

  it("„druhá je dál“ nad kartami, ostatní upozornění hned pod nimi (ne až na konci)", () => {
    const html = renderToString(<MergePreviewBody preview={preview({
      conflicts: [
        { code: "STAGE_ADVANCE", level: "info", message: "Zakázka Z-2026-013 je dál (Objednávka)" },
        { code: "QUOTE_PDF_ONLY", level: "warn", message: "Nabídka 136/026 je u Z-2026-014 jen jako PDF" },
      ],
    })} onSwap={noop} force={false} setForce={noop} reason="" setReason={noop} />);
    const adv = html.indexOf("je dál (Objednávka)");
    const cards = html.indexOf("merge-source");
    const pdf = html.indexOf("jen jako PDF");
    const moves = html.indexOf("se přesune");
    expect(adv).toBeGreaterThan(-1);
    expect(adv).toBeLessThan(cards);
    expect(pdf).toBeGreaterThan(cards);
    expect(pdf).toBeLessThan(moves);
  });

  it("blokace skryje přesun; konflikt „force“ nabídne super adminovi přebití s důvodem", () => {
    const blocked = renderToString(<MergePreviewBody preview={preview({ ok: false, conflicts: [{ code: "CLOSED", level: "block", message: "Zakázka Z-2026-014 je uzavřená" }] })} force={false} setForce={noop} reason="" setReason={noop} />);
    expect(blocked).toContain("merge-conflict-block");
    expect(blocked).toContain("je uzavřená");
    expect(blocked).not.toContain("se přesune");

    const forced = preview({ needsForce: true, canForce: true, conflicts: [{ code: "CUSTOMER_DIFFERENT", level: "force", message: "Různí zákazníci: A (IČO 1) a B (IČO 2)" }] });
    const admin = renderToString(<MergePreviewBody preview={forced} force={true} setForce={noop} reason="" setReason={noop} />);
    expect(admin).toContain("merge-conflict-force");
    expect(admin).toContain("Vím, co dělám");
    expect(admin).toContain("merge-reason");
    const sales = renderToString(<MergePreviewBody preview={{ ...forced, canForce: false }} force={false} setForce={noop} reason="" setReason={noop} />);
    expect(sales).toContain("sloučí jen super admin");
    expect(sales).not.toContain("Vím, co dělám");
  });

  it("výběr: návrhy po skupinách (stejný zákazník, stejný výkres) s čísly výkresů", () => {
    const job = { id: "t1", number: "Z-2026-013" } as JobDetail;
    const html = renderToString(<PickStep job={job} onPick={noop} initial={[
      { id: "s1", number: "Z-2026-014", title: "Nabídka", stage: "nabidka", customer: "Bosch", customerOrderNumber: null, drawingNumbers: ["F00N603W84"], createdAt: "2026-10-20T08:00:00Z", reason: "capture", reasons: ["capture", "drawing", "customer"] },
      { id: "s2", number: "Z-2026-010", title: "Jiný", stage: "poptavka", customer: "Bosch", customerOrderNumber: "PO-1", drawingNumbers: [], createdAt: "2026-10-01T08:00:00Z", reason: "customer", reasons: ["customer"] },
    ]} />);
    expect(html).toContain("Ze stejného focení");
    expect(html).toContain("Stejný zákazník");
    // všechny důvody jako čipy u kandidáta
    expect(html).toContain("stejné focení");
    expect(html).toContain("stejný výkres");
    expect(html).toContain("stejný zákazník");
    expect(html).toContain("Z-2026-014");
    expect(html).toContain("F00N603W84");
    expect(html).toContain("Číslo, zákazník, objednávka, výkres");
  });

  it("banner po přesměrování ze sloučené zakázky", () => {
    const html = renderToString(<MergeBanner sourceNumber="Z-2026-014" sourceId="s1" byName="Petr Obchodník" at="2026-10-24T08:00:00Z" summary="1 nabídka, 2 dokumenty" redirected
      warnings={[{ code: "QUOTE_WONT_ACCEPT", level: "warn", message: "Nabídka 136/026 čeká na schválení super adminem" }]} />);
    expect(html).toContain("Z-2026-014");
    expect(html).toContain("byla sloučena sem");
    expect(html).toContain("Petr Obchodník");
    expect(html).toContain("1 nabídka, 2 dokumenty");
    expect(html).toContain("merge-banner-warnings");
    expect(html).toContain("čeká na schválení super adminem");
    expect(html).toContain('href="/orders/s1?historie=1"');
    expect(html).toContain("Zobrazit původní zakázku");
  });

  it("původní (sloučená) zakázka: jen pro čtení, odkaz na cíl", () => {
    const html = renderToString(<MergedSourceBanner number="Z-2026-014" targetId="t1" targetNumber="Z-2026-013" byName="Petr Obchodník" at="2026-10-24T08:00:00Z" />);
    expect(html).toContain("merged-source-banner");
    expect(html).toContain("Jen pro čtení");
    expect(html).toContain('href="/orders/t1"');
    expect(html).toContain("Petr Obchodník");
  });

  it("historie: záznam přesunutý při sloučení nese, odkud je", () => {
    expect(mergedFromNumber({ data: { mergedFrom: { id: "s1", number: "Z-2026-014" } } })).toBe("Z-2026-014");
    expect(mergedFromNumber({ data: {} })).toBeNull();
    expect(mergedFromNumber({ data: { mergedFrom: "x" } })).toBeNull();
  });
});
