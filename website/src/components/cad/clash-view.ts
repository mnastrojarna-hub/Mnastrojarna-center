/**
 * Texty panelu Kolize podle stavu výsledku (vlna 22, bod 1) – bez Reactu, aby je hlídal test „žádné falešné zelené“
 * (src/cad/w22/greens-a.test.ts). Zelený titulek „Bez kolizí ✓“ existuje jen pro stav `ok` = záznam kontroly aktivního
 * dokumentu se shodným otiskem zobrazeného stavu sestavy (cad/engine/result-key.ts `clashStateOf`).
 */
import type { Interference } from "@/cad/asm-kernel";
import type { ClashState, ResultId } from "@/cad/engine/result-key";
import { tr } from "@/cad/i18n";

export type ClashPanelEntry = { res: Interference[]; at: string; comps?: number };

/** titulek panelu podle stavu */
export function clashTitle(state: ClashState, count: number): string {
  if (state === "ok") return tr("Bez kolizí ✓");
  if (state === "clash") return tr("Kolize ({0})", count);
  if (state === "stale") return tr("Kolize: neplatí");
  return tr("Kolize: nezkontrolováno");
}

/** věta pod titulkem u výsledku, který platit nemůže */
export function clashNote(state: ClashState): string | null {
  if (state === "stale") return tr("Neplatí – sestava se od kontroly změnila.");
  if (state === "unchecked") return tr("Nezkontrolováno – pro tuto sestavu kontrola kolizí neproběhla.");
  return null;
}

/** poloha mechanismu, pro kterou výsledek vznikl */
export const poseText = (pose: ResultId["pose"] | undefined) => (pose === "step" ? tr("zobrazený krok pohybové studie") : tr("poloha z dokumentu"));

/** „dokument · N komponent · čas · r·rev · poloha“ – pro co byl výsledek spočítán */
export function clashHeader(entry: ClashPanelEntry, id: ResultId | undefined, fallbackName: string): string {
  return [`„${id?.name ?? fallbackName}“`, tr("{0} komponent", entry.comps ?? id?.comps ?? 0), entry.at, id?.rev, poseText(id?.pose)].filter(Boolean).join(" · ");
}
