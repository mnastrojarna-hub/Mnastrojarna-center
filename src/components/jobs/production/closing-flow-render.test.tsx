import { describe, it, expect, vi } from "vitest";
import * as React from "react";
import { renderToString } from "react-dom/server";

// A2 (beta 29. 10.): konec toku — karta „Dodání, faktura a platba", Doklady ▾ a dialog odeslání faktury.
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn(), replace: vi.fn(), back: vi.fn(), prefetch: vi.fn() }),
  usePathname: () => "/orders/j1",
}));
// dialogy se v SSR vykreslí rovnou (bez portálu), ať jde číst jejich obsah
vi.mock("@/components/ui/dialog", () => ({
  Dialog: ({ open, children }: { open?: boolean; children: React.ReactNode }) => (open ? <div data-dialog>{children}</div> : null),
  DialogContent: ({ children }: { children: React.ReactNode }) => <div role="dialog">{children}</div>,
  DialogTitle: ({ children }: { children: React.ReactNode }) => <h2>{children}</h2>,
  DialogTrigger: ({ children }: { children: React.ReactNode }) => <>{children}</>,
  DialogPortal: ({ children }: { children: React.ReactNode }) => <>{children}</>,
  DialogOverlay: () => null,
}));
// menu Doklady ▾ otevřené (obsah se dá číst)
vi.mock("@/components/ui/dropdown-menu", () => ({
  DropdownMenu: ({ children }: { children: React.ReactNode }) => <div data-menu>{children}</div>,
  DropdownMenuTrigger: ({ children }: { children: React.ReactNode }) => <>{children}</>,
  DropdownMenuContent: ({ children }: { children: React.ReactNode }) => <div role="menu">{children}</div>,
  DropdownMenuItem: ({ children, asChild }: { children: React.ReactNode; asChild?: boolean }) => (asChild ? <>{children}</> : <div role="menuitem">{children}</div>),
  DropdownMenuLabel: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  DropdownMenuSeparator: () => <hr />,
}));
vi.mock("@/app/actions/flow-status", () => ({
  takeInquiry: vi.fn(), setInquiryStatus: vi.fn(), setOrderStatus: vi.fn(), setQuoteState: vi.fn(), decideFlowProposal: vi.fn(),
  moveJobStage: vi.fn(), proposeFlowChange: vi.fn(), requestOrderFix: vi.fn(), registerOrderChange: vi.fn(),
  decideOrderChange: vi.fn(), recordJobPayment: vi.fn(), deleteJobPayment: vi.fn(),
}));
vi.mock("@/app/actions/job-flow", () => ({ previewJobStage: vi.fn(), extendQuoteValidity: vi.fn() }));
vi.mock("@/app/actions/job-documents", () => ({ generateJobDocument: vi.fn(), sendJobDocument: vi.fn(), draftJobDocumentEmail: vi.fn(), draftInvoiceEmail: vi.fn() }));
vi.mock("@/app/actions/production", () => ({ confirmDeliveryNote: vi.fn(), setInvoiceInfo: vi.fn(), unconfirmDeliveryNote: vi.fn() }));
vi.mock("@/app/actions/delivery-notes", () => ({ recordDelivery: vi.fn(), listDeliveryNotes: vi.fn() }));
vi.mock("@/lib/jobs/upload-client", () => ({ uploadJobFiles: vi.fn(), uploadJobFile: vi.fn() }));
vi.mock("@/components/access-provider", () => ({
  useAccess: () => ({ features: ["orders", "workflow", "margins", "documents"], role: "obchodnik", userId: "u1", can: () => true }),
}));

import { JobDetailProvider } from "@/components/jobs/detail/detail-context";
import { FlowActionsProvider, type FlowAccess } from "@/components/jobs/detail/flow-actions";
import { DocumentsMenu } from "@/components/jobs/detail/documents-menu";
import { ClosingCard } from "./closing-card";
import { DeliveryCard } from "./delivery-card";
import { InvoiceDialog } from "./invoice-dialog";
import { PaymentDialog } from "./payment-dialog";
import type { FlowFacts } from "@/lib/jobs/flow-status";
import type { JobClosingInfo } from "@/lib/jobs/production-types";
import type { JobDetail, JobFile, JobFormOptions } from "@/lib/jobs/types";
import type { JobPayment } from "@/lib/data/flow-status";

