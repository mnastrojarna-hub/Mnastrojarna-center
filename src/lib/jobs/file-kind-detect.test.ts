import { describe, expect, it } from "vitest";
import { detectFileKind, pdfFromCad } from "@/lib/jobs/file-kind-detect";

const pdf = (meta = "") => new TextEncoder().encode(`%PDF-1.7\n1 0 obj\n<< ${meta} >>\nendobj\n%%EOF`);
const step = new TextEncoder().encode("ISO-10303-21;\nHEADER;\nENDSEC;\n");

describe("detectFileKind — druh přílohy bez AI (deterministika dávky focení)", () => {
  it("CAD podle obsahu i bez přípony, druh dokladu podle názvu", () => {
    expect(detectFileKind({ filename: "dil", bytes: step })).toBe("model_3d");
    expect(detectFileKind({ filename: "4711.dxf" })).toBe("vykres");
    expect(detectFileKind({ filename: "Objednavka_PO-4471.pdf", mime: "application/pdf", customerDocs: true })).toBe("objednavka");
    expect(detectFileKind({ filename: "Faktura 2026118.pdf", mime: "application/pdf" })).toBe("faktura");
  });

  it("PDF z CAD programu = výkres i s obecným názvem", () => {
    const bytes = pdf("/Producer (SOLIDWORKS 2024) /Creator (SolidWorks)");
    expect(pdfFromCad(bytes)).toBe(true);
    expect(detectFileKind({ filename: "dokument.pdf", mime: "application/pdf", bytes })).toBe("vykres");
    expect(pdfFromCad(pdf("/Producer (Microsoft Word)"))).toBe(false);
  });

  it("PDF pojmenované číslem výkresu = výkres u podkladů zákazníka nebo shody s položkou (dřív „Ostatní“)", () => {
    expect(detectFileKind({ filename: "4711-02_rev_B.pdf", mime: "application/pdf", customerDocs: true })).toBe("vykres");
    expect(detectFileKind({ filename: "4711-02.pdf", mime: "application/pdf", itemDrawingKeys: new Set(["471102"]) })).toBe("vykres");
    expect(detectFileKind({ filename: "4711-02.pdf", mime: "application/pdf" })).toBe("ostatni");
  });

  it("fotky z telefonu a obchodní čísla nejsou výkres", () => {
    expect(detectFileKind({ filename: "20261103_101500.jpg", mime: "image/jpeg", customerDocs: true })).toBe("foto");
    expect(detectFileKind({ filename: "WhatsApp Image 2026-11-03 at 10.00.jpg", mime: "image/jpeg", customerDocs: true })).toBe("foto");
    expect(detectFileKind({ filename: "PO_4471.pdf", mime: "application/pdf", customerDocs: true })).toBe("ostatni");
    expect(detectFileKind({ filename: "poznamky.txt", mime: "text/plain", customerDocs: true })).toBe("ostatni");
  });
});
