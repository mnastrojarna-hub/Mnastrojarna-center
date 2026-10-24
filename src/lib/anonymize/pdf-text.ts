import "server-only";
import { buildLines, quadBox, substringQuad } from "./lines";
import { isCompanyRow, isRevisionAnchor, isTitleAnchor } from "./rules";
import { textQuality, type TextQuality } from "./text-quality";
import { loadPdfjs, type PdfDocument, type PdfPage } from "./pdf-node";
import type { Box, TextItem, TextLine, Zone } from "./types";

/**
 * Textová vrstva vektorového PDF (spec §2.2): položky s polohou (i anotace a formuláře),
 * obrázky z operátorů (logo, sken), řádky, zóny (razítko, revize, rám, tělo) a kvalita vrstvy.
 * Souřadnice v bodech viewportu (scale 1, /Rotate zapečený), počátek vlevo nahoře.
 */

export interface PdfImageBox {
  box: Box;
  pxW: number;
  pxH: number;
}

export interface PdfAnnot {
  box: Box;
  subtype: string;
  text: string;
}

export interface PdfPageInfo {
  page: number;
  widthPt: number;
  heightPt: number;
  rotate: number;
  items: TextItem[];
  lines: TextLine[];
  images: PdfImageBox[];
  annots: PdfAnnot[];
  titleBlock: Box | null;
  /** Výchozí oblast razítka (pravý dolní roh 45 % × 30 %), když kotvy chybí. */
  titleBlockGuess: Box;
  revisions: Box | null;
  anchors: number;
  quality: TextQuality;
  /** Obrázek pokrývající > 50 % stránky = skenová stránka (nativní rozlišení obrázku). */
  scan: PdfImageBox | null;
  frameBand: number;
  /** Počet kreslicích operátorů (bez save/restore/transform) — prázdný render u neprázdné stránky = chyba. */
  opCount?: number;
}

export const MAX_PDF_PAGES = 200;
export const PAGES_PER_RUN = 10;

type Mat = [number, number, number, number, number, number];

function mul(m1: readonly number[], m2: readonly number[]): Mat {
  return [
    m1[0] * m2[0] + m1[2] * m2[1], m1[1] * m2[0] + m1[3] * m2[1],
    m1[0] * m2[2] + m1[2] * m2[3], m1[1] * m2[2] + m1[3] * m2[3],
    m1[0] * m2[4] + m1[2] * m2[5] + m1[4], m1[1] * m2[4] + m1[3] * m2[5] + m1[5],
  ];
}

function apply(m: readonly number[], x: number, y: number): [number, number] {
  return [m[0] * x + m[2] * y + m[4], m[1] * x + m[3] * y + m[5]];
}

function unitSquareBox(m: readonly number[]): Box {
  const pts = [apply(m, 0, 0), apply(m, 1, 0), apply(m, 0, 1), apply(m, 1, 1)];
  const xs = pts.map((p) => p[0]), ys = pts.map((p) => p[1]);
  const x = Math.min(...xs), y = Math.min(...ys);
  return { x, y, w: Math.max(...xs) - x, h: Math.max(...ys) - y };
}

const CAD_PRODUCERS = /autocad|autodesk|solidworks|inventor|catia|siemens nx|unigraphics|\bnx\b|creo|pro\/?engineer|solid ?edge|draftsight|bricscad|zwcad|progecad|fusion ?360|onshape|thinkdesign|topsolid|vectorworks|microstation|kompas|t-flex|hicad|me10|cocreate|caddy|eplan|tebis|cimatron|visi|alibre|freecad|librecad|qcad|ares commander|gstarcad|plot ?station|hp-gl|plotter|dwg ?trueview|teigha|open design/i;

export function looksLikeCadProducer(info: Record<string, unknown> | null | undefined): boolean {
  if (!info) return false;
  const s = [info.Producer, info.Creator, info.Title].filter((v) => typeof v === "string").join(" ");
  return CAD_PRODUCERS.test(s);
}

function annotText(a: Record<string, unknown>): string {
  const parts: string[] = [];
  const push = (v: unknown) => {
    if (typeof v === "string" && v.trim()) parts.push(v.trim());
    else if (Array.isArray(v)) for (const x of v) push(x);
  };
  push(a.fieldValue);
  push((a.contentsObj as { str?: unknown } | undefined)?.str);
  push((a.titleObj as { str?: unknown } | undefined)?.str);
  const rich = a.richText as { str?: unknown } | undefined;
  push(rich?.str);
  push(a.alternativeText);
  return [...new Set(parts)].join(" ");
}

