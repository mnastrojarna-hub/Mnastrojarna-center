import { describe, it, expect } from "vitest";
import {
  jobInputToRow, validateJobInput, validateItems, diffJob, describeChanges, fieldEventMessage,
  computeItemTotals, cleanDate, cleanNumber, cleanQuantity, cleanCurrency, cleanTags, isUuid,
  jobItemToRow, quoteItemToRow, quoteInputToRow, quoteRevisionNumber, safeStorageName,
  isValidJobFilePath, jobFilePath, rowToJobListItem, rowToJobDetail, rowToJobEvent, rowToJobFile,
  resolveStageFilter, filterJobs, sortJobs, countJobStages, aiFilledColumns, stageEventMessage,
  computeMargin, todayIso, matchesDeadline, fetchPaged, isGenericCaptureName, translateDbError, type JobRow,
  paymentStateOf, matchesPayment, JOB_LIST_SELECT, rowToJobItem, rowToJobQuote, paymentKeyOf, flowFactsOfRow,
} from "./mapping";
import type { JobListItem } from "./types";

const UUID = "3f2b8c1e-1d2a-4c3b-9a8e-7f6d5c4b3a21";
const UUID2 = "11111111-2222-4333-8444-555555555555";

function listItem(over: Partial<JobListItem> = {}): JobListItem {
  return {
    id: over.id ?? UUID,
    number: "Z-2026-001",
    title: "Hřídel",
    stage: "poptavka",
    priority: "stredni",
    customer: { id: UUID2, name: "Strojmetal s.r.o.", customerNumber: "ZK0001", ico: "12345678" },
    customerOrderNumber: null,
    customerInquiryNumber: null,
    drawingNumbers: [],
    itemCount: 0,
    totalQuantity: 0,
    value: null,
    purchaseCost: null,
    currency: "CZK",
    inquiryDate: null,
    orderDate: null,
    customerRequiredDate: null,
    dueDate: null,
    expectedDeliveryDate: null,
    supplierPromisedDate: null,
    maxToleratedDate: null,
    receivedAt: null,
    deliveredAt: null,
    owner: null,
    assignee: null,
    createdBy: null,
    supplier: null,
    quoteCount: 0,
    fileCount: 0,
    aiFilled: false,
    source: "manual",
    createdAt: "2026-10-01T10:00:00Z",
    updatedAt: "2026-10-01T10:00:00Z",
    stageChangedAt: null,
    ...over,
  };
}

describe("normalizace", () => {
  it("cleanDate přijme jen platné RRRR-MM-DD", () => {
    expect(cleanDate("2026-03-12")).toBe("2026-03-12");
    expect(cleanDate("2026-03-12T10:00:00Z")).toBe("2026-03-12");
    expect(cleanDate("2026-02-30")).toBeNull();
    expect(cleanDate("12. 3. 2026")).toBeNull();
    expect(cleanDate("")).toBeNull();
    expect(cleanDate(20260312)).toBeNull();
  });
  it("cleanNumber zvládne české formáty a odmítne nesmysly", () => {
    expect(cleanNumber("12 500,50")).toBe(12500.5);
    expect(cleanNumber(42)).toBe(42);
    expect(cleanNumber(Number.NaN)).toBeNull();
    expect(cleanNumber(Infinity)).toBeNull();
    expect(cleanNumber("abc")).toBeNull();
    expect(cleanNumber("")).toBeNull();
  });
  it("cleanQuantity = 3 desetinná místa (kg, m), neplatné → 1", () => {
    expect(cleanQuantity(3)).toBe(3);
    expect(cleanQuantity(2.6)).toBe(2.6);
    expect(cleanQuantity(1.23456)).toBe(1.235);
    expect(cleanQuantity(0)).toBe(1);
    expect(cleanQuantity(-5)).toBe(1);
    expect(cleanQuantity(Number.NaN)).toBe(1);
  });
  it("měna a štítky", () => {
    expect(cleanCurrency("eur")).toBe("EUR");
    expect(cleanCurrency("")).toBe("CZK");
    expect(cleanCurrency("koruny")).toBe("CZK");
    expect(cleanTags([" a ", "a", "", "b"])).toEqual(["a", "b"]);
  });
  it("isUuid", () => {
    expect(isUuid(UUID)).toBe(true);
    expect(isUuid("x")).toBe(false);
    expect(isUuid(null)).toBe(false);
  });
  it("todayIso vrací pražské datum", () => {
    // 23:30 UTC 21. 10. = 01:30 v Praze 22. 10. (letní čas)
    expect(todayIso(new Date("2026-10-21T23:30:00Z"))).toBe("2026-10-22");
  });
});

