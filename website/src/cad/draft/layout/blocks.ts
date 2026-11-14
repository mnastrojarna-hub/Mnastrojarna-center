/**
 * BALÍK 3 (layout) – bloky: hledání definice, kreslený obsah vložení (bez definic atributů), obálka bloku, atributy
 * z definic, předefinování (nová identita vložení = čerstvé mezipaměti geometrie), závislosti vnořených bloků,
 * čištění (PURGE) a extrakce atributů (ATTEXT).
 */
import { tr } from "../../i18n";
import { boxAdd, boxUnion, emptyBox, isEmptyBox, xfDet, xfMul, xfPt, xfUniform, xfVec, type Affine, type Box } from "../geom";
import { entityBox, kindOf, type KindCtx } from "../kinds";
import { allEntityLists, mapAllEntities, type DText, type DraftBlock, type DraftEntity, type DraftModel, type Vec2 } from "../model";
import type { DAttDef, DAttrib, DInsert } from "./types";
import { normDeg } from "../units";
import { cosSinDeg, fold, insertXf } from "./util";

/** definice bloku podle názvu (bez ohledu na velikost písmen) */
export function findBlock(m: DraftModel, name: string): DraftBlock | undefined {
  const blocks = m.blocks ?? [];
  return blocks.find((b) => b.name === name) ?? blocks.find((b) => b.name.toLowerCase() === name.toLowerCase());
}