/** Zóny stránky: razítko (shluk kotev → k pravému/dolnímu okraji), revize, rám (4 %). */
export function computeZones(lines: readonly { text: string; box: Box }[], W: number, H: number): { titleBlock: Box | null; guess: Box; revisions: Box | null; anchors: number } {
  const guess: Box = { x: W * 0.55, y: H * 0.7, w: W * 0.45, h: H * 0.3 };
  const anchors = lines.filter((l) => isTitleAnchor(l.text));
  let titleBlock: Box | null = null;
  if (anchors.length >= 2) {
    const cx = anchors.map((a) => a.box.x + a.box.w / 2).sort((a, b) => a - b);
    const cy = anchors.map((a) => a.box.y + a.box.h / 2).sort((a, b) => a - b);
    const mx = cx[Math.floor(cx.length / 2)], my = cy[Math.floor(cy.length / 2)];
    const near = anchors.filter((a) => Math.abs(a.box.x + a.box.w / 2 - mx) < 0.35 * W && Math.abs(a.box.y + a.box.h / 2 - my) < 0.3 * H);
    if (near.length >= 2) {
      let x0 = Math.min(...near.map((a) => a.box.x)), y0 = Math.min(...near.map((a) => a.box.y));
      let x1 = Math.max(...near.map((a) => a.box.x + a.box.w)), y1 = Math.max(...near.map((a) => a.box.y + a.box.h));
      // název firmy a logo bývají v horní části razítka nad kotvami → svisle větší rezerva
      const padX = Math.max(0.1 * (x1 - x0), 0.02 * W), padY = Math.max(0.25 * (y1 - y0), 0.04 * H);
      x0 -= padX; y0 -= padY; x1 += padX; y1 += padY;
      // razítko sedí v rohu u rámu → protáhnout k okraji, je-li blízko
      if ((x0 + x1) / 2 > W / 2) x1 = W;
      if ((y0 + y1) / 2 > H / 2 && H - y1 < 0.15 * H) y1 = H;
      titleBlock = { x: Math.max(0, x0), y: Math.max(0, y0), w: Math.min(W, x1) - Math.max(0, x0), h: Math.min(H, y1) - Math.max(0, y0) };
      titleBlock = extendTitleBlockUp(titleBlock, lines, H);
    }
  }
  let revisions: Box | null = null;
  const revs = lines.filter((l) => isRevisionAnchor(l.text) && l.text.length < 60);
  for (const r of revs) {
    const b: Box = { x: Math.max(0, r.box.x - 0.05 * W), y: Math.max(0, r.box.y - 0.12 * H), w: Math.min(0.45 * W, W - Math.max(0, r.box.x - 0.05 * W)), h: Math.min(0.24 * H, H) };
    revisions = revisions ? union(revisions, b) : b;
  }
  return { titleBlock, guess, revisions, anchors: anchors.length };
}

/**
 * Řádek firmy („Zákazník: ACME Forge GmbH", „STROJMETAL a.s.") bývá v horní části razítka výš než
 * popisky + rezerva → zónu razítka protáhnout nahoru o takové řádky (svisle ≤ 12 % výšky stránky nad
 * horním okrajem, vodorovně z větší části nad razítkem), řetězově nejvýš 3×.
 */
export function extendTitleBlockUp(tb: Box, lines: readonly { text: string; box: Box }[], H: number): Box {
  let z = tb;
  for (let k = 0; k < 3; k++) {
    const cur = z;
    const ext = lines.filter((l) => {
      const b = l.box;
      if (b.y + b.h / 2 >= cur.y) return false; // už uvnitř / pod horním okrajem
      if (cur.y - b.y > 0.12 * H) return false;
      const ox = Math.max(0, Math.min(b.x + b.w, cur.x + cur.w) - Math.max(b.x, cur.x));
      if (ox < 0.5 * Math.min(b.w, cur.w)) return false;
      return isCompanyRow(l.text);
    });
    if (!ext.length) break;
    const top = Math.max(0, Math.min(...ext.map((l) => l.box.y)) - 0.01 * H);
    z = { x: cur.x, y: top, w: cur.w, h: cur.y + cur.h - top };
  }
  return z;
}

function union(a: Box, b: Box): Box {
  const x = Math.min(a.x, b.x), y = Math.min(a.y, b.y);
  return { x, y, w: Math.max(a.x + a.w, b.x + b.w) - x, h: Math.max(a.y + a.h, b.y + b.h) - y };
}

function inside(b: Box, z: Box | null): boolean {
  if (!z) return false;
  const cx = b.x + b.w / 2, cy = b.y + b.h / 2;
  return cx >= z.x && cx <= z.x + z.w && cy >= z.y && cy <= z.y + z.h;
}

