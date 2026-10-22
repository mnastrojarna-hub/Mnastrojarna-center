import { describe, it, expect } from "vitest";
import {
  addDaysIso, toIsoDay, shortDate, parseDecimal, isInvalidDecimal, decimalInput, buildTimeline, stepDate,
  deadlineWarnings, dateTone, relativeDays, quoteActions, splitQuotes, primaryQuote, eventTone, eventStage,
  eventChanges, groupFiles, replacedByLabel, isImageFile, emptyItemDraft, itemToDraft, validateDrafts,
  draftToItemInput, draftTotals, draftsSignature, moveItem, isBlankDraft, quoteFormFromJob, validateQuoteForm,
  quoteFormToInput, parseTags, tagTone, filterOptions, isDetailTab, formatBytes, lineTotal, quoteStatusMeta,
  type TimelineInput, type ItemDraft,
} from "./detail-helpers";
import { STAGES } from "@/lib/jobs/stages";

const TODAY = new Date("2026-10-22T10:00:00Z");

function tl(over: Partial<TimelineInput> = {}): TimelineInput {
  return {
    stage: "poptavka", inquiryDate: null, orderDate: null, confirmedAt: null, productionStartedAt: null,
    receivedAt: null, deliveredAt: null, invoicedAt: null, stageChangedAt: null, quotes: [], ...over,
  };
}

describe("datum", () => {
  it("addDaysIso přes konec měsíce i roku", () => {
    expect(addDaysIso("2026-10-22", 30)).toBe("2026-11-21");
    expect(addDaysIso("2026-12-31", 1)).toBe("2027-01-01");
    expect(addDaysIso("2026-03-01", -1)).toBe("2026-02-28");
  });
  it("toIsoDay a shortDate", () => {
    expect(toIsoDay("2026-03-05")).toBe("2026-03-05");
    expect(toIsoDay("2026-03-05T23:30:00Z")).toBe("2026-03-06"); // Praha = UTC+1
    expect(toIsoDay(null)).toBeNull();
    expect(toIsoDay("nesmysl")).toBeNull();
    expect(shortDate("2026-03-05", TODAY)).toBe("5. 3.");
    expect(shortDate("2025-12-24", TODAY)).toBe("24. 12. 2025");
  });
  it("relativeDays", () => {
    expect(relativeDays("2026-10-22", TODAY)).toBe("dnes");
    expect(relativeDays("2026-10-23", TODAY)).toBe("zítra");
    expect(relativeDays("2026-10-27", TODAY)).toBe("za 5 dní");
    expect(relativeDays("2026-10-24", TODAY)).toBe("za 2 dny");
    expect(relativeDays("2026-10-17", TODAY)).toBe("před 5 dny");
  });
});

describe("čísla", () => {
  it("parseDecimal s českou čárkou, mezerami a měnou", () => {
    expect(parseDecimal("1,5")).toBe(1.5);
    expect(parseDecimal("1 234,50 Kč")).toBe(1234.5);
    expect(parseDecimal("12")).toBe(12);
    expect(parseDecimal("")).toBeNull();
    expect(parseDecimal("abc")).toBeNull();
    expect(parseDecimal("1,2,3")).toBeNull();
    expect(parseDecimal(7)).toBe(7);
    expect(isInvalidDecimal("x")).toBe(true);
    expect(isInvalidDecimal(" ")).toBe(false);
    expect(decimalInput(1.5)).toBe("1,5");
    expect(decimalInput(null)).toBe("");
  });
  it("formatBytes", () => {
    expect(formatBytes(0)).toBe("");
    expect(formatBytes(2048)).toBe("2 kB");
    expect(formatBytes(1.5 * 1024 * 1024)).toBe("1,5 MB");
  });
});

