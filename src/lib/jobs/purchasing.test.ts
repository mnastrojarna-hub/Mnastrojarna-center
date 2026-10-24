import { describe, it, expect } from "vitest";
import {
  PURCHASE_ORDER_STATUSES, PURCHASE_ORDER_STATUS_META, isPurchaseOrderStatus, purchaseOrderTransitions,
  canChangePurchaseOrderStatus, isPurchaseOrderEditable, canFillPurchasePrices, applyPurchasePrices, cleanPurchaseItems, purchaseItemsTotal, unpricedItemCount,
  resolveSupplierQuoteTotal, rowsTotal, easterSunday, czechHolidays, isWorkingDay, addWorkingDays, addCalendarDays,
  resolveQuoteDeliveryDate, pickRequiredDate, defaultDeliveryAddress, ourDeliveryAddressOf, deliveryTermsFor, purchaseOrderNote, purchaseOrderFileName,
  buildPurchaseOrderDraft, itemsFromJob, validatePurchaseOrderDraft, supplierQuoteInputToRow, purchasingTotals,
  issueStageHint, parseEmailList, purchaseOrderEmail, purchaseOrderChangeEmail, purchaseOrderCancelEmail, purchaseOrderHoldEmail, splitAddress, rowToSupplierQuoteView, rowToPurchaseOrderView,
  rowToPurchaseOrderListItem, rowToCommissionView, filterPurchaseOrders, draftToPurchaseOrderView,
  DEFAULT_DELIVERY_TERMS, DEFAULT_PAYMENT_TERMS, REQUIRED_DATE_SOURCE_LABELS,
  type DraftJob, type PurchaseOrderDbRow, type SupplierQuoteDbRow,
} from "./purchasing";
import type { PurchaseSupplierRef, SupplierQuoteView } from "./purchasing-types";

const SUPPLIER: PurchaseSupplierRef = {
  id: "d4000000-0000-0000-0000-000000000001",
  name: "Kovoobrábění Hrubý s.r.o.",
  email: "objednavky@hruby-cnc.cz",
  phone: null,
  ico: "25874411",
  dic: null,
  address: "Průmyslová 1458, 538 21 Slatiňany",
  contactPerson: "Tomáš Hrubý",
  country: "CZ",
};

const QUOTE_ID = "a1000000-0000-0000-0000-000000000001";
const JOB_ID = "d0000000-0000-0000-0000-000000000005";

function job(over: Partial<DraftJob> = {}): DraftJob {
  return {
    number: "Z-2026-105",
    title: "Upínací desky VK-2291",
    currency: "CZK",
    items: [
      {
        drawingNumber: "VK-2291", revision: "C", name: "Upínací deska", description: "Frézovaný díl, kaleno",
        material: "1.2379", quantity: 50, unit: "ks", purchaseUnitPrice: 760,
      },
      {
        drawingNumber: "VK-2292", revision: "A", name: null, description: "Vodicí lišta 420 mm",
        material: null, quantity: 24, unit: "ks", purchaseUnitPrice: null,
      },
    ],
    drawingNumbers: ["VK-2291", "VK-2292"],
    totalQuantity: 74,
    purchaseCost: 50_000,
    supplierPromisedDate: null,
    expectedDeliveryDate: null,
    dueDate: "2026-11-30",
    ...over,
  };
}

function quote(over: Partial<SupplierQuoteView> = {}): SupplierQuoteView {
  return {
    id: QUOTE_ID,
    jobId: JOB_ID,
    supplier: SUPPLIER,
    supplierName: SUPPLIER.name,
    number: "NAB-26-0412",
    quoteDate: "2026-10-19",
    validUntil: "2026-11-19",
    leadTimeDays: 21,
    deliveryDate: "2026-11-09",
    currency: "CZK",
    total: 51_080,
    selected: true,
    note: null,
    fileId: null,
    source: "manual",
    createdBy: null,
    createdAt: "2026-10-19T08:00:00Z",
    updatedAt: "2026-10-19T08:00:00Z",
    items: [
      { id: "i1", position: 0, drawingNumber: "VK-2291", name: null, material: null, quantity: 50, unit: "ks", unitPrice: 760, note: null },
      { id: "i2", position: 1, drawingNumber: "VK-2292", name: "Vodicí lišta", material: "C45", quantity: 24, unit: "ks", unitPrice: 545, note: "broušeno" },
    ],
    ...over,
  };
}

describe("stavy objednávky vydané", () => {
  it("všechny stavy mají popisek a odznak", () => {
    for (const s of PURCHASE_ORDER_STATUSES) {
      expect(isPurchaseOrderStatus(s)).toBe(true);
      expect(PURCHASE_ORDER_STATUS_META[s].label).toBeTruthy();
      expect(PURCHASE_ORDER_STATUS_META[s].badge).toMatch(/bg-/);
    }
    expect(isPurchaseOrderStatus("hotovo")).toBe(false);
    expect(isPurchaseOrderStatus(null)).toBe(false);
  });

  it("přechody stavů", () => {
    expect(purchaseOrderTransitions("vystavena")).toEqual(["odeslana", "potvrzena", "dodana", "zrusena"]);
    expect(canChangePurchaseOrderStatus("odeslana", "potvrzena")).toBe(true);
    expect(canChangePurchaseOrderStatus("potvrzena", "odeslana")).toBe(false);
    expect(canChangePurchaseOrderStatus("dodana", "zrusena")).toBe(false);
    expect(canChangePurchaseOrderStatus("zrusena", "vystavena")).toBe(true);
    expect(canChangePurchaseOrderStatus("dodana", "dodana")).toBe(true);
  });

  it("položky lze měnit jen před odesláním", () => {
    expect(isPurchaseOrderEditable("navrh")).toBe(true);
    expect(isPurchaseOrderEditable("vystavena")).toBe(true);
    expect(isPurchaseOrderEditable("odeslana")).toBe(false);
    expect(isPurchaseOrderEditable("potvrzena")).toBe(false);
  });
});

