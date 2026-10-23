import { describe, expect, it } from "vitest";
import {
  INQUIRY_ORDER, OPEN_INQUIRY, deriveFlow, type ActionCtx, type FlowFacts, type QuoteFacts,
} from "@/lib/jobs/flow-status";
import type { Feature } from "@/lib/auth/permissions";
import {
  CLOSED_JOB_KEYS, actionPalette, fileOriginLabel, flowActionHref, inquiryChip, orderChips, pageMenu, parseStateParam,
  pricingChip, quoteChip, quoteRowActions, stateParamValue, withinClosedWindow,
} from "./flow-state";
import { withJobMatches } from "./flow-data";
import type { FlowEmail } from "./flow-mail-list";

const TODAY = "2026-10-23";

function facts(over: Partial<FlowFacts> = {}): FlowFacts {
  return {
    stage: "poptavka", inquiryStatus: "v_reseni", orderStatus: null, orderRevision: 0, orderConfirmedRevision: null,
    confirmationIssuedRevision: null, confirmationSentRevision: null, itemsCount: 2, itemsPriced: 0, itemsDelivered: 0, itemsPartial: 0,
    lastDeliveryAt: null, partialDeliveryAt: null, productionDone: 0, productionTotal: 0, deliveryNoteConfirmedAt: null,
    invoiceNumber: null, invoiceDueDate: null, paidAt: null, paidSoFar: 0, waitingSince: null, orderStatusChangedAt: null,
    pendingSupplierQuotes: 0, lostReason: null, proposal: null, hasOperations: false, hasPurchaseOrders: false, ...over,
  };
}

function quote(over: Partial<QuoteFacts> = {}): QuoteFacts {
  return {
    id: "q1", number: "NAB-2026-031", revision: 1, status: "ke_schvaleni", state: "rozpracovana", approvedBy: null,
    approvalRequired: false, createdBy: "u1", archived: false, sentAt: null, validUntil: "2026-11-30", aiGenerated: false,
    supersededBy: null, createdAt: "2026-10-20T10:00:00Z", approvalRequestedAt: null, total: 1000, ...over,
  };
}

function ctx(features: Feature[], over: Partial<ActionCtx> = {}): ActionCtx {
  return { can: (f) => features.includes(f), userId: "u1", isSuperAdmin: false, assigneeId: null, ...over };
}

const SALES: Feature[] = ["workflow", "orders", "documents", "margins"];
const STAFF: Feature[] = ["workflow", "orders"];

describe("výběr chipů z URL", () => {
  it("parseStateParam: jen povolené klíče bez duplicit, jinak výchozí", () => {
    expect(parseStateParam("prijata,odmitnuta,prijata,xyz", INQUIRY_ORDER, OPEN_INQUIRY)).toEqual(["prijata", "odmitnuta"]);
    expect(parseStateParam(["v_reseni", "stazena"], INQUIRY_ORDER, OPEN_INQUIRY)).toEqual(["v_reseni", "stazena"]);
    expect(parseStateParam("", INQUIRY_ORDER, OPEN_INQUIRY)).toEqual(OPEN_INQUIRY);
    expect(parseStateParam(undefined, INQUIRY_ORDER, OPEN_INQUIRY)).toEqual(OPEN_INQUIRY);
    expect(parseStateParam("'; drop", INQUIRY_ORDER, OPEN_INQUIRY)).toEqual(OPEN_INQUIRY);
  });

  it("stateParamValue: výchozí výběr = bez parametru", () => {
    expect(stateParamValue(["v_reseni", "prijata", "ceka_na_podklady"], OPEN_INQUIRY)).toBeNull();
    expect(stateParamValue([], OPEN_INQUIRY)).toBeNull();
    expect(stateParamValue(["odmitnuta"], OPEN_INQUIRY)).toBe("odmitnuta");
  });

  it("okno uzavřených stavů = 30 dní jako flow_counts", () => {
    const now = Date.parse("2026-10-23T10:00:00Z");
    expect(CLOSED_JOB_KEYS).toEqual(["zpracovana", "odmitnuta", "stazena", "stornovana", "dokoncena", "zaplaceno"]);
    expect(withinClosedWindow("2026-10-01T10:00:00Z", now)).toBe(true);
    expect(withinClosedWindow("2026-09-20T10:00:00Z", now)).toBe(false);
    expect(withinClosedWindow(null, now)).toBe(false);
    expect(withinClosedWindow("nesmysl", now)).toBe(false);
  });
});

