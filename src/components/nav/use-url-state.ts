"use client";

import * as React from "react";
import * as nav from "next/navigation";
import { isDefaultValues, readUrlValues, rememberPageSearch, writeUrlValues, type UrlValues } from "@/lib/nav/url-state";

/**
 * Stav stránky v adrese (filtry, hledání, řazení, záložka, vybrané vlákno…) — majitel 4. 11.: „systém si
 * nepamatuje filtry: nastavím filtr, otevřu něco, dám Zpět a filtr je pryč".
 *
 * - Zdrojem pravdy je lokální stav (psaní nezdržuje), každá změna se hned zapíše do adresy stejné položky
 *   historie (replaceState → psaní nezaplní historii), takže odkaz na detail je běžný push a Zpět vrátí
 *   seznam i s filtry; obnovení stránky je zachová také.
 * - `push: true` přidá položku historie (otevření vlákna na telefonu: Zpět ho zavře a vrátí seznam).
 * - Zpět / Vpřed uvnitř stránky (Next synchronizuje useSearchParams) stav převezme.
 * - `remember`: poslední stav se uloží do sessionStorage pod cestou stránky — položka menu bez parametrů ho
 *   otevře znovu (viz rememberedHref), viditelně, s tlačítkem Zrušit filtry.
 *
 * Hodnoty jsou řetězce; prázdný / výchozí = parametr v adrese není.
 */
export interface UrlStateOptions {
  /** Pamatovat poslední stav pro položku menu (výchozí true). */
  remember?: boolean;
  /** Klíče, které se do paměti pro menu nepíšou (otevřené vlákno apod.) — v adrese a při Zpět platí dál. */
  transient?: string[];
}

/** Hook z next/navigation, nebo náhrada (testy s vlastní náhradou modulu export nemusí mít; mimo router vrací null). */
function navHook<T>(name: "useSearchParams" | "usePathname", fallback: T): T {
  try {
    const f = (nav as unknown as Record<string, unknown>)[name];
    return typeof f === "function" ? (f as T) : fallback;
  } catch {
    return fallback;
  }
}
const useSearchParamsSafe = navHook<() => { toString(): string } | null>("useSearchParams", () => null);
const usePathnameSafe = navHook<() => string | null>("usePathname", () => null);

export type SetUrlState<K extends string> = (patch: Partial<UrlValues<K>>, opts?: {
  /** Nová položka historie (Zpět ji vrátí). */
  push?: boolean;
  /** Zápis do adresy odložit (psaní do hledání: stav hned, adresa až po pauze). */
  delay?: number;
}) => void;

export function useUrlState<K extends string>(defaults: UrlValues<K>, options: UrlStateOptions = {}): {
  values: UrlValues<K>;
  set: SetUrlState<K>;
  reset: () => void;
  /** Jsou všechny hodnoty výchozí? */
  isDefault: boolean;
} {
  const remember = options.remember !== false;
  const transient = React.useRef(options.transient ?? []);
  const pathname = usePathnameSafe() ?? "";
  const sp = useSearchParamsSafe();
  const search = sp?.toString() ?? "";
  const defaultsRef = React.useRef(defaults);
  defaultsRef.current = defaults;
  const [values, setValues] = React.useState<UrlValues<K>>(() => readUrlValues(search, defaults));
  const valuesRef = React.useRef(values);
  valuesRef.current = values;
  const timer = React.useRef<number | null>(null);

  // adresa se změnila zvenku (Zpět / Vpřed) → převzít; zastaralé synchronizace (po vlastním zápisu) ignorovat
  React.useEffect(() => {
    if (typeof window === "undefined") return;
    const live = window.location.search.replace(/^\?/, "");
    if (normalize(live) !== normalize(search)) return;
    const next = readUrlValues(search, defaultsRef.current);
    if (!sameValues(valuesRef.current, next)) {
      valuesRef.current = next;
      setValues(next);
    }
  }, [search]);

  // první vykreslení s parametry v adrese (odkaz, obnovení) → paměť stránky odpovídá adrese
  React.useEffect(() => {
    if (!remember || typeof window === "undefined") return;
    rememberPageSearch(pathname || window.location.pathname, window.location.search, undefined, transient.current);
    // jen při připojení — další změny ukládá `set`
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const write = React.useCallback((next: UrlValues<K>, push: boolean) => {
    if (typeof window === "undefined") return;
    try {
      const qs = writeUrlValues(window.location.search, defaultsRef.current, next);
      const url = `${window.location.pathname}${qs ? `?${qs}` : ""}${window.location.hash}`;
      // prázdný stav → Next si doplní svůj (a zároveň synchronizuje useSearchParams / usePathname)
      if (push) window.history.pushState({}, "", url);
      else window.history.replaceState({}, "", url);
      if (remember) rememberPageSearch(window.location.pathname, qs, undefined, transient.current);
    } catch {
      // adresa je jen pohodlí — filtr funguje dál
    }
  }, [remember]);

  const set = React.useCallback<SetUrlState<K>>((patch, opts) => {
    const next = { ...valuesRef.current, ...patch } as UrlValues<K>;
    if (sameValues(valuesRef.current, next) && !opts?.push) return;
    valuesRef.current = next;
    setValues(next);
    if (timer.current !== null) {
      window.clearTimeout(timer.current);
      timer.current = null;
    }
    if (opts?.delay && !opts.push) {
      timer.current = window.setTimeout(() => {
        timer.current = null;
        write(valuesRef.current, false);
      }, opts.delay);
      return;
    }
    write(next, Boolean(opts?.push));
  }, [write]);

  // odložený zápis dokončit při odpojení — jen dokud je adresa pořád tato stránka (ne po odchodu jinam)
  const pathRef = React.useRef(pathname);
  pathRef.current = pathname;
  React.useEffect(() => () => {
    if (timer.current === null) return;
    window.clearTimeout(timer.current);
    timer.current = null;
    if (window.location.pathname === pathRef.current) write(valuesRef.current, false);
  }, [write]);

  const reset = React.useCallback(() => set({ ...defaultsRef.current }), [set]);

  return { values, set, reset, isDefault: isDefaultValues(defaults, values) };
}

function normalize(search: string): string {
  return new URLSearchParams(search).toString();
}

function sameValues<K extends string>(a: UrlValues<K>, b: UrlValues<K>): boolean {
  const keys = new Set([...Object.keys(a), ...Object.keys(b)] as K[]);
  for (const k of keys) if ((a[k] ?? "") !== (b[k] ?? "")) return false;
  return true;
}
