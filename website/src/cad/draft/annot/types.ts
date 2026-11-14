/**
 * BALÍK 2 (annot) – SMLUVNÍ TVAR entit poznámek a stylů (fáze A ho pevně stanovila, aby balík 4 mohl převádět DWG/DXF
 * souběžně). Balík 2 smí PŘIDÁVAT volitelná pole; přejmenovat / odebrat pole jen po dohodě s balíkem 4 (CAD-2D-NAVRH.md).
 * Mapování na DXF je u každého pole v závorce (skupinový kód).
 */
import type { DraftBase, DraftColor, DraftDimStyle, Vec2 } from "../model";

/** víceřádkový text (MTEXT): `s` = obsah s formátovacími kódy MTEXT (\P nový řádek, {\fArial|b1;…}, \H, \C, \S…) */
export interface DMText extends DraftBase {
  type: "mtext";
  /** bod vložení (10) */
  p: Vec2;
  /** výška textu (40) */
  h: number;
  /** šířka rámečku pro zalamování (41), 0 = bez zalamování */
  w: number;
  /** obsah (1 + 3) */
  s: string;
  /** natočení [°] (50, resp. směr 11) */
  rot?: number;
  /** textový styl (7) */
  style?: string;
  /** připojení 1–9: 1 vlevo nahoře … 9 vpravo dole (71) */
  attach?: number;
  /** řádkování – faktor (44) */
  lineSpacing?: number;
  /** maska pozadí (90, 63 / 421, 45) */
  bg?: { color?: DraftColor; scale?: number; useBackground?: boolean };
  /** poznámka s měřítkem poznámek (anotativní): `h` = výška na papíře, ve výkrese × měřítko poznámek (balík 2, nepovinné) */
  annotative?: boolean;
}

export type DimKind = "linear" | "aligned" | "angular" | "angular3" | "radius" | "diameter" | "ordinate" | "arc";

/**
 * Kóta (DIMENSION / ARC_DIMENSION). Definiční body podle druhu:
 * - linear / aligned: `p1` (13), `p2` (14), `line` = bod na kótovací čáře (10), linear `rot` (50)
 * - radius: `center` (10), `chord` = bod na kružnici (15); diameter: `chord` (15) a `far` = protilehlý bod (10)
 * - angular (2 přímky): `l1` = [13, 14], `l2` = [15, 10], `arc` = bod oblouku kóty (16)
 * - angular3 (3 body): `vertex` (15), `p1` (13), `p2` (14), `arc` (10)
 * - ordinate: `origin` (10), `p1` = bod prvku (13), `p2` = konec odkazu (14), `xAxis` (70 bit 64)
 * - arc (délka oblouku): `center` (10), `p1` (13), `p2` (14), `arc` (16)
 */
export interface DDimension extends DraftBase {
  type: "dimension";
  kind: DimKind;
  /** kótovací styl (3) */
  style?: string;
  p1?: Vec2;
  p2?: Vec2;
  line?: Vec2;
  center?: Vec2;
  chord?: Vec2;
  far?: Vec2;
  l1?: [Vec2, Vec2];
  l2?: [Vec2, Vec2];
  vertex?: Vec2;
  arc?: Vec2;
  origin?: Vec2;
  xAxis?: boolean;
  /** natočení kótovací čáry (50) – linear */
  rot?: number;
  /** poloha textu (11); chybí = výchozí podle stylu */
  textPos?: Vec2;
  /** text kóty (1): "" nebo chybí = naměřená hodnota, "<>" = naměřená uvnitř textu */
  text?: string;
  /** natočení textu (53) */
  textRot?: number;
  /** přepsané proměnné stylu jen u této kóty (XDATA ACAD DSTYLE): klíč = název proměnné (dimtxt, dimasz…) */
  overrides?: Partial<DraftDimStyle>;
  /** naměřená hodnota (42) – mezipaměť pro DXF, vždy se dá přepočítat */
  measurement?: number;
  /** směr osy X souřadnicové kóty [°] (51 – „horizontal direction“): kóta měří v soustavě natočené o tento úhel;
   * chybí = 0 (vodorovná osa X). Vzniká otočením kóty o jiný úhel než násobek 90° (balík 2, nepovinné) */
  hdir?: number;
  /** zalomená kóta poloměru (DIMJOGGED, LARGE_RADIAL_DIMENSION): náhradní střed a bod zalomení (balík 2, nepovinné) */
  jog?: { center: Vec2; jog: Vec2 };
  /** anotativní kóta (velikosti stylu × měřítko poznámek místo DIMSCALE) – balík 2, nepovinné */
  annotative?: boolean;
}

