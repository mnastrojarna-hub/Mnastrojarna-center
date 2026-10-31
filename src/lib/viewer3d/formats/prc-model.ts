/**
 * Mezivýsledky dekodéru PRC (sdílené mezi čtením sekcí a sestavením modelu).
 */

/** Matice 4×4 po sloupcích (stejně jako three.js): m[col * 4 + row]. */
export type Mat4 = Float64Array;

export function mat4Identity(): Mat4 {
  const m = new Float64Array(16);
  m[0] = m[5] = m[10] = m[15] = 1;
  return m;
}

export function mat4Multiply(a: Mat4, b: Mat4): Mat4 {
  const r = new Float64Array(16);
  for (let c = 0; c < 4; c++) {
    for (let row = 0; row < 4; row++) {
      r[c * 4 + row] =
        a[row] * b[c * 4] + a[4 + row] * b[c * 4 + 1] + a[8 + row] * b[c * 4 + 2] + a[12 + row] * b[c * 4 + 3];
    }
  }
  return r;
}

export function mat4Scale(s: number): Mat4 {
  const m = mat4Identity();
  m[0] = m[5] = m[10] = s;
  return m;
}

export function mat4IsIdentity(m: Mat4): boolean {
  for (let i = 0; i < 16; i++) {
    const e = i % 5 === 0 ? 1 : 0;
    if (Math.abs(m[i] - e) > 1e-12) return false;
  }
  return true;
}

/** Tessellace s trojúhelníky (TESS_3D nebo dekomprimovaná TESS_3D_Compressed). */
export interface MeshTess {
  kind: "mesh";
  /** Zásobník vrcholů xyz (lokální souřadnice, jednotky souboru). */
  pos: Float64Array;
  /** Trojice indexů do `pos` (po vrcholech), seskupené po plochách. */
  tri: Uint32Array;
  /** Normály v rozích trojúhelníků (3 floaty na roh), nebo null = dopočítat. */
  cornerNormals: Float32Array | null;
  /** Začátky ploch v trojúhelnících (délka = počet ploch + 1). */
  faceStart: Uint32Array;
  /** Styl každé plochy (index do stylů globals, −1 = zděděný). */
  faceStyle: Int32Array;
  /** Úhel vyhlazení pro dopočet normál (radiány). */
  creaseAngle: number;
}

/** Drátová tessellace (TESS_3D_Wire): úsečky jako dvojice indexů do `pos`. */
export interface WireTess {
  kind: "wire";
  pos: Float64Array;
  seg: Uint32Array;
}

export type Tess = MeshTess | WireTess;

export interface PrcStyle {
  isMaterial: boolean;
  /** Index barvy nebo materiálu (−1 = žádný). */
  index: number;
  /** 0–255 nebo −1. */
  transparency: number;
}

export interface PrcMaterial {
  /** 0 = GRAPH_Material, 1 = TextureApplication. */
  kind: 0 | 1;
  ambient: number;
  diffuse: number;
  emissive: number;
  specular: number;
  diffuseAlpha: number;
  /** U TextureApplication: index základního materiálu. */
  generic: number;
}

export interface PrcGlobals {
  colors: number[];
  materials: PrcMaterial[];
  styles: PrcStyle[];
  coordSystems: (Mat4 | null)[];
}

/** Grafika entity (styl a chování), po rozbalení „stejné jako aktuální". */
export interface Graphics {
  style: number;
  behaviour: number;
}

export interface PrcRI {
  type: number;
  name: string;
  graphics: Graphics;
  localCs: number;
  tess: number;
  children: PrcRI[] | null;
  /** Vlastní transformace RI_CoordinateSystem (jen pro úplnost). */
  csMatrix: Mat4 | null;
}

export interface PrcPart {
  name: string;
  graphics: Graphics;
  items: PrcRI[];
}

export type Uuid = [number, number, number, number];

export interface PrcOccurrence {
  name: string;
  graphics: Graphics;
  part: number;
  prototype: number;
  prototypeFs: Uuid | null;
  external: number;
  externalFs: Uuid | null;
  sons: number[];
  location: Mat4 | null;
  unit: number;
  unitFromCad: boolean;
  /** Barvy/viditelnost přepsané odkazy (entity references) — zatím jen evidujeme počet. */
  referenceCount: number;
}

export interface PrcTree {
  parts: PrcPart[];
  occurrences: PrcOccurrence[];
  /** Index kořenového PO podle FileStructure (bias +1 už odečten; −1 = neznámý). */
  root: number;
  /** Strom se nepodařilo přečíst celý. */
  partial: boolean;
}

export interface PrcFileStructure {
  uuid: Uuid;
  version: number;
  globals: PrcGlobals;
  tree: PrcTree | null;
  tess: (Tess | null)[];
  /** Kolik tessellací bylo v sekci deklarováno (i když se nepřečetly). */
  tessDeclared: number;
  /** Počet těles v přesné geometrii (B-rep) — pro hlášku, když chybí tessellace. */
  hasExactGeometry: boolean;
}

export interface PrcRootRef {
  uuid: Uuid;
  index: number;
}

export interface PrcModelFile {
  name: string;
  unit: number;
  unitFromCad: boolean;
  roots: PrcRootRef[];
}
