import type { PartTopology } from "./topology";
import type { MeshPart, ParsedModel } from "./types";
import type { Model3DFormat } from "./sniff";
import type { OcctParams } from "./occt-runtime";
import type { ProtoTopology } from "./step-assembly";

export type WorkerFormat = Exclude<Model3DFormat, "3mf" | "glb" | "gltf" | "off"> | "pdf";

export type WorkerRequest =
  | { id: number; type: "import"; format: WorkerFormat; bytes: ArrayBuffer; name: string; occtJs: string; occtWasm: string; dwgWasmDir: string }
  | { id: number; type: "topology"; model: ParsedModel };

export type LoadStage = "download" | "engine" | "split" | "parse" | "topology" | "render";

/** Průběh načítání; `done` / `total` = díly velké sestavy, `budgetMs` = jak dlouho smí krok trvat bez další zprávy. */
export interface LoadProgress {
  stage: LoadStage;
  done?: number;
  total?: number;
  /** Krok blokuje worker (OpenCascade čte celý soubor) — hlídací limit hlavního vlákna v ms. */
  budgetMs?: number;
}

export type WorkerResponse =
  | ({ id: number; type: "progress" } & LoadProgress)
  | { id: number; type: "done"; model: ParsedModel; topology: PartTopology[]; prototypes?: ProtoTopology[]; timings: Record<string, number> }
  | { id: number; type: "error"; error: string };

/** Worker dílu velké sestavy (occt-part.worker.ts). */
export interface PartRequest {
  id: number;
  bytes: ArrayBuffer;
  params: OcctParams;
  occtJs: string;
  occtWasm: string;
  /** Spočítat i topologii (hrany pro měření). */
  topology: boolean;
}

export type PartResponse =
  | { id: number; type: "done"; parts: MeshPart[]; topology: PartTopology[] | null; ms: number }
  | { id: number; type: "error"; error: string; fatal: boolean };

/** Umístění OpenCascade (zkopírováno do public/ při instalaci — viz tools/vendor-occt.mjs). */
export const OCCT_VERSION = "0.0.23";
export const OCCT_JS_URL = `/vendor/occt-${OCCT_VERSION}/occt-import-js.js`;
export const OCCT_WASM_URL = `/vendor/occt-${OCCT_VERSION}/occt-import-js.wasm`;

/** LibreDWG (čtení DWG, WebAssembly, GPL-3.0) — kopíruje se do public/ stejně jako OpenCascade. */
export const LIBREDWG_VERSION = "0.8.1";
export const LIBREDWG_WASM_DIR = `/vendor/libredwg-${LIBREDWG_VERSION}/`;
