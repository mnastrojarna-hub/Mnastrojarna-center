import "server-only";
import { PDFDocument, PDFName, PDFNumber, concatTransformationMatrix, drawObject, popGraphicsState, pushGraphicsState } from "pdf-lib";
import { loadPdfjs, openPdf, type PdfPage } from "./pdf-node";
import type { Box, Quad } from "./types";

/**
 * Bezpečné začernění PDF (spec §3.1): stránka se VYKRESLÍ do rastru (po pásech ≤ 8 MPx), oblasti se
 * vypálí do pixelů a z rastru vznikne NOVÉ PDF (vlastní šedý/RGB image XObject s Predictor 15, sken
 * JPEG). Výsledek nemá textovou vrstvu, písma, anotace, formuláře, JS, XMP ani metadata — strojově
 * se to ověří (checkPdfOutput) spolu s inkoustem ponechaného textu a zbytky kolem smazaných míst.
 */

export interface Raster {
  width: number;
  height: number;
  channels: 1 | 3;
  data: Uint8Array;
}

export const MAX_DPI = 300;
export const MIN_DPI = 150;
export const MAX_MPX = 40;
export const BAND_PIXELS = 8_000_000;
export const PAGE_BUDGET_BYTES = 2_500_000;
export const BAND_TIMEOUT_MS = 20_000;

/** dpi = min(300, sqrt(40e6 / (w_in·h_in))) → A2 = 300, A1 ≈ 227, A0 ≈ 161. */
export function targetDpi(widthPt: number, heightPt: number, maxDpi = MAX_DPI, maxMpx = MAX_MPX): number {
  const wIn = widthPt / 72, hIn = heightPt / 72;
  if (!(wIn > 0 && hIn > 0)) return maxDpi;
  return Math.max(36, Math.min(maxDpi, Math.sqrt((maxMpx * 1e6) / (wIn * hIn))));
}

function withTimeout<T>(p: Promise<T>, ms: number, onTimeout: () => void): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const t = setTimeout(() => {
      onTimeout();
      reject(new Error("Vykreslení stránky trvalo příliš dlouho."));
    }, ms);
    p.then((v) => { clearTimeout(t); resolve(v); }, (e) => { clearTimeout(t); reject(e); });
  });
}

async function renderBand(page: PdfPage, scale: number, width: number, y0: number, bandH: number, x0 = 0): Promise<Uint8ClampedArray> {
  const pdfjs = await loadPdfjs();
  const { createCanvas } = await import("@napi-rs/canvas");
  const canvas = createCanvas(width, bandH);
  const ctx = canvas.getContext("2d");
  ctx.fillStyle = "#ffffff";
  ctx.fillRect(0, 0, width, bandH);
  const viewport = page.getViewport({ scale, offsetX: -x0, offsetY: -y0 });
  const task = page.render({
    canvasContext: ctx as unknown as CanvasRenderingContext2D,
    viewport,
    intent: "print",
    annotationMode: pdfjs.AnnotationMode.ENABLE,
    background: "#ffffff",
  } as Parameters<PdfPage["render"]>[0]);
  await withTimeout(task.promise, BAND_TIMEOUT_MS, () => task.cancel());
  const img = ctx.getImageData(0, 0, width, bandH);
  return img.data as unknown as Uint8ClampedArray;
}

/** Barevná stránka? (vzorek sytosti nízkého rozlišení) */
export async function pageIsColor(page: PdfPage): Promise<boolean> {
  const vp = page.getViewport({ scale: 1 });
  const s = Math.min(1, Math.sqrt(600_000 / (vp.width * vp.height)));
  const w = Math.max(1, Math.ceil(vp.width * s)), h = Math.max(1, Math.ceil(vp.height * s));
  const px = await renderBand(page, s, w, 0, h);
  // absolutní práh (pár desítek sytých pixelů) — malá červená revize / poznámka stránku obarví
  let colored = 0;
  for (let i = 0; i < px.length; i += 4) {
    const mx = Math.max(px[i], px[i + 1], px[i + 2]), mn = Math.min(px[i], px[i + 1], px[i + 2]);
    if (mx - mn > 48 && ++colored >= 20) return true;
  }
  return false;
}

/** Vykreslí stránku po pásech přímo do šedé (1 kanál) nebo RGB (3 kanály) bez alfy. */
export async function renderPageRaster(page: PdfPage, scale: number, color: boolean): Promise<Raster> {
  const vp = page.getViewport({ scale });
  const width = Math.max(1, Math.ceil(vp.width));
  const height = Math.max(1, Math.ceil(vp.height));
  const channels: 1 | 3 = color ? 3 : 1;
  const data = new Uint8Array(width * height * channels);
  const bandH = Math.max(1, Math.min(height, Math.floor(BAND_PIXELS / width)));
  for (let y0 = 0; y0 < height; y0 += bandH) {
    const h = Math.min(bandH, height - y0);
    const px = await renderBand(page, scale, width, y0, h);
    const base = y0 * width * channels;
    if (channels === 1) {
      for (let i = 0, j = 0; i < px.length; i += 4, j++) {
        data[base + j] = (px[i] * 299 + px[i + 1] * 587 + px[i + 2] * 114 + 500) / 1000;
      }
    } else {
      for (let i = 0, j = 0; i < px.length; i += 4, j += 3) {
        data[base + j] = px[i];
        data[base + j + 1] = px[i + 1];
        data[base + j + 2] = px[i + 2];
      }
    }
  }
  page.cleanup();
  return { width, height, channels, data };
}

