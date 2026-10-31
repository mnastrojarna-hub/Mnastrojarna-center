/// <reference lib="webworker" />
/* CAD jádro ve web workeru: OpenCascade (WASM) + replicad. UI zůstává plynulé i při složitých operacích. */
import * as r from "replicad";
import opencascade from "replicad-opencascadejs";
import { buildDoc, faceInfo } from "./build";
import { makeDrawing, type DrawingMeta, type DrawingOptions } from "./drawing";
import { cachedBody, interference, partEntry, shapeOfDoc } from "./asm-kernel";
import { exportShape } from "./formats/export";
import { entityInfo, measureEntities, shapeFor, vertexPositions, type EntRef, type ShapeSrc } from "./inspect";
import type { CadDoc, ComponentSource, ExportFormat, MeshData } from "./types";

let ready: Promise<void> | null = null;
let body: r.Shape3D | null = null;
let drawCache: { key: string; body: r.Shape3D } | null = null;

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
  | { id: number; op: "export"; format: ExportFormat; doc: CadDoc }
  | { id: number; op: "asmParts"; parts: { key: string; source: ComponentSource }[] }
  | { id: number; op: "asmFace"; key: string; index: number }
  | { id: number; op: "interference"; doc: CadDoc }
  | { id: number; op: "inspect"; src: ShapeSrc; ref: EntRef; density?: number }
  | { id: number; op: "measureEnt"; a: { src: ShapeSrc; ref: EntRef }; b: { src: ShapeSrc; ref: EntRef } | null }
  | { id: number; op: "drawing"; doc: CadDoc; meta: DrawingMeta; opts?: Partial<DrawingOptions> };

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
        if (!plain.vertices && body) {
          try {
            plain.vertices = vertexPositions(body);
          } catch {
            /* bez vrcholů */
          }
        }
        const t = plain.mesh ? [plain.mesh.vertices.buffer, plain.mesh.normals.buffer, plain.mesh.triangles.buffer, plain.mesh.faceGroups.buffer, plain.mesh.lines.buffer, plain.mesh.edgeGroups.buffer] : [];
        ctx.postMessage({ id: m.id, ok: true, result: plain }, t as Transferable[]);
        break;
      }
      case "face":
        ctx.postMessage({ id: m.id, ok: true, result: body ? faceInfo(body, m.index) : null });
        break;
      case "asmParts": {
        const out = [];
        const t: Transferable[] = [];
        for (const p of m.parts) {
          const e = await partEntry(p.key, p.source);
          if (!e.result.vertices && e.body) {
            try {
              e.result.vertices = vertexPositions(e.body);
            } catch {
              /* bez vrcholů */
            }
          }
          const res = { ...e.result, mesh: e.result.mesh ? copyMesh(e.result.mesh) : null, vertices: e.result.vertices?.slice() };
          if (res.mesh) t.push(res.mesh.vertices.buffer, res.mesh.normals.buffer, res.mesh.triangles.buffer, res.mesh.faceGroups.buffer, res.mesh.lines.buffer, res.mesh.edgeGroups.buffer);
          out.push({ key: p.key, result: res });
        }
        ctx.postMessage({ id: m.id, ok: true, result: out }, t);
        break;
      }
      case "asmFace": {
        const b = cachedBody(m.key);
        ctx.postMessage({ id: m.id, ok: true, result: b ? faceInfo(b, m.index) : null });
        break;
      }
      case "inspect": {
        const sh = shapeFor(m.src, body, cachedBody);
        if (!sh) throw new Error("Těleso není k dispozici.");
        const info = entityInfo(sh, m.ref, m.density);
        if (m.src.kind === "comp") sh.delete?.();
        ctx.postMessage({ id: m.id, ok: true, result: info });
        break;
      }
      case "measureEnt": {
        const sa = shapeFor(m.a.src, body, cachedBody);
        const sb = m.b ? shapeFor(m.b.src, body, cachedBody) : null;
        if (!sa) throw new Error("Těleso není k dispozici.");
        const res = measureEntities(sa, m.a.ref, sb, m.b?.ref ?? null);
        if (m.a.src.kind === "comp") sa.delete?.();
        if (sb && m.b?.src.kind === "comp") sb.delete?.();
        ctx.postMessage({ id: m.id, ok: true, result: res });
        break;
      }
      case "interference":
        ctx.postMessage({ id: m.id, ok: true, result: await interference(m.doc) });
        break;
      case "export": {
        const b = await shapeOfDoc(m.doc);
        if (!b) throw new Error("Model je prázdný.");
        const buf = await exportShape(b, m.format, m.doc.name);
        ctx.postMessage({ id: m.id, ok: true, result: buf }, [buf]);
        break;
      }
      case "drawing": {
        // těleso se přestaví jen při změně modelu (změny voleb výkresu jsou rychlé)
        const key = JSON.stringify(m.doc);
        if (drawCache?.key !== key) {
          const b = await shapeOfDoc(m.doc);
          if (!b) throw new Error("Model je prázdný.");
          drawCache?.body.delete?.();
          drawCache = { key, body: b };
        }
        ctx.postMessage({ id: m.id, ok: true, result: makeDrawing(drawCache.body, m.meta, m.opts) });
        break;
      }
    }
  } catch (err) {
    ctx.postMessage({ id: m.id, ok: false, error: err instanceof Error ? err.message : "Chyba CAD jádra." });
  }
};

/** kopie sítě – originál zůstává v mezipaměti workeru, kopie se předá (transfer) do UI */
function copyMesh(m: MeshData): MeshData {
  return {
    vertices: m.vertices.slice(),
    normals: m.normals.slice(),
    triangles: m.triangles.slice(),
    faceGroups: m.faceGroups.slice(),
    lines: m.lines.slice(),
    edgeGroups: m.edgeGroups.slice(),
  };
}
