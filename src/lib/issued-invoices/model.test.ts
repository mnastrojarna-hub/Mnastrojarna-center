import { describe, it, expect } from "vitest";
import {
  asciiPart, byMonth, csvDate, csvNumber, dedupeEntryNames, exportBaseName, filterInvoices, invoiceEntryName, invoicesCsv,
  isFuturePeriod, jobOnlyId, parsePeriod, paymentOf, periodKey, periodLabel, periodLabelFrom, periodRange, shiftPeriod,
  sortInvoices, totalsOf, type IssuedInvoice,
} from "./model";

const TODAY = "2026-11-10";

function inv(p: Partial<IssuedInvoice> & { number: string }): IssuedInvoice {
  const net = p.net ?? 10_000;
  const gross = p.gross ?? Math.round(net * 121) / 100;
  return {
    id: p.id ?? p.number,
    issueDate: "2026-11-05",
    taxableDate: "2026-11-05",
    dueDate: "2026-11-19",
    variableSymbol: p.number.replace(/\D/g, ""),
    currency: "CZK",
    vat: Math.round((gross - net) * 100) / 100,
    vatRate: 21,
    customer: { id: "c1", name: "Strojmetal a.s.", ico: "12345678", dic: "CZ12345678" },
    job: { id: "j1", number: "Z-2026-001", title: "Hřídel" },
    file: { id: "f1", filename: `Faktura_${p.number}.pdf`, mimeType: "application/pdf", generated: true },
    payment: paymentOf({ net, gross, dueDate: p.dueDate ?? "2026-11-19" }, [], TODAY),
    sentAt: null,
    estimated: false,
    external: false,
    ...p,
    net,
    gross,
  };
}

describe("období", () => {
  it("měsíc, rok, neplatné → aktuální měsíc", () => {
    expect(parsePeriod("2026-11", TODAY)).toEqual({ kind: "month", year: 2026, month: 11 });
    expect(parsePeriod("2025", TODAY)).toEqual({ kind: "year", year: 2025 });
    expect(parsePeriod("2026-13", TODAY)).toEqual({ kind: "month", year: 2026, month: 11 });
    expect(parsePeriod("abc", TODAY)).toEqual({ kind: "month", year: 2026, month: 11 });
    expect(parsePeriod(null, "2027-01-03")).toEqual({ kind: "month", year: 2027, month: 1 });
    expect(parsePeriod("1999", TODAY)).toEqual({ kind: "month", year: 2026, month: 11 });
  });

  it("rozsah, posun přes rok, popisky", () => {
    expect(periodRange({ kind: "month", year: 2026, month: 2 })).toEqual({ from: "2026-02-01", to: "2026-02-28" });
    expect(periodRange({ kind: "month", year: 2028, month: 2 })).toEqual({ from: "2028-02-01", to: "2028-02-29" });
    expect(periodRange({ kind: "month", year: 2026, month: 12 })).toEqual({ from: "2026-12-01", to: "2026-12-31" });
    expect(periodRange({ kind: "year", year: 2026 })).toEqual({ from: "2026-01-01", to: "2026-12-31" });
    expect(shiftPeriod({ kind: "month", year: 2026, month: 1 }, -1)).toEqual({ kind: "month", year: 2025, month: 12 });
    expect(shiftPeriod({ kind: "month", year: 2026, month: 12 }, 1)).toEqual({ kind: "month", year: 2027, month: 1 });
    expect(shiftPeriod({ kind: "year", year: 2026 }, -1)).toEqual({ kind: "year", year: 2025 });
    expect(periodKey({ kind: "month", year: 2026, month: 3 })).toBe("2026-03");
    expect(periodLabel({ kind: "month", year: 2026, month: 11 })).toBe("listopad 2026");
    expect(periodLabelFrom({ kind: "month", year: 2026, month: 11 })).toBe("z listopadu 2026");
    expect(periodLabelFrom({ kind: "year", year: 2026 })).toBe("z roku 2026");
    expect(exportBaseName({ kind: "month", year: 2026, month: 11 })).toBe("Faktury_vydane_2026-11");
    expect(isFuturePeriod({ kind: "month", year: 2026, month: 12 }, TODAY)).toBe(true);
    expect(isFuturePeriod({ kind: "month", year: 2026, month: 11 }, TODAY)).toBe(false);
    expect(isFuturePeriod({ kind: "year", year: 2027 }, TODAY)).toBe(true);
  });
});

