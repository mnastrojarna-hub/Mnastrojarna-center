/**
 * Dekodér U3D (ECMA-363 „Universal 3D") — 3D obsah, který CAD systémy vkládají do „3D PDF".
 *
 * Čistý TypeScript bez závislostí (běží ve Web Workeru i v Node). Podporuje:
 *  - hlavičku souboru (profil, bez komprese, měřítko jednotek → mm), řetězce modifikátorů,
 *  - uzly group / model / light / view (strom sestavy, transformace rodič → potomek, více rodičů),
 *  - CLOD síť: deklaraci, základní síť (0xFFFFFF3B) i progresivní rozdělování vrcholů (0xFFFFFF3C)
 *    až do plného rozlišení včetně predikce a rekonstrukce normál,
 *  - množiny úseček (line set), shading modifikátor → shader → materiál (barva, průhlednost).
 *
 * Aritmetické kódování (ECMA-363 §10) a postup dekódování odpovídají referenční implementaci
 * (U3D Sample Software, CIFXBitStreamX / IFXHistogramDynamic / CIFXAuthorCLODDecoder) bit po bitu —
 * včetně řazení množin „větší index první", na kterém závisí lokální indexy v progresivních blocích.
 */
import { ModelImportError, type MeshPart, type ModelNode, type ParsedModel, type Rgb } from "../types";

// ───────────────────────────── konstanty ─────────────────────────────

const BLOCK_FILE_HEADER = 0x00443355;
const BLOCK_FILE_REFERENCE = 0xffffff12;
const BLOCK_MODIFIER_CHAIN = 0xffffff14;
const BLOCK_GROUP_NODE = 0xffffff21;
const BLOCK_MODEL_NODE = 0xffffff22;
const BLOCK_LIGHT_NODE = 0xffffff23;
const BLOCK_VIEW_NODE = 0xffffff24;
const BLOCK_CLOD_DECLARATION = 0xffffff31;
const BLOCK_CLOD_BASE = 0xffffff3b;
const BLOCK_CLOD_PROGRESSIVE = 0xffffff3c;
const BLOCK_POINT_SET = 0xffffff36;
const BLOCK_POINT_SET_CONT = 0xffffff3e;
const BLOCK_LINE_SET = 0xffffff37;
const BLOCK_LINE_SET_CONT = 0xffffff3f;
const BLOCK_SHADING_MODIFIER = 0xffffff45;
const BLOCK_LIT_TEXTURE_SHADER = 0xffffff53;
const BLOCK_MATERIAL = 0xffffff54;

const POINT_SET_WARNING = "Bodové množiny (point set) se v prohlížeči nezobrazují.";

/** Bloky, které dekodér čte (ostatní přeskakuje bez kopírování dat). */
const HANDLED_BLOCKS = new Set([
  BLOCK_FILE_REFERENCE,
  BLOCK_MODIFIER_CHAIN,
  BLOCK_GROUP_NODE,
  BLOCK_MODEL_NODE,
  BLOCK_LIGHT_NODE,
  BLOCK_VIEW_NODE,
  BLOCK_CLOD_DECLARATION,
  BLOCK_CLOD_BASE,
  BLOCK_CLOD_PROGRESSIVE,
  BLOCK_POINT_SET,
  BLOCK_POINT_SET_CONT,
  BLOCK_LINE_SET,
  BLOCK_LINE_SET_CONT,
  BLOCK_SHADING_MODIFIER,
  BLOCK_LIT_TEXTURE_SHADER,
  BLOCK_MATERIAL,
]);

const PROFILE_NO_COMPRESSION = 0x00000004;
const PROFILE_UNITS_SCALE = 0x00000008;

/** Hranice statických kontextů (uACStaticFull) a rozsahu komprese (uACMaxRange). */
const AC_STATIC_FULL = 0x400;
const AC_MAX_RANGE = AC_STATIC_FULL + 0x3fff;

// kontexty CLOD (IFXACContext.h)
const CTX_BASE_SHADING_ID = 1;
const CTX_NUM_NEW_FACES = 1;
const CTX_ORIENTATION_TYPE = 2;
const CTX_THIRD_INDEX_TYPE = 3;
const CTX_LOCAL_3RD_POSITION = 4;
const CTX_STAY_MOVE = 15;
const CTX_POSITION_DIFF_SIGNS = 20;
const CTX_POSITION_DIFF_MAG_X = 21;
const CTX_POSITION_DIFF_MAG_Y = 22;
const CTX_POSITION_DIFF_MAG_Z = 23;
const CTX_TEXCOORD_SPLIT_TYPE = 29;
const CTX_TEXCOORD_DIFF_SIGNS = 32;
const CTX_TEXCOORD_DIFF_MAG_U = 33;
const CTX_TEXCOORD_DUP_TYPE = 39;
const CTX_NUM_LOCAL_NORMALS = 40;
const CTX_NORMAL_DIFF_SIGNS = 41;
const CTX_NORMAL_DIFF_MAG_X = 42;
const CTX_NORMAL_DIFF_MAG_Y = 43;
const CTX_NORMAL_DIFF_MAG_Z = 44;
const CTX_NORMAL_LOCAL_INDEX = 45;
const CTX_VERT_COLOR_SPLIT_TYPE = 55;
const CTX_VERT_COLOR_DUP_TYPE = 56;
const CTX_VERTEX_COLOR_DIFF_MAG_R = 60;
const CTX_SHADING_ID = 65;
const CTX_NEW_DIFFUSE_COLORS_COUNT = 99;
const CTX_DIFFUSE_COLOR_SIGN = 100;
const CTX_NEW_SPECULAR_COLORS_COUNT = 101;
const CTX_SPECULAR_COLOR_SIGN = 102;
const CTX_TEXCOORD_SIGN = 103;
const CTX_DIFFUSE_KEEP_CHANGE = 104;
const CTX_SPECULAR_KEEP_CHANGE = 109;
const CTX_TEXCOORD_KEEP_CHANGE = 114;
const CTX_VERT_COLOR_SPLIT_INDEX_LOCAL = 119;
const CTX_VERT_COLOR_SPLIT_INDEX_GLOBAL = 120;
const CTX_TEXCOORD_SPLIT_INDEX_LOCAL = 121;
const CTX_TEXCOORD_SPLIT_INDEX_GLOBAL = 122;
const CTX_NEW_TEXCOORDS_COUNT = 123;
const CTX_LINE_SHADING_ID = 1;

/** Ochrana proti nesmyslným počtům z poškozených souborů. */
const MAX_ELEMENTS = 1 << 26;
const MAX_TEX_LAYERS = 8;
const MAX_TOTAL_TRIANGLES = 40000000;
const MAX_INSTANCES = 200000;
const MAX_NODE_DEPTH = 128;
/** IFX_LEN_EPSILON — hranice degenerovaného trojúhelníku při výpočtu normály plochy. */
const LEN_EPSILON = 1e-6;
/** IFXSLERP_DELTA (1e-6f) */
const SLERP_DELTA = Math.fround(1e-6);

const fr = Math.fround;

/** Interní chyba dekódování (převádí se na varování / ModelImportError). */
class U3DError extends Error {}

function fail(msg: string): never {
  throw new U3DError(msg);
}

// ───────────────────────── adaptivní histogram ─────────────────────────

/** Bitová inverze bajtu (CIFXBitStreamX::SwapBits8). */
const REV8 = (() => {
  const t = new Uint8Array(256);
  for (let i = 0; i < 256; i++) {
    let r = 0;
    for (let b = 0; b < 8; b++) if (i & (1 << b)) r |= 1 << (7 - b);
    t[i] = r;
  }
  return t;
})();

const HIST_ELEPHANT = 0x1fff;
const HIST_MAX_SYMBOL = 0xffff;

/**
 * Dynamický histogram — sémanticky totožný s IFXHistogramDynamic referenční implementace
 * (četnosti U16, escape symbol 0 s počáteční četností 1, při součtu ≥ „elephant" 0x1FFF se všechny
 * četnosti před přidáním symbolu vydělí dvěma a escape dostane +1, symboly nad 0xFFFF se nepočítají).
 * Místo kumulativních čtveřic reference používá Fenwickův strom, aby přidání velkého symbolu
 * (kvantované rozdíly souřadnic) nestálo O(symbol).
 */
class Histogram {
  /** Velikost Fenwickova stromu = mocnina dvou > nejvyšší použitý symbol (malé abecedy → krátké smyčky). */
  private size = 4;
  private count = new Uint16Array(4);
  /** Fenwickův strom nad count (1-indexovaný). */
  private tree = new Int32Array(5);
  private sum = 0;
  /** Kumulativní četnost symbolu nalezeného posledním voláním symbolFromFreq. */
  lastCum = 0;

  constructor() {
    this.count[0] = 1;
    this.sum = 1;
    this.rebuild();
  }

  private rebuild(): void {
    const t = this.tree;
    const c = this.count;
    const n = this.size;
    t.fill(0);
    for (let i = 1; i <= n; i++) {
      t[i] += c[i - 1];
      const j = i + (i & -i);
      if (j <= n) t[j] += t[i];
    }
  }

  total(): number {
    return this.sum;
  }

  freq(s: number): number {
    return s < this.size ? this.count[s] : 0;
  }

  /** Součet četností symbolů menších než s. */
  cumFreq(s: number): number {
    if (s >= this.size) return this.sum;
    let r = 0;
    for (let i = s; i > 0; i -= i & -i) r += this.tree[i];
    return r;
  }

  /**
   * Největší symbol s, pro který cumFreq(s) ≤ f (= GetSymbolFromFreq; pro f < total).
   * Zároveň uloží cumFreq(s) do lastCum.
   */
  symbolFromFreq(f: number): number {
    const t = this.tree;
    let pos = 0;
    let rem = f;
    for (let step = this.size; step > 0; step >>>= 1) {
      const nx = pos + step;
      if (t[nx] <= rem) {
        pos = nx;
        rem -= t[nx];
      }
    }
    this.lastCum = f - rem;
    return pos;
  }

  add(symbol: number): void {
    if (symbol > HIST_MAX_SYMBOL) return;
    if (this.sum >= HIST_ELEPHANT) {
      const c = this.count;
      let total = 0;
      for (let i = 0; i < this.size; i++) {
        c[i] >>>= 1;
        total += c[i];
      }
      c[0] += 1;
      this.sum = total + 1;
      this.rebuild();
    }
    if (symbol >= this.size) {
      let n = this.size;
      while (n <= symbol) n *= 2;
      const c = new Uint16Array(n);
      c.set(this.count);
      this.count = c;
      this.size = n;
      this.tree = new Int32Array(n + 1);
      this.rebuild();
    }
    this.count[symbol] += 1;
    this.sum++;
    const t = this.tree;
    const n = this.size;
    for (let i = symbol + 1; i <= n; i += i & -i) t[i]++;
  }
}

// ───────────────────────────── bitový proud ─────────────────────────────

const scratchView = new DataView(new ArrayBuffer(8));

type StringDecoder = (bytes: Uint8Array) => string;

function tryDecoder(label: string): TextDecoder | null {
  try {
    return new TextDecoder(label);
  } catch {
    return null;
  }
}

const utf8Decoder = new TextDecoder("utf-8");
const decodeUtf8: StringDecoder = (b) => utf8Decoder.decode(b);

/**
 * Dekodér řetězců podle „Character Encoding" z hlavičky (MIBenum IANA). Norma předepisuje UTF-8 (106),
 * starší exportéry ale zapisují jména dílů v kódové stránce Windows — neplatné UTF-8 proto zkusíme
 * přečíst jako windows-1250 (čeština), nakonec latin1.
 */
