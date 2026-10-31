/**
 * Minimální zapisovač PRC — jen pro testy dekodéru (`prc.test.ts`), v aplikaci se nepoužívá.
 *
 * Rozvržení souboru zrcadlí zapisovač PRC z Asymptote (oPRCFile): nekomprimovaná hlavička se
 * seznamem souborových struktur, pro každou strukturu hlavička + zlib sekce globals (se
 * schématem), strom, tessellace, přesná geometrie a „extra" geometrie, a nakonec zlib modelový
 * soubor s kořeny sestavy. Uvnitř sekcí bitový proud PRC (UnsignedInteger, Integer,
 * komprimovaný Double, String…).
 *
 * Umí jen to, co testy potřebují: barvy, materiály a styly, díly s položkami PolyBrepModel /
 * PolyWire / Set / BrepModel, výskyty produktů s transformací a jednotkou, TESS_3D s plochami
 * (trojúhelníky, vějíře, pásy, varianty s jednou normálou) a TESS_3D_Wire.
 */

import { zlibSync } from "fflate";
import { PRC_EXPONENT_RUNS, PRC_FREQUENT_DOUBLES } from "./prc-double-table";

// ---------------------------------------------------------------------------
// Bitový zapisovač
// ---------------------------------------------------------------------------

let exponentCodes: Map<number, { len: number; code: number }> | null = null;
let frequentCodes: Map<string, { len: number; code: number }> | null = null;

function doubleCodes() {
  if (!exponentCodes || !frequentCodes) {
    exponentCodes = new Map();
    for (let i = 0; i < PRC_EXPONENT_RUNS.length; i += 4) {
      const [e0, len, c0, n] = PRC_EXPONENT_RUNS.slice(i, i + 4);
      for (let k = 0; k < n; k++) exponentCodes.set(e0 + k, { len, code: c0 + k });
    }
    frequentCodes = new Map();
    for (let i = 0; i < PRC_FREQUENT_DOUBLES.length; i += 4) {
      const [len, code, hi, lo] = PRC_FREQUENT_DOUBLES.slice(i, i + 4);
      frequentCodes.set(`${hi >>> 0}:${lo >>> 0}`, { len, code });
    }
  }
  return { exponentCodes, frequentCodes };
}

const dv = new DataView(new ArrayBuffer(8));

export class PrcBitWriter {
  private bytes: number[] = [];
  private cur = 0;
  private nbits = 0;

  get bitLength(): number {
    return this.bytes.length * 8 + this.nbits;
  }

  bit(b: number | boolean): this {
    this.cur = (this.cur << 1) | (b ? 1 : 0);
    if (++this.nbits === 8) {
      this.bytes.push(this.cur);
      this.cur = 0;
      this.nbits = 0;
    }
    return this;
  }

  bits(value: number, n: number): this {
    for (let i = n - 1; i >= 0; i--) this.bit(Math.floor(value / 2 ** i) % 2);
    return this;
  }

  char(v: number): this {
    return this.bits(v & 0xff, 8);
  }

  uint(v: number): this {
    let x = v >>> 0;
    while (x !== 0) {
      this.bit(1).char(x & 0xff);
      x = x >>> 8;
    }
    return this.bit(0);
  }

  int(v: number): this {
    let x = v | 0;
    if (x === 0) return this.bit(0);
    for (;;) {
      const byte = x & 0xff;
      this.bit(1).char(byte);
      x >>= 8;
      if ((x === 0 && (byte & 0x80) === 0) || (x === -1 && (byte & 0x80) !== 0)) break;
    }
    return this.bit(0);
  }