/** Mez výřezu pro AI / kontrolu (px) — výřez se nikdy nevykresluje přes celou stránku. */
export const REGION_MAX_PIXELS = 12_000_000;

/**
 * Vykreslí JEN výřez stránky (box v bodech viewportu) v měřítku `scale` — plátno velikosti výřezu
 * (posun viewportu), po pásech; měřítko se sníží, aby výřez nepřekročil maxPixels. Vrací rastr a
 * skutečné měřítko.
 */
export async function renderRegion(page: PdfPage, scale: number, box: Box, color: boolean, maxPixels = REGION_MAX_PIXELS): Promise<{ raster: Raster; scale: number }> {
  let s = scale;
  if (box.w * box.h * s * s > maxPixels) s = Math.sqrt(maxPixels / Math.max(1, box.w * box.h));
  const x0 = Math.max(0, Math.floor(box.x * s)), y0 = Math.max(0, Math.floor(box.y * s));
  const vp = page.getViewport({ scale: s });
  const width = Math.max(1, Math.min(Math.ceil(vp.width) - x0, Math.ceil(box.w * s)));
  const height = Math.max(1, Math.min(Math.ceil(vp.height) - y0, Math.ceil(box.h * s)));
  const channels: 1 | 3 = color ? 3 : 1;
  const data = new Uint8Array(width * height * channels);
  const bandH = Math.max(1, Math.min(height, Math.floor(BAND_PIXELS / width)));
  for (let by = 0; by < height; by += bandH) {
    const h = Math.min(bandH, height - by);
    const px = await renderBand(page, s, width, y0 + by, h, x0);
    const base = by * width * channels;
    if (channels === 1) {
      for (let i = 0, j = 0; i < px.length; i += 4, j++) data[base + j] = (px[i] * 299 + px[i + 1] * 587 + px[i + 2] * 114 + 500) / 1000;
    } else {
      for (let i = 0, j = 0; i < px.length; i += 4, j += 3) { data[base + j] = px[i]; data[base + j + 1] = px[i + 1]; data[base + j + 2] = px[i + 2]; }
    }
  }
  page.cleanup();
  return { raster: { width, height, channels, data }, scale: s };
}

// ── Vypálení ─────────────────────────────────────────────────

export function fillRect(r: Raster, box: Box, value: readonly number[]) {
  const x0 = Math.max(0, Math.floor(box.x)), y0 = Math.max(0, Math.floor(box.y));
  const x1 = Math.min(r.width, Math.ceil(box.x + box.w)), y1 = Math.min(r.height, Math.ceil(box.y + box.h));
  const c = r.channels;
  for (let y = y0; y < y1; y++) {
    let o = (y * r.width + x0) * c;
    for (let x = x0; x < x1; x++, o += c) {
      for (let k = 0; k < c; k++) r.data[o + k] = value[Math.min(k, value.length - 1)];
    }
  }
}

/** Souvislé běhy čísel (setříděná množina) → [začátek, konec] včetně. */
function runsOf(set: Set<number>): [number, number][] {
  const v = [...set].sort((a, b) => a - b);
  const out: [number, number][] = [];
  for (const x of v) {
    const last = out[out.length - 1];
    if (last && x === last[1] + 1) last[1] = x;
    else out.push([x, x]);
  }
  return out;
}

/**
 * Vypálí obdélník TEXTOVÉ oblasti, ale zachová linky tabulky / rámu, které jím procházejí: jen TENKÉ
 * (≤ max(3 px, 0,15 em)) svislé / vodorovné linky tmavé po celé výšce (šířce) obdélníku, které se
 * dotýkají obou hran a aspoň na jedné straně pokračují ≥ 1 em (≤ 6 linek). Široký pruh (logo, kód)
 * tak linku nenapodobí; grafika se vypaluje burnGraphic.
 * em ≤ 0 (grafika, ruční oblast) = celý obdélník bez výjimek.
 */
