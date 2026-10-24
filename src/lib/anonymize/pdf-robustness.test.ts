import { describe, it, expect } from "vitest";
import { PDFDocument, StandardFonts, rgb } from "pdf-lib";
import { makeVectorDrawing, A3 } from "./__fixtures__/samples";
import { anonymizePdf, type PdfAnonInput } from "./pdf-pipeline";
import { openPdf } from "./pdf-node";
import { contrastInkFraction, inkFraction, renderPageRaster, type Raster } from "./pdf-raster";
import { computeZones } from "./pdf-text";
import { DEFAULT_REDACT, makeTerms, ruleLine, type RuleContext } from "./rules";
import { decideAnonStatus } from "./decide";

/**
 * Odolnost jádra (nálezy ověřovatele jádra):
 *  1) neviditelný / bílý / zakrytý / žlutý / světle šedý text nesmí vést na falešné „Písmo se
 *     nevykreslilo" — chybějící písma = většina položek nebo keep pole bez inkoustu; inkoust se měří
 *     kontrastem proti pozadí; ojedinělé položky bez inkoustu → varování (ke kontrole),
 *  2) plot stamp složený z oddělených textových položek se smaže celý (i jméno uživatele),
 *  3) řádek firmy nad razítkem výš než popisky + 12 mm („Zákazník: ACME Forge GmbH") se smaže.
 */

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

/** Obdélník textu (PDF vlevo dole → rastr vlevo nahoře). */
function box(x: number, y: number, w: number, size: number, r: Raster, H = A3[1], W = A3[0]) {
  const k = r.width / W;
  return { x: x * k, y: (H - y - size) * k, w: w * k, h: size * 1.25 * k };
}

describe("kontrola inkoustu: skrytý a světlý text není chybějící písmo", () => {
  it("bílý, zakrytý, neviditelný, žlutý a světle šedý text → bez selhání; skrytý → varování ke kontrole", async () => {
    const s = await makeVectorDrawing({ withForm: false, withAttachment: false });
    const doc = await PDFDocument.load(s.pdf);
    const helv = await doc.embedFont(StandardFonts.Helvetica);
    const page = doc.getPage(0);
    // skryté (bez inkoustu): bílý text, text zakrytý bílým obdélníkem, průhledný text (opacity 0)
    page.drawText("Interni poznamka 1", { x: 700, y: 620, size: 9, font: helv, color: rgb(1, 1, 1) });
    page.drawText("Stara kota 55", { x: 700, y: 600, size: 9, font: helv, color: rgb(0, 0, 0) });
    page.drawRectangle({ x: 695, y: 596, width: 120, height: 16, color: rgb(1, 1, 1) });
    page.drawText("Skryta vrstva 77", { x: 700, y: 580, size: 9, font: helv, opacity: 0 });
    // světlé, ale viditelné (kontrast proti pozadí): žlutá a světle šedá
    page.drawText("Zluta poznamka 12", { x: 700, y: 560, size: 9, font: helv, color: rgb(1, 1, 0) });
    page.drawText("Svetle seda 34", { x: 700, y: 540, size: 9, font: helv, color: rgb(0.82, 0.82, 0.82) });
    const pdf = await doc.save();

    const res = await anonymizePdf(input(pdf));
    expect(res.failure).toBeNull();
    expect(res.pages[0].inkFailed).toBe(false);
    expect(res.partPdf).toBeTruthy();
    const hidden = res.warnings.filter((w) => w.code === "hidden_text");
    expect(hidden.length).toBe(1);
    expect(hidden[0].message).toMatch(/nevykreslil/);
    // varování znamená „ke kontrole", nikdy tiché done
    const d = decideAnonStatus({
      mode: "full", method: "raster_pdf", aiUsed: true, modelFallback: false, confidence: 0.95, ruleHitsCovered: true, outputChecksPassed: true,
      verifyClean: null, verifyKeepPresent: null, pxPerMm: null, isPhoto: false, hasMaster: false, warnings: res.warnings,
      customerStandard: false, termInKeep: false, titleBlockFound: true,
    });
    expect(d.status).toBe("review");

    // žlutý a světle šedý text zůstal ve výstupu viditelný (kontrast proti pozadí)
    const after = await render(res.partPdf!);
    expect(contrastInkFraction(after, box(700, 560, 80, 9, after))).toBeGreaterThan(0.01);
    expect(contrastInkFraction(after, box(700, 540, 70, 9, after))).toBeGreaterThan(0.01);
    // klasický práh tmavých pixelů by žlutý text nenašel (proto měření kontrastu)
    const before = await render(pdf);
    expect(inkFraction(before, box(700, 560, 80, 9, before))).toBeLessThan(0.005);
  }, 60_000);

  it("kontrast proti pozadí: bílý text na tmavém pruhu má inkoust, prázdné místo ne", async () => {
    const doc = await PDFDocument.create();
    const helv = await doc.embedFont(StandardFonts.Helvetica);
    const p = doc.addPage([400, 200]);
    p.drawRectangle({ x: 20, y: 120, width: 300, height: 40, color: rgb(0.15, 0.14, 0.15) });
    p.drawText("BILY NA TMAVEM 123", { x: 30, y: 134, size: 14, font: helv, color: rgb(1, 1, 1) });
    const r = await render(await doc.save(), 150);
    const k = r.width / 400;
    const at = (x: number, y: number, w: number, h: number) => ({ x: x * k, y: (200 - y - h) * k, w: w * k, h: h * k });
    expect(contrastInkFraction(r, at(30, 132, 160, 16))).toBeGreaterThan(0.03);
    expect(contrastInkFraction(r, at(30, 40, 160, 16))).toBe(0);
  }, 30_000);
});

