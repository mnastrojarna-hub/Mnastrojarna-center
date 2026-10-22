import { describe, it, expect } from "vitest";
import type { JobOperation, JobClosingInfo } from "@/lib/jobs/production-types";
import type { JobFile, JobListItem } from "@/lib/jobs/types";
import {
  closingProgress, confirmedDeliveryFile, currentOperation, dayLabel, dayWord, invoiceTone, lastNoteLine, listPaymentMark,
  miniSegments, moveLocal, operationVisuals, overdueOperations, plannedState, pragueDay, primaryAction, problemOperations,
  progressSegments, sameWho, templateRequest, upcomingOperation, whoLabel, whoOfOperation, whoToInput, whoToTemplateValue,
  withStatus, WHO_IN_HOUSE, WHO_NONE, CONFIRMED_DL_TITLE, operationStatusStamp, closingStamp, stampTime, stampLabel,
} from "./production-helpers";

const SUP = "3f2b8c1e-1d2a-4c3b-9a8e-7f6d5c4b3a21";
const TODAY = "2026-10-22";

function op(over: Partial<JobOperation> = {}): JobOperation {
  return {
    id: "o1", jobId: "j1", position: 0, kind: "soustruzeni", title: null, label: "Soustružení",
    supplier: null, supplierName: null, inHouse: true, location: "U nás", status: "ceka",
    plannedStart: null, plannedEnd: null, startedAt: null, finishedAt: null, note: null,
    purchaseOrderId: null, purchaseOrderNumber: null, createdBy: null,
    createdAt: "2026-10-01T08:00:00Z", updatedAt: "2026-10-01T08:00:00Z", overdue: false,
    ...over,
  };
}

const flow = [
  op({ id: "a", position: 0, status: "hotovo", kind: "soustruzeni" }),
  op({ id: "b", position: 1, status: "probiha", kind: "tepelne_zpracovani", label: "Tepelné zpracování", inHouse: false, supplier: { id: SUP, name: "TepKal s.r.o." }, location: "TepKal s.r.o." }),
  op({ id: "s", position: 2, status: "preskoceno", kind: "kontrola" }),
  op({ id: "c", position: 3, status: "ceka", kind: "brouseni", label: "Broušení" }),
  op({ id: "d", position: 4, status: "ceka", kind: "povrchova_uprava" }),
];

describe("průběh výroby", () => {
  it("úseky pruhu bez přeskočených, běžící a čekající", () => {
    const segs = progressSegments(flow);
    expect(segs.map((s) => s.id)).toEqual(["a", "b", "c", "d"]);
    expect(segs.map((s) => s.state)).toEqual(["done", "running", "todo", "todo"]);
  });

  it("když nic neběží, první čekající je na řadě", () => {
    const idle = flow.map((o) => (o.id === "b" ? { ...o, status: "hotovo" as const } : o));
    expect(progressSegments(idle).map((s) => s.state)).toEqual(["done", "done", "next", "todo"]);
    const v = operationVisuals(idle);
    expect(v.get("s")).toBe("skipped");
    expect(v.get("c")).toBe("next");
  });

  it("problém je vidět a aktuální operace je problémová", () => {
    const bad = flow.map((o) => (o.id === "b" ? { ...o, status: "problem" as const, note: "a\nprasklina po kalení" } : o));
    expect(progressSegments(bad)[1].state).toBe("problem");
    expect(currentOperation(bad)?.id).toBe("b");
    expect(problemOperations(bad).map((o) => o.id)).toEqual(["b"]);
  });

  it("aktuální a následující operace (pořadí podle pozice)", () => {
    const shuffled = [flow[3], flow[0], flow[4], flow[1], flow[2]];
    expect(currentOperation(shuffled)?.id).toBe("b");
    expect(upcomingOperation(shuffled)?.id).toBe("c");
    expect(currentOperation([op({ status: "hotovo" })])).toBeNull();
    expect(upcomingOperation([op({ status: "probiha" })])).toBeNull();
  });

  it("mini pruh z počtů", () => {
    expect(miniSegments(2, 5)).toEqual(["done", "done", "current", "todo", "todo"]);
    expect(miniSegments(1, 3, { problem: true })).toEqual(["done", "problem", "todo"]);
    expect(miniSegments(3, 3, { finished: true })).toEqual(["done", "done", "done"]);
    expect(miniSegments(9, 3)).toEqual(["done", "done", "done"]);
    expect(miniSegments(0, 0)).toBeNull();
    expect(miniSegments(4, 12)).toBeNull();
  });
});

