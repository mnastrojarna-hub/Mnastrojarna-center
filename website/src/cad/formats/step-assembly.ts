/**
 * Sestava STEP → sestava Mnástrojárna CAD (lehký režim otevření velkých sestav).
 *
 * `splitStepAssembly` (běží v jádře – worker, nebo v Node) přečte strom výrobku a vyřízne geometrii každého různého dílu do
 * samostatného souboru STEP. `assemblyDocFromSplit` (UI) z toho postaví dokument sestavy: podsestavy jako vnořené sestavy,
 * díly jako komponenty „ze souboru“ s odkazem na data (`mnblob:`) – opakované výskyty téhož dílu sdílejí data i síť
 * (v jádře se čtou jednou), umístění výskytů jsou z transformací STEP (v mm).
 */
import { tr } from "../i18n";
import { eulerXYZ } from "../assembly";
import type { AsmComponent, CadDoc, Vec3 } from "../types";
import { uid } from "../types";
import { closure, closureWithin, extractProduct, hasGeometry, indexStep, stepTree, type StepIndex, type StepTree } from "./step-tree";

/**
 * Díl vyříznutý ze sestavy. `own` = vlastní tělesa sestavy / podsestavy `pd` (výrobek s dětmi, který má i svou geometrii –
 * typicky kořenová komponenta Fusion 360 s tělesy vedle výskytů komponent); vkládá se do ní jako komponenta v počátku.
 */
export type SplitPart = { pd: number; name: string; color?: string; bytes: Uint8Array; own?: boolean };
/** Uzel stromu výrobku (sestava): výskyty dětí s maticí umístění. */
export type SplitNode = { pd: number; name: string; children: { pd: number; matrix: number[]; name: string }[] };
export type StepSplit = {
  /** kořenové výrobky (sestavy; samostatné díly mimo strom sestavy jsou mezi `parts` a kořenem jsou také) */
  roots: number[];
  /** podsestavy (výrobky s dětmi) */
  nodes: SplitNode[];
  /** různé díly s geometrií */
  parts: SplitPart[];
  /** výskyty dílů celkem (s opakováním) */
  leafInstances: number;
  /** díly bez geometrie (vynechané) */
  empty: string[];
  /** doby kroků (ms) */
  ms: { index: number; tree: number; extract: number };
  /** soubor je neúplný (useknutý) */
  incomplete: boolean;
};

/** od kolika bajtů se sestava STEP otevírá jako sestava komponent (menší sestavy jako jeden díl, jako dřív) */
export const ASSEMBLY_MIN_BYTES = 1024 * 1024;

/**
 * Rozdělí sestavu STEP na díly. Vrátí `null`, když soubor sestavu nemá (jeden díl, nebo jen jeden výskyt dílu) –
 * takový soubor se otevře jako díl s prvkem Import. Poškozený soubor vyhodí chybu (`StepFormatError`).
 */
export function splitStepAssembly(bytes: Uint8Array, onProgress?: (done: number, total: number) => void): StepSplit | null {
  const t0 = Date.now();
  const ix: StepIndex = indexStep(bytes);
  const t1 = Date.now();
  const tree: StepTree | null = stepTree(ix);
  const t2 = Date.now();
  if (!tree || tree.leafInstances < 2) return null;
  const parts: SplitPart[] = [];
  const nodes: SplitNode[] = [];
  const empty: string[] = [];
  const loose = new Set(tree.loose);
  const leaves = [...tree.products.values()].filter((p) => !p.children.length);
  // reprezentace výrobků a MAPPED_ITEM: hranice vlastní geometrie sestavy (dál už jsou tělesa dětí)
  const reps = new Map<number, number>();
  for (const p of tree.products.values()) if (p.rep > 0) reps.set(p.rep, p.pd);
  const mapped = ix.byType.get("MAPPED_ITEM") ?? [];
  let k = 0;
  for (const p of tree.products.values()) {
    if (p.children.length) {
      nodes.push({ pd: p.pd, name: p.name, children: p.children.map((c) => ({ pd: c.pd, matrix: c.matrix, name: c.name })) });
      if (!p.geomRoots.length) continue;
      const stop = new Set(mapped);
      for (const [rep, pd] of reps) if (pd !== p.pd) stop.add(rep);
      const own = closureWithin(ix, p.geomRoots, stop);
      if (!hasGeometry(ix, own.ids)) continue;
      // vlastní tělesa sestavy, ale jejich soubor nejde oddělit od umístění dětí → přesné čtení celého souboru (žádné ztracené těleso)
      if (own.stopped) return null;
      parts.push({ pd: p.pd, name: p.name, color: p.color, bytes: extractProduct(ix, p, own.ids), own: true });
      continue;
    }
    const ids = closure(ix, p.geomRoots);
    if (!p.geomRoots.length || !hasGeometry(ix, ids)) {
      if (!loose.has(p.pd)) empty.push(p.name); // výrobek mimo strom bez geometrie (dokument, výkres) se nehlásí
      continue;
    }
    parts.push({ pd: p.pd, name: p.name, color: p.color, bytes: extractProduct(ix, p, ids) });
    onProgress?.(++k, leaves.length);
  }
  if (!parts.length) return null;
  const extraRoots = tree.loose.filter((pd) => parts.some((x) => x.pd === pd));
  return { roots: [...tree.roots, ...extraRoots], nodes, parts, leafInstances: tree.leafInstances + extraRoots.length, empty, ms: { index: t1 - t0, tree: t2 - t1, extract: Date.now() - t2 }, incomplete: !ix.complete };
}

