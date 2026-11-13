/**
 * 2D CAD (výkres jako v AutoCADu LT / DraftSightu) – datový model.
 *
 * Dokument druhu `CadDoc.kind = "draft"` nese model v `CadDoc.draft`. Model je čistý JSON (ukládá se do .mncad,
 * automaticky do prohlížeče, do sdíleného odkazu a do historie zpět/znovu). Souřadnice jsou ve výkresových jednotkách
 * (`vars.units`, výchozí mm), úhly ve stupních proti směru hodinových ručiček od +X (jako DXF).
 *
 * ROZŠIŘITELNOST (balíky fáze B): rozhraní `DraftEntityMap`, `DraftVars`, `DraftModel`, `DraftBlock`, `DraftLayout`,
 * `DraftDimStyle`, `DraftTextStyle`, `DraftDocExt` a `DraftEntityExt` jsou `interface` – balík je doplní rozšířením modulu
 * (`declare module "@/cad/draft/model" { interface DraftEntityMap { mtext: DMText } }`) ve SVÉM souboru, bez úpravy tohoto.
 * Podrobnosti v website/CAD-2D-NAVRH.md.
 */
import type { Vec2 } from "../types";

export type { Vec2 };

/** Barva: „ByLayer“ (dle hladiny), „ByBlock“ (dle bloku), číslo ACI 1–255, nebo pravá barva „#rrggbb“. Chybí = ByLayer. */
export type DraftColor = "ByLayer" | "ByBlock" | number | string;
/** Tloušťka čáry v mm (0–2,11, standardní hodnoty), nebo „ByLayer“ / „ByBlock“ / „Default“ (= LWDEFAULT). Chybí = ByLayer. */
export type DraftLw = number | "ByLayer" | "ByBlock" | "Default";

/** Údaje pro věrný přenos DWG/DXF (vlastní balík 4 – io): handle, XDATA podle aplikace, nepřevedené kódy… */
export interface DraftEntityExt {
  /** handle objektu ve zdrojovém DWG/DXF (hex) */
  handle?: string;
  /** rozšířená data (XDATA) podle názvu aplikace – dvojice [kód, hodnota] */
  xdata?: Record<string, [number, unknown][]>;
}

/** Společné vlastnosti každé entity. */
export interface DraftBase {
  /** stabilní id v rámci dokumentu („e12“) – na něj odkazují textové příkazy (e12.end, x(e3,e5)…) */
  id: string;
  /** název hladiny (vždy existující hladina) */
  layer: string;
  color?: DraftColor;
  /** název typu čáry nebo „ByLayer“ / „ByBlock“; chybí = ByLayer */
  linetype?: string;
  lineweight?: DraftLw;
  /** měřítko typu čáry entity (CELTSCALE), výchozí 1 */
  ltscale?: number;
  /** průhlednost 0–90 % (chybí = dle hladiny) */
  transparency?: number;
  ext?: DraftEntityExt;
}

export interface DPoint extends DraftBase { type: "point"; p: Vec2 }
export interface DLine extends DraftBase { type: "line"; a: Vec2; b: Vec2 }
/** nekonečná přímka bodem `p` ve směru `dir` (jednotkový vektor) */
export interface DXLine extends DraftBase { type: "xline"; p: Vec2; dir: Vec2 }
/** polopřímka z bodu `p` ve směru `dir` */
export interface DRay extends DraftBase { type: "ray"; p: Vec2; dir: Vec2 }
/**
 * Křivka (LWPOLYLINE): vrcholy `pts`; `bulges[i]` = vydutí úseku i → i+1 (tan(úhel/4), kladné = proti směru hodin);
 * `widths[i]` = [počáteční, koncová] šířka úseku i; `width` = konstantní šířka; `closed` = uzavřená.
 */
export interface DPolyline extends DraftBase { type: "polyline"; pts: Vec2[]; bulges?: number[]; widths?: [number, number][]; width?: number; closed?: boolean }
export interface DCircle extends DraftBase { type: "circle"; c: Vec2; r: number }
/** oblouk ze `a0` do `a1` [°] proti směru hodin */
export interface DArc extends DraftBase { type: "arc"; c: Vec2; r: number; a0: number; a1: number }
/**
 * Elipsa / eliptický oblouk: `major` = vektor ze středu ke konci hlavní poloosy, `ratio` = vedlejší/hlavní (0–1];
 * parametr t: P = c + major·cos t + minor·sin t (minor = ratio · major otočený o +90°); `t0`, `t1` [°], chybí = celá elipsa.
 */
