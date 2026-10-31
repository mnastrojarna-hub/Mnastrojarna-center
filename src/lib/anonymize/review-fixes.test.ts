import { describe, it, expect, beforeAll, afterAll, afterEach, vi } from "vitest";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { PDFDocument, PDFName, PDFString, StandardFonts, degrees, rgb } from "pdf-lib";
import { anonymizePdf, type PdfAnonInput } from "./pdf-pipeline";
import { openPdf } from "./pdf-node";
import { extractPage, computeZonesOriented, dominantRotation } from "./pdf-text";
import { preparePdf } from "./pdf-prepare";
import { burnGraphic, burnRectKeepLines, inkFraction, renderPageRaster, renderRegion, type Raster } from "./pdf-raster";
import { ALL_REDACT, containsTerm, makeTerms, makeWordTerms, ruleLine, type RuleContext } from "./rules";
import { fakeAnonCalls, resetFakeAnonCalls, setFakeAnonHandler, type FakeAnonRequest } from "./detect-ai";
import { accToDecide, decideAnonStatus, mergeBatch, type PdfBatchFacts } from "./decide";
import { checkTranscript, graphicLeaks } from "./verify";
import { anonymizeStep } from "./step";
import { anonymizeDxf } from "./dxf";
import { refineCut, wordGaps } from "./cut-refine";
import { isAnonCandidate } from "./candidate";
import { validateSendRequest, enqueueSend, sendWithoutPending, type Sender } from "./send-queue";
import { anonymizeImage } from "./photo-pipeline";
import { anonRunnerStatus, internalRunAuth, internalRunSecret, kick } from "./queue";
import type { Box } from "./types";

/**
 * Regresní testy k nálezům review anonymizace (#22): stránkování s AI po stránkách a sloučeným
 * rozhodnutím, vypálení grafiky (logo / kód) bez děr, velké skeny, fronta odeslání, termíny po slovech
 * a popisky firmy, AI nesmí tiše mazat technický text, tištěné anotace, ověření grafiky, přesný řez
 * „popisek + jméno", DXF náhled / OLE, výřez razítka bez renderu celé stránky, natočené stránky,
 * nákupní doklady, útrata, TIFF / velké fotky, interní spouštění bez CRON_SECRET.
 * ANON_SHOTS=<adresář> uloží náhledy po anonymizaci.
 */

// render PDF / fotek: při souběhu s ostatními soubory testů trvá déle než výchozích 5 s
vi.setConfig({ testTimeout: 180_000 });

const SHOTS = process.env.ANON_SHOTS || "";
const AI ={ apiKey: "x", model: "claude-opus-5-5", deadline: Date.now() + 20 * 60_000, sha: "e".repeat(64) };
const ctx = (terms: string[] = [], words = false): RuleContext => ({
  terms: [...makeTerms(terms, "crm", ["Mnástrojárna"]), ...(words ? makeWordTerms(terms, "crm", ["Mnástrojárna"]) : [])],
  keepTerms: ["Mnástrojárna"], redact: { ...ALL_REDACT },
});
function input(bytes: Uint8Array, over: Partial<PdfAnonInput> = {}): PdfAnonInput {
  return { bytes, ctx: ctx(), ai: null, verifyPhotos: true, fillPdf: "white", fillPhoto: "white", maxDpi: 150, maxMpx: 40, pageFrom: 1, deadline: Date.now() + 250_000, ...over };
}
async function renderOut(pdf: Uint8Array, dpi = 150, pageNo = 1): Promise<{ r: Raster; s: number }> {
  const doc = await openPdf(pdf);
  const r = await renderPageRaster(await doc.getPage(pageNo), dpi / 72, false);
  await doc.destroy();
  return { r, s: dpi / 72 };
}
const px = (b: Box, s: number): Box => ({ x: b.x * s, y: b.y * s, w: b.w * s, h: b.h * s });
async function shot(name: string, r: Raster, crop?: Box) {
  if (!SHOTS) return;
  const sharp = (await import("sharp")).default;
  mkdirSync(SHOTS, { recursive: true });
  let img = sharp(Buffer.from(r.data), { raw: { width: r.width, height: r.height, channels: r.channels } });
  if (crop) img = img.extract({ left: Math.max(0, Math.floor(crop.x)), top: Math.max(0, Math.floor(crop.y)), width: Math.floor(crop.w), height: Math.floor(crop.h) });
  else img = img.resize({ width: Math.min(1800, r.width) });
  writeFileSync(path.join(SHOTS, name), await img.png().toBuffer());
}

let prevFake: string | undefined;
beforeAll(() => {
  prevFake = process.env.AI_FAKE_ANON;
  process.env.AI_FAKE_ANON = mkdtempSync(path.join(os.tmpdir(), "anon-fake-review-"));
});
afterAll(() => {
  setFakeAnonHandler(null);
  if (prevFake === undefined) delete process.env.AI_FAKE_ANON;
  else process.env.AI_FAKE_ANON = prevFake;
});
afterEach(() => {
  setFakeAnonHandler(null);
  resetFakeAnonCalls();
});

// ── 1) Stránkování ───────────────────────────────────────────

