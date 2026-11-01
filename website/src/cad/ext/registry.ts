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
import type * as r from "replicad";
import type { BoolMode, CadDoc, Feature } from "../types";

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
  | { key: string; label: string; kind: "mode" };

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
};

const defs = new Map<string, ExtDef>();

export function registerExt(def: ExtDef) {
  if (defs.has(def.ext)) throw new Error(`Prvek rozšíření ${def.ext} je už zaregistrovaný.`);
  defs.set(def.ext, def);
  return def;
}
export const getExt = (ext: string) => defs.get(ext);
export const allExt = () => [...defs.values()];
export const extByTab = (tab: ExtTab) => allExt().filter((d) => d.tab === tab).sort((a, b) => (a.order ?? 100) - (b.order ?? 100));

/** Prvek rozšíření v dokumentu. */
export type ExtFeature = Extract<Feature, { type: "ext" }>;
export const isExt = (f: Feature): f is ExtFeature => f.type === "ext";
