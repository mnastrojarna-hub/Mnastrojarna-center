/**
 * Zobrazení › Barva v sestavě: obarví vybrané komponenty (nebo všechny, když není nic vybráno). U podsestavy se barva
 * propíše i do jejích dílů – listový díl má vlastní barvu a ta má při zobrazení přednost před barvou podsestavy.
 */
import type { AsmComponent, CadDoc } from "./types";

function recolor(c: AsmComponent, color: string): AsmComponent {
  if (c.source.kind !== "asm") return { ...c, color };
  return { ...c, color, source: { ...c.source, doc: { ...c.source.doc, components: (c.source.doc.components ?? []).map((x) => recolor(x, color)) } } };
}

/** Komponenty nejvyšší úrovně, kterých se barva týká: vybrané, jinak všechny. */
export function colorTargets(doc: CadDoc, selected: string[]): string[] {
  const ids = new Set((doc.components ?? []).map((c) => c.id));
  const picked = [...new Set(selected.filter((id) => ids.has(id)))];
  return picked.length ? picked : [...ids];
}

/** Nový dokument s obarvenými komponentami `ids` (s jejich díly v podsestavách). */
export function colorComponents(doc: CadDoc, ids: string[], color: string): CadDoc {
  const set = new Set(ids);
  return { ...doc, components: (doc.components ?? []).map((c) => (set.has(c.id) ? recolor(c, color) : c)) };
}

/** Mají všechny komponenty `ids` (i díly jejich podsestav) tuto barvu? – zvýraznění položky v nabídce barev */
export function allColored(doc: CadDoc, ids: string[], color: string): boolean {
  const same = (c: AsmComponent): boolean => (c.source.kind === "asm" ? (c.source.doc.components ?? []).every(same) : (c.color ?? "").toLowerCase() === color.toLowerCase());
  const set = new Set(ids);
  const list = (doc.components ?? []).filter((c) => set.has(c.id));
  return list.length > 0 && list.every(same);
}