export function zoneFor(b: Box, z: { titleBlock: Box | null; guess: Box; revisions: Box | null }, W: number, H: number, band = 0.04): Zone {
  if (inside(b, z.revisions) && !inside(b, z.titleBlock)) return "revisions";
  if (inside(b, z.titleBlock ?? z.guess)) return inside(b, z.revisions) ? "revisions" : "title_block";
  const cx = b.x + b.w / 2, cy = b.y + b.h / 2;
  if (cx < band * W || cx > (1 - band) * W || cy < band * H || cy > (1 - band) * H) return "frame";
  return "body";
}

/** Textová vrstva, anotace, obrázky a zóny jedné stránky. */
export async function extractPage(pdf: PdfDocument, pageNo: number): Promise<{ info: PdfPageInfo; page: PdfPage }> {
  const pdfjs = await loadPdfjs();
  const page = await pdf.getPage(pageNo);
  const vp = page.getViewport({ scale: 1 });
  const W = vp.width, H = vp.height;
  const vt = vp.transform as number[];
  const items: TextItem[] = [];

  const tc = await page.getTextContent({ includeMarkedContent: false, disableNormalization: false });
  let k = 0;
  for (const raw of tc.items as unknown as Record<string, unknown>[]) {
    if (typeof raw.str !== "string" || !raw.str) continue;
    const t = raw.transform as number[];
    const m = mul(vt, t);
    const em = Math.hypot(m[2], m[3]) || Math.abs(Number(raw.height) || 0) || 1;
    const dirLen = Math.hypot(m[0], m[1]) || 1;
    const rot = Math.atan2(-m[1], m[0]) * 180 / Math.PI;
    const adv = Math.abs(Number(raw.width) || 0) * vp.scale || (raw.str.length * em * 0.5);
    const it: TextItem = {
      id: `p${pageNo}:i${k++}`, page: pageNo, str: raw.str, x: 0, y: 0, w: 0, h: 0, fontSize: em,
      rot: Math.abs(rot) < 0.5 ? 0 : rot, source: "text", fontName: typeof raw.fontName === "string" ? raw.fontName : undefined,
      ox: m[4], oy: m[5], adv,
    };
    void dirLen;
    const box = quadBox(substringQuad(it, 0, it.str.length, 0));
    Object.assign(it, box);
    items.push(it);
  }

  // anotace a formuláře (M9)
  const annots: PdfAnnot[] = [];
  try {
    // tiskový záměr = stejné anotace, jaké vykreslí render (intent print); tištěné vzhledy už zploštila
    // příprava (pdf-prepare) do obsahu stránky — tady zbývají jen pole bez vzhledu
    const list = (await page.getAnnotations({ intent: "print" })) as Record<string, unknown>[];
    for (const a of list) {
      const rect = a.rect as number[] | undefined;
      if (!rect || rect.length !== 4) continue;
      const r = vp.convertToViewportRectangle(rect) as number[];
      const box: Box = { x: Math.min(r[0], r[2]), y: Math.min(r[1], r[3]), w: Math.abs(r[2] - r[0]), h: Math.abs(r[3] - r[1]) };
      const subtype = String(a.subtype ?? a.annotationType ?? "");
      if (subtype === "Link" || subtype === "Popup") continue;
      const text = annotText(a);
      annots.push({ box, subtype, text });
      if (text) {
        const fs = Math.max(2, Math.min(box.h, 12));
        items.push({ id: `p${pageNo}:a${annots.length}`, page: pageNo, str: text, ...box, fontSize: fs, rot: 0, source: "annotation", ox: box.x, oy: box.y + box.h, adv: box.w });
      }
    }
  } catch {
    // anotace jsou bonus — bez nich se pokračuje (render je stejně zapéká)
  }

  // obrázky z operátorů
  const images: PdfImageBox[] = [];
  let opCount = 0;
  try {
    const ops = await page.getOperatorList({ intent: "print" });
    const OPS = pdfjs.OPS as Record<string, number>;
    const trivial = new Set([OPS.save, OPS.restore, OPS.transform, OPS.dependency]);
    opCount = ops.fnArray.filter((f) => !trivial.has(f)).length;
    let ctm: Mat = [...vt] as Mat;
    const stack: Mat[] = [];
    for (let i = 0; i < ops.fnArray.length; i++) {
      const fn = ops.fnArray[i];
      const args = ops.argsArray[i] as unknown[];
      if (fn === OPS.save) stack.push(ctm);
      else if (fn === OPS.restore) ctm = stack.pop() ?? ctm;
      else if (fn === OPS.transform) ctm = mul(ctm, args as number[]);
      else if (fn === OPS.paintFormXObjectBegin) {
        stack.push(ctm);
        const mtx = args?.[0] as number[] | null;
        if (Array.isArray(mtx) && mtx.length === 6) ctm = mul(ctm, mtx);
      } else if (fn === OPS.paintFormXObjectEnd) ctm = stack.pop() ?? ctm;
      else if (fn === OPS.paintImageXObject || fn === OPS.paintInlineImageXObject || fn === OPS.paintImageMaskXObject || fn === OPS.paintImageXObjectRepeat) {
        let pxW = 0, pxH = 0;
        const a0 = args?.[0] as { width?: number; height?: number } | string | undefined;
        if (typeof a0 === "object" && a0) {
          pxW = Number(a0.width) || 0;
          pxH = Number(a0.height) || 0;
        } else {
          pxW = Number(args?.[1]) || 0;
          pxH = Number(args?.[2]) || 0;
        }
        const box = unitSquareBox(ctm);
        if (box.w > 0.5 && box.h > 0.5) images.push({ box, pxW, pxH });
      }
    }
  } catch {
    // bez seznamu operátorů nepoznáme logo-obrázky — rozhodne AI / review
  }

  const pre = buildLines(items, pageNo, () => "body");
  const z = computeZonesOriented(pre, W, H, dominantRotation(items));
  const lines = pre.map((l) => ({ ...l, zone: zoneFor(l.box, z, W, H) }));
  const scan = images.find((im) => im.box.w * im.box.h > 0.5 * W * H) ?? null;
  const quality = textQuality({ strings: items.filter((i) => i.source === "text").map((i) => i.str), hasTitleAnchors: z.anchors > 0 });
  const info: PdfPageInfo = {
    page: pageNo, widthPt: W, heightPt: H, rotate: (page.rotate ?? 0) as number, items, lines, images, annots,
    titleBlock: z.titleBlock, titleBlockGuess: z.guess, revisions: z.revisions, anchors: z.anchors, quality, scan, frameBand: 0.04, opCount,
  };
  return { info, page };
}