export function burnRectKeepLines(r: Raster, box: Box, value: readonly number[], bg = 255, em = 0) {
  const x0 = Math.max(0, Math.floor(box.x)), y0 = Math.max(0, Math.floor(box.y));
  const x1 = Math.min(r.width, Math.ceil(box.x + box.w)), y1 = Math.min(r.height, Math.ceil(box.y + box.h));
  if (x1 <= x0 || y1 <= y0) return;
  if (!(em > 0)) {
    fillRect(r, box, value);
    return;
  }
  const thr = bg * 0.75;
  const dark = (x: number, y: number) => x >= 0 && y >= 0 && x < r.width && y < r.height && grayAt(r, x, y) < thr;
  const ext = Math.max(2, Math.round(em));
  /** Tmavé aspoň z 90 % na úseku délky ext za hranou (linka pokračuje). */
  const continues = (fx: (k: number) => boolean): boolean => {
    let n = 0;
    for (let k = 0; k < ext; k++) if (fx(k)) n++;
    return n >= 0.9 * ext;
  };
  const keepCols = new Set<number>();
  const keepRows = new Set<number>();
  if (y1 - y0 >= 3) {
    for (let x = x0; x < x1; x++) {
      if (!dark(x, y0 - 1) || !dark(x, y1)) continue;
      let all = true;
      for (let y = y0; y < y1 && all; y++) if (!dark(x, y)) all = false;
      // pokračuje ≥ 1 em aspoň na jedné straně (na druhé stačí dotyk — linka končí na příčce tabulky)
      if (all && (continues((k) => dark(x, y0 - 1 - k)) || continues((k) => dark(x, y1 + k)))) keepCols.add(x);
    }
  }
  if (x1 - x0 >= 3) {
    for (let y = y0; y < y1; y++) {
      if (!dark(x0 - 1, y) || !dark(x1, y)) continue;
      let all = true;
      for (let x = x0; x < x1 && all; x++) if (!dark(x, y)) all = false;
      if (all && (continues((k) => dark(x0 - 1 - k, y)) || continues((k) => dark(x1 + k, y)))) keepRows.add(y);
    }
  }
  // linka smí být jen tenká — širší tmavý pás je obsah (logo, kód), ne linka
  const maxThick = Math.max(3, Math.round(0.15 * em));
  for (const [a, b] of runsOf(keepCols)) if (b - a + 1 > maxThick) for (let x = a; x <= b; x++) keepCols.delete(x);
  for (const [a, b] of runsOf(keepRows)) if (b - a + 1 > maxThick) for (let y = a; y <= b; y++) keepRows.delete(y);
  // mnoho „linek" v jedné oblasti = šrafování / kód, ne tabulka
  if (runsOf(keepCols).length > 6) keepCols.clear();
  if (runsOf(keepRows).length > 6) keepRows.clear();
  const c = r.channels;
  for (let y = y0; y < y1; y++) {
    if (keepRows.has(y)) continue;
    let o = (y * r.width + x0) * c;
    for (let x = x0; x < x1; x++, o += c) {
      if (keepCols.has(x)) continue;
      for (let k = 0; k < c; k++) r.data[o + k] = value[Math.min(k, value.length - 1)];
    }
  }
}

export interface GraphicBurn {
  /** Konečný (případně rozšířený) obdélník v px. */
  box: Box;
  /** Okolí se nepodařilo vyčistit (tvar větší než rozumné okno) → ke kontrole. */
  residue: boolean;
  grown: boolean;
}

/**
 * Vypálí GRAFICKOU oblast (logo, kód, razítko, podpis, box od AI) CELOU a rozšíří ji o tmavý tvar, který
 * se zvenku dotýká její hrany nebo je od ní do ~2 % velikosti (AI box o kousek menší než logo / čárový
 * kód) — opakovaně, dokud je okolí čisté. Tenké linky tabulky / rámu, které běží až k okraji okna, se
 * nepočítají (zůstanou). Když by oblast narostla přes 6× plochy nebo okolí zůstane tmavé → residue.
 */