describe("položky a součty", () => {
  it("cenu položky jde doplnit i po odeslání (jen ne u zrušené); mění se jen ceny a součet", () => {
    expect((["navrh", "vystavena", "odeslana", "potvrzena", "dodana"] as const).every(canFillPurchasePrices)).toBe(true);
    expect(canFillPurchasePrices("zrusena")).toBe(false);
    const items = [{ id: "a", quantity: 10, unitPrice: 100 }, { id: "b", quantity: 4, unitPrice: null }];
    expect(applyPurchasePrices(items, [{ itemId: "b", unitPrice: "250,50" }])).toEqual({ changes: [{ id: "b", unitPrice: 250.5 }], total: 2002 });
    expect(applyPurchasePrices(items, [{ itemId: "a", unitPrice: null }])).toEqual({ changes: [{ id: "a", unitPrice: null }], total: 0 });
    expect(applyPurchasePrices(items, [{ itemId: "x", unitPrice: 1 }])).toEqual({ error: "Položka nepatří k objednávce." });
    expect(applyPurchasePrices(items, [{ itemId: "b", unitPrice: "abc" }])).toEqual({ error: "Neplatná cena položky." });
    expect(applyPurchasePrices(items, [{ itemId: "b", unitPrice: -5 }])).toEqual({ error: "Cena položky nesmí být záporná." });
  });

  it("vyčistí a očísluje položky, prázdné řádky vynechá", () => {
    const r = cleanPurchaseItems([
      { drawingNumber: " VK-1 ", quantity: "12,5" as unknown as number, unitPrice: "1 180,50" as unknown as number, unit: "" },
      { quantity: 1 },
      { name: "Kalení", quantity: 1, unitPrice: null },
    ]);
    if ("error" in r) throw new Error(r.error);
    expect(r.rows).toHaveLength(2);
    expect(r.rows[0]).toMatchObject({ position: 0, drawing_number: "VK-1", quantity: 12.5, unit: "ks", unit_price: 1180.5 });
    expect(r.rows[1]).toMatchObject({ position: 1, name: "Kalení", unit_price: null });
    expect(rowsTotal(r.rows)).toBe(14756.25);
  });

  it("chyby položek česky", () => {
    expect(cleanPurchaseItems([])).toEqual({ error: "Přidej alespoň jednu položku." });
    expect(cleanPurchaseItems(undefined)).toEqual({ error: "Přidej alespoň jednu položku." });
    expect(cleanPurchaseItems([], { allowEmpty: true })).toEqual({ rows: [] });
    expect(cleanPurchaseItems([{ name: "a", quantity: 0 }])).toEqual({ error: "Položka 1: neplatné množství." });
    expect(cleanPurchaseItems([{ name: "a", quantity: 1, unitPrice: -5 }])).toEqual({ error: "Položka 1: cena nesmí být záporná." });
    expect(cleanPurchaseItems([{ name: "a", quantity: 1 }, { material: "C45", quantity: 1 }])).toEqual({
      error: "Položka 2: vyplň číslo výkresu nebo název.",
    });
    expect(cleanPurchaseItems("x")).toEqual({ error: "Neplatné položky." });
    expect("error" in cleanPurchaseItems(Array.from({ length: 301 }, () => ({ name: "a", quantity: 1 })))).toBe(true);
  });

  it("součet na haléře, položky bez ceny = 0", () => {
    expect(purchaseItemsTotal([{ quantity: 3, unitPrice: 33.33 }, { quantity: 2, unitPrice: null }])).toBe(99.99);
    expect(purchaseItemsTotal([{ quantity: 0.333, unitPrice: 10 }])).toBe(3.33);
    expect(unpricedItemCount([{ unitPrice: null }, { unitPrice: 0 }, {}])).toBe(2);
  });

  it("celkem nabídky: zadané, jinak Σ položek, bez cen null", () => {
    const rows = [{ position: 0, drawing_number: "A", name: null, material: null, quantity: 2, unit: "ks", unit_price: 100, note: null }];
    expect(resolveSupplierQuoteTotal(5000, rows)).toBe(5000);
    expect(resolveSupplierQuoteTotal(undefined, rows)).toBe(200);
    expect(resolveSupplierQuoteTotal(null, [{ ...rows[0], unit_price: null }])).toBeNull();
    expect(resolveSupplierQuoteTotal(undefined, [])).toBeNull();
  });
});

