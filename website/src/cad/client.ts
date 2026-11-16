"use client";
/**
 * Klient CAD jádra v prohlížeči: `makeKernelClient` (kernel-client.ts) nad transportem Web Worker – každá instance jádra je
 * nový `cad.worker.ts` (po pádu WASM nebo zrušení výpočtu se spouští nový). Engine a CLI tento modul nenačítají
 * (jen `import type`, CAD-HEADLESS-NAVRH.md kap. 2.2); ve vlákně běhu CLI je jádro in-process (kernel-inprocess.ts).
 */
import { makeKernelClient, type KernelTransport } from "./kernel-client";

export { CadCancelled, isCancelled, type CadProgress, type TopologyResult } from "./kernel-client";

/** transport Web Worker: zprávy jádra přes `postMessage`, data importů jen poprvé na instanci, zrušení = ukončit worker */
const webWorker: KernelTransport = {
  cancellable: true,
  spawn(on) {
    const worker = new Worker(new URL("./cad.worker.ts", import.meta.url), { type: "module" });
    worker.onmessage = (e) => on.message(e.data);
    worker.onerror = (e) => on.error(e.message);
    return { post: (m) => worker.postMessage(m), terminate: () => worker.terminate() };
  },
};

export const cad = makeKernelClient(webWorker);
