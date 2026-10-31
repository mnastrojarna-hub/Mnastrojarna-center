import { describe, expect, it } from "vitest";
import { downloadHref, filenameFromAnchor, isViewableName, isViewerPath, safeViewerSrc, standaloneViewerHref } from "./viewer-links";

const anchor = (attrs: Record<string, string>, text = "") => ({
  getAttribute: (n: string) => attrs[n] ?? null,
  textContent: text,
});

describe("odkazy na prohlížeč", () => {
  it("cesty dokumentů, příloh, faktur a PDF", () => {
    expect(isViewerPath("/api/jobs/files/7f1c2b9e-1111-4222-8333-444455556666")).toBe(true);
    expect(isViewerPath("/api/emails/attachment/abc")).toBe(true);
    expect(isViewerPath("/api/supplier-invoices/files/abc")).toBe(true);
    expect(isViewerPath("/api/pdf/job/abc")).toBe(true);
    expect(isViewerPath("/api/pdf/nabidka")).toBe(true);
    expect(isViewerPath("/api/drawings/anonymize/abc/preview")).toBe(true);
    // kopie pro dodavatele se stahuje, neotevírá
    expect(isViewerPath("/api/drawings/anonymize/abc/download")).toBe(false);
    expect(isViewerPath("/api/jobs/files")).toBe(false);
    expect(isViewerPath("/api/search")).toBe(false);
    expect(isViewerPath("/orders/abc")).toBe(false);
  });

  it("co prohlížeč umí a co nechá na stažení", () => {
    expect(isViewableName("Výkres 123.PDF")).toBe(true);
    expect(isViewableName("dil.stp")).toBe(true);
    expect(isViewableName("sestava.STEP")).toBe(true);
    expect(isViewableName("foto.jpg")).toBe(true);
    expect(isViewableName("nabidka.docx")).toBe(false);
    expect(isViewableName("dil.sldprt")).toBe(false);
    expect(isViewableName("výkres.dxf")).toBe(false);
    expect(isViewableName(null)).toBeNull();
    expect(isViewableName("bez-pripony")).toBeNull();
  });

  it("název souboru z odkazu", () => {
    expect(filenameFromAnchor(anchor({ "data-filename": "a b.step" }))).toBe("a b.step");
    expect(filenameFromAnchor(anchor({ "aria-label": "Otevřít DIL-01.stp" }))).toBe("DIL-01.stp");
    expect(filenameFromAnchor(anchor({}, "  výkres_A.pdf "))).toBe("výkres_A.pdf");
    expect(filenameFromAnchor(anchor({ title: "Otevřít" }, "PDF"))).toBeNull();
  });

  it("samostatná stránka jen pro vlastní /api cesty", () => {
    const href = standaloneViewerHref("/api/jobs/files/abc", "x.step");
    expect(href).toBe("/view?src=%2Fapi%2Fjobs%2Ffiles%2Fabc&name=x.step");
    expect(safeViewerSrc("/api/jobs/files/abc")).toBe("/api/jobs/files/abc");
    expect(safeViewerSrc("/api/pdf/job/abc?type=nabidka")).toBe("/api/pdf/job/abc?type=nabidka");
    expect(safeViewerSrc("https://evil.example/x.pdf")).toBeNull();
    expect(safeViewerSrc("//evil.example/api/jobs/files/x")).toBeNull();
    expect(safeViewerSrc("/api/../login")).toBeNull();
    expect(safeViewerSrc("/api/search?q=x")).toBeNull();
    expect(safeViewerSrc(null)).toBeNull();
  });

  it("stažení pod původním názvem", () => {
    expect(downloadHref("/api/jobs/files/abc")).toBe("/api/jobs/files/abc?download=1");
    expect(downloadHref("/api/pdf/job/abc?type=faktura")).toBe("/api/pdf/job/abc?type=faktura&download=1");
    expect(downloadHref("/api/emails/attachment/abc")).toBe("/api/emails/attachment/abc");
  });
});
