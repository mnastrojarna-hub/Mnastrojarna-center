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
import { drawingDoc } from "./drawing-doc";
import type { ModelView } from "./drawing";
import type { CadDoc } from "./types";

/** vložené dokumenty: obsah (bez názvu a výkresů) → těleso */
const docShapes = new Map<string, Promise<r.Shape3D | null>>();
const MAX_DOCS = 12;

/** klíč obsahu dokumentu, který mění geometrii (stejné údaje jako mezipaměť tělesa výkresu ve workeru) */
export const docGeometryKey = (d: CadDoc) => JSON.stringify({ f: d.features, v: d.variables, c: d.configs, a: d.activeConfig, b: d.bodies, k: d.kind, comp: d.components, mates: d.mates });

function docShape(doc: CadDoc, used: Set<string>): Promise<r.Shape3D | null> {
  const dd = drawingDoc(doc);
  const key = docGeometryKey(dd);
  used.add(key);
  let p = docShapes.get(key);
  if (p) docShapes.delete(key); // naposledy použité na konec (vyřazuje se nejdéle nepoužité)
  else p = shapeOfDoc(dd).catch(() => null);
  docShapes.set(key, p);
  return p;
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
export async function drawingModelShapes(doc: CadDoc, models: ModelView[] | undefined): Promise<Record<string, r.Shape3D>> {
  const out: Record<string, r.Shape3D> = {};
  const used = new Set<string>();
  for (const m of models ?? []) {
    try {
      if (m.source.kind === "component") {
        const id = m.source.compId;
        const c = (doc.components ?? []).find((x) => x.id === id);
        if (!c) continue;
        // modelovaný závit se na výkrese kreslí zjednodušeně (jako u hlavního modelu)
        const src = c.source.kind === "part" ? { ...c.source, doc: drawingDoc(c.source.doc) } : c.source;
        const e = await partEntry(sourceKey(src), src);
        if (e.body) out[m.id] = e.body;
      } else {
        const s = await docShape(m.source.doc, used);
        if (s) out[m.id] = s;
      }
    } catch {
      /* model nejde postavit – výkres na to upozorní */
    }
  }
  trimDocs(used);
  return out;
}
