/**
 * BALÍK 3 (layout) – minimální čtečka písma TrueType pro vložení do PDF: mapování znak → glyf (cmap 4 / 12), šířky
 * glyfů (hmtx), metriky (head, hhea, OS/2). Písmo se do PDF vkládá celé (Type0 / CIDFontType2, Identity-H).
 */
export type TtfFont = {
  bytes: Uint8Array;
  unitsPerEm: number;
  ascent: number;
  descent: number;
  capHeight: number;
  bbox: [number, number, number, number];
  numGlyphs: number;
  /** šířky glyfů v jednotkách písma */
  advance: (gid: number) => number;
  /** glyf znaku (0 = .notdef) */
  glyph: (cp: number) => number;
  name: string;
};

export function parseTtf(bytes: Uint8Array): TtfFont {
  const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const u16 = (o: number) => dv.getUint16(o);
  const i16 = (o: number) => dv.getInt16(o);
  const u32 = (o: number) => dv.getUint32(o);
  const n = u16(4);
  const tables = new Map<string, { off: number; len: number }>();
  for (let i = 0; i < n; i++) {
    const r = 12 + i * 16;
    const tag = String.fromCharCode(bytes[r], bytes[r + 1], bytes[r + 2], bytes[r + 3]);
    tables.set(tag, { off: u32(r + 8), len: u32(r + 12) });
  }
  const t = (tag: string) => {
    const x = tables.get(tag);
    if (!x) throw new Error(`TTF: chybí tabulka ${tag}`);
    return x.off;
  };
  const head = t("head");
  const unitsPerEm = u16(head + 18);
  const bbox: [number, number, number, number] = [i16(head + 36), i16(head + 38), i16(head + 40), i16(head + 42)];
  const hhea = t("hhea");
  const ascent = i16(hhea + 4);
  const descent = i16(hhea + 6);
  const nHm = u16(hhea + 34);
  const numGlyphs = u16(t("maxp") + 4);
  const hmtx = t("hmtx");
  let capHeight = Math.round(ascent * 0.7);
  const os2 = tables.get("OS/2");
  if (os2 && os2.len >= 90 && u16(os2.off) >= 2) capHeight = i16(os2.off + 88);
  const advance = (gid: number) => u16(hmtx + 4 * Math.min(gid, nHm - 1));
  // cmap: Windows Unicode BMP (3,1) formát 4, nebo (3,10) formát 12
  const cmap = t("cmap");
  const nsub = u16(cmap + 2);
  let f4 = -1;
  let f12 = -1;
  for (let i = 0; i < nsub; i++) {
    const pid = u16(cmap + 4 + i * 8);
    const eid = u16(cmap + 6 + i * 8);
    const off = cmap + u32(cmap + 8 + i * 8);
    const fmt = u16(off);
    if (fmt === 4 && (pid === 3 || pid === 0) && f4 < 0) f4 = off;
    if (fmt === 12 && ((pid === 3 && eid === 10) || pid === 0)) f12 = off;
  }
  const cache = new Map<number, number>();
  const glyph4 = (cp: number): number => {
    if (f4 < 0 || cp > 0xffff) return 0;
    const segX2 = u16(f4 + 6);
    const ends = f4 + 14;
    const starts = ends + segX2 + 2;
    const deltas = starts + segX2;
    const ranges = deltas + segX2;
    for (let i = 0; i < segX2 / 2; i++) {
      const end = u16(ends + i * 2);
      if (cp > end) continue;
      const start = u16(starts + i * 2);
      if (cp < start) return 0;
      const delta = i16(deltas + i * 2);
      const ro = u16(ranges + i * 2);
      if (!ro) return (cp + delta) & 0xffff;
      const g = u16(ranges + i * 2 + ro + (cp - start) * 2);
      return g ? (g + delta) & 0xffff : 0;
    }
    return 0;
  };
  const glyph12 = (cp: number): number => {
    if (f12 < 0) return 0;
    const ng = u32(f12 + 12);
    for (let i = 0; i < ng; i++) {
      const g = f12 + 16 + i * 12;
      const s = u32(g);
      const e = u32(g + 4);
      if (cp >= s && cp <= e) return u32(g + 8) + (cp - s);
    }
    return 0;
  };
  const glyph = (cp: number) => {
    let g = cache.get(cp);
    if (g === undefined) {
      g = glyph4(cp) || glyph12(cp);
      cache.set(cp, g);
    }
    return g;
  };
  let name = "Font";
  const nm = tables.get("name");
  if (nm) {
    const cnt = u16(nm.off + 2);
    const so = nm.off + u16(nm.off + 4);
    for (let i = 0; i < cnt; i++) {
      const r = nm.off + 6 + i * 12;
      if (u16(r + 6) !== 6) continue;
      const len = u16(r + 8);
      const off = so + u16(r + 10);
      const pid = u16(r);
      let s = "";
      if (pid === 3 || pid === 0) for (let k = 0; k < len; k += 2) s += String.fromCharCode(u16(off + k));
      else for (let k = 0; k < len; k++) s += String.fromCharCode(bytes[off + k]);
      if (s) {
        name = s.replace(/[^\x21-\x7e]/g, "").replace(/[()<>[\]{}/%]/g, "");
        break;
      }
    }
  }
  return { bytes, unitsPerEm, ascent, descent, capHeight, bbox, numGlyphs, advance, glyph, name };
}
