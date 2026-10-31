import { describe, it, expect } from "vitest";
import { addDays, buildPlanView, cleanPlanInput, dayLabel, totalsByCurrency, type PaymentPlanEntry } from "@/lib/supplier-invoices/payment-plan";

const TODAY = "2026-10-31"; // sobota

const entry = (id: string, dueOn: string, amount: number, extra: Partial<PaymentPlanEntry> = {}): PaymentPlanEntry => ({
  id, payee: `Komu ${id}`, amount, currency: "CZK", dueOn, note: null, invoice: null, paidAt: null, paidByName: null,
  createdByName: null, createdAt: `2026-10-30T10:00:0${id.length}Z`, ...extra,
});

describe("Platební plán — vstup", () => {
  it("komu, částka (české zápisy), měna, kdy", () => {
    expect(cleanPlanInput({ payee: "  Franta   Vomáčka ", amount: "12 500", dueOn: "2026-11-02" }))
      .toEqual({ payee: "Franta Vomáčka", amount: 12500, currency: "CZK", dueOn: "2026-11-02", invoiceId: null, note: null });
    expect(cleanPlanInput({ payee: "X", amount: "1 234,50 Kč", currency: "eur", dueOn: "2026-11-02", note: " záloha " }))
      .toMatchObject({ amount: 1234.5, currency: "EUR", note: "záloha" });
    expect(cleanPlanInput({ payee: "X", amount: 99.999, dueOn: "2026-11-02" })).toMatchObject({ amount: 100 });
  });
  it("chyby česky", () => {
    expect(cleanPlanInput({ payee: "", amount: "1", dueOn: TODAY })).toBe("Napiš, komu se má platit.");
    expect(cleanPlanInput({ payee: "A", amount: "abc", dueOn: TODAY })).toMatch(/Částka není číslo/);
    expect(cleanPlanInput({ payee: "A", amount: "0", dueOn: TODAY })).toMatch(/větší než nula/);
    expect(cleanPlanInput({ payee: "A", amount: "-5", dueOn: TODAY })).toMatch(/větší než nula/);
    expect(cleanPlanInput({ payee: "A", amount: "5", dueOn: "2026-02-30" })).toBe("Vyber, kdy se má zaplatit.");
    expect(cleanPlanInput({ payee: "A", amount: "5", dueOn: TODAY, invoiceId: "x" })).toBe("Neplatná faktura.");
    expect(cleanPlanInput({ payee: "A", amount: "5", currency: "korun", dueOn: TODAY })).toBe("Neznámá měna.");
  });
});

describe("Platební plán — dny a součty", () => {
  it("popisky dnů", () => {
    expect(dayLabel(TODAY, TODAY)).toBe("Dnes");
    expect(dayLabel(addDays(TODAY, 1), TODAY)).toBe("Zítra");
    expect(dayLabel(addDays(TODAY, 2), TODAY)).toBe("pondělí 2. 11.");
    expect(dayLabel("2027-01-05", TODAY)).toBe("úterý 5. 1. 2027");
    expect(addDays("2026-12-31", 1)).toBe("2027-01-01");
  });
  it("po termínu nahoře, pak po dnech; součty bez zaplacených; měny zvlášť", () => {
    const v = buildPlanView([
      entry("a", "2026-11-02", 12500),
      entry("b", "2026-10-29", 1000),
      entry("c", "2026-10-30", 500, { currency: "EUR" }),
      entry("d", TODAY, 300),
      entry("e", "2026-11-02", 2500),
      entry("f", TODAY, 9999, { paidAt: TODAY }),
    ], TODAY);
    expect(v.groups.map((g) => [g.key, g.label, g.entries.map((e) => e.id).join("")])).toEqual([
      ["overdue", "Po termínu", "bc"], [TODAY, "Dnes", "d"], ["2026-11-02", "pondělí 2. 11.", "ae"],
    ]);
    expect(v.groups[0].totals).toEqual([{ currency: "CZK", amount: 1000 }, { currency: "EUR", amount: 500 }]);
    expect(v.groups[2].totals).toEqual([{ currency: "CZK", amount: 15000 }]);
    expect(v.total).toEqual([{ currency: "CZK", amount: 16300 }, { currency: "EUR", amount: 500 }]);
    expect(v.overdueCount).toBe(2);
    expect(v.paid.map((e) => e.id)).toEqual(["f"]);
  });
  it("součty po měnách (CZK první)", () => {
    expect(totalsByCurrency([{ amount: 1.1, currency: "USD" }, { amount: 2.2, currency: "CZK" }, { amount: 0.1, currency: "USD" }]))
      .toEqual([{ currency: "CZK", amount: 2.2 }, { currency: "USD", amount: 1.2 }]);
    expect(totalsByCurrency([])).toEqual([]);
  });
});
