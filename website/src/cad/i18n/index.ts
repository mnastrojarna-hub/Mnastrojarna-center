/**
 * Jazyk uživatelského rozhraní CADu (čeština, angličtina, němčina).
 *
 * Zdrojové texty v kódu jsou česky; `tr("český text")` vrátí překlad podle aktuálního jazyka (nebo český text,
 * když překlad chybí – chybějící klíče se sbírají pro kontrolu testem). Zástupné `{0}`, `{1}`… se nahradí argumenty:
 * `tr("Export {0} hotov", label)`. Jazyk se bere z adresy (/cad = cs, /en/cad = en, /de/cad = de) a nastavuje se
 * i ve web workeru, aby chybové hlášky jádra a texty výkresu byly ve stejném jazyce.
 */
import { DE } from "./de";
import { EN } from "./en";

export type CadLang = "cs" | "en" | "de";

export const CAD_LANGS: { id: CadLang; label: string; locale: string; path: string; docs: string }[] = [
  { id: "cs", label: "Čeština", locale: "cs-CZ", path: "/cad", docs: "/cad/dokumentace" },
  { id: "en", label: "English", locale: "en-GB", path: "/en/cad", docs: "/en/cad/documentation" },
  { id: "de", label: "Deutsch", locale: "de-DE", path: "/de/cad", docs: "/de/cad/dokumentation" },
];

const DICTS: Record<CadLang, Record<string, string>> = { cs: {}, en: EN, de: DE };
/** hodnoty slovníku – text už přeložený (např. mapa popisků vyhodnocená při načtení modulu) projde tr() beze změny a bez hlášení */
const VALUES: Partial<Record<CadLang, Set<string>>> = {};
const isTranslated = (l: CadLang, s: string) => (VALUES[l] ??= new Set(Object.values(DICTS[l]))).has(s);
let current: CadLang = "cs";
const missing = new Set<string>();

export function setLang(l: CadLang) {
  current = CAD_LANGS.some((x) => x.id === l) ? l : "cs";
}
export const getLang = (): CadLang => current;
export const langMeta = (l: CadLang = current) => CAD_LANGS.find((x) => x.id === l) ?? CAD_LANGS[0];
/** BCP-47 locale pro čísla a data (cs-CZ, en-GB, de-DE). */
export const cadLocale = (): string => langMeta().locale;

/** Jazyk z cesty: /en/… → en, /de/… → de, jinak cs. */
export function langFromPath(pathname: string): CadLang {
  const m = /^\/(en|de)(\/|$)/.exec(pathname);
  return (m?.[1] as CadLang | undefined) ?? "cs";
}

/** Překlad českého zdrojového textu; `{0}`, `{1}`… nahradí argumenty. Bez překladu vrátí zdroj (a zapamatuje si chybějící klíč). */
export function tr(key: string, ...args: unknown[]): string {
  let s = key;
  if (current !== "cs") {
    const d = DICTS[current][key];
    if (d !== undefined) s = d;
    else if (/\p{L}{3,}/u.test(key.replace(/\{\d+\}/g, " ")) && !isTranslated(current, key) && !/^(DIN|ISO|ČSN|EN|ANSI|JIS|HASCO|Meusburger)\b/.test(key)) missing.add(key); // zkratky, kódy (M{0}×{1}) a normy se nepočítají
  }
  if (args.length) s = s.replace(/\{(\d+)\}/g, (m, i) => (args[Number(i)] === undefined ? m : String(args[Number(i)])));
  return s;
}

/** Klíče, pro které v aktuálním jazyce chyběl překlad (pro testy a ladění). */
export const missingKeys = (): string[] => [...missing].sort();
export const clearMissing = () => missing.clear();
/** Má slovník daného jazyka překlad klíče? */
export const hasTranslation = (l: CadLang, key: string) => l === "cs" || DICTS[l][key] !== undefined;
export const dictOf = (l: CadLang) => DICTS[l];
