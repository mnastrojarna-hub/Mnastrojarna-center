/**
 * `mncad serve` v procesu testu: tělo požadavku (400) a bezpečnost (401/403/415/413) nad skutečným HTTP serverem,
 * vlákno běhu je falešné (stejný protokol zpráv jako job.ts, bez jádra). Relace, frontu, nečinnost a skutečné jádro
 * ověřuje e2e/cad-cli.e2e.cjs na sestaveném svazku.
 */
import fs from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { parseArgs, type ServeArgs } from "./args";
import type { Io } from "./main";
import { parseRunBody, startServer, type ServerHandle } from "./serve";

const FAKE = `
import { parentPort, workerData } from "node:worker_threads";
parentPort.postMessage({ t: "ready", ms: 1, mem: { heapMB: 1, jsMB: 1, rssMB: 1 } });
parentPort.on("message", (m) => {
  if (m.t === "close") return parentPort.close();
  if (m.t !== "run") return;
  if (m.req.script === "busy") { parentPort.postMessage({ t: "op-start", id: m.id, line: 1, op: "feature:box" }); const t = Date.now(); while (Date.now() - t < 60000) {} }
  const n = Object.keys(m.req.inputs.files).length;
  const many = m.req.script === "many" ? Array.from({ length: 300 }, (_, i) => ({ line: i + 1, level: "error", code: "parse.unknown", text: "neznámý příkaz x" + i })) : [];
  const report = { v: 1, ok: !many.length, strict: false, ms: 1, lang: m.req.lang, counts: { lines: 1, ops: 0, ok: 0, notes: 0, warnings: 0, errors: many.length }, entries: many, docs: [{ ref: "lang=" + workerData.lang, name: "files=" + n + " session=" + (m.req.resume ? "restored" : "none"), kind: "part" }], files: [], timing: [], peakMB: 1, protocol: "" };
  parentPort.postMessage({ t: "done", id: m.id, report, files: [{ file: { name: "x.step", format: "step", bytes: 3, sha256: "00", doc: "D" }, data: new Uint8Array([1, 2, 3]) }], session: new Uint8Array([7]), mem: { heapMB: 1, jsMB: 1, rssMB: 1 } });
});
`;
const TOKEN = "k".repeat(40);
let dir: string;
let h: ServerHandle;
const io = (): Io => ({ stdout: () => undefined, stderr: () => undefined, readStdin: async () => "", cwd: dir, env: {}, entry: pathToFileURL(path.join(dir, "fake-job.mjs")).href });

function req(method: string, p: string, o: { body?: string; headers?: Record<string, string>; server?: ServerHandle; addr?: string } = {}): Promise<{ status: number; json: unknown }> {
  const port = (o.server ?? h).port;
  const addr = o.addr ?? "127.0.0.1";
  return new Promise((resolve, reject) => {
    const r = http.request({ host: addr, port, method, path: p, headers: { host: `${addr}:${port}`, authorization: `Bearer ${TOKEN}`, ...(o.body !== undefined ? { "content-type": "application/json", "content-length": String(Buffer.byteLength(o.body)) } : {}), ...o.headers } }, (res) => {
      let d = "";
      res.on("data", (c) => (d += c));
      res.on("end", () => resolve({ status: res.statusCode!, json: d ? JSON.parse(d) : null }));
    });
    r.on("error", reject);
    if (o.body !== undefined) r.write(o.body);
    r.end();
  });
}

beforeAll(async () => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "mncad-serve-"));
  fs.writeFileSync(path.join(dir, "fake-job.mjs"), FAKE);
  fs.writeFileSync(path.join(dir, "token"), TOKEN, { mode: 0o600 });
  fs.chmodSync(path.join(dir, "token"), 0o600);
  h = await startServer(parseArgs(["serve", "--port", "0", "--token-file", path.join(dir, "token")]) as ServeArgs, io());
});
afterAll(async () => {
  await h?.close();
  fs.rmSync(dir, { recursive: true, force: true });
});

