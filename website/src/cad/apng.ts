/**
 * Vlna 22, kolo 7 (bod 13 – „bez WebCodecs jen ZIP s PNG“): animované PNG (APNG) s pevným časováním ze snímků PNG.
 *
 * Prohlížeč bez WebCodecs i bez kódování WebP (Safari) neumí vyrobit WebM; místo ZIPu se snímky (které se musely převést
 * ffmpegem) dostane přehratelné video: APNG přehraje každý prohlížeč (i Safari) a nese přesné časování snímků (fcTL
 * delay_num / delay_den = 1 / fps – délka videa = počet snímků / fps, nezávisle na rychlosti vykreslování). Sestavuje se
 * jen přeskládáním bloků hotových PNG (IHDR prvního snímku, IDAT → fdAT s pořadovými čísly), bez nového kódování obrazu.
 * Čtečka `readApng` hotový soubor ověří stejně jako `readWebm` u WebM (počet snímků, časy, délka).
 */
import { crc32 } from "./formats/zip";

const SIG = [137, 80, 78, 71, 13, 10, 26, 10];
type Chunk = { type: string; data: Uint8Array };

function chunks(png: Uint8Array): Chunk[] {
  for (let i = 0; i < 8; i++) if (png[i] !== SIG[i]) throw new Error("PNG: chybí podpis souboru");
  const dv = new DataView(png.buffer, png.byteOffset, png.byteLength);
  const out: Chunk[] = [];
  let o = 8;
  while (o + 12 <= png.length) {
    const len = dv.getUint32(o);
    const type = String.fromCharCode(png[o + 4], png[o + 5], png[o + 6], png[o + 7]);
    if (o + 12 + len > png.length) throw new Error("PNG: useknutý blok " + type);
    out.push({ type, data: png.subarray(o + 8, o + 8 + len) });
    o += 12 + len;
    if (type === "IEND") break;
  }
  return out;
}

function chunkBytes(type: string, data: Uint8Array): Uint8Array {
  const b = new Uint8Array(12 + data.length);
  const dv = new DataView(b.buffer);
  dv.setUint32(0, data.length);
  for (let i = 0; i < 4; i++) b[4 + i] = type.charCodeAt(i);
  b.set(data, 8);
  dv.setUint32(8 + data.length, crc32(b.subarray(4, 8 + data.length)));
  return b;
}

const u32 = (v: number) => [(v >>> 24) & 255, (v >>> 16) & 255, (v >>> 8) & 255, v & 255];
const u16 = (v: number) => [(v >>> 8) & 255, v & 255];

/**
 * Snímky PNG (stejný rozměr, z plátna) → APNG: každý snímek trvá 1 / fps s (zlomek delay_num / delay_den, celá čísla –
 * přesně, bez zaokrouhlení na milisekundy), `plays` = počet přehrání (0 = stále dokola).
 */
export function assembleApng(frames: Uint8Array[], fps: number, plays = 0): Uint8Array {
  if (!frames.length) throw new Error("APNG: žádný snímek");
  if (!(fps > 0) || !Number.isFinite(fps)) throw new Error("APNG: neplatná snímková frekvence");
  // zlomek 1 / fps v celých číslech (fps je celé, jinak na tisíciny)
  let num = 1, den = Math.round(fps);
  if (Math.abs(fps - den) > 1e-9) {
    num = 1000;
    den = Math.round(fps * 1000);
  }
  if (den > 65535 || num > 65535) throw new Error("APNG: snímková frekvence mimo rozsah");
  const parsed = frames.map(chunks);
  const ihdr = parsed[0].find((c) => c.type === "IHDR");
  if (!ihdr) throw new Error("APNG: první snímek nemá IHDR");
  const W = new DataView(ihdr.data.buffer, ihdr.data.byteOffset).getUint32(0);
  const H = new DataView(ihdr.data.buffer, ihdr.data.byteOffset).getUint32(4);
  const parts: Uint8Array[] = [new Uint8Array(SIG), chunkBytes("IHDR", ihdr.data)];
  // bloky mezi IHDR a IDAT prvního snímku (barevný profil, gama…) zůstanou
  for (const c of parsed[0]) if (c.type !== "IHDR" && c.type !== "IDAT" && c.type !== "IEND" && c.type !== "acTL" && c.type !== "fcTL") parts.push(chunkBytes(c.type, c.data));
  parts.push(chunkBytes("acTL", new Uint8Array([...u32(frames.length), ...u32(plays)])));
  let seq = 0;
  parsed.forEach((cs, i) => {
    const h = cs.find((c) => c.type === "IHDR");
    if (!h) throw new Error(`APNG: snímek ${i} nemá IHDR`);
    const dv = new DataView(h.data.buffer, h.data.byteOffset);
    if (dv.getUint32(0) !== W || dv.getUint32(4) !== H) throw new Error(`APNG: snímek ${i} má jiný rozměr`);
    // fcTL: pořadí, rozměr, posun 0, zpoždění num/den, dispose NONE, blend SOURCE (snímek celý nahradí předchozí)
    parts.push(chunkBytes("fcTL", new Uint8Array([...u32(seq++), ...u32(W), ...u32(H), ...u32(0), ...u32(0), ...u16(num), ...u16(den), 0, 0])));
    for (const c of cs) {
      if (c.type !== "IDAT") continue;
      if (i === 0) parts.push(chunkBytes("IDAT", c.data));
      else {
        const d = new Uint8Array(4 + c.data.length);
        d.set(u32(seq++), 0);
        d.set(c.data, 4);
        parts.push(chunkBytes("fdAT", d));
      }
    }
  });
  parts.push(chunkBytes("IEND", new Uint8Array(0)));
  const total = parts.reduce((s, p) => s + p.length, 0);
  const out = new Uint8Array(total);
  let o = 0;
  for (const p of parts) {
    out.set(p, o);
    o += p.length;
  }
  return out;
}

export type ApngInfo = { width: number; height: number; frames: number; plays: number; delays: number[]; seconds: number; crcOk: boolean };

/** čtečka APNG pro kontrolu hotového souboru (a testy): rozměr, počet snímků z acTL i z fcTL, zpoždění [s], celková délka */
export function readApng(b: Uint8Array): ApngInfo {
  const cs = chunks(b);
  const dv = (c: Chunk) => new DataView(c.data.buffer, c.data.byteOffset, c.data.byteLength);
  const ihdr = cs.find((c) => c.type === "IHDR");
  const actl = cs.find((c) => c.type === "acTL");
  if (!ihdr || !actl) throw new Error("APNG: chybí IHDR nebo acTL");
  const delays = cs.filter((c) => c.type === "fcTL").map((c) => {
    const num = dv(c).getUint16(20), den = dv(c).getUint16(22) || 100;
    return num / den;
  });
  // kontrolní součty všech bloků (poškozený soubor = chyba, ne tichý úspěch)
  let crcOk = true;
  const whole = new DataView(b.buffer, b.byteOffset, b.byteLength);
  let o = 8;
  while (o + 12 <= b.length) {
    const len = whole.getUint32(o);
    if (crc32(b.subarray(o + 4, o + 8 + len)) !== whole.getUint32(o + 8 + len)) crcOk = false;
    const type = String.fromCharCode(b[o + 4], b[o + 5], b[o + 6], b[o + 7]);
    o += 12 + len;
    if (type === "IEND") break;
  }
  return { width: dv(ihdr).getUint32(0), height: dv(ihdr).getUint32(4), frames: dv(actl).getUint32(0), plays: dv(actl).getUint32(4), delays, seconds: delays.reduce((s, d) => s + d, 0), crcOk };
}