describe("časová osa", () => {
  it("běžný tok: hotové kroky, aktuální krok, zbytek čeká", () => {
    const t = buildTimeline(tl({ stage: "potvrzeno", inquiryDate: "2026-09-01", orderDate: "2026-09-10", confirmedAt: "2026-09-11T08:00:00Z" }));
    expect(t.side).toBeNull();
    const states = Object.fromEntries(t.steps.map((s) => [s.stage, s.state]));
    expect(states.poptavka).toBe("done");
    expect(states.objednavka).toBe("done");
    expect(states.potvrzeno).toBe("current");
    expect(states.ve_vyrobe).toBe("todo");
    expect(t.steps.find((s) => s.stage === "potvrzeno")?.date).toBe("2026-09-11T08:00:00Z");
    expect(t.doneCount).toBe(5);
    expect(t.steps.some((s) => s.optional)).toBe(false);
  });
  it("volitelný krok sklad se vloží za Dodáno k nám", () => {
    const t = buildTimeline(tl({ stage: "na_sklade", stageChangedAt: "2026-10-01T10:00:00Z" }));
    const i = t.steps.findIndex((s) => s.stage === "na_sklade");
    expect(t.steps[i - 1].stage).toBe("dodano_k_nam");
    expect(t.steps[i].optional).toBe(true);
    expect(t.steps[i].state).toBe("current");
    expect(t.steps[i].date).toBe("2026-10-01T10:00:00Z");
    expect(t.steps[i + 1].state).toBe("todo");
  });
  it("speciální stav: stuha + hotovo podle známých dat", () => {
    const t = buildTimeline(tl({ stage: "pozastaveno", inquiryDate: "2026-09-01", productionStartedAt: "2026-09-20T08:00:00Z" }));
    expect(t.side).toBe("pozastaveno");
    expect(t.steps.find((s) => s.stage === "ve_vyrobe")?.state).toBe("done");
    expect(t.steps.find((s) => s.stage === "dodano_k_nam")?.state).toBe("todo");
    expect(t.steps.some((s) => s.state === "current")).toBe(false);
  });
  it("datum nacenění a nabídky z nabídek", () => {
    const j = tl({ quotes: [{ createdAt: "2026-09-05T10:00:00Z", sentAt: null }, { createdAt: "2026-09-03T10:00:00Z", sentAt: "2026-09-06T10:00:00Z" }] });
    expect(stepDate("naceneni", j)).toBe("2026-09-03T10:00:00Z");
    expect(stepDate("nabidka", j)).toBe("2026-09-06T10:00:00Z");
    expect(stepDate("dokonceno", j)).toBeNull();
  });
  it("budoucí kroky nemají datum", () => {
    const t = buildTimeline(tl({ stage: "poptavka", orderDate: "2026-09-10" }));
    expect(t.steps.find((s) => s.stage === "objednavka")?.date).toBeNull();
  });
});

describe("termíny", () => {
  const base = {
    stage: "ve_vyrobe" as const, customerRequiredDate: null, dueDate: null, expectedDeliveryDate: null,
    supplierPromisedDate: null, maxToleratedDate: null,
  };
  it("dodavatel slíbil později než my zákazníkovi", () => {
    const w = deadlineWarnings({ ...base, dueDate: "2026-11-01", supplierPromisedDate: "2026-11-04" }, TODAY);
    expect(w).toHaveLength(1);
    expect(w[0].tone).toBe("warn");
    expect(w[0].text).toContain("o 3 dny později");
  });
  it("po maximálním tolerovaném termínu", () => {
    const w = deadlineWarnings({ ...base, dueDate: "2026-10-10", maxToleratedDate: "2026-10-20" }, TODAY);
    expect(w[0].tone).toBe("danger");
    expect(w[0].text).toContain("o 2 dny");
  });
  it("dodavatel až po max. tolerovaném = danger místo warn", () => {
    const w = deadlineWarnings({ ...base, dueDate: "2026-11-01", maxToleratedDate: "2026-11-05", supplierPromisedDate: "2026-11-10" }, TODAY);
    expect(w.map((x) => x.tone)).toEqual(["danger"]);
  });
  it("předpokládané po termínu a pozdější potvrzení", () => {
    const w = deadlineWarnings({ ...base, customerRequiredDate: "2026-10-30", dueDate: "2026-11-02", expectedDeliveryDate: "2026-11-05" }, TODAY);
    expect(w.map((x) => x.tone)).toEqual(["warn", "info"]);
  });
  it("díly už u nás = slib dodavatele se nehlídá", () => {
    expect(deadlineWarnings({ ...base, stage: "dodano_k_nam", dueDate: "2026-11-01", supplierPromisedDate: "2026-11-04" }, TODAY)).toEqual([]);
    expect(deadlineWarnings({ ...base, stage: "reklamace", receivedAt: "2026-10-20T08:00:00Z", dueDate: "2026-11-01", supplierPromisedDate: "2026-11-04" }, TODAY)).toEqual([]);
    expect(deadlineWarnings({ ...base, stage: "reklamace", dueDate: "2026-11-01", supplierPromisedDate: "2026-11-04" }, TODAY)).toHaveLength(1);
  });
  it("dodaná zakázka nevaruje", () => {
    expect(deadlineWarnings({ ...base, stage: "dodano_zakaznikovi", dueDate: "2026-10-01", maxToleratedDate: "2026-10-02" }, TODAY)).toEqual([]);
  });
  it("dateTone", () => {
    expect(dateTone(null, "ve_vyrobe", TODAY)).toBe("none");
    expect(dateTone("2026-12-01", "ve_vyrobe", TODAY)).toBe("ok");
    expect(dateTone("2026-10-25", "ve_vyrobe", TODAY)).toBe("soon");
    expect(dateTone("2026-10-22", "ve_vyrobe", TODAY)).toBe("today");
    expect(dateTone("2026-10-01", "ve_vyrobe", TODAY)).toBe("past");
    expect(dateTone("2026-10-01", "fakturovano", TODAY)).toBe("done");
  });
});

