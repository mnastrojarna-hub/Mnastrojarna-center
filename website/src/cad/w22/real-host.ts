/** Skutečné jádro in-process pro testy vlny 22 (stejný klient jádra a obsluhy operací jako prohlížeč a CLI – viz engine/parity.test.ts). */
import fs from "node:fs";
import path from "node:path";
import { setHostAssets } from "../host-assets";
import { makeKernelClient } from "../kernel-client";
import { memoryFileSink, memoryFileSource, type EngineHost } from "../engine/host";

const WASM = path.resolve(__dirname, "../../../node_modules/replicad-opencascadejs/dist/replicad_single.wasm");
const FONTS = path.resolve(__dirname, "../../../public/fonts");

export async function realHost(): Promise<() => EngineHost> {
  setHostAssets({ font: async (name) => new Uint8Array(fs.readFileSync(path.join(FONTS, name))).buffer });
  const { inProcessTransport } = await import("../kernel-inprocess");
  const kernel = makeKernelClient(inProcessTransport({ locateFile: (file) => (file.endsWith(".wasm") ? WASM : file) }));
  await kernel.init();
  return () => ({ kernel, files: memoryFileSink(), inputs: memoryFileSource({}), now: () => Date.now() });
}

/** pravidlo 22i „žádný řádek s ✓ i ✗“ – engine/accept.ts */
export { greenThenRed } from "../engine/accept";
