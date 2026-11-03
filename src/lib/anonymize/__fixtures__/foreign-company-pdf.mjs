// Realistický výkres zákazníka, kde v razítku NENÍ zákazník zakázky z CRM (výkres kreslil koncový zákazník /
// OEM / konstrukční kancelář) — korpus pro anonymizaci (vitest i E2E 42). Čistý JS (pdf-lib), bez TS.
//
// Strana 1 (A3 na šířku): rám, díl s kótami, razítko s firmou „BRISK Tábor a.s." (jiná než zákazník v CRM),
// název firmy převedený na KŘIVKY („KOVOTEX" z čar — export SHX / text na křivky), firma ve fontu Type3 se
// standardními názvy glyfů („HYDROTEK s.r.o." — text jde přečíst) a ve fontu Type3 BEZ použitelného
// kódování („ALFAPLAST" — textová vrstva je nečitelná), ochranná doložka v rámu, natočený text „Property of"
// podél levého okraje, naše firma (Mnástrojárna) v poznámce — zůstává.
// Strana 2 (pokračovací list): jen holé „BRISK" v rohu rámu a „BRISK Tabor" rozsypané po znacích.
//
// Vrací bajty a polohy (body, počátek vlevo nahoře) všeho, co se musí smazat (`gone`) a co musí zůstat (`kept`).

import { PDFDocument, PDFHexString, PDFName, StandardFonts, degrees, rgb, popGraphicsState, pushGraphicsState, beginText, endText, setFontAndSize, moveText, showText } from "pdf-lib";

const W = 1190.55, H = 841.89;

/** Jednoduché čárové písmo (jako SHX / text převedený na křivky): písmeno → úsečky v poli 0..6 × 0..10. */
const STROKES = {
  K: [[0, 0, 0, 10], [0, 4, 6, 10], [2, 6, 6, 0]],
  O: [[0, 0, 6, 0], [6, 0, 6, 10], [6, 10, 0, 10], [0, 10, 0, 0]],
  V: [[0, 10, 3, 0], [3, 0, 6, 10]],
  T: [[0, 10, 6, 10], [3, 10, 3, 0]],
  E: [[6, 0, 0, 0], [0, 0, 0, 10], [0, 10, 6, 10], [0, 5, 4, 5]],
  X: [[0, 0, 6, 10], [0, 10, 6, 0]],
  A: [[0, 0, 3, 10], [3, 10, 6, 0], [1, 4, 5, 4]],
  L: [[0, 10, 0, 0], [0, 0, 6, 0]],
  F: [[0, 0, 0, 10], [0, 10, 6, 10], [0, 5, 4, 5]],
  P: [[0, 0, 0, 10], [0, 10, 6, 10], [6, 10, 6, 5], [6, 5, 0, 5]],
  S: [[6, 10, 0, 10], [0, 10, 0, 5], [0, 5, 6, 5], [6, 5, 6, 0], [6, 0, 0, 0]],
  H: [[0, 0, 0, 10], [6, 0, 6, 10], [0, 5, 6, 5]],
  Y: [[0, 10, 3, 5], [6, 10, 3, 5], [3, 5, 3, 0]],
  D: [[0, 0, 0, 10], [0, 10, 4, 10], [4, 10, 6, 7], [6, 7, 6, 3], [6, 3, 4, 0], [4, 0, 0, 0]],
  R: [[0, 0, 0, 10], [0, 10, 6, 10], [6, 10, 6, 5], [6, 5, 0, 5], [2, 5, 6, 0]],
  ".": [[2.5, 0, 3.5, 0], [3.5, 0, 3.5, 1], [3.5, 1, 2.5, 1], [2.5, 1, 2.5, 0]],
  " ": [],
};

/** Čárový text (křivky) — vrací box v bodech (vlevo nahoře). */
function strokeText(page, text, x, y, size, thickness = 1.1) {
  const sc = size / 10;
  let cx = x;
  for (const ch of text) {
    for (const [x1, y1, x2, y2] of STROKES[ch] ?? []) {
      page.drawLine({ start: { x: cx + x1 * sc, y: y + y1 * sc }, end: { x: cx + x2 * sc, y: y + y2 * sc }, thickness, color: rgb(0, 0, 0) });
    }
    cx += 8.5 * sc;
  }
  return { x: x - 1, y: H - (y + size) - 1, w: cx - x + 2, h: size + 2 };
}

/**
 * Písmo Type3 s glyfy z čar. `names`: "standard" = názvy glyfů A, B… (pdf.js text přečte),
 * "opaque" = kódy 1..n s názvy /g1… (žádný Unicode — textová vrstva je nečitelná, jako CID bez ToUnicode).
 */