  double(v: number): this {
    const { exponentCodes: ex, frequentCodes: fr } = doubleCodes();
    if (v === 0) return this.bits(1, 2); // kód nuly „01" (bez znaménka)
    dv.setFloat64(0, v);
    const hi = dv.getUint32(0);
    const lo = dv.getUint32(4);
    const neg = (hi & 0x80000000) !== 0;
    const absHi = hi & 0x7fffffff;
    const freq = fr.get(`${absHi >>> 0}:${lo >>> 0}`);
    if (freq) return this.bits(freq.code, freq.len).bit(neg);
    const e = absHi >>> 20;
    const ec = ex.get(e);
    if (!ec || e === 0x7ff) throw new Error(`double ${v} nelze zapsat`);
    this.bits(ec.code, ec.len).bit(neg);
    const mantissaHi = absHi & 0xfffff;
    if (mantissaHi === 0 && lo === 0) return this.bit(0);
    this.bit(1).bits(mantissaHi >>> 16, 4);
    // bajty mantisy 5..0 (od nejvyššího), každý zapsaný celý
    const mbytes = [lo & 0xff, (lo >>> 8) & 0xff, (lo >>> 16) & 0xff, (lo >>> 24) & 0xff, mantissaHi & 0xff, (mantissaHi >>> 8) & 0xff];
    for (let k = 5; k >= 0; k--) this.bit(1).char(mbytes[k]);
    return this;
  }

  string(s: string | null): this {
    if (s === null) return this.bit(0);
    const b = new TextEncoder().encode(s);
    this.bit(1).uint(b.length);
    for (const x of b) this.char(x);
    return this;
  }

  uint32(v: number): this {
    const x = v >>> 0;
    return this.char(x & 0xff)
      .char((x >>> 8) & 0xff)
      .char((x >>> 16) & 0xff)
      .char((x >>> 24) & 0xff);
  }

  /** IntegerWithVariableBitNumber (znaménko + n−1 bitů). */
  intVar(v: number, n: number): this {
    if (n <= 0) return this;
    return this.bit(v < 0).bits(Math.abs(v), n - 1);
  }

  /** CharacterArray bez komprese. */
  charArray(values: number[], hasCompBit = true): this {
    if (hasCompBit) this.bit(0);
    this.uint(values.length);
    for (const v of values) this.char(v);
    return this;
  }

  /**
   * CharacterArray komprimované Huffmanem (formát, který čte `BitReader.readHuffman`):
   * 32bitová slova, počet platných bitů posledního slova; v nich bity od nejnižšího.
   */
  huffmanCharArray(values: number[], numBits: number): this {
    const symbols = [...new Set(values)].sort((a, b) => a - b);
    // jednoduchý (ne optimální) prefixový kód: i-tý symbol = i jedniček a nula (poslední bez nuly)
    const codes = new Map<number, { len: number; code: number }>();
    symbols.forEach((s, i) => {
      const last = i === symbols.length - 1 && symbols.length > 1;
      const len = symbols.length === 1 ? 1 : last ? i : i + 1;
      const code = last ? 2 ** i - 1 : (2 ** i - 1) * 2;
      codes.set(s, { len: Math.max(1, len), code });
    });
    const maxLen = Math.max(...[...codes.values()].map((c) => c.len));
    const raw: number[] = [];
    const put = (v: number, n: number) => {
      for (let k = 0; k < n; k++) raw.push(Math.floor(v / 2 ** k) % 2);
    };
    put(symbols.length, numBits + 1);
    put(maxLen, 8);
    for (const s of symbols) {
      const c = codes.get(s)!;
      put(s, numBits);
      put(c.len, maxLen);
      put(c.code, c.len);
    }
    put(values.length, 32);
    for (const v of values) {
      const c = codes.get(v)!;
      for (let j = c.len - 1; j >= 0; j--) raw.push(Math.floor(c.code / 2 ** j) % 2);
    }
    const words = Math.max(1, Math.ceil(raw.length / 32));
    this.bit(1).uint(words);
    for (let w = 0; w < words; w++) {
      let word = 0;
      for (let k = 0; k < 32; k++) if (raw[w * 32 + k]) word += 2 ** k;
      this.uint32(word);
    }
    const lastBits = raw.length - (words - 1) * 32;
    return this.uint(lastBits);
  }

