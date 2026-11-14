/**
 * Předloha (reference) – výkres zákazníka DWG / DXF / PDF připojený k dokumentu jako podklad pro překreslení a kontrolu 1:1.
 * Čistá data bez Reactu: výtah (listy, pohledy, měřítko, kóty, díry, kusovník, pozice, razítka, poznámky, značky,
 * rozpory) a výsledky porovnání modelu s pohledem předlohy. Souřadnice výtahu jsou souřadnice výkresu předlohy
 * (modelový prostor DWG / DXF, u PDF milimetry stránky s osou Y nahoru).
 */
import type { Vec2 } from "../draft/model";
import type { DimTextCheck } from "../draft/io/dimtext";

export type RefFormat = "dwg" | "dxf" | "pdf";
export type RefBox = { x0: number; y0: number; x1: number; y1: number };

/** list předlohy (rámeček formátu) */
export type RefSheet = {
  /** pořadové číslo 1… (shora dolů, zleva doprava) */
  n: number;
  /** formát (A0–A4) nebo „w×h“ */
  size: string;
  /** rozměr listu [mm papíru] */
  w: number;
  h: number;
  /** rámeček listu v souřadnicích výkresu */
  frame: RefBox;
  /** měřítko listu („1:2“) a jeho hodnota (0,5) */
  scale?: string;
  scaleValue?: number;
  /** jednotky výkresu na 1 mm papíru (rámeček zvětšený vložením × 2 → 2) */
  unitPerMm: number;
  /** odkud list je: AutoCAD Mechanical (GENIUS_GENTITLE), vložení bloku formátu, obdélník, rozvržení, stránka PDF, rozsah */
  source: "mechanical" | "insert" | "rect" | "layout" | "page" | "extents";
  /** id entit rámečku a razítka (do geometrie pohledů nepatří) */
  frameIds: string[];
  /** razítko listu */
  title?: RefTitle;
};

export type RefTitle = {
  sheet: number;
  block?: string;
  /** všechna pole razítka (atribut → hodnota) */
  fields: Record<string, string>;
  /** známá pole podle názvu atributu */
  name?: string;
  number?: string;
  material?: string;
  scale?: string;
  author?: string;
  date?: string;
  /** pozice v kusovníku (razítko výrobního výkresu dílu) */
  pos?: string;
  qty?: string;
  /** rozměr polotovaru / čistý rozměr */
  dim?: string;
  treatment?: string;
};

/** pohled předlohy = shluk geometrie na listu */
export type RefView = {
  /** „list.pořadí“, např. „14.2“ */
  id: string;
  sheet: number;
  n: number;
  box: RefBox;
  /** rozměr pohledu [jednotky výkresu] */
  w: number;
  h: number;
  /** popisek („A-A“, „B-B“, „POHLED C“) */
  label?: string;
  /** jednotky výkresu na 1 mm skutečné velikosti (geometrie 1:1 → 1; PDF v měřítku 1:2 → 0,5) */
  geomScale: number;
  /** odkud měřítko geometrie je: kóty pohledu, kóty ostatních pohledů listu, měřítko listu, výchozí 1 */
  scaleFrom?: "dims" | "sheet-dims" | "sheet" | "default";
  /** počet entit geometrie */
  count: number;
};

export type RefDim = {
  /** handle kóty v DWG / DXF nebo id entity */
  id: string;
  sheet: number;
  view?: string;
  kind: string;
  /** zobrazený text (prostý) */
  text: string;
  value?: number;
  decimals?: number;
  /** změřená hodnota geometrie (× DIMLFAC) a délka v jednotkách výkresu (bez DIMLFAC) */
  measured?: number;
  raw?: number;
  tol?: { upper: number; lower: number };
  fit?: string;
  reference?: boolean;
  dia?: boolean;
  radius?: boolean;
  thread?: string;
  chamfer?: { size: number; angle: number };
  /** počet („4x“ v textu nebo samostatná poznámka „4*“ u kóty) */
  count?: number;
  /** poloha textu kóty */
  at: Vec2;
  /** definiční body (lineární / ordinátní kóty): p1, p2, směr měření (stupně; ordinátní = osa) */
  p1?: Vec2;
  p2?: Vec2;
  dirDeg?: number;
  /** kruhové kóty: střed / bod na kružnici */
  center?: Vec2;
  /** výsledek kontroly „text kóty = geometrie“ */
  check: DimTextCheck;
};

export type RefHoleKind = "thread" | "bore" | "counterbore" | "countersink" | "blind" | "screw" | "pin" | "nut" | "washer" | "part" | "circle";
export type RefHole = {
  sheet: number;
  view?: string;
  kind: RefHoleKind;
  /** norma (DIN, ČSN, ISO) a označení („DIN 13 T1 - M8“) */
  std?: string;
  desig?: string;
  /** větev databáze AutoCAD Mechanical (/AMSTD/…) */
  branch?: string;
  /** pohled normálie: T shora, F zepředu, B zezadu… */
  side?: string;
  center?: Vec2;
  /** průměry kružnic díry (od nejmenšího) */
  dias: number[];
  handle?: string;
};