describe("plot stamp z oddělených položek", () => {
  async function stampPdf(parts: { s: string; x: number }[]) {
    const s = await makeVectorDrawing({ withForm: false, withAttachment: false });
    const doc = await PDFDocument.load(s.pdf);
    const helv = await doc.embedFont(StandardFonts.Helvetica);
    const page = doc.getPage(0);
    for (const p of parts) page.drawText(p.s, { x: p.x, y: 790, size: 6, font: helv, color: rgb(0, 0, 0) });
    return { pdf: await doc.save(), helv };
  }

  it("cesta · datum · uživatel jako tři položky daleko od sebe → smaže se celý řádek včetně jména", async () => {
    const parts = [
      { s: "\\\\nas01\\cad\\Zakazky\\2026\\D-5555.dwg", x: 60 },
      { s: "24.10.2026 08:15", x: 330 },
      { s: "jnovotny", x: 470 },
    ];
    const { pdf, helv } = await stampPdf(parts);
    const res = await anonymizePdf(input(pdf));
    expect(res.failure).toBeNull();
    const texts = res.pages[0].texts.map((t) => t.text).join(" | ");
    expect(texts).toContain("jnovotny");
    expect(texts).toContain("24.10.2026 08:15");
    const after = await render(res.partPdf!);
    for (const p of parts) {
      expect(inkFraction(after, box(p.x, 790, helv.widthOfTextAtSize(p.s, 6), 6, after)), p.s).toBeLessThan(0.002);
    }
  }, 60_000);

  it("jméno PŘED cestou (pořadí uživatel · datum · cesta) se smaže také", async () => {
    const parts = [
      { s: "novak", x: 60 },
      { s: "23.10.2026 14:05", x: 160 },
      { s: "C:\\Projekty\\Vykresy\\hridel.SLDDRW", x: 300 },
    ];
    const { pdf, helv } = await stampPdf(parts);
    const res = await anonymizePdf(input(pdf));
    expect(res.failure).toBeNull();
    const after = await render(res.partPdf!);
    for (const p of parts) {
      expect(inkFraction(after, box(p.x, 790, helv.widthOfTextAtSize(p.s, 6), 6, after)), p.s).toBeLessThan(0.002);
    }
  }, 60_000);

  it("cesta v poznámce těla nesmaže kótu na stejném účaří", async () => {
    const s = await makeVectorDrawing({ withForm: false, withAttachment: false });
    const doc = await PDFDocument.load(s.pdf);
    const helv = await doc.embedFont(StandardFonts.Helvetica);
    const page = doc.getPage(0);
    page.drawText("Viz C:\\Data\\vzor.dwg", { x: 60, y: 450, size: 8, font: helv });
    page.drawText("120 ±0,2", { x: 330, y: 450, size: 8, font: helv });
    const res = await anonymizePdf(input(await doc.save()));
    expect(res.failure).toBeNull();
    const after = await render(res.partPdf!);
    expect(inkFraction(after, box(330, 450, helv.widthOfTextAtSize("120 ±0,2", 8), 8, after))).toBeGreaterThan(0.01);
  }, 60_000);

  it("cesta v buňce razítka nesmaže sousední buňky na stejném účaří (materiál zůstane)", async () => {
    const s = await makeVectorDrawing({ withForm: false, withAttachment: false });
    const doc = await PDFDocument.load(s.pdf);
    const helv = await doc.embedFont(StandardFonts.Helvetica);
    const page = doc.getPage(0);
    const tbx = A3[0] - 20 - 520;
    // v razítku na řádku „Material" (y = tby + 92) přidat cestu do levé buňky místo názvu? → nový řádek pod ním
    page.drawText("Soubor: D:\\CAD\\hridel.dwg", { x: tbx + 5, y: 20 + 72, size: 6, font: helv });
    page.drawText("Povrch: Zn 8 um", { x: tbx + 265, y: 20 + 72, size: 6, font: helv });
    const res = await anonymizePdf(input(await doc.save()));
    expect(res.failure).toBeNull();
    const after = await render(res.partPdf!);
    expect(inkFraction(after, box(tbx + 265, 92, helv.widthOfTextAtSize("Povrch: Zn 8 um", 6), 6, after))).toBeGreaterThan(0.01);
    expect(inkFraction(after, box(tbx + 5 + helv.widthOfTextAtSize("Soubor: ", 6), 92, helv.widthOfTextAtSize("D:\\CAD\\hridel.dwg", 6), 6, after))).toBeLessThan(0.002);
  }, 60_000);
});