function makeStringDecoder(mib: number): StringDecoder {
  const labels: Record<number, string> = { 3: "utf-8", 4: "iso-8859-1", 5: "iso-8859-2", 2250: "windows-1250", 2252: "windows-1252" };
  const declared = mib !== 106 && labels[mib] ? tryDecoder(labels[mib]) : null;
  if (declared) return (b) => declared.decode(b);
  const fatal = (() => {
    try {
      return new TextDecoder("utf-8", { fatal: true });
    } catch {
      return null;
    }
  })();
  const fallback = tryDecoder("windows-1250") ?? tryDecoder("latin1");
  if (!fatal || !fallback) return decodeUtf8;
  return (b) => {
    try {
      return fatal.decode(b);
    } catch {
      return fallback.decode(b);
    }
  };
}

/**
 * Čtečka bitového proudu jednoho bloku (CIFXBitStreamX, čtecí strana).
 * Bity jdou od nejnižšího bitu bajtu; „nekomprimované" hodnoty jsou 8bitové symboly kontextu 0,
 * které se při netriviálním stavu aritmetického dekodéru kódují staticky (256 symbolů).
 */
class BitReader {
  private readonly d: Uint8Array;
  private readonly bitLen: number;
  private readonly noCompression: boolean;
  private pos = 0;
  private low = 0;
  private high = 0xffff;
  private underflow = 0;
  /** Adaptivní kontexty 1…0x400 (hustá tabulka — řídké pole by V8 převedl na slovník). */
  private readonly hist: (Histogram | null)[] = new Array<Histogram | null>(AC_STATIC_FULL + 1).fill(null);
  private readonly decodeString: StringDecoder;

  constructor(data: Uint8Array, noCompression: boolean, decodeString: StringDecoder = decodeUtf8) {
    const d = new Uint8Array(data.length + 8);
    d.set(data);
    this.d = d;
    this.bitLen = data.length * 8;
    this.noCompression = noCompression;
    this.decodeString = decodeString;
  }

  /** Zbývající celé bajty (jen pro kontrolu rozumnosti počtů v blocích bez komprese). */
  remainingBytes(): number {
    return Math.max(0, (this.bitLen - this.pos) >> 3);
  }

  private byte(i: number): number {
    return i < this.d.length ? this.d[i] : 0;
  }

  /** 16bitové kódové slovo: bit na pozici, pak (po přeskočení podtečení) 15 bitů od MSB. */
  private peekCode(): number {
    const p = this.pos;
    const b0 = (this.byte(p >>> 3) >>> (p & 7)) & 1;
    const q = p + 1 + this.underflow;
    const i = q >>> 3;
    const w =
      i + 2 < this.d.length
        ? this.d[i] | (this.d[i + 1] << 8) | (this.d[i + 2] << 16)
        : this.byte(i) | (this.byte(i + 1) << 8) | (this.byte(i + 2) << 16);
    const x = (w >>> (q & 7)) & 0x7fff;
    return (b0 << 15) | (((REV8[x & 0xff] << 8) | REV8[x >>> 8]) >>> 1);
  }

  /** Normalizace intervalu po dekódování symbolu (posun čtecí pozice, počítání podtečení). */
  private renormalize(low: number, high: number): void {
    let bits = 0;
    while (((low ^ high) & 0x8000) === 0) {
      low = (low << 1) & 0xfffe;
      high = ((high << 1) & 0xfffe) | 1;
      bits++;
    }
    if (bits > 0) {
      bits += this.underflow;
      this.underflow = 0;
    }
    let uf = 0;
    while ((low & 0x4000) !== 0 && (high & 0x4000) === 0) {
      low = (low & 0x3fff) << 1;
      high = ((high & 0x3fff) << 1) | 1;
      uf++;
    }
    if (uf > 0) high |= 0x8000;
    this.underflow += uf;
    this.low = low;
    this.high = high;
    this.pos += bits;
    if (this.pos > this.bitLen) fail("neočekávaný konec dat bloku");
  }

  /** Statický kontext s `n` stejně pravděpodobnými symboly; vrací 1…n. */
  private decodeStatic(n: number): number {
    const code = this.peekCode();
    const low = this.low;
    const range = this.high + 1 - low;
    const num = n * (1 + code - low) - 1;
    if (num < 0) fail("poškozená komprimovaná data");
    const cf = (num / range) | 0;
    if (cf >= n) fail("poškozená komprimovaná data");
    const high = low - 1 + (((range * (cf + 1)) / n) | 0);
    this.renormalize(low + (((range * cf) / n) | 0), high);
    return cf + 1;
  }

  private histogram(ctx: number): Histogram {
    let h = this.hist[ctx];
    if (h === null) {
      h = new Histogram();
      this.hist[ctx] = h;
    }
    return h;
  }

  /** Adaptivní kontext; vrací symbol (0 = escape). */
  private decodeDynamic(ctx: number): number {
    let h = this.hist[ctx];
    if (h === null) {
      h = new Histogram();
      this.hist[ctx] = h;
    }
    const code = this.peekCode();
    const total = h.total();
    const low = this.low;
    const range = this.high + 1 - low;
    // všechny mezivýsledky < 2^31 → celočíselné dělení
    const num = total * (1 + code - low) - 1;
    if (num < 0) fail("poškozená komprimovaná data");
    const cf = (num / range) | 0;
    if (cf >= total) fail("poškozená komprimovaná data");
    const sym = h.symbolFromFreq(cf);
    const vc = h.lastCum;
    const vf = h.freq(sym);
    const high = low - 1 + (((range * (vc + vf)) / total) | 0);
    const nlow = low + (((range * vc) / total) | 0);
    h.add(sym);
    this.renormalize(nlow, high);
    return sym;
  }

  readU8(): number {
    if (this.low === 0 && this.high === 0xffff && this.underflow === 0) {
      const p = this.pos;
      if (p + 8 > this.bitLen) fail("neočekávaný konec dat bloku");
      const i = p >>> 3;
      this.pos = p + 8;
      return ((this.d[i] | (this.d[i + 1] << 8)) >>> (p & 7)) & 0xff;
    }
    return REV8[this.decodeStatic(256) - 1];
  }

  readU16(): number {
    const lo = this.readU8();
    return lo | (this.readU8() << 8);
  }

  readU32(): number {
    const lo = this.readU16();
    return (lo | (this.readU16() << 16)) >>> 0;
  }

  readF32(): number {
    scratchView.setUint32(0, this.readU32(), true);
    return scratchView.getFloat32(0, true);
  }

  readF64(): number {
    const lo = this.readU32();
    const hi = this.readU32();
    scratchView.setUint32(0, lo, true);
    scratchView.setUint32(4, hi, true);
    return scratchView.getFloat64(0, true);
  }

  readString(): string {
    const len = this.readU16();
    if (len === 0) return "";
    if (this.low === 0 && this.high === 0xffff && this.underflow === 0 && (this.pos & 7) === 0) {
      const start = this.pos >>> 3;
      if (start + len > this.bitLen >>> 3) fail("neočekávaný konec dat bloku");
      this.pos += len * 8;
      return this.decodeString(this.d.subarray(start, start + len));
    }
    const bytes = new Uint8Array(len);
    for (let i = 0; i < len; i++) bytes[i] = this.readU8();
    return this.decodeString(bytes);
  }

  /** Přeskočí `n` nekomprimovaných 32bitových hodnot. */
  skipU32(n: number): void {
    if (this.low === 0 && this.high === 0xffff && this.underflow === 0) {
      if (this.pos + n * 32 > this.bitLen) fail("neočekávaný konec dat bloku");
      this.pos += n * 32;
      return;
    }
    for (let i = 0; i < n; i++) this.readU32();
  }

  readCompressedU32(ctx: number): number {
    if (this.noCompression || ctx === 0 || ctx >= AC_MAX_RANGE) return this.readU32();
    if (ctx > AC_STATIC_FULL) return this.decodeStatic(ctx - AC_STATIC_FULL) - 1;
    const sym = this.decodeDynamic(ctx);
    if (sym !== 0) return sym - 1;
    const v = this.readU32();
    this.histogram(ctx).add((v + 1) >>> 0);
    return v;
  }

  readCompressedU16(ctx: number): number {
    if (this.noCompression || ctx === 0 || ctx >= AC_MAX_RANGE) return this.readU16();
    if (ctx > AC_STATIC_FULL) return (this.decodeStatic(ctx - AC_STATIC_FULL) - 1) & 0xffff;
    const sym = this.decodeDynamic(ctx);
    if (sym !== 0) return (sym - 1) & 0xffff;
    const v = this.readU16();
    this.histogram(ctx).add(v + 1);
    return v;
  }

  readCompressedU8(ctx: number): number {
    if (this.noCompression || ctx === 0 || ctx >= AC_MAX_RANGE) return this.readU8();
    if (ctx > AC_STATIC_FULL) return (this.decodeStatic(ctx - AC_STATIC_FULL) - 1) & 0xff;
    const sym = this.decodeDynamic(ctx);
    if (sym !== 0) return (sym - 1) & 0xff;
    const v = this.readU8();
    this.histogram(ctx).add(v + 1);
    return v;
  }
}

// ───────────────────────────── bloky ─────────────────────────────

interface RawBlock {
  type: number;
  data: Uint8Array;
}

/**
 * Rozdělí oblast na bloky (typ, velikost dat, velikost metadat, data + zarovnání na 4 B,
 * metadata + zarovnání). Zarovnání se počítá od `origin` (začátek souboru / dat řetězce).
 */
function splitBlocks(buf: Uint8Array, start: number, end: number, origin: number, warn: (m: string) => void): RawBlock[] {
  const dv = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
  const out: RawBlock[] = [];
  let off = start;
  while (off + 12 <= end) {
    const type = dv.getUint32(off, true);
    const dataSize = dv.getUint32(off + 4, true);
    const metaSize = dv.getUint32(off + 8, true);
    const dataStart = off + 12;
    if (dataStart + dataSize > end) {
      warn("Soubor U3D je zkrácený — konec modelu chybí.");
      break;
    }
    out.push({ type, data: buf.subarray(dataStart, dataStart + dataSize) });
    let next = dataStart + dataSize;
    next += (4 - ((next - origin) & 3)) & 3;
    next += metaSize;
    next += (4 - ((next - origin) & 3)) & 3;
    off = next;
  }
  return out;
}

// ───────────────────────────── scéna ─────────────────────────────

interface ParentLink {
  name: string;
  matrix: Float64Array;
}

interface SceneNode {
  name: string;
  kind: "group" | "model" | "light" | "view";
  parents: ParentLink[];
  resource: string;
  visible: boolean;
  order: number;
}

interface ShadingModifier {
  attributes: number;
  lists: string[][];
}

interface ShaderInfo {
  material: string;
}

interface MaterialInfo {
  diffuse: Rgb;
  ambient: Rgb;
  emissive: Rgb;
  opacity: number;
}

interface ShadingDesc {
  diffuse: boolean;
  specular: boolean;
  layers: number;
}

// ─────────────────────── pomocné typované kontejnery ───────────────────────

function growF32(a: Float32Array, need: number): Float32Array {
  if (need <= a.length) return a;
  const b = new Float32Array(Math.max(need, a.length * 2, 48));
  b.set(a);
  return b;
}

function growU32(a: Uint32Array, need: number): Uint32Array {
  if (need <= a.length) return a;
  const b = new Uint32Array(Math.max(need, a.length * 2, 48));
  b.set(a);
  return b;
}

