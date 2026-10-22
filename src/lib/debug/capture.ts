/**
 * Instalace globálního zachytávání pro debug lištu (pouze klient).
 *
 * Zachytáváme prakticky všechny scénáře, které mohou v prohlížeči nastat:
 *  - console.{log,info,warn,error,debug}
 *  - neodchycené chyby (window.onerror) + chyby načítání zdrojů
 *  - neodchycené promise rejecty (unhandledrejection)
 *  - všechny fetch() požadavky (metoda, URL, status, trvání, chyby)
 *  - XMLHttpRequest požadavky
 *  - navigaci (pushState/replaceState/popstate/hashchange)
 *  - online/offline, visibility a životní cyklus stránky
 *
 * Funkce je idempotentní — opakované volání nic neudělá.
 */

import { debugStore } from "./log-store";
import { detailFromArgs, summarizeArgs, detailFromValue } from "./serialize";

let installed = false;

export function installDebugCapture(): void {
  if (installed || typeof window === "undefined") return;
  installed = true;

  const add = debugStore.add.bind(debugStore);

  // ── console ───────────────────────────────────────────────
  const levels = ["log", "info", "warn", "error", "debug"] as const;
  for (const level of levels) {
    const original = console[level]?.bind(console) ?? console.log.bind(console);
    console[level] = (...args: unknown[]) => {
      try {
        const err = args.find((a) => a instanceof Error) as Error | undefined;
        add({
          level,
          source: "console",
          message: summarizeArgs(args) || `console.${level}`,
          details: detailFromArgs(args),
          stack: err?.stack,
        });
      } catch {
        /* nikdy nesmí shodit původní console */
      }
      original(...args);
    };
  }

  // ── neodchycené chyby + chyby zdrojů ──────────────────────
  window.addEventListener(
    "error",
    (e: ErrorEvent | Event) => {
      const ev = e as ErrorEvent;
      if (ev.error || ev.message) {
        // Skripty vložené prohlížečem / rozšířením (peněženky, překladače…) nejsou chyby aplikace
        const foreign = isForeignScriptError(ev);
        add({
          level: foreign ? "warn" : "error",
          source: foreign ? "mimo-aplikaci" : "window.error",
          message: foreign ? `Mimo aplikaci (rozšíření / vložený skript prohlížeče): ${ev.message || "chyba"}` : ev.message || "Neodchycená chyba",
          details: detailFromValue({
            message: ev.message,
            filename: ev.filename,
            line: ev.lineno,
            column: ev.colno,
            error: ev.error,
          }),
          stack: ev.error?.stack,
        });
      } else {
        // Chyba načítání zdroje (img/script/link/css…)
        const target = e.target as (HTMLElement & { src?: string; href?: string }) | null;
        if (target && target.tagName) {
          add({
            level: "error",
            source: "resource.error",
            message: `Selhalo načtení zdroje <${target.tagName.toLowerCase()}>`,
            details: detailFromValue({ tag: target.tagName, src: target.src, href: target.href }),
          });
        }
      }
    },
    true, // capture fáze — zachytí i resource errory
  );

  window.addEventListener("unhandledrejection", (e: PromiseRejectionEvent) => {
    const reason = e.reason;
    add({
      level: "error",
      source: "unhandledrejection",
      message: reason instanceof Error ? `${reason.name}: ${reason.message}` : `Neošetřený rejection: ${summarizeArgs([reason])}`,
      details: detailFromValue(reason),
      stack: reason instanceof Error ? reason.stack : undefined,
    });
  });

  // ── fetch ─────────────────────────────────────────────────
  if (typeof window.fetch === "function") {
    const originalFetch = window.fetch.bind(window);
    window.fetch = async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
      const started = performance.now();
      const method = (init?.method || (input instanceof Request ? input.method : "GET") || "GET").toUpperCase();
      const url = input instanceof Request ? input.url : String(input);
      try {
        const res = await originalFetch(input, init);
        const ms = Math.round(performance.now() - started);
        add({
          level: res.ok ? "network" : "error",
          source: "fetch",
          message: `${method} ${shortUrl(url)} → ${res.status} ${res.statusText} (${ms} ms)`,
          details: detailFromValue({
            request: requestPreview(method, url, init),
            response: { status: res.status, statusText: res.statusText, ok: res.ok, headers: headersToObject(res.headers), redirected: res.redirected, type: res.type },
            durationMs: ms,
          }),
        });
        return res;
      } catch (err) {
        const ms = Math.round(performance.now() - started);
        // zrušený požadavek (přechod na jinou stránku, zrušené předběžné načtení) není chyba
        const aborted = (err as Error)?.name === "AbortError";
        add({
          level: aborted ? "network" : "error",
          source: "fetch",
          message: aborted
            ? `${method} ${shortUrl(url)} → zrušeno (${ms} ms)`
            : `${method} ${shortUrl(url)} → SÍŤOVÁ CHYBA (${ms} ms): ${(err as Error)?.message}`,
          details: detailFromValue({ request: requestPreview(method, url, init), error: err, durationMs: ms }),
          stack: (err as Error)?.stack,
        });
        throw err;
      }
    };
  }

  // ── XMLHttpRequest ────────────────────────────────────────
  try {
    const XHR = XMLHttpRequest.prototype;
    const origOpen = XHR.open;
    const origSend = XHR.send;
    XHR.open = function (this: XMLHttpRequest & { __dbg?: { method: string; url: string; t: number } }, method: string, url: string | URL, ...rest: unknown[]) {
      this.__dbg = { method, url: String(url), t: 0 };
      // @ts-expect-error – předáváme zbytek argumentů beze změny
      return origOpen.call(this, method, url, ...rest);
    };
    XHR.send = function (this: XMLHttpRequest & { __dbg?: { method: string; url: string; t: number } }, body?: Document | XMLHttpRequestBodyInit | null) {
      const meta = this.__dbg;
      if (meta) {
        meta.t = performance.now();
        this.addEventListener("loadend", () => {
          const ms = Math.round(performance.now() - meta.t);
          const ok = this.status >= 200 && this.status < 400;
          add({
            level: ok ? "network" : "error",
            source: "xhr",
            message: `${meta.method} ${shortUrl(meta.url)} → ${this.status || "ERR"} (${ms} ms)`,
            details: detailFromValue({ method: meta.method, url: redactUrl(meta.url), status: this.status, statusText: this.statusText, durationMs: ms, body: bodyPreview(body, false) }),
          });
        });
      }
      return origSend.call(this, body ?? null);
    };
  } catch {
    /* XHR patch je best-effort */
  }

  // ── navigace ──────────────────────────────────────────────
  const logNav = (kind: string, to?: string) =>
    add({ level: "nav", source: "navigation", message: `${kind}${to ? " → " + to : ""}` });
  try {
    const history = window.history;
    const origPush = history.pushState;
    const origReplace = history.replaceState;
    history.pushState = function (data: unknown, unused: string, url?: string | URL | null) {
      logNav("pushState", url ? String(url) : undefined);
      return origPush.call(this, data, unused, url);
    };
    history.replaceState = function (data: unknown, unused: string, url?: string | URL | null) {
      logNav("replaceState", url ? String(url) : undefined);
      return origReplace.call(this, data, unused, url);
    };
    window.addEventListener("popstate", () => logNav("popstate", window.location.pathname));
    window.addEventListener("hashchange", () => logNav("hashchange", window.location.hash));
  } catch {
    /* ignore */
  }

  // ── stav sítě a životní cyklus ────────────────────────────
  window.addEventListener("online", () => add({ level: "event", source: "lifecycle", message: "Připojení obnoveno (online)" }));
  window.addEventListener("offline", () => add({ level: "warn", source: "lifecycle", message: "Připojení ztraceno (offline)" }));
  document.addEventListener("visibilitychange", () =>
    add({ level: "event", source: "lifecycle", message: `Viditelnost: ${document.visibilityState}` }),
  );

  add({ level: "info", source: "debug", message: "Debug lišta aktivní — zachytávám console, chyby, fetch, XHR i navigaci." });
}

