/**
 * Skupiny komponent sestavy (Desky, Normálie, Vedení…).
 *
 * V dokumentu se ukládá český název skupiny – nezávisle na jazyce rozhraní, stejně jako u rámu formy, knihovny normálií,
 * importu STEP a podsestav. Na obrazovce (strom sestavy, kusovník, CSV) se skupina překládá tr(). Skupina zadaná nebo uložená
 * v angličtině / němčině („Standard parts“, „Normteile“ – starší dokumenty, ruční zápis) se přiřadí ke své české skupině,
 * takže se ve stromu neobjeví dvakrát.
 */
import { dictOf, tr } from "./i18n";

/** známé skupiny (české klíče překladu) */
export const ASM_GROUPS = ["Podsestavy", "Desky", "Tvarové díly", "Vedení", "Vyhazování", "Normálie", "Chlazení", "Díly"] as const;
/** skupina komponenty bez zadané skupiny */
export const DEFAULT_GROUP = "Díly";

let rev: Map<string, string> | null = null;
/** překlad (EN / DE, bez ohledu na velikost písmen) → český klíč */
const reverse = () => {
  if (rev) return rev;
  rev = new Map();
  for (const g of ASM_GROUPS) {
    rev.set(g.toLocaleLowerCase(), g);
    for (const l of ["en", "de"] as const) {
      const t = dictOf(l)[g];
      if (t) rev.set(t.toLocaleLowerCase(), g);
    }
  }
  return rev;
};

/** Uložitelná (česká) podoba skupiny; neznámá vlastní skupina zůstane, jak je. */
export function groupKey(g?: string): string {
  const s = (g ?? "").trim();
  if (!s) return DEFAULT_GROUP;
  return reverse().get(s.toLocaleLowerCase()) ?? s;
}

const known = (k: string) => (ASM_GROUPS as readonly string[]).includes(k);
/** Název skupiny v jazyce rozhraní (vlastní skupina uživatele beze změny). */
export const groupLabel = (g?: string): string => {
  const k = groupKey(g);
  return known(k) ? tr(k) : k;
};

/** Komponenty po skupinách v pořadí prvního výskytu; skupiny se slučují podle klíče (Normálie = Standard parts = Normteile). */
export function groupComponents<T extends { group?: string }>(comps: readonly T[]): { key: string; label: string; items: T[] }[] {
  const by = new Map<string, T[]>();
  for (const c of comps) {
    const k = groupKey(c.group);
    by.set(k, [...(by.get(k) ?? []), c]);
  }
  return [...by.entries()].map(([key, items]) => ({ key, label: groupLabel(key), items }));
}
