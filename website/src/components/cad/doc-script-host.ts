/**
 * Dokument → textový skript v aplikaci (`window.mncad.script()`, Data ▸ Export ▸ Textový skript): převod s ověřením jádrem
 * je jeden pro aplikaci i CLI (`scriptOfDocWith`, cad/doc-script-fresh.ts) – zde jen jádro aplikace (`cad`). Příkaz
 * konzole `export skript` provádí engine (cad/engine/ops/out.ts) s jádrem hostitele.
 */
import { cad } from "@/cad/client";
import type { DocScript } from "@/cad/doc-script";
import { scriptOfDocWith, type FreshScriptDoc, type ScriptOfDocOptions } from "@/cad/doc-script-fresh";
import type { CadDoc } from "@/cad/types";

/** volby `window.mncad.script(opts)`; `sigs: "keep"` = otisky výběru zapsat beze změny (bez ověření jádrem) */
export type ScriptHostOptions = ScriptOfDocOptions;

/** skript dokumentu; `fresh` = co ověřilo jádro (počet prvků s otisky výběru, přečíslované, nenalezené, listy se smazanými kótami) */
export function scriptOfDoc(doc: CadDoc, opts: ScriptHostOptions = {}): Promise<DocScript & { fresh?: FreshScriptDoc["stats"] }> {
  return scriptOfDocWith({ pickSigs: (before, f) => cad.pickSigs(before, f), drawing: (d, meta, o) => cad.drawing(d, meta, o) }, doc, opts);
}
