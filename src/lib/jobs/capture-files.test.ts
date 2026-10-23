import { describe, it, expect } from "vitest";
import { PDFDocument, PDFName } from "pdf-lib";
import { strToU8, zipSync } from "fflate";
import {
  decodeZipName, docAiInput, extractPdfPages, imageDimensions, imagesToPdf, pdfInfo, unzipLimited, ZIP_MAX_ENTRIES,
} from "./capture-files";
import { cadFormatOf, stepPartNumber } from "./capture-batch";
import type { BatchFile, BatchPage } from "./capture-batch-types";

async function pdf(pages: number): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  for (let i = 0; i < pages; i++) doc.addPage([200 + i, 300]);
  return doc.save();
}

/** Minimální PNG (IHDR) daných rozměrů. */
function png(w: number, h: number): Uint8Array {
  const b = new Uint8Array(33);
  b.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13, 0x49, 0x48, 0x44, 0x52]);
  new DataView(b.buffer).setUint32(16, w);
  new DataView(b.buffer).setUint32(20, h);
  return b;
}

/** JPEG s APP0 a SOF0 segmentem. */
function jpeg(w: number, h: number): Uint8Array {
  const app0 = [0xff, 0xe0, 0x00, 0x10, ...Array(14).fill(0)];
  const sof = [0xff, 0xc0, 0x00, 0x11, 0x08, h >> 8, h & 0xff, w >> 8, w & 0xff, 0x03, ...Array(9).fill(0)];
  return new Uint8Array([0xff, 0xd8, ...app0, ...sof, 0xff, 0xd9]);
}

describe("imageDimensions", () => {
  it("PNG, JPEG, WebP (VP8X)", () => {
    expect(imageDimensions(png(1280, 960))).toEqual({ width: 1280, height: 960 });
    expect(imageDimensions(jpeg(2400, 1800))).toEqual({ width: 2400, height: 1800 });
    const webp = new Uint8Array(30);
    webp.set([0x52, 0x49, 0x46, 0x46, 0, 0, 0, 0, 0x57, 0x45, 0x42, 0x50, 0x56, 0x50, 0x38, 0x58]);
    webp[24] = 0xff; webp[25] = 0x04; webp[27] = 0xff; webp[28] = 0x02; // 1280 × 768
    expect(imageDimensions(webp)).toEqual({ width: 1280, height: 768 });
    expect(imageDimensions(new Uint8Array([1, 2, 3]))).toBeNull();
  });
});

describe("PDF", () => {
  it("počet stran, řez a sloučení fotek", async () => {
    const bytes = await pdf(4);
    expect(await pdfInfo(bytes)).toEqual({ pageCount: 4, splittable: true, reason: null });
    const cut = await extractPdfPages(bytes, [3, 4]);
    const doc = await PDFDocument.load(cut);
    expect(doc.getPageCount()).toBe(2);
    expect(doc.getPage(0).getWidth()).toBe(202);
    const merged = await imagesToPdf([{ bytes: realPng(), mime: "image/png" }, { bytes: realPng(), mime: "image/png" }]);
    expect(merged).not.toBeNull();
    expect((await PDFDocument.load(merged!)).getPageCount()).toBe(2);
    expect(await imagesToPdf([{ bytes: new Uint8Array(4), mime: "image/webp" }])).toBeNull();
  });
  it("zaheslované a poškozené PDF → nedělitelné, bez AI", async () => {
    const doc = await PDFDocument.create();
    doc.addPage();
    doc.context.trailerInfo.Encrypt = doc.context.obj({ Filter: PDFName.of("Standard") });
    const enc = await doc.save();
    expect(await pdfInfo(enc)).toMatchObject({ splittable: false, reason: "PDF je zaheslované — vyplň ručně." });
    expect(await pdfInfo(new TextEncoder().encode("%PDF-1.7 rozbité"))).toMatchObject({ splittable: false, reason: "PDF je poškozené — vyplň ručně." });
  });
  it("vstup vytěžení: jen strany dokladu, vyříznuté do nového PDF", async () => {
    const bytes = await pdf(3);
    const f: BatchFile = {
      id: "f1", path: "x", filename: "d.pdf", mimeType: "application/pdf", size: bytes.length, pageCount: 3, sniffedMime: "application/pdf",
      format: null, fromZip: null, splittable: true, aiReadable: true, aiSkipReason: null, sha256: "",
    };
    const pages: BatchPage[] = [1, 2, 3].map((n) => ({ id: `p${n}`, fileId: "f1", page: n, source: "pdf_page", label: "", aiLabel: "", duplicateOf: null }));
    const res = await docAiInput([f], pages, ["p2", "p3"], async () => bytes);
    expect(res.files).toHaveLength(1);
    const part = await PDFDocument.load(Buffer.from(res.files[0].dataBase64, "base64"));
    expect(part.getPageCount()).toBe(2);
    expect(res.skipped).toBe(0);
  });
});