// ── pomocné ─────────────────────────────────────────────────
/** „Script error." bez souboru = cizí (cross-origin) skript; window.ethereum apod. = rozšíření. */
export function isForeignScriptError(ev: { message?: string; filename?: string; error?: unknown }): boolean {
  const msg = ev.message ?? "";
  if (/^Script error\.?$/i.test(msg.trim()) && !ev.filename) return true;
  if (/window\.ethereum|ethereum\.|__firefox__|webkit\.messageHandlers|__gCrWeb|solana|tronWeb/i.test(msg)) return true;
  return /^(chrome|moz|safari(-web)?)-extension:/i.test(ev.filename ?? "");
}

function shortUrl(url: string): string {
  try {
    const u = new URL(url, window.location.href);
    return redactUrl(u.pathname + u.search);
  } catch {
    return redactUrl(url);
  }
}

function headersToObject(headers?: HeadersInit | Headers): Record<string, string> | undefined {
  if (!headers) return undefined;
  const out: Record<string, string> = {};
  try {
    if (headers instanceof Headers) headers.forEach((v, k) => (out[k] = redact(k, v)));
    else if (Array.isArray(headers)) headers.forEach(([k, v]) => (out[k] = redact(k, v)));
    else Object.entries(headers).forEach(([k, v]) => (out[k] = redact(k, String(v))));
  } catch {
    return undefined;
  }
  return out;
}