describe("nabídky", () => {
  const q = (over: Record<string, unknown> = {}) => ({
    id: "q1", status: "ke_schvaleni" as const, approvedBy: null, archived: false, accepted: false,
    createdAt: "2026-10-01T10:00:00Z", revision: 1, ...over,
  });
  it("akce podle stavu", () => {
    expect(quoteActions(q(), { canDelete: false })).toEqual(["approve", "send", "markSent", "edit", "accept", "reject", "revision", "pdf", "archive"]);
    const approved = quoteActions(q({ approvedBy: { id: "u", name: "A" } }), { canDelete: true });
    expect(approved).not.toContain("approve");
    expect(approved).toContain("delete");
    const sent = quoteActions(q({ status: "odeslano" }), { canDelete: false });
    expect(sent).toContain("send");
    expect(sent).toContain("accept");
    expect(sent).not.toContain("edit");
    const accepted = quoteActions(q({ status: "prijato", accepted: true }), { canDelete: false });
    expect(accepted).toEqual(["revision", "pdf", "archive"]);
    expect(quoteActions(q({ archived: true }), { canDelete: false })).toEqual(["pdf", "unarchive"]);
  });
  it("splitQuotes a primaryQuote", () => {
    const list = [
      q({ id: "a", archived: true, createdAt: "2026-09-01T00:00:00Z" }),
      q({ id: "b", createdAt: "2026-10-02T00:00:00Z", status: "zamitnuto" }),
      q({ id: "c", createdAt: "2026-10-01T00:00:00Z" }),
    ];
    const s = splitQuotes(list);
    expect(s.current.map((x) => x.id)).toEqual(["b", "c"]);
    expect(s.archived.map((x) => x.id)).toEqual(["a"]);
    expect(primaryQuote(list, null)?.id).toBe("c");
    expect(primaryQuote(list, "a")?.id).toBe("a");
    expect(primaryQuote([], null)).toBeNull();
  });
  it("neznámý stav nabídky má výchozí styl", () => {
    expect(quoteStatusMeta("xyz").label).toBe("Ke schválení");
  });
});

describe("historie", () => {
  it("událost stavu má barvu cílového stavu", () => {
    const e = { type: "stage" as const, data: { from: "poptavka", to: "ve_vyrobe" } };
    expect(eventStage(e)).toEqual({ from: "poptavka", to: "ve_vyrobe" });
    expect(eventTone(e)).toBe(STAGES.ve_vyrobe.badge);
    expect(eventTone({ type: "ai", data: {} })).toContain("fuchsia");
    expect(eventStage({ type: "stage", data: { to: "nic" } })).toBeNull();
  });
  it("eventChanges: texty serveru, fallback a citlivé hodnoty", () => {
    const ch = eventChanges({
      changes: [
        { field: "due_date", label: "Potvrzený termín zákazníkovi", from: null, to: "2026-11-01", fromText: "—", toText: "1. 11. 2026" },
        { field: "priority", label: "Priorita", from: "nizka", to: "vysoka" },
        { field: "purchase_cost", label: "Nákupní náklady", sensitive: true },
        null,
      ],
    });
    expect(ch).toHaveLength(3);
    expect(ch[0]).toMatchObject({ from: "—", to: "1. 11. 2026" });
    expect(ch[1]).toMatchObject({ from: "Nízká", to: "Vysoká" });
    expect(ch[2]).toMatchObject({ sensitive: true, from: "", to: "" });
    expect(eventChanges({})).toEqual([]);
  });
});

