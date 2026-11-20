/**
 * Vlna 22, bod 12 – úlohy `mncad serve` (kritik: „12 šlo dokázat během – souběžné požadavky, zrušení“; „HTTP bez zrušení
 * úlohy“): souběžné `POST /run` nad jedním vláknem se řadí (druhý čeká), každý má id úlohy (`x-mncad-run`, `report.run`),
 * `GET /runs` ukáže stav, `DELETE /run/<id>` zruší čekající (nic se neprovede) i běžící úlohu (vlákno se přeruší,
 * ✗ run.cancelled). Vlákno běhu je falešné (stejný protokol zpráv jako job.ts, bez jádra) – skutečné jádro ověřuje
 * repro skript se svazkem CLI (S/w22/a/A3/serve-cancel.mjs) a e2e/cad-cli.e2e.cjs.
 */
import fs from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { parseArgs, type ServeArgs } from "./args";
import type { Io } from "./main";
import { startServer, type ServerHandle } from "./serve";

// „wait:<ms>“ = běh trvá ms (asynchronně), „busy“ = blokuje vlákno (zrušit jde jen ukončením vlákna)
const FAKE = `
import { parentPort } from "node:worker_threads";
parentPort.postMessage({ t: "ready", ms: 1, mem: { heapMB: 1, jsMB: 1, rssMB: 1 } });
parentPort.on("message", async (m) => {
  if (m.t === "close") return parentPort.close();
  if (m.t !== "run") return;
  const run = { id: m.req.runId, inputRev: "-@r·000000" };
  parentPort.postMessage({ t: "run", id: m.id, run });
  parentPort.postMessage({ t: "op-start", id: m.id, line: 1, op: "feature:box" });
  const w = /^wait:(\\d+)/.exec(m.req.script);
  if (w) await new Promise((r) => setTimeout(r, Number(w[1])));
  if (m.req.script === "busy") { const t = Date.now(); while (Date.now() - t < 60000) {} }
  const report = { v: 1, ok: true, strict: false, ms: 1, lang: m.req.lang, counts: { lines: 1, ops: 1, ok: 1, notes: 0, warnings: 0, errors: 0 }, entries: [{ line: 1, level: "ok", text: "hotovo " + m.req.script }], docs: [], files: [], timing: [], peakMB: 1, protocol: "", run: { ...run, state: "done" } };
  parentPort.postMessage({ t: "done", id: m.id, report, files: [], mem: { heapMB: 1, jsMB: 1, rssMB: 1 } });
});
`;
const TOKEN = "k".repeat(40);
let dir: string;
let h: ServerHandle;
const io = (): Io => ({ stdout: () => undefined, stderr: () => undefined, readStdin: async () => "", cwd: dir, env: {}, entry: pathToFileURL(path.join(dir, "fake-job.mjs")).href });

type Res = { status: number; json: Record<string, unknown> & { run?: Record<string, unknown>; runs?: Record<string, unknown>[]; entries?: { code?: string; level: string }[] }; headers: http.IncomingHttpHeaders };
function req(method: string, p: string, body?: unknown): Promise<Res> {
  const data = body === undefined ? undefined : JSON.stringify(body);
  return new Promise((resolve, reject) => {
    const r = http.request({ host: "127.0.0.1", port: h.port, method, path: p, headers: { host: `127.0.0.1:${h.port}`, authorization: `Bearer ${TOKEN}`, ...(data !== undefined ? { "content-type": "application/json", "content-length": String(Buffer.byteLength(data)) } : {}) } }, (res) => {
      let d = "";
      res.on("data", (c) => (d += c));
      res.on("end", () => resolve({ status: res.statusCode!, json: d ? JSON.parse(d) : {}, headers: res.headers }));
    });
    r.on("error", reject);
    if (data !== undefined) r.write(data);
    r.end();
  });
}
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
async function until(f: () => Promise<boolean>, ms = 5000) {
  const t0 = Date.now();
  while (!(await f())) {
    if (Date.now() - t0 > ms) throw new Error("timeout");
    await sleep(20);
  }
}
const stateOf = async (id: string) => ((await req("GET", `/run/${id}`)).json.run?.state as string | undefined) ?? "?";