function type3Font(doc, letters, names) {
  const ctx = doc.context;
  const procs = {};
  const diffs = [];
  const codes = {};
  const uniq = [...new Set(letters)];
  uniq.forEach((ch, i) => {
    const glyph = names === "standard" ? (ch === "." ? "period" : ch === " " ? "space" : ch) : `g${i + 1}`;
    const ops = [`750 0 0 0 600 1000 d1`, `70 w 1 J`];
    for (const [x1, y1, x2, y2] of STROKES[ch] ?? []) ops.push(`${x1 * 100} ${y1 * 100} m ${x2 * 100} ${y2 * 100} l S`);
    procs[glyph] = ctx.register(ctx.stream(ops.join("\n")));
    const code = names === "standard" ? ch.charCodeAt(0) : 0x80 + i;
    codes[ch] = code;
    diffs.push(code, PDFName.of(glyph));
  });
  const all = Object.values(codes);
  const first = Math.min(...all), last = Math.max(...all);
  const widths = Array.from({ length: last - first + 1 }, () => 850);
  const dict = ctx.obj({
    Type: "Font", Subtype: "Type3", FontBBox: [0, 0, 1000, 1000], FontMatrix: [0.001, 0, 0, 0.001, 0, 0],
    CharProcs: ctx.obj(procs), Encoding: ctx.obj({ Type: "Encoding", Differences: diffs }), FirstChar: first, LastChar: last, Widths: widths,
    Resources: ctx.obj({}),
  });
  return { ref: ctx.register(dict), codes };
}

function type3Text(page, font, tag, text, x, y, size) {
  const key = page.node.newFontDictionary(tag, font.ref);
  const hex = [...text].map((ch) => font.codes[ch].toString(16).padStart(2, "0")).join("");
  page.pushOperators(pushGraphicsState(), beginText(), setFontAndSize(key, size), moveText(x, y), showText(PDFHexString.of(hex)), endText(), popGraphicsState());
  return { x: x - 1, y: H - (y + size) - 1, w: text.length * 0.85 * size + 2, h: size + 2 };
}

/**
 * @param {{ stamp?: string, drawingNumber?: string }} [opts]
 * @returns {Promise<{ bytes: Uint8Array, drawingNumber: string, gone: { page: number, label: string, box: { x: number, y: number, w: number, h: number } }[], kept: { page: number, label: string, box: { x: number, y: number, w: number, h: number } }[] }>}
 */
