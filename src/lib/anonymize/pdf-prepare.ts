import "server-only";
import {
  PDFArray, PDFDict, PDFDocument, PDFName, PDFNumber, PDFRef, PDFStream,
  concatTransformationMatrix, drawObject, popGraphicsState, pushGraphicsState,
} from "pdf-lib";

/**
 * Příprava PDF před vykreslením (pdf-lib, čistý JS):
 *  - ZPLOŠTĚNÍ ANOTACÍ: tiskový vzhled (/AP /N) každé tištěné anotace (FreeText, Stamp, Ink, Square,
 *    widget formuláře…) se vloží do obsahu stránky a anotace zmizí. pdf.js pak jejich text čte jako
 *    běžnou textovou vrstvu → pravidla a AI vidí PŘESNĚ to, co se vykreslí (anotace skrytá na obrazovce,
 *    ale tištěná, nebo vzhled jiný než /Contents už neproklouzne). Netištěné / skryté anotace, odkazy a
 *    popupy se odstraní (do výstupu se stejně nevykreslí).
 *  - KONTROLA VELKÝCH OBRÁZKŮ: obrázek nad limitem pdf.js (maxImageSize) by pdf.js tiše vynechal
 *    (prázdná stránka) → stránky s takovým obrázkem se nahlásí a anonymizace skončí srozumitelnou chybou.
 */

export interface PreparedPdf {
  /** Bajty pro pdf.js (originál, když nebylo co zploštit nebo pdf-lib PDF nepřečte). */
  bytes: Uint8Array;
  /** Počet zploštěných anotací po stranách (1-based). */
  flattened: Record<number, number>;
  /** Odstraněné netištěné / skryté anotace. */
  removed: number;
  /** Anotace, které zůstaly (widget bez vzhledu…) — pdf.js je vykreslí sám; text čte z hodnoty pole. */
  kept: number;
  /** Stránky s obrázkem nad limitem (px = největší obrázek). */
  oversized: { page: number; px: number }[];
  /** pdf-lib PDF nepřečetl (šifrované, poškozené) — anotace zůstaly, výsledek ke kontrole. */
  unreadable: boolean;
}

const F_HIDDEN = 2;
const F_PRINT = 4;

