import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import {
  CAUSE_LABELS, CHIP_BASE, CONFIRMATION_STATES, DELIVERY_STATES, FLOW_ACTIONS, FLOW_PALETTE, FULFILMENT_STATES,
  INQUIRY_STATES, INQUIRY_TRANSITIONS, LOST_REASONS, NO_PLAN_META, LOST_JOB_META, CANCELLED_JOB_META, PROPOSAL_META,
  ORDER_STATES, ORDER_TRANSITIONS, PAYMENT_STATES, PILL_FILL, PILL_TRACK, PRICING_STATES, PURCHASE_EXTRA_STATES,
  QUOTE_STATES, QUOTE_TRANSITIONS, VIA_META, actorName, activeQuote, canApproveQuote, canTransition, chipsForTab,
  deliveryProgress, deriveFlow, expectedSubStates, flowRank, initialInquiryStatus, initialOrderStatus, isLostReason,
  lostReasonsFor, menuActions, nextAction, paymentProgress, phaseTrail, primaryChip, productionProgress,
  quoteDisplayState, quoteStateOf, reasonRequired, relativeStampTime, stageEffect, stageEffectText, stampFromRow,
  stampText, stampTitle, transitionFeature, approvalReasons, quoteLabel, flowFactsFromRow, quoteFactsFromRow,
  QUOTE_ACCEPT_BLOCKED, QUOTE_ARCHIVED_SEND, QUOTE_AWAITS_APPROVAL, QUOTE_SEND_NO_RIGHT, approvedStampText,
  quoteApprovalBlock, quoteApprovalFlag, quoteAwaitsApproval, quoteSendBlock, quoteWasSent,
  UNPLANNED_META, NEXT_STEP_META, ROUTE_LATE_META, FINAL_CHANGED_META,
  type ActionCtx, type ChangeStamp, type FlowFacts, type FlowStateMeta, type JobStamps, type QuoteFacts,
} from "./flow-status";
import { STAGES, STAGE_ORDER, stageRank } from "./stages";
import { INITIAL_CASES, SUB_STATE_CASES } from "./__fixtures__/flow-cases";
import type { Feature } from "@/lib/auth/permissions";
import type { ActorKind, ChangeVia, JobStage, QuoteStatus } from "@/lib/supabase/database.types";

const TODAY = "2026-10-23";
const ME = "156c7996-b488-4c53-a3f5-e51dd004f4ad";
const OTHER = "aaaaaaaa-0000-4000-8000-000000000001";

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
    id: "q1", number: "NAB-2026-031", revision: 1, status: "ke_schvaleni", state: "rozpracovana", approvedBy: null,
    approvalRequired: false, createdBy: ME, archived: false, sentAt: null, validUntil: null, aiGenerated: false,
    supersededBy: null, createdAt: "2026-10-01T08:00:00Z", ...p,
  };
}

function ctx(features: Feature[] = ["orders", "workflow", "documents", "margins"], p: Partial<ActionCtx> = {}): ActionCtx {
  return { can: (f) => features.includes(f), userId: ME, isSuperAdmin: false, assigneeId: null, ...p };
}
const SALES = ctx();
const WORKER = ctx(["orders", "workflow", "documents"]);
// #25: super admin má i Nacenění, schvalování nabídek a obchodní tok všech
const ADMIN = ctx(["orders", "workflow", "documents", "margins", "delete", "pricing", "quote_approval", "flow_all"], { isSuperAdmin: true });

const ALL_META: FlowStateMeta[] = [
  ...Object.values(INQUIRY_STATES), ...Object.values(PRICING_STATES), ...Object.values(QUOTE_STATES),
  ...Object.values(ORDER_STATES), ...Object.values(FULFILMENT_STATES), ...Object.values(CONFIRMATION_STATES),
  ...Object.values(DELIVERY_STATES), ...Object.values(PAYMENT_STATES), ...Object.values(PURCHASE_EXTRA_STATES),
  NO_PLAN_META, LOST_JOB_META, CANCELLED_JOB_META, PROPOSAL_META,
  UNPLANNED_META, NEXT_STEP_META, ROUTE_LATE_META, FINAL_CHANGED_META,
];

