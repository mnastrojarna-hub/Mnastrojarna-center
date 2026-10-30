import "server-only";
import { fitForClaude } from "./claude-image";
import { fillPolygon, rawSharp, type Raster } from "./pdf-raster";
import type { Box } from "./types";

/**
 * Obrázky (fotky, PNG/JPEG/WebP/TIFF) pro anonymizaci (spec §2.3, §3.3): dekódování masteru se
 * zapečenou EXIF orientací, narovnání, ořez na list (+ bílá mimo polygon listu), výřezy pro Claude,
 * výstup BEZ metadat (žádné withMetadata → bez EXIF/GPS/IPTC/XMP/ICC) a kontrola výstupu.
 */

/** Pracovní mez rastru fotky (px) — větší fotka se při dekódování ZMENŠÍ na tuto mez. */
export const LIMIT_INPUT_PIXELS = 60_000_000;
/** Absolutní mez vstupu (ochrana proti „dekompresní bombě"). */
export const MAX_INPUT_PIXELS = 400_000_000;
export const MAX_SOURCE_BYTES = 50 * 1024 * 1024;

type SharpFn = typeof import("sharp");
async function sharpLib(): Promise<SharpFn> {
  return (await import("sharp")).default;
}

/**
 * Dekóduje obrázek (EXIF orientace zapečená) do RGB rastru. page = stránka vícestránkového TIFFu.
 * Nad LIMIT_INPUT_PIXELS se zmenší (zachová poměr stran), nad MAX_INPUT_PIXELS chyba.
 */
export async function decodeImage(bytes: Uint8Array, page?: number): Promise<Raster & { format: string; downscaled: boolean }> {
  const sharp = await sharpLib();
  const meta = await sharp(Buffer.from(bytes), { limitInputPixels: MAX_INPUT_PIXELS, ...(page !== undefined ? { page } : {}) }).metadata();
  const w0 = meta.width ?? 0, h0 = meta.height ?? 0;
  let s = sharp(Buffer.from(bytes), { limitInputPixels: MAX_INPUT_PIXELS, ...(page !== undefined ? { page } : {}) }).rotate();
  let downscaled = false;
  if (w0 * h0 > LIMIT_INPUT_PIXELS) {
    const k = Math.sqrt(LIMIT_INPUT_PIXELS / (w0 * h0));
    // EXIF orientace 5–8 prohodí strany — fit "inside" do čtverce zachová poměr v obou případech
    const side = Math.floor(Math.max(w0, h0) * k);
    s = s.resize({ width: side, height: side, fit: "inside", kernel: "lanczos3", withoutEnlargement: true });
    downscaled = true;
  }
  const { data, info } = await s.removeAlpha().toColourspace("srgb").raw().toBuffer({ resolveWithObject: true });
  if (info.channels !== 3) throw new Error("Neočekávaný počet kanálů obrázku.");
  return { width: info.width, height: info.height, channels: 3, data: new Uint8Array(data.buffer, data.byteOffset, data.byteLength), format: meta.format ?? "", downscaled };
}

/**
 * Fotka HEIC / HEIF z iPhonu (kodek HEVC — sharp ho v předkompilované knihovně neumí) → JPEG q95 BEZ
 * metadat (EXIF / GPS / XMP zahozeny). Dekóduje libheif (WebAssembly, heic-decode), orientace (irot /
 * imir) je už zapečená. AVIF (AV1) přečte sharp sám — sem se nedostane.
 */
export async function heicToJpeg(bytes: Uint8Array): Promise<Uint8Array> {
  const decode = (await import("heic-decode")).default;
  const img = await decode({ buffer: bytes });
  if (!img?.width || !img?.height || img.width * img.height > MAX_INPUT_PIXELS) throw new Error("Fotku HEIC nejde dekódovat.");
  const sharp = await sharpLib();
  const data = Buffer.from(img.data.buffer, img.data.byteOffset, img.data.byteLength);
  const jpeg = await sharp(data, { raw: { width: img.width, height: img.height, channels: 4 }, limitInputPixels: MAX_INPUT_PIXELS })
    .removeAlpha().jpeg({ quality: 95 }).toBuffer();
  return new Uint8Array(jpeg);
}

/** Počet stránek obrázku (vícestránkový TIFF). */
export async function imagePages(bytes: Uint8Array): Promise<{ pages: number; format: string; compression?: string; width?: number; height?: number }> {
  const sharp = await sharpLib();
  const m = await sharp(Buffer.from(bytes), { limitInputPixels: MAX_INPUT_PIXELS }).metadata();
  return { pages: m.pages ?? 1, format: m.format ?? "", compression: (m as { compression?: string }).compression, width: m.width, height: m.height };
}

