import { describe, it, expect, vi } from "vitest";
import * as React from "react";
import { renderToString } from "react-dom/server";

// Karta „Technologie" v Přehledu (majitel 30. 10.) — render bez Next.js: router a akce jsou nahrazené
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn(), replace: vi.fn(), back: vi.fn(), prefetch: vi.fn() }),
  usePathname: () => "/orders/j1",
}));
vi.mock("@/app/actions/jobs", () => ({
  updateJob: vi.fn(), setJobStage: vi.fn(), deleteJob: vi.fn(), saveJobItems: vi.fn(), addJobComment: vi.fn(),
  createJobQuote: vi.fn(), updateJobQuote: vi.fn(), approveJobQuote: vi.fn(), markJobQuoteSent: vi.fn(),
  acceptJobQuote: vi.fn(), rejectJobQuote: vi.fn(), newJobQuoteRevision: vi.fn(), setJobQuoteArchived: vi.fn(),
  deleteJobQuote: vi.fn(),
}));
vi.mock("@/app/actions/job-files", () => ({
  setJobFileArchived: vi.fn(), updateJobFile: vi.fn(), deleteJobFile: vi.fn(), createJobFileUpload: vi.fn(), registerJobFile: vi.fn(),
}));
vi.mock("@/app/actions/job-documents", () => ({
  generateJobDocument: vi.fn(), sendJobDocument: vi.fn(), draftJobDocumentEmail: vi.fn(),
}));
vi.mock("@/lib/jobs/upload-client", () => ({ uploadJobFiles: vi.fn(), uploadJobFile: vi.fn() }));
vi.mock("@/components/jobs/capture/capture-button", () => ({
  CaptureButton: ({ label }: { label?: string }) => <button type="button">{label ?? "Vyfotit doklad"}</button>,
}));

import { JobDetailProvider } from "./detail-context";
import { TechnologyCard } from "./technology-card";
import { JobDetailView } from "./job-detail-view";
import { todayInPrague } from "@/components/jobs/book/book-params";
import { summarizeOperations } from "@/lib/jobs/production";
import type { JobDetail, JobFormOptions } from "@/lib/jobs/types";
import type { JobOperation } from "@/lib/jobs/production-types";
import type { JobPurchasing, PurchaseOrderView, SupplierQuoteView } from "@/lib/jobs/purchasing-types";
import type { JobProductionData } from "@/components/jobs/production/production-tab";
import { HRUBY, NOVAK, TEPKAL, addDays, item, op, purchaseOrder, quote, stepPo, supplierRef } from "./__fixtures__/technology";

const TODAY = todayInPrague();

function job(over: Partial<JobDetail> = {}): JobDetail {
  return {
    id: "j1", number: "Z-2026-120", title: "Příruby", stage: "naceneni", priority: "stredni",
    customer: { id: "c1", name: "StrojMetal s.r.o.", customerNumber: null, ico: null },
    customerOrderNumber: null, customerInquiryNumber: null, drawingNumbers: [], itemCount: 0, totalQuantity: 0,
    value: 60000, purchaseCost: null, currency: "CZK", inquiryDate: null, orderDate: null, customerRequiredDate: null,
    dueDate: null, expectedDeliveryDate: null, supplierPromisedDate: null, maxToleratedDate: null, receivedAt: null,
    deliveredAt: null, owner: null, assignee: null, createdBy: null, supplier: null, quoteCount: 0, fileCount: 0,
    aiFilled: false, source: "manual", createdAt: "2026-09-01T08:00:00Z", updatedAt: "2026-09-01T08:00:00Z",
    stageChangedAt: null, note: null, tags: [], technology: null, manufacturingLocation: null, specificRequirements: null,
    deliveryMethod: null, supplierOrderNumber: null, invoiceNumber: null, deliveryNoteNumber: null, customerContact: null,
    customerContactEmail: null, customerContactPhone: null, pricedBy: null, approvedBy: null, approvedAt: null,
    confirmedAt: null, productionStartedAt: null, shippedAt: null, invoicedAt: null, emailId: null, aiConfidence: null,
    acceptedQuoteId: null, margin: null, customerDetail: null, items: [], quotes: [], files: [], events: [],
    ...over,
  };
}

function production(ops: JobOperation[], due: string | null = null): JobProductionData {
  return {
    operations: ops, summary: summarizeOperations(ops), closing: null,
    handoff: {
      permissions: { canSeePrices: true, canConfirmCustomerDate: true, canReceive: true, canSend: true, canCancelSent: true },
      finalDate: { date: due, source: due ? "due_date" : null, maxTolerated: null },
    },
  };
}