// ── Meta a paleta ───────────────────────────────────────────
describe("meta stavů a paleta", () => {
  it("každá meta má štítky, popis, ikonu a existující klíč palety", () => {
    for (const m of ALL_META) {
      expect(m.label.trim(), m.key).not.toBe("");
      expect(m.short.trim(), m.key).not.toBe("");
      expect(m.description.trim(), m.key).not.toBe("");
      expect(m.icon, m.key).toBeTruthy();
      expect(FLOW_PALETTE[m.palette], `${m.key} → ${m.palette}`).toBeDefined();
    }
  });

  it("klíč v meta = klíč záznamu", () => {
    for (const table of [INQUIRY_STATES, PRICING_STATES, QUOTE_STATES, ORDER_STATES, FULFILMENT_STATES,
      CONFIRMATION_STATES, DELIVERY_STATES, PAYMENT_STATES, PURCHASE_EXTRA_STATES] as Record<string, FlowStateMeta>[]) {
      for (const [k, m] of Object.entries(table)) expect(m.key).toBe(k);
    }
    for (const [k, a] of Object.entries(FLOW_ACTIONS)) {
      expect(a.key).toBe(k);
      expect(a.label.trim()).not.toBe("");
    }
  });

  it("třídy jsou celé literály (JIT) — barva má odstín i stupeň", () => {
    const special = /^(bg|text|ring|border)-(white|transparent|muted|muted-foreground|dashed|inset|1)$/;
    const shaded = /^(bg|text|ring|border)-[a-z]+-\d{2,3}(\/\d{1,3})?$/;
    const alpha = /^(bg-black\/10|bg-white\/15|border-muted-foreground\/40)$/;
    const all = [
      ...Object.values(FLOW_PALETTE).flatMap((p) => [p.badge, p.dot, p.solid, p.text]),
      ...Object.values(PILL_FILL), CHIP_BASE, PILL_TRACK,
    ];
    for (const cls of all) {
      expect(cls).not.toContain("${");
      for (const raw of cls.split(/\s+/).filter(Boolean)) {
        const t = raw.replace(/^dark:/, "");
        if (!/^(bg|text|ring|border)-/.test(t)) continue;
        if (/^text-(xs|sm|base|\[)/.test(t)) continue;
        expect(special.test(t) || shaded.test(t) || alpha.test(t), `${raw} v „${cls}“`).toBe(true);
      }
    }
  });

  it("každý způsob zápisu má popisek a ikonu", () => {
    for (const v of ["rucne", "ai", "foto", "email", "automaticky", "import", "cron", "rest", "db"] as ChangeVia[]) {
      expect(VIA_META[v].label).toBeTruthy();
      expect(VIA_META[v].icon).toBeTruthy();
    }
  });
});

// ── Přechody, práva, důvody ─────────────────────────────────
describe("přechody, práva a důvody", () => {
  it("poptávka", () => {
    expect(canTransition("inquiry", "prijata", "v_reseni")).toBe(true);
    expect(canTransition("inquiry", "ceka_na_podklady", "v_reseni")).toBe(true);
    expect(canTransition("inquiry", "odmitnuta", "prijata")).toBe(true);
    expect(canTransition("inquiry", "zpracovana", "v_reseni")).toBe(false);
    expect(canTransition("inquiry", null, "v_reseni")).toBe(false);
    expect(canTransition("inquiry", "v_reseni", "prijata")).toBe(false);
    expect(INQUIRY_TRANSITIONS.zpracovana).toEqual([]);
    expect(transitionFeature("inquiry", "odmitnuta")).toBe("margins");
    expect(transitionFeature("inquiry", "stazena")).toBe("margins");
    expect(transitionFeature("inquiry", "v_reseni", "odmitnuta")).toBe("margins");
    expect(transitionFeature("inquiry", "ceka_na_podklady")).toBe("workflow");
    expect(reasonRequired("inquiry", "odmitnuta")).toBe(true);
    expect(reasonRequired("inquiry", "ceka_na_podklady")).toBe(false);
  });

  it("nabídka", () => {
    expect(canTransition("quote", "rozpracovana", "odeslana")).toBe(true);
    expect(canTransition("quote", "ke_schvaleni", "odeslana")).toBe(false);
    expect(canTransition("quote", "zamitnuta", "odeslana")).toBe(true);
    expect(canTransition("quote", "prijata", "zamitnuta")).toBe(false);
    expect(QUOTE_TRANSITIONS.archivovana).toEqual([]);
    // #25: schválit / zrušit schválení jen super admin; odeslat rozpracovanou či schválenou = workflow (+ quoteSendBlock)
    expect(transitionFeature("quote", "schvalena", "ke_schvaleni")).toBe("quote_approval");
    expect(transitionFeature("quote", "rozpracovana", "schvalena")).toBe("quote_approval");
    expect(transitionFeature("quote", "odeslana", "schvalena")).toBe("workflow");
    expect(transitionFeature("quote", "odeslana", "rozpracovana")).toBe("workflow");
    expect(transitionFeature("quote", "odeslana", "pripominky")).toBe("margins");
    expect(transitionFeature("quote", "odeslana", "zamitnuta")).toBe("margins");
    expect(transitionFeature("quote", "odeslana")).toBe("margins");
    expect(transitionFeature("quote", "zamitnuta")).toBe("margins");
    for (const to of ["ke_schvaleni", "pripominky", "prijata"]) expect(transitionFeature("quote", to)).toBe("workflow");
    expect(QUOTE_TRANSITIONS.rozpracovana).toEqual(["odeslana"]);
    expect(QUOTE_TRANSITIONS.ke_schvaleni).toEqual(["schvalena"]);
    expect(QUOTE_TRANSITIONS.schvalena).toEqual(["odeslana", "rozpracovana"]);
    expect(reasonRequired("quote", "zamitnuta")).toBe(true);
  });

  it("objednávka a hlavní stav", () => {
    expect(canTransition("order", "dorucena", "potvrzena")).toBe(true);
    expect(canTransition("order", "potvrzena", "dorucena")).toBe(false);
    expect(canTransition("order", "stornovana", "potvrzena")).toBe(true);
    expect(ORDER_TRANSITIONS.aktualizovana).toEqual(["potvrzena", "stornovana"]);
    expect(transitionFeature("order", "stornovana")).toBe("margins");
    expect(transitionFeature("order", "dorucena", "stornovana")).toBe("delete");
    expect(transitionFeature("order", "rozpor", "dorucena")).toBe("workflow");
    expect(transitionFeature("job", "nerealizovano")).toBe("margins");
    expect(transitionFeature("job", "ve_vyrobe")).toBe("orders");
    expect(reasonRequired("order", "stornovana")).toBe(true);
    expect(reasonRequired("job", "zruseno")).toBe(true);
    expect(reasonRequired("job", "pozastaveno")).toBe(false);
  });

  it("důvody: bez „neuvedeno“, odmítnutá jen naše strana, stažená jen zákazník", () => {
    for (const ph of ["inquiry", "quote", "order", "job"] as const) expect(lostReasonsFor(ph)).not.toContain("neuvedeno");
    expect(lostReasonsFor("inquiry", "odmitnuta")).toEqual(["nevyrabime", "kapacita", "nevyplati_se", "duplicita", "jine"]);
    expect(lostReasonsFor("inquiry", "stazena")).toEqual(["projekt_zrusen", "bez_odezvy", "zakaznik_stahl", "jine"]);
    expect(lostReasonsFor("quote")).toContain("cena");
    expect(lostReasonsFor("quote")).not.toContain("kapacita");
    expect(lostReasonsFor("order")).toEqual(["jiny_dodavatel", "projekt_zrusen", "zakaznik_stahl", "jine"]);
    expect(isLostReason("cena")).toBe(true);
    expect(isLostReason("hokus")).toBe(false);
  });
});

// ── Stav nabídky ────────────────────────────────────────────
describe("quoteStateOf (= quote_state_of)", () => {
  const statuses: QuoteStatus[] = ["navrh_ai", "ke_schvaleni", "odeslano", "prijato", "zamitnuto"];
  it("všechny kombinace podle pořadí pravidel", () => {
    for (const status of statuses) for (const approved of [null, ME]) for (const archived of [false, true])
      for (const required of [false, true]) for (const fb of [null, "2026-10-02T10:00:00Z", "2026-09-30T10:00:00Z"]) {
        const got = quoteStateOf({ status, approvedBy: approved, archived, approvalRequired: required, feedbackAt: fb, sentAt: "2026-10-01T10:00:00Z" });
        let want: string;
        if (status === "prijato") want = "prijata";
        else if (status === "zamitnuto") want = "zamitnuta";
        else if (archived) want = "archivovana";
        else if (status === "odeslano") want = fb === "2026-10-02T10:00:00Z" ? "pripominky" : "odeslana";
        else if (approved) want = "schvalena";
        else if (required) want = "ke_schvaleni";
        else want = "rozpracovana";
        expect(got, `${status}/${approved}/${archived}/${required}/${fb}`).toBe(want);
      }
  });

  it("připomínky bez data odeslání; vypršelá platnost jen u odeslané", () => {
    expect(quoteStateOf({ status: "odeslano", approvedBy: null, archived: false, approvalRequired: false, feedbackAt: "2026-10-01T00:00:00Z", sentAt: null })).toBe("pripominky");
    expect(quoteDisplayState({ state: "odeslana", validUntil: "2026-10-22" }, TODAY)).toBe("vyprsela");
    expect(quoteDisplayState({ state: "pripominky", validUntil: "2026-10-22" }, TODAY)).toBe("vyprsela");
    expect(quoteDisplayState({ state: "odeslana", validUntil: TODAY }, TODAY)).toBe("odeslana");
    expect(quoteDisplayState({ state: "rozpracovana", validUntil: "2026-01-01" }, TODAY)).toBe("rozpracovana");
  });

  it("aktivní nabídka: přijatá > nearchivovaná s nejvyšší revizí > nejnovější", () => {
    const a = quote({ id: "a", revision: 1, state: "odeslana", archived: true });
    const b = quote({ id: "b", revision: 2, state: "odeslana" });
    const c = quote({ id: "c", revision: 1, state: "prijata", archived: true });
    expect(activeQuote([a, b])?.id).toBe("b");
    expect(activeQuote([a, b, c])?.id).toBe("c");
    expect(activeQuote([quote({ id: "x", archived: true, createdAt: "2026-01-01" }), quote({ id: "y", archived: true, createdAt: "2026-02-01" })])?.id).toBe("y");
    expect(activeQuote([])).toBeNull();
  });

  it("štítek nabídky s revizí", () => {
    expect(quoteLabel({ number: "NAB-2026-031", revision: 2 })).toBe("NAB-2026-031 r2");
    expect(quoteLabel({ number: "NAB-2026-031-R2", revision: 2 })).toBe("NAB-2026-031-R2");
    expect(quoteLabel({ number: null, revision: 1 })).toBe("Nabídka");
  });
});

// ── Invarianty a výchozí stavy (= orders_stage_change, flow_initial_*) ──
describe("dílčí stavy podle hlavního stavu", () => {
  it.each(SUB_STATE_CASES)("$name", (c) => {
    expect(expectedSubStates(c.stage, { inquiryStatus: c.inquiry, orderStatus: c.order, lostReason: c.lostReason ?? null, prevStage: c.prevStage }))
      .toEqual({ inquiryStatus: c.expect.inquiry, orderStatus: c.expect.order });
  });

  it.each(INITIAL_CASES)("výchozí stav $number", (c) => {
    expect(initialInquiryStatus({ stage: c.stage, source: c.source, inquiryDate: c.inquiryDate, inquiryNumber: c.inquiryNumber,
      orderDate: c.orderDate, orderNumber: c.orderNumber, pricedBy: null })).toBe(c.inquiry);
    expect(initialOrderStatus({ stage: c.stage, orderDate: c.orderDate, orderNumber: c.orderNumber, confirmedAt: c.confirmedAt })).toBe(c.order);
  });

  it("pořadí stavu = stages.ts", () => {
    for (const s of STAGE_ORDER) expect(flowRank(s)).toBe(stageRank(s));
  });
});

// ── Odvození (= job_flow_v) ─────────────────────────────────
describe("deriveFlow — hraniční případy", () => {
  const order = (p: Partial<FlowFacts>) => facts({ inquiryStatus: "zpracovana", orderStatus: "potvrzena", orderRevision: 1, orderConfirmedRevision: 1, ...p });

  it("nacenění", () => {
    expect(deriveFlow(facts({ stage: "naceneni", inquiryStatus: "v_reseni" }), [], TODAY).pricing).toBe("ceka");
    expect(deriveFlow(facts({ stage: "naceneni", itemsCount: 3, itemsPriced: 1 }), [], TODAY).pricing).toBe("rozpracovano");
    expect(deriveFlow(facts({ stage: "naceneni", itemsCount: 3, itemsPriced: 1, pendingSupplierQuotes: 2 }), [], TODAY).pricing).toBe("ceka_na_dodavatele");
    expect(deriveFlow(facts({ stage: "poptavka", itemsCount: 2, itemsPriced: 2, pendingSupplierQuotes: 1 }), [], TODAY).pricing).toBe("naceneno");
    expect(deriveFlow(facts({ stage: "nabidka" }), [], TODAY).pricing).toBeNull();
  });

  it("dodání: nic / částečně / plně / uzavřeno s menším / bez položek / staré bez evidence", () => {
    expect(deriveFlow(order({ stage: "ve_vyrobe", itemsCount: 2 }), [], TODAY).delivery).toBeNull();
    const part = deriveFlow(order({ stage: "ve_vyrobe", itemsCount: 3, itemsDelivered: 1, itemsPartial: 1 }), [], TODAY);
    expect([part.delivery, part.fulfilment]).toEqual(["castecne", "castecne_dodana"]);
    const onlyPartial = deriveFlow(order({ stage: "ve_vyrobe", itemsCount: 2, itemsPartial: 1 }), [], TODAY);
    expect(onlyPartial.delivery).toBe("castecne");
    const full = deriveFlow(order({ stage: "dodano_zakaznikovi", itemsCount: 2, itemsDelivered: 2, lastDeliveryAt: "2026-10-20T09:00:00Z" }), [], TODAY);
    expect([full.delivery, full.fulfilment]).toEqual(["dodano", "dokoncena"]);
    // 2/2 dodáno, stav ještě ručně ve výrobě → dodání hotové (posun dělá DB)
    expect(deriveFlow(order({ stage: "ve_vyrobe", itemsCount: 2, itemsDelivered: 2 }), [], TODAY).delivery).toBe("dodano");
    expect(deriveFlow(order({ stage: "na_sklade", itemsCount: 0, partialDeliveryAt: "2026-10-20T09:00:00Z" }), [], TODAY).delivery).toBe("castecne");
    expect(deriveFlow(order({ stage: "dodano_zakaznikovi", itemsCount: 0 }), [], TODAY).delivery).toBe("dodano");
    expect(deriveFlow(order({ stage: "fakturovano", itemsCount: 1 }), [], TODAY).delivery).toBe("dodano");
    expect(deriveFlow(order({ stage: "ve_vyrobe", productionDone: 3, productionTotal: 3 }), [], TODAY).delivery).toBe("k_expedici");
    expect(deriveFlow(order({ stage: "dodano_k_nam" }), [], TODAY).delivery).toBe("k_expedici");
    expect(deriveFlow(order({ stage: "reklamace", itemsCount: 1, itemsDelivered: 1 }), [], TODAY).delivery).toBeNull();
    expect(deriveFlow(order({ stage: "reklamace" }), [], TODAY).fulfilment).toBeNull();
  });

  it("DL potvrzený před další dodávkou neplatí", () => {
    const base = { stage: "dodano_zakaznikovi" as JobStage, itemsCount: 2, itemsDelivered: 2 };
    expect(deriveFlow(order({ ...base, lastDeliveryAt: "2026-10-20T09:00:00Z", deliveryNoteConfirmedAt: "2026-10-21" }), [], TODAY).delivery).toBe("dl_potvrzen");
    expect(deriveFlow(order({ ...base, lastDeliveryAt: "2026-10-22T09:00:00Z", deliveryNoteConfirmedAt: "2026-10-21" }), [], TODAY).delivery).toBe("dodano");
    // pražský den: dodávka 22. 10. 23:30 UTC = 23. 10. v Praze
    expect(deriveFlow(order({ ...base, lastDeliveryAt: "2026-10-22T23:30:00Z", deliveryNoteConfirmedAt: "2026-10-22" }), [], TODAY).delivery).toBe("dodano");
    expect(deriveFlow(order({ ...base, lastDeliveryAt: null, deliveryNoteConfirmedAt: "2026-10-21" }), [], TODAY).delivery).toBe("dl_potvrzen");
  });

  it("platba: po splatnosti + částečně, záloha před fakturou, zaplaceno", () => {
    expect(deriveFlow(order({ stage: "ve_vyrobe" }), [], TODAY).payment).toBeNull();
    expect(deriveFlow(order({ stage: "ve_vyrobe", paidSoFar: 5000 }), [], TODAY).payment).toBe("castecne_zaplaceno");
    expect(deriveFlow(order({ stage: "fakturovano" }), [], TODAY).payment).toBe("ceka_na_uhradu");
    expect(deriveFlow(order({ stage: "fakturovano", invoiceDueDate: "2026-10-22", paidSoFar: 100 }), [], TODAY).payment).toBe("po_splatnosti");
    expect(deriveFlow(order({ stage: "dodano_zakaznikovi", invoiceNumber: "FV-1" }), [], TODAY).payment).toBe("ceka_na_uhradu");
    expect(deriveFlow(order({ stage: "dokonceno" }), [], TODAY).payment).toBe("zaplaceno");
    expect(deriveFlow(order({ stage: "fakturovano", paidAt: "2026-10-20" }), [], TODAY).payment).toBe("zaplaceno");
    expect(deriveFlow(order({ stage: "zruseno", paidAt: "2026-10-20" }), [], TODAY).payment).toBeNull();
  });

  it("potvrzení: rev 1 vs. rev 2, „změnu nepřijímáme“, vystaveno", () => {
    expect(deriveFlow(order({ stage: "potvrzeno" }), [], TODAY).confirmation).toBe("bez_dokladu");
    expect(deriveFlow(order({ stage: "potvrzeno", confirmationSentRevision: 1 }), [], TODAY).confirmation).toBe("odeslano");
    // změna rev 2 přijata, odeslané potvrzení jen k rev 1
    expect(deriveFlow(order({ stage: "potvrzeno", orderRevision: 2, orderConfirmedRevision: 2, confirmationSentRevision: 1 }), [], TODAY).confirmation).toBe("bez_dokladu");
    // změna rev 2 odmítnuta → potvrzená zůstává rev 1, potvrzení rev 1 platí
    expect(deriveFlow(order({ stage: "potvrzeno", orderRevision: 2, orderConfirmedRevision: 1, confirmationSentRevision: 1 }), [], TODAY).confirmation).toBe("odeslano");
    expect(deriveFlow(order({ stage: "objednavka", orderStatus: "dorucena", orderConfirmedRevision: null }), [], TODAY).confirmation).toBe("k_vystaveni");
    expect(deriveFlow(order({ stage: "objednavka", orderStatus: "dorucena", confirmationIssuedRevision: 1 }), [], TODAY).confirmation).toBe("vystaveno");
    expect(deriveFlow(order({ stage: "potvrzeno", orderStatus: "aktualizovana", orderRevision: 2, confirmationIssuedRevision: 1 }), [], TODAY).confirmation).toBe("k_vystaveni");
    expect(deriveFlow(order({ stage: "zruseno", orderStatus: "stornovana" }), [], TODAY).confirmation).toBeNull();
  });

  it("čekání ve dnech a objednáno bez přijaté nabídky", () => {
    expect(deriveFlow(facts({ inquiryStatus: "ceka_na_podklady", waitingSince: "2026-10-20T10:00:00Z" }), [], TODAY).waitingDays).toBe(3);
    const sent = quote({ status: "odeslano", state: "odeslana", sentAt: "2026-10-16T10:00:00Z" });
    expect(deriveFlow(facts({ stage: "nabidka", inquiryStatus: "zpracovana" }), [sent], TODAY).waitingDays).toBe(7);
    expect(deriveFlow(order({ stage: "objednavka", orderStatus: "rozpor", orderStatusChangedAt: "2026-10-22T10:00:00Z" }), [], TODAY).waitingDays).toBe(1);
    expect(deriveFlow(order({ stage: "objednavka", orderStatus: "dorucena" }), [sent], TODAY).orderedWithoutQuote).toBe(true);
    expect(deriveFlow(order({ stage: "objednavka", orderStatus: "dorucena" }), [quote({ state: "prijata", status: "prijato" })], TODAY).orderedWithoutQuote).toBe(false);
    expect(deriveFlow(order({ stage: "objednavka", orderStatus: "dorucena" }), [], TODAY).orderedWithoutQuote).toBe(false);
  });
});

describe("průběh (pilulky)", () => {
  it("po položkách, nikdy součet kusů; operace; úhrady bez marží jen %", () => {
    expect(deliveryProgress(facts({ itemsCount: 3, itemsDelivered: 2 }))).toMatchObject({ done: 2, total: 3, label: "2/3 položek", pct: 67 });
    expect(deliveryProgress(facts({ itemsCount: 1, itemsDelivered: 0 }))?.label).toBe("0/1 položky");
    expect(deliveryProgress(facts({ itemsCount: 0 }))).toBeNull();
    expect(productionProgress(facts({ productionDone: 3, productionTotal: 5 }))?.label).toBe("3/5 operací");
    expect(paymentProgress({ ...facts({ paidSoFar: 30_000 }), value: 100_000 }, false)).toMatchObject({ label: "30 %", pct: 30 });
    expect(paymentProgress({ ...facts({ paidSoFar: 30_000 }), value: 100_000 }, true)?.label).toContain("Kč");
    expect(paymentProgress({ ...facts({ paidSoFar: 0 }), value: 100_000 }, true)).toBeNull();
  });
});

// ── Další krok ──────────────────────────────────────────────
describe("nextAction (tabulka 1.12)", () => {
  const snap = (f: FlowFacts, q: QuoteFacts[] = []) => deriveFlow(f, q, TODAY);
  const next = (f: FlowFacts, q: QuoteFacts[] = [], c: ActionCtx = SALES) => nextAction(f, snap(f, q), c);

  it("poptávka: převzít / převzít od X / podklady máme", () => {
    expect(next(facts())).toEqual({ key: "inquiry.take", label: "Převzít" });
    expect(next(facts({ assigneeId: OTHER }), [], { ...SALES, assigneeId: OTHER, assigneeName: "Jan Novák" })).toEqual({ key: "inquiry.take", label: "Převzít od Jan Novák" });
    expect(next(facts({ inquiryStatus: "ceka_na_podklady" }))?.key).toBe("inquiry.resume");
  });

  it("nacenění a nabídka podle práva", () => {
    const f = facts({ stage: "naceneni", inquiryStatus: "v_reseni" });
    // #25: Nacenění jen super admin — obchodník i zaměstnanec rovnou „Vytvořit nabídku“
    expect(next(f, [], ADMIN)?.key).toBe("pricing.open");
    expect(next(f)?.key).toBe("quote.create");
    expect(next(f, [], WORKER)?.key).toBe("quote.create");
    expect(next({ ...f, itemsCount: 2, itemsPriced: 2 })?.key).toBe("quote.create");
    expect(next({ ...f, pendingSupplierQuotes: 1 })?.key).toBe("pricing.supplierPrice");
    expect(next({ ...f, pendingSupplierQuotes: 1 }, [], WORKER)?.key).toBe("quote.create");
    expect(next({ ...f, pendingSupplierQuotes: 1 }, [], ADMIN)?.key).toBe("pricing.supplierPrice");
    const draft = quote({ state: "rozpracovana" });
    expect(next(f, [draft])?.key).toBe("quote.send");
    // rozpracovaná (nabídka super admina) — zaměstnanec ji neodesílá a „Předat ke schválení“ zaniklo
    expect(next(f, [draft], WORKER)).toBeNull();
    const pending = quote({ state: "ke_schvaleni", approvalRequired: true, aiGenerated: true });
    expect(next(f, [pending], ADMIN)?.key).toBe("quote.approve");
    expect(next(f, [pending])).toBeNull();
    expect(next(f, [pending], WORKER)).toBeNull();
    expect(next(f, [quote({ state: "schvalena", approvedBy: ME })])?.key).toBe("quote.send");
  });

  it("nabídka bez ceny: další krok Doplnit cenu, odeslat ani schválit a odeslat v menu není (review UX 5)", () => {
    const f = facts({ stage: "naceneni", inquiryStatus: "v_reseni" });
    const q = quote({ state: "rozpracovana", total: null });
    expect(next(f, [q])).toEqual({ key: "quote.edit", label: "Doplnit cenu" });
    const menu = menuActions(f, deriveFlow(f, [q], TODAY), SALES);
    expect(menu).not.toContain("quote.send");
    expect(menu).not.toContain("quote.markSent");
    expect(next(f, [quote({ state: "rozpracovana", total: 1200 })])?.key).toBe("quote.send");
    // total neznámý (nenačtený) ≠ bez ceny
    expect(next(f, [quote({ state: "rozpracovana" })])?.key).toBe("quote.send");
  });

  it("finance jen s právem na marže: faktura, úhrada, korekce na Vyfakturováno / Dokončeno (review UX 17)", () => {
    for (const k of ["payment.invoice", "payment.record", "payment.settle"] as const) expect(FLOW_ACTIONS[k].feature).toBe("margins");
    expect(transitionFeature("job", "fakturovano")).toBe("margins");
    expect(transitionFeature("job", "dokonceno")).toBe("margins");
    expect(transitionFeature("job", "ve_vyrobe")).toBe("orders");
    const f = facts({ stage: "fakturovano", inquiryStatus: "zpracovana", orderStatus: "potvrzena", orderRevision: 1 });
    expect(next(f, [], WORKER)).toBeNull();
    expect(next(f)?.key).toBe("payment.record");
  });

  it("odeslaná nabídka: zákazník objednal / nová verze / prodloužit", () => {
    const f = facts({ stage: "nabidka", inquiryStatus: "zpracovana" });
    expect(next(f, [quote({ status: "odeslano", state: "odeslana", validUntil: "2026-12-01" })])?.key).toBe("quote.accept");
    expect(next(f, [quote({ status: "odeslano", state: "pripominky" })])?.key).toBe("quote.newRevision");
    expect(next(f, [quote({ status: "odeslano", state: "odeslana", validUntil: "2026-10-01" })])?.key).toBe("quote.extend");
  });

  it("objednávka, potvrzení, výroba, dodání, faktura", () => {
    const o = (p: Partial<FlowFacts>) => facts({ inquiryStatus: "zpracovana", orderRevision: 1, ...p });
    expect(next(o({ stage: "objednavka", orderStatus: "dorucena" }))?.key).toBe("order.confirm");
    expect(next(o({ stage: "objednavka", orderStatus: "rozpor" }))?.key).toBe("order.resolveMismatch");
    expect(next(o({ stage: "ve_vyrobe", orderStatus: "aktualizovana", orderRevision: 2, orderConfirmedRevision: 1 }))?.key).toBe("order.decideChange");
    expect(next(o({ stage: "potvrzeno", orderStatus: "potvrzena", orderConfirmedRevision: 1 }))?.key).toBe("order.sendConfirmation");
    // potvrzená objednávka → vždy předání do výroby (i s připraveným postupem / objednávkou z Nákupu)
    expect(next(o({ stage: "potvrzeno", orderStatus: "potvrzena", orderConfirmedRevision: 1, confirmationSentRevision: 1 }))).toEqual({ key: "production.handoff", label: "Předat do výroby…" });
    expect(next(o({ stage: "potvrzeno", orderStatus: "potvrzena", orderConfirmedRevision: 1, confirmationSentRevision: 1, hasOperations: true }))?.key).toBe("production.handoff");
    const vv = o({ stage: "ve_vyrobe", orderStatus: "potvrzena", orderConfirmedRevision: 1, confirmationSentRevision: 1 });
    expect(next({ ...vv, itemsCount: 2, itemsDelivered: 1 })).toEqual({ key: "delivery.record", label: "Dodat zbytek" });
    expect(next({ ...vv, productionDone: 2, productionTotal: 2 })).toEqual({ key: "delivery.record", label: "Zapsat dodání" });
    // ve výrobě bez kroků (starší zakázka) → doplnit kdo a termín (dřív žádný další krok)
    expect(next(vv)).toEqual({ key: "production.handoff", label: "Doplnit kdo a termín…" });
    // ve výrobě bez odeslaného potvrzení: dodání má přednost, potvrzení jen v menu (review UX 3)
    const noDoc = o({ stage: "ve_vyrobe", orderStatus: "potvrzena", orderConfirmedRevision: 1, itemsCount: 2, itemsDelivered: 1 });
    expect(next(noDoc)).toEqual({ key: "delivery.record", label: "Dodat zbytek" });
    expect(next(o({ stage: "ve_vyrobe", orderStatus: "potvrzena", orderConfirmedRevision: 1 }))?.key).toBe("production.handoff");
    expect(menuActions(noDoc, deriveFlow(noDoc, [], TODAY), SALES)).toContain("order.sendConfirmation");
    const dz = o({ stage: "dodano_zakaznikovi", orderStatus: "potvrzena", orderConfirmedRevision: 1, confirmationSentRevision: 1 });
    expect(next(dz)?.key).toBe("delivery.confirmNote");
    expect(next({ ...dz, deliveryNoteConfirmedAt: "2026-10-20" })?.key).toBe("payment.invoice");
    expect(next(o({ stage: "fakturovano", orderStatus: "potvrzena" }))?.key).toBe("payment.record");
    for (const s of ["dokonceno", "reklamace", "nerealizovano", "zruseno"] as JobStage[]) expect(next(o({ stage: s }))).toBeNull();
    // pozastavená: jediný krok = rozhodnout, kde pokračovat (Korekce stavu)
    expect(next(o({ stage: "pozastaveno" }))).toEqual({ key: "job.correct", label: "Pokračovat…" });
  });

  it("návrh má přednost pro toho, kdo smí rozhodnout", () => {
    const f = facts({ proposal: { phase: "inquiry", to: "odmitnuta", kind: "user", label: "Odmítnout poptávku — Kapacita", reason: "kapacita" } });
    expect(next(f)?.key).toBe("proposal.decide");
    expect(next(f, [], WORKER)?.key).toBe("inquiry.take");
  });
});

describe("menuActions", () => {
  it("bez práva „Navrhnout…“, destruktivní dole, korekce na konci", () => {
    const f = facts({ inquiryStatus: "v_reseni" });
    const sales = menuActions(f, deriveFlow(f, [], TODAY), SALES);
    expect(sales).toContain("inquiry.decline");
    expect(sales.at(-1)).toBe("job.correct");
    const firstDanger = sales.findIndex((k) => FLOW_ACTIONS[k].intent === "danger");
    expect(sales.slice(firstDanger, -1).every((k) => FLOW_ACTIONS[k].intent === "danger")).toBe(true);
    const worker = menuActions(f, deriveFlow(f, [], TODAY), WORKER);
    expect(worker).toContain("inquiry.propose");
    expect(worker).not.toContain("inquiry.decline");
  });

  it("objednávka: storno jen s právem, obnovení jen admin", () => {
    const f = facts({ stage: "objednavka", inquiryStatus: "zpracovana", orderStatus: "dorucena", orderRevision: 1 });
    expect(menuActions(f, deriveFlow(f, [], TODAY), SALES)).toContain("order.cancel");
    expect(menuActions(f, deriveFlow(f, [], TODAY), WORKER)).toContain("order.propose");
    const z = facts({ stage: "zruseno", inquiryStatus: "zpracovana", orderStatus: "stornovana", orderRevision: 1 });
    expect(menuActions(z, deriveFlow(z, [], TODAY), SALES)).not.toContain("order.reopen");
    expect(menuActions(z, deriveFlow(z, [], TODAY), ADMIN)).toContain("order.reopen");
  });

  it("#25: schvaluje jen super admin (quote_approval) — neschválenou, nearchivovanou, s cenou", () => {
    const own = quote({ state: "ke_schvaleni", approvalRequired: true, adminApprovalRequired: true, createdBy: ME, total: 500_000 });
    expect(approvalReasons(own)).toMatchObject({ ai: false, author: true });
    expect(canApproveQuote(own, SALES)).toBe(false);
    expect(canApproveQuote(own, ADMIN)).toBe(true);
    const ai = quote({ state: "ke_schvaleni", approvalRequired: true, aiGenerated: true, createdBy: ME });
    expect(approvalReasons(ai)).toMatchObject({ ai: true, author: false });
    expect(canApproveQuote(ai, SALES)).toBe(false);
    expect(canApproveQuote(ai, WORKER)).toBe(false);
    expect(canApproveQuote(ai, ADMIN)).toBe(true);
    expect(canApproveQuote(quote({ state: "odeslana", status: "odeslano" }), ADMIN)).toBe(false);
    expect(canApproveQuote(quote({ state: "schvalena", approvedBy: OTHER }), ADMIN)).toBe(false);
    expect(canApproveQuote({ ...own, archived: true }, ADMIN)).toBe(false);
    expect(canApproveQuote({ ...own, total: null }, ADMIN)).toBe(false);
  });

  it("#25: menu nabídky — bez „Předat ke schválení“; zrušit schválení jen u schválené; odeslat dle quoteSendBlock", () => {
    const f = facts({ stage: "naceneni", inquiryStatus: "v_reseni" });
    const pending = quote({ state: "ke_schvaleni", approvalRequired: true, adminApprovalRequired: true, createdBy: OTHER, total: 1000 });
    const salesMenu = menuActions(f, deriveFlow(f, [pending], TODAY), SALES);
    expect(salesMenu).not.toContain("quote.requestApproval");
    expect(salesMenu).not.toContain("quote.approve");
    expect(salesMenu).not.toContain("quote.unapprove");
    expect(salesMenu).not.toContain("quote.send");
    const adminMenu = menuActions(f, deriveFlow(f, [pending], TODAY), ADMIN);
    expect(adminMenu).toEqual(expect.arrayContaining(["quote.approve", "quote.approveSend"]));
    expect(adminMenu).not.toContain("quote.unapprove");
    expect(adminMenu).not.toContain("quote.returnToAuthor"); // až s dialogem (withReturn, 25-C)
    expect(menuActions(f, deriveFlow(f, [pending], TODAY), { ...ADMIN, withReturn: true })).toContain("quote.returnToAuthor");
    const approved = { ...pending, state: "schvalena" as const, approvedBy: ME };
    const workerAuthor = ctx(["orders", "workflow", "documents"], { userId: OTHER });
    const wm = menuActions(f, deriveFlow(f, [approved], TODAY), workerAuthor);
    expect(wm).toEqual(expect.arrayContaining(["quote.send", "quote.markSent"]));
    expect(wm).not.toContain("quote.unapprove");
    expect(menuActions(f, deriveFlow(f, [approved], TODAY), WORKER)).not.toContain("quote.send");
    expect(menuActions(f, deriveFlow(f, [approved], TODAY), ADMIN)).toContain("quote.unapprove");
    // vrácená nabídka: autor „Upravit podle připomínek“
    const returned = { ...pending, returnedAt: "2026-10-23T08:00:00Z", returnNote: "doplň termín" };
    expect(nextAction(f, deriveFlow(f, [returned], TODAY), workerAuthor)).toEqual({ key: "quote.edit", label: "Upravit podle připomínek" });
    expect(nextAction(f, deriveFlow(f, [returned], TODAY), WORKER)).toBeNull();
    // super admin vrácenou primárně neschvaluje (čeká se na autora); „Schválit“ zůstává v menu
    expect(nextAction(f, deriveFlow(f, [pending], TODAY), ADMIN)?.key).toBe("quote.approve");
    expect(nextAction(f, deriveFlow(f, [returned], TODAY), ADMIN)).toBeNull();
    expect(menuActions(f, deriveFlow(f, [returned], TODAY), ADMIN)).toContain("quote.approve");
  });
});

describe("schvalování nabídek super adminem (#25)", () => {
  it("FLOW_ACTIONS: schválit / vrátit jen quote_approval, odeslat workflow, Nacenit pricing", () => {
    for (const k of ["quote.approve", "quote.approveSend", "quote.unapprove", "quote.returnToAuthor"] as const) {
      expect(FLOW_ACTIONS[k].feature, k).toBe("quote_approval");
    }
    expect(FLOW_ACTIONS["quote.send"].feature).toBe("workflow");
    expect(FLOW_ACTIONS["quote.markSent"].feature).toBe("workflow");
    expect(FLOW_ACTIONS["pricing.open"].feature).toBe("pricing");
    expect(FLOW_ACTIONS["pricing.supplierPrice"].feature).toBe("margins");
    expect(FLOW_ACTIONS["quote.returnToAuthor"]).toMatchObject({ label: "Vrátit k přepracování…", kind: "dialog" });
    expect(QUOTE_STATES.ke_schvaleni.label).toBe("Neschválená");
    expect(QUOTE_STATES.ke_schvaleni.description).toContain("čeká na schválení super admina");
    expect(PRICING_STATES.ceka.label).toBe("Bez ceny");
    expect(PRICING_STATES.ceka.short).toBe("Bez ceny");
  });

  it("quoteApprovalBlock: nabídka ne-admina bez schválení v JAKÉMKOLI stavu, AI jen neodeslaná", () => {
    expect(quoteApprovalBlock({ adminApprovalRequired: true, approvedBy: null })).toBe(QUOTE_AWAITS_APPROVAL);
    // i „odeslaná“ / zamítnutá — R7 je nezávislé na stavu
    expect(quoteApprovalBlock({ adminApprovalRequired: true, approvedBy: null, sentAt: "2026-10-01T08:00:00Z" })).toBe(QUOTE_AWAITS_APPROVAL);
    expect(quoteApprovalBlock({ adminApprovalRequired: true, approvedBy: OTHER })).toBeNull();
    expect(quoteApprovalBlock({ approvalRequired: true, approvedBy: null })).toBe(QUOTE_AWAITS_APPROVAL);
    expect(quoteApprovalBlock({ approvalRequired: true, approvedBy: null, sentAt: "2026-10-01T08:00:00Z" })).toBeNull();
    // „odesláno“ rozhoduje stav, ne sent_at: neodeslaná AI nabídka s podvrženým sent_at zůstává blokovaná
    expect(quoteApprovalBlock({ approvalRequired: true, approvedBy: null, sentAt: "2026-10-01T08:00:00Z", state: "ke_schvaleni" }))
      .toBe(QUOTE_AWAITS_APPROVAL);
    expect(quoteApprovalBlock({ approvalRequired: true, approvedBy: null, sentAt: null, state: "odeslana" })).toBeNull();
    expect(quoteApprovalBlock({ approvalRequired: true, approvedBy: null, sentAt: null, state: "zamitnuta" })).toBe(QUOTE_AWAITS_APPROVAL);
    expect(quoteWasSent({ state: "schvalena", sentAt: "2026-10-01T08:00:00Z" })).toBe(false);
    expect(quoteWasSent({ state: "pripominky", sentAt: null })).toBe(true);
    expect(quoteWasSent({ state: "archivovana", sentAt: "2026-10-01T08:00:00Z" })).toBe(true);
    expect(quoteApprovalBlock({ approvalRequired: false })).toBeNull();
    expect(QUOTE_ACCEPT_BLOCKED).toContain("přijmout ji lze až po schválení a odeslání");
  });

  it("quoteSendBlock: margins, autor / obchodník / řešitel schválené, zamítnutá, archiv", () => {
    const base = quote({ state: "schvalena", approvalRequired: true, adminApprovalRequired: true, approvedBy: OTHER, createdBy: "author" });
    const viewer = (features: Feature[], userId: string, p: Record<string, unknown> = {}) =>
      ({ can: (f: Feature) => features.includes(f), userId, ...p });
    const W: Feature[] = ["orders", "workflow", "documents"];
    expect(quoteSendBlock(base, viewer([...W, "margins"], "someone"))).toBeNull();
    expect(quoteSendBlock(base, viewer(W, "author"))).toBeNull();
    expect(quoteSendBlock(base, viewer(W, "owner", { jobOwnerId: "owner" }))).toBeNull();
    expect(quoteSendBlock(base, viewer(W, "solver", { jobAssigneeId: "solver" }))).toBeNull();
    expect(quoteSendBlock(base, viewer(W, "stranger"))).toBe(QUOTE_SEND_NO_RIGHT);
    // neschválená: nikdo, ani super admin
    expect(quoteSendBlock({ ...base, state: "ke_schvaleni", approvedBy: null }, viewer([...W, "margins", "quote_approval"], "admin", { isSuperAdmin: true })))
      .toBe(QUOTE_AWAITS_APPROVAL);
    // rozpracovaná nabídka super admina (bez příznaku) — jen margins
    const adminDraft = quote({ state: "rozpracovana" });
    expect(quoteSendBlock(adminDraft, viewer([...W, "margins"], "x"))).toBeNull();
    expect(quoteSendBlock(adminDraft, viewer(W, ME))).toBe(QUOTE_SEND_NO_RIGHT);
    // zamítnutá (znovuotevření) jen margins; archivní verze jen super admin
    expect(quoteSendBlock({ ...base, state: "zamitnuta" }, viewer(W, "author"))).toBe(QUOTE_SEND_NO_RIGHT);
    expect(quoteSendBlock({ ...base, archived: true }, viewer([...W, "margins"], "x"))).toBe(QUOTE_ARCHIVED_SEND);
    expect(quoteSendBlock({ ...base, archived: true }, viewer([...W, "margins"], "x", { isSuperAdmin: true }))).toBeNull();
  });

  it("quoteAwaitsApproval, quoteApprovalFlag a approvedStampText", () => {
    expect(quoteAwaitsApproval({ state: "ke_schvaleni" })).toBe(true);
    expect(quoteAwaitsApproval({ state: "ke_schvaleni", archived: true })).toBe(false);
    expect(quoteAwaitsApproval({ state: "schvalena" })).toBe(false);

    const pending = quote({ id: "qp", state: "ke_schvaleni", number: "NAB-2026-040", adminApprovalRequired: true, approvalRequired: true });
    expect(quoteApprovalFlag([pending])).toMatchObject({
      kind: "pending", quoteId: "qp", label: "Neschválená — čeká na schválení super admina", short: "Neschválená",
      title: "Nabídka NAB-2026-040 čeká na schválení super admina — do té doby ji nejde odeslat zákazníkovi.",
    });
    const returned = { ...pending, returnedAt: "2026-10-23T08:00:00Z", returnNote: "doplň termín" };
    expect(quoteApprovalFlag([returned])).toMatchObject({ kind: "returned", label: "Vráceno k přepracování: doplň termín", short: "Vráceno", note: "doplň termín" });
    // čekající má přednost před vrácenou
    expect(quoteApprovalFlag([returned, { ...pending, id: "qp2" }])).toMatchObject({ kind: "pending", quoteId: "qp2" });
    const approved = quote({ id: "qa", state: "schvalena", approvedBy: OTHER, adminApprovalRequired: true });
    expect(quoteApprovalFlag([approved], { author: "Petr Obchodník", approver: "Jan Semorád", at: "2026-10-23T09:00:00Z" })).toEqual({
      kind: "approved", quoteId: "qa", number: "NAB-2026-031", label: "Připravil(a) P. Obchodník · Schválil J. Semorád · 23. 10. 2026",
    });
    expect(quoteApprovalFlag([quote({ state: "odeslana", status: "odeslano" })])).toBeNull();
    expect(quoteApprovalFlag([])).toBeNull();

    expect(approvedStampText("Petr Obchodník", "Jan Semorád", "2026-10-23")).toBe("Připravil(a) P. Obchodník · Schválil J. Semorád · 23. 10. 2026");
    expect(approvedStampText("Jan Semorád", "Jan Semorád", "2026-10-23")).toBe("Schválil J. Semorád · 23. 10. 2026");
    expect(approvedStampText(null, null, null)).toBe("Schválená");
  });

  it("quoteFactsFromRow čte sloupce #25", () => {
    const f = quoteFactsFromRow({
      id: "q", job_id: "j", number: "N", revision: 1, status: "ke_schvaleni", state: "ke_schvaleni", approved_by: null,
      approval_required: true, created_by: ME, archived: false, admin_approval_required: true,
      approval_returned_at: "2026-10-23T08:00:00Z", approval_return_note: "doplň", updated_at: "2026-10-23T08:00:01Z", owner_id: OTHER,
    });
    expect(f).toMatchObject({ adminApprovalRequired: true, returnedAt: "2026-10-23T08:00:00Z", returnNote: "doplň", updatedAt: "2026-10-23T08:00:01Z", ownerId: OTHER });
  });
});

// ── Chip řádku ──────────────────────────────────────────────
describe("primaryChip (tabulka 1.11)", () => {
  const chipOf = (f: FlowFacts, q: QuoteFacts[] = []) => primaryChip(f, deriveFlow(f, q, TODAY));
  const o = (p: Partial<FlowFacts>) => facts({ inquiryStatus: "zpracovana", orderStatus: "potvrzena", orderRevision: 1, orderConfirmedRevision: 1, confirmationSentRevision: 1, ...p });

  it("poptávka, nacenění, nabídka", () => {
    expect(chipOf(facts())?.key).toBe("prijata");
    // řešitel ≠ autor: „řeší P. Obchodník"; tentýž účet nese razítko pod chipem (bez nápovědy)
    expect(chipOf(facts({ inquiryStatus: "v_reseni", assigneeName: "Petr Obchodník" }))).toMatchObject({ key: "v_reseni", hint: "řeší P. Obchodník" });
    expect(chipOf(facts({ inquiryStatus: "ceka_na_podklady", waitingSince: "2026-10-20T10:00:00Z" }))?.hint).toBe("čeká 3 dny");
    expect(chipOf(facts({ stage: "naceneni", inquiryStatus: "v_reseni", itemsCount: 5, itemsPriced: 3 }))).toMatchObject({ key: "rozpracovano", label: "Naceňuje se (3/5)" });
    expect(chipOf(facts({ stage: "naceneni", inquiryStatus: "v_reseni" }), [quote({ state: "ke_schvaleni", approvalRequired: true })])?.key).toBe("ke_schvaleni");
    expect(chipOf(facts({ stage: "nabidka", inquiryStatus: "zpracovana" }), [quote({ status: "odeslano", state: "odeslana", sentAt: "2026-10-20T08:00:00Z", revision: 2 })]))
      .toMatchObject({ key: "odeslana", hint: "NAB-2026-031 r2 · čeká 3 dny" });
    expect(chipOf(facts({ stage: "nabidka", inquiryStatus: "zpracovana" }), [quote({ state: "rozpracovana" })])).toBeNull();
  });

  it("objednávka a potvrzení", () => {
    expect(chipOf(o({ stage: "objednavka", orderStatus: "dorucena", orderConfirmedRevision: null }))?.key).toBe("dorucena");
    expect(chipOf(o({ stage: "objednavka", orderStatus: "dorucena", orderRevision: 2 }))?.label).toBe("Doručená (rev 2)");
    expect(chipOf(o({ stage: "ve_vyrobe", orderStatus: "rozpor" }))?.key).toBe("rozpor");
    expect(chipOf(o({ stage: "potvrzeno", confirmationSentRevision: null }))?.key).toBe("bez_dokladu");
    expect(chipOf(o({ stage: "potvrzeno" }))?.key).toBe("bez_postupu");
    expect(chipOf(o({ stage: "potvrzeno" }))?.label).toBe("K předání do výroby");
    // i s připraveným postupem — zakázka stále čeká na předání (kdo + termín)
    expect(chipOf(o({ stage: "potvrzeno", hasOperations: true }))?.key).toBe("bez_postupu");
    expect(chipOf(o({ stage: "montaz", orderStatus: "aktualizovana", orderRevision: 2 }))?.key).toBe("aktualizovana");
  });

  it("výroba, dodání, faktura, uzavřené", () => {
    // ve výrobě bez kroku s kdo + termínem (starší zakázka) → „Chybí kdo a termín"
    expect(chipOf(o({ stage: "ve_vyrobe" }))?.key).toBe("bez_predani");
    const ready = { productionStep: "vyroba", productionLocation: "Frézy Novák", productionDue: "2026-11-13", productionTotal: 2, productionDone: 0 };
    expect(chipOf(o({ stage: "ve_vyrobe", ...ready }))).toBeNull();
    const part = chipOf(o({ stage: "ve_vyrobe", itemsCount: 3, itemsDelivered: 2 }));
    expect(part).toMatchObject({ key: "castecne" });
    expect(part?.progress?.label).toBe("2/3 položek");
    expect(chipOf(o({ stage: "na_sklade" }))?.key).toBe("k_expedici");
    expect(chipOf(o({ stage: "dodano_zakaznikovi" }))?.key).toBe("dodano");
    expect(chipOf(o({ stage: "dodano_zakaznikovi", deliveryNoteConfirmedAt: "2026-10-20" }))?.key).toBe("dl_potvrzen");
    expect(chipOf(o({ stage: "fakturovano", invoiceDueDate: "2026-10-01" }))?.key).toBe("po_splatnosti");
    expect(chipOf(o({ stage: "dokonceno" }))).toBeNull();
    expect(chipOf(o({ stage: "reklamace" }))).toBeNull();
    expect(chipOf(o({ stage: "pozastaveno" }))).toBeNull();
    expect(chipOf(facts({ stage: "nerealizovano", inquiryStatus: "odmitnuta", lostReason: "kapacita" }))?.label).toBe("Nerealizováno — Nestíháme (kapacita / termín)");
    expect(chipOf(o({ stage: "zruseno", orderStatus: "stornovana", lostReason: "jiny_dodavatel" }))).toMatchObject({ key: "zruseno", label: "Zrušeno — Vybral jiného dodavatele" });
  });

  it("návrh má přednost; rozpor objednávky před stavem", () => {
    const p = chipOf(o({ stage: "ve_vyrobe", proposal: { phase: "order", to: "stornovana", kind: "ai", label: "Stornovat objednávku", agent: "email-ingest" } }));
    expect(p).toMatchObject({ phase: "proposal", ai: true, label: "Návrh: Stornovat objednávku" });
    expect(chipOf(o({ stage: "pozastaveno", orderStatus: "rozpor" }))?.key).toBe("rozpor");
  });

  it("řádek průběhu v hlavičce: hotové, aktuální s chipem, budoucí", () => {
    const f = o({ stage: "ve_vyrobe", itemsCount: 2, itemsDelivered: 1 });
    const stamps: JobStamps = { stage: null, inquiry: null, order: null, confirmed: null, confirmationSent: null, deliveryNote: null, invoiced: null, paid: null, lost: null, proposal: null, stageHistory: {} };
    const trail = phaseTrail(f, deriveFlow(f, [], TODAY), stamps);
    expect(trail.map((t) => [t.phase, t.done, t.current])).toEqual([
      ["inquiry", true, false], ["quote", false, false], ["order", true, false],
      ["fulfilment", false, true], ["delivery", false, false], ["payment", false, false],
    ]);
    expect(trail[1].skipped).toBe(true); // bez nabídky = přeskočena
    expect(trail[3].chip?.key).toBe("castecne");
  });

  it("průběh: objednávka bez nabídky = Nabídka „přeskočena“, ne hotovo (review UX 22)", () => {
    const stamps: JobStamps = {
      stage: null, inquiry: null, order: null, confirmed: null, confirmationSent: null, deliveryNote: null, invoiced: null,
      paid: null, lost: null, proposal: null, stageHistory: {},
    };
    const f = facts({ stage: "potvrzeno", inquiryStatus: null, orderStatus: "potvrzena", orderRevision: 1, orderConfirmedRevision: 1, confirmationSentRevision: 1 });
    const t = phaseTrail(f, deriveFlow(f, [], TODAY), stamps);
    expect(t[1]).toMatchObject({ phase: "quote", done: false, skipped: true });
    const withQ = phaseTrail(f, deriveFlow(f, [quote({ status: "prijato", state: "prijata" })], TODAY), stamps);
    expect(withQ[1]).toMatchObject({ phase: "quote", done: true });
    expect(withQ[1].skipped).toBeUndefined();
  });

  it("průběh: aktualizovaná objednávka je zase aktuální fáze s chipem; potvrzená bez dokladu ukáže chip u Objednávky", () => {
    const stamps: JobStamps = {
      stage: null, inquiry: null, order: null, confirmed: null, confirmationSent: null, deliveryNote: null, invoiced: null,
      paid: null, lost: null, proposal: null, stageHistory: {},
    };
    const upd = facts({ stage: "potvrzeno", inquiryStatus: "zpracovana", orderStatus: "aktualizovana", orderRevision: 2, orderConfirmedRevision: 1 });
    const t1 = phaseTrail(upd, deriveFlow(upd, [], TODAY), stamps);
    expect(t1[2]).toMatchObject({ phase: "order", done: false, current: true });
    expect(t1[2].chip?.key).toBe("aktualizovana");
    const plain = facts({ stage: "potvrzeno", inquiryStatus: "zpracovana", orderStatus: "potvrzena", orderRevision: 1, orderConfirmedRevision: 1 });
    const t2 = phaseTrail(plain, deriveFlow(plain, [], TODAY), stamps);
    const pc = primaryChip(plain, deriveFlow(plain, [], TODAY), stamps);
    expect(t2[2].current).toBe(Boolean(pc));
    if (pc) expect(t2[2].chip?.key).toBe(pc.key);
    expect(t2.filter((x) => x.current).length).toBeLessThanOrEqual(1);
  });

  it("chipy záložek s počty a výchozím „Otevřené“", () => {
    const counts = { "inquiry.prijata": 3, "inquiry.odmitnuta": 1, "order.dorucena": 2, "fulfilment.ve_vyrobe": 4, "quote.vyprsela": 1 };
    const inq = chipsForTab("inquiries", counts);
    expect(inq.find((c) => c.key === "prijata")).toMatchObject({ count: 3, open: true });
    expect(inq.find((c) => c.key === "odmitnuta")).toMatchObject({ count: 1, open: false });
    const conf = chipsForTab("confirmations", counts);
    expect(conf.filter((c) => c.open).map((c) => c.key)).toEqual(["dorucena", "rozpor", "aktualizovana"]);
    expect(conf.find((c) => c.key === "ve_vyrobe")).toMatchObject({ phase: "fulfilment", count: 4 });
    expect(chipsForTab("quotes", counts).find((c) => c.key === "vyprsela")?.count).toBe(1);
    expect(chipsForTab("book", counts)).toEqual(conf);
  });
});

// ── Náhled dopadu korekce ───────────────────────────────────
describe("stageEffect", () => {
  const sent = quote({ id: "s", number: "NAB-2026-031", revision: 2, status: "odeslano", state: "odeslana" });
  const draft = quote({ id: "d", number: "NAB-2026-040", status: "ke_schvaleni", state: "rozpracovana" });

  it("uzavření zakázky zamítne odeslané a archivuje koncepty", () => {
    const f = facts({ stage: "nabidka", inquiryStatus: "zpracovana" });
    const e = stageEffect(f, [sent, draft], { kind: "stage", to: "nerealizovano" });
    expect(e).toMatchObject({ stage: "nerealizovano", quotesRejected: ["NAB-2026-031 r2"], quotesArchived: ["NAB-2026-040"], quoteAccepted: null });
    expect(e.inquiry).toBeUndefined(); // zůstane Zpracovaná
    expect(stageEffectText(e, "cena")[0]).toBe("Nabídka NAB-2026-031 r2 → Zamítnutá (Cena)");
  });

  it("objednávka s jedinou odeslanou nabídkou ji přijme; víc odeslaných = varování", () => {
    const f = facts({ stage: "nabidka", inquiryStatus: "zpracovana" });
    const e = stageEffect(f, [sent, draft], { kind: "stage", to: "objednavka" });
    expect(e).toMatchObject({ stage: "objednavka", order: "dorucena", quoteAccepted: "NAB-2026-031 r2", quotesArchived: ["NAB-2026-040"] });
    const two = stageEffect(f, [sent, quote({ id: "t", status: "odeslano", state: "odeslana" })], { kind: "stage", to: "objednavka" });
    expect(two.quoteAccepted).toBeNull();
    expect(two.warnings.join(" ")).toContain("bez přijaté nabídky");
  });

  it("dílčí stav posune hlavní stav (odmítnutí, storno, obnovení)", () => {
    expect(stageEffect(facts({ inquiryStatus: "v_reseni" }), [], { kind: "inquiry", to: "odmitnuta" }).stage).toBe("nerealizovano");
    expect(stageEffect(facts({ stage: "nerealizovano", inquiryStatus: "odmitnuta" }), [], { kind: "inquiry", to: "prijata" }).stage).toBe("poptavka");
    const o = facts({ stage: "potvrzeno", inquiryStatus: "zpracovana", orderStatus: "potvrzena", orderRevision: 1 });
    expect(stageEffect(o, [], { kind: "order", to: "stornovana" })).toMatchObject({ stage: "zruseno" });
    expect(stageEffect({ ...o, itemsDelivered: 1, itemsCount: 2 }, [], { kind: "order", to: "stornovana" }).stage).toBeNull();
    expect(stageEffect(facts({ stage: "zruseno", orderStatus: "stornovana", orderRevision: 1 }), [], { kind: "order", to: "potvrzena" }).stage).toBe("potvrzeno");
  });

  it("posun zpět a rozpor varují", () => {
    const f = facts({ stage: "ve_vyrobe", inquiryStatus: "zpracovana", orderStatus: "rozpor", orderRevision: 1 });
    const e = stageEffect(f, [], { kind: "stage", to: "objednavka" });
    expect(e.warnings.some((w) => w.includes("Posun zpět"))).toBe(true);
    expect(e.warnings.some((w) => w.includes("Rozpor s nabídkou"))).toBe(true);
    expect(stageEffect(facts({ stage: "fakturovano", orderStatus: "potvrzena" }), [], { kind: "stage", to: "dokonceno" }).warnings.join(" ")).toContain("zaplacená");
  });
});

// ── Atribuce ────────────────────────────────────────────────
describe("kdo · kdy", () => {
  const now = new Date("2026-10-23T10:00:00Z");
  const stamp = (p: Partial<ChangeStamp> = {}): ChangeStamp => ({ by: null, byName: null, at: "2026-10-23T09:55:00Z", via: null, kind: "user", ...p });

  it("jméno nikdy prázdné (všechny kombinace)", () => {
    for (const kind of ["user", "ai", "system"] as ActorKind[])
      for (const via of [null, "rucne", "ai", "foto", "email", "automaticky", "import", "cron", "rest", "db"] as (ChangeVia | null)[])
        for (const by of [null, { id: ME, name: "Petr Obchodník" }, { id: ME, name: "  " }])
          for (const byName of [null, "", "Jan Novák"])
            for (const agent of [null, "capture", "email-ingest", "neznamy"]) {
              const n = actorName({ by, byName, kind, via, agent });
              expect(n.trim().length, JSON.stringify({ kind, via, by, byName, agent })).toBeGreaterThan(0);
            }
  });

  it("konkrétní podoby jmen", () => {
    expect(actorName(stamp({ by: { id: ME, name: "Petr Obchodník" } }))).toBe("Petr Obchodník");
    expect(actorName(stamp({ byName: "Jan Novák" }))).toBe("Jan Novák (účet zrušen)");
    expect(actorName(stamp({ kind: "ai", agent: "email-ingest" }))).toBe("✨ AI (e-mail)");
    expect(actorName(stamp({ kind: "ai", by: { id: ME, name: "Petr Obchodník" }, agent: "capture" }))).toBe("✨ AI za účet Petr Obchodník");
    expect(actorName(stamp({ kind: "system", via: "cron" }))).toBe("Systém (plánovač)");
    expect(actorName(stamp({ kind: "system", via: "db" }))).toBe("Systém · před evidencí");
    expect(actorName(stamp({ kind: "system", via: "automaticky" }))).toBe("Automaticky");
  });

  it("text razítka bez rodových sloves", () => {
    const texts = [
      stampText(stamp({ by: { id: ME, name: "Petr Obchodník" } }), now),
      stampText(stamp({ kind: "ai", agent: "capture" }), now),
      stampText(stamp({ kind: "system", via: "automaticky", cause: "vyroba" }), now),
      stampTitle(stamp({ by: { id: ME, name: "Jana Malá" }, via: "foto", cause: "dodani", note: "pozn" })),
    ];
    expect(texts[0]).toBe("Petr Obchodník · před 5 min");
    expect(stampText(stamp({ by: { id: ME, name: "Petr Obchodník" } }), now, { short: true })).toBe("P. Obchodník · před 5 min");
    for (const t of texts) expect(t).not.toMatch(/\b(převzal|změnil|schválil|odeslal|potvrdil|posunul|zapsal|vložil)a?\b/i);
    expect(texts[3]).toContain("Způsob: z fotky dokladu");
    expect(texts[3]).toContain("Příčina: vše dodáno");
  });

  it("relativní čas", () => {
    expect(relativeStampTime("2026-10-23T09:59:40Z", now)).toBe("právě teď");
    expect(relativeStampTime("2026-10-23T07:00:00Z", now)).toBe("před 3 h");
    expect(relativeStampTime("2026-10-22T12:05:00Z", now)).toBe("včera 14:05");
    expect(relativeStampTime("2026-10-20T12:05:00Z", now)).toBe("před 3 dny");
    expect(relativeStampTime("2026-09-01T12:05:00Z", now)).toBe("1. 9.");
    expect(relativeStampTime("2025-09-01T12:05:00Z", now)).toBe("1. 9. 2025");
    expect(relativeStampTime(null, now)).toBeNull();
    // jen datum (date sloupec, např. potvrzení DL): žádný vymyšlený čas
    expect(relativeStampTime("2026-10-23", now)).toBe("dnes");
    expect(relativeStampTime("2026-10-22", now)).toBe("včera");
    expect(relativeStampTime("2026-10-05", now)).toBe("5. 10.");
    expect(relativeStampTime("2025-10-05", now)).toBe("5. 10. 2025");
  });

  it("razítko ze sloupců řádku", () => {
    const row = { stage_changed_at: "2026-10-23T09:00:00Z", stage_changed_by: ME, stage_changed_via: "automaticky", stage_change_cause: "vyroba", stage_change_note: null };
    expect(stampFromRow(row, "stage_changed", { id: ME, name: "Petr Obchodník" })).toMatchObject({ by: { name: "Petr Obchodník" }, via: "automaticky", cause: "vyroba", kind: "user" });
    expect(stampFromRow({ lost_at: null, lost_by: null }, "lost")).toBeNull();
    expect(stampFromRow({ paid_at: "2026-10-20", paid_by: null }, "paid")).toMatchObject({ kind: "system", by: null });
  });

  it("mapování řádků DB", () => {
    const f = flowFactsFromRow({ status: "objednavka", inquiry_status: "zpracovana", order_status: "dorucena", order_revision: 1, paid_so_far: "1500.50", items_count: 2 });
    expect(f).toMatchObject({ stage: "objednavka", orderStatus: "dorucena", orderRevision: 1, paidSoFar: 1500.5, itemsCount: 2, inquiryStatus: "zpracovana" });
    const q = quoteFactsFromRow({ id: "x", status: "odeslano", state: "odeslana", revision: 2, archived: false, approval_required: false });
    expect(q).toMatchObject({ id: "x", state: "odeslana", revision: 2, aiGenerated: false });
  });
});

// ── Parita s SQL migrací ────────────────────────────────────
describe("parita TS ↔ SQL migrace", () => {
  // #25: funkce se předefinovávají v pozdějších migracích (20261023155000) — platí POSLEDNÍ definice
  // napříč seřazenými migracemi, proto se čte vše a hledá od konce.
  const dir = path.resolve(__dirname, "../../../supabase/migrations");
  const sql = readdirSync(dir).filter((f) => f.endsWith(".sql")).sort()
    .map((f) => readFileSync(path.join(dir, f), "utf8")).join("\n");

  function checkList(name: string): string[] {
    const m = [...sql.matchAll(new RegExp(`${name} check \\(([\\s\\S]*?)\\);`, "g"))].at(-1);
    expect(m, name).toBeTruthy();
    const inner = m![1];
    const list = /in\s*\(([\s\S]*?)\)\s*\)?$/.exec(inner.trim());
    return [...(list ? list[1] : inner).matchAll(/'([a-z_]+)'/g)].map((x) => x[1]);
  }

  function labelBlock(fn: string, field?: string): Record<string, string> {
    const start = sql.lastIndexOf(`create or replace function ${fn}(`);
    expect(start, fn).toBeGreaterThan(-1);
    let body = sql.slice(start, sql.indexOf("$$;", start));
    if (field) {
      const i = body.indexOf(`when '${field}' then case p_key`);
      expect(i, field).toBeGreaterThan(-1);
      body = body.slice(i + field.length + 20, body.indexOf(" end", i));
    }
    const out: Record<string, string> = {};
    for (const m of body.matchAll(/when '([a-z_]+)' then '([^']+)'/g)) out[m[1]] = m[2];
    return out;
  }

  it("CHECK seznamy = klíče TS", () => {
    expect(checkList("orders_inquiry_status_check").sort()).toEqual(Object.keys(INQUIRY_STATES).sort());
    expect(checkList("orders_order_status_check").sort()).toEqual(Object.keys(ORDER_STATES).sort());
    expect(checkList("quotes_state_check").sort()).toEqual(Object.keys(QUOTE_STATES).filter((k) => k !== "vyprsela").sort());
    expect(checkList("orders_lost_reason_check").sort()).toEqual(Object.keys(LOST_REASONS).sort());
    expect(checkList("quotes_lost_reason_check").sort()).toEqual(Object.keys(LOST_REASONS).sort());
  });

  it("štítky flow_state_label, lost_reason_label, flow_cause_label = TS", () => {
    const inq = labelBlock("flow_state_label", "inquiry_status");
    for (const [k, m] of Object.entries(INQUIRY_STATES)) expect(inq[k], k).toBe(m.label);
    const ord = labelBlock("flow_state_label", "order_status");
    for (const [k, m] of Object.entries(ORDER_STATES)) expect(ord[k], k).toBe(m.label);
    const qs = labelBlock("flow_state_label", "quote_state");
    for (const [k, m] of Object.entries(QUOTE_STATES)) if (k !== "vyprsela") expect(qs[k], k).toBe(m.label);
    expect(qs.ke_schvaleni).toBe("Neschválená"); // #25 (20261023155000)
    const lost = labelBlock("lost_reason_label");
    for (const [k, m] of Object.entries(LOST_REASONS)) expect(lost[k], k).toBe(m.label);
    const cause = labelBlock("flow_cause_label");
    expect(cause).toEqual(CAUSE_LABELS);
  });

  it("job_stage_label a job_stage_rank = stages.ts", () => {
    const labels = labelBlock("job_stage_label");
    for (const s of STAGE_ORDER) expect(labels[s], s).toBe(STAGES[s].label);
    const start = sql.lastIndexOf("create or replace function job_stage_rank(");
    const body = sql.slice(start, sql.indexOf("$$;", start));
    const ranks: Record<string, number> = {};
    for (const m of body.matchAll(/when '([a-z_]+)' then (\d+)/g)) ranks[m[1]] = Number(m[2]);
    for (const s of STAGE_ORDER) expect(ranks[s] ?? -1, s).toBe(flowRank(s));
  });
});

