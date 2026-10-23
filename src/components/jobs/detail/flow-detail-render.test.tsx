import { describe, it, expect, vi } from "vitest";
import * as React from "react";
import { renderToString } from "react-dom/server";

// Karta zakázky s podrobnými stavy: jediné primární tlačítko (sloveso), řádek průběhu, autor stavu,
// Historie s autorem vždy (člověk / AI / systém / smazaný účet), dialog korekce s náhledem dopadu.
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn(), replace: vi.fn(), back: vi.fn(), prefetch: vi.fn() }),
  usePathname: () => "/orders/j1",
}));
// dialogy se v SSR testu vykreslí rovnou (bez portálu), ať jde číst jejich obsah
vi.mock("@/components/ui/dialog", () => ({
  Dialog: ({ open, children }: { open?: boolean; children: React.ReactNode }) => (open ? <div data-dialog>{children}</div> : null),
  DialogContent: ({ children }: { children: React.ReactNode }) => <div role="dialog">{children}</div>,
  DialogTitle: ({ children }: { children: React.ReactNode }) => <h2>{children}</h2>,
  DialogTrigger: ({ children }: { children: React.ReactNode }) => <>{children}</>,
  DialogPortal: ({ children }: { children: React.ReactNode }) => <>{children}</>,
  DialogOverlay: () => null,
}));
vi.mock("@/app/actions/jobs", () => ({
  updateJob: vi.fn(), setJobStage: vi.fn(), deleteJob: vi.fn(), saveJobItems: vi.fn(), addJobComment: vi.fn(),
  createJobQuote: vi.fn(), updateJobQuote: vi.fn(), approveJobQuote: vi.fn(), markJobQuoteSent: vi.fn(),
  acceptJobQuote: vi.fn(), rejectJobQuote: vi.fn(), newJobQuoteRevision: vi.fn(), setJobQuoteArchived: vi.fn(),
  deleteJobQuote: vi.fn(),
}));
vi.mock("@/app/actions/flow-status", () => ({
  takeInquiry: vi.fn(), setInquiryStatus: vi.fn(), setOrderStatus: vi.fn(), setQuoteState: vi.fn(), decideFlowProposal: vi.fn(),
  moveJobStage: vi.fn(), proposeFlowChange: vi.fn(), requestOrderFix: vi.fn(), registerOrderChange: vi.fn(),
  decideOrderChange: vi.fn(), setDeliveredQuantities: vi.fn(), closeItemDelivery: vi.fn(), recordPartialDelivery: vi.fn(),
  recordJobPayment: vi.fn(), deleteJobPayment: vi.fn(),
}));
vi.mock("@/app/actions/job-flow", () => ({ previewJobStage: vi.fn(async () => ({ ok: true, lines: [] })), extendQuoteValidity: vi.fn() }));
vi.mock("@/app/actions/job-files", () => ({
  setJobFileArchived: vi.fn(), updateJobFile: vi.fn(), deleteJobFile: vi.fn(), createJobFileUpload: vi.fn(), registerJobFile: vi.fn(),
}));
vi.mock("@/app/actions/job-documents", () => ({
  generateJobDocument: vi.fn(), sendJobDocument: vi.fn(), draftJobDocumentEmail: vi.fn(),
}));
vi.mock("@/app/actions/production", () => ({
  confirmDeliveryNote: vi.fn(), markJobPaid: vi.fn(), setInvoiceInfo: vi.fn(), unconfirmDeliveryNote: vi.fn(), unmarkJobPaid: vi.fn(),
  deleteJobOperation: vi.fn(), setCustomerNote: vi.fn(),
}));
vi.mock("@/lib/jobs/upload-client", () => ({ uploadJobFiles: vi.fn(), uploadJobFile: vi.fn() }));
vi.mock("@/components/jobs/capture/capture-button", () => ({
  CaptureButton: ({ label }: { label?: string }) => <button type="button">{label ?? "Vyfotit doklad"}</button>,
}));
vi.mock("@/components/access-provider", () => ({
  useAccess: () => ({ features: ["orders", "workflow", "margins", "documents"], role: "obchodnik", userId: "u1", can: () => true }),
}));