function facts(p: Partial<FlowFacts> = {}): FlowFacts {
  return {
    stage: "dodano_zakaznikovi", inquiryStatus: "zpracovana", orderStatus: "potvrzena", orderRevision: 1, orderConfirmedRevision: 1,
    confirmationIssuedRevision: 1, confirmationSentRevision: 1, itemsCount: 1, itemsPriced: 1, itemsDelivered: 1, itemsPartial: 0,
    lastDeliveryAt: "2026-10-28T08:00:00Z", partialDeliveryAt: null, productionDone: 0, productionTotal: 0, deliveryNoteConfirmedAt: null,
    invoiceNumber: null, invoiceDueDate: null, paidAt: null, paidSoFar: 0, waitingSince: null, orderStatusChangedAt: null,
    pendingSupplierQuotes: 0, lostReason: null, proposal: null, hasOperations: false, hasPurchaseOrders: false, ...p,
  };
}

const dlFile = (over: Partial<JobFile> = {}): JobFile => ({
  id: "dl1", kind: "dodaci_list", title: "Dodací list DL-2026-071 · dodávka", filename: "Dodaci_list_DL-2026-071.pdf",
  mimeType: "application/pdf", sizeBytes: 1, version: 1, archived: false, replacedBy: null, quoteId: null, uploadedBy: null,
  createdAt: "2026-10-28T08:00:00Z", aiConfidence: null, note: null, hasAiData: false, origin: "generated", issuer: "my", ...over,
} as JobFile);

function job(over: Partial<JobDetail> = {}): JobDetail {
  const stage = (over.stage ?? "dodano_zakaznikovi") as JobDetail["stage"];
  return {
    id: "j1", number: "Z-2026-120", title: "Příruby", stage, priority: "stredni",
    customer: { id: "c1", name: "Strojmetal a.s.", customerNumber: null, ico: null }, customerOrderNumber: "PO-1",
    customerInquiryNumber: null, drawingNumbers: [], itemCount: 1, totalQuantity: 10, value: 10_000, purchaseCost: null,
    currency: "CZK", inquiryDate: null, orderDate: null, customerRequiredDate: null, dueDate: null, expectedDeliveryDate: null,
    supplierPromisedDate: null, maxToleratedDate: null, receivedAt: null, deliveredAt: null, owner: { id: "u1", name: "Petr Obchodník" },
    assignee: null, createdBy: null, supplier: null, quoteCount: 0, fileCount: 1, aiFilled: false, source: "manual",
    createdAt: "2026-10-01T08:00:00Z", updatedAt: "2026-10-28T08:00:00Z", stageChangedAt: null, note: null, tags: [],
    technology: null, manufacturingLocation: null, specificRequirements: null, deliveryMethod: null, supplierOrderNumber: null,
    invoiceNumber: null, deliveryNoteNumber: "DL-2026-071", customerContact: null, customerContactEmail: null, customerContactPhone: null,
    pricedBy: null, approvedBy: null, approvedAt: null, confirmedAt: null, productionStartedAt: null, shippedAt: null, invoicedAt: null,
    emailId: null, aiConfidence: null, acceptedQuoteId: null, margin: null, customerDetail: null,
    items: [{ id: "i1", position: 0, drawingNumber: "PR-1", revision: null, name: "Příruba", description: null, material: null, quantity: 10, unit: "ks", unitPrice: 1000, purchaseUnitPrice: null, note: null, deliveredQuantity: 10, deliveryClosed: false }],
    quotes: [], files: [dlFile()], events: [], flow: facts({ stage }), flowQuotes: [], stamps: null,
    ...over,
  } as JobDetail;
}

function closing(over: Partial<JobClosingInfo> = {}): JobClosingInfo {
  return {
    jobId: "j1", stage: "dodano_zakaznikovi", customerNote: null, deliveryNoteConfirmedAt: null, deliveryNoteNumber: "DL-2026-071",
    invoiceNumber: null, invoiceDate: null, invoiceDueDate: null, paymentTermsDays: 30, paidAt: null, paidAmount: null,
    overdueInvoice: false, daysToDue: null, ...over,
  };
}

