/**
 * Node shim vlákna běhu (CAD-HEADLESS-NAVRH.md kap. 2.3 „Node shim“, 2.2, 3.4) – fáze A, bez úpravy horkých souborů.
 *
 * 1. `globalThis.location = { origin, pathname: "/cad", href, protocol, host }` (origin = základ sdílení, výchozí
 *    https://www.mnastrojarna.cz) – `share.ts` z něj odvodí úložiště krátkých odkazů jako v prohlížeči. S `--share-store
 *    <URL>` (bez `MNCAD_ORIGIN`) je stránkou odkazu web úložiště: `https://h/cad/share/` → `https://h/cad#q=…`, protože
 *    prohlížeč hledá obsah odkazu `#q=` v `<origin stránky>/cad/share/` (`selfStoreBase`).
 * 2. obal `fetch`: `/fonts/*` a `<origin>/fonts/*` čte ze složky písem vedle svazku (`pdf.ts`, `build.ts`,
 *    `feat/refs-more.ts`, `ext/advanced.ts`); vše ostatní jde na síť s hlavičkou `User-Agent: mncad/<verze>`.
 * 3. smyčka (loopback) jádra: falešný `self` pro NEZMĚNĚNÝ `cad.worker.ts` ve stejném vlákně a klient `KernelApi` se
 *    stejným protokolem zpráv jako `client.ts` (B1 ho nahradí `makeKernelClient(inProcessTransport)`).
 *
 * Nic dalšího se nepředstírá: `Worker`, `document` a `window` zůstávají nedefinované – co je potřebuje, skončí řádnou
 * chybou (smoke test příkladů v `mncad selftest`). Shim se instaluje jen ve vlákně běhu, nikdy v hlavním vlákně.
 */
import fs from "node:fs";
import path from "node:path";
import * as r from "replicad";
import { tr } from "../i18n";
import type { KernelApi, KernelClient } from "../engine/kernel";

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

/* ───────────────────────── smyčka jádra (loopback) ───────────────────────── */

type WorkerMsg = { id?: number; ok?: boolean; result?: unknown; error?: string; progress?: unknown; perf?: unknown; fatal?: boolean; at?: number };
type FakeSelf = { postMessage(m: WorkerMsg, transfer?: Transferable[]): void; onmessage: ((e: { data: unknown }) => unknown) | null };

/** port smyčky: zprávy z `cad.worker.ts` (falešný `self.postMessage`) a doručení požadavku do `self.onmessage` */
export type LoopbackPort = {
  listeners: Set<(m: WorkerMsg) => void>;
  deliver(msg: Record<string, unknown>): void;
};

/**
 * Falešný `self` (DedicatedWorkerGlobalScope) pro nezměněný `cad.worker.ts` – musí být nainstalovaný PŘED importem
 * workeru (ten při načtení nastaví `self.onmessage`). Zprávy obou směrů se kopírují `structuredClone` (s přenosem
 * bufferů) jako u skutečného `postMessage`, takže jádro a engine nesdílí objekty.
 */
export function installLoopbackSelf(): LoopbackPort {
  const listeners = new Set<(m: WorkerMsg) => void>();
  const self: FakeSelf = {
    postMessage(m, transfer) {
      const copy = structuredClone(m, transfer?.length ? { transfer: transfer as Transferable[] } : undefined) as WorkerMsg;
      for (const l of listeners) l(copy);
    },
    onmessage: null,
  };
  (globalThis as unknown as { self: FakeSelf }).self = self;
  return {
    listeners,
    deliver(msg) {
      if (!self.onmessage) throw new Error(tr("jádro CAD není načtené (cad.worker)"));
      void self.onmessage({ data: structuredClone(msg) });
    },
  };
}

export type ProgressInfo = { op: string; phase?: string; index?: number; total?: number; name?: string };
export type LoopbackKernel = KernelApi & {
  /** odběr průběhu stavby (prvek k z n) */
  onKernelProgress(fn: (p: ProgressInfo) => void): () => void;
  /** odběr pádu jádra (WASM) – ve fázi A se jádro ve vlákně znovu spustit nedá, vlákno se ukončí (kód 4) */
  onFatal(fn: (reason: string) => void): () => void;
  /** názvy operací, které smyčka implementuje (test pokrytí proti `client.ts`) */
  readonly implemented: readonly string[];
};

type Impl = { [K in keyof KernelApi]?: KernelApi[K] };

/**
 * Klient jádra nad smyčkou: stejné zprávy `{ id, op, … }` jako `client.ts`, typově podle `KernelApi` (každá metoda
 * má podpis klienta). Data importů (`mnblob:`) se neposílají – jádro i engine sdílí ve vlákně jedno úložiště blobů.
 * Operace, kterou klient po sloučení vln 11–13 získá a smyčka ještě ne, vrátí srozumitelnou chybu (test `node-shims.test.ts`
 * na pokrytí hlídá rozdíl proti `client.ts`).
 */
