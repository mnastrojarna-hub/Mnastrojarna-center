/**
 * Bitový proud formátu PRC (ISO 14739-1) — čtení komprimovaných sekcí.
 *
 * Komprimované sekce se zapisují po bitech (bez zarovnání na bajty), bity se čtou od nejvyššího
 * bitu bajtu. Speciální typy: UnsignedInteger/Integer (bajty s příznakovým bitem), Double
 * (prefixový kód exponentu + zkrácená mantisa), String, a pro „highly compressed" tessellaci
 * pole s proměnným počtem bitů a Huffmanovým kódováním.
 */

import { PRC_EXPONENT_RUNS, PRC_FREQUENT_DOUBLES } from "./prc-double-table";

/** Interní chyba čtení PRC (převádí se na ModelImportError / varování). */
export class PrcFormatError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "PrcFormatError";
  }
}

// ---------------------------------------------------------------------------
// Prefixový strom kódů doublů (sestaví se jednou při prvním použití)
// ---------------------------------------------------------------------------

interface DoubleCodeTree {
  child0: Int32Array;
  child1: Int32Array;
  /** -1 = vnitřní uzel; jinak index do hi/lo/isValue. */
  leaf: Int32Array;
  hi: Uint32Array;
  lo: Uint32Array;
  /** 1 = přímo uložená častá hodnota, 0 = exponent (následuje mantisa). */
  isValue: Uint8Array;
  /** Index listu kódující nulu (2bitový kód 01) — nula nemá znaménkový bit. */
  zeroLeaf: number;
}

let doubleTree: DoubleCodeTree | null = null;

function buildDoubleTree(): DoubleCodeTree {
  const entries: { len: number; code: number; hi: number; lo: number; value: boolean }[] = [];
  for (let i = 0; i < PRC_EXPONENT_RUNS.length; i += 4) {
    const e0 = PRC_EXPONENT_RUNS[i];
    const len = PRC_EXPONENT_RUNS[i + 1];
    const c0 = PRC_EXPONENT_RUNS[i + 2];
    const n = PRC_EXPONENT_RUNS[i + 3];
    for (let k = 0; k < n; k++) {
      const e = e0 + k;
      // exponent 0x7FF je ve specifikaci uložen jako tichý NaN
      const hi = e === 0x7ff ? 0x7ff80000 : (e << 20) >>> 0;
      entries.push({ len, code: c0 + k, hi, lo: 0, value: false });
    }
  }
  for (let i = 0; i < PRC_FREQUENT_DOUBLES.length; i += 4) {
    entries.push({
      len: PRC_FREQUENT_DOUBLES[i],
      code: PRC_FREQUENT_DOUBLES[i + 1],
      hi: PRC_FREQUENT_DOUBLES[i + 2] >>> 0,
      lo: PRC_FREQUENT_DOUBLES[i + 3] >>> 0,
      value: true,
    });
  }
  const maxNodes = 1 + entries.reduce((s, e) => s + e.len, 0);
  const child0 = new Int32Array(maxNodes).fill(-1);
  const child1 = new Int32Array(maxNodes).fill(-1);
  const leaf = new Int32Array(maxNodes).fill(-1);
  const hi = new Uint32Array(entries.length);
  const lo = new Uint32Array(entries.length);
  const isValue = new Uint8Array(entries.length);
  let nodes = 1;
  let zeroLeaf = -1;
  entries.forEach((en, idx) => {
    let node = 0;
    for (let b = en.len - 1; b >= 0; b--) {
      const bit = (en.code >>> b) & 1;
      const arr = bit ? child1 : child0;
      if (arr[node] < 0) arr[node] = nodes++;
      node = arr[node];
    }
    leaf[node] = idx;
    hi[idx] = en.hi;
    lo[idx] = en.lo;
    isValue[idx] = en.value ? 1 : 0;
    if (en.value && en.len === 2 && en.code === 1) zeroLeaf = idx;
  });
  return { child0, child1, leaf, hi, lo, isValue, zeroLeaf };
}

function getDoubleTree(): DoubleCodeTree {
  if (!doubleTree) doubleTree = buildDoubleTree();
  return doubleTree;
}

// sdílené buffery pro sestavení doublu / floatu
const f64 = new Float64Array(1);
const f64bytes = new Uint8Array(f64.buffer);
const f32 = new Float32Array(1);
const f32bytes = new Uint8Array(f32.buffer);
// Float64Array používá nativní pořadí bajtů — zjistíme ho (prakticky vždy little endian)
const LITTLE_ENDIAN = new Uint8Array(new Uint16Array([1]).buffer)[0] === 1;
/** Index bajtu v f64bytes pro „logický" bajt k (0 = nejnižší bajt mantisy, 7 = znaménko). */
function bi(k: number): number {
  return LITTLE_ENDIAN ? k : 7 - k;
}

