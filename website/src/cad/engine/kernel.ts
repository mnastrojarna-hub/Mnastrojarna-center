/**
 * Port jádra pro engine (CAD-HEADLESS-NAVRH.md kap. 2.3).
 *
 * Typ je návratový typ `makeKernelClient(transport)` (`kernel-client.ts`, balík B1): stejný klient jádra slouží v prohlížeči
 * (Web Worker, `client.ts`) i ve vlákně běhu CLI (in-process, `kernel-inprocess.ts`). Operace a jejich výsledky jsou
 * typované z protokolu (`kernel-protocol.ts`: unie `KernelReq` + mapa `KernelResults`), takže nová operace jádra přibude
 * sama. Prohlížečový `client.ts` (Web Worker) engine nenačítá – hlídá ESLint pravidlo hranice v `.eslintrc.json`.
 */
import type { KernelClient } from "../kernel-client";

export type { KernelClient };

/**
 * operace jádra, které engine používá: celý klient bez odběru průběhu (to je věc UI / hlídače); `generation()` = pořadí
 * instance jádra – zvýší se při restartu (pád WASM, zrušení); mezipaměti sestavy `ws.asm` platí jen pro jednu generaci
 */
export type KernelApi = Omit<KernelClient, "onProgress" | "progress">;

/** názvy operací jádra (pro časy operací v protokolu a hlášky hlídače) */
export type KernelOp = Exclude<keyof KernelApi, "generation">;
