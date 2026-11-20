/**
 * Souhrn hromadných příkazů sestavy (vlna 22, bod 15 – „konzole je příliš ukecaná“): `sestava pole` vypisoval polohu každé
 * kopie na jednom řádku (19 kopií = stovky znaků, u velkých polí tisíce). Do 3 kopií se vypíší všechny; víc kopií = počet,
 * první a poslední s polohou a odkaz na úplný výpis („sestava komponenty“ – každá komponenta s polohou).
 */
import { tr } from "./i18n";

export const BULK_LIST_MAX = 3;

/** „kopie 18: „Šroub (2)“ [20; 0; 0] … „Šroub (19)“ [180; 0; 0] (výpis všech poloh: sestava komponenty)“ */
export function copiesText(copies: readonly { name: string; pos: string }[]): string {
  if (!copies.length) return tr("bez kopií");
  if (copies.length <= BULK_LIST_MAX) return copies.map((x) => `„${x.name}“ ${x.pos}`).join(", ");
  const a = copies[0];
  const b = copies[copies.length - 1];
  return tr("{0} kopií: první „{1}“ {2} … poslední „{3}“ {4} (polohy všech: sestava komponenty)", copies.length, a.name, a.pos, b.name, b.pos);
}
