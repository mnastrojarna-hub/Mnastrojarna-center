/** Podsestavy v UI: zploštění stromu komponent na listové díly se světovými maticemi, vytváření a rozpouštění podsestav. */
import { computeBom, emptyAssembly, eulerXYZ, placementMatrix, sourceKey, type BomRow, type Mat3 } from "@/cad/assembly";
import { uid, type AsmComponent, type CadDoc, type Placement } from "@/cad/types";

export type Leaf = {
  /** jedinečné id listu: cesta id komponent „top/…/leaf“ */
  id: string;
  /** komponenta nejvyšší úrovně */
  topId: string;
  comp: AsmComponent;
  key: string;
  /** světová matice (po sloupcích) */
  matrix: number[];
  /** cesta názvů (pro strom) */
  path: string[];
  hidden: boolean;
};

export function mul4(a: number[], b: number[]): number[] {
  const r = new Array(16).fill(0);
  for (let c = 0; c < 4; c++) for (let rr = 0; rr < 4; rr++) for (let k = 0; k < 4; k++) r[c * 4 + rr] += a[k * 4 + rr] * b[c * 4 + k];
  return r;
}

export function matrixToPlacement(m: number[]): Placement {
  const R: Mat3 = [m[0], m[4], m[8], m[1], m[5], m[9], m[2], m[6], m[10]];
  const round = (v: number) => Math.round(v * 1e6) / 1e6;
  return { position: [round(m[12]), round(m[13]), round(m[14])], rotation: eulerXYZ(R) };
}

const IDENT = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];

/** Všechny listové díly sestavy (včetně dílů ve vnořených podsestavách). */
export function flattenLeaves(doc: CadDoc): Leaf[] {
  const out: Leaf[] = [];
  const walk = (comps: AsmComponent[], parent: number[], prefix: string, top: string | null, names: string[], hidden: boolean) => {
    for (const c of comps) {
      const m = mul4(parent, placementMatrix(c.placement));
      const id = prefix ? `${prefix}/${c.id}` : c.id;
      const topId = top ?? c.id;
      const h = hidden || !!c.hidden;
      if (c.source.kind === "asm") walk(c.source.doc.components ?? [], m, id, topId, [...names, c.name], h);
      else out.push({ id, topId, comp: c, key: sourceKey(c.source), matrix: m, path: [...names, c.name], hidden: h });
    }
  };
  walk(doc.components ?? [], IDENT, "", null, [], false);
  return out;
}

/** Vytvoří podsestavu z vybraných komponent nejvyšší úrovně (zachová jejich polohu). */
export function makeSubassembly(doc: CadDoc, ids: string[], name = "Podsestava"): CadDoc {
  const set = new Set(ids);
  const picked = (doc.components ?? []).filter((c) => set.has(c.id));
  if (!picked.length) return doc;
  const sub: AsmComponent = {
    id: uid(),
    name,
    source: { kind: "asm", doc: { ...emptyAssembly(name), components: picked } },
    placement: { position: [0, 0, 0], rotation: [0, 0, 0] },
    group: "Podsestavy",
  };
  const rest = (doc.components ?? []).filter((c) => !set.has(c.id));
  const at = (doc.components ?? []).findIndex((c) => set.has(c.id));
  rest.splice(Math.max(0, at), 0, sub);
  return { ...doc, components: rest };
}

/** Rozpustí podsestavu: její komponenty se přesunou o úroveň výš se složeným umístěním. */
export function dissolveSubassembly(doc: CadDoc, id: string): CadDoc {
  const comps = doc.components ?? [];
  const i = comps.findIndex((c) => c.id === id);
  const sub = comps[i];
  if (!sub || sub.source.kind !== "asm") return doc;
  const pm = placementMatrix(sub.placement);
  const children = (sub.source.doc.components ?? []).map((c) => ({ ...c, placement: matrixToPlacement(mul4(pm, placementMatrix(c.placement))) }));
  const next = [...comps];
  next.splice(i, 1, ...children);
  return { ...doc, components: next };
}

/** Kusovník: plochý (všechny díly) nebo strukturovaný (první úroveň, podsestavy jako položky). */
export function bomOf(doc: CadDoc, flat: boolean, info: (c: AsmComponent) => { material?: string; massKg?: number }): BomRow[] {
  if (flat) {
    const leaves = flattenLeaves(doc).map((l) => l.comp);
    return computeBom({ ...doc, components: leaves }, info);
  }
  const top = doc.components ?? [];
  const parts = computeBom({ ...doc, components: top.filter((c) => c.source.kind !== "asm") }, info);
  const subs = new Map<string, BomRow>();
  for (const c of top) {
    if (c.source.kind !== "asm") continue;
    const k = c.name;
    const r = subs.get(k);
    if (r) {
      r.qty++;
      r.ids.push(c.id);
      continue;
    }
    const leaves = flattenLeaves({ ...doc, components: [c] });
    const mass = leaves.reduce((s, l) => s + (info(l.comp).massKg ?? 0), 0);
    subs.set(k, { pos: 0, name: `${c.name} (podsestava, ${leaves.length} dílů)`, number: c.number, qty: 1, material: "—", massKg: mass, group: "Podsestavy", ids: [c.id] });
  }
  const rows = [...subs.values(), ...parts];
  rows.forEach((r, i) => (r.pos = i + 1));
  return rows;
}

/** Inverze tuhé transformace umístění (po sloupcích). */
export function invPlacementMatrix(p: Placement): number[] {
  const m = placementMatrix(p);
  // R^T a -R^T t
  const r = [m[0], m[4], m[8], 0, m[1], m[5], m[9], 0, m[2], m[6], m[10], 0, 0, 0, 0, 1];
  const t = [m[12], m[13], m[14]];
  r[12] = -(r[0] * t[0] + r[4] * t[1] + r[8] * t[2]);
  r[13] = -(r[1] * t[0] + r[5] * t[1] + r[9] * t[2]);
  r[14] = -(r[2] * t[0] + r[6] * t[1] + r[10] * t[2]);
  return r;
}
