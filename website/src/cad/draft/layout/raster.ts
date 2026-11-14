/**
 * BALÍK 3 (layout) – stránka tisku jako SVG (vektorově, mm) a na Canvas 2D (náhled tisku v GUI a export PNG).
 * Obojí kreslí stejné prvky jako PDF (plot.ts), takže náhled odpovídá výstupu.
 */
import type { PathCmd, PlotPage, RGB } from "./plot";
import { pn } from "./pdf";

const hex = (c: RGB) => `#${c.map((v) => v.toString(16).padStart(2, "0")).join("")}`;
const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

function svgPath(cmds: PathCmd[], H: number): string {
  const y = (v: number) => pn(H - v);
  return cmds
    .map((c) => (c.k === "M" ? `M${pn(c.p[0])} ${y(c.p[1])}` : c.k === "L" ? `L${pn(c.p[0])} ${y(c.p[1])}` : c.k === "C" ? `C${pn(c.c1[0])} ${y(c.c1[1])} ${pn(c.c2[0])} ${y(c.c2[1])} ${pn(c.p[0])} ${y(c.p[1])}` : "Z"))
    .join("");
}

/** SVG stránky: rozměr v mm (viewBox = mm), osa Y dolů (převod z papíru), text písmem Roboto */
export function pageToSvg(p: PlotPage, title = ""): string {
  const H = p.h;
  const out: string[] = [
    `<?xml version="1.0" encoding="UTF-8"?>`,
    `<svg xmlns="http://www.w3.org/2000/svg" width="${pn(p.w)}mm" height="${pn(p.h)}mm" viewBox="0 0 ${pn(p.w)} ${pn(p.h)}">`,
    title ? `<title>${esc(title)}</title>` : "",
    `<rect width="100%" height="100%" fill="#fff"/>`,
  ];
  let clipN = 0;
  const open: number[] = [];
  for (const it of p.items) {
    if (it.k === "stroke") out.push(`<path d="${svgPath(it.cmds, H)}" fill="none" stroke="${hex(it.color)}" stroke-width="${pn(Math.max(it.lw, 0.05))}" stroke-linecap="${it.cap}" stroke-linejoin="round"/>`);
    else if (it.k === "fill") out.push(`<path d="${svgPath(it.cmds, H)}" fill="${hex(it.color)}" fill-rule="evenodd"/>`);
    else if (it.k === "clip") {
      clipN++;
      out.push(`<clipPath id="c${clipN}"><polygon points="${it.poly.map((q) => `${pn(q[0])},${pn(H - q[1])}`).join(" ")}"/></clipPath><g clip-path="url(#c${clipN})">`);
      open.push(clipN);
    } else if (it.k === "unclip") {
      if (open.pop() !== undefined) out.push("</g>");
    } else if (it.k === "text") {
      // matice textu: osy X a Y textu (papír, osa Y nahoru) → SVG (osa Y dolů); velikost písma = výška verzálek / 0,711
      const fs = it.h / 0.711;
      const a = it.x[0] * fs;
      const b = -it.x[1] * fs;
      const c = -it.y[0] * fs;
      const d = it.y[1] * fs;
      out.push(`<text transform="matrix(${pn(a)} ${pn(b)} ${pn(c)} ${pn(d)} ${pn(it.p[0])} ${pn(H - it.p[1])})" font-family="Roboto, Arial, sans-serif" font-size="1" fill="${hex(it.color)}">${esc(it.s)}</text>`);
    }
  }
  while (open.pop() !== undefined) out.push("</g>");
  out.push("</svg>");
  return out.filter(Boolean).join("\n");
}

/**
 * Vykreslí stránku na Canvas 2D: `pxPerMm` px na mm, posun `off` (px), bílý papír. Tloušťky čar v mm × pxPerMm
 * (nejméně 0,5 px), takže náhled ukáže i rozdíl tlouštěk.
 */
export function drawPage(ctx: CanvasRenderingContext2D, p: PlotPage, pxPerMm: number, off: [number, number] = [0, 0], opts: { paper?: boolean } = {}) {
  const X = (v: number) => off[0] + v * pxPerMm;
  const Y = (v: number) => off[1] + (p.h - v) * pxPerMm;
  ctx.save();
  if (opts.paper !== false) {
    ctx.fillStyle = "#ffffff";
    ctx.fillRect(X(0), Y(p.h), p.w * pxPerMm, p.h * pxPerMm);
  }
  ctx.lineJoin = "round";
  const path = (cmds: PathCmd[]) => {
    ctx.beginPath();
    for (const c of cmds) {
      if (c.k === "M") ctx.moveTo(X(c.p[0]), Y(c.p[1]));
      else if (c.k === "L") ctx.lineTo(X(c.p[0]), Y(c.p[1]));
      else if (c.k === "C") ctx.bezierCurveTo(X(c.c1[0]), Y(c.c1[1]), X(c.c2[0]), Y(c.c2[1]), X(c.p[0]), Y(c.p[1]));
      else ctx.closePath();
    }
  };
  let depth = 0;
  for (const it of p.items) {
    if (it.k === "stroke") {
      ctx.strokeStyle = hex(it.color);
      ctx.lineWidth = Math.max(0.5, it.lw * pxPerMm);
      ctx.lineCap = it.cap;
      path(it.cmds);
      ctx.stroke();
    } else if (it.k === "fill") {
      ctx.fillStyle = hex(it.color);
      path(it.cmds);
      ctx.fill("evenodd");
    } else if (it.k === "clip") {
      ctx.save();
      depth++;
      ctx.beginPath();
      it.poly.forEach((q, i) => (i ? ctx.lineTo(X(q[0]), Y(q[1])) : ctx.moveTo(X(q[0]), Y(q[1]))));
      ctx.closePath();
      ctx.clip();
    } else if (it.k === "unclip") {
      if (depth > 0) {
        ctx.restore();
        depth--;
      }
    } else if (it.k === "text") {
      const fs = it.h / 0.711;
      if (fs * Math.hypot(it.y[0], it.y[1]) * pxPerMm < 1) continue;
      ctx.save();
      ctx.transform(it.x[0] * fs * pxPerMm, -it.x[1] * fs * pxPerMm, -it.y[0] * fs * pxPerMm, it.y[1] * fs * pxPerMm, X(it.p[0]), Y(it.p[1]));
      ctx.font = "1px Roboto, Arial, sans-serif";
      ctx.fillStyle = hex(it.color);
      ctx.textBaseline = "alphabetic";
      ctx.fillText(it.s, 0, 0);
      ctx.restore();
    }
  }
  while (depth-- > 0) ctx.restore();
  ctx.restore();
}

/** PNG stránky v daném rozlišení (jen v prohlížeči) */
export async function pageToPng(p: PlotPage, dpi = 150): Promise<Uint8Array> {
  if (typeof document === "undefined") throw new Error("PNG: canvas není k dispozici");
  const k = dpi / 25.4;
  const w = Math.max(1, Math.round(p.w * k));
  const h = Math.max(1, Math.round(p.h * k));
  if (w * h > 120e6) throw new Error(`PNG ${w}×${h} px je příliš velké – snižte DPI`);
  const c = document.createElement("canvas");
  c.width = w;
  c.height = h;
  const ctx = c.getContext("2d");
  if (!ctx) throw new Error("PNG: canvas 2D");
  drawPage(ctx, p, k);
  const blob: Blob = await new Promise((res, rej) => c.toBlob((b) => (b ? res(b) : rej(new Error("PNG"))), "image/png"));
  return new Uint8Array(await blob.arrayBuffer());
}