export function burnGraphic(r: Raster, box: Box, value: readonly number[], bg = 255): GraphicBurn {
  const W = r.width, H = r.height;
  const clamp = (b: Box): Box => {
    const x = Math.max(0, Math.floor(b.x)), y = Math.max(0, Math.floor(b.y));
    return { x, y, w: Math.max(0, Math.min(W, Math.ceil(b.x + b.w)) - x), h: Math.max(0, Math.min(H, Math.ceil(b.y + b.h)) - y) };
  };
  let b = clamp(box);
  if (b.w <= 0 || b.h <= 0) return { box: b, residue: false, grown: false };
  const area0 = Math.max(1, b.w * b.h);
  const thr = bg * 0.75;
  const thin = Math.max(3, Math.round(0.004 * Math.max(W, H)));
  /**
   * Celé vyplnění KROMĚ tenkých linek tabulky / rámu: řádek (sloupec) tmavý přes ≥ 90 % oblasti, který
   * pokračuje za oblast až k okraji okna (oblast ± 50 %) aspoň na jedné straně — roh razítka i průchozí
   * linka. Logo ani pruh kódu k okraji okna nesahá.
   */
  const fillKeepingCrossLines = (bx: Box) => {
    const m = Math.max(16, Math.round(0.5 * Math.max(bx.w, bx.h)));
    const wx0 = Math.max(0, bx.x - m), wx1 = Math.min(W, bx.x + bx.w + m);
    const wy0 = Math.max(0, bx.y - m), wy1 = Math.min(H, bx.y + bx.h + m);
    const darkRun = (n: number, at: (k: number) => boolean) => {
      let d = 0;
      for (let k = 0; k < n; k++) if (at(k)) d++;
      return n > 0 && d >= 0.97 * n;
    };
    const rows = new Set<number>(), cols = new Set<number>();
    for (let y = bx.y; y < bx.y + bx.h; y++) {
      let inside = 0;
      for (let x = bx.x; x < bx.x + bx.w; x++) if (grayAt(r, x, y) < thr) inside++;
      if (inside < 0.9 * bx.w) continue;
      const left = darkRun(bx.x - wx0, (k) => grayAt(r, wx0 + k, y) < thr);
      const right = darkRun(wx1 - (bx.x + bx.w), (k) => grayAt(r, bx.x + bx.w + k, y) < thr);
      if (left || right) rows.add(y);
    }
    for (let x = bx.x; x < bx.x + bx.w; x++) {
      let inside = 0;
      for (let y = bx.y; y < bx.y + bx.h; y++) if (grayAt(r, x, y) < thr) inside++;
      if (inside < 0.9 * bx.h) continue;
      const top = darkRun(bx.y - wy0, (k) => grayAt(r, x, wy0 + k) < thr);
      const bottom = darkRun(wy1 - (bx.y + bx.h), (k) => grayAt(r, x, bx.y + bx.h + k) < thr);
      if (top || bottom) cols.add(x);
    }
    for (const [a, z] of runsOf(rows)) if (z - a + 1 > thin) for (let y = a; y <= z; y++) rows.delete(y);
    for (const [a, z] of runsOf(cols)) if (z - a + 1 > thin) for (let x = a; x <= z; x++) cols.delete(x);
    const c = r.channels;
    for (let y = bx.y; y < bx.y + bx.h; y++) {
      if (rows.has(y)) continue;
      let o = (y * r.width + bx.x) * c;
      for (let x = bx.x; x < bx.x + bx.w; x++, o += c) {
        if (cols.has(x)) continue;
        for (let k = 0; k < c; k++) r.data[o + k] = value[Math.min(k, value.length - 1)];
      }
    }
  };
  fillKeepingCrossLines(b);
  let grown = false;
  let clean = false;
  for (let iter = 0; iter < 6; iter++) {
    const size = Math.max(b.w, b.h);
    const margin = Math.max(16, Math.round(0.5 * size));
    const gap = Math.max(3, Math.round(0.02 * size));
    const wx0 = Math.max(0, b.x - margin), wy0 = Math.max(0, b.y - margin);
    const wx1 = Math.min(W, b.x + b.w + margin), wy1 = Math.min(H, b.y + b.h + margin);
    const ww = wx1 - wx0, wh = wy1 - wy0;
    if (ww <= 0 || wh <= 0) break;
    const mask = new Uint8Array(ww * wh);
    for (let y = 0; y < wh; y++) for (let x = 0; x < ww; x++) if (grayAt(r, wx0 + x, wy0 + y) < thr) mask[y * ww + x] = 1;
    // svislá / vodorovná tloušťka v každém bodě
    const vrun = new Uint16Array(ww * wh), hrun = new Uint16Array(ww * wh);
    for (let x = 0; x < ww; x++) {
      let y = 0;
      while (y < wh) {
        if (!mask[y * ww + x]) { y++; continue; }
        let e = y;
        while (e < wh && mask[e * ww + x]) e++;
        for (let k = y; k < e; k++) vrun[k * ww + x] = Math.min(65535, e - y);
        y = e;
      }
    }
    for (let y = 0; y < wh; y++) {
      let x = 0;
      while (x < ww) {
        if (!mask[y * ww + x]) { x++; continue; }
        let e = x;
        while (e < ww && mask[y * ww + e]) e++;
        for (let k = x; k < e; k++) hrun[y * ww + k] = Math.min(65535, e - x);
        x = e;
      }
    }
    // linka tabulky / rámu = běh (s tolerancí ±1 px kolmo — mírně šikmá linka na fotce) od kraje okna;
    // logo ani pruh kódu k okraji okna nesahá (okno = oblast + 50 %)
    const hTouch = new Uint8Array(ww * wh), vTouch = new Uint8Array(ww * wh);
    const dk = (x: number, y: number) => y >= 0 && y < wh && x >= 0 && x < ww && mask[y * ww + x] !== 0;
    for (let y = 0; y < wh; y++) {
      let x = 0;
      while (x < ww) {
        if (!(dk(x, y) || dk(x, y - 1) || dk(x, y + 1))) { x++; continue; }
        let e = x;
        while (e < ww && (dk(e, y) || dk(e, y - 1) || dk(e, y + 1))) e++;
        if ((x === 0 || e === ww) && e - x >= Math.min(ww, margin)) for (let k = x; k < e; k++) hTouch[y * ww + k] = 1;
        x = e;
      }
    }
    for (let x = 0; x < ww; x++) {
      let y = 0;
      while (y < wh) {
        if (!(dk(x, y) || dk(x - 1, y) || dk(x + 1, y))) { y++; continue; }
        let e = y;
        while (e < wh && (dk(x, e) || dk(x - 1, e) || dk(x + 1, e))) e++;
        if ((y === 0 || e === wh) && e - y >= Math.min(wh, margin)) for (let k = y; k < e; k++) vTouch[k * ww + x] = 1;
        y = e;
      }
    }
    for (let i = 0; i < ww * wh; i++) {
      if (mask[i] !== 1) continue;
      const h = hTouch[i] === 1, v = vTouch[i] === 1;
      // tenká vodorovná / svislá linka, nebo jejich křížení (obě sahají k okraji)
      if ((h && (vrun[i] <= thin || v)) || (v && (hrun[i] <= thin || h))) mask[i] = 2;
    }
    // rozšíření tmavých bodů (ne linek) o `gap` — blízké pruhy kódu / části loga tvoří jeden tvar
    const integ = new Uint32Array((ww + 1) * (wh + 1));
    for (let y = 0; y < wh; y++) {
      let rowSum = 0;
      for (let x = 0; x < ww; x++) {
        rowSum += mask[y * ww + x] === 1 ? 1 : 0;
        integ[(y + 1) * (ww + 1) + x + 1] = integ[y * (ww + 1) + x + 1] + rowSum;
      }
    }
    const near = (x: number, y: number) => {
      const xa = Math.max(0, x - gap), ya = Math.max(0, y - gap), xb = Math.min(ww, x + gap + 1), yb = Math.min(wh, y + gap + 1);
      return integ[yb * (ww + 1) + xb] - integ[ya * (ww + 1) + xb] - integ[yb * (ww + 1) + xa] + integ[ya * (ww + 1) + xa] > 0;
    };
    // semínka: body těsně kolem obdélníku (prstenec 1 px), u kterých je tvar do `gap`
    const bx0 = b.x - wx0, by0 = b.y - wy0, bx1 = bx0 + b.w, by1 = by0 + b.h;
    const seen = new Uint8Array(ww * wh);
    const queue: number[] = [];
    const seed = (x: number, y: number) => {
      if (x < 0 || y < 0 || x >= ww || y >= wh) return;
      const i = y * ww + x;
      if (!seen[i] && near(x, y)) { seen[i] = 1; queue.push(i); }
    };
    for (let x = bx0 - 1; x <= bx1; x++) { seed(x, by0 - 1); seed(x, by1); }
    for (let y = by0; y < by1; y++) { seed(bx0 - 1, y); seed(bx1, y); }
    if (!queue.length) { clean = true; break; }
    let mx0 = Infinity, my0 = Infinity, mx1 = -Infinity, my1 = -Infinity;
    while (queue.length) {
      const i = queue.pop()!;
      const x = i % ww, y = (i - x) / ww;
      if (mask[i] === 1) {
        if (x < mx0) mx0 = x;
        if (x > mx1) mx1 = x;
        if (y < my0) my0 = y;
        if (y > my1) my1 = y;
      }
      for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]] as const) {
        const nx = x + dx, ny = y + dy;
        if (nx < 0 || ny < 0 || nx >= ww || ny >= wh) continue;
        // dovnitř vypáleného obdélníku se nešíří (je bílý)
        if (nx >= bx0 && nx < bx1 && ny >= by0 && ny < by1) continue;
        const j = ny * ww + nx;
        if (!seen[j] && near(nx, ny)) { seen[j] = 1; queue.push(j); }
      }
    }
    if (mx1 < mx0) { clean = true; break; } // jen linky v okolí → čisté
    const nb = clamp({
      x: Math.min(b.x, wx0 + mx0 - 1), y: Math.min(b.y, wy0 + my0 - 1),
      w: Math.max(b.x + b.w, wx0 + mx1 + 2) - Math.min(b.x, wx0 + mx0 - 1),
      h: Math.max(b.y + b.h, wy0 + my1 + 2) - Math.min(b.y, wy0 + my0 - 1),
    });
    if (nb.w * nb.h > 6 * area0) return { box: b, residue: true, grown };
    b = nb;
    fillKeepingCrossLines(b);
    grown = true;
    // tvar sahající k okraji okna → další kolo s větším oknem (okno roste s obdélníkem)
  }
  return { box: b, residue: !clean, grown };
}