describe("1) PDF po dávkách: AI po stránkách, sloučené rozhodnutí", () => {
  async function twelvePages() {
    const doc = await PDFDocument.create();
    const f = await doc.embedFont(StandardFonts.Helvetica);
    for (let i = 1; i <= 12; i++) {
      const pg = doc.addPage([842, 595]);
      pg.drawRectangle({ x: 20, y: 20, width: 802, height: 555, borderColor: rgb(0, 0, 0), borderWidth: 1 });
      pg.drawText("STROJMETAL", { x: 560, y: 90, size: 12, font: f });
      pg.drawText(`Kreslil: J. Novak   Cislo vykresu: P-${i}`, { x: 560, y: 60, size: 7, font: f });
      pg.drawText("Material: 1.4301   Revize: A", { x: 560, y: 45, size: 7, font: f });
    }
    return doc.save();
  }
  const handler = (req: FakeAnonRequest) => {
    if (req.call !== "vector") return null;
    const ids = [...(req.linesText ?? "").matchAll(/^(p(\d+):L\d+) \| "STROJMETAL"/gm)].map((m) => ({ id: m[1], page: Number(m[2]) }));
    const pages = [...new Set(req.images.map((i) => i.page))];
    return {
      pages: pages.map((pn) => ({
        index: pn, isDrawing: true, textLayerTrustworthy: true, titleBlock: { img: 0, x: 0, y: 0, w: 0, h: 0 },
        redactLines: ids.filter((x) => x.page === pn).map((x) => ({ id: x.id, substring: "STROJMETAL", category: "company", reason: "owner_company", confidence: 0.95 })),
        boxes: [], keep: [], customerStandard: [],
      })),
      confidence: 0.96,
    };
  };
  // CRM název jako celek (bez slov) — firmu na stránce najde jen AI
  const terms = () => ({ terms: makeTerms(["Strojmetal Aluminium Forging s.r.o."], "crm", ["Mnástrojárna"]), keepTerms: ["Mnástrojárna"], redact: { ...ALL_REDACT } });

  it("2. dávka s cache 1. dávky volá AI pro stránky 11–12; firma je pryč i na straně 12", async () => {
    const pdf = await twelvePages();
    setFakeAnonHandler(handler);
    const base = input(pdf, { ctx: terms(), ai: AI });
    const r1 = await anonymizePdf(base);
    expect(r1.next).toBe(11);
    expect(fakeAnonCalls("vector")).toBe(1);
    const r2 = await anonymizePdf({ ...base, cache: r1.cache, pageFrom: 11 });
    expect(fakeAnonCalls("vector")).toBe(2);
    expect(r2.next).toBeNull();
    expect(r2.aiUsed).toBe(true);
    expect(r2.pages.map((p) => p.regions.filter((r) => r.category === "company").length)).toEqual([1, 1]);
    // cache po stránkách: 1–12
    expect(Object.keys(r2.cache!.vector).map(Number).sort((a, b) => a - b)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12]);
    const od = await openPdf(pdf);
    const { info } = await extractPage(od, 12);
    await od.destroy();
    const it12 = info.items.find((i) => i.str === "STROJMETAL")!;
    const { r, s } = await renderOut(r2.partPdf!, 150, 2);
    expect(inkFraction(r, px(it12, s))).toBeLessThan(0.01);
  });

  it("2. dávka BEZ AI s neúplnou cache → aiUsed=false (žádné tiché „AI zkontrolováno“)", async () => {
    const pdf = await twelvePages();
    setFakeAnonHandler(handler);
    const r1 = await anonymizePdf(input(pdf, { ctx: terms(), ai: AI }));
    const r2 = await anonymizePdf(input(pdf, { ctx: terms(), ai: null, cache: r1.cache, pageFrom: 11 }));
    expect(r2.aiUsed).toBe(false);
  });

  it("mergeBatch: varování, zbytky, AI u všech stran a jistota se přes dávky neztratí; usage se sčítá", () => {
    const b = (o: Partial<PdfBatchFacts>): PdfBatchFacts => ({
      warnings: [], residue: false, outputOk: true, customerStandard: false, termInKeep: false, confidence: 0.96, aiUsed: true, hasIncluded: true,
      fallback: false, titleBlockFound: true, verifyClean: null, verifyKeepMissing: false, ...o,
    });
    const a1 = mergeBatch(null, b({ warnings: [{ code: "keep_overlap", message: "x", page: 3 }], residue: true, usage: { input: 10, output: 5, cacheRead: 0, cacheWrite: 0, usd: 0.5, calls: 1 } }));
    const a2 = mergeBatch(a1, b({ aiUsed: false, confidence: 1, usage: { input: 1, output: 1, cacheRead: 0, cacheWrite: 0, usd: 0.25, calls: 1 } }));
    expect(a2.warnings.map((w) => w.code)).toEqual(["keep_overlap"]);
    expect(a2.residue).toBe(true);
    expect(a2.allAi).toBe(false);
    expect(a2.usage).toMatchObject({ usd: 0.75, calls: 2 });
    const d = decideAnonStatus({ ...accToDecide(a2, { method: "raster_pdf" }), mode: "full" });
    // plná automatika: zbytky / bez AI = poznámky, výsledek hotový
    expect(d.status).toBe("done");
    expect(d.warnings.map((w) => w.code)).toEqual(expect.arrayContaining(["keep_overlap"]));
    // dávka bez zahrnutých stran (dopis) nepokazí „AI u všech"
    const a3 = mergeBatch(mergeBatch(null, b({})), b({ aiUsed: false, hasIncluded: false }));
    expect(decideAnonStatus({ ...accToDecide(a3, { method: "raster_pdf" }), mode: "full" }).status).toBe("done");
    expect(mergeBatch(a1, b({}), { manualBy: "u1" }).manualBy).toBe("u1");
  });

  it("dávka podle pixelů a deadlinu: A0 strany po jedné, těsný deadline → navázání po 1. straně", async () => {
    const doc = await PDFDocument.create();
    for (let i = 0; i < 3; i++) doc.addPage([842, 595]).drawText("Kreslil: J. Novak", { x: 600, y: 50, size: 8 });
    const pdf = await doc.save();
    const r = await anonymizePdf(input(pdf, { pixelBudget: 1 }));
    expect(r.pages.length).toBe(1);
    expect(r.next).toBe(2);
    const r2 = await anonymizePdf(input(pdf, { deadline: Date.now() + 100_000 }));
    expect(r2.pages.length).toBe(1);
    expect(r2.next).toBe(2);
  });
});

// ── 2) Grafika: logo / kód celé ─────────────────────────────

