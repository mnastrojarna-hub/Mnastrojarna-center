import type { PartTopology } from "./topology";
import type { ParsedModel } from "./types";
import type { Model3DFormat } from "./sniff";

export type WorkerFormat = Exclude<Model3DFormat, "3mf" | "glb" | "gltf" | "off"> | "pdf";

export type WorkerRequest =
  | { id: number; type: "import"; format: WorkerFormat; bytes: ArrayBuffer; name: string; occtJs: string; occtWasm: string }
  | { id: number; type: "topology"; model: ParsedModel };

export type LoadStage = "download" | "engine" | "parse" | "topology" | "render";

export type WorkerResponse =
  | { id: number; type: "progress"; stage: LoadStage }
  | { id: number; type: "done"; model: ParsedModel; topology: PartTopology[]; timings: { parse: number; topology: number } }
  | { id: number; type: "error"; error: string };

/** Umístění OpenCascade (zkopírováno do public/ při instalaci — viz tools/vendor-occt.mjs). */
export const OCCT_VERSION = "0.0.23";
export const OCCT_JS_URL = `/vendor/occt-${OCCT_VERSION}/occt-import-js.js`;
export const OCCT_WASM_URL = `/vendor/occt-${OCCT_VERSION}/occt-import-js.wasm`;
