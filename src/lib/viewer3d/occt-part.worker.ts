/**
 * Worker jednoho dílu velké STEP sestavy: přečte malý STEP (vyrobený step-split.ts) přes
 * OpenCascade a spočítá topologii sítě. Několik těchto workerů běží souběžně (víc jader CPU).
 */
import { occtToModel } from "./occt";
import { computeTopology, type PartTopology } from "./topology";
import { loadOcct, occtAbort, readWithOcct } from "./occt-runtime";
import type { PartRequest, PartResponse } from "./worker-protocol";

interface WorkerScope {
  postMessage(message: unknown, transfer?: Transferable[]): void;
  onmessage: ((ev: MessageEvent<PartRequest>) => void) | null;
  close(): void;
}
declare const self: WorkerScope;

function post(msg: PartResponse, transfer: Transferable[] = []) {
  self.postMessage(msg, transfer);
}

self.onmessage = async (ev: MessageEvent<PartRequest>) => {
  const req = ev.data;
  const t0 = Date.now();
  try {
    const occt = await loadOcct(req.occtJs, req.occtWasm);
    const result = readWithOcct(occt, "step", new Uint8Array(req.bytes), req.params);
    if (!result?.success || !result.meshes?.length) {
      post({ id: req.id, type: "done", parts: [], topology: null, ms: Date.now() - t0 });
      return;
    }
    const model = occtToModel(result, "STEP");
    // tělesa bez sítě (OpenCascade nezvládlo triangulaci) → díl se nepodařil
    if (model.parts.every((p) => p.positions.length === 0)) {
      post({ id: req.id, type: "error", error: "prázdná síť", fatal: false });
      return;
    }
    const topology: PartTopology[] | null = req.topology
      ? model.parts.map((p) => computeTopology({ positions: p.positions, indices: p.indices, faces: p.faces }))
      : null;
    const transfer = new Set<ArrayBuffer>();
    for (const p of model.parts) for (const a of [p.positions, p.normals, p.indices]) if (a) transfer.add(a.buffer as ArrayBuffer);
    for (const t of topology ?? []) for (const a of [t.edgeSegments, t.segCurve, t.corners, t.triFace]) transfer.add(a.buffer as ArrayBuffer);
    post({ id: req.id, type: "done", parts: model.parts, topology, ms: Date.now() - t0 }, [...transfer]);
  } catch (e) {
    const message = e instanceof Error ? `${e.name}: ${e.message}` : String(e);
    // WebAssembly po abortu (nedostatek paměti) už nejde použít → worker skončí, nahradí ho nový
    const fatal = !!occtAbort || e instanceof WebAssembly.RuntimeError || e instanceof RangeError;
    post({ id: req.id, type: "error", error: occtAbort ? `${message} (${occtAbort})` : message, fatal });
    if (fatal) self.close();
  }
};