describe("2) vypálení grafiky", () => {
  it("A3 @ 300 DPI: AI box o kus menší než čárový kód a plné logo → nezbude nic; linka tabulky zůstane", () => {
    const W = 4961, H = 3508;
    const r: Raster = { width: W, height: H, channels: 1, data: new Uint8Array(W * H).fill(255) };
    for (let y = 3000; y < 3150; y++) for (let x = 3600; x < 3900; x++) if (((x - 3600) % 6) < 3) r.data[y * W + x] = 0;
    for (let y = 3020; y < 3140; y++) for (let x = 4300; x < 4450; x++) r.data[y * W + x] = 106;
    // vodorovná linka tabulky přes celé razítko pod logem a svislá vedle loga
    for (let y = 3160; y < 3163; y++) for (let x = 3400; x < 4900; x++) r.data[y * W + x] = 0;
    for (let x = 4470; x < 4473; x++) for (let y = 2900; y < 3300; y++) r.data[y * W + x] = 0;
    const dark = (b: Box) => { let n = 0; for (let y = b.y; y < b.y + b.h; y++) for (let x = b.x; x < b.x + b.w; x++) if (r.data[y * W + x] < 191) n++; return n; };
    const g1 = burnGraphic(r, { x: 3610, y: 3004, w: 280, h: 142 }, [255]);
    const g2 = burnGraphic(r, { x: 4302, y: 3023, w: 146, h: 114 }, [255]);
    expect(dark({ x: 3600, y: 3000, w: 300, h: 150 })).toBe(0);
    expect(dark({ x: 4300, y: 3020, w: 150, h: 120 })).toBe(0);
    expect(g1.residue || g2.residue).toBe(false);
    // linky tabulky zůstaly
    expect(dark({ x: 3400, y: 3160, w: 1500, h: 3 })).toBeGreaterThan(1400 * 3);
    expect(dark({ x: 4470, y: 2900, w: 3, h: 400 })).toBeGreaterThan(390 * 3);
  });

  it("text: linka se zachová jen tenká a pokračující ≥ 1 em; tvar (logo) v textové oblasti zmizí", () => {
    const W = 600, H = 400;
    const r: Raster = { width: W, height: H, channels: 1, data: new Uint8Array(W * H).fill(255) };
    for (let x = 100; x < 102; x++) for (let y = 0; y < 400; y++) r.data[y * W + x] = 0; // linka přes celou výšku
    for (let y = 150; y < 250; y++) for (let x = 300; x < 330; x++) r.data[y * W + x] = 0; // široký pruh jen kousek přes okraj
    burnRectKeepLines(r, { x: 50, y: 160, w: 400, h: 80 }, [255], 255, 20);
    expect(r.data[200 * W + 100]).toBe(0);
    expect(r.data[200 * W + 315]).toBe(255);
    // bez em (grafika) = celý obdélník
    for (let x = 100; x < 102; x++) for (let y = 0; y < 400; y++) r.data[y * W + x] = 0;
    burnRectKeepLines(r, { x: 50, y: 160, w: 400, h: 80 }, [255], 255, 0);
    expect(r.data[200 * W + 100]).toBe(255);
  });
});

// ── 2 + 6 + 7) Adversariální vektorové PDF ──────────────────

const [AW, AH] = [1190.55, 841.89];
const BARCODE = { x: 1000, y: 145, w: 100, h: 35 };
const LOGO = { x: 655, y: 150, w: 35, h: 35 };
const NOVIEW = [300, 700, 500, 720];
const MISMATCH = [300, 650, 520, 670];
const vp = (b: Box): Box => ({ x: b.x, y: AH - b.y - b.h, w: b.w, h: b.h });

async function adversarial(rotate = false, font: "helv" | "courier" = "helv") {
  const doc = await PDFDocument.create();
  doc.setAuthor("Jan Novak"); doc.setCreator("AutoCAD 2024"); doc.setTitle("C:\\Users\\novak\\STROJMETAL\\D-1234.dwg");
  const helv = await doc.embedFont(font === "courier" ? StandardFonts.Courier : StandardFonts.Helvetica);
  const bold = await doc.embedFont(StandardFonts.HelveticaBold);
  const page = doc.addPage([AW, AH]);
  if (rotate) page.setRotation(degrees(90));
  page.drawRectangle({ x: 20, y: 20, width: AW - 40, height: AH - 40, borderColor: rgb(0, 0, 0), borderWidth: 1.2 });
  page.drawRectangle({ x: 650, y: 20, width: 520, height: 170, borderColor: rgb(0, 0, 0), borderWidth: 1 });
  const t = (s: string, x: number, y: number, size: number, f = helv) => page.drawText(s, { x, y, size, font: f, color: rgb(0, 0, 0) });
  t("STROJMETAL a.s.", 700, 165, 12, bold);
  t("Kreslil:", 655, 130, 7); t("J. Novak", 700, 130, 8);
  t("Schvalil:", 800, 130, 7); t("P. Dvorak", 845, 130, 8);
  t("Material:", 915, 105, 7); t("1.4301", 960, 105, 8);
  t("Meritko: 1:2", 655, 70, 8);
  t("Cislo vykresu:", 655, 40, 7); t("D-1234-01", 785, 38, 14, bold); t("Revize: B", 1045, 40, 9);
  for (let i = 0; i < 25; i++) page.drawRectangle({ x: BARCODE.x + i * 4, y: BARCODE.y, width: 1, height: BARCODE.h, color: rgb(0, 0, 0) });
  page.drawRectangle({ x: LOGO.x, y: LOGO.y, width: LOGO.w, height: LOGO.h, color: rgb(0.878, 0.224, 0.188) });
  t("Ø25 h7", 400, 500, 9); t("Kalit na 58+-2 HRC, cernit", 60, 300, 8);
  page.drawText("C:\\Projekty\\Strojmetal\\D-1234.dwg  23.10.2026  novak", { x: 34, y: 120, size: 6, font: helv, rotate: degrees(90) });
  const c = doc.context;
  const mkAnnot = (rect: number[], text: string, contents: string, F: number) => {
    const ap = c.stream(`BT /Helv 10 Tf 2 6 Td (${text}) Tj ET`, { Type: "XObject", Subtype: "Form", BBox: [0, 0, rect[2] - rect[0], rect[3] - rect[1]], Resources: { Font: { Helv: helv.ref } } });
    const a = c.obj({ Type: "Annot", Subtype: "FreeText", Rect: rect, Contents: PDFString.of(contents), F, DA: PDFString.of("/Helv 10 Tf 0 g"), AP: { N: c.register(ap) } });
    page.node.addAnnot(c.register(a));
  };
  mkAnnot(NOVIEW, "info@strojmetal.cz", "", 36); // Print + NoView
  mkAnnot(MISMATCH, "Tel. +420 777 888 999", "Poznamka", 4); // /Contents ≠ vzhled
  doc.catalog.set(PDFName.of("OpenAction"), c.obj({ S: "JavaScript", JS: PDFString.of("app.alert('STROJMETAL')") }));
  return doc.save();
}

