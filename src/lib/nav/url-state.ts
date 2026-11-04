/**
 * Paměť navigace (majitel 4. 11.): filtry, hledání, řazení, záložky a vybraná složka / vlákno žijí v adrese
 * stránky, takže „Zpět" z detailu vrátí přesně tentýž seznam a obnovení stránky nic nesmaže. Vedle toho si
 * každá stránka pamatuje poslední stav v sessionStorage — položka v menu („Kniha zakázek", „Pošta") ho otevře
 * s posledními filtry (viditelně, s tlačítkem Zrušit filtry). Čistá logika bez DOM — hook je v
 * components/nav/use-url-state.ts.
 */

/** Hodnoty stavu stránky — vždy řetězce (prázdný = výchozí, do adresy se nezapisuje). */
export type UrlValues<K extends string = string> = Record<K, string>;

/** Předpona klíčů v sessionStorage (poslední stav stránky podle cesty). */
export const PAGE_MEMORY_PREFIX = "mn:nav:last:";

/** Parametry adresy, které jsou jednorázové akce (otevřít dialog apod.) — nikdy se nepamatují. */
export const TRANSIENT_PARAMS = new Set(["capture", "new", "nova", "akce", "nastaveni", "smlouva", "pristup"]);

/** Načte hodnoty podle výchozích (chybějící nebo prázdný parametr = výchozí hodnota). */
export function readUrlValues<K extends string>(search: string | URLSearchParams, defaults: UrlValues<K>): UrlValues<K> {
  const sp = typeof search === "string" ? new URLSearchParams(search) : search;
  const out = { ...defaults };
  for (const key of Object.keys(defaults) as K[]) {
    const raw = sp.get(key);
    if (raw !== null && raw !== "") out[key] = raw;
  }
  return out;
}

/**
 * Zapíše hodnoty do parametrů adresy: výchozí hodnota parametr odstraní, ostatní parametry (cizí) zůstanou.
 * Vrací nový řetězec hledání (bez „?"), čárky nezakódované (čitelné ?stav=a,b).
 */
export function writeUrlValues<K extends string>(search: string, defaults: UrlValues<K>, values: UrlValues<K>): string {
  const sp = new URLSearchParams(search);
  for (const key of Object.keys(defaults) as K[]) {
    const v = values[key] ?? defaults[key];
    if (v === defaults[key] || v === "") sp.delete(key);
    else sp.set(key, v);
  }
  return sp.toString().replace(/%2C/g, ",");
}

/** Liší se hodnoty od výchozích? (= jsou aktivní filtry) */
export function isDefaultValues<K extends string>(defaults: UrlValues<K>, values: UrlValues<K>): boolean {
  return (Object.keys(defaults) as K[]).every((k) => (values[k] ?? defaults[k]) === defaults[k]);
}

/** Jen pamatovatelné parametry (bez jednorázových akcí); prázdný řetězec = nic k pamatování. */
export function memorableSearch(search: string, extraTransient: Iterable<string> = []): string {
  const sp = new URLSearchParams(search);
  for (const k of TRANSIENT_PARAMS) sp.delete(k);
  for (const k of extraTransient) sp.delete(k);
  return sp.toString().replace(/%2C/g, ",");
}

/** Klíč paměti stránky (podle cesty bez parametrů). */
export function pageMemoryKey(pathname: string): string {
  return PAGE_MEMORY_PREFIX + pathname.replace(/\/+$/, "");
}

interface StorageLike {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

function storage(): StorageLike | null {
  try {
    if (typeof window === "undefined") return null;
    return window.sessionStorage;
  } catch {
    return null; // zakázané úložiště (soukromé okno) — paměť jen v adrese
  }
}

/** Uloží poslední stav stránky (hledání bez jednorázových parametrů). Prázdné = zapomenout. */
export function rememberPageSearch(
  pathname: string, search: string, store: StorageLike | null = storage(), extraTransient: Iterable<string> = [],
): void {
  if (!store) return;
  const key = pageMemoryKey(pathname);
  const value = memorableSearch(search, extraTransient);
  try {
    if (value) store.setItem(key, value);
    else store.removeItem(key);
  } catch {
    // plné úložiště — bez paměti
  }
}

/** Poslední zapamatovaný stav stránky (řetězec hledání bez „?") nebo null. */
export function recallPageSearch(pathname: string, store: StorageLike | null = storage()): string | null {
  if (!store) return null;
  try {
    const v = store.getItem(pageMemoryKey(pathname));
    return v ? v : null;
  } catch {
    return null;
  }
}

export function forgetPageSearch(pathname: string, store: StorageLike | null = storage()): void {
  try {
    store?.removeItem(pageMemoryKey(pathname));
  } catch {
    // nic
  }
}

/**
 * Odkaz z menu: cesta bez parametrů dostane poslední zapamatovaný stav stránky („/orders" → „/orders?segment=vse&q=…").
 * Odkaz s vlastními parametry (např. /orders?capture=1) zůstává, jak je.
 */
export function rememberedHref(href: string, store: StorageLike | null = storage()): string {
  if (href.includes("?") || href.includes("#")) return href;
  const remembered = recallPageSearch(href, store);
  return remembered ? `${href}?${remembered}` : href;
}
