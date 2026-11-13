/**
 * Úložiště krátkých odkazů public/cad/share/index.php – skutečný PHP (`php -S`), skutečné HTTP požadavky:
 * nahrání (celé i po částech), stažení, vypršení a líný úklid, mazání tokenem, limity velikosti, limit požadavků z IP,
 * kvóta, pokusy o průchod cestou a neplatná id, metody, stejný původ, umístění dat (mimo web / chráněná složka)
 * a celá cesta klienta (createShareLink → openShareLink) proti tomuto serveru.
 * Bez nainstalovaného PHP se sada přeskočí.
 */
import { spawn, spawnSync, type ChildProcess } from "node:child_process";
import fs from "node:fs";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { blobOf, putBlob } from "./blobs";
import { createShareLink, openShareLink, parseShareHash, resetShareProbe, revokeShare } from "./share";
import { emptyDoc, type CadDoc } from "./types";

const PHP_OK = spawnSync("php", ["-v"], { stdio: "ignore" }).status === 0;
const SCRIPT = path.resolve(__dirname, "../../public/cad/share/index.php");
const T = 30_000;

type Srv = { base: string; origin: string; root: string; docroot: string; data: string; proc: ChildProcess };
const servers: Srv[] = [];

const freePort = () =>
  new Promise<number>((resolve, reject) => {
    const s = net.createServer();
    s.once("error", reject);
    s.listen(0, "127.0.0.1", () => {
      const port = (s.address() as net.AddressInfo).port;
      s.close(() => resolve(port));
    });
  });
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function startPhp(env: Record<string, string> = {}): Promise<Srv> {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "mn-share-php-"));
  const docroot = path.join(root, "www");
  fs.mkdirSync(path.join(docroot, "cad", "share"), { recursive: true });
  fs.copyFileSync(SCRIPT, path.join(docroot, "cad", "share", "index.php"));
  const port = await freePort();
  const proc = spawn("php", ["-S", `127.0.0.1:${port}`, "-t", docroot], { env: { ...process.env, ...env }, stdio: "ignore" });
  const origin = `http://127.0.0.1:${port}`;
  const base = `${origin}/cad/share/`;
  for (let i = 0; i < 200; i++) {
    try {
      if ((await fetch(base + "?ping")).ok) break;
    } catch {
      /* ještě neběží */
    }
    await sleep(50);
  }
  const data = env.MN_SHARE_DATA === "local" ? path.join(docroot, "cad", "share", "data") : path.join(root, "cad-share-data");
  const srv = { base, origin, root, docroot, data, proc };
  servers.push(srv);
  return srv;
}

const rnd = (n: number) => {
  const out = new Uint8Array(n);
  for (let i = 0; i < n; i += 65_536) crypto.getRandomValues(out.subarray(i, Math.min(n, i + 65_536)));
  return out;
};
const OCT = { "Content-Type": "application/octet-stream" };
const post = (url: string, body: Uint8Array, headers: Record<string, string> = {}) => fetch(url, { method: "POST", headers: { ...OCT, ...headers }, body: body as BodyInit });
async function create(s: Srv, body: Uint8Array, days = 10, total = body.length, headers: Record<string, string> = {}) {
  const res = await post(`${s.base}?days=${days}&total=${total}`, body, headers);
  return { res, j: (await res.json()) as { id: string; del: string; exp: number; size: number; done: boolean; error?: string; max_bytes?: number } };
}
const metaFile = (s: Srv, id: string) => path.join(s.data, `${id}.json`);
const editMeta = (s: Srv, id: string, patch: Record<string, unknown>) => fs.writeFileSync(metaFile(s, id), JSON.stringify({ ...JSON.parse(fs.readFileSync(metaFile(s, id), "utf8")), ...patch }));

afterAll(() => {
  for (const s of servers) {
    s.proc.kill();
    fs.rmSync(s.root, { recursive: true, force: true });
  }
});

