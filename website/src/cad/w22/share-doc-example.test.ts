/**
 * Vlna 22, bod 16 – „dokumentaci držet shodnou s nasazenou verzí“ (kritik M12: pojistka, ne jednorázová oprava řádků):
 * příklad výstupu sdílení v návodu pro AI (agent-guide.ts, oddíl „Sdílení“, blok „# skript:“ / „# stručný protokol:“)
 * se tu SPUSTÍ tak, jak je napsaný (skutečné jádro, engine CLI se stránkou https://www.mnastrojarna.cz/cad a vypnutým
 * úložištěm – `mncad run skript.txt --share-store off`), a každý dokumentovaný řádek protokolu musí ve skutečném výstupu
 * být (po náhradě proměnných částí: data v odkazu, datum platnosti, délky a velikosti → zástupné znaky). Návod i příručka
 * musí uvádět verzi, kterou popisují (vlna 22) a jak ji zjistit (`mncad --version`).
 */
import fs from "node:fs";
import path from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { AGENT_GUIDE } from "../agent-guide";
import { CAD_DOCS } from "@/content/cad-docs";
import { setLang } from "../i18n";
import { setHostAssets } from "../host-assets";
import { makeKernelClient } from "../kernel-client";
import { memoryFileSink, memoryFileSource } from "../engine/host";
import { MemoryWorkspace } from "../engine/memory-workspace";
import { finalizeReport } from "../engine/protocol";
import { runReport } from "../engine/run-protocol";
import { forgetLastLink } from "../engine/share-out";

const WASM = path.resolve(__dirname, "../../../node_modules/replicad-opencascadejs/dist/replicad_single.wasm");
const FONTS = path.resolve(__dirname, "../../../public/fonts");
const PAGE = "https://www.mnastrojarna.cz/cad";

/** blok příkladu v návodu: skript a dokumentované řádky stručného protokolu */
export function guideShareExample(guide: string): { script: string; lines: string[] } {
  const at = guide.indexOf("# skript:");
  if (at < 0) throw new Error("návod nemá blok příkladu sdílení (# skript:)");
  const end = guide.indexOf("```", at);
  const block = guide.slice(at, end).split("\n");
  const k = block.findIndex((l) => l.startsWith("# stručný protokol:"));
  return { script: block.slice(1, k).join("\n") + "\n", lines: block.slice(k + 1).filter((l) => l.trim()) };
}

/** proměnné části řádku → zástupné znaky (data odkazu, data, čísla) */
export const normLine = (l: string): string =>
  l
    .replace(/#s=1([dr])p?\.[A-Za-z0-9_-]+/g, "#s=1$1.DATA")
    .replace(/\d{4}-\d{2}-\d{2}/g, "DATE")
    .replace(/\d+/g, "N");

describe("dokumentace sdílení = skutečný výstup (bod 16)", async () => {
  setLang("cs");
  setHostAssets({ font: async (name) => new Uint8Array(fs.readFileSync(path.join(FONTS, name))).buffer, share: { page: PAGE, store: null, linkPage: PAGE } });
  const { inProcessTransport } = await import("../kernel-inprocess");
  const kernel = makeKernelClient(inProcessTransport({ locateFile: (file) => (file.endsWith(".wasm") ? WASM : file) }));
  await kernel.init();
  afterAll(() => setHostAssets({}));

  it("každý řádek příkladu v návodu je ve skutečném stručném protokolu (CLI --share-store off)", async () => {
    const ex = guideShareExample(AGENT_GUIDE);
    expect(ex.lines.length).toBeGreaterThanOrEqual(4);
    forgetLastLink();
    const r = finalizeReport(await runReport(new MemoryWorkspace(), ex.script, { kernel, files: memoryFileSink(), inputs: memoryFileSource({}), now: () => Date.now() }));
    if (process.env.A4_OUT) fs.writeFileSync(path.join(process.env.A4_OUT, "doc-example.short.txt"), r.protocol);
    const actual = new Set(r.protocol.split("\n").map(normLine));
    const missing = ex.lines.filter((l) => !actual.has(normLine(l)));
    expect(missing, `chybí ve výstupu:\n${missing.join("\n")}\n--- skutečný výstup:\n${r.protocol}`).toEqual([]);
  });

  it("návod i příručka popisují výstup CLI i konzole a uvádějí verzi, kterou popisují", () => {
    expect(AGENT_GUIDE).toMatch(/konzoli prohlížeče na řádku `URL: …`/);
    expect(AGENT_GUIDE).toMatch(/= L<n> link/);
    expect(AGENT_GUIDE).toMatch(/od vlny 22 – 20\. 11\. 2026, verzi CLI vypíše `mncad --version`/);
    const docs = JSON.stringify(CAD_DOCS);
    expect(docs).toMatch(/URL: …/);
    expect(docs).toMatch(/= L<n> link/);
    expect(docs).toMatch(/odkaz ověřit/);
    expect(docs).toMatch(/22\. \(20\. 11\. 2026\)/);
  });
});
