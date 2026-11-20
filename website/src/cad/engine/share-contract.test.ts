/**
 * Smluvní test sdílení z Node (CAD-HEADLESS-NAVRH.md kap. 3.4, balík B3) – v CI na Node 22 i 24
 * (`PATH=/opt/node24/bin:$PATH npx vitest run src/cad/engine/share-contract.test.ts`):
 *  1. zachytávací server zaznamená hlavičky, které CLI posílá (obal `fetch` z cli/node-shims.ts): žádné `Origin` ani
 *     `Sec-Fetch-Site` (index.php by zápis s nimi odmítl – změna výchozích hlaviček undici by CLI odřízla), z hlaviček
 *     `Sec-Fetch-*` jen `Sec-Fetch-Mode: cors` (undici ji posílá vždy, Node 22 i 24 – index.php ji nečte; jakákoli další
 *     `Sec-Fetch-*` test shodí, aby se změna výchozích hlaviček zjistila dřív než na serveru), `User-Agent` je
 *     `mncad/<verze>`;
 *  2. `php -S` se skutečným public/cad/share/index.php: `sdílet úložiště` přes engine (`shareWithPolicy`, stejná cesta
 *     jako text `sdílet` i `--share`) → `mode: "self"`, krátký odkaz; `openShareLink` v Node otevře sestavu se stejným
 *     počtem komponent; odmítnutí serverem (cizí `Origin`) → ✗ share.rejected + ⚠ share.fallback-link.
 * Bez PHP se část 2 přeskočí.
 */
import { spawn, spawnSync, type ChildProcess } from "node:child_process";
import fs from "node:fs";
import http from "node:http";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import { afterAll, afterEach, describe, expect, it } from "vitest";
import { installNodeShims } from "../cli/node-shims";
import { setHostAssets } from "../host-assets";
import { openShareLink, parseShareHash, resetShareProbe, setUploadTimeoutBase } from "../share";
import { emptyDoc, type AsmComponent, type CadDoc } from "../types";
import { shareWithPolicy, type ShareNote } from "./share-out";

const PHP_OK = spawnSync("php", ["-v"], { stdio: "ignore" }).status === 0;
const SCRIPT = path.resolve(__dirname, "../../../public/cad/share/index.php");
const VERSION = "0.0.0-contract";
const T = 60_000;

const freePort = () =>
  new Promise<number>((resolve, reject) => {
    const s = net.createServer();
    s.once("error", reject);
    s.listen(0, "127.0.0.1", () => {
      const port = (s.address() as net.AddressInfo).port;
      s.close(() => resolve(port));
    });
  });

const part = (name: string, x: number): CadDoc => ({ ...emptyDoc(name), kind: "part", features: [{ id: "b1", name: "Kvádr 1", type: "box", size: [x, 10, 10], position: [0, 0, 0], centered: false, mode: "new" } as never] });
/** sestava s `n` komponentami (vložené díly) */
const assembly = (n: number): CadDoc => ({
  ...emptyDoc("Smluvní sestava"),
  kind: "assembly",
  features: [],
  components: Array.from({ length: n }, (_, i) => ({ id: `c${i}`, name: `Díl ${i % 3}`, source: { kind: "part", doc: part(`Díl ${i % 3}`, 10 + (i % 3)) }, placement: { position: [i * 20, 0, 0], rotation: [0, 0, 0] } }) as AsmComponent),
});

let restore: (() => void) | null = null;
afterEach(() => {
  restore?.();
  restore = null;
  setHostAssets({});
  resetShareProbe();
  setUploadTimeoutBase(20_000);
});

