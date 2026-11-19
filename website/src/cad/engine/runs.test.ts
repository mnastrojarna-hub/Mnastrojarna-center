/**
 * Vlna E, balík runs – engine: opakovaný běh téhož skriptu (idempotence, engine/runs.ts), řádek D každého dokumentu běhu
 * s čísly (engine/run-summary.ts), relace CLI `--resume` se stejným pravidlem, B1 / B2 (prázdná sestava, 27 záložek).
 */
import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { setHostAssets } from "../host-assets";
import { makeKernelClient } from "../kernel-client";
import { emptyDoc, type BuildResult, type CadDoc, type ComponentSource } from "../types";
import { engineRun, finishRun, type RunHooks } from "../cli/job";
import { memoryFileSink, memoryFileSource, type EngineHost } from "./host";
import type { KernelApi } from "./kernel";
import { loadWorkspace, MemoryWorkspace } from "./memory-workspace";
import { docLine, finalizeReport, formatConsole, GRAMMAR, ReportBuilder } from "./protocol";
import type { RunReport } from "./protocol-types";
import { runScript } from "./run";
import { formatRun, runReport, scriptLineCount } from "./run-protocol";
import { scriptLines } from "../cli/watchdog";

const WASM = path.resolve(__dirname, "../../../node_modules/replicad-opencascadejs/dist/replicad_single.wasm");
const FONTS = path.resolve(__dirname, "../../../public/fonts");

const result = (d: CadDoc): BuildResult =>
  ({ status: d.features.map((f) => ({ id: f.id, ok: true })), mesh: null, metrics: d.features.length ? { volume: 1000 * d.features.length, area: 600, bbox: [[0, 0, 0], [10, 10, 10 * d.features.length]], faces: 6, edges: 12, valid: true, solids: 1 } : null, ms: 1 }) as unknown as BuildResult;
const fake = {
  generation: () => 1,
  build: async (d: CadDoc) => result(d),
  check: async (d: CadDoc) => ({ status: d.features.map((f) => ({ id: f.id, ok: true })), paramErrors: [], solid: true }),
  asmParts: async (parts: { key: string; source: ComponentSource }[]) => parts.map((p) => ({ key: p.key, result: result(p.source.kind === "part" ? p.source.doc : emptyDoc()) })),
  interference: async () => [],
  asmEnvelope: async () => null,
} as unknown as KernelApi;
const hostOf = (kernel: KernelApi = fake): EngineHost => ({ kernel, files: memoryFileSink(), inputs: memoryFileSource({}), now: () => Date.now() });
const titles = (ws: MemoryWorkspace) => ws.tabs().map((t) => `${t.title}:${t.kind}`);
const codes = (r: RunReport, code: string) => r.entries.filter((e) => e.code === code);
const THREE = 'nový díl "Deska"\nkvádr 100 50 10\nnový díl "Čep"\nválec 5 30\nnová sestava "S"\nvložit "Deska" v 0 0 0\nvložit "Čep" v 20 20 10';

const noHooks: RunHooks = { opStart: () => undefined, opEnd: () => undefined };
/** běh jako `mncad run - --formats none` (cli/job.ts handleRun bez vlákna): engine + závěr CLI → RunReport */
async function cliRun(ws: MemoryWorkspace, script: string, host: EngineHost, o: { resume?: boolean } = {}): Promise<RunReport> {
  const rb = new ReportBuilder({ lang: "cs", lines: scriptLines(script), strict: false });
  if (o.resume) rb.code("session.history");
  await engineRun(ws, script, host, rb, { strict: false, open: [], allowEmpty: !!o.resume }, noHooks);
  const fin = await finishRun(ws, host, rb, { formats: "none", allDocs: false, noOutputOnError: false, share: false, strict: false }, noHooks);
  return rb.finish({ docs: fin.docs, files: [] });
}

