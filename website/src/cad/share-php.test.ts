/**
 * Úložiště krátkých odkazů public/cad/share/index.php – skutečný PHP (`php -S`), skutečné HTTP požadavky:
 * nahrání (celé i po částech), stažení, vypršení a líný úklid, mazání tokenem, limity velikosti, limit požadavků z IP,
 * kvóta, pokusy o průchod cestou a neplatná id, metody, stejný původ, umístění dat (mimo web / chráněná složka),
 * id odvozené prohlížečem z kódu (nejkratší odkaz /s#KÓD: založení, 409, limit neúspěšných dotazů), starší API bez id
 * a celá cesta klienta (createShareLink → openShareLink) proti tomuto serveru včetně staršího odkazu #q=.
 * Po revizi navíc: jednou použité id se nikdy nepřidělí znovu (náhrobky – zneplatněný / vypršelý odkaz nejde oživit
 * s jiným obsahem), dotazy z cizí stránky se odmítají a nepočítají, správný token projde i po vyčerpání limitu,
 * IPv6 se počítá po sítích /64, úklid počítadel projde celou složku.
 * Bez nainstalovaného PHP se sada přeskočí.
 */
import { spawn, spawnSync, type ChildProcess } from "node:child_process";
import fs from "node:fs";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { blobOf, putBlob } from "./blobs";
import { createShareLink, deriveShareCode, openErrorText, openShareLink, parseShareHash, resetShareProbe, revokeShare } from "./share";
import { emptyDoc, type CadDoc } from "./types";

const PHP_OK = spawnSync("php", ["-v"], { stdio: "ignore" }).status === 0;
const SCRIPT = path.resolve(__dirname, "../../public/cad/share/index.php");
/** skript úložiště před vlnou 16 (commit bf91b0b: ?ping v = 1, id přiděluje server) – z gitu; bez gitu / historie null */
const OLD_SCRIPT = (() => {
  const r = spawnSync("git", ["show", "bf91b0b:website/public/cad/share/index.php"], { cwd: __dirname, maxBuffer: 1 << 22 });
  return r.status === 0 && r.stdout.length > 1000 ? r.stdout : null;
})();
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

/**
 * `fakeAddr`: před skript úložiště se vloží směrovač vestavěného serveru PHP, který adresu klienta (REMOTE_ADDR) vezme
 * z hlavičky X-Test-Addr – jen pro zkoušky počítadel podle adresy (IPv6 nejde na smyčce jinak napodobit). Skript úložiště
 * sám žádné takové hlavičce nevěří.
 */
