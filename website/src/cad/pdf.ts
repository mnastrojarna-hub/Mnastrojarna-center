/**
 * Vektorové PDF výkresu (jsPDF, MIT) s vloženým písmem Roboto (čeština).
 * Rozměr listu v mm, tloušťky a typy čar dle ISO 128, otočené texty.
 */
import { tr } from "./i18n";
import { parseDataUrl } from "./title-logo";
import { svgPdfPaths } from "./title-logo-svg";
import { hostFont } from "./host-assets";
import { LAYER_STYLE, type DrawingResult } from "./drawing";

export type PdfFonts = { regular: ArrayBuffer; bold?: ArrayBuffer };

let fontCache: Promise<PdfFonts> | null = null;

/** Načte písma z /fonts (prohlížeč). */
function loadFonts(): Promise<PdfFonts> {
  if (!fontCache) {
    const get = (u: string) => hostFont(u.slice("/fonts/".length)) ?? fetch(u).then((r) => (r.ok ? r.arrayBuffer() : Promise.reject(new Error(tr("Písmo se nenačetlo."))))); // písma od hostitele (CLI), jinak z webu
    fontCache = Promise.all([get("/fonts/Roboto-Regular.ttf"), get("/fonts/Roboto-Bold.ttf").catch(() => undefined)]).then(([regular, bold]) => ({ regular, bold }));
    fontCache.catch(() => (fontCache = null));
  }
  return fontCache;
}

function toBase64(buf: ArrayBuffer): string {
  const u = new Uint8Array(buf);
  if (typeof Buffer !== "undefined") return Buffer.from(u).toString("base64");
  let s = "";
  for (let i = 0; i < u.length; i += 0x8000) s += String.fromCharCode(...u.subarray(i, i + 0x8000));
  return btoa(s);
}

const DASH: Record<string, number[]> = {
  hidden: [3, 1.5],
  center: [12, 3, 1.5, 3],
  chain: [12, 3, 1.5, 3],
  cut: [12, 3, 1.5, 3],
};

const PT_PER_MM = 72 / 25.4;

export async function drawingToPdf(d: Pick<DrawingResult, "sheet" | "polys" | "texts"> & { title?: string; info?: PdfInfo }, fonts?: PdfFonts): Promise<Blob> {
  return drawingsToPdf([d], d.title, fonts, d.info);
}

/** další údaje Info PDF: předmět a klíčová slova (revize modelu a výkresu – vlna 22, bod 20) */
export type PdfInfo = { subject?: string; keywords?: string };

type PdfPage = Pick<DrawingResult, "sheet" | "polys" | "texts">;
type JsPdf = InstanceType<typeof import("jspdf").jsPDF>;

/** Vícestránkové PDF – každý list výkresu jedna stránka ve svém formátu a orientaci (export „Všechny listy“). */
export async function drawingsToPdf(pages: PdfPage[], title?: string, fonts?: PdfFonts, info?: PdfInfo): Promise<Blob> {
  if (!pages.length) throw new Error(tr("Výkres nemá žádný list."));
  const { jsPDF } = await import("jspdf");
  const f = fonts ?? (await loadFonts());
  const fmt = (p: PdfPage) => ({ o: (p.sheet.w >= p.sheet.h ? "landscape" : "portrait") as "landscape" | "portrait", f: [Math.min(p.sheet.w, p.sheet.h), Math.max(p.sheet.w, p.sheet.h)] });
  const first = fmt(pages[0]);
  const pdf = new jsPDF({ orientation: first.o, unit: "mm", format: first.f, compress: true });
  pdf.setProperties({ title: title ?? tr("Výkres"), creator: "Mnástrojárna CAD", author: "Mnástrojárna s.r.o.", ...(info?.subject ? { subject: info.subject } : {}), ...(info?.keywords ? { keywords: info.keywords } : {}) });
  pdf.addFileToVFS("Roboto-Regular.ttf", toBase64(f.regular));
  pdf.addFont("Roboto-Regular.ttf", "Roboto", "normal");
  if (f.bold) {
    pdf.addFileToVFS("Roboto-Bold.ttf", toBase64(f.bold));
    pdf.addFont("Roboto-Bold.ttf", "Roboto", "bold");
  }
  pages.forEach((d, i) => {
    if (i) {
      const x = fmt(d);
      pdf.addPage(x.f, x.o);
    }
    drawPage(pdf, d, f);
  });
  return new Blob([pdf.output("arraybuffer")], { type: "application/pdf" });
}

