/**
 * Node shim vlákna běhu (CAD-HEADLESS-NAVRH.md kap. 2.3 „Node shim“, 2.2, 3.4) – fáze A, bez úpravy horkých souborů.
 *
 * 1. `globalThis.location = { origin, pathname: "/cad", href, protocol, host }` (origin = základ sdílení, výchozí
 *    https://www.mnastrojarna.cz) – `share.ts` z něj odvodí úložiště krátkých odkazů jako v prohlížeči. S `--share-store
 *    <URL>` (bez `MNCAD_ORIGIN`) je stránkou odkazu web úložiště: `https://h/cad/share/` → `https://h/cad#q=…`, protože
 *    prohlížeč hledá obsah odkazu `#q=` v `<origin stránky>/cad/share/` (`selfStoreBase`).
 * 2. obal `fetch`: `/fonts/*` a `<origin>/fonts/*` čte ze složky písem vedle svazku (`pdf.ts`, `build.ts`,
 *    `feat/refs-more.ts`, `ext/advanced.ts`); vše ostatní jde na síť s hlavičkou `User-Agent: mncad/<verze>`.
 * 3. paměť vlákna: velikost haldy WASM (háček `WebAssembly.Memory.prototype.grow` → sdílená paměť hlídače) a vzorek paměti.
 *
 * Jádro samo je od balíku B1 in-process klient `makeKernelClient(inProcessTransport())` (kernel-client.ts,
 * kernel-inprocess.ts) – žádný falešný `self` ani worker.
 *
 * Nic dalšího se nepředstírá: `Worker`, `document` a `window` zůstávají nedefinované – co je potřebuje, skončí řádnou
 * chybou (smoke test příkladů v `mncad selftest`). Shim se instaluje jen ve vlákně běhu, nikdy v hlavním vlákně.
 */
import fs from "node:fs";
import path from "node:path";
import * as r from "replicad";
import { tr } from "../i18n";

export const DEFAULT_ORIGIN = "https://www.mnastrojarna.cz";

type Loc = { origin: string; pathname: string; href: string; protocol: string; host: string; hostname: string; port: string; search: string; hash: string };

/** `location` pro `origin` (jen http/https; cesta /cad jako stránka CADu) */
export function makeLocation(origin: string, pathname = "/cad"): Loc {
  const u = new URL(origin);
  if (u.protocol !== "http:" && u.protocol !== "https:") throw new Error(tr("základ sdílení musí být http(s):// – „{0}“", origin));
  return { origin: u.origin, pathname, href: `${u.origin}${pathname}`, protocol: u.protocol, host: u.host, hostname: u.hostname, port: u.port, search: "", hash: "" };
}

/**
 * Stránka CADu, ke které patří úložiště `--share-store <URL>`: `<web>/cad/share/` → `<web>/cad` (prohlížeč čte obsah
 * odkazu `#q=` z `<origin>/cad/share/`). Úložiště v jiné cestě → `<origin>/cad`. `off` / ne-URL → null.
 */