describe("dokumenty", () => {
  const f = (over: Record<string, unknown>) => ({
    id: "f", kind: "ostatni", archived: false, createdAt: "2026-10-01T00:00:00Z", version: 1, replacedBy: null, ...over,
  }) as { id: string; kind: never; archived: boolean; createdAt: string; version: number; replacedBy: string | null };
  it("groupFiles podle pořadí druhů, archiv zvlášť", () => {
    const g = groupFiles([
      f({ id: "1", kind: "foto" }),
      f({ id: "2", kind: "poptavka" }),
      f({ id: "3", kind: "poptavka", archived: true, replacedBy: "2" }),
      f({ id: "4", kind: "nesmysl" }),
    ]);
    expect(g.map((x) => x.kind)).toEqual(["poptavka", "foto", "ostatni"]);
    expect(g[0].current.map((x) => x.id)).toEqual(["2"]);
    expect(g[0].archived.map((x) => x.id)).toEqual(["3"]);
  });
  it("replacedByLabel", () => {
    expect(replacedByLabel({ replacedBy: "2" }, [{ id: "2", version: 3 }])).toBe("nahrazeno v3");
    expect(replacedByLabel({ replacedBy: "x" }, [])).toBe("nahrazeno novější verzí");
    expect(replacedByLabel({ replacedBy: null }, [])).toBeNull();
  });
  it("isImageFile", () => {
    expect(isImageFile({ mimeType: "image/jpeg", filename: "a.jpg" })).toBe(true);
    expect(isImageFile({ mimeType: "image/heic", filename: "a.heic" })).toBe(false);
    expect(isImageFile({ mimeType: null, filename: "scan.PNG" })).toBe(true);
    expect(isImageFile({ mimeType: "application/pdf", filename: "a.pdf" })).toBe(false);
  });
});

describe("koncepty položek", () => {
  const d = (over: Partial<ItemDraft> = {}): ItemDraft => ({ ...emptyItemDraft(), ...over });
  it("prázdný řádek se ignoruje", () => {
    expect(isBlankDraft(emptyItemDraft())).toBe(true);
    expect(validateDrafts([emptyItemDraft()])).toBeNull();
  });
  it("validace množství a cen", () => {
    expect(validateDrafts([d({ name: "A", quantity: "0" })])).toContain("množství");
    expect(validateDrafts([d({ name: "A", unitPrice: "abc" })])).toContain("cena");
    expect(validateDrafts([d({ name: "A", unitPrice: "-5" })])).toContain("cena");
    expect(validateDrafts([d({ name: "A", purchaseUnitPrice: "x" })])).toContain("nákupní");
    expect(validateDrafts([d({ name: "A", quantity: "2,5", unitPrice: "100" })])).toBeNull();
  });
  it("draftToItemInput: nákupní cena jen s maržemi", () => {
    const x = d({ id: "i1", name: " Hřídel ", quantity: "2,5", unitPrice: "1 200", purchaseUnitPrice: "800" });
    expect(draftToItemInput(x, true)).toMatchObject({ id: "i1", name: "Hřídel", quantity: 2.5, unitPrice: 1200, purchaseUnitPrice: 800 });
    expect("purchaseUnitPrice" in draftToItemInput(x, false)).toBe(false);
  });
  it("součty, DPH, marže, nenacenené řádky", () => {
    const t = draftTotals([
      d({ name: "A", quantity: "2", unitPrice: "100", purchaseUnitPrice: "60" }),
      d({ name: "B", quantity: "1", unitPrice: "", vatRate: "21" }),
      d({ name: "C", quantity: "1", unitPrice: "50", vatRate: "0" }),
    ]);
    expect(t.net).toBe(250);
    expect(t.vat).toBe(42);
    expect(t.gross).toBe(292);
    expect(t.purchase).toBe(120);
    expect(t.margin).toBe(0.52);
    expect(t.unpriced).toBe(1);
    expect(t.quantity).toBe(4);
    expect(draftTotals([]).net).toBeNull();
    expect(lineTotal({ quantity: "3", unitPrice: "1,5" })).toBe(4.5);
    expect(lineTotal({ quantity: "3", unitPrice: "" })).toBeNull();
  });
  it("podpis pro neuložené změny ignoruje formát čísel", () => {
    const a = [d({ key: "x", name: "A", quantity: "1,0", unitPrice: "100" })];
    const b = [d({ key: "y", name: "A ", quantity: "1", unitPrice: "100,00" })];
    expect(draftsSignature(a)).toBe(draftsSignature(b));
    expect(draftsSignature(a)).not.toBe(draftsSignature([d({ name: "B" })]));
  });
  it("itemToDraft", () => {
    const x = itemToDraft({
      id: "i1", drawingNumber: "VK-1", revision: "B", name: "Upínka", description: null, material: "S355",
      quantity: 2.5, unit: "ks", unitPrice: 120, purchaseUnitPrice: null, note: null,
    });
    expect(x).toMatchObject({ key: "i1", id: "i1", quantity: "2,5", unitPrice: "120", purchaseUnitPrice: "", revision: "B", vatRate: "21" });
  });
  it("moveItem", () => {
    expect(moveItem([1, 2, 3], 0, 2)).toEqual([2, 3, 1]);
    expect(moveItem([1, 2, 3], 2, 0)).toEqual([3, 1, 2]);
    const same = [1, 2];
    expect(moveItem(same, 0, 5)).toBe(same);
  });
});

