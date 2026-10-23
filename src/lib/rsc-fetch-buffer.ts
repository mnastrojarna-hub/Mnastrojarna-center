/**
 * Odpovědi React Server Components (navigace, router.refresh, server akce) se v prohlížeči
 * předají routeru až celé, ne po kouscích.
 *
 * Proč: Next 15.5 (React 19.2 canary) při streamované odpovědi s více kusy občas ztratí
 * „probuzení" pozastaveného přechodu — data dorazí celá, ale stránka zůstane u starého stavu
 * (filtr Knihy, chip stavu, výsledek akce se nevykreslí). Odpověď doručená najednou se
 * vykreslí vždy (ověřeno: 0/30 uvíznutí proti ~70 % bez bufferu). Naše stránky jsou
 * dynamické a streamované hranice Suspense skoro nepoužíváme, takže nic neztrácíme.
 *
 * Týká se jen odpovědí s `content-type: text/x-component`; ostatní fetch (API, Supabase,
 * nahrávání souborů) jde beze změny.
 */

export const RSC_CONTENT_TYPE = "text/x-component";

const MARK = "__mnRscBuffered";

type FetchFn = typeof fetch;
type FetchHost = { fetch: FetchFn } & Record<string, unknown>;

/** Je to odpověď RSC (navigace, refresh, server akce)? */
export function isRscResponse(res: Pick<Response, "headers">): boolean {
  return (res.headers.get("content-type") ?? "").toLowerCase().startsWith(RSC_CONTENT_TYPE);
}

/** Stavy, u kterých odpověď nesmí mít tělo. */
const NULL_BODY = new Set([101, 103, 204, 205, 304]);

/** Celá odpověď najednou; url a redirected zůstanou (router podle nich řeší přesměrování). */
export async function bufferResponse(res: Response): Promise<Response> {
  // neprůhledná / zvláštní odpověď (stav mimo 200–599) se nedá znovu sestavit — beze změny
  if (res.status < 200 || res.status > 599) return res;
  const body = NULL_BODY.has(res.status) ? null : await res.arrayBuffer();
  const out = new Response(body, { status: res.status, statusText: res.statusText, headers: res.headers });
  Object.defineProperty(out, "url", { value: res.url, configurable: true });
  Object.defineProperty(out, "redirected", { value: res.redirected, configurable: true });
  return out;
}

/** fetch, který odpovědi RSC předá až celé. */
export function bufferedRscFetch(original: FetchFn): FetchFn {
  const wrapped = async (...args: Parameters<FetchFn>): Promise<Response> => {
    const res = await original(...args);
    if (!res.body || !isRscResponse(res)) return res;
    return bufferResponse(res);
  };
  return wrapped as FetchFn;
}

/** Nainstaluje buffer do globálního fetch (jednou; na serveru nic). */
export function installRscFetchBuffer(host: FetchHost | undefined = typeof window === "undefined" ? undefined : (window as unknown as FetchHost)): boolean {
  if (!host || typeof host.fetch !== "function" || host[MARK]) return false;
  const original = host.fetch.bind(host) as FetchFn;
  host.fetch = bufferedRscFetch(original);
  host[MARK] = true;
  return true;
}
