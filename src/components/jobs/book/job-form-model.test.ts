import { describe, it, expect } from "vitest";
import {
  parseDecimal, formatDecimalInput, initialFormState, validateJobForm, emptyItem, isItemEmpty, lineTotal,
  formTotals, formValueHint, findSameCustomer, firstErrorKey, customerOwnerOf, ownerHint, type JobFormState,
} from "./job-form-model";

const C1 = "3f2b8c1e-1d2a-4c3b-9a8e-7f6d5c4b3a21";
const U1 = "11111111-2222-4333-8444-555555555555";

function base(over: Partial<JobFormState> = {}): JobFormState {
  return { ...initialFormState({}, { stage: "objednavka", ownerId: U1 }), title: "Příruby", customerId: C1, ...over };
}

describe("parseDecimal", () => {
  it("česká čísla", () => {
    expect(parseDecimal("1,5")).toBe(1.5);
    expect(parseDecimal("1 234,5")).toBe(1234.5);
    expect(parseDecimal("1 234")).toBe(1234);
    expect(parseDecimal("12.75")).toBe(12.75);
    expect(parseDecimal(",5")).toBe(0.5);
    expect(parseDecimal("")).toBeNull();
    expect(parseDecimal("  ")).toBeNull();
    expect(parseDecimal("abc")).toBeNaN();
    expect(parseDecimal("1.234,5")).toBeNaN();
  });

  it("formatDecimalInput", () => {
    expect(formatDecimalInput(1.5)).toBe("1,5");
    expect(formatDecimalInput(null)).toBe("");
    expect(formatDecimalInput(Number.NaN)).toBe("");
  });
});

describe("initialFormState", () => {
  it("výchozí hodnoty", () => {
    const s = initialFormState({}, { stage: "poptavka", ownerId: U1 });
    expect(s.stage).toBe("poptavka");
    expect(s.priority).toBe("stredni");
    expect(s.ownerId).toBe(U1);
    expect(s.customerMode).toBe("existing");
    expect(s.items).toEqual([]);
  });

  it("předvyplnění (např. z dokladu)", () => {
    const s = initialFormState({
      title: "Hřídel", stage: "objednavka", priority: "vysoka", customerName: "Nová firma s.r.o.",
      dueDate: "2026-11-05T00:00:00Z", ownerId: null,
      items: [{ drawingNumber: "VK-1", quantity: 2.5, unitPrice: 120, unit: "" }],
    }, { ownerId: U1 });
    expect(s.customerMode).toBe("new");
    expect(s.customerName).toBe("Nová firma s.r.o.");
    expect(s.dueDate).toBe("2026-11-05");
    expect(s.priority).toBe("vysoka");
    expect(s.ownerId).toBe(U1);
    expect(s.items[0]).toMatchObject({ drawingNumber: "VK-1", quantity: "2,5", unitPrice: "120", unit: "ks" });
  });

  it("neplatný stav → výchozí", () => {
    expect(initialFormState({ stage: "nesmysl" as never }).stage).toBe("objednavka");
  });
});

describe("položky", () => {
  it("prázdný řádek", () => {
    const it0 = emptyItem();
    expect(isItemEmpty(it0)).toBe(true);
    expect(isItemEmpty({ ...it0, name: "Čep" })).toBe(false);
    expect(emptyItem().key).not.toBe(it0.key);
  });

  it("součty", () => {
    expect(lineTotal("2,5", "100")).toBe(250);
    expect(lineTotal("2", "")).toBeNull();
    const items = [
      { ...emptyItem(), name: "A", quantity: "2", unitPrice: "10", purchaseUnitPrice: "6" },
      { ...emptyItem(), name: "B", quantity: "1,5", unitPrice: "", purchaseUnitPrice: "4" },
      { ...emptyItem(), quantity: "9", unitPrice: "" },
    ];
    expect(formTotals(items, true)).toEqual({ value: 20, purchase: 18, unpriced: 1, count: 2 });
    expect(formTotals(items, false)).toEqual({ value: 20, purchase: null, unpriced: 1, count: 2 });
  });
});

