/**
 * Logo do razítka výkresu: data URL (PNG / JPEG) → zmenšený obrázek + vektorový obrys pro DXF / DWG.
 *
 * Bez jádra a bez závislostí: PNG se dekóduje i kóduje zde (zlib přes `DecompressionStream` / `CompressionStream`, které
 * mají prohlížeče i Node 18+), takže logo jde nastavit i textem v konzoli nebo v CLI bez prohlížeče. JPEG a jiné formáty
 * (SVG, WebP, GIF) se v prohlížeči převedou přes canvas; bez prohlížeče JPEG zůstane bez obrysu (DXF / DWG pak mají jen
 * rámeček – protokol to ohlásí). Obrys = mřížka nejvýš 160 × 80 buněk, inkoust podle prahu Otsu, sloučené obdélníky.
 */
import { tr } from "./i18n";
import type { LogoTrace, TitleLogo } from "./title-block";

/** největší rozměr loga v px (větší se zmenší – logo se ukládá do dokumentu i do sdíleného odkazu) */
export const LOGO_MAX_W = 600;
export const LOGO_MAX_H = 300;
/** největší vstupní soubor */
export const LOGO_MAX_BYTES = 4 * 1024 * 1024;

export type Raster = { w: number; h: number; rgba: Uint8Array };

// ---------------------------------------------------------------- data URL

/** data URL → MIME a bajty (base64 i procentové kódování) */
export function parseDataUrl(src: string): { mime: string; bytes: Uint8Array } | null {
  const m = /^data:([\w.+-]+\/[\w.+-]+)?((?:;[\w-]+=[^;,]*)*)(;base64)?,(.*)$/s.exec(src.trim());
  if (!m) return null;
  const mime = (m[1] ?? "text/plain").toLowerCase();
  const body = m[4];
  if (m[3]) {
    const clean = body.replace(/\s+/g, "");
    if (typeof Buffer !== "undefined") return { mime, bytes: new Uint8Array(Buffer.from(clean, "base64")) };
    const bin = atob(clean);
    const u = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) u[i] = bin.charCodeAt(i);
    return { mime, bytes: u };
  }
  return { mime, bytes: new TextEncoder().encode(decodeURIComponent(body)) };
}

export function toDataUrl(mime: string, bytes: Uint8Array): string {
  let b64: string;
  if (typeof Buffer !== "undefined") b64 = Buffer.from(bytes).toString("base64");
  else {
    let s = "";
    for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
    b64 = btoa(s);
  }
  return `data:${mime};base64,${b64}`;
}