describe("jobInputToRow", () => {
  it("mapuje jen přítomné klíče", () => {
    expect(jobInputToRow({ title: "  Hřídel  " })).toEqual({ title: "Hřídel" });
    expect(jobInputToRow({})).toEqual({});
  });
  it("prázdný řetězec → null, neplatné datum → null", () => {
    const row = jobInputToRow({ customerOrderNumber: "", dueDate: "2026-13-01", inquiryDate: "2026-01-05" });
    expect(row).toEqual({ customer_order_number: null, due_date: null, inquiry_date: "2026-01-05" });
  });
  it("stav → status, osoby a čísla", () => {
    const row = jobInputToRow({
      stage: "nabidka", priority: "vysoka", ownerId: UUID, assigneeId: "", pricedById: null,
      value: 1234.567, purchaseCost: Number.NaN, currency: "eur", tags: ["x"],
    });
    expect(row).toEqual({
      status: "nabidka", priority: "vysoka", owner_id: UUID, assignee_id: null, priced_by: null,
      value: 1234.57, purchase_cost: null, currency: "EUR", tags: ["x"],
    });
  });
  it("customerName není sloupec", () => {
    expect(jobInputToRow({ customerName: "ACME" })).toEqual({});
  });
  it("mapuje všechny termíny na správné sloupce", () => {
    const row = jobInputToRow({
      orderDate: "2026-01-01", customerRequiredDate: "2026-02-01", expectedDeliveryDate: "2026-02-02",
      supplierPromisedDate: "2026-02-03", maxToleratedDate: "2026-02-10",
    });
    expect(row).toEqual({
      order_date: "2026-01-01", customer_required_date: "2026-02-01", expected_delivery_date: "2026-02-02",
      supplier_promised_date: "2026-02-03", max_tolerated_date: "2026-02-10",
    });
  });
  it("neznámý stav se nemapuje", () => {
    expect(jobInputToRow({ stage: "xxx" as never })).toEqual({});
  });
});

describe("validateJobInput / validateItems", () => {
  it("odhalí neplatné hodnoty", () => {
    expect(validateJobInput({ stage: "xxx" as never })).toMatch(/stav/i);
    expect(validateJobInput({ dueDate: "zítra" })).toMatch(/Potvrzený termín/);
    expect(validateJobInput({ ownerId: "abc" })).toMatch(/Obchodník/);
    expect(validateJobInput({ value: -5 })).toMatch(/rozsah/);
    expect(validateJobInput({ customerContactEmail: "neni-email" })).toMatch(/e-mail/i);
    expect(validateJobInput({ title: "x".repeat(400) })).toMatch(/dlouhé/);
  });
  it("platný vstup projde", () => {
    expect(validateJobInput({ title: "A", dueDate: "", ownerId: null, value: null })).toBeNull();
  });
  it("položky", () => {
    expect(validateItems([{ quantity: 1 }])).toBeNull();
    expect(validateItems([{ quantity: 0 }])).toMatch(/množství/);
    expect(validateItems([{ quantity: 1, unitPrice: -1 }])).toMatch(/cena/);
    expect(validateItems([{ quantity: 1, vatRate: 150 }])).toMatch(/DPH/);
    expect(validateItems("x")).toMatch(/seznam/);
  });
});

describe("položky a součty", () => {
  it("computeItemTotals", () => {
    expect(computeItemTotals([])).toEqual({ value: null, purchaseCost: null });
    expect(computeItemTotals([
      { quantity: 3, unitPrice: 100.5, purchaseUnitPrice: 60 },
      { quantity: 2, unitPrice: null },
    ])).toEqual({ value: 301.5, purchaseCost: 180 });
    expect(computeItemTotals([{ quantity: 2, purchaseUnitPrice: 10 }])).toEqual({ value: null, purchaseCost: 20 });
  });
  it("jobItemToRow a quoteItemToRow", () => {
    expect(jobItemToRow({ quantity: 2, drawingNumber: " VK-1 ", unitPrice: 10 }, 0)).toEqual({
      position: 0, drawing_number: "VK-1", revision: null, name: null, description: null, material: null,
      quantity: 2, unit: "ks", unit_price: 10, purchase_unit_price: null, note: null,
    });
    expect(quoteItemToRow({ quantity: 1, vatRate: 12 }, 3)).toMatchObject({ position: 3, vat_rate: 12, unit: "ks" });
    expect(quoteItemToRow({ quantity: 1 }, 0)).toMatchObject({ vat_rate: 21 });
  });
  it("quoteInputToRow", () => {
    expect(quoteInputToRow({ title: " Nabídka ", validUntil: "2026-11-30", leadTimeDays: 14.4, status: "odeslano" }))
      .toEqual({ title: "Nabídka", valid_until: "2026-11-30", lead_time_days: 14, status: "odeslano" });
    expect(quoteInputToRow({ status: "nic" as never })).toEqual({});
  });
});