describe("opakovaný běh – nový díl \"A\" použije záložku dřívějšího běhu (engine/runs.ts)", () => {
  it("3 dokumenty dvakrát: stejné záložky, ℹ doc.reused u každého, prvky nezdvojené, zpět vrátí obsah 1. běhu", async () => {
    const ws = new MemoryWorkspace();
    const r1 = await runScript(ws, THREE, hostOf());
    expect(titles(ws)).toEqual(["Deska:part", "Čep:part", "S:assembly"]);
    expect(codes(r1, "doc.reused")).toHaveLength(0);
    const r2 = await runScript(ws, THREE, hostOf());
    expect(titles(ws)).toEqual(["Deska:part", "Čep:part", "S:assembly"]);
    expect(codes(r2, "doc.reused").map((e) => `L${e.line} ${e.doc}`)).toEqual(["L1 Deska", "L3 Čep", "L5 S"]);
    expect(formatConsole(r2)).toMatch(/✓ nový díl „Deska“ – znovu použitá záložka z dřívějšího běhu\nℹ řádek 1: záložka „Deska“ z dřívějšího běhu použita znovu/);
    // dokumenty: jeden prvek, sestava se dvěma komponentami (ne čtyřmi), komponenty míří na díly tohoto běhu
    const docs = ws.tabs().map((t) => ws.docOf(t.id)!);
    expect(docs.map((d) => d.features.length)).toEqual([1, 1, 0]);
    expect(docs[2].components?.map((c) => c.name)).toEqual(["Deska", "Čep"]);
    expect(r2.counts.errors).toBe(0);
    // jeden krok historie na převzatou záložku: zpět = obsah 1. běhu (sestava je aktivní)
    expect(ws.historyDepth().undo).toBe(1);
    ws.undo(1);
    expect(ws.present().components).toHaveLength(2);
    expect(ws.present().components![0].source.kind).toBe("part");
  });

  it("třetí běh s `nový` = nová záložka; `znovu` převezme i záložku, kterou běh nezaložil; cizí záložka jinak zůstane (ℹ doc.name-taken)", async () => {
    const ws = new MemoryWorkspace();
    await runScript(ws, 'nový díl "A"\nkvádr 1 1 1', hostOf());
    const rn = await runScript(ws, 'nový díl "A" nový\nkvádr 2 2 2', hostOf());
    expect(titles(ws)).toEqual(["A:part", "A:part"]);
    expect(codes(rn, "doc.reused")).toHaveLength(0);
    // záložka otevřená mimo běh (soubor, ruční práce) – stejný název
    const ws2 = new MemoryWorkspace();
    await ws2.openInTab({ ...emptyDoc("B"), features: [{ id: "u1", name: "Kvádr 1", type: "box", size: [5, 5, 5], position: [0, 0, 0], centered: false, mode: "new" }] as CadDoc["features"] });
    const rt = await runScript(ws2, 'nový díl "B"\nkvádr 1 1 1', hostOf());
    expect(titles(ws2)).toEqual(["B:part", "B:part"]);
    expect(codes(rt, "doc.name-taken").map((e) => e.line)).toEqual([1]);
    expect(ws2.docOf(ws2.tabs()[0].id)!.features[0].id).toBe("u1"); // obsah uživatele beze změny
    const ws3 = new MemoryWorkspace();
    await ws3.openInTab({ ...emptyDoc("C"), features: [{ id: "u2", name: "Kvádr 1", type: "box", size: [5, 5, 5], position: [0, 0, 0], centered: false, mode: "new" }] as CadDoc["features"] });
    const rz = await runScript(ws3, 'nový díl "C" znovu\nkvádr 1 1 1', hostOf());
    expect(titles(ws3)).toEqual(["C:part"]);
    expect(codes(rz, "doc.reused")).toHaveLength(1);
    expect(ws3.present().features.map((f) => f.id)).not.toContain("u2");
  });

  it("dvakrát `nový díl \"A\"` v jednom skriptu = dvě záložky i po opakování; jiný druh (sestava „A“) se nepřevezme; bez názvu vždy nový", async () => {
    const ws = new MemoryWorkspace();
    const twice = 'nový díl "A"\nkvádr 1 1 1\nnový díl "A"\nkvádr 2 2 2';
    await runScript(ws, twice, hostOf());
    await runScript(ws, twice, hostOf());
    expect(titles(ws)).toEqual(["A:part", "A:part"]);
    await runScript(ws, 'nová sestava "A"', hostOf());
    expect(titles(ws)).toEqual(["A:part", "A:part", "A:assembly"]);
    await runScript(ws, "nový díl\nkvádr 1 1 1", hostOf());
    await runScript(ws, "nový díl\nkvádr 1 1 1", hostOf());
    expect(titles(ws).slice(3)).toEqual(["Nový díl:part", "Nový díl 2:part"]);
  });

  it("CLI --resume: relace nese záložky běhů (`made`) – druhý běh nad relací má 3 dokumenty, ne 6; starší relace bez `made` = nové záložky", async () => {
    const ws = new MemoryWorkspace();
    const r1 = await cliRun(ws, THREE, hostOf());
    expect(r1.docs.map((d) => d.name)).toEqual(["Deska", "Čep", "S"]);
    const saved = ws.save();
    expect(JSON.parse(new TextDecoder().decode(saved)).made).toEqual([0, 1, 2]);
    const ws2 = loadWorkspace(saved);
    const r2 = await cliRun(ws2, THREE, hostOf(), { resume: true });
    expect(r2.docs.map((d) => d.name)).toEqual(["Deska", "Čep", "S"]);
    expect(codes(r2, "doc.reused")).toHaveLength(3);
    // relace z dřívější verze (bez pole `made`): nic se nepřevezme, dokument v nové záložce + ℹ doc.name-taken
    const old = JSON.parse(new TextDecoder().decode(saved));
    delete old.made;
    const ws3 = loadWorkspace(new TextEncoder().encode(JSON.stringify(old)));
    const r3 = await cliRun(ws3, THREE, hostOf(), { resume: true });
    expect(r3.docs).toHaveLength(6);
    expect(codes(r3, "doc.name-taken")).toHaveLength(3);
  });

  it("B1: prázdná sestava běhu je vlastní záložka a má řádek D; B2: 27× nový díl = 27 záložek a 27 řádků D s čísly", async () => {
    const ws = new MemoryWorkspace();
    const r1 = await cliRun(ws, 'nová sestava "Prázdná"', hostOf());
    expect(r1.docs.map(docLine)).toEqual(['D "Prázdná" asm comp=0 parts=0 V.sum=-']);
    const r2 = await cliRun(ws, 'nový díl "Po"\nkvádr 1 1 1', hostOf());
    expect(titles(ws)).toEqual(["Prázdná:assembly", "Po:part"]);
    expect(r2.docs.map((d) => d.name)).toEqual(["Po"]); // prázdná sestava dřívějšího běhu bez změny = bez řádku D
    const ws2 = new MemoryWorkspace();
    const r = await cliRun(ws2, Array.from({ length: 27 }, (_, i) => `nový díl D${i + 1}\nkvádr 1 1 ${i + 1}`).join("\n"), hostOf());
    expect(ws2.tabs()).toHaveLength(27);
    expect(r.docs).toHaveLength(27);
    for (const d of r.docs) expect(docLine(d), d.name).toMatch(/^D "D\d+" part feat=1\/0\/0 V=1cm3 m=0\.008kg bbox=10x10x10$/);
  });
});

