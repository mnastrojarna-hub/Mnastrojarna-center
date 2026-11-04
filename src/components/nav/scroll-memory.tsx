"use client";

import * as React from "react";
import * as nav from "next/navigation";
import {
  RESTORE_WINDOW_MS, SCROLL_STORE_KEY, canApply, isApplied, parseScrollStore, restoresOnLoad, scrollEntry, scrollKey, withScrollPos,
  type ScrollEntry, type ScrollStore,
} from "@/lib/nav/scroll-memory";
import { URL_WRITE_EVENT } from "@/lib/nav/safe-history";

/**
 * Paměť posunu pro celou aplikaci (majitel 4. 11.: „Zpět mě vrátí vždy nahoru"). Okno neroluje — roluje
 * <main data-scroll-key="main"> a vnitřní panely s data-scroll-key (seznam a vlákno Pošty, sloupce Tabule).
 *
 * - Ukládání: každý posun (zachycený na dokumentu) se zapíše pod adresu stránky (cesta + parametry) do
 *   sessionStorage; stejně tak při odchodu ze stránky (obnovení, zavření karty).
 * - Obnova: jen po Zpět / Vpřed (popstate) a po obnovení stránky — nová navigace (odkaz, menu) začíná nahoře
 *   jako dřív. Nastaví se, až má obsah dost výšky (seznam se načítá i na klientu), nejvýš RESTORE_WINDOW_MS;
 *   vlastní posun uživatele (kolečko, prst, klávesy) obnovu okamžitě ukončí.
 * - router.refresh / živá pošta adresu nemění → nic neobnovují, posun zůstává.
 */

const SCROLL_ATTR = "data-scroll-key";

/** Je právě obnovovaná pozice po Zpět / Vpřed? (karta zakázky pak neroluje k záložkám z ?tab=) */
let traversalUntil = 0;
export function isTraversalNavigation(): boolean {
  return Date.now() < traversalUntil;
}

function currentKey(): string {
  return scrollKey(window.location.pathname, window.location.search);
}

function readStore(): ScrollStore {
  try {
    return parseScrollStore(window.sessionStorage.getItem(SCROLL_STORE_KEY));
  } catch {
    return {};
  }
}

function writeStore(store: ScrollStore): void {
  try {
    window.sessionStorage.setItem(SCROLL_STORE_KEY, JSON.stringify(store));
  } catch {
    // zakázané / plné úložiště — bez paměti posunu
  }
}

function keyOf(el: Element): string | null {
  return el.getAttribute(SCROLL_ATTR);
}

function elementFor(key: string): HTMLElement | null {
  return document.querySelector<HTMLElement>(`[${SCROLL_ATTR}="${key}"]`);
}