describe("diffJob", () => {
  it("vrátí jen skutečné změny s popisky", () => {
    const before = { title: "A", due_date: "2026-03-01", value: 100, tags: ["x"], note: null };
    const changes = diffJob(before, { title: "A", due_date: "2026-03-05", value: 100.001, tags: ["x"], note: null });
    expect(changes).toEqual([
      { field: "due_date", label: "Potvrzený termín zákazníkovi", from: "2026-03-01", to: "2026-03-05" },
    ]);
  });
  it("null vs prázdno není změna, nová hodnota ano", () => {
    expect(diffJob({ note: null }, { note: null })).toEqual([]);
    expect(diffJob({}, { note: "x" })).toEqual([{ field: "note", label: "Interní poznámka", from: null, to: "x" }]);
    expect(diffJob({ tags: ["a"] }, { tags: ["a", "b"] })).toHaveLength(1);
  });
  it("číselné řetězce z DB se porovnají jako čísla", () => {
    expect(diffJob({ value: "100.00" }, { value: 100 })).toEqual([]);
  });
  it("text změn a citlivá pole", () => {
    const changes = describeChanges(
      diffJob({ owner_id: null, purchase_cost: 10 }, { owner_id: UUID, purchase_cost: 20 }),
      { [UUID]: "Jan Novák" },
    );
    expect(changes[0]).toMatchObject({ fromText: "—", toText: "Jan Novák" });
    expect(changes[1].sensitive).toBe(true);
    expect(fieldEventMessage([changes[0]])).toBe("Obchodník: — → Jan Novák");
    expect(fieldEventMessage([changes[1]])).toBe("Nákupní náklady: upraveno");
    expect(fieldEventMessage(changes)).toMatch(/^Upraveno 2 polí/);
  });
});

describe("nabídky a soubory", () => {
  it("quoteRevisionNumber odřízne starou příponu", () => {
    expect(quoteRevisionNumber("NAB-2026-031", 2)).toBe("NAB-2026-031-R2");
    expect(quoteRevisionNumber("NAB-2026-031-R2", 3)).toBe("NAB-2026-031-R3");
  });
  it("safeStorageName", () => {
    expect(safeStorageName("Výkres čep ř.2 (rev B).PDF")).toBe("Vykres-cep-r.2-rev-B.PDF");
    expect(safeStorageName("../../etc/passwd")).toBe("etc-passwd");
    expect(safeStorageName("....")).toBe("soubor");
    expect(safeStorageName("model.step")).toBe("model.step");
    expect(safeStorageName("bez přípony")).toBe("bez-pripony");
  });
  it("obecné názvy z fotoaparátu se neverzují", () => {
    expect(isGenericCaptureName("image.jpg")).toBe(true);
    expect(isGenericCaptureName("IMAGE.JPEG")).toBe(true);
    expect(isGenericCaptureName("photo (2).heic")).toBe(true);
    expect(isGenericCaptureName("foto_1.png")).toBe(true);
    expect(isGenericCaptureName("VK-2291_rev_B.pdf")).toBe(false);
    expect(isGenericCaptureName("IMG_4512.jpg")).toBe(false);
    expect(isGenericCaptureName("image.pdf")).toBe(false);
  });
  it("chyby DB česky", () => {
    expect(translateDbError('insert or update on table "orders" violates foreign key constraint "x"')).toMatch(/neexistuje/);
    expect(translateDbError("duplicate key value violates unique constraint")).toMatch(/už existuje/);
    expect(translateDbError("Něco jiného")).toBe("Něco jiného");
  });
  it("cesta souboru musí patřit zakázce", () => {
    const p = jobFilePath(UUID, UUID2, "Žluťoučký kůň.jpg");
    expect(p).toBe(`zakazky/${UUID}/${UUID2}-Zlutoucky-kun.jpg`);
    expect(isValidJobFilePath(UUID, p)).toBe(true);
    expect(isValidJobFilePath(UUID2, p)).toBe(false);
    expect(isValidJobFilePath(UUID, `zakazky/${UUID}/../x`)).toBe(false);
    expect(isValidJobFilePath(UUID, `zakazky/${UUID}/x.pdf`)).toBe(false);
    expect(isValidJobFilePath(UUID, `/zakazky/${UUID}/${UUID2}-a.pdf`)).toBe(false);
  });
});