import { JobDetailView } from "./job-detail-view";
import { HistoryTab } from "./history-tab";
import { JobDetailProvider } from "./detail-context";
import { StageCorrectionDialog } from "@/components/jobs/stage-select";
import { DeliveryDialog } from "@/components/jobs/production/delivery-dialog";
import type { FlowFacts, JobStamps, QuoteFacts } from "@/lib/jobs/flow-status";
import type { JobDetail, JobEvent, JobFormOptions } from "@/lib/jobs/types";

const NOW = Date.now();
const ago = (min: number) => new Date(NOW - min * 60_000).toISOString();

function facts(p: Partial<FlowFacts> = {}): FlowFacts {
  return {
    stage: "objednavka", inquiryStatus: "zpracovana", orderStatus: "dorucena", orderRevision: 1, orderConfirmedRevision: null,
    confirmationIssuedRevision: null, confirmationSentRevision: null, itemsCount: 1, itemsPriced: 1, itemsDelivered: 0,
    itemsPartial: 0, lastDeliveryAt: null, partialDeliveryAt: null, productionDone: 0, productionTotal: 0,
    deliveryNoteConfirmedAt: null, invoiceNumber: null, invoiceDueDate: null, paidAt: null, paidSoFar: 0,
    waitingSince: null, orderStatusChangedAt: null, pendingSupplierQuotes: 0, lostReason: null, proposal: null,
    hasOperations: false, hasPurchaseOrders: false, ...p,
  };
}

const QF: QuoteFacts = {
  id: "q1", number: "NAB-2026-031", revision: 2, status: "odeslano", state: "odeslana", approvedBy: null, approvalRequired: false,
  createdBy: "u1", archived: false, sentAt: ago(3000), validUntil: "2099-01-01", aiGenerated: false, supersededBy: null,
};

const STAMPS: JobStamps = {
  stage: { by: { id: "u1", name: "Petr Obchodník" }, byName: "Petr Obchodník", at: ago(5), via: "rucne", kind: "user" },
  inquiry: null, order: { by: { id: "u1", name: "Petr Obchodník" }, byName: null, at: ago(5), via: "rucne", kind: "user" },
  confirmed: null, confirmationSent: null, deliveryNote: null, invoiced: null, paid: null, lost: null, proposal: null,
  stageHistory: { poptavka: { by: { id: "u2", name: "Jana Admin" }, byName: null, at: ago(9000), via: "rucne", kind: "user" } },
};

function detail(over: Partial<JobDetail> = {}): JobDetail {
  return {
    id: "j1", number: "Z-2026-104", title: "Příruby AL", stage: "objednavka", priority: "stredni",
    customer: { id: "c1", name: "Strojmetal a.s.", customerNumber: null, ico: null }, customerOrderNumber: "PO-1",
    customerInquiryNumber: null, drawingNumbers: [], itemCount: 1, totalQuantity: 10, value: 10_000, purchaseCost: null,
    currency: "CZK", inquiryDate: "2026-10-01", orderDate: "2026-10-10", customerRequiredDate: null, dueDate: null,
    expectedDeliveryDate: null, supplierPromisedDate: null, maxToleratedDate: null, receivedAt: null, deliveredAt: null,
    owner: { id: "u1", name: "Petr Obchodník" }, assignee: null, createdBy: null, supplier: null, quoteCount: 1, fileCount: 0,
    aiFilled: false, source: "manual", createdAt: "2026-10-01T08:00:00Z", updatedAt: "2026-10-10T08:00:00Z", stageChangedAt: ago(5),
    note: null, tags: [], technology: null, manufacturingLocation: null, specificRequirements: null, deliveryMethod: null,
    supplierOrderNumber: null, invoiceNumber: null, deliveryNoteNumber: null, customerContact: null, customerContactEmail: null,
    customerContactPhone: null, pricedBy: null, approvedBy: null, approvedAt: null, confirmedAt: null, productionStartedAt: null,
    shippedAt: null, invoicedAt: null, emailId: null, aiConfidence: null, acceptedQuoteId: null, margin: null, customerDetail: null,
    items: [{ id: "i1", position: 0, drawingNumber: "PR-1", revision: null, name: "Příruba", description: null, material: null, quantity: 10, unit: "ks", unitPrice: 1000, purchaseUnitPrice: null, note: null, deliveredQuantity: 4, deliveryClosed: false }],
    quotes: [], files: [], events: [],
    flow: facts(), flowQuotes: [QF], stamps: STAMPS,
    ...over,
  };
}