describe("kalendář ČR", () => {
  it("Velikonoce", () => {
    expect(easterSunday(2024)).toBe("2024-03-31");
    expect(easterSunday(2025)).toBe("2025-04-20");
    expect(easterSunday(2026)).toBe("2026-04-05");
    expect(easterSunday(2027)).toBe("2027-03-28");
  });

  it("svátky a pracovní dny", () => {
    const h = czechHolidays(2026);
    expect(h.has("2026-04-03")).toBe(true); // Velký pátek
    expect(h.has("2026-04-06")).toBe(true); // Velikonoční pondělí
    expect(h.has("2026-10-28")).toBe(true);
    expect(isWorkingDay("2026-10-22")).toBe(true);
    expect(isWorkingDay("2026-10-24")).toBe(false); // sobota
    expect(isWorkingDay("2026-11-17")).toBe(false);
    expect(isWorkingDay("nesmysl")).toBe(false);
  });

  it("posun o pracovní dny přes víkend a svátky", () => {
    expect(addWorkingDays("2026-11-02", -3)).toBe("2026-10-27"); // přes 28. 10.
    expect(addWorkingDays("2026-12-23", 1)).toBe("2026-12-28"); // Vánoce
    expect(addWorkingDays("2026-12-31", 1)).toBe("2027-01-04"); // Nový rok + víkend
    expect(addWorkingDays("2026-11-18", -1)).toBe("2026-11-16");
    expect(addWorkingDays("2026-10-22", 0)).toBe("2026-10-22");
    expect(addCalendarDays("2026-10-19", 21)).toBe("2026-11-09");
  });

  it("termín dodání nabídky: zadaný, jinak datum nabídky + lhůta", () => {
    expect(resolveQuoteDeliveryDate({ deliveryDate: "2026-12-01", leadTimeDays: 10 })).toBe("2026-12-01");
    expect(resolveQuoteDeliveryDate({ leadTimeDays: 21, quoteDate: "2026-10-19" })).toBe("2026-11-09");
    expect(resolveQuoteDeliveryDate({ leadTimeDays: 14 }, "2026-10-22")).toBe("2026-11-05");
    expect(resolveQuoteDeliveryDate({ leadTimeDays: 0 })).toBeNull();
    expect(resolveQuoteDeliveryDate({})).toBeNull();
  });

  it("požadovaný termín: nabídka → slib → předpoklad → termín zákazníka − 3 prac. dny", () => {
    expect(pickRequiredDate({ quoteDeliveryDate: "2026-11-09", supplierPromisedDate: "2026-11-10", dueDate: "2026-11-30" }))
      .toEqual({ date: "2026-11-09", source: "nabidka_dodavatele" });
    expect(pickRequiredDate({ supplierPromisedDate: "2026-11-10", expectedDeliveryDate: "2026-11-12" }))
      .toEqual({ date: "2026-11-10", source: "slib_dodavatele" });
    expect(pickRequiredDate({ expectedDeliveryDate: "2026-11-12", dueDate: "2026-11-30" }))
      .toEqual({ date: "2026-11-12", source: "predpokladany_termin" });
    expect(pickRequiredDate({ dueDate: "2026-11-02" })).toEqual({ date: "2026-10-27", source: "termin_zakaznika" });
    expect(pickRequiredDate({})).toEqual({ date: null, source: null });
    expect(REQUIRED_DATE_SOURCE_LABELS.termin_zakaznika).toContain("3 pracovní dny");
  });
});

describe("výchozí texty", () => {
  it("dodací adresa z firemních údajů", () => {
    expect(defaultDeliveryAddress({ name: "Mnástrojárna s.r.o.", address: { street: "Mezná 9", zip: "393 01", city: "Mezná" } }))
      .toBe("Mnástrojárna s.r.o.\nMezná 9\n393 01 Mezná");
    expect(defaultDeliveryAddress({ name: "X", address: {} })).toBe("X");
  });

  it("naše dodací adresa: nastavení (čárky → řádky), jinak provozovna (korespondenční), jinak sídlo; DAP podle místa (review)", () => {
    const company = {
      name: "MNástrojárna s.r.o.", address: { street: "Varšavská 715/36", zip: "120 00", city: "Praha 2" },
      correspondence: { street: "Mezná 9", zip: "393 01", city: "Mezná" },
    };
    expect(ourDeliveryAddressOf(company)).toBe("MNástrojárna s.r.o.\nMezná 9\n393 01 Mezná");
    expect(ourDeliveryAddressOf(company, "  ")).toBe("MNástrojárna s.r.o.\nMezná 9\n393 01 Mezná");
    expect(ourDeliveryAddressOf(company, "MNástrojárna s.r.o., Dílna 2, 393 01 Mezná")).toBe("MNástrojárna s.r.o.\nDílna 2\n393 01 Mezná");
    expect(ourDeliveryAddressOf({ name: "X", address: { street: "A 1", zip: "100 00", city: "Praha" } })).toBe("X\nA 1\n100 00 Praha");
    expect(deliveryTermsFor("MNástrojárna s.r.o.\nMezná 9\n393 01 Mezná")).toBe("DAP Mezná");
    expect(deliveryTermsFor("TepKal s.r.o.\nKalicí 5, 602 00 Brno")).toBe("DAP Brno");
    expect(deliveryTermsFor("")).toBe(DEFAULT_DELIVERY_TERMS);
  });

  it("e-mail objednávky bez nabídky dodavatele: výkresy pošleme samostatně (review)", () => {
    const base = { number: "OV-2026-1", companyName: "MNástrojárna s.r.o.", requiredDate: "2026-11-20" };
    expect(purchaseOrderEmail({ ...base, drawingsSeparately: true }).body).toContain("Výkresovou dokumentaci k položkám Vám pošleme samostatně");
    expect(purchaseOrderEmail({ ...base, drawingsSeparately: true, supplierQuoteNumber: "N-1" }).body).not.toContain("Výkresovou dokumentaci");
    expect(purchaseOrderEmail(base).body).not.toContain("Výkresovou dokumentaci");
    expect(purchaseOrderNote("Z-1", ["A"], "Dle výkresů")).toBe("Objednávka k naší zakázce Z-1. Dle výkresů: A.");
  });

  it("poznámka: naše zakázka + výkresy, bez duplicit", () => {
    expect(purchaseOrderNote("Z-2026-105", ["VK-1", "VK-2", "VK-1", null, " "]))
      .toBe("Objednávka k naší zakázce Z-2026-105. Výroba dle výkresů: VK-1, VK-2.");
    expect(purchaseOrderNote(null, [])).toBe("");
    const many = purchaseOrderNote("Z-1", Array.from({ length: 15 }, (_, i) => `D-${i}`));
    expect(many).toMatch(/D-11 a další\.$/);
  });

  it("název PDF bez diakritiky", () => {
    expect(purchaseOrderFileName("OV-2026-004")).toBe("Objednavka_OV-2026-004.pdf");
    expect(purchaseOrderFileName("OV 2026/č.5")).toBe("Objednavka_OV-2026-c.5.pdf");
    expect(purchaseOrderFileName("")).toBe("Objednavka_bez-cisla.pdf");
  });
});