/** Převládající směr čtení textu (0 / 90 / 180 / −90) podle délky textu. */
export function dominantRotation(items: readonly { rot: number; str: string; source?: string }[]): 0 | 90 | 180 | -90 {
  const score = new Map<number, number>();
  for (const it of items) {
    if (it.source && it.source !== "text") continue;
    const r = Math.round((it.rot || 0) / 90) * 90;
    const k = ((r % 360) + 540) % 360 - 180; // −180..179
    const key = k === -180 ? 180 : k;
    if (![0, 90, 180, -90].includes(key)) continue;
    score.set(key, (score.get(key) ?? 0) + it.str.trim().length);
  }
  let best: 0 | 90 | 180 | -90 = 0;
  let bestScore = -1;
  for (const [k, v] of score) if (v > bestScore) { best = k as 0 | 90 | 180 | -90; bestScore = v; }
  // jen jasná převaha (natočené kóty na běžném výkresu směr nemění)
  return bestScore > 1.5 * (score.get(0) ?? 0) ? best : 0;
}

/**
 * Zóny ve směru čtení: u výkresu otočeného na stránce (/Rotate 90, list naležato) se řádky převedou do
 * souřadnic, ve kterých se text čte vodorovně, tam se najde razítko (pravý dolní roh) a výsledek se
 * převede zpět do bodů viewportu.
 */
export function computeZonesOriented(lines: readonly { text: string; box: Box }[], W: number, H: number, rot: 0 | 90 | 180 | -90): ReturnType<typeof computeZones> {
  if (rot === 0) return computeZones(lines, W, H);
  // viewport → čtecí rámec (osové obdélníky zůstanou osové)
  const fw = rot === 180 ? W : H, fh = rot === 180 ? H : W;
  const toF = (b: Box): Box => {
    if (rot === 90) return { x: H - (b.y + b.h), y: b.x, w: b.h, h: b.w }; // text jde nahoru
    if (rot === -90) return { x: b.y, y: W - (b.x + b.w), w: b.h, h: b.w }; // text jde dolů
    return { x: W - (b.x + b.w), y: H - (b.y + b.h), w: b.w, h: b.h };
  };
  const fromF = (b: Box | null): Box | null => {
    if (!b) return null;
    if (rot === 90) return { x: b.y, y: H - (b.x + b.w), w: b.h, h: b.w };
    if (rot === -90) return { x: W - (b.y + b.h), y: b.x, w: b.h, h: b.w };
    return { x: W - (b.x + b.w), y: H - (b.y + b.h), w: b.w, h: b.h };
  };
  const z = computeZones(lines.map((l) => ({ text: l.text, box: toF(l.box) })), fw, fh);
  return { titleBlock: fromF(z.titleBlock), guess: fromF(z.guess)!, revisions: fromF(z.revisions), anchors: z.anchors };
}