describe("tlačítko, termíny, poznámky", () => {
  it("hlavní akce podle stavu", () => {
    expect(primaryAction("ceka")).toEqual({ label: "Začít", next: "probiha" });
    expect(primaryAction("probiha")).toEqual({ label: "Hotovo", next: "hotovo" });
    expect(primaryAction("problem")?.next).toBe("hotovo");
    expect(primaryAction("hotovo")).toBeNull();
    expect(primaryAction("preskoceno")).toBeNull();
  });

  it("termín operace: po termínu, dnes, brzy, v pohodě, hotovo", () => {
    expect(plannedState(op({ plannedEnd: "2026-10-20" }), TODAY)).toEqual({ tone: "overdue", text: "2 dny po termínu (20. 10.)" });
    expect(plannedState(op({ plannedEnd: "2026-10-21" }), TODAY)?.text).toBe("1 den po termínu (21. 10.)");
    expect(plannedState(op({ plannedEnd: TODAY }), TODAY)?.tone).toBe("today");
    expect(plannedState(op({ plannedEnd: "2026-10-23" }), TODAY)?.text).toBe("termín zítra");
    expect(plannedState(op({ plannedEnd: "2026-10-25" }), TODAY)).toEqual({ tone: "soon", text: "termín za 3 dny" });
    expect(plannedState(op({ plannedEnd: "2026-11-05" }), TODAY)).toEqual({ tone: "ok", text: "termín 5. 11." });
    expect(plannedState(op({ plannedEnd: "2026-10-01", status: "hotovo" }), TODAY)?.tone).toBe("done");
    expect(plannedState(op(), TODAY)).toBeNull();
    expect(overdueOperations([op({ id: "x", plannedEnd: "2026-10-01" }), op({ id: "y", plannedEnd: "2026-10-01", status: "hotovo" })], TODAY).map((o) => o.id)).toEqual(["x"]);
  });

  it("dny, data a poslední řádek poznámky", () => {
    expect([dayWord(1), dayWord(3), dayWord(5), dayWord(-2)]).toEqual(["den", "dny", "dní", "dny"]);
    expect(pragueDay("2026-10-21T23:30:00Z")).toBe("2026-10-22");
    expect(pragueDay("nesmysl")).toBeNull();
    expect(dayLabel("2027-01-03", TODAY)).toBe("3. 1. 2027");
    expect(lastNoteLine("první\n\n  22. 10. 2026 14:05 · Petr: díl je v kalírně  \n")).toBe("22. 10. 2026 14:05 · Petr: díl je v kalírně");
    expect(lastNoteLine("x".repeat(300), 20)).toHaveLength(20);
    expect(lastNoteLine("   ")).toBeNull();
  });
});

describe("optimistické změny", () => {
  it("stav a časy jako DB trigger", () => {
    const now = "2026-10-22T10:00:00.000Z";
    const started = withStatus([op({ plannedEnd: "2026-10-01" })], "o1", "probiha", TODAY, now)[0];
    expect(started).toMatchObject({ status: "probiha", startedAt: now, finishedAt: null, overdue: true });
    const done = withStatus([started], "o1", "hotovo", TODAY, "2026-10-23T00:00:00Z")[0];
    expect(done).toMatchObject({ status: "hotovo", startedAt: now, finishedAt: "2026-10-23T00:00:00Z", overdue: false });
    const back = withStatus([done], "o1", "ceka", TODAY)[0];
    expect(back).toMatchObject({ startedAt: null, finishedAt: null });
    const other = op({ id: "o2" });
    expect(withStatus([other], "o1", "hotovo", TODAY)[0]).toBe(other);
  });

  it("posun nahoru / dolů přečísluje pozice", () => {
    const moved = moveLocal(flow, "c", "up");
    expect(moved?.map((o) => o.id)).toEqual(["a", "b", "c", "s", "d"]);
    expect(moved?.map((o) => o.position)).toEqual([0, 1, 2, 3, 4]);
    expect(moveLocal(flow, "a", "up")).toBeNull();
    expect(moveLocal(flow, "zzz", "down")).toBeNull();
  });
});