function growI32(a: Int32Array, need: number): Int32Array {
  if (need <= a.length) return a;
  const b = new Int32Array(Math.max(need, a.length * 2, 48));
  b.set(a);
  return b;
}

function growF64(a: Float64Array, need: number): Float64Array {
  if (need <= a.length) return a;
  const b = new Float64Array(Math.max(need, a.length * 2, 48));
  b.set(a);
  return b;
}

/** Malá množina celých čísel řazená sestupně (CIFXSetX — „větší index první"), znovupoužitelná. */
class SortedSet {
  buf: Int32Array = new Int32Array(32);
  n = 0;

  clear(): void {
    this.n = 0;
  }

  has(v: number): boolean {
    const b = this.buf;
    for (let i = 0, n = this.n; i < n; i++) {
      const m = b[i];
      if (m === v) return true;
      if (m < v) return false;
    }
    return false;
  }

  add(v: number): void {
    let b = this.buf;
    const n = this.n;
    let i = 0;
    if (n > 0 && b[n - 1] > v) {
      i = n; // vkládání v sestupném pořadí → připojit na konec
    } else {
      let lo = 0;
      let hi = n;
      while (lo < hi) {
        const mid = (lo + hi) >>> 1;
        if (b[mid] > v) lo = mid + 1;
        else hi = mid;
      }
      i = lo;
    }
    if (i < n && b[i] === v) return;
    if (n === b.length) {
      b = growI32(b, n + 1);
      this.buf = b;
    }
    for (let k = n; k > i; k--) b[k] = b[k - 1];
    b[i] = v;
    this.n = n + 1;
  }

  remove(v: number): void {
    const b = this.buf;
    const n = this.n;
    for (let i = 0; i < n; i++) {
      if (b[i] === v) {
        for (let k = i + 1; k < n; k++) b[k - 1] = b[k];
        this.n = n - 1;
        return;
      }
      if (b[i] < v) return;
    }
  }

  /** Naplní množinu z neseřazených hodnot (s opakováním) — O(n log n) místo vkládání po jedné. */
  fill(values: Int32Array, count: number): void {
    if (this.buf.length < count) this.buf = new Int32Array(Math.max(count, this.buf.length * 2));
    const b = this.buf;
    for (let i = 0; i < count; i++) b[i] = values[i];
    b.subarray(0, count).sort().reverse();
    // sestupně bez duplicit (zápis nikdy nepředběhne čtení)
    let n = 0;
    for (let i = 0; i < count; i++) {
      const v = b[i];
      if (n === 0 || b[n - 1] !== v) b[n++] = v;
    }
    this.n = n;
  }
}

/** Množina jen pro dotazy na členství (razítka místo řazeného pole). */
class StampSet {
  private mark = new Int32Array(64);
  private epoch = 1;

  clear(): void {
    if (++this.epoch > 0x7ffffff0) {
      this.mark.fill(0);
      this.epoch = 1;
    }
  }

  has(v: number): boolean {
    return v < this.mark.length && this.mark[v] === this.epoch;
  }

  add(v: number): void {
    if (v >= this.mark.length) {
      const m = new Int32Array(Math.max(v + 1, this.mark.length * 2));
      m.set(this.mark);
      this.mark = m;
    }
    this.mark[v] = this.epoch;
  }

  remove(v: number): void {
    if (v < this.mark.length && this.mark[v] === this.epoch) this.mark[v] = 0;
  }
}

/**
 * Sousednost pozice → množina ploch (CIFXSetAdjacencyX). Každá pozice má úsek ve sdíleném poolu
 * (při zaplnění se přestěhuje na konec s dvojnásobnou kapacitou). Úsek je uložen VZESTUPNĚ, aby
 * nově přidané plochy (nejvyšší indexy) šly připojit v O(1); referenční pořadí „větší index první"
 * dostaneme čtením odzadu: k-tý prvek = pool[top(p) − k].
 */
class FaceAdjacency {
  start: Int32Array = new Int32Array(0);
  len: Int32Array = new Int32Array(0);
  cap: Int32Array = new Int32Array(0);
  pool: Int32Array = new Int32Array(1024);
  private used = 0;

  ensurePositions(n: number): void {
    if (n <= this.start.length) return;
    const size = Math.max(n, this.start.length * 2, 64);
    const s = new Int32Array(size);
    s.set(this.start);
    const l = new Int32Array(size);
    l.set(this.len);
    const c = new Int32Array(size);
    c.set(this.cap);
    this.start = s;
    this.len = l;
    this.cap = c;
  }

  size(p: number): number {
    return p < this.len.length ? this.len[p] : 0;
  }

  /** Index posledního (= největšího) prvku úseku pozice; prvky sestupně: pool[top − k]. */
  top(p: number): number {
    return p < this.len.length ? this.start[p] + this.len[p] - 1 : -1;
  }

  add(p: number, f: number): void {
    this.ensurePositions(p + 1);
    let s = this.start[p];
    const n = this.len[p];
    let pool = this.pool;
    let i: number;
    if (n === 0 || pool[s + n - 1] < f) {
      i = n;
    } else {
      let lo = 0;
      let hi = n;
      while (lo < hi) {
        const mid = (lo + hi) >>> 1;
        if (pool[s + mid] < f) lo = mid + 1;
        else hi = mid;
      }
      if (pool[s + lo] === f) return;
      i = lo;
    }
    if (n === this.cap[p]) {
      const nc = n === 0 ? 8 : n * 2;
      const ns = this.used;
      pool = growI32(pool, ns + nc);
      this.pool = pool;
      for (let k = 0; k < n; k++) pool[ns + k] = pool[s + k];
      this.used = ns + nc;
      this.start[p] = ns;
      this.cap[p] = nc;
      s = ns;
    }
    for (let k = n; k > i; k--) pool[s + k] = pool[s + k - 1];
    pool[s + i] = f;
    this.len[p] = n + 1;
  }

  remove(p: number, f: number): void {
    if (p >= this.len.length) return;
    const s = this.start[p];
    const n = this.len[p];
    const pool = this.pool;
    let lo = 0;
    let hi = n;
    while (lo < hi) {
      const mid = (lo + hi) >>> 1;
      if (pool[s + mid] < f) lo = mid + 1;
      else hi = mid;
    }
    if (lo >= n || pool[s + lo] !== f) return;
    for (let k = lo + 1; k < n; k++) pool[s + k - 1] = pool[s + k];
    this.len[p] = n - 1;
  }
}

// ───────────────────────────── CLOD síť ─────────────────────────────

class ClodMesh {
  name: string;
  excludeNormals = false;
  shadings: ShadingDesc[] = [];
  finalMaxResolution = 0;
  iqPosition = 1;
  iqNormal = 1;

  positions: Float32Array = new Float32Array(0);
  numPositions = 0;
  normals: Float32Array = new Float32Array(0);
  numNormals = 0;
  /** Pozice rohů ploch (3 na plochu). */
  faces: Uint32Array = new Uint32Array(0);
  /** Normály rohů ploch (3 na plochu). */
  normalFaces: Uint32Array = new Uint32Array(0);
  faceShading: Uint32Array = new Uint32Array(0);
  numFaces = 0;
  /**
   * Mezipaměť normál ploch pro predikci (pozice se po zapsání nemění, takže normála plochy se
   * mění jen při posunutí jejího rohu). faceNormalState: 0 = nespočteno, 1 = platná, 2 = degenerovaná.
   */
  faceNormalCache: Float32Array = new Float32Array(0);
  faceNormalState: Uint8Array = new Uint8Array(0);

  adjacency = new FaceAdjacency();
  /** Po chybě se další bloky této sítě nedekódují (stav by nenavazoval). */
  broken = false;

  constructor(name: string) {
    this.name = name;
  }

  reserve(positions: number, faces: number): void {
    this.positions = growF32(this.positions, positions * 3);
    this.faces = growU32(this.faces, faces * 3);
    this.normalFaces = growU32(this.normalFaces, faces * 3);
    this.faceShading = growU32(this.faceShading, faces);
    if (this.faceNormalState.length < faces) {
      const n = Math.max(faces, this.faceNormalState.length * 2, 48);
      const st = new Uint8Array(n);
      st.set(this.faceNormalState);
      this.faceNormalState = st;
      this.faceNormalCache = growF32(this.faceNormalCache, n * 3);
    }
    this.adjacency.ensurePositions(positions);
  }
}

function readCount(r: BitReader, what: string): number {
  const n = r.readU32();
  if (n > MAX_ELEMENTS) fail(`nesmyslný počet (${what})`);
  return n;
}

function decodeClodDeclaration(r: BitReader): ClodMesh {
  const m = new ClodMesh(r.readString());
  r.readU32(); // chain index
  m.excludeNormals = (r.readU32() & 1) !== 0;
  const maxFaces = readCount(r, "ploch");
  const maxPositions = readCount(r, "pozic");
  readCount(r, "normál");
  readCount(r, "barev");
  readCount(r, "barev");
  readCount(r, "texturových souřadnic");
  const shadingCount = readCount(r, "stínování");
  if (shadingCount > 65536) fail("nesmyslný počet stínování");
  for (let i = 0; i < shadingCount; i++) {
    const attr = r.readU32();
    const layers = r.readU32();
    if (layers > MAX_TEX_LAYERS) fail("nesmyslný počet texturových vrstev");
    r.skipU32(layers); // rozměry texturových souřadnic
    r.readU32(); // původní ID shaderu
    m.shadings.push({ diffuse: (attr & 1) !== 0, specular: (attr & 2) !== 0, layers });
  }
  r.readU32(); // minimální rozlišení
  m.finalMaxResolution = r.readU32();
  r.skipU32(3); // faktory kvality
  m.iqPosition = r.readF32();
  m.iqNormal = r.readF32();
  // zbytek (inverzní kvantizace textur/barev, parametry normál, kosti) dekodér nepotřebuje;
  // deklarovaným počtům nevěříme víc, než je rozumné předalokovat (dál se pole zvětšují)
  m.reserve(Math.min(maxPositions, 1 << 20), Math.min(maxFaces, 1 << 20));
  return m;
}

