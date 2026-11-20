/**
 * Dokument → textový skript v aplikaci (`window.mncad.script()`, Data ▸ Export ▸ Textový skript): převod s ověřením jádrem
 * je jeden pro aplikaci i CLI (`scriptOfDocWith`, cad/doc-script-fresh.ts) – zde jen jádro aplikace (`cad`). Příkaz
 * konzole `export skript` provádí engine (cad/engine/ops/out.ts) s jádrem hostitele.
 */
import { cad } from "@/cad/client";
import type { DocScript } from "@/cad/doc-script";
import { scriptOfDocWith, type FreshScriptDoc, type ScriptOfDocOptions } from "@/cad/doc-script-fresh";
import type { DrawingExtras } from "@/cad/drawing-agent";
import type { CadDoc } from "@/cad/types";

/** volby `window.mncad.script(opts)`; `sigs: "keep"` = otisky výběru zapsat beze změny (bez ověření jádrem) */
export type ScriptHostOptions = ScriptOfDocOptions;

/**
 * skript dokumentu; `fresh` = co ověřilo jádro (počet prvků s otisky výběru, přečíslované, nenalezené, listy se smazanými kótami).
 * `extras` = doplňky razítka otevřeného dokumentu (kusovník a pozice sestavy – stav výkresového prostředí): podle nich jádro
 * ověří, které upravené vygenerované pozice na listu sestavy jsou.
 */
export function scriptOfDoc(doc: CadDoc, opts: ScriptHostOptions = {}, extras?: DrawingExtras): Promise<DocScript & { fresh?: FreshScriptDoc["stats"] }> {
  return scriptOfDocWith({ pickSigs: (before, f) => cad.pickSigs(before, f), drawing: (d, meta, o) => cad.drawing(d, meta, o), extras: (d) => (d === doc ? (extras ?? {}) : {}) }, doc, opts);
}