/** druh obrázku podle prvních bajtů (MIME v data URL nemusí sedět) */
export function sniffImage(b: Uint8Array): "png" | "jpeg" | "gif" | "webp" | "svg" | null {
  if (b.length > 8 && b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47) return "png";
  if (b.length > 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return "jpeg";
  if (b.length > 6 && b[0] === 0x47 && b[1] === 0x49 && b[2] === 0x46) return "gif";
  if (b.length > 12 && b[0] === 0x52 && b[1] === 0x49 && b[8] === 0x57 && b[9] === 0x45) return "webp";
  const head = new TextDecoder().decode(b.subarray(0, 256)).trimStart().toLowerCase();
  if (head.startsWith("<svg") || (head.startsWith("<?xml") && head.includes("<svg"))) return "svg";
  return null;
}

// ---------------------------------------------------------------- zlib přes streamy (prohlížeč i Node)

async function pipe(data: Uint8Array, stream: { readable: ReadableStream<Uint8Array>; writable: WritableStream<Uint8Array> }): Promise<Uint8Array> {
  const w = stream.writable.getWriter();
  void w.write(data as Uint8Array<ArrayBuffer>).then(() => w.close()).catch(() => undefined);
  const chunks: Uint8Array[] = [];
  const r = stream.readable.getReader();
  for (;;) {
    const { done, value } = await r.read();
    if (done) break;
    chunks.push(value);
  }
  const n = chunks.reduce((a, c) => a + c.length, 0);
  const out = new Uint8Array(n);
  let o = 0;
  for (const c of chunks) {
    out.set(c, o);
    o += c.length;
  }
  return out;
}
const inflate = (d: Uint8Array) => pipe(d, new DecompressionStream("deflate") as never);
const deflate = (d: Uint8Array) => pipe(d, new CompressionStream("deflate") as never);

// ---------------------------------------------------------------- PNG

const CRC = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();
function crc32(b: Uint8Array, start = 0, end = b.length): number {
  let c = 0xffffffff;
  for (let i = start; i < end; i++) c = CRC[(c ^ b[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

/** PNG s prokládáním Adam7 (bajt prokládání v IHDR) */
export const pngInterlaced = (b: Uint8Array): boolean => sniffImage(b) === "png" && b.length > 28 && b[28] === 1;

/** průchody prokládání Adam7: [x0, y0, dx, dy] */
const ADAM7: [number, number, number, number][] = [[0, 0, 8, 8], [4, 0, 8, 8], [0, 4, 4, 8], [2, 0, 4, 4], [0, 2, 2, 4], [1, 0, 2, 2], [0, 1, 1, 2]];

/** Dekódování PNG (i prokládané Adam7; barevné typy 0, 2, 3, 4, 6; hloubka 1–16 bitů; tRNS) → RGBA 8 bitů. */
export async function decodePng(b: Uint8Array): Promise<Raster> {
  if (sniffImage(b) !== "png") throw new Error(tr("soubor není PNG"));
  const dv = new DataView(b.buffer, b.byteOffset, b.byteLength);
  let p = 8;
  let w = 0, h = 0, depth = 8, ctype = 6, interlace = 0;
  let plte: Uint8Array | null = null;
  let trns: Uint8Array | null = null;
  const idat: Uint8Array[] = [];
  while (p + 8 <= b.length) {
    const len = dv.getUint32(p);
    const type = String.fromCharCode(b[p + 4], b[p + 5], b[p + 6], b[p + 7]);
    const data = b.subarray(p + 8, p + 8 + len);
    if (type === "IHDR") {
      w = dv.getUint32(p + 8);
      h = dv.getUint32(p + 12);
      depth = b[p + 16];
      ctype = b[p + 17];
      interlace = b[p + 20];
    } else if (type === "PLTE") plte = data;
    else if (type === "tRNS") trns = data;
    else if (type === "IDAT") idat.push(data);
    else if (type === "IEND") break;
    p += 12 + len;
  }
  if (!w || !h) throw new Error(tr("PNG nemá hlavičku IHDR"));
  if (interlace > 1) throw new Error(tr("nepodporované prokládání PNG {0}", interlace));
  if (w * h > 40e6) throw new Error(tr("PNG je příliš velké ({0} × {1} px)", w, h));
  const channels = { 0: 1, 2: 3, 3: 1, 4: 2, 6: 4 }[ctype as 0];
  if (!channels) throw new Error(tr("nepodporovaný barevný typ PNG {0}", ctype));
  const z = new Uint8Array(idat.reduce((a, c) => a + c.length, 0));
  let o = 0;
  for (const c of idat) {
    z.set(c, o);
    o += c.length;
  }
  const raw = await inflate(z);
  const bpp = Math.max(1, Math.ceil((channels * depth) / 8));
  /** odfiltrování `ph` řádků šířky `pw` px od bajtu `off` (celý obrázek, nebo jeden průchod Adam7) */
  const unfilter = (off: number, pw: number, ph: number): { px: Uint8Array; stride: number; end: number } => {
    const stride = Math.ceil((pw * channels * depth) / 8);
    if (raw.length < off + ph * (stride + 1)) throw new Error(tr("PNG je poškozené (málo dat)"));
    const px = new Uint8Array(ph * stride);
    for (let y = 0; y < ph; y++) {
      const f = raw[off + y * (stride + 1)];
      const src = raw.subarray(off + y * (stride + 1) + 1, off + (y + 1) * (stride + 1));
      const cur = px.subarray(y * stride, (y + 1) * stride);
      const prev = y ? px.subarray((y - 1) * stride, y * stride) : null;
      for (let i = 0; i < stride; i++) {
        const a = i >= bpp ? cur[i - bpp] : 0;
        const up = prev ? prev[i] : 0;
        const c = prev && i >= bpp ? prev[i - bpp] : 0;
        let v = src[i];
        if (f === 1) v += a;
        else if (f === 2) v += up;
        else if (f === 3) v += (a + up) >> 1;
        else if (f === 4) {
          const pp = a + up - c;
          const pa = Math.abs(pp - a);
          const pb = Math.abs(pp - up);
          const pc = Math.abs(pp - c);
          v += pa <= pb && pa <= pc ? a : pb <= pc ? up : c;
        }
        cur[i] = v & 0xff;
      }
    }
    return { px, stride, end: off + ph * (stride + 1) };
  };
  const out = new Uint8Array(w * h * 4);
  const sample = (row: Uint8Array, idx: number): number => {
    // hodnota vzorku idx (v jednotkách kanálů) v řádku – škálovaná na 0…255 (indexy palety se neškálují)
    if (depth === 8) return row[idx];
    if (depth === 16) return row[idx * 2];
    const bit = idx * depth;
    const v = (row[bit >> 3] >> (8 - depth - (bit & 7))) & ((1 << depth) - 1);
    return ctype === 3 ? v : Math.round((v * 255) / ((1 << depth) - 1));
  };
  const sample16 = (row: Uint8Array, idx: number) => (depth === 16 ? (row[idx * 2] << 8) | row[idx * 2 + 1] : -1);
  /** pixel `x` řádku `row` → RGBA na pozici `q` výstupu */
  const put = (row: Uint8Array, x: number, q: number) => {
    let r = 0, g = 0, bl = 0, al = 255;
    if (ctype === 0 || ctype === 4) {
      r = g = bl = sample(row, x * channels);
      if (ctype === 4) al = sample(row, x * channels + 1);
      else if (trns && trns.length >= 2) {
        const t = (trns[0] << 8) | trns[1];
        const raw0 = depth === 16 ? sample16(row, x) : depth === 8 ? row[x] : (row[(x * depth) >> 3] >> (8 - depth - ((x * depth) & 7))) & ((1 << depth) - 1);
        if (raw0 === t) al = 0;
      }
    } else if (ctype === 2 || ctype === 6) {
      r = sample(row, x * channels);
      g = sample(row, x * channels + 1);
      bl = sample(row, x * channels + 2);
      if (ctype === 6) al = sample(row, x * channels + 3);
      else if (trns && trns.length >= 6 && depth === 8 && r === trns[1] && g === trns[3] && bl === trns[5]) al = 0;
    } else {
      const i = sample(row, x);
      r = plte?.[i * 3] ?? 0;
      g = plte?.[i * 3 + 1] ?? 0;
      bl = plte?.[i * 3 + 2] ?? 0;
      al = trns && i < trns.length ? trns[i] : 255;
    }
    out[q] = r;
    out[q + 1] = g;
    out[q + 2] = bl;
    out[q + 3] = al;
  };
  if (!interlace) {
    const { px, stride } = unfilter(0, w, h);
    for (let y = 0; y < h; y++) {
      const row = px.subarray(y * stride, (y + 1) * stride);
      for (let x = 0; x < w; x++) put(row, x, (y * w + x) * 4);
    }
    return { w, h, rgba: out };
  }
  // Adam7: 7 dílčích obrázků za sebou, každý s vlastními řádky a filtry (prázdný průchod nemá žádná data)
  let off = 0;
  for (const [x0, y0, dx, dy] of ADAM7) {
    const pw = Math.ceil((w - x0) / dx);
    const ph = Math.ceil((h - y0) / dy);
    if (pw <= 0 || ph <= 0) continue;
    const { px, stride, end } = unfilter(off, pw, ph);
    off = end;
    for (let y = 0; y < ph; y++) {
      const row = px.subarray(y * stride, (y + 1) * stride);
      for (let x = 0; x < pw; x++) put(row, x, ((y0 + y * dy) * w + x0 + x * dx) * 4);
    }
  }
  return { w, h, rgba: out };
}

/** Kódování RGBA 8 bitů do PNG (filtr Sub, zlib). */
export async function encodePng(r: Raster): Promise<Uint8Array> {
  const { w, h, rgba } = r;
  const stride = w * 4;
  const raw = new Uint8Array(h * (stride + 1));
  for (let y = 0; y < h; y++) {
    raw[y * (stride + 1)] = 1;
    for (let i = 0; i < stride; i++) raw[y * (stride + 1) + 1 + i] = (rgba[y * stride + i] - (i >= 4 ? rgba[y * stride + i - 4] : 0)) & 0xff;
  }
  const z = await deflate(raw);
  const chunk = (type: string, data: Uint8Array) => {
    const c = new Uint8Array(12 + data.length);
    const dv = new DataView(c.buffer);
    dv.setUint32(0, data.length);
    for (let i = 0; i < 4; i++) c[4 + i] = type.charCodeAt(i);
    c.set(data, 8);
    dv.setUint32(8 + data.length, crc32(c, 4, 8 + data.length));
    return c;
  };
  const ihdr = new Uint8Array(13);
  const hv = new DataView(ihdr.buffer);
  hv.setUint32(0, w);
  hv.setUint32(4, h);
  ihdr.set([8, 6, 0, 0, 0], 8);
  const parts = [new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), chunk("IHDR", ihdr), chunk("IDAT", z), chunk("IEND", new Uint8Array(0))];
  const out = new Uint8Array(parts.reduce((a, c) => a + c.length, 0));
  let o = 0;
  for (const p of parts) {
    out.set(p, o);
    o += p.length;
  }
  return out;
}

/** rozměr JPEG z hlavičky SOF (bez dekódování) */
export function jpegSize(b: Uint8Array): { w: number; h: number } | null {
  let p = 2;
  while (p + 9 < b.length) {
    if (b[p] !== 0xff) {
      p++;
      continue;
    }
    const m = b[p + 1];
    const len = (b[p + 2] << 8) | b[p + 3];
    if (m >= 0xc0 && m <= 0xcf && m !== 0xc4 && m !== 0xc8 && m !== 0xcc) return { h: (b[p + 5] << 8) | b[p + 6], w: (b[p + 7] << 8) | b[p + 8] };
    p += 2 + len;
  }
  return null;
}

/** Zmenšení rastru (průměr bloku) na nejvýš maxW × maxH. */
export function downscale(r: Raster, maxW = LOGO_MAX_W, maxH = LOGO_MAX_H): Raster {
  const k = Math.min(1, maxW / r.w, maxH / r.h);
  if (k >= 1) return r;
  const w = Math.max(1, Math.round(r.w * k));
  const h = Math.max(1, Math.round(r.h * k));
  const out = new Uint8Array(w * h * 4);
  for (let y = 0; y < h; y++) {
    const y0 = Math.floor((y * r.h) / h);
    const y1 = Math.max(y0 + 1, Math.floor(((y + 1) * r.h) / h));
    for (let x = 0; x < w; x++) {
      const x0 = Math.floor((x * r.w) / w);
      const x1 = Math.max(x0 + 1, Math.floor(((x + 1) * r.w) / w));
      let sr = 0, sg = 0, sb = 0, sa = 0, n = 0;
      for (let yy = y0; yy < y1; yy++)
        for (let xx = x0; xx < x1; xx++) {
          const q = (yy * r.w + xx) * 4;
          const a = r.rgba[q + 3];
          sr += r.rgba[q] * a;
          sg += r.rgba[q + 1] * a;
          sb += r.rgba[q + 2] * a;
          sa += a;
          n++;
        }
      const q = (y * w + x) * 4;
      out[q] = sa ? Math.round(sr / sa) : 255;
      out[q + 1] = sa ? Math.round(sg / sa) : 255;
      out[q + 2] = sa ? Math.round(sb / sa) : 255;
      out[q + 3] = Math.round(sa / n);
    }
  }
  return { w, h, rgba: out };
}

// ---------------------------------------------------------------- vektorový obrys (DXF / DWG)

/** Obrys loga: mřížka nejvýš maxCols × maxRows, inkoust = tmavší než práh Otsu (na bílém podkladu), sloučené obdélníky. */
export function traceLogo(r: Raster, maxCols = 160, maxRows = 80): LogoTrace {
  let cols = Math.min(r.w, maxCols);
  let rows = Math.max(1, Math.round((cols * r.h) / r.w));
  if (rows > maxRows) {
    rows = maxRows;
    cols = Math.max(1, Math.round((rows * r.w) / r.h));
  }
  const lum = new Float32Array(cols * rows);
  const rgb = new Float32Array(cols * rows * 3);
  for (let gy = 0; gy < rows; gy++) {
    const y0 = Math.floor((gy * r.h) / rows);
    const y1 = Math.max(y0 + 1, Math.floor(((gy + 1) * r.h) / rows));
    for (let gx = 0; gx < cols; gx++) {
      const x0 = Math.floor((gx * r.w) / cols);
      const x1 = Math.max(x0 + 1, Math.floor(((gx + 1) * r.w) / cols));
      let sr = 0, sg = 0, sb = 0, n = 0;
      for (let y = y0; y < y1; y++)
        for (let x = x0; x < x1; x++) {
          const q = (y * r.w + x) * 4;
          const a = r.rgba[q + 3] / 255;
          // průhledné = bílý papír
          sr += r.rgba[q] * a + 255 * (1 - a);
          sg += r.rgba[q + 1] * a + 255 * (1 - a);
          sb += r.rgba[q + 2] * a + 255 * (1 - a);
          n++;
        }
      const i = gy * cols + gx;
      rgb[i * 3] = sr / n;
      rgb[i * 3 + 1] = sg / n;
      rgb[i * 3 + 2] = sb / n;
      lum[i] = 0.299 * rgb[i * 3] + 0.587 * rgb[i * 3 + 1] + 0.114 * rgb[i * 3 + 2];
    }
  }
  // práh Otsu (histogram jasu buněk)
  const hist = new Array<number>(256).fill(0);
  for (const v of lum) hist[Math.max(0, Math.min(255, Math.round(v)))]++;
  const total = lum.length;
  let sum = 0;
  for (let i = 0; i < 256; i++) sum += i * hist[i];
  let sumB = 0, wB = 0, best = -1, thr = 128;
  for (let t = 0; t < 256; t++) {
    wB += hist[t];
    if (!wB) continue;
    const wF = total - wB;
    if (!wF) break;
    sumB += t * hist[t];
    const mB = sumB / wB;
    const mF = (sum - sumB) / wF;
    const between = wB * wF * (mB - mF) ** 2;
    if (between > best) {
      best = between;
      thr = t;
    }
  }
  // téměř jednobarevný obrázek: inkoust jen to, co je zřetelně tmavší než bílá
  const minL = Math.min(...lum);
  const maxL = Math.max(...lum);
  if (maxL - minL < 24) thr = maxL > 230 ? minL - 1 : 200;
  const ink = (i: number) => lum[i] <= thr && lum[i] < 245;
  const rects: number[] = [];
  let cr = 0, cg = 0, cb = 0, cn = 0;
  // pruhy v řádcích, svisle sloučené (stejný začátek i konec v navazujícím řádku)
  const open = new Map<string, number>(); // "c0,c1" → index v rects
  for (let gy = 0; gy < rows; gy++) {
    const seen = new Set<string>();
    let gx = 0;
    while (gx < cols) {
      if (!ink(gy * cols + gx)) {
        gx++;
        continue;
      }
      const c0 = gx;
      while (gx < cols && ink(gy * cols + gx)) {
        const i = gy * cols + gx;
        cr += rgb[i * 3];
        cg += rgb[i * 3 + 1];
        cb += rgb[i * 3 + 2];
        cn++;
        gx++;
      }
      const key = `${c0},${gx}`;
      seen.add(key);
      const at = open.get(key);
      if (at !== undefined && rects[at + 3] === gy) rects[at + 3] = gy + 1;
      else {
        open.set(key, rects.length);
        rects.push(c0, gy, gx, gy + 1);
      }
    }
    for (const k of [...open.keys()]) if (!seen.has(k)) open.delete(k);
  }
  const hex = (v: number) => Math.round(v).toString(16).padStart(2, "0");
  const color = cn ? `#${hex(cr / cn)}${hex(cg / cn)}${hex(cb / cn)}` : "#000000";
  return { cols, rows, color, rects };
}

// ---------------------------------------------------------------- prohlížeč: obrázek přes canvas

const hasCanvas = () => typeof document !== "undefined" && typeof Image !== "undefined";

/** Obrázek (libovolný formát, který prohlížeč umí) → rastr RGBA (zmenšený) – jen v prohlížeči. */
export async function rasterInBrowser(src: string, maxW = LOGO_MAX_W, maxH = LOGO_MAX_H): Promise<Raster> {
  const img = new Image();
  img.decoding = "async";
  img.src = src;
  await img.decode();
  let w = img.naturalWidth || img.width || 300;
  let h = img.naturalHeight || img.height || 150;
  const k = Math.min(1, maxW / w, maxH / h);
  w = Math.max(1, Math.round(w * k));
  h = Math.max(1, Math.round(h * k));
  const c = document.createElement("canvas");
  c.width = w;
  c.height = h;
  const g = c.getContext("2d");
  if (!g) throw new Error(tr("Prohlížeč nepodporuje kreslení do canvasu."));
  g.drawImage(img, 0, 0, w, h);
  return { w, h, rgba: new Uint8Array(g.getImageData(0, 0, w, h).data.buffer) };
}

// ---------------------------------------------------------------- příprava loga

/**
 * Logo z data URL: kontrola formátu a velikosti, zmenšení na nejvýš 600 × 300 px (PNG), vektorový obrys pro DXF / DWG.
 * Vrací logo a upozornění (např. JPEG bez obrysu mimo prohlížeč). Chyba = text pro protokol (✗).
 */
export async function prepareLogo(src: string, name?: string): Promise<{ logo: TitleLogo; warnings: string[] }> {
  const d = parseDataUrl(src);
  if (!d) throw new Error(tr("logo: čekám data URL obrázku (data:image/png;base64,…) nebo název připojeného souboru"));
  if (d.bytes.length > LOGO_MAX_BYTES) throw new Error(tr("logo je příliš velké ({0} kB) – nejvýš {1} kB", Math.round(d.bytes.length / 1024), LOGO_MAX_BYTES / 1024));
  const kind = sniffImage(d.bytes);
  const warnings: string[] = [];
  const nm = name ? { name } : {};
  if (kind === "png") {
    let r: Raster;
    try {
      r = await decodePng(d.bytes);
    } catch (e) {
      // PNG, které vlastní dekodér nepřečte: v prohlížeči přes canvas jako ostatní formáty (stejně jako nahrání v panelu)
      if (!hasCanvas()) throw e;
      const c = await rasterInBrowser(toDataUrl("image/png", d.bytes)).catch(() => {
        throw e;
      });
      return { logo: { src: toDataUrl("image/png", await encodePng(c)), w: c.w, h: c.h, ...nm, trace: traceLogo(c) }, warnings };
    }
    const big = r.w > LOGO_MAX_W || r.h > LOGO_MAX_H;
    // prokládané PNG se uloží znovu bez prokládání (PDF vkládá jen neprokládaná data)
    const recode = big || pngInterlaced(d.bytes);
    if (big) r = downscale(r);
    const out = recode ? toDataUrl("image/png", await encodePng(r)) : toDataUrl("image/png", d.bytes);
    if (big) warnings.push(tr("logo zmenšeno na {0} × {1} px", r.w, r.h));
    return { logo: { src: out, w: r.w, h: r.h, ...nm, trace: traceLogo(r) }, warnings };
  }
  if (!kind) throw new Error(tr("logo: neznámý formát obrázku – použijte PNG nebo JPEG"));
  if (hasCanvas()) {
    // JPEG / SVG / WebP / GIF v prohlížeči: rastr přes canvas → PNG (obrys pro DXF / DWG z rastru)
    const r = await rasterInBrowser(toDataUrl(d.mime.startsWith("image/") ? d.mime : `image/${kind === "svg" ? "svg+xml" : kind}`, d.bytes));
    return { logo: { src: toDataUrl("image/png", await encodePng(r)), w: r.w, h: r.h, ...nm, trace: traceLogo(r) }, warnings };
  }
  if (kind === "jpeg") {
    const s = jpegSize(d.bytes);
    if (!s) throw new Error(tr("logo: JPEG bez hlavičky rozměru"));
    warnings.push(tr("logo JPEG bez prohlížeče: v DXF / DWG jen rámeček (pro obrys použijte PNG)"));
    return { logo: { src: toDataUrl("image/jpeg", d.bytes), w: s.w, h: s.h, ...nm }, warnings };
  }
  throw new Error(tr("logo {0} jde převést jen v prohlížeči – bez něj použijte PNG nebo JPEG", kind.toUpperCase()));
}