describe("chipy řádku", () => {
  it("poptávka: řešitel, čekání s tím, co chybí, odmítnutí s důvodem", () => {
    const f1 = facts({ assigneeName: "Petr Obchodník" });
    expect(inquiryChip(f1, deriveFlow(f1, [], TODAY))).toMatchObject({ key: "v_reseni", label: "V řešení", hint: "Petr Obchodník" });
    const f2 = facts({ inquiryStatus: "ceka_na_podklady", waitingSince: "2026-10-20T08:00:00Z", waitingNote: "Výkres PDF" });
    expect(inquiryChip(f2, deriveFlow(f2, [], TODAY))?.hint).toBe("čeká 3 dny · Výkres PDF");
    const f3 = facts({ stage: "nerealizovano", inquiryStatus: "odmitnuta", lostReason: "kapacita" });
    expect(inquiryChip(f3, deriveFlow(f3, [], TODAY))?.label).toBe("Odmítnutá — Nestíháme (kapacita / termín)");
    expect(inquiryChip(facts({ inquiryStatus: null, stage: "objednavka" }), deriveFlow(facts({ inquiryStatus: null, stage: "objednavka" }), [], TODAY))).toBeNull();
  });

  it("nacenění a aktivní nabídka", () => {
    const f = facts({ stage: "naceneni", itemsPriced: 1 });
    expect(pricingChip(f, deriveFlow(f, [], TODAY))?.label).toBe("Naceňuje se (1/2)");
    const sent = quote({ status: "odeslano", state: "odeslana", sentAt: "2026-10-19T08:00:00Z", revision: 2, aiGenerated: true });
    const s = deriveFlow(facts({ stage: "nabidka", inquiryStatus: "zpracovana" }), [sent], TODAY);
    expect(quoteChip(s)).toMatchObject({ key: "odeslana", hint: "NAB-2026-031 r2 · čeká 4 dny", ai: true });
  });

  it("objednávka: rev N, rozpor s počtem rozdílů, odmítnutá změna, ✉ odesláno, výroba s průběhem", () => {
    const d = facts({ stage: "objednavka", inquiryStatus: "zpracovana", orderStatus: "dorucena", orderRevision: 2 });
    expect(orderChips(d, deriveFlow(d, [], TODAY)).map((c) => c.label)).toEqual(["Doručená (rev 2)", "K vystavení"]);
    const r = facts({
      stage: "objednavka", inquiryStatus: "zpracovana", orderStatus: "rozpor", orderRevision: 1,
      orderMismatch: { items: [{ kind: "cena", label: "Cena" }, { kind: "termin", label: "Termín" }], source: "ai", detected_at: "2026-10-22T08:00:00Z" },
    });
    expect(orderChips(r, deriveFlow(r, [], TODAY))[0]).toMatchObject({ key: "rozpor", hint: "2 rozdíly" });
    const no = facts({ stage: "ve_vyrobe", inquiryStatus: "zpracovana", orderStatus: "potvrzena", orderRevision: 2, orderConfirmedRevision: 1, confirmationSentRevision: 1, productionDone: 1, productionTotal: 4 });
    const chips = orderChips(no, deriveFlow(no, [], TODAY));
    expect(chips[0]).toMatchObject({ key: "potvrzena", hint: "změna rev 2 odmítnuta" });
    expect(chips[1]).toMatchObject({ phase: "confirmation", key: "odeslano" });
    expect(chips[2]).toMatchObject({ phase: "fulfilment", key: "ve_vyrobe", progress: { label: "1/4 operací" } });
    const st = facts({ stage: "zruseno", inquiryStatus: "zpracovana", orderStatus: "stornovana", orderRevision: 1, lostReason: "jiny_dodavatel" });
    expect(orderChips(st, deriveFlow(st, [], TODAY))[0].label).toBe("Stornovaná — Vybral jiného dodavatele");
  });
});