/** Odkaz (LEADER / MULTILEADER): šipka v pts[0], text MTEXT na konci */
export interface DLeader extends DraftBase {
  type: "leader";
  /** vrcholy odkazové čáry (10…), šipka v prvním */
  pts: Vec2[];
  /** spline místo lomené čáry */
  spline?: boolean;
  /** šipka: název bloku šipky ("" = plná uzavřená) */
  arrow?: string;
  /** velikost šipky */
  arrowSize?: number;
  /** obsah textu (MTEXT kódy) a jeho poloha / výška */
  text?: string;
  textPos?: Vec2;
  textH?: number;
  /** styl odkazu (MLEADERSTYLE) */
  style?: string;
  /** délka zalomení u textu */
  dogleg?: number;
  /** anotativní odkaz (balík 2, nepovinné) */
  annotative?: boolean;
}

/** Šrafa (HATCH): smyčky hranice jako křivky s vydutím (oblouky přesně, elipsy / splajny vzorkované – originál v ext) */
export interface DHatch extends DraftBase {
  type: "hatch";
  /** vzor (2): ANSI31, ANSI37, SOLID, AR-CONC… */
  pattern: string;
  /** plná výplň (70) */
  solid?: boolean;
  /** měřítko (41) a úhel [°] (52) vzoru */
  scale: number;
  angle: number;
  /** smyčky: vnější a ostrovy; `outer` = vnější hranice (92 bit 1) */
  loops: { pts: Vec2[]; bulges?: number[]; outer?: boolean }[];
  /** styl ostrovů (75): 0 normální, 1 vnější, 2 ignorovat */
  islandStyle?: 0 | 1 | 2;
  /** asociativní: id entit hranice */
  boundary?: string[];
  /** počátek vzoru */
  origin?: Vec2;
  /** dvojitá šrafa (77) */
  double?: boolean;
  /** přechod (450–470) */
  gradient?: { name: string; color1: DraftColor; color2?: DraftColor; angle?: number; shift?: number };
  /** anotativní šrafa (měřítko vzoru × měřítko poznámek) – balík 2, nepovinné */
  annotative?: boolean;
}

/** Geometrická tolerance (TOLERANCE): `s` = řetězec DXF (%%v oddělovače, {\Fgdt;j} symboly) */
export interface DTolerance extends DraftBase {
  type: "tolerance";
  p: Vec2;
  s: string;
  h: number;
  rot?: number;
  style?: string;
  /** anotativní tolerance (balík 2, nepovinné) */
  annotative?: boolean;
}

/**
 * Značka struktury povrchu (drsnosti) podle ČSN EN ISO 1302 / 21920-1 – druh balíku 2 navíc oproti smlouvě DXF:
 * DWG / DXF ho zapíše rozložený (`explode` → úsečky a text). `p` = hrot značky na povrchu, `rot` [°] = směr povrchu
 * (značka stojí kolmo nahoru vlevo od směru), `kind`: basic = libovolná výroba, removal = s úběrem, noremoval = bez úběru.
 */
