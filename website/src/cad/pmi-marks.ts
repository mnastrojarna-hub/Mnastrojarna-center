/**
 * Popisy ploch a oblastní úpravy v MODELU (vlna 23, R2 / R3) – jeden zdroj pro výkres i stav.
 *
 * Model nese značky `doc.functional` druhu `note` (popis plochy – „Brousit“, „Leštit“) a `treatment` (oblastní tepelná /
 * povrchová úprava plochy – „58+2 HRC“, „Eht 0,8“, „černit“ s rozsahem od–do). Jádro výkresu (kernel-ops „drawing“) je
 * dostane jako `meta.pmi` a kreslí je samo: popis = odkazová čára se šipkou na hranu (plocha viděná z boku) nebo s tečkou
 * na ploše (plocha viděná zepředu) a krátký text na polici; úprava = tlustá čerchovaná čára ISO 128-2 typ 04.2 rovnoběžně
 * s plochou, kóta rozsahu a značka „Z1“; vysvětlivka „Z1 tepelná: 58+2 HRC“ v patičce se počítá do limitu 5 řádků
 * poznámek (cad/drawing-notes-rules.ts). Změna textu v modelu = změna na výkrese (výkres se z modelu počítá znovu).
 */
import type { PmiMark } from "./drawing";
import { tr } from "./i18n";
import type { CadDoc } from "./types";

/** popisy a úpravy modelu pro výkres; úpravy dostanou značky Z1, Z2 … v pořadí modelu */
export function pmiMarksOf(doc: Pick<CadDoc, "functional" | "kind">): PmiMark[] {
  if (doc.kind === "assembly" || doc.kind === "draft") return [];
  let z = 0;
  const out: PmiMark[] = [];
  for (const m of doc.functional ?? []) {
    if ((m.kind !== "note" && m.kind !== "treatment") || !m.face || !m.text) continue;
    out.push({
      id: m.id,
      kind: m.kind,
      face: m.face.index,
      text: m.text,
      ...(m.geom ? { geom: m.geom } : {}),
      ...(m.kind === "treatment" ? { what: m.what ?? "heat", ref: `Z${++z}`, ...(m.from !== undefined ? { from: m.from } : {}), ...(m.to !== undefined ? { to: m.to } : {}) } : {}),
    });
  }
  return out;
}

/** druh úpravy do textu (krátce) */
export const treatmentWord = (w: "heat" | "surface" | undefined): string => (w === "surface" ? tr("povrchová") : tr("tepelná"));

/** vysvětlivky oblastních úprav pod sebou („Z1 tepelná: 58+2 HRC“; stejný předpis = jeden řádek „Z1, Z2 …“) */
export function zoneLegendOf(pmi: readonly PmiMark[] | undefined): string[] {
  const rows = new Map<string, string[]>();
  for (const m of pmi ?? []) {
    if (m.kind !== "treatment" || !m.ref) continue;
    const key = `${treatmentWord(m.what)}: ${m.text}`;
    rows.set(key, [...(rows.get(key) ?? []), m.ref]);
  }
  return [...rows.entries()].map(([k, refs]) => `${refs.join(", ")} ${k}`);
}