describe("řádek firmy vysoko nad popisky razítka", () => {
  it("computeZones: řádek „Zákazník:“ nad razítkem (24 mm nad popisky) patří do razítka", () => {
    const W = A3[0], H = A3[1];
    // y dolů od horního okraje (viewport)
    const lines = [
      { text: "Kreslil: J. Novák", box: { x: 680, y: 700, w: 80, h: 8 } },
      { text: "Material: 1.4301", box: { x: 940, y: 730, w: 90, h: 8 } },
      { text: "Cislo vykresu: D-1", box: { x: 680, y: 790, w: 90, h: 8 } },
      { text: "Zákazník: ACME Forge GmbH", box: { x: 690, y: 630, w: 160, h: 10 } },
    ];
    const z = computeZones(lines, W, H);
    expect(z.titleBlock).toBeTruthy();
    const tb = z.titleBlock!;
    expect(tb.y).toBeLessThanOrEqual(630);
    // nesahá přes celou stránku (jen o řádek firmy výš)
    expect(tb.y).toBeGreaterThan(0.5 * H);
  });

  it("ruleLine: „Zákazník: ACME Forge GmbH“ mimo razítko → firma (popisek s právní formou)", () => {
    const r = ruleLine("Zákazník: ACME Forge GmbH", "body", ctx());
    const hit = r.hits.find((h) => h.category === "company");
    expect(hit).toBeTruthy();
    expect("Zákazník: ACME Forge GmbH".slice(hit!.start, hit!.end)).toBe("ACME Forge GmbH");
    // dodavatel ložiska v poznámce zůstává kandidátem (ne pravidlo)
    expect(ruleLine("Lozisko SKF 6205-2RS, Bosch Rexroth AG", "body", ctx()).hits.some((h) => h.category === "company")).toBe(false);
  });

  it("PDF: firma 24 mm nad popisky razítka se smaže, popisek zůstane", async () => {
    const s = await makeVectorDrawing({ withForm: false, withAttachment: false });
    const doc = await PDFDocument.load(s.pdf);
    const helv = await doc.embedFont(StandardFonts.Helvetica);
    const page = doc.getPage(0);
    const tbx = A3[0] - 20 - 520;
    const y = 20 + 142 + 68; // ~24 mm nad horním řádkem popisků
    page.drawText("Zakaznik:", { x: tbx + 5, y, size: 8, font: helv });
    page.drawText("ACME Forge GmbH", { x: tbx + 60, y, size: 8, font: helv });
    const res = await anonymizePdf(input(await doc.save()));
    expect(res.failure).toBeNull();
    expect(res.pages[0].regions.some((r) => r.category === "company")).toBe(true);
    const after = await render(res.partPdf!);
    expect(inkFraction(after, box(tbx + 60, y, helv.widthOfTextAtSize("ACME Forge GmbH", 8), 8, after))).toBeLessThan(0.002);
    expect(inkFraction(after, box(tbx + 5, y, helv.widthOfTextAtSize("Zakaznik:", 8), 8, after))).toBeGreaterThan(0.01);
  }, 60_000);
});

