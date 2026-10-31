/// <reference lib="webworker" />
/* CAD jádro ve web workeru: OpenCascade (WASM) + replicad. UI zůstává plynulé i při složitých operacích. */
import * as r from "replicad";
import opencascade from "replicad-opencascadejs";
import { buildDoc, buildShape, faceInfo } from "./build";
import { makeDrawing, type DrawingMeta } from "./drawing";
import type { CadDoc } from "./types";

let ready: Promise<void> | null = null;
let body: r.Shape3D | null = null;

function init() {
  if (!ready) {
    ready = (opencascade as unknown as (o: object) => Promise<unknown>)({
      print: () => undefined,
      printErr: () => undefined,
    }).then((oc) => {
      r.setOC(oc as never);
    });
    ready.catch(() => (ready = null));
  }
  return ready;
}

type Req =
  | { id: number; op: "init" }
  | { id: number; op: "build"; doc: CadDoc }
  | { id: number; op: "face"; index: number }
  | { id: number; op: "export"; format: "step" | "stl"; doc: CadDoc }
  | { id: number; op: "drawing"; doc: CadDoc; meta: DrawingMeta };

const ctx = self as unknown as DedicatedWorkerGlobalScope;

ctx.onmessage = async (e: MessageEvent<Req>) => {
  const m = e.data;
  try {
    await init();
    switch (m.op) {
      case "init":
        ctx.postMessage({ id: m.id, ok: true });
        break;
      case "build": {
        const res = await buildDoc(m.doc);
        body?.delete?.();
        body = res.body;
        const { body: _b, ...plain } = res;
        void _b;
        const t = plain.mesh ? [plain.mesh.vertices.buffer, plain.mesh.normals.buffer, plain.mesh.triangles.buffer, plain.mesh.faceGroups.buffer, plain.mesh.lines.buffer, plain.mesh.edgeGroups.buffer] : [];
        ctx.postMessage({ id: m.id, ok: true, result: plain }, t as Transferable[]);
        break;
      }
      case "face":
        ctx.postMessage({ id: m.id, ok: true, result: body ? faceInfo(body, m.index) : null });
        break;
      case "export": {
        const { body: b } = await buildShape(m.doc);
        if (!b) throw new Error("Model je prázdný.");
        const blob = m.format === "step" ? b.blobSTEP() : b.blobSTL({ tolerance: 0.01, angularTolerance: 0.1 });
        const buf = await blob.arrayBuffer();
        ctx.postMessage({ id: m.id, ok: true, result: buf }, [buf]);
        break;
      }
      case "drawing": {
        const { body: b } = await buildShape(m.doc);
        if (!b) throw new Error("Model je prázdný.");
        ctx.postMessage({ id: m.id, ok: true, result: makeDrawing(b, m.meta) });
        break;
      }
    }
  } catch (err) {
    ctx.postMessage({ id: m.id, ok: false, error: err instanceof Error ? err.message : "Chyba CAD jádra." });
  }
};