describe("návrh objednávky", () => {
  const ADDR = "Mnástrojárna s.r.o.\nVaršavská 715/36\n120 00 Praha 2";

  it("z vítězné nabídky dodavatele", () => {
    const d = buildPurchaseOrderDraft({ job: job(), quote: quote(), deliveryAddress: ADDR, today: "2026-10-22" });
    expect(d.supplierId).toBe(SUPPLIER.id);
    expect(d.supplier?.email).toBe(SUPPLIER.email);
    expect(d.supplierQuoteId).toBe(QUOTE_ID);
    expect(d.supplierQuoteNumber).toBe("NAB-26-0412");
    expect(d.itemsSource).toBe("nabidka_dodavatele");
    expect(d.items).toHaveLength(2);
    // název a materiál doplněné ze zakázky podle čísla výkresu
    expect(d.items[0]).toMatchObject({ drawingNumber: "VK-2291", name: "Upínací deska", material: "1.2379", quantity: 50, unitPrice: 760 });
    expect(d.items[1]).toMatchObject({ name: "Vodicí lišta", material: "C45", note: "broušeno", unitPrice: 545 });
    expect(d.total).toBe(50 * 760 + 24 * 545);
    expect(d.requiredDate).toBe("2026-11-09");
    expect(d.requiredDateSource).toBe("nabidka_dodavatele");
    expect(d.orderDate).toBe("2026-10-22");
    expect(d.paymentTerms).toBe(DEFAULT_PAYMENT_TERMS);
    expect(d.deliveryTerms).toBe(DEFAULT_DELIVERY_TERMS);
    expect(d.deliveryAddress).toBe(ADDR);
    expect(d.note).toBe("Objednávka k naší zakázce Z-2026-105. Výroba dle výkresů: VK-2291, VK-2292.");
    expect(d.warnings).toEqual([]);
  });

  it("ze zakázky: nákupní ceny, NIKDY prodejní cena ani interní poznámka", () => {
    const j = job();
    const withSale = { ...j, items: j.items.map((it) => ({ ...it, unitPrice: 9999, note: "zákazník chce slevu" })) };
    const d = buildPurchaseOrderDraft({ job: withSale, supplier: SUPPLIER, deliveryAddress: ADDR, today: "2026-10-22" });
    expect(d.itemsSource).toBe("zakazka");
    expect(d.items[0]).toMatchObject({ name: "Upínací deska", note: "Frézovaný díl, kaleno", unitPrice: 760 });
    expect(d.items[1]).toMatchObject({ name: "Vodicí lišta 420 mm", unitPrice: null });
    const json = JSON.stringify(d);
    expect(json).not.toContain("9999");
    expect(json).not.toContain("slevu");
    expect(d.supplierQuoteId).toBeNull();
    expect(d.warnings.some((w) => w.includes("1 položka nemá nákupní cenu"))).toBe(true);
    // termín zákazníkovi 30. 11. (po) − 3 pracovní dny = 25. 11. (st)
    expect(d.requiredDate).toBe("2026-11-25");
    expect(d.requiredDateSource).toBe("termin_zakaznika");
  });

  it("nabídka jen s celkovou cenou: 1 položka → cena za MJ, víc položek → upozornění", () => {
    const one = job({ items: [job().items[1]] });
    const d1 = buildPurchaseOrderDraft({ job: one, quote: quote({ items: [], total: 12_000 }), deliveryAddress: ADDR, today: "2026-10-22" });
    expect(d1.items[0].unitPrice).toBe(500);
    expect(d1.total).toBe(12_000);
    const unpriced = job({ items: job().items.map((it) => ({ ...it, purchaseUnitPrice: null })) });
    const d2 = buildPurchaseOrderDraft({ job: unpriced, quote: quote({ items: [], total: 12_000 }), deliveryAddress: ADDR, today: "2026-10-22" });
    expect(d2.items.every((i) => i.unitPrice === null)).toBe(true);
    expect(d2.warnings[0]).toContain("jen celkovou cenu");
  });

  it("zakázka bez položek → souhrnný řádek s odhadem nákupu", () => {
    const d = buildPurchaseOrderDraft({
      job: job({ items: [], drawingNumbers: ["VK-9"], totalQuantity: 4, purchaseCost: 1000 }),
      supplier: SUPPLIER, deliveryAddress: ADDR, today: "2026-10-22",
    });
    expect(d.itemsSource).toBe("souhrn");
    expect(d.items).toEqual([{ drawingNumber: "VK-9", name: "Upínací desky VK-2291", quantity: 4, unit: "ks", unitPrice: 250 }]);
    expect(d.total).toBe(1000);
  });

  it("upozornění: dodavatel mimo adresář / bez e-mailu, termín v minulosti, prošlá nabídka", () => {
    const freeName = quote({ supplier: null, supplierName: "Brusírna Novák", validUntil: "2026-10-01", deliveryDate: "2026-10-10" });
    const d = buildPurchaseOrderDraft({ job: job(), quote: freeName, deliveryAddress: ADDR, today: "2026-10-22" });
    expect(d.supplierId).toBeNull();
    expect(d.supplierName).toBe("Brusírna Novák");
    expect(d.warnings.join(" | ")).toMatch(/není v adresáři/);
    expect(d.warnings.join(" | ")).toMatch(/10\. 10\. 2026 je v minulosti/);
    expect(d.warnings.join(" | ")).toMatch(/platila jen do 1\. 10\. 2026/);

    const noMail = buildPurchaseOrderDraft({
      job: job({ dueDate: null }), supplier: { ...SUPPLIER, email: null }, deliveryAddress: ADDR, today: "2026-10-22",
    });
    expect(noMail.warnings.join(" | ")).toMatch(/nemá v adresáři e-mail/);
    expect(noMail.warnings.join(" | ")).toMatch(/Doplň požadovaný termín/);
    expect(noMail.requiredDate).toBe("");

    const none = buildPurchaseOrderDraft({ job: job(), deliveryAddress: ADDR, today: "2026-10-22" });
    expect(none.warnings[0]).toBe("Vyber dodavatele.");
  });

  it("položky ze zakázky bez názvu → popis / výkres", () => {
    const items = itemsFromJob({
      items: [
        { drawingNumber: "VK-7", revision: null, name: null, description: null, material: null, quantity: 1, unit: "", purchaseUnitPrice: 10 },
        { drawingNumber: null, revision: null, name: null, description: null, material: null, quantity: 2, unit: "kg", purchaseUnitPrice: null },
      ],
    });
    expect(items[0]).toMatchObject({ name: "Díl dle výkresu VK-7", unit: "ks" });
    expect(items[1]).toMatchObject({ name: "Položka", unit: "kg" });
  });
});

