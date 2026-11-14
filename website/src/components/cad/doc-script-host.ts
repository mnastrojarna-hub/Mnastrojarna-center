/**
 * Dokument → textový skript v aplikaci (příkaz `export skript`, `window.mncad.script()`, Data ▸ Export ▸ Textový skript):
 * před převodem (cad/doc-script.ts) jádro ověří čísla vybraných hran a ploch podle otisků a určí id smazaných vygenerovaných kót
 * (cad/doc-script-fresh.ts) – skript pak nese platná čísla ve vlastních příkazech a po přečtení dá stejný model.
 * `sigs: "keep"` jádro vynechá a otisky zapíše tak, jak jsou uložené (obecný příkaz / JSON).
 */
import { cad } from "@/cad/client";
import { docToScript, type DocScript, type DocScriptOptions } from "@/cad/doc-script";
import { freshScriptDoc, type FreshScriptDoc } from "@/cad/doc-script-fresh";
import { getLang } from "@/cad/i18n";
import type { CadDoc } from "@/cad/types";

/** volby `window.mncad.script(opts)`; `sigs: "keep"` = otisky výběru zapsat beze změny (bez ověření jádrem) */
export type ScriptHostOptions = { lang?: "cs" | "en" | "de"; names?: "auto" | "all"; sigs?: "drop" | "keep"; comments?: boolean };

/** skript dokumentu; `fresh` = co ověřilo jádro (počet prvků s otisky výběru, přečíslované, nenalezené, listy se smazanými kótami) */
export async function scriptOfDoc(doc: CadDoc, opts: ScriptHostOptions = {}): Promise<DocScript & { fresh?: FreshScriptDoc["stats"] }> {
  const base: DocScriptOptions = { lang: opts.lang ?? getLang(), ...(opts.names ? { names: opts.names } : {}), ...(opts.comments !== undefined ? { comments: opts.comments } : {}) };
  if (opts.sigs === "keep") return docToScript(doc, { ...base, sigs: "keep" });
  const fresh = await freshScriptDoc(doc, { pickSigs: (before, f) => cad.pickSigs(before, f), drawing: (d, meta, o) => cad.drawing(d, meta, o) });
  // ověřené výběry jsou v kopii dokumentu bez otisků; co jádro nenašlo, si otisky nechalo a zapíše se s nimi
  const r = docToScript(fresh.doc, { ...base, sigs: "keep", deletedDims: fresh.deletedDims });
  return { ...r, notes: [...r.notes, ...fresh.notes], fresh: fresh.stats };
}
