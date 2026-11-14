/**
 * Více výkresů jednoho dílu / sestavy (jako více výkresových souborů v desktopovém CADu): listy v `doc.drawings` se
 * seskupují podle `DrawingDoc.drawing` (název výkresu). List bez názvu výkresu patří k prvnímu výkresu „Výkres 1“ –
 * starší dokumenty mají všechny listy v něm a chovají se jako dřív. Čísla listů (razítko „List 1/2“, `výkres list 2`,
 * export „všechny listy“) platí uvnitř výkresu.
 */
import { tr } from "./i18n";
import type { CadDoc, DrawingDoc } from "./types";

/** klíč výkresu listu („“ = první výkres bez vlastního názvu) */
export const drawingKey = (s: Pick<DrawingDoc, "drawing">) => s.drawing?.trim() ?? "";
/** zobrazovaný název výkresu */
export const drawingLabel = (key: string) => key || tr("Výkres 1");

export type DrawingSet = { key: string; name: string; /** indexy listů v doc.drawings */ sheets: number[] };

/** Výkresy dokumentu v pořadí prvního listu. */
export function drawingSets(doc: CadDoc): DrawingSet[] {
  const out: DrawingSet[] = [];
  (doc.drawings ?? []).forEach((s, i) => {
    const key = drawingKey(s);
    let set = out.find((x) => x.key === key);
    if (!set) out.push((set = { key, name: drawingLabel(key), sheets: [] }));
    set.sheets.push(i);
  });
  return out;
}

/** Indexy listů výkresu, ke kterému patří list `idx` (bez listů = [idx]). */
export function setSheets(doc: CadDoc, idx: number): number[] {
  const list = doc.drawings ?? [];
  const s = list[idx];
  if (!s) return [idx];
  const key = drawingKey(s);
  return list.flatMap((x, i) => (drawingKey(x) === key ? [i] : []));
}

/** Pořadí listu ve svém výkresu (od 0) a počet listů výkresu. */
export function sheetPos(doc: CadDoc, idx: number): { pos: number; count: number } {
  const set = setSheets(doc, idx);
  const pos = set.indexOf(idx);
  return { pos: pos >= 0 ? pos : idx, count: Math.max(1, set.length) };
}

/** Výkres podle čísla (od 1) nebo názvu – chyba se seznamem výkresů. */
export function resolveDrawing(doc: CadDoc, ref: number | string): DrawingSet {
  const sets = drawingSets(doc);
  const hit = typeof ref === "number" ? sets[ref - 1] : sets.find((s) => s.name.toLowerCase() === ref.trim().toLowerCase());
  if (hit) return hit;
  throw new Error(tr("výkres {0} neexistuje – {1}; nový výkres: výkres nový \"název\"", typeof ref === "number" ? ref : `„${ref}“`, drawingsLine(doc)));
}

/** Volný název nového výkresu „Výkres N“. */
export function nextDrawingName(doc: CadDoc): string {
  const used = new Set(drawingSets(doc).map((s) => s.name.toLowerCase()));
  for (let n = drawingSets(doc).length + 1; ; n++) {
    const name = tr("Výkres {0}", n);
    if (!used.has(name.toLowerCase())) return name;
  }
}

/** „1 list“, „2 listy“, „5 listů“ */
export const sheetCount = (n: number) => (n === 1 ? tr("1 list") : n >= 2 && n <= 4 ? tr("{0} listy", n) : tr("{0} listů", n));

/** Přehled výkresů: „Výkresy (2): 1 „Výkres 1“ 2 listy · 2 „Výkres 2“ 1 list (aktivní)“. */
export function drawingsLine(doc: CadDoc, activeIdx = -1): string {
  const sets = drawingSets(doc);
  if (!sets.length) return tr("Výkresy: zatím žádný (první vznikne příkazem výkresu)");
  const act = (doc.drawings ?? [])[activeIdx] ? drawingKey(doc.drawings![activeIdx]) : null;
  return tr("Výkresy ({0}): {1}", sets.length, sets.map((s, i) => `${i + 1} „${s.name}“ ${sheetCount(s.sheets.length)}${s.key === act ? tr(" (aktivní)") : ""}`).join(" · "));
}

/** Přidá k listu název výkresu (první výkres bez názvu = beze změny). */
export const inDrawing = (s: DrawingDoc, key: string): DrawingDoc => {
  const { drawing: _d, ...rest } = s;
  void _d;
  return key ? { ...rest, drawing: key } : rest;
};
