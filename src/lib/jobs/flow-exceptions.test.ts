import { describe, it, expect } from "vitest";
import {
  AWAITING_PO_REMIND_DAYS, FLOW_ACTIONS, FLOW_EXCEPTION_KEYS, awaitingPoDays, deriveFlow, exceptionActions, flowFactsFromRow,
  lostReasonsFor, menuActions, nextAction, reopenLostTarget, resumeTarget, type ActionCtx, type FlowFacts,
} from "@/lib/jobs/flow-status";
import { correctionDiff, correctionSummary, exceptionFlags, matchesException } from "@/lib/jobs/flow-exceptions";
import { applyBookPatch, bookParamsToFilters, bookQuery, parseBookParams } from "@/components/jobs/book/book-params";
import type { Feature } from "@/lib/auth/permissions";
import { matchJob, type JobMatchCandidateExt } from "@/lib/jobs/matching";
import { normalizeExtracted } from "@/lib/jobs/extracted-normalize";

const TODAY = "2026-10-31";

function f(p: Partial<FlowFacts> = {}): FlowFacts {
  return {
    stage: "poptavka", inquiryStatus: "v_reseni", orderStatus: null, orderRevision: 0, orderConfirmedRevision: null,
    confirmationIssuedRevision: null, confirmationSentRevision: null, itemsCount: 0, itemsPriced: 0, itemsDelivered: 0,
    itemsPartial: 0, lastDeliveryAt: null, partialDeliveryAt: null, productionDone: 0, productionTotal: 0,
    deliveryNoteConfirmedAt: null, invoiceNumber: null, invoiceDueDate: null, paidAt: null, paidSoFar: 0, waitingSince: null,
    orderStatusChangedAt: null, pendingSupplierQuotes: 0, lostReason: null, proposal: null, hasOperations: false,
    hasPurchaseOrders: false, ...p,
  };
}

function ctx(features: Feature[]): ActionCtx {
  return { can: (x) => features.includes(x), userId: "u1", isSuperAdmin: false, assigneeId: null };
}
const SALES = ctx(["orders", "workflow", "margins", "documents", "pricing"]);
const WORKER = ctx(["orders", "workflow"]);