/** Základní síť (CIFXAuthorCLODDecoder_S). */
function decodeClodBase(r: BitReader, m: ClodMesh): void {
  r.readU32(); // chain index (jméno už přečetl volající)
  const nFaces = readCount(r, "ploch");
  const nPositions = readCount(r, "pozic");
  const nNormals = readCount(r, "normál");
  const nDiffuse = readCount(r, "barev");
  const nSpecular = readCount(r, "barev");
  const nTex = readCount(r, "texturových souřadnic");
  const rawU32 = (nPositions + nNormals) * 3 + (nDiffuse + nSpecular + nTex) * 4;
  if (rawU32 > r.remainingBytes() / 4 + 1) fail("základní síť přesahuje blok");
  if (m.numPositions !== 0 || m.numFaces !== 0) fail("základní síť je v souboru vícekrát");

  m.reserve(nPositions, nFaces);
  const P = m.positions;
  for (let i = 0; i < nPositions * 3; i++) P[i] = r.readF32();
  m.normals = growF32(m.normals, nNormals * 3);
  for (let i = 0; i < nNormals * 3; i++) m.normals[i] = r.readF32();
  r.skipU32((nDiffuse + nSpecular + nTex) * 4);

  const ctxPos = AC_STATIC_FULL + nPositions;
  const ctxNorm = AC_STATIC_FULL + nNormals;
  const ctxDiff = AC_STATIC_FULL + nDiffuse;
  const ctxSpec = AC_STATIC_FULL + nSpecular;
  const ctxTex = AC_STATIC_FULL + nTex;
  const excl = m.excludeNormals;
  const F = m.faces;
  const NF = m.normalFaces;
  const shadings = m.shadings;
  for (let i = 0; i < nFaces; i++) {
    const sh = r.readCompressedU32(CTX_BASE_SHADING_ID);
    const desc = shadings[sh];
    if (!desc) fail("neplatné ID stínování");
    m.faceShading[i] = sh;
    for (let c = 0; c < 3; c++) {
      const p = r.readCompressedU32(ctxPos);
      if (p >= nPositions) fail("index pozice mimo rozsah");
      F[i * 3 + c] = p;
      NF[i * 3 + c] = excl ? 0 : r.readCompressedU32(ctxNorm);
      if (desc.diffuse) r.readCompressedU32(ctxDiff);
      if (desc.specular) r.readCompressedU32(ctxSpec);
      for (let l = 0; l < desc.layers; l++) r.readCompressedU32(ctxTex);
    }
  }
  const adj = m.adjacency;
  adj.ensurePositions(nPositions);
  for (let i = 0; i < nFaces; i++) {
    adj.add(F[i * 3], i);
    adj.add(F[i * 3 + 1], i);
    adj.add(F[i * 3 + 2], i);
  }
  m.numFaces = nFaces;
  m.numPositions = nPositions;
  m.numNormals = excl ? 0 : nNormals;
}

/** Sdílené pracovní struktury progresivního dekodéru (bez alokací ve smyčce). */
class ProgressiveScratch {
  setC = new SortedSet();
  left = new StampSet();
  right = new StampSet();
  moveFaces = new SortedSet();
  movePos = new StampSet();
  stayPos = new StampSet();
  setJ = new SortedSet();
  corners: Int32Array = new Int32Array(96);
  faceNormals: Float64Array = new Float64Array(96);
  predicted: Float64Array = new Float64Array(96);
  contrib: Int32Array = new Int32Array(32);
  /** Undo log: trojice (druh 0 = pozice / 1 = normála, index rohu, stará hodnota). */
  undo: Int32Array = new Int32Array(96);
  undoN = 0;
}

function logUndo(s: ProgressiveScratch, kind: number, idx: number, old: number): void {
  if (s.undoN + 3 > s.undo.length) s.undo = growI32(s.undo, s.undoN + 3);
  s.undo[s.undoN++] = kind;
  s.undo[s.undoN++] = idx;
  s.undo[s.undoN++] = old;
}

function readKeepChange(r: BitReader, base: number): void {
  if (r.readCompressedU8(base) === 1) {
    const t = r.readCompressedU8(base + 1);
    r.readCompressedU32(t === 1 ? base + 2 : t === 2 ? base + 3 : base + 4);
  }
}

function readNewFaceAttribute(r: BitReader, dupCtx: number, typeCtx: number, localCtx: number, globalCtx: number): void {
  const dup = r.readCompressedU8(dupCtx);
  for (let flag = 1; flag <= 4; flag <<= 1) {
    if (!(dup & flag)) {
      const t = r.readCompressedU8(typeCtx);
      r.readCompressedU32(t === 2 ? localCtx : globalCtx);
    }
  }
}

/**
 * Normála plochy s aritmetikou F32 jako v CIFXAuthorCLODDecoder::CalculateFaceNormalX
 * (na pořadí operací závisí výběr predikovaných normál).
 */
function faceNormalF32(P: Float32Array, a: number, b: number, c: number, out: Float32Array, o: number): boolean {
  const ax = P[a * 3];
  const ay = P[a * 3 + 1];
  const az = P[a * 3 + 2];
  let ux = fr(P[b * 3] - ax);
  let uy = fr(P[b * 3 + 1] - ay);
  let uz = fr(P[b * 3 + 2] - az);
  let vx = fr(P[c * 3] - ax);
  let vy = fr(P[c * 3 + 1] - ay);
  let vz = fr(P[c * 3 + 2] - az);
  const E = LEN_EPSILON;
  if (
    (Math.abs(ux) < E && Math.abs(uy) < E && Math.abs(uz) < E) ||
    (Math.abs(vx) < E && Math.abs(vy) < E && Math.abs(vz) < E)
  ) {
    return false;
  }
  let inv = fr(1 / fr(Math.sqrt(fr(fr(fr(ux * ux) + fr(uy * uy)) + fr(uz * uz)))));
  ux = fr(ux * inv);
  uy = fr(uy * inv);
  uz = fr(uz * inv);
  inv = fr(1 / fr(Math.sqrt(fr(fr(fr(vx * vx) + fr(vy * vy)) + fr(vz * vz)))));
  vx = fr(vx * inv);
  vy = fr(vy * inv);
  vz = fr(vz * inv);
  let nx = fr(fr(uy * vz) - fr(uz * vy));
  let ny = fr(fr(uz * vx) - fr(ux * vz));
  let nz = fr(fr(ux * vy) - fr(uy * vx));
  if (Math.abs(nx) < E && Math.abs(ny) < E && Math.abs(nz) < E) return false;
  inv = fr(1 / fr(Math.sqrt(fr(fr(fr(nx * nx) + fr(ny * ny)) + fr(nz * nz)))));
  nx = fr(nx * inv);
  ny = fr(ny * inv);
  nz = fr(nz * inv);
  out[o] = nx;
  out[o + 1] = ny;
  out[o + 2] = nz;
  return true;
}

function dotF32(a: Float64Array, i: number, b: Float64Array, j: number): number {
  return fr(fr(fr(a[i] * b[j]) + fr(a[i + 1] * b[j + 1])) + fr(a[i + 2] * b[j + 2]));
}

/** IFXQuaternion::Interpolate pro čisté kvaterniony <0, v> (výsledek zapíše do `from`). */
function slerpInto(t: number, from: Float64Array, fi: number, to: Float64Array, ti: number): void {
  let cosom = dotF32(from, fi, to, ti);
  let sgn = 1;
  if (cosom < 0) {
    cosom = -cosom;
    sgn = -1;
  }
  let s0: number;
  let s1: number;
  if (fr(1 - cosom) > SLERP_DELTA) {
    const omega = fr(Math.acos(cosom));
    const sinom = fr(Math.sin(omega));
    s0 = fr(fr(Math.sin(fr(fr(1 - t) * omega))) / sinom);
    s1 = fr(fr(Math.sin(fr(t * omega))) / sinom);
  } else {
    s0 = fr(1 - t);
    s1 = t;
  }
  for (let k = 0; k < 3; k++) {
    from[fi + k] = fr(fr(s0 * from[fi + k]) + fr(s1 * fr(sgn * to[ti + k])));
  }
}