export function makeLoopbackKernel(port: LoopbackPort): LoopbackKernel {
  let seq = 0;
  let fatal: string | null = null;
  const pending = new Map<number, { resolve: (v: unknown) => void; reject: (e: Error) => void; op: string }>();
  const progressL = new Set<(p: ProgressInfo) => void>();
  const fatalL = new Set<(reason: string) => void>();
  port.listeners.add((m) => {
    if (m.perf) return;
    if (m.fatal) {
      fatal ??= m.error || "fatal";
      const waiting = [...pending.values()];
      pending.clear();
      for (const p of waiting) p.reject(new Error(fatal));
      for (const l of fatalL) l(fatal);
      return;
    }
    const p = m.id !== undefined ? pending.get(m.id) : undefined;
    if (!p) return;
    if (m.progress) {
      const pr = m.progress as Omit<ProgressInfo, "op">;
      for (const l of progressL) l({ ...pr, op: p.op });
      return;
    }
    pending.delete(m.id!);
    if (m.ok) p.resolve(m.result);
    else p.reject(new Error(m.error || tr("Chyba CAD jádra.")));
  });
  function call<T>(msg: Record<string, unknown>): Promise<T> {
    if (fatal) return Promise.reject(new Error(fatal));
    const id = ++seq;
    return new Promise<T>((resolve, reject) => {
      pending.set(id, { resolve: resolve as (v: unknown) => void, reject, op: String(msg.op) });
      try {
        port.deliver({ id, ...msg });
      } catch (e) {
        pending.delete(id);
        reject(e as Error);
      }
    });
  }
  type C = KernelClient;
  const impl = {
    init: () => call<void>({ op: "init" }),
    // jádro ve vlákně počítá synchronně – zrušit ho umí jen hlídač (terminate vlákna), ne klient
    cancel: () => false,
    busy: () => pending.size > 0,
    setLang: (lang) => call<void>({ op: "lang", lang }),
    build: (doc) => call({ op: "build", doc }),
    topology: (doc) => call({ op: "topology", doc }),
    face: (index) => call({ op: "face", index }),
    refInfo: (doc, ref) => call({ op: "refInfo", doc, ref }),
    pickSigs: (doc, feature) => call({ op: "pickSigs", doc, feature }),
    planeDef: (doc, def) => call({ op: "planeDef", doc, def }),
    datumGfx: (doc) => call({ op: "datumGfx", doc }),
    exportFile: (doc, format) => call({ op: "export", doc, format }),
    exportStats: (doc, bytes, format) => call({ op: "exportStats", doc, bytes, format }),
    faceOwner: (doc, index, point) => call({ op: "faceOwner", doc, index, point }),
    asmParts: (parts, offset = 0, total = parts.length) => call({ op: "asmParts", parts, offset, total }),
    stepSplit: ((bytes: Uint8Array, fileName: string) => call({ op: "stepSplit", bytes, fileName })) as C["stepSplit"],
    // restart jádra ve vlákně neexistuje (pád = konec vlákna, kód 4) – odběr se přijme a nikdy nezavolá
    onRestart: () => () => undefined,
    asmFace: (key, index) => call({ op: "asmFace", key, index }),
    interference: (doc) => call({ op: "interference", doc }),
    compare: (doc, file, opts) => call({ op: "compare", doc, file, opts }),
    mateFace: (key, index) => call({ op: "mateFace", key, index }),
    mateEnt: (key, index, ent) => call({ op: "mateEnt", key, index, ent }),
    cylFace: (key, radius) => call({ op: "cylFace", key, radius }),
    inspect: (src, ref, density) => call({ op: "inspect", src, ref, density }),
    measureEnt: (a, b) => call({ op: "measureEnt", a, b }),
    measure: (q, o = {}) => call({ op: "measure", q, ...o }),
    drawing: (doc, meta, opts) => call({ op: "drawing", doc, meta, opts }),
    surfA: (q, doc) => call({ op: "surfA", q, doc }),
    generation: () => 1,
  } satisfies Impl;
  const extra = {
    onKernelProgress(fn: (p: ProgressInfo) => void) {
      progressL.add(fn);
      return () => void progressL.delete(fn);
    },
    onFatal(fn: (reason: string) => void) {
      fatalL.add(fn);
      return () => void fatalL.delete(fn);
    },
    implemented: Object.keys(impl),
  };
  const target = { ...impl, ...extra } as Record<string | symbol, unknown>;
  return new Proxy(target, {
    get(t, p) {
      if (p in t) return t[p];
      if (typeof p !== "string" || p === "then") return undefined;
      return () => Promise.reject(new Error(tr("operace jádra „{0}“ ve vlákně běhu zatím chybí", p)));
    },
  }) as unknown as LoopbackKernel;
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
