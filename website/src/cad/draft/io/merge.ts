/**
 * Vložení obsahu jiného výkresu (DXF / DWG) do otevřeného 2D výkresu – obdoba „vložit výkres“ v AutoCADu:
 * entity modelového prostoru se přidají do aktuálního prostoru (nová id, jeden krok historie), tabulky (hladiny, typy čar,
 * textové a kótovací styly) a definice bloků se doplní jen tam, kde název ještě neexistuje (existující mají přednost –
 * jako AutoCAD „duplicitní definice ignorována“). Anonymní bloky (*D geometrie kót, *U dynamických bloků, *T tabulek…)
 * se stejným názvem jako v cílovém výkresu se přejmenují na volný název (*D13 …) a odkazy vložených entit na ně se
 * přepíšou – jinak by vložená kóta / vložení ukazovaly na cizí geometrii. Rozdílné jednotky (INSUNITS) se převedou měřítkem.
 */
import { geomKey } from "./common";
import { kindOf } from "../kinds";
import type { DraftBlock, DraftEntity, DraftModel } from "../model";
import type { DraftTx } from "../tx";
import { UNITS } from "../units";

export type MergeReport = {
  /** počet vložených entit */
  entities: number;
  /** id vložených entit (v pořadí zdroje) */
  ids: string[];
  /** vložené entity, které lze vybrat (ne na zamčené, zmrazené ani vypnuté hladině) – výběr po vložení */
  selectable: string[];
  /** nově přidané položky tabulek */
  layers: string[];
  linetypes: string[];
  textStyles: string[];
  dimStyles: string[];
  blocks: string[];
  /** bloky se stejným názvem už ve výkresu jsou – použije se existující definice */
  keptBlocks: string[];
  /** měřítko převodu jednotek (zdroj → výkres) */
  scale: number;
  /** rozvržení zdroje s obsahem (papírové prostory) se nevkládají */
  layouts: number;
  /** druhy entit, které nešlo převést měřítkem (vloženy beze změny) */
  unscaled: string[];
};

const lc = (s: string) => s.toLowerCase();

/**
 * Vloží `src` do transakce `tx` (aktuální prostor transakce). Vrací přehled vloženého; entity zdroje dostanou nová id
 * (odkazy šraf na hranice se přečíslují).
 */
