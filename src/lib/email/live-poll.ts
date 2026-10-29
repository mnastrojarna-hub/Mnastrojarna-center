/**
 * Živá pošta v prohlížeči — čistá logika (testy v live-poll.test.ts):
 *  - interval ~60 s, při chybách s rostoucím odstupem (2, 4, 8 … max. 10 min),
 *  - jen viditelná karta, jen online,
 *  - „single-flight" přes všechny karty: stahuje jedna karta (zápůjčka v localStorage, s Web Locks
 *    API ještě přísněji), ostatní dostanou výsledek přes BroadcastChannel / událost storage.
 */

export const LIVE_INTERVAL_MS = 60_000;
export const LIVE_MAX_BACKOFF_MS = 10 * 60_000;
export const LEASE_KEY = "mail-live-lease";
export const RESULT_KEY = "mail-live-result";

/** Odstup další kontroly: bez chyb interval, po n chybách interval × 2^n (max. 10 min). */
export function nextDelay(failures: number, base = LIVE_INTERVAL_MS, max = LIVE_MAX_BACKOFF_MS): number {
  const n = Math.max(0, Math.min(10, Math.floor(failures)));
  return Math.min(max, base * 2 ** n);
}

export interface LeaseStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem?(key: string): void;
}

interface Lease {
  tab: string;
  until: number;
}

function readLease(storage: LeaseStorage, key: string): Lease | null {
  try {
    const v = JSON.parse(storage.getItem(key) ?? "null") as Lease | null;
    return v && typeof v.tab === "string" && typeof v.until === "number" ? v : null;
  } catch {
    return null;
  }
}

/**
 * Zápůjčka „já teď stahuji": volná / prošlá / moje → vezmu ji (do now + ttl) a vrátím true.
 * Jinak stahuje jiná karta → false. Nedostupné úložiště = každá karta sama za sebe (true).
 */
export function tryLease(storage: LeaseStorage | null | undefined, tab: string, now: number, ttlMs: number, key = LEASE_KEY): boolean {
  if (!storage) return true;
  try {
    const cur = readLease(storage, key);
    if (cur && cur.tab !== tab && cur.until > now) return false;
    storage.setItem(key, JSON.stringify({ tab, until: now + ttlMs }));
    // ověřit, že jsme zápis nepřepsali souběžně jinou kartou
    return readLease(storage, key)?.tab === tab;
  } catch {
    return true;
  }
}

export function releaseLease(storage: LeaseStorage | null | undefined, tab: string, key = LEASE_KEY): void {
  if (!storage) return;
  try {
    const cur = readLease(storage, key);
    if (cur?.tab === tab) storage.removeItem ? storage.removeItem(key) : storage.setItem(key, "null");
  } catch {
    // nic
  }
}

/** Má se teď kontrolovat? (viditelná karta, online, přístup k poště) */
export function shouldPoll(s: { visible: boolean; online: boolean; enabled: boolean }): boolean {
  return s.enabled && s.visible && s.online;
}

export interface LiveResult {
  unread: number;
  stamp: string | null;
  remaining: number;
  at: number;
  /** Kolik e-mailů tato kontrola stáhla a uložila. */
  ingested?: number;
  /** Chyby jednotlivých schránek (zobrazení, ne odstup). */
  error?: string;
  /** Selhaly VŠECHNY stahované schránky → odstup jako při chybě spojení. */
  allFailed?: boolean;
}

/**
 * Změnila se pošta od minula (nový e-mail / stažená dávka)? První výsledek (prev = null) je
 * výchozí stav — změna jen tehdy, když tahle kontrola sama něco stáhla (stránka ho ještě nezná).
 */
export function mailChanged(prev: Pick<LiveResult, "stamp"> | null, next: Pick<LiveResult, "stamp" | "ingested">): boolean {
  if ((next.ingested ?? 0) > 0) return true;
  if (!prev) return false;
  return Boolean(next.stamp) && next.stamp !== prev.stamp;
}

/**
 * Počet chyb pro odstup po výsledku kontroly: HTTP chyba / všechny schránky selhaly → +1, jinak 0
 * (jedna rozbitá schránka kolegy nezpomalí živou poštu ostatních — její chybu ukáže stav schránky).
 */
export function nextFailures(prev: number, r: { httpOk: boolean; allFailed?: boolean }): number {
  return !r.httpOk || r.allFailed ? prev + 1 : 0;
}