describe("formulář nabídky", () => {
  const job = {
    title: "Upínky", deliveryMethod: "Vlastní doprava", customerRequiredDate: "2026-11-21", dueDate: null,
    customerDetail: { paymentTermsDays: 14 },
    items: [{ id: "i1", position: 0, drawingNumber: "VK-1", revision: "A", name: "Upínka", description: null, material: "S355", quantity: 10, unit: "ks", unitPrice: 50, purchaseUnitPrice: 30, note: null }],
  };
  it("výchozí hodnoty z položek zakázky", () => {
    const f = quoteFormFromJob(job, TODAY);
    expect(f.validUntil).toBe("2026-11-21");
    expect(f.leadTimeDays).toBe("30");
    expect(f.paymentTerms).toContain("14 dní");
    expect(f.deliveryTerms).toBe("Vlastní doprava");
    expect(f.items).toHaveLength(1);
    expect(f.items[0].id).toBeUndefined();
    expect(f.items[0].unitPrice).toBe("50");
  });
  it("bez položek = jeden prázdný řádek a validace", () => {
    const f = quoteFormFromJob({ ...job, items: [], customerRequiredDate: null, customerDetail: null }, TODAY);
    expect(f.items).toHaveLength(1);
    expect(f.leadTimeDays).toBe("");
    expect(validateQuoteForm(f)).toBe("Přidej alespoň jednu položku.");
  });
  it("převod na vstup akce", () => {
    const f = quoteFormFromJob(job, TODAY);
    f.leadTimeDays = "14,4";
    expect(validateQuoteForm(f)).toBeNull();
    const input = quoteFormToInput(f, false);
    expect(input.leadTimeDays).toBe(14);
    expect(input.items[0]).toMatchObject({ drawingNumber: "VK-1", quantity: 10, unitPrice: 50, vatRate: 21 });
    expect("purchaseUnitPrice" in input.items[0]).toBe(false);
    f.leadTimeDays = "dlouho";
    expect(validateQuoteForm(f)).toContain("lhůta");
  });
});

describe("drobnosti", () => {
  it("parseTags bez duplicit", () => {
    expect(parseTags("a, B;#c", ["b"])).toEqual(["b", "a", "c"]);
    expect(parseTags("  ")).toEqual([]);
  });
  it("tagTone je stabilní", () => {
    expect(tagTone("Škoda")).toBe(tagTone("škoda"));
  });
  it("filterOptions bez diakritiky, prefix první", () => {
    const opts = [{ label: "Strojírny Brno" }, { label: "Brněnské strojírny" }, { label: "Kovo", sub: "12345678" }];
    expect(filterOptions(opts, "brn").map((o) => o.label)).toEqual(["Brněnské strojírny", "Strojírny Brno"]);
    expect(filterOptions(opts, "1234").map((o) => o.label)).toEqual(["Kovo"]);
    expect(filterOptions(opts, "", 2)).toHaveLength(2);
  });
  it("isDetailTab", () => {
    expect(isDetailTab("nabidky")).toBe(true);
    expect(isDetailTab("x")).toBe(false);
  });
});
