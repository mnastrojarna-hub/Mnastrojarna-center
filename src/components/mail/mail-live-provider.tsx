"use client";

import * as React from "react";
import {
  RESULT_KEY, fastOverride, liveInterval, mailChanged, nextDelay, nextFailures, releaseLease, shouldPoll, tryLease, type LiveResult,
} from "@/lib/email/live-poll";

/**
 * Živá pošta, dokud je aplikace otevřená: každých ~60 s (jen viditelná karta, jen jedna karta za
 * všechny, při chybách s odstupem) a hned po návratu do karty zavolá /api/emails/live — ten stáhne
 * nové e-maily a vrátí počet nepřečtených (odznak v menu) a razítko změny (Přijatá pošta se obnoví
 * bez načtení stránky). Na Vercel Hobby je plánovač jen 1× denně, „real-time" zajišťuje tohle.
 * Otevřená Pošta (useMailLiveFast) zrychlí kontrolu na 30 s; skrytá karta nekontroluje vůbec.
 */

interface LiveState {
  unread: number | null;
  stamp: string | null;
  remaining: number;
  /** Počítadlo změn pošty (seznam se má obnovit). */
  version: number;
  error?: string;
  /** Čas poslední dokončené kontroly (ms) — „Aktualizováno před X s". */
  at: number | null;
  /** Okamžitá kontrola (po odeslání, po stažení). */
  pokeNow: () => void;
  /** Zapnout rychlou kontrolu (otevřená Pošta); vrací vypínač. */
  setFast: (on: boolean) => void;
}

const LiveContext = React.createContext<LiveState>({ unread: null, stamp: null, remaining: 0, version: 0, at: null, pokeNow: () => {}, setFast: () => {} });

export function useMailLive(): LiveState {
  return React.useContext(LiveContext);
}

/** Dokud je komponenta připojená (Pošta otevřená), kontroluje se nová pošta každých 30 s. */
export function useMailLiveFast(enabled = true): void {
  const { setFast } = useMailLive();
  React.useEffect(() => {
    if (!enabled) return;
    setFast(true);
    return () => setFast(false);
  }, [enabled, setFast]);
}

function storage(): Storage | null {
  try {
    return typeof window !== "undefined" ? window.localStorage : null;
  } catch {
    return null;
  }
}