/** Progresivní blok — rozdělování vrcholů (CIFXAuthorCLODDecoder_P), přesně v pořadí reference. */
function decodeClodProgressive(r: BitReader, m: ClodMesh, s: ProgressiveScratch): void {
  r.readU32(); // chain index (jméno už přečetl volající)
  const startRes = r.readU32();
  const endRes = r.readU32();
  if (startRes !== m.numPositions) fail("progresivní blok nenavazuje na předchozí data");
  if (endRes < startRes || endRes - startRes > MAX_ELEMENTS) fail("neplatný rozsah rozlišení");

  const excl = m.excludeNormals;
  const shadings = m.shadings;
  const adj = m.adjacency;
  const iqPos = m.iqPosition;
  const iqNorm = m.iqNormal;
  const { setC, left, right, moveFaces, movePos, stayPos, setJ } = s;

  for (let res = startRes; res < endRes; res++) {
    s.undoN = 0;
    const F0 = m.numFaces;
    try {
      m.reserve(res + 1, F0 + 16);
      // A. dělená pozice
      // při nulovém rozlišení na hodnotě nezáleží (žádná pozice ani plocha) — reference zapisuje 0
      let split = r.readCompressedU32(AC_STATIC_FULL + res);
      if (res === 0) split = 0;
      else if (split >= res) fail("neplatný index dělené pozice");

      // B, C. plochy u dělené pozice a jejich pozice (bez ní samotné)
      // množina ploch se nemění až do kroku G — čteme ji přímo z poolu (sestupně: pool[sTop − k])
      const sTop = adj.top(split);
      const sn = adj.size(split);
      let F = m.faces;
      if (s.corners.length < sn * 3) s.corners = new Int32Array(sn * 6);
      {
        const cb = s.corners;
        for (let k = 0; k < sn; k++) {
          const f = adj.pool[sTop - k];
          cb[k * 3] = F[f * 3];
          cb[k * 3 + 1] = F[f * 3 + 1];
          cb[k * 3 + 2] = F[f * 3 + 2];
        }
        setC.fill(cb, sn * 3);
      }
      setC.remove(split);

      // nové barvy a texturové souřadnice (hodnoty nepotřebujeme, jen je přečíst)
      const nDiff = r.readCompressedU16(CTX_NEW_DIFFUSE_COLORS_COUNT);
      for (let j = 0; j < nDiff; j++) {
        r.readCompressedU8(CTX_DIFFUSE_COLOR_SIGN);
        for (let k = 0; k < 4; k++) r.readCompressedU32(CTX_VERTEX_COLOR_DIFF_MAG_R + k);
      }
      const nSpec = r.readCompressedU16(CTX_NEW_SPECULAR_COLORS_COUNT);
      for (let j = 0; j < nSpec; j++) {
        r.readCompressedU8(CTX_SPECULAR_COLOR_SIGN);
        for (let k = 0; k < 4; k++) r.readCompressedU32(CTX_VERTEX_COLOR_DIFF_MAG_R + k);
      }
      const nTex = r.readCompressedU16(CTX_NEW_TEXCOORDS_COUNT);
      for (let j = 0; j < nTex; j++) {
        r.readCompressedU8(CTX_TEXCOORD_SIGN);
        for (let k = 0; k < 4; k++) r.readCompressedU32(CTX_TEXCOORD_DIFF_MAG_U + k);
      }

      // D, E. nové plochy
      const nNew = r.readCompressedU32(CTX_NUM_NEW_FACES);
      if (nNew > MAX_ELEMENTS) fail("nesmyslný počet nových ploch");
      m.reserve(res + 1, F0 + nNew);
      F = m.faces;
      left.clear();
      right.clear();
      for (let j = 0; j < nNew; j++) {
        const sh = r.readCompressedU32(CTX_SHADING_ID);
        if (sh >= shadings.length) fail("neplatné ID stínování");
        const orient = r.readCompressedU8(CTX_ORIENTATION_TYPE);
        const thirdType = r.readCompressedU8(CTX_THIRD_INDEX_TYPE);
        let third: number;
        if (thirdType === 1) {
          const li = r.readCompressedU32(CTX_LOCAL_3RD_POSITION);
          if (li >= setC.n) fail("lokální index třetí pozice mimo rozsah");
          third = setC.buf[li];
        } else {
          third = r.readCompressedU32(AC_STATIC_FULL + res);
          if (third >= res) fail("globální index třetí pozice mimo rozsah");
          setC.add(third);
        }
        const fi = F0 + j;
        m.faceShading[fi] = sh;
        m.faceNormalState[fi] = 0;
        if (orient === 1) {
          left.add(third);
          F[fi * 3] = split;
          F[fi * 3 + 1] = res;
        } else if (orient === 2) {
          right.add(third);
          F[fi * 3] = res;
          F[fi * 3 + 1] = split;
        } else {
          fail("neplatná orientace plochy");
        }
        F[fi * 3 + 2] = third;
      }

      // F. zůstat / posunout u ploch dělené pozice
      moveFaces.clear();
      movePos.clear();
      stayPos.clear();
      for (let k = 0; k < sn; k++) {
        const f = adj.pool[sTop - k];
        const a = F[f * 3];
        const b = F[f * 3 + 1];
        const c = F[f * 3 + 2];
        let pred = 0;
        let x = -1;
        let y = -1;
        if (split === a) {
          x = b;
          y = c;
        } else if (split === b) {
          x = c;
          y = a;
        } else if (split === c) {
          x = a;
          y = b;
        }
        if (x >= 0) {
          if (right.has(x)) pred = 1;
          else if (right.has(y)) pred = 2;
          else if (left.has(x)) pred = 2;
          else if (left.has(y)) pred = 1;
        }
        if (pred === 0 && (movePos.has(a) || movePos.has(b) || movePos.has(c))) pred = 3;
        if (pred === 0 && (stayPos.has(a) || stayPos.has(b) || stayPos.has(c))) pred = 4;
        if (r.readCompressedU8(CTX_STAY_MOVE + pred) === 1) {
          moveFaces.add(f);
          movePos.add(a);
          movePos.add(b);
          movePos.add(c);
          movePos.remove(split);
        } else {
          stayPos.add(a);
          stayPos.add(b);
          stayPos.add(c);
          stayPos.remove(split);
        }
      }

      // aktualizace atributů posunutých ploch
      for (let k = 0; k < moveFaces.n; k++) {
        const desc = shadings[m.faceShading[moveFaces.buf[k]]];
        if (desc.diffuse) readKeepChange(r, CTX_DIFFUSE_KEEP_CHANGE);
        if (desc.specular) readKeepChange(r, CTX_SPECULAR_KEEP_CHANGE);
        for (let l = 0; l < desc.layers; l++) readKeepChange(r, CTX_TEXCOORD_KEEP_CHANGE);
      }

      // atributy nových ploch
      for (let j = 0; j < nNew; j++) {
        const desc = shadings[m.faceShading[F0 + j]];
        if (desc.diffuse) {
          readNewFaceAttribute(r, CTX_VERT_COLOR_DUP_TYPE, CTX_VERT_COLOR_SPLIT_TYPE, CTX_VERT_COLOR_SPLIT_INDEX_LOCAL, CTX_VERT_COLOR_SPLIT_INDEX_GLOBAL);
        }
        if (desc.specular) {
          readNewFaceAttribute(r, CTX_VERT_COLOR_DUP_TYPE, CTX_VERT_COLOR_SPLIT_TYPE, CTX_VERT_COLOR_SPLIT_INDEX_LOCAL, CTX_VERT_COLOR_SPLIT_INDEX_GLOBAL);
        }
        for (let l = 0; l < desc.layers; l++) {
          readNewFaceAttribute(r, CTX_TEXCOORD_DUP_TYPE, CTX_TEXCOORD_SPLIT_TYPE, CTX_TEXCOORD_SPLIT_INDEX_LOCAL, CTX_TEXCOORD_SPLIT_INDEX_GLOBAL);
        }
      }

      // G, H. sousednost
      for (let k = 0; k < moveFaces.n; k++) {
        const f = moveFaces.buf[k];
        adj.remove(split, f);
        adj.add(res, f);
      }
      for (let j = 0; j < nNew; j++) {
        const fi = F0 + j;
        adj.add(F[fi * 3], fi);
        adj.add(F[fi * 3 + 1], fi);
        adj.add(F[fi * 3 + 2], fi);
      }

      // I, J. okolí nové pozice (posunuté plochy mají v tuto chvíli ještě dělenou pozici)
      {
        const jTop = adj.top(res);
        const jn = adj.size(res);
        if (s.corners.length < jn * 3) s.corners = new Int32Array(jn * 6);
        const cb = s.corners;
        for (let k = 0; k < jn; k++) {
          const f = adj.pool[jTop - k];
          cb[k * 3] = F[f * 3];
          cb[k * 3 + 1] = F[f * 3 + 1];
          cb[k * 3 + 2] = F[f * 3 + 2];
        }
        setJ.fill(cb, jn * 3);
      }

      // K–N. nová pozice = dělená pozice + kvantovaný rozdíl
      const signs = r.readCompressedU8(CTX_POSITION_DIFF_SIGNS);
      const dx = r.readCompressedU32(CTX_POSITION_DIFF_MAG_X);
      const dy = r.readCompressedU32(CTX_POSITION_DIFF_MAG_Y);
      const dz = r.readCompressedU32(CTX_POSITION_DIFF_MAG_Z);
      const P = m.positions;
      const px = res > 0 ? P[split * 3] : 0;
      const py = res > 0 ? P[split * 3 + 1] : 0;
      const pz = res > 0 ? P[split * 3 + 2] : 0;
      const qx = fr(iqPos * fr(dx));
      const qy = fr(iqPos * fr(dy));
      const qz = fr(iqPos * fr(dz));
      P[res * 3] = fr(px + (signs & 1 ? -qx : qx));
      P[res * 3 + 1] = fr(py + (signs & 2 ? -qy : qy));
      P[res * 3 + 2] = fr(pz + (signs & 4 ? -qz : qz));

      // aplikace aktualizací posunutých ploch (roh s dělenou pozicí → nová pozice)
      for (let k = 0; k < moveFaces.n; k++) {
        const f = moveFaces.buf[k];
        const o = F[f * 3] === split ? 0 : F[f * 3 + 1] === split ? 1 : F[f * 3 + 2] === split ? 2 : -1;
        if (o < 0) continue;
        logUndo(s, 0, f * 3 + o, split);
        F[f * 3 + o] = res;
        m.faceNormalState[f] = 0;
      }

      let newNormals = 0;
      if (!excl) newNormals = decodeNewNormals(r, m, s, F0, iqNorm);

      // potvrzení kroku
      m.numFaces = F0 + nNew;
      m.numPositions = res + 1;
      m.numNormals += newNormals;
    } catch (e) {
      // vrátit rozpracovaný krok — síť zůstane v posledním úplném rozlišení
      const u = s.undo;
      for (let i = s.undoN - 3; i >= 0; i -= 3) {
        if (u[i] === 0) {
          m.faces[u[i + 1]] = u[i + 2];
          m.faceNormalState[(u[i + 1] / 3) | 0] = 0;
        } else {
          m.normalFaces[u[i + 1]] = u[i + 2];
        }
      }
      s.undoN = 0;
      throw e;
    }
  }
}

/** Nové normály v okolí nové pozice (krok po zvýšení rozlišení). Vrací počet přidaných normál. */
function decodeNewNormals(r: BitReader, m: ClodMesh, s: ProgressiveScratch, validFaces: number, iqNorm: number): number {
  const { setJ } = s;
  const adj = m.adjacency;
  const F = m.faces;
  const P = m.positions;
  const oldNormals = m.numNormals;
  let added = 0;

  for (let k = 0; k < setJ.n; k++) {
    const p = setJ.buf[k];
    const fTop = adj.top(p);
    const fl = adj.size(p);
    const nLocal = r.readCompressedU32(CTX_NUM_LOCAL_NORMALS);
    if (nLocal > fl + 64 || nLocal > 4096) fail("nesmyslný počet normál");

    // normály ploch kolem pozice
    s.faceNormals = growF64(s.faceNormals, fl * 3 + 3);
    const fn = s.faceNormals;
    let nfn = 0;
    const cache = m.faceNormalCache;
    const state = m.faceNormalState;
    for (let q = 0; q < fl; q++) {
      const f = adj.pool[fTop - q];
      let st = state[f];
      if (st === 0) {
        st = faceNormalF32(P, F[f * 3], F[f * 3 + 1], F[f * 3 + 2], cache, f * 3) ? 1 : 2;
        state[f] = st;
      }
      if (st === 1) {
        fn[nfn * 3] = cache[f * 3];
        fn[nfn * 3 + 1] = cache[f * 3 + 1];
        fn[nfn * 3 + 2] = cache[f * 3 + 2];
        nfn++;
      }
    }
    if (nfn === 0) {
      fn[0] = 0;
      fn[1] = 0;
      fn[2] = 0;
    }

    // predikce: nejvzdálenější normály ploch, pak vážený slerp nejbližších
    s.predicted = growF64(s.predicted, nLocal * 3 + 3);
    const pn = s.predicted;
    let npn = 0;
    if (nfn > 0) {
      pn[0] = fn[0];
      pn[1] = fn[1];
      pn[2] = fn[2];
      npn = 1;
    }
    while (npn < nLocal) {
      let farthest = 1;
      let farIdx = 0;
      for (let q = 0; q < nfn; q++) {
        let minDist = -2;
        for (let l = 0; l < npn; l++) {
          const d = dotF32(fn, q * 3, pn, l * 3);
          if (d > minDist) minDist = d;
        }
        if (minDist < farthest) {
          farthest = minDist;
          farIdx = q;
        }
      }
      pn[npn * 3] = fn[farIdx * 3];
      pn[npn * 3 + 1] = fn[farIdx * 3 + 1];
      pn[npn * 3 + 2] = fn[farIdx * 3 + 2];
      npn++;
    }
    if (npn > 0) {
      if (s.contrib.length < npn) s.contrib = new Int32Array(npn * 2);
      const cnt = s.contrib;
      cnt.fill(0, 0, npn);
      for (let q = 0; q < nfn; q++) {
        let best = 0;
        let minDist = -2;
        for (let l = 0; l < npn; l++) {
          const d = dotF32(fn, q * 3, pn, l * 3);
          if (d > minDist) {
            minDist = d;
            best = l;
          }
        }
        slerpInto(fr(1 / (cnt[best] + 1)), pn, best * 3, fn, q * 3);
        cnt[best]++;
      }
    }

    // rekonstrukce: predikce · rozdílový kvaternion
    const base = oldNormals + added;
    m.normals = growF32(m.normals, (base + nLocal) * 3);
    const N = m.normals;
    for (let q = 0; q < nLocal; q++) {
      const signs = r.readCompressedU8(CTX_NORMAL_DIFF_SIGNS);
      const ux = r.readCompressedU32(CTX_NORMAL_DIFF_MAG_X);
      const uy = r.readCompressedU32(CTX_NORMAL_DIFF_MAG_Y);
      const uz = r.readCompressedU32(CTX_NORMAL_DIFF_MAG_Z);
      let ddx = fr(iqNorm * fr(ux));
      let ddy = fr(iqNorm * fr(uy));
      let ddz = fr(iqNorm * fr(uz));
      if (signs & 2) ddx = -ddx;
      if (signs & 4) ddy = -ddy;
      if (signs & 8) ddz = -ddz;
      let t = fr(fr(fr(ddx * ddx) + fr(ddy * ddy)) + fr(ddz * ddz));
      if (t > 1) t = 1;
      let w = fr(Math.sqrt(fr(1 - t)));
      if (signs & 1) w = -w;
      const ax = pn[q * 3];
      const ay = pn[q * 3 + 1];
      const az = pn[q * 3 + 2];
      // (0, a) · (w, d)
      N[(base + q) * 3] = fr(fr(fr(ax * w) + fr(ay * ddz)) - fr(az * ddy));
      N[(base + q) * 3 + 1] = fr(fr(fr(ay * w) + fr(az * ddx)) - fr(ax * ddz));
      N[(base + q) * 3 + 2] = fr(fr(fr(az * w) + fr(ax * ddy)) - fr(ay * ddx));
    }

    // přiřazení normál rohům ploch kolem pozice
    const NF = m.normalFaces;
    for (let q = 0; q < fl; q++) {
      const f = adj.pool[fTop - q];
      const idx = r.readCompressedU32(CTX_NORMAL_LOCAL_INDEX);
      const o = F[f * 3] === p ? 0 : F[f * 3 + 1] === p ? 1 : F[f * 3 + 2] === p ? 2 : -1;
      if (o < 0) continue;
      const ci = f * 3 + o;
      if (f < validFaces) logUndo(s, 1, ci, NF[ci]);
      NF[ci] = base + idx;
    }
    added += nLocal;
  }
  return added;
}

