/**
 * Minimální kodér U3D jen pro testy dekodéru (u3d.test.ts) — není součástí aplikace.
 *
 * Zápisová strana zrcadlí referenční implementaci (U3D Sample Software): CIFXBitStreamX::Write*
 * (aritmetické kódování ECMA-363 §10, statické i adaptivní kontexty, escape, flush U32 0),
 * CIFXAuthorCLODEncoderX_S (základní síť) a zjednodušený CIFXAuthorCLODEncoderX_P (progresivní
 * rozdělování vrcholů podle předepsaného scénáře), zápis bloků, řetězců modifikátorů, uzlů,
 * shading modifikátoru, shaderu a materiálu. Histogram je záměrně napsán nezávisle (naivně)
 * na dekodéru, aby test křížově ověřil i jeho optimalizovanou variantu.
 */

const AC_STATIC_FULL = 0x400;
const AC_MAX_RANGE = AC_STATIC_FULL + 0x3fff;
const HALF = 0x8000;
const QUARTER = 0x4000;

const PROFILE_NO_COMPRESSION = 0x4;
const PROFILE_UNITS = 0x8;

function swapBits8(v: number): number {
  let r = 0;
  for (let b = 0; b < 8; b++) if (v & (1 << b)) r |= 1 << (7 - b);
  return r;
}

/** Naivní adaptivní histogram se stejnými pravidly jako IFXHistogramDynamic. */
class NaiveHistogram {
  counts: number[] = [1];
  total = 1;

  freq(s: number): number {
    return this.counts[s] ?? 0;
  }

  cum(s: number): number {
    let c = 0;
    for (let i = 0; i < s && i < this.counts.length; i++) c += this.counts[i];
    return c;
  }

  add(s: number): void {
    if (s > 0xffff) return;
    if (this.total >= 0x1fff) {
      let t = 0;
      for (let i = 0; i < this.counts.length; i++) {
        this.counts[i] >>= 1;
        t += this.counts[i];
      }
      this.counts[0] += 1;
      this.total = t + 1;
    }
    while (this.counts.length <= s) this.counts.push(0);
    this.counts[s]++;
    this.total++;
  }
}

/** Zápisová strana CIFXBitStreamX. */
export class U3DBitWriter {
  private buf = new Uint8Array(256);
  private bitPos = 0;
  private low = 0;
  private high = 0xffff;
  private underflow = 0;
  private compressed = false;
  private readonly hist = new Map<number, NaiveHistogram>();
  private readonly f32 = new DataView(new ArrayBuffer(8));

  constructor(private readonly noCompression = false) {}

  private writeBit(bit: number): void {
    const byte = this.bitPos >>> 3;
    if (byte + 8 >= this.buf.length) {
      const b = new Uint8Array(this.buf.length * 2);
      b.set(this.buf);
      this.buf = b;
    }
    if (bit & 1) this.buf[byte] |= 1 << (this.bitPos & 7);
    this.bitPos++;
  }

  private histogram(ctx: number): NaiveHistogram {
    let h = this.hist.get(ctx);
    if (!h) {
      h = new NaiveHistogram();
      this.hist.set(ctx, h);
    }
    return h;
  }

  /** Společný konec WriteSymbolContextStatic / Dynamic: výstup bitů a podtečení. */
  private emit(cum: number, freq: number, total: number): void {
    const range = this.high + 1 - this.low;
    this.high = this.low - 1 + Math.floor((range * (cum + freq)) / total);
    this.low = this.low + Math.floor((range * cum) / total);
    let bit = this.low >> 15;
    while ((this.high & HALF) === (this.low & HALF)) {
      this.high &= ~HALF;
      this.high += this.high + 1;
      this.writeBit(bit);
      while (this.underflow > 0) {
        this.underflow--;
        this.writeBit(~bit & 1);
      }
      this.low &= ~HALF;
      this.low += this.low;
      bit = this.low >> 15;
    }
    while ((this.high & QUARTER) === 0 && (this.low & QUARTER) === QUARTER) {
      this.high &= ~HALF;
      this.high <<= 1;
      this.low <<= 1;
      this.high |= HALF;
      this.high |= 1;
      this.low &= ~HALF;
      this.low &= 0xffff;
      this.high &= 0xffff;
      this.underflow++;
    }
  }