describe("2/6/7) adversariální PDF", () => {
  it("anotace: tištěný vzhled se zploští do obsahu → pravidla smažou e-mail a telefon z anotací", async () => {
    const pdf = await adversarial();
    const prep = await preparePdf(pdf, 150e6);
    expect(prep.flattened[1]).toBe(2);
    const res = await anonymizePdf(input(pdf, { ctx: ctx(["Strojmetal Kladno a.s."], true) }));
    expect(res.failure).toBeNull();
    const { r, s } = await renderOut(res.partPdf!);
    await shot("review-annots-after.png", r, px({ x: 280, y: AH - 730, w: 260, h: 90 }, s));
    expect(inkFraction(r, px(vp({ x: NOVIEW[0], y: NOVIEW[1], w: 200, h: 20 }), s))).toBeLessThan(0.005);
    expect(inkFraction(r, px(vp({ x: MISMATCH[0], y: MISMATCH[1], w: 220, h: 20 }), s))).toBeLessThan(0.005);
  });

  it("fake AI: boxy o kus menší než kód a logo → celé pryč; box přes kótu a „custom“ poznámka → ke kontrole", async () => {
    const pdf = await adversarial();
    const od = await openPdf((await preparePdf(pdf, 150e6)).bytes);
    const { info } = await extractPage(od, 1);
    await od.destroy();
    const dim = info.items.find((i) => i.str.includes("Ø25"))!;
    const note = info.lines.find((l) => l.text.includes("Kalit"))!;
    const comp = info.lines.find((l) => l.text.includes("STROJMETAL"))!;
    setFakeAnonHandler((req) => {
      if (req.call !== "vector") return null;
      const ov = req.images.find((i) => i.kind === "overview" && i.page === 1)!;
      const toImg = (b: Box, inset: number) => ({ img: ov.index, x: Math.round((b.x + inset) * ov.s), y: Math.round((b.y + inset) * ov.s), w: Math.round((b.w - 2 * inset) * ov.s), h: Math.round((b.h - 2 * inset) * ov.s) });
      return {
        pages: [{
          index: 1, isDrawing: true, textLayerTrustworthy: true, titleBlock: { img: ov.index, x: 0, y: 0, w: 0, h: 0 },
          redactLines: [
            { id: comp.id, substring: "STROJMETAL a.s.", category: "company", reason: "owner_company", confidence: 0.95 },
            { id: note.id, substring: note.text, category: "custom", reason: "other", confidence: 0.9 },
          ],
          boxes: [
            { ...toImg(vp(BARCODE), 2.5), category: "code", reason: "code", confidence: 0.9 },
            { ...toImg(vp(LOGO), 2.5), category: "logo", reason: "logo", confidence: 0.9 },
            { ...toImg({ x: dim.x, y: dim.y, w: dim.w, h: dim.h }, -1), category: "logo", reason: "logo", confidence: 0.9 },
          ],
          keep: [], customerStandard: [],
        }],
        confidence: 0.95,
      };
    });
    const res = await anonymizePdf(input(pdf, { ai: AI, maxDpi: 300 }));
    expect(res.failure).toBeNull();
    const { r, s } = await renderOut(res.partPdf!);
    await shot("review-ai-titleblock-after.png", r, px({ x: 640, y: AH - 200, w: 540, h: 190 }, s));
    expect(inkFraction(r, px(vp(BARCODE), s))).toBeLessThan(0.01);
    expect(inkFraction(r, px(vp(LOGO), s))).toBeLessThan(0.01);
    const codes = res.warnings.map((w) => w.code);
    expect(codes).toContain("ai_removed_text");
    // obě situace hlášené zvlášť: box AI přes kótu i smazaná poznámka v těle výkresu
    const msgs = res.warnings.filter((w) => w.code === "ai_removed_text").map((w) => w.message);
    expect(msgs.some((m) => /technický údaj/.test(m))).toBe(true);
    expect(msgs.some((m) => /v těle výkresu/.test(m))).toBe(true);
    const d = decideAnonStatus({
      mode: "full", method: "raster_pdf", aiUsed: res.aiUsed, modelFallback: res.fallback, confidence: res.confidence, ruleHitsCovered: !res.pages[0].residue,
      outputChecksPassed: res.outputProblems.length === 0, verifyClean: null, verifyKeepPresent: null, pxPerMm: null, isPhoto: false, hasMaster: false,
      warnings: res.warnings, customerStandard: res.customerStandard, termInKeep: res.termInKeep, titleBlockFound: res.pages[0].titleBlockFound,
    });
    expect(d.status).toBe("done");
    expect(d.warnings.map((w) => w.code)).toContain("ai_removed_text");
    // poznámka „custom" bez termínu = „other" (ne nevypínatelný termín)
    expect(res.pages[0].regions.some((x) => x.category === "custom")).toBe(false);
  });

  it("natočená stránka (/Rotate 90): razítko ve směru čtení → firma smazaná i bez AI", async () => {
    const pdf = await adversarial(true);
    const res = await anonymizePdf(input(pdf, { ctx: ctx(["Strojmetal Kladno a.s."]) }));
    expect(res.failure).toBeNull();
    const od = await openPdf(pdf);
    const { info } = await extractPage(od, 1);
    await od.destroy();
    const it = info.items.find((i) => i.str.includes("STROJMETAL a.s."))!;
    expect(info.lines.find((l) => l.text.includes("STROJMETAL"))!.zone).toBe("title_block");
    const { r, s } = await renderOut(res.partPdf!);
    await shot("review-rot-after.png", r);
    expect(inkFraction(r, px(it, s))).toBeLessThan(0.01);
    expect(dominantRotation(info.items)).not.toBe(0);
  });

  it("Courier: „SCHVALIL: J. Iljin“ v jedné položce → ze jména nezůstane nic, popisek zůstane", async () => {
    const doc = await PDFDocument.create();
    const c = await doc.embedFont(StandardFonts.Courier);
    const pg = doc.addPage([842, 595]);
    const rows = ["SCHVALIL: J. Iljin", "KONTROLOVAL: Ilja Fiala", "GEPRUEFT: R. Lillie", "Kreslil: J. Novak", "Cislo vykresu: D-77", "Material: 1.4301"];
    rows.forEach((sx, i) => pg.drawText(sx, { x: 500, y: 140 - i * 18, size: 10, font: c }));
    const pdf = await doc.save();
    const res = await anonymizePdf(input(pdf, { maxDpi: 300 }));
    const { r, s } = await renderOut(res.partPdf!, 300);
    await shot("review-mono-after.png", r, { x: 490 * s, y: 440 * s, w: 200 * s, h: 70 * s });
    const visible: Record<string, string[]> = {};
    rows.slice(0, 4).forEach((row, i) => {
      const at = row.indexOf(":") + 2;
      const y = 595 - (140 - i * 18) - 8;
      for (let k = at; k < row.length; k++) {
        if (row[k] === " ") continue;
        if (inkFraction(r, { x: (500 + k * 6) * s, y: y * s, w: 6 * s, h: 10 * s }) > 0.02) (visible[row] ??= []).push(row[k]);
      }
      // popisek zůstal
      expect(inkFraction(r, { x: 500 * s, y: y * s, w: (at - 2) * 6 * s, h: 10 * s }), row).toBeGreaterThan(0.05);
      // i dvojtečka popisku zůstala (odhad Helvetiky ji u Courieru ukrajoval)
      expect(inkFraction(r, { x: (500 + (at - 2) * 6) * s, y: y * s, w: 6 * s, h: 10 * s }), `${row} „:"`).toBeGreaterThan(0.01);
    });
    expect(visible).toEqual({});
  });
});

