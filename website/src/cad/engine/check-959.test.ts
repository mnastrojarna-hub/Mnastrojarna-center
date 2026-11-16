/**
 * Balík B5 na skutečném dokumentu zkoušky 959 (NDA – soubor jen v `website/.local/fixtures/`, mimo git; bez něj se test
 * přeskočí). Ověřuje bez čísel z dokumentu: `kolize` zařadí všechny statické kolize jako šroub v závitu / pod hlavou
 * (žádná skutečná ani nevyhodnotitelná), `kontrola sestava` uvede V.sum i V.union (sjednocení menší o průniky šroubů) a
 * stejné V.sum jako stav sestavy; `porovnat … sestava` proti vlastnímu STEP je shoda. Cesta k souboru: `MNCAD_959_DOC`, jinak `.local/fixtures/959-dokument.json` hlavního checkoutu.
 */
import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { setHostAssets } from "../host-assets";
import { makeKernelClient } from "../kernel-client";
import { memoryFileSink, memoryFileSource, type EngineHost } from "./host";
import { MemoryWorkspace } from "./memory-workspace";
import { formatShort } from "./protocol";
import { runScript } from "./run";

const WASM = path.resolve(__dirname, "../../../node_modules/replicad-opencascadejs/dist/replicad_single.wasm");
const FONTS = path.resolve(__dirname, "../../../public/fonts");
const DOC = process.env.MNCAD_959_DOC ?? [path.resolve(__dirname, "../../../.local/fixtures/959-dokument.json"), "/home/user/Mnastrojarna-center/website/.local/fixtures/959-dokument.json"].find((p) => fs.existsSync(p));

describe.skipIf(!DOC || !fs.existsSync(DOC))("B5 na skutečném dokumentu 959 (přeskočeno bez souboru)", () => {
  let kernel0: ReturnType<typeof makeKernelClient> | null = null;
  const kernelOf = async () => {
    if (kernel0) return kernel0;
    setHostAssets({ font: async (name) => new Uint8Array(fs.readFileSync(path.join(FONTS, name))).buffer });
    const { inProcessTransport } = await import("../kernel-inprocess");
    kernel0 = makeKernelClient(inProcessTransport({ locateFile: (file) => (file.endsWith(".wasm") ? WASM : file) }));
    await kernel0.init();
    return kernel0;
  };

  it("kolize: jen šroub × závit (thread / underhead); kontrola sestava: V.sum = stav, V.union < V.sum", async () => {
    const kernel = await kernelOf();
    const host: EngineHost = { kernel, files: memoryFileSink(), inputs: memoryFileSource({}), now: () => Date.now() };
    const ws = new MemoryWorkspace();
    await runScript(ws, fs.readFileSync(DOC!, "utf8").replace(/\s*\n\s*/g, " "), host);
    const t0 = Date.now();
    const r = await runScript(ws, "kolize\nkontrola sestava\nstav", host);
    const ms = Date.now() - t0;
    const short = formatShort(r, { budget: Infinity });
    const clash = /^= L1 clash "[^"]*" total=(\d+) thread=(\d+) underhead=(\d+) real=(\d+) undetermined=(\d+)$/m.exec(short);
    expect(clash, short).not.toBeNull();
    const [total, thread, underhead, real, und] = clash!.slice(1).map(Number);
    expect(total).toBeGreaterThan(0);
    expect({ real, und }).toEqual({ real: 0, und: 0 });
    expect(thread + underhead).toBe(total);
    const head = /^= L2 check "[^"]*" asm comp=(\d+) parts=(\d+) V\.sum=([\d.]+)cm3 V\.union=([\d.]+)cm3 .* clash=(\d+)\(thread=(\d+),underhead=(\d+),real=0,undetermined=0\) valid=(\d+)\/(\d+)$/m.exec(short);
    expect(head, short).not.toBeNull();
    const vSum = Number(head![3]);
    const vUnion = Number(head![4]);
    expect(vUnion).toBeLessThan(vSum);
    const st = /^= L3 status "[^"]*" asm .*V\.sum=([\d.]+)cm3/m.exec(short);
    expect(Math.abs(Number(st![1]) - vSum)).toBeLessThan(Math.max(0.006, vSum * 1e-3)); // stav: 2 desetinná místa; velké díly ze sítě
    expect(r.entries.filter((e) => e.code === "clash.real" || e.code === "clash.undetermined")).toEqual([]);
    if (process.env.B5_959_LOG) fs.writeFileSync(process.env.B5_959_LOG, `${ms} ms\n${short}\n`);
  }, 600_000);

  it("porovnat sestava proti vlastnímu STEP = shoda (nespolehlivé booleovské operace složeného tělesa nejsou rozdíl)", async () => {
    const kernel = await kernelOf();
    const host: EngineHost = { kernel, files: memoryFileSink(), inputs: memoryFileSource({}), now: () => Date.now() };
    const ws = new MemoryWorkspace();
    await runScript(ws, fs.readFileSync(DOC!, "utf8").replace(/\s*\n\s*/g, " "), host);
    const step = new Uint8Array(await kernel.exportFile(ws.present(), "step"));
    const r = await runScript(ws, 'porovnat "ref.step" sestava', { ...host, inputs: memoryFileSource({ "ref.step": step }) });
    const short = formatShort(r, { budget: Infinity });
    expect(short).toMatch(/^= L1 compare "[^"]*" ref=ref\.step ok=1 tol=0\.1 .* within=100% align=none( booleans=inexact)?$/m);
    expect(r.entries.filter((e) => e.code === "compare.mismatch" || e.level === "error")).toEqual([]);
    if (process.env.B5_959_LOG) fs.appendFileSync(process.env.B5_959_LOG, `${short}\n`);
  }, 900_000);
});