const utf8 = typeof TextDecoder !== "undefined" ? new TextDecoder("utf-8") : null;

// ---------------------------------------------------------------------------
// Čtečka bitů
// ---------------------------------------------------------------------------

export class BitReader {
  readonly data: Uint8Array;
  /** Aktuální pozice v bitech. */
  pos = 0;
  /** Celková délka v bitech. */
  readonly end: number;

  constructor(data: Uint8Array) {
    this.data = data;
    this.end = data.length * 8;
  }

  get remaining(): number {
    return this.end - this.pos;
  }

  private eof(): never {
    throw new PrcFormatError("neočekávaný konec dat sekce");
  }

  readBit(): number {
    const p = this.pos;
    if (p >= this.end) this.eof();
    this.pos = p + 1;
    return (this.data[p >>> 3] >>> (7 - (p & 7))) & 1;
  }

  readBool(): boolean {
    return this.readBit() === 1;
  }

  /** Bajt (8 bitů, od nejvyššího). */
  readChar(): number {
    const p = this.pos;
    if (p + 8 > this.end) this.eof();
    this.pos = p + 8;
    const i = p >>> 3;
    const off = p & 7;
    if (off === 0) return this.data[i];
    return (((this.data[i] << 8) | this.data[i + 1]) >>> (8 - off)) & 0xff;
  }

  /** UnsignedInteger: dokud přijde bit 1, následuje další bajt (little endian). */
  readUInt(): number {
    let value = 0;
    let mul = 1;
    let count = 0;
    while (this.readBit()) {
      if (count >= 4) throw new PrcFormatError("neplatné celé číslo (příliš dlouhé)");
      value += this.readChar() * mul;
      mul *= 256;
      count++;
    }
    return value;
  }

  /** Integer se znaménkem (rozšíření znaménka z posledního přečteného bajtu). */
  readInt(): number {
    let value = 0;
    let count = 0;
    while (this.readBit()) {
      if (count >= 4) throw new PrcFormatError("neplatné celé číslo (příliš dlouhé)");
      value |= this.readChar() << (8 * count);
      count++;
    }
    if (count === 0) return 0;
    if (count < 4) {
      const shift = 32 - 8 * count;
      return (value << shift) >> shift;
    }
    return value | 0;
  }

  /** Double v komprimované podobě PRC. */
  readDouble(): number {
    const t = getDoubleTree();
    const { child0, child1, leaf } = t;
    let node = 0;
    let idx = -1;
    for (let i = 0; i < 22; i++) {
      node = this.readBit() ? child1[node] : child0[node];
      if (node < 0) throw new PrcFormatError("neplatný kód čísla (double)");
      idx = leaf[node];
      if (idx >= 0) break;
    }
    if (idx < 0) throw new PrcFormatError("neplatný kód čísla (double)");
    if (idx === t.zeroLeaf) return 0;
    const b = f64bytes;
    const hi = t.hi[idx];
    const lo = t.lo[idx];
    b[bi(0)] = lo & 0xff;
    b[bi(1)] = (lo >>> 8) & 0xff;
    b[bi(2)] = (lo >>> 16) & 0xff;
    b[bi(3)] = (lo >>> 24) & 0xff;
    b[bi(4)] = hi & 0xff;
    b[bi(5)] = (hi >>> 8) & 0xff;
    b[bi(6)] = (hi >>> 16) & 0xff;
    b[bi(7)] = (hi >>> 24) & 0xff;
    // znaménko
    if (this.readBit()) b[bi(7)] |= 0x80;
    else b[bi(7)] &= 0x7f;
    if (t.isValue[idx]) return f64[0];
    if (!this.readBit()) return f64[0]; // bez mantisy
    // horní 4 bity mantisy
    let b4 = 0;
    for (let i = 0; i < 4; i++) b4 = (b4 << 1) | this.readBit();
    b[bi(6)] |= b4;
    // zbylých 6 bajtů mantisy, od nejvyššího (5) k nejnižšímu (0)
    for (let cur = 5; cur >= 0; cur--) {
      if (this.readBit()) {
        b[bi(cur)] = this.readChar();
        continue;
      }
      const offset = (this.readBit() << 2) | (this.readBit() << 1) | this.readBit();
      if (offset === 0) {
        const prev = b[bi(cur + 1)];
        for (let k = cur; k >= 0; k--) b[bi(k)] = prev;
        break;
      }
      if (offset === 6) {
        const prev = b[bi(cur + 1)];
        for (let k = cur; k >= 1; k--) b[bi(k)] = prev;
        b[bi(0)] = this.readChar();
        break;
      }
      if (cur + offset > 7) throw new PrcFormatError("neplatná mantisa čísla (double)");
      b[bi(cur)] = b[bi(cur + offset)];
    }
    return f64[0];
  }