  private writeStatic(ctx: number, value: number): boolean {
    const n = ctx - AC_STATIC_FULL;
    let cum = value - 1;
    let escape = false;
    if (value > n) {
      cum = 0;
      escape = true;
    }
    this.emit(cum, 1, n);
    return escape;
  }

  private writeDynamic(ctx: number, value: number): boolean {
    const h = this.histogram(ctx);
    const total = h.total;
    let cum = h.cum(value);
    let freq = h.freq(value);
    if (freq === 0) {
      value = 0;
      cum = h.cum(0);
      freq = h.freq(0);
    }
    this.emit(cum, freq, total);
    h.add(value);
    return value === 0;
  }

  private writeSymbol(ctx: number, value: number): boolean {
    if (ctx === 0) {
      // WriteSymbolContext8: v počátečním stavu surových 8 bitů, jinak statický kontext 256 symbolů
      if (this.high === 0xffff && this.low === 0 && this.underflow === 0) {
        const bits = swapBits8(value & 0xff);
        for (let i = 0; i < 8; i++) this.writeBit((bits >> i) & 1);
        return false;
      }
      return this.writeStatic(AC_STATIC_FULL + 256, value + 1);
    }
    if (ctx > AC_STATIC_FULL) return this.writeStatic(ctx, value);
    return this.writeDynamic(ctx, value);
  }

  writeU8(v: number): void {
    this.writeSymbol(0, swapBits8(v & 0xff));
  }

  writeU16(v: number): void {
    this.writeU8(v & 0xff);
    this.writeU8((v >>> 8) & 0xff);
  }

  writeU32(v: number): void {
    this.writeU16(v & 0xffff);
    this.writeU16((v >>> 16) & 0xffff);
  }

  writeF32(v: number): void {
    this.f32.setFloat32(0, v, true);
    this.writeU32(this.f32.getUint32(0, true));
  }

  writeF64(v: number): void {
    this.f32.setFloat64(0, v, true);
    this.writeU32(this.f32.getUint32(0, true));
    this.writeU32(this.f32.getUint32(4, true));
  }

  writeString(s: string): void {
    const bytes = new TextEncoder().encode(s);
    this.writeU16(bytes.length);
    for (const b of bytes) this.writeU8(b);
  }

  private writeCompressed(ctx: number, v: number, raw: (v: number) => void): void {
    if (this.noCompression) {
      raw(v);
      return;
    }
    this.compressed = true;
    if (ctx !== 0 && ctx < AC_MAX_RANGE) {
      const escape = this.writeSymbol(ctx, (v + 1) >>> 0);
      if (escape) {
        raw(v);
        if (ctx <= AC_STATIC_FULL) this.histogram(ctx).add((v + 1) >>> 0);
      }
    } else {
      raw(v);
    }
  }

  writeCompressedU32(ctx: number, v: number): void {
    this.writeCompressed(ctx, v, (x) => this.writeU32(x));
  }

  writeCompressedU16(ctx: number, v: number): void {
    this.writeCompressed(ctx, v, (x) => this.writeU16(x));
  }

  writeCompressedU8(ctx: number, v: number): void {
    this.writeCompressed(ctx, v, (x) => this.writeU8(x));
  }

  /** GetDataBlockX: po komprimovaných datech zapíše U32 0, zarovná na bajt a vrátí data. */
  finish(): Uint8Array {
    if (this.compressed) {
      this.writeU32(0);
      this.compressed = false;
    }
    return this.buf.slice(0, (this.bitPos + 7) >>> 3);
  }
}

// ───────────────────────────── bloky ─────────────────────────────

function concat(parts: Uint8Array[]): Uint8Array {
  const out = new Uint8Array(parts.reduce((s, p) => s + p.length, 0));
  let o = 0;
  for (const p of parts) {
    out.set(p, o);
    o += p.length;
  }
  return out;
}