const options: JobFormOptions = { users: [{ id: "u1", name: "Petr Obchodník", role: "obchodnik" }], customers: [], suppliers: [] };
const PERMS = { canDelete: false, margins: true, aiCapture: false };
const ACCESS = { features: ["orders", "workflow", "margins", "documents"] as never[], userId: "u1", role: "obchodnik" as const };

function render(node: React.ReactNode): string {
  return renderToString(node).replace(/<!-- -->/g, "");
}

/** Jen text (razítko: jméno a čas jsou zvlášť — zkracuje se jméno, nikdy čas). */
const flat = (h: string) => h.replace(/<[^>]+>/g, "");

describe("karta zakázky — podrobné stavy a autor", () => {
  it("jediné primární tlačítko je sloveso dalšího kroku; „Posunout“ zmizelo; stav nese autora", () => {
    const html = render(<JobDetailView job={detail()} options={options} perms={PERMS} flow={{ stamps: STAMPS, access: ACCESS }} />);
    expect(html).not.toContain("Posunout:");
    expect(html.match(/>Potvrdit objednávku</g)?.length).toBe(1);
    expect(html).toContain("Akce se stavem");
    expect(html).not.toContain("Další akce se stavem");
    expect(flat(html)).toContain("Petr Obchodník · před 5 min");
    expect(html).toContain("Korekce stavu…");
  });

  it("řádek průběhu: hotové fáze s autorem, aktuální s chipem, budoucí ztlumené", () => {
    const html = render(<JobDetailView job={detail()} options={options} perms={PERMS} flow={{ stamps: STAMPS, access: ACCESS }} />);
    expect(html).toContain('aria-label="Průběh obchodu"');
    expect(html).toMatch(/Poptávka<span class="sr-only"> — hotovo/);
    expect(html).toContain("J. Admin");
    expect(html).toContain("Doručená");
    expect(html).toContain("border-dashed opacity-60");
  });

  it("automatický posun: „⚙ Automaticky (výroba začala)“ + kdo ho spustil", () => {
    const auto: JobStamps = { ...STAMPS, stage: { by: { id: "u1", name: "Petr Obchodník" }, byName: null, at: ago(2), via: "automaticky", kind: "user", cause: "vyroba" } };
    const html = render(<JobDetailView job={detail({ stage: "ve_vyrobe", flow: facts({ stage: "ve_vyrobe", orderStatus: "potvrzena" }) })} options={options} perms={PERMS} flow={{ stamps: auto, access: ACCESS }} />);
    expect(flat(html)).toContain("⚙ Automaticky (výroba začala) · Petr Obchodník · před 2 min");
  });

  it("zaměstnanec bez práva: rozpracovanou nabídku (super admina) neodesílá ani nepředává (#25)", () => {
    const worker = { features: ["orders", "workflow"] as never[], userId: "u2", role: "zamestnanec" as const };
    const draft = { ...QF, status: "navrh_ai" as const, state: "rozpracovana" as const, sentAt: null };
    const html = render(
      <JobDetailView
        job={detail({ stage: "naceneni", flow: facts({ stage: "naceneni", inquiryStatus: "v_reseni", orderStatus: null, orderRevision: 0 }), flowQuotes: [draft] })}
        options={options}
        perms={{ ...PERMS, margins: false }}
        flow={{ access: worker }}
      />,
    );
    // #25: „Předat ke schválení“ zaniklo (nabídky ne-adminů čekají na super admina samy)
    expect(html).not.toContain(">Předat ke schválení<");
    expect(html).not.toContain(">Odeslat nabídku<");
  });
});