function purchasing(quotes: SupplierQuoteView[], orders: PurchaseOrderView[] = []): JobPurchasing {
  return { supplierQuotes: quotes, purchaseOrders: orders } as unknown as JobPurchasing;
}

const options: JobFormOptions = { users: [], customers: [], suppliers: [NOVAK, TEPKAL, HRUBY] };
const ADMIN = { canDelete: true, margins: true, aiCapture: true };
const WORKER = { canDelete: false, margins: false, aiCapture: false };

function render(j: JobDetail, prod: JobProductionData | null, purch: JobPurchasing | null, perms = ADMIN): string {
  return renderToString(
    <JobDetailProvider jobId={j.id} perms={perms} options={options}>
      <TechnologyCard job={j} production={prod} purchasing={purch} />
    </JobDetailProvider>,
  ).replace(/<!-- -->/g, "");
}
const text = (html: string) => html.replace(/<[^>]+>/g, " ").replace(/&nbsp;| /g, " ").replace(/\s+/g, " ");

const ITEMS = [
  item({ id: "i1", position: 0, drawingNumber: "PR-20", name: "Příruba", quantity: 2, tech: { procedure: "1. frézovat načisto\n2. kalit", complete: false, completeBy: null, supplierNote: "pozor popsat na čele" } }),
  item({ id: "i2", position: 1, drawingNumber: "PR-21", name: "Pouzdro", quantity: 1 }),
];

