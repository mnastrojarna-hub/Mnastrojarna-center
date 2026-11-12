/**
 * Paměť posunu (majitel 4. 11.: „Zpět mě vrátí vždy nahoru, chci doprostřed seznamu, kde jsem skončil").
 * Okno aplikace neroluje — roluje <main> a vnitřní panely (seznam a vlákno Pošty, sloupce Tabule) označené
 * data-scroll-key. Pozice se ukládají průběžně podle adresy (cesta + parametry) do sessionStorage a při
 * Zpět / Vpřed (i obnovení stránky) se obnoví, až má obsah dost výšky. Čistá logika; DOM řeší
 * components/nav/scroll-memory.tsx.
 */

export const SCROLL_STORE_KEY = "mn:nav:scroll";
/** Kolik adres si pamatovat (nejstarší odpadají). */
export const SCROLL_STORE_LIMIT = 60;
/** Jak dlouho se obnova pokouší (obsah se načítá, výška roste). */
export const RESTORE_WINDOW_MS = 4000;

export interface ScrollPos {
  t: number;
  l: number;
}
/** Pozice všech rolovacích prvků jedné adresy (klíč = data-scroll-key, „main" = hlavní plocha). */
export type ScrollEntry = Record<string, ScrollPos>;
/** adresa → pozice; pořadí klíčů = stáří (poslední = nejnovější). */
export type ScrollStore = Record<string, ScrollEntry>;

/** Klíč adresy: cesta + parametry (bez #). */
export function scrollKey(pathname: string, search: string): string {
  const s = search.startsWith("?") ? search : search ? `?${search}` : "";
  return pathname + s;
}

export function parseScrollStore(raw: string | null): ScrollStore {
  if (!raw) return {};
  try {
    const v = JSON.parse(raw) as unknown;
    return v && typeof v === "object" && !Array.isArray(v) ? (v as ScrollStore) : {};
  } catch {
    return {};
  }
}

/** Zapíše pozici prvku pod adresu; drží nejvýš SCROLL_STORE_LIMIT adres (nejstarší odpadne). */
export function withScrollPos(store: ScrollStore, key: string, el: string, pos: ScrollPos): ScrollStore {
  const { [key]: cur, ...rest } = store;
  const entry: ScrollEntry = { ...(cur ?? {}), [el]: { t: Math.max(0, Math.round(pos.t)), l: Math.max(0, Math.round(pos.l)) } };
  const next: ScrollStore = { ...rest, [key]: entry };
  const keys = Object.keys(next);
  if (keys.length > SCROLL_STORE_LIMIT) for (const k of keys.slice(0, keys.length - SCROLL_STORE_LIMIT)) delete next[k];
  return next;
}

/** Všechny pozice jedné adresy nebo null. */
export function scrollEntry(store: ScrollStore, key: string): ScrollEntry | null {
  const e = store[key];
  return e && Object.keys(e).length ? e : null;
}

/**
 * Je čas nastavit pozici? Až když má prvek dost výšky (obsah dorazil), nebo po vypršení okna
 * (nastaví se, co jde — prvek si hodnotu ořízne sám).
 */
export function canApply(pos: ScrollPos, scrollHeight: number, clientHeight: number, scrollWidth: number, clientWidth: number, expired: boolean): boolean {
  if (expired) return true;
  const maxT = Math.max(0, scrollHeight - clientHeight);
  const maxL = Math.max(0, scrollWidth - clientWidth);
  return maxT + 1 >= pos.t && maxL + 1 >= pos.l;
}

/** Je obnova hotová (prvek stojí tam, kam měl, ±2 px — zaokrouhlení prohlížeče)? */
export function isApplied(pos: ScrollPos, scrollTop: number, scrollLeft: number): boolean {
  return Math.abs(scrollTop - pos.t) <= 2 && Math.abs(scrollLeft - pos.l) <= 2;
}

/**
 * Je adresa, kterou zná Next (usePathname + useSearchParams().toString() — mezera jako „+"), táž jako adresa
 * prohlížeče (location — mezera jako „%20")? Po Zpět / Vpřed na adresu, kterou Next už zná (vlastní zápis adresy
 * se do Next ještě nestihl synchronizovat), Next svou adresu nezmění — obnovu posunu tedy nespustí změna
 * adresy, ale rovnou popstate.
 */
export function sameAddress(nextUrl: string, pathname: string, search: string): boolean {
  const q = new URLSearchParams(search).toString();
  return nextUrl === `${pathname}${q ? `?${q}` : ""}`;
}

/** Typ načtení stránky, po kterém se posun obnovuje i bez popstate (obnovení, zpět/vpřed do jiné karty). */
export function restoresOnLoad(navigationType: string | undefined): boolean {
  return navigationType === "reload" || navigationType === "back_forward";
}