describe("validateJobForm", () => {
  it("platný formulář → hodnoty pro createJob", () => {
    const { values, errors } = validateJobForm(base({
      customerOrderNumber: " PO-1 ", dueDate: "2026-11-05", maxToleratedDate: "2026-11-12",
      items: [
        { ...emptyItem(), drawingNumber: "VK-1", quantity: "2,5", unitPrice: "100", purchaseUnitPrice: "60" },
        emptyItem(),
      ],
    }), { margins: true });
    expect(errors).toEqual({});
    expect(values).toMatchObject({
      title: "Příruby", stage: "objednavka", customerId: C1, customerOrderNumber: "PO-1", dueDate: "2026-11-05",
      ownerId: U1, assigneeId: null, supplierId: null,
    });
    expect(values?.customerName).toBeUndefined();
    expect(values?.items).toHaveLength(1);
    expect(values?.items[0]).toMatchObject({ drawingNumber: "VK-1", quantity: 2.5, unitPrice: 100, purchaseUnitPrice: 60, unit: "ks" });
  });

  it("bez práva na marže se nákupní cena neposílá", () => {
    const { values } = validateJobForm(base({
      items: [{ ...emptyItem(), name: "A", purchaseUnitPrice: "abc" }],
    }), { margins: false });
    expect(values?.items[0]).not.toHaveProperty("purchaseUnitPrice");
  });

  it("nový zákazník", () => {
    const ok = validateJobForm(base({ customerMode: "new", customerId: "", customerName: "  Firma ABC  " }), { margins: false });
    expect(ok.values?.customerName).toBe("Firma ABC");
    expect(ok.values?.customerId).toBeUndefined();
    const bad = validateJobForm(base({ customerMode: "new", customerName: "A" }), { margins: false });
    expect(bad.errors.customer).toMatch(/krátký/);
  });

  it("chybí zákazník / název", () => {
    const { values, errors } = validateJobForm(base({ customerId: "", title: "" }), { margins: false });
    expect(values).toBeNull();
    expect(errors.customer).toBeTruthy();
    expect(errors.title).toBeTruthy();
    expect(firstErrorKey(errors)).toBe("title");
    // zákazník nepovinný (např. ruční vyplnění dokladu)
    expect(validateJobForm(base({ customerId: "" }), { margins: false, requireCustomer: false }).errors.customer).toBeUndefined();
  });

  it("název stačí odvodit z položky", () => {
    const { errors } = validateJobForm(base({ title: "", items: [{ ...emptyItem(), drawingNumber: "VK-9" }] }), { margins: false });
    expect(errors.title).toBeUndefined();
  });

  it("množství, ceny a termíny", () => {
    const { errors } = validateJobForm(base({
      dueDate: "2026-11-05", maxToleratedDate: "2026-11-01",
      items: [
        { ...emptyItem(), name: "A", quantity: "0" },
        { ...emptyItem(), name: "B", quantity: "x" },
        { ...emptyItem(), name: "C", quantity: "1", unitPrice: "-5" },
      ],
    }), { margins: true });
    expect(errors["items.0.quantity"]).toBeTruthy();
    expect(errors["items.1.quantity"]).toBeTruthy();
    expect(errors["items.2.unitPrice"]).toBeTruthy();
    expect(errors.maxToleratedDate).toMatch(/dřív/);
  });

  it("tolerovaný termín proti požadovanému, když chybí potvrzený", () => {
    const { errors } = validateJobForm(base({ customerRequiredDate: "2026-11-05", maxToleratedDate: "2026-11-04" }), { margins: false });
    expect(errors.maxToleratedDate).toBeTruthy();
  });
});

describe("findSameCustomer", () => {
  it("najde zákazníka bez ohledu na diakritiku a mezery", () => {
    const list = [{ id: C1, name: "Strojmetal  s.r.o.", customerNumber: "ZK1", ico: null }];
    expect(findSameCustomer(list, "strojmetal s.r.o.")?.id).toBe(C1);
    expect(findSameCustomer(list, "Jiný")).toBeNull();
    expect(findSameCustomer(list, "")).toBeNull();
  });
});