describe("Karta Technologie v Přehledu — render", () => {
  it("poptávka bez technologie: „Technologie zatím nenastavena — Nastavit“ vede do záložky Technologie", () => {
    const html = render(job({ stage: "poptavka", items: [item({ id: "i1", drawingNumber: "PR-10" })] }), production([]), purchasing([]));
    expect(html).toContain('data-testid="tech-empty"');
    expect(text(html)).toContain("Technologie zatím nenastavena — Nastavit");
    expect(html).toMatch(/<a href="\?tab=vyroba"[^>]*>Nastavit<\/a>/);
    expect(html).not.toContain('data-testid="tech-step"');
    // starší ruční pole jen s hodnotou; požadavky a dodání zůstávají
    expect(html).not.toContain("Místo výroby");
    expect(html).toContain("Specifické požadavky");
    expect(html).toContain("Způsob dodání");
  });

  it("nacenění: kroky v pořadí, Novák s cenou z nabídky, kalení „Čeká na nabídku dodavatele“, poznámka pro dodavatele, další krok", () => {
    const qN = quote({ id: "qn", supplier: supplierRef(NOVAK), total: 8200, operationKinds: ["frezovani"], leadTimeDays: 21 });
    const qT = quote({ id: "qt", supplier: supplierRef(TEPKAL), total: null, operationKinds: ["tepelne_zpracovani"] });
    const ops = [op({ id: "a", supplier: NOVAK, supplierQuoteId: "qn" }), op({ id: "b", position: 1, kind: "tepelne_zpracovani", label: "Tepelné zpracování" })];
    const html = render(job({ items: ITEMS }), production(ops), purchasing([qN, qT]));
    const t = text(html);
    expect(t).toContain("2 kroky · Frézy Novák s.r.o.");
    expect(t).toMatch(/1\. Frézování .*Frézy Novák s\.r\.o\..*Nabídka s cenou.*2\. Tepelné zpracování .*Poptáno: TepKal s\.r\.o\..*Čeká na nabídku dodavatele/);
    expect(t).not.toContain("Nevybráno");
    expect(t).toContain("8 200 Kč");
    expect(t).toContain("dle nabídky NAB-qn");
    expect(t).toContain("Pro dodavatele: pozor popsat na čele");
    expect(t).toContain("1. frézovat načisto");
    expect(t).toContain("Nákup podle kroků: 8 200 Kč · 1 cena chybí");
    expect(html).toContain('data-testid="tech-next"');
    expect(t).toContain("Zadat cenu dodavatele");
    expect(t).toContain("Celý postup v záložce Technologie");
    expect(html.match(/data-testid="tech-step"/g)).toHaveLength(2);
  });

  it("zaměstnanec (bez práva na ceny): žádné částky", () => {
    const qN = quote({ id: "qn", supplier: supplierRef(NOVAK), total: 8200, operationKinds: ["frezovani"] });
    const html = render(job({ items: ITEMS }), production([op({ id: "a", supplier: NOVAK, supplierQuoteId: "qn" })]), purchasing([qN]), WORKER);
    expect(html).not.toContain("Kč");
    expect(html).not.toContain('data-testid="tech-step-cost"');
    expect(html).not.toContain("Nákup podle kroků");
  });

  it("potvrzeno, dvě položky s jinou technologií: dvě skupiny, kalení za termínem zákazníka červeně + varování", () => {
    const due = addDays(TODAY, 20);
    const items = [item({ id: "i1", drawingNumber: "PR-30", name: "Matrice", quantity: 4 }), item({ id: "i2", position: 1, drawingNumber: "PR-31", name: "Vodicí čep", quantity: 10, material: "16MnCr5" })];
    const ops = [
      op({ id: "a", supplier: NOVAK, plannedEnd: addDays(TODAY, 12), orderItemIds: ["i1"], deadlineState: "dohodnuto" }),
      op({ id: "b", position: 1, kind: "tepelne_zpracovani", label: "Tepelné zpracování", supplier: TEPKAL, plannedEnd: addDays(TODAY, 24), orderItemIds: ["i1"] }),
      op({ id: "c", position: 2, kind: "soustruzeni", label: "Soustružení", inHouse: true, plannedEnd: addDays(TODAY, 15), orderItemIds: ["i2"], deadlineState: "plan" }),
    ];
    const html = render(job({ stage: "potvrzeno", items, dueDate: due }), production(ops, due), purchasing([]));
    const t = text(html);
    expect(html.match(/data-testid="tech-group"/g)).toHaveLength(2);
    expect(t).toMatch(/PR-30 · Matrice · 4 ks.*1\. Frézování.*2\. Tepelné zpracování.*PR-31 · Vodicí čep · 10 ks.*3\. Soustružení.*U nás/);
    expect(t).toContain("po termínu zákazníka");
    expect(t).toContain("Objednávka se vystaví při předání do výroby");
    expect(t).not.toContain("až díl půjde do tohoto kroku");
    expect(html).toContain('data-testid="tech-risk"');
    expect(t).toMatch(/Termín zákazníka \d+\. \d+\./);
    expect(t).toContain("Předat do výroby…");
  });

  it("ve výrobě: objednávka odeslaná / k odeslání, stav po krocích, mobil sbalený (podrobnosti skryté do rozbalení)", () => {
    const p1 = purchaseOrder({ id: "p1", number: "OV-2026-041", status: "potvrzena", total: 9600, sentAt: "2026-10-26T08:00:00Z", confirmedDate: addDays(TODAY, 6) });
    const p2 = purchaseOrder({ id: "p2", number: "OV-2026-042", status: "vystavena", total: 1800 });
    const ops = [
      op({ id: "a", supplier: NOVAK, status: "probiha", startedAt: "2026-10-27T08:00:00Z", plannedEnd: addDays(TODAY, 6), purchaseOrderId: "p1", purchaseOrder: stepPo(p1), deadlineState: "potvrzeno" }),
      op({ id: "b", position: 1, kind: "tepelne_zpracovani", label: "Tepelné zpracování", supplier: TEPKAL, plannedEnd: addDays(TODAY, 11), purchaseOrderId: "p2", purchaseOrder: stepPo(p2) }),
      op({ id: "c", position: 2, kind: "brouseni", label: "Broušení", inHouse: true, plannedEnd: addDays(TODAY, 18), endsAtCustomerDate: true, deadlineState: "plan" }),
    ];
    const due = addDays(TODAY, 18);
    const items = [item({ id: "i1", drawingNumber: "PR-40", name: "Razník", quantity: 6, tech: { procedure: "1. frézovat\n2. kalit\n3. brousit", complete: false, completeBy: null, supplierNote: "zachovat středicí důlky" } })];
    const html = render(job({ stage: "ve_vyrobe", items, dueDate: due }), production(ops, due), purchasing([], [p1, p2]));
    const t = text(html);
    expect(t).toMatch(/Ve výrobě u dodavatele od \d+\. \d+\./);
    expect(t).toContain("OV-2026-041 · potvrzena na");
    expect(t).toContain("Objednávka k odeslání");
    expect(t).toContain("OV-2026-042 · čeká na odeslání");
    expect(t).toMatch(/konečný \d+\. \d+\. · zákazník/);
    expect(html).toContain('data-phase="ve_vyrobe"');
    expect(html).toContain('data-phase="k_odeslani"');
    // mobil: podrobnosti kroků a položky skryté, tlačítko „Podrobnosti"; na desktopu (sm:) vidět
    expect(html).toContain('data-testid="tech-group-toggle"');
    expect(html).toMatch(/class="[^"]*hidden sm:flex[^"]*" data-testid="tech-step-details"/);
    expect(html).toMatch(/class="[^"]*hidden sm:block[^"]*" data-testid="tech-group-items"/);
    // jedna položka: název a kusy jen v titulku skupiny (ne podruhé u postupu)
    expect(t).toContain("PR-40 · Razník · 6 ks · 1.2379");
    expect(t.match(/PR-40 · Razník/g)).toHaveLength(1);
    expect(t).toContain("Pro dodavatele: zachovat středicí důlky");
    // bez dalšího kroku z hlavičky (karta mimo kartu zakázky): neodeslaná objednávka
    expect(t).toContain("Odeslat objednávku");
  });

  it("částečně dodáno: „Částečně dodáno k nám (1/2 položky)“ a „Zákazníkovi dodáno 2 z 8 ks“; kompletně zadáno Hrubý", () => {
    const p = purchaseOrder({ id: "p", number: "OV-51", status: "potvrzena", total: 11000, receipt: { done: 1, total: 2, partial: true } });
    const items = [
      item({ id: "i1", drawingNumber: "PR-50", quantity: 5, deliveredQuantity: 2, tech: { procedure: null, complete: true, completeBy: HRUBY.name, supplierNote: null } }),
      item({ id: "i2", position: 1, drawingNumber: "PR-51", quantity: 3, tech: { procedure: null, complete: true, completeBy: HRUBY.name, supplierNote: null } }),
    ];
    const ops = [op({ id: "a", kind: "kompletni_dodavka", label: "Kompletní dodávka", supplier: HRUBY, status: "probiha", purchaseOrderId: "p", purchaseOrder: stepPo(p) })];
    const t = text(render(job({ stage: "ve_vyrobe", items }), production(ops), purchasing([], [p])));
    expect(t).toContain("Částečně dodáno k nám (1/2 položky)");
    expect(t).toContain("Zákazníkovi dodáno 2 z 8 ks");
    expect(t).toContain(`Bez technologie — kompletně zadáno ${HRUBY.name}`);
  });

  it("dodáno: kroky Dodáno k nám / Hotovo, bez tlačítka dalšího kroku", () => {
    const p = purchaseOrder({ id: "p", number: "OV-61", status: "dodana", total: 4000 });
    const ops = [
      op({ id: "a", supplier: NOVAK, status: "hotovo", finishedAt: "2026-10-24T10:00:00Z", purchaseOrderId: "p", purchaseOrder: stepPo(p) }),
      op({ id: "b", position: 1, kind: "kontrola", label: "Kontrola / měření", inHouse: true, status: "hotovo", finishedAt: "2026-10-26T10:00:00Z" }),
    ];
    const html = render(job({ stage: "dodano_zakaznikovi", items: [item({ id: "i1", drawingNumber: "PR-60", quantity: 2, deliveredQuantity: 2 })] }), production(ops), purchasing([], [p]));
    const t = text(html);
    expect(t).toMatch(/Dodáno k nám \d+\. \d+\./);
    expect(t).toMatch(/Hotovo \d+\. \d+\./);
    expect(html).not.toContain('data-testid="tech-next"');
  });

  it("karta zakázky: Přehled ukazuje kroky z výroby; „Dodavatel & peníze“ bez dodavatele zakázky jmenuje firmy kroků", () => {
    const ops = [op({ id: "a", supplier: NOVAK }), op({ id: "b", position: 1, kind: "tepelne_zpracovani", label: "Tepelné zpracování", supplier: TEPKAL })];
    const html = renderToString(
      <JobDetailView job={job({ items: ITEMS })} options={options} perms={ADMIN} production={production(ops)} purchasing={purchasing([])} />,
    ).replace(/<!-- -->/g, "");
    const t = text(html);
    expect(html).toContain('data-testid="tech-card"');
    expect(html.match(/data-testid="tech-step"/g)).toHaveLength(2);
    expect(t).toContain("Po krocích — viz Technologie");
    expect(t).toContain(`Kroky dělá: ${NOVAK.name}, ${TEPKAL.name}`);
    expect(t).not.toContain("Vyrábíme sami / nevybráno");
  });
});
