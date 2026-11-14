// Fake DedicatedWorkerGlobalScope so the UNCHANGED src/cad/cad.worker.ts loads in plain Node ("loopback worker").
// Must be imported before the worker module (loopback.ts does it first).
type Msg = { id: number; ok?: boolean; result?: unknown; error?: string; progress?: unknown; perf?: unknown; fatal?: boolean };
export const listeners = new Set<(m: Msg) => void>();
const g = globalThis as unknown as { self?: { postMessage: (m: Msg) => void; onmessage?: (e: { data: unknown }) => unknown } };
g.self = { postMessage: (m: Msg) => listeners.forEach((l) => l(m)) };