describe("protokol v prohlížeči = CLI (engine/run-protocol.ts)", () => {
  it("scriptLineCount = CLI scriptLines; neznámý protokol = chyba; console = text konzole", async () => {
    for (const t of ["", "a", "a\n", "a\nb", "a\r\nb\r\n", "\n\n"]) expect(scriptLineCount(t), JSON.stringify(t)).toBe(scriptLines(t));
    const r = await runReport(new MemoryWorkspace(), 'nový díl "P"\nkvádr 10 10 10', hostOf());
    expect(formatRun(r)).toBe(r.console);
    expect(() => formatRun(r, { protocol: "brief" as never })).toThrow(/neznámý protokol „brief“ – console, short, full, json/);
    const short = formatRun(r, { protocol: "short" });
    for (const l of short.split("\n")) expect(Object.values(GRAMMAR).some((re) => re.test(l)), l).toBe(true);
    expect(short).toMatch(/^MNCAD\/1 OK lines=2 ops=2 err=0 warn=0 note=\d+ t=[\d.]+\nD "P" part feat=1\/0\/0 V=1cm3 m=0\.008kg bbox=10x10x10\nΣ docs=1 V=1cm3 m=0\.008kg files=0 t=/);
    const j = JSON.parse(formatRun(r, { protocol: "json" })) as RunReport;
    expect(j.protocol).toBe(short);
    expect(j.full).toBe(formatRun(r, { protocol: "full" }));
    expect(j).not.toHaveProperty("console");
  });
});

