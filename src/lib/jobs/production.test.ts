import { describe, it, expect } from "vitest";
import {
  addDays, addedEventMessage, appendNote, canDeleteOwnOperation, computeClosingInfo, countProductionFilters, czDay,
  daysBetween, describeOperationChanges, diffOperation, dueDateFor, dueText, expandTemplate, insertPositions,
  isOperationOverdue, moveOperation, moveToIndex, nextToAutoStart, operationDisplayName, operationInputToRow,
  operationLocation, positionUpdates, resolveWho, rowToJobOperation, sortOperations, statusEventMessage,
  summarizeOperations, summaryFromJob, updateEventMessage, validateOperationInput, validateOperationList,
  validateReorder, type JobOperationDbRow,
} from "./production";
import { OPERATION_TEMPLATES } from "./operations";

const SUP = "d4000000-0000-0000-0000-000000000002";
const PO = "aaaaaaaa-0000-0000-0000-000000000001";
const ME = "156c7996-b488-4c53-a3f5-e51dd004f4ad";

function row(p: Partial<JobOperationDbRow> = {}): JobOperationDbRow {
  return {
    id: "op-1", job_id: "job-1", position: 0, kind: "soustruzeni", title: null,
    supplier_id: null, supplier_name: null, in_house: false, status: "ceka",
    planned_start: null, planned_end: null, started_at: null, finished_at: null, note: null,
    purchase_order_id: null, created_by: null, created_at: "2026-10-22T08:00:00Z", updated_at: "2026-10-22T08:00:00Z",
    ...p,
  };
}

describe("data a splatnost", () => {
  it("dny a české datum", () => {
    expect(addDays("2026-10-22", 45)).toBe("2026-12-06");
    expect(addDays("2026-12-31", 1)).toBe("2027-01-01");
    expect(daysBetween("2026-10-22", "2026-11-05")).toBe(14);
    expect(daysBetween("2026-10-22", "2026-10-20")).toBe(-2);
    expect(czDay("2026-11-05")).toBe("5. 11. 2026");
  });
  it("splatnost = datum faktury + podmínky zákazníka, jinak 14 dní", () => {
    expect(dueDateFor("2026-10-22", 30)).toBe("2026-11-21");
    expect(dueDateFor("2026-10-22", null)).toBe("2026-11-05");
    expect(dueDateFor("2026-10-22", -5)).toBe("2026-11-05");
    expect(dueDateFor("2026-10-22", 0)).toBe("2026-10-22");
  });
});