/** Vyplní polygon (scanline, sudo-liché pravidlo, s rezervou 1 px). */
export function fillPolygon(r: Raster, q: readonly number[], value: readonly number[]) {
  const n = q.length / 2;
  const ys = Array.from({ length: n }, (_, i) => q[i * 2 + 1]);
  const y0 = Math.max(0, Math.floor(Math.min(...ys)) - 1), y1 = Math.min(r.height - 1, Math.ceil(Math.max(...ys)) + 1);
  const c = r.channels;
  for (let y = y0; y <= y1; y++) {
    const yc = y + 0.5;
    const xs: number[] = [];
    for (let i = 0; i < n; i++) {
      const ax = q[i * 2], ay = q[i * 2 + 1];
      const bx = q[((i + 1) % n) * 2], by = q[((i + 1) % n) * 2 + 1];
      if ((ay <= yc && by > yc) || (by <= yc && ay > yc)) xs.push(ax + ((yc - ay) / (by - ay)) * (bx - ax));
    }
    xs.sort((a, b) => a - b);
    for (let k = 0; k + 1 < xs.length; k += 2) {
      const xa = Math.max(0, Math.floor(xs[k]) - 1), xb = Math.min(r.width, Math.ceil(xs[k + 1]) + 1);
      let o = (y * r.width + xa) * c;
      for (let x = xa; x < xb; x++, o += c) for (let ch = 0; ch < c; ch++) r.data[o + ch] = value[Math.min(ch, value.length - 1)];
    }
  }
}