describe("3) velké skeny", () => {
  it("sken 9933×7016 (≈ 70 MPx) se vykreslí (žádná prázdná stránka)", async () => {
    const sharp = (await import("sharp")).default;
    const Wpx = 9933, Hpx = 7016;
    const svg = Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${Wpx}" height="${Hpx}"><rect width="100%" height="100%" fill="#fff"/><rect x="60" y="60" width="${Wpx - 120}" height="${Hpx - 120}" fill="none" stroke="#000" stroke-width="8"/><text x="2000" y="3000" font-size="120" font-family="Arial">Ø250 h7</text></svg>`);
    const jpg = await sharp(svg, { limitInputPixels: false }).grayscale().jpeg({ quality: 70 }).toBuffer();
    const doc = await PDFDocument.create();
    const page = doc.addPage([3370, 2384]);
    page.drawImage(await doc.embedJpg(jpg), { x: 0, y: 0, width: 3370, height: 2384 });
    const pdf = await doc.save();
    setFakeAnonHandler(() => null);
    const res = await anonymizePdf(input(pdf, { ai: AI, maxDpi: 300 }));
    expect(res.failure).toBeNull();
    expect(res.pages[0].method).toBe("scan");
    const { r } = await renderOut(res.partPdf!, 20);
    expect(inkFraction(r, { x: 0, y: 0, w: r.width, h: r.height })).toBeGreaterThan(0.001);
  }, 120_000);

  it("obrázek nad limit pdf.js → srozumitelná chyba (ne prázdná stránka)", async () => {
    const doc = await PDFDocument.create();
    const page = doc.addPage([3370, 2384]);
    const ref = doc.context.register(doc.context.stream(new Uint8Array([0xff, 0xd8, 0xff, 0xd9]), {
      Type: "XObject", Subtype: "Image", Width: 20000, Height: 10000, ColorSpace: "DeviceGray", BitsPerComponent: 8, Filter: "DCTDecode",
    }));
    page.node.setXObject(PDFName.of("Big"), ref);
    const pdf = await doc.save();
    const res = await anonymizePdf(input(pdf));
    expect(res.failure).toMatch(/příliš velký/);
  });
});

// ── 4) Fronta odeslání ───────────────────────────────────────

function mockDb(tables: Record<string, Record<string, unknown>[]>, objects: Record<string, Uint8Array> = {}) {
  const q = (table: string) => {
    const rows = () => tables[table] ?? (tables[table] = []);
    const filters: ((r: Record<string, unknown>) => boolean)[] = [];
    let patch: Record<string, unknown> | null = null;
    let insertRow: Record<string, unknown> | null = null;
    const api: Record<string, unknown> = {};
    const run = () => {
      if (insertRow) { const r = { id: `00000000-0000-4000-8000-${String(rows().length + 1).padStart(12, "0")}`, status: "waiting", attempts: 0, created_at: new Date().toISOString(), ...insertRow }; rows().push(r); return [r]; }
      const hit = rows().filter((r) => filters.every((f) => f(r)));
      if (patch) for (const r of hit) Object.assign(r, patch);
      return hit;
    };
    Object.assign(api, {
      select: () => api, order: () => api, limit: () => api,
      in: (c: string, v: unknown[]) => { filters.push((r) => v.includes(r[c])); return api; },
      eq: (c: string, v: unknown) => { filters.push((r) => r[c] === v); return api; },
      lt: (c: string, v: number) => { filters.push((r) => (r[c] as number) < v); return api; },
      contains: (c: string, v: unknown[]) => { filters.push((r) => v.every((x) => (r[c] as unknown[]).includes(x))); return api; },
      update: (o: Record<string, unknown>) => { patch = o; return api; },
      insert: (o: Record<string, unknown>) => { insertRow = o; return api; },
      single: async () => ({ data: run()[0], error: null }),
      maybeSingle: async () => ({ data: run()[0] ?? null, error: null }),
      then: (res: (v: unknown) => unknown) => res({ data: run(), error: null }),
    });
    return api;
  };
  return {
    from: q,
    storage: { from: () => ({ download: async (p: string) => (objects[p] ? { data: new Blob([objects[p] as BlobPart]), error: null } : { data: null, error: { message: "nf" } }) }) },
  };
}