export function MailLiveProvider({ enabled, initialUnread, children }: { enabled: boolean; initialUnread?: number; children: React.ReactNode }) {
  const [state, setState] = React.useState<Omit<LiveState, "pokeNow" | "setFast">>({ unread: initialUnread ?? null, stamp: null, remaining: 0, version: 0, at: null });
  const tab = React.useRef(`t${Math.random().toString(36).slice(2)}`);
  const failures = React.useRef(0);
  const last = React.useRef<LiveResult | null>(null);
  const lastPollAt = React.useRef(0);
  const timer = React.useRef<ReturnType<typeof setTimeout> | null>(null);
  const inFlight = React.useRef(false);
  const channel = React.useRef<BroadcastChannel | null>(null);
  const fast = React.useRef(0);
  const interval = () => liveInterval(fast.current > 0);

  const apply = React.useCallback((r: LiveResult) => {
    if (last.current && last.current.at === r.at && last.current.stamp === r.stamp) return; // stejný výsledek (BroadcastChannel i storage)
    const changed = mailChanged(last.current, r);
    last.current = r;
    setState((s) => ({ unread: r.unread, stamp: r.stamp, remaining: r.remaining, error: r.error, at: r.at, version: changed ? s.version + 1 : s.version }));
  }, []);

  const poll = React.useCallback(async (force = false) => {
    if (!enabled || inFlight.current) return;
    const visible = typeof document === "undefined" || document.visibilityState === "visible";
    const online = typeof navigator === "undefined" || navigator.onLine !== false;
    if (!shouldPoll({ visible, online, enabled })) return;
    // jedna karta za všechny: zápůjčka na dobu intervalu (vynucená kontrola ji přebere; otevřená Pošta
    // nečeká na pomalejší kartu, když je poslední výsledek starší než 30 s)
    const store = storage();
    const ttl = liveInterval(fast.current > 0) - 5_000;
    const now = Date.now();
    if (!force && !tryLease(store, tab.current, now, ttl) && !fastOverride(fast.current > 0, last.current?.at, now)) return;
    if (force) tryLease(store, tab.current, now, ttl);
    inFlight.current = true;
    lastPollAt.current = Date.now();
    const run = async () => {
      try {
        const res = await fetch("/api/emails/live", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ sync: true, fast: fast.current > 0 }) });
        const data = (await res.json().catch(() => null)) as Partial<LiveResult> | null;
        if (!res.ok || !data) throw new Error(`HTTP ${res.status}`);
        const r: LiveResult = {
          unread: Number(data.unread) || 0, stamp: data.stamp ?? null, remaining: Number(data.remaining) || 0, at: Date.now(),
          ingested: Number(data.ingested) || 0, error: data.error, allFailed: data.allFailed === true,
        };
        failures.current = nextFailures(failures.current, { httpOk: true, allFailed: r.allFailed });
        apply(r);
        try { store?.setItem(RESULT_KEY, JSON.stringify(r)); } catch { /* plné úložiště */ }
        channel.current?.postMessage(r);
      } catch {
        failures.current = nextFailures(failures.current, { httpOk: false });
      } finally {
        inFlight.current = false;
      }
    };
    const locks = typeof navigator !== "undefined" ? (navigator as Navigator & { locks?: LockManager }).locks : undefined;
    if (locks?.request) {
      await locks.request("mail-live", { ifAvailable: true }, async (lock) => {
        if (lock) await run();
        else inFlight.current = false; // právě stahuje jiná karta
      });
    } else await run();
  }, [enabled, apply]);

  const schedule = React.useCallback((delay?: number) => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(async () => {
      await poll();
      schedule();
    }, delay ?? nextDelay(failures.current, interval()));
  }, [poll]); // eslint-disable-line react-hooks/exhaustive-deps

  const setFast = React.useCallback((on: boolean) => {
    const was = fast.current > 0;
    fast.current = Math.max(0, fast.current + (on ? 1 : -1));
    const is = fast.current > 0;
    if (!enabled || was === is) return;
    // přepnutí rychlosti: další kontrola podle nového intervalu (už prošlý → hned)
    // ještě žádná kontrola (první proběhne 4 s po načtení) → další až po celém intervalu
    const since = lastPollAt.current ? Date.now() - lastPollAt.current : 0;
    const base = nextDelay(failures.current, interval());
    schedule(Math.max(1_000, base - since));
  }, [enabled, schedule]); // eslint-disable-line react-hooks/exhaustive-deps

  React.useEffect(() => {
    if (!enabled) return;
    try {
      channel.current = typeof BroadcastChannel !== "undefined" ? new BroadcastChannel("mail-live") : null;
    } catch {
      channel.current = null;
    }
    const onMessage = (e: MessageEvent<LiveResult>) => e.data && apply(e.data);
    channel.current?.addEventListener("message", onMessage);
    const onStorage = (e: StorageEvent) => {
      if (e.key !== RESULT_KEY || !e.newValue) return;
      try { apply(JSON.parse(e.newValue) as LiveResult); } catch { /* nic */ }
    };
    window.addEventListener("storage", onStorage);
    const onVisible = () => {
      // návrat do karty: hned zkontrolovat (otevřená Pošta už po 10 s, jinak po 15 s od minula)
      if (document.visibilityState === "visible" && Date.now() - lastPollAt.current > (fast.current > 0 ? 10_000 : 15_000)) void poll();
    };
    document.addEventListener("visibilitychange", onVisible);
    window.addEventListener("focus", onVisible);
    window.addEventListener("online", onVisible);
    const first = setTimeout(() => void poll(), 4_000); // po načtení stránky (stránka si stahuje sama)
    schedule();
    const tabId = tab.current;
    return () => {
      clearTimeout(first);
      if (timer.current) clearTimeout(timer.current);
      channel.current?.removeEventListener("message", onMessage);
      channel.current?.close();
      window.removeEventListener("storage", onStorage);
      document.removeEventListener("visibilitychange", onVisible);
      window.removeEventListener("focus", onVisible);
      window.removeEventListener("online", onVisible);
      releaseLease(storage(), tabId);
    };
  }, [enabled, poll, schedule, apply]);

  const pokeNow = React.useCallback(() => void poll(true), [poll]);
  const value = React.useMemo<LiveState>(() => ({ ...state, pokeNow, setFast }), [state, pokeNow, setFast]);
  return <LiveContext.Provider value={value}>{children}</LiveContext.Provider>;
}