// ───────────────────────────── line set ─────────────────────────────

class LineSetRes {
  name: string;
  materials: ShadingDesc[] = [];
  hasTex = false;
  iqPosition = 1;
  positions: Float32Array = new Float32Array(0);
  numPositions = 0;
  lines: Uint32Array = new Uint32Array(0);
  lineMaterial: Uint32Array = new Uint32Array(0);
  numLines = 0;
  broken = false;

  constructor(name: string) {
    this.name = name;
  }
}

function decodeLineSetDeclaration(r: BitReader): LineSetRes {
  const ls = new LineSetRes(r.readString());
  r.readU32(); // chain index
  r.readU32(); // rezervováno
  const numLines = readCount(r, "úseček");
  const numPositions = readCount(r, "pozic");
  readCount(r, "normál");
  readCount(r, "barev");
  readCount(r, "barev");
  const numTex = readCount(r, "texturových souřadnic");
  const numMaterials = readCount(r, "materiálů");
  if (numMaterials > 65536) fail("nesmyslný počet materiálů");
  for (let i = 0; i < numMaterials; i++) {
    const attr = r.readU32();
    const layers = r.readU32();
    if (layers > MAX_TEX_LAYERS) fail("nesmyslný počet texturových vrstev");
    r.skipU32(layers);
    r.readU32();
    ls.materials.push({ diffuse: (attr & 1) !== 0, specular: (attr & 2) !== 0, layers });
  }
  ls.hasTex = numTex !== 0;
  r.skipU32(3);
  ls.iqPosition = r.readF32();
  ls.positions = new Float32Array(Math.min(numPositions, 1 << 22) * 3);
  ls.lines = new Uint32Array(Math.min(numLines, 1 << 22) * 2);
  ls.lineMaterial = new Uint32Array(Math.min(numLines, 1 << 22));
  return ls;
}

/** Pokračovací blok množiny úseček (CIFXLineSetDecoder::ReadLineUpdateX). */
function decodeLineSetContinuation(r: BitReader, ls: LineSetRes): void {
  r.readU32(); // chain index (jméno už přečetl volající)
  r.readU32(); // počáteční rozlišení
  const end = r.readU32();
  if (end > MAX_ELEMENTS) fail("neplatný rozsah rozlišení");
  for (let cur = ls.numPositions; cur < end; cur++) {
    const split = r.readCompressedU32(AC_STATIC_FULL + (cur > 1 ? cur : 1));
    if (cur > 0 && split >= cur) fail("neplatný index dělené pozice");
    const signs = r.readCompressedU8(CTX_POSITION_DIFF_SIGNS);
    const dx = r.readCompressedU32(CTX_POSITION_DIFF_MAG_X);
    const dy = r.readCompressedU32(CTX_POSITION_DIFF_MAG_Y);
    const dz = r.readCompressedU32(CTX_POSITION_DIFF_MAG_Z);
    ls.positions = growF32(ls.positions, (cur + 1) * 3);
    const P = ls.positions;
    const px = cur > 0 ? P[split * 3] : 0;
    const py = cur > 0 ? P[split * 3 + 1] : 0;
    const pz = cur > 0 ? P[split * 3 + 2] : 0;
    const iq = ls.iqPosition;
    const qx = fr(iq * fr(dx));
    const qy = fr(iq * fr(dy));
    const qz = fr(iq * fr(dz));
    P[cur * 3] = fr(px + (signs & 1 ? -qx : qx));
    P[cur * 3 + 1] = fr(py + (signs & 2 ? -qy : qy));
    P[cur * 3 + 2] = fr(pz + (signs & 4 ? -qz : qz));
    ls.numPositions = cur + 1;

    const nNormals = r.readCompressedU32(CTX_NUM_LOCAL_NORMALS);
    if (nNormals > 4096) fail("nesmyslný počet normál");
    for (let i = 0; i < nNormals; i++) {
      r.readCompressedU8(CTX_NORMAL_DIFF_SIGNS);
      r.readCompressedU32(CTX_NORMAL_DIFF_MAG_X);
      r.readCompressedU32(CTX_NORMAL_DIFF_MAG_Y);
      r.readCompressedU32(CTX_NORMAL_DIFF_MAG_Z);
    }
    const nLines = r.readCompressedU32(CTX_NUM_NEW_FACES);
    if (nLines > MAX_ELEMENTS) fail("nesmyslný počet úseček");
    for (let i = 0; i < nLines; i++) {
      const mat = r.readCompressedU32(CTX_LINE_SHADING_ID);
      const desc = ls.materials[mat];
      if (!desc) fail("neplatné ID materiálu úsečky");
      const endIdx = r.readCompressedU32(AC_STATIC_FULL + cur);
      if (endIdx > cur) fail("index koncového bodu mimo rozsah");
      for (let e = 0; e < 2; e++) {
        r.readCompressedU32(CTX_NORMAL_LOCAL_INDEX);
        for (let c = 0; c < 2; c++) {
          if (c === 0 ? !desc.diffuse : !desc.specular) continue;
          if (r.readCompressedU8(CTX_VERT_COLOR_DUP_TYPE) === 0) {
            r.readCompressedU8(CTX_NORMAL_DIFF_SIGNS);
            for (let k = 0; k < 4; k++) r.readCompressedU32(CTX_VERTEX_COLOR_DIFF_MAG_R + k);
          }
        }
        if (ls.hasTex) {
          for (let l = 0; l < desc.layers; l++) {
            if (r.readCompressedU8(CTX_TEXCOORD_DUP_TYPE) === 0) {
              r.readCompressedU8(CTX_TEXCOORD_DIFF_SIGNS);
              for (let k = 0; k < 4; k++) r.readCompressedU32(CTX_TEXCOORD_DIFF_MAG_U + k);
            }
          }
        }
      }
      ls.lines = growU32(ls.lines, (ls.numLines + 1) * 2);
      ls.lineMaterial = growU32(ls.lineMaterial, ls.numLines + 1);
      ls.lines[ls.numLines * 2] = endIdx;
      ls.lines[ls.numLines * 2 + 1] = cur;
      ls.lineMaterial[ls.numLines] = mat;
      ls.numLines++;
    }
  }
}

// ───────────────────────────── sestavení výstupu ─────────────────────────────

const IDENTITY = new Float64Array([1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1]);

/** Součin matic 4×4 uložených po sloupcích: a · b. */
function mul4(a: Float64Array, b: Float64Array): Float64Array {
  const o = new Float64Array(16);
  for (let c = 0; c < 4; c++) {
    for (let rr = 0; rr < 4; rr++) {
      o[c * 4 + rr] = a[rr] * b[c * 4] + a[4 + rr] * b[c * 4 + 1] + a[8 + rr] * b[c * 4 + 2] + a[12 + rr] * b[c * 4 + 3];
    }
  }
  return o;
}

/** Inverzní transpozice horní 3×3 (pro normály) a determinant. */
function normalMatrix(m: Float64Array): { n: Float64Array; det: number } {
  const a = m[0], b = m[4], c = m[8];
  const d = m[1], e = m[5], f = m[9];
  const g = m[2], h = m[6], i = m[10];
  const A = e * i - f * h;
  const B = -(d * i - f * g);
  const C = d * h - e * g;
  const det = a * A + b * B + c * C;
  const n = new Float64Array(9);
  if (!Number.isFinite(det) || Math.abs(det) < 1e-300) {
    n.set([a, d, g, b, e, h, c, f, i]);
    return { n, det };
  }
  const inv = 1 / det;
  // n (po řádcích) = (M⁻¹)ᵀ = kofaktory / det
  n[0] = A * inv;
  n[1] = B * inv;
  n[2] = C * inv;
  n[3] = -(b * i - c * h) * inv;
  n[4] = (a * i - c * g) * inv;
  n[5] = -(a * h - b * g) * inv;
  n[6] = (b * f - c * e) * inv;
  n[7] = -(a * f - c * d) * inv;
  n[8] = (a * e - b * d) * inv;
  return { n, det };
}

/** Síť připravená pro instancování (vrcholy = jedinečné dvojice pozice/normála). */
interface PreparedMesh {
  positions: Float32Array;
  normals: Float32Array | null;
  /** Skupiny trojúhelníků podle ID stínování. */
  groups: { shading: number; indices: Uint32Array }[];
}

function prepareMesh(m: ClodMesh): PreparedMesh | null {
  const nF = m.numFaces;
  const nP = m.numPositions;
  if (nF === 0 || nP === 0) return null;
  const F = m.faces;
  const NF = m.normalFaces;
  const P = m.positions;
  const N = m.normals;
  const nN = m.numNormals;
  let useNormals = !m.excludeNormals && nN > 0;
  if (useNormals) {
    for (let i = 0; i < nF * 3; i++) {
      if (NF[i] >= nN) {
        useNormals = false;
        break;
      }
    }
  }
  if (useNormals && !normalsPlausible(m)) useNormals = false;

  // jedinečné vrcholy
  let vertCount = 0;
  const cornerVert = new Uint32Array(nF * 3);
  let outPos: Float32Array;
  let outNorm: Float32Array | null = null;
  if (useNormals) {
    const head = new Int32Array(nP).fill(-1);
    const next = new Int32Array(nF * 3);
    const nodeNormal = new Uint32Array(nF * 3);
    const posOf = new Uint32Array(nF * 3);
    for (let i = 0; i < nF * 3; i++) {
      const p = F[i];
      const n = NF[i];
      let v = head[p];
      while (v >= 0 && nodeNormal[v] !== n) v = next[v];
      if (v < 0) {
        v = vertCount++;
        nodeNormal[v] = n;
        posOf[v] = p;
        next[v] = head[p];
        head[p] = v;
      }
      cornerVert[i] = v;
    }
    outPos = new Float32Array(vertCount * 3);
    outNorm = new Float32Array(vertCount * 3);
    for (let v = 0; v < vertCount; v++) {
      const p = posOf[v] * 3;
      const n = nodeNormal[v] * 3;
      outPos[v * 3] = P[p];
      outPos[v * 3 + 1] = P[p + 1];
      outPos[v * 3 + 2] = P[p + 2];
      let x = N[n];
      let y = N[n + 1];
      let z = N[n + 2];
      const l = Math.hypot(x, y, z);
      if (l > 0) {
        x /= l;
        y /= l;
        z /= l;
      }
      outNorm[v * 3] = x;
      outNorm[v * 3 + 1] = y;
      outNorm[v * 3 + 2] = z;
    }
  } else {
    vertCount = nP;
    outPos = P.slice(0, nP * 3);
    for (let i = 0; i < nF * 3; i++) cornerVert[i] = F[i];
  }

  // skupiny podle stínování (stabilně)
  const nSh = Math.max(1, m.shadings.length);
  const counts = new Uint32Array(nSh);
  for (let f = 0; f < nF; f++) counts[Math.min(m.faceShading[f], nSh - 1)]++;
  const groups: PreparedMesh["groups"] = [];
  const fill = new Uint32Array(nSh);
  const arrays: (Uint32Array | null)[] = [];
  for (let sh = 0; sh < nSh; sh++) {
    arrays.push(counts[sh] ? new Uint32Array(counts[sh] * 3) : null);
  }
  for (let f = 0; f < nF; f++) {
    const sh = Math.min(m.faceShading[f], nSh - 1);
    const arr = arrays[sh]!;
    const o = fill[sh] * 3;
    arr[o] = cornerVert[f * 3];
    arr[o + 1] = cornerVert[f * 3 + 1];
    arr[o + 2] = cornerVert[f * 3 + 2];
    fill[sh]++;
  }
  for (let sh = 0; sh < nSh; sh++) {
    const arr = arrays[sh];
    if (arr) groups.push({ shading: sh, indices: arr });
  }
  return { positions: outPos, normals: outNorm, groups };
}