describe.skipIf(!PHP_OK)("PHP úložiště /cad/share/ (php -S)", () => {
  let A: Srv;
  beforeAll(async () => {
    A = await startPhp({ MN_SHARE_MAX_BYTES: "600000", MN_SHARE_CHUNK: "200000" });
  }, T);

  it("?ping: JSON s limity, bez CORS a bez X-Powered-By", async () => {
    const res = await fetch(A.base + "?ping");
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toMatch(/^application\/json/);
    expect(res.headers.get("cache-control")).toBe("no-store");
    expect(res.headers.get("x-content-type-options")).toBe("nosniff");
    expect(res.headers.get("access-control-allow-origin")).toBeNull();
    expect(res.headers.get("x-powered-by")).toBeNull();
    expect(await res.json()).toEqual({ ok: true, v: 1, max_bytes: 600000, chunk_bytes: 200000, max_days: 90 });
  });

  it("nahrání a stažení: id 10 znaků base62, token, blob beze změny, správné hlavičky; data MIMO webový kořen", async () => {
    const blob = rnd(50_000);
    const { res, j } = await create(A, blob, 7);
    expect(res.status).toBe(201);
    expect(j.id).toMatch(/^[0-9A-Za-z]{10}$/);
    expect(j.del).toMatch(/^[0-9A-Za-z]{24}$/);
    expect(j.done).toBe(true);
    expect(j.exp).toBeGreaterThan(Date.now() / 1000 + 6.9 * 86400);
    const g = await fetch(`${A.base}?id=${j.id}`);
    expect(g.status).toBe(200);
    expect(g.headers.get("content-type")).toBe("application/octet-stream");
    expect(g.headers.get("cache-control")).toMatch(/^private, max-age=\d+$/);
    expect(g.headers.get("content-disposition")).toMatch(/^attachment/);
    expect(new Uint8Array(await g.arrayBuffer())).toEqual(blob);
    // data o úroveň výš než DOCUMENT_ROOT; ve webovém kořeni nic
    expect(fs.existsSync(path.join(A.root, "cad-share-data", `${j.id}.bin`))).toBe(true);
    expect(fs.existsSync(path.join(A.docroot, "cad", "share", "data"))).toBe(false);
    const ht = fs.readFileSync(path.join(A.data, ".htaccess"), "utf8");
    expect(ht).toContain("Require all denied");
    expect(ht).toContain("Deny from all");
    expect(fs.existsSync(path.join(A.data, "index.html"))).toBe(true);
    // metadata: žádná IP, token jen jako otisk
    const meta = fs.readFileSync(metaFile(A, j.id), "utf8");
    expect(meta).not.toContain(j.del);
    expect(meta).not.toContain("127.0.0.1");
  }, T);

  it("nahrání po částech: neúplný obsah nejde stáhnout, chybný token 403, chybná pozice 409, pak celé", async () => {
    const blob = rnd(500_000);
    const { j } = await create(A, blob.slice(0, 200_000), 1, blob.length);
    expect(j.done).toBe(false);
    expect(j.size).toBe(200_000);
    expect((await fetch(`${A.base}?id=${j.id}`)).status).toBe(404);
    expect((await post(`${A.base}?id=${j.id}&offset=200000`, blob.slice(200_000, 400_000), { "X-Delete-Token": "x".repeat(24) })).status).toBe(403);
    const r409 = await post(`${A.base}?id=${j.id}&offset=100`, blob.slice(200_000, 400_000), { "X-Delete-Token": j.del });
    expect(r409.status).toBe(409);
    expect(((await r409.json()) as { size: number }).size).toBe(200_000);
    const r2 = await post(`${A.base}?id=${j.id}&offset=200000`, blob.slice(200_000, 400_000), { "X-Delete-Token": j.del });
    expect(await r2.json()).toEqual({ id: j.id, size: 400_000, done: false });
    const r3 = await post(`${A.base}?id=${j.id}&offset=400000`, blob.slice(400_000), { "X-Delete-Token": j.del });
    expect(await r3.json()).toEqual({ id: j.id, size: 500_000, done: true });
    expect(new Uint8Array(await (await fetch(`${A.base}?id=${j.id}`)).arrayBuffer())).toEqual(blob);
    // hotový obsah už nejde doplnit
    expect((await post(`${A.base}?id=${j.id}&offset=500000`, rnd(10), { "X-Delete-Token": j.del })).status).toBe(404);
  }, T);

  it("vypršení: GET → 410 s datem a soubory jsou pryč, pak 404", async () => {
    const { j } = await create(A, rnd(1000), 1);
    const exp = Math.floor(Date.now() / 1000) - 10;
    editMeta(A, j.id, { exp });
    const g = await fetch(`${A.base}?id=${j.id}`);
    expect(g.status).toBe(410);
    expect(await g.json()).toMatchObject({ error: "expired", exp });
    expect(fs.existsSync(path.join(A.data, `${j.id}.bin`))).toBe(false);
    expect(fs.existsSync(metaFile(A, j.id))).toBe(false);
    expect((await fetch(`${A.base}?id=${j.id}`)).status).toBe(404);
  }, T);

  it("líný úklid: vypršelá data a opuštěné nedokončené nahrávání zmizí při dalším požadavku (nejvýš 1× za 10 min)", async () => {
    const a = (await create(A, rnd(1000), 1)).j;
    const b = (await create(A, rnd(1000), 1)).j;
    const c = (await create(A, rnd(1000), 1, 5000)).j; // nedokončené
    editMeta(A, a.id, { exp: Math.floor(Date.now() / 1000) - 5 });
    editMeta(A, c.id, { created: Math.floor(Date.now() / 1000) - 7200 });
    const old = new Date(Date.now() - 3600_000);
    fs.utimesSync(path.join(A.data, ".gc"), old, old);
    await fetch(A.base + "?ping");
    expect(fs.existsSync(metaFile(A, a.id))).toBe(false);
    expect(fs.existsSync(path.join(A.data, `${c.id}.part`))).toBe(false);
    expect(fs.existsSync(metaFile(A, b.id))).toBe(true);
    // hned znovu: interval ještě neuplynul → nic se neprochází
    editMeta(A, b.id, { exp: Math.floor(Date.now() / 1000) - 5 });
    await fetch(A.base + "?ping");
    expect(fs.existsSync(metaFile(A, b.id))).toBe(true);
    // přímý požadavek na vypršelý obsah ho smaže vždy
    expect((await fetch(`${A.base}?id=${b.id}`)).status).toBe(410);
  }, T);

  it("nedokončené nahrávání po hodině: doplnění → 410", async () => {
    const { j } = await create(A, rnd(1000), 1, 3000);
    editMeta(A, j.id, { created: Math.floor(Date.now() / 1000) - 7200 });
    expect((await post(`${A.base}?id=${j.id}&offset=1000`, rnd(2000), { "X-Delete-Token": j.del })).status).toBe(410);
    expect(fs.existsSync(metaFile(A, j.id))).toBe(false);
  }, T);

  it("DELETE: špatný token 403 (obsah zůstane), správný token (hlavička i ?del=) smaže, opakovaně 404", async () => {
    const { j } = await create(A, rnd(2000));
    const bad = await fetch(`${A.base}?id=${j.id}`, { method: "DELETE", headers: { "X-Delete-Token": "A".repeat(24) } });
    expect(bad.status).toBe(403);
    expect((await fetch(`${A.base}?id=${j.id}`)).status).toBe(200);
    const none = await fetch(`${A.base}?id=${j.id}`, { method: "DELETE" });
    expect(none.status).toBe(403);
    const ok = await fetch(`${A.base}?id=${j.id}`, { method: "DELETE", headers: { "X-Delete-Token": j.del } });
    expect(await ok.json()).toEqual({ ok: true });
    expect((await fetch(`${A.base}?id=${j.id}`)).status).toBe(404);
    expect((await fetch(`${A.base}?id=${j.id}`, { method: "DELETE", headers: { "X-Delete-Token": j.del } })).status).toBe(404);
    const k = (await create(A, rnd(10))).j;
    expect((await fetch(`${A.base}?id=${k.id}&del=${k.del}`, { method: "DELETE" })).status).toBe(200);
    expect((await fetch(`${A.base}?id=${k.id}`)).status).toBe(404);
  }, T);

  it("limity: celkem nad max → 413, tělo větší než ohlášené → 413 bez uložení, část nad chunk → 413, chybné dny/velikost → 400", async () => {
    const blobs = () => fs.readdirSync(A.data).filter((f) => /\.(bin|part|json|tmp)$/.test(f)).length;
    const before = blobs();
    const big = await create(A, rnd(1000), 10, 600_001);
    expect(big.res.status).toBe(413);
    expect(big.j).toMatchObject({ error: "too_large", max_bytes: 600000 });
    expect((await create(A, rnd(5000), 10, 4000)).res.status).toBe(413);
    const chunk = await create(A, rnd(250_000), 10, 300_000);
    expect(chunk.res.status).toBe(413);
    expect(chunk.j.error).toBe("chunk_too_large");
    for (const d of ["0", "91", "abc", "-1", "1.5"]) expect((await post(`${A.base}?days=${d}&total=10`, rnd(10))).status).toBe(400);
    expect((await post(`${A.base}?days=1`, rnd(10))).status).toBe(400);
    expect((await post(`${A.base}?days=1&total=10`, new Uint8Array())).status).toBe(400);
    expect(blobs()).toBe(before);
    // bez Content-Length (chunked): server počítá bajty při zápisu a nadbytečné tělo zahodí i s rozpracovaným obsahem
    const stream = new ReadableStream({
      start(c) {
        c.enqueue(rnd(3000));
        c.enqueue(rnd(3000));
        c.close();
      },
    });
    const chunked = await fetch(`${A.base}?days=1&total=4000`, { method: "POST", headers: OCT, body: stream, duplex: "half" } as RequestInit);
    expect(chunked.status).toBe(413);
    expect(blobs()).toBe(before);
  }, T);

  it("neplatná id a pokusy o průchod cestou → 400, nic mimo úložiště", async () => {
    const probes = ["../../etc/passwd", "..%2F..%2Findex.php", "abc", "AAAAAAAAAAAAA", "abcdefghij.json", "abcdefghij%00", "abcdefghij/../x", "%2e%2e", "abcdefghi-", " abcdefghij"];
    for (const p of probes) {
      const g = await fetch(`${A.base}?id=${p}`);
      expect(g.status, p).toBe(400);
      expect(g.headers.get("content-type")).toMatch(/json/);
      expect((await fetch(`${A.base}?id=${p}`, { method: "DELETE" })).status, p).toBe(400);
      expect((await post(`${A.base}?id=${p}&offset=0`, rnd(10))).status, p).toBe(400);
    }
    expect((await fetch(`${A.base}?id[]=abcdefghij`)).status).toBe(400);
    expect((await fetch(`${A.base}?id=Zz00000000`)).status).toBe(404);
    expect((await fetch(A.base)).status).toBe(400);
    expect(fs.existsSync(path.join(A.root, "etc"))).toBe(false);
  }, T);

  it("jen GET/POST/DELETE: PUT, PATCH, OPTIONS → 405 s Allow (žádná CORS předletová odpověď)", async () => {
    for (const m of ["PUT", "PATCH", "OPTIONS"]) {
      const r = await fetch(A.base + "?id=abcdefghij", { method: m });
      expect(r.status, m).toBe(405);
      expect(r.headers.get("allow")).toBe("GET, POST, DELETE");
      expect(r.headers.get("access-control-allow-origin")).toBeNull();
    }
  }, T);

  it("zápis jen ze stejného původu a jen application/octet-stream", async () => {
    expect((await create(A, rnd(10), 1, 10, { Origin: "https://evil.example" })).res.status).toBe(403);
    expect((await create(A, rnd(10), 1, 10, { "Sec-Fetch-Site": "cross-site" })).res.status).toBe(403);
    expect((await create(A, rnd(10), 1, 10, { Origin: "null" })).res.status).toBe(403);
    expect((await create(A, rnd(10), 1, 10, { Origin: A.origin, "Sec-Fetch-Site": "same-origin" })).res.status).toBe(201);
    expect((await fetch(`${A.base}?days=1&total=3`, { method: "POST", headers: { "Content-Type": "text/plain" }, body: "abc" })).status).toBe(415);
    const k = (await create(A, rnd(10))).j;
    expect((await fetch(`${A.base}?id=${k.id}`, { method: "DELETE", headers: { "X-Delete-Token": k.del, Origin: "https://evil.example" } })).status).toBe(403);
  }, T);

  it("limit nových sdílení z jedné IP za hodinu → 429 s Retry-After; IP se neukládá", async () => {
    const B = await startPhp({ MN_SHARE_RATE: "3" });
    for (let i = 0; i < 3; i++) expect((await create(B, rnd(100))).res.status).toBe(201);
    const r = await create(B, rnd(100));
    expect(r.res.status).toBe(429);
    expect(Number(r.res.headers.get("retry-after"))).toBeGreaterThan(3000);
    const rl = fs.readdirSync(path.join(B.data, "rl"));
    expect(rl.length).toBe(1);
    expect(rl[0]).toMatch(/^[0-9a-f]{32}$/);
    expect(fs.readFileSync(path.join(B.data, "rl", rl[0]), "utf8")).not.toContain("127.0.0.1");
  }, T);

  it("kvóta úložiště → 507", async () => {
    const C = await startPhp({ MN_SHARE_QUOTA: "100000" });
    expect((await create(C, rnd(80_000))).res.status).toBe(201);
    expect((await create(C, rnd(50_000))).res.status).toBe(507);
  }, T);

  it("bez zápisu mimo web: data ve složce „data“ vedle skriptu chráněné .htaccess (Require all denied + Deny from all) a index.html", async () => {
    const D = await startPhp({ MN_SHARE_DATA: "local" });
    const { j } = await create(D, rnd(500));
    expect(fs.existsSync(path.join(D.docroot, "cad", "share", "data", `${j.id}.bin`))).toBe(true);
    const ht = fs.readFileSync(path.join(D.data, ".htaccess"), "utf8");
    expect(ht).toMatch(/Require all denied/);
    expect(ht).toMatch(/Deny from all/);
    expect(ht).toMatch(/php_flag engine off/);
    expect(fs.readFileSync(path.join(D.data, "index.html"), "utf8")).toBe("");
    // žádný spustitelný soubor
    expect(fs.readdirSync(D.data).filter((f) => /\.(php|phtml|phar|cgi|pl|sh)$/i.test(f))).toEqual([]);
    expect(fs.existsSync(path.join(D.root, "cad-share-data"))).toBe(false);
  }, T);
});