/** Pozice všech označených prvků právě teď. */
function snapshot(): ScrollEntry {
  const out: ScrollEntry = {};
  document.querySelectorAll<HTMLElement>(`[${SCROLL_ATTR}]`).forEach((el) => {
    const key = keyOf(el);
    if (!key) return;
    if (el.scrollTop > 0 || el.scrollLeft > 0) out[key] = { t: el.scrollTop, l: el.scrollLeft };
  });
  return out;
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

export function ScrollMemory() {
  const pathname = usePathnameSafe() ?? "";
  const sp = useSearchParamsSafe();
  const search = sp?.toString() ?? "";
  const url = `${pathname}${search ? `?${search}` : ""}`;

  // paměť v RAM (sessionStorage se zapisuje odloženě)
  const store = React.useRef<ScrollStore | null>(null);
  const flush = React.useRef<number | null>(null);
  const restoring = React.useRef<{ key: string; entry: ScrollEntry; done: Set<string>; until: number; raf: number } | null>(null);
  const lastHref = React.useRef<string>("");
  const pendingTraversal = React.useRef(false);

  const getStore = React.useCallback((): ScrollStore => {
    if (!store.current) store.current = readStore();
    return store.current;
  }, []);

  const scheduleFlush = React.useCallback(() => {
    if (flush.current !== null) return;
    flush.current = window.setTimeout(() => {
      flush.current = null;
      if (store.current) writeStore(store.current);
    }, 250);
  }, []);

  const save = React.useCallback((key: string, elKey: string, t: number, l: number) => {
    store.current = withScrollPos(getStore(), key, elKey, { t, l });
    scheduleFlush();
  }, [getStore, scheduleFlush]);

  const stopRestore = React.useCallback(() => {
    const r = restoring.current;
    if (!r) return;
    window.cancelAnimationFrame(r.raf);
    restoring.current = null;
  }, []);

  /** Obnova pozic adresy: každý snímek zkusí nastavit, co už má dost výšky; končí hotovo / vypršení. */
  const restore = React.useCallback((key: string, entry: ScrollEntry) => {
    stopRestore();
    const state = { key, entry, done: new Set<string>(), until: Date.now() + RESTORE_WINDOW_MS, raf: 0 };
    restoring.current = state;
    const tick = () => {
      if (restoring.current !== state) return;
      if (currentKey() !== key) return void stopRestore();
      const expired = Date.now() > state.until;
      for (const [elKey, pos] of Object.entries(entry)) {
        if (state.done.has(elKey)) continue;
        const el = elementFor(elKey);
        if (!el) continue;
        if (!canApply(pos, el.scrollHeight, el.clientHeight, el.scrollWidth, el.clientWidth, expired)) continue;
        el.scrollTop = pos.t;
        el.scrollLeft = pos.l;
        if (isApplied(pos, el.scrollTop, el.scrollLeft) || expired) state.done.add(elKey);
      }
      if (state.done.size >= Object.keys(entry).length || expired) {
        // pozice stojí → od teď se ukládá zase to, co uživatel udělá
        restoring.current = null;
        return;
      }
      state.raf = window.requestAnimationFrame(tick);
    };
    state.raf = window.requestAnimationFrame(tick);
  }, [stopRestore]);

  // posuny zachytit na dokumentu (scroll nebublá, ale zachycení funguje)
  React.useEffect(() => {
    const onScroll = (e: Event) => {
      const el = e.target;
      if (!(el instanceof Element)) return;
      const elKey = keyOf(el);
      if (!elKey) return;
      const r = restoring.current;
      // během obnovy neukládat (ořezané hodnoty by přepsaly cíl) — kromě prvků, které už stojí
      if (r && r.key === currentKey() && !r.done.has(elKey)) return;
      // po Zpět / Vpřed, než obnova začne (Next ještě nesynchronizoval adresu): seznam se znovu vykreslí
      // a posun se ořízne na 0 — ten by přepsal uloženou pozici (telefon: 2305 → 0)
      if (pendingTraversal.current && Date.now() < traversalUntil) return;
      save(currentKey(), elKey, (el as HTMLElement).scrollTop, (el as HTMLElement).scrollLeft);
    };
    // vlastní posun uživatele ukončí obnovu (nikdy nebojovat s člověkem)
    const onIntent = () => stopRestore();
    const onPop = () => {
      const href = window.location.href;
      if (href !== lastHref.current) {
        pendingTraversal.current = true;
        traversalUntil = Date.now() + RESTORE_WINDOW_MS;
      }
    };
    const onHide = () => {
      // odchod (obnovení stránky, zavření karty): poslední pozice hned do úložiště
      const snap = snapshot();
      let s = getStore();
      for (const [elKey, pos] of Object.entries(snap)) s = withScrollPos(s, currentKey(), elKey, pos);
      store.current = s;
      writeStore(s);
    };
    document.addEventListener("scroll", onScroll, { capture: true, passive: true });
    window.addEventListener("wheel", onIntent, { capture: true, passive: true });
    window.addEventListener("touchmove", onIntent, { capture: true, passive: true });
    window.addEventListener("keydown", onIntent, true);
    window.addEventListener("popstate", onPop);
    window.addEventListener("pagehide", onHide);
    return () => {
      document.removeEventListener("scroll", onScroll, { capture: true });
      window.removeEventListener("wheel", onIntent, { capture: true });
      window.removeEventListener("touchmove", onIntent, { capture: true });
      window.removeEventListener("keydown", onIntent, true);
      window.removeEventListener("popstate", onPop);
      window.removeEventListener("pagehide", onHide);
    };
  }, [getStore, save, stopRestore]);

  // první načtení: po obnovení stránky / zpět z jiné karty obnovit, jinak nic
  const booted = React.useRef(false);
  React.useEffect(() => {
    if (booted.current) return;
    booted.current = true;
    lastHref.current = window.location.href;
    const nav = performance.getEntriesByType("navigation")[0] as PerformanceNavigationTiming | undefined;
    if (!restoresOnLoad(nav?.type)) return;
    const entry = scrollEntry(getStore(), currentKey());
    if (entry) restore(currentKey(), entry);
  }, [getStore, restore]);

  // změna adresy: po Zpět / Vpřed obnovit; jinak (odkaz, filtr) si nová adresa převezme aktuální pozice
  const onUrlChanged = React.useCallback(() => {
    if (!booted.current) return;
    const href = window.location.href;
    if (href === lastHref.current) return;
    lastHref.current = href;
    const key = currentKey();
    if (pendingTraversal.current) {
      pendingTraversal.current = false;
      const entry = scrollEntry(getStore(), key);
      if (entry) restore(key, entry);
      else stopRestore();
      return;
    }
    stopRestore();
    const snap = snapshot();
    for (const [elKey, pos] of Object.entries(snap)) save(key, elKey, pos.t, pos.l);
  }, [getStore, restore, save, stopRestore]);
  React.useEffect(() => { onUrlChanged(); }, [url, onUrlChanged]);
  // vlastní zápis adresy (useUrlState → writeUrlSafely) se do useSearchParams dostane až při synchronizaci
  // s Next — pozice převzít hned (než uživatel odejde odkazem pryč)
  React.useEffect(() => {
    window.addEventListener(URL_WRITE_EVENT, onUrlChanged);
    return () => window.removeEventListener(URL_WRITE_EVENT, onUrlChanged);
  }, [onUrlChanged]);

  return null;
}