describe("řádky → view-modely", () => {
  const row: JobRow = {
    id: UUID,
    number: "Z-2026-007",
    title: "Příruba",
    status: "objednavka",
    priority: "vysoka",
    value: "1000.00",
    purchase_cost: 600,
    currency: "CZK",
    created_at: "2026-10-01T10:00:00Z",
    updated_at: "2026-10-02T10:00:00Z",
    quote_id: "q2",
    customer: [{ id: UUID2, name: "ACME", customer_number: "ZK0002", ico: "1", address: "Hlavní 1" }],
    owner: { id: "u1", full_name: "", email: "jan@firma.cz" },
    items: [
      { id: "i2", position: 1, drawing_number: "VK-2", quantity: 3, unit_price: 100, purchase_unit_price: 50 },
      { id: "i1", position: 0, drawing_number: "VK-1", quantity: 2, unit_price: 200, purchase_unit_price: 80 },
      { id: "i3", position: 2, drawing_number: "VK-1", quantity: 1 },
    ],
    quotes: [{ id: "q1", archived: true }, { id: "q2", archived: false }],
    files: [{ id: "f1", archived: false }],
  };

  it("seznam: odvozené hodnoty a skrytí nákupních cen", () => {
    const item = rowToJobListItem(row, { margins: false });
    expect(item.drawingNumbers).toEqual(["VK-1", "VK-2"]);
    expect(item.itemCount).toBe(3);
    expect(item.totalQuantity).toBe(6);
    expect(item.value).toBe(1000);
    expect(item.purchaseCost).toBeNull();
    expect(item.quoteCount).toBe(1);
    expect(item.fileCount).toBe(1);
    expect(item.customer).toEqual({ id: UUID2, name: "ACME", customerNumber: "ZK0002", ico: "1" });
    expect(item.owner).toEqual({ id: "u1", name: "jan@firma.cz" });
    expect(item.stage).toBe("objednavka");
    expect(rowToJobListItem(row, { margins: true }).purchaseCost).toBe(600);
  });

  it("detail: nabídky, soubory, události, marže", () => {
    const quotes = [
      { id: "q1", number: "NAB-1", status: "zamitnuto", created_at: "2026-10-01T00:00:00Z", archived: true, items: [] },
      {
        id: "q2", number: "NAB-1-R2", revision: 2, status: "prijato", created_at: "2026-10-03T00:00:00Z",
        items: [{ id: "qi", position: 0, quantity: 1, unit_price: 5, purchase_unit_price: 3, vat_rate: 21 }],
      },
    ];
    const files = [
      { id: "f1", job_id: UUID, kind: "vykres", filename: "a.pdf", created_at: "2026-10-01T00:00:00Z", ai_extracted: { a: 1 } },
      { id: "f0", job_id: UUID, kind: "nesmysl", filename: "b.pdf", created_at: "2026-10-02T00:00:00Z", archived: true },
    ];
    const events = [
      { id: "e1", type: "created", message: "Zakázka založena", created_at: "2026-10-01T00:00:00Z" },
      {
        id: "e2", type: "field", message: "x", created_at: "2026-10-02T00:00:00Z",
        data: { changes: [{ field: "purchase_cost", label: "Nákupní náklady", from: 1, to: 2, fromText: "1", toText: "2" }] },
      },
    ];
    const hidden = rowToJobDetail(row, { quotes, files, events }, { margins: false });
    expect(hidden.quotes.map((q) => q.id)).toEqual(["q2", "q1"]);
    expect(hidden.quotes[0].accepted).toBe(true);
    expect(hidden.quotes[0].items[0].purchaseUnitPrice).toBeNull();
    expect(hidden.items.map((i) => i.id)).toEqual(["i1", "i2", "i3"]);
    expect(hidden.items[0].purchaseUnitPrice).toBeNull();
    expect(hidden.margin).toBeNull();
    expect(hidden.purchaseCost).toBeNull();
    expect(hidden.files.map((f) => f.id)).toEqual(["f0", "f1"]);
    expect(hidden.files[0].kind).toBe("ostatni");
    expect(hidden.files[1].hasAiData).toBe(true);
    expect(hidden.events[0].id).toBe("e2");
    expect(hidden.events[0].data.changes).toEqual([{ field: "purchase_cost", label: "Nákupní náklady", sensitive: true }]);
    expect(hidden.customerDetail?.street).toBe("Hlavní 1");
    expect(hidden.customerDetail?.country).toBe("CZ");
    expect(hidden.quoteCount).toBe(1);

    const shown = rowToJobDetail(row, { quotes, files, events }, { margins: true });
    expect(shown.margin).toBe(0.4);
    expect(shown.items[0].purchaseUnitPrice).toBe(80);
    expect(shown.quotes[0].items[0].purchaseUnitPrice).toBe(3);
    expect((shown.events[0].data.changes as unknown[])[0]).toMatchObject({ from: 1, to: 2 });
  });

  it("neznámý typ události a soubor bez AI dat", () => {
    expect(rowToJobEvent({ id: "e", type: "xyz", message: "m", created_at: "x" }, { margins: true }).type).toBe("field");
    expect(rowToJobFile({ id: "f", job_id: UUID, kind: "foto", filename: "a.jpg", created_at: "x", ai_extracted: {} }).hasAiData).toBe(false);
  });

  it("computeMargin", () => {
    expect(computeMargin(1000, 750, { margins: true })).toBe(0.25);
    expect(computeMargin(0, 10, { margins: true })).toBeNull();
    expect(computeMargin(1000, null, { margins: true })).toBeNull();
    expect(computeMargin(1000, 750, { margins: false })).toBeNull();
  });
});