describe.skipIf(!PHP_OK)("klient ↔ skutečný PHP server: krátký odkaz celou cestou", () => {
  let S: Srv;
  beforeAll(async () => {
    S = await startPhp({ MN_SHARE_CHUNK: "300000" });
  }, T);
  afterEach(() => {
    vi.unstubAllGlobals();
    resetShareProbe();
  });
  const doc = (): CadDoc => ({
    ...emptyDoc("Deska s importem"),
    features: [{ id: "s1", name: "Skica 1", type: "sketch", plane: "XY", entities: [{ kind: "circle", center: [0, 0], r: 40 }] } as unknown as CadDoc["features"][number]],
  });

  it("velký model po částech: odkaz na jeden řádek < 120 znaků, otevření vrátí stejná data; zneplatnění", async () => {
    vi.stubGlobal("location", { origin: S.origin, pathname: "/cad" });
    const step = rnd(1_000_000);
    const d = doc();
    d.features.push({ id: "imp", name: "Import", type: "import", fileName: "deska.step", format: "step", data: putBlob(step) } as CadDoc["features"][number]);
    const r = await createShareLink(d, { days: 10 });
    expect(r.mode).toBe("self");
    expect(r.url).toMatch(new RegExp(`^${S.origin.replace(/[.]/g, "\\.")}/cad#q=[0-9A-Za-z]{10}\\.[A-Za-z0-9_-]{22}$`));
    expect(r.url.length).toBeLessThan(120);
    expect(fs.readdirSync(S.data).filter((f) => f.endsWith(".bin")).length).toBe(1);
    const o = await openShareLink(parseShareHash(r.url.slice(r.url.indexOf("#")))!);
    expect(o.ok).toBe(true);
    if (o.ok) {
      expect(o.mode).toBe("self");
      const f = o.payload.doc.features.find((x) => x.type === "import") as { data: string };
      expect(blobOf(f.data)).toEqual(step);
    }
    expect(await revokeShare(r)).toBe(true);
    const gone = await openShareLink(parseShareHash(r.url.slice(r.url.indexOf("#")))!);
    expect(!gone.ok && gone.reason).toBe("notfound");
  }, T);

  it("heslo a vypršení na serveru", async () => {
    vi.stubGlobal("location", { origin: S.origin, pathname: "/cad" });
    const r = await createShareLink(doc(), { days: 1, password: "tajne" });
    const p = parseShareHash(r.url.slice(r.url.indexOf("#")))!;
    expect((await openShareLink(p)).ok).toBe(false);
    const bad = await openShareLink(p, "spatne");
    expect(!bad.ok && bad.reason).toBe("password");
    const good = await openShareLink(p, "tajne");
    expect(good.ok && good.payload.doc.name).toBe("Deska s importem");
    editMeta(S, r.id!, { exp: Math.floor(Date.now() / 1000) - 1 });
    resetShareProbe();
    const ex = await openShareLink(p, "tajne");
    expect(!ex.ok && ex.reason).toBe("expired");
  }, T);

  it("nad limit serveru: srozumitelná chyba ještě před nahráním", async () => {
    const L = await startPhp({ MN_SHARE_MAX_BYTES: "200000" });
    vi.stubGlobal("location", { origin: L.origin, pathname: "/cad" });
    const d = doc();
    d.features.push({ id: "imp", name: "Import", type: "import", fileName: "x.step", format: "step", data: putBlob(rnd(300_000)) } as CadDoc["features"][number]);
    await expect(createShareLink(d, { days: 10 })).rejects.toThrow(/příliš velký/);
    expect(fs.existsSync(L.data) ? fs.readdirSync(L.data).filter((f) => /\.(bin|part)$/.test(f)) : []).toEqual([]);
  }, T);
});