describe("4) fronta odeslání — kontrola na serveru", () => {
  const JOB = "22222222-2222-4222-8222-222222222222", OTHER = "33333333-3333-4333-8333-333333333333";
  const DRAW = "11111111-1111-4111-8111-111111111111", PRICE = "44444444-4444-4444-8444-444444444444", FOREIGN = "55555555-5555-4555-8555-555555555555";
  const PO = "66666666-6666-4666-8666-666666666666", PO2 = "77777777-7777-4777-8777-777777777777";
  const tables = () => ({
    job_files: [
      { id: DRAW, job_id: JOB }, { id: PRICE, job_id: JOB }, { id: FOREIGN, job_id: OTHER },
    ],
    purchase_orders: [{ id: PO, job_id: JOB }, { id: PO2, job_id: OTHER }],
  });
  const access = (over: Partial<{ price: boolean; margins: boolean }> = {}) => ({
    canSendFile: async (id: string) => (id === PRICE && !over.price ? "Nákupní doklad nesmíš poslat." : null),
    canSendPurchaseOrder: over.margins ?? true,
  });
  const base = { kind: "job_document" as const, jobId: JOB, fileIds: [DRAW], payload: { to: ["a@b.cz"], subject: "x", body: "y" } };

  it("extraFileIds / reviewedFileIds musí patřit k zakázce a projít kontrolou přístupu", async () => {
    const db = mockDb(tables()) as never;
    expect(await validateSendRequest(db, { ...base, payload: { ...base.payload, extraFileIds: [FOREIGN] } }, access())).toMatchObject({ ok: false });
    expect(await validateSendRequest(db, { ...base, payload: { ...base.payload, extraFileIds: [PRICE] } }, access())).toMatchObject({ ok: false, error: "Nákupní doklad nesmíš poslat." });
    expect(await validateSendRequest(db, { ...base, payload: { ...base.payload, reviewedFileIds: [FOREIGN] } }, access())).toMatchObject({ ok: false });
    expect(await validateSendRequest(db, { ...base, jobId: null }, access())).toMatchObject({ ok: false });
    const ok = await validateSendRequest(db, { ...base, payload: { ...base.payload, purchaseOrderId: PO } }, access());
    expect(ok).toMatchObject({ ok: true });
    // u druhu job_document se objednávka nepřebírá
    expect((ok as { payload: { purchaseOrderId?: string } }).payload.purchaseOrderId).toBeUndefined();
  });

  it("objednávka: jen s právem a jen objednávka téže zakázky", async () => {
    const db = mockDb(tables()) as never;
    const po = { ...base, kind: "purchase_order" as const, payload: { ...base.payload, purchaseOrderId: PO } };
    expect(await validateSendRequest(db, po, access({ margins: false }))).toMatchObject({ ok: false });
    expect(await validateSendRequest(db, { ...po, payload: { ...po.payload, purchaseOrderId: PO2 } }, access())).toMatchObject({ ok: false });
    expect(await validateSendRequest(db, po, access())).toMatchObject({ ok: true, refId: PO });
  });

  it("pojistka při odeslání: externí doklad dodavatele (ne-kandidát) bez potvrzení neodejde", async () => {
    const t = {
      job_files: [{ id: PRICE, job_id: JOB, kind: "nabidka", filename: "Nabidka.pdf", mime_type: "application/pdf", storage_path: "zakazky/x/n.pdf", origin: "email", issuer: "dodavatel", anon_status: null, anon_path: null, anon_filename: null, anon_mime: null, anon_sha256: null, anon_reason: null }],
    };
    const db = mockDb(t, { "zakazky/x/n.pdf": new TextEncoder().encode("%PDF") }) as never;
    const sent: string[] = [];
    const sender: Sender = async (a) => { sent.push(a.to); return { sent: true }; };
    const q = await enqueueSend(db, { kind: "job_document", jobId: JOB, payload: { to: ["outsider@example.com"], subject: "x", body: "x", extraFileIds: [PRICE] }, fileIds: [], createdBy: "u" });
    const r = await sendWithoutPending(db, (q as { id: string }).id, "u", false, sender);
    expect(r.ok).toBe(false);
    expect(sent).toEqual([]);
  });
});

// ── 5) Termíny po slovech, popisky firmy, ověření, STEP ──────

describe("5) zákazník v nejčastějších podobách", () => {
  const c = ctx(["Strojmetal Aluminium Forging s.r.o.", "ŠKODA AUTO a.s."], true);
  it("slova z CRM názvu jsou termíny (bez obecných slov)", () => {
    const words = makeWordTerms(["Strojmetal Aluminium Forging s.r.o.", "ŠKODA AUTO a.s.", "Mnástrojárna s.r.o."], "crm", ["Mnástrojárna"]).map((t) => t.norm);
    expect(words).toEqual(["strojmetal", "skoda"]);
    expect(containsTerm("STROJMETAL", c.terms)).toBe(true);
    expect(containsTerm("ŠKODA", c.terms)).toBe(true);
    expect(containsTerm("Aluminium", c.terms)).toBe(false);
  });
  it("popisky Zákazník / Customer / Kunde / Firma / Company / Odběratel / Projekt mažou hodnotu jako firmu", () => {
    const noTerms = ctx([]);
    for (const [line, value] of [
      ["Zákazník: STROJMETAL", "STROJMETAL"], ["Customer: ACME Tools", "ACME Tools"], ["Kunde: Müller", "Müller"], ["Firma: XYZ Kovo", "XYZ Kovo"],
      ["Company: Foo Bar", "Foo Bar"], ["Odběratel: ŠKODA", "ŠKODA"], ["Projekt: Škoda Octavia NG", "Škoda Octavia NG"], ["Zakaznik: STROJMETAL", "STROJMETAL"],
    ]) {
      const r = ruleLine(line, "title_block", noTerms);
      const hit = r.hits.find((h) => h.category === "company");
      expect(hit, line).toBeTruthy();
      expect(line.slice(hit!.start, hit!.end), line).toBe(value);
    }
    // popisek a jiné pole na stejném řádku zůstávají
    const r = ruleLine("Zákazník: STROJMETAL   Kreslil: J. Novák", "title_block", noTerms);
    expect(r.hits.filter((h) => h.category === "company").map((h) => "Zákazník: STROJMETAL   Kreslil: J. Novák".slice(h.start, h.end))).toEqual(["STROJMETAL"]);
    // v těle výkresu se popisek nemaže („Projekt" v poznámce)
    expect(ruleLine("Projekt: viz poznámka 3", "body", noTerms).hits.length).toBe(0);
    // technická hodnota zůstane
    expect(ruleLine("Projekt: 2024-15", "title_block", noTerms).hits.length).toBe(0);
    // „Firma:" s dvojtečkou i u právní formy
    expect(ruleLine("Firma: Strojmetal a.s.", "title_block", noTerms).hits.some((h) => h.category === "company")).toBe(true);
  });
  it("ověření: slovo termínu se nezahodí, i když je v ponechaném řádku", () => {
    const tiles = [{ img: 0, zone: "title_block" as const, lines: ["STROJMETAL", "Cislo vykresu: D-1"], graphics: [] }];
    const out = checkTranscript({ tiles, sensitive: ["STROJMETAL"], kept: ["STROJMETAL drzak"], ctx: c, keepValues: ["D-1"] });
    expect(out.clean).toBe(false);
  });
  it("STEP: produkt, popis a FILE_DESCRIPTION bez jména zákazníka", () => {
    const src = `ISO-10303-21;
HEADER;
FILE_DESCRIPTION(('STROJMETAL bracket'),'2;1');
FILE_NAME('hridel.stp','2026-01-01T00:00:00',('novak'),('STROJMETAL'),'SwSTEP 2.0','SolidWorks 2022','');
FILE_SCHEMA(('AUTOMOTIVE_DESIGN'));
ENDSEC;
DATA;
#1=PRODUCT('SM-4711','STROJMETAL hridel','Vyrobeno pro STROJMETAL Kladno',(#2));
#4=SHAPE_REPRESENTATION('STROJMETAL',(),#5);
ENDSEC;
END-ISO-10303-21;
`;
    const r = anonymizeStep(new TextEncoder().encode(src), c);
    const out = new TextDecoder().decode(r.bytes!);
    expect(out).not.toMatch(/strojmetal/i);
    expect(out).toContain("SM-4711");
    expect(out).toContain("hridel");
    expect(r.problems).toEqual([]);
  });
});

