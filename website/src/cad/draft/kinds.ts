/**
 * Registr druhů entit 2D výkresu. Každý druh (úsečka, kružnice… a od balíků fáze B mtext, kóta, šrafa, blok, výřez)
 * dodá geometrii pro výpočty (`curves`), kreslicí primitiva (`prims`), obálku, body uchopení, úchopy, transformaci,
 * řádky výpisu (LIST) a pole panelu vlastností. Jádro (vykreslování, výběr, uchopení, dotazy, DXF) pracuje jen přes registr.
 */
import { tr } from "../i18n";
import type { Curve } from "./curves";
import { cBox, cClosest } from "./curves";
import { boxUnion, emptyBox, isEmptyBox, type Affine, type Box } from "./geom";
import type { DraftEntity, DraftEntityType, DraftModel, DraftEntityOf, NewEntity, TextHAlign, TextVAlign, Vec2 } from "./model";

/** Úsek kreslicí dráhy ve světových souřadnicích (úhly v radiánech). */
export type Seg =
  | { k: "L"; a: Vec2; b: Vec2 }
  | { k: "A"; c: Vec2; r: number; a0: number; a1: number; ccw: boolean }
  | { k: "E"; c: Vec2; rx: number; ry: number; rot: number; t0: number; t1: number; ccw: boolean }
  | { k: "P"; pts: Vec2[] };

/** Styl převzatý od bloku (ByBlock) při vykreslení vnořených entit. */
export type ByBlockStyle = { color: number | string; linetype: string; lineweight: number };

/** Kreslicí primitivum ve světových souřadnicích (vykresluje je render.ts stylem entity). */
export type Prim =
  /** dráha (typ čáry se uplatní po celé dráze); `width` = šířka křivky ve světových jednotkách (široká křivka) */
  | { k: "path"; segs: Seg[]; closed?: boolean; width?: number }
  /** plná výplň (sudo-liché pravidlo) – šrafa SOLID, široké úseky křivky, šipky kót */
  | { k: "fill"; rings: Vec2[][] }
  /** text: `p` = bod účaří vlevo (po zarovnání), výška, natočení [rad], šířkový faktor, sklon [rad] */
  | { k: "text"; p: Vec2; h: number; rot: number; s: string; font: string; wf: number; oblique: number }
  /** bod (vzhled dle PDMODE / PDSIZE) */
  | { k: "mark"; p: Vec2 }
  /** nekonečná přímka / polopřímka – vykreslí se oříznutá na okno */
  | { k: "inf"; p: Vec2; dir: Vec2; ray: boolean }
  /** vnořené entity s transformací (vložení bloku – balík 3); `byBlock` = vlastnosti bloku pro ByBlock */
  | { k: "sub"; entities: DraftEntity[]; xf: Affine; byBlock?: ByBlockStyle; clip?: Vec2[] };

export type SnapKind = "end" | "mid" | "cen" | "qua" | "int" | "per" | "tan" | "nea" | "nod" | "ins" | "ext" | "app";
export type SnapPt = { kind: SnapKind; p: Vec2 };

/** Pole panelu vlastností (geometrie). `key` se zadává i textem: `2d nastavit e3 r=25`. */
export type DraftField = { key: string; label: string; value: string | number; kind: "num" | "pt" | "text" | "angle" | "int" | "bool"; readonly?: boolean };
/** řádek výpisu LIST */
export type InfoRow = [string, string];

export type KindCtx = { model: DraftModel };

export interface DraftKind<E extends DraftEntity = DraftEntity> {
  type: E["type"];
  /** název druhu v jazyce rozhraní (Úsečka, Kružnice…) */
  label(): string;
  /** geometrie pro výpočty: uchopení, průsečíky, výběr, vzdálenost; prázdné = jen obálka (text) */
  curves(e: E, ctx: KindCtx): Curve[];
  prims(e: E, ctx: KindCtx): Prim[];
  /** obálka; null = nekonečná entita (přímka, polopřímka) */
  bbox(e: E, ctx: KindCtx): Box | null;
  /** charakteristické body uchopení (konec, střed, kvadrant, uzel, bod vložení) */
  snaps(e: E, ctx: KindCtx): SnapPt[];
  /** úchopy (modré čtverečky u vybrané entity) */
  grips(e: E, ctx: KindCtx): Vec2[];
  /** posun úchopu i na bod p (null = úchop se táhnout nedá) – úpravy úchopy (balík 1) */
  moveGrip?(e: E, i: number, p: Vec2, ctx: KindCtx): E | null;
  /** obraz entity v afinní transformaci (posun, otočení, měřítko, zrcadlení); null = nelze (např. text při zkosení) */
  transform(e: E, m: Affine, ctx: KindCtx): DraftEntity | null;
  /** geometrické řádky výpisu LIST (společné vlastnosti doplní jádro) */
  info(e: E, ctx: KindCtx, f: Fmt): InfoRow[];
  /** geometrická pole panelu vlastností */
  fields(e: E, ctx: KindCtx, f: Fmt): DraftField[];
  /** nastaví pole (hodnota textem, jako ji zadal uživatel / agent); chyba = výjimka s důvodem */
  setField(e: E, key: string, raw: string, ctx: KindCtx): E;
  /** délka / obvod a plocha (u uzavřených) pro dotazy */
  measure?(e: E, ctx: KindCtx): { length?: number; area?: number; closed?: boolean };
  /** výběr kliknutím u entit bez křivek (text): vzdálenost bodu od entity */
  hitDist?(e: E, p: Vec2, ctx: KindCtx): number;
  /**
   * rozložení (EXPLODE – příkaz balíku 1): na jaké entity se entita rozloží (vložení bloku → entity bloku, kóta → čáry,
   * šipky a text, mtext → texty…); chybí / null = entitu rozložit nelze. Křivky jádra rozkládá balík 1 sám.
   */
  explode?(e: E, ctx: KindCtx): NewEntity[] | null;
}