  /** CompressedIndiceArray (rozdílové hodnoty se šířkami jako 6bitové rozdíly). */
  compressedIndiceArray(values: number[], hasCompBit = true): this {
    const widthOf = (v: number) => {
      let n = 1;
      let a = Math.abs(v);
      while (a > 0) {
        n++;
        a = Math.floor(a / 2);
      }
      return n;
    };
    const widths: number[] = [];
    const deltas: number[] = [];
    let last = 0;
    values.forEach((v, i) => {
      const d = i === 0 ? v : v - values[i - 1];
      const w = widthOf(d);
      widths.push((i === 0 ? w : w - last) & 63);
      deltas.push(d);
      last = w;
    });
    this.charArray(widths, hasCompBit);
    let w = 0;
    deltas.forEach((d, i) => {
      w = i === 0 ? widths[0] : w + (widths[i] >= 32 ? widths[i] - 64 : widths[i]);
      this.intVar(d, w);
    });
    return this;
  }

  /** Doplní poslední bajt nulami a vrátí data. */
  finish(): Uint8Array {
    const out = this.bytes.slice();
    if (this.nbits) out.push(this.cur << (8 - this.nbits));
    return Uint8Array.from(out);
  }
}

// ---------------------------------------------------------------------------
// Popis testovacího modelu
// ---------------------------------------------------------------------------

export type Vec3 = [number, number, number];

/** Trojúhelníková data plochy; indexy jsou čísla bodů (ne souřadnic), normály čísla normál. */
export interface TestFace {
  /** Index stylu (do `styles` globals), nebo nic = bez vlastního stylu. */
  style?: number;
  triangles?: { p: Vec3; n?: Vec3 }[];
  fans?: { p: number[]; n?: number[] }[];
  strips?: { p: number[]; n?: number[] }[];
  /** Trojúhelníky s jednou normálou pro všechny tři rohy. */
  trianglesOneNormal?: { p: Vec3; n: number }[];
  /** Vějíře s jednou normálou (příznak NORMAL_Single). */
  fansOneNormal?: { p: number[]; n: number }[];
}

export interface TestMesh {
  kind: "mesh";
  /** Body xyz za sebou. */
  points: number[];
  /** Normály xyz za sebou (bez nich se zapíše „dopočítat normály"). */
  normals?: number[];
  faces: TestFace[];
  creaseAngle?: number;
}

export interface TestWire {
  kind: "wire";
  points: number[];
  /** Lomené čáry jako seznamy čísel bodů. */
  wires: { idx: number[]; closed?: boolean }[];
}

/**
 * TESS_3D_Compressed se dvěma trojúhelníky (čtyřúhelník P0 P1 P3 P2): první trojúhelník
 * (P0, P1, P2) je uložen přímo, druhý se „přiroste" přes hranu P1–P2 s novým vrcholem P3
 * v lokální soustavě hrany. Normály se dopočítávají (must_recalculate_normals).
 */
export interface TestCompressedQuad {
  kind: "compressedQuad";
  points: [Vec3, Vec3, Vec3, Vec3];
  tolerance: number;
}

export interface TestTransform {
  translate?: Vec3;
  /** Osy X a Y otočení (Z se dopočítá). */
  x?: Vec3;
  y?: Vec3;
  scale?: number;
}

export interface TestItem {
  type: "polyBrep" | "polyWire" | "set" | "brep";
  name?: string;
  style?: number;
  tess?: number;
  localCs?: number;
  children?: TestItem[];
}

export interface TestPart {
  name: string;
  style?: number;
  items: TestItem[];
}

export interface TestOccurrence {
  name: string;
  part?: number;
  sons?: number[];
  location?: TestTransform;
  style?: number;
  /** Chování grafiky (0x0001 = zobrazit…); výchozí 1. */
  behaviour?: number;
  unit?: number;
  unitFromCad?: boolean;
}

export interface TestMaterial {
  diffuse: number;
  ambient?: number;
  alpha?: number;
}

export interface TestStyle {
  /** Index barvy (pořadí v `colors`). */
  color?: number;
  /** Index materiálu (pořadí v `materials`). */
  material?: number;
  /** Průhlednost 0–255 (255 = neprůhledné). */
  transparency?: number;
}

export interface TestStructure {
  colors?: Vec3[];
  materials?: TestMaterial[];
  styles?: TestStyle[];
  coordSystems?: TestTransform[];
  parts?: TestPart[];
  occurrences?: TestOccurrence[];
  /** Kořenový výskyt (pro interní data struktury). */
  root?: number;
  tess?: (TestMesh | TestWire | TestCompressedQuad)[];
  /** Počet těles v sekci přesné geometrie (jen se zapíše počet). */
  brepBodies?: number;
  /** Uříznout zkomprimovaný strom na tento podíl délky (simulace poškození). */
  truncateTree?: number;
  /** Strom vůbec nezapsat. */
  omitTree?: boolean;
}