export function sharePageFor(store: string | undefined): { origin: string; pathname: string } | null {
  if (!store || !/^https?:\/\//i.test(store)) return null;
  try {
    const u = new URL(store);
    const m = /^(.*\/cad)\/share\/?$/i.exec(u.pathname);
    return { origin: u.origin, pathname: m ? m[1] : "/cad" };
  } catch {
    return null;
  }
}

/** název písma z adresy `/fonts/<název>` nebo `<origin>/fonts/<název>` (jen `[\w.-]`), jinak null */
export function fontNameOf(url: string, origin: string): string | null {
  let p: string;
  if (url.startsWith("/fonts/")) p = url;
  else if (url.startsWith(`${origin}/fonts/`)) p = url.slice(origin.length);
  else return null;
  const name = decodeURIComponent(p.slice("/fonts/".length).split(/[?#]/)[0]);
  return /^[\w.-]+$/.test(name) && !name.startsWith(".") ? name : null;
}

export type ShimOptions = {
  /** základ sdílení (location.origin) */
  origin?: string;
  /** složka s Roboto-Regular.ttf a Roboto-Bold.ttf */
  fontsDir: string | null;
  /** verze CLI do User-Agent */
  version: string;
  /** `--share-store`: adresa vlastního úložiště krátkých odkazů (NEXT_PUBLIC_CAD_SHARE_SELF, čte se za běhu) nebo off */
  shareStore?: string;
};

export type InstalledShims = { origin: string; fontsDir: string | null; fontsRead: string[]; restore(): void };

/** Nainstaluje `location` a obal `fetch` do tohoto vlákna. Vrací `restore` (testy). */
export function installNodeShims(o: ShimOptions): InstalledShims {
  const g = globalThis as unknown as { location?: unknown; fetch: typeof fetch };
  const page = o.origin ? null : sharePageFor(o.shareStore);
  const loc = page ? makeLocation(page.origin, page.pathname) : makeLocation(o.origin ?? DEFAULT_ORIGIN);
  const prevLoc = Object.getOwnPropertyDescriptor(globalThis, "location");
  const prevFetch = g.fetch;
  const prevStore = process.env.NEXT_PUBLIC_CAD_SHARE_SELF;
  const fontsRead: string[] = [];
  Object.defineProperty(globalThis, "location", { value: Object.freeze(loc), configurable: true, writable: false, enumerable: true });
  if (o.shareStore !== undefined) process.env.NEXT_PUBLIC_CAD_SHARE_SELF = o.shareStore;
  const ua = `mncad/${o.version}`;
  const wrapped = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
    const font = fontNameOf(url, loc.origin);
    if (font !== null) {
      const file = o.fontsDir ? path.join(o.fontsDir, font) : null;
      if (!file || !fs.existsSync(file)) return new Response(tr("písmo „{0}“ není ve složce písem", font), { status: 404, headers: { "content-type": "text/plain; charset=utf-8" } });
      fontsRead.push(font);
      return new Response(new Uint8Array(fs.readFileSync(file)), { status: 200, headers: { "content-type": "font/ttf" } });
    }
    const headers = new Headers(init?.headers ?? (input instanceof Request ? input.headers : undefined));
    if (!headers.has("user-agent")) headers.set("user-agent", ua);
    return prevFetch(input, { ...init, headers });
  }) as typeof fetch;
  g.fetch = wrapped;
  return {
    origin: loc.origin,
    fontsDir: o.fontsDir,
    fontsRead,
    restore() {
      g.fetch = prevFetch;
      if (prevLoc) Object.defineProperty(globalThis, "location", prevLoc);
      else delete (globalThis as { location?: unknown }).location;
      if (prevStore === undefined) delete process.env.NEXT_PUBLIC_CAD_SHARE_SELF;
      else process.env.NEXT_PUBLIC_CAD_SHARE_SELF = prevStore;
    },
  };
}

/**
 * Velikost haldy WASM (MB) – paměť, kterou V8 `resourceLimits` nevidí. replicad-opencascadejs 1.x nevystavuje
 * `HEAPU8` na objektu modulu, jen `wasmMemory` (měřeno balíkem A4) – bere se, co je k dispozici.
 */
export function wasmHeapMB(): number {
  try {
    const oc = r.getOC() as unknown as { HEAPU8?: Uint8Array; wasmMemory?: { buffer: ArrayBuffer } } | undefined;
    const bytes = oc?.HEAPU8?.length ?? oc?.wasmMemory?.buffer.byteLength ?? 0;
    return bytes / 1048576;
  } catch {
    return 0;
  }
}

/**
 * Háček zvětšení haldy WASM: emscripten zvětšuje paměť z JS (`wasmMemory.grow`) i uprostřed jednoho dlouhého volání
 * OCCT, kdy vlákno běhu nemůže poslat zprávu. Háček zapíše novou velikost (MB) do sdílené paměti `sab[0]`; hlídač
 * v hlavním vlákně ji čte každých 200 ms a při překročení `--max-mem` vlákno ukončí (`run.memory`) – i v `mncad serve`,
 * kde RSS procesu sdílí víc vláken. Musí se nainstalovat před načtením jádra.
 */
export function installWasmGrowHook(sab: SharedArrayBuffer | undefined): void {
  if (!sab) return;
  const view = new Int32Array(sab);
  const proto = WebAssembly.Memory.prototype as WebAssembly.Memory & { __mncadGrow?: boolean };
  if (proto.__mncadGrow) return;
  const orig = proto.grow;
  Object.defineProperty(proto, "__mncadGrow", { value: true });
  proto.grow = function (this: WebAssembly.Memory, delta: number) {
    const r = orig.call(this, delta);
    try {
      storeMax(view, Math.ceil(this.buffer.byteLength / 1048576));
    } catch {
      /* sdílená paměť nedostupná */
    }
    return r;
  };
}

/** zapisuje jen vlákno běhu (jediný zapisovatel) – halda WASM se nikdy nezmenšuje, drží se maximum */
function storeMax(view: Int32Array, mb: number) {
  if (mb > Atomics.load(view, 0)) Atomics.store(view, 0, mb);
}

/** zapíše známou velikost haldy WASM (MB) do sdílené paměti hlídače */
export function publishWasmHeap(sab: SharedArrayBuffer | undefined, mb: number): void {
  if (sab && Number.isFinite(mb)) storeMax(new Int32Array(sab), Math.ceil(mb));
}

/** paměť vlákna: halda WASM, halda JS tohoto vlákna a RSS procesu (MB) */
export function memorySample(): { heapMB: number; jsMB: number; rssMB: number } {
  const m = process.memoryUsage();
  return { heapMB: Math.round(wasmHeapMB()), jsMB: Math.round(m.heapTotal / 1048576), rssMB: Math.round(m.rss / 1048576) };
}
