import { describe, expect, it } from "vitest";
import {
  isPrintMessage, isRasterPreview, orientationOf, pageRenderScale, paperLabel, printabilityOf, printModeFor, printPageHref,
  rasterFallbackSrc, rasterPageUrl, safePrintSrc,
} from "./print-links";

const IPHONE = "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1";
const ANDROID = "Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Mobile Safari/537.36";
const MAC_SAFARI = "Mozilla/5.0 (Macintosh; Intel Mac OS X 14_5) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Safari/605.1.15";
const CHROME = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36";
const EDGE = `${CHROME} Edg/130.0.0.0`;
const FIREFOX = "Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:132.0) Gecko/20100101 Firefox/132.0";

describe("safePrintSrc — jen vlastní routy dokumentů (žádný nový přístup)", () => {
  it("povolí routy prohlížeče, vygenerovaná PDF a anonymní kopii pro dodavatele", () => {
    expect(safePrintSrc("/api/jobs/files/abc")).toBe("/api/jobs/files/abc");
    expect(safePrintSrc("/api/pdf/job/j1?type=nabidka&quoteId=q1")).toBe("/api/pdf/job/j1?type=nabidka&quoteId=q1");
    expect(safePrintSrc("/api/pdf/purchase-order/p1")).toBe("/api/pdf/purchase-order/p1");
    expect(safePrintSrc("/api/pdf/faktura")).toBe("/api/pdf/faktura");
    expect(safePrintSrc("/api/emails/attachment/a1")).toBe("/api/emails/attachment/a1");
    expect(safePrintSrc("/api/supplier-invoices/files/f1")).toBe("/api/supplier-invoices/files/f1");
    expect(safePrintSrc("/api/drawings/anonymize/f1/download?table=drawings")).toBe("/api/drawings/anonymize/f1/download?table=drawings");
    expect(safePrintSrc("/api/drawings/anonymize/f1/preview?table=drawings")).toBe("/api/drawings/anonymize/f1/preview?table=drawings");
  });

  it("zahodí download=1 (tiskne se obsah) a odmítne originál pro dodavatele", () => {
    expect(safePrintSrc("/api/jobs/files/abc?download=1")).toBe("/api/jobs/files/abc");
    expect(safePrintSrc("/api/pdf/job/j1?type=faktura&download=1")).toBe("/api/pdf/job/j1?type=faktura");
    expect(safePrintSrc("/api/drawings/anonymize/f1/download?original=1")).toBeNull();
  });

  it("cizí adresy, jiné routy a triky s cestou neprojdou", () => {
    for (const bad of [
      null, undefined, "", "https://evil.example/api/jobs/files/x", "//evil.example/api/jobs/files/x", "/api/jobs/files/x/../../users",
      "/api/users", "/api/drawings/anonymize/f1/approve", "/api/jobs/files/", "javascript:alert(1)", "/api\\jobs/files/x",
      "/api/supplier-invoices/upload", "/orders/1",
    ]) {
      expect(safePrintSrc(bad as string | null | undefined), String(bad)).toBeNull();
    }
  });
});

describe("adresa tiskové stránky a náhledy po stranách", () => {
  it("printPageHref zakóduje zdroj, název a režim rámu", () => {
    const h = printPageHref("/api/pdf/job/j1?type=nabidka&quoteId=q1", { name: "Nabídka N-1.pdf", embed: true });
    const u = new URL(h, "https://x.test");
    expect(u.pathname).toBe("/print");
    expect(u.searchParams.get("src")).toBe("/api/pdf/job/j1?type=nabidka&quoteId=q1");
    expect(u.searchParams.get("name")).toBe("Nabídka N-1.pdf");
    expect(u.searchParams.get("embed")).toBe("1");
    expect(printPageHref("/api/jobs/files/a")).toBe("/print?src=%2Fapi%2Fjobs%2Ffiles%2Fa");
  });

  it("HEIC / TIFF ze zakázky → serverový PNG náhled (stejná kontrola práv), strany ?page=n", () => {
    expect(rasterFallbackSrc("/api/jobs/files/f9")).toBe("/api/drawings/anonymize/f9/preview?table=job_files");
    expect(rasterFallbackSrc("/api/emails/attachment/a1")).toBeNull();
    expect(isRasterPreview("/api/drawings/anonymize/f9/preview?table=drawings")).toBe(true);
    expect(isRasterPreview("/api/drawings/anonymize/f9/download")).toBe(false);
    expect(rasterPageUrl("/api/drawings/anonymize/f9/preview?table=drawings", 3, 1800)).toBe("/api/drawings/anonymize/f9/preview?table=drawings&page=3&w=1800");
  });
});

describe("co jde vytisknout", () => {
  it("PDF, obrázky, neznámá přípona ano; DXF / 3D / Word s nápovědou ne", () => {
    for (const ok of ["a.pdf", "b.JPG", "c.png", "d.webp", "e.heic", "f.tif", "g.txt", null, "bez-pripony"]) expect(printabilityOf(ok).ok, String(ok)).toBe(true);
    expect(printabilityOf("vykres.dxf")).toEqual({ ok: false, hint: "DXF vytiskneš po uložení jako PDF" });
    expect(printabilityOf("vykres.DWG").ok).toBe(false);
    expect(printabilityOf("dil.step")).toMatchObject({ ok: false, hint: expect.stringContaining("Tisknout pohled") });
    expect(printabilityOf("dil.stl").ok).toBe(false);
    expect(printabilityOf("nabidka.docx").ok).toBe(false);
    expect(printabilityOf("vykresy.zip").ok).toBe(false);
  });
});

describe("rozlišení, papír a orientace", () => {
  it("A4 při 200 dpi; obří list (A0) omezený počtem pixelů", () => {
    expect(pageRenderScale(595, 842, 200, 16e6)).toBeCloseTo(200 / 72, 5);
    const a0 = pageRenderScale(2384, 3370, 200, 16e6);
    expect(2384 * 3370 * a0 * a0).toBeLessThanOrEqual(16e6 + 1);
    expect(pageRenderScale(595, 842, 150, 8e6)).toBeCloseTo(150 / 72, 5);
  });

  it("orientace a název papíru podle rozměru strany", () => {
    expect(orientationOf(595, 842)).toBe("portrait");
    expect(orientationOf(1191, 842)).toBe("landscape");
    expect(paperLabel(595, 842)).toBe("A4 na výšku");
    expect(paperLabel(1191, 842)).toBe("A3 na šířku");
    expect(paperLabel(1684, 2384)).toBe("A1 na výšku");
    expect(paperLabel(400, 400)).toBe("141 × 141 mm");
  });
});

describe("způsob tisku podle zařízení", () => {
  it("telefon / tablet → tisková stránka, Safari na Macu → karta, ostatní počítače → skrytý rám", () => {
    expect(printModeFor(IPHONE)).toBe("page");
    expect(printModeFor(ANDROID)).toBe("page");
    expect(printModeFor(MAC_SAFARI, 5)).toBe("page"); // iPadOS se hlásí jako Mac s dotykem
    expect(printModeFor(MAC_SAFARI)).toBe("tab");
    expect(printModeFor(CHROME)).toBe("iframe");
    expect(printModeFor(EDGE)).toBe("iframe");
    expect(printModeFor(FIREFOX)).toBe("iframe");
  });

  it("zprávy z tiskového rámu", () => {
    expect(isPrintMessage({ source: "mn-print", type: "ready", pages: 2 })).toBe(true);
    expect(isPrintMessage({ source: "jiny", type: "ready" })).toBe(false);
    expect(isPrintMessage(null)).toBe(false);
  });
});
