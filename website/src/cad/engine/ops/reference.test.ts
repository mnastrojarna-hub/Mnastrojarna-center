/**
 * Operace předlohy v enginu (engine/ops/reference.ts) pro oba hostitele:
 * * prohlížeč (window + Worker): DWG / DXF předlohy se čte v pracovním vlákně importu (cad/draft/io/import-worker.ts) –
 *   velký výkres zákazníka nesmí zablokovat okno (recenze int2, nález 3: engine dřív vnutil `worker: false` všem hostitelům);
 * * Node (CLI, bez window / Worker): totéž čtení ve vlákně běhu;
 * * PDF bez pdf.js hostitele = ✗ host.app-only.
 */
import fs from "node:fs";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { setLang } from "../../i18n";
import type { BuildResult, CadDoc } from "../../types";
import { memoryFileSink, memoryFileSource, type EngineHost } from "../host";
import type { KernelApi } from "../kernel";
import { MemoryWorkspace } from "../memory-workspace";
import type { RunReport } from "../protocol-types";
import { runScript } from "../run";

const FIX = new Uint8Array(fs.readFileSync(path.resolve(__dirname, "../../reference/__fixtures__/deska-predloha.dxf")));

const kernel = {
  generation: () => 1,
  build: async (d: CadDoc) => ({ status: d.features.map((f) => ({ id: f.id, ok: true })), mesh: null, metrics: null, ms: 1 }) as unknown as BuildResult,
  check: async (d: CadDoc) => ({ status: d.features.map((f) => ({ id: f.id, ok: true })), paramErrors: [], solid: true }),
} as unknown as KernelApi;
const host = (files: Record<string, Uint8Array>, o: Partial<EngineHost> = {}): EngineHost => ({ kernel, files: memoryFileSink(), inputs: memoryFileSource(files), now: () => Date.now(), ...o });
const run = (text: string, h: EngineHost) => runScript(new MemoryWorkspace(), text, h, {});
const attachLine = (r: RunReport) => r.entries.find((e) => e.line === 1 && e.level === "ok" && /připojeno/.test(e.text ?? ""))?.text ?? "";

/** pracovní vlákno jako v prohlížeči: zpráva { name, bytes } → { t: "done", … } z téhož čtení (cad/draft/io/files.ts) */
class FakeWorker {
  static made: string[] = [];
  onmessage: ((ev: { data: unknown }) => void) | null = null;
  onerror: ((ev: { message: string }) => void) | null = null;
  constructor(url: URL | string) {
    FakeWorker.made.push(String(url));
  }
  postMessage(m: { name: string; bytes: Uint8Array }) {
    void import("../../draft/io/files").then((io) => {
      const r = io.draftFromFile(m.name, m.bytes);
      this.onmessage?.({ data: { t: "done", model: r.model, note: r.note, format: r.format, version: r.version } });
    });
  }
  terminate() {}
}

afterEach(() => {
  vi.unstubAllGlobals();
  FakeWorker.made = [];
});

describe("předloha v enginu", () => {
  it("prohlížeč (window + Worker): DXF předloha se čte v pracovním vlákně importu, ne ve vlákně okna", async () => {
    setLang("cs");
    vi.stubGlobal("window", {});
    vi.stubGlobal("Worker", FakeWorker);
    const r = await run('předloha "deska-predloha.dxf"', host({ "deska-predloha.dxf": FIX }));
    expect(FakeWorker.made).toHaveLength(1);
    expect(FakeWorker.made[0]).toMatch(/import-worker\.ts$/);
    expect(attachLine(r)).toMatch(/listy 1 \(1× A3\), pohledy 2, kóty 7/);
  });
  it("Node (CLI: bez window / Worker): stejná předloha ve vlákně běhu, stejný výtah", async () => {
    setLang("cs");
    expect(typeof window).toBe("undefined");
    const r = await run('předloha "deska-predloha.dxf"', host({ "deska-predloha.dxf": FIX }));
    expect(FakeWorker.made).toEqual([]);
    expect(attachLine(r)).toMatch(/listy 1 \(1× A3\), pohledy 2, kóty 7/);
  });
  it("PDF bez pdf.js hostitele = ✗ host.app-only (DWG / DXF jdou bez prohlížeče)", async () => {
    setLang("cs");
    const r = await run('předloha "vykres.pdf"', host({ "vykres.pdf": new TextEncoder().encode("%PDF-1.4\n") }));
    expect(r.entries.find((e) => e.code === "host.app-only")?.line).toBe(1);
  });
});