export type RefBomRow = { pos: string; qty?: number; name?: string; std?: string; material?: string; dim?: string; mass?: string; note?: string; cells: Record<string, string> };
export type RefBom = { sheet: number; header: string[]; rows: RefBomRow[]; source: "mechanical" | "table" };
export type RefBalloon = { sheet: number; pos: string; at: Vec2; target?: Vec2; linked?: boolean };
export type RefNote = { sheet: number; text: string; at: Vec2; layer?: string };
export type RefSymbolKind = "roughness" | "fcf" | "datum" | "section" | "label";
export type RefSymbol = { kind: RefSymbolKind; sheet: number; text: string; at: Vec2 };
export type RefContradiction = { kind: "dim-text" | "title-bom" | "hole-dim" | "balloon-bom"; sheet?: number; text: string; at?: Vec2 };

/** výtah z předlohy */
export type RefExtract = {
  name: string;
  format: RefFormat;
  version?: string;
  sheets: RefSheet[];
  views: RefView[];
  dims: RefDim[];
  holes: RefHole[];
  boms: RefBom[];
  balloons: RefBalloon[];
  titles: RefTitle[];
  notes: RefNote[];
  symbols: RefSymbol[];
  contradictions: RefContradiction[];
  /** databáze kusovníku AutoCAD Mechanical (ACMDATAENTRYPART): atributy dílu (NAME, STANDARD, MATERIAL, DIM, NOTE…) */
  bomData: { h: string; attrs: Record<string, string> }[];
  /** objekty, které se nepřevedly (typ → počet) – z poznámky importu */
  skipped: Record<string, number>;
  ms: number;
};

/** úsek geometrie pro porovnání (souřadnice v mm skutečné velikosti) */
export type Seg = { a: Vec2; b: Vec2; hidden?: boolean; /** úsek normálie závitu (jádro d1 předlohy × vrták modelu) */ thread?: boolean };
/** kružnice / oblouk geometrie (pro sesouhlasení poloh a kontrolu kót) */
export type Circ = { c: Vec2; r: number };

/** výsledek porovnání pohledu modelu s pohledem předlohy */
export type RefCompare = {
  view: string;
  refView: string;
  tolerance: number;
  /** podíl délky geometrie předlohy do tolerance od modelu [%] */
  coverage: number;
  /** podíl délky geometrie modelu do tolerance od předlohy [%] */
  modelCoverage: number;
  /** sesouhlasení: otočení [°], zrcadlení, posun (předloha → model) */
  align: { rot: number; mirror: boolean; dx: number; dy: number };
  /** úseky předlohy bez modelu a modelu bez předlohy (poloha v souřadnicích pohledu předlohy od levého dolního rohu) */
  mismatches: { side: "ref" | "model"; at: Vec2; length: number; dist: number }[];
  svg: string;
  refLength: number;
  modelLength: number;
  /** délka úseků závitů předlohy, které se shodují jen ve volnější toleranci závitu (jádro d1 × vrták) [mm] */
  threadLength?: number;
  threadTol?: number;
  /** předloha v pohledu nemá skryté hrany – porovnány jen viditelné hrany modelu */
  visibleOnly?: boolean;
  /** pohled předlohy zadaný ručně (N.M) – bez kontroly velikosti */
  forced?: boolean;
  /** měřítko geometrie pohledu předlohy zadané příkazem (jednotky výkresu na 1 mm) */
  scale?: number;
};

/** kontrola kót předlohy proti modelu */
/** how: value / geometry / tolerance = změřeno; none = bod kóty v modelu nenalezen; unchecked = úhel, závit, sražení (nekontroluje se) */
export type RefDimCheck = { dim: RefDim; model?: number; ok: boolean; how: "value" | "geometry" | "tolerance" | "none" | "unchecked"; note?: string };

/** údaje předlohy uložené v dokumentu (bez souboru – soubor drží úložiště relace) */
export type RefDocInfo = {
  name: string;
  format: RefFormat;
  bytes: number;
  /** otisk obsahu souboru (blobs.ts) */
  id: string;
  /** souhrn výtahu (počty) */
  summary: Record<string, number>;
  /** poslední výsledky kontrol: pohled → pokrytí, kontrola kót */
  checks?: {
    compare?: Record<string, { refView: string; coverage: number; modelCoverage: number; at: string; /** otisk modelu při porovnání (modelPrint) */ model?: string }>;
    /** skipped = bez bodu v modelu, unchecked = úhel / závit / sražení */
    dims?: { ok: number; bad: number; skipped: number; unchecked?: number; at: string; sheet?: number; model?: string };
  };
};
