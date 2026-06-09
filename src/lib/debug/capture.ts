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
        add({
          level: "error",
          source: "window.error",
          message: ev.message || "Neodchycená chyba",
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
            request: { method, url, headers: headersToObject(init?.headers), body: bodyPreview(init?.body) },
            response: { status: res.status, statusText: res.statusText, ok: res.ok, headers: headersToObject(res.headers), redirected: res.redirected, type: res.type },
            durationMs: ms,
          }),
        });
        return res;
      } catch (err) {
        const ms = Math.round(performance.now() - started);
        add({
          level: "error",
          source: "fetch",
          message: `${method} ${shortUrl(url)} → SÍŤOVÁ CHYBA (${ms} ms): ${(err as Error)?.message}`,
          details: detailFromValue({ request: { method, url, headers: headersToObject(init?.headers), body: bodyPreview(init?.body) }, error: err, durationMs: ms }),
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
            details: detailFromValue({ method: meta.method, url: meta.url, status: this.status, statusText: this.statusText, durationMs: ms, body: bodyPreview(body) }),
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
function shortUrl(url: string): string {
  try {
    const u = new URL(url, window.location.href);
    return u.pathname + u.search;
  } catch {
    return url;
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

/** Skryje citlivé hodnoty (tokeny, hesla) v hlavičkách. */
function redact(key: string, value: string): string {
  if (/auth|cookie|token|secret|key|password/i.test(key)) {
    return value.length > 8 ? value.slice(0, 4) + "…" + value.slice(-2) : "***";
  }
  return value;
}

function bodyPreview(body: unknown): string | undefined {
  if (body == null) return undefined;
  if (typeof body === "string") return body.slice(0, 2000);
  if (typeof FormData !== "undefined" && body instanceof FormData) {
    const parts: string[] = [];
    body.forEach((v, k) => parts.push(`${k}=${v instanceof File ? `[File ${v.name} ${v.size}B]` : String(v).slice(0, 200)}`));
    return `FormData{ ${parts.join(", ")} }`;
  }
  if (typeof Blob !== "undefined" && body instanceof Blob) return `[Blob ${body.size}B ${body.type}]`;
  try {
    return JSON.stringify(body).slice(0, 2000);
  } catch {
    return String(body).slice(0, 2000);
  }
}
