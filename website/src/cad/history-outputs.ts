/**
 * Záznamy exportů a historie Zpět / Znovu (vlna 22, bod 20 + 22h, fáze 2 kolo 4).
 *
 * Záznam exportu (`doc.outputs`, cad/doc-outputs.ts) je záznam skutečnosti: soubor na disku vznikl a krok Zpět ho nesmaže.
 * Dřív Ctrl+Z hned po exportu vrátil předchozí stav dokumentu bez záznamu – soubor existoval, ale v seznamu Exporty / Zastaralé
 * výstupy nebyl (seznam „nic zastaralého“ by lhal). Pravidlo (jedno pro GUI Ctrl+Z, text `zpět` v prohlížeči i v CLI):
 *  - **zpět**: cílový stav dostane i záznamy, které má současný stav a cíl ne (vznikly po cílovém stavu – export po kroku);
 *    záznamy, které cíl má a současný stav ne (smazané `exporty vymazat`), cíl drží → Zpět vrátí i vymazaný seznam;
 *  - **znovu**: bez přenosu (krok Znovu smí záznamy smazat – Znovu po vrácení `exporty vymazat`);
 *  - **zápis záznamu mimo krok historie** (export z menu / z výkresu po doběhnutí úlohy): záznam se přidá do současného stavu
 *    i do všech stavů „Znovu“, aby ho Ctrl+Y nevrátil do stavu bez něj.
 * Revize modelu v záznamu zůstává revizí EXPORTOVANÉHO modelu – po kroku Zpět, který model vrátí, je záznam poctivě „ZASTARALÝ“.
 */
import { OUTPUTS_MAX } from "./doc-outputs";
import { carryFailures } from "./export-failures";
import type { CadDoc, ExportRecord } from "./types";

const ids = (d: CadDoc): Set<string> => new Set((d.outputs ?? []).map((r) => r.id));

/** záznamy, které má `after` a `before` ne (podle id záznamu) */
export function addedRecords(before: CadDoc, after: CadDoc): ExportRecord[] {
  if (before.outputs === after.outputs || !after.outputs?.length) return [];
  const had = ids(before);
  return after.outputs.filter((r) => !had.has(r.id));
}

/**
 * Přidá záznamy do dokumentu jako `recordExport`: stejný formát + soubor = novější záznam nahradí starší, nejvýš OUTPUTS_MAX.
 * Bez změny vrátí týž objekt (identita dokumentu = „nic se nezměnilo“ pro čekání na promítnutí a mezipaměti).
 */
export function addRecords(doc: CadDoc, recs: ExportRecord[]): CadDoc {
  const had = ids(doc);
  const add = recs.filter((r) => !had.has(r.id));
  if (!add.length) return doc;
  let list = [...(doc.outputs ?? [])];
  for (const r of add) list = [...list.filter((x) => !(x.format === r.format && x.file === r.file && x.at <= r.at)), r];
  return { ...doc, outputs: list.slice(-OUTPUTS_MAX) };
}

/**
 * krok Zpět z `from` do `target`: cíl dostane záznamy exportů, které vznikly po něm (viz hlavička) – i záznamy NEÚSPĚŠNÝCH
 * exportů (kolo 7, bod 22h – cad/export-failures.ts: soubor nevznikl, ale stopa po pokusu Zpět nemizí)
 */
export const carryOutputs = (target: CadDoc, from: CadDoc): CadDoc => carryFailures(addRecords(target, addedRecords(target, from)), from);

export type OutHist = { past: CadDoc[]; present: CadDoc; future: CadDoc[] };

/** krok Zpět nad historií (GUI Ctrl+Z): přesun do minulosti se záznamy exportů současného stavu */
export function undoKeepOutputs<H extends OutHist>(h: H): H {
  if (!h.past.length) return h;
  return { ...h, past: h.past.slice(0, -1), present: carryOutputs(h.past[h.past.length - 1], h.present), future: [h.present, ...h.future] };
}

/**
 * Zápis záznamu exportu mimo krok historie: `fn` nad současným stavem; nové záznamy se přidají i do stavů Znovu
 * (Ctrl+Y po exportu ve vráceném stavu záznam nesmaže). Minulost se nemění – Zpět záznam přenese sám (`carryOutputs`).
 */
export function recordOutsideHistory<H extends OutHist>(h: H, fn: (d: CadDoc) => CadDoc): H {
  const present = fn(h.present);
  if (present === h.present) return h;
  const added = addedRecords(h.present, present);
  const failed = present.exportFailures !== h.present.exportFailures;
  return { ...h, present, future: added.length || failed ? h.future.map((f) => carryFailures(addRecords(f, added), present)) : h.future };
}