export interface TestPrc {
  structures: TestStructure[];
  unit?: number;
  unitFromCad?: boolean;
  /** Kořeny sestavy: struktura + výskyt (výchozí: kořen každé struktury se stromem). */
  roots?: { fs: number; po: number }[];
  version?: number;
}

// ---------------------------------------------------------------------------
// Entity
// ---------------------------------------------------------------------------

const T = {
  TESS_3D: 172,
  TESS_Face: 174,
  TESS_3D_Wire: 175,
  MISC_CartesianTransformation: 202,
  RI_BrepModel: 232,
  RI_PolyBrepModel: 237,
  RI_PolyWire: 238,
  RI_Set: 239,
  RI_CoordinateSystem: 240,
  ASM_ModelFile: 301,
  ASM_FileStructure: 302,
  ASM_FileStructureGlobals: 303,
  ASM_FileStructureTree: 304,
  ASM_FileStructureTessellation: 305,
  ASM_FileStructureGeometry: 306,
  ASM_FileStructureExtraGeometry: 307,
  ASM_ProductOccurrence: 310,
  ASM_PartDefinition: 311,
  GRAPH_Style: 701,
  GRAPH_Material: 702,
  GRAPH_LinePattern: 721,
} as const;

let uniqueId = 1;

function base(w: PrcBitWriter, name: string, ref: boolean): void {
  w.uint(0); // atributy
  w.bit(0).string(name); // jméno není „stejné jako aktuální"
  if (ref) w.uint(0).uint(0).uint(uniqueId++);
}

function baseWithGraphics(w: PrcBitWriter, name: string, style: number | undefined, behaviour = 1): void {
  base(w, name, true);
  w.bit(0).uint(0); // grafika není „stejná jako aktuální"; vrstva + 1
  w.uint(style === undefined ? 0 : style + 1);
  w.char(behaviour & 0xff).char((behaviour >> 8) & 0xff);
}

function cartesian(w: PrcBitWriter, t: TestTransform): void {
  w.uint(T.MISC_CartesianTransformation);
  let beh = 0;
  if (t.translate) beh |= 0x01;
  if (t.x || t.y) beh |= 0x02;
  if (t.scale !== undefined) beh |= 0x08;
  w.char(beh);
  if (t.translate) t.translate.forEach((v) => w.double(v));
  if (t.x || t.y) {
    (t.x ?? [1, 0, 0]).forEach((v) => w.double(v));
    (t.y ?? [0, 1, 0]).forEach((v) => w.double(v));
  }
  if (t.scale !== undefined) w.double(t.scale);
}

function writeItem(w: PrcBitWriter, it: TestItem): void {
  const type =
    it.type === "polyBrep"
      ? T.RI_PolyBrepModel
      : it.type === "polyWire"
        ? T.RI_PolyWire
        : it.type === "set"
          ? T.RI_Set
          : T.RI_BrepModel;
  w.uint(type);
  baseWithGraphics(w, it.name ?? "", it.style);
  w.uint(it.localCs === undefined ? 0 : it.localCs + 1);
  w.uint(it.tess === undefined ? 0 : it.tess + 1);
  if (type === T.RI_PolyBrepModel) w.bit(1); // uzavřené těleso
  if (type === T.RI_BrepModel) w.bit(0).bit(1); // bez kontextu B-rep, uzavřené
  if (type === T.RI_Set) {
    w.uint(it.children?.length ?? 0);
    for (const c of it.children ?? []) writeItem(w, c);
  }
  w.uint(0); // uživatelská data
}

function markupData(w: PrcBitWriter): void {
  w.uint(0).uint(0).uint(0).uint(0);
}

