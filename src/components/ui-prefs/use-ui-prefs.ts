"use client";

import * as React from "react";
import {
  mergeUiPrefs, parseUiPrefsCache, uiPrefsStorageKey, type UiPrefKey, type UiPrefs, type UiPrefsCache,
} from "@/lib/ui-prefs";

/** Odklad zápisu do DB (tažení oddělovače = mnoho změn za sekundu → jeden zápis). */
export const UI_PREFS_WRITE_DELAY_MS = 400;

function readCache(userId: string): UiPrefsCache {
  try {
    return parseUiPrefsCache(window.localStorage.getItem(uiPrefsStorageKey(userId)));
  } catch {
    return { prefs: {}, pending: [] };
  }
}

function writeCache(userId: string, cache: UiPrefsCache): void {
  try {
    window.localStorage.setItem(uiPrefsStorageKey(userId), JSON.stringify(cache));
  } catch {
    // soukromé okno / plné úložiště — DB zápis stačí
  }
}

const useIsoLayoutEffect = typeof window === "undefined" ? React.useEffect : React.useLayoutEffect;

/**
 * Osobní předvolby vzhledu: hodnota ze serveru (DB) při vykreslení na serveru, před prvním vykreslením
 * v prohlížeči navrch nepotvrzené místní změny (localStorage). Změna platí hned, do localStorage hned,
 * do DB s odkladem 400 ms (a při zavření karty přes keepalive) — bez potvrzování.
 */
export function useUiPrefs(userId: string | null | undefined, server: UiPrefs): [UiPrefs, (key: UiPrefKey, value: number | boolean | null) => void] {
  const [prefs, setPrefs] = React.useState<UiPrefs>(server);
  const timers = React.useRef(new Map<UiPrefKey, ReturnType<typeof setTimeout>>());
  const latest = React.useRef<UiPrefs>(server);

  const send = React.useCallback((key: UiPrefKey, keepalive = false) => {
    if (!userId) return;
    const value = latest.current[key] ?? null;
    void fetch("/api/ui-prefs", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ key, value }),
      keepalive,
    })
      .then((r) => (r.ok ? r.json() : null))
      .then((j: { ok?: boolean } | null) => {
        if (!j?.ok) return;
        // potvrzeno — jen pokud se mezitím hodnota nezměnila
        const cache = readCache(userId);
        if ((cache.prefs[key] ?? null) === value) writeCache(userId, { prefs: cache.prefs, pending: cache.pending.filter((k) => k !== key) });
      })
      .catch(() => undefined);
  }, [userId]);

  // před prvním vykreslením: nepotvrzené místní změny (zavřená karta během odkladu) navrch a poslat znovu
  useIsoLayoutEffect(() => {
    if (!userId) return;
    const cache = readCache(userId);
    const merged = mergeUiPrefs(server, cache);
    latest.current = merged;
    if (cache.pending.length) {
      setPrefs(merged);
      for (const k of cache.pending) send(k);
    }
    writeCache(userId, { prefs: merged, pending: cache.pending });
  }, [userId]); // eslint-disable-line react-hooks/exhaustive-deps

  // zavření / skrytí karty: čekající zápisy hned (keepalive přežije zavření)
  React.useEffect(() => {
    const t = timers.current;
    const flush = () => {
      for (const [k, h] of t) {
        clearTimeout(h);
        send(k, true);
      }
      t.clear();
    };
    const onVis = () => { if (document.visibilityState === "hidden") flush(); };
    window.addEventListener("pagehide", flush);
    document.addEventListener("visibilitychange", onVis);
    return () => {
      window.removeEventListener("pagehide", flush);
      document.removeEventListener("visibilitychange", onVis);
      flush();
    };
  }, [send]);

  const setPref = React.useCallback((key: UiPrefKey, value: number | boolean | null) => {
    const next: UiPrefs = { ...latest.current };
    if (value === null) delete (next as Record<string, unknown>)[key];
    else (next as Record<string, unknown>)[key] = value;
    latest.current = next;
    setPrefs(next);
    if (!userId) return;
    const cache = readCache(userId);
    writeCache(userId, { prefs: next, pending: [...new Set([...cache.pending, key])] });
    const t = timers.current;
    const h = t.get(key);
    if (h) clearTimeout(h);
    t.set(key, setTimeout(() => {
      t.delete(key);
      send(key);
    }, UI_PREFS_WRITE_DELAY_MS));
  }, [send, userId]);

  return [prefs, setPref];
}

type UiPrefsValue = [UiPrefs, (key: UiPrefKey, value: number | boolean | null) => void];
const UiPrefsContext = React.createContext<UiPrefsValue | null>(null);

/**
 * Jedny předvolby pro celou aplikaci (layout): hlavní menu (sbalené) i Pošta (šířka seznamu, složky, hustota)
 * sdílí stejný stav i mezipaměť — dvě nezávislé kopie by si v localStorage přepisovaly nepotvrzené změny.
 */
export function UiPrefsProvider({ userId, server, children }: { userId: string | null | undefined; server: UiPrefs; children?: React.ReactNode }) {
  const [prefs, setPref] = useUiPrefs(userId, server);
  const value = React.useMemo<UiPrefsValue>(() => [prefs, setPref], [prefs, setPref]);
  return React.createElement(UiPrefsContext.Provider, { value }, children);
}

/**
 * Předvolby z UiPrefsProvider (layout aplikace); bez něj (samostatný render, testy) vlastní kopie
 * se serverovými hodnotami `fallback`.
 */
export function useSharedUiPrefs(userId: string | null | undefined, fallback: UiPrefs): UiPrefsValue {
  const ctx = React.useContext(UiPrefsContext);
  const local = useUiPrefs(ctx ? null : userId, fallback);
  return ctx ?? local;
}