  /** String: příznak „není NULL", délka, UTF-8 bajty. */
  readString(): string {
    if (!this.readBit()) return "";
    const len = this.readUInt();
    if (len * 8 > this.remaining) this.eof();
    const bytes = new Uint8Array(len);
    for (let i = 0; i < len; i++) bytes[i] = this.readChar();
    if (utf8) return utf8.decode(bytes);
    let s = "";
    for (let i = 0; i < len; i++) s += String.fromCharCode(bytes[i]);
    return s;
  }

  /** Float uložený jako 4 bajty (little endian). */
  readFloatAsBytes(): number {
    const v0 = this.readChar();
    const v1 = this.readChar();
    const v2 = this.readChar();
    const v3 = this.readChar();
    if (LITTLE_ENDIAN) {
      f32bytes[0] = v0;
      f32bytes[1] = v1;
      f32bytes[2] = v2;
      f32bytes[3] = v3;
    } else {
      f32bytes[3] = v0;
      f32bytes[2] = v1;
      f32bytes[1] = v2;
      f32bytes[0] = v3;
    }
    return f32[0];
  }

  /** 32bitové číslo zapsané jako 4 znaky (little endian). */
  readUncompressedUInt32(): number {
    const v0 = this.readChar();
    const v1 = this.readChar();
    const v2 = this.readChar();
    const v3 = this.readChar();
    return (v0 | (v1 << 8) | (v2 << 16) | (v3 << 24)) >>> 0;
  }

  /** UnsignedIntegerWithVariableBitNumber — n bitů, od nejvyššího. */
  readUIntVar(n: number): number {
    if (n > 32) throw new PrcFormatError("neplatná šířka bitového pole");
    let v = 0;
    for (let i = 0; i < n; i++) v = v * 2 + this.readBit();
    return v;
  }

  /** IntegerWithVariableBitNumber — znaménkový bit + (n−1) bitů absolutní hodnoty. */
  readIntVar(n: number): number {
    if (n <= 0) return 0;
    const neg = this.readBit();
    const v = this.readUIntVar(n - 1);
    return neg ? -v : v;
  }

  /** UserData: počet bitů a bity samotné (přeskočí se). */
  skipUserData(): void {
    const bits = this.readUInt();
    if (bits > this.remaining) this.eof();
    this.pos += bits;
  }

  /** Přeskočí n bitů. */
  skip(n: number): void {
    if (n > this.remaining) this.eof();
    this.pos += n;
  }

  // -------------------------------------------------------------------------
  // Pole pro „highly compressed" data (TESS_3D_Compressed)
  // -------------------------------------------------------------------------

  /**
   * CharacterArray: volitelně Huffmanem komprimované pole malých čísel.
   * `hasCompBit = false` jen u point_reference_array, kde o kompresi rozhoduje `numKnown > 3`.
   */
  readCharacterArray(numBits: number, hasCompBit = true, numKnown = 0): Uint32Array {
    let compressed = hasCompBit ? this.readBool() : false;
    const size = this.readUInt();
    if (size === 0) return new Uint32Array(0);
    if (!hasCompBit) compressed = numKnown > 3;
    if (compressed) return this.readHuffman(numBits, size);
    if (size * 8 > this.remaining) this.eof();
    const out = new Uint32Array(size);
    for (let i = 0; i < size; i++) out[i] = this.readChar();
    return out;
  }

  /** ShortArray: volitelně Huffmanem komprimované pole 16bitových hodnot. */
  readShortArray(numBits: number): Uint32Array {
    const compressed = this.readBool();
    const size = this.readUInt();
    if (size === 0) return new Uint32Array(0);
    if (compressed) return this.readHuffman(numBits, size);
    if (size * 16 > this.remaining) this.eof();
    const out = new Uint32Array(size);
    for (let i = 0; i < size; i++) {
      const lo = this.readChar();
      const hi = this.readChar();
      out[i] = lo | (hi << 8);
    }
    return out;
  }