/** Klíče, jejichž hodnoty se do logu nikdy nedostanou (hesla, kódy, tokeny…). */
const SENSITIVE_KEY = /pass|heslo|token|secret|key|code|k[oó]d|otp|pin|auth|cookie|session|signature|iban|card/i;
const HIDDEN = "[skryto]";

/** Skryje citlivé hodnoty (tokeny, hesla) v hlavičkách. */
function redact(key: string, value: string): string {
  if (/auth|cookie|token|secret|key|password/i.test(key)) {
    return value.length > 8 ? value.slice(0, 4) + "…" + value.slice(-2) : "***";
  }
  return value;
}

/** Parametry URL s tokeny (podepsané odkazy úložiště, kódy) → skryté. */
export function redactUrl(url: string): string {
  return url.replace(/([?&][^=&#]*(?:token|code|key|sig|secret|pass)[^=&#]*=)[^&#]*/gi, `$1${HIDDEN}`);
}

function redactDeep(value: unknown, depth = 0): unknown {
  if (depth > 6 || value == null || typeof value !== "object") return value;
  if (Array.isArray(value)) return value.map((v) => redactDeep(v, depth + 1));
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
    out[k] = SENSITIVE_KEY.test(k) ? HIDDEN : redactDeep(v, depth + 1);
  }
  return out;
}

function requestPreview(method: string, url: string, init?: RequestInit) {
  const headers = headersToObject(init?.headers);
  // Server action nese argumenty po pozicích (např. nové heslo) — obsah se nikdy neloguje.
  const isAction = Boolean(headers && Object.keys(headers).some((k) => k.toLowerCase() === "next-action"));
  return { method, url: redactUrl(url), headers, body: bodyPreview(init?.body, isAction) };
}

/** Náhled těla požadavku bez citlivých údajů. */
export function bodyPreview(body: unknown, isAction: boolean): string | undefined {
  if (body == null) return undefined;
  if (typeof FormData !== "undefined" && body instanceof FormData) {
    const parts: string[] = [];
    body.forEach((v, k) => {
      const shown = v instanceof File ? `[File ${v.name} ${v.size}B]` : SENSITIVE_KEY.test(k) ? HIDDEN : String(v).slice(0, 200);
      parts.push(`${k}=${shown}`);
    });
    return `FormData{ ${parts.join(", ")} }`;
  }
  if (typeof Blob !== "undefined" && body instanceof Blob) return `[Blob ${body.size}B ${body.type}]`;
  if (typeof body === "string") {
    if (isAction) return `[server action — ${body.length} znaků, obsah skrytý]`;
    try {
      return JSON.stringify(redactDeep(JSON.parse(body))).slice(0, 2000);
    } catch {
      return body.replace(/((?:^|&)[^=&]*(?:pass|heslo|token|secret|code|key)[^=&]*=)[^&]*/gi, `$1${HIDDEN}`).slice(0, 2000);
    }
  }
  if (isAction) return "[server action — obsah skrytý]";
  try {
    return JSON.stringify(redactDeep(body)).slice(0, 2000);
  } catch {
    return String(body).slice(0, 2000);
  }
}