function writeGlobals(s: TestStructure): Uint8Array {
  const w = new PrcBitWriter();
  w.uint(0); // schéma: žádné typy
  w.uint(T.ASM_FileStructureGlobals);
  base(w, "", false);
  w.uint(0); // odkazované struktury
  w.double(0.001).double(0.1); // tolerance tessellace (délka, úhel)
  w.string(null).uint(0); // MarkupSerializationHelper
  const colors = s.colors ?? [];
  w.uint(colors.length);
  for (const c of colors) c.forEach((v) => w.double(v));
  w.uint(0); // obrázky
  w.uint(0); // definice textur
  const mats = s.materials ?? [];
  w.uint(mats.length);
  for (const m of mats) {
    w.uint(T.GRAPH_Material);
    base(w, "", true);
    const amb = m.ambient ?? m.diffuse;
    w.uint(amb * 3 + 1).uint(m.diffuse * 3 + 1).uint(0).uint(0);
    w.double(0.5).double(1).double(m.alpha ?? 1).double(1).double(1);
  }
  w.uint(1); // jeden vzor čáry (plná)
  w.uint(T.GRAPH_LinePattern);
  base(w, "", true);
  w.uint(0).double(0).bit(0);
  const styles = s.styles ?? [];
  w.uint(styles.length);
  for (const st of styles) {
    w.uint(T.GRAPH_Style);
    base(w, "", true);
    w.double(0).bit(0).uint(1); // šířka čáry, vzor = 1
    if (st.material !== undefined) w.bit(1).uint(st.material + 1);
    else w.bit(0).uint(st.color === undefined ? 0 : st.color * 3 + 1);
    if (st.transparency !== undefined) w.bit(1).char(st.transparency);
    else w.bit(0);
    w.bit(0).bit(0).bit(0);
  }
  w.uint(0); // výplně
  const cs = s.coordSystems ?? [];
  w.uint(cs.length);
  for (const c of cs) {
    w.uint(T.RI_CoordinateSystem);
    baseWithGraphics(w, "", undefined);
    w.uint(0).uint(0);
    cartesian(w, c);
    w.uint(0);
  }
  w.uint(0); // uživatelská data
  return w.finish();
}

function writeTree(s: TestStructure): Uint8Array {
  const w = new PrcBitWriter();
  w.uint(T.ASM_FileStructureTree);
  base(w, "", false);
  const parts = s.parts ?? [];
  w.uint(parts.length);
  for (const p of parts) {
    w.uint(T.ASM_PartDefinition);
    baseWithGraphics(w, p.name, p.style);
    for (let i = 0; i < 6; i++) w.double(0); // obálka
    w.uint(p.items.length);
    for (const it of p.items) writeItem(w, it);
    markupData(w);
    w.uint(0); // pohledy
    w.uint(0); // uživatelská data
  }
  const pos = s.occurrences ?? [];
  w.uint(pos.length);
  for (const po of pos) {
    w.uint(T.ASM_ProductOccurrence);
    baseWithGraphics(w, po.name, po.style, po.behaviour ?? 1);
    w.uint(po.part === undefined ? 0 : po.part + 1);
    w.uint(0); // prototyp
    w.uint(0); // externí data
    w.uint(po.sons?.length ?? 0);
    for (const son of po.sons ?? []) w.uint(son);
    w.char(0); // chování produktu
    w.bit(po.unitFromCad ?? false).double(po.unit ?? 1);
    w.char(0).int(0); // příznaky, stav načtení
    if (po.location) {
      w.bit(1);
      cartesian(w, po.location);
    } else w.bit(0);
    w.uint(0); // odkazy na entity
    markupData(w);
    w.uint(0); // pohledy
    w.bit(0); // filtr
    w.uint(0).uint(0); // filtry zobrazení, parametry scény
    w.uint(0); // uživatelská data
  }
  w.uint(T.ASM_FileStructure);
  base(w, "", false);
  w.uint(uniqueId);
  w.uint((s.root ?? 0) + 1);
  w.uint(0); // uživatelská data
  return w.finish();
}