/** platný název bloku (jako AutoCAD: bez < > / \ " : ; ? * | = `, nejvýš 255 znaků; „*“ na začátku = anonymní) */
export function validBlockName(name: string): string | null {
  const n = name.trim();
  if (!n) return tr("název bloku je prázdný");
  if (n.length > 255) return tr("název bloku je delší než 255 znaků");
  if (/[<>/\\":;?*|=`]/.test(n)) return tr("název bloku „{0}“ obsahuje nepovolený znak (< > / \\ \" : ; ? * | = `)", n);
  return null;
}

/** text z definice atributu / atributu (pro vykreslení a transformaci přes druh „text“) */
export function attToText(a: Pick<DAttDef, "p" | "h" | "rot" | "style" | "halign" | "valign" | "p2"> & { wf?: number }, s: string, base: { id: string; layer: string; color?: DraftEntity["color"] }): DText {
  return {
    type: "text",
    id: base.id,
    layer: base.layer,
    ...(base.color !== undefined ? { color: base.color } : {}),
    p: a.p,
    h: a.h,
    s,
    ...(a.rot ? { rot: a.rot } : {}),
    ...(a.style ? { style: a.style } : {}),
    ...(a.halign ? { halign: a.halign } : {}),
    ...(a.valign ? { valign: a.valign } : {}),
    ...(a.p2 ? { p2: a.p2 } : {}),
    ...(a.wf && a.wf !== 1 ? { wf: a.wf } : {}),
  };
}

/** geometrie textu po transformaci zpět do atributu (poloha, výška, natočení, zarovnání) */
function textGeom(t: DText): Pick<DAttrib, "p" | "h" | "rot" | "p2" | "halign" | "valign" | "wf"> {
  return { p: t.p, h: t.h, ...(t.rot ? { rot: t.rot } : {}), ...(t.p2 ? { p2: t.p2 } : {}), ...(t.halign ? { halign: t.halign } : {}), ...(t.valign ? { valign: t.valign } : {}), ...(t.wf && t.wf !== 1 ? { wf: t.wf } : {}) };
}

const roundDeg = (r: number) => {
  const n = normDeg(r);
  if (Math.abs(n - Math.round(n)) < 1e-9) return Math.round(n) % 360;
  return Math.round(n * 1e9) / 1e9;
};

/**
 * Text po nestejnoměrné transformaci s kladným determinantem (vložení s měřítky X ≠ Y): poloha a zarovnávací bod se
 * transformují, směr textu = obraz osy X textu, výška × (det / |obraz osy X|), šířkový faktor × |obraz osy X| / (výškový
 * násobek) – jako atributy AutoCADu ve vložení s různými měřítky (sklon písma se nevyjadřuje).
 */
function textNonUniform(t: DText, m: Affine): DText | null {
  const det = xfDet(m);
  const [c, s] = cosSinDeg(t.rot ?? 0);
  const X = xfVec(m, [c, s]);
  const nx = Math.hypot(X[0], X[1]);
  if (!(det > 0) || nx < 1e-300) return null;
  const k = det / nx;
  const rot = roundDeg((Math.atan2(X[1], X[0]) * 180) / Math.PI);
  const wf = ((t.wf ?? 1) * nx) / k;
  const out: DText = { ...t, p: xfPt(m, t.p), h: t.h * k, rot, wf, ...(t.p2 ? { p2: xfPt(m, t.p2) } : {}) };
  if (!rot) delete out.rot;
  if (Math.abs(wf - 1) < 1e-12) delete out.wf;
  return out;
}

/** text po afinní transformaci: podobnost přes druh „text“ jádra (MIRRTEXT), jinak nestejnoměrně (zrcadlení přes osu textu) */
function transformText(t: DText, m: Affine, ctx: KindCtx): DText | null {
  const tk = kindOf("text");
  if (!tk) return null;
  if (xfUniform(m) !== null) {
    const r = tk.transform(t, m, ctx) as DText | null;
    return r && r.type === "text" ? r : null;
  }
  if (xfDet(m) > 0) return textNonUniform(t, m);
  // záporný determinant: m = (m ∘ F) ∘ F; F = zrcadlení přes osu půlící úhel mezi směrem textu a jeho obrazem – druh
  // „text“ ho převede čitelně (MIRRTEXT), zbytek m ∘ F má kladný determinant a směr textu už nemění (žádné převrácení)
  const [cu, su] = cosSinDeg(t.rot ?? 0);
  const X = xfVec(m, [cu, su]);
  if (Math.hypot(X[0], X[1]) < 1e-300) return null;
  const a2 = Math.atan2(su, cu) + Math.atan2(X[1], X[0]);
  const snap = (v: number) => (Math.abs(v) < 1e-14 ? 0 : Math.abs(Math.abs(v) - 1) < 1e-14 ? Math.sign(v) : v);
  const c = snap(Math.cos(a2));
  const s = snap(Math.sin(a2));
  const F: Affine = [c, s, s, -c, t.p[0] - (c * t.p[0] + s * t.p[1]), t.p[1] - (s * t.p[0] - c * t.p[1])];
  const tf = tk.transform(t, F, ctx) as DText | null;
  if (!tf || tf.type !== "text") return null;
  return textNonUniform(tf, xfMul(m, F));
}

/** atribut po afinní transformaci (MIRRTEXT respektuje druh „text“ jádra; různá měřítka X / Y = výška a šířkový faktor); null = nelze */
export function transformAttrib(a: DAttrib, m: Affine, ctx: KindCtx): DAttrib | null {
  const t = transformText(attToText(a, a.value, { id: "~a", layer: a.layer ?? "0" }), m, ctx);
  if (!t) return null;
  const g = textGeom(t);
  const out: DAttrib = { ...a, ...g };
  if (!g.rot) delete out.rot;
  if (!g.p2) delete out.p2;
  if (!g.wf) delete out.wf;
  return out;
}

/** definice atributů bloku (v pořadí) */
export const blockAttDefs = (b: DraftBlock | undefined): DAttDef[] => (b?.entities.filter((e) => e.type === "attdef") as DAttDef[] | undefined) ?? [];

/**
 * Atributy nového vložení z definic bloku (konstantní atributy se nevkládají – kreslí se z definice). `values` podle
 * značky (bez ohledu na velikost písmen) nebo v pořadí definic; chybí = výchozí hodnota.
 */
export function attribsFor(m: DraftModel, b: DraftBlock, ins: Pick<DInsert, "p" | "sx" | "sy" | "rot">, values: Record<string, string> | string[] = {}): DAttrib[] {
  const xf = insertXf(ins, b.base);
  const ctx: KindCtx = { model: m };
  const out: DAttrib[] = [];
  let i = 0;
  for (const d of blockAttDefs(b)) {
    if (d.constant) continue;
    const v = Array.isArray(values) ? values[i] : Object.entries(values).find(([k]) => k.toLowerCase() === d.tag.toLowerCase())?.[1];
    i++;
    const base: DAttrib = {
      tag: d.tag,
      value: v ?? d.def,
      p: d.p,
      h: d.h,
      ...(d.rot ? { rot: d.rot } : {}),
      ...(d.style ? { style: d.style } : {}),
      ...(d.halign ? { halign: d.halign } : {}),
      ...(d.valign ? { valign: d.valign } : {}),
      ...(d.p2 ? { p2: d.p2 } : {}),
      ...(d.invisible ? { invisible: true } : {}),
      ...(d.layer && d.layer !== "0" ? { layer: d.layer } : {}),
      ...(d.color !== undefined && d.color !== "ByBlock" && d.color !== "ByLayer" ? { color: d.color } : {}),
    };
    const t = transformAttrib(base, xf, ctx);
    out.push(t ?? { ...base, p: xfPt(xf, d.p) });
  }
  return out;
}

const drawCache = new WeakMap<DraftEntity[], DraftEntity[]>();
/**
 * Kreslený obsah bloku ve vložení: bez definic atributů (ty nahrazují atributy vložení), konstantní atribut jako text
 * s výchozí hodnotou. Mezipaměť podle identity seznamu entit (stabilní pro prostorový index).
 */
export function blockDrawList(b: DraftBlock): DraftEntity[] {
  let out = drawCache.get(b.entities);
  if (!out) {
    if (!b.entities.some((e) => e.type === "attdef")) out = b.entities;
    else
      out = b.entities.flatMap((e): DraftEntity[] => {
        if (e.type !== "attdef") return [e];
        const d = e as DAttDef;
        if (!d.constant || d.invisible) return [];
        return [attToText(d, d.def, { id: d.id, layer: d.layer, color: d.color })];
      });
    drawCache.set(b.entities, out);
  }
  return out;
}

/** bloky, jejichž obsah se právě počítá (ochrana proti cyklu vnořených bloků) */
const visiting = new Set<string>();
const boxCache = new WeakMap<DraftEntity[], Box | null>();
/** obálka obsahu bloku v souřadnicích bloku (null = prázdný) */
export function blockLocalBox(b: DraftBlock, ctx: KindCtx): Box | null {
  if (boxCache.has(b.entities)) return boxCache.get(b.entities)!;
  if (visiting.has(b.name)) return null;
  visiting.add(b.name);
  let box = emptyBox();
  try {
    for (const e of blockDrawList(b)) {
      const eb = entityBox(e, ctx);
      if (eb) box = boxUnion(box, eb);
    }
  } finally {
    visiting.delete(b.name);
  }
  const r = isEmptyBox(box) ? null : box;
  boxCache.set(b.entities, r);
  return r;
}
/** obálka po afinní transformaci (rohy obálky) */
export function xfBox(b: Box, m: Affine): Box {
  let o = emptyBox();
  for (const p of [[b.x0, b.y0], [b.x1, b.y0], [b.x1, b.y1], [b.x0, b.y1]] as Vec2[]) o = boxAdd(o, xfPt(m, p));
  return o;
}
/** hlídání cyklu při výpočtu vnořených bloků (křivky, body uchopení) */
export function withBlock<T>(name: string, fn: () => T, fallback: T): T {
  if (visiting.has(name)) return fallback;
  visiting.add(name);
  try {
    return fn();
  } finally {
    visiting.delete(name);
  }
}

/** buňky pole vložení (MINSERT) – [sloupec, řádek] */
export function insertCells(e: Pick<DInsert, "cols" | "rows">): [number, number][] {
  const cols = Math.max(1, Math.floor(e.cols ?? 1));
  const rows = Math.max(1, Math.floor(e.rows ?? 1));
  const out: [number, number][] = [];
  for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) out.push([c, r]);
  return out;
}

/** názvy bloků vložených (i vnořeně) v seznamu entit */
export function insertedBlocks(m: DraftModel, list: readonly DraftEntity[], out = new Set<string>()): Set<string> {
  for (const e of list) {
    if (e.type !== "insert") continue;
    const n = (e as DInsert).block;
    if (out.has(n)) continue;
    out.add(n);
    const b = findBlock(m, n);
    if (b) insertedBlocks(m, b.entities, out);
  }
  return out;
}

/** vložil by se blok `name` sám do sebe, kdyby obsahoval entity `list`? */
export function wouldRecurse(m: DraftModel, name: string, list: readonly DraftEntity[]): boolean {
  return insertedBlocks(m, list).has(name);
}

/** bloky, které (i vnořeně) obsahují vložení některého z bloků `names` – včetně jich samých */
export function dependentBlocks(m: DraftModel, names: Iterable<string>): Set<string> {
  const out = new Set(names);
  let grew = true;
  while (grew) {
    grew = false;
    for (const b of m.blocks ?? []) {
      if (out.has(b.name)) continue;
      if (b.entities.some((e) => e.type === "insert" && out.has((e as DInsert).block))) {
        out.add(b.name);
        grew = true;
      }
    }
  }
  return out;
}

/**
 * Po změně definic bloků `names`: všechna vložení těchto bloků (i vnořená, ve všech prostorech) dostanou novou identitu
 * objektu – mezipaměti geometrie (podle identity entity) se tak spočítají znovu s novou definicí a starý model (zpět)
 * si ponechá svou geometrii.
 */
export function refreshInserts(m: DraftModel, names: Iterable<string>): DraftModel {
  const dep = dependentBlocks(m, names);
  if (!dep.size) return m;
  return mapAllEntities(m, (e) => (e.type === "insert" && dep.has((e as DInsert).block) ? ({ ...e } as DraftEntity) : e));
}

/** počet vložení bloku ve všech prostorech (bez vnořených v nepoužitých blocích) */
export function blockUseCount(m: DraftModel, name: string): number {
  let n = 0;
  for (const { list } of allEntityLists(m)) for (const e of list) if (e.type === "insert" && (e as DInsert).block === name) n++;
  return n;
}

// ---------------------------------------------------------------- čištění (PURGE)

export type PurgeWhat = "blocks" | "layers" | "linetypes" | "styles" | "dimstyles";
export type PurgeResult = { model: DraftModel; removed: Record<PurgeWhat, string[]> };

/** názvy textových stylů použitých entitami (pole `style` u textu, atributů, mtextu…) a kótovacími styly */
function usedTextStyles(m: DraftModel): Set<string> {
  const s = new Set<string>([m.vars.textstyle.toLowerCase(), "standard"]);
  for (const { list } of allEntityLists(m))
    for (const e of list) {
      const st = (e as { style?: unknown }).style;
      if (typeof st === "string" && !["dimension", "leader", "tolerance"].includes(e.type)) s.add(st.toLowerCase());
      for (const a of (e as DInsert).attribs ?? []) if (a.style) s.add(a.style.toLowerCase());
      const ts = (e as { textStyle?: unknown }).textStyle;
      if (typeof ts === "string") s.add(ts.toLowerCase());
    }
  for (const d of m.dimStyles ?? []) for (const v of Object.values(d as unknown as Record<string, unknown>)) if (typeof v === "string") s.add(v.toLowerCase());
  return s;
}
function usedDimStyles(m: DraftModel): Set<string> {
  const s = new Set<string>(["standard", "iso-25"]);
  const cur = (m.vars as { dimstyle?: string }).dimstyle;
  if (cur) s.add(cur.toLowerCase());
  for (const { list } of allEntityLists(m))
    for (const e of list) {
      if (e.type !== "dimension" && e.type !== "leader" && e.type !== "tolerance") continue;
      const st = (e as { style?: unknown }).style;
      if (typeof st === "string") s.add(st.toLowerCase());
    }
  return s;
}

/**
 * Odstraní nepoužité pojmenované objekty (jako PURGE): bloky (bez vložení, opakovaně – i vnořené), hladiny (ne 0,
 * Defpoints, aktuální, bez entit), typy čar (ne Continuous / ByLayer / ByBlock, nepoužité hladinou ani entitou),
 * textové a kótovací styly. `names` = jen tyto názvy (jinak vše nepoužité).
 */
export function purge(m0: DraftModel, what: PurgeWhat[], names?: string[], keepBlocks: string[] = []): PurgeResult {
  const want = (n: string) => !names?.length || names.some((x) => fold(x) === fold(n) || x === "*");
  // bloky, které se nesmí odstranit (právě upravovaný blok – UPRAVIT-BLOK), i s bloky, které vkládá
  const keep = keepBlocks.length ? insertedBlocks(m0, keepBlocks.flatMap((n) => findBlock(m0, n)?.entities ?? []), new Set(keepBlocks)) : new Set<string>();
  let m = m0;
  const removed: Record<PurgeWhat, string[]> = { blocks: [], layers: [], linetypes: [], styles: [], dimstyles: [] };
  if (what.includes("blocks")) {
    for (let guard = 0; guard < 100; guard++) {
      const used = new Set<string>();
      for (const { space, list } of allEntityLists(m)) {
        if (space.startsWith("block:")) continue;
        insertedBlocks(m, list, used);
      }
      const drop = (m.blocks ?? []).filter((b) => !used.has(b.name) && !keep.has(b.name) && want(b.name) && !b.name.startsWith("*"));
      if (!drop.length) break;
      removed.blocks.push(...drop.map((b) => b.name));
      const dn = new Set(drop);
      m = { ...m, blocks: (m.blocks ?? []).filter((b) => !dn.has(b)) };
    }
  }
  if (what.includes("layers")) {
    const used = new Set<string>(["0", "defpoints", m.vars.clayer.toLowerCase()]);
    for (const { list } of allEntityLists(m))
      for (const e of list) {
        used.add(e.layer.toLowerCase());
        for (const a of (e as DInsert).attribs ?? []) if (a.layer) used.add(a.layer.toLowerCase());
        for (const f of (e as { frozenLayers?: string[] }).frozenLayers ?? []) used.add(f.toLowerCase());
      }
    const drop = m.layers.filter((l) => !used.has(l.name.toLowerCase()) && want(l.name));
    if (drop.length) {
      removed.layers.push(...drop.map((l) => l.name));
      m = { ...m, layers: m.layers.filter((l) => !drop.includes(l)) };
    }
  }
  if (what.includes("linetypes")) {
    const used = new Set<string>(["continuous", "bylayer", "byblock", m.vars.celtype.toLowerCase()]);
    for (const l of m.layers) used.add(l.linetype.toLowerCase());
    for (const { list } of allEntityLists(m)) for (const e of list) if (e.linetype) used.add(e.linetype.toLowerCase());
    const drop = m.linetypes.filter((l) => !used.has(l.name.toLowerCase()) && want(l.name));
    if (drop.length) {
      removed.linetypes.push(...drop.map((l) => l.name));
      m = { ...m, linetypes: m.linetypes.filter((l) => !drop.includes(l)) };
    }
  }
  if (what.includes("styles")) {
    const used = usedTextStyles(m);
    const drop = m.textStyles.filter((s) => !used.has(s.name.toLowerCase()) && want(s.name));
    if (drop.length) {
      removed.styles.push(...drop.map((s) => s.name));
      m = { ...m, textStyles: m.textStyles.filter((s) => !drop.includes(s)) };
    }
  }
  if (what.includes("dimstyles") && m.dimStyles?.length) {
    const used = usedDimStyles(m);
    const drop = m.dimStyles.filter((s) => !used.has(s.name.toLowerCase()) && want(s.name));
    if (drop.length) {
      removed.dimstyles.push(...drop.map((s) => s.name));
      m = { ...m, dimStyles: m.dimStyles.filter((s) => !drop.includes(s)) };
    }
  }
  return { model: m, removed };
}

// ---------------------------------------------------------------- extrakce atributů (ATTEXT)

export type AttRow = { id: string; space: string; block: string; layer: string; x: number; y: number; rot: number; sx: number; sy: number; values: Record<string, string> };

/** řádky vložení s atributy (ve všech prostorech, nebo v zadaném seznamu) */
export function attributeRows(m: DraftModel, opts: { block?: string; ids?: string[]; space?: string } = {}): AttRow[] {
  const out: AttRow[] = [];
  const ids = opts.ids ? new Set(opts.ids) : null;
  for (const { space, list } of allEntityLists(m)) {
    if (space.startsWith("block:")) continue;
    if (opts.space && space !== opts.space) continue;
    for (const e of list) {
      if (e.type !== "insert") continue;
      const i = e as DInsert;
      if (ids && !ids.has(i.id)) continue;
      if (opts.block && i.block.toLowerCase() !== opts.block.toLowerCase()) continue;
      if (!i.attribs?.length && !ids) continue;
      out.push({ id: i.id, space, block: i.block, layer: i.layer, x: i.p[0], y: i.p[1], rot: i.rot ?? 0, sx: i.sx ?? 1, sy: i.sy ?? 1, values: Object.fromEntries((i.attribs ?? []).map((a) => [a.tag, a.value])) });
    }
  }
  return out;
}

/** CSV (oddělovač „;“ pro český Excel, uvozovky dle RFC 4180, UTF-8 s BOM přidá volající) */
export function rowsToCsv(rows: AttRow[], sep = ";", prec = 4): string {
  const tags: string[] = [];
  for (const r of rows) for (const t of Object.keys(r.values)) if (!tags.includes(t)) tags.push(t);
  const q = (v: string | number) => {
    let s = typeof v === "number" ? String(Math.round(v * 10 ** prec) / 10 ** prec) : v;
    // ochrana proti vzorcům v tabulkovém procesoru (CSV injection): text začínající = + - @ tab CR dostane apostrof
    // (čísla jako „-5“ nebo „+3,2“ zůstanou)
    if (typeof v === "string" && /^[=+\-@\t\r]/.test(s) && !/^[-+]?\d+([.,]\d+)?$/.test(s.trim())) s = `'${s}`;
    return /["\n\r]/.test(s) || s.includes(sep) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const head = ["HANDLE", "BLOCKNAME", "LAYER", "X", "Y", "ROTATION", "XSCALE", "YSCALE", "SPACE", ...tags];
  const lines = [head.map(q).join(sep)];
  for (const r of rows) lines.push([r.id, r.block, r.layer, r.x, r.y, r.rot, r.sx, r.sy, r.space, ...tags.map((t) => r.values[t] ?? "")].map(q).join(sep));
  return lines.join("\r\n") + "\r\n";
}