describe("8) ověření grafiky", () => {
  it("logo / razítko firmy je únik i s technickým slovem v popisu; druh má přednost", () => {
    for (const d of ["Logo firmy se šipkou", "Firemní logo – stylizované ozubené kolo s osou detailu", "Company logo outline", "logo s čárami", "Logo: červený šrafovaný štít", "Razítko firmy s podpisem (detail)", "podpis"]) {
      expect(graphicLeaks({ description: d }), d).toBe(true);
    }
    expect(graphicLeaks({ description: "symbol promítání" })).toBe(false);
    expect(graphicLeaks({ description: "značka drsnosti", kind: "technical_symbol" })).toBe(false);
    expect(graphicLeaks({ description: "neznámý tvar", kind: "logo" })).toBe(true);
    expect(graphicLeaks({ description: "Slogan", kind: "company_stamp" })).toBe(true);
  });
});

describe("9) přesný řez popisek + jméno", () => {
  it("mezery mezi slovy podle rastru", () => {
    expect(wordGaps("SCHVALIL: J. Iljin")).toEqual([[9, 10], [12, 13]]);
    // syntetický řádek: „AAAA BB CC" (glyfy 8 px, mezera písmen 2 px, mezera slov 10 px)
    const W = 200, H = 20;
    const r = { width: W, height: H, channels: 1 as const, data: new Uint8Array(W * H).fill(255) };
    const glyphs: number[] = [];
    let x = 10;
    for (const ch of "AAAA BB CC") {
      if (ch === " ") { x += 10; continue; }
      glyphs.push(x);
      for (let yy = 4; yy < 16; yy++) for (let xx = x; xx < x + 8; xx++) r.data[yy * W + xx] = 0;
      x += 10;
    }
    const cut = refineCut(r, { str: "AAAA BB CC", x0: 10, x1: x - 2, yTop: 2, yBot: 18, em: 14, ranges: [[5, 10]] });
    expect(cut.certain).toBe(true);
    // smaže se od mezery za „AAAA" (glyf 4 končí na 48) a popisek zůstane celý
    expect(cut.burn[0][0]).toBeGreaterThanOrEqual(48);
    expect(cut.burn[0][0]).toBeLessThanOrEqual(glyphs[4]);
    expect(cut.kept[0][1]).toBeLessThanOrEqual(cut.burn[0][0]);
    // bez mezery = nejisté
    expect(refineCut(r, { str: "AAAABBCC", x0: 10, x1: 90, yTop: 2, yBot: 18, em: 14, ranges: [[4, 8]] }).certain).toBe(false);
  });
});

describe("10) DXF náhled a vložené objekty", () => {
  it("THUMBNAILIMAGE, OLE2FRAME a proxy entity se odstraní a ověří", () => {
    const pairs: [number, string][] = [
      [0, "SECTION"], [2, "HEADER"], [9, "$ACADVER"], [1, "AC1027"], [0, "ENDSEC"],
      [0, "SECTION"], [2, "ENTITIES"],
      [0, "TEXT"], [8, "0"], [10, "0"], [20, "0"], [40, "2.5"], [1, "D-1"],
      [0, "OLE2FRAME"], [8, "0"], [70, "2"], [3, "Paintbrush Picture"], [10, "1"], [20, "1"], [310, "0102030405060708090A"],
      [0, "ACAD_PROXY_ENTITY"], [8, "0"], [92, "4"], [310, "01020304"],
      [0, "LINE"], [8, "0"], [10, "0"], [20, "0"], [11, "10"], [21, "10"],
      [0, "ENDSEC"],
      [0, "SECTION"], [2, "THUMBNAILIMAGE"], [90, "10"], [310, "424D0A0000000000000036000000"], [0, "ENDSEC"],
      [0, "EOF"],
    ];
    const txt = pairs.map(([a, b]) => `${String(a).padStart(3, " ")}\r\n${b}`).join("\r\n") + "\r\n";
    const r = anonymizeDxf(new TextEncoder().encode(txt), ctx(["Strojmetal"]));
    const out = new TextDecoder().decode(r.bytes!);
    expect(out).not.toContain("THUMBNAILIMAGE");
    expect(out).not.toContain("OLE2FRAME");
    expect(out).not.toContain("ACAD_PROXY_ENTITY");
    expect(out).not.toContain("424D0A");
    expect(out).toContain("LINE");
    expect(out).toContain("D-1");
    expect(r.verified).toBe(true);
    expect(r.removedImages).toBe(3);
  });
});

describe("11) výřez razítka bez renderu celé stránky", () => {
  it("renderRegion = stejný výřez jako render celé stránky; velikost omezená", async () => {
    const pdf = await adversarial();
    const doc = await openPdf(pdf);
    const page = await doc.getPage(1);
    const s = 200 / 72;
    const box = { x: 650, y: AH - 190, w: 520, h: 170 };
    const full = await renderPageRaster(page, s, false);
    const { raster: crop, scale } = await renderRegion(page, s, box, false);
    expect(scale).toBe(s);
    const x0 = Math.floor(box.x * s), y0 = Math.floor(box.y * s);
    let diff = 0;
    for (let y = 0; y < crop.height; y += 3) for (let x = 0; x < crop.width; x += 3) {
      if (Math.abs(crop.data[y * crop.width + x] - full.data[(y0 + y) * full.width + x0 + x]) > 40) diff++;
    }
    expect(diff / ((crop.width / 3) * (crop.height / 3))).toBeLessThan(0.01);
    const capped = await renderRegion(page, 20, { x: 0, y: 0, w: AW, h: AH }, false, 2_000_000);
    expect(capped.raster.width * capped.raster.height).toBeLessThanOrEqual(2_100_000);
    await doc.destroy();
  });
});