function nameOf(v: unknown): string {
  return v instanceof PDFName ? v.asString().replace(/^\//, "") : "";
}

function nums(arr: PDFArray | undefined, ctx: PDFDocument["context"]): number[] | null {
  if (!arr) return null;
  const out: number[] = [];
  for (let i = 0; i < arr.size(); i++) {
    const n = ctx.lookupMaybe(arr.get(i), PDFNumber);
    if (!n) return null;
    out.push(n.asNumber());
  }
  return out;
}

function applyM(m: number[], x: number, y: number): [number, number] {
  return [m[0] * x + m[2] * y + m[4], m[1] * x + m[3] * y + m[5]];
}

/** Největší obrázek (px) v prostředcích stránky včetně vnořených formulářů. */
function largestImage(doc: PDFDocument, res: PDFDict | undefined, seen: Set<string>, depth = 0): number {
  if (!res || depth > 5) return 0;
  const xo = doc.context.lookupMaybe(res.get(PDFName.of("XObject")), PDFDict);
  if (!xo) return 0;
  let max = 0;
  for (const [, v] of xo.entries()) {
    const key = v instanceof PDFRef ? v.toString() : "";
    if (key && seen.has(key)) continue;
    if (key) seen.add(key);
    const s = doc.context.lookup(v);
    if (!(s instanceof PDFStream)) continue;
    const st = nameOf(s.dict.get(PDFName.of("Subtype")));
    if (st === "Image") {
      const w = doc.context.lookupMaybe(s.dict.get(PDFName.of("Width")), PDFNumber)?.asNumber() ?? 0;
      const h = doc.context.lookupMaybe(s.dict.get(PDFName.of("Height")), PDFNumber)?.asNumber() ?? 0;
      max = Math.max(max, w * h);
    } else if (st === "Form") {
      max = Math.max(max, largestImage(doc, doc.context.lookupMaybe(s.dict.get(PDFName.of("Resources")), PDFDict), seen, depth + 1));
    }
  }
  return max;
}

/** Tiskový vzhled anotace (/AP /N, u stavů podle /AS) → reference na Form XObject. */
function normalAppearance(doc: PDFDocument, annot: PDFDict): PDFRef | null {
  const ap = doc.context.lookupMaybe(annot.get(PDFName.of("AP")), PDFDict);
  if (!ap) return null;
  const n = ap.get(PDFName.of("N"));
  if (n instanceof PDFRef) {
    const obj = doc.context.lookup(n);
    if (obj instanceof PDFStream) return n;
    if (obj instanceof PDFDict) {
      const as = nameOf(annot.get(PDFName.of("AS")));
      const st = as ? obj.get(PDFName.of(as)) : undefined;
      return st instanceof PDFRef && doc.context.lookup(st) instanceof PDFStream ? st : null;
    }
    return null;
  }
  if (n instanceof PDFDict) {
    const as = nameOf(annot.get(PDFName.of("AS")));
    const st = as ? n.get(PDFName.of(as)) : undefined;
    return st instanceof PDFRef && doc.context.lookup(st) instanceof PDFStream ? st : null;
  }
  return null;
}

export async function preparePdf(bytes: Uint8Array, maxImagePx: number): Promise<PreparedPdf> {
  const out: PreparedPdf = { bytes, flattened: {}, removed: 0, kept: 0, oversized: [], unreadable: false };
  let doc: PDFDocument;
  try {
    doc = await PDFDocument.load(bytes, { updateMetadata: false, throwOnInvalidObject: false });
  } catch {
    out.unreadable = true;
    return out;
  }
  let changed = false;
  const pages = doc.getPages();
  for (let i = 0; i < pages.length; i++) {
    const page = pages[i];
    const pageNo = i + 1;
    try {
      const px = largestImage(doc, page.node.Resources(), new Set());
      if (px > maxImagePx) out.oversized.push({ page: pageNo, px });
    } catch {
      // nečitelné prostředky — pdf.js rozhodne sám
    }
    const annots = page.node.Annots();
    if (!annots || !annots.size()) continue;
    const keep: (PDFRef | PDFDict)[] = [];
    let n = 0;
    for (let k = 0; k < annots.size(); k++) {
      const raw = annots.get(k);
      const a = doc.context.lookupMaybe(raw, PDFDict);
      if (!a) continue;
      const subtype = nameOf(a.get(PDFName.of("Subtype")));
      const flags = doc.context.lookupMaybe(a.get(PDFName.of("F")), PDFNumber)?.asNumber() ?? 0;
      if (subtype === "Link" || subtype === "Popup" || (flags & F_HIDDEN) || !(flags & F_PRINT)) {
        out.removed++;
        changed = true;
        continue;
      }
      const apRef = normalAppearance(doc, a);
      const rect = nums(doc.context.lookupMaybe(a.get(PDFName.of("Rect")), PDFArray), doc.context);
      const form = apRef ? (doc.context.lookup(apRef) as PDFStream) : null;
      const bbox = form ? nums(doc.context.lookupMaybe(form.dict.get(PDFName.of("BBox")), PDFArray), doc.context) : null;
      if (!apRef || !form || !rect || rect.length !== 4 || !bbox || bbox.length !== 4) {
        // bez vzhledu (widget s hodnotou, FreeText bez AP…) — nechat pdf.js; text čte z hodnoty / Contents
        keep.push(raw as PDFRef | PDFDict);
        out.kept++;
        continue;
      }
      const m = nums(doc.context.lookupMaybe(form.dict.get(PDFName.of("Matrix")), PDFArray), doc.context) ?? [1, 0, 0, 1, 0, 0];
      const pts = [applyM(m, bbox[0], bbox[1]), applyM(m, bbox[2], bbox[1]), applyM(m, bbox[0], bbox[3]), applyM(m, bbox[2], bbox[3])];
      const bx0 = Math.min(...pts.map((p) => p[0])), bx1 = Math.max(...pts.map((p) => p[0]));
      const by0 = Math.min(...pts.map((p) => p[1])), by1 = Math.max(...pts.map((p) => p[1]));
      const rx0 = Math.min(rect[0], rect[2]), rx1 = Math.max(rect[0], rect[2]);
      const ry0 = Math.min(rect[1], rect[3]), ry1 = Math.max(rect[1], rect[3]);
      changed = true;
      if (bx1 - bx0 <= 1e-6 || by1 - by0 <= 1e-6 || rx1 - rx0 <= 1e-6 || ry1 - ry0 <= 1e-6) {
        out.removed++; // neviditelný vzhled
        continue;
      }
      const sx = (rx1 - rx0) / (bx1 - bx0), sy = (ry1 - ry0) / (by1 - by0);
      if (!n) {
        // původní obsah do q … Q (neuzavřený grafický stav by posunul vložené vzhledy)
        page.node.normalize();
        const start = doc.context.register(doc.context.contentStream([pushGraphicsState()]));
        const end = doc.context.register(doc.context.contentStream([popGraphicsState()]));
        page.node.wrapContentStreams(start, end);
      }
      const name = PDFName.of(`AnonAp${pageNo}x${k}`);
      page.node.setXObject(name, apRef);
      // ISO 32000 12.5.5: Matrix (uvnitř Do) × A (BBox po Matrix → Rect)
      page.pushOperators(
        pushGraphicsState(),
        concatTransformationMatrix(sx, 0, 0, sy, rx0 - bx0 * sx, ry0 - by0 * sy),
        drawObject(name),
        popGraphicsState(),
      );
      n++;
    }
    if (n) out.flattened[pageNo] = n;
    if (keep.length !== annots.size()) {
      if (keep.length) page.node.set(PDFName.of("Annots"), doc.context.obj(keep));
      else page.node.delete(PDFName.of("Annots"));
    }
  }
  if (!changed) return out;
  try {
    const saved = await doc.save({ useObjectStreams: false, addDefaultPage: false, updateFieldAppearances: false });
    out.bytes = saved;
  } catch {
    out.unreadable = true;
    out.flattened = {};
  }
  return out;
}
