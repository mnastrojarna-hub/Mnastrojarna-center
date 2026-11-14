/**
 * Port jádra pro engine (CAD-HEADLESS-NAVRH.md kap. 2.3).
 *
 * Fáze A: typ je ODVOZENÝ z objektu `cad` klienta jádra (`client.ts`) – žádný ruční výčet operací, takže operace, které
 * přidají vlny 11–13 (`exportStats`, `faceOwner`), přibudou samy sloučením. `client.ts` se sem smí importovat jen jako typ
 * (`import type`, hlídá ESLint pravidlo hranice v `.eslintrc.json`) – engine tak nikdy nespustí prohlížečový Web Worker.
 * Po balíku B1 se typ přesměruje na návratový typ `makeKernelClient(transport)` (unie `Req` + mapa výsledků).
 */
import type { cad } from "../client";

/** objekt klienta jádra v prohlížeči (Web Worker) */
export type KernelClient = typeof cad;

/** operace jádra, které engine používá: celý klient bez odběru průběhu (to je věc UI / hlídače) a s generací instance */
export type KernelApi = Omit<KernelClient, "onProgress" | "progress"> & {
  /** pořadí instance jádra – zvýší se při restartu (pád WASM); mezipaměti sestavy `ws.asm` platí jen pro jednu generaci */
  generation(): number;
};

/** názvy operací jádra (pro časy operací v protokolu a hlášky hlídače) */
export type KernelOp = Exclude<keyof KernelApi, "generation">;