export function grayAt(r: Raster, x: number, y: number): number {
  const o = (y * r.width + x) * r.channels;
  return r.channels === 1 ? r.data[o] : (r.data[o] * 299 + r.data[o + 1] * 587 + r.data[o + 2] * 114) / 1000;
}

/** Medián jasu pozadí (vzorek). */
export function backgroundLevel(r: Raster, box?: Box): number {
  const x0 = Math.max(0, Math.floor(box?.x ?? 0)), y0 = Math.max(0, Math.floor(box?.y ?? 0));
  const x1 = Math.min(r.width, Math.ceil(box ? box.x + box.w : r.width)), y1 = Math.min(r.height, Math.ceil(box ? box.y + box.h : r.height));
  const step = Math.max(1, Math.floor(Math.sqrt(((x1 - x0) * (y1 - y0)) / 20_000)));
  const hist = new Uint32Array(256);
  let n = 0;
  for (let y = y0; y < y1; y += step) for (let x = x0; x < x1; x += step) { hist[Math.round(grayAt(r, x, y))]++; n++; }
  let acc = 0;
  for (let v = 0; v < 256; v++) { acc += hist[v]; if (acc >= n / 2) return v; }
  return 255;
}

/** Podíl tmavých pixelů v obdélníku (práh = pozadí − 25 %). */
export function inkFraction(r: Raster, box: Box, bg = 255): number {
  const thr = bg * 0.75;
  const x0 = Math.max(0, Math.floor(box.x)), y0 = Math.max(0, Math.floor(box.y));
  const x1 = Math.min(r.width, Math.ceil(box.x + box.w)), y1 = Math.min(r.height, Math.ceil(box.y + box.h));
  let dark = 0, total = 0;
  for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) { total++; if (grayAt(r, x, y) < thr) dark++; }
  return total ? dark / total : 0;
}

/**
 * Podíl pixelů s KONTRASTEM proti místnímu pozadí (medián okolí po kanálech): žlutý, světle šedý
 * nebo bílý text na tmavém pruhu je inkoust; bílý text na bílém / zakrytý / průhledný není.
 * Šedá: |Δ| ≥ minDelta, barva: max. rozdíl kanálu ≥ 2 × minDelta nebo |Δ jasu| ≥ minDelta.
 */
export function contrastInkFraction(r: Raster, box: Box, minDelta = 24): number {
  const pad = Math.max(2, 0.5 * Math.min(box.h, 60));
  const x0 = Math.max(0, Math.floor(box.x)), y0 = Math.max(0, Math.floor(box.y));
  const x1 = Math.min(r.width, Math.ceil(box.x + box.w)), y1 = Math.min(r.height, Math.ceil(box.y + box.h));
  if (x1 <= x0 || y1 <= y0) return 0;
  const ex0 = Math.max(0, Math.floor(box.x - pad)), ey0 = Math.max(0, Math.floor(box.y - pad));
  const ex1 = Math.min(r.width, Math.ceil(box.x + box.w + pad)), ey1 = Math.min(r.height, Math.ceil(box.y + box.h + pad));
  const c = r.channels;
  const step = Math.max(1, Math.floor(Math.sqrt(((ex1 - ex0) * (ey1 - ey0)) / 20_000)));
  const hists = Array.from({ length: c }, () => new Uint32Array(256));
  let n = 0;
  for (let y = ey0; y < ey1; y += step) {
    for (let x = ex0; x < ex1; x += step) {
      const o = (y * r.width + x) * c;
      for (let ch = 0; ch < c; ch++) hists[ch][r.data[o + ch]]++;
      n++;
    }
  }
  const bg = hists.map((h) => {
    let acc = 0;
    for (let v = 0; v < 256; v++) { acc += h[v]; if (acc >= n / 2) return v; }
    return 255;
  });
  const bgGray = c === 1 ? bg[0] : (bg[0] * 299 + bg[1] * 587 + bg[2] * 114) / 1000;
  let ink = 0, total = 0;
  for (let y = y0; y < y1; y++) {
    for (let x = x0; x < x1; x++) {
      total++;
      const o = (y * r.width + x) * c;
      if (c === 1) {
        if (Math.abs(r.data[o] - bg[0]) >= minDelta) ink++;
        continue;
      }
      let maxCh = 0;
      for (let ch = 0; ch < c; ch++) maxCh = Math.max(maxCh, Math.abs(r.data[o + ch] - bg[ch]));
      const g = (r.data[o] * 299 + r.data[o + 1] * 587 + r.data[o + 2] * 114) / 1000;
      if (maxCh >= 2 * minDelta || Math.abs(g - bgGray) >= minDelta) ink++;
    }
  }
  return total ? ink / total : 0;
}