/** Blok: typ, velikost dat, velikost metadat (0), data + zarovnání na 4 bajty. */
export function u3dBlock(type: number, data: Uint8Array): Uint8Array {
  const pad = (4 - (data.length & 3)) & 3;
  const out = new Uint8Array(12 + data.length + pad);
  const dv = new DataView(out.buffer);
  dv.setUint32(0, type >>> 0, true);
  dv.setUint32(4, data.length, true);
  dv.setUint32(8, 0, true);
  out.set(data, 12);
  return out;
}

export type Mat4 = number[];
export const IDENTITY: Mat4 = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];

export interface TestNode {
  name: string;
  kind: "group" | "model";
  parents: { name: string; matrix: Mat4 }[];
  /** Model: jméno zdroje (CLOD síť / line set). */
  resource?: string;
  /** Model: seznamy shaderů pro shading modifikátor (index = ID stínování sítě). */
  shaderLists?: string[][];
  visibility?: number;
}

export interface TestFace {
  shading: number;
  p: [number, number, number];
  n?: [number, number, number];
}

/** Jeden krok progresivního rozdělení vrcholu (nová pozice má index = aktuální rozlišení). */
export interface TestSplit {
  split: number;
  position: [number, number, number];
  newFaces: { shading: number; orientation: 1 | 2; third: number }[];
  /** Indexy existujících ploch u dělené pozice, které se posunou na novou pozici. */
  moveFaces?: number[];
}

export interface TestMesh {
  name: string;
  shadingCount: number;
  excludeNormals?: boolean;
  /** Základní síť (blok 0xFFFFFF3B); může být prázdná. */
  positions: [number, number, number][];
  normals?: [number, number, number][];
  faces: TestFace[];
  /** Progresivní kroky (blok 0xFFFFFF3C). */
  splits?: TestSplit[];
  /** Inverzní kvantizace pozic (krok mřížky). */
  positionIQ?: number;
}

export interface TestScene {
  noCompression?: boolean;
  /** Měřítko jednotek (metry na jednotku) — zapne profil „defined units". */
  units?: number;
  nodes: TestNode[];
  meshes: TestMesh[];
  shaders: { name: string; material: string }[];
  materials: { name: string; diffuse: [number, number, number]; opacity?: number }[];
}

function stringBytes(name: string, noCompression: boolean): Uint8Array {
  const w = new U3DBitWriter(noCompression);
  w.writeString(name);
  return w.finish();
}

/** Řetězec modifikátorů (0xFFFFFF14) s vnořenými bloky. */
function modifierChain(name: string, type: number, blocks: Uint8Array[], nc: boolean): Uint8Array {
  const w = new U3DBitWriter(nc);
  w.writeString(name);
  w.writeU32(type);
  w.writeU32(0); // atributy (bez obalových těles)
  const nameLen = stringBytes(name, nc).length - 2;
  const pad = (4 - ((2 + nameLen) & 3)) & 3;
  for (let i = 0; i < pad; i++) w.writeU8(0);
  w.writeU32(blocks.length);
  return u3dBlock(0xffffff14, concat([w.finish(), ...blocks]));
}

function nodeBlock(n: TestNode, nc: boolean): Uint8Array {
  const w = new U3DBitWriter(nc);
  w.writeString(n.name);
  w.writeU32(n.parents.length);
  for (const p of n.parents) {
    w.writeString(p.name);
    for (const v of p.matrix) w.writeF32(v);
  }
  if (n.kind === "model") {
    w.writeString(n.resource ?? "");
    w.writeU32(n.visibility ?? 3);
    return u3dBlock(0xffffff22, w.finish());
  }
  return u3dBlock(0xffffff21, w.finish());
}

