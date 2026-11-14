/**
 * BALÍK 4 (io) – údaje pro věrný přenos DWG / DXF, které 2D model sám nepoužívá. Doplňuje rozhraní jádra
 * `DraftEntityExt` a `DraftDocExt` (model.ts) rozšířením modulu – jen volitelná pole v `ext`, ostatní balíky je ignorují.
 *
 * Zásada: entita má vždy platný druh 2D modelu (úsečka, křivka, šrafa…); co DWG/DXF umí navíc (původní typ SOLID,
 * 3DFACE, POLYLINE, WIPEOUT…, z-souřadnice, anonymní blok kóty, původní hrany šrafy a definice vzoru), je v `ext`
 * a při zápisu zpět se použije, jen když se entita mezitím nezměnila (otisk geometrie `key`).
 */
import type { Vec2 } from "../model";

/** XDATA záznam: [skupinový kód 1000–1071, hodnota]; body (1010–1013) jako [x, y, z] */
export type XRec = [number, unknown];

/** původní hrana smyčky šrafy (elipsa / spline přesně – ve smyčce modelu jsou vzorkované) */
export type HatchEdge =
  | { t: "line"; a: Vec2; b: Vec2 }
  | { t: "arc"; c: Vec2; r: number; a0: number; a1: number; ccw: boolean }
  | { t: "ellipse"; c: Vec2; major: Vec2; ratio: number; a0: number; a1: number; ccw: boolean }
  | { t: "spline"; degree: number; ctrl: Vec2[]; knots: number[]; weights?: number[]; fit?: Vec2[]; periodic?: boolean };

/** řádek definice vzoru šrafy (DXF 53, 43/44, 45/46, 49…) – už natočený a v měřítku entity */
export type PatLine = { angle: number; base: Vec2; offset: Vec2; dashes: number[] };

/** objekt, který 2D model neumí zobrazit ani upravit (REGION, 3DSOLID, BODY…) – uchová se pro zápis zpět */
export type DraftRawObject = {
  /** prostor, kam patří */
  space: string;
  /** typ DXF (REGION, 3DSOLID…) */
  type: string;
  layer: string;
  color?: number | string;
  handle?: string;
  /** data modeláře ACIS (SAT text nebo SAB binárně) v base64 */
  acis?: string;
  acisVersion?: number;
};

declare module "../model" {
  interface DraftEntityExt {
    /** původní typ objektu DWG/DXF, liší-li se od druhu entity (SOLID, TRACE, 3DFACE, POLYLINE, POLYLINE3D, WIPEOUT, IMAGE, MLINE, ACAD_TABLE, MULTILEADER, SHAPE) */
    dxf?: string;
    /** otisk geometrie entity v okamžiku importu – údaje níže platí, jen dokud se geometrie nezmění */
    key?: string;
    /** z-souřadnice vrcholů (3D křivka, 3DFACE, SOLID) */
    z?: number[];
    /** elevace (38) a tloušťka (39) */
    elev?: number;
    thick?: number;
    /** neviditelná entita (60) */
    invisible?: boolean;
    /** anonymní blok s geometrií (kóta *D, tabulka *T) */
    block?: string;
    /** šrafa: původní hrany smyček (index smyčky → hrany), definice vzoru, seed body, asociativita */
    loops?: Record<number, HatchEdge[]>;
    pat?: PatLine[];
    /** obrázek / podklad (IMAGE, PDFUNDERLAY): soubor, velikost v pixelech, vektory u/v */
    image?: { file?: string; size?: Vec2; u?: Vec2; v?: Vec2; p?: Vec2; kind?: string };
    /** neviditelné hrany 3DFACE (70) */
    edges?: number;
  }
  interface DraftDocExt {
    /** hlavičkové proměnné DWG/DXF, které model nepoužívá (název bez $ → hodnota) – zapíší se zpět */
    header?: Record<string, number | string | boolean>;
    /** objekty, které model nezobrazuje (REGION, 3DSOLID, BODY) – zapíší se zpět do DWG / DXF */
    raw?: DraftRawObject[];
    /** registrované aplikace XDATA ze zdroje */
    appIds?: string[];
    /** textový styl: velké písmo (SHX big font) a příznaky podle názvu stylu */
    styleExt?: Record<string, { bigFont?: string; flags?: number }>;
  }
}

export {};