describe("obchodník podle zákazníka (2. 11.)", () => {
  const opts = { customers: [{ id: "c1", name: "A", ownerId: "u1" }, { id: "c2", name: "B", ownerId: null }] } as unknown as Parameters<typeof ownerHint>[1];
  const st = (customerId: string, ownerId: string) => ({ customerMode: "existing" as const, customerId, ownerId });

  it("obchodník zákazníka z voleb formuláře", () => {
    expect(customerOwnerOf(opts, "c1")).toBe("u1");
    expect(customerOwnerOf(opts, "c2")).toBeNull();
    expect(customerOwnerOf(opts, "x")).toBeNull();
  });

  it("nápověda: podle zákazníka / ručně", () => {
    expect(ownerHint(st("c1", "u1"), opts, false)).toBe("podle zákazníka");
    expect(ownerHint(st("c1", "u2"), opts, true)).toBe("ručně — jiný než obchodník zákazníka");
    expect(ownerHint(st("c1", "u2"), opts, false)).toBe("jiný než obchodník zákazníka (ručně)");
    expect(ownerHint(st("c2", "u2"), opts, false)).toBe("podle zákazníka");
    expect(ownerHint(st("c2", "u2"), opts, true)).toBe("zvolen ručně (zákazník obchodníka nemá)");
  });
});

// ── Nová zakázka: hodnota = součet položek (křížová konzistence 4. 11.) ──
describe("hodnota zakázky z položek (Nová zakázka)", () => {
  const row = (over: Partial<ReturnType<typeof emptyItem>>) => ({ ...emptyItem(), name: "Díl", ...over });

  it("formTotals: Σ(počet × cena) jen nacenených, počítá položky bez ceny, prázdné řádky ignoruje", () => {
    expect(formTotals([], true)).toEqual({ value: null, purchase: null, unpriced: 0, count: 0 });
    const items = [
      row({ quantity: "50", unitPrice: "1 180", purchaseUnitPrice: "700" }),
      row({ quantity: "50", unitPrice: "960" }),
      row({ quantity: "3", unitPrice: "" }),
      emptyItem(), // prázdný řádek se při uložení zahodí
    ];
    expect(formTotals(items, true)).toEqual({ value: 107_000, purchase: 35_000, unpriced: 1, count: 3 });
    expect(formTotals(items, false).purchase).toBeNull();
    // neplatné číslo = bez ceny (formulář ho odmítne při uložení)
    expect(formTotals([row({ quantity: "2", unitPrice: "abc" })], true)).toEqual({ value: null, purchase: null, unpriced: 1, count: 1 });
  });

  it("uložené položky nesou ceny, ze kterých createJob hodnotu spočítá (ve formuláři není samostatné pole hodnoty)", () => {
    const { values, errors } = validateJobForm(base({ items: [row({ quantity: "2", unitPrice: "1 234,5" }), row({ quantity: "1" })] }), { margins: true });
    expect(errors).toEqual({});
    expect(values!.items.map((i) => i.unitPrice)).toEqual([1234.5, null]);
    expect("value" in values!).toBe(false);
    expect(formTotals(base({ items: [row({ quantity: "2", unitPrice: "1 234,5" }), row({ quantity: "1" })] }).items, true)).toMatchObject({ value: 2469, unpriced: 1 });
  });

  it("patička: hláška o součtu položek", () => {
    expect(formValueHint({ value: null, unpriced: 2 })).toBe("Cena se doplní později (nacenění dělá člověk).");
    expect(formValueHint({ value: 100, unpriced: 0 })).toBe("= hodnota zakázky (součet položek)");
    expect(formValueHint({ value: 100, unpriced: 1 })).toBe("= hodnota zakázky (součet položek, 1 položka bez ceny)");
    expect(formValueHint({ value: 100, unpriced: 3 })).toBe("= hodnota zakázky (součet položek, 3 položky bez ceny)");
    expect(formValueHint({ value: 100, unpriced: 7 })).toBe("= hodnota zakázky (součet položek, 7 položek bez ceny)");
  });
});