describe("filtry a řazení", () => {
  const today = new Date("2026-10-22T09:00:00");
  const a = listItem({ id: "a", number: "Z-2026-002", title: "Čep", customer: { id: "c", name: "Želva a.s.", customerNumber: null, ico: null }, dueDate: "2026-10-20", createdAt: "2026-10-02T00:00:00Z", value: 500, stage: "ve_vyrobe", drawingNumbers: ["VK-2291"] });
  const b = listItem({ id: "b", number: "Z-2026-010", title: "Hřídel", customer: null, customerRequiredDate: "2026-10-25", createdAt: "2026-10-05T00:00:00Z", value: null, stage: "poptavka" });
  const c = listItem({ id: "c", number: "Z-2026-001", title: "Příruba", customer: { id: "d", name: "ACME", customerNumber: null, ico: null }, createdAt: "2026-10-01T00:00:00Z", value: 1500, stage: "dokonceno", dueDate: "2026-09-01" });
  const all = [a, b, c];

  it("resolveStageFilter", () => {
    expect(resolveStageFilter({})).toBeNull();
    expect(resolveStageFilter({ group: "vse" })).toBeNull();
    expect(resolveStageFilter({ group: "zrusene" })).toEqual(["zruseno"]);
    expect(resolveStageFilter({ group: "zrusene", stages: ["nabidka", "nabidka"] })).toEqual(["nabidka"]);
  });

  it("fulltext bez diakritiky přes číslo, zákazníka a výkres", () => {
    expect(filterJobs(all, { q: "zelva" }).map((j) => j.id)).toEqual(["a"]);
    expect(filterJobs(all, { q: "vk 2291" }).map((j) => j.id)).toEqual(["a"]);
    expect(filterJobs(all, { q: "Z-2026-01" }).map((j) => j.id)).toEqual(["b"]);
    expect(filterJobs(all, { q: "hridel" }).map((j) => j.id)).toEqual(["b"]);
    expect(filterJobs(all, { q: "   " })).toHaveLength(3);
  });

  it("termíny", () => {
    expect(filterJobs(all, { deadline: "overdue" }, today).map((j) => j.id)).toEqual(["a"]);
    expect(filterJobs(all, { deadline: "week" }, today).map((j) => j.id)).toEqual(["b"]);
    expect(filterJobs(all, { deadline: "month" }, today).map((j) => j.id)).toEqual(["b"]);
    expect(filterJobs([...all, listItem({ id: "x" })], { deadline: "no_date" }, today).map((j) => j.id)).toEqual(["x"]);
    expect(matchesDeadline(c, "overdue", today)).toBe(false);
  });

  it("řazení", () => {
    expect(sortJobs(all).map((j) => j.id)).toEqual(["b", "a", "c"]);
    expect(sortJobs(all, "number", "asc").map((j) => j.id)).toEqual(["c", "a", "b"]);
    expect(sortJobs(all, "deadline", "asc").map((j) => j.id)).toEqual(["c", "a", "b"]);
    expect(sortJobs([b, listItem({ id: "n" }), a], "deadline", "desc").map((j) => j.id)).toEqual(["b", "a", "n"]);
    expect(sortJobs(all, "customer", "asc").map((j) => j.id)).toEqual(["c", "a", "b"]);
    expect(sortJobs(all, "value", "desc").map((j) => j.id)).toEqual(["c", "a", "b"]);
    expect(sortJobs(all, "value", "asc").map((j) => j.id)).toEqual(["a", "c", "b"]);
    expect(sortJobs(all, "stage", "asc").map((j) => j.id)).toEqual(["b", "a", "c"]);
  });

  it("countJobStages", () => {
    const counts = countJobStages([
      { status: "poptavka", customer_required_date: "2026-10-25" },
      { status: "ve_vyrobe", due_date: "2026-10-20" },
      { status: "ve_vyrobe", due_date: "2026-10-22" },
      { status: "dokonceno", due_date: "2026-01-01" },
      { status: "nesmysl" },
    ], today);
    expect(counts.total).toBe(5);
    expect(counts.byStage.ve_vyrobe).toBe(2);
    expect(counts.byStage.poptavka).toBe(2);
    expect(counts.byStage.zruseno).toBe(0);
    expect(counts.active).toBe(4);
    expect(counts.overdue).toBe(2);
    expect(counts.dueThisWeek).toBe(2);
  });
});

