/**
 * Bezpečný zápis adresy stránky (filtry, hledání, otevřené vlákno) v Next.js App Routeru.
 *
 * Proč ne prosté `history.replaceState({}, "", url)` (doporučený postup Next): Next ho převezme jako
 * „obnovení z historie" (ACTION_RESTORE) a ve své frontě akcí dá navigaci přednost — právě BĚŽÍCÍ
 * serverovou akci zahodí (její výsledek se nikdy nevrátí) a akce zařazená hned za ní se už nespustí.
 * V Poště to znamenalo: ťuknutí na e-mail ve chvíli, kdy dobíhá načtení fronty K odeslání → vlákno
 * zůstalo navždy na „Načítám vlákno…" (E2E 40, 4. 11.). Totéž hrozilo při psaní do hledání během
 * načítání seznamu.
 *
 * Řešení:
 *  1. adresa se zapíše HNED, ale se stavem, který už má příznak Next (`__NA` + strom) — Next ho
 *     nechá projít beze změny fronty (žádné RESTORE, nic se nezahodí);
 *  2. až je klid (žádná serverová akce neběží — sledujeme požadavky s hlavičkou `Next-Action`),
 *     se Next dodatečně sesynchronizuje prázdným `replaceState({}, "", táž adresa)` → RESTORE bez
 *     oběti: Next pak zná adresu (useSearchParams, canonicalUrl pro refresh / další akce);
 *  3. kdyby Next mezitím adresu přepsal svou starou (po dokončení akce ji přepisuje na canonicalUrl),
 *     synchronizace ji nejdřív vrátí — pokud mezitím nepřišel popstate (uživatel dal Zpět).
 */

const SYNC_DELAY_MS = 250;
const SYNC_RETRY_MS = 100;
/** Po skončení akce ještě chvíli počkat (Next ji doručuje do stromu až po odpovědi). */
const QUIET_AFTER_ACTION_MS = 150;

let installed = false;
let inflight = 0;
let lastActionEnd = -Infinity;
let popstateSerial = 0;
let syncTimer: number | null = null;
/** Poslední zamýšlená adresa (cesta + dotaz + hash) a číslo popstate v okamžiku zápisu. */
let intended: { href: string; pop: number } | null = null;

type AnyHeaders = Headers | Record<string, string> | [string, string][] | undefined | null;

/** Má požadavek hlavičku Next-Action (= volání serverové akce)? */
export function hasServerActionHeader(headers: AnyHeaders): boolean {
  if (!headers) return false;
  if (typeof Headers !== "undefined" && headers instanceof Headers) return headers.has("next-action");
  if (Array.isArray(headers)) return headers.some(([k]) => k.toLowerCase() === "next-action");
  return Object.keys(headers).some((k) => k.toLowerCase() === "next-action");
}

/** Je bezpečné teď poslat Next RESTORE? (žádná akce neběží a poslední skončila před chvílí) */
export function isQuiet(state: { inflight: number; lastActionEnd: number }, now: number, quietMs = QUIET_AFTER_ACTION_MS): boolean {
  return state.inflight <= 0 && now - state.lastActionEnd >= quietMs;
}

/** Stav historie pro vlastní zápis: kopie současného (včetně `__NA` a stromu Next), jinak prázdný. */
export function stateForOwnWrite(current: unknown): Record<string, unknown> {
  return current && typeof current === "object" ? { ...(current as Record<string, unknown>) } : {};
}

function install(): void {
  if (installed || typeof window === "undefined") return;
  installed = true;
  const original = window.fetch.bind(window);
  window.fetch = ((input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const headers = init?.headers ?? (input instanceof Request ? input.headers : undefined);
    if (!hasServerActionHeader(headers as AnyHeaders)) return original(input, init);
    inflight++;
    const done = () => {
      inflight = Math.max(0, inflight - 1);
      lastActionEnd = performance.now();
    };
    return original(input, init).then((r) => { done(); return r; }, (e: unknown) => { done(); throw e; });
  }) as typeof window.fetch;
  window.addEventListener("popstate", () => {
    popstateSerial++;
    // Zpět / Vpřed: Next si stav obnoví sám — rozpracovanou synchronizaci zahodit
    intended = null;
    if (syncTimer !== null) { window.clearTimeout(syncTimer); syncTimer = null; }
  });
}

function pathOf(href: string): string {
  return href.split(/[?#]/)[0];
}

function currentHref(): string {
  return `${window.location.pathname}${window.location.search}${window.location.hash}`;
}

function sync(): void {
  syncTimer = null;
  if (!intended) return;
  if (!isQuiet({ inflight, lastActionEnd }, performance.now())) {
    syncTimer = window.setTimeout(sync, SYNC_RETRY_MS);
    return;
  }
  const want = intended;
  intended = null;
  if (want.pop !== popstateSerial) return; // mezitím Zpět / Vpřed
  if (pathOf(want.href) !== window.location.pathname) return; // mezitím odchod na jinou stránku
  try {
    // Next mohl adresu vrátit na svou starou (po dokončení akce) → nejdřív zpět na zamýšlenou
    if (currentHref() !== want.href) window.history.replaceState(stateForOwnWrite(window.history.state), "", want.href);
    // prázdný stav = Next adresu převezme (RESTORE) — teď bez běžící akce, kterou by zahodil
    window.history.replaceState({}, "", want.href);
  } catch {
    // adresa je jen pohodlí
  }
}

/**
 * Zapíše adresu stránky bez zásahu do fronty akcí Next (viz hlavička souboru).
 * `push` = nová položka historie (Zpět ji vrátí).
 */
export function writeUrlSafely(href: string, opts: { push?: boolean } = {}): void {
  if (typeof window === "undefined") return;
  install();
  const state = stateForOwnWrite(window.history.state);
  if (opts.push) window.history.pushState(state, "", href);
  else window.history.replaceState(state, "", href);
  intended = { href, pop: popstateSerial };
  if (syncTimer !== null) window.clearTimeout(syncTimer);
  syncTimer = window.setTimeout(sync, SYNC_DELAY_MS);
  // adresa se změnila bez Next (useSearchParams se dozví až při synchronizaci) → kdo sleduje adresu
  // (ScrollMemory: nová adresa přebírá aktuální posun), ať se dozví hned
  window.dispatchEvent(new Event(URL_WRITE_EVENT));
}

/** Událost na window po vlastním zápisu adresy (writeUrlSafely). */
export const URL_WRITE_EVENT = "mn:urlwrite";

/** Jen pro testy / diagnostiku. */
export function _serverActionActivity(): { inflight: number; lastActionEnd: number } {
  return { inflight, lastActionEnd };
}