function insideAny(x: number, y: number, boxes: readonly Box[]): boolean {
  for (const b of boxes) if (x >= b.x && x < b.x + b.w && y >= b.y && y < b.y + b.h) return true;
  return false;
}

/**
 * Inkoust v prstenci kolem vypáleného obdélníku MIMO ponechané položky a mimo vodorovné/svislé
 * běhy ≥ runPx (linky tabulky razítka). Vrací počet „zbytkových" tmavých pixelů.
 */
export function ringResidue(r: Raster, rect: Box, ringPx: number, exclude: readonly Box[], runPx: number, bg = 255): number {
  const thr = bg * 0.75;
  const outer: Box = { x: rect.x - ringPx, y: rect.y - ringPx, w: rect.w + 2 * ringPx, h: rect.h + 2 * ringPx };
  const x0 = Math.max(0, Math.floor(outer.x)), y0 = Math.max(0, Math.floor(outer.y));
  const x1 = Math.min(r.width, Math.ceil(outer.x + outer.w)), y1 = Math.min(r.height, Math.ceil(outer.y + outer.h));
  const dark = (x: number, y: number) => x >= 0 && y >= 0 && x < r.width && y < r.height && grayAt(r, x, y) < thr;
  const run = (x: number, y: number, dx: number, dy: number) => {
    let n = 1;
    for (let k = 1; k < runPx && dark(x + dx * k, y + dy * k); k++) n++;
    for (let k = 1; k < runPx && dark(x - dx * k, y - dy * k); k++) n++;
    return n;
  };
  let count = 0;
  for (let y = y0; y < y1; y++) {
    for (let x = x0; x < x1; x++) {
      if (x >= rect.x && x < rect.x + rect.w && y >= rect.y && y < rect.y + rect.h) continue;
      if (!dark(x, y)) continue;
      if (insideAny(x, y, exclude)) continue;
      if (run(x, y, 1, 0) >= runPx || run(x, y, 0, 1) >= runPx) continue;
      count++;
    }
  }
  return count;
}

// ── Kódování ──────────────────────────────────────────────────

export interface EncodedImage {
  kind: "flate" | "jpeg";
  data: Uint8Array;
  width: number;
  height: number;
  colors: 1 | 3;
}

type SharpFn = typeof import("sharp");

/** sharp nad surovým rastrem; 1 kanál výslovně jako šedá (jinak by sharp výstup převedl na RGB). */
export function rawSharp(sharp: SharpFn, r: Raster) {
  const s = sharp(Buffer.from(r.data.buffer, r.data.byteOffset, r.data.byteLength), { raw: { width: r.width, height: r.height, channels: r.channels }, limitInputPixels: false });
  return r.channels === 1 ? s.toColourspace("b-w") : s.toColourspace("srgb");
}

/** PNG z sharp → zlib proud IDAT (filtry PNG po řádcích) → Predictor 15 v PDF. */
export async function encodeFlate(r: Raster): Promise<EncodedImage> {
  const sharp = (await import("sharp")).default;
  const png = await rawSharp(sharp, r)
    .png({ compressionLevel: 9, adaptiveFiltering: true, palette: false, progressive: false })
    .toBuffer();
  const idat: Buffer[] = [];
  let colorType = -1, bitDepth = -1, interlace = 0;
  let off = 8;
  while (off + 8 <= png.length) {
    const len = png.readUInt32BE(off);
    const type = png.toString("ascii", off + 4, off + 8);
    const body = png.subarray(off + 8, off + 8 + len);
    if (type === "IHDR") { bitDepth = body[8]; colorType = body[9]; interlace = body[12]; }
    else if (type === "IDAT") idat.push(Buffer.from(body));
    else if (type === "IEND") break;
    off += 12 + len;
  }
  const expected = r.channels === 1 ? 0 : 2;
  if (colorType !== expected || bitDepth !== 8 || interlace !== 0 || !idat.length) {
    throw new Error(`Neočekávaný formát PNG (typ ${colorType}, hloubka ${bitDepth}).`);
  }
  return { kind: "flate", data: new Uint8Array(Buffer.concat(idat)), width: r.width, height: r.height, colors: r.channels };
}

export async function encodeJpeg(r: Raster, quality = 85): Promise<EncodedImage> {
  const sharp = (await import("sharp")).default;
  const jpg = await rawSharp(sharp, r)
    .jpeg({ quality, mozjpeg: false, chromaSubsampling: "4:2:0" })
    .toBuffer();
  return { kind: "jpeg", data: new Uint8Array(jpg), width: r.width, height: r.height, colors: r.channels };
}

export interface OutPage {
  widthPt: number;
  heightPt: number;
  image: EncodedImage;
}