export interface DEllipse extends DraftBase { type: "ellipse"; c: Vec2; major: Vec2; ratio: number; t0?: number; t1?: number }
/**
 * Spline (NURBS): stupeň, řídicí body, uzlový vektor (délka = ctrl + degree + 1), váhy (chybí = 1);
 * `fit` = body proložení (zadání metodou Proložit), `closed` = uzavřená.
 */
export interface DSpline extends DraftBase { type: "spline"; degree: number; ctrl: Vec2[]; knots: number[]; weights?: number[]; fit?: Vec2[]; closed?: boolean }
export type TextHAlign = "left" | "center" | "right" | "aligned" | "middle" | "fit";
export type TextVAlign = "baseline" | "bottom" | "middle" | "top";
/**
 * Jednořádkový text (TEXT): `p` = bod vložení (u zarovnání jiného než vlevo/účaří je to bod zarovnání), `h` = výška,
 * `rot` [°], `style` = textový styl, `wf` = šířkový faktor, `oblique` [°] = sklon; `p2` = druhý bod u Zarovnat / Přizpůsobit.
 */
export interface DText extends DraftBase { type: "text"; p: Vec2; h: number; s: string; rot?: number; style?: string; halign?: TextHAlign; valign?: TextVAlign; p2?: Vec2; wf?: number; oblique?: number }

/** Druhy entit – balíky přidávají své (mtext, dimension, hatch, leader, insert, viewport…) rozšířením tohoto rozhraní. */
export interface DraftEntityMap {
  point: DPoint;
  line: DLine;
  xline: DXLine;
  ray: DRay;
  polyline: DPolyline;
  circle: DCircle;
  arc: DArc;
  ellipse: DEllipse;
  spline: DSpline;
  text: DText;
}
export type DraftEntityType = keyof DraftEntityMap;
export type DraftEntity = DraftEntityMap[DraftEntityType];
/** entita daného druhu */
export type DraftEntityOf<T extends DraftEntityType> = DraftEntityMap[T];
/** nová entita bez id (a volitelně bez hladiny – doplní se aktuální) */
export type NewEntity = DraftEntity extends infer E ? (E extends DraftEntity ? Omit<E, "id" | "layer"> & { layer?: string; id?: string } : never) : never;

export interface DraftLayer {
  name: string;
  /** ACI 1–255 nebo „#rrggbb“ (hladina nemá ByLayer / ByBlock) */
  color: number | string;
  linetype: string;
  /** mm nebo „Default“ */
  lineweight: number | "Default";
  on: boolean;
  frozen: boolean;
  locked: boolean;
  plot: boolean;
  desc?: string;
  transparency?: number;
  ext?: Record<string, unknown>;
}

/** Typ čáry: vzor v jednotkách výkresu (kladné = čára, záporné = mezera, 0 = tečka); prázdný = plná (Continuous). */
export interface DraftLinetype {
  name: string;
  desc: string;
  pattern: number[];
  ext?: Record<string, unknown>;
}

export interface DraftTextStyle {
  name: string;
  /** písmo (název SHX / TTF ze zdroje; vykresluje se nejbližším webovým písmem) */
  font: string;
  /** pevná výška (0 = zadává se u textu) */
  height: number;
  wf: number;
  oblique: number;
  ext?: Record<string, unknown>;
}

/** Kótovací styl – obsah definuje balík 2 (annot) rozšířením rozhraní. */
export interface DraftDimStyle {
  name: string;
}
/** Definice bloku – obsah doplní balík 3 (layout). Entity bloku jsou v souřadnicích bloku (bod vložení `base`). */
export interface DraftBlock {
  name: string;
  base: Vec2;
  entities: DraftEntity[];
  ext?: Record<string, unknown>;
}
/** Rozvržení (list papíru) – obsah doplní balík 3. `entities` = papírový prostor rozvržení (mm papíru). */
export interface DraftLayout {
  id: string;
  name: string;
  entities: DraftEntity[];
  ext?: Record<string, unknown>;
}
/** Hlavička a tabulky DWG/DXF, které 2D model sám nepoužívá (balík 4 – věrný přenos). */
export interface DraftDocExt {
  /** zdrojový formát a verze posledního importu */
  source?: { format: "dxf" | "dwg"; version?: string; name?: string };
}