function shadingBlock(n: TestNode, nc: boolean): Uint8Array {
  const w = new U3DBitWriter(nc);
  w.writeString(n.name);
  w.writeU32(1); // pozice v řetězci
  w.writeU32(1); // atributy: sítě
  const lists = n.shaderLists ?? [];
  w.writeU32(lists.length);
  for (const l of lists) {
    w.writeU32(l.length);
    for (const s of l) w.writeString(s);
  }
  return u3dBlock(0xffffff45, w.finish());
}

function shaderBlock(name: string, material: string, nc: boolean): Uint8Array {
  const w = new U3DBitWriter(nc);
  w.writeString(name);
  w.writeU32(1); // osvětlení zapnuto
  w.writeF32(0); // alpha test reference
  w.writeU32(0x617); // alpha test function (ALWAYS)
  w.writeU32(0x604); // color blend function
  w.writeU32(1); // render pass
  w.writeU32(0); // texturové kanály
  w.writeU32(0); // alfa kanály textur
  w.writeString(material);
  return u3dBlock(0xffffff53, w.finish());
}

function materialBlock(m: TestScene["materials"][number], nc: boolean): Uint8Array {
  const w = new U3DBitWriter(nc);
  w.writeString(m.name);
  w.writeU32(0x3f);
  const rgb = (c: [number, number, number]) => c.forEach((v) => w.writeF32(v));
  rgb([0.1, 0.1, 0.1]);
  rgb(m.diffuse);
  rgb([0.2, 0.2, 0.2]);
  rgb([0, 0, 0]);
  w.writeF32(0.1);
  w.writeF32(m.opacity ?? 1);
  return u3dBlock(0xffffff54, w.finish());
}

function maxCounts(m: TestMesh) {
  const splits = m.splits ?? [];
  const positions = m.positions.length + splits.length;
  const faces = m.faces.length + splits.reduce((s, x) => s + x.newFaces.length, 0);
  return { positions, faces };
}

function clodDeclaration(m: TestMesh, nc: boolean): Uint8Array {
  const w = new U3DBitWriter(nc);
  const { positions, faces } = maxCounts(m);
  w.writeString(m.name);
  w.writeU32(0); // chain index
  w.writeU32(m.excludeNormals ? 1 : 0);
  w.writeU32(faces);
  w.writeU32(positions);
  w.writeU32(m.excludeNormals ? 0 : 3 * faces);
  w.writeU32(0);
  w.writeU32(0);
  w.writeU32(0);
  w.writeU32(m.shadingCount);
  for (let i = 0; i < m.shadingCount; i++) {
    w.writeU32(0); // bez barev vrcholů
    w.writeU32(0); // bez texturových vrstev
    w.writeU32(i); // původní ID shaderu
  }
  w.writeU32(m.positions.length); // minimální rozlišení
  w.writeU32(positions); // konečné maximální rozlišení
  for (let i = 0; i < 3; i++) w.writeU32(1000);
  w.writeF32(m.positionIQ ?? 0.001);
  w.writeF32(1 / 16384); // normály
  w.writeF32(1 / 16384); // texturové souřadnice
  w.writeF32(1 / 16384); // difuzní barvy
  w.writeF32(1 / 16384); // spekulární barvy
  w.writeF32(0.9); // crease
  w.writeF32(0.5); // update
  w.writeF32(0.985); // tolerance
  w.writeU32(0); // kosti
  return u3dBlock(0xffffff31, w.finish());
}

/** Základní síť — CIFXAuthorCLODEncoderX_S. */
function clodBase(m: TestMesh, nc: boolean): Uint8Array {
  const w = new U3DBitWriter(nc);
  const P = m.positions.length;
  const N = m.excludeNormals ? 0 : (m.normals?.length ?? 0);
  w.writeString(m.name);
  w.writeU32(0);
  w.writeU32(m.faces.length);
  w.writeU32(P);
  w.writeU32(N);
  w.writeU32(0);
  w.writeU32(0);
  w.writeU32(0);
  for (const p of m.positions) p.forEach((v) => w.writeF32(v));
  if (N) for (const n of m.normals!) n.forEach((v) => w.writeF32(v));
  for (const f of m.faces) {
    w.writeCompressedU32(1, f.shading);
    for (let c = 0; c < 3; c++) {
      w.writeCompressedU32(AC_STATIC_FULL + P, f.p[c]);
      if (!m.excludeNormals) w.writeCompressedU32(AC_STATIC_FULL + N, f.n?.[c] ?? 0);
    }
  }
  return u3dBlock(0xffffff3b, w.finish());
}