export async function buildForeignCompanyPdf(opts = {}) {
  const stamp = opts.stamp ?? "A1";
  const dn = opts.drawingNumber ?? `BT-4711-${stamp}`;
  const doc = await PDFDocument.create();
  doc.setAuthor("BRISK Tabor a.s."); doc.setTitle(`Priruba ${dn}`); doc.setProducer("AutoCAD 2024 - English");
  const helv = await doc.embedFont(StandardFonts.Helvetica);
  const bold = await doc.embedFont(StandardFonts.HelveticaBold);
  const gone = [];
  const kept = [];
  /** Text (Helvetica) → box v bodech (vlevo nahoře). */
  const text = (page, s, x, y, size = 8, font = helv) => {
    page.drawText(s, { x, y, size, font, color: rgb(0, 0, 0) });
    return { x: x - 0.5, y: H - (y + size * 0.78) - 0.5, w: font.widthOfTextAtSize(s, size) + 1, h: size * 1.0 + 1 };
  };

  // ── Strana 1 ──
  const p1 = doc.addPage([W, H]);
  p1.drawRectangle({ x: 20, y: 20, width: W - 40, height: H - 40, borderColor: rgb(0, 0, 0), borderWidth: 1.4 });
  // díl a kóty
  p1.drawRectangle({ x: 180, y: 380, width: 460, height: 160, borderColor: rgb(0, 0, 0), borderWidth: 0.8 });
  p1.drawCircle({ x: 410, y: 460, size: 42, borderColor: rgb(0, 0, 0), borderWidth: 0.8 });
  kept.push({ page: 1, label: "kóta 460", box: text(p1, "460 ±0,1", 380, 356, 10) });
  kept.push({ page: 1, label: "kóta Ø84 H7", box: text(p1, "Ø84 H7", 470, 470, 10) });
  kept.push({ page: 1, label: "poznámka tolerance", box: text(p1, "Netolerovane rozmery ISO 2768-mK", 180, 300, 9) });
  kept.push({ page: 1, label: "naše firma", box: text(p1, "Kooperace: Mnastrojarna s.r.o.", 180, 280, 9) });
  // razítko (pravý dolní roh)
  const tbx = W - 20 - 540, tby = 20, tbw = 540, tbh = 180;
  p1.drawRectangle({ x: tbx, y: tby, width: tbw, height: tbh, borderColor: rgb(0, 0, 0), borderWidth: 1 });
  for (const yy of [tby + 40, tby + 80, tby + 120]) p1.drawLine({ start: { x: tbx, y: yy }, end: { x: tbx + tbw, y: yy }, thickness: 0.6 });
  for (const xx of [tbx + 180, tbx + 360]) p1.drawLine({ start: { x: xx, y: tby }, end: { x: xx, y: tby + tbh }, thickness: 0.6 });
  // horní řádek razítka: tři firmy (text, křivky, Type3 čitelný) + Type3 nečitelný pod nimi
  gone.push({ page: 1, label: "firma v razítku (text, jiná než CRM)", box: text(p1, "BRISK Tábor a.s.", tbx + 8, tby + 150, 14, bold) });
  gone.push({ page: 1, label: "firma jako křivky", box: strokeText(p1, "KOVOTEX", tbx + 190, tby + 143, 18) });
  const t3std = type3Font(doc, "HYDROTEK S.R.O", "standard");
  gone.push({ page: 1, label: "firma ve fontu Type3", box: type3Text(p1, t3std, "T3a", "HYDROTEK S.R.O.", tbx + 370, tby + 146, 11) });
  const t3opaque = type3Font(doc, "ALFAPLST", "opaque");
  gone.push({ page: 1, label: "firma ve fontu Type3 bez Unicode", box: type3Text(p1, t3opaque, "T3b", "ALFAPLAST", tbx + 370, tby + 126, 9) });
  // popisky + hodnoty
  text(p1, "Nazev dilu:", tbx + 6, tby + 108, 7); kept.push({ page: 1, label: "název dílu", box: text(p1, "PRIRUBA HRIDELE", tbx + 6, tby + 92, 11, bold) });
  text(p1, "Material:", tbx + 186, tby + 108, 7); kept.push({ page: 1, label: "materiál", box: text(p1, "1.4301", tbx + 186, tby + 92, 11) });
  text(p1, "Meritko:", tbx + 366, tby + 108, 7); kept.push({ page: 1, label: "měřítko", box: text(p1, "1:2", tbx + 366, tby + 92, 11) });
  text(p1, "Kreslil:", tbx + 6, tby + 68, 7); text(p1, "J. Novak", tbx + 6, tby + 52, 10);
  text(p1, "Datum:", tbx + 186, tby + 68, 7); text(p1, "12.03.2026", tbx + 186, tby + 52, 10);
  text(p1, "Format:", tbx + 366, tby + 68, 7); text(p1, "A3", tbx + 366, tby + 52, 10);
  text(p1, "Cislo vykresu:", tbx + 6, tby + 26, 7); kept.push({ page: 1, label: "číslo výkresu", box: text(p1, dn, tbx + 70, tby + 10, 16, bold) });
  text(p1, "List 1/2", tbx + 366, tby + 14, 9);
  // ochranná doložka v rámu (pod razítkem vlevo) a natočený text podél levého okraje
  const cr = "© BRISK Tabor a.s. - Vykres je dusevnim vlastnictvim. Bez souhlasu nekopirovat.";
  gone.push({ page: 1, label: "ochranná doložka", box: { ...text(p1, cr, 30, 26, 6), w: helv.widthOfTextAtSize("© BRISK Tabor a.s.", 6) + 1 } });
  p1.drawText("Property of BRISK Tabor a.s.", { x: 30, y: 300, size: 7, font: helv, rotate: degrees(90), color: rgb(0, 0, 0) });
  gone.push({ page: 1, label: "natočený text v rámu", box: { x: 23, y: H - 300 - helv.widthOfTextAtSize("Property of BRISK Tabor a.s.", 7) - 1, w: 9, h: helv.widthOfTextAtSize("Property of BRISK Tabor a.s.", 7) + 2 } });

  // ── Strana 2 (pokračovací list) ──
  const p2 = doc.addPage([W, H]);
  p2.drawRectangle({ x: 20, y: 20, width: W - 40, height: H - 40, borderColor: rgb(0, 0, 0), borderWidth: 1.4 });
  p2.drawRectangle({ x: 200, y: 300, width: 300, height: 200, borderColor: rgb(0, 0, 0), borderWidth: 0.8 });
  kept.push({ page: 2, label: "kóta 300", box: text(p2, "300", 330, 282, 10) });
  const tb2x = W - 20 - 300;
  p2.drawRectangle({ x: tb2x, y: 20, width: 300, height: 60, borderColor: rgb(0, 0, 0), borderWidth: 1 });
  gone.push({ page: 2, label: "holé jméno firmy na 2. listu", box: text(p2, "BRISK", tb2x + 8, 58, 12, bold) });
  text(p2, "Cislo vykresu:", tb2x + 8, 40, 7); kept.push({ page: 2, label: "číslo výkresu 2", box: text(p2, dn, tb2x + 70, 28, 12, bold) });
  text(p2, "List 2/2", tb2x + 230, 28, 9);
  // „BRISK Tabor" rozsypané po znacích (každý glyf zvlášť, prostrkané)
  let gx = 40;
  const g0 = gx;
  for (const ch of "BRISK Tabor") {
    if (ch !== " ") p2.drawText(ch, { x: gx, y: H - 60, size: 9, font: helv });
    gx += helv.widthOfTextAtSize(ch, 9) + 2.2;
  }
  gone.push({ page: 2, label: "firma rozsypaná po znacích", box: { x: g0 - 0.5, y: 60 - 9 * 0.78 - 0.5, w: gx - g0, h: 10 } });

  return { bytes: await doc.save(), drawingNumber: dn, gone, kept };
}