export type DraftUnits = "unitless" | "in" | "ft" | "mm" | "cm" | "m" | "um" | "km" | "yd" | "mi";

/** Proměnné výkresu (obdoba systémových proměnných AutoCADu, které se ukládají do výkresu). */
export interface DraftVars {
  /** INSUNITS */
  units: DraftUnits;
  /** LUPREC – desetinná místa délek */
  prec: number;
  /** AUPREC – desetinná místa úhlů */
  aprec: number;
  /** LTSCALE – globální měřítko typů čar */
  ltscale: number;
  /** CELTSCALE – měřítko typu čáry nových entit */
  celtscale: number;
  /** CLAYER – aktuální hladina */
  clayer: string;
  /** CECOLOR – barva nových entit */
  cecolor: DraftColor;
  /** CELTYPE – typ čáry nových entit */
  celtype: string;
  /** CELWEIGHT – tloušťka nových entit */
  celweight: DraftLw;
  /** LWDEFAULT [mm] */
  lwdefault: number;
  /** LWDISPLAY – zobrazovat tloušťky čar */
  lwdisplay: boolean;
  /** TEXTSIZE – výchozí výška textu */
  textsize: number;
  /** TEXTSTYLE – aktuální textový styl */
  textstyle: string;
  /** PDMODE / PDSIZE – vzhled bodů (0 tečka, 2 +, 3 ×, 32 kružnice, 34 kružnice s +, 35 kružnice s ×; PDSIZE ≤ 0 = 5 % obrazovky) */
  pdmode: number;
  pdsize: number;
  /** GRIDUNIT, SNAPUNIT */
  grid: number;
  snap: number;
  /** MEASUREMENT – 0 palcové, 1 metrické (vzory čar, šrafy) */
  measurement: 0 | 1;
  /** MIRRTEXT – zrcadlit text (0 = text zůstane čitelný) */
  mirrtext: 0 | 1;
}

export interface DraftModel {
  /** verze formátu modelu */
  v: 1;
  /** náhodné id výkresu (klíč relace: výběr, pohled) */
  id: string;
  /** čítač id entit („e“ + číslo) */
  seq: number;
  vars: DraftVars;
  layers: DraftLayer[];
  linetypes: DraftLinetype[];
  textStyles: DraftTextStyle[];
  /** modelový prostor */
  entities: DraftEntity[];
  dimStyles?: DraftDimStyle[];
  blocks?: DraftBlock[];
  layouts?: DraftLayout[];
  ext?: DraftDocExt;
}

/** Prostor, do kterého se kreslí: model, papírový prostor rozvržení, nebo definice bloku (úprava bloku). */
export type DraftSpace = "model" | `layout:${string}` | `block:${string}`;

export const LAYER0 = "0";
export const DEFPOINTS = "Defpoints";
/** standardní tloušťky čar [mm] (DWG LineWeight) */
export const LINEWEIGHTS = [0, 0.05, 0.09, 0.13, 0.15, 0.18, 0.2, 0.25, 0.3, 0.35, 0.4, 0.5, 0.53, 0.6, 0.7, 0.8, 0.9, 1, 1.06, 1.2, 1.4, 1.58, 2, 2.11] as const;
/** nejbližší standardní tloušťka */
export const snapLineweight = (mm: number) => LINEWEIGHTS.reduce((a, b) => (Math.abs(b - mm) < Math.abs(a - mm) ? b : a), 0 as number);

export const defaultVars = (): DraftVars => ({
  units: "mm",
  prec: 4,
  aprec: 0,
  ltscale: 1,
  celtscale: 1,
  clayer: LAYER0,
  cecolor: "ByLayer",
  celtype: "ByLayer",
  celweight: "ByLayer",
  lwdefault: 0.25,
  lwdisplay: false,
  textsize: 2.5,
  textstyle: "Standard",
  pdmode: 0,
  pdsize: 0,
  grid: 10,
  snap: 10,
  measurement: 1,
  mirrtext: 0,
});