describe("smluvní test: hlavičky požadavků CLI na úložiště", () => {
  it(`žádné Origin ani Sec-Fetch-Site, ze Sec-Fetch-* jen Sec-Fetch-Mode: cors, User-Agent mncad/<verze> (Node ${process.version})`, async () => {
    const seen: { method: string; url: string; headers: http.IncomingHttpHeaders }[] = [];
    const srv = http.createServer((req, res) => {
      seen.push({ method: req.method ?? "", url: req.url ?? "", headers: req.headers });
      const chunks: Buffer[] = [];
      req.on("data", (c) => chunks.push(c));
      req.on("end", () => {
        const u = new URL(req.url ?? "/", "http://x");
        res.setHeader("content-type", "application/json");
        if (u.search === "?ping") return res.end(JSON.stringify({ ok: true, v: 1, max_bytes: 26_214_400, chunk_bytes: 8_388_608, max_days: 90 }));
        if (req.method === "POST") return res.end(JSON.stringify({ id: "Ab3kZ9xQ2m", del: "t".repeat(24), exp: Math.round(Date.now() / 1000) + 864000, size: Number(u.searchParams.get("total")) }));
        res.statusCode = 404;
        res.end("{}");
      });
    });
    await new Promise<void>((r) => srv.listen(0, "127.0.0.1", () => r()));
    const port = (srv.address() as net.AddressInfo).port;
    const store = `http://127.0.0.1:${port}/cad/share/`;
    try {
      // obal fetch vlákna běhu CLI (node-shims): User-Agent mncad/<verze>, location = stránka úložiště
      restore = installNodeShims({ fontsDir: null, version: VERSION, shareStore: store }).restore;
      const notes: ShareNote[] = [];
      const r = await shareWithPolicy(part("Deska", 80), { days: 10, view: "model", want: "store", store }, (n) => notes.push(n));
      expect(notes).toEqual([]);
      expect(r?.mode).toBe("self");
      expect(r!.url).toMatch(new RegExp(`^http://127\\.0\\.0\\.1:${port}/cad#q=Ab3kZ9xQ2m\\.[A-Za-z0-9_-]{22}$`));
      expect(seen.map((x) => x.method)).toEqual(["GET", "POST"]);
      for (const x of seen) {
        expect(x.headers.origin, `${x.method} ${x.url}`).toBeUndefined();
        expect(x.headers["sec-fetch-site"], `${x.method} ${x.url}`).toBeUndefined();
        const sec = Object.fromEntries(Object.entries(x.headers).filter(([h]) => h.startsWith("sec-fetch-")));
        expect(Object.keys(sec).length === 0 || JSON.stringify(sec) === JSON.stringify({ "sec-fetch-mode": "cors" }), `${x.method} ${x.url} ${JSON.stringify(sec)}`).toBe(true);
        expect(x.headers["user-agent"]).toBe(`mncad/${VERSION}`);
      }
    } finally {
      srv.close();
    }
  }, T);

  it("regrese: úložiště odpoví na ?ping, ale nahrávání nikdy nedokončí → časový limit, ✗ share.store-unavailable s adresou, běh pokračuje", async () => {
    const hanging: http.ServerResponse[] = [];
    const srv = http.createServer((req, res) => {
      if (req.method === "GET" && (req.url ?? "").includes("ping")) {
        res.setHeader("content-type", "application/json");
        return res.end(JSON.stringify({ ok: true, v: 1, max_bytes: 26_214_400, chunk_bytes: 8_323_072, max_days: 90 }));
      }
      req.on("data", () => undefined);
      hanging.push(res); // POST nikdy neodpoví (verify-outputs/tools/hang.cjs)
    });
    await new Promise<void>((r) => srv.listen(0, "127.0.0.1", () => r()));
    const store = `http://127.0.0.1:${(srv.address() as net.AddressInfo).port}/cad/share/`;
    setUploadTimeoutBase(300);
    try {
      restore = installNodeShims({ fontsDir: null, version: VERSION, shareStore: store }).restore;
      const notes: ShareNote[] = [];
      const t0 = Date.now();
      expect(await shareWithPolicy(part("Deska", 80), { days: 10, view: "model", want: "store" }, (n) => notes.push(n))).toBeNull();
      expect(Date.now() - t0).toBeLessThan(10_000);
      expect(notes.map((n) => n.code)).toEqual(["share.store-unavailable"]);
      expect(notes[0].text).toContain(`(${store})`);
      const { shareFile, FileStoreError } = await import("../share-file");
      const err = await shareFile({ name: "Deska.step", mime: "model/step", data: new Uint8Array(2000) }, { store }).catch((e: unknown) => e);
      expect(err).toBeInstanceOf(FileStoreError);
      expect((err as InstanceType<typeof FileStoreError>).unavailable).toBe(true);
      expect((err as Error).message).toContain(store);
    } finally {
      for (const r of hanging) r.destroy();
      srv.close();
    }
  }, T);
});