/** Jedna stránka: čáry a plošky po vrstvách (ISO 128), texty Roboto. */
function drawPage(pdf: JsPdf, d: PdfPage, f: PdfFonts) {
  pdf.setFont("Roboto", "normal");
  pdf.setLineCap("round");
  pdf.setLineJoin("round");

  for (const p of d.polys) {
    if (p.pts.length < 2) continue;
    if (p.img?.svg) {
      // logo SVG jako vektor (vlna 22, bod 22j): vyplněné tvary loga cestami PDF; nečitelné SVG → bitmapa níže
      try {
        const svg = new TextDecoder().decode(parseDataUrl(p.img.svg)?.bytes ?? new Uint8Array());
        const paths = svgPdfPaths(svg, p.img.x, p.img.y, p.img.w, p.img.h);
        if (paths.length) {
          for (const sh of paths) {
            const c = sh.fill;
            pdf.setFillColor(parseInt(c.slice(1, 3), 16), parseInt(c.slice(3, 5), 16), parseInt(c.slice(5, 7), 16));
            for (const pl of sh.polys) {
              if (pl.length < 3) continue;
              pdf.moveTo(pl[0][0], pl[0][1]);
              for (let i = 1; i < pl.length; i++) pdf.lineTo(pl[i][0], pl[i][1]);
              pdf.close();
            }
            if (sh.rule === "evenodd") pdf.fillEvenOdd();
            else pdf.fill();
          }
          continue;
        }
      } catch {
        /* bitmapa níže */
      }
    }
    if (p.img) {
      // logo razítka jako bitmapa (PNG / JPEG); nečitelný obrázek → jen rámeček
      try {
        const kind = /^data:image\/jpe?g/i.test(p.img.src) ? "JPEG" : "PNG";
        pdf.addImage(p.img.src, kind, p.img.x, p.img.y, p.img.w, p.img.h, undefined, "FAST");
        continue;
      } catch {
        /* rámeček níže */
      }
    }
    const st = LAYER_STYLE[p.layer];
    const gray = st.color === "#111" ? 17 : st.color === "#222" ? 34 : 51;
    if (p.fill) {
      pdf.setFillColor(gray, gray, gray);
      const [a, b, c] = p.pts;
      if (c) pdf.triangle(a[0], a[1], b[0], b[1], c[0], c[1], "F");
      continue;
    }
    pdf.setDrawColor(gray, gray, gray);
    pdf.setLineWidth(p.width ?? st.w);
    const dash = p.width == null ? DASH[p.layer] : undefined;
    pdf.setLineDashPattern(dash ?? [], 0);
    pdf.moveTo(p.pts[0][0], p.pts[0][1]);
    for (let i = 1; i < p.pts.length; i++) pdf.lineTo(p.pts[i][0], p.pts[i][1]);
    pdf.stroke();
  }
  pdf.setLineDashPattern([], 0);

  for (const t of d.texts) {
    pdf.setFont("Roboto", t.bold && f.bold ? "bold" : "normal");
    pdf.setFontSize(t.size * PT_PER_MM);
    if (t.brand) pdf.setTextColor(224, 57, 48);
    else pdf.setTextColor(17, 17, 17);
    const rot = ((t.rotate ?? 0) * Math.PI) / 180;
    const tw = pdf.getTextWidth(t.s);
    const shift = t.anchor === "middle" ? -tw / 2 : t.anchor === "end" ? -tw : 0;
    // SVG: rotace po směru hodinových ručiček (y dolů); jsPDF: úhel proti směru
    const x = t.x + shift * Math.cos(rot);
    const y = t.y + shift * Math.sin(rot);
    pdf.text(t.s, x, y, { angle: -(t.rotate ?? 0), baseline: "alphabetic" });
  }
}