describe("operace: řádek → view", () => {
  it("místo: u nás / dodavatel / volný název / —", () => {
    expect(operationLocation({ inHouse: true, supplier: { name: "X" } })).toBe("U nás");
    expect(operationLocation({ inHouse: false, supplier: { name: "TepKal s.r.o." } })).toBe("TepKal s.r.o.");
    expect(operationLocation({ inHouse: false, supplier: null, supplierName: " Brusírna Novák " })).toBe("Brusírna Novák");
    expect(operationLocation({ inHouse: false })).toBe("—");
  });

  it("převod s dodavatelem, autorem, objednávkou a termínem po splatnosti", () => {
    const v = rowToJobOperation(row({
      kind: "tepelne_zpracovani", supplier_id: SUP, status: "probiha", planned_end: "2026-10-20",
      supplier: { id: SUP, name: "TepKal s.r.o." }, creator: [{ id: ME, full_name: "Petr Obchodník" }],
      purchase_order_id: PO, po: { id: PO, number: "OV-2026-004" },
    }), "2026-10-22");
    expect(v).toMatchObject({
      kind: "tepelne_zpracovani", label: "Tepelné zpracování", location: "TepKal s.r.o.",
      supplier: { id: SUP, name: "TepKal s.r.o." }, status: "probiha", overdue: true,
      createdBy: { id: ME, name: "Petr Obchodník" }, purchaseOrderNumber: "OV-2026-004",
    });
    expect(operationDisplayName(v)).toBe("Tepelné zpracování (TepKal s.r.o.)");
  });

  it("neznámý druh / stav → jiné / čeká; vlastní název má přednost", () => {
    const v = rowToJobOperation(row({ kind: "xxx", status: "??" as never, title: "Soustružení — 2. upnutí" }));
    expect(v.kind).toBe("jine");
    expect(v.status).toBe("ceka");
    expect(v.label).toBe("Soustružení — 2. upnutí");
    expect(operationDisplayName(v)).toBe("Soustružení — 2. upnutí");
  });

  it("po termínu jen nehotové", () => {
    expect(isOperationOverdue({ status: "ceka", plannedEnd: "2026-10-21" }, "2026-10-22")).toBe(true);
    expect(isOperationOverdue({ status: "ceka", plannedEnd: "2026-10-22" }, "2026-10-22")).toBe(false);
    expect(isOperationOverdue({ status: "hotovo", plannedEnd: "2026-10-01" }, "2026-10-22")).toBe(false);
    expect(isOperationOverdue({ status: "preskoceno", plannedEnd: "2026-10-01" }, "2026-10-22")).toBe(false);
    expect(isOperationOverdue({ status: "problem", plannedEnd: null }, "2026-10-22")).toBe(false);
  });

  it("řazení podle pozice, při shodě podle založení", () => {
    const s = sortOperations([
      { id: "b", position: 1, createdAt: "2026-01-02" },
      { id: "c", position: 0, createdAt: "2026-01-03" },
      { id: "a", position: 1, createdAt: "2026-01-01" },
    ]);
    expect(s.map((x) => x.id)).toEqual(["c", "a", "b"]);
  });
});

describe("souhrn výroby", () => {
  it("z orders.production_*", () => {
    expect(summaryFromJob({ production_step: "tepelne_zpracovani", production_location: "TepKal s.r.o.", production_done: 1, production_total: 4 }))
      .toEqual({ step: "tepelne_zpracovani", location: "TepKal s.r.o.", done: 1, total: 4, problem: false, label: "Tepelné zpracování · TepKal s.r.o.", percent: 25 });
    expect(summaryFromJob({ production_step: "hotovo", production_done: 3, production_total: 3 })).toMatchObject({ label: "Výroba hotová", percent: 100 });
    expect(summaryFromJob({})).toMatchObject({ step: null, label: null, percent: 0, total: 0 });
  });

  it("z operací — stejně jako DB trigger", () => {
    const ops = [
      rowToJobOperation(row({ id: "1", position: 0, status: "hotovo", in_house: true })),
      rowToJobOperation(row({ id: "2", position: 1, kind: "tepelne_zpracovani", supplier: { id: SUP, name: "TepKal s.r.o." }, supplier_id: SUP })),
      rowToJobOperation(row({ id: "3", position: 2, kind: "brouseni", status: "problem", in_house: true })),
      rowToJobOperation(row({ id: "4", position: 3, kind: "povrchova_uprava", status: "preskoceno" })),
    ];
    expect(summarizeOperations(ops)).toMatchObject({ step: "brouseni", location: "U nás", done: 1, total: 3, problem: true, percent: 33 });
    const waiting = ops.map((o) => (o.id === "3" ? { ...o, status: "ceka" as const } : o));
    expect(summarizeOperations(waiting)).toMatchObject({ step: "tepelne_zpracovani", location: "TepKal s.r.o.", problem: false });
    const all = ops.map((o) => (o.status === "preskoceno" ? o : { ...o, status: "hotovo" as const }));
    expect(summarizeOperations(all)).toMatchObject({ step: "hotovo", label: "Výroba hotová", percent: 100 });
    expect(summarizeOperations([])).toMatchObject({ step: null, total: 0 });
  });
});

