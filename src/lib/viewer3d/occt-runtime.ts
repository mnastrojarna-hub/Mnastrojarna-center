/**
 * Načtení OpenCascade (occt-import-js, WebAssembly) ve workeru — sdílené hlavním workerem
 * prohlížeče i workery dílů velké sestavy.
 */
import type { OcctResult } from "./occt";

export interface OcctModule {
  ReadStepFile: (content: Uint8Array, params: unknown) => OcctResult;
  ReadIgesFile: (content: Uint8Array, params: unknown) => OcctResult;
  ReadBrepFile: (content: Uint8Array, params: unknown) => OcctResult;
  HEAPU8?: Uint8Array;
}
type OcctFactory = (overrides: { locateFile: (path: string) => string; print?: (s: string) => void; printErr?: (s: string) => void; onAbort?: (what: unknown) => void }) => Promise<OcctModule>;

let occtPromise: Promise<OcctModule> | null = null;
/** Poslední abort WebAssembly (např. „OOM") — modul je potom nepoužitelný. */
export let occtAbort: string | null = null;

export async function loadOcct(jsUrl: string, wasmUrl: string): Promise<OcctModule> {
  if (!occtPromise) {
    occtPromise = (async () => {
      const g = self as unknown as { occtimportjs?: OcctFactory; importScripts?: (u: string) => void };
      if (!g.occtimportjs) {
        if (typeof g.importScripts === "function") {
          try {
            g.importScripts(jsUrl);
          } catch {
            /* modulový worker → níže přes fetch */
          }
        }
        if (!g.occtimportjs) {
          // modulový worker nemá importScripts → načíst skript a spustit ho
          const code = await (await fetch(jsUrl)).text();
          g.occtimportjs = new Function(`${code}\n;return occtimportjs;`)() as OcctFactory;
        }
      }
      if (!g.occtimportjs) throw new Error("OpenCascade se nenačetl.");
      return g.occtimportjs({
        locateFile: (p) => (p.endsWith(".wasm") ? wasmUrl : p),
        // hlášky OpenCascade („Exception Raised while reading…") nepatří do konzole uživatele
        print: () => {},
        printErr: () => {},
        onAbort: (what) => {
          occtAbort = String(what ?? "abort");
        },
      });
    })();
    occtPromise.catch(() => {
      occtPromise = null;
    });
  }
  return occtPromise;
}

export interface OcctParams {
  linearUnit: "millimeter";
  linearDeflectionType: "bounding_box_ratio" | "absolute_value";
  linearDeflection: number;
  angularDeflection: number;
}

export function readWithOcct(occt: OcctModule, format: "step" | "iges" | "brep", bytes: Uint8Array, params: OcctParams): OcctResult {
  return format === "step" ? occt.ReadStepFile(bytes, params)
    : format === "iges" ? occt.ReadIgesFile(bytes, params)
      : occt.ReadBrepFile(bytes, null);
}