describe("plot stamp nesmí spolknout technický text na stejném účaří (negativní)", () => {
  it("tělo: cesta k modelu + výrobní poznámky na stejném účaří → poznámky zůstanou", async () => {
    const s = await makeVectorDrawing({ withForm: false, withAttachment: false });
    const doc = await PDFDocument.load(s.pdf);
    const helv = await doc.embedFont(StandardFonts.Helvetica);
    const page = doc.getPage(0);
    const notes = ["Odjehlit vsechny hrany", "Povrch: zinkovat galvanicky", "Svarovat dle WPS", "Dodat s atestem 3.1"];
    page.drawText("Model: C:\\CAD\\hridel.sldprt", { x: 60, y: 560, size: 8, font: helv });
    notes.forEach((n, i) => page.drawText(n, { x: 260 + i * 160, y: 560, size: 8, font: helv }));
    const res = await anonymizePdf(input(await doc.save()));
    expect(res.failure).toBeNull();
    const after = await render(res.partPdf!);
    notes.forEach((n, i) => {
      expect(inkFraction(after, box(260 + i * 160, 560, helv.widthOfTextAtSize(n, 8), 8, after)), n).toBeGreaterThan(0.01);
    });
    // cesta sama zmizí
    expect(inkFraction(after, box(60 + helv.widthOfTextAtSize("Model: ", 8), 560, helv.widthOfTextAtSize("C:\\CAD\\hridel.sldprt", 8), 8, after))).toBeLessThan(0.002);
  }, 60_000);

  it("rám: UNC stamp u spodního okraje nesmaže „Nekótované rozměry ISO 2768-mK“ ani promítání", async () => {
    const s = await makeVectorDrawing({ withForm: false, withAttachment: false });
    const doc = await PDFDocument.load(s.pdf);
    const helv = await doc.embedFont(StandardFonts.Helvetica);
    const page = doc.getPage(0);
    page.drawText("\\\\nas01\\cad\\D-7777.dwg", { x: 30, y: 10, size: 6, font: helv });
    page.drawText("Nekotovane rozmery ISO 2768-mK", { x: 200, y: 10, size: 6, font: helv });
    page.drawText("Promitani ISO E", { x: 400, y: 10, size: 6, font: helv });
    const res = await anonymizePdf(input(await doc.save()));
    expect(res.failure).toBeNull();
    const after = await render(res.partPdf!);
    for (const [t, x] of [["Nekotovane rozmery ISO 2768-mK", 200], ["Promitani ISO E", 400]] as const) {
      expect(inkFraction(after, box(x, 10, helv.widthOfTextAtSize(t, 6), 6, after)), t).toBeGreaterThan(0.01);
    }
  }, 60_000);

  it("řetěz se nepřenese přes odmítnutou položku: login za poznámkou zůstane jen když navazuje", async () => {
    const parts = [
      { s: "C:\\Vykresy\\D-1.dwg", x: 60 },
      { s: "Odjehlit hrany", x: 200 },
      { s: "jnovak", x: 330 },
    ];
    const s = await makeVectorDrawing({ withForm: false, withAttachment: false });
    const doc = await PDFDocument.load(s.pdf);
    const helv = await doc.embedFont(StandardFonts.Helvetica);
    const page = doc.getPage(0);
    for (const p of parts) page.drawText(p.s, { x: p.x, y: 790, size: 6, font: helv });
    const res = await anonymizePdf(input(await doc.save()));
    const after = await render(res.partPdf!);
    expect(inkFraction(after, box(200, 790, helv.widthOfTextAtSize("Odjehlit hrany", 6), 6, after))).toBeGreaterThan(0.01);
    expect(res.pages[0].texts.map((t) => t.text).join("|")).not.toContain("Odjehlit");
  }, 60_000);

  it("tiskárna v plot stampu se smaže, ale s varováním ke kontrole", async () => {
    const s = await makeVectorDrawing({ withForm: false, withAttachment: false });
    const doc = await PDFDocument.load(s.pdf);
    const helv = await doc.embedFont(StandardFonts.Helvetica);
    const page = doc.getPage(0);
    page.drawText("C:\\Vykresy\\D-2.dwg", { x: 60, y: 790, size: 6, font: helv });
    page.drawText("Plot: HP DesignJet T830", { x: 200, y: 790, size: 6, font: helv });
    const res = await anonymizePdf(input(await doc.save()));
    const after = await render(res.partPdf!);
    expect(inkFraction(after, box(200, 790, helv.widthOfTextAtSize("Plot: HP DesignJet T830", 6), 6, after))).toBeLessThan(0.002);
    expect(res.warnings.some((w) => w.code === "plot_stamp")).toBe(true);
  }, 60_000);
});

