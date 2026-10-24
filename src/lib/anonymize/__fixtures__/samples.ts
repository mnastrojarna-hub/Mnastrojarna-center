/**
 * Testovací výkresy pro anonymizaci (generují se v testech, nic se neukládá do repa):
 *  - vektorové PDF A3 se standardními písmy BEZ vložení (kontrola fontů pdf.js): razítko s firmou
 *    „STROJMETAL a.s.", „Kreslil: J. Novák", adresa, telefon, web, logo PNG, vektorové logo z křivek,
 *    pole formuláře „Kreslil", plot stamp s cestou „C:\Projekty\…\D-1234.dwg", metadata, příloha,
 *    kóty / tolerance / poznámky, které musí zůstat,
 *  - fotka (JPEG 4032×3024, EXIF orientace 6, natočení 7°, vizitka vedle listu) z téhož výkresu.
 */

import { PDFDocument, StandardFonts, rgb, type PDFFont, type PDFPage } from "pdf-lib";

export const A3: [number, number] = [1190.55, 841.89];

export interface SampleText {
  key: string;
  text: string;
  /** Levý dolní roh účaří (body PDF, počátek vlevo dole). */
  x: number;
  y: number;
  size: number;
  /** Má po anonymizaci zmizet? */
  sensitive: boolean;
}

export interface SampleDrawing {
  pdf: Uint8Array;
  texts: SampleText[];
  logo: { x: number; y: number; w: number; h: number };
  vectorLogo: { x: number; y: number; w: number; h: number };
  width: number;
  height: number;
}

