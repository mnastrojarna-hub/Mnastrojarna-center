/**
 * Společný formát načteného 3D modelu pro prohlížeč (STEP/IGES/BREP přes OpenCascade,
 * STL/OBJ/3MF/GLB/PLY, 3D PDF s U3D nebo PRC). Každý importér vrací totéž: seznam dílů
 * s trojúhelníkovou sítí v milimetrech (transformace už zapečené) a strom sestavy.
 */

/** Barva RGB 0–1. */
export type Rgb = [number, number, number];

/** Rozsah trojúhelníků jedné plochy původního B-repu (index trojúhelníku, ne vrcholu). */
export interface FaceRange {
  first: number;
  last: number;
  color?: Rgb | null;
}

/** Jeden díl (síť). Souřadnice ve světových mm — případné transformace uzlů už jsou aplikované. */
export interface MeshPart {
  name: string;
  /** xyz trojice vrcholů. */
  positions: Float32Array;
  /** xyz normály (volitelné — chybějí-li, dopočítají se). */
  normals?: Float32Array | null;
  /** Trojice indexů trojúhelníků; null = neindexovaná síť (každé 3 vrcholy = trojúhelník). */
  indices?: Uint32Array | null;
  color?: Rgb | null;
  /** Průhlednost 0–1 (1 = neprůhledné). */
  opacity?: number;
  /** Plochy B-repu (STEP/IGES) — pro hrany, výběr plochy a měření. */
  faces?: FaceRange[] | null;
  /** Úsečky (dvojice bodů xyz) — drátová geometrie / polyčáry. */
  lines?: Float32Array | null;
  /** Barvy vrcholů úseček (rgb 0–1) — 2D výkresy. */
  lineColors?: Float32Array | null;
}

/** Text 2D výkresu (DXF / DWG). */
export interface DrawingText {
  /** Index dílu (hladiny). */
  part: number;
  x: number;
  y: number;
  text: string;
  /** Výška písma (velká písmena) v mm. */
  height: number;
  rotation: number;
  hAlign: "left" | "center" | "right";
  vAlign: "baseline" | "bottom" | "middle" | "top";
  /** Šířka odstavce (zalomení). */
  width?: number;
  /** Barva [r,g,b] 0–1, null = barva popředí (černá / bílá podle pozadí). */
  color: [number, number, number] | null;
}

/** Navíc u 2D výkresu: texty, barvy čar pro tmavé pozadí, vypnuté hladiny. */
export interface DrawingExtras {
  texts: DrawingText[];
  darkColors: Float32Array[];
  hidden: number[];
}

/** Uzel stromu sestavy. */
export interface ModelNode {
  name: string;
  /** Indexy do ParsedModel.parts. */
  parts: number[];
  children: ModelNode[];
}

export interface ParsedModel {
  parts: MeshPart[];
  root: ModelNode;
  /** Zdroj (pro informace v prohlížeči), např. „STEP", „U3D (3D PDF)". */
  format: string;
  /** Upozornění pro uživatele (část modelu se nenačetla apod.). */
  warnings?: string[];
  /** 2D výkres (DXF / DWG) — díly jsou hladiny. */
  drawing?: DrawingExtras;
}

/** Chyba importu se srozumitelnou hláškou pro uživatele. */
export class ModelImportError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ModelImportError";
  }
}
