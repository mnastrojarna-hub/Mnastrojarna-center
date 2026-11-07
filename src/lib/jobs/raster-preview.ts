import "server-only";
import { extensionOf } from "@/lib/viewer3d/sniff";

/**
 * Náhled TIFF / HEIC dokumentu zakázky pro prohlížeč (Chrome a Android TIFF ani HEIC nevykreslí):
 * jedna strana → PNG (výkresy, čárová kresba), u velkých skenů / fotek JPEG. Delší strana nejvýš
 * RASTER_MAX_SIDE px (telefon nespadne na paměti), odpověď do RASTER_MAX_BYTES (limit funkce na Vercelu).
 * Bez metadat (EXIF / GPS se nekopírují).
 */

export const RASTER_MAX_SIDE = 4000;
export const RASTER_MAX_BYTES = 4_000_000;
/** Absolutní mez vstupu (ochrana proti „dekompresní bombě") — A0 sken 600 dpi se ještě vejde. */
const MAX_INPUT_PIXELS = 400_000_000;

export type RasterFormat = "tiff" | "heic";

/** TIFF / HEIC podle obsahu, jinak přípony a typu; null = převod se netýká. */
export function rasterFormatOf(filename: string | null | undefined, mimeType: string | null | undefined, head?: Uint8Array): RasterFormat | null {
  if (head && head.length >= 12) {
    if ((head[0] === 0x49 && head[1] === 0x49 && head[2] === 0x2a && head[3] === 0) || (head[0] === 0x4d && head[1] === 0x4d && head[2] === 0 && head[3] === 0x2a)) return "tiff";
    const box = String.fromCharCode(head[4], head[5], head[6], head[7]);
    const brand = String.fromCharCode(head[8], head[9], head[10], head[11]);
    if (box === "ftyp" && /^(heic|heix|hevc|hevx|heim|heis|mif1|msf1)$/.test(brand)) return "heic";
  }
  const ext = extensionOf(filename);
  const mime = (mimeType ?? "").toLowerCase();
  if (ext === "tif" || ext === "tiff" || mime === "image/tiff") return "tiff";
  if (ext === "heic" || ext === "heif" || mime === "image/heic" || mime === "image/heif") return "heic";
  return null;
}

export interface RasterPreview {
  body: Buffer;
  contentType: "image/png" | "image/jpeg";
  /** Počet stran (vícestránkový TIFF), strana v náhledu (1…pages). */
  pages: number;
  page: number;
  width: number;
  height: number;
}

/** Převede stranu `page` (od 1) na PNG / JPEG. Chyba = soubor je poškozený nebo formát nejde přečíst. */
export async function rasterPreview(bytes: Uint8Array, format: RasterFormat, page = 1, maxSide = RASTER_MAX_SIDE): Promise<RasterPreview> {
  const sharp = (await import("sharp")).default;
  let input = Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let pages = 1;
  let p = 1;
  if (format === "heic") {
    // sharp v předkompilované knihovně HEVC neumí → libheif (WebAssembly)
    const { heicToJpeg } = await import("@/lib/anonymize/image");
    const jpeg = await heicToJpeg(bytes);
    input = Buffer.from(jpeg.buffer, jpeg.byteOffset, jpeg.byteLength);
  } else {
    const meta = await sharp(input, { limitInputPixels: MAX_INPUT_PIXELS }).metadata();
    pages = Math.max(1, meta.pages ?? 1);
    p = Math.min(pages, Math.max(1, Math.floor(page) || 1));
  }
  const side = Math.max(256, Math.min(RASTER_MAX_SIDE, Math.floor(maxSide)));
  const base = () =>
    sharp(input, { limitInputPixels: MAX_INPUT_PIXELS, ...(format === "tiff" ? { page: p - 1 } : {}) })
      .rotate()
      .flatten({ background: "#ffffff" })
      .toColourspace("srgb");
  const resized = (s: number) => base().resize({ width: s, height: s, fit: "inside", withoutEnlargement: true });

  // výkres (čárová kresba) → PNG; velké skeny a fotky se do limitu odpovědi vejdou jako JPEG
  let out = format === "heic"
    ? await resized(side).jpeg({ quality: 85, mozjpeg: true }).toBuffer({ resolveWithObject: true })
    : await resized(side).png({ compressionLevel: 8, adaptiveFiltering: true }).toBuffer({ resolveWithObject: true });
  let contentType: RasterPreview["contentType"] = format === "heic" ? "image/jpeg" : "image/png";
  if (out.data.length > RASTER_MAX_BYTES) {
    out = await resized(side).jpeg({ quality: 82, mozjpeg: true }).toBuffer({ resolveWithObject: true });
    contentType = "image/jpeg";
  }
  for (let s = Math.round(side * 0.75); out.data.length > RASTER_MAX_BYTES && s >= 1200; s = Math.round(s * 0.75)) {
    out = await resized(s).jpeg({ quality: 78, mozjpeg: true }).toBuffer({ resolveWithObject: true });
    contentType = "image/jpeg";
  }
  return { body: out.data, contentType, pages, page: p, width: out.info.width, height: out.info.height };
}
