/**
 * Registr prvků rozšíření (plochy, plech, pokročilé modelování…).
 *
 * Každý modul (soubor v `cad/ext/`) zavolá `registerExt({...})` pro každý svůj prvek a je importován z `cad/ext/index.ts`.
 * Prvek v dokumentu má tvar `{ type: "ext", ext: "<id>", data: {...} }`. Jádro (`build.ts`) při stavbě zavolá `build(data, ctx)`,
 * UI vykreslí formulář automaticky z `params` (nebo vlastní `Form` registrovaný v `components/cad/ext/registry.tsx`)
 * a tlačítko na pás karet podle `tab`/`group`. Vše musí běžet v Node (testy) i ve web workeru – žádné DOM API.
 *
 * Konvence: chyby házet jako `new Error("česky, lidsky")`; `build` vrací nové těleso (null = bez geometrie, např. referenční prvek);
 * booleovskou operaci s `ctx.body` si modul dělá sám (`mode` v datech: "new" | "add" | "cut" | "intersect").
 * Pro Pole/Zrcadlení lze zaregistrovat nástrojové těleso: `ctx.tools.set(featureId, { tool, mode })`.
 */
import { tr } from "../i18n";
import type * as r from "replicad";
import type { AxisDef, Direction, PlaneDef, Ref } from "../refs";
import type { BoolMode, CadDoc, Feature, Vec3 } from "../types";

export type Shape = r.Shape3D;
export type SketchF = Extract<Feature, { type: "sketch" }>;

export type ExtBuildCtx = {
  /** aktuální těleso (null = zatím žádné) */
  body: Shape | null;
  /** skici dostupné před tímto prvkem (id → skica) */
  sketches: Map<string, SketchF>;
  /** celý (vyřešený) dokument */
  doc: CadDoc;
  /** index prvku v historii */
  index: number;
  /** id prvku */
  featureId: string;
  /** nástrojová tělesa dřívějších prvků (pro pole/zrcadlení) */
  tools: Map<string, { tool: Shape; mode: BoolMode }>;
  /** všechna tělesa dílu (název → těleso) – více těles; `body` je aktivní/cílové */
  bodies?: Map<string, Shape>;
  /** název aktivního (cílového) tělesa */
  activeBody?: string | null;
  /** vyřeší rovinu zadanou odkazem nad tělesem před prvkem (parametr druhu „plane“) */
  resolvePlane?: (def: PlaneDef) => { origin: Vec3; normal: Vec3; xDir: Vec3 };
  /** vyřeší bod zadaný odkazem nad tělesem před prvkem (parametr druhu „point“) */
  resolvePoint?: (ref: Ref) => Vec3;
  /** vyřeší směr (hrana, normála plochy, dva body…) na jednotkový vektor (parametr druhu „direction“); `base` = normála pro druh „normal“ */
  resolveDirection?: (d: Direction, base?: { normal: Vec3; xDir?: Vec3 }) => Vec3;
  /** vyřeší osu (hrana, válcová plocha, dva body, osy skici…) na počátek a jednotkový směr (parametr druhu „axis“) */
  resolveAxis?: (def: AxisDef, sketchId?: string) => { origin: Vec3; dir: Vec3 };
  /** nahradí jiné (neaktivní) těleso dílu, nebo založí nové s tímto názvem (svarový kov) – aktivní těleso vrací `build` */
  putBody?: (name: string, shape: Shape) => void;
};