describe("validace objednávky k vystavení", () => {
  const base = {
    supplierId: SUPPLIER.id,
    items: [{ drawingNumber: "VK-1", quantity: 2, unitPrice: 100 }],
  };

  it("vyčistí návrh a spočítá celkem", () => {
    const r = validatePurchaseOrderDraft({ ...base, requiredDate: "2026-11-09", currency: "eur", note: "  " }, "2026-10-22");
    if ("error" in r) throw new Error(r.error);
    expect(r.value).toMatchObject({
      supplierId: SUPPLIER.id, supplierName: null, orderDate: "2026-10-22", requiredDate: "2026-11-09",
      currency: "EUR", note: null, total: 200,
    });
  });

  it("chyby", () => {
    expect(validatePurchaseOrderDraft({ items: base.items })).toEqual({ error: "Vyber dodavatele." });
    expect(validatePurchaseOrderDraft({ ...base, supplierId: "x" })).toEqual({ error: "Neplatný dodavatel." });
    expect(validatePurchaseOrderDraft({ ...base, supplierQuoteId: "x" })).toEqual({ error: "Neplatná nabídka dodavatele." });
    expect(validatePurchaseOrderDraft({ ...base, requiredDate: "2026-13-01" })).toEqual({ error: "Neplatný požadovaný termín dodání." });
    expect(validatePurchaseOrderDraft({ ...base, orderDate: "2026-11-10", requiredDate: "2026-11-01" }))
      .toEqual({ error: "Požadovaný termín dodání je před datem objednávky." });
    expect(validatePurchaseOrderDraft({ ...base, items: [] })).toEqual({ error: "Přidej alespoň jednu položku." });
    expect(validatePurchaseOrderDraft(null as never)).toEqual({ error: "Chybí údaje objednávky." });
  });

  it("dodavatel mimo adresář jen jménem", () => {
    const r = validatePurchaseOrderDraft({ supplierName: " Brusírna Novák ", items: base.items }, "2026-10-22");
    if ("error" in r) throw new Error(r.error);
    expect(r.value.supplierId).toBeNull();
    expect(r.value.supplierName).toBe("Brusírna Novák");
  });

  it("náhled návrhu jako objednávka", () => {
    const r = validatePurchaseOrderDraft({ ...base, supplierId: null, supplierName: "Novák" }, "2026-10-22");
    if ("error" in r) throw new Error(r.error);
    const po = draftToPurchaseOrderView(r.value, { jobId: JOB_ID, supplier: null, now: "2026-10-22T10:00:00Z" });
    expect(po).toMatchObject({ number: "NÁVRH", status: "navrh", total: 200, jobId: JOB_ID });
    expect(po.supplier?.name).toBe("Novák");
    expect(po.items[0]).toMatchObject({ drawingNumber: "VK-1", quantity: 2, unitPrice: 100 });
  });
});

