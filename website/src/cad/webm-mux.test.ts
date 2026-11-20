/**
 * Vlna 22, bod 13: kontejner WebM s pevnými časovými značkami. Zapsaný soubor se přečte zpět: délka v hlavičce = počet
 * snímků / fps, bloky s časy i·1000/fps ms, kodek a rozměr; kontrola proti plánu odmítne video 2,926 s pro studii 0,65 s.
 */
import { describe, expect, it } from "vitest";
import { videoPlan } from "./motion-video";
import { checkWebm, muxWebm, readWebm, webpVp8 } from "./webm-mux";

/** „zakódované snímky“: různý obsah každého snímku (otisk bloků se musí lišit) */
const frames = (n: number, fps: number) => Array.from({ length: n }, (_, i) => ({ data: new Uint8Array(Array.from({ length: 40 + i }, (_, k) => (k * 7 + i * 13) & 255)), time: (i * 1000) / fps, key: i % fps === 0 }));

describe("WebM s pevným časováním", () => {
  it("0,65 s studie při 1×: 20 snímků, délka 666,7 ms, časy bloků po 33,3 ms, snímky různé", () => {
    const plan = videoPlan(0.65);
    const bytes = muxWebm({ codec: "V_VP8", width: 640, height: 360, fps: plan.fps, frames: frames(plan.frames, plan.fps), duration: plan.seconds * 1000 });
    expect([...bytes.slice(0, 4)]).toEqual([0x1a, 0x45, 0xdf, 0xa3]);
    const info = readWebm(bytes);
    expect(info.docType).toBe("webm");
    expect(info.codec).toBe("V_VP8");
    expect([info.width, info.height]).toEqual([640, 360]);
    expect(info.duration).toBeCloseTo(666.667, 2);
    expect(Math.abs(info.duration! / 1000 - 0.65)).toBeLessThanOrEqual(1 / 30);
    expect(info.blocks).toHaveLength(20);
    info.blocks.forEach((b, i) => expect(Math.abs(b.time - (i * 1000) / 30)).toBeLessThanOrEqual(1));
    expect(info.blocks[0].key).toBe(true);
    expect(new Set(info.blocks.map((b) => b.hash)).size).toBe(20);
    expect(checkWebm(info, plan)).toEqual([]);
  });
  it("zpomalení 0,25×: 78 snímků, 2,6 s; dlouhé video (> 30 s) dělí clustery", () => {
    const plan = videoPlan(0.65, { speed: 0.25 });
    const info = readWebm(muxWebm({ codec: "V_VP9", width: 320, height: 180, fps: 30, frames: frames(plan.frames, 30), duration: plan.seconds * 1000 }));
    expect(info.codec).toBe("V_VP9");
    expect(info.duration! / 1000).toBeCloseTo(2.6, 6);
    expect(checkWebm(info, plan)).toEqual([]);
    const long = videoPlan(40, { fps: 10 });
    const inf2 = readWebm(muxWebm({ codec: "V_VP8", width: 64, height: 64, fps: 10, frames: frames(long.frames, 10).map((f) => ({ ...f, key: f.time === 0 })), duration: long.seconds * 1000 }));
    expect(inf2.blocks).toHaveLength(400);
    expect(inf2.blocks[399].time).toBeCloseTo(39900, 6);
    expect(checkWebm(inf2, long)).toEqual([]);
  });
  it("video, které neodpovídá plánu (2,926 s pro 0,65 s, chybějící snímky), kontrola odmítne", () => {
    const plan = videoPlan(0.65);
    const bad = readWebm(muxWebm({ codec: "V_VP8", width: 64, height: 64, fps: 30, frames: frames(20, 30), duration: 2926 }));
    expect(checkWebm(bad, plan).join(" ")).toMatch(/duration/);
    const short = readWebm(muxWebm({ codec: "V_VP8", width: 64, height: 64, fps: 30, frames: frames(12, 30), duration: 400 }));
    expect(checkWebm(short, plan).join(" ")).toMatch(/blocks=12/);
  });
  it("WebP → VP8: blok „VP8 “ ze ztrátového WebP, bezeztrátový → null", () => {
    const riff = (tag: string, payload: number[]) => {
      const b = new Uint8Array(20 + payload.length + (payload.length & 1));
      const dv = new DataView(b.buffer);
      b.set([..."RIFF"].map((c) => c.charCodeAt(0)), 0);
      dv.setUint32(4, b.length - 8, true);
      b.set([..."WEBP"].map((c) => c.charCodeAt(0)), 8);
      b.set([...tag].map((c) => c.charCodeAt(0)), 12);
      dv.setUint32(16, payload.length, true);
      b.set(payload, 20);
      return b;
    };
    expect([...(webpVp8(riff("VP8 ", [1, 2, 3, 4, 5])) ?? [])]).toEqual([1, 2, 3, 4, 5]);
    expect(webpVp8(riff("VP8L", [1, 2, 3]))).toBeNull();
    expect(webpVp8(new Uint8Array([0x89, 0x50, 0x4e, 0x47]))).toBeNull();
  });
  it("první snímek musí být klíčový; bez snímků chyba", () => {
    expect(() => muxWebm({ codec: "V_VP8", width: 2, height: 2, fps: 30, frames: [] })).toThrow();
    expect(() => muxWebm({ codec: "V_VP8", width: 2, height: 2, fps: 30, frames: [{ data: new Uint8Array(4), time: 0, key: false }] })).toThrow();
  });
});