/** Prázdné /Font, /ExtGState a /Annots, které pdf-lib přidává, pryč (výstup má jen obraz). */
function cleanPage(page: import("pdf-lib").PDFPage) {
  page.node.delete(PDFName.of("Annots"));
  const res = page.node.Resources();
  if (res) {
    res.delete(PDFName.of("Font"));
    res.delete(PDFName.of("ExtGState"));
  }
}

/** Nové PDF z rastrů: bez metadat (updateMetadata:false), bez XMP, bez objektových proudů (kontrola bajtů). */
export async function buildRasterPdf(pages: readonly OutPage[]): Promise<Uint8Array> {
  const doc = await PDFDocument.create({ updateMetadata: false });
  for (const p of pages) {
    const page = doc.addPage([p.widthPt, p.heightPt]);
    let ref;
    if (p.image.kind === "jpeg") {
      const img = await doc.embedJpg(p.image.data);
      ref = img.ref;
    } else {
      const ctx = doc.context;
      const stream = ctx.stream(p.image.data, {
        Type: "XObject",
        Subtype: "Image",
        Width: p.image.width,
        Height: p.image.height,
        ColorSpace: p.image.colors === 1 ? "DeviceGray" : "DeviceRGB",
        BitsPerComponent: 8,
        Filter: "FlateDecode",
        DecodeParms: { Predictor: 15, Colors: p.image.colors, BitsPerComponent: 8, Columns: p.image.width },
      });
      ref = ctx.register(stream);
    }
    const name = PDFName.of("Im0");
    page.node.setXObject(name, ref);
    page.pushOperators(
      pushGraphicsState(),
      concatTransformationMatrix(PDFNumber.of(p.widthPt), 0, 0, PDFNumber.of(p.heightPt), 0, 0),
      drawObject(name),
      popGraphicsState(),
    );
    cleanPage(page);
  }
  return doc.save({ useObjectStreams: false, addDefaultPage: false, updateFieldAppearances: false });
}

/** Spojí části (navazování po dávkách stránek) — pdf-lib copyPages. */
export async function mergePdfParts(parts: readonly Uint8Array[]): Promise<Uint8Array> {
  const out = await PDFDocument.create({ updateMetadata: false });
  for (const p of parts) {
    const src = await PDFDocument.load(p, { updateMetadata: false });
    const pages = await out.copyPages(src, src.getPageIndices());
    for (const pg of pages) cleanPage(out.addPage(pg));
  }
  return out.save({ useObjectStreams: false, addDefaultPage: false, updateFieldAppearances: false });
}

const FORBIDDEN_KEYS = ["/JavaScript", "/JS ", "/EmbeddedFile", "/AcroForm", "/Metadata", "/OCProperties", "/Annots", "/Font", "/XFA", "/OpenAction", "/AA ", "/Author", "/Title", "/Subject", "/Keywords", "/Creator", "/Producer"];

export interface OutputCheck {
  ok: boolean;
  problems: string[];
}

/** Výstupní kontrola úniku: prázdná textová extrakce, žádná metadata, anotace, přílohy, písma, JS. */
export async function checkPdfOutput(bytes: Uint8Array, expectedPages?: { widthPt: number; heightPt: number }[]): Promise<OutputCheck> {
  const problems: string[] = [];
  const latin = Buffer.from(bytes).toString("latin1");
  for (const k of FORBIDDEN_KEYS) if (latin.includes(k)) problems.push(`výstup obsahuje ${k.trim()}`);
  const pdf = await openPdf(bytes, { requireFonts: false });
  try {
    const meta = await pdf.getMetadata();
    if (meta.metadata) problems.push("výstup obsahuje XMP");
    const info = (meta.info ?? {}) as Record<string, unknown>;
    for (const key of ["Author", "Title", "Subject", "Keywords", "Creator", "Producer"]) {
      if (typeof info[key] === "string" && (info[key] as string).trim()) problems.push(`výstup obsahuje ${key}`);
    }
    if (await pdf.getAttachments()) problems.push("výstup obsahuje přílohy");
    if (expectedPages && expectedPages.length !== pdf.numPages) problems.push("nesedí počet stran");
    for (let i = 1; i <= pdf.numPages; i++) {
      const page = await pdf.getPage(i);
      const tc = await page.getTextContent();
      if ((tc.items as { str?: string }[]).some((it) => typeof it.str === "string" && it.str.trim())) problems.push(`strana ${i}: zůstal text`);
      const an = await page.getAnnotations();
      if (an.length) problems.push(`strana ${i}: zůstaly anotace`);
      const exp = expectedPages?.[i - 1];
      if (exp) {
        const vp = page.getViewport({ scale: 1 });
        if (Math.abs(vp.width - exp.widthPt) > 1 || Math.abs(vp.height - exp.heightPt) > 1) problems.push(`strana ${i}: nesedí rozměr`);
      }
      page.cleanup();
    }
  } finally {
    await pdf.destroy();
  }
  return { ok: problems.length === 0, problems };
}

export type { Quad };
