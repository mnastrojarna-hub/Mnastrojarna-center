import "server-only";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { isFakeCapture } from "@/lib/ai/fake-capture";
import { icoDigits, isValidIco, parseAresSearch, parseAresSubject, type AresCompany, type AresSearchResult } from "@/lib/ares/ares";

/**
 * ARES přes veřejné REST API v3 (bez klíče): firma podle IČO a hledání podle názvu.
 * Krátký timeout (ARES občas zpomalí) a paměťová cache — stejné IČO se při zakládání ptá víckrát.
 *
 * TESTY: ARES_FAKE_DIR=<adresář> → subjekt-<ico>.json / vyhledat.json místo sítě (chybějící soubor =
 * nenalezeno). V testovacím režimu AI (AI_FAKE_CAPTURE) bez ARES_FAKE_DIR se síť nevolá (= nedostupné).
 * ARES_API_URL přepíše adresu API (výchozí ares.gov.cz).
 */

const DEFAULT_BASE = "https://ares.gov.cz/ekonomicke-subjekty-v-be/rest";
const TIMEOUT_MS = 8_000;
const TTL_MS = 6 * 3600_000;
const MAX_CACHE = 500;

export type AresFailure = "invalid" | "not_found" | "unavailable";

export type AresLookup =
  | { ok: true; company: AresCompany }
  | { ok: false; reason: AresFailure; error: string };

export type AresSearch = ({ ok: true } & AresSearchResult) | { ok: false; reason: "unavailable"; error: string };

export const ARES_TEXT: Record<AresFailure, string> = {
  invalid: "Tohle IČO nemá platnou kontrolní číslici — zkontroluj ho.",
  not_found: "V ARES firma s tímto IČO není (zahraniční firma nebo překlep).",
  unavailable: "ARES teď neodpovídá — údaje doplň ručně nebo to zkus za chvíli.",
};

const cache = new Map<string, { at: number; value: unknown }>();

function cached<T>(key: string): T | undefined {
  const hit = cache.get(key);
  if (!hit) return undefined;
  if (Date.now() - hit.at > TTL_MS) {
    cache.delete(key);
    return undefined;
  }
  return hit.value as T;
}

function remember(key: string, value: unknown) {
  if (cache.size >= MAX_CACHE) {
    const first = cache.keys().next().value;
    if (first !== undefined) cache.delete(first);
  }
  cache.set(key, { at: Date.now(), value });
}

function base(): string {
  return (process.env.ARES_API_URL || DEFAULT_BASE).replace(/\/+$/, "");
}

function fakeDir(): string | null {
  const dir = process.env.ARES_FAKE_DIR;
  return dir ? path.resolve(dir) : null;
}

function readFake(name: string): unknown {
  const dir = fakeDir();
  if (!dir || !/^[a-z0-9-]{1,40}\.json$/.test(name)) return null;
  const file = path.join(dir, name);
  if (!existsSync(file)) return null;
  try {
    return JSON.parse(readFileSync(file, "utf8"));
  } catch {
    return null;
  }
}

/** Bez sítě: testovací režim AI bez fixtures ARES. */
function offline(): boolean {
  return !fakeDir() && isFakeCapture();
}

async function aresFetch(url: string, init: RequestInit = {}): Promise<{ status: number; json: unknown } | null> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(url, {
      ...init,
      headers: { Accept: "application/json", ...(init.body ? { "Content-Type": "application/json" } : {}) },
      signal: ctrl.signal,
      cache: "no-store",
    });
    const type = res.headers.get("content-type") ?? "";
    if (!type.includes("json")) return { status: res.status === 200 ? 502 : res.status, json: null };
    return { status: res.status, json: await res.json().catch(() => null) };
  } catch (err) {
    console.error(`[ares] ${url}: ${err instanceof Error ? err.message : String(err)}`);
    return null;
  } finally {
    clearTimeout(timer);
  }
}

/** Firma podle IČO (kontrolní číslice se ověří předem, síť se pak nevolá). */
export async function aresByIco(raw: string): Promise<AresLookup> {
  const ico = icoDigits(raw);
  if (!ico || !isValidIco(ico)) return { ok: false, reason: "invalid", error: ARES_TEXT.invalid };
  const key = `ico:${ico}`;
  const hit = cached<AresLookup>(key);
  if (hit) return hit;
  let out: AresLookup;
  if (fakeDir()) {
    const company = parseAresSubject(readFake(`subjekt-${ico}.json`));
    out = company ? { ok: true, company } : { ok: false, reason: "not_found", error: ARES_TEXT.not_found };
  } else if (offline()) {
    return { ok: false, reason: "unavailable", error: ARES_TEXT.unavailable };
  } else {
    const res = await aresFetch(`${base()}/ekonomicke-subjekty/${ico}`);
    if (!res || res.status >= 500 || res.status === 429) return { ok: false, reason: "unavailable", error: ARES_TEXT.unavailable };
    const company = res.status === 200 ? parseAresSubject(res.json) : null;
    if (res.status === 200 && !company) return { ok: false, reason: "unavailable", error: ARES_TEXT.unavailable };
    out = company ? { ok: true, company } : { ok: false, reason: "not_found", error: ARES_TEXT.not_found };
  }
  remember(key, out);
  return out;
}

/** Hledání podle obchodního jména (nejvýš `limit` výsledků). */
export async function aresSearchByName(name: string, limit = 10): Promise<AresSearch> {
  const q = String(name ?? "").replace(/\s+/g, " ").trim().slice(0, 200);
  if (q.length < 3) return { ok: true, total: 0, items: [] };
  const count = Math.min(Math.max(1, Math.round(limit)), 50);
  const key = `name:${q.toLowerCase()}:${count}`;
  const hit = cached<AresSearch>(key);
  if (hit) return hit;
  let out: AresSearch;
  if (fakeDir()) {
    const r = parseAresSearch(readFake("vyhledat.json") ?? {});
    out = { ok: true, total: r.total, items: r.items.slice(0, count) };
  } else if (offline()) {
    return { ok: false, reason: "unavailable", error: ARES_TEXT.unavailable };
  } else {
    const res = await aresFetch(`${base()}/ekonomicke-subjekty/vyhledat`, {
      method: "POST",
      body: JSON.stringify({ obchodniJmeno: q, start: 0, pocet: count }),
    });
    if (!res || res.status >= 500 || res.status === 429) return { ok: false, reason: "unavailable", error: ARES_TEXT.unavailable };
    // 400 = moc obecný dotaz / nic nenalezeno → prázdný výsledek
    const r = res.status === 200 ? parseAresSearch(res.json) : { total: 0, items: [] };
    out = { ok: true, total: r.total, items: r.items };
  }
  remember(key, out);
  return out;
}
