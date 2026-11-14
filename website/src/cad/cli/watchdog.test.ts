/**
 * Hlídač bez jádra: falešné vlákno běhu (stejný protokol zpráv jako job.ts) – limit času uprostřed synchronní práce,
 * pád (výjimka, process.exit), paměť (hlášení po operaci i čtení RSS), přerušení a skládání protokolu z posledního
 * stavu. Skutečné jádro (OCCT) ve vlákně ověřuje e2e/cad-cli.e2e.cjs na sestaveném svazku.
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { GRAMMAR, formatShort } from "../engine/protocol";
import type { RunReport } from "../engine/protocol-types";
import type { JobRequest } from "./job";
import { exitCodeFor, httpStatusFor, JobThread, scriptLines, type Outcome } from "./watchdog";

const FAKE = `
import { parentPort, workerData } from "node:worker_threads";
const mode = workerData.fault;
const mem = (h = 100, r = 200) => ({ heapMB: h, jsMB: 10, rssMB: r });
if (mode !== "noready") parentPort.postMessage({ t: "ready", ms: 1, mem: mem() });
parentPort.on("message", (m) => {
  if (m.t === "close") return parentPort.close();
  if (m.t === "selftest") { const t = Date.now(); while (Date.now() - t < 60000) {} }
  if (m.t !== "run") return;
  const id = m.id;
  parentPort.postMessage({ t: "op-start", id, line: 3, op: "feature:box" });
  parentPort.postMessage({ t: "op-end", id, line: 3, op: "feature:box", ms: 5, entries: [{ line: 3, level: "warn", code: "select.ambiguous", text: "více ploch" }], files: [{ name: "a.step", format: "step", bytes: 10, sha256: "00", doc: "D" }], mem: mem() });
  parentPort.postMessage({ t: "op-start", id, line: 7, op: "clash" });
  if (mode === "busy") { const t = Date.now(); while (Date.now() - t < 60000) {} }
  // halda WASM roste uprostřed jednoho dlouhého volání (jako háček grow v node-shims.ts) – bez zprávy op-end
  if (mode === "grow") { Atomics.store(new Int32Array(workerData.memSab), 0, 900); const t = Date.now(); while (Date.now() - t < 60000) {} }
  if (mode === "throw") throw new Error("boom");
  if (mode === "exit") process.exit(9);
  if (mode === "mem") { parentPort.postMessage({ t: "op-end", id, line: 7, op: "clash", ms: 1, entries: [], files: [], mem: mem(900, 300) }); const t = Date.now(); while (Date.now() - t < 60000) {} }
  if (mode === "done") {
    parentPort.postMessage({ t: "op-end", id, line: 7, op: "clash", ms: 1, entries: [], files: [], mem: mem() });
    const report = { v: 1, ok: true, strict: false, ms: 3, lang: "cs", counts: { lines: 7, ops: 2, ok: 0, notes: 0, warnings: 1, errors: 0 }, entries: [{ line: 3, level: "warn", code: "select.ambiguous", text: "více ploch" }], docs: [], files: [], timing: [], peakMB: 200, protocol: "" };
    parentPort.postMessage({ t: "done", id, report, files: [], session: new Uint8Array([1, 2]), mem: mem() });
  }
});
`;

let dir: string;
let entry: string;
beforeAll(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "mncad-wd-"));
  entry = path.join(dir, "fake-job.mjs");
  fs.writeFileSync(entry, FAKE);
});
afterAll(() => fs.rmSync(dir, { recursive: true, force: true }));

const req = (): JobRequest => ({ script: "a\nb\nc\nd\ne\nf\ng\n", lang: "cs", strict: false, open: [], formats: "auto", allDocs: false, noOutputOnError: false, share: false, inputs: { kind: "memory", files: {} }, out: { kind: "memory" }, saveSession: false });
const thread = (fault: string, maxMemMB = 0, rssGuard = false) => new JobThread({ entry: pathToFileURL(entry).href, init: { lang: "cs", version: "test", fontsDir: null, fault }, maxMemMB, rssGuard });
const report = (o: Outcome) => (o as { report: RunReport }).report;

describe("hlídač vlákna běhu", () => {
  it("časový limit uprostřed synchronní práce: terminate() do 1 s, ✗ run.timeout na rozpracovaném řádku, poslední stav zachován", async () => {
    const t = thread("busy");
    await t.ready;
    const deadline = Date.now() + 400;
    const o = await t.run(req(), { deadline, timeoutSec: 7, lang: "cs" });
    const late = Date.now() - deadline;
    expect(o.kind).toBe("timeout");
    expect(late).toBeLessThan(1000);
    const r = report(o);
    expect(r.entries.map((e) => [e.line, e.code])).toEqual([
      [3, "select.ambiguous"],
      [7, "run.timeout"],
    ]);
    expect(r.entries[1].text).toBe("časový limit 7 s vypršel");
    expect(r.counts).toMatchObject({ lines: 7, ops: 1, errors: 1, warnings: 1 });
    expect(r.files).toEqual([expect.objectContaining({ name: "a.step", run: "fail" })]);
    expect(exitCodeFor(o)).toBe(5);
    expect(httpStatusFor(o)).toBe(504);
    const text = formatShort(r);
    expect(text.split("\n")[0]).toMatch(GRAMMAR.header);
    expect(text).toContain("✗ L7 run.timeout");
    expect(text).toContain('F step "a.step" 10B run=fail');
    await new Promise((res) => t.worker.once("exit", res));
    expect(t.dead).toBe(true);
  });
  it("limit času ještě před připraveností jádra → L- (init)", async () => {
    const t = thread("noready");
    const o = await t.run(req(), { deadline: Date.now() + 200, timeoutSec: 1, lang: "en" });
    expect(o.kind).toBe("timeout");
    expect(report(o).entries).toEqual([expect.objectContaining({ line: null, code: "run.timeout", data: { op: "init", detail: "1 s" } })]);
  });
  it("pád vlákna (výjimka) → run.crash, kód 4", async () => {
    const o = await thread("throw").run(req(), { deadline: null, timeoutSec: 0, lang: "cs" });
    expect(o.kind).toBe("crash");
    expect(report(o).entries.at(-1)).toMatchObject({ line: 7, code: "run.crash" });
    expect(report(o).entries.at(-1)!.text).toMatch(/boom/);
    expect(exitCodeFor(o)).toBe(4);
    expect(httpStatusFor(o)).toBe(500);
  });
  it("konec vlákna (process.exit) bez výsledku → run.crash s kódem vlákna", async () => {
    const o = await thread("exit").run(req(), { deadline: null, timeoutSec: 0, lang: "cs" });
    expect(o.kind).toBe("crash");
    expect((o as { detail: string }).detail).toBe("exit code 9");
  });
  it("paměť hlášená po operaci (WASM + JS vlákna) nad limit → run.memory, kód 6", async () => {
    const o = await thread("mem", 500).run(req(), { deadline: null, timeoutSec: 0, lang: "cs" });
    expect(o.kind).toBe("memory");
    expect(report(o).entries.at(-1)).toMatchObject({ code: "run.memory", text: "překročen limit paměti 500 MB" });
    expect(report(o).peakMB).toBeGreaterThanOrEqual(900);
    expect(exitCodeFor(o)).toBe(6);
    expect(httpStatusFor(o)).toBe(507);
  });
  it("serve: halda WASM ze sdílené paměti (háček grow) během jednoho dlouhého volání nad limit → run.memory do 1 s, peakMB", async () => {
    const t = thread("grow", 500);
    await t.ready;
    const t0 = Date.now();
    const o = await t.run(req(), { deadline: Date.now() + 30_000, timeoutSec: 30, lang: "cs" });
    expect(o.kind).toBe("memory");
    expect(Date.now() - t0).toBeLessThan(1000);
    expect(report(o).entries.at(-1)).toMatchObject({ line: 7, code: "run.memory", data: { op: "clash", detail: "wasm 900 MB + js 10 MB" } });
    expect(report(o).peakMB).toBeGreaterThanOrEqual(900);
    expect(t.interruption).toBe("memory");
  });
  it("selftest: limit času = zásah hlídače (interruption timeout → kód 5)", async () => {
    const t = thread("done");
    await expect(t.selftest(300)).rejects.toThrow();
    expect(t.interruption).toBe("timeout");
  });
  it("RSS procesu čtené během dlouhé práce (mncad run) nad limit → run.memory", async () => {
    const t = thread("busy", 1, true);
    const o = await t.run(req(), { deadline: Date.now() + 20_000, timeoutSec: 20, lang: "cs" });
    expect(o.kind).toBe("memory");
  });
  it("Ctrl+C → run.interrupted, kód 130", async () => {
    const t = thread("busy");
    await t.ready;
    const p = t.run(req(), { deadline: null, timeoutSec: 0, lang: "cs" });
    setTimeout(() => void t.interrupt(), 150);
    const o = await p;
    expect(o.kind).toBe("interrupted");
    expect(report(o).entries.at(-1)).toMatchObject({ line: 7, code: "run.interrupted" });
    expect(exitCodeFor(o)).toBe(130);
  });
  it("hotový běh projde beze změny; kódy podle reportu (0 / 1 / 2) a řádné ukončení vlákna", async () => {
    const t = thread("done");
    const o = await t.run(req(), { deadline: Date.now() + 10_000, timeoutSec: 10, lang: "cs" });
    expect(o.kind).toBe("done");
    expect((o as { session: Uint8Array }).session).toEqual(new Uint8Array([1, 2]));
    expect(exitCodeFor(o)).toBe(0);
    const r = report(o);
    expect(exitCodeFor({ kind: "done", report: { ...r, counts: { ...r.counts, errors: 1 } }, files: [] })).toBe(1);
    expect(exitCodeFor({ kind: "done", report: { ...r, stopped: { line: 3, code: "select.ambiguous" } }, files: [] })).toBe(2);
    expect(exitCodeFor({ kind: "failed", error: "x" })).toBe(3);
    // přísný běh: ⚠ mimo výjimky je vždy 2 (pojistka i bez `stopped`); výjimka kódu → 0; nepřísně ⚠ → 0
    expect(exitCodeFor(o, true)).toBe(2);
    expect(exitCodeFor(o, { except: ["select.ambiguous"] })).toBe(0);
    expect(exitCodeFor(o, false)).toBe(0);
    await t.close();
    expect(t.dead).toBe(true);
  });
  it("počet řádků skriptu", () => {
    expect(scriptLines("")).toBe(0);
    expect(scriptLines("a")).toBe(1);
    expect(scriptLines("a\n")).toBe(1);
    expect(scriptLines("a\r\nb\r\n")).toBe(2);
    expect(scriptLines("a\n\nb")).toBe(3);
  });
});