describe("úhrada faktury z plateb zakázky", () => {
  const base = { net: 10_000, gross: 12_100, dueDate: "2026-11-19" };

  it("bez plateb: nezaplaceno, po splatnosti po datu splatnosti", () => {
    expect(paymentOf(base, [], TODAY)).toMatchObject({ state: "nezaplaceno", paid: 0, remaining: 12_100, overdue: false });
    expect(paymentOf(base, [], "2026-11-20")).toMatchObject({ state: "po_splatnosti", overdue: true, remaining: 12_100 });
  });

  it("platby bez DPH se přepočtou na s DPH; záloha + doplatek = zaplaceno", () => {
    const part = paymentOf(base, [{ paid_on: "2026-10-01", amount: 4_000 }], TODAY);
    expect(part).toMatchObject({ state: "castecne", paid: 4_840, remaining: 7_260 });
    const full = paymentOf(base, [{ paid_on: "2026-10-01", amount: 4_000 }, { paid_on: "2026-11-12", amount: 6_000 }], TODAY);
    expect(full).toMatchObject({ state: "zaplaceno", paid: 12_100, remaining: 0, paidOn: "2026-11-12" });
    // částečně zaplacená po splatnosti → po splatnosti (zbytek)
    expect(paymentOf(base, [{ paid_on: "2026-10-01", amount: 4_000 }], "2026-12-01")).toMatchObject({ state: "po_splatnosti", remaining: 7_260 });
  });

  it("vyrovnávající platba / zaplacená zakázka / uhrazená faktura = zaplaceno; storno", () => {
    expect(paymentOf(base, [{ paid_on: "2026-11-11", amount: 9_000, settles: true }], TODAY).state).toBe("zaplaceno");
    expect(paymentOf(base, [{ paid_on: "2026-11-11", amount: null }], TODAY)).toMatchObject({ state: "zaplaceno", paid: 12_100 });
    expect(paymentOf({ ...base, jobPaidAt: "2026-11-15" }, [], "2026-12-30")).toMatchObject({ state: "zaplaceno", overdue: false, paidOn: "2026-11-15" });
    expect(paymentOf({ ...base, status: "uhrazena" }, [], TODAY).state).toBe("zaplaceno");
    expect(paymentOf({ ...base, status: "stornovana" }, [], TODAY)).toMatchObject({ state: "storno", paid: 0, remaining: 0 });
    // haléřový rozdíl přepočtu není dluh
    expect(paymentOf({ net: 333.33, gross: 403.33, dueDate: null }, [{ paid_on: "2026-11-01", amount: 333.33 }], TODAY).state).toBe("zaplaceno");
  });
});

describe("součty", () => {
  const a = inv({ number: "FV-2026-001", net: 10_000, gross: 12_100 });
  const b = inv({ number: "FV-2026-002", net: 5_000, gross: 6_050, file: null, payment: paymentOf({ net: 5_000, gross: 6_050, dueDate: "2026-11-01" }, [{ paid_on: "2026-11-02", amount: 5_000 }], TODAY) });
  const c = inv({ number: "FV-2026-003", net: 2_000, gross: 2_420, dueDate: "2026-11-01", payment: paymentOf({ net: 2_000, gross: 2_420, dueDate: "2026-11-01" }, [], TODAY) });
  const eur = inv({ id: "e1", number: "FV-2026-004", currency: "EUR", net: 1_000, gross: 1_210, issueDate: "2026-10-15" });
  const storno = inv({ number: "FV-2026-005", net: 9_999, payment: paymentOf({ net: 9_999, gross: 12_098.79, dueDate: null, status: "stornovana" }, [], TODAY) });

  it("Kč: počet, bez DPH, s DPH, zaplaceno / nezaplaceno / po splatnosti; storno mimo", () => {
    const t = totalsOf([a, b, c, storno]);
    expect(t.count).toBe(3);
    expect(t.storno).toBe(1);
    expect(t.withoutPdf).toBe(1);
    expect(t.byCurrency).toEqual([{ currency: "CZK", count: 3, net: 17_000, vat: 3_570, gross: 20_570, paid: 6_050, unpaid: 14_520, overdue: 2_420 }]);
    expect(t.czk).toEqual({ net: 17_000, gross: 20_570, unpaid: 14_520, converted: false });
    expect([t.paidCount, t.unpaidCount, t.overdueCount]).toEqual([1, 2, 1]);
  });

  it("cizí měna: zvlášť po měnách; Kč celkem jen s kurzem", () => {
    const without = totalsOf([a, eur]);
    expect(without.byCurrency.map((x) => x.currency)).toEqual(["CZK", "EUR"]);
    expect(without.czk).toBeNull();
    const withRate = totalsOf([a, eur], (it) => (it.currency === "EUR" ? 25 : null));
    expect(withRate.czk).toEqual({ net: 35_000, gross: 42_350, unpaid: 42_350, converted: true });
  });

  it("rok po měsících", () => {
    const months = byMonth([a, b, eur]);
    expect(months).toHaveLength(12);
    expect(months[10].totals.count).toBe(2);
    expect(months[9].totals.byCurrency[0].currency).toBe("EUR");
    expect(months[0].totals.count).toBe(0);
  });
});