describe("nabídka dodavatele → řádek DB", () => {
  it("nová nabídka: dodavatel povinný, termín z lhůty, zdroj", () => {
    expect(supplierQuoteInputToRow({ items: [] })).toEqual({ error: "Vyber dodavatele nebo vyplň jeho název." });
    const r = supplierQuoteInputToRow(
      { supplierName: "Brusírna Novák", number: " NB-1 ", quoteDate: "2026-10-19", leadTimeDays: 21, items: [] },
      { today: "2026-10-22" },
    );
    if ("error" in r) throw new Error(r.error);
    expect(r.row).toMatchObject({
      supplier_id: null, supplier_name: "Brusírna Novák", number: "NB-1", quote_date: "2026-10-19",
      lead_time_days: 21, delivery_date: "2026-11-09", currency: "CZK", source: "manual", file_id: null,
    });
    expect("total" in r.row).toBe(false);
  });

  it("úprava: jen zadané klíče", () => {
    const r = supplierQuoteInputToRow({ note: "x", source: "foto" }, { partial: true });
    if ("error" in r) throw new Error(r.error);
    expect(r.row).toEqual({ note: "x", source: "foto" });
  });

  it("chyby", () => {
    expect(supplierQuoteInputToRow({ supplierId: "x", items: [] })).toEqual({ error: "Neplatný dodavatel." });
    expect(supplierQuoteInputToRow({ supplierName: "a", leadTimeDays: -1, items: [] })).toEqual({ error: "Neplatná dodací lhůta." });
    expect(supplierQuoteInputToRow({ supplierName: "a", validUntil: "zítra", items: [] }))
      .toEqual({ error: "Neplatné datum v nabídce dodavatele." });
    expect(supplierQuoteInputToRow({ supplierName: "a", total: -1, items: [] })).toEqual({ error: "Neplatná celková cena nabídky." });
    expect(supplierQuoteInputToRow({ supplierName: "a", source: "fax" as never, items: [] })).toEqual({ error: "Neznámý zdroj nabídky." });
  });
});

describe("marže a doporučení stavu", () => {
  it("bez objednávek vydaných → odhad nákupu", () => {
    expect(purchasingTotals({ revenue: 58_200, plannedCost: 37_400, purchaseOrders: [] })).toEqual({
      revenue: 58_200, purchaseOrdersTotal: 0, plannedCost: 37_400, cost: 37_400, costSource: "odhad",
      profit: 20_800, margin: 0.3574,
    });
  });

  it("objednávky vydané mají přednost, zrušené se nepočítají", () => {
    const t = purchasingTotals({
      revenue: 58_200, plannedCost: 37_400,
      purchaseOrders: [{ status: "vystavena", total: 30_000.1 }, { status: "dodana", total: 10_000 }, { status: "zrusena", total: 99_999 }],
    });
    expect(t).toMatchObject({ purchaseOrdersTotal: 40_000.1, cost: 40_000.1, costSource: "objednavky", profit: 18_199.9 });
    expect(t.margin).toBe(0.3127);
  });

  it("objednávka s položkou bez ceny = náklad neznámý (jako DB job_cost) — žádný zisk ani marže", () => {
    const t = purchasingTotals({
      revenue: 58_200, plannedCost: 37_400,
      purchaseOrders: [
        { status: "vystavena", total: 2_100, number: "OV-2026-013", items: [{ unitPrice: 8.75 }] },
        { status: "odeslana", total: 8_000, number: "OV-2026-012", items: [{ unitPrice: 40 }, { unitPrice: null }] },
        { status: "zrusena", total: 0, number: "OV-2026-011", items: [{ unitPrice: null }] },
      ],
    });
    expect(t).toEqual({
      revenue: 58_200, purchaseOrdersTotal: 10_100, plannedCost: 37_400, cost: null, costSource: "neuplna", profit: null, margin: null,
      incompleteCost: 10_100, unpricedItems: 1, unpricedPurchaseOrders: ["OV-2026-012"],
    });
    // po doplnění ceny je náklad zase známý
    expect(purchasingTotals({ revenue: 58_200, plannedCost: null, purchaseOrders: [{ status: "odeslana", total: 12_000, items: [{ unitPrice: 40 }, { unitPrice: 42 }] }] }))
      .toMatchObject({ cost: 12_000, costSource: "objednavky", profit: 46_200 });
    // jen příznak (přehled bez položek)
    expect(purchasingTotals({ revenue: 1, plannedCost: null, purchaseOrders: [{ status: "vystavena", total: 0, hasUnpriced: true }] }).costSource).toBe("neuplna");
  });

  it("bez obratu / nákladu", () => {
    expect(purchasingTotals({ revenue: null, plannedCost: null, purchaseOrders: [] }))
      .toMatchObject({ cost: null, costSource: null, profit: null, margin: null });
    expect(purchasingTotals({ revenue: 0, plannedCost: 100, purchaseOrders: [] })).toMatchObject({ profit: -100, margin: null });
  });

  it("stav zakázky se nemění — jen doporučení", () => {
    expect(issueStageHint("potvrzeno")).toMatchObject({ suggestStage: "ve_vyrobe" });
    expect(issueStageHint("objednavka")).toMatchObject({ suggestStage: "potvrzeno" });
    expect(issueStageHint("nabidka")?.message).toContain("zákazník ještě neobjednal");
    expect(issueStageHint("nabidka")?.suggestStage).toBeNull();
    expect(issueStageHint("ve_vyrobe")).toBeNull();
    expect(issueStageHint("pozastaveno")).toBeNull();
  });
});