describe("razítko se nerozšíří přes kusovník (negativní)", () => {
  it("kusovník s výrobci nad razítkem: SKF GmbH, Bossard AG, Gutekunst s.r.o. zůstanou", async () => {
    const s = await makeVectorDrawing({ withForm: false, withAttachment: false });
    const doc = await PDFDocument.load(s.pdf);
    const helv = await doc.embedFont(StandardFonts.Helvetica);
    const page = doc.getPage(0);
    const tbx = A3[0] - 20 - 520;
    const rows = [
      { pos: "1", name: "Lozisko 6205-2RS", qty: "2 ks", mfr: "SKF GmbH", y: 215 },
      { pos: "2", name: "Sroub ISO 4762 M8x20", qty: "4 ks", mfr: "Bossard AG", y: 230 },
      { pos: "3", name: "Pruzina DIN 2098", qty: "1 ks", mfr: "Gutekunst s.r.o.", y: 245 },
    ];
    for (const r of rows) {
      page.drawText(r.pos, { x: tbx + 5, y: r.y, size: 7, font: helv });
      page.drawText(r.name, { x: tbx + 30, y: r.y, size: 7, font: helv });
      page.drawText(r.qty, { x: tbx + 200, y: r.y, size: 7, font: helv });
      page.drawText(r.mfr, { x: tbx + 300, y: r.y, size: 7, font: helv });
    }
    const res = await anonymizePdf(input(await doc.save()));
    expect(res.failure).toBeNull();
    const after = await render(res.partPdf!);
    for (const r of rows) {
      expect(inkFraction(after, box(tbx + 300, r.y, helv.widthOfTextAtSize(r.mfr, 7), 7, after)), r.mfr).toBeGreaterThan(0.01);
    }
  }, 60_000);

  it("computeZones: řádky kusovníku s právní formou zónu razítka nerozšíří, „Zákazník:“ ano", () => {
    const W = A3[0], H = A3[1];
    const base = [
      { text: "Kreslil: J. Novák", box: { x: 680, y: 700, w: 80, h: 8 } },
      { text: "Material: 1.4301", box: { x: 940, y: 730, w: 90, h: 8 } },
      { text: "Cislo vykresu: D-1", box: { x: 680, y: 790, w: 90, h: 8 } },
    ];
    const bom = [
      { text: "1 Lozisko 6205-2RS 2 ks SKF GmbH", box: { x: 690, y: 640, w: 300, h: 8 } },
      { text: "SKF GmbH", box: { x: 980, y: 625, w: 50, h: 8 } },
      { text: "Výrobce: Bossard AG", box: { x: 700, y: 610, w: 100, h: 8 } },
    ];
    const z = computeZones([...base, ...bom], W, H);
    expect(z.titleBlock!.y).toBeGreaterThan(645);
    const z2 = computeZones([...base, { text: "Zákazník: ACME Forge GmbH", box: { x: 690, y: 630, w: 160, h: 10 } }], W, H);
    expect(z2.titleBlock!.y).toBeLessThanOrEqual(630);
  });
});