describe("hledání a řazení", () => {
  const list = [
    inv({ number: "FV-2026-010", issueDate: "2026-11-03", net: 1_000, customer: { id: "c2", name: "Škoda Auto a.s.", ico: "00177041", dic: null } }),
    inv({ number: "FV-2026-9", issueDate: "2026-11-01", net: 50_000 }),
    inv({ number: "FV-2026-011", issueDate: "2026-11-03", net: 7_000, job: { id: "j9", number: "Z-2026-077", title: "Příruba DN50" } }),
  ];

  it("hledá bez diakritiky v čísle, odběrateli, IČ a zakázce", () => {
    expect(filterInvoices(list, "skoda").map((x) => x.number)).toEqual(["FV-2026-010"]);
    expect(filterInvoices(list, "00177041").map((x) => x.number)).toEqual(["FV-2026-010"]);
    expect(filterInvoices(list, "priruba z-2026-077").map((x) => x.number)).toEqual(["FV-2026-011"]);
    expect(filterInvoices(list, "fv-2026-9").map((x) => x.number)).toEqual(["FV-2026-9"]);
    expect(filterInvoices(list, "  ")).toHaveLength(3);
  });

  it("řadí podle data, čísla (přirozeně), částky a odběratele", () => {
    expect(sortInvoices(list, "datum", "desc").map((x) => x.number)).toEqual(["FV-2026-011", "FV-2026-010", "FV-2026-9"]);
    expect(sortInvoices(list, "cislo", "asc").map((x) => x.number)).toEqual(["FV-2026-9", "FV-2026-010", "FV-2026-011"]);
    expect(sortInvoices(list, "castka", "desc").map((x) => x.number)).toEqual(["FV-2026-9", "FV-2026-011", "FV-2026-010"]);
    // česká abeceda: Š až za S
    expect(sortInvoices(list, "odberatel", "asc").map((x) => x.customer?.name)).toEqual(["Strojmetal a.s.", "Strojmetal a.s.", "Škoda Auto a.s."]);
  });
});

describe("názvy souborů v ZIPu", () => {
  it("číslo + odběratel bez diakritiky, přípona souboru", () => {
    expect(invoiceEntryName({ number: "FV-2026-012", customer: { id: "c", name: "Strojírny Třinec, a.s.", ico: null, dic: null } })).toBe("FV-2026-012_Strojirny_Trinec_a.s.pdf");
    expect(invoiceEntryName({ number: "FV/2026/1", customer: null }, "JPG")).toBe("FV_2026_1.jpg");
    expect(invoiceEntryName({ number: "", customer: null })).toBe("faktura.pdf");
    expect(asciiPart("Žluťoučký kůň: \"test\" / 1")).toBe("Zlutoucky_kun_test_1");
    expect(asciiPart("a".repeat(100), 10)).toBe("aaaaaaaaaa");
  });

  it("stejné názvy dostanou pořadí", () => {
    expect(dedupeEntryNames(["a.pdf", "A.pdf", "b.pdf", "a.pdf"])).toEqual(["a.pdf", "A(2).pdf", "b.pdf", "a(3).pdf"]);
  });

  it("faktura jen na zakázce má id job:<uuid>", () => {
    expect(jobOnlyId("job:abc")).toBe("abc");
    expect(jobOnlyId("abc")).toBeNull();
  });
});

describe("CSV pro účetní", () => {
  it("BOM, středník, CRLF, české číslo a datum, uvozovky, součty po měnách", () => {
    const a = inv({ number: "FV-2026-001", net: 12_500, gross: 15_125, customer: { id: "c", name: "Firma; \"A\" s.r.o.", ico: "1", dic: "CZ1" } });
    const b = inv({ number: "FV-2026-002", net: 100.5, gross: 121.61, file: null, estimated: true });
    const csv = invoicesCsv([a, b]);
    expect(csv.startsWith("﻿")).toBe(true);
    const lines = csv.slice(1).split("\r\n");
    expect(lines[0].split(";")).toHaveLength(18);
    expect(lines[0]).toMatch(/^Číslo faktury;Datum vystavení;DUZP;Splatnost;/);
    expect(lines[1]).toBe('FV-2026-001;5.11.2026;5.11.2026;19.11.2026;2026001;"Firma; ""A"" s.r.o.";1;CZ1;Z-2026-001;12500,00;21;2625,00;15125,00;CZK;0,00;15125,00;Nezaplaceno;');
    expect(lines[2]).toContain("částky odhadnuté z hodnoty zakázky, bez PDF");
    expect(lines[3]).toBe("");
    expect(lines[4]).toMatch(/^Celkem CZK;;;;;2 faktury;;;;12600,50;;2646,11;15246,61;CZK;0,00;15246,61;;$/);
    expect(csv.endsWith("\r\n")).toBe(true);
  });

  it("prázdný seznam = jen hlavička; formáty", () => {
    expect(invoicesCsv([]).slice(1).split("\r\n").filter(Boolean)).toHaveLength(1);
    expect(csvNumber(1234.5)).toBe("1234,50");
    expect(csvNumber(null)).toBe("");
    expect(csvDate("2026-01-09")).toBe("9.1.2026");
    expect(csvDate(null)).toBe("");
  });
});