describe("validace a převod vstupu", () => {
  it("chyby česky", () => {
    expect(validateOperationInput({ kind: "soustruzeni" })).toBeNull();
    expect(validateOperationInput({ kind: "nic" as never })).toBe("Neznámý druh operace.");
    expect(validateOperationInput({}, true)).toBeNull();
    expect(validateOperationInput({ kind: "frezovani", supplierId: "x" })).toBe("Neplatný dodavatel.");
    expect(validateOperationInput({ kind: "frezovani", status: "hotove" as never })).toBe("Neznámý stav operace.");
    expect(validateOperationInput({ kind: "frezovani", plannedEnd: "31. 10." })).toMatch(/Neplatné datum/);
    expect(validateOperationInput({ kind: "frezovani", plannedStart: "2026-11-02", plannedEnd: "2026-11-01" })).toMatch(/po jejím termínu/);
    expect(validateOperationInput({ kind: "frezovani", purchaseOrderId: "x" })).toBe("Neplatná objednávka.");
    expect(validateOperationInput({ kind: "frezovani", title: "x".repeat(301) })).toMatch(/příliš dlouhý/);
    expect(validateOperationInput(null)).toBe("Chybí údaje operace.");
  });

  it("seznam operací", () => {
    expect(validateOperationList([])).toBe("Vyber aspoň jednu operaci.");
    expect(validateOperationList([{ kind: "soustruzeni" }, { kind: "x" }])).toBe("Operace 2: Neznámý druh operace.");
    expect(validateOperationList(Array.from({ length: 61 }, () => ({ kind: "jine" })))).toMatch(/nejvýš 60/);
  });

  it("kdo dělá: u nás přebije dodavatele, dodavatel přebije volný název", () => {
    expect(resolveWho({})).toBeNull();
    expect(resolveWho({ inHouse: true, supplierId: SUP })).toEqual({ in_house: true, supplier_id: null, supplier_name: null });
    expect(resolveWho({ supplierId: SUP.toUpperCase(), supplierName: "X" })).toEqual({ in_house: false, supplier_id: SUP, supplier_name: null });
    expect(resolveWho({ supplierName: " Brusírna " })).toEqual({ in_house: false, supplier_id: null, supplier_name: "Brusírna" });
    expect(resolveWho({ supplierId: null })).toEqual({ in_house: false, supplier_id: null, supplier_name: null });
  });

  it("nová operace dostane výchozí stav a „kdo“; úprava jen zadaná pole", () => {
    expect(operationInputToRow({ kind: "brouseni", title: "  ", plannedEnd: "2026-11-05", purchaseOrderId: PO })).toEqual({
      kind: "brouseni", title: null, in_house: false, supplier_id: null, supplier_name: null, status: "ceka",
      planned_end: "2026-11-05", purchase_order_id: PO,
    });
    expect(operationInputToRow({ note: " volal ", plannedEnd: null }, true)).toEqual({ note: "volal", planned_end: null });
  });

  it("diff jen skutečných změn", () => {
    const before = { kind: "brouseni", in_house: false, supplier_id: null, supplier_name: null, planned_end: "2026-11-05", note: null };
    expect(diffOperation(before, { in_house: false, planned_end: "2026-11-05", note: null })).toEqual({});
    expect(diffOperation(before, { in_house: true, supplier_id: null, supplier_name: null, planned_end: "2026-11-06" }))
      .toEqual({ in_house: true, planned_end: "2026-11-06" });
  });
});

