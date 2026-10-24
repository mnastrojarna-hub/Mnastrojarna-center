import { describe, it, expect, vi } from "vitest";
import * as React from "react";
import { renderToString } from "react-dom/server";

// Řádky Knihy s podrobnými stavy: chip podle 1.11, autor pod stavem, sloveso dalšího kroku, mobil
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn(), replace: vi.fn(), back: vi.fn(), prefetch: vi.fn() }),
  usePathname: () => "/orders",
}));
vi.mock("@/components/access-provider", () => ({
  useAccess: () => ({ features: ["orders", "workflow"], role: "obchodnik", userId: "u1", can: () => true }),
}));
vi.mock("@/app/actions/jobs", () => ({ setJobStage: vi.fn(), createJob: vi.fn(), newJobQuoteRevision: vi.fn() }));
vi.mock("@/app/actions/flow-status", () => ({
  takeInquiry: vi.fn(), setInquiryStatus: vi.fn(), setOrderStatus: vi.fn(), setQuoteState: vi.fn(), decideFlowProposal: vi.fn(),
  moveJobStage: vi.fn(),
}));
vi.mock("@/app/actions/job-flow", () => ({ previewJobStage: vi.fn(), extendQuoteValidity: vi.fn() }));

import { TooltipProvider } from "@/components/ui/tooltip";
import { ToastProvider } from "@/components/jobs/detail/toast";
import { JobRows } from "@/components/jobs/book/job-rows";
import { JobBoard } from "@/components/jobs/book/job-board";
import { rowFlowView, type BookAccess } from "@/components/jobs/book/book-flow";
import { applyBookPatch, bookParamsToFilters, bookQuery, DEFAULT_PARAMS, parseBookParams } from "@/components/jobs/book/book-params";
import { filterJobs, matchesFlow, paymentStateOf } from "@/lib/jobs/mapping";
import type { ChangeStamp, FlowFacts, JobStamps, QuoteFacts } from "@/lib/jobs/flow-status";
import type { JobListItem } from "@/lib/jobs/types";

const SALES: BookAccess = { features: ["orders", "workflow", "margins", "documents"], userId: "u1", role: "obchodnik" };
const WORKER: BookAccess = { features: ["orders", "workflow"], userId: "u2", role: "zamestnanec" };
const NOW = Date.now();

function facts(p: Partial<FlowFacts> = {}): FlowFacts {
  return {
    stage: "poptavka", inquiryStatus: "prijata", orderStatus: null, orderRevision: 0, orderConfirmedRevision: null,
    confirmationIssuedRevision: null, confirmationSentRevision: null, itemsCount: 0, itemsPriced: 0, itemsDelivered: 0,
    itemsPartial: 0, lastDeliveryAt: null, partialDeliveryAt: null, productionDone: 0, productionTotal: 0,
    deliveryNoteConfirmedAt: null, invoiceNumber: null, invoiceDueDate: null, paidAt: null, paidSoFar: 0,
    waitingSince: null, orderStatusChangedAt: null, pendingSupplierQuotes: 0, lostReason: null, proposal: null,
    hasOperations: false, hasPurchaseOrders: false, ...p,
  };
}

function quote(p: Partial<QuoteFacts> = {}): QuoteFacts {
  return {
    id: "q1", number: "NAB-2026-031", revision: 1, status: "odeslano", state: "odeslana", approvedBy: null, approvalRequired: false,
    createdBy: "u1", archived: false, sentAt: new Date(NOW - 3 * 86_400_000).toISOString(), validUntil: "2099-01-01",
    aiGenerated: false, supersededBy: null, ...p,
  };
}

const stamp = (name: string, minutesAgo: number, p: Partial<ChangeStamp> = {}): ChangeStamp => ({
  by: { id: name, name }, byName: name, at: new Date(NOW - minutesAgo * 60_000).toISOString(), via: "rucne", kind: "user", ...p,
});

