/// <reference lib="webworker" />
/* CAD jádro ve web workeru: OpenCascade (WASM) + replicad. UI zůstává plynulé i při složitých operacích.
 * Obsluha požadavků je v kernel-ops.ts (stejná i ve vlákně běhu CLI); worker je jen transport zpráv. */
import { handleKernel } from "./kernel-ops";
import type { KernelEnvelope } from "./kernel-protocol";
import { setPerfSink } from "./perf-log";

const ctx = self as unknown as DedicatedWorkerGlobalScope;
setPerfSink((e) => ctx.postMessage({ perf: e }));
ctx.onmessage = (e: MessageEvent<KernelEnvelope>) => handleKernel(e.data, (m, t) => ctx.postMessage(m, t ?? []));