describe("výjimky v toku — akce", () => {
  it("poptávka / nacenění / nabídka: Zákazník neobjednal, Nebudeme nabízet (jen před nabídkou), Vyrábět bez objednávky", () => {
    expect(exceptionActions(f({ stage: "poptavka" }), SALES)).toEqual(expect.arrayContaining(["job.notOrdered", "job.decline", "order.startWithoutPo", "job.pause", "drawing.update"]));
    const quote = exceptionActions(f({ stage: "nabidka", inquiryStatus: "zpracovana" }), SALES);
    expect(quote).toContain("job.notOrdered");
    expect(quote).not.toContain("job.decline");
    // zaměstnanec bez práva na marže prohru neuzavírá (navrhne ji existujícím „Navrhnout…")
    expect(exceptionActions(f({ stage: "poptavka" }), WORKER)).not.toContain("job.notOrdered");
    // pořadí = FLOW_EXCEPTION_KEYS
    const keys = exceptionActions(f({ stage: "poptavka" }), SALES);
    expect([...keys].sort((a, b) => FLOW_EXCEPTION_KEYS.indexOf(a) - FLOW_EXCEPTION_KEYS.indexOf(b))).toEqual(keys);
  });

  it("výroba: Výroba se nepovedla, Oprava zakázky; dodáno: Reklamace; reklamace: Vyřešit", () => {
    const prod = exceptionActions(f({ stage: "ve_vyrobe", orderStatus: "potvrzena", inquiryStatus: "zpracovana" }), SALES);
    expect(prod).toEqual(expect.arrayContaining(["production.failed", "order.correct", "job.pause"]));
    expect(prod).not.toContain("claim.open");
    const done = exceptionActions(f({ stage: "dokonceno", orderStatus: "potvrzena", inquiryStatus: "zpracovana" }), SALES);
    expect(done).toContain("claim.open");
    expect(done).not.toContain("job.pause");
    expect(exceptionActions(f({ stage: "reklamace", orderStatus: "potvrzena" }), SALES)).toContain("claim.resolve");
    // ve výrobě s dodaným vším (stav se neposunul) = dodáno → reklamovat jde
    expect(exceptionActions(f({ stage: "ve_vyrobe", orderStatus: "potvrzena", itemsCount: 2, itemsDelivered: 2 }), SALES)).toContain("claim.open");
  });

  it("pozastaveno: Pokračovat jen se známým původem; nerealizováno: Obnovit poptávku", () => {
    expect(exceptionActions(f({ stage: "pozastaveno", sideFromStage: "ve_vyrobe", orderStatus: "potvrzena" }), SALES)).toContain("job.resume");
    expect(exceptionActions(f({ stage: "pozastaveno" }), SALES)).not.toContain("job.resume");
    // pozastavená poptávka jde pořád uzavřít „Zákazník neobjednal"
    expect(exceptionActions(f({ stage: "pozastaveno", sideFromStage: "nabidka" }), SALES)).toContain("job.notOrdered");
    expect(exceptionActions(f({ stage: "nerealizovano", inquiryStatus: "stazena" }), SALES)).toEqual(["job.reopenLost"]);
    expect(resumeTarget({ stage: "pozastaveno", sideFromStage: "ve_vyrobe" })).toBe("ve_vyrobe");
    expect(resumeTarget({ stage: "pozastaveno", sideFromStage: "reklamace" })).toBeNull();
    expect(reopenLostTarget({ stage: "nerealizovano", sideFromStage: "nabidka" })).toBe("nabidka");
    expect(reopenLostTarget({ stage: "nerealizovano", sideFromStage: "ve_vyrobe" })).toBe("poptavka");
    expect(reopenLostTarget({ stage: "nerealizovano", sideFromStage: null })).toBe("poptavka");
  });

  it("vyrábět bez objednávky: potvrzení se nenabízí, další krok předání; po příchodu objednávky „Potvrdit objednávku“", () => {
    const awaiting = f({ stage: "objednavka", orderStatus: "dorucena", orderRevision: 1, awaitingCustomerPo: true, awaitingPoSince: "2026-10-20T08:00:00Z", inquiryStatus: "zpracovana" });
    const s = deriveFlow(awaiting, [], TODAY);
    expect(nextAction(awaiting, s, SALES)?.key).toBe("production.handoff");
    const menu = menuActions(awaiting, s, SALES);
    expect(menu).not.toContain("order.confirm");
    expect(menu).not.toContain("order.sendConfirmation");
    expect(menu).toContain("order.poArrived");
    expect(awaitingPoDays(awaiting, TODAY)).toBe(11);
    expect(exceptionFlags(awaiting, TODAY).map((x) => x.key)).toContain("chybi_po");
    const fresh = { ...awaiting, awaitingPoSince: "2026-10-30T08:00:00Z" };
    expect(exceptionFlags(fresh, TODAY).map((x) => x.key)).toContain("bez_po");
    expect(AWAITING_PO_REMIND_DAYS).toBe(7);
    // ve výrobě bez objednávky: „Potvrzeno bez dokladu" neruší — výroba jede dál
    const prod = f({ stage: "ve_vyrobe", orderStatus: "potvrzena", orderRevision: 1, orderConfirmedRevision: 1, awaitingCustomerPo: true, awaitingPoSince: "2026-10-30T08:00:00Z" });
    expect(menuActions(prod, deriveFlow(prod, [], TODAY), SALES)).not.toContain("order.sendConfirmation");
    // objednávka dorazila → potvrdit s jejím číslem (má přednost před výrobou)
    const arrived = { ...prod, awaitingCustomerPo: false, customerPoReceivedAt: "2026-10-31T09:00:00Z", customerOrderNumber: "PO-77" };
    expect(nextAction(arrived, deriveFlow(arrived, [], TODAY), SALES)).toEqual({ key: "order.sendConfirmation", label: "Potvrdit objednávku" });
    expect(exceptionFlags(arrived, TODAY).map((x) => x.key)).toContain("po_dorazila");
    // potvrzení odešlo → zpět běžný tok
    const confirmed = { ...arrived, confirmationSentRevision: 1 };
    expect(nextAction(confirmed, deriveFlow(confirmed, [], TODAY), SALES)?.key).not.toBe("order.sendConfirmation");
  });

  it("reklamace po opravě: u zákazníka → „Reklamace vyřízena“", () => {
    const back = f({ stage: "dodano_zakaznikovi", orderStatus: "potvrzena", itemsCount: 1, itemsDelivered: 1, claimOpenedAt: "2026-10-30T10:00:00Z", claimResolution: "oprava", claimFromStage: "fakturovano" });
    expect(nextAction(back, deriveFlow(back, [], TODAY), SALES)?.key).toBe("claim.close");
    expect(exceptionActions(back, SALES)).toContain("claim.close");
    expect(exceptionFlags(back, TODAY).map((x) => x.key)).toContain("reklamace");
  });

  it("důvody: Výroba se nepovedla jen u zrušení", () => {
    expect(lostReasonsFor("job", "zruseno")).toContain("vyroba");
    expect(lostReasonsFor("job", "nerealizovano")).not.toContain("vyroba");
    expect(FLOW_ACTIONS["job.notOrdered"].feature).toBe("margins");
  });

  it("fakta z řádku DB (sloupce migrace 20261031150000)", () => {
    const facts = flowFactsFromRow({
      status: "pozastaveno", side_from_stage: "ve_vyrobe", hold_reason: "Čeká na materiál", awaiting_customer_po: false,
      claim_opened_at: null, claim_reason: null, claim_qty: "3", drawing_changes_open: 2, corrected_at: "2026-10-31T10:00:00Z", corrected_note: "množství",
    });
    expect(facts.sideFromStage).toBe("ve_vyrobe");
    expect(facts.holdReason).toBe("Čeká na materiál");
    expect(facts.claimQty).toBe(3);
    expect(facts.drawingChangesOpen).toBe(2);
    const keys = exceptionFlags(facts, TODAY).map((x) => x.key);
    expect(keys).toEqual(["vykres", "pozastaveno", "opraveno"]);
  });
});