/**
 * Pojistka: normály, které většinou míří proti orientaci trojúhelníků, jsou nejspíš z kodéru
 * s jinou predikcí — pak je raději necháme dopočítat prohlížeči.
 */
function normalsPlausible(m: ClodMesh): boolean {
  const F = m.faces;
  const NF = m.normalFaces;
  const P = m.positions;
  const N = m.normals;
  const step = Math.max(1, Math.floor(m.numFaces / 20000));
  let good = 0;
  let bad = 0;
  for (let f = 0; f < m.numFaces; f += step) {
    const a = F[f * 3] * 3, b = F[f * 3 + 1] * 3, c = F[f * 3 + 2] * 3;
    const ux = P[b] - P[a], uy = P[b + 1] - P[a + 1], uz = P[b + 2] - P[a + 2];
    const vx = P[c] - P[a], vy = P[c + 1] - P[a + 1], vz = P[c + 2] - P[a + 2];
    const nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
    const nl = Math.hypot(nx, ny, nz);
    if (!(nl > 0)) continue;
    for (let k = 0; k < 3; k++) {
      const n = NF[f * 3 + k] * 3;
      const d = (N[n] * nx + N[n + 1] * ny + N[n + 2] * nz) / nl;
      if (!Number.isFinite(d)) bad++;
      else if (d < -0.2) bad++;
      else good++;
    }
  }
  return bad <= (good + bad) * 0.3;
}

function sanitizeRgb(v: Rgb): Rgb {
  const c = (x: number) => (Number.isFinite(x) ? Math.min(1, Math.max(0, x)) : 0);
  return [c(v[0]), c(v[1]), c(v[2])];
}

function materialColor(mat: MaterialInfo): Rgb {
  const max = (c: Rgb) => Math.max(c[0], c[1], c[2]);
  if (max(mat.diffuse) < 0.02) {
    if (max(mat.emissive) >= 0.02) return sanitizeRgb(mat.emissive);
    if (max(mat.ambient) >= 0.02) return sanitizeRgb(mat.ambient);
  }
  return sanitizeRgb(mat.diffuse);
}

// ───────────────────────────── hlavní funkce ─────────────────────────────

interface ChainContext {
  /** 0 = uzel, 1 = model (zdroj), 2 = textura; −1 = mimo řetězec. */
  type: number;
  name: string;
}

/**
 * Dekóduje U3D proud (ECMA-363) na díly s trojúhelníkovou sítí ve světových souřadnicích (mm).
 * Poškozené bloky přeskočí s varováním; když nezbude nic k zobrazení, vyhodí ModelImportError.
 */