  /** CompressedIntegerArray: šířky (6b znaky) + hodnoty se znaménkem proměnné délky. */
  readCompressedIntegerArray(): Int32Array {
    const widths = this.readCharacterArray(6, true);
    const out = new Int32Array(widths.length);
    for (let i = 0; i < widths.length; i++) out[i] = this.readIntVar(widths[i]);
    return out;
  }

  /**
   * CompressedIndiceArray: rozdílově kódované indexy; šířky jsou 6bitové rozdíly
   * (se znaménkem) kumulované od první hodnoty.
   */
  readCompressedIndiceArray(hasCompBit = true, numKnown = 0): Int32Array {
    const widths = this.readCharacterArray(6, hasCompBit, numKnown);
    const n = widths.length;
    const out = new Int32Array(n);
    if (n === 0) return out;
    const signed6 = (v: number) => {
      const w = v & 0xff;
      // 6bitová hodnota se znaménkem (bit 5); hodnoty v bajtu nad 63 bereme jako 8bitové se znaménkem
      if (w >= 128) return w - 256;
      if (w >= 32) return w - 64;
      return w;
    };
    let width = signed6(widths[0]);
    out[0] = this.readIntVar(width);
    for (let i = 1; i < n; i++) {
      width += signed6(widths[i]);
      if (width < 0 || width > 33) throw new PrcFormatError("neplatná šířka v poli indexů");
      out[i] = out[i - 1] + this.readIntVar(width);
    }
    return out;
  }

  /**
   * Huffmanem kódované pole: `words` 32bitových slov (zapsaných po bajtech, LE), počet platných
   * bitů posledního slova, a v nich (bity od nejnižšího): počet listů, max. délka kódu, listy
   * (hodnota, délka, kód) a nakonec počet hodnot + zakódovaná data.
   */
  readHuffman(numBits: number, words: number): Uint32Array {
    if (words * 32 > this.remaining) this.eof();
    const w = new Uint32Array(words);
    for (let i = 0; i < words; i++) w[i] = this.readUncompressedUInt32();
    const lastBits = this.readUInt();
    if (lastBits > 32) throw new PrcFormatError("neplatná Huffmanova data");
    const maxBits = (words - 1) * 32 + lastBits;
    let hp = 0;
    const hbit = (): number => {
      if (hp >= maxBits) throw new PrcFormatError("neplatná Huffmanova data (konec)");
      const v = (w[hp >>> 5] >>> (hp & 31)) & 1;
      hp++;
      return v;
    };
    const hval = (n: number): number => {
      let v = 0;
      let m = 1;
      for (let k = 0; k < n; k++) {
        if (hbit()) v += m;
        m *= 2;
      }
      return v;
    };
    const numLeaves = hval(numBits + 1);
    const maxCodeLen = hval(8);
    if (numLeaves === 0 || maxCodeLen === 0 || maxCodeLen > 32) {
      throw new PrcFormatError("neplatná Huffmanova tabulka");
    }
    if (numLeaves * (numBits + maxCodeLen) > maxBits) throw new PrcFormatError("neplatná Huffmanova tabulka");
    // strom: uzly v polích, list = hodnota >= 0
    const cap = 1 + numLeaves * maxCodeLen;
    const left = new Int32Array(cap).fill(-1);
    const right = new Int32Array(cap).fill(-1);
    const value = new Float64Array(cap).fill(-1);
    let nodes = 1;
    for (let l = 0; l < numLeaves; l++) {
      const v = hval(numBits);
      const len = hval(maxCodeLen);
      const code = hval(len);
      if (len > 32) throw new PrcFormatError("neplatná Huffmanova tabulka");
      let node = 0;
      for (let j = len - 1; j >= 0; j--) {
        const bit = Math.floor(code / 2 ** j) % 2;
        const arr = bit ? right : left;
        if (arr[node] < 0) {
          if (nodes >= cap) throw new PrcFormatError("neplatná Huffmanova tabulka");
          arr[node] = nodes++;
        }
        node = arr[node];
      }
      value[node] = v;
    }
    const count = hval(32);
    if (count > maxBits - hp) throw new PrcFormatError("neplatná Huffmanova data");
    const out = new Uint32Array(count);
    let node = 0;
    let i = 0;
    while (i < count) {
      node = hbit() ? right[node] : left[node];
      if (node < 0) throw new PrcFormatError("neplatný Huffmanův kód");
      if (value[node] >= 0) {
        out[i++] = value[node];
        node = 0;
      }
    }
    return out;
  }
}
