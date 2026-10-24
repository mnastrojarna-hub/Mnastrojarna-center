import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { mkdirSync, writeFileSync, cpSync, rmSync, mkdtempSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { makeInvoicePdf, makeVectorDrawing, type SampleDrawing } from "./__fixtures__/samples";
import { anonymizePdf, type PdfAnonInput } from "./pdf-pipeline";
import { openPdf } from "./pdf-node";
import { checkPdfOutput, inkFraction, renderPageRaster, type Raster } from "./pdf-raster";
import { DEFAULT_REDACT, makeTerms, type RuleContext } from "./rules";
import { setFakeAnonHandler, resetFakeAnonCalls, fakeAnonCalls } from "./detect-ai";
import { applyManual } from "./regions";

/**
 * Vektorové PDF → rastr s vypálenými oblastmi → nové PDF (bez DB). Kontroluje se únik textu,
 * metadata, inkoust ponechaných údajů (číslo výkresu, materiál, kóty) a bílá místa smazaných.
 * ANON_SHOTS=<adresář> uloží náhledy před/po (PNG) pro vizuální kontrolu.
 */

const SHOTS = process.env.ANON_SHOTS || "";

const ctx = (terms: string[] = []): RuleContext => ({ terms: makeTerms(terms, "crm"), keepTerms: ["Mnástrojárna"], redact: { ...DEFAULT_REDACT } });

function input(bytes: Uint8Array, over: Partial<PdfAnonInput> = {}): PdfAnonInput {
  return {
    bytes, ctx: ctx(), ai: null, verifyPhotos: true, fillPdf: "white", fillPhoto: "white", maxDpi: 150, maxMpx: 40,
    pageFrom: 1, deadline: Date.now() + 240_000, ...over,
  };
}

async function render(pdf: Uint8Array, dpi = 150, page = 1): Promise<Raster> {
  const doc = await openPdf(pdf);
  const p = await doc.getPage(page);
  const r = await renderPageRaster(p, dpi / 72, false);
  await doc.destroy();
  return r;
}

/** Obal textu vzorku v px rastru (PDF počátek vlevo dole → rastr vlevo nahoře). */
function textBox(s: SampleDrawing, key: string, r: Raster) {
  const t = s.texts.find((x) => x.key === key)!;
  const k = r.width / s.width;
  const w = Math.max(10, t.text.length * t.size * 0.5);
  return { x: t.x * k, y: (s.height - t.y - t.size) * k, w: w * k, h: t.size * 1.2 * k };
}

async function savePng(name: string, r: Raster, crop?: { x: number; y: number; w: number; h: number }) {
  if (!SHOTS) return;
  const sharp = (await import("sharp")).default;
  mkdirSync(SHOTS, { recursive: true });
  let img = sharp(Buffer.from(r.data), { raw: { width: r.width, height: r.height, channels: r.channels } }).toColourspace(r.channels === 1 ? "b-w" : "srgb");
  if (crop) {
    const left = Math.max(0, Math.floor(crop.x)), top = Math.max(0, Math.floor(crop.y));
    img = img.extract({ left, top, width: Math.min(r.width - left, Math.floor(crop.w)), height: Math.min(r.height - top, Math.floor(crop.h)) });
  }
  else img = img.resize({ width: Math.min(1800, r.width) });
  writeFileSync(path.join(SHOTS, name), await img.png().toBuffer());
}

describe("anonymizace vektorového PDF", () => {
  let sample: SampleDrawing;
  beforeAll(async () => {
    sample = await makeVectorDrawing();
  });

  it("jen pravidla: smaže firmu, jména, kontakty, cestu, logo a pole formuláře; vše ostatní zůstane", async () => {
    const res = await anonymizePdf(input(sample.pdf, { ctx: ctx(["Strojmetal Kladno a.s."]) }));
    expect(res.failure).toBeNull();
    expect(res.isCad).toBe(true);
    const p = res.pages[0];
    expect(p.included).toBe(true);
    expect(p.inkFailed).toBe(false);
    const cats = new Set(p.regions.map((r) => r.category));
    for (const c of ["company", "person", "path", "contact", "logo"]) expect(cats.has(c as never), c).toBe(true);
    // žádný čitelný text v oblastech, jen hash
    expect(p.regions.every((r) => !("text" in r))).toBe(true);
    expect(p.texts.some((t) => t.text.includes("STROJMETAL"))).toBe(true);

    expect(res.partPdf).toBeTruthy();
    const out = res.partPdf!;
    const chk = await checkPdfOutput(out, [{ widthPt: sample.width, heightPt: sample.height }]);
    expect(chk.problems).toEqual([]);
    const raw = Buffer.from(out).toString("latin1");
    expect(raw).toContain("/DeviceGray");
    expect(raw).toContain("/Predictor 15");
    for (const word of ["STROJMETAL", "Novak", "Kladno", "SOLIDWORKS", "kusovnik"]) expect(raw.includes(word), word).toBe(false);

    const before = await render(sample.pdf);
    const after = await render(out);
    expect(after.width).toBe(before.width);
    // ponechané údaje mají inkoust, smazané jsou bílé
    for (const key of ["drawingNumber", "material", "dim1", "dim2", "note1", "rev", "drawnLabel", "drawnDate", "title", "note3"]) {
      expect(inkFraction(after, textBox(sample, key, after)), key).toBeGreaterThan(0.01);
    }
    for (const key of ["company", "drawnBy", "checkedBy", "address", "phone", "web", "path", "email", "formField"]) {
      expect(inkFraction(before, textBox(sample, key, before)), `${key} před`).toBeGreaterThan(0.005);
      expect(inkFraction(after, textBox(sample, key, after)), key).toBeLessThan(0.002);
    }
    const k = after.width / sample.width;
    const logoBox = { x: sample.logo.x * k, y: (sample.height - sample.logo.y - sample.logo.h) * k, w: sample.logo.w * k, h: sample.logo.h * k };
    expect(inkFraction(after, logoBox)).toBeLessThan(0.01);
    await savePng("vector-before.png", before);
    await savePng("vector-after.png", after);
    const tb = { x: (sample.width - 560) * k, y: (sample.height - 200) * k, w: 560 * k, h: 200 * k };
    await savePng("vector-titleblock-before.png", before, tb);
    await savePng("vector-titleblock-after.png", after, tb);
    await savePng("vector-plotstamp-after.png", after, { x: 0, y: (sample.height - 60) * k, w: 500 * k, h: 60 * k });
  }, 120_000);

  it("AI (fake): vektorové logo z křivek v rámu + kontrola souřadnic mimo obrázek", async () => {
    const prev = process.env.AI_FAKE_ANON;
    process.env.AI_FAKE_ANON = mkdtempSync(path.join(os.tmpdir(), "anon-fake-"));
    resetFakeAnonCalls();
    setFakeAnonHandler((req) => {
      if (req.call !== "vector") return null;
      const ov = req.images.find((i) => i.kind === "overview")!;
      const L = sample.vectorLogo;
      const box = { x: Math.round(L.x * ov.s) - 2, y: Math.round((sample.height - L.y - L.h) * ov.s) - 2, w: Math.round(L.w * ov.s) + 4, h: Math.round(L.h * ov.s) + 4 };
      return {
        pages: [{
          index: 1, isDrawing: true, textLayerTrustworthy: true, titleBlock: { img: 0, x: 0, y: 0, w: 10, h: 10 },
          redactLines: [], keep: [], customerStandard: [],
          boxes: [{ img: ov.index, ...box, category: "logo", reason: "logo", confidence: 0.95 }, { img: ov.index, x: ov.outW + 500, y: 0, w: 50, h: 50, category: "logo", reason: "logo", confidence: 0.5 }],
        }],
        confidence: 0.93,
      };
    });
    try {
      const res = await anonymizePdf(input(sample.pdf, { ai: { apiKey: "x", model: "claude-opus-5-5", deadline: Date.now() + 200_000, sha: "0".repeat(64) } }));
      expect(fakeAnonCalls("vector")).toBe(1);
      expect(res.aiUsed).toBe(true);
      expect(res.warnings.some((w) => w.code === "coords_out_of_image")).toBe(true);
      const after = await render(res.partPdf!);
      const k = after.width / sample.width;
      const L = sample.vectorLogo;
      expect(inkFraction(after, { x: L.x * k, y: (sample.height - L.y - L.h) * k, w: L.w * k, h: L.h * k })).toBeLessThan(0.01);
      expect(res.cache?.vector[1]).toBeTruthy();
    } finally {
      setFakeAnonHandler(null);
      if (prev === undefined) delete process.env.AI_FAKE_ANON;
      else process.env.AI_FAKE_ANON = prev;
    }
  }, 120_000);

  it("ruční zrušení zásahu (removed) má přednost i před pravidlem", async () => {
    const first = await anonymizePdf(input(sample.pdf));
    const company = first.pages[0].regions.find((r) => r.category === "company")!;
    const res = await anonymizePdf(input(sample.pdf, { manual: [{ ...company, id: company.id, manual: "removed" }] }));
    expect(res.pages[0].regions.some((r) => r.id === company.id)).toBe(false);
    const after = await render(res.partPdf!);
    expect(inkFraction(after, textBox(sample, "company", after))).toBeGreaterThan(0.01);
    expect(applyManual(first.pages[0].regions, [{ ...company, manual: "removed" }]).length).toBe(first.pages[0].regions.length - 1);
  }, 120_000);

  it("smíšené PDF: dopis (není výkres) se vynechá, výkresy zůstanou", async () => {
    const mixed = await makeVectorDrawing({ extraPages: ["letter", "drawing"] });
    const prev = process.env.AI_FAKE_ANON;
    process.env.AI_FAKE_ANON = mkdtempSync(path.join(os.tmpdir(), "anon-fake-"));
    setFakeAnonHandler((req) => req.call === "vector" ? {
      pages: [1, 2, 3].map((i) => ({ index: i, isDrawing: i !== 1, textLayerTrustworthy: true, titleBlock: { img: 0, x: 0, y: 0, w: 0, h: 0 }, redactLines: [], boxes: [], keep: [], customerStandard: [] })),
      confidence: 0.95,
    } : null);
    try {
      const res = await anonymizePdf(input(mixed.pdf, { ai: { apiKey: "x", model: "claude-opus-5-5", deadline: Date.now() + 200_000, sha: "1".repeat(64) } }));
      expect(res.pages.filter((p) => p.included).map((p) => p.page)).toEqual([2, 3]);
      expect(res.pages.find((p) => p.page === 1)?.why).toBe("not_drawing");
      const doc = await openPdf(res.partPdf!);
      expect(doc.numPages).toBe(2);
      await doc.destroy();
    } finally {
      setFakeAnonHandler(null);
      if (prev === undefined) delete process.env.AI_FAKE_ANON;
      else process.env.AI_FAKE_ANON = prev;
    }
  }, 120_000);

  it("faktura bez AI: není výkres podle pravidel? → zahrnuta (bez AI nelze rozhodnout); s AI isDrawing=false → vynechána", async () => {
    const inv = await makeInvoicePdf();
    const prev = process.env.AI_FAKE_ANON;
    process.env.AI_FAKE_ANON = mkdtempSync(path.join(os.tmpdir(), "anon-fake-"));
    setFakeAnonHandler((req) => req.call === "vector" ? { pages: [{ index: 1, isDrawing: false, textLayerTrustworthy: true, titleBlock: { img: 0, x: 0, y: 0, w: 0, h: 0 }, redactLines: [], boxes: [], keep: [], customerStandard: [] }], confidence: 0.97 } : null);
    try {
      const res = await anonymizePdf(input(inv, { ai: { apiKey: "x", model: "claude-opus-5-5", deadline: Date.now() + 200_000, sha: "2".repeat(64) } }));
      expect(res.pages[0].included).toBe(false);
      expect(res.partPdf).toBeNull();
    } finally {
      setFakeAnonHandler(null);
      if (prev === undefined) delete process.env.AI_FAKE_ANON;
      else process.env.AI_FAKE_ANON = prev;
    }
  }, 60_000);
});

describe("popisek a jméno v jedné textové položce", () => {
  it("Kreslil: J. Novák → popisek zůstane celý, jméno zmizí; zbytky se nehledají v ponechané části", async () => {
    const { PDFDocument, StandardFonts } = await import("pdf-lib");
    const doc = await PDFDocument.create();
    const f = await doc.embedFont(StandardFonts.Helvetica);
    const p = doc.addPage([842, 595]);
    p.drawText("Kreslil: J. Novák", { x: 500, y: 100, size: 10, font: f });
    p.drawText("Schválil: Ing. Dvorak", { x: 500, y: 80, size: 10, font: f });
    p.drawText("Číslo výkresu: D-1".replace("Č", "C").replace("í", "i").replace("ý", "y"), { x: 500, y: 60, size: 10, font: f });
    const pdf = await doc.save();
    const res = await anonymizePdf(input(pdf, { maxDpi: 200 }));
    expect(res.pages[0].residue).toBe(false);
    const after = await render(res.partPdf!, 200);
    const k = 200 / 72;
    const lw = f.widthOfTextAtSize("Kreslil:", 10), nw = f.widthOfTextAtSize("J. Novák", 10), sp = f.widthOfTextAtSize("Kreslil: ", 10);
    const label = { x: 500 * k, y: (595 - 100 - 9) * k, w: lw * k, h: 11 * k };
    const name = { x: (500 + sp) * k, y: (595 - 100 - 9) * k, w: nw * k, h: 11 * k };
    // každý znak popisku má inkoust (poslední „l:" nesmí být useknuté)
    const tail = { x: (500 + f.widthOfTextAtSize("Kresli", 10)) * k, y: label.y, w: (lw - f.widthOfTextAtSize("Kresli", 10)) * k, h: label.h };
    expect(inkFraction(after, label)).toBeGreaterThan(0.03);
    expect(inkFraction(after, tail)).toBeGreaterThan(0.03);
    expect(inkFraction(after, name)).toBeLessThan(0.002);
    await savePng("label-after.png", after, { x: 480 * k, y: (595 - 125) * k, w: 300 * k, h: 80 * k });
  }, 60_000);
});

describe("chybějící / rozbitá písma pdf.js", () => {
  let dir = "";
  beforeAll(() => {
    dir = mkdtempSync(path.join(os.tmpdir(), "pdfjs-broken-"));
    const src = path.join(process.cwd(), "node_modules", "pdfjs-dist");
    cpSync(path.join(src, "cmaps"), path.join(dir, "cmaps"), { recursive: true });
    mkdirSync(path.join(dir, "standard_fonts"));
  });
  afterAll(() => {
    delete process.env.ANON_PDFJS_DIR;
    rmSync(dir, { recursive: true, force: true });
  });

  it("bez souborů písem → selže start-up kontrola (nikdy tiše bez textu)", async () => {
    process.env.ANON_PDFJS_DIR = dir;
    const s = await makeVectorDrawing({ withForm: false, withAttachment: false });
    const res = await anonymizePdf(input(s.pdf));
    expect(res.failure).toMatch(/fonty pdf\.js/);
    delete process.env.ANON_PDFJS_DIR;
  }, 60_000);

  it("rozbitý soubor písma → kontrola inkoustu → failed „Písmo se nevykreslilo“", async () => {
    // písmo existuje, ale je nečitelné → pdf.js text nevykreslí
    for (const f of ["FoxitSerif.pfb", "LiberationSans-Regular.ttf", "LiberationSans-Bold.ttf", "LiberationSans-Italic.ttf", "LiberationSans-BoldItalic.ttf"]) {
      writeFileSync(path.join(dir, "standard_fonts", f), Buffer.from("broken"));
    }
    process.env.ANON_PDFJS_DIR = dir;
    const s = await makeVectorDrawing({ withForm: false, withAttachment: false });
    const res = await anonymizePdf(input(s.pdf));
    delete process.env.ANON_PDFJS_DIR;
    expect(res.failure).toMatch(/Písmo se nevykreslilo/);
    expect(res.pages[0].inkFailed).toBe(true);
  }, 60_000);
});
