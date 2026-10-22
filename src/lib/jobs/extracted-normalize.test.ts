import { describe, it, expect } from "vitest";
import {
  normalizeExtracted, normalizeDate, parseNumber, normalizeIco, normalizeDic, emptyExtracted,
} from "./extracted-normalize";
import objednavka from "./__fixtures__/capture/objednavka-strojmetal.json";
import poptavka from "./__fixtures__/capture/poptavka-novy-zakaznik.json";
import dodaciList from "./__fixtures__/capture/dodaci-list-dodavatel.json";

describe("normalizeDate", () => {
  it("převede české i ISO formáty na RRRR-MM-DD", () => {
    expect(normalizeDate("12.3.2026")).toBe("2026-03-12");
    expect(normalizeDate("12. 3. 2026")).toBe("2026-03-12");
    expect(normalizeDate("05/11/2026")).toBe("2026-11-05");
    expect(normalizeDate("2026-03-12")).toBe("2026-03-12");
    expect(normalizeDate("2026-3-2")).toBe("2026-03-02");
    expect(normalizeDate("2026/03/12")).toBe("2026-03-12");
    expect(normalizeDate("2026-03-12T10:00:00Z")).toBe("2026-03-12");
    expect(normalizeDate("1.12.26")).toBe("2026-12-01");
  });
  it("neplatné nebo nečitelné datum → prázdné", () => {
    expect(normalizeDate("31.2.2026")).toBe("");
    expect(normalizeDate("13/13/2026")).toBe("");
    expect(normalizeDate("KW 14")).toBe("");
    expect(normalizeDate("")).toBe("");
    expect(normalizeDate(null)).toBe("");
    expect(normalizeDate(20260312)).toBe("");
  });
});

describe("parseNumber", () => {
  it("čte čísla s jednotkami a českými oddělovači", () => {
    expect(parseNumber(50)).toBe(50);
    expect(parseNumber("50 ks")).toBe(50);
    expect(parseNumber("1 250,5")).toBe(1250.5);
    expect(parseNumber("1 250,50 Kč")).toBe(1250.5);
    expect(parseNumber("1.250,50")).toBe(1250.5);
    expect(parseNumber("1,250.50")).toBe(1250.5);
    expect(parseNumber("1.250.000")).toBe(1250000);
    expect(parseNumber("12.5")).toBe(12.5);
    expect(parseNumber("Kč 3 400,-")).toBe(3400);
  });
  it("nečíselné → 0", () => {
    expect(parseNumber("neuvedeno")).toBe(0);
    expect(parseNumber(undefined)).toBe(0);
    expect(parseNumber(NaN)).toBe(0);
    expect(parseNumber({})).toBe(0);
  });
});

describe("IČO a DIČ", () => {
  it("IČO jen číslice, DIČ velkými bez mezer", () => {
    expect(normalizeIco("452 74 649")).toBe("45274649");
    expect(normalizeIco("IČO: 45274649")).toBe("45274649");
    expect(normalizeDic("cz 452 746 49")).toBe("CZ45274649");
    expect(normalizeDic("DE-811234567")).toBe("DE811234567");
  });
});