describe("akce nabídky v přehledu", () => {
  it("rozpracovaná (nabídka super admina): obchodník Odeslat, zaměstnanec nic (#25 — „Předat ke schválení“ zaniklo)", () => {
    const q = quote();
    expect(quoteRowActions({ quote: q, display: "rozpracovana", hasJob: true, current: true }, ctx(SALES)).next?.key).toBe("quote.send");
    const staff = quoteRowActions({ quote: q, display: "rozpracovana", hasJob: true, current: true }, ctx(STAFF));
    expect(staff.next).toBeNull();
    expect(staff.menu).not.toContain("quote.send");
    expect(staff.menu).not.toContain("quote.requestApproval");
  });

  it("#25: neschválenou nabídku (AI i ne-admin) schvaluje jen super admin", () => {
    const ai = quote({ state: "ke_schvaleni", approvalRequired: true, aiGenerated: true });
    const sales = quoteRowActions({ quote: ai, display: "ke_schvaleni", hasJob: true, current: true }, ctx(SALES));
    expect(sales.next).toBeNull();
    expect(sales.menu).not.toContain("quote.approve");
    expect(sales.menu).not.toContain("quote.unapprove");
    const admin = quoteRowActions({ quote: ai, display: "ke_schvaleni", hasJob: true, current: true }, ctx([...SALES, "quote_approval"], { isSuperAdmin: true }));
    expect(admin.next?.key).toBe("quote.approve");
    expect(admin.menu).toContain("quote.approveSend");
    // „Vrátit k přepracování…“ jen když UI umí dialog (withReturn)
    expect(admin.menu).not.toContain("quote.returnToAuthor");
    const withReturn = quoteRowActions({ quote: ai, display: "ke_schvaleni", hasJob: true, current: true },
      ctx([...SALES, "quote_approval"], { isSuperAdmin: true, withReturn: true }));
    expect(withReturn.menu).toContain("quote.returnToAuthor");
  });

  it("#25: schválenou nabídku ne-admina odešle i zaměstnanec — autor; cizí ne", () => {
    const approved = quote({ state: "schvalena", approvalRequired: true, adminApprovalRequired: true, approvedBy: "admin", createdBy: "u1" });
    const author = quoteRowActions({ quote: approved, display: "schvalena", hasJob: true, current: true }, ctx(STAFF));
    expect(author.next?.key).toBe("quote.send");
    expect(author.menu).toEqual(expect.arrayContaining(["quote.send", "quote.markSent"]));
    expect(author.menu).not.toContain("quote.unapprove");
    const other = quoteRowActions({ quote: { ...approved, createdBy: "u7" }, display: "schvalena", hasJob: true, current: true }, ctx(STAFF));
    expect(other.next).toBeNull();
    expect(other.menu).not.toContain("quote.send");
    // řešitel zakázky smí také
    expect(quoteRowActions({ quote: { ...approved, createdBy: "u7" }, display: "schvalena", hasJob: true, current: true, jobAssigneeId: "u1" }, ctx(STAFF)).next?.key)
      .toBe("quote.send");
    // vrácená nabídka: autor „Upravit podle připomínek“
    const returned = quote({ state: "ke_schvaleni", approvalRequired: true, adminApprovalRequired: true, createdBy: "u1", returnedAt: "2026-10-23T08:00:00Z" });
    expect(quoteRowActions({ quote: returned, display: "ke_schvaleni", hasJob: true, current: true }, ctx(STAFF)).next)
      .toEqual({ key: "quote.edit", label: "Upravit podle připomínek" });
  });

  it("odeslaná / vypršelá / připomínky; zaměstnanec jen navrhne zamítnutí; bez zakázky nic", () => {
    const sent = quote({ status: "odeslano", state: "odeslana", sentAt: "2026-10-10T08:00:00Z" });
    const r = quoteRowActions({ quote: sent, display: "odeslana", hasJob: true, current: true }, ctx(SALES));
    expect(r.next?.key).toBe("quote.accept");
    expect(r.menu).toEqual(expect.arrayContaining(["quote.feedback", "quote.newRevision", "quote.extend", "quote.reject"]));
    expect(r.menu.at(-1)).toBe("quote.reject");
    expect(quoteRowActions({ quote: sent, display: "vyprsela", hasJob: true, current: true }, ctx(SALES)).next?.key).toBe("quote.extend");
    const fb = quote({ status: "odeslano", state: "pripominky" });
    expect(quoteRowActions({ quote: fb, display: "pripominky", hasJob: true, current: true }, ctx(SALES)).next?.key).toBe("quote.newRevision");
    expect(quoteRowActions({ quote: sent, display: "odeslana", hasJob: true, current: true }, ctx(STAFF)).menu).toContain("quote.propose");
    expect(quoteRowActions({ quote: sent, display: "odeslana", hasJob: false, current: false }, ctx(SALES))).toEqual({ next: null, menu: [] });
    expect(quoteRowActions({ quote: quote({ state: "zamitnuta", status: "zamitnuto" }), display: "zamitnuta", hasJob: true, current: true }, ctx(SALES)).menu).toEqual(["quote.reopen"]);
  });
});