/** Parametr pro automatický formulář. */
export type ExtParam =
  | { key: string; label: string; kind: "number"; unit?: string; min?: number; max?: number; step?: number; hint?: string }
  | { key: string; label: string; kind: "bool"; hint?: string }
  | { key: string; label: string; kind: "enum"; options: { v: string; l: string }[]; hint?: string }
  | { key: string; label: string; kind: "text"; hint?: string }
  | { key: string; label: string; kind: "vec3"; hint?: string }
  /** výběr skici z historie (uloží id) */
  | { key: string; label: string; kind: "sketch"; hint?: string }
  /** výběr více skic (uloží id[]) */
  | { key: string; label: string; kind: "sketches"; hint?: string }
  /** výběr dřívějšího prvku (uloží id) – např. pro pole */
  | { key: string; label: string; kind: "feature"; hint?: string }
  /** plochy/hrany vybrané v modelu (uloží number[]); UI přepne výběr */
  | { key: string; label: string; kind: "faces" | "edges"; hint?: string }
  | { key: string; label: string; kind: "mode" }
  /** rovina zadaná odkazem (plocha, tři body, pomocná rovina…): ukládá `PlaneDef`; prázdné = základní rovina a odsazení prvku */
  | { key: string; label: string; kind: "plane"; hint?: string }
  /** bod zadaný odkazem (vrchol, střed hrany, bod skici…): ukládá `Ref`; prázdné = souřadnice prvku */
  | { key: string; label: string; kind: "point"; hint?: string }
  /**
   * směr (osa X / Y / Z, vektor čísly, podél hrany / osy válce, normála plochy, dva body…): ukládá `Direction`.
   * Starší dokumenty mají na stejném klíči „X“ / „Y“ / „Z“ nebo vektor [x, y, z] – stavba i formulář je převedou (`toDirection`).
   * `allowNormal` = nabídnout „kolmo na rovinu skici“ (prázdná hodnota); jinak je výchozí `fallback`.
   */
  | { key: string; label: string; kind: "direction"; allowNormal?: boolean; normalLabel?: string; hint?: string }
  /**
   * osa (počátek + směr: hrana, válcová plocha, dva body, globální osa, pomocná osa, osy skici `sketchKey`…): ukládá `AxisDef`.
   * Starší hodnoty „x“ / „y“ (osa skici) a „X“ / „Y“ / „Z“ (globální osa) se převedou (`toAxisDef`).
   */
  | { key: string; label: string; kind: "axis"; sketchKey?: string; hint?: string };

export type ExtTab = "create" | "surface" | "sheet" | "weld" | "tools" | "asm" | "drawing";

export type ExtDef = {
  /** jedinečné id, např. "surf.extrude" */
  ext: string;
  /** český popisek (pás karet, historie, formulář) */
  label: string;
  /** ikona: název z cad-icons nebo ikona zaregistrovaná přes registerIcon() v UI modulu */
  icon?: string;
  tone?: "sketch" | "create" | "feature" | "cut" | "pattern" | "ref" | "view" | "tool" | "file";
  /** karta pásu */
  tab: ExtTab;
  /** skupina na pásu (popisek pod tlačítky) */
  group: string;
  /** velké tlačítko */
  big?: boolean;
  hint?: string;
  kbd?: string;
  /** pořadí ve skupině */
  order?: number;
  /** výchozí data prvku; `extra` = např. { faces: [...] } z aktuálního výběru */
  make: (doc: CadDoc, extra?: Record<string, unknown>) => Record<string, unknown>;
  /** parametry pro automatický formulář (volitelné – modul může mít vlastní Form v UI registru) */
  params?: ExtParam[];
  /** co se má v modelu vybírat při úpravě prvku (klíč v datech, kam se ukládají indexy) */
  pick?: { kind: "faces" | "edges"; key: string };
  /** zobrazit model před tímto prvkem při úpravě (výběr ploch/hran na původním tělese) */
  rollback?: boolean;
  /** stavba geometrie: vrací nové aktuální těleso; null = prvek bez geometrie (těleso zůstává beze změny) */
  build?: (data: Record<string, unknown>, ctx: ExtBuildCtx) => Promise<Shape | null> | Shape | null;
  /** místo prvku spustí akci v UI (registrovanou v UI registru pod stejným id) – např. export rozvinu */
  action?: boolean;
  /** jen pro sestavy / jen pro díly (výchozí: díly) */
  scope?: "part" | "assembly" | "both";
  /**
   * Starší prvek, který jen opakuje vestavěný prvek s chudším zadáním: na pásu karet, v paletě příkazů ani mezi zkratkami
   * se nenabízí, ale zůstává zaregistrovaný (staré dokumenty a obecný příkaz `prvek <id> …` dál fungují). Text = jednořádková
   * nápověda ve formuláři, kde najít vestavěnou náhradu.
   */
  legacy?: string;
};

const defs = new Map<string, ExtDef>();

export function registerExt(def: ExtDef) {
  if (defs.has(def.ext)) throw new Error(tr("Prvek rozšíření {0} je už zaregistrovaný.", def.ext));
  defs.set(def.ext, def);
  return def;
}
export const getExt = (ext: string) => defs.get(ext);
export const allExt = () => [...defs.values()];
/** prvky nabízené v UI (pás karet, paleta, zkratky, nápověda) – bez starších duplicit (`legacy`) */
export const visibleExt = () => allExt().filter((d) => !d.legacy);
export const extByTab = (tab: ExtTab) => visibleExt().filter((d) => d.tab === tab).sort((a, b) => (a.order ?? 100) - (b.order ?? 100));

/** Prvek rozšíření v dokumentu. */
export type ExtFeature = Extract<Feature, { type: "ext" }>;
export const isExt = (f: Feature): f is ExtFeature => f.type === "ext";
