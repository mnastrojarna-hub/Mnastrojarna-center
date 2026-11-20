/** Logo do razítka bez prohlížeče: PNG dekodér / kodér (zlib přes streamy), zmenšení, obrys pro DXF / DWG, JPEG bez prohlížeče. */
import zlib from "node:zlib";
import { describe, expect, it } from "vitest";
import { decodePng, downscale, encodePng, jpegSize, parseDataUrl, prepareLogo, sniffImage, toDataUrl, traceLogo, type Raster } from "./title-logo";

/** bílý obrázek s červeným obdélníkem vlevo a černým vpravo */
function sample(w = 40, h = 20): Raster {
  const rgba = new Uint8Array(w * h * 4).fill(255);
  const put = (x: number, y: number, c: [number, number, number]) => rgba.set([...c, 255], (y * w + x) * 4);
  for (let y = 5; y < 15; y++) {
    for (let x = 2; x < 18; x++) put(x, y, [224, 57, 48]);
    for (let x = 24; x < 38; x++) put(x, y, [20, 20, 20]);
  }
  return { w, h, rgba };
}

/** PNG složené ručně (zlib z Node) – barevné typy, které náš kodér nepíše */
function png(w: number, h: number, ctype: number, depth: number, rows: number[][], extra: [string, number[]][] = [], filters: number[] = []): Uint8Array {
  const crcT = Array.from({ length: 256 }, (_, n) => {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    return c >>> 0;
  });
  const crc = (b: Buffer) => {
    let c = 0xffffffff;
    for (const x of b) c = crcT[(c ^ x) & 0xff] ^ (c >>> 8);
    return (c ^ 0xffffffff) >>> 0;
  };
  const chunk = (t: string, d: Buffer) => {
    const len = Buffer.alloc(4);
    len.writeUInt32BE(d.length);
    const td = Buffer.concat([Buffer.from(t, "ascii"), d]);
    const c = Buffer.alloc(4);
    c.writeUInt32BE(crc(td));
    return Buffer.concat([len, td, c]);
  };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0);
  ihdr.writeUInt32BE(h, 4);
  ihdr[8] = depth;
  ihdr[9] = ctype;
  const raw = Buffer.concat(rows.map((r, i) => Buffer.from([filters[i] ?? 0, ...r])));
  return new Uint8Array(Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), chunk("IHDR", ihdr), ...extra.map(([t, d]) => chunk(t, Buffer.from(d))), chunk("IDAT", zlib.deflateSync(raw)), chunk("IEND", Buffer.alloc(0))]));
}

describe("PNG bez prohlížeče", () => {
  it("kódování → dekódování RGBA beze ztráty; data URL a rozpoznání formátu", async () => {
    const r = sample();
    const bytes = await encodePng(r);
    expect(sniffImage(bytes)).toBe("png");
    const back = await decodePng(bytes);
    expect([back.w, back.h]).toEqual([40, 20]);
    expect(Buffer.from(back.rgba).equals(Buffer.from(r.rgba))).toBe(true);
    const url = toDataUrl("image/png", bytes);
    expect(parseDataUrl(url)!.mime).toBe("image/png");
    expect(Buffer.from(parseDataUrl(url)!.bytes).equals(Buffer.from(bytes))).toBe(true);
    expect(parseDataUrl("data:image/svg+xml,%3Csvg%20xmlns%3D%22x%22%3E%3C%2Fsvg%3E")).toMatchObject({ mime: "image/svg+xml" });
    expect(sniffImage(parseDataUrl("data:image/svg+xml,%3Csvg%20xmlns%3D%22x%22%3E%3C%2Fsvg%3E")!.bytes)).toBe("svg");
  });
  it("šedé 8 bit, paleta 4 bit s průhledností, RGB 16 bit, filtry Sub/Up/Average/Paeth", async () => {
    const gray = await decodePng(png(3, 1, 0, 8, [[0, 128, 255]]));
    expect([...gray.rgba]).toEqual([0, 0, 0, 255, 128, 128, 128, 255, 255, 255, 255, 255]);
    // paleta: index 0 = červená průhledná, 1 = modrá; 4 bity na pixel (2 pixely v bajtu)
    const pal = await decodePng(png(2, 1, 3, 4, [[0x01]], [["PLTE", [255, 0, 0, 0, 0, 255]], ["tRNS", [0]]]));
    expect([...pal.rgba]).toEqual([255, 0, 0, 0, 0, 0, 255, 255]);
    const rgb16 = await decodePng(png(1, 1, 2, 16, [[0xff, 0x00, 0x80, 0x00, 0x00, 0x10]]));
    expect([...rgb16.rgba]).toEqual([255, 128, 0, 255]);
    // filtry řádků: Sub (1), Up (2), Average (3), Paeth (4) – šedé 8 bit, 2 × 5 px
    const f = await decodePng(png(2, 5, 0, 8, [[10, 20], [10, 5], [5, 5], [1, 2], [3, 4]], [], [0, 1, 2, 3, 4]));
    const g = [...f.rgba].filter((_, i) => i % 4 === 0);
    // Sub: 10, 10+5 · Up: 10+5, 15+5 · Average: 1+(0+15)>>1, 2+(8+20)>>1 · Paeth: 3+b(8), 4+b(16) (a=11, b=16, c=8 → p=19 nejblíž b)
    expect(g).toEqual([10, 20, 10, 15, 15, 20, 8, 16, 11, 20]);
  });
  it("chyby: není PNG, neznámé prokládání; Adam7 se čte (1 × 1 px = jediný průchod, celé Adam7 v title-block-review.test.ts)", async () => {
    await expect(decodePng(new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8, 9]))).rejects.toThrow(/není PNG/);
    const inter = png(1, 1, 0, 8, [[0]]);
    inter[8 + 8 + 12] = 1; // IHDR: prokládání Adam7
    expect((await decodePng(inter)).rgba).toEqual(new Uint8Array([0, 0, 0, 255]));
    inter[8 + 8 + 12] = 2; // neznámá metoda
    await expect(decodePng(inter)).rejects.toThrow(/nepodporované prokládání PNG 2/);
  });
});