describe("e-mail dodavateli", () => {
  it("adresy", () => {
    expect(parseEmailList("a@x.cz; B@y.cz, a@x.cz <c@z.cz>")).toEqual(["a@x.cz", "B@y.cz", "c@z.cz"]);
    expect(parseEmailList("")).toEqual([]);
    expect(parseEmailList(undefined)).toEqual([]);
    expect(parseEmailList("neplatna-adresa")).toBeNull();
    expect(parseEmailList(5)).toBeNull();
  });

  it("předmět, text a podpis — bez cen", () => {
    const m = purchaseOrderEmail({
      number: "OV-2026-004",
      companyName: "Mnástrojárna s.r.o.",
      supplierQuoteNumber: "NAB-26-0412",
      requiredDate: "2026-11-09",
      senderName: "Petr Obchodník",
      senderEmail: "petr@mnastrojarna.cz",
      senderPhone: "777 123 456",
      companyWeb: "www.mnastrojarna.cz",
    });
    expect(m.subject).toBe("Objednávka OV-2026-004 — Mnástrojárna s.r.o.");
    expect(m.body).toMatch(/^Dobrý den,\n/);
    expect(m.body).toContain("objednávku č. OV-2026-004 na základě Vaší nabídky č. NAB-26-0412.");
    expect(m.body).toContain("Požadovaný termín dodání: 9. 11. 2026 (pondělí).");
    expect(m.body).toContain("potvrzení objednávky a termínu dodání do 2 pracovních dnů");
    expect(m.body).toMatch(/S pozdravem\n\nPetr Obchodník\nMnástrojárna s\.r\.o\.\ntel\. 777 123 456 · petr@mnastrojarna\.cz\nwww\.mnastrojarna\.cz$/);
    expect(m.body).not.toMatch(/Kč|CZK/);
  });

  it("bez nabídky a termínu", () => {
    const m = purchaseOrderEmail({ number: "OV-1", companyName: "Firma", confirmWithinDays: 1 });
    expect(m.body).toContain("naši objednávku č. OV-1.");
    expect(m.body).not.toContain("Požadovaný termín");
    expect(m.body).toContain("do 1 pracovního dne");
    expect(m.body.endsWith("Firma")).toBe(true);
  });
});

describe("adresa dodavatele", () => {
  it("rozdělí jedno pole na ulici, PSČ a město", () => {
    expect(splitAddress("Průmyslová 1458, 538 21 Slatiňany")).toEqual({ street: "Průmyslová 1458", zip: "538 21", city: "Slatiňany", extra: [] });
    expect(splitAddress("Hlavní 5\n53821 Slatiňany\nCZ")).toEqual({ street: "Hlavní 5", zip: "538 21", city: "Slatiňany", extra: ["CZ"] });
    expect(splitAddress("Hlavní 5, Brno")).toEqual({ street: "Hlavní 5", zip: undefined, city: "Brno", extra: [] });
    expect(splitAddress(null)).toEqual({ extra: [] });
  });
});

describe("řádky DB → view", () => {
  const quoteRow: SupplierQuoteDbRow = {
    id: QUOTE_ID, job_id: JOB_ID, supplier_id: null, supplier_name: "Brusírna Novák", number: "NB-1",
    quote_date: "2026-10-19", valid_until: null, lead_time_days: 10, delivery_date: "2026-10-29", currency: "CZK",
    total: "12000.50", selected: true, note: null, file_id: null, source: "neznamy", created_by: null,
    created_at: "2026-10-19T08:00:00Z", updated_at: null, supplier: null,
    creator: [{ id: "u1", full_name: "Petr Obchodník", email: null }],
    items: [
      { id: "b", position: 1, drawing_number: "B", quantity: "2.000", unit: "ks", unit_price: null },
      { id: "a", position: 0, drawing_number: "A", quantity: "1.5", unit: null, unit_price: "100.00" },
    ],
  };

  it("nabídka dodavatele", () => {
    const v = rowToSupplierQuoteView(quoteRow);
    expect(v).toMatchObject({
      supplier: null, supplierName: "Brusírna Novák", total: 12000.5, selected: true, source: "manual",
      createdBy: { id: "u1", name: "Petr Obchodník" }, updatedAt: "2026-10-19T08:00:00Z",
    });
    expect(v.items.map((i) => i.drawingNumber)).toEqual(["A", "B"]);
    expect(v.items[0]).toMatchObject({ quantity: 1.5, unit: "ks", unitPrice: 100 });
    expect(v.items[1].unitPrice).toBeNull();
  });

  const poRow: PurchaseOrderDbRow = {
    id: "p1", job_id: JOB_ID, supplier_id: SUPPLIER.id, supplier_quote_id: QUOTE_ID, number: "OV-2026-004",
    status: "odeslana", order_date: "2026-10-22", required_date: "2026-11-09", confirmed_date: null, currency: "CZK",
    total: "51080.00", delivery_terms: "DAP", payment_terms: null, delivery_address: null, note: null,
    supplier_reference: null, file_id: "f1", created_by: "u1", sent_at: "2026-10-22T10:00:00Z",
    created_at: "2026-10-22T09:00:00Z", updated_at: "2026-10-22T10:00:00Z",
    supplier: { id: SUPPLIER.id, name: SUPPLIER.name, email: SUPPLIER.email, contact_person: "Tomáš Hrubý" },
    quote: { id: QUOTE_ID, number: "NAB-26-0412", quote_date: "2026-10-19" },
    items: [{ id: "x", position: 0, drawing_number: "VK-2291", quantity: 50, unit: "ks", unit_price: 760 }],
    job: { id: JOB_ID, number: "Z-2026-105", title: "Upínací desky", status: "potvrzeno", customer: [{ id: "c1", name: "Strojmetal" }] },
  };

  it("objednávka vydaná + řádek přehledu", () => {
    const v = rowToPurchaseOrderView(poRow);
    expect(v).toMatchObject({
      number: "OV-2026-004", status: "odeslana", total: 51080, fileId: "f1",
      supplier: { id: SUPPLIER.id, contactPerson: "Tomáš Hrubý", phone: null },
      supplierQuote: { id: QUOTE_ID, number: "NAB-26-0412", quoteDate: "2026-10-19" },
    });
    expect(rowToPurchaseOrderView({ ...poRow, status: "nesmysl", number: null }).status).toBe("navrh");

    const li = rowToPurchaseOrderListItem(poRow);
    expect(li).toMatchObject({
      job: { id: JOB_ID, number: "Z-2026-105", stage: "potvrzeno" }, customer: { id: "c1", name: "Strojmetal" },
      itemCount: 1, drawingNumbers: ["VK-2291"],
    });
    expect(li.items).toHaveLength(1);
    expect(li.receipt).toEqual({ done: 0, total: 1, partial: false });
    expect(filterPurchaseOrders([li], "hruby vk-2291")).toHaveLength(1);
    expect(filterPurchaseOrders([li], "strojmetal ov-2026-004")).toHaveLength(1);
    expect(filterPurchaseOrders([li], "tepkal")).toHaveLength(0);
    expect(filterPurchaseOrders([li], "")).toHaveLength(1);
  });

  it("provize z commission_entries", () => {
    const c = rowToCommissionView(
      {
        owner_id: "u1", period: "2026-10-01", revenue: "58200.00", cost: "40000.00", profit: "18200.00", margin: "0.3127",
        rate: "0.1000", base: "margin", commission: "1820.00", status: "predbezna", cost_known: true, updated_at: null,
      },
      "Petr Obchodník",
    );
    expect(c).toEqual({
      ownerId: "u1", ownerName: "Petr Obchodník", revenue: 58200, cost: 40000, profit: 18200, margin: 0.3127, rate: 0.1,
      base: "margin", commission: 1820, status: "predbezna", costKnown: true, period: "2026-10-01", updatedAt: null,
    });
    expect(rowToCommissionView({ owner_id: "u", period: "2026-10-01", revenue: null, commission: null, status: "x" }, "").status)
      .toBe("predbezna");
  });
});

