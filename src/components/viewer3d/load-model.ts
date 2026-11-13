import type { ParsedModel } from "@/lib/viewer3d/types";
import { hydrateTopology } from "@/lib/viewer3d/step-assembly";
import type { PartTopology } from "@/lib/viewer3d/topology";
import type { Model3DFormat } from "@/lib/viewer3d/sniff";
import {
  OCCT_JS_URL, OCCT_WASM_URL, LIBREDWG_WASM_DIR, type LoadProgress, type WorkerFormat, type WorkerRequest, type WorkerResponse,
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
  /** Časy kroků ve workeru (ms) a počty — ladění / E2E. */
  timings?: Record<string, number>;
}

export type ModelSource = { format: Model3DFormat; bytes: ArrayBuffer; name: string } | { format: "pdf"; bytes: ArrayBuffer; name: string };

let seq = 0;

/** Bez zprávy z workeru déle než tohle (ms) → zaseknutý / spadlý worker (např. nedostatek paměti). */
export const WATCHDOG_MS = 60_000;

export class ModelLoadError extends Error {
  constructor(message: string, readonly kind: "timeout" | "crash" | "import") {
    super(message);
    this.name = "ModelLoadError";
  }
}

function runWorker(req: WorkerRequest, transfer: Transferable[], onProgress: (p: LoadProgress) => void, signal?: AbortSignal): Promise<{ model: ParsedModel; topology: PartTopology[]; timings?: Record<string, number> }> {
  return new Promise((resolve, reject) => {
    const worker = new Worker(new URL("../../lib/viewer3d/import.worker.ts", import.meta.url));
    let timer: ReturnType<typeof setTimeout> | null = null;
    let budget = WATCHDOG_MS;
    const finish = () => {
      if (timer) clearTimeout(timer);
      signal?.removeEventListener("abort", abort);
      worker.terminate();
    };
    // hlídání: worker, který spadne na paměť, často nepošle ani chybu → bez hlídání by se točilo kolečko navždy
    const arm = () => {
      if (timer) clearTimeout(timer);
      timer = setTimeout(() => {
        finish();
        reject(new ModelLoadError(`Načítání modelu se zaseklo (${Math.round(budget / 1000)} s bez odezvy) — model je pro prohlížeč nejspíš příliš velký.`, "timeout"));
      }, budget);
    };
    const abort = () => {
      finish();
      reject(new DOMException("Zrušeno", "AbortError"));
    };
    signal?.addEventListener("abort", abort, { once: true });
    worker.onmessage = (ev: MessageEvent<WorkerResponse>) => {
      const msg = ev.data;
      if (msg.id !== req.id) return;
      if (msg.type === "progress") {
        budget = msg.budgetMs ?? WATCHDOG_MS;
        arm();
        const { stage, done, total, budgetMs } = msg;
        onProgress({ stage, done, total, budgetMs });
      } else if (msg.type === "done") {
        finish();
        resolve({ model: msg.model, topology: hydrateTopology(msg.topology, msg.prototypes), timings: msg.timings });
      } else {
        finish();
        reject(new ModelLoadError(msg.error, "import"));
      }
    };
    worker.onerror = (ev) => {
      finish();
      reject(new ModelLoadError(ev.message ? `Prohlížeč modelu selhal: ${ev.message}` : "Prohlížeč modelu selhal (nedostatek paměti?).", "crash"));
    };
    worker.onmessageerror = () => {
      finish();
      reject(new ModelLoadError("Výsledek modelu se nepodařilo předat (nedostatek paměti?).", "crash"));
    };
    arm();
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

export async function loadModel(src: ModelSource, onProgress: (p: LoadProgress) => void, signal?: AbortSignal): Promise<LoadedModel> {
  const id = ++seq;
  if (src.format === "off") throw new Error("Formát OFF zatím neumím otevřít — pošli prosím STEP nebo STL.");
  if (src.format === "3mf" || src.format === "glb" || src.format === "gltf") {
    onProgress({ stage: "parse" });
    const model = await parseOnMainThread(src.format, src.bytes, src.name);
    if (!model.parts.length) throw new Error("V souboru není žádná síť k zobrazení.");
    onProgress({ stage: "topology" });
    const res = await runWorker({ id, type: "topology", model }, [], onProgress, signal);
    return { ...res, zUp: src.format === "3mf" };
  }
  const format = src.format as WorkerFormat;
  const occtJs = new URL(OCCT_JS_URL, window.location.origin).toString();
  const occtWasm = new URL(OCCT_WASM_URL, window.location.origin).toString();
  // vlastní kopie pro worker (předává se vlastnictvím; originál může volající použít znovu)
  const bytes = src.bytes.slice(0);
  const res = await runWorker(
    { id, type: "import", format, bytes, name: src.name, occtJs, occtWasm, dwgWasmDir: new URL(LIBREDWG_WASM_DIR, window.location.origin).toString() },
    [bytes],
    onProgress,
    signal,
  );
  if (!res.model.parts.length) {
    throw new Error(res.model.drawing ? "Výkres je prázdný — v modelovém prostoru nic není (jen rozvržení / výkresový list?)." : "V souboru není žádné těleso k zobrazení.");
  }
  return { ...res, zUp: format !== "obj" };
}