describe("pořadí operací", () => {
  const ids = ["a", "b", "c", "d"];
  it("posun nahoru / dolů a na index", () => {
    expect(moveOperation(ids, "c", "up")).toEqual(["a", "c", "b", "d"]);
    expect(moveOperation(ids, "c", "down")).toEqual(["a", "b", "d", "c"]);
    expect(moveOperation(ids, "a", "up")).toBeNull();
    expect(moveOperation(ids, "d", "down")).toBeNull();
    expect(moveOperation(ids, "x", "up")).toBeNull();
    expect(moveToIndex(ids, "d", 0)).toEqual(["d", "a", "b", "c"]);
    expect(moveToIndex(ids, "a", 99)).toEqual(["b", "c", "d", "a"]);
  });

  it("validace nového pořadí", () => {
    expect(validateReorder(ids, ["d", "c", "b", "a"])).toBeNull();
    expect(validateReorder(ids, ["a", "b", "c"])).toMatch(/obnov stránku/);
    expect(validateReorder(ids, ["a", "a", "b", "c"])).toMatch(/obnov stránku/);
    expect(validateReorder(ids, ["a", "b", "c", "x"])).toMatch(/obnov stránku/);
    expect(validateReorder(ids, "abc")).toBe("Chybí pořadí operací.");
  });

  it("pozice — jen měněné", () => {
    const cur = [{ id: "a", position: 0 }, { id: "b", position: 1 }, { id: "c", position: 5 }];
    expect(positionUpdates(cur, ["a", "c", "b"])).toEqual([{ id: "c", position: 1 }, { id: "b", position: 2 }]);
    expect(positionUpdates(cur, ["a", "b", "c"])).toEqual([{ id: "c", position: 2 }]);
  });

  it("vložení na konec / doprostřed / na začátek", () => {
    const cur = [{ id: "a", position: 0 }, { id: "b", position: 1 }, { id: "c", position: 2 }];
    expect(insertPositions([], 2)).toEqual({ positions: [0, 1], shifts: [] });
    expect(insertPositions(cur, 2)).toEqual({ positions: [3, 4], shifts: [] });
    expect(insertPositions([{ id: "a", position: 7 }], 1)).toEqual({ positions: [8], shifts: [] });
    expect(insertPositions(cur, 2, 1)).toEqual({ positions: [1, 2], shifts: [{ id: "b", position: 3 }, { id: "c", position: 4 }] });
    expect(insertPositions(cur, 1, 0)).toEqual({ positions: [0], shifts: [{ id: "a", position: 1 }, { id: "b", position: 2 }, { id: "c", position: 3 }] });
    expect(insertPositions(cur, 1, 3)).toEqual({ positions: [3], shifts: [] });
  });
});

describe("šablony", () => {
  it("rozbalení s dodavatelem podle druhu (id / u nás / volný název)", () => {
    const ops = expandTemplate("soustruzeny", { soustruzeni: "u_nas", tepelne_zpracovani: SUP, brouseni: "Brusírna Novák" });
    expect(ops).toEqual([
      { kind: "soustruzeni", inHouse: true },
      { kind: "tepelne_zpracovani", supplierId: SUP },
      { kind: "brouseni", supplierName: "Brusírna Novák" },
      { kind: "povrchova_uprava" },
    ]);
    expect(validateOperationList(ops)).toBeNull();
    expect(expandTemplate("komplet")).toEqual([{ kind: "kompletni_dodavka" }]);
    expect(expandTemplate("neznama")).toBeNull();
    for (const t of OPERATION_TEMPLATES) expect(expandTemplate(t.key)?.length).toBe(t.kinds.length);
  });
});