/** Výřez rastru (px) → JPEG pro Claude (fitForClaude, q85). */
export async function cropToJpeg(r: Raster, crop: Box, maxUpscale = 1): Promise<{ jpeg: Uint8Array; s: number; outW: number; outH: number; crop: Box }> {
  const sharp = await sharpLib();
  const x = Math.max(0, Math.floor(crop.x)), y = Math.max(0, Math.floor(crop.y));
  const w = Math.max(1, Math.min(r.width - x, Math.ceil(crop.w))), h = Math.max(1, Math.min(r.height - y, Math.ceil(crop.h)));
  const f = fitForClaude(w, h, maxUpscale);
  const jpeg = await rawSharp(sharp, r)
    .extract({ left: x, top: y, width: w, height: h })
    .resize(f.w, f.h, { fit: "fill", kernel: "lanczos3" })
    .jpeg({ quality: 85 })
    .toBuffer();
  return { jpeg: new Uint8Array(jpeg), s: f.w / w, outW: f.w, outH: f.h, crop: { x, y, w, h } };
}

/** Celý rastr zmenšený na mez Claude (přehled). */
export async function overviewJpeg(r: Raster) {
  return cropToJpeg(r, { x: 0, y: 0, w: r.width, h: r.height });
}

/**
 * Narovnání: otočí rastr o −angle (angle = natočení listu proti směru hodinových ručiček, ve stupních).
 * sharp.rotate(+) točí po směru hodinových ručiček a plátno zvětší (střed na střed).
 * Vrací nový rastr a transformaci bodů starý → nový.
 */
export async function straighten(r: Raster, angleDeg: number): Promise<{ raster: Raster; map: (x: number, y: number) => [number, number] }> {
  const sharp = await sharpLib();
  const { data, info } = await rawSharp(sharp, r).rotate(angleDeg, { background: "#ffffff" }).removeAlpha().raw().toBuffer({ resolveWithObject: true });
  const a = (angleDeg * Math.PI) / 180;
  const cx = r.width / 2, cy = r.height / 2, cx2 = info.width / 2, cy2 = info.height / 2;
  const cos = Math.cos(a), sin = Math.sin(a);
  const map = (x: number, y: number): [number, number] => [cx2 + (x - cx) * cos - (y - cy) * sin, cy2 + (x - cx) * sin + (y - cy) * cos];
  return { raster: { width: info.width, height: info.height, channels: 3, data: new Uint8Array(data.buffer, data.byteOffset, data.byteLength) }, map };
}

/** Ořez rastru (px). */
export async function cropRaster(r: Raster, box: Box): Promise<Raster> {
  const sharp = await sharpLib();
  const x = Math.max(0, Math.floor(box.x)), y = Math.max(0, Math.floor(box.y));
  const w = Math.max(1, Math.min(r.width - x, Math.ceil(box.w))), h = Math.max(1, Math.min(r.height - y, Math.ceil(box.h)));
  const { data, info } = await rawSharp(sharp, r).extract({ left: x, top: y, width: w, height: h }).raw().toBuffer({ resolveWithObject: true });
  return { width: info.width, height: info.height, channels: r.channels, data: new Uint8Array(data.buffer, data.byteOffset, data.byteLength) };
}

/** Bílá mimo polygon listu (stůl, vizitka, monitor vedle listu neprojdou). */
export function whitenOutside(r: Raster, poly: readonly number[], value: readonly number[] = [255, 255, 255]) {
  const n = poly.length / 2;
  const c = r.channels;
  for (let y = 0; y < r.height; y++) {
    const yc = y + 0.5;
    const xs: number[] = [];
    for (let i = 0; i < n; i++) {
      const ax = poly[i * 2], ay = poly[i * 2 + 1];
      const bx = poly[((i + 1) % n) * 2], by = poly[((i + 1) % n) * 2 + 1];
      if ((ay <= yc && by > yc) || (by <= yc && ay > yc)) xs.push(ax + ((yc - ay) / (by - ay)) * (bx - ax));
    }
    xs.sort((a, b) => a - b);
    let cursor = 0;
    const fill = (from: number, to: number) => {
      let o = (y * r.width + from) * c;
      for (let x = from; x < to; x++, o += c) for (let k = 0; k < c; k++) r.data[o + k] = value[Math.min(k, value.length - 1)];
    };
    for (let k = 0; k + 1 < xs.length; k += 2) {
      const a = Math.max(0, Math.min(r.width, Math.floor(xs[k])));
      const b = Math.max(0, Math.min(r.width, Math.ceil(xs[k + 1])));
      if (a > cursor) fill(cursor, a);
      cursor = Math.max(cursor, b);
    }
    if (cursor < r.width) fill(cursor, r.width);
  }
}

/** Barva pozadí kolem oblasti (medián prstence) — výplň fotky „background". */
export function ringMedianColor(r: Raster, box: Box, ring: number): number[] {
  const vals: number[][] = Array.from({ length: r.channels }, () => []);
  const x0 = Math.max(0, Math.floor(box.x - ring)), y0 = Math.max(0, Math.floor(box.y - ring));
  const x1 = Math.min(r.width, Math.ceil(box.x + box.w + ring)), y1 = Math.min(r.height, Math.ceil(box.y + box.h + ring));
  const step = Math.max(1, Math.floor(((x1 - x0) * (y1 - y0)) / 40_000));
  let k = 0;
  for (let y = y0; y < y1; y++) {
    for (let x = x0; x < x1; x++) {
      if (x >= box.x && x < box.x + box.w && y >= box.y && y < box.y + box.h) continue;
      if (k++ % step) continue;
      const o = (y * r.width + x) * r.channels;
      for (let c = 0; c < r.channels; c++) vals[c].push(r.data[o + c]);
    }
  }
  return vals.map((v) => {
    if (!v.length) return 255;
    v.sort((a, b) => a - b);
    // světlé pozadí: horní kvartil (text uvnitř prstence medián ztmaví)
    return v[Math.floor(v.length * 0.75)];
  });
}