describe("výroba a platba v knize", () => {
  const today = new Date("2026-10-22T09:00:00");

  it("seznam nese souhrn výroby, domluvy a fakturu", () => {
    expect(JOB_LIST_SELECT).toContain("production_step");
    expect(JOB_LIST_SELECT).toContain("invoice_due_date");
    expect(JOB_LIST_SELECT).toContain("paid_at");
    const item = rowToJobListItem({
      id: UUID, number: "Z-1", title: "x", status: "ve_vyrobe", created_at: "2026-10-01T10:00:00Z",
      production_step: "tepelne_zpracovani", production_location: " TepKal s.r.o. ", production_done: "2",
      production_total: 5, production_problem: true, customer_note: "  balit po 10 ks ", delivery_note_confirmed_at: "2026-10-20",
      invoice_number: "FV-7", invoice_due_date: "2026-11-05", paid_at: null,
    }, { margins: false });
    expect(item.productionStep).toBe("tepelne_zpracovani");
    expect(item.productionLocation).toBe("TepKal s.r.o.");
    expect(item.productionDone).toBe(2);
    expect(item.productionTotal).toBe(5);
    expect(item.productionProblem).toBe(true);
    expect(item.customerNote).toBe("balit po 10 ks");
    expect(item.deliveryNoteConfirmedAt).toBe("2026-10-20");
    expect(item.invoiceNumber).toBe("FV-7");
    expect(item.invoiceDueDate).toBe("2026-11-05");
    expect(item.paidAt).toBeNull();
  });

  it("neznámý krok výroby a prázdné hodnoty", () => {
    const base = { id: UUID, number: "Z-1", title: "x", status: "objednavka", created_at: "2026-10-01T10:00:00Z" };
    const none = rowToJobListItem(base, { margins: true });
    expect(none.productionStep).toBeNull();
    expect(none.productionTotal).toBe(0);
    expect(none.productionProblem).toBe(false);
    expect(none.customerNote).toBeNull();
    expect(rowToJobListItem({ ...base, production_step: "hack" }, { margins: true }).productionStep).toBeNull();
    expect(rowToJobListItem({ ...base, production_step: "hotovo" }, { margins: true }).productionStep).toBe("hotovo");
  });

  it("stav úhrady", () => {
    expect(paymentStateOf(listItem({ stage: "objednavka" }), "2026-10-22")).toBeNull();
    expect(paymentStateOf(listItem({ stage: "fakturovano", invoiceDueDate: "2026-10-21" }), "2026-10-22")).toBe("po_splatnosti");
    expect(paymentStateOf(listItem({ stage: "fakturovano", invoiceDueDate: "2026-10-22" }), "2026-10-22")).toBe("nezaplaceno");
    expect(paymentStateOf(listItem({ stage: "fakturovano" }), "2026-10-22")).toBe("nezaplaceno");
    expect(paymentStateOf(listItem({ stage: "dodano_zakaznikovi", invoiceNumber: "FV-1" }), "2026-10-22")).toBe("nezaplaceno");
    expect(paymentStateOf(listItem({ stage: "fakturovano", invoiceDueDate: "2026-10-01", paidAt: "2026-10-10" }), "2026-10-22")).toBe("zaplaceno");
    expect(paymentStateOf(listItem({ stage: "dokonceno" }), "2026-10-22")).toBe("zaplaceno");
    expect(paymentStateOf(listItem({ stage: "zruseno", invoiceDueDate: "2026-10-01" }), "2026-10-22")).toBeNull();
  });

  it("filtry: operace, místo a platba", () => {
    const heat = listItem({ id: "h", stage: "ve_vyrobe", productionStep: "tepelne_zpracovani", productionLocation: "TepKal s.r.o." });
    const turn = listItem({ id: "t", stage: "ve_vyrobe", productionStep: "soustruzeni", productionLocation: "U nás" });
    const late = listItem({ id: "l", stage: "fakturovano", invoiceDueDate: "2026-10-01" });
    const open = listItem({ id: "o", stage: "fakturovano", invoiceDueDate: "2026-11-30" });
    const paid = listItem({ id: "p", stage: "dokonceno", paidAt: "2026-10-02" });
    const all = [heat, turn, late, open, paid];
    expect(filterJobs(all, { step: "tepelne_zpracovani" }, today).map((j) => j.id)).toEqual(["h"]);
    expect(filterJobs(all, { location: "tepkal S.R.O." }, today).map((j) => j.id)).toEqual(["h"]);
    expect(filterJobs(all, { location: "U nas" }, today).map((j) => j.id)).toEqual(["t"]);
    expect(filterJobs(all, { step: "soustruzeni", location: "TepKal s.r.o." }, today)).toHaveLength(0);
    expect(filterJobs(all, { payment: "po_splatnosti" }, today).map((j) => j.id)).toEqual(["l"]);
    expect(filterJobs(all, { payment: "nezaplaceno" }, today).map((j) => j.id)).toEqual(["l", "o"]);
    expect(filterJobs(all, { payment: "zaplaceno" }, today).map((j) => j.id)).toEqual(["p"]);
    expect(filterJobs(all, { step: "", location: "  " }, today)).toHaveLength(5);
    expect(matchesPayment(heat, undefined)).toBe(true);
  });
});

