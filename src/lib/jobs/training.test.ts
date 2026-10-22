import { describe, it, expect } from "vitest";
import { formatCaptureLearningPrompt, type LearningRow } from "./training";

const row = (over: Partial<LearningRow>): LearningRow => ({
  doc_kind: "objednavka", source: "manual", final: null, created_at: "2026-10-20T10:00:00Z", ...over,
});

describe("formatCaptureLearningPrompt", () => {
  it("bez příkladů vrací prázdný text", () => {
    expect(formatCaptureLearningPrompt([])).toBe("");
    expect(formatCaptureLearningPrompt([row({ final: null }), row({ final: { documentNumber: "", items: [] } })])).toBe("");
  });

  it("vypíše jen vyplněné hodnoty s klíči schématu a položky zkráceně", () => {
    const text = formatCaptureLearningPrompt([
      row({
        final: {
          docKind: "objednavka", issuer: "zakaznik", documentNumber: "4795-2026", ourQuoteNumber: "NAB-2026-031",
          customerInquiryNumber: "", totalWithoutVat: 0, confidence: 0.9, summary: "nepatří sem",
          customer: { name: "Strojmetal a.s.", ico: "45274649", city: "" },
          items: [{ drawingNumber: "VK-2291", revision: "B", name: "Upínka", material: "1.2379", quantity: 50, unit: "ks", unitPrice: 1180 }],
        },
      }),
      row({ doc_kind: "dodaci_list", source: "corrected", final: { issuer: "dodavatel", customerOrderNumber: "OBJ-2026-045" } }),
    ]);
    expect(text.startsWith("UČENÍ Z RUČNÍ PRÁCE — Takto lidé vyplnili podobné doklady")).toBe(true);
    expect(text).toContain("1) [Objednávka, vyplněno ručně] docKind: objednavka, issuer: zakaznik, documentNumber: 4795-2026, ourQuoteNumber: NAB-2026-031");
    expect(text).toContain("customer: {name: Strojmetal a.s., ico: 45274649}");
    expect(text).toContain("položky: VK-2291 rev. B Upínka 1.2379 50 ks á 1180");
    expect(text).toContain("2) [Dodací list, opraveno člověkem] issuer: dodavatel, customerOrderNumber: OBJ-2026-045");
    expect(text).not.toContain("confidence");
    expect(text).not.toContain("nepatří sem");
    expect(text).not.toContain("customerInquiryNumber");
  });

  it("každý příklad nejvýš 400 znaků", () => {
    const text = formatCaptureLearningPrompt([row({ final: { note: "x".repeat(2000) } })]);
    const line = text.split("\n").find((l) => l.startsWith("1)"))!;
    expect(line.length).toBeLessThanOrEqual(400);
    expect(line.endsWith("…")).toBe(true);
  });
});
