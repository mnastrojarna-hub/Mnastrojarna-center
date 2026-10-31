import type { RawMesh } from "./mesh-metrics";

export const OCCT_BASE = "/vendor/occt-0.0.23/";
export const CAD_EXT = ["step", "stp", "iges", "igs", "stl"];

export type LoadedMesh = RawMesh & { normal?: Float32Array | null; color?: [number, number, number] | null };

let worker: Worker | null = null;
let seq = 0;
const waiting = new Map<number, { resolve: (m: LoadedMesh[]) => void; reject: (e: Error) => void }>();

function getWorker() {
  if (!worker) {
    worker = new Worker("/step-worker.js");
    worker.onmessage = (e: MessageEvent<{ id: number; ok: boolean; meshes?: LoadedMesh[]; error?: string }>) => {
      const w = waiting.get(e.data.id);
      if (!w) return;
      waiting.delete(e.data.id);
      if (e.data.ok) w.resolve(e.data.meshes ?? []);
      else w.reject(new Error(e.data.error || "Chyba při čtení modelu."));
    };
    worker.onerror = () => {
      for (const w of waiting.values()) w.reject(new Error("3D jádro se nepodařilo načíst."));
      waiting.clear();
      worker?.terminate();
      worker = null;
    };
  }
  return worker;
}

export function extOf(name: string) {
  return name.split(".").pop()?.toLowerCase() ?? "";
}

/** Načte CAD soubor do sítě trojúhelníků. STEP/IGES ve workeru (OpenCascade), STL přímo. */
export async function loadCad(file: File): Promise<LoadedMesh[]> {
  const ext = extOf(file.name);
  const buffer = await file.arrayBuffer();
  if (ext === "stl") {
    const { STLLoader } = await import("three/examples/jsm/loaders/STLLoader.js");
    const geo = new STLLoader().parse(buffer);
    const position = geo.getAttribute("position").array as Float32Array;
    return [{ position: new Float32Array(position), index: null }];
  }
  const id = ++seq;
  return new Promise((resolve, reject) => {
    waiting.set(id, { resolve, reject });
    getWorker().postMessage({ id, base: OCCT_BASE, name: file.name, buffer }, [buffer]);
  });
}