describe("12) zóny ve směru čtení", () => {
  it("razítko natočeného výkresu se najde v pravém dolním rohu čtecího rámce", () => {
    // čtecí rámec 842×595 (naležato), stránka viewport 595×842 (text jde dolů, rot −90)
    const W = 595, H = 842;
    const toVp = (b: Box): Box => ({ x: W - (b.y + b.h), y: b.x, w: b.h, h: b.w });
    const lines = [{ text: "Kreslil: X", box: toVp({ x: 600, y: 540, w: 60, h: 8 }) }, { text: "Material: 1.4301", box: toVp({ x: 700, y: 560, w: 80, h: 8 }) }];
    const z = computeZonesOriented(lines, W, H, -90);
    expect(z.titleBlock).toBeTruthy();
    const tb = z.titleBlock!;
    // obsahuje oba popisky
    for (const l of lines) expect(l.box.x >= tb.x && l.box.y >= tb.y && l.box.x + l.box.w <= tb.x + tb.w + 0.01 && l.box.y + l.box.h <= tb.y + tb.h + 0.01).toBe(true);
  });
});

describe("14) nákupní doklady nejsou kandidát", () => {
  it("doklad dodavatele (ostatní PDF) se neanonymizuje; výkres od dodavatele ano", () => {
    expect(isAnonCandidate("ostatni", "nabidka.pdf", "application/pdf", "email", "dodavatel")).toBe(false);
    expect(isAnonCandidate("vykres", "v.pdf", "application/pdf", "email", "dodavatel")).toBe(true);
    expect(isAnonCandidate("ostatni", "v.pdf", "application/pdf", "email", null)).toBe(true);
  });
});

describe("16) TIFF a velké fotky", () => {
  it("TIFF: stránka, která není výkres, se vynechá; zbytek je PDF", async () => {
    const sharp = (await import("sharp")).default;
    const page = (label: string) => sharp(Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="800" height="560"><rect width="100%" height="100%" fill="#fff"/><rect x="20" y="20" width="760" height="520" fill="none" stroke="#000" stroke-width="3"/><text x="400" y="500" font-size="20">${label}</text></svg>`)).raw().toBuffer({ resolveWithObject: true });
    const frames = await Promise.all(["V-1", "Dopis", "V-2"].map(page));
    const joined = Buffer.concat(frames.map((f) => f.data));
    const tiff = await sharp(joined, { raw: { width: 800, height: 560 * 3, channels: frames[0].info.channels as 3 | 4, pageHeight: 560 } }).tiff({ compression: "lzw" }).toBuffer();
    let n = 0;
    setFakeAnonHandler((req) => {
      if (req.call !== "overview") return null;
      n++;
      const im = req.images[0];
      const w = im.outW, h = im.outH;
      return { isDrawing: n !== 2, sheet: [0, 0, w, 0, w, h, 0, h], angleDeg: 0, titleBlock: { x: Math.round(w * 0.55), y: Math.round(h * 0.7), w: Math.round(w * 0.45) - 1, h: Math.round(h * 0.3) - 1 }, revisions: { x: 0, y: 0, w: 0, h: 0 }, candidates: [], confidence: 0.95 };
    });
    const r = await anonymizeImage({ bytes: new Uint8Array(tiff), hasMaster: true, ctx: ctx(), ai: AI, verify: true, fill: "white" });
    expect(r.unsupported).toBeNull();
    expect(r.method).toBe("image_pdf");
    const doc = await openPdf(r.bytes!);
    expect(doc.numPages).toBe(2);
    await doc.destroy();
    expect(r.warnings.map((w) => w.code)).toContain("excluded_pages");
  }, 120_000);

  it("fotka nad 60 MPx se zmenší (ne „nepodporováno“); vynechané výřezy → ke kontrole", async () => {
    const sharp = (await import("sharp")).default;
    const w = 9600, h = 7000;
    const jpg = await sharp({ create: { width: w, height: h, channels: 3, background: { r: 250, g: 250, b: 250 } } }).jpeg({ quality: 60 }).toBuffer();
    setFakeAnonHandler(() => null);
    const r = await anonymizeImage({ bytes: new Uint8Array(jpg), hasMaster: true, ctx: ctx(), ai: AI, verify: false, fill: "white" });
    expect(r.unsupported).toBeNull();
    expect(r.bytes).toBeTruthy();
    const m = await sharp(Buffer.from(r.bytes!)).metadata();
    expect((m.width ?? 0) * (m.height ?? 0)).toBeLessThanOrEqual(60_000_000);
    expect(r.warnings.map((x) => x.code)).toContain("truncated");
  }, 180_000);
});

describe("17) spouštění bez CRON_SECRET", () => {
  const prev = { cron: process.env.CRON_SECRET, key: process.env.SUPABASE_SECRET_KEY };
  afterAll(() => {
    if (prev.cron === undefined) delete process.env.CRON_SECRET; else process.env.CRON_SECRET = prev.cron;
    if (prev.key === undefined) delete process.env.SUPABASE_SECRET_KEY; else process.env.SUPABASE_SECRET_KEY = prev.key;
  });
  it("kick použije tajemství odvozené ze SUPABASE_SECRET_KEY; run ho přijme; Nastavení ukáže varování", async () => {
    delete process.env.CRON_SECRET;
    process.env.SUPABASE_SECRET_KEY = "test-service-key";
    const secret = internalRunSecret();
    expect(secret).toMatch(/^[0-9a-f]{64}$/);
    const calls: { url: string; auth: string }[] = [];
    const fetchImpl = (async (url: string, init: RequestInit) => {
      calls.push({ url, auth: String((init.headers as Record<string, string>).authorization) });
      return new Response("{}");
    }) as unknown as typeof fetch;
    const k = await kick({ origin: "https://app.example", ids: ["11111111-1111-4111-8111-111111111111"], fetchImpl });
    expect(k.kicked).toBe(1);
    expect(calls[0].auth).toBe(`Bearer ${secret}`);
    expect(internalRunAuth(`Bearer ${secret}`)).toBe(200);
    expect(internalRunAuth("Bearer spatne")).toBe(401);
    expect(anonRunnerStatus().warning).toMatch(/CRON_SECRET/);
    process.env.CRON_SECRET = "cron-1";
    expect(internalRunAuth("Bearer cron-1")).toBe(200);
    expect(anonRunnerStatus().cronSecret).toBe(true);
    delete process.env.SUPABASE_SECRET_KEY;
    delete process.env.CRON_SECRET;
    expect(internalRunAuth("Bearer x")).toBe(503);
  });
});