describe("navazující operace se rozběhne sama", () => {
  const who = (id: string, position: number, p: Partial<{ status: "ceka" | "probiha" | "hotovo" | "problem" | "preskoceno"; inHouse: boolean; supplierId: string | null; supplierName: string | null }> = {}) => ({
    id, position, status: "ceka" as const, inHouse: false, supplierId: null, supplierName: null, ...p,
  });

  it("u nás nebo stejná firma → ano; jiná firma → čeká na převoz", () => {
    const ops = [
      who("1", 0, { status: "hotovo", supplierId: SUP }),
      who("2", 1, { supplierId: SUP }),
      who("3", 2, { inHouse: true }),
      who("4", 3, { supplierName: "Brusírna" }),
    ];
    expect(nextToAutoStart(ops, "1")).toBe("2");
    expect(nextToAutoStart(ops.map((o) => (o.id === "2" ? { ...o, status: "hotovo" as const } : o)), "2")).toBe("3");
    expect(nextToAutoStart([...ops.slice(0, 1), who("2", 1, { supplierId: "d4000000-0000-0000-0000-000000000003" })], "1")).toBeNull();
    expect(nextToAutoStart([who("1", 0, { status: "hotovo", inHouse: true }), who("2", 1, { supplierId: SUP })], "1")).toBeNull();
    expect(nextToAutoStart([who("1", 0, { status: "hotovo", supplierName: "Brusírna" }), who("2", 1, { supplierName: " brusírna " })], "1")).toBe("2");
    expect(nextToAutoStart([who("1", 0, { status: "hotovo" }), who("2", 1)], "1")).toBeNull();
  });

  it("přeskočené a hotové se přeskakují; běžící zastaví", () => {
    expect(nextToAutoStart([
      who("1", 0, { status: "hotovo", inHouse: true }), who("2", 1, { status: "preskoceno" }), who("3", 2, { inHouse: true }),
    ], "1")).toBe("3");
    expect(nextToAutoStart([
      who("1", 0, { status: "hotovo", inHouse: true }), who("2", 1, { status: "probiha", inHouse: true }), who("3", 2, { inHouse: true }),
    ], "1")).toBeNull();
    expect(nextToAutoStart([who("1", 0, { status: "hotovo", inHouse: true })], "1")).toBeNull();
    expect(nextToAutoStart([], "x")).toBeNull();
  });
});

describe("mazání vlastní operace do 24 h", () => {
  const now = new Date("2026-10-22T12:00:00Z");
  it("jen autor a jen 24 hodin", () => {
    expect(canDeleteOwnOperation({ created_by: ME, created_at: "2026-10-22T10:00:00Z" }, ME, now)).toBe(true);
    expect(canDeleteOwnOperation({ created_by: ME, created_at: "2026-10-21T11:59:00Z" }, ME, now)).toBe(false);
    expect(canDeleteOwnOperation({ created_by: "jiny", created_at: "2026-10-22T10:00:00Z" }, ME, now)).toBe(false);
    expect(canDeleteOwnOperation({ created_by: null, created_at: "2026-10-22T10:00:00Z" }, ME, now)).toBe(false);
  });
});

describe("poznámky", () => {
  it("připíše řádek s časem a autorem", () => {
    const at = new Date("2026-10-22T12:05:00Z"); // 14:05 v Praze (letní čas)
    expect(appendNote(null, " díly odvezeny ", "Petr Obchodník", at)).toBe("22. 10. 2026 14:05 · Petr Obchodník: díly odvezeny");
    expect(appendNote("starší", "nová", null, at)).toBe("starší\n22. 10. 2026 14:05: nová");
    expect(appendNote("x".repeat(10_000), "nová", "P", at).endsWith("· P: nová")).toBe(true);
    expect(appendNote("x".repeat(10_000), "nová", "P", at).length).toBe(10_000);
  });
});