describe("fetchPaged", () => {
  it("stránkuje po 1000 a skončí na neúplné stránce", async () => {
    const calls: [number, number][] = [];
    const total = 2300;
    const res = await fetchPaged<number>(async (from, to) => {
      calls.push([from, to]);
      const rows = Array.from({ length: Math.max(0, Math.min(to, total - 1) - from + 1) }, (_, i) => from + i);
      return { data: rows, error: null };
    }, 5000);
    expect(res.data).toHaveLength(2300);
    expect(calls).toEqual([[0, 999], [1000, 1999], [2000, 2999]]);
  });
  it("respektuje maximum a vrátí chybu", async () => {
    const res = await fetchPaged<number>(async (from, to) => ({ data: Array.from({ length: to - from + 1 }, () => 1), error: null }), 1500);
    expect(res.data).toHaveLength(1500);
    const bad = await fetchPaged<number>(async () => ({ data: null, error: { message: "x" } }));
    expect(bad).toEqual({ data: [], error: { message: "x" } });
  });
});

describe("historie a AI učení", () => {
  it("stageEventMessage", () => {
    expect(stageEventMessage("nabidka", "objednavka")).toBe("Stav: Nabídka odeslaná → Objednávka");
    expect(stageEventMessage("nabidka", "zruseno", "zákazník odřekl")).toBe("Stav: Nabídka odeslaná → Zrušeno — zákazník odřekl");
  });
  it("aiFilledColumns respektuje pořadí a už opravená pole", () => {
    const set = aiFilledColumns([
      { type: "field", data: { aiCorrected: ["due_date"] }, created_at: "2026-10-03" },
      { type: "ai", data: { filledColumns: ["due_date", "title", 5] }, created_at: "2026-10-01" },
      { type: "ai", data: { filledColumns: ["value"] }, created_at: "2026-10-04" },
      { type: "comment", data: null, created_at: "2026-10-05" },
    ]);
    expect([...set].sort()).toEqual(["title", "value"]);
  });
});

