/**
 * Kolo 7, bod 13 („bez WebCodecs jen ZIP s PNG“): prohlížeč bez kodéru videa dostane animované PNG se stejným časováním.
 * Před opravou (260ff8b) modul neexistoval a export videa v Safari uložil jen ZIP snímků (video až přes ffmpeg).
 */
import { describe, expect, it } from "vitest";
import zlib from "node:zlib";
import { assembleApng, readApng } from "./apng";
import { crc32 } from "./formats/zip";
import { videoPlan } from "./motion-video";

/** malé PNG RGB w × h jedné barvy (jako snímek z plátna) */
function png(w: number, h: number, rgb: [number, number, number]): Uint8Array {
  const raw = Buffer.alloc((w * 3 + 1) * h);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) raw.set(rgb, y * (w * 3 + 1) + 1 + x * 3);
  const chunk = (type: string, data: Uint8Array) => {
    const b = Buffer.alloc(12 + data.length);
    b.writeUInt32BE(data.length, 0);
    b.write(type, 4, "ascii");
    Buffer.from(data).copy(b, 8);
    b.writeUInt32BE(crc32(b.subarray(4, 8 + data.length)), 8 + data.length);
    return b;
  };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0);
  ihdr.writeUInt32BE(h, 4);
  ihdr[8] = 8;
  ihdr[9] = 2;
  return new Uint8Array(Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk("IHDR", ihdr), chunk("IDAT", zlib.deflateSync(raw)), chunk("IEND", new Uint8Array(0))]));
}

describe("APNG s pevným časováním (export videa bez WebCodecs a WebP)", () => {
  it("studie 0,65 s při 1×: 20 snímků po 1/30 s = 0,667 s (stejný plán jako WebM), kontrolní součty v pořádku", () => {
    const plan = videoPlan(0.65, {});
    const frames = Array.from({ length: plan.frames }, (_, i) => png(8, 6, [i * 10, 50, 200 - i * 5]));
    const a = readApng(assembleApng(frames, plan.fps));
    expect(a.frames).toBe(20);
    expect(a.delays).toHaveLength(20);
    for (const d of a.delays) expect(d).toBeCloseTo(1 / 30, 12);
    expect(a.seconds).toBeCloseTo(plan.seconds, 9);
    expect(Math.abs(a.seconds - 0.65)).toBeLessThanOrEqual(1 / 30);
    expect(a.crcOk).toBe(true);
    expect([a.width, a.height]).toEqual([8, 6]);
    expect(a.plays).toBe(0);
  });

  it("zpomalení 0,25×: 78 snímků = 2,6 s; necelá snímková frekvence se zapíše přesně (tisíciny)", () => {
    const plan = videoPlan(0.65, { speed: 0.25 });
    const a = readApng(assembleApng(Array.from({ length: plan.frames }, () => png(4, 4, [1, 2, 3])), plan.fps));
    expect(a.frames).toBe(78);
    expect(a.seconds).toBeCloseTo(2.6, 9);
    const b = readApng(assembleApng([png(4, 4, [0, 0, 0]), png(4, 4, [9, 9, 9])], 12.5));
    expect(b.delays[0]).toBeCloseTo(0.08, 12);
  });

  it("pořadová čísla bloků rostou bez mezer (fcTL / fdAT), snímky jiného rozměru = chyba, ne tichý soubor", () => {
    const bytes = assembleApng([png(4, 4, [0, 0, 0]), png(4, 4, [255, 0, 0]), png(4, 4, [0, 255, 0])], 30);
    const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    const seq: number[] = [];
    for (let o = 8; o + 12 <= bytes.length; ) {
      const len = dv.getUint32(o);
      const type = String.fromCharCode(...bytes.subarray(o + 4, o + 8));
      if (type === "fcTL" || type === "fdAT") seq.push(dv.getUint32(o + 8));
      o += 12 + len;
    }
    expect(seq).toEqual(seq.map((_, i) => i));
    expect(() => assembleApng([png(4, 4, [0, 0, 0]), png(5, 4, [0, 0, 0])], 30)).toThrow(/jiný rozměr/);
    expect(() => assembleApng([], 30)).toThrow();
    // poškozený soubor kontrola pozná
    const bad = bytes.slice();
    bad[bad.length - 20] ^= 0xff;
    expect(readApng(bad).crcOk).toBe(false);
  });
});