function writeMesh(w: PrcBitWriter, m: TestMesh): void {
  w.uint(T.TESS_3D);
  w.bit(0).uint(m.points.length);
  for (const v of m.points) w.double(v);
  const hasNormals = !!m.normals;
  w.bit(1).bit(0); // has_faces, has_loops
  if (!hasNormals) w.bit(1).char(0).double(m.creaseAngle ?? 25);
  else w.bit(0);
  const normals = m.normals ?? [];
  w.uint(normals.length);
  for (const v of normals) w.double(v);
  w.uint(0); // drátové indexy
  // indexy trojúhelníků: u každého rohu (normála ×3,) bod ×3
  const idx: number[] = [];
  const faceInfo: { used: number; start: number; sizes: number[]; style?: number }[] = [];
  const corner = (p: number, n: number | undefined) => {
    if (hasNormals) idx.push((n ?? 0) * 3);
    idx.push(p * 3);
  };
  for (const f of m.faces) {
    const start = idx.length;
    let used = 0;
    const sizes: number[] = [];
    if (f.triangles?.length) {
      used |= 0x0002;
      sizes.push(f.triangles.length);
      for (const t of f.triangles) for (let k = 0; k < 3; k++) corner(t.p[k], t.n?.[k]);
    }
    if (f.fans?.length) {
      used |= 0x0004;
      sizes.push(f.fans.length, ...f.fans.map((g) => g.p.length));
      for (const g of f.fans) g.p.forEach((p, k) => corner(p, g.n?.[k]));
    }
    if (f.strips?.length) {
      used |= 0x0008;
      sizes.push(f.strips.length, ...f.strips.map((g) => g.p.length));
      for (const g of f.strips) g.p.forEach((p, k) => corner(p, g.n?.[k]));
    }
    if (f.trianglesOneNormal?.length) {
      used |= 0x0020;
      sizes.push(f.trianglesOneNormal.length);
      for (const t of f.trianglesOneNormal) {
        if (hasNormals) idx.push(t.n * 3);
        for (const p of t.p) idx.push(p * 3);
      }
    }
    if (f.fansOneNormal?.length) {
      used |= 0x0040;
      sizes.push(f.fansOneNormal.length, ...f.fansOneNormal.map((g) => (g.p.length | 0x40000000) >>> 0));
      for (const g of f.fansOneNormal) {
        if (hasNormals) idx.push(g.n * 3);
        for (const p of g.p) idx.push(p * 3);
      }
    }
    faceInfo.push({ used, start, sizes, style: f.style });
  }
  w.uint(idx.length);
  for (const v of idx) w.uint(v);
  w.uint(faceInfo.length);
  for (const f of faceInfo) {
    w.uint(T.TESS_Face);
    if (f.style !== undefined) w.uint(1).uint(f.style + 1);
    else w.uint(0);
    w.uint(0).uint(0); // začátek drátu, velikosti drátů
    w.uint(f.used).uint(f.start);
    w.uint(f.sizes.length);
    for (const s of f.sizes) w.uint(s);
    w.uint(0); // texturové souřadnice na roh
    w.bit(0); // barvy vrcholů
    if (f.style !== undefined) w.uint(1); // chování
  }
  w.uint(0); // texturové souřadnice
}

function writeWire(w: PrcBitWriter, m: TestWire): void {
  w.uint(T.TESS_3D_Wire);
  w.bit(0).uint(m.points.length);
  for (const v of m.points) w.double(v);
  const idx: number[] = [];
  for (const wire of m.wires) {
    idx.push(((wire.idx.length | (wire.closed ? 0x10000000 : 0)) >>> 0));
    for (const p of wire.idx) idx.push(p * 3);
  }
  w.uint(idx.length);
  for (const v of idx) w.uint(v);
  w.bit(0); // barvy vrcholů
}

function widthOfInt(v: number): number {
  let n = 1;
  let a = Math.abs(v);
  while (a > 0) {
    n++;
    a = Math.floor(a / 2);
  }
  return n;
}