async function startPhp(env: Record<string, string> = {}, script?: Buffer, fakeAddr = false): Promise<Srv> {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "mn-share-php-"));
  const docroot = path.join(root, "www");
  fs.mkdirSync(path.join(docroot, "cad", "share"), { recursive: true });
  if (script) fs.writeFileSync(path.join(docroot, "cad", "share", "index.php"), script);
  else fs.copyFileSync(SCRIPT, path.join(docroot, "cad", "share", "index.php"));
  const router = path.join(root, "router.php");
  if (fakeAddr) fs.writeFileSync(router, "<?php\nif (isset($_SERVER['HTTP_X_TEST_ADDR'])) $_SERVER['REMOTE_ADDR'] = $_SERVER['HTTP_X_TEST_ADDR'];\nrequire $_SERVER['DOCUMENT_ROOT'] . '/cad/share/index.php';\n");
  const port = await freePort();
  const proc = spawn("php", ["-S", `127.0.0.1:${port}`, "-t", docroot, ...(fakeAddr ? [router] : [])], { env: { ...process.env, ...env }, stdio: "ignore" });
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
    // v = 2: server přijme id odvozené prohlížečem z kódu odkazu (POST …&id=)
    expect(await res.json()).toEqual({ ok: true, v: 2, max_bytes: 600000, chunk_bytes: 200000, max_days: 90 });
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

  it("vypršení: GET → 410 s datem a soubory jsou pryč; i každý další dotaz → 410 s datem (náhrobek), ne 404", async () => {
    const { j } = await create(A, rnd(1000), 1);
    const exp = Math.floor(Date.now() / 1000) - 10;
    editMeta(A, j.id, { exp });
    const g = await fetch(`${A.base}?id=${j.id}`);
    expect(g.status).toBe(410);
    expect(await g.json()).toMatchObject({ error: "expired", exp });
    expect(fs.existsSync(path.join(A.data, `${j.id}.bin`))).toBe(false);
    expect(fs.existsSync(metaFile(A, j.id))).toBe(false);
    const again = await fetch(`${A.base}?id=${j.id}`);
    expect(again.status).toBe(410);
    expect(await again.json()).toMatchObject({ error: "expired", exp });
    // náhrobek: řádek „<id> x<konec platnosti>“ ve složce dead/ (soubor podle prvních dvou znaků id), bez adresy
    const tomb = fs.readFileSync(path.join(A.data, "dead", j.id.slice(0, 2)), "utf8");
    expect(tomb).toContain(`${j.id} x${exp}\n`);
    expect(tomb).not.toContain("127.0.0.1");
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
    // vypršelý obsah nechal náhrobek (dotaz → 410 s datem); nedokončené nahrávání ne (odkaz k němu nikdy nevznikl → 404)
    expect(((await (await fetch(`${A.base}?id=${a.id}`)).json()) as { error: string }).error).toBe("expired");
    expect((await fetch(`${A.base}?id=${c.id}`)).status).toBe(404);
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

  it("DELETE: špatný token 403 (obsah zůstane), správný token (hlavička i ?del=) smaže – stažení pak 410 revoked; opakovaně 404", async () => {
    const { j } = await create(A, rnd(2000));
    const bad = await fetch(`${A.base}?id=${j.id}`, { method: "DELETE", headers: { "X-Delete-Token": "A".repeat(24) } });
    expect(bad.status).toBe(403);
    expect((await fetch(`${A.base}?id=${j.id}`)).status).toBe(200);
    const none = await fetch(`${A.base}?id=${j.id}`, { method: "DELETE" });
    expect(none.status).toBe(403);
    const ok = await fetch(`${A.base}?id=${j.id}`, { method: "DELETE", headers: { "X-Delete-Token": j.del } });
    expect(await ok.json()).toEqual({ ok: true });
    const gone = await fetch(`${A.base}?id=${j.id}`);
    expect(gone.status).toBe(410);
    expect(await gone.json()).toMatchObject({ ok: false, error: "revoked" });
    expect(fs.existsSync(path.join(A.data, `${j.id}.bin`))).toBe(false);
    expect(fs.existsSync(metaFile(A, j.id))).toBe(false);
    expect((await fetch(`${A.base}?id=${j.id}`, { method: "DELETE", headers: { "X-Delete-Token": j.del } })).status).toBe(404);
    const k = (await create(A, rnd(10))).j;
    expect((await fetch(`${A.base}?id=${k.id}&del=${k.del}`, { method: "DELETE" })).status).toBe(200);
    expect((await fetch(`${A.base}?id=${k.id}`)).status).toBe(410);
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

describe.skipIf(!PHP_OK)("PHP úložiště: id od prohlížeče (odkaz s kódem), limit neúspěšných dotazů, starší API", () => {
  let A: Srv;
  beforeAll(async () => {
    A = await startPhp({ MN_SHARE_MAX_BYTES: "600000", MN_SHARE_CHUNK: "200000" });
  }, T);
  const createId = async (s: Srv, id: string, body: Uint8Array, days = 10, total = body.length) => {
    const res = await post(`${s.base}?days=${days}&total=${total}&id=${id}`, body);
    return { res, j: (await res.json()) as { id: string; del: string; exp: number; size: number; done: boolean; error?: string } };
  };

  it("POST …&id=<11 znaků base58>: obsah se uloží pod id od prohlížeče; token, platnost a metadata jako dřív", async () => {
    const blob = rnd(30_000);
    const { res, j } = await createId(A, "Ab3kZ9xQ2mA", blob, 7);
    expect(res.status).toBe(201);
    expect(j.id).toBe("Ab3kZ9xQ2mA");
    expect(j.del).toMatch(/^[0-9A-Za-z]{24}$/);
    expect(j.done).toBe(true);
    expect(j.exp).toBeGreaterThan(Date.now() / 1000 + 6.9 * 86400);
    expect(fs.existsSync(path.join(A.data, "Ab3kZ9xQ2mA.bin"))).toBe(true);
    expect(new Uint8Array(await (await fetch(`${A.base}?id=Ab3kZ9xQ2mA`)).arrayBuffer())).toEqual(blob);
    const meta = fs.readFileSync(metaFile(A, "Ab3kZ9xQ2mA"), "utf8");
    expect(meta).not.toContain(j.del);
    expect(meta).not.toContain("127.0.0.1");
    // smazání tokenem funguje stejně
    expect((await fetch(`${A.base}?id=Ab3kZ9xQ2mA`, { method: "DELETE", headers: { "X-Delete-Token": j.del } })).status).toBe(200);
    expect((await fetch(`${A.base}?id=Ab3kZ9xQ2mA`)).status).toBe(410);
  }, T);

  it("existující id → 409 id_taken a původní obsah zůstane beze změny (i rozpracovaný)", async () => {
    const first = rnd(5000);
    const a = await createId(A, "Zz111111111", first);
    expect(a.res.status).toBe(201);
    const again = await createId(A, "Zz111111111", rnd(7000));
    expect(again.res.status).toBe(409);
    expect(again.j.error).toBe("id_taken");
    expect(new Uint8Array(await (await fetch(`${A.base}?id=Zz111111111`)).arrayBuffer())).toEqual(first);
    // token z prvního založení dál platí (druhý pokus ho nepřepsal)
    expect((await fetch(`${A.base}?id=Zz111111111`, { method: "DELETE", headers: { "X-Delete-Token": a.j.del } })).status).toBe(200);
    // rozpracované nahrávání drží id také
    const part = await createId(A, "Zz222222222", rnd(1000), 1, 3000);
    expect(part.j.done).toBe(false);
    expect((await createId(A, "Zz222222222", rnd(3000), 1, 3000)).res.status).toBe(409);
    const more = await post(`${A.base}?id=Zz222222222&offset=1000`, rnd(2000), { "X-Delete-Token": part.j.del });
    expect(await more.json()).toEqual({ id: "Zz222222222", size: 3000, done: true });
  }, T);

  it("REVIZE – zneplatněný odkaz nejde oživit: id po smazání zůstává navždy obsazené (409), stažení 410 revoked, původní token už nic nezmění", async () => {
    // dříve: po DELETE bylo id volné → kdo znal odkaz (kód → id i klíč), nahrál pod něj jiný dokument s platností 90 dní
    const a = await createId(A, "Rv111111111", rnd(1800), 1);
    expect(a.res.status).toBe(201);
    expect((await fetch(`${A.base}?id=Rv111111111`, { method: "DELETE", headers: { "X-Delete-Token": a.j.del } })).status).toBe(200);
    const replant = await post(`${A.base}?days=90&total=24&id=Rv111111111`, new TextEncoder().encode("REPLANTED-BY-LINK-HOLDER"), { "X-Forwarded-For": "203.0.113.9" });
    expect(replant.status).toBe(409);
    expect(await replant.json()).toMatchObject({ ok: false, error: "id_taken" });
    const g = await fetch(`${A.base}?id=Rv111111111`);
    expect(g.status).toBe(410);
    expect(await g.json()).toMatchObject({ error: "revoked" });
    expect(fs.readdirSync(A.data).filter((f) => f.startsWith("Rv111111111"))).toEqual([]);
    // náhrobek přežije i úklid a zůstává; opakované zneplatnění = 404 (už smazáno)
    const old = new Date(Date.now() - 3600_000);
    fs.utimesSync(path.join(A.data, ".gc"), old, old);
    await fetch(A.base + "?ping");
    expect((await createId(A, "Rv111111111", rnd(10))).res.status).toBe(409);
    expect((await fetch(`${A.base}?id=Rv111111111`, { method: "DELETE", headers: { "X-Delete-Token": a.j.del } })).status).toBe(404);
    expect(fs.readFileSync(path.join(A.data, "dead", "Rv"), "utf8")).toMatch(/^Rv111111111 r\d{10}\n$/m);
  }, T);

  it("REVIZE – vypršelý odkaz nejde oživit: po vypršení (dotazem i úklidem) zůstává id obsazené (409) a stažení hlásí 410 expired s datem", async () => {
    const exp = Math.floor(Date.now() / 1000) - 5;
    // vypršení zjištěné dotazem
    const a = await createId(A, "Ex111111111", rnd(900), 1);
    editMeta(A, "Ex111111111", { exp });
    expect((await fetch(`${A.base}?id=Ex111111111`)).status).toBe(410);
    expect((await createId(A, "Ex111111111", rnd(10), 90)).res.status).toBe(409);
    // vypršení zjištěné úklidem (nikdo se na odkaz nezeptal)
    await createId(A, "Ex222222222", rnd(900), 1);
    editMeta(A, "Ex222222222", { exp });
    const old = new Date(Date.now() - 3600_000);
    fs.utimesSync(path.join(A.data, ".gc"), old, old);
    await fetch(A.base + "?ping");
    expect(fs.existsSync(metaFile(A, "Ex222222222"))).toBe(false);
    expect((await createId(A, "Ex222222222", rnd(10), 90)).res.status).toBe(409);
    const g = await fetch(`${A.base}?id=Ex222222222`);
    expect(g.status).toBe(410);
    expect(await g.json()).toMatchObject({ error: "expired", exp });
    // token původního odesílatele už nic nemaže ani neodemyká
    expect((await fetch(`${A.base}?id=Ex111111111`, { method: "DELETE", headers: { "X-Delete-Token": a.j.del } })).status).toBe(404);
  }, T);

  it("REVIZE – id starších odkazů (#q=, 10 znaků od serveru) nejde přes ?id= založit nikdy: obě řady id se liší délkou", async () => {
    // dříve: asi polovina id od serveru neobsahuje 0/O/I/l, prošla kontrolou id od prohlížeče a po vypršení šla založit znovu
    const o = (await create(A, rnd(500), 1)).j;
    expect(o.id).toMatch(/^[0-9A-Za-z]{10}$/);
    expect((await fetch(`${A.base}?id=${o.id}`, { method: "DELETE", headers: { "X-Delete-Token": o.del } })).status).toBe(200);
    for (const id of [o.id, "YTV7cSaFJQ", "wWWG9Jpjj6", "Ab3kZ9xQ2m"]) {
      const r = await post(`${A.base}?days=90&total=10&id=${id}`, rnd(10));
      expect(r.status, id).toBe(400);
      expect(((await r.json()) as { error: string }).error).toBe("invalid_id");
    }
    // i id od serveru má po smazání náhrobek (stažení 410, ne 404)
    expect((await fetch(`${A.base}?id=${o.id}`)).status).toBe(410);
    // a server sám nikdy nepřidělí id z druhé řady
    for (let i = 0; i < 5; i++) expect((await create(A, rnd(10), 1)).j.id).toMatch(/^[0-9A-Za-z]{10}$/);
  }, T);

  it("nedokončené nahrávání náhrobek nenechá: neúspěšné založení (prázdné tělo, tělo větší než ohlášené) id neobsadí", async () => {
    expect((await post(`${A.base}?days=1&total=10&id=Nd111111111`, new Uint8Array(0))).status).toBe(400);
    expect((await post(`${A.base}?days=1&total=10&id=Nd111111111`, rnd(50))).status).toBe(413);
    expect(fs.existsSync(path.join(A.data, "dead", "Nd"))).toBe(false);
    expect((await createId(A, "Nd111111111", rnd(10), 1)).res.status).toBe(201);
  }, T);

  it("id od prohlížeče jen z abecedy base58 a právě 11 znaků; jinak 400 a nic se neuloží", async () => {
    const before = fs.readdirSync(A.data).filter((f) => /\.(bin|part|json)$/.test(f)).length;
    for (const id of ["Ab3kZ9xQ0mA", "Ab3kZ9xQOmA", "Ab3kZ9xQImA", "Ab3kZ9xQlmA", "Ab3kZ9xQ2m", "Ab3kZ9xQ2", "Ab3kZ9xQ2mmm", "Ab3k-9xQ2mA", "../../../etc", "Ab3kZ9xQ2mA.json", "%2e%2e%2fAb3kZ9xQ"]) {
      const r = await post(`${A.base}?days=1&total=10&id=${id}`, rnd(10));
      expect(r.status, id).toBe(400);
      expect(((await r.json()) as { error: string }).error, id).toBe("invalid_id");
    }
    expect(fs.readdirSync(A.data).filter((f) => /\.(bin|part|json)$/.test(f)).length).toBe(before);
    // ostatní kontroly platí i s id: dny, velikost, původ, typ obsahu
    expect((await post(`${A.base}?days=91&total=10&id=Ab3kZ9xQ2nA`, rnd(10))).status).toBe(400);
    expect((await post(`${A.base}?days=1&total=600001&id=Ab3kZ9xQ2nA`, rnd(10))).status).toBe(413);
    expect((await post(`${A.base}?days=1&total=10&id=Ab3kZ9xQ2nA`, rnd(10), { Origin: "https://evil.example" })).status).toBe(403);
    expect((await fetch(`${A.base}?days=1&total=3&id=Ab3kZ9xQ2nA`, { method: "POST", headers: { "Content-Type": "text/plain" }, body: "abc" })).status).toBe(415);
    expect((await fetch(`${A.base}?id=Ab3kZ9xQ2nA`)).status).toBe(404);
  }, T);

  it("starší API bez id (stránky v mezipaměti): id přidělí server (base62) a vše funguje jako dřív", async () => {
    const blob = rnd(2000);
    const { res, j } = await create(A, blob, 3);
    expect(res.status).toBe(201);
    expect(j.id).toMatch(/^[0-9A-Za-z]{10}$/);
    expect(new Uint8Array(await (await fetch(`${A.base}?id=${j.id}`)).arrayBuffer())).toEqual(blob);
    // samotné ?id= bez days/total zůstává „další část nahrávání“ (ne založení)
    expect((await post(`${A.base}?id=Ab3kZ9xQ2p`, rnd(10))).status).toBe(404);
    expect((await fetch(`${A.base}?id=Ab3kZ9xQ2p`)).status).toBe(404);
  }, T);

  it("limit neúspěšných dotazů z jedné IP: po N dotazech na neexistující id → 429 s Retry-After i pro existující id; úspěšná stažení se nepočítají; IP se neukládá", async () => {
    const M = await startPhp({ MN_SHARE_MISS: "5" });
    const hit = (await create(M, rnd(100))).j;
    // úspěšná stažení limit nespotřebují
    for (let i = 0; i < 12; i++) expect((await fetch(`${M.base}?id=${hit.id}`)).status).toBe(200);
    for (let i = 0; i < 5; i++) expect((await fetch(`${M.base}?id=Nx1111111${i + 1}`)).status, `miss ${i + 1}`).toBe(404);
    const over = await fetch(`${M.base}?id=Nx11111119`);
    expect(over.status).toBe(429);
    expect(await over.json()).toMatchObject({ ok: false, error: "rate_limited" });
    const retry = Number(over.headers.get("retry-after"));
    expect(retry).toBeGreaterThan(3000);
    expect(retry).toBeLessThanOrEqual(3600);
    // po překročení se odmítne i existující id (jinak by 429 × 200 prozradilo, které id existuje) a mazání / doplnění cizího id
    expect((await fetch(`${M.base}?id=${hit.id}`)).status).toBe(429);
    expect((await fetch(`${M.base}?id=Nx11111118`, { method: "DELETE", headers: { "X-Delete-Token": "x".repeat(24) } })).status).toBe(429);
    expect((await post(`${M.base}?id=Nx11111118&offset=0`, rnd(10), { "X-Delete-Token": "x".repeat(24) })).status).toBe(429);
    // ?ping a nové sdílení fungují dál (limit se týká jen dotazů podle id)
    expect((await fetch(M.base + "?ping")).status).toBe(200);
    expect((await create(M, rnd(100))).res.status).toBe(201);
    // počítadlo: jen otisk IP se solí, žádná adresa
    const rl = fs.readdirSync(path.join(M.data, "rl"));
    expect(rl.every((f) => /^[0-9a-f]{32}$/.test(f))).toBe(true);
    for (const f of rl) expect(fs.readFileSync(path.join(M.data, "rl", f), "utf8")).not.toContain("127.0.0.1");
    // po uplynutí okna (hodina) se počítadlo vynuluje
    const miss = rl.find((f) => /"m":/.test(fs.readFileSync(path.join(M.data, "rl", f), "utf8")))!;
    const st = JSON.parse(fs.readFileSync(path.join(M.data, "rl", miss), "utf8")) as { t: number; m: number };
    expect(st.m).toBe(6);
    fs.writeFileSync(path.join(M.data, "rl", miss), JSON.stringify({ ...st, t: st.t - 3700 }));
    expect((await fetch(`${M.base}?id=${hit.id}`)).status).toBe(200);
    expect((await fetch(`${M.base}?id=Nx11111117`)).status).toBe(404);
  }, T);

  it("neúspěšné mazání a doplňování (neznámé id, špatný token) se do limitu počítá také", async () => {
    const M = await startPhp({ MN_SHARE_MISS: "3" });
    const k = (await create(M, rnd(50))).j;
    expect((await fetch(`${M.base}?id=Nx22222221`, { method: "DELETE", headers: { "X-Delete-Token": "x".repeat(24) } })).status).toBe(404);
    expect((await fetch(`${M.base}?id=${k.id}`, { method: "DELETE", headers: { "X-Delete-Token": "y".repeat(24) } })).status).toBe(403);
    expect((await post(`${M.base}?id=Nx22222222&offset=0`, rnd(10), { "X-Delete-Token": "x".repeat(24) })).status).toBe(404);
    expect((await fetch(`${M.base}?id=Nx22222223`)).status).toBe(429);
    // obsah zůstal a po vynulování počítadla ho správný token smaže
    for (const f of fs.readdirSync(path.join(M.data, "rl"))) fs.rmSync(path.join(M.data, "rl", f));
    expect((await fetch(`${M.base}?id=${k.id}`)).status).toBe(200);
    expect((await fetch(`${M.base}?id=${k.id}`, { method: "DELETE", headers: { "X-Delete-Token": k.del } })).status).toBe(200);
  }, T);

  it("REVIZE – správný token projde i po vyčerpání limitu: odesílatel odkaz zneplatní a nahrávání po částech se dokončí", async () => {
    // dříve: kontrola limitu byla před ověřením tokenu → „Zneplatnění se nezdařilo (síť)“, druhá část nahrávání 429
    const M = await startPhp({ MN_SHARE_MISS: "3", MN_SHARE_CHUNK: "100000" });
    const done = (await create(M, rnd(400))).j;
    const part = (await create(M, rnd(1000), 1, 3000)).j;
    expect(part.done).toBe(false);
    for (let i = 0; i < 4; i++) await fetch(`${M.base}?id=Nx4444444${i + 1}`);
    expect((await fetch(`${M.base}?id=Nx44444449`)).status).toBe(429);
    // stažení (i existujícího id) se dál odmítá – jinak by 429 × 200 prozradilo, které id existuje
    expect((await fetch(`${M.base}?id=${done.id}`)).status).toBe(429);
    // cizí / chybný token se dál odmítá limitem
    expect((await fetch(`${M.base}?id=${done.id}`, { method: "DELETE", headers: { "X-Delete-Token": "x".repeat(24) } })).status).toBe(429);
    expect((await post(`${M.base}?id=${part.id}&offset=1000`, rnd(2000), { "X-Delete-Token": "x".repeat(24) })).status).toBe(429);
    // vlastník: doplnění nahrávání i zneplatnění projdou
    const more = await post(`${M.base}?id=${part.id}&offset=1000`, rnd(2000), { "X-Delete-Token": part.del });
    expect(more.status).toBe(200);
    expect(await more.json()).toEqual({ id: part.id, size: 3000, done: true });
    const del = await fetch(`${M.base}?id=${done.id}`, { method: "DELETE", headers: { "X-Delete-Token": done.del } });
    expect(del.status).toBe(200);
    expect(fs.existsSync(path.join(M.data, `${done.id}.bin`))).toBe(false);
  }, T);

  it("REVIZE – dotaz na id vložený do cizí stránky (Sec-Fetch-Site / Origin) se odmítne 403 a NEPOČÍTÁ: cizí web návštěvníkovi limit nevyčerpá", async () => {
    // dříve: 121 obrázků <img src=…/cad/share/?id=…> na cizí stránce → oběti z téže IP hodinu nešel otevřít ani zneplatnit žádný odkaz
    const M = await startPhp({ MN_SHARE_MISS: "5" });
    const hit = (await create(M, rnd(300))).j;
    for (let i = 0; i < 40; i++) {
      const r = await fetch(`${M.base}?id=zzzzzzzz${String(10 + i)}`, { headers: { "Sec-Fetch-Site": "cross-site", "Sec-Fetch-Mode": "no-cors", "Sec-Fetch-Dest": "image", Referer: "https://evil.example/" } });
      if (r.status !== 403) throw new Error(`cizí dotaz ${i + 1}: ${r.status}`);
    }
    for (const h of [{ "Sec-Fetch-Site": "same-site" }, { Origin: "https://evil.example" }, { Origin: "null" }, { "Sec-Fetch-Site": "cross-site", "Sec-Fetch-Mode": "navigate" }] as Record<string, string>[]) {
      const r = await fetch(`${M.base}?id=${hit.id}`, { headers: h });
      expect(r.status, JSON.stringify(h)).toBe(403);
      expect(await r.json()).toMatchObject({ ok: false, error: "cross_origin" });
    }
    // počítadlo neúspěšných dotazů nevzniklo; oběť odkaz otevře i zneplatní
    expect(fs.readdirSync(path.join(M.data, "rl")).filter((f) => /"m":/.test(fs.readFileSync(path.join(M.data, "rl", f), "utf8")))).toEqual([]);
    for (const h of [{}, { "Sec-Fetch-Site": "same-origin" }, { "Sec-Fetch-Site": "none" }] as Record<string, string>[]) expect((await fetch(`${M.base}?id=${hit.id}`, { headers: h })).status, JSON.stringify(h)).toBe(200);
    expect((await fetch(`${M.base}?id=${hit.id}`, { method: "DELETE", headers: { "X-Delete-Token": hit.del, "Sec-Fetch-Site": "same-origin" } })).status).toBe(200);
    // dotazy ze stejného původu se počítají dál
    for (let i = 0; i < 5; i++) expect((await fetch(`${M.base}?id=Nx5555555${i + 1}`, { headers: { "Sec-Fetch-Site": "same-origin" } })).status).toBe(404);
    expect((await fetch(`${M.base}?id=Nx55555559`, { headers: { "Sec-Fetch-Site": "same-origin" } })).status).toBe(429);
  }, T);

  it("REVIZE – dotazy na vypršelé a zneplatněné odkazy se do limitu nepočítají (příjemce má správný odkaz, nic nehádá)", async () => {
    const M = await startPhp({ MN_SHARE_MISS: "3" });
    const a = (await create(M, rnd(100))).j;
    const b = (await create(M, rnd(100))).j;
    const live = (await create(M, rnd(100))).j;
    expect((await fetch(`${M.base}?id=${a.id}`, { method: "DELETE", headers: { "X-Delete-Token": a.del } })).status).toBe(200);
    editMeta(M, b.id, { exp: Math.floor(Date.now() / 1000) - 5 });
    for (let i = 0; i < 8; i++) {
      expect((await fetch(`${M.base}?id=${a.id}`)).status).toBe(410);
      expect((await fetch(`${M.base}?id=${b.id}`)).status).toBe(410);
      expect((await fetch(`${M.base}?id=${a.id}`, { method: "DELETE", headers: { "X-Delete-Token": a.del } })).status).toBe(404);
    }
    expect((await fetch(`${M.base}?id=${live.id}`)).status).toBe(200);
  }, T);

  it("REVIZE – IPv6 se počítá po sítích /64 (jedna přípojka = 2^64 adres), IPv4 po adresách; ::ffff:a.b.c.d = táž IPv4", async () => {
    // dříve: klíčem byla celá adresa → každá další adresa z téže sítě /64 měla nový rozpočet 120 pokusů
    const M = await startPhp({ MN_SHARE_MISS: "4" }, undefined, true);
    const from = (addr: string, id: string) => fetch(`${M.base}?id=${id}`, { headers: { "X-Test-Addr": addr } });
    const hit = (await create(M, rnd(100))).j;
    // 5 různých adres z jedné sítě /64 = jeden rozpočet
    for (let i = 0; i < 4; i++) expect((await from(`2001:db8:a:30b::${(i + 1).toString(16)}`, `Nx6666666${i + 1}`)).status, `v6 ${i}`).toBe(404);
    expect((await from("2001:db8:a:30b:185:65:221:102", "Nx66666665")).status).toBe(429);
    expect((await from("2001:db8:a:30b:ffff:ffff:ffff:ffff", hit.id)).status).toBe(429);
    // jiná síť /64 (i sousední) má vlastní rozpočet
    expect((await from("2001:db8:a:30c::1", hit.id)).status).toBe(200);
    expect((await from("2001:db8:a:30c::1", "Nx66666666")).status).toBe(404);
    // IPv4: každá adresa zvlášť; zápis ::ffff:a.b.c.d je táž IPv4
    for (let i = 0; i < 4; i++) expect((await from("198.51.100.7", `Nx7777777${i + 1}`)).status).toBe(404);
    expect((await from("198.51.100.7", "Nx77777775")).status).toBe(429);
    expect((await from("::ffff:198.51.100.7", hit.id)).status).toBe(429);
    expect((await from("198.51.100.8", hit.id)).status).toBe(200);
    // limit nových sdílení používá stejný klíč (síť /64)
    const R = await startPhp({ MN_SHARE_RATE: "2" }, undefined, true);
    const mk = (addr: string) => post(`${R.base}?days=1&total=4`, rnd(4), { "X-Test-Addr": addr });
    expect((await mk("2001:db8:1:2::1")).status).toBe(201);
    expect((await mk("2001:db8:1:2::2")).status).toBe(201);
    expect((await mk("2001:db8:1:2:3:4:5:6")).status).toBe(429);
    expect((await mk("2001:db8:1:3::1")).status).toBe(201);
    // počítadla: jen otisk se solí, žádná adresa ani předpona
    for (const srv of [M, R]) for (const f of fs.readdirSync(path.join(srv.data, "rl"))) {
      expect(f).toMatch(/^[0-9a-f]{32}$/);
      expect(fs.readFileSync(path.join(srv.data, "rl", f), "utf8")).not.toMatch(/2001|db8|198\.51/);
    }
  }, T);

  it("REVIZE – úklid počítadel projde celou složku (i přes 3000 souborů): střídání adres ji nenafoukne natrvalo", async () => {
    // dříve: úklid prošel nejvýš 3000 položek a končil – při více počítadlech zůstávala stará navždy
    const M = await startPhp();
    await fetch(M.base + "?ping");
    const rl = path.join(M.data, "rl");
    const stale = new Date(Date.now() - 2 * 3600_000);
    for (let i = 0; i < 3600; i++) {
      const f = path.join(rl, i.toString(16).padStart(32, "0"));
      fs.writeFileSync(f, '{"t":1,"m":1}');
      fs.utimesSync(f, stale, stale);
    }
    fs.writeFileSync(path.join(rl, "f".repeat(32)), JSON.stringify({ t: Math.floor(Date.now() / 1000), m: 1 })); // živé počítadlo
    const old = new Date(Date.now() - 3600_000);
    fs.utimesSync(path.join(M.data, ".gc"), old, old);
    await fetch(M.base + "?ping");
    expect(fs.readdirSync(rl)).toEqual(["f".repeat(32)]);
  }, T);

  it("výchozí limit je 120 neúspěšných dotazů za hodinu (121. → 429)", async () => {
    const M = await startPhp();
    for (let i = 0; i < 120; i++) {
      // 7 číslic 1–9 (číslo v devítkové soustavě + 1) → pokaždé jiné platné id
      const r = await fetch(`${M.base}?id=Nx3${[...i.toString(9).padStart(7, "0")].map((d) => Number(d) + 1).join("")}`);
      if (r.status !== 404) throw new Error(`dotaz ${i + 1}: ${r.status}`);
    }
    expect((await fetch(`${M.base}?id=Nx39999999`)).status).toBe(429);
  }, 60_000);
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

  it("velký model po částech: odkaz <původ>/s#<kód 10>, na serveru jen id odvozené z kódu, otevření vrátí stejná data; zneplatnění", async () => {
    vi.stubGlobal("location", { origin: S.origin, pathname: "/cad" });
    const step = rnd(1_000_000);
    const d = doc();
    d.features.push({ id: "imp", name: "Import", type: "import", fileName: "deska.step", format: "step", data: putBlob(step) } as CadDoc["features"][number]);
    const r = await createShareLink(d, { days: 10 });
    expect(r.mode).toBe("self");
    expect(r.url).toMatch(new RegExp(`^${S.origin.replace(/[.]/g, "\\.")}/s#[1-9A-HJ-NP-Za-km-z]{10}$`));
    expect(r.url.length).toBe(S.origin.length + 13);
    expect(r.code).toBe(r.url.slice(-10));
    expect(r.id).toBe((await deriveShareCode(r.code!)).id);
    expect(r.id).toMatch(/^[1-9A-HJ-NP-Za-km-z]{11}$/);
    expect(fs.readdirSync(S.data).filter((f) => f.endsWith(".bin"))).toEqual([`${r.id}.bin`]);
    // kód ani klíč na serveru nejsou (jen id, šifrovaný obsah a otisk tokenu)
    const stored = fs.readFileSync(path.join(S.data, `${r.id}.bin`));
    expect(stored.subarray(0, 4)).toEqual(Buffer.from([0x4d, 0x4e, 0x51, 0x02]));
    for (const f of fs.readdirSync(S.data).filter((x) => x.endsWith(".json"))) expect(fs.readFileSync(path.join(S.data, f), "utf8")).not.toContain(r.code!);
    expect(fs.readdirSync(S.data).some((f) => f.includes(r.code!))).toBe(false);
    const o = await openShareLink(parseShareHash(r.url.slice(r.url.indexOf("#")))!);
    expect(o.ok).toBe(true);
    if (o.ok) {
      expect(o.mode).toBe("self");
      const f = o.payload.doc.features.find((x) => x.type === "import") as { data: string };
      expect(blobOf(f.data)).toEqual(step);
    }
    expect(await revokeShare(r)).toBe(true);
    const gone = await openShareLink(parseShareHash(r.url.slice(r.url.indexOf("#")))!);
    expect(!gone.ok && gone.reason).toBe("revoked");
    // opakované zneplatnění je v pořádku (už smazáno)
    expect(await revokeShare(r)).toBe(true);
  }, T);

  it("heslo a vypršení na serveru", async () => {
    vi.stubGlobal("location", { origin: S.origin, pathname: "/cad" });
    const r = await createShareLink(doc(), { days: 1, password: "tajne" });
    const p = parseShareHash(r.url.slice(r.url.indexOf("#")))!;
    expect(p).toEqual({ kind: "code", code: r.code });
    // samotný kód: obsah se najde, ale bez hesla se neotevře
    const need = await openShareLink(p);
    expect(!need.ok && need.reason).toBe("password");
    const bad = await openShareLink(p, "spatne");
    expect(!bad.ok && bad.reason).toBe("password");
    const good = await openShareLink(p, "tajne");
    expect(good.ok && good.payload.doc.name).toBe("Deska s importem");
    editMeta(S, r.id!, { exp: Math.floor(Date.now() / 1000) - 1 });
    resetShareProbe();
    const ex = await openShareLink(p, "tajne");
    expect(!ex.ok && ex.reason).toBe("expired");
    // i podruhé (obsah je už smazaný): stále „vypršel“ s datem, ne „nenalezeno“
    const ex2 = await openShareLink(p);
    expect(ex2).toMatchObject({ ok: false, reason: "expired" });
    expect(!ex2.ok && ex2.exp).toBeGreaterThan(Date.now() - 60_000);
  }, T);

  it("nad limit serveru: srozumitelná chyba ještě před nahráním", async () => {
    const L = await startPhp({ MN_SHARE_MAX_BYTES: "200000" });
    vi.stubGlobal("location", { origin: L.origin, pathname: "/cad" });
    const d = doc();
    d.features.push({ id: "imp", name: "Import", type: "import", fileName: "x.step", format: "step", data: putBlob(rnd(300_000)) } as CadDoc["features"][number]);
    await expect(createShareLink(d, { days: 10 })).rejects.toThrow(/příliš velký/);
    expect(fs.existsSync(L.data) ? fs.readdirSync(L.data).filter((f) => /\.(bin|part)$/.test(f)) : []).toEqual([]);
  }, T);

  /** další volání crypto.getRandomValues pro kód (24 B) vrátí dané hodnoty → createShareLink vylosuje právě tento kód */
  const forceCodes = (codes: string[]) => {
    const A58 = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";
    const real = crypto.getRandomValues.bind(crypto);
    const queue = [...codes];
    return vi.spyOn(crypto, "getRandomValues").mockImplementation(((a: Uint8Array) => {
      const c = a.length === 24 ? queue.shift() : undefined;
      if (!c) return real(a);
      a.fill(0);
      [...c].forEach((ch, i) => (a[i] = A58.indexOf(ch)));
      return a;
    }) as typeof crypto.getRandomValues);
  };

  it("kolize id (409 od skutečného serveru): prohlížeč vylosuje nový kód, cizí obsah zůstane nedotčený", async () => {
    vi.stubGlobal("location", { origin: S.origin, pathname: "/cad" });
    const taken = "Ab3kZ9xQ2m";
    const takenId = (await deriveShareCode(taken)).id;
    const foreign = rnd(4000);
    expect((await post(`${S.base}?days=5&total=${foreign.length}&id=${takenId}`, foreign)).status).toBe(201);
    const spy = forceCodes([taken]);
    try {
      const r = await createShareLink(doc(), { days: 10 });
      expect(r.mode).toBe("self");
      expect(r.code).not.toBe(taken);
      expect(r.id).not.toBe(takenId);
      expect(new Uint8Array(await (await fetch(`${S.base}?id=${takenId}`)).arrayBuffer())).toEqual(foreign);
      const o = await openShareLink(parseShareHash(r.url.slice(r.url.indexOf("#")))!);
      expect(o.ok && o.payload.doc.name).toBe("Deska s importem");
      // kód obsazeného id otevře cizí obsah → neplatný (není to náš dokument, klíč nesedí)
      const wrong = await openShareLink({ kind: "code", code: taken });
      expect(!wrong.ok && wrong.reason).toBe("invalid");
    } finally {
      spy.mockRestore();
    }
    // tři kolize po sobě: krátký odkaz nevznikne – dokument jde do odkazu s důvodem (vynucené úložiště = chyba)
    const spy3 = forceCodes([taken, taken, taken, taken, taken, taken]);
    try {
      const f = await createShareLink(doc(), { days: 10 });
      expect(f.mode).toBe("link");
      expect(f.note).toMatch(/409 id_taken/);
      await expect(createShareLink(doc(), { days: 10, mode: "self" })).rejects.toThrow(/409 id_taken/);
    } finally {
      spy3.mockRestore();
    }
  }, T);

  it("starší odkaz #q=<id>.<klíč> (obsah vytvořený původním kódem, nahraný starším API bez id) se otevře dál", async () => {
    vi.stubGlobal("location", { origin: S.origin, pathname: "/cad" });
    // skutečný výstup createShareLink z bf91b0b (obsah „MNQ“ v1, platnost v obsahu do 1. 4. 2099)
    const OLD_KEY = "Y3zVVDBJ_a0QdUpYKLUKMw";
    const OLD_BLOB =
      "TU5RAQaMcYjIzb7dlc+EExElws+GCge7HL2l9HmOqBUbgUaDvsVbjky4ZUwBaM4FZwbNHakxADfivBj+fXZznElCy8/01+Bdcrr9toc1f3pL2okH6wh/5eOqEhevkLARP175DP+3fsrJ78w2BSiikDoeoYvlr6x9wazbKv0/MdSElx786ailHkpmnv+WW7d9rlv44I0nDaTfPxRyNfkjSXwBqhj/YAfMieZdxB7Ua84PbH3iCon2GY132KWLPFHpqSQcw8koZdwKtygFSBU8sl3I2ad9+QhjEq+IFsNca3Aw3169deLDL3XzSKkFhGhwe6S3xn1kqk8KS7jsDvTz+HPBKJ0lxyrYoqmlrSnvZvF20Du8ZwYQmqE=";
    const blob = new Uint8Array(Buffer.from(OLD_BLOB, "base64"));
    const { res, j } = await create(S, blob, 30);
    expect(res.status).toBe(201);
    const url = `${S.origin}/cad#q=${j.id}.${OLD_KEY}`;
    const p = parseShareHash(url.slice(url.indexOf("#")))!;
    expect(p.kind).toBe("self");
    const o = await openShareLink(p);
    expect(o.ok).toBe(true);
    if (o.ok) {
      expect(o.mode).toBe("self");
      expect(o.payload.doc.name).toBe("Příruba DN50");
      expect(o.payload.from).toBe("Vít Volný");
      expect(o.payload.doc.features.length).toBe(2);
    }
    // a jde zneplatnit tokenem jako dřív
    expect(await revokeShare({ mode: "self", id: j.id, del: j.del })).toBe(true);
    resetShareProbe();
    const gone = await openShareLink(p);
    expect(!gone.ok && gone.reason).toBe("revoked");
    // REVIZE: zneplatněný starší odkaz nejde oživit – jeho id (10 znaků) přes ?id= založit nelze
    expect((await post(`${S.base}?days=90&total=${blob.length}&id=${j.id}`, blob)).status).toBe(400);
    resetShareProbe();
    const still = await openShareLink(p);
    expect(!still.ok && still.reason).toBe("revoked");
  }, T);

  it("REVIZE – držitel odkazu ho po zneplatnění neoživí s jiným obsahem: stejný kód → 409, vylosuje se jiný; původní odkaz zůstává zneplatněný", async () => {
    vi.stubGlobal("location", { origin: S.origin, pathname: "/cad" });
    const r = await createShareLink({ ...doc(), name: "Původní rev A" }, { days: 1, from: "Mnástrojárna" });
    const link = parseShareHash(r.url.slice(r.url.indexOf("#")))!;
    const o1 = await openShareLink(link);
    expect(o1.ok && o1.payload.doc.name).toBe("Původní rev A");
    expect(await revokeShare(r)).toBe(true);
    resetShareProbe();
    // útočník = kdokoli, kdo odkaz kdy viděl: nahraje jiný dokument pod STEJNÝ kód (id i klíč z něj plynou)
    const spy = forceCodes([r.code!]);
    let evil;
    try {
      evil = await createShareLink({ ...doc(), name: "PODVRH rev B" }, { days: 90, from: "Mnástrojárna" });
    } finally {
      spy.mockRestore();
    }
    expect(evil.code).not.toBe(r.code);
    expect(evil.url).not.toBe(r.url);
    resetShareProbe();
    // ostatní příjemci původního odkazu podvrh nedostanou
    const o2 = await openShareLink(link);
    expect(o2).toEqual({ ok: false, reason: "revoked" });
    // přímo proti serveru (bez klienta): id původního odkazu je obsazené navždy
    expect((await post(`${S.base}?days=90&total=5&id=${r.id}`, rnd(5))).status).toBe(409);
    // tři pokusy se stejným kódem → krátký odkaz nevznikne vůbec
    const spy3 = forceCodes([r.code!, r.code!, r.code!]);
    try {
      await expect(createShareLink(doc(), { days: 1, mode: "self" })).rejects.toThrow(/409 id_taken/);
    } finally {
      spy3.mockRestore();
    }
  }, T);

  it("REVIZE – totéž po vypršení: stejný kód už nejde nahrát, odkaz hlásí „vypršel“", async () => {
    vi.stubGlobal("location", { origin: S.origin, pathname: "/cad" });
    const r = await createShareLink({ ...doc(), name: "Původní" }, { days: 1 });
    editMeta(S, r.id!, { exp: Math.floor(Date.now() / 1000) - 5 });
    const link = { kind: "code" as const, code: r.code! };
    const o = await openShareLink(link);
    expect(!o.ok && o.reason).toBe("expired");
    const spy = forceCodes([r.code!]);
    try {
      const evil = await createShareLink({ ...doc(), name: "PODVRH po vypršení" }, { days: 90 });
      expect(evil.code).not.toBe(r.code);
    } finally {
      spy.mockRestore();
    }
    resetShareProbe();
    const o2 = await openShareLink(link);
    expect(!o2.ok && o2.reason).toBe("expired");
  }, T);

  it("REVIZE – cizí stránka návštěvníkovi sdílení nezablokuje: po 125 dotazech vložených do cizí stránky odkaz dál jde otevřít i zneplatnit", async () => {
    const V = await startPhp();
    vi.stubGlobal("location", { origin: V.origin, pathname: "/cad" });
    const r = await createShareLink({ ...doc(), name: "Dokument oběti" }, { days: 1 });
    const statuses = new Map<number, number>();
    for (let i = 0; i < 125; i++) {
      const res = await fetch(`${V.base}?id=zzzzzzzz${String(100 + i)}`, { headers: { "Sec-Fetch-Site": "cross-site", "Sec-Fetch-Mode": "no-cors", "Sec-Fetch-Dest": "image", Referer: "https://evil.example/" } });
      await res.arrayBuffer();
      statuses.set(res.status, (statuses.get(res.status) ?? 0) + 1);
    }
    expect([...statuses]).toEqual([[403, 125]]);
    resetShareProbe();
    const o = await openShareLink({ kind: "code", code: r.code! });
    expect(o.ok && o.payload.doc.name).toBe("Dokument oběti");
    expect(await revokeShare(r)).toBe(true);
  }, 60_000);

  it("REVIZE – vyčerpaný limit z téže IP: příjemce dostane „úložiště nedostupné“, ale odesílatel odkaz zneplatní", async () => {
    const V = await startPhp({ MN_SHARE_MISS: "3" });
    vi.stubGlobal("location", { origin: V.origin, pathname: "/cad" });
    const r = await createShareLink(doc(), { days: 1 });
    for (let i = 0; i < 4; i++) await (await fetch(`${V.base}?id=Nx8888888${i + 1}`)).arrayBuffer();
    resetShareProbe();
    const o = await openShareLink({ kind: "code", code: r.code! });
    expect(!o.ok && o.reason).toBe("network");
    expect(await revokeShare(r)).toBe(true);
    expect(fs.existsSync(path.join(V.data, `${r.id}.bin`))).toBe(false);
  }, T);

  it("REVIZE – překlep v kódu (jiná velikost písmen): „nenalezeno“ a hlášení radí zkontrolovat kód; správný kód dál otevře", async () => {
    vi.stubGlobal("location", { origin: S.origin, pathname: "/cad" });
    const r = await createShareLink(doc(), { days: 1 });
    const lower = r.code!.toLowerCase() === r.code ? r.code!.toUpperCase().replace(/[OI]/g, "X") : r.code!.toLowerCase().replace(/l/g, "x");
    const wrong = await openShareLink({ kind: "code", code: lower });
    expect(wrong).toEqual({ ok: false, reason: "notfound" });
    expect(openErrorText("notfound", null, "code")).toMatch(/Zkontrolujte kód – záleží na velikosti písmen/);
    const right = await openShareLink({ kind: "code", code: r.code! });
    expect(right.ok).toBe(true);
  }, T);
});

describe.skipIf(!PHP_OK || !OLD_SCRIPT)("nová aplikace ↔ STARŠÍ skript úložiště na serveru (bf91b0b) – nasazení po částech", () => {
  let O: Srv;
  beforeAll(async () => {
    O = await startPhp({}, OLD_SCRIPT!);
  }, T);
  afterEach(() => {
    vi.unstubAllGlobals();
    resetShareProbe();
  });

  it("starší skript ohlásí v = 1 a id od prohlížeče nezná (POST …&id= → 404) – proto se mu id neposílá", async () => {
    expect(((await (await fetch(O.base + "?ping")).json()) as { v: number }).v).toBe(1);
    expect((await post(`${O.base}?days=1&total=3&id=Ab3kZ9xQ2m`, new Uint8Array([1, 2, 3]))).status).toBe(404);
  }, T);

  it("vznikne starší tvar #q=<id>.<klíč> s vysvětlením; otevření, heslo i zneplatnění fungují", async () => {
    vi.stubGlobal("location", { origin: O.origin, pathname: "/cad" });
    const d: CadDoc = { ...emptyDoc("Deska – starší úložiště"), features: [{ id: "s1", name: "Skica 1", type: "sketch", plane: "XY", entities: [{ kind: "circle", center: [0, 0], r: 40 }] } as unknown as CadDoc["features"][number]] };
    const r = await createShareLink(d, { days: 10, password: "tajne" });
    expect(r.mode).toBe("self");
    expect(r.url).toMatch(new RegExp(`^${O.origin.replace(/[.]/g, "\\.")}/cad#q=[0-9A-Za-z]{10}\\.[A-Za-z0-9_-]{22}$`));
    expect(r.code).toBeUndefined();
    expect(r.note).toMatch(/starší verze/);
    const p = parseShareHash(r.url.slice(r.url.indexOf("#")))!;
    expect(p.kind).toBe("self");
    const need = await openShareLink(p);
    expect(!need.ok && need.reason).toBe("password");
    const good = await openShareLink(p, "tajne");
    expect(good.ok && good.payload.doc.name).toBe("Deska – starší úložiště");
    expect(await revokeShare(r)).toBe(true);
    resetShareProbe();
    const gone = await openShareLink(p, "tajne");
    expect(!gone.ok && gone.reason).toBe("notfound");
  }, T);

  it("odkaz s kódem proti staršímu skriptu: obsah tam není → „nenalezeno“ (žádná chyba)", async () => {
    vi.stubGlobal("location", { origin: O.origin, pathname: "/cad" });
    const o = await openShareLink({ kind: "code", code: "Ab3kZ9xQ2m" });
    expect(!o.ok && o.reason).toBe("notfound");
  }, T);
});
