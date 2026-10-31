/**
 * Vektorové PDF výkresu (jsPDF, MIT) s vloženým písmem Roboto (čeština).
 * Rozměr listu v mm, tloušťky a typy čar dle ISO 128, otočené texty.
 */
import { LAYER_STYLE, type DrawingResult } from "./drawing";

export type PdfFonts = { regular: ArrayBuffer; bold?: ArrayBuffer };

let fontCache: Promise<PdfFonts> | null = null;

/** Načte písma z /fonts (prohlížeč). */
function loadFonts(): Promise<PdfFonts> {
  if (!fontCache) {
    const get = (u: string) => fetch(u).then((r) => (r.ok ? r.arrayBuffer() : Promise.reject(new Error("Písmo se nenačetlo."))));
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
  cut: [12, 3, 1.5, 3],
};

const PT_PER_MM = 72 / 25.4;

export async function drawingToPdf(d: Pick<DrawingResult, "sheet" | "polys" | "texts"> & { title?: string }, fonts?: PdfFonts): Promise<Blob> {
  const { jsPDF } = await import("jspdf");
  const f = fonts ?? (await loadFonts());
  const { w, h } = d.sheet;
  const pdf = new jsPDF({ orientation: w >= h ? "landscape" : "portrait", unit: "mm", format: [Math.min(w, h), Math.max(w, h)], compress: true });
  pdf.setProperties({ title: d.title ?? "Výkres", creator: "Mnástrojárna CAD", author: "Mnástrojárna s.r.o." });
  pdf.addFileToVFS("Roboto-Regular.ttf", toBase64(f.regular));
  pdf.addFont("Roboto-Regular.ttf", "Roboto", "normal");
  if (f.bold) {
    pdf.addFileToVFS("Roboto-Bold.ttf", toBase64(f.bold));
    pdf.addFont("Roboto-Bold.ttf", "Roboto", "bold");
  }
  pdf.setFont("Roboto", "normal");
  pdf.setLineCap("round");
  pdf.setLineJoin("round");

  for (const p of d.polys) {
    if (p.pts.length < 2) continue;
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
  return new Blob([pdf.output("arraybuffer")], { type: "application/pdf" });
}