/** Vypálí polygony (čtyřúhelníky v px) barvou. */
export function burnPolygons(r: Raster, polys: { quad: readonly number[]; fill: readonly number[] }[]) {
  for (const p of polys) fillPolygon(r, p.quad, p.fill);
}

/** Výstup obrázku BEZ metadat (JPEG q90, PNG zůstane PNG). */
export async function encodeImageOutput(r: Raster, format: "jpeg" | "png"): Promise<Uint8Array> {
  const sharp = await sharpLib();
  const s = rawSharp(sharp, r);
  const out = format === "png" ? await s.png({ compressionLevel: 9 }).toBuffer() : await s.jpeg({ quality: 90 }).toBuffer();
  return new Uint8Array(out);
}

export interface ImageOutputCheck {
  ok: boolean;
  problems: string[];
}

/** Kontrola výstupu: bez EXIF/XMP/IPTC/ICC, rozměry, vzorek pixelů ve vyplněných oblastech. */
export async function checkImageOutput(bytes: Uint8Array, expect: { width: number; height: number; samples?: { x: number; y: number; fill: readonly number[] }[] }): Promise<ImageOutputCheck> {
  const sharp = await sharpLib();
  const problems: string[] = [];
  const m = await sharp(Buffer.from(bytes)).metadata();
  if (m.exif) problems.push("výstup obsahuje EXIF");
  if (m.xmp) problems.push("výstup obsahuje XMP");
  if (m.iptc) problems.push("výstup obsahuje IPTC");
  if (m.icc) problems.push("výstup obsahuje ICC");
  if (m.width !== expect.width || m.height !== expect.height) problems.push("nesedí rozměry výstupu");
  if (expect.samples?.length) {
    const { data, info } = await sharp(Buffer.from(bytes)).removeAlpha().toColourspace("srgb").raw().toBuffer({ resolveWithObject: true });
    let bad = 0;
    for (const s of expect.samples) {
      const x = Math.max(0, Math.min(info.width - 1, Math.round(s.x))), y = Math.max(0, Math.min(info.height - 1, Math.round(s.y)));
      const o = (y * info.width + x) * info.channels;
      for (let c = 0; c < 3; c++) if (Math.abs(data[o + c] - s.fill[Math.min(c, s.fill.length - 1)]) > 40) { bad++; break; }
    }
    if (bad > Math.max(1, expect.samples.length * 0.05)) problems.push("vyplněné oblasti nejsou jednolité");
  }
  return { ok: problems.length === 0, problems };
}

/** Rastr → JPEG (pro stránku PDF ze skenu / fotky). */
export async function rasterToJpeg(r: Raster, quality = 85): Promise<Uint8Array> {
  const sharp = await sharpLib();
  return new Uint8Array(await rawSharp(sharp, r).jpeg({ quality }).toBuffer());
}

/** RGB → šedá, když obraz nemá barvu (sken bez barev). */
/**
 * Barevný rastr bez barvy → šedý (menší soubor). opts.minPixels = absolutní práh sytých pixelů (vykreslené
 * vektorové PDF bez šumu: malá červená revize zůstane červená); bez něj podíl vzorku (fotky mají barevný šum).
 */
export function maybeGray(r: Raster, opts: { minPixels?: number } = {}): Raster {
  if (r.channels === 1) return r;
  let colored = 0, total = 0;
  if (opts.minPixels) {
    for (let i = 0, o = 0; i < r.width * r.height; i++, o += 3) {
      if (Math.max(r.data[o], r.data[o + 1], r.data[o + 2]) - Math.min(r.data[o], r.data[o + 1], r.data[o + 2]) > 48 && ++colored >= opts.minPixels) return r;
    }
  } else {
    const step = Math.max(1, Math.floor((r.width * r.height) / 200_000));
    for (let i = 0; i < r.width * r.height; i += step) {
      const o = i * 3;
      total++;
      if (Math.max(r.data[o], r.data[o + 1], r.data[o + 2]) - Math.min(r.data[o], r.data[o + 1], r.data[o + 2]) > 48) colored++;
    }
    if (colored / Math.max(1, total) > 0.002) return r;
  }
  const g = new Uint8Array(r.width * r.height);
  for (let i = 0, o = 0; i < g.length; i++, o += 3) g[i] = (r.data[o] * 299 + r.data[o + 1] * 587 + r.data[o + 2] * 114 + 500) / 1000;
  return { width: r.width, height: r.height, channels: 1, data: g };
}

export function cloneRaster(r: Raster): Raster {
  return { width: r.width, height: r.height, channels: r.channels, data: new Uint8Array(r.data) };
}