function writeCompressedQuad(w: PrcBitWriter, q: TestCompressedQuad): void {
  const tol = q.tolerance;
  const [P0, P1, P2, P3] = q.points;
  const r = (v: number) => Math.round(v / tol);
  // kódování s návratem chyby: další body se počítají z už zaokrouhlených (dekódovaných) poloh
  const i0 = P0.map(r) as Vec3;
  const D0 = i0.map((v) => v * tol) as Vec3;
  const i1 = P1.map((v, k) => r(v - D0[k])) as Vec3;
  const D1 = i1.map((v, k) => v * tol + D0[k]) as Vec3;
  const i2 = P2.map((v, k) => r(v - (D0[k] + D1[k]) / 2)) as Vec3;
  const D2 = i2.map((v, k) => v * tol + (D0[k] + D1[k]) / 2) as Vec3;
  // soustava hrany (P1, P2) s protilehlým vrcholem P0 — jako ve specifikaci
  const sub = (a: Vec3, b: Vec3): Vec3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
  const dot = (a: Vec3, b: Vec3) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
  const cross = (a: Vec3, b: Vec3): Vec3 => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
  const norm = (a: Vec3): Vec3 => {
    const l = Math.hypot(a[0], a[1], a[2]);
    return [a[0] / l, a[1] / l, a[2] / l];
  };
  const O: Vec3 = [(D1[0] + D2[0]) / 2, (D1[1] + D2[1]) / 2, (D1[2] + D2[2]) / 2];
  const X = norm(sub(D1, D2));
  let Z = norm(cross(sub(D0, O), X));
  let Y = norm(cross(Z, X));
  if (dot(Y, sub(O, D0)) > 0) {
    Y = [-Y[0], -Y[1], -Y[2]];
    Z = [-Z[0], -Z[1], -Z[2]];
  }
  const d = sub(P3, O);
  const i3: Vec3 = [r(dot(d, X)), r(dot(d, Y)), r(dot(d, Z))];
  const values = [...i0, ...i1, ...i2, ...i3];

  w.uint(173); // TESS_3D_Compressed
  w.bit(0).bit(1); // is_calculated, has_faces
  w.double(tol);
  const f = new DataView(new ArrayBuffer(4));
  for (let k = 0; k < 3; k++) {
    f.setFloat32(0, 0, true);
    for (let b = 0; b < 4; b++) w.char(f.getUint8(b));
  }
  // point_array: šířky + hodnoty
  const widths = values.map(widthOfInt);
  w.charArray(widths);
  values.forEach((v, k) => w.intVar(v, widths[k]));
  w.charArray([1, 0]); // edge_status: první trojúhelník má otevřenou pravou hranu
  w.compressedIndiceArray([0, 0]); // triangle_face_array
  w.uint(4).bit(0).bit(0).bit(0).bit(0); // point_is_a_reference (3 + 1)
  w.uint(0); // point_reference_array (prázdné, bez příznaku komprese)
  w.bit(1); // must_recalculate_normals
  w.bit(0).bit(1); // normal_is_reversed: druhý trojúhelník je otočený
  w.double(25).char(0); // úhel vyhlazení, rezervováno
  w.bit(0); // barvy bodů
  w.bit(0); // více atributů čar
  w.bit(0).uint(0); // line_attributes (prázdné)
  w.bit(1); // bez textur
  w.bit(0); // chování
}

function writeTessellation(s: TestStructure): Uint8Array {
  const w = new PrcBitWriter();
  w.uint(T.ASM_FileStructureTessellation);
  base(w, "", false);
  const tess = s.tess ?? [];
  w.uint(tess.length);
  for (const t of tess) {
    if (t.kind === "mesh") writeMesh(w, t);
    else if (t.kind === "wire") writeWire(w, t);
    else writeCompressedQuad(w, t);
  }
  w.uint(0); // uživatelská data
  return w.finish();
}

function writeGeometry(s: TestStructure): Uint8Array {
  const w = new PrcBitWriter();
  w.uint(T.ASM_FileStructureGeometry);
  base(w, "", false);
  w.uint(s.brepBodies ?? 0);
  w.uint(0);
  return w.finish();
}

function writeExtraGeometry(): Uint8Array {
  const w = new PrcBitWriter();
  w.uint(T.ASM_FileStructureExtraGeometry);
  base(w, "", false);
  w.uint(0).uint(0);
  return w.finish();
}