describe.skipIf(!PHP_OK)("smluvní test: php -S s public/cad/share/index.php", () => {
  const procs: ChildProcess[] = [];
  const roots: string[] = [];
  afterAll(() => {
    for (const p of procs) p.kill();
    for (const r of roots) fs.rmSync(r, { recursive: true, force: true });
  });
  const startPhp = async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "mn-share-contract-"));
    roots.push(root);
    const docroot = path.join(root, "www");
    fs.mkdirSync(path.join(docroot, "cad", "share"), { recursive: true });
    fs.copyFileSync(SCRIPT, path.join(docroot, "cad", "share", "index.php"));
    // index.php je jen zavaděč – logika úložiště je ve store.php vedle (oprava úložiště sdílení na hlavní větvi)
    fs.copyFileSync(path.join(path.dirname(SCRIPT), "store.php"), path.join(docroot, "cad", "share", "store.php"));
    const port = await freePort();
    const proc = spawn("php", ["-S", `127.0.0.1:${port}`, "-t", docroot], { stdio: "ignore" });
    procs.push(proc);
    const base = `http://127.0.0.1:${port}/cad/share/`;
    for (let i = 0; i < 200; i++) {
      try {
        if ((await fetch(base + "?ping")).ok) break;
      } catch {
        /* ještě neběží */
      }
      await new Promise((r) => setTimeout(r, 50));
    }
    return { base, page: `http://127.0.0.1:${port}/cad`, root };
  };

  it("sdílet úložiště → mode self; openShareLink v Node otevře tentýž počet komponent", async () => {
    const s = await startPhp();
    restore = installNodeShims({ fontsDir: null, version: VERSION, shareStore: s.base }).restore;
    setHostAssets({ share: { page: s.page, store: s.base } });
    const doc = assembly(7);
    const notes: ShareNote[] = [];
    const r = await shareWithPolicy(doc, { days: 10, view: "model", want: "store", base: s.page, store: s.base }, (n) => notes.push(n));
    expect(notes).toEqual([]);
    expect(r?.mode).toBe("self");
    expect(r!.url.length).toBeLessThanOrEqual(200);
    expect(fs.readdirSync(path.join(s.root, "cad-share-data")).some((f) => f.endsWith(".bin"))).toBe(true);
    const parsed = parseShareHash(new URL(r!.url).hash);
    // vlna 16: vlastní úložiště dává krátký odkaz s kódem (…/s#KÓD) – jedno odvození klíče a id z kódu (share.ts)
    expect(parsed?.kind).toBe("code");
    const opened = await openShareLink(parsed!);
    expect(opened.ok).toBe(true);
    if (!opened.ok) return;
    expect(opened.mode).toBe("self");
    expect(opened.payload.doc.components).toHaveLength(7);
    expect(opened.payload.doc.name).toBe("Smluvní sestava");
  }, T);

  it("soubor odkazem (… odkaz): nahrání do index.php, stažení a dešifrování v Node = tytéž bajty; stránka vedle úložiště", async () => {
    const s = await startPhp();
    restore = installNodeShims({ fontsDir: null, version: VERSION, shareStore: s.base }).restore;
    const { shareFile, parseFileHash, decryptSharedFile } = await import("../share-file");
    const data = new TextEncoder().encode("ISO-10303-21;\n" + "x".repeat(100_000));
    const r = await shareFile({ name: "Deska.step", mime: "model/step", data }, { store: s.base });
    expect(r.url.startsWith(s.page.replace(/\/cad$/, "/cad/soubor/index.html#f="))).toBe(true);
    const h = parseFileHash(new URL(r.url).hash)!;
    const blob = new Uint8Array(await (await fetch(`${s.base}?id=${h.id}`)).arrayBuffer());
    const back = await decryptSharedFile(blob, h.key);
    expect(back.meta.name).toBe("Deska.step");
    expect(Buffer.from(back.data).equals(Buffer.from(data))).toBe(true);
    expect(blob.length).toBeLessThan(data.length); // deflate před šifrováním
  }, T);

  it("regrese: sdílet úložiště 200 dní → odkaz platí 90 dní (max_days serveru) s ⚠ share.days-clamped; bez omezení → ✗ bez zápisu", async () => {
    const s = await startPhp();
    restore = installNodeShims({ fontsDir: null, version: VERSION, shareStore: s.base }).restore;
    const notes: ShareNote[] = [];
    const r = await shareWithPolicy(part("Deska", 80), { days: 200, view: "model", want: "store", base: s.page, store: s.base }, (n) => notes.push(n));
    expect(r?.mode).toBe("self");
    expect(Math.round((r!.exp! - Date.now()) / 86_400_000)).toBe(90);
    expect(notes).toEqual([{ code: "share.days-clamped", args: [90, 200] }]);
    notes.length = 0;
    expect(await shareWithPolicy(part("Deska", 80), { days: null, view: "model", want: "store", base: s.page, store: s.base }, (n) => notes.push(n))).toBeNull();
    expect(notes.map((n) => n.code)).toEqual(["share.days-unlimited"]);
  }, T);

  it("server zápis odmítne (požadavek s cizím Origin) → ✗ share.rejected s důvodem + ⚠ share.fallback-link a dlouhý odkaz", async () => {
    const s = await startPhp();
    // obal fetch, který přidá Origin (jako by výchozí hlavičky undici změnily chování) – index.php zápis odmítne 403
    const prev = globalThis.fetch;
    globalThis.fetch = ((input: RequestInfo | URL, init?: RequestInit) => prev(input, { ...init, headers: { ...((init?.headers as Record<string, string>) ?? {}), Origin: "https://evil.example" } })) as typeof fetch;
    restore = () => void (globalThis.fetch = prev);
    const notes: ShareNote[] = [];
    const r = await shareWithPolicy(part("Deska", 80), { days: 10, view: "model", want: "auto", base: s.page, store: s.base }, (n) => notes.push(n));
    expect(notes.map((n) => n.code)).toEqual(["share.rejected", "share.fallback-link"]);
    expect(String(notes[0].args?.[0])).toMatch(/403/);
    expect(r?.mode).toBe("link");
    expect(r!.url).toMatch(/#s=1[dr]\./);
  }, T);
});