describe("předání do výroby: vazba položek na díly a e-maily změny / storna / pozastavení", () => {
  it("cleanPurchaseItems drží order_item_id jen s platnou vazbou (nabídky dodavatelů ji nemají)", () => {
    const item = "11111111-1111-4111-8111-111111111111";
    const r = cleanPurchaseItems([
      { drawingNumber: "PR-7075-20", name: "Příruba — tepelné zpracování", quantity: 240, unit: "kg", unitPrice: 8.75, orderItemId: item.toUpperCase() },
      { drawingNumber: "PR-7075-21", name: "Pouzdro", quantity: 100, orderItemId: "nesmysl" },
    ]);
    expect("rows" in r && r.rows[0]).toMatchObject({ order_item_id: item, unit: "kg", quantity: 240 });
    expect("rows" in r && "order_item_id" in r.rows[1]).toBe(false);
  });

  it("změna, storno a pozastavení objednávky — předmět, termín, podpis odesílatele", () => {
    const sender = { number: "OV-2026-012", companyName: "Mnástrojárna s.r.o.", senderName: "Petr Obchodník", senderEmail: "obchod@mnastrojarna.cz", senderPhone: "777 123 456" };
    const ch = purchaseOrderChangeEmail({ ...sender, revision: 2, requiredDate: "2026-11-16", previousRequiredDate: "2026-11-13", reason: "posun konečného termínu" });
    expect(ch.subject).toBe("Změna objednávky OV-2026-012 (změna 2) — Mnástrojárna s.r.o.");
    expect(ch.body).toContain("Požadovaný termín dodání se mění z 13. 11. 2026 na 16. 11. 2026 (pondělí).");
    expect(ch.body).toContain("Důvod: posun konečného termínu");
    expect(ch.body.endsWith("Petr Obchodník\nMnástrojárna s.r.o.\ntel. 777 123 456 · obchod@mnastrojarna.cz")).toBe(true);
    const cancel = purchaseOrderCancelEmail({ ...sender, reason: "Zákazník zakázku zrušil" });
    expect(cancel.subject).toBe("Storno objednávky OV-2026-012 — Mnástrojárna s.r.o.");
    expect(cancel.body).toContain("rušíme naši objednávku č. OV-2026-012 — Zákazník zakázku zrušil.");
    const hold = purchaseOrderHoldEmail(sender);
    expect(hold.subject).toBe("Pozastavení objednávky OV-2026-012 — Mnástrojárna s.r.o.");
    expect(hold.body).toContain("prosíme o pozastavení naší objednávky č. OV-2026-012.");
    for (const m of [ch, cancel, hold]) expect(m.body).not.toMatch(/Kč|mezitermín/i);
  });

  it("provize zakázky čeká na nákupní cenu (čísla objednávek), jen když náklad není známý", () => {
    const base = { owner_id: "o", period: "2026-10-01", revenue: 50_000, commission: 0, status: "predbezna", base: "margin" };
    expect(rowToCommissionView({ ...base, cost_known: false, cost_pending_po: ["OV-2026-012"] }, "Petr").pendingPurchaseOrders).toEqual(["OV-2026-012"]);
    expect("pendingPurchaseOrders" in rowToCommissionView({ ...base, cost_known: true, cost_pending_po: ["OV-2026-012"] }, "Petr")).toBe(false);
  });
});