function writeModelFile(m: TestPrc, uuids: number[][]): Uint8Array {
  const w = new PrcBitWriter();
  w.uint(0); // schéma
  w.uint(T.ASM_ModelFile);
  base(w, "model", false);
  w.bit(m.unitFromCad ?? false).double(m.unit ?? 1);
  const roots = m.roots ?? m.structures.map((s, fs) => ({ fs, po: s.root ?? 0 })).filter((r) => (m.structures[r.fs].occurrences?.length ?? 0) > 0);
  w.uint(roots.length);
  for (const r of roots) {
    for (const u of uuids[r.fs]) w.uint(u);
    w.uint(r.po + 1);
    w.bit(1);
  }
  w.uint(0);
  return w.finish();
}

// ---------------------------------------------------------------------------
// Soubor
// ---------------------------------------------------------------------------

class ByteWriter {
  bytes: number[] = [];
  u32(v: number): this {
    const x = v >>> 0;
    this.bytes.push(x & 0xff, (x >>> 8) & 0xff, (x >>> 16) & 0xff, (x >>> 24) & 0xff);
    return this;
  }
  raw(b: ArrayLike<number>): this {
    for (let i = 0; i < b.length; i++) this.bytes.push(b[i]);
    return this;
  }
  get length(): number {
    return this.bytes.length;
  }
}

/** Sestaví celý PRC soubor podle popisu. */
export function writePrc(m: TestPrc): Uint8Array {
  uniqueId = 1; // výstup je deterministický (stejný popis → stejné bajty)
  const version = m.version ?? 8137;
  const uuids = m.structures.map((_, i) => [0x11111111 * (i + 1), 0x2222, 0x3333, 0x4444 + i]);
  // obsah struktur: hlavička + zlib sekce
  const fsBlobs = m.structures.map((s, i) => {
    const header = new ByteWriter()
      .raw([0x50, 0x52, 0x43])
      .u32(8137)
      .u32(version)
      .u32(uuids[i][0])
      .u32(uuids[i][1])
      .u32(uuids[i][2])
      .u32(uuids[i][3])
      .u32(0)
      .u32(0)
      .u32(0)
      .u32(0)
      .u32(0).bytes;
    let tree = s.omitTree ? null : zlibSync(writeTree(s));
    if (tree && s.truncateTree !== undefined) {
      // poškozený strom: rozbalitelný, ale data končí v půlce
      const raw = writeTree(s);
      tree = zlibSync(raw.subarray(0, Math.max(4, Math.floor(raw.length * s.truncateTree))));
    }
    const sections: Uint8Array[] = [zlibSync(writeGlobals(s))];
    if (tree) sections.push(tree);
    sections.push(zlibSync(writeTessellation(s)), zlibSync(writeGeometry(s)), zlibSync(writeExtraGeometry()));
    return { header, sections };
  });
  const model = zlibSync(writeModelFile(m, uuids));

  // velikost hlavičky souboru
  let headerSize = 3 + 4 + 4 + 16 + 16 + 4;
  for (const b of fsBlobs) headerSize += 16 + 4 + 4 + 4 * (1 + b.sections.length);
  headerSize += 4 + 4 + 4;

  // offsety
  let pos = headerSize;
  const offsets = fsBlobs.map((b) => {
    const o: number[] = [pos];
    pos += b.header.length;
    for (const s of b.sections) {
      o.push(pos);
      pos += s.length;
    }
    return o;
  });
  const modelStart = pos;
  const modelEnd = pos + model.length;

  const out = new ByteWriter().raw([0x50, 0x52, 0x43]).u32(8137).u32(version);
  out.u32(0x55555555).u32(1).u32(2).u32(3); // UUID souboru
  out.u32(0x66666666).u32(1).u32(2).u32(3); // UUID aplikace
  out.u32(fsBlobs.length);
  fsBlobs.forEach((_, i) => {
    for (const u of uuids[i]) out.u32(u);
    out.u32(0); // rezervováno
    out.u32(offsets[i].length);
    for (const o of offsets[i]) out.u32(o);
  });
  out.u32(modelStart).u32(modelEnd).u32(0);
  if (out.length !== headerSize) throw new Error("chybná velikost hlavičky");
  for (const b of fsBlobs) {
    out.raw(b.header);
    for (const s of b.sections) out.raw(s);
  }
  out.raw(model);
  return Uint8Array.from(out.bytes);
}
