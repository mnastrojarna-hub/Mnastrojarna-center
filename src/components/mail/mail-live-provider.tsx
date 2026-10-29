"use client";

import * as React from "react";
import {
  LIVE_INTERVAL_MS, RESULT_KEY, mailChanged, nextDelay, nextFailures, releaseLease, shouldPoll, tryLease, type LiveResult,
} from "@/lib/email/live-poll";

/**
 * Živá pošta, dokud je aplikace otevřená: každých ~60 s (jen viditelná karta, jen jedna karta za
 * všechny, při chybách s odstupem) a hned po návratu do karty zavolá /api/emails/live — ten stáhne
 * nové e-maily a vrátí počet nepřečtených (odznak v menu) a razítko změny (Přijatá pošta se obnoví
 * bez načtení stránky). Na Vercel Hobby je plánovač jen 1× denně, „real-time" zajišťuje tohle.
 */

interface LiveState {
  unread: number | null;
  stamp: string | null;
  remaining: number;
  /** Počítadlo změn pošty (seznam se má obnovit). */
  version: number;
  error?: string;
  /** Okamžitá kontrola (po odeslání, po stažení). */
  pokeNow: () => void;
}

const LiveContext = React.createContext<LiveState>({ unread: null, stamp: null, remaining: 0, version: 0, pokeNow: () => {} });

export function useMailLive(): LiveState {
  return React.useContext(LiveContext);
}

function storage(): Storage | null {
  try {
    return typeof window !== "undefined" ? window.localStorage : null;
  } catch {
    return null;
  }
}

export function MailLiveProvider({ enabled, initialUnread, children }: { enabled: boolean; initialUnread?: number; children: React.ReactNode }) {
  const [state, setState] = React.useState<Omit<LiveState, "pokeNow">>({ unread: initialUnread ?? null, stamp: null, remaining: 0, version: 0 });
  const tab = React.useRef(`t${Math.random().toString(36).slice(2)}`);
  const failures = React.useRef(0);
  const last = React.useRef<LiveResult | null>(null);
  const lastPollAt = React.useRef(0);
  const timer = React.useRef<ReturnType<typeof setTimeout> | null>(null);
  const inFlight = React.useRef(false);
  const channel = React.useRef<BroadcastChannel | null>(null);

  const apply = React.useCallback((r: LiveResult) => {
    if (last.current && last.current.at === r.at && last.current.stamp === r.stamp) return; // stejný výsledek (BroadcastChannel i storage)
    const changed = mailChanged(last.current, r);
    last.current = r;
    setState((s) => ({ unread: r.unread, stamp: r.stamp, remaining: r.remaining, error: r.error, version: changed ? s.version + 1 : s.version }));
  }, []);

  const poll = React.useCallback(async (force = false) => {
    if (!enabled || inFlight.current) return;
    const visible = typeof document === "undefined" || document.visibilityState === "visible";
    const online = typeof navigator === "undefined" || navigator.onLine !== false;
    if (!shouldPoll({ visible, online, enabled })) return;
    // jedna karta za všechny: zápůjčka na dobu intervalu (vynucená kontrola ji přebere)
    const store = storage();
    if (!force && !tryLease(store, tab.current, Date.now(), LIVE_INTERVAL_MS - 5_000)) return;
    if (force) tryLease(store, tab.current, Date.now(), LIVE_INTERVAL_MS - 5_000);
    inFlight.current = true;
    lastPollAt.current = Date.now();
    const run = async () => {
      try {
        const res = await fetch("/api/emails/live", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ sync: true }) });
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

  const schedule = React.useCallback(() => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(async () => {
      await poll();
      schedule();
    }, nextDelay(failures.current));
  }, [poll]);

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
      if (document.visibilityState === "visible" && Date.now() - lastPollAt.current > 15_000) void poll();
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
  const value = React.useMemo<LiveState>(() => ({ ...state, pokeNow }), [state, pokeNow]);
  return <LiveContext.Provider value={value}>{children}</LiveContext.Provider>;
}