describe("normalizeExtracted", () => {
  it("prázdný / nesmyslný vstup → úplný prázdný doklad", () => {
    expect(normalizeExtracted(null)).toEqual(emptyExtracted());
    expect(normalizeExtracted("není json")).toEqual(emptyExtracted());
    expect(normalizeExtracted([1, 2])).toEqual(emptyExtracted());
  });

  it("doplní chybějící pole, ořeže texty a uklidí hodnoty", () => {
    const doc = normalizeExtracted({
      docKind: "Objednávka",
      issuer: "customer",
      documentNumber: "  PO 4500 123  ",
      documentDate: "21. 10. 2026",
      customer: { name: "  Strojmetal   a.s. ", ico: "452 74 649", dic: "cz45274649", email: " Dvorak@StrojMetal.cz " },
      items: [
        { drawingNumber: "VK-2291", quantity: "50 ks", unitPrice: "1 180,00", deliveryDate: "27.11.2026" },
        { quantity: 3 },
        { name: "Upínka", quantity: -4 },
        "nesmysl",
      ],
      totalWithoutVat: "107 000,-",
      currency: "Kč",
      confidence: 93,
      needsClarification: "ověřit revizi",
    });
    expect(doc.docKind).toBe("objednavka");
    expect(doc.issuer).toBe("zakaznik");
    expect(doc.documentNumber).toBe("PO 4500 123");
    expect(doc.documentDate).toBe("2026-10-21");
    expect(doc.customer.name).toBe("Strojmetal a.s.");
    expect(doc.customer.ico).toBe("45274649");
    expect(doc.customer.dic).toBe("CZ45274649");
    expect(doc.customer.email).toBe("dvorak@strojmetal.cz");
    expect(doc.customer.city).toBe("");
    expect(doc.supplier).toEqual(emptyExtracted().supplier);
    expect(doc.items).toHaveLength(2);
    expect(doc.items[0]).toMatchObject({ drawingNumber: "VK-2291", quantity: 50, unitPrice: 1180, deliveryDate: "2026-11-27", unit: "" });
    expect(doc.items[1]).toMatchObject({ name: "Upínka", quantity: 0 });
    expect(doc.totalWithoutVat).toBe(107000);
    expect(doc.currency).toBe("CZK");
    expect(doc.confidence).toBe(0.93);
    expect(doc.needsClarification).toEqual(["ověřit revizi"]);
  });

  it("neznámé enumy → ostatni / neznamy, confidence 0..1", () => {
    const doc = normalizeExtracted({ docKind: "leták", issuer: "mimozemšťan", confidence: 7 });
    expect(doc.docKind).toBe("ostatni");
    expect(doc.issuer).toBe("neznamy");
    expect(doc.confidence).toBe(0.07);
    expect(normalizeExtracted({ confidence: 1.7e9 }).confidence).toBe(1);
    expect(normalizeExtracted({ confidence: "85 %" }).confidence).toBe(0.85);
    expect(normalizeExtracted({ confidence: -1 }).confidence).toBe(0);
    expect(normalizeExtracted({ docKind: "dodací list" }).docKind).toBe("dodaci_list");
  });

  it("přijme snake_case klíče i JSON řetězec", () => {
    const doc = normalizeExtracted(JSON.stringify({
      doc_kind: "faktura", issuer: "my", document_number: "FV-2026-0012",
      customer: { contact_person: "Petra Nováková" },
    }));
    expect(doc.docKind).toBe("faktura");
    expect(doc.documentNumber).toBe("FV-2026-0012");
    expect(doc.customer.contactPerson).toBe("Petra Nováková");
  });

  it("odvodí čísla z čísla dokladu podle druhu a vystavitele", () => {
    expect(normalizeExtracted({ docKind: "objednavka", issuer: "zakaznik", documentNumber: "4711" }).customerOrderNumber).toBe("4711");
    expect(normalizeExtracted({ docKind: "poptavka", issuer: "neznamy", documentNumber: "RFQ-1" }).customerInquiryNumber).toBe("RFQ-1");
    expect(normalizeExtracted({ docKind: "nabidka", issuer: "my", documentNumber: "NAB-2026-031" }).ourQuoteNumber).toBe("NAB-2026-031");
    expect(normalizeExtracted({ docKind: "potvrzeni", issuer: "my", documentNumber: "PO-2026-9" }).ourOrderConfirmationNumber).toBe("PO-2026-9");
    // nabídka dodavatele není naše nabídka
    expect(normalizeExtracted({ docKind: "nabidka", issuer: "dodavatel", documentNumber: "N-77" }).ourQuoteNumber).toBe("");
    // explicitní číslo má přednost
    expect(normalizeExtracted({
      docKind: "objednavka", issuer: "zakaznik", documentNumber: "X-1", customerOrderNumber: "PO-9",
    }).customerOrderNumber).toBe("PO-9");
  });

  it("fixtures jsou platné a normalizace je nemění", () => {
    for (const f of [objednavka, poptavka, dodaciList]) {
      const doc = normalizeExtracted(f);
      expect(doc).toEqual(f);
      expect(normalizeExtracted(doc)).toEqual(doc);
    }
  });
});