describe("řádky → podrobné stavy toku a autor", () => {
  const base: JobRow = {
    id: UUID, number: "Z-2026-010", title: "Hřídel", status: "poptavka", priority: "stredni",
    created_at: "2026-10-01T10:00:00Z", updated_at: "2026-10-01T10:00:00Z",
  };
  const flowRow = {
    ...base,
    inquiry_status: "v_reseni", order_status: null, order_revision: 0, items_count: 2, items_priced: 1,
    paid_so_far: "0", stage_changed_at: "2026-10-02T08:00:00Z", stage_changed_by: "u1", stage_changed_via: "rucne",
    stage_change_cause: null, stage_change_note: "ručně",
    inquiry_status_changed_at: "2026-10-03T08:00:00Z", inquiry_status_changed_by: "u2", inquiry_status_changed_via: "rucne",
    lost_reason: null, flow_proposal: { phase: "inquiry", to: "odmitnuta", reason: "kapacita", kind: "ai", label: "Odmítnout" },
    flow_proposal_at: "2026-10-04T08:00:00Z", flow_proposal_by: null,
    stager: { id: "u1", full_name: "Jan Novák", email: "jan@firma.cz" },
    inq_by: [{ id: "u2", full_name: "Petr Obchodník", email: "petr@firma.cz" }],
    assignee: { id: "u2", full_name: "Petr Obchodník", email: "petr@firma.cz" },
    ops: [{ count: 3 }],
    pos: [{ status: "zrusena" }],
    sq: [{ total: null }, { total: "1200" }, { total: null }],
    quotes: [
      { id: "q1", archived: true },
      { id: "q2", status: "odeslano", state: "odeslana", revision: 2, number: "N-1", archived: false, sent_at: "2026-10-03T08:00:00Z" },
    ],
  } as unknown as JobRow;

  it("seznam: fakta toku, nabídky jako fakta a razítka ze sloupců *_changed_*", () => {
    const item = rowToJobListItem(flowRow, { margins: false });
    expect(item.flow).toMatchObject({
      stage: "poptavka", inquiryStatus: "v_reseni", itemsCount: 2, itemsPriced: 1, pendingSupplierQuotes: 2,
      hasOperations: true, hasPurchaseOrders: false, assigneeName: "Petr Obchodník",
    });
    expect(item.flowQuotes?.map((q) => [q.id, q.state])).toEqual([["q2", "odeslana"]]);
    expect(item.stamps?.stage).toMatchObject({ by: { id: "u1", name: "Jan Novák" }, via: "rucne", kind: "user", note: "ručně" });
    expect(item.stamps?.inquiry).toMatchObject({ by: { id: "u2", name: "Petr Obchodník" }, kind: "user" });
    expect(item.stamps?.order).toBeNull();
    expect(item.stamps?.lost).toBeNull();
    // návrh od AI bez uživatele = druh ai
    expect(item.stamps?.proposal).toMatchObject({ kind: "ai", at: "2026-10-04T08:00:00Z" });
  });

  it("bez sloupců toku (starší výběr) se fakta nedopočítávají", () => {
    const item = rowToJobListItem(base, { margins: false });
    expect(item.flow).toBeUndefined();
    expect(item.stamps).toBeUndefined();
  });

  it("důvod prohry nese razítko lost_*; zrušená PO se do nákupu nepočítá", () => {
    const facts = flowFactsOfRow({
      ...flowRow, status: "nerealizovano", lost_reason: "kapacita", lost_at: "2026-10-05T08:00:00Z", lost_by: "u2",
      pos: [{ status: "odeslana" }],
    } as unknown as JobRow);
    expect(facts.lostReason).toBe("kapacita");
    expect(facts.hasPurchaseOrders).toBe(true);
    const item = rowToJobListItem({ ...flowRow, lost_reason: "kapacita", lost_at: "2026-10-05T08:00:00Z", lost_by: "u2" } as unknown as JobRow, { margins: false });
    expect(item.stamps?.lost).toMatchObject({ at: "2026-10-05T08:00:00Z", kind: "user" });
  });

  it("událost: druh, uložené jméno, způsob a fáze; neznámé hodnoty se zahodí", () => {
    const ai = rowToJobEvent({
      id: "e1", type: "status", message: "Poptávka: Přijatá → V řešení", created_at: "x", actor_id: null,
      actor_kind: "ai", actor_name: null, via: "email", agent: "email-ingest", entity: "inquiry",
    }, { margins: true });
    expect(ai).toMatchObject({ type: "status", actorKind: "ai", via: "email", agent: "email-ingest", entity: "inquiry", actor: null });
    const deleted = rowToJobEvent({
      id: "e2", type: "stage", message: "m", created_at: "x", actor_id: null, actor_kind: "user", actor_name: "Karel Smazaný", via: "rucne",
    }, { margins: true });
    expect(deleted).toMatchObject({ actorKind: "user", actorName: "Karel Smazaný", actor: null });
    const legacy = rowToJobEvent({ id: "e3", type: "stage", message: "m", created_at: "x", actor_id: "u1", via: "telepatie" }, { margins: true });
    expect(legacy).toMatchObject({ actorKind: "user", via: null });
    expect(rowToJobEvent({ id: "e4", type: "stage", message: "m", created_at: "x" }, { margins: true }).actorKind).toBeNull();
  });

  it("nabídka: podrobný stav, kdo odeslal a razítko stavu (AI = druh ai)", () => {
    const q = rowToJobQuote({
      id: "q1", number: "N-1", status: "odeslano", state: "odeslana", created_at: "x", sent_via: "email",
      sender: { id: "u1", full_name: "Jan Novák", email: "jan@firma.cz" }, approval_required: true,
      state_changed_at: "2026-10-03T08:00:00Z", state_changed_by: null, state_changed_via: "ai", feedback: "  ",
    }, { margins: false });
    expect(q).toMatchObject({ state: "odeslana", approvalRequired: true, sentVia: "email", sentBy: { id: "u1", name: "Jan Novák" }, feedback: null });
    expect(q.stateStamp).toMatchObject({ kind: "ai", via: "ai", by: null });
    const noState = rowToJobQuote({ id: "q2", number: "N-2", status: "navrh_ai", state: "nesmysl", created_at: "x" }, { margins: false });
    expect(noState.state).toBeUndefined();
    expect(noState.stateStamp).toBeNull();
  });

  it("položka: dodané množství a uzavření s menším množstvím", () => {
    const it1 = rowToJobItem({ id: "i1", position: 0, quantity: 10, delivered_quantity: "7", delivery_closed: true, delivery_closed_reason: "zmetky" }, { margins: false });
    expect(it1).toMatchObject({ deliveredQuantity: 7, deliveryClosed: true, deliveryClosedReason: "zmetky" });
    const it2 = rowToJobItem({ id: "i2", position: 1, quantity: 1 }, { margins: false });
    expect(it2.deliveredQuantity).toBeUndefined();
  });

  it("platba z faktů toku: částečná úhrada = nezaplaceno / castecne_zaplaceno", () => {
    const flow = rowToJobListItem({ ...flowRow, status: "fakturovano", invoice_number: "FV-1", invoice_due_date: "2026-11-30", paid_so_far: 500 } as unknown as JobRow, { margins: true });
    expect(paymentKeyOf(flow, "2026-10-22")).toBe("castecne_zaplaceno");
    expect(paymentStateOf(flow, "2026-10-22")).toBe("nezaplaceno");
    expect(matchesPayment(flow, "castecne_zaplaceno", "2026-10-22")).toBe(true);
    expect(matchesPayment(flow, "nezaplaceno", "2026-10-22")).toBe(true);
    expect(matchesPayment(flow, "ceka_na_uhradu", "2026-10-22")).toBe(false);
  });
});