describe("se skutečným jádrem: řádky D všech dokumentů běhu, objemy po opakování, prohlížeč = CLI", async () => {
  setHostAssets({ font: async (name) => new Uint8Array(fs.readFileSync(path.join(FONTS, name))).buffer });
  const { inProcessTransport } = await import("../kernel-inprocess");
  const kernel = makeKernelClient(inProcessTransport({ locateFile: (file) => (file.endsWith(".wasm") ? WASM : file) }));
  await kernel.init();
  const strip = (s: string) => s.replace(/ t=[\d.]+/g, "").replace(/ slow=\S+/g, "").replace(/ mem=\d+MB/g, "");

  it("díl + sestava: řádek D dílu má feat/V/m/bbox (dřív `V=- bbox=-`)", async () => {
    const r = await cliRun(new MemoryWorkspace(), 'nový díl Deska\nkvádr 100 50 10\nnová sestava S\nvložit "Deska" v 0 0 0\n', hostOf(kernel));
    expect(r.docs.map(docLine)).toEqual(['D "Deska" part feat=1/0/0 V=50cm3 m=0.392kg bbox=100x50x10', 'D "S" asm comp=1 parts=1 V.sum=50cm3 m=0.39kg bbox=100x50x10']);
  }, 240_000);

  it("3 dokumenty dvakrát (CLI --resume): stejné řádky D a objemy", async () => {
    const ws = new MemoryWorkspace();
    const r1 = await cliRun(ws, THREE, hostOf(kernel));
    const r2 = await cliRun(loadWorkspace(ws.save()), THREE, hostOf(kernel), { resume: true });
    const lines = r1.docs.map(docLine);
    expect(lines[0]).toBe('D "Deska" part feat=1/0/0 V=50cm3 m=0.392kg bbox=100x50x10');
    expect(lines[1]).toMatch(/^D "Čep" part feat=1\/0\/0 V=0\.59cm3 m=0\.005kg bbox=5x5x30$/);
    expect(lines[2]).toBe('D "S" asm comp=2 parts=2 V.sum=50.59cm3 m=0.4kg bbox=100x50x40');
    expect(r2.docs.map(docLine)).toEqual(r1.docs.map(docLine));
  }, 240_000);

  it("stručný protokol enginu (prohlížeč) = CLI `--formats none` kromě t= / slow= / mem=", async () => {
    for (const script of [THREE, `${THREE}\nkolize\nstav`, "nový díl A\nkvádr 10 10 10\nzaoblit 50 hrany svislé\nnový díl B\nválec 5 10", 'nová sestava "E"']) {
      const cli = finalizeReport(await cliRun(new MemoryWorkspace(), script, hostOf(kernel))).protocol;
      const web = formatRun(await runReport(new MemoryWorkspace(), script, hostOf(kernel)), { protocol: "short" });
      expect(strip(web), script).toBe(strip(cli));
    }
  }, 480_000);
});