describe("tělo POST /run", () => {
  it("převede platné tělo; strict jako pole kódů = výjimky", () => {
    const r = parseRunBody({ script: "kvádr 1 1 1", strict: ["clash.real"], formats: ["step", "pdf"], files: { "ref.step": Buffer.from("ISO").toString("base64") }, session: "a_b-1", timeoutSec: 60, lang: "de" });
    expect(r.strict).toEqual({ except: ["clash.real"] });
    expect(new TextDecoder().decode(r.files["ref.step"])).toBe("ISO");
  });
  it("400: neznámé pole, špatné typy, název vstupu s cestou, neplatná relace, neznámý formát", () => {
    const bad: unknown[] = [
      null,
      [],
      { script: 1 },
      { script: "", nope: 1 },
      { script: "", files: { "../x": "AA==" } },
      { script: "", files: { "a/b.step": "AA==" } },
      { script: "", files: { "a.step": "***" } },
      { script: "", session: "../x" },
      { script: "", formats: ["docx"] },
      { script: "", return: "disk" },
      { script: "", timeoutSec: 0 },
      { script: "", share: { days: 365 } },
      { script: "", lang: "fr" },
      { script: "", open: "a.mncad" },
    ];
    for (const b of bad) expect(() => parseRunBody(b), JSON.stringify(b)).toThrow();
  });
});

describe("server (falešné vlákno běhu)", () => {
  it("401 bez tokenu, 403 Origin / Host, 415 text/plain, 400 JSON, 404, 405", async () => {
    expect((await req("GET", "/health", { headers: { authorization: "" } })).status).toBe(401);
    expect((await req("GET", "/health", { headers: { origin: "https://evil.example" } })).status).toBe(403);
    expect((await req("GET", "/health", { headers: { host: `evil.example:${h.port}` } })).status).toBe(403);
    expect((await req("POST", "/run", { body: "x", headers: { "content-type": "text/plain" } })).status).toBe(415);
    expect((await req("POST", "/run", { body: "{x" })).status).toBe(400);
    expect((await req("GET", "/nope")).status).toBe(404);
    expect((await req("PUT", "/run")).status).toBe(405);
  });
  it("200 s base64 souborů; relace připnutá k vláknu; při --jobs 1 jiná relace uvolní volné vlákno a relace se pak obnoví z ws.save()", async () => {
    const r1 = await req("POST", "/run", { body: JSON.stringify({ script: "", files: { "a.mncad": "AA==" }, session: "s" }) });
    expect(r1.status).toBe(200);
    const j1 = r1.json as { files: { base64: string }[]; docs: { name: string }[]; protocol: string };
    expect(j1.files[0].base64).toBe("AQID");
    expect(j1.docs[0].name).toBe("files=1 session=none");
    expect(j1.protocol).toMatch(/^MNCAD\/1 OK/);
    const r2 = await req("POST", "/run", { body: JSON.stringify({ script: "", session: "s" }) });
    expect((r2.json as { docs: { name: string }[] }).docs[0].name).toBe("files=0 session=none"); // stejné vlákno – relace v něm žije
    expect(h.stats()).toMatchObject({ threads: 1, sessions: 1 });
    const r3 = await req("POST", "/run", { body: JSON.stringify({ script: "", session: "t" }) });
    expect((r3.json as { docs: { name: string }[] }).docs[0].name).toBe("files=0 session=none");
    const r4 = await req("POST", "/run", { body: JSON.stringify({ script: "", session: "s" }) });
    expect((r4.json as { docs: { name: string }[] }).docs[0].name).toBe("files=0 session=restored"); // nové vlákno, relace z paměti serveru
    expect(h.stats()).toMatchObject({ threads: 1, sessions: 2 });
    expect((await req("DELETE", "/session/s")).status).toBe(204);
    expect((await req("DELETE", "/session/s")).status).toBe(404);
    const r5 = await req("POST", "/run", { body: JSON.stringify({ script: "" }) });
    expect(r5.status).toBe(200);
  });
  it("DELETE /session s chybným kódováním % nebo neplatným id → 400 (ne 500)", async () => {
    expect((await req("DELETE", "/session/%E0%A4%A")).status).toBe(400);
    expect((await req("DELETE", "/session/a%2Fb")).status).toBe(400);
    expect((await req("DELETE", "/session/neni")).status).toBe(404);
  });
  it("relace v jiném jazyce se obnoví v novém vlákně toho jazyka (mezipaměť jádra nemíchá jazyky)", async () => {
    const r1 = await req("POST", "/run", { body: JSON.stringify({ script: "", session: "L", lang: "de" }) });
    expect((r1.json as { docs: { ref: string; name: string }[] }).docs[0]).toMatchObject({ ref: "lang=de", name: "files=0 session=none" });
    const r2 = await req("POST", "/run", { body: JSON.stringify({ script: "", session: "L", lang: "cs" }) });
    expect((r2.json as { docs: { ref: string; name: string }[] }).docs[0]).toMatchObject({ ref: "lang=cs", name: "files=0 session=restored" });
    const r3 = await req("POST", "/run", { body: JSON.stringify({ script: "", session: "L", lang: "cs" }) });
    expect((r3.json as { docs: { ref: string; name: string }[] }).docs[0]).toMatchObject({ ref: "lang=cs", name: "files=0 session=none" }); // stejné vlákno
    expect((await req("DELETE", "/session/L")).status).toBe(204);
  });
});