describe("obrys loga pro DXF / DWG", () => {
  it("inkoust = červený a černý obdélník, sloučené pruhy, barva inkoustu", () => {
    const t = traceLogo(sample());
    expect([t.cols, t.rows]).toEqual([40, 20]);
    // dva obdélníky přes 10 řádků (svisle sloučené pruhy)
    const rects: number[][] = [];
    for (let i = 0; i < t.rects.length; i += 4) rects.push(t.rects.slice(i, i + 4));
    expect(rects).toEqual([[2, 5, 18, 15], [24, 5, 38, 15]]);
    expect(t.color).toMatch(/^#[0-9a-f]{6}$/);
    const big = traceLogo(downscale({ w: 400, h: 200, rgba: new Uint8Array(400 * 200 * 4).fill(255) }));
    expect(big.rects).toEqual([]);
  });
  it("zmenšení průměrem bloku zachová poměr stran", () => {
    const d = downscale({ w: 1200, h: 300, rgba: new Uint8Array(1200 * 300 * 4).fill(200) });
    expect([d.w, d.h]).toEqual([600, 150]);
    expect(d.rgba[0]).toBe(200);
  });
});

describe("prepareLogo", () => {
  it("velké PNG → zmenšené PNG 600 × 150 s obrysem a upozorněním", async () => {
    const w = 1200;
    const h = 300;
    const rgba = new Uint8Array(w * h * 4).fill(255);
    for (let y = 100; y < 200; y++) for (let x = 100; x < 1100; x++) rgba.set([10, 10, 10, 255], (y * w + x) * 4);
    const src = toDataUrl("image/png", await encodePng({ w, h, rgba }));
    const r = await prepareLogo(src, "firma.png");
    expect(r.logo).toMatchObject({ w: 600, h: 150, name: "firma.png" });
    expect(r.warnings).toEqual(["logo zmenšeno na 600 × 150 px"]);
    expect(r.logo.trace!.rects.length).toBeGreaterThan(0);
    const back = await decodePng(parseDataUrl(r.logo.src)!.bytes);
    expect([back.w, back.h]).toEqual([600, 150]);
  });
  it("malé PNG beze změny; JPEG bez prohlížeče = rozměr ze SOF, bez obrysu, upozornění", async () => {
    const small = toDataUrl("image/png", await encodePng(sample()));
    const r = await prepareLogo(small);
    expect(r.logo.src).toBe(small);
    expect(r.warnings).toEqual([]);
    // minimální JPEG: SOI, APP0 (délka 4), SOF0 300 × 120
    const jpg = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x04, 0x00, 0x00, 0xff, 0xc0, 0x00, 0x11, 0x08, 0x00, 120, 0x01, 0x2c, 0x03, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0xff, 0xd9]);
    expect(jpegSize(jpg)).toEqual({ w: 300, h: 120 });
    const j = await prepareLogo(toDataUrl("image/jpeg", jpg), "foto.jpg");
    expect(j.logo).toMatchObject({ w: 300, h: 120, name: "foto.jpg" });
    expect(j.logo.trace).toBeUndefined();
    expect(j.warnings[0]).toMatch(/v DXF \/ DWG jen rámeček/);
  });
  it("chyby: není data URL, neznámý formát; SVG bez kreslitelných tvarů bez prohlížeče = jen vektor s upozorněním", async () => {
    await expect(prepareLogo("firma.png")).rejects.toThrow(/čekám data URL/);
    await expect(prepareLogo("data:application/octet-stream;base64,AAECAw==")).rejects.toThrow(/neznámý formát obrázku/);
    // vlna 22, bod 22j (D4): SVG se bez prohlížeče převádí z tvarů – prázdné SVG se přijme jen jako vektor, bez náhledu a obrysu,
    // a řekne to (žádný tichý úspěch); dřív ✗ „SVG jde převést jen v prohlížeči“
    const empty = await prepareLogo("data:image/svg+xml,%3Csvg%3E%3C%2Fsvg%3E");
    expect(empty.logo.trace).toBeUndefined();
    expect(empty.logo.svg).toMatch(/^data:image\/svg\+xml/);
    expect(empty.warnings).toEqual([expect.stringMatching(/^logo SVG bez kreslitelných tvarů: náhled ani obrys pro DXF\/DWG nejsou/)]);
  });
});
