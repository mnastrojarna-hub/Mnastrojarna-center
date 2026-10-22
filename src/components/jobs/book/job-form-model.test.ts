import { describe, it, expect } from "vitest";
import {
  parseDecimal, formatDecimalInput, initialFormState, validateJobForm, emptyItem, isItemEmpty, lineTotal,
  formTotals, findSameCustomer, firstErrorKey, type JobFormState,
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
    expect(formTotals(items, true)).toEqual({ value: 20, purchase: 18 });
    expect(formTotals(items, false)).toEqual({ value: 20, purchase: null });
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