const PALETTE = ["#b9c2cc", "#9fb4c8", "#c9a46a", "#8fa98f", "#c48f8f", "#a79bc4", "#d6d9dd", "#7f8a96"];
const round = (v: number) => Math.round(v * 1e6) / 1e6;

/** matice 4×4 (po sloupcích) → umístění komponenty (posun mm + Eulerovy úhly XYZ) */
export function placementOfMatrix(m: number[]): { position: Vec3; rotation: Vec3 } {
  const R = [m[0], m[4], m[8], m[1], m[5], m[9], m[2], m[6], m[10]] as Parameters<typeof eulerXYZ>[0];
  const rot = eulerXYZ(R).map((v) => (Math.abs(v) < 1e-9 ? 0 : round(v))) as Vec3;
  return { position: [round(m[12]), round(m[13]), round(m[14])], rotation: rot };
}

/**
 * Dokument sestavy z rozdělené sestavy STEP. `refOf(pd)` = odkaz na data dílu (blob). Výskyty téže podsestavy sdílejí
 * jeden vnořený dokument (stejný klíč obsahu → v jádře i v kusovníku jako jeden výrobek).
 */
export function assemblyDocFromSplit(split: StepSplit, fileName: string, refOf: (pd: number) => string): CadDoc {
  const base = fileName.replace(/\.[^.]+$/, "");
  const nodes = new Map(split.nodes.map((n) => [n.pd, n]));
  const parts = new Map(split.parts.filter((p) => !p.own).map((p, i) => [p.pd, { ...p, i }]));
  const own = new Map(split.parts.filter((p) => p.own).map((p) => [p.pd, p]));
  const fileComp = (leaf: SplitPart & { i?: number }, placement: { position: Vec3; rotation: Vec3 }, name = leaf.name): AsmComponent => ({
    id: uid(),
    name,
    source: { kind: "file", fileName: `${leaf.name}.step`, format: "step", data: refOf(leaf.pd) },
    placement,
    group: "Díly",
    color: leaf.color ?? PALETTE[(leaf.i ?? 0) % PALETTE.length],
  });
  const ORIGIN = () => ({ position: [0, 0, 0] as Vec3, rotation: [0, 0, 0] as Vec3 });
  const memo = new Map<number, CadDoc | null>();
  const docOf = (pd: number, depth: number): CadDoc | null => {
    if (memo.has(pd)) return memo.get(pd)!;
    const n = nodes.get(pd);
    if (!n || depth > 14) return null;
    memo.set(pd, null); // ochrana proti cyklu
    const components: AsmComponent[] = [];
    // vlastní tělesa sestavy (vedle výskytů dětí) – v počátku sestavy
    const o = own.get(pd);
    if (o) components.push(fileComp(o, ORIGIN(), tr("{0} – vlastní tělesa", o.name)));
    for (const ch of n.children) {
      const placement = placementOfMatrix(ch.matrix);
      const leaf = parts.get(ch.pd);
      if (leaf) {
        components.push(fileComp(leaf, placement));
        continue;
      }
      const sub = docOf(ch.pd, depth + 1);
      if (sub && sub.components?.length) components.push({ id: uid(), name: sub.name, source: { kind: "asm", doc: sub }, placement, group: "Podsestavy" });
    }
    const d: CadDoc = { app: "mnastrojarna-cad", version: 2, name: n.name, material: "ocel", features: [], kind: "assembly", components };
    memo.set(pd, d);
    return d;
  };
  // kořeny: sestavy a samostatné díly mimo strom (v počátku, jako je načte čtení celého souboru)
  const top: AsmComponent[] = [];
  for (const r of split.roots) {
    const leaf = parts.get(r);
    if (leaf) {
      top.push(fileComp(leaf, ORIGIN()));
      continue;
    }
    const d = docOf(r, 0);
    if (d && d.components?.length) top.push({ id: uid(), name: d.name, source: { kind: "asm" as const, doc: d }, placement: ORIGIN(), group: "Podsestavy" });
  }
  if (top.length === 1 && top[0].source.kind === "asm") return { ...top[0].source.doc, name: top[0].source.doc.name || base };
  return { app: "mnastrojarna-cad", version: 2, name: base, material: "ocel", features: [], kind: "assembly", components: top };
}

/** počet listových komponent (výskytů dílů) v dokumentu sestavy */
export function leafCount(doc: CadDoc, depth = 0): number {
  if (depth > 16) return 0;
  let n = 0;
  for (const c of doc.components ?? []) n += c.source.kind === "asm" ? leafCount(c.source.doc, depth + 1) : 1;
  return n;
}