const options: JobFormOptions = { users: [], customers: [], suppliers: [] };
const SALES: FlowAccess = { features: ["orders", "workflow", "margins", "documents"] as never[], userId: "u1", role: "obchodnik" };
const WORKER: FlowAccess = { features: ["orders", "workflow", "documents"] as never[], userId: "u2", role: "zamestnanec" };

function render(j: JobDetail, node: React.ReactNode, access: FlowAccess = SALES, initialAction?: string): string {
  const margins = access.features.includes("margins" as never);
  return renderToString(
    <JobDetailProvider jobId={j.id} perms={{ canDelete: false, margins, aiCapture: false }} options={options}>
      <FlowActionsProvider job={j} stamps={null} access={access} setTab={() => {}} initialAction={initialAction ?? null}>
        {node}
      </FlowActionsProvider>
    </JobDetailProvider>,
  ).replace(/<!-- -->/g, "");
}
const text = (h: string) => h.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ");

describe("karta „Dodání, faktura a platba“ (A2)", () => {
  it("po dodání (DL vystaven, nepotvrzen): krok DL hotový s číslem DL, faktura na řadě — potvrzený DL je nepovinný", () => {
    const j = job();
    const html = render(j, <ClosingCard job={j} closing={closing()} margins />);
    const t = text(html);
    expect(t).toContain("Dodáno — DL-2026-071");
    expect(t).toContain("Potvrzený DL od zákazníka · nepovinné");
    expect(t).toContain("Nahrát potvrzený DL");
    expect(t).toContain("Potvrdit bez souboru");
    // hlavní tlačítko „Vystavit fakturu" je v hlavičce → karta na něj jen odkáže (žádné druhé stejné tlačítko)
    expect(t).toContain("Fakturu vystavíš tlačítkem Vystavit fakturu nahoře");
    expect(html).not.toContain("Zapsat fakturu");
    expect(html).not.toContain("Uložit fakturu");
    expect(t).toMatch(/1\s*\/3/);
  });

  // beta 30. 10.: čísla DL z delivery_notes (jediný zdroj), ne z názvů souborů; DL bez PDF = číslo bez odkazu
  it("čísla dodacích listů z delivery_notes, ne z názvu souboru", () => {
    const j = job({
      files: [dlFile({ filename: "Dodaci_list_PREJMENOVANO.pdf", title: "Dodací list (přejmenováno)" })],
      deliveryNotes: [
        { id: "dl1", number: "DL-2026-071", createdAt: "2026-10-28T08:00:00Z" },
        { id: null, number: "DL-2026-065", createdAt: "2026-10-20T08:00:00Z" },
      ],
    });
    const html = render(j, <ClosingCard job={j} closing={closing()} margins />);
    const t = text(html);
    expect(t).toContain("Dodáno — DL-2026-071 DL-2026-065");
    expect(t).not.toContain("PREJMENOVANO");
    expect(html).toContain('href="/api/jobs/files/dl1"');
    expect((html.match(/\/api\/jobs\/files\//g) ?? []).length).toBe(1);
  });

  // review A2 #4: „dílčí" faktura účtovala celou objednávku → při dílčí dodávce se faktura z aplikace nenabízí
  it("dílčí dodávka: faktura až po dodání všeho (žádné „Vystavit fakturu (dílčí)“), záloha jde", () => {
    const j = job({
      stage: "ve_vyrobe",
      items: [
        { id: "i1", position: 0, drawingNumber: "PR-1", revision: null, name: "Příruba", description: null, material: null, quantity: 10, unit: "ks", unitPrice: 1000, purchaseUnitPrice: null, note: null, deliveredQuantity: 10, deliveryClosed: false },
        { id: "i2", position: 1, drawingNumber: "PR-2", revision: null, name: "Kroužek", description: null, material: null, quantity: 5, unit: "ks", unitPrice: 100, purchaseUnitPrice: null, note: null, deliveredQuantity: 0, deliveryClosed: false },
      ],
      flow: facts({ stage: "ve_vyrobe", itemsCount: 2, itemsDelivered: 1 }),
    });
    const html = render(j, <ClosingCard job={j} closing={closing({ stage: "ve_vyrobe" })} margins />);
    expect(text(html)).not.toContain("Vystavit fakturu");
    expect(text(html)).toContain("Fakturu vystavíš, až bude dodáno vše");
    expect(text(html)).toContain("Dodáno částečně");
    // review A2 #8: záloha / dílčí platba před fakturou (tentýž dialog)
    expect(text(html)).toContain("Zadat platbu");
  });

  it("vyfakturováno: přehled (číslo, PDF, splatnost, Upravit splatnost) a JEDNO „Zadat platbu“; žádné „Označit zaplaceno“", () => {
    const fv = { ...dlFile(), id: "fv1", kind: "faktura", title: "Faktura FV-2026-042", filename: "Faktura_FV-2026-042.pdf" } as JobFile;
    const j = job({ stage: "fakturovano", invoiceNumber: "FV-2026-042", files: [dlFile(), fv], flow: facts({ stage: "fakturovano", invoiceNumber: "FV-2026-042", invoiceDueDate: "2026-11-27" }) });
    const html = render(j, <ClosingCard job={j} closing={closing({ stage: "fakturovano", invoiceNumber: "FV-2026-042", invoiceDate: "2026-10-28", invoiceDueDate: "2026-11-27", daysToDue: 28 })} margins />);
    const t = text(html);
    expect(t).toContain("FV-2026-042");
    expect(html).toContain('href="/api/jobs/files/fv1"');
    expect(t).toContain("splatnost 27. 11. 2026");
    expect(t).toContain("Upravit splatnost");
    expect(html.match(/>\s*Zadat platbu\s*</g)?.length ?? (t.match(/Zadat platbu/g) ?? []).length).toBe(1);
    expect(t).not.toMatch(/Označit zaplaceno|Zadat částečnou platbu|Zrušit úhradu/);
    expect(t).toMatch(/2\s*\/3/);
  });

  it("zálohy: každá úhrada má „Odebrat“ (žádné hromadné zrušení), součet z hodnoty", () => {
    const pays: JobPayment[] = [
      { id: "p1", paidOn: "2026-10-10", amount: 3000, settles: false, whole: false, stamp: null } as unknown as JobPayment,
    ];
    const j = job({ stage: "fakturovano", invoiceNumber: "FV-1", flow: facts({ stage: "fakturovano", invoiceNumber: "FV-1", paidSoFar: 3000 }) });
    const html = render(j, <ClosingCard job={j} closing={closing({ stage: "fakturovano", invoiceNumber: "FV-1", invoiceDate: "2026-10-28" })} margins payments={pays} />);
    const t = text(html);
    expect(t).toContain("Odebrat");
    expect(t).toMatch(/3\s000\sKč z 10\s000\sKč/);
    expect(t).not.toContain("Zrušit úhradu");
  });

  // review A2 #9: zaměstnanec PDF naší faktury z karty neotevře (jako Přehled a Dokumenty)
  it("zaměstnanec u vyfakturované zakázky: číslo ano, odkaz na PDF faktury ne", () => {
    const fv = { ...dlFile(), id: "fv1", kind: "faktura", title: "Faktura FV-2026-042", filename: "Faktura_FV-2026-042.pdf" } as JobFile;
    const j = job({ stage: "fakturovano", invoiceNumber: "FV-2026-042", files: [dlFile(), fv], flow: facts({ stage: "fakturovano", invoiceNumber: "FV-2026-042" }) });
    const html = render(j, <ClosingCard job={j} closing={closing({ stage: "fakturovano", invoiceNumber: "FV-2026-042", invoiceDate: "2026-10-28" })} margins={false} />, WORKER);
    expect(text(html)).toContain("FV-2026-042");
    expect(html).not.toContain('href="/api/jobs/files/fv1"');
    expect(text(html)).not.toContain("vystavená mimo systém");
  });

  // review A2 #12: po faktuře je nepovinný potvrzený DL jen malý odkaz (ne velký blok na mobilu)
  it("po faktuře: potvrzený DL jen jako odkaz „Nahrát potvrzený DL (nepovinné)“", () => {
    const j = job({ stage: "dokonceno", invoiceNumber: "FV-1", flow: facts({ stage: "dokonceno", invoiceNumber: "FV-1", paidAt: "2026-11-01" }) });
    const t = text(render(j, <ClosingCard job={j} closing={closing({ stage: "dokonceno", invoiceNumber: "FV-1", invoiceDate: "2026-10-28", paidAt: "2026-11-01" })} margins />));
    expect(t).toContain("Nahrát potvrzený DL (nepovinné)");
    expect(t).not.toContain("Potvrdit bez souboru");
    expect(t).not.toContain("Převzato dne");
  });

  it("zaměstnanec: o faktuře a úhradách jen věta, žádná tlačítka financí", () => {
    const j = job();
    const html = render(j, <ClosingCard job={j} closing={closing()} margins={false} />, WORKER);
    const t = text(html);
    expect(t).toContain("Fakturu a úhrady zapisuje obchodník nebo admin.");
    expect(t).not.toMatch(/Vystavit fakturu|Zadat platbu/);
    expect(t).toContain("Potvrdit bez souboru"); // potvrzený DL smí
  });
});

describe("Doklady ▾ (A2)", () => {
  const menu = (j: JobDetail, access: FlowAccess = SALES) =>
    text(render(j, <DocumentsMenu quotes={[]} acceptedQuoteId={null} items={j.items} files={j.files} documented={j.deliveryDocumented} invoiceNumber={j.invoiceNumber} />, access));

  it("Faktura = tentýž dialog „Vystavit fakturu“ (s QR + poslat); vystavená → Otevřít / Poslat znovu", () => {
    expect(menu(job())).toContain("Faktura vystavit s QR platbou a poslat");
    const fv = { ...dlFile(), id: "fv1", kind: "faktura", title: "Faktura FV-2026-042", filename: "Faktura_FV-2026-042.pdf" } as JobFile;
    const t = menu(job({ invoiceNumber: "FV-2026-042", files: [dlFile(), fv] }));
    expect(t).toContain("Faktura FV-2026-042 otevřít PDF");
    expect(t).toContain("Poslat fakturu znovu");
    expect(t).not.toContain("vystavit s QR platbou");
  });

  it("v poptávce / nabídce a bez práva na faktury položka Faktura není", () => {
    expect(menu(job({ stage: "nabidka", flow: facts({ stage: "nabidka", orderStatus: null }), files: [], items: [] }))).not.toContain("Faktura");
    expect(menu(job(), WORKER)).not.toContain("Faktura");
  });

  // review A2 #2/#4: faktura v Doklady ▾ jen když ji karta nabízí (dodáno vše); mimo systém = jen číslo
  it("nic / část dodáno → Faktura není; faktura mimo systém → jen číslo, bez vystavení", () => {
    const none = job({ stage: "ve_vyrobe", items: [{ ...job().items[0], deliveredQuantity: 0 }], files: [], flow: facts({ stage: "ve_vyrobe", itemsDelivered: 0 }) });
    expect(menu(none)).not.toContain("Faktura");
    const part = job({
      stage: "ve_vyrobe",
      items: [job().items[0], { ...job().items[0], id: "i2", deliveredQuantity: 0 }],
      flow: facts({ stage: "ve_vyrobe", itemsCount: 2, itemsDelivered: 1 }),
    });
    expect(menu(part)).not.toContain("Faktura");
    const ext = menu(job({ invoiceNumber: "2026-0142", flow: facts({ invoiceNumber: "2026-0142" }) }));
    expect(ext).toContain("Faktura 2026-0142 vystavená mimo systém");
    expect(ext).not.toContain("vystavit s QR platbou");
  });

  it("dodací list: bez dodávky → zápis dodání; dodáno bez DL i u zakázky s DL → „DL na dodané zboží“", () => {
    const none = job({ stage: "potvrzeno", files: [], deliveryNoteNumber: null, items: [{ ...job().items[0], deliveredQuantity: 0 }], flow: facts({ stage: "potvrzeno", itemsDelivered: 0 }) });
    expect(menu(none)).toContain("Dodací list zapíše dodání a vystaví DL");
    // DL pokrývá 6 z 10 dodaných → zbytek 4 ks bez DL
    expect(menu(job({ deliveryDocumented: { i1: 6 } }))).toContain("DL na dodané zboží");
    expect(menu(job({ deliveryDocumented: { i1: 10 } }))).not.toContain("DL na dodané zboží");
  });
});

describe("dialog „Vystavit fakturu“ = dialog odeslání jako u nabídky (A2, sk. 9)", () => {
  // review A2 #5: otevření ani „Zrušit" nic nevystaví — faktura vznikne až tlačítkem
  it("nová faktura: nadpis, jen návrh e-mailu (nic se nevystaví), „Vystavit a odeslat“; poslat znovu: stejné PDF", () => {
    const j = job();
    const fresh = text(render(j, <InvoiceDialog open jobId="j1" onOpenChange={() => {}} onDone={() => {}} />));
    expect(fresh).toContain("Vystavit fakturu a poslat zákazníkovi");
    expect(fresh).toContain("„Zrušit“ nic nevystaví");
    expect(fresh).toContain("Připravuji návrh e-mailu…");
    expect(fresh).not.toContain("Připravuji PDF faktury");
    expect(fresh).toContain("Vystavit a odeslat");
    const again = text(render(j, <InvoiceDialog open jobId="j1" existing={{ fileId: "fv1", filename: "Faktura_FV-1.pdf", number: "FV-1" }} onOpenChange={() => {}} onDone={() => {}} />));
    expect(again).toContain("Poslat fakturu FV-1 zákazníkovi");
    expect(again).toContain("Pošle se stejné PDF faktury");
    expect(again).not.toContain("neposílat");
    expect(again).toContain("Odeslat fakturu");
  });

  it("odkaz ?akce=payment.invoice otevře tentýž dialog (karta z /documents, z Knihy, z tabule)", () => {
    const j = job();
    const t = text(render(j, <span>karta</span>, SALES, "payment.invoice"));
    // efekt ?akce= běží až v prohlížeči — SSR jen nesmí spadnout; dialog se otevírá klíčem FLOW_ACTIONS
    expect(t).toContain("karta");
  });

  // review A2 #10: na Technologii jen JEDNO tlačítko „Zapsat dodání a dodací list" — v kartě Dodání (plán sk. 2:
  // karta je ve výrobě hlavní cesta k DL); souhrn výroby na kartu jen odkáže (kotva #dodani-zakaznikovi)
  it("Ve výrobě s běžícím krokem: tlačítko DL v kartě Dodání (s kotvou); jen když ho neukazuje hlavička", () => {
    const running = job({
      stage: "ve_vyrobe", items: [{ ...job().items[0], deliveredQuantity: 0 }],
      flow: facts({ stage: "ve_vyrobe", itemsDelivered: 0, productionTotal: 2, productionDone: 0, productionStep: "vyroba", productionLocation: "U nás", productionDue: "2026-11-01" }),
    });
    const html = render(running, <DeliveryCard job={running} />);
    expect(html).toContain('id="dodani-zakaznikovi"');
    expect(text(html)).toContain("Zapsat dodání a dodací list");
    expect(text(html)).not.toContain("Dodání zapíšeš tlačítkem");
    // hotová výroba → hlavička „Zapsat dodání a dodací list" → karta jen odkáže nahoru
    const done = job({
      stage: "ve_vyrobe", items: [{ ...job().items[0], deliveredQuantity: 0 }],
      flow: facts({ stage: "ve_vyrobe", itemsDelivered: 0, productionTotal: 2, productionDone: 2, productionStep: "hotovo", productionLocation: "U nás", productionDue: "2026-11-01" }),
    });
    expect(text(render(done, <DeliveryCard job={done} />))).toContain("Dodání zapíšeš tlačítkem Zapsat dodání a dodací list nahoře");
  });

  it("platba: „Doplatit zbytek“ jako rychlá volba v tomtéž dialogu", () => {
    const t = text(render(job(), <PaymentDialog open jobId="j1" margins value={10_000} paidSoFar={3_000} onOpenChange={() => {}} />));
    expect(t).toMatch(/Doplatit zbytek 7\s000\sKč/);
    expect(t).toContain("Vyrovnává zakázku");
  });
});