/** formátování čísel podle přesnosti výkresu */
export type Fmt = { len: (v: number) => string; ang: (deg: number) => string; pt: (p: Vec2) => string };

const REG = new Map<string, DraftKind>();

/** Registrace druhu entity (jádro: kinds-core.ts; balíky fáze B ve svých souborech). */
export function registerKind<T extends DraftEntityType>(k: DraftKind<DraftEntityOf<T>>): void {
  REG.set(k.type, k as unknown as DraftKind);
}
export const kindOf = (e: DraftEntity | DraftEntityType): DraftKind | undefined => REG.get(typeof e === "string" ? e : e.type);
export const kinds = (): DraftKind[] => [...REG.values()];
export const kindLabel = (t: string) => REG.get(t)?.label() ?? t;

const NONE: Curve[] = [];
/** mezipaměť geometrie podle identity entity (entity jsou neměnné – změna = nový objekt) */
let curveCache = new WeakMap<DraftEntity, Curve[]>();
let primCache = new WeakMap<DraftEntity, Prim[]>();
let boxCache = new WeakMap<DraftEntity, Box | null>();
/** Zahodí mezipaměť geometrie (po změně textových stylů, PDMODE, definic bloků – vzhled závisí i na modelu). */
export function invalidateGeometry() {
  curveCache = new WeakMap();
  primCache = new WeakMap();
  boxCache = new WeakMap();
}

export function entityCurves(e: DraftEntity, ctx: KindCtx): Curve[] {
  let c = curveCache.get(e);
  if (!c) {
    c = kindOf(e)?.curves(e, ctx) ?? NONE;
    curveCache.set(e, c);
  }
  return c;
}
export function entityPrims(e: DraftEntity, ctx: KindCtx): Prim[] {
  let p = primCache.get(e);
  if (!p) {
    p = kindOf(e)?.prims(e, ctx) ?? [];
    primCache.set(e, p);
  }
  return p;
}
export function entityBox(e: DraftEntity, ctx: KindCtx): Box | null {
  if (boxCache.has(e)) return boxCache.get(e)!;
  const k = kindOf(e);
  let b: Box | null = null;
  try {
    b = k ? k.bbox(e, ctx) : null;
  } catch {
    b = null;
  }
  if (b && isEmptyBox(b)) b = null;
  boxCache.set(e, b);
  return b;
}
/** obálka z křivek (pomůcka pro druhy) */
export function curvesBox(cs: Curve[]): Box | null {
  let b = emptyBox();
  for (const c of cs) {
    const cb = cBox(c);
    if (!cb) return null;
    b = boxUnion(b, cb);
  }
  return isEmptyBox(b) ? null : b;
}
/** Vzdálenost bodu od entity (výběr kliknutím). */
export function entityDist(e: DraftEntity, p: Vec2, ctx: KindCtx): number {
  const k = kindOf(e);
  if (k?.hitDist) return k.hitDist(e, p, ctx);
  let d = Infinity;
  for (const c of entityCurves(e, ctx)) d = Math.min(d, cClosest(c, p).d);
  return d;
}

/** Vlastní souřadnice zarovnání textu (pomůcka pro druhy s textem – jednořádkový text, atributy, mtext). */
export function alignText(width: number, h: number, ha: TextHAlign | undefined, va: TextVAlign | undefined): Vec2 {
  const dx = ha === "center" || ha === "middle" ? -width / 2 : ha === "right" ? -width : 0;
  const dy = ha === "middle" ? -h / 2 : va === "top" ? -h : va === "middle" ? -h / 2 : va === "bottom" ? h * 0.25 : 0;
  return [dx, dy];
}

/** odhad šířky textu (bez písma): průměrná šířka znaku 0,62 × výška × šířkový faktor (písmo vykreslení je proporcionální) */
let measure: ((s: string, font: string) => number) | null = null;
/** renderer nastaví přesné měření šířky textu (canvas) – v testech a bez prohlížeče platí odhad */
export const setTextMeasure = (fn: ((s: string, font: string) => number) | null) => void (measure = fn);
/** šířka textu výšky 1 */
export const textWidth1 = (s: string, font: string) => (measure ? measure(s, font) : s.length * 0.62);

export const noTransform = () => tr("entitu nelze takto transformovat");