export const layer0 = (): DraftLayer => ({ name: LAYER0, color: 7, linetype: "Continuous", lineweight: "Default", on: true, frozen: false, locked: false, plot: true });

const rid = () => Math.random().toString(36).slice(2, 10) + Math.random().toString(36).slice(2, 6);

/** Nový prázdný model: hladina 0, typy čar z knihovny se doplní v `newDraftModel` (linetypes.ts), styl Standard. */
export function baseDraftModel(): DraftModel {
  return {
    v: 1,
    id: rid(),
    seq: 0,
    vars: defaultVars(),
    layers: [layer0()],
    linetypes: [{ name: "Continuous", desc: "Solid line", pattern: [] }],
    textStyles: [{ name: "Standard", font: "Arial", height: 0, wf: 1, oblique: 0 }],
    entities: [],
  };
}

/** Seznam entit prostoru (model / rozvržení / blok); null = prostor neexistuje. */
export function spaceEntities(m: DraftModel, space: DraftSpace = "model"): DraftEntity[] | null {
  if (space === "model") return m.entities;
  if (space.startsWith("layout:")) return m.layouts?.find((l) => l.id === space.slice(7))?.entities ?? null;
  return m.blocks?.find((b) => b.name === space.slice(6))?.entities ?? null;
}

/** Model s nahrazeným seznamem entit prostoru. */
export function withSpaceEntities(m: DraftModel, space: DraftSpace, list: DraftEntity[]): DraftModel {
  if (space === "model") return { ...m, entities: list };
  if (space.startsWith("layout:")) return { ...m, layouts: (m.layouts ?? []).map((l) => (l.id === space.slice(7) ? { ...l, entities: list } : l)) };
  return { ...m, blocks: (m.blocks ?? []).map((b) => (b.name === space.slice(6) ? { ...b, entities: list } : b)) };
}

/** Všechny seznamy entit modelu (model, rozvržení, bloky) – pro přejmenování hladin, typů čar, kontrolu použití. */
export function allEntityLists(m: DraftModel): { space: DraftSpace; list: DraftEntity[] }[] {
  return [
    { space: "model" as DraftSpace, list: m.entities },
    ...(m.layouts ?? []).map((l) => ({ space: `layout:${l.id}` as DraftSpace, list: l.entities })),
    ...(m.blocks ?? []).map((b) => ({ space: `block:${b.name}` as DraftSpace, list: b.entities })),
  ];
}

/** Model se změnou všech entit ve všech prostorech (fn vrací stejnou entitu = beze změny). */
export function mapAllEntities(m: DraftModel, fn: (e: DraftEntity) => DraftEntity): DraftModel {
  const mapList = (list: DraftEntity[]) => {
    let changed = false;
    const out = list.map((e) => {
      const n = fn(e);
      if (n !== e) changed = true;
      return n;
    });
    return changed ? out : list;
  };
  return {
    ...m,
    entities: mapList(m.entities),
    ...(m.layouts ? { layouts: m.layouts.map((l) => ({ ...l, entities: mapList(l.entities) })) } : {}),
    ...(m.blocks ? { blocks: m.blocks.map((b) => ({ ...b, entities: mapList(b.entities) })) } : {}),
  };
}

/** Index entit podle id (mezipaměť podle identity pole). */
const idIndex = new WeakMap<DraftEntity[], Map<string, DraftEntity>>();
export function entityById(list: DraftEntity[], id: string): DraftEntity | undefined {
  let m = idIndex.get(list);
  if (!m) {
    m = new Map(list.map((e) => [e.id, e]));
    idIndex.set(list, m);
  }
  return m.get(id);
}

/** Počet entit ve všech prostorech (obsah dokumentu – sdílení, nedávné soubory, varování při zavření). */
export const draftEntityCount = (m: DraftModel | undefined | null): number => (m ? allEntityLists(m).reduce((s, x) => s + x.list.length, 0) : 0);
