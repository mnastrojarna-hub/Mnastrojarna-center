import type { ParsedModel } from "@/lib/viewer3d/types";
import type { PartTopology } from "@/lib/viewer3d/topology";
import type { Model3DFormat } from "@/lib/viewer3d/sniff";
import {
  OCCT_JS_URL, OCCT_WASM_URL, type LoadStage, type WorkerFormat, type WorkerRequest, type WorkerResponse,
} from "@/lib/viewer3d/worker-protocol";

/**
 * Načtení modelu: těžká práce běží ve Web Workeru (OpenCascade, dekodéry, topologie), aby se
 * stránka nesekala. 3MF / glTF potřebují DOM (XML, obrázky) → načtou se tady a do workeru jde
 * jen výpočet topologie. Worker se po načtení ukončí (uvolní paměť OpenCascade).
 */

export interface LoadedModel {
  model: ParsedModel;
  topology: PartTopology[];
  /** Model má osu Z nahoru (CAD) — glTF / OBJ mají Y nahoru. */
  zUp: boolean;
}

export type ModelSource = { format: Model3DFormat; bytes: ArrayBuffer; name: string } | { format: "pdf"; bytes: ArrayBuffer; name: string };

let seq = 0;

function runWorker(req: WorkerRequest, transfer: Transferable[], onStage: (s: LoadStage) => void, signal?: AbortSignal): Promise<{ model: ParsedModel; topology: PartTopology[] }> {
  return new Promise((resolve, reject) => {
    const worker = new Worker(new URL("../../lib/viewer3d/import.worker.ts", import.meta.url));
    const finish = () => worker.terminate();
    const abort = () => {
      finish();
      reject(new DOMException("Zrušeno", "AbortError"));
    };
    signal?.addEventListener("abort", abort, { once: true });
    worker.onmessage = (ev: MessageEvent<WorkerResponse>) => {
      const msg = ev.data;
      if (msg.id !== req.id) return;
      if (msg.type === "progress") onStage(msg.stage);
      else if (msg.type === "done") {
        signal?.removeEventListener("abort", abort);
        finish();
        resolve({ model: msg.model, topology: msg.topology });
      } else {
        signal?.removeEventListener("abort", abort);
        finish();
        reject(new Error(msg.error));
      }
    };
    worker.onerror = (ev) => {
      signal?.removeEventListener("abort", abort);
      finish();
      reject(new Error(ev.message ? `Prohlížeč modelu selhal: ${ev.message}` : "Prohlížeč modelu selhal (nedostatek paměti?)."));
    };
    worker.postMessage(req, transfer);
  });
}

async function parseOnMainThread(format: "3mf" | "glb" | "gltf", bytes: ArrayBuffer, name: string): Promise<ParsedModel> {
  const { object3DToModel } = await import("@/lib/viewer3d/formats/mesh");
  if (format === "3mf") {
    const { ThreeMFLoader } = await import("three/examples/jsm/loaders/3MFLoader.js");
    const group = new ThreeMFLoader().parse(bytes);
    return object3DToModel(group, "3MF", name);
  }
  const { GLTFLoader } = await import("three/examples/jsm/loaders/GLTFLoader.js");
  const gltf = await new GLTFLoader().parseAsync(bytes, "");
  return object3DToModel(gltf.scene, format === "glb" ? "glTF (GLB)" : "glTF", name);
}

export async function loadModel(src: ModelSource, onStage: (s: LoadStage) => void, signal?: AbortSignal): Promise<LoadedModel> {
  const id = ++seq;
  if (src.format === "off") throw new Error("Formát OFF zatím neumím otevřít — pošli prosím STEP nebo STL.");
  if (src.format === "3mf" || src.format === "glb" || src.format === "gltf") {
    onStage("parse");
    const model = await parseOnMainThread(src.format, src.bytes, src.name);
    if (!model.parts.length) throw new Error("V souboru není žádná síť k zobrazení.");
    onStage("topology");
    const res = await runWorker({ id, type: "topology", model }, [], onStage, signal);
    return { ...res, zUp: src.format === "3mf" };
  }
  const format = src.format as WorkerFormat;
  const occtJs = new URL(OCCT_JS_URL, window.location.origin).toString();
  const occtWasm = new URL(OCCT_WASM_URL, window.location.origin).toString();
  // vlastní kopie pro worker (předává se vlastnictvím; originál může volající použít znovu)
  const bytes = src.bytes.slice(0);
  const res = await runWorker(
    { id, type: "import", format, bytes, name: src.name, occtJs, occtWasm },
    [bytes],
    onStage,
    signal,
  );
  if (!res.model.parts.length) throw new Error("V souboru není žádné těleso k zobrazení.");
  return { ...res, zUp: format !== "obj" };
}