export function parseU3D(data: Uint8Array): ParsedModel {
  const warnings: string[] = [];
  const warnSet = new Set<string>();
  const warn = (msg: string) => {
    if (!warnSet.has(msg)) {
      warnSet.add(msg);
      warnings.push(msg);
    }
  };

  if (data.length < 36) throw new ModelImportError("3D obsah (U3D) se nepodařilo přečíst: soubor je příliš krátký.");
  const dv = new DataView(data.buffer, data.byteOffset, data.byteLength);
  if (dv.getUint32(0, true) !== BLOCK_FILE_HEADER) {
    throw new ModelImportError("3D obsah (U3D) se nepodařilo přečíst: chybí hlavička U3D.");
  }

  const top = splitBlocks(data, 0, data.length, 0, warn);
  const header = top[0];
  if (!header || header.type !== BLOCK_FILE_HEADER || header.data.length < 24) {
    throw new ModelImportError("3D obsah (U3D) se nepodařilo přečíst: poškozená hlavička souboru.");
  }
  let profile = 0;
  let units = 0;
  let encoding = 106;
  try {
    const hr = new BitReader(header.data, true);
    hr.readU32(); // verze
    profile = hr.readU32();
    hr.readU32(); // velikost deklarací
    hr.readU32();
    hr.readU32(); // velikost souboru (U64)
    encoding = hr.readU32(); // kódování znaků (MIBenum, 106 = UTF-8)
    if (profile & PROFILE_UNITS_SCALE && header.data.length >= 32) units = hr.readF64();
  } catch {
    throw new ModelImportError("3D obsah (U3D) se nepodařilo přečíst: poškozená hlavička souboru.");
  }
  const noCompression = (profile & PROFILE_NO_COMPRESSION) !== 0;
  const decodeString = makeStringDecoder(encoding);

  const nodes = new Map<string, SceneNode>();
  const meshes = new Map<string, ClodMesh>();
  const lineSets = new Map<string, LineSetRes>();
  const shadingByNode = new Map<string, ShadingModifier>();
  const shadingByResource = new Map<string, ShadingModifier>();
  const shaders = new Map<string, ShaderInfo>();
  const materials = new Map<string, MaterialInfo>();
  const scratch = new ProgressiveScratch();
  let nodeOrder = 0;
  let failedBlocks = 0;

  const readNode = (r: BitReader, kind: SceneNode["kind"]) => {
    const name = r.readString();
    const parentCount = r.readU32();
    if (parentCount > 65536) fail("nesmyslný počet rodičů");
    const parents: ParentLink[] = [];
    for (let i = 0; i < parentCount; i++) {
      const pname = r.readString();
      const matrix = new Float64Array(16);
      for (let j = 0; j < 16; j++) matrix[j] = r.readF32();
      parents.push({ name: pname, matrix });
    }
    let resource = "";
    let visible = true;
    if (kind === "model") {
      resource = r.readString();
      visible = (r.readU32() & 3) !== 0;
    }
    nodes.set(name, { name, kind, parents, resource, visible, order: nodeOrder++ });
  };

  const processBlock = (blk: RawBlock, chain: ChainContext) => {
    if (!HANDLED_BLOCKS.has(blk.type)) return; // světla, kamery, textury, animace… geometrii nenesou
    if (blk.type === BLOCK_MODIFIER_CHAIN) {
      // hlavička řetězce: jméno, typ, atributy, obalová tělesa, zarovnání, počet; pak vnořené bloky
      const nameBytes = blk.data.length >= 2 ? blk.data[0] | (blk.data[1] << 8) : 0;
      const r = new BitReader(blk.data.subarray(0, Math.min(blk.data.length, 2 + nameBytes + 52)), noCompression, decodeString);
      const name = r.readString();
      const type = r.readU32();
      const attr = r.readU32();
      let pos = 2 + nameBytes + 8;
      if (attr & 1) {
        r.skipU32(4);
        pos += 16;
      }
      if (attr & 2) {
        r.skipU32(6);
        pos += 24;
      }
      pos += (4 - ((2 + nameBytes) & 3)) & 3;
      pos += 4; // počet modifikátorů
      if (pos > blk.data.length) fail("poškozený řetězec modifikátorů");
      const inner = splitBlocks(blk.data, pos, blk.data.length, 0, warn);
      for (const b of inner) runBlock(b, { type, name });
      return;
    }
    const r = new BitReader(blk.data, noCompression, decodeString);
    switch (blk.type) {
      case BLOCK_GROUP_NODE:
        readNode(r, "group");
        return;
      case BLOCK_MODEL_NODE:
        readNode(r, "model");
        return;
      case BLOCK_LIGHT_NODE:
        readNode(r, "light");
        return;
      case BLOCK_VIEW_NODE:
        readNode(r, "view");
        return;
      case BLOCK_CLOD_DECLARATION: {
        const m = decodeClodDeclaration(r);
        meshes.set(m.name, m);
        return;
      }
      case BLOCK_CLOD_BASE:
      case BLOCK_CLOD_PROGRESSIVE: {
        const name = r.readString();
        const m = meshes.get(name);
        if (!m) fail("chybí deklarace sítě");
        if (m.broken) return;
        try {
          if (blk.type === BLOCK_CLOD_BASE) decodeClodBase(r, m);
          else decodeClodProgressive(r, m, scratch);
        } catch (e) {
          m.broken = true;
          throw e;
        }
        return;
      }
      case BLOCK_LINE_SET: {
        const ls = decodeLineSetDeclaration(r);
        lineSets.set(ls.name, ls);
        return;
      }
      case BLOCK_LINE_SET_CONT: {
        const name = r.readString();
        const ls = lineSets.get(name);
        if (!ls) fail("chybí deklarace množiny úseček");
        if (ls.broken) return;
        try {
          decodeLineSetContinuation(r, ls);
        } catch (e) {
          ls.broken = true;
          throw e;
        }
        return;
      }
      case BLOCK_POINT_SET:
      case BLOCK_POINT_SET_CONT:
        warn(POINT_SET_WARNING);
        return;
      case BLOCK_SHADING_MODIFIER: {
        const name = r.readString();
        r.readU32(); // pozice v řetězci
        const attributes = r.readU32();
        const listCount = r.readU32();
        if (listCount > 65536) fail("nesmyslný počet seznamů shaderů");
        const lists: string[][] = [];
        for (let i = 0; i < listCount; i++) {
          const cnt = r.readU32();
          if (cnt > 65536) fail("nesmyslný počet shaderů");
          const list: string[] = [];
          for (let j = 0; j < cnt; j++) list.push(r.readString());
          lists.push(list);
        }
        const mod: ShadingModifier = { attributes, lists };
        const key = chain.type >= 0 ? chain.name : name;
        if (chain.type === 1) shadingByResource.set(key, mod);
        else shadingByNode.set(key, mod);
        return;
      }
      case BLOCK_LIT_TEXTURE_SHADER: {
        const name = r.readString();
        r.readU32(); // atributy
        r.readF32(); // alpha test reference
        r.skipU32(5); // funkce alfa testu, blend, render pass, kanály, alfa kanály
        shaders.set(name, { material: r.readString() });
        return;
      }
      case BLOCK_MATERIAL: {
        const name = r.readString();
        r.readU32(); // atributy
        const rgb = (): Rgb => [r.readF32(), r.readF32(), r.readF32()];
        const ambient = rgb();
        const diffuse = rgb();
        rgb(); // spekulární
        const emissive = rgb();
        r.readF32(); // odrazivost
        const opacity = r.readF32();
        materials.set(name, { ambient, diffuse, emissive, opacity });
        return;
      }
      case BLOCK_FILE_REFERENCE:
        warn("Model odkazuje na externí soubory U3D — ty se nenačítají.");
        return;
    }
  };

  const runBlock = (blk: RawBlock, chain: ChainContext) => {
    try {
      processBlock(blk, chain);
    } catch (e) {
      if (!(e instanceof U3DError) && !(e instanceof RangeError)) throw e;
      failedBlocks++;
      const what =
        blk.type === BLOCK_CLOD_BASE || blk.type === BLOCK_CLOD_PROGRESSIVE || blk.type === BLOCK_CLOD_DECLARATION
          ? "Část sítě"
          : blk.type === BLOCK_LINE_SET || blk.type === BLOCK_LINE_SET_CONT
            ? "Část čar"
            : "Část scény";
      warn(`${what} se nepodařilo přečíst (${e.message}) — model může být neúplný.`);
    }
  };

  for (let i = 1; i < top.length; i++) runBlock(top[i], { type: -1, name: "" });

  for (const m of meshes.values()) {
    if (m.finalMaxResolution > m.numPositions && !m.broken && m.numPositions > 0) {
      warn("Některá síť není v souboru v plném rozlišení — zobrazuje se hrubší verze.");
    }
  }

  // ── sestavení scény ──
  const scale = units > 0 && Number.isFinite(units) ? units * 1000 : 1;
  const parts: MeshPart[] = [];
  const prepared = new Map<string, PreparedMesh | null>();
  const getPrepared = (m: ClodMesh) => {
    let p = prepared.get(m.name);
    if (p === undefined) {
      p = prepareMesh(m);
      prepared.set(m.name, p);
    }
    return p;
  };

  const resolveMaterial = (mod: ShadingModifier | undefined, element: number): MaterialInfo | null => {
    if (!mod || mod.lists.length === 0) return null;
    const list = mod.lists[Math.min(element, mod.lists.length - 1)];
    for (const shaderName of list) {
      const sh = shaders.get(shaderName);
      const mat = sh ? materials.get(sh.material) : undefined;
      if (mat) return mat;
    }
    return null;
  };

  // děti podle rodičů (v pořadí deklarace)
  const children = new Map<string, { node: SceneNode; matrix: Float64Array }[]>();
  const sortedNodes = [...nodes.values()].sort((a, b) => a.order - b.order);
  const rootLinks: { node: SceneNode; matrix: Float64Array }[] = [];
  for (const n of sortedNodes) {
    if (n.parents.length === 0) {
      rootLinks.push({ node: n, matrix: IDENTITY });
      continue;
    }
    for (const p of n.parents) {
      if (p.name === "" || !nodes.has(p.name) || p.name === n.name) {
        rootLinks.push({ node: n, matrix: p.matrix });
      } else {
        let list = children.get(p.name);
        if (!list) {
          list = [];
          children.set(p.name, list);
        }
        list.push({ node: n, matrix: p.matrix });
      }
    }
  }

  let instances = 0;
  let totalTriangles = 0;
  let truncated = false;
  const rootScale = new Float64Array([scale, 0, 0, 0, 0, scale, 0, 0, 0, 0, scale, 0, 0, 0, 0, 1]);

  const emitMesh = (node: SceneNode, m: ClodMesh, world: Float64Array, out: number[]) => {
    const pm = getPrepared(m);
    if (!pm) return;
    const mod = shadingByNode.get(node.name) ?? shadingByResource.get(m.name);
    // seskupení skupin stínování se stejnou barvou do jednoho dílu
    const byColor = new Map<string, { color: Rgb | null; opacity: number; groups: Uint32Array[]; tris: number }>();
    for (const g of pm.groups) {
      const mat = resolveMaterial(mod, g.shading);
      const color = mat ? materialColor(mat) : null;
      const opacity = mat && Number.isFinite(mat.opacity) && mat.opacity > 0 && mat.opacity < 0.999 ? mat.opacity : 1;
      const key = color ? `${color.join(",")}|${opacity}` : `-|${opacity}`;
      let e = byColor.get(key);
      if (!e) {
        e = { color, opacity, groups: [], tris: 0 };
        byColor.set(key, e);
      }
      e.groups.push(g.indices);
      e.tris += g.indices.length / 3;
    }
    const { n: nm, det } = normalMatrix(world);
    const flip = det < 0;
    const src = pm.positions;
    const vcount = src.length / 3;
    const positions = new Float32Array(vcount * 3);
    for (let v = 0; v < vcount; v++) {
      const x = src[v * 3], y = src[v * 3 + 1], z = src[v * 3 + 2];
      positions[v * 3] = world[0] * x + world[4] * y + world[8] * z + world[12];
      positions[v * 3 + 1] = world[1] * x + world[5] * y + world[9] * z + world[13];
      positions[v * 3 + 2] = world[2] * x + world[6] * y + world[10] * z + world[14];
    }
    let normals: Float32Array | null = null;
    if (pm.normals) {
      const sn = pm.normals;
      normals = new Float32Array(vcount * 3);
      for (let v = 0; v < vcount; v++) {
        const x = sn[v * 3], y = sn[v * 3 + 1], z = sn[v * 3 + 2];
        let nx = nm[0] * x + nm[1] * y + nm[2] * z;
        let ny = nm[3] * x + nm[4] * y + nm[5] * z;
        let nz = nm[6] * x + nm[7] * y + nm[8] * z;
        const l = Math.hypot(nx, ny, nz);
        if (l > 0) {
          nx /= l;
          ny /= l;
          nz /= l;
        }
        normals[v * 3] = nx;
        normals[v * 3 + 1] = ny;
        normals[v * 3 + 2] = nz;
      }
    }
    const entries = [...byColor.values()];
    const baseName = node.name || m.name || `Díl ${parts.length + 1}`;
    const owner = entries.length > 1 ? new Int32Array(vcount).fill(-1) : null;
    const local = entries.length > 1 ? new Int32Array(vcount) : null;
    entries.forEach((e, ei) => {
      if (totalTriangles + e.tris > MAX_TOTAL_TRIANGLES) {
        truncated = true;
        return;
      }
      totalTriangles += e.tris;
      const idx = new Uint32Array(e.tris * 3);
      let o = 0;
      for (const g of e.groups) {
        if (flip) {
          for (let t = 0; t < g.length; t += 3) {
            idx[o++] = g[t];
            idx[o++] = g[t + 2];
            idx[o++] = g[t + 1];
          }
        } else {
          idx.set(g, o);
          o += g.length;
        }
      }
      let pos = positions;
      let nor = normals;
      if (entries.length > 1) {
        // každý díl jen se svými vrcholy (owner/local sdílené přes všechny barvy dílu)
        const verts = new Int32Array(idx.length);
        let nv = 0;
        for (let i = 0; i < idx.length; i++) {
          const v = idx[i];
          if (owner![v] !== ei) {
            owner![v] = ei;
            local![v] = nv;
            verts[nv++] = v;
          }
          idx[i] = local![v];
        }
        pos = new Float32Array(nv * 3);
        nor = normals ? new Float32Array(nv * 3) : null;
        for (let t = 0; t < nv; t++) {
          const v = verts[t];
          pos[t * 3] = positions[v * 3];
          pos[t * 3 + 1] = positions[v * 3 + 1];
          pos[t * 3 + 2] = positions[v * 3 + 2];
          if (nor && normals) {
            nor[t * 3] = normals[v * 3];
            nor[t * 3 + 1] = normals[v * 3 + 1];
            nor[t * 3 + 2] = normals[v * 3 + 2];
          }
        }
      }
      const part: MeshPart = {
        name: entries.length > 1 ? `${baseName} (${ei + 1})` : baseName,
        positions: pos,
        normals: nor,
        indices: idx,
        color: e.color,
      };
      if (e.opacity < 1) part.opacity = e.opacity;
      out.push(parts.length);
      parts.push(part);
    });
  };

  const emitLines = (node: SceneNode, ls: LineSetRes, world: Float64Array, out: number[]) => {
    const n = ls.numLines;
    if (n === 0) return;
    const P = ls.positions;
    const lines = new Float32Array(n * 6);
    let o = 0;
    for (let i = 0; i < n; i++) {
      for (let e = 0; e < 2; e++) {
        const p = ls.lines[i * 2 + e];
        if (p >= ls.numPositions) continue;
        const x = P[p * 3], y = P[p * 3 + 1], z = P[p * 3 + 2];
        lines[o++] = world[0] * x + world[4] * y + world[8] * z + world[12];
        lines[o++] = world[1] * x + world[5] * y + world[9] * z + world[13];
        lines[o++] = world[2] * x + world[6] * y + world[10] * z + world[14];
      }
    }
    const mod = shadingByNode.get(node.name) ?? shadingByResource.get(ls.name);
    const mat = resolveMaterial(mod, n > 0 ? ls.lineMaterial[0] : 0);
    out.push(parts.length);
    parts.push({
      name: node.name || ls.name,
      positions: new Float32Array(0),
      indices: null,
      normals: null,
      lines: o === lines.length ? lines : lines.slice(0, o - (o % 6)),
      color: mat ? materialColor(mat) : null,
    });
  };

  const visit = (node: SceneNode, parentWorld: Float64Array, local: Float64Array, path: Set<string>, depth: number): ModelNode | null => {
    if (instances >= MAX_INSTANCES || depth > MAX_NODE_DEPTH || path.has(node.name)) return null;
    instances++;
    const world = mul4(parentWorld, local);
    const tn: ModelNode = { name: node.name, parts: [], children: [] };
    if (node.kind === "model" && node.visible) {
      const m = meshes.get(node.resource);
      if (m) emitMesh(node, m, world, tn.parts);
      else {
        const ls = lineSets.get(node.resource);
        if (ls) emitLines(node, ls, world, tn.parts);
      }
    }
    const kids = children.get(node.name);
    if (kids) {
      path.add(node.name);
      for (const k of kids) {
        const c = visit(k.node, world, k.matrix, path, depth + 1);
        if (c) tn.children.push(c);
      }
      path.delete(node.name);
    }
    if (tn.parts.length === 0 && tn.children.length === 0) return null;
    // průchozí skupina bez geometrie s jediným potomkem se nezplošťuje — strom má odpovídat souboru
    return tn;
  };

  const root: ModelNode = { name: "U3D", parts: [], children: [] };
  for (const link of rootLinks) {
    const c = visit(link.node, rootScale, link.matrix, new Set<string>(), 0);
    if (c) root.children.push(c);
  }

  // zdroje bez uzlu (soubor bez scény) — zobrazit aspoň samotnou geometrii
  if (parts.length === 0 && nodes.size === 0) {
    for (const m of meshes.values()) {
      const pseudo: SceneNode = { name: m.name, kind: "model", parents: [], resource: m.name, visible: true, order: 0 };
      const tn: ModelNode = { name: m.name, parts: [], children: [] };
      emitMesh(pseudo, m, rootScale, tn.parts);
      if (tn.parts.length) root.children.push(tn);
    }
  }

  if (truncated) warn("Model je příliš velký — část dílů byla vynechána.");
  if (instances >= MAX_INSTANCES) warn("Model obsahuje příliš mnoho instancí dílů — část byla vynechána.");

  if (parts.length === 0) {
    if (failedBlocks > 0) {
      throw new ModelImportError("3D obsah (U3D) se nepodařilo přečíst: data geometrie jsou poškozená nebo nepodporovaná.");
    }
    const onlyPoints = warnSet.has(POINT_SET_WARNING);
    throw new ModelImportError(
      onlyPoints
        ? "3D obsah (U3D) neobsahuje žádnou zobrazitelnou geometrii — jen bodovou množinu (point set), kterou prohlížeč nezobrazuje."
        : "3D obsah (U3D) neobsahuje žádnou zobrazitelnou geometrii.",
    );
  }

  const result: ParsedModel = { parts, root, format: "U3D (3D PDF)" };
  if (warnings.length) result.warnings = warnings;
  return result;
}