function stamps(p: Partial<JobStamps> = {}): JobStamps {
  return {
    stage: null, inquiry: null, order: null, confirmed: null, confirmationSent: null, deliveryNote: null, invoiced: null,
    paid: null, lost: null, proposal: null, stageHistory: {}, ...p,
  };
}

function job(over: Partial<JobListItem> = {}): JobListItem {
  const stage = over.stage ?? "poptavka";
  return {
    id: "j1", number: "Z-2026-101", title: "Příruby", stage, priority: "stredni",
    customer: { id: "c1", name: "Strojmetal a.s.", customerNumber: null, ico: null },
    customerOrderNumber: null, customerInquiryNumber: null, drawingNumbers: [], itemCount: 0, totalQuantity: 0,
    value: 10_000, purchaseCost: null, currency: "CZK", inquiryDate: null, orderDate: null, customerRequiredDate: null,
    dueDate: null, expectedDeliveryDate: null, supplierPromisedDate: null, maxToleratedDate: null, receivedAt: null,
    deliveredAt: null, owner: { id: "u1", name: "Petr Obchodník" }, assignee: null, createdBy: null, supplier: null,
    quoteCount: 0, fileCount: 0, aiFilled: false, source: "email", createdAt: "2026-10-18T10:00:00Z",
    updatedAt: "2026-10-18T10:00:00Z", stageChangedAt: "2026-10-18T10:00:00Z",
    flow: facts({ stage }), flowQuotes: [], stamps: stamps(),
    ...over,
  };
}

/** Jen text (razítko: jméno a čas jsou zvlášť — zkracuje se jméno, nikdy čas). */
const flat = (h: string) => h.replace(/<[^>]+>/g, "");

function render(node: React.ReactNode): string {
  return renderToString(<ToastProvider><TooltipProvider>{node}</TooltipProvider></ToastProvider>).replace(/<!-- -->/g, "");
}

