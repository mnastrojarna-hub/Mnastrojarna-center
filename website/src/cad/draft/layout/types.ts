/**
 * BALÍK 3 (layout) – SMLUVNÍ TVAR bloků, vložení, atributů, rozvržení a výřezů (fáze A ho pevně stanovila, aby balík 4
 * mohl převádět DWG/DXF souběžně). Balík 3 smí PŘIDÁVAT volitelná pole; přejmenovat / odebrat jen po dohodě s balíkem 4.
 */
import type { DraftBase, DraftUnits, TextHAlign, TextVAlign, Vec2 } from "../model";

/** atribut vložení bloku (ATTRIB) */
export interface DAttrib {
  tag: string;
  value: string;
  p: Vec2;
  h: number;
  rot?: number;
  style?: string;
  halign?: TextHAlign;
  valign?: TextVAlign;
  p2?: Vec2;
  wf?: number;
  invisible?: boolean;
  /** vlastnosti atributu (chybí = jako vložení) */
  layer?: string;
  color?: DraftBase["color"];
}

/** vložení bloku (INSERT / MINSERT): bod vložení, měřítka, natočení [°], pole (MINSERT) */
export interface DInsert extends DraftBase {
  type: "insert";
  /** název definice bloku (model.blocks[].name) */
  block: string;
  p: Vec2;
  sx: number;
  sy: number;
  rot: number;
  attribs?: DAttrib[];
  cols?: number;
  rows?: number;
  colSpacing?: number;
  rowSpacing?: number;
}

/** definice atributu v bloku (ATTDEF) */
export interface DAttDef extends DraftBase {
  type: "attdef";
  tag: string;
  prompt: string;
  /** výchozí hodnota */
  def: string;
  p: Vec2;
  h: number;
  rot?: number;
  style?: string;
  halign?: TextHAlign;
  valign?: TextVAlign;
  p2?: Vec2;
  invisible?: boolean;
  constant?: boolean;
  verify?: boolean;
  preset?: boolean;
}

/**
 * Výřez v papírovém prostoru (VIEWPORT): střed a rozměr na papíře [jednotky papíru], pohled do modelu (střed v modelu,
 * měřítko = jednotek papíru na jednotku modelu, např. 1:50 v mm → 0,02), natočení, zamčení, zmrazené hladiny.
 */
export interface DViewport extends DraftBase {
  type: "viewport";
  c: Vec2;
  w: number;
  h: number;
  viewCenter: Vec2;
  scale: number;
  twist?: number;
  locked?: boolean;
  on?: boolean;
  /** hladiny zmrazené jen v tomto výřezu (VPLAYER) */
  frozenLayers?: string[];
  /** nepravoúhlý ořez (polygon v papírových souřadnicích) */
  clip?: Vec2[];
}

declare module "../model" {
  interface DraftEntityMap {
    insert: DInsert;
    attdef: DAttDef;
    viewport: DViewport;
  }
  interface DraftBlock {
    desc?: string;
    /** jednotky bloku (INSUNITS bloku) */
    units?: DraftUnits;
    explodable?: boolean;
    scaleUniformly?: boolean;
    /** anonymní blok (*D kót, *U…) – nezobrazuje se v seznamu bloků */
    anonymous?: boolean;
  }
  interface DraftLayout {
    /** pořadí záložky */
    order: number;
    /** list papíru: formát, rozměry [mm nebo in], orientace, okraje tisku [vlevo, dole, vpravo, nahoře] */
    paper: { size: string; w: number; h: number; units: "mm" | "in"; landscape: boolean; margins: [number, number, number, number] };
    /** nastavení tisku */
    plot?: { styleTable?: string; scale?: number | "fit"; area?: "layout" | "extents" | "window"; window?: [Vec2, Vec2]; lineweights?: boolean; plotStyles?: boolean; dpi?: number };
  }
  interface DraftVars {
    /** naposledy použitý blok (INSNAME) */
    insname?: string;
    /** PSLTSCALE – vzory čar ve výřezech v jednotkách papíru (1, výchozí) / modelu (0) – uplatní se při tisku */
    psltscale?: 0 | 1;
    /** CANNOSCALE – aktuální měřítko poznámek (papír : skutečnost, např. 0,02 = 1:50); nastaví MVIEW / MSPACE */
    cannoscale?: number;
  }
}