describe("kdo operaci dělá", () => {
  it("z operace a zpět do vstupu akce", () => {
    expect(whoOfOperation(op())).toEqual(WHO_IN_HOUSE);
    expect(whoOfOperation(op({ inHouse: false, supplier: { id: SUP, name: "TepKal" } }))).toEqual({ type: "supplier", id: SUP, name: "TepKal" });
    expect(whoOfOperation(op({ inHouse: false, supplierName: " Kalírna XY " }))).toEqual({ type: "free", name: "Kalírna XY" });
    expect(whoOfOperation(op({ inHouse: false }))).toEqual(WHO_NONE);
    expect(whoToInput(WHO_IN_HOUSE)).toEqual({ inHouse: true, supplierId: null, supplierName: null });
    expect(whoToInput({ type: "supplier", id: SUP, name: "x" })).toEqual({ inHouse: false, supplierId: SUP, supplierName: null });
    expect(whoToInput({ type: "free", name: " Firma " })).toEqual({ inHouse: false, supplierId: null, supplierName: "Firma" });
    expect(whoToInput(WHO_NONE)).toEqual({ inHouse: false, supplierId: null, supplierName: null });
    expect(whoLabel(WHO_NONE)).toBe("Nevybráno");
    expect(sameWho({ type: "free", name: "ABC" }, { type: "free", name: "abc " })).toBe(true);
    expect(sameWho(WHO_IN_HOUSE, WHO_NONE)).toBe(false);
  });

  it("šablona: mapa podle druhu, opakovaný druh → seznam", () => {
    expect(whoToTemplateValue(WHO_IN_HOUSE)).toBe("u_nas");
    expect(whoToTemplateValue(WHO_NONE)).toBeNull();
    const req = templateRequest(["soustruzeni", "tepelne_zpracovani", "brouseni"], [
      WHO_IN_HOUSE, { type: "supplier", id: SUP, name: "TepKal" }, WHO_NONE,
    ]);
    expect(req).toEqual({ mode: "template", supplierByKind: { soustruzeni: "u_nas", tepelne_zpracovani: SUP } });
    const dup = templateRequest(["soustruzeni", "frezovani", "soustruzeni"], [WHO_IN_HOUSE, { type: "free", name: "Fréza s.r.o." }]);
    expect(dup.mode).toBe("list");
    if (dup.mode === "list") {
      expect(dup.ops.map((o) => o.kind)).toEqual(["soustruzeni", "frezovani", "soustruzeni"]);
      expect(dup.ops[1]).toMatchObject({ supplierName: "Fréza s.r.o.", inHouse: false });
      expect(dup.ops[2]).toMatchObject({ inHouse: false, supplierId: null, supplierName: null });
    }
  });
});

describe("kdo to udělal", () => {
  const ev = (createdAt: string, data: Record<string, unknown>, name: string | null = "Dominik Šponer") => ({
    createdAt, data, actor: name ? { id: "u9", name } : null,
  });

  it("poslední změna stavu operace — jen když sedí na aktuální stav", () => {
    const events = [
      ev("2026-10-22T12:05:00Z", { production: "status", operationId: "o1", from: "probiha", to: "hotovo" }),
      ev("2026-10-21T08:00:00Z", { production: "status", operationId: "o1", from: "ceka", to: "probiha" }, "Petr"),
      ev("2026-10-22T13:00:00Z", { production: "status", operationId: "o2", to: "probiha", auto: true }),
    ];
    expect(operationStatusStamp(events, { id: "o1", status: "hotovo" })).toEqual({ name: "Dominik Šponer", at: "2026-10-22T12:05:00Z", auto: false });
    // optimisticky už „ceka", historie ještě ne → nikoho neukazovat
    expect(operationStatusStamp(events, { id: "o1", status: "ceka" })).toBeNull();
    expect(operationStatusStamp(events, { id: "o2", status: "probiha" })?.auto).toBe(true);
    expect(operationStatusStamp(events, { id: "o3", status: "ceka" })).toBeNull();
    expect(operationStatusStamp([ev("2026-10-22T12:00:00Z", { production: "status", operationId: "o1", to: "hotovo" }, null)], { id: "o1", status: "hotovo" })).toBeNull();
    // pole z DB mají přednost
    expect(operationStatusStamp(events, { id: "o1", status: "ceka", changedBy: { id: "u1", name: "Jana" }, changedAt: "2026-10-22T14:00:00Z" })?.name).toBe("Jana");
  });

  it("konec toku: potvrzení, faktura, úhrada — zrušení nikoho neukazuje", () => {
    const events = [
      ev("2026-10-22T10:00:00Z", { production: "paid", paidAt: null }),
      ev("2026-10-21T10:00:00Z", { production: "paid", paidAt: "2026-10-21" }, "Eva"),
      ev("2026-10-20T10:00:00Z", { production: "delivery_note", date: "2026-10-20" }, "Karel"),
      ev("2026-10-19T10:00:00Z", { production: "invoice", changes: [] }, "Eva"),
    ];
    expect(closingStamp(events, "paid")).toBeNull();
    expect(closingStamp(events, "delivery_note")?.name).toBe("Karel");
    expect(closingStamp(events, "invoice")?.name).toBe("Eva");
    expect(closingStamp([], "invoice")).toBeNull();
  });

  it("čas a popisek", () => {
    expect(stampTime("2026-10-22T12:05:00Z", TODAY)).toBe("14:05");
    expect(stampTime("2026-10-20T07:30:00Z", TODAY)).toBe("20. 10. 09:30");
    expect(stampTime("nesmysl", TODAY)).toBe("");
    expect(stampLabel("Hotovo", { name: "Dominik Šponer", at: "2026-10-22T12:05:00Z" }, TODAY)).toBe("Hotovo · 14:05 · Dominik Šponer");
  });
});