describe("řádek Knihy — podrobné stavy", () => {
  it("poptávka přijatá: chip Přijatá, sloveso Převzít, žádné „Posunout“", () => {
    const html = render(<JobRows jobs={[job()]} today="2026-10-22" access={SALES} />);
    expect(html).toContain("Přijatá");
    expect(html).toContain("Převzít");
    expect(html).not.toContain("Posunout");
    // chip je na mobilu pod zákazníkem, na desktopu u stavu
    expect(html.match(/>Přijatá</g)?.length).toBe(2);
    expect(html).toContain("relative z-10 mt-1.5 lg:hidden");
    expect(html).toContain("hidden lg:inline-flex");
  });

  it("autor je text na všech šířkách (text-[11px]) — pod stavem autor hlavního stavu, pod chipem autor dílčího", () => {
    const j = job({
      flow: facts({ inquiryStatus: "v_reseni", assigneeName: "Petr Obchodník" }),
      stamps: stamps({ stage: stamp("Jana Admin", 600), inquiry: stamp("Petr Obchodník", 5) }),
    });
    const v = rowFlowView(j, SALES);
    expect(v.stamp?.by?.name).toBe("Jana Admin");
    expect(v.chipStamp?.by?.name).toBe("Petr Obchodník");
    expect(v.chip?.label).toBe("V řešení");
    expect(v.chip?.hint).toBeNull(); // řešitel = autor → jméno jen v razítku
    const html = render(<JobRows jobs={[j]} today="2026-10-22" access={SALES} />);
    expect(flat(html)).toContain("P. Obchodník · před 5 min");
    expect(flat(html)).toContain("J. Admin · ");
    expect(html).toContain("text-[11px]");
    expect(html).not.toMatch(/hidden[^"]*xl:block[^"]*">před/); // autor už není schovaný jen na širokém desktopu
  });

  it("autor návrhu nikdy pod hlavním stavem (jen v chipu návrhu) — review UX 2", () => {
    const proposal = { phase: "quote" as const, to: "zamitnuta", reason: "cena" as const, kind: "user" as const, label: "Zamítnout nabídku — Cena" };
    const j = job({
      stage: "nabidka", flow: facts({ stage: "nabidka", inquiryStatus: "zpracovana", proposal }), flowQuotes: [quote()],
      stamps: stamps({ stage: stamp("Petr Obchodník", 30), proposal: stamp("Jana Zaměstnanec", 1) }),
    });
    const v = rowFlowView(j, SALES);
    expect(v.stamp?.by?.name).toBe("Petr Obchodník");
    expect(v.chipStamp).toBeNull();
    expect(flat(render(<JobRows jobs={[j]} today="2026-10-22" access={SALES} />))).toContain("navrhuje: Jana Zaměstnanec");
  });

  it("korekce do uzavření: řádek ukáže důvod prohry a autora", () => {
    const j = job({
      stage: "nerealizovano", flow: facts({ stage: "nerealizovano", inquiryStatus: "odmitnuta", lostReason: "kapacita" }),
      stamps: stamps({ lost: stamp("Petr Obchodník", 2), stage: stamp("Petr Obchodník", 2) }),
    });
    const html = render(<JobRows jobs={[j]} today="2026-10-22" access={SALES} />);
    expect(html).toContain("Nerealizováno — Nestíháme (kapacita / termín)");
  });

  it("částečné dodání = „1/2 položek“ (nikdy součet kusů), další krok Dodat zbytek", () => {
    const j = job({
      stage: "ve_vyrobe", flow: facts({ stage: "ve_vyrobe", inquiryStatus: "zpracovana", orderStatus: "potvrzena", orderRevision: 1, orderConfirmedRevision: 1, confirmationSentRevision: 1, itemsCount: 2, itemsDelivered: 1, hasOperations: true }),
    });
    const v = rowFlowView(j, SALES);
    expect(v.chip?.key).toBe("castecne");
    expect(v.next).toMatchObject({ key: "delivery.record", label: "Dodat zbytek" });
    const html = render(<JobRows jobs={[j]} today="2026-10-22" access={SALES} />);
    expect(html).toContain("1/2 položek");
    expect(html).not.toMatch(/\d+ ks z \d+ ks/);
  });

  it("návrh zaměstnance: duch s ✓ / ✕ jen pro toho, kdo smí rozhodnout", () => {
    const proposal = { phase: "inquiry" as const, to: "odmitnuta", reason: "kapacita" as const, kind: "user" as const, label: "Odmítnout poptávku — Nestíháme (kapacita / termín)" };
    const j = job({ flow: facts({ proposal }), stamps: stamps({ proposal: stamp("Pavel Dílna", 1) }) });
    const sales = render(<JobRows jobs={[j]} today="2026-10-22" access={SALES} />);
    expect(sales).toContain("Návrh: Odmítnout poptávku");
    expect(sales).toContain("Přijmout návrh");
    expect(sales).toContain("Pavel Dílna");
    const worker = render(<JobRows jobs={[j]} today="2026-10-22" access={WORKER} />);
    expect(worker).toContain("Návrh: Odmítnout poptávku");
    expect(worker).not.toContain("Přijmout návrh");
  });

  it("zaměstnanec u rozpracované nabídky nemá další krok (#25: „Předat ke schválení“ zaniklo); odeslaná → Zákazník objednal", () => {
    const draft = job({ stage: "naceneni", flow: facts({ stage: "naceneni", inquiryStatus: "v_reseni" }), flowQuotes: [quote({ status: "navrh_ai", state: "rozpracovana", sentAt: null })] });
    expect(rowFlowView(draft, WORKER).next).toBeNull();
    expect(rowFlowView(draft, SALES).next?.key).toBe("quote.send");
    const sent = job({ stage: "nabidka", flow: facts({ stage: "nabidka", inquiryStatus: "zpracovana" }), flowQuotes: [quote()] });
    const v = rowFlowView(sent, SALES);
    expect(v.chip?.key).toBe("odeslana");
    expect(v.chip?.hint).toContain("čeká 3 dny");
    expect(v.next?.label).toBe("Zákazník objednal");
  });

  it("karta tabule: chip, autor a sloveso; bez práva žádné tlačítko", () => {
    const j = job({ stamps: stamps({ inquiry: stamp("Petr Obchodník", 3) }) });
    const html = render(<JobBoard jobs={[j]} stages={["poptavka"]} today="2026-10-22" access={SALES} />);
    expect(html).toContain("Převzít");
    expect(flat(html)).toContain("P. Obchodník · před 3 min");
    const none = render(<JobBoard jobs={[j]} stages={["poptavka"]} today="2026-10-22" />);
    expect(none).not.toContain("Převzít");
  });
});

describe("filtry Knihy podle podrobných stavů", () => {
  it("URL poptavka / objednavka / dodani / zmenil ↔ parametry ↔ filtry", () => {
    const uuid = "156c7996-b488-4c53-a3f5-e51dd004f4ad";
    const p = parseBookParams({ segment: "objednavky", objednavka: "dorucena,ve_vyrobe,xyz", dodani: "castecne", zmenil: uuid, poptavka: "prijata" });
    expect(p).toMatchObject({ order: ["dorucena", "ve_vyrobe"], delivery: ["castecne"], changedBy: uuid, inquiry: ["prijata"] });
    const qs = bookQuery(p);
    expect(qs).toContain("objednavka=dorucena%2Cve_vyrobe");
    expect(qs).toContain("dodani=castecne");
    expect(qs).toContain(`zmenil=${uuid}`);
    expect(bookParamsToFilters(p)).toMatchObject({ order: ["dorucena", "ve_vyrobe"], delivery: ["castecne"], changedBy: uuid, inquiry: ["prijata"] });
    // nová záložka ruší chipy segmentu, ostatní filtry zůstávají
    expect(applyBookPatch(p, { segment: "poptavky" })).toMatchObject({ order: [], inquiry: [], delivery: ["castecne"] });
    expect(parseBookParams({ zmenil: "nekdo" }).changedBy).toBe("");
    expect(bookQuery(DEFAULT_PARAMS)).toBe("");
  });

  it("filterJobs: objednávka (doklad i plnění), dodání, platba přes deriveFlow", () => {
    const delivered = job({ id: "a", stage: "objednavka", flow: facts({ stage: "objednavka", orderStatus: "dorucena", orderRevision: 1 }) });
    const prod = job({ id: "b", stage: "ve_vyrobe", flow: facts({ stage: "ve_vyrobe", orderStatus: "potvrzena", orderRevision: 1, itemsCount: 2, itemsDelivered: 1 }) });
    const paid = job({ id: "c", stage: "fakturovano", invoiceNumber: "FV-1", flow: facts({ stage: "fakturovano", orderStatus: "potvrzena", paidSoFar: 3000, invoiceNumber: "FV-1" }) });
    const all = [delivered, prod, paid];
    expect(filterJobs(all, { order: ["dorucena"] }).map((j) => j.id)).toEqual(["a"]);
    expect(filterJobs(all, { order: ["castecne_dodana"] }).map((j) => j.id)).toEqual(["b"]);
    expect(filterJobs(all, { delivery: ["castecne"] }).map((j) => j.id)).toEqual(["b"]);
    expect(filterJobs(all, { payment: "castecne_zaplaceno" }).map((j) => j.id)).toEqual(["c"]);
    expect(filterJobs(all, { payment: "nezaplaceno" }).map((j) => j.id)).toEqual(["c"]);
    expect(matchesFlow(job({ flow: undefined }), { inquiry: ["prijata"] })).toBe(false);
    expect(paymentStateOf(paid)).toBe("nezaplaceno");
    expect(paymentStateOf({ stage: "dokonceno", paidAt: null, invoiceDueDate: null, invoiceNumber: null })).toBe("zaplaceno");
  });
});

describe("#25 neschválená nabídka v Knize", () => {
  const pending = (p: Partial<QuoteFacts> = {}) => quote({
    status: "ke_schvaleni", state: "ke_schvaleni", sentAt: null, approvalRequired: true, adminApprovalRequired: true, total: 5000, ...p,
  });

  it("štítek za hlavním chipem v poptávce i objednávce; ve fázi nabídky ho nahrazuje chip „Neschválená“", () => {
    const inquiry = job({ flowQuotes: [pending()] });
    expect(rowFlowView(inquiry, SALES).approval?.kind).toBe("pending");
    const order = job({
      stage: "objednavka", flow: facts({ stage: "objednavka", inquiryStatus: "zpracovana", orderStatus: "dorucena", orderRevision: 1 }),
      flowQuotes: [quote({ id: "q0", status: "prijato", state: "prijata" }), pending({ id: "q2", number: "NAB-2026-032" })],
    });
    expect(rowFlowView(order, SALES).approval?.number).toBe("NAB-2026-032");
    const pricing = job({ stage: "naceneni", flow: facts({ stage: "naceneni", inquiryStatus: "zpracovana", itemsCount: 1, itemsPriced: 1 }), flowQuotes: [pending()] });
    const v = rowFlowView(pricing, SALES);
    expect(v.chip?.key).toBe("ke_schvaleni");
    // ve fázi nabídky štítek NAHRADÍ fialový chip (jinak by „Neschválená“ vypadala jako „Schválená“)
    expect(v.approval?.kind).toBe("pending");
    expect(v.chipIsApproval).toBe(true);
    expect(rowFlowView(inquiry, SALES).chipIsApproval).toBe(false);
    const row = render(<JobRows jobs={[pricing]} today="2026-10-22" access={SALES} />);
    expect(row).not.toContain("ring-violet-400"); // žádný fialový chip stavu nabídky
    expect(flat(row)).toContain("Neschválená · NAB-2026-031");
    expect(row.match(/data-approval="pending"/g)?.length).toBe(2);
    // vrácená se ukáže i tam (jiná informace než „Neschválená“)
    expect(rowFlowView(job({ ...pricing, flowQuotes: [pending({ returnedAt: "2026-10-23T09:00:00Z", returnNote: "cena" })] }), SALES).approval?.kind).toBe("returned");
    // schválenou ani archivní Kniha neoznačuje
    expect(rowFlowView(job({ flowQuotes: [pending({ archived: true })] }), SALES).approval).toBeNull();
    expect(rowFlowView(job({ flowQuotes: [quote({ status: "ke_schvaleni", state: "schvalena", approvedBy: "u9", sentAt: null })] }), SALES).approval).toBeNull();
  });

  it("řádek (mobil celý text od sm, desktop krátký) a karta tabule: „Neschválená“ s title", () => {
    const html = render(<JobRows jobs={[job({ flowQuotes: [pending()] })]} today="2026-10-22" access={SALES} />);
    expect(html).toContain('data-approval="pending"');
    expect(html).toContain("Neschválená — čeká na schválení super admina");
    expect(html).toContain('title="Nabídka NAB-2026-031 čeká na schválení super admina — do té doby ji nejde odeslat zákazníkovi."');
    // jednou v kartě (mobil / tablet), jednou u stavu (desktop)
    expect(html.match(/data-approval="pending"/g)?.length).toBe(2);
    const board = render(<JobBoard jobs={[job({ flowQuotes: [pending()] })]} stages={["poptavka"]} today="2026-10-22" access={SALES} />);
    expect(board).toContain('data-approval="pending"');
    expect(flat(board)).toContain("Neschválená");
    expect(flat(board)).not.toContain("Neschválená — čeká");
  });
});