/** Sestupně seřazené prvky množiny (pořadí CIFXSetX — „větší index první"). */
const desc = (set: Iterable<number>) => [...set].sort((x, y) => y - x);

/**
 * Progresivní blok — zrcadlí CIFXAuthorCLODEncoderX_P pro scénář bez barev a textur.
 * Rozhodnutí kodéru (dělená pozice, posunuté plochy, orientace) předepisuje test; kontexty
 * (lokální/globální třetí index, predikce zůstat/posunout, okolí pro normály) se počítají
 * stejně jako v referenci. Normály: jedna nová normála na pozici s nulovým rozdílem od predikce.
 */
function clodProgressive(m: TestMesh, nc: boolean): Uint8Array {
  const w = new U3DBitWriter(nc);
  const splits = m.splits ?? [];
  const faces: number[][] = m.faces.map((f) => [...f.p]);
  const recon: number[][] = m.positions.map((p) => p.map((v) => Math.fround(v)));
  const adj = new Map<number, Set<number>>();
  const adjOf = (p: number) => {
    let set = adj.get(p);
    if (!set) {
      set = new Set();
      adj.set(p, set);
    }
    return set;
  };
  faces.forEach((f, i) => f.forEach((p) => adjOf(p).add(i)));
  const iq = Math.fround(m.positionIQ ?? 0.001);
  const start = m.positions.length;

  w.writeString(m.name);
  w.writeU32(0);
  w.writeU32(start);
  w.writeU32(start + splits.length);
  splits.forEach((s, k) => {
    const res = start + k;
    const split = s.split;
    w.writeCompressedU32(AC_STATIC_FULL + res, split);
    const splitFaces = desc(adjOf(split));
    const cSet = new Set<number>();
    for (const f of splitFaces) faces[f].forEach((p) => cSet.add(p));
    cSet.delete(split);
    const setC = desc(cSet);
    w.writeCompressedU16(99, 0);
    w.writeCompressedU16(101, 0);
    w.writeCompressedU16(123, 0);
    w.writeCompressedU32(1, s.newFaces.length);
    const left = new Set<number>();
    const right = new Set<number>();
    const F0 = faces.length;
    for (const nf of s.newFaces) {
      w.writeCompressedU32(65, nf.shading);
      w.writeCompressedU8(2, nf.orientation);
      const li = setC.indexOf(nf.third);
      if (li >= 0) {
        w.writeCompressedU8(3, 1);
        w.writeCompressedU32(4, li);
      } else {
        w.writeCompressedU8(3, 2);
        w.writeCompressedU32(AC_STATIC_FULL + res, nf.third);
        setC.push(nf.third);
        setC.sort((x, y) => y - x);
      }
      if (nf.orientation === 1) {
        left.add(nf.third);
        faces.push([split, res, nf.third]);
      } else {
        right.add(nf.third);
        faces.push([res, split, nf.third]);
      }
    }
    // zůstat / posunout
    const moves = new Set(s.moveFaces ?? []);
    const movePos = new Set<number>();
    const stayPos = new Set<number>();
    const moveFaces: number[] = [];
    for (const f of splitFaces) {
      const [a, b, c] = faces[f];
      let pred = 0;
      const [x, y] = split === a ? [b, c] : split === b ? [c, a] : split === c ? [a, b] : [-1, -1];
      if (x >= 0) {
        if (right.has(x)) pred = 1;
        else if (right.has(y)) pred = 2;
        else if (left.has(x)) pred = 2;
        else if (left.has(y)) pred = 1;
      }
      if (pred === 0 && [a, b, c].some((p) => movePos.has(p))) pred = 3;
      if (pred === 0 && [a, b, c].some((p) => stayPos.has(p))) pred = 4;
      const move = moves.has(f);
      w.writeCompressedU8(15 + pred, move ? 1 : 0);
      const target = move ? movePos : stayPos;
      [a, b, c].forEach((p) => target.add(p));
      target.delete(split);
      if (move) moveFaces.push(f);
    }
    // sousednost (G, H)
    for (const f of moveFaces) {
      adjOf(split).delete(f);
      adjOf(res).add(f);
    }
    for (let j = F0; j < faces.length; j++) faces[j].forEach((p) => adjOf(p).add(j));
    // okolí nové pozice (posunuté plochy mají ještě dělenou pozici)
    const jSet = new Set<number>();
    for (const f of adjOf(res)) faces[f].forEach((p) => jSet.add(p));
    const setJ = desc(jSet);
    // pozice
    const pred = res > 0 ? recon[split] : [0, 0, 0];
    let signs = 0;
    const mags: number[] = [];
    for (let k2 = 0; k2 < 3; k2++) {
      const d = s.position[k2] - pred[k2];
      if (d < 0) signs |= 1 << k2;
      mags.push(Math.floor(0.5 + Math.abs(d) / iq));
    }
    w.writeCompressedU8(20, signs);
    mags.forEach((v, k2) => w.writeCompressedU32(21 + k2, v));
    recon.push(
      mags.map((v, k2) => {
        const q = Math.fround(iq * Math.fround(v));
        return Math.fround(pred[k2] + (signs & (1 << k2) ? -q : q));
      }),
    );
    for (const f of moveFaces) {
      const c = faces[f].indexOf(split);
      if (c >= 0) faces[f][c] = res;
    }
    // normály
    if (!m.excludeNormals) {
      for (const p of setJ) {
        const count = adjOf(p).size;
        w.writeCompressedU32(40, 1);
        w.writeCompressedU8(41, 0);
        w.writeCompressedU32(42, 0);
        w.writeCompressedU32(43, 0);
        w.writeCompressedU32(44, 0);
        for (let q = 0; q < count; q++) w.writeCompressedU32(45, 0);
      }
    }
  });
  return u3dBlock(0xffffff3c, w.finish());
}