beforeAll(async () => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "mncad-serve-runs-"));
  fs.writeFileSync(path.join(dir, "fake-job.mjs"), FAKE);
  fs.writeFileSync(path.join(dir, "token"), TOKEN, { mode: 0o600 });
  fs.chmodSync(path.join(dir, "token"), 0o600);
  h = await startServer(parseArgs(["serve", "--port", "0", "--jobs", "1", "--token-file", path.join(dir, "token")]) as ServeArgs, io());
});
afterAll(async () => {
  await h?.close();
  fs.rmSync(dir, { recursive: true, force: true });
});

describe("mncad serve – úlohy (id, stav, fronta, zrušení)", () => {
  it("dva souběžné požadavky nad jedním vláknem: druhý čeká, oba mají id (hlavička i report.run), stav v GET /runs", async () => {
    const p1 = req("POST", "/run", { script: "wait:400", id: "prvni" });
    await until(async () => (await stateOf("prvni")) === "running");
    const p2 = req("POST", "/run", { script: "wait:10", id: "druhy" });
    await until(async () => (await stateOf("druhy")) === "queued");
    const list = (await req("GET", "/runs")).json.runs!;
    expect(list.map((r) => [r.id, r.state])).toEqual(expect.arrayContaining([["prvni", "running"], ["druhy", "queued"]]));
    const [r1, r2] = await Promise.all([p1, p2]);
    expect(r1.status).toBe(200);
    expect(r1.headers["x-mncad-run"]).toBe("prvni");
    expect(r1.json.run).toMatchObject({ id: "prvni", state: "done" });
    expect(r2.json.run).toMatchObject({ id: "druhy", state: "done" });
    expect(String(r1.json.protocol)).toMatch(/\nΣ .* run=prvni$/);
    expect(await stateOf("prvni")).toBe("done");
  });

  it("DELETE čekající úlohy: její POST hned odpoví ✗ run.cancelled, nic se neprovede; běžící doběhne", async () => {
    const p1 = req("POST", "/run", { script: "wait:400", id: "a1" });
    await until(async () => (await stateOf("a1")) === "running");
    const p2 = req("POST", "/run", { script: "wait:10", id: "a2" });
    await until(async () => (await stateOf("a2")) === "queued");
    const del = await req("DELETE", "/run/a2");
    expect(del.status).toBe(200);
    expect(del.json.run).toMatchObject({ id: "a2", state: "cancelled" });
    const r2 = await p2;
    expect(r2.status).toBe(200);
    expect(r2.json.ok).toBe(false);
    expect(r2.json.run).toMatchObject({ id: "a2", state: "cancelled" });
    expect(r2.json.entries!.some((e) => e.code === "run.cancelled")).toBe(true);
    expect(r2.json.entries!.some((e) => e.level === "ok")).toBe(false); // žádné ✓ – skript se neprovedl
    const r1 = await p1;
    expect(r1.json.run).toMatchObject({ id: "a1", state: "done" });
  });

  it("DELETE běžící úlohy (vlákno blokované výpočtem): vlákno se ukončí, POST = ✗ run.cancelled, server běží dál", async () => {
    const p = req("POST", "/run", { script: "busy", id: "b1" });
    await until(async () => (await stateOf("b1")) === "running");
    const t0 = Date.now();
    const del = await req("DELETE", "/run/b1");
    expect(del.status).toBe(200);
    const r = await p;
    expect(Date.now() - t0).toBeLessThan(10_000);
    expect(r.status).toBe(200);
    expect(r.json.run).toMatchObject({ id: "b1", state: "cancelled" });
    expect(r.json.entries!.some((e) => e.code === "run.cancelled")).toBe(true);
    expect(await stateOf("b1")).toBe("cancelled");
    const again = await req("POST", "/run", { script: "wait:1" }); // nové vlákno
    expect(again.json.run).toMatchObject({ state: "done" });
    expect(String(again.headers["x-mncad-run"])).toMatch(/^j\d+$/);
  });

  it("DELETE neznámé / hotové úlohy: 404 / 409 se stavem", async () => {
    expect((await req("DELETE", "/run/neni")).status).toBe(404);
    const done = await req("DELETE", "/run/prvni");
    expect(done.status).toBe(409);
    expect((done.json.run as { state: string }).state).toBe("done");
    expect((await req("POST", "/run", { script: "x", id: "spatne id!" })).status).toBe(400);
  });
});
