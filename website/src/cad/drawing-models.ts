/**
 * Další modely na listu výkresu (worker): tělesa pro pohledy `DrawingOptions.models`.
 * - `component` = komponenta sestavy, jejíž výkres se kreslí (podle id) – těleso dílu ve vlastních souřadnicích
 *   (bez umístění v sestavě), z mezipaměti komponent sestavy (stejné díly se staví jen jednou);
 * - `doc` = jiný dokument vložený do definice výkresu (kopie dílu nebo sestavy).
 * Tělesa se drží v mezipaměti, aby se pro týž model nepočítala znovu ani projekce (mezipaměť projekcí je podle tělesa).
 */
import * as r from "replicad";
import { sourceKey } from "./assembly";
import { partEntry, shapeOfDoc } from "./asm-kernel";
import { missingBlobs } from "./blobs";
import { drawingDoc, drawingSource, hasDrawnSprings, type SpringDraw } from "./drawing-doc";
import { partGeom, type PartGeom } from "./drawing-dims-geom";
import type { ModelView } from "./drawing";
import type { CadDoc } from "./types";

/** vložené dokumenty: obsah (bez názvu a výkresů) → těleso */
const docShapes = new Map<string, Promise<r.Shape3D | null>>();
const MAX_DOCS = 12;

/** klíč obsahu dokumentu, který mění geometrii (stejné údaje jako mezipaměť tělesa výkresu ve workeru) */
export const docGeometryKey = (d: CadDoc) => JSON.stringify({ f: d.features, v: d.variables, c: d.configs, a: d.activeConfig, b: d.bodies, k: d.kind, comp: d.components, mates: d.mates });

function docShape(doc: CadDoc, used: Set<string>, springs: SpringDraw): Promise<r.Shape3D | null> {
  const dd = drawingDoc(doc, springs);
  if (missingBlobs(dd).length) return shapeOfDoc(dd).catch(() => null); // bez dat importu nic nezapamatovat
  const key = docGeometryKey(dd);
  used.add(key);
  let p = docShapes.get(key);
  if (p) docShapes.delete(key); // naposledy použité na konec (vyřazuje se nejdéle nepoužité)
  else p = shapeOfDoc(dd).catch(() => null);
  docShapes.set(key, p);
  return p;
}

/** Zapomene tělesa vložených dokumentů a hlavních modelů listů (nová instance jádra ve stejném vlákně – `kernel-ops.ts` `resetKernel`). */
export function clearDrawingModels(): void {
  docShapes.clear();
  bodies.clear();
  transient = null;
  realGeoms.clear();
}

/**
 * Geometrický výtah pro Chytré kóty listu dílu se zjednodušenými pružinami: výtah SKUTEČNÉHO tvaru (pružina jako šroubovice).
 * Obal vinutí je trubka – plánovač by jeho vnitřní válec kótoval jako díru (Ø15 skrz) a vnější jako osazení, která na dílu
 * nejsou. Šroubovicová plocha ve výtahu jako válec ani rovina není, kóty jsou proto tytéž jako u listu „pružiny plně“.
 * Stavba šroubovice trvá zlomek sekundy (pomalé je jen skrytí hran), těleso se po výtahu hned uvolní; výtah se pamatuje
 * podle geometrie dokumentu. `undefined` = list nic takového nepotřebuje (sestava, plný tvar, díl bez pružiny).
 */
const realGeoms = new Map<string, PartGeom>();
const MAX_GEOMS = 8;
export async function realPartGeom(doc: CadDoc, springs: SpringDraw, build: (d: CadDoc) => Promise<r.Shape3D | null>): Promise<PartGeom | undefined> {
  if (springs === "full" || doc.kind === "assembly" || !hasDrawnSprings(doc)) return undefined;
  const real = drawingDoc(doc, "full");
  const key = docGeometryKey(real);
  const hit = realGeoms.get(key);
  if (hit) return hit;
  const b = await build(real);
  if (!b) return undefined;
  const g = partGeom(b);
  b.delete?.();
  if (missingBlobs(real).length) return g;
  realGeoms.set(key, g);
  for (const k of [...realGeoms.keys()]) {
    if (realGeoms.size <= MAX_GEOMS) break;
    realGeoms.delete(k);
  }
  return g;
}

/**
 * Tělesa hlavních modelů listů (klíč geometrie dokumentu pro výkres → těleso), nejdéle nepoužité se smaže. Dřív se držel
 * jen poslední dokument: export všech listů sestavy a jejích dílů (nebo přepínání záložek) stavěl při každém přepnutí
 * těleso znovu – a s novým tělesem i celé skrytí hran (mezipaměť projekcí je podle tělesa, A1 sestavy = desítky sekund).
 */
const bodies = new Map<string, r.Shape3D>();
const MAX_BODIES = 4;
/** těleso bez dat importu (dorazí s dalším požadavkem) – nepamatuje se, smaže se při dalším požadavku */
let transient: r.Shape3D | null = null;

/** Těleso hlavního modelu listu pro dokument po `drawingDoc` (z mezipaměti, jinak `build`); null = prázdný model. */
export async function drawingBody(dd: CadDoc, build: (d: CadDoc) => Promise<r.Shape3D | null>): Promise<r.Shape3D | null> {
  transient?.delete?.();
  transient = null;
  const key = docGeometryKey(dd);
  const hit = bodies.get(key);
  if (hit) {
    bodies.delete(key); // naposledy použité na konec
    bodies.set(key, hit);
    return hit;
  }
  const b = await build(dd);
  if (!b) return null;
  if (missingBlobs(dd).length) return (transient = b);
  bodies.set(key, b);
  for (const k of [...bodies.keys()]) {
    if (bodies.size <= MAX_BODIES) break;
    if (k === key) continue;
    bodies.get(k)?.delete?.();
    bodies.delete(k);
  }
  return b;
}

/** vyřazení nejdéle nepoužitých těles (kromě těch, která potřebuje právě kreslený list) */
function trimDocs(used: Set<string>) {
  for (const k of [...docShapes.keys()]) {
    if (docShapes.size <= MAX_DOCS) break;
    if (used.has(k)) continue;
    const gone = docShapes.get(k);
    docShapes.delete(k);
    void gone?.then((s) => s?.delete?.());
  }
}

/**
 * Tělesa dalších modelů výkresu (id pohledu → těleso). Model, který nejde postavit (smazaná komponenta, prázdný dokument),
 * ve výsledku chybí – `makeDrawing` pak k němu vypíše varování a hlavní výkres se nakreslí.
 */
export async function drawingModelShapes(doc: CadDoc, models: ModelView[] | undefined, springs: SpringDraw = "simple"): Promise<Record<string, r.Shape3D>> {
  const out: Record<string, r.Shape3D> = {};
  const used = new Set<string>();
  for (const m of models ?? []) {
    try {
      if (m.source.kind === "component") {
        const id = m.source.compId;
        const c = (doc.components ?? []).find((x) => x.id === id);
        if (!c) continue;
        // modelovaný závit a pružiny se na výkrese kreslí zjednodušeně (jako u hlavního modelu)
        const src = drawingSource(c.source, springs);
        const e = await partEntry(sourceKey(src), src);
        if (e.body) out[m.id] = e.body;
      } else {
        const s = await docShape(m.source.doc, used, springs);
        if (s) out[m.id] = s;
      }
    } catch {
      /* model nejde postavit – výkres na to upozorní */
    }
  }
  trimDocs(used);
  return out;
}