describe("konec toku: faktura a splatnost", () => {
  const base = { id: "job-1", status: "fakturovano", invoice_number: "FV-2026-0012", invoice_date: "2026-10-01", customer: { id: "c", payment_terms_days: 30 } };
  it("po splatnosti a dny do splatnosti", () => {
    const late = computeClosingInfo({ ...base, invoice_due_date: "2026-10-15" }, { margins: true, today: "2026-10-22" });
    expect(late).toMatchObject({ stage: "fakturovano", overdueInvoice: true, daysToDue: -7, paymentTermsDays: 30, invoiceNumber: "FV-2026-0012" });
    expect(dueText(late)).toBe("7 dní po splatnosti");
    const soon = computeClosingInfo({ ...base, invoice_due_date: "2026-10-24" }, { margins: true, today: "2026-10-22" });
    expect(soon).toMatchObject({ overdueInvoice: false, daysToDue: 2 });
    expect(dueText(soon)).toBe("splatná za 2 dny");
    expect(dueText({ paidAt: null, daysToDue: 0, invoiceDueDate: "2026-10-22" })).toBe("splatná dnes");
    expect(dueText({ paidAt: null, daysToDue: -1, invoiceDueDate: "2026-10-21" })).toBe("1 den po splatnosti");
  });
  it("zaplaceno → nic nehoří; částka jen s právem na marže", () => {
    const paid = { ...base, invoice_due_date: "2026-10-15", paid_at: "2026-10-20", paid_amount: "12500.50" };
    expect(computeClosingInfo(paid, { margins: true, today: "2026-10-22" })).toMatchObject({ overdueInvoice: false, daysToDue: null, paidAmount: 12500.5 });
    expect(computeClosingInfo(paid, { margins: false, today: "2026-10-22" }).paidAmount).toBeNull();
    expect(dueText(computeClosingInfo(paid, { margins: false }))).toBe("zaplaceno 20. 10. 2026");
    expect(computeClosingInfo({ id: "x", status: "??" }, { margins: false })).toMatchObject({ stage: "poptavka", daysToDue: null, overdueInvoice: false });
  });
});

describe("filtry knihy", () => {
  it("počty aktivních zakázek podle operace a místa", () => {
    const res = countProductionFilters([
      { status: "ve_vyrobe", production_step: "tepelne_zpracovani", production_location: "TepKal s.r.o." },
      { status: "ve_vyrobe", production_step: "soustruzeni", production_location: "U nás" },
      { status: "potvrzeno", production_step: "soustruzeni", production_location: "TepKal s.r.o." },
      { status: "dodano_k_nam", production_step: "hotovo", production_location: null },
      { status: "dokonceno", production_step: "brouseni", production_location: "U nás" },
      { status: "ve_vyrobe", production_step: null, production_location: null },
    ]);
    expect(res.steps).toEqual([
      { key: "soustruzeni", label: "Soustružení", count: 2 },
      { key: "tepelne_zpracovani", label: "Tepelné zpracování", count: 1 },
      { key: "hotovo", label: "Výroba hotová", count: 1 },
    ]);
    expect(res.locations).toEqual([{ name: "TepKal s.r.o.", count: 2 }, { name: "U nás", count: 1 }]);
  });
});

describe("texty do historie", () => {
  it("stav, přidání, úprava", () => {
    expect(statusEventMessage("Tepelné zpracování (TepKal s.r.o.)", "probiha")).toBe("Výroba: Tepelné zpracování (TepKal s.r.o.) → Probíhá");
    expect(statusEventMessage("Broušení (U nás)", "problem", "chybí přídavek")).toBe("Výroba: Broušení (U nás) → Problém — chybí přídavek");
    expect(addedEventMessage(["Soustružení"])).toBe("Přidána operace: Soustružení");
    expect(addedEventMessage(["Soustružení", "Frézování (TepKal s.r.o.)"])).toBe("Přidány operace: Soustružení, Frézování (TepKal s.r.o.)");
    expect(addedEventMessage(Array.from({ length: 10 }, (_, i) => `Op${i}`))).toMatch(/a další \(2\)$/);
    const ch = describeOperationChanges({ planned_end: "2026-11-05", supplier_id: SUP, note: "x", title: null }, "TepKal s.r.o.");
    expect(ch).toEqual(["název odstraněn", "kdo: TepKal s.r.o.", "termín 5. 11. 2026", "poznámka"]);
    expect(updateEventMessage("Broušení (U nás)", ch)).toBe("Výroba: Broušení (U nás) — název odstraněn, kdo: TepKal s.r.o., termín 5. 11. 2026, poznámka");
  });
});