describe("výjimky v toku — párování objednávky k zakázce vyráběné bez ní", () => {
  it("objednávka téhož zákazníka se přiřadí zakázce, která na ni čeká (bez čísla objednávky)", () => {
    const base = {
      title: "", createdAt: "2026-09-01T00:00:00Z", customerName: "Strojmetal", customerIco: null, customerDic: null, customerEmails: [],
      customerInquiryNumber: null, quoteNumbers: [], drawingNumbers: [],
    };
    const jobs: JobMatchCandidateExt[] = [
      { ...base, id: "j-wait", number: "Z-1", stage: "ve_vyrobe", customerId: "c1", customerOrderNumber: null, awaitingCustomerPo: true },
      { ...base, id: "j-other", number: "Z-2", stage: "ve_vyrobe", customerId: "c1", customerOrderNumber: "PO-1" },
    ];
    const r = matchJob({ ...normalizeExtracted({}), docKind: "objednavka", issuer: "zakaznik", customerOrderNumber: "PO-77" }, jobs, { customerId: "c1", now: new Date("2026-10-31T10:00:00Z") });
    expect(r.best?.jobId).toBe("j-wait");
    expect(r.best?.reason).toMatch(/bez objednávky/);
    // jiný zákazník → ne
    expect(matchJob({ ...normalizeExtracted({}), docKind: "objednavka", issuer: "zakaznik" }, jobs, { customerId: "c2" }).best).toBeNull();
  });
});

describe("výjimky v toku — Kniha a oprava", () => {
  it("filtr Výjimky a důvod v URL", () => {
    const p = parseBookParams({ segment: "nerealizovane", duvod: "cena" });
    expect(p.reason).toBe("cena");
    expect(bookParamsToFilters(p).lostReason).toBe("cena");
    expect(bookQuery(p)).toContain("duvod=cena");
    // změna záložky ruší důvod
    expect(applyBookPatch(p, { segment: "objednavky" }).reason).toBeNull();
    const q = parseBookParams({ vyjimka: "bez_po" });
    expect(q.exception).toBe("bez_po");
    expect(bookParamsToFilters(q).exception).toBe("bez_po");
    expect(parseBookParams({ vyjimka: "nesmysl" }).exception).toBeNull();
    expect(matchesException({ stage: "ve_vyrobe", flow: f({ stage: "ve_vyrobe", awaitingCustomerPo: true }) }, "bez_po")).toBe(true);
    expect(matchesException({ stage: "reklamace", flow: null }, "reklamace")).toBe(true);
    expect(matchesException({ stage: "objednavka", flow: f({ drawingChangesOpen: 1 }) }, "vykres")).toBe(true);
  });

  it("oprava zakázky: rozdíl množství, ceny a termínu", () => {
    const changes = correctionDiff(
      { items: [{ id: "a", label: "F0N603W88", quantity: 120, unitPrice: 10 }], dueDate: "2026-11-12" },
      { items: [{ id: "a", quantity: 150, unitPrice: 9.5 }], dueDate: "2026-11-20", deliveryNote: "Hala B" },
      { prices: true },
    );
    expect(changes.map((c) => c.field)).toEqual(["item:a:quantity", "item:a:unit_price", "due_date", "delivery_address"]);
    expect(correctionSummary(changes)).toContain("F0N603W88 — množství: 120 → 150");
    expect(correctionSummary(changes)).toContain("Termín dodání: 12. 11. → 20. 11.");
    // bez práva na ceny se cena nemění
    expect(correctionDiff({ items: [{ id: "a", label: "x", quantity: 1, unitPrice: 10 }], dueDate: null }, { items: [{ id: "a", quantity: 1, unitPrice: 1 }], dueDate: null }, { prices: false })).toEqual([]);
  });
});