// ── Předání do výroby (H.5): další krok, menu, chipy ────────
describe("předání do výroby — další krok, menu a chipy", () => {
  const snap = (f: FlowFacts) => deriveFlow(f, [], TODAY);
  const vv = (p: Partial<FlowFacts> = {}) => facts({
    stage: "ve_vyrobe", inquiryStatus: "zpracovana", orderStatus: "potvrzena", orderRevision: 1, orderConfirmedRevision: 1, confirmationSentRevision: 1,
    productionStep: "vyroba", productionLocation: "Frézy Novák", productionDue: "2026-11-13", productionTotal: 2, productionDone: 0,
    dueDate: "2026-11-20", productionEnd: "2026-11-19", ...p,
  });
  const next = (f: FlowFacts, c: ActionCtx = SALES) => nextAction(f, snap(f), c);

  it("ve výrobě: chybí kdo/termín → Doplnit; neodeslaná objednávka (marže) → Odeslat; pozdě → Přeplánovat; jinak Posunout dál", () => {
    expect(next(vv({ productionLocation: null }))).toEqual({ key: "production.handoff", label: "Doplnit kdo a termín…" });
    expect(next(vv({ productionDue: null }))).toEqual({ key: "production.handoff", label: "Doplnit kdo a termín…" });
    expect(next(vv({ productionPoStatus: "vystavena" }))?.key).toBe("production.sendPo");
    // zaměstnanec objednávku neposílá → posun dál
    expect(next(vv({ productionPoStatus: "vystavena" }), WORKER)?.key).toBe("production.advance");
    expect(next(vv({ productionEnd: "2026-11-24" }))?.key).toBe("production.replan");
    expect(next(vv({ productionFinalEnd: "2026-11-18" }))?.key).toBe("production.replan");
    expect(next(vv())).toEqual({ key: "production.advance", label: "Posunout dál…" });
    expect(next(vv({ productionRunning: false }))).toEqual({ key: "production.advance", label: "Předat do kroku…" });
    // dodání má pořád přednost
    expect(next(vv({ itemsCount: 2, itemsDelivered: 1 }))?.key).toBe("delivery.record");
  });

  it("chipy: ohrožený konečný termín > změněný konečný termín > chybí kdo a termín > další krok čeká", () => {
    const chipOf = (f: FlowFacts) => primaryChip(f, snap(f));
    expect(chipOf(vv({ productionEnd: "2026-11-22" }))).toMatchObject({ key: "ohrozeny_termin", label: "Ohrožen konečný termín (o 2 dny)" });
    expect(chipOf(vv({ productionFinalEnd: "2026-11-18" }))?.key).toBe("termin_zmenen");
    expect(chipOf(vv({ productionLocation: null }))?.label).toBe("Chybí kdo a termín");
    expect(chipOf(vv({ productionRunning: false }))?.label).toBe("K předání dalšímu kroku");
    expect(chipOf(vv())).toBeNull();
  });

  it("menu: před výrobou Předat + Naplánovat postup; ve výrobě Posunout / Ukončit / Přeplánovat / Vrátit; storno u dodavatelů jen s marží", () => {
    const p = facts({ stage: "potvrzeno", inquiryStatus: "zpracovana", orderStatus: "potvrzena", orderRevision: 1, orderConfirmedRevision: 1, confirmationSentRevision: 1 });
    expect(menuActions(p, snap(p), SALES)).toEqual(expect.arrayContaining(["production.plan"]));
    const m = menuActions(vv(), snap(vv()), SALES);
    for (const k of ["production.finish", "production.replan", "production.undo"]) expect(m).toContain(k);
    expect(menuActions(vv({ productionLocation: null }), snap(vv({ productionLocation: null })), SALES)).toContain("production.handoff");
    const z = facts({ stage: "zruseno", openPurchaseOrders: 2 });
    expect(menuActions(z, snap(z), SALES)).toContain("purchasing.notifySuppliers");
    expect(menuActions(z, snap(z), WORKER)).not.toContain("purchasing.notifySuppliers");
    expect(next(z)).toEqual({ key: "purchasing.notifySuppliers", label: "Stornovat u dodavatelů…" });
    expect(FLOW_ACTIONS["production.plan"]).toMatchObject({ label: "Naplánovat postup", kind: "link" });
    expect(FLOW_ACTIONS["production.plan"].href?.("x")).toBe("/orders/x?tab=vyroba");
  });

  it("fakta z řádku: production_* a objednávky z embedu", () => {
    const f = flowFactsFromRow({
      status: "ve_vyrobe", production_step: "tepelne_zpracovani", production_location: "TepKal", production_step_no: 2, production_due: "2026-11-12",
      production_po_status: "vystavena", production_end: "2026-11-19", production_final_end: null, due_date: "2026-11-20",
      pos: [{ status: "vystavena" }, { status: "dodana" }, { status: "zrusena" }],
    });
    expect(f).toMatchObject({ productionStep: "tepelne_zpracovani", productionStepNo: 2, productionPoStatus: "vystavena", openPurchaseOrders: 1, deliveredPurchaseOrders: 1, dueDate: "2026-11-20" });
  });
});