export interface DSurfSym extends DraftBase {
  type: "surfsym";
  p: Vec2;
  rot?: number;
  /** výška písma (velikost značky = 1,4 × h … 3 × h podle ISO 81714) */
  h: number;
  kind?: "basic" | "removal" | "noremoval";
  /** požadavek drsnosti (např. „Ra 1,6“) */
  text?: string;
  /** výrobní postup na vodorovném rameni (např. „broušeno“) */
  process?: string;
  /** směr stop (=, ⊥, X, M, C, R, P) */
  lay?: string;
  /** kolem dokola (kroužek ve vrcholu) */
  allAround?: boolean;
  /** textový styl */
  style?: string;
  annotative?: boolean;
}

declare module "../model" {
  /** textový styl – balík 2 navíc: anotativní styl (nové texty stylu dostanou výšku na papíře) */
  interface DraftTextStyle {
    annotative?: boolean;
  }
  interface DraftEntityMap {
    mtext: DMText;
    dimension: DDimension;
    leader: DLeader;
    hatch: DHatch;
    tolerance: DTolerance;
    surfsym: DSurfSym;
  }
  /** kótovací styl (DIMSTYLE): názvy polí = systémové proměnné AutoCADu malými písmeny */
  interface DraftDimStyle {
    dimscale?: number;
    dimtxt?: number;
    dimasz?: number;
    dimexe?: number;
    dimexo?: number;
    dimdli?: number;
    dimgap?: number;
    dimdec?: number;
    dimadec?: number;
    dimlfac?: number;
    dimtad?: number;
    dimjust?: number;
    dimtih?: boolean;
    dimtoh?: boolean;
    dimtofl?: boolean;
    dimse1?: boolean;
    dimse2?: boolean;
    dimsd1?: boolean;
    dimsd2?: boolean;
    dimblk?: string;
    dimblk1?: string;
    dimblk2?: string;
    dimclrd?: DraftColor;
    dimclre?: DraftColor;
    dimclrt?: DraftColor;
    dimlwd?: number | "ByLayer" | "ByBlock";
    dimlwe?: number | "ByLayer" | "ByBlock";
    dimtxsty?: string;
    dimpost?: string;
    dimzin?: number;
    dimazin?: number;
    dimaunit?: number;
    dimdsep?: string;
    dimtol?: boolean;
    dimlim?: boolean;
    dimtp?: number;
    dimtm?: number;
    dimtfac?: number;
    dimcen?: number;
    dimrnd?: number;
    /** balík 2 – nepovinné navíc: desetinná místa a potlačení nul tolerancí (DIMTDEC, DIMTZIN), symbol délky oblouku
     * (DIMARCSYM 0 před, 1 nad, 2 bez), pevná délka vynášecích čar (DIMFXL, DIMFXLON), úhel zalomení (DIMJOGANG),
     * anotativní styl */
    dimtdec?: number;
    dimtzin?: number;
    dimarcsym?: number;
    dimfxl?: number;
    dimfxlon?: boolean;
    dimjogang?: number;
    dimanno?: boolean;
    /** jednotky délek (DIMLUNIT): 1 vědecké, 2 desetinné, 3 inženýrské, 4 architektonické, 5 zlomky */
    dimlunit?: number;
  }
  interface DraftVars {
    /** DIMSTYLE – aktuální kótovací styl */
    dimstyle?: string;
    /** CMLEADERSTYLE – aktuální styl odkazu */
    mleaderstyle?: string;
    /** HPNAME, HPSCALE, HPANG – poslední šrafa */
    hpname?: string;
    hpscale?: number;
    hpang?: number;
    /** balík 2 – nepovinné navíc: CANNOSCALE jako číslo – CANNOSCALEVALUE AutoCADu, papír : skutečnost (1:50 → 0,02,
     * 2:1 → 2; stejný význam jako v balíku 3), HPSTYLE (styl ostrovů nové šrafy), HPASSOC (asociativní šrafa) */
    cannoscale?: number;
    hpisland?: 0 | 1 | 2;
    hpassoc?: boolean;
  }
}
