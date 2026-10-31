"use client";
import type { DrawingMeta, DrawingOptions, DrawingResult } from "./drawing";
import type { Interference } from "./asm-kernel";
import type { BuildResult, CadDoc, ComponentSource, ExportFormat, FaceInfo } from "./types";

let worker: Worker | null = null;
let seq = 0;
const pending = new Map<number, { resolve: (v: unknown) => void; reject: (e: Error) => void }>();

function w() {
  if (!worker) {
    worker = new Worker(new URL("./cad.worker.ts", import.meta.url), { type: "module" });
    worker.onmessage = (e: MessageEvent<{ id: number; ok: boolean; result?: unknown; error?: string }>) => {
      const p = pending.get(e.data.id);
      if (!p) return;
      pending.delete(e.data.id);
      if (e.data.ok) p.resolve(e.data.result);
      else p.reject(new Error(e.data.error || "Chyba CAD jádra."));
    };
    worker.onerror = (e) => {
      for (const p of pending.values()) p.reject(new Error("CAD jádro se nepodařilo načíst: " + (e.message || "")));
      pending.clear();
      worker?.terminate();
      worker = null;
    };
  }
  return worker;
}

function call<T>(msg: Record<string, unknown>): Promise<T> {
  const id = ++seq;
  return new Promise<T>((resolve, reject) => {
    pending.set(id, { resolve: resolve as (v: unknown) => void, reject });
    w().postMessage({ id, ...msg });
  });
}

export const cad = {
  init: () => call<void>({ op: "init" }),
  build: (doc: CadDoc) => call<BuildResult>({ op: "build", doc }),
  face: (index: number) => call<FaceInfo | null>({ op: "face", index }),
  exportFile: (doc: CadDoc, format: ExportFormat) => call<ArrayBuffer>({ op: "export", doc, format }),
  asmParts: (parts: { key: string; source: ComponentSource }[]) => call<{ key: string; result: BuildResult }[]>({ op: "asmParts", parts }),
  asmFace: (key: string, index: number) => call<FaceInfo | null>({ op: "asmFace", key, index }),
  interference: (doc: CadDoc) => call<Interference[]>({ op: "interference", doc }),
  drawing: (doc: CadDoc, meta: DrawingMeta, opts?: Partial<DrawingOptions>) => call<DrawingResult>({ op: "drawing", doc, meta, opts }),
};