export function mergeDraftInto(tx: DraftTx, src: DraftModel): MergeReport {
  const dst = tx.model;
  const su = src.vars.units;
  const du = dst.vars.units;
  const scale = su !== du && su !== "unitless" && du !== "unitless" ? UNITS[su].mm / UNITS[du].mm : 1;
  const rep: MergeReport = { entities: 0, ids: [], selectable: [], layers: [], linetypes: [], textStyles: [], dimStyles: [], blocks: [], keptBlocks: [], scale, layouts: src.layouts?.filter((l) => l.entities.length).length ?? 0, unscaled: [] };
  const xf: [number, number, number, number, number, number] = [scale, 0, 0, scale, 0, 0];
  const unscaled = new Set<string>();
  const scaled = (e: DraftEntity): DraftEntity => {
    if (scale === 1) return e;
    const k = kindOf(e);
    const t = k ? k.transform(e, xf, { model: dst }) : null;
    if (!t) unscaled.add(e.type);
    return t ?? e;
  };

  // tabulky a definice bloků (jen nové názvy)
  const have = (list: { name: string }[] | undefined, name: string) => !!list?.some((x) => lc(x.name) === lc(name));
  // anonymní bloky zdroje, jejichž název už cíl má → nový volný název se stejnou předponou
  const isAnon = (b: DraftBlock) => !!(b as { anonymous?: boolean }).anonymous || b.name.startsWith("*");
  const taken = new Set([...(dst.blocks ?? []), ...(src.blocks ?? [])].map((b) => lc(b.name)));
  const rename = new Map<string, string>();
  for (const b of src.blocks ?? [])
    if (isAnon(b) && have(dst.blocks, b.name)) {
      const pre = /^\*[A-Za-z]*/.exec(b.name)?.[0] || "*U";
      let i = 1;
      while (taken.has(lc(pre + i))) i++;
      taken.add(lc(pre + i));
      rename.set(lc(b.name), pre + i);
    }
  const refs = (e: DraftEntity): DraftEntity => (rename.size ? renameBlockRefs(e, rename) : e);
  tx.setModel((m) => {
    const layers = [...m.layers];
    for (const l of src.layers)
      if (!have(layers, l.name)) {
        layers.push(l);
        rep.layers.push(l.name);
      }
    const linetypes = [...m.linetypes];
    for (const l of src.linetypes)
      if (!have(linetypes, l.name)) {
        linetypes.push(scale === 1 ? l : { ...l, pattern: l.pattern.map((v) => v * scale) });
        rep.linetypes.push(l.name);
      }
    const textStyles = [...m.textStyles];
    for (const s of src.textStyles)
      if (!have(textStyles, s.name)) {
        textStyles.push(scale === 1 ? s : { ...s, height: s.height * scale });
        rep.textStyles.push(s.name);
      }
    const dimStyles = [...(m.dimStyles ?? [])];
    for (const s of src.dimStyles ?? [])
      if (!have(dimStyles, s.name)) {
        dimStyles.push(s);
        rep.dimStyles.push(s.name);
      }
    const blocks: DraftBlock[] = [...(m.blocks ?? [])];
    for (const b of src.blocks ?? []) {
      const name = rename.get(lc(b.name)) ?? b.name;
      if (have(blocks, name)) {
        if (!isAnon(b)) rep.keptBlocks.push(b.name);
        continue;
      }
      blocks.push(rename.size ? { ...b, name, entities: b.entities.map(refs) } : b);
      rep.blocks.push(name);
    }
    return { ...m, layers, linetypes, textStyles, ...(dimStyles.length ? { dimStyles } : {}), ...(blocks.length ? { blocks } : {}) };
  });
  // entity bloků potřebují id jedinečná v celém výkresu
  if (rep.blocks.length) {
    const added = new Set(rep.blocks.map(lc));
    tx.setModel((m) => ({ ...m, blocks: (m.blocks ?? []).map((b) => (added.has(lc(b.name)) ? { ...b, entities: renumber(b.entities, () => tx.newId()) } : b)) }));
  }

  // entity modelového prostoru zdroje → aktuální prostor (nová id, CECOLOR / CELTYPE… se nepoužijí – vlastnosti zůstanou)
  const v = tx.model.vars;
  const ids = new Map<string, string>();
  const list = src.entities.map((e) => {
    const id = tx.newId();
    ids.set(e.id, id);
    return { ...scaled(refs(e)), id } as DraftEntity;
  });
  for (const e of list) {
    const n = remap(e, ids) as DraftEntity & Record<string, unknown>;
    if (n.color === undefined && v.cecolor !== "ByLayer") n.color = "ByLayer";
    if (n.linetype === undefined && !/^bylayer$/i.test(v.celtype)) n.linetype = "ByLayer";
    if (n.lineweight === undefined && v.celweight !== "ByLayer") n.lineweight = "ByLayer";
    if (n.ltscale === undefined && v.celtscale !== 1) n.ltscale = 1;
    rep.ids.push(tx.add(n));
  }
  rep.entities = rep.ids.length;
  // výběr jen tam, kde by ho uživatel sám mohl udělat (zamčené hladiny se nesmí dát smazat / posunout)
  const lay = new Map(tx.model.layers.map((l) => [lc(l.name), l]));
  rep.selectable = rep.ids.filter((_id, i) => {
    const L = lay.get(lc(list[i].layer));
    return !L || (!L.locked && !L.frozen && L.on !== false);
  });
  rep.unscaled = [...unscaled];
  return rep;
}

/** odkazy entity na bloky (vložení, geometrie kóty v ext.block) podle mapy přejmenování (klíč malými písmeny) */
function renameBlockRefs(e: DraftEntity, rename: Map<string, string>): DraftEntity {
  const o = e as DraftEntity & { block?: string };
  const nb = typeof o.block === "string" ? rename.get(lc(o.block)) : undefined;
  const xb = typeof o.ext?.block === "string" ? rename.get(lc(o.ext.block as string)) : undefined;
  if (!nb && !xb) return e;
  const n = { ...o, ...(nb ? { block: nb } : {}) } as DraftEntity & { block?: string };
  if (o.ext) {
    // otisk geometrie (ext.key) obsahuje název bloku vložení – platný otisk zůstane platný
    const keyOk = !!o.ext.key && o.ext.key === geomKey(e);
    n.ext = { ...o.ext, ...(xb ? { block: xb } : {}) };
    if (keyOk) n.ext.key = geomKey(n);
  }
  return n;
}

/** odkazy na id jiných entit (asociativní hranice šrafy) podle mapy */
function remap(e: DraftEntity, ids: Map<string, string>): DraftEntity {
  const b = (e as { boundary?: string[] }).boundary;
  if (!Array.isArray(b)) return { ...e };
  return { ...e, boundary: b.map((x) => ids.get(x) ?? x) } as DraftEntity;
}

/** nová id entit seznamu (+ přečíslování odkazů uvnitř seznamu) */
function renumber(list: DraftEntity[], next: () => string): DraftEntity[] {
  const ids = new Map<string, string>();
  for (const e of list) ids.set(e.id, next());
  return list.map((e) => ({ ...remap(e, ids), id: ids.get(e.id)! }) as DraftEntity);
}
