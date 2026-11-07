import { describe, expect, it } from "vitest";
import { convertNote, isCadDrawingName, jobFileIdFromHref, pdfNameFor } from "./drawing-convert-names";
import { cadPdfSummaryText } from "@/components/jobs/detail/documents-tab";

describe("převod DXF / DWG → PDF — názvy a souhrn", () => {
  it("výkres CAD podle přípony, id dokumentu z adresy, poznámka", () => {
    expect(isCadDrawingName("Příruba.DXF")).toBe(true);
    expect(isCadDrawingName("x.dwg ")).toBe(true);
    expect(isCadDrawingName("x.pdf")).toBe(false);
    expect(isCadDrawingName(null)).toBe(false);
    const id = "0b0e7f1e-1b7c-4a3a-9d3e-2f1a6c0b9e11";
    expect(jobFileIdFromHref(`/api/jobs/files/${id}`)).toBe(id);
    expect(jobFileIdFromHref(`/api/jobs/files/${id.toUpperCase()}?download=1`)).toBe(id);
    expect(jobFileIdFromHref(`/api/jobs/files/${id}/pdf`)).toBeNull();
    expect(jobFileIdFromHref("/api/quotes/x")).toBeNull();
    expect(convertNote("A.dxf")).toBe("Převedeno z A.dxf");
  });

  it("název PDF: základ výkresu, kolize → (z DXF), další kolize → číslo", () => {
    const taken = new Set(["a.pdf", "a (z dxf).pdf"]);
    expect(pdfNameFor("B-12.dwg", () => false)).toBe("B-12.pdf");
    expect(pdfNameFor("A.dxf", (n) => taken.has(n.toLowerCase()))).toBe("A (z DXF 2).pdf");
    expect(pdfNameFor("A.dxf", (n) => n.toLowerCase() === "a.pdf")).toBe("A (z DXF).pdf");
  });

  it("souhrn hromadného převodu", () => {
    expect(cadPdfSummaryText({ total: 4, converted: ["a", "b", "c"], skipped: [], failed: [{ name: "d.dwg", error: "x" }] }))
      .toBe("Převedeno 3 z 4; 1 se nepodařilo: d.dwg.");
    expect(cadPdfSummaryText({ total: 3, converted: ["a"], skipped: ["b", "c"], failed: [] })).toBe("Převedeno 1 z 3; 2 už PDF mají (přeskočeno).");
  });
});