/** Skutečné 1×1 PNG (pro pdf-lib embedPng). */
function realPng(): Uint8Array {
  return Uint8Array.from(Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==", "base64"));
}

describe("ZIP", () => {
  it("rozbalí položky (bez __MACOSX a skrytých), názvy UTF-8", () => {
    const zip = zipSync({
      "výkres 4711-02.pdf": strToU8("%PDF-1.4"),
      "modely/4711-02.step": strToU8("ISO-10303-21;"),
      "__MACOSX/._x": strToU8("x"),
      ".DS_Store": strToU8("x"),
      "adr/": new Uint8Array(0),
    });
    const r = unzipLimited(zip);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.entries.map((e) => e.name).sort()).toEqual(["4711-02.step", "výkres 4711-02.pdf"]);
  });
  it("> 40 položek → celý ZIP (většina CAD = model)", () => {
    const files: Record<string, Uint8Array> = {};
    for (let i = 0; i <= ZIP_MAX_ENTRIES; i++) files[`d${i}.step`] = strToU8("ISO-10303-21;");
    const r = unzipLimited(zipSync(files));
    expect(r).toMatchObject({ ok: false, cadMajority: true, majorityFormat: "STEP" });
  });
  it("nad limit velikosti → celý ZIP; poškozený ZIP → celý", () => {
    const big = zipSync({ "velky.bin": new Uint8Array(51 * 1024 * 1024) });
    expect(unzipLimited(big)).toMatchObject({ ok: false, cadMajority: false });
    expect(unzipLimited(new Uint8Array([0x50, 0x4b, 0x03, 0x04, 1, 2]))).toMatchObject({ ok: false });
  });
  it("názvy z Průzkumníka Windows (CP852) i platné UTF-8", () => {
    expect(decodeZipName("vìkres.pdf")).toBe("výkres.pdf");
    expect(decodeZipName(String.fromCharCode(0xb5, 0xde, 0x9f, 0xac) + ".txt")).toBe("ÁŮčČ.txt");
    const utf8AsLatin1 = String.fromCharCode(...new TextEncoder().encode("Příruba.pdf"));
    expect(decodeZipName(utf8AsLatin1)).toBe("Příruba.pdf");
    expect(decodeZipName("plain.step")).toBe("plain.step");
    expect(decodeZipName(new TextEncoder().encode("výkres.pdf"), true)).toBe("výkres.pdf");
    expect(decodeZipName(Uint8Array.from([0x76, 0xec, 0x6b, 0x72, 0x65, 0x73]), false)).toBe("výkres");
  });
});

describe("STEP hlavička", () => {
  it("formát podle obsahu a číslo dílu", () => {
    const head = "ISO-10303-21;\nHEADER;\nFILE_NAME('Part1.stp','2026-10-20',('x'),(''),'','','');\nENDSEC;\nDATA;\n#10=PRODUCT('4711-02','Upínací deska','',(#9));";
    expect(cadFormatOf("Part1.stp", head)).toBe("STEP");
    expect(stepPartNumber(head)).toBe("4711-02");
  });
});

describe("CP852 tabulka", () => {
  it("každý bajt 0x80–0xFF = právě jeden znak", () => {
    const all = decodeZipName(Uint8Array.from({ length: 128 }, (_, i) => 0x80 + i));
    expect([...all]).toHaveLength(128);
    expect(all.endsWith("\u00a0")).toBe(true);
  });
});