describe("serve --out: protocol-full.txt a složka relace", () => {
  let h2: ServerHandle;
  let out: string;
  beforeAll(async () => {
    out = path.join(dir, "sout");
    fs.mkdirSync(out, { recursive: true });
    h2 = await startServer(parseArgs(["serve", "--port", "0", "--token-file", path.join(dir, "token"), "--out", out]) as ServeArgs, io());
  });
  afterAll(async () => h2?.close());
  it("přebytek protokolu: symbolický odkaz protocol-full.txt se nahradí, jeho cíl zůstane netknutý", async () => {
    const sx = path.join(out, "session-x");
    fs.mkdirSync(sx, { recursive: true });
    const victim = path.join(dir, "victim.txt");
    fs.writeFileSync(victim, "PŮVODNÍ");
    fs.symlinkSync(victim, path.join(sx, "protocol-full.txt"));
    const r = await req("POST", "/run", { server: h2, body: JSON.stringify({ script: "many", session: "x", return: "paths", formats: "none" }) });
    expect(r.status).toBe(200);
    const pf = (r.json as { files: { name: string; path: string }[] }).files.find((f) => f.name === "protocol-full.txt")!;
    expect(pf.path).toBe(path.join(fs.realpathSync(out), "session-x", "protocol-full.txt"));
    expect(fs.readFileSync(victim, "utf8")).toBe("PŮVODNÍ");
    expect(fs.lstatSync(pf.path).isSymbolicLink()).toBe(false);
    expect(fs.readFileSync(pf.path, "utf8")).toMatch(/^MNCAD\/1 FAIL lines=1/);
  });
  it("složka relace jako odkaz mimo --out → 400, nic se nezapíše", async () => {
    const elsewhere = path.join(dir, "elsewhere");
    fs.mkdirSync(elsewhere, { recursive: true });
    fs.symlinkSync(elsewhere, path.join(out, "session-y"));
    const r = await req("POST", "/run", { server: h2, body: JSON.stringify({ script: "many", session: "y", return: "paths", formats: "none" }) });
    expect(r.status).toBe(400);
    expect((r.json as { message: string }).message).toMatch(/mimo --out/);
    expect(fs.readdirSync(elsewhere)).toEqual([]);
  });
});

describe("serve – ukončení a místní adresa", () => {
  it("close() s běžícím požadavkem: přeruší ho (500, ✗ run.interrupted), čekající ve frontě 503, skončí do 3 s", async () => {
    const h3 = await startServer(parseArgs(["serve", "--port", "0", "--token-file", path.join(dir, "token"), "--jobs", "1"]) as ServeArgs, io());
    const busy = req("POST", "/run", { server: h3, body: JSON.stringify({ script: "busy", formats: "none" }) });
    await new Promise((r) => setTimeout(r, 300));
    const queued = req("POST", "/run", { server: h3, body: JSON.stringify({ script: "", formats: "none" }) });
    await new Promise((r) => setTimeout(r, 200));
    expect(h3.stats()).toMatchObject({ busy: 1, queue: 1 });
    const t0 = Date.now();
    await h3.close();
    const ms = Date.now() - t0;
    const [b, q] = await Promise.all([busy, queued]);
    expect(b.status).toBe(500);
    expect((b.json as { entries: { code: string; line: number | null }[] }).entries.at(-1)).toMatchObject({ code: "run.interrupted", line: 1 });
    expect(q.status).toBe(503);
    expect(ms).toBeLessThan(3000);
  });
  it("--host 127.0.0.2: požadavek na ohlášenou adresu projde (Host 127.0.0.2:port)", async () => {
    const h4 = await startServer(parseArgs(["serve", "--host", "127.0.0.2", "--port", "0", "--token-file", path.join(dir, "token")]) as ServeArgs, io());
    try {
      expect(h4.url).toBe(`http://127.0.0.2:${h4.port}`);
      expect((await req("GET", "/health", { server: h4, addr: "127.0.0.2" })).status).toBe(200);
    } finally {
      await h4.close();
    }
  });
});
