/**
 * Hladiny 2D výkresu (správce hladin): založení, přejmenování, smazání, aktuální hladina, barva, typ čáry, tloušťka,
 * zapnout/vypnout, zmrazit/rozmrazit, zamknout, tisk, popis – a výsledný styl entity (ByLayer / ByBlock).
 */
import { tr } from "../i18n";
import { colorLabel } from "./colors";
import { findLinetype, loadLinetype } from "./linetypes";
import { allEntityLists, DEFPOINTS, LAYER0, mapAllEntities, type DraftColor, type DraftEntity, type DraftLayer, type DraftLinetype, type DraftLw, type DraftModel } from "./model";
import type { ByBlockStyle } from "./kinds";

/** Znaky, které AutoCAD v názvech hladin nepovoluje. */
const BAD = /[<>/\\":;?*|=`]/;

export function findLayer(m: DraftModel, name: string): DraftLayer | undefined {
  const n = name.trim().toLowerCase();
  return m.layers.find((l) => l.name.toLowerCase() === n);
}

export function validLayerName(name: string): string | null {
  const n = name.trim();
  if (!n) return tr("název hladiny nesmí být prázdný");
  if (n.length > 255) return tr("název hladiny je delší než 255 znaků");
  if (BAD.test(n)) return tr("název hladiny nesmí obsahovat znaky < > / \\ \" : ; ? * | = `");
  return null;
}

export type LayerPatch = Partial<Omit<DraftLayer, "name">>;

/** ověří vlastnosti hladiny (barva bez ByLayer/ByBlock, typ čáry existuje – z knihovny se načte) */
function checkPatch(m: DraftModel, p: LayerPatch): [DraftModel, LayerPatch] {
  let model = m;
  const out: LayerPatch = { ...p };
  if (p.color !== undefined) {
    if (p.color === "ByLayer" || p.color === "ByBlock" || (typeof p.color === "number" && (p.color < 1 || p.color > 255))) throw new Error(tr("barva hladiny musí být ACI 1–255 nebo #rrggbb"));
  }
  if (p.linetype !== undefined) {
    if (/^by(layer|block)$/i.test(p.linetype)) throw new Error(tr("hladina nemůže mít typ čáry {0}", p.linetype));
    const [m2, lt] = loadLinetype(model, p.linetype);
    if (!lt) throw new Error(tr("typ čáry „{0}“ není ve výkresu ani v knihovně – typy: {1}", p.linetype, m.linetypes.map((l) => l.name).join(", ")));
    model = m2;
    out.linetype = lt.name;
  }
  if (p.lineweight !== undefined && p.lineweight !== "Default" && !(typeof p.lineweight === "number" && p.lineweight >= 0 && p.lineweight <= 2.11)) throw new Error(tr("tloušťka čáry hladiny: 0–2,11 mm nebo Default"));
  return [model, out];
}

/** Založí hladinu (název musí být volný). */
export function createLayer(m: DraftModel, name: string, props: LayerPatch = {}): DraftModel {
  const err = validLayerName(name);
  if (err) throw new Error(err);
  if (findLayer(m, name)) throw new Error(tr("hladina „{0}“ už existuje", name.trim()));
  const [m2, p] = checkPatch(m, props);
  const layer: DraftLayer = { name: name.trim(), color: 7, linetype: "Continuous", lineweight: "Default", on: true, frozen: false, locked: false, plot: name.trim().toLowerCase() !== DEFPOINTS.toLowerCase(), ...p };
  return { ...m2, layers: [...m2.layers, layer] };
}

/** Změní vlastnosti hladiny. Zmrazit aktuální hladinu nelze (jako AutoCAD). */
export function setLayer(m: DraftModel, name: string, props: LayerPatch): DraftModel {
  const l = findLayer(m, name);
  if (!l) throw new Error(tr("hladina „{0}“ neexistuje – hladiny: {1}", name, m.layers.map((x) => x.name).join(", ")));
  if (props.frozen && l.name.toLowerCase() === m.vars.clayer.toLowerCase()) throw new Error(tr("aktuální hladinu „{0}“ nelze zmrazit – nejdřív nastavte jinou aktuální", l.name));
  const [m2, p] = checkPatch(m, props);
  return { ...m2, layers: m2.layers.map((x) => (x === l ? { ...x, ...p } : x)) };
}

/** Nastaví aktuální hladinu (CLAYER); zmrazená hladina nemůže být aktuální. */
export function setCurrentLayer(m: DraftModel, name: string): DraftModel {
  const l = findLayer(m, name);
  if (!l) throw new Error(tr("hladina „{0}“ neexistuje – hladiny: {1}", name, m.layers.map((x) => x.name).join(", ")));
  if (l.frozen) throw new Error(tr("zmrazená hladina „{0}“ nemůže být aktuální", l.name));
  return { ...m, vars: { ...m.vars, clayer: l.name } };
}

/** Přejmenuje hladinu včetně odkazů všech entit (model, rozvržení, bloky) a CLAYER. Hladinu 0 a Defpoints nelze. */
export function renameLayer(m: DraftModel, from: string, to: string): DraftModel {
  const l = findLayer(m, from);
  if (!l) throw new Error(tr("hladina „{0}“ neexistuje", from));
  if (l.name === LAYER0 || l.name.toLowerCase() === DEFPOINTS.toLowerCase()) throw new Error(tr("hladinu „{0}“ nelze přejmenovat", l.name));
  const err = validLayerName(to);
  if (err) throw new Error(err);
  const other = findLayer(m, to);
  if (other && other !== l) throw new Error(tr("hladina „{0}“ už existuje", to.trim()));
  const nn = to.trim();
  const m2 = mapAllEntities(m, (e) => (e.layer === l.name ? { ...e, layer: nn } : e));
  return { ...m2, layers: m2.layers.map((x) => (x === l ? { ...x, name: nn } : x)), vars: { ...m2.vars, clayer: m2.vars.clayer === l.name ? nn : m2.vars.clayer } };
}

/** počet entit na hladině (všechny prostory) */
export function layerUse(m: DraftModel, name: string): number {
  let n = 0;
  for (const { list } of allEntityLists(m)) for (const e of list) if (e.layer === name) n++;
  return n;
}

/**
 * Smaže hladinu. Nelze smazat 0, Defpoints, aktuální hladinu ani hladinu s entitami – ledaže `moveTo` = jiná hladina
 * (entity se přesunou) nebo `purge` = entity se smažou spolu s hladinou.
 */
export function deleteLayer(m: DraftModel, name: string, opts: { moveTo?: string; purge?: boolean } = {}): DraftModel {
  const l = findLayer(m, name);
  if (!l) throw new Error(tr("hladina „{0}“ neexistuje", name));
  if (l.name === LAYER0 || l.name.toLowerCase() === DEFPOINTS.toLowerCase()) throw new Error(tr("hladinu „{0}“ nelze smazat", l.name));
  if (l.name.toLowerCase() === m.vars.clayer.toLowerCase()) throw new Error(tr("aktuální hladinu „{0}“ nelze smazat – nejdřív nastavte jinou aktuální", l.name));
  const used = layerUse(m, l.name);
  let model = m;
  if (used) {
    if (opts.moveTo) {
      const t = findLayer(m, opts.moveTo);
      if (!t || t === l) throw new Error(tr("cílová hladina „{0}“ neexistuje", opts.moveTo));
      model = mapAllEntities(m, (e) => (e.layer === l.name ? { ...e, layer: t.name } : e));
    } else if (opts.purge) {
      model = {
        ...m,
        entities: m.entities.filter((e) => e.layer !== l.name),
        ...(m.layouts ? { layouts: m.layouts.map((x) => ({ ...x, entities: x.entities.filter((e) => e.layer !== l.name) })) } : {}),
        ...(m.blocks ? { blocks: m.blocks.map((x) => ({ ...x, entities: x.entities.filter((e) => e.layer !== l.name) })) } : {}),
      };
    } else throw new Error(tr("hladina „{0}“ obsahuje {1} entit – přesuňte je („přesunout-na 0“) nebo smažte spolu s hladinou („i-s-entitami“)", l.name, used));
  }
  return { ...model, layers: model.layers.filter((x) => x !== l) };
}

/** Entita je vidět (hladina zapnutá a nezmrazená). */
export function layerVisible(m: DraftModel, name: string): boolean {
  const l = findLayer(m, name);
  return !l || (l.on && !l.frozen);
}
/** Entitu lze upravovat (hladina není zamčená). */
export const layerLocked = (m: DraftModel, name: string) => !!findLayer(m, name)?.locked;
export const isVisible = (m: DraftModel, e: DraftEntity) => layerVisible(m, e.layer);
export const isEditable = (m: DraftModel, e: DraftEntity) => !layerLocked(m, e.layer);

/** Výsledný styl entity pro vykreslení / tisk. */
export type ResolvedStyle = { color: number | string; linetype: DraftLinetype | null; lineweight: number; ltscale: number; plot: boolean; layer: DraftLayer | null };

const layerCache = new WeakMap<DraftLayer[], Map<string, DraftLayer>>();
function layerMap(m: DraftModel) {
  let mm = layerCache.get(m.layers);
  if (!mm) {
    mm = new Map(m.layers.map((l) => [l.name, l]));
    layerCache.set(m.layers, mm);
  }
  return mm;
}
const ltCache = new WeakMap<DraftLinetype[], Map<string, DraftLinetype>>();
function ltMap(m: DraftModel) {
  let mm = ltCache.get(m.linetypes);
  if (!mm) {
    mm = new Map(m.linetypes.map((l) => [l.name.toLowerCase(), l]));
    ltCache.set(m.linetypes, mm);
  }
  return mm;
}

/**
 * Výsledná barva, typ čáry a tloušťka entity: ByLayer → hladina (u entity na hladině 0 uvnitř bloku hladina vložení),
 * ByBlock → vlastnosti vložení bloku (`byBlock`, jinak bílá/černá, Continuous, výchozí tloušťka).
 */
export function resolveStyle(m: DraftModel, e: DraftEntity, byBlock?: ByBlockStyle | null): ResolvedStyle {
  const layer = layerMap(m).get(e.layer) ?? findLayer(m, e.layer) ?? null;
  const c = e.color ?? "ByLayer";
  const color: number | string = c === "ByLayer" ? (layer?.color ?? 7) : c === "ByBlock" ? (byBlock?.color ?? 7) : c;
  const ltn = e.linetype ?? "ByLayer";
  const ltName = /^bylayer$/i.test(ltn) ? (layer?.linetype ?? "Continuous") : /^byblock$/i.test(ltn) ? (byBlock?.linetype ?? "Continuous") : ltn;
  const lt = ltMap(m).get(ltName.toLowerCase()) ?? null;
  const lw0: DraftLw = e.lineweight ?? "ByLayer";
  const lwL = layer?.lineweight ?? "Default";
  const lw = lw0 === "ByLayer" ? (lwL === "Default" ? m.vars.lwdefault : lwL) : lw0 === "ByBlock" ? (byBlock?.lineweight ?? m.vars.lwdefault) : lw0 === "Default" ? m.vars.lwdefault : lw0;
  return { color, linetype: lt, lineweight: lw, ltscale: (e.ltscale ?? 1) * m.vars.ltscale, plot: layer?.plot ?? true, layer };
}

/** popis tloušťky čáry */
export const lwLabel = (lw: DraftLw | undefined) => (lw === undefined || lw === "ByLayer" ? tr("DleHladiny") : lw === "ByBlock" ? tr("DleBloku") : lw === "Default" ? tr("Výchozí") : `${lw.toFixed(2)} mm`);
export const ltLabel = (lt: string | undefined) => (!lt || /^bylayer$/i.test(lt) ? tr("DleHladiny") : /^byblock$/i.test(lt) ? tr("DleBloku") : lt);
export { colorLabel };

/** typ čáry použitý v entitách nebo hladinách (nelze vyčistit) */
export function linetypeUsed(m: DraftModel, name: string): boolean {
  const n = name.toLowerCase();
  if (m.layers.some((l) => l.linetype.toLowerCase() === n)) return true;
  return allEntityLists(m).some(({ list }) => list.some((e) => e.linetype?.toLowerCase() === n));
}
/** ověří typ čáry pro entitu (ByLayer / ByBlock / načtený nebo z knihovny) a vrátí model s načteným typem */
export function ensureLinetype(m: DraftModel, name: string): [DraftModel, string] {
  if (/^bylayer$/i.test(name)) return [m, "ByLayer"];
  if (/^byblock$/i.test(name)) return [m, "ByBlock"];
  const have = findLinetype(m, name);
  if (have) return [m, have.name];
  const [m2, lt] = loadLinetype(m, name);
  if (!lt) throw new Error(tr("typ čáry „{0}“ není ve výkresu ani v knihovně – typy: {1}", name, m.linetypes.map((l) => l.name).join(", ")));
  return [m2, lt.name];
}

export type { DraftColor };
