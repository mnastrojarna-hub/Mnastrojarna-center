import { describe, expect, it } from "vitest";
import sharp from "sharp";
import { RASTER_MAX_SIDE, rasterFormatOf, rasterPreview } from "./raster-preview";

async function page(color: string, w = 300, h = 200): Promise<Buffer> {
  return sharp({ create: { width: w, height: h, channels: 3, background: color } }).png().toBuffer();
}

describe("náhled TIFF / HEIC pro prohlížeč", () => {
  it("rozpozná TIFF / HEIC podle obsahu, přípony i typu", () => {
    expect(rasterFormatOf("a.bin", null, new Uint8Array([0x49, 0x49, 0x2a, 0, 8, 0, 0, 0, 0, 0, 0, 0]))).toBe("tiff");
    expect(rasterFormatOf("a.bin", null, new Uint8Array([0x4d, 0x4d, 0, 0x2a, 0, 0, 0, 8, 0, 0, 0, 0]))).toBe("tiff");
    const heic = new Uint8Array([0, 0, 0, 24, ...Buffer.from("ftypheic")]);
    expect(rasterFormatOf("x", null, heic)).toBe("heic");
    expect(rasterFormatOf("SKEN.TIF", null)).toBe("tiff");
    expect(rasterFormatOf("x", "image/heif")).toBe("heic");
    expect(rasterFormatOf("v.pdf", "application/pdf")).toBeNull();
  });

  it("jednostránkový TIFF → PNG stejné velikosti, počet stran 1", async () => {
    const tiff = await sharp(await page("#ff0000")).tiff().toBuffer();
    const out = await rasterPreview(new Uint8Array(tiff), "tiff", 1);
    expect(out.contentType).toBe("image/png");
    expect(out.pages).toBe(1);
    expect(out.page).toBe(1);
    const meta = await sharp(out.body).metadata();
    expect([meta.format, meta.width, meta.height]).toEqual(["png", 300, 200]);
  });

  it("vícestránkový TIFF: počet stran a vybraná strana (mimo rozsah → poslední)", async () => {
    const pages = await Promise.all([page("#ff0000"), page("#00ff00"), page("#0000ff")]);
    const tiff = await sharp(pages, { join: { animated: true } }).tiff().toBuffer().catch(() => null);
    if (!tiff) return; // starší libvips bez vícestránkového zápisu
    const second = await rasterPreview(new Uint8Array(tiff), "tiff", 2);
    expect(second.pages).toBe(3);
    expect(second.page).toBe(2);
    const { data } = await sharp(second.body).raw().toBuffer({ resolveWithObject: true });
    // zelená strana (kódování TIFFu může posunout o jednotky)
    expect(data[0]).toBeLessThan(10);
    expect(data[1]).toBeGreaterThan(245);
    expect(data[2]).toBeLessThan(10);
    const last = await rasterPreview(new Uint8Array(tiff), "tiff", 99);
    expect(last.page).toBe(3);
  });

  it("velký sken se zmenší na nejvýš RASTER_MAX_SIDE px delší strany", async () => {
    const big = await sharp({ create: { width: 6000, height: 1500, channels: 3, background: "#ffffff" } }).tiff({ compression: "lzw" }).toBuffer();
    const out = await rasterPreview(new Uint8Array(big), "tiff", 1);
    expect(Math.max(out.width, out.height)).toBe(RASTER_MAX_SIDE);
    expect(out.height).toBe(1000);
  });

  it("poškozený soubor → chyba (route vrátí 422 a prohlížeč nabídne originál)", async () => {
    await expect(rasterPreview(new Uint8Array([0x49, 0x49, 0x2a, 0, 1, 2, 3]), "tiff", 1)).rejects.toThrow();
  });
});