describe("chybějící písmo po fontech", () => {
  it("celé písmo bez inkoustu (20 kót, ~40 % vzorku) → selhání vykreslení, ne jen kontrola", async () => {
    const { pushGraphicsState, popGraphicsState, setTextRenderingMode, TextRenderingMode } = await import("pdf-lib");
    const s = await makeVectorDrawing({ withForm: false, withAttachment: false });
    const doc = await PDFDocument.load(s.pdf);
    const helv = await doc.embedFont(StandardFonts.Helvetica);
    const page = doc.getPage(0);
    for (let i = 0; i < 20; i++) {
      page.pushOperators(pushGraphicsState(), setTextRenderingMode(TextRenderingMode.Invisible));
      page.drawText(`${100 + i} ±0,1`, { x: 80 + (i % 5) * 100, y: 520 + Math.floor(i / 5) * 30, size: 9, font: helv });
      page.pushOperators(popGraphicsState());
    }
    const res = await anonymizePdf(input(await doc.save()));
    expect(res.pages[0].inkFailed).toBe(true);
    expect(res.failure).toBeTruthy();
  }, 60_000);
});

describe("barva výstupu", () => {
  it("malá červená poznámka (revizní obláček) zůstane ve výstupu červená", async () => {
    const s = await makeVectorDrawing({ withForm: false, withAttachment: false });
    const doc = await PDFDocument.load(s.pdf);
    const helv = await doc.embedFont(StandardFonts.Helvetica);
    const page = doc.getPage(0);
    page.drawText("Zmena B: upraven radius R5", { x: 300, y: 500, size: 7, font: helv, color: rgb(0.88, 0.22, 0.19) });
    const res = await anonymizePdf(input(await doc.save()));
    expect(res.failure).toBeNull();
    const out = await openPdf(res.partPdf!);
    const p = await out.getPage(1);
    const r = await renderPageRaster(p, 150 / 72, true);
    await out.destroy();
    let red = 0;
    for (let i = 0; i < r.width * r.height; i++) {
      const o = i * r.channels;
      if (r.channels === 3 && r.data[o] - Math.max(r.data[o + 1], r.data[o + 2]) > 60) red++;
    }
    expect(red).toBeGreaterThan(20);
  }, 60_000);

  it("když po vypálení žádná barva nezůstane (červené logo smazané), výstup je šedý", async () => {
    const s = await makeVectorDrawing({ withForm: false, withAttachment: false });
    const doc = await PDFDocument.load(s.pdf);
    const page = doc.getPage(0);
    // vektorové logo (najde jen AI) zakrýt bílou — zbývá jen PNG logo v razítku, které smažou pravidla
    page.drawRectangle({ x: A3[0] - 95, y: A3[1] - 85, width: 60, height: 50, color: rgb(1, 1, 1) });
    const res = await anonymizePdf(input(await doc.save()));
    expect(res.failure).toBeNull();
    const raw = Buffer.from(res.partPdf!).toString("latin1");
    expect(raw).toContain("/DeviceGray");
    expect(raw).not.toContain("/DeviceRGB");
  }, 60_000);
});

describe("název převzatý z jiné zakázky (cache výstupu)", () => {
  it("náhradní název nese vlastní zakázku, číslo výkresu zůstává", async () => {
    const { rebaseTwinFilename } = await import("./filename");
    expect(rebaseTwinFilename("Z-26-001-V2.jpg", "Z-26-001", { jobNumber: "Z-26-007", index: 1 })).toBe("Z-26-007-V1.jpg");
    expect(rebaseTwinFilename("Z-26-001-V2_l3.pdf", "Z-26-001", { jobNumber: "Z-26-007", index: 4 })).toBe("Z-26-007-V4_l3.pdf");
    expect(rebaseTwinFilename("D-1234_B.pdf", "Z-26-001", { jobNumber: "Z-26-007", index: 1 })).toBe("D-1234_B.pdf");
    expect(rebaseTwinFilename(null, "Z-26-001", { jobNumber: "Z-26-007", index: 1 })).toBeNull();
  });
});