/** Malé PNG logo (červený štít) — bez dalších závislostí. */
export async function logoPng(): Promise<Uint8Array> {
  const sharp = (await import("sharp")).default;
  const svg = Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="120" height="80"><rect width="120" height="80" fill="#ffffff"/><path d="M10 10 L60 5 L110 10 L100 60 L60 75 L20 60 Z" fill="#e03930"/><rect x="35" y="30" width="50" height="14" fill="#272425"/></svg>`);
  return new Uint8Array(await sharp(svg).png().toBuffer());
}

function text(page: PDFPage, font: PDFFont, list: SampleText[], key: string, s: string, x: number, y: number, size: number, sensitive: boolean) {
  page.drawText(s, { x, y, size, font, color: rgb(0, 0, 0) });
  list.push({ key, text: s, x, y, size, sensitive });
}

export async function makeVectorDrawing(opts: { withForm?: boolean; withAttachment?: boolean; extraPages?: ("letter" | "drawing")[]; company?: string } = {}): Promise<SampleDrawing> {
  const company = opts.company ?? "STROJMETAL a.s.";
  const doc = await PDFDocument.create();
  doc.setAuthor("Jan Novák");
  doc.setCreator("SOLIDWORKS 2024");
  doc.setProducer("SOLIDWORKS PDF");
  doc.setTitle("C:\\Users\\novak\\Vykresy\\hridel.SLDDRW");
  doc.setSubject("Strojmetal Kladno");
  doc.setKeywords(["STROJMETAL", "D-1234-01"]);
  const helv = await doc.embedFont(StandardFonts.Helvetica);
  const bold = await doc.embedFont(StandardFonts.HelveticaBold);
  const [W, H] = A3;
  const texts: SampleText[] = [];

  const addLetter = () => {
    const p = doc.addPage([595.28, 841.89]);
    p.drawText("Vazeny pane, v priloze zasilame poptavku na hridel.", { x: 60, y: 760, size: 11, font: helv });
    p.drawText("S pozdravem, Petr Svoboda, nakup", { x: 60, y: 730, size: 11, font: helv });
    p.drawText(`${company}, Prumyslova 1234/5, 272 01 Kladno`, { x: 60, y: 700, size: 11, font: helv });
  };
  if (opts.extraPages?.[0] === "letter") addLetter();

  const page = doc.addPage([W, H]);
  // rám a razítko
  page.drawRectangle({ x: 20, y: 20, width: W - 40, height: H - 40, borderColor: rgb(0, 0, 0), borderWidth: 1.2 });
  const tbx = W - 20 - 520, tby = 20;
  page.drawRectangle({ x: tbx, y: tby, width: 520, height: 170, borderColor: rgb(0, 0, 0), borderWidth: 1 });
  for (const yy of [50, 80, 110, 140]) page.drawLine({ start: { x: tbx, y: tby + yy }, end: { x: tbx + 520, y: tby + yy }, thickness: 0.5 });
  for (const xx of [130, 260, 390]) page.drawLine({ start: { x: tbx + xx, y: tby }, end: { x: tbx + xx, y: tby + 140 }, thickness: 0.5 });

  // logo (rastr) vlevo nahoře v razítku + firma
  const png = await doc.embedPng(await logoPng());
  const logo = { x: tbx + 6, y: tby + 143, w: 36, h: 24 };
  page.drawImage(png, { x: logo.x, y: logo.y, width: logo.w, height: logo.h });
  text(page, bold, texts, "company", company, tbx + 50, tby + 150, 12, true);
  text(page, helv, texts, "address", "Prumyslova 1234/5, 272 01 Kladno", tbx + 200, tby + 158, 7, true);
  text(page, helv, texts, "phone", "Tel.: +420 312 456 789", tbx + 200, tby + 148, 7, true);
  text(page, helv, texts, "web", "www.strojmetal.cz", tbx + 380, tby + 148, 7, true);

  // řádek 4 (110–140): kreslil / schválil
  text(page, helv, texts, "drawnLabel", "Kreslil:", tbx + 5, tby + 122, 7, false);
  text(page, helv, texts, "drawnBy", "J. Novák", tbx + 50, tby + 122, 8, true);
  text(page, helv, texts, "drawnDate", "12.03.2024", tbx + 135, tby + 122, 7, false);
  text(page, helv, texts, "checkedLabel", "Schvalil:", tbx + 265, tby + 122, 7, false);
  text(page, helv, texts, "checkedBy", "Ing. P. Dvorak", tbx + 310, tby + 122, 8, true);
  // řádek 3 (80–110): název, materiál
  text(page, helv, texts, "titleLabel", "Nazev:", tbx + 5, tby + 92, 7, false);
  text(page, bold, texts, "title", "Hridel vstupni", tbx + 40, tby + 92, 9, false);
  text(page, helv, texts, "matLabel", "Material:", tbx + 265, tby + 92, 7, false);
  text(page, helv, texts, "material", "1.4301 CSN EN 10088-2", tbx + 305, tby + 92, 8, false);
  // řádek 2 (50–80): měřítko, hmotnost
  text(page, helv, texts, "scale", "Meritko: 1:2", tbx + 5, tby + 62, 8, false);
  text(page, helv, texts, "weight", "Hmotnost: 2,45 kg", tbx + 135, tby + 62, 8, false);
  text(page, helv, texts, "tol", "ISO 2768-mK", tbx + 265, tby + 62, 8, false);
  // řádek 1 (20–50): číslo výkresu, revize
  text(page, helv, texts, "dnLabel", "Cislo vykresu:", tbx + 5, tby + 30, 7, false);
  text(page, bold, texts, "drawingNumber", "D-1234-01", tbx + 135, tby + 28, 14, false);
  text(page, helv, texts, "rev", "Revize: B", tbx + 395, tby + 30, 9, false);

  // plot stamp s cestou (rám vlevo dole)
  text(page, helv, texts, "path", "C:\\Projekty\\Strojmetal\\Hridel nova\\D-1234.dwg  23.10.2026 14:05  novak", 30, 26, 6, true);
  // e-mail v rámu nahoře
  text(page, helv, texts, "email", "konstrukce@strojmetal.cz", 40, H - 34, 7, true);

  // vektorové logo z křivek (pravý horní roh rámu)
  const vectorLogo = { x: W - 90, y: H - 80, w: 50, h: 40 };
  // SVG osa y dolů od horního okraje boxu → logo leží přesně v boxu
  page.drawSvgPath("M 0 0 L 25 5 L 50 0 L 45 30 L 25 40 L 5 30 Z", { x: vectorLogo.x, y: vectorLogo.y + vectorLogo.h, color: rgb(0.88, 0.22, 0.19) });

  // tělo výkresu: kóty, tolerance, poznámky
  page.drawRectangle({ x: 200, y: 360, width: 420, height: 120, borderColor: rgb(0, 0, 0), borderWidth: 0.7 });
  page.drawLine({ start: { x: 200, y: 330 }, end: { x: 620, y: 330 }, thickness: 0.35 });
  text(page, helv, texts, "dim1", "420 ±0,1", 390, 334, 9, false);
  text(page, helv, texts, "dim2", "Ø25 h7", 640, 415, 9, false);
  text(page, helv, texts, "dim3", "Ra 1,6", 300, 490, 8, false);
  text(page, helv, texts, "dim4", "M8x1.25", 210, 490, 8, false);
  text(page, helv, texts, "note1", "Poznamky: Nekotovane hrany srazit 0,5x45°", 60, 300, 8, false);
  text(page, helv, texts, "note2", "Kalit na 58±2 HRC, cernit", 60, 288, 8, false);
  text(page, helv, texts, "note3", "Lozisko SKF 6205-2RS", 60, 276, 8, false);

  if (opts.withForm !== false) {
    const form = doc.getForm();
    const f = form.createTextField("kreslil");
    f.setText("J. Novák");
    f.addToPage(page, { x: tbx + 395, y: tby + 115, width: 120, height: 18, font: helv, borderWidth: 0 });
    texts.push({ key: "formField", text: "J. Novák", x: tbx + 397, y: tby + 119, size: 15, sensitive: true });
  }
  if (opts.withAttachment !== false) {
    await doc.attach(new TextEncoder().encode("Kusovnik STROJMETAL"), "kusovnik.txt", { mimeType: "text/plain", description: "BOM" });
  }
  if (opts.extraPages?.includes("drawing")) {
    const p2 = doc.addPage([W, H]);
    p2.drawRectangle({ x: 20, y: 20, width: W - 40, height: H - 40, borderColor: rgb(0, 0, 0), borderWidth: 1.2 });
    p2.drawText(company, { x: tbx + 50, y: tby + 150, size: 12, font: bold });
    p2.drawText("Kreslil:", { x: tbx + 5, y: tby + 122, size: 7, font: helv });
    p2.drawText("J. Novák", { x: tbx + 50, y: tby + 122, size: 8, font: helv });
    p2.drawText("Cislo vykresu:", { x: tbx + 5, y: tby + 30, size: 7, font: helv });
    p2.drawText("D-1234-02", { x: tbx + 135, y: tby + 28, size: 14, font: bold });
  }
  const pdf = await doc.save();
  return { pdf, texts, logo, vectorLogo, width: W, height: H };
}

/** Jednostránková faktura (není výkres). */
export async function makeInvoicePdf(): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  const helv = await doc.embedFont(StandardFonts.Helvetica);
  const p = doc.addPage([595.28, 841.89]);
  p.drawText("FAKTURA c. 2026001", { x: 60, y: 780, size: 16, font: helv });
  p.drawText("Dodavatel: ACME s.r.o., IC 12345678", { x: 60, y: 740, size: 10, font: helv });
  p.drawText("Celkem k uhrade: 12 345,00 Kc", { x: 60, y: 700, size: 10, font: helv });
  return doc.save();
}

// ── Fotka výkresu ─────────────────────────────────────────────

export interface SamplePhoto {
  /** JPEG s EXIF (orientace 6, autor, GPS) — uložené pixely otočené o 90° proti směru hodinových ručiček. */
  jpeg: Uint8Array;
  /** Rozměr po zapečení orientace (4032×3024). */
  width: number;
  height: number;
  /** Bod výkresu (body PDF, počátek vlevo dole) → bod fotky (px po orientaci). */
  map: (xPt: number, yPtFromBottom: number) => [number, number];
  /** Rohy listu ve fotce. */
  sheet: number[];
  angleDeg: number;
  /** Vizitka vedle listu (px fotky). */
  card: { x: number; y: number; w: number; h: number };
}

export async function makePhoto(s: SampleDrawing, opts: { angleDeg?: number } = {}): Promise<SamplePhoto> {
  const sharp = (await import("sharp")).default;
  const { openPdf } = await import("../pdf-node");
  const { renderPageRaster } = await import("../pdf-raster");
  const angle = opts.angleDeg ?? 7; // list natočený proti směru hodinových ručiček
  const W = 4032, H = 3024;
  const k = 3300 / s.width; // ~7,9 px/mm
  const doc = await openPdf(s.pdf);
  const page = await doc.getPage(1);
  const r = await renderPageRaster(page, k, true);
  await doc.destroy();
  const sheetPng = await sharp(Buffer.from(r.data), { raw: { width: r.width, height: r.height, channels: 3 } }).ensureAlpha().png().toBuffer();
  // sharp.rotate(+) = po směru hodinových ručiček → list proti směru = rotate(−angle)
  const rot = await sharp(sheetPng).rotate(-angle, { background: { r: 0, g: 0, b: 0, alpha: 0 } }).png().toBuffer({ resolveWithObject: true });
  const ox = 300, oy = Math.round((H - rot.info.height) / 2);
  const a = (-angle * Math.PI) / 180;
  const cx = r.width / 2, cy = r.height / 2, cx2 = rot.info.width / 2, cy2 = rot.info.height / 2;
  const map = (xPt: number, yPt: number): [number, number] => {
    const x = xPt * k, y = (s.height - yPt) * k;
    return [ox + cx2 + (x - cx) * Math.cos(a) - (y - cy) * Math.sin(a), oy + cy2 + (x - cx) * Math.sin(a) + (y - cy) * Math.cos(a)];
  };
  const corners = [map(0, s.height), map(s.width, s.height), map(s.width, 0), map(0, 0)].flat();
  // vizitka vpravo od listu (text z malého PDF)
  const cardPdf = await PDFDocument.create();
  const helv = await cardPdf.embedFont(StandardFonts.Helvetica);
  const cp = cardPdf.addPage([240, 140]);
  cp.drawText("Ing. Petr Svoboda", { x: 15, y: 100, size: 16, font: helv });
  cp.drawText("STROJMETAL a.s. - nakup", { x: 15, y: 75, size: 12, font: helv });
  cp.drawText("+420 777 123 456", { x: 15, y: 50, size: 12, font: helv });
  const cdoc = await openPdf(await cardPdf.save());
  const cr = await renderPageRaster(await cdoc.getPage(1), 2.2, true);
  await cdoc.destroy();
  const cardPng = await sharp(Buffer.from(cr.data), { raw: { width: cr.width, height: cr.height, channels: 3 } }).png().toBuffer();
  const card = { x: 3420, y: 2560, w: cr.width, h: cr.height };
  const table = await sharp({ create: { width: W, height: H, channels: 3, background: { r: 92, g: 74, b: 60 }, noise: { type: "gaussian", mean: 80, sigma: 18 } } }).png().toBuffer();
  const display = await sharp(table)
    .composite([{ input: rot.data, left: ox, top: oy }, { input: cardPng, left: card.x, top: card.y }])
    .removeAlpha()
    .png()
    .toBuffer();
  // uložené pixely = zobrazení otočené o 90° proti směru (EXIF 6 je při zobrazení vrátí)
  const stored = await sharp(display).rotate(-90).jpeg({ quality: 92 })
    .withMetadata({ orientation: 6, exif: { IFD0: { Artist: "Jan Novak", Make: "Apple", Model: "iPhone 15" }, IFD3: { GPSLatitudeRef: "N", GPSLatitude: "50/1 8/1 0/1" } } })
    .toBuffer();
  return { jpeg: new Uint8Array(stored), width: W, height: H, map, sheet: corners, angleDeg: angle, card };
}