describe("konec toku", () => {
  const closing = (over: Partial<JobClosingInfo> = {}): JobClosingInfo => ({
    jobId: "j1", stage: "fakturovano", customerNote: null, deliveryNoteConfirmedAt: null, deliveryNoteNumber: null,
    invoiceNumber: null, invoiceDate: null, invoiceDueDate: null, paymentTermsDays: 30, paidAt: null, paidAmount: null,
    overdueInvoice: false, daysToDue: null, ...over,
  });

  it("barva splatnosti", () => {
    expect(invoiceTone(closing())).toBeNull();
    expect(invoiceTone(closing({ invoiceDueDate: "2026-10-01", daysToDue: -21 }))).toBe("overdue");
    expect(invoiceTone(closing({ invoiceDueDate: TODAY, daysToDue: 0 }))).toBe("today");
    expect(invoiceTone(closing({ invoiceDueDate: "2026-10-24", daysToDue: 2 }))).toBe("soon");
    expect(invoiceTone(closing({ invoiceDueDate: "2026-11-24", daysToDue: 33 }))).toBe("ok");
    expect(invoiceTone(closing({ paidAt: "2026-10-20", invoiceDueDate: "2026-10-01" }))).toBe("paid");
  });

  it("kroky DL → faktura → platba", () => {
    expect(closingProgress(closing())).toEqual({ delivery: false, invoice: false, paid: false, done: 0 });
    expect(closingProgress(closing({ deliveryNoteConfirmedAt: "2026-10-20", invoiceNumber: " FV-1 " })).done).toBe(2);
    expect(closingProgress(closing({ invoiceDate: "2026-10-20", paidAt: "2026-10-21" }))).toMatchObject({ invoice: true, paid: true, delivery: false });
  });

  it("potvrzený dodací list = nejnovější nearchivovaný s názvem", () => {
    const f = (over: Partial<JobFile>): JobFile => ({
      id: "f", kind: "dodaci_list", title: CONFIRMED_DL_TITLE, filename: "dl.jpg", mimeType: "image/jpeg", sizeBytes: 1,
      version: 1, archived: false, replacedBy: null, quoteId: null, uploadedBy: null, createdAt: "2026-10-01T00:00:00Z",
      aiConfidence: null, note: null, hasAiData: false, ...over,
    });
    expect(confirmedDeliveryFile([
      f({ id: "old" }), f({ id: "new", createdAt: "2026-10-05T00:00:00Z" }), f({ id: "arch", archived: true, createdAt: "2026-10-09T00:00:00Z" }),
      f({ id: "plain", title: "Dodací list", createdAt: "2026-10-10T00:00:00Z" }),
    ])?.id).toBe("new");
    expect(confirmedDeliveryFile([f({ kind: "faktura" })])).toBeNull();
  });

  it("platba v řádku knihy", () => {
    const j = (over: Partial<JobListItem>) => ({ stage: "fakturovano" as const, paidAt: null, invoiceDueDate: null, invoiceNumber: null, ...over });
    expect(listPaymentMark(j({ stage: "ve_vyrobe" }), TODAY)).toBeNull();
    expect(listPaymentMark(j({ paidAt: "2026-10-03" }), TODAY)).toMatchObject({ tone: "paid", text: "zaplaceno", title: "Zaplaceno 3. 10. 2026" });
    expect(listPaymentMark(j({ invoiceDueDate: "2026-10-15", invoiceNumber: "FV-9" }), TODAY)).toEqual({
      tone: "overdue", text: "po splatnosti", title: "Faktura FV-9 — 7 dní po splatnosti (splatná 15. 10. 2026)",
    });
    expect(listPaymentMark(j({ invoiceDueDate: "2026-11-21" }), TODAY)).toMatchObject({ tone: "ok", text: "splatná 21. 11." });
    expect(listPaymentMark(j({ invoiceDueDate: "2026-10-24" }), TODAY)?.tone).toBe("soon");
    expect(listPaymentMark(j({ invoiceDueDate: TODAY }), TODAY)?.text).toBe("splatná dnes");
    expect(listPaymentMark(j({}), TODAY)?.text).toBe("vyfakturováno");
    expect(listPaymentMark(j({ stage: "dokonceno" }), TODAY)?.tone).toBe("paid");
  });
});