describe("nabídka bez ceny a e-mail k existující zakázce (review)", () => {
  it("bez ceny: další krok Doplnit cenu, odeslat v menu není", () => {
    const r = quoteRowActions({ quote: quote({ total: null }), display: "rozpracovana", hasJob: true, current: true }, ctx(SALES));
    expect(r.next).toEqual({ key: "quote.edit", label: "Doplnit cenu" });
    expect(r.menu).not.toContain("quote.send");
    expect(r.menu).not.toContain("quote.approveSend");
    expect(quoteRowActions({ quote: quote({ total: null }), display: "rozpracovana", hasJob: false, current: true }, ctx(SALES)).next).toBeNull();
  });

  it("e-mail s číslem objednávky zákazníka existující zakázky → Přiřadit (žádná duplicita)", () => {
    const mail = (p: Partial<FlowEmail>): FlowEmail => ({
      id: "e1", from: "Nákup", fromEmail: "nakup@firma.cz", subject: "Order PO-4500021877", preview: "", category: "Objednávka",
      customer: null, receivedAt: "2026-10-23T08:00:00Z", aiConfidence: 0.9, unread: true, jobId: null, jobNumber: null, ...p,
    });
    const jobs = [{ id: "j104", number: "Z-2026-104", customerOrderNumber: "PO 4500021877" }, { id: "j1", number: "Z-1", customerOrderNumber: "12" }];
    expect(withJobMatches([mail({})], jobs)[0].matchJob).toEqual({ id: "j104", number: "Z-2026-104" });
    expect(withJobMatches([mail({ subject: "Objednávka 12" })], jobs)[0].matchJob).toBeUndefined(); // krátká čísla ne
    expect(withJobMatches([mail({ jobId: "jx" })], jobs)[0].matchJob).toBeUndefined();
  });

  it("pozastavená zakázka: „Pokračovat…“ otevře Korekci stavu rovnou", () => {
    expect(flowActionHref("job.correct", "j1")).toBe("/orders/j1?akce=job.correct");
  });
});

describe("odkazy akcí a menu stránky", () => {
  it("akce mimo stránku vedou do správné záložky karty zakázky", () => {
    expect(flowActionHref("pricing.open", "j1")).toBe("/pricing?job=j1");
    // #25: „Vytvořit nabídku“ vede do Nacenění jen super admina, ostatní rovnou do editoru nabídky
    expect(flowActionHref("quote.create", "j1", { canPrice: true })).toBe("/pricing?job=j1");
    expect(flowActionHref("quote.create", "j1", { canPrice: false })).toBe("/orders/j1?tab=nabidky&nova=1");
    expect(flowActionHref("quote.create", "j1")).toBe("/orders/j1?tab=nabidky&nova=1");
    expect(flowActionHref("pricing.supplierPrice", "j1")).toBe("/orders/j1?tab=nakup");
    expect(flowActionHref("quote.edit", "j1")).toBe("/orders/j1?tab=nabidky");
    expect(flowActionHref("delivery.record", "j1")).toBe("/orders/j1?tab=vyroba");
    expect(flowActionHref("payment.invoice", "j1")).toBe("/orders/j1?tab=vyroba");
    expect(flowActionHref("order.confirm", "j1")).toBeNull();
    expect(flowActionHref("inquiry.take", "j1")).toBeNull();
  });

  it("menu bez korekce stavu a bez vyloučených akcí; barva tlačítka podle fáze", () => {
    expect(pageMenu(["inquiry.wait", "quote.create", "job.correct"], ["quote.create"])).toEqual(["inquiry.wait"]);
    expect(actionPalette("inquiry.take")).toBe("sky.action");
    expect(actionPalette("pricing.open")).toBe("amber.action");
    expect(actionPalette("quote.send")).toBe("violet.action");
    expect(actionPalette("order.confirm")).toBe("orange.action");
    expect(actionPalette("order.resolveMismatch")).toBe("rose.problem");
    expect(actionPalette("order.decideChange")).toBe("indigo.action");
  });

  it("původ dokumentu", () => {
    expect(fileOriginLabel({ origin: "generated", issuer: "my", orderRevision: 2 })).toBe("náš doklad · rev 2");
    expect(fileOriginLabel({ origin: "capture", issuer: "dodavatel", orderRevision: null })).toBe("z fotky · od dodavatele");
    expect(fileOriginLabel({ origin: "upload", issuer: null, orderRevision: null })).toBeNull();
  });
});