describe("Historie — autor nikdy prázdný", () => {
  const ev = (id: string, p: Partial<JobEvent>): JobEvent => ({ id, type: "field", message: "Zpráva", data: {}, actor: null, createdAt: ago(10), ...p });
  it("člověk, AI bez uživatele, plánovač, přímý zápis, smazaný účet; dílčí stav jako chipy", () => {
    const events: JobEvent[] = [
      ev("1", { type: "stage", data: { from: "objednavka", to: "potvrzeno" }, actor: { id: "u1", name: "Petr Obchodník" }, actorKind: "user" }),
      ev("2", { type: "status", message: "Poptávka: Přijatá → V řešení", data: { field: "inquiry_status", from: "prijata", to: "v_reseni" }, entity: "inquiry", actorKind: "ai", agent: "email-ingest" }),
      ev("3", { actorKind: "system", via: "cron", message: "Upomínka" }),
      ev("4", { actorKind: "system", via: "db", message: "Import" }),
      ev("5", { actorName: "Karel Starý", actorKind: "user", message: "Stará změna" }),
      ev("6", { type: "stage", data: { from: "potvrzeno", to: "ve_vyrobe", auto: true, cause: "vyroba" }, actor: { id: "u1", name: "Petr Obchodník" }, actorKind: "user", via: "automaticky" }),
    ];
    const html = render(<JobDetailProvider jobId="j1" perms={PERMS} options={options}><HistoryTab events={events} /></JobDetailProvider>);
    expect(html).toContain("Petr Obchodník");
    expect(html).toContain("✨ AI (e-mail)");
    expect(html).toContain("Systém (plánovač)");
    expect(html).toContain("Systém · před evidencí");
    expect(html).toContain("Karel Starý (účet zrušen)");
    expect(html).toContain("⚙ Automaticky (výroba začala)");
    expect(html).toContain("Přijatá");
    expect(html).toContain("V řešení");
    expect(html).toContain('aria-label="Fáze"');
    expect(html).toContain("Kdokoli");
    expect(html).not.toContain(">Systém<");
  });
});

describe("dialogy — korekce s náhledem dopadu, dodání po položkách", () => {
  it("korekce do Nerealizováno: povinný důvod a dopad na nabídky", () => {
    const html = render(
      <StageCorrectionDialog open onOpenChange={() => {}} jobId="j1" from="nabidka" to="nerealizovano"
        flow={facts({ stage: "nabidka", orderStatus: null, orderRevision: 0 })} quotes={[QF]} />,
    );
    expect(html).toContain("Korekce stavu: Nabídka odeslaná → Nerealizováno");
    expect(html).toContain("Nabídka NAB-2026-031 r2 → Zamítnutá");
    expect(html).toContain('role="radiogroup"');
    expect(html).toContain("Cena");
    expect(html).toContain("Uzavřít: Nerealizováno");
  });

  it("korekce dopředu bez dokladu: bez důvodu, varování „Objednáno bez přijaté nabídky“ jen bez jediné odeslané", () => {
    const html = render(
      <StageCorrectionDialog open onOpenChange={() => {}} jobId="j1" from="nabidka" to="objednavka"
        flow={facts({ stage: "nabidka", orderStatus: null, orderRevision: 0 })} quotes={[QF]} />,
    );
    expect(html).toContain("Nabídka NAB-2026-031 r2 → Přijatá");
    expect(html).not.toContain('role="radiogroup"');
    expect(html).toContain("Změnit na Objednávka");
  });

  it("dodání: „1/2 položek“ po položkách, u každé dodáno / objednáno", () => {
    const items = [
      { id: "a", drawingNumber: "PR-1", name: "Příruba", description: null, quantity: 200, unit: "ks", deliveredQuantity: 200, deliveryClosed: false },
      { id: "b", drawingNumber: "PR-2", name: "Víko", description: null, quantity: 50, unit: "ks", deliveredQuantity: 10, deliveryClosed: false },
    ];
    const html = render(<DeliveryDialog open onOpenChange={() => {}} jobId="j1" items={items} />);
    expect(html).toContain("1/2 položek");
    expect(html).toContain("objednáno 50 ks · dodáno 10");
    expect(html).not.toContain("250");
    expect(html).toContain("Uzavřít s menším množstvím");
  });
});