/** Zakóduje testovací scénu do souboru U3D. */
export function encodeTestU3D(scene: TestScene): Uint8Array {
  const nc = !!scene.noCompression;
  const decl: Uint8Array[] = [];
  const cont: Uint8Array[] = [];
  for (const n of scene.nodes) {
    const inner = [nodeBlock(n, nc)];
    if (n.kind === "model" && n.shaderLists) inner.push(shadingBlock(n, nc));
    decl.push(modifierChain(n.name, 0, inner, nc));
  }
  for (const m of scene.meshes) {
    decl.push(modifierChain(m.name, 1, [clodDeclaration(m, nc)], nc));
    if (m.positions.length || m.faces.length) cont.push(clodBase(m, nc));
    if (m.splits?.length) cont.push(clodProgressive(m, nc));
  }
  for (const s of scene.shaders) decl.push(shaderBlock(s.name, s.material, nc));
  for (const m of scene.materials) decl.push(materialBlock(m, nc));

  const profile = (nc ? PROFILE_NO_COMPRESSION : 0) | (scene.units ? PROFILE_UNITS : 0);
  const headerData = (declSize: number, fileSize: number) => {
    const w = new U3DBitWriter(true);
    w.writeU32(0); // verze
    w.writeU32(profile);
    w.writeU32(declSize);
    w.writeU32(fileSize);
    w.writeU32(0); // horní polovina U64
    w.writeU32(106); // UTF-8
    if (scene.units) w.writeF64(scene.units);
    return u3dBlock(0x00443355, w.finish());
  };
  const headerLen = headerData(0, 0).length;
  const declLen = headerLen + decl.reduce((s, b) => s + b.length, 0);
  const fileLen = declLen + cont.reduce((s, b) => s + b.length, 0);
  return concat([headerData(declLen, fileLen), ...decl, ...cont]);
}
