/**
 * Web Worker prohlížeče 3D: načtení modelu (STEP/IGES/BREP přes OpenCascade ve WebAssembly,
 * STL/OBJ/PLY, 3D PDF / U3D / PRC) a výpočet topologie (hrany, rohy, kružnice) mimo hlavní vlákno,
 * aby se stránka při otevírání velkých sestav nesekala.
 */
import { computeTopology, type PartTopology } from "./topology";
import { occtToModel, type OcctResult } from "./occt";
import { parseObj, parsePly, parseStl } from "./formats/mesh";
import { decodePdf3D, decodePRC, decodeU3D } from "./formats/embedded3d";
import { ModelImportError, type ParsedModel } from "./types";
import { drawingToModel } from "./drawing-model";
import type { WorkerRequest, WorkerResponse } from "./worker-protocol";

/** Minimální typy workeru (lib „webworker" by v projektu kolidovala s typy DOM). */
interface WorkerScope {
  postMessage(message: unknown, transfer?: Transferable[]): void;
  onmessage: ((ev: MessageEvent<WorkerRequest>) => void) | null;
  importScripts?: (...urls: string[]) => void;
}
declare const self: WorkerScope;

interface OcctModule {
  ReadStepFile: (content: Uint8Array, params: unknown) => OcctResult;
  ReadIgesFile: (content: Uint8Array, params: unknown) => OcctResult;
  ReadBrepFile: (content: Uint8Array, params: unknown) => OcctResult;
}
type OcctFactory = (overrides: { locateFile: (path: string) => string }) => Promise<OcctModule>;

let occtPromise: Promise<OcctModule> | null = null;

async function loadOcct(jsUrl: string, wasmUrl: string): Promise<OcctModule> {
  if (!occtPromise) {
    occtPromise = (async () => {
      const g = self as unknown as { occtimportjs?: OcctFactory; importScripts?: (u: string) => void };
      if (!g.occtimportjs) {
        if (typeof g.importScripts === "function") {
          g.importScripts(jsUrl);
        } else {
          // modulový worker nemá importScripts → načíst skript a spustit ho
          const code = await (await fetch(jsUrl)).text();
          g.occtimportjs = new Function(`${code}\n;return occtimportjs;`)() as OcctFactory;
        }
      }
      if (!g.occtimportjs) throw new Error("OpenCascade se nenačetl.");
      return g.occtimportjs({ locateFile: (p) => (p.endsWith(".wasm") ? wasmUrl : p) });
    })();
    occtPromise.catch(() => {
      occtPromise = null;
    });
  }
  return occtPromise;
}

function post(msg: WorkerResponse, transfer: Transferable[] = []) {
  self.postMessage(msg, transfer);
}

function collectTransfer(model: ParsedModel, topo: PartTopology[]): Transferable[] {
  const set = new Set<ArrayBuffer>();
  const add = (a: ArrayBufferView | null | undefined) => {
    if (a && a.buffer instanceof ArrayBuffer && a.byteLength) set.add(a.buffer);
  };
  for (const p of model.parts) {
    add(p.positions);
    add(p.normals);
    add(p.indices);
    add(p.lines);
    add(p.lineColors);
  }
  for (const c of model.drawing?.darkColors ?? []) add(c);
  for (const t of topo) {
    add(t.edgeSegments);
    add(t.segCurve);
    add(t.corners);
    add(t.triFace);
  }
  return [...set];
}

async function importModel(req: Extract<WorkerRequest, { type: "import" }>): Promise<ParsedModel> {
  const bytes = new Uint8Array(req.bytes);
  switch (req.format) {
    case "step":
    case "iges":
    case "brep": {
      post({ id: req.id, type: "progress", stage: "engine" });
      const occt = await loadOcct(req.occtJs, req.occtWasm);
      post({ id: req.id, type: "progress", stage: "parse" });
      const params = { linearUnit: "millimeter", linearDeflectionType: "bounding_box_ratio", linearDeflection: 0.001, angularDeflection: 0.35 };
      const result =
        req.format === "step" ? occt.ReadStepFile(bytes, params)
          : req.format === "iges" ? occt.ReadIgesFile(bytes, params)
            : occt.ReadBrepFile(bytes, null);
      if (!result?.success || !result.meshes?.length) {
        throw new ModelImportError(
          req.format === "step"
            ? "STEP se nepodařilo načíst — soubor je poškozený nebo neobsahuje žádná tělesa (jen výkres / PMI)."
            : "Soubor se nepodařilo načíst — je poškozený nebo neobsahuje žádná tělesa.",
        );
      }
      const label = req.format === "step" ? "STEP" : req.format === "iges" ? "IGES" : "BREP";
      return occtToModel(result, label);
    }
    case "stl":
      post({ id: req.id, type: "progress", stage: "parse" });
      return parseStl(bytes, req.name);
    case "obj":
      post({ id: req.id, type: "progress", stage: "parse" });
      return parseObj(bytes, req.name);
    case "ply":
      post({ id: req.id, type: "progress", stage: "parse" });
      return parsePly(bytes, req.name);
    case "u3d":
      post({ id: req.id, type: "progress", stage: "parse" });
      return decodeU3D(bytes);
    case "prc":
      post({ id: req.id, type: "progress", stage: "parse" });
      return decodePRC(bytes);
    case "pdf":
      post({ id: req.id, type: "progress", stage: "parse" });
      return decodePdf3D(bytes);
    case "dxf": {
      post({ id: req.id, type: "progress", stage: "parse" });
      const { parseDxf } = await import("./formats/dxf");
      return withTopology(drawingToModel(parseDxf(bytes)));
    }
    case "dwg": {
      post({ id: req.id, type: "progress", stage: "engine" });
      const { parseDwg } = await import("./formats/dwg");
      const d = await parseDwg(bytes, req.dwgWasmDir);
      return withTopology(drawingToModel(d));
    }
    default:
      throw new ModelImportError("Tento formát 3D modelu zatím neumím otevřít.");
  }
}

/** Výkres má topologii z přesné geometrie (ne ze sítě) — předá se dál s modelem. */
const drawingTopo = new WeakMap<ParsedModel, PartTopology[]>();
function withTopology(d: { model: ParsedModel; topology: PartTopology[] }): ParsedModel {
  drawingTopo.set(d.model, d.topology);
  return d.model;
}

function topologies(model: ParsedModel): PartTopology[] {
  const t = drawingTopo.get(model);
  if (t) return t;
  return model.parts.map((p) => computeTopology({ positions: p.positions, indices: p.indices, faces: p.faces }));
}

self.onmessage = async (ev: MessageEvent<WorkerRequest>) => {
  const req = ev.data;
  try {
    const t0 = Date.now();
    const model = req.type === "import" ? await importModel(req) : req.model;
    const t1 = Date.now();
    post({ id: req.id, type: "progress", stage: "topology" });
    const topo = topologies(model);
    const t2 = Date.now();
    post({ id: req.id, type: "done", model, topology: topo, timings: { parse: t1 - t0, topology: t2 - t1 } }, collectTransfer(model, topo));
  } catch (e) {
    const known = e instanceof ModelImportError;
    const message = e instanceof Error ? e.message : String(e);
    post({
      id: req.id,
      type: "error",
      error: known ? message : `Model se nepodařilo načíst (${message}).`,
    });
  }
};
